import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lireLesParametresFacturation } from './parametresFacturationLecture'
import { versionParametres } from '../test/parametresFacturation'

// LA LECTURE DES PARAMÈTRES DE FACTURATION (espace client, étape A5b1). Ce que ces cas gardent : la table et le filtre de SON
// dossier (jamais ceux d'un autre) ; toutes les colonnes, le compte annoncé, un tri total terminé par la clé primaire ; la
// lecture jusqu'au bout, et `complete` faux dès qu'il en manque ; et qu'elle ne REJETTE jamais — une requête qui lève ou
// qu'on refuse tombe du côté signalé, avec son motif, jamais en une liste vide qui se dirait lue. Données FICTIVES.

const faux = vi.hoisted(() => ({
  lignes: [] as Record<string, unknown>[],
  muetApres: Infinity,
  requetes: [] as { table: string; colonnes: string; options: unknown; ordres: string[]; filtres: [string, unknown][] }[],
  leve: false,
  refus: null as string | null,
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
        const repondre = () => {
          if (faux.leve) return Promise.reject(new Error('réseau coupé'))
          if (faux.refus) return Promise.resolve({ data: null, error: { message: faux.refus }, count: null })
          const toutes = filtrer(faux.lignes, predicats)
          return Promise.resolve({ data: toutes.slice(debut, Math.min(fin + 1, toutes.length, faux.muetApres)), error: null, count: toutes.length })
        }
        Object.assign(c, {
          select: (colonnes: string, options: unknown) => { requete.colonnes = colonnes; requete.options = options; return c },
          eq: (colonne: string, valeur: unknown) => { requete.filtres.push([colonne, valeur]); predicats.push(predicatEq(colonne, valeur)); return c },
          order: (colonne: string) => { requete.ordres.push(colonne); return c },
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => repondre().then(suite, echec),
        })
        return c
      },
    },
  }
})

beforeEach(() => {
  faux.lignes = [
    versionParametres({ id: 'v1' }),
    versionParametres({ id: 'v2', remplace_id: 'v1', cree_le: '2027-10-02T09:00:00Z' }),
    versionParametres({ id: 'x1', dossier_id: 'd2' }),
  ].map((v) => ({ ...v }))
  faux.muetApres = Infinity
  faux.requetes = []
  faux.leve = false
  faux.refus = null
})

describe('lireLesParametresFacturation', () => {
  it('les versions de SON dossier, lues en entier', async () => {
    const lu = await lireLesParametresFacturation('d1')
    expect(lu.lignes.map((v) => v.id)).toEqual(['v1', 'v2'])
    expect(lu).toMatchObject({ complete: true, motif: null })
  })

  it('toutes les colonnes, le compte annoncé, le filtre du dossier, un tri total terminé par la clé primaire', async () => {
    await lireLesParametresFacturation('d1')
    expect(faux.requetes).toHaveLength(1)
    expect(faux.requetes[0]).toEqual({
      table: 'parametres_facturation', colonnes: '*', options: { count: 'exact' }, ordres: ['cree_le', 'id'], filtres: [['dossier_id', 'd1']],
    })
  })

  it('un dossier sans aucune version : lu en entier, vide — le vide est une affirmation que seule une lecture complète permet', async () => {
    faux.lignes = []
    expect(await lireLesParametresFacturation('d1')).toEqual({ lignes: [], complete: true, motif: null })
  })

  it('lue en partie : `complete` faux, son motif, et ce qui est revenu', async () => {
    faux.muetApres = 1
    const lu = await lireLesParametresFacturation('d1')
    expect(lu.complete).toBe(false)
    expect(lu.motif).toBe('1 ligne(s) lue(s) sur 2 annoncée(s)')
    expect(lu.lignes).toHaveLength(1)
  })

  it('refusée : `complete` faux avec le motif de la base, jamais une liste vide qui se dirait lue', async () => {
    faux.refus = 'permission denied'
    const lu = await lireLesParametresFacturation('d1')
    expect(lu.complete).toBe(false)
    expect(lu.motif).toContain('permission denied')
  })

  it('une requête qui lève ne rejette pas : elle tombe du côté signalé, avec son motif', async () => {
    faux.leve = true
    expect(await lireLesParametresFacturation('d1')).toEqual({ lignes: [], complete: false, motif: 'réseau coupé' })
  })
})
