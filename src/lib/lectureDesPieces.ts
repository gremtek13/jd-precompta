import type { ExtractionResult } from './extraction'
import type { Piece } from './types'

// UNE LECTURE RATÉE SE DIT (relecture du 04/11/2026, D5 ; PIECES-Q5, sur la recommandation). Une pièce dont la lecture
// automatique n'a rien rendu — Textract qui refuse (quota, PDF de plus de 10 Mo, mur de 150 s), le modèle qui tombe ou
// dépasse son délai — arrivait comme une lecture réussie : « ok » au praticien, « Classé « Facture » → Pièces » au cabinet,
// et, sous « À valider », APRÈS les pièces de confiance haute (une confiance nulle n'avait pas de rang). Elle se ressaisit
// à la main ; encore faut-il la voir. Une règle, ici, pour les deux dépôts et pour Justificatifs.

/** Ce que la lecture a rendu d'un dépôt : tout, une partie (ni date, ni montant), ou rien. */
export type IssueDeLaLecture = 'lue' | 'incomplete' | 'ratee'

type LectureRendue = Pick<ExtractionResult, 'date_piece' | 'montant_ttc' | 'montant_ht' | 'montant_tva'>

/** L'issue d'une lecture, au dépôt d'une PIÈCE : `null` quand elle n'a pas eu lieu ou a échoué. */
export function issueDeLaLecture(extraction: LectureRendue | null): IssueDeLaLecture {
  if (!extraction) return 'ratee'
  return ceQuiManque(extraction) === null ? 'lue' : 'incomplete'
}

/** Ce qui manque à une lecture rendue — « montant », « date », « montant et date » —, ou `null` s'il ne manque rien. */
export function ceQuiManque(extraction: LectureRendue): string | null {
  const sansMontant = extraction.montant_ttc == null && extraction.montant_ht == null && extraction.montant_tva == null
  const sansDate = !extraction.date_piece
  if (sansMontant && sansDate) return 'montant et date'
  if (sansMontant) return 'montant'
  if (sansDate) return 'date'
  return null
}

/** Le message du cabinet quand la lecture n'a rien rendu : la cause, quand on la connaît, et le geste qui reste. */
export const LECTURE_RATEE_CABINET = 'Importé — extraction à refaire à la main'
export const PDF_NON_LU_CABINET = 'Importé sans lecture — PDF de plus de 10 Mo : à scinder, ou à saisir à la main'

/** Ce que la fenêtre d'import dit d'un PDF de plus de 10 Mo AVANT l'envoi, dans la ligne du fichier. */
export const PDF_TROP_LOURD_AVANT_ENVOI = 'plus de 10 Mo : sera déposé sans être lu — mieux vaut le scinder'

/** Le message du cabinet quand la lecture n'a rendu qu'une partie : le classement, puis ce qui reste à saisir. */
export function lectureIncompleteCabinet(classe: string, manque: string): string {
  return `${classe} — ${manque} non lu${manque === 'date' ? 'e' : manque === 'montant et date' ? 's' : ''}, à saisir`
}

/** Ce que le cabinet lit d'un document que la lecture a rangé dans Documents : le geste qui en refait une pièce (D4). */
export const SI_C_EST_UNE_FACTURE = 'une facture se reprend par « C’est une facture »'

/** Ce que le praticien lit d'un dépôt dont la lecture n'a pas abouti — sans montant, comme tout son écran. */
export const LECTURE_NON_ABOUTIE_CLIENT = 'déposé, la lecture n’a pas abouti : ton cabinet le complétera'

/** L'avis qui suit un lot du praticien : les fichiers déposés dont la lecture n'a pas abouti, ou rien. */
export function avisDeLectureClient(noms: readonly string[]): string | null {
  if (noms.length === 0) return null
  if (noms.length === 1) return `${noms[0]} : ${LECTURE_NON_ABOUTIE_CLIENT}.`
  return `${noms.length} fichiers déposés, la lecture n’a pas abouti : ton cabinet les complétera (${noms.join(', ')}).`
}

/**
 * Combien de fichiers d'un dépôt du praticien se lisent à la fois (relecture du 04/11/2026, D6 ; PIECES-Q4, sur la
 * recommandation) : de quoi garder un lot rapide sans dépasser les quotas de Textract et du modèle, que le cabinet relève
 * dans la console AWS (Service Quotas). Le cabinet, lui, importe un fichier à la fois.
 */
export const DEPOTS_LUS_A_LA_FOIS = 3

/**
 * Une pièce que rien n'a lue ni saisie : à valider, sans AUCUN montant — ni en euros, ni dans sa devise (une pièce en
 * dollars sans taux du jour a ses montants en euros vides, mais elle a été lue). C'est elle qui passe en tête de « À
 * valider » et porte « Non lue » ; une pièce validée, ou dont un montant a été saisi, n'en est jamais une.
 */
export function pieceNonLue(
  p: Pick<Piece, 'statut' | 'montant_ht' | 'montant_tva' | 'montant_ttc' | 'montant_devise'>,
): boolean {
  return p.statut === 'a_valider'
    && p.montant_ht == null && p.montant_tva == null && p.montant_ttc == null && p.montant_devise == null
}

/** Le badge d'une pièce non lue : « Non lue » quand aucune lecture n'a eu lieu, « Montant non lu » quand elle a raté. */
export function badgeDeLaPieceNonLue(p: Pick<Piece, 'confiance'>): string {
  return p.confiance == null ? 'Non lue' : 'Montant non lu'
}

/**
 * Le rang d'une pièce sous « À valider » : la pièce non lue d'abord, puis l'impossibilité démontrée (`demontree`), puis la
 * confiance de basse à haute — une confiance NULLE au rang de « basse » : rien n'a confirmé la pièce.
 */
export function rangSousAValider(
  p: Pick<Piece, 'statut' | 'montant_ht' | 'montant_tva' | 'montant_ttc' | 'montant_devise' | 'confiance'>,
  demontree: boolean,
): number {
  if (pieceNonLue(p)) return -2
  if (demontree) return -1
  return p.confiance === 'moyenne' ? 1 : p.confiance === 'haute' ? 2 : 0
}
