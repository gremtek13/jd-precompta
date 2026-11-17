import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import type { PDFFont } from 'pdf-lib'
import { ajuster, geometrieDeLaLigne23, geometrieDuCadre7, planDeLaLigne23, planDuCadre7 } from './gabaritCadre7'
import type { Mesure } from './gabaritCadre7'
import type { FiletHorizontal, FiletVertical, PageFormulaire } from './gabarit2035'
import type { Cadre7ARemplir, LigneDuCadre7 } from './cadre7'

// LE CADRE 7 SUR LE FORMULAIRE OFFICIEL LIVRÉ DANS LE DÉPÔT (17/11/2026) : la géométrie lue sur la page 2 vierge, comme
// remplir2035.ts la lit (`lirePage`, filets horizontaux compris).
async function lirePage2(numero = 2): Promise<PageFormulaire> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync('public/formulaires/2035-sd-2026.pdf')) }).promise
  const page = await doc.getPage(numero)
  const fragments = (await page.getTextContent()).items
    .filter((i) => 'str' in i)
    .map((i) => {
      const t = i as { str: string; transform: number[]; width: number; height: number }
      return { texte: t.str, x: t.transform[4], y: t.transform[5], largeur: t.width, hauteur: t.height }
    })
  const ops = await page.getOperatorList()
  const filets: FiletVertical[] = []
  const filetsHorizontaux: FiletHorizontal[] = []
  for (let i = 0; i < ops.fnArray.length; i++) {
    if (ops.fnArray[i] !== pdfjs.OPS.constructPath) continue
    const boite = ops.argsArray[i][2] as number[] | undefined
    if (!boite) continue
    const [x0, y0, x1, y1] = boite
    if (x1 - x0 <= 2 && y1 - y0 > 4) filets.push({ x: (x0 + x1) / 2, y0, y1 })
    else if (y1 - y0 <= 2 && x1 - x0 > 4) filetsHorizontaux.push({ y: (y0 + y1) / 2, x0, x1 })
  }
  return { fragments, filets, filetsHorizontaux }
}

const ligne = (o: Partial<LigneDuCadre7>): LigneDuCadre7 => ({
  nom: 'Clio', modele: 'Clio', type: 'T', puissanceFiscale: 6, bareme: 'bnc', motorisation: 'Thermique', carburant: 'Diesel',
  kilometres: 4001, indemnite: 2661, amortissements: null, ...o,
})

let page: PageFormulaire
let police: PDFFont
let mesurer: Mesure
beforeAll(async () => {
  page = await lirePage2()
  police = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica)
  mesurer = (texte, taille) => police.widthOfTextAtSize(texte, taille)
})

describe('geometrieDuCadre7 — sur le formulaire 2035-B-SD 2026', () => {
  it('trouve les dix colonnes, les deux lignes de véhicules et les cases des deux totaux', () => {
    const g = geometrieDuCadre7(page)!
    expect(g).not.toBeNull()
    const arrondi = (b: { gauche: number; droite: number }) => [Math.round(b.gauche * 10) / 10, Math.round(b.droite * 10) / 10]
    expect(Object.fromEntries(Object.entries(g.colonnes).map(([k, b]) => [k, arrondi(b)]))).toEqual({
      modele: [28.3, 151.2], type: [151.2, 176], puissance: [176, 236], bnc: [236, 257], bic: [257, 278],
      motorisation: [278, 333.4], carburant: [333.4, 375.3], kilometres: [375.3, 434], indemnites: [434, 496.9],
      amortissements: [496.9, 559.9],
    })
    expect(g.lignes.map((l) => [Math.round(l.haut * 10) / 10, Math.round(l.bas * 10) / 10])).toEqual([[165.2, 152.4], [152.4, 139.6]])
    expect(arrondi(g.totalA)).toEqual([455, 496.9])
    expect(arrondi(g.totalB)).toEqual([517.9, 559.9])
    expect(g.totalA.y).toBeCloseTo(113.8, 0)
  })

  it('ne repère rien sans les filets horizontaux, sans un libellé, ou sans la ligne des frais réels', () => {
    expect(geometrieDuCadre7({ ...page, filetsHorizontaux: undefined })).toBeNull()
    expect(geometrieDuCadre7({ ...page, fragments: page.fragments.filter((f) => f.texte.trim() !== 'Kilométrage') })).toBeNull()
    expect(geometrieDuCadre7({ ...page, fragments: page.fragments.filter((f) => !f.texte.startsWith('Frais réels non couverts')) })).toBeNull()
    expect(geometrieDuCadre7({ ...page, fragments: page.fragments.filter((f) => f.texte.trim() !== 'B') })).toBeNull()
    // Un libellé en double dans l'en-tête : le repérage ne choisit pas.
    const indemnites = page.fragments.find((f) => f.texte.trim() === 'Indemnités')!
    expect(geometrieDuCadre7({ ...page, fragments: [...page.fragments, { ...indemnites, x: 200 }] })).toBeNull()
  })
})

describe('planDuCadre7 — chaque valeur dans sa cellule, jamais sur un filet', () => {
  const CADRE: Cadre7ARemplir = {
    lignes: [
      ligne({}),
      ligne({ nom: 'Moto 3 CV', modele: null, type: 'M', puissanceFiscale: 3, bareme: 'bic', motorisation: 'Électrique', carburant: null, kilometres: 12500, indemnite: 'a_saisir' }),
      ligne({ nom: 'Kangoo', modele: 'Kangoo' }),
    ],
    totalA: 'a_saisir',
    totalB: 'a_saisir',
  }

  it('écrit les deux premières lignes dans leurs colonnes, dit la troisième, et « à saisir » à part', () => {
    const g = geometrieDuCadre7(page)!
    const plan = planDuCadre7(page, 2, CADRE, mesurer)
    expect(plan.repere).toBe(true)
    expect(plan.vehiculesSansLigne).toEqual(['Kangoo'])
    const dans = (texte: string, colonne: keyof typeof g.colonnes, rang: number) => {
      const i = plan.inscriptions.find((x) => x.texte === texte && x.y > g.lignes[rang].bas && x.y < g.lignes[rang].haut)
      expect(i, `${texte} en ligne ${rang + 1}`).toBeDefined()
      const largeur = mesurer(i!.texte, i!.taille)
      const gauche = i!.alignement === 'gauche' ? i!.x : i!.alignement === 'droite' ? i!.x - largeur : i!.x - largeur / 2
      expect(gauche, texte).toBeGreaterThan(g.colonnes[colonne].gauche + 1)
      expect(gauche + largeur, texte).toBeLessThan(g.colonnes[colonne].droite - 1)
      // Le corps du texte (des capitales au jambage) entre les deux filets de sa ligne.
      expect(i!.y - 0.21 * i!.taille, texte).toBeGreaterThan(g.lignes[rang].bas)
      expect(i!.y + 0.72 * i!.taille, texte).toBeLessThan(g.lignes[rang].haut)
    }
    dans('Clio', 'modele', 0)
    dans('T', 'type', 0)
    dans('6 CV', 'puissance', 0)
    dans('X', 'bnc', 0)
    dans('Thermique', 'motorisation', 0)
    dans('Diesel', 'carburant', 0)
    dans('4 001', 'kilometres', 0)
    dans('2 661', 'indemnites', 0)
    dans('M', 'type', 1)
    dans('3 CV', 'puissance', 1)
    dans('X', 'bic', 1)
    dans('Électrique', 'motorisation', 1)
    dans('12 500', 'kilometres', 1)
    // Aucune croix sous le barème BIC de la première ligne, ni sous le BNC de la seconde.
    expect(plan.inscriptions.filter((x) => x.texte === 'X')).toHaveLength(2)
    expect(plan.inscriptions.some((x) => x.texte === 'Kangoo')).toBe(false)
    // « À saisir » trois fois, chacun entier dans sa case : l'indemnité de la moto, le total A, le total B.
    const cases = [g.colonnes.indemnites, g.totalA, g.totalB]
    expect(plan.aSaisir.map((x) => x.texte)).toEqual(['à saisir', 'à saisir', 'à saisir'])
    plan.aSaisir.forEach((x, k) => {
      expect(x.alignement).toBe('droite')
      expect(x.x - mesurer(x.texte, x.taille), `à saisir ${k + 1}`).toBeGreaterThan(cases[k].gauche + 1)
      expect(x.x, `à saisir ${k + 1}`).toBeLessThan(cases[k].droite - 1)
    })
    expect(plan.aSaisir[0].y).toBeGreaterThan(g.lignes[1].bas)
    expect(plan.aSaisir[0].y).toBeLessThan(g.lignes[1].haut)
    expect(plan.aSaisir[1].y).toBeCloseTo(g.totalA.y, 1)
    expect(plan.aSaisir[2].y).toBeCloseTo(g.totalB.y, 1)
  })

  it('les totaux : A dans la case qui suit la lettre A, rien en B quand rien n’y est dit', () => {
    const g = geometrieDuCadre7(page)!
    const plan = planDuCadre7(page, 2, { lignes: [ligne({})], totalA: 2661, totalB: null }, mesurer)
    const totalA = plan.inscriptions.find((x) => x.texte === '2 661' && Math.abs(x.y - g.totalA.y) < 0.1)!
    expect(totalA.x - mesurer('2 661', totalA.taille)).toBeGreaterThan(g.totalA.gauche)
    expect(totalA.x).toBeLessThan(g.totalA.droite)
    expect(plan.aSaisir).toEqual([])
    expect(plan.inscriptions.some((x) => x.x > g.totalB.gauche && Math.abs(x.y - g.totalB.y) < 0.1)).toBe(false)
  })

  it('un cadre non repéré n’écrit rien, et rend tous ses véhicules', () => {
    const plan = planDuCadre7({ ...page, filetsHorizontaux: [] }, 2, CADRE, mesurer)
    expect(plan).toEqual({ inscriptions: [], aSaisir: [], vehiculesSansLigne: ['Clio', 'Moto 3 CV', 'Kangoo'], repere: false })
  })
})

describe('ajuster — un texte tient dans sa cellule', () => {
  it('réduit la taille, puis coupe sur « … », jamais au-delà de la largeur', () => {
    expect(ajuster('Clio', 100, 8, (t, s) => t.length * s * 0.5)).toEqual({ texte: 'Clio', taille: 8 })
    expect(ajuster('Clio', 14, 8, (t, s) => t.length * s * 0.5)).toEqual({ texte: 'Clio', taille: 7 })
    const coupe = ajuster('Renault Mégane Estate Business', 30, 8, (t, s) => t.length * s * 0.5)
    expect(coupe.taille).toBe(5.5)
    expect(coupe.texte.endsWith('…')).toBe(true)
    expect(coupe.texte.length * 5.5 * 0.5).toBeLessThanOrEqual(30)
  })
})

// CADRE7-Q4 (A), réponse du cabinet du 17/11/2026 : la case « évaluation forfaitaire » et la cellule de la ligne 23, en page 1.
describe('planDeLaLigne23 — sur la 2035-A-SD 2026', () => {
  let page1: PageFormulaire
  beforeAll(async () => { page1 = await lirePage2(1) })
  const cadre = (totalA: Cadre7ARemplir['totalA']): Cadre7ARemplir => ({ lignes: [ligne({})], totalA, totalB: null })

  it('repère la case à cocher et la cellule du montant à droite du libellé, avant la case BJ', () => {
    const g = geometrieDeLaLigne23(page1)!
    expect(g.caseACocher).toEqual({ gauche: 209.6, droite: 229.5 })
    expect(g.montant).toEqual({ gauche: 249.2, droite: 348.4 })
    expect(g.y).toBeCloseTo(258.4, 0)
  })

  it('la croix au centre de la case, le total A aligné à droite de sa cellule', () => {
    const plan = planDeLaLigne23(page1, 1, cadre(4050))
    expect(plan.repere).toBe(true)
    expect(plan.aSaisir).toEqual([])
    expect(plan.inscriptions.map((i) => [i.texte, i.alignement, Math.round(i.x * 100) / 100])).toEqual([['X', 'centre', 219.55], ['4 050', 'droite', 344.4]])
  })

  it('« à saisir » en rouge quand le total A l’est ; la croix seule quand il reste vide (écart avec la 2035 validée)', () => {
    const aSaisir = planDeLaLigne23(page1, 1, cadre('a_saisir'))
    expect(aSaisir.inscriptions.map((i) => i.texte)).toEqual(['X'])
    expect(aSaisir.aSaisir.map((i) => i.texte)).toEqual(['à saisir'])
    const vide = planDeLaLigne23(page1, 1, cadre(null))
    expect(vide.inscriptions.map((i) => i.texte)).toEqual(['X'])
    expect(vide.aSaisir).toEqual([])
  })

  it('une page sans la ligne 23 n’écrit rien et le dit', () => {
    expect(planDeLaLigne23({ ...page1, filets: [] }, 1, cadre(4050))).toEqual({ inscriptions: [], aSaisir: [], repere: false })
    expect(planDeLaLigne23(page, 1, cadre(4050)).repere).toBe(false)
  })
})

describe('planDuCadre7 — les amortissements à réintégrer (CADRE7-Q2)', () => {
  it('le montant de chaque véhicule dans sa colonne, et le total B dans la case de la lettre B', () => {
    const g = geometrieDuCadre7(page)!
    const plan = planDuCadre7(page, 2, {
      lignes: [ligne({ amortissements: 1200 }), ligne({ nom: 'B', amortissements: 'a_saisir' })], totalA: 2661, totalB: 'a_saisir',
    }, mesurer)
    const montant = plan.inscriptions.find((x) => x.texte === '1 200')!
    expect(montant.x - mesurer('1 200', montant.taille)).toBeGreaterThan(g.colonnes.amortissements.gauche)
    expect(montant.x).toBeLessThan(g.colonnes.amortissements.droite)
    expect(plan.aSaisir.filter((x) => x.x > g.colonnes.amortissements.gauche)).toHaveLength(2)
    const avecTotal = planDuCadre7(page, 2, { lignes: [ligne({ amortissements: 1200 })], totalA: 2661, totalB: 1200 }, mesurer)
    expect(avecTotal.inscriptions.some((x) => x.texte === '1 200' && Math.abs(x.y - g.totalB.y) < 0.1 && x.x < g.totalB.droite)).toBe(true)
  })
})
