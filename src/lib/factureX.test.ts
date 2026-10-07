import { describe, expect, it, vi } from 'vitest'
import { AFRelationship, PDFDocument } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  documentDeLaTache,
  NOMS_XML_FACTURX,
  pieceJointeDeLaFacture,
  xmlDuFacturX,
  type DocumentPdfOuvert,
  type OuvrirPdf,
  type TachePdfJs,
} from './factureX'

// Les PDF sont fabriqués ici par pdf-lib et lus par la version de pdf.js qui tourne hors navigateur, à travers le
// MÊME code que celui du navigateur (`documentDeLaTache`) : seuls les deux `import` de l'ouverture du navigateur
// restent hors du test.
const ouvrirHorsNavigateur: OuvrirPdf = (octets) =>
  documentDeLaTache(pdfjs.getDocument({ data: octets }) as unknown as TachePdfJs)

const XML = '<?xml version="1.0" encoding="UTF-8"?><rsm:CrossIndustryInvoice xmlns:rsm="urn:x">Fournitures é</rsm:CrossIndustryInvoice>'

async function pdfAvec(jointes: { nom: string; octets: Uint8Array }[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([200, 200])
  for (const j of jointes) {
    await doc.attach(j.octets, j.nom, { mimeType: 'text/xml', description: 'Facture', afRelationship: AFRelationship.Data })
  }
  return doc.save()
}

const utf8 = (t: string) => new TextEncoder().encode(t)

describe('pieceJointeDeLaFacture', () => {
  it('prend la facture structurée par son nom, du plus attendu au moins attendu, sans regarder la casse', () => {
    expect(pieceJointeDeLaFacture(['zugferd-invoice.xml', 'factur-x.xml'])).toBe('factur-x.xml')
    expect(pieceJointeDeLaFacture(['notes.xml', ' Factur-X.XML '])).toBe(' Factur-X.XML ')
    expect(pieceJointeDeLaFacture(['ZUGFeRD-invoice.xml'])).toBe('ZUGFeRD-invoice.xml')
    expect(pieceJointeDeLaFacture(['xrechnung.xml'])).toBe('xrechnung.xml')
    expect(pieceJointeDeLaFacture(['facture.xml', 'factur-x.xml.bak', 'conditions.pdf'])).toBeNull()
    expect(pieceJointeDeLaFacture([])).toBeNull()
    expect(NOMS_XML_FACTURX[0]).toBe('factur-x.xml')
  })
})

describe('xmlDuFacturX — un vrai PDF', () => {
  it('rend le XML joint sous le nom de la norme, en UTF-8', async () => {
    const pdf = await pdfAvec([{ nom: 'factur-x.xml', octets: utf8(XML) }])
    expect(await xmlDuFacturX(pdf, ouvrirHorsNavigateur)).toEqual({ xml: XML })
  })

  it('reconnaît le nom de ZUGFeRD, et préfère celui de Factur-X quand le PDF porte les deux', async () => {
    const zugferd = await pdfAvec([{ nom: 'ZUGFeRD-invoice.xml', octets: utf8('<z/>') }])
    expect(await xmlDuFacturX(zugferd, ouvrirHorsNavigateur)).toEqual({ xml: '<z/>' })
    const deux = await pdfAvec([
      { nom: 'zugferd-invoice.xml', octets: utf8('<z/>') },
      { nom: 'factur-x.xml', octets: utf8('<f/>') },
    ])
    expect(await xmlDuFacturX(deux, ouvrirHorsNavigateur)).toEqual({ xml: '<f/>' })
  })

  it('ne lit aucun autre fichier joint', async () => {
    const autre = await pdfAvec([{ nom: 'conditions.xml', octets: utf8('<c/>') }])
    expect(await xmlDuFacturX(autre, ouvrirHorsNavigateur)).toEqual({
      refus: 'Ce PDF ne porte pas de facture structurée (aucune pièce jointe « factur-x.xml »).',
    })
    const sansRien = await pdfAvec([])
    expect(await xmlDuFacturX(sansRien, ouvrirHorsNavigateur)).toEqual({
      refus: 'Ce PDF ne porte pas de facture structurée (aucune pièce jointe « factur-x.xml »).',
    })
  })

  it('refuse une facture jointe vide ou qui n’est pas du texte UTF-8', async () => {
    const vide = await pdfAvec([{ nom: 'factur-x.xml', octets: new Uint8Array() }])
    expect(await xmlDuFacturX(vide, ouvrirHorsNavigateur)).toEqual({ refus: 'La facture structurée jointe au PDF est vide.' })
    const latin1 = await pdfAvec([{ nom: 'factur-x.xml', octets: new Uint8Array([0x3c, 0x61, 0x3e, 0xe9, 0x3c, 0x2f, 0x61, 0x3e]) }])
    expect(await xmlDuFacturX(latin1, ouvrirHorsNavigateur)).toEqual({ refus: 'La facture structurée jointe au PDF n’est pas un texte UTF-8.' })
  })

  it('refuse ce qui ne s’ouvre pas comme un PDF', async () => {
    expect(await xmlDuFacturX(utf8('ceci n’est pas un PDF'), ouvrirHorsNavigateur)).toEqual({ refus: 'Le PDF Factur-X ne s’ouvre pas.' })
  })

  it('laisse intacts les octets de l’appelant, qui doit encore les déposer', async () => {
    const pdf = await pdfAvec([{ nom: 'factur-x.xml', octets: utf8(XML) }])
    const longueur = pdf.length
    await xmlDuFacturX(pdf, ouvrirHorsNavigateur)
    expect(pdf.length).toBe(longueur)
    expect(pdf.buffer.byteLength).toBeGreaterThan(0)
  })
})

describe('xmlDuFacturX — ce que fait le module autour de pdf.js', () => {
  const faux = (jointes: { nom: string; contenu: Uint8Array | null }[], fermer = vi.fn(async () => {})): DocumentPdfOuvert & { fermer: typeof fermer } => ({
    piecesJointes: async () => jointes.map((j) => ({ nom: j.nom, lire: async () => j.contenu })),
    fermer,
  })

  it('passe à pdf.js une COPIE des octets', async () => {
    const pdf = utf8('%PDF-1.7')
    let recu: Uint8Array | null = null
    await xmlDuFacturX(pdf, async (o) => { recu = o; return faux([]) })
    expect(recu).not.toBe(pdf)
    expect(recu).toEqual(pdf)
  })

  it('ferme le document, qu’il ait rendu la facture ou non', async () => {
    for (const jointes of [[{ nom: 'factur-x.xml', contenu: utf8('<f/>') }], [], [{ nom: 'factur-x.xml', contenu: null }]]) {
      const doc = faux(jointes)
      await xmlDuFacturX(utf8('%PDF'), async () => doc)
      expect(doc.fermer).toHaveBeenCalledTimes(1)
    }
  })

  it('une lecture des pièces jointes qui échoue est un refus, et le document se ferme quand même', async () => {
    const fermer = vi.fn(async () => {})
    const doc: DocumentPdfOuvert = { piecesJointes: async () => { throw new Error('PDF abîmé') }, fermer }
    expect(await xmlDuFacturX(utf8('%PDF'), async () => doc)).toEqual({ refus: 'Les pièces jointes du PDF Factur-X ne se lisent pas.' })
    expect(fermer).toHaveBeenCalledTimes(1)
  })

  it('un échec à fermer ne change rien à ce qu’on a lu', async () => {
    const journal = vi.spyOn(console, 'error').mockImplementation(() => {})
    const doc = faux([{ nom: 'factur-x.xml', contenu: utf8('<f/>') }], vi.fn(async () => { throw new Error('déjà fermé') }))
    expect(await xmlDuFacturX(utf8('%PDF'), async () => doc)).toEqual({ xml: '<f/>' })
    expect(journal).toHaveBeenCalledTimes(1)
    journal.mockRestore()
  })
})
