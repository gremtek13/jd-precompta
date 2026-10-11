import type { Declaration2035 } from './declaration2035'
import { remplirModele } from './encaissementsFactures'
import type { PartDuReleve } from './partsDuReleve'
import { centimesDuSoldeAnnonce, soldeCommeLaBase, soldesDeLExercice } from './revision'
import { cycleDuCompte } from './revisionCycles'
import { BLANCS_D_UN_TEXTE, soldeDuCompteCentimes } from './revisionSoldes'
import type {
  ANouveau, EcritureBrouillon, ExerciceValide, ObjetExplicationRevue, ReferenceAnnuelle, ReferencePosteAnnuel,
  RevisionExplication, RevisionSeuil, SoldeReporte, SourcePrecedentRevue,
} from './types'

// LA REVUE ANALYTIQUE D'UN EXERCICE (ligne 41, étape R5 ; conception du 09/10/2026, HISTORIQUE.md, « LA RÉVISION DES
// COMPTES : LA CONCEPTION », § 1.4, 1.7, 3.7 et 4.5 ; migration revue_analytique). Un module PUR : il ne lit rien en
// base, n'appelle personne, ne lit pas l'horloge — l'écran lui donne ce qu'il a lu, en entier, et l'année en cours à
// Paris.
//
// L'expert-comptable « met en œuvre une revue analytique lors de l'examen de la cohérence et de la vraisemblance » des
// comptes (NP 2300, § 13) ; il « effectue des rapprochements entre les rubriques du bilan et du compte de résultat » avec
// l'exercice précédent et analyse les variations significatives (A7) ; il « s'efforce d'obtenir des explications de la
// direction » (§ 15). Le seuil de signification est un « montant au-delà duquel les décisions économiques ou le jugement
// fondé sur les comptes sont susceptibles d'être influencés » (glossaire agréé par l'arrêté du 30/05/2024). Textes relus
// sur Légifrance le 11/10/2026.
//
// Ce module dit, avant le clic :
//   - le TABLEAU de l'exercice face au précédent : chaque poste de la 2035 (par nature) et ses trois totaux, chaque
//     compte des classes 1 à 7 ; la variation en euros et en pourcentage ; la SOURCE du précédent — l'exercice validé
//     (sa 2035 validée pour une ligne de la 2035), sinon un repère annuel de l'onglet Estimation, sinon rien : jamais un
//     recalcul de l'exercice précédent (§ 3.7) ;
//   - l'ÉTAT de chaque ligne, DÉDUIT et jamais stocké : expliquée, à revoir (les montants qu'elle commente ne sont plus
//     ceux du jour), à expliquer (la variation dépasse le seuil), sous le seuil, sans seuil, sans comparaison. Une
//     explication attendue est DITE, pas imposée avant l'étape R6 ; et l'application ne qualifie aucune variation de
//     « normale » : elle calcule, le cabinet explique ;
//   - les RECETTES MOIS PAR MOIS, lues dans les écritures des comptes du cycle des recettes, face au même mois de
//     l'exercice précédent validé ;
//   - les DÉPENSES AFFECTÉES SANS PIÈCE — un mouvement du relevé affecté ou ventilé sur une charge, le relevé pour seule
//     preuve — au-delà du seuil (toutes, sans seuil) ;
//   - ce que `fixer_seuil_de_signification` et `expliquer_variation` REFUSERAIENT, dans leur ordre et sous leurs mots,
//     confronté au texte des fonctions (`revueAnalytique.test.ts`) et rejoué sur l'essai de l'étape
//     (`revueAnalytiqueEssai.test.ts`) ; et les arguments, tels que supabase-js les envoie.
//
// LES HYPOTHÈSES DU CABINET (questions du 09/10/2026, sans réponse), telles que la migration les prend — aucune n'est
// tranchée ici :
//   - Q4, LE SEUIL : fixé par le cabinet, par exercice, avec un motif ; le module n'en calcule ni n'en propose aucun ;
//     sans seuil, aucune explication n'est attendue ;
//   - Q2 : tout membre affecté au dossier fixe le seuil et explique (`accesAuDossier`, que l'écran tient de la session) ;
//   - Q11 : seul un exercice terminé se révise ; Q1 : rien ici ne refuse une validation (étape R6).
// TROIS LECTURES de la conception, dites ici : « au-delà du seuil » se lit STRICTEMENT supérieur (« montant au-delà
// duquel ») ; un poste de la 2035 se désigne avec sa NATURE (le moteur tient une ligne par poste ET par nature) ; un
// repère annuel ne porte que les postes de DÉPENSES (le détail par poste de l'Estimation n'est fait que de charges), le
// chiffre d'affaires (le total des recettes) et le résultat net — rien pour un compte.

// ── Ce que la base admet ──────────────────────────────────────────────────────────────────────────────────────────

export const OBJETS_DE_LA_REVUE = ['poste_2035', 'total_2035', 'compte'] as const satisfies readonly ObjetExplicationRevue[]
export const TOTAUX_DE_LA_2035 = ['recettes', 'depenses', 'resultat'] as const
export type TotalDeLa2035 = (typeof TOTAUX_DE_LA_2035)[number]
export const NATURES_D_UN_POSTE = ['recette', 'depense'] as const
export type NatureDUnPoste = (typeof NATURES_D_UN_POSTE)[number]
export const SOURCES_DU_PRECEDENT = ['validee', 'reference', 'aucune'] as const satisfies readonly SourcePrecedentRevue[]

/** Les comptes qui se comparent d'un exercice à l'autre : classes 1 à 7, au moins trois chiffres. */
export const MOTIF_COMPTE_COMPARE = /^[1-7][0-9]{2,}$/
/** Les longueurs que la base admet, en caractères (points de code). */
export const LONGUEUR_MAX_POSTE = 500
export const LONGUEUR_MAX_EXPLICATION = 4000
export const LONGUEUR_MAX_MOTIF_DU_SEUIL = 4000
/** Un montant de l'application reste sous cent mille milliards d'euros, en valeur absolue. */
export const BORNE_DES_MONTANTS = 100_000_000_000_000

export const LIBELLE_DU_TOTAL: Readonly<Record<TotalDeLa2035, string>> = {
  recettes: 'Total des recettes',
  depenses: 'Total des dépenses',
  resultat: 'Résultat',
}
export const LIBELLE_DE_LA_SOURCE: Readonly<Record<SourcePrecedentRevue, string>> = {
  validee: 'Exercice validé',
  reference: 'Repère annuel',
  aucune: 'Aucune',
}

// Un texte qui ne dit rien : la base en ôte les blancs (`btrim(…, E' \t\n\r')`) et le trouve vide.
const queDesBlancs = (t: string) => [...t].every((c) => BLANCS_D_UN_TEXTE.includes(c))
// Les caractères comme `length` les compte en base : des points de code.
const caracteres = (t: string) => [...t].length
// La base compare un uuid sans la casse.
const minuscules = (id: string) => id.toLowerCase()
const estObjet = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

// ── Les centimes, comme l'application les compte ──────────────────────────────────────────────────────────────────

/**
 * Math.round(montant × 100), le jumeau de `centimes_du_navigateur` : nul hors de ±10^14 €, pour NaN, l'infini et ce qui
 * n'est pas un nombre. Le zéro négatif de Math.round devient zéro, comme en base.
 */
export function centimesDuNavigateur(montant: unknown): number | null {
  if (typeof montant !== 'number' || !Number.isFinite(montant) || !(Math.abs(montant) < BORNE_DES_MONTANTS)) return null
  return Math.round(montant * 100) + 0
}

/** Un montant comme la base l'écrit dans un refus : `replace(to_char(v, 'FM99999999999990.00'), '.', ',') || ' €'`. */
export function montantCommeLaBase(c: number): string {
  return `${c < 0 ? '-' : ''}${soldeCommeLaBase(c)} €`
}

// Le côté d'un solde comme `justifier_solde` (étape R1) et `expliquer_variation` l'écrivent.
const coteDuSolde = (c: number) => (c === 0 ? 'est nul' : `est de ${soldeCommeLaBase(c)} € au ${c > 0 ? 'débit' : 'crédit'}`)

// ── Une ligne de la revue ─────────────────────────────────────────────────────────────────────────────────────────

/** Une ligne, comme la base la désigne : le type d'objet, l'objet, la nature (nulle hors d'un poste). */
export interface CleDeLigne {
  objet_type: ObjetExplicationRevue
  objet: string
  nature: NatureDUnPoste | null
}

const memeLigne = (a: Pick<CleDeLigne, 'objet_type' | 'objet' | 'nature'>, b: Pick<CleDeLigne, 'objet_type' | 'objet' | 'nature'>) =>
  a.objet_type === b.objet_type && a.objet === b.objet && (a.nature ?? null) === (b.nature ?? null)

const clePoste = (nature: string, poste: string) => `${nature}|${poste}`

// ── La 2035 validée, relue ────────────────────────────────────────────────────────────────────────────────────────

/** Une 2035 validée, relue en centimes : ses trois totaux, et chaque poste par nature (`recette|nom`, `depense|nom`). */
export interface La2035Lue {
  totaux: Readonly<Record<TotalDeLa2035, number>>
  postes: ReadonlyMap<string, number>
}

const CLES_DES_TOTAUX: readonly [TotalDeLa2035, string][] = [['recettes', 'totalRecettes'], ['depenses', 'totalDepenses'], ['resultat', 'resultat']]

// L'INSTANTANÉ DE LA 2035 VALIDÉE (`exercices_valides.declaration`), RELU SANS DEVINER, comme `centimes_de_la_2035_validee`
// le relit : un objet, une liste de postes — chacun un nom, une nature, recette ou dépense, et un montant —, trois totaux,
// chaque montant un nombre aux bornes de l'application. Sinon nul : l'instantané ne se relit pas, et rien ne s'en compare.
// Un poste porté deux fois compte pour la somme de ses entrées, comme en base.
export function lireLa2035Validee(declaration: unknown): La2035Lue | null {
  if (!estObjet(declaration) || !Array.isArray(declaration.postes)) return null
  const totaux: Record<string, number> = {}
  for (const [total, cle] of CLES_DES_TOTAUX) {
    const c = centimesDuNavigateur(declaration[cle])
    if (c === null) return null
    totaux[total] = c
  }
  const postes = new Map<string, number>()
  for (const p of declaration.postes as unknown[]) {
    if (!estObjet(p) || typeof p.poste !== 'string' || (p.nature !== 'recette' && p.nature !== 'depense')) return null
    const c = centimesDuNavigateur(p.montant)
    if (c === null) return null
    const cle = clePoste(p.nature, p.poste)
    postes.set(cle, (postes.get(cle) ?? 0) + c)
  }
  return { totaux: totaux as Record<TotalDeLa2035, number>, postes }
}

/** Les centimes d'une ligne dans une 2035 validée, le jumeau de `centimes_de_la_2035_validee` ; nul quand elle ne se relit pas. */
export function centimesDeLa2035Validee(declaration: unknown, ligne: CleDeLigne): number | null {
  const lue = lireLa2035Validee(declaration)
  if (lue === null) return null
  if (ligne.objet_type === 'total_2035') {
    return ligne.objet === 'recettes' ? lue.totaux.recettes : ligne.objet === 'depenses' ? lue.totaux.depenses : lue.totaux.resultat
  }
  return lue.postes.get(clePoste(ligne.nature ?? '', ligne.objet)) ?? 0
}

// ── Les repères annuels ───────────────────────────────────────────────────────────────────────────────────────────

/** Les repères annuels du dossier (onglet Estimation), tous exercices : ce que la base lit d'eux, et rien d'autre. */
export interface ReperesAnnuels {
  annuels: readonly Pick<ReferenceAnnuelle, 'annee' | 'chiffre_affaires' | 'resultat_net'>[]
  postes: readonly Pick<ReferencePosteAnnuel, 'annee' | 'poste' | 'montant'>[]
}

/** Les centimes d'une ligne dans les repères d'un exercice, le jumeau de `centimes_du_repere_annuel` ; nul sans repère. */
export function centimesDuRepereAnnuel(reperes: ReperesAnnuels, annee: number, ligne: CleDeLigne): number | null {
  if (ligne.objet_type === 'poste_2035' && ligne.nature === 'depense') {
    const r = reperes.postes.find((x) => x.annee === annee && x.poste === ligne.objet)
    return r === undefined ? null : centimesDuNavigateur(r.montant)
  }
  if (ligne.objet_type === 'total_2035' && (ligne.objet === 'recettes' || ligne.objet === 'resultat')) {
    const r = reperes.annuels.find((x) => x.annee === annee)
    if (r === undefined) return null
    return centimesDuNavigateur(ligne.objet === 'recettes' ? r.chiffre_affaires : r.resultat_net)
  }
  return null
}

// ── La source de l'exercice précédent ─────────────────────────────────────────────────────────────────────────────

export type ExercicePourLaRevue = Pick<ExerciceValide, 'annee' | 'declaration'>

/**
 * Ce à quoi une ligne de l'exercice `annee` se compare, le jumeau de `source_du_precedent` : la 2035 validée de
 * l'exercice précédent pour une ligne de la 2035, son exercice validé pour un compte ; sinon un repère annuel qui porte
 * la ligne (jamais pour un compte) ; sinon rien. Un exercice validé en engagement n'a pas de 2035 validée.
 */
export function sourceDuPrecedent(
  annee: number,
  ligne: CleDeLigne,
  c: { exercicesValides: readonly ExercicePourLaRevue[]; reperes: ReperesAnnuels },
): SourcePrecedentRevue {
  if (ligne.objet_type === 'compte') return c.exercicesValides.some((v) => v.annee === annee - 1) ? 'validee' : 'aucune'
  if (c.exercicesValides.some((v) => v.annee === annee - 1 && v.declaration !== null)) return 'validee'
  return centimesDuRepereAnnuel(c.reperes, annee - 1, ligne) !== null ? 'reference' : 'aucune'
}

// ── Les chaînes ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Une chaîne de remplacements : de la première à la courante ; dans l'ordre de leur création quand elle ne se lit pas. */
export interface Chaine<T> {
  elements: T[]
  courant: T | null
  lisible: boolean
}

// LA CHAÎNE EST L'ORDRE (§ 3.3) : la première ne remplace rien, chacune est remplacée par une seule ; aucun horodatage ne
// départage. La base la garde linéaire ; l'écran ne l'affirme que s'il la relit telle — sinon pas de courant.
function chaine<T extends { id: string; remplace_id: string | null; cree_le: string }>(elements: readonly T[]): Chaine<T> {
  const suites = new Map<string, T[]>()
  for (const e of elements) {
    if (e.remplace_id !== null) suites.set(minuscules(e.remplace_id), [...(suites.get(minuscules(e.remplace_id)) ?? []), e])
  }
  const lue: T[] = []
  let suivant = elements.find((e) => e.remplace_id === null)
  while (suivant !== undefined && !lue.includes(suivant)) {
    lue.push(suivant)
    suivant = suites.get(minuscules(suivant.id))?.[0]
  }
  // Deux premiers, deux suites d'un même élément, une boucle : la chaîne ne passe pas par tous, ou ne s'arrête pas.
  if (lue.length === elements.length && suivant === undefined) {
    return { elements: lue, courant: lue.at(-1) ?? null, lisible: true }
  }
  const parCreation = [...elements].sort((a, b) => a.cree_le.localeCompare(b.cree_le) || a.id.localeCompare(b.id))
  return { elements: parCreation, courant: null, lisible: false }
}

/** Les seuils d'un exercice, en chaîne ; le courant est le seuil de l'exercice. */
export function chaineDesSeuils(seuils: readonly RevisionSeuil[], annee: number): Chaine<RevisionSeuil> {
  return chaine(seuils.filter((s) => s.annee === annee))
}

/** Les explications d'une ligne pour un exercice, en chaîne. */
export function chaineDesExplications(
  explications: readonly RevisionExplication[],
  annee: number,
  ligne: CleDeLigne,
): Chaine<RevisionExplication> {
  return chaine(explications.filter((e) => e.annee === annee && memeLigne(e, ligne)))
}

// ── L'exercice ────────────────────────────────────────────────────────────────────────────────────────────────────

// UN SEUIL SE FIXE ET UNE VARIATION S'EXPLIQUE sur un exercice terminé (hypothèse Q11), dans les bornes de la base — sans
// attendre l'ouverture définitive que les SOLDES attendent (étape R1, refus 6 et 7) : sans exercice précédent validé, une
// ligne n'a pas de comparaison, et le dit.
export type ExerciceDeLaRevue = 'ouvert' | 'invalide' | 'en-cours'

export function exerciceDeLaRevue(annee: number, anneeCourante: number): ExerciceDeLaRevue {
  if (!Number.isInteger(annee) || annee < 2000 || annee > 2100) return 'invalide'
  return annee >= anneeCourante ? 'en-cours' : 'ouvert'
}

// ── Ce que les deux fonctions refusent, dit avant le clic ─────────────────────────────────────────────────────────

// LES REFUS, DANS L'ORDRE DU TEXTE DE CHAQUE FONCTION ET SOUS SES MOTS — le RAISE de PL/pgSQL, chaque « % » rempli par
// sa valeur (`remplirModele`). `revueAnalytique.test.ts` lit la dernière définition exportée de chaque fonction et exige
// la même liste, mot pour mot, avec ses codes, ses numéros et les valeurs de ses « % » ; `revueAnalytiqueEssai.test.ts`
// rejoue chaque appel de supabase/essais/revueAnalytique.sql et exige du module le refus, ou l'absence de refus, que la
// base a rendu. Le refus 4 (un dossier de travail figé) attend l'étape R9 : sa place est gardée dans l'ordre.
const MESSAGE_EN_COURS = "L'exercice % n'est pas terminé : sa révision s'ouvre une fois clos."
const MESSAGE_ILLISIBLE = 'La 2035 validée de % ne se relit pas.'
const MESSAGE_AUTRE_MONTANT = 'La 2035 validée de % porte un autre montant sur cette ligne : %.'

export const REFUS_FIXER_SEUIL = [
  { cle: 'acces', refus: 1, modele: 'Accès refusé à ce dossier.' },
  { cle: 'exercice_invalide', refus: 2, modele: 'Exercice invalide.' },
  { cle: 'exercice_en_cours', refus: 3, modele: MESSAGE_EN_COURS },
  { cle: 'seuil_invalide', refus: 5, modele: 'Le seuil de signification est un montant positif, au centime.' },
  { cle: 'motif_absent', refus: 6, modele: 'Un seuil de signification se motive.' },
  { cle: 'motif_trop_long', refus: 6, modele: 'Un motif tient en 4 000 caractères au plus.' },
  { cle: 'remplacement_hors_exercice', refus: 7, modele: "Le seuil à remplacer n'est pas un seuil de l'exercice % dans ce dossier." },
  { cle: 'remplacement_perime', refus: 7, modele: 'Un autre seuil a été fixé pour cet exercice depuis : relire avant de le changer.' },
] as const

export const REFUS_EXPLIQUER_VARIATION = [
  { cle: 'acces', refus: 1, modele: 'Accès refusé à ce dossier.' },
  { cle: 'exercice_invalide', refus: 2, modele: 'Exercice invalide.' },
  { cle: 'exercice_en_cours', refus: 3, modele: MESSAGE_EN_COURS },
  { cle: 'objet_inconnu', refus: 5, modele: 'Une explication porte sur un poste de la 2035, un total de la 2035 ou un compte.' },
  { cle: 'poste_sans_nom', refus: 5, modele: 'Un poste de la 2035 se nomme : son nom ne peut pas être vide.' },
  { cle: 'poste_trop_long', refus: 5, modele: "Le nom d'un poste de la 2035 tient en 500 caractères au plus." },
  { cle: 'nature_du_poste', refus: 5, modele: 'Un poste de la 2035 est une recette ou une dépense.' },
  { cle: 'total_inconnu', refus: 5, modele: 'Un total de la 2035 est celui des recettes, celui des dépenses, ou le résultat.' },
  { cle: 'compte_hors_classes', refus: 5, modele: "Seul un compte des classes 1 à 7 se compare d'un exercice à l'autre." },
  { cle: 'nature_hors_poste', refus: 5, modele: 'Seul un poste de la 2035 porte une nature.' },
  { cle: 'montant_invalide', refus: 6, modele: "Le montant annoncé n'est pas un montant au centime." },
  { cle: 'source_inconnue', refus: 6, modele: "La source de l'exercice précédent est l'exercice validé, un repère annuel, ou aucune." },
  {
    cle: 'precedent_sans_source', refus: 6,
    modele: "Sans source pour l'exercice précédent, une explication ne porte pas de montant précédent.",
  },
  { cle: 'precedent_invalide', refus: 6, modele: "Le montant précédent annoncé n'est pas un montant au centime." },
  { cle: 'explication_vide', refus: 7, modele: 'Une explication se rédige : elle ne peut pas être vide.' },
  { cle: 'explication_trop_longue', refus: 7, modele: 'Une explication tient en 4 000 caractères au plus.' },
  { cle: 'source_validee', refus: 8, modele: "L'exercice % est validé : la comparaison se fait à ce qu'il a validé." },
  { cle: 'source_reference', refus: 8, modele: 'Un repère annuel de % porte cette ligne : la comparaison se fait à lui.' },
  { cle: 'source_aucune', refus: 8, modele: "L'exercice % n'offre rien à comparer à cette ligne." },
  { cle: 'solde_change', refus: 9, modele: 'Le solde du compte % a changé : au 31/12/%, il %.' },
  { cle: 'solde_precedent_change', refus: 9, modele: "Le solde du compte % au 31/12/% n'est pas celui de l'exercice validé : il %." },
  { cle: 'exercice_illisible', refus: 9, modele: MESSAGE_ILLISIBLE },
  { cle: 'exercice_autre_montant', refus: 9, modele: MESSAGE_AUTRE_MONTANT },
  { cle: 'precedent_illisible', refus: 9, modele: MESSAGE_ILLISIBLE },
  { cle: 'precedent_autre_montant', refus: 9, modele: MESSAGE_AUTRE_MONTANT },
  { cle: 'repere_autre_montant', refus: 9, modele: 'Le repère annuel de % porte un autre montant sur cette ligne : %.' },
  {
    cle: 'remplacement_hors_ligne', refus: 10,
    modele: "L'explication à remplacer n'est pas une explication de cette ligne pour l'exercice %.",
  },
  { cle: 'remplacement_perime', refus: 10, modele: "Une autre explication a été donnée sur cette ligne depuis : relire avant d'expliquer." },
] as const

export type CleRefusSeuil = (typeof REFUS_FIXER_SEUIL)[number]['cle']
export type CleRefusExplication = (typeof REFUS_EXPLIQUER_VARIATION)[number]['cle']

export interface RefusDeLaRevue<K extends string> {
  cle: K
  // Le numéro du refus dans l'ordre de sa fonction.
  refus: number
  // Le code SQLSTATE que la base lève : 42501 pour l'accès, 22023 pour les autres.
  code: '42501' | '22023'
  message: string
}

function fabrique<K extends string>(liste: readonly { cle: K; refus: number; modele: string }[]) {
  return (cle: K, ...valeurs: string[]): RefusDeLaRevue<K> => {
    const r = liste.find((x) => x.cle === cle) as { cle: K; refus: number; modele: string }
    return { cle, refus: r.refus, code: r.refus === 1 ? '42501' : '22023', message: remplirModele(r.modele, valeurs) }
  }
}
const refusSeuil = fabrique<CleRefusSeuil>(REFUS_FIXER_SEUIL)
const refusExplication = fabrique<CleRefusExplication>(REFUS_EXPLIQUER_VARIATION)

// Les refus 2 et 3, communs aux deux fonctions : l'exercice en cours se nomme, un exercice invalide non. Un NaN part en
// JSON null, comme une année absente.
function refusDeLExercice(annee: number | null, anneeCourante: number): ['exercice_invalide'] | ['exercice_en_cours', string] | null {
  if (annee === null || !Number.isFinite(annee) || annee < 2000 || annee > 2100) return ['exercice_invalide']
  return annee >= anneeCourante ? ['exercice_en_cours', String(annee)] : null
}

/** Les arguments de `fixer_seuil_de_signification`, tels que supabase-js les envoie : les cinq, nuls plutôt qu'absents. */
export interface ArgumentsFixerSeuil {
  p_dossier_id: string
  p_annee: number | null
  p_seuil: number | null
  p_motif: string | null
  p_remplace_id: string | null
}

/** Ce que l'écran a lu pour dire les refus du seuil : la session, l'année à Paris, les seuils du dossier. */
export interface ContexteDuSeuil {
  // L'appelant est-il `admin_du_dossier` du dossier annoncé ? Hypothèse Q2 : tout membre affecté fixe le seuil.
  accesAuDossier: boolean
  anneeCourante: number
  seuils: readonly Pick<RevisionSeuil, 'id' | 'annee' | 'remplace_id'>[]
}

// Le seuil COURANT d'un exercice, comme la base le cherche : celui qu'aucun autre ne remplace.
function courantParmi<T extends { id: string; remplace_id: string | null }>(tous: readonly T[], dumeme: readonly T[]): string | null {
  const remplaces = new Set(tous.filter((x) => x.remplace_id !== null).map((x) => minuscules(x.remplace_id as string)))
  return dumeme.find((x) => !remplaces.has(minuscules(x.id)))?.id ?? null
}

/**
 * Ce que `fixer_seuil_de_signification` refuserait, le premier refus dans son ordre, avec son code et ses mots ; nul
 * quand elle écrirait le seuil. Le refus 1 dépend de la session ; aucun autre ne dépend de qui clique.
 */
export function refusDeFixerSeuil(a: ArgumentsFixerSeuil, c: ContexteDuSeuil): RefusDeLaRevue<CleRefusSeuil> | null {
  // 1. L'accès (hypothèse Q2).
  if (!c.accesAuDossier) return refusSeuil('acces')
  // 2. et 3. (hypothèse Q11).
  const exercice = refusDeLExercice(a.p_annee, c.anneeCourante)
  if (exercice !== null) {
    const [cle, ...valeurs] = exercice
    return refusSeuil(cle, ...valeurs)
  }
  const annee = a.p_annee as number
  // 5. Un montant positif, au centime, sous la borne de la base.
  const seuil = centimesDuSoldeAnnonce(a.p_seuil)
  if (seuil === null || !(seuil > 0)) return refusSeuil('seuil_invalide')
  // 6. Hypothèse Q4 : le seuil se motive.
  if (a.p_motif === null || queDesBlancs(a.p_motif)) return refusSeuil('motif_absent')
  if (caracteres(a.p_motif) > LONGUEUR_MAX_MOTIF_DU_SEUIL) return refusSeuil('motif_trop_long')
  // 7. On remplace le seuil courant, ou rien s'il n'y en a pas.
  const deLExercice = c.seuils.filter((s) => s.annee === annee)
  if (a.p_remplace_id !== null && !deLExercice.some((s) => minuscules(s.id) === minuscules(a.p_remplace_id as string))) {
    return refusSeuil('remplacement_hors_exercice', String(annee))
  }
  const courant = courantParmi(c.seuils, deLExercice)
  if ((a.p_remplace_id === null ? null : minuscules(a.p_remplace_id)) !== (courant === null ? null : minuscules(courant))) {
    return refusSeuil('remplacement_perime')
  }
  return null
}

/** Les arguments de `expliquer_variation`, tels que supabase-js les envoie : les dix, nuls plutôt qu'absents. */
export interface ArgumentsExpliquerVariation {
  p_dossier_id: string
  p_annee: number | null
  p_objet_type: string | null
  p_objet: string | null
  p_nature: string | null
  p_montant: number | null
  p_montant_precedent: number | null
  p_source_precedent: string | null
  p_explication: string | null
  p_remplace_id: string | null
}

/** Le brouillon, la reprise et les soldes reportés du dossier : ce que `solde_du_compte` lit. */
export interface EcrituresDuDossier {
  ecritures: readonly Pick<EcritureBrouillon, 'date' | 'compte' | 'sens' | 'montant'>[]
  reprise: readonly ANouveau[]
  reportes: readonly SoldeReporte[]
}

/** Ce que l'écran a lu pour dire les refus d'une explication : la session, l'année à Paris, le dossier EN ENTIER. */
export interface ContexteDeLExplication extends EcrituresDuDossier {
  // Hypothèse Q2 : tout membre affecté au dossier explique.
  accesAuDossier: boolean
  anneeCourante: number
  exercicesValides: readonly ExercicePourLaRevue[]
  reperes: ReperesAnnuels
  explications: readonly Pick<RevisionExplication, 'id' | 'annee' | 'objet_type' | 'objet' | 'nature' | 'remplace_id'>[]
}

// LA LIGNE, JUGÉE COMME LA BASE LA JUGE (refus 5), dans son ordre : le type ; le poste, son nom, sa longueur, sa nature ;
// le total ; le compte ; une nature hors d'un poste.
function refusDeLaLigne(a: ArgumentsExpliquerVariation): CleRefusExplication | null {
  if (a.p_objet_type === null || !(OBJETS_DE_LA_REVUE as readonly string[]).includes(a.p_objet_type)) return 'objet_inconnu'
  if (a.p_objet_type === 'poste_2035') {
    if (a.p_objet === null || queDesBlancs(a.p_objet)) return 'poste_sans_nom'
    if (caracteres(a.p_objet) > LONGUEUR_MAX_POSTE) return 'poste_trop_long'
    if (a.p_nature === null || !(NATURES_D_UN_POSTE as readonly string[]).includes(a.p_nature)) return 'nature_du_poste'
  } else if (a.p_objet_type === 'total_2035') {
    if (a.p_objet === null || !(TOTAUX_DE_LA_2035 as readonly string[]).includes(a.p_objet)) return 'total_inconnu'
  } else if (a.p_objet === null || !MOTIF_COMPTE_COMPARE.test(a.p_objet)) {
    return 'compte_hors_classes'
  }
  if (a.p_objet_type !== 'poste_2035' && a.p_nature !== null) return 'nature_hors_poste'
  return null
}

/**
 * Ce que `expliquer_variation` refuserait, le premier refus dans son ordre, avec son code et ses mots ; nul quand elle
 * écrirait l'explication. La source se juge comme la base la retient (`sourceDuPrecedent`), le solde d'un compte se
 * compte comme elle le compte (`soldeDuCompteCentimes`), une 2035 validée et un repère se relisent comme elle les relit.
 * Le refus 1 dépend de la session ; aucun autre ne dépend de qui clique.
 */
export function refusDExpliquerVariation(
  a: ArgumentsExpliquerVariation,
  c: ContexteDeLExplication,
): RefusDeLaRevue<CleRefusExplication> | null {
  // 1. L'accès (hypothèse Q2).
  if (!c.accesAuDossier) return refusExplication('acces')
  // 2. et 3. (hypothèse Q11).
  const exercice = refusDeLExercice(a.p_annee, c.anneeCourante)
  if (exercice !== null) {
    const [cle, ...valeurs] = exercice
    return refusExplication(cle, ...valeurs)
  }
  const annee = a.p_annee as number
  // 5. La ligne.
  const ligneFautive = refusDeLaLigne(a)
  if (ligneFautive !== null) return refusExplication(ligneFautive)
  const ligne: CleDeLigne = {
    objet_type: a.p_objet_type as ObjetExplicationRevue, objet: a.p_objet as string, nature: a.p_nature as NatureDUnPoste | null,
  }
  // 6. Les montants au centime ; la source, et un montant précédent avec elle seulement.
  const montant = centimesDuSoldeAnnonce(a.p_montant)
  if (montant === null) return refusExplication('montant_invalide')
  if (a.p_source_precedent === null || !(SOURCES_DU_PRECEDENT as readonly string[]).includes(a.p_source_precedent)) {
    return refusExplication('source_inconnue')
  }
  if (a.p_source_precedent === 'aucune' && a.p_montant_precedent !== null) return refusExplication('precedent_sans_source')
  const precedent = a.p_source_precedent === 'aucune' ? null : centimesDuSoldeAnnonce(a.p_montant_precedent)
  if (a.p_source_precedent !== 'aucune' && precedent === null) return refusExplication('precedent_invalide')
  // 7.
  if (a.p_explication === null || queDesBlancs(a.p_explication)) return refusExplication('explication_vide')
  if (caracteres(a.p_explication) > LONGUEUR_MAX_EXPLICATION) return refusExplication('explication_trop_longue')
  // 8. La source que la base retient pour la ligne.
  const source = sourceDuPrecedent(annee, ligne, c)
  if (a.p_source_precedent !== source) {
    return refusExplication(source === 'validee' ? 'source_validee' : source === 'reference' ? 'source_reference' : 'source_aucune',
      String(annee - 1))
  }
  // 9. Les montants de la base, quand elle sait les lire.
  if (ligne.objet_type === 'compte') {
    const duJour = soldeDuCompteCentimes(ligne.objet, annee, c)
    if (montant !== duJour) return refusExplication('solde_change', ligne.objet, String(annee), coteDuSolde(duJour))
    if (source === 'validee') {
      const valide = soldeDuCompteCentimes(ligne.objet, annee - 1, c)
      if (precedent !== valide) return refusExplication('solde_precedent_change', ligne.objet, String(annee - 1), coteDuSolde(valide))
    }
  } else {
    const valideN = c.exercicesValides.find((v) => v.annee === annee)
    if (valideN !== undefined && valideN.declaration !== null) {
      const lu = centimesDeLa2035Validee(valideN.declaration, ligne)
      if (lu === null) return refusExplication('exercice_illisible', String(annee))
      if (montant !== lu) return refusExplication('exercice_autre_montant', String(annee), montantCommeLaBase(lu))
    }
    if (source === 'validee') {
      const valideN1 = c.exercicesValides.find((v) => v.annee === annee - 1)
      const lu = centimesDeLa2035Validee(valideN1?.declaration ?? null, ligne)
      if (lu === null) return refusExplication('precedent_illisible', String(annee - 1))
      if (precedent !== lu) return refusExplication('precedent_autre_montant', String(annee - 1), montantCommeLaBase(lu))
    } else if (source === 'reference') {
      const lu = centimesDuRepereAnnuel(c.reperes, annee - 1, ligne) as number
      if (precedent !== lu) return refusExplication('repere_autre_montant', String(annee - 1), montantCommeLaBase(lu))
    }
  }
  // 10. On remplace l'explication courante de la ligne, ou rien s'il n'y en a pas.
  const deLaLigne = c.explications.filter((e) => e.annee === annee && memeLigne(e, ligne))
  if (a.p_remplace_id !== null && !deLaLigne.some((e) => minuscules(e.id) === minuscules(a.p_remplace_id as string))) {
    return refusExplication('remplacement_hors_ligne', String(annee))
  }
  const courante = courantParmi(c.explications, deLaLigne)
  if ((a.p_remplace_id === null ? null : minuscules(a.p_remplace_id)) !== (courante === null ? null : minuscules(courante))) {
    return refusExplication('remplacement_perime')
  }
  return null
}

// ── Ce que l'écran envoie ─────────────────────────────────────────────────────────────────────────────────────────

const texteOuNul = (t: string | null) => (t === null || queDesBlancs(t) ? null : t)

/**
 * Les cinq arguments de `fixer_seuil_de_signification`, nuls plutôt qu'absents — supabase-js omettrait une clé
 * `undefined`, et la fonction ne se trouverait pas. Le seuil part en euros, depuis ses centimes : le décimal le plus court
 * qui le relit, deux décimales au plus.
 */
export function argumentsDeFixerSeuil(
  dossierId: string,
  annee: number,
  seuilCentimes: number,
  motif: string,
  remplaceId: string | null,
): ArgumentsFixerSeuil {
  return { p_dossier_id: dossierId, p_annee: annee, p_seuil: seuilCentimes / 100, p_motif: texteOuNul(motif), p_remplace_id: remplaceId }
}

/**
 * Les dix arguments de `expliquer_variation` pour une ligne du tableau, ses montants et sa source tels que l'écran les a
 * montrés — ceux que la base vérifie, quand elle sait les lire. Une explication faite de blancs part NULLE.
 */
export function argumentsDExpliquerVariation(
  dossierId: string,
  annee: number,
  ligne: Pick<LigneDeLaRevue, 'cle' | 'montantCentimes' | 'precedentCentimes' | 'source'>,
  explication: string,
  remplaceId: string | null,
): ArgumentsExpliquerVariation {
  return {
    p_dossier_id: dossierId,
    p_annee: annee,
    p_objet_type: ligne.cle.objet_type,
    p_objet: ligne.cle.objet,
    p_nature: ligne.cle.nature,
    p_montant: ligne.montantCentimes / 100,
    p_montant_precedent: ligne.precedentCentimes === null ? null : ligne.precedentCentimes / 100,
    p_source_precedent: ligne.source,
    p_explication: texteOuNul(explication),
    p_remplace_id: remplaceId,
  }
}

// ── Le tableau, déduit ────────────────────────────────────────────────────────────────────────────────────────────

// L'ÉTAT D'UNE LIGNE (§ 4.5), DÉDUIT et jamais stocké :
//   - `en-attente` : l'exercice n'est pas terminé (hypothèse Q11) — rien ne s'y explique ;
//   - `expliquee` : son explication courante commente les montants et la source du jour ;
//   - `a-revoir` : son explication courante commente d'autres montants, ou une autre source — une écriture, un repère, une
//     2035 ont changé depuis —, ou ses explications ne se relisent pas en chaîne ;
//   - sans explication : `sans-comparaison` (rien de l'exercice précédent ne s'y compare), `sans-seuil` (aucun seuil n'est
//     fixé : rien n'est attendu, hypothèse Q4), `a-expliquer` (la variation dépasse STRICTEMENT le seuil),
//     `sous-le-seuil`.
// Une explication reste « expliquée » sous le seuil, et une explication attendue n'est qu'attendue : l'étape R6 dira si
// elle devient un préalable de la validation (Q1). Aucun état ne dit d'une variation qu'elle est « normale ».
export const ETATS_DE_LA_LIGNE = [
  'en-attente', 'sans-comparaison', 'sans-seuil', 'sous-le-seuil', 'a-expliquer', 'expliquee', 'a-revoir',
] as const
export type EtatDeLaLigne = (typeof ETATS_DE_LA_LIGNE)[number]

export const LIBELLE_DE_L_ETAT_DE_LA_LIGNE: Readonly<Record<EtatDeLaLigne, string>> = {
  'en-attente': 'Exercice en cours',
  'sans-comparaison': 'Sans comparaison',
  'sans-seuil': 'Sans seuil',
  'sous-le-seuil': 'Sous le seuil',
  'a-expliquer': 'À expliquer',
  expliquee: 'Expliquée',
  'a-revoir': 'À revoir',
}

export type CauseARevoir = 'montant-change' | 'precedent-change' | 'source-changee' | 'chaine-illisible'

export interface LigneDeLaRevue {
  cle: CleDeLigne
  // Le nom du poste, le libellé du total, le numéro du compte.
  libelle: string
  // L'exercice, en centimes : une ligne de la 2035 telle qu'elle la porte, le solde d'un compte débit positif.
  montantCentimes: number
  // L'exercice précédent, nul sans comparaison.
  precedentCentimes: number | null
  source: SourcePrecedentRevue
  // L'exercice moins le précédent ; nulle sans comparaison.
  variationCentimes: number | null
  // La variation rapportée à la valeur absolue du précédent, en DIXIÈMES de point, arrondie au plus proche (la moitié
  // s'éloigne de zéro) ; nulle sans comparaison ou sur un précédent nul.
  variationDixiemesDePourcent: number | null
  // Au-delà du seuil, strictement ; nul sans seuil ou sans comparaison.
  auDelaDuSeuil: boolean | null
  etat: EtatDeLaLigne
  causes: CauseARevoir[]
  explications: Chaine<RevisionExplication>
}

/** La variation en dixièmes de point, en entiers exacts : |v| × 1 000 / |p|, arrondi au plus proche, la moitié loin de zéro. */
export function variationEnDixiemes(variationCentimes: number, precedentCentimes: number): number | null {
  if (precedentCentimes === 0) return null
  const v = BigInt(Math.abs(variationCentimes))
  const p = BigInt(Math.abs(precedentCentimes))
  const q = Number((v * 2000n + p) / (p * 2n))
  return variationCentimes < 0 ? -q : q
}

function ligneDeLaRevue(
  cle: CleDeLigne,
  libelle: string,
  montantCentimes: number,
  precedentCentimes: number | null,
  source: SourcePrecedentRevue,
  contexte: { annee: number; exercice: ExerciceDeLaRevue; seuilCentimes: number | null; explications: readonly RevisionExplication[] },
): LigneDeLaRevue {
  const explications = chaineDesExplications(contexte.explications, contexte.annee, cle)
  const variationCentimes = precedentCentimes === null ? null : montantCentimes - precedentCentimes
  const auDelaDuSeuil = variationCentimes === null || contexte.seuilCentimes === null ? null
    : Math.abs(variationCentimes) > contexte.seuilCentimes
  const commun = {
    cle, libelle, montantCentimes, precedentCentimes, source, variationCentimes, auDelaDuSeuil, explications,
    variationDixiemesDePourcent: variationCentimes === null ? null : variationEnDixiemes(variationCentimes, precedentCentimes as number),
  }
  if (contexte.exercice !== 'ouvert') return { ...commun, etat: 'en-attente', causes: [] }
  if (!explications.lisible) return { ...commun, etat: 'a-revoir', causes: ['chaine-illisible'] }
  const courante = explications.courant
  if (courante !== null) {
    const causes: CauseARevoir[] = []
    if (centimesDuNavigateur(Number(courante.montant)) !== montantCentimes) causes.push('montant-change')
    if (courante.source_precedent !== source) causes.push('source-changee')
    else if ((courante.montant_precedent === null ? null : centimesDuNavigateur(Number(courante.montant_precedent))) !== precedentCentimes) {
      causes.push('precedent-change')
    }
    return { ...commun, etat: causes.length === 0 ? 'expliquee' : 'a-revoir', causes }
  }
  if (precedentCentimes === null) return { ...commun, etat: 'sans-comparaison', causes: [] }
  if (contexte.seuilCentimes === null) return { ...commun, etat: 'sans-seuil', causes: [] }
  return { ...commun, etat: auDelaDuSeuil ? 'a-expliquer' : 'sous-le-seuil', causes: [] }
}

/** Le mois d'un exercice, ses recettes, et celles du même mois de l'exercice précédent validé. */
export interface MoisDeRecettes {
  // `AAAA-MM`, dans l'exercice.
  mois: string
  // Crédit moins débit des comptes du cycle des recettes, en centimes.
  centimes: number
  // Le nombre d'écritures de ces comptes dans le mois : zéro, c'est un mois sans recette écrite.
  ecritures: number
  // Le même mois de l'exercice précédent, quand il est validé ; nul sinon.
  precedentCentimes: number | null
  variationCentimes: number | null
}

/** Un mouvement du relevé compté en dépense sans pièce : affecté ou ventilé sur une charge, le relevé pour seule preuve. */
export interface DepenseSansPiece {
  ligneId: string
  date: string
  // Le mouvement, signé comme le relevé.
  montantReleveCentimes: number
  // Ses parts de dépense : le poste et le compte de chacune, ce qu'elle ajoute à son poste.
  parts: { poste: string | null; compte: string | null; centimes: number }[]
  // Ce que le mouvement ajoute aux dépenses de l'exercice : la somme de ses parts.
  totalCentimes: number
  // Au-delà du seuil, strictement ; nul sans seuil.
  auDelaDuSeuil: boolean | null
}

/** Ce que l'écran a lu, EN ENTIER, pour dire la revue analytique d'un exercice. */
export interface DonneesDeLaRevueAnalytique extends EcrituresDuDossier {
  annee: number
  // L'année en cours à Paris.
  anneeCourante: number
  // La 2035 de l'exercice telle que le moteur la calcule (lib/declaration2035.ts) — nulle quand l'écran ne la calcule pas
  // (un dossier tenu en engagement). Une 2035 VALIDÉE de l'exercice l'emporte sur elle : c'est elle qui fait foi.
  declaration: Pick<Declaration2035, 'recettes' | 'depenses' | 'totalRecettes' | 'totalDepenses' | 'resultat'> | null
  exercicesValides: readonly ExercicePourLaRevue[]
  reperes: ReperesAnnuels
  // Ce que le relevé compte sans pièce (lib/partsDuReleve.ts), tous exercices.
  partsDuReleve: readonly PartDuReleve[]
  seuils: readonly RevisionSeuil[]
  explications: readonly RevisionExplication[]
}

export interface RevueAnalytique {
  annee: number
  lectureIncomplete: string | null
  exercice: ExerciceDeLaRevue | null
  seuil: Chaine<RevisionSeuil> & { centimes: number | null }
  la2035: {
    // D'où viennent les montants de l'exercice : sa 2035 validée, la 2035 calculée, ou rien.
    sourceDeLExercice: 'validee' | 'calculee' | 'aucune'
    // L'exercice dont la 2035 validée ne se relit pas : rien de la 2035 ne s'affirme alors.
    illisible: number | null
    lignes: LigneDeLaRevue[]
  }
  comptes: {
    source: Extract<SourcePrecedentRevue, 'validee' | 'aucune'>
    lignes: LigneDeLaRevue[]
    // Les comptes du brouillon qui ne sont pas des classes 1 à 7 : dits, jamais tus.
    horsDeLaRevue: string[]
  }
  recettesParMois: { source: Extract<SourcePrecedentRevue, 'validee' | 'aucune'>; mois: MoisDeRecettes[] }
  depensesSansPiece: DepenseSansPiece[]
  avancement: Record<EtatDeLaLigne, number>
}

const avancementVide = () => Object.fromEntries(ETATS_DE_LA_LIGNE.map((e) => [e, 0])) as Record<EtatDeLaLigne, number>
const parCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

// Les postes et les totaux d'une 2035 calculée, en centimes, comme `lireLa2035Validee` les rend d'une 2035 validée.
function la2035Calculee(d: NonNullable<DonneesDeLaRevueAnalytique['declaration']>): La2035Lue | null {
  const totaux = { recettes: centimesDuNavigateur(d.totalRecettes), depenses: centimesDuNavigateur(d.totalDepenses), resultat: centimesDuNavigateur(d.resultat) }
  if (totaux.recettes === null || totaux.depenses === null || totaux.resultat === null) return null
  const postes = new Map<string, number>()
  for (const l of [...d.recettes, ...d.depenses]) {
    const c = centimesDuNavigateur(l.montant)
    if (c === null) return null
    postes.set(clePoste(l.nature, l.poste), (postes.get(clePoste(l.nature, l.poste)) ?? 0) + c)
  }
  return { totaux: totaux as Record<TotalDeLa2035, number>, postes }
}

/**
 * La revue analytique d'un exercice, telle que l'écran la dira. `lectureIncomplete` : la raison d'une lecture partielle
 * de quoi que ce soit, ou nulle — une lecture partielle n'affirme rien et n'offre aucun geste. Une chaîne de seuils qui
 * ne se relit pas en est une : sans seuil sûr, aucune attente ne se dit.
 */
export function revueAnalytiqueDeLExercice(d: DonneesDeLaRevueAnalytique, lectureIncomplete: string | null): RevueAnalytique {
  const annee = d.annee
  const seuils = chaineDesSeuils(d.seuils, annee)
  const vide: RevueAnalytique = {
    annee, lectureIncomplete, exercice: null, seuil: { ...seuils, centimes: null },
    la2035: { sourceDeLExercice: 'aucune', illisible: null, lignes: [] },
    comptes: { source: 'aucune', lignes: [], horsDeLaRevue: [] }, recettesParMois: { source: 'aucune', mois: [] },
    depensesSansPiece: [], avancement: avancementVide(),
  }
  if (lectureIncomplete !== null) return vide
  if (!seuils.lisible) return { ...vide, lectureIncomplete: `Le seuil de signification de ${annee} ne se relit pas.` }
  const exercice = exerciceDeLaRevue(annee, d.anneeCourante)
  if (exercice === 'invalide') return { ...vide, exercice }
  const seuilCentimes = seuils.courant === null ? null : centimesDuNavigateur(Number(seuils.courant.seuil))
  const contexte = { annee, exercice, seuilCentimes, explications: d.explications }
  const expliquees = d.explications.filter((e) => e.annee === annee)

  // ── La 2035 : l'exercice face au précédent, poste par poste et total par total. La 2035 VALIDÉE de l'exercice fait foi
  // sur celle que le moteur calcule ; celle du précédent ne se recalcule jamais.
  const valideN = d.exercicesValides.find((v) => v.annee === annee)
  const valideN1 = d.exercicesValides.find((v) => v.annee === annee - 1)
  const sourceDeLExercice: RevueAnalytique['la2035']['sourceDeLExercice'] =
    valideN !== undefined && valideN.declaration !== null ? 'validee' : d.declaration !== null ? 'calculee' : 'aucune'
  // Une 2035 validée qui ne se relit pas, ou une 2035 calculée hors des bornes de l'application, ne s'affirme pas.
  const lueN = sourceDeLExercice === 'validee' ? lireLa2035Validee((valideN as ExercicePourLaRevue).declaration)
    : sourceDeLExercice === 'calculee' ? la2035Calculee(d.declaration as NonNullable<DonneesDeLaRevueAnalytique['declaration']>)
      : null
  const precedentDeclare = valideN1 !== undefined && valideN1.declaration !== null
  const lueN1 = precedentDeclare ? lireLa2035Validee((valideN1 as ExercicePourLaRevue).declaration) : null
  let la2035: RevueAnalytique['la2035']
  if (sourceDeLExercice === 'aucune') {
    la2035 = { sourceDeLExercice, illisible: null, lignes: [] }
  } else if (lueN === null) {
    la2035 = { sourceDeLExercice, illisible: annee, lignes: [] }
  } else if (precedentDeclare && lueN1 === null) {
    la2035 = { sourceDeLExercice, illisible: annee - 1, lignes: [] }
  } else {
    const postes = new Map<string, CleDeLigne>()
    const ajouter = (nature: string, poste: string) => {
      if (nature === 'recette' || nature === 'depense') postes.set(clePoste(nature, poste), { objet_type: 'poste_2035', objet: poste, nature })
    }
    for (const cle of lueN.postes.keys()) ajouter(cle.slice(0, cle.indexOf('|')), cle.slice(cle.indexOf('|') + 1))
    if (lueN1 !== null) for (const cle of lueN1.postes.keys()) ajouter(cle.slice(0, cle.indexOf('|')), cle.slice(cle.indexOf('|') + 1))
    else for (const r of d.reperes.postes) if (r.annee === annee - 1 && centimesDuNavigateur(r.montant) !== null) ajouter('depense', r.poste)
    for (const e of expliquees) if (e.objet_type === 'poste_2035' && e.nature !== null) ajouter(e.nature, e.objet)
    const ordonnees = [...postes.values()].sort((a, b) =>
      NATURES_D_UN_POSTE.indexOf(a.nature as NatureDUnPoste) - NATURES_D_UN_POSTE.indexOf(b.nature as NatureDUnPoste)
      || parCodePoint(a.objet, b.objet))
    const lignes = [...ordonnees, ...TOTAUX_DE_LA_2035.map((t): CleDeLigne => ({ objet_type: 'total_2035', objet: t, nature: null }))]
      .map((cle) => {
        const montant = cle.objet_type === 'total_2035' ? lueN.totaux[cle.objet as TotalDeLa2035]
          : lueN.postes.get(clePoste(cle.nature as string, cle.objet)) ?? 0
        const source = sourceDuPrecedent(annee, cle, d)
        const precedent = source === 'validee' ? centimesDeLa2035Validee(valideN1?.declaration ?? null, cle)
          : source === 'reference' ? centimesDuRepereAnnuel(d.reperes, annee - 1, cle) : null
        const libelle = cle.objet_type === 'total_2035' ? LIBELLE_DU_TOTAL[cle.objet as TotalDeLa2035] : cle.objet
        return ligneDeLaRevue(cle, libelle, montant, precedent, source, contexte)
      })
    la2035 = { sourceDeLExercice, illisible: null, lignes }
  }

  // ── Les comptes : le solde de l'exercice face à celui du précédent validé, jamais recalculé d'un exercice ouvert.
  const precedentValide = valideN1 !== undefined
  const soldesN = soldesDeLExercice(annee, d)
  const soldesN1 = precedentValide ? soldesDeLExercice(annee - 1, d) : new Map<string, number>()
  const comptesVus = new Set<string>()
  for (const [compte, c] of soldesN) if (c !== 0) comptesVus.add(compte)
  for (const [compte, c] of soldesN1) if (c !== 0) comptesVus.add(compte)
  for (const e of expliquees) if (e.objet_type === 'compte') comptesVus.add(e.objet)
  const horsDeLaRevue = [...comptesVus].filter((c) => !MOTIF_COMPTE_COMPARE.test(c)).sort(parCodePoint)
  const lignesDesComptes = [...comptesVus].filter((c) => MOTIF_COMPTE_COMPARE.test(c)).sort(parCodePoint).map((compte) => {
    const cle: CleDeLigne = { objet_type: 'compte', objet: compte, nature: null }
    return ligneDeLaRevue(cle, compte, soldesN.get(compte) ?? 0, precedentValide ? soldesN1.get(compte) ?? 0 : null,
      precedentValide ? 'validee' : 'aucune', contexte)
  })

  // ── Les recettes mois par mois : les écritures des comptes du cycle des recettes, crédit moins débit.
  const recettesDuMois = (an: number) => {
    const parMois = Array.from({ length: 12 }, () => ({ centimes: 0, ecritures: 0 }))
    for (const e of d.ecritures) {
      if (!e.date.startsWith(`${an}-`) || cycleDuCompte(e.compte) !== 'recettes') continue
      const m = parMois[Number(e.date.slice(5, 7)) - 1]
      if (m === undefined) continue
      m.centimes += (e.sens === 'credit' ? 1 : -1) * Math.round(e.montant * 100)
      m.ecritures++
    }
    return parMois
  }
  const moisN = recettesDuMois(annee)
  const moisN1 = precedentValide ? recettesDuMois(annee - 1) : null
  const mois: MoisDeRecettes[] = moisN.map((m, i) => {
    const precedentCentimes = moisN1 === null ? null : moisN1[i].centimes + 0
    return {
      mois: `${annee}-${String(i + 1).padStart(2, '0')}`, centimes: m.centimes + 0, ecritures: m.ecritures, precedentCentimes,
      variationCentimes: precedentCentimes === null ? null : m.centimes - precedentCentimes + 0,
    }
  })

  // ── Les dépenses affectées sans pièce : un mouvement de l'exercice, ses parts de dépense affectées ou ventilées.
  const parMouvement = new Map<string, DepenseSansPiece>()
  for (const p of d.partsDuReleve) {
    if (p.nature !== 'depense' || (p.origine !== 'affectation' && p.origine !== 'ventilation')) continue
    if (!p.ligne.date.startsWith(`${annee}-`)) continue
    const centimes = Math.round(p.montantPoste * 100) + 0
    const deja = parMouvement.get(p.ligne.id)
    if (deja === undefined) {
      parMouvement.set(p.ligne.id, {
        ligneId: p.ligne.id, date: p.ligne.date, montantReleveCentimes: Math.round(p.ligne.montant * 100) + 0,
        parts: [{ poste: p.poste, compte: p.compte, centimes }], totalCentimes: centimes, auDelaDuSeuil: null,
      })
    } else {
      deja.parts.push({ poste: p.poste, compte: p.compte, centimes })
      deja.totalCentimes += centimes
    }
  }
  const depensesSansPiece = [...parMouvement.values()]
    .map((x) => ({ ...x, auDelaDuSeuil: seuilCentimes === null ? null : Math.abs(x.totalCentimes) > seuilCentimes }))
    .sort((a, b) => Math.abs(b.totalCentimes) - Math.abs(a.totalCentimes) || parCodePoint(a.date, b.date) || parCodePoint(a.ligneId, b.ligneId))

  const avancement = avancementVide()
  for (const l of [...la2035.lignes, ...lignesDesComptes]) avancement[l.etat]++
  return {
    annee, lectureIncomplete: null, exercice, seuil: { ...seuils, centimes: seuilCentimes }, la2035,
    comptes: { source: precedentValide ? 'validee' : 'aucune', lignes: lignesDesComptes, horsDeLaRevue },
    recettesParMois: { source: precedentValide ? 'validee' : 'aucune', mois },
    depensesSansPiece, avancement,
  }
}
