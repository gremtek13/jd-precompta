import { amortissementCumuleCentimes, rang360 } from './amortissements'
import { CASES_DES_TOTAUX, RUBRIQUES_ACTIF, RUBRIQUES_PASSIF, type BilanEtabli } from './bilan'
import {
  appliquerLesFormules, arrondirALEuro, formulaireALEuro, type CompteDeResultatEtabli, type Formule,
} from './compteDeResultat2033'
import { formatMoney } from './format'
import type { Immobilisation, NatureImmobilisation } from './types'

// LA LIASSE 2033 HORS DU COMPTE DE RÉSULTAT — ligne 37 de la feuille de route, lot LIA1 (docs/conceptions/37-liasse-2033.md,
// § 3.1 et § 3.6). Un module PUR, sans base, sans écran, sans drapeau : le 2033-C (cadres I et II) depuis le REGISTRE des
// immobilisations, le 2033-D (cadre I) depuis des provisions PASSÉES EN PARAMÈTRE (leur table naîtra avec la ligne 35,
// INV4), le 2033-E (la valeur ajoutée) depuis les soldes du compte de résultat et des saisies du cabinet, et les contrôles
// de cohérence du § 3.6 que ces tableaux permettent déjà.
//
// LES SOURCES : le formulaire 2033-SD 2026 [F] et sa notice 2033-NOT-SD 2026 [N] (adresses et empreintes en tête de
// lib/compteDeResultat2033.ts) — les CODES des cases sont relevés sur [F], page par page ; ce que chaque ligne du 2033-E
// porte, compte par compte, est dit par [N] (« Calcul de la valeur ajoutée », pages 17 à 20), qui renvoie au BOFiP
// (BOI-CVAE-BASE-20). Le PCG de 2026 [P] donne les numéros des comptes.
//
// MÊMES RÈGLES QUE LE 2033-B : centimes entiers, l'arrondi à l'euro à la case seulement (`formulaireALEuro`, les totaux
// recalculés sur les valeurs arrondies) ; une case qu'aucune source ne donne est « à saisir » (nulle), et tout total qui
// la compte est nul — jamais zéro. Le BNC en trésorerie n'arrive jamais ici : le compte de résultat ne s'y établit pas, et
// le 2033-C et le 2033-D ne se demandent que d'un dossier en engagement (l'appelant le sait par le compte de résultat).

const euros = (centimes: number) => formatMoney(centimes / 100)

// ── 2033-C, cadres I et II : les immobilisations et les amortissements ───────────────────────────────────────────

/** Les lignes du cadre I [F] ; les financières n'ont pas de ligne au cadre II. */
export type RubriqueImmobilisation2033C =
  | 'fonds-commercial' | 'autres-incorporelles' | 'terrains' | 'constructions' | 'installations-techniques'
  | 'installations-generales' | 'materiel-de-transport' | 'autres-corporelles' | 'financieres'

/** Les codes d'une ligne : début, augmentations, diminutions, fin [F]. */
interface CodesDUneLigne { debut: string; augmentations: string; diminutions: string; fin: string }

export const LIGNES_2033C: readonly {
  rubrique: RubriqueImmobilisation2033C
  libelle: string
  immobilisations: CodesDUneLigne
  amortissements: CodesDUneLigne | null
}[] = [
  { rubrique: 'fonds-commercial', libelle: 'Fonds commercial',
    immobilisations: { debut: '400', augmentations: '402', diminutions: '404', fin: '406' },
    amortissements: { debut: '495', augmentations: '497', diminutions: '498', fin: '499' } },
  { rubrique: 'autres-incorporelles', libelle: 'Autres immobilisations incorporelles',
    immobilisations: { debut: '410', augmentations: '412', diminutions: '414', fin: '416' },
    amortissements: { debut: '500', augmentations: '502', diminutions: '504', fin: '506' } },
  { rubrique: 'terrains', libelle: 'Terrains',
    immobilisations: { debut: '420', augmentations: '422', diminutions: '424', fin: '426' },
    amortissements: { debut: '510', augmentations: '512', diminutions: '514', fin: '516' } },
  { rubrique: 'constructions', libelle: 'Constructions',
    immobilisations: { debut: '430', augmentations: '432', diminutions: '434', fin: '436' },
    amortissements: { debut: '520', augmentations: '522', diminutions: '524', fin: '526' } },
  { rubrique: 'installations-techniques', libelle: 'Installations techniques, matériel et outillage industriels',
    immobilisations: { debut: '440', augmentations: '442', diminutions: '444', fin: '446' },
    amortissements: { debut: '530', augmentations: '532', diminutions: '534', fin: '536' } },
  { rubrique: 'installations-generales', libelle: 'Installations générales, agencements, aménagements divers',
    immobilisations: { debut: '450', augmentations: '452', diminutions: '454', fin: '456' },
    amortissements: { debut: '540', augmentations: '542', diminutions: '544', fin: '546' } },
  { rubrique: 'materiel-de-transport', libelle: 'Matériel de transport',
    immobilisations: { debut: '460', augmentations: '462', diminutions: '464', fin: '466' },
    amortissements: { debut: '550', augmentations: '552', diminutions: '554', fin: '556' } },
  { rubrique: 'autres-corporelles', libelle: 'Autres immobilisations corporelles',
    immobilisations: { debut: '470', augmentations: '472', diminutions: '474', fin: '476' },
    amortissements: { debut: '560', augmentations: '562', diminutions: '564', fin: '566' } },
  { rubrique: 'financieres', libelle: 'Immobilisations financières',
    immobilisations: { debut: '480', augmentations: '482', diminutions: '484', fin: '486' },
    amortissements: null },
]

const TOTAL_IMMOBILISATIONS: CodesDUneLigne = { debut: '490', augmentations: '492', diminutions: '494', fin: '496' }
const TOTAL_AMORTISSEMENTS: CodesDUneLigne = { debut: '570', augmentations: '572', diminutions: '574', fin: '576' }

// Chaque fin de ligne est début + augmentations − diminutions, chaque total la somme de sa colonne.
function formulesDesLignes(lignes: readonly CodesDUneLigne[], total: CodesDUneLigne): Formule[] {
  const formules: Formule[] = lignes.map((l) => [l.fin, [[1, l.debut], [1, l.augmentations], [-1, l.diminutions]]] as const)
  for (const colonne of ['debut', 'augmentations', 'diminutions', 'fin'] as const) {
    formules.push([total[colonne], lignes.map((l) => [1, l[colonne]] as const)])
  }
  return formules
}

export const FORMULES_2033C: readonly Formule[] = [
  ...formulesDesLignes(LIGNES_2033C.map((l) => l.immobilisations), TOTAL_IMMOBILISATIONS),
  ...formulesDesLignes(LIGNES_2033C.flatMap((l) => (l.amortissements ? [l.amortissements] : [])), TOTAL_AMORTISSEMENTS),
]

// La ligne d'un bien, par le compte de sa NATURE (six chiffres, 20… ou 21… : lib/amortissements.ts,
// FORMAT_COMPTE_IMMOBILISATION), au préfixe le plus long [P]. Le fonds commercial porte le droit au bail (206) comme le
// 2033-A (lib/bilan.ts, case 010) ; les frais d'établissement (201) n'ont de ligne ni au 2033-A ni ici.
const LIGNE_DU_COMPTE: ReadonlyMap<string, RubriqueImmobilisation2033C | { aClasser: string }> = new Map<string, RubriqueImmobilisation2033C | { aClasser: string }>([
  ['20', 'autres-incorporelles'],
  ['201', { aClasser: 'Frais d’établissement : aucune ligne du 2033-C ni du 2033-A ne les nomme.' }],
  ['206', 'fonds-commercial'], ['207', 'fonds-commercial'],
  ['211', 'terrains'], ['212', 'terrains'],
  ['213', 'constructions'], ['214', 'constructions'],
  ['215', 'installations-techniques'],
  ['218', 'autres-corporelles'], ['2181', 'installations-generales'], ['2182', 'materiel-de-transport'],
  ['26', 'financieres'], ['27', 'financieres'],
])

export function ligneDuCompteDImmobilisation(compte: string): RubriqueImmobilisation2033C | { aClasser: string } {
  for (let longueur = Math.min(compte.length, 4); longueur >= 2; longueur--) {
    const ligne = LIGNE_DU_COMPTE.get(compte.slice(0, longueur))
    if (ligne) return ligne
  }
  return { aClasser: 'Aucune ligne du 2033-C ne nomme ce compte : à classer par le cabinet.' }
}

export type BienDuRegistre = Pick<Immobilisation,
  'id' | 'libelle' | 'nature_id' | 'valeur' | 'date_acquisition' | 'date_mise_en_service' | 'duree_annees'>

export interface EntreesDu2033C {
  exercice: number
  registre: readonly BienDuRegistre[]
  natures: readonly Pick<NatureImmobilisation, 'id' | 'compte_immobilisation'>[]
}

export interface BienDuTableau {
  id: string
  libelle: string
  rubrique: RubriqueImmobilisation2033C
  /** En centimes. */
  brutDebut: number
  augmentation: number
  amortissementsDebut: number
  dotation: number
}

export interface Tableau2033C {
  exercice: number
  /** Les cases des cadres I et II, en centimes. Les diminutions sont nulles : aucune sortie ne se saisit (LIA-Q12). */
  cases: Map<string, number>
  biens: BienDuTableau[]
  /** Un bien dont la ligne n'est pas connue : il n'est compté nulle part, et le tableau le dit. */
  biensHorsTableau: { id: string; libelle: string; raison: string }[]
}

const centimesDe = (valeur: number) => Math.round(valeur * 100)

// Le registre, au 31 décembre de l'exercice : la valeur brute d'un bien acquis avant l'exercice est au DÉBUT, celle d'un
// bien acquis dans l'exercice aux AUGMENTATIONS ; un bien acquis après n'y est pas. L'amortissement cumulé est celui de
// la règle fiscale de l'application (linéaire, prorata en 30/360, le cumul arrondi : `amortissementCumuleCentimes`), au 31
// décembre de l'exercice précédent puis de celui-ci ; la dotation est leur écart, comme `dotationDeLExercice`.
// L'application n'amortit qu'en linéaire, sur une durée unique : il n'y a pas d'amortissement dérogatoire (2033-D, cadre
// I, ligne 600 ; cadre B).
export function tableau2033C(e: EntreesDu2033C): Tableau2033C {
  const debutExercice = `${e.exercice}-01-01`
  const finExercice = `${e.exercice}-12-31`
  const compteDeLaNature = new Map(e.natures.map((n) => [n.id, n.compte_immobilisation]))
  const alimentees = new Map<string, number | null>()
  for (const l of LIGNES_2033C) {
    for (const codes of [l.immobilisations, l.amortissements]) {
      if (!codes) continue
      alimentees.set(codes.debut, 0)
      alimentees.set(codes.augmentations, 0)
      alimentees.set(codes.diminutions, 0)
    }
  }
  const ajouter = (code: string, centimes: number) => alimentees.set(code, (alimentees.get(code) ?? 0) + centimes)
  const biens: BienDuTableau[] = []
  const biensHorsTableau: Tableau2033C['biensHorsTableau'] = []

  for (const bien of [...e.registre].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (bien.date_acquisition > finExercice) continue
    const compte = bien.nature_id === null ? undefined : compteDeLaNature.get(bien.nature_id)
    if (compte === undefined) {
      biensHorsTableau.push({ id: bien.id, libelle: bien.libelle, raison: 'Sans nature : son compte, donc sa ligne, n’est pas connu.' })
      continue
    }
    const ligne = ligneDuCompteDImmobilisation(compte)
    if (typeof ligne !== 'string') {
      biensHorsTableau.push({ id: bien.id, libelle: bien.libelle, raison: ligne.aClasser })
      continue
    }
    const definition = LIGNES_2033C.find((l) => l.rubrique === ligne)!
    const valeur = centimesDe(bien.valeur)
    const acquisDansLExercice = bien.date_acquisition >= debutExercice
    const amortissementsDebut = Number(amortissementCumuleCentimes(bien, rang360(`${e.exercice - 1}-12-31`)))
    const amortissementsFin = Number(amortissementCumuleCentimes(bien, rang360(finExercice)))
    const b: BienDuTableau = {
      id: bien.id, libelle: bien.libelle, rubrique: ligne,
      brutDebut: acquisDansLExercice ? 0 : valeur, augmentation: acquisDansLExercice ? valeur : 0,
      amortissementsDebut, dotation: amortissementsFin - amortissementsDebut,
    }
    biens.push(b)
    ajouter(definition.immobilisations.debut, b.brutDebut)
    ajouter(definition.immobilisations.augmentations, b.augmentation)
    if (definition.amortissements) {
      ajouter(definition.amortissements.debut, b.amortissementsDebut)
      ajouter(definition.amortissements.augmentations, b.dotation)
    } else if (amortissementsFin !== 0) {
      // Une immobilisation financière ne s'amortit pas ; le registre n'en porte pas (FORMAT_COMPTE_IMMOBILISATION).
      biensHorsTableau.push({ id: bien.id, libelle: bien.libelle, raison: 'Immobilisation financière amortie : le 2033-C n’a pas de ligne pour son amortissement.' })
    }
  }
  const cases = appliquerLesFormules(alimentees, FORMULES_2033C) as Map<string, number>
  return { exercice: e.exercice, cases, biens, biensHorsTableau }
}

/** Les cadres I et II tels que le formulaire les porte, en euros. */
export function tableau2033CALEuro(t: Tableau2033C): Map<string, number> {
  const alimentees = new Map<string, number | null>()
  const calculees = new Set(FORMULES_2033C.map(([code]) => code))
  for (const [code, v] of t.cases) if (!calculees.has(code)) alimentees.set(code, v)
  return formulaireALEuro(alimentees, FORMULES_2033C) as Map<string, number>
}

// ── 2033-D, cadre I : le relevé des provisions ───────────────────────────────────────────────────────────────────

/** Les lignes du cadre I A [F], hors amortissements dérogatoires (600, 601) que l'application ne pratique pas. */
export type GenreDeProvision2033D =
  | 'reglementees-autres' | 'risques-et-charges' | 'depreciation-immobilisations' | 'depreciation-stocks'
  | 'depreciation-clients' | 'depreciation-autres'

export const LIGNES_2033D: readonly { genre: GenreDeProvision2033D | 'amortissements-derogatoires'; libelle: string; codes: CodesDUneLigne }[] = [
  { genre: 'amortissements-derogatoires', libelle: 'Amortissements dérogatoires', codes: { debut: '600', augmentations: '602', diminutions: '604', fin: '606' } },
  { genre: 'reglementees-autres', libelle: 'Autres provisions réglementées', codes: { debut: '610', augmentations: '612', diminutions: '614', fin: '616' } },
  { genre: 'risques-et-charges', libelle: 'Provisions pour risques et charges', codes: { debut: '620', augmentations: '622', diminutions: '624', fin: '626' } },
  { genre: 'depreciation-immobilisations', libelle: 'Dépréciation — sur immobilisations', codes: { debut: '630', augmentations: '632', diminutions: '634', fin: '636' } },
  { genre: 'depreciation-stocks', libelle: 'Dépréciation — sur stocks et en cours', codes: { debut: '640', augmentations: '642', diminutions: '644', fin: '646' } },
  { genre: 'depreciation-clients', libelle: 'Dépréciation — sur comptes clients', codes: { debut: '650', augmentations: '652', diminutions: '654', fin: '656' } },
  { genre: 'depreciation-autres', libelle: 'Autres provisions pour dépréciation', codes: { debut: '660', augmentations: '662', diminutions: '664', fin: '666' } },
]

const TOTAL_PROVISIONS: CodesDUneLigne = { debut: '680', augmentations: '682', diminutions: '684', fin: '686' }

// 780, « TOTAL à reporter ligne 322 du tableau n° 2033-B-SD » [F] : les dotations non déductibles du cadre C.
export const FORMULES_2033D: readonly Formule[] = [
  ...formulesDesLignes(LIGNES_2033D.map((l) => l.codes), TOTAL_PROVISIONS),
  ['780', [[1, 'C1'], [1, 'C2'], [1, 'C3'], [1, 'C4'], [1, 'C5'], [1, 'C6'], [1, 'C7']]],
]

/**
 * Une provision de l'exercice, telle que la ligne 35 la tiendra (INV4, `provisions` et leurs évaluations) : en centimes,
 * positifs. `dotationsNonDeductibles` est la part de ses dotations que le cabinet a dite non déductible (2033-D I C).
 */
export interface ProvisionDuReleve {
  id: string
  genre: GenreDeProvision2033D
  libelle: string
  debut: number
  dotations: number
  reprises: number
  fin: number
  dotationsNonDeductibles: number
}

export interface Tableau2033D {
  /** Les cases du cadre I A et 780, en centimes. Les lignes 600 à 607 et le cadre B sont nuls (amortissement linéaire seul). */
  cases: Map<string, number>
  /** Le cadre C, ligne par ligne (sept lignes au formulaire ; au-delà, un état du même modèle). */
  nonDeductibles: { libelle: string; centimes: number }[]
  /** Une provision dont la fin n'est pas début + dotations − reprises, ou dont une part non déductible excède ses dotations. */
  incoherences: { id: string; libelle: string; texte: string }[]
}

export function tableau2033D(provisions: readonly ProvisionDuReleve[]): Tableau2033D {
  const alimentees = new Map<string, number | null>()
  for (const l of LIGNES_2033D) {
    alimentees.set(l.codes.debut, 0)
    alimentees.set(l.codes.augmentations, 0)
    alimentees.set(l.codes.diminutions, 0)
  }
  const nonDeductibles: Tableau2033D['nonDeductibles'] = []
  const incoherences: Tableau2033D['incoherences'] = []
  const ajouter = (code: string, centimes: number) => alimentees.set(code, (alimentees.get(code) ?? 0) + centimes)
  for (const p of provisions) {
    for (const v of [p.debut, p.dotations, p.reprises, p.fin, p.dotationsNonDeductibles]) {
      if (!Number.isInteger(v) || v < 0) throw new Error(`Provision ${p.id} : montant hors centimes entiers positifs (${v}).`)
    }
    const codes = LIGNES_2033D.find((l) => l.genre === p.genre)!.codes
    ajouter(codes.debut, p.debut)
    ajouter(codes.augmentations, p.dotations)
    ajouter(codes.diminutions, p.reprises)
    if (p.debut + p.dotations - p.reprises !== p.fin) {
      incoherences.push({
        id: p.id, libelle: p.libelle,
        texte: `${p.libelle} : ${euros(p.debut)} au début, ${euros(p.dotations)} de dotations et ${euros(p.reprises)} de `
          + `reprises font ${euros(p.debut + p.dotations - p.reprises)}, pas les ${euros(p.fin)} de la fin.`,
      })
    }
    if (p.dotationsNonDeductibles > p.dotations) {
      incoherences.push({
        id: p.id, libelle: p.libelle,
        texte: `${p.libelle} : ${euros(p.dotationsNonDeductibles)} de dotations non déductibles, pour ${euros(p.dotations)} de dotations.`,
      })
    }
    if (p.dotationsNonDeductibles > 0) nonDeductibles.push({ libelle: p.libelle, centimes: p.dotationsNonDeductibles })
  }
  // Le cadre C a sept lignes [F], dont la PREMIÈRE est imprimée : « Indemnités pour congés à payer, charges sociales et
  // fiscales correspondantes » (relevé en remplissant le PDF, LIA6). Elles ne sont pas une provision de la ligne 35 (le
  // PCG les range en dettes, 4282) : C1 reste nul. Les six lignes libres, 2 à 7, reçoivent les provisions ; au-delà,
  // « joindre un état du même modèle » : la septième porte les suivantes, que l'état détaille.
  alimentees.set('C1', 0)
  for (let i = 1; i < 7; i++) {
    const montant = i < 6 ? (nonDeductibles[i - 1]?.centimes ?? 0) : nonDeductibles.slice(5).reduce((t, n) => t + n.centimes, 0)
    alimentees.set(`C${i + 1}`, montant)
  }
  const cases = appliquerLesFormules(alimentees, FORMULES_2033D) as Map<string, number>
  return { cases, nonDeductibles, incoherences }
}

/**
 * Le cadre I A, le cadre C (`C1` à `C7`, les sept lignes numérotées du formulaire, qui n'ont pas de code) et 780 tels que
 * le formulaire les porte, en euros (LIA6) : chaque case arrondie seule, les totaux recalculés.
 */
export function tableau2033DALEuro(t: Tableau2033D): Map<string, number> {
  const calculees = new Set(FORMULES_2033D.map(([code]) => code))
  const alimentees = new Map<string, number | null>([...t.cases].filter(([code]) => !calculees.has(code)))
  return formulaireALEuro(alimentees, FORMULES_2033D) as Map<string, number>
}

// ── 2033-E : la valeur ajoutée ───────────────────────────────────────────────────────────────────────────────────

// Les lignes que le cabinet saisit : aucun compte ne les dit, ou la notice veut un jugement (une plus-value « rattachée à
// une activité normale et courante », la part DÉDUCTIBLE de la production immobilisée, des loyers d'une location de plus
// de six mois, des taxes « qui grèvent le prix »…) [N]. Nulles, elles sont « à saisir », et les totaux qui les comptent
// aussi.
export type CaseSaisie2033E = '119' | '143' | '153' | '310' | '133' | '128' | '135' | '150'

export type Saisies2033E = Readonly<Record<CaseSaisie2033E, number | null>>

/** Les lignes saisies, dans l'ordre du formulaire (un objet aux clés numériques s'énumère dans l'ordre des nombres). */
export const CASES_SAISIES_2033E: readonly CaseSaisie2033E[] = ['119', '143', '153', '310', '133', '128', '135', '150']

// La ligne des loyers DÉDUCTIBLES porte le code 310 sur le formulaire [F, page du 2033-E] et le code 146 dans sa notice
// [N, page 20] : le formulaire est ce qui se dépose et ce que le gabarit lira (LIA6), son code est retenu, et l'écart est
// signalé (point non vérifié, à relever au millésime suivant).
export const CODE_DES_LOYERS_2033E = '310'

export const FORMULES_2033E: readonly Formule[] = [
  ['106', [[1, '108'], [1, '118'], [1, '119']]],
  ['144', [[1, '115'], [1, '143'], [1, '113'], [1, '111'], [1, '153']]],
  ['152', [[1, '121'], [1, '145'], [1, '125'], [1, '310'], [1, '133'], [1, '148'], [1, '128'], [1, '135'], [1, '150']]],
  ['137', [[1, '106'], [1, '144'], [-1, '152']]],
]

export interface Tableau2033E {
  /** Les cases, en centimes ; nulle, une case à saisir ou un total qui en compte une. */
  cases: Map<string, number | null>
  aSaisir: CaseSaisie2033E[]
  /** Ce que les comptes laissent voir pour une case à saisir : jamais écrit, à confirmer (LIA-Q4). */
  propositions: { code: CaseSaisie2033E; centimes: number; texte: string }[]
}

/** La somme crédit − débit (produit) ou débit − crédit (charge) des soldes dont le compte passe le filtre. */
function somme(soldes: CompteDeResultatEtabli['soldes'], filtre: RegExp, nature: 'produit' | 'charge'): number {
  let total = 0
  for (const s of soldes) if (filtre.test(s.compte)) total += nature === 'produit' ? -s.centimes : s.centimes
  return total
}

// Les lignes tirées des comptes, chacune d'après la phrase de [N] qui la définit :
//   108 « l'ensemble des produits à comptabiliser aux comptes 701 à 709 », le 709 en diminution ;
//   118 « au compte 751 » ;
//   115 « les comptes 752 à 758 […] à l'exception du compte 755 » ;
//   113 « au compte 74 » (une subvention rangée ailleurs, au 7715 par exemple, demande le jugement du cabinet : elle n'y
//       est pas ajoutée) ;
//   111 et 145 « le solde créditeur [débiteur] […] des comptes 603 et 713 », lu comme LE solde de leur ensemble ;
//   121 « les comptes 601 à 609 […] à l'exception du compte 603 », le 609 en diminution ;
//   125 les services extérieurs (61, 62) « à l'exception des loyers et des redevances » [F] : 611, 614 à 619, 621 à 629 —
//       les 612 et 613 vont à la ligne des loyers, que le cabinet saisit (seuls ceux d'une location de six mois au plus
//       se déduisent) et que leur solde PROPOSE ;
//   148 « les comptes 651 à 658 », « à l'exception des quotes-parts […] au compte 655 ».
export function tableau2033E(cr: CompteDeResultatEtabli, saisies: Saisies2033E): Tableau2033E {
  const s = cr.soldes
  const variation = -somme(s, /^(603|713)/, 'charge')
  const alimentees = new Map<string, number | null>([
    ['108', somme(s, /^70[1-9]/, 'produit')],
    ['118', somme(s, /^751/, 'produit')],
    ['115', somme(s, /^75[2-8]/, 'produit') - somme(s, /^755/, 'produit')],
    ['113', somme(s, /^74/, 'produit')],
    ['111', Math.max(variation, 0)],
    ['121', somme(s, /^60[1-9]/, 'charge') - somme(s, /^603/, 'charge')],
    ['145', Math.max(-variation, 0)],
    ['125', somme(s, /^(611|61[4-9]|62)/, 'charge')],
    ['148', somme(s, /^65[1-8]/, 'charge') - somme(s, /^655/, 'charge')],
  ])
  const aSaisir: CaseSaisie2033E[] = []
  for (const code of CASES_SAISIES_2033E) {
    const v = saisies[code]
    if (v !== null && !Number.isInteger(v)) throw new Error(`Saisie ${code} hors centimes entiers : ${v}.`)
    alimentees.set(code, v)
    if (v === null) aSaisir.push(code)
  }
  const propositions: Tableau2033E['propositions'] = []
  const loyers = somme(s, /^61[23]/, 'charge')
  if (saisies['310'] === null && loyers !== 0) {
    propositions.push({
      code: '310', centimes: loyers,
      texte: 'Le solde des loyers et redevances (612, 613), à diminuer de ceux d’une location de plus de six mois, d’un '
        + 'crédit-bail ou d’une location-gérance, qui ne se déduisent pas.',
    })
  }
  const immobilisee = somme(s, /^72[12]/, 'produit')
  if (saisies['143'] === null && immobilisee !== 0) {
    propositions.push({
      code: '143', centimes: immobilisee,
      texte: 'La production immobilisée (721, 722), à ramener aux seules charges déductibles qui l’ont formée.',
    })
  }
  const rentrees = somme(s, /^7714/, 'produit')
  if (saisies['153'] === null && rentrees !== 0) {
    propositions.push({
      code: '153', centimes: rentrees,
      texte: 'Les rentrées sur créances amorties (7714), si elles se rapportent au résultat d’exploitation.',
    })
  }
  return { cases: appliquerLesFormules(alimentees, FORMULES_2033E), aSaisir, propositions }
}

/** Le 2033-E tel que le formulaire le porte, en euros ; une case à saisir reste nulle. */
export function tableau2033EALEuro(t: Tableau2033E): Map<string, number | null> {
  const calculees = new Set(FORMULES_2033E.map(([code]) => code))
  const alimentees = new Map([...t.cases].filter(([code]) => !calculees.has(code)))
  return formulaireALEuro(alimentees, FORMULES_2033E)
}

// ── 2033-A : le bilan simplifié, à l'euro (LIA6) ────────────────────────────────────────────────────────────────

const casesDActif = (masse: 'immobilise' | 'circulant', colonne: 'brut' | 'amortissements') =>
  RUBRIQUES_ACTIF.filter((r) => r.masse === masse && r.cases !== null).map((r) => r.cases![colonne])
const casesDuPassif = (masse: 'capitaux-propres' | 'dettes') =>
  RUBRIQUES_PASSIF.filter((r) => r.masse === masse && r.case !== null).map((r) => r.case!)
const somme2033A = (code: string, codes: readonly string[]): Formule => [code, codes.map((c) => [1, c] as const)]

// Les totaux que le 2033-A imprime [F, page 1] : l'actif immobilisé (044, 048), l'actif circulant (096, 098), le total
// (110, 112) ; les capitaux propres (142), les dettes (176) et le total du passif (180), qui compte la case 154 des
// provisions pour risques et charges (une rubrique à elle seule, son propre total). La colonne « net » n'a pas de code :
// elle ne se remplit pas.
export const FORMULES_2033A: readonly Formule[] = [
  somme2033A(CASES_DES_TOTAUX.actifImmobilise.brut, casesDActif('immobilise', 'brut')),
  somme2033A(CASES_DES_TOTAUX.actifImmobilise.amortissements, casesDActif('immobilise', 'amortissements')),
  somme2033A(CASES_DES_TOTAUX.actifCirculant.brut, casesDActif('circulant', 'brut')),
  somme2033A(CASES_DES_TOTAUX.actifCirculant.amortissements, casesDActif('circulant', 'amortissements')),
  somme2033A(CASES_DES_TOTAUX.totalActif.brut, [CASES_DES_TOTAUX.actifImmobilise.brut, CASES_DES_TOTAUX.actifCirculant.brut]),
  somme2033A(CASES_DES_TOTAUX.totalActif.amortissements,
    [CASES_DES_TOTAUX.actifImmobilise.amortissements, CASES_DES_TOTAUX.actifCirculant.amortissements]),
  somme2033A(CASES_DES_TOTAUX.capitauxPropres, casesDuPassif('capitaux-propres')),
  somme2033A(CASES_DES_TOTAUX.dettes, casesDuPassif('dettes')),
  somme2033A(CASES_DES_TOTAUX.totalPassif, [CASES_DES_TOTAUX.capitauxPropres, CASES_DES_TOTAUX.provisions, CASES_DES_TOTAUX.dettes]),
]

export type Bilan2033AALEuro =
  | { etat: 'rempli'; cases: Map<string, number> }
  | { etat: 'refuse'; texte: string }

/**
 * Le 2033-A tel que le formulaire le porte, en euros (LIA6) : chaque rubrique arrondie seule, les totaux recalculés, les
 * deux renvois que le bilan sait (169, la TVA des dettes fiscales ; 199, les comptes courants débiteurs). Refusé quand un
 * montant n'a pas de case : un compte « à classer », ou le résultat d'avant qu'une société n'a pas affecté — un total
 * écrit sans eux serait faux sur le papier.
 */
export function bilan2033AALEuro(bilan: BilanEtabli): Bilan2033AALEuro {
  if (bilan.totauxActif.aClasser !== 0 || bilan.totauxPassif.aClasser !== 0) {
    return { etat: 'refuse', texte: 'Des comptes sont à classer : le 2033-A ne se remplit pas tant qu’aucune case ne les porte.' }
  }
  const enAttente = bilan.passif.find((r) => r.id === 'resultats-en-attente')
  if (enAttente && enAttente.montant !== 0) {
    return {
      etat: 'refuse',
      texte: `Le résultat d’un exercice précédent (${euros(enAttente.montant)}) attend son affectation : aucune case du 2033-A ne le porte.`,
    }
  }
  const alimentees = new Map<string, number | null>()
  for (const r of bilan.actif) {
    if (!r.cases) continue
    alimentees.set(r.cases.brut, r.brut)
    alimentees.set(r.cases.amortissements, r.amortissements)
  }
  // La case 154 est la rubrique et le total des provisions : elle s'arrondit comme rubrique, aucune formule ne la refait.
  for (const r of bilan.passif) if (r.case !== null) alimentees.set(r.case, r.montant)
  const cases = formulaireALEuro(alimentees, FORMULES_2033A) as Map<string, number>
  cases.set(CASES_DES_TOTAUX.dontTva, arrondirALEuro(bilan.renvois.dontTva))
  cases.set(CASES_DES_TOTAUX.dontComptesCourantsDebiteurs, arrondirALEuro(bilan.renvois.dontComptesCourantsDebiteurs))
  return { etat: 'rempli', cases }
}

// ── Les contrôles de cohérence (§ 3.6) ───────────────────────────────────────────────────────────────────────────

export type CodeControle2033 =
  | 'resultat-au-bilan' | 'immobilisations-au-bilan' | 'amortissements-au-bilan' | 'provisions-au-bilan'
  | 'provisions-incoherentes' | 'biens-hors-tableau' | 'comptes-a-classer'

export interface Controle2033 {
  code: CodeControle2033
  /** Le numéro du contrôle au § 3.6 de la conception. */
  numero: number
  texte: string
  /** En centimes : ce que le premier membre a de plus que le second. */
  ecart: number
}

export interface EntreesDesControles {
  bilan: BilanEtabli
  compteDeResultat: CompteDeResultatEtabli
  tableauC: Tableau2033C
  tableauD: Tableau2033D
}

// Les colonnes du 2033-A qu'un tableau doit retrouver : la rubrique du bilan d'une ligne du cadre I, et ses comptes 28
// seuls pour le cadre II (la colonne 2 du 2033-A porte aussi les dépréciations, 29, que le 2033-D relève).
const RUBRIQUE_DU_BILAN: Readonly<Record<RubriqueImmobilisation2033C, 'fonds-commercial' | 'autres-incorporelles' | 'corporelles' | 'financieres'>> = {
  'fonds-commercial': 'fonds-commercial', 'autres-incorporelles': 'autres-incorporelles', terrains: 'corporelles',
  constructions: 'corporelles', 'installations-techniques': 'corporelles', 'installations-generales': 'corporelles',
  'materiel-de-transport': 'corporelles', 'autres-corporelles': 'corporelles', financieres: 'financieres',
}
const LIBELLE_DU_BILAN = {
  'fonds-commercial': 'fonds commercial (case 010)', 'autres-incorporelles': 'autres immobilisations incorporelles (case 014)',
  corporelles: 'immobilisations corporelles (case 028)', financieres: 'immobilisations financières (case 040)',
} as const

/**
 * Les contrôles du § 3.6 que LIA1 sait faire, chacun au centime ; la liste ne porte que ceux qui ÉCHOUENT, et chacun
 * retient la validation. Restent à LIA2 le contrôle 2 (les stocks du 2033-A contre les stocks saisis) et à LIA3 les
 * contrôles 5 à 7 (le résultat fiscal, les déficits, l'impôt) ; 312 et 314 se tirent de 310 par construction.
 */
export function controlesDeLaLiasse(e: EntreesDesControles): Controle2033[] {
  const echecs: Controle2033[] = []
  const { bilan, compteDeResultat: cr, tableauC, tableauD } = e

  // 1. 310 = le résultat du 2033-A (case 136). Un écart vient des comptes à classer, et d'eux seuls.
  const ecart310 = cr.totaux['310'] - bilan.resultat
  if (ecart310 !== 0) {
    echecs.push({
      code: 'resultat-au-bilan', numero: 1, ecart: ecart310,
      texte: `Le résultat du 2033-B (case 310, ${euros(cr.totaux['310'])}) n’est pas celui du bilan (case 136, `
        + `${euros(bilan.resultat)}) : ${euros(ecart310)} d’écart, que portent les comptes hors des cases du compte de résultat.`,
    })
  }

  // 3. Le cadre I (fin) et le cadre II (fin) du 2033-C contre les colonnes brute et amortissements du 2033-A.
  const brutC = new Map<string, number>()
  const amortiC = new Map<string, number>()
  for (const l of LIGNES_2033C) {
    const r = RUBRIQUE_DU_BILAN[l.rubrique]
    brutC.set(r, (brutC.get(r) ?? 0) + (tableauC.cases.get(l.immobilisations.fin) ?? 0))
    if (l.amortissements) amortiC.set(r, (amortiC.get(r) ?? 0) + (tableauC.cases.get(l.amortissements.fin) ?? 0))
  }
  for (const r of ['fonds-commercial', 'autres-incorporelles', 'corporelles', 'financieres'] as const) {
    const rubrique = bilan.actif.find((a) => a.id === r)!
    const ecartBrut = (brutC.get(r) ?? 0) - rubrique.brut
    if (ecartBrut !== 0) {
      echecs.push({
        code: 'immobilisations-au-bilan', numero: 3, ecart: ecartBrut,
        texte: `Le registre porte ${euros(brutC.get(r) ?? 0)} de ${LIBELLE_DU_BILAN[r]} à la clôture, le bilan `
          + `${euros(rubrique.brut)} : un bien manque au registre, ou une écriture au bilan.`,
      })
    }
    const amortiBilan = rubrique.contributions.filter((c) => c.colonne === 'amortissements' && c.compte.startsWith('28'))
      .reduce((t, c) => t + c.centimes, 0)
    const ecartAmorti = (amortiC.get(r) ?? 0) - amortiBilan
    if (ecartAmorti !== 0) {
      echecs.push({
        code: 'amortissements-au-bilan', numero: 3, ecart: ecartAmorti,
        texte: `Les amortissements du registre font ${euros(amortiC.get(r) ?? 0)} en ${LIBELLE_DU_BILAN[r]}, les comptes 28 `
          + `du bilan ${euros(amortiBilan)} : une dotation n’est pas écrite, ou une reprise d’ouverture diffère du registre.`,
      })
    }
  }
  if (tableauC.biensHorsTableau.length > 0) {
    echecs.push({
      code: 'biens-hors-tableau', numero: 3, ecart: 0,
      texte: `${tableauC.biensHorsTableau.length > 1 ? `${tableauC.biensHorsTableau.length} biens du registre n’ont` : 'Un bien du registre n’a'} `
        + `pas de ligne au 2033-C : ${tableauC.biensHorsTableau.map((b) => `${b.libelle} (${b.raison})`).join(' ; ')}`,
    })
  }

  // 4. 686, les provisions et dépréciations à la fin, contre celles du 2033-A : provisions réglementées (14) et pour
  //    risques et charges (15) au passif, dépréciations (29, 39, 49, 59) en colonne 2 de l'actif — leurs soldes créditeurs.
  const provisionsBilan = bilan.soldes.filter((s) => /^(14|15|29|39|49|59)/.test(s.compte)).reduce((t, s) => t - s.centimes, 0)
  const fin686 = tableauD.cases.get('686') ?? 0
  if (fin686 !== provisionsBilan) {
    echecs.push({
      code: 'provisions-au-bilan', numero: 4, ecart: fin686 - provisionsBilan,
      texte: `Le relevé des provisions (2033-D, case 686) porte ${euros(fin686)} à la clôture, le bilan `
        + `${euros(provisionsBilan)} (comptes 14, 15, 29, 39, 49 et 59).`,
    })
  }
  for (const i of tableauD.incoherences) {
    echecs.push({ code: 'provisions-incoherentes', numero: 4, ecart: 0, texte: i.texte })
  }

  // 8. Aucun compte des classes 6 et 7 hors des cases du 2033-B.
  if (cr.aClasser.length > 0) {
    echecs.push({
      code: 'comptes-a-classer', numero: 8, ecart: cr.resultatAClasser,
      texte: `À classer avant la validation : ${cr.aClasser.map((a) => `${a.compte} (${a.raison})`).join(' ; ')}`,
    })
  }
  return echecs
}
