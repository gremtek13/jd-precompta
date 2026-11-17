import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { Declaration2035SD, LigneDesImmobilisations } from './declaration2035SD'
import { mentionDuPdf2035SD } from './modeles2035SD'
import { notesDeLaPremierePage } from './gabarit2035SD'

// REMPLIR2035SD SUR LE VRAI FORMULAIRE, RELU PAR PDF.JS. Le pdf.js du navigateur touche au DOM dès l'import : il est remplacé
// par sa version « legacy », comme dans remplir2035.test.ts, et le fichier est servi depuis public/.
vi.mock('pdfjs-dist', async () => await import('pdfjs-dist/legacy/build/pdf.mjs'))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', async () => {
  const { createRequire } = await import('node:module')
  const { pathToFileURL } = await import('node:url')
  return { default: pathToFileURL(createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href }
})

const { remplir2035SD } = await import('./remplir2035SD')

interface Fragment { texte: string; x: number; y: number }

async function pagesDuPdf(pdf: Uint8Array): Promise<Fragment[][]> {
  const doc = await pdfjs.getDocument({ data: pdf.slice(0) }).promise
  const pages: Fragment[][] = []
  for (let n = 1; n <= doc.numPages; n++) {
    pages.push((await (await doc.getPage(n)).getTextContent()).items
      .filter((i) => 'str' in i)
      .map((i) => {
        const t = i as { str: string; transform: number[] }
        return { texte: t.str, x: t.transform[4], y: t.transform[5] }
      }))
  }
  return pages
}

const ligne = (o: Partial<LigneDesImmobilisations>): LigneDesImmobilisations => ({
  id: 'b', nature: 'Échographe portable', miseEnService: '2023-04-02', prixTtc: 12346, tvaDeduite: 0, base: 12346, mode: 'L 20 %',
  anterieurs: 4321, annee: 2469, ...o,
})

const declaration = (annee: number, lignes: LigneDesImmobilisations[], o: Partial<Declaration2035SD['immobilisations']> = {}): Declaration2035SD => {
  const total = lignes.reduce((s, l) => s + l.annee, 0)
  return {
    annee, benefice: 54321, deficit: 0,
    immobilisations: { lignes, totalGeneral: total, vehiculesSousLeBareme: 0, dotationNette: total, ch: total, concorde: true, ...o },
  }
}
const ENTETE = { nom: 'Dupont Jeanne', activite: 'Activités des infirmiers', siret: '12345678900011', adresse: '3 rue des Lilas, 75011 Paris' }

let simple: Fragment[][] = []
let simpleEtatsAnnexes = -1
let annexe: Fragment[][] = []
let substitut: Fragment[][] = []
let aSaisir: Fragment[][] = []
let refus: unknown = null
beforeAll(async () => {
  vi.stubGlobal('fetch', async (chemin: string) => {
    const octets = readFileSync(`public${chemin}`)
    return { ok: true, status: 200, arrayBuffer: async () => octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength) }
  })
  try {
    const r = await remplir2035SD(declaration(2025, [ligne({})]), ENTETE)
    simpleEtatsAnnexes = r.etatsAnnexes
    expect(r.libellesSansAncrage).toEqual([])
    simple = await pagesDuPdf(r.pdf)
    const lignes = Array.from({ length: 22 }, (_, k) => ligne({ id: `b${k}`, nature: `Bien ${k}`, annee: 10 }))
    annexe = await pagesDuPdf((await remplir2035SD(declaration(2025, lignes), ENTETE)).pdf)
    substitut = await pagesDuPdf((await remplir2035SD(declaration(2026, [ligne({})]), ENTETE)).pdf)
    aSaisir = await pagesDuPdf((await remplir2035SD(
      declaration(2025, [ligne({ prixTtc: 'a_saisir', tvaDeduite: 'a_saisir' })], { concorde: false, ch: 9999 }), ENTETE,
    )).pdf)
  } finally {
    vi.unstubAllGlobals()
  }
  // Un fichier servi qui n'est pas celui de la DGFiP ne se remplit pas.
  vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('%PDF-1.6 faux').buffer }))
  try {
    await remplir2035SD(declaration(2025, []), ENTETE)
  } catch (e) {
    refus = e
  } finally {
    vi.unstubAllGlobals()
  }
})

const trouve = (page: Fragment[], texte: string) => page.find((f) => f.texte === texte)
const texteDe = (page: Fragment[]) => page.map((f) => f.texte).join(' ').replace(/\s+/g, ' ')

describe('remplir2035SD — le PDF produit, relu', () => {
  it('porte le bénéfice dans la case « Bénéfice » de la ligne 1, à droite de son libellé', () => {
    const montant = trouve(simple[0], '54 321')
    const libelle = trouve(simple[0], 'Bénéfice')
    expect(montant).toBeDefined()
    expect(montant!.x).toBeGreaterThan(337)
    expect(montant!.x).toBeLessThan(399.1)
    expect(Math.abs(montant!.y - libelle!.y)).toBeLessThan(0.5)
  })

  it('porte l’identité en page 1, et le déclarant en tête des pages 3 et 4', () => {
    expect(trouve(simple[0], 'Dupont Jeanne')).toBeDefined()
    expect(trouve(simple[0], '12345678900011')).toBeDefined()
    expect(trouve(simple[0], '3 rue des Lilas, 75011 Paris')).toBeDefined()
    expect(trouve(simple[2], 'Dupont Jeanne')).toBeDefined()
    expect(trouve(simple[3], 'Dupont Jeanne')).toBeDefined()
  })

  it('remplit le tableau I : la ligne du bien, son total, (A) et la dotation nette', () => {
    const page3 = simple[2]
    expect(trouve(page3, 'Échographe portable') ?? page3.find((f) => f.texte.startsWith('Échographe'))).toBeDefined()
    expect(trouve(page3, '02/04/2023')).toBeDefined()
    expect(trouve(page3, 'L 20 %')).toBeDefined()
    expect(page3.filter((f) => f.texte === '2 469')).toHaveLength(4)
    expect(page3.filter((f) => f.texte === '12 346')).toHaveLength(4)
    expect(page3.filter((f) => f.texte === '4 321')).toHaveLength(2)
    expect(simple).toHaveLength(4)
    expect(simpleEtatsAnnexes).toBe(0)
  })

  it('écrit en page 1 ce que l’application a rempli, et rien du millésime sur le bon', () => {
    for (const ligneDeNote of notesDeLaPremierePage()) expect(texteDe(simple[0])).toContain(ligneDeNote)
    expect(texteDe(simple[0])).not.toContain('ATTENTION')
  })

  it('au-delà de vingt biens, ajoute une copie de la page 3 comme état annexe', () => {
    expect(annexe).toHaveLength(5)
    expect(annexe[4].filter((f) => /^Bien \d+$/.test(f.texte))).toHaveLength(2)
    expect(annexe[2].filter((f) => /^Bien \d+$/.test(f.texte))).toHaveLength(20)
    expect(texteDe(annexe[4])).toContain('État annexe n° 1')
    // L'état annexe est la page 3 vierge : son tableau imprimé, sans les biens de la page 3.
    expect(texteDe(annexe[4])).toContain('IMMOBILISATIONS ET AMORTISSEMENTS')
    expect(annexe[4].some((f) => f.texte === 'Bien 0')).toBe(false)
  })

  it('sur un millésime substitut, la mention en tête des pages remplies', () => {
    for (const l of mentionDuPdf2035SD(2026)) expect(texteDe(substitut[0])).toContain(l)
  })

  it('« à saisir » dans les colonnes 2 et 3, et l’écart avec CH dit en bas de la page 3', () => {
    expect(aSaisir[2].filter((f) => f.texte === 'à saisir').length).toBeGreaterThanOrEqual(4)
    expect(texteDe(aSaisir[2])).toMatch(/ne redit pas la case CH de la 2035-B \(9 999 €\)/)
  })

  it('refuse un modèle servi qui n’est pas celui de la DGFiP', () => {
    expect(String(refus)).toMatch(/n’est pas celui de la DGFiP/)
  })
})
