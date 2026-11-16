import { variation } from './analyseClient'
import { libelleDuMois } from './banqueClient'
import { partageDesComptes, type CompteDuClient, type ComptesDuClient } from './banqueClientParCompte'
import { formatDate } from './format'
import type { LectureComplete } from './lectureComplete'

// « MON ANNÉE » DANS « MA BANQUE » (espace client ; demande du cabinet du 16/11/2026 : « une analyse sur l'année et sur les
// années précédentes »). Un module PUR : l'écran a déjà lu les mouvements du relevé et les contrôles des relevés
// (lib/banqueClientLecture.ts), en entier ; le module en tire, année par année, les entrées, les sorties et leur différence,
// mois par mois, et la comparaison de l'année à la même période de l'année d'avant. Rien de plus n'est lu.
//
//  1. RIEN DE COMPTABLE : des dates et des montants du relevé, rien d'autre — ni catégorie, ni compte du plan, ni écriture, ni
//     libellé (celui de la banque nomme qui a payé). Une entrée est un mouvement positif, une sortie un mouvement négatif.
//  2. UN MOIS SE COMPTE S'IL EST COUVERT : chaque jour du mois tombe dans la période d'un relevé dont le cabinet a contrôlé le
//     solde, cohérent (le contrôle de l'import : solde d'ouverture + mouvements = solde final). Un relevé ainsi contrôlé porte
//     TOUS les mouvements de sa période ; un mois hors de ces périodes peut en manquer sans un mot, et il se dit « non
//     couvert », jamais 0. Un mois couvert du 1er à un jour J seulement (le mois en cours, un relevé coupé) se compte jusqu'à
//     J, et le dit. Un mois qui n'a pas commencé est « à venir ».
//  3. LA COMPARAISON se fait du 1er janvier au dernier jour couvert SANS INTERRUPTION depuis le 1er janvier (le cumul à date),
//     contre la même période de l'année d'avant, couverte elle aussi en entier ; sinon elle se tait, en disant pourquoi.
//  4. MUETTE sur une lecture partielle (mouvements ou relevés contrôlés) : aucun chiffre, jamais « 0 ».
//  5. PLUSIEURS COMPTES BANCAIRES (MCB7) : le partage de « Ma banque » (`partageDesComptes`) ; chaque compte a SON année, et
//     AUCUN TOTAL des comptes ne se fait — le client ne lit pas ce qui marque un virement d'un compte à l'autre, qui gonflerait
//     les entrées ET les sorties d'un total. L'écran d'aujourd'hui n'additionne pas non plus les soldes des comptes.
//
// En centimes entiers : un montant du relevé est arrondi au centime une fois, puis tout s'additionne en entiers.

export type MouvementAnalyse = { id: string; date: string; montant: number; compte_bancaire_id?: string | null }
export type ControleAnalyse = {
  id: string
  coherent: boolean
  periode_debut?: string | null
  periode_fin: string | null
  compte_bancaire_id?: string | null
}

/** Une période couverte, bornes comprises (AAAA-MM-JJ). */
export interface Intervalle { debut: string; fin: string }

export interface Totaux {
  entrees: number
  sorties: number
  /** Entrées moins sorties. */
  difference: number
}

export type EtatDuMois =
  | ({ mois: string; etat: 'couvert' } & Totaux)
  | ({ mois: string; etat: 'en_partie'; jusquAu: string } & Totaux)
  | { mois: string; etat: 'non_couvert' }
  | { mois: string; etat: 'a_venir' }

export type ComparaisonDeLAnnee =
  | { etat: 'tue'; raison: string }
  | {
    etat: 'lue'
    /** Du 1er janvier de l'année à `jusquAu`, contre le 1er janvier de l'année d'avant à `jusquAuN1`. */
    jusquAu: string
    jusquAuN1: string
    n: Totaux
    n1: Totaux
    /** Un mois couvert plus tard dans l'année, au-delà d'une interruption : la comparaison s'arrête avant lui. */
    interrompue: boolean
  }

export interface AnneeDeMaBanque {
  annee: number
  mois: EtatDuMois[]
  /** La somme des mois couverts, en entier ou en partie. */
  totaux: Totaux
  /** Les douze mois couverts en entier. */
  complete: boolean
  moisCouvertsEnEntier: number
  comparaison: ComparaisonDeLAnnee
}

/** Ce que le module garde d'un compte : ses mouvements et ses périodes couvertes. */
export type SourceDUnCompte =
  | { etat: 'sans_releve' }
  | { etat: 'lue'; annees: number[]; intervalles: Intervalle[]; mouvements: MouvementAnalyse[] }

export type AnalyseDeMaBanque =
  | { etat: 'muette'; raison: string }
  | { etat: 'un'; source: SourceDUnCompte }
  | { etat: 'comptes'; comptes: { compte: CompteDuClient; source: SourceDUnCompte }[] }

// ── Le calendrier civil, en jours entiers (aucun fuseau : des dates, pas des instants) ──────────────────────────────────
const JOUR_MS = 86_400_000
const deux = (n: number) => String(n).padStart(2, '0')
function versJour(date: string): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / JOUR_MS
}
function depuisJour(n: number): string {
  const d = new Date(n * JOUR_MS)
  return `${d.getUTCFullYear()}-${deux(d.getUTCMonth() + 1)}-${deux(d.getUTCDate())}`
}
/** Le dernier jour du mois AAAA-MM. */
export function dernierJourDuMois(mois: string): string {
  const annee = Number(mois.slice(0, 4))
  const m = Number(mois.slice(5, 7))
  return depuisJour(Date.UTC(annee, m, 1) / JOUR_MS - 1)
}
/** Le même jour un an plus tôt ; le 29 février devient le 28. */
export function memeJourLAnneeDAvant(date: string): string {
  const veille = `${Number(date.slice(0, 4)) - 1}${date.slice(4)}`
  return date.slice(5) === '02-29' ? veille.replace(/-29$/, '-28') : veille
}
const centimes = (montant: number) => Math.round(montant * 100)

// ── Les périodes couvertes ─────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Les périodes des relevés contrôlés cohérents et datés aux deux bouts, réunies : deux périodes qui se chevauchent ou se
 * touchent (le 31 puis le 1er) n'en font qu'une. Triées.
 */
export function intervallesCouverts(controles: readonly ControleAnalyse[]): Intervalle[] {
  const bruts = controles
    .filter((c) => c.coherent && c.periode_debut && c.periode_fin && c.periode_debut <= c.periode_fin)
    .map((c) => ({ debut: versJour(c.periode_debut as string), fin: versJour(c.periode_fin as string) }))
    .sort((a, b) => a.debut - b.debut)
  const reunis: { debut: number; fin: number }[] = []
  for (const i of bruts) {
    const dernier = reunis[reunis.length - 1]
    if (dernier !== undefined && i.debut <= dernier.fin + 1) dernier.fin = Math.max(dernier.fin, i.fin)
    else reunis.push({ ...i })
  }
  return reunis.map((i) => ({ debut: depuisJour(i.debut), fin: depuisJour(i.fin) }))
}

/** Le dernier jour couvert sans interruption depuis `jour` (compris), ou null si `jour` n'est pas couvert. */
export function finDeCouverture(intervalles: readonly Intervalle[], jour: string): string | null {
  return intervalles.find((i) => i.debut <= jour && jour <= i.fin)?.fin ?? null
}

function totaux(mouvements: readonly MouvementAnalyse[], du: string, au: string): Totaux {
  let entrees = 0
  let sorties = 0
  for (const m of mouvements) {
    if (m.date < du || m.date > au) continue
    const c = centimes(m.montant)
    if (c > 0) entrees += c
    else sorties -= c
  }
  return { entrees, sorties, difference: entrees - sorties }
}

// ── La lecture d'un compte ─────────────────────────────────────────────────────────────────────────────────────────────
/** Les années offertes : de la plus ancienne que le relevé touche jusqu'à l'année en cours, sans trou, de la récente à l'ancienne. */
function anneesOffertes(intervalles: readonly Intervalle[], mouvements: readonly MouvementAnalyse[], aujourdHui: string): number[] {
  const enCours = Number(aujourdHui.slice(0, 4))
  const toutes = [...intervalles.map((i) => Number(i.debut.slice(0, 4))), ...mouvements.map((m) => Number(m.date.slice(0, 4)))]
  const premiere = Math.min(enCours, ...toutes)
  const derniere = Math.max(enCours, ...toutes)
  const annees: number[] = []
  for (let a = derniere; a >= premiere; a -= 1) annees.push(a)
  return annees
}

export function sourceDUnCompte(
  mouvements: readonly MouvementAnalyse[], controles: readonly ControleAnalyse[], aujourdHui: string,
): SourceDUnCompte {
  const intervalles = intervallesCouverts(controles)
  if (intervalles.length === 0) return { etat: 'sans_releve' }
  return { etat: 'lue', annees: anneesOffertes(intervalles, mouvements, aujourdHui), intervalles, mouvements: [...mouvements] }
}

/**
 * L'analyse de « Ma banque » : muette sur une lecture partielle ou des comptes qui ne se partagent pas ; sinon un compte
 * (`un`, l'écran d'hier) ou chacun des comptes, jamais leur total.
 */
export function analyseDeMaBanque(entree: {
  mouvements: LectureComplete<MouvementAnalyse>
  controles: LectureComplete<ControleAnalyse>
  comptes: ComptesDuClient
  aujourdHui: string
}): AnalyseDeMaBanque {
  const { mouvements, controles, comptes, aujourdHui } = entree
  if (!mouvements.complete) return { etat: 'muette', raison: ANALYSE_MUETTE_MOUVEMENTS }
  if (!controles.complete) return { etat: 'muette', raison: ANALYSE_MUETTE_RELEVES }
  const partage = partageDesComptes(comptes, [...mouvements.lignes, ...controles.lignes])
  if (partage.etat === 'retenue') return { etat: 'muette', raison: ANALYSE_MUETTE_COMPTES }
  if (partage.etat === 'un') return { etat: 'un', source: sourceDUnCompte(mouvements.lignes, controles.lignes, aujourdHui) }
  return {
    etat: 'comptes',
    comptes: partage.comptes.map((compte) => ({
      compte,
      source: sourceDUnCompte(
        mouvements.lignes.filter((m) => m.compte_bancaire_id === compte.id),
        controles.lignes.filter((c) => c.compte_bancaire_id === compte.id),
        aujourdHui,
      ),
    })),
  }
}

// ── Une année ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function etatDuMois(source: Extract<SourceDUnCompte, { etat: 'lue' }>, mois: string, aujourdHui: string): EtatDuMois {
  const premier = `${mois}-01`
  if (premier > aujourdHui) return { mois, etat: 'a_venir' }
  const fin = finDeCouverture(source.intervalles, premier)
  if (fin === null) return { mois, etat: 'non_couvert' }
  const dernier = dernierJourDuMois(mois)
  if (fin >= dernier) return { mois, etat: 'couvert', ...totaux(source.mouvements, premier, dernier) }
  return { mois, etat: 'en_partie', jusquAu: fin, ...totaux(source.mouvements, premier, fin) }
}

function comparaison(
  source: Extract<SourceDUnCompte, { etat: 'lue' }>, annee: number, mois: readonly EtatDuMois[], aujourdHui: string,
): ComparaisonDeLAnnee {
  const premier = `${annee}-01-01`
  const finCouverte = finDeCouverture(source.intervalles, premier)
  if (finCouverte === null) return { etat: 'tue', raison: comparaisonSansDebut(annee) }
  const bornes = [finCouverte, `${annee}-12-31`, aujourdHui].sort()
  const jusquAu = bornes[0]
  const jusquAuN1 = memeJourLAnneeDAvant(jusquAu)
  const finN1 = finDeCouverture(source.intervalles, `${annee - 1}-01-01`)
  if (finN1 === null || finN1 < jusquAuN1) return { etat: 'tue', raison: comparaisonSansAnneeDAvant(annee - 1, jusquAuN1) }
  const interrompue = mois.some((m) => (m.etat === 'couvert' || m.etat === 'en_partie') && `${m.mois}-01` > jusquAu)
  return {
    etat: 'lue', jusquAu, jusquAuN1, interrompue,
    n: totaux(source.mouvements, premier, jusquAu),
    n1: totaux(source.mouvements, `${annee - 1}-01-01`, jusquAuN1),
  }
}

/** L'année `annee` d'un compte lu : ses douze mois, leurs totaux, et la comparaison à l'année d'avant. */
export function anneeDeMaBanque(source: Extract<SourceDUnCompte, { etat: 'lue' }>, annee: number, aujourdHui: string): AnneeDeMaBanque {
  const mois = Array.from({ length: 12 }, (_, i) => etatDuMois(source, `${annee}-${deux(i + 1)}`, aujourdHui))
  let entrees = 0
  let sorties = 0
  for (const m of mois) {
    if (m.etat === 'couvert' || m.etat === 'en_partie') { entrees += m.entrees; sorties += m.sorties }
  }
  const moisCouvertsEnEntier = mois.filter((m) => m.etat === 'couvert').length
  return {
    annee, mois, totaux: { entrees, sorties, difference: entrees - sorties },
    complete: moisCouvertsEnEntier === 12, moisCouvertsEnEntier,
    comparaison: comparaison(source, annee, mois, aujourdHui),
  }
}

/** « +12 % » ou « −5 % » de `n` sur `n1` (la règle de « Mon analyse », `variation`) ; null sans base (rien l'année d'avant). */
export function variationEnPourcent(n: number, n1: number): string | null {
  return variation({ centimes: n, n1Centimes: n1 })
}

// ── Les mots du client (tutoiement ; aucun nom d'onglet du cabinet) ──────────────────────────────────────────────────
export const TITRE_DE_L_ANALYSE = 'Mon année'
export const INTRODUCTION_DE_L_ANALYSE = 'Ce qui est entré sur ton compte et ce qui en est sorti, mois par mois, d’après ton '
  + 'relevé. Un mois ne se compte que si un relevé dont ton cabinet a contrôlé le solde le couvre : sinon, un mouvement '
  + 'pourrait manquer sans que rien ne le dise.'
export const ANALYSE_MUETTE_MOUVEMENTS = 'Ton année ne s’affiche pas : tes mouvements n’ont pas pu être lus en entier. Recharge la page.'
export const ANALYSE_MUETTE_RELEVES = 'Ton année ne s’affiche pas : tes relevés contrôlés n’ont pas pu être lus en entier. Recharge la page.'
export const ANALYSE_MUETTE_COMPTES = 'Ton année ne s’affiche pas : tes comptes bancaires n’ont pas pu être lus en entier. Recharge la page.'
export const ANALYSE_SANS_RELEVE = 'Rien à analyser pour l’instant : ton cabinet n’a encore contrôlé le solde d’aucun relevé daté.'
export const ANALYSE_SANS_TOTAL_DES_COMPTES = 'Chaque compte a son année : elles ne s’additionnent pas, un virement d’un de '
  + 'tes comptes à l’autre compterait deux fois.'
export const NON_COUVERT = 'non couvert'
export const A_VENIR = 'à venir'

export function comparaisonSansDebut(annee: number): string {
  return `Pas de comparaison : le 1er janvier ${annee} n’est couvert par aucun relevé contrôlé.`
}
export function comparaisonSansAnneeDAvant(annee: number, jusquAu: string): string {
  return `Pas de comparaison avec ${annee} : ton relevé n’y est pas couvert sans interruption du 01/01/${annee} au ${formatDate(jusquAu)}.`
}
/** « couvert », « jusqu'au 10/11/2026 », « non couvert », « à venir ». */
export function libelleDeLaCouverture(m: EtatDuMois): string {
  switch (m.etat) {
    case 'couvert': return 'couvert'
    case 'en_partie': return `jusqu’au ${formatDate(m.jusquAu)}`
    case 'non_couvert': return NON_COUVERT
    case 'a_venir': return A_VENIR
  }
}
/** Ce que l'année dit d'elle-même : entière, ou ce qui lui manque. */
export function motsDeLAnnee(a: AnneeDeMaBanque): string {
  if (a.complete) return `Toute l’année ${a.annee} est couverte par des relevés contrôlés.`
  const nommer = (etat: EtatDuMois['etat']) => a.mois.filter((m) => m.etat === etat).map((m) => libelleDuMois(m.mois))
  const morceaux = [
    `Année incomplète : ${a.moisCouvertsEnEntier} mois sur 12 couverts en entier.`,
    ...a.mois.filter((m) => m.etat === 'en_partie').map((m) => `${libelleDuMois(m.mois)} se compte ${libelleDeLaCouverture(m)}.`),
  ]
  const non = nommer('non_couvert')
  if (non.length > 0) morceaux.push(`Non couvert${non.length > 1 ? 's' : ''} : ${non.join(', ')} — s’il manque un relevé, envoie-le dans « Mes pièces ».`)
  const venir = nommer('a_venir')
  if (venir.length > 0) morceaux.push(`À venir : ${venir.join(', ')}.`)
  return morceaux.join(' ')
}
