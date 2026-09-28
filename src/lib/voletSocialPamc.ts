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
//    CARPIMKO (ou la CARCDSF) et non par l'Urssaf.
//
// LA RÉFÉRENCE EST LE MOTEUR DE L'URSSAF, PAS NOUS. `voletSocialPamcReference.ts` porte des cas
// calculés par `modele-ti`, le jeu de règles des simulateurs de l'Urssaf pour les indépendants (voir
// outils/cotisations/oracle.mjs), et les tests exigent l'égalité à l'euro sur chacun. Les taux de
// maladie (D. 621-1 et D. 621-2), des indemnités journalières (D. 621-3), des allocations familiales
// (D. 613-1) et la contribution de 3,25 % (L. 646-3) ont en plus été relus sur Légifrance ; la
// prise en charge par l'Assurance maladie, la CURPS et la formation professionnelle ne sont
// sourcées que par ce moteur.
//
// CE QUE L'ESTIMATION NE COUVRE PAS, et que l'écran dit : les médecins et les chirurgiens-dentistes
// (leur prise en charge et leur CURPS suivent d'autres règles), les revenus de remplacement
// (indemnités journalières perçues, qui s'ajoutent à l'assiette des cotisations), l'ACRE, les
// exonérations d'invalidité, l'outre-mer, et une activité créée dans l'année (pas de CURPS la
// première année). Et elle porte sur les cotisations DÉFINITIVES de l'exercice : la différence avec
// les provisionnelles appelées pour la même année est la régularisation, que seul l'avis de l'Urssaf
// chiffre — l'échéancier d'une année mêle les provisionnelles de l'année et la régularisation de
// la précédente.

import { PREMIER_EXERCICE_REVENU_BRUT_SOCIAL } from './cases2035'
import type { ProfessionPamc, VoletSocialPamc } from './types'

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

/** Les professions dont l'application estime les cotisations : leurs règles Urssaf sont identiques. */
const PROFESSIONS_ESTIMEES: readonly ProfessionPamc[] = ['auxiliaire_medical', 'sage_femme']

export const LIBELLES_PROFESSION: Readonly<Record<ProfessionPamc, string>> = {
  auxiliaire_medical: 'Auxiliaire médical',
  sage_femme: 'Sage-femme',
  medecin_secteur_1: 'Médecin, secteur 1',
  medecin_secteur_2: 'Médecin, secteur 2',
  chirurgien_dentiste: 'Chirurgien-dentiste',
}

/**
 * Qui compte comme auxiliaire médical ici. Dit SOUS la liste déroulante et non dans son libellé : une
 * liste déroulante prend la largeur de son plus long choix, et celui-ci faisait déborder le panneau
 * central de 188 pixels, panneau de droite ouvert (outils/captures/debordements.mjs).
 */
export const AUXILIAIRES_MEDICAUX = 'infirmier, masseur-kinésithérapeute, orthophoniste, orthoptiste, pédicure-podologue'

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
// Article D. 621-3 : 0,30 % pour les professions libérales, sur au moins 40 % du plafond et au plus
// trois plafonds.
const INDEMNITES_JOURNALIERES = 0.3

export interface EntreeEstimation {
  annee: number
  profession: ProfessionPamc | null
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
  /** DSAW ; absent : aucun dépassement. */
  depassements: number | null
}

export interface EstimationCotisations {
  plafond: number
  abattement: number
  assiette: number
  csgCrdsDeductible: number
  csgCrdsNonDeductible: number
  /** La cotisation maladie-maternité, avant la prise en charge. */
  maladie: number
  priseEnChargeMaladie: number
  contributionAdditionnelle: number
  indemnitesJournalieres: number
  allocationsFamiliales: number
  curps: number
  formationProfessionnelle: number
  /** Ce qui reste à la charge du praticien, prise en charge déduite. */
  total: number
}

export type ResultatEstimation = { disponible: true; estimation: EstimationCotisations } | { disponible: false; motif: string }

export function estimerCotisationsUrssaf(e: EntreeEstimation): ResultatEstimation {
  if (e.annee < PREMIER_EXERCICE_REVENU_BRUT_SOCIAL) {
    return { disponible: false, motif: `L'estimation suit la nouvelle assiette, en vigueur depuis les revenus ${PREMIER_EXERCICE_REVENU_BRUT_SOCIAL}.` }
  }
  const plafond = PLAFONDS_SECURITE_SOCIALE[e.annee]
  if (plafond === undefined) {
    return { disponible: false, motif: `Le plafond de la sécurité sociale ${e.annee} n'est pas encore saisi dans l'application.` }
  }
  if (e.profession === null) {
    return { disponible: false, motif: 'Choisissez la profession pour estimer les cotisations.' }
  }
  if (!PROFESSIONS_ESTIMEES.includes(e.profession)) {
    return {
      disponible: false,
      motif:
        'Estimation proposée pour les auxiliaires médicaux et les sages-femmes seulement : la prise en ' +
        'charge et la CURPS des médecins et des chirurgiens-dentistes suivent d’autres règles.',
    }
  }
  const ratio = ratioConventionne(e.honorairesConventionnes, e.recettesBrutes)
  if (ratio.ratio === null) return { disponible: false, motif: ratio.motif }
  const honoraires = e.honorairesConventionnes ?? 0
  const depassements = e.depassements ?? 0
  if (depassements > honoraires) {
    return { disponible: false, motif: 'Les dépassements (DSAW) ne peuvent pas dépasser les honoraires conventionnés (DSAV).' }
  }

  // L'assiette : revenu brut social moins 26 %, l'abattement borné entre 1,76 % et 130 % du plafond
  // (décret n° 2024-688, article 1), jamais négative. La même pour les cotisations et la CSG-CRDS
  // tant qu'il n'y a pas de revenu de remplacement.
  const abattement = arrondiUrssaf(
    Math.min(Math.max(appliquer(e.revenuBrutSocial, 26), appliquer(plafond, 1.76)), appliquer(plafond, 130)),
  )
  const assiette = arrondiUrssaf(Math.max(0, e.revenuBrutSocial - abattement))

  const csgCrdsDeductible = arrondiUrssaf(appliquer(assiette, 6.8))
  const csgCrdsNonDeductible = arrondiUrssaf(appliquer(assiette, 2.9))

  const tauxMaladie = arrondiUrssaf(tauxProgressif(assiette, plafond, MALADIE), 2)
  const maladie =
    assiette === 0
      ? 0
      : arrondiUrssaf(
          Math.min(assiette, 3 * plafond) * seizeDecimales(tauxMaladie * 0.01) +
            (assiette > 3 * plafond ? (assiette - 3 * plafond) * seizeDecimales(MALADIE_AU_DELA_DE_TROIS_PLAFONDS * 0.01) : 0),
        )

  // La prise en charge porte sur la part conventionnée de l'assiette, dépassements retirés, et
  // laisse au praticien 0,1 point du taux effectivement appliqué. Le reste de l'assiette paie la
  // contribution de 3,25 %.
  const assietteParticipation = honoraires > 0 ? assiette * (honoraires / e.recettesBrutes) * ((honoraires - depassements) / honoraires) : 0
  const tauxEffectif = assiette > 0 ? seizeDecimales(maladie / assiette / 0.01) : 0
  const priseEnChargeMaladie = arrondiUrssaf(appliquer(assietteParticipation, Math.max(0, tauxEffectif - MALADIE_RESTE_AU_PRATICIEN)))
  const contributionAdditionnelle = arrondiUrssaf(appliquer(assiette - assietteParticipation, CONTRIBUTION_ADDITIONNELLE))

  const assietteIndemnites = Math.min(Math.max(assiette, arrondiUrssaf(appliquer(plafond, 40))), plafond * 3)
  const indemnitesJournalieres = arrondiUrssaf(appliquer(assietteIndemnites, INDEMNITES_JOURNALIERES))

  const tauxAllocations = arrondiUrssaf(tauxProgressif(assiette, plafond, ALLOCATIONS_FAMILIALES), 2)
  const allocationsFamiliales = arrondiUrssaf(appliquer(assiette, tauxAllocations))

  // CURPS : 0,1 % pour ces professions, dans la limite de 0,5 % du plafond ; pas pour un remplaçant,
  // ni sans revenu professionnel.
  const curps = !e.remplacant && e.revenuProfessionnelPositif ? arrondiUrssaf(Math.min(appliquer(assiette, 0.1), appliquer(plafond, 0.5))) : 0

  const formationProfessionnelle = arrondiUrssaf(appliquer(plafond, 0.25))

  const total =
    csgCrdsDeductible + csgCrdsNonDeductible + (maladie - priseEnChargeMaladie) + contributionAdditionnelle +
    indemnitesJournalieres + allocationsFamiliales + curps + formationProfessionnelle

  return {
    disponible: true,
    estimation: {
      plafond,
      abattement,
      assiette,
      csgCrdsDeductible,
      csgCrdsNonDeductible,
      maladie,
      priseEnChargeMaladie,
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
