import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Layout from './Layout'
import { signalerMajDossiers } from '../lib/listeDossiers'

// La barre latérale d'ordinateur (Layout + BarreDossiers) : ce qu'elle promet, c'est de montrer les
// écrans du dossier ouvert et TOUS les dossiers du cabinet, à un clic chacun. Ce qui la ferait mentir
// sans que rien ne casse visiblement : un dossier qui manque sans le dire (lecture tronquée ou
// refusée présentée comme la liste entière), une recherche qui ne trouve pas « Hélène » en tapant
// « helene », un écran affiché que la barre ne désigne pas, et une liste qui ne se relit jamais — ou
// à chaque clic.
const faux = vi.hoisted(() => ({
  dossiers: [] as { id: string; nom: string }[],
  erreur: null as string | null,
  // Serveur qui CESSE de rendre des lignes au-delà de N tout en annonçant le vrai total : c'est ce qui
  // produit une lecture incomplète — un simple plafond de tranche, lui, est recollé par `lireTout`.
  muetApres: null as number | null,
  // Dossier que la base ne rend qu'à partir de la DEUXIÈME lecture : créé ou restauré ailleurs
  // pendant que la barre était déjà chargée.
  apparaitALaRelecture: null as { id: string; nom: string } | null,
  lectures: 0,
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'dossiers') faux.lectures++
      const chaine: Record<string, unknown> = {}
      let debut = 0
      let fin = Number.MAX_SAFE_INTEGER
      Object.assign(chaine, {
        select: () => chaine,
        eq: () => chaine,
        order: () => chaine,
        range: (d: number, f: number) => { debut = d; fin = f; return chaine },
        then: (suite: (r: unknown) => unknown) => {
          if (faux.erreur) {
            return Promise.resolve({ data: null, error: { message: faux.erreur }, count: null }).then(suite)
          }
          const connus = faux.apparaitALaRelecture && faux.lectures >= 2
            ? [...faux.dossiers, faux.apparaitALaRelecture]
            : faux.dossiers
          const servies = faux.muetApres === null ? connus : connus.slice(0, faux.muetApres)
          return Promise.resolve({
            data: servies.slice(debut, fin + 1), error: null, count: connus.length,
          }).then(suite)
        },
      })
      return chaine
    },
  },
}))

// Monter un `AuthProvider` complet ferait dépendre ce test d'une session Supabase ; la charte et le
// thème, eux, touchent au navigateur (`matchMedia` n'existe pas sous jsdom).
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    session: { user: { email: 'chef@cabinet-de-test.fr' } },
    role: 'cabinet',
    isSuperAdmin: false,
    estChef: true,
    mesSocietes: [],
    dossierActifId: null,
    setDossierActifId: () => {},
    signOut: async () => {},
  }),
}))
vi.mock('../lib/branding', () => ({ useCabinetBranding: () => null }))
vi.mock('../lib/theme', () => ({ useTheme: () => ({ theme: 'light', toggleTheme: () => {} }) }))

async function afficher(chemin: string) {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[chemin]}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/dossiers" element={<p>Écran du tableau de bord</p>} />
            <Route path="/dossiers/:id/:tab" element={<p>Écran du dossier</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
  })
}

beforeEach(() => {
  localStorage.clear()
  faux.dossiers = [
    { id: 'd1', nom: 'Cabinet Hélène' },
    { id: 'd2', nom: 'Bravo Santé' },
    { id: 'd3', nom: 'Clinique Ébène' },
  ]
  faux.erreur = null
  faux.muetApres = null
  faux.apparaitALaRelecture = null
  faux.lectures = 0
})

describe('Barre latérale — le dossier ouvert et ses écrans', () => {
  it('nomme le dossier ouvert et désigne l’écran affiché', async () => {
    await afficher('/dossiers/d1/pieces')
    const ouvert = screen.getByRole('region', { name: 'Dossier ouvert' })
    expect(within(ouvert).getByText('Cabinet Hélène')).toBeTruthy()
    expect(within(ouvert).getByRole('link', { name: 'Justificatifs' }).getAttribute('aria-current')).toBe('page')
    // Le dossier ouvert n'est pas répété parmi les autres.
    expect(within(screen.getByRole('region', { name: 'Dossiers' })).queryByText('Cabinet Hélène')).toBeNull()
  })

  it('un groupe replié se déplie, et ses écrans mènent au bon onglet du bon dossier', async () => {
    await afficher('/dossiers/d1/pieces')
    const ouvert = screen.getByRole('region', { name: 'Dossier ouvert' })
    expect(within(ouvert).queryByRole('link', { name: 'Écritures' })).toBeNull()

    fireEvent.click(within(ouvert).getByRole('button', { name: 'Comptabilité' }))
    const ecritures = within(ouvert).getByRole('link', { name: 'Écritures' })
    expect(ecritures.getAttribute('href')).toBe('/dossiers/d1/ecritures')

    fireEvent.click(ecritures)
    expect(within(ouvert).getByRole('link', { name: 'Écritures' }).getAttribute('aria-current')).toBe('page')
  })

  it('le groupe de l’écran affiché s’ouvre de lui-même quand l’opérateur n’a rien choisi', async () => {
    await afficher('/dossiers/d1/cloture')
    const ouvert = screen.getByRole('region', { name: 'Dossier ouvert' })
    expect(within(ouvert).getByRole('link', { name: 'Clôture' }).getAttribute('aria-current')).toBe('page')
  })
})

describe('Barre latérale — la liste des dossiers', () => {
  it('trouve un dossier sans qu’on tape ses accents', async () => {
    await afficher('/dossiers/d1/pieces')
    fireEvent.change(screen.getByLabelText('Rechercher un dossier'), { target: { value: 'ebene' } })
    const liste = screen.getByRole('region', { name: 'Dossiers' })
    expect(within(liste).getByRole('link', { name: 'Clinique Ébène' })).toBeTruthy()
    expect(within(liste).queryByRole('link', { name: 'Bravo Santé' })).toBeNull()
  })

  it('une liste tronquée le dit, au lieu de passer pour la liste entière', async () => {
    faux.muetApres = 1
    await afficher('/dossiers')
    expect(screen.getByText(/Liste des dossiers incomplète/)).toBeTruthy()
  })

  it('une lecture refusée ne se fait pas passer pour un cabinet sans dossier', async () => {
    faux.erreur = 'permission denied for table dossiers'
    await afficher('/dossiers')
    expect(screen.getByText(/Liste des dossiers incomplète.*permission denied/)).toBeTruthy()
    expect(screen.queryByText(/Aucun dossier pour l’instant/)).toBeNull()
  })

  // Garde symétrique : sans lui, « la panne ne dit pas "aucun dossier" » serait satisfait par une barre
  // qui ne le dit jamais.
  it('un cabinet réellement sans dossier le dit', async () => {
    faux.dossiers = []
    await afficher('/dossiers')
    expect(screen.getByText(/Aucun dossier pour l’instant/)).toBeTruthy()
  })

  it('se relit au retour sur le tableau de bord, pas à chaque changement d’écran', async () => {
    await afficher('/dossiers/d1/pieces')
    const avant = faux.lectures
    const ouvert = screen.getByRole('region', { name: 'Dossier ouvert' })

    await act(async () => { fireEvent.click(within(ouvert).getByRole('link', { name: 'Banque' })) })
    expect(faux.lectures).toBe(avant)

    await act(async () => { fireEvent.click(screen.getByRole('link', { name: /Tableau de bord/ })) })
    expect(faux.lectures).toBe(avant + 1)
  })

  it('un dossier ouvert que la liste ne connaît pas la fait relire, une fois', async () => {
    faux.apparaitALaRelecture = { id: 'd9', nom: 'Écho Kiné' }
    await afficher('/dossiers/d9/pieces')
    expect(within(screen.getByRole('region', { name: 'Dossier ouvert' })).getByText('Écho Kiné')).toBeTruthy()
    expect(faux.lectures).toBe(2)
  })

  // Un dossier qu'une liste incomplète ne contient pas ne doit pas faire relire EN BOUCLE : une
  // relecture par identifiant inconnu, pas une de plus.
  it('un dossier introuvable ne fait pas relire en boucle', async () => {
    await afficher('/dossiers/inconnu/pieces')
    expect(faux.lectures).toBe(2)
  })

  it('un dossier créé depuis le tableau de bord apparaît sur signal, sans recharger la page', async () => {
    await afficher('/dossiers')
    faux.dossiers = [...faux.dossiers, { id: 'd4', nom: 'Delta Soins' }]
    await act(async () => { signalerMajDossiers() })
    expect(screen.getByRole('link', { name: 'Delta Soins' })).toBeTruthy()
  })

  it('« Nouveau dossier » ouvre le formulaire du tableau de bord, par l’URL', async () => {
    await afficher('/dossiers/d1/pieces')
    expect(screen.getByRole('link', { name: 'Nouveau dossier' }).getAttribute('href')).toBe('/dossiers?nouveau=1')
  })
})

describe('Barre latérale — réduite à ses icônes', () => {
  it('réduite, elle garde les dossiers en pastilles, et s’en souvient au prochain affichage', async () => {
    await afficher('/dossiers/d1/pieces')
    fireEvent.click(screen.getByRole('button', { name: 'Réduire la barre latérale' }))

    expect(document.querySelector('.app-shell')?.classList.contains('barre-reduite')).toBe(true)
    // L'arborescence ne tient pas dans la barre réduite : c'est la barre d'onglets du dossier qui
    // reprend ce rôle (voir index.css).
    expect(screen.queryByRole('region', { name: 'Dossier ouvert' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Cabinet Hélène' }).getAttribute('aria-current')).toBe('page')

    cleanup()
    await afficher('/dossiers/d1/pieces')
    expect(screen.getByRole('button', { name: 'Déployer la barre latérale' })).toBeTruthy()
  })

  it('la loupe de la barre réduite la déploie et met la recherche sous le curseur', async () => {
    localStorage.setItem('jd-precompta-barre-reduite', '1')
    await afficher('/dossiers')
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher un dossier' }))
    expect(document.activeElement).toBe(screen.getByLabelText('Rechercher un dossier'))
  })
})
