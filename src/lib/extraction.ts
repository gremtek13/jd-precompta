import { supabase } from './supabase'

export interface ExtractionResult {
  tiers: string | null
  date_piece: string | null
  montant_ht: number | null
  montant_tva: number | null
  montant_ttc: number | null
  confiance: 'haute' | 'moyenne' | 'basse'
  error?: string
  // Diagnostic temporaire — uniquement présent quand la fonction n'a pas réussi à trouver la TVA
  // par aucune méthode, pour voir le texte OCR brut plutôt que deviner un nouveau motif à l'aveugle.
  _lignes_brutes?: string[]
}

// Textract n'accepte que JPEG/PNG/PDF(1 page)/TIFF. Une photo de téléphone peut être en HEIC en
// interne malgré un nom en .jpeg, ou avoir des particularités (profil couleur, etc.) que Textract
// refuse. On la redécode systématiquement en JPEG standard côté navigateur avant l'envoi — les PDF
// passent tels quels, Textract les gère nativement.
export async function normalizeForExtraction(source: Blob, name: string): Promise<Blob> {
  const isPdf = source.type === 'application/pdf' || name.toLowerCase().endsWith('.pdf')
  if (isPdf) return source

  try {
    const bitmap = await createImageBitmap(source)
    const maxSide = 2400
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas indisponible.')
    ctx.drawImage(bitmap, 0, 0, w, h)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Conversion JPEG impossible.'))), 'image/jpeg', 0.9)
    )
  } catch {
    // Format non décodable par le navigateur : on envoie tel quel, Textract tranchera.
    return source
  }
}

// Point d'entrée partagé entre la saisie d'une pièce (PieceFormModal) et l'import en masse d'un
// dossier de fichiers (ImportDossierModal) — même normalisation, même appel à la fonction Edge.
export async function extractPiece(source: Blob, name: string): Promise<ExtractionResult> {
  const normalized = await normalizeForExtraction(source, name)
  const bytes = await normalized.arrayBuffer()

  const { data: result, error } = await supabase.functions.invoke<ExtractionResult>('extract-piece', { body: bytes })
  if (error) throw error
  if (!result || result.error) throw new Error(result?.error ?? "L'extraction a échoué.")
  return result
}
