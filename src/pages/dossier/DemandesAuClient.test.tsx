import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import DemandesAuClient from './DemandesAuClient'
import { REFUS } from '../../lib/documentsEtDemandes'
import type { DemandesDuCabinetLues } from '../../lib/documentsEtDemandesLecture'
import type { DemandeDuCabinet, ReponseALaDemande } from '../../lib/documentsEtDemandesVue'

// « Demandes au client », côté cabinet (étape B3a). La lecture est mockée ; la base, par `rpc`. L'écran garde : rien avant le
// retour ; ouvrir, relancer et clore, chacun un appel pour deux clics, puis la relecture ; le refus avant le clic ; la
// clôture confirmée qui nomme la demande et le motif ; l'état déduit ; les réponses et ce qu'elles joignent ; aucune demande
// ni aucun geste sur une lecture partielle.

const faux = vi.hoisted(() => ({
  lecture: null as DemandesDuCabinetLues | null,
  lectures: 0,
  appels: [] as { nom: string; args: Record<string, unknown> }[],
  retenir: [] as (() => void)[],
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (nom: string, args: Record<string, unknown>) => {
      faux.appels.push({ nom, args })
      return new Promise((r) => { faux.retenir.push(() => r({ data: {}, error: null })) })
    },
  },
}))
vi.mock('../../lib/documentsEtDemandesLecture', () => ({
  lireLesDemandesDuCabinet: () => { faux.lectures++; return faux.lecture ? Promise.resolve(faux.lecture) : new Promise(() => {}) },
}))

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-11T10:00:00Z')) })
afterAll(() => { vi.useRealTimers() })
afterEach(() => { faux.lecture = null; faux.lectures = 0; faux.appels = []; faux.retenir = [] })

const demande = (p: Partial<DemandeDuCabinet>): DemandeDuCabinet => ({
  id: 'dm1', dossier_id: 'd1', objet: 'Relevé de décembre', detail: null, echeance: null, attendu: 'fichier', auteur: 'u0',
  ouverte_le: '2026-11-01T09:00:00Z', close_par: null, close_le: null, motif_de_cloture: null, ...p,
})
const lue = <T,>(lignes: T[]) => ({ lignes, complete: true, motif: null })
const lecture = (demandes: DemandeDuCabinet[], reponses: ReponseALaDemande[] = [], p: Partial<DemandesDuCabinetLues> = {}): DemandesDuCabinetLues => ({
  dossierId: 'd1', demandes: lue(demandes), reponses: lue(reponses), relances: lue([]),
  pieces: lue([{ id: 'p1', dossier_id: 'd1', nom_fichier: 'releve-decembre.pdf', storage_path: 'd1/p1.pdf' }]), documentsDivers: lue([]),
  ...p,
})
const relacher = async () => { await act(async () => { faux.retenir.forEach((r) => r()) }) }

describe('les demandes au client (cabinet)', () => {
  it('rien n’est offert ni affirmé avant le retour de la lecture', () => {
    render(<DemandesAuClient dossierId="d1" />)
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Ouvrir la demande' })).toBeNull()
  })

  it('ouvrir : le refus avant le clic, puis un appel pour deux clics, la saisie telle qu’elle part, la relecture', async () => {
    faux.lecture = lecture([])
    render(<DemandesAuClient dossierId="d1" />)
    expect(await screen.findByText('Aucune demande n’est ouverte à ce dossier.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/^Objet/), { target: { value: 'Attestation Urssaf' } })
    fireEvent.change(screen.getByLabelText(/^Échéance/), { target: { value: '2026-11-10' } })
    expect(screen.getByText(REFUS.echeance)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Ouvrir la demande' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/^Échéance/), { target: { value: '2026-11-30' } })
    fireEvent.change(screen.getByLabelText('Ce que tu attends'), { target: { value: 'les_deux' } })
    const bouton = screen.getByRole('button', { name: 'Ouvrir la demande' })
    act(() => { fireEvent.click(bouton); fireEvent.click(bouton) })
    expect(faux.appels).toEqual([{ nom: 'ouvrir_demande', args: {
      p_dossier_id: 'd1', p_objet: 'Attestation Urssaf', p_detail: null, p_echeance: '2026-11-30', p_attendu: 'les_deux',
    } }])
    const avant = faux.lectures
    await relacher()
    await waitFor(() => expect(faux.lectures).toBe(avant + 1))
    expect(await screen.findByText(/La demande « Attestation Urssaf » est ouverte/)).toBeTruthy()
  })

  it('l’état déduit, la réponse et son fichier ; relancer puis clore, un appel pour deux clics chacun', async () => {
    faux.lecture = lecture([demande({ echeance: '2026-11-05' }), demande({ id: 'dm2', objet: 'Contrat de bail' })],
      [{ id: 'r1', dossier_id: 'd1', demande_id: 'dm2', auteur: 'u1', texte: 'Le voici', fichier: 'piece', piece_id: 'p1',
        document_id: null, fichier_sha256: 'b'.repeat(64), ecrite_le: '2026-11-03T09:00:00Z' }])
    render(<DemandesAuClient dossierId="d1" />)
    const premiere = await screen.findByRole('listitem', { name: 'Demande « Relevé de décembre »' })
    expect(within(premiere).getByText('En retard')).toBeTruthy()
    const seconde = screen.getByRole('listitem', { name: 'Demande « Contrat de bail »' })
    expect(within(seconde).getByText('Répondue')).toBeTruthy()
    expect(within(seconde).getByText('Fichier joint : « releve-decembre.pdf ».')).toBeTruthy()
    const relancer = within(premiere).getByRole('button', { name: 'Relancer à l’écran' })
    act(() => { fireEvent.click(relancer); fireEvent.click(relancer) })
    expect(faux.appels).toEqual([{ nom: 'relancer_demande', args: { p_demande_id: 'dm1' } }])
    await relacher()
    await screen.findByText(/est relancée dans l’espace du client/)
    fireEvent.change(within(premiere).getByLabelText('Motif de clôture'), { target: { value: 'remplacee' } })
    fireEvent.click(within(premiere).getByRole('button', { name: 'Clore' }))
    const fenetre = screen.getByRole('alertdialog')
    expect(fenetre.textContent).toContain('Clore la demande « Relevé de décembre »')
    expect(fenetre.textContent).toContain('Motif : Remplacée par une autre demande.')
    const clore = screen.getByRole('button', { name: 'Clore la demande' })
    act(() => { fireEvent.click(clore); fireEvent.click(clore) })
    expect(faux.appels.slice(1)).toEqual([{ nom: 'clore_demande', args: { p_demande_id: 'dm1', p_motif: 'remplacee' } }])
    await relacher()
    expect(await screen.findByText(/est close \(Remplacée par une autre demande\)/)).toBeTruthy()
  })

  it('une demande close n’offre plus de geste ; un fichier joint supprimé depuis reste dit', async () => {
    faux.lecture = lecture([demande({ close_le: '2026-11-04T09:00:00Z', close_par: 'u0', motif_de_cloture: 'sans_objet' })],
      [{ id: 'r1', dossier_id: 'd1', demande_id: 'dm1', auteur: 'u1', texte: null, fichier: 'piece', piece_id: null,
        document_id: null, fichier_sha256: 'b'.repeat(64), ecrite_le: '2026-11-03T09:00:00Z' }])
    render(<DemandesAuClient dossierId="d1" />)
    const carte = await screen.findByRole('listitem', { name: 'Demande « Relevé de décembre »' })
    expect(within(carte).getByText('Close')).toBeTruthy()
    expect(within(carte).getByText(/close le 04\/11\/2026 \(Sans objet\)/)).toBeTruthy()
    expect(within(carte).getByText('Un fichier était joint (une pièce) ; il n’est plus au dossier.')).toBeTruthy()
    expect(within(carte).queryByRole('button')).toBeNull()
  })

  it('une lecture partielle des réponses ne montre aucune demande et n’offre aucun geste', async () => {
    faux.lecture = lecture([demande({})], [], { reponses: { lignes: [], complete: false, motif: 'lecture interrompue' } })
    render(<DemandesAuClient dossierId="d1" />)
    expect(await screen.findByText(/Les réponses n'ont pas pu être lues en entier/)).toBeTruthy()
    expect(screen.queryByRole('listitem')).toBeNull()
    expect(screen.queryByText(/Aucune demande/)).toBeNull()
    fireEvent.change(screen.getByLabelText(/^Objet/), { target: { value: 'Attestation' } })
    expect((screen.getByRole('button', { name: 'Ouvrir la demande' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
