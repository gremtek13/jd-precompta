import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../test/ecrans'

// L'écran du cabinet de la double authentification exigée (C7, second temps) : le drapeau baissé, rien ne se rend ni ne se
// lit (l'état d'avant) ; levé, la liste lue en entier, un geste confirmé qui nomme le compte, sous un verrou, relu après.

const etat = vi.hoisted(() => ({ exporte: false }))
const appels = vi.hoisted(() => ({ lireLesComptes: vi.fn(), agirSurLeCompte: vi.fn() }))
vi.mock('../lib/deuxFacteursExiges', async (original) => {
  const m = await original<typeof import('../lib/deuxFacteursExiges')>()
  return { ...m, get DEUX_FACTEURS_EXIGES_EXPORTE() { return etat.exporte } }
})
vi.mock('../lib/deuxFacteursExigesAppels', () => appels)

import DeuxFacteursDesComptes from './DeuxFacteursDesComptes'

const LIGNE = {
  userId: 'u-membre', email: 'membre@essai.invalid', genre: 'membre' as const, aUnFacteur: true, exigeeDepuis: null,
  dernierRetrait: null, peutExiger: true, peutLever: true, peutRetirer: true,
}

beforeEach(() => {
  appels.lireLesComptes.mockReset()
  appels.agirSurLeCompte.mockReset()
})
afterEach(() => { etat.exporte = false })

describe('DeuxFacteursDesComptes', () => {
  it('drapeau baissé : il ne rend rien et ne lit rien (l’état d’avant)', () => {
    const { container } = render(<DeuxFacteursDesComptes perimetre={{ genre: 'equipe', cabinetId: 'cab' }} />)
    expect(container.innerHTML).toBe('')
    expect(appels.lireLesComptes).not.toHaveBeenCalled()
  })

  it('drapeau levé : rien avant la lecture, puis les comptes et leurs gestes', async () => {
    etat.exporte = true
    let rendre: (v: unknown) => void = () => {}
    appels.lireLesComptes.mockReturnValue(new Promise((r) => { rendre = r }))
    render(<DeuxFacteursDesComptes perimetre={{ genre: 'equipe', cabinetId: 'cab' }} />)
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    await act(async () => { rendre({ ok: true, valeur: [LIGNE] }) })
    expect(appels.lireLesComptes).toHaveBeenCalledWith({ genre: 'equipe', cabinetId: 'cab' })
    expect(screen.getByText('membre@essai.invalid')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Exiger' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retirer le second facteur (appareil perdu)' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Ne plus exiger' })).toBeNull()
  })

  it('illisible : il le dit et n’offre aucun geste', async () => {
    etat.exporte = true
    appels.lireLesComptes.mockResolvedValue({ ok: false, message: 'la base a rendu une ligne d’une autre forme.' })
    render(<DeuxFacteursDesComptes perimetre={{ genre: 'acces', dossierId: 'd1' }} />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('un geste se confirme en nommant le compte, part une fois sous son verrou, et relit la liste', async () => {
    etat.exporte = true
    appels.lireLesComptes.mockResolvedValue({ ok: true, valeur: [LIGNE] })
    let finir: (v: unknown) => void = () => {}
    appels.agirSurLeCompte.mockReturnValue(new Promise((r) => { finir = r }))
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<DeuxFacteursDesComptes perimetre={{ genre: 'equipe', cabinetId: 'cab' }} />)
    const bouton = await screen.findByRole('button', { name: 'Exiger' })
    act(() => { fireEvent.click(bouton); fireEvent.click(bouton) })
    expect(confirmer).toHaveBeenCalledTimes(1)
    expect(confirmer.mock.calls[0][0]).toContain('membre@essai.invalid')
    expect(appels.agirSurLeCompte).toHaveBeenCalledTimes(1)
    expect(appels.agirSurLeCompte).toHaveBeenCalledWith('exiger', 'u-membre')
    await act(async () => { finir({ ok: true, valeur: null }) })
    expect(appels.lireLesComptes).toHaveBeenCalledTimes(2)
    confirmer.mockRestore()
  })

  it('un geste refusé à la confirmation ne part pas', async () => {
    etat.exporte = true
    appels.lireLesComptes.mockResolvedValue({ ok: true, valeur: [LIGNE] })
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<DeuxFacteursDesComptes perimetre={{ genre: 'equipe', cabinetId: 'cab' }} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Retirer le second facteur (appareil perdu)' }))
    expect(appels.agirSurLeCompte).not.toHaveBeenCalled()
    confirmer.mockRestore()
  })
})
