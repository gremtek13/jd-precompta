import { useState, type ChangeEvent, type CSSProperties, type DragEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { chargerHashsExistants, estFichierSupporte, importerFichierDossier } from '../../lib/importFichiers'
import type { SousDossier } from '../../lib/types'

type StatutFichier = 'attente' | 'upload' | 'extraction' | 'ok' | 'doublon' | 'erreur'

interface FichierAjout {
  file: File
  statut: StatutFichier
  message?: string
}

interface Props {
  dossierId: string
  sousDossiers: SousDossier[]
  onClose: () => void
  onImported: () => void
}

// Point d'entrée unique pour ajouter un ou plusieurs fichiers à un dossier — ouvert aussi bien depuis
// l'onglet Pièces que depuis Documents (voir PiecesTab, DocumentsTab). Inutile de savoir à l'avance si
// un fichier est une facture ou un relevé/attestation avant de choisir le bon onglet : chaque fichier
// est trié automatiquement, comme pour l'import en masse (voir lib/importFichiers), qu'on l'ait déposé
// depuis l'un ou l'autre écran.
export default function AjouterDocumentsModal({ dossierId, sousDossiers, onClose, onImported }: Props) {
  const [fichiers, setFichiers] = useState<FichierAjout[]>([])
  const [nbIgnores, setNbIgnores] = useState(0)
  const [sousDossierId, setSousDossierId] = useState('')
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  async function ajouterFichiers(liste: FileList | File[]) {
    const acceptes: FichierAjout[] = []
    let ignores = 0
    for (const file of Array.from(liste)) {
      if (await estFichierSupporte(file)) acceptes.push({ file, statut: 'attente' })
      else ignores++
    }
    setFichiers((prev) => [...prev, ...acceptes])
    if (ignores > 0) setNbIgnores((prev) => prev + ignores)
    setDone(false)
  }

  function handleFileInput(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files) ajouterFichiers(e.target.files)
    e.target.value = ''
  }

  function handleDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length > 0) ajouterFichiers(e.dataTransfer.files)
  }

  function retirer(index: number) {
    setFichiers((prev) => prev.filter((_, i) => i !== index))
  }

  function setStatutFichier(index: number, statut: StatutFichier, message?: string) {
    setFichiers((prev) => prev.map((f, i) => (i === index ? { ...f, statut, message } : f)))
  }

  async function lancerImport() {
    setRunning(true)
    setDone(false)
    try {
      const hashsConnus = await chargerHashsExistants(dossierId)
      const { data: userData } = await supabase.auth.getUser()

      for (let i = 0; i < fichiers.length; i++) {
        try {
          const resultat = await importerFichierDossier({
            dossierId,
            file: fichiers[i].file,
            sousDossierId: sousDossierId || null,
            hashsConnus,
            userId: userData.user!.id,
            onProgress: (phase) => setStatutFichier(i, phase),
          })
          setStatutFichier(i, resultat.statut, resultat.message)
        } catch (err) {
          setStatutFichier(i, 'erreur', err instanceof Error ? err.message : "Échec de l'import")
        }
      }
    } finally {
      setRunning(false)
      setDone(true)
      onImported()
    }
  }

  const nbOk = fichiers.filter((f) => f.statut === 'ok').length
  const nbDoublons = fichiers.filter((f) => f.statut === 'doublon').length
  const nbErreur = fichiers.filter((f) => f.statut === 'erreur').length
  const peutImporter = fichiers.some((f) => f.statut === 'attente')

  return (
    <div style={overlayStyle}>
      <div className="card" style={{ width: 'min(560px, 92vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0 }}>Ajouter des documents</h2>
        <p className="muted" style={{ marginTop: -8 }}>
          Dépose une ou plusieurs pièces, photos, relevés ou attestations — chaque fichier est trié
          automatiquement : une facture atterrit dans Pièces (à vérifier avant validation), un relevé
          bancaire, un appel de cotisation ou une attestation atterrit dans Documents. Un fichier déjà
          présent dans ce dossier (même contenu, même si le nom a changé) est repéré et ignoré, pas
          dupliqué.
        </p>

        {!running && (
          <div className="field">
            <label htmlFor="sous-dossier-ajout">Sous-dossier (optionnel, appliqué à tout le lot)</label>
            <select id="sous-dossier-ajout" value={sousDossierId} onChange={(e) => setSousDossierId(e.target.value)}>
              <option value="">— Aucun —</option>
              {sousDossiers.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
            </select>
          </div>
        )}

        {!running && !done && (
          <label
            className="dropzone"
            data-dragover={dragOver || undefined}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            📎 Dépose des fichiers ici, ou clique pour choisir (PDF, JPG, PNG, CSV)
            <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.csv" style={{ display: 'none' }} onChange={handleFileInput} />
          </label>
        )}

        {fichiers.length > 0 && (
          <>
            <p className="muted" style={{ marginTop: 12, marginBottom: 4 }}>
              {fichiers.length} fichier(s)
              {nbIgnores > 0 && ` — ${nbIgnores} ignoré(s) (format non pris en charge)`}
              {done && ` — ${nbOk} importé(s), ${nbDoublons} déjà présent(s), ${nbErreur} en erreur`}
            </p>

            <div className="table-scroll" style={{ maxHeight: 280, border: '1px solid var(--color-border)', borderRadius: 8 }}>
              <table>
                <thead>
                  <tr><th>Fichier</th><th>Statut</th><th></th></tr>
                </thead>
                <tbody>
                  {fichiers.map((f, i) => (
                    <tr key={i}>
                      <td>{f.file.name}</td>
                      <td>
                        {f.statut === 'attente' && <span className="muted">En attente</span>}
                        {f.statut === 'upload' && <span className="badge badge-neutral">Envoi…</span>}
                        {f.statut === 'extraction' && <span className="badge badge-neutral">Extraction…</span>}
                        {f.statut === 'ok' && <span className="badge badge-ok">{f.message ?? 'Importé'}</span>}
                        {f.statut === 'doublon' && <span className="badge badge-neutral">{f.message}</span>}
                        {f.statut === 'erreur' && <span className="badge badge-danger">{f.message ?? 'Erreur'}</span>}
                      </td>
                      <td style={{ width: 36 }}>
                        {f.statut === 'attente' && (
                          <button type="button" className="btn btn-outline btn-sm" title="Retirer" onClick={() => retirer(i)}>✕</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn btn-outline" disabled={running} onClick={onClose}>
            {done ? 'Fermer' : 'Annuler'}
          </button>
          {peutImporter && !running && (
            <button type="button" className="btn btn-primary" onClick={lancerImport}>
              Importer {fichiers.length} fichier(s)
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
}
