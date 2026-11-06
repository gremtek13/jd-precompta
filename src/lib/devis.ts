import { centimesExacts, euroCommeLaBase, remplirModele, tauxCommeLaBase } from './encaissementsFactures'
import { numeroTvaImprime, TAUX_ADMIS, type DossierCii } from './factureCii'
import { nomDansUnRefus } from './articles'
import { ajouterMois, formatDate, formatMoney } from './format'
import {
  mentionsAEnregistrer, refusDesMentions, saisieDesMentions, siretAEnregistrer, type SaisieMentions,
} from './mentionsFacture'
import { calculerLigne, calculerTotaux, type LigneCalculee } from './montantsFacture'
import { mentionTva } from './statutTva'
import { CATEGORIE_ENTREPRENEUR_INDIVIDUEL } from './categoriesJuridiques'
import { adresseNette, denominationAbsente, porteLaMentionEI, siretSansBlancs } from './mentionsFigees'
import { porteUnIban } from './parametresFacturation'
import type {
  ArticleExoneration, Devis, DevisFacture, LigneDevis, NatureOperation, ReponseDevis, StatutTva,
} from './types'

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
// Les deux migrations des devis sont en production depuis le 05/11/2026 (`devis_du_client`, 20261104204904, par l'outil ;
// `devis_du_client_suppression`, 20261105073709, collée par le cabinet) et l'export (supabase/schema) les porte : le
// drapeau est levé. Il met les trois tables au plan de sauvegarde (src/lib/sauvegarde.ts), offre la vue « Devis » (étape
// P6), confronte les refus ci-dessous au texte même des fonctions (devis.test.ts), et fait dire à la phrase de la case
// « Ventes » (src/lib/droitsAcces.ts, `ceQueDisentLesCases`) la lecture de ses devis et leurs gestes, que
// droitsAcces.test.ts confronte à l'export. Son état d'avant reste éprouvé tant que son code existe (les tests le baissent
// par `vi.mock`).
export const DEVIS_EXPORTES: boolean = true

// L'envoi d'un devis par e-mail, journalisé (étape P6c1) : la migration `envoi_des_devis` (20261105070313, en production
// depuis le 05/11/2026, dans l'export) pose `emails_envoyes.devis_id` — le devis envoyé, mis à nul si le devis est
// supprimé — et admet le type « devis » au journal. Levé, le drapeau met la relation au graphe de la sauvegarde
// (src/lib/sauvegarde.ts, `auGrapheDeLEnvoiDesDevis`) ; sauvegardeEnvoiDesDevis.test.ts le confronte à l'export. Il ne se
// lève qu'avec ou après `DEVIS_EXPORTES` : la migration exige la table des devis.
export const ENVOI_DES_DEVIS_PREVU: boolean = true

// L'acompte d'un devis (étape P5b2 ; migration `acomptes_des_devis`, en production, dans l'export) : la marque d'une
// facture d'acompte, sa date du versement, la reprise d'une ligne de la facture finale et le rôle du lien d'un devis. Levé,
// le drapeau met la reprise au plan de sauvegarde (src/lib/sauvegarde.ts, `auGrapheDesAcomptes`), que
// sauvegardeAcomptesDesDevis.test.ts confronte à l'export ; les moteurs (P5b3), l'aperçu et la transmission (P5b4b) et les
// écrans des deux espaces (P5b5) lisent l'acompte ; les trois fonctions qui le lisent (`ACOMPTES_EN_BASE`) le suivent
// (copiesFacturation.test.ts). Il ne se lève qu'avec ou après `ENVOI_DES_DEVIS_PREVU` : la migration suppose celle de
// l'envoi. Son état d'avant reste éprouvé tant que son code existe (les tests le baissent par `vi.mock` ou un accesseur).
export const ACOMPTES_PREVUS: boolean = true

// « Envoyer par e-mail » un devis émis, dans les deux espaces (étape P6c3) : `send-email` accepte le type « devis » depuis
// P6c2, déployée le 05/11/2026 (v9, une ligne qui importe le dépôt), après sa migration `envoi_des_devis` : le bouton est
// offert. Il ne s'offre jamais sans `DEVIS_EXPORTES` (pas de devis à envoyer sans la vue des devis). Les tests le baissent
// par `vi.mock` (FacturesTabDevis.test.tsx), l'état d'avant restant éprouvé tant que le code existe.
export const ENVOI_DES_DEVIS_OFFERT: boolean = true

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

// Le libellé de la validité : la première mention, que l'aperçu remonte sous la date du devis (`ceQueLeDevisImprime`).
export const LIBELLE_VALIDITE = 'Devis valable jusqu’au'

const sirenLisible = (siren: string) => siren.replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3')
const uneLigne = (texte: string) => texte.replace(/\s+/g, ' ').trim()

export function mentionsDuDevis(
  d: Pick<Devis, 'date_validite' | 'tiers_siren' | 'nature_operation' | 'date_prestation' | 'periode_debut' | 'periode_fin'
    | 'livraison_adresse' | 'livraison_code_postal' | 'livraison_ville' | 'livraison_pays' | 'type_client' | 'code_service'
    | 'numero_engagement'>,
): MentionDevis[] {
  const mentions: MentionDevis[] = [{ libelle: LIBELLE_VALIDITE, texte: formatDate(d.date_validite) }]
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
  // Aucun émetteur : `enregistrer_devis` le pose à l'émission depuis le dossier (A7), et ignore celui qu'on lui enverrait.
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
  const m = mentionsAEnregistrer(s.mentions, 'devis')
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
    },
    lignes: s.lignes.map((l) => ({
      designation: l.designation, quantite: l.quantite, prix_unitaire_ht: l.prix_unitaire_ht, taux_tva: l.taux_tva,
    })),
    emettre,
  }
}

// ── L'émetteur, lu dans le dossier (A7) ─────────────────────────────────────────────────────────────────────────────
// À l'émission, `enregistrer_devis` pose le nom, le SIRET et l'adresse de l'émetteur depuis le dossier, jamais depuis ce
// que l'écran envoie, sous les règles de la validation d'une facture (mentionsFigees.ts) : le nom, la dénomination — celle
// que la facture figée imprime — ou, faute d'elle, le nom du dossier ; le SIRET et l'adresse, nuls s'ils sont blancs.
export const COLONNES_DE_L_EMETTEUR = 'nom, siret, adresse, forme_juridique, denomination_imprimee'

export interface EmetteurDuDossier {
  nom: string
  siret: string | null
  adresse: string | null
  forme_juridique: string | null
  denomination_imprimee: string | null
}

/** Qui émet — le cabinet du dossier (`admin_du_dossier`) ou un accès « Ventes » — et le dossier tel que la base le lira. */
export interface EmissionAJuger {
  dossier: EmetteurDuDossier
  cabinet: boolean
}

/** L'émetteur que la base posera sur ce devis à son émission. */
export function emetteurDuDevisEmis(d: EmetteurDuDossier): { nom: string; siret: string | null; adresse: string | null } {
  return {
    nom: denominationAbsente(d.denomination_imprimee) ? d.nom : (d.denomination_imprimee as string),
    siret: siretSansBlancs(d.siret) === '' ? null : d.siret,
    adresse: adresseNette(d.adresse) === '' ? null : d.adresse,
  }
}

// Les textes que le devis imprime, dans l'ordre de l'impression, jugés par `porte_un_iban` à chaque enregistrement ; les
// désignations des lignes au rang 10. Ni les notes, qui ne s'impriment pas, ni l'adresse électronique du client.
export const TEXTES_IMPRIMES_DU_DEVIS = [
  { rang: 1, cle: 'tiers_nom', libelle: 'le nom du client' },
  { rang: 2, cle: 'tiers_adresse', libelle: "l'adresse du client" },
  { rang: 3, cle: 'tiers_siret', libelle: 'le SIRET du client' },
  { rang: 4, cle: 'objet', libelle: "l'objet du devis" },
  { rang: 5, cle: 'livraison_adresse', libelle: "l'adresse de livraison" },
  { rang: 6, cle: 'livraison_code_postal', libelle: 'le code postal de livraison' },
  { rang: 7, cle: 'livraison_ville', libelle: 'la ville de livraison' },
  { rang: 8, cle: 'code_service', libelle: 'le code service' },
  { rang: 9, cle: 'numero_engagement', libelle: "le numéro d'engagement" },
  { rang: 11, cle: 'conditions', libelle: 'les conditions du devis' },
  { rang: 12, cle: 'mentions_legales', libelle: 'les mentions légales du devis' },
] as const

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
  { cle: 'iban_dans_un_texte', modele: "Un IBAN figure dans % : un devis n'imprime aucun IBAN ; celui du dossier figure sur ses factures, dans le RIB des paramètres de facturation, confirmé par le cabinet." },
  { cle: 'emission_future', modele: "Un devis ne s'émet pas daté de l'avenir : nous sommes le %." },
  { cle: 'emission_total', modele: 'Un devis émis porte un montant : son total TTC est positif.' },
  {
    cle: 'forme_a_regler',
    modele: "La forme juridique du dossier n'est pas renseignée : l'identité légale qu'un devis imprime est à régler par le "
      + "cabinet avant qu'un devis s'émette depuis l'espace client.",
  },
  {
    cle: 'entrepreneur_individuel',
    modele: "La forme juridique du dossier est celle d'un entrepreneur individuel : sa dénomination imprimée, son nom précédé "
      + 'ou suivi des initiales « EI » ou des mots « entrepreneur individuel » (C. com., art. R526-27), est à renseigner par '
      + "le cabinet avant d'émettre un devis.",
  },
  {
    cle: 'denomination_a_poser',
    modele: "La dénomination du dossier n'est pas renseignée : le cabinet la renseigne avant qu'un devis s'émette depuis "
      + "l'espace client.",
  },
  { cle: 'siret_a_poser', modele: "Le SIRET du dossier n'est pas renseigné : le cabinet le renseigne avant qu'un devis s'émette depuis l'espace client." },
  { cle: 'adresse_a_poser', modele: "L'adresse du dossier n'est pas renseignée : le cabinet la renseigne avant qu'un devis s'émette depuis l'espace client." },
  { cle: 'iban_de_l_emetteur', modele: "Un IBAN figure dans % : un devis n'imprime aucun IBAN ; celui du dossier figure sur ses factures, dans le RIB des paramètres de facturation, confirmé par le cabinet." },
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
  emission: EmissionAJuger,
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
  // 17. Un IBAN dans un texte que le devis imprime, à chaque enregistrement, le premier dans l'ordre de l'impression.
  const texteDe = (v: unknown): string | null => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v))
  const textes = [
    ...TEXTES_IMPRIMES_DU_DEVIS.filter((t) => t.rang < 10).map((t) => ({ libelle: t.libelle, valeur: texteDe(champ(e.devis, t.cle)) })),
    ...lignes.map((l, i) => ({ libelle: `la désignation de la ligne ${i + 1}`, valeur: l.designation })),
    ...TEXTES_IMPRIMES_DU_DEVIS.filter((t) => t.rang > 10).map((t) => ({ libelle: t.libelle, valeur: texteDe(champ(e.devis, t.cle)) })),
  ]
  const avecIban = textes.find((t) => porteUnIban(t.valeur))
  if (avecIban) return refus('iban_dans_un_texte', avecIban.libelle)
  // 18 et 19. Émettre : pas daté de l'avenir à Paris, un total positif.
  if (!e.emettre) return null
  if (date > aujourdHui) return refus('emission_future', formatDate(aujourdHui))
  if (ht + tva <= 0) return refus('emission_total')
  // 20 à 25. L'émetteur que la base lira dans le dossier, sous les règles de la validation d'une facture (A7).
  const d = emission.dossier
  const client = !emission.cabinet
  if (d.forme_juridique == null && client) return refus('forme_a_regler')
  if (d.forme_juridique === CATEGORIE_ENTREPRENEUR_INDIVIDUEL && !porteLaMentionEI(d.denomination_imprimee)) return refus('entrepreneur_individuel')
  if (denominationAbsente(d.denomination_imprimee) && client) return refus('denomination_a_poser')
  if (siretSansBlancs(d.siret) === '' && client) return refus('siret_a_poser')
  if (adresseNette(d.adresse) === '' && client) return refus('adresse_a_poser')
  const pose = emetteurDuDevisEmis(d)
  const emetteur = [
    { libelle: "le nom de l'émetteur", valeur: pose.nom },
    { libelle: "l'adresse de l'émetteur", valeur: pose.adresse },
    { libelle: "le SIRET de l'émetteur", valeur: pose.siret },
  ]
  const ibanEmetteur = emetteur.find((t) => porteUnIban(t.valeur))
  if (ibanEmetteur) return refus('iban_de_l_emetteur', ibanEmetteur.libelle)
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

// ── Ce que les écrans de l'étape P6a1 saisissent et disent ─────────────────────────────────────────────────────────────
// La vue « Devis » (pages/dossier/DevisVue.tsx) et son formulaire (DevisSaisieModal.tsx) ne recopient aucune règle : la saisie
// se compose ici, ses refus se disent par `refusEnregistrementDevis` puis `refusDesMentions`, et chaque confirmation nomme ce
// qui part.

/** Un devis a-t-il une facture tirée de lui (`devis_factures`), brouillon compris : ce qu'`etatDuDevis` demande. */
export function factureTireeDe(devisId: string, liens: readonly Pick<DevisFacture, 'devis_id'>[]): boolean {
  return liens.some((l) => l.devis_id === devisId)
}

/** Une ligne telle que le formulaire la tient : des TEXTES, lus en nombres au moment de partir (`lignesDeLaSaisie`). */
export interface LigneDevisSaisie {
  // Une clé d'affichage, propre à l'écran : elle ne part pas.
  cle: string
  designation: string
  quantite: string
  prix: string
  taux: string
}

/**
 * Une ligne neuve : une quantité de 1, et le taux du statut de TVA du dossier — 20 % pour un redevable, qui facture la TVA,
 * 0 % pour les autres (le choix du formulaire d'une facture).
 */
export function ligneDevisVide(statut: StatutTva | null, cle: string): LigneDevisSaisie {
  return { cle, designation: '', quantite: '1', prix: '', taux: statut === 'redevable' ? '20' : '0' }
}

// Un nombre saisi, la virgule admise ; tout autre texte — vide compris — n'est PAS un nombre : il part en `null` dans le JSON,
// et `refusEnregistrementDevis` le dit « pas une ligne de devis », comme la base. Jamais zéro par défaut : un prix oublié
// partirait gratuit.
const FORME_NOMBRE_SAISI = /^-?[0-9]+(\.[0-9]+)?$/

function nombreSaisi(texte: string): number {
  const t = texte.trim().replace(',', '.')
  return FORME_NOMBRE_SAISI.test(t) ? Number(t) : Number.NaN
}

/** Les lignes qui partent, dans leur ordre, telles que le formulaire les tient. */
export function lignesDeLaSaisie(lignes: readonly LigneDevisSaisie[]): LigneDevis[] {
  return lignes.map((l) => ({
    designation: l.designation, quantite: nombreSaisi(l.quantite), prix_unitaire_ht: nombreSaisi(l.prix), taux_tva: nombreSaisi(l.taux),
  }))
}

/** Les totaux que le formulaire affiche : ceux des lignes lisibles (une ligne illisible compte pour rien, et son refus se dit). */
export function totauxDeLaSaisie(lignes: readonly LigneDevisSaisie[]): LigneCalculee {
  return totauxDuDevis(lignesDeLaSaisie(lignes).filter((l) =>
    Number.isFinite(l.quantite) && Number.isFinite(l.prix_unitaire_ht) && Number.isFinite(l.taux_tva)))
}

/** Les lignes d'un brouillon lu, en textes ; une ligne vide pour un devis neuf. */
export function lignesSaisiesDuDevis(d: Pick<Devis, 'lignes'> | null, statut: StatutTva | null): LigneDevisSaisie[] {
  if (d == null || d.lignes.length === 0) return [ligneDevisVide(statut, 'l0')]
  return d.lignes.map((l, i) => ({
    cle: `l${i}`, designation: l.designation, quantite: String(l.quantite), prix: String(l.prix_unitaire_ht), taux: String(l.taux_tva),
  }))
}

/** Ce que l'écran sait du dossier pour ouvrir un devis : le jour à Paris et le statut de TVA. */
export interface DefautsDuDevis {
  aujourdHui: string
  statutTva: StatutTva | null
  articleExoneration: ArticleExoneration | null
}

/**
 * La saisie d'un devis, hors ses lignes : un devis neuf daté du jour, valable un mois (`validiteParDefaut`), sa mention de TVA
 * proposée ; un brouillon lu tel que la base le garde. Aucun émetteur : la base le pose à l'émission, depuis le dossier.
 */
export function saisieDuDevis(d: Devis | null, defauts: DefautsDuDevis): Omit<SaisieDevis, 'lignes'> {
  if (d == null) {
    return {
      dateEmission: defauts.aujourdHui,
      dateValidite: validiteParDefaut(defauts.aujourdHui),
      objet: '', tiersNom: '', tiersAdresse: '', tiersSiret: '', tiersEmail: '',
      mentions: saisieDesMentions(null),
      conditions: '',
      mentionsLegales: mentionsLegalesParDefautDuDevis(defauts.statutTva, defauts.articleExoneration),
      notes: '',
    }
  }
  return {
    dateEmission: d.date_emission,
    dateValidite: d.date_validite,
    objet: d.objet ?? '',
    tiersNom: d.tiers_nom,
    tiersAdresse: d.tiers_adresse ?? '',
    tiersSiret: d.tiers_siret ?? '',
    tiersEmail: d.tiers_email ?? '',
    mentions: saisieDesMentions(d),
    conditions: d.conditions ?? '',
    mentionsLegales: d.mentions_legales ?? '',
    notes: d.notes ?? '',
  }
}

/**
 * Le premier refus de la saisie TELLE QU'ELLE PART : celui d'`enregistrer_devis`, dans son ordre et sous ses mots, puis
 * celui des mentions du client (les contraintes de la table, que la base juge après) ; null quand la base l'accepterait.
 */
export function refusDeLaSaisieDevis(
  dossierId: string,
  cible: CibleDevis,
  saisie: SaisieDevis,
  emettre: boolean,
  aujourdHui: string,
  emission: EmissionAJuger,
): string | null {
  const refus = refusEnregistrementDevis(dossierId, cible, ecritureDuDevis(saisie, emettre), aujourdHui, emission)
  if (refus) return refus.message
  return refusDesMentions(saisie.mentions, saisie.tiersSiret, 'devis')[0] ?? null
}

/** La confirmation de l'émission : elle nomme le client, le total, la validité, la série — et ce qui ne se défera plus. */
export function confirmationDeLEmission(saisie: SaisieDevis): string {
  const { montant_ttc: ttc } = totauxDuDevis(saisie.lignes)
  const serie = `${PREFIXE_DEVIS}${saisie.dateEmission.slice(0, 4)}`
  return `Émettre le devis pour « ${nomDansUnRefus(saisie.tiersNom.trim())} », ${formatMoney(ttc)} TTC, valable jusqu’au `
    + `${formatDate(saisie.dateValidite)} ? Il prendra le prochain numéro de la série ${serie} et ne se modifiera plus : `
    + 'une erreur se corrigera par un nouveau devis.'
}

/** La confirmation de la suppression d'un brouillon : elle le nomme par son client, sa date et son total. */
export function confirmationDeLaSuppressionDevis(d: Pick<Devis, 'tiers_nom' | 'date_emission' | 'montant_ttc'>): string {
  return `Supprimer le brouillon de devis pour « ${nomDansUnRefus(d.tiers_nom)} » du ${formatDate(d.date_emission)} `
    + `(${formatMoney(d.montant_ttc)} TTC) ? Ses lignes et ses notes partent avec lui ; cette action est irréversible.`
}

// ── Ce que les écrans de l'étape P6a2 jugent et disent ───────────────────────────────────────────────────────────────
// La réponse à un devis émis (`decider_devis`), la facture tirée d'un devis accepté (`facturer_devis`), et la liste qui dit
// cette facture et se cherche. Aucune règle dans l'écran : la réponse se juge ici, sur la saisie TELLE QU'ELLE PART.

/** La réponse telle que la fenêtre la saisit : un choix (vide tant qu'il n'est pas fait) et une date AAAA-MM-JJ. */
export interface SaisieReponseDevis {
  reponse: ReponseDevis | ''
  dateReponse: string
}

/**
 * Une acceptation datée APRÈS la fin de validité : la seule réponse dont la confirmation dit qu'elle renouvelle l'offre, et
 * la seule où `p_hors_validite` part à vrai — jamais pour un refus, jamais dans la validité.
 */
export function acceptationHorsValidite(devis: Pick<Devis, 'date_validite'>, s: SaisieReponseDevis): boolean {
  const date = dateDeLaBase(s.dateReponse)
  return s.reponse === 'acceptee' && date != null && date > devis.date_validite
}

/** Ce qui part vers `decider_devis` : la réponse, sa date, et la confirmation hors validité (vraie là seulement). */
export function decisionDeLaSaisie(devis: Pick<Devis, 'date_validite'>, s: SaisieReponseDevis): DecisionDevis {
  return {
    reponse: s.reponse === '' ? null : s.reponse,
    dateReponse: s.dateReponse === '' ? null : s.dateReponse,
    horsValidite: acceptationHorsValidite(devis, s),
  }
}

/**
 * Le refus de `decider_devis` sur la réponse TELLE QU'ELLE PART (`decisionDeLaSaisie`) : une acceptation hors validité part
 * confirmée — la confirmation le dit —, et son refus n'est donc jamais celui-là.
 */
export function refusDeLaReponse(
  dossierId: string,
  devis: Pick<Devis, 'dossier_id' | 'statut' | 'numero' | 'date_emission' | 'date_validite' | 'reponse' | 'date_reponse'>,
  s: SaisieReponseDevis,
  aujourdHui: string,
): string | null {
  return refusDecisionDevis(dossierId, devis, decisionDeLaSaisie(devis, s), aujourdHui)?.message ?? null
}

/** Ce que la fenêtre dit avant le clic d'une acceptation hors validité ; null sinon. */
export function avisHorsValidite(devis: Pick<Devis, 'date_validite'>, s: SaisieReponseDevis): string | null {
  if (!acceptationHorsValidite(devis, s)) return null
  return `Le devis n’était plus valable le ${formatDate(s.dateReponse)} : il l’était jusqu’au ${formatDate(devis.date_validite)}. `
    + 'L’accepter à cette date, c’est renouveler l’offre : la confirmation le redira.'
}

const nomDuDevis = (d: Pick<Devis, 'numero' | 'tiers_nom' | 'montant_ttc'>) =>
  `devis ${d.numero ?? ''} pour « ${nomDansUnRefus(d.tiers_nom)} » (${formatMoney(d.montant_ttc)} TTC)`

/**
 * La confirmation d'une réponse : elle nomme le devis, le client, la réponse et sa date — et, pour une acceptation datée
 * après la validité, dit que l'accepter renouvelle l'offre.
 */
export function confirmationDeLaReponse(
  devis: Pick<Devis, 'numero' | 'tiers_nom' | 'montant_ttc' | 'date_validite'>,
  s: SaisieReponseDevis & { reponse: ReponseDevis },
): string {
  const quoi = s.reponse === 'acceptee'
    ? `l’acceptation du ${nomDuDevis(devis)}, datée du ${formatDate(s.dateReponse)}`
    : `le refus du ${nomDuDevis(devis)}, daté du ${formatDate(s.dateReponse)}`
  const renouvelle = acceptationHorsValidite(devis, s)
    ? `Le devis ${devis.numero ?? ''} n’était plus valable le ${formatDate(s.dateReponse)} : il l’était jusqu’au `
      + `${formatDate(devis.date_validite)}. L’accepter à cette date, c’est RENOUVELER L’OFFRE : l’émetteur s’engage de nouveau `
      + 'aux prix et aux conditions du devis. '
    : ''
  const suite = s.reponse === 'acceptee' ? ' ; le devis accepté pourra ensuite se transformer en facture.' : '.'
  return `${renouvelle}Enregistrer ${quoi} ? La réponse ne changera plus${suite}`
}

/**
 * La première facture tirée d'un devis — par date du lien, puis identifiant, comme `facturer_devis` la nomme —, ou null.
 * `factures` : les factures lues du dossier ; une facture liée qu'on n'a pas lue se dit (`lue: false`), son numéro inconnu.
 */
export function factureDuDevis(
  devisId: string,
  liens: readonly Pick<DevisFacture, 'devis_id' | 'facture_id' | 'cree_le' | 'id'>[],
  factures: readonly { id: string; numero: string | null }[],
): { factureId: string; numero: string | null; lue: boolean } | null {
  const premier = liens
    .filter((l) => l.devis_id === devisId)
    .sort((a, b) => a.cree_le.localeCompare(b.cree_le) || a.id.localeCompare(b.id))[0]
  if (!premier) return null
  const f = factures.find((x) => x.id === premier.facture_id)
  return { factureId: premier.facture_id, numero: f?.numero ?? null, lue: f != null }
}

/** Ce que la liste dit de la facture tirée d'un devis : son numéro, ou « Brouillon de facture » tant qu'elle n'en a pas. */
export function libelleDeLaFactureTiree(f: { numero: string | null }): string {
  return f.numero ?? 'Brouillon de facture'
}

/**
 * La confirmation de la transformation en facture : ce qui part — un brouillon daté du jour, reprenant le client et ses
 * mentions, les lignes et les totaux, à l'émetteur du jour —, ce qui ne part pas, et le devis marqué facturé.
 */
export function confirmationDeLaFacturation(
  devis: Pick<Devis, 'numero' | 'tiers_nom' | 'montant_ttc' | 'lignes'>,
  aujourdHui: string,
): string {
  const n = devis.lignes.length
  return `Transformer le ${nomDuDevis(devis)} en facture ? Un BROUILLON de facture sera créé, daté du ${formatDate(aujourdHui)}, `
    + `reprenant le client et ses mentions, ${n === 1 ? 'la ligne' : `les ${n} lignes`} et les totaux du devis, à l’émetteur du `
    + 'jour — l’identité du dossier aujourd’hui, non celle que le devis imprime ; ni l’exécution prévue, ni les mentions '
    + 'légales, ni les notes du devis. Le devis sera marqué facturé ; le brouillon se relit, se complète et se valide comme '
    + 'toute facture.'
}

/** Ce qu'une recherche lit d'un devis : ce que sa ligne montre (numéro, date, client, objet, total, état, facture tirée). */
export function champsDeRechercheDuDevis(
  d: Pick<Devis, 'numero' | 'date_emission' | 'tiers_nom' | 'objet' | 'montant_ttc'>,
  etat: EtatDevis,
  factureTiree: { numero: string | null } | null,
): (string | number | null)[] {
  return [
    d.numero ?? 'Brouillon', d.date_emission, formatDate(d.date_emission), d.tiers_nom, d.objet, d.montant_ttc,
    LIBELLES_ETAT_DEVIS[etat], factureTiree ? libelleDeLaFactureTiree(factureTiree) : null,
  ]
}

// ── L'aperçu et l'impression (étape P6b) ────────────────────────────────────────────────────────────────────────────
// Le devis tel qu'il s'imprime, dans l'ordre que la migration fixe à ses textes (`TEXTES_IMPRIMES_DU_DEVIS`) : l'émetteur, le
// titre et les dates, le client, l'objet, les mentions (la livraison, le code service, le numéro d'engagement…), les lignes et
// les totaux, les conditions, les mentions légales, puis le bloc « Bon pour accord ». Ni les notes, ni l'adresse électronique
// du client, ni la réponse enregistrée : le papier est l'offre telle qu'émise, qui se signe — l'écran seul dit l'état.
//
// L'ÉMETTEUR : celui que le devis émis porte (posé par `enregistrer_devis` à l'émission, jamais relu du dossier) ; pour un
// brouillon, le dossier tel que la base le posera (`emetteurDuDevisEmis`), lu avec les devis — nul s'il n'a pas pu l'être, et
// le brouillon ne s'imprime pas. Un brouillon imprimé le DIT sur le papier : ce n'est pas encore une offre. Le numéro de TVA
// est celui que la facture imprimée porterait (`numeroTvaDuDevis`), au statut du dossier que l'onglet a lu. Le LOGO ne
// s'imprime pas : une facture ne l'imprime qu'une fois validée, vérifié à l'empreinte qu'elle a figée, et le devis ne fige
// aucun logo (sa migration ne le prévoit pas).
export interface LigneImprimeeDuDevis {
  designation: string
  quantite: number
  prixUnitaireHt: number
  tauxTva: number
  montantHt: number
  montantTtc: number
}

export interface ImpressionDuDevis {
  titre: string
  // La phrase qu'un brouillon imprime sous son titre ; nulle pour un devis émis.
  mentionBrouillon: string | null
  // La date du devis et sa validité, sous le titre.
  dates: string[]
  emetteur: { nom: string; siret: string | null; adresse: string | null }
  numeroTva: string | null
  client: { nom: string; adresse: string | null; siret: string | null }
  objet: string | null
  // Les mentions du devis, sans la validité (dans `dates`).
  mentions: MentionDevis[]
  lignes: LigneImprimeeDuDevis[]
  totaux: { ht: number; tva: number; ttc: number }
  conditions: string | null
  mentionsLegales: string | null
  bonPourAccord: string
}

export type ApercuDuDevis = { etat: 'pret'; impression: ImpressionDuDevis } | { etat: 'illisible'; motif: string }

export const TITRE_DU_BROUILLON = 'DEVIS — BROUILLON'
export const MENTION_BROUILLON_IMPRIMEE = 'Brouillon, non émis : ce document n’est pas encore une offre. Le devis prendra son '
  + 'numéro à son émission.'

const texteImprime = (t: string | null) => (t == null || t.trim() === '' ? null : t)

/** Ce que le devis imprime ; `emetteurDuDossier` : le dossier lu avec les devis, que seul un brouillon imprime (nul : non lu). */
export function ceQueLeDevisImprime(d: Devis, emetteurDuDossier: EmetteurDuDossier | null, dossier: DossierCii): ApercuDuDevis {
  const brouillon = d.statut === 'brouillon'
  let emetteur: ImpressionDuDevis['emetteur']
  if (brouillon) {
    if (emetteurDuDossier === null) {
      return { etat: 'illisible', motif: 'l’identité du dossier, que ce brouillon imprimerait comme émetteur, n’a pas pu être lue' }
    }
    emetteur = emetteurDuDevisEmis(emetteurDuDossier)
  } else {
    if (d.numero == null) return { etat: 'illisible', motif: 'ce devis émis ne porte pas son numéro' }
    if (d.emetteur_nom == null || d.emetteur_nom.trim() === '') {
      return { etat: 'illisible', motif: 'ce devis émis ne porte pas son émetteur' }
    }
    emetteur = { nom: d.emetteur_nom, siret: texteImprime(d.emetteur_siret), adresse: texteImprime(d.emetteur_adresse) }
  }
  return {
    etat: 'pret',
    impression: {
      titre: brouillon ? TITRE_DU_BROUILLON : `DEVIS ${d.numero}`,
      mentionBrouillon: brouillon ? MENTION_BROUILLON_IMPRIMEE : null,
      dates: [`Daté du ${formatDate(d.date_emission)}`, `${LIBELLE_VALIDITE} ${formatDate(d.date_validite)}`],
      emetteur,
      numeroTva: numeroTvaDuDevis({ emetteur_siret: emetteur.siret }, dossier),
      client: { nom: d.tiers_nom, adresse: texteImprime(d.tiers_adresse), siret: texteImprime(d.tiers_siret) },
      objet: texteImprime(d.objet),
      mentions: mentionsDuDevis(d).filter((m) => m.libelle !== LIBELLE_VALIDITE),
      lignes: d.lignes.map((l) => {
        const c = calculerLigne(l.quantite, l.prix_unitaire_ht, l.taux_tva)
        return {
          designation: l.designation, quantite: l.quantite, prixUnitaireHt: l.prix_unitaire_ht, tauxTva: l.taux_tva,
          montantHt: c.montant_ht, montantTtc: c.montant_ttc,
        }
      }),
      totaux: { ht: d.montant_ht, tva: d.montant_tva, ttc: d.montant_ttc },
      conditions: texteImprime(d.conditions),
      mentionsLegales: texteImprime(d.mentions_legales),
      bonPourAccord: BON_POUR_ACCORD,
    },
  }
}

/**
 * Ce que l'ÉCRAN dit au-dessus de l'aperçu et que le papier ne porte pas : l'état du devis, et ce qu'il change à ce qui
 * s'imprime. Aucun avis pour un devis émis encore en attente : il s'imprime tel qu'il part.
 */
export function avisDeLApercuDuDevis(d: Pick<Devis, 'date_validite' | 'date_reponse'>, etat: EtatDevis): string | null {
  const le = d.date_reponse ? ` le ${formatDate(d.date_reponse)}` : ''
  const papier = ' Le document reste l’offre telle qu’émise : la réponse ne s’y imprime pas.'
  switch (etat) {
    case 'brouillon':
      return 'Brouillon : ce devis n’est pas encore émis, et le document le dit. L’émetteur imprimé est l’identité du dossier '
        + 'aujourd’hui : c’est elle que le devis portera à son émission, si elle ne change pas d’ici là.'
    case 'en_attente':
      return null
    case 'expire':
      return `Ce devis n’est plus valable : il l’était jusqu’au ${formatDate(d.date_validite)}.`
    case 'accepte':
      return `Ce devis a été accepté${le}.${papier}`
    case 'refuse':
      return `Ce devis a été refusé${le}.${papier}`
    case 'facture':
      return `Ce devis a été accepté${le}, puis transformé en facture.${papier}`
  }
}

// ── L'envoi d'un devis émis par e-mail (étape P6c3) ──────────────────────────────────────────────────────────────────
// `send-email` (type « devis ») ne refuse que trois choses que l'écran sait avant le clic : une adresse absente ou mal formée, un
// devis introuvable dans le dossier, un brouillon. Les autres refus (plafond d'un accès client, droits, lecture) viennent de la
// fonction et se disent sous ses mots. Un devis EXPIRÉ, ayant reçu sa réponse ou déjà facturé n'est pas refusé : il part tel
// quel, et la confirmation le dit. Les mots valent pour les deux espaces (ni « tu » ni « vous », aucun onglet).

/**
 * La forme d'une adresse que `send-email` accepte (`EMAIL_REGEX`) : recopiée ici, et devis.test.ts la confronte au texte même
 * de la fonction — une règle changée là-bas ferait refuser ici une adresse que la fonction accepte, ou l'inverse.
 */
export const EMAIL_REGEX_DE_L_ENVOI = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Le refus d'un brouillon, aux mots de `send-email`. */
export const REFUS_ENVOI_BROUILLON = "Seul un devis émis s'envoie par e-mail : un brouillon n'est pas encore une offre."
/** Le refus d'une adresse mal formée, aux mots de `send-email`. */
export const REFUS_ENVOI_ADRESSE = 'Adresse e-mail du destinataire invalide.'
/** Le refus d'un devis hors du dossier, aux mots de `send-email`. */
export const REFUS_ENVOI_INTROUVABLE = 'Devis introuvable.'

/**
 * Ce que `send-email` refuserait pour ce devis et cette adresse, dans l'ordre de la fonction ; null quand elle enverrait.
 * L'adresse se juge TELLE QU'ELLE PART (sans ses blancs de bord). Une adresse absente se dit ici à l'écran : la fonction la
 * range avec les champs « requis ».
 */
export function refusDeLEnvoiDuDevis(
  dossierId: string,
  devis: Pick<Devis, 'dossier_id' | 'statut'> | null,
  destinataire: string,
): string | null {
  const adresse = destinataire.trim()
  if (adresse === '') return 'L’adresse du destinataire est à renseigner.'
  if (!EMAIL_REGEX_DE_L_ENVOI.test(adresse)) return REFUS_ENVOI_ADRESSE
  if (!devis || devis.dossier_id !== dossierId) return REFUS_ENVOI_INTROUVABLE
  if (devis.statut !== 'emis') return REFUS_ENVOI_BROUILLON
  return null
}

/**
 * Ce que la fenêtre et la confirmation disent d'un devis qui part malgré son état — sans rien refuser : sa validité a pris fin,
 * ou il a déjà sa réponse, ou sa facture. Aucun avis pour un devis émis encore en attente, ni pour un brouillon (qui ne part pas).
 */
export function avisDeLEnvoiDuDevis(d: Pick<Devis, 'date_validite' | 'date_reponse'>, etat: EtatDevis): string | null {
  const le = d.date_reponse ? ` le ${formatDate(d.date_reponse)}` : ''
  switch (etat) {
    case 'brouillon':
    case 'en_attente':
      return null
    case 'expire':
      return `Sa validité a pris fin le ${formatDate(d.date_validite)} ; il part tel quel.`
    case 'accepte':
      return `Ce devis a déjà reçu sa réponse : il a été accepté${le}. Il part tel quel, sans la réponse.`
    case 'refuse':
      return `Ce devis a déjà reçu sa réponse : il a été refusé${le}. Il part tel quel, sans la réponse.`
    case 'facture':
      return `Ce devis a déjà reçu sa réponse : il a été accepté${le}, puis transformé en facture. Il part tel quel, sans la réponse.`
  }
}

/**
 * La confirmation de l'envoi : elle nomme le devis (son numéro, son client, son total TTC), l'adresse du destinataire, ce qui
 * part et ce qui ne part pas — et, d'abord, l'avis d'un devis expiré, répondu ou facturé. Un e-mail parti ne se rattrape pas.
 */
export function confirmationDeLEnvoiDuDevis(
  d: Pick<Devis, 'numero' | 'tiers_nom' | 'montant_ttc' | 'date_validite' | 'date_reponse'>,
  etat: EtatDevis,
  destinataire: string,
): string {
  const avis = avisDeLEnvoiDuDevis(d, etat)
  return `${avis ? `${avis} ` : ''}Envoyer le ${nomDuDevis(d)} à ${destinataire.trim()} ? Le détail du devis (lignes, totaux, `
    + 'conditions, mentions légales) part dans le corps de l’e-mail, sans pièce jointe ; les notes et la réponse enregistrée '
    + 'n’y figurent pas. L’envoi est journalisé et ne se rappelle pas.'
}
