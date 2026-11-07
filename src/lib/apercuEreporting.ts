import { estUnJourCivil } from './adressesReception'
import { formatDate } from './format'
import {
  DEBUT_EREPORTING_PME, calendrierEreporting, periodeDe, type FrequenceEreporting, type ObjetEreporting, type PeriodeEreporting,
} from './periodesEreporting'
import { ARTICLES_D_EXONERATION, PERIODICITES, regimeDeLaPeriode, regimeEnVigueur, type LigneDeRegime } from './regimesEreporting'
import type { ArticleExoneration, EtatFactureElectroniqueLu, PeriodiciteTva, StatutTva } from './types'

// LA FACTURE ÉLECTRONIQUE ET L'E-REPORTING EN UN COUP D'ŒIL (espace client, partie C, étape C3, ligne 51.5 ; conception :
// HISTORIQUE.md, « L'ESPACE CLIENT, LOGICIEL DE GESTION DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », C3). Un
// module PUR : il lit la quatrième clé que la migration `apercu_facture_electronique` (en production
// depuis le 07/11/2026, supabase/schema/20261107145209_apercu_facture_electronique.sql ; C3-Q1 à Q4) ajoute à `etat_facture_electronique`, SANS RIEN
// DEVINER, et en tire la prochaine période d'e-reporting de chaque objet : « prête », « en attente de ton cabinet » ou
// « déclarée le … ». Il ne lit rien en base, n'appelle personne et ne lit pas l'horloge : le jour de Paris, l'appelant le
// DONNE.
//
// JAMAIS UNE RÈGLE RECOPIÉE. La fonction ne rend que des PHASES — le statut du dossier, ses régimes actifs et leurs
// fréquences, ses déclarations actives récentes (objet, période, jour) — ; les périodes, leurs échéances et le régime
// d'une période sont ceux de lib/periodesEreporting.ts et lib/regimesEreporting.ts. La base ne calcule aucune période.
//
// UNE CLÉ ABSENTE VEUT DIRE LA FONCTION D'HIER : `lireEtatFactureElectronique` (lib/etatFactureElectronique.ts) accepte
// les trois clés d'hier, ou les trois et `ereporting` — que ce module lit ; une forme qu'il ne sait pas lire rend la valeur
// ENTIÈRE illisible. Drapeau baissé, l'écran est celui d'hier au caractère près ; levé sur la fonction d'hier, aussi.
//
// « EN ATTENTE DE TON CABINET » N'AFFIRME RIEN DE PLUS QUE CE QUI EST LU : une période finie sans déclaration attend le
// cabinet, qui la déclare — ou sait qu'elle n'a pas d'opération : aucune transmission à blanc (BOI-TVA-DECLA-20-30-50-30,
// §80) ; ce module ne dit jamais qu'il y a quelque chose à déclarer.

/** Levé le 07/11/2026 : la migration `apercu_facture_electronique` est en production (version 20261107145209, C3-Q1).
 * Baissé — l'état d'avant, que EncartFactureElectronique.test.tsx joue encore par un accesseur —, la carte d'hier. */
export const APERCU_EREPORTING_EXPORTE: boolean = true

/** La fonction ne rend que les déclarations dont la période a fini il y a ce nombre de jours au plus : la prochaine
 * échéance tombe au plus 25 jours après la fin de sa période (le 25 du mois qui suit un bimestre civil). */
export const JOURS_DES_DECLARATIONS_RENDUES = 92

/** Au-delà de ce nombre de jours sans relevé, les statuts des factures transmises se disent « non relus depuis longtemps »
 * (C3-Q3, tranchée par le cabinet le 07/11/2026 : sept jours). */
export const JOURS_SANS_RELEVE = 7

export const CLES_DE_L_EREPORTING = {
  racine: ['statut_du_dossier', 'regimes', 'declarations'],
  statut: ['statut_tva', 'article_exoneration', 'tva_periodicite', 'tva_sur_debits'],
  regime: ['depuis', 'statut_tva', 'article_exoneration', 'tva_periodicite', 'tva_sur_debits', 'frequence_transactions',
    'frequence_paiements'],
  declaration: ['objet', 'debut', 'fin', 'declaree_le'],
} as const

export interface StatutDuDossierLu {
  statut_tva: StatutTva | null
  article_exoneration: ArticleExoneration | null
  tva_periodicite: PeriodiciteTva
  tva_sur_debits: boolean
}

export interface DeclarationDeLaPeriode {
  objet: ObjetEreporting
  debut: string
  fin: string
  /** L'instant où la déclaration active a été inscrite. */
  declaree_le: string
}

export interface EreportingLu {
  statutDuDossier: StatutDuDossierLu
  /** Les régimes actifs, du plus ancien au plus récent, sans identifiant (l'application leur en donne un, local). */
  regimes: Omit<LigneDeRegime, 'id' | 'dossier_id' | 'retire_le'>[]
  declarations: DeclarationDeLaPeriode[]
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}:\d{2}(:\d{2})?|Z)$/
const STATUTS: readonly StatutTva[] = ['redevable', 'franchise', 'exonere']
const FREQUENCES: readonly FrequenceEreporting[] = ['decade', 'mois', 'bimestre']
const OBJETS: readonly ObjetEreporting[] = ['ventes', 'achats', 'paiements']
const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const exactement = (o: Record<string, unknown>, cles: readonly string[]) =>
  Object.keys(o).length === cles.length && cles.every((c) => Object.prototype.hasOwnProperty.call(o, c))
const dans = <T>(liste: readonly T[], v: unknown): v is T => liste.includes(v as T)
const ouNul = <T>(liste: readonly T[], v: unknown): v is T | null => v === null || dans(liste, v)

/** La clé `ereporting`, lue sans rien deviner : chaque clé là, aucune de plus, chacune de sa forme. Sinon `null`. */
export function lireEreporting(rendu: unknown): EreportingLu | null {
  if (!estObjet(rendu) || !exactement(rendu, CLES_DE_L_EREPORTING.racine)) return null
  const { statut_du_dossier: s, regimes, declarations } = rendu
  if (!estObjet(s) || !exactement(s, CLES_DE_L_EREPORTING.statut)) return null
  if (!ouNul(STATUTS, s.statut_tva) || !ouNul(ARTICLES_D_EXONERATION, s.article_exoneration)
    || !dans(PERIODICITES, s.tva_periodicite) || typeof s.tva_sur_debits !== 'boolean') return null
  if (!Array.isArray(regimes) || !Array.isArray(declarations)) return null
  const regimesLus: EreportingLu['regimes'] = []
  for (const r of regimes) {
    if (!estObjet(r) || !exactement(r, CLES_DE_L_EREPORTING.regime)) return null
    if (typeof r.depuis !== 'string' || !estUnJourCivil(r.depuis) || !dans(STATUTS, r.statut_tva)
      || !ouNul(ARTICLES_D_EXONERATION, r.article_exoneration) || !ouNul(PERIODICITES, r.tva_periodicite)
      || typeof r.tva_sur_debits !== 'boolean' || !dans(FREQUENCES, r.frequence_transactions)
      || !ouNul(['mois', 'bimestre'] as const, r.frequence_paiements)) return null
    // Rendus dans l'ordre de `depuis`, un seul par jour (la base le garantit) : un désordre n'est pas une valeur lue.
    if (regimesLus.length > 0 && regimesLus[regimesLus.length - 1].depuis >= r.depuis) return null
    regimesLus.push({
      depuis: r.depuis, statut_tva: r.statut_tva, article_exoneration: r.article_exoneration, tva_periodicite: r.tva_periodicite,
      tva_sur_debits: r.tva_sur_debits, frequence_transactions: r.frequence_transactions, frequence_paiements: r.frequence_paiements,
    })
  }
  const declarationsLues: DeclarationDeLaPeriode[] = []
  for (const d of declarations) {
    if (!estObjet(d) || !exactement(d, CLES_DE_L_EREPORTING.declaration)) return null
    if (!dans(OBJETS, d.objet) || typeof d.debut !== 'string' || !estUnJourCivil(d.debut) || typeof d.fin !== 'string'
      || !estUnJourCivil(d.fin) || d.fin < d.debut || typeof d.declaree_le !== 'string' || !INSTANT.test(d.declaree_le)
      || Number.isNaN(Date.parse(d.declaree_le))) return null
    declarationsLues.push({ objet: d.objet, debut: d.debut, fin: d.fin, declaree_le: d.declaree_le })
  }
  return {
    statutDuDossier: {
      statut_tva: s.statut_tva, article_exoneration: s.article_exoneration, tva_periodicite: s.tva_periodicite,
      tva_sur_debits: s.tva_sur_debits,
    },
    regimes: regimesLus,
    declarations: declarationsLues,
  }
}

// ── La prochaine période de chaque objet ─────────────────────────────────────────────────────────────────────────────
export type PhaseEreporting = 'prete' | 'en_attente_du_cabinet' | 'declaree'

export interface ProchainePeriode {
  objet: ObjetEreporting
  periode: PeriodeEreporting
  phase: PhaseEreporting
  /** Pourquoi elle attend le cabinet : son régime n'est pas confirmé tel quel, ou elle est finie sans déclaration. */
  raison: 'regime_a_confirmer' | 'periode_finie' | null
  declareeLe: string | null
}

export type ApercuEreporting =
  | { etat: 'sans_regime'; avantLObligation: boolean }
  | { etat: 'periodes'; periodes: ProchainePeriode[] }

/**
 * La prochaine période de chaque objet, au jour de Paris donné : avant le 1er septembre 2027, la première ; ensuite, celle
 * de la prochaine échéance (la première du calendrier dont l'échéance n'est pas passée). Sa fréquence est celle du régime
 * en vigueur ce jour-là — ou au 1er septembre 2027 — ; sans régime confirmé, `sans_regime`. Les paiements n'ont de période
 * que si le régime leur donne une fréquence.
 */
export function prochainesPeriodes(e: EreportingLu, dossierId: string, aujourdhui: string): ApercuEreporting {
  if (!estUnJourCivil(aujourdhui)) throw new Error(`Aujourd’hui n'est pas une date civile AAAA-MM-JJ : ${aujourdhui}`)
  const avantLObligation = aujourdhui < DEBUT_EREPORTING_PME
  const regimes: LigneDeRegime[] = e.regimes.map((r, i) => ({ ...r, id: `regime-${i}`, dossier_id: dossierId, retire_le: null }))
  const regime = regimeEnVigueur(regimes, dossierId, avantLObligation ? DEBUT_EREPORTING_PME : aujourdhui)
  if (regime === null) return { etat: 'sans_regime', avantLObligation }
  const dossier = { id: dossierId, ...e.statutDuDossier }
  const objets: [ObjetEreporting, FrequenceEreporting | null][] = [
    ['ventes', regime.frequence_transactions], ['achats', regime.frequence_transactions], ['paiements', regime.frequence_paiements],
  ]
  const periodes: ProchainePeriode[] = []
  for (const [objet, frequence] of objets) {
    if (frequence === null) continue
    const periode = avantLObligation
      ? periodeDe(DEBUT_EREPORTING_PME, frequence)
      : calendrierEreporting(frequence, aujourdhui)?.find((p) => p.echeance >= aujourdhui) ?? null
    if (periode === null) continue
    const { frequence: _f, debut, fin, echeance, prudence, libelle, libelleDe } = periode
    const p: PeriodeEreporting = { frequence: _f, debut, fin, echeance, prudence, libelle, libelleDe }
    const declaree = e.declarations.find((d) => d.objet === objet && d.debut === debut && d.fin === fin)
    if (declaree) {
      periodes.push({ objet, periode: p, phase: 'declaree', raison: null, declareeLe: declaree.declaree_le })
    } else if (regimeDeLaPeriode(regimes, p, dossier, aujourdhui).etat !== 'confirme') {
      periodes.push({ objet, periode: p, phase: 'en_attente_du_cabinet', raison: 'regime_a_confirmer', declareeLe: null })
    } else if (aujourdhui > fin) {
      periodes.push({ objet, periode: p, phase: 'en_attente_du_cabinet', raison: 'periode_finie', declareeLe: null })
    } else {
      periodes.push({ objet, periode: p, phase: 'prete', raison: null, declareeLe: null })
    }
  }
  return { etat: 'periodes', periodes }
}

// ── Les phrases de l'encart ──────────────────────────────────────────────────────────────────────────────────────────
const NOMS: Readonly<Record<ObjetEreporting, string>> = { ventes: 'Ventes', achats: 'Achats', paiements: 'Paiements' }

/** La prochaine période d'e-reporting, en phrases, dans les mots de chaque espace (tutoiement et aucun onglet chez le
 * client ; « le client » au cabinet). */
export function phrasesDeLEreporting(a: ApercuEreporting, espace: 'client' | 'cabinet'): string[] {
  const client = espace === 'client'
  if (a.etat === 'sans_regime') {
    const debut = a.avantLObligation ? ` ; la première période commence le ${formatDate(DEBUT_EREPORTING_PME)}` : ''
    return [client
      ? `Ton cabinet n’a pas encore confirmé ton régime d’e-reporting${debut}.`
      : `Le régime d’e-reporting du client n’est pas encore confirmé${debut}.`]
  }
  return a.periodes.map(({ objet, periode, phase, raison, declareeLe }) => {
    const tete = `${NOMS[objet]}, ${periode.libelle} : `
    const echeance = `échéance le ${formatDate(periode.echeance)}`
    if (phase === 'declaree') return `${tete}déclarée le ${formatDate(declareeLe ?? '')}.`
    if (phase === 'prete') return `${tete}prête (${echeance}).`
    if (raison === 'regime_a_confirmer') {
      return client ? `${tete}en attente de ton cabinet, qui doit confirmer ton régime.` : `${tete}régime à confirmer.`
    }
    return client ? `${tete}en attente de ton cabinet (${echeance}).` : `${tete}à traiter par le cabinet (${echeance}).`
  })
}

/**
 * Les statuts non relus depuis longtemps : une plateforme agréée reliée, dont le dernier relevé des statuts date de plus de
 * `JOURS_SANS_RELEVE` jours avant le jour de Paris donné. Null sinon — un relevé qui n'a jamais eu lieu se dit déjà ailleurs
 * (« n’ont pas encore été relevés », A6B2-Q3).
 */
export function phraseDesStatutsAnciens(lu: EtatFactureElectroniqueLu, aujourdhui: string, espace: 'client' | 'cabinet'): string | null {
  if (!estUnJourCivil(aujourdhui)) throw new Error(`Aujourd’hui n'est pas une date civile AAAA-MM-JJ : ${aujourdhui}`)
  const lus = lu.plateforme.statuts_lus_le
  if (!lu.plateforme.reliee || lus === null) return null
  const ecart = Date.parse(`${aujourdhui}T00:00:00Z`) - Date.parse(lus)
  if (ecart <= JOURS_SANS_RELEVE * 86_400_000) return null
  return espace === 'client'
    ? `Les statuts de tes factures n’ont pas été relevés sur ta plateforme depuis le ${formatDate(lus)} : une réponse de l’acheteur ne se verrait pas ici.`
    : `Les statuts des factures du client n’ont pas été relevés depuis le ${formatDate(lus)}.`
}
