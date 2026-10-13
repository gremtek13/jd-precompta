import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lirePiecesJointesEcartees } from './piecesJointesEcarteesLecture'
import { rangerLesEcarts, refusDeMarquerVues } from './piecesJointesEcartees'
import type { PieceJointeEcartee } from './types'

// CE QUE L'ONGLET JUSTIFICATIFS LIT DES PIÈCES JOINTES ÉCARTÉES (lib/piecesJointesEcarteesLecture.ts, ligne 22.7) : celles du
// dossier, vues comprises, EN ENTIER — ou le drapeau baissé, avec son motif, y compris quand la requête LÈVE. Le faux client
// APPLIQUE les filtres (src/test/filtresPostgrest.ts), comme PostgREST, et annonce le compte. Données FICTIVES.
const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  // Lecture partielle : la table cesse de rendre des lignes au-delà de ce rang, en annonçant le vrai total.
  muetApres: {} as Record<string, number>,
  refus: {} as Record<string, string>,
  leve: false,
  ordres: [] as string[],
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        if (faux.leve) throw new Error('réseau coupé')
        if (!(table in faux.tables)) throw new Error(`Table non attendue dans ce test : ${table}`)
        const predicats: ((l: Record<string, unknown>) => boolean)[] = []
        const q: Record<string, unknown> = {
          select: (liste: string, options: { count?: string }) => {
            if (liste !== '*' || options.count !== 'exact') throw new Error(`Sélection inattendue : ${liste}`)
            return q
          },
          eq: (c: string, v: unknown) => { predicats.push(predicatEq(c, v)); return q },
          order: (c: string, o?: { ascending?: boolean }) => { faux.ordres.push(`${c}${o?.ascending === false ? ' desc' : ''}`); return q },
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
const ecart = (o: Partial<PieceJointeEcartee> = {}): PieceJointeEcartee => ({
  id: 'x1', dossier_id: D, recue_le: '2026-10-12T12:03:00+00:00', raison: 'format', octets: 4120, empreinte: 'a'.repeat(64),
  vue_le: null, vue_par: null, ...o,
})
const ligne = (x: object): Record<string, unknown> => Object.fromEntries(Object.entries(x))

const FORMAT = ecart()
const LOURDE = ecart({ id: 'x2', raison: 'taille', octets: 26_214_400, empreinte: 'b'.repeat(64), recue_le: '2026-10-11T08:00:00+00:00' })
const VUE = ecart({ id: 'x3', empreinte: 'c'.repeat(64), recue_le: '2026-09-01T08:00:00+00:00', vue_le: '2026-09-02T09:00:00+00:00', vue_par: 'u1' })

beforeEach(() => {
  faux.muetApres = {}
  faux.refus = {}
  faux.leve = false
  faux.ordres = []
  faux.tables = { pieces_jointes_ecartees: [FORMAT, LOURDE, VUE, ecart({ id: 'x-autre', dossier_id: 'd2' })].map(ligne) }
})

describe('lirePiecesJointesEcartees', () => {
  it('celles du dossier, vues comprises, en entier, sous un tri total (l’instant, puis la clé primaire)', async () => {
    const l = await lirePiecesJointesEcartees(D)
    expect(l).toEqual({ lignes: [FORMAT, LOURDE, VUE], complete: true, motif: null })
    expect(faux.ordres).toEqual(['recue_le desc', 'id'])
  })

  it('une lecture partielle ou refusée garde son drapeau baissé et son motif — et rien ne se marque', async () => {
    faux.muetApres = { pieces_jointes_ecartees: 1 }
    const partielle = await lirePiecesJointesEcartees(D)
    expect(partielle.complete).toBe(false)
    expect(partielle.motif).toBe('1 ligne(s) lue(s) sur 3 annoncée(s)')
    expect(refusDeMarquerVues({ dossierId: D, lecture: partielle, ids: ['x1'] })).toMatch(/n’a pas été lue en entier/)
    faux.muetApres = {}
    faux.refus = { pieces_jointes_ecartees: 'permission denied for table pieces_jointes_ecartees' }
    const refusee = await lirePiecesJointesEcartees(D)
    expect(refusee.complete).toBe(false)
    expect(refusee.motif).toContain('permission denied')
  })

  it('une requête qui lève tombe du côté signalé : jamais une liste vide qu’on prendrait pour « rien d’écarté »', async () => {
    faux.leve = true
    const l = await lirePiecesJointesEcartees(D)
    expect(l).toEqual({ lignes: [], complete: false, motif: 'lecture impossible : réseau coupé' })
  })

  it('se branche tel quel sur le module : à signaler, déjà vues, et le geste sur les seules non vues', async () => {
    const l = await lirePiecesJointesEcartees(D)
    const { aSignaler, dejaVues } = rangerLesEcarts(D, l.lignes)
    expect(aSignaler.map((e) => e.id)).toEqual(['x1', 'x2'])
    expect(dejaVues.map((e) => e.id)).toEqual(['x3'])
    expect(refusDeMarquerVues({ dossierId: D, lecture: l, ids: aSignaler.map((e) => e.id) })).toBeNull()
  })
})
