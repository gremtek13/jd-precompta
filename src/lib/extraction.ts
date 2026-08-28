import { supabase } from './supabase'

// Classification automatique du document, déduite du texte OCR brut (voir extract-piece) — permet de
// router un import en masse vers Pièces (facture) ou vers l'archive Documents (le reste), sans coût
// Textract supplémentaire puisqu'elle réutilise le texte déjà extrait pour la ventilation TVA.
export type ClassificationDocument = 'releve_bancaire' | 'cotisation' | 'attestation' | 'facture'

export interface ExtractionResult {
  tiers: string | null
  date_piece: string | null
  montant_ht: number | null
  montant_tva: number | null
  montant_ttc: number | null
  confiance: 'haute' | 'moyenne' | 'basse'
  classification: ClassificationDocument
  // Lecture best-effort d'une ancienne déclaration 2035 (recettes, charges sociales personnelles) —
  // sert à préremplir un repère annuel dans l'onglet Estimation, jamais à enregistrer automatiquement.
  // Moins fiable que le reste de l'extraction (formulaire administratif dense, pas une facture) :
  // toujours vérifié par l'utilisateur contre le document avant sauvegarde.
  lecture_2035: {
    recettes: number | null
    charges_sociales_personnelles: number | null
    // Jamais calculé — uniquement lu sur un chiffre déjà officiellement déclaré (comme le CA et les
    // cotisations). Reste null tant que le motif de recherche n'est pas confirmé sur un cas réel (le
    // formulaire a 4 zones Bénéfice/Déficit différentes selon la nature du résultat).
    resultat: number | null
    // Diagnostic temporaire — le contexte autour de chaque libellé trouvé, pour ajuster le motif de
    // recherche sur un cas réel plutôt qu'à l'aveugle. À retirer une fois confirmé.
    _diag_2035?: string[]
    _diag_resultat?: string[]
  }
  // Lecture best-effort d'un avis d'appel de cotisation (URSSAF/CARPIMKO) — un tel document n'a pas
  // "un montant + une date" mais un échéancier de plusieurs mensualités. Toujours à confirmer par
  // l'utilisateur avant de créer les échéances proposées.
  lecture_cotisation: {
    echeances: { date: string; montant: number }[]
    _diag_cotisation?: string[]
  }
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

// Empreinte du contenu exact du fichier (SHA-256) — sert à détecter un doublon (même fichier importé
// deux fois, ex. import relancé sur un dossier déjà traité, ou deux sous-dossiers qui se recoupent)
// sans dépendre du nom de fichier, qui peut varier ou se répéter sans que ce soit le même document.
export async function hashFichier(source: Blob): Promise<string> {
  const bytes = await source.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
