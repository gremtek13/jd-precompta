import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { modeleDeLaReponse, type LectureDuModele } from './modeleDuCabinet'
import type { LigneDuPlanReglee } from './planDepuisLaBalance'
import { supabase } from './supabase'

// CE QUE LE MODÈLE DE PLAN DU CABINET LIT ET ÉCRIT (ligne 43, étape PC5 ; la règle et les mots : lib/modeleDuCabinet.ts).
// Rien ne rejette ici : une lecture refusée, rompue ou partielle se rend avec son motif, et l'écran n'offre alors aucun
// geste. Chaque lecture se rend avec la clé lue (le cabinet), que l'écran confronte à celle qu'il montre.
//
// L'ÉCRITURE passe par les fonctions de la base seules : `regler_modele_du_cabinet` (le chef du cabinet), puis la RELECTURE
// du modèle par `modele_du_cabinet` — l'écran montre le modèle que la base a gardé, jamais celui qu'on croit avoir envoyé ;
// et `appliquer_modele_du_cabinet` (le cabinet à qui le dossier est ouvert, par `regler_plan_du_dossier`).

/** Le modèle du cabinet, lu par `modele_du_cabinet`. */
export async function lireLeModeleDuCabinet(cabinetId: string): Promise<{ cabinetId: string; lecture: LectureDuModele }> {
  try {
    return { cabinetId, lecture: modeleDeLaReponse(await supabase.rpc('modele_du_cabinet', { p_cabinet_id: cabinetId })) }
  } catch (e) {
    return { cabinetId, lecture: modeleDeLaReponse({ data: null, error: e }) }
  }
}

export type LectureDesCategoriesCommunes =
  | { etat: 'lus'; comptes: string[] }
  | { etat: 'incomplets'; motif: string }

/** Les comptes des catégories communes à tous les dossiers (`dossier_id` nul), ceux que les refus 9 et 10 comparent. */
export async function lireLesComptesDesCategoriesCommunes(): Promise<LectureDesCategoriesCommunes> {
  try {
    const lecture = await lireTout<{ id: string; dossier_id: string | null; compte_comptable: string | null }>((debut, fin) =>
      supabase.from('categories').select('id, dossier_id, compte_comptable', { count: 'exact' })
        .is('dossier_id', null).order('id').range(debut, fin),
    )
    if (!lecture.complete) return { etat: 'incomplets', motif: lecture.motif ?? 'lecture incomplète' }
    if (lecture.lignes.some((c) => c.dossier_id !== null)) return { etat: 'incomplets', motif: 'une catégorie rendue n’est pas commune' }
    const comptes = [...new Set(lecture.lignes.flatMap((c) => (typeof c.compte_comptable === 'string' && c.compte_comptable.trim() !== ''
      ? [c.compte_comptable.trim()] : [])))]
    return { etat: 'lus', comptes }
  } catch (e) {
    return { etat: 'incomplets', motif: messageErreur(e, 'la lecture des catégories a échoué') }
  }
}

/** Ce que le réglage a donné : le modèle relu après lui, ou le refus de la base en clair. */
export type ReglageDuModele =
  | { regle: true; lecture: LectureDuModele }
  | { regle: false; refus: string }

export async function reglerPuisRelireLeModele(cabinetId: string, comptes: readonly LigneDuPlanReglee[]): Promise<ReglageDuModele> {
  try {
    const { error } = await supabase.rpc('regler_modele_du_cabinet', { p_cabinet_id: cabinetId, p_comptes: comptes })
    if (error) return { regle: false, refus: messageErreur(error, 'Le modèle de plan du cabinet n’a pas pu être réglé.') }
  } catch (e) {
    return { regle: false, refus: messageErreur(e, 'Le modèle de plan du cabinet n’a pas pu être réglé.') }
  }
  return { regle: true, lecture: (await lireLeModeleDuCabinet(cabinetId)).lecture }
}

/** Ce que l'application du modèle à un dossier a donné : le nombre de rôles copiés, ou le refus de la base en clair. */
export type ApplicationDuModele =
  | { applique: true; nombre: number }
  | { applique: false; refus: string }

export async function appliquerLeModeleAuDossier(dossierId: string): Promise<ApplicationDuModele> {
  try {
    const { data, error } = await supabase.rpc('appliquer_modele_du_cabinet', { p_dossier_id: dossierId })
    if (error) return { applique: false, refus: messageErreur(error, 'La base a refusé d’appliquer le modèle.') }
    if (typeof data !== 'number') return { applique: false, refus: 'La base n’a pas dit combien de rôles elle a copiés.' }
    return { applique: true, nombre: data }
  } catch (e) {
    return { applique: false, refus: messageErreur(e, 'La base a refusé d’appliquer le modèle.') }
  }
}
