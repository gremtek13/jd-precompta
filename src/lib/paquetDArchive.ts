import JSZip from 'jszip'
import { referenceDUnePiece } from './fec'
import { empreinteDeDepot, sansEmpreinteDeDepot } from './empreinteDeDepot'
import { dateAParis } from './format'
import type { ExerciceValide, Piece } from './types'

// LE PAQUET D'ARCHIVE D'UN EXERCICE VALIDÉ (ligne 44, inaltérabilité, lot INAL3a ; conception « L'archivage des pièces »,
// HISTORIQUE.md, et INAL-Q8 à sa recommandation). Un ZIP qui se garde hors de la base : le FEC de l'exercice tel que
// l'application le relit des colonnes figées, la 2035 validée (`exercices_valides.declaration`, que la forme 2 scelle), les
// ORIGINAUX des pièces que les écritures validées citent — directement ou par leur bien, l'ensemble même que
// `empreinte_exercice_forme_2` compte —, la documentation des traitements en vigueur (INAL4) et un manifeste lisible.
//
// Ce module est PUR : il reçoit ce que `lib/paquetDArchiveLecture.ts` a lu EN ENTIER, ne lit rien et ne télécharge rien.
//
// CHAQUE ORIGINAL SE RELIT À SON EMPREINTE AVANT D'ENTRER (LPF, art. L102 B : le document sous la forme reçue) : son SHA-256
// recalculé sur les octets lus doit être celui que la pièce porte depuis son dépôt (`storage_hash`), que la forme 2 de
// l'empreinte scelle — d'où, côté lecture, `verifier_exercice_valide` d'abord. UN ÉCART, OU UNE EMPREINTE ILLISIBLE, REFUSE
// TOUT LE PAQUET ET LE DIT : jamais un paquet partiel, qui aurait l'air complet.
//
// UNE PIÈCE SANS EMPREINTE DE DÉPÔT (`storage_hash` nul ou vide : une pièce déposée avant que le dépôt la calcule) ENTRE
// MARQUÉE « NON VÉRIFIÉE » (INAL3-Q1, réponse du cabinet du 11/11/2026, contre la recommandation de la refuser) : son
// original est celui que le stockage rend au jour de la fabrication, rien ne prouve qu'il est celui du dépôt, et le
// manifeste le dit, pièce par pièce et en tête. L'écran le dit avant le clic (`piecesSansEmpreinte`, PaquetDArchiveBouton).
//
// AUCUN NOM DE FICHIER D'ORIGINE (le praticien nomme parfois un fichier d'après un patient) : un original s'appelle par la
// référence que le FEC lui donne en PieceRef (`referenceDUnePiece`, JJ1Q1-Q3 : « AAAAMMJJ-xxxxxxxx », la date et le début
// de l'empreinte), suivie de l'extension de son chemin ; le FEC par son nom imposé (SIREN), la 2035 par son exercice.
//
// LA PISTE D'AUDIT ET LE PDF DE LA 2035 (lot INAL3c, 12/11/2026). La piste d'audit de l'exercice est celle que l'onglet
// Écritures exporte (`genererPisteAuditCsv(pisteAudit(…))`, ses règles comprises : ni le nom d'un patient, ni le tiers d'une
// pièce de vente, ni le nom d'un fichier — JJ1Q1-Q1, JJ1Q1-Q2 ; un CSV avec BOM), produite au clic sur les écritures validées ;
// elle s'appelle par son exercice, jamais par le nom du dossier. PRODUITE EN PARTIE OU REFUSÉE, AUCUN PAQUET : c'est une
// pièce de l'archive au même titre que le FEC (`PisteDuPaquet`).
// Le PDF de la 2035 est REMPLI depuis les cases que la validation a figées (`formulaire` de l'instantané), par le code de
// l'onglet Clôture (lib/paquetDArchive2035.ts). Il n'est qu'une REPRÉSENTATION : ce qui fait foi est `2035-AAAA.json`, la
// valeur que l'empreinte de forme 2 scelle. S'il ne peut pas se faire (modèle introuvable ou illisible, instantané illisible),
// le paquet part SANS lui et LE DIT dans le manifeste et à l'écran : refuser tout le paquet pour un formulaire vierge qui ne
// se charge pas retiendrait l'archive (et, INAL5, la suppression du dossier) sur ce qui n'en est pas la preuve. Les cases
// qu'il n'a pas pu placer, et l'avertissement d'un millésime substitué (2035S-Q5), se disent de même.

// Ce que la lecture rend d'une pièce citée : jamais son nom de fichier.
export type PieceDuPaquet = Pick<Piece, 'id' | 'date_piece' | 'created_at' | 'storage_path' | 'storage_hash'>

export interface OriginalLu {
  piece: PieceDuPaquet
  octets: Uint8Array
}

// L'exercice tel que la base le garde, relu par la lecture du paquet (jamais celui d'un écran).
export type ExerciceDuPaquet = Pick<ExerciceValide,
  'dossier_id' | 'annee' | 'valide_le' | 'empreinte' | 'empreinte_precedente' | 'forme_empreinte' | 'nb_ecritures'
  | 'nb_lignes' | 'declaration'>

export interface EntreesDuPaquet {
  exercice: ExerciceDuPaquet
  // Les identifiants des pièces que l'exercice cite (`piecesCiteesParLExercice`) : chacune doit avoir son original.
  piecesCitees: readonly string[]
  originaux: readonly OriginalLu[]
  // Le FEC de l'exercice validé, tel que l'onglet Écritures l'exporte (`numerotationValidee` puis `formaterFec`).
  fec: { nom: string; contenu: string }
  // La piste d'audit de l'exercice, telle que l'onglet Écritures l'exporte, ou pourquoi elle n'a pas pu se produire.
  pisteAudit: PisteDuPaquet
  // Le PDF de la 2035 validée, ou pourquoi il n'a pas pu se remplir. Sans valeur par défaut : un appelant qui l'oublierait
  // ferait partir un paquet sans PDF que rien ne dirait.
  pdf2035: Pdf2035DuPaquet
  // La documentation des traitements que l'application porte (DOCUMENTATION_DES_TRAITEMENTS.md).
  documentation: string
  // L'instant de la fabrication : le manifeste en dit la date de Paris. Sans valeur par défaut (« maintenant » ne se lit
  // pas ici : un test le fixe).
  fabriqueLe: Date
}

export type PisteDuPaquet = { etat: 'produite'; contenu: string } | { etat: 'refusee'; motif: string }

export type Pdf2035DuPaquet =
  | {
    etat: 'rempli'
    octets: Uint8Array
    // Les cases dont le montant n'a pas pu se placer sur le formulaire (`codesSansAncrage`) : vide en temps normal.
    casesNonPlacees: readonly string[]
    // L'avertissement d'un millésime substitué (`avertissementDuFormulaire`, 2035S-Q5), ou nul.
    avertissement: string | null
  }
  | { etat: 'impossible'; motif: string }

export interface FichierDuManifeste { chemin: string; taille: number; sha256: string }

export type PaquetFabrique = {
  ok: true
  zip: Uint8Array
  manifeste: string
  // Les originaux entrés sans empreinte de dépôt, donc sans vérification (INAL3-Q1) : leur nombre.
  nonVerifiees: number
  // Le SHA-256 du manifeste : l'empreinte du paquet, celle qu'un horodatage scellera (INAL7, plus tard).
  empreinteDuManifeste: string
  fichiers: readonly FichierDuManifeste[]
  // Ce que l'écran dit du PDF de la 2035 quand il n'est pas entré, ou entré incomplet ; nul sinon.
  avisDuPdf2035: string | null
}
export type PaquetRefuse = { ok: false; message: string }

export const NOM_DU_MANIFESTE = 'MANIFESTE.txt'
export const NOM_DE_LA_DOCUMENTATION = 'DOCUMENTATION_DES_TRAITEMENTS.md'
export const DOSSIER_DES_ORIGINAUX = 'pieces'
export const ENTETE_DU_PDF_2035 = 'LE PDF DE LA 2035'
export function nomDeLaPisteAudit(annee: number): string { return `piste-audit-${annee}.csv` }
export function nomDuPdf2035(annee: number): string { return `2035-${annee}.pdf` }
const SHA256_HEX = /^[0-9a-f]{64}$/
/** Ce que le manifeste dit, à la place de l'empreinte de dépôt, d'une pièce qui n'en a pas (INAL3-Q1). */
export const MARQUE_NON_VERIFIEE = 'non vérifiée (aucune empreinte de dépôt)'

// L'empreinte de dépôt d'une pièce (lib/empreinteDeDepot.ts, la règle commune de l'absence) : une valeur présente mais
// d'une autre forme qu'un SHA-256 n'est PAS une absence, elle se refuse (`fabriquerLePaquet`).

/**
 * Les pièces citées par l'exercice qui n'ont pas d'empreinte de dépôt : elles entreront au paquet marquées « non
 * vérifiée ». L'écran le dit AVANT le clic, sur les pièces qu'il a lues ; une citée qu'il n'a pas lue n'y compte pas (la
 * lecture du paquet, elle, refuse une pièce introuvable).
 */
export function piecesSansEmpreinte(
  pieces: readonly Pick<PieceDuPaquet, 'id' | 'storage_hash'>[],
  piecesCitees: readonly string[],
): string[] {
  const citees = new Set(piecesCitees)
  return pieces.filter((p) => citees.has(p.id) && sansEmpreinteDeDepot(p)).map((p) => p.id).sort()
}

// Les pièces que les écritures VALIDÉES de l'exercice citent, directement ou par leur bien : l'ensemble que
// `empreinte_exercice_forme_2` compte (migration `empreinte_des_exercices_forme_2`). L'appelant ne passe que les lignes
// validées de l'exercice ; les identifiants, uniques et triés.
export function piecesCiteesParLExercice(
  lignes: readonly { piece_id: string | null; immobilisation_id: string | null }[],
  immobilisations: readonly { id: string; piece_id: string | null }[],
): string[] {
  const pieceDuBien = new Map(immobilisations.map((i) => [i.id, i.piece_id]))
  const ids = new Set<string>()
  for (const l of lignes) {
    if (l.piece_id) ids.add(l.piece_id)
    const parLeBien = l.immobilisation_id ? pieceDuBien.get(l.immobilisation_id) : null
    if (parLeBien) ids.add(parLeBien)
  }
  return [...ids].sort()
}

export async function sha256Hex(octets: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', octets as Uint8Array<ArrayBuffer>)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// L'extension d'un chemin de stockage, en minuscules, si elle a la forme d'une extension ; sinon « bin ».
function extensionDuChemin(chemin: string): string {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(chemin)
  return m ? m[1].toLowerCase() : 'bin'
}

// Le nom d'un original dans le paquet : sa référence au FEC et son extension ; deux pièces de même référence (le même
// fichier déposé deux fois le même jour) se distinguent par un rang, dans l'ordre des identifiants.
export function nomsDesOriginaux(pieces: readonly PieceDuPaquet[]): Map<string, string> {
  const noms = new Map<string, string>()
  const pris = new Set<string>()
  for (const p of [...pieces].sort((a, b) => a.id.localeCompare(b.id))) {
    const base = `${DOSSIER_DES_ORIGINAUX}/${referenceDUnePiece(p)}`
    const ext = extensionDuChemin(p.storage_path)
    let nom = `${base}.${ext}`
    for (let rang = 2; pris.has(nom); rang++) nom = `${base}-${rang}.${ext}`
    pris.add(nom)
    noms.set(p.id, nom)
  }
  return noms
}

export function nomDuPaquet(siret: string | null, annee: number): string {
  const siren = siret ? siret.replace(/\D/g, '').slice(0, 9) : ''
  return `${siren || 'A_COMPLETER'}-exercice-${annee}-archive.zip`
}

const encodeur = new TextEncoder()

export async function fabriquerLePaquet(e: EntreesDuPaquet): Promise<PaquetFabrique | PaquetRefuse> {
  const { exercice, fec } = e
  const refus = (message: string): PaquetRefuse => ({ ok: false, message: `Aucun paquet d’archive : ${message}` })
  if (fec.contenu.trim() === '') return refus(`le FEC de l’exercice ${exercice.annee} est vide.`)
  if (e.documentation.trim() === '') return refus('la documentation des traitements est absente.')
  if (e.pisteAudit.etat === 'refusee') return refus(`la piste d’audit de l’exercice n’a pas pu se produire (${e.pisteAudit.motif}).`)
  // Le PDF se remplit depuis la 2035 validée : sans elle, il ne peut venir que d'ailleurs.
  if (exercice.declaration === null && e.pdf2035.etat === 'rempli') return refus('un PDF de la 2035 sans 2035 validée.')
  if (e.pisteAudit.contenu.replace(/^\uFEFF/, '').trim() === '') return refus(`la piste d’audit de l’exercice ${exercice.annee} est vide.`)

  // Chaque pièce citée a son original, et seulement elles.
  const parId = new Map(e.originaux.map((o) => [o.piece.id, o]))
  const manquantes = e.piecesCitees.filter((id) => !parId.has(id))
  if (manquantes.length > 0) {
    return refus(`${manquantes.length} pièce(s) citée(s) par l’exercice n’ont pas été lue(s).`)
  }
  const citees = new Set(e.piecesCitees)
  if (e.originaux.some((o) => !citees.has(o.piece.id)) || parId.size !== e.originaux.length) {
    return refus('la lecture a rendu des fichiers que l’exercice ne cite pas.')
  }

  // Chaque original relu à son empreinte AVANT d'entrer : le premier écart arrête tout. Sans empreinte, il entre sans
  // vérification, et le manifeste le dit (INAL3-Q1).
  let nonVerifiees = 0
  for (const o of [...e.originaux].sort((a, b) => a.piece.id.localeCompare(b.piece.id))) {
    const ref = referenceDUnePiece(o.piece)
    const attendue = empreinteDeDepot(o.piece)
    if (attendue === null) {
      nonVerifiees++
      continue
    }
    if (!SHA256_HEX.test(attendue)) {
      return refus(`l’empreinte de dépôt de la pièce ${ref} est illisible : son original ne peut pas être vérifié.`)
    }
    const relue = await sha256Hex(o.octets)
    if (relue !== attendue) {
      return refus(
        `l’original de la pièce ${ref} ne correspond plus à son empreinte de dépôt (attendue ${attendue.slice(0, 16)}…, `
        + `relue ${relue.slice(0, 16)}…). Le fichier a changé dans le stockage : à signaler sans attendre.`,
      )
    }
  }

  const noms = nomsDesOriginaux(e.originaux.map((o) => o.piece))
  const contenus: { chemin: string; octets: Uint8Array }[] = [
    { chemin: fec.nom, octets: encodeur.encode(fec.contenu) },
    ...(exercice.declaration !== null
      ? [{ chemin: `2035-${exercice.annee}.json`, octets: encodeur.encode(JSON.stringify(exercice.declaration, null, 2)) }]
      : []),
    ...(e.pdf2035.etat === 'rempli' ? [{ chemin: nomDuPdf2035(exercice.annee), octets: e.pdf2035.octets }] : []),
    { chemin: nomDeLaPisteAudit(exercice.annee), octets: encodeur.encode(e.pisteAudit.contenu) },
    { chemin: NOM_DE_LA_DOCUMENTATION, octets: encodeur.encode(e.documentation) },
    ...[...e.originaux]
      .sort((a, b) => noms.get(a.piece.id)!.localeCompare(noms.get(b.piece.id)!))
      .map((o) => ({ chemin: noms.get(o.piece.id)!, octets: o.octets })),
  ]
  const fichiers: FichierDuManifeste[] = []
  for (const c of contenus) fichiers.push({ chemin: c.chemin, taille: c.octets.length, sha256: await sha256Hex(c.octets) })

  const manifeste = manifesteDuPaquet(e, fichiers, noms)
  const zip = new JSZip()
  // Une seule date pour toutes les entrées : celle de la fabrication (sinon JSZip date chaque entrée de son horloge).
  // Une copie dans le `Uint8Array` de la page : un tableau venu d'un autre domaine d'exécution (un `TextEncoder` d'ailleurs)
  // échappe au `instanceof` de JSZip, qui refuserait alors l'entrée.
  for (const c of contenus) zip.file(c.chemin, new Uint8Array(c.octets), { date: e.fabriqueLe, binary: true })
  zip.file(NOM_DU_MANIFESTE, manifeste, { date: e.fabriqueLe })
  const octets = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  return {
    ok: true, zip: octets, manifeste, nonVerifiees, empreinteDuManifeste: await sha256Hex(encodeur.encode(manifeste)), fichiers,
    avisDuPdf2035: exercice.declaration === null ? null : avisDuPdf2035(e.pdf2035),
  }
}

function avisDuPdf2035(pdf: Pdf2035DuPaquet): string | null {
  if (pdf.etat === 'impossible') return `le PDF de la 2035 n’est pas dans le paquet (${pdf.motif}) ; la 2035 validée y est en JSON.`
  if (pdf.casesNonPlacees.length > 0) {
    return `le PDF de la 2035 n’a pas pu placer les cases ${pdf.casesNonPlacees.join(', ')} : leur montant y manque (le JSON les porte).`
  }
  return null
}

// Ce que le manifeste dit du PDF de la 2035 : ce qu'il est, ce qui y manque, ou pourquoi il n'est pas là.
function sectionDuPdf2035(annee: number, pdf: Pdf2035DuPaquet): string[] {
  if (pdf.etat === 'impossible') {
    return [
      `${ENTETE_DU_PDF_2035} : NON PRODUIT — ${pdf.motif}`,
      `La 2035 validée est dans 2035-${annee}.json, qui fait foi ; le PDF se refait depuis l’onglet Clôture.`,
    ]
  }
  return [
    `${ENTETE_DU_PDF_2035} : ${nomDuPdf2035(annee)}, les pages 2035-A et 2035-B remplies depuis les cases que la validation a`,
    `figées (2035-${annee}.json, qui fait foi), par le même code que l’onglet Clôture. L’annexe 2035-E n’y est pas portée : la`,
    'validation ne la fige pas (ses lignes se tirent de saisies et du forfait kilométrique tels qu’ils sont au jour du calcul).',
    ...(pdf.avertissement ? [`AVERTISSEMENT : ${pdf.avertissement}`] : []),
    ...(pdf.casesNonPlacees.length > 0
      ? [`CASES NON PLACÉES SUR LE PDF (leur montant y manque) : ${pdf.casesNonPlacees.join(', ')}`]
      : []),
  ]
}

export const ENTETE_DES_FICHIERS = 'FICHIERS (chemin, taille en octets, SHA-256)'

function manifesteDuPaquet(e: EntreesDuPaquet, fichiers: readonly FichierDuManifeste[], noms: ReadonlyMap<string, string>): string {
  const x = e.exercice
  const forme = x.forme_empreinte === 2
    ? '2 — elle scelle les écritures validées, les à-nouveaux, les soldes reportés, l’en-tête de la validation, les empreintes de dépôt des pièces citées et la 2035 validée'
    : '1 — elle scelle les écritures validées, les à-nouveaux et les soldes reportés, pas les fichiers des pièces : leurs empreintes ci-dessous sont celles de leur dépôt'
  const pieces = [...e.originaux]
    .sort((a, b) => noms.get(a.piece.id)!.localeCompare(noms.get(b.piece.id)!))
    .map((o) => `${noms.get(o.piece.id)}\t${o.piece.id}\t${empreinteDeDepot(o.piece) ?? MARQUE_NON_VERIFIEE}`)
  const nonVerifiees = e.originaux.filter((o) => empreinteDeDepot(o.piece) === null).length
  return [
    `PAQUET D'ARCHIVE — EXERCICE ${x.annee} VALIDÉ`,
    '',
    `Dossier : ${x.dossier_id}`,
    `Exercice : du ${x.annee}-01-01 au ${x.annee}-12-31`,
    `Validé le : ${dateAParis(x.valide_le)} (date de Paris ; instant ${x.valide_le})`,
    `Écritures validées : ${x.nb_ecritures} ; lignes : ${x.nb_lignes}`,
    `Forme de l'empreinte : ${forme}`,
    `Empreinte de l'exercice : ${x.empreinte}`,
    `Empreinte de l'exercice validé précédent : ${x.empreinte_precedente ?? 'aucune (premier exercice validé du dossier)'}`,
    `Fabriqué le : ${dateAParis(e.fabriqueLe)} (date de Paris)`,
    '',
    'Avant d’entrer dans ce paquet, l’empreinte de l’exercice a été vérifiée en base (verifier_exercice_valide) et chaque',
    'original relu à son empreinte de dépôt. La 2035 est celle que la validation a figée ; le FEC, celui que l’application',
    'relit des écritures validées (son lettrage dit l’état des comptes de tiers au jour de la fabrication). La documentation',
    'des traitements est celle que l’application portait au jour de la fabrication. La piste d’audit est celle que l’onglet',
    'Écritures produit des écritures validées (les justificatifs et les mouvements y sont désignés sans nom de fichier).',
    ...(nonVerifiees > 0
      ? [
        '',
        `PIÈCES NON VÉRIFIÉES : ${nonVerifiees}. Ces pièces n’ont pas d’empreinte de dépôt ; leur original est celui que le`,
        'stockage rendait au jour de la fabrication, et rien ne prouve qu’il est celui du dépôt. Elles sont marquées',
        `« ${MARQUE_NON_VERIFIEE} » dans la liste des pièces citées.`,
      ]
      : []),
    '',
    ...(x.declaration !== null
      ? sectionDuPdf2035(x.annee, e.pdf2035)
      : [`${ENTETE_DU_PDF_2035} : aucun — la validation de cet exercice n’a figé aucune 2035.`]),
    '',
    ENTETE_DES_FICHIERS,
    ...fichiers.map((f) => `${f.chemin}\t${f.taille}\t${f.sha256}`),
    '',
    `PIÈCES CITÉES (${pieces.length} ; fichier, identifiant de la pièce, empreinte de dépôt — le nom du fichier est sa PieceRef au FEC)`,
    ...pieces,
    '',
  ].join('\n')
}
