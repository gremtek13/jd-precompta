import { beforeEach, describe, expect, it, vi } from 'vitest'
import { declarationDesAchats, type DossierEreporting } from './ereporting'
import { lireRegimesEtEcarts } from './regimesEreportingLecture'
import type { PieceEcarteeEreporting, RegimeEreporting } from './types'

// CE QUE LE CONTENU D'UNE DÉCLARATION LIT DE LA BASE DEPUIS L'ÉTAPE e5a (lib/regimesEreportingLecture.ts) : les régimes
// confirmés du dossier et ses pièces écartées, retirés compris, chacun EN ENTIER — ou son drapeau baissé, avec son motif.
// Le faux client APPLIQUE les filtres (src/test/filtresPostgrest.ts), comme PostgREST, et annonce le compte. Données
// FICTIVES.
const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  // Lecture partielle : la table cesse de rendre des lignes au-delà de ce rang, en annonçant le vrai total.
  muetApres: {} as Record<string, number>,
  refus: {} as Record<string, string>,
  ordres: [] as string[],
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        if (!(table in faux.tables)) throw new Error(`Table non attendue dans ce test : ${table}`)
        const predicats: ((l: Record<string, unknown>) => boolean)[] = []
        const q: Record<string, unknown> = {
          select: (liste: string, options: { count?: string }) => {
            if (liste !== '*' || options.count !== 'exact') throw new Error(`Sélection inattendue : ${liste}`)
            return q
          },
          eq: (c: string, v: unknown) => { predicats.push(predicatEq(c, v)); return q },
          order: (c: string) => { faux.ordres.push(`${table}.${c}`); return q },
          range: (debut: number, fin: number) => {
            if (faux.refus[table]) return Promise.resolve({ data: null, error: { message: faux.refus[table] }, count: null })
            const toutes = filtrer(faux.tables[table], predicats)
            const rendu = toutes.slice(debut, Math.min(fin + 1, faux.muetApres[table] ?? Infinity))
            return Promise.resolve({ data: rendu, error: null, count: toutes.length })
          },
        }
        return q
      },
    },
  }
})

const D = 'd1'
// Un dossier redevable au réel trimestriel depuis le 1er janvier 2026 ; une première confirmation, retirée.
const regime = (o: Partial<RegimeEreporting> = {}): RegimeEreporting => ({
  id: 'r1', dossier_id: D, depuis: '2026-01-01', statut_tva: 'redevable', article_exoneration: null,
  tva_periodicite: 'trimestrielle', tva_sur_debits: false, frequence_transactions: 'mois', frequence_paiements: 'mois',
  note: null, cree_par: 'u1', cree_le: '2026-01-02T10:00:00Z', retire_le: null, retire_par: null, ...o,
})
const ecart = (o: Partial<PieceEcarteeEreporting> = {}): PieceEcarteeEreporting => ({
  id: 'x1', dossier_id: D, piece_id: 'p9', motif: 'Fournisseur établi en France.', cree_par: 'u1',
  cree_le: '2027-10-20T10:00:00Z', retire_le: null, retire_par: null, ...o,
})

const RETIRE = ecart({ id: 'x0', piece_id: 'p8', retire_le: '2027-10-21T10:00:00Z', retire_par: 'u1' })
// Une ligne de la table, telle que le faux client la filtre : un objet à clés quelconques.
const ligne = (x: object): Record<string, unknown> => Object.fromEntries(Object.entries(x))

beforeEach(() => {
  faux.muetApres = {}
  faux.refus = {}
  faux.ordres = []
  faux.tables = {
    regimes_ereporting: [
      regime({ id: 'r0', statut_tva: 'franchise', tva_periodicite: null, frequence_transactions: 'bimestre',
        frequence_paiements: 'bimestre', retire_le: '2026-01-02T09:00:00Z', retire_par: 'u1' }),
      regime(),
      regime({ id: 'r-autre', dossier_id: 'd2' }),
    ].map(ligne),
    // Un écart retiré — sa pièce est de nouveau à vérifier —, l'écart actif, et celui d'un autre dossier.
    pieces_ecartees_ereporting: [RETIRE, ecart(), ecart({ id: 'x-autre', dossier_id: 'd2', piece_id: 'p-autre' })].map(ligne),
  }
})

describe('lireRegimesEtEcarts', () => {
  it('les régimes et les écarts du dossier, retirés compris, en entier, triés sur leur clé primaire', async () => {
    const l = await lireRegimesEtEcarts(D)
    expect(l.regimes).toEqual({ lignes: [faux.tables.regimes_ereporting[0], faux.tables.regimes_ereporting[1]], complete: true, motif: null })
    expect(l.ecarts).toEqual({ lignes: [RETIRE, ecart()], complete: true, motif: null })
    expect(l.motif).toBeNull()
    expect(faux.ordres.sort()).toEqual(['pieces_ecartees_ereporting.id', 'regimes_ereporting.id'])
  })

  it('une lecture partielle ou refusée garde son drapeau baissé et son motif, chacune pour elle, et le motif d’ensemble le dit', async () => {
    faux.muetApres = { regimes_ereporting: 1 }
    const partielle = await lireRegimesEtEcarts(D)
    expect(partielle.regimes.complete).toBe(false)
    expect(partielle.regimes.motif).toBe('1 ligne(s) lue(s) sur 2 annoncée(s)')
    expect(partielle.ecarts.complete).toBe(true)
    expect(partielle.motif).toBe('1 ligne(s) lue(s) sur 2 annoncée(s)')
    faux.muetApres = {}
    faux.refus = { pieces_ecartees_ereporting: 'accès refusé' }
    const refusee = await lireRegimesEtEcarts(D)
    expect(refusee.regimes.complete).toBe(true)
    expect(refusee.ecarts.complete).toBe(false)
    expect(refusee.ecarts.motif).toContain('accès refusé')
    expect(refusee.motif).toContain('accès refusé')
  })

  it('se branche tel quel sur le contenu d’une déclaration : le régime confirmé, l’écart honoré, la lecture partielle dite', async () => {
    const dossier: DossierEreporting = {
      id: D, siret: '12345678200010', statut_tva: 'redevable', article_exoneration: null, numero_tva_attribue: false,
      tva_periodicite: 'trimestrielle', tva_sur_debits: false,
    }
    // Une pièce en dollars sans fiche : une candidate (étape e3), que le cabinet a écartée.
    const pieces = {
      lignes: [{ id: 'p9', dossier_id: D, type_piece: 'achat' as const, devise: 'USD', montant_ttc: 92, montant_devise: 100,
        montant_tva: null, tiers: 'Agence', date_piece: '2027-10-05' }], complete: true, motif: null,
    }
    const vide = { lignes: [], complete: true, motif: null }
    const declarer = async () => {
      const l = await lireRegimesEtEcarts(D)
      return declarationDesAchats(
        { periode: { debut: '2027-10-01', fin: '2027-10-31' }, dossier, regimes: l.regimes, aujourdHui: '2027-11-05' },
        { pieces, fiches: vide, taux: vide, textes: vide, ecarts: l.ecarts }, { rangement: 'date_de_realisation' },
      )
    }
    const d = await declarer()
    expect(d.regime).toEqual({ etat: 'confirme', regime: regime() })
    expect(d.etat).toBe('rien_a_declarer')
    expect(d.ecartees).toEqual([{ source: { genre: 'piece', id: 'p9' }, raison: 'ecartee_par_le_cabinet' }])
    faux.muetApres = { pieces_ecartees_ereporting: 0 }
    expect((await declarer()).refus.map((r) => r.cle)).toEqual(['lecture_incomplete'])
    faux.muetApres = { regimes_ereporting: 0 }
    expect((await declarer()).refus.map((r) => r.cle)).toEqual(['regimes_illisibles'])
  })
})
