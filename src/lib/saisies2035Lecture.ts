import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { lireSaisie2035, SAISIES_2035_EXPORTEES } from './saisies2035'
import type { LectureDesSaisies2035, Saisie2035 } from './saisies2035'
import { supabase } from './supabase'

/** Les saisies de la 2035 d'un dossier, tous exercices, lues en entier ; ne rejette jamais. Drapeau baissé, aucun appel. */
export async function lireLesSaisies2035(dossierId: string): Promise<LectureDesSaisies2035> {
  return lireLesSaisies2035Selon(dossierId, SAISIES_2035_EXPORTEES)
}

/** La même lecture, selon que la table est en base : les deux états du drapeau, que les tests jouent. */
export async function lireLesSaisies2035Selon(dossierId: string, enBase: boolean): Promise<LectureDesSaisies2035> {
  if (!enBase) return { dossierId, etat: 'absentes' }
  try {
    // Tri TOTAL, terminé par la clé primaire (lireTout) ; les colonnes que l'écran lit, nommées.
    const lecture = await lireTout<Record<string, unknown>>((debut, fin) =>
      supabase.from('saisies_2035').select('id, annee, code, centimes, note_annexe', { count: 'exact' })
        .eq('dossier_id', dossierId).order('annee').order('code').order('id').range(debut, fin),
    )
    if (!lecture.complete) return { dossierId, etat: 'incompletes', motif: lecture.motif ?? 'lecture partielle' }
    const saisies: (Saisie2035 & { annee: number })[] = []
    for (const ligne of lecture.lignes) {
      const s = lireSaisie2035(ligne)
      if (!s) return { dossierId, etat: 'incompletes', motif: 'une saisie lue ne se croit pas (code, montant ou note annexe)' }
      if (saisies.some((t) => t.annee === s.annee && t.code === s.code)) {
        return { dossierId, etat: 'incompletes', motif: `deux saisies de ${s.code} pour ${s.annee}` }
      }
      saisies.push(s)
    }
    return { dossierId, etat: 'lues', saisies }
  } catch (e) {
    return { dossierId, etat: 'incompletes', motif: messageErreur(e, 'la lecture des saisies de la 2035 a échoué') }
  }
}
