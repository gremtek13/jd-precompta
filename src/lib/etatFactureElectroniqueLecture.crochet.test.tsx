import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ETAT_FICTIF, ETAT_NEUF } from '../test/etatFactureElectronique'

// LE CROCHET DE L'ÉTAT DE LA FACTURE ÉLECTRONIQUE (espace client, étape A6b2). Ce que ces cas gardent : rien ne se dit avant le
// retour (`en_cours`) ; la fonction est appelée avec le dossier, une fois ; la lecture est GARDÉE avec le dossier pour lequel elle
// a été faite — un autre dossier repart de « en cours », et la réponse tardive d'un dossier quitté ne s'inscrit jamais.

const faux = vi.hoisted(() => ({
  appels: [] as { nom: string; args: unknown }[],
  // Les réponses en attente, à rendre une à une, dans l'ordre des appels.
  enAttente: [] as ((reponse: { data: unknown; error: unknown }) => void)[],
}))

vi.mock('./supabase', () => ({
  supabase: {
    rpc: (nom: string, args: unknown) => {
      faux.appels.push({ nom, args })
      return new Promise((resoudre) => { faux.enAttente.push(resoudre) })
    },
  },
}))

import { useEtatFactureElectronique } from './etatFactureElectroniqueLecture'

afterEach(() => {
  faux.appels = []
  faux.enAttente = []
})

describe('useEtatFactureElectronique', () => {
  it('en cours tant que la base n’a pas répondu ; la fonction est appelée une fois, avec le dossier', async () => {
    const { result } = renderHook(() => useEtatFactureElectronique('d1'))
    expect(result.current).toEqual({ etat: 'en_cours' })
    expect(faux.appels).toEqual([{ nom: 'etat_facture_electronique', args: { p_dossier_id: 'd1' } }])
    await act(async () => { faux.enAttente[0]({ data: ETAT_FICTIF, error: null }) })
    expect(result.current).toEqual({ etat: 'lue', lu: ETAT_FICTIF })
    expect(faux.appels).toHaveLength(1)
  })

  it('une valeur illisible, un refus : dits, jamais « lue »', async () => {
    const illisible = renderHook(() => useEtatFactureElectronique('d1'))
    await act(async () => { faux.enAttente[0]({ data: { plateforme: 'x' }, error: null }) })
    expect(illisible.result.current).toEqual({ etat: 'illisible' })
    const refusee = renderHook(() => useEtatFactureElectronique('d2'))
    await act(async () => { faux.enAttente[1]({ data: null, error: { message: 'permission denied' } }) })
    expect(refusee.result.current).toEqual({ etat: 'refusee', motif: 'permission denied' })
  })

  it('un autre dossier repart de « en cours » : jamais l’état du précédent', async () => {
    const { result, rerender } = renderHook(({ id }) => useEtatFactureElectronique(id), { initialProps: { id: 'd1' } })
    await act(async () => { faux.enAttente[0]({ data: ETAT_FICTIF, error: null }) })
    expect(result.current.etat).toBe('lue')
    rerender({ id: 'd2' })
    expect(result.current).toEqual({ etat: 'en_cours' })
    expect(faux.appels.map((a) => a.args)).toEqual([{ p_dossier_id: 'd1' }, { p_dossier_id: 'd2' }])
    await act(async () => { faux.enAttente[1]({ data: ETAT_NEUF, error: null }) })
    expect(result.current).toEqual({ etat: 'lue', lu: ETAT_NEUF })
  })

  it('la réponse tardive d’un dossier quitté ne s’inscrit pas, même arrivée la dernière', async () => {
    const { result, rerender } = renderHook(({ id }) => useEtatFactureElectronique(id), { initialProps: { id: 'd1' } })
    rerender({ id: 'd2' })
    await act(async () => { faux.enAttente[1]({ data: ETAT_NEUF, error: null }) })
    expect(result.current).toEqual({ etat: 'lue', lu: ETAT_NEUF })
    // Celle de d1 revient après : elle ne remplace pas l'état de d2.
    await act(async () => { faux.enAttente[0]({ data: ETAT_FICTIF, error: null }) })
    expect(result.current).toEqual({ etat: 'lue', lu: ETAT_NEUF })
  })

  it('une réponse arrivée après le démontage ne s’inscrit pas', async () => {
    const { result, unmount } = renderHook(() => useEtatFactureElectronique('d1'))
    unmount()
    const journal = vi.spyOn(console, 'error').mockImplementation(() => {})
    await act(async () => { faux.enAttente[0]({ data: ETAT_FICTIF, error: null }) })
    expect(journal).not.toHaveBeenCalled()
    journal.mockRestore()
    expect(result.current).toEqual({ etat: 'en_cours' })
  })
})
