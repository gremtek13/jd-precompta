import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lireLesFacturesProposees, type FactureProposee } from './exemplairesDesFacturesLecture'

// CE QUE LA FICHE D'UNE PIÈCE LIT POUR DÉSIGNER UN EXEMPLAIRE (lib/exemplairesDesFacturesLecture.ts) : les factures émises
// VALIDÉES du dossier — factures et avoirs —, EN ENTIER, avec leur client et leur montant, ou un motif. Le faux client
// APPLIQUE les filtres (src/test/filtresPostgrest.ts) et ne rend que les colonnes demandées, comme PostgREST. Données FICTIVES.
const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  muetApres: {} as Record<string, number>,
  refus: {} as Record<string, string>,
  // Une requête dont la construction lève : un module ne rejette jamais.
  leve: null as string | null,
  demandes: [] as string[],
  tris: [] as string[],
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        if (faux.leve) throw new Error(faux.leve)
        const predicats: ((l: Record<string, unknown>) => boolean)[] = []
        let colonnes: string[] | null = null
        const q: Record<string, unknown> = {
          select: (liste: string) => {
            colonnes = liste === '*' ? null : liste.split(',').map((x) => x.trim())
            faux.demandes.push(`${table}: ${liste}`)
            return q
          },
          eq: (c: string, v: unknown) => { predicats.push(predicatEq(c, v)); return q },
          order: (colonne: string, options?: { ascending?: boolean }) => {
            faux.tris.push(`${colonne}${options?.ascending === false ? ' décroissant' : ''}`)
            return q
          },
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
const facture = (o: Partial<FactureProposee> = {}): FactureProposee => ({
  id: 'f1', dossier_id: D, statut: 'validee', type: 'facture', numero: 'F2026-0007', date_emission: '2026-03-14',
  tiers_nom: 'CLIENT FICTIF SAS', montant_ttc: 1200, ...o,
})

beforeEach(() => {
  faux.muetApres = {}
  faux.refus = {}
  faux.leve = null
  faux.demandes = []
  faux.tris = []
  faux.tables = {
    factures_emises: [
      facture(),
      facture({ id: 'a1', type: 'avoir', numero: 'A2026-0001', montant_ttc: -300 }),
      // Un brouillon, une facture d'un autre dossier : ni l'un ni l'autre n'est lu.
      facture({ id: 'f-brouillon', statut: 'brouillon', numero: null }),
      facture({ id: 'f-autre', dossier_id: 'd2', numero: 'F2026-0100' }),
    ].map((f) => ({ ...f, superpdp_invoice_id: 4242, emetteur_siret: '12345678900012' })),
  }
})

describe('lireLesFacturesProposees', () => {
  it('les factures et les avoirs VALIDÉS du dossier, réduits aux colonnes de la confirmation', async () => {
    const l = await lireLesFacturesProposees(D)
    expect(l.complete).toBe(true)
    expect(l.motif).toBeNull()
    expect(l.lignes).toEqual([facture(), facture({ id: 'a1', type: 'avoir', numero: 'A2026-0001', montant_ttc: -300 })])
    expect(faux.demandes).toEqual(['factures_emises: id, dossier_id, statut, type, numero, date_emission, tiers_nom, montant_ttc'])
  })

  it('trie sur la date d’émission, la plus récente d’abord, et termine par la clé primaire (un ordre total)', async () => {
    await lireLesFacturesProposees(D)
    expect(faux.tris).toEqual(['date_emission décroissant', 'id'])
  })

  it('lue en partie, elle ne se dit pas complète et rend son motif', async () => {
    faux.muetApres = { factures_emises: 1 }
    const l = await lireLesFacturesProposees(D)
    expect(l.complete).toBe(false)
    expect(l.motif).toBe('1 ligne(s) lue(s) sur 2 annoncée(s)')
  })

  it('refusée par la base, elle rend la raison', async () => {
    faux.refus = { factures_emises: 'accès refusé' }
    const l = await lireLesFacturesProposees(D)
    expect(l.complete).toBe(false)
    expect(l.lignes).toEqual([])
    expect(l.motif).toContain('accès refusé')
  })

  it('une requête qui lève ne rejette pas : elle tombe du côté signalé', async () => {
    faux.leve = 'client indisponible'
    const l = await lireLesFacturesProposees(D)
    expect(l.complete).toBe(false)
    expect(l.motif).toBe('client indisponible')
  })
})
