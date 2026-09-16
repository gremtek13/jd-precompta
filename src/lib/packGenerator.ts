import JSZip from 'jszip'
import ExcelJS from 'exceljs'
import { supabase } from './supabase'
import { nomUnique, slugify } from './format'
import type { Categorie, Piece } from './types'

const FOLDER_BY_TYPE: Record<string, string> = {
  achat: '01_Achats',
  vente: '02_Ventes',
  note_frais: '03_Notes_de_frais',
  autre: '04_Autres',
}

// Racine et extension séparées : le nom final est décidé par `nommerPieces`, qui doit pouvoir
// insérer un suffixe avant l'extension. `lastIndexOf` et non `split('.').pop()`, qui rend le nom
// entier quand il n'y a pas de point — un fichier nommé « scan » serait devenu « ….scan ».
function pieceFileName(p: Piece): { racine: string; extension: string } {
  const point = p.nom_fichier.lastIndexOf('.')
  const ext = point > 0 ? p.nom_fichier.slice(point + 1).toLowerCase() : 'pdf'
  const tiers = slugify(p.tiers ?? 'Inconnu')
  const montant = p.montant_ttc != null ? `${p.montant_ttc.toFixed(2)}€` : 'montant_inconnu'
  const date = p.date_piece ?? 'sans_date'
  return { racine: `${date}_${tiers}_${montant}`, extension: `.${ext}` }
}

// Un nom de fichier par pièce, unique dans tout le pack, décidé une fois pour toutes avant d'écrire
// quoi que ce soit — l'archive et le récapitulatif doivent désigner le même fichier.
//
// Le nom ne tient qu'à la date, au tiers et au montant : deux pièces qui partagent les trois
// portaient le même, et JSZip écrase la précédente sans rien dire (vérifié par exécution). Le cas
// n'a rien de théorique dès qu'un fournisseur récurrent facture le même montant le même jour —
// livraisons multiples, péages, carburant. L'Excel les listait toutes et le total les comptait
// toutes, pendant que l'archive n'en gardait qu'une.
//
// L'unicité est établie sur le pack entier, pas seulement sur le sous-dossier de type : c'est la
// colonne « Fichier » du récapitulatif qui doit rester sans ambiguïté, et elle ne dit pas le type.
function nommerPieces(pieces: Piece[]): Map<string, string> {
  const utilises = new Set<string>()
  return new Map(pieces.map((p) => {
    const { racine, extension } = pieceFileName(p)
    return [p.id, nomUnique(racine, extension, utilises)]
  }))
}

// Équivalent de XLSX.utils.json_to_sheet (xlsx) avec exceljs : une ligne d'en-têtes d'après les clés
// du premier objet, puis une ligne par entrée dans le même ordre. Ne fait rien de plus — pas de mise
// en forme, comme l'ancien export.
function ajouterFeuille<T extends Record<string, unknown>>(wb: ExcelJS.Workbook, nom: string, rows: T[]): void {
  const feuille = wb.addWorksheet(nom)
  if (rows.length === 0) return
  const entetes = Object.keys(rows[0])
  feuille.addRow(entetes)
  for (const row of rows) feuille.addRow(entetes.map((e) => row[e]))
}

interface RemplissageResult {
  nbPieces: number
  totalTtc: number
  excelBlob: Blob
  // Pièces listées dans l'Excel mais dont le fichier n'a pas pu être téléchargé, donc absentes du
  // ZIP. Remontée jusqu'à l'écran : sans elle, le comptable recevait un récapitulatif annonçant
  // N pièces pour X € avec moins de fichiers dans l'archive, sans que rien ne le signale.
  manquantes: string[]
  // Pièces validées sans date : elles n'entrent dans aucune période, donc dans aucun pack. Remontée
  // pour la même raison — un manque tu qui ne se voit qu'en recomptant les pièces du dossier.
  sansDate: string[]
}

// Remplit `destination` (le zip lui-même, ou un sous-dossier obtenu via zip.folder(...) — même API
// JSZip dans les deux cas) avec les pièces validées d'un dossier sur une période, plus son Excel
// récapitulatif — extrait de generatePack pour être réutilisé tel quel par l'export multi-dossiers
// d'un cabinet entier (voir lib/exportCabinet.ts), qui répète juste cet appel une fois par dossier
// dans un sous-dossier du même zip plutôt que de générer un pack séparé par dossier.
async function remplirZipDossier(
  destination: JSZip,
  dossierId: string,
  periodeDebut: string,
  periodeFin: string,
): Promise<RemplissageResult> {
  const { data: piecesData, error: piecesError } = await supabase
    .from('pieces')
    .select('*')
    .eq('dossier_id', dossierId)
    .gte('date_piece', periodeDebut)
    .lte('date_piece', periodeFin)
  if (piecesError) throw piecesError

  // Erreur vérifiée : sans catégories, `categorieLabel` retomberait sur « — » pour toutes les lignes
  // et le résumé par catégorie n'aurait plus qu'une seule entrée — un récapitulatif silencieusement
  // vidé de son classement, envoyé tel quel au comptable.
  const { data: categoriesData, error: categoriesError } = await supabase
    .from('categories')
    .select('*')
    .or(`dossier_id.eq.${dossierId},dossier_id.is.null`)
  if (categoriesError) throw categoriesError

  const categories = (categoriesData ?? []) as Categorie[]
  const categorieLabel = (id: string | null) => categories.find((c) => c.id === id)?.libelle ?? '—'

  // Une pièce validée sans date n'appartient à aucune période : le filtre `gte`/`lte` ci-dessus
  // écarte les NULL (une comparaison SQL avec NULL n'est jamais vraie), si bien qu'elle est absente
  // de *tous* les packs — du ZIP, du récapitulatif et du total — sans que rien ne le signale. Un
  // dossier réel en comptait 18 sur 22, pour 1 697,39 €, invisibles à la génération comme au
  // comptable qui la reçoit. On ne peut pas la rattacher à cette période pour autant : elle est
  // recensée à part, pour que le manque soit dit et qu'on puisse lui donner une date.
  const { data: sansDateData, error: sansDateError } = await supabase
    .from('pieces')
    .select('*')
    .eq('dossier_id', dossierId)
    .eq('statut', 'validee')
    .is('date_piece', null)
  if (sansDateError) throw sansDateError
  const sansDate = (sansDateData ?? []) as Piece[]

  const allPieces = (piecesData ?? []) as Piece[]
  const included = allPieces.filter((p) => p.statut === 'validee')
  const pending = allPieces.filter((p) => p.statut === 'a_valider')

  // --- ZIP : pièces classées par type ---
  const piecesFolder = destination.folder('Pieces')!
  const nomDeLaPiece = nommerPieces(included)
  const manquantes: string[] = []
  for (const p of included) {
    const { data: blob, error } = await supabase.storage.from('pieces').download(p.storage_path)
    // Une pièce introuvable ne fait pas échouer tout le pack — mais elle n'est plus passée sous
    // silence : elle est recensée, écrite dans l'Excel et remontée à l'appelant.
    if (error || !blob) {
      manquantes.push(nomDeLaPiece.get(p.id)!)
      continue
    }
    const folder = piecesFolder.folder(FOLDER_BY_TYPE[p.type_piece] ?? '04_Autres')!
    folder.file(nomDeLaPiece.get(p.id)!, blob)
  }

  // --- Excel récapitulatif ---
  const recapRows: { Date: string; Tiers: string; Type: string; Catégorie: string; 'Montant HT': number | string; TVA: number | string; 'Montant TTC': number | string; Fichier: string }[] = included.map((p) => ({
    Date: p.date_piece ?? '',
    Tiers: p.tiers ?? '',
    Type: p.type_piece,
    Catégorie: categorieLabel(p.categorie_id),
    'Montant HT': p.montant_ht ?? '',
    TVA: p.montant_tva ?? '',
    'Montant TTC': p.montant_ttc ?? '',
    Fichier: nomDeLaPiece.get(p.id)!,
  }))
  const totalTtc = included.reduce((sum, p) => sum + (p.montant_ttc ?? 0), 0)
  recapRows.push({
    Date: '', Tiers: '', Type: '', Catégorie: 'TOTAL',
    'Montant HT': '', TVA: '', 'Montant TTC': totalTtc, Fichier: '',
  })

  const parCategorie = new Map<string, number>()
  for (const p of included) {
    const label = categorieLabel(p.categorie_id)
    parCategorie.set(label, (parCategorie.get(label) ?? 0) + (p.montant_ttc ?? 0))
  }
  const resumeRows = [...parCategorie.entries()].map(([categorie, total]) => ({ Catégorie: categorie, 'Total TTC': total }))

  const wb = new ExcelJS.Workbook()
  ajouterFeuille(wb, 'Récap', recapRows)
  ajouterFeuille(wb, 'Résumé par catégorie', resumeRows)
  if (pending.length > 0) {
    const pendingRows = pending.map((p) => ({
      Date: p.date_piece ?? '', Tiers: p.tiers ?? '', Fichier: p.nom_fichier,
      Statut: 'À valider — non inclus dans ce pack',
    }))
    ajouterFeuille(wb, 'Pièces à valider', pendingRows)
  }

  // Écrite avant l'Excel lui-même : le récapitulatif doit porter la trace des fichiers absents,
  // c'est lui que le comptable lit, pas l'écran de celui qui a généré le pack.
  if (manquantes.length > 0) {
    ajouterFeuille(wb, 'Pièces manquantes', manquantes.map((fichier) => ({
      Fichier: fichier,
      Statut: "Listée dans le récapitulatif mais absente de l'archive — fichier introuvable au moment de la génération",
    })))
  }

  // Même principe que la feuille ci-dessus : ce qui manque au livrable est écrit dans le livrable.
  // Ces pièces-là ne manquent pas à cette période en particulier, elles manquent à toutes.
  if (sansDate.length > 0) {
    ajouterFeuille(wb, 'Pièces sans date', sansDate.map((p) => ({
      Tiers: p.tiers ?? '', Fichier: p.nom_fichier, 'Montant TTC': p.montant_ttc ?? '',
      Statut: "Validée mais sans date : rattachable à aucune période, donc absente de ce pack comme de tous les autres. Lui donner une date pour qu'elle y entre.",
    })))
  }

  const excelBuffer = await wb.xlsx.writeBuffer()
  const excelBlob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  // Le buffer, pas le Blob : JSZip accepte les deux dans un navigateur, mais seul le buffer partout
  // (il lui faut un FileReader pour un Blob, absent de Node — ce qui rendait ce chemin inexécutable
  // en test). Le Blob reste utile tel quel pour l'envoi séparé vers Storage.
  destination.file('Recap.xlsx', excelBuffer)

  return {
    nbPieces: included.length, totalTtc, excelBlob, manquantes,
    sansDate: sansDate.map((p) => `${p.tiers ?? 'Tiers inconnu'} — ${p.nom_fichier}`),
  }
}

interface GenerateResult {
  nbPieces: number
  totalTtc: number
  storagePathZip: string
  storagePathExcel: string
  manquantes: string[]
  sansDate: string[]
}

export async function generatePack(
  dossierId: string,
  dossierNom: string,
  periodeDebut: string,
  periodeFin: string,
): Promise<GenerateResult> {
  const zip = new JSZip()
  const { nbPieces, totalTtc, excelBlob, manquantes, sansDate } = await remplirZipDossier(zip, dossierId, periodeDebut, periodeFin)
  const zipBlob = await zip.generateAsync({ type: 'blob' })

  const basePath = `${dossierId}/${periodeDebut}_${periodeFin}-${Date.now()}`
  const zipPath = `${basePath}/Pack_${slugify(dossierNom)}_${periodeDebut}_${periodeFin}.zip`
  const excelPath = `${basePath}/Recap.xlsx`

  const { error: zipUploadError } = await supabase.storage.from('packs').upload(zipPath, zipBlob)
  if (zipUploadError) throw zipUploadError
  const { error: excelUploadError } = await supabase.storage.from('packs').upload(excelPath, excelBlob)
  if (excelUploadError) throw excelUploadError

  return { nbPieces, totalTtc, storagePathZip: zipPath, storagePathExcel: excelPath, manquantes, sansDate }
}

// Exporté pour lib/exportCabinet.ts — même remplissage, mais dans un sous-dossier d'un zip partagé
// entre plusieurs dossiers plutôt qu'un zip dédié uploadé sur Storage.
export { remplirZipDossier }
