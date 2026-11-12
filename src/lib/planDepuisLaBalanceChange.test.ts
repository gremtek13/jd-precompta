import { afterEach, describe, expect, it, vi } from 'vitest'
import { PLAN_PAR_DEFAUT, type PlanComptable } from './planComptable'
import { planDepuisLaBalance, planRetenu, rolesDuPlanLu, type PlanLu } from './planDepuisLaBalance'
import { changementsDuPlan, etatDuPlanPropose } from './planDepuisLaBalanceVue'
import { LIBELLES_PAR_DEFAUT, PREFIXES_PAR_DEFAUT } from '../test/modeles'
import { ROLES_DU_CHANGE } from './rolesDuChange'

// LES RÔLES DU CHANGE DANS LA REPRISE QUI PROPOSE LE PLAN (PC6 ; ligne 31 ; HISTORIQUE.md, « 12/11/2026 — LES RÔLES DU
// CHANGE DANS TOUS LES LECTEURS DU PLAN »). `regler_plan_du_dossier` remet au catalogue tout rôle absent de sa liste
// (supabase/schema/20261110143003_regler_le_plan_du_dossier.sql : `delete from public.plan_comptable_dossier`, puis
// l'insertion de la liste) : la reprise qui ne parcourait que `ROLES_COMPTABLES` renvoyait le 666000 d'un dossier au
// 656000 sans que la confirmation le dise. Le drapeau joué par un accesseur, ses deux états.

const drapeauDuChange = vi.hoisted(() => ({ leve: undefined as boolean | undefined }))
vi.mock('./rolesDuChange', async (original) => {
  const vrai = await original<typeof import('./rolesDuChange')>()
  return { ...vrai, get ECARTS_DE_REGLEMENT_PREVUS() { return drapeauDuChange.leve ?? vrai.ECARTS_DE_REGLEMENT_PREVUS } }
})
afterEach(() => { drapeauDuChange.leve = undefined })

const ligne = (compte: string, libelle: string, debit: number, credit: number) => ({ compte, libelle, debit, credit })

/** Le plan lu tel que `planDeLaReponse` le rend le drapeau levé : les deux comptes du change en plus, `pertes` choisi. */
const planLuAvecLeChange = (pertes: string): PlanLu => ({
  plan: { ...PLAN_PAR_DEFAUT, pertes_de_change: pertes, gains_de_change: '756000' } as PlanComptable,
  libelles: { ...LIBELLES_PAR_DEFAUT, pertes_de_change: ROLES_DU_CHANGE[0].libelleDefaut, gains_de_change: ROLES_DU_CHANGE[1].libelleDefaut },
  prefixes: PREFIXES_PAR_DEFAUT,
})

const BALANCE_AU_666 = [ligne('512', 'Banque', 100, 0), ligne('6660', 'Pertes de change', 20, 0), ligne('108', 'Exploitant', 0, 120)]

describe('la reprise qui propose le plan et les rôles du change', () => {
  it('le drapeau levé : un compte de la balance sous 656/666 se propose, part au clic et se nomme', () => {
    drapeauDuChange.leve = true
    const lu = planLuAvecLeChange('656000')
    const propositions = planDepuisLaBalance(BALANCE_AU_666, lu, [])
    expect(propositions.map((p) => p.role)).toContain('pertes_de_change')
    expect(propositions.find((p) => p.role === 'pertes_de_change')).toMatchObject({ etat: 'propose', change: true, candidat: { compte: '666000' } })
    expect(propositions.find((p) => p.role === 'gains_de_change')).toMatchObject({ etat: 'reste' })
    const retenu = planRetenu(propositions, {}, lu)
    expect(retenu.comptes).toContainEqual({ role: 'pertes_de_change', compte: '666000', libelle: 'Pertes de change', prefixe_auxiliaire: null })
    const etat = etatDuPlanPropose(propositions, {}, lu)
    expect(etat.etat === 'a_regler' && etat.changements.map((c) => c.role)).toEqual(['exploitant', 'pertes_de_change'])
  })

  it('le drapeau levé : un compte du change que le dossier règle déjà part avec le plan, jamais remis au catalogue en silence', () => {
    drapeauDuChange.leve = true
    const lu = planLuAvecLeChange('666000')
    const propositions = planDepuisLaBalance([ligne('512', 'Banque', 100, 0)], lu, [])
    // Le défaut d'hier : la liste envoyée ne portait pas le rôle, et la base le remettait au 656000.
    expect(planRetenu(propositions, {}, lu).comptes).toEqual([{ role: 'pertes_de_change', compte: '666000', libelle: null, prefixe_auxiliaire: null }])
    expect(etatDuPlanPropose(propositions, {}, lu)).toEqual({ etat: 'a_jour' })
    // Et la confirmation dit le retour au catalogue d'un rôle que la liste n'envoie pas.
    expect(changementsDuPlan([], lu)).toEqual([{
      role: 'pertes_de_change',
      avant: { compte: '666000', libelle: ROLES_DU_CHANGE[0].libelleDefaut },
      apres: { compte: '656000', libelle: ROLES_DU_CHANGE[0].libelleDefaut },
    }])
  })

  it('le drapeau baissé : les rôles du change ne sont ni proposés, ni envoyés, ni comparés', () => {
    drapeauDuChange.leve = false
    const lu = planLuAvecLeChange('666000')
    expect(rolesDuPlanLu(lu)).toHaveLength(32)
    const propositions = planDepuisLaBalance(BALANCE_AU_666, lu, [])
    expect(propositions.map((p) => p.role)).not.toContain('pertes_de_change')
    expect(planRetenu(propositions, {}, lu).comptes?.map((c) => c.role)).toEqual(['exploitant'])
    expect(changementsDuPlan([], lu)).toEqual([])
  })

  it('le drapeau levé, un plan lu qui ne les porte pas (d’avant le drapeau) : rien d’inventé', () => {
    drapeauDuChange.leve = true
    const lu: PlanLu = { plan: PLAN_PAR_DEFAUT, libelles: LIBELLES_PAR_DEFAUT, prefixes: PREFIXES_PAR_DEFAUT }
    expect(rolesDuPlanLu(lu)).toHaveLength(32)
    expect(rolesDuPlanLu(planLuAvecLeChange('656000'))).toHaveLength(34)
    expect(planDepuisLaBalance(BALANCE_AU_666, lu, []).map((p) => p.role)).not.toContain('pertes_de_change')
  })
})
