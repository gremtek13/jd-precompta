// LA NOTE DE FRAIS DE L'EXPLOITANT EN TRÉSORERIE N'EST LE JUSTIFICATIF D'AUCUN MOUVEMENT (conception 58, § 2.1 ; lot L1,
// 17/11/2026).
//
// Ce que l'exploitant paie de sa poche s'écrit, en trésorerie, charge face au compte de l'exploitant, à la date de la note
// (`ligneContrepartieDirigeant`, lib/ecritures.ts) : la dépense est « effectivement acquittée » ce jour-là, par lui (CGI,
// art. 93, 1). Le virement du compte professionnel qui le rembourse ensuite n'est pas le paiement de la dépense : c'est un
// prélèvement de l'exploitant, un virement personnel (lib/virementPersonnel.ts). Rapprochée de ce virement, la note perdait sa
// part « note de frais » et sa charge tombait à la date du REMBOURSEMENT — l'exercice suivant pour une dépense de décembre
// remboursée en janvier.
//
// D'où, en trésorerie seulement : une pièce « note de frais » n'est ni proposée ni acceptée comme justificatif d'un mouvement
// du relevé (`horsDesNotesDeLExploitant`, `refusNoteDeFraisAuReleve`) ; le débit du même montant qu'une note se propose en
// virement personnel (`notesRembourseesPeutEtre`) et n'entre dans aucun lot des règles ; un rapprochement déjà fait se dit
// dans la Vue d'ensemble, en attention, sans rien réécrire (`notesDeFraisRapprochees`). En engagement rien ne change : la
// dette au dirigeant passe par le compte choisi, et son règlement par la banque. Les notes de frais d'un SALARIÉ (chantier B7,
// la table `notes_de_frais`, au 421) ne sont pas des pièces : ce module ne les voit pas.
import { piecesDuMemeMontant } from './appariementBanque'
import type { FacturesSources } from './facturesSources'
import { formatDate, formatMoney } from './format'
import { estParLeReleve, type PaiementsDesPieces } from './rattachement'
import type { LigneBancaire, ModeComptable, Piece } from './types'

/** La pièce est-elle une note de frais de l'exploitant tenue en trésorerie ? */
export function estNoteDeLExploitant(piece: Pick<Piece, 'type_piece'>, mode: ModeComptable): boolean {
  return mode === 'tresorerie' && piece.type_piece === 'note_frais'
}

/** Les pièces qui peuvent justifier un mouvement du relevé : toutes, moins les notes de frais de l'exploitant en trésorerie. */
export function horsDesNotesDeLExploitant<P extends Pick<Piece, 'type_piece'>>(pieces: readonly P[], mode: ModeComptable): P[] {
  return pieces.filter((p) => !estNoteDeLExploitant(p, mode))
}

export const REFUS_NOTE_DE_FRAIS_AU_RELEVE = 'En trésorerie, une note de frais de l’exploitant ne se rapproche d’aucun mouvement : '
  + 'elle compte à sa date, face au compte de l’exploitant, et le virement qui la rembourse se classe en virement personnel.'

/** Le refus d'associer cette pièce à un mouvement du relevé, ou rien. Une pièce non lue ne se refuse pas ici. */
export function refusNoteDeFraisAuReleve(piece: Pick<Piece, 'type_piece'> | null | undefined, mode: ModeComptable): string | null {
  return piece && estNoteDeLExploitant(piece, mode) ? REFUS_NOTE_DE_FRAIS_AU_RELEVE : null
}

/**
 * Les notes de frais de l'exploitant que ce DÉBIT rembourse peut-être : du même montant, dans la fenêtre de l'appariement
 * (`piecesDuMemeMontant`), pas encore rapprochées. Aucune sur un crédit, en engagement, ni sur l'exemplaire d'une facture
 * source. La fiche les nomme et propose le virement personnel ; le lot des règles retient le mouvement.
 */
export function notesRembourseesPeutEtre(
  ligne: LigneBancaire,
  pieces: readonly Piece[],
  dejaRapprochees: ReadonlySet<string>,
  sources: FacturesSources,
  mode: ModeComptable,
): Piece[] {
  if (mode !== 'tresorerie' || ligne.montant >= 0) return []
  return piecesDuMemeMontant(ligne, pieces.filter((p) => estNoteDeLExploitant(p, mode)), dejaRapprochees, sources)
}

export const RAISON_REMBOURSEMENT_D_UNE_NOTE = 'Une note de frais de l’exploitant du même montant est peut-être remboursée par ce '
  + 'mouvement : à classer en virement personnel, pas à affecter — la dépense compterait deux fois.'

/** La phrase de la fiche d'un mouvement devant la note qu'il rembourse peut-être. */
export function phraseDuRemboursementDUneNote(note: Pick<Piece, 'date_piece' | 'montant_ttc'>): string {
  return `Une note de frais de l’exploitant du ${formatDate(note.date_piece)}, de ${formatMoney(note.montant_ttc)}, est peut-être `
    + 'remboursée par ce mouvement. En trésorerie, elle compte à sa date, face au compte de l’exploitant : son remboursement '
    + 'est un prélèvement de l’exploitant, à classer en virement personnel, jamais son paiement.'
}

/** Une note de frais de l'exploitant déjà rapprochée d'un mouvement du relevé (ou d'une part d'un virement groupé). */
export interface NoteRapprochee {
  piece: Piece
  /** Les dates des mouvements qui la paient, triées. */
  datesDesMouvements: string[]
}

/**
 * Les notes de frais de l'exploitant qu'un ancien rapprochement fait payer par le relevé, en trésorerie : leur charge compte à
 * la date du remboursement, pas à la leur. Un mouvement d'un exercice validé est figé avec lui : la note ne se dit que si l'un
 * de ses mouvements au moins est d'un exercice ouvert.
 */
export function notesDeFraisRapprochees(
  pieces: readonly Piece[],
  paiements: PaiementsDesPieces,
  mode: ModeComptable,
  anneesValidees: readonly number[],
): NoteRapprochee[] {
  if (mode !== 'tresorerie') return []
  return pieces.flatMap((piece) => {
    if (!estNoteDeLExploitant(piece, mode)) return []
    const dates = (paiements.get(piece.id) ?? []).filter(estParLeReleve).map((p) => p.date).sort()
    if (!dates.some((d) => !anneesValidees.includes(Number(d.slice(0, 4))))) return []
    return [{ piece, datesDesMouvements: dates }]
  })
}

export const LIBELLE_NOTES_RAPPROCHEES = 'note(s) de frais de l’exploitant rapprochée(s) d’un mouvement du relevé — en trésorerie, '
  + 'la dépense compte à la date de la note, et son remboursement est un virement personnel'

export function detailDesNotesRapprochees(notes: readonly NoteRapprochee[]): string | undefined {
  if (notes.length === 0) return undefined
  const lignes = notes.slice(0, 5).map((n) =>
    `la note du ${formatDate(n.piece.date_piece)} (${formatMoney(n.piece.montant_ttc)}), payée par le mouvement du `
    + n.datesDesMouvements.map((d) => formatDate(d)).join(' et du '))
  return `${lignes.join(' ; ')}${notes.length > 5 ? ` ; et ${notes.length - 5} autre(s)` : ''}. À reclasser dans Banque : annuler `
    + 'le rapprochement, puis classer le mouvement en virement personnel ; la note s’écrit alors face au compte de l’exploitant, à sa date.'
}
