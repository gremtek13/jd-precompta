import { beforeEach, describe, expect, it, vi } from 'vitest'
import { INVENTAIRE_EXPORTE } from './inventaire'
import {
  COLONNES_DES_FACTURES_A_CITER, COLONNES_DES_PIECES_A_CITER, lireLesJustificatifsDuDossier, lireLesJustificatifsDuDossierSelon,
} from './justificatifsDeLInventaireLecture'

// LA LECTURE DES PIÈCES À CITER DE L'ONGLET INVENTAIRE (ligne 35, INV5-Q1 ; lib/justificatifsDeLInventaireLecture.ts). Ce que
// ces cas gardent : drapeau baissé, AUCUN appel ; levé, les pièces et les factures validées DU dossier demandé, leurs colonnes
// nommées, lues jusqu'au bout de ce que la base annonce sous un tri terminé par la clé primaire ; une lecture en partie,
// refusée, qui lève, d'un autre dossier ou une ligne illisible se dit (un motif), jamais une liste vide. Des données FICTIVES.

const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  mode: 'entier' as 'entier' | 'muet' | 'refus' | 'leve',
  sansFiltre: false,
  demandes: [] as { table: string; colonnes: string; eq: [string, unknown][]; tri: string[] }[],
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        const predicats: ((l: Record<string, unknown>) => boolean)[] = []
        const demande = { table, colonnes: '', eq: [] as [string, unknown][], tri: [] as string[] }
        faux.demandes.push(demande)
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const c: Record<string, unknown> = {}
        const executer = () => {
          if (faux.mode === 'leve') return Promise.reject(new Error('réseau coupé'))
          if (faux.mode === 'refus' && table === 'factures_emises') return Promise.resolve({ data: null, error: { message: 'accès refusé' }, count: null })
          const toutes = filtrer(faux.tables[table] ?? [], faux.sansFiltre ? [] : predicats)
            .sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0))
          // « muet » : la base annonce tout, mais n'en rend jamais qu'une ligne (un plafond qu'elle ne dit pas).
          const jusqua = faux.mode === 'muet' && table === 'pieces' ? Math.min(fin + 1, 1) : fin + 1
          return Promise.resolve({ data: toutes.slice(debut, jusqua), error: null, count: toutes.length })
        }
        Object.assign(c, {
          select: (colonnes: string) => { demande.colonnes = colonnes; return c },
          eq: (colonne: string, valeur: unknown) => { demande.eq.push([colonne, valeur]); predicats.push(predicatEq(colonne, valeur)); return c },
          order: (colonne: string) => { demande.tri.push(colonne); return c },
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => executer().then(suite, echec),
        })
        return c
      },
    },
  }
})

const piece = (id: string, dossier: string, o: Record<string, unknown> = {}) => ({
  id, dossier_id: dossier, nom_fichier: `${id}.pdf`, date_piece: '2025-12-15', tiers: null, montant_ttc: 100, type_piece: 'achat', statut: 'validee', ...o,
})
const facture = (id: string, dossier: string, o: Record<string, unknown> = {}) => ({
  id, dossier_id: dossier, numero: 'F1', statut: 'validee', type: 'facture', date_emission: '2025-10-01', tiers_nom: 'Client fictif', montant_ttc: 300, ...o,
})

beforeEach(() => {
  faux.mode = 'entier'
  faux.sansFiltre = false
  faux.demandes = []
  faux.tables = {
    pieces: [piece('p2', 'd1'), piece('p1', 'd1', { statut: 'a_valider', date_piece: null }), piece('px', 'd2')],
    factures_emises: [facture('f1', 'd1'), facture('f0', 'd1', { statut: 'brouillon', numero: null }), facture('fx', 'd2')],
  }
})

describe('lireLesJustificatifsDuDossier', () => {
  it('drapeau baissé : « absente », aucun appel au réseau', async () => {
    expect(INVENTAIRE_EXPORTE).toBe(false)
    expect(await lireLesJustificatifsDuDossier('d1')).toEqual({ dossierId: 'd1', etat: 'absente' })
    expect(await lireLesJustificatifsDuDossierSelon('d1', false)).toEqual({ dossierId: 'd1', etat: 'absente' })
    expect(faux.demandes).toEqual([])
  })

  it('levé : les pièces et les factures validées de CE dossier, leurs colonnes nommées, triées par la clé primaire', async () => {
    const lue = await lireLesJustificatifsDuDossierSelon('d1', true)
    if (lue.etat !== 'lue') throw new Error(JSON.stringify(lue))
    expect(lue.justificatifs.pieces.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(lue.justificatifs.factures.map((f) => f.id)).toEqual(['f1'])
    expect(faux.demandes.map((d) => [d.table, d.colonnes, d.eq, d.tri])).toEqual([
      ['pieces', COLONNES_DES_PIECES_A_CITER, [['dossier_id', 'd1']], ['id']],
      ['factures_emises', COLONNES_DES_FACTURES_A_CITER, [['dossier_id', 'd1'], ['statut', 'validee']], ['id']],
    ])
  })

  it('lue jusqu’au bout de ce que la base annonce, par tranches', async () => {
    faux.tables.pieces = Array.from({ length: 1203 }, (_, i) => piece(`p${String(i).padStart(4, '0')}`, 'd1'))
    const lue = await lireLesJustificatifsDuDossierSelon('d1', true)
    if (lue.etat !== 'lue') throw new Error('lecture attendue')
    expect(lue.justificatifs.pieces).toHaveLength(1203)
  })

  it('en partie, refusée, ou qui lève : un motif, jamais une liste vide', async () => {
    faux.mode = 'muet'
    expect(await lireLesJustificatifsDuDossierSelon('d1', true)).toMatchObject({ etat: 'incomplete', motif: expect.stringContaining('les pièces') })
    faux.mode = 'refus'
    expect(await lireLesJustificatifsDuDossierSelon('d1', true)).toMatchObject({ etat: 'incomplete', motif: expect.stringContaining('les factures émises') })
    faux.mode = 'leve'
    expect(await lireLesJustificatifsDuDossierSelon('d1', true)).toMatchObject({ dossierId: 'd1', etat: 'incomplete' })
  })

  it('une ligne d’un autre dossier, ou qu’on ne croirait pas, rend la lecture incomplète', async () => {
    faux.sansFiltre = true
    expect(await lireLesJustificatifsDuDossierSelon('d1', true)).toMatchObject({ etat: 'incomplete', motif: expect.stringContaining('pas de ce dossier') })
    faux.sansFiltre = false
    faux.tables.pieces = [piece('p1', 'd1', { type_piece: 'stock' })]
    expect(await lireLesJustificatifsDuDossierSelon('d1', true)).toMatchObject({ etat: 'incomplete', motif: 'une pièce ou une facture lue ne se croit pas' })
    faux.tables.pieces = [piece('p1', 'd1', { montant_ttc: 'cent' })]
    expect(await lireLesJustificatifsDuDossierSelon('d1', true)).toMatchObject({ etat: 'incomplete' })
    faux.tables.pieces = [piece('p1', 'd1')]
    faux.tables.factures_emises = [facture('f1', 'd1', { tiers_nom: null })]
    expect(await lireLesJustificatifsDuDossierSelon('d1', true)).toMatchObject({ etat: 'incomplete' })
  })
})
