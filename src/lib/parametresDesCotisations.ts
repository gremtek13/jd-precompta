import type { ParametresEstimation } from './voletSocialPamc'

// LES PARAMÈTRES DES COTISATIONS (ligne 27, TNS-Q1 et TNS-Q4, réponses du cabinet du 07/11/2026) : le début d'activité du
// dossier, et pour chaque exercice le bénéfice de l'ACRE et le « taux dentiste » du relevé SNIR d'un chirurgien-dentiste.
// La migration `parametres_des_cotisations` (supabase/schema/20261107165534_parametres_des_cotisations.sql), en
// production depuis le 07/11/2026, pose `debuts_d_activite` (à part de `dossiers`, que le client lit) et `parametres_des_cotisations` (figée avec
// l'exercice validé) ; `enregistrer_parametres_des_cotisations` les écrit d'un seul tenant, contre les valeurs lues.
// L'estimation des cotisations les reçoit en entrée OBLIGATOIRE (`ParametresEstimation`, lib/voletSocialPamc.ts). Le
// récit : HISTORIQUE.md, « 07/11/2026 — LES PARAMÈTRES DES COTISATIONS : LE DÉBUT D'ACTIVITÉ, L'ACRE ET LE TAUX
// DENTISTE (TNS-Q1, TNS-Q4) (PRÉPARÉE, PAS APPLIQUÉE) ».
//
// SOURCES. Le moteur des simulateurs de l'Urssaf, `modele-ti` 0.1.0 (outils/cotisations/oracle.mjs) : « entreprise .
// date de création », « cotisations . exonérations . Acre », « PAMC . assiette participation CPAM . taux dentiste »
// (plancher 0, plafond 1, arrondi au centième). Code de la sécurité sociale, art. D. 131-6-1. Convention nationale des
// chirurgiens-dentistes libéraux, art. 51.

// LE DRAPEAU DE LA MIGRATION, LEVÉ le 07/11/2026, le jour de son application : la carte du volet social (onglet Clôture)
// et la sauvegarde (`auPlanDesParametresDesCotisations`, lib/sauvegarde.ts) lisent les deux tables. Baissé — son état
// d'avant, que les tests jouent (`lireLesParametresDesCotisationsSelon(…, false)`, `vi.mock`) —, rien ne les lit, et
// l'estimation reçoit `{ tenus: false }` : celle d'hier, une activité ouverte avant l'exercice, sans ACRE, un
// chirurgien-dentiste refusé.
export const PARAMETRES_DES_COTISATIONS_EXPORTES = true

// LES DEUX CASES D'UN MÉDECIN, PAR EXERCICE (ligne 27.1, RET-Q2, tranchée par le cabinet le 11/11/2026 : « Oui, avec
// l'écran ») : le cumul emploi-retraite et la dispense du complémentaire de la CARMF des deux premières années
// d'affiliation. La migration `cumul_et_dispense_du_medecin` (en production depuis le 15/11/2026, par l'outil, sur l'accord
// du cabinet — RET-Q2-migration ; supabase/schema/20261115074806_cumul_et_dispense_du_medecin.sql) pose les deux
// colonnes et fait accepter à `enregistrer_parametres_des_cotisations` cinq clés au lieu de trois. LEVÉ le 15/11/2026, la
// migration en base : la lecture les nomme, l'écriture part sous cinq clés, la carte les offre pour un médecin, et
// l'estimation de la retraite les reçoit en entrée obligatoire (lib/retraiteDesLiberaux.ts, `DispenseDesDebuts`). Baissé —
// l'état d'avant, que les tests jouent encore —, la lecture et l'écriture d'hier, et le cumul reste un choix local de la
// carte du volet social ; il se baisse AVANT tout retour de la migration (l'écran levé enverrait cinq clés, que la fonction
// d'hier refuse).
export const CASES_DU_MEDECIN_PREVUES: boolean = true

// L'EXONÉRATION DES COTISATIONS DE RETRAITE 2025 D'UN MÉDECIN EN CUMUL EXERÇANT EN ZONE D'INTERVENTION PRIORITAIRE (ligne
// 27.1, RET2-Q2, tranchée par le cabinet le 15/11/2026 : « (B) Une case de plus », contre la recommandation de le dire
// seulement ; loi n° 2025-199, art. 6, décret n° 2025-810, et le guide du cumul de la CARMF, juin 2026). La migration
// `exoneration_en_zone_prioritaire` (en production depuis le 17/11/2026, 236, par l'outil ;
// supabase/schema/20261117133435_exoneration_en_zone_prioritaire.sql) pose la troisième case d'un exercice, pour 2025
// seulement et avec le cumul, et fait accepter à `enregistrer_parametres_des_cotisations` six clés en plus des formes d'hier.
// LEVÉ le 17/11/2026 : la lecture la nomme, l'écriture part sous six clés, la carte l'offre pour un médecin en cumul en 2025,
// et l'estimation de la retraite la reçoit (lib/retraiteDesLiberaux.ts, `ExonerationEnZonePrioritaire`). Baissé — l'état
// d'avant, que les tests jouent encore —, la lecture, l'écriture, la carte et l'estimation d'hier ; il se baisse AVANT tout
// retour de la migration (l'écran levé enverrait six clés, que la fonction d'hier refuse).
export const EXONERATION_EN_ZONE_PRIORITAIRE_PREVUE: boolean = true

/** Le seul exercice où l'exonération se dit : les revenus de 2025 (la contrainte `parametres_des_cotisations_exoneration_de_2025`). */
export const EXERCICE_DE_L_EXONERATION = 2025

/** Les deux refus neufs de `enregistrer_parametres_des_cotisations` sous la migration, aux mots de la base (« % » : l'exercice). */
export const REFUS_EXONERATION_HORS_DE_2025 =
  "L'exonération des cotisations de retraite d'un médecin en cumul exerçant en zone d'intervention prioritaire ne vaut que pour les revenus de 2025 : elle ne se dit pas pour l'exercice %."
export const REFUS_EXONERATION_SANS_LE_CUMUL =
  "L'exonération de 2025 en zone d'intervention prioritaire ne vaut qu'en cumul emploi-retraite intégral : dis d'abord le cumul, ou retire l'exonération."

/**
 * Les deux cases d'un médecin pour un exercice, telles que lues ; nulles tant que le cabinet ne les a pas dites. La troisième,
 * l'exonération de 2025 (RET2-Q2), seulement quand elle a été lue (la migration en base).
 */
export interface CasesDuMedecin {
  cumulEmploiRetraite: boolean | null
  dispenseComplementaire: boolean | null
  exonerationZonePrioritaire?: boolean | null
}

/** Ce qu'une ligne des deux tables porte, une fois lue et crue ; `medecin` seulement quand les deux cases ont été lues. */
export interface ParametresDUnExercice {
  acre: boolean | null
  tauxDentiste: number | null
  medecin?: CasesDuMedecin
}

export type LectureDesParametres =
  | { dossierId: string; etat: 'absents' }
  | { dossierId: string; etat: 'lus'; debutActivite: string | null; parExercice: ReadonlyMap<number, ParametresDUnExercice> }
  | { dossierId: string; etat: 'incomplets'; motif: string }

const FORME_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Un taux que la base accepte (`parametres_des_cotisations_taux_dentiste`) : entre 0 et 1, au centième. */
export function tauxDentisteAdmis(taux: number): boolean {
  return Number.isFinite(taux) && taux >= 0 && taux <= 1 && Math.round(taux * 100) / 100 === taux
}

/** Le début d'activité d'une ligne lue, ou `undefined` si la ligne ne se croit pas. */
export function lireDebutActivite(ligne: unknown): string | null | undefined {
  if (typeof ligne !== 'object' || ligne === null) return undefined
  const d = (ligne as Record<string, unknown>).date_debut
  if (d === null) return null
  return typeof d === 'string' && FORME_DATE.test(d) ? d : undefined
}

/**
 * Les paramètres d'un exercice d'une ligne lue, ou null si la ligne ne se croit pas. PostgREST rend un `numeric` en nombre.
 * `avecLesCases` (par défaut, `CASES_DU_MEDECIN_PREVUES`) : les deux cases d'un médecin font partie de la ligne, et une case
 * absente ou d'une autre forme la rend illisible — jamais un « non » deviné. `avecLExoneration` (par défaut,
 * `EXONERATION_EN_ZONE_PRIORITAIRE_PREVUE`, avec les cases) : l'exonération de 2025 aussi, et une exonération dite hors de 2025
 * ou « oui » sans le cumul — ce que la base refuse — rend la ligne illisible.
 */
export function lireParametresDUnExercice(
  ligne: unknown, avecLesCases: boolean = CASES_DU_MEDECIN_PREVUES, avecLExoneration: boolean = EXONERATION_EN_ZONE_PRIORITAIRE_PREVUE,
): (ParametresDUnExercice & { annee: number }) | null {
  if (typeof ligne !== 'object' || ligne === null) return null
  const l = ligne as Record<string, unknown>
  if (typeof l.annee !== 'number' || !Number.isInteger(l.annee)) return null
  if (l.acre !== null && typeof l.acre !== 'boolean') return null
  const taux = typeof l.taux_dentiste === 'string' ? Number(l.taux_dentiste) : l.taux_dentiste
  if (taux !== null && (typeof taux !== 'number' || !tauxDentisteAdmis(taux))) return null
  if (!avecLesCases) return { annee: l.annee, acre: l.acre, tauxDentiste: taux }
  const cumul = l.cumul_emploi_retraite
  const dispense = l.dispense_complementaire
  if ((cumul !== null && typeof cumul !== 'boolean') || (dispense !== null && typeof dispense !== 'boolean')) return null
  if (!avecLExoneration) {
    return { annee: l.annee, acre: l.acre, tauxDentiste: taux, medecin: { cumulEmploiRetraite: cumul, dispenseComplementaire: dispense } }
  }
  const exoneration = l.exoneration_zone_prioritaire
  if (exoneration !== null && typeof exoneration !== 'boolean') return null
  if (exoneration !== null && l.annee !== EXERCICE_DE_L_EXONERATION) return null
  if (exoneration === true && cumul !== true) return null
  return {
    annee: l.annee, acre: l.acre, tauxDentiste: taux,
    medecin: { cumulEmploiRetraite: cumul, dispenseComplementaire: dispense, exonerationZonePrioritaire: exoneration },
  }
}

/**
 * Les deux cases d'un médecin pour un exercice, telles que l'estimation de la retraite les reçoit : nulles quand la ligne
 * de l'exercice n'existe pas encore ou ne les porte pas. Null quand les paramètres ne sont pas lus en entier, ou que les
 * cases ne sont pas en base (`absents`). `avecLExoneration` (par défaut, le drapeau de RET2-Q2) : l'exonération aussi, nulle
 * de même.
 */
export function casesDuMedecinDeLExercice(
  lecture: LectureDesParametres | null, annee: number, avecLExoneration: boolean = EXONERATION_EN_ZONE_PRIORITAIRE_PREVUE,
): CasesDuMedecin | null {
  if (lecture === null || lecture.etat !== 'lus') return null
  const medecin = lecture.parExercice.get(annee)?.medecin
  const cases = { cumulEmploiRetraite: medecin?.cumulEmploiRetraite ?? null, dispenseComplementaire: medecin?.dispenseComplementaire ?? null }
  return avecLExoneration ? { ...cases, exonerationZonePrioritaire: medecin?.exonerationZonePrioritaire ?? null } : cases
}

/**
 * Ce que l'estimation reçoit pour un exercice. Drapeau baissé (`absents`) : `{ tenus: false }`, l'estimation d'hier. Lus
 * en entier : chaque valeur telle qu'en base, nulle tant que le cabinet ne l'a pas dite. Pas encore lus, ou lus en
 * partie : null — aucune estimation ne doit s'en servir, l'écran le dit.
 */
export function parametresDeLEstimation(lecture: LectureDesParametres | null, annee: number): ParametresEstimation | null {
  if (lecture === null || lecture.etat === 'incomplets') return null
  if (lecture.etat === 'absents') return { tenus: false }
  const exercice = lecture.parExercice.get(annee)
  return {
    tenus: true,
    debutActivite: lecture.debutActivite,
    acre: exercice?.acre ?? null,
    tauxDentiste: exercice?.tauxDentiste ?? null,
  }
}

// ── La saisie ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Ce que le formulaire porte : la date telle que le champ la rend, l'ACRE en trois états, le taux tel que tapé ; et, sous
 * `CASES_DU_MEDECIN_PREVUES`, les deux cases d'un médecin en trois états (« » : non dit) ; sous
 * `EXONERATION_EN_ZONE_PRIORITAIRE_PREVUE`, l'exonération de 2025 de même.
 */
export interface SaisieDesParametres {
  debutActivite: string
  acre: 'oui' | 'non' | ''
  tauxDentiste: string
  cumul: 'oui' | 'non' | ''
  dispense: 'oui' | 'non' | ''
  exoneration: 'oui' | 'non' | ''
}

/**
 * Les valeurs telles que la fonction les reçoit (`p_lus`, `p_saisis`) : les trois clés d'hier, ou, les deux cases en base
 * (RET-Q2), les cinq, ou, l'exonération en base (RET2-Q2), les six — la même forme des deux côtés, que la fonction exige.
 */
export interface ValeursDesParametres {
  debut_activite: string | null
  acre: boolean | null
  taux_dentiste: number | null
  cumul_emploi_retraite?: boolean | null
  dispense_complementaire?: boolean | null
  exoneration_zone_prioritaire?: boolean | null
}

const ouiNon = (v: boolean | null): 'oui' | 'non' | '' => (v === null ? '' : v ? 'oui' : 'non')
const versBooleen = (v: 'oui' | 'non' | ''): boolean | null => (v === '' ? null : v === 'oui')

export function valeursLues(
  lecture: Extract<LectureDesParametres, { etat: 'lus' }>, annee: number, avecLesCases: boolean = CASES_DU_MEDECIN_PREVUES,
  avecLExoneration: boolean = EXONERATION_EN_ZONE_PRIORITAIRE_PREVUE,
): ValeursDesParametres {
  const exercice = lecture.parExercice.get(annee)
  const valeurs: ValeursDesParametres = {
    debut_activite: lecture.debutActivite, acre: exercice?.acre ?? null, taux_dentiste: exercice?.tauxDentiste ?? null,
  }
  if (!avecLesCases) return valeurs
  const cases: ValeursDesParametres = {
    ...valeurs,
    cumul_emploi_retraite: exercice?.medecin?.cumulEmploiRetraite ?? null,
    dispense_complementaire: exercice?.medecin?.dispenseComplementaire ?? null,
  }
  return avecLExoneration ? { ...cases, exoneration_zone_prioritaire: exercice?.medecin?.exonerationZonePrioritaire ?? null } : cases
}

export function saisieDe(valeurs: ValeursDesParametres): SaisieDesParametres {
  return {
    debutActivite: valeurs.debut_activite ?? '',
    acre: ouiNon(valeurs.acre),
    tauxDentiste: valeurs.taux_dentiste === null ? '' : String(valeurs.taux_dentiste).replace('.', ','),
    cumul: ouiNon(valeurs.cumul_emploi_retraite ?? null),
    dispense: ouiNon(valeurs.dispense_complementaire ?? null),
    exoneration: ouiNon(valeurs.exoneration_zone_prioritaire ?? null),
  }
}

/**
 * La saisie telle qu'elle part, ou le refus que la base opposerait, redit avant le clic : une date du calendrier
 * (AAAA-MM-JJ, entre 1900 et 2100, `debuts_d_activite_date`), un taux entre 0 et 1 au centième, virgule ou point.
 */
export function valeursSaisies(
  s: SaisieDesParametres, avecLesCases: boolean = CASES_DU_MEDECIN_PREVUES,
  avecLExoneration: boolean = EXONERATION_EN_ZONE_PRIORITAIRE_PREVUE,
): { valeurs: ValeursDesParametres; refus: null } | { valeurs: null; refus: string } {
  let debut: string | null = null
  if (s.debutActivite.trim() !== '') {
    const d = s.debutActivite.trim()
    // Une date du calendrier : ses trois parties relues telles quelles, sans fuseau (le 30 février se refuse).
    const [a, m, j] = FORME_DATE.test(d) ? d.split('-').map(Number) : [Number.NaN, Number.NaN, Number.NaN]
    const jour = new Date(Date.UTC(a, m - 1, j))
    const existe = jour.getUTCFullYear() === a && jour.getUTCMonth() === m - 1 && jour.getUTCDate() === j
    if (!existe || d < '1900-01-01' || d > '2100-12-31') {
      return { valeurs: null, refus: 'La date de début d’activité n’est pas une date du calendrier.' }
    }
    debut = d
  }
  let taux: number | null = null
  if (s.tauxDentiste.trim() !== '') {
    const t = s.tauxDentiste.trim().replace(',', '.')
    const n = /^\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN
    if (!tauxDentisteAdmis(n)) {
      return { valeurs: null, refus: 'Le taux dentiste se saisit entre 0 et 1, au centième, comme le relevé SNIR le porte (par exemple 0,35).' }
    }
    taux = n
  }
  const valeurs: ValeursDesParametres = { debut_activite: debut, acre: versBooleen(s.acre), taux_dentiste: taux }
  if (avecLesCases) {
    valeurs.cumul_emploi_retraite = versBooleen(s.cumul)
    valeurs.dispense_complementaire = versBooleen(s.dispense)
    if (avecLExoneration) valeurs.exoneration_zone_prioritaire = versBooleen(s.exoneration)
  }
  return { valeurs, refus: null }
}

/**
 * Ce que la base refuserait de l'exonération, redit avant le clic sur les valeurs TELLES QU'ELLES PARTENT (RET2-Q2) : dite
 * pour un autre exercice que 2025, ou « oui » sur une ligne dont le cumul ne l'est pas — sous la forme à six clés, celle
 * que la carte envoie, l'exonération et le cumul étant tous deux dans la saisie. Nul quand rien, ou hors de cette forme.
 */
export function refusDeLExoneration(valeurs: ValeursDesParametres, annee: number): string | null {
  if (!('exoneration_zone_prioritaire' in valeurs)) return null
  const exoneration = valeurs.exoneration_zone_prioritaire ?? null
  if (exoneration !== null && annee !== EXERCICE_DE_L_EXONERATION) return REFUS_EXONERATION_HORS_DE_2025.replace('%', String(annee))
  if (exoneration === true && valeurs.cumul_emploi_retraite !== true) return REFUS_EXONERATION_SANS_LE_CUMUL
  return null
}

/** Les deux jeux de valeurs disent-ils la même chose ? Rien à enregistrer sinon. */
export function memesValeurs(a: ValeursDesParametres, b: ValeursDesParametres): boolean {
  return a.debut_activite === b.debut_activite && a.acre === b.acre && a.taux_dentiste === b.taux_dentiste
    && (a.cumul_emploi_retraite ?? null) === (b.cumul_emploi_retraite ?? null)
    && (a.dispense_complementaire ?? null) === (b.dispense_complementaire ?? null)
    && (a.exoneration_zone_prioritaire ?? null) === (b.exoneration_zone_prioritaire ?? null)
}

/** Les paramètres de `enregistrer_parametres_des_cotisations` : l'exercice, les valeurs lues qu'elles remplacent, les saisies. */
export function parametresDeLEnregistrement(dossierId: string, annee: number, lues: ValeursDesParametres, saisies: ValeursDesParametres) {
  return { p_dossier_id: dossierId, p_annee: annee, p_lus: lues, p_saisis: saisies }
}
