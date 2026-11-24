import { LIBELLES_JOURNAUX } from './fec'
import {
  FORMES_DES_TIERS, LONGUEUR_DES_COMPTES_MAX, LONGUEUR_DES_COMPTES_MIN, PROFILS_D_EXPORT, type FormeDesTiers,
  type QuatreChampsDansLExport, type ReglagesDuProfil,
} from './profilsDExport'
import type { ReglagesDExport } from './types'

// LES RÉGLAGES DE L'EXPORT VERS UN LOGICIEL COMPTABLE, GARDÉS PAR DOSSIER ET PAR LOGICIEL (EXP-Q4, tranchée (A) le 18/11/2026 :
// « un réglage par dossier, saisi par le cabinet, sans défaut » ; la recherche : docs/conceptions/57-exports-vers-les-logiciels-
// comptables.md, § 0 point 12, § 3.1 et § 5). Trois réglages que tout tiers qui exporte vers ces logiciels demande au cabinet,
// et qui ne se devinent pas : la longueur des comptes, la forme des comptes de tiers, la correspondance des journaux. La base
// les garde (migration `reglages_d_export`, PRÉPARÉE : supabase/preparees/20261124160000_reglages_d_export.sql), un réglage
// nul y est « à saisir » ; ce module en fait le profil que lib/profilsDExport.ts attend, ou dit ce qui manque — jamais une
// valeur par défaut, ni tirée d'un autre dossier ni devinée. Il redit les refus de la base sous ses mots (`REFUS_DE_LA_BASE`),
// confrontés au texte de la migration par reglagesDExport.test.ts. Pur : la lecture et l'écriture vivent dans
// lib/reglagesDExportLecture.ts.
//
// Les choix propres à UN export — les quatre champs d'un BNC (EXP-Q5), les à-nouveaux, les justificatifs — ne se gardent pas :
// ils se règlent à chaque export, comme aujourd'hui.

/**
 * Le drapeau de la migration : BAISSÉ tant qu'elle n'est pas en base. Baissé, l'écran de l'export reste celui d'hier (les
 * réglages proposés, `REGLAGES_PROPOSES_ACD`), rien ne se lit ni ne s'écrit, et la table n'est pas au plan de sauvegarde ;
 * levé, l'écran lit les réglages gardés du dossier, les préremplit, et offre « Enregistrer ces réglages ».
 */
export const REGLAGES_D_EXPORT_PREVUS: boolean = false

/** Les tables de la migration, au plan de sauvegarde derrière le drapeau (lib/sauvegarde.ts). */
export const TABLES_DES_REGLAGES_D_EXPORT = ['reglages_d_export'] as const

/** Les colonnes que l'écran lit, énumérées (aucune n'est un texte libre) ; un seul littéral, que le client typé lit. */
export const COLONNES_DES_REGLAGES_D_EXPORT = 'id, dossier_id, logiciel, longueur_des_comptes, forme_des_tiers, journal_ac, journal_ve, journal_bq, journal_od, journal_an, version, regle_par, regle_le'

/**
 * Les cinq journaux que l'application écrit au FEC (lib/fec.ts : les quatre du brouillon, `LIBELLES_JOURNAUX`, et les
 * à-nouveaux, `AN`), leur libellé et leur colonne en base. La base en tient la liste fermée (`AC, VE, BQ, OD, AN`).
 */
export const JOURNAUX_DE_L_APPLICATION = [
  { code: 'AC', libelle: LIBELLES_JOURNAUX.AC, colonne: 'journal_ac' },
  { code: 'VE', libelle: LIBELLES_JOURNAUX.VE, colonne: 'journal_ve' },
  { code: 'BQ', libelle: LIBELLES_JOURNAUX.BQ, colonne: 'journal_bq' },
  { code: 'OD', libelle: LIBELLES_JOURNAUX.OD, colonne: 'journal_od' },
  { code: 'AN', libelle: 'À-nouveaux', colonne: 'journal_an' },
] as const satisfies readonly { code: string; libelle: string; colonne: keyof ReglagesDExport }[]
export type JournalDeLApplication = (typeof JOURNAUX_DE_L_APPLICATION)[number]['code']

/** Un code de journal du logiciel, tel que la base l'accepte : 1 à 20 lettres ou chiffres, sans espace (la borne est technique). */
export const CODE_DU_JOURNAL_DU_LOGICIEL = /^[A-Za-z0-9]{1,20}$/

/** Les refus de `enregistrer_reglages_d_export` et de sa garde, sous les mots de la base, dans son ordre. */
export const REFUS_DE_LA_BASE = {
  acces: 'Accès refusé à ce dossier.',
  logiciel: 'Ce logiciel n’a pas de profil d’export dans l’application.',
  objet: 'Les réglages d’export se donnent en un objet aux clés longueur_des_comptes, forme_des_tiers et journaux.',
  longueur: 'La longueur des comptes du logiciel va de 6 à 12 caractères, ou reste à saisir.',
  forme: 'La forme des comptes de tiers est l’une de celles que l’application connaît, ou reste à saisir.',
  journaux: 'La correspondance des journaux va d’un journal de l’application (AC, VE, BQ, OD, AN) à son code dans le logiciel.',
  code: 'Le code d’un journal dans le logiciel tient en 1 à 20 lettres ou chiffres, sans espace, ou reste à saisir.',
  version: 'Les réglages d’export de ce dossier ont changé depuis leur lecture : relis-les avant de les enregistrer.',
  garde: 'Les réglages d’export ne s’écrivent que par enregistrer_reglages_d_export.',
  cle: 'Les réglages d’export d’un dossier ne passent ni à un autre dossier ni à un autre logiciel.',
} as const

/** Ce que dit l'écran quand la fonction répond sans erreur mais sans une version lisible. */
export const REGLAGES_NON_ENREGISTRES = 'Les réglages n’ont pas pu être enregistrés : relis-les, puis recommence.'

/** Ce que dit l'écran quand la saisie est déjà ce que la base garde. */
export const RIEN_A_ENREGISTRER = 'Ces réglages sont ceux que le dossier garde : rien à enregistrer.'

/** La lecture des réglages gardés d'un dossier pour un logiciel (lib/reglagesDExportLecture.ts) : lus en entier, ou illisibles. */
export type LectureDesReglagesDExport =
  | { dossierId: string; logiciel: string; etat: 'lus'; gardes: ReglagesDExport | null }
  | { dossierId: string; logiciel: string; etat: 'illisibles'; motif: string }

/** Ce que l'écran dit de la lecture, avant le formulaire. */
export function phraseDesReglagesGardes(lecture: LectureDesReglagesDExport): string {
  if (lecture.etat === 'illisibles') {
    return `Les réglages gardés du dossier n’ont pas pu être lus (${lecture.motif}) : rien n’est prérempli et rien ne s’enregistre ; `
      + 'l’export reste possible en les saisissant ici.'
  }
  if (lecture.gardes === null) {
    return 'Aucun réglage n’est gardé pour ce dossier : chacun est à saisir, puis peut s’enregistrer pour les exports suivants.'
  }
  return `Les réglages gardés pour ce dossier (version ${lecture.gardes.version}) sont préremplis ; ce qui manque reste à saisir.`
}

/** Ce que l'écran dit d'un enregistrement réussi. */
export function phraseDeLEnregistrement(version: number): string {
  return `Réglages enregistrés pour ce dossier (version ${version}).`
}

/** Ce que le formulaire tient : le texte tapé de la longueur et de chaque code, la forme choisie ; vide ou nul : à saisir. */
export interface SaisieDesReglages {
  longueurDesComptes: string
  formeDesTiers: FormeDesTiers | null
  journaux: Readonly<Record<JournalDeLApplication, string>>
}

/** Rien de dit : chaque réglage est à saisir. Ni huit chiffres, ni nos codes de journaux — aucune valeur par défaut. */
export const SAISIE_A_SAISIR: SaisieDesReglages = {
  longueurDesComptes: '',
  formeDesTiers: null,
  journaux: { AC: '', VE: '', BQ: '', OD: '', AN: '' },
}

/** Le formulaire prérempli des réglages gardés ; sans ligne, tout est à saisir. */
export function saisieDesReglagesGardes(gardes: ReglagesDExport | null): SaisieDesReglages {
  if (gardes === null) return SAISIE_A_SAISIR
  return {
    longueurDesComptes: gardes.longueur_des_comptes === null ? '' : String(gardes.longueur_des_comptes),
    formeDesTiers: gardes.forme_des_tiers,
    journaux: Object.fromEntries(JOURNAUX_DE_L_APPLICATION.map((j) => [j.code, gardes[j.colonne] ?? ''])) as Record<JournalDeLApplication, string>,
  }
}

/** La longueur tapée : nulle pour un champ vide (à saisir), un entier, ou NaN pour ce qui ne se lit pas (le refus se dit). */
export function longueurDeLaSaisie(texte: string): number | null {
  const t = texte.trim()
  if (t === '') return null
  return /^[0-9]{1,3}$/.test(t) ? Number(t) : Number.NaN
}

/** Le code tapé d'un journal : nul pour un champ vide (à saisir), sinon le texte, rogné de ses blancs de bout. */
export function codeDeLaSaisie(texte: string): string | null {
  const t = texte.trim()
  return t === '' ? null : t
}

/** Les réglages tels que `enregistrer_reglages_d_export` les reçoit (`p_reglages`) : chaque réglage, nul s'il est à saisir. */
export function reglagesPourLaBase(saisie: SaisieDesReglages): {
  longueur_des_comptes: number | null
  forme_des_tiers: FormeDesTiers | null
  journaux: Record<JournalDeLApplication, string | null>
} {
  return {
    longueur_des_comptes: longueurDeLaSaisie(saisie.longueurDesComptes),
    forme_des_tiers: saisie.formeDesTiers,
    journaux: Object.fromEntries(JOURNAUX_DE_L_APPLICATION.map((j) => [j.code, codeDeLaSaisie(saisie.journaux[j.code])])) as
      Record<JournalDeLApplication, string | null>,
  }
}

/**
 * Le refus de l'enregistrement, dit AVANT le clic sous les mots de la base, sur la saisie telle qu'elle partirait, dans
 * l'ordre de la fonction : la longueur, la forme, les codes. Nul si la base l'accepterait (un réglage à saisir compris).
 */
export function refusDeLEnregistrement(saisie: SaisieDesReglages): string | null {
  const longueur = longueurDeLaSaisie(saisie.longueurDesComptes)
  if (longueur !== null && !(Number.isInteger(longueur) && longueur >= LONGUEUR_DES_COMPTES_MIN && longueur <= LONGUEUR_DES_COMPTES_MAX)) {
    return REFUS_DE_LA_BASE.longueur
  }
  if (saisie.formeDesTiers !== null && !FORMES_DES_TIERS.some((f) => f.id === saisie.formeDesTiers)) return REFUS_DE_LA_BASE.forme
  for (const j of JOURNAUX_DE_L_APPLICATION) {
    const code = codeDeLaSaisie(saisie.journaux[j.code])
    if (code !== null && !CODE_DU_JOURNAL_DU_LOGICIEL.test(code)) return REFUS_DE_LA_BASE.code
  }
  return null
}

/** La saisie dit-elle exactement ce que la base garde (rien à enregistrer) ? Sans ligne gardée, une saisie toute à saisir. */
export function memesReglages(saisie: SaisieDesReglages, gardes: ReglagesDExport | null): boolean {
  const s = reglagesPourLaBase(saisie)
  if (gardes === null) return s.longueur_des_comptes === null && s.forme_des_tiers === null && JOURNAUX_DE_L_APPLICATION.every((j) => s.journaux[j.code] === null)
  return s.longueur_des_comptes === gardes.longueur_des_comptes && s.forme_des_tiers === gardes.forme_des_tiers
    && JOURNAUX_DE_L_APPLICATION.every((j) => s.journaux[j.code] === gardes[j.colonne])
}

/**
 * Une ligne lue a-t-elle la forme que la base lui donne ? Une valeur qui ne l'a pas rend la lecture illisible : elle ne se
 * préremplit pas, elle ne se corrige pas en silence.
 */
export function reglagesLisibles(l: ReglagesDExport): boolean {
  const longueur = l.longueur_des_comptes
  return (longueur === null || (Number.isInteger(longueur) && longueur >= LONGUEUR_DES_COMPTES_MIN && longueur <= LONGUEUR_DES_COMPTES_MAX))
    && (l.forme_des_tiers === null || FORMES_DES_TIERS.some((f) => f.id === l.forme_des_tiers))
    && JOURNAUX_DE_L_APPLICATION.every((j) => {
      const code = l[j.colonne]
      return code === null || (typeof code === 'string' && CODE_DU_JOURNAL_DU_LOGICIEL.test(code))
    })
    && Number.isInteger(l.version) && l.version >= 1
}

const LIBELLE_DU_JOURNAL: ReadonlyMap<string, string> = new Map(JOURNAUX_DE_L_APPLICATION.map((j) => [j.code, j.libelle]))

export type ProfilDeLaSaisie = { ok: true; reglages: ReglagesDuProfil } | { ok: false; aSaisir: string[] }

/**
 * Le profil que `mettreEnFormePourAcd` attend, tiré de la saisie et des journaux de CE fichier (`journauxDuFec`) — les
 * à-nouveaux hors du compte s'ils ne partent pas. Ce qui manque se nomme « à saisir », et rien ne part : ni huit chiffres, ni
 * nos codes de journaux, ni nos auxiliaires à la place du cabinet. Une valeur dite mais fausse passe telle quelle : la mise en
 * forme la refuse sous ses mots, nommée par sa ligne.
 */
export function profilDeLaSaisie(
  saisie: SaisieDesReglages, codesDuFec: readonly string[], choix: { quatreChamps: QuatreChampsDansLExport; sansANouveaux: boolean },
): ProfilDeLaSaisie {
  const aSaisir: string[] = []
  const longueur = longueurDeLaSaisie(saisie.longueurDesComptes)
  if (longueur === null) aSaisir.push('La longueur des comptes dans le logiciel : à saisir.')
  if (saisie.formeDesTiers === null) aSaisir.push('La forme des comptes de tiers : à saisir.')
  const journaux: Record<string, string> = {}
  for (const code of codesDuFec) {
    if (choix.sansANouveaux && code === 'AN') continue
    const libelle = LIBELLE_DU_JOURNAL.get(code)
    if (libelle === undefined) {
      aSaisir.push(`Le journal « ${code} » du fichier n’est pas un journal que les réglages connaissent : rien ne part.`)
      continue
    }
    const eux = codeDeLaSaisie(saisie.journaux[code as JournalDeLApplication])
    if (eux === null) aSaisir.push(`Le code du journal ${code} (${libelle}) dans le logiciel : à saisir.`)
    else journaux[code] = eux
  }
  if (aSaisir.length > 0 || longueur === null || saisie.formeDesTiers === null) return { ok: false, aSaisir }
  return {
    ok: true,
    reglages: {
      longueurDesComptes: longueur, journaux, quatreChamps: choix.quatreChamps, sansANouveaux: choix.sansANouveaux,
      formeDesTiers: saisie.formeDesTiers,
    },
  }
}

/** Les logiciels qui ont un profil dans l'application : la liste fermée que la base tient aussi (`logiciels_d_export()`). */
export const LOGICIELS_DES_REGLAGES: readonly string[] = PROFILS_D_EXPORT.map((p) => p.id)
