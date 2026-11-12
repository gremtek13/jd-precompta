import { CLAUSES, MISSIONS, etatDeLaLettre, lettresEnVigueur, type Clause, type LettreLue, type Mission } from './lettresDeMission'
import {
  contenuDuPdf, nomDuPdf, type BlocDuPdf, type IdentiteFigee, type LettreComplete, type LigneDHonoraires, type ModeleLu, type Tache,
} from './lettresDeMissionVue'
import { formatDate } from './format'

// LES LETTRES DE MISSION DANS L'ESPACE CLIENT (LM6, ligne 47). Le module PUR de « Mes lettres de mission » : la valeur que
// rend `lettres_de_mission_du_client` (supabase/preparees/20261112100000_lettres_du_client.sql), reconnue ENTIÈRE — une clé
// de plus ou de moins la rend illisible, rien n'en est deviné —, l'état de chaque lettre dit au client, la façon de
// l'accepter hors ligne (LM-Q10 : l'acceptation en ligne reste fermée, aucun geste n'écrit), et le PDF tiré des seules
// valeurs figées par la même mise en page que le cabinet (`contenuDuPdf`) : mêmes octets pour une même lettre, et rien ne
// se tire d'une lettre dont la base n'a pas retrouvé l'empreinte. Les mots tutoient (espace client), sans nom d'onglet.

/**
 * La migration `lettres_du_client` (LM6) : préparée, PAS appliquée ; elle suit LM1, B1 (la case « Documents ») et LM4.
 * Baissé, aucun écran ne s'offre ni ne lit. Le lever suit l'application de la migration (et de B1, dont la case l'ouvre).
 * Il se lève après celui des documents (B2, `DOCUMENTS_ET_DEMANDES_PREVUS`) : la case « Documents » dit les lettres à la
 * suite des documents, jamais seule (droitsAcces.test.ts tient cet ordre).
 * Un objet, pour que les tests jouent ses deux états sans recharger le module.
 */
export const DRAPEAU_DES_LETTRES_DU_CLIENT = { prevues: false }

export function lettresDuClientPrevues(): boolean {
  return DRAPEAU_DES_LETTRES_DU_CLIENT.prevues
}

/** « Mes lettres de mission » s'offre avec sa migration et la case « Documents » sur la société AFFICHÉE. */
export function lettresDuClientOuvertes(migrationEnBase: boolean, droitDocuments: boolean): boolean {
  return migrationEnBase && droitDocuments
}

export const FONCTION_DES_LETTRES_DU_CLIENT = 'lettres_de_mission_du_client'
export const PARAMETRE_DES_LETTRES_DU_CLIENT = 'p_dossier_id'
export const REFUS_DES_LETTRES_DU_CLIENT = { code: '42501', acces: 'Accès refusé à ce dossier.' } as const

export const CLES_DE_LA_VALEUR = ['dossier_du_cabinet_designe', 'lettres'] as const
/** Les vingt-six clés d'une lettre, dans l'ordre de la fonction ; la confrontation au texte de la migration les garde. */
export const CLES_D_UNE_LETTRE = [
  'id', 'remplace_id', 'missions', 'repartition', 'honoraires', 'date_effet', 'premier_exercice', 'fin_initiale',
  'reconduction_tacite', 'preavis_mois', 'signataire_nom', 'signataire_qualite', 'signataire_designe', 'identite_client',
  'identite_cabinet', 'clauses', 'modele', 'proposee_le', 'empreinte', 'empreinte_verifiee', 'acceptee_le',
  'mode_acceptation', 'signee_le', 'refusee_le', 'retiree_le', 'fin_au',
] as const
export const CLES_DU_MODELE = ['id', 'titre', 'conditions_generales', 'missions', 'clauses'] as const

/** Une lettre proposée au client, telle que la base l'a figée. */
export interface LettreDuClient {
  id: string
  remplace_id: string | null
  missions: Mission[]
  repartition: Tache[]
  honoraires: LigneDHonoraires[]
  date_effet: string
  premier_exercice: number
  fin_initiale: string
  reconduction_tacite: boolean
  preavis_mois: number
  signataire_nom: string
  signataire_qualite: string
  signataire_designe: boolean
  identite_client: IdentiteFigee
  identite_cabinet: IdentiteFigee & { cabinet?: string | null }
  clauses: Clause[]
  modele: ModeleLu
  proposee_le: string
  empreinte: string
  empreinte_verifiee: boolean
  acceptee_le: string | null
  mode_acceptation: 'en_ligne' | 'papier' | null
  signee_le: string | null
  refusee_le: string | null
  retiree_le: string | null
  fin_au: string | null
}

export interface LettresDuClient { dossierDuCabinetDesigne: boolean; lettres: LettreDuClient[] }

const estObjet = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const memesCles = (o: Record<string, unknown>, cles: readonly string[]) => {
  const k = Object.keys(o)
  return k.length === cles.length && cles.every((c) => Object.prototype.hasOwnProperty.call(o, c))
}
const texte = (v: unknown): v is string => typeof v === 'string'
const texteOuNul = (v: unknown): v is string | null => v === null || typeof v === 'string'
const jour = (v: unknown): v is string => texte(v) && /^\d{4}-\d{2}-\d{2}$/.test(v)
const jourOuNul = (v: unknown): v is string | null => v === null || jour(v)
const instant = (v: unknown): v is string => texte(v) && !Number.isNaN(Date.parse(v))
const instantOuNul = (v: unknown): v is string | null => v === null || instant(v)
const entier = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const dictionnaireDeTextes = (v: unknown) => estObjet(v) && Object.values(v).every(texte)

function modeleRendu(v: unknown): ModeleLu | null {
  if (!estObjet(v) || !memesCles(v, CLES_DU_MODELE)) return null
  if (!texte(v.id) || !texte(v.titre) || !texte(v.conditions_generales) || !dictionnaireDeTextes(v.missions)
    || !dictionnaireDeTextes(v.clauses)) return null
  return {
    id: v.id, titre: v.titre, conditions_generales: v.conditions_generales,
    missions: v.missions as ModeleLu['missions'], clauses: v.clauses as ModeleLu['clauses'],
    // Ce que le client ne lit pas du modèle : sans objet pour le PDF, qui n'en tire rien.
    remplace_id: null, cree_le: '', retire_le: null,
  }
}

function honorairesRendus(v: unknown): v is LigneDHonoraires[] {
  return Array.isArray(v) && v.every((h) => estObjet(h) && texte(h.forme) && ['forfait', 'tache', 'temps'].includes(h.forme)
    && texte(h.libelle) && typeof h.montant_ht === 'number' && Number.isFinite(h.montant_ht))
}

function lettreRendue(v: unknown): LettreDuClient | null {
  if (!estObjet(v) || !memesCles(v, CLES_D_UNE_LETTRE)) return null
  const modele = modeleRendu(v.modele)
  if (modele === null || !texte(v.id) || !texteOuNul(v.remplace_id)
    || !Array.isArray(v.missions) || !v.missions.every((m) => (MISSIONS as readonly unknown[]).includes(m))
    || !Array.isArray(v.repartition) || !v.repartition.every((t) => estObjet(t) && texte(t.tache) && (t.par === 'cabinet' || t.par === 'client'))
    || !honorairesRendus(v.honoraires)
    || !jour(v.date_effet) || !entier(v.premier_exercice) || !jour(v.fin_initiale) || typeof v.reconduction_tacite !== 'boolean'
    || !entier(v.preavis_mois) || !texte(v.signataire_nom) || !texte(v.signataire_qualite) || typeof v.signataire_designe !== 'boolean'
    || !estObjet(v.identite_client) || !estObjet(v.identite_cabinet)
    || !Array.isArray(v.clauses) || !v.clauses.every((c) => (CLAUSES as readonly unknown[]).includes(c))
    || !instant(v.proposee_le) || !texte(v.empreinte) || !/^[0-9a-f]{64}$/.test(v.empreinte) || typeof v.empreinte_verifiee !== 'boolean'
    || !instantOuNul(v.acceptee_le) || !(v.mode_acceptation === null || v.mode_acceptation === 'papier' || v.mode_acceptation === 'en_ligne')
    || !jourOuNul(v.signee_le) || !instantOuNul(v.refusee_le) || !instantOuNul(v.retiree_le) || !jourOuNul(v.fin_au)) return null
  // Du modèle, la fonction ne rend que le texte des missions et des clauses de CETTE lettre (relecture de sécurité du
  // 12/11/2026) : un texte de plus est celui d'une autre lettre, et la valeur ne se lit pas.
  const missions: readonly unknown[] = v.missions
  const clauses: readonly unknown[] = v.clauses
  if (!Object.keys(modele.missions).every((m) => missions.includes(m))
    || !Object.keys(modele.clauses).every((c) => clauses.includes(c))) return null
  return { ...(v as unknown as LettreDuClient), modele }
}

/**
 * La valeur ENTIÈRE, ou null : une clé de plus (d'honoraires d'un autre, d'un auteur, du texte d'une mission ou d'une clause
 * que la lettre ne porte pas…) ou de moins ne se lit pas.
 */
export function lettresDuClientRendues(rendu: unknown): LettresDuClient | null {
  if (!estObjet(rendu) || !memesCles(rendu, CLES_DE_LA_VALEUR)) return null
  if (typeof rendu.dossier_du_cabinet_designe !== 'boolean' || !Array.isArray(rendu.lettres)) return null
  const lettres = rendu.lettres.map(lettreRendue)
  if (lettres.some((l) => l === null)) return null
  if (!rendu.dossier_du_cabinet_designe && lettres.length > 0) return null
  return { dossierDuCabinetDesigne: rendu.dossier_du_cabinet_designe, lettres: lettres as LettreDuClient[] }
}

// ── L'état dit au client ────────────────────────────────────────────────────────────────────────────────────────────

export type EtatPourLeClient =
  | 'proposee' | 'remplacee' | 'en_vigueur' | 'a_venir' | 'echue' | 'refusee' | 'retiree' | 'resiliee'

const commeLue = (l: LettreDuClient, dossierId: string): LettreLue => ({
  id: l.id, remplace_id: l.remplace_id, dossier_client_id: dossierId, date_effet: l.date_effet, fin_initiale: l.fin_initiale,
  reconduction_tacite: l.reconduction_tacite, proposee_le: l.proposee_le, acceptee_le: l.acceptee_le, refusee_le: l.refusee_le,
  retiree_le: l.retiree_le, fin_au: l.fin_au,
})

/**
 * L'état d'une lettre, DÉDUIT comme au cabinet (`etatDeLaLettre`, `lettresEnVigueur`) sur les lettres lues EN ENTIER, plus
 * ce que le client doit savoir : une proposition sans réponse dont une version plus récente lui a été proposée est
 * « remplacée » (c'est la plus récente qui se signe) ; une lettre acceptée hors des lettres en vigueur l'est par un avenant
 * accepté (« remplacée »), ou n'a pas encore pris effet (« à venir »). `aujourdhui` : la date civile que l'écran lit.
 */
export function etatPourLeClient(l: LettreDuClient, toutes: readonly LettreDuClient[], aujourdhui: string): EtatPourLeClient {
  const lues = toutes.map((x) => commeLue(x, 'dossier'))
  const etat = etatDeLaLettre(commeLue(l, 'dossier'), aujourdhui)
  if (etat === 'proposee') {
    return toutes.some((s) => s.remplace_id === l.id && s.refusee_le === null && s.retiree_le === null) ? 'remplacee' : 'proposee'
  }
  if (etat === 'acceptee') {
    if (l.date_effet > aujourdhui) return 'a_venir'
    return lettresEnVigueur(lues, 'dossier', aujourdhui).some((x) => x.id === l.id) ? 'en_vigueur' : 'remplacee'
  }
  return etat === 'brouillon' ? 'proposee' : etat
}

/** L'état en mots, avec ses dates. */
export function etatEnMots(l: LettreDuClient, etat: EtatPourLeClient): string {
  const acceptee = l.acceptee_le === null ? ''
    : l.mode_acceptation === 'papier' && l.signee_le !== null ? `acceptée sur papier, signée le ${formatDate(l.signee_le)}`
      : `acceptée le ${formatDate(l.acceptee_le)}`
  switch (etat) {
    case 'proposee': return `Proposée le ${formatDate(l.proposee_le)}, en attente de ta réponse`
    case 'remplacee': return l.acceptee_le === null
      ? 'Remplacée par une version plus récente, que ton cabinet t’a proposée'
      : `Remplacée par un avenant (${acceptee})`
    case 'en_vigueur': return `En vigueur depuis le ${formatDate(l.date_effet)} (${acceptee})`
    case 'a_venir': return `Prendra effet le ${formatDate(l.date_effet)} (${acceptee})`
    case 'echue': return `Échue le ${formatDate(l.fin_initiale)}, sans reconduction tacite`
    case 'refusee': return `Refusée le ${formatDate(l.refusee_le ?? '')}`
    case 'retiree': return `Retirée par ton cabinet le ${formatDate(l.retiree_le ?? '')}`
    case 'resiliee': return `Résiliée au ${formatDate(l.fin_au ?? '')}`
  }
}

/**
 * Comment accepter, HORS LIGNE (LM-Q10, « le demander à l'expert » : l'acceptation en ligne reste fermée et aucun bouton
 * n'écrit). Dit sous une lettre proposée, et à qui la signe.
 */
export const COMMENT_ACCEPTER =
  'L’acceptation en ligne n’est pas encore ouverte. Pour accepter cette lettre, télécharge-la, signe-la et remets-la à ton '
  + 'cabinet : il l’enregistre, et elle s’affiche ici comme acceptée. Pour la refuser ou en discuter, parles-en à ton cabinet.'

export function quiSigne(l: Pick<LettreDuClient, 'signataire_designe' | 'signataire_nom' | 'signataire_qualite'>): string {
  return l.signataire_designe
    ? 'Ton cabinet t’a désigné pour la signer.'
    : `Elle est à signer par ${l.signataire_nom}, ${l.signataire_qualite}.`
}

// ── Le PDF ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export const REFUS_DU_PDF_SANS_EMPREINTE =
  'Cette lettre ne répond plus à l’empreinte calculée à sa proposition : elle ne se télécharge pas d’ici. Parles-en à ton cabinet.'

/**
 * Ce que le PDF imprime, par la mise en page du cabinet (`contenuDuPdf`), des seules valeurs figées ; jamais d'une lettre
 * dont la base n'a pas retrouvé l'empreinte (`empreinte_verifiee`). Ce que le client ne lit pas (le compte du signataire,
 * le papier signé, les auteurs) n'entre pas dans le PDF.
 */
export function pdfDeLaLettreDuClient(l: LettreDuClient):
  | { ok: true; blocs: BlocDuPdf[]; empreinte: string; instant: string; nom: string }
  | { ok: false; message: string } {
  if (!l.empreinte_verifiee) return { ok: false, message: REFUS_DU_PDF_SANS_EMPREINTE }
  const complete: LettreComplete = {
    ...commeLue(l, 'dossier'), modele_id: l.modele.id, missions: l.missions, repartition: l.repartition, honoraires: l.honoraires,
    premier_exercice: l.premier_exercice, preavis_mois: l.preavis_mois, signataire_nom: l.signataire_nom,
    signataire_qualite: l.signataire_qualite, signataire_compte: null, modifiee_le: l.proposee_le, identite_client: l.identite_client,
    identite_cabinet: l.identite_cabinet, clauses: l.clauses, empreinte: l.empreinte, mode_acceptation: l.mode_acceptation,
    document_signe_id: null, empreinte_papier: null, signee_le: l.signee_le, cree_le: l.proposee_le,
  }
  const blocs = contenuDuPdf(complete, l.modele)
  if (blocs === null) return { ok: false, message: REFUS_DU_PDF_SANS_EMPREINTE }
  return { ok: true, blocs, empreinte: l.empreinte, instant: l.proposee_le, nom: nomDuPdf(complete) }
}
