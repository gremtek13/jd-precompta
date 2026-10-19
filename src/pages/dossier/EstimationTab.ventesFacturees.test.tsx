import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import EstimationTab from './EstimationTab'
import type { Piece } from '../../lib/types'
import type { Predicat } from '../../test/filtresPostgrest'

// LES VENTES FACTURÉES DANS L'ESTIMATION (ligne 28.6, chantier EC-Q3, étape VF3b3). Le calcul est éprouvé à part
// (estimation.test.ts) ; ce qui se joue ici est le CÂBLAGE : que l'onglet LISE les ventes facturées du dossier, les passe à la
// projection et au repère calculé sous leur forme mensuelle, ignore l'exemplaire, dise ce qu'elles écartent, et qu'une lecture
// incomplète, pas encore revenue ou d'un autre dossier ne laisse ni projection ni repère calculé. Le faux client APPLIQUE les
// filtres des tables des ventes, et retient une table à la demande. Données FICTIVES.
const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, unknown[]>,
  muet: {} as Record<string, number>,
  attentes: {} as Record<string, Promise<void> | undefined>,
  upserts: [] as { table: string; valeur: Record<string, unknown> }[],
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatNot, predicatOr } = await import('../../test/filtresPostgrest')
  const TABLES_DES_VENTES = ['factures_emises', 'encaissements_factures', 'encaissements_factures_taux']
  function chaine(table: string) {
    const predicats: Predicat[] = []
    let debut = 0
    let fin = Number.MAX_SAFE_INTEGER
    let ecriture = false
    const c: Record<string, unknown> = {}
    const reponse = () => {
      if (ecriture) return { data: null, error: null }
      const toutes = filtrer(faux.parTable[table] ?? [], predicats)
      const muet = faux.muet[table]
      const borne = muet == null ? toutes.length : Math.min(toutes.length, muet)
      return { data: toutes.slice(debut, Math.min(fin + 1, borne)), error: null, count: toutes.length }
    }
    Object.assign(c, {
      select: () => c, order: () => c,
      // Les filtres des ventes facturées et le type des pièces sont appliqués : l'onglet lit les recettes à part.
      eq: (colonne: string, valeur: unknown) => {
        if (TABLES_DES_VENTES.includes(table) || table === 'pieces') predicats.push(predicatEq(colonne, valeur))
        else if (table === 'facture_lignes' && colonne.startsWith('factures_emises.')) {
          const champ = colonne.slice('factures_emises.'.length)
          predicats.push((l) => ((faux.parTable.factures_emises ?? []) as Record<string, unknown>[]).some((f) => f.id === l.facture_id && f[champ] === valeur))
        }
        return c
      },
      not: (colonne: string, operateur: string, valeur: unknown) => { predicats.push(predicatNot(colonne, operateur, valeur)); return c },
      or: (expression: string) => { predicats.push(predicatOr(expression)); return c },
      range: (d: number, f: number) => { debut = d; fin = f; return c },
      upsert: (valeur: Record<string, unknown>) => { ecriture = true; faux.upserts.push({ table, valeur }); return c },
      then: (suite: (r: unknown) => unknown) => {
        const attente = faux.attentes[table]
        return (attente ? attente.then(reponse) : Promise.resolve(reponse())).then(suite)
      },
    })
    return c
  }
  return { supabase: { from: (table: string) => chaine(table) } }
})
// Jamais atteinte : la lecture d'une ancienne 2035 n'est pas ce qui se joue ici.
vi.mock('../../lib/extraction', () => ({ extractPiece: async () => { throw new Error('non atteinte') } }))

const D = 'dossier-de-test'
function piece(o: Partial<Piece> = {}): Piece {
  return {
    id: 'v1', dossier_id: D, uploaded_by: null, source: 'upload', storage_path: `${D}/f.pdf`, nom_fichier: 'f.pdf', storage_hash: null,
    date_piece: '2026-02-10', tiers: 'CLIENT FICTIF', montant_ht: 1000, montant_tva: 200, montant_ttc: 1200, devise: 'EUR',
    montant_devise: null, taux_change: null, conversion_source: null, categorie_id: null, sous_dossier_id: null,
    type_piece: 'vente', statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null,
    lisible_path: null, created_at: '2026-02-10T09:00:00Z', updated_at: '2026-02-10T09:00:00Z',
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null, ...o,
  }
}

// Une facture SOURCE de services : 1 000 € HT à 20 %, émise le 10 février 2026, encaissée 600 € le 20 mars — 500 € de
// recette à cette date (la règle du cumul : 100 € de TVA).
const FACTURE_SOURCE = {
  id: 'fs', dossier_id: D, statut: 'validee', type: 'facture', numero: 'F2026-0042', date_emission: '2026-02-10',
  tiers_nom: 'CLIENT FICTIF', facture_origine_id: null, source_de_la_vente: true, nature_operation: 'services', option_debits: false,
  date_prestation: null,
}
const LIGNE = { id: 'l1', facture_id: 'fs', ordre: 1, designation: 'Prestation fictive', quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20 }
const ENCAISSEMENT = {
  id: 'e1', dossier_id: D, facture_id: 'fs', date_encaissement: '2026-03-20', montant: 600, moyen: 'virement',
  ligne_bancaire_id: null, annule_id: null, cree_le: '2026-03-20T10:00:00Z', retire_le: null,
}
const PART = { encaissement_id: 'e1', dossier_id: D, taux: 20, montant: 600 }
// La pièce désignée comme son exemplaire : elle ne compte plus — comptée, elle ajouterait 1 000 €.
const EXEMPLAIRE = piece({ id: 'px', nom_fichier: 'F2026-0042.pdf', facture_id: 'fs' })
// Et une autre recette, sans facture source : 300 € HT, comptée comme hier.
const AUTRE = piece({ id: 'v2', date_piece: '2026-04-02', montant_ht: 300, montant_tva: 60, montant_ttc: 360 })

function poser() {
  faux.muet = {}
  faux.attentes = {}
  faux.upserts = []
  faux.parTable = {
    pieces: [EXEMPLAIRE, AUTRE],
    factures_emises: [FACTURE_SOURCE],
    facture_lignes: [LIGNE],
    encaissements_factures: [ENCAISSEMENT],
    encaissements_factures_taux: [PART],
  }
}

// La valeur affichée sous une étiquette de la projection.
function valeur(etiquette: string): string {
  return screen.getByText(etiquette).parentElement?.querySelector('strong')?.textContent ?? ''
}
const boutonCa = () => screen.getByRole('button', { name: 'Calculer CA + cotisations' }) as HTMLButtonElement
const boutonPostes = () => screen.getByRole('button', { name: 'Calculer le détail par poste' }) as HTMLButtonElement
const TABLES_DES_VENTES = ['factures_emises', 'facture_lignes', 'encaissements_factures', 'encaissements_factures_taux']

beforeAll(() => {
  // Le 30 juin 2026 : six mois écoulés, la projection double ce qui est entré.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-06-30T10:00:00Z'))
})
afterAll(() => { vi.useRealTimers() })
beforeEach(() => { poser() })
afterEach(() => { cleanup() })

describe('EstimationTab — les ventes facturées', () => {
  it('la projection compte la part encaissée, et l’exemplaire ne compte plus', async () => {
    render(<EstimationTab dossierId={D} assujettiTva={true} modeComptable="tresorerie" />)
    await screen.findByText('Projection 2026')
    // 500 € facturés encaissés + 300 € d'une autre recette ; compté, l'exemplaire en aurait ajouté 1 000.
    expect(valeur('CA encaissé à date')).toMatch(/^800,00\s€$/)
    expect(valeur('CA projeté sur l\'année')).toMatch(/^1\s?600,00\s€$/)
  })

  it('en engagement, la facture compte à sa date d’émission (EC3-Q12)', async () => {
    render(<EstimationTab dossierId={D} assujettiTva={true} modeComptable="engagement" />)
    await screen.findByText('Projection 2026')
    expect(valeur('CA facturé à date')).toMatch(/^1\s?300,00\s€$/)
  })

  it('le repère calculé compte la vente facturée de l’année, et ignore l’exemplaire', async () => {
    render(<EstimationTab dossierId={D} assujettiTva={true} modeComptable="tresorerie" />)
    await screen.findByText('Projection 2026')
    fireEvent.change(screen.getByLabelText('Année à calculer depuis ce dossier'), { target: { value: '2026' } })
    await act(async () => { boutonCa().click() })
    await waitFor(() => expect(faux.upserts.filter((u) => u.table === 'references_annuelles')).toHaveLength(1))
    expect(faux.upserts[0].valeur).toMatchObject({ dossier_id: D, annee: 2026, chiffre_affaires: 800, source: 'calculee' })
  })

  it('dit les ventes écartées, et se tait sans elles', async () => {
    faux.parTable.factures_emises = [FACTURE_SOURCE, { ...FACTURE_SOURCE, id: 'fv', numero: 'F2026-0043', tiers_nom: 'CLIENT SANS LIGNE' }]
    render(<EstimationTab dossierId={D} assujettiTva={true} modeComptable="tresorerie" />)
    const ligne = await screen.findByText(/Ventes facturées que l’estimation ne compte pas \(1\)/)
    expect(ligne.textContent).toContain("F2026-0043 (CLIENT SANS LIGNE) — la facture n'a aucune ligne")
    cleanup()
    poser()
    render(<EstimationTab dossierId={D} assujettiTva={true} modeComptable="tresorerie" />)
    await screen.findByText('Projection 2026')
    expect(screen.queryByText(/Ventes facturées que l’estimation ne compte pas/)).toBeNull()
  })
})

describe('EstimationTab — sans les ventes facturées entières, ni projection ni repère calculé', () => {
  it.each(TABLES_DES_VENTES)('lue en partie (%s) : le bandeau, ni projection ni calcul du chiffre d’affaires', async (table) => {
    faux.muet = { [table]: 0 }
    render(<EstimationTab dossierId={D} assujettiTva={true} modeComptable="tresorerie" />)
    await screen.findByText(/Les ventes facturées du dossier n.ont pas pu être lues en entier/)
    expect(screen.queryByText('Projection 2026')).toBeNull()
    expect(screen.queryByText('CA encaissé à date')).toBeNull()
    screen.getByText(/La projection attend les ventes facturées du dossier/)
    expect(boutonCa().disabled).toBe(true)
    screen.getByText(/Calcul du chiffre d’affaires suspendu : les ventes facturées du dossier n’ont pas pu être lues en entier/)
    // Le détail par poste ne lit que des charges : il reste offert. Et le clic sur le calcul grisé n'écrit rien.
    expect(boutonPostes().disabled).toBe(false)
    await act(async () => { fireEvent.click(boutonCa()) })
    expect(faux.upserts).toEqual([])
  })

  it('pas encore revenue : « Chargement… », et rien de l’onglet ; revenue, la projection', async () => {
    let liberer: () => void = () => {}
    faux.attentes.encaissements_factures_taux = new Promise<void>((r) => { liberer = r })
    render(<EstimationTab dossierId={D} assujettiTva={true} modeComptable="tresorerie" />)
    await act(async () => {})
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Calculer CA + cotisations' })).toBeNull()
    expect(screen.queryByText(/Projection/)).toBeNull()
    await act(async () => { liberer() })
    await screen.findByText('Projection 2026')
    expect(valeur('CA encaissé à date')).toMatch(/^800,00\s€$/)
  })

  it('un dossier changé en cours de route ne reprend pas la lecture de l’autre', async () => {
    // Le dossier quitté a une facture source sans ligne, dont la vente écartée se dirait ; le dossier ouvert n'en a aucune.
    faux.parTable.factures_emises = [{ ...FACTURE_SOURCE, id: 'fq', dossier_id: 'dossier-quitte', numero: 'F2026-9999', tiers_nom: 'CLIENT QUITTÉ' }]
    faux.parTable.facture_lignes = []
    faux.parTable.encaissements_factures = []
    faux.parTable.encaissements_factures_taux = []
    faux.parTable.pieces = [AUTRE]
    let liberer: () => void = () => {}
    faux.attentes.factures_emises = new Promise<void>((r) => { liberer = r })
    const vue = render(<EstimationTab dossierId="dossier-quitte" assujettiTva={true} modeComptable="tresorerie" />)
    await act(async () => {})
    // Le dossier ouvert répond tout de suite ; celui qu'on a quitté, après lui.
    faux.attentes = {}
    vue.rerender(<EstimationTab dossierId={D} assujettiTva={true} modeComptable="tresorerie" />)
    await screen.findByText('Projection 2026')
    await act(async () => { liberer() })
    expect(valeur('CA encaissé à date')).toMatch(/^300,00\s€$/)
    expect(screen.queryByText(/CLIENT QUITTÉ/)).toBeNull()
    expect(screen.queryByText(/Ventes facturées que l’estimation ne compte pas/)).toBeNull()
  })
})
