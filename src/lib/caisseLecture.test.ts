import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CAISSE_EXPORTEE } from './caisse'
import { lireLaCaisse, lireLaCaisseSelon, MOTIF_CAISSE_ABSENTE } from './caisseLecture'
import type { OperationCaisse } from './types'

// LA LECTURE DE LA CAISSE (ligne 26.6, étape C2). Ce que ces cas gardent : drapeau baissé, AUCUN appel au réseau, et une
// lecture incomplète qui le dit ; levé, la table et le filtre de SON dossier, toutes les colonnes, le compte annoncé, un tri
// total terminé par la clé primaire, la lecture jusqu'au bout, `complete` faux dès qu'il en manque ; qu'elle ne REJETTE
// jamais ; et qu'elle se rend avec l'identifiant du dossier lu.

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

function operation(o: Partial<OperationCaisse>): OperationCaisse {
  return {
    id: 'o', dossier_id: 'd1', genre: 'apport', date: '2026-03-01', montant: 100, categorie_id: null, taux_tva: null,
    encaissements_du_jour: null, piece_id: null, origine: 'cabinet', remplace_id: null, cree_le: '2026-03-01T08:00:00Z',
    cree_par: 'u', retire_le: null, retire_par: null, ...o,
  }
}

beforeEach(() => {
  faux.lignes = [
    operation({ id: 'o1' }),
    operation({ id: 'o2', genre: 'recette', montant: 40, categorie_id: 'k', encaissements_du_jour: [], retire_le: '2026-03-03T08:00:00Z' }),
    operation({ id: 'o3', genre: 'recette', montant: 45, categorie_id: 'k', encaissements_du_jour: [], remplace_id: 'o2' }),
    operation({ id: 'x1', dossier_id: 'd2' }),
  ].map((o) => ({ ...o }))
  faux.muetApres = Infinity
  faux.requetes = []
  faux.leve = false
  faux.refus = null
})

describe('lireLaCaisseSelon — la caisse en base', () => {
  it('les opérations de SON dossier, retirées et remplacées comprises, lues en entier, avec l’identifiant du dossier', async () => {
    const lu = await lireLaCaisseSelon('d1', true)
    expect(lu.lignes.map((o) => o.id)).toEqual(['o1', 'o2', 'o3'])
    expect(lu).toMatchObject({ dossierId: 'd1', complete: true, motif: null })
  })

  it('toutes les colonnes, le compte annoncé, le filtre du dossier, un tri total terminé par la clé primaire', async () => {
    await lireLaCaisseSelon('d1', true)
    expect(faux.requetes).toHaveLength(1)
    expect(faux.requetes[0]).toMatchObject({ table: 'operations_caisse', colonnes: '*', options: { count: 'exact' }, filtres: [['dossier_id', 'd1']] })
    expect(faux.requetes[0].ordres.at(-1)).toBe('id')
  })

  it('une lecture interrompue, refusée ou qui lève se dit incomplète, avec son motif — jamais un rejet', async () => {
    faux.muetApres = 2
    expect(await lireLaCaisseSelon('d1', true)).toMatchObject({ complete: false })
    faux.muetApres = Infinity
    faux.refus = 'permission refusée'
    const refusee = await lireLaCaisseSelon('d1', true)
    expect(refusee).toMatchObject({ dossierId: 'd1', complete: false })
    expect(refusee.motif).toContain('permission refusée')
    faux.refus = null
    faux.leve = true
    const levee = await lireLaCaisseSelon('d1', true)
    expect(levee).toMatchObject({ dossierId: 'd1', lignes: [], complete: false })
    expect(levee.motif).toContain('réseau coupé')
  })
})

describe('lireLaCaisseSelon — la caisse pas encore en base', () => {
  it('ne lit rien, ne touche pas au réseau, et le dit : une lecture incomplète, jamais une caisse vide', async () => {
    const lu = await lireLaCaisseSelon('d1', false)
    expect(faux.requetes).toEqual([])
    expect(lu).toEqual({ dossierId: 'd1', lignes: [], complete: false, motif: MOTIF_CAISSE_ABSENTE })
  })

  it('le module chargé normalement suit son drapeau', async () => {
    const lu = await lireLaCaisse('d1')
    expect(lu.complete).toBe(CAISSE_EXPORTEE)
    expect(faux.requetes.length).toBe(CAISSE_EXPORTEE ? 1 : 0)
  })
})
