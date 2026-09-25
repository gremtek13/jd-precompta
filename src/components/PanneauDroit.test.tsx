import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import PanneauDroit, { EmplacementPanneauDroit, FournisseurPanneauDroit } from './PanneauDroit'
import { usePanneauDroit } from '../lib/panneauDroit'

// Le panneau de droite (voir lib/panneauDroit.ts). Ce qui le ferait mentir sans que rien ne casse
// visiblement : un volet vide qui reste affiché, un contenu rendu à l'endroit où l'écran le déclare
// (donc au milieu de la liste) au lieu du volet, deux contenus empilés, un contenu remplacé qui en se
// fermant emporte son remplaçant, et un bouton qui ne fait RIEN hors de la coque.

function Contenu({ nom }: { nom: string }) {
  const { ouvert, ouvrir, fermer } = usePanneauDroit(nom)
  return (
    <div data-testid={`ecran-${nom}`}>
      <button type="button" onClick={ouvrir}>Ouvrir {nom}</button>
      <button type="button" onClick={fermer}>Fermer {nom}</button>
      <span>{nom} {ouvert ? 'ouvert' : 'fermé'}</span>
      <PanneauDroit nom={nom}><p>Contenu {nom}</p></PanneauDroit>
    </div>
  )
}

function Coque({ avecB = true }: { avecB?: boolean }) {
  return (
    <FournisseurPanneauDroit>
      <main>
        <Contenu nom="A" />
        {avecB && <Contenu nom="B" />}
      </main>
      <EmplacementPanneauDroit />
    </FournisseurPanneauDroit>
  )
}

const volet = () => screen.getByRole('complementary', { name: 'Panneau contextuel' })

describe('Panneau de droite', () => {
  it('vide, l’emplacement n’a aucun enfant — c’est ce qui le fait disparaître (`:empty`)', () => {
    render(<Coque />)
    expect(volet().childElementCount).toBe(0)
  })

  it('le contenu s’affiche DANS le volet, pas à l’endroit où l’écran le déclare', () => {
    render(<Coque />)
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir A' }))
    expect(within(volet()).getByText('Contenu A')).toBeTruthy()
    expect(within(screen.getByTestId('ecran-A')).queryByText('Contenu A')).toBeNull()
    expect(screen.getByText('A ouvert')).toBeTruthy()
  })

  it('un seul contenu à la fois : ouvrir B remplace A', () => {
    render(<Coque />)
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir B' }))
    expect(within(volet()).getByText('Contenu B')).toBeTruthy()
    expect(within(volet()).queryByText('Contenu A')).toBeNull()
    expect(screen.getByText('A fermé')).toBeTruthy()
  })

  it('fermer un contenu déjà remplacé ne ferme pas celui qui a pris sa place', () => {
    render(<Coque />)
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir B' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fermer A' }))
    expect(within(volet()).getByText('Contenu B')).toBeTruthy()
  })

  it('fermer le contenu affiché vide le volet', () => {
    render(<Coque />)
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir B' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fermer B' }))
    expect(volet().childElementCount).toBe(0)
  })

  it('un contenu qui quitte l’écran l’emporte avec lui, sans que personne ferme le volet', () => {
    function CoqueRetirable() {
      const [avecB, setAvecB] = useState(true)
      return (
        <>
          <button type="button" onClick={() => setAvecB(false)}>Quitter l’écran B</button>
          <Coque avecB={avecB} />
        </>
      )
    }
    render(<CoqueRetirable />)
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir B' }))
    expect(within(volet()).getByText('Contenu B')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Quitter l’écran B' }))
    expect(volet().childElementCount).toBe(0)
  })

  it('hors de la coque, il lève au lieu d’offrir un bouton qui ne fait rien', () => {
    // React journalise l'erreur de rendu avant de la relancer : on la laisse passer sans la montrer.
    const origine = console.error
    console.error = () => {}
    try {
      expect(() => render(<Contenu nom="A" />)).toThrow(/hors de la coque/)
    } finally {
      console.error = origine
    }
  })
})
