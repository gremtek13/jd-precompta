import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import type { ParametresFacturation } from './types'

// LES PARAMÈTRES DE FACTURATION D'UN DOSSIER, LUS EN ENTIER POUR L'ÉCRAN (espace client, étape A5b1 ; modèle :
// lib/adressesReceptionLecture.ts). La policy du cabinet (`parametres_facturation_lecture`) et celle du client « Ventes »
// (`parametres_facturation_lecture_ventes`) ouvrent toutes les versions du dossier, TOUTES leurs colonnes : la chaîne des
// versions — la courante, le RIB en vigueur, qui a posé et confirmé un RIB — se juge sur ce qui est lu, jamais sur ce qu'on
// devine. Une version qu'on n'aurait pas lue ferait dire « courante » d'une version remplacée, et « en vigueur » d'un RIB
// qui ne l'est plus.
//
// Par `lireTout`, tri TOTAL terminé par la clé primaire (`cree_le` n'est pas unique) et compte annoncé. Elle ne REJETTE
// jamais : une requête qui lève ou qu'on refuse tombe du côté signalé, avec son motif (`messageErreur`), jamais en une liste
// vide qui laisserait croire qu'aucun paramètre n'est enregistré. C'est l'écran qui décide : « aucun paramètre » ne se dit
// que d'une liste lue en entier, et le moindre geste n'est offert que sur elle.
export interface LectureDesParametres {
  lignes: ParametresFacturation[]
  // Lue jusqu'au bout, ou non : l'écran en décide (le vide, la courante, les gestes).
  complete: boolean
  // Ce qui a manqué, en clair, quand `complete` est faux.
  motif: string | null
}

/** Les versions des paramètres de facturation du dossier, lues en entier ; ne rejette jamais. */
export async function lireLesParametresFacturation(dossierId: string): Promise<LectureDesParametres> {
  try {
    const lecture = await lireTout<ParametresFacturation>((debut, fin) =>
      supabase.from('parametres_facturation').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('cree_le').order('id').range(debut, fin),
    )
    return { lignes: lecture.lignes, complete: lecture.complete, motif: lecture.motif }
  } catch (e) {
    return { lignes: [], complete: false, motif: messageErreur(e, 'la lecture des paramètres de facturation a échoué') }
  }
}
