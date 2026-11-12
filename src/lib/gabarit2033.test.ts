import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import {
  ancragesDuTableau, CODES_REMPLIS_2033, liasseDepuisLia1, lignesDuCadreC, mentionDesCasesASaisir, PAGE_DU_TABLEAU,
  planDeRemplissage2033, TABLEAUX_2033, type Liasse2033ARemplir, type Tableau2033,
} from './gabarit2033'
import type { FiletVertical, PageFormulaire } from './gabarit2035'
import { MODELES_2033 } from './modeles2033'
import { compteDeResultat2033 } from './compteDeResultat2033'
import { tableau2033C, tableau2033D, tableau2033E } from './liasse2033'
import { bilanEtabli, ecrire, reprise } from '../test/liasse2033'

// LE GABARIT DE LA LIASSE 2033, MILLÉSIME PAR MILLÉSIME (LIA6) : chaque code que les modules de LIA1 remplissent doit se
// placer sur SA page du formulaire livré ; un millésime ajouté à MODELES_2033 rejoue tout ce fichier. Puis le plan, et un
// vrai PDF écrit par pdf-lib et relu par pdf.js : une impression se mesure sur un vrai PDF.

async function lirePages(donnees: Uint8Array, numeros: number[]): Promise<Map<number, PageFormulaire>> {
  const doc = await pdfjs.getDocument({ data: donnees.slice(0) }).promise
  const pages = new Map<number, PageFormulaire>()
  for (const n of numeros) {
    const page = await doc.getPage(n)
    const fragments = (await page.getTextContent()).items
      .filter((i) => 'str' in i)
      .map((i) => {
        const t = i as { str: string; transform: number[]; width: number; height: number }
        return { texte: t.str, x: t.transform[4], y: t.transform[5], largeur: t.width, hauteur: t.height }
      })
    const ops = await page.getOperatorList()
    const filets: FiletVertical[] = []
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] !== pdfjs.OPS.constructPath) continue
      const boite = ops.argsArray[i][2] as number[] | undefined
      if (!boite) continue
      const [x0, y0, x1, y1] = boite
      if (x1 - x0 <= 2 && y1 - y0 > 4) filets.push({ x: (x0 + x1) / 2, y0, y1 })
    }
    pages.set(n, { fragments, filets })
  }
  return pages
}

const PAGES = TABLEAUX_2033.map((t) => PAGE_DU_TABLEAU[t])

for (const [millesime, modele] of MODELES_2033) {
  describe(`sur le formulaire 2033-SD millésime ${millesime} livré dans le dépôt`, () => {
    const donnees = new Uint8Array(readFileSync(`public${modele.chemin}`))
    let pages: Map<number, PageFormulaire>
    beforeAll(async () => { pages = await lirePages(donnees, PAGES) })

    it.each(TABLEAUX_2033)('place chaque case que l’application remplit au %s, sur sa page', (tableau) => {
      const ancrages = ancragesDuTableau(pages.get(PAGE_DU_TABLEAU[tableau])!, tableau)
      const manquantes = [...CODES_REMPLIS_2033[tableau]].filter((c) => !/^C\d$/.test(c) && !ancrages.has(c))
      expect(manquantes).toEqual([])
      for (const a of ancrages.values()) expect(a.page).toBe(PAGE_DU_TABLEAU[tableau])
    })

    it('au 2033-B, 210 est la vente de marchandises et 209 son « dont » à sa gauche ; 217 est la case, pas « art. 217 octies »', () => {
      const b = ancragesDuTableau(pages.get(2)!, '2033-B')
      const [a209, a210, a214, a215, a217, a218] = ['209', '210', '214', '215', '217', '218'].map((c) => b.get(c)!)
      expect(a209.y).toBeCloseTo(a210.y, 0)
      expect(a209.xDroite).toBeLessThan(a210.xDroite - 50)
      expect(a215.y).toBeCloseTo(a214.y, 0)
      expect(a217.y).toBeCloseTo(a218.y, 0)
      expect(a210.y).toBeGreaterThan(a214.y)
      expect(a214.y).toBeGreaterThan(a218.y)
    })

    it('310 n’est pas la même case au 2033-B (le résultat) et au 2033-E (les loyers)', () => {
      const b = ancragesDuTableau(pages.get(2)!, '2033-B').get('310')!
      const e = ancragesDuTableau(pages.get(5)!, '2033-E').get('310')!
      expect([b.page, e.page]).toEqual([2, 5])
    })

    it('le total 490, imprimé dans le fragment « TOTAL 490 », tombe dans la colonne du début, sous 480', () => {
      const c = ancragesDuTableau(pages.get(3)!, '2033-C')
      expect(c.get('490')!.xDroite).toBe(c.get('480')!.xDroite)
      expect(c.get('490')!.y).toBeLessThan(c.get('480')!.y)
    })

    it('trouve les sept lignes du cadre C du 2033-D, de haut en bas, au-dessus de 780 et dans sa colonne', () => {
      const lignes = lignesDuCadreC(pages.get(4)!)!
      const a780 = ancragesDuTableau(pages.get(4)!, '2033-D').get('780')!
      expect(lignes).toHaveLength(7)
      for (const l of lignes) {
        expect(l.y).toBeGreaterThan(a780.y)
        expect(l.xDroite).toBe(a780.xDroite)
      }
    })

    it('un vrai PDF : les montants écrits se relisent dans leur case, en euros, sans espace fine', async () => {
      const liasse: Liasse2033ARemplir = {
        tableaux: {
          '2033-B': new Map<string, number | null>([['210', 12_345], ['209', null], ['310', -1_500]]),
          '2033-D': new Map<string, number | null>([['C2', 800], ['780', 800]]),
          '2033-E': new Map<string, number | null>([['310', 2_400]]),
        },
        libellesDuCadreC: ['Litige prud’homal'],
        entete: { designation: 'Société Fictive' },
      }
      const plan = planDeRemplissage2033(pages, liasse)
      expect(plan.codesSansAncrage).toEqual([])
      const pdf = await PDFDocument.load(donnees.slice(0))
      const police = await pdf.embedFont(StandardFonts.Helvetica)
      for (const i of plan.inscriptions) {
        const largeur = police.widthOfTextAtSize(i.texte, i.taille)
        const x = i.alignement === 'droite' ? i.x - largeur : i.x
        pdf.getPages()[i.page - 1].drawText(i.texte, { x, y: i.y, size: i.taille, font: police })
      }
      const relu = await lirePages(await pdf.save(), [2, 4, 5])
      const trouve = (page: number, texte: string) => relu.get(page)!.fragments.find((f) => f.texte === texte)
      const b = ancragesDuTableau(pages.get(2)!, '2033-B')
      const ecrit210 = trouve(2, '12 345')!
      expect(ecrit210.y).toBeCloseTo(b.get('210')!.y, 0)
      expect(ecrit210.x + ecrit210.largeur).toBeLessThan(b.get('210')!.xDroite)
      expect(ecrit210.x).toBeGreaterThan(b.get('210')!.xDroite - 70)
      expect(trouve(2, '-1 500')!.y).toBeCloseTo(b.get('310')!.y, 0)
      expect(trouve(5, '2 400')!.y).toBeCloseTo(ancragesDuTableau(pages.get(5)!, '2033-E').get('310')!.y, 0)
      expect(trouve(4, '800')).toBeDefined()
      expect(relu.get(4)!.fragments.some((f) => f.texte.startsWith('Litige'))).toBe(true)
      expect(relu.get(2)!.fragments.some((f) => f.texte === 'Société Fictive')).toBe(true)
      expect(plan.aSaisir.get('2033-B')).toEqual(['209'])
    })
  })
}

const PAGES_VIDES = new Map<number, PageFormulaire>()
const plan = (tableau: Tableau2033, valeurs: [string, number | null][]) =>
  planDeRemplissage2033(PAGES_VIDES, { tableaux: { [tableau]: new Map(valeurs) }, libellesDuCadreC: [], entete: { designation: null } })

describe('le plan de remplissage', () => {
  it('une case à zéro ne s’écrit pas ; une case à saisir ne s’écrit pas et se dit', () => {
    const p = plan('2033-B', [['210', 0], ['215', null], ['209', null]])
    expect(p.inscriptions).toEqual([])
    expect(p.codesSansAncrage).toEqual([])
    expect(p.aSaisir.get('2033-B')).toEqual(['209', '215'])
    expect(mentionDesCasesASaisir(['209', '215'])).toEqual(['A saisir par le cabinet, laissées vides : 209, 215.'])
    expect(mentionDesCasesASaisir([])).toEqual([])
  })

  it('un montant sans ancre se dit, jamais au jugé', () => {
    expect(plan('2033-B', [['210', 5]]).codesSansAncrage).toEqual(['2033-B 210'])
    expect(plan('2033-D', [['C3', 5]]).codesSansAncrage).toEqual(['2033-D cadre C ligne 3'])
  })

  it('un code qu’aucun module ne remplit, ou un montant en centimes, lève', () => {
    expect(() => plan('2033-B', [['316', 5]])).toThrow(/316/)
    expect(() => plan('2033-A', [['C1', 5]])).toThrow(/C1/)
    expect(() => plan('2033-B', [['210', 12.5]])).toThrow(/euros entiers/)
  })
})

describe('les tableaux tirés des sorties de LIA1', () => {
  const NATURES = [{ id: 'informatique', compte_immobilisation: '218300' }]
  const ecritures = [
    ...ecrire('2026-06-01', [['411000', 'D', 9_000.4], ['706000', 'C', 9_000.4]]),
    ...ecrire('2026-07-01', [['606000', 'D', 1_200], ['401000', 'C', 1_200]]),
  ]
  const ouverture = reprise('2026-01-01', [['512000', 'D', 2_000], ['101000', 'C', 2_000]])
  const bilan = bilanEtabli({ ecritures, reprise: ouverture })
  const cr = compteDeResultat2033({
    bilan, mode: 'engagement', imposition: 'is',
    rattachements: { dotationsAuxProvisionsDExploitation: '256', reprisesDExploitation: '230' },
  })
  if (cr.etat !== 'etabli') throw new Error(cr.motif.texte)
  const sorties = {
    bilan, compteDeResultat: cr,
    tableau2033C: tableau2033C({ exercice: 2026, registre: [], natures: NATURES }),
    tableau2033D: tableau2033D([]),
    tableau2033E: tableau2033E(cr, { 119: 0, 143: 0, 153: 0, 310: null, 133: 0, 128: 0, 135: 0, 150: 0 }),
  }

  it('le 2033-B à l’euro, ses « dont » à saisir ; le 2033-E à saisir tant que ses loyers le sont ; le 2033-A rempli', () => {
    const { liasse, refus2033A } = liasseDepuisLia1(sorties, { designation: 'Société Fictive' })
    const b = liasse.tableaux['2033-B']!
    // 9 000,40 € arrondis à 9 000 ; 1 200 € en 242 ; le résultat 7 800.
    expect([b.get('218'), b.get('242'), b.get('310'), b.get('312'), b.get('314')]).toEqual([9_000, 1_200, 7_800, 7_800, 0])
    expect(b.get('209')).toBeNull()
    expect(liasse.tableaux['2033-E']!.get('137')).toBeNull()
    expect(refus2033A).toBeNull()
    const a = liasse.tableaux['2033-A']!
    // Disponibilités 2 000 ; clients 9 000 ; capital 2 000, résultat 7 800, fournisseurs 1 200.
    expect([a.get('084'), a.get('068'), a.get('096'), a.get('110')]).toEqual([2_000, 9_000, 11_000, 11_000])
    expect([a.get('120'), a.get('136'), a.get('142'), a.get('166'), a.get('176'), a.get('180')])
      .toEqual([2_000, 7_800, 9_800, 1_200, 1_200, 11_000])
    const p = planDeRemplissage2033(PAGES_VIDES, liasse)
    expect(p.aSaisir.get('2033-B')).toEqual(['209', '215', '217', '243', '255', '259', '260', '347', '348', '380'])
    expect(p.aSaisir.get('2033-E')).toEqual(['137', '152', '310'])
  })

  it('le 2033-A refusé quand un montant n’a pas de case (un compte à classer, un résultat en attente), et le refus rendu', () => {
    const aClasser = { ...bilan, totauxPassif: { ...bilan.totauxPassif, aClasser: 1_000 } }
    const r = liasseDepuisLia1({ ...sorties, bilan: aClasser }, { designation: null })
    expect(r.refus2033A).toMatch(/à classer/)
    expect(r.liasse.tableaux['2033-A']).toBeUndefined()
    expect(r.liasse.tableaux['2033-B']).toBeDefined()
    const enAttente = {
      ...bilan, passif: bilan.passif.map((p) => (p.id === 'resultats-en-attente' ? { ...p, montant: 50_000 } : p)),
    }
    expect(liasseDepuisLia1({ ...sorties, bilan: enAttente }, { designation: null }).refus2033A).toMatch(/attend son affectation/)
  })
})
