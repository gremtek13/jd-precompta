import { paiementNet, seuilAlignement } from './alignementBanque'
import { jourDit, sansLOperation, type OperationDeLaCaisse } from './caisse'
import {
  dossierDeLEcran, euros, lireLeMontantSaisi, MONTANT_ILLISIBLE, refusDuRetraitDeLOperation, soldeAuJour,
  type ContexteDeLaCaisse, type DonneesDeLaCaisse,
} from './caisseEcran'
import { DEVISE_PIVOT } from './devises'
import { formatMoney } from './format'
import type { LectureComplete } from './lectureComplete'
import {
  especesEntrentPour, jugerLeReglementSelon, MOTS_DU_PAIEMENT, PAIEMENT_PAR_LA_CAISSE_EXPORTE, paiementsParLaCaisseSelon,
  refusDuChangementDeLaPiece, type PieceDuPaiement, type SaisieDuReglement,
} from './paiementParLaCaisse'
import { estParLeReleve, type PartPayeeParLaCaisse, type PaiementDePiece } from './rattachement'
import type { FactureEmise, OperationCaisse, Piece } from './types'

// LE PAIEMENT D'UNE PIÈCE PAR LA CAISSE, À L'ÉCRAN DU CABINET (ligne 26.6, étape C9b ; CAISSE-Q4, (B)). La conception :
// HISTORIQUE.md, « LA CAISSE : LA SAISIE DU PRATICIEN ET LA PIÈCE RÉGLÉE PAR LA CAISSE — LA CONCEPTION REPRISE », § 8 ; la base :
// la migration `paiement_par_la_caisse`, PRÉPARÉE (supabase/preparees/), pas encore appliquée ; ses refus redits avant le clic :
// lib/paiementParLaCaisse.ts (C8) ; les moteurs qui lisent ses paiements : C9a.
//
// CE QUE CE MODULE ASSEMBLE, sans une règle recopiée : la fiche d'une pièce (pages/dossier/ReglementParLaCaisse.tsx) — ses
// paiements par la caisse, ce qu'il reste à régler, la saisie TELLE QU'ELLE PART à `regler_piece_par_la_caisse` et son verdict
// (`jugerLeReglementSelon`), la confirmation qui nomme ce qui part, le retrait d'un paiement (`retirer_operation_caisse`,
// la fonction de la caisse, jugé par `refusDuRetrait`) ; les refus de la garde de la pièce (`refusDuChangementDeLaPiece`) dits
// avant l'enregistrement, la désignation et la suppression ; et ce que l'onglet Justificatifs dit d'une pièce payée en
// espèces, à part de « Rapprochée », qui dit un mouvement bancaire.
//
// LE DRAPEAU. `PAIEMENT_PAR_LA_CAISSE_EXPORTE` BAISSÉ, rien ne se lit ni ne s'offre : la fiche est celle d'hier, au caractère
// près (`etatDeLaCaisseDeLaFiche` rend `absente`, `paiementsDeLaLecture` aucun paiement, le verdict `absent`). Lu à chaque
// appel, jamais au chargement : les tests le jouent dans ses deux états (`vi.mock`, un accesseur).
//
// PUR : aucun appel au réseau, et pas même un import de la lecture (lib/caisseDuDossierLecture.ts importe le client) — la forme
// lue est redite ici, structurellement.

// ── La caisse que la fiche lit ────────────────────────────────────────────────────────────────────────────────────────

/** La lecture de l'onglet Caisse (`lireLaCaisseDuDossier`), telle que l'onglet Justificatifs la tient pour sa fiche. */
export type LectureDeLaCaisseDeLaPiece =
  | { dossierId: string; etat: 'absente' }
  | { dossierId: string; etat: 'incomplete'; motif: string }
  | { dossierId: string; etat: 'lue'; donnees: DonneesDeLaCaisse }

export type EtatDeLaCaisseDeLaFiche =
  /** Le drapeau baissé, ou la caisse pas en base : la fiche ne dit rien de la caisse, et n'offre rien. */
  | { etat: 'absente' }
  /** La lecture n'est pas revenue, ou elle est celle d'un autre dossier : rien ne se dit encore. */
  | { etat: 'en_attente' }
  /** Lue en partie : la fiche le dit, et n'offre aucun geste. */
  | { etat: 'incomplete'; motif: string }
  | { etat: 'lue'; donnees: DonneesDeLaCaisse }

/** La caisse que la fiche d'une pièce juge, selon le drapeau et la lecture de CE dossier. */
export function etatDeLaCaisseDeLaFiche(lecture: LectureDeLaCaisseDeLaPiece | null, dossierId: string): EtatDeLaCaisseDeLaFiche {
  if (!PAIEMENT_PAR_LA_CAISSE_EXPORTE) return { etat: 'absente' }
  if (lecture === null || lecture.dossierId !== dossierId) return { etat: 'en_attente' }
  if (lecture.etat === 'absente') return { etat: 'absente' }
  if (lecture.etat === 'incomplete') return { etat: 'incomplete', motif: lecture.motif }
  return { etat: 'lue', donnees: lecture.donnees }
}

/**
 * Les paiements de pièces par la caisse de CE dossier, tirés de la lecture de l'onglet Caisse : AUCUN le drapeau baissé ou la
 * caisse pas en base ; NULS tant que la lecture n'est pas revenue pour ce dossier, ou lue en partie — une pièce payée en espèces
 * y paraîtrait sans paiement ; sinon les paiements vivants (`paiementsParLaCaisseSelon`).
 */
export function paiementsDeLaLecture(lecture: LectureDeLaCaisseDeLaPiece | null, dossierId: string): PartPayeeParLaCaisse[] | null {
  const etat = etatDeLaCaisseDeLaFiche(lecture, dossierId)
  if (etat.etat === 'absente') return []
  if (etat.etat !== 'lue') return null
  return paiementsParLaCaisseSelon(true, etat.donnees.operations)
}

/** Les pièces qu'au moins un paiement par la caisse règle : ce que « Payée en espèces » dit sur leur ligne. */
export function piecesPayeesEnEspeces(paiements: readonly PartPayeeParLaCaisse[]): ReadonlySet<string> {
  return new Set(paiements.map((p) => p.piece_id))
}

// ── Les paiements d'une pièce ─────────────────────────────────────────────────────────────────────────────────────────

/** Les opérations de genre `paiement` qui citent CETTE pièce, retirées comprises, de la plus ancienne à la plus récente. */
export function paiementsDeLaPiece(pieceId: string, operations: readonly OperationCaisse[]): OperationCaisse[] {
  return operations.filter((o) => o.genre === 'paiement' && o.piece_id === pieceId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.cree_le.localeCompare(b.cree_le) || a.id.localeCompare(b.id))
}

/** Un paiement nommé : son jour, ses espèces, et ce qu'il fait — jamais un tiers. */
export function paiementNomme(o: Pick<OperationCaisse, 'date' | 'montant'>): string {
  return `${o.montant > 0 ? 'l’encaissement en espèces' : 'le paiement en espèces'} du ${jourDit(o.date)} de ${formatMoney(Math.abs(o.montant))}`
}

/** Les factures validées du dossier, telles que l'onglet les lit pour la section « Ce que cette pièce est ». */
export type FactureDuPaiement = Pick<FactureEmise, 'id' | 'numero' | 'source_de_la_vente'>

/**
 * La pièce telle que `regler_piece_par_la_caisse` la lit, depuis la pièce ENREGISTRÉE (son type, son statut, son montant, sa
 * devise — la base ne lit jamais la saisie de la fiche) et, quand elle est l'exemplaire d'une facture, la facture désignée, lue
 * EN ENTIER (sa source, son numéro). Une désignation que la lecture ne rend pas ne se devine pas : `illisible`, et aucun geste.
 * Et ce que le RELEVÉ en paie (relecture du 01/11/2026) : la base le lit pour juger le reste au centime, et la fiche le dit
 * avant le clic ; tiré des paiements de la pièce (`paiements`, ceux de l'onglet, lus en entier), ou `illisible` quand ils ne le
 * sont pas — un paiement non lu ferait juger un reste qui n'est pas le sien.
 */
export function pieceDuPaiement(
  piece: Pick<Piece, 'id' | 'type_piece' | 'statut' | 'montant_ttc' | 'devise' | 'facture_id'>,
  factures: LectureComplete<FactureDuPaiement> | null,
  paiements: readonly PaiementDePiece[] | null,
): { piece: PieceDuPaiement } | { illisible: string } {
  if (paiements === null) {
    return { illisible: 'les paiements de la pièce par le relevé ne sont pas lus en entier — son reste à régler ne se juge pas' }
  }
  const base = {
    id: piece.id, type_piece: piece.type_piece, statut: piece.statut, montant_ttc: piece.montant_ttc, devise: piece.devise,
    paiementsDuReleve: paiements.filter(estParLeReleve).map((p) => ({ montant: p.montant })),
  }
  if (piece.facture_id == null) return { piece: { ...base, exemplaire: null } }
  if (factures === null) return { illisible: 'les factures émises du dossier ne sont pas encore lues' }
  if (!factures.complete) return { illisible: `les factures émises du dossier : ${factures.motif ?? 'lecture incomplète'}` }
  const f = factures.lignes.find((x) => x.id === piece.facture_id)
  if (!f) return { illisible: 'la facture dont cette pièce est l’exemplaire n’est pas dans les factures lues' }
  return { piece: { ...base, exemplaire: { numero: f.numero, source_de_la_vente: f.source_de_la_vente } } }
}

/**
 * Ce qu'il reste à régler de la pièce, en centimes positifs : son montant moins le TOTAL SIGNÉ de ses paiements — la banque et la
 * caisse mêlées (`paiementNet`). Nul quand on ne sait pas : un montant non lu, une pièce en devise (son montant en euros n'est
 * qu'un provisoire), des paiements lus en partie (`paiements` nul). Zéro : rien ne reste.
 */
export function resteARegler(piece: Pick<Piece, 'montant_ttc' | 'devise'>, paiements: readonly PaiementDePiece[] | null): number | null {
  if (paiements === null || piece.montant_ttc == null || (piece.devise != null && piece.devise !== DEVISE_PIVOT)) return null
  return Math.max(0, Math.round(Math.abs(piece.montant_ttc) * 100) - paiementNet(paiements).centimes)
}

/** Le sens des espèces d'une pièce : elles ENTRENT pour une vente, SORTENT pour un achat — l'inverse pour un avoir. La règle
 *  du module (`especesEntrentPour`), celle que la base juge. */
export function especesEntrent(piece: Pick<Piece, 'type_piece' | 'montant_ttc'>): boolean {
  return especesEntrentPour(piece)
}

/**
 * Le montant que le champ propose : le reste à régler, SIGNÉ comme le relevé (négatif quand les espèces sortent), écrit comme
 * le cabinet l'écrirait (« -80,00 »). Rien quand on ne sait pas ce qui reste, ou qu'il ne reste rien : le champ attend.
 */
export function montantPropose(piece: Pick<Piece, 'type_piece' | 'montant_ttc' | 'devise'>, paiements: readonly PaiementDePiece[] | null): string {
  const reste = resteARegler(piece, paiements)
  if (reste === null || reste === 0) return ''
  const signe = especesEntrent(piece) ? '' : '-'
  return `${signe}${Math.floor(reste / 100)},${String(reste % 100).padStart(2, '0')}`
}

// ── La saisie, et son verdict avant le clic ───────────────────────────────────────────────────────────────────────────

/** Ce que le cabinet a tapé, tel quel. */
export interface FormulaireDuReglement { date: string; montant: string }

export type VerdictDuReglement =
  /** La migration n'est pas en base : rien ne se règle par la caisse. */
  | { etat: 'absent' }
  /** Rien de tapé qui permette de juger : le bouton attend, sans reproche. */
  | { etat: 'vide' }
  | { etat: 'illisible'; message: string }
  /** Ce que la base refuserait, dans son ordre et sous ses mots. */
  | { etat: 'refuse'; message: string }
  /** Le paiement que la base écrirait, et la caisse qui en résulte. */
  | { etat: 'permis'; saisie: SaisieDuReglement; operation: OperationDeLaCaisse; soldeDuJour: number }

/** La saisie telle qu'elle PART : la pièce, la date, le montant lu — ses paramètres, rien d'autre. */
export function saisieDuReglement(f: FormulaireDuReglement, pieceId: string): SaisieDuReglement {
  const lu = lireLeMontantSaisi(f.montant)
  return { piece_id: pieceId, date: f.date === '' ? null : f.date, montant: typeof lu === 'number' ? lu : null }
}

/**
 * Le verdict de « Régler par la caisse » : le refus de `regler_piece_par_la_caisse` sur la saisie TELLE QU'ELLE PART, sous le
 * profil du cabinet (le seul qui règle d'ici), dans le dossier lu en entier ; ou le paiement qu'elle écrirait, avec le solde de
 * la caisse à la fin de son jour.
 */
export function verdictDuReglement(
  f: FormulaireDuReglement, ctx: ContexteDeLaCaisse, d: DonneesDeLaCaisse, piece: PieceDuPaiement,
): VerdictDuReglement {
  if (!PAIEMENT_PAR_LA_CAISSE_EXPORTE) return { etat: 'absent' }
  if (f.date === '' || f.montant.trim() === '') return { etat: 'vide' }
  if (lireLeMontantSaisi(f.montant) === 'illisible') return { etat: 'illisible', message: MONTANT_ILLISIBLE }
  const saisie = saisieDuReglement(f, piece.id)
  const jugement = jugerLeReglementSelon(true, saisie, dossierDeLEcran(ctx, d), [piece], 'nouveau-paiement')
  if (jugement.etat === 'absent') return { etat: 'absent' }
  if (jugement.etat === 'refuse') return { etat: 'refuse', message: jugement.refus.message }
  return { etat: 'permis', saisie, operation: jugement.operation, soldeDuJour: soldeAuJour(jugement.caisse, jugement.operation.date) }
}

/**
 * L'AVERTISSEMENT AVANT LE CLIC (relecture du 01/11/2026) : payer en espèces une pièce que la BANQUE paie déjà, en tout ou en
 * partie — un paiement en double se glisse là —, ou au-delà de ce qui reste. Dit sur le reste de TOUS ses paiements (`paiementNet`,
 * le relevé et la caisse mêlés, comme `partsDesPaiements` les compte) : ce que le relevé et la caisse ont déjà payé, ce qu'il
 * reste, et, quand ce paiement la paierait en trop au-delà de l'écart d'alignement, combien — la Vue d'ensemble le dira ensuite
 * (`pieces-payees-en-trop`). Rien n'est refusé : la base ne juge que les paiements par la caisse (son plafond) et le reste au
 * centime ; un acompte réglé par la banque et un solde en espèces sont légitimes. Rien quand il n'y a rien à dire : ni paiement
 * du relevé, ni trop-payé.
 */
export function avertissementDuReglement(
  piece: Pick<PieceDuPaiement, 'id' | 'montant_ttc' | 'devise' | 'paiementsDuReleve'>,
  d: Pick<DonneesDeLaCaisse, 'operations'>,
  centimes: number,
): string | null {
  const parLaCaisse = d.operations.filter((o) => o.genre === 'paiement' && o.piece_id === piece.id && o.retire_le == null)
  const releve = paiementNet(piece.paiementsDuReleve)
  const caisse = paiementNet(parLaCaisse)
  const connu = piece.montant_ttc != null && (piece.devise == null || piece.devise === DEVISE_PIVOT)
  const pieceCentimes = connu ? Math.abs(Math.round(piece.montant_ttc! * 100)) : null
  const reste = pieceCentimes === null ? null : pieceCentimes - paiementNet([...piece.paiementsDuReleve, ...parLaCaisse]).centimes
  const apres = pieceCentimes === null ? null
    : pieceCentimes - paiementNet([...piece.paiementsDuReleve, ...parLaCaisse, { montant: centimes / 100 }]).centimes
  const enTrop = apres !== null && apres < 0 && -apres > Math.round(seuilAlignement(piece.montant_ttc ?? 0) * 100) ? -apres : null
  const parties: string[] = []
  if (releve.centimes > 0) {
    const deja = `Cette pièce est déjà payée de ${euros(releve.centimes)} par le relevé`
      + `${caisse.centimes > 0 ? ` et de ${euros(caisse.centimes)} par la caisse` : ''}`
    parties.push(reste === null ? `${deja}.`
      : reste > 0 ? `${deja} : il en reste ${euros(reste)} à régler, tous paiements compris.`
        : `${deja} : ses paiements la règlent déjà.`)
  }
  if (enTrop !== null) {
    parties.push(`Ce paiement la paierait de ${euros(enTrop)} en trop, tous paiements compris — un paiement en double ? La Vue `
      + 'd’ensemble le dira (« pièce payée plus que son montant »).')
  }
  return parties.length === 0 ? null : parties.join(' ')
}

/**
 * La confirmation qui NOMME ce qui part : le paiement (son jour, ses espèces, leur sens), la pièce (son fichier — la fiche la
 * montre comme ailleurs, la caisse n'en stocke rien), la caisse de ce jour-là, et l'écriture qui suivra — la contrepartie au
 * compte de la caisse DU PLAN, avec les écritures de la pièce ; et l'avertissement de la fiche, quand elle en dit un
 * (`avertissementDuReglement` : la pièce déjà payée par la banque, ou payée en trop).
 */
export function confirmationDuReglement(
  nomDeLaPiece: string, v: Extract<VerdictDuReglement, { etat: 'permis' }>, compteCaisse: string, avertissement: string | null,
): string {
  return `Régler la pièce « ${nomDeLaPiece} » par la caisse : ${paiementNomme(v.operation)} ? `
    + `${avertissement === null ? '' : `${avertissement} `}`
    + `La caisse du ${jourDit(v.operation.date)} passera à ${euros(v.soldeDuJour)}. Sa contrepartie au compte de la caisse `
    + `(${compteCaisse}) s’écrit avec les écritures de la pièce : déjà générées, elles seront à régénérer (Écritures).`
}

// ── Le retrait d'un paiement ──────────────────────────────────────────────────────────────────────────────────────────

/** Le refus de `retirer_operation_caisse` pour ce paiement — la frontière, la caisse qui passerait sous zéro —, ou rien. */
export function refusDuRetraitDuPaiement(operationId: string, ctx: ContexteDeLaCaisse, d: DonneesDeLaCaisse): string | null {
  return refusDuRetraitDeLOperation(operationId, ctx, d)
}

/** La confirmation d'un retrait : le paiement qui part, sa contrepartie avec lui, et la caisse de son jour. */
export function confirmationDuRetraitDuPaiement(o: OperationCaisse, ctx: ContexteDeLaCaisse, d: DonneesDeLaCaisse): string {
  const apres = soldeAuJour(sansLOperation(dossierDeLEcran(ctx, d).caisse, o.id, 'maintenant'), o.date)
  return `Retirer ${paiementNomme(o)} ? La pièce n’est plus payée par la caisse ce jour-là ; la contrepartie de ses écritures `
    + `est retirée avec lui (rien ne se supprime : le paiement reste dans l’historique), et la caisse du ${jourDit(o.date)} `
    + `passera à ${euros(apres)}.`
}

// ── La pièce qu'un paiement cite (`garder_piece_payee_par_la_caisse`) ─────────────────────────────────────────────────

/** Ce que la garde de la pièce regarde d'elle. */
type PieceGardee = Pick<Piece, 'id' | 'dossier_id' | 'type_piece' | 'facture_id'>

/**
 * Le refus de la garde pour la pièce ENREGISTRÉE dont la fiche change le type, ou rien — dit sous le champ, avant
 * l'enregistrement : une pièce qu'un paiement non retiré cite reste d'achat ou de vente.
 */
export function refusDuTypeDeLaPiece(piece: PieceGardee, typeSaisi: Piece['type_piece'], operations: readonly OperationCaisse[]): string | null {
  if (typeSaisi === piece.type_piece) return null
  return refusDuChangementDeLaPiece(piece, { ...piece, type_piece: typeSaisi }, operations, null)?.message ?? null
}

/** Le refus de la garde pour la désignation de cette pièce comme l'exemplaire de CETTE facture, ou rien. */
export function refusDeLaDesignationParLaCaisse(
  piece: PieceGardee, facture: FactureDuPaiement | null, operations: readonly OperationCaisse[],
): string | null {
  if (facture === null) return null
  return refusDuChangementDeLaPiece(piece, { ...piece, facture_id: facture.id }, operations,
    { numero: facture.numero, source_de_la_vente: facture.source_de_la_vente })?.message ?? null
}

// LES MOTS D'UNE PIÈCE QU'UN PAIEMENT CITE, DEVANT SA SUPPRESSION. Le premier est celui de la base, au caractère près, ses
// apostrophes typographiques (`MOTS_DU_PAIEMENT.piece_payee_supprimee`, que `garder_ecriture_de_caisse` lève quand la clé du
// brouillon met à nul la pièce de sa contrepartie) ; le second, celui d'un paiement retiré ; le troisième, quand la caisse n'est
// pas lue en entier et que la base a refusé par sa clé (`operations_caisse_piece`, `on delete restrict`) : on ne sait pas si le
// paiement qui la cite est retiré.
export const SUPPRESSION_PAYEE_PAR_LA_CAISSE = MOTS_DU_PAIEMENT.piece_payee_supprimee.gabarit.replace(/'/g, '’')
export const SUPPRESSION_CITEE_PAR_UN_PAIEMENT_RETIRE = 'Un paiement de la caisse, retiré, cite cette pièce : elle ne se supprime pas — l’opération garde sa pièce pour la piste d’audit. Si elle n’est pas une pièce de ce dossier, change son type en « autre ».'
export const SUPPRESSION_CITEE_PAR_LA_CAISSE = 'Un paiement de la caisse cite cette pièce : elle ne se supprime pas — l’opération garde sa pièce pour la piste d’audit. Si elle n’est pas une pièce de ce dossier, retire d’abord ce paiement s’il ne l’est pas, puis change son type en « autre ».'

/**
 * Une pièce qu'un paiement de la caisse cite — retiré ou non — ne se supprime plus : la clé de l'opération est `on delete
 * restrict` (la piste d'audit garde la pièce de chaque opération écrite). La fiche le dit et n'offre pas « Supprimer » ; « Supprimer
 * la sélection » l'écarte avant sa confirmation (relecture du 01/11/2026), et la nomme. Rien quand aucun paiement ne la cite.
 */
export function suppressionRetenueParLaCaisse(pieceId: string, operations: readonly OperationCaisse[]): string | null {
  const citee = operations.filter((o) => o.piece_id === pieceId)
  if (citee.length === 0) return null
  const vivant = citee.some((o) => o.genre === 'paiement' && o.retire_le == null)
  return vivant ? SUPPRESSION_PAYEE_PAR_LA_CAISSE : SUPPRESSION_CITEE_PAR_UN_PAIEMENT_RETIRE
}

/**
 * LE REFUS DE LA BASE DEVANT LA SUPPRESSION D'UNE PIÈCE QU'UN PAIEMENT CITE, TRADUIT (relecture du 01/11/2026) — quand la caisse
 * n'a pas été lue en entier, la suppression part, et la base refuse de deux façons : la garde du brouillon, quand la contrepartie
 * du paiement y est (la clé du brouillon met sa pièce à nul AVANT que celle de la caisse ne refuse : 23503, ses mots), ou la clé
 * de l'opération elle-même (23503, « violates foreign key constraint "operations_caisse_piece" »). Les mots de l'écran, ou rien
 * pour tout autre refus — l'appelant dit alors celui de la base, tel quel.
 */
export function refusDeSuppressionParLaCaisse(
  erreur: { code?: string | null; message?: string | null; details?: string | null } | null | undefined,
): string | null {
  if (!erreur || erreur.code !== '23503') return null
  if (erreur.message === MOTS_DU_PAIEMENT.piece_payee_supprimee.gabarit) return SUPPRESSION_PAYEE_PAR_LA_CAISSE
  const texte = `${erreur.message ?? ''} ${erreur.details ?? ''}`
  return /operations_caisse_piece|"operations_caisse"/.test(texte) ? SUPPRESSION_CITEE_PAR_LA_CAISSE : null
}
