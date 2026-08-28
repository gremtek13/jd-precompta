import { useEffect, useState, type ChangeEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, slugify } from '../../lib/format'
import type { CategorieDocument, DocumentDivers, SousDossier } from '../../lib/types'

const LABEL_CATEGORIE: Record<CategorieDocument, string> = {
  releve_bancaire: 'Relevé bancaire',
  cotisation: 'Appel de cotisation',
  attestation: 'Attestation / certificat',
  autre: 'Autre',
}

// Palier 5+ — archive des documents qui ne sont ni des pièces d'achat/vente ni des lignes bancaires :
// relevés de compte, attestations, appels de cotisation avant rattachement à une échéance (voir
// CotisationsTab). Alimentée automatiquement par la classification de l'import en masse
// (ImportDossierModal) — reclassable et complétable ici à la main.
export default function DocumentsTab({ dossierId }: { dossierId: string }) {
  const [documents, setDocuments] = useState<DocumentDivers[]>([])
  const [sousDossiers, setSousDossiers] = useState<SousDossier[]>([])
  const [loading, setLoading] = useState(true)
  const [categorieFilter, setCategorieFilter] = useState<'toutes' | CategorieDocument>('toutes')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const [{ data: documentsData }, { data: sousDossiersData }] = await Promise.all([
      supabase.from('documents_divers').select('*').eq('dossier_id', dossierId).order('created_at', { ascending: false }),
      supabase.from('sous_dossiers').select('*').eq('dossier_id', dossierId).order('ordre').order('nom'),
    ])
    setDocuments(documentsData ?? [])
    setSousDossiers(sousDossiersData ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [dossierId])

  const filtered = documents.filter((d) => categorieFilter === 'toutes' || d.categorie === categorieFilter)
  const sousDossierLabel = (id: string | null) => sousDossiers.find((s) => s.id === id)?.nom ?? '—'

  async function changerCategorie(doc: DocumentDivers, categorie: CategorieDocument) {
    await supabase.from('documents_divers').update({ categorie }).eq('id', doc.id)
    load()
  }

  async function voir(storagePath: string) {
    const { data, error: signError } = await supabase.storage.from('pieces').createSignedUrl(storagePath, 300)
    if (signError || !data) {
      window.alert('Aperçu indisponible.')
      return
    }
    window.open(data.signedUrl, '_blank')
  }

  async function supprimer(doc: DocumentDivers) {
    if (!window.confirm(`Supprimer définitivement "${doc.nom_fichier}" ?`)) return
    await supabase.from('documents_divers').delete().eq('id', doc.id)
    await supabase.storage.from('pieces').remove([doc.storage_path]).catch(() => {})
    load()
  }

  // Bascule vers l'onglet Pièces un document mal classé (une vraie facture passée à tort en document
  // divers) — recrée une pièce à partir du même fichier déjà en storage, à compléter/extraire ensuite
  // comme n'importe quelle autre pièce.
  async function convertirEnPiece(doc: DocumentDivers) {
    const { data: userData } = await supabase.auth.getUser()
    const { error: insertError } = await supabase.from('pieces').insert({
      dossier_id: dossierId,
      uploaded_by: userData.user!.id,
      storage_path: doc.storage_path,
      nom_fichier: doc.nom_fichier,
      sous_dossier_id: doc.sous_dossier_id,
      type_piece: 'achat',
      statut: 'a_valider',
    })
    if (insertError) {
      setError(insertError.message)
      return
    }
    await supabase.from('documents_divers').delete().eq('id', doc.id)
    load()
  }

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
        categorie: 'autre',
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

  return (
    <>
      <p className="muted" style={{ marginTop: -8, marginBottom: 20 }}>
        Relevés bancaires, attestations, appels de cotisation — les documents classés automatiquement
        lors d'un import en masse atterrissent ici plutôt que dans Pièces, faute de montant HT/TVA/TTC à
        faire vérifier. Reclasse ou convertis en pièce si le tri automatique s'est trompé ; un appel de
        cotisation se rattache à une échéance depuis l'onglet Cotisations.
      </p>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className={`btn btn-sm ${categorieFilter === 'toutes' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setCategorieFilter('toutes')}>
            Toutes
          </button>
          {(Object.keys(LABEL_CATEGORIE) as CategorieDocument[]).map((c) => (
            <button key={c} className={`btn btn-sm ${categorieFilter === c ? 'btn-primary' : 'btn-outline'}`} onClick={() => setCategorieFilter(c)}>
              {LABEL_CATEGORIE[c]}
            </button>
          ))}
        </div>
        <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer' }}>
          {uploading ? 'Envoi…' : '+ Ajouter un document'}
          <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} disabled={uploading} onChange={handleUpload} />
        </label>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="card table-scroll" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : filtered.length === 0 ? (
          <div className="empty-state">Aucun document.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Fichier</th>
                <th>Catégorie</th>
                <th>Sous-dossier</th>
                <th>Ajouté le</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.id}>
                  <td>
                    <a href="#" onClick={(e) => { e.preventDefault(); voir(d.storage_path) }}>{d.nom_fichier}</a>
                    {d.attached_to_cotisation_id && <span className="badge badge-ok" style={{ marginLeft: 8 }}>Rattaché à une échéance</span>}
                  </td>
                  <td>
                    <select
                      style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '4px 6px' }}
                      value={d.categorie}
                      onChange={(e) => changerCategorie(d, e.target.value as CategorieDocument)}
                    >
                      {(Object.keys(LABEL_CATEGORIE) as CategorieDocument[]).map((c) => (
                        <option key={c} value={c}>{LABEL_CATEGORIE[c]}</option>
                      ))}
                    </select>
                  </td>
                  <td>{sousDossierLabel(d.sous_dossier_id)}</td>
                  <td>{formatDate(d.created_at)}</td>
                  <td style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-outline btn-sm" onClick={() => convertirEnPiece(d)}>C'est une facture</button>
                    <button className="btn btn-danger btn-sm" onClick={() => supprimer(d)}>Supprimer</button>
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
