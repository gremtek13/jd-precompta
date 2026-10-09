import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EquipePage from './EquipePage'

// « AJOUTER UN MEMBRE » NE SE PROTÉGEAIT QUE PAR UN ÉTAT (09/10/2026).
//
// `disabled={enregistrement}` ne prend effet qu'au rendu suivant : deux soumissions du même rendu (deux « Entrée », un
// double clic) appelaient deux fois `create-team-member` pour la même adresse. La base ne laisse pas entrer deux fois la
// même personne — mais le second appel trouve le compte que le premier vient de créer, et répond une ERREUR (« un compte
// existe déjà… », ou « appartient déjà à un cabinet ») sur un membre bien créé : l'écran garde le formulaire ouvert et dit
// l'échec d'une création réussie. Le même défaut qu'`AccesTab`, corrigé là le 24/09/2026.
//
// Aucun test de `src/lib` ne voit ça : le NOMBRE d'appels est faux, pas ce qu'on appelle. Le cas à TROIS envois est le
// seul à distinguer un verrou posé dans le `try`, dont le `return` du deuxième relâcherait celui du premier.
const faux = vi.hoisted(() => ({
  appels: [] as { nom: string; body: unknown }[],
  // La réponse de la fonction attend `porte` quand le test la pose : la fenêtre pendant laquelle un second envoi arrive.
  porte: null as Promise<void> | null,
  refus: null as string | null,
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    // Les trois lectures de l'écran — membres, dossiers, affectations — rendent un cabinet sans personne d'autre, lu en
    // entier : rien de ce que ce test garde n'en dépend.
    from: () => {
      const chaine: Record<string, unknown> = {}
      Object.assign(chaine, {
        select: () => chaine,
        eq: () => chaine,
        order: () => chaine,
        range: () => chaine,
        then: (suite: (r: { data: unknown[]; error: null; count: number }) => unknown) =>
          Promise.resolve({ data: [], error: null, count: 0 }).then(suite),
      })
      return chaine
    },
    functions: {
      invoke: async (nom: string, options: { body: unknown }) => {
        faux.appels.push({ nom, body: options.body })
        await faux.porte
        return faux.refus ? { data: { error: faux.refus }, error: null } : { data: { ok: true }, error: null }
      },
    },
  },
}))

// Un `AuthProvider` complet ferait dépendre ce test d'une session Supabase (CLAUDE.md).
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, monCabinetId: 'cab1' }),
}))

beforeEach(() => {
  faux.appels = []
  faux.porte = null
  faux.refus = null
})

// Une porte laissée par un test qui échoue ne doit pas faire échouer les suivants.
afterEach(() => { faux.porte = null })

function retenirLaReponse(): () => Promise<void> {
  let ouvrir = () => {}
  faux.porte = new Promise<void>((resolve) => { ouvrir = resolve })
  return async () => {
    faux.porte = null
    await act(async () => { ouvrir() })
  }
}

const creations = () => faux.appels.filter((a) => a.nom === 'create-team-member')

// Les champs requis sont remplis : jsdom bloque la soumission d'un formulaire dont un champ requis est vide.
async function ouvrirLeFormulaire() {
  await act(async () => { render(<EquipePage />) })
  await act(async () => { screen.getByRole('button', { name: '+ Ajouter un membre' }).click() })
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'nouvelle@cabinet-fictif.fr' } })
    fireEvent.change(screen.getByLabelText('Mot de passe (au moins 10 caractères)'), { target: { value: 'mot-de-passe-fictif' } })
  })
  const bouton = screen.getByRole('button', { name: 'Créer le compte' }) as HTMLButtonElement
  return { bouton, formulaire: bouton.closest('form')! }
}

describe('EquipePage — le verrou de l’ajout d’un membre', () => {
  it('ne crée le compte qu’une fois quand le formulaire est soumis deux fois dans le même rendu', async () => {
    const { bouton } = await ouvrirLeFormulaire()
    const liberer = retenirLaReponse()

    // LES DEUX CLICS DANS LE MÊME `act` : séparés, le second tomberait sur un bouton déjà grisé et le test resterait vert
    // avec le défaut réinstallé (CLAUDE.md).
    await act(async () => { bouton.click(); bouton.click() })

    expect(creations()).toHaveLength(1)
    expect(creations()[0].body).toEqual({ email: 'nouvelle@cabinet-fictif.fr', password: 'mot-de-passe-fictif', role: 'comptable' })
    expect(bouton.disabled).toBe(true)
    expect(bouton.textContent).toBe('Création…')
    await liberer()
    // Le formulaire se referme sur la création réussie, sans un mot d'échec.
    expect(screen.queryByRole('heading', { name: "Ajouter un membre de l'équipe" })).toBeNull()
  })

  it('trois soumissions du formulaire — « Entrée » dans un champ — ne le créent qu’une fois', async () => {
    const { formulaire } = await ouvrirLeFormulaire()
    const liberer = retenirLaReponse()

    await act(async () => { for (let i = 0; i < 3; i++) fireEvent.submit(formulaire) })

    expect(creations()).toHaveLength(1)
    await liberer()
  })

  it('relâche le verrou sur un refus de la fonction, et le dit', async () => {
    faux.refus = 'Réservé aux chefs de cabinet.'
    const { bouton } = await ouvrirLeFormulaire()

    await act(async () => { bouton.click() })
    expect(screen.getByText('Réservé aux chefs de cabinet.')).toBeTruthy()
    await act(async () => { screen.getByRole('button', { name: 'Créer le compte' }).click() })

    expect(creations()).toHaveLength(2)
  })
})
