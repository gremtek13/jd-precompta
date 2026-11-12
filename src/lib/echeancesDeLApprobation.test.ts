import { afterEach, describe, expect, it, vi } from 'vitest'
import { echeancesDeLApprobation, type DecisionDuCalendrier } from './echeancesFiscales'
import { aujourdHuiAParis } from './format'

// LE CALENDRIER DE L'APPROBATION (ligne 45, AFF5) : six mois de la clôture, le greffe un mois après la décision, les dividendes
// dans les neuf mois ; « aujourd'hui » au jour de PARIS, quel que soit le fuseau de la machine (la suite tourne sous quatre).

const decision = (d: Partial<DecisionDuCalendrier> = {}): DecisionDuCalendrier => ({
  dateDecision: '2027-05-15', comptesApprouves: true, dividendesCentimes: 2_000_000, dateMiseEnPaiement: '2027-06-15', ...d,
})
const etats = (r: ReturnType<typeof echeancesDeLApprobation>) => r.map((x) => [x.id, x.date, x.etat])

afterEach(() => { vi.useRealTimers() })

describe('echeancesDeLApprobation', () => {
  it('sans décision, avant le 30 juin : l’approbation et le greffe à venir, aucun dividende', () => {
    expect(etats(echeancesDeLApprobation(2026, null, '2027-03-01'))).toEqual([
      ['approbation', '2027-06-30', 'a_venir'], ['greffe', '2027-07-30', 'a_venir'],
    ])
  })

  it('une décision dans les six mois : tenue ; le greffe un mois après elle ; les dividendes mis en paiement à temps', () => {
    const r = echeancesDeLApprobation(2026, decision(), '2027-05-20')
    expect(etats(r)).toEqual([
      ['approbation', '2027-06-30', 'tenu'], ['greffe', '2027-06-15', 'a_venir'], ['dividendes', '2027-09-30', 'tenu'],
    ])
    expect(r[0].dit).toBe('Décision du 15/05/2027.')
  })

  it('les délais passés se disent, sans rien bloquer : décision tardive, greffe à vérifier, paiement au-delà des neuf mois', () => {
    const r = echeancesDeLApprobation(2026, decision({ dateDecision: '2027-07-10', dateMiseEnPaiement: '2027-10-15' }), '2027-11-12')
    expect(etats(r)).toEqual([
      ['approbation', '2027-06-30', 'passe'], ['greffe', '2027-08-10', 'passe'], ['dividendes', '2027-09-30', 'passe'],
    ])
    expect(r[1].dit).toContain('à vérifier')
    expect(r[2].dit).toContain('au-delà des neuf mois')
  })

  it('des comptes non approuvés : le greffe reçoit la délibération de refus, aucun dividende', () => {
    const r = echeancesDeLApprobation(2026, decision({ comptesApprouves: false, dateMiseEnPaiement: null }), '2027-05-20')
    expect(r.map((x) => x.id)).toEqual(['approbation', 'greffe'])
    expect(r[1].libelle).toContain('délibération de refus')
  })

  it('une date illisible : rien plutôt qu’un rappel faux', () => {
    expect(echeancesDeLApprobation(2026, null, '2027-02-30')).toEqual([])
    expect(echeancesDeLApprobation(2026, decision({ dateDecision: '15/05/2027' }), '2027-05-20')).toEqual([])
  })

  it('au jour de Paris : le 30 juin à 22h30 UTC, c’est déjà le 1er juillet à Paris, le délai est passé', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2027-06-30T22:30:00Z'))
    expect(echeancesDeLApprobation(2026, null, aujourdHuiAParis())[0].etat).toBe('passe')
    vi.setSystemTime(new Date('2027-06-30T21:30:00Z'))
    expect(echeancesDeLApprobation(2026, null, aujourdHuiAParis())[0].etat).toBe('a_venir')
  })
})
