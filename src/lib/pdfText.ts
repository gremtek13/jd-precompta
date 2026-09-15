import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

interface TextItem {
  str: string
  transform: number[]
}

// Extrait le texte d'un PDF en reconstituant les sauts de ligne à partir de la position verticale
// des éléments (pdf.js ne renvoie que des fragments de texte positionnés, pas des lignes toutes
// faites). Suffisant pour un relevé bancaire où chaque opération tient sur une ligne.
//
// La lecture des opérations à partir de ce texte vit dans `relevePdf.ts` : pdf.js touche au DOM dès
// l'import, ce qui rendrait tout ce module impossible à exécuter en test.
export async function extractPdfText(file: Blob): Promise<string> {
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
