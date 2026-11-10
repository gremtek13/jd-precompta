import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { traceDeLaLecture, type TraceLue } from './traceDesDroitsVue'
import type { TraceDesDroits } from './types'

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
