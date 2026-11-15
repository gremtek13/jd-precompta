import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import {
  CASES_DU_MEDECIN_PREVUES, EXONERATION_EN_ZONE_PRIORITAIRE_PREVUE, PARAMETRES_DES_COTISATIONS_EXPORTES, lireDebutActivite,
  lireParametresDUnExercice, type LectureDesParametres, type ParametresDUnExercice,
} from './parametresDesCotisations'
import { supabase } from './supabase'

/** Le début d'activité et les paramètres de tous les exercices d'un dossier, lus en entier ; ne rejette jamais. Drapeau baissé, aucun appel. */
export async function lireLesParametresDesCotisations(dossierId: string): Promise<LectureDesParametres> {
  return lireLesParametresDesCotisationsSelon(dossierId, PARAMETRES_DES_COTISATIONS_EXPORTES)
}

/**
 * La même lecture, selon que les tables sont en base, les deux cases d'un médecin (RET-Q2, `casesEnBase`) et l'exonération
 * de 2025 en zone d'intervention prioritaire (RET2-Q2, `exonerationEnBase`, avec les cases) : les états des trois drapeaux,
 * que les tests jouent.
 */
export async function lireLesParametresDesCotisationsSelon(
  dossierId: string, enBase: boolean, casesEnBase: boolean = CASES_DU_MEDECIN_PREVUES,
  exonerationEnBase: boolean = EXONERATION_EN_ZONE_PRIORITAIRE_PREVUE,
): Promise<LectureDesParametres> {
  if (!enBase) return { dossierId, etat: 'absents' }
  const avecLExoneration = casesEnBase && exonerationEnBase
  try {
    // Le début d'activité : une ligne au plus par dossier (`debuts_d_activite_un_par_dossier`), lue avec son erreur.
    const debut = await supabase.from('debuts_d_activite').select('date_debut').eq('dossier_id', dossierId).maybeSingle()
    if (debut.error) return { dossierId, etat: 'incomplets', motif: messageErreur(debut.error, 'le début d’activité n’a pas été lu') }
    const debutActivite = debut.data === null ? null : lireDebutActivite(debut.data)
    if (debutActivite === undefined) return { dossierId, etat: 'incomplets', motif: 'le début d’activité lu ne se croit pas' }
    // Les exercices : tri TOTAL, terminé par la clé primaire (lireTout) ; les colonnes que l'écran lit, nommées.
    // Avec les deux cases d'un médecin (RET-Q2) une fois leur migration en base, et l'exonération (RET2-Q2) une fois la
    // sienne ; sinon les colonnes d'hier.
    const lecture = await lireTout<Record<string, unknown>>((de, a) => (avecLExoneration
      ? supabase.from('parametres_des_cotisations')
        .select('id, annee, acre, taux_dentiste, cumul_emploi_retraite, dispense_complementaire, exoneration_zone_prioritaire', { count: 'exact' })
        .eq('dossier_id', dossierId).order('annee').order('id').range(de, a)
      : casesEnBase
        ? supabase.from('parametres_des_cotisations')
          .select('id, annee, acre, taux_dentiste, cumul_emploi_retraite, dispense_complementaire', { count: 'exact' })
          .eq('dossier_id', dossierId).order('annee').order('id').range(de, a)
        : supabase.from('parametres_des_cotisations').select('id, annee, acre, taux_dentiste', { count: 'exact' })
          .eq('dossier_id', dossierId).order('annee').order('id').range(de, a)),
    )
    if (!lecture.complete) return { dossierId, etat: 'incomplets', motif: lecture.motif ?? 'lecture partielle' }
    const parExercice = new Map<number, ParametresDUnExercice>()
    for (const ligne of lecture.lignes) {
      const p = lireParametresDUnExercice(ligne, casesEnBase, avecLExoneration)
      if (!p) return { dossierId, etat: 'incomplets', motif: 'des paramètres lus ne se croient pas (exercice, ACRE ou taux dentiste)' }
      if (parExercice.has(p.annee)) return { dossierId, etat: 'incomplets', motif: `deux lignes de paramètres pour ${p.annee}` }
      parExercice.set(p.annee, p.medecin === undefined
        ? { acre: p.acre, tauxDentiste: p.tauxDentiste }
        : { acre: p.acre, tauxDentiste: p.tauxDentiste, medecin: p.medecin })
    }
    return { dossierId, etat: 'lus', debutActivite, parExercice }
  } catch (e) {
    return { dossierId, etat: 'incomplets', motif: messageErreur(e, 'la lecture des paramètres des cotisations a échoué') }
  }
}
