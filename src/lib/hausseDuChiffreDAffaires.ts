import { chiffreDAffairesDeLaPeriode, recettesFactureesDuDossier } from './estimation'
import { formatDate, formatMoney } from './format'
import type { CaisseLue } from './recettesDeCaisse'
import { motifDeLaCaisse, recettesDeCaisseDuDossier, recettesPourLesMoteurs } from './recettesDeCaisse'
import { paiementsParLaCaisseDuDossier } from './paiementParLaCaisse'
import { partsDuReleve } from './partsDuReleve'
import { paiementsDesPieces, type PartEncaissee } from './rattachement'
import { variationEnDixiemes } from './revueAnalytique'
import { parQui } from './revueAnalytiqueEcran'
import type { Categorie, LigneBancaire, ModeComptable, Piece, ReglementGroupe, StatutLigneBancaire, VentilationBancaire } from './types'
import type { VentesFacturees } from './ventesFacturees'
import { ecrituresLibresParDefaut } from './ecrituresLibresDeLa2035'

// L'ALERTE DU CHIFFRE D'AFFAIRES D'UN DOSSIER, À LA HAUSSE ET À LA BAISSE (la demande du cabinet du 15/11/2026, au MVP ; ses
// réponses du 16/11/2026, CA-Q1 à CA-Q5 ; la conception : docs/conceptions/52-alerte-hausse-du-chiffre-d-affaires.md). À la fin
// de chaque trimestre civil, trois comparaisons, chacune contre la même période un an plus tôt : les recettes encaissées du
// trimestre, le cumul depuis le 1er janvier, et les douze mois clos qui finissent avec le trimestre (CA-Q3 (C)). Quand l'une
// d'elles atteint le seuil de HAUSSE du dossier, ou son seuil de BAISSE — deux seuils réglés à part, chacun nul s'il n'y a pas
// d'alerte dans ce sens (CA-Q2 (C)) —, l'alerte se dit dans la Vue d'ensemble et sur le tableau de bord du cabinet (CA-Q1 (A) :
// l'une OU l'autre). Elle SIGNALE, et rien d'autre : ses mots disent le constat, les chiffres comparés et les seuils du dossier
// — jamais ce qu'il faudrait en faire, que l'expert-comptable décide avec son client (la précision du cabinet du 15/11/2026).
//
// CE MODULE EST PUR : il ne lit rien en base (la lecture : lib/hausseDuChiffreDAffairesLecture.ts). Le chiffre d'une période
// est celui de l'estimation (`chiffreDAffairesDeLaPeriode`, lib/estimation.ts), sur les mêmes entrées que l'onglet Estimation
// les assemble (CA-Q5 (A)) : aucun second moteur. Il se juge en CENTIMES entiers, chaque seuil par une comparaison exacte en
// entiers ; la variation montrée, au dixième de point (`variationEnDixiemes`, la règle de la revue analytique).
//
// QUAND RIEN NE SE DIT. Sans aucun seuil : rien. Un seul trimestre se juge, le DERNIER CLOS au jour de Paris, et seulement
// quand ses trois mois sont au relevé (un mouvement au moins dans chacun, la règle des mois reçus de la Vue d'ensemble,
// `moisManquantsDe`) et qu'aucun de ses crédits n'est encore à traiter — sinon il est « en attente ». Une comparaison ne se
// fait que si ses DEUX périodes sont ainsi complètes et que la période d'un an plus tôt a des recettes : sinon elle est « non
// comparable » ; les douze mois demandent donc deux ans de relevé, mois par mois. Sans aucune comparaison, l'alerte est « sans
// comparaison ». Une lecture partielle ne se juge jamais : la lecture le dit (`illisible`) et ce module n'est pas appelé.
//
// LES NOMS. Le drapeau, les tables, les fonctions de la base et les types gardent le mot « hausse » de la demande du
// 15/11/2026 : la baisse s'y est ajoutée sans les renommer (ni le schéma, ni le plan de sauvegarde, ni les essais ne changent
// de nom) ; les mots que l'écran montre, eux, disent les deux sens.
//
// LIMITE ÉCRITE : un mois se dit au relevé sur l'ensemble du dossier. Le drapeau `COMPTES_BANCAIRES_PREVUS` levé (plusieurs
// comptes bancaires), il faudra le juger compte par compte (`moisManquantsParCompte`) : un compte importé ne couvre pas le
// trou de l'autre.

/** La migration `hausse_du_chiffre_d_affaires` (supabase/preparees/20261115140000_hausse_du_chiffre_d_affaires.sql) est-elle
 *  en base ? Baissé : aucune lecture, aucun écran, aucune table au plan de sauvegarde. */
export const HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE = true

/**
 * La migration `auteur_de_chaque_seuil` (CA2-Q1, décision du cabinet du 16/11/2026 : « garder l'auteur et la date de chaque
 * seuil » ; supabase/schema/20261117133253_auteur_de_chaque_seuil.sql) est-elle en base ? En production depuis le 17/11/2026
 * (235) : levé. Baissé, ses quatre colonnes ne se liraient pas, et la carte dirait le dernier réglage de la LIGNE, comme
 * avant ; à baisser AVANT tout retour. Un objet, que les tests basculent pour jouer ses deux états.
 */
export const DRAPEAU_DE_L_AUTEUR_DE_CHAQUE_SEUIL = { AUTEUR_DE_CHAQUE_SEUIL_PREVU: true as boolean }

export function auteurDeChaqueSeuilPrevu(): boolean {
  return DRAPEAU_DE_L_AUTEUR_DE_CHAQUE_SEUIL.AUTEUR_DE_CHAQUE_SEUIL_PREVU
}

/** Les deux sens d'un seuil : une colonne chacun en base (`seuil_de_hausse`, `seuil_de_baisse`), réglés à part. */
export type SensDuSeuil = 'hausse' | 'baisse'
export const SENS_DES_SEUILS: readonly SensDuSeuil[] = ['hausse', 'baisse']

/** Les bornes de chaque seuil, en pour cent entier — celles de la base : une hausse jusqu'à 1 000 %, une baisse jusqu'à 100 %
 *  (au-delà, le chiffre d'affaires serait tombé sous zéro). */
export const BORNES_DES_SEUILS: Readonly<Record<SensDuSeuil, { minimum: number; maximum: number }>> = {
  hausse: { minimum: 1, maximum: 1000 },
  baisse: { minimum: 1, maximum: 100 },
}

/** Les seuils d'un dossier, chacun nul s'il n'y a pas d'alerte dans ce sens. */
export interface SeuilsDeLAlerte { hausse: number | null; baisse: number | null }

export type NumeroDeTrimestre = 1 | 2 | 3 | 4
export interface Trimestre { annee: number; trimestre: NumeroDeTrimestre }

/** Une marque « vue avec le client » telle que la base la rend : elle vaut pour l'alerte du trimestre, dans les deux sens. */
export interface HausseVue { dossier_id: string; annee: number; trimestre: number; vue_par: string; vue_le: string }

/** La ligne des seuils du dossier telle que la base la rend : une par dossier, son dernier réglage (qui, quand). */
export interface SeuilDuDossier {
  dossier_id: string
  seuil_de_hausse: number | null
  seuil_de_baisse: number | null
  regle_par: string
  regle_le: string
  /** Le compte et l'instant du dernier réglage de chaque seuil — posé, changé ou retiré —, posés par la base (CA2-Q1, en
   *  production depuis le 17/11/2026) ; dits sous `AUTEUR_DE_CHAQUE_SEUIL_PREVU` seulement, facultatifs tant que l'état d'avant
   *  existe. Nuls : aucun réglage connu de ce seuil. */
  seuil_de_hausse_regle_par?: string | null
  seuil_de_hausse_regle_le?: string | null
  seuil_de_baisse_regle_par?: string | null
  seuil_de_baisse_regle_le?: string | null
}

export const COLONNES_DES_VUES = 'id, dossier_id, annee, trimestre, vue_par, vue_le'

/** Les seuils d'une ligne lue, ou deux seuils nuls sans ligne. */
export function seuilsDeLaLigne(ligne: Pick<SeuilDuDossier, 'seuil_de_hausse' | 'seuil_de_baisse'> | null): SeuilsDeLAlerte {
  return { hausse: ligne?.seuil_de_hausse ?? null, baisse: ligne?.seuil_de_baisse ?? null }
}

/** Le seuil d'un sens, lu d'une ligne (nul sans ligne). */
export function seuilDuSens(ligne: Pick<SeuilDuDossier, 'seuil_de_hausse' | 'seuil_de_baisse'> | null, sens: SensDuSeuil): number | null {
  return seuilsDeLaLigne(ligne)[sens]
}

/** Un dossier a-t-il au moins un seuil ? Sans aucun, l'alerte ne se calcule pas. */
export function aUnSeuil(s: SeuilsDeLAlerte): boolean {
  return s.hausse !== null || s.baisse !== null
}

/** Un mouvement du relevé, pour dire un mois reçu et un crédit encore à traiter. */
export type MouvementDuReleve = Pick<LigneBancaire, 'date' | 'montant' | 'statut'>

// ── Les trimestres, les mois ─────────────────────────────────────────────────────────────────────────────────────────

const NOMS_DES_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre',
  'novembre', 'décembre'] as const

function deuxChiffres(n: number): string {
  return String(n).padStart(2, '0')
}

/** Le dernier trimestre civil CLOS au jour donné (AAAA-MM-JJ, à Paris) : celui qui précède le trimestre du jour. */
export function dernierTrimestreClos(aujourdHui: string): Trimestre {
  const annee = Number(aujourdHui.slice(0, 4))
  const mois = Number(aujourdHui.slice(5, 7))
  const enCours = Math.floor((mois - 1) / 3) + 1
  return enCours === 1 ? { annee: annee - 1, trimestre: 4 } : { annee, trimestre: (enCours - 1) as NumeroDeTrimestre }
}

/** Le premier et le dernier jour d'un trimestre. */
export function bornesDuTrimestre(t: Trimestre): { debut: string; fin: string } {
  const premierMois = (t.trimestre - 1) * 3 + 1
  const dernierMois = premierMois + 2
  const dernierJour = new Date(Date.UTC(t.annee, dernierMois, 0)).getUTCDate()
  return { debut: `${t.annee}-${deuxChiffres(premierMois)}-01`, fin: `${t.annee}-${deuxChiffres(dernierMois)}-${deuxChiffres(dernierJour)}` }
}

/** Les douze mois clos qui finissent avec le trimestre : du premier jour du mois qui suit sa fin, un an plus tôt, à sa fin.
 *  Au 4e trimestre, ce sont les douze mois de l'année civile. */
export function bornesDesDouzeMois(t: Trimestre): { debut: string; fin: string } {
  const { fin } = bornesDuTrimestre(t)
  const moisQuiSuit = t.trimestre * 3 + 1
  return { debut: moisQuiSuit === 13 ? `${t.annee}-01-01` : `${t.annee - 1}-${deuxChiffres(moisQuiSuit)}-01`, fin }
}

/** Les mois (AAAA-MM) du premier au dernier jour d'une période civile, bornes comprises. */
export function moisDeLaPeriode(debut: string, fin: string): string[] {
  const mois: string[] = []
  let a = Number(debut.slice(0, 4))
  let m = Number(debut.slice(5, 7))
  const dernier = fin.slice(0, 7)
  for (;;) {
    const courant = `${a}-${deuxChiffres(m)}`
    if (courant > dernier) return mois
    mois.push(courant)
    m += 1
    if (m === 13) { m = 1; a += 1 }
  }
}

/** Le mois (AAAA-MM) qui suit. */
function moisSuivant(mois: string): string {
  const a = Number(mois.slice(0, 4))
  const m = Number(mois.slice(5, 7))
  return m === 12 ? `${a + 1}-01` : `${a}-${deuxChiffres(m + 1)}`
}

/** « 3e trimestre 2026 (juillet à septembre) » ; « 1er trimestre 2026 (janvier à mars) ». */
export function libelleDuTrimestre(t: Trimestre): string {
  const rang = t.trimestre === 1 ? '1er' : `${t.trimestre}e`
  const premier = NOMS_DES_MOIS[(t.trimestre - 1) * 3]
  const dernier = NOMS_DES_MOIS[(t.trimestre - 1) * 3 + 2]
  return `${rang} trimestre ${t.annee} (${premier} à ${dernier})`
}

/** « septembre 2026 », pour dire un mois. */
export function libelleDuMois(mois: string): string {
  return `${NOMS_DES_MOIS[Number(mois.slice(5, 7)) - 1]} ${mois.slice(0, 4)}`
}

/** Des mois (AAAA-MM, triés), en mots : une suite de mois consécutifs se dit de son premier à son dernier
 *  (« octobre 2024 à septembre 2025, novembre 2025 ») — douze mois manquants ne font pas une liste de douze. */
export function moisEnMots(mois: readonly string[]): string {
  const suites: string[][] = []
  for (const m of mois) {
    const derniere = suites[suites.length - 1]
    if (derniere && moisSuivant(derniere[derniere.length - 1]) === m) derniere.push(m)
    else suites.push([m])
  }
  return suites
    .map((s) => (s.length === 1 ? libelleDuMois(s[0]) : `${libelleDuMois(s[0])} à ${libelleDuMois(s[s.length - 1])}`))
    .join(', ')
}

/** « de janvier 2025 », « d’octobre 2024 », « d’août 2026 » : la préposition, élidée devant une voyelle. */
export function deDevant(texte: string): string {
  return /^[aeiouàâéèêîôû]/i.test(texte) ? `d’${texte}` : `de ${texte}`
}

// ── Le jugement ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Ce qui se compare, chacun contre la même période un an plus tôt. */
export type NatureDeLaComparaison = 'trimestre' | 'cumul' | 'douze_mois'

export interface Comparaison {
  debut: string
  fin: string
  debutPrecedent: string
  finPrecedent: string
  centimes: number
  precedentCentimes: number
  // La variation en dixièmes de point, signée (arrondie au plus proche, la moitié loin de zéro) : ce qui se MONTRE.
  variationDixiemes: number
  // Le seuil que la variation atteint, jugé exactement en entiers, ou nul : ce qui DÉCIDE. Une hausse :
  // (N − P) × 100 ≥ seuil × P ; une baisse : (P − N) × 100 ≥ seuil × P ; P strictement positif. Jamais les deux.
  franchit: SensDuSeuil | null
}

export type RaisonNonComparable = 'releve_manquant' | 'mouvements_a_traiter' | 'sans_recettes_l_annee_d_avant'

export type ComparaisonDeLaPeriode =
  | { etat: 'comparee'; comparaison: Comparaison }
  | { etat: 'non_comparable'; raison: RaisonNonComparable; mois: string[] }

export type HausseDuChiffreDAffaires =
  | { etat: 'sans_seuil' }
  | { etat: 'en_attente'; trimestre: Trimestre; seuils: SeuilsDeLAlerte; raison: 'releve_manquant' | 'mouvements_a_traiter'; mois: string[] }
  | {
      etat: 'sans_comparaison'
      trimestre: Trimestre
      seuils: SeuilsDeLAlerte
      duTrimestre: ComparaisonDeLaPeriode
      duCumul: ComparaisonDeLaPeriode | null
      surDouzeMois: ComparaisonDeLaPeriode | null
    }
  | {
      etat: 'jugee'
      trimestre: Trimestre
      seuils: SeuilsDeLAlerte
      duTrimestre: ComparaisonDeLaPeriode
      // Nul au 1er trimestre : le cumul y est le trimestre.
      duCumul: ComparaisonDeLaPeriode | null
      // Nul au 4e trimestre : les douze mois y sont l'année civile, que le cumul compare déjà.
      surDouzeMois: ComparaisonDeLaPeriode | null
      // Au moins une comparaison atteint le seuil de hausse ; au moins une, le seuil de baisse.
      hausse: boolean
      baisse: boolean
      // La marque « vue avec le client » de CE trimestre, ou nulle.
      vue: HausseVue | null
    }

export type HausseJugee = Extract<HausseDuChiffreDAffaires, { etat: 'jugee' }>

export interface EntreesDeLaHausse {
  // Les seuils du dossier en pour cent entier, chacun nul s'il n'y a pas d'alerte dans ce sens.
  seuils: SeuilsDeLAlerte
  // Aujourd'hui à Paris (AAAA-MM-JJ, `aujourdHuiAParis`), lu au rendu.
  aujourdHui: string
  // Tout le relevé du dossier, tous statuts.
  releve: readonly MouvementDuReleve[]
  // Le chiffre d'affaires d'une période, en centimes — celui de l'estimation (`chiffreDAffairesDesSources`).
  chiffreDAffaires: (debut: string, fin: string) => number
  // Les marques « vue avec le client » du dossier.
  vues: readonly HausseVue[]
}

/** Ce qui empêche une période de se juger : un mois absent du relevé d'abord, puis un crédit encore à traiter ; ou rien. */
function completudeDe(
  debut: string, fin: string, moisRecus: ReadonlySet<string>, creditsATraiter: readonly MouvementDuReleve[],
): { raison: 'releve_manquant' | 'mouvements_a_traiter'; mois: string[] } | null {
  const manquants = moisDeLaPeriode(debut, fin).filter((m) => !moisRecus.has(m))
  if (manquants.length > 0) return { raison: 'releve_manquant', mois: manquants }
  const aTraiter = [...new Set(creditsATraiter.filter((l) => l.date >= debut && l.date <= fin).map((l) => l.date.slice(0, 7)))].sort()
  return aTraiter.length > 0 ? { raison: 'mouvements_a_traiter', mois: aTraiter } : null
}

/** La même date un an plus tôt : un 29 février se ramène au 28. */
function unAnPlusTot(date: string): string {
  const annee = Number(date.slice(0, 4)) - 1
  const mmjj = date.slice(5)
  const bissextile = (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0
  return `${annee}-${mmjj === '02-29' && !bissextile ? '02-28' : mmjj}`
}

/** La hausse atteint-elle le seuil, en entiers exacts : (N − P) × 100 ≥ seuil × P, P strictement positif. */
export function atteintLeSeuil(centimes: number, precedentCentimes: number, seuil: number): boolean {
  if (precedentCentimes <= 0) return false
  return BigInt(centimes - precedentCentimes) * 100n >= BigInt(seuil) * BigInt(precedentCentimes)
}

/** La baisse atteint-elle le seuil, en entiers exacts : (P − N) × 100 ≥ seuil × P, P strictement positif. */
export function atteintLeSeuilDeBaisse(centimes: number, precedentCentimes: number, seuil: number): boolean {
  if (precedentCentimes <= 0) return false
  return BigInt(precedentCentimes - centimes) * 100n >= BigInt(seuil) * BigInt(precedentCentimes)
}

/** Le seuil qu'une variation atteint, ou nul. Un seuil nul ne juge rien ; une variation ne monte et ne baisse pas à la fois. */
export function franchissement(centimes: number, precedentCentimes: number, seuils: SeuilsDeLAlerte): SensDuSeuil | null {
  if (seuils.hausse !== null && atteintLeSeuil(centimes, precedentCentimes, seuils.hausse)) return 'hausse'
  if (seuils.baisse !== null && atteintLeSeuilDeBaisse(centimes, precedentCentimes, seuils.baisse)) return 'baisse'
  return null
}

function comparer(
  debut: string, fin: string, seuils: SeuilsDeLAlerte, moisRecus: ReadonlySet<string>, creditsATraiter: readonly MouvementDuReleve[],
  chiffreDAffaires: (debut: string, fin: string) => number,
): ComparaisonDeLaPeriode {
  const debutPrecedent = unAnPlusTot(debut)
  const finPrecedent = unAnPlusTot(fin)
  // La période jugée d'abord, puis celle d'un an plus tôt : ce qui manque se dit dans cet ordre.
  const manque = completudeDe(debut, fin, moisRecus, creditsATraiter)
    ?? completudeDe(debutPrecedent, finPrecedent, moisRecus, creditsATraiter)
  if (manque) return { etat: 'non_comparable', raison: manque.raison, mois: manque.mois }
  const centimes = chiffreDAffaires(debut, fin)
  const precedentCentimes = chiffreDAffaires(debutPrecedent, finPrecedent)
  if (precedentCentimes <= 0) return { etat: 'non_comparable', raison: 'sans_recettes_l_annee_d_avant', mois: [] }
  return {
    etat: 'comparee',
    comparaison: {
      debut, fin, debutPrecedent, finPrecedent, centimes, precedentCentimes,
      variationDixiemes: variationEnDixiemes(centimes - precedentCentimes, precedentCentimes) as number,
      franchit: franchissement(centimes, precedentCentimes, seuils),
    },
  }
}

/** L'alerte d'un dossier, au jour donné. */
export function jugerLaHausse(e: EntreesDeLaHausse): HausseDuChiffreDAffaires {
  if (!aUnSeuil(e.seuils)) return { etat: 'sans_seuil' }
  const seuils = e.seuils
  const trimestre = dernierTrimestreClos(e.aujourdHui)
  const { debut, fin } = bornesDuTrimestre(trimestre)
  const moisRecus = new Set(e.releve.map((l) => l.date.slice(0, 7)))
  const creditsATraiter = e.releve.filter((l) => l.montant > 0 && l.statut === ('non_rapprochee' satisfies StatutLigneBancaire))
  // Les deux autres périodes contiennent le trimestre : tant qu'il attend, aucune ne se compare.
  const enAttente = completudeDe(debut, fin, moisRecus, creditsATraiter)
  if (enAttente) return { etat: 'en_attente', trimestre, seuils, raison: enAttente.raison, mois: enAttente.mois }
  const juger = (d: string, f: string) => comparer(d, f, seuils, moisRecus, creditsATraiter, e.chiffreDAffaires)
  const duTrimestre = juger(debut, fin)
  const duCumul = trimestre.trimestre === 1 ? null : juger(`${trimestre.annee}-01-01`, fin)
  const surDouzeMois = trimestre.trimestre === 4 ? null : juger(bornesDesDouzeMois(trimestre).debut, fin)
  const comparees = [duTrimestre, duCumul, surDouzeMois].filter((c): c is Extract<ComparaisonDeLaPeriode, { etat: 'comparee' }> =>
    c !== null && c.etat === 'comparee')
  if (comparees.length === 0) return { etat: 'sans_comparaison', trimestre, seuils, duTrimestre, duCumul, surDouzeMois }
  const vue = e.vues.find((v) => v.annee === trimestre.annee && v.trimestre === trimestre.trimestre) ?? null
  return {
    etat: 'jugee', trimestre, seuils, duTrimestre, duCumul, surDouzeMois, vue,
    hausse: comparees.some((c) => c.comparaison.franchit === 'hausse'),
    baisse: comparees.some((c) => c.comparaison.franchit === 'baisse'),
  }
}

/** L'alerte attend-elle le cabinet : un seuil atteint, dans un sens ou l'autre, que personne n'a encore marqué vu avec le client ? */
export function alerteAVoir(h: HausseDuChiffreDAffaires): h is HausseJugee {
  return h.etat === 'jugee' && (h.hausse || h.baisse) && h.vue === null
}

// ── Le chiffre d'une période, tiré des sources ────────────────────────────────────────────────────────────────────────

/** Ce que la lecture a lu EN ENTIER du dossier pour compter son chiffre d'affaires (les entrées de l'onglet Estimation). */
export interface SourcesDuChiffreDAffaires {
  dossierId: string
  // Les pièces validées de type vente.
  piecesDeVente: Piece[]
  // TOUT le relevé, tous statuts : les mouvements rapprochés datent les pièces et portent les recettes affectées ; les autres
  // disent les mois reçus et les crédits encore à traiter.
  lignes: LigneBancaire[]
  ventilations: VentilationBancaire[]
  reglements: ReglementGroupe[]
  categories: Categorie[]
  // Les ventes facturées du dossier, et ce que les virements mixtes paient de leurs exemplaires (lib/ventesFactureesLecture.ts).
  ventesFacturees: VentesFacturees
  encaissees: readonly PartEncaissee[]
  // La caisse, telle que lue (lib/caisseLecture.ts).
  caisse: CaisseLue
}

/**
 * Le chiffre d'affaires d'une période, en centimes, assemblé comme l'onglet Estimation l'assemble (pages/dossier/EstimationTab.tsx)
 * : le relevé RAPPROCHÉ seul date les pièces et porte les recettes affectées, les parts des virements groupés et des virements
 * mixtes, les paiements par la caisse, les ventes facturées et les recettes de caisse. Une caisse lue en partie ne se compte pas :
 * le motif, et rien de calculé.
 */
export function chiffreDAffairesDesSources(
  s: SourcesDuChiffreDAffaires, assujettiTva: boolean, mode: ModeComptable,
): { ok: true; chiffreDAffaires: (debut: string, fin: string) => number } | { ok: false; motif: string } {
  const rapprochees = s.lignes.filter((l) => l.statut === 'rapprochee')
  const etatDeLaCaisse = recettesDeCaisseDuDossier(s.caisse, s.dossierId, s.categories, assujettiTva)
  const recettesDeCaisse = recettesPourLesMoteurs(etatDeLaCaisse)
  const paiementsDeLaCaisse = paiementsParLaCaisseDuDossier(s.caisse, s.dossierId)
  if (recettesDeCaisse === null || paiementsDeLaCaisse === null) {
    return { ok: false, motif: motifDeLaCaisse(etatDeLaCaisse) ?? 'la caisse du dossier n’a pas pu être lue en entier' }
  }
  const parts = partsDuReleve(rapprochees, s.categories, s.ventilations, assujettiTva)
  const paiements = paiementsDesPieces(rapprochees, s.reglements, s.encaissees, paiementsDeLaCaisse)
  const recettesFacturees = recettesFactureesDuDossier(s.ventesFacturees, mode)
  return {
    ok: true,
    chiffreDAffaires: (debut, fin) => Math.round(chiffreDAffairesDeLaPeriode(
      // Les écritures libres de l'expert (EL4) : absentes tant que leur table n'est pas en base, et un refus une fois le drapeau
      // levé, tant que leur lecture (EL5) ne les passe pas ici.
      s.piecesDeVente, paiements, debut, fin, assujettiTva, mode, parts, recettesFacturees, recettesDeCaisse,
      ecrituresLibresParDefaut()) * 100),
  }
}

// ── Les mots ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const NBSP = String.fromCharCode(160)

export const NOM_DE_L_ALERTE = 'Alerte du chiffre d’affaires'
export const TITRE_DE_L_ALERTE = 'Hausse du chiffre d’affaires'
export const TITRE_DE_L_ALERTE_DE_BAISSE = 'Baisse du chiffre d’affaires'
export const TITRE_DE_L_ALERTE_DANS_LES_DEUX_SENS = 'Variation du chiffre d’affaires'
export const TITRE_DE_LA_CARTE = 'Alerte de hausse ou de baisse du chiffre d’affaires'
export const LIBELLE_MARQUER_VUE = 'Vue avec le client'
export const LIBELLE_OUVRIR_LA_VUE_D_ENSEMBLE = 'Ouvrir la Vue d’ensemble'

/** Le libellé du champ de chaque seuil, dans la carte. */
export const LIBELLES_DES_SEUILS: Readonly<Record<SensDuSeuil, string>> = {
  hausse: 'Seuil de hausse (en %)',
  baisse: 'Seuil de baisse (en %)',
}

export const EXPLICATION_DE_LA_CARTE = 'À la fin de chaque trimestre civil, les recettes encaissées du trimestre se comparent '
  + 'à celles du même trimestre de l’année d’avant, le cumul depuis le 1er janvier au cumul de l’année d’avant à la même date, '
  + 'et les douze mois qui finissent avec le trimestre aux douze mois d’avant. Quand l’une de ces variations atteint le seuil '
  + 'de hausse ou le seuil de baisse du dossier, réglés chacun à part, l’alerte se dit dans la Vue d’ensemble et sur le tableau '
  + 'de bord du cabinet. Le trimestre ne se juge qu’une fois son relevé importé et ses encaissements traités. Rien n’est '
  + 'montré au client.'
export const SOURCE_DU_CHIFFRE = 'Les recettes encaissées, comptées comme l’onglet Estimation les compte : les pièces de vente à '
  + 'leur encaissement, les recettes du relevé, les ventes facturées et les espèces de la caisse.'
export const SEUILS_VIDES = 'Aucun seuil : l’alerte ne se calcule pas pour ce dossier.'
export const SEUIL_NON_ENREGISTRE = 'Le seuil n’a pas été enregistré.'
export const MARQUE_NON_ENREGISTREE = 'La marque n’a pas été enregistrée.'
export const ILLISIBLE_DANS_LA_VUE = 'L’alerte du chiffre d’affaires ne se calcule pas : les données du dossier n’ont pas pu être '
  + 'lues en entier. Recharge la page.'
export const REGLAGE_ILLISIBLE = 'Les seuils et les marques de l’alerte n’ont pas pu être lus. Recharge la page.'

/** Les refus des deux fonctions et des gardes de la migration, sous leurs mots (hausseDuChiffreDAffaires.test.ts les confronte
 *  au texte SQL). */
export const REFUS_DE_LA_BASE = {
  seuilParLeCabinet: 'Les seuils de l\'alerte du chiffre d\'affaires ne se règlent que par le cabinet du dossier.',
  sensInconnu: 'Un seuil se dit d\'une hausse ou d\'une baisse.',
  seuilDeHausseHorsBornes: 'Le seuil de hausse se règle en pour cent entier, de 1 à 1 000, ou se laisse vide.',
  seuilDeBaisseHorsBornes: 'Le seuil de baisse se règle en pour cent entier, de 1 à 100, ou se laisse vide.',
  seuilDeHausseChange: 'Le seuil de hausse a changé depuis sa lecture : relis-le avant de l\'enregistrer.',
  seuilDeBaisseChange: 'Le seuil de baisse a changé depuis sa lecture : relis-le avant de l\'enregistrer.',
  vueParLeCabinet: 'L\'alerte du chiffre d\'affaires ne se marque vue avec le client que par le cabinet du dossier.',
  trimestreInvalide: 'Le trimestre se dit par son année et son rang, de 1 à 4.',
  trimestreNonClos: 'Un trimestre ne se marque vu avec le client qu\'une fois clos.',
  dejaVue: 'Ce trimestre est déjà marqué vu avec le client.',
  vueNeSeModifiePas: 'Une alerte vue avec le client ne se modifie pas.',
  vueNeSeRetirePas: 'Une alerte vue avec le client ne se retire pas : elle part avec son dossier.',
  seuilAutreDossier: 'Les seuils d\'un dossier ne passent pas à un autre dossier.',
} as const

/** Le refus d'un seuil hors de ses bornes, dit avant le clic sous les mots mêmes de la base : la saisie telle qu'elle partirait. */
export const SEUILS_HORS_BORNES: Readonly<Record<SensDuSeuil, string>> = {
  hausse: REFUS_DE_LA_BASE.seuilDeHausseHorsBornes,
  baisse: REFUS_DE_LA_BASE.seuilDeBaisseHorsBornes,
}

/** Le seuil tapé : nul pour un champ vide, sinon un entier ; NaN pour tout le reste (le refus se dit). */
export function seuilDeLaSaisie(texte: string): number | null {
  const t = texte.trim()
  if (t === '') return null
  if (!/^[0-9]{1,4}$/.test(t)) return Number.NaN
  return Number(t)
}

/** Le refus de la saisie d'un seuil, dit avant le clic, ou nul. */
export function refusDuSeuil(sens: SensDuSeuil, seuil: number | null): string | null {
  if (seuil === null) return null
  const { minimum, maximum } = BORNES_DES_SEUILS[sens]
  return Number.isInteger(seuil) && seuil >= minimum && seuil <= maximum ? null : SEUILS_HORS_BORNES[sens]
}

/** « +30,2 % », « −4,0 % », « 0,0 % » : des dixièmes de point. */
export function pourcentDesDixiemes(dixiemes: number): string {
  const signe = dixiemes > 0 ? '+' : dixiemes < 0 ? '−' : ''
  const abs = Math.abs(dixiemes)
  return `${signe}${Math.floor(abs / 10)},${abs % 10}${NBSP}%`
}

function pourcent(n: number): string {
  return `${n}${NBSP}%`
}

/** « octobre 2025 à septembre 2026 » : une période de mois entiers. */
function periodeEnMots(debut: string, fin: string): string {
  return `${libelleDuMois(debut.slice(0, 7))} à ${libelleDuMois(fin.slice(0, 7))}`
}

/** Pourquoi une période ne se compare pas, en mots. */
function pourquoiNonComparable(c: Extract<ComparaisonDeLaPeriode, { etat: 'non_comparable' }>, nature: NatureDeLaComparaison): string {
  if (c.raison === 'sans_recettes_l_annee_d_avant') {
    return nature === 'douze_mois' ? 'les douze mois d’avant n’ont pas de recettes' : 'l’année d’avant n’a pas de recettes sur la même période'
  }
  const mois = deDevant(moisEnMots(c.mois))
  return c.raison === 'releve_manquant' ? `le relevé ${mois} manque` : `des encaissements ${mois} restent à traiter`
}

const SANS_COMPARAISON: Readonly<Record<NatureDeLaComparaison, string>> = {
  trimestre: 'Le trimestre ne se compare pas',
  cumul: 'Le cumul depuis le 1er janvier ne se compare pas',
  douze_mois: 'Les douze mois glissants ne se comparent pas',
}

/** La phrase d'une comparaison, neutre : les deux chiffres et la variation, signée. */
export function phraseDeLaComparaison(c: ComparaisonDeLaPeriode, nature: NatureDeLaComparaison, t: Trimestre): string {
  if (c.etat === 'non_comparable') return `${SANS_COMPARAISON[nature]} : ${pourquoiNonComparable(c, nature)}.`
  const k = c.comparaison
  const variation = pourcentDesDixiemes(k.variationDixiemes)
  const actuel = formatMoney(k.centimes / 100)
  const precedent = formatMoney(k.precedentCentimes / 100)
  if (nature === 'trimestre') {
    return `Le chiffre d’affaires du ${libelleDuTrimestre(t)} est de ${actuel}, contre ${precedent} au même trimestre de `
      + `${t.annee - 1} : ${variation}.`
  }
  if (nature === 'cumul') {
    return `Depuis le 1er janvier ${t.annee} : ${actuel}, contre ${precedent} du 1er janvier au ${formatDate(k.finPrecedent)} : ${variation}.`
  }
  return `Sur douze mois, ${deDevant(periodeEnMots(k.debut, k.fin))} : ${actuel}, contre ${precedent} `
    + `${deDevant(periodeEnMots(k.debutPrecedent, k.finPrecedent))} : ${variation}.`
}

/** La phrase des seuils du dossier : ceux qui sont réglés, et eux seuls. */
export function phraseDesSeuils(s: SeuilsDeLAlerte): string {
  if (s.hausse !== null && s.baisse !== null) {
    return `Les seuils de ce dossier : une hausse de ${pourcent(s.hausse)}, une baisse de ${pourcent(s.baisse)}.`
  }
  if (s.hausse !== null) return `Le seuil de hausse de ce dossier est de ${pourcent(s.hausse)}.`
  if (s.baisse !== null) return `Le seuil de baisse de ce dossier est de ${pourcent(s.baisse)}.`
  return SEUILS_VIDES
}

/** Le titre de l'alerte, selon le sens des seuils atteints. */
export function titreDeLAlerte(h: HausseJugee): string {
  if (h.hausse && h.baisse) return TITRE_DE_L_ALERTE_DANS_LES_DEUX_SENS
  return h.baisse ? TITRE_DE_L_ALERTE_DE_BAISSE : TITRE_DE_L_ALERTE
}

/** Ce que la Vue d'ensemble dit : l'alerte (la pastille d'attention, ses phrases, le geste), une ligne discrète, ou rien. */
export type CeQueDitLaVue =
  | { genre: 'rien' }
  | { genre: 'discret'; phrase: string }
  | { genre: 'alerte'; titre: string; phrases: string[]; trimestre: Trimestre }

export type LectureDeLaHausse =
  | { etat: 'sans_objet' }
  | { etat: 'en_cours' }
  | { etat: 'illisible'; motif: string }
  | { etat: 'lue'; hausse: HausseDuChiffreDAffaires }

export function ceQueDitLaVue(l: LectureDeLaHausse): CeQueDitLaVue {
  if (l.etat === 'sans_objet' || l.etat === 'en_cours') return { genre: 'rien' }
  if (l.etat === 'illisible') return { genre: 'discret', phrase: ILLISIBLE_DANS_LA_VUE }
  const h = l.hausse
  if (h.etat === 'sans_seuil') return { genre: 'rien' }
  if (h.etat === 'en_attente') {
    const mois = deDevant(moisEnMots(h.mois))
    return {
      genre: 'discret',
      phrase: h.raison === 'releve_manquant'
        ? `${NOM_DE_L_ALERTE} : le ${libelleDuTrimestre(h.trimestre)} se jugera quand le relevé ${mois} sera importé.`
        : `${NOM_DE_L_ALERTE} : le ${libelleDuTrimestre(h.trimestre)} se jugera quand ses encaissements ${mois} seront traités.`,
    }
  }
  if (h.etat === 'sans_comparaison') {
    // Le trimestre ne se compare pas, par construction (sinon l'alerte serait jugée) : sa raison est celle qui se dit.
    const raison = h.duTrimestre.etat === 'non_comparable' ? pourquoiNonComparable(h.duTrimestre, 'trimestre') : 'aucune comparaison possible'
    return {
      genre: 'discret',
      phrase: `${NOM_DE_L_ALERTE} : le ${libelleDuTrimestre(h.trimestre)} ne se compare pas à l’année d’avant — ${raison}.`,
    }
  }
  if (!alerteAVoir(h)) return { genre: 'rien' }
  const phrases = [phraseDeLaComparaison(h.duTrimestre, 'trimestre', h.trimestre)]
  if (h.duCumul !== null) phrases.push(phraseDeLaComparaison(h.duCumul, 'cumul', h.trimestre))
  if (h.surDouzeMois !== null) phrases.push(phraseDeLaComparaison(h.surDouzeMois, 'douze_mois', h.trimestre))
  phrases.push(phraseDesSeuils(h.seuils))
  return { genre: 'alerte', titre: titreDeLAlerte(h), phrases, trimestre: h.trimestre }
}

/** La confirmation de la marque : elle NOMME le trimestre et ce qui s'écrit. */
export function confirmationDeLaMarque(t: Trimestre): string {
  return `Marquer l’alerte du ${libelleDuTrimestre(t)} comme vue avec le client ? La marque garde ton compte et la date `
    + 'd’aujourd’hui ; elle ne se retire pas. L’alerte de ce trimestre ne se dira plus.'
}

/**
 * « Vue avec le client le 16/11/2026, par toi » : une marque, pour la carte. Qui l'a posée se dit comme qui a réglé un seuil
 * (CA2Q1-Q1 (A), 17/11/2026) : « toi », l'adresse que la session lit dans l'équipe, sinon « le cabinet » — jamais le début d'un
 * identifiant. La base garde déjà l'auteur (`vue_par`) : aucune migration, aucun drapeau.
 */
export function phraseDeLaMarque(v: HausseVue, utilisateur: string | null, equipe: ReadonlyMap<string, string>): string {
  const t: Trimestre = { annee: v.annee, trimestre: v.trimestre as NumeroDeTrimestre }
  return `${libelleDuTrimestre(t)} : vue avec le client le ${formatDate(v.vue_le)}, par ${quiARegle(v.vue_par, utilisateur, equipe)}.`
}

/** Les comptes qui ont posé une marque, sans doublon, triés : ceux dont l'équipe se lit, avec les auteurs des seuils. */
export function auteursDesMarques(vues: readonly HausseVue[]): string[] {
  return [...new Set(vues.map((v) => v.vue_par).filter((c) => c !== ''))].sort()
}

/** Les marques d'un dossier, les plus récentes d'abord (le trimestre, puis l'instant). */
export function marquesDansLOrdre(vues: readonly HausseVue[]): HausseVue[] {
  return [...vues].sort((a, b) => (b.annee - a.annee) || (b.trimestre - a.trimestre) || (a.vue_le < b.vue_le ? 1 : -1))
}

/** La ligne des seuils dans la carte : chacun, ou « aucun », puis le dernier réglage (qui, quand) que la base a posé. */
export function phraseDesSeuilsDuDossier(ligne: SeuilDuDossier | null, utilisateur: string | null): string {
  if (ligne === null) return SEUILS_VIDES
  const s = seuilsDeLaLigne(ligne)
  const reglage = `Dernier réglage le ${formatDate(ligne.regle_le)}, ${parQui(ligne.regle_par, utilisateur)}.`
  if (!aUnSeuil(s)) return `${SEUILS_VIDES} ${reglage}`
  const dit = (n: number | null) => (n === null ? 'aucun' : pourcent(n))
  return `Seuil de hausse : ${dit(s.hausse)} ; seuil de baisse : ${dit(s.baisse)}. ${reglage}`
}

// ── L'auteur de chaque seuil (CA2-Q1, sous `AUTEUR_DE_CHAQUE_SEUIL_PREVU`) ─────────────────────────────────────────────

/** Le compte et l'instant du dernier réglage d'un seuil, lus de la ligne ; nuls sans réglage connu. */
export function reglageDuSens(ligne: SeuilDuDossier, sens: SensDuSeuil): { par: string | null; le: string | null } {
  return sens === 'hausse'
    ? { par: ligne.seuil_de_hausse_regle_par ?? null, le: ligne.seuil_de_hausse_regle_le ?? null }
    : { par: ligne.seuil_de_baisse_regle_par ?? null, le: ligne.seuil_de_baisse_regle_le ?? null }
}

/** Les comptes qui ont réglé un seuil de la ligne, sans doublon, triés : ceux dont l'équipe se lit. */
export function auteursDesSeuils(ligne: SeuilDuDossier | null): string[] {
  if (ligne === null) return []
  const comptes = SENS_DES_SEUILS.map((sens) => reglageDuSens(ligne, sens).par).filter((c): c is string => c !== null && c !== '')
  return [...new Set(comptes)].sort()
}

/**
 * Qui a réglé, pour qui regarde : « toi » ; l'adresse d'un autre compte quand SA session la lit dans l'équipe du cabinet
 * (`cabinet_admins`, que la policy ne rend qu'au chef, au super-administrateur et au membre lui-même : la règle de l'onglet
 * Accès, lib/ouverturesAttestees.ts) ; sinon « le cabinet » — un membre parti aussi. Aucun identifiant ne se montre.
 */
export function quiARegle(auteur: string, utilisateur: string | null, equipe: ReadonlyMap<string, string>): string {
  if (utilisateur !== null && auteur.toLowerCase() === utilisateur.toLowerCase()) return 'toi'
  return equipe.get(auteur) ?? 'le cabinet'
}

/**
 * La ligne d'un seuil dans la carte : sa valeur, puis qui l'a réglé et quand, ce que la base a posé. Un seuil retiré dit qui l'a
 * retiré ; un seuil jamais réglé, « aucun seuil » ; un seuil sans réglage connu (ce que les contraintes de la base excluent) le
 * dit, sans deviner un auteur.
 */
export function phraseDuSeuilEtDeSonReglage(
  ligne: SeuilDuDossier, sens: SensDuSeuil, utilisateur: string | null, equipe: ReadonlyMap<string, string>,
): string {
  const nom = sens === 'hausse' ? 'Hausse' : 'Baisse'
  const seuil = seuilDuSens(ligne, sens)
  const { par, le } = reglageDuSens(ligne, sens)
  const connu = par !== null && par !== '' && le !== null && le !== ''
  if (seuil === null) return connu ? `${nom} : aucun seuil, retiré le ${formatDate(le)} par ${quiARegle(par, utilisateur, equipe)}.` : `${nom} : aucun seuil.`
  return connu
    ? `${nom} : ${pourcent(seuil)}, réglé le ${formatDate(le)} par ${quiARegle(par, utilisateur, equipe)}.`
    : `${nom} : ${pourcent(seuil)}, son réglage n’est pas connu.`
}

/** Les lignes des seuils dans la carte, la migration en base : une par seuil, ou « aucun seuil » sans ligne. */
export function phrasesDesSeuilsEtDeLeurReglage(
  ligne: SeuilDuDossier | null, utilisateur: string | null, equipe: ReadonlyMap<string, string>,
): string[] {
  if (ligne === null) return [SEUILS_VIDES]
  return SENS_DES_SEUILS.map((sens) => phraseDuSeuilEtDeSonReglage(ligne, sens, utilisateur, equipe))
}

/** Ce que la carte dit après un réglage réussi. */
export function phraseDuReglage(sens: SensDuSeuil, seuil: number | null): string {
  const nom = sens === 'hausse' ? 'Seuil de hausse' : 'Seuil de baisse'
  return seuil === null
    ? `${nom} retiré : l’alerte de ${sens} ne se calcule plus ✓`
    : `${nom} enregistré : ${pourcent(seuil)} ✓`
}

/** Les seuils en bref, pour le tableau de bord. */
function seuilsEnBref(s: SeuilsDeLAlerte): string {
  if (s.hausse !== null && s.baisse !== null) return `seuils : hausse ${pourcent(s.hausse)}, baisse ${pourcent(s.baisse)}`
  if (s.hausse !== null) return `seuil de hausse ${pourcent(s.hausse)}`
  return s.baisse !== null ? `seuil de baisse ${pourcent(s.baisse)}` : 'sans seuil'
}

/** La ligne d'un dossier sur le tableau de bord : le trimestre, les variations comparées, les seuils. */
export function phraseDuTableauDeBord(h: HausseJugee): string {
  const morceaux: string[] = []
  const dire = (c: ComparaisonDeLaPeriode | null, nom: string) => {
    if (c !== null && c.etat === 'comparee') morceaux.push(`${nom} ${pourcentDesDixiemes(c.comparaison.variationDixiemes)}`)
  }
  dire(h.duTrimestre, 'trimestre')
  dire(h.duCumul, 'cumul')
  dire(h.surDouzeMois, 'douze mois')
  return `${libelleDuTrimestre(h.trimestre)} : ${morceaux.join(', ')} (${seuilsEnBref(h.seuils)}).`
}

// ── Le tableau de bord du cabinet ────────────────────────────────────────────────────────────────────────────────────

// LE COÛT, ÉCRIT. L'alerte d'un dossier se juge sur ses entrées entières (les collections de l'onglet Estimation) : le tableau
// de bord ne les lit que pour les dossiers que le compte suit ET qui ont un seuil, l'un après l'autre, au plus
// `PLAFOND_DU_TABLEAU_DE_BORD` par ouverture — au-delà, il le dit, et la Vue d'ensemble de chaque dossier le dit toujours. Le
// jour où les dossiers réglés passeront la dizaine, la conception dit ce qui remplacera cette lecture (§ 4).
export const PLAFOND_DU_TABLEAU_DE_BORD = 10

export const TITRE_DU_TABLEAU_DE_BORD = 'Hausse ou baisse du chiffre d’affaires'

/** Les dossiers à calculer, dans l'ordre de la liste : ceux qui ont un seuil, au plus le plafond ; le compte de ceux qui restent. */
export function dossiersACalculer<D extends { id: string }>(
  dossiers: readonly D[], seuils: ReadonlyMap<string, unknown>, plafond: number,
): { aCalculer: D[]; nonCalcules: number } {
  const regles = dossiers.filter((d) => seuils.has(d.id))
  return { aCalculer: regles.slice(0, plafond), nonCalcules: Math.max(0, regles.length - plafond) }
}

export function phraseDuTitre(n: number): string {
  return n === 1
    ? 'Un dossier dont le chiffre d’affaires du dernier trimestre clos atteint l’un de ses seuils :'
    : `${n} dossiers dont le chiffre d’affaires du dernier trimestre clos atteint l’un de leurs seuils :`
}

export function phraseDesNonCalcules(n: number): string {
  return n === 1
    ? 'Un dossier réglé de plus ne se calcule pas ici : sa Vue d’ensemble dit son alerte.'
    : `${n} dossiers réglés de plus ne se calculent pas ici : la Vue d’ensemble de chacun dit son alerte.`
}

export function phraseDesIllisibles(n: number): string {
  return n === 1
    ? 'L’alerte d’un dossier n’a pas pu se calculer : ses données n’ont pas pu être lues en entier.'
    : `L’alerte de ${n} dossiers n’a pas pu se calculer : leurs données n’ont pas pu être lues en entier.`
}

export const SEUILS_ILLISIBLES = 'Les alertes du chiffre d’affaires ne se disent pas : les seuils des dossiers n’ont pas pu '
  + 'être lus. Recharge la page.'
