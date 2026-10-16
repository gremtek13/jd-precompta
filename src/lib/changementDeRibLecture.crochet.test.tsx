import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// LE CROCHET DU DERNIER CHANGEMENT DU RIB (espace client, étape A5b3a). Ce que ces cas gardent : drapeau baissé — la
// migration pas en base —, rien ne se lit et rien ne se dit (`null`), aucun appel ne part ; levé, rien ne se dit avant le
// retour (`en_cours`), la fonction est appelée avec le dossier, une fois, et la lecture est GARDÉE avec le dossier pour
// lequel elle a été faite — un autre dossier repart de « en cours », la réponse tardive d'un dossier quitté ne s'inscrit
// jamais. Ce fichier FORCE le drapeau, lu à chaque accès par un accesseur, pour jouer ses deux états quel que soit celui
// du dépôt.

vi.mock('./changementDeRib', async (importOriginal) => ({
  ...await importOriginal<typeof import('./changementDeRib')>(),
  get CHANGEMENT_DE_RIB_EXPORTE() { return faux.drapeau },
}))

const faux = vi.hoisted(() => ({
  drapeau: true,
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

import { useDernierChangementDeRib } from './changementDeRibLecture'

const AUCUN = { changement: null }
const RETIRE = { changement: { jour: '2026-10-16', geste: 'retire', auteur: 'inconnu', etat: 'retire', rib_en_vigueur: 'retire' } }
const RETIRE_LU = { changement: { jour: '2026-10-16', geste: 'retire', auteur: 'inconnu', etat: 'retire', ribEnVigueur: 'retire' } }

afterEach(() => {
  faux.drapeau = true
  faux.appels = []
  faux.enAttente = []
})

describe('useDernierChangementDeRib, la migration pas en base (drapeau baissé)', () => {
  it('rien ne se lit, rien ne se dit : null, et aucun appel', () => {
    faux.drapeau = false
    const { result } = renderHook(() => useDernierChangementDeRib('d1'))
    expect(result.current).toBeNull()
    expect(faux.appels).toEqual([])
  })
})

describe('useDernierChangementDeRib, la migration en base', () => {
  it('sans dossier : null, et aucun appel', () => {
    const { result } = renderHook(() => useDernierChangementDeRib(null))
    expect(result.current).toBeNull()
    expect(faux.appels).toEqual([])
  })

  it('en cours tant que la base n’a pas répondu ; la fonction est appelée une fois, avec le dossier', async () => {
    const { result } = renderHook(() => useDernierChangementDeRib('d1'))
    expect(result.current).toEqual({ etat: 'en_cours' })
    expect(faux.appels).toEqual([{ nom: 'dernier_changement_de_rib', args: { p_dossier_id: 'd1' } }])
    await act(async () => { faux.enAttente[0]({ data: RETIRE, error: null }) })
    expect(result.current).toEqual({ etat: 'lue', lu: RETIRE_LU })
    expect(faux.appels).toHaveLength(1)
  })

  it('« aucun changement », une valeur illisible, un refus : chacun dit tel', async () => {
    const aucun = renderHook(() => useDernierChangementDeRib('d1'))
    await act(async () => { faux.enAttente[0]({ data: AUCUN, error: null }) })
    expect(aucun.result.current).toEqual({ etat: 'lue', lu: { changement: null } })
    const illisible = renderHook(() => useDernierChangementDeRib('d2'))
    await act(async () => { faux.enAttente[1]({ data: null, error: null }) })
    expect(illisible.result.current).toEqual({ etat: 'illisible' })
    const refusee = renderHook(() => useDernierChangementDeRib('d3'))
    await act(async () => { faux.enAttente[2]({ data: null, error: { message: 'Accès refusé à ce dossier.' } }) })
    expect(refusee.result.current).toEqual({ etat: 'refusee', motif: 'Accès refusé à ce dossier.' })
  })

  it('un autre dossier repart de « en cours » : jamais le changement du précédent', async () => {
    const { result, rerender } = renderHook(({ id }) => useDernierChangementDeRib(id), { initialProps: { id: 'd1' } })
    await act(async () => { faux.enAttente[0]({ data: RETIRE, error: null }) })
    expect(result.current?.etat).toBe('lue')
    rerender({ id: 'd2' })
    expect(result.current).toEqual({ etat: 'en_cours' })
    expect(faux.appels.map((a) => a.args)).toEqual([{ p_dossier_id: 'd1' }, { p_dossier_id: 'd2' }])
    await act(async () => { faux.enAttente[1]({ data: AUCUN, error: null }) })
    expect(result.current).toEqual({ etat: 'lue', lu: { changement: null } })
  })

  it('la réponse tardive d’un dossier quitté ne s’inscrit pas, même arrivée la dernière', async () => {
    const { result, rerender } = renderHook(({ id }) => useDernierChangementDeRib(id), { initialProps: { id: 'd1' } })
    rerender({ id: 'd2' })
    await act(async () => { faux.enAttente[1]({ data: AUCUN, error: null }) })
    expect(result.current).toEqual({ etat: 'lue', lu: { changement: null } })
    // Celle de d1 revient après : elle ne remplace pas ce qui a été lu pour d2.
    await act(async () => { faux.enAttente[0]({ data: RETIRE, error: null }) })
    expect(result.current).toEqual({ etat: 'lue', lu: { changement: null } })
  })

  it('une réponse arrivée après le démontage ne s’inscrit pas', async () => {
    const { result, unmount } = renderHook(() => useDernierChangementDeRib('d1'))
    unmount()
    const journal = vi.spyOn(console, 'error').mockImplementation(() => {})
    await act(async () => { faux.enAttente[0]({ data: RETIRE, error: null }) })
    expect(journal).not.toHaveBeenCalled()
    journal.mockRestore()
    expect(result.current).toEqual({ etat: 'en_cours' })
  })
})
