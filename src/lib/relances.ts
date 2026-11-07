import { dateAParis } from './format'
import type { TypeClient } from './types'

// RELANCER SES CLIENTS (espace client, étape C5 de la ligne 51.5 ; MEG3-Q3, « oui » du cabinet) — la règle et les mots,
// sans aucune lecture : une facture EN RETARD, la date de sa dernière relance DÉDUITE du journal des e-mails (rien de
// neuf ne se stocke pour elle), et les pénalités de retard et l'indemnité forfaitaire CALCULÉES pour être montrées,
// jamais facturées seules. L'e-mail lui-même part de `send-email` (le modèle « relance_facture »), sur un clic.
//
// LES SOURCES (Légifrance, lues le 06/11/2026) :
// - C. com., art. L441-10, II (en vigueur depuis le 26/04/2019) : les pénalités sont « exigibles le jour suivant la date
//   de règlement figurant sur la facture » ; « sauf disposition contraire qui ne peut toutefois fixer un taux inférieur à
//   trois fois le taux d'intérêt légal, ce taux est égal au taux d'intérêt appliqué par la Banque centrale européenne à
//   son opération de refinancement la plus récente majoré de 10 points de pourcentage » ; « le taux applicable pendant le
//   premier semestre de l'année concernée est le taux en vigueur au 1er janvier », celui du second « au 1er juillet ».
//   Art. D441-5 : l'indemnité forfaitaire pour frais de recouvrement, 40 euros.
// - C. commande publique, art. R2192-31 : un acheteur public doit des intérêts moratoires au taux de la BCE « en vigueur
//   au premier jour du semestre de l'année civile au cours duquel les intérêts moratoires ont commencé à courir, majoré de
//   huit points de pourcentage », du lendemain de l'expiration du délai de paiement à la mise en paiement incluse ; art.
//   D2192-35 : l'indemnité forfaitaire, 40 euros. Un organisme public n'est donc pas une entreprise : sa règle est la
//   sienne, et le taux qu'une facture stipule ne la change pas.
// - Un particulier ne doit ni l'un ni l'autre : ces textes ne visent que des professionnels et des acheteurs publics.
//
// UN TAUX ANNUEL SE COMPTE SUR 365 JOURS, année bissextile comprise (aucun texte ne dit l'autre) ; les pénalités se
// calculent sur le TTC qui reste dû (ni encaissé ni crédité par un avoir), en centimes entiers, arrondies une fois au
// centime, le demi vers le haut.

/**
 * Le bouton « Relancer », les pastilles « En retard » et « Relancée le … » : baissé tant que `send-email` n'a pas été
 * redéployée, sa constante `RELANCES_EN_BASE` levée — la migration `relances_des_factures` est en production depuis le
 * 07/11/2026 (supabase/schema/20261107163303_relances_des_factures.sql), la constante levée dans le dépôt le même jour.
 * L'ordre : la migration, puis le déploiement, puis ce drapeau (`relancesHttp.test.ts` refuse le drapeau levé sur une
 * fonction qui refuserait la relance).
 */
export const RELANCES_EXPORTEES = false

/** Le type d'une ligne du journal des e-mails (`emails_envoyes.type`) que laisse une relance de facture. */
export const TYPE_RELANCE_FACTURE = 'relance_facture'

// ── Le taux de la BCE, semestre par semestre ────────────────────────────────────────────────────────────────────────
// Le taux des opérations principales de refinancement (taux fixe) EN VIGUEUR au 1er janvier (S1) et au 1er juillet (S2),
// en centièmes de point. Source : Banque centrale européenne, « Key ECB interest rates »,
// https://www.ecb.europa.eu/stats/policy_and_exchange_rates/key_ecb_interest_rates/html/index.en.html, lue le
// 06/11/2026 ; chaque valeur s'y lit à la date d'effet citée. Un semestre absent n'est PAS deviné : le calcul le demande
// (`taux_manquant`). Le 1er janvier 2027 n'est pas encore venu : le taux de 2,65 % en vigueur depuis le 16/09/2026 peut
// encore changer avant lui, et 2027-S1 n'entrera qu'une fois ce jour passé, relu sur la même page.
export const TAUX_REFINANCEMENT_BCE: Readonly<Record<string, number>> = Object.freeze({
  '2023-S1': 250, // 2,50 %, en vigueur depuis le 21/12/2022
  '2023-S2': 400, // 4,00 %, depuis le 21/06/2023
  '2024-S1': 450, // 4,50 %, depuis le 20/09/2023
  '2024-S2': 425, // 4,25 %, depuis le 12/06/2024
  '2025-S1': 315, // 3,15 %, depuis le 18/12/2024
  '2025-S2': 215, // 2,15 %, depuis le 11/06/2025
  '2026-S1': 215, // 2,15 %, depuis le 11/06/2025
  '2026-S2': 240, // 2,40 %, depuis le 17/06/2026
})

/** L'indemnité forfaitaire pour frais de recouvrement, en centimes (C. com., art. D441-5 ; C. commande publique, D2192-35). */
export const INDEMNITE_FORFAITAIRE_CENTIMES = 4000

// ── Le calendrier civil ─────────────────────────────────────────────────────────────────────────────────────────────
const JOUR_MS = 86_400_000
const DATE_CIVILE = /^(\d{4})-(\d{2})-(\d{2})$/

function enJours(date: string): number {
  const m = DATE_CIVILE.exec(date)
  if (!m) throw new Error(`date civile attendue : ${date}`)
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / JOUR_MS
}

function enDate(jours: number): string {
  const d = new Date(jours * JOUR_MS)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** Le semestre d'une date civile : « 2026-S1 » du 1er janvier au 30 juin, « 2026-S2 » ensuite. */
export function semestreDe(date: string): string {
  return `${date.slice(0, 4)}-S${Number(date.slice(5, 7)) <= 6 ? 1 : 2}`
}

/** Le dernier jour du semestre d'une date civile. */
function finDuSemestre(date: string): string {
  return `${date.slice(0, 4)}-${Number(date.slice(5, 7)) <= 6 ? '06-30' : '12-31'}`
}

// ── La facture en retard ─────────────────────────────────────────────────────────────────────────────────────────────
export type RetardDeLaFacture =
  | { etat: 'en_retard'; jours: number; resteCentimes: number }
  | { etat: 'a_jour' }
  | { etat: 'illisible'; raison: string }

/**
 * Une facture est EN RETARD au jour de Paris `aujourdHui` quand elle est validée, que ce n'est pas un avoir, que son
 * échéance est passée — le lendemain de l'échéance est le premier jour de retard (L441-10, II) — et qu'il en reste dû.
 * `resteCentimes` est le TTC ni encaissé ni crédité, nul quand l'appelant ne l'a pas lu en entier : rien ne s'affirme
 * alors, ni « en retard » ni « à jour ».
 */
export function retardDeLaFacture(
  facture: { statut: string; type: string; date_echeance: string | null },
  resteCentimes: number | null,
  aujourdHui: string,
): RetardDeLaFacture {
  if (facture.statut !== 'validee' || facture.type !== 'facture' || facture.date_echeance == null) return { etat: 'a_jour' }
  const jours = enJours(aujourdHui) - enJours(facture.date_echeance)
  if (jours <= 0) return { etat: 'a_jour' }
  if (resteCentimes == null) return { etat: 'illisible', raison: 'Les encaissements de la facture ne sont pas lus en entier : son retard ne se dit pas.' }
  return resteCentimes > 0 ? { etat: 'en_retard', jours, resteCentimes } : { etat: 'a_jour' }
}

// ── « Relancée le … », déduit du journal ────────────────────────────────────────────────────────────────────────────
/** Une ligne du journal des e-mails, telle que la lecture des relances la rend. */
export interface RelanceJournalisee {
  facture_id: string | null
  created_at: string
}

/** Le jour de Paris de la dernière relance de la facture, ou nul si le journal n'en porte aucune. */
export function derniereRelance(journal: readonly RelanceJournalisee[], factureId: string): string | null {
  let derniere: string | null = null
  for (const l of journal) {
    if (l.facture_id !== factureId) continue
    if (derniere === null || Date.parse(l.created_at) > Date.parse(derniere)) derniere = l.created_at
  }
  return derniere === null ? null : dateAParis(derniere)
}

// ── Le taux que la facture a figé ────────────────────────────────────────────────────────────────────────────────────
export type TauxDeLaFacture =
  | { origine: 'facture'; centiemes: number }
  | { origine: 'loi'; motif: 'conditions_non_figees' | 'aucun_texte' | 'renvoi_a_la_loi' | 'texte_illisible' }

const POURCENTAGE = /(\d{1,3}(?:[.,]\d+)?)\s*(?:%|pour\s*cent\b)/giu
// Un taux qui se lit SANS DEVINER est un nombre en pour cent, seul, qu'aucun mot ne rapporte à un autre taux.
const AUTRE_TAUX = /banque\s+centrale|\bbce\b|refinancement|l[ée]gal|\bfois\b|\bpoints?\b|major[ée]|euribor|\+/iu
const RENVOI_A_LA_LOI = /(?:banque\s+centrale|\bbce\b|refinancement)/iu
const DIX_POINTS = /\b(?:10|dix)\s+points?\b/iu

/**
 * Le taux des pénalités que la facture a FIGÉ dans ses conditions de paiement (`penalites`, A7a), s'il se lit sans
 * deviner : un seul pourcentage, à deux décimales au plus, qu'aucun mot ne rapporte à un autre taux (« 12 % l'an »).
 * Sinon, le taux de la loi s'applique, et le motif dit pourquoi : la facture n'a pas figé ses conditions (validée avant
 * A7), elle n'en porte aucun texte, son texte renvoie au taux de la loi (BCE + 10 points), ou il dit autre chose que
 * l'application ne lit pas — l'écran le cite alors, à vérifier.
 */
export function tauxDeLaFacture(mentionsFigees: boolean, texte: string | null): TauxDeLaFacture {
  if (!mentionsFigees) return { origine: 'loi', motif: 'conditions_non_figees' }
  if (texte == null || texte.trim() === '') return { origine: 'loi', motif: 'aucun_texte' }
  const nombres = [...texte.matchAll(POURCENTAGE)].map((m) => m[1].replace(',', '.'))
  if (nombres.length === 1 && !AUTRE_TAUX.test(texte) && /^\d{1,3}(?:\.\d{1,2})?$/.test(nombres[0])) {
    const [entiers, decimales = ''] = nombres[0].split('.')
    const centiemes = Number(entiers) * 100 + Number(decimales.padEnd(2, '0'))
    if (centiemes > 0 && centiemes <= 10_000) return { origine: 'facture', centiemes }
  }
  if (nombres.length === 0 && RENVOI_A_LA_LOI.test(texte) && DIX_POINTS.test(texte)) return { origine: 'loi', motif: 'renvoi_a_la_loi' }
  return { origine: 'loi', motif: 'texte_illisible' }
}

// ── Les pénalités de retard et l'indemnité forfaitaire ───────────────────────────────────────────────────────────────
export type RegimeDesPenalites = 'commerce' | 'commande_publique'

export interface PeriodeDesPenalites {
  du: string
  au: string
  jours: number
  /** Le taux annuel appliqué, en centièmes de point. */
  centiemes: number
}

export type Penalites =
  | { etat: 'sans_objet'; raison: string }
  | { etat: 'taux_manquant'; semestres: string[]; raison: string }
  | {
    etat: 'calculees'
    regime: RegimeDesPenalites
    taux: TauxDeLaFacture
    periodes: PeriodeDesPenalites[]
    jours: number
    penalitesCentimes: number
    indemniteCentimes: number
  }

export interface EntreeDesPenalites {
  typeClient: TypeClient | null
  /** Ce que la facture a figé à sa validation (A7a) : la marque, et le texte des pénalités qu'elle imprime. */
  mentionsFigees: boolean
  penalitesFigees: string | null
  dateEcheance: string
  /** Le jour de Paris (`aujourdHuiAParis`) : le dernier jour compté. */
  aujourdHui: string
  /** Le TTC qui reste dû, en centimes. */
  resteCentimes: number
  /** Le taux de la BCE de chaque semestre, en centièmes de point : SANS DÉFAUT — un semestre absent se demande. */
  tauxBce: Readonly<Record<string, number>>
}

export const RAISON_PARTICULIER =
  'Ni pénalités de retard ni indemnité forfaitaire : la facture est adressée à un particulier, que ces règles ne visent '
  + 'pas (C. com., art. L441-10 : entre professionnels).'
const RAISON_ETRANGER =
  'Rien n’est calculé : le client est établi hors de France, et la loi qui régit son retard dépend du contrat.'
const RAISON_TYPE_INCONNU =
  'Rien n’est calculé : la facture ne dit pas si le client est une entreprise, un organisme public ou un particulier.'

/**
 * Les pénalités de retard et l'indemnité forfaitaire d'une facture en retard, au jour de Paris `aujourdHui`. Entre
 * entreprises (`assujetti`), le taux figé lisible, sinon celui de la BCE de chaque semestre majoré de 10 points, chaque
 * jour de retard compté sous le taux de son semestre ; pour un organisme public, le taux de la BCE du semestre où le
 * retard a commencé, majoré de 8 points, pour tout le retard. Le premier jour compté est le lendemain de l'échéance, le
 * dernier `aujourdHui`. Rien pour un particulier, un client établi hors de France ou un type inconnu : la raison le dit.
 */
export function penalitesDeRetard(e: EntreeDesPenalites): Penalites {
  if (e.typeClient === 'non_assujetti') return { etat: 'sans_objet', raison: RAISON_PARTICULIER }
  if (e.typeClient === 'etranger') return { etat: 'sans_objet', raison: RAISON_ETRANGER }
  if (e.typeClient !== 'assujetti' && e.typeClient !== 'organisme_public') return { etat: 'sans_objet', raison: RAISON_TYPE_INCONNU }
  const premier = enJours(e.dateEcheance) + 1
  const dernier = enJours(e.aujourdHui)
  if (dernier < premier) return { etat: 'sans_objet', raison: 'La facture n’est pas en retard : son échéance n’est pas passée.' }
  if (!Number.isSafeInteger(e.resteCentimes) || e.resteCentimes <= 0) {
    return { etat: 'sans_objet', raison: 'Rien ne reste dû sur cette facture.' }
  }

  const regime: RegimeDesPenalites = e.typeClient === 'organisme_public' ? 'commande_publique' : 'commerce'
  const taux: TauxDeLaFacture = regime === 'commerce'
    ? tauxDeLaFacture(e.mentionsFigees, e.penalitesFigees)
    : { origine: 'loi', motif: 'aucun_texte' }
  // Les périodes : une seule pour un organisme public ou un taux figé, une par semestre sous le taux de la loi.
  const bornes: { du: number; au: number; semestre: string }[] = []
  if (regime === 'commande_publique' || taux.origine === 'facture') {
    bornes.push({ du: premier, au: dernier, semestre: semestreDe(enDate(premier)) })
  } else {
    for (let du = premier; du <= dernier;) {
      const au = Math.min(enJours(finDuSemestre(enDate(du))), dernier)
      bornes.push({ du, au, semestre: semestreDe(enDate(du)) })
      du = au + 1
    }
  }
  const manquants = taux.origine === 'facture'
    ? []
    : [...new Set(bornes.map((b) => b.semestre))].filter((s) => !Number.isSafeInteger(e.tauxBce[s]))
  if (manquants.length > 0) {
    return {
      etat: 'taux_manquant', semestres: manquants,
      raison: `Le taux de la BCE ${manquants.map(enMotsDuSemestre).join(' et ')} n’est pas encore dans l’application : `
        + 'les pénalités ne se calculent pas sans lui.',
    }
  }
  const majoration = regime === 'commerce' ? 1000 : 800
  const periodes = bornes.map((b): PeriodeDesPenalites => ({
    du: enDate(b.du), au: enDate(b.au), jours: b.au - b.du + 1,
    centiemes: taux.origine === 'facture' ? taux.centiemes : e.tauxBce[b.semestre] + majoration,
  }))
  // Σ reste × taux × jours / (365 × 10 000), en entiers longs, arrondie une fois au centime, le demi vers le haut.
  const numerateur = periodes.reduce((s, p) => s + BigInt(e.resteCentimes) * BigInt(p.centiemes) * BigInt(p.jours), 0n)
  const diviseur = 3_650_000n
  const penalitesCentimes = Number((2n * numerateur + diviseur) / (2n * diviseur))
  return {
    etat: 'calculees', regime, taux, periodes, jours: dernier - premier + 1, penalitesCentimes,
    indemniteCentimes: INDEMNITE_FORFAITAIRE_CENTIMES,
  }
}

// ── Les mots ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export function enMotsDuSemestre(semestre: string): string {
  return `du ${semestre.endsWith('S1') ? '1er' : '2d'} semestre ${semestre.slice(0, 4)}`
}

/** Un taux en centièmes de point, à la française : 1215 → « 12,15 % ». */
export function tauxEnMots(centiemes: number): string {
  return `${Math.trunc(centiemes / 100)},${String(centiemes % 100).padStart(2, '0')} %`
}

/** D'où vient le taux montré, en une phrase. */
export function origineDuTauxEnMots(regime: RegimeDesPenalites, taux: TauxDeLaFacture): string {
  if (regime === 'commande_publique') {
    return 'Intérêts moratoires d’un acheteur public : le taux de la BCE du semestre où le retard a commencé, majoré de '
      + '8 points (C. commande publique, art. R2192-31) ; le taux d’une facture ne le change pas.'
  }
  if (taux.origine === 'facture') return 'Le taux que la facture a figé dans ses conditions de paiement.'
  const loi = 'le taux de la BCE de chaque semestre, majoré de 10 points (C. com., art. L441-10, II)'
  switch (taux.motif) {
    case 'renvoi_a_la_loi': return `La facture renvoie au taux de la loi : ${loi}.`
    case 'aucun_texte': return `La facture ne fixe aucun taux : ${loi}.`
    case 'conditions_non_figees': return `La facture n’a pas figé ses conditions de paiement (validée avant le 29/10/2026) : ${loi}. Ses mentions peuvent stipuler un autre taux : à vérifier.`
    case 'texte_illisible': return `Le texte des pénalités de la facture ne se lit pas sans deviner : ${loi}, à vérifier contre ce texte.`
  }
}
