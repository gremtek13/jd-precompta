import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatMoney, slugify } from '../../lib/format'
import type { CotisationDeclaree, DocumentDivers } from '../../lib/types'
import BrouillonBanner from '../../components/BrouillonBanner'

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
  const [uploading, setUploading] = useState(false)

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
      })
      if (insertError) throw insertError
      setEcheance('')
      setMontantAppele('')
      setMontantVerse('')
      setMontantCsgCrds('')
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
  // Catégorie forcée à "cotisation" (contexte de l'onglet), pas de sous-dossier ni de classification
  // automatique — un simple ajout à l'unité, attachable ensuite à une échéance ci-dessous.
  async function handleUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError(null)
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    } finally {
      setUploading(false)
      e.target.value = ''
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

  const totalAppele = cotisations.reduce((sum, c) => sum + c.montant_appele, 0)
  const totalVerse = cotisations.reduce((sum, c) => sum + (c.montant_verse ?? 0), 0)
  const totalCsgDeductible = cotisations.reduce((sum, c) => sum + (csgDeductible(c.montant_csg_crds) ?? 0), 0)

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
          Utile pour les papiers des années précédentes : dépose-le ici directement, il apparaît ensuite
          dans le sélecteur "Pièce jointe" ci-dessous pour l'attacher à une échéance.
        </p>
      </div>

      {cotisations.length > 0 && (
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
        ) : cotisations.length === 0 ? (
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
              {cotisations.map((c) => {
                const documentAttache = documentsCotisation.find((d) => d.attached_to_cotisation_id === c.id)
                const documentsDisponibles = documentsCotisation.filter((d) => !d.attached_to_cotisation_id)
                return (
                  <tr key={c.id}>
                    <td>{formatDate(c.echeance)}</td>
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
