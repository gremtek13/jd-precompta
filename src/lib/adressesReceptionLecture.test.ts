import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lireLesAdressesDuDossier } from './adressesReceptionLecture'
import { adresse, SIRET_FICTIF } from '../test/adressesReception'

// LA LECTURE DE L'ADRESSE DE RÉCEPTION (espace client, étape A6b1). Ce que ces cas gardent : la table et le filtre de SON
// dossier (jamais ceux d'un autre) ; toutes les colonnes, le compte annoncé, un tri total terminé par la clé primaire ; la
// lecture jusqu'au bout, et `complete` faux dès qu'il en manque ; le SIRET du dossier lu à part, avec son propre état ; et
// qu'aucune des deux lectures ne REJETTE — une requête qui lève ou qu'on refuse tombe du côté signalé, avec son motif, jamais
// en une liste vide.

const faux = vi.hoisted(() => ({
  lignes: [] as Record<string, unknown>[],
  dossiers: [] as Record<string, unknown>[],
  muetApres: Infinity,
  requetes: [] as { table: string; colonnes: string; options: unknown; ordres: string[]; filtres: [string, unknown][]; unique: boolean }[],
  leve: {} as Record<string, boolean>,
  refus: {} as Record<string, string>,
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        const requete = { table, colonnes: '', options: undefined as unknown, ordres: [] as string[], filtres: [] as [string, unknown][], unique: false }
        faux.requetes.push(requete)
        const predicats: ((l: Record<string, unknown>) => boolean)[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const source = () => (table === 'dossiers' ? faux.dossiers : faux.lignes)
        const c: Record<string, unknown> = {}
        const repondre = () => {
          if (faux.leve[table]) return Promise.reject(new Error('réseau coupé'))
          if (faux.refus[table]) return Promise.resolve({ data: null, error: { message: faux.refus[table] }, count: null })
          const toutes = filtrer(source(), predicats)
          if (requete.unique) return Promise.resolve({ data: toutes[0] ?? null, error: null })
          const rendu = toutes.slice(debut, Math.min(fin + 1, toutes.length, faux.muetApres))
          return Promise.resolve({ data: rendu, error: null, count: toutes.length })
        }
        Object.assign(c, {
          select: (colonnes: string, options: unknown) => { requete.colonnes = colonnes; requete.options = options; return c },
          eq: (colonne: string, valeur: unknown) => { requete.filtres.push([colonne, valeur]); predicats.push(predicatEq(colonne, valeur)); return c },
          order: (colonne: string) => { requete.ordres.push(colonne); return c },
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          maybeSingle: () => { requete.unique = true; return repondre() },
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => repondre().then(suite, echec),
        })
        return c
      },
    },
  }
})

beforeEach(() => {
  faux.lignes = [
    adresse({ id: 'a1' }),
    adresse({ id: 'a2', remplace_id: 'a1', cree_le: '2026-10-15T08:00:00Z' }),
    adresse({ id: 'x1', dossier_id: 'd2' }),
  ].map((a) => ({ ...a }))
  faux.dossiers = [{ id: 'd1', siret: SIRET_FICTIF }, { id: 'd2', siret: null }]
  faux.muetApres = Infinity
  faux.requetes = []
  faux.leve = {}
  faux.refus = {}
})

describe('lireLesAdressesDuDossier', () => {
  it('les adresses de SON dossier, lues en entier, et son SIRET', async () => {
    const lu = await lireLesAdressesDuDossier('d1')
    expect(lu.adresses.lignes.map((a) => a.id)).toEqual(['a1', 'a2'])
    expect(lu.adresses).toMatchObject({ complete: true, motif: null })
    expect(lu.siret).toEqual({ lu: true, siret: SIRET_FICTIF })
  })

  it('toutes les colonnes, le compte annoncé, le filtre du dossier, un tri total terminé par la clé primaire', async () => {
    await lireLesAdressesDuDossier('d1')
    const r = faux.requetes.find((q) => q.table === 'adresses_reception')
    expect(r).toBeDefined()
    expect(r?.colonnes).toBe('*')
    expect(r?.options).toEqual({ count: 'exact' })
    expect(r?.filtres).toEqual([['dossier_id', 'd1']])
    expect(r?.ordres).toEqual(['cree_le', 'id'])
  })

  it('le SIRET est celui de la ligne du dossier, lue par son identifiant : une ligne, la colonne seule', async () => {
    await lireLesAdressesDuDossier('d1')
    const r = faux.requetes.find((q) => q.table === 'dossiers')
    expect(r).toMatchObject({ colonnes: 'siret', filtres: [['id', 'd1']], unique: true })
  })

  it('un dossier sans adresse : lu en entier, vide — le vide est une affirmation que seule une lecture complète permet', async () => {
    faux.lignes = []
    const lu = await lireLesAdressesDuDossier('d1')
    expect(lu.adresses).toEqual({ lignes: [], complete: true, motif: null })
  })

  it('un dossier sans SIRET : lu, nul — ce n’est pas une lecture ratée', async () => {
    const lu = await lireLesAdressesDuDossier('d2')
    expect(lu.siret).toEqual({ lu: true, siret: null })
  })

  it('lue en partie : `complete` faux, son motif, et ce qui est revenu', async () => {
    faux.muetApres = 1
    const lu = await lireLesAdressesDuDossier('d1')
    expect(lu.adresses.complete).toBe(false)
    expect(lu.adresses.motif).toBe('1 ligne(s) lue(s) sur 2 annoncée(s)')
    expect(lu.adresses.lignes).toHaveLength(1)
  })

  it('refusée : `complete` faux avec le motif de la base, jamais une liste vide qui se dirait lue', async () => {
    faux.refus.adresses_reception = 'permission denied'
    const lu = await lireLesAdressesDuDossier('d1')
    expect(lu.adresses.complete).toBe(false)
    expect(lu.adresses.motif).toContain('permission denied')
    expect(lu.siret.lu).toBe(true)
  })

  it('une requête qui lève ne rejette pas : elle tombe du côté signalé, avec son motif, pour chacune des deux lectures', async () => {
    faux.leve = { adresses_reception: true, dossiers: true }
    const lu = await lireLesAdressesDuDossier('d1')
    expect(lu.adresses).toEqual({ lignes: [], complete: false, motif: 'réseau coupé' })
    expect(lu.siret).toEqual({ lu: false, motif: 'réseau coupé' })
  })

  it('le SIRET refusé se dit avec le motif de la base ; une ligne absente n’est pas un SIRET absent', async () => {
    faux.refus.dossiers = 'permission denied'
    expect((await lireLesAdressesDuDossier('d1')).siret).toEqual({ lu: false, motif: 'permission denied' })
    faux.refus = {}
    faux.dossiers = []
    expect((await lireLesAdressesDuDossier('d1')).siret).toEqual({ lu: false, motif: 'le dossier n’a pas pu être lu' })
  })
})
