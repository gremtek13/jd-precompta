import { act, fireEvent, render, screen } from '@testing-library/react'
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Login from './Login'

// L'écran de connexion et sa demande « Mot de passe oublié ». Ce qu'aucun calcul pur ne voit : l'adresse de retour
// passée EXPLICITEMENT à chaque demande, le message NEUTRE (le même qu'un compte existe ou non — le service répond de
// même), le verrou d'une demande qui part en e-mail, et l'erreur du service lue et dite, la limite de débit comprise.

const faux = vi.hoisted(() => ({
  demandes: [] as unknown[][],
  connexions: [] as unknown[],
  reponse: null as null | Promise<unknown>,
  resultat: { data: {}, error: null } as unknown,
  leve: null as unknown,
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: async (...args: unknown[]) => {
        faux.demandes.push(args)
        if (faux.reponse) await faux.reponse
        if (faux.leve) throw faux.leve
        return faux.resultat
      },
      signInWithPassword: async (identifiants: unknown) => {
        faux.connexions.push(identifiants)
        return { data: { user: null, session: null }, error: null }
      },
    },
  },
}))

function retenue() {
  let relacher!: () => void
  const promesse = new Promise<void>((r) => { relacher = r })
  return { promesse, relacher }
}

// Recopié de la consigne, pas du module : un message qui change doit faire échouer ce test.
const NEUTRE =
  "Si un compte existe pour cette adresse, un e-mail vient d'y partir avec un lien pour choisir un nouveau mot de passe. " +
  "Le lien ne sert qu'une fois. Pense à regarder dans les courriers indésirables."
const ADRESSE = 'client@exemple-fictif.fr'

function ouvrirLaDemande(adresse = ADRESSE) {
  render(<Login />)
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: adresse } })
  fireEvent.click(screen.getByRole('button', { name: 'Mot de passe oublié ?' }))
}

const formulaire = () => screen.getByRole('button', { name: /Recevoir un lien|Envoi…/ }).closest('form')!

beforeEach(() => {
  faux.demandes = []
  faux.connexions = []
  faux.reponse = null
  faux.resultat = { data: {}, error: null }
  faux.leve = null
})

describe('Login — « Mot de passe oublié ? »', () => {
  it('garde l’adresse saisie, demande le lien avec l’adresse de retour explicite, et répond le message neutre', async () => {
    ouvrirLaDemande()
    expect(screen.getByLabelText<HTMLInputElement>('Email').value).toBe(ADRESSE)
    await act(async () => { fireEvent.submit(formulaire()) })
    expect(faux.demandes).toEqual([[ADRESSE, { redirectTo: 'https://compta.jdarnis.fr/' }]])
    expect(screen.getByRole('status').textContent).toBe(NEUTRE)
    // Rien ne dit que le compte existe, ni ne le nomme.
    expect(document.body.textContent).not.toMatch(/introuvable|inconnu|aucun compte|n'existe pas/i)
    expect(screen.getByRole('status').textContent).not.toContain(ADRESSE)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('deux envois du même geste ne font qu’un e-mail', async () => {
    const r = retenue()
    faux.reponse = r.promesse
    ouvrirLaDemande()
    act(() => {
      fireEvent.submit(formulaire())
      fireEvent.submit(formulaire())
    })
    expect(faux.demandes).toHaveLength(1)
    await act(async () => { r.relacher() })
    expect(screen.getByRole('status').textContent).toBe(NEUTRE)
  })

  it('trois envois non plus — le verrou est posé avant l’appel ; il se relâche après la réponse', async () => {
    const r = retenue()
    faux.reponse = r.promesse
    ouvrirLaDemande()
    act(() => {
      fireEvent.submit(formulaire())
      fireEvent.submit(formulaire())
      fireEvent.submit(formulaire())
    })
    expect(faux.demandes).toHaveLength(1)
    await act(async () => { r.relacher() })
    faux.reponse = null
    await act(async () => { fireEvent.submit(formulaire()) })
    expect(faux.demandes).toHaveLength(2)
  })

  it('la limite de débit se dit, et aucun message de succès ne l’accompagne', async () => {
    faux.resultat = { data: null, error: new AuthApiError('For security purposes, you can only request this after 42 seconds.', 429, 'over_email_send_rate_limit') }
    ouvrirLaDemande()
    await act(async () => { fireEvent.submit(formulaire()) })
    expect(screen.getByRole('alert').textContent).toBe('Trop de demandes en peu de temps : attends quelques minutes avant de redemander un lien.')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('une autre erreur se dit avec le message du service — un SMTP mal réglé, par exemple', async () => {
    faux.resultat = { data: null, error: new AuthRetryableFetchError('Error sending recovery email', 500) }
    ouvrirLaDemande()
    await act(async () => { fireEvent.submit(formulaire()) })
    expect(screen.getByRole('alert').textContent).toBe("Le lien n'a pas pu être demandé : Error sending recovery email")
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('une exception se dit aussi, et libère le bouton', async () => {
    faux.leve = new Error('réseau coupé')
    ouvrirLaDemande()
    await act(async () => { fireEvent.submit(formulaire()) })
    expect(screen.getByRole('alert').textContent).toBe("Le lien n'a pas pu être demandé : réseau coupé")
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Recevoir un lien' }).disabled).toBe(false)
  })

  it('une adresse vide ne part pas', () => {
    ouvrirLaDemande('   ')
    fireEvent.submit(formulaire())
    expect(screen.getByRole('alert').textContent).toBe("Indique l'adresse e-mail du compte.")
    expect(faux.demandes).toEqual([])
  })

  it('« Retour à la connexion » rend le formulaire de connexion, qui se connecte comme avant', async () => {
    ouvrirLaDemande()
    fireEvent.click(screen.getByRole('button', { name: 'Retour à la connexion' }))
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'mot-de-passe-fictif' } })
    await act(async () => { fireEvent.submit(screen.getByRole('button', { name: 'Se connecter' }).closest('form')!) })
    expect(faux.connexions).toEqual([{ email: ADRESSE, password: 'mot-de-passe-fictif' }])
    expect(faux.demandes).toEqual([])
  })
})

describe('Login — un lien refusé', () => {
  it('se dit en tête, ouvre la demande d’un nouveau lien, et s’efface une fois le lien redemandé', async () => {
    render(<Login avis="Ce lien ne peut plus servir : il a expiré, ou il a déjà été utilisé." />)
    expect(screen.getByRole('alert').textContent)
      .toBe('Ce lien ne peut plus servir : il a expiré, ou il a déjà été utilisé. Demande un nouveau lien ci-dessous.')
    expect(screen.getByRole('button', { name: 'Recevoir un lien' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: ADRESSE } })
    await act(async () => { fireEvent.submit(formulaire()) })
    expect(faux.demandes).toHaveLength(1)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe(NEUTRE)
  })

  it('sans avis, l’écran s’ouvre sur la connexion', () => {
    render(<Login />)
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
