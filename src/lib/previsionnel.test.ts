import { describe, expect, it } from 'vitest'
import { calculerPrevisionnel } from './previsionnel'

describe('calculerPrevisionnel', () => {
  it('compose la croissance année après année', () => {
    // 10 % composé : 100 000 → 110 000 → 121 000 → 133 100. Un taux appliqué linéairement
    // rendrait 130 000 la troisième année.
    const lignes = calculerPrevisionnel(2026, 100000, 60000, 10, 0)
    expect(lignes.map((l) => l.ca)).toEqual([110000, 121000, 133100])
  })

  it('numérote les années à partir de celle qui suit la référence', () => {
    expect(calculerPrevisionnel(2026, 1000, 500, 0, 0).map((l) => l.annee)).toEqual([2027, 2028, 2029])
  })

  it('applique un taux propre au CA et aux charges', () => {
    const [premiere] = calculerPrevisionnel(2026, 100000, 50000, 10, 4)
    expect(premiere).toEqual({ annee: 2027, ca: 110000, charges: 52000, resultat: 58000 })
  })

  it('accepte une croissance nulle ou négative', () => {
    expect(calculerPrevisionnel(2026, 100000, 0, 0, 0)[2].ca).toBe(100000)
    expect(calculerPrevisionnel(2026, 100000, 0, -10, 0).map((l) => l.ca)).toEqual([90000, 81000, 72900])
  })

  it('rend un résultat négatif quand les charges dépassent le CA', () => {
    expect(calculerPrevisionnel(2026, 50000, 80000, 0, 0)[0].resultat).toBe(-30000)
  })

  it('projette sur le nombre d’années demandé', () => {
    expect(calculerPrevisionnel(2026, 1000, 0, 0, 0, 5)).toHaveLength(5)
  })

  it('arrondit au centime', () => {
    // 1000 × 1,033 = 1033,0000000000002 sans arrondi.
    expect(calculerPrevisionnel(2026, 1000, 0, 3.3, 0)[0].ca).toBe(1033)
  })
})
