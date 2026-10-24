import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ConnexionsClient from './ConnexionsClient'
import PlateformeClientModal from './PlateformeClientModal'
import SuperPdpModal from './SuperPdpModal'
import { motsDuCabinet } from '../../lib/espaceVentes'
import type { ConnexionPlateformeVue } from '../../lib/receptionPlateforme'
import { adresse, SIREN_FICTIF } from '../../test/adressesReception'

// LES CONNEXIONS DU CLIENT (espace client, étape P4b, sous l'hypothèse EC-Q4) : la section « Tes plateformes » de « Mes
// ventes », et les deux fenêtres du cabinet montées en mode client. Les VRAIS modules de la réception (lib/receptionPlateforme.ts,
// lib/releveStatuts.ts) devant un faux client qui répond comme les fonctions : ce qui part, et quand, se lit à `faux.appels`.
// Ce que ces cas gardent :
//
//  1. La section selon l'état : rien de dit avant la lecture ; rien relié, plateforme reliée, Super PDP configuré, lecture en
//     échec (avec son motif, réécrit pour le client, et « Réessayer ») ; une fenêtre fermée relit les deux.
//  2. Les fenêtres en mode client : les gestes de la vente (relier, modifier, tester, retirer, relire les statuts ;
//     enregistrer et retirer les identifiants Super PDP) présents ; la RÉCEPTION (chercher, reprendre, synchroniser) absente,
//     bouton et texte ; le secret jamais affiché ; deux puis trois clics sur « Enregistrer » dans le même `act` : un envoi.
//  4. Le troisième bloc, « Ton adresse de réception » (étape A6b1) : rien de dit avant la lecture, l'état lu (aucune déclarée,
//     l'adresse et sa prise d'effet, à venir, lecture ratée ou rompue), sa fenêtre, et la relecture à sa fermeture.
//  3. Le garde des mots (`motsDuCabinet`, étape P4a) sur ces fenêtres en mode client, et son DÉFAUT PLANTÉ : les mêmes états
//     montés pour le cabinet, où il trouve chaque fois au moins une forme.
//
// Données FICTIVES ; aucun secret réel.

const faux = vi.hoisted(() => ({
  appels: [] as Record<string, unknown>[],
  connexion: null as unknown,
  superpdp: false,
  // Une réponse fabriquée à la place de la réponse normale, par fonction et action (« plateforme-agreee tester »).
  refus: {} as Record<string, { status: number; corps: Record<string, unknown> }>,
  // L'adresse de réception de la société (étape A6b1), lue dans la base ; son refus ; le nombre de lectures de la table.
  adresses: [] as Record<string, unknown>[],
  refusAdresses: null as string | null,
  lecturesAdresses: 0,
  // Les réponses aux écritures restent EN ATTENTE tant que le cas ne les libère pas.
  retenir: false,
  enAttente: [] as (() => void)[],
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: async (nom: string, options: { body: Record<string, unknown> }) => {
        faux.appels.push({ ...options.body, fonction: nom })
        const action = String(options.body.action ?? '')
        const refus = faux.refus[`${nom} ${action}`]
        const ecriture = ['enregistrer', 'retirer', 'save', 'remove'].includes(action)
        if (ecriture && faux.retenir) await new Promise<void>((r) => { faux.enAttente.push(r) })
        if (refus) return { data: null, error: { context: new Response(JSON.stringify(refus.corps), { status: refus.status }) } }
        if (nom === 'plateforme-agreee') {
          if (action === 'statut') return { data: { connexion: faux.connexion }, error: null }
          if (action === 'enregistrer') {
            // La fonction rend la connexion enregistrée, JAMAIS le secret (ConnexionPlateformeVue n'en a pas).
            faux.connexion = connexionDe(options.body)
            return { data: { connexion: faux.connexion }, error: null }
          }
          if (action === 'tester') return { data: { ok: true }, error: null }
          if (action === 'retirer') { faux.connexion = null; return { data: { ok: true }, error: null } }
        }
        if (nom === 'superpdp-credentials') {
          if (action === 'status') return { data: { configured: faux.superpdp, client_id: faux.superpdp ? 'app-fictive' : null }, error: null }
          if (action === 'save') { faux.superpdp = true; return { data: { ok: true }, error: null } }
          if (action === 'remove') { faux.superpdp = false; return { data: { ok: true }, error: null } }
        }
        throw new Error(`Appel non attendu : ${nom} ${action}`)
      },
    },
    // Les deux lectures de l'adresse de réception (étape A6b1) : ses lignes, filtrées comme PostgREST, et le SIRET du dossier.
    from: (table: string) => {
      if (table !== 'adresses_reception' && table !== 'dossiers') throw new Error(`Table non attendue dans ce test : ${table}`)
      const predicats: ((l: Record<string, unknown>) => boolean)[] = []
      const c: Record<string, unknown> = {}
      Object.assign(c, {
        select: () => c,
        eq: (colonne: string, valeur: unknown) => { predicats.push((l) => l[colonne] === valeur); return c },
        order: () => c,
        range: () => c,
        maybeSingle: () => c,
        then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
          let reponse: unknown
          if (table === 'dossiers') reponse = { data: { siret: '12345678200010' }, error: null }
          else {
            faux.lecturesAdresses += 1
            const lignes = faux.adresses.filter((l) => predicats.every((p) => p(l)))
            reponse = faux.refusAdresses
              ? { data: null, error: { message: faux.refusAdresses }, count: null }
              : { data: lignes, error: null, count: lignes.length }
          }
          return Promise.resolve(reponse).then(suite, echec)
        },
      })
      return c
    },
  },
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ session: { user: { id: 'u-client' } } }) }))

const HOTE = 'flux.plateforme-fictive.fr'
// Typée, sans `as` : le compilateur confronte chaque champ à ce que la fonction rend.
function connexion(o: Partial<ConnexionPlateformeVue> = {}): ConnexionPlateformeVue {
  return {
    nom: 'Plateforme fictive', url_flux: `https://${HOTE}/flux`, url_jeton: `https://${HOTE}/jeton`, hote: HOTE,
    client_id: 'app-societe', organisation_id: null, portee: null, recherche_depuis: '2027-10-01T08:00:00Z',
    derniere_recuperation: '2027-10-02T08:00:00Z', cycle_vie_depuis: null, cycle_vie_lu_le: null,
    created_at: '2027-09-01T08:00:00Z', version: 'v1', ...o,
  }
}
function connexionDe(corps: Record<string, unknown>): ConnexionPlateformeVue {
  return connexion({
    nom: String(corps.nom), url_flux: String(corps.url_flux), url_jeton: String(corps.url_jeton), client_id: String(corps.client_id),
    recherche_depuis: null, derniere_recuperation: null, version: 'v2',
  })
}

const SECRET = 'secret-fictif-a-ne-jamais-afficher'

let confirmations: string[] = []
let accepter = false

beforeEach(() => {
  faux.appels = []
  faux.connexion = null
  faux.superpdp = false
  faux.refus = {}
  faux.adresses = []
  faux.refusAdresses = null
  faux.lecturesAdresses = 0
  faux.retenir = false
  faux.enAttente = []
  confirmations = []
  accepter = false
  vi.spyOn(window, 'confirm').mockImplementation((message?: string) => { confirmations.push(message ?? ''); return accepter })
})
afterEach(() => {
  vi.restoreAllMocks()
})

// Tout le texte qu'un état montre : les nœuds de texte, les titres, les textes d'aide, et les confirmations demandées.
function texteRendu(): string {
  const morceaux: string[] = []
  const marche = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = marche.nextNode(); n; n = marche.nextNode()) if (n.nodeValue?.trim()) morceaux.push(n.nodeValue)
  for (const e of document.body.querySelectorAll('[title], [placeholder], [aria-label]')) {
    for (const a of ['title', 'placeholder', 'aria-label']) if (e.getAttribute(a)) morceaux.push(e.getAttribute(a) as string)
  }
  return [...morceaux, ...confirmations].join('\n')
}

const appelsDe = (nom: string, action?: string) =>
  faux.appels.filter((a) => a.fonction === nom && (action === undefined || a.action === action))

async function libererTout() {
  await act(async () => {
    while (faux.enAttente.length > 0) faux.enAttente.shift()?.()
    await Promise.resolve()
  })
}

// ── 1. La section « Tes plateformes » ────────────────────────────────────────────────────────────────────────────────
describe('« Tes plateformes », selon l’état', () => {
  const relireConnexion = vi.fn(async () => {})
  const monterSection = (c: ConnexionPlateformeVue | null | undefined, erreur: string | null = null) =>
    render(<ConnexionsClient dossierId="d1" connexion={c} connexionErreur={erreur} relireConnexion={relireConnexion} />)

  beforeEach(() => relireConnexion.mockClear())

  it('avant toute réponse : rien n’est affirmé, aucun bouton n’est offert', () => {
    monterSection(undefined)
    expect(texteRendu()).not.toMatch(/aucune|pas relié/)
    expect(screen.queryAllByRole('button')).toEqual([])
    screen.getByText('Ta plateforme agréée : lecture…')
    screen.getByText('Super PDP : lecture…')
  })

  it('rien de relié : chacune le dit, et s’offre à relier', async () => {
    monterSection(null)
    await screen.findByText('Super PDP : pas relié à ta société. Relie-le si ta société y émet ses factures.')
    screen.getByText(/^Ta plateforme agréée : aucune n’est reliée à ta société\./)
    screen.getByRole('button', { name: 'Relier ta plateforme' })
    screen.getByRole('button', { name: 'Relier Super PDP' })
    expect(appelsDe('superpdp-credentials')).toEqual([{ fonction: 'superpdp-credentials', dossierId: 'd1', action: 'status' }])
  })

  it('la plateforme reliée : son nom et son hôte, et « Gérer ta plateforme »', async () => {
    monterSection(connexion())
    await screen.findByRole('button', { name: 'Relier Super PDP' })
    const phrases = [...document.querySelectorAll('p')].map((p) => p.textContent)
    expect(phrases).toContain(`Ta plateforme agréée : Plateforme fictive (${HOTE}), reliée à ta société.`)
    screen.getByRole('button', { name: 'Gérer ta plateforme' })
    expect(screen.queryByRole('button', { name: 'Relier ta plateforme' })).toBeNull()
  })

  it('Super PDP configuré : « relié », et « Gérer Super PDP »', async () => {
    faux.superpdp = true
    monterSection(null)
    await screen.findByText('Super PDP : relié à ta société.')
    screen.getByRole('button', { name: 'Gérer Super PDP' })
  })

  it('une lecture en échec se dit avec son motif, réécrit pour le client, sans geste qui la remplace ; « Réessayer » relit', async () => {
    faux.refus['superpdp-credentials status'] = { status: 503, corps: { error: 'Le statut Super PDP de ce dossier n\'a pas pu être lu (panne).' } }
    monterSection(undefined, 'La connexion à la plateforme du client n’a pas pu être lue.')
    await screen.findByText(/^Super PDP : Le statut Super PDP/)
    screen.getByText(/^Ta plateforme agréée : La connexion à ta plateforme n’a pas pu être lue\./)
    expect(screen.queryByRole('button', { name: /Relier|Gérer/ })).toBeNull()
    expect(motsDuCabinet(texteRendu())).toEqual([])
    const [plateforme, superpdp] = screen.getAllByRole('button', { name: 'Réessayer' })
    fireEvent.click(plateforme)
    expect(relireConnexion).toHaveBeenCalledTimes(1)
    delete faux.refus['superpdp-credentials status']
    await act(async () => { fireEvent.click(superpdp) })
    await screen.findByText(/^Super PDP : pas relié/)
    expect(appelsDe('superpdp-credentials', 'status')).toHaveLength(2)
  })

  it('une fenêtre fermée relit la connexion et Super PDP : elle a pu relier ou retirer', async () => {
    monterSection(null)
    fireEvent.click(await screen.findByRole('button', { name: 'Relier Super PDP' }))
    await screen.findByRole('heading', { name: 'Super PDP' })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Fermer' })) })
    expect(relireConnexion).toHaveBeenCalledTimes(1)
    expect(appelsDe('superpdp-credentials', 'status').length).toBeGreaterThanOrEqual(3)
  })
})

// ── 2. Les fenêtres en mode client ───────────────────────────────────────────────────────────────────────────────────
async function ouvrirPlateforme(espace: 'client' | 'cabinet') {
  render(espace === 'client'
    ? <PlateformeClientModal espace="client" dossierId="d1" onClose={() => {}} />
    : <PlateformeClientModal espace="cabinet" dossierId="d1" dossierSiret="12345678200010" ventesParLesFactures={false} onClose={() => {}} onImported={() => {}} />)
  await act(async () => {})
}
async function ouvrirSuperPdp(espace: 'client' | 'cabinet') {
  render(espace === 'client'
    ? <SuperPdpModal espace="client" dossierId="d1" onClose={() => {}} />
    : <SuperPdpModal espace="cabinet" dossierId="d1" onClose={() => {}} onImported={() => {}} />)
  await act(async () => {})
}

function remplir(secret = SECRET) {
  fireEvent.change(screen.getByLabelText('Nom de la plateforme'), { target: { value: 'Plateforme fictive' } })
  fireEvent.change(screen.getByLabelText('Adresse du service des flux (API AFNOR)'), { target: { value: `https://${HOTE}/flux` } })
  fireEvent.change(screen.getByLabelText('Adresse des jetons (OAuth2)'), { target: { value: `https://${HOTE}/jeton` } })
  fireEvent.change(screen.getByLabelText('Identifiant (client_id)'), { target: { value: 'app-societe' } })
  fireEvent.change(screen.getByLabelText('Secret (client_secret)'), { target: { value: secret } })
}

// Aucun champ ne garde le secret, et aucun texte ne le porte.
function secretAffiche(): boolean {
  const champs = [...document.querySelectorAll('input')].some((i) => i.value.includes(SECRET))
  return champs || texteRendu().includes(SECRET)
}

describe('« Ta plateforme agréée » en mode client', () => {
  it('reliée : les gestes de la vente, et aucun de la réception — ni bouton, ni texte ; rien n’est lu de Super PDP', async () => {
    faux.connexion = connexion()
    await ouvrirPlateforme('client')
    screen.getByRole('heading', { name: 'Ta plateforme agréée' })
    for (const nom of ['Tester la connexion', 'Modifier', 'Relire les statuts depuis le début', 'Retirer']) {
      screen.getByRole('button', { name: nom })
    }
    expect(screen.queryByRole('button', { name: 'Chercher les nouvelles factures' })).toBeNull()
    // La connexion porte un point de reprise : au cabinet, « Reprendre du début » s'offrirait.
    expect(screen.queryByRole('button', { name: 'Reprendre du début' })).toBeNull()
    const texte = texteRendu()
    expect(texte).not.toMatch(/Dernière récupération|pièce « à valider »|\bRecherche\b|importer|synchronisation/i)
    expect(appelsDe('superpdp-credentials')).toEqual([])
    expect(faux.appels.map((a) => `${a.fonction} ${a.action}`)).toEqual(['plateforme-agreee statut'])
  })

  it('au cabinet, la même connexion offre la réception (le témoin)', async () => {
    faux.connexion = connexion()
    await ouvrirPlateforme('cabinet')
    screen.getByRole('button', { name: 'Chercher les nouvelles factures' })
    screen.getByRole('button', { name: 'Reprendre du début' })
    expect(appelsDe('superpdp-credentials', 'status')).toHaveLength(1)
  })

  it('relier : le secret part à la fonction, et ne s’affiche jamais — ni après l’enregistrement, ni à la modification', async () => {
    await ouvrirPlateforme('client')
    fireEvent.click(screen.getByRole('button', { name: 'Relier ta plateforme' }))
    remplir()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' })) })
    const [envoi] = appelsDe('plateforme-agreee', 'enregistrer')
    expect(envoi.client_secret).toBe(SECRET)
    await screen.findByText(/^Connexion enregistrée\./)
    expect(secretAffiche()).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Modifier' }))
    expect((screen.getByLabelText('Secret (client_secret)') as HTMLInputElement).value).toBe('')
    expect(secretAffiche()).toBe(false)
    screen.getByText(/Laissé vide, le secret enregistré est gardé tant que les deux adresses restent les mêmes/)
  })

  it.each([2, 3])('%i clics sur « Enregistrer » dans le même `act` : un seul envoi', async (clics) => {
    await ouvrirPlateforme('client')
    fireEvent.click(screen.getByRole('button', { name: 'Relier ta plateforme' }))
    remplir()
    faux.retenir = true
    const bouton = screen.getByRole('button', { name: 'Enregistrer' })
    await act(async () => { for (let i = 0; i < clics; i++) fireEvent.click(bouton) })
    expect(appelsDe('plateforme-agreee', 'enregistrer')).toHaveLength(1)
    await libererTout()
    await screen.findByText(/^Connexion enregistrée\./)
    expect(appelsDe('plateforme-agreee', 'enregistrer')).toHaveLength(1)
  })

  it('une adresse changée sans le secret : le refus de la fonction, tutoyé', async () => {
    faux.connexion = connexion()
    faux.refus['plateforme-agreee enregistrer'] = {
      status: 400,
      corps: { error: 'Une adresse change : ressaisissez le secret, qui ne part jamais vers une adresse pour laquelle il n\'a pas été saisi.' },
    }
    await ouvrirPlateforme('client')
    fireEvent.click(screen.getByRole('button', { name: 'Modifier' }))
    fireEvent.change(screen.getByLabelText('Adresse des jetons (OAuth2)'), { target: { value: 'https://autre.exemple-fictif.fr/jeton' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' })) })
    await screen.findByText(/^Une adresse change : ressaisis le secret,/)
    expect(motsDuCabinet(texteRendu())).toEqual([])
  })

  it('retirer : la confirmation dit ce que le client perd, et la connexion se retire', async () => {
    faux.connexion = connexion()
    accepter = true
    await ouvrirPlateforme('client')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retirer' })) })
    expect(confirmations[0]).toMatch(/^Retirer la connexion à ta plateforme \?/)
    expect(confirmations[0]).toContain('ton cabinet n’en recevra plus tes factures')
    expect(appelsDe('plateforme-agreee', 'retirer')).toHaveLength(1)
    await screen.findByText('Aucune plateforme n’est reliée à ta société.')
  })
})

describe('« Super PDP » en mode client', () => {
  it('configuré : changer et retirer les identifiants ; ni synchronisation, ni texte d’import ; rien n’est lu de la plateforme', async () => {
    faux.superpdp = true
    await ouvrirSuperPdp('client')
    screen.getByRole('heading', { name: 'Super PDP' })
    screen.getByRole('button', { name: 'Changer les identifiants' })
    screen.getByRole('button', { name: 'Retirer' })
    expect(screen.queryByRole('button', { name: 'Synchroniser maintenant' })).toBeNull()
    expect(texteRendu()).not.toMatch(/Récupère automatiquement|importée|synchronisation/i)
    expect(faux.appels.map((a) => `${a.fonction} ${a.action}`)).toEqual(['superpdp-credentials status'])
  })

  it('au cabinet, « Synchroniser maintenant » existe (le témoin)', async () => {
    faux.superpdp = true
    await ouvrirSuperPdp('cabinet')
    screen.getByRole('button', { name: 'Synchroniser maintenant' })
  })

  it.each([2, 3])('%i clics sur « Enregistrer » dans le même `act` : un seul envoi, le statut relu, le secret jamais affiché', async (clics) => {
    await ouvrirSuperPdp('client')
    fireEvent.change(screen.getByLabelText('Identifiant (client_id)'), { target: { value: 'app-fictive' } })
    fireEvent.change(screen.getByLabelText('Secret (client_secret)'), { target: { value: SECRET } })
    faux.retenir = true
    const bouton = screen.getByRole('button', { name: 'Enregistrer' })
    await act(async () => { for (let i = 0; i < clics; i++) fireEvent.click(bouton) })
    expect(appelsDe('superpdp-credentials', 'save')).toHaveLength(1)
    await libererTout()
    await screen.findByText('Configuré')
    expect(appelsDe('superpdp-credentials', 'save')).toHaveLength(1)
    expect(appelsDe('superpdp-credentials', 'status')).toHaveLength(2)
    expect(secretAffiche()).toBe(false)
  })

  it('retirer : la confirmation dit ce que le client perd', async () => {
    faux.superpdp = true
    accepter = true
    await ouvrirSuperPdp('client')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retirer' })) })
    expect(confirmations[0]).toMatch(/^Retirer les identifiants Super PDP de ta société \?/)
    expect(appelsDe('superpdp-credentials', 'remove')).toHaveLength(1)
    await screen.findByLabelText('Secret (client_secret)')
  })
})

// ── 3. Le garde des mots ─────────────────────────────────────────────────────────────────────────────────────────────
interface Etat {
  nom: string
  poser?: () => void
  ouvrir: (espace: 'client' | 'cabinet') => Promise<void>
  atteindre?: () => Promise<void>
}

const ETATS: Etat[] = [
  { nom: 'la plateforme, rien de relié', ouvrir: ouvrirPlateforme },
  { nom: 'la plateforme reliée', poser: () => { faux.connexion = connexion() }, ouvrir: ouvrirPlateforme },
  {
    nom: 'la plateforme, sa modification',
    poser: () => { faux.connexion = connexion() },
    ouvrir: ouvrirPlateforme,
    atteindre: async () => { fireEvent.click(screen.getByRole('button', { name: 'Modifier' })) },
  },
  {
    nom: 'la plateforme, la confirmation du retrait',
    poser: () => { faux.connexion = connexion() },
    ouvrir: ouvrirPlateforme,
    atteindre: async () => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retirer' })) }) },
  },
  {
    nom: 'la plateforme, un test refusé faute de droits',
    poser: () => {
      faux.connexion = connexion()
      faux.refus['plateforme-agreee tester'] = {
        status: 502,
        corps: {
          error: 'La plateforme refuse l\'accès (flux, 403) : l\'identité ouverte au cabinet n\'a pas les droits de lecture des '
            + 'flux de cette entreprise, ou l\'organisation est à préciser.',
          acces_refuse: true,
        },
      }
    },
    ouvrir: ouvrirPlateforme,
    atteindre: async () => {
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tester la connexion' })) })
      await screen.findByText(/La plateforme refuse l'accès/)
    },
  },
  {
    nom: 'la plateforme, les statuts relus et refusés faute d’identifiants acceptés',
    poser: () => {
      faux.connexion = connexion()
      faux.refus['plateforme-agreee relever'] = {
        status: 401, corps: { error: 'La plateforme refuse l’identité enregistrée.', identifiants_refuses: true },
      }
      accepter = true
    },
    ouvrir: ouvrirPlateforme,
    atteindre: async () => {
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Relire les statuts depuis le début' })) })
      await screen.findByText(/La plateforme refuse l’identité enregistrée/)
    },
  },
  // Super PDP, la plateforme reliée elle aussi : au cabinet, la fenêtre dit qu'une facture entrerait deux fois.
  { nom: 'Super PDP, rien de configuré', poser: () => { faux.connexion = connexion() }, ouvrir: ouvrirSuperPdp },
  {
    nom: 'Super PDP configuré, et la confirmation de son retrait',
    poser: () => { faux.connexion = connexion(); faux.superpdp = true },
    ouvrir: ouvrirSuperPdp,
    atteindre: async () => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retirer' })) }) },
  },
]

async function atteindre(espace: 'client' | 'cabinet', e: Etat): Promise<string> {
  e.poser?.()
  await e.ouvrir(espace)
  await e.atteindre?.()
  return texteRendu()
}

describe('les fenêtres des connexions — le garde des mots', () => {
  it.each(ETATS.map((e) => [e.nom, e] as const))('%s : rien du cabinet dans ce que lit le client', async (_nom, e) => {
    expect(motsDuCabinet(await atteindre('client', e))).toEqual([])
  })

  // LE DÉFAUT PLANTÉ : le même état, monté pour le cabinet — l'erreur d'un écran qui oublierait de dire qui regarde.
  it.each(ETATS.map((e) => [e.nom, e] as const))('%s : monté pour le cabinet, le garde y voit ses mots', async (_nom, e) => {
    expect(motsDuCabinet(await atteindre('cabinet', e)).length).toBeGreaterThan(0)
  })
})

// ── 4. « Ton adresse de réception » (étape A6b1) ────────────────────────────────────────────────────────────────────────
// Le troisième bloc de la section : l'adresse sous laquelle la société reçoit ses factures électroniques, DÉCLARÉE par elle ou
// par son cabinet. Il ne lit que la base (deux lectures : les adresses, le SIRET) ; rien n'est envoyé à une plateforme ni à
// l'annuaire. Sa fenêtre est celle du cabinet en mode client ; à sa fermeture le bloc se relit.
describe('« Ton adresse de réception »', () => {
  const relireConnexion = vi.fn(async () => {})
  const monterSection = () =>
    render(<ConnexionsClient dossierId="d1" connexion={null} connexionErreur={null} relireConnexion={relireConnexion} />)
  const phrasesAdresse = () => [...document.querySelectorAll('p')].map((p) => (p.textContent ?? '').replace(/[\u00a0\u202f]/g, ' '))
    .filter((t) => t.startsWith('Ton adresse de réception'))

  beforeEach(() => {
    relireConnexion.mockClear()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-14T10:00:00Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  it('avant la lecture : « lecture… », ni vide ni geste', () => {
    monterSection()
    expect(phrasesAdresse()).toEqual(['Ton adresse de réception : lecture…'])
    expect(screen.queryByRole('button', { name: /adresse/ })).toBeNull()
    expect(texteRendu()).not.toMatch(/tu n’en as pas/)
  })

  it('lue vide en entier : « pas encore déclaré », et le geste « Déclarer ton adresse »', async () => {
    monterSection()
    await screen.findByRole('button', { name: 'Déclarer ton adresse' })
    expect(phrasesAdresse()[0]).toMatch(/^Ton adresse de réception : tu n’en as pas encore déclaré\./)
  })

  it('une adresse déclarée : l’identifiant, sa maille, la plateforme, la prise d’effet et la vérification ; « Gérer ton adresse »', async () => {
    faux.adresses = [{ ...adresse({ verification: 'portail_annuaire', verifiee_le: '2026-10-01' }) }]
    monterSection()
    await screen.findByRole('button', { name: 'Gérer ton adresse' })
    expect(phrasesAdresse()).toEqual([
      `Ton adresse de réception : ${SIREN_FICTIF} (SIREN), chez Plateforme fictive. Reçoit depuis le 01/09/2026. Vérifiée sur le portail de l’annuaire le 01/10/2026.`,
    ])
    expect(screen.queryByRole('button', { name: 'Déclarer ton adresse' })).toBeNull()
  })

  it('une adresse à venir se dit à venir ; une non vérifiée se dit non vérifiée', async () => {
    faux.adresses = [{ ...adresse({ prise_effet: '2026-10-20' }) }]
    monterSection()
    await screen.findByRole('button', { name: 'Gérer ton adresse' })
    expect(phrasesAdresse()[0]).toContain('À venir : à partir du 20/10/2026. Non vérifiée : simple déclaration.')
  })

  it('l’adresse d’un autre dossier ne s’y lit pas', async () => {
    faux.adresses = [{ ...adresse({ dossier_id: 'd2' }) }]
    monterSection()
    await screen.findByRole('button', { name: 'Déclarer ton adresse' })
  })

  it('une lecture ratée se dit avec son motif et ne s’offre qu’à « Réessayer », qui relit', async () => {
    faux.refusAdresses = 'permission denied'
    monterSection()
    await screen.findByText(/^Ton adresse de réception : elle n’a pas pu être lue en entier \(lecture interrompue après 0 ligne\(s\) : permission denied\)/)
    expect(screen.queryByRole('button', { name: /Déclarer ton adresse|Gérer ton adresse/ })).toBeNull()
    const avant = faux.lecturesAdresses
    faux.refusAdresses = null
    // Les autres « Réessayer » sont ceux de la plateforme et de Super PDP : seul le dernier est celui de l'adresse.
    const reessayer = screen.getAllByRole('button', { name: 'Réessayer' }).at(-1) as HTMLElement
    await act(async () => { fireEvent.click(reessayer) })
    await screen.findByRole('button', { name: 'Déclarer ton adresse' })
    expect(faux.lecturesAdresses).toBeGreaterThan(avant)
  })

  it('des versions qui ne font pas une chaîne : dites, aucune n’est courante, et « Réessayer » seul', async () => {
    faux.adresses = [{ ...adresse({ id: 'a1' }) }, { ...adresse({ id: 'a2' }) }]
    monterSection()
    await screen.findByText(/ne forment pas une suite, aucune n’est donc dite courante/)
    expect(screen.queryByRole('button', { name: /Déclarer ton adresse|Gérer ton adresse/ })).toBeNull()
  })

  it('le bouton ouvre la fenêtre du client ; à sa fermeture, le bloc relit ce que la fenêtre a pu changer', async () => {
    monterSection()
    fireEvent.click(await screen.findByRole('button', { name: 'Déclarer ton adresse' }))
    await screen.findByRole('dialog', { name: 'Ton adresse de réception' })
    // Une déclaration faite entre-temps (par la fenêtre, ou par le cabinet) : la fermeture relit.
    faux.adresses = [{ ...adresse({ identifiant: SIREN_FICTIF }) }]
    const avant = faux.lecturesAdresses
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Fermer' })) })
    await screen.findByRole('button', { name: 'Gérer ton adresse' })
    expect(faux.lecturesAdresses).toBeGreaterThan(avant)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('rien ne part chez une plateforme ni vers l’annuaire : aucun appel de fonction pour l’adresse', async () => {
    monterSection()
    await screen.findByRole('button', { name: 'Déclarer ton adresse' })
    expect(faux.appels.map((a) => a.fonction)).toEqual(['superpdp-credentials'])
  })

  it.each([
    ['aucune adresse', () => {}],
    ['une adresse déclarée', () => { faux.adresses = [{ ...adresse() }] }],
    ['une adresse à venir', () => { faux.adresses = [{ ...adresse({ prise_effet: '2026-10-20' }) }] }],
    ['une lecture ratée', () => { faux.refusAdresses = 'permission denied' }],
    ['des versions rompues', () => { faux.adresses = [{ ...adresse({ id: 'a1' }) }, { ...adresse({ id: 'a2' }) }] }],
  ])('%s : rien du cabinet dans ce que lit le client', async (_nom, poser) => {
    poser()
    monterSection()
    await screen.findByRole('button', { name: /Déclarer ton adresse|Gérer ton adresse|Réessayer/ })
    await act(async () => { await Promise.resolve() })
    const texte = texteRendu()
    expect(texte).toContain('Ton adresse de réception')
    expect(motsDuCabinet(texte)).toEqual([])
  })
})
