import { useState, type ChangeEvent, type CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { chargerHashsExistants, estFichierSupporte, importerFichierDossier } from '../../lib/importFichiers'
import type { SousDossier } from '../../lib/types'

type StatutFichier = 'attente' | 'upload' | 'extraction' | 'ok' | 'doublon' | 'erreur'

interface FichierImport {
  file: File
  // Chemin de sous-dossier, dossier racine sélectionné inclus (sans le nom de fichier), ex.
  // "facturation 2023 / Transmedical". Jamais vide : au minimum le nom du dossier sélectionné.
  cheminDossier: string
  statut: StatutFichier
  message?: string
}

// webkitRelativePath ressemble à "DossierChoisi/2023/Achats/facture1.pdf" : le dernier segment est le
// nom du fichier, tout le reste (dossier racine sélectionné inclus) devient le chemin de sous-dossier
// — un sous_dossiers étant une table plate (pas d'arborescence), plusieurs niveaux sont aplatis en un
// seul nom. Le dossier racine est gardé (pas juste les niveaux en dessous) : si l'utilisateur importe
// directement un dossier précis (ex. sélectionner "Transmedical" plutôt qu'un gros dossier parent),
// c'est ce nom-là qui doit devenir le sous-dossier, pas être perdu.
function cheminSousDossier(relativePath: string): string {
  const segments = relativePath.split('/')
  return segments.slice(0, -1).join(' / ')
}

interface Props {
  dossierId: string
  sousDossiers: SousDossier[]
  onClose: () => void
  onImported: () => void
}

// Import en masse d'un dossier de fichiers complet : sélection d'une arborescence locale, création
// automatique des sous-dossiers manquants d'après la structure de fichiers, puis upload + extraction
// OCR séquentielle de chaque pièce (une par une — Textract a des quotas de débit, et ça permet un
// suivi de progression lisible plutôt qu'un mur d'attente). Chaque pièce arrive en statut "à valider" :
// l'extraction automatique reste à vérifier avant validation, comme pour un ajout à l'unité.
export default function ImportDossierModal({ dossierId, sousDossiers, onClose, onImported }: Props) {
  const [fichiers, setFichiers] = useState<FichierImport[]>([])
  const [ignores, setIgnores] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)

  async function handleFolderChange(e: ChangeEvent<HTMLInputElement>) {
    const liste = Array.from(e.target.files ?? [])
    const retenus: FichierImport[] = []
    const rejetes: string[] = []
    for (const file of liste) {
      const relatif = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
      if (!(await estFichierSupporte(file))) {
        rejetes.push(relatif)
        continue
      }
      retenus.push({ file, cheminDossier: cheminSousDossier(relatif), statut: 'attente' })
    }
    setFichiers(retenus)
    setIgnores(rejetes)
    setDone(false)
  }

  async function resoudreSousDossiers(): Promise<Map<string, string>> {
    const cheminsNecessaires = [...new Set(fichiers.map((f) => f.cheminDossier).filter(Boolean))]
    const map = new Map<string, string>()
    for (const s of sousDossiers) map.set(s.nom, s.id)
    for (const chemin of cheminsNecessaires) {
      if (map.has(chemin)) continue
      const { data, error } = await supabase.from('sous_dossiers').insert({ dossier_id: dossierId, nom: chemin }).select().single()
      if (error) throw error
      map.set(chemin, data.id)
    }
    return map
  }

  function setStatutFichier(index: number, statut: StatutFichier, message?: string) {
    setFichiers((prev) => prev.map((f, i) => (i === index ? { ...f, statut, message } : f)))
  }

  async function lancerImport() {
    setRunning(true)
    setDone(false)
    try {
      const sousDossierParChemin = await resoudreSousDossiers()
      const hashsConnus = await chargerHashsExistants(dossierId)
      const { data: userData } = await supabase.auth.getUser()

      for (let i = 0; i < fichiers.length; i++) {
        const { file, cheminDossier } = fichiers[i]
        try {
          const resultat = await importerFichierDossier({
            dossierId,
            file,
            sousDossierId: sousDossierParChemin.get(cheminDossier) ?? null,
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

  return (
    <div style={overlayStyle}>
      <div className="card" style={{ width: 'min(640px, 92vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0 }}>Importer un dossier complet</h2>
        <p className="muted" style={{ marginTop: -8, marginBottom: 4 }}>
          Sélectionne le dossier de fichiers racine sur ton ordinateur — chaque sous-dossier devient
          un sous-dossier ici, chaque fichier est trié et extrait automatiquement.
        </p>
        <details className="muted" style={{ marginBottom: 14 }}>
          <summary style={{ cursor: 'pointer' }}>En savoir plus</summary>
          <p style={{ marginTop: 6, marginBottom: 0 }}>
            Chaque PDF/JPG/PNG passe par l'extraction, qui trie aussi le document : une facture
            atterrit dans Pièces (à vérifier avant validation, comme d'habitude), un relevé bancaire /
            appel de cotisation / attestation atterrit dans l'onglet Documents — reclassable à la main
            si le tri automatique s'est trompé. Un CSV est classé directement en relevé bancaire
            (Textract ne sait pas le lire), à importer ensuite depuis l'onglet Banque. Un fichier déjà
            importé dans ce dossier (même contenu, même si le nom a changé) est repéré et ignoré, pas
            dupliqué.
          </p>
        </details>

        {fichiers.length === 0 && (
          <div className="field">
            <label htmlFor="dossier">Dossier</label>
            <input
              id="dossier"
              type="file"
              multiple
              {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
              onChange={handleFolderChange}
            />
          </div>
        )}

        {fichiers.length > 0 && (
          <>
            <p className="muted" style={{ marginTop: -4 }}>
              {fichiers.length} fichier(s) à importer
              {ignores.length > 0 && ` — ${ignores.length} ignoré(s) (format non pris en charge)`}
              {done && ` — ${nbOk} importé(s), ${nbDoublons} déjà importé(s), ${nbErreur} en erreur`}
            </p>

            <div className="table-scroll" style={{ maxHeight: 320, border: '1px solid var(--color-border)', borderRadius: 8 }}>
              <table>
                <thead>
                  <tr><th>Fichier</th><th>Sous-dossier</th><th>Statut</th></tr>
                </thead>
                <tbody>
                  {fichiers.map((f, i) => (
                    <tr key={i}>
                      <td>{f.file.name}</td>
                      <td>{f.cheminDossier || '—'}</td>
                      <td>
                        {f.statut === 'attente' && <span className="muted">En attente</span>}
                        {f.statut === 'upload' && <span className="badge badge-neutral">Envoi…</span>}
                        {f.statut === 'extraction' && <span className="badge badge-neutral">Extraction…</span>}
                        {f.statut === 'ok' && <span className="badge badge-ok">{f.message ?? 'Importé'}</span>}
                        {f.statut === 'doublon' && <span className="badge badge-neutral">{f.message}</span>}
                        {f.statut === 'erreur' && <span className="badge badge-danger">{f.message ?? 'Erreur'}</span>}
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
          {fichiers.length > 0 && !done && (
            <button type="button" className="btn btn-primary" disabled={running} onClick={lancerImport}>
              {running ? 'Import en cours…' : `Importer ${fichiers.length} fichier(s)`}
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
