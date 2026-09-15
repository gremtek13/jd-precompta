import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { LignePdf } from './relevePdf'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

interface TextItem {
  str: string
  transform: number[]
}

// Reconstitue les lignes d'un PDF à partir de la position des fragments de texte (pdf.js ne renvoie
// que des fragments positionnés, pas des lignes toutes faites) : la verticale les regroupe en
// lignes, l'horizontale du dernier fragment est conservée parce qu'elle seule distingue un débit
// d'un crédit sur un relevé à deux colonnes. Suffisant pour un relevé bancaire où chaque opération
// tient sur une ligne.
//
// La lecture des opérations à partir de ces lignes vit dans `relevePdf.ts` : pdf.js touche au DOM
// dès l'import, ce qui rendrait tout ce module impossible à exécuter en test.
export async function extractPdfLignes(file: Blob): Promise<LignePdf[]> {
  const buffer = await file.arrayBuffer()
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise

  const lignes: LignePdf[] = []
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum)
    const content = await page.getTextContent()
    const items = content.items as TextItem[]

    let currentY: number | null = null
    let fragments: string[] = []
    let xFin = 0
    const cloreLigne = () => {
      if (fragments.length > 0) lignes.push({ texte: fragments.join(' '), xFin })
    }

    for (const item of items) {
      const y = Math.round(item.transform[5])
      if (currentY === null || Math.abs(y - currentY) > 2) {
        cloreLigne()
        fragments = []
        currentY = y
      }
      if (item.str.trim()) {
        fragments.push(item.str)
        xFin = item.transform[4]
      }
    }
    cloreLigne()
  }

  return lignes
}
