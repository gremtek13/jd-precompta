import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BarreDossiers from './BarreDossiers'
import DossierParcours from './DossierParcours'

// L'ONGLET CAISSE DANS LES DEUX NAVIGATIONS (ligne 26.6, étape C4) : la barre d'onglets du dossier (le téléphone, et l'ordinateur
// quand la barre latérale est réduite) et la barre latérale lisent la même liste (`groupesDuParcours`, lib/ongletsDossier.ts).
// Le drapeau `CAISSE_EXPORTEE` est joué par un accesseur, état par état : baissé, la navigation est celle d'hier, sans un mot de
// plus ; levé, « Caisse » vient juste après Banque dans l'une et dans l'autre, et un clic y mène.
const drapeau = vi.hoisted(() => ({ leve: false }))
vi.mock('../lib/caisse', async (original) => {
  const vrai = await original<typeof import('../lib/caisse')>()
  return { ...vrai, get CAISSE_EXPORTEE() { return drapeau.leve } }
})
// La barre latérale lit les dossiers au cabinet par la base : elle les reçoit ici, déjà lus.
vi.mock('../lib/supabase', () => ({ supabase: {} }))

afterEach(() => { cleanup(); drapeau.leve = false })

function barre() {
  return render(
    <MemoryRouter>
      <BarreDossiers
        dossiers={[{ id: 'd1', nom: 'Dossier fictif' }]} chargement={false} motif={null} recherche=""
        dossierOuvertId="d1" ongletActif="checklist" reduite={false}
      />
    </MemoryRouter>,
  )
}

const libellesDeLArbre = () => [...document.querySelectorAll('.barre-arbre > a.barre-lien')].map((a) => a.textContent)

describe('la barre d’onglets du dossier — l’onglet Caisse', () => {
  it('baissé : les cinq groupes d’hier, aucun bouton « Caisse »', () => {
    const { container } = render(<DossierParcours tab="checklist" onChange={() => {}} />)
    expect([...container.querySelectorAll('.nav-groupe-bouton .nav-label-full')].map((e) => e.textContent))
      .toEqual(["Vue d'ensemble", 'Documents', 'Banque', 'Comptabilité', 'Cabinet'])
    expect(screen.queryByRole('button', { name: /^Caisse/ })).toBeNull()
  })

  it('levé : « Caisse » suit Banque, porte son icône, marque l’écran affiché actif et y mène d’un clic', () => {
    drapeau.leve = true
    const onChange = vi.fn()
    const { container } = render(<DossierParcours tab="caisse" onChange={onChange} />)
    expect([...container.querySelectorAll('.nav-groupe-bouton .nav-label-full')].map((e) => e.textContent))
      .toEqual(["Vue d'ensemble", 'Documents', 'Banque', 'Caisse', 'Comptabilité', 'Cabinet'])
    const bouton = screen.getByRole('button', { name: /^Caisse/ })
    expect(bouton.className).toContain('active')
    expect(screen.getByRole('button', { name: /^Banque/ }).className).not.toContain('active')
    // L'icône : un dessin, pas un emplacement vide ; et le libellé court de la barre du téléphone.
    expect(bouton.querySelector('svg path, svg rect, svg circle')).not.toBeNull()
    expect(bouton.querySelector('.nav-label-court')?.textContent).toBe('Caisse')
    fireEvent.click(bouton)
    expect(onChange).toHaveBeenCalledWith('caisse')
    // Une destination directe : aucun menu ne se déroule.
    expect(container.querySelector('.nav-menu')).toBeNull()
  })
})

describe('la barre latérale — l’onglet Caisse', () => {
  it('baissé : Vue d’ensemble et Banque seuls parmi les destinations directes, sans lien « Caisse »', () => {
    barre()
    expect(libellesDeLArbre()).toEqual(["Vue d'ensemble", 'Banque'])
    expect(screen.queryByRole('link', { name: 'Caisse' })).toBeNull()
  })

  it('levé : « Caisse » vient juste après « Banque », et son lien mène à l’onglet du dossier ouvert', () => {
    drapeau.leve = true
    barre()
    expect(libellesDeLArbre()).toEqual(["Vue d'ensemble", 'Banque', 'Caisse'])
    const lien = within(document.querySelector('.barre-arbre') as HTMLElement).getByRole('link', { name: 'Caisse' })
    expect(lien.getAttribute('href')).toBe('/dossiers/d1/caisse')
  })
})
