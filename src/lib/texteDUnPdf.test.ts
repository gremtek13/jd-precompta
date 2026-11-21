import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { bordereauFictifEnPdf } from '../test/bordereauFictif'
import { lignesDesFragments, porteLaFormeDUnBordereau } from './bordereauDeTeletransmission'
import { fragmentsDeLaPage } from './bordereauDeTeletransmissionLecture'
import { lireLeTexteDUnPdf, type BornesDuTexte, type LectureDuTexte, type PageDuPdf } from './texteDUnPdf'

// LA COUCHE DE TEXTE D'UN PDF, LUE SANS PDF.JS (BOR6, seconde partie). Ce lecteur sert receive-email, qui écarte un bordereau
// de télétransmission AVANT tout dépôt : il doit rendre, sur ce qui se reconnaît, le verdict que pdf.js rend dans le navigateur
// (la première partie de BOR6), et rendre « illisible » ou rien, jamais lever, sur ce qu'il ne lit pas. Tous les PDF sont
// FICTIFS : fabriqués par pdf-lib, ou écrits ici objet par objet pour les formes que pdf-lib ne produit pas (une police
// composite Identity-H et son ToUnicode, un formulaire, un flux ASCII85, une table Differences, un texte posé glyphe par glyphe).

const LARGES: BornesDuTexte = { octetsDecompressesMax: 64 * 1024 * 1024, dureeMaxMs: 60_000, maintenant: () => performance.now() }
const TITRE = 'Bordereau de Teletransmission'

async function lire(octets: Uint8Array, bornes: BornesDuTexte = LARGES): Promise<{ lu: LectureDuTexte; pages: PageDuPdf[] }> {
  const pages: PageDuPdf[] = []
  const lu = await lireLeTexteDUnPdf(octets, bornes, (page) => { pages.push(page); return false })
  return { lu, pages }
}

async function verdict(octets: Uint8Array): Promise<boolean> {
  const lu = await lireLeTexteDUnPdf(octets, LARGES, (page) => porteLaFormeDUnBordereau([page]))
  return lu.etat === 'lu' && lu.arrete
}

/** Les lignes de chaque page selon pdf.js, la référence du navigateur. */
async function lignesParPdfJs(octets: Uint8Array): Promise<string[][]> {
  const tache = pdfjs.getDocument({ data: octets.slice(0), verbosity: 0 })
  const doc = await tache.promise
  const pages: string[][] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const contenu = await (await doc.getPage(n)).getTextContent()
    pages.push(lignesDesFragments(fragmentsDeLaPage(contenu.items)))
  }
  await tache.destroy()
  return pages
}

async function pdfDeLignes(pages: readonly (readonly string[])[], options: { objetsEnFlux?: boolean } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const police = await doc.embedFont(StandardFonts.Helvetica)
  for (const lignes of pages) {
    const p = doc.addPage([595, 842])
    lignes.forEach((l, i) => p.drawText(l, { x: 40, y: 800 - 14 * i, size: 9, font: police }))
  }
  return doc.save({ useObjectStreams: options.objetsEnFlux ?? true })
}

/** Un PDF écrit objet par objet : chaque objet est un texte (latin1) ; un flux, son dictionnaire et ses octets. */
type ObjetEcrit = string | { dico: string; flux: Uint8Array }
function pdfEcrit(objets: readonly ObjetEcrit[], remorque = ''): Uint8Array {
  const morceaux: Uint8Array[] = []
  let longueur = 0
  const ajouter = (o: Uint8Array | string) => {
    const b = typeof o === 'string' ? Uint8Array.from(o, (c) => c.charCodeAt(0)) : o
    morceaux.push(b)
    longueur += b.length
  }
  ajouter('%PDF-1.7\n')
  const decalages: number[] = []
  objets.forEach((o, i) => {
    decalages.push(longueur)
    if (typeof o === 'string') ajouter(`${i + 1} 0 obj\n${o}\nendobj\n`)
    else {
      ajouter(`${i + 1} 0 obj\n<< ${o.dico} /Length ${o.flux.length} >>\nstream\n`)
      ajouter(o.flux)
      ajouter('\nendstream\nendobj\n')
    }
  })
  const xref = longueur
  ajouter(`xref\n0 ${objets.length + 1}\n0000000000 65535 f \n${decalages.map((d) => `${String(d).padStart(10, '0')} 00000 n \n`).join('')}`)
  ajouter(`trailer\n<< /Size ${objets.length + 1} /Root 1 0 R ${remorque}>>\nstartxref\n${xref}\n%%EOF\n`)
  const sortie = new Uint8Array(longueur)
  let p = 0
  for (const m of morceaux) { sortie.set(m, p); p += m.length }
  return sortie
}
const octetsDe = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))
const comprime = (s: string) => new Uint8Array(deflateSync(octetsDe(s)))
const hexa = (s: string) => [...s].map((c) => c.charCodeAt(0).toString(16).padStart(4, '0')).join('')

/** Une police composite Identity-H dont le code de chaque glyphe est son point Unicode + 3, et le ToUnicode qui le défait. */
function pdfComposite(lignes: readonly string[]): Uint8Array {
  const code = (s: string) => [...s].map((c) => (c.charCodeAt(0) + 3).toString(16).padStart(4, '0')).join('')
  const contenu = `BT /F1 9 Tf 1 0 0 1 40 800 Tm 14 TL ${lignes.map((l) => `<${code(l)}> Tj T*`).join(' ')} ET`
  const toUnicode = '/CIDInit /ProcSet findresource begin 12 dict begin begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange '
    + '1 beginbfrange <0003> <0102> <0000> endbfrange endcmap CMapName currentdict /CMap defineresource pop end end'
  return pdfEcrit([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /Fictive /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>',
    { dico: '/Filter /FlateDecode', flux: comprime(contenu) },
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Fictive /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 500 /W [35 [600 700]] >>',
    { dico: '/Filter /FlateDecode', flux: comprime(toUnicode) },
  ])
}

describe('lireLeTexteDUnPdf : les lignes que pdf.js rend, sur des PDF fictifs', () => {
  it('le bordereau fictif d’une et de deux pages : mêmes lignes que pdf.js, et la forme reconnue', async () => {
    for (const pages of [1, 2] as const) {
      const octets = await bordereauFictifEnPdf({ pages })
      const { lu, pages: lues } = await lire(octets)
      expect(lu).toEqual({ etat: 'lu', pages, arrete: false })
      expect(lues.map((p) => lignesDesFragments(p.fragments))).toEqual(await lignesParPdfJs(octets))
      expect(await verdict(octets)).toBe(true)
    }
  })

  it('avec ou sans flux d’objets ; un bordereau en troisième page, la lecture arrêtée sur lui', async () => {
    const facture = ['FACTURE N° F-2026-0042', 'Total TTC 54,00']
    for (const objetsEnFlux of [true, false]) {
      const octets = await pdfDeLignes([facture, facture, ['PRATICIEN FICTIF', TITRE], facture], { objetsEnFlux })
      expect((await lire(octets)).pages.map((p) => lignesDesFragments(p.fragments))).toEqual(await lignesParPdfJs(octets))
      expect(await lireLeTexteDUnPdf(octets, LARGES, (page) => porteLaFormeDUnBordereau([page]))).toEqual({ etat: 'lu', pages: 3, arrete: true })
    }
  })

  it('des textes ordinaires, fictifs, ne se reconnaissent pas : le verdict de pdf.js', async () => {
    const ordinaires = [
      ['FACTURE N° F-2026-0042', 'Fournitures Fictives SARL', 'Compresses stériles 10 4,50 45,00', 'Total TTC 54,00'],
      ['FACTURE', 'Option : impression du bordereau de télétransmission 5,00', 'Total TTC 38,40'],
      ['Merci de joindre le bordereau de teletransmission à votre envoi'],
      ['DÉCOMPTE DE REMBOURSEMENT', 'Bénéficiaire : ASSURÉ FICTIF', 'Numéro assuré : 0000000000000'],
      ['Facture Date prescription Numéro Assuré Total Caisse Mutuelle'],
    ]
    for (const lignes of ordinaires) {
      const octets = await pdfDeLignes([lignes])
      const parPdfJs = await lignesParPdfJs(octets)
      expect((await lire(octets)).pages.map((p) => lignesDesFragments(p.fragments))).toEqual(parPdfJs)
      expect(await verdict(octets)).toBe(false)
      expect(porteLaFormeDUnBordereau(parPdfJs.map((l) => ({ lignes: l })))).toBe(false)
    }
  })

  it('une police composite Identity-H et son ToUnicode, ses largeurs lues de /W et /DW', async () => {
    const octets = pdfComposite([TITRE, 'Lot : 42 créé le 09/11/2026'])
    const { lu, pages } = await lire(octets)
    expect(lu).toEqual({ etat: 'lu', pages: 1, arrete: false })
    expect(lignesDesFragments(pages[0].fragments)).toEqual(await lignesParPdfJs(octets).then((p) => p[0]))
    expect(lignesDesFragments(pages[0].fragments)).toEqual([TITRE, 'Lot : 42 créé le 09/11/2026'])
    // L'espace (point 32, code 35) a 600 millièmes dans /W ; les autres glyphes du titre, absents de /W, la largeur par
    // défaut, 500 : deux espaces et vingt-sept lettres, à la taille 9.
    expect(pages[0].fragments[0].largeur).toBeCloseTo((2 * 600 + 27 * 500) * 9 / 1000, 5)
    expect(await verdict(octets)).toBe(true)
  })

  it('un texte posé glyphe par glyphe, chaque glyphe à sa largeur : les fragments se recollent en un titre', async () => {
    const largeur = 500
    const glyphes = [...TITRE].map((c, i) => `1 0 0 1 ${(40 + i * largeur * 9 / 1000).toFixed(3)} 800 Tm <${c.charCodeAt(0).toString(16)}> Tj`).join(' ')
    const octets = pdfEcrit([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /FirstChar 32 /LastChar 126 /Widths [${Array(95).fill(largeur).join(' ')}] >>`,
      { dico: '', flux: octetsDe(`BT /F1 9 Tf ${glyphes} ET`) },
    ])
    expect(lignesDesFragments((await lire(octets)).pages[0].fragments)).toEqual([TITRE])
    expect(await verdict(octets)).toBe(true)
  })

  it('une table Differences, un TJ à crénage, un formulaire, un flux ASCII85 puis Flate, une image en ligne', async () => {
    // Les codes 1 à 3 rebaptisés : « B », « e acute », « space » ; « 0x41 » reste « A ».
    const contenuDuFormulaire = 'BT /F1 10 Tf 40 700 Td [(\\001ord) -40 (ereau) -300 (de) (\\003Teletransmission)] TJ ET'
    const formulaire = Buffer.from(deflateSync(octetsDe(contenuDuFormulaire)))
    const a85 = ascii85(formulaire)
    const octets = pdfEcrit([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 /Resources << /Font << /F1 4 0 R >> /XObject << /Fm1 6 0 R >> >> >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [1 /B /eacute /space] >> >>',
      { dico: '', flux: octetsDe('q BI /W 2 /H 1 /BPC 8 /CS /G ID \x00\x45\x54 EI Q BT /F1 10 Tf 40 760 Td (Num\\002ro) Tj ET q 1 0 0 1 0 0 cm /Fm1 Do Q') },
      { dico: '/Type /XObject /Subtype /Form /BBox [0 0 595 842] /Filter [/ASCII85Decode /FlateDecode]', flux: a85 },
    ])
    const lignes = lignesDesFragments((await lire(octets)).pages[0].fragments)
    expect(lignes).toEqual(['Numéro', 'Bordereau de Teletransmission'])
    expect(lignes).toEqual((await lignesParPdfJs(octets))[0])
    expect(await verdict(octets)).toBe(true)
  })
})

/** ASCII85 d'Adobe, pour fabriquer un flux de test (le lecteur, lui, le défait). */
function ascii85(o: Uint8Array): Uint8Array {
  let s = ''
  for (let i = 0; i < o.length; i += 4) {
    const n = Math.min(4, o.length - i)
    let v = 0
    for (let k = 0; k < 4; k++) v = v * 256 + (k < n ? o[i + k] : 0)
    if (v === 0 && n === 4) { s += 'z'; continue }
    const c: string[] = []
    for (let k = 0; k < 5; k++) { c.unshift(String.fromCharCode((v % 85) + 33)); v = Math.floor(v / 85) }
    s += c.slice(0, n + 1).join('')
  }
  return octetsDe(`${s}~>`)
}

describe('lireLeTexteDUnPdf : ce qu’il ne lit pas, il le dit, sans jamais lever', () => {
  it('un fichier qui n’est pas un PDF ; un PDF sans page ; un PDF tronqué', async () => {
    expect((await lire(octetsDe('ceci n’est pas un PDF'))).lu).toEqual({ etat: 'illisible', raison: 'pas-un-pdf' })
    expect((await lire(pdfEcrit(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [] /Count 0 >>']))).lu)
      .toEqual({ etat: 'illisible', raison: 'sans-page' })
    const entier = await bordereauFictifEnPdf()
    for (const coupe of [entier.length >> 1, entier.length >> 2, 40]) {
      const r = await lireLeTexteDUnPdf(entier.slice(0, coupe), LARGES, (page) => porteLaFormeDUnBordereau([page]))
      expect(['lu', 'illisible']).toContain(r.etat)
    }
  })

  it('un PDF chiffré se dit chiffré, sans lecture', async () => {
    const octets = pdfEcrit(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [] /Count 0 >>', '<< /Filter /Standard /V 2 /R 3 >>'], '/Encrypt 3 0 R ')
    expect((await lire(octets)).lu).toEqual({ etat: 'illisible', raison: 'chiffre' })
  })

  it('un filtre inconnu, un prédicteur, une police sans ToUnicode sous Identity-H : une page sans texte, jamais un faux texte', async () => {
    const octets = pdfEcrit([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
      '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type0 /BaseFont /X /Encoding /Identity-H /DescendantFonts [] >>',
      { dico: '', flux: octetsDe(`BT /F1 9 Tf 40 800 Td <${hexa(TITRE)}> Tj ET`) },
      '<< /Type /Page /Parent 2 0 R /Contents 7 0 R >>',
      { dico: '/Filter /LZWDecode', flux: octetsDe('rien') },
    ])
    const { lu, pages } = await lire(octets)
    expect(lu).toEqual({ etat: 'lu', pages: 2, arrete: false })
    expect(pages.map((p) => p.fragments.length)).toEqual([0, 0])
  })

  it('au-delà de la durée : « borne », l’horloge injectée', async () => {
    let t = 0
    const octets = await pdfDeLignes([['Total 12,00'], ['Total 13,00']])
    const lu = await lireLeTexteDUnPdf(octets, { octetsDecompressesMax: 1 << 26, dureeMaxMs: 5, maintenant: () => (t += 10) }, () => false)
    expect(lu).toEqual({ etat: 'illisible', raison: 'borne' })
  })

  it('au-delà des octets décompressés (une bombe de compression fictive) : « borne », sans tout décompresser', async () => {
    const bombe = new Uint8Array(deflateSync(new Uint8Array(8 * 1024 * 1024)))
    const octets = pdfEcrit([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>',
      { dico: '/Filter /FlateDecode', flux: bombe },
    ])
    const lu = await lireLeTexteDUnPdf(octets, { octetsDecompressesMax: 1024 * 1024, dureeMaxMs: 60_000, maintenant: () => performance.now() }, () => false)
    expect(lu).toEqual({ etat: 'illisible', raison: 'borne' })
    expect(bombe.length).toBeLessThan(20_000)
  })
})
