import { act, fireEvent, render, screen } from '@testing-library/react'
import { AuthWeakPasswordError, FunctionsHttpError } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REGLE_DU_MOT_DE_PASSE, refusDuMotDePasse } from '../lib/recuperationMotDePasse'
import SuperAdminPage from './SuperAdminPage'

// « NOUVEAU CABINET » NE SE PROTÉGEAIT QUE PAR UN ÉTAT (09/10/2026).
//
// `disabled={enregistrement}` ne prend effet qu'au rendu suivant : deux soumissions du même rendu appelaient deux fois
// `create-cabinet`. Chaque appel crée SON cabinet, puis son premier comptable en chef ; le second bute sur l'adresse que le
// premier vient d'inscrire, retire le cabinet qu'il venait de créer (la compensation de la fonction) et répond « Un compte
// existe déjà avec cet e-mail » — une erreur affichée sur une création réussie, et, si la compensation échoue, un cabinet
// fantôme dans le parc.
//
// LA COMPENSATION GARDE SA RAISON D'ÊTRE une fois le verrou posé : elle existe pour une adresse DÉJÀ inscrite ailleurs,
// saisie une seule fois, ou pour deux super-administrateurs qui créeraient le même cabinet depuis deux postes — deux cas
// qu'aucun verrou d'écran ne voit. Le verrou ne retire que le chemin du double envoi.
//
// Le cas à TROIS envois est le seul à distinguer un verrou posé dans le `try`.
const faux = vi.hoisted(() => ({
  appels: [] as { nom: string; body: unknown }[],
  // La réponse de la fonction attend `porte` quand le test la pose : la fenêtre pendant laquelle un second envoi arrive.
  porte: null as Promise<void> | null,
  refus: null as string | null,
  // L'erreur que supabase-js rend sur un statut non-2xx (`FunctionsHttpError`, le corps sur son contexte), quand elle est posée.
  erreur: null as unknown,
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    // Les lectures du parc — cabinets, dossiers, membres, accès, usage de l'assistant — rendent un parc vide, lu en
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
        if (faux.erreur) return { data: null, error: faux.erreur }
        return faux.refus ? { data: { error: faux.refus }, error: null } : { data: { ok: true }, error: null }
      },
    },
  },
}))

// La restauration vit sur cet écran et a ses propres tests ; elle ne lit ni n'écrit rien de ce qu'on garde ici.
vi.mock('./RestaurationCard', () => ({ default: () => null }))

beforeEach(() => {
  faux.appels = []
  faux.porte = null
  faux.refus = null
  faux.erreur = null
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

const creations = () => faux.appels.filter((a) => a.nom === 'create-cabinet')

// Un mot de passe qui suit la règle du projet (lib/recuperationMotDePasse.ts) : sans elle, le formulaire refuse avant tout appel.
const MOT_DE_PASSE = 'Mot-de-passe-fictif-1'

// Les champs requis sont remplis : jsdom bloque la soumission d'un formulaire dont un champ requis est vide.
async function ouvrirLeFormulaire() {
  await act(async () => { render(<SuperAdminPage />) })
  await act(async () => { screen.getByRole('button', { name: '+ Nouveau cabinet' }).click() })
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Nom du cabinet'), { target: { value: 'Cabinet Fictif' } })
    fireEvent.change(screen.getByLabelText('Email du comptable en chef'), { target: { value: 'chef@cabinet-fictif.fr' } })
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: MOT_DE_PASSE } })
  })
  const bouton = screen.getByRole('button', { name: 'Créer le cabinet' }) as HTMLButtonElement
  return { bouton, formulaire: bouton.closest('form')! }
}

describe('SuperAdminPage — le verrou de la création d’un cabinet', () => {
  it('ne crée le cabinet qu’une fois quand le formulaire est soumis deux fois dans le même rendu', async () => {
    const { bouton } = await ouvrirLeFormulaire()
    const liberer = retenirLaReponse()

    await act(async () => { bouton.click(); bouton.click() })

    expect(creations()).toHaveLength(1)
    expect(creations()[0].body).toEqual({ nom: 'Cabinet Fictif', email: 'chef@cabinet-fictif.fr', password: MOT_DE_PASSE })
    expect(bouton.disabled).toBe(true)
    expect(bouton.textContent).toBe('Création…')
    await liberer()
    expect(screen.queryByRole('heading', { name: 'Nouveau cabinet' })).toBeNull()
  })

  it('trois soumissions du formulaire — « Entrée » dans un champ — ne le créent qu’une fois', async () => {
    const { formulaire } = await ouvrirLeFormulaire()
    const liberer = retenirLaReponse()

    await act(async () => { for (let i = 0; i < 3; i++) fireEvent.submit(formulaire) })

    expect(creations()).toHaveLength(1)
    await liberer()
  })

  it('relâche le verrou sur un refus de la fonction, et le dit', async () => {
    faux.refus = 'Un compte existe déjà avec cet e-mail — utilise une autre adresse pour le premier comptable en chef de ce cabinet.'
    const { bouton } = await ouvrirLeFormulaire()

    await act(async () => { bouton.click() })
    expect(screen.getByText(/Un compte existe déjà avec cet e-mail/)).toBeTruthy()
    await act(async () => { screen.getByRole('button', { name: 'Créer le cabinet' }).click() })

    expect(creations()).toHaveLength(2)
  })
})

// LA RÈGLE DES MOTS DE PASSE DU PROJET (défaut 23.5, 10/10/2026). `create-cabinet` prenait le refus d'un mot de passe par
// le service pour une adresse déjà inscrite — après avoir écrit le cabinet, qu'il retire. L'écran dit la règle avant le
// clic, refuse avant tout appel ce qui ne la suit pas (aucun cabinet écrit), et montre tel quel le refus que la fonction
// traduit.
describe('SuperAdminPage — la règle des mots de passe du projet', () => {
  async function ouvrir(motDePasse: string) {
    await act(async () => { render(<SuperAdminPage />) })
    await act(async () => { screen.getByRole('button', { name: '+ Nouveau cabinet' }).click() })
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Nom du cabinet'), { target: { value: 'Cabinet Fictif' } })
      fireEvent.change(screen.getByLabelText('Email du comptable en chef'), { target: { value: 'chef@cabinet-fictif.fr' } })
      fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: motDePasse } })
    })
  }

  it('dit la règle sous le champ, avant le clic — et le navigateur n’y remplit pas le mot de passe du super-administrateur', async () => {
    await ouvrir('')
    const champ = screen.getByLabelText<HTMLInputElement>('Mot de passe')
    const regle = screen.getByText(REGLE_DU_MOT_DE_PASSE)
    expect(champ.getAttribute('aria-describedby')).toBe(regle.id)
    expect(champ.autocomplete).toBe('new-password')
    expect(champ.minLength).toBe(10)
  })

  it('un mot de passe qui ne suit pas la règle ne part pas : aucun cabinet écrit, et l’écran dit ce qui manque', async () => {
    await ouvrir('Motdepasse12')
    await act(async () => { screen.getByRole('button', { name: 'Créer le cabinet' }).click() })
    expect(creations()).toEqual([])
    expect(screen.getByText('Ce mot de passe ne suit pas la règle du projet : il doit contenir un symbole.')).toBeTruthy()
    await act(async () => { fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: MOT_DE_PASSE } }) })
    await act(async () => { screen.getByRole('button', { name: 'Créer le cabinet' }).click() })
    expect(creations()).toHaveLength(1)
  })

  it('le refus du service, traduit par la fonction (400), se dit tel quel, et le formulaire reste ouvert', async () => {
    const refus = refusDuMotDePasse(new AuthWeakPasswordError('Password should contain at least one character of each: …', 422, ['characters']))
    expect(refus).toMatch(/il lui manque une sorte de caractères/)
    faux.erreur = new FunctionsHttpError(new Response(JSON.stringify({ error: refus }), { status: 400, headers: { 'Content-Type': 'application/json' } }))
    await ouvrir(MOT_DE_PASSE)
    await act(async () => { screen.getByRole('button', { name: 'Créer le cabinet' }).click() })
    expect(await screen.findByText(refus as string)).toBeTruthy()
    expect(screen.queryAllByText(/Un compte existe déjà/)).toHaveLength(0)
    expect(screen.getByRole('heading', { name: 'Nouveau cabinet' })).toBeTruthy()
  })
})
