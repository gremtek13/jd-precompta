import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/ecrans'
import type { EtatDeLImport, FichierLu, LectureDeLImport } from '../../lib/importDesFacturesVue'
import type { FactureRepriseLue } from '../../lib/lectureDesFacturesReprises'

// L'ÉCRAN D'IMPORT DES FACTURES REPRISES (ligne 51.5, A8d2b) : ce qu'aucun calcul pur ne voit — le drapeau (baissé, rien
// n'est lu ni rendu : l'onglet d'hier ; levé, la section lit), « Chargement… » avant la lecture, aucun geste sur une lecture
// illisible, l'aperçu de ce qui part, le refus dit avant le clic, la confirmation qui nomme, le verrou (deux clics du même
// `act`, un seul appel), la relecture après le geste, la date de reprise au chef seul. Données FICTIVES.

const etat = vi.hoisted(() => ({ offert: false, chef: true, originaux: false }))
const appels = vi.hoisted(() => ({ lire: vi.fn(), fichiers: vi.fn(), importer: vi.fn(), retirer: vi.fn(), fixer: vi.fn() }))

vi.mock('../../lib/importDesFacturesVue', async (original) => {
  const reel = await original<typeof import('../../lib/importDesFacturesVue')>()
  return { ...reel, get IMPORT_DES_FACTURES_OFFERT() { return etat.offert } }
})
vi.mock('../../lib/bornesStockage', async (original) => {
  const reel = await original<typeof import('../../lib/bornesStockage')>()
  return { ...reel, get ORIGINAUX_DES_IMPORTS_PREVUS() { return etat.originaux } }
})
vi.mock('../../lib/importDesFacturesLecture', () => ({
  lireLEtatDeLImport: appels.lire, lireLesFichiers: appels.fichiers, importerLeLot: appels.importer,
  retirerLImport: appels.retirer, fixerLaDateDeReprise: appels.fixer,
}))
vi.mock('../../lib/apercu', () => ({ ouvrirApercu: vi.fn() }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ estChef: etat.chef }) }))

import ImportDesFactures from './ImportDesFactures'

const ETAT: EtatDeLImport = {
  dossierId: 'd1', modeComptable: 'tresorerie', bascule: true, basculeLe: '2026-11-05', repriseLe: '2026-11-01', siren: '123456782',
  numeros: [], reprises: [], empreintes: [], lots: [],
}
const lue = (o: Partial<EtatDeLImport> = {}): LectureDeLImport => ({ etat: 'lue', lue: { ...ETAT, ...o } })
const LOT = { id: 'l1', format: 'cii', importe_le: '2026-11-10T10:00:00Z', nombre_factures: 1, factures: [{ facture_id: 'f1', numero: 'FA-1', rang: 1, fichier_chemin: null }] }

const FACTURE: FactureRepriseLue = {
  format: 'cii', numero: 'FA-2025/118', type: 'facture', origine_numero: null, date_emission: '2025-11-20', date_echeance: null,
  tiers_nom: 'Société fictive', tiers_adresse: null, tiers_siren: null, tiers_siret: null, nature_lue: 'services', option_debits_lue: false,
  ht_centimes: 10000, tva_centimes: 2000, ttc_centimes: 12000,
  lignes: [{ designation: 'Conseil', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20, unite: null }],
}
const FICHIER: FichierLu = { cle: 'd1-0', nom: 'fa118.xml', taille: 900, fichier: new File(['<x/>'], 'fa118.xml'), sha256: 'b'.repeat(64), lecture: { lue: FACTURE }, original: null }

beforeEach(() => {
  etat.offert = true
  etat.chef = true
  etat.originaux = false
  for (const f of Object.values(appels)) f.mockReset()
  appels.lire.mockResolvedValue(lue())
  appels.fichiers.mockResolvedValue([FICHIER])
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

const monter = (onChange = vi.fn()) => render(<ImportDesFactures dossierId="d1" onChange={onChange} />)

async function deposer() {
  fireEvent.click(await screen.findByRole('button', { name: 'Reprendre des factures de l’ancien logiciel' }))
  fireEvent.change(screen.getByLabelText('Fichiers des factures'), { target: { files: [FICHIER.fichier] } })
  await screen.findByRole('article', { name: 'Fichier fa118.xml' })
}

describe('le drapeau', () => {
  it('baissé, rien n’est lu ni rendu : l’onglet d’hier', () => {
    etat.offert = false
    const { container } = monter()
    expect(container.innerHTML).toBe('')
    expect(appels.lire).not.toHaveBeenCalled()
  })
  it('levé, « Chargement… » avant la lecture, puis l’état du dossier', async () => {
    let rendre: (l: LectureDeLImport) => void = () => {}
    appels.lire.mockReturnValue(new Promise((r) => { rendre = r }))
    monter()
    expect(screen.getByText('Chargement…')).toBeTruthy()
    await act(async () => rendre(lue()))
    expect(screen.getByText('le 01/11/2026')).toBeTruthy()
  })
})

describe('une lecture illisible', () => {
  it('n’offre aucun geste', async () => {
    appels.lire.mockResolvedValue({ etat: 'illisible', dossierId: 'd1', motif: 'les imports du dossier : lecture incomplète' })
    monter()
    await screen.findByText(/rien ne s’importe ni ne se retire d’ici/)
    expect(screen.queryAllByRole('button')).toEqual([])
  })
})

describe('l’import', () => {
  it('montre ce qui part, dit les choix manquants avant le clic, puis importe une fois sous verrou et relit', async () => {
    const onChange = vi.fn()
    monter(onChange)
    await deposer()
    expect(screen.getByText('FA-2025/118 — CII')).toBeTruthy()
    expect(screen.getByText('Société fictive')).toBeTruthy()
    expect(screen.getByText('TVA 20 %')).toBeTruthy()
    const bouton = screen.getByRole('button', { name: 'Importer 1 document' }) as HTMLButtonElement
    expect(bouton.disabled).toBe(true)
    expect(screen.getByText('Le type du client est à choisir.')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Type du client'), { target: { value: 'assujetti' } })
    fireEvent.change(screen.getByLabelText('Transmission'), { target: { value: 'pdf' } })
    fireEvent.change(screen.getByLabelText('Encaissé avant la reprise (€)'), { target: { value: '0' } })
    expect(bouton.disabled).toBe(false)

    let finir: (v: unknown) => void = () => {}
    appels.importer.mockReturnValue(new Promise((r) => { finir = r }))
    appels.lire.mockResolvedValue(lue({ lots: [LOT] }))
    act(() => { fireEvent.click(bouton); fireEvent.click(bouton) })
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/1 facture de l’ancien logiciel, au format CII : FA-2025\/118.*« Retirer l’import »/))
    await act(async () => finir({ ok: true, message: '1 document repris de l’ancien logiciel.' }))
    expect(appels.importer).toHaveBeenCalledTimes(1)
    expect(appels.importer.mock.calls[0][1].factures[0].facture).toMatchObject({ numero: 'FA-2025/118', type_client: 'assujetti', transmise_par: 'pdf' })
    await screen.findByText('1 document repris de l’ancien logiciel.')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(appels.lire).toHaveBeenCalledTimes(2)
  })

  it('un doublon en base se dit et retient le lot', async () => {
    appels.lire.mockResolvedValue(lue({ numeros: ['FA-2025/118'] }))
    monter()
    await deposer()
    expect(screen.getByText(/est déjà celui d’une facture de ce dossier/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Importer 1 document' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('le refus de la base se dit, rien n’est relu comme fait', async () => {
    monter()
    await deposer()
    fireEvent.change(screen.getByLabelText('Type du client'), { target: { value: 'assujetti' } })
    fireEvent.change(screen.getByLabelText('Transmission'), { target: { value: 'pdf' } })
    fireEvent.change(screen.getByLabelText('Encaissé avant la reprise (€)'), { target: { value: '0' } })
    appels.importer.mockResolvedValue({ ok: false, erreur: 'Refus fictif de la base.' })
    fireEvent.click(screen.getByRole('button', { name: 'Importer 1 document' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Refus fictif de la base.')
  })
})

describe('le retrait', () => {
  it('se confirme en nommant le lot, une fois sous verrou', async () => {
    appels.lire.mockResolvedValue(lue({ lots: [LOT] }))
    monter()
    const bouton = await screen.findByRole('button', { name: 'Retirer l’import' })
    let finir: (v: unknown) => void = () => {}
    appels.retirer.mockReturnValue(new Promise((r) => { finir = r }))
    act(() => { fireEvent.click(bouton); fireEvent.click(bouton) })
    await act(async () => finir({ ok: true, message: 'Import retiré : 1 document quitte le dossier.' }))
    expect(appels.retirer).toHaveBeenCalledTimes(1)
    expect(appels.retirer).toHaveBeenCalledWith('d1', LOT, false, true)
    expect(screen.queryByRole('button', { name: 'Voir l’original' })).toBeNull()
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/import du 10\/11\/2026 : ses 1 document \(FA-1\)/))
  })
})

describe('les originaux d’un lot (drapeau des originaux levé)', () => {
  const AVEC = { ...LOT, factures: [{ ...LOT.factures[0], fichier_chemin: 'd1/imports/l1/' + 'c'.repeat(64) + '.xml' }] }
  it('au chef : la confirmation dit qu’ils quittent le stockage, le geste les nomme, « Voir l’original » s’offre', async () => {
    etat.originaux = true
    appels.lire.mockResolvedValue(lue({ lots: [AVEC] }))
    appels.retirer.mockResolvedValue({ ok: true, message: 'Import retiré : 1 document quitte le dossier. Son original quitte le stockage ensuite.' })
    monter()
    expect(await screen.findByRole('button', { name: 'Voir l’original' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retirer l’import' }))
    await screen.findByText(/Son original quitte le stockage ensuite/)
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/Son original quitte le stockage ensuite/))
    expect(appels.retirer).toHaveBeenCalledWith('d1', AVEC, true, true)
  })
  it('au membre de l’équipe : la confirmation dit qu’ils restent', async () => {
    etat.originaux = true
    etat.chef = false
    appels.lire.mockResolvedValue(lue({ lots: [AVEC] }))
    appels.retirer.mockResolvedValue({ ok: true, message: 'Import retiré.' })
    monter()
    fireEvent.click(await screen.findByRole('button', { name: 'Retirer l’import' }))
    await waitFor(() => expect(appels.retirer).toHaveBeenCalledWith('d1', AVEC, true, false))
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/Son original reste dans le stockage : seul le chef du cabinet/))
  })
})

describe('la date de reprise', () => {
  it('se pose par le chef, son refus dit avant le clic', async () => {
    appels.lire.mockResolvedValue(lue({ repriseLe: null }))
    appels.fixer.mockResolvedValue({ ok: true, message: 'Date de reprise posée.' })
    monter()
    const mois = await screen.findByLabelText('Premier mois repris par l’application')
    fireEvent.change(mois, { target: { value: '2026-12' } })
    expect(screen.getByText(/suit le jour de la bascule/)).toBeTruthy()
    fireEvent.change(mois, { target: { value: '2026-10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Poser la date de reprise' }))
    await waitFor(() => expect(appels.fixer).toHaveBeenCalledWith('d1', '2026-10-01'))
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/se fige au premier import/))
  })
  it('n’est pas offerte au membre de l’équipe', async () => {
    etat.chef = false
    appels.lire.mockResolvedValue(lue({ repriseLe: null }))
    monter()
    await screen.findByText('pas encore posée')
    expect(screen.queryByLabelText('Premier mois repris par l’application')).toBeNull()
  })
})
