import { describe, expect, it } from 'vitest'
import {
  horsTaxeEtTva, horsTaxeSigne, libelleTaux, TAUX_TVA_RELEVE, tauxApplicable, tauxPrisEnCharge, tauxRequis, tvaIncluse,
} from './tvaDuReleve'
import { entierTire, tirage } from '../test/encaissementsBatterie'

// LA TABLE DE LA BASE : `public.tva_incluse` interrogée le 01/10/2026 sur ces montants et ces taux. C'est
// elle qui vérifie l'écriture composée par l'application, donc c'est contre elle — et non contre une
// seconde copie de la formule — que l'application se mesure.
const MESURE_EN_BASE: [montant: number, taux: number, tva: number][] = [
  [0.03, 20, 0.01], [0.03, 10, 0], [0.03, 5.5, 0], [0.03, 8.5, 0],
  [0.09, 20, 0.02], [0.09, 10, 0.01], [0.09, 5.5, 0], [0.09, 8.5, 0.01],
  [1, 20, 0.17], [1, 10, 0.09], [1, 5.5, 0.05], [1, 8.5, 0.08],
  [12.34, 20, 2.06], [12.34, 10, 1.12], [12.34, 5.5, 0.64], [12.34, 8.5, 0.97],
  [99.99, 20, 16.67], [99.99, 10, 9.09], [99.99, 5.5, 5.21], [99.99, 8.5, 7.83],
  [100, 20, 16.67], [100, 10, 9.09], [100, 5.5, 5.21], [100, 8.5, 7.83],
  [105.5, 20, 17.58], [105.5, 10, 9.59], [105.5, 5.5, 5.5], [105.5, 8.5, 8.26],
  [120, 20, 20], [120, 10, 10.91], [120, 5.5, 6.26], [120, 8.5, 9.4],
  [492.6, 20, 82.1], [492.6, 10, 44.78], [492.6, 5.5, 25.68], [492.6, 8.5, 38.59],
  [1234.56, 20, 205.76], [1234.56, 10, 112.23], [1234.56, 5.5, 64.36], [1234.56, 8.5, 96.72],
  [98765.43, 20, 16460.91], [98765.43, 10, 8978.68], [98765.43, 5.5, 5148.91], [98765.43, 8.5, 7737.38],
  [-60, 20, 10], [-60, 10, 5.45], [-60, 5.5, 3.13], [-60, 8.5, 4.7], [-0.03, 20, 0.01],
]

// Une référence ÉCRITE AUTREMENT : quotient et reste en entiers exacts, le demi vers le haut décidé sur le
// reste. Deux écritures de la même règle qui s'accordent sur des millions de montants valent mieux qu'une
// seule qu'on relit.
function reference(centimes: bigint, taux: number): bigint {
  const t = BigInt(Math.round(taux * 10))
  const d = 1000n + t
  const q = centimes * t
  const k = q / d
  return 2n * (q - k * d) >= d ? k + 1n : k
}

describe('tvaIncluse — la TVA d’un montant TTC, au centime, comme la base', () => {
  it('rend la table mesurée en base, au centime', () => {
    for (const [montant, taux, tva] of MESURE_EN_BASE) {
      expect(tvaIncluse(montant, taux), `${montant} à ${taux} %`).toBe(tva)
    }
  })

  it('le demi-centime monte : 0,03 € à 20 % contient 0,005 € de TVA, rendu 0,01 €', () => {
    // À 20 %, la TVA d'un TTC est TTC / 6 : un demi exact tombe sur tout montant de 3 centimes modulo 6.
    expect(tvaIncluse(0.03, 20)).toBe(0.01)
    expect(tvaIncluse(0.09, 20)).toBe(0.02)
  })

  it('zéro : aucune TVA', () => {
    expect(tvaIncluse(492.6, 0)).toBe(0)
  })

  it('s’accorde avec une référence en entiers exacts sur tous les montants jusqu’à 2 000 €', () => {
    for (const taux of [20, 10, 5.5, 8.5, 0]) {
      for (let c = 0; c <= 200000; c++) {
        const attendu = reference(BigInt(c), taux)
        if (Math.round(tvaIncluse(c / 100, taux) * 100) !== Number(attendu)) {
          throw new Error(`${c} centimes à ${taux} % : ${tvaIncluse(c / 100, taux)} au lieu de ${attendu}`)
        }
      }
    }
  })

  // Les montants sortent de `tirage` (src/test/encaissementsBatterie.ts). Le congruentiel en virgule flottante qui les
  // tirait avant le 09/10/2026 bouclait sur 10 466 valeurs presque toutes paires : 6 440 montants distincts sur 20 000,
  // et six seulement tombaient sur un demi-centime exact à 20 % — la borne que l'arrondi décide. Ils sont 3 324.
  it('et sur de grands montants, jusqu’à dix millions d’euros', () => {
    const hasard = tirage(1234567)
    for (let i = 0; i < 20000; i++) {
      const c = entierTire(hasard, 1_000_000_000)
      for (const taux of [20, 10, 5.5, 8.5]) {
        expect(Math.round(tvaIncluse(c / 100, taux) * 100)).toBe(Number(reference(BigInt(c), taux)))
      }
    }
  })
})

describe('horsTaxeEtTva — le hors taxe et la TVA font le TTC, exactement', () => {
  it('au centime, sans reste flottant', () => {
    // 492,60 − 82,10 en flottants : 410,50000000000006 — que la base refuserait.
    expect(horsTaxeEtTva(492.6, 20)).toEqual({ ht: 410.5, tva: 82.1 })
    expect(horsTaxeEtTva(120, 20)).toEqual({ ht: 100, tva: 20 })
  })

  it('positifs, quel que soit le signe du montant', () => {
    expect(horsTaxeEtTva(-60, 20)).toEqual({ ht: 50, tva: 10 })
  })

  it('sans taux, tout est hors taxe', () => {
    expect(horsTaxeEtTva(-8.5, null)).toEqual({ ht: 8.5, tva: 0 })
    expect(horsTaxeEtTva(1234.56, 0)).toEqual({ ht: 1234.56, tva: 0 })
  })

  it('leur somme rend le TTC au centime sur tous les montants jusqu’à 500 €', () => {
    for (const taux of [20, 10, 5.5, 8.5, 0, null]) {
      for (let c = 1; c <= 50000; c++) {
        const { ht, tva } = horsTaxeEtTva(c / 100, taux)
        // Et chacun est bien un nombre de centimes — le flottant le plus proche, pas 410,50000000000006.
        if (Math.round(ht * 100) + Math.round(tva * 100) !== c || ht !== Math.round(ht * 100) / 100 || tva !== Math.round(tva * 100) / 100) {
          throw new Error(`${c} centimes à ${taux} % : ${ht} + ${tva}`)
        }
      }
    }
  })
})

describe('horsTaxeSigne — ce qu’une recette taxée ajoute à son poste', () => {
  it('garde le signe du montant', () => {
    expect(horsTaxeSigne(120, 20)).toBe(100)
    expect(horsTaxeSigne(-120, 20)).toBe(-100)
    expect(horsTaxeSigne(-8.5, null)).toBe(-8.5)
  })
})

describe('le taux qui s’applique', () => {
  it('est requis pour une recette d’un dossier assujetti, et pour rien d’autre', () => {
    expect(tauxRequis(true, 'recette')).toBe(true)
    expect(tauxRequis(true, 'depense')).toBe(false)
    expect(tauxRequis(false, 'recette')).toBe(false)
    expect(tauxRequis(true, null)).toBe(false)
  })

  it('le taux gardé ne s’applique que là où il est requis', () => {
    expect(tauxApplicable(true, 'recette', 20)).toBe(20)
    expect(tauxApplicable(true, 'recette', null)).toBeNull()
    // Un dossier qui a cessé d'être assujetti : le taux gardé ne s'applique plus.
    expect(tauxApplicable(false, 'recette', 20)).toBeNull()
    expect(tauxApplicable(true, 'depense', 20)).toBeNull()
  })

  it('les taux pris en charge, et pas 2,1 % : sa ligne de la CA3 dépend du territoire', () => {
    expect([...TAUX_TVA_RELEVE]).toEqual([20, 10, 5.5, 8.5, 0])
    for (const taux of TAUX_TVA_RELEVE) expect(tauxPrisEnCharge(taux)).toBe(true)
    for (const taux of [2.1, 7, 19.6, -20, 200]) expect(tauxPrisEnCharge(taux)).toBe(false)
  })

  it('se dit en français : « 5,5 % », « exonérée », l’espace avant « % » insécable', () => {
    expect(TAUX_TVA_RELEVE.map(libelleTaux)).toEqual(['20\u00a0%', '10\u00a0%', '5,5\u00a0%', '8,5\u00a0%', 'exonérée'])
  })
})
