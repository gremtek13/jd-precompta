import { PDFDocument, StandardFonts } from 'pdf-lib'

// UN BORDEREAU DE TÉLÉTRANSMISSION FICTIF EN PDF (conception 59, BOR1), fabriqué par pdf-lib à la forme de la page réelle
// montrée par le cabinet le 18/11/2026 (titre centré, en-tête d'une ligne par champ, une cellule par colonne, la ligne de
// total, le pied). Les noms, numéros et montants sont INVENTÉS. Servi à la lecture (bordereauDeTeletransmissionLecture.test.ts)
// et à l'outil local (bordereauOutilLocal.test.ts).

// Les abscisses des neuf colonnes ; les montants alignés à droite, comme un tableau imprimé.
const COLONNES = [30, 85, 140, 225, 330, 385, 440, 495, 550]
const ENTETES = ['Facture', 'Date prescription', 'Numéro Assuré', 'Nom Bénéficiaire', 'Naissance', 'Total', 'Caisse', 'Mutuelle', 'Assuré']

/** Les deux lignes de facture du bordereau fictif : aucune de leurs cellules ne doit sortir d'une lecture. */
export const LIGNES_DU_BORDEREAU_FICTIF: readonly (readonly string[])[] = [
  ['900000001', '01/10/2026', '1999999999999 71', 'BENEFICIAIRE UN', '01/01/1950', '654,00', '457,80', '196,20', '0,00'],
  ['900000002', '02/10/2026', '2999999999999 72', 'BENEFICIAIRE DEUX', '02/02/1960', '3 946,10', '3 946,10', '0,00', '0,00'],
]

/** Le libellé du destinataire du règlement du bordereau fictif : un nom de personne, accepté et jamais rendu (BOR1-Q2). */
export const DESTINATAIRE_FICTIF = 'MME BENEFICIAIRE TROIS'

export async function bordereauFictifEnPdf(options: { total?: string[]; pages?: 1 | 2; destinataire?: string } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const police = await doc.embedFont(StandardFonts.Helvetica)
  const taille = 7
  let p = doc.addPage([595, 842])
  let y = 800
  const ecrire = (texte: string, x: number, aDroite = false) => {
    const largeur = police.widthOfTextAtSize(texte, taille)
    p.drawText(texte, { x: aDroite ? x + 40 - largeur : x, y, size: taille, font: police })
  }
  const pied = (numero: string) => {
    const yGarde = y
    y = 30
    ecrire('18/11/2026', 30)
    ecrire(numero, 290)
    ecrire('Réalisé par Televitale', 480)
    y = yGarde
  }
  const enTete = () => {
    ecrire('Bordereau de Teletransmission', 240); y -= 20
    for (const l of [
      'PRATICIEN FICTIF 99-9-99999/9', 'Lot : 42 créé le 09/11/2026', 'LOT NON SECURISE',
      'Organisme assurance maladie destinataire : 999 - CPAM - VILLE FICTIVE',
      `Destinataire du réglement : ${options.destinataire ?? 'Partenaire de santé'}`,
      'CAISSE PRIMAIRE FICTIVE', '1 RUE IMAGINAIRE 99999 NULLEPART',
    ]) { ecrire(l, 30); y -= 12 }
    y -= 8
    ENTETES.forEach((t, c) => ecrire(t, COLONNES[c], c >= 5)); y -= 12
  }
  enTete()
  LIGNES_DU_BORDEREAU_FICTIF.forEach((cellules, rang) => {
    if (options.pages === 2 && rang === 1) {
      pied('1/2')
      p = doc.addPage([595, 842]); y = 800
      enTete()
    }
    cellules.forEach((t, c) => ecrire(t, COLONNES[c], c >= 5)); y -= 11
  })
  const total = options.total ?? ['4 600,10', '4 403,90', '196,20', '0,00']
  ecrire('TOTAL: LOT de 2 Factures', 30)
  total.forEach((t, k) => ecrire(t, COLONNES[5 + k], true))
  pied(options.pages === 2 ? '2/2' : '1/1')
  return doc.save()
}
