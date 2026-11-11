// LES ACHATS DU CLIENT, EN BASE (ligne 51.5, partie B, étape B4 ; migration `achats_du_client`, PRÉPARÉE le 11/11/2026 :
// supabase/preparees/20261111237000_achats_du_client.sql ; l'essai : supabase/essais/achatsClient.sql). MEG2-Q4 : l'échéance
// d'une facture d'achat, lue sur la facture électronique reçue (BT-9), saisie sinon, jamais devinée ; MEG2-Q5 : « je l'ai
// payée », déclaré par l'accès « Achats », une PROPOSITION qui n'écrit rien dans le relevé, les écritures, la caisse ni les
// rapprochements. Ce module redit, sous les mêmes mots et dans le même ordre, ce que les fonctions de la base refusent —
// pour que l'écran (étape B5) le dise AVANT le clic, sur la saisie telle qu'elle part —, et déduit l'état d'une échéance.
// Il ne lit ni n'écrit rien : les écrans passeront par `fixer_echeance_piece`, `declarer_paiement_piece`,
// `retirer_paiement_declare` et `marquer_vues` seules. achatsClient.test.ts le confronte au texte de la migration.

/** La migration est-elle en base ? Baissé tant qu'elle n'est que préparée : aucun écran ne lit ses tables ni n'appelle ses
 *  fonctions, et ses deux tables restent hors du plan de sauvegarde (sauvegarde.ts, `auPlanDesAchatsDuClient`). */
export const ACHATS_DU_CLIENT_PREVUS: boolean = false

/** Les deux tables de la migration, dans l'ordre de leur restauration. */
export const TABLES_DES_ACHATS_DU_CLIENT = ['paiements_declares', 'pieces_vues'] as const

/** Les moyens d'un paiement déclaré : une liste fermée, aucun texte libre (la contrainte `paiements_declares_moyen`). */
export const MOYENS_DECLARES = ['virement', 'prelevement', 'carte', 'cheque', 'especes', 'autre'] as const
export type MoyenDeclare = (typeof MOYENS_DECLARES)[number]

export const LIBELLES_DES_MOYENS: Readonly<Record<MoyenDeclare, string>> = {
  virement: 'virement', prelevement: 'prélèvement', carte: 'carte', cheque: 'chèque', especes: 'espèces', autre: 'autre',
}

/** Une ligne de `paiements_declares`. */
export interface PaiementDeclare {
  id: string
  dossier_id: string
  piece_id: string
  date_paiement: string
  moyen: MoyenDeclare
  montant: number
  declare_par: string
  declare_le: string
  retire_par: string | null
  retire_le: string | null
}

/** Une ligne de `pieces_vues` : la première fois qu'un accès « Achats » a vu une facture d'achat. */
export interface PieceVue {
  id: string
  dossier_id: string
  piece_id: string
  utilisateur: string
  vue_le: string
}

/** Ce que la base garde de l'échéance d'une pièce (les trois colonnes neuves de `pieces`, et sa source). */
export interface EcheanceDUnePiece {
  source: string
  date_echeance: string | null
  echeance_fixee_par: string | null
}

/** Au plus, par appel de `marquer_vues`. */
export const MAX_PIECES_VUES_PAR_APPEL = 500

/** Les refus des fonctions et des gardes, mot pour mot. */
export const REFUS_DES_ACHATS = {
  accesPiece: 'Accès refusé à cette pièce.',
  echeanceHorsAchat: 'Une échéance ne se fixe que sur une facture d\'achat.',
  echeanceHorsBornes: 'Une échéance se date entre le 1er janvier 2000 et le 31 décembre 2100.',
  echeanceChangee: 'L\'échéance de cette pièce a changé depuis sa lecture : la relire avant de la fixer.',
  echeanceLue: 'Cette échéance est lue sur la facture électronique : seul le cabinet la corrige.',
  paiementHorsAchat: 'Un paiement ne se déclare que sur une facture d\'achat.',
  datePaiement: 'La date du paiement est requise, entre le 1er janvier 2000 et aujourd\'hui.',
  moyenPaiement: 'Le moyen de paiement est virement, prélèvement, carte, chèque, espèces ou autre.',
  montantPaiement: 'Le montant payé est un nombre positif, au centime près.',
  accesDeclaration: 'Accès refusé à cette déclaration.',
  dejaRetiree: 'Cette déclaration est déjà retirée.',
  accesDossier: 'Accès refusé à ce dossier.',
  tropDeVues: 'Au plus cinq cents pièces se marquent vues en un appel.',
  vueHorsAchat: 'Une pièce de la liste n\'est pas une facture d\'achat de ce dossier.',
  gardeEcheance: 'L\'échéance d\'une pièce et son auteur ne s\'écrivent que par fixer_echeance_piece.',
  echeanceDevinee: 'Une échéance se lit sur la facture électronique reçue, ou se fixe après le dépôt : jamais devinée.',
} as const

const DATE = /^\d{4}-\d{2}-\d{2}$/
const PREMIER_JOUR = '2000-01-01'
const DERNIER_JOUR = '2100-12-31'
const MONTANT_MAX = 999_999_999_999.99

/** Une date civile AAAA-MM-JJ qui existe au calendrier. */
function dateCivile(valeur: string | null | undefined): valeur is string {
  if (typeof valeur !== 'string' || !DATE.test(valeur)) return false
  const [a, m, j] = valeur.split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1, j))
  return d.getUTCFullYear() === a && d.getUTCMonth() === m - 1 && d.getUTCDate() === j
}

/** Le montant d'une déclaration : positif, sous le plafond de la colonne, et au centime — jamais arrondi en silence. */
function montantAuCentime(montant: number | null | undefined): boolean {
  return typeof montant === 'number' && Number.isFinite(montant) && montant > 0 && montant <= MONTANT_MAX
    && /^\d+(\.\d{1,2})?$/.test(String(montant))
}

/**
 * Ce que `declarer_paiement_piece` refuserait de la saisie, une fois l'accès et la nature de la pièce admis : la date (au
 * jour de Paris, que l'appelant donne), puis le moyen, puis le montant — l'ordre de la fonction. Nul : rien à redire.
 */
export function refusDeLaDeclaration(
  saisie: { date: string | null; moyen: string | null; montant: number | null }, aujourdhuiAParis: string,
): string | null {
  if (!dateCivile(saisie.date) || saisie.date < PREMIER_JOUR || saisie.date > aujourdhuiAParis) return REFUS_DES_ACHATS.datePaiement
  if (saisie.moyen === null || !(MOYENS_DECLARES as readonly string[]).includes(saisie.moyen)) return REFUS_DES_ACHATS.moyenPaiement
  if (!montantAuCentime(saisie.montant)) return REFUS_DES_ACHATS.montantPaiement
  return null
}

/**
 * Ce que `fixer_echeance_piece` refuserait, une fois l'accès admis : la nature de la pièce, les bornes de l'échéance, la
 * version lue, puis — pour un accès client — l'échéance lue sur la facture électronique. Nul : rien à redire (une pièce
 * figée par la validation, la base seule le dit).
 */
export function refusDeLEcheance(
  piece: EcheanceDUnePiece & { type_piece: string }, echeance: string | null, echeanceLue: string | null, cabinet: boolean,
): string | null {
  if (piece.type_piece !== 'achat') return REFUS_DES_ACHATS.echeanceHorsAchat
  if (echeance !== null && (!dateCivile(echeance) || echeance < PREMIER_JOUR || echeance > DERNIER_JOUR)) {
    return REFUS_DES_ACHATS.echeanceHorsBornes
  }
  if (piece.date_echeance !== echeanceLue) return REFUS_DES_ACHATS.echeanceChangee
  if (!cabinet && echeanceLueSurLaFacture(piece)) return REFUS_DES_ACHATS.echeanceLue
  return null
}

/** Une échéance lue sur la facture électronique : non nulle, venue de la plateforme ou de Super PDP, sans auteur. */
export function echeanceLueSurLaFacture(piece: EcheanceDUnePiece): boolean {
  return piece.date_echeance !== null && piece.echeance_fixee_par === null
    && (piece.source === 'plateforme' || piece.source === 'superpdp')
}

export type EtatDeLEcheance = 'sans' | 'a_venir' | 'aujourd_hui' | 'en_retard'

/** L'état d'une échéance au jour de Paris que l'appelant donne ; une valeur illisible n'est jamais « à venir » : « sans ». */
export function etatDeLEcheance(echeance: string | null, aujourdhuiAParis: string): EtatDeLEcheance {
  if (!dateCivile(echeance)) return 'sans'
  if (echeance === aujourdhuiAParis) return 'aujourd_hui'
  return echeance < aujourdhuiAParis ? 'en_retard' : 'a_venir'
}
