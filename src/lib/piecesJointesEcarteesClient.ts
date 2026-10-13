import { poids, TAILLE_MAX_PIECE } from './bornesStockage'
import type { ReponseDeLaBase } from './couvertureReleve'
import { formatDate } from './format'
import type { LectureComplete } from './lectureComplete'
import { messageErreur } from './messageErreur'
import type { PieceJointeEcarteeDuClient } from './types'

// LES PIÈCES JOINTES ÉCARTÉES, DITES AU CLIENT DANS « MES PIÈCES » (ligne 22.9 ; décision du cabinet du 13/10/2026,
// S227-Q6 : le client qui envoie une pièce jointe que la réception par e-mail écarte croit l'avoir envoyée — « Mes
// pièces » le lui dit : quand, pourquoi, et comment la renvoyer, sans nom de fichier).
//
// CE QUE LE CLIENT LIT. Pas la table : `pieces_jointes_ecartees` lui reste fermée (sa policy de lecture est celle du
// cabinet). La fonction `pieces_jointes_ecartees_du_client` (migration `pieces_jointes_ecartees_au_client`) vérifie
// l'accès — tout accès client du dossier, qu'il porte les cases « Ventes » et « Banque » ou non — et rend, de celles
// reçues ces 90 derniers jours, le JOUR à Paris, la RAISON et le POIDS ; ni l'identifiant, ni l'empreinte, ni la marque
// « vue » ni son auteur. UNE valeur, un tableau : PostgREST plafonne les lignes sans le dire, pas une valeur.
//
// LA FONCTION EST-ELLE EN BASE ? Oui : la migration `pieces_jointes_ecartees_au_client`, présentée au cabinet puis
// appliquée sur son accord (S228B-Q1), que l'export porte depuis. `ECARTEES_DU_CLIENT_EXPORTEES` reste —
// piecesJointesEcarteesClient.test.ts le confronte au schéma exporté, comme `COUVERTURE_EXPORTEE` — : levé, « Mes
// pièces » les lit et les dit ; rebaissé, il n'appellerait plus rien, et ce chemin, tant qu'il existe,
// ClientUpload.ecartees.test.tsx le garde. Un retour arrière de la migration ne vient qu'APRÈS le drapeau rebaissé en
// ligne : sinon chaque client verrait le bandeau d'une lecture refusée.
//
// LES MOTS SONT CEUX DU CLIENT : tutoiement, aucun onglet, jamais « le client » pour le titulaire (src/lib/espaceVentes.ts,
// `MOTS_DU_CABINET`). Le combien et le pourquoi sont ceux de l'onglet Justificatifs, qui ne nomment personne
// (src/lib/piecesJointesEcartees.ts) ; ce qu'il faut faire est dit ici, à lui. Il n'écrit rien et ne marque rien : son
// geste est de renvoyer (décision du cabinet du 13/10/2026, S228B-Q4).
//
// Module PUR : il n'importe pas `supabase.ts`. L'écran passe la REQUÊTE telle quelle à `lireLesEcarteesDuClient`, qui
// l'attend par `await` (un constructeur de requête n'est pas une promesse : voir src/lib/couvertureReleve.ts).

export { phraseDeLaRaison, titreDuSignalement } from './piecesJointesEcartees'

/** Vrai quand l'export porte `pieces_jointes_ecartees_du_client` : la base la sert, l'écran la lit. */
export const ECARTEES_DU_CLIENT_EXPORTEES: boolean = true

/**
 * La fenêtre de la lecture du client, en jours — celle de la fonction (`interval '90 days'`, bornes comprises ;
 * décision du cabinet du 13/10/2026, S228B-Q2), confrontée à son texte exporté par piecesJointesEcarteesClient.test.ts.
 */
export const JOURS_DE_LA_LECTURE_DU_CLIENT = 90

const RAISONS = new Set<string>(['format', 'taille', 'depot', 'vide'])

/** Une date civile AAAA-MM-JJ qui existe au calendrier (ni un 31 juin, ni un mois 13). */
function estUnJourCivil(valeur: unknown): valeur is string {
  if (typeof valeur !== 'string') return false
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valeur)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
}

/**
 * Les éléments rendus par `pieces_jointes_ecartees_du_client`, chacun `{ jour, raison, octets }`. Toute autre forme rend
 * `null` : une réponse qu'on ne sait pas lire ne passe ni pour « rien d'écarté », ni pour une liste. Un champ de plus,
 * s'il en venait un, n'est jamais repris : l'écran ne montre que ces trois-là.
 */
export function lignesDuClient(rendu: unknown): PieceJointeEcarteeDuClient[] | null {
  if (!Array.isArray(rendu)) return null
  const lignes: PieceJointeEcarteeDuClient[] = []
  for (const element of rendu) {
    if (element === null || typeof element !== 'object' || Array.isArray(element)) return null
    const { jour, raison, octets } = element as Record<string, unknown>
    if (!estUnJourCivil(jour)) return null
    if (typeof raison !== 'string' || !RAISONS.has(raison)) return null
    if (!(octets === null || (typeof octets === 'number' && Number.isSafeInteger(octets) && octets >= 0))) return null
    lignes.push({ jour, raison: raison as PieceJointeEcarteeDuClient['raison'], octets })
  }
  return lignes
}

/**
 * La lecture telle que l'écran la reçoit de `supabase.rpc('pieces_jointes_ecartees_du_client', …)`, sous la forme de
 * `lireTout` : une seule valeur, donc ni tranches ni plafond silencieux — mais un refus ou une réponse illisible se
 * SIGNALENT (`complete` faux, avec le motif), et ne rendent aucune ligne.
 */
export function lectureDesEcarteesDuClient(reponse: ReponseDeLaBase): LectureComplete<PieceJointeEcarteeDuClient> {
  if (reponse.error) {
    return { lignes: [], complete: false, motif: `lecture refusée : ${messageErreur(reponse.error, 'raison inconnue')}` }
  }
  const lignes = lignesDuClient(reponse.data)
  if (!lignes) return { lignes: [], complete: false, motif: 'réponse illisible' }
  return { lignes, complete: true, motif: null }
}

/**
 * La lecture telle que l'écran la fait :
 * `lireLesEcarteesDuClient(supabase.rpc('pieces_jointes_ecartees_du_client', { p_dossier_id }))`. La requête est ATTENDUE
 * ici et son erreur lue (ecrituresVerifiees.test.ts compte tout `.rpc(` comme une écriture possible, et nomme ce
 * consommateur) ; une requête qui lève tombe du côté signalé, comme un refus — jamais une liste vide.
 */
export async function lireLesEcarteesDuClient(requete: PromiseLike<ReponseDeLaBase>): Promise<LectureComplete<PieceJointeEcarteeDuClient>> {
  try {
    return lectureDesEcarteesDuClient(await requete)
  } catch (erreur) {
    return { lignes: [], complete: false, motif: `lecture impossible : ${messageErreur(erreur, 'raison inconnue')}` }
  }
}

/** Quand : « le 12/10/2026 » — le jour de la réception à Paris, tel que la base le rend (une date civile, sans fuseau). */
export function quandPourLeClient(jour: string): string {
  return `le ${formatDate(jour)}`
}

/** Ce que l'écran dit avant que la lecture soit revenue : l'attente, jamais le silence d'une liste qu'on croirait vide. */
export const ECARTEES_EN_LECTURE = 'Pièces jointes reçues par e-mail : chargement…'

/** Sous le titre : d'où elles viennent, sur quelle durée, que le cabinet les voit, et pourquoi aucun nom. */
export function dOuEllesViennent(n: number): string {
  return n === 1
    ? `Reçue à l’adresse de collecte de ton dossier ces ${JOURS_DE_LA_LECTURE_DU_CLIENT} derniers jours ; ton cabinet la voit aussi. `
      + 'Son nom n’est pas gardé : le jour et le poids t’aident à retrouver l’e-mail.'
    : `Reçues à l’adresse de collecte de ton dossier ces ${JOURS_DE_LA_LECTURE_DU_CLIENT} derniers jours ; ton cabinet les voit aussi. `
      + 'Leur nom n’est pas gardé : le jour et le poids t’aident à retrouver l’e-mail.'
}

/** Ce que dit le bandeau d'une lecture partielle ou refusée : ce qui est devenu faux, dans les mots du client. */
export const SI_LA_LECTURE_MANQUE =
  'Recharge la page : une pièce jointe reçue par e-mail et qui n’a pas pu être déposée peut ne pas être dite ici.'

/**
 * Où renvoyer : « Déposer des fichiers », ci-dessous, ou l'adresse e-mail du dossier — NOMMÉE quand « Mes pièces » l'a lue
 * (ligne 22.93), sinon « la même adresse » : celle que le titre de la carte appelle l'adresse de collecte. Jamais une
 * adresse devinée : `adresse` est nulle tant que la lecture n'est pas revenue, quand elle a échoué ou que le dossier n'a
 * pas de code.
 */
export function ouRenvoyer(adresse: string | null): string {
  return `dans « Déposer des fichiers », ci-dessous, ou par e-mail, à ${adresse ?? 'la même adresse'}`
}

/**
 * Ce que le client peut faire, une phrase par idée : refusée à son format ou à son poids, elle se renvoie autrement ; son
 * dépôt échoué, TELLE QUELLE — ce n'est pas de son fait ; arrivée vide, il VÉRIFIE SON FICHIER d'abord — la renvoyer telle
 * quelle la ferait arriver vide de nouveau (les consignes de l'onglet Justificatifs, dites à lui). Mêlées, chacune garde
 * la sienne, et une phrase commune dit où. Un format refusé peut n'avoir jamais été une pièce : il n'a rien à faire. Et la
 * liste garde 90 jours sans savoir s'il a renvoyé depuis : la dernière phrase le dit. `adresse` est celle que « Mes pièces »
 * a lue pour la société affichée, ou null (voir `ouRenvoyer`) : le paramètre n'a pas de valeur par défaut.
 */
export function ceQueTuPeuxFaire(lignes: readonly Pick<PieceJointeEcarteeDuClient, 'raison'>[], adresse: string | null): string[] {
  const OU = ouRenvoyer(adresse)
  const formats = lignes.filter((l) => l.raison === 'format').length
  const refusees = formats + lignes.filter((l) => l.raison === 'taille').length
  const echouees = lignes.filter((l) => l.raison === 'depot').length
  const vides = lignes.filter((l) => l.raison === 'vide').length
  const borne = poids(TAILLE_MAX_PIECE)
  const groupes = [refusees, echouees, vides].filter((n) => n > 0).length
  const phrases: string[] = []
  if (groupes === 1) {
    if (refusees === 1) phrases.push(`Pour qu’elle arrive, renvoie-la en PDF, JPEG, PNG ou CSV, et sous ${borne} — ${OU}.`)
    if (refusees > 1) phrases.push(`Pour qu’elles arrivent, renvoie-les en PDF, JPEG, PNG ou CSV, et sous ${borne} chacune — ${OU}.`)
    if (echouees === 1) phrases.push(`Ce n’est pas de ton fait : renvoie-la telle quelle — ${OU}.`)
    if (echouees > 1) phrases.push(`Ce n’est pas de ton fait : renvoie-les telles quelles — ${OU}.`)
    if (vides === 1) phrases.push(`Vérifie ton fichier (qu’il s’ouvre et ne soit pas vide), puis renvoie-le — ${OU}.`)
    if (vides > 1) phrases.push(`Vérifie tes fichiers (qu’ils s’ouvrent et ne soient pas vides), puis renvoie-les — ${OU}.`)
  } else if (groupes > 1) {
    if (refusees === 1) phrases.push(`Celle refusée à son format ou à son poids : renvoie-la en PDF, JPEG, PNG ou CSV, et sous ${borne}.`)
    if (refusees > 1) phrases.push(`Celles refusées à leur format ou à leur poids : renvoie-les en PDF, JPEG, PNG ou CSV, et sous ${borne} chacune.`)
    if (echouees === 1) phrases.push('Celle dont le dépôt a échoué : ce n’est pas de ton fait, renvoie-la telle quelle.')
    if (echouees > 1) phrases.push('Celles dont le dépôt a échoué : ce n’est pas de ton fait, renvoie-les telles quelles.')
    if (vides === 1) phrases.push('Celle arrivée vide : vérifie ton fichier (qu’il s’ouvre et ne soit pas vide) avant de le renvoyer.')
    if (vides > 1) phrases.push('Celles arrivées vides : vérifie tes fichiers (qu’ils s’ouvrent et ne soient pas vides) avant de les renvoyer.')
    phrases.push(`Renvoie-les ${OU}.`)
  }
  if (formats > 0) {
    phrases.push('Une pièce jointe qui n’était pas une pièce — une signature électronique, une invitation… — n’a pas à être renvoyée.')
  }
  if (lignes.length === 1) phrases.push('Cette liste ne sait pas si tu l’as renvoyée depuis : si c’est fait, tu n’as rien à faire.')
  if (lignes.length > 1) phrases.push('Cette liste ne sait pas si tu les as renvoyées depuis : si c’est fait, tu n’as rien à faire.')
  return phrases
}

/**
 * La phrase de l'onglet Accès sur la collecte par e-mail (S229-Q5) : ce qui arrive, ce qui n'arrive pas et où le cabinet
 * le voit — et, une fois la lecture du client en base, ce que la base en ouvre à la SESSION du client (la règle de cet
 * onglet : il dit ce que la base ouvre, écran ou non). Les quatre raisons d'une pièce jointe écartée y sont nommées.
 */
export function ceQueDitLaCollecte(ecarteesDuClientExportees: boolean): string {
  const arrivent = `Les pièces jointes reçues — en PDF, JPEG, PNG ou CSV, de ${poids(TAILLE_MAX_PIECE)} au plus chacune — arrivent directement en pièces à valider.`
  const ecartees = 'Celle qui n’est pas déposée — d’un autre format, plus lourde, arrivée vide, ou dont le dépôt a échoué — se dit dans l’onglet Justificatifs, sans son nom'
  return ecarteesDuClientExportees
    ? `${arrivent} ${ecartees} ; tout accès client du dossier, avec ou sans case, la voit aussi dans « Mes pièces » pendant ${JOURS_DE_LA_LECTURE_DU_CLIENT} jours : le jour, la raison et le poids, jamais le nom.`
    : `${arrivent} ${ecartees}.`
}

/** La phrase de l'onglet Accès, telle que l'export la rend vraie aujourd'hui. */
export const CE_QUE_DIT_LA_COLLECTE = ceQueDitLaCollecte(ECARTEES_DU_CLIENT_EXPORTEES)
