import { refusDeLaNatureDesRecettesDuClient, type CategorieDeLaCaisse } from './caisse'
import type { NatureDesRecettesDite } from './droitsAcces'

// LA NATURE DES RECETTES EN ESPÈCES DU CLIENT, À L'ÉCRAN DU CABINET (ligne 26.6, étape C11 ; CAISSE2-Q2, (B)). Le praticien
// qui porte « Caisse » ne choisit pas la nature de ses recettes : le cabinet la fixe pour le dossier
// (`dossiers.categorie_recettes_client`, migration `caisse_du_client`), sa recette la prend, et la base la refuse tant
// qu'elle manque ou qu'elle n'est plus une catégorie de produit. L'écran qui la fixe est l'onglet Accès, sous la liste des
// accès (« LA CAISSE : LE DROIT « CAISSE », EN BASE (C10, LIGNE 26.6) », ce qui reste) : la nature y suit la case.
//
// PUR. La règle est celle de la garde (`garder_categorie_recettes_client`) : une catégorie de produit — un compte de classe
// 7 — de ce dossier, ou commune, ou rien ; ce module la redit par `refusDeLaNatureDesRecettesDuClient` (lib/caisse.ts, une
// seule copie), et ne propose que les catégories qu'elle admet.

/** Les catégories que la garde admet pour la nature, sur des catégories lues en entier (celles du dossier et les communes). */
export function categoriesDeLaNature(categories: readonly CategorieDeLaCaisse[], dossierId: string): CategorieDeLaCaisse[] {
  return categories.filter((c) => refusDeLaNatureDesRecettesDuClient(c.id, dossierId, categories) === null)
}

/** Le refus de la base pour la nature choisie, avant le clic, à ses mots ; nul quand elle passe (nul retire la nature). */
export function refusDeLaNature(categorieId: string | null, dossierId: string, categories: readonly CategorieDeLaCaisse[]): string | null {
  return refusDeLaNatureDesRecettesDuClient(categorieId, dossierId, categories)?.message ?? null
}

/**
 * La nature telle qu'on la dit : fixée (son libellé), absente, qui n'est plus une catégorie de produit du dossier, ou
 * illisible — la colonne non lue, ou les catégories pas lues en entier (une catégorie qu'on n'a pas lue n'est pas une
 * catégorie qui manque).
 */
export function natureDite(
  categorieId: string | null | undefined, dossierId: string, categories: readonly CategorieDeLaCaisse[] | null,
): NatureDesRecettesDite {
  if (categorieId === undefined || categories === null) return { etat: 'illisible' }
  if (categorieId === null) return { etat: 'absente' }
  if (refusDeLaNature(categorieId, dossierId, categories) !== null) return { etat: 'hors_produit' }
  const categorie = categories.find((c) => c.id === categorieId)
  return categorie ? { etat: 'fixee', libelle: categorie.libelle } : { etat: 'hors_produit' }
}

/** Ce que la carte dit de la nature d'aujourd'hui. */
export function phraseDeLaNature(nature: NatureDesRecettesDite): string {
  switch (nature.etat) {
    case 'fixee':
      return `Ses recettes en espèces se rangent sous « ${nature.libelle} ».`
    case 'absente':
      return 'Aucune nature n’est fixée : tant qu’elle manque, la base refuse les recettes en espèces que le client saisit '
        + '(ses apports, ses prélèvements et ses paiements passent).'
    case 'hors_produit':
      return 'La nature fixée n’est plus une catégorie de produit du dossier : la base refuse les recettes en espèces du client '
        + 'tant qu’elle n’est pas corrigée.'
    case 'illisible':
      return 'La nature des recettes du client ne se lit pas : rien ne se change d’ici. Recharge la page.'
  }
}

/** Ce que la carte dit de ce qu'un changement fait — et ne fait pas. */
export const CE_QUE_FAIT_LA_NATURE = 'Le client ne la choisit pas : chacune de ses recettes en espèces la prend, et décide de '
  + 'sa ligne de la 2035. Changée, elle vaut pour ses recettes suivantes ; celles déjà saisies gardent la leur, et tu les '
  + 'remplaces au besoin dans l’onglet Caisse.'

/** Ce que l'écran dit quand la base n'a rendu aucune ligne : elle n'a rien écrit, sans lever d'erreur. */
export const NATURE_NON_ENREGISTREE = 'Rien n’a été enregistré : la base n’a modifié aucun dossier. La liste relue fait foi.'
