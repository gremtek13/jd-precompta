import { supabase } from './supabase'
import { lireTout, type LectureComplete } from './lectureComplete'
import type { SoldeReporte } from './types'

// LES SOLDES REPORTÉS PAR LA VALIDATION DE CHAQUE EXERCICE (ligne 34), lus EN ENTIER : l'ouverture d'un exercice validé
// avant lui se lit là (`ouvertureDeLExercice`). L'onglet Bilan, l'onglet Révision et la Vue d'ensemble les lisent pour
// confronter l'ouverture à la clôture du précédent (O33-Q1, O33-Q3), et Clôture, Écritures et Statistiques pour leurs
// totaux : une lecture que plusieurs écrans comptent s'écrit une fois, sinon l'un en lirait une partie pendant que l'autre la
// lit toute et ils ne diraient plus la même chose. Ne rejette jamais : refusée ou partielle, elle revient « incomplète », avec
// son motif — rien ne se juge dessus, et l'appelant lit `complete`.
export async function lireLesSoldesReportes(dossierId: string): Promise<LectureComplete<SoldeReporte>> {
  const lecture = await lireTout<SoldeReporte>((debut, fin) =>
    supabase.from('soldes_reportes').select('*', { count: 'exact' })
      .eq('dossier_id', dossierId).order('date').order('compte').order('id').range(debut, fin),
  )
  return { lignes: lecture.lignes, complete: lecture.complete, motif: lecture.motif }
}
