import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccesTab from './AccesTab'

// L'ÉCRAN QUI DIT QUI PEUT ENTRER DANS UN DOSSIER, et il se trompait dans les deux sens.
//
// « Aucun accès client pour ce dossier » est une AFFIRMATION, pas un écran vide : une lecture
// refusée rendait exactement la même chose, et c'est le pire sens possible pour ce geste-là —
// on coupe l'accès d'un client qui part, et on croit l'avoir fait.
//
// Et « Retirer » partait sans rien demander, dans une colonne d'actions où il voisine
// « Relancer ». Réversible, mais pas d'un clic : il faut recréer l'accès ET communiquer un
// nouveau mot de passe.
//
// Aucun test de `src/lib` ne peut voir l'un ni l'autre : il n'y a pas de calcul ici, seulement un
// écran qui affirme ou qui se tait.
//
// Le troisième geste de l'écran, la CRÉATION d'un accès, porte un verrou d'exécution posé par la
// Routine du 24/09/2026 (commit fa0454a sur `main`), avec ses trois cas repris tels quels plus bas.
// La base rattrape bien le doublon d'ACCÈS (`memberships` est unique par utilisateur et dossier),
// mais pas le doublon d'APPEL : deux soumissions rapprochées lancent deux `create-client-access`
// pour la même adresse, et le second échoue sur le compte que le premier vient de créer — un
// message d'erreur affiché sur un accès pourtant bien créé.
const faux = vi.hoisted(() => ({
  lignes: [] as { id: string; user_id: string; email: string | null }[],
  erreurLecture: null as { message: string } | null,
  erreurSuppression: null as { message: string } | null,
  suppressions: 0,
  // create-client-access : la promesse du premier appel reste EN ATTENTE, c'est la fenêtre réelle
  // pendant laquelle une seconde soumission arrive. La résoudre tout de suite supprimerait la fenêtre
  // que le verrou ferme.
  appels: [] as unknown[],
  resoudre: null as null | ((v: unknown) => void),
  // La lecture des accès attend que le test la libère (voir `retenir`) : c'est ainsi qu'on regarde l'écran PENDANT la
  // lecture, au lieu de parier sur la vitesse du faux client.
  porte: null as Promise<void> | null,
  lectures: 0,
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => {
      const chaine: Record<string, unknown> = {}
      let suppression = false
      Object.assign(chaine, {
        select: () => chaine,
        delete: () => { suppression = true; faux.suppressions += 1; return chaine },
        eq: () => (suppression ? Promise.resolve({ error: faux.erreurSuppression }) : chaine),
        then: (suite: (r: { data: unknown[] | null; error: unknown }) => unknown) => {
          faux.lectures += 1
          // La réponse se compose quand elle PART : une lecture retenue rend l'état de la base à sa libération.
          const repondre = () => (
            faux.erreurLecture
              ? { data: null, error: faux.erreurLecture }
              : { data: faux.lignes, error: null }
          )
          return (faux.porte ? faux.porte.then(repondre) : Promise.resolve(repondre())).then(suite)
        },
      })
      return chaine
    },
    functions: {
      invoke: (nom: string, options: unknown) => {
        faux.appels.push({ nom, options })
        return new Promise((resolve) => { faux.resoudre = resolve })
      },
    },
  },
}))

// La modale de relance fait ses propres appels et n'a rien à voir avec ce qu'on garde ici.
vi.mock('../../components/EnvoyerEmailModal', () => ({ default: () => null }))

function monter() {
  return render(<AccesTab dossierId="d1" dossierNom="Cabinet Martin" codeEmail="abc123" />)
}

// Retient les lectures suivantes jusqu'à ce que le test appelle la fonction rendue.
function retenir(): () => Promise<void> {
  let ouvrir = () => {}
  faux.porte = new Promise<void>((resolve) => { ouvrir = resolve })
  return async () => {
    faux.porte = null
    await act(async () => { ouvrir() })
  }
}

// Un tour d'horloge DANS l'`act` : ce que l'écran avait à faire des réponses déjà livrées est rendu avant qu'on le regarde.
function laisserPasserUnTour() {
  return act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)) })
}

async function cliquerRetirer() {
  // « Retirer » vit dans la ligne du client, à côté de « Relancer » : on s'ancre sur l'adresse.
  // Attendue HORS de l'`act` : la ligne n'existe qu'une fois la lecture revenue.
  const ligne = (await screen.findByText('client@exemple.fr')).closest('tr')
  if (!ligne) throw new Error('ligne de l’accès introuvable')
  await act(async () => { within(ligne).getByRole('button', { name: /^Retirer$/ }).click() })
}

beforeEach(() => {
  faux.porte = null
  faux.lectures = 0
  faux.lignes = [{ id: 'm1', user_id: 'u1', email: 'client@exemple.fr' }]
  faux.erreurLecture = null
  faux.erreurSuppression = null
  faux.suppressions = 0
  faux.appels = []
  faux.resoudre = null
  window.confirm = () => true
})

describe('« Aucun accès » est une affirmation, pas un écran vide', () => {
  it('DIT que la liste n’a pas pu être lue, au lieu d’affirmer qu’il n’y a personne', async () => {
    faux.erreurLecture = { message: 'JWT expired' }
    monter()

    expect(await screen.findByText(/JWT expired/)).toBeTruthy()
    expect(screen.getByText(/ne pas en conclure que personne ne l'a/)).toBeTruthy()
    expect(screen.queryAllByText(/Aucun accès client pour ce dossier/)).toHaveLength(0)
  })

  it('dit « aucun accès » quand il n’y en a vraiment aucun', async () => {
    // Le garde SYMÉTRIQUE : sans lui, « l'écran n'affirme pas » serait satisfait par un écran qui
    // crie à l'erreur sur un dossier neuf, c'est-à-dire le cas le plus courant.
    faux.lignes = []
    faux.erreurLecture = null
    monter()

    expect(await screen.findByText(/Aucun accès client pour ce dossier/)).toBeTruthy()
  })
})

describe('« Aucun accès » ne se dit qu’une fois la liste revenue', () => {
  // Au premier rendu la liste est vide faute d'avoir été lue : l'écran disait « Aucun accès client pour ce dossier. » d'un
  // dossier qui en a un — le pire sens pour cet écran-là, celui où l'on vérifie qu'un client qui part n'entre plus.
  it('dit « Chargement… » tant que la lecture n’est pas revenue, puis la liste lue', async () => {
    const liberer = retenir()
    monter()
    await laisserPasserUnTour()

    expect(faux.lectures).toBe(1)
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryAllByText(/Aucun accès client pour ce dossier/)).toHaveLength(0)
    expect(screen.queryAllByText('client@exemple.fr')).toHaveLength(0)

    await liberer()
    expect(await screen.findByText('client@exemple.fr')).toBeTruthy()
    expect(screen.queryAllByText('Chargement…')).toHaveLength(0)
  })

  it('ne dit « aucun accès » d’un dossier vide qu’après l’avoir lu', async () => {
    faux.lignes = []
    const liberer = retenir()
    monter()
    await laisserPasserUnTour()
    expect(screen.queryAllByText(/Aucun accès client pour ce dossier/)).toHaveLength(0)

    await liberer()
    expect(await screen.findByText(/Aucun accès client pour ce dossier/)).toBeTruthy()
  })

  it('une lecture refusée laisse le refus, pas « Chargement… »', async () => {
    faux.erreurLecture = { message: 'JWT expired' }
    const liberer = retenir()
    monter()
    await laisserPasserUnTour()
    await liberer()

    expect(await screen.findByText(/JWT expired/)).toBeTruthy()
    expect(screen.queryAllByText('Chargement…')).toHaveLength(0)
  })

  it('la relecture qui suit un retrait laisse sous les yeux la liste déjà lue', async () => {
    // La règle de `ClientUpload` : le chargement ne vaut que pour la PREMIÈRE lecture.
    monter()
    await screen.findByText('client@exemple.fr')
    const liberer = retenir()
    await cliquerRetirer()
    await laisserPasserUnTour()

    expect(faux.lectures).toBe(2)
    expect(screen.getByText('client@exemple.fr')).toBeTruthy()
    expect(screen.queryAllByText('Chargement…')).toHaveLength(0)
    await liberer()
  })
})

describe('retirer un accès client : on demande avant, on dit après', () => {
  it('ne retire rien quand la confirmation est refusée', async () => {
    window.confirm = () => false
    monter()
    await cliquerRetirer()
    expect(faux.suppressions).toBe(0)
  })

  it('NOMME le client dans la question posée', async () => {
    let question = ''
    window.confirm = (m?: string) => { question = m ?? ''; return false }
    monter()
    await cliquerRetirer()
    expect(question).toContain('client@exemple.fr')
  })

  it('DIT pourquoi quand le retrait échoue', async () => {
    // Le `load()` qui suit montre normalement l'échec — la ligne réapparaît — SAUF quand il échoue
    // pour la même raison : la liste se vide alors au lieu de garder sa ligne, ce qui retourne le
    // signal au lieu de le donner.
    faux.erreurSuppression = { message: 'permission denied' }
    monter()
    await cliquerRetirer()

    expect(faux.suppressions).toBe(1)
    expect(screen.getByText(/permission denied/)).toBeTruthy()
  })

  it('retire sans rien dire quand tout se passe bien', async () => {
    monter()
    await cliquerRetirer()

    expect(faux.suppressions).toBe(1)
    expect(screen.queryAllByText(/n'a pas pu être retiré/)).toHaveLength(0)
  })
})

async function monterFormulaireRempli() {
  render(<AccesTab dossierId="d1" dossierNom="Dossier Test" codeEmail={null} />)
  // Champs requis (HTML `required`) : jsdom bloque la soumission d'un formulaire tant qu'ils sont
  // vides, donc sans ça le clic n'atteindrait jamais `handleCreateAccess`.
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Email du client'), { target: { value: 'client@exemple.fr' } })
    fireEvent.change(screen.getByLabelText('Mot de passe initial'), { target: { value: '1234567890' } })
  })
  return screen.getByRole('button', { name: /Créer l'accès/ })
}

describe('AccesTab — le verrou de création d’un accès client', () => {
  it("n'appelle qu'une fois create-client-access quand on soumet deux fois de suite", async () => {
    const bouton = await monterFormulaireRempli()

    // LES DEUX SOUMISSIONS DANS LE MÊME `act`. Deux `fireEvent.click` successifs ouvrent chacun leur
    // `act`, qui rend le composant en sortant : le second tomberait sur un bouton déjà re-rendu, avec
    // `inviting` à jour, et le test resterait VERT avec le défaut réinstallé (CLAUDE.md).
    await act(async () => { bouton.click(); bouton.click() })

    expect(faux.appels).toHaveLength(1)
  })

  // IL FAUT TROIS CLICS pour distinguer un verrou posé avant le `try` d'un verrou posé dedans : si la
  // vérification/pose du verrou vivait DANS le `try`, le `return` du deuxième clic sortirait par le
  // `finally`, qui relâcherait le verrou du PREMIER, encore en cours, et le troisième clic repartirait
  // pour un second appel (CLAUDE.md, motif déjà vu sur FactureAvoirModal et consorts).
  it("un troisième clic ne déclenche pas de second appel", async () => {
    const bouton = await monterFormulaireRempli()
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.appels).toHaveLength(1)
  })

  it('relâche le verrou sur un échec, pour laisser réessayer', async () => {
    const bouton = await monterFormulaireRempli()
    await act(async () => { bouton.click() })
    expect(faux.appels).toHaveLength(1)

    // La fonction répond une erreur : `handleCreateAccess` l'attrape et son `finally` doit relâcher
    // le verrou — sinon le formulaire resterait bloqué jusqu'au rechargement de l'onglet.
    await act(async () => { faux.resoudre?.({ data: { error: 'Adresse refusée' }, error: null }) })
    expect(screen.getByText(/Adresse refusée/)).toBeTruthy()

    await act(async () => { screen.getByRole('button', { name: /Créer l'accès/ }).click() })
    expect(faux.appels).toHaveLength(2)
  })
})

// « Copier » l'adresse de collecte affiche « Copié ✓ » deux secondes. Le minuteur ne partait pas avec l'écran : la
// suite démonte chaque écran à la fin de son test, et un rappel resté en vol tombait, sous la charge, sur un
// environnement déjà détruit — une erreur non gérée qui faisait échouer la suite au hasard. Et un presse-papiers
// refusé partait lui aussi en erreur non gérée, le clic ne disant rien.
describe('AccesTab — « Copier » l’adresse de collecte', () => {
  let ecrire: ReturnType<typeof vi.fn>

  beforeEach(() => {
    ecrire = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: ecrire } })
    // Seuls les minuteurs sont simulés : la lecture du faux client passe par des promesses, que rien ne retient.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('le minuteur du « Copié ✓ » part avec l’écran', async () => {
    const { unmount } = monter()
    await act(async () => { screen.getByRole('button', { name: 'Copier' }).click() })

    expect(ecrire).toHaveBeenCalledWith('abc123@precompta.jdarnis.fr')
    expect(screen.getByRole('button', { name: 'Copié ✓' })).toBeTruthy()
    // Le garde voit bien le minuteur armé : sans cette ligne, « zéro après le démontage » passerait aussi pour un écran
    // qui n'en arme aucun.
    expect(vi.getTimerCount()).toBe(1)

    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('le « Copié ✓ » s’efface au bout de deux secondes', async () => {
    monter()
    await act(async () => { screen.getByRole('button', { name: 'Copier' }).click() })
    expect(screen.getByRole('button', { name: 'Copié ✓' })).toBeTruthy()

    await act(async () => { vi.advanceTimersByTime(1999) })
    expect(screen.getByRole('button', { name: 'Copié ✓' })).toBeTruthy()
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(screen.getByRole('button', { name: 'Copier' })).toBeTruthy()
  })

  it('deux copies rapprochées ne laissent qu’un minuteur, qui part avec l’écran', async () => {
    const { unmount } = monter()
    await act(async () => { screen.getByRole('button', { name: 'Copier' }).click() })
    await act(async () => { vi.advanceTimersByTime(1000) })
    await act(async () => { screen.getByRole('button', { name: 'Copié ✓' }).click() })
    // Le premier minuteur, laissé armé, effacerait le « Copié ✓ » du second une seconde trop tôt, et survivrait au
    // démontage : seul le dernier est gardé.
    expect(vi.getTimerCount()).toBe(1)
    await act(async () => { vi.advanceTimersByTime(1500) })
    expect(screen.getByRole('button', { name: 'Copié ✓' })).toBeTruthy()

    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('une copie revenue après le démontage n’arme aucun minuteur', async () => {
    let liberer = () => {}
    ecrire.mockImplementation(() => new Promise<void>((resolve) => { liberer = resolve }))
    const { unmount } = monter()
    await act(async () => { screen.getByRole('button', { name: 'Copier' }).click() })

    unmount()
    await act(async () => { liberer() })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('un presse-papiers refusé se dit, sans « Copié ✓ » ni minuteur', async () => {
    ecrire.mockRejectedValue(new DOMException('Refusé', 'NotAllowedError'))
    monter()
    await act(async () => { screen.getByRole('button', { name: 'Copier' }).click() })

    expect(screen.getByText(/Le navigateur a refusé la copie/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Copié ✓' })).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})
