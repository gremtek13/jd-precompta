// La retraite d'un praticien ou auxiliaire médical conventionné : ce que sa caisse de retraite appelle sur les revenus
// de l'exercice (ligne 27.1 de la feuille de route, TNS-Q5 ; conception et module du 10/11/2026, HISTORIQUE.md « LA
// RETRAITE DES PROFESSIONS LIBÉRALES : LA CONCEPTION (LIGNE 27.1) ET LE MODULE »).
//
// QUATRE COTISATIONS, PAR LA CAISSE DE LA PROFESSION, jamais par l'Urssaf : le régime de base de la CNAVPL (commun aux
// trois caisses), le régime complémentaire, l'invalidité-décès, et les prestations complémentaires de vieillesse (PCV,
// l'ancien « avantage social vieillesse »), dont l'Assurance maladie prend une part pour un praticien conventionné. La
// caisse se DÉDUIT de la profession, que le volet social porte déjà : CARPIMKO pour un auxiliaire médical, CARMF pour un
// médecin, CARCDSF pour un chirurgien-dentiste ou une sage-femme. La CIPAV n'a pas de profession dans l'application
// (RET-Q1).
//
// LA RÉFÉRENCE EST LE MOTEUR DE L'URSSAF, `modele-ti` 0.1.0 (« profession libérale . cotisations caisse de retraite » et
// ses règles, outils/cotisations/oracle.mjs retraite) : `retraiteDesLiberauxReference.ts` porte ses cas, et le test
// exige l'égalité au centime. Les montants de la CARPIMKO pour 2026 ont en plus été relus sur son site (carpimko.com,
// « selon mes revenus », le 10/11/2026 : 8,70 % entre 0,5 et 3 plafonds, soit 2 091 € et 12 544 € ; PCV 671 €, dont
// 447 € par l'Assurance maladie, plus 0,40 % de l'assiette conventionnée ; invalidité-décès 1 022 €).
//
// CE SONT LES COTISATIONS DÉFINITIVES DE L'EXERCICE, CALCULÉES SUR SES REVENUS, comme le volet de l'Urssaf
// (`voletSocialPamc.ts`) : pas l'échéancier de l'année, que la caisse appelle sur un revenu antérieur (la CARPIMKO
// appelle 2026 sur les revenus 2025 puis régularise ; la CARMF fixe son complémentaire et sa classe d'invalidité-décès
// sur l'avant-dernière année, sans régularisation, que le moteur ne suit pas). La case BT de la 2035 n'en reçoit rien :
// elle compte les échéances PAYÉES de l'onglet Cotisations, dont l'organisme peut être la caisse (RET-Q4).
//
// CALCULÉ EN CENTIMES, EN NOMBRES EXACTS : chaque montant est une fraction d'entiers (BigInt), arrondie là où le moteur
// arrondit — à l'euro, ou au centime pour la CARCDSF —, à la demie supérieure ; jamais une somme de flottants.
//
// CE QUE LE MODULE NE FAIT PAS, et que l'écran dira : la CIPAV ; l'exonération pour incapacité d'exercice (« CNAVPL .
// exonération incapacité ») ; le conjoint collaborateur ; l'outre-mer ; les cotisations facultatives ; la règle de la
// CARMF qui dispense du complémentaire les deux premières années un médecin installé avant quarante ans (le moteur
// l'ignore ; l'estimation le compte dû et le dit, RET-Q2). Deux gestes que la CARCDSF accorde SUR DEMANDE — la réduction du forfait complémentaire sous 85 % du
// plafond, l'exonération des PCV des faibles revenus — le moteur les suppose demandés ; l'estimation les suit et le dit
// (`hypotheses`, RET-Q3).

import type { ProfessionPamc } from './types'
import {
  ACTIVITE_OUVERTE_AVANT,
  JOURS_PAR_AN,
  activiteDeLExercice,
  estimerCotisationsUrssaf,
  type ActiviteDeLExercice,
  type EntreeEstimation,
} from './voletSocialPamc'

export type CaisseDeRetraite = 'carpimko' | 'carmf' | 'carcdsf'

/** La caisse de la profession : la liste fermée du volet social, aucune autre ne s'y range. */
export const CAISSE_DE_LA_PROFESSION: Readonly<Record<ProfessionPamc, CaisseDeRetraite>> = {
  auxiliaire_medical: 'carpimko',
  sage_femme: 'carcdsf',
  medecin_secteur_1: 'carmf',
  medecin_secteur_2: 'carmf',
  chirurgien_dentiste: 'carcdsf',
}

// ── Les nombres exacts ───────────────────────────────────────────────────────────────────────────────────────────

/** Une fraction d'entiers, en centimes : n / d, d > 0. */
interface Q {
  n: bigint
  d: bigint
}
const q = (n: bigint | number, d: bigint | number = 1n): Q => ({ n: BigInt(n), d: BigInt(d) })
const plus = (a: Q, b: Q): Q => q(a.n * b.d + b.n * a.d, a.d * b.d)
const moins = (a: Q, b: Q): Q => q(a.n * b.d - b.n * a.d, a.d * b.d)
const fois = (a: Q, b: Q): Q => q(a.n * b.n, a.d * b.d)
const divise = (a: Q, b: Q): Q => (b.n < 0n ? q(-a.n * b.d, a.d * -b.n) : q(a.n * b.d, a.d * b.n))
const compare = (a: Q, b: Q): number => {
  const g = a.n * b.d - b.n * a.d
  return g < 0n ? -1 : g > 0n ? 1 : 0
}
const min = (a: Q, b: Q): Q => (compare(a, b) <= 0 ? a : b)
const max = (a: Q, b: Q): Q => (compare(a, b) >= 0 ? a : b)
const ZERO = q(0)
/** Un taux en dix-millièmes : 8,73 % s'écrit 873. */
const taux = (dixMilliemes: number): Q => q(dixMilliemes, 10_000)
/** Un montant en euros, éventuellement au centime (3 210,60 €), en centimes exacts. */
const euros = (e: number): Q => q(Math.round(e * 100))
/** Division entière arrondie vers le bas, quel que soit le signe. */
const division = (n: bigint, d: bigint): bigint => (n >= 0n ? n / d : -((-n + d - 1n) / d))
/** Arrondi au pas (100 centimes pour l'euro, 1 pour le centime), à la demie supérieure comme le moteur. */
const arrondi = (a: Q, pas: bigint): Q => q(division(2n * a.n + a.d * pas, 2n * a.d * pas) * pas)
const aLEuro = (a: Q) => arrondi(a, 100n)
const auCentime = (a: Q) => arrondi(a, 1n)
/** Le mécanisme `abattement` du moteur : une cotisation diminuée d'une part, jamais sous zéro. */
const abattue = (montant: Q, part: Q) => max(ZERO, moins(montant, fois(montant, part)))
/** Un montant déjà arrondi au centime, rendu en centimes entiers. */
const centimes = (a: Q): number => Number(auCentime(a).n)

// ── Les barèmes, par année ───────────────────────────────────────────────────────────────────────────────────────
//
// SAISIS, jamais devinés : une année absente fait refuser l'estimation (comme le plafond de la sécurité sociale du
// volet de l'Urssaf). Chaque valeur est celle du moteur, sous le nom de sa règle.

interface Bareme {
  /** « SMIC . horaire . métropole . début d'année » : 450 heures font le plancher de la base (« assiette minimale . retraite »). */
  smicHoraire: number
  carpimko: {
    /** 2025 : un forfait plus 3 % entre deux bornes ; 2026 : 8,70 % entre 0,5 et 3 plafonds (« CARPIMKO . retraite complémentaire »). */
    complementaire: { forme: 'forfait'; forfait: number; seuil: number; borne: number } | { forme: 'proportionnelle' }
    invaliditeDeces: number
    pcvForfait: number
  }
  carmf: {
    invaliditeDecesClasseA: number
    invaliditeDecesClasseC: number
    pcvForfait: number
    /** « CARMF . PCV . cotisation proportionnelle », en dix-millièmes. */
    pcvTaux: number
  }
  carcdsf: {
    complementaireForfait: number
    invaliditeDecesDentiste: number
    invaliditeDecesSageFemme: number
    pcvForfaitDentiste: number
  }
}

export const BAREMES_RETRAITE: Readonly<Record<number, Bareme>> = {
  2025: {
    smicHoraire: 11.88,
    carpimko: { complementaire: { forme: 'forfait', forfait: 2312, seuil: 25_246, borne: 237_179 }, invaliditeDeces: 1022, pcvForfait: 665 },
    carmf: { invaliditeDecesClasseA: 623, invaliditeDecesClasseC: 999, pcvForfait: 5556, pcvTaux: 380 },
    carcdsf: { complementaireForfait: 3178.8, invaliditeDecesDentiste: 1284.4, invaliditeDecesSageFemme: 380, pcvForfaitDentiste: 4946.28 },
  },
  2026: {
    smicHoraire: 12.02,
    carpimko: { complementaire: { forme: 'proportionnelle' }, invaliditeDeces: 1022, pcvForfait: 671 },
    carmf: { invaliditeDecesClasseA: 626, invaliditeDecesClasseC: 1010, pcvForfait: 5751, pcvTaux: 400 },
    carcdsf: { complementaireForfait: 3210.6, invaliditeDecesDentiste: 1235, invaliditeDecesSageFemme: 384, pcvForfaitDentiste: 4990.8 },
  },
}

// Les taux communs aux deux années (« après réforme », depuis les revenus 2025).
const BASE_TRANCHE_1 = 873 // 8,73 % jusqu'au plafond proratisé (« CNAVPL . retraite de base . tranche 1 »)
const BASE_TRANCHE_2 = 187 // 1,87 % jusqu'à cinq plafonds proratisés
const HEURES_DU_PLANCHER = 450
const JOURS_SANS_PLANCHER = 90 // « durée d'activité cette année < 90 jour » : plus de plancher
const CARPIMKO_COMPLEMENTAIRE_2025 = 300 // 3 %
const CARPIMKO_COMPLEMENTAIRE_2026 = 870 // 8,70 %
const CARPIMKO_PCV_TAUX = 40 // 0,40 % de l'assiette de la prise en charge
const CARMF_COMPLEMENTAIRE = 1020 // 10,2 % jusqu'à 3,5 plafonds
const CARMF_INVALIDITE_B_FORFAIT = 434
const CARMF_INVALIDITE_B_TAUX = 40 // 0,32 % + 0,08 %
const CARMF_DEUX_ANS = 2 * JOURS_PAR_AN
const CARCDSF_COMPLEMENTAIRE = 1080 // 10,80 % de 0,85 à 5 plafonds
const CARCDSF_PCV_TAUX = 145 // 1,45 % jusqu'à cinq plafonds
const CARCDSF_PCV_SEUIL_DENTISTE = 500 * 23 // 500 consultations à 23 € (« exonération PCV »)
const CARCDSF_PCV_SEUIL_SAGE_FEMME = 3120
const CARCDSF_PCV_SAGE_FEMME = 780
// La prise en charge du régime de base d'un médecin de secteur 1 (« CARMF . participation CPAM retraite »), selon la
// tranche où tombe son assiette — non progressive, une borne atteinte passe à la suivante.
const CARMF_PRISE_EN_CHARGE_BASE: readonly (readonly [pourcentDuPlafond: number, dixMilliemes: number])[] = [
  [140, 215],
  [250, 151],
  [Infinity, 112],
]

// ── L'estimation ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface EntreeRetraite extends EntreeEstimation {
  /**
   * Un médecin qui cumule sa retraite et son activité (« CARMF . en retraite ») ne cotise plus à l'invalidité-décès.
   * OBLIGATOIRE pour un médecin, sans défaut ; sans objet pour les autres (null).
   */
  cumulEmploiRetraite: boolean | null
}

/** Ce que l'estimation suppose et que l'écran dit. */
export type HypotheseRetraite =
  | 'carcdsf-reduction-du-forfait-supposee-demandee'
  | 'carcdsf-exoneration-des-pcv-supposee-demandee'
  | 'carmf-debut-d-activite-complementaire-suppose-du'

export interface EstimationRetraite {
  caisse: CaisseDeRetraite
  /** Tous les montants en centimes. */
  assiette: number
  /** Le plancher de la base (450 heures au SMIC), nul sous quatre-vingt-dix jours d'activité dans l'année. */
  assietteMinimale: number
  /** Le régime de base, prise en charge du secteur 1 et ACRE déduites. */
  retraiteDeBase: number
  /** La part du régime de base que prend l'Assurance maladie : un médecin de secteur 1 seul. */
  priseEnChargeRetraiteDeBase: number
  retraiteComplementaire: number
  invaliditeDeces: number
  /** Les PCV restées à la charge du praticien. */
  pcv: number
  /** La part des PCV que prend l'Assurance maladie. */
  priseEnChargePcv: number
  /** Ce que le praticien paie à sa caisse : les quatre, arrondis à l'euro. */
  total: number
  hypotheses: readonly HypotheseRetraite[]
}

export type ResultatRetraite = { disponible: true; estimation: EstimationRetraite } | { disponible: false; motif: string }

export function estimerRetraite(e: EntreeRetraite): ResultatRetraite {
  // Le volet de l'Urssaf juge l'entrée — l'année, la profession, les paramètres, le ratio — et donne l'assiette
  // sociale, la même pour la caisse ; une estimation qu'il refuse, la caisse la refuse pour la même raison.
  const urssaf = estimerCotisationsUrssaf(e)
  if (!urssaf.disponible) return urssaf
  const u = urssaf.estimation
  const bareme = BAREMES_RETRAITE[e.annee]
  if (bareme === undefined) {
    return { disponible: false, motif: `Les barèmes des caisses de retraite ${e.annee} ne sont pas encore saisis dans l'application.` }
  }
  const profession = e.profession as ProfessionPamc
  const caisse = CAISSE_DE_LA_PROFESSION[profession]
  const medecin = caisse === 'carmf'
  if (medecin && e.cumulEmploiRetraite === null) {
    return {
      disponible: false,
      motif: 'Dites si le médecin cumule sa retraite et son activité : la CARMF ne lui appelle alors plus l’invalidité-décès.',
    }
  }
  // L'activité de l'exercice : déjà lue sans faute par le volet de l'Urssaf, quand les paramètres sont tenus.
  let activite: ActiviteDeLExercice = ACTIVITE_OUVERTE_AVANT
  if (e.parametres.tenus && e.parametres.debutActivite !== null) {
    const lue = activiteDeLExercice(e.annee, e.parametres.debutActivite)
    if (lue.activite === null) return { disponible: false, motif: lue.motif }
    activite = lue.activite
  }
  const hypotheses: HypotheseRetraite[] = []

  const P = euros(u.plafond)
  const PP = euros(u.plafondProratise)
  const a = euros(u.assiette)
  const partDuPlafond = (pourcent: number) => fois(P, q(pourcent, 100))
  const prorata = q(activite.joursCetteAnnee, JOURS_PAR_AN)

  // L'ACRE (« Acre . exonération . taux retraite de base et invalidité-décès ») : le tout (créations d'avant 2026) ou le
  // quart sous 75 % du plafond proratisé, dégressive jusqu'à lui, nulle au-delà ; au prorata des jours qui restent.
  let partAcre = ZERO
  if (u.acreAppliquee) {
    const maximum = activite.creeeAvant2026 ? q(1) : q(1, 4)
    let t: Q
    if (compare(a, PP) > 0) t = ZERO
    else if (compare(a, fois(PP, q(3, 4))) < 0) t = maximum
    else t = fois(divise(moins(PP, a), a), activite.creeeAvant2026 ? q(3) : q(3, 4))
    partAcre = fois(t, q(JOURS_PAR_AN - activite.joursAuPremierJanvier, JOURS_PAR_AN))
  }

  // ── Le régime de base de la CNAVPL : 8,73 % puis 1,87 %, sur l'assiette portée au plancher.
  const assietteMinimale =
    activite.joursCetteAnnee < JOURS_SANS_PLANCHER ? ZERO : aLEuro(fois(euros(bareme.smicHoraire), q(HEURES_DU_PLANCHER)))
  const assietteBase = max(a, assietteMinimale)
  const tranche1 = aLEuro(fois(min(assietteBase, PP), taux(BASE_TRANCHE_1)))
  const tranche2 = aLEuro(fois(min(assietteBase, fois(PP, q(5))), taux(BASE_TRANCHE_2)))
  let priseEnChargeBase = ZERO
  if (profession === 'medecin_secteur_1') {
    const ligne = CARMF_PRISE_EN_CHARGE_BASE.find(([borne]) => borne === Infinity || compare(a, partDuPlafond(borne)) < 0)
    priseEnChargeBase = fois(a, taux(ligne?.[1] ?? 0))
  }
  const retraiteDeBase = aLEuro(abattue(max(ZERO, moins(plus(tranche1, tranche2), priseEnChargeBase)), partAcre))

  // ── Le complémentaire.
  let complementaire: Q
  if (caisse === 'carpimko') {
    const c = bareme.carpimko.complementaire
    complementaire =
      c.forme === 'forfait'
        ? plus(euros(c.forfait), aLEuro(fois(max(ZERO, moins(min(a, euros(c.borne)), euros(c.seuil))), taux(CARPIMKO_COMPLEMENTAIRE_2025))))
        : aLEuro(fois(min(max(a, partDuPlafond(50)), partDuPlafond(300)), taux(CARPIMKO_COMPLEMENTAIRE_2026)))
  } else if (caisse === 'carmf') {
    // Les deux premières années d'affiliation, la CARMF dispense du complémentaire le médecin installé avant quarante
    // ans (la description même de la règle du moteur). Le moteur ne l'applique jamais (sa condition « durée d'activité
    // en fin d'année < 2 ans » compare des jours à des années, mesuré le 10/11/2026), et l'application ne sait pas
    // l'âge : la cotisation est comptée DUE, et l'estimation le dit (RET-Q2).
    complementaire = aLEuro(fois(min(a, partDuPlafond(350)), taux(CARMF_COMPLEMENTAIRE)))
    if (activite.joursAuTrenteEtUn < CARMF_DEUX_ANS) hypotheses.push('carmf-debut-d-activite-complementaire-suppose-du')
  } else {
    const seuil = partDuPlafond(85)
    let forfait = euros(bareme.carcdsf.complementaireForfait)
    if (compare(a, seuil) < 0) {
      forfait = fois(forfait, divise(a, seuil))
      hypotheses.push('carcdsf-reduction-du-forfait-supposee-demandee')
    }
    const proportionnelle = fois(max(ZERO, moins(min(a, partDuPlafond(500)), seuil)), taux(CARCDSF_COMPLEMENTAIRE))
    complementaire = auCentime(fois(plus(aLEuro(forfait), proportionnelle), prorata))
  }

  // ── L'invalidité-décès, puis l'ACRE.
  let invalidite: Q
  if (caisse === 'carpimko') invalidite = euros(bareme.carpimko.invaliditeDeces)
  else if (caisse === 'carmf') {
    if (e.cumulEmploiRetraite === true) invalidite = ZERO
    else if (compare(a, P) < 0) invalidite = euros(bareme.carmf.invaliditeDecesClasseA)
    else if (compare(a, partDuPlafond(300)) < 0) invalidite = plus(euros(CARMF_INVALIDITE_B_FORFAIT), fois(a, taux(CARMF_INVALIDITE_B_TAUX)))
    else invalidite = euros(bareme.carmf.invaliditeDecesClasseC)
  } else {
    invalidite = euros(profession === 'sage_femme' ? bareme.carcdsf.invaliditeDecesSageFemme : bareme.carcdsf.invaliditeDecesDentiste)
  }
  const invaliditeDeces = auCentime(abattue(invalidite, partAcre))

  // ── Les PCV : le forfait et la part proportionnelle, moins ce que prend l'Assurance maladie.
  const recettes = q(Math.round(e.recettesBrutes * 100))
  const honoraires = euros(e.honorairesConventionnes ?? 0)
  const depassements = euros(e.depassements ?? 0)
  // L'assiette sociale conventionnée (« PAMC . assiette sociale conventionnée ») : la part conventionnée des recettes.
  const assietteConventionnee = honoraires.n === 0n ? ZERO : fois(a, divise(honoraires, recettes))
  let pcv: Q
  let priseEnChargePcv: Q
  if (caisse === 'carpimko') {
    // Sur l'assiette de la prise en charge, dépassements retirés (« PAMC . assiette participation CPAM »).
    const assietteParticipation = honoraires.n === 0n ? ZERO : fois(assietteConventionnee, divise(moins(honoraires, depassements), honoraires))
    const forfait = euros(bareme.carpimko.pcvForfait)
    const proportionnelle = fois(assietteParticipation, taux(CARPIMKO_PCV_TAUX))
    priseEnChargePcv = plus(aLEuro(fois(forfait, q(2, 3))), fois(proportionnelle, q(60, 100)))
    pcv = aLEuro(max(ZERO, moins(plus(forfait, proportionnelle), priseEnChargePcv)))
  } else if (caisse === 'carmf') {
    const forfait = euros(bareme.carmf.pcvForfait)
    const proportionnelle = fois(min(assietteConventionnee, partDuPlafond(500)), taux(bareme.carmf.pcvTaux))
    priseEnChargePcv = profession === 'medecin_secteur_1' ? plus(aLEuro(fois(forfait, q(2, 3))), fois(proportionnelle, q(2, 3))) : ZERO
    pcv = aLEuro(max(ZERO, moins(plus(forfait, proportionnelle), priseEnChargePcv)))
  } else if (profession === 'sage_femme') {
    if (compare(a, euros(CARCDSF_PCV_SEUIL_SAGE_FEMME)) <= 0) {
      pcv = ZERO
      priseEnChargePcv = ZERO
      hypotheses.push('carcdsf-exoneration-des-pcv-supposee-demandee')
    } else {
      const forfait = euros(CARCDSF_PCV_SAGE_FEMME)
      priseEnChargePcv = aLEuro(fois(forfait, q(2, 3)))
      pcv = aLEuro(max(ZERO, moins(forfait, priseEnChargePcv)))
    }
  } else if (compare(a, euros(CARCDSF_PCV_SEUIL_DENTISTE)) <= 0) {
    pcv = ZERO
    priseEnChargePcv = ZERO
    hypotheses.push('carcdsf-exoneration-des-pcv-supposee-demandee')
  } else {
    const forfait = euros(bareme.carcdsf.pcvForfaitDentiste)
    const proportionnelle = auCentime(fois(min(a, partDuPlafond(500)), taux(CARCDSF_PCV_TAUX)))
    // Le moteur proratise la cotisation l'année de l'installation, pas la prise en charge : il la retranche entière.
    priseEnChargePcv = plus(fois(forfait, q(2, 3)), fois(proportionnelle, q(1, 2)))
    pcv = auCentime(max(ZERO, moins(fois(plus(forfait, proportionnelle), prorata), priseEnChargePcv)))
  }

  const total = aLEuro(plus(plus(retraiteDeBase, complementaire), plus(invaliditeDeces, pcv)))
  return {
    disponible: true,
    estimation: {
      caisse,
      assiette: centimes(a),
      assietteMinimale: centimes(assietteMinimale),
      retraiteDeBase: centimes(retraiteDeBase),
      priseEnChargeRetraiteDeBase: centimes(priseEnChargeBase),
      retraiteComplementaire: centimes(complementaire),
      invaliditeDeces: centimes(invaliditeDeces),
      pcv: centimes(pcv),
      priseEnChargePcv: centimes(priseEnChargePcv),
      total: centimes(total),
      hypotheses,
    },
  }
}
