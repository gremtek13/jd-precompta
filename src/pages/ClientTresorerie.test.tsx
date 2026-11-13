import { act, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClientTresorerie from './ClientTresorerie'
import {
  NON_COMPTE_ACHATS, NON_COMPTE_VENTES_FERMEES, TRESORERIE_BANQUE_FERMEE, TRESORERIE_DROITS_ILLISIBLES, TRESORERIE_INTRODUCTION,
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
  droitsBase: { ventes: true, banque: true, caisse: false } as Record<string, boolean> | null,
  porte: null as Promise<void> | null,
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
  }
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

  it('aucun relevé contrôlé : la page le dit, et ne projette rien', async () => {
    faux.parTable.controles_releves_bancaires = []
    await rendre()
    expect(screen.getByText(/Pas de solde à afficher/)).toBeTruthy()
    expect(screen.queryByText(/€/)).toBeNull()
  })
})
