import { jourDit, quiEcritLaCaisse, refus, sansLOperation, type DossierDeLaCaisse } from './caisse'
import {
  anneeFigee, caisseRejouee, dossierDuClient, refusDuRetraitDuClient, type DossierDuClient, type JourDeLaCaisseDuClient,
  type OperationDuClient,
} from './caisseClient'
import type { LectureDeLaCaisseDuClient } from './caisseClientLecture'
import { euros, lireLeMontantSaisi, soldeAuJour } from './caisseEcran'
import { pourLEspace } from './espaceVentes'
import { formatDate } from './format'
import {
  especesEntrentPour, jugerLeReglementDuClientSelon, PAIEMENT_PAR_LA_CAISSE_EXPORTE, type PieceDuPaiementDuClient,
  type SaisieDuReglement,
} from './paiementParLaCaisse'
import type { Piece } from './types'

// LE PAIEMENT D'UNE PIÈCE PAR LA CAISSE, DEPUIS « MES PIÈCES » (espace client, ligne 26.6, étape C12b ; CAISSE2-Q4, (A)). La
// conception : HISTORIQUE.md, « LA CAISSE : LA SAISIE DU PRATICIEN ET LA PIÈCE RÉGLÉE PAR LA CAISSE — LA CONCEPTION REPRISE
// (CAISSE-Q1 ET Q4) », § 8, « Ce que voit le client » ; la base : `regler_piece_par_la_caisse` (la migration
// `paiement_par_la_caisse`), dont la migration `caisse_du_client` ouvre la branche du client, et `retirer_operation_caisse`.
//
// Le praticien qui porte la case « Caisse » dit qu'il a payé une pièce de « Mes pièces » en espèces de sa caisse — ou qu'il en
// a reçu les espèces, pour une pièce de vente — : un jour et un montant, LES SIENS. L'écran ne lui montre JAMAIS le montant de
// la pièce : il n'en lit que le SENS (`especesEntrentPour`, sur le signe du montant lu), pour signer ce qui part comme le relevé
// — une sortie pour un achat, une entrée pour une vente, l'inverse pour un avoir —, et le client tape un montant sans signe.
//
// CE MODULE NE RECOPIE AUCUNE RÈGLE DE LA BASE : les refus avant le clic sont ceux de `jugerLeReglementDuClientSelon`
// (lib/paiementParLaCaisse.ts, la branche du client), dans leur ordre et sous leurs mots, sur la caisse REJOUÉE de « Ma caisse »
// (lib/caisseClient.ts, `caisseRejouee`) ; le retrait, ceux de `refusDuRetraitDuClient`. Ce qu'il ne lit pas — l'ouverture du
// dossier, l'exemplaire d'une facture source, le plafond d'une pièce validée, le reste au centime (qui lit le relevé et le
// montant) — reste au jugement de la base, et l'écran redit sa phrase après le clic. Les seules règles propres à l'écran sont
// celles de SON formulaire : un montant sans signe, une date dans les années que la caisse a lues, une année que la lecture dit
// figée.
//
// PUR : aucun appel au réseau, aucun import du client Supabase (le type de la lecture seulement).

/** La première année de la caisse que « Mes pièces » lit : celle d'avant l'année en cours, comme « Ma caisse » l'offre. */
export function premiereAnneeLue(anneeEnCours: number): number {
  return anneeEnCours - 1
}

/** Une pièce se paie-t-elle par la caisse ? Une pièce d'achat ou de vente ; une note de frais est payée de la poche. */
export function payableParLaCaisse(piece: Pick<Piece, 'type_piece'>): boolean {
  return piece.type_piece === 'achat' || piece.type_piece === 'vente'
}

/**
 * La pièce telle que le jugement du client la lit : son type et le SENS de ses espèces. Le seul endroit où le montant de la
 * pièce est touché — pour son signe — ; il ne va pas plus loin.
 */
export function pieceVueParLeClient(piece: Pick<Piece, 'id' | 'type_piece' | 'montant_ttc'>): PieceDuPaiementDuClient {
  return { id: piece.id, type_piece: piece.type_piece, especesEntrent: especesEntrentPour(piece) }
}

// ── La caisse que « Mes pièces » lit ──────────────────────────────────────────────────────────────────────────────────

/** Ce que l'écran sait de la caisse, pour dire les paiements et offrir les gestes. */
export type CaisseDeMesPieces =
  /** La case « Caisse » n'est pas sur la société affichée : « Mes pièces » est celle d'hier. */
  | { etat: 'fermee' }
  /** Pas encore revenue : rien n'est dit, rien n'est offert. */
  | { etat: 'attente' }
  /** Illisible, sans la case à la base, ou lue en partie : la phrase le dit ; aucun paiement n'est dit, aucun geste offert. */
  | { etat: 'muette'; texte: string }
  | {
    etat: 'lue'
    operations: readonly OperationDuClient[]
    jours: readonly JourDeLaCaisseDuClient[]
    /** Le dossier tel que les règles le lisent, sur la caisse rejouée ; nul quand elle ne se rejoue pas ou ne s'ouvre pas. */
    dossier: DossierDeLaCaisse | null
    /** Pourquoi aucun geste ne s'offre, quand aucun ne s'offre ; nul sinon. */
    raison: string | null
  }

/**
 * Le paiement du client s'ouvre-t-il sur CE dossier ? Les refus que `regler_piece_par_la_caisse` opposerait à TOUT paiement du
 * client, dans son ordre et sous ses mots : l'accès « Caisse » d'un dossier ni exonéré ni en franchise (`qui_ecrit_la_caisse`),
 * puis le dossier en trésorerie. Le paiement ne lit pas la nature des recettes : sans elle, il s'ouvre.
 */
export function paiementDuClientOuvert(dossier: Pick<DossierDuClient, 'statut_tva' | 'mode_comptable'>): string | null {
  const qui = quiEcritLaCaisse({ cabinet: false, accesCaisse: true, statutTva: dossier.statut_tva })
  if (qui.refus) return qui.refus.message
  if (dossier.mode_comptable !== 'tresorerie') return refus('tresorerie').message
  return null
}

/**
 * La caisse de « Mes pièces », de la lecture : rien sans la case ; rien avant le retour, ni d'une autre société ou d'une autre
 * année ; sa phrase sur une lecture ratée ou partielle ; lue en entier, ses opérations, et ses gestes si la caisse se rejoue,
 * si le paiement du client s'ouvre et si les pièces sont lues en entier.
 */
export function caisseDeMesPieces(e: {
  ouverte: boolean
  lecture: LectureDeLaCaisseDuClient | null
  dossierId: string
  anneeEnCours: number
  moi: string
  aujourdhui: string
  piecesLuesEnEntier: boolean
}): CaisseDeMesPieces {
  if (!e.ouverte) return { etat: 'fermee' }
  const l = e.lecture
  if (l === null || l.dossierId !== e.dossierId || l.annee !== premiereAnneeLue(e.anneeEnCours)) return { etat: 'attente' }
  if (l.etat === 'echec') {
    return { etat: 'muette', texte: `Ta caisse n’a pas pu être lue (${l.motif}) : tes paiements en espèces ne s’affichent pas ici, et aucun ne t’est proposé. Recharge la page.` }
  }
  if (l.etat === 'sans_caisse') {
    return { etat: 'muette', texte: 'Ton accès ne porte plus « Caisse » sur cette société : tes paiements en espèces ne s’affichent pas ici.' }
  }
  if (!l.operations.complete || !l.jours.complete) {
    const motif = l.operations.motif ?? l.jours.motif ?? 'lecture incomplète'
    return { etat: 'muette', texte: `Ta caisse n’a pas pu être lue en entier (${motif}) : tes paiements en espèces ne s’affichent pas ici, et aucun ne t’est proposé. Recharge la page.` }
  }
  const base = { etat: 'lue' as const, operations: l.operations.lignes, jours: l.jours.lignes }
  const rejouee = caisseRejouee(l.jours.lignes, l.operations.lignes, premiereAnneeLue(e.anneeEnCours))
  if (rejouee.etat === null) {
    return { ...base, dossier: null, raison: `Ta caisse ne se recompose pas sur ce qui a été lu (${rejouee.motif}) : aucun paiement en espèces ne t’est proposé. Recharge la page ; si cela dure, dis-le à ton cabinet.` }
  }
  const fermee = paiementDuClientOuvert(l.dossier)
  if (fermee !== null) return { ...base, dossier: null, raison: fermee }
  if (!e.piecesLuesEnEntier) {
    return { ...base, dossier: null, raison: 'Tes pièces n’ont pas pu être lues en entier : aucun paiement en espèces ne t’est proposé. Recharge la page.' }
  }
  const dossier = dossierDuClient({ dossier: l.dossier, moi: e.moi, aujourdhui: e.aujourdhui }, l.nature, rejouee.etat)
  return { ...base, dossier, raison: null }
}

// ── Les paiements d'une pièce ─────────────────────────────────────────────────────────────────────────────────────────

/** Les paiements par la caisse d'une pièce, non retirés, du plus ancien au plus récent. */
export function paiementsDeLaPiece(pieceId: string, operations: readonly OperationDuClient[]): OperationDuClient[] {
  return operations.filter((o) => o.genre === 'paiement' && o.piece_id === pieceId && o.retire_le == null)
    .sort((a, b) => a.date.localeCompare(b.date) || a.cree_le.localeCompare(b.cree_le) || a.id.localeCompare(b.id))
}

/** Le paiement est-il du client LUI-MÊME — la règle de « Ma caisse » : ses seules saisies se retirent. */
export function paiementDuClientLuiMeme(o: Pick<OperationDuClient, 'origine' | 'cree_par'>, moi: string): boolean {
  return o.origine === 'client' && o.cree_par === moi
}

/** Qui a payé, pour le client : « par toi » pour ses seules saisies. */
export function auteurDuPaiement(o: Pick<OperationDuClient, 'origine' | 'cree_par'>, moi: string): string {
  if (o.origine === 'cabinet') return 'par ton cabinet'
  return paiementDuClientLuiMeme(o, moi) ? 'par toi' : 'depuis un autre accès'
}

/** Ce que la pièce dit d'un paiement : « Payée en espèces le 12/03/2026, 80,00 € (par toi) » ; « Encaissée » pour une entrée. */
export function paiementDit(o: Pick<OperationDuClient, 'date' | 'montant' | 'origine' | 'cree_par'>, moi: string): string {
  return `${o.montant > 0 ? 'Encaissée' : 'Payée'} en espèces le ${jourDit(o.date)}, ${euros(Math.abs(Math.round(o.montant * 100)))} (${auteurDuPaiement(o, moi)})`
}

/** Le geste qui ouvre le formulaire, selon le sens des espèces de la pièce. */
export function libelleDuGeste(piece: PieceDuPaiementDuClient): string {
  return piece.especesEntrent ? 'Encaissée en espèces dans ta caisse' : 'Payée en espèces de ta caisse'
}

/** La pièce nommée pour le client : par le jour de son dépôt, jamais par un fournisseur, un client ou un fichier. */
export function pieceNommee(deposeeLe: string): string {
  return `la pièce déposée le ${formatDate(deposeeLe)}`
}

/**
 * Une opération de genre `paiement`, nommée dans « Ma caisse » : par le jour de dépôt de sa pièce (`deposeeLe`, le
 * `created_at` lu), jamais par un fournisseur, un fichier ni un libellé ; sans ce jour (la pièce pas lue), par son sens seul.
 */
export function paiementDansMaCaisse(o: Pick<OperationDuClient, 'montant'>, deposeeLe: string | null): string {
  if (deposeeLe === null) return o.montant < 0 ? 'Pièce payée en espèces' : 'Espèces reçues pour une pièce'
  return `${o.montant < 0 ? 'Paiement' : 'Encaissement'} de ${pieceNommee(deposeeLe)}`
}

// ── Le formulaire, et ce qui en part ──────────────────────────────────────────────────────────────────────────────────

/** Ce que le praticien a tapé, tel quel : un jour, un montant SANS signe. */
export interface FormulaireDuPaiement { date: string; montant: string }

export const MONTANT_DU_PAIEMENT_ILLISIBLE = 'Le montant n’est pas un nombre : écris par exemple 80,00, sans signe.'
export const MONTANT_SANS_SIGNE = 'Écris le montant sans signe : ta caisse sait déjà si ces espèces sortent ou entrent.'

/** Une date d'avant la première année lue : la caisse rejouée ne la porte pas. */
export function avantLaCaisseLue(premiere: number): string {
  return `Ta caisse est lue ici depuis le 01/01/${premiere} : pour un paiement plus ancien, demande à ton cabinet.`
}

/** Une année que la lecture dit figée par la validation de ses comptes. */
export function anneeValidee(annee: number): string {
  return `Ton cabinet a validé tes comptes de ${annee} : ta caisse de cette année ne change plus.`
}

/** Ce qui part à `regler_piece_par_la_caisse` : la pièce, le jour, le montant SIGNÉ par le sens de ses espèces. */
export function saisieDuPaiement(f: FormulaireDuPaiement, piece: PieceDuPaiementDuClient): SaisieDuReglement {
  const lu = lireLeMontantSaisi(f.montant)
  const montant = typeof lu === 'number' ? (piece.especesEntrent ? lu : -lu) : null
  // `-0` n'est pas un montant : zéro reste zéro, que la base refuse sous ses mots.
  return { piece_id: piece.id, date: f.date === '' ? null : f.date, montant: montant === 0 ? 0 : montant }
}

export type VerdictDuPaiement =
  | { etat: 'vide' }
  | { etat: 'refuse'; message: string }
  | { etat: 'permis'; saisie: SaisieDuReglement; soldeApres: number }

/**
 * Le verdict du formulaire, avant le clic : les règles du formulaire, puis le refus de la base sur la saisie TELLE QU'ELLE
 * PART (`jugerLeReglementDuClientSelon`), aux mots du client ; permis, avec la caisse du jour après le paiement.
 */
export function verdictDuPaiement(f: FormulaireDuPaiement, piece: PieceDuPaiementDuClient, dossier: DossierDeLaCaisse,
  jours: readonly JourDeLaCaisseDuClient[], premiere: number): VerdictDuPaiement {
  return verdictDuPaiementSelon(PAIEMENT_PAR_LA_CAISSE_EXPORTE, f, piece, dossier, jours, premiere)
}

export function verdictDuPaiementSelon(enBase: boolean, f: FormulaireDuPaiement, piece: PieceDuPaiementDuClient,
  dossier: DossierDeLaCaisse, jours: readonly JourDeLaCaisseDuClient[], premiere: number): VerdictDuPaiement {
  if (f.date === '' || f.montant.trim() === '') return { etat: 'vide' }
  const lu = lireLeMontantSaisi(f.montant)
  if (lu === 'illisible') return { etat: 'refuse', message: MONTANT_DU_PAIEMENT_ILLISIBLE }
  if (lu !== null && (lu < 0 || Object.is(lu, -0))) return { etat: 'refuse', message: MONTANT_SANS_SIGNE }
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.date) && f.date < `${premiere}-01-01`) return { etat: 'refuse', message: avantLaCaisseLue(premiere) }
  const annee = Number(f.date.slice(0, 4))
  if (anneeFigee(jours, annee) === true) return { etat: 'refuse', message: anneeValidee(annee) }
  const saisie = saisieDuPaiement(f, piece)
  const juge = jugerLeReglementDuClientSelon(enBase, saisie, dossier, [piece], 'nouveau-paiement')
  if (juge.etat === 'absent') return { etat: 'refuse', message: 'Le paiement d’une pièce par ta caisse ne s’offre pas encore.' }
  if (juge.etat === 'refuse') return { etat: 'refuse', message: pourLEspace('client', juge.refus.message) }
  return { etat: 'permis', saisie, soldeApres: soldeAuJour(juge.caisse, saisie.date!) }
}

/** La confirmation d'un paiement : la pièce par son dépôt, le jour, le montant, et la caisse du jour après lui. */
export function confirmationDuPaiement(saisie: SaisieDuReglement, deposeeLe: string, soldeApres: number): string {
  const montant = saisie.montant ?? 0
  const jour = jourDit(saisie.date ?? '')
  const centimes = euros(Math.abs(Math.round(montant * 100)))
  const quoi = montant > 0
    ? `Encaisser en espèces dans ta caisse ${pieceNommee(deposeeLe)} : ${centimes} reçus le ${jour} ?`
    : `Payer en espèces de ta caisse ${pieceNommee(deposeeLe)} : ${centimes} sortis le ${jour} ?`
  return `${quoi} Ta caisse du ${jour} passera à ${euros(soldeApres)}. Ton cabinet le voit aussitôt.`
}

/** Ce que l'écran dit une fois le paiement écrit. */
export function paiementEnregistre(saisie: SaisieDuReglement, deposeeLe: string): string {
  const montant = saisie.montant ?? 0
  return `Enregistré : ${pieceNommee(deposeeLe)}, ${montant > 0 ? 'encaissée' : 'payée'} en espèces le ${jourDit(saisie.date ?? '')}, `
    + `${euros(Math.abs(Math.round(montant * 100)))}.`
}

// ── Le retrait d'un paiement ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Le retrait s'offre-t-il sur CE paiement ? Les siens seulement (la base refuse les autres), sur une année que la lecture ne
 * dit pas figée ; nul quand il ne s'offre pas, sinon le refus de la base avant le clic (la caisse qui passerait sous zéro), ou
 * rien.
 */
export function retraitDuPaiement(o: OperationDuClient, dossier: DossierDeLaCaisse, jours: readonly JourDeLaCaisseDuClient[], moi: string):
  { offert: false } | { offert: true; refus: string | null } {
  if (!paiementDuClientLuiMeme(o, moi) || o.retire_le != null) return { offert: false }
  if (anneeFigee(jours, Number(o.date.slice(0, 4))) === true) return { offert: false }
  return { offert: true, refus: refusDuRetraitDuClient(o.id, dossier) }
}

/** La confirmation d'un retrait : ce qui part, et la caisse du jour après lui. */
export function confirmationDuRetraitDuPaiement(o: OperationDuClient, deposeeLe: string, dossier: DossierDeLaCaisse): string {
  const apres = soldeAuJour(sansLOperation(dossier.caisse, o.id, 'maintenant'), o.date)
  const quoi = o.montant > 0 ? 'l’encaissement en espèces' : 'le paiement en espèces'
  return `Retirer ${quoi} du ${jourDit(o.date)}, ${euros(Math.abs(Math.round(o.montant * 100)))}, de ${pieceNommee(deposeeLe)} ? `
    + `Il reste dans l’historique de ta caisse, retiré, et ta caisse du ${jourDit(o.date)} passera à ${euros(apres)}. `
    + 'Pour le corriger, retire-le puis enregistre le bon.'
}

/** Ce que l'écran dit une fois le paiement retiré. */
export function paiementRetire(o: Pick<OperationDuClient, 'date' | 'montant'>): string {
  return `Retiré : ${o.montant > 0 ? 'l’encaissement en espèces' : 'le paiement en espèces'} du ${jourDit(o.date)}, `
    + `${euros(Math.abs(Math.round(o.montant * 100)))}.`
}
