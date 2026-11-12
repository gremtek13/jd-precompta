import { POSTES_PROPOSABLES, posteRattache } from './cases2035'
import { formeDUnCompteDeRole } from './planDepuisLaBalance'
import type { PlanComptable } from './planComptable'
import type { Categorie } from './types'

// LES CATÉGORIES PROPRES À UN DOSSIER (ligne 43, étape PC7 ; Q9 « a oui, b ligne à part »). Les policies de `categories`
// laissent déjà le cabinet qui administre le dossier créer, modifier et supprimer SES catégories (relevé en production le
// 12/11/2026) ; aucun écran ne le faisait. La migration PRÉPARÉE `categories_du_dossier`
// (supabase/schema/20261112134532_categories_du_dossier.sql, essai supabase/essais/categoriesDuDossier.sql) pose la
// garde que la relation demande de ce côté-ci : le compte du barème kilométrique du plan refusé à des zéros près (le
// refus 10 de `regler_plan_du_dossier`, vu de la catégorie), une catégorie qui ne change pas de dossier, un code qui n'est
// pas celui d'une commune, la nature des recettes en espèces du client qui ne se supprime pas. Ce module redit ses refus
// AVANT le clic, et tient ce que la base ne juge pas : la forme du compte (six chiffres, classe 6 ou 7 — les comptes de
// charges et de produits, ce qu'une catégorie range ; la classe, la base la juge aussi quand `classes_des_categories` y
// est, PC7-Q2, et l'écran la dit à ses mots, plus bas), le poste de la 2035 dans la liste fermée de sa classe
// (`POSTES_PROPOSABLES`, le sens par `posteRattache`), et l'emploi (PC7-Q1 : une catégorie employée garde son compte et
// son poste ; son libellé change).
//
// LES CATÉGORIES COMMUNES (`dossier_id` nul, lib/categoriesCommunes.ts) ne se modifient pas d'ici : l'écran les montre et
// dit qui les règle. Le défaut du « silence » (§ 9, point 2) est corrigé depuis le 09/10/2026 aux trois cartes qui les
// écrivaient ; cet écran n'en ajoute pas une quatrième.

/** Levé le 12/11/2026, `categories_du_dossier` en production : l'écran des catégories du dossier. Le troisième temps de la
 *  carte de la balance attend en plus `PLAN_DEPUIS_LA_BALANCE_PREVU` (PC6, préparée, pas appliquée). */
export const CATEGORIES_DU_DOSSIER_PREVUES: boolean = true

export type ClasseDeCategorie = 6 | 7

/** Le libellé d'une catégorie : une ligne, d'un à cent vingt caractères, sans caractère de contrôle. */
export const LONGUEUR_MAX_DU_LIBELLE = 120

const estUnControle = (caractere: string) => {
  const code = caractere.codePointAt(0)!
  return code < 0x20 || (code >= 0x7f && code <= 0x9f)
}

/** Le libellé tel qu'il part, ou nul s'il n'en est pas un. */
export function libelleDeCategorie(saisie: string): string | null {
  const l = saisie.trim()
  return l !== '' && l.length <= LONGUEUR_MAX_DU_LIBELLE && ![...l].some(estUnControle) ? l : null
}

/**
 * Le compte d'une catégorie du dossier : un compte de charges (classe 6) ou de produits (classe 7), à six chiffres, à des
 * zéros près (art. 1131-2 : 6064 est le 606400) ; un refus dit sinon. Six chiffres : la longueur du plan (PC4, Q5).
 */
export function compteDeCategorie(saisie: string): { compte: string; classe: ClasseDeCategorie } | { refus: string } {
  const brut = saisie.trim()
  if (!/^[0-9]+$/.test(brut)) return { refus: 'Le compte s’écrit en chiffres.' }
  if (!/^[67]/.test(brut)) return { refus: refusDeLaClasse(brut) }
  const compte = formeDUnCompteDeRole(brut)
  if (compte === null) return { refus: 'Le compte a six chiffres significatifs au plus.' }
  if (compte.replace(/0+$/, '').length < 3) return { refus: 'Le compte a trois chiffres significatifs au moins : un 61 ou un 70 n’est qu’un regroupement.' }
  return { compte, classe: compte.startsWith('6') ? 6 : 7 }
}

/** Les postes de la 2035 qu'une catégorie de cette classe peut porter : la liste fermée, dans le sens de la classe. */
export function postesDeLaClasse(classe: ClasseDeCategorie): string[] {
  const nature = classe === 6 ? 'depense' : 'recette'
  return POSTES_PROPOSABLES.filter((poste) => posteRattache(poste, nature) !== null)
}

/** Le refus de la garde de la base (c), à ses mots, pour un compte et le barème du plan. */
export function refusDuBareme(compte: string, bareme: string): string {
  return `Le compte « ${compte} » est celui des indemnités kilométriques du plan de ce dossier (« ${bareme} »), à des zéros près : le barème et les frais réels restent séparés.`
}

/** Le refus de la garde de la base (d), à ses mots. */
export function refusDeLaNatureDesRecettes(libelle: string): string {
  return `La catégorie « ${libelle} » est la nature des recettes en espèces du client : elle ne se supprime pas tant qu'elle l'est.`
}

const memeCompte = (a: string, b: string) => a.replace(/0+$/, '') === b.replace(/0+$/, '')
const cleDuLibelle = (l: string) => l.trim().toLocaleLowerCase('fr').normalize('NFD').replace(/\p{M}/gu, '')

/** Ce qu'une catégorie cite ailleurs : de quoi dire, avant le clic, si son compte et son poste changent, et si elle part. */
export interface EmploisDUneCategorie {
  pieces: number
  mouvements: number
  ventilations: number
  operationsDeCaisse: number
  regles: number
  reglesDesTiers: number
  natureDesRecettes: boolean
}

export function estEmployee(e: EmploisDUneCategorie): boolean {
  return e.pieces + e.mouvements + e.ventilations + e.operationsDeCaisse + e.regles + e.reglesDesTiers > 0 || e.natureDesRecettes
}

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`

/** « Employée par 3 pièces et 1 mouvement du relevé. » — ou « Employée par rien. » */
export function phraseDesEmplois(e: EmploisDUneCategorie): string {
  const morceaux = [
    e.pieces > 0 ? pluriel(e.pieces, 'pièce', 'pièces') : null,
    e.mouvements > 0 ? pluriel(e.mouvements, 'mouvement du relevé', 'mouvements du relevé') : null,
    e.ventilations > 0 ? pluriel(e.ventilations, 'ventilation', 'ventilations') : null,
    e.operationsDeCaisse > 0 ? pluriel(e.operationsDeCaisse, 'opération de caisse', 'opérations de caisse') : null,
    e.regles > 0 ? pluriel(e.regles, 'règle d’affectation', 'règles d’affectation') : null,
    e.reglesDesTiers > 0 ? pluriel(e.reglesDesTiers, 'règle apprise d’un tiers', 'règles apprises de tiers') : null,
    e.natureDesRecettes ? 'la nature des recettes en espèces du client' : null,
  ].filter((m): m is string => m !== null)
  if (morceaux.length === 0) return 'Employée par rien.'
  return `Employée par ${morceaux.length === 1 ? morceaux[0] : `${morceaux.slice(0, -1).join(', ')} et ${morceaux[morceaux.length - 1]}`}.`
}

/** PC7-Q1 (préparée sur la recommandation) : une catégorie employée garde son compte et son poste. */
export const COMPTE_ET_POSTE_FIGES =
  'Cette catégorie est employée : son compte et son poste ne changent plus d’ici (les écritures déjà passées et la 2035 '
  + 'les liraient autrement). Son libellé, si. Pour un autre compte, créez une autre catégorie et reclassez.'

export interface SaisieDeCategorie {
  libelle: string
  compte: string
  poste: string
}

export interface ContexteDeLaSaisie {
  plan: PlanComptable
  /** Les catégories que le dossier voit, les siennes et les communes, lues en entier. */
  categories: readonly Categorie[]
  /** La catégorie modifiée et ses emplois lus, ou nulle pour une création. */
  modifiee: { categorie: Categorie; emplois: EmploisDUneCategorie } | null
}

/** La catégorie telle qu'elle part, ou le refus dit avant le clic. */
export function jugerLaCategorie(saisie: SaisieDeCategorie, contexte: ContexteDeLaSaisie):
  { libelle: string; compte: string; poste: string } | { refus: string } {
  const libelle = libelleDeCategorie(saisie.libelle)
  if (libelle === null) return { refus: `Le libellé tient sur une ligne, d’un à ${LONGUEUR_MAX_DU_LIBELLE} caractères.` }
  const homonyme = contexte.categories.find((c) => c.id !== contexte.modifiee?.categorie.id && cleDuLibelle(c.libelle) === cleDuLibelle(libelle))
  if (homonyme) return { refus: `« ${homonyme.libelle} » est déjà une catégorie ${homonyme.dossier_id === null ? 'commune' : 'du dossier'} : deux catégories ne portent pas le même nom.` }
  const lu = compteDeCategorie(saisie.compte)
  if ('refus' in lu) return lu
  if (memeCompte(lu.compte, contexte.plan.indemnites_kilometriques)) return { refus: refusDuBareme(lu.compte, contexte.plan.indemnites_kilometriques) }
  const poste = saisie.poste.trim()
  if (poste === '') return { refus: 'Choisissez le poste de la 2035 : la catégorie y range ses montants.' }
  if (!postesDeLaClasse(lu.classe).includes(poste)) {
    return { refus: `Le poste « ${poste} » ne reçoit pas ${lu.classe === 6 ? 'une charge' : 'un produit'} sur la 2035.` }
  }
  const m = contexte.modifiee
  if (m && estEmployee(m.emplois) && (lu.compte !== (m.categorie.compte_comptable ?? '') || poste !== (m.categorie.poste_2035 ?? ''))) {
    return { refus: COMPTE_ET_POSTE_FIGES }
  }
  return { libelle, compte: lu.compte, poste }
}

/** Ce qu'une autre catégorie déjà vue tient sur le même compte, à des zéros près : un avertissement, jamais un refus. */
export function memeCompteQue(compte: string, categories: readonly Categorie[], exclue: string | null): Categorie | null {
  return categories.find((c) => c.id !== exclue && c.compte_comptable !== null && memeCompte(c.compte_comptable, compte)) ?? null
}

/** Le code d'une nouvelle catégorie du dossier : stable (il ne suit pas le libellé), jamais celui d'une commune. */
export function codeDUneCategorieDuDossier(compte: string, codesPris: ReadonlySet<string>): string {
  const base = `dossier_${compte}`
  if (!codesPris.has(base)) return base
  for (let n = 2; ; n++) if (!codesPris.has(`${base}_${n}`)) return `${base}_${n}`
}

// ── LA CLASSE DU COMPTE, EN BASE (PC7-Q2 ; la réponse du cabinet du 12/11/2026 : « Oui, en lot à part ») ────────────────
// La migration PRÉPARÉE `classes_des_categories` (supabase/preparees/20261112233000_classes_des_categories.sql ; son essai,
// supabase/essais/categoriesDuDossier.sql, étapes 40 à 49 ; HISTORIQUE.md, « 12/11/2026 — PC7-Q2 : LA CLASSE DU COMPTE D'UNE
// CATÉGORIE DU DOSSIER, EN BASE ») ajoute à la garde de `categories` le refus (e) : une catégorie DU DOSSIER dont le compte,
// non nul, n'est pas de la classe 6 ou 7 suivie de deux chiffres — le prédicat des fonctions du relevé —, à l'insertion ou
// quand il change, pour tout auteur, la restauration du super-administrateur comprise. Une catégorie commune n'en est pas
// jugée (PC7Q2-Q1), ni un compte nul, qui attend le sien (« Comptes manquants »). Sources : plan comptable général
// (règlement ANC n° 2014-03), art. 1121-1 et sa liste (classe 6, charges ; classe 7, produits), art. 1131-1.

/** Baissé jusqu'à l'application de `classes_des_categories` : la carte « Comptes manquants » (onglet Écritures) ne refuse
 *  pas encore avant le clic le compte d'une catégorie du dossier hors des classes 6 et 7, que la base accepterait. Il se
 *  lève la migration en base (son essai), puis le déploiement ; il se baisse AVANT tout retour de la migration. */
export const CLASSES_DES_CATEGORIES_PREVUES = false

/** Le prédicat de la base (`compte_comptable !~ '^[67][0-9]{2}'`, refusé) : un compte de charge ou de produit. */
export function estUnCompteDeChargeOuDeProduit(compte: string): boolean {
  return /^[67][0-9]{2}/.test(compte)
}

/** Le refus (e) de la garde de la base, à ses mots, pour le compte tel qu'il part. */
export function refusDeLaClasse(compte: string): string {
  return `Le compte « ${compte} » n'est pas un compte de charge ou de produit (classe 6 ou 7, trois chiffres en tête) : une catégorie du dossier ne range qu'une charge ou un produit.`
}

/** Ce que la base dit du compte d'une catégorie, tel qu'il part : le refus (e) pour une catégorie du dossier, rien pour une
 *  commune (PC7Q2-Q1). */
export function refusDuCompteDUneCategorie(categorie: Pick<Categorie, 'dossier_id'>, compte: string): string | null {
  return categorie.dossier_id !== null && !estUnCompteDeChargeOuDeProduit(compte) ? refusDeLaClasse(compte) : null
}
