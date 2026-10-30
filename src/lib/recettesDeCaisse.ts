import { natureDuCompte, type NatureCompte } from './affectationBanque'
import { libelleDeLOperation } from './caisse'
import type { LectureDeLaCaisse } from './caisseLecture'
import { horsTaxeEtTva, tauxApplicable } from './tvaDuReleve'
import type { Categorie, OperationCaisse } from './types'

// LES RECETTES DE CAISSE, TELLES QUE LES MOTEURS LES COMPTENT (ligne 26.6, étape C3a ; MVP-D2). La conception : HISTORIQUE.md,
// « LA CAISSE D'UN DOSSIER BNC : LA CONCEPTION — MVP-D2 (LIGNE 26.6) », § 3 (« la caisse lue ») et § 5 (« la forme des
// moteurs ») ; le module de la caisse, lib/caisse.ts (C2), et sa lecture, lib/caisseLecture.ts.
//
// UNE FORME À PART, ET NON UN ÉLARGISSEMENT DE `PartDuReleve` (lib/partsDuReleve.ts) : la `ligne` d'une part est un
// MOUVEMENT, et chacun de ses usages — la contrepartie, les lots, l'alignement, la fiche d'un mouvement, la concordance par
// `ligne_bancaire_id` — devrait apprendre une recette qui n'en a pas. Ici, une recette de caisse n'est que ce que les moteurs
// en comptent : sa date, sa catégorie (son poste, sa nature, son compte), son taux, ses montants en centimes.
//
// LE PARAMÈTRE EST OBLIGATOIRE dans chaque moteur qui compte une recette — la 2035 et sa concordance, la CA3, la situation
// intermédiaire, l'estimation et le plan de trésorerie de Financement, la revue analytique —, sans valeur par défaut, comme
// les ventes facturées (VF3) : un appelant qui l'oublierait rendrait une 2035 sans les recettes en espèces d'un praticien,
// plausible et signée, et c'est au compilateur de le dire.
//
// TROIS ÉTATS, ET LE TROISIÈME N'ENTRE DANS AUCUN MOTEUR.
//   - ABSENTE : le drapeau de la caisse est baissé (`CAISSE_EXPORTEE`, lib/caisse.ts) — la table n'existe pas en base. Il n'y
//     a rien à compter et rien à dire : chaque moteur rend, au caractère près, ce qu'il rendait avant la caisse. Ce n'est
//     PAS une caisse lue en partie, qui retiendrait la 2035 de tout dossier tant que les migrations attendent.
//   - LUE : les opérations du dossier lues EN ENTIER ; les recettes vivantes, résolues sur les catégories lues.
//   - INCOMPLÈTE (ou pas encore revenue) : l'écran ne calcule ni 2035, ni CA3, ni chiffre qui en dépende, le dit
//     (`BandeauLecturePartielle`) et ne commande aucune écriture. Le type des moteurs ne l'admet pas : c'est l'écran qui le
//     tranche, avant l'appel (`EtatDesRecettesDeCaisse`).
//
// CE QUI EST UNE RECETTE (conception, § 3 et § 5) : une opération de genre `recette`, ni retirée ni remplacée. L'apport, le
// prélèvement de l'exploitant et le versement en banque (un mouvement classé sur le compte de la caisse) ne sont ni des
// recettes ni des dépenses : ils n'entrent ni dans la 2035 ni dans la CA3. Le paiement d'une pièce par la caisse (le genre
// `paiement`, CAISSE-Q4) date la PIÈCE, comme un mouvement : il n'est pas une recette et n'entre pas ici — l'étape C9 l'ajoute
// aux paiements des pièces (`paiementsDesPieces`).
//
// PUR : aucun appel au réseau ; la lecture n'est importée que pour son type.

/** Une recette de caisse, telle que les moteurs la comptent. Montants en CENTIMES, signés comme les espèces. */
export interface RecetteDeCaisse {
  /** L'opération de caisse : c'est elle que l'écriture désigne (`ecritures_brouillon.operation_caisse_id`). */
  operationId: string
  /** Le jour où les espèces ont été reçues (ou rendues) : la date à laquelle la recette compte (CGI, art. 93, 1). */
  date: string
  categorieId: string | null
  /** Le libellé de la catégorie, pour les listes et le libellé composé de l'écriture ; nul quand elle n'est pas lue. */
  libelleCategorie: string | null
  /** Le poste de la 2035 de la catégorie ; nul quand elle n'en porte pas, ou n'est pas lue. */
  poste: string | null
  /** La nature du compte de la catégorie : une recette de caisse est un produit. Nulle quand son compte n'est plus un compte de
   *  résultat, ou que la catégorie n'est pas lue ; une charge est dite telle (une catégorie changée depuis la saisie). */
  nature: NatureCompte | null
  /** Le compte de la catégorie : celui où l'écriture de l'opération porte la recette, que la concordance y retrouve. */
  compte: string | null
  /** Le taux qui s'applique aujourd'hui (`tauxApplicable`, la règle du relevé) : celui de l'opération sur un dossier
   *  assujetti, rien ailleurs. Nul sur un dossier assujetti quand l'opération n'en porte pas (saisie avant l'assujettissement). */
  taux: number | null
  /** Les espèces, signées : négatives pour des espèces rendues. */
  centimes: number
  /** Ce que la recette ajoute à son poste — le hors taxe sur un dossier assujetti, le total sinon —, signé comme les espèces. */
  htCentimes: number
  /** La TVA comprise, signée comme les espèces ; nulle sans taux. */
  tvaCentimes: number
}

/** Ce qu'un moteur reçoit : la caisse absente (le drapeau baissé), ou ses recettes lues en entier. */
export type RecettesDeCaisse =
  | { etat: 'absente' }
  | { etat: 'lue'; dossierId: string; recettes: readonly RecetteDeCaisse[] }

/** La caisse absente : la table n'est pas en base, rien n'est compté ni dit. */
export const CAISSE_ABSENTE: RecettesDeCaisse = { etat: 'absente' }

/** Ce que l'écran tient : la forme d'un moteur, ou ce qui l'empêche — pas encore revenue, ou lue en partie. */
export type EtatDesRecettesDeCaisse =
  | RecettesDeCaisse
  | { etat: 'en_attente' }
  | { etat: 'incomplete'; motif: string }

/** Les recettes de caisse d'une forme : aucune quand la caisse est absente. */
export function recettesDe(caisse: RecettesDeCaisse): readonly RecetteDeCaisse[] {
  return caisse.etat === 'lue' ? caisse.recettes : []
}

/**
 * Les opérations VIVANTES de genre recette : ni retirées (`retire_le`), ni remplacées — la base retire celle qu'elle
 * remplace, et une opération qu'une autre désigne par `remplace_id` est écartée aussi, défensivement, plutôt que de compter
 * deux fois la même recette.
 */
export function recettesVivantes<O extends Pick<OperationCaisse, 'id' | 'genre' | 'retire_le' | 'remplace_id'>>(
  operations: readonly O[],
): O[] {
  const remplacees = new Set(operations.flatMap((o) => (o.remplace_id ? [o.remplace_id] : [])))
  return operations.filter((o) => o.genre === 'recette' && o.retire_le == null && !remplacees.has(o.id))
}

/**
 * Une opération de recette, résolue sur les catégories lues, au statut de TVA d'aujourd'hui — la règle d'une recette du
 * relevé (`mouvementsAffectes`, lib/affectationBanque.ts) : le taux ne s'applique qu'à une recette d'un dossier assujetti, et
 * le hors taxe se calcule en centimes entiers par `horsTaxeEtTva` — le calcul même par lequel la base RECOMPOSE l'écriture
 * de l'opération (`tva_incluse`, lib/caisse.ts) : la 2035, la CA3 et le brouillon disent le même montant.
 */
export function recetteDeCaisse(
  operation: Pick<OperationCaisse, 'id' | 'date' | 'montant' | 'categorie_id' | 'taux_tva'>,
  categories: readonly Categorie[],
  assujettiTva: boolean,
): RecetteDeCaisse {
  const categorie = operation.categorie_id ? categories.find((c) => c.id === operation.categorie_id) ?? null : null
  const nature = categorie ? natureDuCompte(categorie.compte_comptable) : null
  const taux = nature === 'recette' ? tauxApplicable(assujettiTva, nature, operation.taux_tva) : null
  const { ht, tva } = horsTaxeEtTva(operation.montant, taux)
  const signe = operation.montant < 0 ? -1 : 1
  return {
    operationId: operation.id,
    date: operation.date,
    categorieId: operation.categorie_id,
    libelleCategorie: categorie?.libelle ?? null,
    poste: categorie?.poste_2035 || null,
    nature,
    compte: categorie?.compte_comptable ?? null,
    taux,
    centimes: Math.round(operation.montant * 100),
    htCentimes: signe * Math.round(ht * 100),
    tvaCentimes: signe * Math.round(tva * 100),
  }
}

/**
 * Ce que l'écran tient de la caisse de CE dossier : pas encore revenue (ou celle d'un dossier quitté — `DossierDetail` reste
 * monté d'un dossier à l'autre), absente, lue en partie, ou lue en entier et résolue. `categories` : celles que l'écran a
 * lues, du dossier et communes ; `assujettiTva` : le statut d'aujourd'hui, comme pour le relevé.
 */
export function recettesDeCaisseDuDossier(
  lecture: LectureDeLaCaisse | null,
  dossierId: string,
  categories: readonly Categorie[],
  assujettiTva: boolean,
): EtatDesRecettesDeCaisse {
  if (lecture === null || lecture.dossierId !== dossierId) return { etat: 'en_attente' }
  if (!lecture.enBase) return CAISSE_ABSENTE
  if (!lecture.complete) return { etat: 'incomplete', motif: lecture.motif ?? 'la lecture de la caisse est incomplète' }
  return {
    etat: 'lue',
    dossierId,
    recettes: recettesVivantes(lecture.lignes).map((o) => recetteDeCaisse(o, categories, assujettiTva)),
  }
}

/** La forme d'un moteur, ou nulle quand l'écran ne doit rien calculer (pas encore revenue, lue en partie). */
export function recettesPourLesMoteurs(etat: EtatDesRecettesDeCaisse): RecettesDeCaisse | null {
  return etat.etat === 'absente' || etat.etat === 'lue' ? etat : null
}

/** Le motif d'une caisse lue en partie, que l'écran dit ; nul sinon (une caisse absente ne se dit pas). */
export function motifDeLaCaisse(etat: EtatDesRecettesDeCaisse): string | null {
  return etat.etat === 'incomplete' ? etat.motif : null
}

/** Le libellé d'une recette, celui que la base compose pour son écriture : « Recettes en espèces du 12/03/2026 — … ». */
export function libelleDeLaRecette(r: Pick<RecetteDeCaisse, 'date' | 'centimes' | 'libelleCategorie'>): string {
  return libelleDeLOperation({
    genre: 'recette', date: r.date, montant: r.centimes / 100,
    categorie: { libelle: r.libelleCategorie ?? 'catégorie inconnue', compte_comptable: null },
  })
}

// ── L'estimation et la simulation du client ──────────────────────────────────────────────────────────────────────────

/**
 * Ce que l'estimation reçoit : la forme des moteurs, ou « non comptées » — l'état que « Ma simulation » d'un client passe,
 * le drapeau levé : sa session ne lit pas la caisse (CAISSE-Q1 ; sa lecture viendra avec son droit, une migration présentée
 * au cabinet), et son écran le DIT. L'Estimation du cabinet ne le passe jamais. Pas une valeur par défaut, comme
 * `RECETTES_FACTUREES_NON_COMPTEES` (lib/estimation.ts).
 */
export type RecettesDeCaissePourLEstimation = RecettesDeCaisse | { etat: 'non_comptees' }

export const RECETTES_DE_CAISSE_NON_COMPTEES: RecettesDeCaissePourLEstimation = { etat: 'non_comptees' }

/** Ce que la simulation du client passe à l'estimation, selon que la caisse est en base : absente, ou non comptée. */
export function recettesDeCaisseDuClient(caisseEnBase: boolean): RecettesDeCaissePourLEstimation {
  return caisseEnBase ? RECETTES_DE_CAISSE_NON_COMPTEES : CAISSE_ABSENTE
}

/**
 * Ce que « Ma simulation » dit qu'elle ne compte pas, le drapeau levé. Au tutoiement de l'espace client, sans nommer d'onglet
 * (`MOTS_DU_CABINET`) : sa caisse est tenue par son cabinet.
 */
export const SIMULATION_SANS_CAISSE = 'Cette simulation ne compte pas tes recettes en espèces : ta caisse est tenue par ton '
  + 'cabinet, et ta session ne la lit pas.'

/**
 * La simulation le dit-elle ? Quand elle ne compte pas la caisse et que le dossier pourrait en tenir une : en trésorerie
 * seulement — la base refuse une caisse à un dossier en engagement (`enregistrer_operation_caisse`, le premier refus après
 * l'accès). La caisse absente (le drapeau baissé) ne se dit jamais : rien ne change.
 */
export function simulationDitNePasCompterLaCaisse(caisse: RecettesDeCaissePourLEstimation, mode: 'tresorerie' | 'engagement'): boolean {
  return caisse.etat === 'non_comptees' && mode === 'tresorerie'
}

/**
 * Les recettes de caisse d'une période (des dates civiles, bornes comprises) que l'estimation compte, en CENTIMES : toute
 * recette dont la catégorie est un produit, quel que soit son poste — comme une recette du relevé
 * (`recettesAffecteesDansLaPeriode`). Rien pour une caisse absente ou non comptée.
 */
export function centimesDesRecettesDeCaisse(caisse: RecettesDeCaissePourLEstimation, debut: string, fin: string): number {
  if (caisse.etat !== 'lue') return 0
  return caisse.recettes
    .filter((r) => r.nature === 'recette' && r.date >= debut && r.date <= fin)
    .reduce((s, r) => s + r.htCentimes, 0)
}

// ── Le plan de trésorerie de Financement ─────────────────────────────────────────────────────────────────────────────

/**
 * Les recettes de caisse comme des ENCAISSEMENTS du rythme d'activité (lib/planTresorerie.ts, `LigneBanquePourPlan`) : les
 * espèces reçues, à leur date et pour leur total — le sens d'un débit de la banque, celui d'un encaissement ; des espèces
 * rendues, un décaissement. Sans quoi les recettes en espèces d'un praticien sortiraient de la moyenne des encaissements, et
 * le taux d'endettement que Financement montre à une banque se calculerait sur la seule banque. Le versement d'espèces, lui,
 * est un mouvement classé sur un compte de bilan, que la moyenne écarte déjà (ligne 26.7) : la même somme n'y entre pas deux
 * fois. Les espèces de toute recette vivante, quelle que soit sa catégorie : c'est un rythme d'argent reçu, pas un poste.
 */
export function lignesDeLaCaissePourLePlan(caisse: RecettesDeCaisse): { date: string; sens: 'debit' | 'credit'; montant: number }[] {
  return recettesDe(caisse)
    .filter((r) => r.centimes !== 0)
    .map((r) => ({ date: r.date, sens: r.centimes > 0 ? 'debit' as const : 'credit' as const, montant: Math.abs(r.centimes) / 100 }))
}
