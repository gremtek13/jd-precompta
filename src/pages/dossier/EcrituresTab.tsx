import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatMoney } from '../../lib/format'
import { COMPTE_BANQUE, COMPTE_TVA_COLLECTEE, COMPTE_TVA_DEDUCTIBLE, SUGGESTIONS_COMPTE_PAR_CODE, analyserEcritures, lignesChargeProduitPourPiece, synchroniserContrepartieBanque, tvaNettePourPeriode } from '../../lib/ecritures'
import { categoriesSansCompte as calculerCategoriesSansCompte, piecesSansTva as calculerPiecesSansTva } from '../../lib/controles'
import { genererFec, nomFichierFec, telechargerTexte } from '../../lib/fec'
import type { Categorie, DeclarationTva, EcritureBrouillon, LigneBancaire, Piece } from '../../lib/types'
import BrouillonBanner from '../../components/BrouillonBanner'
import AnneeTabs, { type ValeurAnnee } from '../../components/AnneeTabs'

// Palier 5 — brouillon comptable, brique 1 (journal). Génère une proposition d'écriture pour
// chaque pièce validée dont la catégorie a un compte associé — la ligne charge/produit, puis la
// ligne de TVA séparée le cas échéant (brique 3). La contrepartie banque (partie double complète,
// voir lib/ecritures.ts) s'ajoute automatiquement si la pièce est déjà rapprochée d'un mouvement au
// moment de la génération, ou plus tard depuis Banque sinon. L'export FEC (voir lib/fec.ts) permet au
// cabinet de récupérer un fichier directement importable dans son propre logiciel de comptabilité,
// une fois l'année sélectionnée et le brouillon jugé complet.
export default function EcrituresTab({ dossierId, dossierSiret, assujettiTva }: { dossierId: string; dossierSiret: string | null; assujettiTva: boolean }) {
  const [categories, setCategories] = useState<Categorie[]>([])
  const [pieces, setPieces] = useState<Piece[]>([])
  const [ecritures, setEcritures] = useState<EcritureBrouillon[]>([])
  const [lignesBancaires, setLignesBancaires] = useState<LigneBancaire[]>([])
  const [immobilisationPieceIds, setImmobilisationPieceIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [comptesEdit, setComptesEdit] = useState<Record<string, string>>({})
  const [anneeFilter, setAnneeFilter] = useState<ValeurAnnee>('toutes')
  const [regenerating, setRegenerating] = useState<string | null>(null)
  const [declarationsTva, setDeclarationsTva] = useState<DeclarationTva[]>([])
  const [periodeDebut, setPeriodeDebut] = useState('')
  const [periodeFin, setPeriodeFin] = useState('')
  const [tvaDeclaree, setTvaDeclaree] = useState('')
  const [dateDeclaration, setDateDeclaration] = useState('')
  const [savingDeclaration, setSavingDeclaration] = useState(false)

  async function load() {
    setLoading(true)
    const [{ data: categoriesData }, { data: piecesData }, { data: ecrituresData }, { data: immobilisationsData }, { data: lignesData }, { data: declarationsData }] = await Promise.all([
      supabase.from('categories').select('*').or(`dossier_id.eq.${dossierId},dossier_id.is.null`).order('ordre'),
      supabase.from('pieces').select('*').eq('dossier_id', dossierId).eq('statut', 'validee'),
      supabase.from('ecritures_brouillon').select('*').eq('dossier_id', dossierId).order('date', { ascending: false }),
      supabase.from('immobilisations').select('piece_id').eq('dossier_id', dossierId),
      supabase.from('lignes_bancaires').select('*').eq('dossier_id', dossierId).eq('statut', 'rapprochee').not('piece_id', 'is', null),
      supabase.from('declarations_tva').select('*').eq('dossier_id', dossierId).order('periode_debut', { ascending: false }),
    ])
    setLignesBancaires(lignesData ?? [])
    setCategories(categoriesData ?? [])
    setPieces(piecesData ?? [])
    setEcritures(ecrituresData ?? [])
    setImmobilisationPieceIds(new Set((immobilisationsData ?? []).map((i) => i.piece_id).filter((id): id is string => !!id)))
    setDeclarationsTva(declarationsData ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [dossierId])

  const categorieById = (id: string | null) => categories.find((c) => c.id === id) ?? null

  // Catégories utilisées par au moins une pièce validée mais sans compte associé — impossible de
  // générer l'écriture correspondante tant que ce n'est pas renseigné (voir lib/controles.ts).
  const categoriesSansCompte = calculerCategoriesSansCompte(categories, pieces)

  // Valeur affichée dans le champ tant que le cabinet n'a rien tapé : la suggestion connue pour ce
  // code de catégorie, sinon vide — jamais enregistrée avant le clic explicite sur "Enregistrer".
  function compteAffiche(c: Categorie): string {
    return comptesEdit[c.id] ?? SUGGESTIONS_COMPTE_PAR_CODE[c.code]?.compte ?? ''
  }

  async function saveCompte(categorieId: string) {
    const categorie = categories.find((c) => c.id === categorieId)
    const valeur = (comptesEdit[categorieId] ?? (categorie ? SUGGESTIONS_COMPTE_PAR_CODE[categorie.code]?.compte : undefined) ?? '').trim()
    if (!valeur) return
    const { error: saveError } = await supabase.from('categories').update({ compte_comptable: valeur }).eq('id', categorieId)
    if (saveError) {
      setError(saveError.message)
      return
    }
    load()
  }

  // Une pièce enregistrée comme immobilisation (onglet Immobilisations) est un actif, pas une charge
  // courante — elle ne doit pas aussi générer une écriture de charge ici, sous peine de compter la
  // dépense deux fois dans le brouillon.
  const piecesEligibles = pieces.filter(
    (p) => p.montant_ttc != null && !!categorieById(p.categorie_id)?.compte_comptable && !immobilisationPieceIds.has(p.id),
  )
  const enAttente = piecesEligibles.filter((p) => !ecritures.some((e) => e.piece_id === p.id))

  async function genererEcritures() {
    if (enAttente.length === 0) return
    setGenerating(true)
    setError(null)
    try {
      const rows = enAttente.flatMap((p) => lignesChargeProduitPourPiece(dossierId, p, categorieById(p.categorie_id)!.compte_comptable!))
      const { error: insertError } = await supabase.from('ecritures_brouillon').insert(rows)
      if (insertError) throw insertError

      // Une pièce déjà rapprochée d'un mouvement bancaire au moment où son écriture est générée (import
      // en masse d'anciens exercices, par exemple) doit recevoir sa contrepartie tout de suite — sinon
      // il faudrait re-toucher le rapprochement dans Banque pour que la partie double se complète.
      await Promise.all(
        enAttente.map((p) => {
          const ligne = lignesBancaires.find((l) => l.piece_id === p.id)
          return ligne ? synchroniserContrepartieBanque(dossierId, p, ligne) : Promise.resolve()
        }),
      )
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    } finally {
      setGenerating(false)
    }
  }

  // Le filtre par année ne porte que sur l'affichage des écritures déjà générées — la génération
  // (bouton ci-dessous) reste globale, sur toutes les pièces en attente quelle que soit leur année.
  const anneesDisponibles = [...new Set(ecritures.map((e) => new Date(e.date).getFullYear()))].sort((a, b) => b - a)
  const ecrituresFiltrees = anneeFilter === 'toutes' ? ecritures : ecritures.filter((e) => new Date(e.date).getFullYear() === anneeFilter)

  const tvaDeductible = ecrituresFiltrees.filter((e) => e.compte === COMPTE_TVA_DEDUCTIBLE).reduce((sum, e) => sum + e.montant, 0)
  const tvaCollectee = ecrituresFiltrees.filter((e) => e.compte === COMPTE_TVA_COLLECTEE).reduce((sum, e) => sum + e.montant, 0)

  // Trois contrôles d'intégrité du brouillon (voir lib/ecritures.ts) — volontairement indépendants du
  // filtre Année ci-dessus : ce sont des défauts sur l'état actuel du brouillon, pas des totaux à
  // consulter par exercice. Une écriture sans contrepartie banque ou déséquilibrée d'un ancien exercice
  // ne doit pas disparaître de la vue juste parce que l'onglet Année est positionné ailleurs.
  const { nbSansContrepartie, groupesDesequilibres, piecesDesynchronisees } = analyserEcritures(ecritures, piecesEligibles)
  const pieceById = (id: string) => pieces.find((p) => p.id === id) ?? null

  // Reprend les lignes charge/produit + TVA d'une pièce d'après ses montants actuels — jamais
  // automatique, seulement sur ce clic explicite. Ne touche pas à la contrepartie banque (montant du
  // mouvement réel, indépendant d'une correction sur la pièce).
  async function regenererEcriture(piece: Piece) {
    const compte = categorieById(piece.categorie_id)?.compte_comptable
    if (!compte) return
    setRegenerating(piece.id)
    setError(null)
    try {
      const { error: deleteError } = await supabase.from('ecritures_brouillon').delete().eq('piece_id', piece.id).neq('compte', COMPTE_BANQUE)
      if (deleteError) throw deleteError
      const { error: insertError } = await supabase.from('ecritures_brouillon').insert(lignesChargeProduitPourPiece(dossierId, piece, compte))
      if (insertError) throw insertError
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    } finally {
      setRegenerating(null)
    }
  }

  const piecesSansTva = calculerPiecesSansTva(pieces, assujettiTva)

  async function enregistrerDeclaration(e: FormEvent) {
    e.preventDefault()
    if (!periodeDebut || !periodeFin || !tvaDeclaree) return
    setSavingDeclaration(true)
    setError(null)
    try {
      const { error: insertError } = await supabase.from('declarations_tva').insert({
        dossier_id: dossierId,
        periode_debut: periodeDebut,
        periode_fin: periodeFin,
        tva_declaree: parseFloat(tvaDeclaree),
        date_declaration: dateDeclaration || null,
      })
      if (insertError) throw insertError
      setPeriodeDebut('')
      setPeriodeFin('')
      setTvaDeclaree('')
      setDateDeclaration('')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    } finally {
      setSavingDeclaration(false)
    }
  }

  async function supprimerDeclaration(id: string) {
    if (!window.confirm('Retirer cette déclaration ?')) return
    await supabase.from('declarations_tva').delete().eq('id', id)
    load()
  }

  return (
    <>
      <BrouillonBanner />

      {piecesSansTva.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderColor: 'var(--color-warning)' }}>
          <h3 style={{ marginTop: 0 }}>Pièces sans TVA renseignée</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Ce dossier est marqué assujetti à la TVA, mais {piecesSansTva.length} pièce{piecesSansTva.length > 1 ? 's' : ''} validée{piecesSansTva.length > 1 ? 's' : ''} n'a{piecesSansTva.length > 1 ? 'ont' : ''} pas de montant de TVA — vérifie si c'est normal (achat auprès d'un non-assujetti…) ou un oubli de saisie.
          </p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {piecesSansTva.map((p) => (
              <li key={p.id}>{p.tiers ?? p.nom_fichier} — {formatMoney(p.montant_ttc)}</li>
            ))}
          </ul>
        </div>
      )}

      {piecesDesynchronisees.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderColor: 'var(--color-danger)' }}>
          <h3 style={{ marginTop: 0 }}>Écritures à régénérer</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Ces pièces ont été modifiées (montant, TVA...) depuis que leur écriture a été générée — la
            charge/produit enregistrée ne correspond plus au montant actuel de la pièce. Reprend les
            montants à jour sans toucher à une éventuelle contrepartie banque déjà rapprochée.
          </p>
          <table>
            <thead><tr><th>Pièce</th><th>Montant actuel</th><th></th></tr></thead>
            <tbody>
              {piecesDesynchronisees.map((p) => (
                <tr key={p.id}>
                  <td>{p.tiers ?? p.nom_fichier}</td>
                  <td>{formatMoney(p.montant_ttc)}</td>
                  <td>
                    <button className="btn btn-outline btn-sm" disabled={regenerating === p.id} onClick={() => regenererEcriture(p)}>
                      {regenerating === p.id ? 'Régénération…' : 'Régénérer'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {groupesDesequilibres.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderColor: 'var(--color-danger)' }}>
          <h3 style={{ marginTop: 0 }}>Écritures déséquilibrées</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Le total des débits ne correspond pas à celui des crédits sur ces pièces — un montant réel
            de mouvement bancaire différent de la pièce (frais, paiement partiel...) l'explique parfois,
            mais ça mérite toujours une vérification avant l'export FEC.
          </p>
          <table>
            <thead><tr><th>Pièce</th><th>Écart</th></tr></thead>
            <tbody>
              {groupesDesequilibres.map((g) => {
                const piece = pieceById(g.pieceId)
                return (
                  <tr key={g.pieceId}>
                    <td>{piece?.tiers ?? piece?.nom_fichier ?? g.pieceId.slice(0, 8)}</td>
                    <td>{formatMoney(g.solde)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {categoriesSansCompte.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Comptes manquants</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Ces catégories sont utilisées par des pièces validées mais n'ont pas encore de compte comptable associé —
            les écritures correspondantes ne peuvent pas être générées tant que ce n'est pas fait. Un compte déjà
            renseigné est une suggestion à vérifier, pas une valeur figée — modifie-le avant d'enregistrer si besoin.
          </p>
          <table>
            <thead><tr><th>Catégorie</th><th>Compte</th><th></th></tr></thead>
            <tbody>
              {categoriesSansCompte.map((c) => (
                <tr key={c.id}>
                  <td>{c.libelle}</td>
                  <td style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '5px 8px', width: 120 }}
                      placeholder="ex. 606100"
                      value={compteAffiche(c)}
                      onChange={(e) => setComptesEdit((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    />
                    {!comptesEdit[c.id] && SUGGESTIONS_COMPTE_PAR_CODE[c.code] && (
                      <span className="badge badge-neutral">suggestion</span>
                    )}
                  </td>
                  <td>
                    <button className="btn btn-outline btn-sm" onClick={() => saveCompte(c.id)}>Enregistrer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(tvaDeductible > 0 || tvaCollectee > 0) && (
        <div className="card" style={{ marginBottom: 20, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <span className="muted" style={{ display: 'block' }}>TVA déductible (achats)</span>
            <strong>{formatMoney(tvaDeductible)}</strong>
          </div>
          <div>
            <span className="muted" style={{ display: 'block' }}>TVA collectée (ventes)</span>
            <strong>{formatMoney(tvaCollectee)}</strong>
          </div>
          <div>
            <span className="muted" style={{ display: 'block' }}>Solde</span>
            <strong>{formatMoney(tvaCollectee - tvaDeductible)}</strong>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Déclarations de TVA</h3>
        <p className="muted" style={{ marginTop: -8 }}>
          Une fois la CA3 réellement déposée, transcris ici le montant déclaré pour la période — jamais
          calculé par l'appli — pour comparer au total du brouillon sur la même période. Un écart peut
          venir d'une pièce pas encore traitée ici ou d'une erreur sur l'un des deux côtés, à toi de
          trancher.
        </p>
        <form onSubmit={enregistrerDeclaration} className="field-row" style={{ alignItems: 'flex-end' }}>
          <div className="field">
            <label htmlFor="periodeDebut">Début de période</label>
            <input id="periodeDebut" type="date" required value={periodeDebut} onChange={(e) => setPeriodeDebut(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="periodeFin">Fin de période</label>
            <input id="periodeFin" type="date" required value={periodeFin} onChange={(e) => setPeriodeFin(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="tvaDeclaree">TVA nette déclarée</label>
            <input id="tvaDeclaree" type="number" step="0.01" required value={tvaDeclaree} onChange={(e) => setTvaDeclaree(e.target.value)} style={{ width: 140 }} />
          </div>
          <div className="field">
            <label htmlFor="dateDeclaration">Date de dépôt (optionnel)</label>
            <input id="dateDeclaration" type="date" value={dateDeclaration} onChange={(e) => setDateDeclaration(e.target.value)} />
          </div>
          <button className="btn btn-primary btn-sm" type="submit" disabled={savingDeclaration}>
            {savingDeclaration ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </form>

        {declarationsTva.length > 0 && (
          <table style={{ marginTop: 16 }}>
            <thead>
              <tr><th>Période</th><th>Déclarée</th><th>Brouillon</th><th>Écart</th><th></th></tr>
            </thead>
            <tbody>
              {declarationsTva.map((d) => {
                const brouillon = tvaNettePourPeriode(ecritures, d.periode_debut, d.periode_fin)
                const ecart = d.tva_declaree - brouillon
                // Tolérance plus large qu'ailleurs (1 €, pas 2 centimes) : une CA3 est déposée en euros
                // arrondis, un écart de quelques centimes ici est donc normal, pas un défaut à signaler.
                const enEcart = Math.abs(ecart) > 1
                return (
                  <tr key={d.id}>
                    <td>{formatDate(d.periode_debut)} → {formatDate(d.periode_fin)}</td>
                    <td>{formatMoney(d.tva_declaree)}</td>
                    <td>{formatMoney(brouillon)}</td>
                    <td>
                      {enEcart
                        ? <span className="badge badge-danger">{formatMoney(ecart)}</span>
                        : <span className="badge badge-ok">{formatMoney(ecart)}</span>}
                    </td>
                    <td>
                      <button className="btn btn-danger btn-sm" onClick={() => supprimerDeclaration(d.id)}>Retirer</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <p className="muted" style={{ margin: 0 }}>
          {ecritures.length} écriture{ecritures.length > 1 ? 's' : ''} proposée{ecritures.length > 1 ? 's' : ''}
          {enAttente.length > 0 && ` — ${enAttente.length} pièce${enAttente.length > 1 ? 's' : ''} en attente de génération`}
          {nbSansContrepartie > 0 && (
            <> — <span className="badge badge-warning">{nbSansContrepartie} en attente de rapprochement bancaire</span></>
          )}
          {piecesDesynchronisees.length > 0 && (
            <> — <span className="badge badge-danger">{piecesDesynchronisees.length} à régénérer</span></>
          )}
          {groupesDesequilibres.length > 0 && (
            <> — <span className="badge badge-danger">{groupesDesequilibres.length} déséquilibrée{groupesDesequilibres.length > 1 ? 's' : ''}</span></>
          )}
        </p>
        <button className="btn btn-primary btn-sm" disabled={generating || enAttente.length === 0} onClick={genererEcritures}>
          {generating ? 'Génération…' : `Générer les écritures manquantes${enAttente.length > 0 ? ` (${enAttente.length})` : ''}`}
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}

      <AnneeTabs annees={anneesDisponibles} valeur={anneeFilter} onChange={setAnneeFilter} />

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button
          className="btn btn-outline btn-sm"
          disabled={typeof anneeFilter !== 'number' || ecrituresFiltrees.length === 0}
          title={typeof anneeFilter !== 'number' ? "Sélectionne une année ci-dessus — le FEC est un fichier par exercice." : undefined}
          onClick={() => {
            if (typeof anneeFilter !== 'number') return
            const contenu = genererFec(ecrituresFiltrees, pieces, categories)
            telechargerTexte(nomFichierFec(dossierSiret, anneeFilter), contenu)
          }}
        >
          Exporter FEC {typeof anneeFilter === 'number' ? anneeFilter : ''}
        </button>
      </div>

      <div className="card table-scroll" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : ecrituresFiltrees.length === 0 ? (
          <div className="empty-state">Aucune écriture proposée pour l'instant.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Compte</th>
                <th>Libellé</th>
                <th>Montant</th>
                <th>Sens</th>
              </tr>
            </thead>
            <tbody>
              {ecrituresFiltrees.map((e) => (
                <tr key={e.id}>
                  <td>{formatDate(e.date)}</td>
                  <td style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{e.compte}</td>
                  <td>{e.libelle}</td>
                  <td>{formatMoney(e.montant)}</td>
                  <td>
                    {e.sens === 'debit'
                      ? <span className="badge badge-neutral">Débit</span>
                      : <span className="badge badge-ok">Crédit</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
