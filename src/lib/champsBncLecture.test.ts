import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHAMPS_BNC_EXPORTES } from './champsBncDuFec'
import {
  COLONNES_COTISATIONS_DU_FEC, COLONNES_FACTURES_DU_FEC, lireLesChampsBnc, lireLesChampsBncSelon,
} from './champsBncLecture'

// CE QUE LE FEC D'UN BNC EN TRÉSORERIE LIT DE PLUS (lot FEC22c1). Ce que ces cas gardent : le drapeau baissé, AUCUN appel au
// réseau ; levé, les deux tables et le filtre de SON dossier, les colonnes nommées — jamais le nom du client —, le compte
// annoncé, un tri total terminé par la clé primaire, la lecture jusqu'au bout ; le tout ou rien, avec le motif de la première
// lecture qui manque ; une ligne d'un autre dossier refusée ; et qu'elle ne REJETTE jamais. Données FICTIVES.

const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  muetApres: {} as Record<string, number>,
  requetes: [] as { table: string; colonnes: string; options: unknown; ordres: string[]; filtres: [string, unknown][] }[],
  leve: false,
  refus: null as string | null,
  // Une table dont le faux rend toutes les lignes, filtre ignoré : ce qu'une policy ou une requête fautive rendrait.
  sansFiltre: null as string | null,
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
          const toutes = filtrer(faux.tables[table] ?? [], table === faux.sansFiltre ? [] : predicats)
          const muet = faux.muetApres[table] ?? Infinity
          return Promise.resolve({ data: toutes.slice(debut, Math.min(fin + 1, toutes.length, muet)), error: null, count: toutes.length })
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
  faux.tables = {
    factures_emises: [
      { id: 'f1', dossier_id: 'd1', numero: 'F2026-0001', statut: 'validee', tiers_siret: '12345678200010', source_de_la_vente: false },
      { id: 'f2', dossier_id: 'd1', numero: null, statut: 'brouillon', tiers_siret: null, source_de_la_vente: true },
      { id: 'x1', dossier_id: 'd2', numero: 'F2026-0009', statut: 'validee', tiers_siret: null, source_de_la_vente: false },
    ],
    cotisations_declarees: [
      { id: 'c1', dossier_id: 'd1', paiement_personnel_le: '2026-03-10' },
      { id: 'c2', dossier_id: 'd1', paiement_personnel_le: null },
    ],
  }
  faux.muetApres = {}
  faux.requetes = []
  faux.leve = false
  faux.refus = null
  faux.sansFiltre = null
})

describe('lireLesChampsBncSelon — le drapeau levé', () => {
  it('les factures et les échéances de SON dossier, lues en entier, avec l’identifiant du dossier', async () => {
    const lu = await lireLesChampsBncSelon('d1', true)
    expect(lu).toEqual({
      dossierId: 'd1', etat: 'lue',
      factures: faux.tables.factures_emises.slice(0, 2), cotisations: faux.tables.cotisations_declarees,
    })
  })

  it('les colonnes nommées — ni le nom du client, ni rien d’autre —, le compte annoncé, un tri total terminé par la clé primaire', async () => {
    await lireLesChampsBncSelon('d1', true)
    expect(faux.requetes.map((r) => r.table)).toEqual(['factures_emises', 'cotisations_declarees'])
    expect(faux.requetes[0]).toMatchObject({ colonnes: COLONNES_FACTURES_DU_FEC, options: { count: 'exact' }, filtres: [['dossier_id', 'd1']] })
    expect(faux.requetes[1]).toMatchObject({ colonnes: COLONNES_COTISATIONS_DU_FEC, options: { count: 'exact' }, filtres: [['dossier_id', 'd1']] })
    expect(faux.requetes.every((r) => r.ordres.at(-1) === 'id')).toBe(true)
    expect(COLONNES_FACTURES_DU_FEC).not.toMatch(/tiers_nom|\*/)
  })

  it('une seule lecture interrompue suffit : incomplète, avec le nom de celle qui a manqué', async () => {
    faux.muetApres = { cotisations_declarees: 1 }
    const lu = await lireLesChampsBncSelon('d1', true)
    expect(lu.etat).toBe('incomplete')
    expect(lu.etat === 'incomplete' && lu.motif).toMatch(/^les échéances de cotisation : /)
  })

  it('une ligne d’un autre dossier rendue quand même : incomplète, jamais lue comme la sienne', async () => {
    faux.sansFiltre = 'factures_emises'
    const lu = await lireLesChampsBncSelon('d1', true)
    expect(lu).toEqual({ dossierId: 'd1', etat: 'incomplete', motif: "les factures du dossier : une ligne rendue n'est pas de ce dossier" })
  })

  it('refusée, ou qui lève : incomplète, avec son motif — jamais un rejet', async () => {
    faux.refus = 'permission refusée'
    const refusee = await lireLesChampsBncSelon('d1', true)
    expect(refusee.etat === 'incomplete' && refusee.motif).toContain('permission refusée')
    faux.refus = null
    faux.leve = true
    const levee = await lireLesChampsBncSelon('d1', true)
    expect(levee).toMatchObject({ dossierId: 'd1', etat: 'incomplete' })
    expect(levee.etat === 'incomplete' && levee.motif).toContain('réseau coupé')
  })
})

describe('lireLesChampsBncSelon — le drapeau baissé', () => {
  it('ne lit rien, ne touche pas au réseau, et le dit', async () => {
    expect(await lireLesChampsBncSelon('d1', false)).toEqual({ dossierId: 'd1', etat: 'non_exportes' })
    expect(faux.requetes).toEqual([])
  })

  it('le module chargé normalement suit son drapeau', async () => {
    const lu = await lireLesChampsBnc('d1')
    expect(lu.etat).toBe(CHAMPS_BNC_EXPORTES === null ? 'non_exportes' : 'lue')
    expect(faux.requetes.length).toBe(CHAMPS_BNC_EXPORTES === null ? 0 : 2)
  })
})
