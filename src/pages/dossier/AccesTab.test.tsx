import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
        then: (suite: (r: { data: unknown[] | null; error: unknown }) => unknown) =>
          Promise.resolve(
            faux.erreurLecture
              ? { data: null, error: faux.erreurLecture }
              : { data: faux.lignes, error: null },
          ).then(suite),
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

async function cliquerRetirer() {
  // « Retirer » vit dans la ligne du client, à côté de « Relancer » : on s'ancre sur l'adresse.
  const ligne = screen.getByText('client@exemple.fr').closest('tr')
  if (!ligne) throw new Error('ligne de l’accès introuvable')
  await act(async () => { within(ligne).getByRole('button', { name: /^Retirer$/ }).click() })
}

beforeEach(() => {
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
    await act(async () => {})

    expect(screen.getByText(/JWT expired/)).toBeTruthy()
    expect(screen.getByText(/ne pas en conclure que personne ne l'a/)).toBeTruthy()
    expect(screen.queryAllByText(/Aucun accès client pour ce dossier/)).toHaveLength(0)
  })

  it('dit « aucun accès » quand il n’y en a vraiment aucun', async () => {
    // Le garde SYMÉTRIQUE : sans lui, « l'écran n'affirme pas » serait satisfait par un écran qui
    // crie à l'erreur sur un dossier neuf, c'est-à-dire le cas le plus courant.
    faux.lignes = []
    faux.erreurLecture = null
    monter()
    await act(async () => {})

    expect(screen.getByText(/Aucun accès client pour ce dossier/)).toBeTruthy()
  })
})

describe('retirer un accès client : on demande avant, on dit après', () => {
  it('ne retire rien quand la confirmation est refusée', async () => {
    window.confirm = () => false
    monter()
    await act(async () => {})
    await cliquerRetirer()
    expect(faux.suppressions).toBe(0)
  })

  it('NOMME le client dans la question posée', async () => {
    let question = ''
    window.confirm = (m?: string) => { question = m ?? ''; return false }
    monter()
    await act(async () => {})
    await cliquerRetirer()
    expect(question).toContain('client@exemple.fr')
  })

  it('DIT pourquoi quand le retrait échoue', async () => {
    // Le `load()` qui suit montre normalement l'échec — la ligne réapparaît — SAUF quand il échoue
    // pour la même raison : la liste se vide alors au lieu de garder sa ligne, ce qui retourne le
    // signal au lieu de le donner.
    faux.erreurSuppression = { message: 'permission denied' }
    monter()
    await act(async () => {})
    await cliquerRetirer()

    expect(faux.suppressions).toBe(1)
    expect(screen.getByText(/permission denied/)).toBeTruthy()
  })

  it('retire sans rien dire quand tout se passe bien', async () => {
    monter()
    await act(async () => {})
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
