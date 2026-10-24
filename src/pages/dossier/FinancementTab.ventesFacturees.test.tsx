import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FinancementTab from './FinancementTab'
import { POSTE_VENTES_FACTUREES } from '../../lib/declaration2035'
import { COLONNES_MOUVEMENTS_ECRITURES } from '../../lib/ecrituresVentesFactureesLecture'
import { PLAN_PAR_DEFAUT } from '../../lib/planComptable'
import type { Categorie, LigneBancaire, Piece } from '../../lib/types'
import type { Predicat } from '../../test/filtresPostgrest'
import { ligneBancaire, mouvementDesVentes } from '../../test/dossierBascule'

// LES VENTES FACTURÉES DANS LE FINANCEMENT (ligne 28.6, chantier EC-Q3, étape VF3b3). Le calcul est éprouvé à part
// (situationIntermediaire.test.ts) ; ce qui se joue ici est le CÂBLAGE : que l'onglet LISE les ventes facturées du dossier,
// les passe à ses trois fenêtres (la situation, les ratios, le préremplissage du prévisionnel), dise ce qu'elles écartent,
// et qu'une lecture incomplète, pas encore revenue ou d'un autre dossier ne laisse aucun chiffre de situation. Le faux
// client APPLIQUE les filtres des tables des ventes, et retient une table à la demande. Données FICTIVES.
//
// Le dossier est monté BASCULÉ (`ventesParLesFactures`), comme la base l'impose à un dossier qui a une facture source : depuis
// la ligne 28.65, l'onglet lit aussi les sources des écritures de ses ventes facturées (lib/ecrituresVentesFactureesLecture.ts),
// d'où viennent les frais d'un mouvement d'encaissements, et une facture source dans un dossier qui ne se dit pas basculé rend
// les lectures incohérentes.
const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, unknown[]>,
  // Le serveur qui cesse de rendre une table au-delà de N lignes tout en annonçant le vrai total.
  muet: {} as Record<string, number>,
  // Le même, pour une seule lecture d'une table, désignée par ses colonnes : les sources des écritures relisent des tables que
  // l'onglet lit déjà, et seule la leur doit manquer.
  muetSelonColonnes: {} as Record<string, number>,
  // Une lecture de cette table attend la promesse posée au moment où elle part.
  attentes: {} as Record<string, Promise<void> | undefined>,
  // Chaque lecture partie, `table|colonnes` : de quoi dire qu'une lecture n'est PAS demandée.
  demandes: [] as string[],
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatNot, predicatOr } = await import('../../test/filtresPostgrest')
  // Le relevé aussi, depuis la ligne 28.65 : les sources des écritures lisent les mouvements du dossier, et un mouvement d'un
  // autre dossier fermerait leur lecture.
  const TABLES_DES_VENTES = ['factures_emises', 'encaissements_factures', 'encaissements_factures_taux', 'lignes_bancaires']
  function chaine(table: string) {
    const predicats: Predicat[] = []
    let debut = 0
    let fin = Number.MAX_SAFE_INTEGER
    let colonnes = '*'
    const c: Record<string, unknown> = {}
    const reponse = () => {
      const toutes = filtrer(faux.parTable[table] ?? [], predicats)
      const muet = faux.muetSelonColonnes[`${table}|${colonnes}`] ?? faux.muet[table]
      const borne = muet == null ? toutes.length : Math.min(toutes.length, muet)
      return { data: toutes.slice(debut, Math.min(fin + 1, borne)), error: null, count: toutes.length }
    }
    Object.assign(c, {
      select: (lues?: string) => { colonnes = lues ?? '*'; return c },
      order: () => c,
      // Les filtres des ventes facturées sont appliqués : une facture d'un autre dossier, ou qui n'est pas source, ferme la
      // lecture (lib/ventesFactureesLecture.ts). Les lignes d'une facture se filtrent par leur facture, comme en base.
      eq: (colonne: string, valeur: unknown) => {
        if (TABLES_DES_VENTES.includes(table) || (table === 'pieces' && colonne === 'statut')) predicats.push(predicatEq(colonne, valeur))
        else if (table === 'facture_lignes' && colonne.startsWith('factures_emises.')) {
          const champ = colonne.slice('factures_emises.'.length)
          predicats.push((l) => ((faux.parTable.factures_emises ?? []) as Record<string, unknown>[]).some((f) => f.id === l.facture_id && f[champ] === valeur))
        }
        return c
      },
      not: (colonne: string, operateur: string, valeur: unknown) => { predicats.push(predicatNot(colonne, operateur, valeur)); return c },
      or: (expression: string) => { predicats.push(predicatOr(expression)); return c },
      range: (d: number, f: number) => { debut = d; fin = f; return c },
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (suite: (r: unknown) => unknown) => {
        faux.demandes.push(`${table}|${colonnes}`)
        const attente = faux.attentes[table]
        return (attente ? attente.then(reponse) : Promise.resolve(reponse())).then(suite)
      },
    })
    return c
  }
  return { supabase: { from: (table: string) => chaine(table) } }
})

const D = 'dossier-de-test'
const CATEGORIE: Categorie = {
  id: 'cat-recettes', dossier_id: null, code: '706', libelle: 'Recettes', ordre: 1, compte_comptable: '706000', poste_2035: 'Recettes',
}
function piece(o: Partial<Piece> = {}): Piece {
  return {
    id: 'v1', dossier_id: D, uploaded_by: null, source: 'upload', storage_path: `${D}/f.pdf`, nom_fichier: 'f.pdf', storage_hash: null,
    date_piece: '2026-02-10', tiers: 'CLIENT FICTIF', montant_ht: 1000, montant_tva: 200, montant_ttc: 1200, devise: 'EUR',
    montant_devise: null, taux_change: null, conversion_source: null, categorie_id: 'cat-recettes', sous_dossier_id: null,
    type_piece: 'vente', statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null,
    lisible_path: null, created_at: '2026-02-10T09:00:00Z', updated_at: '2026-02-10T09:00:00Z',
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null, vente_hors_des_factures: false, ...o,
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
// La pièce désignée comme son exemplaire : elle ne compte plus — compté, elle ajouterait 1 000 €.
const EXEMPLAIRE = piece({ id: 'px', nom_fichier: 'F2026-0042.pdf', facture_id: 'fs' })

function poser(o: { factures?: Record<string, unknown>[]; lignes?: Record<string, unknown>[] } = {}) {
  faux.muet = {}
  faux.muetSelonColonnes = {}
  faux.attentes = {}
  faux.demandes = []
  faux.parTable = {
    pieces: [EXEMPLAIRE],
    categories: [CATEGORIE],
    factures_emises: o.factures ?? [FACTURE_SOURCE],
    facture_lignes: o.lignes ?? [LIGNE],
    encaissements_factures: [ENCAISSEMENT],
    encaissements_factures_taux: [PART],
  }
}

const TABLES_DES_VENTES = ['factures_emises', 'facture_lignes', 'encaissements_factures', 'encaissements_factures_taux']
const bouton = (titre: string, nom = 'Générer') =>
  within(screen.getByRole('heading', { name: titre, level: 3 }).closest('div')!).getByRole('button', { name: nom }) as HTMLButtonElement

function totalDuPoste(modale: HTMLElement, poste: string): string | null {
  const cellule = within(modale).queryAllByRole('cell', { name: poste })[0]
  return cellule ? (cellule.nextElementSibling?.textContent ?? null) : null
}

async function ouvrirLaSituation(au: string, modeComptable: 'tresorerie' | 'engagement' = 'tresorerie') {
  render(<FinancementTab plan={PLAN_PAR_DEFAUT} ventesParLesFactures={true} dossierId={D} assujettiTva={true} modeComptable={modeComptable} />)
  await screen.findByRole('heading', { name: 'Situation intermédiaire', level: 3 })
  await waitFor(() => expect(bouton('Situation intermédiaire').disabled).toBe(false))
  await act(async () => { bouton('Situation intermédiaire').click() })
  await act(async () => { fireEvent.change(screen.getByLabelText('À la date du'), { target: { value: au } }) })
  return screen.getByRole('heading', { name: 'Situation intermédiaire', level: 2 }).closest('.card') as HTMLElement
}

beforeEach(() => { poser() })
afterEach(() => { cleanup() })

describe('FinancementTab — la situation lit les ventes facturées', () => {
  it('en trésorerie : la part encaissée compte à sa date, l’exemplaire ne compte plus et se dit', async () => {
    const modale = await ouvrirLaSituation('2026-06-30')
    expect(totalDuPoste(modale, POSTE_VENTES_FACTUREES)).toMatch(/^500,00\s€$/)
    expect(totalDuPoste(modale, 'Recettes')).toBeNull()
    expect(within(modale).getByText(/Exemplaires d’une facture source, que la situation ne compte pas/).textContent)
      .toMatch(/\(1\) : CLIENT FICTIF\.$/)
  })

  it('en trésorerie, arrêtée avant l’encaissement : rien de la facture, et l’exemplaire se dit encore', async () => {
    const modale = await ouvrirLaSituation('2026-03-19')
    expect(totalDuPoste(modale, POSTE_VENTES_FACTUREES)).toBeNull()
    within(modale).getByText(/Exemplaires d’une facture source, que la situation ne compte pas/)
  })

  it('en engagement : la facture compte à sa date d’émission (EC3-Q12)', async () => {
    const modale = await ouvrirLaSituation('2026-02-28', 'engagement')
    expect(totalDuPoste(modale, POSTE_VENTES_FACTUREES)).toMatch(/^1\s?000,00\s€$/)
    expect(totalDuPoste(modale, 'Recettes')).toBeNull()
  })

  it('dit les ventes écartées et les excédents, une ligne chacun', async () => {
    poser({
      factures: [
        FACTURE_SOURCE,
        { ...FACTURE_SOURCE, id: 'fv', numero: 'F2026-0043', tiers_nom: 'CLIENT SANS LIGNE' },
        { ...FACTURE_SOURCE, id: 'av', type: 'avoir', numero: 'A2026-0001', facture_origine_id: 'fs', date_emission: '2026-04-01' },
      ],
      // Un avoir de 600 € HT après 600 € encaissés : 120 € de trop.
      lignes: [LIGNE, { ...LIGNE, id: 'lav', facture_id: 'av', prix_unitaire_ht: 600, quantite: -1 }],
    })
    const modale = await ouvrirLaSituation('2026-06-30')
    expect(within(modale).getByText(/Ventes facturées que la situation ne compte pas \(1\)/).textContent)
      .toContain("F2026-0043 (CLIENT SANS LIGNE) — la facture n'a aucune ligne")
    expect(within(modale).getByText(/Ventes facturées encaissées au-delà de la facture nette de ses avoirs \(1\)/).textContent)
      .toMatch(/F2026-0042 \(CLIENT FICTIF\) à 20 %, 120,00\s€ de trop/)
  })

  it('sans vente facturée, aucune des trois lignes', async () => {
    poser()
    faux.parTable.pieces = [piece({ id: 'v2' })]
    faux.parTable.factures_emises = []
    faux.parTable.facture_lignes = []
    faux.parTable.encaissements_factures = []
    faux.parTable.encaissements_factures_taux = []
    const modale = await ouvrirLaSituation('2026-06-30')
    expect(totalDuPoste(modale, 'Recettes')).toMatch(/^1\s?000,00\s€$/)
    expect(within(modale).queryByText(/Ventes facturées|Exemplaires d’une facture source/)).toBeNull()
  })

  it('les ratios et le préremplissage du prévisionnel comptent la vente facturée', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] })
    vi.setSystemTime(new Date(2027, 1, 15, 12, 0, 0))
    try {
      render(<FinancementTab plan={PLAN_PAR_DEFAUT} ventesParLesFactures={true} dossierId={D} assujettiTva={true} modeComptable="tresorerie" />)
      await waitFor(() => expect(bouton('Prévisionnel à 3 ans').disabled).toBe(false))
      await act(async () => { bouton('Prévisionnel à 3 ans').click() })
      // L'année de référence par défaut est l'année passée, 2026 : 500 € facturés encaissés, l'exemplaire ignoré.
      await act(async () => { screen.getByRole('button', { name: 'Précharger depuis cette année' }).click() })
      expect((screen.getByLabelText('CA de référence (€)') as HTMLInputElement).value).toBe('500')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('FinancementTab — sans les ventes facturées entières, aucun chiffre de situation', () => {
  it.each(TABLES_DES_VENTES)('lue en partie (%s) : le bandeau, ni situation ni ratios, le préremplissage suspendu', async (table) => {
    faux.muet = { [table]: 0 }
    render(<FinancementTab plan={PLAN_PAR_DEFAUT} ventesParLesFactures={true} dossierId={D} assujettiTva={true} modeComptable="tresorerie" />)
    await screen.findByText(/Les ventes facturées du dossier n.ont pas pu être lues en entier/)
    expect(bouton('Situation intermédiaire').disabled).toBe(true)
    expect(bouton('Dettes & ratios bancaires').disabled).toBe(true)
    // Le plan de trésorerie ne lit rien des ventes facturées : il reste offert.
    expect(bouton('Plan de trésorerie').disabled).toBe(false)
    // Le prévisionnel s'ouvre — il se saisit à la main —, mais ne se préremplit pas.
    expect(bouton('Prévisionnel à 3 ans').disabled).toBe(false)
    await act(async () => { bouton('Prévisionnel à 3 ans').click() })
    expect((screen.getByRole('button', { name: 'Précharger depuis cette année' }) as HTMLButtonElement).disabled).toBe(true)
    screen.getByText(/Préremplissage suspendu : une lecture est incomplète/)
  })

  it('pas encore revenue : ni situation, ni ratios, ni prévisionnel, et l’attente se dit ; revenue, ils s’offrent', async () => {
    let liberer: () => void = () => {}
    faux.attentes.encaissements_factures_taux = new Promise<void>((r) => { liberer = r })
    render(<FinancementTab plan={PLAN_PAR_DEFAUT} ventesParLesFactures={true} dossierId={D} assujettiTva={true} modeComptable="tresorerie" />)
    await screen.findByRole('heading', { name: 'Situation intermédiaire', level: 3 })
    await act(async () => {})
    expect(bouton('Situation intermédiaire').disabled).toBe(true)
    expect(bouton('Dettes & ratios bancaires').disabled).toBe(true)
    expect(bouton('Prévisionnel à 3 ans').disabled).toBe(true)
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    await act(async () => { liberer() })
    await waitFor(() => expect(bouton('Situation intermédiaire').disabled).toBe(false))
    expect(bouton('Dettes & ratios bancaires').disabled).toBe(false)
    expect(document.querySelector('[aria-busy="true"]')).toBeNull()
  })

  it('un dossier changé en cours de route ne reprend pas la lecture de l’autre', async () => {
    // Le dossier quitté a une facture source sans ligne, dont la vente écartée se dirait ; le dossier ouvert n'en a aucune.
    faux.parTable.factures_emises = [{ ...FACTURE_SOURCE, id: 'fq', dossier_id: 'dossier-quitte', numero: 'F2026-9999', tiers_nom: 'CLIENT QUITTÉ' }]
    faux.parTable.facture_lignes = []
    faux.parTable.encaissements_factures = []
    faux.parTable.encaissements_factures_taux = []
    faux.parTable.pieces = [piece({ id: 'v2' })]
    let liberer: () => void = () => {}
    faux.attentes.factures_emises = new Promise<void>((r) => { liberer = r })
    const vue = render(<FinancementTab plan={PLAN_PAR_DEFAUT} ventesParLesFactures={true} dossierId="dossier-quitte" assujettiTva={true} modeComptable="tresorerie" />)
    await act(async () => {})
    // Le dossier ouvert répond tout de suite ; celui qu'on a quitté, après lui.
    faux.attentes = {}
    vue.rerender(<FinancementTab plan={PLAN_PAR_DEFAUT} ventesParLesFactures={true} dossierId={D} assujettiTva={true} modeComptable="tresorerie" />)
    await waitFor(() => expect(bouton('Situation intermédiaire').disabled).toBe(false))
    await act(async () => { liberer() })
    expect(bouton('Situation intermédiaire').disabled).toBe(false)
    await act(async () => { bouton('Situation intermédiaire').click() })
    await act(async () => { fireEvent.change(screen.getByLabelText('À la date du'), { target: { value: '2026-06-30' } }) })
    const modale = screen.getByRole('heading', { name: 'Situation intermédiaire', level: 2 }).closest('.card') as HTMLElement
    expect(totalDuPoste(modale, 'Recettes')).toMatch(/^1\s?000,00\s€$/)
    expect(screen.queryByText(/CLIENT QUITTÉ/)).toBeNull()
    expect(screen.queryByText(/Les ventes facturées du dossier n.ont pas pu être lues/)).toBeNull()
  })
})

describe('FinancementTab — les ratios lisent les ventes facturées', () => {
  it('la CAF compte la part encaissée de l’année, et l’exemplaire ne compte plus', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 5, 30, 12, 0, 0))
    try {
      render(<FinancementTab plan={PLAN_PAR_DEFAUT} ventesParLesFactures={true} dossierId={D} assujettiTva={true} modeComptable="tresorerie" />)
      await waitFor(() => expect(bouton('Dettes & ratios bancaires').disabled).toBe(false))
      await act(async () => { bouton('Dettes & ratios bancaires').click() })
      // 500 € facturés encaissés en six mois, ramenés à douze : 1 000 €. Compté, l'exemplaire en aurait ajouté 2 000.
      const caf = screen.getByText(/CAF annuelle estimée/)
      expect(caf.textContent).toMatch(/sur 6,0 mois écoulés/)
      expect(caf.querySelector('strong')?.textContent).toMatch(/^1\s?000,00\s€$/)
    } finally {
      vi.useRealTimers()
    }
  })

  it('dit les ventes écartées sous la CAF', async () => {
    poser({ factures: [FACTURE_SOURCE, { ...FACTURE_SOURCE, id: 'fv', numero: 'F2026-0043', tiers_nom: 'CLIENT SANS LIGNE' }] })
    render(<FinancementTab plan={PLAN_PAR_DEFAUT} ventesParLesFactures={true} dossierId={D} assujettiTva={true} modeComptable="tresorerie" />)
    await waitFor(() => expect(bouton('Dettes & ratios bancaires').disabled).toBe(false))
    await act(async () => { bouton('Dettes & ratios bancaires').click() })
    screen.getByText(/Ventes facturées que la situation ne compte pas \(1\)/)
  })
})

describe('FinancementTab — le préremplissage dit les ventes écartées', () => {
  it('une ligne, seulement quand il y en a', async () => {
    poser({ factures: [FACTURE_SOURCE, { ...FACTURE_SOURCE, id: 'fv', numero: 'F2026-0043', tiers_nom: 'CLIENT SANS LIGNE' }] })
    render(<FinancementTab plan={PLAN_PAR_DEFAUT} ventesParLesFactures={true} dossierId={D} assujettiTva={true} modeComptable="tresorerie" />)
    await waitFor(() => expect(bouton('Prévisionnel à 3 ans').disabled).toBe(false))
    await act(async () => { bouton('Prévisionnel à 3 ans').click() })
    expect(screen.getByText(/Ventes facturées que le préremplissage ne compte pas \(1\)/).textContent)
      .toContain("F2026-0043 (CLIENT SANS LIGNE) — la facture n'a aucune ligne")
    cleanup()
    poser()
    render(<FinancementTab plan={PLAN_PAR_DEFAUT} ventesParLesFactures={true} dossierId={D} assujettiTva={true} modeComptable="tresorerie" />)
    await waitFor(() => expect(bouton('Prévisionnel à 3 ans').disabled).toBe(false))
    await act(async () => { bouton('Prévisionnel à 3 ans').click() })
    expect(screen.queryByText(/Ventes facturées que le préremplissage ne compte pas/)).toBeNull()
  })
})

// LES FRAIS D'UN MOUVEMENT D'ENCAISSEMENTS (ligne 28.65, chantier EC-Q3 ; la règle de la 2035, VF4C3-Q1). Le calcul est
// éprouvé à part (situationIntermediaire.test.ts) ; ici, le câblage : un dossier basculé lit les sources des écritures de ses
// ventes facturées dans la même relecture que le reste, et ses trois fenêtres comptent les frais — ou les disent, sans poste.
// L'encaissement de 600 € du 20 mars est porté par le virement m1 du même jour, que la banque crédite de 598 € : 2 € de frais,
// sous le seuil de min(2 %, 5 €). Données FICTIVES.
describe('FinancementTab — les frais d’un mouvement d’encaissements', () => {
  const frais = (o: Partial<Categorie> = {}): Categorie => ({
    id: 'cat-frais', dossier_id: null, code: 'frais_bancaires', libelle: 'Frais bancaires', ordre: 2, compte_comptable: '627000',
    poste_2035: 'Frais financiers', ...o,
  })
  const M1: LigneBancaire = ligneBancaire(mouvementDesVentes({ id: 'm1', dossier_id: D, date: '2026-03-20', montant: 598 }))
  function poserLeMouvement(categorieFrais: Categorie | null = frais()) {
    poser()
    faux.parTable.encaissements_factures = [{ ...ENCAISSEMENT, ligne_bancaire_id: 'm1' }]
    faux.parTable.lignes_bancaires = [M1]
    faux.parTable.categories = categorieFrais ? [CATEGORIE, categorieFrais] : [CATEGORIE]
  }
  const SOURCES_DU_RELEVE = `lignes_bancaires|${COLONNES_MOUVEMENTS_ECRITURES}`
  const sansPoste = /Frais d’encaissements que la situation ne compte pas \(1\) : 20\/03\/2026 « VIR CLIENT FICTIF », 2,00\s€/

  it('comptent en charge, à la date du mouvement, sous le poste de la catégorie « Frais bancaires »', async () => {
    poserLeMouvement()
    const modale = await ouvrirLaSituation('2026-06-30')
    expect(totalDuPoste(modale, 'Frais financiers')).toMatch(/^-2,00\s€$/)
    expect(totalDuPoste(modale, POSTE_VENTES_FACTUREES)).toMatch(/^500,00\s€$/)
    expect(within(modale).queryByText(/Frais d’encaissements/)).toBeNull()
    // Arrêtée la veille du mouvement : rien.
    await act(async () => { fireEvent.change(screen.getByLabelText('À la date du'), { target: { value: '2026-03-19' } }) })
    expect(totalDuPoste(modale, 'Frais financiers')).toBeNull()
    // Les sources se lisent avec le reste, au montage.
    expect(faux.demandes).toContain(SOURCES_DU_RELEVE)
  })

  it('en engagement aussi, au même poste', async () => {
    poserLeMouvement()
    const modale = await ouvrirLaSituation('2026-06-30', 'engagement')
    expect(totalDuPoste(modale, 'Frais financiers')).toMatch(/^-2,00\s€$/)
  })

  it('sans poste : sur aucune ligne, et dit — avec où le donner', async () => {
    poserLeMouvement(frais({ poste_2035: null }))
    const modale = await ouvrirLaSituation('2026-06-30')
    expect(totalDuPoste(modale, 'Frais financiers')).toBeNull()
    const ligne = within(modale).getByText(sansPoste)
    expect(ligne.textContent).toMatch(/qui n’a pas de poste 2035 \(Clôture, carte « Postes manquants »\)\.$/)
  })

  it('sans catégorie « Frais bancaires » : sur aucune ligne, et dit', async () => {
    poserLeMouvement(null)
    const modale = await ouvrirLaSituation('2026-06-30')
    expect(within(modale).getByText(sansPoste).textContent).toMatch(/que le dossier n’a pas : aucune catégorie de code « frais_bancaires »\.$/)
  })

  it('les ratios : la CAF compte les frais, et dit ceux qu’aucun poste ne porte', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 5, 30, 12, 0, 0))
    try {
      poserLeMouvement()
      render(<FinancementTab plan={PLAN_PAR_DEFAUT} ventesParLesFactures={true} dossierId={D} assujettiTva={true} modeComptable="tresorerie" />)
      await waitFor(() => expect(bouton('Dettes & ratios bancaires').disabled).toBe(false))
      await act(async () => { bouton('Dettes & ratios bancaires').click() })
      // 500 € encaissés moins 2 € de frais en six mois, ramenés à douze.
      expect(screen.getByText(/CAF annuelle estimée/).querySelector('strong')?.textContent).toMatch(/^996,00\s€$/)
      cleanup()
      poserLeMouvement(frais({ poste_2035: null }))
      render(<FinancementTab plan={PLAN_PAR_DEFAUT} ventesParLesFactures={true} dossierId={D} assujettiTva={true} modeComptable="tresorerie" />)
      await waitFor(() => expect(bouton('Dettes & ratios bancaires').disabled).toBe(false))
      await act(async () => { bouton('Dettes & ratios bancaires').click() })
      expect(screen.getByText(/CAF annuelle estimée/).querySelector('strong')?.textContent).toMatch(/^1\s?000,00\s€$/)
      screen.getByText(sansPoste)
    } finally {
      vi.useRealTimers()
    }
  })

  it('le préremplissage du prévisionnel compte les frais, et dit avant le clic ceux qu’aucun poste ne porte', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] })
    vi.setSystemTime(new Date(2027, 1, 15, 12, 0, 0))
    try {
      poserLeMouvement()
      render(<FinancementTab plan={PLAN_PAR_DEFAUT} ventesParLesFactures={true} dossierId={D} assujettiTva={true} modeComptable="tresorerie" />)
      await waitFor(() => expect(bouton('Prévisionnel à 3 ans').disabled).toBe(false))
      await act(async () => { bouton('Prévisionnel à 3 ans').click() })
      expect(screen.queryByText(/Frais d’encaissements que le préremplissage ne compte pas/)).toBeNull()
      await act(async () => { screen.getByRole('button', { name: 'Précharger depuis cette année' }).click() })
      expect((screen.getByLabelText('Charges de référence (€)') as HTMLInputElement).value).toBe('2')
      cleanup()
      poserLeMouvement(frais({ poste_2035: null }))
      render(<FinancementTab plan={PLAN_PAR_DEFAUT} ventesParLesFactures={true} dossierId={D} assujettiTva={true} modeComptable="tresorerie" />)
      await waitFor(() => expect(bouton('Prévisionnel à 3 ans').disabled).toBe(false))
      await act(async () => { bouton('Prévisionnel à 3 ans').click() })
      screen.getByText(/Frais d’encaissements que le préremplissage ne compte pas \(1\) : 20\/03\/2026/)
      // Une autre année de référence n'a pas ces frais : la ligne suit l'année affichée.
      await act(async () => { fireEvent.change(screen.getByLabelText('Année de référence'), { target: { value: '2025' } }) })
      expect(screen.queryByText(/Frais d’encaissements que le préremplissage ne compte pas/)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('les sources lues en partie : le bandeau, ni situation ni ratios, le préremplissage suspendu', async () => {
    poserLeMouvement()
    faux.muetSelonColonnes = { [SOURCES_DU_RELEVE]: 0 }
    render(<FinancementTab plan={PLAN_PAR_DEFAUT} ventesParLesFactures={true} dossierId={D} assujettiTva={true} modeComptable="tresorerie" />)
    const bandeau = await screen.findByText(/Les ventes facturées du dossier n.ont pas pu être lues en entier/)
    expect(bandeau.closest('div')?.textContent).toMatch(/les mouvements du relevé/)
    expect(bouton('Situation intermédiaire').disabled).toBe(true)
    expect(bouton('Dettes & ratios bancaires').disabled).toBe(true)
    // Les autres lectures, entières : aucun autre bandeau.
    expect(screen.queryByText(/Les données du dossier bancaire/)).toBeNull()
    expect(bouton('Prévisionnel à 3 ans').disabled).toBe(false)
    await act(async () => { bouton('Prévisionnel à 3 ans').click() })
    expect((screen.getByRole('button', { name: 'Précharger depuis cette année' }) as HTMLButtonElement).disabled).toBe(true)
    screen.getByText(/Préremplissage suspendu : une lecture est incomplète \(les mouvements du relevé/)
  })

  it('une facture source dans un dossier qui ne se dit pas basculé : les lectures ne se tiennent pas, aucune situation', async () => {
    poserLeMouvement()
    render(<FinancementTab plan={PLAN_PAR_DEFAUT} ventesParLesFactures={false} dossierId={D} assujettiTva={true} modeComptable="tresorerie" />)
    await screen.findByText(/les lectures ne se tiennent pas/)
    expect(bouton('Situation intermédiaire').disabled).toBe(true)
    expect(bouton('Dettes & ratios bancaires').disabled).toBe(true)
    // Et rien n'a demandé les sources d'un dossier qui n'a pas basculé.
    expect(faux.demandes).not.toContain(SOURCES_DU_RELEVE)
  })

  it('un dossier qui bascule, onglet ouvert : les sources se lisent, et tant qu’elles ne sont pas revenues, rien ne s’offre', async () => {
    poser()
    for (const table of ['factures_emises', 'facture_lignes', 'encaissements_factures', 'encaissements_factures_taux']) faux.parTable[table] = []
    faux.parTable.pieces = [piece({ id: 'v2' })]
    const vue = render(<FinancementTab plan={PLAN_PAR_DEFAUT} ventesParLesFactures={false} dossierId={D} assujettiTva={true} modeComptable="tresorerie" />)
    await waitFor(() => expect(bouton('Situation intermédiaire').disabled).toBe(false))
    expect(faux.demandes).not.toContain(SOURCES_DU_RELEVE)
    let liberer: () => void = () => {}
    faux.attentes.lignes_bancaires = new Promise<void>((r) => { liberer = r })
    vue.rerender(<FinancementTab plan={PLAN_PAR_DEFAUT} ventesParLesFactures={true} dossierId={D} assujettiTva={true} modeComptable="tresorerie" />)
    await act(async () => {})
    expect(faux.demandes).toContain(SOURCES_DU_RELEVE)
    expect(bouton('Situation intermédiaire').disabled).toBe(true)
    expect(bouton('Dettes & ratios bancaires').disabled).toBe(true)
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    await act(async () => { liberer() })
    await waitFor(() => expect(bouton('Situation intermédiaire').disabled).toBe(false))
    expect(document.querySelector('[aria-busy="true"]')).toBeNull()
  })

  it('un dossier changé en cours de route ne reprend pas les sources de l’autre', async () => {
    // Le dossier quitté a des frais sans poste, qui se diraient ; le dossier ouvert n'a aucune vente facturée.
    poser()
    faux.parTable.factures_emises = [{ ...FACTURE_SOURCE, dossier_id: 'dossier-quitte' }]
    faux.parTable.encaissements_factures = [{ ...ENCAISSEMENT, dossier_id: 'dossier-quitte', ligne_bancaire_id: 'm1' }]
    faux.parTable.encaissements_factures_taux = [{ ...PART, dossier_id: 'dossier-quitte' }]
    faux.parTable.lignes_bancaires = [{ ...M1, dossier_id: 'dossier-quitte' }]
    faux.parTable.categories = [CATEGORIE, frais({ poste_2035: null })]
    faux.parTable.pieces = [piece({ id: 'v2' })]
    let liberer: () => void = () => {}
    faux.attentes.lignes_bancaires = new Promise<void>((r) => { liberer = r })
    const vue = render(<FinancementTab plan={PLAN_PAR_DEFAUT} ventesParLesFactures={true} dossierId="dossier-quitte" assujettiTva={true} modeComptable="tresorerie" />)
    await act(async () => {})
    faux.attentes = {}
    vue.rerender(<FinancementTab plan={PLAN_PAR_DEFAUT} ventesParLesFactures={true} dossierId={D} assujettiTva={true} modeComptable="tresorerie" />)
    await waitFor(() => expect(bouton('Situation intermédiaire').disabled).toBe(false))
    await act(async () => { liberer() })
    expect(bouton('Situation intermédiaire').disabled).toBe(false)
    await act(async () => { bouton('Situation intermédiaire').click() })
    await act(async () => { fireEvent.change(screen.getByLabelText('À la date du'), { target: { value: '2026-06-30' } }) })
    expect(screen.queryByText(/Frais d’encaissements/)).toBeNull()
    expect(screen.queryByText(/Les ventes facturées du dossier n.ont pas pu être lues/)).toBeNull()
  })
})

// LE VIREMENT MIXTE (chantier EC-Q3, étape VF5h). Le virement m1 du 20 mars paie la facture source (600 €) et une facture
// d'avant la bascule (120 €), dont l'exemplaire est désigné : la situation compte cet exemplaire à la date du virement
// (lib/rattachement.ts, `partsEncaissees`), au poste de sa catégorie, et non à sa date de facture, en décembre 2025 — où
// l'exercice ne le verrait pas. Données FICTIVES.
describe('FinancementTab — le virement mixte date l’exemplaire de la facture d’avant (étape VF5h)', () => {
  const FACTURE_D_AVANT = {
    ...FACTURE_SOURCE, id: 'fa', numero: 'F2025-0099', date_emission: '2025-12-15', tiers_nom: 'CLIENT D’AVANT', source_de_la_vente: false,
  }
  const MIXTE: LigneBancaire = ligneBancaire(mouvementDesVentes({ id: 'm1', dossier_id: D, date: '2026-03-20', montant: 720 }))
  function poserLeVirementMixte() {
    poser({ factures: [FACTURE_SOURCE, FACTURE_D_AVANT], lignes: [LIGNE, { ...LIGNE, id: 'lfa', facture_id: 'fa', prix_unitaire_ht: 100 }] })
    faux.parTable.pieces = [EXEMPLAIRE, piece({
      id: 'pa', nom_fichier: 'F2025-0099.pdf', tiers: 'CLIENT D’AVANT', date_piece: '2025-12-15', montant_ht: 100, montant_tva: 20,
      montant_ttc: 120, facture_id: 'fa',
    })]
    faux.parTable.encaissements_factures = [
      { ...ENCAISSEMENT, ligne_bancaire_id: 'm1' },
      { ...ENCAISSEMENT, id: 'ea', facture_id: 'fa', montant: 120, ligne_bancaire_id: 'm1', cree_le: '2026-03-20T10:05:00Z' },
    ]
    faux.parTable.encaissements_factures_taux = [PART, { encaissement_id: 'ea', dossier_id: D, taux: 20, montant: 120 }]
    faux.parTable.lignes_bancaires = [MIXTE]
  }

  it('la situation compte l’exemplaire à la date du virement, et rien avant lui', async () => {
    poserLeVirementMixte()
    const modale = await ouvrirLaSituation('2026-06-30')
    expect(totalDuPoste(modale, POSTE_VENTES_FACTUREES)).toMatch(/^500,00\s€$/)
    expect(totalDuPoste(modale, 'Recettes')).toMatch(/^100,00\s€$/)
    await act(async () => { fireEvent.change(screen.getByLabelText('À la date du'), { target: { value: '2026-03-19' } }) })
    expect(totalDuPoste(modale, 'Recettes')).toBeNull()
  })
})
