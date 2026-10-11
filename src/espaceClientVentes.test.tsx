import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { lireRetourDuLien } from './lib/recuperationMotDePasse'

// « MES VENTES » DANS LA COQUE DU CLIENT (espace client, étape P4a), de bout en bout : le vrai AuthProvider, qui lit les
// accès et leurs cases à la connexion ; la vraie coque (Layout), sa navigation et son sélecteur de société ; le vrai
// portier (App), ses routes. Seuls les écrans sont doublés. Ce que ces cas gardent : l'entrée et la route n'existent
// qu'avec la case « Ventes » sur la société AFFICHÉE ; sans elle, l'adresse mène à l'accueil ; et changer de société, écran
// ouvert, retire l'entrée et quitte l'écran — ou les rend.

const faux = vi.hoisted(() => ({
  // Les accès du compte client, et leurs cases, tels que `memberships` les rend.
  acces: [] as { dossier_id: string; droit_ventes: boolean; droit_banque: boolean }[],
  societes: {} as Record<string, string>,
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

vi.mock('./lib/branding', () => ({ useCabinetBranding: () => null }))
vi.mock('./lib/theme', () => ({ useTheme: () => ({ theme: 'light', toggleTheme: () => {} }) }))
vi.mock('./pages/ClientHome', () => ({ default: () => <p>Écran de l’accueil</p> }))
vi.mock('./pages/ClientUpload', () => ({ default: () => <p>Écran des pièces</p> }))
vi.mock('./pages/ClientInformations', () => ({ default: () => <p>Écran des informations</p> }))
vi.mock('./pages/ClientSimulation', () => ({ default: () => <p>Écran de la simulation</p> }))
vi.mock('./pages/ClientVentes', () => ({ default: () => <p>Écran des ventes</p> }))
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

describe('« Mes ventes » selon la case « Ventes » de la société affichée', () => {
  it('avec la case : l’entrée, entre « Mes pièces » et « Mes informations », et la route', async () => {
    faux.acces = [{ dossier_id: 'd1', droit_ventes: true, droit_banque: false }]
    await charger('/#/mes-ventes')
    expect(await screen.findByText('Écran des ventes')).toBeTruthy()
    expect(entrees()).toEqual(['Accueil', 'Mes pièces', 'Mes ventes', 'Mes informations', 'Ma simulation'])
    const lien = within(navigation()).getByRole('link', { name: /Mes ventes/ })
    expect(lien.getAttribute('href')).toBe('#/mes-ventes')
    expect(lien.getAttribute('aria-current')).toBe('page')
  })

  it('sans la case — « Banque » seule n’y suffit pas — : ni entrée, et l’adresse mène à l’accueil', async () => {
    faux.acces = [{ dossier_id: 'd1', droit_ventes: false, droit_banque: true }]
    await charger('/#/mes-ventes')
    expect(await screen.findByText('Écran de l’accueil')).toBeTruthy()
    expect(screen.queryByText('Écran des ventes')).toBeNull()
    expect(entrees()).not.toContain('Mes ventes')
    expect(window.location.hash).toBe('#/accueil')
  })

  it('deux sociétés, une seule avec la case : changer de société écran ouvert retire l’entrée et quitte l’écran, puis les rend', async () => {
    faux.acces = [
      { dossier_id: 'd1', droit_ventes: true, droit_banque: false },
      { dossier_id: 'd2', droit_ventes: false, droit_banque: false },
    ]
    await charger('/#/mes-ventes')
    expect(await screen.findByText('Écran des ventes')).toBeTruthy()
    expect(entrees()).toContain('Mes ventes')

    await choisirSociete('d2')
    expect(await screen.findByText('Écran de l’accueil')).toBeTruthy()
    expect(screen.queryByText('Écran des ventes')).toBeNull()
    expect(entrees()).not.toContain('Mes ventes')
    expect(window.location.hash).toBe('#/accueil')

    await choisirSociete('d1')
    expect(entrees()).toContain('Mes ventes')
    await act(async () => { fireEvent.click(within(navigation()).getByRole('link', { name: /Mes ventes/ })) })
    expect(await screen.findByText('Écran des ventes')).toBeTruthy()
  })

  it('la société retenue d’une visite précédente décide, pas la première de la liste', async () => {
    faux.acces = [
      { dossier_id: 'd1', droit_ventes: true, droit_banque: false },
      { dossier_id: 'd2', droit_ventes: false, droit_banque: false },
    ]
    localStorage.setItem('jd-precompta-dossier-actif', 'd2')
    await charger('/#/mes-ventes')
    expect(await screen.findByText('Écran de l’accueil')).toBeTruthy()
    expect(entrees()).not.toContain('Mes ventes')
  })
})
