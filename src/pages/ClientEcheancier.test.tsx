import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClientEcheancier from './ClientEcheancier'
import EcheancierAccueil from './EcheancierAccueil'
import { ECHEANCIER_ILLISIBLE, ECHEANCIER_SANS_MONTANTS, ECHEANCIER_VIDE } from '../lib/echeancierClient'
import { formatMoney } from '../lib/format'

// « MON ÉCHÉANCIER » ET SA CARTE DE L'ACCUEIL (ligne 51.5, étape C1) : « Chargement… » tant que la lecture n'est pas revenue ;
// les dates pour tout accès, les montants des cotisations sous « Banque » seulement — et sans elle, la colonne n'est même pas
// DEMANDÉE ; une lecture partielle se dit au-dessus de ce qui a été lu, jamais « aucune échéance » ; illisible, l'écran le
// dit et ne montre rien d'autre. Le faux client applique les filtres par égalité et ne rend que les colonnes demandées.

const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, Record<string, unknown>[]>,
  erreurs: {} as Record<string, { message: string } | undefined>,
  selects: [] as { table: string; colonnes: string }[],
  droits: {} as Record<string, { ventes: boolean; banque: boolean; caisse: boolean }>,
  porte: null as Promise<void> | null,
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const filtres: [string, unknown][] = []
      let colonnes = '*'
      let debut = 0
      let fin = Number.MAX_SAFE_INTEGER
      const lignes = () => (faux.parTable[table] ?? [])
        .filter((l) => filtres.every(([c, v]) => l[c] === v))
        .map((l) => (colonnes === '*' ? l : Object.fromEntries(colonnes.split(',').map((c) => c.trim()).map((c) => [c, l[c]]))))
      const repondre = async <T,>(rendre: () => T) => { await faux.porte; return rendre() }
      const chaine: Record<string, unknown> = {
        select: (c: string) => { colonnes = c; faux.selects.push({ table, colonnes: c }); return chaine },
        eq: (c: string, v: unknown) => { filtres.push([c, v]); return chaine },
        order: () => chaine,
        range: (d: number, f: number) => { debut = d; fin = f; return chaine },
        maybeSingle: () => repondre(() => (faux.erreurs[table]
          ? { data: null, error: faux.erreurs[table] }
          : { data: lignes()[0] ?? null, error: null })),
        then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => repondre(() => (faux.erreurs[table]
          ? { data: null, error: faux.erreurs[table], count: null }
          : { data: lignes().slice(debut, fin + 1), error: null, count: lignes().length })).then(suite, echec),
      }
      return chaine
    },
  },
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ dossierActifId: 'd1', droitsParDossier: faux.droits }),
}))

function poser(statut_tva: string | null = 'franchise', tva_periodicite = 'trimestrielle', mode: string = 'tresorerie') {
  faux.parTable = {
    dossiers: [{ id: 'd1', statut_tva, tva_periodicite, mode_comptable: mode }, { id: 'd2', statut_tva: 'redevable', tva_periodicite: 'mensuelle', mode_comptable: 'tresorerie' }],
    cotisations_declarees: [
      { id: 'c-passee', dossier_id: 'd1', echeance: '2026-10-05', previsionnel: false, paiement_personnel_le: null, montant_appele: 111 },
      { id: 'c-novembre', dossier_id: 'd1', echeance: '2026-11-20', previsionnel: false, paiement_personnel_le: null, montant_appele: 1234.5 },
      { id: 'c-prevue', dossier_id: 'd1', echeance: '2027-02-05', previsionnel: true, paiement_personnel_le: null, montant_appele: 987 },
      { id: 'c-autre', dossier_id: 'd2', echeance: '2026-11-21', previsionnel: false, paiement_personnel_le: null, montant_appele: 5555 },
    ],
  }
  faux.erreurs = {}
  faux.selects = []
  faux.droits = {}
  faux.porte = null
}

function avecBanque() { faux.droits = { d1: { ventes: false, banque: true, caisse: false } } }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-06T10:00:00Z'))
  poser()
})
afterEach(() => { vi.useRealTimers() })

function page() { return render(<MemoryRouter><ClientEcheancier /></MemoryRouter>) }
function carte() { return render(<MemoryRouter><div className="bento"><EcheancierAccueil dossierId="d1" /></div></MemoryRouter>) }

describe('« Mon échéancier »', () => {
  it('dit « Chargement… » tant que la lecture n’est pas revenue, puis ses échéances, rangées par mois', async () => {
    let ouvrir = () => {}
    faux.porte = new Promise<void>((r) => { ouvrir = r })
    page()
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByText(ECHEANCIER_VIDE)).toBeNull()
    expect(screen.queryByText(/Cotisations sociales/)).toBeNull()
    await act(async () => { ouvrir() })
    expect(await screen.findByRole('heading', { name: 'Novembre 2026' })).toBeTruthy()
    expect(screen.getByText('20 novembre 2026')).toBeTruthy()
    // Ni la cotisation passée, ni celle d'une autre société.
    expect(screen.queryByText('5 octobre 2026')).toBeNull()
    expect(screen.queryByText('21 novembre 2026')).toBeNull()
    expect(screen.getByText('Prévisionnelle')).toBeTruthy()
    expect(screen.queryByText('Chargement…')).toBeNull()
  })

  it('sans « Banque » : les dates, aucun montant, la colonne pas même demandée, et l’écran le dit', async () => {
    page()
    expect(await screen.findByText(ECHEANCIER_SANS_MONTANTS)).toBeTruthy()
    expect(document.body.textContent).not.toContain('€ ')
    expect(document.body.textContent).not.toContain(formatMoney(1234.5))
    expect(document.querySelector('.echeance-montant')).toBeNull()
    const cotisations = faux.selects.filter((s) => s.table === 'cotisations_declarees')
    expect(cotisations.length).toBeGreaterThan(0)
    expect(cotisations.every((s) => !s.colonnes.includes('montant'))).toBe(true)
  })

  it('avec « Banque » : le montant appelé, et l’estimation d’une prévisionnelle dite comme telle', async () => {
    avecBanque()
    page()
    await waitFor(() => expect(document.querySelector('[data-echeance="cotisation-c-novembre"] .echeance-montant')?.textContent).toBe(formatMoney(1234.5)))
    const prevue = document.querySelector('[data-echeance="cotisation-c-prevue"] .echeance-montant')
    expect(prevue?.textContent).toBe(`≈ ${formatMoney(987)}estimation`)
    expect(screen.queryByText(ECHEANCIER_SANS_MONTANTS)).toBeNull()
  })

  it('la 2035 figure pour un BNC en trésorerie, pas pour un dossier en engagement', async () => {
    const LIASSE = /Déclaration de tes revenus 2026 \(2035\)/
    const { unmount } = page()
    expect(await screen.findByText(LIASSE)).toBeTruthy()
    unmount()
    poser('franchise', 'trimestrielle', 'engagement')
    page()
    expect(await screen.findByText('20 novembre 2026')).toBeTruthy()
    expect(screen.queryByText(LIASSE)).toBeNull()
    expect(screen.getAllByText(/CFE/).length).toBeGreaterThan(0)
  })

  it('un modèle comptable illisible : lu en partie, la 2035 n’est pas affirmée', async () => {
    poser('franchise', 'trimestrielle', 'inconnu')
    page()
    expect(await screen.findByText(/Ton échéancier n'a pas pu être affiché en entier/)).toBeTruthy()
    expect(screen.queryByText(/Déclaration de tes revenus 2026 \(2035\)/)).toBeNull()
    expect(screen.queryByText(ECHEANCIER_VIDE)).toBeNull()
  })

  it('un dossier redevable mensuel : la CA3 au mois, sans jour', async () => {
    poser('redevable', 'mensuelle')
    page()
    expect(await screen.findByText('TVA d’octobre 2026 : déclaration (CA3) et paiement')).toBeTruthy()
    expect(screen.getAllByText('courant novembre 2026').length).toBe(1)
  })

  it('lu en partie : le bandeau le dit au-dessus de ce qui a été lu, et jamais « aucune échéance »', async () => {
    faux.erreurs = { cotisations_declarees: { message: 'refus fictif' } }
    page()
    expect(await screen.findByText(/Ton échéancier n'a pas pu être affiché en entier/)).toBeTruthy()
    // Le calendrier fiscal, lui, ne dépend d'aucune lecture.
    expect(screen.getAllByText(/CFE/).length).toBeGreaterThan(0)
    expect(screen.queryByText(ECHEANCIER_VIDE)).toBeNull()
    expect(screen.queryByText(/Cotisations sociales/)).toBeNull()
  })

  it('illisible : l’écran le dit, et rien d’autre', async () => {
    faux.erreurs = { cotisations_declarees: { message: 'refus fictif' }, dossiers: { message: 'refus fictif' } }
    page()
    expect(await screen.findByText(ECHEANCIER_ILLISIBLE)).toBeTruthy()
    expect(document.querySelector('.echeance')).toBeNull()
    expect(screen.queryByText(ECHEANCIER_VIDE)).toBeNull()
  })
})

describe('la carte de l’accueil', () => {
  it('« Chargement… », puis les quatre premières échéances et le lien vers la page, sans montant sans « Banque »', async () => {
    let ouvrir = () => {}
    faux.porte = new Promise<void>((r) => { ouvrir = r })
    carte()
    expect(screen.getByText('Chargement…')).toBeTruthy()
    await act(async () => { ouvrir() })
    expect(await screen.findByText('20 novembre 2026')).toBeTruthy()
    expect(document.querySelectorAll('.echeance')).toHaveLength(4)
    expect(screen.getByRole('link', { name: 'Tout voir' }).getAttribute('href')).toBe('/mon-echeancier')
    expect(document.querySelector('.echeance-montant')).toBeNull()
    expect(screen.getByText(ECHEANCIER_SANS_MONTANTS)).toBeTruthy()
  })

  it('avec « Banque », le montant de la cotisation', async () => {
    avecBanque()
    carte()
    await waitFor(() => expect(document.querySelector('[data-echeance="cotisation-c-novembre"] .echeance-montant')?.textContent).toBe(formatMoney(1234.5)))
  })

  it('lue en partie, elle le dit ; illisible, elle le dit sans liste', async () => {
    faux.erreurs = { dossiers: { message: 'refus fictif' } }
    const { unmount } = carte()
    expect(await screen.findByText(/n’a pas pu être lu en entier/)).toBeTruthy()
    unmount()
    faux.erreurs = { dossiers: { message: 'refus fictif' }, cotisations_declarees: { message: 'refus fictif' } }
    carte()
    expect(await screen.findByText(ECHEANCIER_ILLISIBLE)).toBeTruthy()
    expect(document.querySelector('.echeance')).toBeNull()
  })
})
