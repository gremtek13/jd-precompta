import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { accesDeLaLecture, type AccesDuDossier } from './auteursVentes'

// LES ACCÈS DU DOSSIER, LUS POUR RECONNAÎTRE LE CLIENT (espace client, étape P4c) : une lecture, faite une fois par l'onglet
// Factures du cabinet et passée à ses fenêtres. La policy `memberships_select` ouvre au cabinet toutes les lignes du dossier
// (`admin_du_dossier`) ; le client, lui, ne lit que la sienne — d'où le cabinet seul : le client ne lit jamais cette table
// pour cet usage, et n'y reconnaîtrait personne.
//
// Par `lireTout`, tri TOTAL terminé par la clé primaire (`created_at` n'est pas unique). Une requête qui LÈVE tombe du côté
// signalé, comme une lecture refusée : jamais une liste vide qui laisserait croire qu'aucun accès n'existe.
export async function lireLesAccesDuDossier(dossierId: string): Promise<AccesDuDossier> {
  try {
    const lecture = await lireTout<{ id: string; user_id: string }>((debut, fin) =>
      supabase.from('memberships').select('id, user_id', { count: 'exact' })
        .eq('dossier_id', dossierId).order('created_at').order('id').range(debut, fin),
    )
    // Le drapeau `complete` est lu ICI : c'est lui qui décide si le moindre compte se reconnaît (lib/auteursVentes.ts).
    return accesDeLaLecture({ lignes: lecture.lignes, complete: lecture.complete, motif: lecture.motif })
  } catch (e) {
    return { etat: 'incomplets', motif: messageErreur(e, 'la lecture a échoué') }
  }
}
