import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../test/ecrans'

// LA CARTE DE LA COPIE DES FICHIERS (INAL6), sur le tableau de bord : le drapeau baissé, rien ne se rend ni ne se lit ;
// levé, le rappel pour l'équipe (CFC-Q3 (A)), les gestes au chef seul, chacun sous un verrou (deux clics dans le même
// `act` : un appel). Le volume se dit avant le clic qui copie, et au-delà du plafond en mémoire, la copie ne part pas
// (CFC-Q1 (B)) ; la copie qui attend son manifeste offre de le recharger (CFC-Q2 (B)).

const etat = vi.hoisted(() => ({ prevue: false, estChef: true }))
const appels = vi.hoisted(() => ({
  copierLesFichiersDuCabinet: vi.fn(), lireLesCopiesDuCabinet: vi.fn(), preparerLaCopie: vi.fn(), attesterLaCopie: vi.fn(),
}))
vi.mock('../lib/copieDesFichiers', async (original) => {
  const m = await original<typeof import('../lib/copieDesFichiers')>()
  return { ...m, get COPIE_DES_FICHIERS_PREVUE() { return etat.prevue } }
})
vi.mock('../lib/copieDesFichiersLecture', () => appels)
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ estChef: etat.estChef, monCabinetId: 'cab-1' }) }))

import CopieDesFichiers, { LIBELLE_COPIER, LIBELLE_MANIFESTE, LIBELLE_MESURER } from './CopieDesFichiers'
import { PLAFOND_EN_MEMOIRE } from '../lib/copieDesFichiers'

const EN_ATTENTE = {
  id: '0b0b0b0b-0000-4000-8000-0000000000aa', faite_le: '2026-11-10T10:00:00Z', nb_fichiers: 3, empreinte_du_manifeste: 'a'.repeat(64),
  nb_ecarts: 0, nb_manquants: 0, rangee_le: null,
}

beforeEach(() => {
  etat.prevue = true
  etat.estChef = true
  for (const f of Object.values(appels)) f.mockReset()
  appels.lireLesCopiesDuCabinet.mockResolvedValue({ lue: true, derniere: null, derniereComplete: null })
  appels.preparerLaCopie.mockResolvedValue({ ok: true, preparation: { dossiers: 2, fichiers: 3, octets: 1024 * 1024, tailleInconnue: 0 } })
})

describe('la carte de la copie des fichiers', () => {
  it('drapeau baissé : rien ne se rend, rien ne se lit', () => {
    etat.prevue = false
    const { container } = render(<CopieDesFichiers />)
    expect(container.innerHTML).toBe('')
    expect(appels.lireLesCopiesDuCabinet).not.toHaveBeenCalled()
  })

  it('jamais faite : le rappel ; un membre de l’équipe qui n’est pas chef n’a aucun geste, même une copie en attente', async () => {
    etat.estChef = false
    appels.lireLesCopiesDuCabinet.mockResolvedValue({ lue: true, derniere: EN_ATTENTE, derniereComplete: null })
    render(<CopieDesFichiers />)
    expect(await screen.findByText(/La copie du 10\/11\/2026 attend son manifeste/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: LIBELLE_MESURER })).toBeNull()
    expect(screen.queryByLabelText(LIBELLE_MANIFESTE)).toBeNull()
  })

  it('le volume se dit avant le clic qui copie ; deux clics dans le même act : une seule copie, puis la relecture', async () => {
    let finir: (v: unknown) => void = () => {}
    appels.copierLesFichiersDuCabinet.mockReturnValue(new Promise((r) => { finir = r }))
    render(<CopieDesFichiers />)
    expect(screen.queryByRole('button', { name: LIBELLE_COPIER })).toBeNull()
    const mesurer = await screen.findByRole('button', { name: LIBELLE_MESURER })
    act(() => { fireEvent.click(mesurer); fireEvent.click(mesurer) })
    expect(appels.preparerLaCopie).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/2 dossier\(s\), 3 fichier\(s\), 1 Mio/)).toBeTruthy()
    const bouton = await screen.findByRole('button', { name: LIBELLE_COPIER })
    act(() => { fireEvent.click(bouton); fireEvent.click(bouton) })
    await waitFor(() => expect(appels.copierLesFichiersDuCabinet).toHaveBeenCalledTimes(1))
    await act(async () => { finir({ ok: false, message: 'Aucune copie, aucun ZIP : les pièces n’ont pas pu être lues en entier.' }) })
    expect((await screen.findByRole('alert')).textContent).toContain('aucun ZIP')
    await waitFor(() => expect(appels.lireLesCopiesDuCabinet).toHaveBeenCalledTimes(2))
  })

  it('sans écriture directe sur le disque, au-delà du plafond en mémoire : dit, et la copie ne part pas', async () => {
    appels.preparerLaCopie.mockResolvedValue({ ok: true, preparation: { dossiers: 1, fichiers: 900, octets: PLAFOND_EN_MEMOIRE + 1, tailleInconnue: 0 } })
    render(<CopieDesFichiers />)
    fireEvent.click(await screen.findByRole('button', { name: LIBELLE_MESURER }))
    expect((await screen.findByRole('alert')).textContent).toContain('la copie ne part pas d’ici')
    expect((screen.getByRole('button', { name: LIBELLE_COPIER }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('une copie avec un écart le dit ; puis elle attend son manifeste', async () => {
    appels.copierLesFichiersDuCabinet.mockResolvedValue({ ok: true, bilan: {
      copieId: EN_ATTENTE.id, dossiers: 1, fichiers: 3, verifies: 1, ecarts: 1, nonVerifies: 1, manquants: 0, octets: 10, octetsDuZip: 400,
      repartition: ['A : 3 fichier(s)'], enregistrementRefuse: null,
    } })
    render(<CopieDesFichiers />)
    fireEvent.click(await screen.findByRole('button', { name: LIBELLE_MESURER }))
    fireEvent.click(await screen.findByRole('button', { name: LIBELLE_COPIER }))
    expect(await screen.findByText(/1 écart\(s\) d’empreinte et 0 fichier\(s\) manquant\(s\)/)).toBeTruthy()
    expect(screen.getByText('A : 3 fichier(s)')).toBeTruthy()
    expect(screen.getByText(/recharger son MANIFESTE.txt : la copie ne compte qu’alors/)).toBeTruthy()
  })

  it('le manifeste rechargé : attesté sous verrou, le refus dit', async () => {
    appels.lireLesCopiesDuCabinet.mockResolvedValue({ lue: true, derniere: EN_ATTENTE, derniereComplete: null })
    appels.attesterLaCopie.mockResolvedValue({ ok: false, message: 'Ce manifeste est celui d’une autre copie.' })
    render(<CopieDesFichiers />)
    const champ = await screen.findByLabelText(LIBELLE_MANIFESTE)
    const fichier = new File(['x'], 'MANIFESTE.txt', { type: 'text/plain' })
    await act(async () => { fireEvent.change(champ, { target: { files: [fichier] } }) })
    expect(appels.attesterLaCopie).toHaveBeenCalledWith('cab-1', EN_ATTENTE, fichier)
    expect((await screen.findByRole('alert')).textContent).toContain('d’une autre copie')
  })
})
