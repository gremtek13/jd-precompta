import { supabase } from './supabase'
import { extraireErreurFonction } from './invokeErreur'
import { messageErreur } from './messageErreur'
import { lireTout } from './lectureComplete'
import { slugify } from './format'
import { hashFichier } from './extraction'
import { chargerHashsExistants } from './importFichiers'
import { enregistrerTexteOcr } from './texteOcr'
import { enregistrerNoteInterne } from './notesInternes'
import { montantsPourPiece, type MontantsPourPiece } from './tauxChange'
import { retirerFichiers } from './stockage'
import {
  concordanceAvecLeDossier,
  confianceDeLaFacture,
  lireFactureXml,
  montantsDeLaFacture,
  texteDeLaFacture,
  tiersDeLaFacture,
  type FactureLue,
} from './factureElectronique'
import { xmlDuFacturX } from './factureX'
import { numeroAdmis } from './factureCii'
import type { CodeStatutRecu, EcartStatutRecu } from './cdarRecu'
import type { Piece } from './types'

// LA RÉCEPTION DES FACTURES PAR LA PLATEFORME AGRÉÉE DU CLIENT, CÔTÉ APPLICATION (ligne 28.5 de la feuille de route,
// étape b). La fonction serveur `plateforme-agreee` parle à la plateforme et REND ce qu'elle lit — la liste des
// factures, puis chaque document ; c'est l'application qui les importe, sur le clic du cabinet, chacune en pièce « à
// valider », comme un dépôt. Rien n'est validé ni catégorisé ici : une facture reçue est une pièce comme une autre,
// qu'un humain arbitre.
//
// CE QUI EMPÊCHE UNE FACTURE D'ENTRER DEUX FOIS, c'est son FLUX — l'hôte de la plateforme et l'identifiant qu'elle donne
// à la facture, uniques par dossier en base (`pieces_flux_unique`). Le point de reprise de la recherche n'est qu'une
// économie : il n'avance que sur ce qui est réellement traité (`pointDeReprise`), et une recherche qui repart trop tôt
// ne relit que des factures déjà là, que le plan écarte. L'empreinte du fichier écarte en plus une facture déjà déposée
// à la main.
//
// ET LA FACTURE DOIT DÉSIGNER LE DOSSIER. Une identité ouverte au cabinet peut servir plusieurs entreprises : une
// organisation mal configurée ferait entrer les factures d'un client dans le dossier d'un autre. Un achat qui nomme un
// autre acheteur, une vente qui nomme un autre vendeur, ne s'importe pas — et le cabinet, une fois la configuration ou
// le SIRET du dossier corrigé, peut reprendre la recherche du début.

// ── Ce que la fonction rend ───────────────────────────────────────────────────────────────────────────────────────

export type SensFlux = 'achat' | 'vente'

/** Une facture telle que la plateforme la décrit, lue et vérifiée par la fonction. */
export interface FluxVu {
  id: string
  sens: SensFlux
  syntaxe: string
  direction: 'In' | 'Out' | null
  nom: string | null
  recu_le: string | null
  mis_a_jour: string
  etat: 'pret' | 'en_attente' | 'en_erreur'
}

export interface FluxEcartes {
  autre_flux: number
  illisible: number
  format: number
  statut_inconnu: number
  doublons: number
}

export interface ListeFlux {
  hote: string
  /** La version de la connexion qui a listé : le téléchargement et le point de reprise s'y rapportent. */
  version: string
  depuis: string | null
  flux: FluxVu[]
  ecartes: FluxEcartes
  complete: boolean
  motif: string | null
  /** Le point de reprise que la lecture rend possible si toutes les factures listées sont traitées. */
  jusqua: string | null
}

export interface ConnexionPlateformeVue {
  nom: string
  url_flux: string
  url_jeton: string
  hote: string
  client_id: string
  organisation_id: string | null
  portee: string | null
  recherche_depuis: string | null
  derniere_recuperation: string | null
  /** Le point de reprise du relevé des statuts des factures émises (étape d7). */
  cycle_vie_depuis: string | null
  /** L'instant du dernier relevé allé au bout : tout ce que la plateforme rendait alors a été lu. */
  cycle_vie_lu_le: string | null
  created_at: string
  version: string
}

export interface DocumentTelecharge {
  hote: string
  flux: FluxVu
  document: 'original' | 'lisible'
  nature: 'pdf' | 'xml'
  octets: number
  contenu: string
}

// Un refus de la fonction porte parfois des DRAPEAUX à côté de sa phrase : `definitif` quand la facture ne s'importera
// jamais telle quelle (rejetée par la plateforme, introuvable, trop lourde, d'un format inattendu) — le point de reprise
// peut alors la dépasser —, `perimee` quand la connexion a changé depuis la liste, `acces_refuse` et
// `identifiants_refuses` quand la plateforme refuse l'identité ouverte au cabinet.
export interface DrapeauxPlateforme {
  definitif: boolean
  raison: string | null
  perimee: boolean
  acces_refuse: boolean
  identifiants_refuses: boolean
}

const SANS_DRAPEAU: DrapeauxPlateforme = {
  definitif: false, raison: null, perimee: false, acces_refuse: false, identifiants_refuses: false,
}

export type ReponsePlateforme<T> =
  | { donnees: T; erreur: null; drapeaux: DrapeauxPlateforme }
  | { donnees: null; erreur: string; drapeaux: DrapeauxPlateforme }

export async function appelerPlateforme<T>(corps: Record<string, unknown>, repli: string): Promise<ReponsePlateforme<T>> {
  const { data, error } = await supabase.functions.invoke<T>('plateforme-agreee', { body: corps })
  if (!error && data) return { donnees: data, erreur: null, drapeaux: SANS_DRAPEAU }
  // Le corps d'une réponse ne se lit qu'UNE fois : une COPIE pour les drapeaux, et l'original à `extraireErreurFonction`,
  // qui en tire la phrase (voir lib/invokeErreur.ts).
  const contexte = (error as { context?: unknown } | null)?.context
  const copie = contexte instanceof Response && !contexte.bodyUsed ? contexte.clone() : null
  const erreur = await extraireErreurFonction(error, repli)
  let drapeaux = SANS_DRAPEAU
  if (copie) {
    try {
      const c = (await copie.json()) as Record<string, unknown> | null
      drapeaux = {
        definitif: c?.definitif === true,
        raison: typeof c?.raison === 'string' ? c.raison : null,
        perimee: c?.perimee === true,
        acces_refuse: c?.acces_refuse === true,
        identifiants_refuses: c?.identifiants_refuses === true,
      }
    } catch {
      // Un corps qui n'est pas du JSON (délai de la plateforme Supabase) ne porte aucun drapeau.
    }
  }
  return { donnees: null, erreur, drapeaux }
}

export const lireConnexionPlateforme = (dossierId: string) =>
  appelerPlateforme<{ connexion: ConnexionPlateformeVue | null }>(
    { action: 'statut', dossierId }, 'La connexion à la plateforme du client n’a pas pu être lue.')

export interface SaisieConnexion {
  nom: string
  url_flux: string
  url_jeton: string
  client_id: string
  /** Vide pour garder le secret enregistré. */
  client_secret: string
  organisation_id: string
  portee: string
}

export const enregistrerConnexionPlateforme = (dossierId: string, saisie: SaisieConnexion) =>
  appelerPlateforme<{ connexion: ConnexionPlateformeVue | null }>(
    { action: 'enregistrer', dossierId, ...saisie }, 'La connexion n’a pas pu être enregistrée.')

export const retirerConnexionPlateforme = (dossierId: string) =>
  appelerPlateforme<{ ok: true }>({ action: 'retirer', dossierId }, 'La connexion n’a pas pu être retirée.')

export const testerConnexionPlateforme = (dossierId: string) =>
  appelerPlateforme<{ ok: true }>({ action: 'tester', dossierId }, 'La plateforme n’a pas pu être jointe.')

export const listerFlux = (dossierId: string) =>
  appelerPlateforme<ListeFlux>({ action: 'lister', dossierId }, 'Les factures de la plateforme n’ont pas pu être listées.')

// ── Le relevé des statuts des factures émises (ligne 28.5, étape d7) ──────────────────────────────────────────────
// La fonction lit, sur le clic, les statuts du cycle de vie des factures ÉMISES — un refus (210), un rejet (213), un
// litige, un paiement… — sur la plateforme du client, les rattache à une facture validée du dossier et les ÉCRIT elle-même
// (`statuts_factures_recus`), une fois par flux, puis avance son point de reprise : contrairement à la réception, rien
// n'est à importer par l'écran. Elle rend ce que chaque statut est devenu ; l'écran relit ensuite la table.

/** Ce que l'écran dit d'un message qui porte sur un autre statut (un 601), quand il concerne le dossier. */
export interface DetailStatutLu {
  reference: string
  date_objet: string | null
  motifs: string | null
  commentaire: string | null
}

/** Ce qu'un statut de la plateforme est devenu au relevé. */
export type IssueStatutLu =
  | { flux: string; issue: 'garde'; facture_id: string; code: CodeStatutRecu; avertissements: string[] }
  | { flux: string; issue: 'deja_lu' }
  | {
    flux: string; issue: 'ecarte'; ecart: EcartStatutRecu | 'introuvable' | 'trop_lourd' | 'refuse'; raison: string
    code: string | null; detail: DetailStatutLu | null
  }
  /** Un échec passager : le point de reprise s'arrête avant, et le relevé suivant le reprendra. */
  | { flux: string; issue: 'echec'; raison: string; statut_http: number | null }

export interface ReleveStatuts {
  hote: string
  version: string
  /** D'où le relevé est parti : le point de reprise lu, ou rien quand il a relu depuis le début. */
  depuis: string | null
  issues: IssueStatutLu[]
  ecartes: FluxEcartes
  en_attente: number
  en_erreur: number
  /** Les statuts prêts que le relevé n'a pas lus — le temps ou le nombre —, que le suivant lira. */
  reportes: number
  complete: boolean
  motif: string | null
  cycle_vie_depuis: string | null
  cycle_vie_lu_le: string | null
  /** Pourquoi le point de reprise n'a pas été enregistré : le relevé suivant relira ces statuts, et les reconnaîtra. */
  erreur_reprise: string | null
}

export const releverStatutsDesFactures = (dossierId: string, depuisLeDebut: boolean) =>
  appelerPlateforme<ReleveStatuts>(
    { action: 'relever', dossierId, depuisLeDebut }, 'Les statuts de la plateforme n’ont pas pu être lus.')

export const repartirDuDebut = (dossierId: string, version: string) =>
  appelerPlateforme<{ recherche_depuis: null }>(
    { action: 'repartir', dossierId, version }, 'La recherche n’a pas pu être remise au début.')

/**
 * La synchronisation Super PDP du même dossier (`superpdp-sync`, onglet Pièces) : configurée, une facture que la
 * plateforme du client rend aussi entrerait DEUX fois — les deux chemins ne se reconnaissent pas, l'un dédoublonne par
 * l'identifiant Super PDP, l'autre par le flux. Ne lit que la base (`superpdp-credentials`, action « status »). Illisible,
 * on ne sait pas : l'écran le dit au lieu de taire le risque.
 */
export async function lireSynchronisationSuperPdp(
  dossierId: string,
): Promise<{ configuree: boolean; erreur: null } | { configuree: null; erreur: string }> {
  const { data, error } = await supabase.functions.invoke<{ configured?: unknown }>('superpdp-credentials', {
    body: { dossierId, action: 'status' },
  })
  if (error || !data) {
    return { configuree: null, erreur: await extraireErreurFonction(error, 'La synchronisation Super PDP du dossier n’a pas pu être lue.') }
  }
  return { configuree: data.configured === true, erreur: null }
}

export const retenirPointDeReprise = (dossierId: string, version: string, jusqua: string | null) =>
  appelerPlateforme<{ recherche_depuis: string | null; derniere_recuperation: string }>(
    { action: 'retenir', dossierId, version, jusqua }, 'Le point de reprise n’a pas pu être enregistré.')

// ── Le plan ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** L'identité d'un flux dans un dossier : l'hôte de sa plateforme et son identifiant (une espace ne peut être ni dans
 * l'un ni dans l'autre). */
export const cleFlux = (hote: string, id: string) => `${hote} ${id}`

export interface PlanReception {
  /** Prêtes et pas encore dans le dossier. */
  aImporter: FluxVu[]
  dejaImportes: FluxVu[]
  /** La plateforme n'a pas fini de les traiter : elles reviendront, leur date de mise à jour changeant. */
  enAttente: FluxVu[]
  /** La plateforme les a rejetées : elles ne s'importent pas. */
  rejetes: FluxVu[]
}

export function planReception(liste: ListeFlux, importes: Set<string>): PlanReception {
  const plan: PlanReception = { aImporter: [], dejaImportes: [], enAttente: [], rejetes: [] }
  for (const flux of liste.flux) {
    if (importes.has(cleFlux(liste.hote, flux.id))) plan.dejaImportes.push(flux)
    else if (flux.etat === 'en_erreur') plan.rejetes.push(flux)
    else if (flux.etat === 'en_attente') plan.enAttente.push(flux)
    else plan.aImporter.push(flux)
  }
  return plan
}

/** Les flux déjà importés dans le dossier — lus EN ENTIER, ou la lecture le dit : le plan en dépend. */
export async function lireFluxImportes(dossierId: string): Promise<{ cles: Set<string>; complete: boolean; motif: string | null }> {
  const lecture = await lireTout<{ flux_hote: string | null; flux_id: string | null }>((debut, fin) =>
    supabase.from('pieces').select('flux_hote, flux_id', { count: 'exact' })
      .eq('dossier_id', dossierId).not('flux_id', 'is', null).order('id').range(debut, fin))
  const cles = new Set<string>()
  for (const p of lecture.lignes) if (p.flux_hote && p.flux_id) cles.add(cleFlux(p.flux_hote, p.flux_id))
  return { cles, complete: lecture.complete, motif: lecture.motif }
}

/**
 * Le plan d'un import, et les empreintes des fichiers déjà au dossier. Une lecture partielle de l'un ou de l'autre
 * SUSPEND l'import plutôt que de le laisser faire : une facture déjà importée qu'on n'aurait pas lue repartirait en
 * double — la base la refuserait par son flux, mais un fichier déposé à la main, lui, entrerait une seconde fois.
 */
export async function preparerReception(
  dossierId: string, liste: ListeFlux,
): Promise<{ plan: PlanReception; hashsConnus: Set<string> } | { refus: string }> {
  const importes = await lireFluxImportes(dossierId)
  if (!importes.complete) return { refus: `Les factures déjà importées n’ont pas pu être lues en entier (${importes.motif}).` }
  let hashsConnus: Set<string>
  try {
    hashsConnus = await chargerHashsExistants(dossierId)
  } catch (e) {
    return { refus: messageErreur(e, 'Les fichiers déjà au dossier n’ont pas pu être lus.') }
  }
  return { plan: planReception(liste, importes.cles), hashsConnus }
}

// ── L'import d'une facture ───────────────────────────────────────────────────────────────────────────────────────

export type IssueImport =
  /**
   * `noteNonGardee` : les remarques n'ont pas pu être écrites dans la note interne de la pièce, ET la pièce n'a pas pu
   * être retirée pour revenir à la recherche suivante — le cas rare où l'import dit les remarques une dernière fois, et
   * pourquoi elles ne sont pas sur la pièce. Absent quand tout s'est écrit.
   */
  | { statut: 'importee'; flux: FluxVu; pieceId: string; avertissements: string[]; noteNonGardee?: string }
  | { statut: 'deja_importee'; flux: FluxVu }
  /** Le même fichier est déjà au dossier (déposé à la main). */
  | { statut: 'doublon'; flux: FluxVu }
  /** La facture désigne une autre entreprise que le dossier. */
  | { statut: 'autre_entreprise'; flux: FluxVu; siren: string }
  | { statut: 'echec'; flux: FluxVu; definitif: boolean; message: string }
  /** La connexion a changé, ou la plateforme refuse l'identité : la suite de l'import n'a pas de sens. */
  | { statut: 'interrompu'; flux: FluxVu; raison: 'perimee' | 'acces'; message: string }

/** Ce qui est traité pour de bon : le point de reprise peut dépasser ces factures. */
export function estTermine(issue: IssueImport): boolean {
  if (issue.statut === 'echec') return issue.definitif
  return issue.statut !== 'interrompu'
}

export interface ContexteImport {
  dossierId: string
  userId: string
  /** La version de la connexion qui a listé les factures. */
  version: string
  hote: string
  /** Le SIREN du dossier : sans lui, rien ne vérifierait que les factures le désignent. */
  sirenDossier: string
  /** Les empreintes des fichiers déjà au dossier, complétées au fil de l'import. */
  hashsConnus: Set<string>
}

function octetsDuBase64(b64: string): Uint8Array<ArrayBuffer> | null {
  let binaire: string
  try {
    binaire = atob(b64)
  } catch {
    return null
  }
  const octets = new Uint8Array(binaire.length)
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i)
  return octets
}

type Telechargement =
  | { octets: Uint8Array<ArrayBuffer>; nature: 'pdf' | 'xml'; flux: FluxVu }
  | { issue: Extract<IssueImport, { statut: 'echec' | 'interrompu' }> }

async function telecharger(ctx: ContexteImport, flux: FluxVu, document: 'original' | 'lisible'): Promise<Telechargement> {
  const r = await appelerPlateforme<DocumentTelecharge>(
    { action: 'telecharger', dossierId: ctx.dossierId, version: ctx.version, flowId: flux.id, document },
    document === 'original' ? 'La facture n’a pas pu être téléchargée.' : 'Sa version lisible n’a pas pu être téléchargée.')
  if (r.erreur !== null) {
    if (r.drapeaux.perimee) return { issue: { statut: 'interrompu', flux, raison: 'perimee', message: r.erreur } }
    if (r.drapeaux.acces_refuse || r.drapeaux.identifiants_refuses) {
      return { issue: { statut: 'interrompu', flux, raison: 'acces', message: r.erreur } }
    }
    return { issue: { statut: 'echec', flux, definitif: r.drapeaux.definitif, message: r.erreur } }
  }
  // La réponse vient de notre fonction, mais un document se vérifie avant d'entrer dans le dossier : la facture
  // demandée, chez la plateforme qui l'a listée, et tous ses octets.
  const d = r.donnees
  const octets = typeof d.contenu === 'string' ? octetsDuBase64(d.contenu) : null
  if (d.hote !== ctx.hote || d.flux?.id !== flux.id || d.document !== document || !octets || octets.length === 0 ||
    octets.length !== d.octets ||
    (d.nature !== 'pdf' && d.nature !== 'xml')) {
    return { issue: { statut: 'echec', flux, definitif: false, message: 'Le document reçu ne correspond pas à la facture demandée.' } }
  }
  return { octets, nature: d.nature, flux: d.flux }
}

/** Le nom du fichier, avec l'extension de ce qu'il est : c'est elle qui décide de ce qu'une relecture en fera. */
export function nomDuFichier(flux: FluxVu, facture: FactureLue | null, nature: 'pdf' | 'xml'): string {
  const extension = `.${nature}`
  const base = (flux.nom ?? `facture ${facture?.numero ?? flux.id}`).trim()
  return base.toLowerCase().endsWith(extension) ? base : `${base}${extension}`
}

function texteUtf8(octets: Uint8Array): { xml: string } | { refus: string } {
  try {
    return { xml: new TextDecoder('utf-8', { fatal: true }).decode(octets) }
  } catch {
    return { refus: 'L’original n’est pas un texte UTF-8.' }
  }
}

/**
 * Ce que l'import a remarqué sur une facture, laissé dans la note interne de sa pièce (`notes_internes`, que le client
 * ne lit pas) : c'est dans sa fiche qu'on la valide, bien après que la fenêtre de l'import s'est refermée — une
 * remarque dite une fois puis jetée ne contrôle rien.
 */
export function notesDImport(avertissements: string[]): string | null {
  if (avertissements.length === 0) return null
  return `Reçue de la plateforme du client — à vérifier :\n${avertissements.map((a) => `- ${a}`).join('\n')}`
}

export type IdentiteDeLaPiece = Pick<Piece, 'identite_numero' | 'identite_siren_vendeur' | 'identite_date' | 'identite_nature'>

const SANS_IDENTITE: IdentiteDeLaPiece = {
  identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null,
}

/**
 * L'IDENTITÉ D'UNE VENTE REÇUE, telle que son original la dit (ligne 28.6) : son numéro, le SIREN de son vendeur, sa date
 * d'émission et sa nature — avec l'année, l'identité qu'une facture a pour l'administration (règle G1.42). Gardée sur la
 * pièce, c'est elle qui relie la vente qui revient de la plateforme à la facture que l'application a émise, quand la
 * plateforme ne la rend pas sous le flux du dépôt, ou que le client l'a déposée lui-même (lib/ventesJumelles.ts).
 * Rien pour un ACHAT : son vendeur est un tiers, et rien ne demande d'en garder le SIREN. Rien sans un numéro que la
 * règle G1.05 admet : un autre numéro n'est celui d'aucune facture émise par l'application, et la lecture a pu le couper
 * (255 caractères). Ce que l'original ne dit pas reste nul, jamais deviné.
 */
export function identiteDeLaVente(facture: FactureLue | null, sens: SensFlux): IdentiteDeLaPiece {
  if (sens !== 'vente' || facture === null || facture.numero === null || !numeroAdmis(facture.numero)) return SANS_IDENTITE
  return {
    identite_numero: facture.numero,
    identite_siren_vendeur: facture.vendeur.siren,
    identite_date: facture.date,
    identite_nature: facture.nature,
  }
}

const SANS_MONTANTS = (devise: string | null): MontantsPourPiece => ({
  montant_ht: null, montant_tva: null, montant_ttc: null,
  devise: devise ?? 'EUR', montant_devise: null, taux_change: null, conversion_source: null,
})

/**
 * Importe UNE facture listée : l'original, sa lecture, la vérification qu'elle désigne le dossier, sa version lisible
 * quand l'original est un XML, le dépôt des fichiers, la pièce « à valider », et le texte lu. Rien n'est déposé avant
 * que la facture ait été lue et reconnue pour celle du dossier ; un échec après le dépôt retire ce qui a été déposé.
 */
export async function importerFlux(ctx: ContexteImport, flux: FluxVu): Promise<IssueImport> {
  const original = await telecharger(ctx, flux, 'original')
  if ('issue' in original) return original.issue
  // Ce que la facture EST se relit dans la réponse — la fonction l'a relu chez la plateforme —, pas dans la liste.
  const confirme = original.flux

  const hash = await hashFichier(new Blob([original.octets]))
  if (ctx.hashsConnus.has(hash)) return { statut: 'doublon', flux }

  // Deux sortes de remarques : celles qui mettent en doute ce que la pièce reçoit (sa lecture, ses montants, son
  // destinataire) et abaissent sa confiance, et celles qui n'en disent rien (une version lisible manquante).
  const avertissements: string[] = []
  let douteuse = false
  let facture: FactureLue | null = null
  const xml = confirme.syntaxe === 'Factur-X' ? await xmlDuFacturX(original.octets) : texteUtf8(original.octets)
  if ('refus' in xml) {
    avertissements.push(`Facture illisible : ${xml.refus} Ses montants sont à saisir.`)
  } else {
    const lecture = lireFactureXml(xml.xml)
    if ('refus' in lecture) avertissements.push(`Facture illisible : ${lecture.refus} Ses montants sont à saisir.`)
    else facture = lecture.facture
  }

  if (facture) {
    const concordance = concordanceAvecLeDossier(facture, confirme.sens, ctx.sirenDossier)
    if (concordance.etat === 'autre') return { statut: 'autre_entreprise', flux, siren: concordance.siren }
    if (concordance.etat === 'inconnue') {
      douteuse = true
      avertissements.push(confirme.sens === 'achat'
        ? 'La facture ne dit pas le SIREN de son acheteur : rien ne vérifie qu’elle est adressée à ce dossier.'
        : 'La facture ne dit pas le SIREN de son vendeur : rien ne vérifie qu’elle est émise par ce dossier.')
    }
    const attendue = confirme.syntaxe === 'UBL' ? 'UBL' : 'CII'
    if (facture.syntaxe !== attendue) {
      douteuse = true
      avertissements.push(`La plateforme annonce une facture ${confirme.syntaxe}, le fichier est en ${facture.syntaxe}.`)
    }
    avertissements.push(...facture.anomalies)
  }

  // La version lisible d'un original XML. Indisponible pour de bon, la pièce s'importe sans elle — l'original et son
  // texte lu suffisent à l'arbitrer ; indisponible pour l'instant, la facture attend la récupération suivante.
  let lisible: Uint8Array<ArrayBuffer> | null = null
  if (confirme.syntaxe !== 'Factur-X') {
    const r = await telecharger(ctx, flux, 'lisible')
    if ('issue' in r) {
      if (r.issue.statut === 'interrompu' || !r.issue.definitif) return r.issue
      avertissements.push(`Sans version lisible : ${r.issue.message}`)
    } else if (r.nature !== 'pdf') {
      return { statut: 'echec', flux, definitif: false, message: 'La version lisible reçue n’est pas un PDF.' }
    } else {
      lisible = r.octets
    }
  }

  // Sans total TTC, aucun montant : une pièce sans total se voit et se complète, quand un hors taxes et une TVA seuls
  // laisseraient croire la pièce chiffrée.
  const montantsLus = facture ? montantsDeLaFacture(facture) : null
  const montants = montantsLus && montantsLus.devise !== null && montantsLus.montant_ttc !== null
    ? await montantsPourPiece({
      montant_ht: montantsLus.montant_ht, montant_tva: montantsLus.montant_tva, montant_ttc: montantsLus.montant_ttc,
      devise: montantsLus.devise,
    }, facture?.date ?? null)
    : SANS_MONTANTS(facture?.devise ?? null)

  const nomFichier = nomDuFichier(flux, facture, original.nature)
  const horodatage = Date.now()
  const chemin = `${ctx.dossierId}/${horodatage}-${slugify(nomFichier)}`
  const cheminLisible = lisible ? `${ctx.dossierId}/${horodatage}-${slugify(nomFichier.replace(/\.(xml|pdf)$/i, ''))}-lisible.pdf` : null
  // Un original XML se dépose en TEXTE : ouvert depuis le stockage, il s'affiche tel qu'il est au lieu d'être
  // interprété par le navigateur (une feuille de style XSLT déclarée dedans y serait exécutée).
  const type = original.nature === 'xml' ? 'text/plain; charset=utf-8' : 'application/pdf'
  const { error: erreurDepot } = await supabase.storage.from('pieces')
    .upload(chemin, new Blob([original.octets], { type }), { contentType: type, upsert: false })
  if (erreurDepot) {
    return { statut: 'echec', flux, definitif: false, message: messageErreur(erreurDepot, 'La facture n’a pas pu être déposée.') }
  }
  if (lisible && cheminLisible) {
    const { error: erreurLisible } = await supabase.storage.from('pieces')
      .upload(cheminLisible, new Blob([lisible], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: false })
    if (erreurLisible) {
      await retirerFichiers('pieces', [chemin], 'receptionPlateforme')
      return { statut: 'echec', flux, definitif: false, message: messageErreur(erreurLisible, 'Sa version lisible n’a pas pu être déposée.') }
    }
  }

  const { data, error } = await supabase.from('pieces').insert({
    dossier_id: ctx.dossierId,
    uploaded_by: ctx.userId,
    source: 'plateforme',
    storage_path: chemin,
    storage_hash: hash,
    nom_fichier: nomFichier,
    lisible_path: cheminLisible,
    flux_hote: ctx.hote,
    flux_id: flux.id,
    type_piece: confirme.sens,
    statut: 'a_valider',
    date_piece: facture?.date ?? null,
    tiers: facture ? tiersDeLaFacture(facture, confirme.sens) : null,
    ...montants,
    confiance: facture === null ? 'basse' : douteuse ? 'moyenne' : confianceDeLaFacture(facture),
    ...identiteDeLaVente(facture, confirme.sens),
  }).select('id').single()
  const fichiers = cheminLisible ? [chemin, cheminLisible] : [chemin]
  if (error || !data) {
    // Rien ne pointe sur les fichiers déposés : ils repartent, sinon ils resteraient orphelins jusqu'à la suppression du
    // dossier entier.
    await retirerFichiers('pieces', fichiers, 'receptionPlateforme')
    const code = (error as { code?: unknown } | null)?.code
    if (code === '23505' && /pieces_flux_unique/.test(messageErreur(error, ''))) return { statut: 'deja_importee', flux }
    return { statut: 'echec', flux, definitif: false, message: messageErreur(error, 'La pièce n’a pas pu être enregistrée.') }
  }
  const pieceId = data.id as string

  // Les remarques, dans la note interne de la pièce — une autre table que la pièce, que le client ne lit pas : deux
  // écritures, là où la colonne n'en demandait qu'une. Une pièce sans ses remarques serait validée sans le contrôle
  // qu'elles portent ; comme tout échec après le dépôt, celui-ci retire ce qui a été déposé, et la facture revient à la
  // recherche suivante. La ligne d'abord, les fichiers seulement si la base l'a RENDUE retirée (une suppression qui ne
  // touche rien n'est pas une erreur pour elle) ; sinon la pièce reste au dossier, importée comme les autres (son
  // empreinte retenue, son texte lu écrit), et l'issue dit ses remarques une dernière fois.
  let noteNonGardee: string | null = null
  const note = notesDImport(avertissements)
  if (note) {
    try {
      await enregistrerNoteInterne(ctx.dossierId, { type: 'piece', id: pieceId }, note)
    } catch (e) {
      const raison = messageErreur(e, 'La note interne n’a pas pu être enregistrée.')
      const { data: retiree, error: erreurRetrait } = await supabase.from('pieces').delete().eq('id', pieceId).select('id').maybeSingle()
      if (!erreurRetrait && retiree) {
        await retirerFichiers('pieces', fichiers, 'receptionPlateforme')
        return {
          statut: 'echec', flux, definitif: false,
          message: `Ses remarques n’ont pas pu être gardées dans sa note interne (${raison}) : elle n’est pas importée.`,
        }
      }
      noteNonGardee = raison
    }
  }
  ctx.hashsConnus.add(hash)
  if (facture) await enregistrerTexteOcr(ctx.dossierId, { type: 'piece', id: pieceId }, texteDeLaFacture(facture, confirme.sens))
  return noteNonGardee === null
    ? { statut: 'importee', flux, pieceId, avertissements }
    : { statut: 'importee', flux, pieceId, avertissements, noteNonGardee }
}

// ── Le point de reprise ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Le point d'où repartira la recherche suivante, une fois l'import fait. Tout traité : le point que la liste rend
 * possible. Sinon, la plus grande date de la liste STRICTEMENT antérieure à la première facture restée à faire — et
 * jamais au-delà de ce que la liste rend possible ; nul (le point actuel reste) quand aucune ne l'est. Les factures
 * en attente chez la plateforme ne retiennent rien : leur date de mise à jour changera quand elles seront prêtes.
 */
export function pointDeReprise(liste: ListeFlux, restees: FluxVu[]): string | null {
  const plafond = liste.jusqua
  if (plafond === null) return null
  if (restees.length === 0) return plafond
  const premiere = restees.reduce((min, f) => (f.mis_a_jour < min ? f.mis_a_jour : min), restees[0].mis_a_jour)
  let point: string | null = null
  for (const f of liste.flux) {
    if (f.mis_a_jour < premiere && f.mis_a_jour <= plafond && (point === null || f.mis_a_jour > point)) point = f.mis_a_jour
  }
  return point
}

export interface BilanReception {
  issues: IssueImport[]
  /** Le point de reprise enregistré ; nul quand il n'a pas bougé. */
  pointDeReprise: string | null
  /** Pourquoi le point de reprise n'a pas pu être enregistré : la récupération suivante relira ces factures, et les
   * reconnaîtra. */
  erreurReprise: string | null
  interruption: Extract<IssueImport, { statut: 'interrompu' }> | null
}

/**
 * Importe les factures du plan une à une, puis retient le point de reprise. Une interruption (connexion changée,
 * identité refusée) arrête l'import et ne retient rien : les factures non faites reviendront.
 */
export async function recevoirFactures(
  ctx: ContexteImport, liste: ListeFlux, plan: PlanReception, surProgres?: (faites: number, total: number) => void,
): Promise<BilanReception> {
  const issues: IssueImport[] = []
  for (const flux of plan.aImporter) {
    surProgres?.(issues.length, plan.aImporter.length)
    let issue: IssueImport
    try {
      issue = await importerFlux(ctx, flux)
    } catch (e) {
      issue = { statut: 'echec', flux, definitif: false, message: messageErreur(e, 'L’import de cette facture s’est interrompu.') }
    }
    issues.push(issue)
    if (issue.statut === 'interrompu') {
      return { issues, pointDeReprise: null, erreurReprise: null, interruption: issue }
    }
  }
  surProgres?.(issues.length, plan.aImporter.length)
  const terminees = new Set(issues.filter(estTermine).map((i) => i.flux.id))
  const jusqua = pointDeReprise(liste, plan.aImporter.filter((f) => !terminees.has(f.id)))
  const r = await retenirPointDeReprise(ctx.dossierId, ctx.version, jusqua)
  return {
    issues,
    pointDeReprise: r.erreur === null ? r.donnees.recherche_depuis : null,
    erreurReprise: r.erreur,
    interruption: null,
  }
}
