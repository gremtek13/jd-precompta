import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { lireLePlanDuDossier, type LectureDuPlan } from './planComptable'
import type { LigneDuPlanReglee } from './planDepuisLaBalance'
import { supabase } from './supabase'

// CE QUE LA CARTE DE LA BALANCE LIT ET ÉCRIT QUAND LA REPRISE PROPOSE LE PLAN (ligne 43, étape PC6 ; le module pur est
// lib/planDepuisLaBalance.ts, les mots de l'écran lib/planDepuisLaBalanceVue.ts).
//
// LA LECTURE : les comptes des catégories du dossier ET des communes (`dossier_id` nul, lib/categoriesCommunes.ts), ceux
// que `regler_plan_du_dossier` compare à des zéros près (ses refus 9 et 10) — par `lireTout`, tri total terminé par la clé
// primaire. Elle ne rejette jamais : lue en partie, refusée ou rompue, elle le dit avec son motif, et la carte n'offre
// aucun geste — une proposition faite sur une partie des catégories serait peut-être un refus. Chaque ligne rendue est
// confrontée au dossier demandé, et la réponse se rend avec lui (`DossierDetail` reste monté d'un dossier à l'autre).
//
// L'ÉCRITURE : `regler_plan_du_dossier` seule (PC4), le plan ENTIER que `planRetenu` compose ; puis la RELECTURE du plan
// par `plan_du_dossier`, la fonction qui le dit aux fonctions d'écriture : les à-nouveaux se rangent sur le plan que la
// base a gardé, jamais sur celui qu'on croit avoir envoyé.

export type LectureDesComptesDesCategories =
  | { dossierId: string; etat: 'lus'; comptes: string[] }
  | { dossierId: string; etat: 'incomplets'; motif: string }

interface CategorieLue {
  id: string
  dossier_id: string | null
  compte_comptable: string | null
}

export async function lireLesComptesDesCategories(dossierId: string): Promise<LectureDesComptesDesCategories> {
  try {
    const lecture = await lireTout<CategorieLue>((debut, fin) =>
      supabase.from('categories').select('id, dossier_id, compte_comptable', { count: 'exact' })
        .or(`dossier_id.eq.${dossierId},dossier_id.is.null`).order('id').range(debut, fin),
    )
    if (!lecture.complete) return { dossierId, etat: 'incomplets', motif: lecture.motif ?? 'lecture incomplète' }
    if (lecture.lignes.some((c) => c.dossier_id !== null && c.dossier_id !== dossierId)) {
      return { dossierId, etat: 'incomplets', motif: 'une catégorie rendue n’est pas de ce dossier' }
    }
    const comptes = [...new Set(lecture.lignes.flatMap((c) => (typeof c.compte_comptable === 'string' && c.compte_comptable.trim() !== ''
      ? [c.compte_comptable.trim()] : [])))]
    return { dossierId, etat: 'lus', comptes }
  } catch (e) {
    return { dossierId, etat: 'incomplets', motif: messageErreur(e, 'la lecture des catégories a échoué') }
  }
}

/** Ce que le réglage a donné : le plan relu après lui, ou le refus de la base en clair. Ne rejette jamais. */
export type ReglageDuPlan =
  | { regle: true; lecture: LectureDuPlan }
  | { regle: false; refus: string }

export async function reglerPuisRelireLePlan(dossierId: string, comptes: readonly LigneDuPlanReglee[]): Promise<ReglageDuPlan> {
  try {
    const { error } = await supabase.rpc('regler_plan_du_dossier', { p_dossier_id: dossierId, p_comptes: comptes })
    if (error) return { regle: false, refus: messageErreur(error, 'Le plan du dossier n’a pas pu être réglé.') }
  } catch (e) {
    return { regle: false, refus: messageErreur(e, 'Le plan du dossier n’a pas pu être réglé.') }
  }
  return { regle: true, lecture: await lireLePlanDuDossier(supabase.rpc('plan_du_dossier', { p_dossier_id: dossierId })) }
}
