import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/ecrans'
import { PLAN_PAR_DEFAUT } from '../../lib/planComptable'
import type { LectureDeLaFiche } from '../../lib/ficheDesComptesBancairesLecture'
import type { CompteDuReleve } from '../../lib/importParCompte'

// LA CARTE « COMPTES BANCAIRES » (ligne 26.6, MCB6) : ce qu'aucun calcul pur ne voit — le drapeau `COMPTES_BANCAIRES_PREVUS`
// joué dans ses deux états par un accesseur (baissé, la carte ne rend ni ne lit rien), « Chargement… » avant la lecture,
// l'absence de tout geste sur une lecture illisible, le refus dit avant le clic, la confirmation qui nomme ce qui se fige, le
// verrou (deux clics du même `act`, un seul appel), la relecture après le geste, le champ figé. Données FICTIVES.

const etat = vi.hoisted(() => ({ prevue: false }))
const appels = vi.hoisted(() => ({ lire: vi.fn(), creer: vi.fn(), corriger: vi.fn() }))

vi.mock('../../lib/comptesBancaires', async (original) => {
  const reel = await original<typeof import('../../lib/comptesBancaires')>()
  return { ...reel, get COMPTES_BANCAIRES_PREVUS() { return etat.prevue } }
})
vi.mock('../../lib/ficheDesComptesBancairesLecture', () => ({
  lireLaFiche: appels.lire, creerLeCompte: appels.creer, corrigerLeCompte: appels.corriger,
}))

import ComptesBancairesCard from './ComptesBancairesCard'

const PRINCIPAL: CompteDuReleve = { id: 'cb-p', libelle: 'Compte principal', principal: true, fin_d_identifiant: null, compte: null, compte_propre_depuis: null, ouvert_le: null, clos_le: null }
const SECOND: CompteDuReleve = { id: 'cb-2', libelle: 'Compte pro 2', principal: false, fin_d_identifiant: '4567', compte: '512100', compte_propre_depuis: '2026-01-01', ouvert_le: '2025-03-01', clos_le: null }

function lue(comptes: CompteDuReleve[], dossierId = 'd1'): LectureDeLaFiche {
  return {
    dossierId, etat: 'lue', comptes,
    usages: new Map([['cb-p', { mouvements: 12, releves: 2, premiere: '2025-01-02', derniere: '2026-03-01' }], ['cb-2', { mouvements: 3, releves: 1, premiere: '2025-03-04', derniere: '2026-02-10' }]]),
  }
}

const monter = (dossierId = 'd1') => render(<ComptesBancairesCard dossierId={dossierId} plan={PLAN_PAR_DEFAUT} />)
const carte = () => screen.getByTestId('comptes-bancaires')
const bouton = (nom: string | RegExp) => within(carte()).getByRole('button', { name: nom }) as HTMLButtonElement

beforeEach(() => {
  etat.prevue = true
  appels.lire.mockReset().mockResolvedValue(lue([PRINCIPAL, SECOND]))
  appels.creer.mockReset().mockResolvedValue({ ok: true })
  appels.corriger.mockReset().mockResolvedValue({ ok: true })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => {
  etat.prevue = false
  vi.restoreAllMocks()
})

describe('le drapeau de la carte', () => {
  it('baissé : elle ne rend rien et ne lit rien (l’état d’avant)', () => {
    etat.prevue = false
    const { container } = monter()
    expect(container.querySelector('[data-testid="comptes-bancaires"]')).toBeNull()
    expect(appels.lire).not.toHaveBeenCalled()
  })

  it('levé : « Chargement… » avant la lecture, puis chaque compte, son 512 et ce que la base permet encore', async () => {
    let rendre: (l: LectureDeLaFiche) => void = () => {}
    appels.lire.mockReturnValue(new Promise<LectureDeLaFiche>((r) => { rendre = r }))
    monter()
    expect(within(carte()).getByText('Chargement…')).toBeDefined()
    expect(within(carte()).queryByRole('button')).toBeNull()
    await act(async () => { rendre(lue([PRINCIPAL, SECOND])) })
    const second = screen.getByTestId('compte-bancaire-cb-2')
    expect(second.textContent).toContain('au 512100 depuis le 01/01/2026 (avant, au 512000 du compte principal)')
    expect(second.textContent).toContain('Identifiant •••• 4567')
    expect(second.textContent).toContain('son compte du plan et la date depuis laquelle il le tient ne changent plus')
    expect(screen.getByTestId('compte-bancaire-cb-p').textContent).toContain('au 512000, le compte de banque du plan')
  })
})

describe('une lecture illisible', () => {
  it('se dit, et n’offre aucun geste', async () => {
    appels.lire.mockResolvedValue({ dossierId: 'd1', etat: 'illisible', motif: 'les mouvements du relevé : lecture incomplète' })
    monter()
    expect((await within(carte()).findByRole('alert')).textContent).toContain('les mouvements du relevé : lecture incomplète')
    expect(within(carte()).queryByRole('button')).toBeNull()
  })
})

describe('créer un compte', () => {
  it('le refus se dit avant le clic ; la confirmation nomme ce qui se figera ; un seul appel pour deux clics ; la relecture suit', async () => {
    monter()
    fireEvent.click(await within(carte()).findByRole('button', { name: 'Ajouter un compte bancaire' }))
    expect((screen.getByLabelText(/^Son compte du plan/) as HTMLInputElement).value).toBe('512200')
    expect((screen.getByLabelText(/^Nom du compte \(le client qui porte la case « Banque » le lit\)$/) as HTMLInputElement).value).toBe('')
    fireEvent.change(screen.getByLabelText(/^Nom du compte/), { target: { value: 'Compte pro 3' } })
    // Sans date d'ouverture, le refus de l'application se dit, et rien ne part.
    expect(within(carte()).getByRole('status').textContent).toMatch(/^La date d’ouverture du compte se donne à sa création/)
    expect(bouton('Créer le compte').disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Ouvert le'), { target: { value: '2026-02-01' } })
    fireEvent.change(screen.getByLabelText(/^Qu’il tient depuis/), { target: { value: '2025' } })
    expect(within(carte()).getByRole('status').textContent).toMatch(/^Un compte bancaire tient son propre compte du plan depuis le 1er janvier 2026 au plus tôt/)
    fireEvent.change(screen.getByLabelText(/^Qu’il tient depuis/), { target: { value: '2026' } })
    expect(bouton('Créer le compte').disabled).toBe(false)
    appels.lire.mockClear()
    await act(async () => {
      fireEvent.click(bouton('Créer le compte'))
      fireEvent.click(bouton('Créer le compte'))
    })
    await waitFor(() => expect(appels.lire).toHaveBeenCalledTimes(1))
    expect(appels.creer).toHaveBeenCalledTimes(1)
    expect(appels.creer).toHaveBeenCalledWith('d1', {
      libelle: 'Compte pro 3', principal: false, compte: '512200', compte_propre_depuis: '2026-01-01', ouvert_le: '2026-02-01', clos_le: null, fin_d_identifiant: null,
    })
    expect(vi.mocked(window.confirm).mock.calls[0][0]).toMatch(/Son compte du plan et cette date se figeront à son premier mouvement ou relevé/)
    expect(within(carte()).getByText('Le compte « Compte pro 3 » est créé ✓')).toBeDefined()
  })

  it('un dossier sans compte crée son principal, sans compte du plan à saisir', async () => {
    appels.lire.mockResolvedValue(lue([]))
    monter()
    fireEvent.click(await within(carte()).findByRole('button', { name: 'Créer le compte principal' }))
    expect(screen.queryByLabelText(/^Son compte du plan/)).toBeNull()
    fireEvent.change(screen.getByLabelText('Ouvert le'), { target: { value: '2024-06-01' } })
    await act(async () => { fireEvent.click(bouton('Créer le compte')) })
    expect(appels.creer).toHaveBeenCalledWith('d1', expect.objectContaining({ principal: true, compte: null, compte_propre_depuis: null, libelle: 'Compte principal' }))
  })

  it('un refus de la base se dit, et rien n’est annoncé comme fait', async () => {
    appels.creer.mockResolvedValue({ ok: false, message: 'refus de la base' })
    monter()
    fireEvent.click(await within(carte()).findByRole('button', { name: 'Ajouter un compte bancaire' }))
    fireEvent.change(screen.getByLabelText(/^Nom du compte/), { target: { value: 'Compte pro 3' } })
    fireEvent.change(screen.getByLabelText('Ouvert le'), { target: { value: '2026-02-01' } })
    await act(async () => { fireEvent.click(bouton('Créer le compte')) })
    expect(within(carte()).getByText('Rien n’a changé : refus de la base')).toBeDefined()
  })
})

describe('corriger un compte', () => {
  it('un compte qui porte des mouvements : son compte et sa date se figent à l’écran, sa fin d’identifiant se corrige', async () => {
    monter()
    fireEvent.click(await within(carte()).findByRole('button', { name: 'Corriger « Compte pro 2 »' }))
    expect((screen.getByLabelText(/^Son compte du plan/) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText(/^Qu’il tient depuis/) as HTMLInputElement).disabled).toBe(true)
    expect(bouton('Enregistrer la correction').disabled).toBe(true)
    expect(within(carte()).getByRole('status').textContent).toBe('Rien n’est changé.')
    fireEvent.change(screen.getByLabelText(/^Fin de l’identifiant/), { target: { value: '9876' } })
    await act(async () => { fireEvent.click(bouton('Enregistrer la correction')) })
    expect(vi.mocked(window.confirm).mock.calls[0][0]).toBe('Corriger la fin de l’identifiant du compte « Compte pro 2 » ?')
    expect(appels.corriger).toHaveBeenCalledWith('d1', 'cb-2', expect.objectContaining({ fin_d_identifiant: '9876', compte: '512100', compte_propre_depuis: '2026-01-01' }))
  })

  it('une confirmation refusée n’écrit rien', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    monter()
    fireEvent.click(await within(carte()).findByRole('button', { name: 'Corriger « Compte principal »' }))
    fireEvent.change(screen.getByLabelText(/^Nom du compte/), { target: { value: 'Compte courant' } })
    await act(async () => { fireEvent.click(bouton('Enregistrer la correction')) })
    expect(appels.corriger).not.toHaveBeenCalled()
  })
})
