import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { formatMoney } from '../../lib/format'
import { extractPiece } from '../../lib/extraction'
import type { Categorie, CotisationDeclaree, Piece, ReferenceAnnuelle, ReferencePosteAnnuel } from '../../lib/types'

const ANNEE_COURANTE = new Date().getFullYear()

// Palier 6 — estimation indicative des charges sociales de l'année en cours, pour que le client ne
// découvre pas un gros appel de cotisation en fin d'année. Volontairement limitée aux charges
// sociales (URSSAF/CARPIMKO) : une estimation d'impôt sur le revenu dépendrait du foyer fiscal entier
// (hors du champ de ce dossier) et se rapprocherait bien plus du conseil fiscal — hors de portée d'un
// brouillon de précomptabilité. Simulateur officiel des impôts déjà disponible pour ce volet.
export default function EstimationTab({ dossierId }: { dossierId: string }) {
  const [cotisations, setCotisations] = useState<CotisationDeclaree[]>([])
  const [pieces, setPieces] = useState<Piece[]>([])
  const [piecesToutes, setPiecesToutes] = useState<Piece[]>([])
  const [categories, setCategories] = useState<Categorie[]>([])
  const [immobilisationPieceIds, setImmobilisationPieceIds] = useState<Set<string>>(new Set())
  const [references, setReferences] = useState<ReferenceAnnuelle[]>([])
  const [referencesPostes, setReferencesPostes] = useState<ReferencePosteAnnuel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [calculating, setCalculating] = useState(false)
  const [calculatingPostes, setCalculatingPostes] = useState(false)
  const [savingPoste, setSavingPoste] = useState(false)
  const [anneePoste, setAnneePoste] = useState(String(ANNEE_COURANTE - 1))
  const [libellePoste, setLibellePoste] = useState('')
  const [montantPoste, setMontantPoste] = useState('')
  const [lecture2035Loading, setLecture2035Loading] = useState(false)
  const [lecture2035Error, setLecture2035Error] = useState<string | null>(null)
  const [lecture2035Diag, setLecture2035Diag] = useState<string[] | undefined>(undefined)

  const [anneeSaisie, setAnneeSaisie] = useState(String(ANNEE_COURANTE - 1))
  const [caSaisi, setCaSaisi] = useState('')
  const [cotisationsSaisies, setCotisationsSaisies] = useState('')
  const [anneeACalculer, setAnneeACalculer] = useState(String(ANNEE_COURANTE - 1))

  async function load() {
    setLoading(true)
    const [
      { data: cotisationsData },
      { data: piecesData },
      { data: piecesToutesData },
      { data: categoriesData },
      { data: immobilisationsData },
      { data: referencesData },
      { data: referencesPostesData },
    ] = await Promise.all([
      supabase.from('cotisations_declarees').select('*').eq('dossier_id', dossierId),
      supabase.from('pieces').select('*').eq('dossier_id', dossierId).eq('statut', 'validee').eq('type_piece', 'vente'),
      supabase.from('pieces').select('*').eq('dossier_id', dossierId).eq('statut', 'validee'),
      supabase.from('categories').select('*').or(`dossier_id.eq.${dossierId},dossier_id.is.null`),
      supabase.from('immobilisations').select('piece_id').eq('dossier_id', dossierId),
      supabase.from('references_annuelles').select('*').eq('dossier_id', dossierId).order('annee', { ascending: false }),
      supabase.from('references_postes_annuels').select('*').eq('dossier_id', dossierId).order('annee', { ascending: false }).order('poste'),
    ])
    setCotisations(cotisationsData ?? [])
    setPieces(piecesData ?? [])
    setPiecesToutes(piecesToutesData ?? [])
    setCategories(categoriesData ?? [])
    setImmobilisationPieceIds(new Set((immobilisationsData ?? []).map((i) => i.piece_id).filter((id): id is string => !!id)))
    setReferences(referencesData ?? [])
    setReferencesPostes(referencesPostesData ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [dossierId])

  function totauxPourAnnee(annee: number) {
    const ca = pieces
      .filter((p) => p.date_piece?.startsWith(String(annee)))
      .reduce((sum, p) => sum + (p.montant_ht ?? p.montant_ttc ?? 0), 0)
    const cotis = cotisations
      .filter((c) => c.echeance.startsWith(String(annee)))
      .reduce((sum, c) => sum + (c.montant_verse ?? c.montant_appele), 0)
    return { ca, cotis }
  }

  // Règle usuelle simple : ce qui est déjà là cette année, ramené à 12 mois au prorata des mois déjà
  // entamés. Pas de lissage saisonnier ni de logique de régularisation URSSAF (calcul provisionnel
  // réel bien plus complexe) — juste un repère pour anticiper, pas un calcul officiel.
  const moisEcoules = new Date().getMonth() + 1
  const { ca: caAnneeEnCours, cotis: cotisationsAnneeEnCours } = totauxPourAnnee(ANNEE_COURANTE)
  const caProjete = (caAnneeEnCours * 12) / moisEcoules
  const cotisationsProjetees = (cotisationsAnneeEnCours * 12) / moisEcoules

  const referenceN1 = references.find((r) => r.annee === ANNEE_COURANTE - 1) ?? null

  function ecartPct(valeurN: number, valeurN1: number | null): string {
    if (!valeurN1) return '—'
    return `${valeurN >= valeurN1 ? '+' : ''}${(((valeurN - valeurN1) / valeurN1) * 100).toFixed(0)} %`
  }

  // Préremplit le formulaire de saisie manuelle depuis une ancienne 2035 (PDF) plutôt que d'obliger à
  // ressaisir les chiffres à la main — jamais un enregistrement automatique, juste un préremplissage
  // que l'utilisateur vérifie et complète avant de cliquer sur "Enregistrer ce repère". Moins fiable
  // que le reste de l'extraction (formulaire administratif dense), d'où l'avertissement affiché.
  async function importerDepuis2035(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLecture2035Loading(true)
    setLecture2035Error(null)
    setLecture2035Diag(undefined)
    try {
      const result = await extractPiece(file, file.name)
      const { recettes, charges_sociales_personnelles: cotisations, _diag_2035 } = result.lecture_2035
      if (recettes != null) setCaSaisi(String(recettes))
      if (cotisations != null) setCotisationsSaisies(String(cotisations))
      if (recettes == null && cotisations == null) {
        setLecture2035Error("Aucun montant reconnu automatiquement sur ce document — vérifie et complète les champs à la main ci-dessous.")
      }
      if (_diag_2035) setLecture2035Diag(_diag_2035)
    } catch (err) {
      setLecture2035Error(err instanceof Error ? err.message : "L'extraction a échoué — saisis les montants à la main.")
    } finally {
      setLecture2035Loading(false)
      e.target.value = ''
    }
  }

  async function enregistrerReference(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const { error: upsertError } = await supabase.from('references_annuelles').upsert(
        {
          dossier_id: dossierId,
          annee: parseInt(anneeSaisie, 10),
          chiffre_affaires: caSaisi ? parseFloat(caSaisi) : null,
          total_cotisations_sociales: cotisationsSaisies ? parseFloat(cotisationsSaisies) : null,
          source: 'saisie_manuelle',
        },
        { onConflict: 'dossier_id,annee' },
      )
      if (upsertError) throw upsertError
      setCaSaisi('')
      setCotisationsSaisies('')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    } finally {
      setSaving(false)
    }
  }

  async function calculerDepuisAppli() {
    const annee = parseInt(anneeACalculer, 10)
    if (!annee) return
    setCalculating(true)
    setError(null)
    try {
      const { ca, cotis } = totauxPourAnnee(annee)
      const { error: upsertError } = await supabase.from('references_annuelles').upsert(
        {
          dossier_id: dossierId,
          annee,
          chiffre_affaires: ca || null,
          total_cotisations_sociales: cotis || null,
          source: 'calculee',
        },
        { onConflict: 'dossier_id,annee' },
      )
      if (upsertError) throw upsertError
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    } finally {
      setCalculating(false)
    }
  }

  async function supprimerReference(id: string) {
    if (!window.confirm('Retirer ce repère annuel ?')) return
    await supabase.from('references_annuelles').delete().eq('id', id)
    load()
  }

  // Même regroupement par poste_2035 que l'onglet Clôture (catégorie → poste, pièces d'immobilisation
  // exclues pour ne pas compter une dépense capitalisée comme une charge courante en plus) — mais sans
  // les lignes synthétiques amortissements/cotisations de Clôture : ici on ne veut que les postes de
  // charge issus des catégories, les cotisations ayant déjà leur propre repère à côté.
  function totauxParPostePourAnnee(annee: number): Map<string, number> {
    const categorieById = (id: string | null) => categories.find((c) => c.id === id) ?? null
    const totaux = new Map<string, number>()
    for (const p of piecesToutes) {
      if (!p.date_piece?.startsWith(String(annee))) continue
      if (immobilisationPieceIds.has(p.id)) continue
      const cat = categorieById(p.categorie_id)
      if (!cat?.poste_2035) continue
      const montant = p.montant_ht ?? p.montant_ttc ?? 0
      const signe = p.type_piece === 'vente' ? 1 : -1
      totaux.set(cat.poste_2035, (totaux.get(cat.poste_2035) ?? 0) + signe * montant)
    }
    return totaux
  }

  async function calculerPostesDepuisAppli() {
    const annee = parseInt(anneeACalculer, 10)
    if (!annee) return
    setCalculatingPostes(true)
    setError(null)
    try {
      const totaux = totauxParPostePourAnnee(annee)
      if (totaux.size === 0) {
        setError("Aucune pièce avec un poste 2035 renseigné pour cette année — complète d'abord les postes manquants dans l'onglet Clôture.")
        return
      }
      for (const [poste, montant] of totaux) {
        const { error: upsertError } = await supabase.from('references_postes_annuels').upsert(
          { dossier_id: dossierId, annee, poste, montant },
          { onConflict: 'dossier_id,annee,poste' },
        )
        if (upsertError) throw upsertError
      }
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    } finally {
      setCalculatingPostes(false)
    }
  }

  async function enregistrerPoste(e: FormEvent) {
    e.preventDefault()
    if (!libellePoste.trim() || !montantPoste) return
    setSavingPoste(true)
    setError(null)
    try {
      const { error: upsertError } = await supabase.from('references_postes_annuels').upsert(
        {
          dossier_id: dossierId,
          annee: parseInt(anneePoste, 10),
          poste: libellePoste.trim(),
          montant: parseFloat(montantPoste),
        },
        { onConflict: 'dossier_id,annee,poste' },
      )
      if (upsertError) throw upsertError
      setLibellePoste('')
      setMontantPoste('')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    } finally {
      setSavingPoste(false)
    }
  }

  async function supprimerPoste(id: string) {
    if (!window.confirm('Retirer ce poste ?')) return
    await supabase.from('references_postes_annuels').delete().eq('id', id)
    load()
  }

  if (loading) return <p className="muted">Chargement…</p>

  return (
    <>
      <div className="brouillon-banner">
        <strong>Estimation indicative</strong> — une projection pour anticiper, pas un calcul officiel de
        régularisation URSSAF ni un substitut à l'avis de l'expert-comptable. Limitée aux charges
        sociales : pour l'impôt sur le revenu, le simulateur des impôts reste plus fiable (il connaît le
        foyer fiscal entier, que ce dossier ne voit jamais).
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Projection {ANNEE_COURANTE}</h3>
        <p className="muted" style={{ marginTop: -8 }}>
          D'après les {moisEcoules} mois déjà entamés cette année, ramenés à 12 mois — une règle simple,
          pas une prévision fine.
        </p>
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
          <div>
            <span className="muted" style={{ display: 'block' }}>CA encaissé à date</span>
            <strong>{formatMoney(caAnneeEnCours)}</strong>
          </div>
          <div>
            <span className="muted" style={{ display: 'block' }}>CA projeté sur l'année</span>
            <strong>{formatMoney(caProjete)}</strong>
            {referenceN1?.chiffre_affaires != null && (
              <span className="muted" style={{ marginLeft: 8 }}>({ecartPct(caProjete, referenceN1.chiffre_affaires)} vs {ANNEE_COURANTE - 1})</span>
            )}
          </div>
          <div>
            <span className="muted" style={{ display: 'block' }}>Cotisations appelées à date</span>
            <strong>{formatMoney(cotisationsAnneeEnCours)}</strong>
          </div>
          <div>
            <span className="muted" style={{ display: 'block' }}>Cotisations projetées sur l'année</span>
            <strong>{formatMoney(cotisationsProjetees)}</strong>
            {referenceN1?.total_cotisations_sociales != null && (
              <span className="muted" style={{ marginLeft: 8 }}>({ecartPct(cotisationsProjetees, referenceN1.total_cotisations_sociales)} vs {ANNEE_COURANTE - 1})</span>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Repères annuels</h3>
        <p className="muted" style={{ marginTop: -8 }}>
          Sert de comparaison pour la projection ci-dessus. Calcule-le depuis les données déjà dans ce
          dossier si l'année y est en entier, ou saisis les chiffres de la 2035 réellement déposée si ce
          dossier n'a pas (encore) cette année-là.
        </p>

        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="anneeCalc">Année à calculer depuis ce dossier</label>
            <input id="anneeCalc" type="number" style={{ width: 100 }} value={anneeACalculer} onChange={(e) => setAnneeACalculer(e.target.value)} />
          </div>
          <button className="btn btn-outline btn-sm" disabled={calculating} onClick={calculerDepuisAppli}>
            {calculating ? 'Calcul…' : 'Calculer CA + cotisations'}
          </button>
          <button className="btn btn-outline btn-sm" disabled={calculatingPostes} onClick={calculerPostesDepuisAppli}>
            {calculatingPostes ? 'Calcul…' : 'Calculer le détail par poste'}
          </button>
        </div>

        <div className="field" style={{ marginBottom: 16 }}>
          <label htmlFor="lecture2035">Importer depuis une ancienne 2035 (PDF)</label>
          <input id="lecture2035" type="file" accept=".pdf" disabled={lecture2035Loading} onChange={importerDepuis2035} />
          <span className="muted">
            Préremplit le CA et les cotisations ci-dessous — l'extraction sur ce type de formulaire est
            moins fiable que sur une facture (grille administrative dense) : vérifie toujours contre le
            document avant d'enregistrer.
          </span>
        </div>
        {lecture2035Loading && <p className="muted" style={{ marginTop: -8 }}>Lecture en cours…</p>}
        {lecture2035Error && <p className="error-text" style={{ marginTop: -8 }}>{lecture2035Error}</p>}
        {lecture2035Diag && lecture2035Diag.length > 0 && (
          <details style={{ marginTop: -8, marginBottom: 16 }}>
            <summary className="muted" style={{ cursor: 'pointer' }}>Diagnostic (temporaire) — clique pour copier</summary>
            <pre style={{ fontSize: '0.75rem', background: 'var(--color-bg)', padding: 8, borderRadius: 8, overflowX: 'auto', userSelect: 'all' }}>
              {lecture2035Diag.join('\n')}
            </pre>
          </details>
        )}

        <form onSubmit={enregistrerReference}>
          <div className="field-row">
            <div className="field">
              <label htmlFor="annee">Année (saisie manuelle, ex. depuis la 2035)</label>
              <input id="annee" type="number" required value={anneeSaisie} onChange={(e) => setAnneeSaisie(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="caSaisi">Chiffre d'affaires</label>
              <input id="caSaisi" type="number" step="0.01" value={caSaisi} onChange={(e) => setCaSaisi(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="cotisSaisies">Total cotisations sociales</label>
              <input id="cotisSaisies" type="number" step="0.01" value={cotisationsSaisies} onChange={(e) => setCotisationsSaisies(e.target.value)} />
            </div>
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer ce repère'}
          </button>
        </form>
      </div>

      <div className="card table-scroll" style={{ padding: 0 }}>
        {references.length === 0 ? (
          <div className="empty-state">Aucun repère annuel enregistré pour l'instant.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Année</th>
                <th>Chiffre d'affaires</th>
                <th>Cotisations sociales</th>
                <th>Source</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {references.map((r) => (
                <tr key={r.id}>
                  <td>{r.annee}</td>
                  <td>{r.chiffre_affaires != null ? formatMoney(r.chiffre_affaires) : '—'}</td>
                  <td>{r.total_cotisations_sociales != null ? formatMoney(r.total_cotisations_sociales) : '—'}</td>
                  <td>
                    <span className={`badge ${r.source === 'calculee' ? 'badge-ok' : 'badge-neutral'}`}>
                      {r.source === 'calculee' ? 'Calculée' : 'Saisie manuelle'}
                    </span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-danger btn-sm" onClick={() => supprimerReference(r.id)}>Retirer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20, marginTop: 20 }}>
        <h3 style={{ marginTop: 0 }}>Détail par poste (autres charges)</h3>
        <p className="muted" style={{ marginTop: -8 }}>
          Achats, loyer, assurance... — le bouton "Calculer le détail par poste" ci-dessus reprend le
          regroupement par poste 2035 de l'onglet Clôture pour l'année choisie. Sans cette année dans le
          dossier, ajoute les postes à la main depuis la 2035 réelle — pas de lecture automatique ligne
          par ligne pour l'instant, trop de postes à vérifier un par un.
        </p>

        <form onSubmit={enregistrerPoste}>
          <div className="field-row">
            <div className="field">
              <label htmlFor="anneePoste">Année</label>
              <input id="anneePoste" type="number" required style={{ width: 100 }} value={anneePoste} onChange={(e) => setAnneePoste(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="libellePoste">Poste</label>
              <input id="libellePoste" placeholder="ex. Achats, Loyer, Assurance..." required value={libellePoste} onChange={(e) => setLibellePoste(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="montantPoste">Montant</label>
              <input id="montantPoste" type="number" step="0.01" required value={montantPoste} onChange={(e) => setMontantPoste(e.target.value)} />
            </div>
          </div>
          <button className="btn btn-primary btn-sm" type="submit" disabled={savingPoste}>
            {savingPoste ? 'Enregistrement…' : 'Ajouter ce poste'}
          </button>
        </form>
      </div>

      <div className="card table-scroll" style={{ padding: 0 }}>
        {referencesPostes.length === 0 ? (
          <div className="empty-state">Aucun détail par poste enregistré pour l'instant.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Année</th>
                <th>Poste</th>
                <th>Montant</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {referencesPostes.map((r) => (
                <tr key={r.id}>
                  <td>{r.annee}</td>
                  <td>{r.poste}</td>
                  <td>{formatMoney(r.montant)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-danger btn-sm" onClick={() => supprimerPoste(r.id)}>Retirer</button>
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
