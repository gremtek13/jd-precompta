import { beforeEach, describe, expect, it, vi } from 'vitest'
import { entreesDeLExercice, entreesDuDossierPermanent, refusDeRetirer } from './dossierPermanent'
import { lireLeDossierPermanent } from './dossierPermanentLecture'
import type { EntreeDossierPermanent } from './types'

// CE QUE LE DOSSIER PERMANENT LIT DE LA BASE (lib/dossierPermanentLecture.ts, ligne 41, étape R7) : les entrées du
// dossier, versions remplacées et entrées retirées comprises, EN ENTIER — ou le drapeau baissé, avec son motif. Le faux
// client APPLIQUE les filtres (src/test/filtresPostgrest.ts), comme PostgREST, et annonce le compte. Données FICTIVES.
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
const entree = (o: Partial<EntreeDossierPermanent> = {}): EntreeDossierPermanent => ({
  id: 'e1', dossier_id: D, nature: 'lettre_mission', titre: 'Lettre de mission', texte: 'Présentation des comptes.',
  piece_id: null, document_id: null, fichier_id: null, empreinte: null, valable_du: '2025-01-01', valable_jusqu_au: null,
  remplace_id: null, auteur: 'u1', cree_le: '2025-01-05T10:00:00+00:00', retire_le: null, retire_par: null, ...o,
})
// Une ligne de la table, telle que le faux client la filtre : un objet à clés quelconques.
const ligne = (x: object): Record<string, unknown> => Object.fromEntries(Object.entries(x))

// La lettre de mission et sa nouvelle version ; un bail retiré ; l'entrée d'un autre dossier.
const PREMIERE = entree()
const SECONDE = entree({ id: 'e2', remplace_id: 'e1', texte: 'Avec attestation.', cree_le: '2025-02-01T10:00:00+00:00' })
const BAIL = entree({ id: 'e3', nature: 'bail', titre: 'Bail', texte: null, piece_id: 'p1', empreinte: 'ab'.repeat(32),
  retire_le: '2025-06-01T10:00:00+00:00', retire_par: 'u1' })

beforeEach(() => {
  faux.muetApres = {}
  faux.refus = {}
  faux.ordres = []
  faux.tables = {
    dossier_permanent: [PREMIERE, BAIL, SECONDE, entree({ id: 'e-autre', dossier_id: 'd2' })].map(ligne),
  }
})

describe('lireLeDossierPermanent', () => {
  it('les entrées du dossier, versions remplacées et retirées comprises, en entier, triées sur leur clé primaire', async () => {
    const l = await lireLeDossierPermanent(D)
    expect(l).toEqual({ lignes: [PREMIERE, BAIL, SECONDE], complete: true, motif: null })
    expect(faux.ordres).toEqual(['dossier_permanent.id'])
  })

  it('une lecture partielle ou refusée garde son drapeau baissé et son motif', async () => {
    faux.muetApres = { dossier_permanent: 1 }
    const partielle = await lireLeDossierPermanent(D)
    expect(partielle.complete).toBe(false)
    expect(partielle.motif).toBe('1 ligne(s) lue(s) sur 3 annoncée(s)')
    faux.muetApres = {}
    faux.refus = { dossier_permanent: 'accès refusé' }
    const refusee = await lireLeDossierPermanent(D)
    expect(refusee.complete).toBe(false)
    expect(refusee.motif).toContain('accès refusé')
  })

  it('se branche tel quel sur le module : la version courante, le retrait dit avant le clic, la lecture partielle muette', async () => {
    const l = await lireLeDossierPermanent(D)
    const lues = entreesDuDossierPermanent(l.lignes)
    expect(lues.lisible).toBe(true)
    expect(entreesDeLExercice(lues, l.complete, 2025)?.map((e) => e.courante.id)).toEqual(['e2'])
    expect(refusDeRetirer({ p_dossier_id: D, p_entree_id: 'e1' }, { accesAuDossier: true, entrees: l.lignes })?.cle).toBe('remplacee_depuis')
    expect(refusDeRetirer({ p_dossier_id: D, p_entree_id: 'e3' }, { accesAuDossier: true, entrees: l.lignes })?.cle).toBe('deja_retiree')
    expect(refusDeRetirer({ p_dossier_id: D, p_entree_id: 'e2' }, { accesAuDossier: true, entrees: l.lignes })).toBeNull()
    faux.muetApres = { dossier_permanent: 2 }
    const partielle = await lireLeDossierPermanent(D)
    expect(entreesDeLExercice(entreesDuDossierPermanent(partielle.lignes), partielle.complete, 2025)).toBeNull()
  })
})
