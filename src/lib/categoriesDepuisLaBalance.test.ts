import { describe, expect, it } from 'vitest'
import type { LigneBalance } from './balanceImport'
import { categoriesDepuisLaBalance, texteDUnEcart } from './categoriesDepuisLaBalance'
import { PLAN_PAR_DEFAUT } from './planComptable'

const l = (compte: string, libelle: string, debit = 0, credit = 0): LigneBalance => ({ compte, libelle, debit, credit })
const CONNUES = [
  { libelle: 'Carburant / déplacements', compte_comptable: '625100' },
  { libelle: 'Ventes / prestations', compte_comptable: '706000' },
  { libelle: 'Sans compte', compte_comptable: null },
]
const BALANCE = [
  l('512000', 'Banque', 1000), l('606400', 'Fournitures', 120.5), l('6064', 'Petit matériel', 10), l('6061000', 'Eau', 30),
  l('68112000', 'Dotations', 500), l('646000', 'Cotisations Urssaf', 800), l('625110', 'Indemnités km', 300),
  l('625100', 'Voyages', 50), l('706000', 'Honoraires', 0, 9000), l('7061234', 'Honoraires détaillés', 0, 5),
  l('758000', 'Produits divers', 0, 40), l('613200', '\u0007', 600),
]

describe('categoriesDepuisLaBalance', () => {
  const { proposees, ecartes } = categoriesDepuisLaBalance(BALANCE, PLAN_PAR_DEFAUT, CONNUES)
  it('propose les comptes de charges et de produits, à six chiffres, réunis à des zéros près, dans l’ordre des comptes', () => {
    expect(proposees.map((p) => p.compte)).toEqual(['606100', '606400', '613200', '758000'])
    const fournitures = proposees.find((p) => p.compte === '606400')!
    expect(fournitures).toMatchObject({ classe: 6, numeros: ['606400', '6064'], libelle: 'Fournitures', solde: 13050 })
    expect(proposees.find((p) => p.compte === '758000')).toMatchObject({ classe: 7, solde: -4000 })
  })
  it('ne devine aucun poste, et laisse un libellé illisible au cabinet', () => {
    expect(proposees.every((p) => !('poste' in p))).toBe(true)
    expect(proposees.find((p) => p.compte === '613200')!.libelle).toBeNull()
  })
  it('écarte et dit : plus de six chiffres, dotations, cotisations, barème, déjà tenu', () => {
    expect(ecartes.map((e) => [e.numero, e.raison])).toEqual([
      ['68112000', 'dotations'], ['646000', 'cotisations'], ['625110', 'bareme'], ['625100', 'deja'],
      ['706000', 'deja'], ['7061234', 'trop_long'],
    ])
    expect(texteDUnEcart(ecartes[3])).toBe('625100 « Voyages » : déjà le compte de la catégorie « Carburant / déplacements ».')
  })
  it('suit le barème du plan, pas celui du catalogue', () => {
    const plan = { ...PLAN_PAR_DEFAUT, indemnites_kilometriques: '625120' }
    const r = categoriesDepuisLaBalance([l('625110', 'Ancien barème'), l('62512', 'Barème')], plan, [])
    expect(r.proposees.map((p) => p.compte)).toEqual(['625110'])
    expect(r.ecartes.map((e) => e.raison)).toEqual(['bareme'])
  })
  it('une balance sans classe 6 ni 7 ne propose rien', () => {
    expect(categoriesDepuisLaBalance([l('512000', 'Banque', 10), l('101000', 'Capital', 0, 10)], PLAN_PAR_DEFAUT, [])).toEqual({ proposees: [], ecartes: [] })
  })
})
