import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CLE_LARGEUR_BARRE, LARGEUR_BARRE, LARGEUR_BARRE_REDUITE, LARGEUR_MIN_CENTRE, LARGEUR_PANNEAU, LARGEUR_VISIBLE_SOUS_VOLET,
  SEUIL_ORDINATEUR, SEUIL_VOLET_EN_LIGNE, bornesBarre, bornesPanneau, largeurBarre, largeurPanneau, largeurPanneauParDefaut,
  lireLargeur, retenirLargeur,
} from './largeurVolets'

// La largeur des deux volets (lib/largeurVolets.ts). Ce qu'elle promet : choisie par l'opérateur, elle ne rogne jamais
// le panneau central sous la largeur où les écrans ont été vérifiés, et ce qu'on n'a pas choisi garde exactement sa
// largeur d'origine — celle d'index.css, que les écrans ont toujours eue.

const fenetres = (de: number, a: number, pas: number) => Array.from({ length: Math.floor((a - de) / pas) + 1 }, (_, i) => de + i * pas)
const choix = (de: number, a: number, pas: number): (number | null)[] => [null, ...fenetres(de, a, pas)]

describe('Sans choix de l’opérateur, la largeur d’origine', () => {
  it('la barre garde ses 264 pixels sur toute fenêtre d’ordinateur', () => {
    for (const f of fenetres(SEUIL_ORDINATEUR, 2560, 3)) expect(largeurBarre(null, f)).toBe(264)
  })

  it('le volet garde la largeur d’index.css, en ligne comme superposé, barre réduite ou non', () => {
    for (const f of fenetres(SEUIL_ORDINATEUR, 2560, 3)) {
      expect(largeurPanneau(null, f, 264)).toBe(largeurPanneauParDefaut(f))
      expect(largeurPanneau(null, f, LARGEUR_BARRE_REDUITE)).toBe(largeurPanneauParDefaut(f))
    }
    expect([1280, 1440, 1600, 1024, 721].map(largeurPanneauParDefaut)).toEqual([358, 403, 440, 420, 420])
  })

  // Les deux décrivent la même largeur d'origine : le module la calcule, index.css la porte en repli tant que la coque
  // n'a pas posé ses variables. Si l'un change sans l'autre, la largeur saute au premier rendu.
  it('les replis d’index.css sont ceux du module', () => {
    const css = readFileSync('src/index.css', 'utf8')
    expect(css).toContain(`width: var(--largeur-barre, ${LARGEUR_BARRE.defaut}px);`)
    expect(css).toContain(`width: var(--largeur-panneau, clamp(${LARGEUR_PANNEAU.min}px, 28vw, 440px));`)
    expect(css).toContain('width: var(--largeur-panneau, min(420px, calc(100vw - 96px)));')
    expect(css).toMatch(new RegExp(`@media \\(min-width: ${SEUIL_ORDINATEUR}px\\) and \\(max-width: ${SEUIL_VOLET_EN_LIGNE - 1}px\\)`))
  })
})

describe('Ce que l’opérateur choisit, borné', () => {
  it('le panneau central en ligne garde toujours sa largeur minimale', () => {
    for (const f of fenetres(SEUIL_VOLET_EN_LIGNE, 2560, 11)) {
      for (const barreVoulue of [...choix(LARGEUR_BARRE.min, LARGEUR_BARRE.max, 19), 'reduite' as const]) {
        const barre = barreVoulue === 'reduite' ? LARGEUR_BARRE_REDUITE : largeurBarre(barreVoulue, f)
        for (const panneauVoulu of choix(LARGEUR_PANNEAU.min, LARGEUR_PANNEAU.max, 23)) {
          const centre = f - barre - largeurPanneau(panneauVoulu, f, barre) - 16
          expect(centre, `fenêtre ${f}, barre ${barre}, volet voulu ${panneauVoulu}`).toBeGreaterThanOrEqual(LARGEUR_MIN_CENTRE)
        }
      }
    }
  })

  it('volet fermé, la barre élargie laisse au panneau central sa largeur minimale, sauf à sa largeur d’origine', () => {
    for (const f of fenetres(SEUIL_ORDINATEUR, SEUIL_VOLET_EN_LIGNE - 1, 7)) {
      for (const voulue of choix(LARGEUR_BARRE.min, LARGEUR_BARRE.max, 13)) {
        const barre = largeurBarre(voulue, f)
        if (barre > LARGEUR_BARRE.defaut) expect(f - barre - 8).toBeGreaterThanOrEqual(LARGEUR_MIN_CENTRE)
      }
    }
  })

  it('superposé et élargi, le volet laisse voir une part du panneau central', () => {
    for (const f of fenetres(SEUIL_ORDINATEUR, SEUIL_VOLET_EN_LIGNE - 1, 7)) {
      for (const barre of [LARGEUR_BARRE_REDUITE, 200, 264, 320, 376, 420]) {
        for (const voulu of choix(LARGEUR_PANNEAU.min, LARGEUR_PANNEAU.max, 17)) {
          const volet = largeurPanneau(voulu, f, barre)
          if (volet > largeurPanneauParDefaut(f)) {
            expect(f - 8 - volet - barre, `fenêtre ${f}, barre ${barre}, volet ${volet}`).toBeGreaterThanOrEqual(LARGEUR_VISIBLE_SOUS_VOLET)
          }
        }
      }
    }
  })

  it('élargir la barre rétrécit le volet en ligne, et le lui rend quand on la rétrécit', () => {
    expect(largeurPanneau(700, 1440, 264)).toBe(600)
    expect(largeurPanneau(700, 1440, 324)).toBe(540)
    expect(largeurPanneau(700, 1440, 200)).toBe(664)
    expect(largeurPanneau(700, 1440, LARGEUR_BARRE_REDUITE)).toBe(700)
  })

  // Ce que le cabinet a demandé : pouvoir changer la largeur des deux volets. À 1 280 pixels — un portable de 1 920
  // affiché à 150 % —, la première borne laissait au volet de droite 2 pixels à gagner et à la barre 20 : les poignées
  // ne servaient presque à rien sur l'écran où l'on en a le plus besoin.
  it('à 1 280 pixels, les deux poignées ont de la marge', () => {
    expect(LARGEUR_MIN_CENTRE).toBe(560)
    expect(bornesPanneau(1280, LARGEUR_BARRE.defaut).max - largeurPanneauParDefaut(1280)).toBeGreaterThanOrEqual(80)
    expect(bornesBarre(1280).max - LARGEUR_BARRE.defaut).toBeGreaterThanOrEqual(100)
  })

  it('les bornes absolues tiennent, et un choix se ramène au pixel', () => {
    expect(largeurBarre(150, 1440)).toBe(LARGEUR_BARRE.min)
    expect(largeurBarre(900, 1920)).toBe(LARGEUR_BARRE.max)
    expect(largeurBarre(300.6, 1440)).toBe(301)
    expect(largeurPanneau(100, 1920, 264)).toBe(LARGEUR_PANNEAU.min)
    expect(largeurPanneau(2000, 2560, 264)).toBe(LARGEUR_PANNEAU.max)
    expect(bornesBarre(1440)).toEqual({ min: 200, max: 420 })
    expect(bornesBarre(1280)).toEqual({ min: 200, max: 364 })
    expect(bornesBarre(1024)).toEqual({ min: 200, max: 420 })
    expect(bornesBarre(900)).toEqual({ min: 200, max: 332 })
    expect(bornesBarre(800)).toEqual({ min: 200, max: 264 })
    expect(bornesPanneau(1440, 264)).toEqual({ min: 340, max: 600 })
    expect(bornesPanneau(1280, 264)).toEqual({ min: 340, max: 440 })
    expect(bornesPanneau(1200, 264)).toEqual({ min: 340, max: 608 })
    expect(bornesPanneau(900, 264)).toEqual({ min: 340, max: 420 })
  })
})

describe('La préférence retenue par le navigateur', () => {
  const stockage = new Map<string, string>()
  const faux = {
    getItem: (cle: string) => stockage.get(cle) ?? null,
    setItem: (cle: string, valeur: string) => { stockage.set(cle, valeur) },
    removeItem: (cle: string) => { stockage.delete(cle) },
  }
  afterEach(() => {
    stockage.clear()
    vi.unstubAllGlobals()
  })

  it('relit une largeur retenue, dans ses bornes', () => {
    vi.stubGlobal('localStorage', faux)
    expect(lireLargeur(CLE_LARGEUR_BARRE, LARGEUR_BARRE)).toBeNull()
    retenirLargeur(CLE_LARGEUR_BARRE, 300.4)
    expect(stockage.get(CLE_LARGEUR_BARRE)).toBe('300')
    expect(lireLargeur(CLE_LARGEUR_BARRE, LARGEUR_BARRE)).toBe(300)
    retenirLargeur(CLE_LARGEUR_BARRE, null)
    expect(stockage.has(CLE_LARGEUR_BARRE)).toBe(false)
  })

  it('ignore une valeur qu’elle ne reconnaît pas, plutôt qu’un volet qu’on ne pourrait plus attraper', () => {
    vi.stubGlobal('localStorage', faux)
    for (const brute of ['3', '9000', '300px', ' 300', '-250', '2.5e2', 'NaN', '']) {
      stockage.set(CLE_LARGEUR_BARRE, brute)
      expect(lireLargeur(CLE_LARGEUR_BARRE, LARGEUR_BARRE), `« ${brute} »`).toBeNull()
    }
  })

  it('un stockage indisponible ne casse rien : largeur d’origine, et rien de retenu', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('refusé') },
      setItem: () => { throw new Error('refusé') },
      removeItem: () => { throw new Error('refusé') },
    })
    expect(lireLargeur(CLE_LARGEUR_BARRE, LARGEUR_BARRE)).toBeNull()
    expect(() => retenirLargeur(CLE_LARGEUR_BARRE, 300)).not.toThrow()
    expect(() => retenirLargeur(CLE_LARGEUR_BARRE, null)).not.toThrow()
  })
})
