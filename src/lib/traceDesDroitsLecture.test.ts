import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lireLaTraceDuDossier } from './traceDesDroitsLecture'

// LA LECTURE DE LA TRACE DES DROITS D'UN DOSSIER (étape P1-trace). Ce que ces cas gardent : les lignes DU DOSSIER demandé et
// d'aucun autre, lues jusqu'au bout de ce que la base annonce (`lireTout`), sous un tri total terminé par la clé primaire ;
// une lecture en partie, refusée ou qui LÈVE se dit (un motif), jamais une trace vide qui ferait croire qu'aucun droit n'a
// changé ; la lecture rend le dossier qu'elle a lu.

const faux = vi.hoisted(() => ({
  lignes: [] as Record<string, unknown>[],
  mode: 'entier' as 'entier' | 'muet' | 'refus' | 'leve',
  muetApres: 1,
  demandes: [] as { table: string; colonnes: string; dossier: unknown; tri: { colonne: string; options: unknown }[] }[],
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        const predicats: ((l: Record<string, unknown>) => boolean)[] = []
        const demande = { table, colonnes: '', dossier: null as unknown, tri: [] as { colonne: string; options: unknown }[] }
        faux.demandes.push(demande)
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: (colonnes: string) => { demande.colonnes = colonnes; return c },
          eq: (colonne: string, valeur: unknown) => { demande.dossier = valeur; predicats.push(predicatEq(colonne, valeur)); return c },
          order: (colonne: string, options?: unknown) => { demande.tri.push({ colonne, options }); return c },
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
            if (faux.mode === 'leve') return Promise.reject(new Error('réseau coupé')).then(suite, echec)
            if (faux.mode === 'refus') return Promise.resolve({ data: null, error: { message: 'accès refusé' }, count: null }).then(suite, echec)
            const toutes = filtrer(faux.lignes, predicats)
            const jusqua = faux.mode === 'muet' ? Math.min(fin + 1, faux.muetApres) : fin + 1
            return Promise.resolve({ data: toutes.slice(debut, jusqua), error: null, count: toutes.length }).then(suite, echec)
          },
        })
        return c
      },
    },
  }
})

const trace = (id: string, dossier: string, o: Record<string, unknown> = {}) => ({
  id, dossier_id: dossier, acces_id: 'm1', client_id: 'u-client', droit: 'ventes', coche: true, geste: 'changement',
  auteur_id: 'u-cabinet', fait_le: '2026-11-08T09:12:00Z', ...o,
})

beforeEach(() => {
  faux.mode = 'entier'
  faux.demandes = []
  faux.lignes = [trace('t1', 'd1'), trace('t2', 'd1', { fait_le: '2026-11-09T09:00:00Z' }), trace('t3', 'd2')]
})

describe('lireLaTraceDuDossier', () => {
  it('rend les lignes de CE dossier, lues en entier, les plus récentes d’abord, et le dossier lu', async () => {
    const lue = await lireLaTraceDuDossier('d1')
    expect(lue.dossierId).toBe('d1')
    expect(lue.motif).toBeNull()
    expect(lue.lignes.map((l) => l.id)).toEqual(['t2', 't1'])
  })

  it('un dossier sans trace : une lecture entière, vide — le seul cas où le vide se dit', async () => {
    expect(await lireLaTraceDuDossier('d3')).toEqual({ dossierId: 'd3', lignes: [], motif: null })
  })

  it('demande la table de la trace, ses colonnes énumérées (aucune étoile), le dossier, un tri total terminé par la clé primaire', async () => {
    await lireLaTraceDuDossier('d1')
    const demande = faux.demandes[0]
    expect(demande.table).toBe('trace_des_droits')
    expect(demande.colonnes).toBe('id, dossier_id, acces_id, client_id, droit, coche, geste, auteur_id, fait_le')
    expect(demande.dossier).toBe('d1')
    expect(demande.tri).toEqual([{ colonne: 'fait_le', options: { ascending: false } }, { colonne: 'id', options: undefined }])
  })

  it('en partie : les lignes lues restent, le motif dit qu’il en manque', async () => {
    faux.mode = 'muet'
    const lue = await lireLaTraceDuDossier('d1')
    expect(lue.lignes).toHaveLength(1)
    expect(lue.motif).toContain('1')
  })

  it('refusée : aucune ligne, le motif de la base', async () => {
    faux.mode = 'refus'
    const lue = await lireLaTraceDuDossier('d1')
    expect(lue.lignes).toEqual([])
    expect(lue.motif).toContain('accès refusé')
  })

  it('une requête qui lève tombe du côté signalé, jamais une trace vide', async () => {
    faux.mode = 'leve'
    expect(await lireLaTraceDuDossier('d1')).toEqual({ dossierId: 'd1', lignes: [], motif: 'réseau coupé' })
  })

  it('une ligne aux mots inconnus rend la lecture partielle, même lue en entier', async () => {
    faux.lignes = [trace('t1', 'd1'), trace('t2', 'd1', { droit: 'inconnu' })]
    const lue = await lireLaTraceDuDossier('d1')
    expect(lue.lignes.map((l) => l.id)).toEqual(['t1'])
    expect(lue.motif).toContain('ne connaît pas')
  })
})
