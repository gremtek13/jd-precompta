import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../test/ecrans'

// LA CARTE DE LA COPIE DES FICHIERS (INAL6), sur le tableau de bord : le drapeau baissé, rien ne se rend ni ne se lit ;
// levé, le rappel pour l'équipe, le geste au chef seul, sous un verrou (deux clics dans le même `act` : une copie).

const etat = vi.hoisted(() => ({ prevue: false, estChef: true }))
const appels = vi.hoisted(() => ({ copierLesFichiersDuCabinet: vi.fn(), lireLesCopiesDuCabinet: vi.fn() }))
vi.mock('../lib/copieDesFichiers', async (original) => {
  const m = await original<typeof import('../lib/copieDesFichiers')>()
  return { ...m, get COPIE_DES_FICHIERS_PREVUE() { return etat.prevue } }
})
vi.mock('../lib/copieDesFichiersLecture', () => appels)
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ estChef: etat.estChef, monCabinetId: 'cab-1' }) }))

import CopieDesFichiers, { LIBELLE_COPIER } from './CopieDesFichiers'

beforeEach(() => {
  etat.prevue = true
  etat.estChef = true
  appels.copierLesFichiersDuCabinet.mockReset()
  appels.lireLesCopiesDuCabinet.mockReset()
  appels.lireLesCopiesDuCabinet.mockResolvedValue({ lue: true, derniere: null, derniereComplete: null })
})

describe('la carte de la copie des fichiers', () => {
  it('drapeau baissé : rien ne se rend, rien ne se lit', () => {
    etat.prevue = false
    const { container } = render(<CopieDesFichiers />)
    expect(container.innerHTML).toBe('')
    expect(appels.lireLesCopiesDuCabinet).not.toHaveBeenCalled()
  })

  it('jamais faite : le rappel ; un membre de l’équipe qui n’est pas chef n’a pas le geste', async () => {
    etat.estChef = false
    render(<CopieDesFichiers />)
    expect(await screen.findByText(/Aucune copie complète des fichiers/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: LIBELLE_COPIER })).toBeNull()
  })

  it('deux clics dans le même act : une seule copie, puis la relecture', async () => {
    let finir: (v: unknown) => void = () => {}
    appels.copierLesFichiersDuCabinet.mockReturnValue(new Promise((r) => { finir = r }))
    render(<CopieDesFichiers />)
    const bouton = await screen.findByRole('button', { name: LIBELLE_COPIER })
    act(() => { fireEvent.click(bouton); fireEvent.click(bouton) })
    expect(appels.copierLesFichiersDuCabinet).toHaveBeenCalledTimes(1)
    await act(async () => { finir({ ok: false, message: 'Aucune copie, aucun ZIP : les pièces n’ont pas pu être lues en entier.' }) })
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('aucun ZIP')
    await waitFor(() => expect(appels.lireLesCopiesDuCabinet).toHaveBeenCalledTimes(2))
  })

  it('une copie avec un écart le dit, et la découpe', async () => {
    appels.copierLesFichiersDuCabinet.mockResolvedValue({ ok: true, bilan: {
      dossiers: 1, lots: 2, fichiers: 3, verifies: 1, ecarts: 1, nonVerifies: 1, manquants: 0, octets: 10,
      decoupe: ['A : 2 lots, 3 fichier(s)'], enregistrementRefuse: null,
    } })
    render(<CopieDesFichiers />)
    fireEvent.click(await screen.findByRole('button', { name: LIBELLE_COPIER }))
    expect(await screen.findByText(/1 écart\(s\) d’empreinte et 0 fichier\(s\) manquant\(s\)/)).toBeTruthy()
    expect(screen.getByText('A : 2 lots, 3 fichier(s)')).toBeTruthy()
  })
})
