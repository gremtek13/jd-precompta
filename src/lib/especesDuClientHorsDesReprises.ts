import type { ReponseDeLaBase } from './couvertureReleve'
import { messageErreur } from './messageErreur'
import { piecesCiteesRendues } from './reprisesAuClient'

// LE CLIENT NE RÈGLE JAMAIS EN ESPÈCES L'ORIGINAL D'UNE FACTURE REPRISE (ligne 51.5 ; A8Q5Q3Q2Q2-Q1, « (C) Refuser au client tout
// paiement en espèces de l'original d'une facture reprise, par un refus neutre : le cabinet l'enregistre », tranchée par le
// cabinet le 16/11/2026 à la recommandation ; HISTORIQUE.md, « 16/11/2026 — A8Q5-Q4, A8Q5Q3Q2-Q3 ET A8Q5Q3Q2Q2-Q1 : TROIS
// MIGRATIONS PRÉPARÉES APRÈS LA GARDE DES RÈGLEMENTS »).
//
// Le client « Caisse », sans « Ventes », qui paie en espèces l'original d'une facture reprise apprenait, en essayant des
// montants, ce qui reste à encaisser au registre qu'il ne lit pas (la garde différée des règlements, A8Q5Q3Q2-Q2), et, d'un
// paiement daté de la reprise ou d'après, le nom de la pièce et le numéro de la facture (la garde des règlements d'A8-Q5). La
// migration préparée `especes_du_client_hors_des_reprises` (supabase/preparees/20261116142000_especes_du_client_hors_des_reprises.sql)
// refuse au client, avant toute autre garde qui parle de la reprise, tout paiement en espèces d'une pièce citée — sa
// correction comprise —, sous des mots NEUTRES : ni montant, ni nom de fichier, ni facture, ni encaissements. Le cabinet garde
// le geste. Elle ouvre aussi au client « Caisse » la liste des pièces concernées (`pieces_hors_de_la_caisse_du_client`, leurs
// seuls identifiants), pour que « Mes pièces » le dise AVANT le clic.
//
// Ce module redit le refus, aux mots de la base, lit la liste, et dit ce que l'écran en fait ; especesDuClientHorsDesReprises.test.ts
// les confronte au texte de la migration et à son essai. Pur : il n'importe jamais `supabase.ts` (l'écran passe la requête).

// LE DRAPEAU, BAISSÉ jusqu'à l'application de la migration : la fonction n'existe pas encore en base, et « Mes pièces » est celle
// d'hier, au caractère près — rien ne se lit. Levé le jour de l'application (le fichier entré dans supabase/schema/, texte
// inchangé). Il se lit À CHAQUE APPEL : les tests jouent ses deux états sur l'objet ci-dessous.
export const DRAPEAU_DES_ESPECES_DU_CLIENT = {
  /** Faux jusqu'à l'application de `especes_du_client_hors_des_reprises`, préparée le 16/11/2026. */
  ESPECES_DU_CLIENT_HORS_DES_REPRISES_PREVUES: false as boolean,
}

/** Le drapeau, lu à l'appel. */
export function especesDuClientHorsDesReprisesPrevues(): boolean {
  return DRAPEAU_DES_ESPECES_DU_CLIENT.ESPECES_DU_CLIENT_HORS_DES_REPRISES_PREVUES
}

/** La lecture que la migration ouvre au client « Caisse » (et au cabinet). */
export const FONCTION_DES_PIECES_HORS_DE_LA_CAISSE = 'pieces_hors_de_la_caisse_du_client'

/** Le refus de `garder_especes_du_client_hors_des_reprises`, aux mots de la base : neutre, au client. */
export const REFUS_DES_ESPECES_DU_CLIENT = {
  cle: 'especes_du_client_hors_des_reprises',
  code: '42501',
  modele: 'Le paiement en espèces de cette pièce ne se saisit pas depuis ton espace : ton cabinet l\'enregistre.',
} as const

/** Ce que « Mes pièces » a lu de la liste : l'ensemble, ou le motif de son manque. */
export type LectureDesPiecesHorsDeLaCaisse =
  | { etat: 'lues'; pieces: ReadonlySet<string> }
  | { etat: 'illisibles'; motif: string }

/**
 * La lecture telle que « Mes pièces » la fait : `lireLesPiecesHorsDeLaCaisse(supabase.rpc(FONCTION_DES_PIECES_HORS_DE_LA_CAISSE,
 * { p_dossier_id }))`. Attendue, son erreur lue ; une valeur qui n'est pas un tableau d'identifiants sans doublon est
 * illisible, jamais un ensemble vide deviné. Ne rejette jamais.
 */
export async function lireLesPiecesHorsDeLaCaisse(requete: PromiseLike<ReponseDeLaBase>): Promise<LectureDesPiecesHorsDeLaCaisse> {
  let reponse: ReponseDeLaBase
  try {
    reponse = await requete
  } catch (erreur) {
    reponse = { data: null, error: erreur }
  }
  if (reponse.error) return { etat: 'illisibles', motif: `liste refusée : ${messageErreur(reponse.error, 'raison inconnue')}` }
  const pieces = piecesCiteesRendues(reponse.data)
  return pieces ? { etat: 'lues', pieces } : { etat: 'illisibles', motif: 'liste illisible' }
}

/** Ce que « Mes pièces » sait des pièces que la caisse du client ne règle pas. */
export type PiecesHorsDeLaCaisse =
  /** Le drapeau baissé : la base ne refuse rien de tel, rien ne se lit, et « Mes pièces » est celle d'hier. */
  | { etat: 'sans_objet' }
  /** Pas encore revenue, ou revenue pour une autre société : aucun geste ne s'offre. */
  | { etat: 'attente' }
  /** Illisible : aucun geste ne s'offre, et la phrase le dit. */
  | { etat: 'illisibles'; texte: string }
  | { etat: 'lues'; pieces: ReadonlySet<string> }

/**
 * L'état, de la lecture gardée AVEC la société pour laquelle elle a été faite : sans le drapeau, sans objet ; rien avant le
 * retour, ni d'une autre société ; la phrase sur une lecture ratée.
 */
export function piecesHorsDeLaCaisseSelon(prevues: boolean, lue: { dossierId: string; lecture: LectureDesPiecesHorsDeLaCaisse } | null,
  dossierId: string | undefined): PiecesHorsDeLaCaisse {
  if (!prevues) return { etat: 'sans_objet' }
  if (lue === null || lue.dossierId !== dossierId) return { etat: 'attente' }
  if (lue.lecture.etat === 'illisibles') {
    return { etat: 'illisibles', texte: `La liste des pièces dont ton cabinet enregistre lui-même le paiement en espèces n’a pas pu être lue (${lue.lecture.motif}) : aucun paiement en espèces ne t’est proposé. Recharge la page.` }
  }
  return { etat: 'lues', pieces: lue.lecture.pieces }
}

/** Les gestes de la caisse s'offrent-ils sur « Mes pièces » ? Sans objet ou lue en entier ; sinon non, et la phrase s'il y en a une. */
export function gestesDeLaCaisseOfferts(hors: PiecesHorsDeLaCaisse): { offerts: boolean; raison: string | null } {
  if (hors.etat === 'sans_objet' || hors.etat === 'lues') return { offerts: true, raison: null }
  return { offerts: false, raison: hors.etat === 'illisibles' ? hors.texte : null }
}

/**
 * Le refus avant le clic, sur CETTE pièce : les mots de la base quand la liste la porte ; nul sinon (une pièce que rien ne
 * cite, ou le drapeau baissé). Le paiement et sa correction ne s'offrent pas sur elle ; son retrait, si.
 */
export function especesRefuseesAvantLeClic(pieceId: string, hors: PiecesHorsDeLaCaisse): string | null {
  return hors.etat === 'lues' && hors.pieces.has(pieceId) ? REFUS_DES_ESPECES_DU_CLIENT.modele : null
}
