import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { lireRetourDuLien } from './lib/recuperationMotDePasse'

// « MA TRÉSORERIE » DANS LA COQUE DU CLIENT (ligne 51.5, étape C8), de bout en bout, comme « Ma caisse »
// (espaceClientCaisse.test.tsx) : le vrai AuthProvider, la vraie coque (Layout), le vrai portier (App). Seuls les écrans sont
// doublés, et le drapeau joué dans ses DEUX états. Ce que ces cas gardent : baissé, ni entrée ni route, quelle que soit la
// case ; levé, l'entrée et la route n'existent qu'avec « Banque » sur la société AFFICHÉE (« Ventes » n'y suffit pas), et
// changer de société, écran ouvert, retire l'entrée et quitte l'écran.

const faux = vi.hoisted(() => ({
  acces: [] as { dossier_id: string; droit_ventes: boolean; droit_banque: boolean; droit_caisse: boolean }[],
  societes: {} as Record<string, string>,
  offerte: false,
}))

const CLIENT = { id: 'u-client', email: 'client@exemple-fictif.fr' }

vi.mock('./lib/supabase', async () => {
  const { predicatEq, predicatIn, filtrer } = await import('./test/filtresPostgrest')
  function chaine(table: string) {
    const predicats: ((l: Record<string, unknown>) => boolean)[] = []
    const lignes = (): Record<string, unknown>[] => {
      if (table === 'memberships') return faux.acces.map((a) => ({ ...a, user_id: CLIENT.id }))
      if (table === 'dossiers') return Object.entries(faux.societes).map(([id, nom]) => ({ id, nom, cabinet_id: 'cab1' }))
      if (table === 'cabinet_admins') return []
      throw new Error(`lecture inattendue : ${table}`)
    }
    const c = {
      select: () => c,
      eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); return c },
      in: (colonne: string, valeurs: unknown[]) => { predicats.push(predicatIn(colonne, valeurs)); return c },
      maybeSingle: async () => ({ data: filtrer(lignes(), predicats)[0] ?? null, error: null }),
      then: (resolu: (r: unknown) => unknown, rejete: (e: unknown) => unknown) =>
        Promise.resolve().then(() => ({ data: filtrer(lignes(), predicats), error: null })).then(resolu, rejete),
    }
    return c
  }
  return {
    supabase: {
      auth: {
        getSession: async () => ({ data: { session: { access_token: 'jeton-fictif', user: CLIENT } }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        signOut: async () => ({ error: null }),
      },
      from: (table: string) => chaine(table),
      rpc: async () => ({ data: false, error: null }),
    },
  }
})

// Le drapeau de la page, joué dans ses deux états par un accesseur : levé ou baissé, sans toucher au module.
vi.mock('./lib/tresorerieClient', async (original) => {
  const vrai = await original<typeof import('./lib/tresorerieClient')>()
  return { ...vrai, get TRESORERIE_A_90_JOURS_OFFERTE() { return faux.offerte } }
})

vi.mock('./lib/branding', () => ({ useCabinetBranding: () => null }))
vi.mock('./lib/theme', () => ({ useTheme: () => ({ theme: 'light', toggleTheme: () => {} }) }))
vi.mock('./pages/ClientHome', () => ({ default: () => <p>Écran de l’accueil</p> }))
vi.mock('./pages/ClientUpload', () => ({ default: () => <p>Écran des pièces</p> }))
vi.mock('./pages/ClientInformations', () => ({ default: () => <p>Écran des informations</p> }))
vi.mock('./pages/ClientSimulation', () => ({ default: () => <p>Écran de la simulation</p> }))
vi.mock('./pages/ClientVentes', () => ({ default: () => <p>Écran des ventes</p> }))
vi.mock('./pages/ClientBanque', () => ({ default: () => <p>Écran de la banque</p> }))
vi.mock('./pages/ClientCaisse', () => ({ default: () => <p>Écran de la caisse</p> }))
vi.mock('./pages/ClientAnalyse', () => ({ default: () => <p>Écran de l’analyse</p> }))
vi.mock('./pages/ClientTresorerie', () => ({ default: () => <p>Écran de la trésorerie</p> }))
// Les écrans du cabinet : jamais montés ici, doublés pour ne pas charger ce qu'ils importent (pdf.js touche au navigateur).
vi.mock('./pages/DossiersList', () => ({ default: () => <p>Liste des dossiers</p> }))
vi.mock('./pages/DossierDetail', () => ({ default: () => <p>Dossier</p> }))
vi.mock('./pages/SuperAdminPage', () => ({ default: () => <p>Comptes master</p> }))
vi.mock('./pages/EquipePage', () => ({ default: () => <p>Équipe</p> }))
vi.mock('./pages/CabinetBrandingPage', () => ({ default: () => <p>Apparence</p> }))
vi.mock('./pages/RetourBanque', () => ({ default: () => <p>Retour de la banque</p> }))

// jsdom n'a pas `matchMedia`, que la coque lit (installation).
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (requete: string) => ({
    matches: false, media: requete, onchange: null, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  }),
})

async function charger(adresse: string) {
  window.history.replaceState(null, '', adresse)
  render(<App retourDuLien={lireRetourDuLien(window.location.href)} />)
  await act(async () => {})
  await act(async () => {})
}

const navigation = () => within(document.querySelector('.sidebar') as HTMLElement).getByRole('navigation')
const entrees = () => within(navigation()).getAllByRole('link').map((l) => l.getAttribute('title'))
const choisirSociete = async (id: string) => {
  await act(async () => { fireEvent.change(screen.getByLabelText('Société'), { target: { value: id } }) })
}

beforeEach(() => {
  localStorage.clear()
  faux.societes = { d1: 'Atelier fictif', d2: 'Cabinet fictif' }
})
afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

describe('« Ma trésorerie » selon son drapeau et la case « Banque » de la société affichée', () => {
  it('drapeau baissé : ni entrée ni route, même avec « Banque » et « Ventes »', async () => {
    faux.offerte = false
    faux.acces = [{ dossier_id: 'd1', droit_ventes: true, droit_banque: true, droit_caisse: false }]
    await charger('/#/ma-tresorerie')
    expect(await screen.findByText('Écran de l’accueil')).toBeTruthy()
    expect(screen.queryByText('Écran de la trésorerie')).toBeNull()
    expect(entrees()).not.toContain('Ma trésorerie')
    expect(window.location.hash).toBe('#/accueil')
  })

  it('drapeau levé, avec « Banque » : l’entrée, après « Mon analyse », et la route', async () => {
    faux.offerte = true
    faux.acces = [{ dossier_id: 'd1', droit_ventes: false, droit_banque: true, droit_caisse: false }]
    await charger('/#/ma-tresorerie')
    expect(await screen.findByText('Écran de la trésorerie')).toBeTruthy()
    expect(entrees()).toEqual(['Accueil', 'Mes pièces', 'Ma banque', 'Mon analyse', 'Ma trésorerie', 'Mon échéancier', 'Mes informations', 'Ma simulation'])
    const lien = within(navigation()).getByRole('link', { name: /Ma trésorerie/ })
    expect(lien.getAttribute('href')).toBe('#/ma-tresorerie')
    expect(lien.getAttribute('aria-current')).toBe('page')
  })

  it('drapeau levé, « Ventes » sans « Banque » : ni entrée, et l’adresse mène à l’accueil', async () => {
    faux.offerte = true
    faux.acces = [{ dossier_id: 'd1', droit_ventes: true, droit_banque: false, droit_caisse: false }]
    await charger('/#/ma-tresorerie')
    expect(await screen.findByText('Écran de l’accueil')).toBeTruthy()
    expect(entrees()).not.toContain('Ma trésorerie')
    expect(window.location.hash).toBe('#/accueil')
  })

  it('drapeau levé, deux sociétés, une seule avec « Banque » : changer de société écran ouvert retire l’entrée et quitte l’écran', async () => {
    faux.offerte = true
    faux.acces = [
      { dossier_id: 'd1', droit_ventes: false, droit_banque: true, droit_caisse: false },
      { dossier_id: 'd2', droit_ventes: false, droit_banque: false, droit_caisse: false },
    ]
    await charger('/#/ma-tresorerie')
    expect(await screen.findByText('Écran de la trésorerie')).toBeTruthy()
    await choisirSociete('d2')
    expect(await screen.findByText('Écran de l’accueil')).toBeTruthy()
    expect(entrees()).not.toContain('Ma trésorerie')
    expect(window.location.hash).toBe('#/accueil')
    await choisirSociete('d1')
    await act(async () => { fireEvent.click(within(navigation()).getByRole('link', { name: /Ma trésorerie/ })) })
    expect(await screen.findByText('Écran de la trésorerie')).toBeTruthy()
  })
})
