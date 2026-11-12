import { DOCUMENTS_ET_DEMANDES_PREVUS } from './documentsEtDemandes'
import { ORIGINAUX_DES_IMPORTS_PREVUS } from './bornesStockage'
import {
  cheminDuDossier, compterLesLignes, confronterLeManifeste, inventaireDuDossier, manifesteDeLaCopie, MANIFESTE_AU_PLUS,
  MOTIF_HORS_DU_DOSSIER, NOM_DU_MANIFESTE, relireUnFichier, sha256Hex,
  type CopieAAttester, type CopieEnregistree, type DocumentDeLaCopie, type DocumentDuCabinetDeLaCopie, type DossierDeLaCopie,
  type FichierACopier, type FichierLu, type LectureDesCopies, type LigneDuManifeste, type OriginalDeLaCopie, type PieceDeLaCopie,
} from './copieDesFichiers'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'
import { EcrivainZip, type SortieDuZip } from './zipEnFlux'

// LA COPIE DES FICHIERS (INAL6) : les lectures, les téléchargements, l'écriture du ZIP, l'enregistrement et l'attestation.
// Ce qui se décide (l'inventaire, les noms, la relecture, le manifeste, sa confrontation, le rappel) vit dans
// lib/copieDesFichiers.ts, pur ; le format du ZIP dans lib/zipEnFlux.ts.
//
// L'ordre (CFC-Q1 (B), un seul ZIP) : TOUS les inventaires d'abord (chaque dossier du cabinet, chaque table lue en entier) —
// une lecture partielle, et rien ne s'écrit ; puis, dossier après dossier, chaque fichier téléchargé, relu, écrit dans LE
// ZIP et oublié (la mémoire n'en garde qu'un à la fois, plus ce que la sortie garde : rien sur le disque, tout en mémoire) ;
// le manifeste en dernier ; la copie enregistrée par `enregistrer_copie_des_fichiers`, qui refuse une copie qui ne couvre
// pas tous les dossiers. Elle n'est FAITE qu'au manifeste rechargé (CFC-Q2 (B), `attesterLaCopie`).

/** Où va le ZIP : le fichier que le chef a choisi, ou la mémoire du navigateur ; son plafond. */
export interface SortieDeLaCopie extends SortieDuZip {
  /** Le ZIP est complet : le fichier se ferme, ou le navigateur le reçoit. */
  terminer: () => Promise<void>
  /** La copie s'arrête : rien ne reste (le fichier choisi n'est pas écrit, la mémoire se libère). Ne lève jamais. */
  abandonner: () => Promise<void>
  /** Le plus gros ZIP que cette sortie reçoit. */
  plafond: number
}

export interface Dependances {
  sortie: SortieDeLaCopie
  /** L'instant de la fabrication. */
  maintenant: () => Date
  /** L'identifiant de la copie (crypto.randomUUID), écrit dans le manifeste avant l'enregistrement. */
  identifiant: () => string
  /** L'avancement, pour l'écran. */
  avancement?: (texte: string) => void
}

export interface BilanDeLaCopie {
  copieId: string
  dossiers: number
  fichiers: number
  verifies: number
  ecarts: number
  nonVerifies: number
  manquants: number
  /** Les octets des fichiers copiés. */
  octets: number
  /** La taille du ZIP. */
  octetsDuZip: number
  /** La répartition, dite : « Dossier X : 12 fichier(s) ». */
  repartition: string[]
  /** null si la copie s'est enregistrée ; sinon le refus de la base, en clair (le ZIP est parti quand même). */
  enregistrementRefuse: string | null
}

export type IssueDeLaCopie = { ok: true; bilan: BilanDeLaCopie } | { ok: false; message: string }

class LecturePartielle {
  readonly message: string
  constructor(message: string) { this.message = message }
}

function partielle(quoi: string, motif: string | null): LecturePartielle {
  return new LecturePartielle(`${quoi} n’ont pas pu être lus en entier (${motif ?? 'lecture incomplète'})`)
}

async function lireLesSources(dossierId: string) {
  const lecturePieces = await lireTout<PieceDeLaCopie>((debut, fin) =>
    supabase.from('pieces').select('id, date_piece, created_at, storage_path, storage_hash, lisible_path', { count: 'exact' })
      .eq('dossier_id', dossierId).order('id').range(debut, fin))
  if (!lecturePieces.complete) throw partielle('les pièces', lecturePieces.motif)
  const lectureDocuments = await lireTout<DocumentDeLaCopie>((debut, fin) =>
    supabase.from('documents_divers').select('id, created_at, storage_path, storage_hash', { count: 'exact' })
      .eq('dossier_id', dossierId).order('id').range(debut, fin))
  if (!lectureDocuments.complete) throw partielle('les documents', lectureDocuments.motif)
  const originaux: OriginalDeLaCopie[] = []
  if (ORIGINAUX_DES_IMPORTS_PREVUS) {
    const lectureImports = await lireTout<OriginalDeLaCopie>((debut, fin) =>
      supabase.from('imports_factures').select('id, fichier_chemin, fichier_sha256', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin))
    if (!lectureImports.complete) throw partielle('les imports de factures', lectureImports.motif)
    const lectureReprises = await lireTout<{ facture_id: string; fichier_chemin: string | null; fichier_sha256: string | null }>((debut, fin) =>
      supabase.from('factures_importees').select('facture_id, fichier_chemin, fichier_sha256', { count: 'exact' })
        .eq('dossier_id', dossierId).order('facture_id').range(debut, fin))
    if (!lectureReprises.complete) throw partielle('les factures reprises', lectureReprises.motif)
    originaux.push(...lectureImports.lignes,
      ...lectureReprises.lignes.map((f) => ({ id: f.facture_id, fichier_chemin: f.fichier_chemin, fichier_sha256: f.fichier_sha256 })))
  }
  const documentsDuCabinet: DocumentDuCabinetDeLaCopie[] = []
  if (DOCUMENTS_ET_DEMANDES_PREVUS) {
    const lectureDuCabinet = await lireTout<DocumentDuCabinetDeLaCopie>((debut, fin) =>
      supabase.from('documents_cabinet').select('id, chemin, sha256, type_mime', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin))
    if (!lectureDuCabinet.complete) throw partielle('les documents du cabinet', lectureDuCabinet.motif)
    documentsDuCabinet.push(...lectureDuCabinet.lignes)
  }
  return inventaireDuDossier({ dossierId, pieces: lecturePieces.lignes, documents: lectureDocuments.lignes, originaux, documentsDuCabinet })
}

type Inventaires = { dossier: DossierDeLaCopie; fichiers: FichierACopier[] }[]

/** Tous les inventaires, en entier, ou un message. Ne lève jamais. */
async function lireLesInventaires(cabinetId: string, avancement?: (texte: string) => void): Promise<{ ok: true; inventaires: Inventaires } | { ok: false; message: string }> {
  try {
    const lectureDossiers = await lireTout<DossierDeLaCopie>((debut, fin) =>
      supabase.from('dossiers').select('id, nom, siret', { count: 'exact' })
        .eq('cabinet_id', cabinetId).order('id').range(debut, fin))
    if (!lectureDossiers.complete) throw partielle('les dossiers du cabinet', lectureDossiers.motif)
    if (lectureDossiers.lignes.length === 0) return { ok: false, message: 'Aucune copie : le cabinet n’a aucun dossier.' }
    const inventaires: Inventaires = []
    for (const dossier of lectureDossiers.lignes) {
      avancement?.(`Inventaire de « ${dossier.nom} »…`)
      inventaires.push({ dossier, fichiers: await lireLesSources(dossier.id) })
    }
    return { ok: true, inventaires }
  } catch (e) {
    const message = e instanceof LecturePartielle ? e.message : messageErreur(e, 'la lecture a échoué')
    return { ok: false, message: `Aucune copie, aucun ZIP : ${message}. Relancer la copie.` }
  }
}

// ── Avant le clic : le volume ───────────────────────────────────────────────────────────────────────────────────────

export interface Preparation {
  dossiers: number
  fichiers: number
  /** Les octets que le stockage dit, des fichiers dont il dit la taille. */
  octets: number
  /** Les fichiers dont la taille n'a pas pu être lue (le volume est alors un minimum). */
  tailleInconnue: number
}

const TAILLE_PAGE = 1000

/**
 * Le volume de la copie, dit AVANT le clic (CFC-Q1) : la taille que le stockage rend de chaque fichier de l'inventaire, lue
 * répertoire par répertoire (`list`, paginé), sans rien télécharger. Un chemin hors de son dossier ne se demande pas.
 */
export async function preparerLaCopie(cabinetId: string, avancement?: (texte: string) => void): Promise<{ ok: true; preparation: Preparation } | { ok: false; message: string }> {
  const lus = await lireLesInventaires(cabinetId, avancement)
  if (!lus.ok) return lus
  const parRepertoire = new Map<string, { seau: FichierACopier['seau']; repertoire: string; chemins: Set<string> }>()
  let fichiers = 0
  for (const { dossier, fichiers: liste } of lus.inventaires) {
    for (const f of liste) {
      fichiers++
      if (f.horsDuDossier || !cheminDuDossier(f.chemin, dossier.id)) continue
      const repertoire = f.chemin.slice(0, f.chemin.lastIndexOf('/'))
      const cle = `${f.seau}\u0000${repertoire}`
      const groupe = parRepertoire.get(cle) ?? { seau: f.seau, repertoire, chemins: new Set<string>() }
      groupe.chemins.add(f.chemin)
      parRepertoire.set(cle, groupe)
    }
  }
  let octets = 0
  let connus = 0
  for (const { seau, repertoire, chemins } of parRepertoire.values()) {
    avancement?.('Mesure du volume…')
    try {
      for (let offset = 0; ; offset += TAILLE_PAGE) {
        const { data, error } = await supabase.storage.from(seau).list(repertoire, { limit: TAILLE_PAGE, offset, sortBy: { column: 'name', order: 'asc' } })
        if (error || !data) break
        for (const o of data) {
          const taille = Number((o.metadata as { size?: unknown } | null)?.size)
          if (chemins.has(`${repertoire}/${o.name}`) && Number.isFinite(taille) && taille >= 0) { octets += taille; connus++ }
        }
        if (data.length < TAILLE_PAGE) break
      }
    } catch {
      // Une page qui lève : ce répertoire reste « taille inconnue ».
    }
  }
  return { ok: true, preparation: { dossiers: lus.inventaires.length, fichiers, octets, tailleInconnue: fichiers - connus } }
}

// ── La copie ─────────────────────────────────────────────────────────────────────────────────────────────────────────

// Le motif d'un fichier que le stockage ne rend pas, au manifeste : jamais le message du stockage, qui peut recopier le
// chemin demandé (« Invalid key: … »), donc le nom déposé ; son statut seul (relecture de sécurité du 12/11/2026).
function motifDuStockage(error: unknown): string {
  const e = error !== null && typeof error === 'object' ? (error as { status?: unknown; statusCode?: unknown }) : null
  const statut = String(e?.status ?? e?.statusCode ?? '')
  return /^\d{3}$/.test(statut) ? `le stockage ne l’a pas rendu (${statut})` : 'le stockage ne l’a pas rendu'
}

async function telechargerUnFichier(f: FichierACopier): Promise<FichierLu> {
  // Un chemin hors du dossier ne se demande pas au stockage : le chef lirait le fichier d'un autre dossier.
  if (f.horsDuDossier) return { fichier: f, octets: null, motif: MOTIF_HORS_DU_DOSSIER }
  try {
    const { data, error } = await supabase.storage.from(f.seau).download(f.chemin)
    if (error || !data) return { fichier: f, octets: null, motif: motifDuStockage(error) }
    return { fichier: f, octets: new Uint8Array(await data.arrayBuffer()) }
  } catch {
    return { fichier: f, octets: null, motif: 'le téléchargement a échoué' }
  }
}

function mio(octets: number): string {
  return `${(octets / 1024 / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mio`
}

class PlafondAtteint {
  readonly message: string
  constructor(message: string) { this.message = message }
}

/** La copie entière des fichiers des dossiers d'un cabinet, en UN ZIP. Ne lève jamais : une issue refusée porte son message. */
export async function copierLesFichiersDuCabinet(cabinetId: string, dep: Dependances): Promise<IssueDeLaCopie> {
  // 1. Les dossiers et leurs inventaires, en entier, avant toute écriture.
  const lus = await lireLesInventaires(cabinetId, dep.avancement)
  if (!lus.ok) {
    await dep.sortie.abandonner()
    return lus
  }

  // 2. Dossier après dossier, chaque fichier relu et écrit ; le manifeste en dernier.
  const fabriqueLe = dep.maintenant()
  const copieId = dep.identifiant()
  const zip = new EcrivainZip(dep.sortie, fabriqueLe)
  const parDossier: { dossier: DossierDeLaCopie; lignes: LigneDuManifeste[] }[] = []
  let empreinte = ''
  try {
    for (const { dossier, fichiers } of lus.inventaires) {
      const lignes: LigneDuManifeste[] = []
      for (const [i, f] of fichiers.entries()) {
        dep.avancement?.(`« ${dossier.nom} » : fichier ${i + 1} sur ${fichiers.length}…`)
        const { ligne, octets } = await relireUnFichier(dossier, await telechargerUnFichier(f))
        if (octets !== null) {
          if (zip.depasserait(ligne.nom, octets.length, dep.sortie.plafond)) {
            throw new PlafondAtteint(`la copie passerait ${mio(dep.sortie.plafond)}, le plus gros ZIP que ce navigateur fabrique ici`)
          }
          await zip.ajouter(ligne.nom, octets)
        }
        lignes.push(ligne)
      }
      parDossier.push({ dossier, lignes })
    }
    const manifeste = new TextEncoder().encode(manifesteDeLaCopie({ copieId, fabriqueLe, dossiers: parDossier }))
    if (zip.depasserait(NOM_DU_MANIFESTE, manifeste.length, dep.sortie.plafond)) {
      throw new PlafondAtteint(`la copie passerait ${mio(dep.sortie.plafond)}, le plus gros ZIP que ce navigateur fabrique ici`)
    }
    empreinte = await sha256Hex(manifeste)
    await zip.ajouter(NOM_DU_MANIFESTE, manifeste)
    await zip.fermer()
    await dep.sortie.terminer()
  } catch (e) {
    await dep.sortie.abandonner()
    const motif = e instanceof PlafondAtteint ? e.message : messageErreur(e, 'l’écriture du ZIP a échoué')
    return { ok: false, message: `La copie s’est arrêtée, aucun ZIP n’est complet : ${motif}. Elle ne s’enregistre pas.` }
  }

  const toutes = parDossier.flatMap((d) => d.lignes)
  const c = compterLesLignes(toutes)
  const bilan: BilanDeLaCopie = {
    copieId, dossiers: parDossier.length, fichiers: c.fichiers, verifies: c.verifies, ecarts: c.ecarts, nonVerifies: c.nonVerifies,
    manquants: c.manquants, octets: c.octets, octetsDuZip: zip.octetsEcrits,
    repartition: parDossier.map(({ dossier, lignes }) => `${dossier.nom} : ${lignes.length} fichier(s)`), enregistrementRefuse: null,
  }

  // 3. L'enregistrement : la base refuse une copie qui ne couvre pas tous ses dossiers. La copie n'est pas encore faite.
  try {
    const { error } = await supabase.rpc('enregistrer_copie_des_fichiers', {
      p_copie_id: copieId, p_cabinet_id: cabinetId, p_nb_dossiers: bilan.dossiers, p_nb_fichiers: bilan.fichiers,
      p_nb_verifies: bilan.verifies, p_nb_ecarts: bilan.ecarts, p_nb_manquants: bilan.manquants, p_octets: bilan.octets,
      p_empreinte_du_manifeste: empreinte,
    })
    if (error) bilan.enregistrementRefuse = messageErreur(error, 'la copie ne s’est pas enregistrée')
  } catch (e) {
    bilan.enregistrementRefuse = messageErreur(e, 'la copie ne s’est pas enregistrée')
  }
  return { ok: true, bilan }
}

// ── Le manifeste rechargé (CFC-Q2 (B)) ─────────────────────────────────────────────────────────────────────────────────

export type IssueDeLAttestation = { ok: true } | { ok: false; message: string }

/**
 * Le chef recharge le manifeste de la copie qui l'attend : confronté ici d'abord (pour dire pourquoi il se refuse), puis
 * par la base, qui en recalcule l'empreinte et ne tient la copie pour faite qu'à elle. Ne lève jamais.
 */
export async function attesterLaCopie(cabinetId: string, copie: CopieAAttester, fichier: Blob): Promise<IssueDeLAttestation> {
  if (fichier.size === 0 || fichier.size > MANIFESTE_AU_PLUS) {
    return { ok: false, message: 'Ce fichier n’est pas un manifeste de copie (vide, ou trop gros) : recharger le MANIFESTE.txt du ZIP.' }
  }
  try {
    const texte = await fichier.text()
    const confrontation = await confronterLeManifeste(texte, copie)
    if (!confrontation.ok) return { ok: false, message: confrontation.phrase }
    const { error } = await supabase.rpc('attester_copie_des_fichiers', { p_cabinet_id: cabinetId, p_copie_id: copie.id, p_manifeste: texte })
    if (error) return { ok: false, message: messageErreur(error, 'la copie n’a pas pu être attestée') }
    return { ok: true }
  } catch (e) {
    return { ok: false, message: messageErreur(e, 'la copie n’a pas pu être attestée') }
  }
}

const COLONNES = 'id, faite_le, nb_fichiers, nb_ecarts, nb_manquants, empreinte_du_manifeste, rangee_le'

/** La dernière copie du cabinet, et la dernière faite (attestée) et complète. Ne lève jamais. */
export async function lireLesCopiesDuCabinet(cabinetId: string): Promise<LectureDesCopies> {
  try {
    const [derniere, complete] = await Promise.all([
      supabase.from('copies_des_fichiers').select(COLONNES).eq('cabinet_id', cabinetId)
        .order('faite_le', { ascending: false }).order('id').limit(1).maybeSingle(),
      supabase.from('copies_des_fichiers').select(COLONNES).eq('cabinet_id', cabinetId).not('rangee_le', 'is', null)
        .eq('nb_ecarts', 0).eq('nb_manquants', 0)
        .order('faite_le', { ascending: false }).order('id').limit(1).maybeSingle(),
    ])
    if (derniere.error || complete.error) {
      return { lue: false, motif: messageErreur(derniere.error ?? complete.error, 'la lecture a échoué') }
    }
    return { lue: true, derniere: (derniere.data as CopieEnregistree | null) ?? null, derniereComplete: (complete.data as CopieEnregistree | null) ?? null }
  } catch (e) {
    return { lue: false, motif: messageErreur(e, 'la lecture a échoué') }
  }
}
