import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BarreDossiers from './BarreDossiers'
import DossierParcours from './DossierParcours'

// L'ONGLET INVENTAIRE DANS LES DEUX NAVIGATIONS (ligne 35, INV5) : la barre d'onglets du dossier (le téléphone, et l'ordinateur
// quand la barre latérale est réduite) et la barre latérale lisent la même liste (`groupesDuParcours`, lib/ongletsDossier.ts).
// Le drapeau `INVENTAIRE_EXPORTE` est joué par un accesseur, état par état : baissé, la navigation est celle d'hier, sans un mot
// de plus ; levé, « Inventaire » précède « Clôture » sous Comptabilité dans l'une et dans l'autre, et un clic y mène.
const drapeau = vi.hoisted(() => ({ leve: false }))
vi.mock('../lib/inventaire', async (original) => {
  const vrai = await original<typeof import('../lib/inventaire')>()
  return { ...vrai, get INVENTAIRE_EXPORTE() { return drapeau.leve } }
})
// La barre latérale lit les dossiers au cabinet par la base : elle les reçoit ici, déjà lus.
vi.mock('../lib/supabase', () => ({ supabase: {} }))

afterEach(() => { cleanup(); drapeau.leve = false })

function barre(ongletActif: string) {
  return render(
    <MemoryRouter>
      <BarreDossiers
        dossiers={[{ id: 'd1', nom: 'Dossier fictif' }]} dossiersDuCabinet={new Set()} motifDesignation={null} chargement={false} motif={null} recherche=""
        dossierOuvertId="d1" ongletActif={ongletActif} reduite={false}
      />
    </MemoryRouter>,
  )
}

const liensDeComptabilite = () => {
  const groupe = [...document.querySelectorAll('.barre-groupe')].find((g) => g.querySelector('.barre-groupe-titre')?.textContent === 'Comptabilité') as HTMLElement
  return [...groupe.querySelectorAll('a.barre-lien')].map((a) => a.textContent)
}

describe('la barre d’onglets du dossier — l’onglet Inventaire', () => {
  it('baissé : aucun « Inventaire » dans le menu de Comptabilité', () => {
    render(<DossierParcours tab="cloture" onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /^Comptabilité/ }))
    const menu = document.querySelector('.nav-menu') as HTMLElement
    expect(within(menu).queryByRole('button', { name: /Inventaire/ })).toBeNull()
    expect(within(menu).getByRole('button', { name: /Clôture/ })).toBeTruthy()
  })

  it('levé : « Inventaire » précède « Clôture », porte son icône, et un clic y mène', () => {
    drapeau.leve = true
    const onChange = vi.fn()
    render(<DossierParcours tab="inventaire" onChange={onChange} />)
    // L'écran affiché est dans Comptabilité : son groupe est actif.
    expect(screen.getByRole('button', { name: /^Comptabilité/ }).className).toContain('active')
    fireEvent.click(screen.getByRole('button', { name: /^Comptabilité/ }))
    const menu = document.querySelector('.nav-menu') as HTMLElement
    const noms = [...menu.querySelectorAll('.nav-menu-item')].map((b) => b.textContent)
    expect(noms.indexOf('Inventaire')).toBe(noms.indexOf('Clôture') - 1)
    const bouton = within(menu).getByRole('button', { name: 'Inventaire' })
    expect(bouton.className).toContain('active')
    expect(bouton.querySelector('svg path, svg rect, svg circle')).not.toBeNull()
    fireEvent.click(bouton)
    expect(onChange).toHaveBeenCalledWith('inventaire')
  })
})

describe('la barre latérale — l’onglet Inventaire', () => {
  it('baissé : Comptabilité sans « Inventaire »', () => {
    barre('cloture')
    expect(liensDeComptabilite()).not.toContain('Inventaire')
    expect(liensDeComptabilite()).toContain('Clôture')
  })

  it('levé : « Inventaire » vient juste avant « Clôture », et son lien mène à l’onglet du dossier ouvert', () => {
    drapeau.leve = true
    barre('inventaire')
    const liens = liensDeComptabilite()
    expect(liens.indexOf('Inventaire')).toBe(liens.indexOf('Clôture') - 1)
    const lien = screen.getByRole('link', { name: 'Inventaire' })
    expect(lien.getAttribute('href')).toBe('/dossiers/d1/inventaire')
  })
})
