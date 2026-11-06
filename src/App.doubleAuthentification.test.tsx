import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { lireRetourDuLien, type RetourDuLien } from './lib/recuperationMotDePasse'

// LA PORTE DU SECOND FACTEUR (ligne 51.5, étape C7), de bout en bout : le vrai AuthProvider, la vraie porte, le vrai écran du
// code et celui du nouveau mot de passe. Une session `aal1` dont le compte a un facteur vérifié ne monte AUCUN écran de
// l'application avant son code ; le code donné, auth-js annonce la session élevée (« MFA_CHALLENGE_VERIFIED ») et la porte
// s'ouvre ; `aal2`, ou sans facteur, l'application s'ouvre d'emblée ; deux clics du même geste ne vérifient qu'une fois ; et
// le lien « Mot de passe oublié » d'un tel compte demande le code avant le nouveau mot de passe.

const b64url = (valeur: unknown) => Buffer.from(JSON.stringify(valeur)).toString('base64url')
const jeton = (aal: string) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: 'u', aal })}.c2lnbmF0dXJl`
const FACTEUR = { id: 'f1', friendly_name: 'Téléphone', factor_type: 'totp', status: 'verified', created_at: '2026-11-01T09:00:00Z' }

type SessionFausse = { access_token: string; user: { id: string; email: string; factors?: unknown[] } }
const faux = vi.hoisted(() => ({
  rappel: null as null | ((evenement: string, session: unknown) => void),
  session: null as null | SessionFausse,
  chefs: new Set<string>(),
  verifications: [] as string[],
  retenue: null as null | Promise<void>,
  ecrans: [] as string[],
}))

vi.mock('./lib/supabase', () => {
  function chaine(table: string) {
    let compte = ''
    const c = {
      select: () => c,
      eq: (_colonne: string, valeur: string) => { compte = valeur; return c },
      in: () => c,
      maybeSingle: async () => ({ data: table === 'cabinet_admins' && faux.chefs.has(compte) ? { cabinet_id: 'cab1', role: 'comptable_en_chef' } : null, error: null }),
      then: (resolu: (r: unknown) => unknown, rejete: (e: unknown) => unknown) =>
        Promise.resolve({ data: table === 'memberships' ? [{ dossier_id: 'd1' }] : [{ id: 'd1', nom: 'Dossier fictif', cabinet_id: 'cab1' }], error: null }).then(resolu, rejete),
    }
    return c
  }
  return {
    supabase: {
      auth: {
        getSession: async () => ({ data: { session: faux.session }, error: null }),
        onAuthStateChange: (rappel: (evenement: string, session: unknown) => void) => {
          faux.rappel = rappel
          return { data: { subscription: { unsubscribe: () => { faux.rappel = null } } } }
        },
        signOut: async () => ({ error: null }),
        updateUser: async () => ({ data: { user: null }, error: null }),
        mfa: {
          challenge: async () => ({ data: { id: 'c1' }, error: null }),
          // Comme auth-js (GoTrueClient._verify) : la session élevée est gardée et annoncée AVANT que l'appel rende la main.
          verify: async (p: { factorId: string; code: string }) => {
            faux.verifications.push(`${p.factorId} ${p.code}`)
            if (faux.retenue) await faux.retenue
            const s = faux.session as SessionFausse
            faux.session = { ...s, access_token: jeton('aal2') }
            faux.rappel?.('MFA_CHALLENGE_VERIFIED', faux.session)
            return { data: faux.session, error: null }
          },
        },
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
vi.mock('./pages/DossiersList', async () => {
  const { useEffect } = await import('react')
  return { default: function ListeDouble() { useEffect(() => { faux.ecrans.push('liste des dossiers') }, []); return <p>Liste des dossiers</p> } }
})
vi.mock('./pages/ClientHome', async () => {
  const { useEffect } = await import('react')
  return { default: function AccueilDouble() { useEffect(() => { faux.ecrans.push('accueil du client') }, []); return <p>Accueil du client</p> } }
})
// Les écrans que la porte ne monte pas ici, doublés comme dans App.test.tsx (le relevé importe pdf.js, que jsdom ne porte pas).
vi.mock('./pages/DossierDetail', () => ({ default: () => <p>Dossier</p> }))
vi.mock('./pages/ClientUpload', () => ({ default: () => <p>Mes pièces</p> }))
vi.mock('./pages/ClientInformations', () => ({ default: () => <p>Mes informations</p> }))
vi.mock('./pages/ClientSimulation', () => ({ default: () => <p>Ma simulation</p> }))
vi.mock('./pages/SuperAdminPage', () => ({ default: () => <p>Comptes master</p> }))
vi.mock('./pages/EquipePage', () => ({ default: () => <p>Équipe</p> }))
vi.mock('./pages/CabinetBrandingPage', () => ({ default: () => <p>Apparence</p> }))
vi.mock('./pages/RetourBanque', () => ({ default: () => <p>Retour de la banque</p> }))

const CHEF = { id: 'u-chef', email: 'chef@cabinet-fictif.fr' }
const CLIENT = { id: 'u-client', email: 'client@exemple-fictif.fr' }
const AUCUN: RetourDuLien = lireRetourDuLien('https://compta.jdarnis.fr/#/')

function monter(session: SessionFausse, retour: RetourDuLien = AUCUN) {
  faux.session = session
  render(<App retourDuLien={retour} />)
}

function retenue() {
  let relacher!: () => void
  const promesse = new Promise<void>((r) => { relacher = r })
  return { promesse, relacher }
}

beforeEach(() => {
  faux.rappel = null
  faux.session = null
  faux.chefs = new Set([CHEF.id])
  faux.verifications = []
  faux.retenue = null
  faux.ecrans = []
  window.location.hash = '#/'
})

describe('la porte du second facteur', () => {
  it('aal1 avec un facteur vérifié : le code, et rien de l’application ; le code donné, l’application', async () => {
    monter({ access_token: jeton('aal1'), user: { ...CHEF, factors: [FACTEUR] } })
    expect(await screen.findByRole('heading', { name: 'Code de vérification' })).toBeTruthy()
    expect(screen.getByText(/^Ce compte est protégé par un second facteur : saisissez/)).toBeTruthy()
    expect(faux.ecrans).toEqual([])
    fireEvent.change(screen.getByLabelText('Code à six chiffres'), { target: { value: '654 321' } })
    fireEvent.click(screen.getByRole('button', { name: 'Vérifier' }))
    expect(await screen.findByText('Liste des dossiers')).toBeTruthy()
    expect(faux.verifications).toEqual(['f1 654321'])
    expect(faux.ecrans).toEqual(['liste des dossiers'])
  })

  it('deux clics du même geste ne vérifient qu’une fois ; le client est tutoyé', async () => {
    faux.chefs = new Set()
    monter({ access_token: jeton('aal1'), user: { ...CLIENT, factors: [FACTEUR] } })
    expect(await screen.findByText(/^Ton compte est protégé par un second facteur : saisis/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Code à six chiffres'), { target: { value: '654321' } })
    const r = retenue()
    faux.retenue = r.promesse
    const verifier = screen.getByRole('button', { name: 'Vérifier' })
    act(() => {
      fireEvent.click(verifier)
      fireEvent.click(verifier)
    })
    await act(async () => { r.relacher() })
    expect(await screen.findByText('Accueil du client')).toBeTruthy()
    expect(faux.verifications).toEqual(['f1 654321'])
  })

  it('aal2 avec un facteur, ou sans facteur : l’application d’emblée, sans écran du code', async () => {
    monter({ access_token: jeton('aal2'), user: { ...CHEF, factors: [FACTEUR] } })
    expect(await screen.findByText('Liste des dossiers')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Code de vérification' })).toBeNull()
  })

  it('sans facteur, un jeton aal1 ouvre l’application comme avant', async () => {
    monter({ access_token: jeton('aal1'), user: { ...CHEF, factors: [] } })
    expect(await screen.findByText('Liste des dossiers')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Code de vérification' })).toBeNull()
  })

  it('le lien « Mot de passe oublié » d’un compte à second facteur demande le code, puis le nouveau mot de passe', async () => {
    const s = { access_token: jeton('aal1'), user: { ...CHEF, factors: [FACTEUR] } }
    const retour = lireRetourDuLien(
      `https://compta.jdarnis.fr/#access_token=${s.access_token}&expires_at=1791200000&expires_in=3600&refresh_token=rt-fictif&sb=&token_type=bearer&type=recovery`)
    monter(s, retour)
    expect(await screen.findByText(/^Avant de choisir un nouveau mot de passe, saisis le code/)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Choisir un nouveau mot de passe' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Code à six chiffres'), { target: { value: '111222' } })
    fireEvent.click(screen.getByRole('button', { name: 'Vérifier' }))
    expect(await screen.findByRole('heading', { name: 'Choisir un nouveau mot de passe' })).toBeTruthy()
    expect(faux.ecrans).toEqual([])
  })
})
