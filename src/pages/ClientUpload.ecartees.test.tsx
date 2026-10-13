import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClientUpload from './ClientUpload'
import { motsDuCabinet } from '../lib/espaceVentes'
import { ECARTEES_EN_LECTURE } from '../lib/piecesJointesEcarteesClient'

// « MES PIÈCES » ET LES PIÈCES JOINTES ÉCARTÉES (ligne 22.9) : ce que la page fait de la base. Drapeau levé, elle lit
// `pieces_jointes_ecartees_du_client` au montage, une fois, pour la société affichée, dit l'attente avant la réponse, la
// carte après — rien sur un vide lu en entier, le bandeau sur un refus ou une réponse illisible —, et une lecture plus
// lente que le changement de société ne s'affiche pas pour l'autre. Drapeau baissé (l'état d'avant la bascule, gardé
// tant que son code existe), elle n'appelle rien et ne dit rien. Le drapeau se lit par un ACCESSEUR : les deux états se jouent
// dans ce fichier (le patron de FacturesTabSuppressionBrouillon.test.tsx). Ce que la carte dit : son propre test.

const faux = vi.hoisted(() => ({
  drapeau: true,
  dossier: 'dossier-a',
  rpcs: [] as { nom: string; args: unknown }[],
  // Par société : la réponse de la fonction, et une porte qui la retient tant qu'on ne l'ouvre pas.
  ecartees: {} as Record<string, { data: unknown; error: { message: string } | null }>,
  portes: {} as Record<string, Promise<void>>,
}))

vi.mock('../lib/piecesJointesEcarteesClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/piecesJointesEcarteesClient')>(),
  get ECARTEES_DU_CLIENT_EXPORTEES() { return faux.drapeau },
}))

vi.mock('../lib/depot', () => ({ deposerFichier: vi.fn() }))

vi.mock('../lib/supabase', () => ({
  supabase: {
    // Les listes de « ce qu'il reste à envoyer » et des dépôts, vides et lues en entier : elles ne sont pas le sujet.
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      Object.assign(chaine, {
        select: () => chaine,
        eq: () => chaine,
        order: () => chaine,
        // L'adresse e-mail du dossier (ligne 22.93) : un dossier SANS code, ce fichier n'étant pas celui de l'adresse
        // (ClientUpload.adresse.test.tsx) — rien ne s'en affiche, et aucune autre lecture n'en dépend.
        maybeSingle: () => Promise.resolve(table === 'dossiers'
          ? { data: { code_email: null }, error: null }
          : { data: null, error: { message: `lecture inattendue : ${table}` } }),
        range: () => chaine,
        then: (suite: (r: { data: unknown[]; error: null; count: number }) => unknown) => {
          void table
          return Promise.resolve({ data: [], error: null, count: 0 }).then(suite)
        },
      })
      return chaine
    },
    rpc: (nom: string, args: { p_dossier_id: string }) => {
      faux.rpcs.push({ nom, args })
      const reponse = async () => {
        if (nom === 'couverture_du_releve') return { data: [], error: null, count: null, status: 200, statusText: '' }
        await faux.portes[args.p_dossier_id]
        const r = faux.ecartees[args.p_dossier_id] ?? { data: [], error: null }
        return { ...r, count: null, status: r.error ? 400 : 200, statusText: '' }
      }
      return { then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => reponse().then(suite, echec) }
    },
  },
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ dossierActifId: faux.dossier }),
}))

function retenir(dossier: string): () => void {
  let ouvrir = () => {}
  faux.portes[dossier] = new Promise<void>((resolve) => { ouvrir = resolve })
  return ouvrir
}

const texte = () => (document.body.textContent ?? '').replace(/[ \t\r\n]+/g, ' ')
const appelsEcartees = () => faux.rpcs.filter((r) => r.nom === 'pieces_jointes_ecartees_du_client')

beforeEach(() => {
  faux.drapeau = true
  faux.dossier = 'dossier-a'
  faux.rpcs = []
  faux.ecartees = {}
  faux.portes = {}
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-13T10:00:00Z'))
})
afterEach(() => { vi.useRealTimers() })

async function monter() {
  const rendu = render(<MemoryRouter><ClientUpload /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Mes dépôts' })
  return rendu
}

describe('ClientUpload — drapeau levé : la lecture du client, en tête de « Mes pièces »', () => {
  it('lit la fonction au montage, une fois, pour la société affichée ; l’attente avant la réponse, la carte après', async () => {
    faux.ecartees['dossier-a'] = {
      data: [
        { jour: '2026-10-12', raison: 'format', octets: 4120 },
        { jour: '2026-10-11', raison: 'depot', octets: null },
      ],
      error: null,
    }
    const ouvrir = retenir('dossier-a')
    await monter()
    expect(appelsEcartees()).toEqual([{ nom: 'pieces_jointes_ecartees_du_client', args: { p_dossier_id: 'dossier-a' } }])
    expect(screen.getByText(ECARTEES_EN_LECTURE).getAttribute('aria-busy')).toBe('true')
    expect(screen.queryByRole('region', { name: 'Pièces jointes reçues par e-mail et non déposées' })).toBeNull()

    await act(async () => { ouvrir() })
    const carte = await screen.findByRole('region', { name: 'Pièces jointes reçues par e-mail et non déposées' })
    expect(carte.querySelector('h3')?.textContent).toBe('2 pièces jointes reçues par e-mail n’ont pas été déposées')
    expect([...carte.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'le 12/10/2026 — format non pris en charge (4 Ko)',
      'le 11/10/2026 — le dépôt a échoué avant toute lecture de la pièce jointe (poids inconnu)',
    ])
    expect(screen.queryByText(ECARTEES_EN_LECTURE)).toBeNull()
    // Une lecture, et rien d'autre : aucun dépôt ne la relit, aucune autre fonction n'est appelée pour elle.
    expect(appelsEcartees()).toHaveLength(1)
    expect(motsDuCabinet(carte.textContent ?? '')).toEqual([])
  })

  it('lue en entier et vide : rien — ni carte, ni attente, ni bandeau', async () => {
    faux.ecartees['dossier-a'] = { data: [], error: null }
    await monter()
    await waitFor(() => expect(screen.queryByText(ECARTEES_EN_LECTURE)).toBeNull())
    expect(screen.queryByRole('region', { name: 'Pièces jointes reçues par e-mail et non déposées' })).toBeNull()
    expect(texte()).not.toMatch(/pièces jointes reçues par e-mail/i)
  })

  it('refusée : le bandeau, dans les mots du client — jamais un « rien d’écarté »', async () => {
    faux.ecartees['dossier-a'] = { data: null, error: { message: 'Accès refusé à ce dossier.' } }
    await monter()
    const bandeau = await screen.findByText(/Les pièces jointes reçues par e-mail n'ont pas pu être affichées en entier\./)
    expect(bandeau.getAttribute('title')).toBe('lecture refusée : Accès refusé à ce dossier.')
    expect(screen.queryByRole('region', { name: 'Pièces jointes reçues par e-mail et non déposées' })).toBeNull()
  })

  it('illisible : le bandeau aussi', async () => {
    faux.ecartees['dossier-a'] = { data: { jour: '2026-10-12' }, error: null }
    await monter()
    expect((await screen.findByText(/Les pièces jointes reçues par e-mail n'ont pas pu être affichées en entier\./)).getAttribute('title'))
      .toBe('réponse illisible')
  })

  it('une lecture plus lente que le changement de société ne s’affiche pas pour l’autre', async () => {
    faux.ecartees['dossier-a'] = { data: [{ jour: '2026-10-12', raison: 'format', octets: 4120 }], error: null }
    faux.ecartees['dossier-b'] = { data: [{ jour: '2026-10-01', raison: 'vide', octets: 0 }], error: null }
    const ouvrirA = retenir('dossier-a')
    const ouvrirB = retenir('dossier-b')
    const { rerender } = await monter()
    faux.dossier = 'dossier-b'
    rerender(<MemoryRouter><ClientUpload /></MemoryRouter>)
    await waitFor(() => expect(appelsEcartees().map((a) => (a.args as { p_dossier_id: string }).p_dossier_id)).toEqual(['dossier-a', 'dossier-b']))
    // La réponse de la première société arrive la première : la seconde attend toujours la sienne.
    await act(async () => { ouvrirA() })
    expect(screen.getByText(ECARTEES_EN_LECTURE)).toBeTruthy()
    expect(texte()).not.toMatch(/format non pris en charge/)
    await act(async () => { ouvrirB() })
    const carte = await screen.findByRole('region', { name: 'Pièces jointes reçues par e-mail et non déposées' })
    expect(carte.textContent).toContain('le 01/10/2026 — arrivée vide (0 octet)')
    expect(carte.textContent).not.toMatch(/format non pris en charge/)
  })
})

describe('ClientUpload — drapeau baissé : la fonction n’est pas en base', () => {
  it('rien ne se lit, rien ne se dit — ni attente, ni carte, ni bandeau', async () => {
    faux.drapeau = false
    faux.ecartees['dossier-a'] = { data: [{ jour: '2026-10-12', raison: 'format', octets: 4120 }], error: null }
    await monter()
    await waitFor(() => expect(screen.queryAllByText('Chargement…')).toHaveLength(0))
    expect(appelsEcartees()).toEqual([])
    expect(texte()).not.toMatch(/pièces jointes reçues par e-mail/i)
  })
})
