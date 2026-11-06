import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../test/ecrans'
import CarteEtatDuDossier from './CarteEtatDuDossier'

// LA CARTE DE L'ÉTAT DU DOSSIER (ligne 51.5, étape C2). Ce qui se garde ici, qu'aucun calcul pur ne voit : drapeau baissé,
// ni appel ni carte ; levé, un squelette avant la lecture, jamais une liste vide ; une lecture refusée se DIT, sans
// exercice ; la réponse d'une société quittée ne s'affiche pas sous une autre. Le drapeau est joué dans ses deux états
// par un accesseur (CLAUDE.md, « Un drapeau d'export levé garde son état d'avant éprouvé »).
const etat = vi.hoisted(() => ({ leve: true, rpc: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc: etat.rpc } }))
vi.mock('../lib/etatDuDossier', async (original) => {
  const reel = await original<typeof import('../lib/etatDuDossier')>()
  return { ...reel, get ETAT_DU_DOSSIER_EXPORTE() { return etat.leve } }
})

const exercices = [
  { annee: 2026, phase: 'pieces_attendues', valide_le: null, declaration_2035: false },
  { annee: 2025, phase: 'validee', valide_le: '2026-04-30', declaration_2035: true },
]

beforeEach(() => {
  etat.leve = true
  etat.rpc.mockReset()
})

describe('la carte de l’état du dossier', () => {
  it('drapeau baissé : ni appel, ni carte', () => {
    etat.leve = false
    const { container } = render(<CarteEtatDuDossier dossierId="d1" />)
    expect(container.innerHTML).toBe("")
    expect(etat.rpc).not.toHaveBeenCalled()
  })

  it('un squelette avant la lecture, puis chaque exercice aux mots du client, sans écrire', async () => {
    let rendre: (v: unknown) => void = () => {}
    etat.rpc.mockReturnValue(new Promise((r) => { rendre = r }))
    render(<CarteEtatDuDossier dossierId="d1" />)
    expect(screen.getByLabelText('Chargement de l’état de ton dossier')).toBeTruthy()
    expect(screen.queryByText(/Exercice/)).toBeNull()
    await act(async () => { rendre({ data: exercices, error: null }) })
    expect(await screen.findByText('Exercice 2026')).toBeTruthy()
    expect(screen.getByText('Ton cabinet attend encore tes pièces de cette année.')).toBeTruthy()
    expect(screen.getByText('Comptes validés le 30/04/2026, ta 2035 est enregistrée.')).toBeTruthy()
    expect(etat.rpc).toHaveBeenCalledTimes(1)
    expect(etat.rpc).toHaveBeenCalledWith('phase_des_exercices', { p_dossier_id: 'd1' })
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('une lecture refusée se dit, sans exercice', async () => {
    etat.rpc.mockResolvedValue({ data: null, error: { message: 'Accès refusé à ce dossier.' } })
    render(<CarteEtatDuDossier dossierId="d1" />)
    expect((await screen.findByRole('status')).textContent).toContain('L’état de ton dossier n’a pas pu être lu.')
    expect(screen.queryByText(/Exercice/)).toBeNull()
  })

  it('la réponse d’une société quittée ne s’affiche pas sous une autre', async () => {
    const rendus: ((v: unknown) => void)[] = []
    etat.rpc.mockImplementation(() => new Promise((r) => { rendus.push(r) }))
    const { rerender } = render(<CarteEtatDuDossier dossierId="d1" />)
    rerender(<CarteEtatDuDossier dossierId="d2" />)
    await act(async () => { rendus[0]({ data: exercices, error: null }) })
    expect(screen.queryByText('Exercice 2026')).toBeNull()
    expect(screen.getByLabelText('Chargement de l’état de ton dossier')).toBeTruthy()
    await act(async () => { rendus[1]({ data: [exercices[0]], error: null }) })
    await waitFor(() => expect(screen.getByText('Exercice 2026')).toBeTruthy())
    expect(screen.queryByText('Exercice 2025')).toBeNull()
  })
})
