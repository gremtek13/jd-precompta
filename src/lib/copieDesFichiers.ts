import JSZip from 'jszip'
import type { DocumentDivers, Piece } from './types'
import { dateAParis } from './format'
import { referenceDUnePiece } from './fec'

// LA COPIE DES FICHIERS DES DOSSIERS SUR UN SUPPORT DU CABINET (lignes 20.65 et 44, INAL6 ; INAL-Q3 : « d'abord un support
// du cabinet »). Le chef du cabinet rapatrie, d'un clic, sur son poste, une copie COMPLÈTE et VÉRIFIABLE des fichiers que
// le stockage porte pour ses dossiers. Ce module est PUR : l'inventaire, les noms, la découpe, le ZIP et son manifeste, le
// rappel ; la lecture et les téléchargements vivent dans lib/copieDesFichiersLecture.ts.
//
// CE QUI EXISTAIT ET NE SUFFISAIT PAS. Le pack d'un dossier (lib/packGenerator.ts) ne porte que les pièces VALIDÉES datées
// dans SA période (ni celles à valider, ni les sans-date, ni les documents divers), nomme un fichier par son tiers (le nom
// d'un patient peut y passer), ne relit aucune empreinte et n'a pas de manifeste. Le paquet d'archive (lib/paquetDArchive.ts)
// ne porte que les pièces CITÉES par un exercice VALIDÉ. La sauvegarde (lib/sauvegarde.ts) porte les lignes et, depuis son
// format 2, les logos des factures — pas les fichiers des pièces. D'où ce troisième fabricant, qui reprend leurs briques
// (`referenceDUnePiece`, le nom et le SHA-256 d'un original, le manifeste du paquet d'archive) sans rien leur ôter.
//
// CE QUE LA COPIE PORTE, seau par seau (relevé en production le 12/11/2026 : `pieces` 146 objets, `packs` 2, `ventes` 0,
// `cabinet-logos` 2) :
//   - `pieces` : l'original de chaque pièce (toute pièce, de tout statut et de tout exercice ; `storage_hash`), sa version
//     lisible s'il y en a une (sans empreinte en base), et chaque document divers (`documents_divers.storage_hash`).
//   - `ventes` : les originaux des factures reprises (`imports_factures` et `factures_importees`, `fichier_sha256`). PAS les
//     logos des factures : la sauvegarde (format 2) les porte déjà, vérifiés à leur empreinte.
//   - `documents-cabinet` (B2, sous `DOCUMENTS_ET_DEMANDES_PREVUS`) : les documents que le cabinet met à disposition (`sha256`).
//   - Écartés : `packs` (des fichiers que l'application REFAIT des pièces), `cabinet-logos` (le logo PUBLIC de la charte du
//     cabinet, qui n'est la donnée d'aucun dossier, et se redépose).
//
// LES NOMS. Le chemin du stockage porte le nom du fichier déposé (« 1787769218050-<nom d'origine>.pdf ») : il n'entre ni dans
// un nom du ZIP, ni dans le manifeste. Une pièce s'appelle par sa PieceRef (`referenceDUnePiece`), un document par sa date et
// le début de son identifiant, un original repris par son empreinte, que son chemin porte déjà.

/** Le drapeau de la migration `copies_des_fichiers` (PRÉPARÉE le 12/11/2026) : baissé, ni carte ni rappel, rien ne se lit. */
export const COPIE_DES_FICHIERS_PREVUE: boolean = false

export const TABLES_DES_COPIES_DES_FICHIERS = ['copies_des_fichiers'] as const

/** Le volume d'un ZIP, au plus (hors d'un fichier seul plus gros, qui part seul) : la mémoire d'un navigateur ordinaire. */
export const PLAFOND_D_UN_LOT = 100 * 1024 * 1024

export const NOM_DU_MANIFESTE = 'MANIFESTE.txt'

export type SeauCopie = 'pieces' | 'ventes' | 'documents-cabinet'
export type NatureDuFichier = 'piece' | 'version_lisible' | 'document' | 'original_repris' | 'document_du_cabinet'

export interface FichierACopier {
  nature: NatureDuFichier
  seau: SeauCopie
  /** Le chemin du stockage : pour le télécharger, JAMAIS écrit dans le ZIP ni dans le manifeste. */
  chemin: string
  /** Son nom dans le ZIP. */
  nom: string
  /** Le SHA-256 que la base garde, en hexadécimal minuscule ; null s'il n'y en a pas (ou s'il est illisible). */
  attendue: string | null
  /** L'identifiant de la ligne qui le cite (la pièce, le document, l'import). */
  ligne: string
}

export type PieceDeLaCopie = Pick<Piece, 'id' | 'date_piece' | 'created_at' | 'storage_path' | 'storage_hash' | 'lisible_path'>
export type DocumentDeLaCopie = Pick<DocumentDivers, 'id' | 'created_at' | 'storage_path' | 'storage_hash'>
export interface OriginalDeLaCopie { id: string; fichier_chemin: string | null; fichier_sha256: string | null }
export interface DocumentDuCabinetDeLaCopie { id: string; chemin: string; sha256: string; type_mime: string | null }

export interface SourcesDuDossier {
  pieces: readonly PieceDeLaCopie[]
  documents: readonly DocumentDeLaCopie[]
  /** Les lignes d'`imports_factures` et de `factures_importees` : un même original peut être cité par les deux. */
  originaux: readonly OriginalDeLaCopie[]
  documentsDuCabinet: readonly DocumentDuCabinetDeLaCopie[]
}

const SHA256_HEX = /^[0-9a-f]{64}$/

// Les deux briques du paquet d'archive (lib/paquetDArchive.ts), recopiées plutôt qu'importées : son garde
// (PaquetDArchiveBouton.test.tsx) tient la liste de ses importateurs, et la copie n'a pas à y entrer.
export async function sha256Hex(octets: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', octets as Uint8Array<ArrayBuffer>)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function empreinteLisible(v: string | null | undefined): string | null {
  const e = (v ?? '').trim().toLowerCase()
  return SHA256_HEX.test(e) ? e : null
}

function extension(chemin: string): string {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(chemin)
  return m ? m[1].toLowerCase() : 'bin'
}

const EXTENSION_DU_TYPE: Record<string, string> = {
  'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'text/csv': 'csv', 'text/plain': 'txt',
}

function jourCompact(instant: string): string {
  return dateAParis(instant).replace(/-/g, '')
}

/** L'inventaire d'un dossier : chaque fichier que ses lignes citent, nommé, avec l'empreinte que la base garde. */
export function inventaireDuDossier(s: SourcesDuDossier): FichierACopier[] {
  const fichiers: FichierACopier[] = []
  const pris = new Set<string>()
  const nommer = (souhaite: string): string => {
    const point = souhaite.lastIndexOf('.')
    const base = souhaite.slice(0, point)
    const ext = souhaite.slice(point)
    let nom = souhaite
    for (let rang = 2; pris.has(nom); rang++) nom = `${base}-${rang}${ext}`
    pris.add(nom)
    return nom
  }

  // Les pièces : leur nom est celui du paquet d'archive (la PieceRef, un rang si deux pièces la partagent, dans l'ordre des
  // identifiants).
  for (const p of [...s.pieces].sort((a, b) => a.id.localeCompare(b.id))) {
    const nom = nommer(`pieces/${referenceDUnePiece(p)}.${extension(p.storage_path)}`)
    fichiers.push({ nature: 'piece', seau: 'pieces', chemin: p.storage_path, nom, attendue: empreinteLisible(p.storage_hash), ligne: p.id })
    if (p.lisible_path) {
      fichiers.push({
        nature: 'version_lisible', seau: 'pieces', chemin: p.lisible_path,
        nom: nommer(`${nom.slice(0, nom.lastIndexOf('.'))}-lisible.${extension(p.lisible_path)}`), attendue: null, ligne: p.id,
      })
    }
  }
  for (const d of [...s.documents].sort((a, b) => a.id.localeCompare(b.id))) {
    fichiers.push({
      nature: 'document', seau: 'pieces', chemin: d.storage_path,
      nom: nommer(`documents/${jourCompact(d.created_at)}-${d.id.slice(0, 8)}.${extension(d.storage_path)}`),
      attendue: empreinteLisible(d.storage_hash), ligne: d.id,
    })
  }
  // Un original cité deux fois (par son import et par sa facture) n'entre qu'une fois, sous la première empreinte lisible.
  const parChemin = new Map<string, OriginalDeLaCopie & { fichier_chemin: string }>()
  for (const o of [...s.originaux].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!o.fichier_chemin) continue
    const deja = parChemin.get(o.fichier_chemin)
    if (!deja || (empreinteLisible(deja.fichier_sha256) === null && empreinteLisible(o.fichier_sha256) !== null)) {
      parChemin.set(o.fichier_chemin, { ...o, fichier_chemin: o.fichier_chemin })
    }
  }
  for (const o of [...parChemin.values()].sort((a, b) => a.fichier_chemin.localeCompare(b.fichier_chemin))) {
    const attendue = empreinteLisible(o.fichier_sha256)
    fichiers.push({
      nature: 'original_repris', seau: 'ventes', chemin: o.fichier_chemin,
      nom: nommer(`factures_reprises/${attendue ? attendue.slice(0, 16) : o.id.slice(0, 8)}.${extension(o.fichier_chemin)}`),
      attendue, ligne: o.id,
    })
  }
  for (const d of [...s.documentsDuCabinet].sort((a, b) => a.id.localeCompare(b.id))) {
    const attendue = empreinteLisible(d.sha256)
    fichiers.push({
      nature: 'document_du_cabinet', seau: 'documents-cabinet', chemin: d.chemin,
      nom: nommer(`documents_du_cabinet/${d.id.slice(0, 8)}.${EXTENSION_DU_TYPE[d.type_mime ?? ''] ?? 'bin'}`),
      attendue, ligne: d.id,
    })
  }
  return fichiers
}

/** La découpe : un fichier qui ferait passer le lot au-delà du plafond le ferme d'abord — sauf dans un lot vide. */
export function fermerLeLotAvant(octetsDuLot: number, fichiersDuLot: number, taille: number, plafond: number = PLAFOND_D_UN_LOT): boolean {
  return fichiersDuLot > 0 && octetsDuLot + taille > plafond
}

export interface DossierDeLaCopie { id: string; nom: string; siret: string | null }

/** Un fichier tel que le téléchargement l'a rendu : ses octets, ou le motif de son absence. */
export type FichierLu =
  | { fichier: FichierACopier; octets: Uint8Array }
  | { fichier: FichierACopier; octets: null; motif: string }

export type EtatDuFichier = 'vérifié' | 'ÉCART' | 'non vérifié' | 'MANQUANT'

export interface LigneDuManifeste { nom: string; taille: number | null; sha256: string | null; etat: EtatDuFichier; attendue: string | null; motif: string | null }

export interface ComptesDUnLot { fichiers: number; verifies: number; ecarts: number; nonVerifies: number; manquants: number; octets: number }

export interface LotFabrique {
  nomDuZip: string
  zip: Uint8Array
  manifeste: string
  empreinteDuManifeste: string
  comptes: ComptesDUnLot
  lignes: LigneDuManifeste[]
}

export interface EntreesDUnLot {
  dossier: DossierDeLaCopie
  rang: number
  dernier: boolean
  fichiers: readonly FichierLu[]
  /** L'instant de la fabrication, sans valeur par défaut (« maintenant » ne se lit pas ici). */
  fabriqueLe: Date
}

function prefixeDuDossier(d: DossierDeLaCopie): string {
  const siren = d.siret ? d.siret.replace(/\D/g, '').slice(0, 9) : ''
  return `${siren || 'SANS_SIREN'}-${d.id.slice(0, 8)}`
}

export function nomDuZip(d: DossierDeLaCopie, rang: number, fabriqueLe: Date): string {
  return `copie-${dateAParis(fabriqueLe)}-${prefixeDuDossier(d)}-lot${rang}.zip`
}

const encodeur = new TextEncoder()

/** Un lot : chaque fichier relu à son empreinte ; un écart ENTRE (c'est ce que le stockage porte) et se dit, un manquant se dit. */
export async function fabriquerUnLot(e: EntreesDUnLot): Promise<LotFabrique> {
  const lignes: LigneDuManifeste[] = []
  const zip = new JSZip()
  const comptes: ComptesDUnLot = { fichiers: 0, verifies: 0, ecarts: 0, nonVerifies: 0, manquants: 0, octets: 0 }
  for (const lu of [...e.fichiers].sort((a, b) => a.fichier.nom.localeCompare(b.fichier.nom))) {
    comptes.fichiers++
    const { fichier } = lu
    if (lu.octets === null) {
      comptes.manquants++
      lignes.push({ nom: fichier.nom, taille: null, sha256: null, etat: 'MANQUANT', attendue: fichier.attendue, motif: lu.motif })
      continue
    }
    const relue = await sha256Hex(lu.octets)
    const etat: EtatDuFichier = fichier.attendue === null ? 'non vérifié' : relue === fichier.attendue ? 'vérifié' : 'ÉCART'
    if (etat === 'vérifié') comptes.verifies++
    else if (etat === 'ÉCART') comptes.ecarts++
    else comptes.nonVerifies++
    comptes.octets += lu.octets.length
    lignes.push({ nom: fichier.nom, taille: lu.octets.length, sha256: relue, etat, attendue: fichier.attendue, motif: null })
    // Une copie dans le `Uint8Array` de la page (voir paquetDArchive.ts : l'`instanceof` de JSZip).
    zip.file(fichier.nom, new Uint8Array(lu.octets), { date: e.fabriqueLe, binary: true })
  }
  const manifeste = manifesteDuLot(e, lignes, comptes)
  zip.file(NOM_DU_MANIFESTE, manifeste, { date: e.fabriqueLe })
  const octets = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  return {
    nomDuZip: nomDuZip(e.dossier, e.rang, e.fabriqueLe), zip: octets, manifeste,
    empreinteDuManifeste: await sha256Hex(encodeur.encode(manifeste)), comptes, lignes,
  }
}

export const ENTETE_DES_FICHIERS = 'FICHIERS (chemin, taille en octets, SHA-256 relu, état)'

function manifesteDuLot(e: EntreesDUnLot, lignes: readonly LigneDuManifeste[], c: ComptesDUnLot): string {
  const ecarts = lignes.filter((l) => l.etat === 'ÉCART')
  const manquants = lignes.filter((l) => l.etat === 'MANQUANT')
  return [
    `COPIE DES FICHIERS D'UN DOSSIER — LOT ${e.rang}${e.dernier ? ' (dernier lot du dossier)' : ' (d’autres lots suivent)'}`,
    '',
    `Dossier : ${e.dossier.nom} (${e.dossier.id})`,
    `Fabriqué le : ${dateAParis(e.fabriqueLe)} (date de Paris)`,
    `Fichiers : ${c.fichiers} ; vérifiés : ${c.verifies} ; écarts : ${c.ecarts} ; sans empreinte en base : ${c.nonVerifies} ; manquants : ${c.manquants}`,
    `Octets copiés : ${c.octets}`,
    '',
    'Chaque fichier a été relu à son SHA-256 au moment de la copie et comparé à l’empreinte que la base garde de son dépôt',
    '(« vérifié »). Un fichier sans empreinte en base est copié tel que le stockage le rendait (« non vérifié »). Pour',
    'vérifier la copie plus tard : recalculer le SHA-256 de chaque fichier (sha256sum, ou Get-FileHash sous Windows) et le',
    'comparer à la colonne ci-dessous. Un dossier se copie en un ou plusieurs lots (au plus 100 Mio chacun).',
    ...(ecarts.length > 0
      ? ['', `ÉCARTS (${ecarts.length}) — le fichier du stockage ne correspond plus à son empreinte de dépôt : copié tel quel, à signaler sans attendre`,
        ...ecarts.map((l) => `${l.nom}\tattendue ${l.attendue}\trelue ${l.sha256}`)]
      : []),
    ...(manquants.length > 0
      ? ['', `MANQUANTS (${manquants.length}) — absents de ce ZIP`, ...manquants.map((l) => `${l.nom}\t${l.motif ?? ''}`)]
      : []),
    '',
    ENTETE_DES_FICHIERS,
    ...(lignes.length === 0 ? ['(aucun fichier : le dossier n’en porte pas)'] : []),
    ...lignes.filter((l) => l.etat !== 'MANQUANT').map((l) => `${l.nom}\t${l.taille}\t${l.sha256}\t${l.etat}`),
    '',
  ].join('\n')
}

// ── Le rappel du tableau de bord ─────────────────────────────────────────────────────────────────────────────────────

export interface CopieEnregistree { faite_le: string; nb_ecarts: number; nb_manquants: number }

/** La lecture des copies d'un cabinet : la dernière, et la dernière COMPLÈTE (ni écart ni manquant). */
export type LectureDesCopies =
  | { lue: true; derniere: CopieEnregistree | null; derniereComplete: CopieEnregistree | null }
  | { lue: false; motif: string }

export type RappelDeLaCopie =
  | { genre: 'rien' }
  | { genre: 'a_jour'; phrase: string }
  | { genre: 'rappel'; phrase: string }
  | { genre: 'illisible'; phrase: string; motif: string }

/** Le même jour, un mois civil plus tard (le 31 janvier → le 28 ou 29 février). */
export function unMoisApres(jour: string): string {
  const [a, m, j] = jour.split('-').map(Number)
  const an = m === 12 ? a + 1 : a
  const mois = m === 12 ? 1 : m + 1
  const dernier = new Date(Date.UTC(an, mois, 0)).getUTCDate()
  return `${an}-${String(mois).padStart(2, '0')}-${String(Math.min(j, dernier)).padStart(2, '0')}`
}

function jourFrancais(jour: string): string {
  return `${jour.slice(8, 10)}/${jour.slice(5, 7)}/${jour.slice(0, 4)}`
}

/** Ce que le tableau de bord dit ; `aujourdhui` est le jour de Paris (AAAA-MM-JJ). Lecture absente : rien. */
export function rappelDeLaCopie(lecture: LectureDesCopies | null, aujourdhui: string): RappelDeLaCopie {
  if (lecture === null) return { genre: 'rien' }
  if (!lecture.lue) {
    return { genre: 'illisible', phrase: 'La date de la dernière copie des fichiers n’a pas pu être lue.', motif: lecture.motif }
  }
  const complete = lecture.derniereComplete
  const incomplete = lecture.derniere !== null && (complete === null || lecture.derniere.faite_le > complete.faite_le)
    ? ` La dernière tentative, le ${jourFrancais(dateAParis(lecture.derniere.faite_le))}, avait ${lecture.derniere.nb_ecarts} écart(s) et ${lecture.derniere.nb_manquants} fichier(s) manquant(s).`
    : ''
  if (complete === null) {
    return { genre: 'rappel', phrase: `Aucune copie complète des fichiers des dossiers n’a encore été faite sur un support du cabinet.${incomplete}` }
  }
  const jour = dateAParis(complete.faite_le)
  if (unMoisApres(jour) < aujourdhui) {
    return { genre: 'rappel', phrase: `La dernière copie complète des fichiers date du ${jourFrancais(jour)}, il y a plus d’un mois : la refaire.${incomplete}` }
  }
  return { genre: 'a_jour', phrase: `Dernière copie complète des fichiers : le ${jourFrancais(jour)}.${incomplete}` }
}
