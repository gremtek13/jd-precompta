import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import ClientDemandes from './ClientDemandes'
import { motsDuCabinet } from '../lib/espaceVentes'
import { REFUS } from '../lib/documentsEtDemandes'
import type { DemandeDuCabinet, ReponseALaDemande } from '../lib/documentsEtDemandesVue'
import type { MesDemandesLues } from '../lib/documentsEtDemandesLecture'

// « Mes demandes » (étape B3a), à tout accès : la lecture est mockée ; la base, par `rpc`. L'écran garde : rien avant le
// retour ; aucune demande sur une lecture partielle ; le vide d'une liste entière seulement ; répondre — un texte, un dépôt
// que la base admettrait —, un envoi pour deux clics, la réponse telle qu'elle part, puis la relecture ; le refus avant le
// clic ; une demande close sans formulaire ; des dépôts lus en partie, aucun proposé ; les mots du client.

const faux = vi.hoisted(() => ({
  lecture: null as MesDemandesLues | null,
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
vi.mock('../lib/documentsEtDemandesLecture', () => ({
  lireMesDemandes: () => { faux.lectures++; return faux.lecture ? Promise.resolve(faux.lecture) : new Promise(() => {}) },
}))

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-11T10:00:00Z')) })
afterAll(() => { vi.useRealTimers() })
afterEach(() => { faux.lecture = null; faux.lectures = 0; faux.appels = []; faux.retenir = []; faux.erreur = null })

const demande = (p: Partial<DemandeDuCabinet>): DemandeDuCabinet => ({
  id: 'dm1', dossier_id: 'd1', objet: 'Ton relevé de décembre', detail: 'Le relevé complet, en PDF.', echeance: '2026-11-30',
  attendu: 'les_deux', auteur: 'u0', ouverte_le: '2026-11-05T09:00:00Z', close_par: null, close_le: null, motif_de_cloture: null, ...p,
})
const lue = <T,>(lignes: T[], complete = true) => ({ lignes, complete, motif: complete ? null : 'lecture interrompue' })
const lecture = (demandes: DemandeDuCabinet[], reponses: ReponseALaDemande[] = [], p: Partial<MesDemandesLues> = {}): MesDemandesLues => ({
  dossierId: 'd1', demandes: lue(demandes), reponses: lue(reponses),
  relances: lue([{ id: 'x1', dossier_id: 'd1', demande_id: 'dm1', canal: 'ecran', email_id: null, relancee_par: 'u0', relancee_le: '2026-11-09T09:00:00Z' }]),
  pieces: lue([
    { id: 'p1', dossier_id: 'd1', nom_fichier: 'releve-decembre.pdf', created_at: '2026-11-06T09:00:00Z', uploaded_by: 'u1' },
    { id: 'p0', dossier_id: 'd1', nom_fichier: 'ancien.pdf', created_at: '2026-11-01T09:00:00Z', uploaded_by: 'u1' },
  ]),
  documentsDivers: lue([]),
  ...p,
})

describe('« Mes demandes »', () => {
  it('rien avant le retour ; une lecture partielle ne montre aucune demande ; une liste entière vide le dit', async () => {
    const premier = render(<ClientDemandes />)
    expect(screen.getByText('Chargement…')).toBeTruthy()
    premier.unmount()
    faux.lecture = lecture([demande({})], [], { reponses: lue([], false) })
    const second = render(<ClientDemandes />)
    expect(await screen.findByText(/Les demandes de ton cabinet n'ont pas pu être/)).toBeTruthy()
    expect(screen.queryByText('Ton relevé de décembre')).toBeNull()
    second.unmount()
    faux.lecture = lecture([])
    render(<ClientDemandes />)
    expect(await screen.findByText('Ton cabinet ne t’a fait aucune demande pour l’instant.')).toBeTruthy()
  })

  it('répondre : un texte et un dépôt fait depuis la demande ; un envoi pour deux clics, tel qu’il part ; puis la relecture', async () => {
    faux.lecture = lecture([demande({})])
    render(<ClientDemandes />)
    const carte = await screen.findByRole('listitem', { name: 'Demande « Ton relevé de décembre »' })
    expect(within(carte).getByText(/ton cabinet t’a relancé le 09\/11\/2026/)).toBeTruthy()
    const options = within(carte).getAllByRole('option').map((o) => o.textContent)
    expect(options.some((o) => o?.includes('releve-decembre.pdf'))).toBe(true)
    expect(options.some((o) => o?.includes('ancien.pdf'))).toBe(false)
    expect((within(carte).getByRole('button', { name: 'Envoyer ma réponse' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(within(carte).getByLabelText(/^Ta réponse/), { target: { value: 'Le voici.' } })
    fireEvent.change(within(carte).getByLabelText(/^Fichier à joindre/), { target: { value: 'piece:p1' } })
    const bouton = within(carte).getByRole('button', { name: 'Envoyer ma réponse' })
    act(() => { fireEvent.click(bouton); fireEvent.click(bouton) })
    expect(faux.appels).toEqual([{ nom: 'repondre_a_la_demande', args: {
      p_demande_id: 'dm1', p_texte: 'Le voici.', p_piece_id: 'p1', p_document_id: null,
    } }])
    const avant = faux.lectures
    await act(async () => { faux.retenir.forEach((r) => r()) })
    await waitFor(() => expect(faux.lectures).toBe(avant + 1))
    expect(await screen.findByText('Ta réponse est envoyée à ton cabinet.')).toBeTruthy()
    expect(motsDuCabinet(globalThis.document.body.textContent ?? '')).toEqual([])
  })

  it('le refus se dit avant le clic ; celui de la base, après, au tutoiement', async () => {
    faux.lecture = lecture([demande({})])
    render(<ClientDemandes />)
    const carte = await screen.findByRole('listitem', { name: 'Demande « Ton relevé de décembre »' })
    fireEvent.change(within(carte).getByLabelText(/^Ta réponse/), { target: { value: 'x'.repeat(4001) } })
    expect(within(carte).getByText(REFUS.texteDeLaReponse)).toBeTruthy()
    fireEvent.change(within(carte).getByLabelText(/^Ta réponse/), { target: { value: 'Ci-joint.' } })
    faux.erreur = { message: REFUS.pasSonDepot, code: '22023' }
    fireEvent.click(within(carte).getByRole('button', { name: 'Envoyer ma réponse' }))
    await act(async () => { faux.retenir.forEach((r) => r()) })
    expect(await screen.findByText(`Ta réponse n’est pas partie : ${REFUS.pasSonDepot}`)).toBeTruthy()
  })

  it('une demande close n’a pas de formulaire ; des dépôts lus en partie, aucun n’est proposé, le texte peut partir', async () => {
    faux.lecture = lecture([demande({ close_le: '2026-11-08T09:00:00Z', motif_de_cloture: 'satisfaite' }), demande({ id: 'dm2', objet: 'Ton bail' })],
      [{ id: 'r1', dossier_id: 'd1', demande_id: 'dm1', auteur: 'u2', texte: 'Fait.', fichier: null, piece_id: null, document_id: null,
        fichier_sha256: null, ecrite_le: '2026-11-07T09:00:00Z' }],
      { pieces: lue([], false) })
    render(<ClientDemandes />)
    const close = await screen.findByRole('listitem', { name: 'Demande « Ton relevé de décembre »' })
    expect(within(close).getByText('Cette demande est close : ton cabinet n’attend plus de réponse.')).toBeTruthy()
    expect(within(close).getByText(/Un autre accès de ton dossier, le 07\/11\/2026/)).toBeTruthy()
    expect(within(close).queryByRole('button')).toBeNull()
    expect(screen.getByText(/Tes dépôts n'ont pas pu être/)).toBeTruthy()
    const ouverte = screen.getByRole('listitem', { name: 'Demande « Ton bail »' })
    expect((within(ouverte).getByLabelText(/^Fichier à joindre/) as HTMLSelectElement).disabled).toBe(true)
    fireEvent.change(within(ouverte).getByLabelText(/^Ta réponse/), { target: { value: 'Je te l’envoie demain.' } })
    expect((within(ouverte).getByRole('button', { name: 'Envoyer ma réponse' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('une relance partie par e-mail se dit « par e-mail » (B3b)', async () => {
    faux.lecture = lecture([demande({})], [], {
      relances: lue([{ id: 'x2', dossier_id: 'd1', demande_id: 'dm1', canal: 'email', email_id: 'e1', relancee_par: 'u0', relancee_le: '2026-11-10T09:00:00Z' }]),
    })
    render(<ClientDemandes />)
    const carte = await screen.findByRole('listitem', { name: 'Demande « Ton relevé de décembre »' })
    expect(within(carte).getByText(/ton cabinet t’a relancé par e-mail le 10\/11\/2026/)).toBeTruthy()
  })
})
