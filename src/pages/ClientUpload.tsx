import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatDate, slugify } from '../lib/format'
import type { Piece } from '../lib/types'

export default function ClientUpload() {
  const { dossierIds } = useAuth()
  const dossierId = dossierIds[0] // un client n'a en général qu'un seul dossier
  const [pieces, setPieces] = useState<Piece[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    if (!dossierId) return
    const { data } = await supabase
      .from('pieces')
      .select('*')
      .eq('dossier_id', dossierId)
      .order('created_at', { ascending: false })
    setPieces(data ?? [])
  }

  useEffect(() => { load() }, [dossierId])

  async function handleUpload() {
    if (!file || !dossierId) return
    setUploading(true)
    setError(null)
    try {
      const path = `${dossierId}/${Date.now()}-${slugify(file.name)}`
      const { error: uploadError } = await supabase.storage.from('pieces').upload(path, file)
      if (uploadError) throw uploadError

      const { data: userData } = await supabase.auth.getUser()
      const { error: insertError } = await supabase.from('pieces').insert({
        dossier_id: dossierId,
        uploaded_by: userData.user!.id,
        storage_path: path,
        nom_fichier: file.name,
        statut: 'a_valider',
      })
      if (insertError) throw insertError

      setFile(null)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "L'envoi a échoué.")
    } finally {
      setUploading(false)
    }
  }

  if (!dossierId) {
    return <p className="muted">Aucun dossier ne t'est encore rattaché — contacte JD Consult.</p>
  }

  return (
    <>
      <div className="topbar"><h1>Mes pièces</h1></div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Déposer une facture, un reçu ou une note de frais</h3>
        <div className="field">
          <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn-primary" onClick={handleUpload} disabled={!file || uploading}>
          {uploading ? 'Envoi…' : 'Envoyer'}
        </button>
      </div>

      <h3>Mes dépôts</h3>
      <div className="card" style={{ padding: 0 }}>
        {pieces.length === 0 ? (
          <div className="empty-state">Aucun dépôt pour l'instant.</div>
        ) : (
          <table>
            <thead><tr><th>Fichier</th><th>Déposé le</th><th>Statut</th></tr></thead>
            <tbody>
              {pieces.map((p) => (
                <tr key={p.id}>
                  <td>{p.nom_fichier}</td>
                  <td>{formatDate(p.created_at)}</td>
                  <td>
                    {p.statut === 'validee'
                      ? <span className="badge badge-ok">Traitée</span>
                      : <span className="badge badge-neutral">En attente de traitement</span>}
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
