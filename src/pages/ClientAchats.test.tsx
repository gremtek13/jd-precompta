import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import ClientAchats from './ClientAchats'
import { motsDuCabinet } from '../lib/espaceVentes'
import { REFUS_DES_ACHATS, type PaiementDeclare } from '../lib/achatsClient'
import { SANS_LA_CASE_ACHATS, type AchatDuClient } from '../lib/achatsClientVue'
import type { MesAchatsLus } from '../lib/achatsClientLecture'

// « Mes achats » (étape B5), sous la case « Achats » : la lecture est mockée ; la base, par `rpc`. L'écran garde : rien avant
// le retour ; aucune facture sur une lecture partielle ; la case retirée en base ; le vide d'une liste entière seulement ; les
// nouvelles dites et marquées vues à l'ouverture, rien sur des vues lues en partie ; « J'ai payé » — le refus avant le clic,
// un envoi pour deux clics, tel qu'il part, puis la relecture ; l'échéance fixée à la version lue, jamais celle d'une facture
// électronique ; le retrait de sa déclaration sur confirmation ; les mots du client.

const faux = vi.hoisted(() => ({
  lecture: null as MesAchatsLus | null,
  lectures: 0,
  appels: [] as { nom: string; args: Record<string, unknown> }[],
  retenir: [] as (() => void)[],
  erreur: null as unknown,
}))

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ dossierActifId: 'd1', session: { user: { id: 'u1' } } }) }))
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (nom: string, args: Record<string, unknown>) => {
      faux.appels.push({ nom, args })
      return new Promise((r) => { faux.retenir.push(() => r({ data: faux.erreur ? null : {}, error: faux.erreur })) })
    },
  },
}))
vi.mock('../lib/achatsClientLecture', () => ({
  lireMesAchats: () => { faux.lectures++; return faux.lecture ? Promise.resolve(faux.lecture) : new Promise(() => {}) },
}))

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-11T10:00:00Z')) })
afterAll(() => { vi.useRealTimers() })
afterEach(() => { faux.lecture = null; faux.lectures = 0; faux.appels = []; faux.retenir = []; faux.erreur = null; vi.restoreAllMocks() })

const piece = (p: Partial<AchatDuClient>): AchatDuClient => ({
  id: 'p1', dossier_id: 'd1', type_piece: 'achat', source: 'upload', nom_fichier: 'facture-octobre.pdf', tiers: 'Fournisseur fictif',
  date_piece: '2026-10-01', montant_ttc: 120.5, statut: 'validee', identite_numero: null, date_echeance: null,
  echeance_fixee_par: null, echeance_fixee_le: null, created_at: '2026-10-02T08:00:00Z', ...p,
})
const paiement = (p: Partial<PaiementDeclare>): PaiementDeclare => ({
  id: 'x1', dossier_id: 'd1', piece_id: 'p1', date_paiement: '2026-11-02', moyen: 'virement', montant: 120.5, declare_par: 'u1',
  declare_le: '2026-11-03T09:00:00Z', retire_par: null, retire_le: null, ...p,
})
const lue = <T,>(lignes: T[], complete = true) => ({ lignes, complete, motif: complete ? null : 'lecture interrompue' })
const lecture = (pieces: AchatDuClient[], paiements: PaiementDeclare[] = [], vues: string[] = [], p: Partial<Extract<MesAchatsLus, { etat: 'lus' }>> = {}): MesAchatsLus => ({
  dossierId: 'd1', etat: 'lus', pieces: lue(pieces), paiements: lue(paiements),
  vues: lue(vues.map((id) => ({ id: `v-${id}`, dossier_id: 'd1', piece_id: id, utilisateur: 'u1', vue_le: '2026-11-01T00:00:00Z' }))),
  ...p,
})
const carte = (nom: string) => screen.findByRole('listitem', { name: `Facture « ${nom} »` })

describe('« Mes achats »', () => {
  it('rien avant le retour ; une lecture partielle ne montre aucune facture ; sans la case en base ; une liste entière vide le dit', async () => {
    const premier = render(<ClientAchats />)
    expect(screen.getByText('Chargement…')).toBeTruthy()
    premier.unmount()
    faux.lecture = lecture([piece({})], [], [], { paiements: lue([], false) })
    const second = render(<ClientAchats />)
    expect(await screen.findByText(/Tes factures d’achat n'ont pas pu être/)).toBeTruthy()
    expect(screen.queryByText('Fournisseur fictif')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    second.unmount()
    faux.lecture = { dossierId: 'd1', etat: 'sans_achats' }
    const troisieme = render(<ClientAchats />)
    expect(await screen.findByText(SANS_LA_CASE_ACHATS)).toBeTruthy()
    troisieme.unmount()
    faux.lecture = lecture([])
    render(<ClientAchats />)
    expect(await screen.findByText('Ton cabinet n’a reçu aucune facture d’achat de ta société pour l’instant.')).toBeTruthy()
    expect(faux.appels).toEqual([])
  })

  it('les factures pas encore vues se disent nouvelles et se marquent vues à l’ouverture ; des vues lues en partie, rien', async () => {
    faux.lecture = lecture([piece({}), piece({ id: 'p2', nom_fichier: 'ancienne.pdf', tiers: 'Autre fictif', date_piece: '2026-01-01' })], [], ['p2'])
    const premier = render(<ClientAchats />)
    const nouvelle = await carte('facture-octobre.pdf')
    expect(within(nouvelle).getByText('Nouvelle')).toBeTruthy()
    expect(within(await carte('ancienne.pdf')).queryByText('Nouvelle')).toBeNull()
    await waitFor(() => expect(faux.appels).toEqual([{ nom: 'marquer_vues', args: { p_dossier_id: 'd1', p_pieces: ['p1'] } }]))
    premier.unmount()
    faux.appels = []
    faux.lecture = lecture([piece({})], [], [], { vues: lue([], false) })
    render(<ClientAchats />)
    expect(within(await carte('facture-octobre.pdf')).queryByText('Nouvelle')).toBeNull()
    expect(screen.getByText(/Tes visites n'ont pas pu être/)).toBeTruthy()
    expect(faux.appels).toEqual([])
  })

  it('« J’ai payé » : le refus avant le clic ; un envoi pour deux clics, tel qu’il part ; puis la relecture', async () => {
    faux.lecture = lecture([piece({ date_echeance: '2026-11-01', echeance_fixee_par: 'u1', echeance_fixee_le: '2026-10-05T10:00:00Z' })], [], ['p1'])
    render(<ClientAchats />)
    const c = await carte('facture-octobre.pdf')
    expect(within(c).getByText('En retard')).toBeTruthy()
    expect(within(c).getByText(/fixée par toi le 05\/10\/2026/)).toBeTruthy()
    fireEvent.click(within(c).getByRole('button', { name: 'J’ai payé' }))
    const declarer = within(c).getByRole('button', { name: 'Déclarer ce paiement' }) as HTMLButtonElement
    expect(within(c).getByText(REFUS_DES_ACHATS.moyenPaiement)).toBeTruthy()
    expect(declarer.disabled).toBe(true)
    fireEvent.change(within(c).getByLabelText('Moyen'), { target: { value: 'cheque' } })
    fireEvent.change(within(c).getByLabelText('Montant payé (€)'), { target: { value: '10,005' } })
    expect(within(c).getByText(REFUS_DES_ACHATS.montantPaiement)).toBeTruthy()
    fireEvent.change(within(c).getByLabelText('Montant payé (€)'), { target: { value: '100,25' } })
    fireEvent.change(within(c).getByLabelText('Payée le'), { target: { value: '2026-11-12' } })
    expect(within(c).getByText(REFUS_DES_ACHATS.datePaiement)).toBeTruthy()
    fireEvent.change(within(c).getByLabelText('Payée le'), { target: { value: '2026-11-10' } })
    expect(declarer.disabled).toBe(false)
    act(() => { fireEvent.click(declarer); fireEvent.click(declarer) })
    expect(faux.appels).toEqual([{ nom: 'declarer_paiement_piece', args: {
      p_piece_id: 'p1', p_date: '2026-11-10', p_moyen: 'cheque', p_montant: 100.25,
    } }])
    const avant = faux.lectures
    faux.lecture = lecture([piece({})], [paiement({ montant: 100.25, moyen: 'cheque', date_paiement: '2026-11-10' })], ['p1'])
    await act(async () => { faux.retenir.forEach((r) => r()) })
    await waitFor(() => expect(faux.lectures).toBe(avant + 1))
    expect(await screen.findByText('Ton paiement est déclaré à ton cabinet.')).toBeTruthy()
    expect(screen.getByText(/Déclarée payée par toi : le 10\/11\/2026, par chèque/)).toBeTruthy()
    expect(motsDuCabinet(globalThis.document.body.textContent ?? '')).toEqual([])
  })

  it('l’échéance se fixe à la version lue ; celle d’une facture électronique ne s’offre pas ; le refus de la base se dit', async () => {
    faux.lecture = lecture([piece({}), piece({ id: 'p2', nom_fichier: 'recue.xml', source: 'plateforme', date_echeance: '2026-12-31' })], [], ['p1', 'p2'])
    render(<ClientAchats />)
    const recue = await carte('recue.xml')
    expect(within(recue).getByText(/lue sur la facture électronique/)).toBeTruthy()
    expect(within(recue).queryByRole('button', { name: /échéance/ })).toBeNull()
    const c = await carte('facture-octobre.pdf')
    fireEvent.click(within(c).getByRole('button', { name: 'Fixer l’échéance' }))
    fireEvent.change(within(c).getByLabelText('Échéance'), { target: { value: '1999-12-31' } })
    expect(within(c).getByText(REFUS_DES_ACHATS.echeanceHorsBornes)).toBeTruthy()
    fireEvent.change(within(c).getByLabelText('Échéance'), { target: { value: '2026-12-15' } })
    const bouton = within(c).getByRole('button', { name: 'Enregistrer l’échéance' })
    faux.erreur = { message: REFUS_DES_ACHATS.echeanceChangee, code: '22023' }
    act(() => { fireEvent.click(bouton); fireEvent.click(bouton) })
    expect(faux.appels).toEqual([{ nom: 'fixer_echeance_piece', args: { p_piece_id: 'p1', p_echeance: '2026-12-15', p_echeance_lue: null } }])
    await act(async () => { faux.retenir.forEach((r) => r()) })
    expect(await screen.findByText(`L’échéance n’est pas enregistrée : ${REFUS_DES_ACHATS.echeanceChangee}`)).toBeTruthy()
  })

  it('retirer sa déclaration, sur une confirmation qui la nomme ; celle d’un autre accès ne se retire pas d’ici', async () => {
    faux.lecture = lecture([piece({})], [paiement({}), paiement({ id: 'x2', declare_par: 'u2', declare_le: '2026-11-04T09:00:00Z' })], ['p1'])
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<ClientAchats />)
    const c = await carte('facture-octobre.pdf')
    const boutons = within(c).getAllByRole('button', { name: 'Retirer' })
    expect(boutons).toHaveLength(1)
    act(() => { fireEvent.click(boutons[0]); fireEvent.click(boutons[0]) })
    expect(confirmer).toHaveBeenCalledTimes(1)
    expect(confirmer.mock.calls[0][0]).toContain('« facture-octobre.pdf »')
    expect(faux.appels).toEqual([{ nom: 'retirer_paiement_declare', args: { p_paiement_id: 'x1' } }])
  })
})
