import type { ReponseDeLaBase } from './couvertureReleve'
import { MISSIONS, type Mission } from './lettresDeMission'
import { COLONNES_SANS_MONTANT, type LettreSansMontant } from './lettresDeMissionVue'
import { messageErreur } from './messageErreur'

// LES MISSIONS D'UN CLIENT, SANS SES HONORAIRES (ligne 47, LM5-Q2 ; HISTORIQUE.md, « LM5-Q2 : LES MISSIONS D'UN CLIENT
// SANS SES HONORAIRES, EN BASE »). La policy des lettres de mission est celle du dossier du CABINET : un collaborateur
// assigné au seul dossier d'un client n'en lit aucune ligne. La migration `missions_du_client`
// (supabase/preparees/20261111236000_missions_du_client.sql, PRÉPARÉE) lui ouvre une lecture `security definer` :
// `missions_du_client(dossier)` rend, à qui lit le dossier du client au titre du cabinet (`admin_du_dossier`), ses lettres
// PROPOSÉES par les douze valeurs de `COLONNES_SANS_MONTANT` et elles seules — jamais un montant, une périodicité, un taux
// ni un texte d'honoraires —, et si le cabinet a désigné son dossier. Tout autre appelant, un accès client compris, reçoit
// « Accès refusé à ce dossier. » (42501).
//
// CE MODULE EST LA LECTURE, PURE : il n'importe pas `supabase.ts`. L'appelant passe la REQUÊTE telle quelle
// (lib/lettresDeMissionLecture.ts), que la lecture attend ; elle ne rejette jamais. Un refus de la base se dit REFUSÉ (la
// carte le dit, sans rien deviner) ; toute autre erreur, une requête qui lève ou une valeur d'une autre forme — une clé de
// plus, même une clé d'honoraires, une clé qui manque, une mission hors du catalogue, la lettre d'un autre client — se dit
// ILLISIBLE : l'écran n'affiche jamais une valeur qu'il ne reconnaît pas entière.
//
// LE DRAPEAU, BAISSÉ tant que la migration n'est pas en production : la carte « Missions confiées au cabinet » lit comme
// hier, par la policy du dossier du cabinet (« pas ouvert » à qui n'y est pas assigné). Levé, elle appelle la fonction. Il
// se lit À CHAQUE APPEL, par `missionsDuClientPrevues` : les tests jouent ses deux états sur l'objet ci-dessous.
export const DRAPEAU_DES_MISSIONS_DU_CLIENT = {
  /** Faux tant que la migration `missions_du_client` n'est pas en production (puis dans l'export) ; après LM4. */
  MISSIONS_DU_CLIENT_PREVUES: false as boolean,
}

/** Le drapeau, lu à l'appel. */
export function missionsDuClientPrevues(): boolean {
  return DRAPEAU_DES_MISSIONS_DU_CLIENT.MISSIONS_DU_CLIENT_PREVUES
}

/** La fonction de la migration, et son paramètre, sous les noms que l'écran passe à la base. */
export const FONCTION_DES_MISSIONS_DU_CLIENT = 'missions_du_client'
export const PARAMETRE_DES_MISSIONS_DU_CLIENT = 'p_dossier_id'

/** Son refus, aux mots et au code de la migration (missionsDuClient.test.ts les confronte à son texte). */
export const REFUS_DES_MISSIONS_DU_CLIENT = { code: '42501', acces: 'Accès refusé à ce dossier.' } as const

/** Les deux clés de la valeur rendue, et elles seules. */
export const CLES_DE_LA_VALEUR = ['dossier_du_cabinet_designe', 'lettres'] as const

/** Les douze clés d'une lettre rendue, dans l'ordre de la migration : celles que la carte lisait déjà, et elles seules. */
export const CLES_D_UNE_LETTRE: readonly string[] = COLONNES_SANS_MONTANT.split(', ')

/** Ce que la fonction rend, une fois reconnu entier. */
export interface MissionsDuClient { dossierDuCabinetDesigne: boolean; lettres: LettreSansMontant[] }

const IDENTIFIANT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const MISSIONS_CONNUES: readonly unknown[] = MISSIONS

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const lesMemesCles = (o: Record<string, unknown>, cles: readonly string[]) =>
  Object.keys(o).length === cles.length && cles.every((c) => Object.prototype.hasOwnProperty.call(o, c))
const identifiantOuNul = (v: unknown): v is string | null => v === null || (typeof v === 'string' && IDENTIFIANT.test(v))
const dateOuNulle = (v: unknown): v is string | null => v === null || (typeof v === 'string' && DATE.test(v))
const instantOuNul = (v: unknown): v is string | null => v === null || (typeof v === 'string' && !Number.isNaN(Date.parse(v)))

function lettreRendue(e: unknown, dossierClientId: string): LettreSansMontant | null {
  if (!estObjet(e) || !lesMemesCles(e, CLES_D_UNE_LETTRE)) return null
  const id = e.id, remplace = e.remplace_id, missions = e.missions, effet = e.date_effet, fin = e.fin_initiale
  const finAu = e.fin_au, proposee = e.proposee_le, acceptee = e.acceptee_le, refusee = e.refusee_le, retiree = e.retiree_le
  const reconduction = e.reconduction_tacite
  if (typeof id !== 'string' || !IDENTIFIANT.test(id) || !identifiantOuNul(remplace)) return null
  // La fonction ne rend que les lettres du dossier demandé : une autre se refuse, jamais ne s'affiche ici.
  if (e.dossier_client_id !== dossierClientId) return null
  if (!Array.isArray(missions) || !missions.every((m) => MISSIONS_CONNUES.includes(m))) return null
  if (!dateOuNulle(effet) || !dateOuNulle(fin) || !dateOuNulle(finAu) || typeof reconduction !== 'boolean') return null
  // Une lettre rendue est PROPOSÉE (un brouillon ne sort pas de la base).
  if (proposee === null || !instantOuNul(proposee) || !instantOuNul(acceptee) || !instantOuNul(refusee) || !instantOuNul(retiree)) return null
  return {
    id, remplace_id: remplace, dossier_client_id: dossierClientId, missions: missions as Mission[], date_effet: effet,
    fin_initiale: fin, reconduction_tacite: reconduction, proposee_le: proposee, acceptee_le: acceptee, refusee_le: refusee,
    retiree_le: retiree, fin_au: finAu,
  }
}

/**
 * La valeur que rend `missions_du_client`, reconnue ENTIÈRE : ses deux clés, chaque lettre par ses douze et elles seules,
 * du dossier demandé, des identifiants sans doublon ; sans dossier du cabinet désigné, aucune lettre. Toute autre forme
 * rend `null` : jamais une liste devinée, jamais une lettre qui porterait autre chose.
 */
export function missionsDuClientRendues(rendu: unknown, dossierClientId: string): MissionsDuClient | null {
  if (!estObjet(rendu) || !lesMemesCles(rendu, CLES_DE_LA_VALEUR)) return null
  const designe = rendu.dossier_du_cabinet_designe
  if (typeof designe !== 'boolean' || !Array.isArray(rendu.lettres)) return null
  const lettres: LettreSansMontant[] = []
  const vues = new Set<string>()
  for (const e of rendu.lettres) {
    const l = lettreRendue(e, dossierClientId)
    if (l === null || vues.has(l.id)) return null
    vues.add(l.id)
    lettres.push(l)
  }
  if (!designe && lettres.length > 0) return null
  return { dossierDuCabinetDesigne: designe, lettres }
}

/** Ce que la carte a lu par la fonction : la valeur, le refus de la base, ou le motif de son manque. */
export type LectureParLaFonction =
  | ({ etat: 'lue' } & MissionsDuClient)
  | { etat: 'refusee'; motif: string }
  | { etat: 'illisible'; motif: string }

function codeDe(erreur: unknown): string | null {
  return estObjet(erreur) && typeof erreur.code === 'string' ? erreur.code : null
}

/** La réponse de la base, attendue, en lecture. */
export function lectureDesMissionsDuClient(dossierClientId: string, reponse: ReponseDeLaBase): LectureParLaFonction {
  if (reponse.error) {
    const motif = messageErreur(reponse.error, 'lecture refusée')
    return codeDe(reponse.error) === REFUS_DES_MISSIONS_DU_CLIENT.code ? { etat: 'refusee', motif } : { etat: 'illisible', motif }
  }
  const rendue = missionsDuClientRendues(reponse.data, dossierClientId)
  return rendue ? { etat: 'lue', ...rendue } : { etat: 'illisible', motif: 'la base a rendu une valeur que l’écran ne sait pas lire' }
}

/**
 * La lecture telle que la carte la fait : `lireLesMissionsParLaFonction(dossierClientId, supabase.rpc('missions_du_client',
 * { p_dossier_id }))`. La requête est ATTENDUE ici et son erreur lue ; une requête qui lève tombe du côté illisible. Ne
 * rejette jamais.
 */
export async function lireLesMissionsParLaFonction(dossierClientId: string, requete: PromiseLike<ReponseDeLaBase>): Promise<LectureParLaFonction> {
  try {
    return lectureDesMissionsDuClient(dossierClientId, await requete)
  } catch (erreur) {
    return { etat: 'illisible', motif: messageErreur(erreur, 'les missions n’ont pas pu être lues') }
  }
}
