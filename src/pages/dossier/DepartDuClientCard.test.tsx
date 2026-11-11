import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/ecrans'
import { motsDuRefus } from '../../lib/departDuClient'
import type { LectureDuDepart } from '../../lib/departDuClientLecture'
import DepartDuClientCard from './DepartDuClientCard'

// LA CARTE DU DÉPART D'UN CLIENT (ligne 44, INAL5). Les deux états du drapeau : baissé, la carte ne rend rien ; levé, elle
// offre les deux voies, dit pour chacune ce qu'elle fait et ce qui manque (les paquets non téléchargés, nommés), dit le refus
// de la pose AVANT le clic aux mots de la fonction, nomme le dossier et le terme dans sa confirmation, passe la fonction de la
// base seule sous un verrou (deux clics du même `act` : un appel), et fait relire. Données FICTIVES.

const etat = vi.hoisted(() => ({
  leve: true, chef: true, appels: [] as string[], issue: { ok: true } as { ok: true } | { ok: false; message: string },
  attente: null as null | Promise<void>,
}))

vi.mock('../../lib/departDuClient', async (original) => {
  const reel = await original<typeof import('../../lib/departDuClient')>()
  return { ...reel, get DEPART_DU_CLIENT_PREVU() { return etat.leve } }
})
vi.mock('../../lib/departDuClientLecture', () => ({
  conserverLeDossier: async (d: string) => { etat.appels.push(`poser:${d}`); if (etat.attente) await etat.attente; return etat.issue },
  leverLaConservation: async (d: string) => { etat.appels.push(`lever:${d}`); return etat.issue },
}))
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ estChef: etat.chef }) }))
vi.mock('../../lib/format', async (original) => {
  const reel = await original<typeof import('../../lib/format')>()
  return { ...reel, aujourdHuiAParis: () => '2027-03-01' }
})

const D = 'd0000000-0000-4000-8000-000000000001'
const lue = (p: Partial<Extract<LectureDuDepart, { etat: 'lue' }>> = {}): LectureDuDepart => ({
  etat: 'lue', dossierId: D,
  exercices: [{ annee: 2025, empreinte: 'e2025' }, { annee: 2026, empreinte: 'e2026' }],
  paquets: [{ annee: 2025, empreinte_exercice: 'e2025', telecharge_le: '2027-02-01T10:00:00Z' }],
  conservation: null, accesClient: 0, ...p,
})

let relectures = 0
const monter = (lecture: LectureDuDepart | null) => render(
  <DepartDuClientCard dossierId={D} dossierNom="Dossier fictif" lecture={lecture} onDepartEcrit={() => { relectures += 1 }} />,
)

beforeEach(() => { etat.leve = true; etat.chef = true; etat.appels = []; etat.issue = { ok: true }; etat.attente = null; relectures = 0 })
afterEach(() => { vi.restoreAllMocks() })

describe('la carte du départ d’un client', () => {
  it('baissé : rien', () => {
    etat.leve = false
    const { container } = monter(lue())
    expect(container.innerHTML).toBe('')
  })

  it('pas revenue : « Chargement… » ; illisible : le motif ; aucun geste', () => {
    monter(null)
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('illisible : le motif, aucun geste', () => {
    monter({ etat: 'illisible', dossierId: D, motif: 'accès refusé' })
    expect(screen.getByRole('alert').textContent).toContain('accès refusé')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('les deux voies : le paquet qui manque, nommé ; le terme que la conservation prendrait', () => {
    monter(lue())
    expect(screen.getByTestId('voie-remise').textContent).toContain('Il manque le paquet de l’exercice 2026')
    expect(screen.getByTestId('voie-conservation').textContent).toContain('conservé jusqu’au 31/12/2036')
  })

  it('un accès client : le refus de la pose se dit avant le clic, le bouton fermé', () => {
    monter(lue({ accesClient: 1 }))
    expect(screen.getByText(motsDuRefus('accesClient', 1))).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Conserver le dossier dix ans' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('la pose : la confirmation nomme le dossier et le terme ; deux clics, un appel ; la carte fait relire', async () => {
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    let liberer = () => {}
    etat.attente = new Promise<void>((r) => { liberer = r })
    monter(lue())
    const bouton = screen.getByRole('button', { name: 'Conserver le dossier dix ans' })
    await act(async () => { fireEvent.click(bouton); fireEvent.click(bouton) })
    expect(confirmer).toHaveBeenCalledTimes(1)
    expect(confirmer.mock.calls[0][0]).toContain('Conserver « Dossier fictif » jusqu’au 31/12/2036')
    await act(async () => { liberer() })
    expect(etat.appels).toEqual([`poser:${D}`])
    expect(relectures).toBe(1)
    expect(screen.getByText('Le dossier est conservé ✓')).toBeTruthy()
  })

  it('conservé : la levée seule est offerte ; un refus de la base se dit', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    etat.issue = { ok: false, message: 'refus fictif' }
    monter(lue({ conservation: { jusqu_au: '2036-12-31', dernier_exercice: 2026, posee_le: '2027-02-01T10:00:00Z' } }))
    expect(screen.queryByRole('button', { name: 'Conserver le dossier dix ans' })).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Lever la conservation' })) })
    expect(etat.appels).toEqual([`lever:${D}`])
    expect(screen.getByRole('alert').textContent).toContain('refus fictif')
  })

  it('un membre qui n’est pas chef : aucun geste', () => {
    etat.chef = false
    monter(lue())
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('Seul un comptable en chef conserve un dossier ou lève sa conservation.')).toBeTruthy()
  })
})
