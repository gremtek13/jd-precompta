import { describe, expect, it } from 'vitest'
import {
  confirmationDeLaReunion, descriptionReunie, jugerLaModification, lireLaSaisie, lueAvecSaDescription, refusDeLaReunion,
  refusDuPaiementPersonnel, saisieDe, valeursReunies, type ContexteDesGestes,
} from './gestesDesEcheances'
import { formatMoney } from './format'
import { PLAN_PAR_DEFAUT } from './planComptable'
import { cotisation } from '../test/cotisationsGestes'
import type { CotisationDeclaree } from './types'

// L'ORGANISME, L'ANNÉE PAYÉE ET LA NATURE DANS « MODIFIER » ET « RÉUNIR » (ligne 27, TNS-Q2) : les règles suivent les
// colonnes LUES — absentes de la lecture (la migration pas appliquée), elles ne s'écrivent ni ne se retiennent.
const contexte: ContexteDesGestes = {
  mode: 'tresorerie', plan: PLAN_PAR_DEFAUT, mouvementDe: () => null, figee: () => null, dateFigee: () => null, ecritures: [],
}
const decrite = cotisation({ organisme: 'urssaf', annee_payee: 2026, nature: 'provisionnelle', part_regularisation: null, montant_csg_crds: 300 })

describe('la saisie de « Modifier »', () => {
  it('sans le drapeau (le défaut), aucune description ; avec, celle de la ligne lue ; jamais sur une ligne lue sans les colonnes', () => {
    expect(saisieDe(decrite).description).toBeUndefined()
    expect(saisieDe(decrite, true).description).toEqual({ organisme: 'urssaf', annee: '2026', nature: 'provisionnelle', part: '' })
    // Les trois colonnes sans la quatrième : une lecture qui n'est pas celle de la migration, rien ne s'écrit.
    expect(lueAvecSaDescription(cotisation({ organisme: 'urssaf', annee_payee: 2026, nature: 'provisionnelle' }))).toBe(false)
    expect(saisieDe(cotisation(), true).description).toBeUndefined()
    expect(lueAvecSaDescription(cotisation())).toBe(false)
  })
  it('la description se lit avec la saisie, et ses refus sont ceux des contraintes', () => {
    const s = saisieDe(decrite, true)
    expect(lireLaSaisie({ ...s, description: { organisme: 'carmf', annee: '2026', nature: 'acompte', part: '' } }))
      .toMatchObject({ valeurs: { organisme: 'carmf', annee_payee: 2026, nature: 'acompte', montant_appele: 800 } })
    expect(lireLaSaisie({ ...s, description: { organisme: 'urssaf', annee: '2027', nature: 'regularisation', part: '' } }))
      .toEqual({ refus: { message: 'Une régularisation de 2027 ne s’appelle pas en 2026 : elle suit son année.' } })
    // La part se borne sous le montant appelé TEL QU'IL PARTIRAIT : 900 dépasse 800, mais pas 950 tapés avec elle.
    expect(lireLaSaisie({ ...s, description: { ...s.description!, part: '900' } }))
      .toEqual({ refus: { message: `La part de régularisation (${formatMoney(900)}) dépasse le montant appelé (${formatMoney(800)}) : elle n’en est qu’une part.` } })
    expect(lireLaSaisie({ ...s, appele: '950', description: { ...s.description!, part: '900' } }))
      .toMatchObject({ valeurs: { montant_appele: 950, part_regularisation: 900 } })
  })
  it('changer la seule description est un changement, et il se dit', () => {
    const j = jugerLaModification(decrite, { ...saisieDe(decrite, true), description: { organisme: 'urssaf', annee: '2025', nature: 'regularisation', part: '' } }, contexte)
    if ('refus' in j) throw new Error(j.refus.message)
    expect(j.effets).toContain('Elle se dit désormais : Urssaf, régularisation, 2025 — l’estimation de la régularisation la lit ainsi.')
    const rien = jugerLaModification(decrite, saisieDe(decrite, true), contexte)
    expect('refus' in rien && rien.refus.message).toBe('Rien n’a changé.')
  })
})

describe('« Modifier » sur une échéance figée ou payée depuis le compte personnel : sa description seule', () => {
  const figee: ContexteDesGestes = { ...contexte, figee: () => 'L\'exercice 2026 est validé' }
  const decrire = (c: typeof decrite, o: Partial<{ organisme: string; annee: string; nature: string; part: string }>) =>
    ({ ...saisieDe(c, true), description: { ...saisieDe(c, true).description!, ...o } })
  it('figée : la description change, ses montants et sa date tels qu’ils sont, sans réécriture', () => {
    const j = jugerLaModification(decrite, decrire(decrite, { annee: '2025', nature: 'regularisation' }), figee)
    if ('refus' in j) throw new Error(j.refus.message)
    expect(j.valeurs).toEqual({ echeance: '2026-03-20', montant_appele: 800, montant_verse: null, montant_csg_crds: 300, previsionnel: false,
      organisme: 'urssaf', annee_payee: 2025, nature: 'regularisation', part_regularisation: null })
    expect(j.effets).toEqual([
      'L\'exercice 2026 est validé : ses montants et sa date restent figés ; sa description seule change, que ni la 2035 ni l’exercice validé ne lisent.',
      'Elle se dit désormais : Urssaf, régularisation, 2025 — l’estimation de la régularisation la lit ainsi.',
    ])
    expect(j.reecriture).toBeNull()
  })
  it('figée : tout autre changement garde les mots de la base, même avec la description ; sans elle, le refus d’hier', () => {
    const refus = 'L\'exercice 2026 est validé : cette échéance ne change plus.'
    const montant = { ...decrire(decrite, { nature: 'acompte' }), appele: '801' }
    expect(jugerLaModification(decrite, montant, figee)).toEqual({ refus: { message: refus } })
    expect(jugerLaModification(decrite, { ...decrire(decrite, {}), echeance: '2026-03-21' }, figee)).toEqual({ refus: { message: refus } })
    expect(jugerLaModification(decrite, { ...decrire(decrite, {}), previsionnel: true }, figee)).toEqual({ refus: { message: refus } })
    // Le drapeau baissé (la saisie sans description) : rien ne change, même sans rien d'autre de changé.
    expect(jugerLaModification(decrite, saisieDe(decrite), figee)).toEqual({ refus: { message: refus } })
    expect(jugerLaModification(decrite, decrire(decrite, {}), figee)).toEqual({ refus: { message: 'Rien n’a changé.', discret: true } })
    expect(jugerLaModification(decrite, decrire(decrite, { annee: '2028' }), figee))
      .toEqual({ refus: { message: 'L’année payée d’une échéance de 2026 va de 2021 à 2027.' } })
  })
  it('figée : sa part se dit encore, sous le montant appelé qu’elle garde ; la même part, lue « 150.00 », n’est pas un changement', () => {
    const j = jugerLaModification(decrite, decrire(decrite, { part: '150' }), figee)
    if ('refus' in j) throw new Error(j.refus.message)
    expect(j.valeurs).toMatchObject({ montant_appele: 800, part_regularisation: 150 })
    expect(j.effets[1]).toBe(`Elle se dit désormais : Urssaf, provisionnelle, 2026, dont ${formatMoney(150)} de régularisation de 2025 — l’estimation de la régularisation la lit ainsi.`)
    expect(jugerLaModification(decrite, decrire(decrite, { part: '800.01' }), figee))
      .toEqual({ refus: { message: `La part de régularisation (${formatMoney(800.01)}) dépasse le montant appelé (${formatMoney(800)}) : elle n’en est qu’une part.` } })
    const avecPart = { ...decrite, part_regularisation: 150 }
    expect(jugerLaModification(avecPart, decrire(avecPart, { part: '150.00' }), figee)).toEqual({ refus: { message: 'Rien n’a changé.', discret: true } })
    // Une part sur une régularisation se refuse, aux mots de la contrainte de nature.
    expect(jugerLaModification(decrite, decrire(decrite, { nature: 'regularisation', annee: '2025', part: '10' }), figee))
      .toEqual({ refus: { message: 'La part de régularisation ne se dit que d’une provisionnelle ou d’un acompte : choisis sa nature.' } })
  })
  it('payée depuis le compte personnel : la description change, ses montants non', () => {
    const payee = { ...decrite, paiement_personnel_le: '2026-04-10' }
    const j = jugerLaModification(payee, decrire(payee, { organisme: 'carpimko' }), contexte)
    if ('refus' in j) throw new Error(j.refus.message)
    expect(j.valeurs).toMatchObject({ montant_appele: 800, montant_csg_crds: 300, organisme: 'carpimko' })
    expect(j.effets[0]).toBe('Elle est payée depuis le compte personnel, le 10/04/2026 : ses montants et sa date restent ceux de ce paiement ; sa description seule change, que son écriture ne lit pas.')
    expect(jugerLaModification(payee, { ...decrire(payee, { organisme: 'carpimko' }), csg: '0' }, contexte))
      .toEqual({ refus: { message: `${refusDuPaiementPersonnel('2026-04-10')} Retire d’abord ce paiement.` } })
  })
})

describe('« Réunir »', () => {
  // Une échéance dite par son organisme est lue avec les quatre colonnes (la part nulle, sauf dite) ; `autre({})`, sans elles.
  const autre = (o: Partial<CotisationDeclaree>) =>
    cotisation({ id: 'cot-2', echeance: '2026-03-20', montant_appele: 162, montant_csg_crds: 60, ...('organisme' in o ? { part_regularisation: null } : {}), ...o })
  it('deux organismes dits et différents ne se réunissent pas', () => {
    expect(refusDeLaReunion(decrite, autre({ organisme: 'carpimko', annee_payee: 2026, nature: 'provisionnelle' }), contexte))
      .toBe('Ces deux échéances ne viennent pas du même organisme (Urssaf, CARPIMKO) : un prélèvement n’en paie qu’un.')
    expect(refusDeLaReunion(decrite, autre({ organisme: 'urssaf', annee_payee: 2025, nature: 'regularisation' }), contexte)).toBeNull()
  })
  it('la réunie ne garde que ce que les deux disent à l’identique : une provisionnelle et une régularisation, mêlées', () => {
    expect(descriptionReunie(decrite, autre({ organisme: 'urssaf', annee_payee: 2025, nature: 'regularisation' })))
      .toEqual({ organisme: 'urssaf', annee_payee: null, nature: null, part_regularisation: null })
    expect(valeursReunies(decrite, autre({ organisme: 'urssaf', annee_payee: 2026, nature: 'provisionnelle' })))
      .toMatchObject({ montant_appele: 962, organisme: 'urssaf', annee_payee: 2026, nature: 'provisionnelle' })
  })
  it('la confirmation nomme la description que perd la gardée, et l’organisme que les deux disent', () => {
    const regularisation = autre({ organisme: 'urssaf', annee_payee: 2025, nature: 'regularisation' })
    expect(confirmationDeLaReunion(decrite, regularisation, null)).toBe(
      `L’échéance du 20/03/2026 est gardée, à sa date, et portée à ${formatMoney(962)} appelés, dont ${formatMoney(360)} de CSG-CRDS. `
      + 'Sa description « Urssaf, provisionnelle, 2026 » devient « Urssaf » : seul reste ce que les deux disent à l’identique. '
      + `Celle du 20/03/2026 (${formatMoney(162)} appelés, dont ${formatMoney(60)} de CSG-CRDS) est retirée : aucun mouvement ne la paie. `
      + 'Toutes deux disent Urssaf : ne les réunis que si un même prélèvement les paie.',
    )
    // Une description commune ne perd rien, et ne se nomme pas ; un organisme non dit garde l'avertissement d'hier.
    const pareille = confirmationDeLaReunion(decrite, autre({ organisme: 'urssaf', annee_payee: 2026, nature: 'provisionnelle' }), null)
    expect(pareille).not.toContain('Sa description')
    expect(confirmationDeLaReunion(decrite, autre({ organisme: null, annee_payee: null, nature: null }), null))
      .toContain('Sa description « Urssaf, provisionnelle, 2026 » devient « non décrite »')
    expect(confirmationDeLaReunion(cotisation(), autre({}), null)).toContain('l’application ne connaît pas l’organisme d’une échéance.')
  })
  it('la part (TNS-Q2-B) : la somme des deux sous une nature et une année communes ; perdue sinon, et nommée', () => {
    const avecPart = { ...decrite, montant_appele: 550, part_regularisation: 150 }
    // Deux provisionnelles de 2026 : la part de l'une reste ce que le prélèvement porte de 2025.
    expect(valeursReunies(avecPart, autre({ organisme: 'urssaf', annee_payee: 2026, nature: 'provisionnelle' })))
      .toMatchObject({ montant_appele: 712, nature: 'provisionnelle', annee_payee: 2026, part_regularisation: 150 })
    expect(valeursReunies(avecPart, autre({ organisme: 'urssaf', annee_payee: 2026, nature: 'provisionnelle', part_regularisation: -150 })))
      .toMatchObject({ part_regularisation: null })
    // Une provisionnelle portant sa part et une régularisation : mêlées, la part se perd avec la description, et se nomme.
    expect(confirmationDeLaReunion(avecPart, autre({ organisme: 'urssaf', annee_payee: 2025, nature: 'regularisation' }), null))
      .toContain(`Sa description « Urssaf, provisionnelle, 2026, dont ${formatMoney(150)} de régularisation de 2025 » devient « Urssaf » : seul reste ce que les deux disent à l’identique.`)
    // La part de la retirée, perdue avec elle, se nomme aussi.
    const retiree = autre({ organisme: 'urssaf', annee_payee: 2027, nature: 'provisionnelle', part_regularisation: 40 })
    expect(confirmationDeLaReunion(decrite, retiree, null))
      .toContain(`La part de celle du 20/03/2026 (« dont ${formatMoney(40)} de régularisation de 2026 ») ne se garde pas : l’échéance réunie n’en porte aucune.`)
  })
  it('lue sans les colonnes, la réunion n’en écrit aucune', () => {
    expect(descriptionReunie(cotisation(), autre({}))).toEqual({})
    expect(Object.keys(valeursReunies(cotisation(), autre({})))).toEqual(['echeance', 'montant_appele', 'montant_verse', 'montant_csg_crds', 'previsionnel'])
  })
})
