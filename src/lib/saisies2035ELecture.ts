import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { lireSaisie2035E, SAISIES_2035E_EXPORTEES } from './saisies2035E'
import type { LectureDesSaisies2035E, Saisie2035E } from './saisies2035E'
import { supabase } from './supabase'

const COLONNES = 'id, annee, loyers_deductibles, plus_values, variation_de_stock, taxes_sur_le_chiffre_d_affaires, dotations_biens_mis_a_disposition, moins_values, mono_etablissement, effectif'

/** Les saisies de l'annexe 2035-E d'un dossier, tous exercices, lues en entier ; ne rejette jamais. Drapeau baissé, aucun
 *  appel : la table n'est pas en base. */
export async function lireLesSaisies2035E(dossierId: string): Promise<LectureDesSaisies2035E> {
  return lireLesSaisies2035ESelon(dossierId, SAISIES_2035E_EXPORTEES)
}

/** La même lecture, selon que l'écran est ouvert : les deux états du drapeau, que les tests jouent. */
export async function lireLesSaisies2035ESelon(dossierId: string, ouvert: boolean): Promise<LectureDesSaisies2035E> {
  if (!ouvert) return { dossierId, etat: 'absentes' }
  try {
    const lecture = await lireTout<Record<string, unknown>>((debut, fin) =>
      supabase.from('saisies_2035e').select(COLONNES, { count: 'exact' })
        .eq('dossier_id', dossierId).order('annee').order('id').range(debut, fin),
    )
    if (!lecture.complete) return { dossierId, etat: 'incompletes', motif: lecture.motif ?? 'lecture partielle' }
    const saisies: (Saisie2035E & { annee: number })[] = []
    for (const ligne of lecture.lignes) {
      const s = lireSaisie2035E(ligne)
      if (!s) return { dossierId, etat: 'incompletes', motif: 'une saisie lue ne se croit pas (montant, cadre ou effectif)' }
      if (saisies.some((t) => t.annee === s.annee)) return { dossierId, etat: 'incompletes', motif: `deux saisies pour ${s.annee}` }
      saisies.push(s)
    }
    return { dossierId, etat: 'lues', saisies }
  } catch (e) {
    return { dossierId, etat: 'incompletes', motif: messageErreur(e, 'la lecture des saisies de l’annexe 2035-E a échoué') }
  }
}
