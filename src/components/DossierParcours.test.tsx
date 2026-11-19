import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DossierParcours from './DossierParcours'
import { GROUPES_PARCOURS, groupesDuParcours } from '../lib/ongletsDossier'
import { ModulesFournis } from '../context/ModulesOuverts'
import { CAISSE_EXPORTEE } from '../lib/caisse'
import { INVENTAIRE_EXPORTE } from '../lib/inventaire'
import { MODULES_OPTIONNELS, TOUS_LES_MODULES, type ModuleOptionnel } from '../lib/modulesDuCabinet'

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

// LES MODULES DU CABINET (conception 56, OPT3) : la barre ne montre que les écrans des modules ouverts — tous ouverts, ceux
// d'hier ; au socle seul, ni la tenue ni la facturation ; chaque module seul, ses écrans en plus. Chaque groupe montré se
// déroule sur exactement les écrans que `groupesDuParcours` lui laisse.
describe('DossierParcours — sous les modules du cabinet', () => {
  const scenarios: [string, readonly ModuleOptionnel[]][] = [
    ['tous ouverts', TOUS_LES_MODULES],
    ['socle seul', []],
    ...MODULES_OPTIONNELS.map((m): [string, readonly ModuleOptionnel[]] => [`${m} seul`, [m]]),
  ]
  for (const [nom, ouverts] of scenarios) {
    it(`${nom} : les groupes et les écrans de ses modules, rien d’autre`, () => {
      const attendus = groupesDuParcours(CAISSE_EXPORTEE, INVENTAIRE_EXPORTE, ouverts)
      const { container } = render(
        <ModulesFournis etat={{ etat: 'lus', ouverts }}><DossierParcours tab="checklist" onChange={() => {}} /></ModulesFournis>,
      )
      const boutons = [...container.querySelectorAll('.nav-groupe-bouton .nav-label-full')].map((b) => b.textContent)
      expect(boutons).toEqual(attendus.map((g) => g.label))
      for (const groupe of attendus.filter((g) => g.enfants)) {
        const bouton = [...container.querySelectorAll('.nav-groupe-bouton')].find((b) => b.querySelector('.nav-label-full')?.textContent === groupe.label)!
        fireEvent.click(bouton)
        const menu = container.querySelector('.nav-menu') as HTMLElement
        expect([...menu.querySelectorAll('button')].map((b) => b.textContent)).toEqual(groupe.enfants!.map((e) => e.label))
        fireEvent.click(bouton)
      }
      if (ouverts.length === 0) {
        const tous = attendus.flatMap((g) => [g.label, ...(g.enfants ?? []).map((e) => e.label)])
        for (const ferme of ['Clôture', 'Bilan', 'Révision', 'Factures émises', 'Estimation']) expect(tous).not.toContain(ferme)
      }
    })
  }

  it('tous ouverts : la barre d’hier, au groupe et à l’écran près', () => {
    expect(groupesDuParcours(CAISSE_EXPORTEE, INVENTAIRE_EXPORTE, TOUS_LES_MODULES)).toEqual(GROUPES_PARCOURS)
  })
})
