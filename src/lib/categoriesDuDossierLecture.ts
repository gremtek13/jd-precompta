import type { EmploisDUneCategorie } from './categoriesDuDossier'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'
import type { Categorie } from './types'

// CE QUE LES ÉCRANS DES CATÉGORIES DU DOSSIER LISENT ET ÉCRIVENT (ligne 43, étape PC7 ; les règles et les mots :
// lib/categoriesDuDossier.ts et lib/categoriesDepuisLaBalance.ts). Rien ne rejette : une lecture lue en partie, refusée
// ou rompue le dit avec son motif, et l'écran n'offre alors aucun geste. Une écriture rend la ligne écrite et la compte :
// zéro ligne se dit (une policy qui écarte la ligne ne lève pas — le « silence » du § 9, point 2).

export type LectureDesCategories =
  | { dossierId: string; etat: 'lues'; categories: Categorie[] }
  | { dossierId: string; etat: 'incompletes'; motif: string }

/** Les catégories que le dossier voit : les siennes et les communes (jamais `dossier_id = ?` seul), lues en entier. */
export async function lireLesCategoriesDuDossier(dossierId: string): Promise<LectureDesCategories> {
  try {
    const lecture = await lireTout<Categorie>((debut, fin) =>
      supabase.from('categories').select('id, dossier_id, code, libelle, ordre, compte_comptable, poste_2035', { count: 'exact' })
        .or(`dossier_id.eq.${dossierId},dossier_id.is.null`).order('id').range(debut, fin),
    )
    if (!lecture.complete) return { dossierId, etat: 'incompletes', motif: lecture.motif ?? 'lecture incomplète' }
    if (lecture.lignes.some((c) => c.dossier_id !== null && c.dossier_id !== dossierId)) {
      return { dossierId, etat: 'incompletes', motif: 'une catégorie rendue n’est pas de ce dossier' }
    }
    return { dossierId, etat: 'lues', categories: lecture.lignes }
  } catch (e) {
    return { dossierId, etat: 'incompletes', motif: messageErreur(e, 'la lecture des catégories a échoué') }
  }
}

export type LectureDesEmplois =
  | { categorieId: string; etat: 'lus'; emplois: EmploisDUneCategorie }
  | { categorieId: string; etat: 'illisibles'; motif: string }

type Compte = PromiseLike<{ count: number | null; error: unknown }>

/** Ce qui cite une catégorie : six comptes exacts et la nature des recettes du client. Un compte manquant rend illisible. */
export async function lireLesEmplois(dossierId: string, categorieId: string): Promise<LectureDesEmplois> {
  const compter = async (requete: Compte): Promise<number> => {
    const { count, error } = await requete
    if (error) throw error
    if (typeof count !== 'number') throw new Error('compte absent')
    return count
  }
  try {
    const [pieces, mouvements, ventilations, operationsDeCaisse, regles, reglesDesTiers, dossier] = await Promise.all([
      compter(supabase.from('pieces').select('id', { count: 'exact', head: true }).eq('categorie_id', categorieId)),
      compter(supabase.from('lignes_bancaires').select('id', { count: 'exact', head: true }).eq('categorie_id', categorieId)),
      compter(supabase.from('ventilations_bancaires').select('id', { count: 'exact', head: true }).eq('categorie_id', categorieId)),
      compter(supabase.from('operations_caisse').select('id', { count: 'exact', head: true }).eq('categorie_id', categorieId)),
      compter(supabase.from('regles_affectation_bancaire').select('id', { count: 'exact', head: true }).eq('categorie_id', categorieId)),
      compter(supabase.from('tiers_categories').select('id', { count: 'exact', head: true }).eq('categorie_id', categorieId)),
      supabase.from('dossiers').select('id, categorie_recettes_client').eq('id', dossierId).maybeSingle(),
    ])
    if (dossier.error) throw dossier.error
    if (!dossier.data) return { categorieId, etat: 'illisibles', motif: 'le dossier n’a pas été rendu' }
    const natureDesRecettes = dossier.data.categorie_recettes_client === categorieId
    return { categorieId, etat: 'lus', emplois: { pieces, mouvements, ventilations, operationsDeCaisse, regles, reglesDesTiers, natureDesRecettes } }
  } catch (e) {
    return { categorieId, etat: 'illisibles', motif: messageErreur(e, 'la lecture des emplois a échoué') }
  }
}

export type IssueDEcriture = { ok: true } | { ok: false; refus: string }

export interface CategorieACreer {
  code: string
  libelle: string
  compte_comptable: string
  poste_2035: string
}

/** Crée les catégories d'un seul tenant (une instruction : toutes ou aucune), et compte les lignes rendues. */
export async function creerLesCategories(dossierId: string, lignes: readonly CategorieACreer[]): Promise<IssueDEcriture> {
  try {
    const { data, error, count } = await supabase.from('categories')
      .insert(lignes.map((l) => ({ ...l, dossier_id: dossierId })), { count: 'exact' }).select('id')
    if (error) return { ok: false, refus: messageErreur(error, 'Les catégories n’ont pas été créées.') }
    if (!data || data.length !== lignes.length || count !== lignes.length) return { ok: false, refus: 'La base n’a pas rendu les catégories créées : relisez avant de recommencer.' }
    return { ok: true }
  } catch (e) {
    return { ok: false, refus: messageErreur(e, 'Les catégories n’ont pas été créées.') }
  }
}

/**
 * Modifie une catégorie du dossier, en RETENANT la version lue : la ligne n'est écrite que si son libellé, son compte et
 * son poste sont encore ceux que l'écran a lus — sinon zéro ligne, dite.
 */
export async function modifierLaCategorie(dossierId: string, lue: Categorie,
  champs: { libelle: string; compte_comptable: string; poste_2035: string }): Promise<IssueDEcriture> {
  try {
    let requete = supabase.from('categories').update(champs).eq('id', lue.id).eq('dossier_id', dossierId).eq('libelle', lue.libelle)
    requete = lue.compte_comptable === null ? requete.is('compte_comptable', null) : requete.eq('compte_comptable', lue.compte_comptable)
    requete = lue.poste_2035 === null ? requete.is('poste_2035', null) : requete.eq('poste_2035', lue.poste_2035)
    const { data, error } = await requete.select('id').maybeSingle()
    if (error) return { ok: false, refus: messageErreur(error, 'La catégorie n’a pas été modifiée.') }
    if (!data) return { ok: false, refus: 'Rien n’a été enregistré : la catégorie a changé depuis sa lecture, ou la base ne l’a pas modifiée. Relisez.' }
    return { ok: true }
  } catch (e) {
    return { ok: false, refus: messageErreur(e, 'La catégorie n’a pas été modifiée.') }
  }
}

/** Supprime une catégorie du dossier ; la base rend la ligne retirée, ou rien n'est parti. */
export async function supprimerLaCategorie(dossierId: string, categorieId: string): Promise<IssueDEcriture> {
  try {
    const { data, error } = await supabase.from('categories').delete().eq('id', categorieId).eq('dossier_id', dossierId).select('id').maybeSingle()
    if (error) return { ok: false, refus: messageErreur(error, 'La catégorie n’a pas été supprimée.') }
    if (!data) return { ok: false, refus: 'Rien n’a été supprimé : la base n’a rendu aucune catégorie.' }
    return { ok: true }
  } catch (e) {
    return { ok: false, refus: messageErreur(e, 'La catégorie n’a pas été supprimée.') }
  }
}
