import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { fragmentsDeLaPage, lireLeBordereauDeTeletransmission, type OuvrirLeBordereau, type TacheDeTextePdfJs } from './bordereauDeTeletransmissionLecture'

// L'OUVERTURE DU BORDEREAU, SUR UN PDF FICTIF (conception 59, BOR1) : fabriqué ici par pdf-lib, à la forme de la page réelle
// montrée par le cabinet le 18/11/2026 (titre centré, en-tête d'une ligne par champ, une cellule par colonne, la ligne de
// total, le pied), et lu par la version de pdf.js qui tourne hors navigateur, par le même code que le navigateur. Les noms
// et numéros sont INVENTÉS.

const ouvrirHorsNavigateur: OuvrirLeBordereau = (octets) => pdfjs.getDocument({ data: octets }) as unknown as TacheDeTextePdfJs

// Les abscisses des neuf colonnes ; les montants alignés à droite, comme un tableau imprimé.
const COLONNES = [30, 85, 140, 225, 330, 385, 440, 495, 550]
const ENTETES = ['Facture', 'Date prescription', 'Numéro Assuré', 'Nom Bénéficiaire', 'Naissance', 'Total', 'Caisse', 'Mutuelle', 'Assuré']
const LIGNES: string[][] = [
  ['900000001', '01/10/2026', '1999999999999 71', 'BENEFICIAIRE UN', '01/01/1950', '654,00', '457,80', '196,20', '0,00'],
  ['900000002', '02/10/2026', '2999999999999 72', 'BENEFICIAIRE DEUX', '02/02/1960', '3 946,10', '3 946,10', '0,00', '0,00'],
]

async function pdfFictif(options: { total?: string[]; pages?: 1 | 2 } = {}): Promise<Uint8Array> {
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
      'Organisme assurance maladie destinataire : 999 - CPAM - VILLE FICTIVE', 'Destinataire du réglement : Partenaire de santé',
      'CAISSE PRIMAIRE FICTIVE', '1 RUE IMAGINAIRE 99999 NULLEPART',
    ]) { ecrire(l, 30); y -= 12 }
    y -= 8
    ENTETES.forEach((t, c) => ecrire(t, COLONNES[c], c >= 5)); y -= 12
  }
  enTete()
  LIGNES.forEach((cellules, rang) => {
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

const ATTENDU = {
  etat: 'lu',
  bordereaux: [{
    lot: 42, creeLe: '2026-11-09', securise: false, organisme: { code: '999', libelle: 'CPAM - VILLE FICTIVE' },
    destinataireDuReglement: 'partenaire_de_sante', nombreDeFactures: 2,
    totaux: { totalCentimes: 460010, caisseCentimes: 440390, mutuelleCentimes: 19620, assureCentimes: 0 },
  }],
}

describe('lireLeBordereauDeTeletransmission, sur un PDF fictif', () => {
  it('lit l’en-tête du lot et ses totaux, par pdf.js', async () => {
    const octets = await pdfFictif()
    expect(await lireLeBordereauDeTeletransmission(new Blob([octets.slice(0)]), ouvrirHorsNavigateur)).toEqual(ATTENDU)
  })

  it('un bordereau sur deux pages, le total en dernière page', async () => {
    const octets = await pdfFictif({ pages: 2 })
    expect(await lireLeBordereauDeTeletransmission(new Blob([octets.slice(0)]), ouvrirHorsNavigateur)).toEqual(ATTENDU)
  })

  it('des sommes qui ne tombent pas se refusent ; le canari ne trouve aucune valeur d’une ligne', async () => {
    const octets = await pdfFictif({ total: ['4 600,11', '4 403,91', '196,20', '0,00'] })
    const r = await lireLeBordereauDeTeletransmission(new Blob([octets.slice(0)]), ouvrirHorsNavigateur)
    expect(r).toEqual({ etat: 'refuse', raison: 'bordereau 1 : la somme des lignes de la colonne « Total » diffère du total imprimé' })
    const lu = JSON.stringify(await lireLeBordereauDeTeletransmission(new Blob([(await pdfFictif()).slice(0)]), ouvrirHorsNavigateur))
    for (const cellule of LIGNES.flat().filter((c) => c.length >= 3)) expect(lu).not.toContain(cellule)
  })

  it('ne rejette jamais : un fichier qui n’est pas un PDF, une ouverture qui lève, une page qui ne se lit pas', async () => {
    expect(await lireLeBordereauDeTeletransmission(new Blob(['ceci n’est pas un PDF']), ouvrirHorsNavigateur))
      .toEqual({ etat: 'refuse', raison: 'le fichier ne s’ouvre pas comme un PDF' })
    expect(await lireLeBordereauDeTeletransmission(new Blob(['x']), () => { throw new Error('BENEFICIAIRE UN') }))
      .toEqual({ etat: 'refuse', raison: 'le fichier ne s’ouvre pas comme un PDF' })
    let detruite = false
    const pageQuiLeve: OuvrirLeBordereau = () => ({
      promise: Promise.resolve({ numPages: 1, getPage: () => Promise.reject(new Error('BENEFICIAIRE UN')) }),
      destroy: async () => { detruite = true },
    })
    expect(await lireLeBordereauDeTeletransmission(new Blob(['x']), pageQuiLeve)).toEqual({ etat: 'refuse', raison: 'la page 1 du PDF ne se lit pas' })
    expect(detruite).toBe(true)
  })

  it('un PDF sans texte (une image) se dit', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([595, 842])
    const r = await lireLeBordereauDeTeletransmission(new Blob([(await doc.save()).slice(0)]), ouvrirHorsNavigateur)
    expect(r).toMatchObject({ etat: 'refuse', raison: expect.stringMatching(/aucun texte/) as unknown as string })
  })
})

describe('fragmentsDeLaPage', () => {
  it('garde le texte, la position, la largeur et la hauteur ; écarte un élément sans texte ni matrice', () => {
    expect(fragmentsDeLaPage([
      { str: 'Lot', transform: [1, 0, 0, 1, 30, 700], width: 10, height: 7 },
      { type: 'beginMarkedContent' }, null, { str: 'x', transform: [1, 2] }, { str: 'y', transform: [1, 0, 0, 1, 5, 6] },
    ])).toEqual([
      { texte: 'Lot', x: 30, y: 700, largeur: 10, hauteur: 7 },
      { texte: 'y', x: 5, y: 6, largeur: undefined, hauteur: undefined },
    ])
  })
})
