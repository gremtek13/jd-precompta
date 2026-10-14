import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import type { Article } from './types'

// LES ARTICLES D'UN DOSSIER, LUS EN ENTIER (espace client, étape A2a ; modèle : lib/reglementsLecture.ts). La policy du
// cabinet (`articles_lecture`) et celle du client « Ventes » (`articles_lecture_ventes`) ouvrent toutes les lignes du
// dossier, retirés compris, TOUTES les colonnes : la liste se juge sur ce qui est lu, jamais sur ce qu'on devine.
//
// Par `lireTout`, tri TOTAL terminé par la clé primaire (`cree_le` n'est pas unique) et compte annoncé. Le drapeau
// `complete` est rendu tel quel à l'écran : c'est lui qui décide si « aucun article » se dit, si l'unicité d'une référence
// se juge (un article qu'on n'a pas lu ne dirait pas « prise ») et si le moindre geste est offert. Une requête qui LÈVE
// rejette : l'écran le dit, sans rien montrer.
export interface LectureDesArticles {
  lignes: Article[]
  // Lue jusqu'au bout, ou non : l'écran en décide (le vide, l'unicité d'une référence, les gestes).
  complete: boolean
  // Ce qui a manqué, en clair, quand `complete` est faux.
  motif: string | null
}

export async function lireLesArticles(dossierId: string): Promise<LectureDesArticles> {
  const lecture = await lireTout<Article>((debut, fin) =>
    supabase.from('articles').select('*', { count: 'exact' })
      .eq('dossier_id', dossierId).order('cree_le').order('id').range(debut, fin),
  )
  return { lignes: lecture.lignes, complete: lecture.complete, motif: lecture.motif }
}
