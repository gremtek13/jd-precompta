import { dateEnLettres, moisEnLettres } from './echeancierClient'
import { ajouterMois, formatDate, formatMoney } from './format'
import {
  calculerPlanTresorerieAu, dateDuDepart, partDuRythme, periodeDuRaccord, reserveSurSolde, soldeBanqueADate, type LigneBanquePourPlan,
  type OuvertureBanque,
} from './planTresorerie'

// LA PRÉVISION DE TRÉSORERIE PUBLIÉE AU CLIENT « BANQUE » (espace client, ligne 51.5, partie C, C8-Q2 ; la réponse du cabinet
// du 15/11/2026, « (C) Maintenant »). Le plan de trésorerie de l'onglet Financement (lib/planTresorerie.ts) se calcule des
// écritures du compte de banque, que le client ne lit jamais ; le cabinet le PUBLIE, d'un geste, et le client le lit dans
// « Ma trésorerie », sous le mot « prévision », à part de ce qui est connu. Ce module COMPOSE le contenu que
// `publier_prevision` fige (migration `previsions_publiees`, supabase/preparees/20261115100000, PRÉPARÉE), redit ses refus
// avant le clic, sous les mêmes mots, et dit ce que le client en lit. Pur : la lecture est dans
// lib/previsionsPublieesLecture.ts. Le patron : les situations publiées (lib/situationsPubliees.ts, C4a).
//
// SES RÈGLES, que la base revérifie (`refus_de_la_prevision`, `publier_prevision`) :
//   - le contenu porte des VALEURS, jamais un texte : le jour, un solde de départ et sa date, le rythme (ses mois, deux
//     moyennes), les mois projetés, et si les recettes en espèces de la caisse y entrent — aucun libellé d'écriture, aucun
//     nom de tiers, ni d'emprunt (un texte libre du cabinet), aucune échéance ;
//   - des CENTIMES entiers : les moyennes du plan, déjà au centime, et le solde de départ, puis chaque mois tiré du
//     précédent en entiers — un solde publié est la somme exacte de ce qui le précède ;
//   - le jour est celui de PARIS, où la base reçoit la prévision : le plan se recalcule à ce jour (`calculerPlanTresorerieAu`)
//     et la base refuse un contenu établi un autre jour ;
//   - le départ est le solde du compte de banque dans les écritures (celui de l'écran), à la date de sa dernière écriture
//     comptée (ou de l'ouverture) : jamais un solde inconnu (`reserveSurSolde`) ;
//   - le RACCORD (C8Q2-Q3, la réponse (B) du cabinet du 18/11/2026) : du lendemain du départ à la fin du mois où elle est
//     établie, le rythme moyen au prorata des jours de chaque mois (lib/planTresorerie.ts, `partDuRythme`) ; le premier
//     mois projeté part de sa fin ; nul quand le départ est au dernier jour de ce mois — rien n'est plus « non compté » ;
//   - une prévision qui ne repose sur aucun mouvement observé ne se publie pas.
//
// SES MOTS : ceux du cabinet (la confirmation) disent ce qui part, et que c'est une prévision ; ceux du client tutoient et ne
// nomment aucun onglet (`MOTS_DU_CABINET`, confronté par le test), et disent ce qui n'y est pas compté.

// ── Le drapeau ────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * LE DRAPEAU DE LA MIGRATION `previsions_publiees` (préparée le 15/11/2026, en production depuis le 18/11/2026, 241 : la fiche
 * « C8Q2-migration »). BAISSÉ : aucun écran ne change — ni « Publier au client » sous le plan de trésorerie, ni la
 * prévision dans « Ma trésorerie », ni la phrase de la case « Banque » —, et la table n'est pas au plan de sauvegarde (la
 * lire ferait échouer toute sauvegarde). Il se lève avec la migration, dans le même commit que son fichier passé à l'export.
 */
export const PREVISIONS_PUBLIEES_PREVUES = true

export const VERSION_DE_LA_PREVISION = 1
/** Les bornes du plan de l'onglet Financement (ses deux champs, de 1 à 24 mois), que la base redit. */
export const MOIS_AU_PLUS = 24

// ── Le contenu ────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface MoisDeLaPrevision {
  /** AAAA-MM. */
  mois: string
  solde_debut: number
  encaissements: number
  decaissements: number
  solde_fin: number
}

/** Le raccord (C8Q2-Q3) : du lendemain du départ (`du`) au dernier jour du mois de la publication (`au`), AAAA-MM-JJ. */
export interface RaccordDeLaPrevision {
  du: string
  au: string
  solde_debut: number
  encaissements: number
  decaissements: number
  solde_fin: number
}

/** Le contenu figé par `publier_prevision` (version 1) : ses clés sont celles que la base exige, ni plus ni moins. Centimes. */
export interface ContenuDeLaPrevision {
  version: typeof VERSION_DE_LA_PREVISION
  /** Le jour de Paris de la publication, AAAA-MM-JJ. */
  etablie_le: string
  /** Le solde du compte de banque dans les écritures, et la date de sa dernière écriture comptée (ou de l'ouverture). */
  depart: { au: string; solde: number }
  /** Les mois complets observés (AAAA-MM), leur nombre, ceux qui portent un mouvement, et les deux moyennes mensuelles. */
  rythme: { debut: string; fin: string; mois: number; mois_observes: number; encaissements: number; decaissements: number }
  /** Les jours du départ à la fin du mois de la publication, au prorata ; nul quand le départ est au dernier jour du mois. */
  raccord: RaccordDeLaPrevision | null
  mois: MoisDeLaPrevision[]
  /** Les recettes en espèces de la caisse entrent-elles dans le rythme. */
  avec_especes: boolean
}

/** La ligne de `previsions_publiees` telle que les écrans la lisent (lib/types.ts n'en a pas d'autre). */
export interface PrevisionPubliee {
  id: string
  dossier_id: string
  geste: 'publication' | 'retrait'
  contenu: unknown
  remplace_id: string | null
  publiee_le: string
}

// Les mots de la base (supabase/schema/20261118154124_previsions_publiees.sql), confrontés au texte par le test.
export const REFUS_PREVISION = {
  acces: 'Accès refusé à ce dossier.',
  forme: 'La prévision n\'est pas dans la forme que la base connaît (version 1).',
  jour: 'Une prévision se publie le jour où elle est établie : recalcule-la.',
  depart: 'Le départ de la prévision est mal formé : un solde en centimes entiers, à une date qui n\'est pas à venir.',
  rythme: 'Le rythme de la prévision est mal formé : de 1 à 24 mois complets, jusqu\'au mois qui précède celui où elle est '
    + 'établie, et des moyennes en centimes entiers, positives.',
  sansMouvement: 'La prévision ne repose sur aucun mouvement observé : elle ne se publie pas.',
  raccord: 'Le raccord de la prévision est mal formé : du lendemain de son départ à la fin du mois où elle est établie, parti '
    + 'du solde de départ, au rythme moyen compté au prorata des jours de chaque mois.',
  mois: 'Les mois de la prévision ne se suivent pas : de 1 à 24, du mois qui suit celui où elle est établie, chacun parti du '
    + 'solde du précédent, au rythme moyen.',
  dejaPubliee: 'Une prévision est déjà publiée pour ce dossier : remplace-la.',
  remplacee: 'La prévision remplacée n\'est pas celle publiée en cours pour ce dossier.',
  plusPubliee: 'Cette prévision n\'est plus publiée : elle a été remplacée ou retirée.',
  garde: 'Une prévision ne s\'écrit que par sa publication ou son retrait.',
} as const

// Les refus de ce module seul : ce que la base ne peut pas voir, puisqu'elle ne reçoit que des chiffres.
export const REFUS_DU_MODULE = {
  soldeInconnu: 'Le solde de départ n’est pas connu — aucune écriture de banque, ou une date avant l’ouverture du dossier : la '
    + 'prévision ne se publie pas.',
  montantIllisible: 'Un montant de la prévision n’est pas un nombre.',
  lecture: 'Les prévisions déjà publiées n’ont pas été lues en entier : rien ne se publie ni ne se retire avant leur relecture.',
  moisDifferents: 'Le plan affiché et la prévision à publier ne portent pas sur les mêmes mois (le jour n’est pas le même ici '
    + 'et à Paris) : recharge la page.',
} as const

/** Le refus d'une publication sur un plan qui ne repose pas sur des lectures entières (le motif de la lecture). */
export function refusDeLaLectureDuPlan(motif: string): string {
  return `Le plan ne repose pas sur des lectures entières (${motif}) : rien ne se publie avant leur relecture.`
}

export interface EntreeDeLaPrevision {
  /** Le jour de Paris (lib/format.ts, `aujourdHuiAParis`), celui que la base vérifie. */
  aujourdHui: string
  /** Toutes les écritures du compte de banque : le solde de départ et sa date. */
  lignesBanque: readonly LigneBanquePourPlan[]
  ouverture: OuvertureBanque | null
  /** Les écritures du rythme (sans les déblocages, les biens immobilisés, le bilan, le remboursement de TVA ; caisse comprise). */
  lignesDuRythme: readonly LigneBanquePourPlan[]
  nbMoisHistorique: number
  nbMoisProjection: number
  /** Les recettes en espèces de la caisse entrent dans le rythme (lignesDuRythme en porte). */
  avecEspeces: boolean
}

export type CompositionDeLaPrevision = { ok: true; contenu: ContenuDeLaPrevision } | { ok: false; refus: string }

const PLAFOND = 100_000_000_000_000

function centimes(euros: number): number | null {
  if (!Number.isFinite(euros)) return null
  // L'écart d'un flottant (0,1 + 0,2) se corrige avant l'arrondi ; le demi-centime s'éloigne de zéro dans les deux sens.
  const exact = Number((euros * 100).toFixed(6))
  return Math.sign(exact) * Math.round(Math.abs(exact))
}

const entierDansLesBornes = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max

/** Le premier jour du mois d'une date, AAAA-MM-01. */
function premierJourDuMois(date: string): string {
  return `${date.slice(0, 7)}-01`
}

/** Compose le contenu d'une prévision à publier, ou dit pourquoi elle ne se publie pas — avant le clic. */
export function composerLaPrevision(e: EntreeDeLaPrevision): CompositionDeLaPrevision {
  if (!entierDansLesBornes(e.nbMoisHistorique, 1, MOIS_AU_PLUS)) return { ok: false, refus: REFUS_PREVISION.rythme }
  if (!entierDansLesBornes(e.nbMoisProjection, 1, MOIS_AU_PLUS)) return { ok: false, refus: REFUS_PREVISION.mois }
  if (reserveSurSolde(e.lignesBanque, e.ouverture, e.aujourdHui) !== null) return { ok: false, refus: REFUS_DU_MODULE.soldeInconnu }
  const au = dateDuDepart(e.lignesBanque, e.ouverture, e.aujourdHui)
  if (au === null) return { ok: false, refus: REFUS_DU_MODULE.soldeInconnu }
  const solde = centimes(soldeBanqueADate(e.lignesBanque, e.ouverture, e.aujourdHui))
  const premier = premierJourDuMois(e.aujourdHui)
  // Le plan ne sert ici qu'à ses moyennes et à ce qu'elles observent : le raccord et les mois se composent en centimes.
  const plan = calculerPlanTresorerieAu(e.lignesDuRythme, 0, e.nbMoisHistorique, e.nbMoisProjection, premier, null)
  const encaissements = centimes(plan.moyenneEncaissements)
  const decaissements = centimes(plan.moyenneDecaissements)
  if (solde === null || encaissements === null || decaissements === null || encaissements < 0 || decaissements < 0
      || Math.abs(solde) >= PLAFOND || encaissements >= PLAFOND || decaissements >= PLAFOND) {
    return { ok: false, refus: REFUS_DU_MODULE.montantIllisible }
  }
  if (plan.nbLignesObservees === 0 || plan.nbMoisAvecDonnees === 0) return { ok: false, refus: REFUS_PREVISION.sansMouvement }
  // Le raccord : du lendemain du départ à la fin du mois, au prorata des jours ; le premier mois part de sa fin.
  let courant = solde
  let raccord: RaccordDeLaPrevision | null = null
  const periode = periodeDuRaccord(au, premier)
  if (periode !== null) {
    const entrees = partDuRythme(encaissements, periode.du, periode.au)
    const sorties = partDuRythme(decaissements, periode.du, periode.au)
    const fin = solde + entrees - sorties
    if (!(entrees < PLAFOND && sorties < PLAFOND && Math.abs(fin) < PLAFOND)) return { ok: false, refus: REFUS_PREVISION.raccord }
    raccord = { du: periode.du, au: periode.au, solde_debut: solde, encaissements: entrees, decaissements: sorties, solde_fin: fin }
    courant = fin
  }
  const mois: MoisDeLaPrevision[] = []
  for (let i = 1; i <= e.nbMoisProjection; i++) {
    const fin = courant + encaissements - decaissements
    if (Math.abs(fin) >= PLAFOND) return { ok: false, refus: REFUS_PREVISION.mois }
    mois.push({ mois: ajouterMois(premier, i).slice(0, 7), solde_debut: courant, encaissements, decaissements, solde_fin: fin })
    courant = fin
  }
  return {
    ok: true,
    contenu: {
      version: VERSION_DE_LA_PREVISION,
      etablie_le: e.aujourdHui,
      depart: { au, solde },
      rythme: {
        debut: ajouterMois(premier, -e.nbMoisHistorique).slice(0, 7),
        fin: ajouterMois(premier, -1).slice(0, 7),
        mois: e.nbMoisHistorique,
        mois_observes: plan.nbMoisAvecDonnees,
        encaissements,
        decaissements,
      },
      raccord,
      mois,
      avec_especes: e.avecEspeces,
    },
  }
}

/** Les mois que le plan affiché projette (AAAA-MM) sont-ils ceux de la prévision : le jour local et celui de Paris d'accord. */
export function memesMois(contenu: ContenuDeLaPrevision, moisAffiches: readonly string[]): boolean {
  return contenu.mois.length === moisAffiches.length && contenu.mois.every((m, i) => m.mois === moisAffiches[i])
}

// ── Les prévisions en cours ───────────────────────────────────────────────────────────────────────────────────────────
/** Les prévisions EN COURS : les publications qu'aucune ligne ne remplace ni ne retire (`prevision_publiee_en_cours`). */
export function previsionsEnCours(lignes: readonly PrevisionPubliee[]): PrevisionPubliee[] {
  const citees = new Set(lignes.map((l) => l.remplace_id).filter((id): id is string => id !== null))
  return lignes.filter((l) => l.geste === 'publication' && !citees.has(l.id))
}

/** La prévision en cours la plus récente (à égalité, le dernier identifiant), ou nulle. */
export function previsionEnCours(lignes: readonly PrevisionPubliee[]): PrevisionPubliee | null {
  const enCours = previsionsEnCours(lignes).sort((a, b) => {
    if (a.publiee_le !== b.publiee_le) return a.publiee_le < b.publiee_le ? 1 : -1
    return a.id < b.id ? 1 : -1
  })
  return enCours[0] ?? null
}

// ── Le contenu tel qu'il se relit ─────────────────────────────────────────────────────────────────────────────────────
// La base l'a vérifié en le figeant ; l'écran le relit quand même, à sa forme : un contenu qui ne se lit pas se dit
// « illisible », jamais un chiffre arrondi ou deviné (le patron des situations publiées).
const entier = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const MOIS = /^(\d{4})-(\d{2})$/

function dateValide(texte: unknown): texte is string {
  if (typeof texte !== 'string') return false
  const m = DATE.exec(texte)
  if (!m) return false
  const [a, mo, j] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const d = new Date(Date.UTC(a, mo - 1, j))
  return d.getUTCFullYear() === a && d.getUTCMonth() === mo - 1 && d.getUTCDate() === j && a >= 2000 && a <= 2100
}

function clesExactes(o: Record<string, unknown>, cles: readonly string[]): boolean {
  const presentes = Object.keys(o).sort()
  return presentes.length === cles.length && [...cles].sort().every((c, i) => presentes[i] === c)
}

const objet = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Le contenu d'une prévision lue, ou null s'il ne se lit pas : sa forme, et une suite qui s'enchaîne, raccord compris. */
export function contenuLu(v: unknown): ContenuDeLaPrevision | null {
  if (!objet(v) || !clesExactes(v, ['version', 'etablie_le', 'depart', 'rythme', 'raccord', 'mois', 'avec_especes'])) return null
  if (v.version !== VERSION_DE_LA_PREVISION || typeof v.avec_especes !== 'boolean' || !dateValide(v.etablie_le)) return null
  const depart = v.depart
  if (!objet(depart) || !clesExactes(depart, ['au', 'solde']) || !dateValide(depart.au) || !entier(depart.solde)) return null
  if (depart.au > v.etablie_le) return null
  const r = v.rythme
  if (!objet(r) || !clesExactes(r, ['debut', 'fin', 'mois', 'mois_observes', 'encaissements', 'decaissements'])) return null
  if (typeof r.debut !== 'string' || !MOIS.test(r.debut) || typeof r.fin !== 'string' || !MOIS.test(r.fin)) return null
  if (!entier(r.mois) || r.mois < 1 || r.mois > MOIS_AU_PLUS || !entier(r.mois_observes) || r.mois_observes < 1
      || r.mois_observes > r.mois || !entier(r.encaissements) || r.encaissements < 0 || !entier(r.decaissements)
      || r.decaissements < 0) return null
  const premier = premierJourDuMois(v.etablie_le)
  if (r.fin !== ajouterMois(premier, -1).slice(0, 7) || r.debut !== ajouterMois(premier, -r.mois).slice(0, 7)) return null
  // Le raccord : présent si et seulement si des jours séparent le départ de la fin du mois, et chacune de ses valeurs
  // recalculée comme la base la recalcule.
  let solde = depart.solde
  let raccord: RaccordDeLaPrevision | null = null
  const periode = periodeDuRaccord(depart.au, premier)
  if (periode === null) {
    if (v.raccord !== null) return null
  } else {
    const rc = v.raccord
    if (!objet(rc) || !clesExactes(rc, ['du', 'au', 'solde_debut', 'encaissements', 'decaissements', 'solde_fin'])) return null
    const entrees = partDuRythme(r.encaissements, periode.du, periode.au)
    const sorties = partDuRythme(r.decaissements, periode.du, periode.au)
    if (rc.du !== periode.du || rc.au !== periode.au || rc.solde_debut !== solde || rc.encaissements !== entrees
        || rc.decaissements !== sorties || !entier(rc.solde_fin) || rc.solde_fin !== solde + entrees - sorties) return null
    raccord = { du: periode.du, au: periode.au, solde_debut: solde, encaissements: entrees, decaissements: sorties, solde_fin: rc.solde_fin }
    solde = rc.solde_fin
  }
  if (!Array.isArray(v.mois) || v.mois.length < 1 || v.mois.length > MOIS_AU_PLUS) return null
  const mois: MoisDeLaPrevision[] = []
  for (const [i, m] of (v.mois as unknown[]).entries()) {
    if (!objet(m) || !clesExactes(m, ['mois', 'solde_debut', 'encaissements', 'decaissements', 'solde_fin'])) return null
    if (m.mois !== ajouterMois(premier, i + 1).slice(0, 7) || m.solde_debut !== solde || m.encaissements !== r.encaissements
        || m.decaissements !== r.decaissements || !entier(m.solde_fin) || m.solde_fin !== solde + r.encaissements - r.decaissements) return null
    mois.push({ mois: m.mois, solde_debut: solde, encaissements: r.encaissements, decaissements: r.decaissements, solde_fin: m.solde_fin })
    solde = m.solde_fin
  }
  return {
    version: VERSION_DE_LA_PREVISION,
    etablie_le: v.etablie_le,
    depart: { au: depart.au, solde: depart.solde },
    rythme: { debut: r.debut, fin: r.fin, mois: r.mois, mois_observes: r.mois_observes, encaissements: r.encaissements, decaissements: r.decaissements },
    raccord,
    mois,
    avec_especes: v.avec_especes,
  }
}

/**
 * Le mois le plus bas de la prévision (le premier à égalité), son solde à la fin — le raccord compris, sous le mois où il
 * finit : son solde de fin est celui du dernier jour du mois de la publication.
 */
export function moisLePlusBas(contenu: Pick<ContenuDeLaPrevision, 'raccord' | 'mois'>): MoisDeLaPrevision {
  const r = contenu.raccord
  const candidats: MoisDeLaPrevision[] = r === null ? contenu.mois : [{
    mois: r.au.slice(0, 7), solde_debut: r.solde_debut, encaissements: r.encaissements, decaissements: r.decaissements, solde_fin: r.solde_fin,
  }, ...contenu.mois]
  return candidats.reduce((bas, m) => (m.solde_fin < bas.solde_fin ? m : bas), candidats[0])
}

// ── Côté cabinet : la confirmation ────────────────────────────────────────────────────────────────────────────────────
export interface Confirmation {
  titre: string
  paragraphes: readonly string[]
  bouton: string
}

export const montantDit = (c: number) => formatMoney(c / 100)

/** Ce que l'écran du cabinet dit de la publication, sous le plan, avant tout geste. */
export const CE_QUE_LE_CLIENT_LIT = 'Le client qui porte la case « Banque » lit, dans « Ma trésorerie », la dernière prévision '
  + 'que tu publies : figée au jour de sa publication, sous le mot « prévision », à part de ce qui est connu — jamais ajoutée '
  + 'à son solde attendu ni à son point bas. Il n’y lit ni les échéances listées ici, ni le nom d’un emprunt.'

/** La confirmation d'une publication : elle NOMME ce qui part au client, et dit que c'est une prévision. */
export function confirmationDeLaPublication(contenu: ContenuDeLaPrevision, remplacee: Pick<PrevisionPubliee, 'publiee_le'> | null): Confirmation {
  const r = contenu.rythme
  const dernier = contenu.mois[contenu.mois.length - 1]
  const raccord = contenu.raccord
  return {
    titre: remplacee ? 'Remplacer la prévision publiée au client ?' : 'Publier cette prévision au client ?',
    paragraphes: [
      `La prévision établie aujourd’hui, le ${formatDate(contenu.etablie_le)}, part au client qui porte la case « Banque » : `
        + `du solde de la banque dans les comptes au ${formatDate(contenu.depart.au)} (${montantDit(contenu.depart.solde)}), au `
        + `rythme moyen de ${moisEnLettres(r.debut)} à ${moisEnLettres(r.fin)} (${r.mois} mois, des mouvements sur `
        + `${r.mois_observes}) — ${montantDit(r.encaissements)} encaissés et ${montantDit(r.decaissements)} payés par mois —, `
        + `sur ${contenu.mois.length} mois, de ${moisEnLettres(contenu.mois[0].mois)} à ${moisEnLettres(dernier.mois)} : `
        + `solde à la fin, ${montantDit(dernier.solde_fin)}.`,
      ...(raccord
        ? [`Le raccord, du ${formatDate(raccord.du)} au ${formatDate(raccord.au)} — de la dernière écriture de banque à la fin du `
          + `mois —, compte ce rythme au prorata des jours : ${montantDit(raccord.encaissements)} encaissés et `
          + `${montantDit(raccord.decaissements)} payés, solde au ${formatDate(raccord.au)}, ${montantDit(raccord.solde_fin)} ; `
          + `${moisEnLettres(contenu.mois[0].mois)} part de ce solde.`]
        : []),
      ...(contenu.avec_especes
        ? ['Les recettes en espèces de la caisse entrent dans ce rythme : le client les y lit, même sans la case « Caisse ».'] : []),
      'C’est une prévision, pas un engagement : il la lit sous ce mot, à part de son solde contrôlé et des montants connus, '
        + 'jamais ajoutée à son point bas. Ni les échéances listées ici, ni le nom d’un emprunt ne partent.',
      remplacee
        ? `Elle remplace celle publiée le ${formatDate(remplacee.publiee_le)}, que le client ne lira plus ; l’historique reste.`
        : 'Elle se fige : pour la changer, tu la remplaces ou la retires ; l’historique reste.',
    ],
    bouton: remplacee ? 'Remplacer' : 'Publier',
  }
}

/** La confirmation d'un retrait : elle nomme la prévision qui part. */
export function confirmationDuRetrait(prevision: Pick<PrevisionPubliee, 'publiee_le'>): Confirmation {
  return {
    titre: 'Retirer la prévision publiée ?',
    paragraphes: [
      `La prévision publiée le ${formatDate(prevision.publiee_le)} ne se lira plus dans l’espace du client ; l’historique reste, `
        + 'et une nouvelle prévision se publie ensuite.',
    ],
    bouton: 'Retirer',
  }
}

// ── Côté client : ce que « Ma trésorerie » en dit ──────────────────────────────────────────────────────────────────────
export type PrevisionAMontrer =
  | { etat: 'aucune' }
  | { etat: 'illisible' }
  /** Tous ses mois sont passés : elle ne dit plus rien de ce qui vient. */
  | { etat: 'passee'; etablieLe: string }
  | { etat: 'montree'; contenu: ContenuDeLaPrevision; moisPasses: number }

/**
 * La prévision que la page montre : la dernière en cours, relue à sa forme, et ce qui en est déjà passé au jour de Paris —
 * le raccord compté parmi les mois passés une fois son mois fini.
 */
export function previsionAMontrer(lignes: readonly PrevisionPubliee[], aujourdHui: string): PrevisionAMontrer {
  const enCours = previsionEnCours(lignes)
  if (enCours === null) return { etat: 'aucune' }
  const contenu = contenuLu(enCours.contenu)
  if (contenu === null) return { etat: 'illisible' }
  const moisDuJour = aujourdHui.slice(0, 7)
  const moisPasses = contenu.mois.filter((m) => m.mois < moisDuJour).length
  if (moisPasses === contenu.mois.length) return { etat: 'passee', etablieLe: contenu.etablie_le }
  const raccordPasse = contenu.raccord !== null && contenu.raccord.au.slice(0, 7) < moisDuJour
  return { etat: 'montree', contenu, moisPasses: moisPasses + (raccordPasse ? 1 : 0) }
}

// Les mots du client, écrits ici pour que le test les passe tous à `motsDuCabinet`.
export const PREVISION_TITRE = 'La prévision de ton cabinet'
export const PREVISION_MOT = 'prévision'
export const PREVISION_PAS_UN_ENGAGEMENT = 'Une prévision, pas un engagement de ton cabinet : elle dit ce que deviendrait ton '
  + 'compte si le rythme des derniers mois se maintenait. Elle n’entre pas dans le calcul au-dessus, qui ne compte que des '
  + 'montants connus, ni dans son point le plus bas.'
export const PREVISION_AUCUNE = 'Ton cabinet ne t’a pas publié de prévision.'
export const PREVISION_ILLISIBLE = 'La prévision de ton cabinet n’a pas pu être lue : recharge la page.'
export const PREVISION_CONTENU_ILLISIBLE = 'La prévision de ton cabinet ne se lit pas : demande-lui de la publier de nouveau.'
export const PREVISION_SANS_BANQUE = 'Ton accès n’ouvre pas ta banque : la prévision de ton cabinet ne s’affiche pas.'
export const PREVISION_ESPECES = 'Tes recettes en espèces entrent dans ce rythme.'
export const NON_COMPTE_PREVISION_A_PART = 'La prévision de ton cabinet : elle n’entre jamais dans ce calcul ; s’il t’en a '
  + 'publié une, elle se lit à part, plus bas.'

export function phraseDeLaPublication(etablieLe: string): string {
  return `Publiée par ton cabinet le ${dateEnLettres({ date: etablieLe, auMois: false })}.`
}
export function phraseDuDepart(depart: ContenuDeLaPrevision['depart']): string {
  return `Elle part du solde de ton compte tel que ton cabinet l’a comptabilisé au ${dateEnLettres({ date: depart.au, auMois: false })}, `
    + `date de sa dernière écriture de banque : ${montantDit(depart.solde)}. Ce solde peut différer de celui de ton relevé.`
}
export function phraseDuRythme(r: ContenuDeLaPrevision['rythme']): string {
  return `Au rythme moyen de ${moisEnLettres(r.debut)} à ${moisEnLettres(r.fin)} (${r.mois} mois complets) : `
    + `${montantDit(r.encaissements)} encaissés et ${montantDit(r.decaissements)} payés par mois.`
    + (r.mois_observes < r.mois
      ? ` Des mouvements n’ont été vus que sur ${r.mois_observes} de ces ${r.mois} mois : les autres comptent pour zéro dans la moyenne.`
      : '')
}
/** La période du raccord, aux mots du client : la première ligne du tableau. */
export function periodeDuRaccordEnLettres(raccord: Pick<RaccordDeLaPrevision, 'du' | 'au'>): string {
  return `Du ${dateEnLettres({ date: raccord.du, auMois: false })} au ${dateEnLettres({ date: raccord.au, auMois: false })}`
}
export function phraseDuRaccord(raccord: RaccordDeLaPrevision): string {
  return `${periodeDuRaccordEnLettres(raccord)}, après cette dernière écriture, elle compte ce rythme au prorata des jours : `
    + `${montantDit(raccord.encaissements)} encaissés et ${montantDit(raccord.decaissements)} payés.`
}
export function phraseDuMoisLePlusBas(m: MoisDeLaPrevision): string {
  return m.solde_fin < 0
    ? `Elle passerait sous zéro : ${montantDit(m.solde_fin)} à la fin de ${moisEnLettres(m.mois)}. Parles-en à ton cabinet.`
    : `Le mois le plus bas de cette prévision : ${moisEnLettres(m.mois)}, ${montantDit(m.solde_fin)} à la fin du mois.`
}
export function phraseDesMoisPasses(etablieLe: string): string {
  return `Ses premiers mois sont passés : elle date du ${dateEnLettres({ date: etablieLe, auMois: false })}. Ton cabinet peut `
    + 't’en publier une plus récente.'
}
export function phraseDUnePrevisionPassee(etablieLe: string): string {
  return `La dernière prévision de ton cabinet, publiée le ${dateEnLettres({ date: etablieLe, auMois: false })}, ne porte plus `
    + 'que sur des mois passés.'
}

/**
 * Ce que « Ma trésorerie » dit, parmi ce qui n'est pas compté, du prévisionnel du cabinet : drapeau levé, qu'il n'entre
 * jamais dans le calcul et se lit à part — la phrase d'hier sinon. Vrai quel que soit ce que la lecture de la prévision
 * rendra : la ligne s'affiche avant elle.
 */
export function nonComptesSelonLaPrevision<T extends { cle: string; phrase: string }>(lignes: readonly T[], prevues: boolean): T[] {
  return lignes.map((l) => (prevues && l.cle === 'previsionnel-du-cabinet' ? { ...l, phrase: NON_COMPTE_PREVISION_A_PART } : l))
}
