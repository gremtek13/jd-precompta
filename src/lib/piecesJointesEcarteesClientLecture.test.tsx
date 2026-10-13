import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEcarteesDuClient } from './piecesJointesEcarteesClientLecture'

// LA LECTURE DES PIÈCES JOINTES ÉCARTÉES, PARTAGÉE PAR « MES PIÈCES » ET L'ACCUEIL (ligne 22.94). Les deux écrans éprouvent
// ce qu'ils en font (ClientUpload.ecartees.test.tsx, ClientHome.ecartees.test.tsx) ; ce fichier garde le crochet seul : il
// lit UNE fois par société, rien avant le retour, la lecture d'une société ne se montre jamais sous une autre, une réponse
// tardive n'écrase pas celle de la société affichée, un refus ou une requête qui lève se SIGNALENT (jamais une liste vide),
// et drapeau baissé ou sans société, il n'appelle rien. Données FICTIVES.

const faux = vi.hoisted(() => ({
  drapeau: true,
  rpcs: [] as { nom: string; args: unknown }[],
  reponses: {} as Record<string, { data: unknown; error: { message: string } | null } | 'leve'>,
  portes: {} as Record<string, Promise<void>>,
}))

vi.mock('./piecesJointesEcarteesClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('./piecesJointesEcarteesClient')>(),
  get ECARTEES_DU_CLIENT_EXPORTEES() { return faux.drapeau },
}))

vi.mock('./supabase', () => ({
  supabase: {
    rpc: (nom: string, args: { p_dossier_id: string }) => {
      faux.rpcs.push({ nom, args })
      const reponse = async () => {
        await faux.portes[args.p_dossier_id]
        const r = faux.reponses[args.p_dossier_id] ?? { data: [], error: null }
        if (r === 'leve') throw new Error('réseau coupé')
        return { ...r, count: null, status: r.error ? 400 : 200, statusText: '' }
      }
      return { then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => reponse().then(suite, echec) }
    },
  },
}))

const UNE = [{ jour: '2026-10-12', raison: 'format', octets: 4120 }]

function retenir(dossier: string): () => void {
  let ouvrir = () => {}
  faux.portes[dossier] = new Promise<void>((resolve) => { ouvrir = resolve })
  return ouvrir
}

beforeEach(() => {
  faux.drapeau = true
  faux.rpcs = []
  faux.reponses = {}
  faux.portes = {}
})

describe('useEcarteesDuClient', () => {
  it('lit la fonction UNE fois, pour la société affichée ; nulle avant le retour, puis la lecture entière', async () => {
    faux.reponses['a'] = { data: UNE, error: null }
    const ouvrir = retenir('a')
    const { result, rerender } = renderHook(({ id }) => useEcarteesDuClient(id), { initialProps: { id: 'a' as string | null } })
    expect(faux.rpcs).toEqual([{ nom: 'pieces_jointes_ecartees_du_client', args: { p_dossier_id: 'a' } }])
    expect(result.current).toBeNull()
    await act(async () => { ouvrir() })
    await waitFor(() => expect(result.current).not.toBeNull())
    expect(result.current).toEqual({ lignes: UNE, complete: true, motif: null })
    // Un nouveau rendu ne relit pas : aucun dépôt ne change cette liste.
    rerender({ id: 'a' })
    expect(faux.rpcs).toHaveLength(1)
  })

  it('une liste vide lue en entier est une lecture COMPLÈTE sans ligne — distincte de « pas revenue »', async () => {
    const { result } = renderHook(() => useEcarteesDuClient('a'))
    await waitFor(() => expect(result.current).toEqual({ lignes: [], complete: true, motif: null }))
  })

  it('un refus, une réponse illisible ou une requête qui lève se signalent : incomplète, avec son motif, sans ligne', async () => {
    faux.reponses['refus'] = { data: null, error: { message: 'Accès refusé à ce dossier.' } }
    faux.reponses['illisible'] = { data: { jour: '2026-10-12' }, error: null }
    faux.reponses['leve'] = 'leve'
    const refus = renderHook(() => useEcarteesDuClient('refus'))
    const illisible = renderHook(() => useEcarteesDuClient('illisible'))
    const leve = renderHook(() => useEcarteesDuClient('leve'))
    await waitFor(() => expect(refus.result.current).not.toBeNull())
    await waitFor(() => expect(illisible.result.current).not.toBeNull())
    await waitFor(() => expect(leve.result.current).not.toBeNull())
    expect(refus.result.current).toEqual({ lignes: [], complete: false, motif: 'lecture refusée : Accès refusé à ce dossier.' })
    expect(illisible.result.current).toEqual({ lignes: [], complete: false, motif: 'réponse illisible' })
    expect(leve.result.current).toEqual({ lignes: [], complete: false, motif: 'lecture impossible : réseau coupé' })
  })

  it('la lecture d’une société ne se montre jamais sous une autre : changée, elle repart de « pas revenue »', async () => {
    faux.reponses['a'] = { data: UNE, error: null }
    faux.reponses['b'] = { data: [{ jour: '2026-10-01', raison: 'vide', octets: 0 }], error: null }
    const ouvrirB = retenir('b')
    const { result, rerender } = renderHook(({ id }) => useEcarteesDuClient(id), { initialProps: { id: 'a' as string | null } })
    await waitFor(() => expect(result.current?.lignes).toEqual(UNE))
    rerender({ id: 'b' })
    expect(result.current).toBeNull()
    expect(faux.rpcs.map((r) => (r.args as { p_dossier_id: string }).p_dossier_id)).toEqual(['a', 'b'])
    await act(async () => { ouvrirB() })
    await waitFor(() => expect(result.current?.lignes).toEqual([{ jour: '2026-10-01', raison: 'vide', octets: 0 }]))
  })

  it('une réponse TARDIVE de la société quittée n’écrase pas celle de la société affichée', async () => {
    faux.reponses['a'] = { data: UNE, error: null }
    faux.reponses['b'] = { data: [{ jour: '2026-10-01', raison: 'vide', octets: 0 }], error: null }
    const ouvrirA = retenir('a')
    const { result, rerender } = renderHook(({ id }) => useEcarteesDuClient(id), { initialProps: { id: 'a' as string | null } })
    rerender({ id: 'b' })
    await waitFor(() => expect(result.current?.lignes).toEqual([{ jour: '2026-10-01', raison: 'vide', octets: 0 }]))
    await act(async () => { ouvrirA() })
    await act(async () => { await Promise.resolve() })
    expect(result.current?.lignes).toEqual([{ jour: '2026-10-01', raison: 'vide', octets: 0 }])
  })

  it('drapeau baissé : aucun appel, toujours nulle', async () => {
    faux.drapeau = false
    faux.reponses['a'] = { data: UNE, error: null }
    const { result } = renderHook(() => useEcarteesDuClient('a'))
    await act(async () => { await Promise.resolve() })
    expect(faux.rpcs).toEqual([])
    expect(result.current).toBeNull()
  })

  it('sans société : aucun appel, nulle', async () => {
    const { result } = renderHook(() => useEcarteesDuClient(null))
    await act(async () => { await Promise.resolve() })
    expect(faux.rpcs).toEqual([])
    expect(result.current).toBeNull()
  })
})
