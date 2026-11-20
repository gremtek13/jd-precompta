import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import DuContrePaye from './DuContrePaye'
import { RESERVE_DES_CAISSES } from '../lib/duContrePayeVue'
import type { FactureLu } from '../lib/factureAssuranceMaladieLecture'
import type { PaiementsLus } from '../lib/paiementsAssuranceMaladieLecture'
import type { FactureAssuranceMaladie as Total, ImportAssuranceMaladie, ImportFacturesAssuranceMaladie, PaiementAssuranceMaladie } from '../lib/types'

// La section « ce que l'assurance maladie doit » (BOR5) : drapeau baissé, rien n'est monté ni lu ; rien avant le retour des deux
// lectures ; une lecture partielle ne confronte rien et le dit ; la fenêtre proposée est la période commune ; le reste se dit
// estimé, sous la réserve des caisses ; la fenêtre que l'un des côtés ne couvre pas se dit, jamais 0. Des chiffres FABRIQUÉS.

const faux = vi.hoisted(() => ({
  drapeau: true,
  facture: null as FactureLu | null,
  paye: null as PaiementsLus | null,
  lectures: 0,
}))

vi.mock('../lib/duContrePayeVue', async (original) => ({
  ...await original<typeof import('../lib/duContrePayeVue')>(),
  get DU_CONTRE_PAYE_PREVU() { return faux.drapeau },
}))
vi.mock('../lib/importDuFactureAssuranceMaladie', async (original) => ({
  ...await original<typeof import('../lib/importDuFactureAssuranceMaladie')>(),
  FACTURES_ASSURANCE_MALADIE_PREVUES: true,
}))
vi.mock('../lib/factureAssuranceMaladieLecture', () => ({
  lireLeFactureAssuranceMaladie: () => { faux.lectures++; return faux.facture ? Promise.resolve(faux.facture) : new Promise(() => {}) },
}))
vi.mock('../lib/paiementsAssuranceMaladieLecture', () => ({
  lireLesPaiementsAssuranceMaladie: () => { faux.lectures++; return faux.paye ? Promise.resolve(faux.paye) : new Promise(() => {}) },
}))
vi.mock('../lib/supabase', () => ({ supabase: {} }))

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-04-20T10:00:00Z')) })
afterAll(() => { vi.useRealTimers() })
afterEach(() => { faux.drapeau = true; faux.facture = null; faux.paye = null; faux.lectures = 0 })

const lue = <T,>(lignes: T[], complete = true) => ({ lignes, complete, motif: complete ? null : 'lecture interrompue' })
const importFacture = (premier: string, dernier: string): ImportFacturesAssuranceMaladie => ({
  id: `if-${premier}`, dossier_id: 'd1', premier_lot_le: premier, dernier_lot_le: dernier, nombre_de_lots: 1, nombre_de_factures: 3,
  importe_par: 'u1', importe_le: '2026-04-16T09:00:00Z',
})
const total = (date: string, montant: number): Total => ({
  id: `t-${date}`, dossier_id: 'd1', import_id: `if-x`, date_creation_lot: date, part: 'obligatoire', regime: 1, caisse: 349,
  organisme_complementaire: null, montant_centimes: montant, nombre_de_lots: 1, nombre_de_factures: 3,
})
const importPaye = (du: string, au: string): ImportAssuranceMaladie => ({
  id: `ip-${du}`, dossier_id: 'd1', periode_du: du, periode_au: au, nombre_de_rejets: null, montant_rejete_centimes: null,
  importe_par: 'u1', importe_le: '2026-04-16T09:00:00Z',
})
const paiement = (date: string, montant: number): PaiementAssuranceMaladie => ({
  id: `p-${date}`, dossier_id: 'd1', import_id: 'ip-x', date_journee_comptable: date, regime: 1, caisse: 349, organisme_complementaire: null,
  part: 'obligatoire', montant_centimes: montant, regularisations_centimes: 0, nombre_de_factures: 2,
})
const factureLue = (complete = true): FactureLu => ({
  dossierId: 'd1', etat: 'lus', imports: lue([importFacture('2026-03-02', '2026-03-30')]),
  totaux: lue([total('2026-03-02', 10_000), total('2026-03-30', 4_000)], complete),
})
const payeLu = (): PaiementsLus => ({
  dossierId: 'd1', etat: 'lus', imports: lue([importPaye('2026-03-05', '2026-04-10')]), paiements: lue([paiement('2026-03-09', 10_000)]), associations: null,
})

const texte = () => document.body.textContent ?? ''

describe('ce que l’assurance maladie doit, à l’écran du cabinet', () => {
  it('drapeau baissé : rien n’est monté ni lu', () => {
    faux.drapeau = false
    const { container } = render(<DuContrePaye dossierId="d1" />)
    expect(container.innerHTML).toBe('')
    expect(faux.lectures).toBe(0)
  })

  it('rien avant le retour des deux lectures', async () => {
    faux.facture = factureLue()
    render(<DuContrePaye dossierId="d1" />)
    await act(async () => {})
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(texte()).not.toMatch(/Reste estimé/)
  })

  it('une lecture partielle ne confronte rien, et le dit', async () => {
    faux.facture = factureLue(false); faux.paye = payeLu()
    render(<DuContrePaye dossierId="d1" />)
    await act(async () => {})
    expect(texte()).toContain('Rien n’est confronté : les bordereaux n’ont pas pu être lus en entier.')
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('la période commune proposée ; le reste estimé, sous la réserve des caisses ; une fenêtre non couverte se dit', async () => {
    faux.facture = factureLue(); faux.paye = payeLu()
    render(<DuContrePaye dossierId="d1" />)
    await act(async () => {})
    expect(texte()).toContain(RESERVE_DES_CAISSES)
    const [du, au] = screen.getAllByDisplayValue(/^2026-/) as HTMLInputElement[]
    expect([du.value, au.value]).toEqual(['2026-03-05', '2026-03-30'])
    // Le lot du 2 mars est avant l'origine (le 5) : hors du compte ; celui du 30 reste ouvert, onze jours avant la situation du 10 avril.
    const tableau = screen.getByRole('table')
    expect(tableau.textContent).toContain('CPAM, caisse 349')
    expect(tableau.textContent?.replace(/\s/g, ' ')).toMatch(/40,00 €/)
    expect(texte()).toContain('Situation au 10/04/2026')
    expect(texte()).not.toMatch(/impay/i)
    fireEvent.change(du, { target: { value: '2026-03-01' } })
    expect(texte()).toContain('Rien n’est confronté sur cette fenêtre : les bordereaux et les paiements NOEMIE ne la couvrent pas.')
    expect(screen.queryByRole('table')).toBeNull()
  })
})
