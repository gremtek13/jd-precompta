import type { DeclarationCa3 } from './declarationTva'
import type { SituationIntermediaire } from './situationIntermediaire'

// LES SITUATIONS PUBLIÉES (espace client, ligne 51.5, partie C, étape C4a ; MEG3-Q2, « la publication »). Le cabinet PUBLIE
// au client une situation datée — recettes, dépenses par poste de la 2035, résultat, TVA due, comparaison à N−1 —, figée,
// « provisoire » ou « validée » ; le client la lit sous sa case « Comptes ». Ce module COMPOSE le contenu que
// `publier_situation` fige (migration `situations_publiees`, supabase/preparees/20261106150000, PRÉPARÉE, pas appliquée),
// depuis les moteurs qui existent : la 2035 « à ce jour » (`calculerSituationIntermediaire`, lib/situationIntermediaire.ts)
// et la CA3 (`calculerCa3`, lib/declarationTva.ts), sur la même période. Pur : la lecture viendra avec les écrans (C4b).
//
// SES RÈGLES, que la base revérifie (`refus_des_chiffres_de_la_situation`, `publier_situation`), sous les mêmes mots :
//   - des CENTIMES entiers : chaque poste arrondi au centime, puis les totaux tirés des postes arrondis — un total publié
//     est la somme exacte de ses postes, jamais un flottant ;
//   - le statut se LIT de l'exercice (`exercices_valides`, lue EN ENTIER par l'appelant) : « validee » s'il est validé,
//     « provisoire » sinon ; rien ne se devine, et la base refuse un statut qui ne serait plus le sien ;
//   - la période va du 1er janvier à la date d'arrêté, passée ou du jour (au jour de Paris) ;
//   - la comparaison à N−1 est le MÊME calcul sur la même période de N−1 (le 29 février devient le 28) — jamais la 2035
//     déposée ni l'instantané validé relus, comme la colonne N−1 du bilan ; absente, elle se dit `null` ;
//   - ce que les moteurs n'ont pas su compter sans deviner (une vente facturée écartée, des frais ou une recette de caisse
//     sans poste, une pièce ou une recette dont la TVA est écartée) retient la publication : un chiffre montré au client
//     ne tait pas un trou.

// LE DRAPEAU : baissé tant que la migration n'est pas dans l'export (situationsPubliees.test.ts le lie au fichier). Le jour
// de son application, il se lève : la table entre au plan de sauvegarde (lib/sauvegarde.ts, `auPlanAujourdHui`).
export const SITUATIONS_PUBLIEES_EXPORTEES = false

export const VERSION_DU_CONTENU = 1

export type StatutDeLaSituation = 'provisoire' | 'validee'

/** Un poste de la 2035, signé : une recette positive, une dépense négative ; des centimes. */
export interface PosteDeLaSituation {
  poste: string
  montant: number
}

/** La TVA de la période : nette (collectée moins déductible ; négative, un crédit) pour un assujetti ; rien sinon. */
export type TvaDeLaSituation = { assujetti: false } | { assujetti: true; nette: number }

export interface ChiffresDeLaSituation {
  periode: { debut: string; fin: string }
  postes: PosteDeLaSituation[]
  recettes: number
  depenses: number
  resultat: number
  tva: TvaDeLaSituation
}

/** Le contenu figé par `publier_situation` (version 1) : ses clés sont celles que la base exige, ni plus ni moins. */
export interface ContenuDeLaSituation extends ChiffresDeLaSituation {
  version: typeof VERSION_DU_CONTENU
  statut: StatutDeLaSituation
  n_moins_1: ChiffresDeLaSituation | null
}

/** La ligne de `situations_publiees` (lib/types.ts n'en a pas d'autre). */
export interface SituationPubliee {
  id: string
  dossier_id: string
  annee: number
  geste: 'publication' | 'retrait'
  arretee_au: string
  statut: StatutDeLaSituation | null
  contenu: ContenuDeLaSituation | null
  remplace_id: string | null
  auteur: string
  publiee_le: string
}

/** Ce que la CA3 de la période apporte : sa période, sa TVA nette (en euros, ses lignes arrondies), et ce qu'elle écarte. */
export type Ca3DeLaSituation = Pick<DeclarationCa3, 'periode' | 'netPeriode' | 'ecartees' | 'releveEcartees'
  | 'exigibilitesEcartees' | 'caisseEcartees' | 'ventesFactureesEcartees'>

/** La TVA d'un exercice : celle d'un dossier qui n'est pas assujetti, ou la CA3 de la période. */
export type TvaEntree = { assujetti: false } | { assujetti: true; ca3: Ca3DeLaSituation }

export type SituationDuMoteur = Pick<SituationIntermediaire, 'periodeDebut' | 'periodeFin' | 'totauxParPoste'
  | 'ventesFactureesEcartees' | 'fraisSansPoste' | 'recettesDeCaisseSansPoste'>

export interface EntreeDeLaSituation {
  /** La date d'arrêté, AAAA-MM-JJ. */
  arreteeAu: string
  /** Le jour de Paris (lib/format.ts) : une date d'arrêté à venir se refuse. */
  aujourdHui: string
  /** Les exercices validés du dossier, lus en entier : le statut s'en lit. */
  anneesValidees: readonly number[]
  situation: SituationDuMoteur
  tva: TvaEntree
  /** Le même calcul sur la même période de N−1, ou null quand le cabinet n'en publie pas. Sans valeur par défaut. */
  nMoins1: { situation: SituationDuMoteur; tva: TvaEntree } | null
}

export type CompositionDeLaSituation = { ok: true; contenu: ContenuDeLaSituation } | { ok: false; refus: string }

// Les mots de la base (supabase/preparees/20261106150000_situations_publiees.sql), confrontés au texte par le test.
export const REFUS_SITUATION = {
  dateAbsente: 'Une situation porte la date à laquelle elle est arrêtée.',
  dateAVenir: 'Une situation ne s\'arrête pas à une date à venir.',
  periode: 'La période des chiffres ne va pas du 1er janvier à la date d\'arrêté.',
  poste: 'Un poste de la situation est mal formé : un nom, une fois, et un montant en centimes entiers.',
  comparaison: 'La comparaison à l\'exercice précédent : ',
  dejaPubliee: 'Une situation est déjà publiée à cette date : remplace-la.',
  plusPubliee: 'Cette situation n\'est plus publiée : elle a été remplacée ou retirée.',
} as const

// Les refus de ce module seul : ce que la base ne peut pas voir, puisqu'elle ne reçoit que des chiffres.
export const REFUS_DU_MODULE = {
  nonCompte: 'La situation a des montants que la 2035 ou la CA3 ne savent pas compter sans deviner : ils se règlent avant de la publier.',
  periodeDeLaTva: 'La TVA de la situation ne se calcule pas sur la même période que ses chiffres.',
  montantIllisible: 'Un montant de la situation n\'est pas un nombre.',
} as const

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function dateValide(texte: string): boolean {
  const m = DATE.exec(texte)
  if (!m) return false
  const [a, mo, j] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const d = new Date(Date.UTC(a, mo - 1, j))
  return d.getUTCFullYear() === a && d.getUTCMonth() === mo - 1 && d.getUTCDate() === j && a >= 2000 && a <= 2100
}

/** La même date un an plus tôt — le 29 février devient le 28, comme `date - interval '1 year'` en base. */
export function memeDateAnneePrecedente(date: string): string {
  const [a, m, j] = date.split('-').map(Number)
  const jour = m === 2 && j === 29 ? 28 : j
  return `${String(a - 1).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(jour).padStart(2, '0')}`
}

function centimes(euros: number): number | null {
  if (!Number.isFinite(euros)) return null
  // L'écart d'un flottant (0,1 + 0,2) se corrige avant l'arrondi : 12,345 € s'écrit 1234,5 centimes en vrai. Le demi-centime
  // s'éloigne de zéro dans les deux sens (`Math.round` arrondirait −1,5 à −1) : une dépense s'arrondit comme une recette.
  const exact = Number((euros * 100).toFixed(6))
  return Math.sign(exact) * Math.round(Math.abs(exact))
}

function chiffres(situation: SituationDuMoteur, tva: TvaEntree, debut: string, fin: string): ChiffresDeLaSituation | string {
  if (situation.periodeDebut !== debut || situation.periodeFin !== fin) return REFUS_SITUATION.periode
  if (situation.ventesFactureesEcartees.length > 0 || situation.fraisSansPoste.length > 0
      || situation.recettesDeCaisseSansPoste.length > 0) return REFUS_DU_MODULE.nonCompte
  const postes: PosteDeLaSituation[] = []
  for (const [poste, euros] of situation.totauxParPoste) {
    const montant = centimes(euros)
    if (montant === null) return REFUS_DU_MODULE.montantIllisible
    if (poste.trim() === '' || poste.length > 200 || postes.some((p) => p.poste === poste)) return REFUS_SITUATION.poste
    postes.push({ poste, montant })
  }
  const recettes = postes.filter((p) => p.montant > 0).reduce((s, p) => s + p.montant, 0)
  const depenses = postes.filter((p) => p.montant < 0).reduce((s, p) => s - p.montant, 0)
  let tvaDeLaSituation: TvaDeLaSituation = { assujetti: false }
  if (tva.assujetti) {
    const ca3 = tva.ca3
    if (ca3.periode.debut !== debut || ca3.periode.fin !== fin) return REFUS_DU_MODULE.periodeDeLaTva
    if (ca3.ecartees.length > 0 || ca3.releveEcartees.length > 0 || ca3.exigibilitesEcartees.length > 0
        || ca3.caisseEcartees.length > 0 || ca3.ventesFactureesEcartees.length > 0) return REFUS_DU_MODULE.nonCompte
    const nette = centimes(ca3.netPeriode)
    if (nette === null) return REFUS_DU_MODULE.montantIllisible
    tvaDeLaSituation = { assujetti: true, nette }
  }
  return { periode: { debut, fin }, postes, recettes, depenses, resultat: recettes - depenses, tva: tvaDeLaSituation }
}

/** Compose le contenu d'une situation à publier, ou dit pourquoi il ne se publie pas — avant le clic. */
export function composerLaSituation(e: EntreeDeLaSituation): CompositionDeLaSituation {
  if (!dateValide(e.arreteeAu)) return { ok: false, refus: REFUS_SITUATION.dateAbsente }
  if (e.arreteeAu > e.aujourdHui) return { ok: false, refus: REFUS_SITUATION.dateAVenir }
  const annee = Number(e.arreteeAu.slice(0, 4))
  const n = chiffres(e.situation, e.tva, `${annee}-01-01`, e.arreteeAu)
  if (typeof n === 'string') return { ok: false, refus: n }
  let nMoins1: ChiffresDeLaSituation | null = null
  if (e.nMoins1) {
    const avant = chiffres(e.nMoins1.situation, e.nMoins1.tva, `${annee - 1}-01-01`, memeDateAnneePrecedente(e.arreteeAu))
    if (typeof avant === 'string') return { ok: false, refus: REFUS_SITUATION.comparaison + avant }
    nMoins1 = avant
  }
  return {
    ok: true,
    contenu: {
      version: VERSION_DU_CONTENU,
      statut: e.anneesValidees.includes(annee) ? 'validee' : 'provisoire',
      ...n,
      n_moins_1: nMoins1,
    },
  }
}

/** Les situations EN COURS : les publications qu'aucune ligne ne remplace ni ne retire (`situation_publiee_en_cours`). */
export function situationsEnCours(lignes: readonly SituationPubliee[]): SituationPubliee[] {
  const citees = new Set(lignes.map((l) => l.remplace_id).filter((id): id is string => id !== null))
  return lignes.filter((l) => l.geste === 'publication' && !citees.has(l.id))
}
