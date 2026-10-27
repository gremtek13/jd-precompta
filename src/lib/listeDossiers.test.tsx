import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useListeDossiers } from './listeDossiers'

// LA LISTE DES DOSSIERS DE LA BARRE LATÉRALE, LUE POUR UN COMPTE (23Q2Q2Q1-Q1). Elle ne garde que les dossiers que le cabinet
// ouvre au compte (lib/dossiersOuverts.ts, dont la règle a ses propres tests) ; ce fichier garde ce que la coque ne montre pas :
// la liste se garde AVEC le compte pour lequel elle a été lue — un autre compte repart en chargement —, une lecture plus lente
// écrit en dernier, et sans compte rien ne se lit. Les accès client d'un compte se retiennent à la demande : c'est ce qui
// décide quelle réponse arrive la première. Données FICTIVES.
const faux = vi.hoisted(() => ({
  dossiers: [] as { id: string; nom: string; archive: boolean }[],
  acces: [] as { id: string; user_id: string; dossier_id: string }[],
  ouvertures: {} as Record<string, boolean>,
  // Les comptes dont la lecture des accès attend que le test la relâche, et ces lectures, dans l'ordre des demandes.
  retenus: new Set<string>(),
  enAttente: [] as (() => void)[],
  tables: [] as string[],
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        faux.tables.push(table)
        const predicats: ReturnType<typeof predicatEq>[] = []
        let compte: string | null = null
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: () => c,
          eq: (colonne: string, valeur: unknown) => {
            if (colonne === 'user_id') compte = valeur as string
            predicats.push(predicatEq(colonne, valeur))
            return c
          },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          then: (suite: (r: unknown) => unknown) => {
            // Composée quand la requête PART : la table telle qu'elle est à cet instant.
            const lignes = filtrer<Record<string, unknown>>(table === 'memberships' ? faux.acces : faux.dossiers, predicats)
            const reponse = { data: lignes.slice(debut, fin + 1), error: null, count: lignes.length }
            if (table === 'memberships' && compte !== null && faux.retenus.has(compte)) {
              return new Promise((relacher) => { faux.enAttente.push(() => relacher(reponse)) }).then(suite)
            }
            return Promise.resolve(reponse).then(suite)
          },
        })
        return c
      },
      rpc: (nom: string, args: { p_dossier_id: string }) => {
        if (nom !== 'admin_du_dossier') throw new Error(`Faux client : la fonction ${nom} n’est pas attendue.`)
        return Promise.resolve({ data: faux.ouvertures[args.p_dossier_id] ?? null, error: null })
      },
    },
  }
})

beforeEach(() => {
  faux.dossiers = [{ id: 'd1', nom: 'Alpha', archive: false }, { id: 'd2', nom: 'Bravo', archive: false }]
  // Le compte A est client de Bravo, que le cabinet ne lui ouvre pas ; le compte B n'est client de rien.
  faux.acces = [{ id: 'm1', user_id: 'u-a', dossier_id: 'd2' }]
  faux.ouvertures = { d2: false }
  faux.retenus = new Set()
  faux.enAttente = []
  faux.tables = []
})

const noms = (r: { dossiers: { nom: string }[] }) => r.dossiers.map((d) => d.nom)
// Une requête n'est attendue — donc retenue — qu'au tour suivant : `await` appelle son `then` dans une micro-tâche.
const laisserPasser = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

describe('useListeDossiers — la liste se garde avec le compte lu', () => {
  it('un autre compte repart en chargement, jamais sur la liste du précédent', async () => {
    const { result, rerender } = renderHook(({ compte }) => useListeDossiers(compte, 0), { initialProps: { compte: 'u-a' as string | null } })
    await waitFor(() => expect(result.current.chargement).toBe(false))
    expect(noms(result.current)).toEqual(['Alpha'])

    faux.retenus.add('u-b')
    rerender({ compte: 'u-b' })
    await laisserPasser()
    expect(faux.enAttente).toHaveLength(1)
    expect(result.current).toEqual({ dossiers: [], motif: null, chargement: true })

    await act(async () => { for (const relacher of faux.enAttente.splice(0)) relacher() })
    await waitFor(() => expect(result.current.chargement).toBe(false))
    expect(noms(result.current)).toEqual(['Alpha', 'Bravo'])
  })

  it('une lecture plus lente écrit en dernier : la relecture revenue la première n’est pas remplacée', async () => {
    faux.retenus.add('u-a')
    faux.dossiers = [{ id: 'd1', nom: 'Alpha', archive: false }]
    const { result, rerender } = renderHook(({ relecture }) => useListeDossiers('u-a', relecture), { initialProps: { relecture: 0 } })
    await laisserPasser()
    faux.dossiers = [{ id: 'd1', nom: 'Alpha', archive: false }, { id: 'd3', nom: 'Charlie', archive: false }]
    rerender({ relecture: 1 })
    await laisserPasser()
    expect(faux.enAttente).toHaveLength(2)
    const [premiere, seconde] = faux.enAttente.splice(0)

    await act(async () => { seconde() })
    await waitFor(() => expect(result.current.chargement).toBe(false))
    expect(noms(result.current)).toEqual(['Alpha', 'Charlie'])

    await act(async () => { premiere() })
    await laisserPasser()
    expect(noms(result.current)).toEqual(['Alpha', 'Charlie'])
  })

  it('sans compte, rien ne se lit et la liste reste en chargement', async () => {
    const { result } = renderHook(() => useListeDossiers(null, 0))
    await laisserPasser()
    expect(faux.tables).toEqual([])
    expect(result.current).toEqual({ dossiers: [], motif: null, chargement: true })
  })
})
