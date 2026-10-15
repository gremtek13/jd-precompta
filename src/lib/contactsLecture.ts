import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import type { Contact } from './types'

// LES CONTACTS D'UN DOSSIER, LUS EN ENTIER (espace client, étape A4b1 ; modèle : lib/articlesLecture.ts). La policy du cabinet
// (`contacts_lecture`) et celle du client « Ventes » (`contacts_lecture_ventes`) ouvrent toutes les lignes du dossier, TOUTES
// les colonnes, retirés ET effacés compris : la liste se juge sur ce qui est lu. Un contact effacé ne s'affiche jamais, mais
// il est lu quand même — la liste LUE EN ENTIER est celle que `refusEnregistrementContact` exige pour juger l'unicité d'un
// SIRET, et le compte de ce qui est lu se confronte à celui que la base annonce : l'écran filtre l'affichage, jamais la
// lecture.
//
// Par `lireTout`, tri TOTAL terminé par la clé primaire (`cree_le` n'est pas unique) et compte annoncé. Le drapeau `complete`
// est rendu tel quel à l'écran : c'est lui qui décide si « aucun client » se dit, si l'unicité d'un SIRET se juge (un contact
// qu'on n'a pas lu ne dirait pas « pris ») et si le moindre geste est offert. Une requête qui LÈVE rejette : l'écran le dit,
// sans rien montrer.
export interface LectureDesContacts {
  lignes: Contact[]
  // Lue jusqu'au bout, ou non : l'écran en décide (le vide, l'unicité d'un SIRET, les gestes).
  complete: boolean
  // Ce qui a manqué, en clair, quand `complete` est faux.
  motif: string | null
}

export async function lireLesContacts(dossierId: string): Promise<LectureDesContacts> {
  const lecture = await lireTout<Contact>((debut, fin) =>
    supabase.from('contacts').select('*', { count: 'exact' })
      .eq('dossier_id', dossierId).order('cree_le').order('id').range(debut, fin),
  )
  return { lignes: lecture.lignes, complete: lecture.complete, motif: lecture.motif }
}
