import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../test/ecrans'

// L'écran du cabinet de la double authentification exigée (C7, second temps) : le drapeau baissé, rien ne se rend ni ne se
// lit (l'état d'avant) ; levé, la liste lue en entier, un geste confirmé qui nomme le compte, sous un verrou, relu après.

const etat = vi.hoisted(() => ({ exporte: false, aal: 'aal2' as string | null }))
const appels = vi.hoisted(() => ({ lireLesComptes: vi.fn(), agirSurLeCompte: vi.fn() }))
vi.mock('../lib/deuxFacteursExiges', async (original) => {
  const m = await original<typeof import('../lib/deuxFacteursExiges')>()
  return { ...m, get DEUX_FACTEURS_EXIGES_EXPORTE() { return etat.exporte } }
})
vi.mock('../lib/deuxFacteursExigesAppels', () => appels)
// La session du chef : un jeton dont la charge porte le niveau (SEC2-Q2), lu comme la porte de l'application le lit.
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    session: { access_token: `e30.${btoa(JSON.stringify(etat.aal === null ? {} : { aal: etat.aal }))}.signature` },
  }),
}))

import DeuxFacteursDesComptes from './DeuxFacteursDesComptes'
import { CODE_AVANT_D_AFFAIBLIR } from '../lib/deuxFacteursExiges'

const LIGNE = {
  userId: 'u-membre', email: 'membre@essai.invalid', genre: 'membre' as const, aUnFacteur: true, exigeeDepuis: null,
  dernierRetrait: null, peutExiger: true, peutLever: true, peutRetirer: true,
}

beforeEach(() => {
  appels.lireLesComptes.mockReset()
  appels.agirSurLeCompte.mockReset()
})
afterEach(() => { etat.exporte = false; etat.aal = 'aal2' })

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

  it('SEC2-Q2 : sans le code de l’auteur (aal1, ou un jeton sans niveau), lever et retirer se refusent avant le clic, aux mots de la base ; exiger reste offert', async () => {
    for (const aal of ['aal1', null]) {
      etat.exporte = true
      etat.aal = aal
      appels.lireLesComptes.mockResolvedValue({
        ok: true,
        valeur: [{ ...LIGNE, exigeeDepuis: '2026-11-07T10:00:00Z' }, { ...LIGNE, userId: 'u-autre', email: 'autre@essai.invalid' }],
      })
      const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
      const { unmount } = render(<DeuxFacteursDesComptes perimetre={{ genre: 'equipe', cabinetId: 'cab' }} />)
      const lever = await screen.findByRole('button', { name: 'Ne plus exiger' })
      expect(screen.getByTestId('code-avant-d-affaiblir').textContent).toBe(CODE_AVANT_D_AFFAIBLIR)
      expect((lever as HTMLButtonElement).disabled).toBe(true)
      for (const retirer of screen.getAllByRole('button', { name: 'Retirer le second facteur (appareil perdu)' })) {
        expect((retirer as HTMLButtonElement).disabled, String(aal)).toBe(true)
        fireEvent.click(retirer)
      }
      fireEvent.click(lever)
      expect(confirmer).not.toHaveBeenCalled()
      expect(appels.agirSurLeCompte).not.toHaveBeenCalled()
      // Exiger renforce : offert à aal1 aussi.
      expect((screen.getByRole('button', { name: 'Exiger' }) as HTMLButtonElement).disabled).toBe(false)
      confirmer.mockRestore()
      unmount()
    }
  })

  it('à aal2, le refus ne se dit pas et lever reste offert', async () => {
    etat.exporte = true
    appels.lireLesComptes.mockResolvedValue({ ok: true, valeur: [{ ...LIGNE, exigeeDepuis: '2026-11-07T10:00:00Z' }] })
    render(<DeuxFacteursDesComptes perimetre={{ genre: 'equipe', cabinetId: 'cab' }} />)
    const lever = await screen.findByRole('button', { name: 'Ne plus exiger' })
    expect((lever as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByTestId('code-avant-d-affaiblir')).toBeNull()
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
