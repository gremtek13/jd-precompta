import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { motsDuCabinet } from '../lib/espaceVentes'
import SecuriteDuCompte from './SecuriteDuCompte'

// « SÉCURITÉ DU COMPTE » (ligne 51.5, étape C7), devant un faux `supabase.auth.mfa` qui tient ses facteurs comme le service :
// ce qu'aucun calcul pur ne voit — l'ajout (le code QR, la clé par groupes), le code refusé avant le clic, le verrou de la
// confirmation, la relecture après chaque geste, le retrait confirmé par son nom puis la session renouvelée, la session à
// actualiser, et les mots du client.

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
type FacteurFaux = { id: string; friendly_name: string; factor_type: string; status: string; created_at: string }
const faux = vi.hoisted(() => ({
  facteurs: [] as FacteurFaux[],
  niveaux: { currentLevel: 'aal1', nextLevel: 'aal1' },
  appels: [] as string[],
  retenue: null as null | Promise<void>,
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      refreshSession: async () => {
        faux.appels.push('refreshSession')
        if (faux.facteurs.every((f) => f.status !== 'verified')) faux.niveaux = { currentLevel: 'aal1', nextLevel: 'aal1' }
        return { data: { session: null, user: null }, error: null }
      },
      mfa: {
        listFactors: async () => {
          faux.appels.push('listFactors')
          return { data: { all: faux.facteurs.map((f) => ({ ...f })) }, error: null }
        },
        getAuthenticatorAssuranceLevel: async () => ({ data: { ...faux.niveaux, currentAuthenticationMethods: [] }, error: null }),
        enroll: async (p: { friendlyName: string }) => {
          faux.appels.push(`enroll ${p.friendlyName}`)
          faux.facteurs.push({ id: 'f-neuf', friendly_name: p.friendlyName, factor_type: 'totp', status: 'unverified', created_at: '2026-11-06T10:00:00Z' })
          return { data: { id: 'f-neuf', type: 'totp', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>', secret: SECRET, uri: '' } }, error: null }
        },
        challenge: async (p: { factorId: string }) => {
          faux.appels.push(`challenge ${p.factorId}`)
          return { data: { id: 'c1' }, error: null }
        },
        verify: async (p: { factorId: string; code: string }) => {
          faux.appels.push(`verify ${p.factorId} ${p.code}`)
          if (faux.retenue) await faux.retenue
          faux.facteurs = faux.facteurs.map((f) => (f.id === p.factorId ? { ...f, status: 'verified' } : f))
          faux.niveaux = { currentLevel: 'aal2', nextLevel: 'aal2' }
          return { data: {}, error: null }
        },
        unenroll: async (p: { factorId: string }) => {
          faux.appels.push(`unenroll ${p.factorId}`)
          faux.facteurs = faux.facteurs.filter((f) => f.id !== p.factorId)
          return { data: { id: p.factorId }, error: null }
        },
      },
    },
  },
}))

const TELEPHONE: FacteurFaux = { id: 'f1', friendly_name: 'Téléphone', factor_type: 'totp', status: 'verified', created_at: '2026-11-01T09:00:00Z' }

function retenue() {
  let relacher!: () => void
  const promesse = new Promise<void>((r) => { relacher = r })
  return { promesse, relacher }
}

beforeEach(() => {
  faux.facteurs = []
  faux.niveaux = { currentLevel: 'aal1', nextLevel: 'aal1' }
  faux.appels = []
  faux.retenue = null
})

describe('Sécurité du compte', () => {
  it('ajoute un appareil : la clé par groupes, le code refusé avant le clic, une seule vérification pour deux clics, puis la relecture', async () => {
    render(<SecuriteDuCompte espace="cabinet" />)
    expect(await screen.findByText(/^Aucun appareil n’est inscrit : ce compte/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Ajouter l’appareil/ }))
    expect(await screen.findByAltText('Code QR de l’appareil « Téléphone »')).toBeTruthy()
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeTruthy()
    expect(faux.appels).toEqual(['listFactors', 'enroll Téléphone', 'listFactors'])

    const confirmer = screen.getByRole('button', { name: 'Confirmer « Téléphone »' }) as HTMLButtonElement
    fireEvent.change(screen.getByLabelText('Code à six chiffres'), { target: { value: '12345' } })
    expect(screen.getByText('Le code compte six chiffres, sans lettre ni signe.')).toBeTruthy()
    expect(confirmer.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Code à six chiffres'), { target: { value: '123 456' } })
    expect(confirmer.disabled).toBe(false)

    const r = retenue()
    faux.retenue = r.promesse
    act(() => {
      fireEvent.click(confirmer)
      fireEvent.click(confirmer)
    })
    await act(async () => { r.relacher() })
    expect(await screen.findByText('Appareil confirmé : la prochaine connexion demandera son code.')).toBeTruthy()
    expect(faux.appels.filter((a) => a.startsWith('verify'))).toEqual(['verify f-neuf 123456'])
    expect(faux.appels.at(-1)).toBe('listFactors')
    expect(screen.getByText('Actif')).toBeTruthy()
  })

  it('retire un appareil après une confirmation qui le nomme, puis renouvelle la session', async () => {
    faux.facteurs = [TELEPHONE]
    faux.niveaux = { currentLevel: 'aal2', nextLevel: 'aal2' }
    render(<SecuriteDuCompte espace="cabinet" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Retirer' }))
    expect(screen.getByText('Retirer « Téléphone » ? Ses codes ne seront plus acceptés. C’est le dernier appareil confirmé : '
      + 'ce compte se connectera de nouveau avec son seul mot de passe.')).toBeTruthy()
    expect(faux.appels).toEqual(['listFactors'])
    fireEvent.click(screen.getByRole('button', { name: 'Retirer « Téléphone »' }))
    expect(await screen.findByText('« Téléphone » est retiré.')).toBeTruthy()
    expect(faux.appels).toEqual(['listFactors', 'unenroll f1', 'refreshSession', 'listFactors'])
    expect(screen.getByText(/^Aucun appareil n’est inscrit/)).toBeTruthy()
  })

  it('une session qui ne dit plus ce que le service sait propose de l’actualiser, et rien d’autre', async () => {
    faux.niveaux = { currentLevel: 'aal2', nextLevel: 'aal2' }
    render(<SecuriteDuCompte espace="cabinet" />)
    const actualiser = await screen.findByRole('button', { name: 'Actualiser la session' })
    expect(screen.queryByRole('button', { name: /Ajouter l’appareil/ })).toBeNull()
    fireEvent.click(actualiser)
    expect(await screen.findByRole('button', { name: /Ajouter l’appareil/ })).toBeTruthy()
    expect(faux.appels).toEqual(['listFactors', 'refreshSession', 'listFactors'])
  })

  it('tutoie le client, sans aucune forme du cabinet, la liste, la confirmation et l’ajout ouverts', async () => {
    faux.facteurs = [TELEPHONE, { ...TELEPHONE, id: 'f2', friendly_name: 'Tablette', status: 'unverified' }]
    faux.niveaux = { currentLevel: 'aal2', nextLevel: 'aal2' }
    render(<SecuriteDuCompte espace="client" />)
    fireEvent.click((await screen.findAllByRole('button', { name: 'Retirer' }))[0])
    expect(screen.getByText(/ton compte se connectera de nouveau avec ton seul mot de passe/)).toBeTruthy()
    expect(motsDuCabinet(document.body.textContent ?? '')).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    fireEvent.click(screen.getByRole('button', { name: /Ajouter l’appareil/ }))
    expect(await screen.findByText(/^Scanne ce code QR avec ton application/)).toBeTruthy()
    expect(motsDuCabinet(document.body.textContent ?? '')).toEqual([])
  })
})
