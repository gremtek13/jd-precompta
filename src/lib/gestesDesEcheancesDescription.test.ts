import { describe, expect, it } from 'vitest'
import {
  descriptionReunie, jugerLaModification, lireLaSaisie, lueAvecSaDescription, refusDeLaReunion, saisieDe, valeursReunies,
  type ContexteDesGestes,
} from './gestesDesEcheances'
import { PLAN_PAR_DEFAUT } from './planComptable'
import { cotisation } from '../test/cotisationsGestes'

// L'ORGANISME, L'ANNÉE PAYÉE ET LA NATURE DANS « MODIFIER » ET « RÉUNIR » (ligne 27, TNS-Q2) : les règles suivent les
// colonnes LUES — absentes de la lecture (la migration pas appliquée), elles ne s'écrivent ni ne se retiennent.
const contexte: ContexteDesGestes = {
  mode: 'tresorerie', plan: PLAN_PAR_DEFAUT, mouvementDe: () => null, figee: () => null, dateFigee: () => null, ecritures: [],
}
const decrite = cotisation({ organisme: 'urssaf', annee_payee: 2026, nature: 'provisionnelle', montant_csg_crds: 300 })

describe('la saisie de « Modifier »', () => {
  it('sans le drapeau (le défaut), aucune description ; avec, celle de la ligne lue ; jamais sur une ligne lue sans les colonnes', () => {
    expect(saisieDe(decrite).description).toBeUndefined()
    expect(saisieDe(decrite, true).description).toEqual({ organisme: 'urssaf', annee: '2026', nature: 'provisionnelle' })
    expect(saisieDe(cotisation(), true).description).toBeUndefined()
    expect(lueAvecSaDescription(cotisation())).toBe(false)
  })
  it('la description se lit avec la saisie, et ses refus sont ceux des contraintes', () => {
    const s = saisieDe(decrite, true)
    expect(lireLaSaisie({ ...s, description: { organisme: 'carmf', annee: '2026', nature: 'acompte' } }))
      .toMatchObject({ valeurs: { organisme: 'carmf', annee_payee: 2026, nature: 'acompte', montant_appele: 800 } })
    expect(lireLaSaisie({ ...s, description: { organisme: 'urssaf', annee: '2027', nature: 'regularisation' } }))
      .toEqual({ refus: { message: 'Une régularisation de 2027 ne s’appelle pas en 2026 : elle suit son année.' } })
  })
  it('changer la seule description est un changement, et il se dit', () => {
    const j = jugerLaModification(decrite, { ...saisieDe(decrite, true), description: { organisme: 'urssaf', annee: '2025', nature: 'regularisation' } }, contexte)
    if ('refus' in j) throw new Error(j.refus.message)
    expect(j.effets).toContain('Elle se dit désormais : Urssaf, régularisation, 2025 — l’estimation de la régularisation la lit ainsi.')
    const rien = jugerLaModification(decrite, saisieDe(decrite, true), contexte)
    expect('refus' in rien && rien.refus.message).toBe('Rien n’a changé.')
  })
})

describe('« Réunir »', () => {
  const autre = (o: Parameters<typeof cotisation>[0]) => cotisation({ id: 'cot-2', echeance: '2026-03-20', montant_appele: 162, montant_csg_crds: 60, ...o })
  it('deux organismes dits et différents ne se réunissent pas', () => {
    expect(refusDeLaReunion(decrite, autre({ organisme: 'carpimko', annee_payee: 2026, nature: 'provisionnelle' }), contexte))
      .toBe('Ces deux échéances ne viennent pas du même organisme (Urssaf, CARPIMKO) : un prélèvement n’en paie qu’un.')
    expect(refusDeLaReunion(decrite, autre({ organisme: 'urssaf', annee_payee: 2025, nature: 'regularisation' }), contexte)).toBeNull()
  })
  it('la réunie ne garde que ce que les deux disent à l’identique : une provisionnelle et une régularisation, mêlées', () => {
    expect(descriptionReunie(decrite, autre({ organisme: 'urssaf', annee_payee: 2025, nature: 'regularisation' })))
      .toEqual({ organisme: 'urssaf', annee_payee: null, nature: null })
    expect(valeursReunies(decrite, autre({ organisme: 'urssaf', annee_payee: 2026, nature: 'provisionnelle' })))
      .toMatchObject({ montant_appele: 962, organisme: 'urssaf', annee_payee: 2026, nature: 'provisionnelle' })
  })
  it('lue sans les colonnes, la réunion n’en écrit aucune', () => {
    expect(descriptionReunie(cotisation(), autre({}))).toEqual({})
    expect(Object.keys(valeursReunies(cotisation(), autre({})))).toEqual(['echeance', 'montant_appele', 'montant_verse', 'montant_csg_crds', 'previsionnel'])
  })
})
