import { act, fireEvent, render, screen } from '@testing-library/react'
import { AuthApiError, AuthSessionMissingError } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import NouveauMotDePasse from './NouveauMotDePasse'

// L'écran que la session d'un lien « Mot de passe oublié » rencontre avant tout autre (App.tsx). Ce qu'aucun calcul pur
// ne voit : les deux saisies et la longueur jugées AVANT l'appel, le verrou, l'erreur du service lue et dite, et la fin
// (`onTermine`) seulement sur un succès.

const faux = vi.hoisted(() => ({
  appels: [] as unknown[],
  // La réponse de updateUser, retenue tant qu'on ne la relâche pas.
  reponse: null as null | Promise<unknown>,
  resultat: { data: { user: { id: 'u-client' } }, error: null } as unknown,
  leve: null as unknown,
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      updateUser: async (attributs: unknown) => {
        faux.appels.push(attributs)
        if (faux.reponse) await faux.reponse
        if (faux.leve) throw faux.leve
        return faux.resultat
      },
    },
  },
}))

function retenue() {
  let relacher!: () => void
  const promesse = new Promise<void>((r) => { relacher = r })
  return { promesse, relacher }
}

const MOT_DE_PASSE = 'un-mot-de-passe-fictif'

function monter() {
  const onTermine = vi.fn()
  const onDeconnexion = vi.fn()
  render(<NouveauMotDePasse email="client@exemple-fictif.fr" onTermine={onTermine} onDeconnexion={onDeconnexion} />)
  return { onTermine, onDeconnexion }
}

function saisir(motDePasse: string, confirmation: string) {
  fireEvent.change(screen.getByLabelText('Nouveau mot de passe'), { target: { value: motDePasse } })
  fireEvent.change(screen.getByLabelText('Confirmer le mot de passe'), { target: { value: confirmation } })
}

// La soumission du formulaire, sans la validation du navigateur (`minLength`) : c'est le jugement de l'écran qu'on éprouve.
const formulaire = () => screen.getByRole('button', { name: 'Enregistrer' }).closest('form')!

beforeEach(() => {
  faux.appels = []
  faux.reponse = null
  faux.resultat = { data: { user: { id: 'u-client' } }, error: null }
  faux.leve = null
})

describe('NouveauMotDePasse', () => {
  it('nomme le compte, pour la personne et pour son gestionnaire de mots de passe', () => {
    monter()
    const compte = screen.getByLabelText<HTMLInputElement>('Compte')
    expect(compte.value).toBe('client@exemple-fictif.fr')
    expect(compte.readOnly).toBe(true)
    expect(compte.autocomplete).toBe('username')
    expect(screen.getByLabelText<HTMLInputElement>('Nouveau mot de passe').autocomplete).toBe('new-password')
  })

  it('un mot de passe de moins de dix caractères ne part pas', () => {
    const { onTermine } = monter()
    saisir('a'.repeat(9), 'a'.repeat(9))
    fireEvent.submit(formulaire())
    expect(screen.getByRole('alert').textContent).toBe('Le mot de passe doit faire au moins 10 caractères.')
    expect(faux.appels).toEqual([])
    expect(onTermine).not.toHaveBeenCalled()
  })

  it('deux saisies différentes ne partent pas', () => {
    const { onTermine } = monter()
    saisir(MOT_DE_PASSE, `${MOT_DE_PASSE}-autre`)
    fireEvent.submit(formulaire())
    expect(screen.getByRole('alert').textContent).toBe('Les deux saisies ne sont pas identiques.')
    expect(faux.appels).toEqual([])
    expect(onTermine).not.toHaveBeenCalled()
  })

  it('dix caractères identiques partent, une fois, et l’application s’ouvre sur le succès', async () => {
    const { onTermine } = monter()
    saisir('b'.repeat(10), 'b'.repeat(10))
    await act(async () => { fireEvent.submit(formulaire()) })
    expect(faux.appels).toEqual([{ password: 'b'.repeat(10) }])
    expect(onTermine).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('deux envois du même geste ne font qu’un appel', async () => {
    const r = retenue()
    faux.reponse = r.promesse
    const { onTermine } = monter()
    saisir(MOT_DE_PASSE, MOT_DE_PASSE)
    act(() => {
      fireEvent.submit(formulaire())
      fireEvent.submit(formulaire())
    })
    expect(faux.appels).toHaveLength(1)
    await act(async () => { r.relacher() })
    expect(onTermine).toHaveBeenCalledTimes(1)
  })

  it('trois envois non plus — le verrou est posé avant l’appel, pas après', async () => {
    const r = retenue()
    faux.reponse = r.promesse
    monter()
    saisir(MOT_DE_PASSE, MOT_DE_PASSE)
    act(() => {
      fireEvent.submit(formulaire())
      fireEvent.submit(formulaire())
      fireEvent.submit(formulaire())
    })
    expect(faux.appels).toHaveLength(1)
    await act(async () => { r.relacher() })
  })

  it('le verrou se relâche après un refus du service : le geste suivant repart', async () => {
    faux.resultat = { data: { user: null }, error: new AuthApiError('New password should be different from the old password.', 422, 'same_password') }
    const { onTermine } = monter()
    saisir(MOT_DE_PASSE, MOT_DE_PASSE)
    await act(async () => { fireEvent.submit(formulaire()) })
    expect(screen.getByRole('alert').textContent).toBe("C'est déjà le mot de passe de ce compte : choisis-en un autre.")
    expect(onTermine).not.toHaveBeenCalled()
    faux.resultat = { data: { user: { id: 'u-client' } }, error: null }
    await act(async () => { fireEvent.submit(formulaire()) })
    expect(faux.appels).toHaveLength(2)
    expect(onTermine).toHaveBeenCalledTimes(1)
  })

  it('une session expirée se dit, avec le remède', async () => {
    faux.resultat = { data: { user: null }, error: new AuthSessionMissingError() }
    const { onTermine } = monter()
    saisir(MOT_DE_PASSE, MOT_DE_PASSE)
    await act(async () => { fireEvent.submit(formulaire()) })
    expect(screen.getByRole('alert').textContent)
      .toBe("La session ouverte par le lien a expiré : déconnecte-toi, puis redemande un lien depuis l'écran de connexion.")
    expect(onTermine).not.toHaveBeenCalled()
  })

  it('une erreur inconnue se dit avec le message du service, et une exception aussi', async () => {
    faux.resultat = { data: { user: null }, error: new AuthApiError('Password cannot be longer than 72 characters', 422, 'validation_failed') }
    const { onTermine } = monter()
    saisir(MOT_DE_PASSE, MOT_DE_PASSE)
    await act(async () => { fireEvent.submit(formulaire()) })
    expect(screen.getByRole('alert').textContent).toBe("Le mot de passe n'a pas pu être changé : Password cannot be longer than 72 characters")
    faux.leve = new Error('réseau coupé')
    await act(async () => { fireEvent.submit(formulaire()) })
    expect(screen.getByRole('alert').textContent).toBe("Le mot de passe n'a pas pu être changé : réseau coupé")
    expect(onTermine).not.toHaveBeenCalled()
  })

  it('« Se déconnecter » rend la main, et se refuse pendant l’enregistrement', async () => {
    const r = retenue()
    faux.reponse = r.promesse
    const { onDeconnexion } = monter()
    saisir(MOT_DE_PASSE, MOT_DE_PASSE)
    act(() => { fireEvent.submit(formulaire()) })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Se déconnecter' }).disabled).toBe(true)
    await act(async () => { r.relacher() })
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }))
    expect(onDeconnexion).toHaveBeenCalledTimes(1)
  })
})
