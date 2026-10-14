import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listesVides } from '../test/etatFactureElectronique'
import type { ListesDesVentes } from './tuilesVentes'

// LA LECTURE DES VENTES DE L'ACCUEIL DU CLIENT, PARTAGÉE (espace client, étape A6b2) : le crochet que les tuiles et l'encart se
// partagent. Ce que ces cas gardent : `chargement` tant que rien n'est revenu ; les cases relues à la base (sans « Ventes » : rien) ;
// un refus ou une société illisible : un `echec` avec son motif ; et la lecture GARDÉE avec la société pour laquelle elle a été faite
// — une autre société repart de `chargement`, et la réponse tardive d'une société quittée ne s'inscrit jamais. Le composant qui
// l'appelle est clé par la société : sans cette clé, seule cette garde empêche de montrer les comptes de la précédente.

const faux = vi.hoisted(() => ({
  // Une entrée par société lue : chaque lecture reste en attente jusqu'à ce que le cas la rende.
  attentes: [] as { dossierId: string; rendre: () => void }[],
  droits: { cabinet: false, membre: true, ventes: true, banque: false } as unknown,
  refusDroits: null as string | null,
  societe: { data: { statut_tva: 'redevable' }, error: null } as { data: unknown; error: { message: string } | null },
  listes: null as unknown,
}))

vi.mock('./supabase', () => ({
  supabase: {
    rpc: async () => (faux.refusDroits ? { data: null, error: { message: faux.refusDroits } } : { data: faux.droits, error: null }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => faux.societe }) }) }),
  },
}))
vi.mock('./ventesLecture', () => ({
  lireLesVentesDuDossier: (dossierId: string) => new Promise<ListesDesVentes>((resoudre) => {
    faux.attentes.push({ dossierId, rendre: () => resoudre(faux.listes as ListesDesVentes) })
  }),
}))

import { useVentesDuClient } from './ventesDuClientLecture'

afterEach(() => {
  faux.attentes = []
  faux.droits = { cabinet: false, membre: true, ventes: true, banque: false }
  faux.refusDroits = null
  faux.societe = { data: { statut_tva: 'redevable' }, error: null }
  faux.listes = null
})

const rendre = async (rang: number) => { await act(async () => { faux.attentes[rang].rendre() }) }

describe('useVentesDuClient', () => {
  it('chargement tant que rien n’est revenu, puis lu : les listes et le statut de TVA', async () => {
    faux.listes = listesVides()
    const { result } = renderHook(() => useVentesDuClient('d1'))
    expect(result.current).toEqual({ etat: 'chargement' })
    await rendre(0)
    expect(result.current).toEqual({ etat: 'lu', listes: listesVides(), statutTva: 'redevable' })
  })

  it('sans la case « Ventes » relue à la base : sans_ventes', async () => {
    faux.listes = listesVides()
    faux.droits = { cabinet: false, membre: true, ventes: false, banque: true }
    const { result } = renderHook(() => useVentesDuClient('d1'))
    await rendre(0)
    expect(result.current).toEqual({ etat: 'sans_ventes' })
  })

  it('des droits illisibles, une société refusée ou absente : un échec avec son motif, jamais des comptes', async () => {
    faux.listes = listesVides()
    faux.refusDroits = 'panne fictive'
    const droits = renderHook(() => useVentesDuClient('d1'))
    await rendre(0)
    expect(droits.result.current).toEqual({ etat: 'echec', motif: 'tes droits n’ont pas pu être vérifiés (panne fictive)' })
    faux.refusDroits = null
    faux.societe = { data: null, error: { message: 'permission denied' } }
    const refusee = renderHook(() => useVentesDuClient('d1'))
    await rendre(1)
    expect(refusee.result.current).toEqual({ etat: 'echec', motif: 'permission denied' })
    faux.societe = { data: null, error: null }
    const absente = renderHook(() => useVentesDuClient('d1'))
    await rendre(2)
    expect(absente.result.current).toEqual({ etat: 'echec', motif: 'ta société n’a pas été trouvée' })
  })

  it('une autre société repart de « chargement » : jamais les ventes de la précédente', async () => {
    faux.listes = listesVides()
    const { result, rerender } = renderHook(({ id }) => useVentesDuClient(id), { initialProps: { id: 'd1' } })
    await rendre(0)
    expect(result.current.etat).toBe('lu')
    rerender({ id: 'd2' })
    expect(result.current).toEqual({ etat: 'chargement' })
    await rendre(1)
    expect(result.current.etat).toBe('lu')
  })

  it('la réponse tardive d’une société quittée ne s’inscrit pas', async () => {
    const { result, rerender } = renderHook(({ id }) => useVentesDuClient(id), { initialProps: { id: 'd1' } })
    rerender({ id: 'd2' })
    // Celle de d2 revient la première, avec d'autres cases ; celle de d1 revient après, sans « Ventes ».
    faux.listes = listesVides()
    await rendre(1)
    expect(result.current.etat).toBe('lu')
    faux.droits = { cabinet: false, membre: true, ventes: false, banque: false }
    await rendre(0)
    expect(result.current.etat).toBe('lu')
  })

  it('une réponse arrivée après le démontage ne s’inscrit pas', async () => {
    faux.listes = listesVides()
    const { result, unmount } = renderHook(() => useVentesDuClient('d1'))
    unmount()
    await rendre(0)
    expect(result.current).toEqual({ etat: 'chargement' })
  })
})
