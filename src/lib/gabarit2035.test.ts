import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  ancragesDesCases,
  chiffresDuSiret,
  formaterMontant,
  grilleDeSaisie,
  planDeRemplissage,
  texteCompatiblePdf,
} from './gabarit2035'
import type { FiletVertical, FragmentTexte, PageFormulaire } from './gabarit2035'
import { CASES_2035, CODES_TOTALISES_BR } from './cases2035'

const fragment = (o: Partial<FragmentTexte>): FragmentTexte =>
  ({ texte: 'BH', x: 456, y: 339, largeur: 11, hauteur: 8, ...o })

const filet = (x: number, o: Partial<FiletVertical> = {}): FiletVertical =>
  ({ x, y0: 300, y1: 400, ...o })

describe('formaterMontant', () => {
  it('sépare les milliers par une espace ordinaire, jamais par une espace fine', () => {
    // Le défaut trouvé en générant le premier PDF : `Intl.NumberFormat('fr-FR')` sépare par U+202F,
    // que l'encodage WinAnsi des polices PDF standard ne sait pas représenter. La génération plantait
    // sur le premier montant à quatre chiffres — donc sur à peu près toute déclaration réelle.
    const texte = formaterMontant(128450)
    expect(texte).toBe('128 450')
    expect(texte).not.toMatch(/[  ]/)
    for (const c of texte) expect(c.charCodeAt(0), c).toBeLessThan(128)
  })

  it('ne porte pas les centimes, comme le dit le formulaire', () => {
    expect(formaterMontant(1234.56)).toBe('1 235')
    expect(formaterMontant(1234.4)).toBe('1 234')
  })

  it('garde le signe d’un montant négatif', () => {
    expect(formaterMontant(-1500)).toBe('-1 500')
  })

  it('n’ajoute pas de séparateur en dessous de mille', () => {
    expect(formaterMontant(999)).toBe('999')
    expect(formaterMontant(1000)).toBe('1 000')
  })
})

describe('texteCompatiblePdf', () => {
  it('garde les accents français et l’apostrophe typographique', () => {
    // Tous dans CP1252 : les toucher abîmerait des noms parfaitement écrivables.
    expect(texteCompatiblePdf('CABINET MARTIN & ASSOCIÉS')).toBe('CABINET MARTIN & ASSOCIÉS')
    expect(texteCompatiblePdf('L’Atelier — Ça va')).toBe('L’Atelier — Ça va')
  })

  it('translittère une lettre hors CP1252 au lieu de faire échouer le formulaire', () => {
    // Les polices standard d'un PDF sont encodées en WinAnsi : « ł » n'y est pas et fait lever une
    // exception à l'écriture. Un accent perdu se corrige à la relecture, une déclaration non produite
    // bloque le dossier.
    // « ó » est dans WinAnsi et reste tel quel — on ne dégrade que ce qui ne passerait pas. « Ł » n'a
    // pas de décomposition Unicode (la barre fait partie du glyphe, ce n'est pas un accent
    // combinant) : sans table explicite il serait purement et simplement perdu.
    expect(texteCompatiblePdf('Kowalczyk-Łódź')).toBe('Kowalczyk-Lódz')
    expect(texteCompatiblePdf('Bǎlan')).toBe('Balan')
  })

  it('retire ce qui n’a aucune base latine plutôt que de tout perdre', () => {
    expect(texteCompatiblePdf('Cabinet 東京 SARL')).toBe('Cabinet  SARL')
  })

  it('ne rend que des caractères écrivables en WinAnsi', () => {
    for (const c of texteCompatiblePdf('Łódź 東京 ’— Ǎ')) {
      const code = c.charCodeAt(0)
      expect(code < 128 || (code >= 0xa0 && code <= 0xff) || code > 0x2000, c).toBe(true)
    }
  })
})

describe('chiffresDuSiret', () => {
  it('accepte quatorze chiffres, espaces de présentation compris', () => {
    expect(chiffresDuSiret('123 456 789 00012')?.join('')).toBe('12345678900012')
    expect(chiffresDuSiret('12345678900012')).toHaveLength(14)
  })

  it('refuse tout ce qui n’a pas exactement quatorze chiffres', () => {
    // Une grille de quatorze cases ne pardonne pas un décalage : mieux vaut ne rien écrire.
    expect(chiffresDuSiret('123456789')).toBeNull()
    expect(chiffresDuSiret('123456789000123')).toBeNull()
    expect(chiffresDuSiret('1234567890001A')).toBeNull()
    expect(chiffresDuSiret(null)).toBeNull()
    expect(chiffresDuSiret('')).toBeNull()
  })
})

describe('grilleDeSaisie', () => {
  // Filets régulièrement espacés à droite d'un libellé : la signature d'une grille de saisie.
  const grille = (debut: number, pas: number, nb: number, o: Partial<FiletVertical> = {}) =>
    Array.from({ length: nb + 1 }, (_, i) => filet(debut + i * pas, { y0: 680, y1: 700, ...o }))

  const label: FragmentTexte = { texte: 'N° SIRET', x: 29, y: 690, largeur: 34, hauteur: 8 }

  it('rend le centre de chaque cellule', () => {
    const centres = grilleDeSaisie({ fragments: [label], filets: grille(70, 20, 14) }, 'N° SIRET', 14)
    expect(centres).toHaveLength(14)
    expect(centres![0]).toBeCloseTo(80, 5)
    expect(centres![13]).toBeCloseTo(340, 5)
  })

  it('tolère une cellule un poil plus large que ses voisines', () => {
    // Positions relevées telles quelles sur le formulaire livré dans le dépôt : la cellule
    // 188,8 → 209,6 fait 20,8 pt là où ses voisines font 19,8. Un critère d'écart ABSOLU cassait
    // là et ne trouvait que la moitié de la grille — sept cases au lieu de quatorze.
    const reelles = [69.7, 89.5, 109.4, 129.2, 149.1, 168.9, 188.8, 209.6,
      229.5, 249.2, 269, 288.9, 308.7, 328.5, 348.4]
    const filets = reelles.map((x) => filet(x, { y0: 680, y1: 700 }))
    const centres = grilleDeSaisie({ fragments: [label], filets }, 'N° SIRET', 14)
    expect(centres).toHaveLength(14)
    expect(centres![0]).toBeCloseTo(79.6, 1)
    expect(centres![13]).toBeCloseTo(338.45, 2)
  })

  it('s’arrête avant les cases voisines de la même ligne', () => {
    // Sur le formulaire, la ligne du SIRET porte aussi les cases AV et AS, bien plus loin à droite.
    // La rupture d'espacement doit les exclure, sinon le compte de cellules serait faux.
    const reelles = [69.7, 89.5, 109.4, 129.2, 149.1, 168.9, 188.8, 209.6,
      229.5, 249.2, 269, 288.9, 308.7, 328.5, 348.4, 410.5, 431.1, 451.8, 493.2, 513.9, 534.6, 555.3]
    const filets = reelles.map((x) => filet(x, { y0: 680, y1: 700 }))
    expect(grilleDeSaisie({ fragments: [label], filets }, 'N° SIRET', 14)).toHaveLength(14)
  })

  it('renonce quand le compte de cellules n’est pas celui attendu', () => {
    // Treize ou quinze cases décaleraient tout le numéro d'un cran.
    expect(grilleDeSaisie({ fragments: [label], filets: grille(70, 20, 13) }, 'N° SIRET', 14)).toBeNull()
    expect(grilleDeSaisie({ fragments: [label], filets: grille(70, 20, 15) }, 'N° SIRET', 14)).toBeNull()
  })

  it('ignore les filets d’une autre ligne', () => {
    const filets = [...grille(70, 20, 14), filet(200, { y0: 300, y1: 320 })]
    expect(grilleDeSaisie({ fragments: [label], filets }, 'N° SIRET', 14)).toHaveLength(14)
  })

  it('ignore les filets situés à gauche du libellé', () => {
    const filets = [filet(10, { y0: 680, y1: 700 }), ...grille(70, 20, 14)]
    expect(grilleDeSaisie({ fragments: [label], filets }, 'N° SIRET', 14)).toHaveLength(14)
  })

  it('renonce quand le libellé est absent', () => {
    expect(grilleDeSaisie({ fragments: [], filets: grille(70, 20, 14) }, 'N° SIRET', 14)).toBeNull()
  })
})

describe('ancragesDesCases — la géométrie déduite du formulaire', () => {
  it('prend le DEUXIÈME filet à droite du code, pas le premier', () => {
    // Le premier ferme la cellule où le code est imprimé ; le deuxième ferme la case du montant.
    // Prendre le premier écrirait le montant par-dessus le code lui-même.
    const a = ancragesDesCases([{ fragments: [fragment({})], filets: [filet(473), filet(555)] }])
    expect(a.get('BH')?.xDroite).toBe(555)
  })

  it('ignore les filets qui ne traversent pas la ligne du code', () => {
    const a = ancragesDesCases([{
      fragments: [fragment({})],
      filets: [filet(473), filet(500, { y0: 600, y1: 700 }), filet(555)],
    }])
    expect(a.get('BH')?.xDroite).toBe(555)
  })

  it('ignore les filets situés à gauche du code', () => {
    const a = ancragesDesCases([{ fragments: [fragment({})], filets: [filet(100), filet(473), filet(555)] }])
    expect(a.get('BH')?.xDroite).toBe(555)
  })

  it('n’ancre rien quand il manque un filet, plutôt que d’inventer une position', () => {
    // Un montant écrit au mauvais endroit sur une déclaration est pire qu'un montant manquant : le
    // manquant se voit.
    const a = ancragesDesCases([{ fragments: [fragment({})], filets: [filet(473)] }])
    expect(a.has('BH')).toBe(false)
  })

  it('ne prend pas un mot de deux lettres pour un code de case', () => {
    const a = ancragesDesCases([{
      fragments: [fragment({ texte: 'Si' }), fragment({ texte: 'N°' })],
      filets: [filet(473), filet(555)],
    }])
    expect(a.size).toBe(0)
  })

  it('retient la page où le code a été trouvé', () => {
    const a = ancragesDesCases([
      { fragments: [], filets: [] },
      { fragments: [fragment({ texte: 'CH' })], filets: [filet(497), filet(560)] },
    ])
    expect(a.get('CH')?.page).toBe(2)
  })
})

describe('planDeRemplissage', () => {
  const ancrages = ancragesDesCases([{
    fragments: [fragment({ texte: 'BH', y: 339 }), fragment({ texte: 'BA', y: 500 })],
    filets: [filet(473, { y0: 300, y1: 600 }), filet(555, { y0: 300, y1: 600 })],
  }])
  const sansEntete = { nom: null, activite: null, siret: null }

  it('n’inscrit pas les cases à zéro', () => {
    // Sur un formulaire fiscal, une case vide vaut zéro. Imprimer « 0 » dans les cinquante cases
    // inutilisées noierait les montants réels.
    const { inscriptions } = planDeRemplissage(ancrages, new Map([['BH', 1918], ['BA', 0]]), sansEntete, [])
    expect(inscriptions.map((i) => i.texte)).toEqual(['1 918'])
  })

  it('aligne les montants à droite, en retrait du filet', () => {
    const { inscriptions } = planDeRemplissage(ancrages, new Map([['BH', 1918]]), sansEntete, [])
    expect(inscriptions[0].alignement).toBe('droite')
    expect(inscriptions[0].x).toBeLessThan(555)
    expect(inscriptions[0].x).toBeGreaterThan(545)
  })

  it('remonte les codes qu’il n’a pas su placer au lieu de les dessiner au jugé', () => {
    const { inscriptions, codesSansAncrage } = planDeRemplissage(
      ancrages, new Map([['BH', 1918], ['CP', 9000]]), sansEntete, [],
    )
    expect(inscriptions).toHaveLength(1)
    expect(codesSansAncrage).toEqual(['CP'])
  })

  it('écrit l’en-tête à droite de son libellé imprimé', () => {
    const pages: PageFormulaire[] = [{
      fragments: [{ texte: 'NOM ET PRENOMS OU DÉNOMINATION', x: 50, y: 723, largeur: 180, hauteur: 8 }],
      filets: [],
    }]
    const { inscriptions } = planDeRemplissage(new Map(), new Map(), { nom: 'Dupont', activite: null, siret: null }, pages)
    expect(inscriptions).toHaveLength(1)
    expect(inscriptions[0]).toMatchObject({ texte: 'Dupont', alignement: 'gauche', y: 723 })
    expect(inscriptions[0].x).toBeGreaterThan(230)
  })

  it('n’écrit pas un en-tête vide', () => {
    const pages: PageFormulaire[] = [{
      fragments: [{ texte: 'NOM ET PRENOMS OU DÉNOMINATION', x: 50, y: 723, largeur: 180, hauteur: 8 }],
      filets: [],
    }]
    const { inscriptions } = planDeRemplissage(new Map(), new Map(), { nom: '   ', activite: null, siret: null }, pages)
    expect(inscriptions).toHaveLength(0)
  })
})

// Le formulaire vierge est livré dans le dépôt : ce test le lit vraiment. Il attrape ce qu'aucun test
// sur données synthétiques ne verrait — un millésime dont la mise en page change, ou un repérage qui
// ne marche que dans ma tête.
describe('sur le formulaire officiel livré dans le dépôt', () => {
  async function lireModele(): Promise<PageFormulaire[]> {
    const donnees = new Uint8Array(readFileSync('public/formulaires/2035-sd-2026.pdf'))
    const doc = await pdfjs.getDocument({ data: donnees }).promise
    const pages: PageFormulaire[] = []
    for (let n = 1; n <= 2; n++) {
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
      pages.push({ fragments, filets })
    }
    return pages
  }

  it('sait placer toutes les cases qui composent le total des dépenses', async () => {
    const ancrages = ancragesDesCases(await lireModele())
    for (const code of CODES_TOTALISES_BR) expect(ancrages.has(code), code).toBe(true)
    expect(ancrages.has('BR')).toBe(true)
  })

  it('sait placer chacune des cases du tableau', async () => {
    // Si une seule manque, un montant réel n'irait nulle part sur le PDF.
    const ancrages = ancragesDesCases(await lireModele())
    const manquantes = CASES_2035.filter((c) => !ancrages.has(c.code)).map((c) => c.code)
    expect(manquantes).toEqual([])
  })

  it('place BH sur la première page et CH sur la seconde', async () => {
    // BH est un total groupé du 2035-A, CH la dotation aux amortissements du 2035-B : se tromper de
    // page mettrait les amortissements dans les dépenses du cadre 3.
    const ancrages = ancragesDesCases(await lireModele())
    expect(ancrages.get('BH')?.page).toBe(1)
    expect(ancrages.get('CH')?.page).toBe(2)
  })

  it('place le cadre 8 en bas du 2035-B, le revenu négatif dans sa colonne intérieure', async () => {
    // Nouveauté du millésime 2026 : DE, DB, DC et DD sous le résultat. DC est imprimée en colonne
    // intérieure, à gauche de DD ; c'est le deuxième filet à droite de son code qui l'y place, sans
    // rien coder en dur. Un revenu négatif écrit dans la case de DD passerait pour un revenu positif.
    const ancrages = ancragesDesCases(await lireModele())
    const cr = ancrages.get('CR')!
    const [de, db, dc, dd] = ['DE', 'DB', 'DC', 'DD'].map((code) => ancrages.get(code)!)
    for (const a of [de, db, dc, dd]) {
      expect(a.page, a.code).toBe(2)
      expect(a.y, a.code).toBeLessThan(cr.y)
    }
    // De haut en bas dans l'ordre imprimé.
    expect(de.y).toBeGreaterThan(db.y)
    expect(db.y).toBeGreaterThan(dc.y)
    expect(dc.y).toBeGreaterThan(dd.y)
    // DE, DB et DD au bord droit des cases du résultat ; DC nettement à gauche.
    for (const a of [de, db, dd]) expect(a.xDroite, a.code).toBe(cr.xDroite)
    expect(dc.xDroite).toBeLessThan(cr.xDroite - 50)
  })

  it('trouve le libellé d’en-tête sur lequel le nom s’ancre', async () => {
    const pages = await lireModele()
    const { inscriptions } = planDeRemplissage(new Map(), new Map(), { nom: 'Cabinet Test', activite: null, siret: null }, pages)
    expect(inscriptions.map((i) => i.texte)).toEqual(['Cabinet Test'])
    expect(inscriptions[0].page).toBe(1)
  })
})
