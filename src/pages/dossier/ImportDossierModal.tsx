import { useState, type ChangeEvent, type CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { slugify } from '../../lib/format'
import { extractPiece, hashFichier } from '../../lib/extraction'
import type { CategorieDocument, SousDossier } from '../../lib/types'

type StatutFichier = 'attente' | 'upload' | 'extraction' | 'ok' | 'doublon' | 'erreur'

interface FichierImport {
  file: File
  // Chemin de sous-dossier, dossier racine sélectionné inclus (sans le nom de fichier), ex.
  // "facturation 2023 / Transmedical". Jamais vide : au minimum le nom du dossier sélectionné.
  cheminDossier: string
  statut: StatutFichier
  message?: string
}

const EXTENSIONS_SUPPORTEES = ['pdf', 'jpg', 'jpeg', 'png']

function extensionDe(nom: string): string {
  return nom.toLowerCase().split('.').pop() ?? ''
}

// Un fichier réel (export sans suffixe, renommage manuel...) peut ne pas avoir d'extension du tout —
// dans ce cas .split('.').pop() renvoie le nom entier, qui ne matche jamais la liste supportée et le
// fichier serait ignoré à tort même si c'est bien un PDF/JPEG/PNG valide. On regarde la signature des
// premiers octets avant de rejeter, plutôt que de se fier uniquement au nom.
async function sniffeSignature(file: File): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  const estPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 // %PDF
  const estJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  const estPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  return estPdf || estJpeg || estPng
}

async function estFichierSupporte(file: File): Promise<boolean> {
  if (EXTENSIONS_SUPPORTEES.includes(extensionDe(file.name))) return true
  return sniffeSignature(file)
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

const LABEL_CLASSIFICATION: Record<CategorieDocument, string> = {
  releve_bancaire: 'Relevé bancaire',
  cotisation: 'Appel de cotisation',
  attestation: 'Attestation',
  autre: 'Autre',
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

  // Empreintes déjà présentes dans ce dossier (Pièces + Documents) — sert à ignorer un fichier déjà
  // importé plutôt que de le dupliquer, ex. si l'import est relancé sur un dossier déjà traité ou si
  // deux sous-dossiers sélectionnés se recoupent. Comparaison par contenu, pas par nom de fichier :
  // un nom peut se répéter sans être le même document (ou l'inverse, après un renommage).
  async function chargerHashsExistants(): Promise<Set<string>> {
    const [{ data: piecesHash }, { data: documentsHash }] = await Promise.all([
      supabase.from('pieces').select('storage_hash').eq('dossier_id', dossierId).not('storage_hash', 'is', null),
      supabase.from('documents_divers').select('storage_hash').eq('dossier_id', dossierId).not('storage_hash', 'is', null),
    ])
    const hashs = new Set<string>()
    for (const p of piecesHash ?? []) if (p.storage_hash) hashs.add(p.storage_hash)
    for (const d of documentsHash ?? []) if (d.storage_hash) hashs.add(d.storage_hash)
    return hashs
  }

  async function lancerImport() {
    setRunning(true)
    setDone(false)
    try {
      const sousDossierParChemin = await resoudreSousDossiers()
      const hashsConnus = await chargerHashsExistants()
      const { data: userData } = await supabase.auth.getUser()

      for (let i = 0; i < fichiers.length; i++) {
        const { file, cheminDossier } = fichiers[i]
        try {
          const hash = await hashFichier(file)
          if (hashsConnus.has(hash)) {
            setStatutFichier(i, 'doublon', 'Déjà importée — ignorée')
            continue
          }
          // Ajouté tout de suite, pas seulement après l'insertion réussie : évite aussi un doublon
          // entre deux fichiers identiques du même lot (même pièce présente dans deux sous-dossiers).
          hashsConnus.add(hash)

          setStatutFichier(i, 'upload')
          const path = `${dossierId}/${Date.now()}-${slugify(file.name)}`
          const { error: uploadError } = await supabase.storage.from('pieces').upload(path, file)
          if (uploadError) throw uploadError

          setStatutFichier(i, 'extraction')
          // L'extraction peut échouer pièce par pièce (page illisible, format refusé...) sans faire
          // échouer l'import : le fichier est quand même archivé, à compléter à la main ensuite. Sans
          // extraction, on ne peut pas savoir si c'est une facture ou autre chose — on part du principe
          // que c'en est une (voir classifieDocument côté extract-piece, même repli par défaut).
          const extraction = await extractPiece(file, file.name).catch(() => null)
          const sousDossierId = sousDossierParChemin.get(cheminDossier) ?? null

          if (extraction && extraction.classification !== 'facture') {
            // Pas une facture : relevé bancaire, appel de cotisation ou attestation — archivé dans
            // Documents plutôt que dans Pièces, faute de montant HT/TVA/TTC à faire vérifier.
            const { error: insertError } = await supabase.from('documents_divers').insert({
              dossier_id: dossierId,
              sous_dossier_id: sousDossierId,
              storage_path: path,
              storage_hash: hash,
              nom_fichier: file.name,
              categorie: extraction.classification as CategorieDocument,
            })
            if (insertError) throw insertError
            setStatutFichier(i, 'ok', `Classé « ${LABEL_CLASSIFICATION[extraction.classification]} » → Documents`)
            continue
          }

          const { error: insertError } = await supabase.from('pieces').insert({
            dossier_id: dossierId,
            uploaded_by: userData.user!.id,
            storage_path: path,
            storage_hash: hash,
            nom_fichier: file.name,
            sous_dossier_id: sousDossierId,
            type_piece: 'achat',
            statut: 'a_valider',
            date_piece: extraction?.date_piece ?? null,
            tiers: extraction?.tiers ?? null,
            montant_ht: extraction?.montant_ht ?? null,
            montant_tva: extraction?.montant_tva ?? null,
            montant_ttc: extraction?.montant_ttc ?? null,
          })
          if (insertError) throw insertError

          setStatutFichier(i, 'ok', extraction ? undefined : 'Importé — extraction à refaire à la main')
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
        <p className="muted" style={{ marginTop: -8 }}>
          Sélectionne le dossier de fichiers racine sur ton ordinateur. Chaque sous-dossier de fichiers
          devient un sous-dossier ici ; chaque PDF/JPG/PNG passe automatiquement par l'extraction, qui
          trie aussi le document : une facture atterrit dans Pièces (à vérifier avant validation, comme
          d'habitude), un relevé bancaire / appel de cotisation / attestation atterrit dans l'onglet
          Documents — reclassable à la main si le tri automatique s'est trompé. Un fichier déjà importé
          dans ce dossier (même contenu, même si le nom a changé) est repéré et ignoré, pas dupliqué.
        </p>

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
