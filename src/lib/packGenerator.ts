import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { supabase } from './supabase'
import { slugify } from './format'
import type { Categorie, Piece } from './types'

const FOLDER_BY_TYPE: Record<string, string> = {
  achat: '01_Achats',
  vente: '02_Ventes',
  note_frais: '03_Notes_de_frais',
  autre: '04_Autres',
}

function pieceFileName(p: Piece): string {
  const ext = (p.nom_fichier.split('.').pop() ?? 'pdf').toLowerCase()
  const tiers = slugify(p.tiers ?? 'Inconnu')
  const montant = p.montant_ttc != null ? `${p.montant_ttc.toFixed(2)}€` : 'montant_inconnu'
  const date = p.date_piece ?? 'sans_date'
  return `${date}_${tiers}_${montant}.${ext}`
}

interface GenerateResult {
  nbPieces: number
  totalTtc: number
  storagePathZip: string
  storagePathExcel: string
}

export async function generatePack(
  dossierId: string,
  dossierNom: string,
  periodeDebut: string,
  periodeFin: string,
): Promise<GenerateResult> {
  const { data: piecesData, error: piecesError } = await supabase
    .from('pieces')
    .select('*')
    .eq('dossier_id', dossierId)
    .gte('date_piece', periodeDebut)
    .lte('date_piece', periodeFin)
  if (piecesError) throw piecesError

  const { data: categoriesData } = await supabase
    .from('categories')
    .select('*')
    .or(`dossier_id.eq.${dossierId},dossier_id.is.null`)

  const categories = (categoriesData ?? []) as Categorie[]
  const categorieLabel = (id: string | null) => categories.find((c) => c.id === id)?.libelle ?? '—'

  const allPieces = (piecesData ?? []) as Piece[]
  const included = allPieces.filter((p) => p.statut === 'validee')
  const pending = allPieces.filter((p) => p.statut === 'a_valider')

  // --- ZIP : pièces classées par type ---
  const zip = new JSZip()
  const piecesFolder = zip.folder('Pieces')!
  for (const p of included) {
    const { data: blob, error } = await supabase.storage.from('pieces').download(p.storage_path)
    if (error || !blob) continue // pièce introuvable : on continue plutôt que de faire échouer tout le pack
    const folder = piecesFolder.folder(FOLDER_BY_TYPE[p.type_piece] ?? '04_Autres')!
    folder.file(pieceFileName(p), blob)
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
    Fichier: pieceFileName(p),
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

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(recapRows), 'Récap')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumeRows), 'Résumé par catégorie')
  if (pending.length > 0) {
    const pendingRows = pending.map((p) => ({
      Date: p.date_piece ?? '', Tiers: p.tiers ?? '', Fichier: p.nom_fichier,
      Statut: 'À valider — non inclus dans ce pack',
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pendingRows), 'Pièces à valider')
  }

  const excelBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const excelBlob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  zip.file('Recap.xlsx', excelBlob)

  const zipBlob = await zip.generateAsync({ type: 'blob' })

  const basePath = `${dossierId}/${periodeDebut}_${periodeFin}-${Date.now()}`
  const zipPath = `${basePath}/Pack_${slugify(dossierNom)}_${periodeDebut}_${periodeFin}.zip`
  const excelPath = `${basePath}/Recap.xlsx`

  const { error: zipUploadError } = await supabase.storage.from('packs').upload(zipPath, zipBlob)
  if (zipUploadError) throw zipUploadError
  const { error: excelUploadError } = await supabase.storage.from('packs').upload(excelPath, excelBlob)
  if (excelUploadError) throw excelUploadError

  return { nbPieces: included.length, totalTtc, storagePathZip: zipPath, storagePathExcel: excelPath }
}
