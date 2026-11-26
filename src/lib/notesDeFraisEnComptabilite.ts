import { CATEGORIE_LABELS } from './format'
import type { NoteDeFrais } from './notesDeFraisVue'
import type { ModeComptable, TypePiece } from './types'

// LA NOTE DU DIRIGEANT AU COMPTE DE L'EXPLOITANT, CELLE D'UN SALARIÉ À SON REMBOURSEMENT (conception 58, § 2.1 ; lot L3,
// 26/11/2026 ; la table : B7, `notes_de_frais`, préparée ; les écrans : B8, sous `NOTES_DE_FRAIS_PREVUES` baissé).
//
// Une note de frais n'écrit rien elle-même : son justificatif, une pièce, se valide dans sa fiche comme toute pièce, et c'est
// le TYPE de cette pièce qui décide de son écriture. Ce module DIT, pour chaque note approuvée ou remboursée, quel type son
// justificatif doit porter et si la pièce le porte — il n'écrit rien, ne valide rien et ne change aucun type : le cabinet
// décide en validant la pièce.
//
// En trésorerie (CGI, art. 93, 1 : la dépense « effectivement acquittée ») :
// - la note de l'EXPLOITANT : la pièce en « Note de frais » (`note_frais`). Elle compte à sa date, face au compte de
//   l'exploitant (`ligneContrepartieDirigeant`, lib/ecritures.ts) : il l'a payée de sa poche ce jour-là. Elle ne justifie aucun
//   mouvement (lib/noteDeFraisEnTresorerie.ts) : le virement qui la rembourse est un prélèvement de l'exploitant, un virement
//   personnel (l'expert-comptable, 2035S-E2 et PIECES-E1). Rangée en « Achat » et rapprochée de ce virement, sa charge
//   tomberait à la date du remboursement — l'exercice suivant pour une dépense de décembre remboursée en janvier.
// - la note d'un SALARIÉ : la pièce en « Achat ». Le praticien ne l'acquitte qu'en remboursant le salarié : le mouvement du
//   relevé, ou l'opération de caisse, qui le rembourse en est le paiement, rapproché d'elle, et la dépense compte à sa date.
//   Rangée en « Note de frais », elle compterait à la date de la note face au compte de l'exploitant, qui n'a rien payé.
//   Le 421 (le rôle `personnel`, B7-Q4) n'a pas de ligne en trésorerie : la question L3-Q2 le demande au cabinet.
// En engagement : la note de l'exploitant en « Note de frais » (le compte des notes de frais du dossier, lib/engagement.ts) ;
// celle d'un salarié irait au 421, dont l'écriture n'existe pas encore (le reste de B7) : rien ne se propose, et une pièce
// rangée en « Note de frais » se signale (elle irait au compte du dirigeant).
//
// POUR QUI. Un salarié nommé (`beneficiaire_salarie`, B7 : un salarié sans accès, que le dirigeant saisit) est un salarié, sans
// doute. La note qu'un accès saisit pour lui-même est PROPOSÉE comme celle de l'exploitant quand cet accès tient la case
// « Achats » — MEG2-Q6 : « l'accès « Achats » (le dirigeant) approuve et rembourse » —, comme celle d'un salarié qui a son
// propre accès sinon ; les cases relues aujourd'hui, pas au jour de la note. Cases illisibles, ou l'auteur qui n'est plus un
// accès du dossier : rien n'est proposé, les deux lectures se disent. La question L3-Q1 demande au cabinet si cette
// proposition lui convient.

export type PourQui = 'exploitant' | 'salarie'

/** Qui a fait la dépense : certain pour un salarié nommé, proposé d'après la case « Achats » de l'auteur sinon. */
export interface PourQuiDeLaNote {
  pourQui: PourQui
  certain: boolean
}

/**
 * Pour qui est la note. `achatsDesAcces` : pour chaque compte qui est un accès du dossier, s'il tient la case « Achats » ; null
 * quand les accès ne se sont pas relus en entier. Rien (null) quand on ne peut pas le dire.
 */
export function pourQuiEstLaNote(
  note: Pick<NoteDeFrais, 'auteur' | 'beneficiaire_salarie'>,
  achatsDesAcces: ReadonlyMap<string, boolean> | null,
): PourQuiDeLaNote | null {
  if (note.beneficiaire_salarie !== null) return { pourQui: 'salarie', certain: true }
  if (achatsDesAcces === null) return null
  const achats = achatsDesAcces.get(note.auteur)
  if (achats === undefined) return null
  return { pourQui: achats ? 'exploitant' : 'salarie', certain: false }
}

/** Les cases « Achats » des accès relus EN ENTIER, par compte, ou null : seul `true` accorde. */
export function achatsDesAccesLus(
  acces: { complete: boolean; lignes: readonly { user_id: string; droit_achats: boolean | null }[] },
): ReadonlyMap<string, boolean> | null {
  if (!acces.complete) return null
  return new Map(acces.lignes.map((a) => [a.user_id, a.droit_achats === true]))
}

/** Le type que le justificatif doit porter, ou null quand aucune écriture ne l'attend encore (un salarié en engagement). */
export function typeAttenduDuJustificatif(pourQui: PourQui, mode: ModeComptable): TypePiece | null {
  if (pourQui === 'exploitant') return 'note_frais'
  return mode === 'tresorerie' ? 'achat' : null
}

/** Ce que la section des notes de frais du client dit du justificatif d'une note. */
export interface RangementDuJustificatif {
  /** Pour qui, ou null quand rien ne se propose. */
  pourQui: PourQuiDeLaNote | null
  /** Le type attendu, ou null. */
  attendu: TypePiece | null
  /** La pièce porte un autre type que celui qu'on attend (ou, sans type attendu, celui qu'il ne faut pas). */
  aRanger: boolean
  /** Les phrases, dans l'ordre. */
  phrases: string[]
}

const type = (t: TypePiece) => `« ${CATEGORIE_LABELS[t] ?? t} »`

export const PHRASE_NOTE_DE_L_EXPLOITANT_TRESORERIE = 'Note de l’exploitant : son justificatif se valide en « Note de frais ». '
  + 'La dépense compte à sa date, face au compte de l’exploitant, et le virement qui la rembourse se classe en virement '
  + 'personnel — jamais rapproché d’elle.'
export const PHRASE_NOTE_DE_L_EXPLOITANT_ENGAGEMENT = 'Note de l’exploitant : son justificatif se valide en « Note de frais », '
  + 'au compte des notes de frais du dossier.'
export const PHRASE_NOTE_D_UN_SALARIE_TRESORERIE = 'Note d’un salarié : son justificatif se valide en « Achat » et se rapproche '
  + 'du mouvement, ou de l’opération de caisse, qui rembourse le salarié. La dépense compte à la date de ce remboursement.'
export const PHRASE_NOTE_D_UN_SALARIE_ENGAGEMENT = 'Note d’un salarié : en engagement, son écriture au compte du personnel '
  + '(421) n’existe pas encore ; son justificatif ne se valide pas en « Note de frais », qui l’écrirait au compte du dirigeant.'
export const PHRASE_POUR_QUI_INCONNU = 'Saisie par un accès du client pour lui-même, dont les cases ne se sont pas relues : '
  + 'son justificatif se valide en « Note de frais » si c’est la dépense de l’exploitant, en « Achat » si c’est celle d’un '
  + 'salarié — au cabinet de le dire en validant la pièce.'
export const PHRASE_PROPOSE_EXPLOITANT = 'Proposé : l’accès qui l’a saisie pour lui-même tient la case « Achats », celle du '
  + 'dirigeant. Si c’est un salarié, son justificatif se valide en « Achat ».'
export const PHRASE_PROPOSE_SALARIE = 'Proposé : l’accès qui l’a saisie pour lui-même ne tient pas la case « Achats ». Si c’est '
  + 'l’exploitant, son justificatif se valide en « Note de frais ».'
export const PHRASE_MODELE_INCONNU = 'Le modèle comptable du dossier ne s’est pas relu : le type de son justificatif ne se dit pas.'
export const PHRASE_JUSTIFICATIF_NON_RELU = 'Son justificatif ne s’est pas relu : son type ne se juge pas.'

/** Les notes dont le justificatif se juge : approuvées ou remboursées — soumise, elle peut encore se refuser. */
export function seJugeLeJustificatif(note: Pick<NoteDeFrais, 'etat' | 'piece_id'>): boolean {
  return note.piece_id !== null && (note.etat === 'approuvee' || note.etat === 'remboursee')
}

/**
 * Le rangement du justificatif d'une note, ou null pour une note dont il ne se juge pas (sans justificatif — des kilomètres —,
 * brouillon, soumise, refusée, retirée). `justificatif` : la pièce relue (null quand elle ne s'est pas relue) ; `mode` : le
 * modèle comptable du dossier (null quand il ne s'est pas relu).
 */
export function rangementDuJustificatif(
  note: Pick<NoteDeFrais, 'auteur' | 'beneficiaire_salarie' | 'etat' | 'piece_id'>,
  justificatif: { type_piece: TypePiece } | null,
  achatsDesAcces: ReadonlyMap<string, boolean> | null,
  mode: ModeComptable | null,
): RangementDuJustificatif | null {
  if (!seJugeLeJustificatif(note)) return null
  const pourQui = pourQuiEstLaNote(note, achatsDesAcces)
  if (mode === null) return { pourQui, attendu: null, aRanger: false, phrases: [PHRASE_MODELE_INCONNU] }
  if (pourQui === null) return { pourQui, attendu: null, aRanger: false, phrases: [PHRASE_POUR_QUI_INCONNU] }
  const attendu = typeAttenduDuJustificatif(pourQui.pourQui, mode)
  const phrases = [pourQui.pourQui === 'exploitant'
    ? (mode === 'tresorerie' ? PHRASE_NOTE_DE_L_EXPLOITANT_TRESORERIE : PHRASE_NOTE_DE_L_EXPLOITANT_ENGAGEMENT)
    : (mode === 'tresorerie' ? PHRASE_NOTE_D_UN_SALARIE_TRESORERIE : PHRASE_NOTE_D_UN_SALARIE_ENGAGEMENT)]
  if (!pourQui.certain) phrases.push(pourQui.pourQui === 'exploitant' ? PHRASE_PROPOSE_EXPLOITANT : PHRASE_PROPOSE_SALARIE)
  if (justificatif === null) return { pourQui, attendu, aRanger: false, phrases: [...phrases, PHRASE_JUSTIFICATIF_NON_RELU] }
  const aRanger = attendu === null ? justificatif.type_piece === 'note_frais' : justificatif.type_piece !== attendu
  if (aRanger) {
    phrases.push(`Son justificatif est rangé en ${type(justificatif.type_piece)} : à reprendre dans sa fiche`
      + (attendu === null ? '.' : `, en ${type(attendu)}.`))
  }
  return { pourQui, attendu, aRanger, phrases }
}

/**
 * Ce que la confirmation du remboursement ajoute, côté cabinet : ce que deviendra le mouvement qui rembourse. Rien quand on ne
 * sait pas pour qui est la note, ni le modèle du dossier, ni en engagement (le règlement y suit sa pièce).
 */
export function suiteDuRemboursement(pourQui: PourQuiDeLaNote | null, mode: ModeComptable | null): string | null {
  if (pourQui === null || mode !== 'tresorerie') return null
  return pourQui.pourQui === 'exploitant'
    ? 'Le virement qui rembourse l’exploitant se classera en virement personnel : la dépense a compté à sa date.'
    : 'Le mouvement qui rembourse le salarié se rapprochera du justificatif : la dépense comptera à sa date.'
}
