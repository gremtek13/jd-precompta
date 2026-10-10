import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClientSimulation from './ClientSimulation'
import { SIMULATION_BANQUE_INVERIFIABLE, SIMULATION_SANS_BANQUE } from '../lib/couvertureReleve'
import type { Piece } from '../lib/types'

// « MA SIMULATION » SOUS LA CASE « BANQUE » (espace client, étape P7 ; EC-Q1, décidée). Drapeau levé — la couverture du
// relevé en base —, la simulation se calcule sur la banque, que la base ne rend plus qu'à la case : sans elle, l'écran se
// TAIT en le disant et ne demande rien ; avec elle, il demande aussi la case à la BASE, dans la même vague de lectures,
// et c'est la base qui décide (une case retirée depuis la connexion ferait calculer sur un relevé rendu vide, sans
// erreur). Drapeau baissé, espaceClientAvantCouverture.test.tsx garde que rien ne changerait.
vi.mock('../lib/couvertureReleve', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/couvertureReleve')>(),
  COUVERTURE_EXPORTEE: true,
}))

const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, unknown[]>,
  demandees: [] as string[],
  rpcs: [] as { nom: string; args: unknown }[],
  // Les droits que le contexte a lus à la connexion, par dossier.
  droits: {} as Record<string, { ventes: boolean; banque: boolean }>,
  // Ce que la base répond à `droits_sur_le_dossier`.
  droitsBase: { data: null as unknown, error: null as { message: string } | null },
  porte: null as Promise<void> | null,
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      let debut = 0
      let fin = Number.MAX_SAFE_INTEGER
      Object.assign(chaine, {
        select: () => chaine,
        eq: () => chaine,
        or: () => chaine,
        order: () => chaine,
        range: (d: number, f: number) => { debut = d; fin = f; return chaine },
        maybeSingle: () => { faux.demandees.push(table); return Promise.resolve({ data: (faux.parTable[table] ?? [])[0] ?? null, error: null }) },
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
        await faux.porte
        return { ...faux.droitsBase, count: null, status: faux.droitsBase.error ? 400 : 200, statusText: '' }
      }
      return { then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => reponse().then(suite, echec) }
    },
  },
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ dossierActifId: 'dossier-de-test', droitsParDossier: faux.droits }),
}))

function recette(o: Partial<Piece> = {}): Piece {
  return {
    id: 'r1', dossier_id: 'dossier-de-test', uploaded_by: null, source: 'upload',
    storage_path: 'dossier-de-test/r.pdf', nom_fichier: 'r.pdf', storage_hash: null,
    date_piece: '2026-03-02', tiers: 'CPAM', montant_ht: null, montant_tva: null,
    montant_ttc: 600, devise: 'EUR', montant_devise: null, taux_change: null,
    conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'vente',
    statut: 'validee', notes: null, confiance: 'haute', superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null,
    created_at: '2026-03-02T09:00:00Z', updated_at: '2026-03-02T09:00:00Z', ...o,
  }
}

function poser(o: { droits?: { ventes: boolean; banque: boolean }; base?: { data?: unknown; error?: { message: string } | null } } = {}) {
  faux.parTable = {
    dossiers: [{ assujetti_tva: false, mode_comptable: 'tresorerie' }],
    pieces: [recette()],
    cotisations_declarees: [],
    references_annuelles: [],
    references_postes_annuels: [],
    lignes_bancaires: [],
    categories: [],
    ventilations_bancaires: [],
    reglements_groupes: [],
  }
  faux.demandees = []
  faux.rpcs = []
  faux.droits = o.droits ? { 'dossier-de-test': o.droits } : {}
  faux.droitsBase = { data: o.base?.data ?? null, error: o.base?.error ?? null }
  faux.porte = null
}

async function laisserPasser() {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)) })
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-03-20T10:00:00Z')) })
afterEach(() => { vi.useRealTimers() })

describe('ClientSimulation — drapeau levé : sous la case « Banque »', () => {
  it('sans aucune case, se tait en le disant, et ne demande RIEN à la base', async () => {
    poser()
    render(<ClientSimulation />)
    expect(screen.getByText(SIMULATION_SANS_BANQUE)).toBeTruthy()
    await laisserPasser()
    expect(faux.demandees).toEqual([])
    expect(faux.rpcs).toEqual([])
    expect(screen.queryByText('CA encaissé à date')).toBeNull()
  })

  it('la case « Ventes » seule n’ouvre pas la simulation', async () => {
    poser({ droits: { ventes: true, banque: false } })
    render(<ClientSimulation />)
    expect(screen.getByText(SIMULATION_SANS_BANQUE)).toBeTruthy()
    await laisserPasser()
    expect(faux.demandees).toEqual([])
  })

  it('avec la case « Banque », confirmée par la base : la simulation, et la case demandée sur le dossier affiché', async () => {
    poser({ droits: { ventes: false, banque: true }, base: { data: { cabinet: false, membre: true, ventes: false, banque: true } } })
    render(<ClientSimulation />)
    expect(await screen.findByText('CA encaissé à date')).toBeTruthy()
    expect(faux.rpcs).toEqual([{ nom: 'droits_sur_le_dossier', args: { p_dossier_id: 'dossier-de-test' } }])
    expect(faux.demandees).toContain('lignes_bancaires')
    expect(screen.queryByText(SIMULATION_SANS_BANQUE)).toBeNull()
  })

  it('la case lue à la connexion, retirée depuis en base : la simulation se tait, rien de ce qui a été lu n’est montré', async () => {
    poser({ droits: { ventes: false, banque: true }, base: { data: { cabinet: false, membre: true, ventes: false, banque: false } } })
    render(<ClientSimulation />)
    expect(await screen.findByText(SIMULATION_SANS_BANQUE)).toBeTruthy()
    expect(screen.queryByText('CA encaissé à date')).toBeNull()
    expect(screen.queryByText(/Projection/)).toBeNull()
  })

  it('une case que la base ne peut pas dire : la simulation se tait aussi, et dit de recharger', async () => {
    poser({ droits: { ventes: false, banque: true }, base: { error: { message: 'JWT expired' } } })
    render(<ClientSimulation />)
    expect(await screen.findByText(SIMULATION_BANQUE_INVERIFIABLE)).toBeTruthy()
    expect(screen.queryByText('CA encaissé à date')).toBeNull()
  })

  it('une réponse d’une autre forme aussi', async () => {
    poser({ droits: { ventes: false, banque: true }, base: { data: [{ banque: true }] } })
    render(<ClientSimulation />)
    expect(await screen.findByText(SIMULATION_BANQUE_INVERIFIABLE)).toBeTruthy()
  })

  it('pendant la lecture, « Chargement… » — ni la simulation ni le refus', async () => {
    poser({ droits: { ventes: false, banque: true }, base: { data: { banque: true } } })
    let ouvrir = () => {}
    faux.porte = new Promise<void>((resolve) => { ouvrir = resolve })
    render(<ClientSimulation />)
    await laisserPasser()
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByText(SIMULATION_SANS_BANQUE)).toBeNull()
    await act(async () => { ouvrir() })
    expect(await screen.findByText('CA encaissé à date')).toBeTruthy()
  })
})
