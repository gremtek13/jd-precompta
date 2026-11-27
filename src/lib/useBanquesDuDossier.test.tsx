import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompteDuReleve, LectureDesComptes } from './importParCompte'
import { memeLectureDesComptes } from './importParCompte'
import { PLAN_PAR_DEFAUT } from './planComptable'
import { banqueDuMouvement } from './banqueDuMouvement'

// LA LECTURE DES COMPTES SUIT CELLE DU RELEVÉ (relecture adverse du 27/11/2026) : lus une seule fois au montage, les comptes
// ne connaissaient pas un compte créé ailleurs ensuite, et un mouvement de ce compte, relu avec le relevé, s'écrivait au 512
// du rôle. `relire()` refait la lecture ; une relecture égale garde l'objet d'hier.

const lectures = vi.hoisted(() => ({ suite: [] as LectureDesComptes[], appels: 0 }))
vi.mock('./comptesBancairesLecture', () => ({
  lireLesComptesDuDossier: vi.fn(async () => {
    const l = lectures.suite[Math.min(lectures.appels, lectures.suite.length - 1)]
    lectures.appels += 1
    return l
  }),
}))

const { useBanquesDuDossier } = await import('./useBanquesDuDossier')

const compte = (c: Partial<CompteDuReleve> & Pick<CompteDuReleve, 'id'>): CompteDuReleve => ({
  libelle: 'Compte', principal: false, fin_d_identifiant: null, compte: null, compte_propre_depuis: null, ouvert_le: null, clos_le: null, ...c,
})
const PRINCIPAL = compte({ id: 'cp', libelle: 'Compte courant', principal: true })
const LIVRET = compte({ id: 'cl', libelle: 'Livret', compte: '512200', compte_propre_depuis: '2026-01-01' })

beforeEach(() => { lectures.suite = []; lectures.appels = 0 })

describe('useBanquesDuDossier relit les comptes avec le relevé', () => {
  it('un compte créé ailleurs après le montage : refusé avant la relecture, à son 512 après', async () => {
    lectures.suite = [{ etat: 'lus', comptes: [PRINCIPAL] }, { etat: 'lus', comptes: [PRINCIPAL, LIVRET] }]
    const { result } = renderHook(() => useBanquesDuDossier('d1', PLAN_PAR_DEFAUT))
    await waitFor(() => expect(result.current.lecture.etat).toBe('lus'))
    const duLivret = { date: '2026-03-05', compte_bancaire_id: 'cl' }
    // Le relevé relu porte déjà un mouvement du livret ; les comptes lus au montage ne le connaissent pas : refusé, jamais
    // le 512 du rôle.
    expect(banqueDuMouvement(duLivret, result.current.banques)).toHaveProperty('refus')
    act(() => { result.current.relireLesComptes() })
    await waitFor(() => expect(result.current.banques.cas).toBe('par_compte'))
    expect(banqueDuMouvement(duLivret, result.current.banques)).toEqual({ compte: '512200' })
    expect(lectures.appels).toBe(2)
  })

  it('une relecture qui rend les mêmes comptes garde l’objet d’hier (aucune boucle d’un écran qui dépend des banques)', async () => {
    lectures.suite = [{ etat: 'lus', comptes: [PRINCIPAL, LIVRET] }, { etat: 'lus', comptes: [{ ...PRINCIPAL }, { ...LIVRET }] }]
    const { result } = renderHook(() => useBanquesDuDossier('d1', PLAN_PAR_DEFAUT))
    await waitFor(() => expect(result.current.lecture.etat).toBe('lus'))
    const avant = result.current.banques
    act(() => { result.current.relireLesComptes() })
    await waitFor(() => expect(lectures.appels).toBe(2))
    expect(result.current.banques).toBe(avant)
  })
})

describe('memeLectureDesComptes', () => {
  it('compare l’état, le motif et chaque champ de chaque compte, dans l’ordre', () => {
    const lus: LectureDesComptes = { etat: 'lus', comptes: [PRINCIPAL, LIVRET] }
    expect(memeLectureDesComptes(lus, { etat: 'lus', comptes: [{ ...PRINCIPAL }, { ...LIVRET }] })).toBe(true)
    expect(memeLectureDesComptes(lus, { etat: 'lus', comptes: [PRINCIPAL] })).toBe(false)
    expect(memeLectureDesComptes(lus, { etat: 'lus', comptes: [LIVRET, PRINCIPAL] })).toBe(false)
    for (const champ of ['libelle', 'principal', 'fin_d_identifiant', 'compte', 'compte_propre_depuis', 'ouvert_le', 'clos_le'] as const) {
      const change = { ...LIVRET, [champ]: champ === 'principal' ? true : 'x' }
      expect(memeLectureDesComptes(lus, { etat: 'lus', comptes: [PRINCIPAL, change] }), champ).toBe(false)
    }
    expect(memeLectureDesComptes({ etat: 'illisible', motif: 'a' }, { etat: 'illisible', motif: 'b' })).toBe(false)
    expect(memeLectureDesComptes({ etat: 'en_cours' }, { etat: 'en_cours' })).toBe(true)
    expect(memeLectureDesComptes({ etat: 'en_cours' }, lus)).toBe(false)
  })
})
