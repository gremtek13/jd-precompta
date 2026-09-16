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
export function parseMontantBancaire(raw: string): number | null {
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
    // Densité de texte rapportée à TOUTES les lignes de l'échantillon, pas seulement à celles où la
    // colonne est remplie. Une moyenne calculée sur les seules valeurs non vides fait gagner une
    // colonne presque toujours vide dès que ses rares valeurs sont longues — c'est exactement ce qui
    // s'est produit sur un relevé réel : la banque sépare le libellé des débits et celui des crédits
    // en deux colonnes, et la colonne « crédit » (135 lignes remplies sur 385, textes longs) a été
    // préférée à la colonne « débit » (247 lignes). Les deux tiers du relevé sont entrés sans libellé.
    return { col, dateHits, montantHits, densiteTexte: totalLen / Math.max(1, echantillon.length) }
  })

  const colDate = scores.reduce((best, s) => (s.dateHits > (best?.dateHits ?? 0) ? s : best), null as (typeof scores)[number] | null)?.col ?? 0
  const colMontant = scores
    .filter((s) => s.col !== colDate)
    .reduce((best, s) => (s.montantHits > (best?.montantHits ?? 0) ? s : best), null as (typeof scores)[number] | null)?.col ?? Math.min(1, nbColonnes - 1)
  const colLibelle = scores
    .filter((s) => s.col !== colDate && s.col !== colMontant)
    .reduce((best, s) => (s.densiteTexte > (best?.densiteTexte ?? -1) ? s : best), null as (typeof scores)[number] | null)?.col ?? Math.min(2, nbColonnes - 1)

  // En-tête : si la toute première ligne ne ressemble pas elle-même à une opération (date/montant
  // valides sur les colonnes détectées), c'est probablement une ligne de titres de colonnes.
  const first = rows[0]
  const hasHeader = !(first && isFullDate((first[colDate] ?? '').trim()) && isFullMontant((first[colMontant] ?? '').trim()))

  return { colDate, colMontant, colLibelle, hasHeader }
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
export function libelleDeLigne(row: string[], mapping: ColumnMapping): string {
  const choisi = (row[mapping.colLibelle] ?? '').trim()
  if (choisi) return choisi
  return row
    .filter((_, i) => i !== mapping.colDate && i !== mapping.colMontant && i !== mapping.colLibelle)
    .map((v) => (v ?? '').trim())
    .filter(Boolean)
    .join(' ')
}
