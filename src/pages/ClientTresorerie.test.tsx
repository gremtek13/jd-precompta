import { act, cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClientTresorerie from './ClientTresorerie'
import {
  NON_COMPTE_ACHATS, NON_COMPTE_PAS_ENCORE_ENREGISTRE, NON_COMPTE_VENTES_FERMEES, TRESORERIE_BANQUE_FERMEE, TRESORERIE_DROITS_ILLISIBLES, TRESORERIE_INTRODUCTION,
  TRESORERIE_MUETTE, TRESORERIE_PREVISION,
} from '../lib/tresorerieClient'
import { formatMoney } from '../lib/format'

// « MA TRÉSORERIE À 90 JOURS » (étape C8) : rien avant le retour des lectures ; les cases relues à la base d'abord — sans
// « Banque » en base, rien d'autre ne se lit ; « Ventes » ne se lit que si la base ET l'écran l'ouvrent ; une source lue en
// partie rend la projection muette, jamais « 0 » ; ce qui n'est pas compté se dit. Le faux client APPLIQUE les filtres
// d'égalité (src/test/filtresPostgrest.ts) et annonce un `count`, qu'un test peut gonfler pour jouer une lecture partielle.

const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, Record<string, unknown>[]>,
  comptesGonfles: {} as Record<string, number>,
  demandes: [] as string[],
  droitsContexte: {} as Record<string, { ventes: boolean; banque: boolean; caisse: boolean }>,
  droitsBase: { ventes: true, banque: true, caisse: false } as Record<string, unknown> | null,
  porte: null as Promise<void> | null,
  // Le drapeau de B4 (`ACHATS_DU_CLIENT_PREVUS`) : baissé, la page d'avant ; levé, les achats se comptent.
  achatsLeves: false,
}))

vi.mock('../lib/achatsClient', async (original) => ({
  ...await original<typeof import('../lib/achatsClient')>(),
  get ACHATS_DU_CLIENT_PREVUS() { return faux.achatsLeves },
}))

vi.mock('../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIn } = await import('../test/filtresPostgrest')
  const repondre = async <T,>(rendre: () => T) => { await faux.porte; return rendre() }
  return {
    supabase: {
      rpc: (nom: string) => {
        faux.demandes.push(`rpc:${nom}`)
        return {
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => repondre(() => (faux.droitsBase === null
            ? { data: null, error: { message: 'refus' } }
            : { data: faux.droitsBase, error: null })).then(suite, echec),
        }
      },
      from: (table: string) => {
        faux.demandes.push(table)
        const predicats: ReturnType<typeof predicatEq>[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const lignes = () => filtrer(faux.parTable[table] ?? [], predicats)
        const chaine: Record<string, unknown> = {
          select: () => chaine,
          eq: (c: string, v: unknown) => { predicats.push(predicatEq(c, v)); return chaine },
          in: (c: string, v: readonly unknown[]) => { predicats.push(predicatIn(c, v)); return chaine },
          order: () => chaine,
          range: (d: number, f: number) => { debut = d; fin = f; return chaine },
          maybeSingle: () => repondre(() => ({ data: lignes()[0] ?? null, error: null })),
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => repondre(() => {
            const l = lignes()
            return { data: l.slice(debut, fin + 1), error: null, count: l.length + (faux.comptesGonfles[table] ?? 0) }
          }).then(suite, echec),
        }
        return chaine
      },
    },
  }
})

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ dossierActifId: 'd1', droitsParDossier: faux.droitsContexte }),
}))

const FACTURE = {
  dossier_id: 'd1', statut: 'validee', type: 'facture', facture_origine_id: null, source_de_la_vente: false, acompte: false,
  date_emission: '2026-10-01', montant_tva: 0, tiers_nom: 'Atelier Fictif',
}
const ligne = (id: string, facture: string, prix: number, dossier = 'd1') => ({
  id, facture_id: facture, ordre: 1, designation: 'Séance', quantite: 1, prix_unitaire_ht: prix, taux_tva: 0, 'factures_emises.dossier_id': dossier,
})

function poser() {
  faux.parTable = {
    dossiers: [{ id: 'd1', statut_tva: 'exonere', tva_periodicite: 'mensuelle', mode_comptable: 'tresorerie' }],
    controles_releves_bancaires: [
      { id: 'c1', dossier_id: 'd1', solde_final: 1000, coherent: true, periode_fin: '2026-10-31', created_at: '2026-11-01T08:00:00Z' },
      // Une autre société : jamais son solde ici.
      { id: 'cx', dossier_id: 'd2', solde_final: 99999, coherent: true, periode_fin: '2026-11-30', created_at: '2026-11-01T08:00:00Z' },
    ],
    cotisations_declarees: [
      { id: 'k1', dossier_id: 'd1', echeance: '2026-12-05', previsionnel: false, paiement_personnel_le: null, montant_appele: 1500 },
      { id: 'k2', dossier_id: 'd1', echeance: '2027-01-05', previsionnel: true, paiement_personnel_le: null, montant_appele: 100 },
    ],
    factures_emises: [
      { ...FACTURE, id: 'f1', numero: 'F2026-001', date_echeance: '2026-12-10', montant_ht: 800, montant_ttc: 800 },
      { ...FACTURE, id: 'f2', numero: 'F2026-002', date_echeance: '2026-11-01', montant_ht: 300, montant_ttc: 300 },
      { ...FACTURE, id: 'fx', dossier_id: 'd2', numero: 'X1', date_echeance: '2026-12-01', montant_ht: 5000, montant_ttc: 5000 },
    ],
    facture_lignes: [ligne('l1', 'f1', 800), ligne('l2', 'f2', 300), ligne('lx', 'fx', 5000, 'd2')],
    encaissements_factures: [],
    encaissements_factures_taux: [],
    lignes_bancaires: [],
    pieces: [],
    paiements_declares: [],
    reglements_groupes: [],
  }
  faux.achatsLeves = false
  faux.comptesGonfles = {}
  faux.demandes = []
  faux.droitsContexte = { d1: { ventes: true, banque: true, caisse: false } }
  faux.droitsBase = { ventes: true, banque: true, caisse: false }
  faux.porte = null
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-13T10:00:00Z'))
  poser()
})
afterEach(() => { vi.useRealTimers() })

const page = () => render(<MemoryRouter><ClientTresorerie /></MemoryRouter>)
const rendre = async () => { page(); await act(async () => {}); await act(async () => {}) }
const tableau = () => screen.getByRole('table', { name: 'Ta trésorerie jour après jour' })
const nonComptes = () => within(screen.getByRole('region', { name: 'Ce qui n’est pas compté' })).getAllByRole('listitem').map((li) => li.textContent)

describe('« Ma trésorerie à 90 jours »', () => {
  it('ne dit rien avant le retour des lectures, puis la projection jour après jour', async () => {
    let ouvrir = () => {}
    faux.porte = new Promise<void>((r) => { ouvrir = r })
    page()
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.getByText(TRESORERIE_INTRODUCTION)).toBeTruthy()
    expect(screen.queryByText(/€/)).toBeNull()
    await act(async () => { ouvrir() })
    await act(async () => {})
    await act(async () => {})
    expect(screen.queryByText('Chargement…')).toBeNull()
    // Le départ : le solde LU du 31 octobre, jamais celui de l'autre société.
    expect(screen.getByRole('region', { name: 'Ton point de départ' }).textContent).toContain(formatMoney(1000))
    expect(screen.queryByText(new RegExp(formatMoney(99999).replace(/\s/g, '\\s')))).toBeNull()
    // Jour après jour : la cotisation du 5 décembre, la facture du 10, la prévisionnelle du 5 janvier.
    const lignes = within(tableau()).getAllByRole('row').slice(1).map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent))
    expect(lignes).toEqual([
      ['5 décembre 2026', 'Cotisations sociales : échéance', formatMoney(-1500), formatMoney(-500)],
      ['10 décembre 2026', 'Facture F2026-001 : ce que ton client te doit encore', `+ ${formatMoney(800)}`, formatMoney(300)],
      ['5 janvier 2027', 'Cotisations sociales : échéance prévisionnelleprévision', formatMoney(-100), formatMoney(200)],
    ])
    const synthese = screen.getByRole('region', { name: 'Dans 90 jours' }).textContent ?? ''
    expect(synthese).toContain('Jusqu’au 10 février 2027')
    expect(synthese).toContain(`Point le plus bas : ${formatMoney(-500)}, le 5 décembre 2026`)
    expect(screen.getByRole('alert').textContent).toBe('Ton compte passerait à découvert le 5 décembre 2026 : parles-en à ton cabinet.')
    expect(screen.getByText(TRESORERIE_PREVISION)).toBeTruthy()
    // La facture en retard se dit à part, avec sa somme : jamais comptée.
    expect(nonComptes()[0]).toBe(`Une facture en retard : leur encaissement n’a plus de date sûre. (${formatMoney(300)})`)
    expect(nonComptes()).toContain(NON_COMPTE_ACHATS)
    // Drapeau de B4 baissé : ni les achats ni leurs paiements ne se lisent, et la case « Achats » n'est pas même relue.
    expect(faux.demandes).not.toContain('pieces')
    expect(faux.demandes).not.toContain('paiements_declares')
    expect(faux.demandes).not.toContain('reglements_groupes')
    expect(faux.demandes.filter((d) => d === 'rpc:droits_sur_le_dossier')).toHaveLength(1)
    // Ce que rien ne permet de voir se dit en clair, à l'écran.
    expect(nonComptes()).toContain(NON_COMPTE_PAS_ENCORE_ENREGISTRE)
    expect(faux.demandes[0]).toBe('rpc:droits_sur_le_dossier')
  })

  it('les cases relues à la base : sans « Banque » en base, rien d’autre ne se lit', async () => {
    faux.droitsBase = { ventes: true, banque: false, caisse: false }
    await rendre()
    expect(screen.getByText(TRESORERIE_BANQUE_FERMEE)).toBeTruthy()
    expect(faux.demandes).toEqual(['rpc:droits_sur_le_dossier'])
    expect(screen.queryByText(/€/)).toBeNull()
  })

  it('des droits illisibles : rien ne se lit, et la page le dit', async () => {
    faux.droitsBase = null
    await rendre()
    expect(screen.getByText(TRESORERIE_DROITS_ILLISIBLES)).toBeTruthy()
    expect(faux.demandes).toEqual(['rpc:droits_sur_le_dossier'])
  })

  it('« Ventes » ouverte par la base mais pas par l’écran : les ventes ne se lisent pas, et la page le dit', async () => {
    faux.droitsContexte = { d1: { ventes: false, banque: true, caisse: false } }
    await rendre()
    expect(faux.demandes).not.toContain('factures_emises')
    expect(nonComptes()[0]).toBe(NON_COMPTE_VENTES_FERMEES)
    expect(within(tableau()).queryByText(/Facture/)).toBeNull()
  })

  it('« Ventes » ouverte par l’écran mais retirée en base : les ventes ne se lisent pas', async () => {
    faux.droitsBase = { ventes: false, banque: true, caisse: false }
    await rendre()
    expect(faux.demandes).not.toContain('factures_emises')
    expect(nonComptes()[0]).toBe(NON_COMPTE_VENTES_FERMEES)
  })

  it('des factures lues en partie : la projection est muette, le solde lu reste dit, aucun chiffre projeté', async () => {
    faux.comptesGonfles = { factures_emises: 2 }
    await rendre()
    expect(screen.getByText(TRESORERIE_MUETTE)).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Ton point de départ' }).textContent).toContain(formatMoney(1000))
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByText(/Point le plus bas/)).toBeNull()
  })

  it('des échéances lues en partie : muette aussi', async () => {
    faux.comptesGonfles = { cotisations_declarees: 1 }
    await rendre()
    expect(screen.getByText(TRESORERIE_MUETTE)).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('des relevés lus en partie : ni solde ni projection', async () => {
    faux.comptesGonfles = { controles_releves_bancaires: 1 }
    await rendre()
    expect(screen.getByText(TRESORERIE_MUETTE)).toBeTruthy()
    expect(screen.queryByText(/€/)).toBeNull()
  })

  it('une échéance déjà prélevée avant la date du solde ne se compte pas deux fois (suite de C8)', async () => {
    // Le prélèvement du 30 octobre a payé d'avance l'échéance du 5 décembre : il est dans le solde du 31 octobre.
    faux.parTable.lignes_bancaires = [
      { id: 'm1', dossier_id: 'd1', date: '2026-10-30', montant: -1500, cotisation_id: 'k1' },
      { id: 'mx', dossier_id: 'd2', date: '2026-10-30', montant: -1, cotisation_id: 'k2' },
    ]
    await rendre()
    const quoi = within(tableau()).getAllByRole('row').slice(1).map((r) => r.querySelectorAll('td')[1].textContent)
    expect(quoi).toEqual(['Facture F2026-001 : ce que ton client te doit encore', 'Cotisations sociales : échéance prévisionnelleprévision'])
    expect(screen.queryByRole('alert')).toBeNull()
    expect(faux.demandes).toContain('lignes_bancaires')
  })

  it('un relevé lu en partie : muette', async () => {
    faux.parTable.lignes_bancaires = [{ id: 'm1', dossier_id: 'd1', date: '2026-10-30', montant: -1, cotisation_id: null }]
    faux.comptesGonfles = { lignes_bancaires: 1 }
    await rendre()
    expect(screen.getByText(TRESORERIE_MUETTE)).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('aucun relevé contrôlé : la page le dit, et ne projette rien', async () => {
    faux.parTable.controles_releves_bancaires = []
    await rendre()
    expect(screen.getByText(/Pas de solde à afficher/)).toBeTruthy()
    expect(screen.queryByText(/€/)).toBeNull()
  })
})

describe('« Ma trésorerie » compte les achats du client (drapeau de B4 levé)', () => {
  const ACHAT = { dossier_id: 'd1', type_piece: 'achat', tiers: 'Fournisseur fictif', identite_nature: 'facture' }
  function poserLesAchats() {
    faux.achatsLeves = true
    faux.droitsBase = { ventes: true, banque: true, caisse: false, achats: true }
    faux.parTable.pieces = [
      { ...ACHAT, id: 'a1', montant_ttc: 400, date_echeance: '2026-12-01', identite_numero: 'FA-1' },
      // Réglée : le client l'a déclarée payée.
      { ...ACHAT, id: 'a2', montant_ttc: 90, date_echeance: '2026-12-02', identite_numero: 'FA-2' },
      // Réglée : un mouvement du relevé, daté d'avant le solde, la cite.
      { ...ACHAT, id: 'a3', montant_ttc: 60, date_echeance: '2026-12-03', identite_numero: 'FA-3' },
      // En retard : dite à part, jamais comptée.
      { ...ACHAT, id: 'a4', montant_ttc: 25, date_echeance: '2026-11-02', identite_numero: 'FA-4' },
      // D'une autre société, et une pièce qui n'est pas un achat : jamais lues ici.
      { ...ACHAT, id: 'ax', dossier_id: 'd2', montant_ttc: 7777, date_echeance: '2026-12-01' },
      { ...ACHAT, id: 'v1', type_piece: 'vente', montant_ttc: 5555, date_echeance: '2026-12-01' },
    ]
    faux.parTable.paiements_declares = [
      { id: 'p1', dossier_id: 'd1', piece_id: 'a2', date_paiement: '2026-10-20', montant: 90, retire_le: null },
      { id: 'px', dossier_id: 'd1', piece_id: 'a1', date_paiement: '2026-10-20', montant: 400, retire_le: '2026-10-21T09:00:00Z' },
    ]
    faux.parTable.lignes_bancaires = [{ id: 'm1', dossier_id: 'd1', date: '2026-10-28', montant: -60, cotisation_id: null, piece_id: 'a3' }]
  }

  it('les cases relues à la base D’ABORD, puis les achats à venir sortent à leur échéance ; réglés et en retard, jamais comptés', async () => {
    poserLesAchats()
    await rendre()
    const lignes = within(tableau()).getAllByRole('row').slice(1).map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent))
    expect(lignes).toEqual([
      ['1er décembre 2026', 'Facture FA-1 de Fournisseur fictif : ce que tu dois encore', formatMoney(-400), formatMoney(600)],
      ['5 décembre 2026', 'Cotisations sociales : échéance', formatMoney(-1500), formatMoney(-900)],
      ['10 décembre 2026', 'Facture F2026-001 : ce que ton client te doit encore', `+ ${formatMoney(800)}`, formatMoney(-100)],
      ['5 janvier 2027', 'Cotisations sociales : échéance prévisionnelleprévision', formatMoney(-100), formatMoney(-200)],
    ])
    const texte = screen.getByRole('region', { name: 'Dans 90 jours' }).textContent ?? ''
    expect(texte).toContain(`Point le plus bas : ${formatMoney(-900)}, le 5 décembre 2026`)
    // La facture d'achat en retard se dit avec sa somme ; la ligne « non suivis » a disparu.
    expect(nonComptes()).toContain(`Une facture d’achat en retard : tu la dois encore, mais la date de son paiement n’est plus sûre. (${formatMoney(25)})`)
    expect(nonComptes()).not.toContain(NON_COMPTE_ACHATS)
    // La case « Achats » est relue AVANT toute lecture des achats ; seules les lignes de la société affichée se lisent.
    const premierePiece = faux.demandes.indexOf('pieces')
    expect(faux.demandes.indexOf('rpc:droits_sur_le_dossier')).toBeLessThan(premierePiece)
    expect(faux.demandes.filter((d) => d === 'rpc:droits_sur_le_dossier')).toHaveLength(2)
    expect(faux.demandes).toEqual(expect.arrayContaining(['paiements_declares', 'reglements_groupes']))
    expect(screen.queryByText(new RegExp(formatMoney(7777).replace(/\s/g, '\\s')))).toBeNull()
  })

  it('sans la case « Achats » en base : rien des achats ne se lit, et « non comptés » se dit comme avant', async () => {
    poserLesAchats()
    faux.droitsBase = { ventes: true, banque: true, caisse: false, achats: false }
    await rendre()
    expect(faux.demandes).not.toContain('pieces')
    expect(faux.demandes).not.toContain('paiements_declares')
    expect(faux.demandes).not.toContain('reglements_groupes')
    expect(nonComptes()).toContain(NON_COMPTE_ACHATS)
    expect(within(tableau()).queryByText(/Facture FA-1/)).toBeNull()
    // Seul `true` accorde la case.
    faux.demandes = []
    cleanup()
    faux.droitsBase = { ventes: true, banque: true, caisse: false, achats: 'true' }
    await rendre()
    expect(faux.demandes).not.toContain('pieces')
    expect(nonComptes()).toContain(NON_COMPTE_ACHATS)
  })

  it('des achats lus en partie : la projection est muette, aucun chiffre', async () => {
    poserLesAchats()
    faux.comptesGonfles = { pieces: 1 }
    await rendre()
    expect(screen.getByText(TRESORERIE_MUETTE)).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByText(/Point le plus bas/)).toBeNull()
  })

  it('un relevé rapproché d’une facture d’achat APRÈS le solde se dit, sans que la facture soit comptée', async () => {
    poserLesAchats()
    faux.parTable.lignes_bancaires = [{ id: 'm1', dossier_id: 'd1', date: '2026-11-05', montant: -60, cotisation_id: null, piece_id: 'a3' }]
    await rendre()
    expect(nonComptes()).toContain(`Payé sur tes factures d’achat depuis le 31 octobre 2026, date de ton dernier relevé contrôlé : ni dans ton solde, ni compté ici. (${formatMoney(60)})`)
  })
})
