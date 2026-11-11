import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import DemandesAuClient from './DemandesAuClient'
import { REFUS } from '../../lib/documentsEtDemandes'
import type { AccesARelancerLus, DemandesDuCabinetLues } from '../../lib/documentsEtDemandesLecture'
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
  // La relance par e-mail (B3b) : les deux drapeaux, les accès lus, la réponse de `send-email`.
  drapeaux: { documents: true, relance: false },
  acces: null as AccesARelancerLus | null,
  accesLus: 0,
  reponse: { data: { ok: true, relanceInscrite: true } as unknown, error: null as unknown },
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (nom: string, args: Record<string, unknown>) => {
      faux.appels.push({ nom, args })
      return new Promise((r) => { faux.retenir.push(() => r({ data: {}, error: null })) })
    },
    functions: {
      invoke: (nom: string, options: { body: Record<string, unknown> }) => {
        faux.appels.push({ nom, args: options.body })
        return new Promise((r) => { faux.retenir.push(() => r(faux.reponse)) })
      },
    },
  },
}))
vi.mock('../../lib/documentsEtDemandesLecture', () => ({
  lireLesDemandesDuCabinet: () => { faux.lectures++; return faux.lecture ? Promise.resolve(faux.lecture) : new Promise(() => {}) },
  lireLesAccesARelancer: () => { faux.accesLus++; return faux.acces ? Promise.resolve(faux.acces) : new Promise(() => {}) },
}))
vi.mock('../../lib/documentsEtDemandes', async (original) => {
  const vrai = await original<typeof import('../../lib/documentsEtDemandes')>()
  return {
    ...vrai,
    get DOCUMENTS_ET_DEMANDES_PREVUS() { return faux.drapeaux.documents },
    get RELANCE_DES_DEMANDES_PAR_EMAIL_PREVUE() { return faux.drapeaux.relance },
  }
})

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-11T10:00:00Z')) })
afterAll(() => { vi.useRealTimers() })
afterEach(() => {
  faux.lecture = null; faux.lectures = 0; faux.appels = []; faux.retenir = []
  faux.drapeaux = { documents: true, relance: false }; faux.acces = null; faux.accesLus = 0
  faux.reponse = { data: { ok: true, relanceInscrite: true }, error: null }
})

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

describe('la relance d’une demande par e-mail (B3b)', () => {
  const accesLus = (lignes: { user_id: string; email: string | null }[], complete = true): AccesARelancerLus => ({
    dossierId: 'd1',
    acces: { lignes, complete, motif: complete ? null : 'lecture interrompue' },
  })
  const leve = () => { faux.drapeaux = { documents: true, relance: true } }

  it('drapeaux baissés : aucun accès lu, aucun bouton, la relance se dit sans e-mail', async () => {
    for (const drapeaux of [{ documents: true, relance: false }, { documents: false, relance: true }]) {
      faux.drapeaux = drapeaux
      faux.lecture = lecture([demande({})])
      faux.acces = accesLus([{ user_id: 'u1', email: 'client@exemple.invalid' }])
      const rendu = render(<DemandesAuClient dossierId="d1" />)
      await screen.findByRole('listitem', { name: 'Demande « Relevé de décembre »' })
      expect(screen.queryByRole('button', { name: 'Relancer par e-mail' })).toBeNull()
      expect(screen.getByText(/La relance se lit dans l’espace du client, sans e-mail/)).toBeTruthy()
      expect(faux.accesLus).toBe(0)
      rendu.unmount()
    }
  })

  it('un seul accès, proposé d’office : la confirmation nomme l’adresse et ce qui part ; un envoi pour deux clics, puis la relecture', async () => {
    leve()
    faux.lecture = lecture([demande({ echeance: '2026-11-20' })])
    faux.acces = accesLus([{ user_id: 'u1', email: 'client@exemple.invalid' }, { user_id: 'u2', email: null }])
    render(<DemandesAuClient dossierId="d1" />)
    const carte = await screen.findByRole('listitem', { name: 'Demande « Relevé de décembre »' })
    expect(await screen.findByText(/Un accès sans adresse électronique lisible ne se propose pas/)).toBeTruthy()
    fireEvent.click(within(carte).getByRole('button', { name: 'Relancer par e-mail' }))
    const fenetre = screen.getByRole('alertdialog')
    expect(fenetre.textContent).toContain('Relancer par e-mail la demande « Relevé de décembre »')
    expect(fenetre.textContent).toContain('L’e-mail part à client@exemple.invalid')
    expect(fenetre.textContent).toContain('et son échéance, le 20/11/2026')
    expect(fenetre.textContent).toContain('signé du nom de ton cabinet')
    expect(within(fenetre).queryByRole('combobox')).toBeNull()
    const envoyer = screen.getByRole('button', { name: 'Envoyer la relance' })
    act(() => { fireEvent.click(envoyer); fireEvent.click(envoyer) })
    expect(faux.appels).toEqual([{ nom: 'send-email', args: { dossierId: 'd1', type: 'relance_demande', demandeId: 'dm1', accesId: 'u1' } }])
    const avant = faux.lectures
    await relacher()
    await waitFor(() => expect(faux.lectures).toBe(avant + 1))
    expect(await screen.findByText(/est relancée par e-mail à client@exemple\.invalid/)).toBeTruthy()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('plusieurs accès : aucun choisi d’office, le bouton retenu jusqu’au choix ; l’e-mail parti sans s’inscrire se dit', async () => {
    leve()
    faux.lecture = lecture([demande({})])
    faux.acces = accesLus([{ user_id: 'u2', email: 'zoe@exemple.invalid' }, { user_id: 'u1', email: 'anne@exemple.invalid' }])
    faux.reponse = { data: { ok: true, relanceInscrite: false }, error: null }
    render(<DemandesAuClient dossierId="d1" />)
    const carte = await screen.findByRole('listitem', { name: 'Demande « Relevé de décembre »' })
    fireEvent.click(within(carte).getByRole('button', { name: 'Relancer par e-mail' }))
    const fenetre = screen.getByRole('alertdialog')
    expect(fenetre.textContent).toContain('sans échéance')
    expect((screen.getByRole('button', { name: 'Envoyer la relance' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(within(fenetre).getByLabelText('Accès à relancer'), { target: { value: 'u2' } })
    expect(fenetre.textContent).toContain('L’e-mail part à zoe@exemple.invalid')
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer la relance' }))
    expect(faux.appels).toEqual([{ nom: 'send-email', args: { dossierId: 'd1', type: 'relance_demande', demandeId: 'dm1', accesId: 'u2' } }])
    await relacher()
    expect(await screen.findByText(/L’e-mail est parti à zoe@exemple\.invalid, mais la relance n’a pas pu être inscrite/)).toBeTruthy()
  })

  it('un refus de la fonction se dit ; rien ne se croit parti', async () => {
    leve()
    faux.lecture = lecture([demande({})])
    faux.acces = accesLus([{ user_id: 'u1', email: 'client@exemple.invalid' }])
    faux.reponse = { data: { error: 'Cette demande est close : elle ne se relance plus.' }, error: null }
    render(<DemandesAuClient dossierId="d1" />)
    const carte = await screen.findByRole('listitem', { name: 'Demande « Relevé de décembre »' })
    fireEvent.click(within(carte).getByRole('button', { name: 'Relancer par e-mail' }))
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer la relance' }))
    await relacher()
    expect(await screen.findByText('La relance par e-mail n’est pas partie : Cette demande est close : elle ne se relance plus.')).toBeTruthy()
  })

  it('des accès lus en partie, ou sans adresse, n’offrent aucun bouton, et le disent', async () => {
    leve()
    faux.lecture = lecture([demande({})])
    faux.acces = accesLus([{ user_id: 'u1', email: 'client@exemple.invalid' }], false)
    const premier = render(<DemandesAuClient dossierId="d1" />)
    expect(await screen.findByText(/Les accès du dossier n'ont pas pu être lus en entier/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Relancer par e-mail' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Relancer à l’écran' })).toBeTruthy()
    premier.unmount()
    faux.acces = accesLus([{ user_id: 'u1', email: null }])
    render(<DemandesAuClient dossierId="d1" />)
    expect(await screen.findByText(/Aucun accès de ce dossier ne porte d’adresse électronique lisible/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Relancer par e-mail' })).toBeNull()
  })

  it('avant le retour des accès, aucun bouton', async () => {
    leve()
    faux.lecture = lecture([demande({})])
    render(<DemandesAuClient dossierId="d1" />)
    await screen.findByRole('listitem', { name: 'Demande « Relevé de décembre »' })
    expect(faux.accesLus).toBe(1)
    expect(screen.queryByRole('button', { name: 'Relancer par e-mail' })).toBeNull()
  })
})
