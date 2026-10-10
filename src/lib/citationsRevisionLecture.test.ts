import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lireCitationsDeLaRevision, refusDeSuppression } from './citationsRevisionLecture'

// La lecture de ce que la révision cite : les décisions et les preuves du dossier, en entier, et la phrase de la base pour
// la suppression d'une source citée. Le faux client APPLIQUE le filtre du dossier et annonce son compte.

const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  refusees: new Set<string>(),
  colonnes: {} as Record<string, string>,
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq } = await import('../test/filtresPostgrest')
  function chaine(table: string) {
    const predicats: ReturnType<typeof predicatEq>[] = []
    let debut = 0
    let fin = Number.MAX_SAFE_INTEGER
    const c: Record<string, unknown> = {}
    Object.assign(c, {
      select: (colonnes: string) => { faux.colonnes[table] = colonnes; return c },
      eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); return c },
      order: () => c,
      range: (d: number, f: number) => { debut = d; fin = f; return c },
      then: (suite: (r: unknown) => unknown) => {
        if (faux.refusees.has(table)) return Promise.resolve({ data: null, error: { message: 'permission denied' }, count: null }).then(suite)
        const lignes = filtrer(faux.tables[table] ?? [], predicats)
        return Promise.resolve({ data: lignes.slice(debut, fin + 1), error: null, count: lignes.length }).then(suite)
      },
    })
    return c
  }
  return { supabase: { from: (table: string) => chaine(table) } }
})

beforeEach(() => {
  faux.tables = {
    revision_justifications: [
      { id: 'j1', dossier_id: 'd1', annee: 2025, compte: '512000' },
      { id: 'j9', dossier_id: 'd2', annee: 2024, compte: '164000' },
    ],
    revision_preuves: [
      { id: 'rp1', dossier_id: 'd1', justification_id: 'j1', piece_id: null, document_id: 'doc-1' },
      { id: 'rp9', dossier_id: 'd2', justification_id: 'j9', piece_id: 'p-9', document_id: null },
    ],
  }
  faux.refusees = new Set()
  faux.colonnes = {}
})

describe('lireCitationsDeLaRevision', () => {
  it('lit les décisions et les preuves du dossier seul, sans aucun texte saisi', async () => {
    const lues = await lireCitationsDeLaRevision('d1')
    expect(lues.motif).toBeNull()
    expect(lues.decisions.map((d) => d.id)).toEqual(['j1'])
    expect(lues.preuves.map((p) => p.document_id)).toEqual(['doc-1'])
    // Ni motif, ni précision : ce qui décide d'un refus, rien d'autre.
    expect(faux.colonnes.revision_justifications).toBe('id, annee, compte')
    expect(faux.colonnes.revision_preuves).toBe('id, justification_id, piece_id, document_id')
  })

  it('une lecture refusée se dit par son motif', async () => {
    faux.refusees.add('revision_preuves')
    const lues = await lireCitationsDeLaRevision('d1')
    expect(lues.motif).toMatch(/permission denied/)
  })
})

describe('refusDeSuppression', () => {
  it('dit la phrase de la base pour une source citée, rien pour une autre', async () => {
    const lues = await lireCitationsDeLaRevision('d1')
    expect(refusDeSuppression({ documentId: 'doc-1' }, lues))
      .toBe('Ce document est cité par la révision du solde du compte 512000 (exercice 2025) : il ne se supprime plus, sauf avec son dossier.')
    expect(refusDeSuppression({ documentId: 'doc-2' }, lues)).toBeNull()
    expect(refusDeSuppression({ pieceId: 'doc-1' }, lues)).toBeNull()
  })

  it('ne dit rien avant la première lecture : la base reste juge', () => {
    expect(refusDeSuppression({ pieceId: 'p-9' }, null)).toBeNull()
  })
})
