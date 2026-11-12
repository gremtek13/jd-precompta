import * as pdfjsLib from 'pdfjs-dist'
import { mentionDesCasesASaisir, PAGE_DU_TABLEAU, planDeRemplissage2033, TABLEAUX_2033 } from './gabarit2033'
import type { Liasse2033ARemplir, Tableau2033 } from './gabarit2033'
import type { PageFormulaire } from './gabarit2035'
import { mentionDuPdf2033, modeleDuFormulaire2033 } from './modeles2033'
import { lirePage } from './remplir2035'

// LE REMPLISSAGE DE LA LIASSE 2033 — ligne 37, lot LIA6 (docs/conceptions/37-liasse-2033.md, § 3.3). Coquille mince autour
// de pdf.js (LIRE le formulaire vierge : où sont les cases) et de pdf-lib (ÉCRIRE par-dessus), comme remplir2035.ts, dont
// elle reprend la lecture d'une page ; toute la géométrie et toutes les décisions vivent dans gabarit2033.ts, testé.
//
// Le modèle vierge est servi par l'application (lib/modeles2033.ts), jamais demandé ailleurs ; son empreinte est vérifiée
// ICI avant tout usage, comme le dépôt l'a vérifiée avant de l'ajouter : un fichier servi qui ne serait pas celui de la
// DGFiP ne se remplit pas. Aucun écran n'appelle encore ce module (`LIASSE_EXPORTEE` baissé).
//
// Le PDF est un document de CONTRÔLE et d'archive : la liasse se télétransmet (EDI-TDFC, CGI art. 1649 quater B quater),
// et l'application ne prétend jamais l'avoir déposée (LIA-Q11).

export interface Remplissage2033 {
  pdf: Uint8Array
  /** « 2033-B 310 » : un montant dont la case n'a pas été trouvée sur le formulaire. Vide en temps normal ; jamais tu. */
  codesSansAncrage: string[]
  /** Les cases laissées vides parce qu'elles sont à saisir, tableau par tableau. */
  aSaisir: Map<Tableau2033, string[]>
}

async function empreinteSha256(donnees: ArrayBuffer): Promise<string> {
  const condensat = await crypto.subtle.digest('SHA-256', donnees)
  return [...new Uint8Array(condensat)].map((o) => o.toString(16).padStart(2, '0')).join('')
}

export async function remplir2033(
  liasse: Liasse2033ARemplir,
  // L'exercice déclaré : il choisit le millésime du formulaire. Sans valeur par défaut, comme pour la 2035.
  annee: number,
): Promise<Remplissage2033> {
  const modeleDeLExercice = modeleDuFormulaire2033(annee)
  if (!modeleDeLExercice) throw new Error(`Liasse 2033 de l’exercice ${annee} absente de l’application`)
  const reponse = await fetch(modeleDeLExercice.chemin)
  if (!reponse.ok) throw new Error(`Liasse 2033 introuvable (${reponse.status})`)
  const modele = await reponse.arrayBuffer()
  if (await empreinteSha256(modele) !== modeleDeLExercice.empreinte) {
    throw new Error(`Le formulaire 2033-SD millésime ${modeleDeLExercice.millesime} servi n’est pas celui de la DGFiP : il ne se remplit pas.`)
  }

  // pdf.js détache le tampon qu'on lui passe : sans copie, pdf-lib recevrait un ArrayBuffer vidé (règle du dépôt).
  const doc = await pdfjsLib.getDocument({ data: modele.slice(0) }).promise
  const pages = new Map<number, PageFormulaire>()
  for (const tableau of TABLEAUX_2033) {
    const numero = PAGE_DU_TABLEAU[tableau]
    if (liasse.tableaux[tableau] && numero <= doc.numPages) pages.set(numero, await lirePage(doc, numero))
  }
  const { inscriptions, codesSansAncrage, aSaisir } = planDeRemplissage2033(pages, liasse)

  // pdf-lib n'est chargé qu'ici, au clic.
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const pdf = await PDFDocument.load(modele)
  const police = await pdf.embedFont(StandardFonts.Helvetica)
  const feuilles = pdf.getPages()

  for (const i of inscriptions) {
    const feuille = feuilles[i.page - 1]
    if (!feuille) continue
    const largeur = police.widthOfTextAtSize(i.texte, i.taille)
    const x = i.alignement === 'droite' ? i.x - largeur : i.alignement === 'centre' ? i.x - largeur / 2 : i.x
    // Bleu foncé, comme la 2035 : ce que l'application a porté se distingue de ce qui était imprimé.
    feuille.drawText(i.texte, { x, y: i.y, size: i.taille, font: police, color: rgb(0, 0, 0.6) })
  }

  // En rouge dans la marge du haut : le millésime qui n'est pas le bon, puis les cases à saisir de la page.
  const mention = mentionDuPdf2033(annee)
  for (const tableau of TABLEAUX_2033) {
    if (!liasse.tableaux[tableau]) continue
    const feuille = feuilles[PAGE_DU_TABLEAU[tableau] - 1]
    if (!feuille) continue
    const lignes = [...mention, ...mentionDesCasesASaisir(aSaisir.get(tableau) ?? [])]
    const haut = feuille.getHeight()
    lignes.forEach((ligne, k) => {
      feuille.drawText(ligne, { x: 28, y: haut - 14 - k * 9, size: 7, font: police, color: rgb(0.75, 0, 0) })
    })
  }

  return { pdf: await pdf.save(), codesSansAncrage, aSaisir }
}
