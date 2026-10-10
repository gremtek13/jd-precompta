import { cleFournisseur, formatDate } from './format'
import { ETATS_MEMBRES_HORS_FRANCE, NUMERO_G105, ficheCourante, montantDansSaDevise, prefixeTva, type SaisieFiche } from './piecesHorsDeFrance'
import type { CodeTvaHorsDeFrance, NatureAchatHorsDeFrance, Piece, PieceHorsDeFrance, PieceHorsDeFranceTaux } from './types'

// LA FICHE « FOURNISSEUR ÉTABLI HORS DE FRANCE » À L'ÉCRAN (ligne 28.5, e-reporting, troisième temps e3 ; conception du
// 09/10/2026, HISTORIQUE.md, « L'E-REPORTING : LA CONCEPTION », § 4.4) : ce qui s'en PROPOSE, et ce que l'écran en dit.
//
// LES PROPOSITIONS se tirent de ce que l'application a DÉJÀ : le texte lu sur le document au dépôt (`piece_textes_ocr`),
// la pièce elle-même, et la fiche d'une autre pièce du même fournisseur dans le dossier. Aucun modèle, aucun appel
// réseau : des expressions régulières sur un texte déjà stocké, et c'est tout. Une proposition n'est JAMAIS appliquée
// seule — l'écran la montre avec ce qui la fonde (`Source`), et seul un clic la reprend dans la saisie —, parce que le
// texte d'un document se trompe : un numéro de TVA lu peut être celui d'une filiale, un numéro de facture celui d'une
// commande. La base juge ensuite ce que le cabinet a retenu (`refusFicheHorsDeFrance`, lib/piecesHorsDeFrance.ts).
//
// LES SIGNAUX disent pourquoi une pièce d'achat SANS fiche en mérite peut-être une : un document dans une autre devise,
// un numéro de TVA d'un autre État de l'Union ou une mention d'autoliquidation lus dans son texte, un fournisseur déjà
// décrit dans le dossier. Ils ne posent rien : la fiche reste à saisir.
//
// Un module PUR : il ne lit ni la base ni l'horloge. Les fiches et la ventilation du dossier lui sont passées lues EN
// ENTIER (`LectureFichesHorsDeFrance`, lue par lib/piecesHorsDeFranceLecture.ts), les pièces du dossier aussi, ou `null`
// quand leur liste est lue en partie : la fiche d'un même fournisseur ne se reprend alors pas, faute de savoir laquelle
// est la dernière.

// ── Ce que l'écran reçoit de la lecture ─────────────────────────────────────────────────────────────────────────────

/** Les fiches du dossier, toutes versions et retirées comprises, et leur ventilation ; `motif` non nul quand l'une des
 * deux lectures est partielle — l'écran n'en montre ni n'en offre alors rien. */
export interface LectureFichesHorsDeFrance {
  fiches: PieceHorsDeFrance[]
  taux: PieceHorsDeFranceTaux[]
  motif: string | null
}

// ── Les numéros de TVA de l'Union ───────────────────────────────────────────────────────────────────────────────────

/**
 * LA STRUCTURE D'UN NUMÉRO DE TVA, ÉTAT PAR ÉTAT, sans son préfixe : celle que publie la Commission européenne pour le
 * service de vérification VIES (« VIES — VAT number validation », structure des numéros). Elle ne sert qu'à RECONNAÎTRE
 * un numéro dans un texte : la règle que la base applique reste `NUMERO_TVA_UNION`, plus large. Un format manquant ou en
 * trop se voit au test, qui la confronte aux vingt-six États de `ETATS_MEMBRES_HORS_FRANCE` (préfixe EL pour la Grèce).
 */
export const FORMATS_TVA_UNION: Readonly<Record<string, RegExp>> = {
  AT: /^U\d{8}$/, BE: /^[01]\d{9}$/, BG: /^\d{9,10}$/, CY: /^\d{8}[A-Z]$/, CZ: /^\d{8,10}$/, DE: /^\d{9}$/,
  DK: /^\d{8}$/, EE: /^\d{9}$/, EL: /^\d{9}$/, ES: /^[A-Z0-9]\d{7}[A-Z0-9]$/, FI: /^\d{8}$/, HR: /^\d{11}$/,
  HU: /^\d{8}$/, IE: /^\d[A-Z0-9+*]\d{5}[A-Z]{1,2}$/, IT: /^\d{11}$/, LT: /^(?:\d{9}|\d{12})$/, LU: /^\d{8}$/,
  LV: /^\d{11}$/, MT: /^\d{8}$/, NL: /^\d{9}B\d{2}$/, PL: /^\d{10}$/, PT: /^\d{9}$/, RO: /^[1-9]\d{1,9}$/,
  SE: /^\d{12}$/, SI: /^\d{8}$/, SK: /^\d{10}$/,
}

// Un candidat : le préfixe d'un État, au début d'un mot, puis des caractères de numéro, que l'impression sépare parfois
// d'une espace, d'un point ou d'un tiret (« DE 123 456 789 », « BE 0123.456.789 »). Les capitales seulement : un préfixe
// s'imprime ainsi, et « de », « it » ou « es » en minuscules sont des mots.
const SEPARATEUR = /[ .\- ]/
const CANDIDAT_TVA = new RegExp(
  `(?<![A-Za-z0-9])(${Object.keys(FORMATS_TVA_UNION).join('|')})((?:[ .\\-\\u00a0]?[0-9A-Z+*]){2,16})`,
  'g',
)

export interface NumeroTvaLu {
  /** Le numéro tel que la fiche l'écrit : préfixe et caractères, sans séparateur. */
  numero: string
  /** Le pays du fournisseur (GR pour le préfixe EL). */
  pays: string
  /** Le numéro tel qu'imprimé. */
  extrait: string
}

/** Les numéros de TVA d'un autre État de l'Union que porte un texte, chacun une fois, dans l'ordre de lecture. Le plus
 * long qui a la structure de son État ; jamais un morceau d'un nombre plus long (« DE1234567890 » n'en porte aucun). */
export function numerosTvaLus(texte: string): NumeroTvaLu[] {
  const lus: NumeroTvaLu[] = []
  for (const m of texte.matchAll(CANDIDAT_TVA)) {
    const prefixe = m[1]
    const brut = m[2]
    const significatifs: { c: string; fin: number }[] = []
    for (let i = 0; i < brut.length; i++) if (!SEPARATEUR.test(brut[i])) significatifs.push({ c: brut[i], fin: i + 1 })
    for (let n = significatifs.length; n >= 1; n--) {
      const corps = significatifs.slice(0, n).map((s) => s.c).join('')
      const suivant = brut[significatifs[n - 1].fin]
      // Collé au caractère suivant, ce n'est que le début d'un nombre plus long.
      if (suivant !== undefined && !SEPARATEUR.test(suivant)) continue
      if (!FORMATS_TVA_UNION[prefixe].test(corps)) continue
      const numero = prefixe + corps
      if (!lus.some((l) => l.numero === numero)) {
        lus.push({ numero, pays: prefixe === 'EL' ? 'GR' : prefixe, extrait: prefixe + brut.slice(0, significatifs[n - 1].fin) })
      }
      break
    }
  }
  return lus
}

// ── Le texte plié ──────────────────────────────────────────────────────────────────────────────────────────────────

// Le texte en minuscules et sans accents, pour chercher une mention quelle que soit sa graphie, avec pour chaque
// caractère plié sa position dans l'original : l'extrait montré est celui du document, jamais sa version pliée.
function plier(texte: string): { plie: string; origine: number[] } {
  let plie = ''
  const origine: number[] = []
  let i = 0
  for (const c of texte) {
    const p = c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    plie += p
    for (let k = 0; k < p.length; k++) origine.push(i)
    i += c.length
  }
  origine.push(i)
  return { plie, origine }
}

// La ligne du document qui porte une position, telle qu'imprimée, sans ses blancs de bord ; une ligne très longue se
// coupe autour de la mention.
function ligneAutour(texte: string, debut: number, fin: number): string {
  const avant = texte.lastIndexOf('\n', debut - 1) + 1
  const apres = texte.indexOf('\n', fin)
  const ligne = texte.slice(avant, apres === -1 ? texte.length : apres).trim()
  if ([...ligne].length <= 160) return ligne
  const centre = texte.slice(Math.max(avant, debut - 60), Math.min(apres === -1 ? texte.length : apres, fin + 60)).trim()
  return `…${centre}…`
}

// ── La mention d'autoliquidation ─────────────────────────────────────────────────────────────────────────────────

/**
 * Les mentions par lesquelles une facture dit que la TVA est due par l'acheteur, dans les langues de l'Union qu'on
 * rencontre le plus (directive 2006/112/CE, art. 196 et 226, 11 bis : « Autoliquidation » ; ses traductions dans les
 * versions linguistiques de la directive). Cherchées dans le texte plié : minuscules, sans accents.
 */
export const MENTIONS_AUTOLIQUIDATION: readonly RegExp[] = [
  /reverse[\s-]*charge/,
  /auto[\s-]*liquid/,
  /steuerschuldnerschaft des leistungsempfangers/,
  /inversione contabile/,
  /inversion del sujeto pasivo/,
  /\bbtw[\s-]*verlegd\b/,
  /odwrotne obciazenie/,
  /omvendt betalingspligt/,
  /omvand skattskyldighet/,
  /\b(?:article|art\.?|artikel|articolo|articulo)\s*196\b/,
]

/** La première mention d'autoliquidation du texte, en sa ligne telle qu'imprimée, ou rien. */
export function mentionAutoliquidation(texte: string): string | null {
  const { plie, origine } = plier(texte)
  let premiere: { debut: number; fin: number } | null = null
  for (const motif of MENTIONS_AUTOLIQUIDATION) {
    const m = motif.exec(plie)
    if (m && (premiere === null || m.index < premiere.debut)) premiere = { debut: m.index, fin: m.index + m[0].length }
  }
  return premiere === null ? null : ligneAutour(texte, origine[premiere.debut], origine[premiere.fin])
}

// ── Le numéro de la facture ───────────────────────────────────────────────────────────────────────────────────────

// L'étiquette d'un numéro de facture, puis le numéro : « Facture n° 2026-0818 », « Invoice number: INV-42 »,
// « Rechnungsnummer RE-7 », « Factuurnummer 7 », « Fatura FT-12 », « N° de facture : A12 ». Cherchées dans le texte plié ; le numéro se relit dans l'original.
const ETIQUETTES_NUMERO: readonly RegExp[] = [
  /(?:invoice|facture|rechnungsnummer|rechnungs-?nr\.?|rechnung|factuurnummer|factuur|factura|fattura|fatura|receipt|recu)(?:[ \t]*(?:number|numero|nummer|nr|no|num|n°|nº|#)\.?)?[ \t]*[:#]?\s*([a-z0-9][a-z0-9+_/-]{2,34})/g,
  /(?:n°|nº|no\.|numero|number)[ \t]*(?:de[ \t]+(?:la[ \t]+)?|of[ \t]+)?(?:facture|invoice|factuur|factura|fattura|fatura)[ \t]*[:#]?\s*([a-z0-9][a-z0-9+_/-]{2,34})/g,
]
const RESSEMBLE_A_UNE_DATE = /^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}$/

export interface NumeroFactureLu {
  numero: string
  extrait: string
}

/** Les numéros de facture que porte un texte, après leur étiquette, chacun une fois et dans l'ordre de lecture. Un
 * numéro a au moins trois caractères, dont un chiffre, et la forme de la règle G1.05 ; une date n'en est pas un. */
export function numerosFactureLus(texte: string): NumeroFactureLu[] {
  const { plie, origine } = plier(texte)
  const trouves: (NumeroFactureLu & { position: number })[] = []
  for (const motif of ETIQUETTES_NUMERO) {
    for (const m of plie.matchAll(motif)) {
      const debutValeur = m.index + m[0].length - m[1].length
      const numero = texte.slice(origine[debutValeur], origine[m.index + m[0].length])
      if (!/\d/.test(numero) || [...numero].length > 35 || !NUMERO_G105.test(numero) || RESSEMBLE_A_UNE_DATE.test(numero)) continue
      if (trouves.some((t) => t.numero === numero)) continue
      trouves.push({ numero, extrait: texte.slice(origine[m.index], origine[m.index + m[0].length]).replace(/\s+/g, ' '), position: m.index })
    }
  }
  return trouves.sort((a, b) => a.position - b.position).map(({ numero, extrait }) => ({ numero, extrait }))
}

// ── La fiche d'un même fournisseur ────────────────────────────────────────────────────────────────────────────────

export interface FicheDuFournisseur {
  fiche: PieceHorsDeFrance
  piece: Pick<Piece, 'id' | 'tiers' | 'date_piece'>
  lignes: PieceHorsDeFranceTaux[]
}

/** La fiche courante, non retirée, la plus récente d'une AUTRE pièce du même fournisseur (`cleFournisseur`), ou rien :
 * rien non plus quand la liste des pièces est lue en partie, ou que le tiers ne désigne aucun fournisseur. */
export function ficheDuMemeFournisseur(
  piece: Pick<Piece, 'id' | 'tiers'>,
  lecture: Pick<LectureFichesHorsDeFrance, 'fiches' | 'taux'>,
  pieces: readonly Pick<Piece, 'id' | 'tiers' | 'date_piece'>[] | null,
): FicheDuFournisseur | null {
  const cle = cleFournisseur(piece.tiers)
  if (cle === null || pieces === null) return null
  let retenue: FicheDuFournisseur | null = null
  for (const autre of pieces) {
    if (autre.id === piece.id || cleFournisseur(autre.tiers) !== cle) continue
    const id = ficheCourante(lecture.fiches, autre.id)
    const fiche = lecture.fiches.find((f) => f.id === id)
    if (!fiche || fiche.retire_le !== null) continue
    if (retenue === null || Date.parse(fiche.cree_le) > Date.parse(retenue.fiche.cree_le)) {
      retenue = { fiche, piece: autre, lignes: lecture.taux.filter((t) => t.fiche_id === fiche.id) }
    }
  }
  return retenue
}

// ── Les propositions ──────────────────────────────────────────────────────────────────────────────────────────────

/** D'où vient une proposition : ce que l'écran dit à côté d'elle. */
export interface Source {
  genre: 'texte' | 'piece' | 'fiche_du_fournisseur'
  /** « lu dans le texte du document », « la date de la pièce »… */
  libelle: string
  /** Le passage du document qui la fonde, tel qu'imprimé, pour une proposition lue dans le texte. */
  extrait: string | null
}

export interface LigneProposee {
  code: CodeTvaHorsDeFrance | null
  /** Positive, en centimes de la devise de la pièce. */
  centimes: number
}

export type Proposition =
  | { champ: 'numero' | 'date_facture' | 'pays' | 'identifiant'; valeur: string; source: Source }
  | { champ: 'nature'; valeur: NatureAchatHorsDeFrance; source: Source }
  | { champ: 'autoliquidation'; valeur: boolean; source: Source }
  | { champ: 'ventilation'; valeur: LigneProposee; source: Source }

export interface DonneesDesPropositions {
  piece: Pick<Piece, 'id' | 'tiers' | 'date_piece' | 'devise' | 'montant_ttc' | 'montant_devise'>
  /** Le texte lu sur le document, ou rien (jamais lu, ou sa lecture refusée). */
  texte: string | null
  lecture: Pick<LectureFichesHorsDeFrance, 'fiches' | 'taux'>
  /** Les pièces du dossier ; null quand leur liste est lue en partie. */
  pieces: readonly Pick<Piece, 'id' | 'tiers' | 'date_piece'>[] | null
  /** Le pays déjà choisi dans la saisie : l'identifiant d'un fournisseur hors de l'Union se propose d'après lui. */
  paysSaisi: string | null
}

const TEXTE: Source['libelle'] = 'lu dans le texte du document'
// Trois au plus par champ : au-delà, le texte n'apprend plus rien qui vaille d'être montré.
const AU_PLUS = 3

/** Les seize premiers caractères d'un nom, après le code de son pays : l'identifiant d'un fournisseur établi hors de
 * l'Union (règle G2.19, schéma 0227), sans espace en tête ni en fin — la base les refuse. */
export function identifiantHorsUnion(pays: string, nom: string): string | null {
  const debut = [...nom.trim()].slice(0, 16).join('').replace(/\s+$/, '')
  return debut === '' ? null : `${pays}${debut}`
}

/**
 * CE QUE L'ÉCRAN PEUT PROPOSER pour la fiche d'une pièce, chaque proposition avec sa source, dans l'ordre des champs —
 * et pour un même champ, ce que le texte lit d'abord, puis la fiche du même fournisseur, puis la pièce. Une même valeur
 * ne se propose qu'une fois par champ.
 */
export function propositionsDeLaFiche(d: DonneesDesPropositions): Proposition[] {
  const texte = d.texte ?? ''
  const tva = numerosTvaLus(texte)
  const mention = mentionAutoliquidation(texte)
  const memeFournisseur = ficheDuMemeFournisseur(d.piece, d.lecture, d.pieces)
  const deLaFiche: Source | null = memeFournisseur === null ? null : {
    genre: 'fiche_du_fournisseur',
    libelle: `la fiche de la pièce du ${formatDate(memeFournisseur.piece.date_piece)}, du même fournisseur`,
    extrait: null,
  }
  const brutes: Proposition[] = []

  for (const n of numerosFactureLus(texte).slice(0, AU_PLUS)) {
    brutes.push({ champ: 'numero', valeur: n.numero, source: { genre: 'texte', libelle: TEXTE, extrait: n.extrait } })
  }
  if (d.piece.date_piece) {
    brutes.push({ champ: 'date_facture', valeur: d.piece.date_piece, source: { genre: 'piece', libelle: 'la date de la pièce', extrait: null } })
  }
  for (const n of tva.slice(0, AU_PLUS)) {
    brutes.push({ champ: 'pays', valeur: n.pays, source: { genre: 'texte', libelle: `${TEXTE}, d’après le préfixe du numéro de TVA`, extrait: n.extrait } })
  }
  if (memeFournisseur && deLaFiche) brutes.push({ champ: 'pays', valeur: memeFournisseur.fiche.pays, source: deLaFiche })
  for (const n of tva.slice(0, AU_PLUS)) {
    brutes.push({ champ: 'identifiant', valeur: n.numero, source: { genre: 'texte', libelle: TEXTE, extrait: n.extrait } })
  }
  if (memeFournisseur && deLaFiche) brutes.push({ champ: 'identifiant', valeur: memeFournisseur.fiche.identifiant, source: deLaFiche })
  const pays = d.paysSaisi
  if (pays && /^[A-Z]{2}$/.test(pays) && !ETATS_MEMBRES_HORS_FRANCE.includes(pays) && d.piece.tiers) {
    const identifiant = identifiantHorsUnion(pays, d.piece.tiers)
    if (identifiant) {
      brutes.push({
        champ: 'identifiant', valeur: identifiant,
        source: { genre: 'piece', libelle: 'le code du pays choisi et les seize premiers caractères du tiers de la pièce', extrait: null },
      })
    }
  }
  if (memeFournisseur && deLaFiche) brutes.push({ champ: 'nature', valeur: memeFournisseur.fiche.nature, source: deLaFiche })
  if (mention) brutes.push({ champ: 'autoliquidation', valeur: true, source: { genre: 'texte', libelle: TEXTE, extrait: mention } })
  if (memeFournisseur && deLaFiche) brutes.push({ champ: 'autoliquidation', valeur: memeFournisseur.fiche.autoliquidation, source: deLaFiche })

  const ttc = montantDansSaDevise(d.piece)
  if (ttc != null && ttc !== 0) {
    const centimes = Math.round(Math.abs(ttc) * 100)
    const codeDuFournisseur = memeFournisseur && memeFournisseur.lignes.length === 1 ? memeFournisseur.lignes[0].code_tva : null
    const code: CodeTvaHorsDeFrance | null = mention ? 'AE' : codeDuFournisseur
    brutes.push({
      champ: 'ventilation', valeur: { code, centimes },
      source: {
        genre: 'piece',
        libelle: `le montant TTC de la pièce dans sa devise${mention ? ', au code de l’autoliquidation (AE) que la mention lue suggère'
          : codeDuFournisseur ? `, au code de ${deLaFiche?.libelle}` : ''}`,
        extrait: mention,
      },
    })
  }

  const vues = new Set<string>()
  return brutes.filter((p) => {
    const cle = `${p.champ}:${JSON.stringify(p.valeur)}`
    if (vues.has(cle)) return false
    vues.add(cle)
    return true
  })
}

// ── Les signaux ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface Signal {
  genre: 'devise' | 'numero_tva' | 'autoliquidation' | 'fournisseur'
  phrase: string
}

/** Le nom d'un pays en français (« Allemagne »), ou son code si le navigateur ne le connaît pas. */
export function nomDuPays(code: string): string {
  try {
    return new Intl.DisplayNames(['fr'], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

/** Pourquoi cette pièce d'achat mérite peut-être une fiche : chaque signal dit ce qui a été vu, et où. */
export function signauxHorsDeFrance(d: Omit<DonneesDesPropositions, 'paysSaisi'>): Signal[] {
  const signaux: Signal[] = []
  if (d.piece.devise !== 'EUR') signaux.push({ genre: 'devise', phrase: `Le document est en ${d.piece.devise}.` })
  const texte = d.texte ?? ''
  for (const n of numerosTvaLus(texte).slice(0, AU_PLUS)) {
    signaux.push({
      genre: 'numero_tva',
      phrase: `Son texte porte un numéro de TVA ${n.pays === 'GR' ? 'grec' : `d’un autre État de l’Union (${nomDuPays(n.pays)})`} : « ${n.extrait} ».`,
    })
  }
  const mention = mentionAutoliquidation(texte)
  if (mention) signaux.push({ genre: 'autoliquidation', phrase: `Son texte porte une mention d’autoliquidation : « ${mention} ».` })
  const memeFournisseur = ficheDuMemeFournisseur(d.piece, d.lecture, d.pieces)
  if (memeFournisseur) {
    signaux.push({
      genre: 'fournisseur',
      phrase: `Ce fournisseur a déjà une fiche « hors de France » dans ce dossier (pièce du ${formatDate(memeFournisseur.piece.date_piece)}).`,
    })
  }
  return signaux
}

// ── Ce que l'écran dit d'une fiche enregistrée ────────────────────────────────────────────────────────────────────

/** Les versions de la fiche d'une pièce, de la COURANTE à la première ; vide si la pièce n'en a pas. */
export function versionsDeLaPiece(fiches: readonly PieceHorsDeFrance[], pieceId: string): PieceHorsDeFrance[] {
  const versions: PieceHorsDeFrance[] = []
  const id = ficheCourante(fiches, pieceId)
  for (let f = fiches.find((x) => x.id === id); f && !versions.includes(f); f = fiches.find((x) => x.id === f!.remplace_id)) {
    versions.push(f)
  }
  return versions
}

/** La ventilation d'une version, dans l'ordre des codes de la règle G2.31 puis des taux. */
export function ventilationDe(taux: readonly PieceHorsDeFranceTaux[], ficheId: string): PieceHorsDeFranceTaux[] {
  const ordre: readonly CodeTvaHorsDeFrance[] = ['S', 'E', 'AE', 'K', 'G', 'O', 'Z']
  return taux.filter((t) => t.fiche_id === ficheId)
    .sort((a, b) => ordre.indexOf(a.code_tva) - ordre.indexOf(b.code_tva) || a.taux - b.taux)
}

/** Une version enregistrée, relue comme une saisie : ce qu'elle redonnerait à la fonction, pour la reprendre ou la
 * rejuger contre la pièce telle qu'elle est aujourd'hui. */
export function saisieDeLaFiche(fiche: PieceHorsDeFrance, lignes: readonly PieceHorsDeFranceTaux[]): SaisieFiche {
  return {
    numero: fiche.numero, date_facture: fiche.date_facture, type_document: fiche.type_document,
    facture_origine_numero: fiche.facture_origine_numero, facture_origine_date: fiche.facture_origine_date,
    pays: fiche.pays, schema_identifiant: fiche.schema_identifiant, identifiant: fiche.identifiant, nature: fiche.nature,
    autoliquidation: fiche.autoliquidation, date_operation: fiche.date_operation,
    periode_debut: fiche.periode_debut, periode_fin: fiche.periode_fin,
    taux: lignes.map((l) => ({
      code: l.code_tva, taux: l.taux, base: l.base, tva: l.tva,
      ...(l.motif_code !== null ? { motif_code: l.motif_code } : {}),
      ...(l.motif_texte !== null ? { motif_texte: l.motif_texte } : {}),
    })),
  }
}

/** Une fiche nommée en une ligne : « la facture n° INV-42 du 12/03/2026 (Irlande) ». */
export function ficheEnMots(fiche: Pick<PieceHorsDeFrance, 'numero' | 'date_facture' | 'type_document' | 'pays'>): string {
  return `${fiche.type_document === '381' ? 'l’avoir' : 'la facture'} n° ${fiche.numero} du ${formatDate(fiche.date_facture)} (${nomDuPays(fiche.pays)})`
}

/**
 * CE QUE LA SUPPRESSION D'UNE PIÈCE EMPORTE DE SA FICHE (la clé `pieces_hors_de_france.piece_id` est en cascade, et la
 * ventilation suit sa fiche) : la phrase que la confirmation porte, ou rien quand la pièce n'en a aucune. Sur une lecture
 * pas encore revenue ou partielle, la confirmation dit qu'elle ne le sait pas, plutôt que de se taire.
 */
export function ficheEmporteeParLaSuppression(pieceId: string, lecture: LectureFichesHorsDeFrance | null): string | null {
  if (lecture === null || lecture.motif !== null) {
    return 'Les fiches « fournisseur établi hors de France » du dossier n’ont pas pu être lues en entier : si cette pièce en a une, elle est supprimée avec elle, toutes ses versions comprises.'
  }
  const versions = versionsDeLaPiece(lecture.fiches, pieceId)
  if (versions.length === 0) return null
  const courante = versions[0]
  const precedentes = versions.length - 1
  return `Sa fiche « fournisseur établi hors de France » — ${ficheEnMots(courante)}${courante.retire_le !== null ? ', retirée' : ''} — est supprimée avec elle`
    + `${precedentes === 0 ? '' : precedentes === 1 ? ', avec sa version précédente' : `, avec ses ${precedentes} versions précédentes`}.`
}

/** La même phrase pour une sélection : combien de pièces emportent leur fiche, et lesquelles (cinq au plus). */
export function fichesEmporteesParLaSuppression(pieceIds: readonly string[], lecture: LectureFichesHorsDeFrance | null): string | null {
  if (lecture === null || lecture.motif !== null) {
    return 'Les fiches « fournisseur établi hors de France » du dossier n’ont pas pu être lues en entier : une pièce de la sélection qui en a une la perd, toutes ses versions comprises.'
  }
  const decrites = pieceIds.flatMap((id) => {
    const versions = versionsDeLaPiece(lecture.fiches, id)
    return versions.length === 0 ? [] : [versions[0]]
  })
  if (decrites.length === 0) return null
  const liste = decrites.slice(0, 5).map((f) => `• ${ficheEnMots(f)}`).join('\n') + (decrites.length > 5 ? `\n… et ${decrites.length - 5} autre(s)` : '')
  return `${decrites.length === 1 ? 'Une pièce de la sélection a une fiche' : `${decrites.length} pièces de la sélection ont une fiche`} `
    + `« fournisseur établi hors de France », supprimée avec sa pièce, toutes ses versions comprises :\n${liste}`
}

/** Le schéma de l'identifiant d'un fournisseur établi dans ce pays : son numéro de TVA dans l'Union (0223), son pays et
 * son nom ailleurs (0227). Les deux autres combinaisons, la base les refuse : l'écran n'a pas à les offrir. */
export function schemaDuPays(pays: string | null): '0223' | '0227' | null {
  if (pays === null || !/^[A-Z]{2}$/.test(pays)) return null
  return ETATS_MEMBRES_HORS_FRANCE.includes(pays) ? '0223' : '0227'
}

/** Le début qu'un numéro de TVA de ce pays doit porter (EL pour la Grèce), ou rien hors de l'Union. */
export function prefixeAttendu(pays: string | null): string | null {
  return pays !== null && ETATS_MEMBRES_HORS_FRANCE.includes(pays) ? prefixeTva(pays) : null
}
