import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lireLesMouvementsDesReglements, lireLesReglements } from './reglementsLecture'

// LA LECTURE DES RÈGLEMENTS (espace client, étape A3). Ce que ces cas gardent : les ventes par la lecture partagée de
// l'onglet et de l'accueil (`lireLesVentesDuDossier`, qui lit le registre une fois, avec le moyen et l'auteur) ; le relevé
// sous le filtre de SON dossier, jusqu'au bout de ce que la base annonce, et seulement avec « Banque » — sans elle, AUCUNE
// requête ne part vers `lignes_bancaires` : la RLS la rendrait vide sans erreur, et le vide serait une affirmation.

const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  muetApres: {} as Record<string, number>,
  lues: [] as string[],
  colonnes: {} as Record<string, string>,
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
          select: (liste: string) => { faux.colonnes[table] = liste; return c },
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

const VENTES = [
  'factures_emises', 'transmissions_factures', 'facture_lignes', 'encaissements_factures', 'encaissements_factures_taux',
  'transmissions_encaissements', 'facture_superpdp_events', 'statuts_factures_recus',
]

beforeEach(() => {
  faux.muetApres = {}
  faux.lues = []
  faux.colonnes = {}
  faux.tables = Object.fromEntries(VENTES.map((t) => [t, [{ id: `${t}-1`, dossier_id: 'd1', facture_id: 'f1' }]]))
  faux.tables.factures_emises = [{ id: 'f1', dossier_id: 'd1' }]
  faux.tables.lignes_bancaires = [
    { id: 'm1', dossier_id: 'd1', date: '2027-10-03', libelle: 'VIR FICTIF' },
    { id: 'm2', dossier_id: 'd1', date: '2027-10-04', libelle: 'CB FICTIVE' },
    { id: 'm3', dossier_id: 'd2', date: '2027-10-05', libelle: 'AUTRE DOSSIER' },
  ]
})

describe('lireLesMouvementsDesReglements', () => {
  it('avec « Banque » : le relevé du dossier, en entier', async () => {
    const r = await lireLesMouvementsDesReglements('d1', true)
    expect(r).toEqual({
      etat: 'lus', complete: true, motif: null,
      lignes: [{ id: 'm1', dossier_id: 'd1', date: '2027-10-03', libelle: 'VIR FICTIF' }, { id: 'm2', dossier_id: 'd1', date: '2027-10-04', libelle: 'CB FICTIVE' }],
    })
    expect(faux.colonnes.lignes_bancaires).toBe('id, date, libelle')
  })

  it('lu en partie : son motif', async () => {
    faux.muetApres = { lignes_bancaires: 1 }
    const r = await lireLesMouvementsDesReglements('d1', true)
    expect(r).toMatchObject({ etat: 'lus', complete: false, motif: '1 ligne(s) lue(s) sur 2 annoncée(s)' })
  })

  it('sans « Banque » : rien n’est demandé', async () => {
    expect(await lireLesMouvementsDesReglements('d1', false)).toEqual({ etat: 'hors_acces' })
    expect(faux.lues).toEqual([])
  })
})

describe('lireLesReglements', () => {
  it('les ventes par la lecture partagée — le registre avec son moyen et son auteur — et le relevé', async () => {
    const r = await lireLesReglements('d1', true)
    expect(new Set(faux.lues)).toEqual(new Set([...VENTES, 'lignes_bancaires']))
    expect(faux.colonnes.encaissements_factures).toMatch(/\bmoyen\b/)
    expect(faux.colonnes.encaissements_factures).toMatch(/\bcree_par\b/)
    expect(faux.colonnes.encaissements_factures).toMatch(/\bcree_le\b/)
    expect(r.ventes.encaissements).toHaveLength(1)
    expect(r.mouvements).toMatchObject({ etat: 'lus', complete: true })
  })

  it('sans « Banque » : les ventes seules', async () => {
    const r = await lireLesReglements('d1', false)
    expect(new Set(faux.lues)).toEqual(new Set(VENTES))
    expect(r.mouvements).toEqual({ etat: 'hors_acces' })
  })
})
