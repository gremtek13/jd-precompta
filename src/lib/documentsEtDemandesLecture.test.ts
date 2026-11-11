import { afterEach, describe, expect, it, vi } from 'vitest'
import { lireLesDemandesDuCabinet, lireMesDocuments } from './documentsEtDemandesLecture'

// Ce que les écrans des documents et des demandes lisent (étape B3a) : la case « Documents » relue à la base, seul `true`
// accorde ; une ligne d'un autre dossier rend la lecture incomplète ; des réponses lues en partie ne lisent pas leurs dépôts ;
// rien ne rejette.

const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  droits: { data: { documents: true } as unknown, error: null as unknown },
  refusees: new Set<string>(),
  lues: [] as string[],
}))

vi.mock('./supabase', () => {
  const requete = (table: string) => {
    const r = {
      select: () => r, eq: () => r, in: () => r, order: () => r,
      range: () => {
        faux.lues.push(table)
        if (faux.refusees.has(table)) return Promise.resolve({ data: null, error: { message: 'refus' }, count: null })
        const lignes = faux.tables[table] ?? []
        return Promise.resolve({ data: lignes, error: null, count: lignes.length })
      },
    }
    return r
  }
  return { supabase: { from: requete, rpc: () => Promise.resolve(faux.droits) } }
})

afterEach(() => { faux.tables = {}; faux.droits = { data: { documents: true }, error: null }; faux.refusees = new Set(); faux.lues = [] })

describe('« Mes documents » : la case relue à la base', () => {
  it('seul `true` accorde ; un refus est un échec dit, jamais une liste vide', async () => {
    faux.tables.documents_cabinet = [{ id: 'doc1', dossier_id: 'd1' }]
    expect((await lireMesDocuments('d1')).etat).toBe('lus')
    faux.droits = { data: { documents: 'true' }, error: null }
    expect(await lireMesDocuments('d1')).toEqual({ dossierId: 'd1', etat: 'sans_documents' })
    faux.droits = { data: null, error: { message: 'refus' } }
    const echec = await lireMesDocuments('d1')
    expect(echec.etat === 'echec' && echec.motif).toContain('n’a pas pu être vérifié')
  })

  it('une ligne d’un autre dossier rend la lecture incomplète', async () => {
    faux.tables.documents_cabinet = [{ id: 'doc1', dossier_id: 'd2' }]
    const lu = await lireMesDocuments('d1')
    expect(lu.etat === 'lus' && lu.documents.complete).toBe(false)
  })
})

describe('les demandes du cabinet', () => {
  it('des réponses lues en partie ne lisent pas leurs dépôts, et le disent', async () => {
    faux.refusees.add('demandes_reponses')
    const lu = await lireLesDemandesDuCabinet('d1')
    expect(lu.reponses.complete).toBe(false)
    expect(lu.pieces).toEqual({ lignes: [], complete: false, motif: 'les réponses ne sont pas lues en entier' })
    expect(faux.lues).not.toContain('pieces')
  })

  it('lues en entier, les dépôts cités se lisent', async () => {
    faux.tables.demandes_reponses = [{ id: 'r1', dossier_id: 'd1', piece_id: 'p1', document_id: null }]
    faux.tables.pieces = [{ id: 'p1', dossier_id: 'd1', nom_fichier: 'releve.pdf', storage_path: 'd1/p1.pdf' }]
    const lu = await lireLesDemandesDuCabinet('d1')
    expect(lu.pieces.complete && lu.pieces.lignes.map((p) => p.nom_fichier)).toEqual(['releve.pdf'])
    expect(lu.documentsDivers.complete).toBe(true)
  })
})
