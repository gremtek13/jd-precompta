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

// L'ALERTE DE HAUSSE DU CHIFFRE D'AFFAIRES D'UN DOSSIER (la demande du cabinet du 15/11/2026, au MVP ; la conception :
// docs/conceptions/52-alerte-hausse-du-chiffre-d-affaires.md). À la fin de chaque trimestre civil, les recettes encaissées du
// trimestre se comparent à celles du même trimestre de l'année d'avant, et le cumul depuis le 1er janvier au cumul de l'année
// d'avant à la même date ; quand l'une des deux hausses atteint le seuil que le cabinet a réglé pour le dossier, l'alerte se
// dit dans la Vue d'ensemble et sur le tableau de bord du cabinet. Elle SIGNALE, et rien d'autre : ses mots disent le constat,
// les deux chiffres comparés et le seuil du dossier — jamais ce qu'il faudrait en faire, que l'expert-comptable décide avec son
// client (la précision du cabinet du 15/11/2026).
//
// CE MODULE EST PUR : il ne lit rien en base (la lecture : lib/hausseDuChiffreDAffairesLecture.ts). Le chiffre d'une période
// est celui de l'estimation (`chiffreDAffairesDeLaPeriode`, lib/estimation.ts), sur les mêmes entrées que l'onglet Estimation
// les assemble : aucun second moteur. Il se juge en CENTIMES entiers, la hausse par une comparaison exacte en entiers ; la
// variation montrée, au dixième de point (`variationEnDixiemes`, la règle de la revue analytique).
//
// QUAND RIEN NE SE DIT. Sans seuil (nul) : rien. Un seul trimestre se juge, le DERNIER CLOS au jour de Paris, et seulement
// quand ses trois mois sont au relevé (un mouvement au moins dans chacun, la règle des mois reçus de la Vue d'ensemble,
// `moisManquantsDe`) et qu'aucun de ses crédits n'est encore à traiter — sinon il est « en attente ». Une comparaison ne se
// fait que si ses DEUX périodes sont ainsi complètes et que l'année d'avant a des recettes : sinon elle est « non
// comparable », et sans aucune comparaison, l'alerte est « sans comparaison ». Une lecture partielle ne se juge jamais : la
// lecture le dit (`illisible`) et ce module n'est pas appelé.
//
// LIMITE ÉCRITE : un mois se dit au relevé sur l'ensemble du dossier. Le drapeau `COMPTES_BANCAIRES_PREVUS` levé (plusieurs
// comptes bancaires), il faudra le juger compte par compte (`moisManquantsParCompte`) : un compte importé ne couvre pas le
// trou de l'autre.

/** La migration `hausse_du_chiffre_d_affaires` (supabase/preparees/20261115140000_hausse_du_chiffre_d_affaires.sql) est-elle
 *  en base ? Baissé : aucune lecture, aucun écran, aucune table au plan de sauvegarde. */
export const HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE = false

export const SEUIL_MINIMUM = 1
export const SEUIL_MAXIMUM = 1000

export type NumeroDeTrimestre = 1 | 2 | 3 | 4
export interface Trimestre { annee: number; trimestre: NumeroDeTrimestre }

/** Une marque « vue avec le client » telle que la base la rend. */
export interface HausseVue { dossier_id: string; annee: number; trimestre: number; vue_par: string; vue_le: string }

/** Le seuil du dossier tel que la base le rend. */
export interface SeuilDuDossier { dossier_id: string; seuil_de_hausse: number | null; regle_par: string; regle_le: string }

export const COLONNES_DU_SEUIL = 'dossier_id, seuil_de_hausse, regle_par, regle_le'
export const COLONNES_DES_VUES = 'id, dossier_id, annee, trimestre, vue_par, vue_le'

/** Un mouvement du relevé, pour dire un mois reçu et un crédit encore à traiter. */
export type MouvementDuReleve = Pick<LigneBancaire, 'date' | 'montant' | 'statut'>

// ── Les trimestres ───────────────────────────────────────────────────────────────────────────────────────────────────

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

/** « 3e trimestre 2026 (juillet à septembre) » ; « 1er trimestre 2026 (janvier à mars) ». */
export function libelleDuTrimestre(t: Trimestre): string {
  const rang = t.trimestre === 1 ? '1er' : `${t.trimestre}e`
  const premier = NOMS_DES_MOIS[(t.trimestre - 1) * 3]
  const dernier = NOMS_DES_MOIS[(t.trimestre - 1) * 3 + 2]
  return `${rang} trimestre ${t.annee} (${premier} à ${dernier})`
}

/** « septembre 2026 », pour dire un mois qui manque. */
export function libelleDuMois(mois: string): string {
  return `${NOMS_DES_MOIS[Number(mois.slice(5, 7)) - 1]} ${mois.slice(0, 4)}`
}

// ── Le jugement ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Comparaison {
  debut: string
  fin: string
  debutPrecedent: string
  finPrecedent: string
  centimes: number
  precedentCentimes: number
  // La variation en dixièmes de point, signée (arrondie au plus proche, la moitié loin de zéro) : ce qui se MONTRE.
  variationDixiemes: number
  // La hausse atteint-elle le seuil ? Jugée exactement, en entiers : (N − P) × 100 ≥ seuil × P. Ce qui DÉCIDE.
  atteintLeSeuil: boolean
}

export type RaisonNonComparable = 'releve_manquant' | 'mouvements_a_traiter' | 'sans_recettes_l_annee_d_avant'

export type ComparaisonDeLaPeriode =
  | { etat: 'comparee'; comparaison: Comparaison }
  | { etat: 'non_comparable'; raison: RaisonNonComparable; mois: string[] }

export type HausseDuChiffreDAffaires =
  | { etat: 'sans_seuil' }
  | { etat: 'en_attente'; trimestre: Trimestre; seuil: number; raison: 'releve_manquant' | 'mouvements_a_traiter'; mois: string[] }
  | { etat: 'sans_comparaison'; trimestre: Trimestre; seuil: number; duTrimestre: ComparaisonDeLaPeriode; duCumul: ComparaisonDeLaPeriode | null }
  | {
      etat: 'jugee'
      trimestre: Trimestre
      seuil: number
      duTrimestre: ComparaisonDeLaPeriode
      // Nul au 1er trimestre : le cumul y est le trimestre.
      duCumul: ComparaisonDeLaPeriode | null
      // Au moins une des deux comparaisons atteint le seuil.
      hausse: boolean
      // La marque « vue avec le client » de CE trimestre, ou nulle.
      vue: HausseVue | null
    }

export interface EntreesDeLaHausse {
  // Le seuil du dossier en pour cent entier, ou nul (pas d'alerte).
  seuil: number | null
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

/** La même période un an plus tôt : un 29 février se ramène au 28. */
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

function comparer(
  debut: string, fin: string, seuil: number, moisRecus: ReadonlySet<string>, creditsATraiter: readonly MouvementDuReleve[],
  chiffreDAffaires: (debut: string, fin: string) => number,
): ComparaisonDeLaPeriode {
  const debutPrecedent = unAnPlusTot(debut)
  const finPrecedent = unAnPlusTot(fin)
  // L'année jugée d'abord, puis celle d'avant : ce qui manque se dit dans cet ordre.
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
      atteintLeSeuil: atteintLeSeuil(centimes, precedentCentimes, seuil),
    },
  }
}

/** L'alerte de hausse d'un dossier, au jour donné. */
export function jugerLaHausse(e: EntreesDeLaHausse): HausseDuChiffreDAffaires {
  if (e.seuil === null) return { etat: 'sans_seuil' }
  const seuil = e.seuil
  const trimestre = dernierTrimestreClos(e.aujourdHui)
  const { debut, fin } = bornesDuTrimestre(trimestre)
  const moisRecus = new Set(e.releve.map((l) => l.date.slice(0, 7)))
  const creditsATraiter = e.releve.filter((l) => l.montant > 0 && l.statut === ('non_rapprochee' satisfies StatutLigneBancaire))
  const enAttente = completudeDe(debut, fin, moisRecus, creditsATraiter)
  if (enAttente) return { etat: 'en_attente', trimestre, seuil, raison: enAttente.raison, mois: enAttente.mois }
  const duTrimestre = comparer(debut, fin, seuil, moisRecus, creditsATraiter, e.chiffreDAffaires)
  const duCumul = trimestre.trimestre === 1
    ? null
    : comparer(`${trimestre.annee}-01-01`, fin, seuil, moisRecus, creditsATraiter, e.chiffreDAffaires)
  const comparees = [duTrimestre, duCumul].filter((c): c is Extract<ComparaisonDeLaPeriode, { etat: 'comparee' }> =>
    c !== null && c.etat === 'comparee')
  if (comparees.length === 0) return { etat: 'sans_comparaison', trimestre, seuil, duTrimestre, duCumul }
  const vue = e.vues.find((v) => v.annee === trimestre.annee && v.trimestre === trimestre.trimestre) ?? null
  return {
    etat: 'jugee', trimestre, seuil, duTrimestre, duCumul, vue,
    hausse: comparees.some((c) => c.comparaison.atteintLeSeuil),
  }
}

/** L'alerte attend-elle le cabinet : une hausse jugée, que personne n'a encore marquée vue avec le client ? */
export function alerteAVoir(h: HausseDuChiffreDAffaires): h is Extract<HausseDuChiffreDAffaires, { etat: 'jugee' }> {
  return h.etat === 'jugee' && h.hausse && h.vue === null
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
      s.piecesDeVente, paiements, debut, fin, assujettiTva, mode, parts, recettesFacturees, recettesDeCaisse) * 100),
  }
}

// ── Les mots ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export const TITRE_DE_L_ALERTE = 'Hausse du chiffre d’affaires'
export const TITRE_DE_LA_CARTE = 'Alerte de hausse du chiffre d’affaires'
export const LIBELLE_MARQUER_VUE = 'Vue avec le client'
export const LIBELLE_OUVRIR_LA_VUE_D_ENSEMBLE = 'Ouvrir la Vue d’ensemble'

export const EXPLICATION_DE_LA_CARTE = 'À la fin de chaque trimestre civil, les recettes encaissées du trimestre se comparent '
  + 'à celles du même trimestre de l’année d’avant, et le cumul depuis le 1er janvier au cumul de l’année d’avant à la même '
  + 'date. Quand l’une des deux hausses atteint le seuil du dossier, l’alerte se dit dans la Vue d’ensemble et sur le tableau '
  + 'de bord du cabinet. Le trimestre ne se juge qu’une fois son relevé importé et ses encaissements traités. Rien n’est '
  + 'montré au client.'
export const SOURCE_DU_CHIFFRE = 'Les recettes encaissées, comptées comme l’onglet Estimation les compte : les pièces de vente à '
  + 'leur encaissement, les recettes du relevé, les ventes facturées et les espèces de la caisse.'
export const SEUIL_VIDE = 'Aucun seuil : l’alerte ne se calcule pas pour ce dossier.'
export const SEUIL_NON_ENREGISTRE = 'Le seuil n’a pas été enregistré.'
export const MARQUE_NON_ENREGISTREE = 'La marque n’a pas été enregistrée.'
export const ILLISIBLE_DANS_LA_VUE = 'L’alerte de hausse du chiffre d’affaires ne se calcule pas : les données du dossier n’ont pas '
  + 'pu être lues en entier. Recharge la page.'
export const REGLAGE_ILLISIBLE = 'Le seuil et les marques de l’alerte n’ont pas pu être lus. Recharge la page.'

/** Les refus des deux fonctions de la migration, sous leurs mots (hausseDuChiffreDAffaires.test.ts les confronte au texte SQL). */
export const REFUS_DE_LA_BASE = {
  seuilParLeCabinet: 'Le seuil de hausse du chiffre d\'affaires ne se règle que par le cabinet du dossier.',
  seuilHorsBornes: 'Le seuil de hausse se règle en pour cent entier, de 1 à 1 000, ou se laisse vide.',
  seuilChange: 'Le seuil de hausse a changé depuis sa lecture : relis-le avant de l\'enregistrer.',
  vueParLeCabinet: 'Une hausse ne se marque vue avec le client que par le cabinet du dossier.',
  trimestreInvalide: 'Le trimestre se dit par son année et son rang, de 1 à 4.',
  trimestreNonClos: 'Un trimestre ne se marque vu avec le client qu\'une fois clos.',
  dejaVue: 'Ce trimestre est déjà marqué vu avec le client.',
  vueNeSeModifiePas: 'Une hausse vue avec le client ne se modifie pas.',
  vueNeSeRetirePas: 'Une hausse vue avec le client ne se retire pas : elle part avec son dossier.',
  seuilAutreDossier: 'Le seuil d\'un dossier ne passe pas à un autre dossier.',
} as const

/** Le refus d'un seuil hors bornes, dit avant le clic sous les mots mêmes de la base : la saisie telle qu'elle partirait. */
export const SEUIL_HORS_BORNES: string = REFUS_DE_LA_BASE.seuilHorsBornes

/** Le seuil tapé : nul pour un champ vide, sinon un entier de 1 à 1 000 ; NaN pour tout le reste (le refus se dit). */
export function seuilDeLaSaisie(texte: string): number | null {
  const t = texte.trim()
  if (t === '') return null
  if (!/^[0-9]{1,4}$/.test(t)) return Number.NaN
  return Number(t)
}

/** Le refus de la saisie, dit avant le clic, ou nul. */
export function refusDuSeuil(seuil: number | null): string | null {
  if (seuil === null) return null
  return Number.isInteger(seuil) && seuil >= SEUIL_MINIMUM && seuil <= SEUIL_MAXIMUM ? null : SEUIL_HORS_BORNES
}

/** « +30,2 % », « −4,0 % », « 0,0 % » : des dixièmes de point. */
export function pourcentDesDixiemes(dixiemes: number): string {
  const signe = dixiemes > 0 ? '+' : dixiemes < 0 ? '−' : ''
  const abs = Math.abs(dixiemes)
  return `${signe}${Math.floor(abs / 10)},${abs % 10}${String.fromCharCode(160)}%`
}

/** Pourquoi une période ne se compare pas, en mots. */
function pourquoiNonComparable(c: Extract<ComparaisonDeLaPeriode, { etat: 'non_comparable' }>): string {
  if (c.raison === 'sans_recettes_l_annee_d_avant') return 'l’année d’avant n’a pas de recettes sur la même période'
  const mois = c.mois.map(libelleDuMois).join(', ')
  return c.raison === 'releve_manquant' ? `le relevé manque pour ${mois}` : `des encaissements restent à traiter en ${mois}`
}

/** La phrase d'une comparaison, neutre : les deux chiffres et la variation. */
export function phraseDeLaComparaison(c: ComparaisonDeLaPeriode, nature: 'trimestre' | 'cumul', t: Trimestre): string {
  if (c.etat === 'non_comparable') {
    return `${nature === 'trimestre' ? 'Le trimestre' : 'Le cumul depuis le 1er janvier'} ne se compare pas : ${pourquoiNonComparable(c)}.`
  }
  const k = c.comparaison
  const variation = pourcentDesDixiemes(k.variationDixiemes)
  return nature === 'trimestre'
    ? `Le chiffre d’affaires du ${libelleDuTrimestre(t)} est de ${formatMoney(k.centimes / 100)}, contre `
      + `${formatMoney(k.precedentCentimes / 100)} au même trimestre de ${t.annee - 1} : ${variation}.`
    : `Depuis le 1er janvier ${t.annee} : ${formatMoney(k.centimes / 100)}, contre ${formatMoney(k.precedentCentimes / 100)} `
      + `du 1er janvier au ${formatDate(k.finPrecedent)} : ${variation}.`
}

/** La phrase du seuil du dossier. */
export function phraseDuSeuil(seuil: number): string {
  return `Le seuil de ce dossier est de ${seuil}${String.fromCharCode(160)}%.`
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
    const mois = h.mois.map(libelleDuMois).join(', ')
    return {
      genre: 'discret',
      phrase: h.raison === 'releve_manquant'
        ? `Alerte de hausse : le ${libelleDuTrimestre(h.trimestre)} se jugera quand le relevé de ${mois} sera importé.`
        : `Alerte de hausse : le ${libelleDuTrimestre(h.trimestre)} se jugera quand ses encaissements de ${mois} seront traités.`,
    }
  }
  if (h.etat === 'sans_comparaison') {
    // Le trimestre ne se compare pas, par construction (sinon l'alerte serait jugée) : sa raison est celle qui se dit.
    const raison = h.duTrimestre.etat === 'non_comparable' ? pourquoiNonComparable(h.duTrimestre) : 'aucune comparaison possible'
    return { genre: 'discret', phrase: `Alerte de hausse : le ${libelleDuTrimestre(h.trimestre)} ne se compare pas à l’année d’avant — ${raison}.` }
  }
  if (!alerteAVoir(h)) return { genre: 'rien' }
  const phrases = [phraseDeLaComparaison(h.duTrimestre, 'trimestre', h.trimestre)]
  if (h.duCumul !== null) phrases.push(phraseDeLaComparaison(h.duCumul, 'cumul', h.trimestre))
  phrases.push(phraseDuSeuil(h.seuil))
  return { genre: 'alerte', titre: TITRE_DE_L_ALERTE, phrases, trimestre: h.trimestre }
}

/** La confirmation de la marque : elle NOMME le trimestre et ce qui s'écrit. */
export function confirmationDeLaMarque(t: Trimestre): string {
  return `Marquer la hausse du ${libelleDuTrimestre(t)} comme vue avec le client ? La marque garde ton compte et la date `
    + 'd’aujourd’hui ; elle ne se retire pas. L’alerte de ce trimestre ne se dira plus.'
}

/** « Vue avec le client le 16/11/2026, par toi » : une marque, pour la carte. */
export function phraseDeLaMarque(v: HausseVue, utilisateur: string | null): string {
  const t: Trimestre = { annee: v.annee, trimestre: v.trimestre as NumeroDeTrimestre }
  return `${libelleDuTrimestre(t)} : vue avec le client le ${formatDate(v.vue_le)}, ${parQui(v.vue_par, utilisateur)}.`
}

/** Les marques d'un dossier, les plus récentes d'abord (le trimestre, puis l'instant). */
export function marquesDansLOrdre(vues: readonly HausseVue[]): HausseVue[] {
  return [...vues].sort((a, b) => (b.annee - a.annee) || (b.trimestre - a.trimestre) || (a.vue_le < b.vue_le ? 1 : -1))
}

/** La ligne d'un dossier sur le tableau de bord : le trimestre, la plus forte des deux variations comparées, le seuil. */
export function phraseDuTableauDeBord(h: Extract<HausseDuChiffreDAffaires, { etat: 'jugee' }>): string {
  const morceaux: string[] = []
  if (h.duTrimestre.etat === 'comparee') morceaux.push(`trimestre ${pourcentDesDixiemes(h.duTrimestre.comparaison.variationDixiemes)}`)
  if (h.duCumul !== null && h.duCumul.etat === 'comparee') morceaux.push(`cumul ${pourcentDesDixiemes(h.duCumul.comparaison.variationDixiemes)}`)
  return `${libelleDuTrimestre(h.trimestre)} : ${morceaux.join(', ')} (seuil ${h.seuil}${String.fromCharCode(160)}%).`
}

// ── Le tableau de bord du cabinet ────────────────────────────────────────────────────────────────────────────────────

// LE COÛT, ÉCRIT. L'alerte d'un dossier se juge sur ses entrées entières (les collections de l'onglet Estimation) : le tableau
// de bord ne les lit que pour les dossiers que le compte suit ET qui ont un seuil, l'un après l'autre, au plus
// `PLAFOND_DU_TABLEAU_DE_BORD` par ouverture — au-delà, il le dit, et la Vue d'ensemble de chaque dossier le dit toujours. Le
// jour où les dossiers réglés passeront la dizaine, la conception dit ce qui remplacera cette lecture (§ 5).
export const PLAFOND_DU_TABLEAU_DE_BORD = 10

export const TITRE_DU_TABLEAU_DE_BORD = 'Hausse du chiffre d’affaires'

/** Les dossiers à calculer, dans l'ordre de la liste : ceux qui ont un seuil, au plus le plafond ; le compte de ceux qui restent. */
export function dossiersACalculer<D extends { id: string }>(
  dossiers: readonly D[], seuils: ReadonlyMap<string, number>, plafond: number,
): { aCalculer: D[]; nonCalcules: number } {
  const regles = dossiers.filter((d) => seuils.has(d.id))
  return { aCalculer: regles.slice(0, plafond), nonCalcules: Math.max(0, regles.length - plafond) }
}

export function phraseDuTitre(n: number): string {
  return n === 1
    ? 'Un dossier dont le chiffre d’affaires du dernier trimestre clos monte au-delà de son seuil :'
    : `${n} dossiers dont le chiffre d’affaires du dernier trimestre clos monte au-delà de leur seuil :`
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

export const SEUILS_ILLISIBLES = 'Les alertes de hausse du chiffre d’affaires ne se disent pas : les seuils des dossiers n’ont pas pu '
  + 'être lus. Recharge la page.'
