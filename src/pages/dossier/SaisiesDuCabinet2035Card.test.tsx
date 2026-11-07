import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/ecrans'
import type { LectureDesSaisies2035 } from '../../lib/saisies2035'

// LA CARTE « SAISIES DU CABINET » (étapes 2035S3 à S5) : ce qu'aucun calcul pur ne voit — le câblage de la fonction, le
// verrou, la confirmation qui nomme ce qui change, et l'absence de tout geste sur une lecture incomplète ou un exercice figé.

const rpc = vi.fn()
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))

import SaisiesDuCabinet2035Card from './SaisiesDuCabinet2035Card'

const LUES: LectureDesSaisies2035 = {
  dossierId: 'd1', etat: 'lues',
  saisies: [{ annee: 2025, code: 'CC', centimes: 120000, noteAnnexe: 'Quote-part personnelle du loyer' }],
}

describe('la carte des saisies du cabinet', () => {
  beforeEach(() => {
    rpc.mockReset()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })
  afterEach(() => vi.restoreAllMocks())

  it('un champ par case du formulaire de l’exercice, chacun sous sa phrase de la notice ; DE et DB à partir de 2025', () => {
    const { unmount } = render(<SaisiesDuCabinet2035Card dossierId="d1" annee={2025} lecture={LUES} fige={false} onRelire={async () => {}} />)
    expect(screen.getByLabelText(/^CC — Divers à réintégrer/)).toHaveProperty('value', '1200,00')
    expect(screen.getByLabelText(/^DE — Sommes à réintégrer/)).toBeTruthy()
    expect(screen.getByLabelText(/^DH — dont déductions/)).toBeTruthy()
    expect(screen.getByText(/La quote-part personnelle des dépenses déduites/)).toBeTruthy()
    unmount()
    render(<SaisiesDuCabinet2035Card dossierId="d1" annee={2024} lecture={LUES} fige={false} onRelire={async () => {}} />)
    expect(screen.queryByLabelText(/^DE — /)).toBeNull()
  })

  it('enregistre les seules cases changées, contre leur valeur lue, une fois sous deux clics, après une confirmation qui les nomme', async () => {
    rpc.mockResolvedValue({ data: 1, error: null })
    const relue = vi.fn(async () => {})
    render(<SaisiesDuCabinet2035Card dossierId="d1" annee={2025} lecture={LUES} fige={false} onRelire={relue} />)
    fireEvent.change(screen.getByLabelText(/^DE — /), { target: { value: '300' } })
    const bouton = screen.getByRole('button', { name: 'Enregistrer les saisies' })
    await act(async () => {
      fireEvent.click(bouton)
      fireEvent.click(bouton)
    })
    await waitFor(() => expect(relue).toHaveBeenCalledTimes(1))
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/DE : 0,00\s€ → 300,00\s€/))
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('enregistrer_saisies_2035', {
      p_dossier_id: 'd1', p_annee: 2025,
      p_lues: { DE: { centimes: 0, note_annexe: null } }, p_saisies: { DE: { centimes: 30000, note_annexe: null } },
    })
  })

  it('dit le refus de la base sous ses mots, et relit quand même', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'La case CC de l’exercice 2025 a changé depuis sa lecture : relis les saisies avant de les enregistrer.' } })
    const relue = vi.fn(async () => {})
    render(<SaisiesDuCabinet2035Card dossierId="d1" annee={2025} lecture={LUES} fige={false} onRelire={relue} />)
    fireEvent.change(screen.getByLabelText(/^CC — /), { target: { value: '1300' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les saisies' })) })
    expect(await screen.findByText(/a changé depuis sa lecture/)).toBeTruthy()
    expect(relue).toHaveBeenCalledTimes(1)
  })

  it('un montant illisible, ou une note sur une case vidée, se disent avant le clic, et le bouton reste retenu', () => {
    render(<SaisiesDuCabinet2035Card dossierId="d1" annee={2025} lecture={LUES} fige={false} onRelire={async () => {}} />)
    fireEvent.change(screen.getByLabelText(/^CL — /), { target: { value: '12,345' } })
    expect(screen.getByText(/Le montant de CL ne se lit pas/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Enregistrer les saisies' })).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText(/^CL — /), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText(/^CC — /), { target: { value: '' } })
    expect(screen.getByText(/la case vidée n’en garde pas/)).toBeTruthy()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('lecture incomplète, pas encore revenue, ou exercice figé : aucun geste', () => {
    const { unmount } = render(<SaisiesDuCabinet2035Card dossierId="d1" annee={2025} fige={false} onRelire={async () => {}}
      lecture={{ dossierId: 'd1', etat: 'incompletes', motif: 'lecture partielle' }} />)
    expect(screen.getByText(/Lecture incomplète : lecture partielle/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    unmount()
    const { unmount: u2 } = render(<SaisiesDuCabinet2035Card dossierId="d1" annee={2025} fige={false} onRelire={async () => {}} lecture={null} />)
    expect(screen.queryByRole('button')).toBeNull()
    u2()
    render(<SaisiesDuCabinet2035Card dossierId="d1" annee={2025} lecture={LUES} fige={true} onRelire={async () => {}} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText(/est figé/)).toBeTruthy()
  })
})
