import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import AchatDeLaPiece from './AchatDeLaPiece'
import { REFUS_DES_ACHATS, type PaiementDeclare } from '../../lib/achatsClient'
import type { AchatDeLaPieceLu, EcheanceLue } from '../../lib/achatsClientLecture'

// La section des achats du client dans la fiche d'une pièce d'achat (étape B5), côté cabinet : rien avant le retour ;
// l'échéance et qui l'a fixée, « par le client » d'un compte reconnu ; les déclarations « proposé par le client le … » ;
// « Retirer » sur une confirmation qui nomme ce qui part (B4-Q4), un appel pour deux clics, puis la relecture ; refusé,
// rien ne part ; une lecture partielle n'offre aucun geste ; un bouton de la section n'enregistre pas la fiche.

const faux = vi.hoisted(() => ({
  lecture: null as AchatDeLaPieceLu | null,
  lectures: 0,
  appels: [] as { nom: string; args: Record<string, unknown> }[],
  retenir: [] as (() => void)[],
  erreur: null as unknown,
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (nom: string, args: Record<string, unknown>) => {
      faux.appels.push({ nom, args })
      return new Promise((r) => { faux.retenir.push(() => r({ data: faux.erreur ? null : {}, error: faux.erreur })) })
    },
  },
}))
vi.mock('../../lib/achatsClientLecture', () => ({
  lireLAchatDeLaPiece: () => { faux.lectures++; return faux.lecture ? Promise.resolve(faux.lecture) : new Promise(() => {}) },
}))

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-11T10:00:00Z')) })
afterAll(() => { vi.useRealTimers() })
afterEach(() => { faux.lecture = null; faux.lectures = 0; faux.appels = []; faux.retenir = []; faux.erreur = null; vi.restoreAllMocks() })

const lue = <T,>(lignes: T[], complete = true) => ({ lignes, complete, motif: complete ? null : 'lecture interrompue' })
const echeance = (p: Partial<EcheanceLue>): EcheanceLue => ({
  id: 'p1', dossier_id: 'd1', source: 'upload', date_echeance: '2026-11-30', echeance_fixee_par: 'u1',
  echeance_fixee_le: '2026-11-01T10:00:00Z', ...p,
})
const paiement = (p: Partial<PaiementDeclare>): PaiementDeclare => ({
  id: 'x1', dossier_id: 'd1', piece_id: 'p1', date_paiement: '2026-11-02', moyen: 'virement', montant: 120.5, declare_par: 'u1',
  declare_le: '2026-11-03T09:00:00Z', retire_par: null, retire_le: null, ...p,
})
const lecture = (paiements: PaiementDeclare[], p: Partial<AchatDeLaPieceLu> = {}): AchatDeLaPieceLu => ({
  dossierId: 'd1', pieceId: 'p1', echeance: lue([echeance({})]), paiements: lue(paiements),
  acces: lue([{ id: 'm1', dossier_id: 'd1', user_id: 'u1' }]), ...p,
})

describe('les achats du client dans la fiche d’une pièce', () => {
  it('rien avant le retour ; l’échéance et qui l’a fixée ; aucune déclaration, dit d’une liste entière', async () => {
    const premier = render(<AchatDeLaPiece dossierId="d1" pieceId="p1" nomFichier="facture.pdf" />)
    expect(screen.getByText('Chargement…')).toBeTruthy()
    premier.unmount()
    faux.lecture = lecture([])
    render(<AchatDeLaPiece dossierId="d1" pieceId="p1" nomFichier="facture.pdf" />)
    expect(await screen.findByText('Échéance le 30/11/2026 (à venir), fixée le 01/11/2026 par le client.')).toBeTruthy()
    expect(screen.getByText('Le client n’a déclaré aucun paiement de cette facture.')).toBeTruthy()
  })

  it('une lecture partielle le dit et n’offre aucun geste ; des accès lus en partie ne disent pas « par le client »', async () => {
    faux.lecture = lecture([paiement({})], { paiements: lue([paiement({})], false), acces: lue([], false) })
    render(<AchatDeLaPiece dossierId="d1" pieceId="p1" nomFichier="facture.pdf" />)
    expect(await screen.findByText(/Les paiements déclarés par le client n'ont pas pu être lus/)).toBeTruthy()
    expect(screen.getByText('Échéance le 30/11/2026 (à venir), fixée le 01/11/2026.')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('« Retirer » : la confirmation nomme ce qui part ; un appel pour deux clics ; puis la relecture ; la retirée reste dite', async () => {
    faux.lecture = lecture([paiement({}), paiement({ id: 'x0', retire_par: 'u0', retire_le: '2026-11-04T10:00:00Z' })])
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const soumise = vi.fn((e: Event) => e.preventDefault())
    render(<form onSubmit={(e) => soumise(e.nativeEvent)}><AchatDeLaPiece dossierId="d1" pieceId="p1" nomFichier="facture.pdf" /></form>)
    expect(await screen.findAllByText(/^Proposé par le client le 03\/11\/2026 : payée le 02\/11\/2026, par virement/)).toHaveLength(2)
    expect(screen.getByText(/retirée le 04\/11\/2026 par le cabinet$/)).toBeTruthy()
    const boutons = screen.getAllByRole('button', { name: 'Retirer' })
    expect(boutons).toHaveLength(1)
    act(() => { fireEvent.click(boutons[0]); fireEvent.click(boutons[0]) })
    expect(confirmer).toHaveBeenCalledTimes(1)
    expect(confirmer.mock.calls[0][0]).toContain('« facture.pdf »')
    expect(confirmer.mock.calls[0][0]).toContain('sa ligne reste')
    expect(faux.appels).toEqual([{ nom: 'retirer_paiement_declare', args: { p_paiement_id: 'x1' } }])
    const avant = faux.lectures
    await act(async () => { faux.retenir.forEach((r) => r()) })
    await waitFor(() => expect(faux.lectures).toBe(avant + 1))
    expect(await screen.findByText('La déclaration est retirée ; sa ligne reste.')).toBeTruthy()
    expect(soumise).not.toHaveBeenCalled()
  })

  it('refusée à la confirmation, rien ne part ; le refus de la base se dit', async () => {
    faux.lecture = lecture([paiement({})])
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<AchatDeLaPiece dossierId="d1" pieceId="p1" nomFichier="facture.pdf" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Retirer' }))
    expect(faux.appels).toEqual([])
    confirmer.mockReturnValue(true)
    faux.erreur = { message: REFUS_DES_ACHATS.dejaRetiree, code: '22023' }
    fireEvent.click(screen.getByRole('button', { name: 'Retirer' }))
    await act(async () => { faux.retenir.forEach((r) => r()) })
    expect(await screen.findByText(`La déclaration n’est pas retirée : ${REFUS_DES_ACHATS.dejaRetiree}`)).toBeTruthy()
  })
})
