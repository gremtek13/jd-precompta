import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { bordereauFictifEnPdf, DESTINATAIRE_FICTIF, LIGNES_DU_BORDEREAU_FICTIF } from '../test/bordereauFictif'
import { fragmentsDeLaPage, lireLeBordereauDeTeletransmission, type OuvrirLeBordereau, type TacheDeTextePdfJs } from './bordereauDeTeletransmissionLecture'

// L'OUVERTURE DU BORDEREAU, SUR UN PDF FICTIF (conception 59, BOR1) : fabriqué par pdf-lib (src/test/bordereauFictif.ts), et
// lu par la version de pdf.js qui tourne hors navigateur, par le même code que le navigateur.

const ouvrirHorsNavigateur: OuvrirLeBordereau = (octets) => pdfjs.getDocument({ data: octets }) as unknown as TacheDeTextePdfJs

const pdfFictif = bordereauFictifEnPdf
const LIGNES = LIGNES_DU_BORDEREAU_FICTIF

const ATTENDU = {
  etat: 'lu',
  bordereaux: [{
    lot: 42, creeLe: '2026-11-09', securise: false, organisme: { code: '999', libelle: 'CPAM - VILLE FICTIVE' },
    nombreDeFactures: 2,
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

  it('un destinataire du règlement qui nomme une personne : lu, jamais rendu (BOR1-Q2 (B))', async () => {
    const octets = await pdfFictif({ destinataire: DESTINATAIRE_FICTIF })
    const r = await lireLeBordereauDeTeletransmission(new Blob([octets.slice(0)]), ouvrirHorsNavigateur)
    expect(r).toEqual(ATTENDU)
    expect(JSON.stringify(r)).not.toContain('BENEFICIAIRE')
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
