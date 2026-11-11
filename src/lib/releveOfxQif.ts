import { parseDateBancaire, parseMontantBancaire } from './csv'
import { decoderUtf8OuWindows1252, decoderWindows1252, type EncodageLu } from './decodageTexte'
import { formatDate, formatMoney } from './format'
import type { ReglageDeLImport } from './importReleve'
import { natureDuLibelle } from './soldeReleve'

// LE RELEVÉ IMPORTÉ EN OFX OU EN QIF : un recours quand le CSV d'une banque se lit mal. Presque toutes les banques
// françaises proposent l'OFX (« Money », 1.x en SGML, 2.x en XML) et le QIF (« Quicken ») : des formats normalisés, où la
// date, le libellé et le montant signé d'une opération se lisent sans deviner de colonnes. Ce module les ramène à la forme
// que l'import d'un CSV lit déjà — des lignes (date, libellé, montant) sous un réglage FIXE (`REGLAGE_OFX_QIF`) — et tout
// l'aval reste celui du CSV : `interpreterReleve`, l'aperçu signé, le dédoublonnage par multiplicité, le recouvrement d'une
// période, le contrôle de solde. Les dates et les montants passent par `csv.ts` seul.
//
// Chaque règle tombe du côté sûr — refuser, ou dire, plutôt que deviner : aucun écran ne retire un mouvement importé.
//
// Les identifiants bancaires (ACCTID, BANKID, BRANCHID, le nom d'un compte QIF) ne sont jamais lus dans ce que le module
// rend : ni dans les lignes, ni dans la ligne brute gardée (`libelle_brut`), ni dans un message, ni dans un journal. Seule
// exception (MCB2, l'import par compte) : les QUATRE DERNIERS caractères de l'ACCTID d'un OFX (`finDIdentifiant`), ce qu'un
// relevé de banque montre déjà, pour confronter le fichier au compte choisi (`lib/importParCompte.ts`) — jamais le numéro
// entier, jamais dans une ligne ni un message.

export type FormatOfxQif = 'ofx-sgml' | 'ofx-xml' | 'qif'

export const NOM_DU_FORMAT: Record<FormatOfxQif, string> = {
  'ofx-sgml': 'OFX 1.x (SGML, « Money »)',
  'ofx-xml': 'OFX 2.x (XML)',
  qif: 'QIF (« Quicken »)',
}

// Le réglage fixe des lignes que rend ce module : la date (ISO) en colonne 1, le libellé en 2, le montant signé en 3, sans
// en-tête ni colonne de solde. `colDebit` et `colCredit` ne servent qu'au format à deux colonnes, jamais lu ici.
export const REGLAGE_OFX_QIF: ReglageDeLImport = {
  colDate: 0, colLibelle: 1, colMontant: 2, format: 'signe', colDebit: 2, colCredit: 2, hasHeader: false, colSolde: null,
}

// Les libellés des lignes de solde que le module ajoute aux opérations : de la forme d'un solde (`aLaFormeDUnSolde`), ils
// passent par le même mécanisme que les soldes d'un CSV — retenus comme soldes, jamais importés, et le contrôle de
// l'arithmétique ne joue qu'avec deux d'entre eux (`controlerSolde`).
export const LIBELLE_SOLDE_COMPTABLE = 'Solde comptable'
export const LIBELLE_SOLDE_OUVERTURE = 'Solde d’ouverture'

// Une opération dont le signe du montant contredit son type (un DEBIT positif, un CREDIT négatif) : elle entre avec le
// signe du MONTANT, jamais retourné, et se dit avant le clic.
export interface SensDouteux { date: string; libelle: string; montant: number; type: string }

export type LectureOfxQif =
  | { format: FormatOfxQif; refus: string }
  | {
    format: FormatOfxQif
    refus: null
    lignes: string[][]
    // Le solde que la banque donne (OFX : LEDGERBAL, BALAMT au DTASOF ; QIF : l'« Opening Balance »), à confronter.
    soldeAnnonce: { nature: 'comptable' | 'ouverture'; date: string; montant: number } | null
    sensDouteux: SensDouteux[]
    doutes: string[]
    // Les quatre derniers caractères (chiffres et capitales) de l'identifiant du compte (ACCTID de BANKACCTFROM) ; nul en
    // QIF, ou quand l'OFX ne le dit pas, ou en dit moins de quatre.
    finDIdentifiant: string | null
  }
export type ReleveOfxQifLu = Extract<LectureOfxQif, { refus: null }>

// ── La reconnaissance, au CONTENU ────────────────────────────────────────────────────────────────────────────────────────
// Jamais à l'extension : un « .ofx » qui est un CSV, ou un export sans extension, se lisent pour ce qu'ils sont.
export function formatOfxQif(texte: string): FormatOfxQif | null {
  const t = texte.replace(/^﻿/, '').trimStart()
  if (/^OFXHEADER\s*:\s*100\b/i.test(t)) return 'ofx-sgml'
  if (/^(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<\?OFX\b/i.test(t)) return 'ofx-xml'
  if (/^!(Type|Account|Option|Clear)\b/i.test(t)) return 'qif'
  return null
}

// ── L'encodage ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// L'OFX 1.x dit le sien dans son en-tête (`ENCODING:UTF-8`, ou `CHARSET:1252` / `ISO-8859-1`), l'OFX 2.x dans sa déclaration
// XML ; ce qu'il dit fait foi. À défaut (un CSV, un QIF, un en-tête muet), l'UTF-8 strict, sinon windows-1252
// (`decoderUtf8OuWindows1252`). L'en-tête se lit sur les premiers octets en windows-1252, qui ne peut pas échouer : il est
// en ASCII.
export function decoderReleve(octets: Uint8Array): { texte: string; encodage: EncodageLu } {
  const tete = decoderWindows1252(octets.subarray(0, 2048)).replace(/^ï»¿/, '').trimStart()
  if (/^OFXHEADER\s*:\s*100\b/i.test(tete)) {
    const enTete = tete.split('<')[0]
    const encodage = /^\s*ENCODING\s*:\s*(\S+)/im.exec(enTete)?.[1].toUpperCase() ?? ''
    const charset = /^\s*CHARSET\s*:\s*(\S+)/im.exec(enTete)?.[1].toUpperCase() ?? ''
    if (encodage !== 'UTF-8' && /^(1252|WINDOWS-1252|ISO-8859-1|8859-1|ISO-8859-15|LATIN1)$/.test(charset)) {
      return { texte: decoderWindows1252(octets), encodage: 'windows-1252' }
    }
    return decoderUtf8OuWindows1252(octets)
  }
  const declaration = /^<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(tete)?.[1].toUpperCase()
  if (declaration && /^(WINDOWS-1252|ISO-8859-1|ISO-8859-15|LATIN1)$/.test(declaration)) {
    return { texte: decoderWindows1252(octets), encodage: 'windows-1252' }
  }
  return decoderUtf8OuWindows1252(octets)
}

// ── Les champs communs ───────────────────────────────────────────────────────────────────────────────────────────────────

// Le libellé : le nom puis le mémo, un seul des deux s'ils disent la même chose.
function libelleDe(nom: string, memo: string): string {
  const n = nom.trim()
  const m = memo.trim()
  const pareil = (a: string) => a.replace(/\s+/g, ' ').toLowerCase()
  if (!n || !m || pareil(n) === pareil(m)) return n || m
  return `${n} — ${m}`
}

// Une date OFX `AAAAMMJJ[hhmmss[.xxx][[±h:TZ]]]` se lit sur ses huit premiers chiffres : la date civile de la banque, jamais
// convertie de fuseau (« 20261105230000[-5:EST] » est le 5 novembre, même si l'instant tombe le 6 à Paris). La validité au
// calendrier est jugée par `parseDateBancaire` ; une forme non reconnue rend une chaîne vide, donc « date illisible ».
function dateOfx(v: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(v.trim())
  return m ? `${m[1]}-${m[2]}-${m[3]}` : ''
}

// Un montant OFX : chiffres, un séparateur décimal (point ou virgule), jamais de séparateur de milliers (la norme les
// exclut). `parseMontantBancaire` prendrait « 12.345 » pour douze mille trois cent quarante-cinq : au-delà de deux
// décimales, des zéros se retirent, d'autres chiffres rendent le montant illisible — écarté et compté, jamais deviné.
function montantOfx(v: string): string {
  const brut = v.trim()
  const m = /^([+-]?)(\d*)(?:[.,](\d*))?$/.exec(brut)
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return brut === '' ? '' : illisible(brut)
  const decimales = (m[3] ?? '').replace(/0+$/, '')
  if (decimales.length > 2) return illisible(brut)
  return `${m[1]}${m[2] || '0'}${decimales ? `.${decimales}` : ''}`
}

// Une cellule que `parseMontantBancaire` refuse : la ligne s'écarte en « montant illisible », comme dans un CSV.
function illisible(brut: string): string {
  return `forme non reconnue : ${brut}`
}

function phraseLigne(date: string, libelle: string): string {
  return `${date ? formatDate(date) : 'date illisible'} « ${libelle || 'sans libellé'} »`
}

// Une opération du fichier qui a la forme d'une ligne de solde : la règle des CSV (`lignesDeSolde`) la retiendrait comme un
// solde, et l'opération disparaîtrait. Un format normalisé dit lui-même ce qui est une opération : le fichier se refuse
// plutôt que de perdre l'une d'elles.
function refusDUnLibelleDeSolde(date: string, libelle: string): string | null {
  if (natureDuLibelle(libelle) !== 'solde') return null
  return `L’opération du ${phraseLigne(date, libelle)} a le libellé d’une ligne de solde : l’import la prendrait pour un solde `
    + 'et ne l’importerait pas. Importe ce relevé en CSV, où chaque ligne de ce genre se tranche avant l’import.'
}

// ── L'OFX ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const ENTITES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ' }
function decoderEntites(t: string): string {
  return t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (tout, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : tout
    }
    return ENTITES[e.toLowerCase()] ?? tout
  })
}

// Les types d'opération dont la norme fixe le sens ; les autres (POS, ATM, XFER, INT, OTHER…) « dépendent du signe ».
const TYPES_AU_DEBIT = new Set(['DEBIT', 'DIRECTDEBIT', 'CHECK', 'CASH', 'FEE', 'SRVCHG', 'PAYMENT'])
const TYPES_AU_CREDIT = new Set(['CREDIT', 'DEP', 'DIRECTDEP'])

interface OperationOfx { champs: Map<string, string>; devise: string | null }
interface CompteOfx {
  curdef: string | null; operations: OperationOfx[]; balamt: string | null; dtasof: string | null; acctid: string | null
}

/** Les quatre derniers caractères d'un identifiant de compte, en chiffres et capitales (les espaces, tirets et autres
 *  signes retirés) ; nul s'il en reste moins de quatre. Ce que retient `comptes_bancaires.fin_d_identifiant`. */
export function finDeLIdentifiant(identifiant: string): string | null {
  const net = identifiant.toUpperCase().replace(/[^0-9A-Z]/g, '')
  return net.length < 4 ? null : net.slice(-4)
}

function natureDUnAutreReleve(nom: string): string {
  if (nom === 'CCSTMTRS' || nom === 'CCSTMTENDRS') return 'un relevé de carte bancaire'
  if (nom.startsWith('INVSTMT')) return 'un relevé de placement (titres, assurance-vie)'
  if (nom.startsWith('LOAN')) return 'un relevé de prêt'
  return `un relevé d’une autre nature (${nom})`
}

function lireOfx(texte: string, format: FormatOfxQif): LectureOfxQif {
  const debut = texte.search(/<OFX>/i)
  if (debut < 0) return { format, refus: 'Le fichier n’a pas de corps <OFX> : il ne se lit pas.' }
  const corps = texte.slice(debut).replace(/<!--[\s\S]*?-->/g, '')
  const comptes: CompteOfx[] = []
  const pile: string[] = []
  let compte: CompteOfx | null = null
  let operation: OperationOfx | null = null
  let dansLedger = false
  for (const m of corps.matchAll(/<(\/?)([A-Za-z0-9_.]+)(?:\s[^>]*)?>([^<]*)/g)) {
    const nom = m[2].toUpperCase()
    const texteDuJeton = decoderEntites(m[3]).trim()
    if (m[1] === '/') {
      // Une balise fermante ferme son agrégat et tout ce qui y reste ouvert (une feuille SGML vide) ; celle d'une feuille
      // XML, que la pile ne porte pas, ne ferme rien.
      const i = pile.lastIndexOf(nom)
      if (i < 0) continue
      const fermes = pile.splice(i)
      if (fermes.includes('STMTTRN')) operation = null
      if (fermes.includes('LEDGERBAL')) dansLedger = false
      if (fermes.includes('STMTRS')) compte = null
      continue
    }
    if (texteDuJeton === '') {
      // Un agrégat (ou une feuille vide). Un relevé d'une autre nature se refuse dès qu'il paraît.
      if ((nom.endsWith('STMTRS') && nom !== 'STMTRS') || nom.startsWith('INVSTMT') || nom === 'CCSTMTENDRS') {
        return { format, refus: `Ce fichier est ${natureDUnAutreReleve(nom)}, pas le relevé d’un compte bancaire : il ne s’importe pas ici.` }
      }
      pile.push(nom)
      if (nom === 'STMTRS') { compte = { curdef: null, operations: [], balamt: null, dtasof: null, acctid: null }; comptes.push(compte) }
      else if (nom === 'STMTTRN' && compte) { operation = { champs: new Map(), devise: null }; compte.operations.push(operation) }
      else if (nom === 'LEDGERBAL') dansLedger = true
      continue
    }
    // Une feuille, rangée dans l'agrégat le plus proche qui compte ici.
    if (operation) {
      if (nom === 'CURSYM' && pile[pile.length - 1] === 'CURRENCY') operation.devise = texteDuJeton.toUpperCase()
      else if (!operation.champs.has(nom)) operation.champs.set(nom, texteDuJeton)
    } else if (compte && dansLedger) {
      if (nom === 'BALAMT') compte.balamt = texteDuJeton
      else if (nom === 'DTASOF') compte.dtasof = texteDuJeton
    } else if (compte && nom === 'CURDEF') compte.curdef = texteDuJeton.toUpperCase()
    else if (compte && nom === 'ACCTID' && pile[pile.length - 1] === 'BANKACCTFROM' && compte.acctid === null) compte.acctid = texteDuJeton
  }

  if (comptes.length === 0) return { format, refus: 'Le fichier ne porte le relevé d’aucun compte bancaire (aucun STMTRS).' }
  if (comptes.length > 1) {
    return { format, refus: `Le fichier porte les relevés de ${comptes.length} comptes : exporte un compte à la fois, pour que chaque `
      + 'relevé entre dans son dossier et que ses soldes se confrontent.' }
  }
  const [seul] = comptes
  if (seul.curdef === null) return { format, refus: 'Le relevé ne dit pas sa devise (CURDEF) : l’import ne suppose pas l’euro.' }
  if (seul.curdef !== 'EUR') return { format, refus: `Le relevé est tenu en ${seul.curdef}, pas en euros : il ne s’importe pas.` }

  const lignes: string[][] = []
  const sensDouteux: SensDouteux[] = []
  const doutes: string[] = []
  for (const op of seul.operations) {
    const date = dateOfx(op.champs.get('DTPOSTED') ?? '')
    const libelle = libelleDe(op.champs.get('NAME') ?? '', op.champs.get('MEMO') ?? '')
    if (op.devise !== null && op.devise !== 'EUR') {
      return { format, refus: `L’opération du ${phraseLigne(date, libelle)} est en ${op.devise}, pas en euros : le relevé ne `
        + 's’importe pas.' }
    }
    const refus = refusDUnLibelleDeSolde(date, libelle)
    if (refus) return { format, refus }
    const montant = montantOfx(op.champs.get('TRNAMT') ?? '')
    lignes.push([date, libelle, montant])
    const type = (op.champs.get('TRNTYPE') ?? '').toUpperCase()
    const n = parseMontantBancaire(montant)
    const dateLue = parseDateBancaire(date)
    if (n !== null && dateLue && ((TYPES_AU_DEBIT.has(type) && n > 0) || (TYPES_AU_CREDIT.has(type) && n < 0))) {
      sensDouteux.push({ date: dateLue, libelle, montant: n, type })
    }
  }

  // Le solde comptable : ajouté aux lignes sous un libellé de solde, il passe par le mécanisme des soldes d'un CSV.
  let soldeAnnonce: ReleveOfxQifLu['soldeAnnonce'] = null
  if (seul.balamt !== null || seul.dtasof !== null) {
    const date = parseDateBancaire(dateOfx(seul.dtasof ?? ''))
    const montant = montantOfx(seul.balamt ?? '')
    const n = parseMontantBancaire(montant)
    if (date && n !== null) {
      lignes.push([date, LIBELLE_SOLDE_COMPTABLE, montant])
      soldeAnnonce = { nature: 'comptable', date, montant: n }
    } else {
      doutes.push('Le solde comptable du fichier (LEDGERBAL) ne se lit pas : il n’est pas repris, et rien ne confronte le relevé.')
    }
  }
  return { format, refus: null, lignes, soldeAnnonce, sensDouteux, doutes, finDIdentifiant: seul.acctid === null ? null : finDeLIdentifiant(seul.acctid) }
}

// ── Le QIF ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

const NATURES_QIF: Record<string, string> = {
  ccard: 'un relevé de carte bancaire', cash: 'une caisse', invst: 'un relevé de placement', 'oth a': 'un compte d’actif',
  'oth l': 'un compte de passif', cat: 'une liste de catégories', class: 'une liste de classes', memorized: 'une liste d’opérations mémorisées',
}

type DateQif = { iso: string } | { a: number; b: number; annee: string } | { illisible: true } | { incertaine: string }

// Une date QIF : ISO, ou deux nombres et une année sur quatre chiffres, séparés par « / », « . » ou « - ». L'apostrophe
// américaine (« 11/5'26 ») et l'année sur deux chiffres ne disent ni le siècle ni, souvent, l'ordre : elles se refusent.
function dateQif(v: string): DateQif {
  const t = v.trim().replace(/\s+/g, '')
  if (t.includes('\'')) return { incertaine: v.trim() }
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
  if (iso) return { iso: `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}` }
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d+)$/.exec(t)
  if (!m) return { illisible: true }
  if (m[3].length !== 4) return { incertaine: v.trim() }
  return { a: +m[1], b: +m[2], annee: m[3] }
}

function lireQif(texte: string): LectureOfxQif {
  const format: FormatOfxQif = 'qif'
  const types: string[] = []
  let comptesDeclares = 0
  let dansUnCompte = false
  const enregistrements: Map<string, string>[] = []
  let courant = new Map<string, string>()
  for (const brute of texte.replace(/^﻿/, '').split(/\r\n|\r|\n/)) {
    const ligne = brute.trim()
    if (ligne === '') continue
    if (ligne.startsWith('!')) {
      const type = /^!Type:\s*(.*)$/i.exec(ligne)
      if (type) { types.push(type[1].trim()); dansUnCompte = false }
      else if (/^!Account\b/i.test(ligne)) { comptesDeclares++; dansUnCompte = true }
      continue
    }
    // Le bloc d'un compte (`!Account`) porte son nom et son type, jamais une opération : il ne se lit pas.
    if (dansUnCompte) { if (ligne.startsWith('^')) dansUnCompte = false; continue }
    const code = ligne[0]
    if (code === '^') {
      if (courant.size > 0) enregistrements.push(courant)
      courant = new Map()
      continue
    }
    // Les ventilations (S, E, $) détaillent le montant total (T) : elles ne s'ajoutent pas.
    if ('SE$'.includes(code)) continue
    if (!courant.has(code)) courant.set(code, ligne.slice(1).trim())
  }
  if (courant.size > 0) enregistrements.push(courant)

  if (types.length === 0) return { format, refus: 'Le fichier ne dit pas son type (!Type:Bank) : il ne se lit pas.' }
  if (types.length > 1 || comptesDeclares > 1) {
    return { format, refus: 'Le fichier porte plusieurs comptes ou plusieurs listes : exporte un compte à la fois.' }
  }
  const type = types[0]
  if (type.toLowerCase() !== 'bank') {
    const nature = NATURES_QIF[type.toLowerCase()] ?? `une liste de type « ${type} »`
    return { format, refus: `Ce fichier est ${nature} (!Type:${type}), pas le relevé d’un compte bancaire : il ne s’importe pas ici.` }
  }

  // L'ordre du jour et du mois se juge sur TOUT le fichier : une date dont le premier nombre passe 12 prouve l'ordre
  // jour/mois des banques françaises ; une dont le second passe 12 prouve l'ordre américain, qui se refuse. Sans preuve,
  // l'ordre n'est pas sûr, et rien ne se devine.
  const dates = enregistrements.map((e) => dateQif(e.get('D') ?? ''))
  const incertaine = dates.find((d): d is { incertaine: string } => 'incertaine' in d)
  if (incertaine) {
    return { format, refus: `La date « ${incertaine.incertaine} » ne dit pas son année sur quatre chiffres : l’ordre du jour et du `
      + 'mois, et le siècle, se devineraient. Exporte le relevé avec des dates JJ/MM/AAAA, ou en OFX.' }
  }
  const deuxNombres = dates.filter((d): d is { a: number; b: number; annee: string } => 'a' in d)
  if (deuxNombres.some((d) => d.b > 12)) {
    return { format, refus: 'Les dates du fichier sont écrites mois/jour (à l’américaine) : l’import ne les retourne pas. '
      + 'Exporte le relevé avec des dates JJ/MM/AAAA, ou en OFX.' }
  }
  if (deuxNombres.length > 0 && !deuxNombres.some((d) => d.a > 12)) {
    return { format, refus: 'Aucune date du fichier ne prouve l’ordre du jour et du mois (tous deux de 1 à 12) : il se devinerait. '
      + 'Importe ce relevé en OFX ou en CSV.' }
  }

  const lignes: string[][] = []
  let soldeAnnonce: ReleveOfxQifLu['soldeAnnonce'] = null
  for (const [i, e] of enregistrements.entries()) {
    const d = dates[i]
    const date = 'iso' in d ? d.iso : 'a' in d ? `${d.annee}-${String(d.b).padStart(2, '0')}-${String(d.a).padStart(2, '0')}` : ''
    const montant = e.get('T') ?? e.get('U') ?? ''
    // Le solde d'ouverture que Quicken écrit comme une opération : un solde, jamais un mouvement.
    if (/^opening balance$/i.test((e.get('P') ?? '').trim())) {
      lignes.push([date, LIBELLE_SOLDE_OUVERTURE, montant])
      const dateLue = parseDateBancaire(date)
      const n = parseMontantBancaire(montant)
      if (dateLue && n !== null && soldeAnnonce === null) soldeAnnonce = { nature: 'ouverture', date: dateLue, montant: n }
      continue
    }
    const libelle = libelleDe(e.get('P') ?? '', e.get('M') ?? '')
    const refus = refusDUnLibelleDeSolde(date, libelle)
    if (refus) return { format, refus }
    lignes.push([date, libelle, montant])
  }
  return { format, refus: null, lignes, soldeAnnonce, sensDouteux: [], doutes: [], finDIdentifiant: null }
}

// ── L'entrée ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

// `null` : le texte n'est ni un OFX ni un QIF (un CSV, que l'import lit comme avant).
export function lireReleveOfxQif(texte: string): LectureOfxQif | null {
  const format = formatOfxQif(texte)
  if (format === null) return null
  return format === 'qif' ? lireQif(texte) : lireOfx(texte, format)
}

// Ce que l'écran dit du solde que la banque donne : le cabinet le confronte au relevé ; seul, il ne vérifie rien.
export function phraseDuSoldeAnnonce(solde: ReleveOfxQifLu['soldeAnnonce']): string | null {
  if (!solde) return null
  const quoi = solde.nature === 'comptable' ? 'Solde comptable donné par la banque' : 'Solde d’ouverture donné par le fichier'
  return `${quoi} au ${formatDate(solde.date)} : ${formatMoney(solde.montant)}. Confronte-le au relevé de la banque : seul, il ne `
    + 'vérifie pas l’arithmétique du fichier, qui demande un solde d’ouverture et un solde de clôture.'
}

// Ce que l'écran dit, avant le clic, des opérations dont le signe contredit le type.
export function phraseDesSensDouteux(liste: readonly SensDouteux[]): string | null {
  if (liste.length === 0) return null
  const noms = liste.map((s) => `${formatDate(s.date)} « ${s.libelle} » (${s.type}, ${formatMoney(s.montant)})`)
  return `${liste.length === 1 ? 'Une opération a' : `${liste.length} opérations ont`} un montant dont le signe contredit le type `
    + `donné par la banque : ${noms.join(' ; ')}. Elle${liste.length === 1 ? ' entre' : 's entrent'} avec le signe du montant, `
    + 'jamais retourné : vérifie-les sur le relevé de la banque avant d’importer.'
}
