import { formatDate, formatMoney } from './format'
import { estLeClient, type AccesDuDossier } from './auteursVentes'
import {
  echeanceLueSurLaFacture, etatDeLEcheance, LIBELLES_DES_MOYENS, MAX_PIECES_VUES_PAR_APPEL, MOYENS_DECLARES,
  type EcheanceDUnePiece, type EtatDeLEcheance, type MoyenDeclare, type PaiementDeclare, type PieceVue,
} from './achatsClient'

// LES ACHATS DU CLIENT, À L'ÉCRAN : LA RÈGLE ET LES MOTS (espace client, ligne 51.5, étape B5 ; la base : B4,
// `achats_du_client`, préparée ; ses refus : lib/achatsClient.ts). Pur : aucun accès à la base (les lectures sont dans
// lib/achatsClientLecture.ts) — il se teste sans client Supabase.
//
// Côté client, « Mes achats » : les factures d'achat du dossier, leur échéance (`etatDeLEcheance`, au jour de Paris), ce qu'il
// a déclaré payé, « J'ai payé » et l'échéance qu'il fixe ; ce qu'il n'a pas encore vu. Jamais la catégorie, le compte ni
// l'écriture (CLAUDE.md, « Les accès clients sont restreints »). Côté cabinet, la fiche d'une pièce d'achat : les déclarations
// du client, une PROPOSITION qui n'écrit rien en comptabilité (MEG2-Q5), retirées sur une confirmation qui nomme ce qui part
// (B4-Q4 : la ligne reste) ; l'échéance et qui l'a fixée.

/** « Mes achats » existe-t-il ? Avec la migration, et la case « Achats » de la société affichée (relue ensuite à la base). */
export function mesAchatsOuverts(migrationEnBase: boolean, droitAchats: boolean): boolean {
  return migrationEnBase && droitAchats
}

export const PRESENTATION_DE_MES_ACHATS = 'Les factures d’achat de ta société, telles que ton cabinet les a reçues : leur '
  + 'échéance et ce que tu as déjà payé. « J’ai payé » informe ton cabinet ; ta comptabilité, c’est lui qui la tient.'

export const SANS_LA_CASE_ACHATS = 'Ton accès à cette société n’ouvre pas ses achats : demande-le à ton cabinet.'

/** Ce que dit l'état d'une échéance, au client comme au cabinet. */
export const MOTS_DE_L_ECHEANCE: Readonly<Record<EtatDeLEcheance, string>> = {
  sans: 'Sans échéance', a_venir: 'À venir', aujourd_hui: 'Aujourd’hui', en_retard: 'En retard',
}

/** Ce que l'écran du client lit d'une facture d'achat : jamais sa catégorie, son compte ni ses notes. */
export interface AchatDuClient extends EcheanceDUnePiece {
  id: string
  dossier_id: string
  type_piece: string
  nom_fichier: string
  tiers: string | null
  date_piece: string | null
  montant_ttc: number | null
  statut: string
  identite_numero: string | null
  echeance_fixee_le: string | null
  created_at: string
}

export interface AchatDit {
  piece: AchatDuClient
  etat: EtatDeLEcheance
  /** Les déclarations encore valables, puis les retirées, dans l'ordre de leur déclaration. */
  declarees: PaiementDeclare[]
  retirees: PaiementDeclare[]
  /** Jamais vue par ce compte avant cette visite. */
  nouvelle: boolean
}

/**
 * Les achats, dits : chacun avec son échéance au jour donné, ses déclarations (une ligne d'une autre pièce n'y entre jamais),
 * et « nouvelle » quand le compte ne l'a pas vue. Les plus récents d'abord (date de la pièce, puis dépôt, puis identifiant).
 */
export function achatsDits(
  pieces: readonly AchatDuClient[], paiements: readonly PaiementDeclare[], vues: readonly Pick<PieceVue, 'piece_id'>[],
  aujourdhuiAParis: string,
): AchatDit[] {
  const vuesIds = new Set(vues.map((v) => v.piece_id))
  const parPiece = new Map<string, PaiementDeclare[]>()
  for (const p of [...paiements].sort((a, b) => a.declare_le.localeCompare(b.declare_le) || a.id.localeCompare(b.id))) {
    parPiece.set(p.piece_id, [...(parPiece.get(p.piece_id) ?? []), p])
  }
  const cle = (p: AchatDuClient) => `${p.date_piece ?? ''}|${p.created_at}|${p.id}`
  return pieces.filter((p) => p.type_piece === 'achat')
    .sort((a, b) => cle(b).localeCompare(cle(a)))
    .map((piece) => {
      const siennes = parPiece.get(piece.id) ?? []
      return {
        piece,
        etat: etatDeLEcheance(piece.date_echeance, aujourdhuiAParis),
        declarees: siennes.filter((d) => d.retire_le === null),
        retirees: siennes.filter((d) => d.retire_le !== null),
        nouvelle: !vuesIds.has(piece.id),
      }
    })
}

/** Les pièces à marquer vues, par lots que `marquer_vues` accepte (cinq cents au plus). */
export function lotsDeVues(achats: readonly AchatDit[]): string[][] {
  const ids = achats.filter((a) => a.nouvelle).map((a) => a.piece.id)
  const lots: string[][] = []
  for (let i = 0; i < ids.length; i += MAX_PIECES_VUES_PAR_APPEL) lots.push(ids.slice(i, i + MAX_PIECES_VUES_PAR_APPEL))
  return lots
}

/**
 * Le montant tel que le client l'a tapé, en nombre : « 120,50 » ou « 120.50 », sans espace ni signe. Rien n'est arrondi —
 * « 10,005 » reste 10.005, que le module refuse ; une saisie illisible est nulle, refusée de même.
 */
export function montantSaisi(texte: string): number | null {
  const t = texte.trim().replace(/\s/g, '')
  if (!/^\d+([.,]\d+)?$/.test(t)) return null
  return Number(t.replace(',', '.'))
}

/** Un moyen de la liste fermée, ou nul. */
export function moyenSaisi(valeur: string): MoyenDeclare | null {
  return (MOYENS_DECLARES as readonly string[]).includes(valeur) ? valeur as MoyenDeclare : null
}

/** Qui a déclaré, dit au client : lui, ou un autre accès du dossier (jamais un nom). */
export function auteurDitAuClient(declarePar: string, moi: string): string {
  return declarePar === moi ? 'toi' : 'un autre accès de ta société'
}

/** Une déclaration, dite au client. */
export function declarationDiteAuClient(p: PaiementDeclare, moi: string): string {
  const base = `Déclarée payée par ${auteurDitAuClient(p.declare_par, moi)} : le ${formatDate(p.date_paiement)}, `
    + `par ${LIBELLES_DES_MOYENS[p.moyen]}, ${formatMoney(p.montant)}`
  return p.retire_le === null ? base : `${base} — retirée le ${formatDate(p.retire_le)}`
}

/** Peut-il retirer cette déclaration ? Son auteur, tant qu'elle n'est pas retirée (la base le rejuge). */
export function retraitOffertAuClient(p: PaiementDeclare, moi: string): boolean {
  return p.retire_le === null && p.declare_par === moi
}

/** D'où vient l'échéance, dit au client. */
export function origineDeLEcheanceAuClient(piece: EcheanceDUnePiece & { echeance_fixee_le: string | null }, moi: string): string | null {
  if (piece.date_echeance === null) return null
  if (echeanceLueSurLaFacture(piece)) return 'lue sur la facture électronique'
  if (piece.echeance_fixee_par === null) return null
  return piece.echeance_fixee_par === moi
    ? `fixée par toi le ${formatDate(piece.echeance_fixee_le)}`
    : `fixée le ${formatDate(piece.echeance_fixee_le)}`
}

// ── Côté cabinet ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Seul un accès « Achats » déclare (`declarer_paiement_piece`) : toute déclaration est « proposée par le client ». Seuls son
// auteur et le cabinet la retirent (`retirer_paiement_declare`) : retirée par un autre que son auteur, c'est le cabinet.

/** Une déclaration, dite au cabinet. */
export function declarationDiteAuCabinet(p: PaiementDeclare): string {
  const base = `Proposé par le client le ${formatDate(p.declare_le)} : payée le ${formatDate(p.date_paiement)}, `
    + `par ${LIBELLES_DES_MOYENS[p.moyen]}, ${formatMoney(p.montant)}`
  if (p.retire_le === null) return base
  return `${base} — retirée le ${formatDate(p.retire_le)} ${p.retire_par === p.declare_par ? 'par le client' : 'par le cabinet'}`
}

/** La confirmation du retrait : elle nomme la pièce et la déclaration qui part, et ce qui reste. */
export function confirmationDuRetraitAuCabinet(p: PaiementDeclare, nomFichier: string): string {
  return `Retirer la déclaration du client sur « ${nomFichier} » — payée le ${formatDate(p.date_paiement)}, par `
    + `${LIBELLES_DES_MOYENS[p.moyen]}, ${formatMoney(p.montant)} ? Elle ne se dira plus comme un paiement ; sa ligne reste, `
    + 'avec la date de son retrait, et le client le verra. Rien ne change en comptabilité.'
}

/** La confirmation du retrait côté client : la déclaration qui part. */
export function confirmationDuRetraitAuClient(p: PaiementDeclare, nomFichier: string): string {
  return `Retirer ta déclaration sur « ${nomFichier} » — payée le ${formatDate(p.date_paiement)}, par `
    + `${LIBELLES_DES_MOYENS[p.moyen]}, ${formatMoney(p.montant)} ? Ton cabinet verra qu’elle est retirée.`
}

/**
 * L'échéance, dite au cabinet, et qui l'a fixée : « par le client » seulement d'un compte reconnu parmi les accès du dossier
 * lus en entier (lib/auteursVentes.ts) ; jamais « par le cabinet » d'un compte qu'on ne reconnaît pas.
 */
export function echeanceDiteAuCabinet(
  piece: EcheanceDUnePiece & { echeance_fixee_le: string | null }, acces: AccesDuDossier, aujourdhuiAParis: string,
): string {
  if (piece.date_echeance === null) {
    return piece.echeance_fixee_par === null
      ? 'Aucune échéance : la facture n’en donne pas, et personne ne l’a fixée.'
      : `Échéance effacée le ${formatDate(piece.echeance_fixee_le)}${estLeClient(acces, piece.echeance_fixee_par) ? ' par le client' : ''}.`
  }
  const etat = MOTS_DE_L_ECHEANCE[etatDeLEcheance(piece.date_echeance, aujourdhuiAParis)].toLowerCase()
  const debut = `Échéance le ${formatDate(piece.date_echeance)} (${etat})`
  if (echeanceLueSurLaFacture(piece)) return `${debut}, lue sur la facture électronique.`
  if (piece.echeance_fixee_par === null) return `${debut}.`
  return `${debut}, fixée le ${formatDate(piece.echeance_fixee_le)}${estLeClient(acces, piece.echeance_fixee_par) ? ' par le client' : ''}.`
}
