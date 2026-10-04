import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ValidationExerciceCard from './ValidationExerciceCard'
import type { EtatDeValidation } from '../../lib/prealablesValidation'
import type { DemandeDeValidation } from '../../lib/validationExercice'

// LA CARTE SEULE, sur ce que Clôture ne peut pas montrer : son verrou tenu jusqu'à la fin de la relecture, et les
// renvois de ses préalables. Le câblage dans Clôture — ce qui part à la base, l'exercice validé relu — est gardé
// par ClotureTab.test.tsx.
const faux = vi.hoisted(() => ({ appels: [] as string[] }))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (nom: string) => {
      faux.appels.push(nom)
      return Promise.resolve({ data: { annee: 2025, ecritures: 1, lignes: 2 }, error: null })
    },
  },
}))

const DEMANDE: DemandeDeValidation = {
  p_lignes: [
    { id: 'e1', journal: 'AC', numero: 1, piece_ref: 'facture.pdf', piece_date: '2025-03-10', compte_lib: 'Achats', comp_aux_num: null, comp_aux_lib: null },
    { id: 'e2', journal: 'AC', numero: 1, piece_ref: 'facture.pdf', piece_date: '2025-03-10', compte_lib: 'Banque', comp_aux_num: null, comp_aux_lib: null },
  ],
  p_a_nouveaux: [],
  p_declaration: null,
}
const VALIDABLE: EtatDeValidation = { prealables: [], numerotation: null, validable: true }

describe('ValidationExerciceCard', () => {
  // Relâché avant la relecture, le verrou rendrait le bouton pendant que l'écran relit encore l'exercice : la carte
  // proposerait de valider un exercice qui vient de l'être, et la base refuserait le second clic.
  it('tient son verrou jusqu’à la fin de la relecture', async () => {
    faux.appels = []
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    let relacher!: () => void
    const relecture = new Promise<void>((r) => { relacher = r })
    render(
      <ValidationExerciceCard
        dossierId="d1" annee={2025} valide={null} etat={VALIDABLE} demande={DEMANDE} estChef onValide={() => relecture}
      />,
    )
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Valider l’exercice 2025' })) })
    expect(faux.appels).toEqual(['valider_exercice'])
    const pendant = screen.getByRole('button', { name: 'Validation…' }) as HTMLButtonElement
    expect(pendant.disabled).toBe(true)
    await act(async () => { fireEvent.click(pendant) })
    expect(faux.appels).toEqual(['valider_exercice'])
    await act(async () => { relacher() })
    expect((screen.getByRole('button', { name: 'Valider l’exercice 2025' }) as HTMLButtonElement).disabled).toBe(false)
  })

  // Un préalable d'ordre mène à l'exercice qui se valide d'abord ; un préalable qui se lève dans un autre onglet y
  // mène ; un préalable qui se lit ici ne mène nulle part.
  it('mène à l’exercice qu’un préalable réclame, et à l’onglet où lever les autres', () => {
    const onChoisirExercice = vi.fn()
    const onNavigate = vi.fn()
    const etat: EtatDeValidation = {
      validable: false, numerotation: null,
      prealables: [
        { id: 'ordre', nb: null, cible: 'cloture', bloquant: true, exercice: 2024, message: "L'exercice 2024 n'est pas validé." },
        { id: 'mouvements-a-traiter', nb: null, cible: 'banque', bloquant: true, message: 'Des mouvements restent à traiter.' },
        { id: 'exercice-en-cours', nb: null, cible: 'cloture', bloquant: true, message: "L'exercice n'est pas terminé." },
      ],
    }
    render(
      <ValidationExerciceCard
        dossierId="d1" annee={2025} valide={null} etat={etat} demande={null} estChef onValide={async () => {}}
        onNavigate={onNavigate} onChoisirExercice={onChoisirExercice}
      />,
    )
    const boutons = (texte: RegExp) => within(screen.getByText(texte).closest('li') as HTMLElement).queryAllByRole('button').map((b) => b.textContent)
    expect(boutons(/n'est pas validé/)).toEqual(['Exercice 2024'])
    expect(boutons(/restent à traiter/)).toEqual(['Banque'])
    expect(boutons(/n'est pas terminé/)).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Exercice 2024' }))
    expect(onChoisirExercice).toHaveBeenCalledWith(2024)
    fireEvent.click(screen.getByRole('button', { name: 'Banque' }))
    expect(onNavigate).toHaveBeenCalledWith('banque')
    expect((screen.getByRole('button', { name: 'Valider l’exercice 2025' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
