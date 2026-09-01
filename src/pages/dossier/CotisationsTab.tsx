import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatMoney, slugify } from '../../lib/format'
import { extractPiece } from '../../lib/extraction'
import type { CotisationDeclaree, DocumentDivers } from '../../lib/types'
import BrouillonBanner from '../../components/BrouillonBanner'
import AnneeTabs, { type ValeurAnnee } from '../../components/AnneeTabs'

// Taux CSG-CRDS en vigueur pour les indépendants/professions libérales : 9,70 % au total, dont
// 6,80 points déductibles du revenu imposable et 2,90 points non déductibles. Source : barèmes
// Urssaf.fr — à vérifier périodiquement, ces taux peuvent évoluer d'une année sur l'autre.
const TAUX_CSG_DEDUCTIBLE = 6.8
const TAUX_CSG_CRDS_TOTAL = 9.7

// Palier 5, brique 4 — suivi des cotisations sociales. Saisie manuelle des appels et versements
// URSSAF (montants connus tardivement, jamais déductibles d'un relevé bancaire seul) et calcul
// proposé de la répartition CSG déductible/non déductible — uniquement sur la part CSG-CRDS
// explicitement renseignée, jamais sur le montant appelé total qui cumule d'autres cotisations.
export default function CotisationsTab({ dossierId }: { dossierId: string }) {
  const [cotisations, setCotisations] = useState<CotisationDeclaree[]>([])
  const [documentsCotisation, setDocumentsCotisation] = useState<DocumentDivers[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [echeance, setEcheance] = useState('')
  const [montantAppele, setMontantAppele] = useState('')
  const [montantVerse, setMontantVerse] = useState('')
  const [montantCsgCrds, setMontantCsgCrds] = useState('')
  const [previsionnel, setPrevisionnel] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [echeancesProposees, setEcheancesProposees] = useState<{ date: string; montant: number; previsionnel: boolean }[]>([])
  const [diagCotisation, setDiagCotisation] = useState<string[] | undefined>(undefined)
  const [creantEcheances, setCreantEcheances] = useState(false)
  const [anneeFilter, setAnneeFilter] = useState<ValeurAnnee>('toutes')

  async function load() {
    setLoading(true)
    const [{ data }, { data: documentsData }] = await Promise.all([
      supabase.from('cotisations_declarees').select('*').eq('dossier_id', dossierId).order('echeance', { ascending: false }),
      // Uniquement les appels de cotisation classés dans l'archive Documents (voir DocumentsTab) — le
      // rattachement se fait ici, pas là-bas, pour rester à côté du montant qu'ils justifient.
      supabase.from('documents_divers').select('*').eq('dossier_id', dossierId).eq('categorie', 'cotisation'),
    ])
    setCotisations(data ?? [])
    setDocumentsCotisation(documentsData ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [dossierId])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const { error: insertError } = await supabase.from('cotisations_declarees').insert({
        dossier_id: dossierId,
        echeance,
        montant_appele: parseFloat(montantAppele),
        montant_verse: montantVerse ? parseFloat(montantVerse) : null,
        montant_csg_crds: montantCsgCrds ? parseFloat(montantCsgCrds) : null,
        previsionnel,
      })
      if (insertError) throw insertError
      setEcheance('')
      setMontantAppele('')
      setMontantVerse('')
      setMontantCsgCrds('')
      setPrevisionnel(false)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    } finally {
      setSaving(false)
    }
  }

  async function supprimer(id: string) {
    if (!window.confirm('Retirer cette échéance ?')) return
    await supabase.from('cotisations_declarees').delete().eq('id', id)
    load()
  }

  async function attacherDocument(cotisationId: string, documentId: string) {
    if (!documentId) return
    await supabase.from('documents_divers').update({ attached_to_cotisation_id: cotisationId }).eq('id', documentId)
    load()
  }

  async function detacherDocument(documentId: string) {
    await supabase.from('documents_divers').update({ attached_to_cotisation_id: null }).eq('id', documentId)
    load()
  }

  // Upload direct depuis cet onglet, sans passer par Documents — pratique pour les vieux appels de
  // cotisation (années précédentes) qu'on n'a pas forcément fait passer par un import en masse.
  // Catégorie forcée à "cotisation" (contexte de l'onglet). Passe aussi par l'extraction : un avis
  // d'appel réel a un échéancier de plusieurs mensualités (pas "un montant + une date"), proposées
  // ci-dessous à la création plutôt qu'à ressaisir à la main — jamais créées automatiquement sans
  // confirmation.
  async function handleUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError(null)
    setEcheancesProposees([])
    setDiagCotisation(undefined)
    try {
      const path = `${dossierId}/documents/${Date.now()}-${slugify(file.name)}`
      const { error: uploadError } = await supabase.storage.from('pieces').upload(path, file)
      if (uploadError) throw uploadError
      const { error: insertError } = await supabase.from('documents_divers').insert({
        dossier_id: dossierId,
        storage_path: path,
        nom_fichier: file.name,
        categorie: 'cotisation',
      })
      if (insertError) throw insertError
      load()

      const extraction = await extractPiece(file, file.name).catch(() => null)
      setEcheancesProposees(extraction?.lecture_cotisation.echeances ?? [])
      // Toujours affiché (pas seulement à zéro résultat) : un document peut manquer une partie de ses
      // échéances (ex. l'année suivante) alors que le reste a bien été trouvé — invisible autrement.
      setDiagCotisation(extraction?.lecture_cotisation._diag_cotisation)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  // Une échéance "prévisionnelle" (CARPIMKO, année suivante) déjà créée peut être re-proposée plus
  // tard par l'appel définitif, à la même date mais avec le vrai montant — on corrige alors la ligne
  // existante (montant + retrait du marqueur) plutôt que de créer un doublon. Une échéance déjà
  // définitive n'est en revanche jamais réécrite automatiquement (un montant déjà confirmé/vérifié ne
  // doit pas être silencieusement remplacé).
  async function creerEcheancesProposees() {
    if (echeancesProposees.length === 0) return
    setCreantEcheances(true)
    setError(null)
    try {
      const aInserer = echeancesProposees
        .filter((e) => !cotisations.some((c) => c.echeance === e.date))
        .map((e) => ({ dossier_id: dossierId, echeance: e.date, montant_appele: e.montant, previsionnel: e.previsionnel }))

      const aMettreAJour = echeancesProposees
        .map((e) => ({ e, existante: cotisations.find((c) => c.echeance === e.date) }))
        .filter((x): x is { e: { date: string; montant: number; previsionnel: boolean }; existante: CotisationDeclaree } =>
          !!x.existante?.previsionnel && !x.e.previsionnel,
        )

      if (aInserer.length > 0) {
        const { error: insertError } = await supabase.from('cotisations_declarees').insert(aInserer)
        if (insertError) throw insertError
      }
      for (const { e, existante } of aMettreAJour) {
        const { error: updateError } = await supabase
          .from('cotisations_declarees')
          .update({ montant_appele: e.montant, previsionnel: false })
          .eq('id', existante.id)
        if (updateError) throw updateError
      }

      const ignorees = echeancesProposees.length - aInserer.length - aMettreAJour.length
      setEcheancesProposees([])
      load()
      if (ignorees > 0) {
        window.alert(`${aInserer.length + aMettreAJour.length} échéance(s) prise(s) en compte, ${ignorees} déjà à jour (ignorée(s)).`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    } finally {
      setCreantEcheances(false)
    }
  }

  async function voirDocument(storagePath: string) {
    const { data, error: signError } = await supabase.storage.from('pieces').createSignedUrl(storagePath, 300)
    if (signError || !data) {
      window.alert('Aperçu indisponible.')
      return
    }
    window.open(data.signedUrl, '_blank')
  }

  function csgDeductible(montantCsgCrds: number | null): number | null {
    if (montantCsgCrds == null) return null
    return Number((montantCsgCrds * (TAUX_CSG_DEDUCTIBLE / TAUX_CSG_CRDS_TOTAL)).toFixed(2))
  }

  const documentsNonRattaches = documentsCotisation.filter((d) => !d.attached_to_cotisation_id)

  const anneesDisponibles = [...new Set(cotisations.map((c) => new Date(c.echeance).getFullYear()))].sort((a, b) => b - a)
  const cotisationsFiltrees = anneeFilter === 'toutes' ? cotisations : cotisations.filter((c) => new Date(c.echeance).getFullYear() === anneeFilter)

  const totalAppele = cotisationsFiltrees.reduce((sum, c) => sum + c.montant_appele, 0)
  const totalVerse = cotisationsFiltrees.reduce((sum, c) => sum + (c.montant_verse ?? 0), 0)
  const totalCsgDeductible = cotisationsFiltrees.reduce((sum, c) => sum + (csgDeductible(c.montant_csg_crds) ?? 0), 0)

  return (
    <>
      <BrouillonBanner />

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Ajouter une échéance</h3>
        <form onSubmit={handleSubmit}>
          <div className="field-row">
            <div className="field">
              <label htmlFor="echeance">Échéance</label>
              <input id="echeance" type="date" required value={echeance} onChange={(e) => setEcheance(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="appele">Montant appelé</label>
              <input id="appele" type="number" step="0.01" required value={montantAppele} onChange={(e) => setMontantAppele(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="verse">Montant versé</label>
              <input id="verse" type="number" step="0.01" value={montantVerse} onChange={(e) => setMontantVerse(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="csg">dont CSG-CRDS</label>
              <input id="csg" type="number" step="0.01" value={montantCsgCrds} onChange={(e) => setMontantCsgCrds(e.target.value)} />
            </div>
          </div>
          <p className="muted" style={{ marginTop: -8 }}>
            "dont CSG-CRDS" : uniquement la part CSG-CRDS visible sur le décompte Urssaf, pas le montant
            appelé total — c'est la seule part sur laquelle la déductibilité peut être calculée.
          </p>
          <div className="field">
            <label>
              <input type="checkbox" checked={previsionnel} onChange={(e) => setPrevisionnel(e.target.checked)} style={{ marginRight: 6 }} />
              Prévisionnel (estimation, pas encore un appel définitif)
            </label>
          </div>
          {error && <p className="error-text">{error}</p>}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>
              {saving ? 'Enregistrement…' : 'Ajouter'}
            </button>
            <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer' }}>
              {uploading ? 'Envoi…' : '+ Ajouter un appel de cotisation (PDF/JPG/PNG)'}
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} disabled={uploading} onChange={handleUpload} />
            </label>
          </div>
        </form>
        <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
          Utile pour les papiers des années précédentes : dépose-le ici directement, l'appli essaie d'y
          reconnaître l'échéancier automatiquement — sinon il apparaît dans le sélecteur "Pièce jointe"
          ci-dessous pour l'attacher à une échéance saisie à la main.
        </p>
        {diagCotisation && diagCotisation.length > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary className="muted" style={{ cursor: 'pointer' }}>
              Texte brut lu sur le document (diagnostic, temporaire) — utile si une échéance manque, clique pour copier
            </summary>
            <pre style={{ fontSize: '0.75rem', background: 'var(--color-bg)', padding: 8, borderRadius: 8, overflowX: 'auto', userSelect: 'all' }}>
              {diagCotisation.join('\n')}
            </pre>
          </details>
        )}
      </div>

      {echeancesProposees.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Échéances trouvées sur ce document ({echeancesProposees.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Vérifie avant de créer — rien n'est encore enregistré. Une échéance "Prévisionnel" vient
            d'une section estimée du document (pas encore un appel définitif) — remplacée automatiquement
            si tu déposes plus tard l'appel définitif pour la même date.
          </p>
          <table>
            <thead><tr><th>Échéance</th><th>Montant appelé</th><th>Statut</th></tr></thead>
            <tbody>
              {echeancesProposees.map((e, i) => (
                <tr key={i}>
                  <td>{formatDate(e.date)}</td>
                  <td>{formatMoney(e.montant)}</td>
                  <td>
                    {e.previsionnel
                      ? <span className="badge badge-warning">Prévisionnel</span>
                      : <span className="badge badge-ok">Définitif</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <button className="btn btn-primary btn-sm" disabled={creantEcheances} onClick={creerEcheancesProposees}>
              {creantEcheances ? 'Création…' : `Créer ces ${echeancesProposees.length} échéance(s)`}
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => setEcheancesProposees([])}>Ignorer</button>
          </div>
        </div>
      )}

      {documentsNonRattaches.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Appels de cotisation non rattachés ({documentsNonRattaches.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Déposés mais pas encore attachés à une échéance — crée ou choisis l'échéance correspondante
            dans le tableau ci-dessous, la colonne "Pièce jointe" les propose.
          </p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {documentsNonRattaches.map((d) => (
              <li key={d.id}>
                <a href="#" onClick={(e) => { e.preventDefault(); voirDocument(d.storage_path) }}>{d.nom_fichier}</a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <AnneeTabs annees={anneesDisponibles} valeur={anneeFilter} onChange={setAnneeFilter} />

      {cotisationsFiltrees.length > 0 && (
        <div className="card" style={{ marginBottom: 20, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <span className="muted" style={{ display: 'block' }}>Total appelé</span>
            <strong>{formatMoney(totalAppele)}</strong>
          </div>
          <div>
            <span className="muted" style={{ display: 'block' }}>Total versé</span>
            <strong>{formatMoney(totalVerse)}</strong>
          </div>
          <div>
            <span className="muted" style={{ display: 'block' }}>Reste à verser</span>
            <strong>{formatMoney(totalAppele - totalVerse)}</strong>
          </div>
          <div>
            <span className="muted" style={{ display: 'block' }}>CSG déductible (proposée)</span>
            <strong>{formatMoney(totalCsgDeductible)}</strong>
          </div>
        </div>
      )}

      <div className="card table-scroll" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : cotisationsFiltrees.length === 0 ? (
          <div className="empty-state">Aucune échéance enregistrée pour l'instant.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Échéance</th>
                <th>Appelé</th>
                <th>Versé</th>
                <th>dont CSG-CRDS</th>
                <th>CSG déductible</th>
                <th>Pièce jointe</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {cotisationsFiltrees.map((c) => {
                const documentAttache = documentsCotisation.find((d) => d.attached_to_cotisation_id === c.id)
                const documentsDisponibles = documentsNonRattaches
                return (
                  <tr key={c.id}>
                    <td>
                      {formatDate(c.echeance)}
                      {c.previsionnel && <span className="badge badge-warning" style={{ marginLeft: 8 }}>Prévisionnel</span>}
                    </td>
                    <td>{formatMoney(c.montant_appele)}</td>
                    <td>{c.montant_verse != null ? formatMoney(c.montant_verse) : '—'}</td>
                    <td>{c.montant_csg_crds != null ? formatMoney(c.montant_csg_crds) : '—'}</td>
                    <td>{csgDeductible(c.montant_csg_crds) != null ? formatMoney(csgDeductible(c.montant_csg_crds)) : '—'}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {documentAttache ? (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <a href="#" onClick={(e) => { e.preventDefault(); voirDocument(documentAttache.storage_path) }}>
                            {documentAttache.nom_fichier}
                          </a>
                          <button className="btn btn-outline btn-sm" onClick={() => detacherDocument(documentAttache.id)}>Détacher</button>
                        </span>
                      ) : documentsDisponibles.length > 0 ? (
                        <select
                          style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '4px 6px' }}
                          defaultValue=""
                          onChange={(e) => attacherDocument(c.id, e.target.value)}
                        >
                          <option value="" disabled>Attacher…</option>
                          {documentsDisponibles.map((d) => <option key={d.id} value={d.id}>{d.nom_fichier}</option>)}
                        </select>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button className="btn btn-danger btn-sm" onClick={() => supprimer(c.id)}>Retirer</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
