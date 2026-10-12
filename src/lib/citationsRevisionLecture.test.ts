import { beforeEach, describe, expect, it, vi } from 'vitest'
import { citantDe, lireCitationsDeLaRevision, quiCite, refusDeSuppression } from './citationsRevisionLecture'

// La lecture de ce que la révision cite : les décisions et les preuves du dossier, et les entrées du dossier permanent
// (ligne 41, étape R7), en entier, et la phrase de la base pour la suppression d'une source citée. Le faux client APPLIQUE le filtre du dossier et annonce son compte.

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
    dossier_permanent: [
      { id: 'e1', dossier_id: 'd1', nature: 'bail', titre: 'Titre à ne pas dire', texte: 'Texte à ne pas dire', piece_id: 'p-1', document_id: null },
      { id: 'e2', dossier_id: 'd1', nature: 'lettre_mission', titre: 'Autre', texte: null, piece_id: 'p-1', document_id: null },
      { id: 'e9', dossier_id: 'd2', nature: 'statuts', titre: 'Ailleurs', texte: null, piece_id: null, document_id: 'doc-9' },
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

  it('lit les entrées du dossier permanent du dossier seul, et ne garde ni titre ni texte', async () => {
    const lues = await lireCitationsDeLaRevision('d1')
    expect(lues.entrees).toEqual([
      { nature: 'bail', piece_id: 'p-1', document_id: null },
      { nature: 'lettre_mission', piece_id: 'p-1', document_id: null },
    ])
    expect(lues.motifDossierPermanent).toBeNull()
  })

  it('une lecture refusée se dit par son motif', async () => {
    faux.refusees.add('revision_preuves')
    const lues = await lireCitationsDeLaRevision('d1')
    expect(lues.motif).toMatch(/permission denied/)
    expect(lues.motifRevision).toMatch(/permission denied/)
    expect(lues.motifDossierPermanent).toBeNull()
  })

  it('le dossier permanent refusé se dit à part, la révision garde son motif vide', async () => {
    faux.refusees.add('dossier_permanent')
    const lues = await lireCitationsDeLaRevision('d1')
    expect(lues.motif).toMatch(/permission denied/)
    expect(lues.motifDossierPermanent).toMatch(/permission denied/)
    expect(lues.motifRevision).toBeNull()
    // Ce que la révision d'un solde cite se dit encore ; le dossier permanent, non lu, ne dit rien.
    expect(refusDeSuppression({ documentId: 'doc-1' }, lues)).toMatch(/révision du solde du compte 512000/)
    expect(refusDeSuppression({ pieceId: 'p-1' }, lues)).toBeNull()
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

  it('dit le dossier permanent par la NATURE de l\u2019entrée, la première dans l\u2019ordre de A9, sans jamais le titre', async () => {
    const lues = await lireCitationsDeLaRevision('d1')
    const phrase = refusDeSuppression({ pieceId: 'p-1' }, lues)
    expect(phrase).toBe('Cette pièce est citée par le dossier permanent (lettre de mission) : elle ne se supprime plus, sauf avec son dossier.')
    expect(phrase).not.toContain('Titre')
    expect(refusDeSuppression({ pieceId: 'p-9' }, lues)).toBeNull()
    // Une entrée d'un autre dossier ne cite rien ici.
    expect(refusDeSuppression({ documentId: 'doc-9' }, lues)).toBeNull()
  })

  it('dit la révision d\u2019un solde D\u2019ABORD, mot pour mot, quand les deux citent la même source', async () => {
    faux.tables.dossier_permanent.push({ id: 'e3', dossier_id: 'd1', nature: 'bail', titre: 'T', texte: null, piece_id: null, document_id: 'doc-1' })
    const lues = await lireCitationsDeLaRevision('d1')
    expect(refusDeSuppression({ documentId: 'doc-1' }, lues))
      .toBe('Ce document est cité par la révision du solde du compte 512000 (exercice 2025) : il ne se supprime plus, sauf avec son dossier.')
    expect(quiCite({ documentId: 'doc-1' }, lues)).toBe('revision')
    expect(quiCite({ pieceId: 'p-1' }, lues)).toBe('dossier-permanent')
    expect(quiCite({ pieceId: 'p-9' }, lues)).toBeNull()
    expect(quiCite({ pieceId: 'p-1' }, null)).toBeNull()
  })
})

describe('citantDe', () => {
  it('garde les mots d\u2019hier pour la révision seule, nomme le dossier permanent, et les deux ensemble', () => {
    expect(citantDe(['revision', 'revision'])).toBe('la révision des soldes')
    expect(citantDe(['dossier-permanent'])).toBe('le dossier permanent')
    expect(citantDe(['revision', 'dossier-permanent'])).toBe('la révision des soldes et le dossier permanent')
    expect(citantDe([null])).toBe('la révision des soldes')
  })
})
