import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { adressesDeLaLecture, type AdressesRetenues } from './adressesDesAccesRetires'
import { equipeNommable, ouverturesDeLaLecture, type MembreLu, type OuverturesAttestees } from './ouverturesAttestees'
import { traceDeLaLecture, type TraceLue } from './traceDesDroitsVue'
import type { AdresseDUnAccesRetire, AuteurDUneOuverture, TraceDesDroits } from './types'

// LA TRACE DES DROITS D'UN DOSSIER, LUE POUR L'ONGLET ACCÈS (espace client, étape P1-trace). La policy de lecture n'ouvre la
// table qu'au cabinet du dossier (`admin_du_dossier`) : le client n'en lit rien, et cette lecture n'est jamais faite de son
// espace. Par `lireTout`, tri TOTAL terminé par la clé primaire (`fait_le` n'est pas unique) ; une requête qui LÈVE tombe du
// côté signalé, comme une lecture refusée — jamais une liste vide qui laisserait croire qu'aucun droit n'a changé.
//
// La lecture est GARDÉE AVEC LE DOSSIER qu'elle a lu : une réponse pour un autre dossier (l'onglet reste monté d'un dossier à
// l'autre) ne se montre pas pour celui-ci.
export interface LectureDeLaTrace extends TraceLue {
  dossierId: string
}

const COLONNES = 'id, dossier_id, acces_id, client_id, droit, coche, geste, auteur_id, fait_le'

export async function lireLaTraceDuDossier(dossierId: string): Promise<LectureDeLaTrace> {
  try {
    const lecture = await lireTout<TraceDesDroits>((debut, fin) =>
      supabase.from('trace_des_droits').select(COLONNES, { count: 'exact' })
        .eq('dossier_id', dossierId).order('fait_le', { ascending: false }).order('id').range(debut, fin),
    )
    // Le drapeau `complete` est lu ICI : il décide si la trace peut dire le vide (lib/traceDesDroitsVue.ts, `traceDeLaLecture`).
    return { dossierId, ...traceDeLaLecture({ lignes: lecture.lignes, complete: lecture.complete, motif: lecture.motif }) }
  } catch (e) {
    return { dossierId, lignes: [], motif: messageErreur(e, 'la lecture a échoué') }
  }
}

// L'ADRESSE D'UN ACCÈS RETIRÉ (P1T-E2 ; lib/adressesDesAccesRetires.ts), lue pour nommer un accès parti : la même policy que
// la trace (le cabinet du dossier seul), le même tri TOTAL, la même garde du dossier lu ; une requête qui lève tombe du côté
// signalé. Le composant ne l'appelle que sous `ADRESSES_DES_ACCES_RETIRES_PREVUES` : avant sa migration, la table n'existe pas.
export interface LectureDesAdresses extends AdressesRetenues {
  dossierId: string
}

const COLONNES_DES_ADRESSES = 'id, dossier_id, acces_id, adresse, retire_le'

// QUI A OUVERT UN ACCÈS (P1TQ2-Q1 ; lib/ouverturesAttestees.ts), lu pour nommer l'auteur attesté d'une arrivée : la même policy
// que la trace (le cabinet du dossier seul), le même tri TOTAL, la même garde du dossier lu. Puis, pour les seuls comptes
// attestés, leur ligne d'équipe — SOUS LA SESSION de qui regarde : la policy de `cabinet_admins` ne rend l'adresse qu'au chef
// du cabinet, au super-administrateur et au membre lui-même, et ce qui ne revient pas se dit « Le cabinet ». Une requête qui
// lève tombe du côté signalé. Le composant ne l'appelle que sous `OUVERTURES_ATTESTEES_PREVUES` : avant sa migration, la table
// n'existe pas.
export interface LectureDesOuvertures extends OuverturesAttestees {
  dossierId: string
  /** Les adresses que la session lit, par compte attesté ; vide si elle n'en lit aucune. */
  equipe: ReadonlyMap<string, string>
}

const COLONNES_DES_OUVERTURES = 'id, dossier_id, acces_id, trace_id, auteur_id, atteste_le'

export async function lireLesOuverturesAttestees(dossierId: string): Promise<LectureDesOuvertures> {
  let ouvertures: OuverturesAttestees
  try {
    const lecture = await lireTout<AuteurDUneOuverture>((debut, fin) =>
      supabase.from('auteurs_des_ouvertures').select(COLONNES_DES_OUVERTURES, { count: 'exact' })
        .eq('dossier_id', dossierId).order('atteste_le', { ascending: false }).order('id').range(debut, fin),
    )
    // Le drapeau `complete` est lu ICI : une attestation absente d'une lecture partielle laisserait « Sans session ».
    ouvertures = ouverturesDeLaLecture({ lignes: lecture.lignes, complete: lecture.complete, motif: lecture.motif })
  } catch (e) {
    return { dossierId, parTrace: new Map(), equipe: new Map(), motif: messageErreur(e, 'la lecture a échoué') }
  }
  const auteurs = [...new Set(ouvertures.parTrace.values())].sort()
  if (auteurs.length === 0) return { dossierId, ...ouvertures, equipe: new Map() }
  try {
    const equipe = await lireTout<MembreLu>((debut, fin) =>
      supabase.from('cabinet_admins').select('user_id, email', { count: 'exact' })
        .in('user_id', auteurs).order('user_id').range(debut, fin),
    )
    const motifs = [ouvertures.motif, equipe.complete ? null : `l’équipe : ${equipe.motif ?? 'lecture incomplète'}`].filter((m) => m !== null)
    return { dossierId, parTrace: ouvertures.parTrace, equipe: equipeNommable(equipe.lignes), motif: motifs.length === 0 ? null : motifs.join(' ; ') }
  } catch (e) {
    return {
      dossierId, parTrace: ouvertures.parTrace, equipe: new Map(),
      motif: [ouvertures.motif, `l’équipe : ${messageErreur(e, 'la lecture a échoué')}`].filter((m) => m !== null).join(' ; '),
    }
  }
}

// LES COMPTES DU CABINET DERRIÈRE LES GESTES DE LA TRACE (P1TQ2Q1-Q1, tranchée par le cabinet le 16/11/2026 : « (A) »), lus
// pour nommer qui a coché, décoché ou retiré : leur ligne d'équipe, SOUS LA SESSION de qui regarde — la même règle que
// l'auteur d'une ouverture : la policy de `cabinet_admins` ne rend l'adresse qu'au chef du cabinet, au super-administrateur et
// au membre lui-même ; ce qui ne revient pas se dit « Le cabinet ». Gardée AVEC le dossier et la liste des comptes demandés
// (`comptes`, triée) : une réponse pour une autre trace ne se montre pas. Une requête qui lève tombe du côté signalé. Sans
// migration : la table et la policy sont celles de l'équipe.
export interface LectureDesComptesDuCabinet {
  dossierId: string
  /** Les comptes demandés, joints : la clé de la lecture. */
  comptes: string
  /** Les adresses que la session lit, par compte ; vide si elle n'en lit aucune. */
  equipe: ReadonlyMap<string, string>
  motif: string | null
}

export async function lireLesComptesDuCabinet(dossierId: string, comptes: readonly string[]): Promise<LectureDesComptesDuCabinet> {
  const cle = comptes.join(',')
  if (comptes.length === 0) return { dossierId, comptes: cle, equipe: new Map(), motif: null }
  try {
    const equipe = await lireTout<MembreLu>((debut, fin) =>
      supabase.from('cabinet_admins').select('user_id, email', { count: 'exact' })
        .in('user_id', [...comptes]).order('user_id').range(debut, fin),
    )
    return {
      dossierId, comptes: cle, equipe: equipeNommable(equipe.lignes),
      motif: equipe.complete ? null : `l’équipe : ${equipe.motif ?? 'lecture incomplète'}`,
    }
  } catch (e) {
    return { dossierId, comptes: cle, equipe: new Map(), motif: `l’équipe : ${messageErreur(e, 'la lecture a échoué')}` }
  }
}

export async function lireLesAdressesDesAccesRetires(dossierId: string): Promise<LectureDesAdresses> {
  try {
    const lecture = await lireTout<AdresseDUnAccesRetire>((debut, fin) =>
      supabase.from('adresses_des_acces_retires').select(COLONNES_DES_ADRESSES, { count: 'exact' })
        .eq('dossier_id', dossierId).order('retire_le', { ascending: false }).order('id').range(debut, fin),
    )
    // Le drapeau `complete` est lu ICI : il décide si un accès retiré peut se dire sans adresse retenue.
    return { dossierId, ...adressesDeLaLecture({ lignes: lecture.lignes, complete: lecture.complete, motif: lecture.motif }) }
  } catch (e) {
    return { dossierId, parAcces: new Map(), motif: messageErreur(e, 'la lecture a échoué') }
  }
}
