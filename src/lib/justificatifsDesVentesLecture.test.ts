import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lireLesJustificatifsDesVentes } from './justificatifsDesVentesLecture'

// LA LECTURE DES PREUVES DES FACTURES QUE LA PISTE D'AUDIT CITE (lib/justificatifsDesVentesLecture.ts, chantier EC-Q3, étape
// VF4c2) : les exemplaires désignés et les transmissions, chacun EN ENTIER — ou l'export se refuse, et l'état dit pourquoi ;
// la pagination d'un serveur qui rend moins qu'on ne demande ; une ligne d'un autre dossier. Le faux client APPLIQUE les
// filtres (src/test/filtresPostgrest.ts), `.not(colonne, 'is', null)` compris, et ne rend que les colonnes demandées.
// Données FICTIVES.
const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  plafond: Infinity,
  muetApres: {} as Record<string, number>,
  refus: {} as Record<string, string>,
  fuite: {} as Record<string, boolean>,
  leve: false,
  demandes: [] as string[],
  tranches: 0,
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq, predicatNot } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        if (faux.leve) throw new Error('client indisponible')
        if (!(table in faux.tables)) throw new Error(`Table non attendue dans ce test : ${table}`)
        const predicats: ((l: Record<string, unknown>) => boolean)[] = []
        let colonnes: string[] = []
        const q: Record<string, unknown> = {
          select: (liste: string, options: { count?: string }) => {
            if (options?.count !== 'exact') throw new Error('une lecture de collection annonce son compte')
            colonnes = liste.split(',').map((x) => x.trim())
            faux.demandes.push(`${table}: ${liste}`)
            return q
          },
          eq: (c: string, v: unknown) => {
            if (!(faux.fuite[table] && c === 'dossier_id')) predicats.push(predicatEq(c, v))
            return q
          },
          not: (c: string, op: string, v: unknown) => { predicats.push(predicatNot(c, op, v)); return q },
          order: () => q,
          range: async (debut: number, fin: number) => {
            faux.tranches++
            if (faux.refus[table]) return { data: null, error: { message: faux.refus[table] }, count: null }
            const toutes = filtrer(faux.tables[table], predicats)
            const rendu = toutes
              .slice(debut, Math.min(fin + 1, debut + faux.plafond, faux.muetApres[table] ?? Infinity))
              .map((l) => Object.fromEntries(colonnes.map((k) => [k, l[k]])))
            return { data: rendu, error: null, count: toutes.length }
          },
        }
        return q
      },
    },
  }
})

const exemplaire = (o: Record<string, unknown> = {}) => ({
  id: 'p1', dossier_id: 'd1', facture_id: 'f1', nom_fichier: 'F2025-0001.pdf', storage_hash: 'a'.repeat(64), statut: 'a_valider', ...o,
})
const transmission = (o: Record<string, unknown> = {}) => ({
  id: 't1', dossier_id: 'd1', facture_id: 'f1', etat: 'accepte', sha256: 'b'.repeat(64), hote: 'api.superpdp.tech',
  canal: 'superpdp', ...o,
})

beforeEach(() => {
  faux.plafond = Infinity
  faux.muetApres = {}
  faux.refus = {}
  faux.fuite = {}
  faux.leve = false
  faux.demandes = []
  faux.tranches = 0
  faux.tables = {
    pieces: [
      exemplaire(),
      // Une pièce que rien ne désigne : pas un exemplaire, elle n'est pas lue.
      exemplaire({ id: 'p2', facture_id: null }),
      exemplaire({ id: 'p-d2', dossier_id: 'd2', facture_id: 'f-d2' }),
    ],
    transmissions_factures: [transmission(), transmission({ id: 't2', etat: 'echec' }), transmission({ id: 't-d2', dossier_id: 'd2' })],
  }
})

describe('lireLesJustificatifsDesVentes', () => {
  it('lit les exemplaires désignés, quel que soit leur statut, et les transmissions du dossier, réduits à leurs colonnes', async () => {
    expect(await lireLesJustificatifsDesVentes('d1')).toEqual({
      etat: 'lue',
      exemplaires: [{ id: 'p1', dossier_id: 'd1', facture_id: 'f1', nom_fichier: 'F2025-0001.pdf', storage_hash: 'a'.repeat(64) }],
      transmissions: [
        { id: 't1', dossier_id: 'd1', facture_id: 'f1', etat: 'accepte', sha256: 'b'.repeat(64), hote: 'api.superpdp.tech' },
        { id: 't2', dossier_id: 'd1', facture_id: 'f1', etat: 'echec', sha256: 'b'.repeat(64), hote: 'api.superpdp.tech' },
      ],
    })
    expect(faux.demandes).toEqual([
      'pieces: id, dossier_id, facture_id, nom_fichier, storage_hash',
      'transmissions_factures: id, dossier_id, facture_id, etat, sha256, hote',
    ])
  })

  it('pagine : un serveur qui rend une ligne par réponse rend les mêmes lignes, en plus de tranches', async () => {
    const entiere = await lireLesJustificatifsDesVentes('d1')
    const avant = faux.tranches
    faux.tranches = 0
    faux.plafond = 1
    expect(await lireLesJustificatifsDesVentes('d1')).toEqual(entiere)
    expect(faux.tranches).toBeGreaterThan(avant)
  })

  it('une lecture partielle ou refusée, de l’une ou l’autre, et rien ne se rend : l’état dit laquelle', async () => {
    for (const [table, nom] of [['pieces', 'les exemplaires'], ['transmissions_factures', 'les transmissions']] as const) {
      faux.muetApres = { [table]: 0 }
      expect(await lireLesJustificatifsDesVentes('d1'), table).toEqual({ etat: 'incomplete', motif: expect.stringContaining(nom) })
      faux.muetApres = {}
      faux.refus = { [table]: 'permission refusée' }
      const l = await lireLesJustificatifsDesVentes('d1')
      expect(l.etat === 'incomplete' && l.motif, table).toContain('permission refusée')
      faux.refus = {}
    }
  })

  it('une ligne d’un autre dossier, rendue par une lecture qui fuit, rend l’état incomplet', async () => {
    for (const table of ['pieces', 'transmissions_factures']) {
      faux.fuite = { [table]: true }
      expect(await lireLesJustificatifsDesVentes('d1'), table).toEqual({ etat: 'incomplete', motif: expect.stringContaining('de ce dossier') })
    }
  })

  it('un client qui lève ne fait pas rejeter la lecture : l’état le dit', async () => {
    faux.leve = true
    await expect(lireLesJustificatifsDesVentes('d1')).resolves.toEqual({ etat: 'incomplete', motif: 'client indisponible' })
  })
})
