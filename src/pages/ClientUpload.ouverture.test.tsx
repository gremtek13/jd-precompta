import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClientUpload from './ClientUpload'
import { FICHIER_INDISPONIBLE, FICHIER_INTROUVABLE, OUVERTURE_BLOQUEE } from '../lib/ouvertureDeMesPieces'
import type { DocumentDivers, Piece } from '../lib/types'

// « VOIR » DANS « MES PIÈCES » (demande du cabinet du 16/11/2026) : le client ouvre le fichier d'un de ses envois. Le vrai
// `ouvrirApercu` (lib/apercu.ts) tourne ici, devant un faux stockage et un faux `window.open` : le test voit ce qui part au
// stockage, et ce qui n'y part pas.
const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, unknown[]>,
  signatures: [] as { seau: string; chemin: string; secondes: number }[],
  erreurDeSignature: null as { message: string } | null,
  // Une signature retenue jusqu'à ce que le test la libère : deux touchers se jouent PENDANT la première ouverture.
  retenir: false,
  enAttente: [] as (() => void)[],
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
        order: () => chaine,
        maybeSingle: () => Promise.resolve(table === 'dossiers'
          ? { data: { code_email: null }, error: null }
          : { data: null, error: { message: `lecture inattendue : ${table}` } }),
        range: (d: number, f: number) => { debut = d; fin = f; return chaine },
        then: (suite: (r: { data: unknown[]; error: null; count: number }) => unknown) => {
          const toutes = faux.parTable[table] ?? []
          return Promise.resolve({ data: toutes.slice(debut, fin + 1), error: null, count: toutes.length }).then(suite)
        },
      })
      return chaine
    },
    rpc: async (nom: string) => {
      const { couvertureDe } = await import('../test/couvertureDuReleve')
      if (nom === 'pieces_jointes_ecartees_du_client') return { data: [], error: null }
      if (nom !== 'couverture_du_releve') return { data: null, error: { message: `fonction inattendue : ${nom}` } }
      return { data: couvertureDe([]), error: null }
    },
    storage: {
      from: (seau: string) => ({
        createSignedUrl: async (chemin: string, secondes: number) => {
          faux.signatures.push({ seau, chemin, secondes })
          if (faux.retenir) await new Promise<void>((r) => faux.enAttente.push(r))
          return faux.erreurDeSignature
            ? { data: null, error: faux.erreurDeSignature }
            : { data: { signedUrl: `https://exemple/${chemin}` }, error: null }
        },
      }),
    },
  },
}))

vi.mock('../lib/depot', () => ({ deposerFichier: vi.fn() }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ dossierActifId: 'dossier-de-test' }) }))

function piece(o: Partial<Piece> = {}): Piece {
  return {
    id: 'p1', dossier_id: 'dossier-de-test', uploaded_by: null, source: 'upload',
    storage_path: 'dossier-de-test/facture.pdf', nom_fichier: 'facture.pdf', storage_hash: null,
    date_piece: '2026-09-01', tiers: 'FOURNISSEUR', montant_ht: null, montant_tva: null,
    montant_ttc: 120, devise: 'EUR', montant_devise: null, taux_change: null,
    conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'achat',
    statut: 'a_valider', confiance: 'haute', superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null, vente_hors_des_factures: false,
    created_at: '2026-09-10T09:00:00Z', updated_at: '2026-09-10T09:00:00Z', ...o,
  }
}

function documentDivers(o: Partial<DocumentDivers> = {}): DocumentDivers {
  return {
    id: 'd1', dossier_id: 'dossier-de-test', sous_dossier_id: null,
    storage_path: 'dossier-de-test/releve.pdf', storage_hash: null, nom_fichier: 'releve.pdf',
    categorie: 'releve_bancaire', attached_to_cotisation_id: null, created_at: '2026-09-02T09:00:00Z', ...o,
  }
}

let ouvertures: string[] = []
let bloquer = false

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-25T10:00:00Z'))
  faux.parTable = {
    pieces: [
      piece(),
      piece({ id: 'p2', nom_fichier: 'ailleurs.pdf', storage_path: 'autre-dossier/ailleurs.pdf', created_at: '2026-09-08T09:00:00Z' }),
    ],
    documents_divers: [documentDivers()],
    cotisations_declarees: [], piece_commentaires: [], exercices_clotures: [],
  }
  faux.signatures = []
  faux.erreurDeSignature = null
  faux.retenir = false
  faux.enAttente = []
  ouvertures = []
  bloquer = false
  vi.spyOn(window, 'open').mockImplementation((url?: string | URL) => {
    ouvertures.push(String(url))
    return bloquer ? null : ({ opener: window } as unknown as Window)
  })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

async function monter() {
  render(<MemoryRouter><ClientUpload /></MemoryRouter>)
  await waitFor(() => expect(screen.queryAllByText('Chargement…')).toHaveLength(0))
}

const voir = (nom: string) => screen.getByRole('button', { name: `Voir le fichier ${nom}` })

describe('« Voir » dans « Mes pièces »', () => {
  it('ouvre le fichier d’une pièce et celui d’un document, par l’adresse signée de leur chemin', async () => {
    await monter()
    await act(async () => { fireEvent.click(voir('facture.pdf')) })
    await act(async () => { fireEvent.click(voir('releve.pdf')) })
    expect(faux.signatures).toEqual([
      { seau: 'pieces', chemin: 'dossier-de-test/facture.pdf', secondes: 300 },
      { seau: 'pieces', chemin: 'dossier-de-test/releve.pdf', secondes: 300 },
    ])
    expect(ouvertures).toEqual(['https://exemple/dossier-de-test/facture.pdf', 'https://exemple/dossier-de-test/releve.pdf'])
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('montre la version lisible d’une facture reçue en XML', async () => {
    faux.parTable.pieces = [piece({ storage_path: 'dossier-de-test/f.xml', lisible_path: 'dossier-de-test/f.pdf' })]
    await monter()
    await act(async () => { fireEvent.click(voir('facture.pdf')) })
    expect(faux.signatures.map((s) => s.chemin)).toEqual(['dossier-de-test/f.pdf'])
  })

  it('un chemin d’un autre dossier n’est pas demandé au stockage, et l’échec se dit sans le chemin', async () => {
    await monter()
    await act(async () => { fireEvent.click(voir('ailleurs.pdf')) })
    expect(faux.signatures).toEqual([])
    expect(ouvertures).toEqual([])
    const alerte = screen.getByRole('alert')
    expect(alerte.textContent).toBe(FICHIER_INTROUVABLE)
    expect(alerte.textContent).not.toMatch(/autre-dossier/)
  })

  it('un fichier que le stockage ne signe pas, ou une fenêtre bloquée, se disent au client ; le geste suivant efface la phrase', async () => {
    faux.erreurDeSignature = { message: 'Object not found' }
    await monter()
    await act(async () => { fireEvent.click(voir('facture.pdf')) })
    expect(screen.getByRole('alert').textContent).toBe(FICHIER_INDISPONIBLE)
    expect(ouvertures).toEqual([])

    faux.erreurDeSignature = null
    bloquer = true
    await act(async () => { fireEvent.click(voir('facture.pdf')) })
    expect(screen.getByRole('alert').textContent).toBe(OUVERTURE_BLOQUEE)

    bloquer = false
    await act(async () => { fireEvent.click(voir('facture.pdf')) })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('deux touchers dans le même rendu n’ouvrent qu’une fenêtre', async () => {
    faux.retenir = true
    await monter()
    await act(async () => {
      fireEvent.click(voir('facture.pdf'))
      fireEvent.click(voir('facture.pdf'))
      fireEvent.click(voir('releve.pdf'))
    })
    expect(faux.signatures).toHaveLength(1)
    // Pendant l'ouverture, les « Voir » sont désactivés ; ils reviennent après.
    expect((voir('releve.pdf') as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { for (const r of faux.enAttente.splice(0)) r() })
    expect(ouvertures).toHaveLength(1)
    expect((voir('releve.pdf') as HTMLButtonElement).disabled).toBe(false)
  })

  it('un « Voir » par envoi lu, et rien d’autre de la pièce : ni son montant, ni son fournisseur', async () => {
    await monter()
    const ligne = voir('facture.pdf').closest('tr') as HTMLElement
    expect(within(ligne).queryByText(/120/)).toBeNull()
    expect(screen.queryByText(/FOURNISSEUR/)).toBeNull()
    expect(screen.getAllByRole('button', { name: /^Voir le fichier / })).toHaveLength(3)
  })
})
