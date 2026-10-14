import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lireLesArticles } from './articlesLecture'
import { article } from '../test/articles'

// LA LECTURE DES ARTICLES (espace client, étape A2a). Ce que ces cas gardent : la table et le filtre de SON dossier (jamais
// ceux d'un autre) ; toutes les colonnes, retirés compris ; un tri total terminé par la clé primaire ; le compte annoncé, donc
// la lecture jusqu'au bout et `complete` faux dès qu'il en manque ; une requête qui lève rejette (jamais une liste vide).

const faux = vi.hoisted(() => ({
  lignes: [] as Record<string, unknown>[],
  muetApres: Infinity,
  requetes: [] as { table: string; colonnes: string; options: unknown; ordres: string[]; filtres: [string, unknown][] }[],
  leve: false,
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        const requete = { table, colonnes: '', options: undefined as unknown, ordres: [] as string[], filtres: [] as [string, unknown][] }
        faux.requetes.push(requete)
        const predicats: ((l: Record<string, unknown>) => boolean)[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: (colonnes: string, options: unknown) => { requete.colonnes = colonnes; requete.options = options; return c },
          eq: (colonne: string, valeur: unknown) => { requete.filtres.push([colonne, valeur]); predicats.push(predicatEq(colonne, valeur)); return c },
          order: (colonne: string) => { requete.ordres.push(colonne); return c },
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
            if (faux.leve) return Promise.reject(new Error('réseau coupé')).then(suite, echec)
            const toutes = filtrer(faux.lignes, predicats)
            const rendu = toutes.slice(debut, Math.min(fin + 1, toutes.length, faux.muetApres))
            return Promise.resolve({ data: rendu, error: null, count: toutes.length }).then(suite, echec)
          },
        })
        return c
      },
    },
  }
})

beforeEach(() => {
  faux.lignes = [article({ id: 'a1' }), article({ id: 'a2', retire_le: '2027-10-05T08:00:00Z', retire_par: 'u-x' }), article({ id: 'a3', dossier_id: 'd2' })]
    .map((a) => ({ ...a }))
  faux.muetApres = Infinity
  faux.requetes = []
  faux.leve = false
})

describe('lireLesArticles', () => {
  it('les articles de SON dossier, retirés compris, lus en entier', async () => {
    const lu = await lireLesArticles('d1')
    expect(lu.lignes.map((a) => a.id)).toEqual(['a1', 'a2'])
    expect(lu).toMatchObject({ complete: true, motif: null })
  })

  it('toutes les colonnes, le compte annoncé, le filtre du dossier, un tri terminé par la clé primaire', async () => {
    await lireLesArticles('d1')
    const [r] = faux.requetes
    expect(r.table).toBe('articles')
    expect(r.colonnes).toBe('*')
    expect(r.options).toEqual({ count: 'exact' })
    expect(r.filtres).toEqual([['dossier_id', 'd1']])
    expect(r.ordres.at(-1)).toBe('id')
    expect(r.ordres.length).toBeGreaterThan(1)
  })

  it('un dossier sans article : lu en entier, vide — le vide est une affirmation que seule une lecture complète permet', async () => {
    const lu = await lireLesArticles('d3')
    expect(lu).toEqual({ lignes: [], complete: true, motif: null })
  })

  it('lue en partie : `complete` faux, son motif, et ce qui est revenu', async () => {
    faux.muetApres = 1
    const lu = await lireLesArticles('d1')
    expect(lu.complete).toBe(false)
    expect(lu.motif).toBe('1 ligne(s) lue(s) sur 2 annoncée(s)')
    expect(lu.lignes).toHaveLength(1)
  })

  it('une requête qui lève rejette : jamais une liste vide', async () => {
    faux.leve = true
    await expect(lireLesArticles('d1')).rejects.toThrow('réseau coupé')
  })
})
