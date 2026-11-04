import type { ExtractionResult } from './extraction'

// LA DATE DÉDUITE NE SE PERD PLUS AU DÉPÔT (relecture du 04/11/2026, D2 ; PIECES-Q1, option (A), sans migration). Quand aucune
// date ne vient d'un libellé reconnu ni de la citation du modèle, `extract-piece` retient la PREMIÈRE date du document, en
// ordre de lecture, et le marque (`_date_deduite`). Juste dans la plupart des mises en page, fausse sur un avis d'échéance
// d'assurance (la ligne « échéance » écartée, c'est la date du contrat qui reste : 2023 pour un avis de 2025) — et la pièce
// sort alors de son exercice : Justificatifs filtre par sa date, le préalable des pièces à valider ne la voit plus, et payée
// hors du relevé elle compte dans une année que personne ne déclare. Seule la relecture groupée lisait la marque ; les deux
// dépôts et le bouton d'extraction de la fiche l'ignoraient, et la pièce s'écrivait « haute ».
//
// UNE RÈGLE, POUR LES TROIS CHEMINS (`lib/depot.ts`, le client ; `lib/importFichiers.ts`, le cabinet ; `FichePiece`, le
// bouton « Extraire automatiquement ») : la confiance d'une pièce à date déduite ne dépasse pas « moyenne ». C'est la seule
// trace qui SURVIT au dépôt : aucune colonne de `pieces` ne garde la marque, et rien de ce que la pièce garde de son
// extraction ne le peut sans migration — le texte lu est montré tel que lu et sert à reconnaître un doublon par son
// empreinte (`piece_textes_ocr`), la note interne est un texte du cabinet que le client ne peut pas écrire
// (`notes_internes`), le fil des précisions est une parole datée que le client lit (`piece_commentaires`), et l'ancienne
// colonne `notes` n'est plus ni lue ni écrite. La marque elle-même se dit là où elle est encore en main : dans le message
// du dépôt du cabinet, et dans la fiche, tant que l'extraction qu'elle vient de faire n'est pas enregistrée. Une colonne
// `date_deduite` (l'option (B) de PIECES-Q1) la garderait au-delà : une migration, si la répétition générale montre plus de
// quelques dates déduites fausses.

/** Ce que l'écran et le message du cabinet disent d'une date déduite. */
export const DATE_DEDUITE_A_VERIFIER = 'date déduite de la mise en page, à vérifier'

/** La date de cette extraction vient-elle de la règle de dernier recours ? Seulement si elle en a rendu une. */
export function dateDeduite(extraction: Pick<ExtractionResult, 'date_piece' | '_date_deduite'>): boolean {
  return extraction._date_deduite === true && !!extraction.date_piece
}

/** La confiance qu'une pièce reçoit de son extraction : « haute » redescend à « moyenne » quand sa date est déduite. */
export function confianceDeLExtraction(
  extraction: Pick<ExtractionResult, 'confiance' | 'date_piece' | '_date_deduite'>,
): ExtractionResult['confiance'] {
  return dateDeduite(extraction) && extraction.confiance === 'haute' ? 'moyenne' : extraction.confiance
}
