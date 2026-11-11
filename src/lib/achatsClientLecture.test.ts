import { afterEach, describe, expect, it, vi } from 'vitest'
import { lireLAchatDeLaPiece, lireMesAchats } from './achatsClientLecture'

// Ce que les écrans des achats du client lisent (étape B5) : RIEN, drapeau baissé (les tables et les colonnes n'existent pas
// avant la migration) ; levé, la case « Achats » relue à la base, seul `true` accorde ; une ligne d'un autre dossier rend la
// lecture incomplète ; la pièce de la fiche relue une fois, sinon rien ne s'en dit ; rien ne rejette.

const faux = vi.hoisted(() => ({
  drapeau: true,
  tables: {} as Record<string, Record<string, unknown>[]>,
  droits: { data: { achats: true } as unknown, error: null as unknown },
  lues: [] as string[],
  filtres: [] as string[],
}))

vi.mock('./achatsClient', async (original) => ({
  ...await original<typeof import('./achatsClient')>(),
  get ACHATS_DU_CLIENT_PREVUS() { return faux.drapeau },
}))
vi.mock('./supabase', () => {
  const requete = (table: string) => {
    const r = {
      select: () => r, order: () => r,
      eq: (colonne: string, valeur: unknown) => { faux.filtres.push(`${table}.${colonne}=${String(valeur)}`); return r },
      range: () => {
        faux.lues.push(table)
        const lignes = faux.tables[table] ?? []
        return Promise.resolve({ data: lignes, error: null, count: lignes.length })
      },
    }
    return r
  }
  return { supabase: { from: requete, rpc: (nom: string) => { faux.lues.push(`rpc:${nom}`); return Promise.resolve(faux.droits) } } }
})

afterEach(() => {
  faux.drapeau = true; faux.tables = {}; faux.droits = { data: { achats: true }, error: null }; faux.lues = []; faux.filtres = []
})

describe('drapeau baissé', () => {
  it('rien ne se lit, et l’échec se dit — jamais une liste vide', async () => {
    faux.drapeau = false
    expect((await lireMesAchats('d1', 'u1')).etat).toBe('echec')
    const fiche = await lireLAchatDeLaPiece('d1', 'p1')
    expect([fiche.echeance.complete, fiche.paiements.complete, fiche.acces.complete]).toEqual([false, false, false])
    expect(faux.lues).toEqual([])
  })
})

describe('« Mes achats » : la case relue à la base', () => {
  it('seul `true` accorde ; un refus est un échec dit', async () => {
    faux.tables.pieces = [{ id: 'p1', dossier_id: 'd1' }]
    expect((await lireMesAchats('d1', 'u1')).etat).toBe('lus')
    expect(faux.filtres).toEqual(expect.arrayContaining(['pieces.type_piece=achat', 'pieces_vues.utilisateur=u1']))
    faux.droits = { data: { achats: 'true' }, error: null }
    expect(await lireMesAchats('d1', 'u1')).toEqual({ dossierId: 'd1', etat: 'sans_achats' })
    faux.droits = { data: null, error: { message: 'refus' } }
    const echec = await lireMesAchats('d1', 'u1')
    expect(echec.etat === 'echec' && echec.motif).toContain('n’a pas pu être vérifié')
  })

  it('une ligne d’un autre dossier rend la lecture incomplète', async () => {
    faux.tables.paiements_declares = [{ id: 'x', dossier_id: 'd2' }]
    const lu = await lireMesAchats('d1', 'u1')
    expect(lu.etat === 'lus' && lu.paiements.complete).toBe(false)
  })
})

describe('la fiche d’une pièce d’achat', () => {
  it('la pièce relue une fois exactement ; sinon son échéance ne se dit pas', async () => {
    faux.tables.pieces = [{ id: 'p1', dossier_id: 'd1', source: 'upload', date_echeance: null }]
    expect((await lireLAchatDeLaPiece('d1', 'p1')).echeance.complete).toBe(true)
    faux.tables.pieces = []
    expect((await lireLAchatDeLaPiece('d1', 'p1')).echeance).toEqual({ lignes: [], complete: false, motif: 'la pièce n’a pas été relue' })
    expect(faux.filtres).toEqual(expect.arrayContaining(['paiements_declares.piece_id=p1', 'pieces.id=p1']))
  })
})
