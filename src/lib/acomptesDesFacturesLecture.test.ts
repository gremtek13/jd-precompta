import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lireLesAcomptesDesFactures } from './acomptesDesFacturesLecture'

// LA LECTURE DES ACOMPTES DES FACTURES (lib/acomptesDesFacturesLecture.ts, étape P5b5b), devant un faux client qui APPLIQUE les
// filtres et annonce un compte. Ce que ces cas gardent : drapeau baissé, rien n'est lu ; levé, les devis liés, la date du
// versement des acomptes et les lignes des finales et de leurs avoirs ; une lecture refusée ou une valeur d'une autre forme
// rend la lecture ILLISIBLE, jamais « pas d'acompte ». Données FICTIVES.

const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  lectures: [] as string[],
  refusee: null as string | null,
  acomptes: true,
}))

vi.mock('./devis', async (original) => ({
  ...(await original<typeof import('./devis')>()),
  get ACOMPTES_PREVUS() { return faux.acomptes },
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq, predicatIn } = await import('../test/filtresPostgrest')
  type Predicat = (ligne: Record<string, unknown>) => boolean
  return {
    supabase: {
      from: (table: string) => {
        const predicats: Predicat[] = []
        let liste = '*'
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const partir = () => {
          faux.lectures.push(table)
          if (faux.refusee === table) return { data: null, error: { message: 'permission denied' }, count: null }
          const colonnes = liste.split(',').map((x) => x.trim())
          const toutes = filtrer(faux.tables[table] ?? [], predicats)
          return { data: toutes.slice(debut, fin + 1).map((l) => Object.fromEntries(colonnes.map((k) => [k, l[k]]))), error: null, count: toutes.length }
        }
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: (l: string) => { liste = l; return c },
          eq: (k: string, v: unknown) => { predicats.push(predicatEq(k, v)); return c },
          in: (k: string, v: unknown[]) => { predicats.push(predicatIn(k, v)); return c },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          maybeSingle: () => Promise.resolve().then(partir).then((r) => ({ data: r.data?.[0] ?? null, error: r.error })),
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => Promise.resolve().then(partir).then(suite, echec),
        })
        return c
      },
    },
  }
})

const facture = (id: string, p: Record<string, unknown> = {}) => ({
  id, dossier_id: 'd1', numero: null, statut: 'validee', type: 'facture', date_emission: '2026-10-10', montant_ttc: 360, acompte: false,
  facture_origine_id: null, date_versement_acompte: null, ...p,
})
const ligne = (id: string, factureId: string, p: Record<string, unknown> = {}) => ({
  id, facture_id: factureId, ordre: 0, quantite: 1, prix_unitaire_ht: 300, taux_tva: 20, nature: null, reprise_facture_id: null, ...p,
})

beforeEach(() => {
  faux.acomptes = true
  faux.lectures = []
  faux.refusee = null
  faux.tables = {
    dossiers: [{ id: 'd1', mode_comptable: 'tresorerie' }],
    devis: [{ id: 'dv1', dossier_id: 'd1', numero: 'D2026-0001', lignes: [{ designation: 'Mission', quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20 }] }],
    devis_factures: [
      { id: 'l1', dossier_id: 'd1', devis_id: 'dv1', facture_id: 'fa1', cree_le: '2026-10-10T08:00:00Z', role: 'acompte' },
      { id: 'l2', dossier_id: 'd1', devis_id: 'dv1', facture_id: 'ff1', cree_le: '2026-10-20T08:00:00Z', role: 'finale' },
    ],
    factures_emises: [
      facture('fa1', { numero: 'F2026-0010', acompte: true, date_versement_acompte: '2026-10-05' }),
      facture('ff1', { statut: 'brouillon', montant_ttc: 840 }),
      facture('av1', { type: 'avoir', facture_origine_id: 'ff1', montant_ttc: -840 }),
    ],
    facture_lignes: [
      ligne('la1', 'fa1'), ligne('lf1', 'ff1', { prix_unitaire_ht: 1000 }), ligne('lf2', 'ff1', { ordre: 1, quantite: -1, reprise_facture_id: 'fa1' }),
      ligne('lv1', 'av1', { quantite: 1, reprise_facture_id: 'fa1' }),
    ],
  }
})

describe('la lecture des acomptes des factures', () => {
  it('le drapeau baissé : rien n’est lu', async () => {
    faux.acomptes = false
    expect(await lireLesAcomptesDesFactures('d1')).toEqual({ dossierId: 'd1', etat: 'sans' })
    expect(faux.lectures).toEqual([])
  })

  it('levé : les devis liés, la date du versement, les lignes des finales et de leurs avoirs', async () => {
    const lu = await lireLesAcomptesDesFactures('d1')
    if (lu.etat !== 'lue') throw new Error(`lecture ${lu.etat}`)
    expect(lu.devis).toEqual([{ id: 'dv1', numero: 'D2026-0001', lignes: [{ designation: 'Mission', quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20 }] }])
    expect(lu.versements).toEqual([{ facture_id: 'fa1', date_versement_acompte: '2026-10-05' }])
    expect(lu.lignesDesFinales.map((l) => [l.facture_id, l.reprise_facture_id])).toEqual([['ff1', null], ['ff1', 'fa1'], ['av1', 'fa1']])
  })

  it('une lecture refusée, ou une reprise d’une autre forme : illisible, avec son motif', async () => {
    faux.refusee = 'devis'
    expect((await lireLesAcomptesDesFactures('d1')).etat).toBe('illisible')
    faux.refusee = null
    faux.tables.facture_lignes[2].reprise_facture_id = 42
    const lu = await lireLesAcomptesDesFactures('d1')
    expect(lu).toEqual({ dossierId: 'd1', etat: 'illisible', motif: 'une ligne d’une facture finale n’a pas pu être lue' })
  })
})
