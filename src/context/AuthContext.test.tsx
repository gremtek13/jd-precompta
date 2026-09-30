import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useState, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './AuthContext'

// Supabase renvoie une COPIE neuve de la session à chaque retour sur l'onglet (« SIGNED_IN », émis par
// la reprise de session d'auth-js) et à chaque jeton renouvelé (« TOKEN_REFRESHED »). Le contexte
// relisait les rôles sur l'objet : `loading` repassait à vrai, l'application retombait sur
// « Chargement… » et REMONTAIT tous ses écrans — l'aperçu d'une récupération bancaire disparaissait
// après un passage par une autre fenêtre, une saisie en cours avec lui. Ces événements se rejouent ici
// à la main : le double retient le rappel d'`onAuthStateChange`.
//
// Et `loading` se DÉDUIT de la session et de l'identifiant pour lequel les rôles ont été lus : posé par
// l'effet, il laissait passer des rendus faux entre deux lectures — l'écran de connexion au démarrage,
// des écrans montés sans rôle puis démontés, une session accompagnée des rôles du compte précédent. Le
// dernier a fait échouer ce test lui-même une fois sur plusieurs en CI : la saisie tombait dans un écran
// monté un instant, avant que les rôles soient lus. Pour VOIR ces rendus, le double sait retenir la
// réponse de la session et celle des rôles d'un compte, et l'écran consigne ce que chaque rendu affiche.

const faux = vi.hoisted(() => ({
  rappel: null as null | ((evenement: string, session: unknown) => void),
  sessionInitiale: null as unknown,
  // La réponse de getSession, retenue tant qu'on ne la relâche pas (null : réponse immédiate).
  sessionRetenue: null as null | Promise<void>,
  sessionEchoue: false,
  lecturesAdmins: 0,
  admins: {} as Record<string, { cabinet_id: string; role: string }>,
  // La lecture des rôles d'un compte, retenue tant qu'on ne la relâche pas.
  rolesRetenus: {} as Record<string, Promise<void>>,
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => {
        if (faux.sessionRetenue) await faux.sessionRetenue
        if (faux.sessionEchoue) throw new Error('stockage de session illisible')
        return { data: { session: faux.sessionInitiale } }
      },
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
        maybeSingle: async () => {
          if (table !== 'cabinet_admins') throw new Error(`lecture inattendue : ${table}`)
          faux.lecturesAdmins++
          const retenue = faux.rolesRetenus[utilisateur]
          if (retenue) await retenue
          return { data: faux.admins[utilisateur] ?? null, error: null }
        },
      })
      return chaine
    },
    rpc: () => Promise.resolve({ data: false, error: null }),
  },
}))

// Une copie NEUVE à chaque appel, comme la reprise de session de Supabase la lit du stockage.
const session = (id: string, email: string) => ({ access_token: `jeton-${Math.random()}`, user: { id, email } })

function retenue() {
  let relacher!: () => void
  const promesse = new Promise<void>((r) => { relacher = r })
  return { promesse, relacher }
}

const montages = { n: 0 }
// Ce que chaque rendu COMMIS de l'écran a montré : « adresse:chef » ou « adresse:non ».
const rendus: string[] = []
// Les écrans d'attente et de connexion affichés, dans l'ordre.
const affichages: string[] = []

function Trace({ nom, children }: { nom: string; children: ReactNode }) {
  useEffect(() => { affichages.push(nom) }, [nom])
  return <>{children}</>
}

// Ce que fait App.tsx : « Chargement… » tant que les rôles se lisent, puis les écrans.
function Ecran() {
  const { loading, session: s } = useAuth()
  if (loading) return <Trace nom="chargement"><p>Chargement…</p></Trace>
  if (!s) return <Trace nom="connexion"><p>Écran de connexion</p></Trace>
  return <Saisie />
}

function Saisie() {
  const { session: s, estChef } = useAuth()
  const [texte, setTexte] = useState('')
  useEffect(() => { montages.n++ }, [])
  useEffect(() => { rendus.push(`${s?.user.email}:${estChef ? 'chef' : 'non'}`) })
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
  faux.sessionRetenue = null
  faux.sessionEchoue = false
  faux.lecturesAdmins = 0
  faux.admins = {
    u1: { cabinet_id: 'c1', role: 'collaborateur' },
    u2: { cabinet_id: 'c1', role: 'comptable_en_chef' },
  }
  faux.rolesRetenus = {}
  faux.sessionInitiale = session('u1', 'membre@cabinet.fr')
  montages.n = 0
  rendus.length = 0
  affichages.length = 0
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

  it('une déconnexion revient à l’écran de connexion, sans passer par « Chargement… »', async () => {
    await monterEtSaisir()
    affichages.length = 0
    await evenement('SIGNED_OUT', null)
    expect(await screen.findByText('Écran de connexion')).toBeTruthy()
    expect(affichages).toEqual(['connexion'])
  })
})

describe('AuthProvider — aucun rendu entre deux lectures', () => {
  it('au démarrage, ni l’écran de connexion ni un écran ne passent avant que la session et ses rôles soient lus', async () => {
    const reponseSession = retenue()
    faux.sessionRetenue = reponseSession.promesse
    const roles = retenue()
    faux.rolesRetenus.u1 = roles.promesse
    render(<AuthProvider><Ecran /></AuthProvider>)
    await act(async () => {})
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByText('Écran de connexion')).toBeNull()

    // La session arrive : c'est la lecture des rôles qui commence, pas l'écran.
    await act(async () => { reponseSession.relacher() })
    await waitFor(() => expect(faux.lecturesAdmins).toBe(1))
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(montages.n).toBe(0)

    await act(async () => { roles.relacher() })
    expect(await screen.findByLabelText('Saisie en cours')).toBeTruthy()
    expect(montages.n).toBe(1)
    expect(rendus).toEqual(['membre@cabinet.fr:non'])
  })

  it('un AUTRE compte ne s’affiche jamais avec les rôles du précédent', async () => {
    await monterEtSaisir()
    const roles = retenue()
    faux.rolesRetenus.u2 = roles.promesse
    await evenement('SIGNED_IN', session('u2', 'chef@cabinet.fr'))
    await waitFor(() => expect(faux.lecturesAdmins).toBe(2))
    expect(screen.getByText('Chargement…')).toBeTruthy()

    await act(async () => { roles.relacher() })
    expect(await screen.findByText('Chef : oui')).toBeTruthy()
    expect(rendus.filter((r) => r.startsWith('chef@cabinet.fr'))).toEqual(['chef@cabinet.fr:chef'])
  })

  it('personne n’étant connecté, l’écran de connexion vient tout de suite ; se reconnecter relit les rôles avant d’afficher', async () => {
    faux.sessionInitiale = null
    render(<AuthProvider><Ecran /></AuthProvider>)
    expect(await screen.findByText('Écran de connexion')).toBeTruthy()
    expect(faux.lecturesAdmins).toBe(0)

    await evenement('SIGNED_IN', session('u1', 'membre@cabinet.fr'))
    expect(await screen.findByLabelText('Saisie en cours')).toBeTruthy()
    await evenement('SIGNED_OUT', null)
    expect(await screen.findByText('Écran de connexion')).toBeTruthy()

    // Le même compte revient : ses rôles se relisent AVANT que l'écran s'affiche — un accès retiré
    // entre-temps ne doit pas se montrer une dernière fois.
    const roles = retenue()
    faux.rolesRetenus.u1 = roles.promesse
    await evenement('SIGNED_IN', session('u1', 'membre@cabinet.fr'))
    await waitFor(() => expect(faux.lecturesAdmins).toBe(2))
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByLabelText('Saisie en cours')).toBeNull()
    await act(async () => { roles.relacher() })
    expect(await screen.findByLabelText('Saisie en cours')).toBeTruthy()
  })

  it('une lecture de session qui lève mène à l’écran de connexion, jamais à un « Chargement… » sans fin', async () => {
    faux.sessionEchoue = true
    const erreurs = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<AuthProvider><Ecran /></AuthProvider>)
    expect(await screen.findByText('Écran de connexion')).toBeTruthy()
    expect(erreurs).toHaveBeenCalledWith('[session] lecture impossible :', 'stockage de session illisible')
    erreurs.mockRestore()
  })

  it('un événement de Supabase suffit à connaître la session, même si sa lecture tarde', async () => {
    faux.sessionRetenue = retenue().promesse // jamais relâchée
    render(<AuthProvider><Ecran /></AuthProvider>)
    await act(async () => {})
    expect(screen.getByText('Chargement…')).toBeTruthy()
    await evenement('INITIAL_SESSION', session('u1', 'membre@cabinet.fr'))
    expect(await screen.findByLabelText('Saisie en cours')).toBeTruthy()
  })
})
