import { beforeEach, describe, expect, it, vi } from 'vitest'
import { declarationActive, declarationQuiRetientLaPiece } from './declarationsEreporting'
import { lireDeclarationsEreporting } from './declarationsEreportingLecture'
import type { DeclarationEreportingHorsApplication, SourceDeclarationEreporting } from './types'

// CE QUE L'E-REPORTING LIT DE SES DÉCLARATIONS DEPUIS L'ÉTAPE e5b1 (lib/declarationsEreportingLecture.ts) : les
// déclarations du dossier et leurs sources, remplacées comprises, chacune EN ENTIER — ou son drapeau baissé, avec son
// motif. Le faux client APPLIQUE les filtres (src/test/filtresPostgrest.ts), comme PostgREST, et annonce le compte.
// Données FICTIVES.
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
// Les achats de septembre 2027 d'un dossier : l'initiale, remplacée par une rectificative ; les déclarations d'un autre.
const declaration = (o: Partial<DeclarationEreportingHorsApplication> = {}): DeclarationEreportingHorsApplication => ({
  id: 'dr', dossier_id: D, objet: 'achats', periode_debut: '2027-09-01', periode_fin: '2027-09-30', regime_id: 'r1',
  type_transmission: 'RE', remplace_id: 'di', canal: 'manuel', plateforme: 'Plateforme fictive',
  contenu: { version: 1, objet: 'achats' }, empreinte: 'a'.repeat(64), nb_operations: 2, etat: 'declaree', note: null,
  cree_par: 'u1', cree_le: '2027-10-05T10:00:00Z', ...o,
})
const INITIALE = declaration({ id: 'di', type_transmission: 'IN', remplace_id: null, nb_operations: 1, etat: 'remplacee', cree_le: '2027-10-02T10:00:00Z' })
const RECTIFICATIVE = declaration()
const source = (o: Partial<SourceDeclarationEreporting> = {}): SourceDeclarationEreporting =>
  ({ declaration_id: 'dr', dossier_id: D, genre: 'fiche', source_id: 'f1', ...o })
// Une ligne de la table, telle que le faux client la filtre : un objet à clés quelconques.
const ligne = (x: object): Record<string, unknown> => Object.fromEntries(Object.entries(x))

beforeEach(() => {
  faux.muetApres = {}
  faux.refus = {}
  faux.ordres = []
  faux.tables = {
    declarations_ereporting: [RECTIFICATIVE, INITIALE, declaration({ id: 'dx', dossier_id: 'd2', remplace_id: null, type_transmission: 'IN' })].map(ligne),
    declarations_ereporting_sources: [
      source(), source({ source_id: 'f2' }), source({ declaration_id: 'di' }), source({ declaration_id: 'dx', dossier_id: 'd2', source_id: 'fx' }),
    ].map(ligne),
  }
})

describe('lireDeclarationsEreporting', () => {
  it('les déclarations et les sources du dossier, remplacées comprises, en entier, triées sur leur clé primaire', async () => {
    const l = await lireDeclarationsEreporting(D)
    expect(l.declarations).toEqual({ lignes: [RECTIFICATIVE, INITIALE], complete: true, motif: null })
    expect(l.sources.lignes).toEqual([source(), source({ source_id: 'f2' }), source({ declaration_id: 'di' })])
    expect(l.sources.complete).toBe(true)
    expect(l.motif).toBeNull()
    expect(faux.ordres.sort()).toEqual([
      'declarations_ereporting.id', 'declarations_ereporting_sources.declaration_id', 'declarations_ereporting_sources.genre',
      'declarations_ereporting_sources.source_id',
    ])
  })

  it('une lecture partielle ou refusée garde son drapeau baissé et son motif, chacune pour elle, et le motif d’ensemble le dit', async () => {
    faux.muetApres = { declarations_ereporting_sources: 1 }
    const partielle = await lireDeclarationsEreporting(D)
    expect(partielle.declarations.complete).toBe(true)
    expect(partielle.sources.complete).toBe(false)
    expect(partielle.sources.motif).toBe('1 ligne(s) lue(s) sur 3 annoncée(s)')
    expect(partielle.motif).toBe('1 ligne(s) lue(s) sur 3 annoncée(s)')
    faux.muetApres = {}
    faux.refus = { declarations_ereporting: 'accès refusé' }
    const refusee = await lireDeclarationsEreporting(D)
    expect(refusee.declarations.complete).toBe(false)
    expect(refusee.declarations.motif).toContain('accès refusé')
    expect(refusee.sources.complete).toBe(true)
    expect(refusee.motif).toContain('accès refusé')
  })

  it('se branche tel quel sur le module : l’active de la période, la pièce que la déclaration retient', async () => {
    const l = await lireDeclarationsEreporting(D)
    expect(declarationActive(l.declarations.lignes, D, 'achats', { debut: '2027-09-01', fin: '2027-09-30' })?.id).toBe('dr')
    const fiches = [{ id: 'f1', dossier_id: D, piece_id: 'p1' }, { id: 'f9', dossier_id: D, piece_id: 'p9' }]
    expect(declarationQuiRetientLaPiece('p1', { fiches, declarations: l.declarations.lignes, sources: l.sources.lignes })?.declaration.id).toBe('dr')
    expect(declarationQuiRetientLaPiece('p9', { fiches, declarations: l.declarations.lignes, sources: l.sources.lignes })).toBeNull()
  })
})
