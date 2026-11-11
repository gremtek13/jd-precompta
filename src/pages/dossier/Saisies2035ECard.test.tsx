import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/ecrans'
import type { LectureDesSaisies2035E } from '../../lib/saisies2035E'

// LA CARTE « ANNEXE 2035-E — SAISIES DU CABINET » (ligne 48) : ce qu'aucun calcul pur ne voit — le câblage de la fonction,
// le verrou, la confirmation qui nomme ce qui change, un champ vide qui part nul (jamais zéro), et l'absence de tout geste
// sur une lecture incomplète ou un exercice figé.

const rpc = vi.fn()
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))

import Saisies2035ECard from './Saisies2035ECard'

const VIDE = {
  loyers_deductibles: null, plus_values: null, variation_de_stock: null, taxes_sur_le_chiffre_d_affaires: null,
  dotations_biens_mis_a_disposition: null, moins_values: null, mono_etablissement: null, effectif: null,
}
const LUES: LectureDesSaisies2035E = { dossierId: 'd1', etat: 'lues', saisies: [] }

describe('la carte des saisies de l’annexe 2035-E', () => {
  beforeEach(() => {
    rpc.mockReset()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })
  afterEach(() => vi.restoreAllMocks())

  it('enregistre la saisie entière contre la saisie lue, une fois sous deux clics, après une confirmation qui la nomme', async () => {
    rpc.mockResolvedValue({ data: 'id', error: null })
    const relue = vi.fn(async () => {})
    render(<Saisies2035ECard dossierId="d1" annee={2025} lecture={LUES} fige={false} onRelire={relue} />)
    fireEvent.change(screen.getByLabelText(/^EM — /), { target: { value: '3 000' } })
    fireEvent.change(screen.getByLabelText(/^AH — /), { target: { value: 'oui' } })
    fireEvent.change(screen.getByLabelText(/^BK — /), { target: { value: '2' } })
    const bouton = screen.getByRole('button', { name: 'Enregistrer les saisies de l’annexe' })
    await act(async () => {
      fireEvent.click(bouton)
      fireEvent.click(bouton)
    })
    await waitFor(() => expect(relue).toHaveBeenCalledTimes(1))
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/EM : à saisir → 3000 €\nAH \(mono-établissement\) : à saisir → oui\nBK \(effectif\) : à saisir → 2/))
    expect(rpc).toHaveBeenCalledTimes(1)
    // Les champs laissés vides partent nuls : « à saisir », jamais zéro.
    expect(rpc).toHaveBeenCalledWith('enregistrer_saisies_2035e', {
      p_dossier_id: 'd1', p_annee: 2025, p_lue: VIDE,
      p_saisie: { ...VIDE, loyers_deductibles: 3000, mono_etablissement: true, effectif: 2 },
    })
  })

  it('dit le refus avant le clic : un montant qui ne se lit pas, un loyer négatif', () => {
    render(<Saisies2035ECard dossierId="d1" annee={2025} lecture={LUES} fige={false} onRelire={async () => {}} />)
    fireEvent.change(screen.getByLabelText(/^EM — /), { target: { value: '12,5' } })
    expect(screen.getByText(/Un montant ne se lit pas/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/^EM — /), { target: { value: '-1' } })
    expect(screen.getByText(/EM ne peut pas être négative/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Enregistrer les saisies de l’annexe' })).toHaveProperty('disabled', true)
  })

  it('dit le refus de la base sous ses mots, et relit quand même', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Les saisies de l’annexe 2035-E de l’exercice 2025 ont changé depuis leur lecture : relis-les avant de les enregistrer.' } })
    const relue = vi.fn(async () => {})
    render(<Saisies2035ECard dossierId="d1" annee={2025} lecture={LUES} fige={false} onRelire={relue} />)
    fireEvent.change(screen.getByLabelText(/^EN — /), { target: { value: '0' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les saisies de l’annexe' })) })
    await waitFor(() => expect(relue).toHaveBeenCalledTimes(1))
    expect(screen.getByText(/ont changé depuis leur lecture/)).toBeTruthy()
  })

  it('sur une lecture incomplète, ni champ ni bouton ; avant la lecture, « chargement »', () => {
    const { unmount } = render(<Saisies2035ECard dossierId="d1" annee={2025} lecture={{ dossierId: 'd1', etat: 'incompletes', motif: 'lecture partielle' }}
      fige={false} onRelire={async () => {}} />)
    expect(screen.getByText(/Lecture incomplète : lecture partielle/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    unmount()
    render(<Saisies2035ECard dossierId="d1" annee={2025} lecture={null} fige={false} onRelire={async () => {}} />)
    expect(screen.getByText(/chargement/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('un exercice figé montre ce qu’il porte, « à saisir » compris, sans aucun geste', () => {
    const lues: LectureDesSaisies2035E = { dossierId: 'd1', etat: 'lues', saisies: [{ annee: 2025, loyersDeductibles: 1800, plusValues: null,
      variationDeStock: null, taxesSurLeChiffreDAffaires: null, dotationsBiensMisADisposition: null, moinsValues: null, monoEtablissement: false, effectif: null }] }
    render(<Saisies2035ECard dossierId="d1" annee={2025} lecture={lues} fige onRelire={async () => {}} />)
    expect(screen.getByText('1800 €')).toBeTruthy()
    expect(screen.getAllByText('à saisir').length).toBe(5)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
