import { centimesExacts, euroCommeLaBase, remplirModele, tauxCommeLaBase } from './encaissementsFactures'
import { numeroTvaImprime, TAUX_ADMIS, type DossierCii } from './factureCii'
import { ajouterMois, formatDate } from './format'
import { mentionsAEnregistrer, siretAEnregistrer, type SaisieMentions } from './mentionsFacture'
import { calculerLigne, calculerTotaux, type LigneCalculee } from './montantsFacture'
import { mentionTva } from './statutTva'
import type { ArticleExoneration, Devis, LigneDevis, NatureOperation, ReponseDevis, StatutTva } from './types'

// LES DEVIS (espace client, étape P5 ; conception : HISTORIQUE.md, « L'ESPACE CLIENT DEVIENT LE LOGICIEL DE GESTION DU
// CLIENT : LA CONCEPTION », §2.3 et §4.3). Un module PUR — il ne lit rien en base, n'appelle personne, ne lit pas
// l'horloge — que les écrans de l'étape P6 liront : les mentions d'un devis, ses totaux (par `calculerLigne`, comme une
// facture), sa validité jugée au jour de Paris, et ce que les fonctions de la base refuseraient, dans LEUR ordre et sous
// LEURS mots, dit avant le clic.
//
// CE QU'UN DEVIS EST, d'après les sources publiques (service-public.gouv.fr, « Devis », F31144 ; code de la consommation,
// art. L111-1 et L214-1) : une OFFRE, qui engage le professionnel une fois acceptée et le client par son acceptation
// (« bon pour accord ») ; aucune obligation générale d'en faire, aucune durée de validité légale — elle se fixe, et
// s'imprime ; il n'entre ni en comptabilité ni dans la facture électronique. Les devis réglementés d'une profession
// (bâtiment, optique, audioprothèse, chirurgie esthétique, services à la personne, l'information écrite préalable d'un
// professionnel de santé) ont leurs propres modèles : ils ne sont pas de ce module.

// ── Est-ce en base ? ──────────────────────────────────────────────────────────────────────────────────────────────────
// Les deux migrations (devis_du_client, puis devis_du_client_suppression, à coller) attendent l'accord du cabinet : elles
// ouvrent une lecture au client qui porte le droit « Ventes ». Tant que l'export (supabase/schema) ne les porte pas, rien
// ne lit ni n'écrit les devis : le plan de sauvegarde ne compte pas leurs tables (src/lib/sauvegarde.ts) et aucun écran
// ne les offre (étape P6). Le jour où l'export porte les DEUX, devis.test.ts vire au rouge tant que ceci reste `false` :
// le lever met les trois tables au plan, et confronte les refus ci-dessous au texte même des fonctions.
export const DEVIS_EXPORTES: boolean = false

// ── Les constantes de la base, confrontées au texte des migrations par le test ─────────────────────────────────────
export const PREFIXE_DEVIS = 'D'
export const DATE_PLANCHER_DEVIS = '2000-01-01'
// Deux bornes TECHNIQUES, pas des règles de droit : de quoi compter tout total exactement au centime dans le navigateur
// (500 lignes de moins de dix milliards d'euros font moins de 2⁵³ centimes, TVA comprise).
export const LIGNES_MAX = 500
export const BORNE_LIGNE_HT_EUROS = 10_000_000_000
export const DECIMALES_QUANTITE = 4
export const DECIMALES_PRIX = 6

// LA DURÉE DE VALIDITÉ PROPOSÉE : un mois — NOTRE CHOIX (conception, §4.3), aucune durée légale n'existant (F31144), en
// attendant la réponse du cabinet (question EC-D1). Un mois se compte au quantième, le dernier jour du mois quand il
// manque — la règle du code de procédure civile, art. 641, prise par analogie : le 31 janvier vaut jusqu'au 28 février.
export const DUREE_VALIDITE_PAR_DEFAUT_MOIS = 1

/** La validité proposée d'un devis daté `dateEmission` : un mois plus tard, au même quantième ou au dernier du mois. */
export function validiteParDefaut(dateEmission: string): string {
  return ajouterMois(dateEmission, DUREE_VALIDITE_PAR_DEFAUT_MOIS)
}

/** Le numéro d'un devis, comme `enregistrer_devis` l'écrit : « D2026-0001 », tous ses chiffres au-delà de quatre. */
export function numeroDeDevis(annee: number, sequence: number): string {
  return `${PREFIXE_DEVIS}${annee}-${String(sequence).padStart(4, '0')}`
}

// ── Les totaux ─────────────────────────────────────────────────────────────────────────────────────────────────────
// Ceux d'une facture : chaque ligne par `calculerLigne`, sommée en centimes entiers (`calculerTotaux`). La base les refait
// à l'identique (`centimes_ligne_facture`) et refuse un en-tête qui les contredit.
export function totauxDuDevis(lignes: readonly LigneDevis[]): LigneCalculee {
  return calculerTotaux([...lignes])
}

// ── L'état d'un devis, au jour de Paris ─────────────────────────────────────────────────────────────────────────────
// La base ne garde que le statut (brouillon, émis) et la réponse : « expiré » et « facturé » se DÉDUISENT. Un devis émis
// sans réponse est expiré le lendemain de sa date de validité À PARIS — `aujourdHui` vient d'`aujourdHuiAParis`, comme la
// base date ses refus ; il reste valable tout le jour qu'il imprime.
export type EtatDevis = 'brouillon' | 'en_attente' | 'expire' | 'accepte' | 'refuse' | 'facture'

export const LIBELLES_ETAT_DEVIS: Readonly<Record<EtatDevis, string>> = {
  brouillon: 'Brouillon',
  en_attente: 'Émis — en attente de réponse',
  expire: 'Expiré',
  accepte: 'Accepté',
  refuse: 'Refusé',
  facture: 'Facturé',
}

/**
 * L'état d'un devis. `factureTiree` : au moins une facture tirée de lui (`devis_factures`), brouillon compris — passé sans
 * valeur par défaut : un écran qui l'oublierait dirait « accepté » d'un devis déjà facturé.
 */
export function etatDuDevis(
  devis: Pick<Devis, 'statut' | 'reponse' | 'date_validite'>,
  factureTiree: boolean,
  aujourdHui: string,
): EtatDevis {
  if (devis.statut === 'brouillon') return 'brouillon'
  if (devis.reponse === 'acceptee') return factureTiree ? 'facture' : 'accepte'
  if (devis.reponse === 'refusee') return 'refuse'
  return aujourdHui > devis.date_validite ? 'expire' : 'en_attente'
}

// ── Les mentions imprimées ──────────────────────────────────────────────────────────────────────────────────────────
// Ce que le devis imprimé porte en plus de l'émetteur, du client, des lignes et des totaux : sa validité (la mention que
// les listes sectorielles exigent toutes, F31144), et les mentions du client que la facture tirée de lui reprendra — son
// SIREN, la nature des opérations, l'adresse de livraison, le code service et le numéro d'engagement d'un organisme
// public —, sous les libellés de la facture imprimée (`mentionsImprimees`, factureCii.ts ; devis.test.ts les confronte) ;
// et la date ou la période d'exécution PRÉVUE (code de la consommation, art. L111-1, 3°), sous un libellé qui dit qu'elle
// est prévue. Les conditions (délai, paiement, acompte), les mentions légales et le bloc « Bon pour accord » s'impriment
// à part.
export interface MentionDevis {
  libelle: string
  texte: string
}

const NATURES: Readonly<Record<NatureOperation, string>> = {
  biens: 'Livraisons de biens',
  services: 'Prestations de services',
  mixte: 'Livraisons de biens et prestations de services',
}

const sirenLisible = (siren: string) => siren.replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3')
const uneLigne = (texte: string) => texte.replace(/\s+/g, ' ').trim()

export function mentionsDuDevis(
  d: Pick<Devis, 'date_validite' | 'tiers_siren' | 'nature_operation' | 'date_prestation' | 'periode_debut' | 'periode_fin'
    | 'livraison_adresse' | 'livraison_code_postal' | 'livraison_ville' | 'livraison_pays' | 'type_client' | 'code_service'
    | 'numero_engagement'>,
): MentionDevis[] {
  const mentions: MentionDevis[] = [{ libelle: 'Devis valable jusqu’au', texte: formatDate(d.date_validite) }]
  if (d.tiers_siren) mentions.push({ libelle: 'SIREN du client', texte: sirenLisible(d.tiers_siren) })
  if (d.nature_operation) mentions.push({ libelle: 'Opérations', texte: NATURES[d.nature_operation] })
  if (d.date_prestation) mentions.push({ libelle: 'Exécution prévue le', texte: formatDate(d.date_prestation) })
  if (d.periode_debut && d.periode_fin) {
    mentions.push({ libelle: 'Exécution prévue', texte: `du ${formatDate(d.periode_debut)} au ${formatDate(d.periode_fin)}` })
  }
  if (d.livraison_adresse && d.livraison_code_postal && d.livraison_ville) {
    const pays = d.livraison_pays && d.livraison_pays !== 'FR' ? `, ${d.livraison_pays}` : ''
    mentions.push({
      libelle: 'Adresse de livraison',
      texte: `${uneLigne(d.livraison_adresse)}, ${d.livraison_code_postal} ${d.livraison_ville}${pays}`,
    })
  }
  if (d.type_client === 'organisme_public') {
    if (d.code_service) mentions.push({ libelle: 'Code service', texte: d.code_service })
    if (d.numero_engagement) mentions.push({ libelle: 'Numéro d’engagement', texte: d.numero_engagement })
  }
  return mentions
}

/** Le numéro de TVA de l'émetteur, celui que la facture imprimée porterait (`numeroTvaImprime`) ; aucun s'il n'en a pas. */
export function numeroTvaDuDevis(d: Pick<Devis, 'emetteur_siret'>, dossier: DossierCii): string | null {
  return numeroTvaImprime(d, dossier)
}

/**
 * Les mentions légales proposées à un devis neuf : la mention de TVA du statut du dossier (la franchise, l'article qui
 * exonère — `mentionTva`), et rien d'autre. Les pénalités de retard et l'indemnité de recouvrement sont celles d'une
 * FACTURE : la facture tirée d'un devis ne reprend pas ses mentions légales, le formulaire de la facture propose les
 * siennes. Ce qu'un secteur exige de plus (« devis gratuit ou payant », le taux horaire…) se saisit.
 */
export function mentionsLegalesParDefautDuDevis(statut: StatutTva | null, article: ArticleExoneration | null): string {
  return mentionTva(statut, article) ?? ''
}

// Au-dessus de la signature du client du client (F31144 : il n'est engagé qu'à son acceptation).
export const BON_POUR_ACCORD = 'Bon pour accord — date et signature du client'

// ── Ce que l'écran envoie ───────────────────────────────────────────────────────────────────────────────────────────
// Le devis tel qu'un formulaire le saisit, et ce qu'`enregistrer_devis` en reçoit : l'en-tête (`p_devis`) et les lignes
// (`p_lignes`), les totaux CALCULÉS des lignes envoyées (la base les compare au centime). Une mention que son choix ne
// s'ouvre pas repart à nul (`mentionsAEnregistrer`), dans la même écriture.
export interface SaisieDevis {
  dateEmission: string
  dateValidite: string
  objet: string
  tiersNom: string
  tiersAdresse: string
  tiersSiret: string
  tiersEmail: string
  mentions: SaisieMentions
  lignes: LigneDevis[]
  conditions: string
  mentionsLegales: string
  notes: string
  // L'émetteur : le dossier, tel que l'écran le lit — figé à l'émission.
  emetteurNom: string | null
  emetteurSiret: string | null
  emetteurAdresse: string | null
}

export interface EcritureDevis {
  /** `p_devis` : l'en-tête, une valeur JSON — l'objet que la fonction lit clé par clé. */
  devis: unknown
  /** `p_lignes` : une valeur JSON — la liste que la fonction vérifie ligne par ligne. */
  lignes: unknown
  emettre: boolean
}

export function ecritureDuDevis(s: SaisieDevis, emettre: boolean): EcritureDevis {
  const texte = (v: string | null) => v?.trim() || null
  const t = totauxDuDevis(s.lignes)
  const m = mentionsAEnregistrer(s.mentions)
  return {
    devis: {
      date_emission: s.dateEmission,
      date_validite: s.dateValidite,
      objet: texte(s.objet),
      tiers_nom: s.tiersNom.trim(),
      tiers_adresse: texte(s.tiersAdresse),
      tiers_siret: siretAEnregistrer(s.tiersSiret),
      tiers_email: texte(s.tiersEmail),
      ...m,
      montant_ht: t.montant_ht,
      montant_tva: t.montant_tva,
      montant_ttc: t.montant_ttc,
      conditions: texte(s.conditions),
      mentions_legales: texte(s.mentionsLegales),
      notes: texte(s.notes),
      emetteur_nom: texte(s.emetteurNom),
      emetteur_siret: texte(s.emetteurSiret),
      emetteur_adresse: texte(s.emetteurAdresse),
    },
    lignes: s.lignes.map((l) => ({
      designation: l.designation, quantite: l.quantite, prix_unitaire_ht: l.prix_unitaire_ht, taux_tva: l.taux_tva,
    })),
    emettre,
  }
}

// ── Les refus de la base, dans son ordre et sous ses mots ───────────────────────────────────────────────────────────
// Chaque liste est celle des `raise exception` d'une fonction, dans l'ordre de son texte (devis.test.ts la confronte au
// texte exporté quand `DEVIS_EXPORTES` est levé, et toujours aux messages que l'essai supabase/essais/devis.sql exige de
// la base). Le refus d'accès, seule la base le juge : l'écran n'existe que pour qui lit le dossier.

export const REFUS_ENREGISTREMENT_DEVIS = [
  { cle: 'acces', modele: 'Accès refusé à ce dossier.' },
  { cle: 'introuvable', modele: 'Devis introuvable dans ce dossier.' },
  { cle: 'emis', modele: 'Le devis % est émis : il ne se modifie plus — il se duplique.' },
  { cle: 'client_absent', modele: 'Le nom du client est à renseigner.' },
  { cle: 'date_absente', modele: 'La date du devis est à renseigner.' },
  { cle: 'date_avant_2000', modele: "Un devis ne se date pas avant l'an 2000." },
  { cle: 'validite_absente', modele: 'La date de validité du devis est à renseigner.' },
  { cle: 'validite_avant_date', modele: "Un devis n'expire pas avant sa date : valable jusqu'au %, il est daté du %." },
  { cle: 'lignes_nombre', modele: 'Un devis porte au moins une ligne, et au plus 500.' },
  {
    cle: 'ligne_illisible',
    modele: "La ligne % n'est pas une ligne de devis : une désignation, une quantité, un prix unitaire hors taxes et un taux de TVA.",
  },
  { cle: 'designation_absente', modele: 'Ligne % : sa désignation manque.' },
  { cle: 'quantite_invalide', modele: 'Ligne % : la quantité est positive, avec quatre décimales au plus.' },
  { cle: 'prix_invalide', modele: "Ligne % : le prix unitaire hors taxes s'écrit avec six décimales au plus." },
  { cle: 'ligne_hors_borne', modele: "Ligne % : son montant hors taxes atteint dix milliards d'euros." },
  { cle: 'taux_non_admis', modele: "Ligne % : le taux de % %% n'est pas un taux de TVA admis." },
  { cle: 'montants_incoherents', modele: 'Les montants du devis ne sont pas ceux de ses lignes : % € HT, % € de TVA, % € TTC.' },
  { cle: 'emission_future', modele: "Un devis ne s'émet pas daté de l'avenir : nous sommes le %." },
  { cle: 'emission_total', modele: 'Un devis émis porte un montant : son total TTC est positif.' },
  { cle: 'emission_emetteur', modele: "Le nom de l'émetteur du devis est à renseigner." },
] as const

export const REFUS_DECISION_DEVIS = [
  { cle: 'acces', modele: 'Accès refusé à ce dossier.' },
  { cle: 'introuvable', modele: 'Devis introuvable dans ce dossier.' },
  { cle: 'brouillon', modele: "Le devis est un brouillon : il s'émet avant de recevoir une réponse." },
  { cle: 'deja_decide', modele: 'La réponse au devis % est déjà enregistrée (% le %) : elle ne change plus.' },
  { cle: 'reponse_inconnue', modele: 'La réponse au devis est « acceptée » ou « refusée ».' },
  { cle: 'date_absente', modele: 'La date de la réponse est à renseigner.' },
  { cle: 'avant_devis', modele: 'Une réponse ne précède pas le devis, daté du %.' },
  { cle: 'future', modele: "Une réponse ne se date pas dans l'avenir : nous sommes le %." },
  { cle: 'hors_validite', modele: "Le devis % n'était plus valable le % : il l'était jusqu'au %. Son acceptation se confirme." },
] as const

export const REFUS_FACTURATION_DEVIS = [
  { cle: 'acces', modele: 'Accès refusé à ce dossier.' },
  { cle: 'introuvable', modele: 'Devis introuvable dans ce dossier.' },
  { cle: 'brouillon', modele: 'Le devis est un brouillon : seul un devis accepté se transforme en facture.' },
  { cle: 'non_accepte', modele: 'Seul un devis accepté se transforme en facture : le devis % est %.' },
  { cle: 'deja_facture', modele: 'Le devis % a déjà sa facture (%) : un devis se transforme une fois.' },
] as const

export const REFUS_SUPPRESSION_DEVIS = [
  { cle: 'acces', modele: 'Accès refusé à ce dossier.' },
  { cle: 'introuvable', modele: 'Devis introuvable dans ce dossier.' },
  { cle: 'emis', modele: 'Le devis % est émis : il ne se supprime plus.' },
] as const

export type CleRefusEnregistrementDevis = (typeof REFUS_ENREGISTREMENT_DEVIS)[number]['cle']
export type CleRefusDecisionDevis = (typeof REFUS_DECISION_DEVIS)[number]['cle']
export type CleRefusFacturationDevis = (typeof REFUS_FACTURATION_DEVIS)[number]['cle']
export type CleRefusSuppressionDevis = (typeof REFUS_SUPPRESSION_DEVIS)[number]['cle']

export interface RefusDevis<C extends string> {
  cle: C
  message: string
}

function refusDe<C extends string>(liste: readonly { cle: C; modele: string }[], cle: C, valeurs: string[]): RefusDevis<C> {
  const { modele } = liste.find((r) => r.cle === cle) as { cle: C; modele: string }
  return { cle, message: remplirModele(modele, valeurs) }
}

// ── Lire le JSON comme la fonction le lit ───────────────────────────────────────────────────────────────────────────
// La saisie part en JSON (`JSON.stringify`) : un nombre s'écrit comme `String` l'écrit, NaN et l'infini deviennent
// `null`. La fonction lit une clé par `->>` (nulle si l'en-tête n'est pas un objet ou si elle manque), juge un nom
// « blanc » par `btrim` — qui ne retire QUE les espaces, ni une tabulation ni une espace insécable — et une date par sa
// forme AAAA-MM-JJ puis par le calendrier (grégorien proleptique, sans an 0).

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const champ = (objet: unknown, cle: string): unknown => (estObjet(objet) ? objet[cle] : undefined)
// Un nombre JSON : fini. Un nombre qui n'en est pas un part en `null`.
const nombreJson = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
// `btrim(coalesce(x ->> 'cle', '')) = ''` : absent, nul, ou une chaîne d'espaces. Un nombre, un booléen, un objet ont un
// texte, jamais blanc.
const blancCommeLaBase = (v: unknown) =>
  v === undefined || v === null || (typeof v === 'string' && v.replace(/^ +| +$/g, '') === '')

function bissextile(annee: number): boolean {
  return annee % 4 === 0 && (annee % 100 !== 0 || annee % 400 === 0)
}

/** Une date AAAA-MM-JJ qui existe, comme `::date` la lit ; nulle sinon (toute autre forme, l'an 0, le 30 février). */
export function dateDeLaBase(v: unknown): string | null {
  if (typeof v !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)) return null
  const annee = Number(v.slice(0, 4))
  const mois = Number(v.slice(5, 7))
  const jour = Number(v.slice(8, 10))
  const jours = [31, bissextile(annee) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (annee < 1 || mois < 1 || mois > 12 || jour < 1 || jour > jours[mois - 1]) return null
  return v
}

// Le nombre en notation décimale, tel que la base le lit (`tauxCommeLaBase`, sans sa virgule).
const decimalDe = (n: number) => tauxCommeLaBase(n).replace(',', '.')
const decimales = (n: number) => (decimalDe(n).split('.')[1] ?? '').length

// Un décimal écrit, en entier à l'échelle 10^echelle, exactement : ses décimales n'y dépassent pas (vérifié avant).
function entierALEchelle(n: number, echelle: number): bigint {
  const [entier, fraction = ''] = decimalDe(Math.abs(n)).split('.')
  return BigInt(entier + fraction.padEnd(echelle, '0'))
}

// |quantité × prix| ≥ dix milliards d'euros, en décimal exact : quantité à 10⁻⁴, prix à 10⁻⁶ près.
function horsBorne(quantite: number, prix: number): boolean {
  const produit = entierALEchelle(quantite, DECIMALES_QUANTITE) * entierALEchelle(prix, DECIMALES_PRIX)
  return produit >= BigInt(BORNE_LIGNE_HT_EUROS) * 10n ** BigInt(DECIMALES_QUANTITE + DECIMALES_PRIX)
}

/** Les centimes HT et de TVA des lignes, ligne par ligne comme `calculerLigne` (et `centimes_ligne_facture`). */
function centimesDesLignes(lignes: readonly LigneDevis[]): { ht: number; tva: number } {
  let ht = 0
  let tva = 0
  for (const l of lignes) {
    const c = calculerLigne(l.quantite, l.prix_unitaire_ht, l.taux_tva)
    ht += Math.round(c.montant_ht * 100)
    tva += Math.round(c.montant_tva * 100)
  }
  return { ht, tva }
}

/** Le devis que l'écriture vise : un devis neuf, ou celui de l'identifiant envoyé — nul quand l'écran ne l'a pas lu. */
export type CibleDevis =
  | { nouveau: true }
  | { nouveau: false; devis: Pick<Devis, 'dossier_id' | 'statut' | 'numero'> | null }

/**
 * Ce qu'`enregistrer_devis` refuserait de cette écriture : le PREMIER refus, dans l'ordre de la base et sous son message,
 * ou null quand elle l'accepterait — hors les contraintes des mentions du client (en 23514, après ces refus), que
 * `refusDesMentions` (mentionsFacture.ts) dit avant le clic sur la saisie. `aujourdHui` : la date du jour À PARIS
 * (`aujourdHuiAParis`), celle que la base lit.
 */
export function refusEnregistrementDevis(
  dossierId: string,
  cible: CibleDevis,
  e: EcritureDevis,
  aujourdHui: string,
): RefusDevis<CleRefusEnregistrementDevis> | null {
  const refus = (cle: CleRefusEnregistrementDevis, ...valeurs: string[]) => refusDe(REFUS_ENREGISTREMENT_DEVIS, cle, valeurs)
  // 2 et 3. Le devis, dans ce dossier ; un brouillon seul se réécrit.
  if (!cible.nouveau) {
    if (!cible.devis || cible.devis.dossier_id !== dossierId) return refus('introuvable')
    if (cible.devis.statut === 'emis') return refus('emis', cible.devis.numero ?? '')
  }
  // 4. Le client.
  if (blancCommeLaBase(champ(e.devis, 'tiers_nom'))) return refus('client_absent')
  // 5 à 8. Les dates.
  const date = dateDeLaBase(champ(e.devis, 'date_emission'))
  if (date == null) return refus('date_absente')
  if (date < DATE_PLANCHER_DEVIS) return refus('date_avant_2000')
  const validite = dateDeLaBase(champ(e.devis, 'date_validite'))
  if (validite == null) return refus('validite_absente')
  if (validite < date) return refus('validite_avant_date', formatDate(validite), formatDate(date))
  // 9 à 15. Les lignes, puis chacune dans l'ordre : sa forme, sa désignation, sa quantité, son prix, son montant, son taux.
  if (!Array.isArray(e.lignes) || e.lignes.length < 1 || e.lignes.length > LIGNES_MAX) return refus('lignes_nombre')
  const lignes: LigneDevis[] = []
  for (const [i, l] of e.lignes.entries()) {
    const n = String(i + 1)
    if (!estObjet(l) || typeof l.designation !== 'string' || !nombreJson(l.quantite) || !nombreJson(l.prix_unitaire_ht)
      || !nombreJson(l.taux_tva)) {
      return refus('ligne_illisible', n)
    }
    if (blancCommeLaBase(l.designation)) return refus('designation_absente', n)
    if (!(l.quantite > 0) || decimales(l.quantite) > DECIMALES_QUANTITE) return refus('quantite_invalide', n)
    if (decimales(l.prix_unitaire_ht) > DECIMALES_PRIX) return refus('prix_invalide', n)
    if (horsBorne(l.quantite, l.prix_unitaire_ht)) return refus('ligne_hors_borne', n)
    if (!TAUX_ADMIS.includes(l.taux_tva)) return refus('taux_non_admis', n, tauxCommeLaBase(l.taux_tva))
    lignes.push({ designation: l.designation, quantite: l.quantite, prix_unitaire_ht: l.prix_unitaire_ht, taux_tva: l.taux_tva })
  }
  // 16. Les montants de l'en-tête : des nombres, ceux des lignes au centime.
  const { ht, tva } = centimesDesLignes(lignes)
  const juste = (cle: string, centimes: number) => {
    const v = champ(e.devis, cle)
    return nombreJson(v) && centimesExacts(v) === centimes
  }
  if (!juste('montant_ht', ht) || !juste('montant_tva', tva) || !juste('montant_ttc', ht + tva)) {
    return refus('montants_incoherents', euroCommeLaBase(ht), euroCommeLaBase(tva), euroCommeLaBase(ht + tva))
  }
  // 17 à 19. Émettre : pas daté de l'avenir à Paris, un total positif, l'émetteur nommé.
  if (e.emettre) {
    if (date > aujourdHui) return refus('emission_future', formatDate(aujourdHui))
    if (ht + tva <= 0) return refus('emission_total')
    if (blancCommeLaBase(champ(e.devis, 'emetteur_nom'))) return refus('emission_emetteur')
  }
  return null
}

/** La réponse à enregistrer : acceptée ou refusée (ou ce que l'écran a reçu), sa date, et la confirmation hors validité. */
export interface DecisionDevis {
  reponse: ReponseDevis | string | null
  dateReponse: string | null
  horsValidite: boolean
}

/** Ce que `decider_devis` refuserait, dans son ordre et sous ses mots ; null quand elle l'accepterait. */
export function refusDecisionDevis(
  dossierId: string,
  devis: Pick<Devis, 'dossier_id' | 'statut' | 'numero' | 'date_emission' | 'date_validite' | 'reponse' | 'date_reponse'> | null,
  d: DecisionDevis,
  aujourdHui: string,
): RefusDevis<CleRefusDecisionDevis> | null {
  const refus = (cle: CleRefusDecisionDevis, ...valeurs: string[]) => refusDe(REFUS_DECISION_DEVIS, cle, valeurs)
  if (!devis || devis.dossier_id !== dossierId) return refus('introuvable')
  if (devis.statut !== 'emis') return refus('brouillon')
  if (devis.reponse != null) {
    return refus('deja_decide', devis.numero ?? '', devis.reponse === 'acceptee' ? 'accepté' : 'refusé', formatDate(devis.date_reponse))
  }
  if (d.reponse !== 'acceptee' && d.reponse !== 'refusee') return refus('reponse_inconnue')
  const date = dateDeLaBase(d.dateReponse)
  if (date == null) return refus('date_absente')
  if (date < devis.date_emission) return refus('avant_devis', formatDate(devis.date_emission))
  if (date > aujourdHui) return refus('future', formatDate(aujourdHui))
  if (d.reponse === 'acceptee' && date > devis.date_validite && !d.horsValidite) {
    return refus('hors_validite', devis.numero ?? '', formatDate(date), formatDate(devis.date_validite))
  }
  return null
}

/**
 * Ce que `facturer_devis` refuserait, dans son ordre et sous ses mots ; null quand elle tirerait la facture. `factureTiree` :
 * la première facture tirée du devis (par date du lien, puis identifiant, comme la base), son numéro nul sur un brouillon
 * — ou null s'il n'en a pas. Passée sans valeur par défaut : l'oublier ferait offrir une seconde facture.
 */
export function refusFacturationDevis(
  dossierId: string,
  devis: Pick<Devis, 'dossier_id' | 'statut' | 'numero' | 'reponse'> | null,
  factureTiree: { numero: string | null } | null,
): RefusDevis<CleRefusFacturationDevis> | null {
  const refus = (cle: CleRefusFacturationDevis, ...valeurs: string[]) => refusDe(REFUS_FACTURATION_DEVIS, cle, valeurs)
  if (!devis || devis.dossier_id !== dossierId) return refus('introuvable')
  if (devis.statut !== 'emis') return refus('brouillon')
  if (devis.reponse !== 'acceptee') {
    return refus('non_accepte', devis.numero ?? '', devis.reponse === 'refusee' ? 'refusé' : 'en attente de réponse')
  }
  if (factureTiree) return refus('deja_facture', devis.numero ?? '', factureTiree.numero ?? 'un brouillon')
  return null
}

/** Ce que `supprimer_brouillon_devis` refuserait ; null quand elle supprimerait le brouillon. */
export function refusSuppressionDevis(
  dossierId: string,
  devis: Pick<Devis, 'dossier_id' | 'statut' | 'numero'> | null,
): RefusDevis<CleRefusSuppressionDevis> | null {
  const refus = (cle: CleRefusSuppressionDevis, ...valeurs: string[]) => refusDe(REFUS_SUPPRESSION_DEVIS, cle, valeurs)
  if (!devis || devis.dossier_id !== dossierId) return refus('introuvable')
  if (devis.statut === 'emis') return refus('emis', devis.numero ?? '')
  return null
}
