import { supabase } from './supabase'
import { cheminDuDossier, MOTIF_CHEMIN_HORS_DU_DOSSIER } from './cheminDuDossier'
import { typeDUnePiece } from './bornesStockage'
import { PLAFOND_EN_MEMOIRE } from './copieDesFichiers'
import { EcrivainZip } from './zipEnFlux'
import { messageErreur } from './messageErreur'
import { extensionDuType, type JustificatifAJoindre } from './profilsDExport'

// LES JUSTIFICATIFS DE L'EXPORT VERS UN LOGICIEL COMPTABLE (EXP1, EXP-Q2 (A) recommandée, pas encore tranchée) : la mesure
// du poids avant le clic, puis le ZIP. Le module des profils (lib/profilsDExport.ts) a décidé QUELS fichiers partent et sous
// quel nom ; ici, on les lit — chaque chemin jugé contre son dossier AVANT le stockage (CFCS-Q1, `cheminDuDossier`) — et on
// écrit le ZIP en flux (lib/zipEnFlux.ts), en mémoire, sous le plafond de la copie des fichiers. Rien ne lève : un fichier
// illisible ou hors de son dossier se compte dans le bilan, sans son nom ni son chemin, et l'archive ne dit porter que ce
// qu'elle porte.

const TAILLE_PAGE = 100

export interface PoidsDesJustificatifs { octets: number; inconnus: number }

/**
 * Le poids des justificatifs, dit AVANT le clic : la taille que le stockage rend de chaque fichier (`list`, paginé,
 * répertoire par répertoire), sans rien télécharger. Un chemin hors du dossier ne se demande pas ; un fichier que la liste
 * ne rend pas reste « taille inconnue ».
 */
export async function mesurerLesJustificatifs(dossierId: string, fichiers: readonly JustificatifAJoindre[]): Promise<PoidsDesJustificatifs> {
  const parRepertoire = new Map<string, Set<string>>()
  for (const f of fichiers) {
    if (!cheminDuDossier(f.chemin, dossierId)) continue
    const repertoire = f.chemin.slice(0, f.chemin.lastIndexOf('/'))
    const chemins = parRepertoire.get(repertoire) ?? new Set<string>()
    chemins.add(f.chemin)
    parRepertoire.set(repertoire, chemins)
  }
  let octets = 0
  let connus = 0
  for (const [repertoire, chemins] of parRepertoire) {
    try {
      for (let offset = 0; ; offset += TAILLE_PAGE) {
        const { data, error } = await supabase.storage.from('pieces').list(repertoire, { limit: TAILLE_PAGE, offset, sortBy: { column: 'name', order: 'asc' } })
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
  return { octets, inconnus: fichiers.length - connus }
}

export interface BilanDeLArchive {
  zip: Uint8Array
  /** Les justificatifs écrits dans l'archive. */
  joints: number
  /** Ceux qui n'ont pas pu l'être, chacun avec sa raison, sans nom de fichier ni chemin. */
  manquants: string[]
}

export type IssueDeLArchive = { ok: true; bilan: BilanDeLArchive } | { ok: false; message: string }

/**
 * L'archive : le fichier d'écritures, puis chaque justificatif sous `<PieceRef>.<extension>`, l'extension tirée du type que
 * l'application décide (`typeDUnePiece`, sur le chemin et les premiers octets — jamais le type que déclare le stockage).
 */
export async function fabriquerLArchive(
  dossierId: string, fichierDEcritures: { nom: string; octets: Uint8Array }, justificatifs: readonly JustificatifAJoindre[],
  maintenant: Date,
): Promise<IssueDeLArchive> {
  const morceaux: Uint8Array[] = []
  const zip = new EcrivainZip({ ecrire: async (m) => { morceaux.push(m) } }, maintenant)
  const manquants: string[] = []
  try {
    await zip.ajouter(fichierDEcritures.nom, fichierDEcritures.octets)
    for (const j of justificatifs) {
      if (!cheminDuDossier(j.chemin, dossierId)) { manquants.push(`${j.reference} : ${MOTIF_CHEMIN_HORS_DU_DOSSIER}.`); continue }
      const lu = await telechargerUnJustificatif(dossierId, j)
      if (!lu.ok) { manquants.push(lu.manquant); continue }
      const { octets, extension } = lu
      const nom = `${j.reference}.${extension}`
      if (zip.depasserait(nom, octets.length, PLAFOND_EN_MEMOIRE)) {
        return { ok: false, message: 'Aucune archive : les justificatifs passent la taille qu’un navigateur garde en mémoire (500 Mio).' }
      }
      await zip.ajouter(nom, octets)
    }
    await zip.fermer()
  } catch (e) {
    return { ok: false, message: `Aucune archive : ${messageErreur(e, 'la fabrication a été interrompue.')}` }
  }
  const taille = morceaux.reduce((s, m) => s + m.length, 0)
  const tout = new Uint8Array(taille)
  let p = 0
  for (const m of morceaux) { tout.set(m, p); p += m.length }
  return { ok: true, bilan: { zip: tout, joints: zip.nombreDeFichiers - 1, manquants } }
}

type JustificatifTelecharge = { ok: true; octets: Uint8Array; extension: string } | { ok: false; manquant: string }

/**
 * Un justificatif téléchargé, et l'extension que son type décide ; ce qui ne se lit pas se dit sans nom ni chemin. Le chemin
 * se juge contre son dossier ICI, avant le stockage (CFCS-Q1) : l'appelant l'a déjà fait, la lecture ne s'en remet pas à lui.
 */
async function telechargerUnJustificatif(dossierId: string, j: JustificatifAJoindre): Promise<JustificatifTelecharge> {
  if (!cheminDuDossier(j.chemin, dossierId)) return { ok: false, manquant: `${j.reference} : ${MOTIF_CHEMIN_HORS_DU_DOSSIER}.` }
  let octets: Uint8Array
  try {
    const { data, error } = await supabase.storage.from('pieces').download(j.chemin)
    if (error || !data) return { ok: false, manquant: `${j.reference} : le stockage ne l’a pas rendu.` }
    octets = new Uint8Array(await data.arrayBuffer())
  } catch {
    return { ok: false, manquant: `${j.reference} : le téléchargement a échoué.` }
  }
  const extension = extensionDuType(typeDUnePiece(j.chemin, octets.subarray(0, 8)))
  if (extension === null) return { ok: false, manquant: `${j.reference} : son type n’est pas un de ceux que l’application accepte.` }
  return { ok: true, octets, extension }
}

export type FichierComposeQuadra = { ok: true; nom: string; octets: Uint8Array } | { ok: false; message: string }

/**
 * L'archive du profil Quadra (lib/profilQuadra.ts) : le fichier ASCII NOMME chaque justificatif en position 182, et ce nom
 * porte l'extension que son type décide — on télécharge donc d'abord les justificatifs, on compose le fichier avec les noms
 * de ceux qui sont VRAIMENT là (`composer`), puis on écrit l'archive : le fichier, et chaque justificatif à côté de lui, à la
 * racine (« les fichiers sont à localiser au même endroit que le fichier ASCII », KB0014530). Un fichier absent n'est pas
 * nommé ; le plafond en mémoire est celui de l'archive ACD.
 */
export async function fabriquerLArchiveQuadra(
  dossierId: string, justificatifs: readonly JustificatifAJoindre[], nommer: (reference: string, extension: string) => string | null,
  composer: (noms: ReadonlyMap<string, string>) => FichierComposeQuadra, maintenant: Date,
): Promise<IssueDeLArchive> {
  const manquants: string[] = []
  const lus: { nom: string; octets: Uint8Array }[] = []
  const noms = new Map<string, string>()
  let poids = 0
  for (const j of justificatifs) {
    if (!cheminDuDossier(j.chemin, dossierId)) { manquants.push(`${j.reference} : ${MOTIF_CHEMIN_HORS_DU_DOSSIER}.`); continue }
    const lu = await telechargerUnJustificatif(dossierId, j)
    if (!lu.ok) { manquants.push(lu.manquant); continue }
    const nom = nommer(j.reference, lu.extension)
    if (nom === null) { manquants.push(`${j.reference} : son nom ne tient pas en huit caractères et une extension de trois.`); continue }
    poids += lu.octets.length
    if (poids > PLAFOND_EN_MEMOIRE) {
      return { ok: false, message: 'Aucune archive : les justificatifs passent la taille qu’un navigateur garde en mémoire (500 Mio).' }
    }
    noms.set(j.reference, nom)
    lus.push({ nom, octets: lu.octets })
  }
  const fichier = composer(noms)
  if (!fichier.ok) return { ok: false, message: `Aucune archive : ${fichier.message}` }
  const morceaux: Uint8Array[] = []
  const zip = new EcrivainZip({ ecrire: async (m) => { morceaux.push(m) } }, maintenant)
  try {
    await zip.ajouter(fichier.nom, fichier.octets)
    for (const l of lus) await zip.ajouter(l.nom, l.octets)
    await zip.fermer()
  } catch (e) {
    return { ok: false, message: `Aucune archive : ${messageErreur(e, 'la fabrication a été interrompue.')}` }
  }
  const taille = morceaux.reduce((s, m) => s + m.length, 0)
  const tout = new Uint8Array(taille)
  let p = 0
  for (const m of morceaux) { tout.set(m, p); p += m.length }
  return { ok: true, bilan: { zip: tout, joints: zip.nombreDeFichiers - 1, manquants } }
}
