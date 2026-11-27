import { afterEach, describe, expect, it, vi } from 'vitest'
import { lireLeFactureAssuranceMaladie, unImportDuFactureLu } from './factureAssuranceMaladieLecture'

// Ce que l'écran du facturé lit (BOR4) : RIEN, drapeau baissé ; levé, les imports et leurs totaux, par pages, triés jusqu'à la
// clé ; côté client la case « Banque » relue à la base, seul `true` accorde ; côté cabinet, aucune case ; une ligne d'un autre
// dossier rend la lecture incomplète ; une lecture plafonnée se dit incomplète ; rien ne rejette ; ni le registre ni la clé.

const faux = vi.hoisted(() => ({
  drapeau: true,
  tables: {} as Record<string, Record<string, unknown>[]>,
  annonces: {} as Record<string, number>,
  droits: { data: { banque: true } as unknown, error: null as unknown },
  lues: [] as string[],
  tris: {} as Record<string, string[]>,
  lever: false,
  refusUne: false,
}))

vi.mock('./importDuFactureAssuranceMaladie', async (original) => ({
  ...await original<typeof import('./importDuFactureAssuranceMaladie')>(),
  get FACTURES_ASSURANCE_MALADIE_PREVUES() { return faux.drapeau },
}))
vi.mock('./supabase', () => {
  const requete = (table: string) => {
    faux.tris[table] = []
    const r = {
      select: () => r, eq: () => r,
      order: (colonne: string) => { faux.tris[table].push(colonne); return r },
      range: () => {
        if (faux.lever) throw new Error('réseau coupé')
        faux.lues.push(table)
        const lignes = faux.tables[table] ?? []
        return Promise.resolve({ data: lignes, error: null, count: faux.annonces[table] ?? lignes.length })
      },
      limit: () => r,
      maybeSingle: () => {
        if (faux.lever) throw new Error('réseau coupé')
        faux.lues.push(`une:${table}`)
        if (faux.refusUne) return Promise.resolve({ data: null, error: { message: 'refus' } })
        return Promise.resolve({ data: (faux.tables[table] ?? [])[0] ?? null, error: null })
      },
    }
    return r
  }
  return { supabase: { from: requete, rpc: (nom: string) => { faux.lues.push(`rpc:${nom}`); return Promise.resolve(faux.droits) } } }
})

afterEach(() => {
  faux.drapeau = true; faux.tables = {}; faux.annonces = {}; faux.droits = { data: { banque: true }, error: null }; faux.lues = []
  faux.tris = {}; faux.lever = false; faux.refusUne = false
})

describe('un import du facturé existe-t-il (BOR6TQ1-Q1) ?', () => {
  it('une ligne du dossier lue : vrai ; tout le reste, faux — jamais un « aucun » affirmé', async () => {
    faux.tables.imports_factures_assurance_maladie = [{ id: 'i1', dossier_id: 'd1' }]
    expect(await unImportDuFactureLu('d1')).toBe(true)
    expect(faux.lues).toEqual(['une:imports_factures_assurance_maladie'])
    expect(await unImportDuFactureLu('d2')).toBe(false)
    faux.tables = {}
    expect(await unImportDuFactureLu('d1')).toBe(false)
    faux.tables.imports_factures_assurance_maladie = [{ id: 'i1', dossier_id: 'd1' }]
    faux.refusUne = true
    expect(await unImportDuFactureLu('d1')).toBe(false)
    faux.refusUne = false
    faux.lever = true
    expect(await unImportDuFactureLu('d1')).toBe(false)
  })

  it('drapeau baissé : rien ne se lit', async () => {
    faux.drapeau = false
    expect(await unImportDuFactureLu('d1')).toBe(false)
    expect(faux.lues).toEqual([])
  })
})

describe('le facturé à l’assurance maladie, lu', () => {
  it('drapeau baissé : rien ne se lit, et l’échec se dit — jamais une liste vide', async () => {
    faux.drapeau = false
    expect((await lireLeFactureAssuranceMaladie('d1', 'client')).etat).toBe('echec')
    expect((await lireLeFactureAssuranceMaladie('d1', 'cabinet')).etat).toBe('echec')
    expect(faux.lues).toEqual([])
  })

  it('côté cabinet : les deux tables, triées jusqu’à la clé, sans case ; ni le registre ni la clé du dossier', async () => {
    faux.tables.imports_factures_assurance_maladie = [{ id: 'i1', dossier_id: 'd1' }]
    faux.tables.factures_assurance_maladie = [{ id: 't1', dossier_id: 'd1', import_id: 'i1' }]
    const lu = await lireLeFactureAssuranceMaladie('d1', 'cabinet')
    expect(lu.etat === 'lus' && lu.imports.complete && lu.totaux.complete && lu.totaux.lignes.length).toBe(1)
    expect([...faux.lues].sort()).toEqual(['factures_assurance_maladie', 'imports_factures_assurance_maladie'])
    expect(faux.tris).toEqual({ imports_factures_assurance_maladie: ['importe_le', 'id'], factures_assurance_maladie: ['date_creation_lot', 'id'] })
  })

  it('côté client, la case « Banque » relue à la base : seul `true` accorde ; un refus est un échec dit', async () => {
    expect((await lireLeFactureAssuranceMaladie('d1', 'client')).etat).toBe('lus')
    expect(faux.lues).toContain('rpc:droits_sur_le_dossier')
    faux.droits = { data: { banque: 'true' }, error: null }
    expect(await lireLeFactureAssuranceMaladie('d1', 'client')).toEqual({ dossierId: 'd1', etat: 'sans_banque' })
    faux.droits = { data: [], error: null }
    expect((await lireLeFactureAssuranceMaladie('d1', 'client')).etat).toBe('echec')
    faux.droits = { data: null, error: { message: 'refus' } }
    const echec = await lireLeFactureAssuranceMaladie('d1', 'client')
    expect(echec.etat === 'echec' && echec.motif).toContain('n’a pas pu être vérifié')
  })

  it('une ligne d’un autre dossier, ou une lecture qui rend moins que son compte : incomplète, avec son motif', async () => {
    faux.tables.factures_assurance_maladie = [{ id: 't1', dossier_id: 'd2', import_id: 'i1' }]
    const autre = await lireLeFactureAssuranceMaladie('d1', 'cabinet')
    expect(autre.etat === 'lus' && autre.totaux).toEqual({ lignes: [], complete: false, motif: 'une ligne rendue n’est pas de ce dossier' })
    // Une page qui revient sans ligne alors que le compte en annonce : la lecture ne se croit pas entière.
    faux.tables.factures_assurance_maladie = []
    faux.annonces.imports_factures_assurance_maladie = 5
    const plafonnee = await lireLeFactureAssuranceMaladie('d1', 'cabinet')
    expect(plafonnee.etat === 'lus' && plafonnee.imports.complete).toBe(false)
  })

  it('une requête qui lève : l’échec dit, rien ne rejette', async () => {
    faux.lever = true
    const lu = await lireLeFactureAssuranceMaladie('d1', 'cabinet')
    expect(lu.etat).toBe('echec')
    expect(lu.dossierId).toBe('d1')
  })
})
