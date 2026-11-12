import { MOTS_DES_REFUS, ROLES_D_INVENTAIRE, type RoleDInventaire } from './inventaire'
import type { ANouveau, EcritureBrouillon, InventaireDeclare, NatureOperationInventaire, OperationInventaire, Provision } from './types'

// L'INVENTAIRE DANS LA VALIDATION (ligne 35, lot INV3 ; docs/conceptions/35-inventaire.md, § 3.5, § 4.5 et § 5.3). Le module
// pur de la migration `validation_de_l_inventaire` (supabase/preparees/20261112235000_validation_de_l_inventaire.sql,
// PRÉPARÉE le 12/11/2026, pas appliquée), qui :
//   - pose `inventaires_declares` et ses deux fonctions, `declarer_inventaire` et `retirer_declaration_inventaire`
//     (INV-Q9 (A)) : leurs refus, sous les mêmes mots, aux mêmes codes, dans le même ordre (`MOTS_DE_LA_DECLARATION`,
//     `refusDeLaDeclaration`, `refusDuRetrait`), pour l'écran de l'inventaire (INV5) ;
//   - apprend l'inventaire à `valider_exercice`, après TOUS ses refus d'hier : (a) la numérotation des écritures d'une
//     régularisation (lib/fec.ts, la sorte `inventaire` ; lib/validationExercice.ts, le défaut `inventaire`), (b) l'inventaire
//     déclaré, (c) les régularisations de l'exercice à jour, (d) l'extourne entière de celles de l'exercice précédent, (e) la
//     ventilation des provisions reprises (INV-Q11 (A)) — ses mots (`MODELES_DE_LA_VALIDATION`) et ses deux juges, recomposés
//     ici en entiers (`regularisationAJour`, `extourneEntiere`), que `prealablesDeLInventaire` dit avant le clic.
// inventaireDeLaValidation.test.ts confronte chaque mot au texte de la migration, et les juges aux cas de son essai
// (supabase/essais/validationDeLInventaire.sql). DERRIÈRE `INVENTAIRE_PREVU` (lib/inventaire.ts) : baissé, la validation reçoit
// `INVENTAIRE_SANS_OBJET`, ne lit rien de l'inventaire et n'en dit rien — la base, sans la migration, n'en sait rien non plus.

// ── Les mots de la validation ───────────────────────────────────────────────────────────────────────────────────────────

/** Les refus de `valider_exercice` qui tiennent à l'inventaire, dans leur ordre ; chaque `%` reçoit une valeur, dans l'ordre. */
export const MODELES_DE_LA_VALIDATION = {
  numerotation: "Une écriture d'inventaire n'est pas numérotée sous sa pièce : au journal des opérations diverses, une écriture "
    + "par régularisation et par date, sous la pièce « Inventaire AAAA » du 31 décembre de son exercice.",
  nonDeclare: "L'inventaire de l'exercice % n'est pas déclaré : le déclarer fait, même sans régularisation, avant la validation.",
  aRecomposer: "L'exercice % porte une régularisation d'inventaire dont les écritures ne sont plus celles qu'elle commande : % — "
    + "l'enregistrer de nouveau avant la validation.",
  extourneManquante: "L'exercice % ne porte pas l'extourne entière d'une régularisation d'inventaire de l'exercice % : % — figée "
    + "avec son exercice, elle ne se réécrit plus, et l'exercice ne se valide pas sans elle.",
  provisionsAVentiler: "L'exercice % ouvre le solde repris du compte % sans le ventiler exactement en provisions : les provisions "
    + 'ventilées doivent faire exactement le solde repris du compte — les ventiler avant la validation.',
} as const

/** Un modèle rempli comme la base le remplit (`raise exception '…%…', v1, v2`) : chaque `%`, dans l'ordre, reçoit sa valeur. */
export function motsDeLaValidation(modele: string, ...valeurs: readonly (string | number)[]): string {
  let i = 0
  return modele.replace(/%/g, () => String(valeurs[i++] ?? '%'))
}

// ── Les mots de la déclaration ──────────────────────────────────────────────────────────────────────────────────────────

/** Les refus de `declarer_inventaire` puis de `retirer_declaration_inventaire`, dans l'ordre de leurs contrôles. */
export const MOTS_DE_LA_DECLARATION = {
  acces: 'Accès refusé à ce dossier.',
  tresorerie: MOTS_DES_REFUS.tresorerie,
  exercice: 'L’exercice de l’inventaire est illisible : une année entre 2000 et 2100.',
  exerciceFige: 'Cet exercice est validé : son inventaire ne change plus.',
  nonClos: 'Cet exercice n’est pas clos : son inventaire se déclare après son 31 décembre.',
  avantLOuverture: MOTS_DES_REFUS.avantLOuverture,
  dejaDeclare: 'L’inventaire de cet exercice est déjà déclaré : relire l’inventaire.',
  accesALaDeclaration: 'Accès refusé à cette déclaration.',
  declarationChangee: 'Cette déclaration a changé depuis sa lecture : relire l’inventaire.',
} as const

/** Les refus de la garde de `inventaires_declares` (`garder_inventaires_declares`) : aucun écran ne les rencontre. */
export const MOTS_DE_LA_GARDE_DES_DECLARATIONS = {
  efface: 'Une déclaration d’inventaire ne s’efface pas : elle se retire, et sa trace reste.',
  ecriture: 'Une déclaration d’inventaire ne s’écrit que par declarer_inventaire et retirer_declaration_inventaire.',
  change: 'Une déclaration d’inventaire ne change pas : elle se retire, une fois.',
} as const

export interface RefusDeLaDeclaration {
  cle: keyof typeof MOTS_DE_LA_DECLARATION
  /** Celui que la fonction lève : 22023 la saisie, 23514 l'exercice figé, 40001 une lecture dépassée. */
  code: '22023' | '23514' | '40001'
  message: string
}

const refus = (cle: RefusDeLaDeclaration['cle'], code: RefusDeLaDeclaration['code']): RefusDeLaDeclaration =>
  ({ cle, code, message: MOTS_DE_LA_DECLARATION[cle] })

/** Ce que l'écran sait du dossier pour déclarer : jamais « maintenant » lu ici, l'appelant donne l'année de Paris. */
export interface ContexteDeLaDeclaration {
  mode: 'tresorerie' | 'engagement'
  exercice: number
  /** Le dernier exercice validé (l'année de la frontière de la validation), ou rien. */
  derniereValidee: number | null
  /** L'année en cours, lue à Paris (`aujourdHuiAParis`), comme la base la lit. */
  anneeEnCours: number
  /** L'année des premiers à-nouveaux du dossier, ou rien. */
  premierExercice: number | null
  /** Les déclarations du dossier, lues en entier. */
  declarations: readonly DeclarationDeLaValidation[]
}

/** Le refus que `declarer_inventaire` lèverait, l'accès passé ; nul quand elle déclare. */
export function refusDeLaDeclaration(c: ContexteDeLaDeclaration): RefusDeLaDeclaration | null {
  if (c.mode !== 'engagement') return refus('tresorerie', '22023')
  if (!Number.isInteger(c.exercice) || c.exercice < 2000 || c.exercice > 2100) return refus('exercice', '22023')
  if (c.derniereValidee !== null && c.exercice <= c.derniereValidee) return refus('exerciceFige', '23514')
  if (c.exercice >= c.anneeEnCours) return refus('nonClos', '22023')
  if (c.premierExercice !== null && c.exercice < c.premierExercice) return refus('avantLOuverture', '22023')
  if (c.declarations.some((d) => d.exercice === c.exercice && d.retire_le === null)) return refus('dejaDeclare', '40001')
  return null
}

/** Le refus que `retirer_declaration_inventaire` lèverait, l'accès passé ; nul quand elle retire. */
export function refusDuRetrait(declaration: DeclarationDeLaValidation, derniereValidee: number | null): RefusDeLaDeclaration | null {
  if (declaration.retire_le !== null) return refus('declarationChangee', '40001')
  if (derniereValidee !== null && declaration.exercice <= derniereValidee) return refus('exerciceFige', '23514')
  return null
}

// ── Ce que la validation lit ────────────────────────────────────────────────────────────────────────────────────────────

/** Une régularisation, telle que les juges la lisent ; `provision_id` sur une évaluation de provision (INV4) seulement. */
export type OperationDeLaValidation = Pick<OperationInventaire,
  'id' | 'exercice' | 'nature' | 'compte_resultat' | 'compte_regularisation' | 'montant_centimes' | 'tva_centimes' | 'objet'>
  & { provision_id: string | null }
export type DeclarationDeLaValidation = Pick<InventaireDeclare, 'id' | 'exercice' | 'retire_le'>
export type ProvisionDeLaValidation = Pick<Provision, 'id' | 'compte_provision' | 'reprise_centimes'>

/**
 * CE QUE LA VALIDATION REÇOIT DE L'INVENTAIRE, sans valeur par défaut : rien à juger — le drapeau `INVENTAIRE_PREVU` baissé,
 * les migrations ne sont pas en base — ou les régularisations, les déclarations et les provisions du dossier, TOUTES lues en
 * entier (lib/inventaireLecture.ts). Pas encore revenues ou lues en partie, l'appelant passe nul : la validation se suspend,
 * comme sur toute lecture partielle (lib/prealablesValidation.ts).
 */
export type InventaireDeLaValidation =
  | { etat: 'sans_objet' }
  | {
    etat: 'lu'
    operations: readonly OperationDeLaValidation[]
    declarations: readonly DeclarationDeLaValidation[]
    provisions: readonly ProvisionDeLaValidation[]
  }

export const INVENTAIRE_SANS_OBJET: InventaireDeLaValidation = { etat: 'sans_objet' }

// ── Les deux juges, recomposés comme la base les recompose ──────────────────────────────────────────────────────────────

type LigneDuBrouillon = Pick<EcritureBrouillon, 'date' | 'compte' | 'sens' | 'montant' | 'operation_inventaire_id'>
type Sens = 'debit' | 'credit'
interface LigneJugee { date: string; compte: string; sens: Sens; centimes: number }

const racinesDuRole = (role: RoleDInventaire): readonly string[] => ROLES_D_INVENTAIRE.find((r) => r.role === role)!.racines

/** La racine de la TVA d'attente d'une facture non parvenue ou à établir (44586, 44587), lue au catalogue des rôles. */
function racineDeLaTva(nature: NatureOperationInventaire): string | null {
  if (nature === 'fnp') return racinesDuRole('tva_factures_non_parvenues')[0]
  if (nature === 'fae') return racinesDuRole('tva_factures_a_etablir')[0]
  return null
}

const cloture = (exercice: number) => `${exercice}-12-31`
const lendemainDeLaCloture = (exercice: number) => `${exercice + 1}-01-01`
const inverse = (sens: Sens): Sens => (sens === 'debit' ? 'credit' : 'debit')
// Le montant d'une ligne du brouillon en centimes, comme la base le lit : `round(montant * 100)`, un montant jamais négatif.
const centimesDe = (montant: number) => Math.round(montant * 100)

/** Deux multiensembles égaux : la règle de la base (« autant de lignes, et aucune attendue qui manque »). */
function memesLignes(attendues: readonly string[], recues: readonly string[]): boolean {
  if (attendues.length !== recues.length) return false
  const a = [...attendues].sort()
  const r = [...recues].sort()
  return a.every((x, i) => x === r[i])
}

/**
 * La provision au 31 décembre précédent d'une évaluation (`provision_cible_precedente`, INV4) : la cible de la dernière
 * évaluation de la même provision avant cet exercice, sinon sa part reprise (zéro sans elle) ; rien d'une provision que la
 * lecture ne rend pas — la base n'attend alors aucune ligne.
 */
export function ciblePrecedente(
  operation: Pick<OperationDeLaValidation, 'exercice' | 'provision_id'>,
  operations: readonly Pick<OperationDeLaValidation, 'exercice' | 'provision_id' | 'montant_centimes'>[],
  provisions: readonly ProvisionDeLaValidation[],
): number | null {
  if (operation.provision_id === null) return null
  const precedente = operations
    .filter((o) => o.provision_id === operation.provision_id && o.exercice < operation.exercice)
    .reduce<Pick<OperationDeLaValidation, 'exercice' | 'montant_centimes'> | null>((r, o) => (r === null || o.exercice > r.exercice ? o : r), null)
  if (precedente !== null) return precedente.montant_centimes
  const provision = provisions.find((p) => p.id === operation.provision_id)
  return provision === undefined ? null : provision.reprise_centimes ?? 0
}

/**
 * Les lignes qu'une régularisation commande (`inventaire_a_jour`) : au 31 décembre de son exercice, ses comptes et son
 * montant, la TVA d'attente sous sa racine ; au 1er janvier suivant, les mêmes en sens inverse ; une évaluation de provision,
 * l'écart entre sa cible et la précédente, au 31 décembre seulement. Une ligne à zéro ne s'attend pas. Nul : une nature que la
 * règle ne connaît pas — rien ne peut être à jour.
 */
export function lignesCommandees(
  o: Omit<OperationDeLaValidation, 'id' | 'objet' | 'provision_id'>, cible: number | null,
): LigneJugee[] | null {
  const r = o.compte_resultat
  const g = o.compte_regularisation
  const m = o.montant_centimes
  let lignes: [string, Sens, number][]
  if (o.nature === 'provision') {
    const ecart = cible === null ? 0 : m - cible
    lignes = ecart > 0 ? [[r, 'debit', ecart], [g, 'credit', ecart]] : ecart < 0 ? [[g, 'debit', -ecart], [r, 'credit', -ecart]] : []
  } else {
    const tva = racineDeLaTva(o.nature) ?? ''
    switch (o.nature) {
      case 'cca': lignes = [[g, 'debit', m], [r, 'credit', m]]; break
      case 'pca': lignes = [[r, 'debit', m], [g, 'credit', m]]; break
      case 'charge_a_payer': lignes = [[r, 'debit', m], [g, 'credit', m]]; break
      case 'produit_a_recevoir': lignes = [[g, 'debit', m], [r, 'credit', m]]; break
      case 'fnp': lignes = [[r, 'debit', m], [tva, 'debit', o.tva_centimes], [g, 'credit', m + o.tva_centimes]]; break
      case 'fae': lignes = [[g, 'debit', m + o.tva_centimes], [r, 'credit', m], [tva, 'credit', o.tva_centimes]]; break
      default: return null
    }
  }
  const constatees = lignes.filter(([, , c]) => c > 0)
  return [
    ...constatees.map(([compte, sens, centimes]) => ({ date: cloture(o.exercice), compte, sens, centimes })),
    ...(o.nature === 'provision' ? []
      : constatees.map(([compte, sens, centimes]) => ({ date: lendemainDeLaCloture(o.exercice), compte, sens: inverse(sens), centimes }))),
  ]
}

/**
 * UNE RÉGULARISATION À JOUR (`inventaire_a_jour`) : les lignes du brouillon qui la citent sont, en multiensemble (date, compte,
 * sens, centimes), celles qu'elle commande — la TVA d'attente jugée sous sa racine : le compte du rôle à l'écriture, que le plan
 * a pu déplacer depuis sans que la régularisation mente. `cible` : `ciblePrecedente`, pour une évaluation de provision.
 */
export function regularisationAJour(
  operation: OperationDeLaValidation, brouillon: readonly LigneDuBrouillon[], cible: number | null,
): boolean {
  const attendues = lignesCommandees(operation, cible)
  if (attendues === null) return false
  const racine = racineDeLaTva(operation.nature)
  const recues = brouillon.filter((l) => l.operation_inventaire_id === operation.id).map((l): LigneJugee => ({
    date: l.date, compte: racine !== null && l.compte.startsWith(racine) ? racine : l.compte, sens: l.sens, centimes: centimesDe(l.montant),
  }))
  const cle = (l: LigneJugee) => `${l.date}|${l.compte}|${l.sens}|${l.centimes}`
  return memesLignes(attendues.map(cle), recues.map(cle))
}

/**
 * L'EXTOURNE ENTIÈRE (`inventaire_extourne_entiere`) : les lignes du 1er janvier suivant l'exercice d'une régularisation sont
 * celles de sa constatation au 31 décembre, ligne pour ligne, en sens inverse (compte, sens, centimes) ; une évaluation de
 * provision n'en a aucune. La constatation est celle que la validation de son exercice a figée : ni le plan ni la
 * régularisation ne se relisent.
 */
export function extourneEntiere(
  operation: Pick<OperationDeLaValidation, 'id' | 'exercice' | 'nature'>, brouillon: readonly LigneDuBrouillon[],
): boolean {
  const miennes = brouillon.filter((l) => l.operation_inventaire_id === operation.id)
  const cle = (compte: string, sens: Sens, montant: number) => `${compte}|${sens}|${centimesDe(montant)}`
  const attendues = operation.nature === 'provision' ? []
    : miennes.filter((l) => l.date === cloture(operation.exercice)).map((l) => cle(l.compte, inverse(l.sens), l.montant))
  const recues = miennes.filter((l) => l.date === lendemainDeLaCloture(operation.exercice)).map((l) => cle(l.compte, l.sens, l.montant))
  return memesLignes(attendues, recues)
}

/**
 * LES PROVISIONS REPRISES, VENTILÉES (INV-Q11 (A)) : le premier compte de provision (sous le 151 ou le 491, dans l'ordre des
 * numéros) dont le solde repris au crédit, en centimes, n'est pas exactement la somme des parts reprises des provisions qui
 * s'y rangent ; un compte repris sans aucune provision ne l'est pas. Nul quand tout est ventilé.
 */
export function compteRepriseNonVentile(
  aNouveaux: readonly Pick<ANouveau, 'compte' | 'sens' | 'montant'>[], provisions: readonly ProvisionDeLaValidation[],
): string | null {
  const racines = [...racinesDuRole('provisions_risques'), ...racinesDuRole('depreciation_clients')]
  const comptes = new Set<string>([
    ...aNouveaux.filter((a) => racines.some((r) => a.compte.startsWith(r))).map((a) => a.compte),
    ...provisions.filter((p) => p.reprise_centimes !== null).map((p) => p.compte_provision),
  ])
  const repris = (compte: string) => aNouveaux.filter((a) => a.compte === compte)
    .reduce((s, a) => s + (a.sens === 'credit' ? 1 : -1) * centimesDe(a.montant), 0)
  const ventile = (compte: string) => provisions.filter((p) => p.compte_provision === compte && p.reprise_centimes !== null)
    .reduce((s, p) => s + (p.reprise_centimes ?? 0), 0)
  // L'ordre des numéros, celui de la base (`collate "C"`) : octet par octet.
  return [...comptes].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).find((c) => repris(c) !== ventile(c)) ?? null
}

// ── Ce que la validation retient, dit avant le clic ─────────────────────────────────────────────────────────────────────

export type IdDuPrealableDeLInventaire = 'inventaire-non-declare' | 'inventaire-a-recomposer' | 'extourne-manquante' | 'provisions-a-ventiler'

export interface PrealableDeLInventaire {
  id: IdDuPrealableDeLInventaire
  /** Les mots de la base, remplis comme elle les remplit. */
  message: string
}

export interface EntreesDeLInventaire {
  annee: number
  mode: 'tresorerie' | 'engagement'
  /** La balance reprise du dossier : sa date ouvre le premier exercice, ses comptes de provision se ventilent. */
  aNouveaux: readonly Pick<ANouveau, 'date' | 'compte' | 'sens' | 'montant'>[]
  /** TOUT le brouillon du dossier : l'extourne de l'exercice précédent se date du 1er janvier de celui-ci. */
  ecritures: readonly LigneDuBrouillon[]
  inventaire: InventaireDeLaValidation
}

// L'ordre d'un identifiant dans la base (`order by o.id`, un uuid : octet par octet, l'ordre de sa forme hexadécimale).
const parIdentifiant = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * Ce que `valider_exercice` refuserait de l'inventaire, après la numérotation, dans son ordre et sous ses mots : l'inventaire
 * non déclaré (en engagement), la première régularisation de l'exercice qui n'est pas à jour, la première de l'exercice
 * précédent sans son extourne entière, le premier compte de provision repris non ventilé (au premier exercice d'un dossier en
 * engagement). La base ne dit que le premier ; l'écran les dit tous. Rien quand l'inventaire est sans objet.
 */
export function prealablesDeLInventaire(e: EntreesDeLInventaire): PrealableDeLInventaire[] {
  if (e.inventaire.etat === 'sans_objet') return []
  const { operations, declarations, provisions } = e.inventaire
  const M = MODELES_DE_LA_VALIDATION
  const prealables: PrealableDeLInventaire[] = []
  if (e.mode === 'engagement' && !declarations.some((d) => d.exercice === e.annee && d.retire_le === null)) {
    prealables.push({ id: 'inventaire-non-declare', message: motsDeLaValidation(M.nonDeclare, e.annee) })
  }
  const aRecomposer = operations
    .filter((o) => o.exercice === e.annee && !regularisationAJour(o, e.ecritures, ciblePrecedente(o, operations, provisions)))
    .sort(parIdentifiant)[0]
  if (aRecomposer) {
    prealables.push({ id: 'inventaire-a-recomposer', message: motsDeLaValidation(M.aRecomposer, e.annee, aRecomposer.objet) })
  }
  const sansExtourne = operations.filter((o) => o.exercice === e.annee - 1 && !extourneEntiere(o, e.ecritures)).sort(parIdentifiant)[0]
  if (sansExtourne) {
    prealables.push({
      id: 'extourne-manquante', message: motsDeLaValidation(M.extourneManquante, e.annee, e.annee - 1, sansExtourne.objet),
    })
  }
  const ouverture = e.aNouveaux.reduce<string | null>((min, a) => (min === null || a.date < min ? a.date : min), null)
  if (e.mode === 'engagement' && ouverture !== null && Number(ouverture.slice(0, 4)) === e.annee) {
    const compte = compteRepriseNonVentile(e.aNouveaux, provisions)
    if (compte !== null) {
      prealables.push({ id: 'provisions-a-ventiler', message: motsDeLaValidation(M.provisionsAVentiler, e.annee, compte) })
    }
  }
  return prealables
}

// ── Le lettrage ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Les racines des comptes de régularisation qui se lettrent, la constatation contre son extourne (§ 5.3 ; lib/lettrage.ts) :
 *  les factures non parvenues (408) et à établir (418), lues au catalogue des rôles. */
export const RACINES_LETTREES_PAR_REGULARISATION: readonly string[] =
  [...racinesDuRole('factures_non_parvenues'), ...racinesDuRole('factures_a_etablir')]
