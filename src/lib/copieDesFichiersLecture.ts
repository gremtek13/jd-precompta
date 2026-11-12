import { DOCUMENTS_ET_DEMANDES_PREVUS } from './documentsEtDemandes'
import { ORIGINAUX_DES_IMPORTS_PREVUS } from './bornesStockage'
import {
  fabriquerUnLot, fermerLeLotAvant, inventaireDuDossier, PLAFOND_D_UN_LOT,
  type CopieEnregistree, type DocumentDeLaCopie, type DocumentDuCabinetDeLaCopie, type DossierDeLaCopie, type FichierACopier,
  type FichierLu, type LectureDesCopies, type OriginalDeLaCopie, type PieceDeLaCopie,
} from './copieDesFichiers'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'

// LA COPIE DES FICHIERS (INAL6) : les lectures, les téléchargements et l'enregistrement. Ce qui se décide (l'inventaire,
// les noms, la découpe, le manifeste, le rappel) vit dans lib/copieDesFichiers.ts, pur.
//
// L'ordre : TOUS les inventaires d'abord (chaque dossier du cabinet, chaque table lue en entier) — une lecture partielle,
// et aucun ZIP ne part, rien ne s'enregistre ; puis, dossier après dossier, chaque fichier téléchargé, un lot fermé dès que
// le suivant passerait le plafond, chaque ZIP remis au navigateur aussitôt fabriqué (la mémoire n'en garde qu'un) ; enfin
// la copie enregistrée par `enregistrer_copie_des_fichiers`, qui refuse une copie qui ne couvre pas tous les dossiers.

export interface BilanDeLaCopie {
  dossiers: number
  lots: number
  fichiers: number
  verifies: number
  ecarts: number
  nonVerifies: number
  manquants: number
  octets: number
  /** La découpe, dite : « Dossier X : 2 lots ». */
  decoupe: string[]
  /** null si la copie s'est enregistrée ; sinon le refus de la base, en clair (les ZIP sont partis quand même). */
  enregistrementRefuse: string | null
}

export type IssueDeLaCopie = { ok: true; bilan: BilanDeLaCopie } | { ok: false; message: string }

export interface Dependances {
  /** Remet un ZIP au navigateur (un lien de téléchargement). */
  telecharger: (nom: string, octets: Uint8Array) => void
  /** L'instant de la fabrication. */
  maintenant: () => Date
  /** L'avancement, pour l'écran. */
  avancement?: (texte: string) => void
}

function partielle(quoi: string, motif: string | null): LecturePartielle {
  return new LecturePartielle(`${quoi} n’ont pas pu être lus en entier (${motif ?? 'lecture incomplète'})`)
}

class LecturePartielle {
  readonly message: string
  constructor(message: string) { this.message = message }
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
  return inventaireDuDossier({ pieces: lecturePieces.lignes, documents: lectureDocuments.lignes, originaux, documentsDuCabinet })
}

async function telechargerUnFichier(f: FichierACopier): Promise<FichierLu> {
  try {
    const { data, error } = await supabase.storage.from(f.seau).download(f.chemin)
    if (error || !data) return { fichier: f, octets: null, motif: messageErreur(error, 'le stockage ne l’a pas rendu') }
    return { fichier: f, octets: new Uint8Array(await data.arrayBuffer()) }
  } catch (e) {
    return { fichier: f, octets: null, motif: messageErreur(e, 'le téléchargement a échoué') }
  }
}

/** La copie entière des fichiers des dossiers d'un cabinet. Ne lève jamais : une issue refusée porte son message. */
export async function copierLesFichiersDuCabinet(cabinetId: string, dep: Dependances): Promise<IssueDeLaCopie> {
  // 1. Les dossiers et leurs inventaires, en entier, avant tout téléchargement.
  const inventaires: { dossier: DossierDeLaCopie; fichiers: FichierACopier[] }[] = []
  try {
    const lectureDossiers = await lireTout<DossierDeLaCopie>((debut, fin) =>
      supabase.from('dossiers').select('id, nom, siret', { count: 'exact' })
        .eq('cabinet_id', cabinetId).order('id').range(debut, fin))
    if (!lectureDossiers.complete) throw partielle('les dossiers du cabinet', lectureDossiers.motif)
    const dossiers = lectureDossiers.lignes
    if (dossiers.length === 0) return { ok: false, message: 'Aucune copie : le cabinet n’a aucun dossier.' }
    for (const dossier of dossiers) {
      dep.avancement?.(`Inventaire de « ${dossier.nom} »…`)
      inventaires.push({ dossier, fichiers: await lireLesSources(dossier.id) })
    }
  } catch (e) {
    const message = e instanceof LecturePartielle ? e.message : messageErreur(e, 'la lecture a échoué')
    return { ok: false, message: `Aucune copie, aucun ZIP : ${message}. Relancer la copie.` }
  }

  // 2. Dossier après dossier, les lots.
  const fabriqueLe = dep.maintenant()
  const bilan: BilanDeLaCopie = {
    dossiers: inventaires.length, lots: 0, fichiers: 0, verifies: 0, ecarts: 0, nonVerifies: 0, manquants: 0, octets: 0,
    decoupe: [], enregistrementRefuse: null,
  }
  const empreintes: string[] = []
  try {
    for (const { dossier, fichiers } of inventaires) {
      let rang = 1
      let lot: FichierLu[] = []
      let octetsDuLot = 0
      const fermer = async (dernier: boolean) => {
        const fait = await fabriquerUnLot({ dossier, rang, dernier, fichiers: lot, fabriqueLe })
        dep.telecharger(fait.nomDuZip, fait.zip)
        empreintes.push(fait.empreinteDuManifeste)
        bilan.lots++
        bilan.fichiers += fait.comptes.fichiers
        bilan.verifies += fait.comptes.verifies
        bilan.ecarts += fait.comptes.ecarts
        bilan.nonVerifies += fait.comptes.nonVerifies
        bilan.manquants += fait.comptes.manquants
        bilan.octets += fait.comptes.octets
        lot = []
        octetsDuLot = 0
        rang++
      }
      for (const [i, f] of fichiers.entries()) {
        dep.avancement?.(`« ${dossier.nom} » : fichier ${i + 1} sur ${fichiers.length}…`)
        const telecharge = await telechargerUnFichier(f)
        const taille = telecharge.octets?.length ?? 0
        if (fermerLeLotAvant(octetsDuLot, lot.length, taille, PLAFOND_D_UN_LOT)) await fermer(false)
        lot.push(telecharge)
        octetsDuLot += taille
      }
      await fermer(true)
      bilan.decoupe.push(`${dossier.nom} : ${rang - 1} lot${rang - 1 > 1 ? 's' : ''}, ${fichiers.length} fichier(s)`)
    }
  } catch (e) {
    return {
      ok: false,
      message: `La copie s’est arrêtée après ${bilan.lots} ZIP : ${messageErreur(e, 'la fabrication a échoué')}. Elle ne s’enregistre pas ; la relancer.`,
    }
  }

  // 3. L'enregistrement : la base refuse une copie qui ne couvre pas tous ses dossiers.
  try {
    const { error } = await supabase.rpc('enregistrer_copie_des_fichiers', {
      p_cabinet_id: cabinetId, p_nb_dossiers: bilan.dossiers, p_nb_fichiers: bilan.fichiers, p_nb_verifies: bilan.verifies,
      p_nb_ecarts: bilan.ecarts, p_nb_manquants: bilan.manquants, p_octets: bilan.octets, p_empreintes_des_manifestes: empreintes,
    })
    if (error) bilan.enregistrementRefuse = messageErreur(error, 'la copie ne s’est pas enregistrée')
  } catch (e) {
    bilan.enregistrementRefuse = messageErreur(e, 'la copie ne s’est pas enregistrée')
  }
  return { ok: true, bilan }
}

const COLONNES = 'faite_le, nb_ecarts, nb_manquants'

/** La dernière copie du cabinet, et la dernière complète. Ne lève jamais. */
export async function lireLesCopiesDuCabinet(cabinetId: string): Promise<LectureDesCopies> {
  try {
    const [derniere, complete] = await Promise.all([
      supabase.from('copies_des_fichiers').select(COLONNES).eq('cabinet_id', cabinetId)
        .order('faite_le', { ascending: false }).order('id').limit(1).maybeSingle(),
      supabase.from('copies_des_fichiers').select(COLONNES).eq('cabinet_id', cabinetId).eq('nb_ecarts', 0).eq('nb_manquants', 0)
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
