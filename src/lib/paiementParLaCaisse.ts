import { ecartAvecBanque, paiementNet } from './alignementBanque'
import {
  avecLOperation, former, jourDit, jugerLaDate, jugerLeMontant, MOTS_DE_LA_CAISSE, ouvertureDuDossier, refus, refusDeLaCaisse,
  type CleDuRefus, type CodeDuRefus, type DossierDeLaCaisse, type EtatDeLaCaisse, type OperationDeLaCaisse, type RefusCaisse,
} from './caisse'
import type { PartPayeeParLaCaisse } from './rattachement'
import type { CaisseLue } from './recettesDeCaisse'
import type { OperationCaisse, Piece } from './types'

// LE PAIEMENT D'UNE PIÈCE PAR LA CAISSE, CE QUE LA BASE EN DIRA AVANT LE CLIC (ligne 26.6, étape C8 ; CAISSE-Q4, (B)). La
// conception : HISTORIQUE.md, « LA CAISSE : LA SAISIE DU PRATICIEN ET LA PIÈCE RÉGLÉE PAR LA CAISSE — LA CONCEPTION REPRISE
// (CAISSE-Q1 ET Q4) », § 8 et § 9, n° 4 ; la base : la migration `paiement_par_la_caisse`, PRÉPARÉE le 31/10/2026
// (supabase/preparees/), pas encore appliquée.
//
// PUR : aucun appel au réseau, aucun import du client Supabase. Ce module redit, dans leur ORDRE, sous leurs MOTS et leurs
// CODES, les refus NEUFS de cette migration — ceux de `regler_piece_par_la_caisse`, de la contrepartie d'un paiement (la
// garde du brouillon, `garder_ecriture_de_caisse`), de la pièce qu'un paiement cite (`garder_piece_payee_par_la_caisse`) et
// du mouvement d'avant l'ouverture classé sur la caisse (`garder_caisse_depuis_l_ouverture`) —, jugés sur ce qui part,
// tel que ça part. Ceux qu'elle partage avec la saisie d'une opération (l'accès, la trésorerie, la date, le montant, la
// caisse négative) sont ceux de lib/caisse.ts, sous leurs clés : une seule copie de chaque mot. `paiementParLaCaisse.test.ts`
// le confronte au texte de la migration (les mots et l'ordre, relus dans le SQL) et aux verdicts de son essai
// (supabase/essais/caisse.sql, étapes 200 à 231).
//
// LE DRAPEAU. `PAIEMENT_PAR_LA_CAISSE_EXPORTE` reste BAISSÉ tant que la migration n'est pas dans l'export : aucun écran
// ne règle une pièce par la caisse (le lot C9b s'y branchera), et `jugerLeReglementSelon` le dit (`absent`) sans juger ;
// et aucun paiement par la caisse n'entre dans les moteurs (`paiementsParLaCaisse`, étape C9a) : ils rendent ce qu'ils
// rendaient, au caractère près. Levé, le jour de l'application — le fichier dans l'export, sous la version de sa ligne
// d'historique —, les moteurs lisent les paiements de la caisse, et C9b offre le geste. Le mouvement d'avant l'ouverture, lui, ne dépend pas du drapeau : l'écran cesse de l'offrir AVANT que la base ne
// le refuse (un resserrement vient en dernier) ; la production n'en portait aucun classé sur la caisse le 29/10/2026
// (aucun mouvement sur un compte de bilan), et la session les recompte le jour de l'application.
//
// ET LE DRAPEAU NE SE LÈVE QU'APRÈS LE DÉPLOIEMENT DE L'ASSISTANT QUI PORTE LE LOT C13 (relecture du 01/11/2026 ; C13, le même
// jour). L'assistant (supabase/functions/agent-comptable) lit désormais les paiements par la caisse — sa copie de
// `paiementsDesPieces` prend le quatrième paramètre, tiré des opérations de caisse comme `paiementsParLaCaisseSelon(true, …)`,
// sans drapeau : une telle opération n'existe qu'après la migration, et sans elle il rend ce qu'il rendait, au caractère près
// (agentComptableCaisse.test.ts) ; la ligne de la contrepartie se nommait déjà comme sa pièce (étape C5), et une ligne restée
// qui ne cite que l'opération d'un paiement, par l'opération. Mais c'est la version DÉPLOYÉE qui parle au cabinet : tant
// qu'une version d'avant C13 est en ligne, une pièce payée en espèces lui paraîtrait sans paiement, et sa contrepartie en
// écart. L'ordre du jour de l'application : l'assistant qui porte C13 déployé (il peut l'être avant C8, neutre), C8
// appliquée, puis — ce jour-là — le drapeau levé. Le drapeau suit le fichier de la migration dans l'export
// (`paiementParLaCaisse.test.ts`) : ne déplacer ce fichier dans l'export qu'une fois l'assistant de C13 en ligne.
export const PAIEMENT_PAR_LA_CAISSE_EXPORTE = false

// ── Les mots de la base ───────────────────────────────────────────────────────────────────────────────────────────────

// Chaque refus neuf, son code et son GABARIT — le texte du `raise exception` de la migration, ses `%` compris, que `former`
// remplit dans l'ordre. Les apostrophes sont celles de la base.
export const MOTS_DU_PAIEMENT = {
  // `regler_piece_par_la_caisse`.
  piece_inconnue: { code: 'P0002', gabarit: 'Cette pièce n\'est pas une pièce de ce dossier : relis ses pièces.' },
  note_de_frais: { code: '22023', gabarit: 'Une note de frais est payée de ta poche ; payée par la caisse, c\'est un achat : change d\'abord son type.' },
  ni_achat_ni_vente: { code: '22023', gabarit: 'Seule une pièce d\'achat ou de vente se paie par la caisse.' },
  exemplaire_d_une_source: { code: '22023', gabarit: 'Cette pièce est l\'exemplaire de la facture %, qui compte sa vente : enregistre l\'encaissement en espèces de la facture.' },
  sens: { code: '22023', gabarit: 'Ce paiement ne va pas dans le sens de sa pièce : une pièce d\'achat fait sortir des espèces (un montant négatif), une pièce de vente en fait entrer (positif) — l\'inverse pour un avoir.' },
  au_dela: { code: '22023', gabarit: 'Les paiements de cette pièce par la caisse dépasseraient son montant : relis ses paiements.' },
  // Le reste au centime (relecture du 01/11/2026 ; C9-Q1, sur la recommandation) : au client, sans montant — il ne lit pas
  // celui de la pièce ; au cabinet, le reste et le montant exact, ou la pièce déjà réglée par ses autres paiements.
  au_centime_client: { code: '22023', gabarit: 'Ce paiement ne règle pas exactement cette pièce : à quelques centimes près, son écriture ne s\'équilibrerait pas. Vérifie le montant de tes espèces, ou demande à ton cabinet.' },
  au_centime: { code: '22023', gabarit: 'Ce paiement laisserait % € % sur cette pièce : sous l\'écart où une pièce se dit réglée, son écriture ne s\'équilibrerait pas. Le montant exact qui la règle est % de % € — ou corrige d\'abord le montant de la pièce.' },
  au_centime_deja_reglee: { code: '22023', gabarit: 'Cette pièce est déjà réglée par ses autres paiements : ce paiement la paierait de % € en trop, sous l\'écart où une pièce se dit réglée, et son écriture ne s\'équilibrerait pas.' },
  // La contrepartie d'un paiement (`garder_ecriture_de_caisse`).
  contrepartie_ne_suit_pas: { code: '23514', gabarit: 'Cette écriture ne suit pas son opération de caisse : son dossier, sa date, ou sa pièce.' },
  contrepartie_compte: { code: '23514', gabarit: 'La contrepartie d\'un paiement par la caisse s\'écrit au compte de la caisse du dossier (%).' },
  contrepartie_sens: { code: '23514', gabarit: 'La contrepartie d\'un paiement par la caisse suit ses espèces : au débit quand elles entrent, au crédit quand elles sortent.' },
  contrepartie_au_dela: { code: '23514', gabarit: 'La contrepartie d\'un paiement par la caisse ne dépasse pas ce paiement.' },
  // La pièce supprimée sous la contrepartie de son paiement (relecture du 01/11/2026) : la clé du brouillon met sa pièce à nul
  // AVANT que celle de la caisse ne refuse, et la garde le dit sous ses mots — non plus « ne se modifie pas ».
  piece_payee_supprimee: { code: '23503', gabarit: 'Cette pièce est payée par la caisse : retire d\'abord son paiement. Elle ne se supprime pas pour autant — l\'opération de caisse, même retirée, la cite pour la piste d\'audit : si elle n\'est pas une pièce de ce dossier, change ensuite son type en « autre ».' },
  // La pièce qu'un paiement cite (`garder_piece_payee_par_la_caisse`).
  piece_change_de_dossier: { code: '23514', gabarit: 'Cette pièce est citée par un paiement de la caisse de son dossier : elle ne change pas de dossier.' },
  piece_change_de_type: { code: '23514', gabarit: 'Cette pièce est payée par la caisse : elle reste une pièce d\'achat ou de vente tant que ce paiement n\'est pas retiré.' },
  piece_devient_exemplaire: { code: '23514', gabarit: 'Cette pièce est payée par la caisse : elle ne devient l\'exemplaire de la facture %, qui compte sa vente, qu\'une fois ce paiement retiré — l\'encaissement en espèces de la facture le remplace.' },
  // Le mouvement d'avant l'ouverture classé sur la caisse (`garder_caisse_depuis_l_ouverture`).
  mouvement_avant_l_ouverture: { code: '23514', gabarit: 'Ce mouvement précède l\'ouverture du dossier, le % : il est déjà dans les comptes repris, et ne se classe pas sur la caisse.' },
} as const satisfies Record<string, { code: CodeDuRefus; gabarit: string }>

export type CleDuPaiement = keyof typeof MOTS_DU_PAIEMENT

/** Les mots de la caisse et ceux du paiement, sous une seule clé : l'ordre d'une fonction mêle les deux. */
export const MOTS = { ...MOTS_DE_LA_CAISSE, ...MOTS_DU_PAIEMENT }

// L'ORDRE DES `raise` DANS LE CORPS DE CHAQUE FONCTION, tel que le texte de la migration les écrit — l'accès, que
// `qui_ecrit_la_caisse` lève, avant tout ; la caisse négative, dont le texte vient de `texte_caisse_negative`, à part. Pour
// la garde du brouillon, la seule voie neuve : la contrepartie d'un paiement.
export const ORDRE_DU_PAIEMENT: Readonly<Record<
  'regler_piece_par_la_caisse' | 'contrepartie' | 'garder_piece_payee_par_la_caisse' | 'garder_caisse_depuis_l_ouverture',
  readonly (CleDuRefus | CleDuPaiement)[]
>> = {
  regler_piece_par_la_caisse: [
    'tresorerie', 'piece_inconnue', 'note_de_frais', 'ni_achat_ni_vente', 'exemplaire_d_une_source', 'date_absente',
    'date_avant_2000', 'date_future', 'date_avant_ouverture', 'frontiere', 'montant_absent', 'montant_centime',
    'montant_nul', 'montant_borne', 'sens', 'au_dela', 'au_centime_client', 'au_centime_deja_reglee', 'au_centime',
  ],
  contrepartie: ['contrepartie_ne_suit_pas', 'contrepartie_compte', 'contrepartie_sens', 'contrepartie_au_dela'],
  garder_piece_payee_par_la_caisse: ['piece_change_de_dossier', 'piece_change_de_type', 'piece_devient_exemplaire'],
  garder_caisse_depuis_l_ouverture: ['mouvement_avant_l_ouverture'],
}

function refusDuPaiement(cle: CleDuPaiement, ...valeurs: readonly string[]): RefusCaisse {
  const { code, gabarit } = MOTS_DU_PAIEMENT[cle]
  return { code, message: former(gabarit, ...valeurs) }
}

// ── Le paiement d'une pièce ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * La pièce telle que `regler_piece_par_la_caisse` la lit, dans le dossier du paiement : son type, son statut, son montant, sa
 * devise, et, quand elle est l'exemplaire d'une facture, ce que la fonction en lit — sa source et son numéro, joints par la
 * lecture (jamais cherchés ici : une facture absente ne se devine pas). Et, depuis la relecture du 01/11/2026, ce que le RELEVÉ
 * en paie (`paiementsDuReleve`) : la base les lit pour juger le reste au centime (le refus 9 bis), comme `paiementsDesPieces`
 * les compte — un mouvement rapproché d'elle, la part d'un virement groupé, celle d'un virement mixte —, signés comme le
 * relevé ; ses paiements par la caisse, eux, sont ceux de la caisse du dossier (`DossierDeLaCaisse.caisse`).
 */
export interface PieceDuPaiement {
  id: string
  type_piece: Piece['type_piece']
  statut: Piece['statut']
  montant_ttc: number | null
  devise: Piece['devise']
  exemplaire: { numero: string | null; source_de_la_vente: boolean } | null
  paiementsDuReleve: readonly { montant: number }[]
}

/**
 * LE SENS DES ESPÈCES D'UNE PIÈCE : elles ENTRENT pour une vente, SORTENT pour un achat — l'inverse pour un avoir (une pièce de
 * montant négatif). La règle du refus 8 de `regler_piece_par_la_caisse`, celle d'un mouvement rapproché d'une pièce
 * (lib/appariementBanque.ts, `sensCoherent`) ; une seule copie, que l'écran et la Vue d'ensemble lisent aussi.
 */
export function especesEntrentPour(piece: Pick<Piece, 'type_piece' | 'montant_ttc'>): boolean {
  return (piece.type_piece === 'vente') !== (piece.montant_ttc != null && piece.montant_ttc < 0)
}

/**
 * LE RESTE AU CENTIME (relecture du 01/11/2026, le défaut 2 ; C9-Q1, posée au cabinet le 01/11/2026, écrite sur sa
 * recommandation). Une pièce dont les paiements font son montant à l'écart d'alignement près (`seuilAlignement` : 2 %, au plus
 * 5 €) se dit RÉGLÉE (`partsDesPaiements`, lib/rattachement.ts) : sa charge s'écrit entière, face à ce qui a été payé. La
 * banque ALIGNE alors la pièce sur le total de ses paiements, la caisse comprise (`reglerPieceSurBanque`, lib/reglementBanque.ts,
 * appelé par BanqueTab `reglerSiLibre`) — le relevé dit l'argent réellement sorti. Un montant d'espèces est tapé à la main :
 * 39,99 € pour une pièce de 40,00 € y est le plus souvent une faute de frappe, et la pièce « réglée » portait un centime que
 * rien n'écrivait. D'où ce refus, avant le clic et en base, qui dit le montant exact.
 *
 * Ce que rend cette fonction : nul quand ce paiement ne laisse pas la pièce dans cette zone ; sinon le reste après lui, en
 * centimes (positif : à régler ; négatif : payé en trop), et le montant exact qui la règle, signé comme le paiement — nul
 * quand ses autres paiements la règlent déjà. La zone est celle où la banque alignerait : `ecartAvecBanque(…).alignable`, la
 * MÊME fonction, sur le total de TOUS les paiements, ce paiement compris.
 *
 * L'AUTRE OPTION DE C9-Q1 — aligner la pièce, comme la banque — se branche ICI, sans rien reprendre d'autre : le refus 9 bis
 * retiré du module et de la migration (un bloc), l'écran appellerait, après `regler_piece_par_la_caisse`,
 * `reglerPieceSurBanque(piece, [...autres paiements, { montant }])`, qui aligne justement dans cette zone et seulement là.
 */
export function resteAuCentime(
  piece: Pick<PieceDuPaiement, 'id' | 'montant_ttc' | 'devise' | 'paiementsDuReleve'>,
  caisse: Pick<EtatDeLaCaisse, 'operations'>,
  centimes: number,
): { resteApres: number; exact: number | null } | null {
  if (piece.montant_ttc == null) return null
  const autres = [
    ...piece.paiementsDuReleve,
    ...caisse.operations.filter((o) => o.genre === 'paiement' && o.piece_id === piece.id && o.retire_le == null),
  ]
  const avant = paiementNet(autres)
  const netAvant = avant.centimes * avant.sens
  const netApres = netAvant + centimes
  const ecart = ecartAvecBanque(piece, { montant: netApres / 100 })
  if (ecart === null || !ecart.alignable) return null
  const pieceCentimes = Math.abs(Math.round(piece.montant_ttc * 100))
  const signe = Math.sign(centimes)
  // Le paiement qui règle EXACTEMENT : celui qui porte la somme nette, dans son sens, au montant de la pièce.
  const exact = signe * pieceCentimes - netAvant
  return { resteApres: pieceCentimes - Math.abs(netApres), exact: Math.sign(exact) === signe ? exact : null }
}

const eurosDits = (centimes: number) => `${Math.floor(Math.abs(centimes) / 100)},${String(Math.abs(centimes) % 100).padStart(2, '0')}`

/** Ce que la saisie d'un paiement envoie : ses paramètres, rien d'autre. */
export interface SaisieDuReglement {
  piece_id: string | null
  date: string | null
  montant: number | null
}

export type JugementDuReglement =
  /** La migration n'est pas en base : rien ne se règle par la caisse, et rien ne se juge. */
  | { etat: 'absent' }
  | { etat: 'refuse'; refus: RefusCaisse }
  /** Le paiement que la base écrirait, et la caisse qui le porte. */
  | { etat: 'accepte'; operation: OperationDeLaCaisse; caisse: EtatDeLaCaisse }

/** Une pièce validée qu'aucun paiement ne dépasse : ses paiements par la caisse, non retirés, en centimes positifs. */
function dejaPayeParLaCaisse(pieceId: string, caisse: EtatDeLaCaisse): number {
  return caisse.operations.filter((o) => o.genre === 'paiement' && o.piece_id === pieceId && o.retire_le == null)
    .reduce((s, o) => s + Math.abs(Math.round(o.montant * 100)), 0)
}

/**
 * Ce que `regler_piece_par_la_caisse` refuserait de CE paiement, tel qu'il part, dans son ordre et sous ses mots ; ou le
 * paiement qu'elle écrirait. `pieces` sont celles du DOSSIER, lues en entier : une pièce qui n'y est pas se refuse comme la
 * base la refuse. `id` est celui que l'écran donne au paiement en attendant la base.
 */
export function jugerLeReglementSelon(enBase: boolean, saisie: SaisieDuReglement, dossier: DossierDeLaCaisse,
  pieces: readonly PieceDuPaiement[], id: string): JugementDuReglement {
  if (!enBase) return { etat: 'absent' }
  const non = (x: RefusCaisse): JugementDuReglement => ({ etat: 'refuse', refus: x })
  // 1. L'accès, avant toute lecture.
  if (dossier.quiEcrit == null) return non(refus('acces'))
  // 2. Le dossier en trésorerie.
  if (dossier.modele.mode !== 'tresorerie') return non(refus('tresorerie'))
  // 3. La pièce, de ce dossier.
  const piece = saisie.piece_id == null ? undefined : pieces.find((p) => p.id === saisie.piece_id)
  if (piece == null) return non(refusDuPaiement('piece_inconnue'))
  // 4. Le type.
  if (piece.type_piece === 'note_frais') return non(refusDuPaiement('note_de_frais'))
  if (piece.type_piece !== 'achat' && piece.type_piece !== 'vente') return non(refusDuPaiement('ni_achat_ni_vente'))
  // 5. L'exemplaire d'une facture source.
  if (piece.exemplaire?.source_de_la_vente) {
    return non(refusDuPaiement('exemplaire_d_une_source', piece.exemplaire.numero ?? '(sans numéro)'))
  }
  // 6. La date, comme celle d'une opération.
  const laDate = jugerLaDate(saisie.date, dossier)
  if (laDate.refus) return non(laDate.refus)
  // 7. Le montant, comme celui d'une opération (le signe, le sens le juge).
  const leMontant = jugerLeMontant(saisie.montant, false)
  if (leMontant.refus) return non(leMontant.refus)
  // 8. Le sens : des espèces qui entrent pour une vente, qui sortent pour un achat — l'inverse pour un avoir.
  if ((leMontant.centimes > 0) !== especesEntrentPour(piece)) return non(refusDuPaiement('sens'))
  // 9. Une pièce validée : ses paiements par la caisse non retirés ne dépassent pas son montant.
  if (piece.statut === 'validee' && piece.montant_ttc != null
    && dejaPayeParLaCaisse(piece.id, dossier.caisse) + Math.abs(leMontant.centimes) > Math.abs(Math.round(piece.montant_ttc * 100))) {
    return non(refusDuPaiement('au_dela'))
  }
  // 9 bis. Le reste au centime (`resteAuCentime`) : sur TOUS ses paiements, ceux du relevé compris, la pièce ne reste pas à
  //        quelques centimes de son montant — au client, sans le dire ; au cabinet, le reste et le montant exact.
  const auCentime = resteAuCentime(piece, dossier.caisse, leMontant.centimes)
  if (auCentime !== null) {
    if (dossier.quiEcrit === 'client') return non(refusDuPaiement('au_centime_client'))
    if (auCentime.exact === null) return non(refusDuPaiement('au_centime_deja_reglee', eurosDits(auCentime.resteApres)))
    return non(refusDuPaiement('au_centime', eurosDits(auCentime.resteApres),
      auCentime.resteApres > 0 ? 'à régler' : 'payés en trop', auCentime.exact > 0 ? 'une entrée' : 'une sortie', eurosDits(auCentime.exact)))
  }
  // Le paiement, tel que la base l'insère.
  const operation: OperationDeLaCaisse = {
    id, genre: 'paiement', date: laDate.date, montant: leMontant.montant, categorie_id: null, taux_tva: null,
    encaissements_du_jour: null, piece_id: piece.id, origine: dossier.quiEcrit, cree_par: dossier.utilisateur,
    remplace_id: null, retire_le: null,
  }
  const caisse = avecLOperation(dossier.caisse, operation)
  // 10. La caisse jamais négative, quand le paiement fait sortir des espèces.
  if (leMontant.centimes < 0) {
    const negative = refusDeLaCaisse(caisse, 'paiement', leMontant.centimes)
    if (negative) return non(negative)
  }
  return { etat: 'accepte', operation, caisse }
}

/** Le même jugement, selon le drapeau : `absent` tant que la migration n'est pas dans l'export. */
export function jugerLeReglement(saisie: SaisieDuReglement, dossier: DossierDeLaCaisse, pieces: readonly PieceDuPaiement[],
  id: string): JugementDuReglement {
  return jugerLeReglementSelon(PAIEMENT_PAR_LA_CAISSE_EXPORTE, saisie, dossier, pieces, id)
}

// ── Les paiements par la caisse, tels que les moteurs les lisent (étape C9a) ─────────────────────────────────────────

/** Ce que la dérivation lit d'une opération : son genre, sa pièce, sa date, son montant, son retrait et son remplacement. */
export type OperationPayante = Pick<OperationCaisse, 'id' | 'genre' | 'piece_id' | 'date' | 'montant' | 'retire_le' | 'remplace_id'>

/**
 * Les PAIEMENTS DE PIÈCES par la caisse que `paiementsDesPieces` (lib/rattachement.ts) reçoit, tirés des opérations lues :
 * le genre `paiement`, une pièce citée, ni retiré (`retire_le` ; la base retire celle qu'elle remplace), ni désigné par
 * une autre (`remplace_id`, défensivement, comme `recettesVivantes`), d'un montant non nul. `enBase` : la migration est-elle
 * en base ? Faux, AUCUN — sans regarder les opérations : la base d'aujourd'hui n'en écrit pas
 * (`regler_piece_par_la_caisse` n'existe pas), sa garde refuse la contrepartie qu'on écrirait, et la liste vide rend aux
 * moteurs, au caractère près, ce qu'ils rendaient avant la caisse. Triés par date puis par opération.
 */
export function paiementsParLaCaisseSelon(enBase: boolean, operations: readonly OperationPayante[]): PartPayeeParLaCaisse[] {
  if (!enBase) return []
  const remplacees = new Set(operations.flatMap((o) => (o.remplace_id ? [o.remplace_id] : [])))
  return operations
    .filter((o) => o.genre === 'paiement' && o.piece_id != null && o.retire_le == null && !remplacees.has(o.id) && o.montant !== 0)
    .map((o) => ({ operation_caisse_id: o.id, piece_id: o.piece_id!, date: o.date, montant: o.montant }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.operation_caisse_id.localeCompare(b.operation_caisse_id))
}

/** Les mêmes, selon le drapeau : aucun tant que la migration n'est pas dans l'export. */
export function paiementsParLaCaisse(operations: readonly OperationPayante[]): PartPayeeParLaCaisse[] {
  return paiementsParLaCaisseSelon(PAIEMENT_PAR_LA_CAISSE_EXPORTE, operations)
}

/**
 * Les paiements par la caisse de CE dossier, tels qu'un écran les passe aux moteurs, selon le drapeau et la lecture de la
 * caisse (lib/caisseLecture.ts, `lireLaCaisse`) — la même lecture, pour le cabinet, que celle de ses recettes : rien de plus
 * n'est lu, rien n'est ouvert au client. NUL quand rien ne doit s'en tirer, comme un relevé lu en partie : la lecture pas
 * encore revenue, celle d'un autre dossier (`DossierDetail` reste monté), ou lue en partie — une pièce payée en espèces y
 * paraîtrait « sans paiement ». Le drapeau BAISSÉ, aucun, quelle que soit la lecture : aucun écran n'attend la caisse pour
 * ses paiements, ni ne change quoi que ce soit à ce qu'il rendait. Une caisse pas en base (`enBase` faux) n'en a aucun.
 */
export function paiementsParLaCaisseDuDossierSelon(enBase: boolean, lecture: CaisseLue | null, dossierId: string):
  PartPayeeParLaCaisse[] | null {
  if (!enBase) return []
  if (lecture === null || lecture.dossierId !== dossierId) return null
  if (!lecture.enBase) return []
  if (!lecture.complete) return null
  return paiementsParLaCaisseSelon(true, lecture.lignes)
}

/** La même, selon le drapeau. */
export function paiementsParLaCaisseDuDossier(lecture: CaisseLue | null, dossierId: string): PartPayeeParLaCaisse[] | null {
  return paiementsParLaCaisseDuDossierSelon(PAIEMENT_PAR_LA_CAISSE_EXPORTE, lecture, dossierId)
}

// ── La contrepartie d'un paiement ─────────────────────────────────────────────────────────────────────────────────────

/** Une ligne du brouillon qui cite un paiement et sa pièce : la contrepartie que l'application écrit sous la RLS. */
export interface LigneDeContrepartie {
  date: string
  compte: string
  sens: 'debit' | 'credit'
  montant: number
  piece_id: string
  operation_caisse_id: string
}

/**
 * Ce que la garde du brouillon refuserait de CETTE contrepartie, dans son ordre et sous ses mots, ou rien. `caisse` est
 * celle du dossier de la ligne : une opération qui n'y est pas ne la suit pas. `dejaEcrites` sont les lignes qui citent
 * déjà ce paiement (leur montant). Le compte de la caisse vient du PLAN du dossier (`caisse.compteCaisse`).
 */
export function refusDeLaContrepartie(ligne: LigneDeContrepartie, caisse: EtatDeLaCaisse,
  dejaEcrites: readonly { montant: number }[]): RefusCaisse | null {
  const paiement = caisse.operations.find((o) => o.id === ligne.operation_caisse_id)
  if (paiement == null || paiement.date !== ligne.date || paiement.retire_le != null || paiement.piece_id !== ligne.piece_id) {
    return refusDuPaiement('contrepartie_ne_suit_pas')
  }
  if (ligne.compte !== caisse.compteCaisse) return refusDuPaiement('contrepartie_compte', caisse.compteCaisse)
  if (ligne.sens !== (paiement.montant > 0 ? 'debit' : 'credit')) return refusDuPaiement('contrepartie_sens')
  const centimes = (m: number) => Math.round(m * 100)
  const deja = dejaEcrites.reduce((s, l) => s + centimes(l.montant), 0)
  if (deja + centimes(ligne.montant) > Math.abs(centimes(paiement.montant))) return refusDuPaiement('contrepartie_au_dela')
  return null
}

/**
 * La contrepartie d'un paiement par la caisse, telle que l'application l'écrit avec les écritures de sa pièce : une
 * ligne, au compte de la caisse du plan, à la date du paiement, de son montant, dans le sens de ses espèces. Celle que
 * la garde admet, et rien d'autre.
 */
export function contrepartieDuPaiement(paiement: Pick<OperationDeLaCaisse, 'id' | 'date' | 'montant' | 'piece_id'>,
  compteCaisse: string): LigneDeContrepartie | null {
  if (paiement.piece_id == null || paiement.montant === 0) return null
  return {
    date: paiement.date, compte: compteCaisse, sens: paiement.montant > 0 ? 'debit' : 'credit',
    montant: Math.abs(paiement.montant), piece_id: paiement.piece_id, operation_caisse_id: paiement.id,
  }
}

// ── La pièce qu'un paiement cite ──────────────────────────────────────────────────────────────────────────────────────

/** Ce que la garde de la pièce regarde : son dossier, son type, sa désignation. */
export type PieceGardee = Pick<Piece, 'id' | 'dossier_id' | 'type_piece' | 'facture_id'>

/**
 * Ce que `garder_piece_payee_par_la_caisse` refuserait de CE changement d'une pièce, dans son ordre et sous ses mots, ou
 * rien. `operations` sont celles de la caisse du dossier de la pièce (retirées comprises : un paiement retiré la garde
 * encore dans son dossier) ; `factureDesignee`, ce que la désignation neuve désigne, lu (sa source, son numéro).
 */
export function refusDuChangementDeLaPiece(avant: PieceGardee, apres: PieceGardee,
  operations: readonly Pick<OperationDeLaCaisse, 'genre' | 'piece_id' | 'retire_le'>[],
  factureDesignee: { numero: string | null; source_de_la_vente: boolean } | null): RefusCaisse | null {
  const citee = operations.filter((o) => o.piece_id === avant.id)
  if (apres.dossier_id !== avant.dossier_id && citee.length > 0) return refusDuPaiement('piece_change_de_dossier')
  if (!citee.some((o) => o.genre === 'paiement' && o.retire_le == null)) return null
  if (apres.type_piece !== 'achat' && apres.type_piece !== 'vente') return refusDuPaiement('piece_change_de_type')
  if (apres.facture_id != null && apres.facture_id !== avant.facture_id && factureDesignee?.source_de_la_vente) {
    return refusDuPaiement('piece_devient_exemplaire', factureDesignee.numero ?? '(sans numéro)')
  }
  return null
}

// ── Le mouvement d'avant l'ouverture ──────────────────────────────────────────────────────────────────────────────────

/**
 * Ce que `garder_caisse_depuis_l_ouverture` refuserait du classement de CE mouvement sur le compte `compte`, ou rien : un
 * mouvement qui ARRIVE sur la caisse du plan — classé, ou déplacé — daté d'avant l'ouverture du DOSSIER (la plus ancienne
 * date de sa reprise). Un mouvement déjà classé sur la caisse, que rien ne déplace, ne se juge pas : il se retire comme
 * hier. Après tous les refus d'`ecrire_mouvement_compte_bilan` : la garde juge la ligne qu'elle écrit.
 */
export function refusDuMouvementAvantLOuverture(ligne: { date: string; compte_bilan: string | null }, compte: string,
  etat: Pick<EtatDeLaCaisse, 'compteCaisse' | 'ouvertures'>): RefusCaisse | null {
  if (compte !== etat.compteCaisse || ligne.compte_bilan === compte) return null
  const ouverture = ouvertureDuDossier(etat)
  return ouverture != null && ligne.date < ouverture ? refusDuPaiement('mouvement_avant_l_ouverture', jourDit(ouverture)) : null
}
