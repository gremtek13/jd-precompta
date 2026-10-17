import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// LE CROCHET DES DOSSIERS DONT UN RIB PROPOSÉ ATTEND LE CABINET (espace client, étape A5b3c). Ce que ces cas gardent :
// drapeau baissé — la migration pas en base —, rien ne se lit et rien ne se dit (`null`), aucun appel ne part ; sans clé,
// de même ; levé, rien ne se dit avant le retour (`en_cours`), la fonction est appelée une fois, sans argument, et la
// lecture est GARDÉE avec la clé pour laquelle elle a été faite — une autre clé repart de « en cours » et relit, la réponse
// tardive d'une clé quittée ne s'inscrit jamais. Ce fichier FORCE le drapeau, lu à chaque accès par un accesseur, pour jouer
// ses deux états quel que soit celui du dépôt.

vi.mock('./dossiersAuRibAConfirmer', async (importOriginal) => ({
  ...await importOriginal<typeof import('./dossiersAuRibAConfirmer')>(),
  get DOSSIERS_AU_RIB_A_CONFIRMER_EXPORTE() { return faux.drapeau },
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

import { useDossiersAuRibAConfirmer } from './dossiersAuRibAConfirmerLecture'

const AUCUN = { dossiers: [] }
const UN = {
  dossiers: [{ dossier_id: 'a5b3c000-0000-4000-8000-0000000000d8', nom: 'Dossier fictif', archive: true,
    changement: { etat: 'propose', jour: '2026-09-01', geste: 'pose', auteur: 'client', rib_en_vigueur: 'aucun' } }],
}
const UN_LU = {
  dossiers: [{ dossierId: 'a5b3c000-0000-4000-8000-0000000000d8', nom: 'Dossier fictif', archive: true,
    changement: { jour: '2026-09-01', geste: 'pose', auteur: 'client', etat: 'propose', ribEnVigueur: 'aucun' } }],
}

afterEach(() => {
  faux.drapeau = true
  faux.appels = []
  faux.enAttente = []
})

describe('useDossiersAuRibAConfirmer, la migration pas en base (drapeau baissé)', () => {
  it('rien ne se lit, rien ne se dit : null, et aucun appel', () => {
    faux.drapeau = false
    const { result } = renderHook(() => useDossiersAuRibAConfirmer('cabinet'))
    expect(result.current).toBeNull()
    expect(faux.appels).toEqual([])
  })
})

describe('useDossiersAuRibAConfirmer, la migration en base', () => {
  it('sans clé : null, et aucun appel — l’écran n’en donne qu’au cabinet', () => {
    const { result } = renderHook(() => useDossiersAuRibAConfirmer(null))
    expect(result.current).toBeNull()
    expect(faux.appels).toEqual([])
  })

  it('en cours tant que la base n’a pas répondu ; la fonction est appelée une fois, sans argument', async () => {
    const { result } = renderHook(() => useDossiersAuRibAConfirmer('cabinet'))
    expect(result.current).toEqual({ etat: 'en_cours' })
    expect(faux.appels).toEqual([{ nom: 'dossiers_au_rib_a_confirmer', args: undefined }])
    await act(async () => { faux.enAttente[0]({ data: UN, error: null }) })
    expect(result.current).toEqual({ etat: 'lue', lu: UN_LU })
    expect(faux.appels).toHaveLength(1)
  })

  it('« aucun dossier », une valeur illisible, un refus : chacun dit tel', async () => {
    const aucun = renderHook(() => useDossiersAuRibAConfirmer(1))
    await act(async () => { faux.enAttente[0]({ data: AUCUN, error: null }) })
    expect(aucun.result.current).toEqual({ etat: 'lue', lu: { dossiers: [] } })
    const illisible = renderHook(() => useDossiersAuRibAConfirmer(2))
    await act(async () => { faux.enAttente[1]({ data: null, error: null }) })
    expect(illisible.result.current).toEqual({ etat: 'illisible' })
    const refusee = renderHook(() => useDossiersAuRibAConfirmer(3))
    await act(async () => { faux.enAttente[2]({ data: null, error: { message: 'Seul le cabinet lit les RIB à confirmer.' } }) })
    expect(refusee.result.current).toEqual({ etat: 'refusee', motif: 'Seul le cabinet lit les RIB à confirmer.' })
  })

  it('une autre clé repart de « en cours » et relit : jamais la liste de la précédente', async () => {
    const { result, rerender } = renderHook(({ cle }) => useDossiersAuRibAConfirmer(cle), { initialProps: { cle: 1 } })
    await act(async () => { faux.enAttente[0]({ data: UN, error: null }) })
    expect(result.current?.etat).toBe('lue')
    rerender({ cle: 2 })
    expect(result.current).toEqual({ etat: 'en_cours' })
    expect(faux.appels).toHaveLength(2)
    await act(async () => { faux.enAttente[1]({ data: AUCUN, error: null }) })
    expect(result.current).toEqual({ etat: 'lue', lu: { dossiers: [] } })
  })

  it('la réponse tardive d’une clé quittée ne s’inscrit pas, même arrivée la dernière', async () => {
    const { result, rerender } = renderHook(({ cle }) => useDossiersAuRibAConfirmer(cle), { initialProps: { cle: 1 } })
    rerender({ cle: 2 })
    await act(async () => { faux.enAttente[1]({ data: AUCUN, error: null }) })
    expect(result.current).toEqual({ etat: 'lue', lu: { dossiers: [] } })
    // Celle de la clé 1 revient après : elle ne remplace pas ce qui a été lu pour la clé 2.
    await act(async () => { faux.enAttente[0]({ data: UN, error: null }) })
    expect(result.current).toEqual({ etat: 'lue', lu: { dossiers: [] } })
  })

  it('une réponse arrivée après le démontage ne s’inscrit pas', async () => {
    const { result, unmount } = renderHook(() => useDossiersAuRibAConfirmer('cabinet'))
    unmount()
    const journal = vi.spyOn(console, 'error').mockImplementation(() => {})
    await act(async () => { faux.enAttente[0]({ data: UN, error: null }) })
    expect(journal).not.toHaveBeenCalled()
    journal.mockRestore()
    expect(result.current).toEqual({ etat: 'en_cours' })
  })
})
