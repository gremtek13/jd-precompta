import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AccesTab from './AccesTab'

// Le verrou d'exécution de la création d'un accès client (CLAUDE.md, « un verrou d'exécution est un
// `useRef`, jamais un état React »). Sur un FORMULAIRE le déclencheur n'est même pas le double clic
// mais deux « Entrée » rapprochées. Le doublon ne crée pas qu'une ligne en trop : create-client-access
// appelle `auth.admin.createUser` deux fois pour la même adresse, une course entre les deux appels
// qu'aucun calcul pur ne peut voir — c'est le nombre d'appels à l'Edge Function qui serait faux.
const faux = vi.hoisted(() => ({
  appels: [] as unknown[],
  // La promesse du premier appel reste EN ATTENTE : c'est la fenêtre réelle pendant laquelle une
  // seconde soumission arrive. La résoudre tout de suite supprimerait la fenêtre que le verrou ferme.
  resoudre: null as null | ((v: unknown) => void),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: [] }),
      }),
    }),
    functions: {
      invoke: (nom: string, options: unknown) => {
        faux.appels.push({ nom, options })
        return new Promise((resolve) => { faux.resoudre = resolve })
      },
    },
  },
}))

async function monter() {
  faux.appels = []
  faux.resoudre = null
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
    const bouton = await monter()

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
    const bouton = await monter()
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.appels).toHaveLength(1)
  })

  it('relâche le verrou sur un échec, pour laisser réessayer', async () => {
    const bouton = await monter()
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
