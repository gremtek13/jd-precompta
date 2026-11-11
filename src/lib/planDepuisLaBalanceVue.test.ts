import { describe, expect, it } from 'vitest'
import type { LigneANouveau } from './aNouveaux'
import { planDepuisLaBalance } from './planDepuisLaBalance'
import {
  changementsDuPlan,
  confirmationDuReglage,
  etatDuPlanPropose,
  nomDuRole,
  phraseDesBanquesReunies,
} from './planDepuisLaBalanceVue'
import { PLAN_LU_PAR_DEFAUT } from '../test/modeles'

// Les mots et l'état de la carte de la balance quand la reprise propose le plan (PC6). La règle est celle du module
// (planDepuisLaBalance.test.ts) : ici, l'état que l'écran en tire et ce qu'il nomme.

const ligne = (compte: string, libelle: string, debit: number, credit: number) => ({ compte, libelle, debit, credit })
const DEUX_BANQUES = [ligne('5121', 'Banque A', 100, 0), ligne('5122', 'Banque B', 50, 0), ligne('108', 'Exploitant', 0, 150)]

describe('etatDuPlanPropose', () => {
  it('demande un choix tant qu’un rôle au choix n’en a pas, puis dit ce qui change', () => {
    const propositions = planDepuisLaBalance(DEUX_BANQUES, PLAN_LU_PAR_DEFAUT, [])
    expect(etatDuPlanPropose(propositions, {}, PLAN_LU_PAR_DEFAUT)).toEqual({ etat: 'a_choisir', roles: ['banque'] })
    const etat = etatDuPlanPropose(propositions, { banque: '512100' }, PLAN_LU_PAR_DEFAUT)
    expect(etat.etat).toBe('a_regler')
    if (etat.etat !== 'a_regler') return
    expect(etat.changements.map((c) => c.role)).toEqual(['banque', 'exploitant'])
    expect(confirmationDuReglage(etat.changements)).toContain('– Banque : 512000 « Banque » → 512100 « Banque A »')
  })

  it('garder le compte du plan (null) et refuser les propositions laissent le plan à jour', () => {
    const propositions = planDepuisLaBalance(DEUX_BANQUES, PLAN_LU_PAR_DEFAUT, [])
    expect(etatDuPlanPropose(propositions, { banque: null, exploitant: null }, PLAN_LU_PAR_DEFAUT)).toEqual({ etat: 'a_jour' })
  })

  it('dit le refus du module, à ses mots, sur un choix qui n’est pas un candidat', () => {
    const propositions = planDepuisLaBalance(DEUX_BANQUES, PLAN_LU_PAR_DEFAUT, [])
    const etat = etatDuPlanPropose(propositions, { banque: '512900' }, PLAN_LU_PAR_DEFAUT)
    expect(etat).toEqual({ etat: 'refus', refus: 'Le compte « 512900 » n’est pas l’un des comptes de la balance proposés pour le rôle « banque ».' })
  })
})

describe('changementsDuPlan', () => {
  it('un rôle absent revient au catalogue : rien ne change sous le plan par défaut', () => {
    expect(changementsDuPlan([], PLAN_LU_PAR_DEFAUT)).toEqual([])
    expect(nomDuRole('resultat_perte')).toBe('Résultat de l’exercice (perte)')
  })
})

describe('phraseDesBanquesReunies', () => {
  const an = (compte: string, compteOrigine: string, montant: number, sens: 'debit' | 'credit' = 'debit'): LigneANouveau =>
    ({ compte, compteOrigine, libelle: `Banque ${compteOrigine}`, sens, montant })

  it('se tait sans banque, dit une banque seule, et renvoie à la carte « Comptes bancaires » dès deux', () => {
    expect(phraseDesBanquesReunies([an('108000', '108', 10, 'credit')], '512000')).toBeNull()
    expect(phraseDesBanquesReunies([an('512000', '5121', 10)], '512000')).toBe('La banque de la balance (5121 Banque 5121) s’ouvre sur la banque du plan (512000).')
    const deux = phraseDesBanquesReunies([an('512000', '5121', 10), an('512000', '5122', 2.5, 'credit')], '512000')!
    expect(deux).toMatch(/^Les 2 comptes bancaires de la balance \(5121 Banque 5121, 5122 Banque 5122\) s’ouvrent réunis/)
    expect(deux).toContain('carte « Comptes bancaires »')
    expect(deux).toContain('7,50')
  })
})
