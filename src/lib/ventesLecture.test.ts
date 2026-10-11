import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lireLesVentesDuDossier } from './ventesLecture'

// LA LECTURE DES VENTES D'UN DOSSIER (espace client, étape P4b) : ce que l'onglet Factures lit pour ses pastilles, et que
// l'accueil du client compte. Ce que ces cas gardent : chaque collection va jusqu'au bout de ce que la base annonce
// (`lireTout`), sous le filtre de SON dossier ; une collection lue en partie porte son motif, à sa place — l'accueil se tait
// et l'onglet éteint les pastilles qui en dépendent ; une lecture complète n'en porte aucun.

const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  muetApres: {} as Record<string, number>,
  lues: [] as string[],
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        if (!(table in faux.tables)) throw new Error(`Table non attendue : ${table}`)
        const predicats: ((l: Record<string, unknown>) => boolean)[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: () => c,
          eq: (colonne: string, valeur: unknown) => {
            predicats.push(colonne === 'factures_emises.dossier_id'
              ? (l) => faux.tables.factures_emises.some((f) => f.id === l.facture_id && f.dossier_id === valeur)
              : predicatEq(colonne, valeur))
            return c
          },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          then: (suite: (r: unknown) => unknown) => {
            faux.lues.push(table)
            const toutes = filtrer(faux.tables[table], predicats)
            const rendu = toutes.slice(debut, Math.min(fin + 1, toutes.length, faux.muetApres[table] ?? Infinity))
            return Promise.resolve({ data: rendu, error: null, count: toutes.length }).then(suite)
          },
        })
        return c
      },
    },
  }
})

const TABLES = [
  'factures_emises', 'transmissions_factures', 'facture_lignes', 'encaissements_factures', 'encaissements_factures_taux',
  'transmissions_encaissements', 'facture_superpdp_events', 'statuts_factures_recus',
] as const

beforeEach(() => {
  faux.muetApres = {}
  faux.lues = []
  // Deux lignes du dossier et une d'un autre dans chaque table ; les lignes et l'historique de Super PDP par leur facture.
  faux.tables = Object.fromEntries(TABLES.map((t) => [t, [
    { id: `${t}-1`, dossier_id: 'd1', facture_id: 'f1' },
    { id: `${t}-2`, dossier_id: 'd1', facture_id: 'f1' },
    { id: `${t}-3`, dossier_id: 'd2', facture_id: 'f2' },
  ]]))
  faux.tables.factures_emises = [{ id: 'f1', dossier_id: 'd1' }, { id: 'f1b', dossier_id: 'd1' }, { id: 'f2', dossier_id: 'd2' }]
})

describe('lireLesVentesDuDossier', () => {
  it('lit les huit collections du dossier, et seulement les siennes ; complètes, aucun motif', async () => {
    const lu = await lireLesVentesDuDossier('d1')
    expect(new Set(faux.lues)).toEqual(new Set(TABLES))
    expect(lu.factures.map((f) => f.id)).toEqual(['f1', 'f1b'])
    for (const liste of [lu.transmissions, lu.lignes, lu.encaissements, lu.parts, lu.declarations, lu.evenementsSuperpdp, lu.statutsLus]) {
      expect(liste).toHaveLength(2)
    }
    expect([lu.facturesIncompletes, lu.transmissionsIncompletes, lu.encaissementsIncomplets, lu.declarationsIncompletes,
      lu.statutsIncomplets]).toEqual([null, null, null, null, null])
  })

  it.each([
    ['factures_emises', 'facturesIncompletes'],
    ['transmissions_factures', 'transmissionsIncompletes'],
    ['facture_lignes', 'encaissementsIncomplets'],
    ['encaissements_factures', 'encaissementsIncomplets'],
    ['encaissements_factures_taux', 'encaissementsIncomplets'],
    ['transmissions_encaissements', 'declarationsIncompletes'],
    ['facture_superpdp_events', 'declarationsIncompletes'],
    ['statuts_factures_recus', 'statutsIncomplets'],
  ] as const)('%s lue en partie : le motif se range sous %s, et nulle part ailleurs', async (table, cle) => {
    faux.muetApres = { [table]: 1 }
    const lu = await lireLesVentesDuDossier('d1')
    const motifs = {
      facturesIncompletes: lu.facturesIncompletes, transmissionsIncompletes: lu.transmissionsIncompletes,
      encaissementsIncomplets: lu.encaissementsIncomplets, declarationsIncompletes: lu.declarationsIncompletes,
      statutsIncomplets: lu.statutsIncomplets,
    }
    for (const [nom, motif] of Object.entries(motifs)) {
      if (nom === cle) expect(motif, nom).toEqual(expect.any(String))
      else expect(motif, nom).toBeNull()
    }
  })
})
