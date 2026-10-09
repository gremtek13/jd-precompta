import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FacturePourJumelle, PiecePourJumelle, TransmissionPourJumelle } from './ventesJumelles'
import { lireJumellesDuDossier, lireVentesEmises } from './ventesJumellesLecture'

// CE QUE LE PONT LIT POUR LES ÉCRANS (lib/ventesJumellesLecture.ts) : les factures émises VALIDÉES du dossier, ses
// transmissions, ses pièces, chacune EN ENTIER — ou un motif, et rien sur les jumelles. Le faux client APPLIQUE les
// filtres (src/test/filtresPostgrest.ts) et ne rend que les colonnes demandées, comme PostgREST. Données FICTIVES.
const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  // Lecture partielle : la table cesse de rendre des lignes au-delà de ce rang, en annonçant le vrai total.
  muetApres: {} as Record<string, number>,
  refus: {} as Record<string, string>,
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        if (!(table in faux.tables)) throw new Error(`Table non attendue dans ce test : ${table}`)
        const predicats: ((l: Record<string, unknown>) => boolean)[] = []
        let colonnes: string[] | null = null
        const q: Record<string, unknown> = {
          select: (liste: string) => { colonnes = liste === '*' ? null : liste.split(',').map((x) => x.trim()); return q },
          eq: (c: string, v: unknown) => { predicats.push(predicatEq(c, v)); return q },
          order: () => q,
          range: (debut: number, fin: number) => {
            if (faux.refus[table]) return Promise.resolve({ data: null, error: { message: faux.refus[table] }, count: null })
            const toutes = filtrer(faux.tables[table], predicats)
            const rendu = toutes.slice(debut, Math.min(fin + 1, faux.muetApres[table] ?? Infinity))
              .map((l) => (colonnes ? Object.fromEntries(colonnes.map((k) => [k, l[k]])) : l))
            return Promise.resolve({ data: rendu, error: null, count: toutes.length })
          },
        }
        return q
      },
    },
  }
})

const D = 'd1'
const facture = (o: Partial<FacturePourJumelle> = {}): FacturePourJumelle => ({
  id: 'f1', dossier_id: D, statut: 'validee', type: 'facture', numero: 'F2026-0007', date_emission: '2026-03-14',
  emetteur_siret: '12345678900012', superpdp_invoice_id: 4242, ...o,
})
const transmission = (o: Partial<TransmissionPourJumelle & { id: string; dossier_id: string }> = {}) => ({
  id: 't1', dossier_id: D, facture_id: 'f1', canal: 'plateforme' as const, hote: 'pa.exemple.fr', flux_id: 'flux-1', ...o,
})
const piece = (o: Partial<PiecePourJumelle> = {}): PiecePourJumelle => ({
  id: 'p1', dossier_id: D, flux_hote: null, flux_id: null, superpdp_invoice_id: null,
  identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, ...o,
})

beforeEach(() => {
  faux.muetApres = {}
  faux.refus = {}
  faux.tables = {
    factures_emises: [
      facture(),
      // Un brouillon, une facture d'un autre dossier : ni l'un ni l'autre n'est lu.
      facture({ id: 'f-brouillon', statut: 'brouillon', numero: null, superpdp_invoice_id: 7 }),
      facture({ id: 'f-autre', dossier_id: 'd2', superpdp_invoice_id: 8 }),
    ],
    transmissions_factures: [transmission(), transmission({ id: 't-autre', dossier_id: 'd2', facture_id: 'f-autre' })],
    pieces: [
      piece({ id: 'p-superpdp', superpdp_invoice_id: 4242 }),
      piece({ id: 'p-flux', flux_hote: 'pa.exemple.fr', flux_id: 'flux-1' }),
      piece({ id: 'p-brouillon', superpdp_invoice_id: 7 }),
      piece({ id: 'p-autre', dossier_id: 'd2', superpdp_invoice_id: 8 }),
    ],
  }
})

describe('lireVentesEmises', () => {
  it('les factures VALIDÉES du dossier et ses transmissions, chacune réduite aux colonnes que le pont lit', async () => {
    const l = await lireVentesEmises(D)
    expect(l.motif).toBeNull()
    expect(l.factures).toEqual([facture()])
    expect(l.transmissions).toEqual([{ id: 't1', facture_id: 'f1', canal: 'plateforme', hote: 'pa.exemple.fr', flux_id: 'flux-1' }])
  })

  it('une lecture partielle des factures ou des transmissions rend son motif', async () => {
    faux.muetApres = { factures_emises: 0 }
    expect((await lireVentesEmises(D)).motif).toBe('0 ligne(s) lue(s) sur 1 annoncée(s)')
    faux.muetApres = {}
    faux.refus = { transmissions_factures: 'accès refusé' }
    expect((await lireVentesEmises(D)).motif).toContain('accès refusé')
  })
})

describe('lireJumellesDuDossier', () => {
  it('les jumelles du dossier, par ses pièces à lui', async () => {
    const l = await lireJumellesDuDossier(D)
    expect(l.motif).toBeNull()
    expect(l.factures.map((f) => f.id)).toEqual(['f1'])
    expect(l.jumelles?.parFacture.get('f1')?.map((j) => j.pieceId)).toEqual(['p-superpdp', 'p-flux'])
    expect([...(l.jumelles?.parPiece.keys() ?? [])]).toEqual(['p-superpdp', 'p-flux'])
  })

  it('rien sur les jumelles quand l’une des trois lectures est partielle, et le motif le dit', async () => {
    for (const table of ['factures_emises', 'transmissions_factures', 'pieces']) {
      faux.muetApres = { [table]: 0 }
      const l = await lireJumellesDuDossier(D)
      expect(l.jumelles, table).toBeNull()
      expect(l.motif, table).toMatch(/ligne\(s\) lue\(s\) sur \d annoncée\(s\)/)
    }
  })
})
