import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClientHome from './ClientHome'

// L'ACCUEIL DU CLIENT QUAND LA COUVERTURE DU RELEVÉ EST EN BASE (espace client, étape P7). `couverture_du_releve` vit dans
// une migration présentée au cabinet avant d'être appliquée : tant qu'elle n'est pas dans l'export, `COUVERTURE_EXPORTEE`
// est faux et l'accueil lit les mouvements comme avant (ClientHome.test.tsx le garde). Ce fichier joue l'écran drapeau
// LEVÉ, pour que le jour de la bascule le geste soit déjà éprouvé : l'accueil ne lit plus AUCUN mouvement — le
// resserrement les fermera à un accès sans la case « Banque », et une lecture refusée rend un relevé VIDE, sans erreur —,
// il lit des mois par la fonction, en réclame ce qui manque, et dit une couverture refusée ou illisible.
vi.mock('../lib/couvertureReleve', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/couvertureReleve')>(),
  COUVERTURE_EXPORTEE: true,
}))

const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, unknown[]>,
  demandees: [] as string[],
  rpcs: [] as { nom: string; args: unknown }[],
  // Ce que rend `couverture_du_releve` : une valeur, ou un refus.
  couverture: { data: [] as unknown, error: null as { message: string } | null },
  // La réponse de la couverture attend que le test la libère : l'écran se regarde PENDANT la lecture.
  porteCouverture: null as Promise<void> | null,
}))

vi.mock('../lib/depot', () => ({ deposerFichier: async () => ({ statut: 'erreur', message: 'non joué ici' }) }))

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
        maybeSingle: () => Promise.resolve({ data: (faux.parTable[table] ?? [])[0] ?? null, error: null }),
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
  useAuth: () => ({ dossierActifId: 'dossier-de-test', prenom: null, mesSocietes: [] }),
}))

function poser(couverture: { data?: unknown; error?: { message: string } | null } = {}) {
  faux.parTable = {
    dossiers: [{ id: 'dossier-de-test', nom: 'Dossier de test' }],
    pieces: [],
    documents_divers: [],
    // Des mouvements EN BASE : l'écran ne doit pas les lire.
    lignes_bancaires: [{ id: 'l1', date: '2026-01-15' }, { id: 'l2', date: '2026-02-10' }],
    cotisations_declarees: [],
    // 2025 est clos : seul 2026 se réclame, et les mois disent tout.
    exercices_clotures: [{ annee: 2025 }],
  }
  faux.demandees = []
  faux.rpcs = []
  faux.couverture = { data: couverture.data ?? [], error: couverture.error ?? null }
  faux.porteCouverture = null
}

function monter() {
  return render(<MemoryRouter><ClientHome /></MemoryRouter>)
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-25T10:00:00Z')) })
afterEach(() => { vi.useRealTimers() })

describe('ClientHome — drapeau levé : la couverture du relevé, jamais les mouvements', () => {
  it('lit la couverture par couverture_du_releve, sur le dossier affiché, et ne demande aucun mouvement', async () => {
    poser({ data: ['2026-01-01', '2026-02-01'] })
    monter()
    expect(await screen.findByText('Relevés bancaires 2026')).toBeTruthy()
    expect(faux.rpcs).toEqual([{ nom: 'couverture_du_releve', args: { p_dossier_id: 'dossier-de-test' } }])
    expect(faux.demandees).not.toContain('lignes_bancaires')
  })

  it('les mois couverts décident de ce qui est réclamé : ni plus, ni moins', async () => {
    // Au 25 septembre, huit mois sont révolus ; la couverture en porte trois, dont un d'une autre année.
    poser({ data: ['2025-12-01', '2026-01-01', '2026-02-01', '2026-04-01'] })
    monter()
    expect(await screen.findByText('Mois manquants : mars, mai, juin, juillet, août')).toBeTruthy()
    expect(screen.getByText('5 mois à envoyer')).toBeTruthy()
    expect(screen.queryByText(/Tes envois n'ont pas pu être affichés/)).toBeNull()
  })

  it('un relevé couvert jusqu’au dernier mois révolu ne réclame rien', async () => {
    poser({ data: ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01'] })
    monter()
    expect(await screen.findByText('8/8 mois reçus')).toBeTruthy()
    expect(screen.getByText('tous reçus')).toBeTruthy()
  })

  it('une couverture refusée se dit : le bandeau, comme une liste lue en partie', async () => {
    poser({ data: null, error: { message: 'Accès refusé à ce dossier.' } })
    monter()
    expect(await screen.findByText(/Tes envois n'ont pas pu être affichés en entier\./)).toBeTruthy()
  })

  it('une couverture illisible aussi — un jour au lieu d’un mois ne passe pas pour un relevé', async () => {
    poser({ data: ['2026-01-15'] })
    monter()
    expect(await screen.findByText(/Tes envois n'ont pas pu être affichés en entier\./)).toBeTruthy()
  })

  it('tant que la couverture n’est pas revenue, rien n’est réclamé : les squelettes, pas « Mois manquants »', async () => {
    poser({ data: ['2026-01-01'] })
    let ouvrir = () => {}
    faux.porteCouverture = new Promise<void>((resolve) => { ouvrir = resolve })
    monter()
    await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)) })
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.queryByText(/Mois manquants/)).toBeNull()
    await act(async () => { ouvrir() })
    expect(await screen.findByText(/Mois manquants : février, mars/)).toBeTruthy()
  })
})
