import type { AdresseRetenue } from './adressesDesAccesRetires'
import { estLeClient, type AccesDuDossier } from './auteursVentes'
import { definitionDe, type Domaine } from './droitsAcces'
import type { LectureComplete } from './lectureComplete'
import { jourEtHeureAParis } from './parametresFacturation'
import type { TraceDesDroits } from './types'

// LA TRACE DES DROITS D'UN ACCÈS, À L'ÉCRAN DU CABINET (espace client, étape P1-trace, ligne 51.5 ; la table et son
// déclencheur : lib/traceDesDroits.ts). Ce module dit COMMENT se lit une ligne de la trace — ses mots, son auteur, ses
// regroupements par accès — sans rien lire ni écrire : il se teste sans client Supabase. La lecture est dans
// traceDesDroitsLecture.ts, l'écran dans pages/dossier/TraceDesDroitsDesAcces.tsx.
//
// QUATRE CHOSES QU'IL NE FAIT JAMAIS.
//  1. Nommer un droit ou un geste qu'il ne connaît pas : la ligne est écartée, comptée, et la lecture se dit PARTIELLE
//     (une migration plus récente que l'écran). Il ne devine pas un libellé.
//  2. Montrer un identifiant : ni celui de l'accès, ni celui d'un compte, ni celui de l'auteur. Un accès se nomme par son
//     adresse ; un accès qui n'est plus dans la liste se nomme par l'adresse qu'il portait à son départ, que la base a
//     retenue (P1T-E2, lib/adressesDesAccesRetires.ts) — sans elle, l'écran dit seulement qu'il est retiré.
//  3. Dire un auteur qu'il ne prouve pas (voir `auteurDuGeste`).
//  4. Affirmer le vide : « aucun changement » ne se dit que d'une trace lue EN ENTIER (`motif` nul).

export const GESTES = ['changement', 'creation', 'retrait'] as const
export type Geste = typeof GESTES[number]

/** Les mots du droit, tels que la contrainte `trace_des_droits_droit` les admet : les sept cases de l'application. */
const DROITS: readonly Domaine[] = ['ventes', 'banque', 'caisse', 'comptes', 'achats', 'frais', 'documents']

// Qui a fait le geste, en trois mentions seulement.
//  - `sans_session` : l'auteur est nul — une écriture sans compte connecté (une fonction du service sous sa clé secrète,
//    l'éditeur SQL). Aucun compte à nommer, et on ne dit pas lequel des deux.
//  - `client` : le titulaire de l'accès lui-même (l'auteur est le compte que la ligne enregistre), ou un compte qui porte
//    un accès client du dossier AUJOURD'HUI, sur une liste d'accès lue en entier (la règle de lib/auteursVentes.ts : une
//    liste en cours, partielle ou en échec ne reconnaît personne).
//  - `cabinet` : tout autre compte connecté. C'est PROUVÉ par la base, pas deviné : `memberships` n'a aucun chemin d'écriture
//    pour une session qui ne gère pas le dossier — `changer_droits_acces`, la policy d'insertion et celle de retrait exigent
//    `admin_du_dossier`, et il n'y a aucune policy de mise à jour (traceDesDroitsVue.test.ts le confronte à l'export). Le
//    super-administrateur entre dans `admin_du_dossier` : il se lit « le cabinet ».
export type AuteurDeLaTrace = 'sans_session' | 'client' | 'cabinet'

export const MENTIONS_DE_L_AUTEUR: Record<AuteurDeLaTrace, string> = {
  sans_session: 'Sans session',
  client: 'Le client',
  cabinet: 'Le cabinet',
}

// Ce que dit le survol de la mention : d'où vient ce qu'elle affirme.
export const TITRES_DE_L_AUTEUR: Record<AuteurDeLaTrace, string> = {
  sans_session: 'Aucun compte connecté derrière ce geste : le service l’a écrit sans session.',
  client: 'Le titulaire de l’accès, ou un compte qui porte un accès client de ce dossier.',
  cabinet: 'Un compte qui gérait ce dossier : la base ne laisse changer ces droits qu’à ceux qui le gèrent.',
}

/** Une ligne de la trace, JUGÉE : ses mots connus, son instant valide. Les identifiants y restent pour regrouper, jamais pour montrer. */
export interface LigneDeTrace {
  id: string
  accesId: string
  clientId: string
  droit: Domaine
  coche: boolean
  geste: Geste
  auteurId: string | null
  instant: string
}

const estUnDroit = (v: string): v is Domaine => (DROITS as readonly string[]).includes(v)
const estUnGeste = (v: string): v is Geste => (GESTES as readonly string[]).includes(v)

/** La ligne telle que la base la rend, jugée ; nulle si un mot ou l'instant n'est pas de ceux que l'écran connaît. */
export function ligneDeTrace(brute: TraceDesDroits): LigneDeTrace | null {
  if (!estUnDroit(brute.droit) || !estUnGeste(brute.geste)) return null
  if (typeof brute.coche !== 'boolean') return null
  if (typeof brute.fait_le !== 'string' || Number.isNaN(Date.parse(brute.fait_le))) return null
  if (typeof brute.acces_id !== 'string' || brute.acces_id === '') return null
  return {
    id: brute.id, accesId: brute.acces_id, clientId: brute.client_id, droit: brute.droit, coche: brute.coche,
    geste: brute.geste, auteurId: brute.auteur_id, instant: brute.fait_le,
  }
}

/** La trace lue, réduite à ce que l'écran montre : les lignes jugées, et un `motif` NON NUL dès qu'il en manque. */
export interface TraceLue {
  lignes: LigneDeTrace[]
  motif: string | null
}

/**
 * La lecture jugée. Entière et toutes lignes connues : `motif` nul, et seulement alors la trace peut dire le vide. Sinon le
 * motif dit ce qui manque — la lecture elle-même (`lireTout`) et/ou les lignes écartées —, et les lignes jugées restent
 * montrées : elles sont vraies, mais ce ne sont peut-être pas toutes.
 */
export function traceDeLaLecture(lecture: Pick<LectureComplete<TraceDesDroits>, 'lignes' | 'complete' | 'motif'>): TraceLue {
  const lignes: LigneDeTrace[] = []
  let ecartees = 0
  for (const brute of lecture.lignes) {
    const ligne = ligneDeTrace(brute)
    if (ligne === null) ecartees += 1
    else lignes.push(ligne)
  }
  const motifs: string[] = []
  if (!lecture.complete) motifs.push(lecture.motif ?? 'lecture incomplète')
  if (ecartees > 0) {
    motifs.push(`${ecartees} ligne(s) portent un droit, un geste ou une date que cet écran ne connaît pas`)
  }
  return { lignes: ordreDeLaTrace(lignes), motif: motifs.length === 0 ? null : motifs.join(' ; ') }
}

/** Les plus récentes d'abord ; à l'instant égal, l'identifiant — un ordre TOTAL, le même à chaque lecture. */
export function ordreDeLaTrace(lignes: readonly LigneDeTrace[]): LigneDeTrace[] {
  return [...lignes].sort((a, b) => {
    const ecart = Date.parse(b.instant) - Date.parse(a.instant)
    if (ecart !== 0) return ecart
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/** Qui a fait le geste, sur ce que la ligne et la liste des accès PROUVENT (voir `AuteurDeLaTrace`). */
export function auteurDuGeste(
  acces: AccesDuDossier, ligne: Pick<LigneDeTrace, 'auteurId' | 'clientId'>,
): AuteurDeLaTrace {
  if (ligne.auteurId === null || ligne.auteurId === '') return 'sans_session'
  if (ligne.auteurId === ligne.clientId || estLeClient(acces, ligne.auteurId)) return 'client'
  return 'cabinet'
}

/** L'instant à Paris, « 07/11/2026 à 10:12 » : la base date à Paris, quel que soit le fuseau de qui regarde. */
export function quandADitLaTrace(instant: string): string {
  return jourEtHeureAParis(instant)
}

export interface PhraseDeLaTrace {
  /** Le libellé de la case, aux mots de l'application (« Ventes », « Notes de frais »…). */
  libelle: string
  /** Ce qui lui est arrivé. */
  etat: string
}

/**
 * Ce que la ligne dit de la case. Un changement la coche ou la décoche ; un accès créé arrive en la portant ; un accès
 * retiré en part en la portant (la base écrit alors la case décochée : c'est l'accès qui s'en va, pas un décochage).
 */
export function phraseDeLaTrace(ligne: Pick<LigneDeTrace, 'droit' | 'coche' | 'geste'>): PhraseDeLaTrace {
  const libelle = definitionDe(ligne.droit).libelle
  switch (ligne.geste) {
    case 'creation': return { libelle, etat: 'cochée à la création de l’accès' }
    case 'retrait': return { libelle, etat: 'cochée jusqu’au retrait de l’accès' }
    case 'changement': return { libelle, etat: ligne.coche ? 'cochée' : 'décochée' }
  }
}

/** Un accès lu aujourd'hui, tel que l'écran le nomme : son identifiant ne sert qu'à retrouver sa trace. */
export interface AccesNomme {
  id: string
  /** Son adresse, ou nulle : l'écran dit alors « Accès sans adresse lisible », jamais un identifiant. */
  email: string | null
}

export interface GroupeDeLaTrace {
  /** Le nom montré : l'adresse de l'accès ; pour un accès parti, l'adresse retenue à son départ, ou, sans elle, « Accès
   *  retiré » / « Accès absent de la liste lue ». */
  intitule: string
  /** `present` : un accès de la liste ; `retire` : absent d'une liste lue EN ENTIER ; `absent` : absent d'une liste qui ne l'est pas. */
  etat: 'present' | 'retire' | 'absent'
  lignes: LigneDeTrace[]
}

export const INTITULE_SANS_ADRESSE = 'Accès sans adresse lisible'

/**
 * La trace rangée PAR ACCÈS : chaque accès de la liste (même sans ligne), puis chaque accès que la trace nomme et que la
 * liste ne porte plus. « Retiré » ne se dit que d'une liste lue en entier (`listeLue`) : lue en partie, l'accès peut
 * exister sans y figurer, et on ne le déclare pas parti. Les accès retirés se suivent du plus ancien geste au plus récent.
 * Un accès parti se nomme par l'adresse que la base a retenue à son départ (`adresses`, P1T-E2), datée de ce départ ; sans
 * elle — la table pas encore en base (`null`), une adresse pas retenue, ou pas lue —, il se date de son premier geste, et
 * l'identifiant ne se montre jamais.
 */
export function groupesDeLaTrace(
  lignes: readonly LigneDeTrace[], acces: readonly AccesNomme[], listeLue: boolean,
  adresses: ReadonlyMap<string, AdresseRetenue> | null,
): GroupeDeLaTrace[] {
  const ordonnees = ordreDeLaTrace(lignes)
  const connus = new Set(acces.map((a) => a.id))
  const groupes: GroupeDeLaTrace[] = acces.map((a) => ({
    intitule: a.email !== null && a.email !== '' ? a.email : INTITULE_SANS_ADRESSE,
    etat: 'present',
    lignes: ordonnees.filter((l) => l.accesId === a.id),
  }))
  const orphelins = new Map<string, LigneDeTrace[]>()
  for (const l of ordonnees) {
    if (connus.has(l.accesId)) continue
    orphelins.set(l.accesId, [...(orphelins.get(l.accesId) ?? []), l])
  }
  const premier = (ls: readonly LigneDeTrace[]) => Math.min(...ls.map((l) => Date.parse(l.instant)))
  const retires = [...orphelins.values()].sort((a, b) => premier(a) - premier(b))
  for (const ls of retires) {
    const retenue = adresses?.get(ls[0].accesId)
    const depuis = quandADitLaTrace(new Date(premier(ls)).toISOString())
    const intitule = retenue !== undefined
      ? (listeLue
        ? `${retenue.adresse} — accès retiré le ${quandADitLaTrace(retenue.retireLe)}`
        : `${retenue.adresse} — absent de la liste lue (parti le ${quandADitLaTrace(retenue.retireLe)})`)
      : (listeLue ? `Accès retiré depuis (tracé dès le ${depuis})` : `Accès absent de la liste lue (tracé dès le ${depuis})`)
    groupes.push({ intitule, etat: listeLue ? 'retire' : 'absent', lignes: ls })
  }
  return groupes
}

/** « 3 changements » : le nombre de cases tracées d'un groupe. */
export function nombreDeChangements(n: number): string {
  return n === 1 ? '1 changement' : `${n} changements`
}

/** Ce que dit un groupe sans ligne, d'une trace lue en entier seulement. */
export const AUCUN_CHANGEMENT_TRACE =
  'Aucun changement de droits tracé pour cet accès. Les cases posées avant le 07/11/2026 ne s’attribuent à personne : la trace ne commence qu’à sa mise en base.'

/** Ce que l'onglet dit de l'adresse d'un accès retiré, la table en base (P1T-E2). */
export const CE_QUE_DIT_L_ADRESSE_RETENUE =
  'Un accès retiré se nomme par l’adresse qu’il portait à son départ : seul le cabinet la lit, et elle se garde avec la trace, '
  + 'aussi longtemps que le dossier.'

export const CE_QUE_DIT_LA_TRACE =
  'Chaque case cochée ou décochée sur un accès du dossier, à l’heure de Paris, et qui l’a fait : le cabinet, le client lui-même, '
  + 'ou « sans session » quand aucun compte n’était connecté. Seul le cabinet lit cette liste ; elle ne se modifie ni ne se supprime, '
  + 'et reste lisible après le retrait de l’accès qu’elle raconte.'
