export type SeparateurCsv = ';' | '\t' | ','

// Dans l'ordre où une égalité se tranche : le point-virgule des exports français (le montant y porte déjà une virgule
// décimale), puis la tabulation, puis la virgule.
const SEPARATEURS: readonly SeparateurCsv[] = [';', '\t', ',']

// Le séparateur d'un fichier, choisi sur ses trente premières lignes, découpées par chacun des trois (guillemets
// respectés) :
//   1. celui qui donne le plus de lignes qui ressemblent à une OPÉRATION — une cellule de date et une autre de montant,
//      entières : c'est ce qu'un relevé contient, et ce qu'un mauvais séparateur coupe en morceaux ;
//   2. à égalité (un fichier sans dates, une balance), le plus RÉGULIER : le même nombre de séparateurs sur le plus de
//      lignes, les lignes qui n'en portent aucun mises à part ;
//   3. à égalité encore, le point-virgule, puis la tabulation, puis la virgule.
// L'ancienne règle prenait le point-virgule dès qu'elle en voyait un dans les 2 000 premiers caractères : un fichier à
// virgules dont un seul libellé porte « ; » se découpait au point-virgule, chaque ligne en une ou deux colonnes. La
// régularité seule ne suffit pas : un relevé français dont les lignes de solde sont plus courtes que les opérations porte
// une virgule décimale par ligne, plus régulière que ses points-virgules.
export function separateurDuCsv(text: string): SeparateurCsv {
  let meilleur: SeparateurCsv = ';'
  let meilleurScore: [number, number] = [-1, -1]
  for (const s of SEPARATEURS) {
    const rows = decouper(text, s, 30)
    const operations = rows.filter((r) => {
      const date = r.findIndex((c) => isFullDate(c))
      return date !== -1 && r.some((c, i) => i !== date && isFullMontant(c.trim()))
    }).length
    const frequences = new Map<number, number>()
    for (const r of rows) if (r.length > 1) frequences.set(r.length, (frequences.get(r.length) ?? 0) + 1)
    const regularite = [...frequences.values()].reduce((a, b) => Math.max(a, b), 0)
    if (operations > meilleurScore[0] || (operations === meilleurScore[0] && regularite > meilleurScore[1])) {
      meilleur = s
      meilleurScore = [operations, regularite]
    }
  }
  // Aucune ligne d'opération, quel que soit le séparateur (une balance reprise, un fichier sans dates) : la régularité seule
  // ne tient pas — une balance « Compte;Libellé;Débit;Crédit;Lettrage » dont certaines lignes omettent la dernière colonne
  // porte une virgule décimale par ligne, plus régulière que ses points-virgules, et se lisait à la virgule (aucun compte
  // lu). La règle d'avant y revient : le point-virgule dès qu'il en paraît un, compté hors guillemets.
  if (meilleurScore[0] === 0 && decouper(text, ';', 30).some((r) => r.length > 1)) return ';'
  return meilleur
}

// Parseur CSV minimal mais robuste (guillemets, champs contenant le délimiteur, CRLF/LF), sur le séparateur que
// `separateurDuCsv` choisit plutôt que de le supposer.
export function parseCsv(text: string): string[][] {
  return decouper(text, separateurDuCsv(text))
}

// Le découpage lui-même ; `maxLignes` arrête la lecture tôt, pour juger d'un séparateur sur le début du fichier.
function decouper(text: string, delimiter: SeparateurCsv, maxLignes = Infinity): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length && rows.length < maxLignes; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
      continue
    }

    if (c === '"') {
      inQuotes = true
    } else if (c === delimiter) {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      if (row.some((f) => f.trim() !== '')) rows.push(row)
      row = []
      field = ''
    } else {
      field += c
    }
  }
  if (rows.length < maxLignes && (field !== '' || row.length > 0)) {
    row.push(field)
    if (row.some((f) => f.trim() !== '')) rows.push(row)
  }
  return rows
}

// Un montant bancaire tel qu'il sort d'un export de banque : "1 234,56", "-45,20", "1.234,56",
// "1,234.56", "45,20-", "(45,20)" — avec espaces insécables éventuels et symbole €.
//
// Le séparateur décimal ne peut pas être supposé : selon la banque, le point sépare les milliers
// ("1.234,56") ou les décimales ("1,234.56"). On retient donc comme séparateur décimal le dernier
// séparateur suivi d'un ou deux chiffres en fin de chaîne — un montant n'a jamais trois décimales —
// et on traite tous les autres comme des séparateurs de milliers. L'ancienne version remplaçait la
// première virgule par un point et laissait faire parseFloat, qui s'arrête au deuxième séparateur :
// "1.234,56" devenait 1,23 €, silencieusement.
//
// Le signe peut aussi être rejeté en fin ("45,20-") ou porté par des parenthèses ("(45,20)"). Ne pas
// les reconnaître transformait un débit en crédit — le sens d'une opération inversé sans que rien
// ne le signale.
//
// Le signe moins typographique (U+2212), que certains tableurs écrivent à la place du trait d'union, se lit comme lui :
// non reconnu, il rendait le montant illisible et la ligne était écartée.
export function parseMontantBancaire(raw: string): number | null {
  raw = raw.replace(/\u2212/g, '-')
  let s = raw.replace(/[\s\u00a0\u202f]/g, '').replace(/\u20ac/g, '')
  if (!s) return null

  let negatif = false
  if (/^\(.+\)$/.test(s)) {
    negatif = true
    s = s.slice(1, -1)
  }
  if (s.endsWith('-')) {
    negatif = true
    s = s.slice(0, -1)
  } else if (s.startsWith('-')) {
    negatif = true
    s = s.slice(1)
  } else if (s.startsWith('+')) {
    s = s.slice(1)
  }

  if (!/^\d[\d.,]*$/.test(s)) return null

  const dernierSeparateur = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'))
  let entier = s
  let decimales = ''
  if (dernierSeparateur !== -1 && /^\d{1,2}$/.test(s.slice(dernierSeparateur + 1))) {
    entier = s.slice(0, dernierSeparateur)
    decimales = s.slice(dernierSeparateur + 1)
  }
  entier = entier.replace(/[.,]/g, '')
  if (!/^\d+$/.test(entier)) return null

  const n = Number(decimales ? entier + '.' + decimales : entier)
  return Number.isNaN(n) ? null : (negatif ? -n : n)
}

// Une date qui n'existe pas au calendrier ("31/02") n'est pas une date, et laisser passer la chaîne
// fait échouer l'insertion de tout le lot. La rejeter ici la fait simplement ignorer, comme
// n'importe quelle autre ligne illisible.
function dateExiste(annee: number, mois: number, jour: number): boolean {
  if (mois < 1 || mois > 12 || jour < 1) return false
  return jour <= new Date(Date.UTC(annee, mois, 0)).getUTCDate()
}

// Date au format JJ/MM/AAAA (le plus courant sur les relevés français) ou déjà ISO AAAA-MM-JJ.
export function parseDateBancaire(raw: string): string | null {
  const trimmed = raw.trim()
  let m = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) {
    if (!dateExiste(+m[1], +m[2], +m[3])) return null
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  }
  m = trimmed.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/)
  if (m) {
    let year = +m[3]
    if (year < 100) year += year < 70 ? 2000 : 1900
    if (!dateExiste(year, +m[2], +m[1])) return null
    return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  return null
}

// Versions strictes (toute la cellule, pas juste le début) utilisées pour la détection automatique
// des colonnes — une cellule "01/01/2026" ne doit pas aussi compter comme un montant valide, et une
// longue référence numérique ne doit pas compter comme une date.
function isFullDate(s: string): boolean {
  const t = s.trim()
  return /^\d{4}-\d{1,2}-\d{1,2}$/.test(t) || /^\d{1,2}[/.]\d{1,2}[/.]\d{2,4}$/.test(t)
}
function isFullMontant(s: string): boolean {
  // Une date écrite en points ("01.01.2026") n'est faite que de chiffres et de séparateurs : sans
  // cette exclusion elle compterait aussi comme un montant et brouillerait la détection.
  if (isFullDate(s)) return false
  // Délibérément adossé à l'analyseur plutôt qu'à une expression régulière parallèle : les deux
  // divergeaient, l'expression rejetant les séparateurs de milliers que l'analyseur acceptait. Un
  // relevé dont tous les montants dépassaient 999,99 n'obtenait alors aucune correspondance, et la
  // colonne des montants était devinée par défaut — en pratique celle du libellé.
  return parseMontantBancaire(s) !== null
}

export interface ColumnMapping {
  colDate: number
  colMontant: number
  colLibelle: number
  hasHeader: boolean
  // Les AUTRES colonnes de montants du fichier — le débit et le crédit d'un format à deux colonnes, le solde courant — :
  // comme la date et le montant, elles n'entrent jamais dans un libellé reconstitué (`libelleDeLigne`). Absent : aucune.
  autresMontants?: readonly number[]
}

// Deux façons d'écrire le montant d'un mouvement : une colonne signée (négative au débit), ou deux colonnes, Débit et
// Crédit, dont une seule est remplie sur chaque ligne — le débit en positif (Crédit Agricole, La Banque Postale) ou en
// négatif (CIC, Crédit Mutuel).
export type FormatDesMontants = 'signe' | 'debit_credit'

export interface ReglageDesMontants {
  format: FormatDesMontants
  colMontant: number
  colDebit: number
  colCredit: number
}

// Ce que la détection rend à l'écran : les colonnes, le format, la colonne du SOLDE COURANT s'il y en a une — jamais un
// montant —, et ce qu'elle n'a pas pu établir (`doute`), que l'écran dit avant l'import.
export interface DetectionDesColonnes extends ColumnMapping, ReglageDesMontants {
  colSolde: number | null
  doute: string | null
  // La ligne qui NOMME les colonnes (`colonnesParEntete`), ou `null` si aucune ne le fait : les données commencent à la
  // ligne suivante, et le préambule qui la précède (numéro de compte, période) n'est pas lu comme des opérations.
  ligneEnTete: number | null
}

// Les lignes de données d'un fichier : celles qui suivent la ligne d'en-tête nommée par la détection, ou la première ligne
// quand elle est un en-tête sans être reconnue comme tel, ou toutes. Rend aussi les lignes ainsi retirées, que l'écran dit.
export function lignesDeDonnees(
  rows: readonly string[][], hasHeader: boolean, ligneEnTete: number | null,
): { donnees: string[][]; retirees: string[][] } {
  const debut = !hasHeader ? 0 : (ligneEnTete ?? 0) + 1
  return { donnees: rows.slice(debut), retirees: rows.slice(0, debut) }
}

// Le montant d'une ligne, ou la raison pour laquelle il ne se lit pas : la seule interprétation d'un montant de relevé,
// pour l'aperçu comme pour l'import.
//   - « absent » : la cellule (les deux cellules, en Débit / Crédit) est vide ;
//   - « illisible » : une cellule remplie n'est pas un montant (« 1 234,56 EUR », « #VALEUR! ») — jamais lue comme zéro :
//     un débit illisible s'importait à 0,00 €, sans rien dire ;
//   - « ambigu » : Débit et Crédit portent chacun un montant non nul, ou le crédit est négatif — le sens ne se lit pas
//     sans le deviner.
// Le zéro reste un montant (une ligne de solde peut valoir 0,00) : c'est à l'appelant de refuser une OPÉRATION nulle.
export type LectureDuMontant = { montant: number } | { ecart: 'absent' | 'illisible' | 'ambigu' }

export function montantDeLigne(row: string[], reglage: ReglageDesMontants): LectureDuMontant {
  if (reglage.format === 'signe') {
    const brut = (row[reglage.colMontant] ?? '').trim()
    if (!brut) return { ecart: 'absent' }
    const n = parseMontantBancaire(brut)
    return n === null ? { ecart: 'illisible' } : { montant: n }
  }
  const brutDebit = (row[reglage.colDebit] ?? '').trim()
  const brutCredit = (row[reglage.colCredit] ?? '').trim()
  if (!brutDebit && !brutCredit) return { ecart: 'absent' }
  const debit = brutDebit ? parseMontantBancaire(brutDebit) : 0
  const credit = brutCredit ? parseMontantBancaire(brutCredit) : 0
  if (debit === null || credit === null) return { ecart: 'illisible' }
  // Une banque écrit parfois 0,00 dans la colonne qui ne sert pas : seule compte celle qui porte un montant.
  if ((debit !== 0 && credit !== 0) || credit < 0) return { ecart: 'ambigu' }
  // Le débit sort, qu'il soit écrit en positif ou en négatif.
  return { montant: debit !== 0 ? -Math.abs(debit) : credit }
}

// ── Les en-têtes ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Quand une ligne nomme les colonnes, elle fait foi : c'est la seule source qui distingue un débit d'un crédit écrits tous
// deux en positif, et une colonne de SOLDE COURANT d'une colonne de montants. Sans elle, la colonne du solde — remplie sur
// TOUTES les lignes, là où Débit et Crédit ne le sont qu'à moitié — gagnait le compte des montants (export CIC ou Crédit
// Mutuel « Date;Date de valeur;Débit;Crédit;Libellé;Solde ») : chaque mouvement entrait au solde du compte.
type RoleDeColonne = 'date' | 'date_valeur' | 'debit' | 'credit' | 'solde' | 'montant'

// « Débit euros », « Crédit (EUR) », « Montant (€) », « Date d'opération » : sans accents, sans casse, sans la devise.
function normaliserEntete(v: string): string {
  return v.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(en )?(euros?|eur)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function roleDeLEntete(v: string): RoleDeColonne | null {
  const t = normaliserEntete(v)
  if (/^date (de )?valeur$/.test(t)) return 'date_valeur'
  if (/^date( (d |de l |de )?operation| comptable| compta| ope?)?$/.test(t)) return 'date'
  if (/^(montant )?debits?$/.test(t)) return 'debit'
  if (/^(montant )?credits?$/.test(t)) return 'credit'
  // « Solde », « Solde courant », « Nouveau solde », « Solde après opération ».
  if (/^(nouveau )?soldes?\b/.test(t)) return 'solde'
  if (/^(montant|somme)( (d |de l |de )?operation)?$/.test(t)) return 'montant'
  return null
}

export interface EnteteReconnue {
  ligne: number
  date: number | null
  dateValeur: number | null
  debit: number | null
  credit: number | null
  solde: number | null
  montant: number | null
}

// La ligne d'en-tête, cherchée dans les dix premières lignes (certaines banques, Société Générale ou LCL, font précéder la
// leur d'un préambule : numéro de compte, période, date d'export). Une ligne est un en-tête quand elle nomme au moins deux
// colonnes, dont une de montants. À rôle répété, la première colonne l'emporte.
export function colonnesParEntete(rows: string[][]): EnteteReconnue | null {
  for (const [ligne, row] of rows.slice(0, 10).entries()) {
    const trouve: EnteteReconnue = { ligne, date: null, dateValeur: null, debit: null, credit: null, solde: null, montant: null }
    let reconnues = 0
    row.forEach((cellule, col) => {
      const role = roleDeLEntete(cellule)
      if (!role) return
      const cle = role === 'date_valeur' ? 'dateValeur' : role
      if (trouve[cle] === null) { trouve[cle] = col; reconnues++ }
    })
    if (reconnues >= 2 && (trouve.montant !== null || trouve.debit !== null || trouve.credit !== null)) return trouve
  }
  return null
}

// Une colonne de SOLDE COURANT se reconnaît, sans en-tête, à son arithmétique : d'une ligne à la suivante, elle varie du
// montant du mouvement (relevé du plus ancien au plus récent), ou de celui de la ligne d'avant (du plus récent au plus
// ancien). Il faut au moins deux paires lisibles, et que quatre sur cinq au moins le vérifient : ce n'est pas une
// supposition, c'est un calcul.
export function estUnSoldeCourant(rows: string[][], colSolde: number, montantDe: (row: string[]) => number | null): boolean {
  const lues = rows
    .map((row) => ({ solde: parseMontantBancaire((row[colSolde] ?? '').trim()), montant: montantDe(row) }))
    .filter((l): l is { solde: number; montant: number } => l.solde !== null && l.montant !== null)
  if (lues.length < 3) return false
  const centimes = (n: number) => Math.round(n * 100)
  let croissant = 0
  let decroissant = 0
  for (let i = 1; i < lues.length; i++) {
    const variation = centimes(lues[i].solde) - centimes(lues[i - 1].solde)
    if (variation === centimes(lues[i].montant)) croissant++
    if (-variation === centimes(lues[i - 1].montant)) decroissant++
  }
  return Math.max(croissant, decroissant) >= 0.8 * (lues.length - 1)
}

// Détecte automatiquement quelles colonnes contiennent la date, le montant et le libellé, en
// analysant le contenu réel des lignes plutôt qu'en supposant un ordre de colonnes fixe — les
// formats varient trop d'une banque à l'autre pour un ordre par défaut. Reste modifiable ensuite
// dans l'interface si la détection se trompe sur un format inhabituel.
//
// L'en-tête, quand il nomme les colonnes, fait foi (`colonnesParEntete`) : Débit et Crédit règlent le format à deux
// colonnes, une colonne Solde n'est jamais un montant. Sans en-tête, deux colonnes de montants qui ne sont jamais remplies
// sur la même ligne sont un Débit / Crédit ; une colonne qui vérifie l'arithmétique d'un solde courant n'est pas un montant.
// Ce qui ne se lit qu'en supposant (deux colonnes sans en-tête, toutes deux positives) se dit dans `doute`.
export function detectColumnMapping(rows: string[][]): DetectionDesColonnes {
  const echantillon = rows.slice(0, 30)
  // Certains exports ont des lignes de longueurs différentes (ex. une ligne de solde plus courte
  // que les lignes d'opérations) — on prend le nombre de colonnes le plus large observé.
  const nbColonnes = echantillon.reduce((max, r) => Math.max(max, r.length), 0)

  const scores = Array.from({ length: nbColonnes }, (_, col) => {
    let dateHits = 0
    let montantHits = 0
    let totalLen = 0
    let nonVides = 0
    for (const row of echantillon) {
      const val = (row[col] ?? '').trim()
      if (!val) continue
      nonVides++
      if (isFullDate(val)) dateHits++
      if (isFullMontant(val)) montantHits++
      totalLen += val.length
    }
    // Densité de texte rapportée à TOUTES les lignes de l'échantillon, pas seulement à celles où la
    // colonne est remplie. Une moyenne calculée sur les seules valeurs non vides fait gagner une
    // colonne presque toujours vide dès que ses rares valeurs sont longues — c'est exactement ce qui
    // s'est produit sur un relevé réel : la banque sépare le libellé des débits et celui des crédits
    // en deux colonnes, et la colonne « crédit » (135 lignes remplies sur 385, textes longs) a été
    // préférée à la colonne « débit » (247 lignes). Les deux tiers du relevé sont entrés sans libellé.
    return { col, dateHits, montantHits, densiteTexte: totalLen / Math.max(1, echantillon.length) }
  })

  type Score = (typeof scores)[number]
  const entete = colonnesParEntete(rows)
  const colDate = entete?.date
    ?? scores.reduce((best, s) => (s.dateHits > (best?.dateHits ?? 0) ? s : best), null as Score | null)?.col ?? 0
  // Les lignes d'opérations : celles qui suivent l'en-tête, et qui portent une date.
  const donnees = (entete ? rows.slice(entete.ligne + 1, entete.ligne + 31) : echantillon)
    .filter((r) => isFullDate((r[colDate] ?? '').trim()))
  const exclues = new Set([colDate, entete?.dateValeur, entete?.solde].filter((c): c is number => c != null))
  const candidates = scores.filter((s) => !exclues.has(s.col) && s.montantHits > 0)
  const lu = (r: string[], c: number) => parseMontantBancaire((r[c] ?? '').trim())

  let format: FormatDesMontants = 'signe'
  let colMontant = -1
  let colDebit = -1
  let colCredit = -1
  let doute: string | null = null

  if (entete && entete.debit !== null && entete.credit !== null && entete.debit !== entete.credit) {
    format = 'debit_credit'
    colDebit = entete.debit
    colCredit = entete.credit
  } else if (entete?.montant != null) {
    colMontant = entete.montant
  } else {
    if (entete && (entete.debit !== null || entete.credit !== null)) {
      doute = `L’en-tête nomme une colonne ${entete.debit !== null ? 'Débit sans colonne Crédit' : 'Crédit sans colonne Débit'} : `
        + 'vérifie le format du montant et le sens des montants interprétés.'
    }
    const paire = paireDebitCredit(donnees, candidates.map((s) => s.col))
    if (paire) {
      format = 'debit_credit'
      colDebit = paire.debit
      colCredit = paire.credit
      doute = paire.doute ?? doute
    }
  }
  if (format === 'signe' && colMontant === -1) {
    colMontant = candidates.reduce((best, s) => (s.montantHits > (best?.montantHits ?? 0) ? s : best), null as Score | null)?.col
      ?? scores.find((s) => !exclues.has(s.col))?.col ?? Math.min(1, nbColonnes - 1)
    // Le solde courant pris pour le montant : la colonne retenue suit l'arithmétique d'un solde par rapport à une autre
    // colonne de montants, qui est alors le vrai montant.
    const vrai = candidates.find((s) => s.col !== colMontant && estUnSoldeCourant(donnees, colMontant, (r) => lu(r, s.col)))
    if (vrai) colMontant = vrai.col
  }

  const reglage: ReglageDesMontants = format === 'signe'
    ? { format, colMontant, colDebit: colMontant, colCredit: Math.min(colMontant + 1, Math.max(0, nbColonnes - 1)) }
    : { format, colMontant: colDebit, colDebit, colCredit }
  const utilisees = format === 'signe' ? [reglage.colMontant] : [colDebit, colCredit]
  const montantDe = (r: string[]) => { const l = montantDeLigne(r, reglage); return 'montant' in l ? l.montant : null }
  const colSolde = entete?.solde
    ?? candidates.find((s) => !utilisees.includes(s.col) && estUnSoldeCourant(donnees, s.col, montantDe))?.col
    ?? null
  const autresMontants = [...(format === 'signe' ? [] : [colDebit, colCredit]), ...(colSolde === null ? [] : [colSolde])]

  const colLibelle = scores
    .filter((s) => s.col !== colDate && s.col !== entete?.dateValeur && !utilisees.includes(s.col) && s.col !== colSolde)
    .reduce((best, s) => (s.densiteTexte > (best?.densiteTexte ?? -1) ? s : best), null as Score | null)?.col ?? Math.min(2, nbColonnes - 1)

  // En-tête : une ligne qui nomme les colonnes en est un ; sinon, si la toute première ligne ne ressemble pas elle-même à
  // une opération (une date et un montant lisibles sur les colonnes détectées), c'est probablement une ligne de titres.
  // Le montant se lit par `montantDeLigne` : en Débit / Crédit, une première ligne de crédit a sa colonne Débit vide.
  const first = rows[0]
  const hasHeader = entete !== null || !(first && isFullDate((first[colDate] ?? '').trim()) && 'montant' in montantDeLigne(first, reglage))

  return { colDate, colLibelle, hasHeader, ligneEnTete: entete?.ligne ?? null, autresMontants, ...reglage, colSolde, doute }
}

// Deux colonnes de montants qui ne portent jamais un montant non nul sur la même ligne, qui ensemble couvrent au moins
// quatre lignes datées sur cinq, sans qu'aucune les couvre toutes : un Débit / Crédit sans en-tête. Le sens se lit aux
// signes quand une seule des deux porte des montants négatifs ; toutes deux positives, la première est prise pour le débit
// (l'ordre de toutes les banques françaises) — une supposition, que `doute` dit.
function paireDebitCredit(donnees: string[][], colonnes: number[]): { debit: number; credit: number; doute: string | null } | null {
  if (donnees.length < 2) return null
  const valeurs = (c: number) => donnees.map((r) => {
    const brut = (r[c] ?? '').trim()
    return brut ? parseMontantBancaire(brut) : 0
  })
  for (const [i, a] of colonnes.entries()) {
    for (const b of colonnes.slice(i + 1)) {
      const va = valeurs(a)
      const vb = valeurs(b)
      if (va.includes(null) || vb.includes(null)) continue
      const na = va as number[]
      const nb = vb as number[]
      if (na.some((x, k) => x !== 0 && nb[k] !== 0)) continue
      const remplieA = na.filter((x) => x !== 0).length
      const remplieB = nb.filter((x) => x !== 0).length
      if (remplieA === 0 || remplieB === 0 || remplieA === donnees.length || remplieB === donnees.length) continue
      if (remplieA + remplieB < 0.8 * donnees.length) continue
      const negA = na.some((x) => x < 0)
      const negB = nb.some((x) => x < 0)
      const posA = na.some((x) => x > 0)
      const posB = nb.some((x) => x > 0)
      if (negA && !posA && !negB) return { debit: a, credit: b, doute: null }
      if (negB && !posB && !negA) return { debit: b, credit: a, doute: null }
      if (!negA && !negB) {
        return {
          debit: a, credit: b,
          doute: `Deux colonnes de montants, sans en-tête qui les nomme : la colonne ${a + 1} est prise pour le débit, la colonne `
            + `${b + 1} pour le crédit. Vérifie le sens des montants interprétés ci-dessous avant d’importer.`,
        }
      }
    }
  }
  return null
}

// Libellé d'une ligne du relevé. Quand la colonne retenue est vide SUR CETTE LIGNE, le texte est
// reconstitué à partir des autres colonnes plutôt que remplacé par un générique.
//
// Ce n'est pas un cas tordu : certaines banques éclatent le libellé en deux colonnes, l'une pour les
// débits, l'autre pour les crédits, mutuellement exclusives. Quelle que soit la colonne choisie,
// l'autre moitié du relevé arrive vide — et un mouvement sans libellé est invisible pour la
// recherche, pour les règles « toujours ignorer » et pour la détection de récurrence, toutes fondées
// sur ce texte.
//
// Les colonnes date et montant sont exclues du repli : elles sont déjà stockées dans leurs champs,
// les répéter dans le libellé n'apprendrait rien et polluerait toutes les recherches sur un montant.
// Les autres colonnes de montants (`autresMontants` : Débit, Crédit, solde courant) le sont pour la même raison — le
// solde du compte recopié dans un libellé y serait pris pour une référence.
export function libelleDeLigne(row: string[], mapping: ColumnMapping): string {
  const choisi = (row[mapping.colLibelle] ?? '').trim()
  if (choisi) return choisi
  const autres = mapping.autresMontants ?? []
  return row
    .filter((_, i) => i !== mapping.colDate && i !== mapping.colMontant && i !== mapping.colLibelle && !autres.includes(i))
    .map((v) => (v ?? '').trim())
    .filter(Boolean)
    .join(' ')
}
