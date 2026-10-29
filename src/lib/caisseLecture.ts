import { CAISSE_EXPORTEE } from './caisse'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'
import type { OperationCaisse } from './types'

// LA CAISSE D'UN DOSSIER, LUE POUR L'ÉCRAN (ligne 26.6, étape C2 ; modèle : lib/adressesReceptionLecture.ts). La policy
// du cabinet (`operations_caisse_lecture`, `admin_du_dossier`) ouvre toutes les opérations du dossier, TOUTES les
// colonnes, retirées et remplacées comprises : la caisse se rejoue sur ce qui est lu (lib/caisse.ts), jamais sur ce qu'on
// devine. Le client n'en lit rien (CAISSE-Q1 : sa lecture viendra avec son droit, une migration présentée au cabinet).
//
// Par `lireTout`, tri TOTAL terminé par la clé primaire (la date n'est pas unique) et compte annoncé. Elle ne REJETTE
// jamais : une requête qui lève tombe du côté signalé, avec son motif, jamais en une liste vide qui laisserait croire
// à une caisse sans opération. Elle se rend AVEC l'identifiant du dossier qu'elle a lu : un écran qui change de dossier
// pendant la lecture ne prend pas la caisse d'un autre (`DossierDetail` reste monté d'un dossier à l'autre).
//
// LE DRAPEAU BAISSÉ (`CAISSE_EXPORTEE`), ELLE NE LIT RIEN, ET LE DIT : la table n'existe pas encore en production — la
// lire ferait échouer l'écran (PostgREST : relation inconnue). Elle rend alors une lecture INCOMPLÈTE, sans appel au
// réseau, sous un motif qui dit pourquoi : aucun écran ne dira « aucune opération » d'une caisse qui n'est pas encore là.
export interface LectureDeLaCaisse {
  dossierId: string
  lignes: OperationCaisse[]
  // Lue jusqu'au bout, ou non : l'écran en décide (le vide, les soldes, les gestes).
  complete: boolean
  // Ce qui a manqué, en clair, quand `complete` est faux.
  motif: string | null
}

export const MOTIF_CAISSE_ABSENTE = 'la caisse n’est pas encore en base : ses migrations attendent leur application'

/** Les opérations de la caisse d'un dossier, lues en entier ; ne rejette jamais. */
export async function lireLaCaisse(dossierId: string): Promise<LectureDeLaCaisse> {
  return lireLaCaisseSelon(dossierId, CAISSE_EXPORTEE)
}

/** La même lecture, selon que la table est en base : les deux états du drapeau, que les tests jouent. */
export async function lireLaCaisseSelon(dossierId: string, caisseEnBase: boolean): Promise<LectureDeLaCaisse> {
  if (!caisseEnBase) return { dossierId, lignes: [], complete: false, motif: MOTIF_CAISSE_ABSENTE }
  try {
    const lecture = await lireTout<OperationCaisse>((debut, fin) =>
      supabase.from('operations_caisse').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('date').order('cree_le').order('id').range(debut, fin),
    )
    return { dossierId, lignes: lecture.lignes, complete: lecture.complete, motif: lecture.motif }
  } catch (e) {
    return { dossierId, lignes: [], complete: false, motif: messageErreur(e, 'la lecture de la caisse a échoué') }
  }
}
