import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import PanneauDroit, { EmplacementPanneauDroit, FournisseurPanneauDroit } from './PanneauDroit'
import { useGardePanneau, usePanneauDroit } from '../lib/panneauDroit'

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

// LA GARDE DE SORTIE. Le volet laisse le reste de l'écran cliquable, donc une fiche en cours de
// saisie peut être chassée par un autre contenu ou par sa croix : sans garde, la saisie partirait
// sans un mot. Ce qui la ferait mentir : une garde ignorée à l'ouverture d'un autre contenu ou à la
// fermeture, une garde restée posée après le départ de son contenu (elle retiendrait son
// successeur), et une garde consultée quand un contenu se rouvre lui-même.
function Garde({ nom, garde }: { nom: string; garde: () => boolean }) {
  const { ouvrir, fermer } = usePanneauDroit(nom)
  useGardePanneau(nom, garde)
  return (
    <div>
      <button type="button" onClick={ouvrir}>Ouvrir {nom}</button>
      <button type="button" onClick={fermer}>Fermer {nom}</button>
      <PanneauDroit nom={nom}><p>Contenu {nom}</p></PanneauDroit>
    </div>
  )
}

function CoqueGardee({ garde }: { garde: () => boolean }) {
  return (
    <FournisseurPanneauDroit>
      <main>
        <Garde nom="A" garde={garde} />
        <Contenu nom="B" />
      </main>
      <EmplacementPanneauDroit />
    </FournisseurPanneauDroit>
  )
}

describe('Panneau de droite — la garde de sortie', () => {
  it('une garde qui refuse retient son contenu : un autre ne prend pas sa place', () => {
    const garde = vi.fn(() => false)
    render(<CoqueGardee garde={garde} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir B' }))
    expect(within(volet()).getByText('Contenu A')).toBeTruthy()
    expect(garde).toHaveBeenCalledTimes(1)
  })

  it('une garde qui accepte laisse passer', () => {
    // Garde SYMÉTRIQUE : sans elle, « la garde retient » serait satisfait par un volet qui ne cède
    // plus jamais sa place.
    render(<CoqueGardee garde={() => true} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir B' }))
    expect(within(volet()).getByText('Contenu B')).toBeTruthy()
  })

  it('la croix passe aussi par la garde', () => {
    render(<CoqueGardee garde={() => false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fermer A' }))
    expect(within(volet()).getByText('Contenu A')).toBeTruthy()
  })

  it('la garde d’un contenu parti ne retient pas celui qui lui a succédé', () => {
    const garde = vi.fn(() => true)
    render(<CoqueGardee garde={garde} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir B' }))
    expect(garde).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Fermer B' }))
    expect(volet().childElementCount).toBe(0)
    expect(garde).toHaveBeenCalledTimes(1)
  })

  it('se rouvrir soi-même ne passe pas par la garde', () => {
    const garde = vi.fn(() => false)
    render(<CoqueGardee garde={garde} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir A' }))
    expect(garde).not.toHaveBeenCalled()
  })

  it('l’emplacement porte le nom de son occupant — le téléphone en a besoin', () => {
    render(<CoqueGardee garde={() => true} />)
    expect(volet().getAttribute('data-occupant')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir B' }))
    expect(volet().getAttribute('data-occupant')).toBe('B')
  })
})
