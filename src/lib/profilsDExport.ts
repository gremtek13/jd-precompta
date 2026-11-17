import type { NumerotationFec } from './fec'
import { cheminDuDossier, MOTIF_CHEMIN_HORS_DU_DOSSIER } from './cheminDuDossier'

// L'EXPORT VERS LE LOGICIEL COMPTABLE D'UN EXPERT-COMPTABLE (EXP1, demande du cabinet du 17/11/2026 ; la recherche :
// docs/conceptions/57-exports-vers-les-logiciels-comptables.md, § 3.1 ACD, § 4 les justificatifs, § 5 l'ordre).
//
// UN SEUL MOTEUR, DES PROFILS QUI METTENT EN FORME. Le fichier part du FEC RÉGLEMENTAIRE tel que l'onglet Écritures le
// produit (`numeroterFec`, le rendu des banques, puis `formaterFec`) : ce module le RELIT colonne par colonne et ne fait que
// le réécrire selon le profil — l'encodage, la longueur des comptes, les codes des journaux, la numérotation continue, les
// quatre champs du BNC, les à-nouveaux. Il ne recalcule aucune écriture, aucun montant, aucune date, aucune pièce : un
// export qui contredirait le FEC contredirait ce que la validation fige. Le FEC lui-même ne change pas d'un octet.
//
// LE PROFIL « ACD » (relevé sur un FEC produit par ACD pour un BNC, 17/11/2026, § 3.1 de la recherche) : tabulation, CRLF,
// Windows-1252, décimale à virgule et dates AAAAMMJJ (celles du FEC, inchangées), comptes complétés de zéros à la longueur
// du dossier ACD (huit dans le fichier relevé), EcritureNum un entier continu sur tout le fichier. Ce que nous NE
// recopions PAS d'ACD : sa PieceRef « AAAA-JJJJ-NNNNNN » (la nôtre est la référence neutre de la pièce, JJ1Q1-Q3, que le
// nom du justificatif reprend), et sa lettre de ModeRglt (R, V, B, P), dont la table n'est publiée nulle part : on ne la
// devine pas (EXP-E5).
//
// Rien de ce module n'écrit ni ne lit la base : pur, sans `supabase.ts`. La lecture des justificatifs et le ZIP vivent dans
// lib/exportVersUnLogicielLecture.ts.

/**
 * Le drapeau de l'écran : baissé, l'onglet Écritures ne montre rien de cet export. LEVÉ le 17/11/2026 sur la demande du
 * cabinet, pour l'essayer sur le dossier fictif, avant l'essai d'import chez l'expert-comptable (EXP-E1, EXP-E4) ; EXP-Q2 et
 * EXP-Q5 restent ouvertes, l'écran garde leurs options recommandées (les justificatifs sur une case, nos valeurs par défaut).
 */
export const EXPORT_VERS_UN_LOGICIEL_OFFERT: boolean = true

// ── L'ENCODAGE WINDOWS-1252 ──────────────────────────────────────────────────────────────────────────────────────────

// Les octets 0x80 à 0x9F de Windows-1252 (table de l'éditeur, « cp1252 », reprise par le WHATWG Encoding Standard, index
// « windows-1252 ») : le reste de la page — 0x00 à 0x7F et 0xA0 à 0xFF — est l'identité avec Unicode. Cinq octets n'y
// désignent aucun caractère (0x81, 0x8D, 0x8F, 0x90, 0x9D) : on ne les écrit jamais.
const HAUTS_DE_WINDOWS_1252: ReadonlyMap<number, number> = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87],
  [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e],
  [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
])

/** L'octet Windows-1252 d'un point de code, ou null s'il n'y en a pas (jamais un « ? » à sa place). */
export function octetWindows1252(pointDeCode: number): number | null {
  if (pointDeCode < 0x80 || (pointDeCode >= 0xa0 && pointDeCode <= 0xff)) return pointDeCode
  return HAUTS_DE_WINDOWS_1252.get(pointDeCode) ?? null
}

/** Le premier caractère d'un texte qui n'existe pas en Windows-1252, ou null. */
export function horsDeWindows1252(texte: string): string | null {
  for (const c of texte) if (octetWindows1252(c.codePointAt(0)!) === null) return c
  return null
}

/** Le texte en Windows-1252. Lève sur un caractère qui n'y existe pas : l'appelant les a refusés avant (`horsDeWindows1252`). */
export function encoderWindows1252(texte: string): Uint8Array {
  const octets: number[] = []
  for (const c of texte) {
    const o = octetWindows1252(c.codePointAt(0)!)
    if (o === null) throw new RangeError(`Le caractère ${pointDeCode(c)} n’existe pas en Windows-1252.`)
    octets.push(o)
  }
  return Uint8Array.from(octets)
}

/** « U+0103 », pour nommer un caractère qu'on ne sait pas toujours afficher. */
export function pointDeCode(c: string): string {
  return `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`
}

// ── LES PROFILS ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Les logiciels qui ont un profil. La liste est OUVERTE : un profil s'ajoute à l'essai d'un cabinet qui a le logiciel. */
export const PROFILS_D_EXPORT = [
  { id: 'acd', libelle: 'ACD (i-Suite Expert, Comptabilité Expert)' },
] as const
export type ProfilDExport = (typeof PROFILS_D_EXPORT)[number]['id']

/**
 * Les quatre champs d'un BNC en trésorerie dans le fichier (EXP-Q5, pas encore tranchée) : `nos_valeurs` (A, le défaut,
 * ceux du FEC), `sans_natop_ni_idclient` (B, comme ACD les produit : NatOp et IdClient vides, DateRglt et ModeRglt les
 * nôtres — jamais une lettre devinée), `vides` (C, les quatre vides). Sans objet pour un fichier à dix-huit colonnes.
 */
export type QuatreChampsDansLExport = 'nos_valeurs' | 'sans_natop_ni_idclient' | 'vides'

export const QUATRE_CHAMPS_DANS_L_EXPORT: readonly { id: QuatreChampsDansLExport; libelle: string }[] = [
  { id: 'nos_valeurs', libelle: 'Nos valeurs, comme le FEC' },
  { id: 'sans_natop_ni_idclient', libelle: 'NatOp et IdClient vides, comme ACD les écrit' },
  { id: 'vides', libelle: 'Les quatre champs vides' },
]

export interface ReglagesDuProfil {
  /** Le nombre de caractères d'un compte général dans le logiciel, de 6 à 12 ; les comptes se complètent de zéros à droite. */
  longueurDesComptes: number
  /** Nos codes de journaux → ceux du logiciel. Un code absent garde le nôtre. */
  journaux: Readonly<Record<string, string>>
  quatreChamps: QuatreChampsDansLExport
  /** Sans le journal des à-nouveaux : le logiciel a déjà ses propres à-nouveaux, les importer les doublerait. */
  sansANouveaux: boolean
}

export const LONGUEUR_DES_COMPTES_MIN = 6
export const LONGUEUR_DES_COMPTES_MAX = 12

/** Ce que l'écran PROPOSE pour ACD : huit chiffres (le FEC relevé), nos codes de journaux, nos valeurs, les à-nouveaux. */
export const REGLAGES_PROPOSES_ACD: ReglagesDuProfil = {
  longueurDesComptes: 8,
  journaux: {},
  quatreChamps: 'nos_valeurs',
  sansANouveaux: false,
}

/** Combien de refus l'écran nomme un par un ; le reste se compte. */
export const REFUS_NOMMES_AU_PLUS = 12

export interface CompteDeLExport { nous: string; eux: string }
export interface JournalDeLExport { nous: string; eux: string; libelle: string }

export type ExportMisEnForme =
  | {
    ok: true
    /** Le texte du fichier, avant son encodage. */
    texte: string
    /** Le fichier en Windows-1252, tel qu'il part. */
    octets: Uint8Array
    /** Le nombre d'écritures (EcritureNum distincts) et de lignes du fichier, en-tête exclu. */
    ecritures: number
    lignes: number
    /** Les EcritureNum du FEC, dans l'ordre du fichier, avec le numéro continu qu'ils prennent. */
    numeros: ReadonlyMap<string, number>
    comptes: CompteDeLExport[]
    journaux: JournalDeLExport[]
    /** Le fichier porte les vingt-deux colonnes d'un BNC en trésorerie. */
    vingtDeux: boolean
  }
  | { ok: false; refus: string[] }

const COLONNES_REQUISES = ['JournalCode', 'JournalLib', 'EcritureNum', 'CompteNum'] as const
const CODE_DE_JOURNAL = /^[A-Za-z0-9]+$/

function plafonner(refus: string[]): string[] {
  if (refus.length <= REFUS_NOMMES_AU_PLUS) return refus
  return [...refus.slice(0, REFUS_NOMMES_AU_PLUS), `… et ${refus.length - REFUS_NOMMES_AU_PLUS} autre(s) du même genre.`]
}

/**
 * Le FEC réglementaire (le texte de `formaterFec`) mis en forme pour ACD. Refuse, AVANT tout fichier, ce qui ne passerait
 * pas : une longueur de comptes hors de 6 à 12, un code de journal vide ou qui n'est pas fait de lettres et de chiffres, un
 * compte plus long que la longueur choisie, un caractère qui n'existe pas en Windows-1252 — chacun nommé par sa ligne du
 * fichier. Rien ne se remplace en silence : ni un caractère, ni un compte tronqué.
 */
export function mettreEnFormePourAcd(fec: string, reglages: ReglagesDuProfil): ExportMisEnForme {
  const refus: string[] = []
  const longueur = reglages.longueurDesComptes
  if (!Number.isInteger(longueur) || longueur < LONGUEUR_DES_COMPTES_MIN || longueur > LONGUEUR_DES_COMPTES_MAX) {
    refus.push(`La longueur des comptes va de ${LONGUEUR_DES_COMPTES_MIN} à ${LONGUEUR_DES_COMPTES_MAX} caractères.`)
  }
  for (const [nous, eux] of Object.entries(reglages.journaux)) {
    if (!CODE_DE_JOURNAL.test(eux)) {
      refus.push(`Le code du journal qui remplace « ${nous} » doit être fait de lettres et de chiffres, sans espace (« ${eux} »).`)
    }
  }
  if (refus.length > 0) return { ok: false, refus }

  const lignesDuFec = fec.split('\r\n')
  const entete = lignesDuFec[0]?.split('\t') ?? []
  const colonne = (nom: string) => entete.indexOf(nom)
  if (COLONNES_REQUISES.some((c) => colonne(c) < 0)) {
    return { ok: false, refus: ['Le FEC relu n’a pas les colonnes attendues : rien ne part.'] }
  }
  const iJournal = colonne('JournalCode')
  const iNum = colonne('EcritureNum')
  const iCompte = colonne('CompteNum')
  const vingtDeux = entete.length === 22 && colonne('NatOp') >= 0
  const iDateRglt = colonne('DateRglt')
  const iModeRglt = colonne('ModeRglt')
  const iNatOp = colonne('NatOp')
  const iIdClient = colonne('IdClient')

  const numeros = new Map<string, number>()
  const comptes = new Map<string, string>()
  const journaux = new Map<string, JournalDeLExport>()
  const tropLongs = new Map<string, string>()
  const horsEncodage: string[] = []
  const sortie: string[] = [entete.join('\t')]
  const caractereDeLEntete = horsDeWindows1252(sortie[0])
  if (caractereDeLEntete) horsEncodage.push(`Ligne 1 du fichier (l’en-tête) : le caractère ${pointDeCode(caractereDeLEntete)} n’existe pas en Windows-1252.`)

  for (const brute of lignesDuFec.slice(1)) {
    if (brute === '') continue
    const champs = brute.split('\t')
    if (champs.length !== entete.length) return { ok: false, refus: ['Une ligne du FEC relu n’a pas le nombre de colonnes de son en-tête : rien ne part.'] }
    const journal = champs[iJournal]
    if (reglages.sansANouveaux && journal === 'AN') continue
    const numeroDuFec = champs[iNum]
    if (!numeros.has(numeroDuFec)) numeros.set(numeroDuFec, numeros.size + 1)
    const numero = numeros.get(numeroDuFec)!
    const numeroDeLigne = sortie.length + 1

    const eux = reglages.journaux[journal] ?? journal
    if (!journaux.has(journal)) journaux.set(journal, { nous: journal, eux, libelle: champs[colonne('JournalLib')] })
    champs[iJournal] = eux
    champs[iNum] = String(numero)

    const compte = champs[iCompte]
    if (compte.length > longueur) {
      if (!tropLongs.has(compte)) {
        tropLongs.set(compte, `Ligne ${numeroDeLigne} du fichier (écriture ${numeroDuFec}) : le compte ${compte} a ${compte.length} caractères, `
          + `plus que la longueur choisie (${longueur}) — il ne se tronque pas.`)
      }
    } else {
      const complete = compte.padEnd(longueur, '0')
      comptes.set(compte, complete)
      champs[iCompte] = complete
    }

    if (vingtDeux && reglages.quatreChamps !== 'nos_valeurs') {
      champs[iNatOp] = ''
      champs[iIdClient] = ''
      if (reglages.quatreChamps === 'vides') { champs[iDateRglt] = ''; champs[iModeRglt] = '' }
    }

    const ligne = champs.join('\t')
    const c = horsDeWindows1252(ligne)
    if (c) {
      const nomDeLaColonne = entete[champs.findIndex((v) => horsDeWindows1252(v) !== null)]
      horsEncodage.push(`Ligne ${numeroDeLigne} du fichier (écriture ${numeroDuFec}, colonne ${nomDeLaColonne}) : le caractère « ${c} » `
        + `(${pointDeCode(c)}) n’existe pas en Windows-1252 — corrige le libellé dans l’application.`)
    }
    sortie.push(ligne)
  }

  const tousLesRefus = [...plafonner([...tropLongs.values()]), ...plafonner(horsEncodage)]
  if (tousLesRefus.length > 0) return { ok: false, refus: tousLesRefus }
  if (sortie.length === 1) return { ok: false, refus: ['Aucune écriture à exporter.'] }

  // Le fichier finit par une fin de ligne, comme celui qu'ACD produit lui-même (relevé du 17/11/2026) : sa dernière écriture
  // se termine comme les autres.
  const texte = sortie.join('\r\n') + '\r\n'
  return {
    ok: true, texte, octets: encoderWindows1252(texte), ecritures: numeros.size, lignes: sortie.length - 1, numeros,
    comptes: [...comptes].map(([nous, euxCompte]) => ({ nous, eux: euxCompte })).sort((a, b) => a.nous.localeCompare(b.nous)),
    journaux: [...journaux.values()],
    vingtDeux,
  }
}

/** Les codes de journaux d'un FEC, dans l'ordre du fichier : ceux que l'écran propose de faire correspondre. */
export function journauxDuFec(fec: string): { code: string; libelle: string }[] {
  const lignes = fec.split('\r\n')
  const entete = lignes[0]?.split('\t') ?? []
  const iCode = entete.indexOf('JournalCode')
  const iLib = entete.indexOf('JournalLib')
  if (iCode < 0 || iLib < 0) return []
  const vus = new Map<string, string>()
  for (const l of lignes.slice(1)) {
    const c = l.split('\t')
    if (c.length === entete.length && !vus.has(c[iCode])) vus.set(c[iCode], c[iLib])
  }
  return [...vus].map(([code, libelle]) => ({ code, libelle }))
}

// ── LES JUSTIFICATIFS (EXP-Q2, recommandation (A), pas encore tranchée : une case décochée par défaut) ────────────────

/** La forme de la référence neutre d'une pièce (`referenceDUnePiece`) : la seule qui nomme un fichier dans le ZIP. */
const REFERENCE_NEUTRE = /^\d{8}-[0-9a-f]{8}$/

/** Le poids des justificatifs avant sa mesure, ou pendant. */
export type PoidsInconnu = 'a_mesurer' | 'en_cours'

export interface PieceDesJustificatifs { id: string; storage_path: string }

export interface JustificatifAJoindre {
  pieceId: string
  /** La PieceRef de la pièce dans le fichier : le nom du justificatif, son extension en plus. */
  reference: string
  /** Le chemin du stockage : pour le télécharger, JAMAIS écrit dans le ZIP. */
  chemin: string
}

export interface JustificatifsDeLExport {
  aJoindre: JustificatifAJoindre[]
  /** Ce qui ne se joint pas, dit sans le nom du fichier ni son chemin. */
  ecartes: string[]
  /** Les écritures du fichier qui ne citent aucun justificatif joint (le relevé, la caisse, une dotation, la CA3…). */
  ecrituresSansJustificatif: number
}

/**
 * Les fichiers à joindre : chaque pièce que cite une écriture du fichier, une fois, sous sa PieceRef — la référence
 * neutre, jamais `pieces.nom_fichier`, qui nomme souvent un patient (RGPD.md, § 8.7). Une PieceRef qui n'a pas la forme
 * neutre (figée par une validation d'avant JJ1Q1-Q3), une pièce introuvable ou hors de son dossier, deux pièces sous la même
 * référence : écartées
 * et dites. `numeros` vient de la mise en forme : seules les écritures qui partent comptent.
 */
export function justificatifsDeLExport(
  dossierId: string, numerotation: NumerotationFec, pieces: readonly PieceDesJustificatifs[], numeros: ReadonlyMap<string, number>,
): JustificatifsDeLExport {
  const parId = new Map(pieces.map((p) => [p.id, p]))
  const aJoindre: JustificatifAJoindre[] = []
  const ecartes: string[] = []
  const joints = new Set<string>()
  const references = new Map<string, string>()
  const ecrituresJustifiees = new Set<string>()
  for (const l of numerotation.lignes) {
    const numero = `${l.journal}${String(l.numero).padStart(5, '0')}`
    const pieceId = l.ecriture.piece_id
    if (!pieceId || !numeros.has(numero)) continue
    if (joints.has(pieceId)) { ecrituresJustifiees.add(numero); continue }
    joints.add(pieceId)
    const piece = parId.get(pieceId)
    if (!piece) { ecartes.push(`Écriture ${numero} : sa pièce n’a pas été lue, aucun fichier joint.`); continue }
    if (!REFERENCE_NEUTRE.test(l.pieceRef)) {
      ecartes.push(`Écriture ${numero} : sa référence de pièce n’a pas la forme neutre (date et empreinte), aucun fichier joint.`)
      continue
    }
    // Un chemin qu'un client a pu poser hors de ce dossier ne se demande pas aux droits du cabinet (CFCS-Q1) : dit avant le
    // clic, et la fabrication le rejuge (lib/exportVersUnLogicielLecture.ts).
    if (!cheminDuDossier(piece.storage_path, dossierId)) { ecartes.push(`Écriture ${numero} : ${MOTIF_CHEMIN_HORS_DU_DOSSIER}.`); continue }
    const autre = references.get(l.pieceRef)
    if (autre !== undefined && autre !== pieceId) {
      ecartes.push(`Écriture ${numero} : une autre pièce porte la même référence (${l.pieceRef}), aucun second fichier joint.`)
      continue
    }
    references.set(l.pieceRef, pieceId)
    aJoindre.push({ pieceId, reference: l.pieceRef, chemin: piece.storage_path })
    ecrituresJustifiees.add(numero)
  }
  const ecrituresSansJustificatif = [...numeros.keys()].filter((n) => !ecrituresJustifiees.has(n)).length
  return { aJoindre, ecartes, ecrituresSansJustificatif }
}

/** L'extension d'un justificatif d'après le type que l'application a décidé (`typeDUnePiece`, lib/bornesStockage.ts). */
export function extensionDuType(type: string | null): string | null {
  switch (type) {
    case 'application/pdf': return 'pdf'
    case 'image/jpeg': return 'jpg'
    case 'image/png': return 'png'
    case 'text/csv': return 'csv'
    default: return null
  }
}

/** Le nom de l'archive : celui du FEC, en `.zip`. */
export function nomDeLArchive(nomDuFec: string): string {
  return nomDuFec.replace(/\.txt$/, '.zip')
}
