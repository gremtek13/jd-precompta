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
