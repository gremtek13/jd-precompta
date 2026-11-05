import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SANS_ACOMPTE_CII } from './factureCii'
import { acompteSansLecture, lireLAcompteDeLaFacture } from './acompteDeLaFactureLecture'
import { fauxTables, poserLesTables, tablesDuDossier } from '../test/acomptesFactures'

// LA LECTURE DE L'ACOMPTE D'UNE FACTURE (lib/acompteDeLaFactureLecture.ts, étape P5b4b). Le drapeau `ACOMPTES_PREVUS`
// (src/lib/devis.ts) se joue dans ses deux états : baissé, rien n'est lu ; levé, la marque, les reprises, les acomptes cités,
// la facture qu'un avoir corrige et le devis lié, passés par `acompteLu`. Le faux client APPLIQUE les filtres et ne rend que
// les colonnes demandées (src/test/acomptesFactures.ts). Données FICTIVES.
const drapeau = vi.hoisted(() => ({ acomptes: false }))
vi.mock('./devis', async (importOriginal) => {
  const vrai = await importOriginal<typeof import('./devis')>()
  return { ...vrai, get ACOMPTES_PREVUS() { return drapeau.acomptes } }
})
vi.mock('./supabase', async () => ({ supabase: (await import('../test/acomptesFactures')).fauxClient }))

const facture = (id: string, type: 'facture' | 'avoir' = 'facture', origine: string | null = null) =>
  ({ id, dossier_id: 'd1', type, facture_origine_id: origine })

beforeEach(() => {
  drapeau.acomptes = false
  poserLesTables(tablesDuDossier())
})

describe('lireLAcompteDeLaFacture — le drapeau baissé', () => {
  it('rend SANS_ACOMPTE_CII sans aucune lecture, même pour une facture d’acompte', async () => {
    expect(await lireLAcompteDeLaFacture(facture('a1'))).toEqual({ factureId: 'a1', etat: 'lue', acompte: SANS_ACOMPTE_CII, origine: null, devis: null })
    expect(fauxTables.demandes).toEqual([])
    expect(acompteSansLecture('a1')).not.toBeNull()
  })

  it('le drapeau se lit à l’appel, jamais au chargement du module', async () => {
    drapeau.acomptes = true
    expect(acompteSansLecture('a1')).toBeNull()
    expect((await lireLAcompteDeLaFacture(facture('a1'))).etat).toBe('lue')
    expect(fauxTables.demandes.length).toBeGreaterThan(0)
  })
})

describe('lireLAcompteDeLaFacture — le drapeau levé', () => {
  beforeEach(() => { drapeau.acomptes = true })

  it('une facture d’acompte : sa marque, la date de son versement et le devis lié', async () => {
    const lu = await lireLAcompteDeLaFacture(facture('a1'))
    expect(lu).toEqual({
      factureId: 'a1', etat: 'lue', origine: null, devis: { numero: 'D2026-0002', date_emission: '2026-09-20' },
      acompte: { acompte: true, dateVersement: '2026-09-25', origineAcompte: false, reprises: [], acomptesRepris: [] },
    })
  })

  it('la finale : ses reprises, et les deux acomptes cités, filtrés sur le dossier', async () => {
    const lu = await lireLAcompteDeLaFacture(facture('fin'))
    if (lu.etat !== 'lue') throw new Error(lu.motif)
    expect(lu.acompte.acompte).toBe(false)
    expect(lu.acompte.reprises).toEqual([{ ordre: 2, factureId: 'a1' }, { ordre: 3, factureId: 'a2' }])
    expect(lu.acompte.acomptesRepris.map((r) => [r.numero, r.acompte])).toEqual([['F2026-0003', true], ['F2026-0005', true]])
    expect(fauxTables.demandes).toContain('factures_emises: id, numero, date_emission, acompte')
  })

  it('l’avoir d’un acompte : la marque, le numéro et la date de la facture corrigée', async () => {
    const lu = await lireLAcompteDeLaFacture(facture('av1', 'avoir', 'a1'))
    if (lu.etat !== 'lue') throw new Error(lu.motif)
    expect(lu.acompte.origineAcompte).toBe(true)
    expect(lu.origine).toEqual({ numero: 'F2026-0003', date_emission: '2026-10-01' })
    expect(lu.devis).toBeNull()
  })

  it('un acompte d’un autre dossier n’est pas rendu : la reprise reste sans sa facture, que le générateur refusera', async () => {
    const tables = tablesDuDossier()
    tables.factures_emises.find((f) => f.id === 'a2')!.dossier_id = 'autre'
    poserLesTables(tables)
    const lu = await lireLAcompteDeLaFacture(facture('fin'))
    if (lu.etat !== 'lue') throw new Error(lu.motif)
    expect(lu.acompte.acomptesRepris.map((r) => r.id)).toEqual(['a1'])
  })

  it('une valeur absente est illisible, jamais un « non »', async () => {
    const tables = tablesDuDossier()
    delete tables.factures_emises.find((f) => f.id === 'a1')!.acompte
    poserLesTables(tables)
    const lu = await lireLAcompteDeLaFacture(facture('a1'))
    if (lu.etat !== 'lue') throw new Error(lu.motif)
    expect(lu.acompte.acompte).toBeNull()
    // Et la facture que l'avoir corrige, rendue sans sa marque : illisible aussi.
    const avoir = await lireLAcompteDeLaFacture(facture('av1', 'avoir', 'a1'))
    expect(avoir.etat === 'lue' && avoir.acompte.origineAcompte).toBeNull()
  })

  it('une facture corrigée que la base ne rend pas est illisible, jamais « pas un acompte »', async () => {
    const lu = await lireLAcompteDeLaFacture(facture('av1', 'avoir', 'disparue'))
    expect(lu.etat === 'lue' && lu.acompte.origineAcompte).toBeNull()
  })

  it.each([
    ['factures_emises', 'La marque d’acompte de la facture'],
    ['facture_lignes', 'Les reprises d’acompte de la facture'],
    ['devis_factures', 'Le devis dont la facture est tirée'],
    ['devis', 'Le devis dont la facture est tirée'],
  ])('une lecture refusée (%s) rend « illisible » avec son motif, sans rejeter', async (table, debut) => {
    poserLesTables(tablesDuDossier(), { [table]: 'permission refusée' })
    const lu = await lireLAcompteDeLaFacture(facture('a1'))
    expect(lu.etat).toBe('illisible')
    expect(lu.etat === 'illisible' && lu.motif.startsWith(debut)).toBe(true)
  })

  it('un lien vers un devis que la base ne rend pas est illisible', async () => {
    const tables = tablesDuDossier()
    tables.devis = []
    poserLesTables(tables)
    expect((await lireLAcompteDeLaFacture(facture('a1'))).etat).toBe('illisible')
  })

  it('une facture tirée d’aucun devis n’en cite aucun', async () => {
    const tables = tablesDuDossier()
    tables.devis_factures = []
    poserLesTables(tables)
    const lu = await lireLAcompteDeLaFacture(facture('a1'))
    expect(lu.etat === 'lue' && lu.devis).toBeNull()
  })
})
