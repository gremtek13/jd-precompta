// Ce que la carte du volet social dit de la RETRAITE d'un praticien (ligne 27.1, RET-Q5) : la règle d'affichage, pure, que le
// module de calcul (`retraiteDesLiberaux.ts`) ne porte pas. Le calcul ne se refait pas ici : on lui donne la MÊME entrée
// que celle de l'estimation de l'Urssaf, plus le seul renseignement qu'il exige en plus — le cumul emploi-retraite d'un médecin.
//
// LE CUMUL N'EST PAS EN BASE (RET-Q2) : l'écran le demande par un choix LOCAL, non enregistré, SANS valeur par défaut. « Non
// renseigné » est un état à part, jamais « non » : tant qu'un médecin ne l'a pas dit, le module refuse et dit pourquoi, et
// aucun montant ne s'affiche. Les autres professions n'ont pas à le dire, et un choix resté d'un médecin ne leur est jamais
// passé.

import type { ProfessionPamc } from './types'
import {
  CAISSE_DE_LA_PROFESSION, estimerRetraite,
  type CaisseDeRetraite, type EntreeRetraite, type EstimationRetraite, type HypotheseRetraite, type ResultatRetraite,
} from './retraiteDesLiberaux'
import type { EntreeEstimation } from './voletSocialPamc'

export type CumulChoisi = 'non_renseigne' | 'oui' | 'non'

export const NOMS_DES_CAISSES: Readonly<Record<CaisseDeRetraite, string>> = {
  carpimko: 'CARPIMKO',
  carmf: 'CARMF',
  carcdsf: 'CARCDSF',
}

export const PHRASE_DE_LA_CAISSE =
  'La caisse appelle ces cotisations sur un revenu antérieur, puis régularise : ce n’est pas l’échéancier de l’année.'

export const CE_QUE_L_ESTIMATION_NE_FAIT_PAS =
  'Hors CIPAV, exonération pour incapacité d’exercice, conjoint collaborateur, outre-mer et cotisations facultatives.'

export function caisseDe(profession: ProfessionPamc | null): CaisseDeRetraite | null {
  return profession === null ? null : CAISSE_DE_LA_PROFESSION[profession]
}

/** Le titre de la section : la caisse nommée quand la profession la désigne, les trois sinon. */
export function titreDeLaRetraite(profession: ProfessionPamc | null): string {
  const caisse = caisseDe(profession)
  return caisse === null
    ? 'Retraite (caisse : CARPIMKO, CARMF ou CARCDSF selon la profession)'
    : `Retraite (caisse : ${NOMS_DES_CAISSES[caisse]})`
}

/** Seul un médecin (CARMF) a à dire son cumul emploi-retraite. */
export const demandeLeCumul = (profession: ProfessionPamc | null): boolean => caisseDe(profession) === 'carmf'

/** Ce que le module reçoit : nul hors d'un médecin, nul tant qu'il ne l'a pas dit, jamais un « non » deviné. */
export function cumulDeLEntree(profession: ProfessionPamc | null, choix: CumulChoisi): boolean | null {
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
    { cle: 'pcv', libelle: pcv, centimes: e.pcv },
  ]
  const priseEnCharge = e.priseEnChargeRetraiteDeBase + e.priseEnChargePcv
  if (priseEnCharge > 0) {
    lignes.push({ cle: 'prise-en-charge', libelle: 'Prise en charge par l’Assurance maladie, déjà déduite ci-dessus', centimes: priseEnCharge })
  }
  lignes.push({ cle: 'total', libelle: 'Total de la retraite à la charge du praticien', centimes: e.total })
  return lignes
}

const TEXTE_DE_L_HYPOTHESE: Readonly<Record<HypotheseRetraite, string>> = {
  'carcdsf-reduction-du-forfait-supposee-demandee':
    'CARCDSF : sous 85 % du plafond de la sécurité sociale, le forfait complémentaire est réduit ; la caisse ne l’accorde que sur demande, et l’estimation la suppose demandée.',
  'carcdsf-exoneration-des-pcv-supposee-demandee':
    'CARCDSF : les faibles revenus sont exonérés des PCV ; la caisse ne l’accorde que sur demande, et l’estimation la suppose demandée.',
  'carmf-debut-d-activite-complementaire-suppose-du':
    'CARMF : un médecin installé avant quarante ans est dispensé du complémentaire ses deux premières années ; l’application ne connaît pas l’âge, et l’estimation compte le complémentaire dû.',
}

/** Les hypothèses du module, en clair, puis ce que le cumul choisi a fait de l'invalidité-décès. */
export function hypothesesDeLaRetraite(e: EstimationRetraite, cumul: boolean | null): string[] {
  const textes = e.hypotheses.map((h) => TEXTE_DE_L_HYPOTHESE[h])
  if (cumul === true) textes.push('Cumul emploi-retraite : la CARMF n’appelle plus d’invalidité-décès.')
  return textes
}
