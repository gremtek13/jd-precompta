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
      let octets: Uint8Array
      try {
        const { data, error } = await supabase.storage.from('pieces').download(j.chemin)
        if (error || !data) { manquants.push(`${j.reference} : le stockage ne l’a pas rendu.`); continue }
        octets = new Uint8Array(await data.arrayBuffer())
      } catch {
        manquants.push(`${j.reference} : le téléchargement a échoué.`)
        continue
      }
      const extension = extensionDuType(typeDUnePiece(j.chemin, octets.subarray(0, 8)))
      if (extension === null) { manquants.push(`${j.reference} : son type n’est pas un de ceux que l’application accepte.`); continue }
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
