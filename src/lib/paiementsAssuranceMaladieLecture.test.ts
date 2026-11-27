import { afterEach, describe, expect, it, vi } from 'vitest'
import { lireLesPaiementsAssuranceMaladie } from './paiementsAssuranceMaladieLecture'

// Ce que l'écran des paiements de l'assurance maladie lit (NOE4) : RIEN, drapeau baissé (les deux tables n'existent pas avant
// la migration) ; levé, côté client la case « Banque » relue à la base, seul `true` accorde ; côté cabinet, aucune case ; une
// ligne d'un autre dossier rend la lecture incomplète ; rien ne rejette.

const faux = vi.hoisted(() => ({
  drapeau: true,
  associations: false,
  remplacements: false,
  tables: {} as Record<string, Record<string, unknown>[]>,
  droits: { data: { banque: true } as unknown, error: null as unknown },
  lues: [] as string[],
  lever: false,
}))

vi.mock('./paiementsAssuranceMaladie', async (original) => ({
  ...await original<typeof import('./paiementsAssuranceMaladie')>(),
  get PAIEMENTS_ASSURANCE_MALADIE_PREVUS() { return faux.drapeau },
}))
vi.mock('./rapprochementAssuranceMaladie', async (original) => ({
  ...await original<typeof import('./rapprochementAssuranceMaladie')>(),
  get ASSOCIATIONS_ASSURANCE_MALADIE_PREVUES() { return faux.associations },
}))
vi.mock('./remplacementDesJourneesAssuranceMaladie', async (original) => ({
  ...await original<typeof import('./remplacementDesJourneesAssuranceMaladie')>(),
  get REMPLACEMENT_DES_JOURNEES_PREVU() { return faux.remplacements },
}))
vi.mock('./supabase', () => {
  const requete = (table: string) => {
    const r = {
      select: () => r, order: () => r, eq: () => r,
      range: () => {
        if (faux.lever) throw new Error('réseau coupé')
        faux.lues.push(table)
        const lignes = faux.tables[table] ?? []
        return Promise.resolve({ data: lignes, error: null, count: lignes.length })
      },
    }
    return r
  }
  return { supabase: { from: requete, rpc: (nom: string) => { faux.lues.push(`rpc:${nom}`); return Promise.resolve(faux.droits) } } }
})

afterEach(() => { faux.drapeau = true; faux.associations = false; faux.remplacements = false; faux.tables = {}; faux.droits = { data: { banque: true }, error: null }; faux.lues = []; faux.lever = false })

describe('les paiements de l’assurance maladie, lus', () => {
  it('drapeau baissé : rien ne se lit, et l’échec se dit — jamais une liste vide', async () => {
    faux.drapeau = false
    expect((await lireLesPaiementsAssuranceMaladie('d1', 'client')).etat).toBe('echec')
    expect((await lireLesPaiementsAssuranceMaladie('d1', 'cabinet')).etat).toBe('echec')
    expect(faux.lues).toEqual([])
  })

  it('côté client, la case « Banque » relue à la base : seul `true` accorde ; un refus est un échec dit', async () => {
    faux.tables.imports_assurance_maladie = [{ id: 'i1', dossier_id: 'd1' }]
    expect((await lireLesPaiementsAssuranceMaladie('d1', 'client')).etat).toBe('lus')
    expect(faux.lues).toContain('rpc:droits_sur_le_dossier')
    faux.droits = { data: { banque: 'true' }, error: null }
    expect(await lireLesPaiementsAssuranceMaladie('d1', 'client')).toEqual({ dossierId: 'd1', etat: 'sans_banque' })
    faux.droits = { data: null, error: { message: 'refus' } }
    const echec = await lireLesPaiementsAssuranceMaladie('d1', 'client')
    expect(echec.etat === 'echec' && echec.motif).toContain('n’a pas pu être vérifié')
  })

  it('côté cabinet, aucune case lue ; une ligne d’un autre dossier rend la lecture incomplète ; une requête qui lève ferme', async () => {
    faux.tables.paiements_assurance_maladie = [{ id: 'p', dossier_id: 'd2' }]
    const lu = await lireLesPaiementsAssuranceMaladie('d1', 'cabinet')
    expect(faux.lues).not.toContain('rpc:droits_sur_le_dossier')
    expect(lu.etat === 'lus' && [lu.imports.complete, lu.paiements.complete]).toEqual([true, false])
    faux.lever = true
    expect((await lireLesPaiementsAssuranceMaladie('d1', 'cabinet')).etat).toBe('echec')
  })

  it('les associations (NOE5b) : drapeau baissé, rien de lu et nul ; levé, lues avec le reste, une ligne d’un autre dossier les rend incomplètes', async () => {
    const baisse = await lireLesPaiementsAssuranceMaladie('d1', 'cabinet')
    expect(baisse.etat === 'lus' && baisse.associations).toBeNull()
    expect(faux.lues).not.toContain('paiements_assurance_maladie_mouvements')
    faux.associations = true
    faux.tables.paiements_assurance_maladie_mouvements = [{ id: 'a', dossier_id: 'd1', paiement_id: 'p', ligne_bancaire_id: 'm' }]
    const leve = await lireLesPaiementsAssuranceMaladie('d1', 'client')
    expect(leve.etat === 'lus' && leve.associations?.lignes.map((a) => a.id)).toEqual(['a'])
    faux.tables.paiements_assurance_maladie_mouvements = [{ id: 'a', dossier_id: 'd2' }]
    const autre = await lireLesPaiementsAssuranceMaladie('d1', 'cabinet')
    expect(autre.etat === 'lus' && autre.associations?.complete).toBe(false)
  })

  it('la trace des remplacements (NOE4R-Q2) : drapeau baissé, rien de lu et nulle ; levée, lue avec le reste, une ligne d’un autre dossier la rend incomplète', async () => {
    const baisse = await lireLesPaiementsAssuranceMaladie('d1', 'cabinet')
    expect(baisse.etat === 'lus' && baisse.remplacements).toBeNull()
    expect(faux.lues).not.toContain('remplacements_assurance_maladie')
    faux.remplacements = true
    faux.tables.remplacements_assurance_maladie = [{ id: 't', dossier_id: 'd1', import_id: 'i2', ancien_import_id: 'i1' }]
    const leve = await lireLesPaiementsAssuranceMaladie('d1', 'client')
    expect(leve.etat === 'lus' && leve.remplacements?.lignes.map((r) => r.id)).toEqual(['t'])
    expect(faux.lues).toContain('remplacements_assurance_maladie')
    faux.tables.remplacements_assurance_maladie = [{ id: 't', dossier_id: 'd2' }]
    const autre = await lireLesPaiementsAssuranceMaladie('d1', 'cabinet')
    expect(autre.etat === 'lus' && autre.remplacements?.complete).toBe(false)
  })
})
