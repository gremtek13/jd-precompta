import * as pdfjsLib from 'pdfjs-dist'
import { planDeRemplissage2035SD } from './gabarit2035SD'
import type { EnteteDeclaration2035SD, FiletHorizontal, Inscription2035SD, PageQuadrillee } from './gabarit2035SD'
import { avisDuTableauDesImmobilisations } from './declaration2035SD'
import type { Declaration2035SD } from './declaration2035SD'
import { mentionDuPdf2035SD, modeleDuFormulaire2035SD } from './modeles2035SD'
import { lirePage } from './remplir2035'

// LE REMPLISSAGE DE LA DÉCLARATION PRINCIPALE N° 2035-SD (docs/conceptions/55-formulaire-2035-sd.md). Coquille mince autour
// de pdf.js (LIRE le formulaire vierge : où sont les cases) et de pdf-lib (ÉCRIRE par-dessus), comme remplir2035.ts et
// remplir2033.ts, dont elle reprend la lecture d'une page ; toute la géométrie et toutes les décisions vivent dans
// gabarit2035SD.ts et declaration2035SD.ts, testés.
//
// Le modèle vierge est servi par l'application (lib/modeles2035SD.ts), jamais demandé ailleurs ; son empreinte est vérifiée
// ICI avant tout usage : un fichier servi qui ne serait pas celui de la DGFiP ne se remplit pas. Le PDF est un document de
// contrôle et d'archive : la 2035 se télédéclare (CGI art. 1649 quater B quater), l'application ne prétend pas la déposer.

const PAGES_DU_FORMULAIRE = 4

export interface Remplissage2035SD {
  pdf: Uint8Array
  /** Ce qui avait une valeur mais dont la case n'a pas été retrouvée sur le formulaire. Vide en temps normal ; jamais tu. */
  libellesSansAncrage: string[]
  /** Les états annexes ajoutés au tableau I (pages 5 et suivantes), quand les biens ne tiennent pas sur la page 3. */
  etatsAnnexes: number
}

async function empreinteSha256(donnees: ArrayBuffer): Promise<string> {
  const condensat = await crypto.subtle.digest('SHA-256', donnees)
  return [...new Uint8Array(condensat)].map((o) => o.toString(16).padStart(2, '0')).join('')
}

// Une page lue avec ses filets HORIZONTAUX en plus : le corps du tableau des immobilisations se borne par eux. Le tracé d'une
// ligne horizontale est sans hauteur et a de la largeur (la règle des verticaux de `lirePage`, retournée).
async function lirePageQuadrillee(doc: pdfjsLib.PDFDocumentProxy, numero: number): Promise<PageQuadrillee> {
  const { fragments, filets } = await lirePage(doc, numero)
  const operations = await (await doc.getPage(numero)).getOperatorList()
  const horizontaux: FiletHorizontal[] = []
  for (let i = 0; i < operations.fnArray.length; i++) {
    if (operations.fnArray[i] !== pdfjsLib.OPS.constructPath) continue
    const boite = operations.argsArray[i][2] as number[] | undefined
    if (!boite) continue
    const [x0, y0, x1, y1] = boite
    if (y1 - y0 <= 2 && x1 - x0 > 4) horizontaux.push({ y: (y0 + y1) / 2, x0, x1 })
  }
  return { fragments, filets, horizontaux }
}

export async function remplir2035SD(
  declaration: Declaration2035SD,
  entete: EnteteDeclaration2035SD,
): Promise<Remplissage2035SD> {
  const annee = declaration.annee
  const modeleDeLExercice = modeleDuFormulaire2035SD(annee)
  if (!modeleDeLExercice) throw new Error(`Déclaration 2035-SD des revenus ${annee} absente de l’application`)
  const reponse = await fetch(modeleDeLExercice.chemin)
  if (!reponse.ok) throw new Error(`Déclaration 2035-SD introuvable (${reponse.status})`)
  const modele = await reponse.arrayBuffer()
  if (await empreinteSha256(modele) !== modeleDeLExercice.empreinte) {
    throw new Error(`Le formulaire 2035-SD millésime ${modeleDeLExercice.millesime} servi n’est pas celui de la DGFiP : il ne se remplit pas.`)
  }

  // pdf.js détache le tampon qu'on lui passe : sans copie, pdf-lib recevrait un ArrayBuffer vidé (règle du dépôt).
  const doc = await pdfjsLib.getDocument({ data: modele.slice(0) }).promise
  const pages: PageQuadrillee[] = []
  for (let n = 1; n <= Math.min(PAGES_DU_FORMULAIRE, doc.numPages); n++) pages.push(await lirePageQuadrillee(doc, n))

  const avis = avisDuTableauDesImmobilisations(declaration.immobilisations)
  const plan = planDeRemplissage2035SD(pages, declaration, entete, avis)

  // pdf-lib n'est chargé qu'ici, au clic.
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const pdf = await PDFDocument.load(modele)
  const police = await pdf.embedFont(StandardFonts.Helvetica)
  // Les états annexes sont des copies VIERGES de la page 3, prises avant que rien n'y soit écrit.
  for (let k = 0; k < plan.etatsAnnexes; k++) {
    const [copie] = await pdf.copyPages(pdf, [2])
    pdf.addPage(copie)
  }
  const feuilles = pdf.getPages()

  // Une inscription qui déborderait de sa case : la police se réduit jusqu'à 5,5 points, puis le texte se coupe, marqué « … ».
  const ajuster = (i: Inscription2035SD): { texte: string; taille: number } => {
    if (i.largeurMax === undefined) return { texte: i.texte, taille: i.taille }
    const largeurMax = Math.max(i.largeurMax, 10)
    let taille = i.taille
    while (taille > 5.5 && police.widthOfTextAtSize(i.texte, taille) > largeurMax) taille -= 0.5
    let texte = i.texte
    while (texte.length > 1 && police.widthOfTextAtSize(texte, taille) > largeurMax) texte = `${texte.slice(0, -2)}…`
    return { texte, taille }
  }
  const dessiner = (i: Inscription2035SD, couleur: ReturnType<typeof rgb>) => {
    const feuille = feuilles[i.page - 1]
    if (!feuille) return
    const { texte, taille } = ajuster(i)
    const largeur = police.widthOfTextAtSize(texte, taille)
    const x = i.alignement === 'droite' ? i.x - largeur : i.alignement === 'centre' ? i.x - largeur / 2 : i.x
    feuille.drawText(texte, { x, y: i.y, size: taille, font: police, color: couleur })
  }
  // Bleu foncé pour ce que l'application a porté, rouge pour ce qui reste à saisir : comme la 2035-A/B et la 2035-E.
  for (const i of plan.inscriptions) dessiner(i, rgb(0, 0, 0.6))
  for (const i of plan.aSaisir) dessiner(i, rgb(0.75, 0, 0))

  // Le millésime qui n'est pas le bon se dit en tête des pages remplies ; les mentions de l'application, au bas de leur page.
  const mention = mentionDuPdf2035SD(annee)
  const rouge = rgb(0.75, 0, 0)
  const ligneRouge = (numero: number, ligne: string, y: number) => {
    const feuille = feuilles[numero - 1]
    if (!feuille) return
    const largeurMax = feuille.getWidth() - 56
    let taille = 7
    while (taille > 5 && police.widthOfTextAtSize(ligne, taille) > largeurMax) taille -= 0.5
    feuille.drawText(ligne, { x: 28, y, size: taille, font: police, color: rouge })
  }
  if (mention.length > 0) {
    for (const numero of new Set([...plan.inscriptions, ...plan.aSaisir].map((i) => i.page))) {
      const haut = feuilles[numero - 1]?.getHeight() ?? 0
      mention.forEach((ligne, k) => ligneRouge(numero, ligne, haut - 14 - k * 9))
    }
  }
  for (const [numero, lignes] of plan.notes) lignes.forEach((ligne, k) => ligneRouge(numero, ligne, 80 - k * 9))

  return { pdf: await pdf.save(), libellesSansAncrage: plan.libellesSansAncrage, etatsAnnexes: plan.etatsAnnexes }
}
