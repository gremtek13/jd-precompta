// Le volet social de la déclaration de revenus d'un praticien ou auxiliaire médical conventionné, et
// l'estimation des cotisations que l'Urssaf appellera sur ces revenus (ligne 27 de la feuille de
// route, décision du cabinet du 28/09/2026).
//
// DEUX CHOSES DISTINCTES, ET LA SECONDE EST UNE ESTIMATION.
//  - Les rubriques (notice 2041-DRI des praticiens conventionnés, revenus 2025, § 5.1) : DSCS, les
//    recettes totales, que l'application propose depuis la 2035 ; DSAV et DSAW, qui viennent du
//    relevé SNIR et que le cabinet saisit ; DSAU, le ratio des deux, que la notice autorise à
//    calculer simplement. Rien ici n'est déclaré à la place du cabinet.
//  - Les cotisations recouvrées par l'Urssaf sur ces revenus : CSG-CRDS, maladie-maternité avec la
//    prise en charge par l'Assurance maladie, contribution de 3,25 %, indemnités journalières,
//    allocations familiales, CURPS, formation professionnelle. Pas la retraite, appelée par la
//    CARPIMKO (ou la CARCDSF) et non par l'Urssaf — ni celle de la CIPAV (ligne 27.1, RET-Q1), que l'Urssaf
//    recouvre pourtant : `retraiteDesLiberaux.ts` l'estime, et `retraiteAffichee.ts` l'ajoute au total appelé.
//
// LA RÉFÉRENCE EST LE MOTEUR DE L'URSSAF, PAS NOUS. `voletSocialPamcReference.ts` porte des cas
// calculés par `modele-ti`, le jeu de règles des simulateurs de l'Urssaf pour les indépendants (voir
// outils/cotisations/oracle.mjs), et les tests exigent l'égalité à l'euro sur chacun. Les taux de
// maladie (D. 621-1 et D. 621-2), des indemnités journalières (D. 621-3), des allocations familiales
// (D. 613-1) et la contribution de 3,25 % (L. 646-3) ont en plus été relus sur Légifrance ; la
// prise en charge par l'Assurance maladie, la CURPS et la formation professionnelle ne sont
// sourcées que par ce moteur.
//
// LES MÉDECINS (07/11/2026) : secteur 1 et secteur 2, tels que le moteur les calcule — la CURPS à
// 0,5 % ; la prise en charge de la maladie pour le secteur 1 seul ; et pour lui seul encore, celle
// des allocations familiales, une part de la cotisation fixée par la tranche où tombe l'assiette de
// la prise en charge (100 % jusqu'à 140 % du plafond, 75 % jusqu'à 250 %, 60 % au-delà).
//
// LES PARAMÈTRES DES COTISATIONS (TNS-Q1, TNS-Q4, 07/11/2026 ; migration en production le même jour,
// `parametres_des_cotisations`, src/lib/parametresDesCotisations.ts) : le début d'activité du dossier,
// l'ACRE et le « taux dentiste » de l'exercice, une entrée OBLIGATOIRE (`ParametresEstimation`), sans
// défaut. L'année de la création, le plafond se proratise aux jours d'activité (le taux de maladie, ses
// trois plafonds, les allocations familiales ; le reste garde le plafond annuel) et la CURPS n'est pas
// due ; l'ACRE, l'année de la création et la suivante au prorata des jours qui restent, exonère la
// maladie, les indemnités journalières et les allocations familiales (art. D. 131-6-1 : le quart au plus
// depuis les créations de 2026, tout avant ; dégressive de 75 à 100 % du plafond proratisé) ; un
// chirurgien-dentiste a sa prise en charge sur sa part conventionnée divisée par 1 + le taux dentiste
// (convention nationale des chirurgiens-dentistes, art. 51), et sa CURPS à 0,3 %. Tant que leur migration
// n'est pas en base, l'appelant le dit (`tenus: false`) et l'estimation est celle d'hier : une activité
// ouverte avant l'exercice, sans ACRE, un chirurgien-dentiste refusé.
//
// CE QUE L'ESTIMATION NE COUVRE PAS, et que l'écran dit : les médecins non conventionnés (aucun choix
// ne les porte), les revenus de remplacement (indemnités journalières perçues, qui s'ajoutent à
// l'assiette des cotisations), les exonérations d'invalidité, l'outre-mer, et une activité qui cesse en
// cours d'année. Et elle porte sur les cotisations DÉFINITIVES de l'exercice : la différence avec
// les provisionnelles appelées pour la même année est la régularisation, que seul l'avis de l'Urssaf
// chiffre — l'échéancier d'une année mêle les provisionnelles de l'année et la régularisation de
// la précédente.

import { PREMIER_EXERCICE_REVENU_BRUT_SOCIAL } from './cases2035'
import type { ProfessionLiberale, ProfessionPamc, VoletSocialPamc } from './types'

/**
 * Plafond annuel de la sécurité sociale, par année. SAISI, jamais deviné : une année absente fait
 * refuser l'estimation plutôt que de retomber sur la précédente — un plafond périmé déplace toutes
 * les tranches, et le résultat reste plausible. 2025 : les bornes de l'abattement publiées par la
 * notice (829 € et 61 230 €, soit 1,76 % et 130 % de 47 100 €). 2026 : 48 060 €, repris de
 * service-public.fr (fiche F39739 : 19 % du plafond = 9 131 €, 40 % = 19 224 €).
 */
export const PLAFONDS_SECURITE_SOCIALE: Readonly<Record<number, number>> = {
  2025: 47_100,
  2026: 48_060,
}


export const LIBELLES_PROFESSION: Readonly<Record<ProfessionLiberale, string>> = {
  auxiliaire_medical: 'Auxiliaire médical',
  sage_femme: 'Sage-femme',
  medecin_secteur_1: 'Médecin, secteur 1',
  medecin_secteur_2: 'Médecin, secteur 2',
  chirurgien_dentiste: 'Chirurgien-dentiste',
  liberal_cipav: 'Profession relevant de la CIPAV',
}

/**
 * Qui compte comme auxiliaire médical ici. Dit SOUS la liste déroulante et non dans son libellé : une
 * liste déroulante prend la largeur de son plus long choix, et celui-ci faisait déborder le panneau
 * central de 188 pixels, panneau de droite ouvert (outils/captures/debordements.mjs).
 */
export const AUXILIAIRES_MEDICAUX = 'infirmier, masseur-kinésithérapeute, orthophoniste, orthoptiste, pédicure-podologue'

/**
 * LA CIPAV (ligne 27.1, RET-Q1, décision du cabinet du 11/11/2026) : les professions libérales réglementées que le moteur
 * public de l'Urssaf rattache à la CIPAV (modele-ti 0.1.0, « profession libérale . réglementée . métier . rattaché
 * Cipav », qui cite la loi n° 2017-1836, art. 15), toutes calculées de même — d'où une seule valeur, `liberal_cipav`.
 * Dit sous la liste déroulante, comme les auxiliaires médicaux. Une profession libérale NON réglementée encore affiliée à
 * la CIPAV (installée avant 2019, sans avoir opté pour le régime général) n'y est pas : l'application ne la porte pas.
 */
export const METIERS_CIPAV =
  'architecte, architecte d’intérieur, économiste de la construction, maître d’œuvre, géomètre-expert, moniteur de ski, ' +
  'guide de haute montagne, accompagnateur de moyenne montagne, ostéopathe, psychologue, psychothérapeute, ' +
  'psychomotricien, ergothérapeute, diététicien, chiropracteur, ingénieur-conseil, guide-conférencier, artiste autre ' +
  'qu’artiste-auteur, expert devant les tribunaux, expert en automobile, mandataire judiciaire à la protection des majeurs'

/**
 * La migration `professions_cipav` (supabase/preparees/20261111130000_professions_cipav.sql) élargit la liste fermée de
 * `volet_social_pamc.profession`. Baissé tant qu'elle n'est pas appliquée : l'écran n'offre pas la CIPAV (la base la
 * refuserait, 23514). Le calcul, lui, la connaît déjà, contrôlé contre le moteur de l'Urssaf.
 */
export const PROFESSIONS_CIPAV_PREVUES = false

/** Les professions que la liste déroulante offre : la CIPAV sous son drapeau, ou si la ligne lue la porte déjà. */
export function professionsOffertes(cipavPrevues: boolean, actuelle: ProfessionLiberale | ''): ProfessionLiberale[] {
  const toutes = Object.keys(LIBELLES_PROFESSION) as ProfessionLiberale[]
  return toutes.filter((p) => p !== 'liberal_cipav' || cipavPrevues || actuelle === 'liberal_cipav')
}

// ── Les rubriques ──────────────────────────────────────────────────────────────────────────────

/**
 * DSCS, les recettes brutes totales : ce que le cabinet a saisi, sinon la ligne 4 de la 2035-A
 * (recettes nettes des débours et des honoraires rétrocédés). La notice ne nomme aucune ligne ; la
 * ligne 4 est une proposition, et l'écran dit d'où vient le chiffre. Un remplaçant déclare lui-même
 * les rétrocessions qu'il reçoit : les compter aussi chez le titulaire les compterait deux fois.
 */
export function recettesBrutesRetenues(
  saisie: Pick<VoletSocialPamc, 'recettes_brutes'> | null,
  recettesNettes2035: number,
): { montant: number; proposees: boolean } {
  if (saisie?.recettes_brutes != null) return { montant: saisie.recettes_brutes, proposees: false }
  return { montant: recettesNettes2035, proposees: true }
}

export type Ratio = { ratio: number; motif: null } | { ratio: null; motif: string }

/**
 * DSAU, le ratio conventionné : honoraires du SNIR ÷ recettes totales, au centième, entre 0 et 1 —
 * le « calcul simplifié » que la notice admet. Refusé plutôt que borné quand il dépasse 1 : la
 * déclaration le refuserait aussi, et c'est presque toujours le signe d'un titulaire qui n'a pas
 * retiré de ses honoraires ceux qu'il a rétrocédés à un remplaçant.
 */
export function ratioConventionne(honorairesConventionnes: number | null, recettesBrutes: number): Ratio {
  if (honorairesConventionnes == null) {
    return { ratio: null, motif: 'Saisissez les honoraires du relevé SNIR (DSAV) : le ratio en dépend.' }
  }
  if (recettesBrutes <= 0) {
    return { ratio: null, motif: 'Les recettes totales (DSCS) sont nulles : le ratio ne se calcule pas.' }
  }
  if (honorairesConventionnes > recettesBrutes) {
    return {
      ratio: null,
      motif:
        'Les honoraires conventionnés dépassent les recettes totales. Si le praticien a rétrocédé ' +
        'des honoraires à un remplaçant, la notice demande de les retirer des honoraires du SNIR ; ' +
        'sinon, revoir les recettes totales.',
    }
  }
  return { ratio: Math.round((honorairesConventionnes / recettesBrutes) * 100) / 100, motif: null }
}

// ── L'estimation des cotisations ───────────────────────────────────────────────────────────────

/**
 * L'arrondi du moteur de l'Urssaf (publicodes, mécanisme `arrondi`), reproduit à l'identique : sans
 * l'EPSILON ajouté avant, un montant qui tombe sur 0,5 € en binaire approché s'arrondirait de l'autre
 * côté, et l'estimation différerait d'un euro de celle de l'Urssaf pour une raison de représentation.
 */
export function arrondiUrssaf(n: number, decimales = 0): number {
  const facteur = 10 ** decimales
  return Math.round((n + Number.EPSILON) * facteur) / facteur
}

// LES CALCULS SUIVENT L'ORDRE D'OPÉRATIONS DU MOTEUR DE L'URSSAF, et c'est ce qui permet de tester
// à l'euro. Un montant multiplié par un pourcentage y est divisé par 100 APRÈS le produit, et une
// conversion entre fraction et pourcentage est arrondie à seize décimales (publicodes, `convertUnit`).
// Sans effet sur le résultat, sauf sur un demi-euro exact — mesuré : sur 18 500 € d'assiette en 2025,
// la prise en charge vaut 249,50 € au centime, et le moteur l'arrondit à 249 € par la représentation
// binaire de son calcul ; diviser le taux par 100 avant le produit donnait 250 €.
const seizeDecimales = (v: number) => +v.toFixed(16)
/** Un montant multiplié par un taux exprimé en pourcentage. */
const appliquer = (montant: number, pourcent: number) => (montant * pourcent) / 100
/** La part d'un plafond exprimée en pourcentage (« 110 % du plafond »), en euros. */
const partDuPlafond = (pourcent: number, plafond: number) => seizeDecimales(pourcent * plafond * 0.01)

type Point = readonly [pourcentDuPlafond: number, tauxEnPourcent: number]

/**
 * Taux progressif, interpolé en ligne droite entre des points (part du plafond, taux) : c'est la
 * forme des formules des articles D. 621-2 et D. 613-1, et le calcul du moteur de l'Urssaf, dans le
 * même ordre d'opérations. Sous le premier point, son taux ; au-delà du dernier, le sien.
 */
function tauxProgressif(assiette: number, plafond: number, points: readonly Point[]): number {
  for (let i = 0; i < points.length; i++) {
    const haut = partDuPlafond(points[i][0], plafond)
    if (assiette < haut) {
      if (i === 0) return points[0][1]
      const bas = partDuPlafond(points[i - 1][0], plafond)
      const coefficient = (points[i][1] - points[i - 1][1]) / (haut - bas)
      return points[i - 1][1] + (assiette - bas) * coefficient
    }
  }
  return points[points.length - 1][1]
}

// Articles D. 621-1 et D. 621-2 (décret n° 2024-688) : 8,50 % jusqu'à trois plafonds, réduit en
// dessous — 0 % sous 20 % du plafond, puis 1,5 % à 40 %, 4 % à 60 %, 6,5 % à 110 %, 7,7 % à 200 % et
// 8,5 % à 300 %, en ligne droite entre deux points ; 6,5 % sur la part au-delà de trois plafonds.
const MALADIE: readonly Point[] = [[20, 0], [40, 1.5], [60, 4], [110, 6.5], [200, 7.7], [300, 8.5]]
const MALADIE_AU_DELA_DE_TROIS_PLAFONDS = 6.5
// La prise en charge laisse au praticien 0,1 point de sa cotisation sur ses revenus conventionnés.
const MALADIE_RESTE_AU_PRATICIEN = 0.1
// Article L. 646-3 : 3,25 % sur les dépassements et l'activité non conventionnée.
const CONTRIBUTION_ADDITIONNELLE = 3.25
// Article D. 613-1 : 0 % jusqu'à 110 % du plafond, 3,10 % à partir de 140 %, en ligne droite entre.
const ALLOCATIONS_FAMILIALES: readonly Point[] = [[110, 0], [140, 3.1]]
// La prise en charge des allocations familiales d'un médecin de secteur 1 (modele-ti, « PAMC .
// participation CPAM . allocations familiales ») : la part de la cotisation que prend l'Assurance
// maladie, selon la tranche — non progressive — où tombe l'assiette de la prise en charge. Une borne
// atteinte passe à la tranche suivante, comme dans le moteur (« grille » : plancher ≤ assiette < plafond).
const PRISE_EN_CHARGE_ALLOCATIONS_SECTEUR_1: readonly (readonly [pourcentDuPlafond: number, partEnPourcent: number])[] = [
  [140, 100],
  [250, 75],
  [Infinity, 60],
]
function partPriseEnChargeAllocations(assiette: number, plafond: number): number {
  for (const [borne, part] of PRISE_EN_CHARGE_ALLOCATIONS_SECTEUR_1) {
    if (borne === Infinity || assiette < partDuPlafond(borne, plafond)) return part
  }
  return 0
}
// La CURPS (modele-ti, « PAMC . CURPS ») : 0,5 % pour un médecin, 0,1 % pour un auxiliaire médical ou
// une sage-femme, dans la limite de 0,5 % du plafond.
const TAUX_CURPS: Readonly<Record<ProfessionPamc, number>> = {
  auxiliaire_medical: 0.1,
  sage_femme: 0.1,
  medecin_secteur_1: 0.5,
  medecin_secteur_2: 0.5,
  chirurgien_dentiste: 0.3,
}

// Article D. 621-3 : 0,30 % pour les professions libérales, sur au moins 40 % du plafond et au plus
// trois plafonds.
const INDEMNITES_JOURNALIERES = 0.3

export interface EntreeEstimation {
  annee: number
  profession: ProfessionLiberale | null
  remplacant: boolean
  /** Le revenu brut social à l'euro, tel que le formulaire le porte : DD, ou −DC s'il est négatif. */
  revenuBrutSocial: number
  /**
   * Le revenu professionnel est-il positif ? Sans lui, pas de CURPS. Le moteur de l'Urssaf l'appelle
   * « revenu professionnel » : le résultat fiscal, plus la CSG non déductible et les cotisations
   * facultatives. L'écran le lit sur le résultat de la 2035 (CP) : il se situe entre ce résultat et le
   * revenu brut social, bien plus près du premier — les deux ajouts sont petits devant les cotisations
   * obligatoires que le revenu brut social rajoute. Le verdict ne diffère donc que pour un résultat
   * voisin de zéro, où la CURPS vaut quelques euros.
   */
  revenuProfessionnelPositif: boolean
  /** DSCS retenu : saisi, ou la ligne 4 de la 2035-A. */
  recettesBrutes: number
  /** DSAV. */
  honorairesConventionnes: number | null
  /** DSAW ; absent : aucun dépassement. Un chirurgien-dentiste n'en a pas l'usage : son taux dentiste les porte. */
  depassements: number | null
  /** Le début d'activité, l'ACRE et le taux dentiste : OBLIGATOIRES, voir `ParametresEstimation`. */
  parametres: ParametresEstimation
}

/**
 * Les paramètres des cotisations, tels que l'appelant les a lus — jamais un défaut.
 *  - `tenus: false` : leur migration n'est pas en base (`PARAMETRES_DES_COTISATIONS_EXPORTES` baissé) ;
 *    l'estimation d'hier, une activité ouverte avant l'exercice, sans ACRE, un chirurgien-dentiste refusé.
 *  - `tenus: true` : chaque valeur telle que le cabinet l'a saisie, nulle tant qu'il ne l'a pas dite — le
 *    début d'activité du dossier (AAAA-MM-JJ), l'ACRE et le taux dentiste de l'exercice (0 à 1, au centième).
 */
export type ParametresEstimation =
  | { tenus: false }
  | { tenus: true; debutActivite: string | null; acre: boolean | null; tauxDentiste: number | null }

export interface EstimationCotisations {
  plafond: number
  /** Le plafond aux jours d'activité de l'année (le moteur : « PASS proratisé ») ; le plafond annuel hors de l'année de la création. */
  plafondProratise: number
  /** L'ACRE joue-t-elle sur l'exercice ? Dite, elle ne joue qu'à moins d'un an d'activité au 1er janvier. */
  acreAppliquee: boolean
  abattement: number
  assiette: number
  csgCrdsDeductible: number
  csgCrdsNonDeductible: number
  /** La cotisation maladie-maternité, avant la prise en charge. */
  maladie: number
  priseEnChargeMaladie: number
  /** La part des allocations familiales que prend l'Assurance maladie : un médecin de secteur 1 seul. */
  priseEnChargeAllocationsFamiliales: number
  contributionAdditionnelle: number
  indemnitesJournalieres: number
  /** La cotisation d'allocations familiales, avant la prise en charge. */
  allocationsFamiliales: number
  curps: number
  formationProfessionnelle: number
  /** Ce qui reste à la charge du praticien, prises en charge déduites. */
  total: number
}

export type ResultatEstimation = { disponible: true; estimation: EstimationCotisations } | { disponible: false; motif: string }

// ── L'activité de l'exercice : l'année de la création, l'ACRE ─────────────────────────────────────

/** « 1 an » du moteur de l'Urssaf, en jours : la proratisation y divise toujours par 365, même une année bissextile. */
export const JOURS_PAR_AN = 365
const FORME_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Le jour d'une date civile (AAAA-MM-JJ) depuis l'époque, sans fuseau ; null si la date n'existe pas. */
function jourCivil(iso: string): number | null {
  const m = FORME_DATE.exec(iso)
  if (!m) return null
  const [a, mo, j] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = Date.UTC(a, mo - 1, j)
  const d = new Date(t)
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== j) return null
  return t / 86_400_000
}

/** Ce que le début d'activité fait à l'exercice, comme le moteur le compte (« entreprise . durée d'activité … »). */
export interface ActiviteDeLExercice {
  /** Les jours d'activité de l'exercice : 365 hors de l'année de la création (« prorata temporis »). */
  joursCetteAnnee: number
  /** Créée après le 1er janvier : pas de CURPS (« date de création <= période . début d'année »). */
  creeeApresLePremierJanvier: boolean
  /** Les jours d'activité au 1er janvier, jamais négatifs (« durée d'activité . en début d'année »). */
  joursAuPremierJanvier: number
  /** Créée avant 2026 : l'ACRE exonère jusqu'au tout ; depuis, jusqu'au quart (« exonération maximale »). */
  creeeAvant2026: boolean
  /** Les jours d'activité au 31 décembre, ce jour compris (« durée d'activité . en fin d'année ») : les deux premières années de la CARMF. */
  joursAuTrenteEtUn: number
}

type Activite = { activite: ActiviteDeLExercice; motif: null } | { activite: null; motif: string }

export function activiteDeLExercice(annee: number, debutActivite: string): Activite {
  const debut = jourCivil(debutActivite)
  const premierJanvier = jourCivil(`${annee}-01-01`)
  const trenteEtUn = jourCivil(`${annee}-12-31`)
  const an2026 = jourCivil('2026-01-01')
  if (debut === null || premierJanvier === null || trenteEtUn === null || an2026 === null) {
    return { activite: null, motif: 'La date de début d’activité est illisible : la ressaisir.' }
  }
  if (debut > trenteEtUn) {
    return { activite: null, motif: `L’activité commence après l’exercice ${annee} : il n’a pas de cotisations à estimer.` }
  }
  const creeeCetteAnnee = debut >= premierJanvier
  return {
    activite: {
      joursCetteAnnee: creeeCetteAnnee ? trenteEtUn - debut + 1 : JOURS_PAR_AN,
      creeeApresLePremierJanvier: debut > premierJanvier,
      joursAuPremierJanvier: Math.max(0, premierJanvier - debut),
      creeeAvant2026: debut < an2026,
      joursAuTrenteEtUn: trenteEtUn - debut + 1,
    },
    motif: null,
  }
}

/** Une activité ouverte avant l'exercice : l'estimation d'hier, que l'appelant demande tant que les paramètres ne sont pas tenus. */
export const ACTIVITE_OUVERTE_AVANT: ActiviteDeLExercice = {
  joursCetteAnnee: JOURS_PAR_AN,
  creeeApresLePremierJanvier: false,
  joursAuPremierJanvier: JOURS_PAR_AN * 10,
  creeeAvant2026: true,
  joursAuTrenteEtUn: JOURS_PAR_AN * 11,
}

/**
 * Le taux d'exonération de l'ACRE sur une cotisation de la forme assiette × taux (indemnités journalières,
 * allocations familiales), en pourcentage, prorata compris : le moteur (« Acre . exonération . taux … ») le
 * tire de la formule de l'article D. 131-6-1 — (plafond − assiette) × E / plafond, E la cotisation à 75 % du
 * plafond — ramenée au rapport à la cotisation, 0,75 × (plafond − assiette) / assiette, rapporté au quart.
 */
function tauxExonerationAcre(assiette: number, plafondProratise: number, maximum: number, creeeAvant2026: boolean, prorata: number): number {
  let taux: number
  if (assiette > plafondProratise) taux = 0
  else if (assiette < appliquer(plafondProratise, 75)) taux = maximum
  else taux = seizeDecimales((((plafondProratise - assiette) / assiette) * (creeeAvant2026 ? 3 : 0.75)) / 0.01)
  return appliquer(taux, prorata)
}

/** Une cotisation diminuée d'un pourcentage (le mécanisme `abattement` du moteur, qui ne descend jamais sous zéro). */
const abattue = (montant: number, pourcent: number) => Math.max(0, montant - appliquer(montant, pourcent))

export function estimerCotisationsUrssaf(e: EntreeEstimation): ResultatEstimation {
  if (e.annee < PREMIER_EXERCICE_REVENU_BRUT_SOCIAL) {
    return { disponible: false, motif: `L'estimation suit la nouvelle assiette, en vigueur depuis les revenus ${PREMIER_EXERCICE_REVENU_BRUT_SOCIAL}.` }
  }
  const plafond = PLAFONDS_SECURITE_SOCIALE[e.annee]
  if (plafond === undefined) {
    return { disponible: false, motif: `Le plafond de la sécurité sociale ${e.annee} n'est pas encore saisi dans l'application.` }
  }
  const profession = e.profession
  if (profession === null) {
    return { disponible: false, motif: 'Choisissez la profession pour estimer les cotisations.' }
  }
  const p = e.parametres
  if (profession === 'chirurgien_dentiste' && !p.tenus) {
    return {
      disponible: false,
      motif:
        'Estimation proposée pour les auxiliaires médicaux, les sages-femmes et les médecins de secteur 1 ' +
        'ou 2 : la prise en charge d’un chirurgien-dentiste se calcule sur le « taux dentiste » de son ' +
        'relevé SNIR, que l’application ne tient pas encore.',
    }
  }
  // Les paramètres tenus : chacun dit, ou l'estimation se tait en disant lequel manque.
  let activite = ACTIVITE_OUVERTE_AVANT
  let acre = false
  let tauxDentiste = 0
  if (p.tenus) {
    if (p.debutActivite === null) {
      return {
        disponible: false,
        motif:
          'Saisissez la date de début d’activité du praticien : l’année où elle commence, le plafond se ' +
          'proratise et la CURPS n’est pas due ; l’année qui suit, l’ACRE peut encore jouer.',
      }
    }
    const lue = activiteDeLExercice(e.annee, p.debutActivite)
    if (lue.activite === null) return { disponible: false, motif: lue.motif }
    activite = lue.activite
    if (profession === 'chirurgien_dentiste') {
      if (p.tauxDentiste === null) {
        return {
          disponible: false,
          motif: `Saisissez le « taux dentiste » du relevé SNIR ${e.annee} : la prise en charge d’un chirurgien-dentiste se calcule sur lui.`,
        }
      }
      if (!(p.tauxDentiste >= 0 && p.tauxDentiste <= 1) || arrondiUrssaf(p.tauxDentiste, 2) !== p.tauxDentiste) {
        return { disponible: false, motif: 'Le taux dentiste se lit entre 0 et 1, au centième, comme le relevé SNIR le porte.' }
      }
      tauxDentiste = p.tauxDentiste
    }
    // L'ACRE ne joue qu'à moins d'un an d'activité au 1er janvier (« applicable si … en début d'année < 1 an »).
    if (activite.joursAuPremierJanvier < JOURS_PAR_AN) {
      if (p.acre === null) {
        return {
          disponible: false,
          motif: `Dites si le praticien bénéficie de l’ACRE en ${e.annee} : son activité a moins d’un an au 1er janvier, ou commence dans l’année.`,
        }
      }
      acre = p.acre
    }
  }

  // Une profession de la CIPAV n'a ni SNIR ni prise en charge : ses honoraires conventionnés ne se lisent pas, et valent
  // zéro, ce qui annule la prise en charge ; la contribution de 3,25 % et la CURPS, propres aux praticiens conventionnés
  // (modele-ti, « PAMC . contribution maladie additionnelle », « PAMC . CURPS »), ne la touchent pas non plus.
  const cipav = profession === 'liberal_cipav'
  if (!cipav) {
    const ratio = ratioConventionne(e.honorairesConventionnes, e.recettesBrutes)
    if (ratio.ratio === null) return { disponible: false, motif: ratio.motif }
  }
  const honoraires = cipav ? 0 : (e.honorairesConventionnes ?? 0)
  const depassements = cipav ? 0 : (e.depassements ?? 0)
  if (depassements > honoraires) {
    return { disponible: false, motif: 'Les dépassements (DSAW) ne peuvent pas dépasser les honoraires conventionnés (DSAV).' }
  }

  // Le plafond aux jours d'activité (« PASS proratisé ») : le taux de maladie, ses trois plafonds et le taux
  // des allocations familiales le prennent ; l'abattement, les indemnités journalières, la CURPS, la formation
  // professionnelle et la prise en charge des allocations familiales gardent le plafond annuel, comme le moteur.
  const plafondProratise = arrondiUrssaf(appliquer(plafond, seizeDecimales(activite.joursCetteAnnee / JOURS_PAR_AN / 0.01)))

  // L'assiette : revenu brut social moins 26 %, l'abattement borné entre 1,76 % et 130 % du plafond
  // (décret n° 2024-688, article 1), jamais négative. La même pour les cotisations et la CSG-CRDS
  // tant qu'il n'y a pas de revenu de remplacement.
  const abattement = arrondiUrssaf(
    Math.min(Math.max(appliquer(e.revenuBrutSocial, 26), appliquer(plafond, 1.76)), appliquer(plafond, 130)),
  )
  const assiette = arrondiUrssaf(Math.max(0, e.revenuBrutSocial - abattement))

  const csgCrdsDeductible = arrondiUrssaf(appliquer(assiette, 6.8))
  const csgCrdsNonDeductible = arrondiUrssaf(appliquer(assiette, 2.9))

  // La maladie avant toute exonération, non arrondie : le barème du moteur, sur une assiette donnée.
  const maladieAvant = (a: number) => {
    if (a === 0) return 0
    const taux = arrondiUrssaf(tauxProgressif(a, plafondProratise, MALADIE), 2)
    return (
      Math.min(a, 3 * plafondProratise) * seizeDecimales(taux * 0.01) +
      (a > 3 * plafondProratise ? (a - 3 * plafondProratise) * seizeDecimales(MALADIE_AU_DELA_DE_TROIS_PLAFONDS * 0.01) : 0)
    )
  }

  // L'ACRE (art. D. 131-6-1, « exonérations . Acre ») : l'exonération au plus — le tout pour une création
  // d'avant 2026, le quart depuis —, au prorata des jours d'ACRE qui restent dans l'année.
  const maximumAcre = activite.creeeAvant2026 ? 100 : 25
  const prorataAcre = seizeDecimales((JOURS_PAR_AN - activite.joursAuPremierJanvier) / JOURS_PAR_AN / 0.01)
  let exonerationMaladie = 0
  if (acre && assiette <= plafondProratise) {
    const seuil = appliquer(plafondProratise, 75)
    const brute =
      assiette < seuil
        ? appliquer(maladieAvant(assiette), maximumAcre)
        : (plafondProratise - assiette) * maladieAvant(seuil) * (1 / plafondProratise) * (activite.creeeAvant2026 ? 1 / 0.25 : 1)
    exonerationMaladie = arrondiUrssaf(appliquer(brute, prorataAcre))
  }
  // L'abattement du moteur ne descend jamais sous zéro : une exonération arrondie peut dépasser d'un demi-euro la
  // cotisation qu'elle exonère toute.
  const maladie = arrondiUrssaf(Math.max(0, maladieAvant(assiette) - exonerationMaladie))

  // La prise en charge porte sur la part conventionnée de l'assiette, dépassements retirés — pour un
  // chirurgien-dentiste, divisée par 1 + son taux dentiste, ses dépassements ignorés —, et laisse au praticien
  // 0,1 point du taux effectivement appliqué. Le reste de l'assiette paie la contribution de 3,25 %.
  const assietteConventionnee = honoraires > 0 ? assiette * (honoraires / e.recettesBrutes) : 0
  const assietteParticipation =
    honoraires === 0
      ? 0
      : profession === 'chirurgien_dentiste'
        ? assietteConventionnee * (1 - tauxDentiste / (1 + tauxDentiste))
        : assietteConventionnee * ((honoraires - depassements) / honoraires)
  const tauxEffectif = assiette > 0 ? seizeDecimales(maladie / assiette / 0.01) : 0
  // Un médecin de secteur 2 n'a pas de prise en charge (« non applicable si secteur = S2 ») ; ses
  // honoraires conventionnés, dépassements retirés, n'en restent pas moins hors de la contribution.
  const priseEnChargeMaladie =
    profession === 'medecin_secteur_2'
      ? 0
      : arrondiUrssaf(appliquer(assietteParticipation, Math.max(0, tauxEffectif - MALADIE_RESTE_AU_PRATICIEN)))
  const contributionAdditionnelle = cipav ? 0 : arrondiUrssaf(appliquer(assiette - assietteParticipation, CONTRIBUTION_ADDITIONNELLE))

  const assietteIndemnites = Math.min(Math.max(assiette, arrondiUrssaf(appliquer(plafond, 40))), plafond * 3)
  const exonerationIndemnites = acre
    ? tauxExonerationAcre(assietteIndemnites, plafondProratise, maximumAcre, activite.creeeAvant2026, prorataAcre)
    : 0
  const indemnitesJournalieres = arrondiUrssaf(abattue(appliquer(assietteIndemnites, INDEMNITES_JOURNALIERES), exonerationIndemnites))

  const tauxAllocations = arrondiUrssaf(tauxProgressif(assiette, plafondProratise, ALLOCATIONS_FAMILIALES), 2)
  // L'ACRE des allocations familiales, recopiée du moteur, n'a pas d'effet en métropole : elle ne joue que sous le plafond
  // proratisé, où la cotisation est nulle (son taux part de 110 %). Elle en aurait outre-mer, que l'estimation ne couvre pas.
  const allocationsAvant = arrondiUrssaf(appliquer(assiette, tauxAllocations))
  const exonerationAllocations =
    acre && assiette > 0 ? tauxExonerationAcre(assiette, plafondProratise, maximumAcre, activite.creeeAvant2026, prorataAcre) : 0
  const allocationsFamiliales = arrondiUrssaf(abattue(allocationsAvant, exonerationAllocations))
  const priseEnChargeAllocationsFamiliales =
    profession === 'medecin_secteur_1'
      ? arrondiUrssaf(appliquer(allocationsFamiliales, partPriseEnChargeAllocations(assietteParticipation, plafond)))
      : 0

  // CURPS : pas pour un remplaçant, ni sans revenu professionnel, ni l'année d'une création après le 1er janvier.
  const curps =
    !cipav && !e.remplacant && e.revenuProfessionnelPositif && !activite.creeeApresLePremierJanvier
      ? arrondiUrssaf(Math.min(appliquer(assiette, TAUX_CURPS[profession]), appliquer(plafond, 0.5)))
      : 0

  const formationProfessionnelle = arrondiUrssaf(appliquer(plafond, 0.25))

  const total =
    csgCrdsDeductible + csgCrdsNonDeductible + (maladie - priseEnChargeMaladie) + contributionAdditionnelle +
    indemnitesJournalieres + (allocationsFamiliales - priseEnChargeAllocationsFamiliales) + curps + formationProfessionnelle

  return {
    disponible: true,
    estimation: {
      plafond,
      plafondProratise,
      acreAppliquee: acre,
      abattement,
      assiette,
      csgCrdsDeductible,
      csgCrdsNonDeductible,
      maladie,
      priseEnChargeMaladie,
      priseEnChargeAllocationsFamiliales,
      contributionAdditionnelle,
      indemnitesJournalieres,
      allocationsFamiliales,
      curps,
      formationProfessionnelle,
      total,
    },
  }
}

/**
 * Ce que vaut l'abattement retenu : 26 % du revenu, ou l'une de ses bornes. L'écran le dit, parce
 * qu'« abattement de 26 % » écrit au-dessus d'un montant qui n'est pas 26 % du revenu serait une
 * affirmation fausse — sur un revenu faible, c'est le plancher qui s'applique, et l'assiette tombe
 * à zéro sans que rien d'autre l'explique.
 */
export function natureAbattement(e: Pick<EstimationCotisations, 'plafond' | 'abattement'>): 'taux' | 'plancher' | 'plafond' {
  if (e.abattement === arrondiUrssaf(appliquer(e.plafond, 130))) return 'plafond'
  if (e.abattement === arrondiUrssaf(appliquer(e.plafond, 1.76))) return 'plancher'
  return 'taux'
}
