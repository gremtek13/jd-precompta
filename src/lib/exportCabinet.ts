import JSZip from 'jszip'
import { supabase } from './supabase'
import { slugify } from './format'
import { remplirZipDossier } from './packGenerator'

function telechargerBlob(nomFichier: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomFichier
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export interface ResultatExportCabinet {
  nbDossiers: number
  nbPiecesTotal: number
}

// Export global d'un cabinet (voir SuperAdminPage, "Comptes master") — un seul ZIP téléchargé
// directement dans le navigateur, un sous-dossier par dossier client, chacun rempli exactement comme
// un pack individuel (voir packGenerator.remplirZipDossier) sur toute son histoire (2000-01-01 à
// aujourd'hui, même plage que l'export "avant suppression" d'un dossier seul). Jamais uploadé sur
// Storage ni enregistré dans `packs` — ce n'est pas un pack au sens de l'appli, juste un export
// ponctuel, notamment utile avant de vider un cabinet en vue de sa suppression (voir delete-cabinet,
// qui refuse tant que le cabinet a encore des dossiers).
export async function genererExportCabinet(
  cabinetId: string,
  cabinetNom: string,
  onProgression?: (fait: number, total: number, dossierNom: string) => void,
): Promise<ResultatExportCabinet> {
  const { data: dossiersData, error: dossiersError } = await supabase
    .from('dossiers')
    .select('id, nom')
    .eq('cabinet_id', cabinetId)
    .order('nom')
  if (dossiersError) throw dossiersError
  const dossiers = (dossiersData ?? []) as { id: string; nom: string }[]

  const zip = new JSZip()
  const periodeDebut = '2000-01-01'
  const periodeFin = new Date().toISOString().slice(0, 10)
  let nbPiecesTotal = 0

  // Séquentiel plutôt que Promise.all : chaque dossier télécharge potentiellement des dizaines de
  // fichiers depuis Storage — un cabinet avec beaucoup de dossiers exportés tous en parallèle
  // risquerait de saturer la connexion, sans intérêt pour un export ponctuel et rare par nature.
  let fait = 0
  for (const dossier of dossiers) {
    onProgression?.(fait, dossiers.length, dossier.nom)
    const sousDossier = zip.folder(slugify(dossier.nom) || dossier.id)!
    const { nbPieces } = await remplirZipDossier(sousDossier, dossier.id, periodeDebut, periodeFin)
    nbPiecesTotal += nbPieces
    fait += 1
  }
  onProgression?.(fait, dossiers.length, '')

  const zipBlob = await zip.generateAsync({ type: 'blob' })
  telechargerBlob(`Export_${slugify(cabinetNom)}_${periodeFin}.zip`, zipBlob)

  return { nbDossiers: dossiers.length, nbPiecesTotal }
}
