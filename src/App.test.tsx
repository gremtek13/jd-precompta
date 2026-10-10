import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { lireRetourDuLien } from './lib/recuperationMotDePasse'

// LE PORTIER DE L'APPLICATION ET LE LIEN « MOT DE PASSE OUBLIÉ », de bout en bout : la vraie adresse lue comme main.tsx
// la lit, le vrai AuthProvider, le vrai écran de connexion et celui du nouveau mot de passe. Seuls les écrans de
// l'application sont doublés — ce test regarde lequel s'ouvre, et quand.

const faux = vi.hoisted(() => ({
  rappel: null as null | ((evenement: string, session: unknown) => void),
  sessionInitiale: null as null | { access_token: string; user: { id: string; email: string } },
  admins: {} as Record<string, { cabinet_id: string; role: string }>,
  membres: {} as Record<string, string[]>,
  misesAJour: [] as unknown[],
  deconnexions: 0,
  demandes: [] as unknown[][],
  // Les écrans de l'application montés, dans l'ordre.
  ecrans: [] as string[],
}))

vi.mock('./lib/supabase', () => {
  // Les lectures des rôles (AuthContext), filtrées sur le compte comme le ferait la base.
  function chaine(table: string) {
    let compte = ''
    let ids: string[] = []
    const reponse = () => {
      if (table === 'memberships') return { data: (faux.membres[compte] ?? []).map((d) => ({ dossier_id: d })), error: null }
      if (table === 'dossiers') return { data: ids.map((id) => ({ id, nom: 'Dossier fictif', cabinet_id: 'cab1' })), error: null }
      throw new Error(`lecture inattendue : ${table}`)
    }
    const c = {
      select: () => c,
      eq: (_colonne: string, valeur: string) => { compte = valeur; return c },
      in: (_colonne: string, valeurs: string[]) => { ids = valeurs; return c },
      maybeSingle: async () => {
        if (table !== 'cabinet_admins') throw new Error(`lecture inattendue : ${table}`)
        return { data: faux.admins[compte] ?? null, error: null }
      },
      then: (resolu: (r: unknown) => unknown, rejete: (e: unknown) => unknown) => Promise.resolve().then(reponse).then(resolu, rejete),
    }
    return c
  }
  return {
    supabase: {
      auth: {
        getSession: async () => ({ data: { session: faux.sessionInitiale }, error: null }),
        onAuthStateChange: (rappel: (evenement: string, session: unknown) => void) => {
          faux.rappel = rappel
          return { data: { subscription: { unsubscribe: () => { faux.rappel = null } } } }
        },
        // Comme auth-js (GoTrueClient._updateUser) : « USER_UPDATED » part AVANT que l'appel rende la main.
        updateUser: async (attributs: unknown) => {
          faux.misesAJour.push(attributs)
          faux.rappel?.('USER_UPDATED', faux.sessionInitiale)
          return { data: { user: faux.sessionInitiale?.user ?? null }, error: null }
        },
        signOut: async () => {
          faux.deconnexions++
          faux.rappel?.('SIGNED_OUT', null)
          return { error: null }
        },
        resetPasswordForEmail: async (...args: unknown[]) => {
          faux.demandes.push(args)
          return { data: {}, error: null }
        },
        signInWithPassword: async () => ({ data: { user: null, session: null }, error: { message: 'non attendu' } }),
      },
      from: (table: string) => chaine(table),
      rpc: async () => ({ data: false, error: null }),
    },
  }
})

vi.mock('./components/Layout', async () => {
  const { Outlet } = await import('react-router-dom')
  return { default: () => <Outlet /> }
})
// Les écrans de l'application, doublés : ils disent qu'ils se sont montés.
vi.mock('./pages/ClientHome', async () => {
  const { useEffect } = await import('react')
  return {
    default: function AccueilDouble() {
      useEffect(() => { faux.ecrans.push('accueil du client') }, [])
      return <p>Accueil du client</p>
    },
  }
})
vi.mock('./pages/DossiersList', async () => {
  const { useEffect } = await import('react')
  return {
    default: function ListeDouble() {
      useEffect(() => { faux.ecrans.push('liste des dossiers') }, [])
      return <p>Liste des dossiers</p>
    },
  }
})
vi.mock('./pages/DossierDetail', () => ({ default: () => <p>Dossier</p> }))
vi.mock('./pages/ClientUpload', () => ({ default: () => <p>Mes pièces</p> }))
vi.mock('./pages/ClientInformations', () => ({ default: () => <p>Mes informations</p> }))
vi.mock('./pages/ClientSimulation', () => ({ default: () => <p>Ma simulation</p> }))
vi.mock('./pages/SuperAdminPage', () => ({ default: () => <p>Comptes master</p> }))
vi.mock('./pages/EquipePage', () => ({ default: () => <p>Équipe</p> }))
vi.mock('./pages/CabinetBrandingPage', () => ({ default: () => <p>Apparence</p> }))
vi.mock('./pages/RetourBanque', () => ({ default: () => <p>Retour de la banque</p> }))

const CLIENT = { id: 'u-client', email: 'client@exemple-fictif.fr' }
const CHEF = { id: 'u-chef', email: 'chef@cabinet-fictif.fr' }
// Les adresses que le service d'authentification fabrique (supabase/auth, `AsRedirectURL`, `prepErrorRedirectURL`).
const JETON = 'jeton-du-lien-fictif'
const ADRESSE_RECUPERATION =
  `/#access_token=${JETON}&expires_at=1791200000&expires_in=3600&refresh_token=rt-fictif&sb=&token_type=bearer&type=recovery`
const ADRESSE_REFUS = '/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb='

// Ce que fait main.tsx : l'adresse lue au chargement, avant le premier rendu.
async function charger(adresse: string) {
  window.history.replaceState(null, '', adresse)
  render(<App retourDuLien={lireRetourDuLien(window.location.href)} />)
  await act(async () => {})
}

beforeEach(() => {
  faux.rappel = null
  faux.sessionInitiale = null
  faux.admins = { [CHEF.id]: { cabinet_id: 'cab1', role: 'comptable_en_chef' } }
  faux.membres = { [CLIENT.id]: ['d1'] }
  faux.misesAJour = []
  faux.deconnexions = 0
  faux.demandes = []
  faux.ecrans = []
  localStorage.clear()
})
afterEach(() => { window.history.replaceState(null, '', '/') })

describe('App — le lien « Mot de passe oublié »', () => {
  it('la session du lien arrive sur le nouveau mot de passe AVANT tout autre écran, puis l’application s’ouvre', async () => {
    faux.sessionInitiale = { access_token: JETON, user: CLIENT }
    await charger(ADRESSE_RECUPERATION)
    expect(await screen.findByRole('heading', { name: 'Choisir un nouveau mot de passe' })).toBeTruthy()
    expect(screen.getByLabelText<HTMLInputElement>('Compte').value).toBe(CLIENT.email)
    // Aucun écran de l'application ne s'est monté, et le jeton ne reste pas dans l'adresse.
    expect(faux.ecrans).toEqual([])
    expect(window.location.hash).not.toContain('access_token')

    // Un mot de passe qui suit la règle du projet (lib/recuperationMotDePasse.ts) : sinon l'écran le refuse avant l'appel.
    fireEvent.change(screen.getByLabelText('Nouveau mot de passe'), { target: { value: 'Nouveau-mot-de-passe-1' } })
    fireEvent.change(screen.getByLabelText('Confirmer le mot de passe'), { target: { value: 'Nouveau-mot-de-passe-1' } })
    await act(async () => { fireEvent.submit(screen.getByRole('button', { name: 'Enregistrer' }).closest('form')!) })
    expect(faux.misesAJour).toEqual([{ password: 'Nouveau-mot-de-passe-1' }])
    expect(await screen.findByText('Accueil du client')).toBeTruthy()
    expect(faux.ecrans).toEqual(['accueil du client'])
    expect(localStorage.getItem('jd-precompta-recuperation')).toBeNull()
  })

  it('« Se déconnecter » quitte l’écran sans changer le mot de passe, vers la connexion', async () => {
    faux.sessionInitiale = { access_token: JETON, user: CLIENT }
    await charger(ADRESSE_RECUPERATION)
    await screen.findByRole('heading', { name: 'Choisir un nouveau mot de passe' })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' })) })
    expect(faux.deconnexions).toBe(1)
    expect(faux.misesAJour).toEqual([])
    expect(await screen.findByRole('button', { name: 'Se connecter' })).toBeTruthy()
    expect(faux.ecrans).toEqual([])
  })

  it('un lien expiré se dit sur la connexion, qui offre d’en redemander un ; l’erreur quitte l’adresse', async () => {
    await charger(ADRESSE_REFUS)
    expect((await screen.findByRole('alert')).textContent)
      .toBe('Ce lien ne peut plus servir : il a expiré, ou il a déjà été utilisé. Demande un nouveau lien ci-dessous.')
    expect(window.location.hash).toBe('#/')
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: CLIENT.email } })
    await act(async () => { fireEvent.submit(screen.getByRole('button', { name: 'Recevoir un lien' }).closest('form')!) })
    expect(faux.demandes).toEqual([[CLIENT.email, { redirectTo: 'https://compta.jdarnis.fr/' }]])
    expect(faux.ecrans).toEqual([])
  })

  it('un lien expiré ouvert là où un autre compte est connecté se dit avant l’application, qui s’ouvre ensuite', async () => {
    faux.sessionInitiale = { access_token: 'jeton-de-la-session-en-place', user: CHEF }
    await charger(ADRESSE_REFUS)
    expect((await screen.findByRole('alert')).textContent).toBe('Ce lien ne peut plus servir : il a expiré, ou il a déjà été utilisé.')
    expect(screen.getByText(/Tu es connecté avec le compte chef@cabinet-fictif\.fr\./)).toBeTruthy()
    expect(faux.ecrans).toEqual([])
    expect(window.location.hash).toBe('#/')
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    expect(await screen.findByText('Liste des dossiers')).toBeTruthy()
  })

  it('… ou « Se déconnecter » mène à la demande d’un nouveau lien, l’avis toujours dit', async () => {
    faux.sessionInitiale = { access_token: 'jeton-de-la-session-en-place', user: CHEF }
    await charger(ADRESSE_REFUS)
    await screen.findByRole('alert')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' })) })
    expect((await screen.findByRole('button', { name: 'Recevoir un lien' }))).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(/^Ce lien ne peut plus servir/)
  })

  it('sans lien, l’application s’ouvre comme avant, et une route garde son adresse', async () => {
    faux.sessionInitiale = { access_token: 'jeton-ordinaire', user: CHEF }
    await charger('/#/dossiers')
    expect(await screen.findByText('Liste des dossiers')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Choisir un nouveau mot de passe' })).toBeNull()
    expect(window.location.hash).toBe('#/dossiers')
  })
})
