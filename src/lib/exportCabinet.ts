import JSZip from 'jszip'
import { supabase } from './supabase'
import { aujourdHuiSql, nomUnique, slugify } from './format'
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
  // Fichiers listés dans les récapitulatifs mais absents de l'archive (voir packGenerator) —
  // préfixés du nom du dossier, un export de cabinet en couvrant plusieurs.
  manquantes: string[]
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
  // Calendrier civil et non UTC : un export lancé peu après minuit s'arrêterait sinon la veille,
  // excluant les pièces du jour et datant le fichier d'hier.
  const periodeFin = aujourdHuiSql()
  let nbPiecesTotal = 0
  const manquantes: string[] = []

  // Séquentiel plutôt que Promise.all : chaque dossier télécharge potentiellement des dizaines de
  // fichiers depuis Storage — un cabinet avec beaucoup de dossiers exportés tous en parallèle
  // risquerait de saturer la connexion, sans intérêt pour un export ponctuel et rare par nature.
  let fait = 0
  // `slugify` retire les accents et réduit toute ponctuation à « _ » : « Café Martin » et
  // « Cafe Martin », ou « Dupont & Fils » et « Dupont Fils », donnent le même nom de dossier. Deux
  // appels à `zip.folder()` sur ce nom ne lèvent rien — ils pointent le même chemin, si bien que les
  // deux dossiers se mélangeaient et que le second `Recap.xlsx` écrasait le premier. Sur un export
  // fait justement avant de vider un cabinet, c'était la dernière copie des données qui y passait.
  const nomsUtilises = new Set<string>()
  for (const dossier of dossiers) {
    onProgression?.(fait, dossiers.length, dossier.nom)
    const sousDossier = zip.folder(nomUnique(slugify(dossier.nom) || dossier.id, '', nomsUtilises))!
    const resultat = await remplirZipDossier(sousDossier, dossier.id, periodeDebut, periodeFin)
    nbPiecesTotal += resultat.nbPieces
    manquantes.push(...resultat.manquantes.map((f) => `${dossier.nom} / ${f}`))
    fait += 1
  }
  onProgression?.(fait, dossiers.length, '')

  const zipBlob = await zip.generateAsync({ type: 'blob' })
  telechargerBlob(`Export_${slugify(cabinetNom)}_${periodeFin}.zip`, zipBlob)

  return { nbDossiers: dossiers.length, nbPiecesTotal, manquantes }
}
