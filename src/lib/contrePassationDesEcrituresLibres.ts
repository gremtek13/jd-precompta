// LA CONTRE-PASSATION D'UNE ÉCRITURE LIBRE VALIDÉE (EL7 ; conception docs/conceptions/54-ecriture-libre-de-l-expert-comptable.md,
// § 3.1, § 3.7, § 6 et le lot EL7 du § 7). Pur, sans réseau et sans import de `supabase.ts` : ce que l'écran juge AVANT le clic,
// sous les mots et dans l'ordre que la fonction de la base (`contre_passer_ecriture_libre`, migration préparée
// `contre_passation_des_ecritures_libres`) redit, et l'écriture qu'il propose à la base, qui la recompose et la compare en
// multiensemble. contrePassationEnBase.test.ts confronte ces mots et cet ordre au texte de la migration.
//
// « VALIDÉE », ICI : une écriture libre n'a pas de statut à elle ; elle se valide AVEC SON EXERCICE (conception, § 3.7, § 6) — sa
// date au plus tard à la frontière de la validation (le 31 décembre du dernier exercice validé). Elle ne se remplace ni ne se
// retire plus ; elle se CONTRE-PASSE par une écriture libre NEUVE, dans un exercice ouvert, qui la cite (`contre_passe_id`) et porte
// ses lignes au sens inverse — le même compte, le même montant, le même libellé de compte ; le poste de la 2035 de chaque ligne,
// ou aucun quand le cabinet la passe hors de la 2035 (un choix sans défaut en base ; l'écran propose « hors de la 2035 », EL7-Q1).
// Un motif obligatoire, son auteur posé par la base. La 2035, le FEC, la piste d'audit et l'état des écritures libres la lisent
// comme une écriture libre ordinaire (contrePassationDansLesMoteurs.test.ts) : son libellé proposé nomme ce qu'elle contre-passe.
//
// SOURCES. PCG (règlement ANC n° 2014-03, numérotation du 1er janvier 2026), art. 1031-3 (la validation interdit toute
// modification ou suppression), 122-6 (une correction d'erreur passe au résultat de l'exercice où elle est constatée) et 1031-4
// (l'opération d'une période close s'enregistre au premier jour de la période non close : la date proposée) ; cités par la
// conception (§ 2, § 6), non relus ce jour.
import {
  LIBELLE_AU_PLUS, MOTS_DE_LA_BASE, MOTS_DES_REFUS, MOTIF_AU_PLUS, type ContexteDEcritureLibre, type EcritureLibreProposee,
  type RefusDEcritureLibre,
} from './ecritureLibre'
import { referenceDeLEcritureLibre, type EcritureLibreDesExports, type LigneEnBaseDEcritureLibre } from './ecrituresLibresDesExports'

/** LA MIGRATION `contre_passation_des_ecritures_libres` (EL7) EST-ELLE EN BASE ? Oui depuis le 25/11/2026 (251, par l'outil ;
 *  supabase/schema/20261125123317_contre_passation_des_ecritures_libres.sql), le drapeau levé le même jour. Levé : la lecture
 *  demande la colonne `contre_passe_id`, la section « Écritures de l'expert-comptable » offre « Contre-passer » sur une écriture
 *  figée, et le plan de sauvegarde porte sa relation et sa vague (lib/sauvegarde.ts). Baissé, rien ne changeait : la section
 *  d'EL5, ni la colonne ni la vague — l'état d'avant, que les tests jouent encore (un accesseur, ou le paramètre de
 *  `auxVaguesDeLaContrePassation` et de `colonnesDesEcrituresLibres`). La suite entière a été jouée en simulation le
 *  24/11/2026, et passe dans les deux états. */
export const CONTRE_PASSATION_DES_ECRITURES_LIBRES_PREVUE: boolean = true

/** La colonne de la migration, lue le drapeau levé. */
export const COLONNE_DE_LA_CONTRE_PASSATION = 'contre_passe_id'

/** Les mots des refus de `contre_passer_ecriture_libre`, dans l'ordre de ses contrôles : l'accès et la version (la base seule),
 *  l'état de l'écriture, la date, l'effet sur la 2035, le libellé, le motif, puis l'écriture d'origine relue et l'écriture
 *  proposée (la base seule). Ceux qu'une écriture libre partage avec `enregistrer_ecriture_libre` sont les siens, au caractère
 *  près. */
export const MOTS_DE_LA_CONTRE_PASSATION = {
  acces: MOTS_DE_LA_BASE.accesALEcriture,
  version: MOTS_DE_LA_BASE.version,
  nonFigee: 'Seule une écriture libre d’un exercice validé se contre-passe : avant la validation, elle se modifie ou se retire.',
  extournee: 'Une écriture extournée au 1er janvier suivant ne se contre-passe pas : son extourne la défait déjà.',
  dejaContrePassee: 'Cette écriture libre a déjà sa contre-passation : une écriture ne se contre-passe qu’une fois.',
  dateIllisible: MOTS_DES_REFUS.dateIllisible,
  dateFigee: MOTS_DES_REFUS.dateFigee,
  avantLOuverture: MOTS_DES_REFUS.avantLOuverture,
  dateAVenir: MOTS_DES_REFUS.dateAVenir,
  effet: 'L’effet sur la 2035 se choisit : hors de la 2035, ou les postes de l’écriture d’origine, au sens inverse.',
  libelle: MOTS_DES_REFUS.libelle,
  motif: MOTS_DES_REFUS.motif,
  origineIllisible: 'L’écriture d’origine ne se relit pas comme la base l’écrit : elle ne se contre-passe pas.',
  ecritures: MOTS_DE_LA_BASE.ecritures,
} as const

/** Le code que la base lève pour chaque refus. */
export const CODES_DE_LA_CONTRE_PASSATION: Readonly<Record<keyof typeof MOTS_DE_LA_CONTRE_PASSATION, '22023' | '23514' | '40001' | '42501'>> = {
  acces: '42501', version: '40001', nonFigee: '23514', extournee: '23514', dejaContrePassee: '23514', dateIllisible: '22023',
  dateFigee: '23514', avantLOuverture: '22023', dateAVenir: '22023', effet: '22023', libelle: '22023', motif: '22023',
  origineIllisible: '23514', ecritures: '22023',
}

/** Les mots de la garde de la colonne (`garder_contre_passation_des_ecritures_libres`), et leurs codes. */
export const MOTS_DE_LA_GARDE_DE_LA_CONTRE_PASSATION = {
  chemin: 'Une contre-passation ne s’écrit que par contre_passer_ecriture_libre.',
  dossier: 'Une contre-passation cite une écriture libre de son dossier.',
  remplacement: 'Une contre-passation ne se remplace pas : la retirer, puis contre-passer de nouveau.',
  contrePassee: 'Cette écriture libre est contre-passée : elle ne change ni ne se retire plus tant que sa contre-passation la cite.',
} as const
export const CODES_DE_LA_GARDE_DE_LA_CONTRE_PASSATION: Readonly<Record<keyof typeof MOTS_DE_LA_GARDE_DE_LA_CONTRE_PASSATION, '23514' | '42501'>> = {
  chemin: '42501', dossier: '23514', remplacement: '23514', contrePassee: '23514',
}

/** Une écriture libre telle que l'écran la lit : la colonne `contre_passe_id` n'est lue que le drapeau levé (absente, nulle). */
export type EcritureContrePassable = Pick<
  EcritureLibreDesExports, 'id' | 'exercice' | 'numero' | 'date' | 'libelle' | 'lignes' | 'avec_extourne' | 'version'
> & { contre_passe_id?: string | null }

/** La saisie : la date (AAAA-MM-JJ), le libellé (qui part au FEC), le motif (obligatoire, au cabinet seul) et l'effet sur la
 *  2035 — vrai : hors de la 2035, chaque poste nul ; faux : les postes de l'écriture d'origine, au sens inverse. */
export interface SaisieDeContrePassation {
  date: string
  libelle: string
  motif: string
  horsDeLa2035: boolean
}

// Les caractères de contrôle et la longueur en points de code, comme la base les juge (et comme lib/ecritureLibre.ts).
const CONTROLE = new RegExp(`[${String.fromCodePoint(1)}-${String.fromCodePoint(31)}${String.fromCodePoint(127)}-${String.fromCodePoint(159)}]`)
const longueur = (texte: string) => [...texte].length

/** Une date civile AAAA-MM-JJ, entre 2000 et 2100, qui existe ; nulle sinon. */
function dateLue(date: string): { annee: number; mois: number; jour: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return null
  const [annee, mois, jour] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (annee < 2000 || annee > 2100) return null
  const d = new Date(Date.UTC(annee, mois - 1, jour))
  return d.getUTCFullYear() === annee && d.getUTCMonth() === mois - 1 && d.getUTCDate() === jour ? { annee, mois, jour } : null
}

/** Figée par la validation de son exercice : sa date au plus tard à la frontière (le 31 décembre du dernier exercice validé). */
export function estFigee(e: Pick<EcritureContrePassable, 'date'>, frontiere: string | null): boolean {
  return frontiere !== null && e.date <= frontiere
}

/** La contre-passation d'une écriture, parmi les écritures du dossier lues EN ENTIER ; nulle s'il n'y en a pas. */
export function contrePassationDe<T extends { id: string; contre_passe_id?: string | null }>(
  e: { id: string }, toutes: readonly T[],
): T | null {
  return toutes.find((c) => c.contre_passe_id === e.id) ?? null
}

/** L'écriture qu'une contre-passation contre-passe, parmi les lues ; nulle pour une écriture qui n'en est pas une. */
export function origineDe<T extends { id: string }>(c: { contre_passe_id?: string | null }, toutes: readonly T[]): T | null {
  const origine = c.contre_passe_id ?? null
  return origine === null ? null : toutes.find((e) => e.id === origine) ?? null
}

/** Ce qui retient la contre-passation d'une écriture AVANT toute saisie — son état —, dans l'ordre de la base : pas figée,
 *  extournée, déjà contre-passée. Vide : elle se contre-passe. */
export function refusDeLEcritureAContrePasser(
  e: EcritureContrePassable, toutes: readonly EcritureContrePassable[], frontiere: string | null,
): RefusDEcritureLibre[] {
  const M = MOTS_DE_LA_CONTRE_PASSATION
  const refus: RefusDEcritureLibre[] = []
  if (!estFigee(e, frontiere)) refus.push({ cle: 'nonFigee', code: '23514', message: M.nonFigee })
  if (e.avec_extourne) refus.push({ cle: 'extournee', code: '23514', message: M.extournee })
  if (contrePassationDe(e, toutes) !== null) refus.push({ cle: 'dejaContrePassee', code: '23514', message: M.dejaContrePassee })
  return refus
}

/** Les refus de la saisie, dans l'ordre des contrôles de `contre_passer_ecriture_libre` : l'état de l'écriture, la date, l'effet
 *  sur la 2035, le libellé, le motif ; vide : la base l'acceptera, sauf ce qu'elle seule dit (l'accès, la version lue, l'écriture
 *  d'origine relue, l'écriture proposée). */
export function refusDeLaContrePassation(
  e: EcritureContrePassable, saisie: SaisieDeContrePassation, contexte: ContexteDEcritureLibre,
  toutes: readonly EcritureContrePassable[],
): RefusDEcritureLibre[] {
  const M = MOTS_DE_LA_CONTRE_PASSATION
  const refus = refusDeLEcritureAContrePasser(e, toutes, contexte.frontiere)
  const r = (cle: 'dateIllisible' | 'dateFigee' | 'avantLOuverture' | 'dateAVenir' | 'effet' | 'libelle' | 'motif') =>
    refus.push({ cle, code: CODES_DE_LA_CONTRE_PASSATION[cle] === '23514' ? '23514' : '22023', message: M[cle] })
  const date = dateLue(saisie.date)
  if (!date) r('dateIllisible')
  else {
    if (contexte.frontiere != null && saisie.date <= contexte.frontiere) r('dateFigee')
    if (contexte.ouverture != null && saisie.date < contexte.ouverture) r('avantLOuverture')
    if (date.annee > Number(contexte.aujourdhui.slice(0, 4))) r('dateAVenir')
  }
  if (typeof saisie.horsDeLa2035 !== 'boolean') r('effet')
  const libelle = saisie.libelle.trim()
  if (longueur(libelle) < 1 || longueur(libelle) > LIBELLE_AU_PLUS || CONTROLE.test(libelle)) r('libelle')
  const motif = saisie.motif.trim()
  if (longueur(motif) < 1 || longueur(motif) > MOTIF_AU_PLUS) r('motif')
  return refus
}

/** Les lignes de la contre-passation, dans l'ordre de l'écriture d'origine : chacune au sens inverse, le même compte, le même
 *  montant, le même libellé de compte ; son poste de la 2035, ou nul hors de la 2035. */
export function lignesDeLaContrePassation(
  e: Pick<EcritureContrePassable, 'lignes'>, horsDeLa2035: boolean,
): LigneEnBaseDEcritureLibre[] {
  return e.lignes.map((l) => ({
    compte: l.compte, sens: l.sens === 'debit' ? 'credit' : 'debit', centimes: l.centimes,
    poste_2035: horsDeLa2035 ? null : l.poste_2035, compte_lib: l.compte_lib,
  }))
}

/** L'écriture à proposer à la base : une seule, à sa date, au journal OD, sous le libellé rogné, ses lignes au sens inverse.
 *  Une saisie que le module refuse ne se compose pas. */
export function composerLaContrePassation(
  e: EcritureContrePassable, saisie: SaisieDeContrePassation, contexte: ContexteDEcritureLibre,
  toutes: readonly EcritureContrePassable[],
): EcritureLibreProposee[] | null {
  if (refusDeLaContrePassation(e, saisie, contexte, toutes).length > 0) return null
  return [{
    date: saisie.date, journal: 'OD', libelle: saisie.libelle.trim(),
    lignes: lignesDeLaContrePassation(e, saisie.horsDeLa2035).map((l) => ({ compte: l.compte, sens: l.sens, centimes: l.centimes })),
  }]
}

/** La contre-passation telle que la fonction de la base la reçoit (`p_contre_passation`) : le libellé et le motif rognés comme
 *  elle les rogne. */
export function contrePassationPourLaBase(saisie: SaisieDeContrePassation) {
  return { date: saisie.date, libelle: saisie.libelle.trim(), motif: saisie.motif.trim(), hors_de_la_2035: saisie.horsDeLa2035 }
}

/** Le lendemain d'une date civile (AAAA-MM-JJ). */
function lendemain(date: string): string {
  const [a, m, j] = date.split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1, j + 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** La date proposée : le premier jour de l'exercice ouvert, le lendemain de la frontière (PCG, art. 1031-4) ; le cabinet la
 *  change s'il le veut, dans un exercice ouvert. */
export function dateProposeeDeLaContrePassation(frontiere: string): string {
  return lendemain(frontiere)
}

/** Le libellé proposé : « Contre-passation de EL2025-0003 — » et le libellé d'origine, que l'expert a déjà écrit pour le FEC ;
 *  coupé à 200 caractères (points de code), le blanc final rogné. */
export function libelleProposeDeLaContrePassation(e: Pick<EcritureContrePassable, 'exercice' | 'numero' | 'libelle'>): string {
  return [...`Contre-passation de ${referenceDeLEcritureLibre(e)} — ${e.libelle}`].slice(0, LIBELLE_AU_PLUS).join('').trim()
}

/** La saisie proposée à l'ouverture du formulaire : la date et le libellé proposés, le motif vide (obligatoire), hors de la 2035
 *  (EL7-Q1, la recommandation : l'effet fiscal d'un exercice validé n'est pas d'ici). */
export function saisieProposeeDeLaContrePassation(
  e: Pick<EcritureContrePassable, 'exercice' | 'numero' | 'libelle'>, frontiere: string,
): SaisieDeContrePassation {
  return { date: dateProposeeDeLaContrePassation(frontiere), libelle: libelleProposeDeLaContrePassation(e), motif: '', horsDeLa2035: true }
}

/** Une ligne de l'écriture d'origine porte-t-elle un poste de la 2035 ? Sinon, le choix de l'effet ne change rien. */
export function porteUnPoste(e: Pick<EcritureContrePassable, 'lignes'>): boolean {
  return e.lignes.some((l) => l.poste_2035 !== null)
}
