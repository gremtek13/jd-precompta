import { remplirModele } from './encaissementsFactures'
import { dernierJourDuMois, formatDate, jourDe, moisDe } from './format'
import {
  frequenceDesPaiements, frequenceDesTransactions, libelleFrequence, type FrequenceEreporting,
} from './periodesEreporting'
import { ficheCourante, TYPES_DE_PIECE_DECRITS } from './piecesHorsDeFrance'
import type {
  ArticleExoneration, Dossier, FrequencePaiementsEreporting, FrequenceTransactionsEreporting, PeriodiciteTva, Piece,
  PieceEcarteeEreporting, PieceHorsDeFrance, RegimeEreporting, StatutTva,
} from './types'

// LE RÉGIME D'E-REPORTING CONFIRMÉ D'UN DOSSIER, SON HISTOIRE, ET LA PIÈCE ÉCARTÉE APRÈS VÉRIFICATION (ligne 28.5, étape e,
// cinquième temps, première moitié e5a ; migration `regimes_ereporting_et_pieces_ecartees`).
//
// LE RÉGIME. « Les entreprises doivent veiller à communiquer à leur plateforme agréée leur régime de TVA et tout changement
// de régime » (impots.gouv.fr, actualité du 22/09/2026) : la fréquence de l'e-reporting suit ce régime
// (BOI-TVA-DECLA-20-30-50-30, § 40 à § 70 ; BOI-TVA-DECLA-20-30-60, § 170 et § 180). Le cabinet le CONFIRME, daté — « à
// partir de ce jour, le dossier déclare sous ce régime » —, et la base en garde l'HISTOIRE, qui est aussi celle du statut de
// TVA : une période passée se déclare sous le régime qu'elle avait (`regimeDeLaPeriode`), quand l'onglet TVA ne garde que
// celui d'aujourd'hui. Un régime ne se modifie pas : il se retire, et un autre se confirme.
//
// LA PIÈCE ÉCARTÉE. Une pièce d'achat qui ressemble à un achat à un fournisseur établi hors de France (les signaux d'e3) et
// n'en est pas un, ou que le cabinet a tranché de ne pas déclarer : il l'ÉCARTE, avec ce que la vérification a établi, et
// la période ne l'attend plus. Un écart ne se modifie pas : il se retire, et la pièce redevient à vérifier. Une pièce qui a
// une fiche « hors de France » ne s'écarte pas ; une fiche posée après l'écart l'emporte (lib/ereporting.ts ne consulte un
// écart que pour une pièce sans aucune fiche).
//
// LA BASE TIENT LA RÈGLE : seules `confirmer_regime_ereporting`, `retirer_regime_ereporting`, `ecarter_piece_ereporting` et
// `reprendre_piece_ereporting` écrivent. Ce module dit AVANT le clic ce qu'elles refuseraient, dans leur ordre et sous leurs
// mots (`REFUS_CONFIRMATION_REGIME`, `REFUS_RETRAIT_REGIME`, `REFUS_ECART_PIECE`, `REFUS_REPRISE_PIECE`) :
// regimesEreporting.test.ts les confronte au texte des fonctions que l'export porte, et rejoue l'essai
// (supabase/essais/regimesEreporting.sql) appel par appel. Un module PUR : il ne lit rien en base et ne lit pas l'horloge —
// l'appelant lui passe les régimes et les écarts du dossier lus EN ENTIER, ses fiches, et le jour à Paris.
//
// HYPOTHÈSE Q4 (question du 09/10/2026, sans réponse) : la fréquence confirmée est celle que l'application propose — celle
// des textes pour un redevable et un franchisé, « chaque mois » pour un dossier exonéré, que les textes ne disent pas.
// C'est celle de la fonction ; une autre réponse la changera, puis ce module, et le test dira l'écart.

// ── Les listes de la fonction ───────────────────────────────────────────────────────────────────────────────────────

/** Les statuts qu'un régime confirme : les trois de `dossiers.statut_tva` — un statut à préciser ne se confirme pas. */
export const STATUTS_DU_REGIME: readonly StatutTva[] = ['redevable', 'franchise', 'exonere']

/** Les articles d'exonération que l'application connaît (`dossiers_article_exoneration_check`, lib/statutTva.ts). */
export const ARTICLES_D_EXONERATION: readonly ArticleExoneration[] = ['cgi_261_4_1', 'cgi_261_4_4_a', 'cgi_261_4_4_b', 'cgi_261_c_2']

/** Les périodicités de la déclaration de TVA d'un redevable. */
export const PERIODICITES: readonly PeriodiciteTva[] = ['mensuelle', 'trimestrielle']

/** La longueur la plus grande d'une note ou d'un motif, en caractères (`length`). */
export const LONGUEUR_MAXIMALE_TEXTE = 2000

// ── Les refus ───────────────────────────────────────────────────────────────────────────────────────────────────────

// Les refus de `confirmer_regime_ereporting`, dans l'ordre de la fonction : chaque « % » reçoit la valeur que la base y met
// (`remplirModele`).
export const REFUS_CONFIRMATION_REGIME = [
  { cle: 'acces', modele: 'Accès refusé à ce dossier.' },
  { cle: 'depuis_absent', modele: 'Le jour à partir duquel ce régime vaut est à renseigner.' },
  { cle: 'depuis_avant_2000', modele: "Un régime ne se date pas avant l'an 2000." },
  { cle: 'depuis_futur', modele: "Un régime ne se confirme pas pour l'avenir : nous sommes le %." },
  { cle: 'jour_deja_confirme', modele: "Un régime est déjà confirmé à partir du % : le retirer d'abord pour en confirmer un autre ce jour-là." },
  { cle: 'statut', modele: "Un régime confirmé est celui d'un dossier redevable, en franchise en base ou exonéré : un statut à préciser ne se confirme pas." },
  { cle: 'article_inconnu', modele: "Cet article d'exonération n'est pas un de ceux que l'application connaît." },
  { cle: 'article_franchise', modele: "Un dossier en franchise en base ne porte pas d'article d'exonération." },
  { cle: 'periodicite_absente', modele: 'Un redevable déclare sa TVA chaque mois ou chaque trimestre : la périodicité est à renseigner.' },
  { cle: 'periodicite_hors_redevable', modele: 'Seul un redevable a une périodicité de déclaration de TVA.' },
  { cle: 'debits_absent', modele: 'Dire si le dossier a opté pour la TVA sur les débits.' },
  { cle: 'debits_hors_redevable', modele: 'Seul un redevable opte pour la TVA sur les débits.' },
  { cle: 'frequence_transactions', modele: "Sous ce régime, ses ventes et ses achats se déclarent % : c'est la fréquence que le cabinet confirme." },
  { cle: 'paiements_sur_debits', modele: 'Sur option pour la TVA sur les débits, ses paiements ne se déclarent pas : aucune fréquence ne se confirme pour eux.' },
  { cle: 'frequence_paiements', modele: "Sous ce régime, ses paiements se déclarent % : c'est la fréquence que le cabinet confirme." },
  { cle: 'note_trop_longue', modele: 'La note de la confirmation dépasse 2 000 caractères.' },
] as const

export type CleRefusConfirmation = (typeof REFUS_CONFIRMATION_REGIME)[number]['cle']

// Les refus de `retirer_regime_ereporting`, dans son ordre et sous ses mots.
export const REFUS_RETRAIT_REGIME = [
  { cle: 'acces', modele: 'Accès refusé à ce dossier.' },
  { cle: 'regime_introuvable', modele: 'Régime introuvable dans ce dossier.' },
  { cle: 'deja_retire', modele: 'Ce régime est déjà retiré.' },
] as const

export type CleRefusRetraitRegime = (typeof REFUS_RETRAIT_REGIME)[number]['cle']

// Les refus de `ecarter_piece_ereporting`, dans son ordre et sous ses mots.
export const REFUS_ECART_PIECE = [
  { cle: 'acces', modele: 'Accès refusé à ce dossier.' },
  { cle: 'piece_introuvable', modele: 'Pièce introuvable dans ce dossier.' },
  { cle: 'pas_un_achat', modele: "Seule une pièce d'achat ou une note de frais s'écarte de l'e-reporting des achats." },
  { cle: 'fiche_courante', modele: "Cette pièce a une fiche « fournisseur établi hors de France » : elle ne s'écarte pas — si elle n'est pas un achat à l'étranger, c'est sa fiche qui se retire." },
  { cle: 'fiche_retiree', modele: "La fiche « fournisseur établi hors de France » de cette pièce est retirée : la pièce n'est déjà plus à vérifier." },
  { cle: 'deja_ecartee', modele: "Cette pièce est déjà écartée de l'e-reporting." },
  { cle: 'motif_absent', modele: "Le motif de l'écart est à renseigner : ce que la vérification a établi." },
  { cle: 'motif_trop_long', modele: "Le motif de l'écart dépasse 2 000 caractères." },
] as const

export type CleRefusEcart = (typeof REFUS_ECART_PIECE)[number]['cle']

// Les refus de `reprendre_piece_ereporting`, dans son ordre et sous ses mots.
export const REFUS_REPRISE_PIECE = [
  { cle: 'acces', modele: 'Accès refusé à ce dossier.' },
  { cle: 'ecart_introuvable', modele: 'Écart introuvable dans ce dossier.' },
  { cle: 'deja_retire', modele: 'Cet écart est déjà retiré : la pièce est de nouveau à vérifier.' },
] as const

export type CleRefusReprise = (typeof REFUS_REPRISE_PIECE)[number]['cle']

export interface RefusRegime<C extends string> {
  cle: C
  message: string
}

type Refus = { readonly cle: string; readonly modele: string }

function dire<C extends string>(liste: readonly Refus[], cle: C, ...valeurs: string[]): RefusRegime<C> {
  return { cle, message: remplirModele((liste.find((r) => r.cle === cle) as Refus).modele, valeurs) }
}

// Ce que la base lit de ses textes : `btrim(x)` sans second argument ne retire que l'ESPACE (relevé en production le
// 10/10/2026, étape e2), et `length` compte des caractères, pas des unités UTF-16.
const blanc = (texte: string) => /^ *$/.test(texte)
const caracteres = (texte: string) => [...texte].length

// Une date civile AAAA-MM-JJ qui existe (la règle de lib/piecesHorsDeFrance.ts) : une autre forme ne parviendrait pas à la
// fonction — PostgREST refuserait de la lire comme une date —, la saisie la tient pour non renseignée et ne l'envoie pas.
function dateCivile(date: string | null): string | null {
  if (date == null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const mois = moisDe(date)
  return mois >= 1 && mois <= 12 && jourDe(date) >= 1 && date <= dernierJourDuMois(date) ? date : null
}

/** « par décade », « chaque mois », « tous les deux mois » : le rythme, tel que la base l'écrit dans ses refus. */
export function rythme(frequence: FrequenceEreporting): string {
  return libelleFrequence({ frequence, certitude: 'ecrite', raison: null }, false)
}

// ── Les fréquences d'un régime ──────────────────────────────────────────────────────────────────────────────────────

/**
 * LES FRÉQUENCES QU'UN RÉGIME DONNE, celles que la fonction refait : les ventes et les achats à la fréquence des
 * transactions d'e1 (`frequenceDesTransactions`), les paiements à celle de ses paiements (`frequenceDesPaiements`) — aucune
 * sur option pour les débits d'un redevable (BOI-TVA-DECLA-20-30-60, § 30). Pour un dossier exonéré, l'une et l'autre
 * « chaque mois » : la proposition d'e1, confirmée telle quelle (hypothèse Q4).
 */
export function frequencesDuRegime(statut: StatutTva, periodicite: PeriodiciteTva | null, surDebits: boolean): {
  transactions: FrequenceTransactionsEreporting
  paiements: FrequencePaiementsEreporting | null
} {
  // La périodicité ne regarde qu'un redevable : la fonction lit une périodicité absente comme trimestrielle (`else`).
  const transactions = (frequenceDesTransactions(statut, periodicite === 'mensuelle' ? 'mensuelle' : 'trimestrielle') as
    { frequence: FrequenceTransactionsEreporting }).frequence
  const paiements = statut === 'redevable' && surDebits ? null
    : (frequenceDesPaiements(statut) as { frequence: FrequencePaiementsEreporting }).frequence
  return { transactions, paiements }
}

// ── Ce que l'écran envoie ───────────────────────────────────────────────────────────────────────────────────────────

/** Ce que le cabinet confirme. Les textes sont ceux qu'il a choisis ; un autre texte est un refus, pas une erreur de type. */
export interface SaisieRegime {
  depuis: string | null
  statut_tva: string | null
  article_exoneration: string | null
  tva_periodicite: string | null
  tva_sur_debits: boolean | null
  frequence_transactions: string | null
  frequence_paiements: string | null
  note: string | null
}

type StatutDuDossier = Pick<Dossier, 'statut_tva' | 'article_exoneration' | 'tva_periodicite' | 'tva_sur_debits'>

/**
 * LE RÉGIME QUE L'APPLICATION PROPOSE À CONFIRMER, depuis le statut de TVA que le dossier porte aujourd'hui (onglet TVA) :
 * la périodicité et l'option d'un redevable seul, les fréquences qu'il donne. Null pour un statut à préciser, qui ne se
 * confirme pas. Le jour de départ est celui que le cabinet dit — l'application ne le devine pas.
 */
export function regimeProposeDuDossier(d: StatutDuDossier, depuis: string | null): SaisieRegime | null {
  if (d.statut_tva == null) return null
  const redevable = d.statut_tva === 'redevable'
  const f = frequencesDuRegime(d.statut_tva, redevable ? d.tva_periodicite : null, redevable && d.tva_sur_debits)
  return {
    depuis,
    statut_tva: d.statut_tva,
    article_exoneration: d.article_exoneration,
    tva_periodicite: redevable ? d.tva_periodicite : null,
    tva_sur_debits: redevable ? d.tva_sur_debits : false,
    frequence_transactions: f.transactions,
    frequence_paiements: f.paiements,
    note: null,
  }
}

/** Les paramètres de `confirmer_regime_ereporting`, dans l'ordre de sa signature : le dossier annoncé (la fonction y
 * contrôle l'accès avant de rien lire), puis la saisie — le jour civil seul. */
export function argumentsDeLaConfirmation(dossierId: string, saisie: SaisieRegime) {
  return {
    p_dossier_id: dossierId,
    p_depuis: dateCivile(saisie.depuis),
    p_statut_tva: saisie.statut_tva,
    p_article_exoneration: saisie.article_exoneration,
    p_tva_periodicite: saisie.tva_periodicite,
    p_tva_sur_debits: saisie.tva_sur_debits,
    p_frequence_transactions: saisie.frequence_transactions,
    p_frequence_paiements: saisie.frequence_paiements,
    p_note: saisie.note,
  }
}

/** Les paramètres de `retirer_regime_ereporting`. */
export function argumentsDuRetraitDuRegime(dossierId: string, regimeId: string) {
  return { p_dossier_id: dossierId, p_regime_id: regimeId }
}

/** Les paramètres de `ecarter_piece_ereporting`. */
export function argumentsDeLEcart(dossierId: string, pieceId: string, motif: string | null) {
  return { p_dossier_id: dossierId, p_piece_id: pieceId, p_motif: motif }
}

/** Les paramètres de `reprendre_piece_ereporting`. */
export function argumentsDeLaReprise(dossierId: string, ecartId: string) {
  return { p_dossier_id: dossierId, p_ecart_id: ecartId }
}

// ── Les refus dits avant le clic ────────────────────────────────────────────────────────────────────────────────────

/** Ce que l'écran sait quand il propose de confirmer. */
export interface ContexteConfirmation {
  dossierId: string
  /** Les régimes du dossier, retirés compris, lus EN ENTIER. */
  regimes: readonly Pick<RegimeEreporting, 'dossier_id' | 'depuis' | 'retire_le'>[]
  /** Aujourd'hui À PARIS (`aujourdHuiAParis`) : la base lit la date ainsi. */
  aujourdHui: string
}

/**
 * POURQUOI CE RÉGIME NE SE CONFIRMERAIT PAS, dit avant le clic, dans l'ordre de la fonction et sous ses mots — sauf
 * l'accès, que l'écran ne peut pas dire. Null : la base l'accepterait.
 */
export function refusConfirmationRegime(saisie: SaisieRegime, contexte: ContexteConfirmation): RefusRegime<CleRefusConfirmation> | null {
  const non = (cle: CleRefusConfirmation, ...valeurs: string[]) => dire(REFUS_CONFIRMATION_REGIME, cle, ...valeurs)
  // 2. Le jour de départ, lu à Paris ; 3. un régime actif déjà confirmé ce jour-là.
  const depuis = dateCivile(saisie.depuis)
  if (depuis == null) return non('depuis_absent')
  if (depuis < '2000-01-01') return non('depuis_avant_2000')
  if (depuis > contexte.aujourdHui) return non('depuis_futur', formatDate(contexte.aujourdHui))
  if (contexte.regimes.some((r) => r.dossier_id === contexte.dossierId && r.depuis === depuis && r.retire_le == null)) {
    return non('jour_deja_confirme', formatDate(depuis))
  }
  // 4. Le statut ; 5. l'article ; 6. la périodicité ; 7. l'option pour les débits.
  const statut = STATUTS_DU_REGIME.find((s) => s === saisie.statut_tva)
  if (statut == null) return non('statut')
  const article = saisie.article_exoneration
  if (article != null && !(ARTICLES_D_EXONERATION as readonly string[]).includes(article)) return non('article_inconnu')
  if (article != null && statut === 'franchise') return non('article_franchise')
  const periodicite = PERIODICITES.find((p) => p === saisie.tva_periodicite) ?? null
  if (statut === 'redevable' && periodicite == null) return non('periodicite_absente')
  if (statut !== 'redevable' && saisie.tva_periodicite != null) return non('periodicite_hors_redevable')
  const debits = saisie.tva_sur_debits
  if (debits == null) return non('debits_absent')
  if (debits && statut !== 'redevable') return non('debits_hors_redevable')
  // 8 et 9. Les fréquences que ce régime donne (hypothèse Q4).
  const f = frequencesDuRegime(statut, periodicite, debits)
  if (saisie.frequence_transactions !== f.transactions) return non('frequence_transactions', rythme(f.transactions))
  if (f.paiements == null && saisie.frequence_paiements != null) return non('paiements_sur_debits')
  if (f.paiements != null && saisie.frequence_paiements !== f.paiements) return non('frequence_paiements', rythme(f.paiements))
  // 10. Une note faite d'espaces n'est pas une note ; une note se compte en caractères.
  const note = saisie.note
  if (note != null && !blanc(note) && caracteres(note) > LONGUEUR_MAXIMALE_TEXTE) return non('note_trop_longue')
  return null
}

/** POURQUOI CE RÉGIME NE SE RETIRE PAS — sauf l'accès et le régime introuvable, que l'écran ne peut pas dire : il l'est
 * déjà. */
export function refusRetraitRegime(regime: Pick<RegimeEreporting, 'retire_le'>): RefusRegime<CleRefusRetraitRegime> | null {
  return regime.retire_le != null ? dire(REFUS_RETRAIT_REGIME, 'deja_retire') : null
}

/** Ce que l'écran sait quand il propose d'écarter une pièce. */
export interface ContexteEcart {
  /** Les fiches « hors de France » du dossier, toutes versions, retirées comprises, lues EN ENTIER. */
  fiches: readonly Pick<PieceHorsDeFrance, 'id' | 'piece_id' | 'remplace_id' | 'retire_le'>[]
  /** Les écarts du dossier, retirés compris, lus EN ENTIER. */
  ecarts: readonly Pick<PieceEcarteeEreporting, 'piece_id' | 'retire_le'>[]
}

/**
 * POURQUOI CETTE PIÈCE NE S'ÉCARTERAIT PAS, dit avant le clic, dans l'ordre de la fonction et sous ses mots — sauf l'accès
 * et la pièce introuvable, que l'écran ne peut pas dire. Null : la base l'accepterait.
 */
export function refusEcartPiece(piece: Pick<Piece, 'id' | 'type_piece'>, motif: string | null, contexte: ContexteEcart):
  RefusRegime<CleRefusEcart> | null {
  const non = (cle: CleRefusEcart) => dire(REFUS_ECART_PIECE, cle)
  // 3. Une pièce d'achat ou une note de frais, les seules candidates.
  if (!TYPES_DE_PIECE_DECRITS.includes(piece.type_piece)) return non('pas_un_achat')
  // 4 et 5. La fiche courante de la pièce — celle qu'aucune autre ne remplace : la chaîne de l'étape e2.
  const courante = contexte.fiches.find((f) => f.id === ficheCourante(contexte.fiches, piece.id))
  if (courante != null) return non(courante.retire_le == null ? 'fiche_courante' : 'fiche_retiree')
  // 6. Un écart actif ; 7. le motif.
  if (contexte.ecarts.some((e) => e.piece_id === piece.id && e.retire_le == null)) return non('deja_ecartee')
  if (motif == null || blanc(motif)) return non('motif_absent')
  if (caracteres(motif) > LONGUEUR_MAXIMALE_TEXTE) return non('motif_trop_long')
  return null
}

/** POURQUOI CET ÉCART NE SE RETIRE PAS — sauf l'accès et l'écart introuvable : il l'est déjà. */
export function refusRepriseEcart(ecart: Pick<PieceEcarteeEreporting, 'retire_le'>): RefusRegime<CleRefusReprise> | null {
  return ecart.retire_le != null ? dire(REFUS_REPRISE_PIECE, 'deja_retire') : null
}

// ── L'histoire des régimes ──────────────────────────────────────────────────────────────────────────────────────────

/** Ce qu'il faut d'un régime pour en lire l'histoire. */
export type LigneDeRegime = Pick<RegimeEreporting,
  'id' | 'dossier_id' | 'depuis' | 'statut_tva' | 'article_exoneration' | 'tva_periodicite' | 'tva_sur_debits'
  | 'frequence_transactions' | 'frequence_paiements' | 'retire_le'>

/** Les régimes ACTIFS d'un dossier, du plus ancien au plus récent : un seul par jour de départ (la base le garantit). Les
 * lignes d'un autre dossier glissées dans la lecture sont ignorées. */
export function regimesActifs<R extends LigneDeRegime>(regimes: readonly R[], dossierId: string): R[] {
  return regimes
    .filter((r) => r.dossier_id === dossierId && r.retire_le == null)
    .sort((a, b) => (a.depuis < b.depuis ? -1 : a.depuis > b.depuis ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** Le régime en vigueur un jour donné : l'actif au plus grand `depuis` avant ce jour, ou ce jour-là. Null avant le premier. */
export function regimeEnVigueur<R extends LigneDeRegime>(regimes: readonly R[], dossierId: string, date: string): R | null {
  return regimesActifs(regimes, dossierId).filter((r) => r.depuis <= date).at(-1) ?? null
}

/** Deux régimes qui déclarent de la même façon : même statut, même article, même périodicité et même option d'un
 * redevable, mêmes fréquences. Deux régimes égaux qui se suivent ne sont pas un changement. */
export function memeRegime(a: LigneDeRegime, b: LigneDeRegime): boolean {
  return a.statut_tva === b.statut_tva && a.article_exoneration === b.article_exoneration
    && a.tva_periodicite === b.tva_periodicite && a.tva_sur_debits === b.tva_sur_debits
    && a.frequence_transactions === b.frequence_transactions && a.frequence_paiements === b.frequence_paiements
}

/** Le statut que le dossier porte aujourd'hui (onglet TVA) est-il celui de ce régime ? La périodicité et l'option ne se
 * comparent que pour un redevable : elles ne regardent que lui. */
export function regimeEstLeStatutDuDossier(regime: LigneDeRegime, d: StatutDuDossier): boolean {
  if (regime.statut_tva !== d.statut_tva || regime.article_exoneration !== d.article_exoneration) return false
  return regime.statut_tva !== 'redevable'
    || (regime.tva_periodicite === d.tva_periodicite && regime.tva_sur_debits === d.tva_sur_debits)
}

/**
 * LE RÉGIME D'UNE PÉRIODE, tel que la base l'a gardé :
 *   - `confirme` : un régime confirmé couvre son premier jour, aucun autre ne commence dans la période, et le statut que
 *     le dossier porte aujourd'hui est celui du régime en vigueur aujourd'hui — ou la période a fini avant que celui-ci
 *     commence — : elle se juge sous ce régime ;
 *   - `a_confirmer` : aucun régime confirmé ne couvre son premier jour ;
 *   - `a_cheval` : un autre régime commence dans la période — les sources publiques ne disent pas comment se déclare une
 *     période à cheval sur deux régimes (à trancher par le cabinet) ;
 *   - `a_reconfirmer` : le statut du dossier n'est plus celui du régime en vigueur aujourd'hui (`enVigueur`), et la
 *     période finit le jour où celui-ci a commencé ou après — le changement n'est pas daté, la période est peut-être sous
 *     le nouveau ; elle se juge, en attendant, sous le régime de son premier jour (`regime`).
 * Deux régimes égaux qui se suivent ne sont pas un changement (`memeRegime`).
 */
export type RegimeDeLaPeriode<R extends LigneDeRegime = LigneDeRegime> =
  | { etat: 'confirme'; regime: R }
  | { etat: 'a_confirmer' }
  | { etat: 'a_cheval'; avant: R; apres: R }
  | { etat: 'a_reconfirmer'; regime: R; enVigueur: R }

export function regimeDeLaPeriode<R extends LigneDeRegime>(
  regimes: readonly R[],
  periode: { debut: string; fin: string },
  dossier: StatutDuDossier & Pick<Dossier, 'id'>,
  aujourdHui: string,
): RegimeDeLaPeriode<R> {
  const actifs = regimesActifs(regimes, dossier.id)
  const auDebut = actifs.filter((r) => r.depuis <= periode.debut).at(-1)
  if (auDebut == null) return { etat: 'a_confirmer' }
  let enVigueur = auDebut
  for (const r of actifs.filter((x) => x.depuis > periode.debut && x.depuis <= periode.fin)) {
    if (!memeRegime(r, enVigueur)) return { etat: 'a_cheval', avant: enVigueur, apres: r }
    enVigueur = r
  }
  const aujourdhui = actifs.filter((r) => r.depuis <= aujourdHui).at(-1)
  if (aujourdhui != null && !regimeEstLeStatutDuDossier(aujourdhui, dossier) && periode.fin >= aujourdhui.depuis) {
    return { etat: 'a_reconfirmer', regime: auDebut, enVigueur: aujourdhui }
  }
  return { etat: 'confirme', regime: auDebut }
}

/** Le dossier tel qu'il était sous ce régime : son statut, son article, sa périodicité et son option ; son identité —
 * SIRET, numéro de TVA attribué — reste celle d'aujourd'hui, sous laquelle il déclare. */
export function dossierSousLeRegime<D extends StatutDuDossier>(d: D, r: LigneDeRegime): D {
  return {
    ...d,
    statut_tva: r.statut_tva,
    article_exoneration: r.article_exoneration,
    // Nulle pour un régime qui n'est pas d'un redevable, où elle ne compte pas : celle du dossier reste.
    tva_periodicite: r.tva_periodicite ?? d.tva_periodicite,
    tva_sur_debits: r.tva_sur_debits,
  }
}

const STATUTS: Readonly<Record<StatutTva, string>> = {
  redevable: 'redevable',
  franchise: 'en franchise en base',
  exonere: 'exonéré',
}

/** « redevable, par décade », « en franchise en base, tous les deux mois », « redevable en partie exonéré, chaque mois ». */
export function libelleDuRegime(r: Pick<RegimeEreporting, 'statut_tva' | 'article_exoneration' | 'frequence_transactions'>): string {
  const statut = r.statut_tva === 'redevable' && r.article_exoneration != null ? 'redevable en partie exonéré' : STATUTS[r.statut_tva]
  return `${statut}, ${rythme(r.frequence_transactions)}`
}

// ── Les pièces écartées ─────────────────────────────────────────────────────────────────────────────────────────────

/** L'écart ACTIF d'une pièce, s'il y en a un (un seul : la base le garantit). */
export function ecartActif<E extends Pick<PieceEcarteeEreporting, 'piece_id' | 'retire_le'>>(ecarts: readonly E[], pieceId: string): E | null {
  return ecarts.find((e) => e.piece_id === pieceId && e.retire_le == null) ?? null
}

/** Les pièces d'un dossier que le cabinet a écartées et n'a pas reprises. Les lignes d'un autre dossier sont ignorées. */
export function piecesEcarteesActives(ecarts: readonly Pick<PieceEcarteeEreporting, 'dossier_id' | 'piece_id' | 'retire_le'>[],
  dossierId: string): Set<string> {
  return new Set(ecarts.filter((e) => e.dossier_id === dossierId && e.retire_le == null).map((e) => e.piece_id))
}
