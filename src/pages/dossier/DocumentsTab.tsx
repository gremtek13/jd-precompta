import { useEffect, useState, type ChangeEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, slugify } from '../../lib/format'
import { extractPiece, fichierDejaPresent, hashFichier } from '../../lib/extraction'
import type { CategorieDocument, DocumentDivers, SousDossier } from '../../lib/types'
import AnneeTabs, { type ValeurAnnee } from '../../components/AnneeTabs'

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
  const [anneeFilter, setAnneeFilter] = useState<ValeurAnnee>('toutes')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Documents dont l'analyse Textract tourne encore en arrière-plan (voir handleUpload) — juste pour
  // afficher un badge "Analyse…" à la place de la catégorie provisoire, pas pour bloquer quoi que ce soit.
  const [enAnalyse, setEnAnalyse] = useState<Set<string>>(new Set())

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

  // Pas de date propre au document (juste sa date d'ajout dans l'appli) — l'onglet Année filtre donc
  // sur created_at, pas sur la période réelle du document (un vieux relevé déposé aujourd'hui atterrit
  // dans l'année en cours, pas dans l'année qu'il couvre).
  const anneesDisponibles = [...new Set(documents.map((d) => new Date(d.created_at).getFullYear()))].sort((a, b) => b - a)

  const filtered = documents.filter((d) => {
    if (categorieFilter !== 'toutes' && d.categorie !== categorieFilter) return false
    if (anneeFilter !== 'toutes' && new Date(d.created_at).getFullYear() !== anneeFilter) return false
    return true
  })
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

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length && filtered.length > 0) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map((d) => d.id)))
    }
  }

  async function deleteSelection() {
    if (selected.size === 0) return
    if (!window.confirm(`Supprimer définitivement ${selected.size} document(s) ? Cette action est irréversible.`)) return
    for (const id of selected) {
      const doc = documents.find((d) => d.id === id)
      const { error: deleteError } = await supabase.from('documents_divers').delete().eq('id', id)
      if (deleteError) continue
      if (doc?.storage_path) {
        await supabase.storage.from('pieces').remove([doc.storage_path]).catch(() => {})
      }
    }
    setSelected(new Set())
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

  // Un CSV n'est jamais envoyé à Textract (relevés/factures en PDF ou image uniquement) — presque
  // toujours un export de relevé bancaire dans ce contexte, classé directement sur son extension, donc
  // pas besoin d'attendre. Les autres formats passent par Textract, qui peut prendre jusqu'à 50s sur un
  // document multi-pages : le document est créé tout de suite avec une catégorie provisoire ("Autre"),
  // et l'analyse tourne en arrière-plan sans bloquer la suite (déposer un autre fichier, changer
  // d'onglet...) — elle corrige la catégorie toute seule une fois terminée.
  async function handleUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const hash = await hashFichier(file)
      if (await fichierDejaPresent(dossierId, hash)) {
        setError('Ce fichier est déjà présent dans ce dossier (Pièces ou Documents) — pas réajouté.')
        return
      }
      const path = `${dossierId}/documents/${Date.now()}-${slugify(file.name)}`
      const { error: uploadError } = await supabase.storage.from('pieces').upload(path, file)
      if (uploadError) throw uploadError

      const estCsv = file.name.toLowerCase().endsWith('.csv')
      const { data: inserted, error: insertError } = await supabase.from('documents_divers').insert({
        dossier_id: dossierId,
        storage_path: path,
        storage_hash: hash,
        nom_fichier: file.name,
        categorie: estCsv ? 'releve_bancaire' : 'autre',
      }).select().single()
      if (insertError) throw insertError
      load()

      if (!estCsv && inserted) {
        const documentId = inserted.id
        setEnAnalyse((prev) => new Set(prev).add(documentId))
        extractPiece(file, file.name)
          .then(async (extraction) => {
            if (extraction.classification !== 'facture') {
              await supabase.from('documents_divers').update({ categorie: extraction.classification }).eq('id', documentId)
            }
          })
          .catch(() => {}) // best-effort : la catégorie provisoire "Autre" reste, à corriger à la main
          .finally(() => {
            setEnAnalyse((prev) => {
              const next = new Set(prev)
              next.delete(documentId)
              return next
            })
            load()
          })
      }
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

      <AnneeTabs annees={anneesDisponibles} valeur={anneeFilter} onChange={setAnneeFilter} />

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
          {filtered.length > 0 && (
            <button className="btn btn-outline btn-sm" onClick={toggleSelectAll}>
              {selected.size === filtered.length ? 'Tout désélectionner' : 'Tout sélectionner'}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {selected.size > 0 && (
            <button className="btn btn-danger btn-sm" onClick={deleteSelection}>
              Supprimer la sélection ({selected.size})
            </button>
          )}
          <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer' }}>
            {uploading ? 'Envoi…' : '+ Ajouter un document'}
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.csv" style={{ display: 'none' }} disabled={uploading} onChange={handleUpload} />
          </label>
        </div>
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
                <th></th>
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
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggleSelect(d.id)} />
                  </td>
                  <td>
                    <a href="#" onClick={(e) => { e.preventDefault(); voir(d.storage_path) }}>{d.nom_fichier}</a>
                    {d.attached_to_cotisation_id && <span className="badge badge-ok" style={{ marginLeft: 8 }}>Rattaché à une échéance</span>}
                  </td>
                  <td style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <select
                      style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '4px 6px' }}
                      value={d.categorie}
                      onChange={(e) => changerCategorie(d, e.target.value as CategorieDocument)}
                    >
                      {(Object.keys(LABEL_CATEGORIE) as CategorieDocument[]).map((c) => (
                        <option key={c} value={c}>{LABEL_CATEGORIE[c]}</option>
                      ))}
                    </select>
                    {enAnalyse.has(d.id) && <span className="badge badge-neutral">Analyse…</span>}
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
