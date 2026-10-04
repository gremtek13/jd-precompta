import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ExercicesValidesProvider, useExercicesValides } from './ExercicesValidesContext'
import { exerciceValide } from '../test/exerciceValide'

function Lecteur() {
  const { frontiere, anneesValidees } = useExercicesValides()
  return <p>frontière {frontiere ?? 'aucune'} — {anneesValidees.join(', ') || 'aucun'}</p>
}

describe('ExercicesValidesContext', () => {
  it('donne la frontière du DERNIER exercice validé, pas du premier lu', () => {
    render(
      <ExercicesValidesProvider exercices={[exerciceValide(2023), exerciceValide(2025), exerciceValide(2024)]} relire={async () => {}}>
        <Lecteur />
      </ExercicesValidesProvider>,
    )
    // Lus par année croissante, le premier est le PLUS ANCIEN : la frontière n'est pas la sienne.
    expect(screen.getByText('frontière 2025-12-31 — 2023, 2025, 2024')).toBeTruthy()
  })

  it('sans exercice validé, rien n’est figé', () => {
    render(
      <ExercicesValidesProvider exercices={[]} relire={async () => {}}>
        <Lecteur />
      </ExercicesValidesProvider>,
    )
    expect(screen.getByText('frontière aucune — aucun')).toBeTruthy()
  })

  // Hors de la page d'un dossier, supposer qu'aucun exercice n'est validé ferait proposer de modifier ce que la
  // validation a figé : le hook lève plutôt.
  it('lève hors de la page d’un dossier', () => {
    const erreur = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => render(<Lecteur />)).toThrow(/ExercicesValidesProvider/)
    } finally {
      erreur.mockRestore()
    }
  })
})
