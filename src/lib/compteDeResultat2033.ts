import type { BilanDeLExercice } from './bilan'
import type { ModeleComptable } from './engagement'
import { formatMoney } from './format'

// LE COMPTE DE RÉSULTAT DU 2033-B-SD, CADRE A — ligne 37 de la feuille de route, lot LIA1 (docs/conceptions/37-liasse-2033.md,
// § 3.1). Un module PUR : aucune base, aucun écran, aucun drapeau. La liasse d'un dossier en ENGAGEMENT se lit dans ses
// SOLDES, comme le 2033-A (lib/bilan.ts) : les écritures SONT la comptabilité d'engagement, et c'est sur elles (le FEC) que
// l'administration contrôle la liasse. Les soldes lus ici sont ceux du bilan établi (`bilan.soldes`, débit − crédit en
// centimes), donc ceux que la révision justifie : deux calculs du même solde finiraient par diverger sans que rien le dise.
//
// LES SOURCES, lues comme données le 12/11/2026 :
//   [F] le formulaire 2033-SD 2026, tableaux 2033-A-SD à 2033-G-SD (cerfa n° 15948*08), impots.gouv.fr,
//       /sites/default/files/formulaires/2033-sd/2026/2033-sd_5394.pdf, SHA-256 ce4c5190…fb177b6cb : les CODES des cases et
//       leurs libellés, relevés sur la page du 2033-B-SD ;
//   [N] sa notice 2033-NOT-SD 2026 (n° 50448#28), /sites/default/files/formulaires/2033-sd/2026/2033-sd_5395.pdf, SHA-256
//       b0a43522…9081c7a6d1 : ce que chaque case porte (210 « ne concerne que les produits provenant de reventes en
//       l'état » ; 214 les biens produits ou transformés ; 218 les services, « y compris les produits des activités
//       annexes » ; 222 la variation de la production stockée « y compris en cas de variation négative » ; 236 et 240
//       la variation, « la diminution du niveau du stock vient en augmentation des charges » ; 306 « ne concerne que les
//       personnes morales soumises à l'impôt sur les sociétés ») et la règle des arrondis (§ « Les arrondis fiscaux ») ;
//   [P] le plan comptable général, règlement ANC n° 2014-03 consolidé au 1er janvier 2026 (règlement n° 2022-06), pour
//       les NUMÉROS des comptes — la notice [N] ne donne aucune table de passage des comptes aux cases du 2033-B.
//
// LA TABLE DE PASSAGE (`regleDuCompteDeResultat`) range chaque compte des classes 6 et 7 au préfixe le plus long, comme le
// bilan. La notice dit ce que la case porte, le PCG ce que le compte enregistre : leur rencontre est une LECTURE, que seul
// le contre-calcul d'un expert-comptable éprouvera (LIA-Q14) — un compte rangé à la mauvaise case donne une liasse fausse
// ET équilibrée. Deux rattachements que ni [N] ni [P] ne tranchent sont des paramètres OBLIGATOIRES, sans défaut
// (`RattachementsAJuger`, question LIA1-Q1 au cabinet) : la dotation aux provisions d'exploitation (6815), entre 256
// « Dotations aux dépréciations » (libellé du millésime 2026) et 262 « Autres charges » ; la reprise d'exploitation (781),
// en 230 « Autres produits », le 2033-B n'ayant aucune ligne de reprises. Un compte qu'aucune case ne nomme — un 603 ou un
// 709 sans sa subdivision, qui ne dit pas quel stock ni quelle vente, un 79 que le PCG de 2026 a supprimé, un 691 — est
// « À CLASSER » : présenté, compté à part, et il retient la validation (contrôle 8 du § 3.6). Rien n'est deviné.
//
// L'IMPOSITION (IR ou IS) EST UN PARAMÈTRE OBLIGATOIRE : LIA-Q1 n'est pas tranchée (une table par exercice est recommandée),
// et la forme juridique ne la dit pas. À l'IR, un compte d'impôt sur les bénéfices (695 à 699) est à classer : la case 306
// ne concerne que l'IS [N].
//
// LE BNC EN TRÉSORERIE N'EST JAMAIS TOUCHÉ (§ 3.5) : en trésorerie, le compte de résultat ne s'établit pas, et le motif le
// dit ; la 2035 se calcule ailleurs, depuis ses sources (lib/declaration2035.ts).
//
// LES MONTANTS SONT EN CENTIMES ENTIERS, ET L'ARRONDI À L'EURO NE SE FAIT QU'À LA CASE (`formulaireALEuro`) : « les
// tableaux fiscaux doivent reprendre les montants des comptes annuels (y compris les totalisations) sans mention des
// centimes » ; « la fraction d'euro égale à 0,50 est comptée pour 1 » [N]. Comme la 2035 (`arrondirPourFormulaire`,
// lib/cases2035.ts), chaque case ALIMENTÉE s'arrondit seule, puis les TOTAUX se recalculent sur les valeurs arrondies, par
// les MÊMES formules qu'au centime : un formulaire dont les colonnes ne s'additionnent pas se fait renvoyer. Un montant
// négatif s'arrondit comme sa valeur absolue (−0,50 € compte pour −1 €). Les contrôles, eux, se jugent au centime.

// ── Les cases du cadre A ──────────────────────────────────────────────────────────────────────────────────────────

/** Les cases du 2033-B-SD, cadre A, que les comptes alimentent [F]. */
export type CaseAlimentee2033B =
  | '210' | '214' | '218' | '222' | '224' | '226' | '230'
  | '234' | '236' | '238' | '240' | '242' | '244' | '250' | '252' | '254' | '256' | '262'
  | '280' | '290' | '294' | '300' | '306'

/** Les cases calculées du cadre A, et le report au cadre B (312 bénéfice, 314 déficit) [F]. */
export type CaseCalculee2033B = '232' | '264' | '270' | '310' | '312' | '314'

export interface DefinitionCase2033B {
  code: CaseAlimentee2033B
  libelle: string
  /** Un produit se lit crédit − débit, une charge débit − crédit. */
  nature: 'produit' | 'charge'
  /** Le formulaire la porte signée (une variation de stock, la production stockée, l'impôt diminué d'une créance). */
  signee: boolean
}

export const CASES_ALIMENTEES_2033B: readonly DefinitionCase2033B[] = [
  { code: '210', libelle: 'Ventes de marchandises', nature: 'produit', signee: false },
  { code: '214', libelle: 'Production vendue — biens', nature: 'produit', signee: false },
  { code: '218', libelle: 'Production vendue — services', nature: 'produit', signee: false },
  { code: '222', libelle: 'Production stockée', nature: 'produit', signee: true },
  { code: '224', libelle: 'Production immobilisée', nature: 'produit', signee: false },
  { code: '226', libelle: 'Subventions d’exploitation reçues', nature: 'produit', signee: false },
  { code: '230', libelle: 'Autres produits', nature: 'produit', signee: false },
  { code: '234', libelle: 'Achats de marchandises', nature: 'charge', signee: false },
  { code: '236', libelle: 'Variation de stock (marchandises)', nature: 'charge', signee: true },
  { code: '238', libelle: 'Achats de matières premières et autres approvisionnements', nature: 'charge', signee: false },
  { code: '240', libelle: 'Variation de stock (matières premières et approvisionnements)', nature: 'charge', signee: true },
  { code: '242', libelle: 'Autres charges externes', nature: 'charge', signee: false },
  { code: '244', libelle: 'Impôts, taxes et versements assimilés', nature: 'charge', signee: false },
  { code: '250', libelle: 'Rémunérations du personnel', nature: 'charge', signee: false },
  { code: '252', libelle: 'Cotisations sociales', nature: 'charge', signee: false },
  { code: '254', libelle: 'Dotations aux amortissements', nature: 'charge', signee: false },
  { code: '256', libelle: 'Dotations aux dépréciations', nature: 'charge', signee: false },
  { code: '262', libelle: 'Autres charges', nature: 'charge', signee: false },
  { code: '280', libelle: 'Produits financiers', nature: 'produit', signee: false },
  { code: '290', libelle: 'Produits exceptionnels', nature: 'produit', signee: false },
  { code: '294', libelle: 'Charges financières', nature: 'charge', signee: false },
  { code: '300', libelle: 'Charges exceptionnelles', nature: 'charge', signee: false },
  { code: '306', libelle: 'Impôt sur les bénéfices', nature: 'charge', signee: true },
]

// Les « dont » du cadre A : aucun compte ne les dit (l'export, la CFE et la CVAE MISES EN RECOUVREMENT l'année précédente
// [N, case 243], un amortissement du fonds de commerce au sens de l'art. 39, 1-2°, al. 3 du CGI…). Ils se SAISIRONT
// (`saisies_2033`, LIA4) ; jusque-là, ils sont « à saisir », jamais zéro.
export const CASES_DONT_2033B: readonly { code: string; porteuse: CaseAlimentee2033B; libelle: string }[] = [
  { code: '209', porteuse: '210', libelle: 'dont export et livraisons intracommunautaires (marchandises)' },
  { code: '215', porteuse: '214', libelle: 'dont export et livraisons intracommunautaires (biens)' },
  { code: '217', porteuse: '218', libelle: 'dont export et livraisons intracommunautaires (services)' },
  { code: '243', porteuse: '244', libelle: 'dont CFE et CVAE' },
  { code: '380', porteuse: '252', libelle: 'dont cotisation personnelle de l’exploitant' },
  { code: '255', porteuse: '254', libelle: 'dont amortissement du fonds de commerce (art. 39, 1-2°, al. 3 du CGI)' },
  { code: '259', porteuse: '262', libelle: 'dont provisions fiscales pour implantations commerciales à l’étranger' },
  { code: '260', porteuse: '262', libelle: 'dont cotisations versées aux organisations syndicales et professionnelles' },
  { code: '347', porteuse: '300', libelle: 'dont amortissements des souscriptions dans des PME innovantes (art. 217 octies)' },
  { code: '348', porteuse: '300', libelle: 'dont amortissements exceptionnels de 25 % des constructions nouvelles (art. 39 quinquies D)' },
]

// ── Les formules, au centime comme à l'euro ──────────────────────────────────────────────────────────────────────

/** Une case calculée : la somme signée d'autres cases, dans l'ordre où les formules s'appliquent. */
export type Formule = readonly [code: string, termes: readonly (readonly [signe: 1 | -1, code: string])[]]

const plus = (...codes: string[]) => codes.map((c) => [1, c] as const)
const moins = (...codes: string[]) => codes.map((c) => [-1, c] as const)

/** Les totaux du cadre A [F] : « Produits (I + III + IV) – Charges (II + V + VI + VII) ». */
export const FORMULES_2033B: readonly Formule[] = [
  ['232', plus('210', '214', '218', '222', '224', '226', '230')],
  ['264', plus('234', '236', '238', '240', '242', '244', '250', '252', '254', '256', '262')],
  ['270', [...plus('232'), ...moins('264')]],
  ['310', [...plus('232', '280', '290'), ...moins('264', '294', '300', '306')]],
]

/**
 * Applique des formules aux cases alimentées. Une case absente ou nulle (« à saisir ») rend NUL tout total qui la compte :
 * un total sur une case inconnue serait un chiffre faux, jamais zéro.
 */
export function appliquerLesFormules(
  alimentees: ReadonlyMap<string, number | null>,
  formules: readonly Formule[],
): Map<string, number | null> {
  const valeurs = new Map<string, number | null>(alimentees)
  for (const [code, termes] of formules) {
    let total: number | null = 0
    for (const [signe, terme] of termes) {
      const v = valeurs.get(terme)
      if (v === undefined || v === null) { total = null; break }
      total += signe * v
    }
    valeurs.set(code, total)
  }
  return valeurs
}

/** L'arrondi fiscal à l'euro le plus proche, 0,50 € compté pour 1 [N], un négatif comme sa valeur absolue. Centimes → euros. */
export function arrondirALEuro(centimes: number): number {
  if (!Number.isInteger(centimes)) throw new Error(`Montant hors centimes entiers : ${centimes}`)
  const euros = Math.floor((Math.abs(centimes) + 50) / 100)
  return centimes < 0 && euros !== 0 ? -euros : euros
}

/**
 * Les cases d'un tableau telles que le formulaire les porte, en euros : chaque case alimentée arrondie seule, puis les
 * totaux RECALCULÉS sur les valeurs arrondies, par les mêmes formules. Une case à saisir reste nulle.
 */
export function formulaireALEuro(
  alimentees: ReadonlyMap<string, number | null>,
  formules: readonly Formule[],
): Map<string, number | null> {
  const arrondies = new Map<string, number | null>()
  for (const [code, v] of alimentees) arrondies.set(code, v === null ? null : arrondirALEuro(v))
  return appliquerLesFormules(arrondies, formules)
}

// ── Le passage des comptes aux cases ─────────────────────────────────────────────────────────────────────────────

/** Les rattachements que ni la notice ni le PCG ne tranchent (LIA1-Q1) : un choix du cabinet, jamais un défaut. */
export interface RattachementsAJuger {
  /** 6815, dotations aux provisions d'exploitation (risques et charges). */
  dotationsAuxProvisionsDExploitation: '256' | '262' | 'a-classer'
  /** 781, reprises sur amortissements, dépréciations et provisions d'exploitation. */
  reprisesDExploitation: '230' | 'a-classer'
}

export type Imposition = 'ir' | 'is'

export type RegleDuCompteDeResultat = { case: CaseAlimentee2033B } | { aClasser: string }

export const RAISON_COMPTE_DE_RESULTAT_INCONNU = 'Aucune case du 2033-B ne nomme ce compte : à classer par le cabinet.'
const RAISON_IMPOT_A_L_IR = 'Impôt sur les bénéfices dans une entreprise à l’impôt sur le revenu : la case 306 « ne concerne '
  + 'que les personnes morales soumises à l’impôt sur les sociétés » (notice 2033-NOT-SD).'
const RAISON_ATTENTE_DU_CABINET = 'Rattachement que ni la notice du 2033-B ni le plan comptable ne tranchent : il attend le '
  + 'choix du cabinet.'

const vers = (code: CaseAlimentee2033B): RegleDuCompteDeResultat => ({ case: code })
const aClasser = (raison: string): RegleDuCompteDeResultat => ({ aClasser: raison })

// La table, par préfixe : le plus long l'emporte (6037 avant 603, 6097 avant 609). Les comptes de [P] ; les cases de [F].
const TABLE: ReadonlyMap<string, RegleDuCompteDeResultat> = new Map([
  // Classe 6 — charges.
  ['601', vers('238')], ['602', vers('238')],
  ['603', aClasser('Variation des stocks sans sa subdivision : le compte ne dit pas si le stock est de marchandises (236) ou de matières (240).')],
  ['6031', vers('240')], ['6032', vers('240')], ['6037', vers('236')],
  ['604', vers('242')], ['605', vers('242')], ['606', vers('242')],
  ['607', vers('234')],
  ['608', aClasser('Frais accessoires d’achat : ils se rangent avec l’achat qu’ils grèvent, que le compte ne dit pas.')],
  ['609', aClasser('Rabais, remises et ristournes obtenus sans leur subdivision : le compte ne dit pas quel achat ils réduisent.')],
  ['6091', vers('238')], ['6092', vers('238')],
  ['6094', vers('242')], ['6095', vers('242')], ['6096', vers('242')],
  ['6097', vers('234')],
  ['6098', aClasser('Rabais, remises et ristournes non affectés : le compte ne dit pas quel achat ils réduisent.')],
  ['61', vers('242')], ['62', vers('242')],
  ['63', vers('244')],
  ['641', vers('250')], ['644', vers('250')], ['648', vers('250')],
  ['645', vers('252')], ['646', vers('252')], ['647', vers('252')],
  ['65', vers('262')],
  ['66', vers('294')],
  ['67', vers('300')],
  ['6811', vers('254')], ['6812', vers('254')],
  ['6816', vers('256')], ['6817', vers('256')],
  ['686', vers('294')],
  ['687', vers('300')],
  ['691', aClasser('Participation des salariés : aucune case du cadre A du 2033-B ne la nomme.')],
  ['695', vers('306')], ['696', vers('306')], ['697', vers('306')], ['698', vers('306')], ['699', vers('306')],
  // Classe 7 — produits.
  ['701', vers('214')], ['702', vers('214')], ['703', vers('214')],
  ['704', vers('218')], ['705', vers('218')], ['706', vers('218')], ['708', vers('218')],
  ['707', vers('210')],
  ['709', aClasser('Rabais, remises et ristournes accordés sans leur subdivision : le compte ne dit pas quelle vente ils réduisent.')],
  ['7091', vers('214')], ['7092', vers('214')], ['7093', vers('214')],
  ['7094', vers('218')], ['7095', vers('218')], ['7096', vers('218')],
  ['7097', vers('210')],
  ['7098', aClasser('Rabais, remises et ristournes non affectés : le compte ne dit pas quelle vente ils réduisent.')],
  ['713', vers('222')],
  ['72', vers('224')],
  ['74', vers('226')],
  ['75', vers('230')],
  ['76', vers('280')],
  ['77', vers('290')],
  ['786', vers('280')],
  ['787', vers('290')],
  ['79', aClasser('Transfert de charges : « le règlement n° 2022-06 de l’ANC a supprimé la technique des transferts de charges » '
    + '(notice 2033-NOT-SD, case 105) ; ces frais se comptabilisent dans les comptes de leur nature.')],
])

/** Le passage d'un compte des classes 6 et 7 à sa case du 2033-B-SD, cadre A, ou « à classer » avec sa raison. */
export function regleDuCompteDeResultat(
  compte: string,
  imposition: Imposition,
  rattachements: RattachementsAJuger,
): RegleDuCompteDeResultat {
  if (/^69[5-9]/.test(compte) && imposition === 'ir') return aClasser(RAISON_IMPOT_A_L_IR)
  if (compte.startsWith('6815')) {
    const r = rattachements.dotationsAuxProvisionsDExploitation
    return r === 'a-classer' ? aClasser(RAISON_ATTENTE_DU_CABINET) : vers(r)
  }
  if (compte.startsWith('781')) {
    const r = rattachements.reprisesDExploitation
    return r === 'a-classer' ? aClasser(RAISON_ATTENTE_DU_CABINET) : vers(r)
  }
  for (let longueur = Math.min(compte.length, 4); longueur >= 2; longueur--) {
    const regle = TABLE.get(compte.slice(0, longueur))
    if (regle) return regle
  }
  return aClasser(RAISON_COMPTE_DE_RESULTAT_INCONNU)
}

// ── Le compte de résultat ────────────────────────────────────────────────────────────────────────────────────────

export interface EntreesDuCompteDeResultat {
  /** Le bilan de l'exercice (lib/bilan.ts) : ses soldes et son résultat. Non établi, le compte de résultat ne l'est pas. */
  bilan: BilanDeLExercice
  mode: ModeleComptable['mode']
  imposition: Imposition
  rattachements: RattachementsAJuger
}

/** Un compte et sa part dans une case, dans le sens de la case (produit : crédit − débit ; charge : débit − crédit). */
export interface ContributionAuCompteDeResultat {
  compte: string
  libelle: string
  centimes: number
}

export interface CompteAClasser {
  compte: string
  libelle: string
  /** Débit − crédit, en centimes : le solde tel quel. */
  solde: number
  raison: string
}

export type CodePointDuCompteDeResultat = 'compte-a-classer' | 'case-negative' | 'dont-a-saisir' | 'provisoire'

export interface PointDuCompteDeResultat {
  code: CodePointDuCompteDeResultat
  /** Une erreur retient la validation ; une attention se dit. */
  severite: 'erreur' | 'attention'
  texte: string
}

export interface PropositionDUnDont {
  code: string
  centimes: number
  comptes: string[]
  texte: string
}

export type CompteDeResultat2033 =
  | { etat: 'non-etabli'; exercice: number; motif: { code: 'tresorerie' | 'bilan-non-etabli'; texte: string } }
  | {
    etat: 'etabli'
    exercice: number
    imposition: Imposition
    provisoire: boolean
    /** Chaque case alimentée, en centimes, avec les comptes qui la font. */
    cases: Record<CaseAlimentee2033B, { centimes: number; contributions: ContributionAuCompteDeResultat[] }>
    /** Les cases calculées, en centimes. */
    totaux: Record<CaseCalculee2033B, number>
    aClasser: CompteAClasser[]
    /** Produits − charges des comptes à classer, en centimes : ce qui sépare 310 du résultat du bilan. */
    resultatAClasser: number
    /** Les « dont » à saisir (LIA4) ; une proposition ne s'écrit jamais seule (LIA-Q4). */
    dontASaisir: readonly { code: string; porteuse: CaseAlimentee2033B; libelle: string }[]
    propositions: PropositionDUnDont[]
    /** Les soldes des classes 6 et 7, débit − crédit en centimes, non nuls, dans l'ordre des numéros (pour le 2033-E). */
    soldes: { compte: string; libelle: string; centimes: number }[]
    points: PointDuCompteDeResultat[]
  }

export type CompteDeResultatEtabli = Extract<CompteDeResultat2033, { etat: 'etabli' }>

const formatEuros = (centimes: number) => formatMoney(centimes / 100)

export function compteDeResultat2033(e: EntreesDuCompteDeResultat): CompteDeResultat2033 {
  const exercice = e.bilan.exercice
  if (e.mode !== 'engagement') {
    return {
      etat: 'non-etabli', exercice,
      motif: {
        code: 'tresorerie',
        texte: 'Un dossier en trésorerie dépose la 2035, calculée depuis ses sources : le 2033-B ne le concerne pas.',
      },
    }
  }
  const bilan = e.bilan
  if (bilan.etat !== 'etabli') {
    return {
      etat: 'non-etabli', exercice,
      motif: { code: 'bilan-non-etabli', texte: `Le compte de résultat suit le bilan, qui ne s’établit pas : ${bilan.motif.texte}` },
    }
  }

  const cases = Object.fromEntries(CASES_ALIMENTEES_2033B.map((c) => [c.code, { centimes: 0, contributions: [] as ContributionAuCompteDeResultat[] }])) as
    Record<CaseAlimentee2033B, { centimes: number; contributions: ContributionAuCompteDeResultat[] }>
  const natureDe = new Map(CASES_ALIMENTEES_2033B.map((c) => [c.code, c.nature]))
  const aClasserListe: CompteAClasser[] = []
  let resultatAClasser = 0
  const soldes = bilan.soldes.filter((s) => /^[67]/.test(s.compte) && s.centimes !== 0)

  for (const s of soldes) {
    const regle = regleDuCompteDeResultat(s.compte, e.imposition, e.rattachements)
    if ('aClasser' in regle) {
      aClasserListe.push({ compte: s.compte, libelle: s.libelle, solde: s.centimes, raison: regle.aClasser })
      resultatAClasser -= s.centimes
      continue
    }
    const centimes = natureDe.get(regle.case) === 'produit' ? -s.centimes : s.centimes
    cases[regle.case].centimes += centimes
    cases[regle.case].contributions.push({ compte: s.compte, libelle: s.libelle, centimes })
  }

  const alimentees = new Map<string, number | null>(CASES_ALIMENTEES_2033B.map((c) => [c.code, cases[c.code].centimes]))
  const calculees = appliquerLesFormules(alimentees, FORMULES_2033B)
  const lu = (code: string) => calculees.get(code) as number
  const r310 = lu('310')
  const totaux: Record<CaseCalculee2033B, number> = {
    '232': lu('232'), '264': lu('264'), '270': lu('270'), '310': r310,
    '312': Math.max(r310, 0), '314': Math.max(-r310, 0),
  }

  const points: PointDuCompteDeResultat[] = []
  if (bilan.provisoire) {
    points.push({
      code: 'provisoire', severite: 'attention',
      texte: `L’exercice ${exercice} n’est pas clos : le compte de résultat est arrêté aux écritures passées à ce jour.`,
    })
  }
  if (aClasserListe.length > 0) {
    points.push({
      code: 'compte-a-classer', severite: 'erreur',
      texte: `${aClasserListe.length > 1 ? `${aClasserListe.length} comptes` : 'Un compte'} des classes 6 et 7 `
        + `(${aClasserListe.map((a) => a.compte).join(', ')}) ${aClasserListe.length > 1 ? 'n’entrent' : 'n’entre'} dans aucune `
        + `case du 2033-B : ${formatEuros(resultatAClasser)} de résultat hors des cases, que le cabinet classe avant la validation.`,
    })
  }
  for (const c of CASES_ALIMENTEES_2033B) {
    if (!c.signee && cases[c.code].centimes < 0) {
      points.push({
        code: 'case-negative', severite: 'attention',
        texte: `La case ${c.code} (${c.libelle}) est négative, ${formatEuros(cases[c.code].centimes)} : un rabais ou une `
          + 'régularisation plus forte que ce qu’elle réduit, à vérifier.',
      })
    }
  }
  points.push({
    code: 'dont-a-saisir', severite: 'attention',
    texte: `Les « dont » du cadre A (${CASES_DONT_2033B.map((d) => d.code).join(', ')}) ne se lisent d’aucun compte : `
      + 'ils se saisissent par le cabinet.',
  })

  // La cotisation personnelle de l'exploitant (380) : le 646 la porte (PCG), et la case la veut, « obligatoires et
  // facultatives […] incluant la CSG déductible » [N]. PROPOSÉE, jamais écrite (LIA-Q4) : le compte ne dit pas la CSG.
  const propositions: PropositionDUnDont[] = []
  const exploitant = cases['252'].contributions.filter((c) => c.compte.startsWith('646'))
  if (exploitant.length > 0) {
    propositions.push({
      code: '380', centimes: exploitant.reduce((t, c) => t + c.centimes, 0), comptes: exploitant.map((c) => c.compte),
      texte: 'Proposée depuis les cotisations de l’exploitant (646) : à confirmer par le cabinet, qui sait ce que le compte porte.',
    })
  }

  return {
    etat: 'etabli', exercice, imposition: e.imposition, provisoire: bilan.provisoire, cases, totaux,
    aClasser: aClasserListe, resultatAClasser, dontASaisir: CASES_DONT_2033B, propositions, soldes, points,
  }
}

/** Le cadre A tel que le formulaire le porte, en euros (les cases alimentées arrondies, les totaux recalculés). */
export function compteDeResultatALEuro(cr: CompteDeResultatEtabli): Map<string, number> {
  const alimentees = new Map<string, number | null>(CASES_ALIMENTEES_2033B.map((c) => [c.code, cr.cases[c.code].centimes]))
  const euros = formulaireALEuro(alimentees, FORMULES_2033B) as Map<string, number>
  const r310 = euros.get('310')!
  euros.set('312', Math.max(r310, 0))
  euros.set('314', Math.max(-r310, 0))
  return euros
}
