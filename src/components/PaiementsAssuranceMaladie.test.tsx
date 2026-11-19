import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import PaiementsAssuranceMaladie from './PaiementsAssuranceMaladie'
import { REFUS_DE_LA_FONCTION, refusDuConflit } from '../lib/paiementsAssuranceMaladie'
import { phraseApresLImport } from '../lib/paiementsAssuranceMaladieVue'
import { refusDuRetraitDImportDit } from '../lib/associationsAssuranceMaladieVue'
import type { PaiementsLus } from '../lib/paiementsAssuranceMaladieLecture'
import type { ImportAssuranceMaladie, PaiementAssuranceMaladie } from '../lib/types'

// L'écran des paiements de l'assurance maladie (NOE4) : drapeau baissé, rien n'est monté ni lu ; rien avant le retour ; une
// lecture partielle n'offre aucun geste ; le fichier — FABRIQUÉ, des noms et des numéros manifestement faux — ne montre que ses
// en-têtes et leurs genres, l'aperçu que des agrégats ; le refus de la base dit avant le clic ; la confirmation nomme ce qui
// part ; un envoi pour deux clics (le verrou) ; la phrase de NOE3-Q1 et la relecture après l'import.

const faux = vi.hoisted(() => ({
  drapeau: true,
  lecture: null as PaiementsLus | null,
  lectures: 0,
  appels: [] as { nom: string; args: Record<string, unknown> }[],
  retenir: [] as (() => void)[],
}))

vi.mock('../lib/paiementsAssuranceMaladie', async (original) => ({
  ...await original<typeof import('../lib/paiementsAssuranceMaladie')>(),
  get PAIEMENTS_ASSURANCE_MALADIE_PREVUS() { return faux.drapeau },
}))
vi.mock('../lib/paiementsAssuranceMaladieLecture', () => ({
  lireLesPaiementsAssuranceMaladie: () => { faux.lectures++; return faux.lecture ? Promise.resolve(faux.lecture) : new Promise(() => {}) },
}))
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (nom: string, args: Record<string, unknown>) => {
      faux.appels.push({ nom, args })
      return new Promise((r) => { faux.retenir.push(() => r({ data: {}, error: null })) })
    },
  },
}))

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-17T10:00:00Z')) })
afterAll(() => { vi.useRealTimers() })
afterEach(() => { faux.drapeau = true; faux.lecture = null; faux.lectures = 0; faux.appels = []; faux.retenir = [] })

const lue = <T,>(lignes: T[], complete = true) => ({ lignes, complete, motif: complete ? null : 'lecture interrompue' })
const lus = (paiements: PaiementAssuranceMaladie[] = [], complete = true): PaiementsLus =>
  ({ dossierId: 'd1', etat: 'lus', imports: lue([]), paiements: lue(paiements, complete), associations: null })

// Ce qui ne doit jamais paraître à l'écran : les valeurs du fichier qui ne sont pas des agrégats.
const SECRETS = ['F-778801', 'DUPONT-ESSAI', 'Jeannine', 'MARTIN-FICTIF', 'LEFAUX', '2 99 99 99', '26,50', '19,00']
const EXPORT = [
  'N° facture;Nom du patient;NIR;Journée comptable;Caisse;Montant AMO;Statut AMO',
  'F-778801;DUPONT-ESSAI Jeannine;2 99 99 99 999 999 01;02/11/2026;691;26,50;Payée',
  'F-778802;MARTIN-FICTIF Paul;1 99 99 99 999 999 02;02/11/2026;691;19,00;Payée',
  'F-778803;LEFAUX Zoé;2 99 99 99 999 999 03;03/11/2026;691;12,00;Rejetée',
  '',
].join('\n')

function fichier(texte: string): File {
  const octets = new TextEncoder().encode(texte)
  const f = new File([octets as Uint8Array<ArrayBuffer>], 'paiements.csv', { type: 'text/csv' })
  Object.defineProperty(f, 'arrayBuffer', { value: async () => octets.buffer.slice(0) })
  return f
}

const fenetre = () => screen.getByRole('dialog')
const lisible = (t: string | null) => (t ?? '').replace(/[  ]/g, ' ')

async function ouvrirEtDeposer() {
  fireEvent.click(await screen.findByRole('button', { name: 'Importer un fichier de paiements' }))
  const entree = within(fenetre()).getByLabelText(/^Fichier CSV/) as HTMLInputElement
  Object.defineProperty(entree, 'files', { value: [fichier(EXPORT)], configurable: true })
  await act(async () => { fireEvent.change(entree) })
}

function regler() {
  const f = within(fenetre())
  fireEvent.click(f.getByLabelText('Part obligatoire'))
  fireEvent.change(f.getByLabelText('Journée comptable'), { target: { value: '3' } })
  fireEvent.change(f.getByLabelText('Montant payé'), { target: { value: '5' } })
  fireEvent.change(f.getByLabelText('Statut (au choix)'), { target: { value: '6' } })
  fireEvent.change(f.getByLabelText('Numéro de la caisse (au choix)'), { target: { value: '4' } })
}

describe('les paiements de l’assurance maladie, à l’écran', () => {
  it('drapeau baissé : rien n’est monté, rien n’est lu', () => {
    faux.drapeau = false
    const { container } = render(<PaiementsAssuranceMaladie espace="client" dossierId="d1" codeNaf="86.90D" />)
    expect(container.innerHTML).toBe('')
    expect(faux.lectures).toBe(0)
  })

  it('hors d’un code NAF de santé, absent, illisible ou pas lu, sans import (NOE4-Q1 (C)) : rien n’est monté, dans les deux espaces', async () => {
    // Les imports se lisent (NOE4Q1-Q2 (A) : un import l'emporterait) ; aucun, ou pas encore revenus, rien ne se monte.
    for (const lecture of [lus([], true), null]) {
      faux.lecture = lecture
      for (const espace of ['client', 'cabinet'] as const) {
        for (const codeNaf of ['69.20Z', '87.10A', null, undefined, 'Infirmier']) {
          const { container, unmount } = render(<PaiementsAssuranceMaladie espace={espace} dossierId="d1" codeNaf={codeNaf} />)
          await act(async () => {})
          expect(container.innerHTML, `${espace} ${String(codeNaf)}`).toBe('')
          unmount()
        }
      }
    }
  })

  it('dès qu’un import est lu (NOE4Q1-Q2 (A)) : la section reste offerte, gestes compris, quel que soit le code NAF', async () => {
    const IMPORT_LU: ImportAssuranceMaladie = {
      id: 'i1', dossier_id: 'd1', periode_du: '2026-03-03', periode_au: '2026-03-03', nombre_de_rejets: 0,
      montant_rejete_centimes: 0, importe_par: 'u', importe_le: '2026-03-06T09:00:00Z',
    }
    const avecUnImport: PaiementsLus = { dossierId: 'd1', etat: 'lus', imports: lue([IMPORT_LU]), paiements: lue([]), associations: null }
    faux.lecture = avecUnImport
    const vue = render(<PaiementsAssuranceMaladie espace="cabinet" dossierId="d1" codeNaf="69.20Z" />)
    expect(await screen.findByRole('button', { name: 'Importer un fichier de paiements' })).toBeTruthy()
    vue.unmount()
    // Une lecture partielle qui ne rend aucune ligne ne prouve rien : le code décide seul.
    const enPartie: PaiementsLus = { dossierId: 'd1', etat: 'lus', imports: lue([], false), paiements: lue([]), associations: null }
    faux.lecture = enPartie
    const { container } = render(<PaiementsAssuranceMaladie espace="client" dossierId="d1" codeNaf={null} />)
    await act(async () => {})
    expect(container.innerHTML).toBe('')
  })

  it('rien avant le retour ; une lecture partielle n’offre aucun geste', async () => {
    const premier = render(<PaiementsAssuranceMaladie espace="client" dossierId="d1" codeNaf="86.90D" />)
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    premier.unmount()
    faux.lecture = lus([], false)
    render(<PaiementsAssuranceMaladie espace="client" dossierId="d1" codeNaf="86.90D" />)
    expect(await screen.findByText(/Tes paiements importés/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('le fichier ne montre que ses en-têtes et leurs genres ; rien n’est choisi d’avance ; l’aperçu n’a que des agrégats', async () => {
    faux.lecture = lus()
    render(<PaiementsAssuranceMaladie espace="cabinet" dossierId="d1" codeNaf="86.90D" />)
    await ouvrirEtDeposer()
    const colonnes = within(fenetre()).getByRole('table', { name: 'Colonnes du fichier' })
    const ligneDuNom = within(colonnes).getByText('Nom du patient').closest('tr') as HTMLElement
    expect(within(ligneDuNom).getByText('texte')).toBeTruthy()
    expect(within(fenetre()).getByText(/L’aperçu attend : Cocher la part obligatoire/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Importer' }) as HTMLButtonElement).disabled).toBe(true)
    regler()
    const apercu = within(fenetre()).getByRole('table', { name: 'Aperçu des paiements' })
    expect(within(apercu).getAllByRole('row')).toHaveLength(2)
    expect(lisible(apercu.textContent)).toContain('45,50 €')
    expect(lisible(fenetre().textContent)).toContain('1 rejet, 12,00 €')
    for (const s of SECRETS) expect(document.body.textContent).not.toContain(s)
  })

  it('le refus de la base se dit avant le clic : un paiement déjà en base avec d’autres chiffres, puis rien de neuf', async () => {
    const enBase = (montant: number): PaiementAssuranceMaladie => ({
      id: 'p1', dossier_id: 'd1', import_id: 'i1', date_journee_comptable: '2026-11-02', regime: null, caisse: 691, organisme_complementaire: null,
      part: 'obligatoire', montant_centimes: montant, regularisations_centimes: 0, nombre_de_factures: 2,
    })
    faux.lecture = lus([enBase(9999)])
    const premier = render(<PaiementsAssuranceMaladie espace="client" dossierId="d1" codeNaf="86.90D" />)
    await ouvrirEtDeposer()
    regler()
    expect(within(fenetre()).getByText(refusDuConflit('2026-11-02'))).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Importer' }) as HTMLButtonElement).disabled).toBe(true)
    premier.unmount()
    faux.lecture = lus([enBase(4550)])
    render(<PaiementsAssuranceMaladie espace="client" dossierId="d1" codeNaf="86.90D" />)
    await ouvrirEtDeposer()
    regler()
    expect(within(fenetre()).getByText(REFUS_DE_LA_FONCTION.rienDeNeuf)).toBeTruthy()
    expect(faux.appels).toEqual([])
  })

  it('la confirmation nomme ce qui part ; un envoi pour deux clics, tel qu’il part ; puis la phrase de NOE3-Q1 et la relecture', async () => {
    faux.lecture = lus()
    render(<PaiementsAssuranceMaladie espace="client" dossierId="d1" codeNaf="86.90D" />)
    await ouvrirEtDeposer()
    regler()
    fireEvent.click(screen.getByRole('button', { name: 'Importer 1 paiement' }))
    expect(lisible(within(fenetre()).getByRole('status').textContent))
      .toMatch(/^1 paiement de l’assurance maladie part en base, journées comptables du 02\/11\/2026 au 02\/11\/2026, pour 45,50 € au total ; 1 rejet, 12,00 €\. Rien d’autre ne part/)
    const confirmer = screen.getByRole('button', { name: 'Confirmer l’import' })
    act(() => { fireEvent.click(confirmer); fireEvent.click(confirmer) })
    expect(faux.appels).toEqual([{
      nom: 'importer_paiements_assurance_maladie',
      args: {
        p_dossier_id: 'd1',
        p_import: {
          version: 1,
          paiements: [{ date_journee_comptable: '2026-11-02', regime: null, caisse: 691, organisme_complementaire: null, part: 'obligatoire', montant_centimes: 4550, regularisations_centimes: 0, nombre_de_factures: 2 }],
          rejets: { nombre: 1, montant_centimes: 1200 },
        },
      },
    }])
    const avant = faux.lectures
    await act(async () => { faux.retenir.forEach((r) => r()) })
    expect(await screen.findByText(phraseApresLImport('client'))).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(faux.lectures).toBe(avant + 1)
  })

  // NOE5b : un import dont un paiement est associé à un crédit du relevé ne s'offre pas au retrait, et dit pourquoi, dans les
  // deux espaces ; des associations lues en partie, aucun geste.
  const IMPORT = { id: 'i1', dossier_id: 'd1', periode_du: '2026-11-02', periode_au: '2026-11-03', nombre_de_rejets: 0,
    montant_rejete_centimes: 0, importe_par: 'u1', importe_le: '2026-11-04T09:00:00Z' }
  const PAYE: PaiementAssuranceMaladie = { id: 'p1', dossier_id: 'd1', import_id: 'i1', date_journee_comptable: '2026-11-02', regime: null,
    caisse: 691, organisme_complementaire: null, part: 'obligatoire', montant_centimes: 4550, regularisations_centimes: 0, nombre_de_factures: 2 }
  const ASSOCIEE = { id: 'a1', dossier_id: 'd1', paiement_id: 'p1', ligne_bancaire_id: 'm1', associe_par: 'u1', associe_le: '2026-11-05T09:00:00Z' }
  const avecAssociations = (lignes: typeof ASSOCIEE[], complete = true): PaiementsLus =>
    ({ dossierId: 'd1', etat: 'lus', imports: lue([IMPORT]), paiements: lue([PAYE]), associations: lue(lignes, complete) })

  it('un import associé : « Retirer » n’est pas offert, et la raison se dit avant le clic, dans les deux espaces', async () => {
    for (const espace of ['cabinet', 'client'] as const) {
      faux.lecture = avecAssociations([ASSOCIEE])
      const vue = render(<PaiementsAssuranceMaladie espace={espace} dossierId="d1" codeNaf="86.90D" />)
      expect(await screen.findByText(refusDuRetraitDImportDit(espace))).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Retirer' })).toBeNull()
      vue.unmount()
    }
    faux.lecture = avecAssociations([])
    render(<PaiementsAssuranceMaladie espace="cabinet" dossierId="d1" codeNaf="86.90D" />)
    expect(await screen.findByRole('button', { name: 'Retirer' })).toBeTruthy()
  })

  it('des associations lues en partie : le bandeau, et aucun geste', async () => {
    faux.lecture = avecAssociations([ASSOCIEE], false)
    render(<PaiementsAssuranceMaladie espace="cabinet" dossierId="d1" codeNaf="86.90D" />)
    expect(await screen.findByText(/Les associations des paiements au relevé n.ont pas pu être/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('une lecture partagée : la section ne lit pas elle-même, et montre ce qu’on lui confie sous ses imports', async () => {
    const lecture = { lu: avecAssociations([]), relire: () => Promise.resolve() }
    render(<PaiementsAssuranceMaladie espace="cabinet" dossierId="d1" codeNaf="86.90D" partagee={lecture}><p>le rapprochement</p></PaiementsAssuranceMaladie>)
    expect(screen.getByText('le rapprochement')).toBeTruthy()
    expect(faux.lectures).toBe(0)
  })
})
