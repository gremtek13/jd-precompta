import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DossierParcours from './DossierParcours'
import { GROUPES_PARCOURS } from '../lib/ongletsDossier'

// LA BARRE D'ONGLETS DU DOSSIER — la navigation du bas sur téléphone, et celle du haut quand la barre latérale est
// réduite — déroule un groupe au clic et habille chaque écran de son icône (`ICONES_PARCOURS`). Le Bilan, ajouté à la
// liste des écrans sans la sienne (09/10/2026), faisait lever React à l'ouverture de « Comptabilité » : le dossier
// entier tombait. Ni la barre latérale, qui ne met pas d'icône aux écrans, ni le banc de captures, qui ne déroule pas ces
// menus, ne pouvaient le voir. Chaque groupe se déroule donc ici, et chaque écran s'y montre et s'y ouvre.

const GROUPES_A_DEROULER = GROUPES_PARCOURS.filter((g) => g.enfants)

describe('DossierParcours — chaque groupe se déroule, chaque écran porte son icône et s’ouvre', () => {
  it('déroule au moins les trois groupes de la navigation, dont celui du Bilan', () => {
    // Un plancher : un test qui ne déroulerait rien serait aveugle, pas rassurant.
    expect(GROUPES_A_DEROULER.map((g) => g.id)).toEqual(['documents-groupe', 'comptabilite', 'cabinet'])
    expect(GROUPES_A_DEROULER.find((g) => g.id === 'comptabilite')!.enfants!.map((e) => e.id)).toContain('bilan')
  })

  for (const groupe of GROUPES_A_DEROULER) {
    for (const enfant of groupe.enfants!) {
      it(`${groupe.label} → ${enfant.label} : montré avec son icône, ouvert d’un clic`, () => {
        const onChange = vi.fn()
        const { container } = render(<DossierParcours tab="checklist" onChange={onChange} />)
        const bouton = screen.getByRole('button', { name: new RegExp(`^${groupe.label}`) })
        fireEvent.click(bouton)
        expect(bouton.getAttribute('aria-expanded')).toBe('true')

        const menu = container.querySelector('.nav-menu')
        expect(menu).not.toBeNull()
        const item = within(menu as HTMLElement).getByRole('button', { name: enfant.label })
        // L'icône : un dessin, pas un emplacement vide.
        expect(item.querySelector('svg path, svg rect, svg circle')).not.toBeNull()

        fireEvent.click(item)
        expect(onChange).toHaveBeenCalledTimes(1)
        expect(onChange).toHaveBeenCalledWith(enfant.id)
        // Le menu se referme une fois l'écran choisi.
        expect(container.querySelector('.nav-menu')).toBeNull()
      })
    }
  }

  it('marque comme actif le groupe de l’écran affiché, le Bilan compris', () => {
    render(<DossierParcours tab="bilan" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /^Comptabilité/ }).className).toContain('active')
    expect(screen.getByRole('button', { name: /^Vue d'ensemble/ }).className).not.toContain('active')
  })
})
