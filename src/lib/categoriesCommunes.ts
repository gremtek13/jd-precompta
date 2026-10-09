import type { Categorie } from './types'

// LES CATÉGORIES COMMUNES À TOUS LES CABINETS. `categories` n'a pas de `cabinet_id` : une catégorie dont `dossier_id` est
// nul n'appartient à aucun cabinet, elle est commune à l'application entière, et ses policies d'écriture ne laissent
// passer que le super-administrateur (`dossier_id is null and is_super_admin()`). Un chef de cabinet qui ne l'est pas
// voyait pourtant « Enregistrer » sous le compte ou le poste d'une catégorie commune (« Comptes manquants » dans
// Écritures, « Postes manquants » et « Postes sans case » dans Clôture) : la policy écartait la ligne, PostgREST rendait
// un succès sur zéro ligne, et l'enregistrement se perdait sans un mot — éprouvé par impersonation,
// supabase/essais/categoriesCommunes.sql.
//
// L'écran le dit donc AVANT le clic, à la place du champ, et VÉRIFIE après le clic que la base a rendu la ligne
// modifiée : un droit perdu en cours de session ne se perd plus en silence non plus. Aucun droit n'est élargi : qui doit
// régler ces catégories, et si un cabinet ou un dossier aura les siennes, est une question posée au cabinet (Q9 de la
// conception du plan comptable personnalisable, ligne 43).

/** Une catégorie se règle-t-elle d'ici ? Une catégorie du dossier, oui ; une catégorie commune, par le super-administrateur seul. */
export function categorieReglableIci(categorie: Pick<Categorie, 'dossier_id'>, superAdmin: boolean): boolean {
  return categorie.dossier_id != null || superAdmin
}

/** Ce que l'écran dit à la place du champ, avant tout clic. */
export function categorieCommuneNonReglable(quoi: 'compte' | 'poste'): string {
  return `Catégorie commune à tous les cabinets : seul l’administrateur de l’application en règle le ${quoi}.`
}

/** Ce que l'écran dit quand la base n'a rendu aucune ligne modifiée : elle n'a rien écrit, sans lever d'erreur. */
export const CATEGORIE_NON_MODIFIEE =
  'Rien n’a été enregistré : la base n’a modifié aucune catégorie. Une catégorie commune à tous les cabinets ne se règle '
  + 'que par l’administrateur de l’application.'
