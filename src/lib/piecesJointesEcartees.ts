import { poids, poidsFaceALaBorne, TAILLE_MAX_PIECE } from './bornesStockage'
import { formatDate } from './format'
import type { LectureComplete } from './lectureComplete'
import type { PieceJointeEcartee } from './types'

// LES PIÈCES JOINTES ÉCARTÉES À LA RÉCEPTION PAR E-MAIL, DITES AU CABINET (ligne 22.7 ; décision du cabinet du
// 13/10/2026, S226-Q3 : « une pièce jointe écartée à la réception par e-mail se dit au cabinet, sans nom de fichier »).
//
// receive-email écarte une pièce jointe dont le format n'est pas celui d'une pièce, ou qui pèse plus que sa borne, et
// la consigne dans `pieces_jointes_ecartees` — le dossier, l'instant, la raison, le poids, jamais le nom. Depuis la ligne
// 22.8 (décision du cabinet du 13/10/2026, S227-Q3), elle y consigne aussi celle dont le DÉPÔT A ÉCHOUÉ — Resend ne l'a
// pas rendue, son téléchargement, la recherche de doublon, le stockage ou l'insertion ont échoué, une exception — : ce
// n'est pas du fait du client, et son poids est inconnu (null) quand rien n'a été lu. Ce module dit,
// pour l'onglet Justificatifs : combien, quand, pourquoi, et ce que le cabinet peut faire ; il range les lignes non vues
// avant les vues, et redit avant le clic les refus de `marquer_pieces_jointes_vues` (migration
// `pieces_jointes_ecartees`), dans leur ordre et sous leurs mots — `piecesJointesEcartees.test.ts` les confronte au texte
// de la migration. Pur : il ne lit ni n'écrit rien (la lecture : `piecesJointesEcarteesLecture.ts`).

/** Les refus de `marquer_pieces_jointes_vues`, mot pour mot, dans l'ordre de la fonction. */
export const REFUS_DE_MARQUER = {
  acces: 'Accès refusé à ce dossier.',
  aucune: 'Aucune pièce jointe désignée.',
  autreDossier: "Une pièce jointe désignée n'est pas de ce dossier : relire la liste avant de la marquer vue.",
} as const

/** Ce que l'écran dit avant toute lecture revenue, et d'une lecture partielle : il ne marque rien. */
export const SANS_LISTE_EN_COURS = 'La liste des pièces jointes écartées est en cours de lecture : rien ne se marque avant elle.'
export const SANS_LISTE_PARTIELLE = 'La liste des pièces jointes écartées n’a pas été lue en entier : rien ne se marque d’ici.'

/**
 * Les lignes d'un dossier, rangées pour l'écran : celles à signaler (pas encore vues), puis les déjà vues — chacune des
 * plus récentes aux plus anciennes, l'identifiant départageant deux instants égaux.
 */
export function rangerLesEcarts(
  dossierId: string, lignes: readonly PieceJointeEcartee[],
): { aSignaler: PieceJointeEcartee[]; dejaVues: PieceJointeEcartee[] } {
  const triees = lignes.filter((l) => l.dossier_id === dossierId).sort((a, b) =>
    a.recue_le !== b.recue_le ? (Date.parse(b.recue_le) - Date.parse(a.recue_le)) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return { aSignaler: triees.filter((l) => l.vue_le === null), dejaVues: triees.filter((l) => l.vue_le !== null) }
}

/**
 * Pourquoi elle n'a pas été déposée, avec son poids — comme un dépôt refusé se dit (src/lib/bornesStockage.ts) : le
 * format, ou le poids face à la borne, à l'octet quand une décimale les confondrait ; ou le dépôt qui a échoué (ligne
 * 22.8) : lue, son format et son poids allaient, et son poids se dit ; pas lue, rien ne se dit d'elle que son poids
 * inconnu — ni un poids, ni un format. Jamais de nom : la base n'en garde aucun.
 */
export function phraseDeLaRaison(e: Pick<PieceJointeEcartee, 'raison' | 'octets'>): string {
  if (e.raison === 'depot') {
    return e.octets === null
      ? 'le dépôt a échoué avant toute lecture de la pièce jointe (poids inconnu)'
      : `le dépôt a échoué, alors que son format et son poids allaient (${poids(e.octets)})`
  }
  // Le format et la taille ont toujours leur poids — la base l'exige (`pieces_jointes_ecartees_poids_connu`) — : sans
  // lui, rien ne s'invente non plus.
  if (e.raison === 'format') return e.octets === null ? 'format non pris en charge' : `format non pris en charge (${poids(e.octets)})`
  if (e.octets === null) return `au-delà des ${poids(TAILLE_MAX_PIECE)} qu’une pièce peut peser`
  const dits = poidsFaceALaBorne([e.octets], TAILLE_MAX_PIECE)
  return `au-delà des ${dits.borne} qu’une pièce peut peser (${dits.lus[0]})`
}

/**
 * Quand : « le 12/10/2026 à 14 h 03 ». Un INSTANT (`timestamptz`) : son jour et son heure sont ceux de qui regarde,
 * comme `formatDate` le fait de tout horodatage.
 */
export function quandRecue(recueLe: string): string {
  const d = new Date(recueLe)
  if (Number.isNaN(d.getTime())) return recueLe
  return `le ${formatDate(recueLe)} à ${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`
}

/** Combien, en titre du signalement. */
export function titreDuSignalement(n: number): string {
  return n === 1
    ? '1 pièce jointe reçue par e-mail n’a pas été déposée'
    : `${n} pièces jointes reçues par e-mail n’ont pas été déposées`
}

/**
 * Ce que le cabinet peut faire des pièces jointes signalées : le client croit les avoir envoyées. Refusée à son format ou
 * à son poids, elle se renvoie autrement ; son dépôt échoué (ligne 22.8), elle se renvoie TELLE QUELLE — ce n'est pas du
 * fait du client. Signalées ensemble, chacune garde sa consigne.
 */
export function ceQueLeCabinetPeutFaire(lignes: readonly Pick<PieceJointeEcartee, 'raison'>[]): string {
  const echouees = lignes.filter((l) => l.raison === 'depot').length
  const refusees = lignes.length - echouees
  const borne = poids(TAILLE_MAX_PIECE)
  const ou = 'à l’adresse de collecte du dossier ou dans « Mes pièces »'
  if (echouees === 0) {
    return refusees === 1
      ? `Le client croit l’avoir envoyée : demande-lui de la renvoyer en PDF, JPEG, PNG ou CSV, et sous ${borne} — ${ou}.`
      : `Le client croit les avoir envoyées : demande-lui de les renvoyer en PDF, JPEG, PNG ou CSV, et sous ${borne} chacune — ${ou}.`
  }
  if (refusees === 0) {
    return echouees === 1
      ? `Le client croit l’avoir envoyée, et ce n’est pas de son fait si elle n’est pas arrivée : demande-lui de la renvoyer telle quelle — ${ou}.`
      : `Le client croit les avoir envoyées, et ce n’est pas de son fait si elles ne sont pas arrivées : demande-lui de les renvoyer telles quelles — ${ou}.`
  }
  const autrement = refusees === 1
    ? `celle refusée à son format ou à son poids en PDF, JPEG, PNG ou CSV, et sous ${borne}`
    : `celles refusées à leur format ou à leur poids en PDF, JPEG, PNG ou CSV, et sous ${borne} chacune`
  const telleQuelle = echouees === 1
    ? 'telle quelle celle dont le dépôt a échoué'
    : 'telles quelles celles dont le dépôt a échoué'
  return `Le client croit les avoir envoyées : demande-lui de renvoyer ${autrement}, et ${telleQuelle} (ce n’est pas de son fait) — ${ou}.`
}

/** Ce que « Marquer comme vue » change, dit à côté du bouton. */
export const CE_QUE_FAIT_LA_MARQUE =
  'Une fois marquées vues, elles ne sont plus signalées ici, pour personne du cabinet ; elles restent dans l’historique.'

/** Le libellé du bouton. */
export function libelleDuGeste(n: number): string {
  return n === 1 ? 'Marquer comme vue' : 'Marquer comme vues'
}

/** Ce qu'on dit d'une ligne déjà vue, dans l'historique : quand elle est arrivée, pourquoi, et quand le cabinet l'a vue. */
export function phraseDeLaLigneVue(e: PieceJointeEcartee): string {
  return `${quandRecue(e.recue_le)} — ${phraseDeLaRaison(e)} ; vue le ${formatDate(e.vue_le)}`
}

/**
 * Le refus de marquer vues ces pièces jointes, tel que la base le dirait, ou null : avant toute lecture revenue ou sur
 * une lecture partielle, rien ne se marque ; puis les rangs 2 et 3 de la fonction, sous ses mots. Le rang 1 (l'accès)
 * ne se redit pas : qui lit la liste a l'accès.
 */
export function refusDeMarquerVues(d: {
  dossierId: string
  lecture: LectureComplete<PieceJointeEcartee> | null
  ids: readonly string[]
}): string | null {
  if (d.lecture === null) return SANS_LISTE_EN_COURS
  if (!d.lecture.complete) return SANS_LISTE_PARTIELLE
  if (d.ids.length === 0) return REFUS_DE_MARQUER.aucune
  const duDossier = new Set(d.lecture.lignes.filter((l) => l.dossier_id === d.dossierId).map((l) => l.id))
  if (d.ids.some((id) => !duDossier.has(id))) return REFUS_DE_MARQUER.autreDossier
  return null
}
