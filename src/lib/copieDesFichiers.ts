import type { DocumentDivers, Piece } from './types'
import { dateAParis } from './format'
import { referenceDUnePiece } from './fec'
import { cheminDuDossier } from './cheminDuDossier'

// LA COPIE DES FICHIERS DES DOSSIERS SUR UN SUPPORT DU CABINET (lignes 20.65 et 44, INAL6 ; INAL-Q3 : « d'abord un support
// du cabinet »). Le chef du cabinet rapatrie, d'un clic, sur son poste, une copie COMPLÈTE et VÉRIFIABLE des fichiers que
// le stockage porte pour ses dossiers. Ce module est PUR : l'inventaire, les noms, la relecture de chaque fichier, le
// manifeste, sa confrontation quand il est rechargé, le rappel ; la lecture, les téléchargements et l'écriture du ZIP
// (lib/zipEnFlux.ts) vivent dans lib/copieDesFichiersLecture.ts.
//
// CFC-Q1 (B), tranchée le 12/11/2026 : UN SEUL ZIP pour tout le cabinet (la recommandation, un ZIP de 100 Mio au plus par
// dossier, est écartée), un dossier par répertoire du ZIP, UN manifeste à sa racine. Pour ne pas tenir tous les fichiers en
// mémoire, le ZIP s'écrit en flux (lib/zipEnFlux.ts) : directement dans le fichier que le chef choisit quand le navigateur
// le permet (Chrome, Edge), sinon en mémoire, sous un plafond dit avant le clic (`PLAFOND_EN_MEMOIRE`).
// CFC-Q2 (B) : la copie ne compte comme faite que lorsque le chef RECHARGE ce manifeste (`confronterLeManifeste`, puis
// `attester_copie_des_fichiers`, qui en recalcule l'empreinte en base).
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
//
// UN CHEMIN HORS DU DOSSIER (relecture de sécurité du 12/11/2026). La base ne lie pas le premier segment de
// `pieces.storage_path` ni de `documents_divers.storage_path` au dossier de la ligne, et le client d'un dossier insère l'une
// et l'autre : il peut nommer le fichier d'un AUTRE dossier, que le chef, qui les lit tous, téléchargerait dans le ZIP de
// celui-ci. Un tel chemin n'est donc jamais téléchargé ni copié : le fichier se compte manquant, et le manifeste le dit
// (`MOTIF_HORS_DU_DOSSIER`), sans son chemin. La même règle vaut pour chaque nature, celles que la base tient déjà.

/** Le drapeau de la migration `copies_des_fichiers` (PRÉPARÉE le 12/11/2026) : baissé, ni carte ni rappel, rien ne se lit. */
export const COPIE_DES_FICHIERS_PREVUE: boolean = false

export const TABLES_DES_COPIES_DES_FICHIERS = ['copies_des_fichiers'] as const

/**
 * Le plus gros ZIP qu'un navigateur sans écriture directe sur le disque fabrique (il le garde en mémoire jusqu'à la fin) :
 * au-delà, la copie se refuse avant le clic, et s'arrête si le volume mesuré l'a sous-estimé, plutôt que de faire tomber
 * l'onglet. 500 Mio : une borne prudente, NON mesurée sur Safari ni Firefox (aucun des deux dans cet environnement) ; une
 * tablette ou un ordinateur modeste ferme un onglet bien avant les quelques Gio d'un ordinateur de bureau.
 */
export const PLAFOND_EN_MEMOIRE = 500 * 1024 * 1024

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
  /** Son chemin n'est pas dans le dossier de la ligne (`cheminDuDossier`) : ni téléchargé, ni copié, compté manquant. */
  horsDuDossier: boolean
}

export type PieceDeLaCopie = Pick<Piece, 'id' | 'date_piece' | 'created_at' | 'storage_path' | 'storage_hash' | 'lisible_path'>
export type DocumentDeLaCopie = Pick<DocumentDivers, 'id' | 'created_at' | 'storage_path' | 'storage_hash'>
export interface OriginalDeLaCopie { id: string; fichier_chemin: string | null; fichier_sha256: string | null }
export interface DocumentDuCabinetDeLaCopie { id: string; chemin: string; sha256: string; type_mime: string | null }

export interface SourcesDuDossier {
  /** Le dossier que les lignes disent : un chemin dont le premier segment n'est pas lui ne se copie pas. */
  dossierId: string
  pieces: readonly PieceDeLaCopie[]
  documents: readonly DocumentDeLaCopie[]
  /** Les lignes d'`imports_factures` et de `factures_importees` : un même original peut être cité par les deux. */
  originaux: readonly OriginalDeLaCopie[]
  documentsDuCabinet: readonly DocumentDuCabinetDeLaCopie[]
}

const SHA256_HEX = /^[0-9a-f]{64}$/
const encodeur = new TextEncoder()

export const MOTIF_HORS_DU_DOSSIER = 'son chemin de stockage n’est pas dans ce dossier : non copié, à signaler sans attendre'

// La règle vit dans un module commun (`lib/cheminDuDossier.ts`), que chaque lecteur du cabinet appelle (CFCS-Q1) ;
// réexportée ici pour la copie et son test.
export { cheminDuDossier }

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
  const hors = (chemin: string) => !cheminDuDossier(chemin, s.dossierId)
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
    fichiers.push({
      nature: 'piece', seau: 'pieces', chemin: p.storage_path, nom, attendue: empreinteLisible(p.storage_hash), ligne: p.id,
      horsDuDossier: hors(p.storage_path),
    })
    if (p.lisible_path) {
      fichiers.push({
        nature: 'version_lisible', seau: 'pieces', chemin: p.lisible_path,
        nom: nommer(`${nom.slice(0, nom.lastIndexOf('.'))}-lisible.${extension(p.lisible_path)}`), attendue: null, ligne: p.id,
        horsDuDossier: hors(p.lisible_path),
      })
    }
  }
  for (const d of [...s.documents].sort((a, b) => a.id.localeCompare(b.id))) {
    fichiers.push({
      nature: 'document', seau: 'pieces', chemin: d.storage_path,
      nom: nommer(`documents/${jourCompact(d.created_at)}-${d.id.slice(0, 8)}.${extension(d.storage_path)}`),
      attendue: empreinteLisible(d.storage_hash), ligne: d.id, horsDuDossier: hors(d.storage_path),
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
      attendue, ligne: o.id, horsDuDossier: hors(o.fichier_chemin),
    })
  }
  for (const d of [...s.documentsDuCabinet].sort((a, b) => a.id.localeCompare(b.id))) {
    const attendue = empreinteLisible(d.sha256)
    fichiers.push({
      nature: 'document_du_cabinet', seau: 'documents-cabinet', chemin: d.chemin,
      nom: nommer(`documents_du_cabinet/${d.id.slice(0, 8)}.${EXTENSION_DU_TYPE[d.type_mime ?? ''] ?? 'bin'}`),
      attendue, ligne: d.id, horsDuDossier: hors(d.chemin),
    })
  }
  return fichiers
}

export interface DossierDeLaCopie { id: string; nom: string; siret: string | null }

/** Un fichier tel que le téléchargement l'a rendu : ses octets, ou le motif de son absence. */
export type FichierLu =
  | { fichier: FichierACopier; octets: Uint8Array }
  | { fichier: FichierACopier; octets: null; motif: string }

export type EtatDuFichier = 'vérifié' | 'ÉCART' | 'non vérifié' | 'MANQUANT'

/** Une ligne du manifeste ; `nom` est le chemin DANS le ZIP (le dossier en tête). */
export interface LigneDuManifeste { nom: string; taille: number | null; sha256: string | null; etat: EtatDuFichier; attendue: string | null; motif: string | null }

export interface ComptesDeLaCopie { fichiers: number; verifies: number; ecarts: number; nonVerifies: number; manquants: number; octets: number }

/** Le dossier d'un fichier dans le ZIP : son SIREN (ou SANS_SIREN) et le début de son identifiant, jamais son nom. */
export function dossierDansLeZip(d: DossierDeLaCopie): string {
  const siren = d.siret ? d.siret.replace(/\D/g, '').slice(0, 9) : ''
  return `${siren || 'SANS_SIREN'}-${d.id.slice(0, 8)}`
}

/** Le nom proposé pour LE ZIP de la copie (CFC-Q1 (B) : un seul pour tout le cabinet). */
export function nomDuZipDeLaCopie(fabriqueLe: Date): string {
  return `copie-des-fichiers-${dateAParis(fabriqueLe)}.zip`
}

/**
 * Un fichier relu : son état et sa ligne de manifeste, son chemin dans le ZIP ; `octets` seulement s'il entre dans le ZIP.
 * Un écart ENTRE (c'est ce que le stockage porte) et se dit ; un manquant se dit ; un chemin hors du dossier n'entre jamais,
 * même téléchargé : son fichier est d'un autre dossier.
 */
export async function relireUnFichier(dossier: DossierDeLaCopie, lu: FichierLu): Promise<{ ligne: LigneDuManifeste; octets: Uint8Array | null }> {
  const { fichier } = lu
  const nom = `${dossierDansLeZip(dossier)}/${fichier.nom}`
  if (fichier.horsDuDossier || lu.octets === null) {
    const motif = fichier.horsDuDossier ? MOTIF_HORS_DU_DOSSIER : lu.octets === null ? lu.motif : null
    return { ligne: { nom, taille: null, sha256: null, etat: 'MANQUANT', attendue: fichier.attendue, motif }, octets: null }
  }
  const relue = await sha256Hex(lu.octets)
  const etat: EtatDuFichier = fichier.attendue === null ? 'non vérifié' : relue === fichier.attendue ? 'vérifié' : 'ÉCART'
  return { ligne: { nom, taille: lu.octets.length, sha256: relue, etat, attendue: fichier.attendue, motif: null }, octets: lu.octets }
}

export function compterLesLignes(lignes: readonly LigneDuManifeste[]): ComptesDeLaCopie {
  const c: ComptesDeLaCopie = { fichiers: 0, verifies: 0, ecarts: 0, nonVerifies: 0, manquants: 0, octets: 0 }
  for (const l of lignes) {
    c.fichiers++
    if (l.etat === 'vérifié') c.verifies++
    else if (l.etat === 'ÉCART') c.ecarts++
    else if (l.etat === 'non vérifié') c.nonVerifies++
    else c.manquants++
    c.octets += l.taille ?? 0
  }
  return c
}

export const ENTETE_DES_FICHIERS = 'FICHIERS (chemin dans le ZIP, taille en octets, SHA-256 relu, état)'
export const LIBELLE_IDENTIFIANT = 'Identifiant de la copie : '
export const LIBELLE_FABRIQUEE = 'Fabriquée le : '
export const DEBUT_DE_LA_FIN = 'FIN DU MANIFESTE — '

export interface EntreesDuManifeste {
  /** L'identifiant de la copie, celui que la base enregistrera : le manifeste rechargé le redit. */
  copieId: string
  /** L'instant de la fabrication, sans valeur par défaut (« maintenant » ne se lit pas ici). */
  fabriqueLe: Date
  dossiers: readonly { dossier: DossierDeLaCopie; lignes: readonly LigneDuManifeste[] }[]
}

/**
 * LE manifeste de la copie (un seul, à la racine du ZIP). Il porte l'identifiant de la copie, sa date, ses comptes, une
 * section par dossier (ses écarts et ses manquants), la liste de tous les fichiers copiés, et une ligne de fin qui redit
 * leur nombre : un manifeste tronqué se reconnaît (CFC-Q2). Son SHA-256, que la base garde, ne se recalcule qu'à l'octet
 * près : le rechargé ne prouve la copie que tel quel.
 */
export function manifesteDeLaCopie(e: EntreesDuManifeste): string {
  const toutes = e.dossiers.flatMap((d) => d.lignes)
  const c = compterLesLignes(toutes)
  const copiees = toutes.filter((l) => l.etat !== 'MANQUANT')
  const sections = e.dossiers.flatMap(({ dossier, lignes }) => {
    const cd = compterLesLignes(lignes)
    const ecarts = lignes.filter((l) => l.etat === 'ÉCART')
    const manquants = lignes.filter((l) => l.etat === 'MANQUANT')
    return [
      '',
      `DOSSIER ${dossierDansLeZip(dossier)}/ : ${dossier.nom} (${dossier.id})`,
      `Fichiers : ${cd.fichiers} ; vérifiés : ${cd.verifies} ; écarts : ${cd.ecarts} ; sans empreinte en base : ${cd.nonVerifies} ; manquants : ${cd.manquants}`,
      ...(lignes.length === 0 ? ['(aucun fichier : le dossier n’en porte pas)'] : []),
      ...(ecarts.length > 0
        ? [`ÉCARTS (${ecarts.length}) — le fichier du stockage ne correspond plus à son empreinte de dépôt : copié tel quel, à signaler sans attendre`,
          ...ecarts.map((l) => `${l.nom}\tattendue ${l.attendue}\trelue ${l.sha256}`)]
        : []),
      ...(manquants.length > 0
        ? [`MANQUANTS (${manquants.length}) — absents du ZIP`, ...manquants.map((l) => `${l.nom}\t${l.motif ?? ''}`)]
        : []),
    ]
  })
  return [
    'COPIE DES FICHIERS DES DOSSIERS DU CABINET',
    '',
    `${LIBELLE_IDENTIFIANT}${e.copieId}`,
    `${LIBELLE_FABRIQUEE}${dateAParis(e.fabriqueLe)} (date de Paris)`,
    `Dossiers : ${e.dossiers.length} ; fichiers : ${c.fichiers} ; vérifiés : ${c.verifies} ; écarts : ${c.ecarts} ; sans empreinte en base : ${c.nonVerifies} ; manquants : ${c.manquants}`,
    `Octets copiés : ${c.octets}`,
    '',
    'Chaque fichier a été relu à son SHA-256 au moment de la copie et comparé à l’empreinte que la base garde de son dépôt',
    '(« vérifié »). Un fichier sans empreinte en base est copié tel que le stockage le rendait (« non vérifié »). Pour',
    'vérifier la copie plus tard : recalculer le SHA-256 de chaque fichier (sha256sum, ou Get-FileHash sous Windows) et le',
    'comparer à la colonne ci-dessous.',
    'La copie ne compte qu’une fois ce fichier RECHARGÉ dans l’application (tableau de bord, « Recharger le manifeste »),',
    'tel quel, depuis le disque ou l’espace du cabinet où le ZIP est rangé. Retouché, il ne prouve plus rien.',
    ...sections,
    '',
    ENTETE_DES_FICHIERS,
    ...copiees.map((l) => `${l.nom}\t${l.taille}\t${l.sha256}\t${l.etat}`),
    '',
    `${DEBUT_DE_LA_FIN}${c.fichiers} fichier(s), dont ${copiees.length} dans le ZIP`,
    '',
  ].join('\n')
}

// ── Le manifeste rechargé (CFC-Q2 (B)) ─────────────────────────────────────────────────────────────────────────────────

/** Le plus gros manifeste qui se recharge : la borne de `attester_copie_des_fichiers`. */
export const MANIFESTE_AU_PLUS = 20 * 1024 * 1024

/** Ce que la base garde d'une copie, que le manifeste rechargé doit redire. */
export interface CopieAAttester {
  id: string
  faite_le: string
  nb_fichiers: number
  empreinte_du_manifeste: string
}

export type RaisonDuRefus = 'illisible' | 'autre_copie' | 'date' | 'incomplet' | 'retouche'

export type Confrontation = { ok: true } | { ok: false; raison: RaisonDuRefus; phrase: string }

function jourFrancais(jour: string): string {
  return `${jour.slice(8, 10)}/${jour.slice(5, 7)}/${jour.slice(0, 4)}`
}

function laVeille(jour: string): string {
  // Sur le calendrier civil, sans fuseau : le jour d'avant, le 1er mars rendant le dernier jour de février.
  const [a, m, j] = jour.split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1, j - 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/**
 * Le manifeste rechargé confronté à la copie qu'il doit attester. L'empreinte décide seule (la base la recalcule) ; le reste
 * — l'identifiant, la date, le nombre de fichiers, la ligne de fin — dit POURQUOI un manifeste se refuse.
 */
export async function confronterLeManifeste(texte: string, copie: CopieAAttester): Promise<Confrontation> {
  const attendu = `la copie du ${jourFrancais(dateAParis(copie.faite_le))}`
  const id = new RegExp(`^${LIBELLE_IDENTIFIANT}([0-9a-f-]{36})$`, 'm').exec(texte)?.[1] ?? null
  if (id === null || !texte.startsWith('COPIE DES FICHIERS DES DOSSIERS DU CABINET\n')) {
    return { ok: false, raison: 'illisible', phrase: `Ce fichier n’est pas le manifeste d’une copie des fichiers : recharger le MANIFESTE.txt de ${attendu}.` }
  }
  if (id !== copie.id) {
    return { ok: false, raison: 'autre_copie', phrase: `Ce manifeste est celui d’une autre copie : recharger celui de ${attendu}, rangé avec son ZIP.` }
  }
  if (await sha256Hex(encodeur.encode(texte)) === copie.empreinte_du_manifeste) return { ok: true }
  // La date : celle du début de la fabrication, au plus la veille de l'enregistrement (une copie qui passe minuit).
  const jour = new RegExp(`^${LIBELLE_FABRIQUEE}(\\d{4}-\\d{2}-\\d{2}) \\(date de Paris\\)$`, 'm').exec(texte)?.[1] ?? null
  const jourDeLaCopie = dateAParis(copie.faite_le)
  if (jour === null || (jour !== jourDeLaCopie && jour !== laVeille(jourDeLaCopie))) {
    return { ok: false, raison: 'date', phrase: `La date de ce manifeste n’est pas celle de ${attendu} : il a été retouché. Recharger le MANIFESTE.txt tel que le ZIP le porte.` }
  }
  const fin = new RegExp(`^${DEBUT_DE_LA_FIN}(\\d+) fichier\\(s\\), dont (\\d+) dans le ZIP$`, 'm').exec(texte)
  const declares = /^Dossiers : \d+ ; fichiers : (\d+) ;/m.exec(texte)?.[1]
  const lignes = texte.slice(texte.indexOf(ENTETE_DES_FICHIERS)).split('\n').filter((l) => l.split('\t').length === 4).length
  if (fin === null || Number(fin[2]) !== lignes || texte.indexOf(ENTETE_DES_FICHIERS) < 0) {
    return { ok: false, raison: 'incomplet', phrase: `Ce manifeste est incomplet (sa fin ou des fichiers manquent) : recharger le MANIFESTE.txt entier de ${attendu}.` }
  }
  if (Number(declares) !== copie.nb_fichiers || Number(fin[1]) !== copie.nb_fichiers) {
    return { ok: false, raison: 'retouche', phrase: `Ce manifeste compte ${declares ?? '?'} fichier(s), ${attendu} en a produit ${copie.nb_fichiers} : il a été retouché.` }
  }
  return { ok: false, raison: 'retouche', phrase: `Ce manifeste a été retouché : son empreinte n’est plus celle que ${attendu} a produite. Recharger le MANIFESTE.txt tel que le ZIP le porte.` }
}

// ── Le rappel du tableau de bord ─────────────────────────────────────────────────────────────────────────────────────

export interface CopieEnregistree extends CopieAAttester {
  nb_ecarts: number
  nb_manquants: number
  /** Posé par le manifeste rechargé : la copie est faite (CFC-Q2). */
  rangee_le: string | null
}

/** La lecture des copies d'un cabinet : la dernière, et la dernière FAITE et COMPLÈTE (attestée, ni écart ni manquant). */
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

/** La copie qui attend son manifeste : la dernière, si elle n'est pas attestée. */
export function copieAAttester(lecture: LectureDesCopies | null): CopieEnregistree | null {
  return lecture !== null && lecture.lue && lecture.derniere !== null && lecture.derniere.rangee_le === null ? lecture.derniere : null
}

/** Ce que le tableau de bord dit ; `aujourdhui` est le jour de Paris (AAAA-MM-JJ). Lecture absente : rien. */
export function rappelDeLaCopie(lecture: LectureDesCopies | null, aujourdhui: string): RappelDeLaCopie {
  if (lecture === null) return { genre: 'rien' }
  if (!lecture.lue) {
    return { genre: 'illisible', phrase: 'La date de la dernière copie des fichiers n’a pas pu être lue.', motif: lecture.motif }
  }
  const complete = lecture.derniereComplete
  const derniere = lecture.derniere
  const plusRecente = derniere !== null && (complete === null || derniere.faite_le > complete.faite_le)
  const enAttente = plusRecente && derniere.rangee_le === null
    ? ` La copie du ${jourFrancais(dateAParis(derniere.faite_le))} attend son manifeste : le recharger pour qu’elle compte.`
    : ''
  const incomplete = plusRecente && derniere.rangee_le !== null
    ? ` La dernière copie, le ${jourFrancais(dateAParis(derniere.faite_le))}, avait ${derniere.nb_ecarts} écart(s) et ${derniere.nb_manquants} fichier(s) manquant(s).`
    : ''
  const suite = `${enAttente}${incomplete}`
  if (complete === null) {
    return { genre: 'rappel', phrase: `Aucune copie complète des fichiers des dossiers n’a encore été faite sur un support du cabinet.${suite}` }
  }
  const jour = dateAParis(complete.faite_le)
  if (unMoisApres(jour) < aujourdhui) {
    return { genre: 'rappel', phrase: `La dernière copie complète des fichiers date du ${jourFrancais(jour)}, il y a plus d’un mois : la refaire.${suite}` }
  }
  return { genre: 'a_jour', phrase: `Dernière copie complète des fichiers : le ${jourFrancais(jour)}.${suite}` }
}
