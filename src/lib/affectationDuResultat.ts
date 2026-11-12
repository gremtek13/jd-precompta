import { categorieJuridique } from './categoriesJuridiques'
import { ajouterJours, ajouterMois, formatDate, formatMoney } from './format'
import { FORME_COMPTE_DE_ROLE, type DefinitionRoleComptable } from './planComptable'
import type { ModeComptable, SensEcriture } from './types'

// L'AFFECTATION DU RÉSULTAT ET L'APPROBATION DES COMPTES, EN MODULE (lignes 33 et 45, lot AFF1 ; conception
// docs/conceptions/45-affectation-et-approbation.md). Pur, en centimes entiers : rien en base, aucun drapeau, aucun écran.
//
// L'affectation est une DÉCISION des associés, jamais un calcul (§ 3.1) : ce module PROPOSE (la réserve légale minimale, le
// bénéfice distribuable, le plafond des dividendes, le reste au report à nouveau), puis JUGE la décision saisie — ses refus,
// dans l'ordre où la base les redira (AFF2, `enregistrer_affectation`), et ses avertissements, jamais bloquants — et COMPOSE
// son écriture : au journal OD, à la date de la décision (AFF-Q2 (A)), une ligne par compte et par sens.
//
// Les textes, relus sur Légifrance le 12/11/2026 (version en vigueur) :
//   - C. com., art. L232-10 (modifié par l'ordonnance n° 2025-229 du 12 mars 2025, art. 62, en vigueur depuis le
//     1er octobre 2025) : « Dans les sociétés à responsabilité limitée et les sociétés par actions, il est fait sur le
//     bénéfice de l'exercice, diminué, le cas échéant, des pertes antérieures, un prélèvement d'un vingtième au moins
//     affecté à la formation d'un fonds de réserve dit "réserve légale". Toute décision contraire est nulle. […] Ce
//     prélèvement cesse d'être obligatoire, lorsque la réserve atteint le dixième du capital social. »
//   - C. com., art. L232-11 (loi n° 2003-7 du 3 janvier 2003) : al. 1, le bénéfice distribuable est « le bénéfice de
//     l'exercice, diminué des pertes antérieures, ainsi que des sommes à porter en réserve en application de la loi ou des
//     statuts, et augmenté du report bénéficiaire » ; al. 2, la distribution de réserves « dont [l'assemblée] a la
//     disposition », la décision indiquant « expressément les postes de réserve », et « les dividendes sont prélevés par
//     priorité sur le bénéfice distribuable de l'exercice » ; al. 3, « aucune distribution » quand les capitaux propres
//     « sont ou deviendraient » inférieurs au capital « augmenté des réserves que la loi ou les statuts ne permettent pas de
//     distribuer » ; al. 4, « L'écart de réévaluation n'est pas distribuable ».
//   - C. com., art. L232-12 : al. 1, « Après approbation des comptes annuels et constatation de l'existence de sommes
//     distribuables », l'assemblée détermine les dividendes ; al. 3, « Tout dividende distribué en violation des règles
//     ci-dessus énoncées est un dividende fictif » (délit des dirigeants : L241-3, 2° ; L242-6, 1°) — d'où le REFUS (AFF-Q4).
//   - C. com., art. L232-13 : al. 2, la mise en paiement « dans un délai maximal de neuf mois après la clôture », al. 3
//     prorogeable par décision de justice — d'où un AVERTISSEMENT, jamais un refus.
//   Non relus ici (la conception les cite, § 2 et § 10) : L223-26 et L225-100 (les six mois, avertissement seulement),
//   L223-42 et L225-248 (la moitié du capital, avertissement seulement).
//
// L'ARRONDI DE LA RÉSERVE LÉGALE : au centime SUPÉRIEUR. « Un vingtième AU MOINS » est un plancher : le plus petit montant
// en centimes qui l'atteint est le plafond entier du vingtième exact ; arrondi au centime inférieur, la dotation serait
// sous le vingtième d'une fraction de centime, donc contraire au texte. De même, la réserve « atteint le dixième » du
// capital quand elle en vaut au moins le dixième exact : ce qui reste à doter jusque-là s'arrondit au centime supérieur.
// (À confirmer par l'expert-comptable, conception § 10.)
//
// Les comptes viennent du plan du dossier, passés en paramètre (`ComptesDeLAffectation`) : aucun compte de rôle en dur
// (comptesEnDur.test.ts). Les sept rôles neufs (1061, 1063, 1068, 110, 119, 457, 1209) entreront au catalogue à AFF2.
//
// La trésorerie (BNC, 2035) et l'entreprise individuelle ne passent jamais ici : refusées en premier (§ 3.9).

// ── Les noms ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** D'où vient une somme affectée (les noms de `lignes_d_affectation.origine`, conception § 4.2). */
export type OrigineDAffectation = 'benefice' | 'perte' | 'report_crediteur' | 'autres_reserves' | 'reserves_statutaires'

/** Où elle va (les noms de `lignes_d_affectation.destination`). Pour une PERTE, le compte sur lequel elle s'impute. */
export type DestinationDAffectation =
  | 'reserve_legale' | 'reserves_statutaires' | 'autres_reserves' | 'report_crediteur' | 'report_debiteur' | 'dividendes'

export type OrganeDeLaDecision = 'assemblee' | 'consultation_ecrite' | 'acte_unanime' | 'associe_unique'

export interface LigneDAffectation {
  origine: OrigineDAffectation
  destination: DestinationDAffectation
  /** Positif, en centimes entiers. */
  centimes: number
}

/**
 * Les couples admis (conception § 3.3 ; AFF-Q7 (A) pour la perte). Ni la réserve légale (1061) ni les réserves
 * réglementées (1064) ne sont jamais une origine ; le capital ne bouge pas ici (décisions extraordinaires, § 9).
 */
export const COUPLES_ADMIS: Readonly<Record<OrigineDAffectation, readonly DestinationDAffectation[]>> = {
  benefice: ['reserve_legale', 'reserves_statutaires', 'autres_reserves', 'report_crediteur', 'report_debiteur', 'dividendes'],
  perte: ['report_debiteur', 'reserves_statutaires', 'autres_reserves', 'report_crediteur'],
  report_crediteur: ['dividendes', 'autres_reserves'],
  autres_reserves: ['dividendes'],
  reserves_statutaires: ['dividendes'],
}

/** Les comptes du plan du dossier qu'une affectation écrit (rôles de la conception § 4.4). Aucun défaut : l'appelant les lit. */
export interface ComptesDeLAffectation {
  resultat_benefice: string
  resultat_perte: string
  reserve_legale: string
  reserves_statutaires: string
  autres_reserves: string
  report_a_nouveau_crediteur: string
  report_a_nouveau_debiteur: string
  dividendes_a_payer: string
}

/**
 * Les soldes des capitaux propres À LA DATE DE LA DÉCISION, avant l'affectation, en centimes entiers ; ceux de l'exercice
 * affecté tels que le bilan de clôture les présente (avant répartition), plus ce que l'exercice de la décision y a écrit
 * avant elle. Le résultat à affecter n'en est pas : il se lit à part (`resultatCentimes`).
 */
export interface SoldesAvantAffectation {
  /** Racine 101 (le 109 non appelé compris), au crédit. */
  capitalAuxComptes: number
  /** Racine 104, au crédit. */
  primes: number
  /** Racine 105, au crédit : jamais distribuable (L232-11, al. 4). */
  ecartsDeReevaluation: number
  /** 1061, au crédit. */
  reserveLegale: number
  /** 1062, au crédit : indisponibles. */
  reservesIndisponibles: number
  /** 1063, au crédit. */
  reservesStatutaires: number
  /** 1064, au crédit : jamais distribuables. */
  reservesReglementees: number
  /** 1068 (et le 106 non ventilé), au crédit. */
  autresReserves: number
  /** 110, au crédit, positif ou nul. */
  reportCrediteur: number
  /** 119, son solde DÉBITEUR, positif ou nul : les pertes antérieures (L232-10, L232-11). */
  pertesAnterieures: number
  /** 1209, son solde DÉBITEUR, positif ou nul : les acomptes sur dividendes, que ce premier temps n'impute pas (AFF-Q8). */
  acomptesSurDividendes: number
}

export interface DossierDeLAffectation {
  modeComptable: ModeComptable
  /** Le compte du dirigeant est le 108 (`exploitantIndividuel`, lib/reportDesSoldes.ts). */
  exploitantIndividuel: boolean
  /** `dossiers.forme_juridique`, code de l'INSEE au niveau III (AFF-Q5 (A)). */
  formeJuridique: string | null
  /** `dossiers.capital`, en centimes (AFF-Q5 (A)). */
  capitalCentimes: number | null
  /**
   * Ce que disent les statuts des réserves statutaires (1063) : distribuables, ou non. Aucun défaut — l'application ne lit
   * pas les statuts (AFF1-Q1). Non distribuables, elles entrent au plancher de L232-11, al. 3, et ne s'affectent pas aux
   * dividendes.
   */
  reservesStatutairesDistribuables: boolean
}

export interface DecisionSaisie {
  exerciceAffecte: number
  organe: OrganeDeLaDecision
  nombreDAssocies: 'un' | 'plusieurs'
  /** Date civile (AAAA-MM-JJ), sans fuseau. */
  dateDecision: string
  /** L'issue de l'approbation (AFF-Q1 (A)) : non approuvés, ni affectation ni écriture. */
  comptesApprouves: boolean
  /** Date civile, ou nulle (L232-13 : à défaut, les dirigeants la fixent). */
  dateMiseEnPaiement: string | null
  lignes: readonly LigneDAffectation[]
}

export interface ContexteDeLAffectation {
  dossier: DossierDeLAffectation
  /** Le résultat de l'exercice affecté, LU (exercice validé ou balance reprise) : positif un bénéfice, négatif une perte. */
  resultatCentimes: number
  soldes: SoldesAvantAffectation
  comptes: ComptesDeLAffectation
  /** Le jour de Paris (`aujourdHuiAParis()`), passé par l'appelant : jamais lu au chargement du module. */
  aujourdHui: string
  /** L'exercice qui contient la date de la décision est-il validé ? (la décision et son écriture s'y figeraient) */
  exerciceDeLaDecisionValide: boolean
}

// ── Les refus et les avertissements, et leurs mots ─────────────────────────────────────────────────────────────────────

export type CodeDeRefus =
  | 'montant-illisible' | 'comptes-illisibles'
  | 'tresorerie' | 'entreprise-individuelle' | 'forme-absente' | 'forme-hors-champ' | 'capital-absent'
  | 'acomptes-sur-dividendes'
  | 'exercice-illisible' | 'date-illisible' | 'date-avant-cloture' | 'date-future' | 'exercice-de-la-decision-valide'
  | 'organe-et-associes'
  | 'non-approuves-avec-lignes'
  | 'couple-non-admis' | 'reserves-statutaires-indisponibles' | 'sens-du-resultat' | 'resultat-pas-en-entier'
  | 'prelevement-au-dela-du-solde' | 'apurement-au-dela-des-pertes'
  | 'reserve-legale-insuffisante'
  | 'dividendes-au-dela-du-distribuable' | 'reserves-avant-le-benefice' | 'capitaux-propres-sous-le-plancher'
  | 'paiement-avant-la-decision' | 'paiement-sans-dividende'

export type CodeDAvertissement =
  | 'approbation-tardive' | 'paiement-tardif' | 'paiement-non-date' | 'capital-different-du-101'
  | 'capitaux-propres-sous-la-moitie'

export interface Refus { code: CodeDeRefus; message: string }
export interface Avertissement { code: CodeDAvertissement; message: string }

const euros = (centimes: number): string => formatMoney(centimes / 100)

// ── La forme juridique ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Le régime d'une forme : `soumise` au minimum de la réserve légale (L232-10 : les SARL et les sociétés par actions —
 * SA, SAS, SASU, SCA, et la société européenne, société par actions), `libre` (une autre société commerciale — SNC, SCS,
 * SLP — ou une société civile, qui affecte librement), ou `hors_champ` (l'entrepreneur individuel, et ce qui n'est pas une
 * société : GIE, caisses, mutuelles, coopératives agricoles et bancaires, que cette ligne ne couvre pas).
 */
export type RegimeDeLaForme = 'soumise' | 'libre' | 'hors_champ'

const SOCIETES_EN_COMMANDITE_PAR_ACTIONS: ReadonlySet<string> = new Set(['5308', '5309', '5370', '5385'])

export function regimeDeLaForme(code: string): RegimeDeLaForme {
  if (categorieJuridique(code) === null) return 'hors_champ'
  if (/^5[4-7]/.test(code) || code === '5800' || SOCIETES_EN_COMMANDITE_PAR_ACTIONS.has(code)) return 'soumise'
  // 52 (SNC), 53 hors commandite par actions (SCS, SLP), 65 (sociétés civiles, dont SCP, SCM, SCI, EARL).
  if (/^5[23]/.test(code) || /^65/.test(code)) return 'libre'
  return 'hors_champ'
}

// ── Les calculs ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Le vingtième de `base` centimes, arrondi au centime supérieur (voir l'en-tête). `base` positif ou nul. */
const vingtiemeAuCentimeSuperieur = (base: number): number => Math.floor((base + 19) / 20)
/** Le dixième de `capital` centimes, arrondi au centime supérieur. */
const dixiemeAuCentimeSuperieur = (capital: number): number => Math.floor((capital + 9) / 10)

/**
 * La réserve légale minimale (L232-10) : un vingtième du bénéfice diminué des pertes antérieures, tant que la réserve
 * n'atteint pas le dixième du capital, et jamais au-delà de ce qui l'y mène. Zéro sur une perte, ou quand les pertes
 * antérieures absorbent le bénéfice.
 */
export function reserveLegaleMinimale(
  resultatCentimes: number, pertesAnterieures: number, reserveLegaleExistante: number, capitalCentimes: number,
): number {
  const base = Math.max(0, resultatCentimes - pertesAnterieures)
  const resteJusquAuDixieme = Math.max(0, dixiemeAuCentimeSuperieur(capitalCentimes) - reserveLegaleExistante)
  return Math.min(vingtiemeAuCentimeSuperieur(base), resteJusquAuDixieme)
}

/** Les totaux qu'une décision met en jeu, en centimes. */
export interface CalculDeLAffectation {
  regime: RegimeDeLaForme
  reserveLegaleMinimale: number
  reserveLegaleDotee: number
  reservesStatutairesDotees: number
  /** L232-11, al. 1 : le résultat, moins les pertes antérieures et les réserves légale et statutaires DOTÉES, plus le
   *  report créditeur. Peut être négatif : rien alors ne se distribue du bénéfice ni du report. */
  beneficeDistribuable: number
  dividendesDuBeneficeEtDuReport: number
  dividendesDesReserves: number
  dividendes: number
  capitauxPropresAvant: number
  capitauxPropresApres: number
  /** L232-11, al. 3 : le capital augmenté de la réserve légale (après dotation), des réserves indisponibles et
   *  réglementées, de l'écart de réévaluation, et des réserves statutaires que les statuts rendent indisponibles. */
  plancher: number
}

const somme = (lignes: readonly LigneDAffectation[], filtre: (l: LigneDAffectation) => boolean): number =>
  lignes.filter(filtre).reduce((s, l) => s + l.centimes, 0)

function capitauxPropresAvant(s: SoldesAvantAffectation, resultat: number): number {
  // Classes 10, 11 et 12 seulement (conception § 3.4 : hors 13 et 14 — AFF1-Q2).
  return s.capitalAuxComptes + s.primes + s.ecartsDeReevaluation + s.reserveLegale + s.reservesIndisponibles
    + s.reservesStatutaires + s.reservesReglementees + s.autresReserves + s.reportCrediteur - s.pertesAnterieures
    - s.acomptesSurDividendes + resultat
}

function calculer(c: ContexteDeLAffectation, regime: RegimeDeLaForme, capital: number, lignes: readonly LigneDAffectation[]): CalculDeLAffectation {
  const s = c.soldes
  const minimale = regime === 'soumise'
    ? reserveLegaleMinimale(c.resultatCentimes, s.pertesAnterieures, s.reserveLegale, capital)
    : 0
  const reserveLegaleDotee = somme(lignes, (l) => l.destination === 'reserve_legale')
  // Une dotation aux réserves statutaires prise sur le résultat est celle que « les statuts » imposent (L232-11, al. 1) :
  // l'application ne lit pas les statuts, elle tient pour obligatoire ce que la décision y porte (conception § 3.4).
  const reservesStatutairesDotees = somme(lignes, (l) => l.origine === 'benefice' && l.destination === 'reserves_statutaires')
  const beneficeDistribuable = c.resultatCentimes - s.pertesAnterieures - reserveLegaleDotee - reservesStatutairesDotees
    + s.reportCrediteur
  const dividendesDuBeneficeEtDuReport = somme(lignes,
    (l) => l.destination === 'dividendes' && (l.origine === 'benefice' || l.origine === 'report_crediteur'))
  const dividendesDesReserves = somme(lignes,
    (l) => l.destination === 'dividendes' && (l.origine === 'autres_reserves' || l.origine === 'reserves_statutaires'))
  const dividendes = dividendesDuBeneficeEtDuReport + dividendesDesReserves
  const avant = capitauxPropresAvant(s, c.resultatCentimes)
  const statutairesIndisponibles = c.dossier.reservesStatutairesDistribuables
    ? 0
    : s.reservesStatutaires + reservesStatutairesDotees
  const plancher = capital + s.reserveLegale + reserveLegaleDotee + s.reservesIndisponibles + s.reservesReglementees
    + s.ecartsDeReevaluation + statutairesIndisponibles
  return {
    regime, reserveLegaleMinimale: minimale, reserveLegaleDotee, reservesStatutairesDotees, beneficeDistribuable,
    dividendesDuBeneficeEtDuReport, dividendesDesReserves, dividendes,
    capitauxPropresAvant: avant, capitauxPropresApres: avant - dividendes, plancher,
  }
}

// ── Le jugement ────────────────────────────────────────────────────────────────────────────────────────────────────────

const estUneDateCivile = (d: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(d) && ajouterJours(d, 0) === d
const centimesLisibles = (n: number): boolean => Number.isSafeInteger(n)

export const NOMS_DES_ORIGINES: Readonly<Record<OrigineDAffectation, string>> = {
  benefice: 'le bénéfice', perte: 'la perte', report_crediteur: 'le report à nouveau créditeur',
  autres_reserves: 'les autres réserves', reserves_statutaires: 'les réserves statutaires',
}
export const NOMS_DES_DESTINATIONS: Readonly<Record<DestinationDAffectation, string>> = {
  reserve_legale: 'la réserve légale', reserves_statutaires: 'les réserves statutaires', autres_reserves: 'les autres réserves',
  report_crediteur: 'le report à nouveau créditeur', report_debiteur: 'le report à nouveau débiteur', dividendes: 'les dividendes',
}

/** Le compte qui DONNE une ligne (au débit) et celui qui la REÇOIT (au crédit). */
function comptesDeLaLigne(l: LigneDAffectation, k: ComptesDeLAffectation): { debit: string; credit: string } {
  const compteDe = (x: OrigineDAffectation | DestinationDAffectation): string => {
    switch (x) {
      case 'benefice': return k.resultat_benefice
      case 'perte': return k.resultat_perte
      case 'reserve_legale': return k.reserve_legale
      case 'reserves_statutaires': return k.reserves_statutaires
      case 'autres_reserves': return k.autres_reserves
      case 'report_crediteur': return k.report_a_nouveau_crediteur
      case 'report_debiteur': return k.report_a_nouveau_debiteur
      case 'dividendes': return k.dividendes_a_payer
    }
  }
  // Une perte s'impute : le compte de destination au débit, le 129 au crédit, qu'elle solde.
  return l.origine === 'perte'
    ? { debit: compteDe(l.destination), credit: compteDe('perte') }
    : { debit: compteDe(l.origine), credit: compteDe(l.destination) }
}

export interface JugementDeLAffectation {
  /** Dans l'ordre où la base les redira ; la base n'en rend que le premier. Vide : la décision s'enregistre. */
  refus: Refus[]
  avertissements: Avertissement[]
  /** Nul quand un refus d'entrée (forme, capital, montants) empêche tout calcul. */
  calcul: CalculDeLAffectation | null
}

/**
 * Juge une décision saisie. Les refus d'ENTRÉE (montants illisibles, comptes, champ, forme, capital, acomptes, dates,
 * organe) s'arrêtent au premier groupe qui refuse ; ceux de la répartition se disent tous, dans l'ordre.
 */
export function jugerLAffectation(c: ContexteDeLAffectation, decision: DecisionSaisie): JugementDeLAffectation {
  const refus: Refus[] = []
  const avertissements: Avertissement[] = []
  const fin = (): JugementDeLAffectation => ({ refus, avertissements, calcul: null })
  const s = c.soldes
  const N = decision.exerciceAffecte

  const montants = [c.resultatCentimes, ...Object.values(s), ...decision.lignes.map((l) => l.centimes)]
  if (c.dossier.capitalCentimes !== null) montants.push(c.dossier.capitalCentimes)
  const negatifs = [s.reportCrediteur, s.pertesAnterieures, s.acomptesSurDividendes]
  if (!montants.every(centimesLisibles) || negatifs.some((n) => n < 0) || decision.lignes.some((l) => l.centimes <= 0)) {
    refus.push({ code: 'montant-illisible', message: 'Un montant n’est pas un nombre entier de centimes, ou une ligne d’affectation n’est pas positive : rien ne se juge.' })
    return fin()
  }
  if (!Object.values(c.comptes).every((k) => FORME_COMPTE_DE_ROLE.test(k))) {
    refus.push({ code: 'comptes-illisibles', message: 'Le plan du dossier ne rend pas, pour chaque compte de l’affectation, un compte à six chiffres : l’écriture ne se compose pas.' })
    return fin()
  }

  // 1. Le champ (conception § 3.9 et § 3.4).
  const d = c.dossier
  if (d.modeComptable === 'tresorerie') {
    refus.push({ code: 'tresorerie', message: 'Un dossier tenu en trésorerie ne connaît pas l’affectation du résultat : son résultat passe au compte de l’exploitant par le report des soldes.' })
    return fin()
  }
  if (d.exploitantIndividuel || d.formeJuridique === '1000') {
    refus.push({ code: 'entreprise-individuelle', message: 'Une entreprise individuelle n’affecte pas son résultat : il passe au compte de l’exploitant par le report des soldes.' })
    return fin()
  }
  if (d.formeJuridique === null) {
    refus.push({ code: 'forme-absente', message: 'La forme juridique du dossier n’est pas posée (onglet Informations, identité du dossier) : on ne sait pas quelles règles l’affectation suit.' })
    return fin()
  }
  const regime = regimeDeLaForme(d.formeJuridique)
  if (regime === 'hors_champ') {
    refus.push({ code: 'forme-hors-champ', message: `La forme juridique du dossier (${d.formeJuridique}) n’est ni une SARL, ni une société par actions, ni une autre société commerciale, ni une société civile : l’application n’en affecte pas le résultat.` })
    return fin()
  }
  if (d.capitalCentimes === null || d.capitalCentimes <= 0) {
    refus.push({ code: 'capital-absent', message: 'Le capital social du dossier n’est pas posé (onglet Informations, identité du dossier) : ni le dixième de la réserve légale ni le plancher des capitaux propres ne se calculent.' })
    return fin()
  }
  const capital = d.capitalCentimes
  if (s.acomptesSurDividendes !== 0) {
    refus.push({ code: 'acomptes-sur-dividendes', message: `Le compte des acomptes sur dividendes porte un solde de ${euros(s.acomptesSurDividendes)} : l’application ne les impute pas encore sur les dividendes décidés ; l’affectation se passe hors de l’application.` })
    return fin()
  }

  // 2. Les dates (AFF-Q2 (A) ; PCG, art. 112-2 : le bilan est présenté avant répartition).
  if (!Number.isInteger(N) || N < 2000 || N > 2100) {
    refus.push({ code: 'exercice-illisible', message: 'L’exercice affecté n’est pas une année entre 2000 et 2100.' })
    return fin()
  }
  const dates = [decision.dateDecision, ...(decision.dateMiseEnPaiement === null ? [] : [decision.dateMiseEnPaiement])]
  if (!dates.every(estUneDateCivile) || !estUneDateCivile(c.aujourdHui)) {
    refus.push({ code: 'date-illisible', message: 'Une date n’est pas une date du calendrier (JJ/MM/AAAA).' })
    return fin()
  }
  const cloture = `${N}-12-31`
  if (decision.dateDecision <= cloture) {
    refus.push({ code: 'date-avant-cloture', message: `La décision est datée du ${formatDate(decision.dateDecision)}, au plus tard à la clôture de l’exercice ${N} : les comptes ne s’approuvent et le résultat ne s’affecte qu’après la clôture.` })
  }
  if (decision.dateDecision > c.aujourdHui) {
    refus.push({ code: 'date-future', message: `La décision est datée du ${formatDate(decision.dateDecision)}, dans le futur : elle s’enregistre une fois prise.` })
  }
  if (c.exerciceDeLaDecisionValide) {
    refus.push({ code: 'exercice-de-la-decision-valide', message: `L’exercice qui contient le ${formatDate(decision.dateDecision)} est validé : une écriture n’y entre plus.` })
  }
  if ((decision.organe === 'associe_unique') !== (decision.nombreDAssocies === 'un')) {
    refus.push({ code: 'organe-et-associes', message: decision.organe === 'associe_unique'
      ? 'Une décision de l’associé unique suppose un seul associé.'
      : 'Une société à associé unique décide par une décision de l’associé unique, pas en assemblée ni par consultation.' })
  }
  if (refus.length > 0) return fin()

  // 3. L'approbation (AFF-Q1 (A) ; L232-12, al. 1 : l'affectation suit l'approbation).
  const lignes = decision.lignes
  if (!decision.comptesApprouves) {
    if (lignes.length > 0 || decision.dateMiseEnPaiement !== null) {
      refus.push({ code: 'non-approuves-avec-lignes', message: 'Les comptes ne sont pas approuvés : le résultat ne s’affecte pas, et la décision ne porte aucune ligne d’affectation ni date de mise en paiement.' })
    }
    return { refus, avertissements, calcul: calculer(c, regime, capital, []) }
  }

  // 4. La répartition.
  for (const l of lignes) {
    if (!COUPLES_ADMIS[l.origine].includes(l.destination)) {
      refus.push({ code: 'couple-non-admis', message: `${NOMS_DES_ORIGINES[l.origine]} ne s’affecte pas à ${NOMS_DES_DESTINATIONS[l.destination]}.`.replace(/^./, (x) => x.toUpperCase()) })
    }
  }
  if (!d.reservesStatutairesDistribuables && lignes.some((l) => l.origine === 'reserves_statutaires')) {
    refus.push({ code: 'reserves-statutaires-indisponibles', message: 'Les statuts ne permettent pas de distribuer les réserves statutaires (C. com., art. L232-11, al. 3) : elles ne s’affectent pas aux dividendes.' })
  }
  const r = c.resultatCentimes
  const duBenefice = somme(lignes, (l) => l.origine === 'benefice')
  const deLaPerte = somme(lignes, (l) => l.origine === 'perte')
  if ((r <= 0 && duBenefice > 0) || (r >= 0 && deLaPerte > 0)) {
    refus.push({ code: 'sens-du-resultat', message: r === 0
      ? 'Le résultat de l’exercice est nul : il n’y a ni bénéfice ni perte à affecter.'
      : `L’exercice ${N} se solde par ${r > 0 ? 'un bénéfice' : 'une perte'} : une ligne affecte ${r > 0 ? 'une perte' : 'un bénéfice'}.` })
  } else if ((r > 0 && duBenefice !== r) || (r < 0 && deLaPerte !== -r)) {
    const affecte = r > 0 ? duBenefice : deLaPerte
    refus.push({ code: 'resultat-pas-en-entier', message: `${r > 0 ? 'Le bénéfice' : 'La perte'} de ${euros(Math.abs(r))} s’affecte en entier : les lignes en affectent ${euros(affecte)}.` })
  }
  // Ce qu'une ligne prélève sur un solde (au débit de son compte) ne dépasse pas ce solde à la date de la décision.
  const preleve = (poste: 'report_crediteur' | 'autres_reserves' | 'reserves_statutaires'): number =>
    somme(lignes, (l) => l.origine === poste || (l.origine === 'perte' && l.destination === poste))
  const soldesDesPostes = [
    ['report_crediteur', s.reportCrediteur], ['autres_reserves', s.autresReserves], ['reserves_statutaires', s.reservesStatutaires],
  ] as const
  for (const [poste, solde] of soldesDesPostes) {
    const p = preleve(poste)
    if (p > solde) {
      refus.push({ code: 'prelevement-au-dela-du-solde', message: `La décision prélève ${euros(p)} sur ${NOMS_DES_DESTINATIONS[poste]}, dont le solde est de ${euros(solde)} à la date de la décision.` })
    }
  }
  const apure = somme(lignes, (l) => l.origine === 'benefice' && l.destination === 'report_debiteur')
  if (apure > s.pertesAnterieures) {
    refus.push({ code: 'apurement-au-dela-des-pertes', message: `La décision apure ${euros(apure)} de pertes antérieures, qui ne sont que de ${euros(s.pertesAnterieures)}.` })
  }

  const calcul = calculer(c, regime, capital, lignes)
  // AFF-Q3 (A) : L232-10, « toute décision contraire est nulle ».
  if (calcul.reserveLegaleDotee < calcul.reserveLegaleMinimale) {
    refus.push({ code: 'reserve-legale-insuffisante', message: `La réserve légale doit recevoir au moins ${euros(calcul.reserveLegaleMinimale)} (un vingtième du bénéfice diminué des pertes antérieures, jusqu’au dixième du capital ; C. com., art. L232-10) : la décision lui affecte ${euros(calcul.reserveLegaleDotee)}.` })
  }
  // AFF-Q4 (A) : un dividende contraire est fictif (L232-12, al. 3).
  const distribuable = Math.max(0, calcul.beneficeDistribuable)
  if (calcul.dividendesDuBeneficeEtDuReport > distribuable) {
    refus.push({ code: 'dividendes-au-dela-du-distribuable', message: `Les dividendes pris sur le bénéfice et le report à nouveau (${euros(calcul.dividendesDuBeneficeEtDuReport)}) dépassent le bénéfice distribuable (${euros(distribuable)} ; C. com., art. L232-11, al. 1) : ce serait un dividende fictif.` })
  } else if (calcul.dividendesDesReserves > 0 && calcul.dividendesDuBeneficeEtDuReport < distribuable) {
    refus.push({ code: 'reserves-avant-le-benefice', message: `Les dividendes se prélèvent par priorité sur le bénéfice distribuable de l’exercice (C. com., art. L232-11, al. 2) : la décision prend ${euros(calcul.dividendesDesReserves)} sur les réserves alors que ${euros(distribuable - calcul.dividendesDuBeneficeEtDuReport)} du bénéfice distribuable ne sont pas distribués.` })
  }
  if (calcul.dividendes > 0 && calcul.capitauxPropresApres < calcul.plancher) {
    refus.push({ code: 'capitaux-propres-sous-le-plancher', message: `Après la distribution, les capitaux propres (${euros(calcul.capitauxPropresApres)}) seraient inférieurs au capital augmenté des réserves que la loi ou les statuts ne permettent pas de distribuer (${euros(calcul.plancher)} ; C. com., art. L232-11, al. 3).` })
  }
  const paiement = decision.dateMiseEnPaiement
  if (paiement !== null && calcul.dividendes === 0) {
    refus.push({ code: 'paiement-sans-dividende', message: 'La décision ne distribue aucun dividende : elle ne porte pas de date de mise en paiement.' })
  } else if (paiement !== null && paiement < decision.dateDecision) {
    refus.push({ code: 'paiement-avant-la-decision', message: `La mise en paiement (${formatDate(paiement)}) précède la décision (${formatDate(decision.dateDecision)}).` })
  }

  // 5. Les avertissements : jamais bloquants.
  const sixMois = ajouterMois(cloture, 6)
  if (decision.dateDecision > sixMois) {
    avertissements.push({ code: 'approbation-tardive', message: `La décision est prise après le ${formatDate(sixMois)}, plus de six mois après la clôture : le délai légal d’approbation est dépassé, sauf prorogation par le président du tribunal de commerce.` })
  }
  const neufMois = ajouterMois(cloture, 9)
  if (calcul.dividendes > 0 && paiement !== null && paiement > neufMois) {
    avertissements.push({ code: 'paiement-tardif', message: `La mise en paiement des dividendes (${formatDate(paiement)}) dépasse le ${formatDate(neufMois)}, neuf mois après la clôture (C. com., art. L232-13) : une prolongation par décision de justice est nécessaire.` })
  }
  if (calcul.dividendes > 0 && paiement === null) {
    avertissements.push({ code: 'paiement-non-date', message: `La décision ne fixe pas la mise en paiement des dividendes : à défaut, les dirigeants la fixent, au plus tard le ${formatDate(neufMois)} (C. com., art. L232-13).` })
  }
  if (s.capitalAuxComptes !== capital) {
    avertissements.push({ code: 'capital-different-du-101', message: `Le capital du dossier (${euros(capital)}) diffère du solde du compte de capital (${euros(s.capitalAuxComptes)}) : la réserve légale et le plancher se calculent sur le capital du dossier.` })
  }
  if (regime === 'soumise' && 2 * calcul.capitauxPropresApres < capital) {
    avertissements.push({ code: 'capitaux-propres-sous-la-moitie', message: `Après l’affectation, les capitaux propres (${euros(calcul.capitauxPropresApres)}) sont inférieurs à la moitié du capital : les associés décident, dans les quatre mois de l’approbation, s’il y a lieu à dissolution anticipée.` })
  }
  return { refus, avertissements, calcul }
}

// ── La proposition ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PropositionDAffectation {
  lignes: LigneDAffectation[]
  reserveLegaleMinimale: number
  /** Avec la seule réserve légale minimale dotée. */
  beneficeDistribuable: number
  /** Le plus que la décision peut distribuer : le bénéfice distribuable et les réserves disponibles, sous le plancher. */
  plafondDesDividendes: number
}

/**
 * Ce que l'application PROPOSE, jamais ne décide (§ 3.1) : la réserve légale minimale, puis l'apurement des pertes
 * antérieures, puis le reste au report à nouveau créditeur ; une perte au report à nouveau débiteur (AFF-Q7 (A), le défaut).
 * Aucun dividende : le plafond se dit, le cabinet saisit ce qui a été voté. Nul hors du champ (le jugement dit pourquoi).
 */
export function proposerLAffectation(c: ContexteDeLAffectation): PropositionDAffectation | null {
  const d = c.dossier
  if (d.modeComptable === 'tresorerie' || d.exploitantIndividuel || d.formeJuridique === null
    || d.capitalCentimes === null || d.capitalCentimes <= 0) return null
  const regime = regimeDeLaForme(d.formeJuridique)
  if (regime === 'hors_champ') return null
  const s = c.soldes
  const r = c.resultatCentimes
  const lignes: LigneDAffectation[] = []
  let minimale = 0
  if (r > 0) {
    minimale = regime === 'soumise' ? reserveLegaleMinimale(r, s.pertesAnterieures, s.reserveLegale, d.capitalCentimes) : 0
    if (minimale > 0) lignes.push({ origine: 'benefice', destination: 'reserve_legale', centimes: minimale })
    const apurement = Math.min(s.pertesAnterieures, r - minimale)
    if (apurement > 0) lignes.push({ origine: 'benefice', destination: 'report_debiteur', centimes: apurement })
    const reste = r - minimale - apurement
    if (reste > 0) lignes.push({ origine: 'benefice', destination: 'report_crediteur', centimes: reste })
  } else if (r < 0) {
    lignes.push({ origine: 'perte', destination: 'report_debiteur', centimes: -r })
  }
  const calcul = calculer(c, regime, d.capitalCentimes, lignes)
  const reservesDisponibles = s.autresReserves + (d.reservesStatutairesDistribuables ? s.reservesStatutaires : 0)
  const plafond = Math.max(0, Math.min(
    Math.max(0, calcul.beneficeDistribuable) + reservesDisponibles,
    calcul.capitauxPropresAvant - calcul.plancher,
  ))
  return { lignes, reserveLegaleMinimale: minimale, beneficeDistribuable: calcul.beneficeDistribuable, plafondDesDividendes: plafond }
}

// ── L'écriture ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface LigneDeLEcritureDAffectation {
  compte: string
  sens: SensEcriture
  /** Positif, en centimes entiers. */
  centimes: number
}

export interface EcritureDAffectation {
  journal: 'OD'
  /** La date de la décision (AFF-Q2 (A)). */
  date: string
  pieceRef: string
  pieceDate: string
  libelle: string
  /** Une ligne par compte et par sens, sans compensation ; les débits d'abord, puis par compte. Équilibrées. */
  lignes: LigneDeLEcritureDAffectation[]
}

/**
 * L'écriture d'une décision que le jugement ne refuse pas ; nulle pour des comptes non approuvés ou un résultat nul
 * qu'aucune ligne n'affecte. Lève sur une décision refusée : on ne compose jamais ce que la base refuserait.
 */
export function composerLEcritureDAffectation(c: ContexteDeLAffectation, decision: DecisionSaisie): EcritureDAffectation | null {
  const jugement = jugerLAffectation(c, decision)
  if (jugement.refus.length > 0) throw new Error(`Affectation refusée : ${jugement.refus[0].message}`)
  if (!decision.comptesApprouves || decision.lignes.length === 0) return null
  const parCompte = new Map<string, number>()
  const ajouter = (compte: string, sens: SensEcriture, centimes: number) => {
    const cle = `${sens === 'debit' ? 0 : 1}|${compte}`
    parCompte.set(cle, (parCompte.get(cle) ?? 0) + centimes)
  }
  for (const l of decision.lignes) {
    const { debit, credit } = comptesDeLaLigne(l, c.comptes)
    ajouter(debit, 'debit', l.centimes)
    ajouter(credit, 'credit', l.centimes)
  }
  const lignes = [...parCompte.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([cle, centimes]): LigneDeLEcritureDAffectation => {
      const [rang, compte] = cle.split('|')
      return { compte, sens: rang === '0' ? 'debit' : 'credit', centimes }
    })
  const N = decision.exerciceAffecte
  return {
    journal: 'OD',
    date: decision.dateDecision,
    pieceRef: `Affectation du résultat ${N} — décision du ${formatDate(decision.dateDecision)}`,
    pieceDate: decision.dateDecision,
    libelle: `Affectation du résultat ${N}`,
    lignes,
  }
}

// ── La base (AFF2) ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * LE DRAPEAU, BAISSÉ : `AFFECTATION_PREVUE` (la migration `affectation_du_resultat`, préparée le 12/11/2026, pas appliquée :
 * supabase/preparees/20261112233000_affectation_du_resultat.sql). Baissé, ses deux tables et la colonne
 * `ecritures_brouillon.affectation_id` restent hors du plan de sauvegarde (sauvegarde.ts, `auPlanDeLAffectation`) : les lire
 * avant la migration ferait échouer toute sauvegarde. Il se lève dans le déploiement qui suit le collage (AFF7).
 */
export const AFFECTATION_PREVUE: boolean = false

/**
 * LE DRAPEAU DE L'ÉCRAN, BAISSÉ : `AFFECTATION_EXPORTEE` (AFF4). Baissé, la carte « Approbation et affectation du résultat »
 * de l'onglet Clôture ne se monte pas et ne lit aucune des deux tables. Il ne se lève qu'APRÈS la migration
 * `affectation_du_resultat` en production — avec `AFFECTATION_PREVUE`, dans le déploiement qui suit le collage (AFF7) : la
 * carte lit `affectations_du_resultat`, `lignes_d_affectation` et `ecritures_brouillon.affectation_id`, que la base n'a pas
 * avant elle, et une lecture refusée y dirait « lecture incomplète » à chaque ouverture de l'onglet.
 */
export const AFFECTATION_EXPORTEE: boolean = false

/** Les tables de la migration. */
export const TABLES_DE_L_AFFECTATION = ['affectations_du_resultat', 'lignes_d_affectation'] as const

/**
 * Les six rôles que la migration insère au catalogue (conception § 4.4), rangs 600 à 650, leur libellé au plan comptable
 * général. Ils n'entrent dans `ROLES_COMPTABLES` (lib/planComptable.ts) qu'avec l'écran (AFF4) : la base les porte, la lecture
 * du plan ignore sans conséquence un rôle qu'elle ne connaît pas. Le septième de la conception, les acomptes sur dividendes
 * (1209), attend : sa racine commencerait celle du résultat (120), et AFF-Q8 (B) ne l'écrit pas (le rang 660 lui reste).
 */
export const ROLES_DE_L_AFFECTATION: readonly DefinitionRoleComptable[] = [
  { role: 'reserve_legale', racines: ['1061'], compteDefaut: '106100', libelleDefaut: 'Réserve légale', prefixeAuxiliaireDefaut: null, ordre: 600 },
  { role: 'reserves_statutaires', racines: ['1063'], compteDefaut: '106300', libelleDefaut: 'Réserves statutaires ou contractuelles', prefixeAuxiliaireDefaut: null, ordre: 610 },
  { role: 'autres_reserves', racines: ['1068'], compteDefaut: '106800', libelleDefaut: 'Autres réserves', prefixeAuxiliaireDefaut: null, ordre: 620 },
  { role: 'report_a_nouveau_crediteur', racines: ['110'], compteDefaut: '110000', libelleDefaut: 'Report à nouveau (solde créditeur)', prefixeAuxiliaireDefaut: null, ordre: 630 },
  { role: 'report_a_nouveau_debiteur', racines: ['119'], compteDefaut: '119000', libelleDefaut: 'Report à nouveau (solde débiteur)', prefixeAuxiliaireDefaut: null, ordre: 640 },
  { role: 'dividendes_a_payer', racines: ['457'], compteDefaut: '457000', libelleDefaut: 'Associés - Dividendes à payer', prefixeAuxiliaireDefaut: null, ordre: 650 },
]
