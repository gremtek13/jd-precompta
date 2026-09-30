import { act, fireEvent, render, screen } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './AuthContext'

// Supabase renvoie une COPIE neuve de la session à chaque retour sur l'onglet (« SIGNED_IN », émis par
// la reprise de session d'auth-js) et à chaque jeton renouvelé (« TOKEN_REFRESHED »). Le contexte
// relisait les rôles sur l'objet : `loading` repassait à vrai, l'application retombait sur
// « Chargement… » et REMONTAIT tous ses écrans — l'aperçu d'une récupération bancaire disparaissait
// après un passage par une autre fenêtre, une saisie en cours avec lui. Ces événements se rejouent ici
// à la main : le double retient le rappel d'`onAuthStateChange`.

const faux = vi.hoisted(() => ({
  rappel: null as null | ((evenement: string, session: unknown) => void),
  sessionInitiale: null as unknown,
  lecturesAdmins: 0,
  admins: {} as Record<string, { cabinet_id: string; role: string }>,
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: faux.sessionInitiale } }),
      onAuthStateChange: (rappel: (evenement: string, session: unknown) => void) => {
        faux.rappel = rappel
        return { data: { subscription: { unsubscribe: () => { faux.rappel = null } } } }
      },
      signOut: () => Promise.resolve({ error: null }),
    },
    from: (table: string) => {
      let utilisateur = ''
      const chaine: Record<string, unknown> = {}
      Object.assign(chaine, {
        select: () => chaine,
        eq: (_colonne: string, valeur: string) => { utilisateur = valeur; return chaine },
        maybeSingle: () => {
          if (table !== 'cabinet_admins') throw new Error(`lecture inattendue : ${table}`)
          faux.lecturesAdmins++
          return Promise.resolve({ data: faux.admins[utilisateur] ?? null, error: null })
        },
      })
      return chaine
    },
    rpc: () => Promise.resolve({ data: false, error: null }),
  },
}))

// Une copie NEUVE à chaque appel, comme la reprise de session de Supabase la lit du stockage.
const session = (id: string, email: string) => ({ access_token: `jeton-${Math.random()}`, user: { id, email } })

const montages = { n: 0 }

// Ce que fait App.tsx : « Chargement… » tant que les rôles se lisent, puis les écrans.
function Ecran() {
  const { loading, session: s } = useAuth()
  if (loading) return <p>Chargement…</p>
  if (!s) return <p>Écran de connexion</p>
  return <Saisie />
}

function Saisie() {
  const { session: s, estChef } = useAuth()
  const [texte, setTexte] = useState('')
  useEffect(() => { montages.n++ }, [])
  return (
    <>
      <p>Connecté : {s?.user.email}</p>
      <p>Chef : {estChef ? 'oui' : 'non'}</p>
      <input aria-label="Saisie en cours" value={texte} onChange={(e) => setTexte(e.target.value)} />
    </>
  )
}

async function evenement(nom: string, s: unknown) {
  await act(async () => { faux.rappel!(nom, s) })
}

beforeEach(() => {
  faux.rappel = null
  faux.lecturesAdmins = 0
  faux.admins = {
    u1: { cabinet_id: 'c1', role: 'collaborateur' },
    u2: { cabinet_id: 'c1', role: 'comptable_en_chef' },
  }
  faux.sessionInitiale = session('u1', 'membre@cabinet.fr')
  montages.n = 0
})

async function monterEtSaisir() {
  render(<AuthProvider><Ecran /></AuthProvider>)
  const champ = await screen.findByLabelText<HTMLInputElement>('Saisie en cours')
  fireEvent.change(champ, { target: { value: 'une saisie en cours' } })
  expect(montages.n).toBe(1)
  expect(faux.lecturesAdmins).toBe(1)
}

describe('AuthProvider', () => {
  it('un retour sur l’onglet ne remonte pas les écrans : ce qui était affiché ou saisi reste', async () => {
    await monterEtSaisir()
    await evenement('SIGNED_IN', session('u1', 'membre@cabinet.fr'))
    expect(screen.queryByText('Chargement…')).toBeNull()
    expect(screen.getByLabelText<HTMLInputElement>('Saisie en cours').value).toBe('une saisie en cours')
    expect(montages.n).toBe(1)
    expect(faux.lecturesAdmins).toBe(1)
  })

  it('un jeton renouvelé non plus', async () => {
    await monterEtSaisir()
    await evenement('TOKEN_REFRESHED', session('u1', 'membre@cabinet.fr'))
    expect(screen.getByLabelText<HTMLInputElement>('Saisie en cours').value).toBe('une saisie en cours')
    expect(montages.n).toBe(1)
    expect(faux.lecturesAdmins).toBe(1)
  })

  it('la session du contexte suit quand même la dernière reçue, sans rien remonter', async () => {
    await monterEtSaisir()
    await evenement('USER_UPDATED', session('u1', 'nouvelle@cabinet.fr'))
    expect(screen.getByText('Connecté : nouvelle@cabinet.fr')).toBeTruthy()
    expect(screen.getByLabelText<HTMLInputElement>('Saisie en cours').value).toBe('une saisie en cours')
    expect(montages.n).toBe(1)
  })

  // Le garde symétrique : sans lui, « ne rien relire » serait satisfait par un contexte qui ne relit
  // JAMAIS les rôles — et un autre compte hériterait de ceux du précédent.
  it('un AUTRE compte relit les rôles et repart de zéro', async () => {
    await monterEtSaisir()
    expect(screen.getByText('Chef : non')).toBeTruthy()
    await evenement('SIGNED_IN', session('u2', 'chef@cabinet.fr'))
    expect(await screen.findByText('Chef : oui')).toBeTruthy()
    expect(faux.lecturesAdmins).toBe(2)
    expect(montages.n).toBe(2)
    expect(screen.getByLabelText<HTMLInputElement>('Saisie en cours').value).toBe('')
  })

  it('une déconnexion revient à l’écran de connexion', async () => {
    await monterEtSaisir()
    await evenement('SIGNED_OUT', null)
    expect(await screen.findByText('Écran de connexion')).toBeTruthy()
  })
})
