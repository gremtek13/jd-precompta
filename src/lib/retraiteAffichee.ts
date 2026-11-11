// Ce que la carte du volet social dit de la RETRAITE d'un praticien (ligne 27.1, RET-Q5) : la règle d'affichage, pure, que le
// module de calcul (`retraiteDesLiberaux.ts`) ne porte pas. Le calcul ne se refait pas ici : on lui donne la MÊME entrée
// que celle de l'estimation de l'Urssaf, plus le seul renseignement qu'il exige en plus — le cumul emploi-retraite d'un médecin.
//
// LE CUMUL N'EST PAS EN BASE (RET-Q2) : l'écran le demande par un choix LOCAL, non enregistré, SANS valeur par défaut. « Non
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
  type CaisseDeRetraite, type EntreeRetraite, type EstimationRetraite, type HypotheseRetraite, type ResultatRetraite,
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

/** La retraite estimée sur l'entrée de l'Urssaf et le cumul choisi. */
export function estimerLaRetraiteAffichee(entree: EntreeEstimation, choix: CumulChoisi): ResultatRetraite {
  const e: EntreeRetraite = { ...entree, cumulEmploiRetraite: cumulDeLEntree(entree.profession, choix) }
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
