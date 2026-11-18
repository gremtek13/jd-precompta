// LA CATÉGORIE HABITUELLE D'UN CRÉDIT ASSOCIÉ À UN PAIEMENT DE L'ASSURANCE MALADIE (NOE5B-Q1 (B), réponse du cabinet du
// 18/11/2026 : « proposer la catégorie la plus fréquente des crédits associés du dossier, au clic » ; conception 53, § 5 : « la
// fiche peut proposer la catégorie de recette habituelle »).
//
// Un module PUR : ni base, ni horloge. Il ne fait que PROPOSER : la fiche d'un crédit associé, encore à traiter, dit la
// catégorie la plus fréquente des AUTRES crédits associés du dossier, et un clic la met dans la liste des catégories de la
// fiche ; rien ne s'écrit avant « Affecter », le geste d'hier, sous le verrou de l'onglet, avec ses refus dits avant le clic.
//
// IL SE TAIT (rien de proposé) : hors d'un crédit associé encore à traiter et non figé ; sur un calcul muet (une lecture
// partielle du relevé, des paiements, des associations, des ventes ou des exercices : le rapprochement ne se calcule alors
// pas) ; sur des catégories lues en partie ; quand un crédit associé manque au relevé passé (les deux lectures ne se
// suivent pas) ; quand aucun autre crédit associé n'est classé ; à ÉGALITÉ entre deux catégories ; quand la plus fréquente
// n'est plus une catégorie de recette du dossier. Un crédit ventilé ne compte pour aucune catégorie : ses parts en ont
// plusieurs. Aucun libellé du relevé n'entre dans un mot.

import { natureDuCompte } from './affectationBanque'
import type { AssuranceMaladieDeLaFiche } from './associationsAssuranceMaladieVue'
import type { ListeLue } from './rapprochementAssuranceMaladie'
import type { Categorie, LigneBancaire } from './types'

export interface CategorieHabituelle {
  readonly categorieId: string
  readonly libelle: string
  /** Les autres crédits associés classés dans cette catégorie, et tous les autres crédits associés classés. */
  readonly dansLaCategorie: number
  readonly classes: number
}

type MouvementCompte = Pick<LigneBancaire, 'id' | 'categorie_id' | 'ventilee'>

/** La catégorie la plus fréquente des autres crédits associés du dossier, ou rien (voir l'en-tête). */
export function categorieHabituelleDuCredit(
  fiche: AssuranceMaladieDeLaFiche,
  ligne: Pick<LigneBancaire, 'id' | 'montant' | 'statut' | 'categorie_id'>,
  releve: readonly MouvementCompte[],
  categories: ListeLue<Pick<Categorie, 'id' | 'libelle' | 'compte_comptable'>> | null,
): CategorieHabituelle | null {
  if (fiche.genre !== 'etat' || fiche.etat.genre !== 'associe' || fiche.etat.fige || fiche.mouvementId !== ligne.id) return null
  if (ligne.montant <= 0 || ligne.statut !== 'non_rapprochee' || ligne.categorie_id) return null
  if (categories === null || !categories.complete) return null
  const parId = new Map(releve.map((m) => [m.id, m]))
  const compte = new Map<string, number>()
  let classes = 0
  for (const id of fiche.rapprochement.mouvementsAssocies) {
    if (id === ligne.id) continue
    const m = parId.get(id)
    if (!m) return null
    if (m.ventilee || !m.categorie_id) continue
    classes++
    compte.set(m.categorie_id, (compte.get(m.categorie_id) ?? 0) + 1)
  }
  const tries = [...compte.entries()].sort((a, b) => b[1] - a[1])
  if (tries.length === 0 || (tries.length > 1 && tries[0][1] === tries[1][1])) return null
  const [categorieId, dansLaCategorie] = tries[0]
  const categorie = categories.lignes.find((c) => c.id === categorieId)
  if (!categorie || natureDuCompte(categorie.compte_comptable) !== 'recette') return null
  return { categorieId, libelle: categorie.libelle, dansLaCategorie, classes }
}

/** Ce que la fiche dit de la proposition, avant le clic : la catégorie, sur combien, et ce que le clic fait. */
export function categorieHabituelleDite(c: CategorieHabituelle): string {
  return `Les autres crédits associés à un paiement de l’assurance maladie sont le plus souvent classés « ${c.libelle} » `
    + `(${c.dansLaCategorie} sur ${c.classes} classé${c.classes > 1 ? 's' : ''}). La choisir la met dans la liste ci-dessous ; `
    + 'rien ne s’écrit avant « Affecter ».'
}

/** Le bouton qui la choisit, sans rien écrire. */
export const BOUTON_CATEGORIE_HABITUELLE = 'Choisir cette catégorie'
