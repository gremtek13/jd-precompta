import { describe, expect, it } from 'vitest'
import { codeDuRegime, GRANDS_REGIMES, regimeChoisi, regimeDuLibelle } from './regimesAssuranceMaladie'

// LE RÉGIME D'UN ORGANISME IMPRIMÉ (conception 59, BOR1-Q5) : la liste fermée du jeu JDV_Code_regime de l'ANS, et la seule
// règle de rattachement — le premier segment du libellé, à l'identique. Les villes sont FICTIVES.

const code = (libelle: string) => {
  const r = regimeDuLibelle(libelle)
  return r.etat === 'reconnu' ? r.regime.code : null
}

describe('la liste fermée des grands régimes', () => {
  it('vingt-quatre lignes, chacune sourcée, codes uniques et dans le champ de NOE3 (0 à 99)', () => {
    expect(GRANDS_REGIMES).toHaveLength(24)
    expect(new Set(GRANDS_REGIMES.map((r) => r.code)).size).toBe(24)
    for (const r of GRANDS_REGIMES) {
      expect(Number.isInteger(r.code) && r.code >= 1 && r.code <= 99).toBe(true)
      expect(r.source).toMatch(/JDV_Code_regime/)
    }
    expect(codeDuRegime(GRANDS_REGIMES[0])).toBe('01')
  })
})

describe('regimeDuLibelle', () => {
  it('le premier segment, sans accents ni casse : CPAM au régime 01, MSA au 02, et les autres', () => {
    expect(code('CPAM - VILLE FICTIVE')).toBe(1)
    expect(code('cpam - Ville-Sur-Fiction')).toBe(1)
    expect(code('MSA - VILLE FICTIVE')).toBe(2)
    expect(code('ENIM')).toBe(6)
    expect(code('MGEN - SECTION FICTIVE')).toBe(91)
    expect(code('MG - VILLE')).toBe(92)
    expect(code('Senat')).toBe(15)
    expect(code('Francais a l\'etranger - X')).toBe(17)
  })

  it('jamais une sous-chaîne, jamais la ville, jamais un sigle absent du jeu : à choisir', () => {
    for (const libelle of ['CPAMX - VILLE', 'CAISSE CPAM - VILLE', 'VILLE - CPAM', 'CGSS - VILLE FICTIVE', 'MUTUELLE - MSA', '', ' - ', 'MGENERALE']) {
      expect(regimeDuLibelle(libelle)).toEqual({ etat: 'a_choisir' })
    }
  })
})

describe('regimeChoisi', () => {
  it('un code de la liste, ou rien', () => {
    expect(regimeChoisi(2)?.intitule).toBe('MSA')
    expect(regimeChoisi(11)).toBeNull()
    expect(regimeChoisi(0)).toBeNull()
  })
})
