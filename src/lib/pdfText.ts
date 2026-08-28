import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { parseDateBancaire, parseMontantBancaire } from './csv'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

interface TextItem {
  str: string
  transform: number[]
}

// Extrait le texte d'un PDF en reconstituant les sauts de ligne à partir de la position verticale
// des éléments (pdf.js ne renvoie que des fragments de texte positionnés, pas des lignes toutes
// faites). Suffisant pour un relevé bancaire où chaque opération tient sur une ligne.
export async function extractPdfText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise

  const lines: string[] = []
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum)
    const content = await page.getTextContent()
    const items = content.items as TextItem[]

    let currentY: number | null = null
    let currentLine: string[] = []
    for (const item of items) {
      const y = Math.round(item.transform[5])
      if (currentY === null || Math.abs(y - currentY) > 2) {
        if (currentLine.length > 0) lines.push(currentLine.join(' '))
        currentLine = []
        currentY = y
      }
      if (item.str.trim()) currentLine.push(item.str)
    }
    if (currentLine.length > 0) lines.push(currentLine.join(' '))
  }

  return lines.join('\n')
}

export interface LigneExtraite {
  date: string
  libelle: string
  montant: number
}

// Certaines banques (Caisse d'Épargne, vérifié sur un relevé réel) n'impriment que jour/mois sur
// chaque ligne d'opération, l'année n'apparaissant qu'une fois dans l'en-tête du relevé ("...de
// votre compte au 31/01/23..."). Sans cette période, une date jour/mois est inexploitable (aucune
// année à qui l'attribuer) — on ne cherche donc les dates à 2 segments qu'en complément d'une
// période trouvée, jamais en la devinant.
function trouvePeriode(texte: string): { mois: number; annee: number } | null {
  const m = texte.match(/\bau\s+(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\b/i)
  if (!m) return null
  const mois = +m[2]
  let annee = +m[3]
  if (annee < 100) annee += annee < 70 ? 2000 : 1900
  return { mois, annee }
}

function toIsoDateBancaire(annee: number, mois: number, jour: number): string | null {
  if (mois < 1 || mois > 12 || jour < 1 || jour > 31) return null
  return `${annee}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`
}

// Heuristique volontairement simple : une opération = une ligne avec une date en début et un
// montant en fin (format le plus courant sur les relevés PDF). Les lignes qui ne matchent pas
// (en-têtes, totaux, texte de libellé qui déborde sur une deuxième ligne) sont ignorées — mieux
// vaut manquer une ligne que d'en inventer une. Le tableau de prévisualisation reste modifiable
// pour corriger ou compléter à la main.
export function parseLignesFromPdfText(text: string): LigneExtraite[] {
  const dateRegexComplete = /(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/
  // Date jour/mois en tout début de ligne uniquement — une même ligne réelle porte souvent deux
  // dates jour/mois (date d'opération / date de valeur) côte à côte, on ne veut que la première.
  const dateRegexCourte = /^(\d{1,2})[/.](\d{1,2})\b/
  // "€" ou "EUR" en toutes lettres selon la ligne, constaté sur le même relevé réel (le mot complet
  // apparaît sur les paiements par carte différés, le symbole ailleurs).
  const montantRegex = /(-?\d{1,3}(?:[\s ]\d{3})*,\d{2})\s*(€|EUR)?\s*$/i

  const periode = trouvePeriode(text)

  const results: LigneExtraite[] = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    // Lignes de solde (ouverture/synthèse/clôture) : portent souvent une date et un montant en fin
    // de ligne comme une vraie opération, mais n'en sont pas une — exclues explicitement plutôt que
    // de polluer le rapprochement avec un faux mouvement.
    if (!line || /SOLDE/i.test(line)) continue

    const montantMatch = line.match(montantRegex)
    if (!montantMatch || montantMatch.index === undefined) continue

    const completeMatch = line.match(dateRegexComplete)
    let date: string | null = null
    let finDate = 0

    if (completeMatch && completeMatch.index !== undefined) {
      date = parseDateBancaire(completeMatch[0])
      finDate = completeMatch.index + completeMatch[0].length
    } else {
      const courteMatch = line.match(dateRegexCourte)
      if (courteMatch && periode) {
        const jour = +courteMatch[1]
        const mois = +courteMatch[2]
        // Le relevé peut chevaucher la fin de l'année précédente (relevé de janvier commençant par
        // des opérations de décembre) — un mois postérieur à celui de la période appartient alors à
        // l'année d'avant, jamais à celle du relevé.
        const annee = mois > periode.mois ? periode.annee - 1 : periode.annee
        date = toIsoDateBancaire(annee, mois, jour)
        finDate = courteMatch.index! + courteMatch[0].length
      }
    }
    if (!date) continue

    const montant = parseMontantBancaire(montantMatch[1])
    if (montant === null) continue

    const libelle = line.slice(finDate, montantMatch.index).trim()
    results.push({ date, libelle: libelle || 'Mouvement bancaire', montant })
  }
  return results
}
