import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BoutonInstallation from './BoutonInstallation'
import { ecouterInstallation, oublierInstallation } from '../lib/installation'

// « Installer l'application », tel que le voit l'utilisateur. Ce qui le ferait mentir sans que rien ne
// casse ailleurs : ouvrir deux fois la fenêtre d'installation sur deux clics rapprochés (le second
// `prompt()` lève), rester affiché une fois l'application installée, ou disparaître sans rien dire
// dans un navigateur qui n'a pas encore annoncé d'invite — le cas de tout premier affichage dans Edge
// et Chrome, qui ne l'annoncent qu'après un peu d'usage.

const UA = {
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0',
}

function signature(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true })
}

function enApplication() {
  window.matchMedia = ((requete: string) => ({ matches: requete === '(display-mode: standalone)' })) as unknown as typeof window.matchMedia
}

/** Une invite comme celle que Chrome émet ; `choix` est la réponse de l'utilisateur à sa fenêtre. */
function annoncer(choix: 'accepted' | 'dismissed' = 'accepted') {
  const evenement = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: ReturnType<typeof vi.fn>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
  }
  evenement.prompt = vi.fn(async () => {})
  evenement.userChoice = Promise.resolve({ outcome: choix })
  act(() => { window.dispatchEvent(evenement) })
  return evenement
}

const bouton = () => screen.queryByRole('button', { name: /Installer l'application/ })

let arreter: () => void
beforeEach(() => {
  arreter = ecouterInstallation(window)
})
afterEach(() => {
  arreter()
  act(() => oublierInstallation())
  delete (navigator as { userAgent?: string }).userAgent
  delete (window as { matchMedia?: unknown }).matchMedia
})

describe('Installer l’application — Edge et Chrome', () => {
  it('ouvre la fenêtre du navigateur une seule fois, même sur deux clics rapprochés, puis s’efface', async () => {
    signature(UA.chrome)
    render(<BoutonInstallation nomApplication="JD Precompta" />)
    const invite = annoncer('accepted')
    const b = bouton()!
    await act(async () => { b.click(); b.click() })
    expect(invite.prompt).toHaveBeenCalledTimes(1)
    act(() => { window.dispatchEvent(new Event('appinstalled')) })
    expect(bouton()).toBeNull()
  })

  it('refusée, l’invite laisse la place à la consigne', async () => {
    signature(UA.chrome)
    render(<BoutonInstallation nomApplication="JD Precompta" />)
    const invite = annoncer('dismissed')
    await act(async () => { bouton()!.click() })
    expect(invite.prompt).toHaveBeenCalledTimes(1)
    expect(bouton()).not.toBeNull()
    fireEvent.click(bouton()!)
    expect(screen.getByRole('note').textContent).toContain('barre d\'adresse')
  })

  it('avant toute invite, dit où est l’icône et sous quel nom chercher l’application', () => {
    signature(UA.chrome)
    render(<BoutonInstallation nomApplication="Cabinet Exemple" />)
    fireEvent.click(bouton()!)
    const consigne = screen.getByRole('note').textContent ?? ''
    expect(consigne).toContain('barre d\'adresse')
    expect(consigne).toContain('« Cabinet Exemple »')
    expect(bouton()!.getAttribute('aria-expanded')).toBe('true')
  })

  it('la consigne se referme au clic ailleurs et sur Échap', () => {
    signature(UA.chrome)
    render(<BoutonInstallation nomApplication="JD Precompta" />)
    fireEvent.click(bouton()!)
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('note')).toBeNull()
    fireEvent.click(bouton()!)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('note')).toBeNull()
  })
})

describe('Installer l’application — ailleurs', () => {
  it('dans l’application installée, ne propose rien, même avec une invite', () => {
    signature(UA.chrome)
    enApplication()
    render(<BoutonInstallation nomApplication="JD Precompta" />)
    annoncer()
    expect(bouton()).toBeNull()
  })

  it('donne à Safari le chemin de son menu', () => {
    signature(UA.safari)
    render(<BoutonInstallation nomApplication="JD Precompta" />)
    fireEvent.click(bouton()!)
    expect(screen.getByRole('note').textContent).toContain('Ajouter au Dock')
  })

  it('dit à Firefox d’ouvrir cette adresse dans un autre navigateur', () => {
    signature(UA.firefox)
    render(<BoutonInstallation nomApplication="JD Precompta" />)
    fireEvent.click(bouton()!)
    const consigne = screen.getByRole('note').textContent ?? ''
    expect(consigne).toContain(window.location.origin)
    expect(consigne).toContain('Edge, Chrome')
  })

  it('ne montre rien dans un navigateur dont il ne sait rien dire de juste', () => {
    render(<BoutonInstallation nomApplication="JD Precompta" />)
    expect(bouton()).toBeNull()
  })
})
