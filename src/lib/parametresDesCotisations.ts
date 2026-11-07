import type { ParametresEstimation } from './voletSocialPamc'

// LES PARAMÈTRES DES COTISATIONS (ligne 27, TNS-Q1 et TNS-Q4, réponses du cabinet du 07/11/2026) : le début d'activité du
// dossier, et pour chaque exercice le bénéfice de l'ACRE et le « taux dentiste » du relevé SNIR d'un chirurgien-dentiste.
// La migration préparée `parametres_des_cotisations` (supabase/preparees/20261107190000_parametres_des_cotisations.sql)
// pose `debuts_d_activite` (à part de `dossiers`, que le client lit) et `parametres_des_cotisations` (figée avec
// l'exercice validé) ; `enregistrer_parametres_des_cotisations` les écrit d'un seul tenant, contre les valeurs lues.
// L'estimation des cotisations les reçoit en entrée OBLIGATOIRE (`ParametresEstimation`, lib/voletSocialPamc.ts). Le
// récit : HISTORIQUE.md, « 07/11/2026 — LES PARAMÈTRES DES COTISATIONS : LE DÉBUT D'ACTIVITÉ, L'ACRE ET LE TAUX
// DENTISTE (TNS-Q1, TNS-Q4) (PRÉPARÉE, PAS APPLIQUÉE) ».
//
// SOURCES. Le moteur des simulateurs de l'Urssaf, `modele-ti` 0.1.0 (outils/cotisations/oracle.mjs) : « entreprise .
// date de création », « cotisations . exonérations . Acre », « PAMC . assiette participation CPAM . taux dentiste »
// (plancher 0, plafond 1, arrondi au centième). Code de la sécurité sociale, art. D. 131-6-1. Convention nationale des
// chirurgiens-dentistes libéraux, art. 51.

// LE DRAPEAU DE LA MIGRATION, BAISSÉ : la production n'a pas les tables. Baissé, rien ne les lit — ni la carte du volet
// social (onglet Clôture), ni la sauvegarde (`auPlanDesParametresDesCotisations`, lib/sauvegarde.ts) —, et l'estimation
// reçoit `{ tenus: false }` : celle d'hier, une activité ouverte avant l'exercice, sans ACRE, un chirurgien-dentiste
// refusé. Il se lève quand la migration est en base et dans l'export, en simulation d'abord, la suite ENTIÈRE.
export const PARAMETRES_DES_COTISATIONS_EXPORTES = false

/** Ce qu'une ligne des deux tables porte, une fois lue et crue. */
export interface ParametresDUnExercice {
  acre: boolean | null
  tauxDentiste: number | null
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

/** Les paramètres d'un exercice d'une ligne lue, ou null si la ligne ne se croit pas. PostgREST rend un `numeric` en nombre. */
export function lireParametresDUnExercice(ligne: unknown): (ParametresDUnExercice & { annee: number }) | null {
  if (typeof ligne !== 'object' || ligne === null) return null
  const l = ligne as Record<string, unknown>
  if (typeof l.annee !== 'number' || !Number.isInteger(l.annee)) return null
  if (l.acre !== null && typeof l.acre !== 'boolean') return null
  const taux = typeof l.taux_dentiste === 'string' ? Number(l.taux_dentiste) : l.taux_dentiste
  if (taux !== null && (typeof taux !== 'number' || !tauxDentisteAdmis(taux))) return null
  return { annee: l.annee, acre: l.acre, tauxDentiste: taux }
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

/** Ce que le formulaire porte : la date telle que le champ la rend, l'ACRE en trois états, le taux tel que tapé. */
export interface SaisieDesParametres {
  debutActivite: string
  acre: 'oui' | 'non' | ''
  tauxDentiste: string
}

/** Les valeurs telles que la fonction les reçoit (`p_lus`, `p_saisis`) : les trois clés, ni plus ni moins. */
export interface ValeursDesParametres {
  debut_activite: string | null
  acre: boolean | null
  taux_dentiste: number | null
}

export function valeursLues(lecture: Extract<LectureDesParametres, { etat: 'lus' }>, annee: number): ValeursDesParametres {
  const exercice = lecture.parExercice.get(annee)
  return { debut_activite: lecture.debutActivite, acre: exercice?.acre ?? null, taux_dentiste: exercice?.tauxDentiste ?? null }
}

export function saisieDe(valeurs: ValeursDesParametres): SaisieDesParametres {
  return {
    debutActivite: valeurs.debut_activite ?? '',
    acre: valeurs.acre === null ? '' : valeurs.acre ? 'oui' : 'non',
    tauxDentiste: valeurs.taux_dentiste === null ? '' : String(valeurs.taux_dentiste).replace('.', ','),
  }
}

/**
 * La saisie telle qu'elle part, ou le refus que la base opposerait, redit avant le clic : une date du calendrier
 * (AAAA-MM-JJ, entre 1900 et 2100, `debuts_d_activite_date`), un taux entre 0 et 1 au centième, virgule ou point.
 */
export function valeursSaisies(s: SaisieDesParametres): { valeurs: ValeursDesParametres; refus: null } | { valeurs: null; refus: string } {
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
  return { valeurs: { debut_activite: debut, acre: s.acre === '' ? null : s.acre === 'oui', taux_dentiste: taux }, refus: null }
}

/** Les deux jeux de valeurs disent-ils la même chose ? Rien à enregistrer sinon. */
export function memesValeurs(a: ValeursDesParametres, b: ValeursDesParametres): boolean {
  return a.debut_activite === b.debut_activite && a.acre === b.acre && a.taux_dentiste === b.taux_dentiste
}

/** Les paramètres de `enregistrer_parametres_des_cotisations` : l'exercice, les valeurs lues qu'elles remplacent, les saisies. */
export function parametresDeLEnregistrement(dossierId: string, annee: number, lues: ValeursDesParametres, saisies: ValeursDesParametres) {
  return { p_dossier_id: dossierId, p_annee: annee, p_lus: lues, p_saisis: saisies }
}
