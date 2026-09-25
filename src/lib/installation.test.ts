import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type EtatInstallation, ecouterInstallation, estEnApplication, lireEtatInstallation, navigateurDe,
  oublierInstallation, prendreInvite, propositionInstallation, sAbonnerInstallation,
} from './installation'

// Ce que la barre latérale propose pour installer l'application, selon le navigateur. Ce qui la
// ferait mentir : proposer d'installer dans l'application déjà installée, confondre Edge avec Safari
// (Edge écrit aussi « Safari » dans sa signature), donner la consigne du Mac à un iPad (qui se
// présente comme un Mac), ou ouvrir deux fois la fenêtre d'installation — un second `prompt()` lève.

// Signatures réelles, relevées sur les navigateurs de 2025-2026.
const UA = {
  chromeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  edgeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  edgeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  safari18Mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  safari16Mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
  firefoxWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  jsdom: 'Mozilla/5.0 (linux) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/26.1.0',
}

const RIEN: EtatInstallation = { inviteDisponible: false, installee: false }
const INVITE: EtatInstallation = { inviteDisponible: true, installee: false }

function proposer(userAgent: string, etat = RIEN, extra: { enApplication?: boolean; pointsTactiles?: number } = {}) {
  return propositionInstallation({
    enApplication: extra.enApplication ?? false,
    etat,
    userAgent,
    pointsTactiles: extra.pointsTactiles ?? 0,
    nomApplication: 'Cabinet Exemple',
    adresse: 'https://compta.exemple.test',
  })
}

function texte(p: ReturnType<typeof proposer>): string {
  return p.type === 'consigne' ? p.texte : ''
}

describe('le navigateur, lu sur sa signature', () => {
  it('reconnaît Edge et Chrome comme des Chromium, sur Windows comme sur Mac', () => {
    for (const ua of [UA.chromeWindows, UA.chromeMac, UA.edgeWindows, UA.edgeMac]) expect(navigateurDe(ua, 0), ua).toBe('chromium')
  })

  it('reconnaît Safari sur Mac, mais pas un iPad qui se présente comme un Mac', () => {
    expect(navigateurDe(UA.safari18Mac, 0)).toBe('safari-mac')
    expect(navigateurDe(UA.safari18Mac, 1)).toBe('safari-mac')
    expect(navigateurDe(UA.safari18Mac, 5)).toBe('autre')
  })

  it('reconnaît Firefox, et laisse de côté les téléphones et l’inconnu', () => {
    expect(navigateurDe(UA.firefoxWindows, 0)).toBe('firefox')
    expect(navigateurDe(UA.firefoxMac, 0)).toBe('firefox')
    for (const ua of [UA.iphone, UA.chromeAndroid, UA.jsdom]) expect(navigateurDe(ua, 5), ua).toBe('autre')
  })
})

describe('ce que propose le bouton', () => {
  it('ne propose rien dans l’application installée, même si le navigateur a une invite', () => {
    expect(proposer(UA.chromeWindows, INVITE, { enApplication: true })).toEqual({ type: 'rien' })
    expect(proposer(UA.chromeWindows, { inviteDisponible: false, installee: true })).toEqual({ type: 'rien' })
  })

  it('ouvre la fenêtre du navigateur dès qu’il en a annoncé une', () => {
    expect(proposer(UA.edgeWindows, INVITE)).toEqual({ type: 'invite' })
  })

  it('sans invite, dit à Edge et Chrome où est l’icône, et sous quel nom chercher l’application', () => {
    const consigne = texte(proposer(UA.chromeMac))
    expect(consigne).toContain('barre d\'adresse')
    expect(consigne).toContain('« Cabinet Exemple »')
  })

  it('dit à Safari le chemin du menu, ou que sa version ne sait pas installer', () => {
    expect(texte(proposer(UA.safari18Mac))).toContain('Ajouter au Dock')
    expect(texte(proposer(UA.safari16Mac))).toContain('macOS 14')
    expect(texte(proposer(UA.safari16Mac))).not.toContain('Ajouter au Dock')
  })

  it('dit à Firefox d’ouvrir l’adresse ailleurs', () => {
    const consigne = texte(proposer(UA.firefoxWindows))
    expect(consigne).toContain('https://compta.exemple.test')
    expect(consigne).toContain('Edge, Chrome')
  })

  it('se tait là où il n’a rien de juste à dire', () => {
    for (const ua of [UA.iphone, UA.chromeAndroid, UA.jsdom]) expect(proposer(ua, RIEN, { pointsTactiles: 5 }), ua).toEqual({ type: 'rien' })
  })
})

/** Une invite comme celle que Chrome émet, avec sa fenêtre simulée. */
function invite() {
  const evenement = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: ReturnType<typeof vi.fn>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
  }
  evenement.prompt = vi.fn(async () => {})
  evenement.userChoice = Promise.resolve({ outcome: 'accepted' })
  return evenement
}

describe('l’invite du navigateur', () => {
  let arreter: (() => void) | null = null
  afterEach(() => {
    arreter?.()
    arreter = null
    oublierInstallation()
  })

  it('est gardée pour le bouton, qui la retire en l’ouvrant : la seconde prise ne trouve rien', () => {
    const cible = new EventTarget() as unknown as Window
    arreter = ecouterInstallation(cible)
    const evenement = invite()
    cible.dispatchEvent(evenement)
    // Gardée : le navigateur n'ouvre pas sa propre invite, c'est le bouton qui l'ouvrira.
    expect(evenement.defaultPrevented).toBe(true)
    expect(lireEtatInstallation()).toEqual(INVITE)
    expect(prendreInvite()).toBe(evenement)
    expect(prendreInvite()).toBeNull()
    expect(lireEtatInstallation()).toEqual(RIEN)
  })

  it('disparaît quand l’application est installée, et prévient ceux qui écoutent', () => {
    const cible = new EventTarget() as unknown as Window
    arreter = ecouterInstallation(cible)
    const abonne = vi.fn()
    const desabonner = sAbonnerInstallation(abonne)
    cible.dispatchEvent(invite())
    cible.dispatchEvent(new Event('appinstalled'))
    expect(lireEtatInstallation()).toEqual({ inviteDisponible: false, installee: true })
    expect(prendreInvite()).toBeNull()
    expect(abonne).toHaveBeenCalledTimes(2)
    desabonner()
  })

  it('rend le même instantané tant que rien ne change', () => {
    expect(lireEtatInstallation()).toBe(lireEtatInstallation())
  })

  it('n’est plus écoutée une fois l’écoute arrêtée', () => {
    const cible = new EventTarget() as unknown as Window
    ecouterInstallation(cible)()
    cible.dispatchEvent(invite())
    expect(lireEtatInstallation()).toEqual(RIEN)
  })
})

describe('l’application installée', () => {
  function fenetre(modes: string[], standalone?: boolean): Window {
    return {
      navigator: { standalone },
      matchMedia: (requete: string) => ({ matches: modes.some((m) => requete === `(display-mode: ${m})`) }),
    } as unknown as Window
  }

  it('se reconnaît à son mode d’affichage, ou au drapeau d’iOS', () => {
    expect(estEnApplication(fenetre(['standalone']))).toBe(true)
    expect(estEnApplication(fenetre(['window-controls-overlay']))).toBe(true)
    expect(estEnApplication(fenetre([], true))).toBe(true)
    expect(estEnApplication(fenetre(['browser']))).toBe(false)
  })

  it('n’est pas supposée là où le navigateur ne sait pas répondre', () => {
    expect(estEnApplication({ navigator: {} } as unknown as Window)).toBe(false)
  })
})
