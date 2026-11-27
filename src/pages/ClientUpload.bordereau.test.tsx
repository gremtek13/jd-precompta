import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ClientUpload from './ClientUpload'
import { LIGNE_DU_BORDEREAU_DANS_MES_PIECES } from '../lib/consigneDuBordereau'

// « MES PIÈCES » ET LA CONSIGNE DU BORDEREAU (BOR6TQ1-Q1 (A)) : ce que la page fait des trois lectures de la société affichée —
// la ligne sous la zone de dépôt sur un dossier de santé (code NAF, ou un import déjà lu), rien ailleurs, rien tant que la
// réponse n'est pas revenue, et une réponse arrivée pour une autre société ne s'affiche pas. Les trois lectures sont simulées
// (leur propre module se garde à part) ; le reste de la page lit un faux client aux listes vides. Données FICTIVES.

const faux = vi.hoisted(() => ({
  dossier: 'dossier-a',
  codes: {} as Record<string, string | null | undefined>,
  paiements: {} as Record<string, boolean>,
  facture: {} as Record<string, boolean>,
  portes: {} as Record<string, Promise<void>>,
  lus: [] as string[],
}))

vi.mock('../lib/codeNafDuDossierLecture', () => ({
  lireLeCodeNafDuDossier: async (dossierId: string) => {
    faux.lus.push(dossierId)
    await faux.portes[dossierId]
    return faux.codes[dossierId]
  },
}))
vi.mock('../lib/paiementsAssuranceMaladieLecture', () => ({
  unImportDesPaiementsLu: async (dossierId: string) => faux.paiements[dossierId] === true,
}))
vi.mock('../lib/factureAssuranceMaladieLecture', () => ({
  unImportDuFactureLu: async (dossierId: string) => faux.facture[dossierId] === true,
}))
vi.mock('../lib/depot', () => ({ deposerFichier: vi.fn() }))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => {
      const chaine: Record<string, unknown> = {}
      Object.assign(chaine, {
        select: () => chaine, eq: () => chaine, order: () => chaine, range: () => chaine,
        maybeSingle: () => Promise.resolve({ data: { code_email: null }, error: null }),
        then: (suite: (r: { data: unknown[]; error: null; count: number }) => unknown) =>
          Promise.resolve({ data: [], error: null, count: 0 }).then(suite),
      })
      return chaine
    },
    rpc: () => ({
      then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null, count: null, status: 200, statusText: '' }).then(suite, echec),
    }),
  },
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ dossierActifId: faux.dossier }),
}))

const ligne = () => screen.queryByTestId('consigne-du-bordereau')

function retenir(dossier: string): () => void {
  let ouvrir = () => {}
  faux.portes[dossier] = new Promise<void>((resolve) => { ouvrir = resolve })
  return ouvrir
}

async function monter() {
  // La coque remonte l'écran à chaque changement de société (`<Outlet key>`) : la clé le rejoue.
  const rendu = render(<MemoryRouter><ClientUpload key={faux.dossier} /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Mes dépôts' })
  return rendu
}

beforeEach(() => {
  Object.assign(faux, { dossier: 'dossier-a', codes: {}, paiements: {}, facture: {}, portes: {}, lus: [] })
})

describe('ClientUpload — la consigne du bordereau, sur les seuls dossiers de santé', () => {
  it('un code NAF de santé : la ligne, aux mots du client, après la lecture et pas avant', async () => {
    faux.codes['dossier-a'] = '86.90E'
    const ouvrir = retenir('dossier-a')
    await monter()
    expect(faux.lus).toEqual(['dossier-a'])
    expect(ligne()).toBeNull()
    await act(async () => { ouvrir() })
    await waitFor(() => expect(ligne()?.textContent).toBe(LIGNE_DU_BORDEREAU_DANS_MES_PIECES))
  })

  it('hors de la santé, sans import lu : rien', async () => {
    faux.codes['dossier-a'] = '62.01Z'
    await monter()
    await waitFor(() => expect(faux.lus).toEqual(['dossier-a']))
    await act(async () => { await Promise.resolve() })
    expect(ligne()).toBeNull()
  })

  it('hors de la santé, un import du facturé déjà en base : la ligne', async () => {
    faux.codes['dossier-a'] = null
    faux.facture['dossier-a'] = true
    await monter()
    await waitFor(() => expect(ligne()?.textContent).toBe(LIGNE_DU_BORDEREAU_DANS_MES_PIECES))
  })

  it('un code non lu (la lecture refusée) : rien', async () => {
    faux.codes['dossier-a'] = undefined
    await monter()
    await act(async () => { await Promise.resolve() })
    expect(ligne()).toBeNull()
  })

  it('relue pour la société affichée : la réponse d’une autre, arrivée après coup, ne s’affiche pas', async () => {
    faux.codes['dossier-a'] = '86.21Z'
    faux.codes['dossier-b'] = '62.01Z'
    const ouvrirA = retenir('dossier-a')
    const rendu = await monter()
    faux.dossier = 'dossier-b'
    rendu.rerender(<MemoryRouter><ClientUpload key={faux.dossier} /></MemoryRouter>)
    await waitFor(() => expect(faux.lus).toEqual(['dossier-a', 'dossier-b']))
    await act(async () => { ouvrirA() })
    await act(async () => { await Promise.resolve() })
    expect(ligne()).toBeNull()
  })
})
