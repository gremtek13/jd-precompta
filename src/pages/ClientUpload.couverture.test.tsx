import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClientUpload from './ClientUpload'

// « MES PIÈCES » QUAND LA COUVERTURE DU RELEVÉ EST EN BASE (espace client, étape P7) — le pendant de
// ClientHome.couverture.test.tsx. Drapeau levé, l'écran ne lit plus aucun mouvement : il lit des mois par
// `couverture_du_releve`, en réclame ce qui manque, dit une couverture refusée, et ne réclame rien avant qu'elle revienne.
// Drapeau baissé (ClientUpload.test.tsx), il lit les mouvements comme avant.
vi.mock('../lib/couvertureReleve', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/couvertureReleve')>(),
  COUVERTURE_EXPORTEE: true,
}))

const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, unknown[]>,
  demandees: [] as string[],
  rpcs: [] as { nom: string; args: unknown }[],
  couverture: { data: [] as unknown, error: null as { message: string } | null },
  porteCouverture: null as Promise<void> | null,
}))

vi.mock('../lib/depot', () => ({ deposerFichier: vi.fn() }))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      let debut = 0
      let fin = Number.MAX_SAFE_INTEGER
      Object.assign(chaine, {
        select: () => chaine,
        eq: () => chaine,
        order: () => chaine,
        range: (d: number, f: number) => { debut = d; fin = f; return chaine },
        then: (suite: (r: { data: unknown[]; error: null; count: number }) => unknown) => {
          faux.demandees.push(table)
          const toutes = faux.parTable[table] ?? []
          return Promise.resolve({ data: toutes.slice(debut, fin + 1), error: null, count: toutes.length }).then(suite)
        },
      })
      return chaine
    },
    rpc: (nom: string, args: unknown) => {
      faux.rpcs.push({ nom, args })
      const reponse = async () => {
        await faux.porteCouverture
        return { ...faux.couverture, count: null, status: faux.couverture.error ? 400 : 200, statusText: '' }
      }
      return { then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => reponse().then(suite, echec) }
    },
  },
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ dossierActifId: 'dossier-de-test' }),
}))

function poser(couverture: { data?: unknown; error?: { message: string } | null } = {}) {
  faux.parTable = {
    pieces: [],
    documents_divers: [],
    lignes_bancaires: [{ id: 'l1', date: '2026-01-15' }],
    cotisations_declarees: [],
    piece_commentaires: [],
    exercices_clotures: [{ annee: 2025 }],
  }
  faux.demandees = []
  faux.rpcs = []
  faux.couverture = { data: couverture.data ?? [], error: couverture.error ?? null }
  faux.porteCouverture = null
}

async function monter() {
  render(<MemoryRouter><ClientUpload /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Mes dépôts' })
  await waitFor(() => expect(screen.queryAllByText('Chargement…')).toHaveLength(0))
}

function detailDe(libelle: string): string {
  return screen.getByText(libelle).nextElementSibling?.textContent ?? ''
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-25T10:00:00Z')) })
afterEach(() => { vi.useRealTimers() })

describe('ClientUpload — drapeau levé : la couverture du relevé, jamais les mouvements', () => {
  it('lit la couverture par couverture_du_releve, sur le dossier affiché, et ne demande aucun mouvement', async () => {
    poser({ data: ['2026-01-01'] })
    await monter()
    expect(faux.rpcs).toEqual([{ nom: 'couverture_du_releve', args: { p_dossier_id: 'dossier-de-test' } }])
    expect(faux.demandees).not.toContain('lignes_bancaires')
  })

  it('les mois couverts décident de ce qui est réclamé', async () => {
    poser({ data: ['2026-01-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01'] })
    await monter()
    expect(detailDe('Relevés bancaires 2026')).toBe('Mois manquants : février')
  })

  it('une couverture refusée se dit : le bandeau', async () => {
    poser({ data: null, error: { message: 'Accès refusé à ce dossier.' } })
    await monter()
    expect(screen.getByText(/Tes envois n'ont pas pu être affichés en entier\./)).toBeTruthy()
  })

  it('tant que la couverture n’est pas revenue, rien n’est réclamé', async () => {
    poser({ data: ['2026-01-01'] })
    let ouvrir = () => {}
    faux.porteCouverture = new Promise<void>((resolve) => { ouvrir = resolve })
    render(<MemoryRouter><ClientUpload /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Mes dépôts' })
    await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)) })
    expect(screen.getAllByText('Chargement…').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Mois manquants/)).toBeNull()
    await act(async () => { ouvrir() })
    await waitFor(() => expect(screen.queryAllByText('Chargement…')).toHaveLength(0))
    expect(detailDe('Relevés bancaires 2026')).toMatch(/^Mois manquants : février, mars/)
  })
})
