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
  // Les accès clients en base, toutes personnes confondues : la lecture les FILTRE sur le compte, comme la base, et ne rend
  // que les colonnes demandées, comme PostgREST — un droit que la requête ne nomme pas n'arrive pas.
  acces: [] as Record<string, unknown>[],
  erreurAcces: null as null | { message: string },
  lecturesAcces: [] as { colonnes: string; filtre: string }[],
}))

vi.mock('../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIn } = await import('../test/filtresPostgrest')
  const projeter = (lignes: Record<string, unknown>[], colonnes: string) => {
    const noms = colonnes.split(',').map((c) => c.trim())
    return lignes.map((l) => Object.fromEntries(noms.filter((n) => n in l).map((n) => [n, l[n]])))
  }
  return {
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
        let colonnes = ''
        const predicats: ReturnType<typeof predicatEq>[] = []
        const filtres: string[] = []
        const chaine: Record<string, unknown> = {}
        Object.assign(chaine, {
          select: (c: string) => { colonnes = c; return chaine },
          eq: (colonne: string, valeur: string) => {
            utilisateur = valeur
            predicats.push(predicatEq(colonne, valeur))
            filtres.push(`${colonne}=${valeur}`)
            return chaine
          },
          in: (colonne: string, valeurs: string[]) => { predicats.push(predicatIn(colonne, valeurs)); return chaine },
          maybeSingle: async () => {
            if (table !== 'cabinet_admins') throw new Error(`lecture inattendue : ${table}`)
            faux.lecturesAdmins++
            const retenue = faux.rolesRetenus[utilisateur]
            if (retenue) await retenue
            return { data: faux.admins[utilisateur] ?? null, error: null }
          },
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
            const reponse = () => {
              if (table === 'memberships') {
                faux.lecturesAcces.push({ colonnes, filtre: filtres.join('&') })
                if (faux.erreurAcces) return { data: null, error: faux.erreurAcces }
                return { data: projeter(filtrer(faux.acces, predicats), colonnes), error: null }
              }
              if (table === 'dossiers') {
                const dossiers = [...new Set(faux.acces.map((a) => String(a.dossier_id)))].map((id) => ({ id, nom: `Société ${id}`, cabinet_id: 'c1' }))
                return { data: projeter(filtrer(dossiers, predicats), colonnes), error: null }
              }
              throw new Error(`lecture inattendue : ${table}`)
            }
            return Promise.resolve().then(reponse).then(suite, echec)
          },
        })
        return chaine
      },
      rpc: () => Promise.resolve({ data: false, error: null }),
    },
  }
})

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
  faux.acces = []
  faux.erreurAcces = null
  faux.lecturesAcces = []
  faux.sessionInitiale = session('u1', 'membre@cabinet.fr')
  montages.n = 0
  rendus.length = 0
  affichages.length = 0
  localStorage.clear()
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

// « MOT DE PASSE OUBLIÉ » : la session qu'un lien de récupération ouvre doit être reconnue DANS le rendu où elle arrive
// — App.tsx montre alors l'écran du nouveau mot de passe avant tout autre. Deux sources : le jeton de l'adresse du
// chargement (main.tsx), comparé à celui de la première session connue, et l'événement `PASSWORD_RECOVERY`, que le
// client émet après coup et aux autres onglets. Le drapeau survit dans le navigateur, pour CE compte seulement.
describe('AuthProvider — la session d’un lien « Mot de passe oublié »', () => {
  const CLE = 'jd-precompta-recuperation'
  const sessionDe = (id: string, email: string, jeton: string) => ({ access_token: jeton, user: { id, email } })
  // Ce que chaque rendu commis a montré : « compte:oui|non ».
  const vus: string[] = []

  function Sonde() {
    const { recuperation, avisDuLien, terminerRecuperation, oublierAvisDuLien, loading, session: s } = useAuth()
    useEffect(() => { vus.push(`${s?.user.email ?? 'personne'}:${recuperation ? 'oui' : 'non'}`) })
    return (
      <>
        <p>Récupération : {recuperation ? 'oui' : 'non'}</p>
        <p>Avis : {avisDuLien ?? 'aucun'}</p>
        <p>Chargement : {loading ? 'oui' : 'non'}</p>
        <button onClick={terminerRecuperation}>Terminer</button>
        <button onClick={oublierAvisDuLien}>Oublier</button>
      </>
    )
  }

  const lien = (jeton: string) => ({ nature: 'recuperation' as const, jeton })

  beforeEach(() => { vus.length = 0 })

  it('la session ouverte avec le jeton du lien est reconnue dans le rendu même où elle arrive, sans attendre l’événement', async () => {
    faux.sessionInitiale = sessionDe('u1', 'membre@cabinet.fr', 'jeton-du-lien')
    render(<AuthProvider retourDuLien={lien('jeton-du-lien')}><Sonde /></AuthProvider>)
    expect(await screen.findByText('Récupération : oui')).toBeTruthy()
    expect(localStorage.getItem(CLE)).toBe('u1')
    // Jamais un rendu avec la session et sans la récupération : l'application n'a pas pu passer avant l'écran.
    expect(vus).not.toContain('membre@cabinet.fr:non')
  })

  it('l’événement PASSWORD_RECOVERY suffit aussi — un autre onglet, ou un jeton déjà renouvelé', async () => {
    faux.sessionInitiale = sessionDe('u1', 'membre@cabinet.fr', 'jeton-renouvele')
    render(<AuthProvider retourDuLien={lien('jeton-du-lien')}><Sonde /></AuthProvider>)
    expect(await screen.findByText('Chargement : non')).toBeTruthy()
    expect(screen.getByText('Récupération : non')).toBeTruthy()
    // Une session ouverte, même avec un autre jeton : le lien n'a rien à dire.
    expect(screen.getByText('Avis : aucun')).toBeTruthy()
    await evenement('PASSWORD_RECOVERY', sessionDe('u1', 'membre@cabinet.fr', 'jeton-renouvele'))
    expect(screen.getByText('Récupération : oui')).toBeTruthy()
    expect(localStorage.getItem(CLE)).toBe('u1')
  })

  it('le mot de passe choisi, plus rien n’est dû — et la même session revue au retour sur l’onglet ne le redemande pas', async () => {
    faux.sessionInitiale = sessionDe('u1', 'membre@cabinet.fr', 'jeton-du-lien')
    render(<AuthProvider retourDuLien={lien('jeton-du-lien')}><Sonde /></AuthProvider>)
    expect(await screen.findByText('Récupération : oui')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Terminer' }))
    expect(screen.getByText('Récupération : non')).toBeTruthy()
    expect(localStorage.getItem(CLE)).toBeNull()
    // Le retour sur l'onglet émet « SIGNED_IN » avec la session gardée — le MÊME jeton, dans l'heure : le lien est jugé.
    await evenement('SIGNED_IN', sessionDe('u1', 'membre@cabinet.fr', 'jeton-du-lien'))
    expect(screen.getByText('Récupération : non')).toBeTruthy()
  })

  it('un mot de passe changé dans un autre onglet (USER_UPDATED) clôt la récupération ici aussi', async () => {
    faux.sessionInitiale = sessionDe('u1', 'membre@cabinet.fr', 'jeton-du-lien')
    render(<AuthProvider retourDuLien={lien('jeton-du-lien')}><Sonde /></AuthProvider>)
    expect(await screen.findByText('Récupération : oui')).toBeTruthy()
    await evenement('USER_UPDATED', sessionDe('u1', 'membre@cabinet.fr', 'jeton-du-lien'))
    expect(screen.getByText('Récupération : non')).toBeTruthy()
    expect(localStorage.getItem(CLE)).toBeNull()
  })

  it('une déconnexion clôt la récupération', async () => {
    faux.sessionInitiale = sessionDe('u1', 'membre@cabinet.fr', 'jeton-du-lien')
    render(<AuthProvider retourDuLien={lien('jeton-du-lien')}><Sonde /></AuthProvider>)
    expect(await screen.findByText('Récupération : oui')).toBeTruthy()
    await evenement('SIGNED_OUT', null)
    expect(screen.getByText('Récupération : non')).toBeTruthy()
    expect(localStorage.getItem(CLE)).toBeNull()
    // Le lien a ouvert une session : se déconnecter ne le fait pas passer pour un lien sans effet.
    expect(screen.getByText('Avis : aucun')).toBeTruthy()
  })

  it('un rechargement retrouve la récupération : le drapeau survit, pour ce compte et une fois la session connue', async () => {
    localStorage.setItem(CLE, 'u1')
    const reponseSession = retenue()
    faux.sessionRetenue = reponseSession.promesse
    faux.sessionInitiale = sessionDe('u1', 'membre@cabinet.fr', 'jeton-quelconque')
    render(<AuthProvider><Sonde /></AuthProvider>)
    await act(async () => {})
    expect(screen.getByText('Récupération : non')).toBeTruthy()
    await act(async () => { reponseSession.relacher() })
    expect(await screen.findByText('Récupération : oui')).toBeTruthy()
  })

  it('le drapeau d’un AUTRE compte ne vaut rien pour celui-ci', async () => {
    localStorage.setItem(CLE, 'u2')
    render(<AuthProvider><Sonde /></AuthProvider>)
    expect(await screen.findByText('Chargement : non')).toBeTruthy()
    expect(screen.getByText('Récupération : non')).toBeTruthy()
  })

  it('une session absente efface le drapeau : il ne ressurgit pas à la connexion suivante par mot de passe', async () => {
    localStorage.setItem(CLE, 'u1')
    faux.sessionInitiale = null
    render(<AuthProvider><Sonde /></AuthProvider>)
    expect(await screen.findByText('Chargement : non')).toBeTruthy()
    expect(localStorage.getItem(CLE)).toBeNull()
    await evenement('SIGNED_IN', session('u1', 'membre@cabinet.fr'))
    expect(await screen.findByText('Chargement : non')).toBeTruthy()
    expect(screen.getByText('Récupération : non')).toBeTruthy()
  })

  it('un lien dont le jeton n’a ouvert aucune session se dit, jusqu’à la connexion suivante', async () => {
    faux.sessionInitiale = null
    render(<AuthProvider retourDuLien={lien('jeton-du-lien')}><Sonde /></AuthProvider>)
    expect(await screen.findByText(
      "Avis : Ce lien n'a pas pu ouvrir de session : il a peut-être expiré, ou le service n'a pas répondu.",
    )).toBeTruthy()
    expect(screen.getByText('Récupération : non')).toBeTruthy()
    await evenement('SIGNED_IN', session('u1', 'membre@cabinet.fr'))
    expect(screen.getByText('Avis : aucun')).toBeTruthy()
  })

  it('un lien refusé se dit dès le chargement, et se congédie', async () => {
    faux.sessionInitiale = null
    render(<AuthProvider retourDuLien={{ nature: 'refus', code: 'otp_expired' }}><Sonde /></AuthProvider>)
    expect(await screen.findByText('Avis : Ce lien ne peut plus servir : il a expiré, ou il a déjà été utilisé.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Oublier' }))
    expect(screen.getByText('Avis : aucun')).toBeTruthy()
  })
})

// LES DROITS D'UN ACCÈS (espace client, étape P1) : « Ventes » et « Banque », lus avec les accès qu'AuthContext lit déjà —
// dans la MÊME requête, au même moment : au changement d'identifiant, jamais sur l'objet session. Exposés par dossier pour
// les étapes qui ouvriront « Mes ventes » et « Ma banque » ; aucun écran ne s'en sert encore. Un droit ne s'accorde jamais
// par défaut : une lecture en échec, une valeur qui n'est pas strictement vraie, un dossier absent n'en donnent aucun.
describe('AuthProvider — les droits de chaque accès du client', () => {
  // Ce que chaque rendu commis a montré : « rôle | dossiers | d1=VB … », V et B pour chaque droit tenu.
  const vus: string[] = []

  function SondeDroits() {
    const { loading, role, dossierIds, droitsParDossier: droits } = useAuth()
    const texte = loading
      ? 'chargement'
      : `${role ?? 'personne'} | ${dossierIds.join(',')} | ${Object.keys(droits).sort()
        .map((d) => `${d}=${droits[d].ventes ? 'V' : ''}${droits[d].banque ? 'B' : ''}`).join(' ')}`
    useEffect(() => { vus.push(texte) })
    return <p>Droits : {texte}</p>
  }

  const acces = (user_id: string, dossier_id: string, droit_ventes: unknown, droit_banque: unknown) =>
    ({ id: `${user_id}-${dossier_id}`, user_id, dossier_id, role: 'client', email: null, droit_ventes, droit_banque })

  beforeEach(() => {
    vus.length = 0
    faux.acces = [
      acces('u3', 'd1', true, false),
      acces('u3', 'd2', false, false),
      // L'accès d'une AUTRE personne au même dossier : il ne doit rien donner à u3.
      acces('u4', 'd2', true, true),
    ]
    faux.sessionInitiale = session('u3', 'client@exemple.fr')
  })

  it('lit les droits de chaque accès dans la même requête que les accès, filtrée sur le compte', async () => {
    render(<AuthProvider><SondeDroits /></AuthProvider>)
    expect(await screen.findByText('Droits : client | d1,d2 | d1=V d2=')).toBeTruthy()
    expect(faux.lecturesAcces).toEqual([{ colonnes: 'dossier_id, droit_ventes, droit_banque', filtre: 'user_id=u3' }])
    // Jamais un rendu avec les accès et sans leurs droits, ni avec les droits d'un autre compte.
    expect(vus.filter((v) => v !== 'chargement')).toEqual(['client | d1,d2 | d1=V d2='])
  })

  it('une valeur qui n’est pas strictement vraie n’accorde rien', async () => {
    faux.acces = [acces('u3', 'd1', 'true', 1), acces('u3', 'd2', null, undefined)]
    render(<AuthProvider><SondeDroits /></AuthProvider>)
    expect(await screen.findByText('Droits : client | d1,d2 | d1= d2=')).toBeTruthy()
  })

  it('une lecture des accès en échec ne donne aucun droit', async () => {
    faux.erreurAcces = { message: 'JWT expired' }
    render(<AuthProvider><SondeDroits /></AuthProvider>)
    expect(await screen.findByText('Droits : client | |')).toBeTruthy()
  })

  it('ne se relisent qu’au changement d’identifiant : un retour sur l’onglet ou un jeton renouvelé n’y touchent pas', async () => {
    render(<AuthProvider><SondeDroits /></AuthProvider>)
    expect(await screen.findByText('Droits : client | d1,d2 | d1=V d2=')).toBeTruthy()
    // Le cabinet coche « Banque » sur d2 pendant que le client a l'application ouverte : la base change, l'écran du client
    // le verra à sa prochaine connexion — d'ici là, la base refuse ce qu'il tenterait sans le droit.
    faux.acces = [acces('u3', 'd1', true, false), acces('u3', 'd2', false, true)]
    await evenement('SIGNED_IN', session('u3', 'client@exemple.fr'))
    await evenement('TOKEN_REFRESHED', session('u3', 'client@exemple.fr'))
    expect(screen.getByText('Droits : client | d1,d2 | d1=V d2=')).toBeTruthy()
    expect(faux.lecturesAcces).toHaveLength(1)

    await evenement('SIGNED_OUT', null)
    expect(await screen.findByText('Droits : personne | |')).toBeTruthy()
    await evenement('SIGNED_IN', session('u3', 'client@exemple.fr'))
    expect(await screen.findByText('Droits : client | d1,d2 | d1=V d2=B')).toBeTruthy()
    expect(faux.lecturesAcces).toHaveLength(2)
  })

  it('un AUTRE compte repart de ses propres droits, jamais de ceux du précédent', async () => {
    render(<AuthProvider><SondeDroits /></AuthProvider>)
    expect(await screen.findByText('Droits : client | d1,d2 | d1=V d2=')).toBeTruthy()
    await evenement('SIGNED_IN', session('u4', 'autre@exemple.fr'))
    expect(await screen.findByText('Droits : client | d2 | d2=VB')).toBeTruthy()
    expect(vus.filter((v) => v.startsWith('client | d2 '))).toEqual(['client | d2 | d2=VB'])
  })

  it('un compte du cabinet n’a aucun droit d’accès, et ses accès ne se lisent pas', async () => {
    faux.sessionInitiale = session('u2', 'chef@cabinet.fr')
    faux.acces.push(acces('u2', 'd1', true, true))
    render(<AuthProvider><SondeDroits /></AuthProvider>)
    expect(await screen.findByText('Droits : cabinet | |')).toBeTruthy()
    expect(faux.lecturesAcces).toEqual([])
  })

  it('un compte du cabinet qui succède à un client, sans déconnexion entre les deux, ne garde aucun de ses droits', async () => {
    render(<AuthProvider><SondeDroits /></AuthProvider>)
    expect(await screen.findByText('Droits : client | d1,d2 | d1=V d2=')).toBeTruthy()
    // Une connexion faite dans un autre onglet arrive en SIGNED_IN d'un autre identifiant : pas de SIGNED_OUT qui viderait
    // les droits avant. C'est la branche du cabinet qui doit les vider elle-même.
    await evenement('SIGNED_IN', session('u2', 'chef@cabinet.fr'))
    expect(await screen.findByText('Droits : cabinet | |')).toBeTruthy()
    // Aucun rendu du cabinet, pas même un seul, avec les droits du client d'avant.
    const vusDuCabinet = vus.filter((v) => v.startsWith('cabinet')).map((v) => v.replace(/\s+/g, ' ').trim())
    expect(vusDuCabinet.length).toBeGreaterThan(0)
    expect(vusDuCabinet.filter((v) => v !== 'cabinet | |')).toEqual([])
  })
})
