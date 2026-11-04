import { describe, expect, it } from 'vitest'
import { cabinetDeLaCharte } from './cabinetDeLaCharte'

// Ligne 23.21 : la charte d'un client suit la société AFFICHÉE ; ce qui ne se lit pas ne désigne aucun cabinet.
const SOCIETES = [
  { id: 'd1', nom: 'Société Un', cabinetId: 'cab-A' },
  { id: 'd2', nom: 'Société Deux', cabinetId: 'cab-B' },
]

describe('cabinetDeLaCharte', () => {
  it('un client : le cabinet de la société affichée, l’une puis l’autre', () => {
    expect(cabinetDeLaCharte({ role: 'client', monCabinetId: null, mesSocietes: SOCIETES, dossierActifId: 'd1' })).toBe('cab-A')
    expect(cabinetDeLaCharte({ role: 'client', monCabinetId: null, mesSocietes: SOCIETES, dossierActifId: 'd2' })).toBe('cab-B')
  })

  it('un client : sans société affichée, une société absente de la liste ou sans cabinet lu, aucun cabinet', () => {
    expect(cabinetDeLaCharte({ role: 'client', monCabinetId: null, mesSocietes: SOCIETES, dossierActifId: null })).toBeNull()
    expect(cabinetDeLaCharte({ role: 'client', monCabinetId: null, mesSocietes: [], dossierActifId: 'd1' })).toBeNull()
    expect(cabinetDeLaCharte({ role: 'client', monCabinetId: null, mesSocietes: [{ id: 'd1', nom: 'X', cabinetId: null }], dossierActifId: 'd1' })).toBeNull()
  })

  it('un client ne prend jamais `monCabinetId`', () => {
    expect(cabinetDeLaCharte({ role: 'client', monCabinetId: 'cab-Z', mesSocietes: [], dossierActifId: 'd1' })).toBeNull()
  })

  it('un compte du cabinet : son cabinet ; personne de connecté : aucun', () => {
    expect(cabinetDeLaCharte({ role: 'cabinet', monCabinetId: 'cab-A', mesSocietes: SOCIETES, dossierActifId: 'd2' })).toBe('cab-A')
    expect(cabinetDeLaCharte({ role: null, monCabinetId: null, mesSocietes: [], dossierActifId: null })).toBeNull()
  })
})
