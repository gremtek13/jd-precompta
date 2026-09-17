import { supabase } from './supabase'
import { extraireErreurFonction } from './invokeErreur'
import type { CategorieDocument, TypePiece } from './types'

// Classification automatique du document, déduite du texte OCR brut (voir extract-piece) — permet de
// router un import en masse vers Pièces (facture) ou vers l'archive Documents (le reste), sans coût
// Textract supplémentaire puisqu'elle réutilise le texte déjà extrait pour la ventilation TVA.
// `autre` couvre les documents qui ne sont ni une facture, ni un relevé bancaire, ni un appel de
// cotisation, ni une attestation : relevés d'activité de l'Assurance Maladie, relevés de situation
// d'épargne. Ils atterrissaient en « facture » par défaut, donc dans les PIÈCES — et le montant lu
// dessus se présentait comme une charge. Voir extract-piece/classifieDocument.
// `facture_vente` est un justificatif de RECETTE (bordereau de télétransmission) : une pièce, comme
// une facture, mais dans l'autre sens.
export type ClassificationDocument =
  | 'releve_bancaire' | 'cotisation' | 'attestation' | 'autre' | 'facture' | 'facture_vente'

// Libellé humain d'une catégorie de document classé automatiquement — partagé entre l'import en masse
// (ImportDossierModal) et l'ajout unifié (AjouterDocumentsModal), voir lib/importFichiers.ts.
export const LABEL_CLASSIFICATION: Record<CategorieDocument, string> = {
  releve_bancaire: 'Relevé bancaire',
  cotisation: 'Appel de cotisation',
  attestation: 'Attestation',
  autre: 'Autre',
}

// Où va un document une fois classé, et sous quelle forme.
//
// Rendue par une seule fonction plutôt que recopiée dans `depot.ts` (dépôt client) et
// `importFichiers.ts` (import cabinet). Ces deux pipelines sont jumeaux assumés (voir leurs en-têtes
// respectifs) et portaient la même règle écrite deux fois : « tout ce qui n'est pas une facture part
// en Documents ». Elle était vraie tant que `facture` était la seule classification qui restait en
// Pièces ; l'arrivée d'un justificatif de recette la rend fausse — et l'aurait rendue fausse des deux
// côtés à la fois, un bordereau de télétransmission atterrissant dans l'archive Documents au lieu
// d'être une recette. Une répartition exhaustive, à un seul endroit, ne peut plus diverger.
export type Orientation =
  | { destination: 'pieces'; type_piece: TypePiece }
  | { destination: 'documents'; categorie: CategorieDocument }

// Quand l'extraction échoue (page illisible, Textract en erreur), on ne sait rien du document : il
// part en Pièces comme un achat, à compléter à la main. Même repli par défaut que `classifieDocument`
// côté extract-piece — une pièce à vérifier vaut mieux qu'un fichier rangé dans une archive où
// personne ne relit les montants.
export const ACHAT_PAR_DEFAUT: Orientation = { destination: 'pieces', type_piece: 'achat' }

export function orientationDe(classification: ClassificationDocument): Orientation {
  // Le type de pièce est décidé ICI et pas par l'appelant : c'est la classification qui sait qu'un
  // bordereau est une recette, et un `type_piece: 'achat'` en dur dans chaque dépôt est précisément
  // ce qui faisait entrer un encaissement dans les charges.
  if (classification === 'facture') return { destination: 'pieces', type_piece: 'achat' }
  if (classification === 'facture_vente') return { destination: 'pieces', type_piece: 'vente' }
  return { destination: 'documents', categorie: classification }
}

export interface ExtractionResult {
  tiers: string | null
  date_piece: string | null
  montant_ht: number | null
  montant_tva: number | null
  montant_ttc: number | null
  confiance: 'haute' | 'moyenne' | 'basse'
  classification: ClassificationDocument
  // Le texte lu sur le document, lignes séparées par des retours à la ligne, dans l'ordre de lecture
  // et sans nettoyage. C'est lui qui dit ce qui a été acheté quand le nom du tiers ne le dit pas —
  // « BOULANGER MARSEILLE » n'est pas une boulangerie. Conservé en base (`piece_textes_ocr`) et
  // affiché à l'arbitrage.
  // Optionnel : une pièce extraite avant l'ajout de ce champ n'en a pas, et la fonction déployée peut
  // être en retard d'une version sur l'application. Un appelant doit traiter l'absence, pas la
  // supposer impossible.
  texte_ocr?: string
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
    // previsionnel : échéance lue dans une section "ÉCHÉANCIER PRÉVISIONNEL" (CARPIMKO) — une
    // estimation pour l'année suivante, pas encore un appel officiel, mais prélevée en pratique dès
    // les premiers mois. Suivie comme les autres (voir CotisationsTab), juste signalée à part.
    echeances: { date: string; montant: number; previsionnel: boolean }[]
    _diag_cotisation?: string[]
  }
  error?: string
  // Diagnostic temporaire — uniquement présent quand la fonction n'a pas réussi à trouver la TVA
  // par aucune méthode, pour voir le texte OCR brut plutôt que deviner un nouveau motif à l'aveugle.
  _lignes_brutes?: string[]
  // Diagnostic de la date : les dates que le repli sur texte OCR a vues sans pouvoir trancher entre
  // elles (voir extract-piece). Présent uniquement quand `date_piece` reste nul — c'est ce qui permet
  // de comprendre un échec sur un document réel plutôt que de deviner un nouveau motif à l'aveugle.
  _diag_dates?: string[]
  // Vrai quand la date ne vient pas d'un libellé reconnu mais de la règle de dernier recours (la
  // première date en ordre de lecture, voir extract-piece). Elle est alors proposée à vérifier
  // plutôt que présentée comme lue — c'est ce qui permet de garder cette règle sans deviner en
  // silence.
  _date_deduite?: boolean
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
  if (error) throw new Error(await extraireErreurFonction(error, "L'extraction a échoué."))
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

// Même détection de doublon que l'import en masse (ImportDossierModal), mais pour un dépôt à l'unité —
// Pièces, Documents et Cotisations n'avaient jamais cette vérification : redéposer deux fois le même
// fichier (ex. en debug) créait deux lignes identiques plutôt que d'être repéré.
//
// Lève si l'une des deux lectures échoue, au lieu de rendre `false`. Un `count` nul est
// indiscernable d'un « aucun doublon trouvé » : une lecture refusée faisait donc répondre « ce
// fichier est nouveau » avec assurance, et créait précisément la ligne en double que cette fonction
// existe pour empêcher. Même piège que la lecture préalable de `contrepartieBanque`.
export async function fichierDejaPresent(dossierId: string, hash: string): Promise<boolean> {
  const [pieces, documents] = await Promise.all([
    supabase.from('pieces').select('id', { count: 'exact', head: true }).eq('dossier_id', dossierId).eq('storage_hash', hash),
    supabase.from('documents_divers').select('id', { count: 'exact', head: true }).eq('dossier_id', dossierId).eq('storage_hash', hash),
  ])
  const erreur = pieces.error ?? documents.error
  if (erreur) throw new Error(`Vérification des doublons impossible : ${erreur.message}`)
  return (pieces.count ?? 0) > 0 || (documents.count ?? 0) > 0
}
