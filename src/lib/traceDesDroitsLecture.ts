import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { adressesDeLaLecture, type AdressesRetenues } from './adressesDesAccesRetires'
import { traceDeLaLecture, type TraceLue } from './traceDesDroitsVue'
import type { AdresseDUnAccesRetire, TraceDesDroits } from './types'

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
