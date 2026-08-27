// Parseur CSV minimal mais robuste (guillemets, champs contenant le délimiteur, CRLF/LF).
// Les exports bancaires français utilisent très souvent le point-virgule comme délimiteur
// (le montant contient déjà une virgule décimale) — on le détecte plutôt que de le supposer.
export function parseCsv(text: string): string[][] {
  const delimiter = text.slice(0, 2000).includes(';') ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
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
  if (field !== '' || row.length > 0) {
    row.push(field)
    if (row.some((f) => f.trim() !== '')) rows.push(row)
  }
  return rows
}

// Un montant bancaire français : "1 234,56", "-45,20", parfois avec des espaces insécables.
export function parseMontantBancaire(raw: string): number | null {
  const cleaned = raw.replace(/[\s ]/g, '').replace(',', '.')
  const n = parseFloat(cleaned)
  return Number.isNaN(n) ? null : n
}

// Date au format JJ/MM/AAAA (le plus courant sur les relevés français) ou déjà ISO AAAA-MM-JJ.
export function parseDateBancaire(raw: string): string | null {
  const trimmed = raw.trim()
  let m = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = trimmed.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/)
  if (m) {
    let year = +m[3]
    if (year < 100) year += year < 70 ? 2000 : 1900
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
  return /^-?\d{1,9}([.,]\d{1,2})?\s*€?$/.test(s.trim())
}

export interface ColumnMapping {
  colDate: number
  colMontant: number
  colLibelle: number
  hasHeader: boolean
}

// Détecte automatiquement quelles colonnes contiennent la date, le montant et le libellé, en
// analysant le contenu réel des lignes plutôt qu'en supposant un ordre de colonnes fixe — les
// formats varient trop d'une banque à l'autre pour un ordre par défaut. Reste modifiable ensuite
// dans l'interface si la détection se trompe sur un format inhabituel.
export function detectColumnMapping(rows: string[][]): ColumnMapping {
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
    return { col, dateHits, montantHits, avgLen: nonVides ? totalLen / nonVides : 0 }
  })

  const colDate = scores.reduce((best, s) => (s.dateHits > (best?.dateHits ?? 0) ? s : best), null as (typeof scores)[number] | null)?.col ?? 0
  const colMontant = scores
    .filter((s) => s.col !== colDate)
    .reduce((best, s) => (s.montantHits > (best?.montantHits ?? 0) ? s : best), null as (typeof scores)[number] | null)?.col ?? Math.min(1, nbColonnes - 1)
  const colLibelle = scores
    .filter((s) => s.col !== colDate && s.col !== colMontant)
    .reduce((best, s) => (s.avgLen > (best?.avgLen ?? -1) ? s : best), null as (typeof scores)[number] | null)?.col ?? Math.min(2, nbColonnes - 1)

  // En-tête : si la toute première ligne ne ressemble pas elle-même à une opération (date/montant
  // valides sur les colonnes détectées), c'est probablement une ligne de titres de colonnes.
  const first = rows[0]
  const hasHeader = !(first && isFullDate((first[colDate] ?? '').trim()) && isFullMontant((first[colMontant] ?? '').trim()))

  return { colDate, colMontant, colLibelle, hasHeader }
}
