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

// Heuristique volontairement simple : une opération = une ligne avec une date en début et un
// montant en fin (format le plus courant sur les relevés PDF). Les lignes qui ne matchent pas
// (en-têtes, totaux, texte de libellé qui déborde sur une deuxième ligne) sont ignorées — mieux
// vaut manquer une ligne que d'en inventer une. Le tableau de prévisualisation reste modifiable
// pour corriger ou compléter à la main.
export function parseLignesFromPdfText(text: string): LigneExtraite[] {
  const dateRegex = /\d{1,2}[/.]\d{1,2}[/.]\d{2,4}/
  const montantRegex = /(-?\d{1,3}(?:[  ]\d{3})*,\d{2})\s*€?\s*$/

  const results: LigneExtraite[] = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    const dateMatch = line.match(dateRegex)
    const montantMatch = line.match(montantRegex)
    if (!dateMatch || !montantMatch || dateMatch.index === undefined || montantMatch.index === undefined) continue

    const date = parseDateBancaire(dateMatch[0])
    const montant = parseMontantBancaire(montantMatch[1])
    if (!date || montant === null) continue

    const libelle = line.slice(dateMatch.index + dateMatch[0].length, montantMatch.index).trim()
    results.push({ date, libelle: libelle || 'Mouvement bancaire', montant })
  }
  return results
}
