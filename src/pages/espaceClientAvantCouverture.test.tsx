import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClientHome from './ClientHome'
import ClientSimulation from './ClientSimulation'
import ClientUpload from './ClientUpload'
import { SIMULATION_SANS_BANQUE } from '../lib/couvertureReleve'

// L'ESPACE CLIENT TANT QUE LA COUVERTURE DU RELEVÉ N'EST PAS EN BASE (étape P7, drapeau BAISSÉ). La migration
// `banque_du_client` se présente au cabinet avant d'être appliquée ; tant que l'export ne la porte pas,
// `COUVERTURE_EXPORTEE` est faux et RIEN ne change pour le client : l'Accueil et « Mes pièces » lisent les mouvements
// comme avant, sans appeler aucune fonction, et « Ma simulation » s'affiche à un accès qui ne porte aucune case. Le
// drapeau est FORCÉ ici, pour que ce comportement reste éprouvé après la bascule, tant que son code existe ; le drapeau
// levé se joue dans ClientHome.couverture.test.tsx, ClientUpload.couverture.test.tsx et ClientSimulation.banque.test.tsx,
// et les autres tests des trois écrans valent dans les deux états.
vi.mock('../lib/couvertureReleve', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/couvertureReleve')>(),
  COUVERTURE_EXPORTEE: false,
}))

const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, unknown[]>,
  demandees: [] as string[],
  rpcs: [] as string[],
}))

// Une doublure sans filtres : ce fichier compte ce que les écrans DEMANDENT, pas ce qu'ils calculent (leurs propres
// tests le gardent). Toute méthode de chaîne rend la chaîne ; la lecture rend la table, en tranches.
vi.mock('../lib/supabase', () => {
  const chaine = (table: string): unknown => {
    let debut = 0
    let fin = Number.MAX_SAFE_INTEGER
    const lignes = () => faux.parTable[table] ?? []
    const proxy: unknown = new Proxy({}, {
      get: (_cible, cle) => {
        if (cle === 'then') {
          return (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
            faux.demandees.push(table)
            return Promise.resolve({ data: lignes().slice(debut, fin + 1), error: null, count: lignes().length }).then(suite, echec)
          }
        }
        if (cle === 'range') return (d: number, f: number) => { debut = d; fin = f; return proxy }
        if (cle === 'maybeSingle' || cle === 'single') {
          return () => { faux.demandees.push(table); return Promise.resolve({ data: lignes()[0] ?? null, error: null }) }
        }
        return () => proxy
      },
    })
    return proxy
  }
  return {
    supabase: {
      from: (table: string) => chaine(table),
      rpc: (nom: string) => { faux.rpcs.push(nom); return Promise.resolve({ data: null, error: { message: `fonction inattendue : ${nom}` } }) },
    },
  }
})

vi.mock('../lib/depot', () => ({ deposerFichier: async () => ({ statut: 'erreur', message: 'non joué ici' }) }))

// Un accès SANS AUCUNE CASE : drapeau baissé, rien ne lui est retiré.
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ dossierActifId: 'dossier-de-test', prenom: null, mesSocietes: [], droitsParDossier: {} }),
}))

function poser() {
  faux.parTable = {
    dossiers: [{ id: 'dossier-de-test', nom: 'Dossier de test', assujetti_tva: false, mode_comptable: 'tresorerie' }],
    // Janvier seul au relevé ; 2025 est clos : seul 2026 se réclame, et les mois disent tout.
    lignes_bancaires: [{ id: 'l1', dossier_id: 'dossier-de-test', date: '2026-01-15' }],
    exercices_clotures: [{ annee: 2025 }],
  }
  faux.demandees = []
  faux.rpcs = []
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-25T10:00:00Z')); poser() })
afterEach(() => { vi.useRealTimers() })

describe('l’espace client, drapeau baissé : rien ne change', () => {
  it('l’Accueil lit les mouvements, en tire les mois manquants, et n’appelle aucune fonction', async () => {
    render(<MemoryRouter><ClientHome /></MemoryRouter>)
    expect(await screen.findByText(/Mois manquants : février, mars/)).toBeTruthy()
    expect(faux.demandees).toContain('lignes_bancaires')
    expect(faux.rpcs).toEqual([])
  })

  it('« Mes pièces » de même', async () => {
    render(<MemoryRouter><ClientUpload /></MemoryRouter>)
    const libelle = await screen.findByText('Relevés bancaires 2026')
    await waitFor(() => expect(libelle.nextElementSibling?.textContent ?? '').toMatch(/^Mois manquants : février, mars/))
    expect(faux.demandees).toContain('lignes_bancaires')
    expect(faux.rpcs).toEqual([])
  })

  it('« Ma simulation » s’affiche à un accès sans aucune case, lit le relevé, et ne demande pas les droits à la base', async () => {
    render(<MemoryRouter><ClientSimulation /></MemoryRouter>)
    expect(await screen.findByText('CA encaissé à date')).toBeTruthy()
    expect(screen.queryByText(SIMULATION_SANS_BANQUE)).toBeNull()
    expect(faux.demandees).toContain('lignes_bancaires')
    expect(faux.rpcs).toEqual([])
  })
})
