import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import {
  PARAMETRES_DES_COTISATIONS_EXPORTES, lireDebutActivite, lireParametresDUnExercice,
  type LectureDesParametres, type ParametresDUnExercice,
} from './parametresDesCotisations'
import { supabase } from './supabase'

/** Le début d'activité et les paramètres de tous les exercices d'un dossier, lus en entier ; ne rejette jamais. Drapeau baissé, aucun appel. */
export async function lireLesParametresDesCotisations(dossierId: string): Promise<LectureDesParametres> {
  return lireLesParametresDesCotisationsSelon(dossierId, PARAMETRES_DES_COTISATIONS_EXPORTES)
}

/** La même lecture, selon que les tables sont en base : les deux états du drapeau, que les tests jouent. */
export async function lireLesParametresDesCotisationsSelon(dossierId: string, enBase: boolean): Promise<LectureDesParametres> {
  if (!enBase) return { dossierId, etat: 'absents' }
  try {
    // Le début d'activité : une ligne au plus par dossier (`debuts_d_activite_un_par_dossier`), lue avec son erreur.
    const debut = await supabase.from('debuts_d_activite').select('date_debut').eq('dossier_id', dossierId).maybeSingle()
    if (debut.error) return { dossierId, etat: 'incomplets', motif: messageErreur(debut.error, 'le début d’activité n’a pas été lu') }
    const debutActivite = debut.data === null ? null : lireDebutActivite(debut.data)
    if (debutActivite === undefined) return { dossierId, etat: 'incomplets', motif: 'le début d’activité lu ne se croit pas' }
    // Les exercices : tri TOTAL, terminé par la clé primaire (lireTout) ; les colonnes que l'écran lit, nommées.
    const lecture = await lireTout<Record<string, unknown>>((de, a) =>
      supabase.from('parametres_des_cotisations').select('id, annee, acre, taux_dentiste', { count: 'exact' })
        .eq('dossier_id', dossierId).order('annee').order('id').range(de, a),
    )
    if (!lecture.complete) return { dossierId, etat: 'incomplets', motif: lecture.motif ?? 'lecture partielle' }
    const parExercice = new Map<number, ParametresDUnExercice>()
    for (const ligne of lecture.lignes) {
      const p = lireParametresDUnExercice(ligne)
      if (!p) return { dossierId, etat: 'incomplets', motif: 'des paramètres lus ne se croient pas (exercice, ACRE ou taux dentiste)' }
      if (parExercice.has(p.annee)) return { dossierId, etat: 'incomplets', motif: `deux lignes de paramètres pour ${p.annee}` }
      parExercice.set(p.annee, { acre: p.acre, tauxDentiste: p.tauxDentiste })
    }
    return { dossierId, etat: 'lus', debutActivite, parExercice }
  } catch (e) {
    return { dossierId, etat: 'incomplets', motif: messageErreur(e, 'la lecture des paramètres des cotisations a échoué') }
  }
}
