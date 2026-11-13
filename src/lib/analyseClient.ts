import { libelleDuMois, type SoldeLu } from './banqueClient'
import { resteAEncaisser } from './encaissementsFactures'
import { calculerLigne, dejaCredite } from './montantsFacture'
import { champCsv } from './pisteAudit'
import { retardDeLaFacture } from './relances'
import type { ListesDesVentes } from './tuilesVentes'
import type { ControleReleveBancaire, FactureEmise, FactureLigne } from './types'

// « MON ANALYSE » (espace client, étape B9a ; conception : HISTORIQUE.md, « L'ESPACE CLIENT, LOGICIEL DE GESTION DU CLIENT :
// LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », § B.3) : les indicateurs et les états de synthèse du client, SANS migration.
// L'analyse n'a pas de case à elle : elle montre ce que les cases « Ventes » et « Banque » de l'accès ouvrent déjà, et rien
// d'autre (les achats attendent les étapes B4 et B5 ; le journal des évènements, l'étape B9b).
//
// CHAQUE CHIFFRE VIENT D'UNE LISTE LUE EN ENTIER, ET DIT SA SOURCE. Lue en partie, refusée ou rompue, l'indicateur est MUET,
// avec son motif : jamais « 0 », jamais « aucun » — une facture absente ferait un chiffre d'affaires faux sans un mot.
//
// RIEN N'EST JUGÉ À NOUVEAU. Le reste à encaisser d'une facture est celui de `resteAEncaisser` (le registre des
// encaissements, NET des retirés et des annulations), moins ce que ses avoirs ont crédité (`dejaCredite`) — le calcul même
// de l'onglet Factures pour le retard d'une facture ; le retard, `retardDeLaFacture` (lib/relances.ts) ; le HT d'une ligne,
// `calculerLigne` ; le solde, `soldeAuReleve` (lib/banqueClient.ts), lu au dernier relevé contrôlé, jamais une somme de
// mouvements.
//
// Pur : aucun accès à la base (la lecture est dans analyseClientLecture.ts). Les mots tutoient et ne nomment aucun onglet
// (`MOTS_DU_CABINET`, lib/espaceVentes.ts, confronté par analyseClient.test.ts).

// ── Qui voit « Mon analyse » ───────────────────────────────────────────────────────────────────────────────────────────
/**
 * « Mon analyse » s'offre-t-elle (sa route, App.tsx ; son entrée, Layout.tsx) ? Quand « Mes ventes » OU « Ma banque »
 * s'offre sur la société affichée — chacune sous la garde de sa propre route (`mesVentesOuvertes`, `maBanqueOuverte`).
 */
export function monAnalyseOuverte(mesVentes: boolean, maBanque: boolean): boolean {
  return mesVentes || maBanque
}

// ── Ce que la page lit ─────────────────────────────────────────────────────────────────────────────────────────────────
/** La provenance d'une ligne de facture (étape A7a) : l'article qui l'a pré-remplie, ou l'acompte qu'elle reprend. */
export type LigneDeProvenance = Pick<FactureLigne,
  'id' | 'facture_id' | 'ordre' | 'designation' | 'quantite' | 'prix_unitaire_ht' | 'reprise_facture_id'>
  & { article_id: string | null; reference: string | null }

export const COLONNES_DE_LA_PROVENANCE =
  'id, facture_id, ordre, designation, quantite, prix_unitaire_ht, article_id, reference, reprise_facture_id, factures_emises!inner(dossier_id)'

export type ControleDuSolde = Pick<ControleReleveBancaire, 'id' | 'solde_final' | 'coherent' | 'periode_fin' | 'created_at'>
export const COLONNES_DU_CONTROLE = 'id, solde_final, coherent, periode_fin, created_at'

// ── Les mots ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export const ANALYSE_INTRODUCTION = 'Les chiffres de ton activité, tirés de ce que tu fais dans l’application. Chaque chiffre '
  + 'dit d’où il vient ; s’il manque une partie de ce qu’il compte, il ne s’affiche pas.'
export const SOURCE_CHIFFRE_D_AFFAIRES = 'Facturé dans l’application : tes factures validées, avoirs déduits, hors taxes, à '
  + 'leur date d’émission. Ce n’est pas la recette que ton cabinet déclare, qui compte ce que tu as encaissé.'
export const SOURCE_CREANCES = 'Le reste à encaisser de tes factures validées, d’après les encaissements que tu as '
  + 'enregistrés, avoirs déduits. Une facture sans date d’échéance se dit à part.'
export const SOURCE_SOLDE = 'Le solde final du dernier relevé dont ton cabinet a contrôlé le solde. Il n’est jamais calculé '
  + 'en additionnant les mouvements : un mouvement manquant le rendrait faux.'
export const SOURCE_ETATS = 'Tes factures validées de l’année, avoirs déduits, hors taxes, à leur date d’émission.'
export const SOURCE_PAR_ARTICLE = 'Chaque ligne de tes factures sous l’article qui l’a remplie, nommé comme sur ta dernière '
  + 'facture qui le porte.'
export const SANS_ARTICLE = 'Lignes saisies sans article'
export const ACOMPTES = 'Acomptes de tes devis, et leur reprise sur la facture finale'

export const MUET_VENTES = 'Ce chiffre ne s’affiche pas : tes factures ou leurs encaissements n’ont pas pu être lus en '
  + 'entier. Recharge la page.'
export const MUET_ETAT = 'Cet état ne s’affiche pas : tes factures n’ont pas pu être lues en entier. Recharge la page.'
export const MUET_SOLDE = 'Le solde ne s’affiche pas : tes relevés contrôlés n’ont pas pu être lus en entier. Recharge la page.'
export const DROITS_ILLISIBLES = 'Ton analyse ne s’affiche pas : ton accès n’a pas pu être vérifié. Recharge la page.'
export const RIEN_D_OUVERT = 'Ton accès n’ouvre ni tes ventes ni ta banque : il n’y a rien à analyser ici.'

/** Les mots d'un solde lu (`soldeAuReleve`), sauf le solde lui-même, que la page met en forme. */
export function motsDuSolde(solde: SoldeLu): string {
  switch (solde.etat) {
    case 'lu': return SOURCE_SOLDE
    case 'aucun_releve': return 'Pas de solde à afficher : ton cabinet n’a encore importé aucun relevé dont le solde a été contrôlé.'
    case 'aucun_solde_sur': return `Pas de solde à afficher : le solde de tes relevés importés (${solde.releves}) n’a pas pu être `
      + 'contrôlé, ou leur période n’est pas datée.'
    case 'muet': return MUET_SOLDE
  }
}

// ── Le calendrier ──────────────────────────────────────────────────────────────────────────────────────────────────────
const centimes = (euros: number) => Math.round(euros * 100)

/** Un document de vente qui compte : validé, facture ou avoir (stocké négatif : il se déduit de lui-même). */
const compte = (f: Pick<FactureEmise, 'statut'>) => f.statut === 'validee'


// ── Le chiffre d'affaires facturé ──────────────────────────────────────────────────────────────────────────────────────
export interface Comparaison {
  libelle: string
  centimes: number
  /** Les mêmes mois de l'année d'avant. */
  libelleN1: string
  n1Centimes: number
}

export type ChiffreDAffaires =
  | { etat: 'muet'; motif: string }
  | { etat: 'lu'; mois: Comparaison; cumul: Comparaison }

/**
 * Le chiffre d'affaires facturé HT du mois de `aujourdHui` (jour de Paris, lu au rendu) et cumulé depuis janvier, chacun
 * comparé aux mêmes mois de l'année d'avant. Muet si les factures ne sont pas lues en entier.
 */
export function chiffreDAffairesFacture(listes: Pick<ListesDesVentes, 'factures' | 'facturesIncompletes'>, aujourdHui: string): ChiffreDAffaires {
  if (listes.facturesIncompletes != null) return { etat: 'muet', motif: listes.facturesIncompletes }
  const annee = Number(aujourdHui.slice(0, 4))
  const mois = aujourdHui.slice(5, 7)
  const somme = (garder: (date: string) => boolean) => listes.factures
    .filter((f) => compte(f) && garder(f.date_emission))
    .reduce((s, f) => s + centimes(f.montant_ht), 0)
  const dansLeMois = (a: number) => (d: string) => d.slice(0, 7) === `${a}-${mois}`
  const depuisJanvier = (a: number) => (d: string) => d.slice(0, 4) === String(a) && d.slice(5, 7) <= mois
  const periode = (a: number) => (mois === '01' ? `janvier ${a}` : `de janvier à ${libelleDuMois(`${a}-${mois}`)}`)
  return {
    etat: 'lu',
    mois: {
      libelle: libelleDuMois(`${annee}-${mois}`), centimes: somme(dansLeMois(annee)),
      libelleN1: libelleDuMois(`${annee - 1}-${mois}`), n1Centimes: somme(dansLeMois(annee - 1)),
    },
    cumul: {
      libelle: periode(annee), centimes: somme(depuisJanvier(annee)),
      libelleN1: periode(annee - 1), n1Centimes: somme(depuisJanvier(annee - 1)),
    },
  }
}

/** « +12 % » ou « −5 % » par rapport à l'année d'avant ; null sans base de comparaison (rien facturé alors). */
export function variation(c: Pick<Comparaison, 'centimes' | 'n1Centimes'>): string | null {
  if (c.n1Centimes <= 0) return null
  const pourcent = Math.round(((c.centimes - c.n1Centimes) / c.n1Centimes) * 100)
  return `${pourcent > 0 ? '+' : pourcent < 0 ? '−' : ''}${Math.abs(pourcent)} %`
}

// ── Ce que tes clients te doivent ──────────────────────────────────────────────────────────────────────────────────────
export interface Creance { nombre: number; centimes: number }

export type CreancesClients =
  | { etat: 'muet'; motif: string }
  | { etat: 'lu'; enRetard: Creance; aVenir: Creance; sansEcheance: Creance; total: Creance }

/** Une facture dont il reste à encaisser, et ce reste, en centimes (strictement positif). */
export interface FactureAEncaisser { facture: FactureEmise; resteCentimes: number }

/**
 * Les factures validées (pas un avoir) dont il reste à encaisser, et ce reste : `resteAEncaisser` (le registre, NET des
 * retirés et des annulations), moins ce que les avoirs ont crédité (`dejaCredite`) — le calcul de l'onglet Factures. Écrit
 * une fois : « Mon analyse » (`creancesClients`) et « Ma trésorerie » (lib/tresorerieClient.ts) le lisent. Ne juge pas
 * l'entièreté des listes : l'appelant ne l'appelle que sur des listes lues en entier.
 */
export function facturesAEncaisser(
  listes: Pick<ListesDesVentes, 'factures' | 'lignes' | 'encaissements' | 'parts'>,
): FactureAEncaisser[] {
  const resultat: FactureAEncaisser[] = []
  for (const f of listes.factures) {
    if (!compte(f) || f.type !== 'facture') continue
    const reste = resteAEncaisser({ facture: f, lignes: listes.lignes, encaissements: listes.encaissements, parts: listes.parts })
      .resteCentimes - centimes(dejaCredite(f.id, listes.factures))
    if (reste > 0) resultat.push({ facture: f, resteCentimes: reste })
  }
  return resultat
}

/**
 * Le reste dû par tes clients, au jour de Paris `aujourdHui` : chaque facture validée (pas un avoir) dont il reste à
 * encaisser, rangée en retard (`retardDeLaFacture`), à venir ou sans échéance. Muet si les factures, leurs lignes, le
 * registre ou ses parts ne sont pas lus en entier.
 */
export function creancesClients(
  listes: Pick<ListesDesVentes, 'factures' | 'facturesIncompletes' | 'lignes' | 'encaissements' | 'parts' | 'encaissementsIncomplets'>,
  aujourdHui: string,
): CreancesClients {
  const motif = listes.facturesIncompletes ?? listes.encaissementsIncomplets
  if (motif != null) return { etat: 'muet', motif }
  const vide = (): Creance => ({ nombre: 0, centimes: 0 })
  const r = { enRetard: vide(), aVenir: vide(), sansEcheance: vide(), total: vide() }
  const ajouter = (c: Creance, reste: number) => { c.nombre += 1; c.centimes += reste }
  for (const { facture: f, resteCentimes: reste } of facturesAEncaisser(listes)) {
    ajouter(r.total, reste)
    if (f.date_echeance == null) ajouter(r.sansEcheance, reste)
    else if (retardDeLaFacture(f, reste, aujourdHui).etat === 'en_retard') ajouter(r.enRetard, reste)
    else ajouter(r.aVenir, reste)
  }
  return { etat: 'lu', ...r }
}

// ── Les états de synthèse ──────────────────────────────────────────────────────────────────────────────────────────────
export interface LigneDEtat {
  cle: string
  libelle: string
  /** Un complément (la référence d'un article) ; nul sinon. */
  detail: string | null
  /** Les documents (factures et avoirs) qui y comptent. */
  documents: number
  centimes: number
}

export type EtatDeSynthese =
  | { etat: 'muet'; motif: string }
  | { etat: 'lu'; lignes: LigneDEtat[]; centimes: number }

export interface LigneDuMois { mois: string; libelle: string; centimes: number; n1Centimes: number }

export type EtatParMois =
  | { etat: 'muet'; motif: string }
  | { etat: 'lu'; lignes: LigneDuMois[]; centimes: number; n1Centimes: number }

/** Les années où un document validé est émis, et celle de `aujourdHui`, de la plus récente à la plus ancienne. */
export function anneesDesVentes(factures: readonly Pick<FactureEmise, 'statut' | 'date_emission'>[], aujourdHui: string): number[] {
  const annees = new Set([Number(aujourdHui.slice(0, 4))])
  for (const f of factures) if (compte(f)) annees.add(Number(f.date_emission.slice(0, 4)))
  return [...annees].sort((a, b) => b - a)
}

const enAnnee = (annee: number) => (f: Pick<FactureEmise, 'date_emission'>) => f.date_emission.slice(0, 4) === String(annee)

// Du plus fort au plus faible, puis par libellé, puis par clé : un ordre TOTAL, le même à chaque rendu.
function trier(lignes: LigneDEtat[]): LigneDEtat[] {
  return lignes.sort((a, b) => b.centimes - a.centimes || a.libelle.localeCompare(b.libelle, 'fr') || (a.cle < b.cle ? -1 : a.cle > b.cle ? 1 : 0))
}

/** Le chiffre d'affaires HT de l'année, par client (le nom de l'acheteur sur la facture, tel qu'elle le garde). */
export function parClient(listes: Pick<ListesDesVentes, 'factures' | 'facturesIncompletes'>, annee: number): EtatDeSynthese {
  if (listes.facturesIncompletes != null) return { etat: 'muet', motif: listes.facturesIncompletes }
  const parCle = new Map<string, LigneDEtat>()
  for (const f of listes.factures.filter((x) => compte(x) && enAnnee(annee)(x))) {
    const nom = f.tiers_nom.trim()
    const l = parCle.get(nom) ?? { cle: nom, libelle: nom || 'Client sans nom', detail: null, documents: 0, centimes: 0 }
    l.documents += 1
    l.centimes += centimes(f.montant_ht)
    parCle.set(nom, l)
  }
  const lignes = trier([...parCle.values()])
  return { etat: 'lu', lignes, centimes: lignes.reduce((s, l) => s + l.centimes, 0) }
}

/**
 * Le chiffre d'affaires HT de l'année, par article : chaque ligne d'un document validé sous l'article qui l'a remplie (sa
 * provenance, figée depuis l'étape A7a), nommé par la désignation de sa ligne la plus récente ; une ligne d'acompte, ou qui
 * reprend un acompte, à part ; une ligne sans article, à part. Muet si les factures ou leurs lignes ne sont pas lues en
 * entier, ou si une ligne cite une facture absente d'une liste pourtant entière.
 */
export function parArticle(
  listes: Pick<ListesDesVentes, 'factures' | 'facturesIncompletes'>,
  provenance: { lignes: readonly LigneDeProvenance[]; complete: boolean; motif: string | null },
  annee: number,
): EtatDeSynthese {
  if (listes.facturesIncompletes != null) return { etat: 'muet', motif: listes.facturesIncompletes }
  if (!provenance.complete) return { etat: 'muet', motif: provenance.motif ?? 'les lignes de tes factures n’ont pas été lues en entier' }
  const factures = new Map(listes.factures.map((f) => [f.id, f]))
  const parCle = new Map<string, LigneDEtat & { documentsVus: Set<string>; nommeLe: string }>()
  for (const l of provenance.lignes) {
    const f = factures.get(l.facture_id)
    if (!f) return { etat: 'muet', motif: 'une ligne cite une facture que la lecture n’a pas rendue' }
    if (!compte(f) || !enAnnee(annee)(f)) continue
    const acompte = f.acompte || l.reprise_facture_id != null
    const cle = acompte ? 'acomptes' : l.article_id ?? 'sans_article'
    const e = parCle.get(cle) ?? {
      cle, libelle: acompte ? ACOMPTES : l.article_id ? l.designation : SANS_ARTICLE, detail: null,
      documents: 0, centimes: 0, documentsVus: new Set<string>(), nommeLe: '',
    }
    // L'article se nomme comme sur la ligne la plus récente qui le porte (la date, puis la facture, puis l'ordre).
    const rang = `${f.date_emission}|${f.id}|${String(l.ordre).padStart(6, '0')}`
    if (l.article_id && !acompte && rang > e.nommeLe) {
      e.nommeLe = rang
      e.libelle = l.designation
      e.detail = l.reference?.trim() ? l.reference.trim() : null
    }
    e.documentsVus.add(f.id)
    e.documents = e.documentsVus.size
    e.centimes += centimes(calculerLigne(l.quantite, l.prix_unitaire_ht, 0).montant_ht)
    parCle.set(cle, e)
  }
  const lignes = trier([...parCle.values()].map(({ cle, libelle, detail, documents, centimes: c }) => ({ cle, libelle, detail, documents, centimes: c })))
  return { etat: 'lu', lignes, centimes: lignes.reduce((s, l) => s + l.centimes, 0) }
}

/** Le chiffre d'affaires HT de l'année, mois par mois (les douze), avec les mêmes mois de l'année d'avant. */
export function parMois(listes: Pick<ListesDesVentes, 'factures' | 'facturesIncompletes'>, annee: number): EtatParMois {
  if (listes.facturesIncompletes != null) return { etat: 'muet', motif: listes.facturesIncompletes }
  const somme = (cle: string) => listes.factures
    .filter((f) => compte(f) && f.date_emission.slice(0, 7) === cle)
    .reduce((s, f) => s + centimes(f.montant_ht), 0)
  const lignes = Array.from({ length: 12 }, (_, i) => {
    const m = String(i + 1).padStart(2, '0')
    return { mois: `${annee}-${m}`, libelle: libelleDuMois(`${annee}-${m}`), centimes: somme(`${annee}-${m}`), n1Centimes: somme(`${annee - 1}-${m}`) }
  })
  return {
    etat: 'lu', lignes,
    centimes: lignes.reduce((s, l) => s + l.centimes, 0),
    n1Centimes: lignes.reduce((s, l) => s + l.n1Centimes, 0),
  }
}

// ── L'export ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// Comme les autres exports de l'application (lib/reglements.ts, la piste d'audit) : BOM UTF-8, point-virgule, chaque champ
// par `champCsv`, des montants à virgule décimale sans symbole qu'un tableur lit comme des nombres.
const montantCsv = (c: number): string => (c < 0 ? '-' : '') + (Math.abs(c) / 100).toFixed(2).replace('.', ',')
const enCsv = (lignes: readonly (readonly string[])[]) => '﻿' + lignes.map((c) => c.map(champCsv).join(';')).join('\r\n')

/** Un état par client ou par article, en CSV. */
export function csvDeLEtat(nature: 'client' | 'article', annee: number, etat: Extract<EtatDeSynthese, { etat: 'lu' }>): string {
  const entete = nature === 'client'
    ? ['Client', 'Documents', `Chiffre d'affaires HT ${annee}`]
    : ['Article', 'Référence', 'Documents', `Chiffre d'affaires HT ${annee}`]
  const corps = etat.lignes.map((l) => (nature === 'client'
    ? [l.libelle, String(l.documents), montantCsv(l.centimes)]
    : [l.libelle, l.detail ?? '', String(l.documents), montantCsv(l.centimes)]))
  return enCsv([entete, ...corps])
}

/** L'état par mois, en CSV : le mois (AAAA-MM), l'année et la précédente. */
export function csvParMois(annee: number, etat: Extract<EtatParMois, { etat: 'lu' }>): string {
  return enCsv([
    ['Mois', `Chiffre d'affaires HT ${annee}`, `Chiffre d'affaires HT ${annee - 1}`],
    ...etat.lignes.map((l) => [l.mois, montantCsv(l.centimes), montantCsv(l.n1Centimes)]),
  ])
}

/** « ventes-par-client-2026.csv » : l'état et l'année, jamais le nom du dossier. */
export function nomFichierDeLEtat(nature: 'client' | 'article' | 'mois', annee: number): string {
  return `ventes-par-${nature}-${annee}.csv`
}
