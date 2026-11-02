import type { CategorieDeLaCaisse } from './caisse'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'

// CE QUE LA CARTE DE LA NATURE DES RECETTES DU CLIENT LIT ET ÉCRIT (ligne 26.6, étape C11 ; le module pur est
// lib/natureDesRecettes.ts ; la nature elle-même se lit avec le dossier, lib/reglageDuDossierLecture.ts).
//
// LA LECTURE : les catégories du dossier ET les communes (`dossier_id` nul), comme la caisse les lit
// (lib/caisseDuDossierLecture.ts) — un filtre sur le seul dossier écarterait presque toutes les natures —, par `lireTout`,
// tri total terminé par la clé primaire. Elle ne rejette jamais : lue en partie, refusée ou rompue, elle le dit avec son
// motif, et la carte n'offre aucun geste. Chaque ligne rendue est confrontée au dossier demandé, et la réponse se rend avec
// lui (`DossierDetail` reste monté d'un dossier à l'autre).
//
// L'ÉCRITURE : `dossiers.categorie_recettes_client`, par la policy `dossiers_update` (le cabinet du dossier), sous la garde
// `garder_categorie_recettes_client` (23514, ses mots, que l'écran a dits avant le clic). La base rend la ligne écrite
// (`.select(…).maybeSingle()`) : aucune ligne rendue est une écriture que la policy a écartée sans lever, et se dit.

export type LectureDesCategoriesDeLaNature =
  | { dossierId: string; etat: 'lues'; categories: CategorieDeLaCaisse[] }
  | { dossierId: string; etat: 'incompletes'; motif: string }

type CategorieLue = CategorieDeLaCaisse

export async function lireLesCategoriesDeLaNature(dossierId: string): Promise<LectureDesCategoriesDeLaNature> {
  try {
    const lecture = await lireTout<CategorieLue>((debut, fin) =>
      supabase.from('categories').select('id, dossier_id, libelle, compte_comptable', { count: 'exact' })
        .or(`dossier_id.eq.${dossierId},dossier_id.is.null`).order('ordre').order('id').range(debut, fin),
    )
    if (!lecture.complete) return { dossierId, etat: 'incompletes', motif: lecture.motif ?? 'lecture incomplète' }
    if (lecture.lignes.some((c) => c.dossier_id !== null && c.dossier_id !== dossierId)) {
      return { dossierId, etat: 'incompletes', motif: 'une catégorie rendue n’est pas de ce dossier' }
    }
    const categories = lecture.lignes.map(({ id, dossier_id, libelle, compte_comptable }) => ({ id, dossier_id, libelle, compte_comptable }))
    return { dossierId, etat: 'lues', categories }
  } catch (e) {
    return { dossierId, etat: 'incompletes', motif: messageErreur(e, 'la lecture des catégories a échoué') }
  }
}

/** Ce que l'écriture a donné : la nature que la base a gardée, ou le refus en clair. Ne rejette jamais. */
export type EcritureDeLaNature = { ecrite: true; categorieId: string | null } | { ecrite: false; refus: string | null }

export async function fixerLaNatureDesRecettes(dossierId: string, categorieId: string | null): Promise<EcritureDeLaNature> {
  try {
    const { data, error } = await supabase.from('dossiers').update({ categorie_recettes_client: categorieId })
      .eq('id', dossierId).select('categorie_recettes_client').maybeSingle()
    if (error) return { ecrite: false, refus: messageErreur(error, 'refus de la base.') }
    // Aucune ligne rendue : la policy l'a écartée sans lever — rien n'est écrit, et l'écran le dit.
    if (!data) return { ecrite: false, refus: null }
    const gardee = (data as { categorie_recettes_client?: unknown }).categorie_recettes_client
    return { ecrite: true, categorieId: typeof gardee === 'string' ? gardee : null }
  } catch (e) {
    return { ecrite: false, refus: messageErreur(e, 'l’écriture a été interrompue.') }
  }
}
