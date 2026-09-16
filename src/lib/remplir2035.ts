import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { ancragesDesCases, planDeRemplissage } from './gabarit2035'
import type { EnteteDeclaration, FiletVertical, FragmentTexte, PageFormulaire } from './gabarit2035'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

// Remplissage du formulaire 2035 officiel. Coquille volontairement mince autour des deux
// bibliothèques PDF : pdf.js pour LIRE le formulaire vierge (où sont les cases), pdf-lib pour ÉCRIRE
// par-dessus. Toute la géométrie et toutes les décisions vivent dans gabarit2035.ts, qui est testé —
// ici il ne reste que de la plomberie, qu'aucun test ne pourrait exécuter (pdf.js touche au DOM dès
// l'import).
//
// Le modèle vierge est servi depuis public/formulaires/ plutôt que demandé à l'utilisateur : « un
// bouton, un cerfa rempli » ne marche pas si on commence par réclamer un PDF.

// Le millésime est dans le nom : quand la DGFiP publiera l'édition suivante, on ajoutera un fichier
// au lieu d'écraser celui avec lequel les déclarations passées ont été produites.
export const MODELE_2035 = '/formulaires/2035-sd-2026.pdf'

// Seules les deux premières pages portent les cases qu'on sait remplir (2035-A puis 2035-B). Les
// suivantes (annexe sociétés, capital, filiales) ne sont pas alimentées par ce moteur ; les lire
// coûterait du temps pour rien.
const PAGES_LUES = 2

// pdf.js type le contenu d'une page comme une union « fragment de texte | balise de structure ».
// Seuls les fragments portent une position ; les balises n'ont pas de `str`, d'où le tri avant usage.
interface ItemTexte {
  str: string
  transform: number[]
  width: number
  height: number
}

// Extrait d'une page ce dont la géométrie a besoin : les fragments de texte (qui portent les codes
// de case) et les filets verticaux (qui délimitent les cases).
async function lirePage(doc: pdfjsLib.PDFDocumentProxy, numero: number): Promise<PageFormulaire> {
  const page = await doc.getPage(numero)

  const fragments: FragmentTexte[] = (await page.getTextContent()).items
    .filter((i) => 'str' in i)
    .map((i) => {
      const t = i as ItemTexte
      return { texte: t.str, x: t.transform[4], y: t.transform[5], largeur: t.width, hauteur: t.height }
    })

  // Les cases du formulaire ne sont pas des rectangles pleins mais des traits. pdf.js rend chaque
  // tracé avec sa boîte englobante : un filet vertical est un tracé sans largeur et avec de la
  // hauteur. Le seuil de 2 points absorbe l'épaisseur du trait lui-même.
  const operations = await page.getOperatorList()
  const filets: FiletVertical[] = []
  for (let i = 0; i < operations.fnArray.length; i++) {
    if (operations.fnArray[i] !== pdfjsLib.OPS.constructPath) continue
    const boite = operations.argsArray[i][2] as number[] | undefined
    if (!boite) continue
    const [x0, y0, x1, y1] = boite
    if (x1 - x0 <= 2 && y1 - y0 > 4) filets.push({ x: (x0 + x1) / 2, y0, y1 })
  }

  return { fragments, filets }
}

export interface Remplissage2035 {
  pdf: Uint8Array
  // Cases pour lesquelles un montant existait mais dont la position n'a pas pu être déduite du
  // formulaire. Vide en temps normal ; non vide, c'est que le millésime du modèle a changé et que le
  // repérage doit être revu. Jamais silencieux : un montant absent d'une déclaration ne se voit pas.
  codesSansAncrage: string[]
}

export async function remplir2035(
  valeurs: Map<string, number>,
  entete: EnteteDeclaration,
): Promise<Remplissage2035> {
  const reponse = await fetch(MODELE_2035)
  if (!reponse.ok) throw new Error(`Formulaire 2035 introuvable (${reponse.status})`)
  const modele = await reponse.arrayBuffer()

  // pdf.js consomme (« detach ») le tampon qu'on lui passe : sans copie, pdf-lib recevrait ensuite un
  // ArrayBuffer vidé. Bug silencieux et déroutant, d'où la copie explicite.
  const doc = await pdfjsLib.getDocument({ data: modele.slice(0) }).promise
  const pages: PageFormulaire[] = []
  for (let n = 1; n <= Math.min(PAGES_LUES, doc.numPages); n++) pages.push(await lirePage(doc, n))

  const { inscriptions, codesSansAncrage } = planDeRemplissage(ancragesDesCases(pages), valeurs, entete, pages)

  // pdf-lib n'est chargé qu'ici : c'est 300 Ko dont l'écran n'a besoin qu'au clic sur « remplir ».
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const pdf = await PDFDocument.load(modele)
  const police = await pdf.embedFont(StandardFonts.Helvetica)
  const feuilles = pdf.getPages()

  for (const i of inscriptions) {
    const feuille = feuilles[i.page - 1]
    if (!feuille) continue
    const largeur = police.widthOfTextAtSize(i.texte, i.taille)
    feuille.drawText(i.texte, {
      x: i.alignement === 'droite' ? i.x - largeur : i.x,
      y: i.y,
      size: i.taille,
      font: police,
      // Bleu foncé plutôt que noir : sur une relecture papier, ce qui a été porté par l'application
      // se distingue immédiatement de ce qui était imprimé sur le formulaire.
      color: rgb(0, 0, 0.6),
    })
  }

  return { pdf: await pdf.save(), codesSansAncrage }
}
