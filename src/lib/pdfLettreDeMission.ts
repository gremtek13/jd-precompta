import type { BlocDuPdf } from './lettresDeMissionVue'

// LE PDF D'UNE LETTRE DE MISSION PROPOSÉE (ligne 47, LM5) : les blocs de `contenuDuPdf` (lib/lettresDeMissionVue.ts), tirés
// des seules valeurs figées, mis en page A4 par pdf-lib, en Helvetica (aucune police chargée d'ailleurs, aucun appel
// réseau). Les dates du document sont celles de la proposition, jamais l'heure du clic : deux impressions de la même lettre
// par la même version de l'application rendent les mêmes octets. Le PDF ne se garde pas : la preuve est l'empreinte du
// CONTENU, que la base a calculée et que chaque page imprime, et le papier signé déposé, cité par la sienne (LM5-Q1).

const LARGEUR = 595.28
const HAUTEUR = 841.89
const MARGE = 56
const TAILLES: Record<BlocDuPdf['genre'], number> = { titre: 16, intertitre: 11.5, texte: 10, mention: 8 }

/**
 * Helvetica ne connaît que WinAnsi : un caractère hors de ce jeu ferait lever pdf-lib au milieu d'une page. Les espaces
 * insécables et fines deviennent des espaces, les tirets et guillemets typographiques que WinAnsi n'a pas leurs voisins, et
 * tout autre caractère un « ? » — dit, jamais effacé en silence.
 */
export function enWinAnsi(texte: string): string {
  return texte
    .replace(/[    ]/g, ' ')
    .replace(/[‐‑‒]/g, '-')
    .replace(/[^\n\t -~¡-ÿ–—‘’‚“”„†‡•…‰‹›€ŒœŠšŸŽžƒˆ˜™]/g, '?')
}

/** Coupe un paragraphe en lignes d'au plus `largeur` points, au mot ; un mot plus long que la ligne se coupe à la lettre. */
export function couperEnLignes(texte: string, largeur: number, mesure: (s: string) => number): string[] {
  const lignes: string[] = []
  for (const paragraphe of texte.split('\n')) {
    let courante = ''
    for (const mot of paragraphe.split(/ +/)) {
      const essai = courante === '' ? mot : `${courante} ${mot}`
      if (mesure(essai) <= largeur) { courante = essai; continue }
      if (courante !== '') lignes.push(courante)
      courante = ''
      let reste = mot
      while (mesure(reste) > largeur) {
        let n = reste.length - 1
        while (n > 1 && mesure(reste.slice(0, n)) > largeur) n -= 1
        lignes.push(reste.slice(0, n))
        reste = reste.slice(n)
      }
      courante = reste
    }
    lignes.push(courante)
  }
  return lignes
}

/** Le PDF des blocs ; `empreinte` se répète au pied de chaque page, `instant` date le document (la proposition). */
export async function pdfDeLaLettre(blocs: readonly BlocDuPdf[], p: { empreinte: string; instant: string }): Promise<Uint8Array> {
  // pdf-lib n'est chargé qu'au clic : 300 Ko dont l'écran n'a pas besoin avant.
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const normale = await doc.embedFont(StandardFonts.Helvetica)
  const grasse = await doc.embedFont(StandardFonts.HelveticaBold)
  const date = new Date(p.instant)
  doc.setTitle('Lettre de mission')
  doc.setProducer('jd-precompta')
  doc.setCreator('jd-precompta')
  doc.setCreationDate(date)
  doc.setModificationDate(date)

  let page = doc.addPage([LARGEUR, HAUTEUR])
  let y = HAUTEUR - MARGE
  const pied = `Empreinte du contenu : ${p.empreinte}`
  const poserLePied = () => page.drawText(pied, { x: MARGE, y: MARGE / 2, size: 7, font: normale, color: rgb(0.4, 0.4, 0.4) })
  poserLePied()
  for (const bloc of blocs) {
    const taille = TAILLES[bloc.genre]
    const police = bloc.genre === 'titre' || bloc.genre === 'intertitre' ? grasse : normale
    const interligne = taille * 1.35
    y -= bloc.genre === 'intertitre' ? taille : taille * 0.4
    for (const ligne of couperEnLignes(enWinAnsi(bloc.texte), LARGEUR - 2 * MARGE, (s) => police.widthOfTextAtSize(s, taille))) {
      if (y - interligne < MARGE) {
        page = doc.addPage([LARGEUR, HAUTEUR])
        poserLePied()
        y = HAUTEUR - MARGE
      }
      y -= interligne
      if (ligne !== '') page.drawText(ligne, { x: MARGE, y, size: taille, font: police, color: rgb(0.1, 0.1, 0.1) })
    }
  }
  return doc.save({ useObjectStreams: false })
}
