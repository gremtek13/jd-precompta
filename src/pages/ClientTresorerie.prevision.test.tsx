import { act, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClientTresorerie from './ClientTresorerie'
import { NON_COMPTE_PREVISIONNEL_DU_CABINET } from '../lib/tresorerieClient'
import {
  composerLaPrevision, NON_COMPTE_PREVISION_A_PART, PREVISION_AUCUNE, PREVISION_CONTENU_ILLISIBLE, PREVISION_ILLISIBLE,
  PREVISION_PAS_UN_ENGAGEMENT, PREVISION_TITRE, phraseDUnePrevisionPassee, type ContenuDeLaPrevision,
} from '../lib/previsionsPubliees'
import { formatMoney } from '../lib/format'
import type { LigneBanquePourPlan } from '../lib/planTresorerie'

// « MA TRÉSORERIE » ET LA PRÉVISION DE TON CABINET (C8-Q2) : derrière `PREVISIONS_PUBLIEES_PREVUES`, joué dans ses deux états
// par un accesseur. Levé, la prévision se lit à part — la case « Banque » relue à la base dans la même vague —, rien n'en
// est dit avant son retour, lue en partie ou illisible elle se tait sur son motif ; elle se montre dans sa carte, sous le mot
// « prévision », et la projection des montants connus — son solde attendu, son point le plus bas — n'en change jamais.
// Baissé, rien ne se lit et la page est celle d'hier. Le faux client APPLIQUE les filtres d'égalité.

const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, Record<string, unknown>[]>,
  comptesGonfles: {} as Record<string, number>,
  demandes: [] as string[],
  droitsBase: { ventes: false, banque: true, caisse: false } as Record<string, unknown> | null,
  // La lecture des prévisions seule retenue : la projection revient, la prévision pas encore.
  portePrevisions: null as Promise<void> | null,
  prevues: true,
}))

vi.mock('../lib/previsionsPubliees', async (original) => ({
  ...await original<typeof import('../lib/previsionsPubliees')>(),
  get PREVISIONS_PUBLIEES_PREVUES() { return faux.prevues },
}))

vi.mock('../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIn } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      rpc: (nom: string) => {
        faux.demandes.push(`rpc:${nom}`)
        return {
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => Promise.resolve(faux.droitsBase === null
            ? { data: null, error: { message: 'refus' } }
            : { data: faux.droitsBase, error: null }).then(suite, echec),
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
          maybeSingle: () => Promise.resolve({ data: lignes()[0] ?? null, error: null }),
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) =>
            (table === 'previsions_publiees' && faux.portePrevisions ? faux.portePrevisions : Promise.resolve()).then(() => {
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
  useAuth: () => ({ dossierActifId: 'd1', droitsParDossier: { d1: { ventes: false, banque: true, caisse: false } } }),
}))

const ligne = (date: string, sens: 'debit' | 'credit', montant: number): LigneBanquePourPlan => ({ date, sens, montant })
const LIGNES = [ligne('2026-05-04', 'debit', 4000), ligne('2026-06-03', 'debit', 3800), ligne('2026-08-05', 'debit', 4200),
  ligne('2026-09-07', 'debit', 3900), ligne('2026-10-02', 'debit', 4100), ligne('2026-10-20', 'credit', 7000)]

function contenu(): ContenuDeLaPrevision {
  const r = composerLaPrevision({ aujourdHui: '2026-11-10', lignesBanque: LIGNES, ouverture: null, lignesDuRythme: LIGNES,
    nbMoisHistorique: 6, nbMoisProjection: 3, avecEspeces: true })
  if (!r.ok) throw new Error(r.refus)
  return r.contenu
}
const prevision = (o: Record<string, unknown> = {}) => ({
  id: 'p1', dossier_id: 'd1', geste: 'publication', contenu: contenu(), remplace_id: null, publiee_le: '2026-11-10T09:00:00Z', ...o,
})

function poser() {
  faux.parTable = {
    dossiers: [{ id: 'd1', statut_tva: 'exonere', tva_periodicite: 'mensuelle', mode_comptable: 'tresorerie' }],
    controles_releves_bancaires: [
      { id: 'c1', dossier_id: 'd1', solde_final: 1000, coherent: true, periode_fin: '2026-10-31', created_at: '2026-11-01T08:00:00Z' },
    ],
    cotisations_declarees: [
      { id: 'k1', dossier_id: 'd1', echeance: '2026-12-05', previsionnel: false, paiement_personnel_le: null, montant_appele: 1500 },
    ],
    lignes_bancaires: [],
    // La prévision de CE dossier ; celle d'une autre société ne se montre jamais.
    previsions_publiees: [prevision(), prevision({ id: 'px', dossier_id: 'd2' })],
  }
  faux.comptesGonfles = {}
  faux.demandes = []
  faux.droitsBase = { ventes: false, banque: true, caisse: false }
  faux.portePrevisions = null
  faux.prevues = true
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-13T10:00:00Z'))
  poser()
})
afterEach(() => { vi.useRealTimers() })

const page = () => render(<MemoryRouter><ClientTresorerie /></MemoryRouter>)
const rendre = async () => { page(); await act(async () => {}); await act(async () => {}) }
const carte = () => screen.getByRole('region', { name: PREVISION_TITRE })
const nonComptes = () => within(screen.getByRole('region', { name: 'Ce qui n’est pas compté' })).getAllByRole('listitem').map((li) => li.textContent)
const synthese = () => screen.getByRole('region', { name: 'Dans 90 jours' }).textContent ?? ''

describe('« Ma trésorerie » et la prévision de ton cabinet', () => {
  it('la prévision se montre à part, sous le mot « prévision », et ne change ni le solde attendu ni le point le plus bas', async () => {
    await rendre()
    const texte = carte().textContent ?? ''
    expect(within(carte()).getByRole('heading', { level: 2 }).textContent).toContain('prévision')
    expect(texte).toContain(PREVISION_PAS_UN_ENGAGEMENT)
    expect(texte).toContain('Publiée par ton cabinet le 10 novembre 2026.')
    expect(texte).toContain('au 20 octobre 2026, date de sa dernière écriture de banque')
    expect(texte).toContain('Tes recettes en espèces entrent dans ce rythme.')
    // Le raccord (C8Q2-Q3) : du lendemain de la dernière écriture à la fin du mois, au prorata des jours — plus rien
    // n'est « pas compté » dans la prévision.
    expect(texte).toContain('Du 21 octobre 2026 au 30 novembre 2026, après cette dernière écriture, elle compte ce rythme au prorata des jours')
    expect(texte).not.toContain('pas compté')
    const lignes = within(carte()).getAllByRole('row').slice(1).map((r) => r.querySelector('td')?.textContent)
    expect(lignes).toEqual(['Du 21 octobre 2026 au 30 novembre 2026', 'décembre 2026', 'janvier 2027', 'février 2027'])
    const raccord = within(carte()).getAllByRole('row')[1]
    const c = contenu()
    expect(raccord.querySelectorAll('td')[4].textContent).toBe(formatMoney((c.raccord?.solde_fin ?? Number.NaN) / 100))
    expect(within(carte()).getAllByRole('row')[2].querySelectorAll('td')[1].textContent).toBe(formatMoney((c.raccord?.solde_fin ?? Number.NaN) / 100))
    // Le calcul des montants connus : la cotisation du 5 décembre seule, comme sans prévision.
    expect(synthese()).toContain(`Point le plus bas : ${formatMoney(-500)}, le 5 décembre 2026`)
    expect(synthese()).toContain(`Ce qui devrait sortir : ${formatMoney(1500)}`)
    expect(nonComptes()).toContain(NON_COMPTE_PREVISION_A_PART)
    // La case relue à la base deux fois : la projection, puis la prévision.
    expect(faux.demandes.filter((d) => d === 'rpc:droits_sur_le_dossier')).toHaveLength(2)
  })

  it('rien n’est dit de la prévision avant son retour ; la projection, elle, n’attend pas', async () => {
    let ouvrir = () => {}
    faux.portePrevisions = new Promise<void>((r) => { ouvrir = r })
    await rendre()
    expect(synthese()).toContain('Point le plus bas')
    expect(within(carte()).getByText('Chargement…')).toBeTruthy()
    expect(within(carte()).queryByRole('table')).toBeNull()
    await act(async () => { ouvrir() })
    await act(async () => {})
    expect(within(carte()).getByRole('table')).toBeTruthy()
  })

  it('lue en partie : la prévision se tait sur son motif, jamais « aucune » ; la projection reste', async () => {
    faux.comptesGonfles = { previsions_publiees: 1 }
    await rendre()
    expect(within(carte()).getByText(PREVISION_ILLISIBLE)).toBeTruthy()
    expect(within(carte()).queryByText(PREVISION_AUCUNE)).toBeNull()
    expect(synthese()).toContain('Point le plus bas')
  })

  it('aucune prévision publiée, un contenu qui ne se lit pas, une prévision dont tous les mois sont passés', async () => {
    faux.parTable.previsions_publiees = []
    const premier = page()
    await act(async () => {}); await act(async () => {})
    expect(within(carte()).getByText(PREVISION_AUCUNE)).toBeTruthy()
    premier.unmount()
    faux.parTable.previsions_publiees = [prevision({ contenu: { version: 1 } })]
    const second = page()
    await act(async () => {}); await act(async () => {})
    expect(within(carte()).getByText(PREVISION_CONTENU_ILLISIBLE)).toBeTruthy()
    second.unmount()
    vi.setSystemTime(new Date('2027-03-02T10:00:00Z'))
    faux.parTable.previsions_publiees = [prevision()]
    await rendre()
    expect(within(carte()).getByText(phraseDUnePrevisionPassee('2026-11-10'))).toBeTruthy()
    expect(within(carte()).queryByRole('table')).toBeNull()
  })

  it('drapeau baissé : rien ne se lit de la prévision, et la page est celle d’hier', async () => {
    faux.prevues = false
    await rendre()
    expect(faux.demandes).not.toContain('previsions_publiees')
    expect(screen.queryByRole('region', { name: PREVISION_TITRE })).toBeNull()
    expect(nonComptes()).toContain(NON_COMPTE_PREVISIONNEL_DU_CABINET)
    expect(faux.demandes.filter((d) => d === 'rpc:droits_sur_le_dossier')).toHaveLength(1)
  })
})
