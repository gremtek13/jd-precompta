import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatMoney } from '../../lib/format'
import { COMPTE_BANQUE, COMPTE_TVA_COLLECTEE, COMPTE_TVA_DEDUCTIBLE, SUGGESTIONS_COMPTE_PAR_CODE, synchroniserContrepartieBanque } from '../../lib/ecritures'
import { genererFec, nomFichierFec, telechargerTexte } from '../../lib/fec'
import type { Categorie, EcritureBrouillon, LigneBancaire, Piece } from '../../lib/types'
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

  async function load() {
    setLoading(true)
    const [{ data: categoriesData }, { data: piecesData }, { data: ecrituresData }, { data: immobilisationsData }, { data: lignesData }] = await Promise.all([
      supabase.from('categories').select('*').or(`dossier_id.eq.${dossierId},dossier_id.is.null`).order('ordre'),
      supabase.from('pieces').select('*').eq('dossier_id', dossierId).eq('statut', 'validee'),
      supabase.from('ecritures_brouillon').select('*').eq('dossier_id', dossierId).order('date', { ascending: false }),
      supabase.from('immobilisations').select('piece_id').eq('dossier_id', dossierId),
      supabase.from('lignes_bancaires').select('*').eq('dossier_id', dossierId).eq('statut', 'rapprochee').not('piece_id', 'is', null),
    ])
    setLignesBancaires(lignesData ?? [])
    setCategories(categoriesData ?? [])
    setPieces(piecesData ?? [])
    setEcritures(ecrituresData ?? [])
    setImmobilisationPieceIds(new Set((immobilisationsData ?? []).map((i) => i.piece_id).filter((id): id is string => !!id)))
    setLoading(false)
  }

  useEffect(() => { load() }, [dossierId])

  const categorieById = (id: string | null) => categories.find((c) => c.id === id) ?? null

  // Catégories utilisées par au moins une pièce validée mais sans compte associé — impossible de
  // générer l'écriture correspondante tant que ce n'est pas renseigné.
  const categoriesSansCompte = categories.filter(
    (c) => !c.compte_comptable && pieces.some((p) => p.categorie_id === c.id),
  )

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
      const rows = enAttente.flatMap((p) => {
        const cat = categorieById(p.categorie_id)!
        const sens = p.type_piece === 'vente' ? 'credit' : 'debit'
        const libelle = p.tiers ?? p.nom_fichier
        const date = p.date_piece ?? p.created_at.slice(0, 10)
        const base = { dossier_id: dossierId, piece_id: p.id, date, libelle, sens, statut: 'proposee' }

        // Une TVA connue sur la pièce se sépare en deux lignes (montant HT + TVA) plutôt qu'un seul
        // montant TTC — sinon on perd l'information au moment où l'expert-comptable en a le plus besoin.
        if (p.montant_tva && p.montant_tva > 0) {
          const montantHt = p.montant_ht ?? p.montant_ttc! - p.montant_tva
          return [
            { ...base, compte: cat.compte_comptable!, montant: montantHt },
            { ...base, compte: p.type_piece === 'vente' ? COMPTE_TVA_COLLECTEE : COMPTE_TVA_DEDUCTIBLE, montant: p.montant_tva },
          ]
        }

        return [{ ...base, compte: cat.compte_comptable!, montant: p.montant_ttc! }]
      })
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

  // Une écriture sans sa ligne de contrepartie banque (voir lib/ecritures.ts) n'est encore qu'une
  // demi-partie — pas grave en soi (la pièce n'est peut-être pas encore rapprochée dans Banque), mais
  // utile à signaler plutôt que de laisser croire que le brouillon est complet.
  const piecesParGroupe = new Map<string, EcritureBrouillon[]>()
  for (const e of ecrituresFiltrees) {
    if (!e.piece_id) continue
    piecesParGroupe.set(e.piece_id, [...(piecesParGroupe.get(e.piece_id) ?? []), e])
  }
  const nbSansContrepartie = [...piecesParGroupe.values()].filter((rows) => !rows.some((r) => r.compte === COMPTE_BANQUE)).length

  // Sur un dossier assujetti, une pièce validée sans TVA renseignée est plus probablement un oubli
  // de saisie qu'une vraie absence de TVA — signalé pour vérification, jamais corrigé tout seul.
  const piecesSansTva = assujettiTva ? pieces.filter((p) => p.montant_ttc != null && !p.montant_tva) : []

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

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <p className="muted" style={{ margin: 0 }}>
          {ecritures.length} écriture{ecritures.length > 1 ? 's' : ''} proposée{ecritures.length > 1 ? 's' : ''}
          {enAttente.length > 0 && ` — ${enAttente.length} pièce${enAttente.length > 1 ? 's' : ''} en attente de génération`}
          {nbSansContrepartie > 0 && (
            <> — <span className="badge badge-warning">{nbSansContrepartie} en attente de rapprochement bancaire</span></>
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
