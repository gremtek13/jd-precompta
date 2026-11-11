import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ClientUpload from './ClientUpload'

// « MES PIÈCES » ET LES HONORAIRES DÉPOSÉS PAR LE CABINET (ligne 47, LM8). Drapeau levé, la page lit
// `honoraires_deposes_au_dossier` pour la société affichée, et une pièce que le cabinet y a déposée se dit « Facture
// d'honoraires déposée par ton cabinet » ; lue en partie ou refusée, rien n'est deviné — la pièce reste « Facture », et une
// ligne discrète le dit. Drapeau baissé, rien n'est lu et « Mes pièces » est celle d'hier. Données FICTIVES.

const faux = vi.hoisted(() => ({
  drapeau: true,
  rpcs: [] as string[],
  honoraires: { data: [] as unknown[], error: null as { message: string } | null, count: 0 as number | null },
}))

vi.mock('../lib/depotDesHonoraires', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/depotDesHonoraires')>(),
  get DEPOT_DES_HONORAIRES_PREVU() { return faux.drapeau },
}))
vi.mock('../lib/depot', () => ({ deposerFichier: vi.fn() }))

const PIECE = {
  id: 'p1', dossier_id: 'dossier-a', nom_fichier: 'Facture F2027-0001.pdf', created_at: '2027-11-03T09:00:00Z', statut: 'a_valider',
  montant_ht: 150, montant_tva: 30, montant_ttc: 180, montant_devise: null, type_piece: 'achat', date_piece: '2027-11-02',
}

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      Object.assign(chaine, {
        select: () => chaine, eq: () => chaine, order: () => chaine, range: () => chaine,
        maybeSingle: () => Promise.resolve(table === 'dossiers'
          ? { data: { code_email: null }, error: null }
          : { data: null, error: { message: `lecture inattendue : ${table}` } }),
        then: (suite: (r: { data: unknown[]; error: null; count: number }) => unknown) => {
          const data = table === 'pieces' ? [PIECE] : []
          return Promise.resolve({ data, error: null, count: data.length }).then(suite)
        },
      })
      return chaine
    },
    rpc: (nom: string) => {
      faux.rpcs.push(nom)
      const r = nom === 'honoraires_deposes_au_dossier' ? faux.honoraires : { data: [], error: null, count: null }
      return { then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => Promise.resolve({ ...r, status: 200, statusText: '' }).then(suite, echec) }
    },
  },
}))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ dossierActifId: 'dossier-a' }) }))

const texte = () => (document.body.textContent ?? '').replace(/\s+/g, ' ')
const monter = async () => {
  render(<MemoryRouter><ClientUpload /></MemoryRouter>)
  await screen.findByText('Facture F2027-0001.pdf')
}

beforeEach(() => {
  faux.drapeau = true
  faux.rpcs = []
  faux.honoraires = { data: [{ piece_id: 'p1', nature: 'facture', depose_le: '2027-11-03T09:00:00Z' }], error: null, count: 1 }
})

describe('« Mes pièces » et les honoraires déposés', () => {
  it('drapeau levé : la pièce déposée par le cabinet le dit, au tutoiement', async () => {
    await monter()
    await waitFor(() => expect(texte()).toContain('Facture d’honoraires déposée par ton cabinet — en attente de traitement'))
    expect(faux.rpcs.filter((n) => n === 'honoraires_deposes_au_dossier')).toHaveLength(1)
  })

  it('drapeau levé, lecture refusée : rien n’est deviné, une ligne le dit', async () => {
    faux.honoraires = { data: [], error: { message: 'refus fictif' }, count: null }
    await monter()
    await waitFor(() => expect(texte()).toContain('On n’a pas pu lire quelles pièces ton cabinet a déposées pour ses honoraires (refus fictif)'))
    expect(texte()).not.toContain('déposée par ton cabinet —')
    expect(texte()).toContain('Facture — en attente de traitement')
  })

  it('drapeau baissé : rien n’est lu, la pièce reste une facture', async () => {
    faux.drapeau = false
    await monter()
    await waitFor(() => expect(texte()).toContain('Facture — en attente de traitement'))
    expect(faux.rpcs).not.toContain('honoraires_deposes_au_dossier')
    expect(texte()).not.toContain('honoraires')
  })
})
