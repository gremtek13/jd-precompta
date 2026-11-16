// Ce que la carte du volet social dit de la RETRAITE d'un praticien (ligne 27.1, RET-Q5) : la règle d'affichage, pure, que le
// module de calcul (`retraiteDesLiberaux.ts`) ne porte pas. Le calcul ne se refait pas ici : on lui donne la MÊME entrée
// que celle de l'estimation de l'Urssaf, plus le seul renseignement qu'il exige en plus — le cumul emploi-retraite d'un médecin.
//
// LE CUMUL ET LA DISPENSE DES DÉBUTS D'UN MÉDECIN (RET-Q2). Leurs cases sont en base depuis le 15/11/2026 (migration
// `cumul_et_dispense_du_medecin`, `CASES_DU_MEDECIN_PREVUES` levé) : l'un et l'autre viennent des paramètres de l'exercice,
// que la carte des paramètres offre (`CasesDeLaRetraite`). L'EXONÉRATION DE 2025 EN ZONE D'INTERVENTION PRIORITAIRE
// (RET2-Q2) suit les deux cases : tenue quand sa migration est en base (`EXONERATION_EN_ZONE_PRIORITAIRE_PREVUE`, baissé
// jusqu'à son application), lue de l'exercice, passée au module pour un médecin seulement. Baissé — l'état d'avant, que les tests jouent encore —, l'écran
// demande le cumul par un choix LOCAL, non enregistré, SANS valeur par défaut, et la dispense n'est pas tenue (le
// complémentaire compté dû, et dit). « Non
// renseigné » est un état à part, jamais « non » : tant qu'un médecin ne l'a pas dit, le module refuse et dit pourquoi, et
// aucun montant ne s'affiche. Les autres professions n'ont pas à le dire, et un choix resté d'un médecin ne leur est jamais
// passé.
//
// LA CIPAV (ligne 27.1, RET-Q1, 11/11/2026) : sa retraite est RECOUVRÉE PAR L'URSSAF, pas par une caisse. La section le
// dit (titre, phrase de l'appel, total), n'a pas de ligne de PCV (régime qu'elle n'a pas : jamais une ligne à zéro), et le
// total qu'appelle l'Urssaf — celui que la régularisation confronte à ses échéances — la comprend (`definitivesDeLUrssaf`).

import type { ProfessionLiberale } from './types'
import {
  CAISSE_DE_LA_PROFESSION, estimerRetraite,
  type CaisseDeRetraite, type EntreeRetraite, type EstimationRetraite, type ExonerationEnZonePrioritaire, type HypotheseRetraite,
  type ResultatRetraite,
} from './retraiteDesLiberaux'
import type { EntreeEstimation, ResultatEstimation } from './voletSocialPamc'

export type CumulChoisi = 'non_renseigne' | 'oui' | 'non'

export const NOMS_DES_CAISSES: Readonly<Record<CaisseDeRetraite, string>> = {
  carpimko: 'CARPIMKO',
  carmf: 'CARMF',
  carcdsf: 'CARCDSF',
  cipav: 'CIPAV',
}

export const PHRASE_DE_LA_CAISSE =
  'La caisse appelle ces cotisations sur un revenu antérieur, puis régularise : ce n’est pas l’échéancier de l’année.'

/** Pour la CIPAV, l'Urssaf appelle la retraite avec ses propres cotisations : l'échéancier est le sien. */
export const PHRASE_DE_L_URSSAF_POUR_LA_CIPAV =
  'L’Urssaf appelle ces cotisations avec les siennes, à titre provisionnel sur un revenu antérieur, puis régularise : ce n’est pas l’échéancier de l’année.'

export function phraseDeLaCaisse(profession: ProfessionLiberale | null): string {
  return caisseDe(profession) === 'cipav' ? PHRASE_DE_L_URSSAF_POUR_LA_CIPAV : PHRASE_DE_LA_CAISSE
}

/** Tant que l'écran n'offre pas la CIPAV (`PROFESSIONS_CIPAV_PREVUES` baissé), l'estimation la dit hors de son champ. */
export const CE_QUE_L_ESTIMATION_NE_FAIT_PAS =
  'Hors CIPAV, exonération pour incapacité d’exercice, conjoint collaborateur, outre-mer et cotisations facultatives.'

/** Ce que l'estimation ne fait pas, selon que l'écran offre la CIPAV ou non. */
export function ceQueLEstimationNeFaitPas(cipavOfferte: boolean): string {
  return cipavOfferte
    ? 'Hors exonération pour incapacité d’exercice, conjoint collaborateur, outre-mer, cotisations facultatives, et professions libérales non réglementées encore affiliées à la CIPAV.'
    : CE_QUE_L_ESTIMATION_NE_FAIT_PAS
}

export function caisseDe(profession: ProfessionLiberale | null): CaisseDeRetraite | null {
  return profession === null ? null : CAISSE_DE_LA_PROFESSION[profession]
}

/** Le titre de la section : la caisse nommée quand la profession la désigne, toutes celles que l'écran offre sinon. */
export function titreDeLaRetraite(profession: ProfessionLiberale | null, cipavOfferte: boolean): string {
  const caisse = caisseDe(profession)
  if (caisse === 'cipav') return 'Retraite (CIPAV, recouvrée par l’Urssaf)'
  if (caisse !== null) return `Retraite (caisse : ${NOMS_DES_CAISSES[caisse]})`
  return cipavOfferte
    ? 'Retraite (caisse : CARPIMKO, CARMF, CARCDSF ou CIPAV selon la profession)'
    : 'Retraite (caisse : CARPIMKO, CARMF ou CARCDSF selon la profession)'
}

/** Seul un médecin (CARMF) a à dire son cumul emploi-retraite. */
export const demandeLeCumul = (profession: ProfessionLiberale | null): boolean => caisseDe(profession) === 'carmf'

/** Ce que le module reçoit : nul hors d'un médecin, nul tant qu'il ne l'a pas dit, jamais un « non » deviné. */
export function cumulDeLEntree(profession: ProfessionLiberale | null, choix: CumulChoisi): boolean | null {
  if (!demandeLeCumul(profession) || choix === 'non_renseigne') return null
  return choix === 'oui'
}

/**
 * Ce que l'écran sait d'un médecin (RET-Q2) : sans les cases en base, le cumul choisi localement, la dispense non tenue ; les
 * cases en base, l'une et l'autre lues de l'exercice, nulles tant que le cabinet ne les a pas dites — et l'exonération de 2025
 * en zone d'intervention prioritaire (RET2-Q2), tenue ou non selon que sa migration est en base.
 */
export type CasesDeLaRetraite =
  | { tenues: false; cumulChoisi: CumulChoisi }
  | { tenues: true; cumul: boolean | null; dispense: boolean | null; exoneration: ExonerationEnZonePrioritaire }

/** Le cumul que le module reçoit, et que les hypothèses disent : nul hors d'un médecin. */
export function cumulDesCases(profession: ProfessionLiberale | null, cases: CasesDeLaRetraite): boolean | null {
  if (!cases.tenues) return cumulDeLEntree(profession, cases.cumulChoisi)
  return demandeLeCumul(profession) ? cases.cumul : null
}

/** La retraite estimée sur l'entrée de l'Urssaf et ce que l'écran sait du médecin. */
export function estimerLaRetraiteAffichee(entree: EntreeEstimation, cases: CasesDeLaRetraite): ResultatRetraite {
  const e: EntreeRetraite = {
    ...entree,
    cumulEmploiRetraite: cumulDesCases(entree.profession, cases),
    dispenseDesDebuts: cases.tenues
      ? { tenue: true, dispense: demandeLeCumul(entree.profession) ? cases.dispense : null }
      : { tenue: false },
    // L'exonération d'un médecin seulement : un choix resté d'un médecin n'est jamais passé à une autre profession.
    exonerationEnZonePrioritaire: cases.tenues && demandeLeCumul(entree.profession) ? cases.exoneration : { tenue: false },
  }
  return estimerRetraite(e)
}

export interface LigneDeRetraite {
  cle: 'base' | 'complementaire' | 'invalidite-deces' | 'pcv' | 'prise-en-charge' | 'total'
  libelle: string
  /** En centimes. */
  centimes: number
}

/**
 * Les lignes du tableau, dans l'ordre : les quatre cotisations (base et PCV nets de la prise en charge, dite dans leur
 * libellé), la part de l'Assurance maladie quand il y en a une — jamais une ligne à zéro qui laisserait croire qu'elle a été
 * cherchée —, puis le total à la charge du praticien.
 */
export function lignesDeLaRetraite(e: EstimationRetraite, formater: (centimes: number) => string): LigneDeRetraite[] {
  const base = e.priseEnChargeRetraiteDeBase > 0
    ? `Régime de base (CNAVPL), moins la prise en charge par l’Assurance maladie (${formater(e.priseEnChargeRetraiteDeBase)})`
    : 'Régime de base (CNAVPL)'
  const pcv = e.priseEnChargePcv > 0
    ? `Régime des praticiens conventionnés (PCV), moins la prise en charge par l’Assurance maladie (${formater(e.priseEnChargePcv)})`
    : 'Régime des praticiens conventionnés (PCV)'
  const lignes: LigneDeRetraite[] = [
    { cle: 'base', libelle: base, centimes: e.retraiteDeBase },
    { cle: 'complementaire', libelle: 'Régime complémentaire', centimes: e.retraiteComplementaire },
    { cle: 'invalidite-deces', libelle: 'Invalidité-décès', centimes: e.invaliditeDeces },
  ]
  // La CIPAV n'a pas de PCV : ce régime est celui des praticiens conventionnés.
  if (e.caisse !== 'cipav') lignes.push({ cle: 'pcv', libelle: pcv, centimes: e.pcv })
  const priseEnCharge = e.priseEnChargeRetraiteDeBase + e.priseEnChargePcv
  if (priseEnCharge > 0) {
    lignes.push({ cle: 'prise-en-charge', libelle: 'Prise en charge par l’Assurance maladie, déjà déduite ci-dessus', centimes: priseEnCharge })
  }
  lignes.push({
    cle: 'total',
    libelle: e.caisse === 'cipav' ? 'Total de la retraite, appelé par l’Urssaf' : 'Total de la retraite à la charge du praticien',
    centimes: e.total,
  })
  return lignes
}

const TEXTE_DE_L_HYPOTHESE: Readonly<Record<HypotheseRetraite, string>> = {
  'carcdsf-reduction-du-forfait-supposee-demandee':
    'CARCDSF : sous 85 % du plafond de la sécurité sociale, le forfait complémentaire est réduit ; la caisse ne l’accorde que sur demande, et l’estimation la suppose demandée.',
  'carcdsf-exoneration-des-pcv-supposee-demandee':
    'CARCDSF : les faibles revenus sont exonérés des PCV ; la caisse ne l’accorde que sur demande, et l’estimation la suppose demandée.',
  'carmf-debut-d-activite-complementaire-suppose-du':
    'CARMF : un médecin installé avant quarante ans est dispensé du complémentaire ses deux premières années ; l’application ne connaît pas l’âge, et l’estimation compte le complémentaire dû.',
  'carmf-annee-avant-l-affiliation':
    'CARMF : rien n’est compté sur cet exercice — l’activité a commencé en octobre, novembre ou décembre, et la CARMF n’affilie le médecin qu’au premier jour du trimestre civil qui suit, le 1er janvier suivant : elle n’appelle rien sur l’année du début. L’estimation tient le début d’activité saisi pour celui de l’exercice libéral du médecin : déjà affilié par une activité libérale antérieure, il cotiserait. Les cotisations de l’Urssaf, elles, sont dues dès le début.',
  'carpimko-annee-avant-l-affiliation':
    'CARPIMKO : rien n’est compté sur cet exercice — l’activité a commencé en octobre, novembre ou décembre, et la CARPIMKO n’affilie qu’au premier jour du trimestre civil qui suit le début d’activité libérale, le 1er janvier suivant : elle n’appelle rien sur l’année du début. L’estimation tient le début d’activité saisi pour celui de l’activité libérale : déjà affilié par une activité libérale antérieure, le praticien cotiserait. Les cotisations de l’Urssaf, elles, sont dues dès le début.',
  'carcdsf-annee-avant-l-affiliation':
    'CARCDSF : rien n’est compté sur cet exercice — l’activité a commencé en octobre, novembre ou décembre, et la CARCDSF n’affilie qu’au premier jour du trimestre civil qui suit le début d’activité, le 1er janvier suivant ; ses cotisations sont dues au prorata des trimestres d’affiliation, aucun sur l’année du début. L’estimation tient le début d’activité saisi pour celui de l’activité libérale : déjà affilié par une activité libérale antérieure, le praticien cotiserait. Les cotisations de l’Urssaf, elles, sont dues dès le début.',
  'carmf-complementaire-dispense':
    'CARMF : le complémentaire n’est pas compté — le cabinet a dit le médecin dispensé cet exercice (ses deux premières années d’affiliation, son activité commencée avant quarante ans).',
  'carmf-exoneration-en-zone-prioritaire':
    'CARMF : ni le régime de base, ni le complémentaire, ni les PCV ne sont comptés — le cabinet a dit le médecin exonéré de ses cotisations de retraite 2025 (cumul intégral, retraite liquidée au plus tard le 1er janvier 2025, zone d’intervention prioritaire, revenus 2025 sous 70 000 € : au-delà, elles restent dues). La CARMF régularise en 2026 et en 2027 ce qu’elle a appelé, et ces périodes n’ouvrent aucun droit nouveau au régime de base.',
  'cipav-invalidite-deces-avant-68-ans-supposee':
    'CIPAV : à partir de l’année de ses 68 ans, l’affilié n’a plus d’invalidité-décès (sauf s’il choisit de cotiser) ; l’application ne connaît pas l’âge, et l’estimation la compte due.',
}

/** Les hypothèses du module, en clair, puis ce que le cumul choisi a fait de l'invalidité-décès. */
export function hypothesesDeLaRetraite(e: EstimationRetraite, cumul: boolean | null): string[] {
  const textes = e.hypotheses.map((h) => TEXTE_DE_L_HYPOTHESE[h])
  if (cumul === true) textes.push('Cumul emploi-retraite : la CARMF n’appelle plus d’invalidité-décès.')
  return textes
}

/**
 * Les cotisations DÉFINITIVES que l'Urssaf appelle sur l'exercice, celles que la régularisation confronte à ses échéances :
 * le volet de l'Urssaf tel quel pour un praticien conventionné (sa caisse appelle sa retraite) ; pour la CIPAV, le volet
 * PLUS la retraite, que l'Urssaf recouvre aussi — et rien tant que la retraite ne s'estime pas, jamais le volet seul, qui
 * ferait croire à un trop-versé.
 */
export function definitivesDeLUrssaf(urssaf: ResultatEstimation, retraite: ResultatRetraite | null, profession: ProfessionLiberale | null): ResultatEstimation {
  if (caisseDe(profession) !== 'cipav' || !urssaf.disponible) return urssaf
  if (retraite === null || !retraite.disponible) {
    return {
      disponible: false,
      motif: `la retraite de la CIPAV, que l’Urssaf appelle aussi, ne s’estime pas${retraite === null || retraite.disponible ? '' : ` (${retraite.motif})`}.`,
    }
  }
  return { disponible: true, estimation: { ...urssaf.estimation, total: urssaf.estimation.total + retraite.estimation.total / 100 } }
}
