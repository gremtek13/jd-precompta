import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lireLesActivitesDesContacts } from './contactsInactifsLecture'

// LA LECTURE DE L'ACTIVITÉ DES CONTACTS. Ce que ces cas gardent : les deux tables (factures ET devis), le filtre de SON
// dossier, un tri total par la clé primaire, le compte annoncé — donc `complete` faux dès qu'une des deux lectures s'arrête
// avant la fin, et son motif nommé ; les lignes qui ne citent aucun contact écartées après la lecture, jamais par la
// requête ; une requête qui lève rejette (jamais une liste vide).

const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  muetApres: {} as Record<string, number>,
  requetes: [] as { table: string; colonnes: string; options: unknown; ordres: string[]; filtres: [string, unknown][] }[],
  leve: '' as string,
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
            if (faux.leve === table) return Promise.reject(new Error('réseau coupé')).then(suite, echec)
            const toutes = filtrer(faux.tables[table] ?? [], predicats)
            const rendu = toutes.slice(debut, Math.min(fin + 1, toutes.length, faux.muetApres[table] ?? Infinity))
            return Promise.resolve({ data: rendu, error: null, count: toutes.length }).then(suite, echec)
          },
        })
        return c
      },
    },
  }
})

beforeEach(() => {
  faux.tables = {
    factures_emises: [
      { id: 'f1', dossier_id: 'd1', contact_id: 'k1', date_emission: '2024-03-01' },
      { id: 'f2', dossier_id: 'd1', contact_id: null, date_emission: '2025-01-01' },
      { id: 'f3', dossier_id: 'd2', contact_id: 'k9', date_emission: '2025-01-01' },
    ],
    devis: [
      { id: 'v1', dossier_id: 'd1', contact_id: 'k1', date_emission: '2025-06-01' },
      { id: 'v2', dossier_id: 'd1', contact_id: 'k2', date_emission: '2023-02-01' },
    ],
  }
  faux.muetApres = {}
  faux.requetes = []
  faux.leve = ''
})

describe('lireLesActivitesDesContacts', () => {
  it('les factures et les devis de SON dossier qui citent un contact, lus en entier', async () => {
    const lu = await lireLesActivitesDesContacts('d1')
    expect(lu).toEqual({
      activites: [
        { contactId: 'k1', date: '2024-03-01' }, { contactId: 'k1', date: '2025-06-01' }, { contactId: 'k2', date: '2023-02-01' },
      ],
      complete: true,
      motif: null,
    })
    expect(faux.requetes.map((r) => [r.table, r.colonnes, r.ordres, r.filtres])).toEqual([
      ['factures_emises', 'id, contact_id, date_emission', ['id'], [['dossier_id', 'd1']]],
      ['devis', 'id, contact_id, date_emission', ['id'], [['dossier_id', 'd1']]],
    ])
    expect(faux.requetes.every((r) => (r.options as { count?: string }).count === 'exact')).toBe(true)
  })

  it('une des deux lectures arrêtée avant la fin : incomplète, et son motif nommé', async () => {
    faux.muetApres = { devis: 1 }
    const lu = await lireLesActivitesDesContacts('d1')
    expect(lu.complete).toBe(false)
    expect(lu.motif).toMatch(/^devis : /)
    faux.muetApres = { factures_emises: 1 }
    const lu2 = await lireLesActivitesDesContacts('d1')
    expect(lu2.complete).toBe(false)
    expect(lu2.motif).toMatch(/^factures : /)
  })

  it('une requête qui lève rejette', async () => {
    faux.leve = 'devis'
    await expect(lireLesActivitesDesContacts('d1')).rejects.toThrow()
  })
})
