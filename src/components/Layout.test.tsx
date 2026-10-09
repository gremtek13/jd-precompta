import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Layout from './Layout'
import PanneauDroit from './PanneauDroit'
import { signalerMajDossiers } from '../lib/listeDossiers'
import { usePanneauDroit } from '../lib/panneauDroit'

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
// Le chef de cabinet par défaut ; un comptable dans le test qui vérifie à qui l'apparence est réservée, un client dans ceux
// de sa navigation.
const compte = vi.hoisted(() => ({ estChef: true, role: 'cabinet' as 'cabinet' | 'client' }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    session: { user: { email: 'chef@cabinet-de-test.fr' } },
    role: compte.role,
    isSuperAdmin: false,
    estChef: compte.estChef,
    mesSocietes: [],
    dossierActifId: null,
    setDossierActifId: () => {},
    signOut: async () => {},
  }),
}))
// La charte du cabinet : nulle par défaut, un logo dans le test qui vérifie sous quel nom
// l'application s'installe.
const charte = vi.hoisted(() => ({
  valeur: null as null | { nom: string; couleurPrimaire: null; policeGoogleFont: null; logoUrl: string | null },
}))
vi.mock('../lib/branding', () => ({ useCabinetBranding: () => charte.valeur }))
vi.mock('../lib/theme', () => ({ useTheme: () => ({ theme: 'light', toggleTheme: () => {} }) }))

// Un écran qui ouvre et ferme un contenu du volet de droite, comme l'assistant d'un dossier.
function EcranAvecVolet() {
  const { ouvert, ouvrir, fermer } = usePanneauDroit('essai')
  return (
    <>
      <button type="button" onClick={() => (ouvert ? fermer() : ouvrir())}>{ouvert ? 'Fermer le volet' : 'Ouvrir le volet'}</button>
      <PanneauDroit nom="essai"><p>Contenu du volet</p></PanneauDroit>
    </>
  )
}

async function afficher(chemin: string) {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[chemin]}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/dossiers" element={<p>Écran du tableau de bord</p>} />
            <Route path="/dossiers/:id/:tab" element={<p>Écran du dossier</p>} />
            {/* Sans elle, choisir « Apparence » démonterait toute la coque — et un menu qui ne se
                refermerait pas disparaîtrait quand même, pour une raison qui n'est pas la bonne. */}
            <Route path="/apparence" element={<p>Écran de l'apparence</p>} />
            <Route path="/essai-volet" element={<EcranAvecVolet />} />
            {/* L'accueil du client et l'un de ses autres écrans : sa navigation se lit sur les deux. */}
            <Route path="/accueil" element={<p>Écran de l’accueil</p>} />
            <Route path="/mes-pieces" element={<p>Écran des pièces du client</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
  })
}

beforeEach(() => {
  localStorage.clear()
  compte.role = 'cabinet'
  charte.valeur = null
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

// LA NAVIGATION DU CLIENT PARAÎT TOUJOURS DANS LA BARRE LATÉRALE, L'ACCUEIL COMPRIS (09/10/2026). La coque la retirait du DOM à
// l'accueil — ses grosses tuiles y font office de navigation, et sur téléphone la barre du bas les aurait doublées — : sur
// ordinateur, la colonne de gauche s'y affichait alors SANS entrée, et le cabinet s'en est étonné (« pourquoi il n'y a pas
// d'onglet sur le panneau de gauche ? »). C'est la LARGEUR qui décide, pas le rendu : la même `<nav>` reste dans le DOM
// (une seule dans `.sidebar`), et index.css la cache sous la requête qui fait de la barre latérale une barre du haut.
// jsdom n'évalue aucune requête de largeur : le test lit donc la feuille, et c'est le banc de captures
// (`pc-client-accueil`, `mobile-client-accueil`) qui montre ce que le navigateur en fait.
describe('Barre latérale — la navigation du client', () => {
  beforeEach(() => { compte.role = 'client' })

  const CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8')
  // Les mêmes quatre entrées que sur ses autres écrans : cette correction n'ouvre rien de plus au client.
  const ENTREES = [
    ['Accueil', '/accueil'], ['Mes pièces', '/mes-pieces'], ['Mes informations', '/mes-informations'], ['Ma simulation', '/ma-simulation'],
  ]
  const barre = () => document.querySelector('.sidebar') as HTMLElement
  const entreesDe = () => within(within(barre()).getByRole('navigation')).getAllByRole('link')
    .map((lien) => [lien.getAttribute('title'), lien.getAttribute('href')])

  // Les corps des blocs `@media (max-width: 720px)` — la requête où `.sidebar nav` devient la barre du bas —, et la
  // feuille privée d'eux. Les commentaires partent d'abord : une accolade y trouverait de quoi décaler le décompte.
  function blocsTelephone(feuille: string): { corps: string[]; reste: string } {
    const css = feuille.replace(/\/\*[\s\S]*?\*\//g, '')
    const ouverture = '@media (max-width: 720px) {'
    const corps: string[] = []
    let reste = ''
    let curseur = 0
    for (let debut = css.indexOf(ouverture); debut !== -1; debut = css.indexOf(ouverture, curseur)) {
      reste += css.slice(curseur, debut)
      let profondeur = 1
      let i = debut + ouverture.length
      while (profondeur > 0) {
        if (i >= css.length) throw new Error('bloc @media non refermé')
        if (css[i] === '{') profondeur++
        else if (css[i] === '}') profondeur--
        i++
      }
      corps.push(css.slice(debut + ouverture.length, i - 1))
      curseur = i
    }
    return { corps, reste: reste + css.slice(curseur) }
  }

  it('garde à l’accueil ses quatre entrées dans la barre latérale, comme sur ses autres écrans', async () => {
    await afficher('/accueil')
    expect(entreesDe()).toEqual(ENTREES)
    cleanup()
    await afficher('/mes-pieces')
    expect(entreesDe()).toEqual(ENTREES)
  })

  it('désigne l’accueil comme l’écran affiché', async () => {
    await afficher('/accueil')
    const accueil = within(barre()).getAllByRole('link').find((lien) => lien.getAttribute('title') === 'Accueil')!
    expect(accueil.getAttribute('aria-current')).toBe('page')
  })

  it('n’a qu’une `<nav>` dans la barre, et c’est celle que le téléphone cache à l’accueil seulement', async () => {
    await afficher('/accueil')
    expect(barre().querySelectorAll('nav')).toHaveLength(1)
    expect(barre().querySelector('nav')!.className).toBe('app-nav-accueil-client')
    cleanup()
    await afficher('/mes-pieces')
    expect(barre().querySelectorAll('nav')).toHaveLength(1)
    expect(barre().querySelector('nav')!.className).toBe('')
  })

  it('ne change rien à la navigation du cabinet, ni à celle de son dossier', async () => {
    compte.role = 'cabinet'
    await afficher('/dossiers')
    expect(barre().querySelector('nav')!.className).toBe('')
    cleanup()
    await afficher('/dossiers/d1/pieces')
    expect(barre().querySelector('nav')!.className).toBe('app-nav-en-dossier')
    cleanup()
    // La classe est celle du CLIENT : à la même adresse, un compte du cabinet n'en reçoit pas.
    await afficher('/accueil')
    expect(barre().querySelector('nav')!.className).toBe('')
  })

  // La règle qui cache la barre à l'accueil : dans le bloc où elle devient la barre du bas, et NULLE PART AILLEURS — hors de
  // ce bloc, elle la cacherait aussi sur ordinateur, le défaut d'origine.
  it('index.css ne cache cette navigation que sous la requête du téléphone', () => {
    const { corps, reste } = blocsTelephone(CSS)
    const regle = '.sidebar nav.app-nav-accueil-client { display: none; }'
    const bloc = corps.find((c) => c.includes(regle))
    expect(bloc, 'règle absente du bloc téléphone').toBeDefined()
    // Ce bloc est bien celui où la navigation se fixe en bas de l'écran, et celui qui cache déjà la barre d'un dossier.
    expect(bloc).toMatch(/\.sidebar nav \{\s*position: fixed;/)
    expect(bloc).toContain('.sidebar nav.app-nav-en-dossier { display: none; }')
    expect(reste, 'la règle vaut aussi sur ordinateur').not.toContain('app-nav-accueil-client')
  })

  it('l’extraction des blocs du téléphone voit une règle posée dehors, et celle qui est dedans', () => {
    // Une accolade dans un commentaire — ici une fermante, dans le bloc — ne ferme rien.
    const dedans = '.a { color: red; }\n@media (max-width: 720px) {\n  /* une } trompeuse */\n  .b { color: blue; }\n  @container x (max-width: 5px) { .c { color: green; } }\n}\n/* une { trompeuse */\n.d { color: pink; }'
    const { corps, reste } = blocsTelephone(dedans)
    expect(corps).toHaveLength(1)
    expect(corps[0]).toContain('.b { color: blue; }')
    expect(corps[0]).toContain('.c { color: green; }')
    expect(reste).toContain('.a { color: red; }')
    expect(reste).toContain('.d { color: pink; }')
    expect(reste).not.toContain('.b')
    expect(() => blocsTelephone('@media (max-width: 720px) { .a { color: red; }')).toThrow('non refermé')
  })
})

// L'APPARENCE ET L'INSTALLATION VIVENT DANS LE MENU DU COMPTE, à côté du thème et de la déconnexion —
// là où le cabinet les a voulues, plutôt qu'en lien permanent dans la navigation et en bouton au-dessus
// du compte. Les deux menus (le bas de la barre sur ordinateur, « … » sur téléphone) portent les MÊMES
// entrées : écrites une fois, elles ne peuvent pas diverger.
describe('Barre latérale — le menu du compte', () => {
  afterEach(() => { compte.estChef = true })

  const ouvrirLeCompte = () => fireEvent.click(screen.getByRole('button', { name: 'Compte de chef@cabinet-de-test.fr' }))
  const ouvrirLeMenuMobile = () => fireEvent.click(screen.getByRole('button', { name: "Plus d'options" }))

  it('porte l’apparence du cabinet, qui a quitté la navigation', async () => {
    await afficher('/dossiers')
    expect(within(screen.getByRole('navigation')).queryByRole('link', { name: /Apparence/ })).toBeNull()

    ouvrirLeCompte()
    const lien = screen.getByRole('link', { name: 'Apparence' })
    expect(lien.getAttribute('href')).toBe('/apparence')
    screen.getByRole('button', { name: 'Mode sombre' })
    screen.getByRole('button', { name: 'Déconnexion' })
  })

  it('et le menu « … » du téléphone porte les mêmes entrées', async () => {
    await afficher('/dossiers')
    ouvrirLeMenuMobile()
    screen.getByRole('link', { name: 'Apparence' })
    screen.getByRole('button', { name: 'Déconnexion' })
  })

  it('réserve l’apparence au chef de cabinet, comme sa page', async () => {
    compte.estChef = false
    await afficher('/dossiers')
    ouvrirLeCompte()
    expect(screen.queryByRole('link', { name: 'Apparence' })).toBeNull()
    screen.getByRole('button', { name: 'Déconnexion' })
  })

  it('se referme quand on choisit l’apparence', async () => {
    await afficher('/dossiers')
    ouvrirLeCompte()
    fireEvent.click(screen.getByRole('link', { name: 'Apparence' }))
    screen.getByText("Écran de l'apparence")
    expect(screen.queryByRole('button', { name: 'Déconnexion' })).toBeNull()
  })
})

describe('Barre latérale — installer l’application', () => {
  const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
  afterEach(() => { delete (navigator as { userAgent?: string }).userAgent })

  // L'entrée vit dans le menu du compte : on l'ouvre d'abord, comme l'utilisateur.
  function consigne(): string {
    fireEvent.click(screen.getByRole('button', { name: 'Compte de chef@cabinet-de-test.fr' }))
    fireEvent.click(screen.getByRole('button', { name: /Installer l'application/ }))
    return screen.getByRole('note').textContent ?? ''
  }

  it('n’est plus un bouton permanent de la barre, menu fermé', async () => {
    Object.defineProperty(navigator, 'userAgent', { value: CHROME, configurable: true })
    await afficher('/dossiers')
    expect(screen.queryByRole('button', { name: /Installer l'application/ })).toBeNull()
  })

  it('propose l’installation sous le nom de JD Precompta quand le cabinet n’a pas de logo', async () => {
    Object.defineProperty(navigator, 'userAgent', { value: CHROME, configurable: true })
    await afficher('/dossiers')
    expect(consigne()).toContain('« JD Precompta »')
  })

  it('sous le nom du cabinet quand il a son logo, celui du manifeste qu’il reçoit', async () => {
    Object.defineProperty(navigator, 'userAgent', { value: CHROME, configurable: true })
    charte.valeur = { nom: 'Cabinet Exemple', couleurPrimaire: null, policeGoogleFont: null, logoUrl: 'https://stockage.exemple.test/logo.png' }
    await afficher('/dossiers')
    expect(consigne()).toContain('« Cabinet Exemple »')
  })
})

// LA LARGEUR DES VOLETS, choisie en glissant leur bord (lib/largeurVolets.ts, PoigneeRedimensionnement). Ce que la
// coque promet : la largeur choisie s'applique et se retrouve au prochain affichage, une valeur qu'elle ne reconnaît
// pas laisse la largeur d'origine, la fenêtre d'aujourd'hui borne ce qu'on a choisi sans l'oublier — et le bord du
// volet de droite n'existe que tant que le volet a un contenu.
describe('Coque — la largeur des volets', () => {
  const fenetreDOrigine = window.innerWidth
  function fenetre(largeur: number) {
    Object.defineProperty(window, 'innerWidth', { value: largeur, configurable: true })
  }
  afterEach(() => fenetre(fenetreDOrigine))
  const variable = (nom: string) => (document.querySelector('.app-shell') as HTMLElement).style.getPropertyValue(nom)
  const poignee = (nom: string) => screen.queryByRole('separator', { name: nom })

  it('sans choix, les deux volets gardent leur largeur d’origine', async () => {
    fenetre(1440)
    await afficher('/dossiers')
    expect(variable('--largeur-barre')).toBe('264px')
    expect(variable('--largeur-panneau')).toBe('403px')
  })

  it('la largeur glissée de la barre s’applique, se retient, et se retrouve au prochain affichage', async () => {
    fenetre(1440)
    await afficher('/dossiers')
    const bord = poignee('Largeur de la barre latérale')!
    fireEvent.pointerDown(bord, { clientX: 264, pointerId: 1, button: 0 })
    fireEvent.pointerMove(bord, { clientX: 330, pointerId: 1 })
    expect(variable('--largeur-barre')).toBe('330px')
    expect(document.querySelector('.app-shell')?.classList.contains('redimensionnement')).toBe(true)
    fireEvent.pointerUp(bord, { clientX: 330, pointerId: 1 })
    expect(document.querySelector('.app-shell')?.classList.contains('redimensionnement')).toBe(false)
    expect(localStorage.getItem('jd-precompta-largeur-barre')).toBe('330')

    cleanup()
    await afficher('/dossiers')
    expect(variable('--largeur-barre')).toBe('330px')
  })

  it('une valeur retenue qu’elle ne reconnaît pas laisse la largeur d’origine', async () => {
    fenetre(1440)
    localStorage.setItem('jd-precompta-largeur-barre', '12')
    localStorage.setItem('jd-precompta-largeur-panneau', 'large')
    await afficher('/dossiers')
    expect(variable('--largeur-barre')).toBe('264px')
    expect(variable('--largeur-panneau')).toBe('403px')
  })

  it('le double-clic rend la largeur d’origine et oublie le choix', async () => {
    fenetre(1440)
    localStorage.setItem('jd-precompta-largeur-barre', '360')
    await afficher('/dossiers')
    expect(variable('--largeur-barre')).toBe('360px')
    fireEvent.doubleClick(poignee('Largeur de la barre latérale')!)
    expect(variable('--largeur-barre')).toBe('264px')
    expect(localStorage.getItem('jd-precompta-largeur-barre')).toBeNull()
  })

  it('réduite à ses icônes, la barre n’a pas de largeur à choisir', async () => {
    fenetre(1440)
    await afficher('/dossiers')
    expect(poignee('Largeur de la barre latérale')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Réduire la barre latérale' }))
    expect(poignee('Largeur de la barre latérale')).toBeNull()
  })

  it('le bord du volet de droite n’existe que tant que le volet a un contenu', async () => {
    fenetre(1440)
    await afficher('/essai-volet')
    expect(poignee('Largeur du panneau de droite')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le volet' }))
    expect(await screen.findByRole('separator', { name: 'Largeur du panneau de droite' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Fermer le volet' }))
    await vi.waitFor(() => expect(poignee('Largeur du panneau de droite')).toBeNull())
  })

  it('le volet s’élargit vers la gauche, sans rogner le panneau central sous sa largeur minimale', async () => {
    fenetre(1440)
    await afficher('/essai-volet')
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le volet' }))
    const bord = await screen.findByRole('separator', { name: 'Largeur du panneau de droite' })
    fireEvent.pointerDown(bord, { clientX: 1000, pointerId: 1, button: 0 })
    fireEvent.pointerMove(bord, { clientX: 700, pointerId: 1 })
    fireEvent.pointerUp(bord, { clientX: 700, pointerId: 1 })
    // 1 440 − 264 − 16 − 560 : la place que laisse le panneau central.
    expect(variable('--largeur-panneau')).toBe('600px')
    expect(localStorage.getItem('jd-precompta-largeur-panneau')).toBe('600')

    // Élargir la barre rétrécit le volet ; la réduire le lui rend.
    fireEvent.keyDown(poignee('Largeur de la barre latérale')!, { key: 'ArrowRight', shiftKey: true })
    expect(variable('--largeur-barre')).toBe('328px')
    expect(variable('--largeur-panneau')).toBe('536px')
    fireEvent.click(screen.getByRole('button', { name: 'Réduire la barre latérale' }))
    expect(variable('--largeur-panneau')).toBe('600px')
  })

  it('la fenêtre d’aujourd’hui borne la largeur choisie sans la faire oublier', async () => {
    fenetre(1440)
    localStorage.setItem('jd-precompta-largeur-panneau', '700')
    await afficher('/dossiers')
    expect(variable('--largeur-panneau')).toBe('600px')
    await act(async () => {
      fenetre(1920)
      window.dispatchEvent(new Event('resize'))
    })
    expect(variable('--largeur-panneau')).toBe('700px')
    expect(localStorage.getItem('jd-precompta-largeur-panneau')).toBe('700')
  })
})
