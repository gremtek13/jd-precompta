import { RACINES_DES_CHARGES_A_PAYER, RACINES_DES_FNP_HORS_ROLE, RACINES_DES_PRODUITS_A_RECEVOIR, RACINES_HORS_DE_L_INVENTAIRE, ROLES_D_INVENTAIRE } from './inventaire'
import {
  ciblePrecedente, extourneEntiere, regularisationAJour,
  type DeclarationDeLaValidation, type InventaireDeLaValidation, type OperationDeLaValidation, type ProvisionDeLaValidation,
} from './inventaireDeLaValidation'
import type { CycleRevision } from './revisionCycles'
import type { DossierTab } from './ongletsDossier'
import type { EcritureBrouillon, ModeComptable } from './types'

// L'INVENTAIRE DANS LES CONTRÔLES DU CABINET (ligne 35, INV6 ; docs/conceptions/35-inventaire.md, § 5.2, 5.5 et 5.7) : le
// bilan, la Vue d'ensemble, la Clôture et la révision lisent l'inventaire de l'exercice, que l'onglet Inventaire (INV5)
// saisit. Un module PUR : il ne lit rien en base et ne lit pas l'horloge.
//
// DERRIÈRE `INVENTAIRE_EXPORTE` (lib/inventaire.ts) : baissé, la lecture des contrôles (`lireLInventaireDesControles`,
// lib/inventaireLecture.ts) ne lit rien et rend l'inventaire SANS OBJET — le bilan, la Vue d'ensemble, la Clôture et la
// révision sont ceux d'hier, au caractère près. En TRÉSORERIE aussi : rien ne s'y écrit (§ 3.6), et rien ne s'en dit.

/** Une régularisation lue pour les contrôles : celle de la validation, et la pièce qui la fonde (INV5-Q1), que la révision
 *  propose à la citation. */
export type OperationDesControles = OperationDeLaValidation & { piece_citee_id: string | null }

/**
 * L'INVENTAIRE TEL QUE LES CONTRÔLES LE REÇOIVENT, sans valeur par défaut : sans objet (le drapeau baissé, ou un dossier en
 * trésorerie), ou lu EN ENTIER. Une lecture partielle ne se passe jamais ici : l'appelant la dit et se tait (le bilan ne
 * s'établit pas, la Vue d'ensemble se signale partielle, la révision n'affirme rien).
 */
export type InventaireDesControles =
  | { etat: 'sans_objet' }
  | {
    etat: 'lu'
    operations: readonly OperationDesControles[]
    declarations: readonly DeclarationDeLaValidation[]
    provisions: readonly ProvisionDeLaValidation[]
  }

export const INVENTAIRE_DES_CONTROLES_SANS_OBJET: InventaireDesControles = { etat: 'sans_objet' }

/** L'inventaire lu, pour les contrôles d'un dossier de ce mode : sans objet en trésorerie, où rien ne s'écrit (§ 3.6). */
export function inventaireDesControles(
  inventaire: { etat: 'sans_objet' } | Extract<InventaireDesControles, { etat: 'lu' }>,
  mode: ModeComptable,
): InventaireDesControles {
  return inventaire.etat === 'lu' && mode === 'engagement' ? inventaire : INVENTAIRE_DES_CONTROLES_SANS_OBJET
}

/** Ce que la validation en reçoit (lib/prealablesValidation.ts) : la même lecture, sans la pièce citée. */
export function inventairePourLaValidation(inventaire: InventaireDesControles): InventaireDeLaValidation {
  return inventaire.etat === 'sans_objet' ? { etat: 'sans_objet' } : inventaire
}

/** La déclaration en vigueur de l'inventaire d'un exercice, ou nulle. */
export function declarationDeLExercice(
  inventaire: Extract<InventaireDesControles, { etat: 'lu' }>, exercice: number,
): DeclarationDeLaValidation | null {
  return inventaire.declarations.find((d) => d.exercice === exercice && d.retire_le === null) ?? null
}

// ── Les comptes que l'inventaire range ────────────────────────────────────────────────────────────────────────────────────

const sousLaRacine = (compte: string, racines: readonly string[]) => racines.some((r) => compte.startsWith(r))

// LES COMPTES QUE L'INVENTAIRE ÉCRIT (§ 4.4) : ceux des douze rôles hors des dotations et des reprises (486, 487, 408, 418,
// 44586, 44587, 151, 491), les charges à payer et produits à recevoir rattachés, la facture non parvenue des intérêts courus
// (4088). Jamais le 4084 (INV1-Q1). Un compte d'inventaire que le bilan signale et qui n'en est pas — les stocks (ligne 36),
// les dépréciations d'autres actifs (29, 39, 59, les 49 hors du 491), les numéros d'avant 2026 — se revoit à part : la
// déclaration de l'inventaire ne le couvre pas.
export const RACINES_ECRITES_PAR_L_INVENTAIRE: readonly string[] = [
  ...ROLES_D_INVENTAIRE.filter((r) => !/^(dotations|reprises)_/.test(r.role)).flatMap((r) => r.racines),
  ...RACINES_DES_CHARGES_A_PAYER, ...RACINES_DES_PRODUITS_A_RECEVOIR, ...RACINES_DES_FNP_HORS_ROLE,
]

/** Le compte est-il de ceux que l'inventaire écrit ? */
export function compteEcritParLInventaire(compte: string): boolean {
  return sousLaRacine(compte, RACINES_ECRITES_PAR_L_INVENTAIRE) && !sousLaRacine(compte, RACINES_HORS_DE_L_INVENTAIRE)
}

// LES COMPTES QUE LA PREUVE DE L'INVENTAIRE JUSTIFIE (§ 5.5, R3) : 486, 487, 408 (hors du 4084), 418, 151 et 491 — ceux dont
// le solde au 31 décembre EST l'inventaire : les constatations de l'exercice, ou l'évaluation en vigueur des provisions. Les
// charges à payer rattachées (4282, 4386…) mêlent l'inventaire aux écritures de l'exercice : elles ne se prouvent pas ici.
export const RACINES_PROUVEES_PAR_L_INVENTAIRE: readonly string[] = ROLES_D_INVENTAIRE
  .filter((r) => ['charges_constatees_avance', 'produits_constates_avance', 'factures_non_parvenues', 'factures_a_etablir',
    'provisions_risques', 'depreciation_clients'].includes(r.role))
  .flatMap((r) => r.racines)

/** La preuve de l'inventaire vaut-elle pour ce compte ? */
export function compteProuveParLInventaire(compte: string): boolean {
  return sousLaRacine(compte, RACINES_PROUVEES_PAR_L_INVENTAIRE) && !sousLaRacine(compte, RACINES_HORS_DE_L_INVENTAIRE)
}

// ── Ce que l'inventaire attend d'un compte au 31 décembre (la preuve R3) ──────────────────────────────────────────────────

type LigneDuBrouillon = Pick<EcritureBrouillon, 'date' | 'compte' | 'sens' | 'montant' | 'operation_inventaire_id'>
const centimes = (montant: number) => Math.round(montant * 100)

/** Une provision du compte : sa cible en vigueur au 31 décembre de l'exercice, en centimes (au crédit). */
export interface CibleDeProvision {
  provisionId: string
  cibleCentimes: number
  /** L'évaluation qui la fixe, ou nulle quand c'est la part reprise d'une balance (INV-Q11). */
  operationId: string | null
}

export interface AttenduDeLInventaire {
  /** Le solde que l'inventaire attend, débit positif, en centimes. */
  attenduCentimes: number
  /** Les régularisations de l'exercice qui écrivent ce compte au 31 décembre, dans l'ordre de leur identifiant. */
  regularisations: readonly OperationDesControles[]
  /** Pour un compte de provision, la cible de chacune de ses provisions. */
  provisions: readonly CibleDeProvision[]
  /** Les régularisations de l'exercice sur ce compte dont les écritures ne sont plus à jour. */
  aRecomposer: number
}

const parIdentifiant = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * Ce que l'inventaire de l'exercice attend du solde d'un compte qu'il prouve. Un compte de provision (151, 491) : la cible
 * en vigueur de chaque provision du compte — la dernière évaluation jusqu'à cet exercice, sinon sa part reprise —, au crédit.
 * Un compte de régularisation (486, 487, 408, 418) : les lignes du 31 décembre que les régularisations de l'exercice y
 * écrivent, l'ouverture étant extournée au 1er janvier. Les montants sont ceux que le cabinet a saisis, jamais devinés.
 */
export function attenduDeLInventaire(
  compte: string,
  annee: number,
  inventaire: Extract<InventaireDesControles, { etat: 'lu' }>,
  brouillon: readonly LigneDuBrouillon[],
): AttenduDeLInventaire {
  const { operations, provisions } = inventaire
  const aJour = (o: OperationDesControles) => regularisationAJour(o, brouillon, ciblePrecedente(o, operations, provisions))
  const sesProvisions = provisions.filter((p) => p.compte_provision === compte)
  if (sesProvisions.length > 0 || operations.some((o) => o.nature === 'provision' && o.compte_regularisation === compte)) {
    const cibles: CibleDeProvision[] = [...sesProvisions].sort(parIdentifiant).map((p) => {
      const derniere = operations
        .filter((o) => o.provision_id === p.id && o.exercice <= annee)
        .reduce<OperationDesControles | null>((r, o) => (r === null || o.exercice > r.exercice ? o : r), null)
      return derniere === null
        ? { provisionId: p.id, cibleCentimes: p.reprise_centimes ?? 0, operationId: null }
        : { provisionId: p.id, cibleCentimes: derniere.montant_centimes, operationId: derniere.id }
    })
    const evaluations = operations.filter((o) => o.nature === 'provision' && o.exercice === annee && o.compte_regularisation === compte)
    return {
      attenduCentimes: -cibles.reduce((s, c) => s + c.cibleCentimes, 0),
      regularisations: [...evaluations].sort(parIdentifiant),
      provisions: cibles,
      aRecomposer: evaluations.filter((o) => !aJour(o)).length,
    }
  }
  const ids = new Set(operations.filter((o) => o.exercice === annee && !o.reprise).map((o) => o.id))
  const lignes = brouillon.filter((l) => l.compte === compte && l.date === `${annee}-12-31`
    && ids.has(l.operation_inventaire_id ?? ''))
  const regularisations = operations.filter((o) => o.exercice === annee && !o.reprise && o.nature !== 'provision'
    && o.compte_regularisation === compte).sort(parIdentifiant)
  return {
    attenduCentimes: lignes.reduce((s, l) => s + (l.sens === 'debit' ? 1 : -1) * centimes(l.montant), 0),
    regularisations,
    provisions: [],
    aRecomposer: regularisations.filter((o) => !aJour(o)).length,
  }
}

// ── La Vue d'ensemble (les points de la Checklist) ───────────────────────────────────────────────────────────────────────

export interface EntreesDesPointsDeLInventaire {
  inventaire: InventaireDesControles
  brouillon: readonly LigneDuBrouillon[]
  anneesValidees: readonly number[]
  /** L'année en cours à Paris : un exercice est clos quand son 31 décembre est passé. */
  anneeCourante: number
  /** Le premier exercice du dossier (l'année de sa reprise, sinon de sa première écriture), ou nul quand rien ne l'ouvre. */
  premierExercice: number | null
}

export interface PointsDeLInventaire {
  /** Les exercices clos et non validés dont l'inventaire n'est pas déclaré, du plus ancien au plus récent. */
  aDeclarer: number[]
  /** Les régularisations d'un exercice non validé dont les écritures ne sont plus celles qu'elles commandent. */
  aRecomposer: { exercice: number; id: string }[]
  /** Les régularisations d'un exercice validé dont l'extourne du 1er janvier suivant, encore au brouillon, n'est pas entière. */
  extournesAReprendre: { exercice: number; id: string }[]
}

export const AUCUN_POINT_DE_L_INVENTAIRE: PointsDeLInventaire = { aDeclarer: [], aRecomposer: [], extournesAReprendre: [] }

/**
 * Ce que la Vue d'ensemble dit de l'inventaire, en ATTENTION : la validation le retient déjà, sous ses mots
 * (lib/inventaireDeLaValidation.ts, `prealablesDeLInventaire`) ; ici il se voit avant, pour TOUS les exercices qui ne sont pas
 * figés. Rien quand l'inventaire est sans objet. L'onglet Inventaire, où chaque point renvoie, MONTRE ce qu'il compte : la
 * déclaration de l'exercice affiché, et chaque régularisation « à jour » ou « à recomposer » par le même juge.
 */
export function pointsDeLInventaire(e: EntreesDesPointsDeLInventaire): PointsDeLInventaire {
  if (e.inventaire.etat === 'sans_objet') return AUCUN_POINT_DE_L_INVENTAIRE
  const inventaire = e.inventaire
  const { operations, provisions } = inventaire
  const validees = new Set(e.anneesValidees)
  const derniereValidee = e.anneesValidees.length > 0 ? Math.max(...e.anneesValidees) : null
  const aDeclarer: number[] = []
  if (e.premierExercice !== null) {
    const depuis = derniereValidee === null ? e.premierExercice : Math.max(e.premierExercice, derniereValidee + 1)
    for (let exercice = depuis; exercice < e.anneeCourante; exercice++) {
      if (!validees.has(exercice) && declarationDeLExercice(inventaire, exercice) === null) aDeclarer.push(exercice)
    }
  }
  const tri = (a: { exercice: number; id: string }, b: { exercice: number; id: string }) => a.exercice - b.exercice || parIdentifiant(a, b)
  // Une régularisation reprise (INV3-Q2) s'écrit au 1er janvier de l'exercice que la balance ouvre : elle n'est figée qu'avec lui.
  const figee = (o: OperationDesControles) => validees.has(o.reprise ? o.exercice + 1 : o.exercice)
  const aRecomposer = operations
    .filter((o) => !figee(o) && !regularisationAJour(o, e.brouillon, ciblePrecedente(o, operations, provisions)))
    .map((o) => ({ exercice: o.exercice, id: o.id })).sort(tri)
  const extournesAReprendre = operations
    .filter((o) => !o.reprise && o.nature !== 'provision' && validees.has(o.exercice) && !validees.has(o.exercice + 1)
      && !extourneEntiere(o, e.brouillon))
    .map((o) => ({ exercice: o.exercice, id: o.id })).sort(tri)
  return { aDeclarer, aRecomposer, extournesAReprendre }
}

/** Les exercices d'une liste, en mots : « 2025 », « 2024 et 2025 », « 2023, 2024 et 2025 ». */
export function exercicesEnMots(exercices: readonly number[]): string {
  const uniques = [...new Set(exercices)].sort((a, b) => a - b).map(String)
  return uniques.length <= 1 ? uniques.join('') : `${uniques.slice(0, -1).join(', ')} et ${uniques[uniques.length - 1]}`
}

/** Le premier exercice du dossier, tel que la Vue d'ensemble le lit : l'année de sa reprise, sinon de sa première écriture. */
export function premierExerciceDuDossier(
  aNouveaux: readonly { date: string }[], brouillon: readonly { date: string }[],
): number | null {
  const dates = aNouveaux.length > 0 ? aNouveaux.map((a) => a.date) : brouillon.map((e) => e.date)
  if (dates.length === 0) return null
  return Number(dates.reduce((min, d) => (d < min ? d : min)).slice(0, 4))
}

// ── La Clôture et la validation ──────────────────────────────────────────────────────────────────────────────────────────

/** L'onglet où mènent les préalables de l'inventaire : l'onglet Inventaire quand il est offert, sinon les écritures (INV3). */
export function cibleDesPrealablesDeLInventaire(exporte: boolean): DossierTab {
  return exporte ? 'inventaire' : 'ecritures'
}

/** La carte « Inventaire » de la Clôture, pour un exercice : ce qu'elle dit, et si elle appelle un geste. */
export interface CarteDeLInventaire {
  titre: string
  phrase: string
  /** Vrai quand quelque chose reste à faire dans l'onglet Inventaire : la carte se borde alors en attention. */
  aFaire: boolean
}

/** La carte de la Clôture (§ 5.7) : nulle quand l'inventaire est sans objet. `cloture` : le 31 décembre est-il passé ? */
export function carteDeLInventaire(
  inventaire: InventaireDesControles, exercice: number, brouillon: readonly LigneDuBrouillon[], cloture: boolean,
): CarteDeLInventaire | null {
  if (inventaire.etat === 'sans_objet') return null
  const { operations, provisions } = inventaire
  const delExercice = operations.filter((o) => o.exercice === exercice && !o.reprise)
  const nombre = delExercice.length
  const aRecomposer = delExercice.filter((o) => !regularisationAJour(o, brouillon, ciblePrecedente(o, operations, provisions))).length
  const combien = nombre === 0 ? 'Aucune régularisation saisie'
    : `${nombre} régularisation${nombre > 1 ? 's' : ''} saisie${nombre > 1 ? 's' : ''}`
  const recomposer = aRecomposer === 0 ? ''
    : ` ; ${aRecomposer} dont les écritures ne sont plus à jour, à recomposer dans l’onglet Inventaire`
  const declaration = declarationDeLExercice(inventaire, exercice)
  const etat = declaration !== null
    ? 'L’inventaire est déclaré fait.'
    : cloture
      ? 'L’inventaire n’est pas déclaré : la validation l’attend, même sans aucune régularisation.'
      : 'L’exercice n’est pas clos : son inventaire se déclarera après le 31 décembre.'
  return {
    titre: `Inventaire ${exercice}`,
    phrase: `${combien}${recomposer}. ${etat}`,
    aFaire: aRecomposer > 0 || (declaration === null && cloture),
  }
}

/** Ce que la carte de la Clôture montre, une fois jugé ce que l'écran a lu : rien, l'attente, le silence motivé, ou la carte. */
export type EtatDeLaCarteDeLInventaire =
  | { etat: 'sans_objet' }
  | { etat: 'chargement' }
  | { etat: 'partielle'; motif: string }
  | { etat: 'prete'; carte: CarteDeLInventaire }

/** Ce que la Clôture a lu pour la carte : la lecture de l'inventaire (nulle tant qu'elle n'est pas revenue) et le brouillon. */
export interface EntreesDeLaCarteDeLInventaire {
  /** `INVENTAIRE_EXPORTE` (lib/inventaire.ts), passé par l'écran : baissé, aucune carte — la Clôture d'hier. */
  exporte: boolean
  mode: ModeComptable
  lecture: { etat: 'sans_objet' } | Extract<InventaireDesControles, { etat: 'lu' }> | { etat: 'incomplete'; motif: string } | null
  /** Vrai tant que le brouillon de l'écran n'est pas revenu. */
  brouillonEnCours: boolean
  /** Le motif d'un brouillon lu en partie, ou nul. */
  brouillonIncomplet: string | null
  brouillon: readonly LigneDuBrouillon[]
  exercice: number
  /** L'année en cours à Paris : l'exercice est clos quand elle le dépasse. */
  anneeCourante: number
}

/**
 * LA CARTE DE LA CLÔTURE, JUGÉE (§ 5.7) : aucune le drapeau baissé ou en trésorerie — rien ne s'en lit ni ne s'en dit ; rien
 * d'affirmé avant que l'inventaire ET le brouillon soient revenus ; lu en partie, l'un ou l'autre, la carte le dit et ne compte
 * rien (le « à recomposer » se juge sur les lignes du brouillon) ; sinon la carte de l'exercice.
 */
export function etatDeLaCarteDeLInventaire(e: EntreesDeLaCarteDeLInventaire): EtatDeLaCarteDeLInventaire {
  if (!e.exporte || e.mode !== 'engagement') return { etat: 'sans_objet' }
  if (e.lecture === null || e.brouillonEnCours) return { etat: 'chargement' }
  if (e.lecture.etat === 'incomplete') return { etat: 'partielle', motif: `l’inventaire du dossier : ${e.lecture.motif}` }
  if (e.brouillonIncomplet !== null) return { etat: 'partielle', motif: `les écritures du dossier : ${e.brouillonIncomplet}` }
  const carte = carteDeLInventaire(inventaireDesControles(e.lecture, e.mode), e.exercice, e.brouillon, e.exercice < e.anneeCourante)
  return carte === null ? { etat: 'sans_objet' } : { etat: 'prete', carte }
}

// ── La révision : le programme des cycles (R4) ──────────────────────────────────────────────────────────────────────────

/** Un travail que l'inventaire ajoute au programme proposé d'un cycle (§ 5.5, R4), sous un code stable. */
export interface TravailDeLInventaire { code: string; travail: string }

// « Un travail "séparation des exercices" au cycle des achats et à celui des ventes, un travail "provisions" au cycle des
// tiers ; leur programme le propose, le cabinet conclut. » Les achats sont le cycle des dépenses (lib/revisionCycles.ts), les
// ventes celui des recettes. Des PROPOSITIONS, comme tout le programme : rien n'est coché, aucune conclusion n'est tirée.
export const TRAVAUX_DE_L_INVENTAIRE: Readonly<Partial<Record<CycleRevision, readonly TravailDeLInventaire[]>>> = {
  depenses: [{
    code: 'depenses-separation-exercices',
    travail: 'Séparer les exercices : rechercher les charges constatées d’avance, les factures non parvenues et les charges à '
      + 'payer au 31 décembre, et rapprocher leurs comptes de l’inventaire déclaré.',
  }],
  recettes: [{
    code: 'recettes-separation-exercices',
    travail: 'Séparer les exercices : rechercher les produits constatés d’avance, les factures à établir et les produits à '
      + 'recevoir au 31 décembre, et rapprocher leurs comptes de l’inventaire déclaré.',
  }],
  tiers: [{
    code: 'tiers-provisions',
    travail: 'Revoir les provisions pour risques et les dépréciations de créances : chaque risque et chaque créance, son '
      + 'évaluation au 31 décembre et sa justification.',
  }],
}

/** Les travaux que l'inventaire ajoute au programme d'un cycle : aucun quand il est sans objet (drapeau baissé, trésorerie). */
export function travauxDeLInventaire(cycle: CycleRevision, inventaireOffert: boolean): readonly TravailDeLInventaire[] {
  return inventaireOffert ? TRAVAUX_DE_L_INVENTAIRE[cycle] ?? [] : []
}

// ── Le dossier permanent : les contrats qui proposent leur charge constatée d'avance (R7) ───────────────────────────────

/** Une entrée du dossier permanent, telle que l'onglet Inventaire la propose : sa version courante. */
export interface ContratDuDossierPermanent {
  id: string
  nature: 'bail' | 'contrat'
  titre: string
  valable_du: string | null
  valable_jusqu_au: string | null
}

/** Une proposition : le contrat, et la régularisation qu'il fait préparer — une charge constatée d'avance, jamais écrite seule. */
export interface PropositionDuDossierPermanent {
  contrat: ContratDuDossierPermanent
  /** L'objet proposé (200 caractères au plus, sans saut de ligne), que le cabinet relit avant d'écrire. */
  objet: string
}

const LONGUEUR_MAX_OBJET = 200

/** Les contrats que le dossier permanent porte encore : la version courante des baux et des contrats non retirés. */
export function contratsDuDossierPermanent(
  entrees: readonly { courante: { id: string; nature: string; titre: string; valable_du: string | null; valable_jusqu_au: string | null }; retiree: boolean }[],
): ContratDuDossierPermanent[] {
  return entrees.flatMap(({ courante: c, retiree }) => (retiree || (c.nature !== 'bail' && c.nature !== 'contrat') ? []
    : [{ id: c.id, nature: c.nature, titre: c.titre, valable_du: c.valable_du, valable_jusqu_au: c.valable_jusqu_au }]))
}

/**
 * L'inventaire que la section « Dossier permanent » de la révision reçoit : sans objet en trésorerie ou le drapeau baissé (la
 * lecture ne rend alors rien) ; nul quand l'inventaire d'un dossier en engagement n'est pas revenu entier (`incomplet`, le
 * motif de SA lecture, jamais d'une autre) — la section le dit et ne propose rien ; sinon lu.
 */
export function inventaireDeLaRevision(
  inventaire: { etat: 'sans_objet' } | Extract<InventaireDesControles, { etat: 'lu' }>, incomplet: string | null, mode: ModeComptable,
): InventaireDesControles | null {
  if (mode !== 'engagement') return INVENTAIRE_DES_CONTROLES_SANS_OBJET
  return incomplet !== null ? null : inventaireDesControles(inventaire, mode)
}

/**
 * LES CONTRATS QUI PROPOSENT LEUR CHARGE CONSTATÉE D'AVANCE (§ 5.5, R7) : un bail ou un contrat du dossier permanent EN VIGUEUR
 * pour l'exercice (sa version courante, non retirée, dont la période touche l'année) qu'aucune régularisation de l'exercice ne
 * reprend déjà sous le même objet. `entrees` : nulles quand le dossier permanent n'est pas lu en entier — rien ne se propose.
 */
export function propositionsDuDossierPermanent(
  entrees: readonly ContratDuDossierPermanent[] | null,
  inventaire: InventaireDesControles,
  exercice: number,
): PropositionDuDossierPermanent[] | null {
  if (inventaire.etat === 'sans_objet') return []
  if (entrees === null) return null
  const debut = `${String(exercice).padStart(4, '0')}-01-01`
  const fin = `${String(exercice).padStart(4, '0')}-12-31`
  const objets = new Set(inventaire.operations.filter((o) => o.exercice === exercice).map((o) => o.objet))
  return entrees
    .filter((c) => (c.valable_du === null || c.valable_du <= fin) && (c.valable_jusqu_au === null || c.valable_jusqu_au >= debut))
    .map((contrat) => ({ contrat, objet: [...contrat.titre.replace(/[\r\n]+/g, ' ').trim()].slice(0, LONGUEUR_MAX_OBJET).join('') }))
    .filter((p) => p.objet.length > 0 && !objets.has(p.objet))
}
