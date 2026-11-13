import { beforeEach, describe, expect, it, vi } from 'vitest'
import { INVENTAIRE_EXPORTE } from './inventaire'
import { COLONNES_DE_LA_BALANCE, lireLaBalanceRepriseDuDossier, lireLaBalanceRepriseDuDossierSelon } from './balanceRepriseDeLInventaireLecture'

// LA LECTURE DE LA BALANCE REPRISE DE L'ONGLET INVENTAIRE (ligne 35, INV3-Q2 (A) ; lib/balanceRepriseDeLInventaireLecture.ts). Ce
// que ces cas gardent : drapeau baissé, AUCUN appel ; levé, toutes les lignes DU dossier demandé, ses colonnes nommées, lues
// jusqu'au bout de ce que la base annonce sous un tri terminé par la clé primaire ; une lecture en partie, refusée, qui lève, d'un
// autre dossier ou une ligne illisible se dit (un motif), jamais une balance vide. Des données FICTIVES.

const faux = vi.hoisted(() => ({
  lignes: [] as Record<string, unknown>[],
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
          if (faux.mode === 'refus') return Promise.resolve({ data: null, error: { message: 'accès refusé' }, count: null })
          const toutes = filtrer(faux.lignes, faux.sansFiltre ? [] : predicats)
            .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)))
          // « muet » : la base annonce tout, mais n'en rend jamais qu'une ligne (un plafond qu'elle ne dit pas).
          const jusqua = faux.mode === 'muet' ? Math.min(fin + 1, 1) : fin + 1
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

const ligne = (id: string, dossier: string, o: Record<string, unknown> = {}) => ({
  id, dossier_id: dossier, date: '2025-01-01', compte: '486200', sens: 'debit', montant: 300, ...o,
})

beforeEach(() => {
  faux.mode = 'entier'
  faux.sansFiltre = false
  faux.demandes = []
  faux.lignes = [ligne('a2', 'd1', { compte: '408200', sens: 'credit', montant: 120 }), ligne('a1', 'd1'), ligne('ax', 'd2')]
})

describe('lireLaBalanceRepriseDuDossier', () => {
  it('drapeau baissé : « absente », aucun appel au réseau', async () => {
    expect(INVENTAIRE_EXPORTE).toBe(false)
    expect(await lireLaBalanceRepriseDuDossier('d1')).toEqual({ dossierId: 'd1', etat: 'absente' })
    expect(await lireLaBalanceRepriseDuDossierSelon('d1', false)).toEqual({ dossierId: 'd1', etat: 'absente' })
    expect(faux.demandes).toEqual([])
  })

  it('levé : les lignes de CE dossier, ses colonnes nommées, triées jusqu’à la clé primaire', async () => {
    const lue = await lireLaBalanceRepriseDuDossierSelon('d1', true)
    expect(lue).toEqual({
      dossierId: 'd1', etat: 'lue',
      lignes: [
        { date: '2025-01-01', compte: '486200', sens: 'debit', montant: 300 },
        { date: '2025-01-01', compte: '408200', sens: 'credit', montant: 120 },
      ],
    })
    expect(faux.demandes[0]).toMatchObject({ table: 'a_nouveaux', colonnes: COLONNES_DE_LA_BALANCE, eq: [['dossier_id', 'd1']], tri: ['date', 'id'] })
  })

  it('une lecture en partie, refusée ou qui lève se dit, jamais une balance vide', async () => {
    faux.mode = 'muet'
    expect(await lireLaBalanceRepriseDuDossierSelon('d1', true)).toMatchObject({ dossierId: 'd1', etat: 'incomplete', motif: expect.stringContaining('la balance reprise') })
    faux.mode = 'refus'
    expect(await lireLaBalanceRepriseDuDossierSelon('d1', true)).toMatchObject({ etat: 'incomplete', motif: expect.stringContaining('accès refusé') })
    faux.mode = 'leve'
    expect(await lireLaBalanceRepriseDuDossierSelon('d1', true)).toMatchObject({ etat: 'incomplete', motif: expect.stringContaining('réseau coupé') })
  })

  it('une ligne d’un autre dossier, ou illisible, se dit', async () => {
    faux.sansFiltre = true
    expect(await lireLaBalanceRepriseDuDossierSelon('d1', true)).toMatchObject({ etat: 'incomplete', motif: expect.stringContaining('pas de ce dossier') })
    faux.sansFiltre = false
    faux.lignes = [ligne('a1', 'd1', { montant: '300' })]
    expect(await lireLaBalanceRepriseDuDossierSelon('d1', true)).toMatchObject({ etat: 'incomplete', motif: expect.stringContaining('ne se croit pas') })
    faux.lignes = [ligne('a1', 'd1', { sens: 'autre' })]
    expect(await lireLaBalanceRepriseDuDossierSelon('d1', true)).toMatchObject({ etat: 'incomplete' })
  })
})
