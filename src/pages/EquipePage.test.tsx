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
  // Le corps d'un ajout réussi : ce que la fonction dit du compte (décision du cabinet du 10/10/2026).
  reponse: { ok: true } as unknown,
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
        return faux.refus ? { data: { error: faux.refus }, error: null } : { data: faux.reponse, error: null }
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
  faux.reponse = { ok: true }
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

// CE QUE L'ÉCRAN DIT D'UN MEMBRE AJOUTÉ (décision du cabinet du 10/10/2026 : un compte qui existe déjà garde son mot de
// passe). La fonction dit lequel des deux cas s'est produit ; l'écran le dit au chef, faute de quoi il communiquerait un
// mot de passe qui n'a jamais été posé.
describe('EquipePage — ce que l’écran dit d’un membre ajouté', () => {
  const avis = () => screen.queryAllByRole('status').map((e) => e.textContent ?? '')

  it('un compte créé : l’avis nomme l’adresse, et le mot de passe saisi se communique', async () => {
    faux.reponse = { ok: true, compte: 'cree' }
    const { bouton } = await ouvrirLeFormulaire()
    await act(async () => { bouton.click() })
    expect(avis()).toEqual(["nouvelle@cabinet-fictif.fr a rejoint l'équipe : communique-lui le mot de passe que tu as saisi."])
  })

  it('un compte existant : la personne garde son mot de passe, celui saisi ne se communique pas', async () => {
    faux.reponse = { ok: true, compte: 'existant' }
    const { bouton } = await ouvrirLeFormulaire()
    await act(async () => { bouton.click() })
    const [texte, ...autres] = avis()
    expect(autres).toEqual([])
    expect(texte).toContain("nouvelle@cabinet-fictif.fr a rejoint l'équipe.")
    expect(texte).toContain('la personne garde son mot de passe actuel')
    expect(texte).toContain("celui saisi ici n'a pas été posé — ne le lui communique pas")
    expect(texte).toContain('« Mot de passe oublié »')
    expect(texte).not.toContain('communique-lui')
    // Le formulaire s'est refermé sur l'ajout réussi : l'avis vit sur la page.
    expect(screen.queryByRole('heading', { name: "Ajouter un membre de l'équipe" })).toBeNull()
  })

  it('une fonction d’avant le 10/10/2026, sans le champ : l’avis d’un compte créé — elle avait posé le mot de passe', async () => {
    faux.reponse = { ok: true }
    const { bouton } = await ouvrirLeFormulaire()
    await act(async () => { bouton.click() })
    expect(avis()).toEqual(["nouvelle@cabinet-fictif.fr a rejoint l'équipe : communique-lui le mot de passe que tu as saisi."])
  })

  it('une réponse qui ne dit rien de sûr : aucune promesse sur le mot de passe', async () => {
    faux.reponse = { ok: true, compte: 'repris' }
    const { bouton } = await ouvrirLeFormulaire()
    await act(async () => { bouton.click() })
    const [texte] = avis()
    expect(texte).toContain("le mot de passe saisi n'est peut-être pas le sien")
    expect(texte).not.toContain('communique-lui')
  })

  it('un refus de la fonction se dit, sans avis d’ajout', async () => {
    faux.refus = 'Cette personne appartient déjà à un cabinet (le sien ou un autre) : rien n’a changé, son mot de passe non plus.'
    const { bouton } = await ouvrirLeFormulaire()
    await act(async () => { bouton.click() })
    expect(screen.getByText(faux.refus)).toBeTruthy()
    expect(avis()).toEqual([])
  })

  it('un nouvel ajout efface l’avis du précédent : rien ne dit « a rejoint l’équipe » d’un ajout encore en vol', async () => {
    faux.reponse = { ok: true, compte: 'existant' }
    const { bouton } = await ouvrirLeFormulaire()
    await act(async () => { bouton.click() })
    expect(avis()).toHaveLength(1)

    await act(async () => { screen.getByRole('button', { name: '+ Ajouter un membre' }).click() })
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'second@cabinet-fictif.fr' } })
      fireEvent.change(screen.getByLabelText('Mot de passe (au moins 10 caractères)'), { target: { value: 'mot-de-passe-fictif' } })
    })
    faux.reponse = { ok: true, compte: 'cree' }
    const liberer = retenirLaReponse()
    await act(async () => { screen.getByRole('button', { name: 'Créer le compte' }).click() })
    expect(creations()).toHaveLength(2)
    expect(avis()).toEqual([])
    await liberer()
    expect(avis()).toEqual(["second@cabinet-fictif.fr a rejoint l'équipe : communique-lui le mot de passe que tu as saisi."])
  })
})
