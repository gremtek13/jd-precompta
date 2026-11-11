import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import ClientNotesDeFrais from './ClientNotesDeFrais'
import { motsDuCabinet } from '../lib/espaceVentes'
import { REFUS_DES_NOTES } from '../lib/notesDeFrais'
import { SANS_LA_CASE_FRAIS, type NoteDeFrais, type PieceDeLAuteur } from '../lib/notesDeFraisVue'
import type { MesNotesDeFraisLues } from '../lib/notesDeFraisLecture'

// « Mes notes de frais » (étape B8), sous la case « Notes de frais » : la lecture est mockée ; la base, par `rpc` ; le drapeau
// de la migration, par un accesseur. L'écran garde : rien sous le drapeau baissé ; rien avant le retour ; aucune note ni aucun
// geste sur une lecture partielle ; la case retirée en base ; le vide d'une liste entière seulement ; le brouillon — le refus
// avant le clic, un envoi pour deux clics, tel qu'il part, puis la relecture ; les kilomètres au barème et le signal de la
// tranche ; soumettre et retirer sur une confirmation qui nomme la note ; avec « Achats », le salarié et les décisions ; les
// mots du client.

const faux = vi.hoisted(() => ({
  leve: true,
  lecture: null as MesNotesDeFraisLues | null,
  lectures: 0,
  appels: [] as { nom: string; args: Record<string, unknown> }[],
  retenir: [] as (() => void)[],
  erreur: null as unknown,
}))

vi.mock('../lib/notesDeFrais', async (original) => {
  const vrai = await original<typeof import('../lib/notesDeFrais')>()
  return { ...vrai, get NOTES_DE_FRAIS_PREVUES() { return faux.leve } }
})
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ dossierActifId: 'd1', session: { user: { id: 'u1' } } }) }))
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (nom: string, args: Record<string, unknown>) => {
      faux.appels.push({ nom, args })
      return new Promise((r) => { faux.retenir.push(() => r({ data: faux.erreur ? null : {}, error: faux.erreur })) })
    },
  },
}))
vi.mock('../lib/notesDeFraisLecture', () => ({
  lireMesNotesDeFrais: () => { faux.lectures++; return faux.lecture ? Promise.resolve(faux.lecture) : new Promise(() => {}) },
}))

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-11T10:00:00Z')) })
afterAll(() => { vi.useRealTimers() })
afterEach(() => {
  faux.leve = true; faux.lecture = null; faux.lectures = 0; faux.appels = []; faux.retenir = []; faux.erreur = null
  vi.restoreAllMocks()
})

const note = (n: Partial<NoteDeFrais>): NoteDeFrais => ({
  id: 'n1', dossier_id: 'd1', auteur: 'u1', beneficiaire_salarie: null, date_depense: '2026-11-02', nature: 'repas',
  motif: 'Déjeuner fictif', montant_ttc: 24.5, montant_tva: 0, distance_km: null, vehicule_type: null, puissance_fiscale: null,
  electrique: null, piece_id: 'p1', etat: 'brouillon', version: 3, cree_le: '2026-11-02T10:00:00Z', soumise_le: null,
  approuvee_le: null, refusee_le: null, motif_refus: null, remboursee_le: null, date_remboursement: null, moyen_remboursement: null,
  ...n,
})
const piece = (p: Partial<PieceDeLAuteur>): PieceDeLAuteur => ({
  id: 'p1', dossier_id: 'd1', nom_fichier: 'ticket-fictif.pdf', statut: 'a_valider', uploaded_by: 'u1', date_piece: '2026-11-02',
  montant_ttc: 24.5, created_at: '2026-11-02T09:00:00Z', ...p,
})
const lue = <T,>(lignes: T[], complete = true) => ({ lignes, complete, motif: complete ? null : 'lecture interrompue' })
const lecture = (notes: NoteDeFrais[], pieces: PieceDeLAuteur[] = [], achats = false, p: Partial<Extract<MesNotesDeFraisLues, { etat: 'lues' }>> = {}): MesNotesDeFraisLues => ({
  dossierId: 'd1', etat: 'lues', achats, lesNotes: lue(notes), pieces: lue(pieces), ...p,
})
const carte = (nom: string) => screen.findByRole('listitem', { name: `Note « ${nom} »` })

describe('« Mes notes de frais »', () => {
  it('rien sous le drapeau baissé ; rien avant le retour ; une lecture partielle n’offre rien ; sans la case ; le vide d’une liste entière', async () => {
    faux.leve = false
    const baisse = render(<ClientNotesDeFrais />)
    expect(baisse.container.textContent).toBe('')
    expect(faux.lectures).toBe(0)
    baisse.unmount()
    faux.leve = true
    const premier = render(<ClientNotesDeFrais />)
    expect(screen.getByText('Chargement…')).toBeTruthy()
    premier.unmount()
    faux.lecture = lecture([note({})], [piece({})], false, { pieces: lue([], false) })
    const second = render(<ClientNotesDeFrais />)
    expect(await screen.findByText(/Tes notes de frais n'ont pas pu être/)).toBeTruthy()
    expect(screen.queryByText('Déjeuner fictif', { exact: false })).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    second.unmount()
    faux.lecture = { dossierId: 'd1', etat: 'sans_frais' }
    const troisieme = render(<ClientNotesDeFrais />)
    expect(await screen.findByText(SANS_LA_CASE_FRAIS)).toBeTruthy()
    troisieme.unmount()
    faux.lecture = lecture([note({ etat: 'retiree', piece_id: null })])
    render(<ClientNotesDeFrais />)
    expect(await screen.findByText('Tu n’as aucune note de frais pour l’instant.')).toBeTruthy()
    expect(faux.appels).toEqual([])
  })

  it('un brouillon neuf : le refus avant le clic ; un envoi pour deux clics, tel qu’il part ; puis la relecture', async () => {
    faux.lecture = lecture([], [piece({}), piece({ id: 'p2', nom_fichier: 'validee.pdf', statut: 'validee' })])
    render(<ClientNotesDeFrais />)
    fireEvent.click(await screen.findByRole('button', { name: 'Nouvelle note' }))
    const f = screen.getByLabelText('Nouvelle note de frais')
    const enregistrer = within(f).getByRole('button', { name: 'Enregistrer le brouillon' }) as HTMLButtonElement
    expect(within(f).getByText(REFUS_DES_NOTES.nature)).toBeTruthy()
    expect(enregistrer.disabled).toBe(true)
    // Le justificatif : seules les pièces que la base laisse citer.
    const choix = within(f).getByLabelText('Justificatif') as HTMLSelectElement
    expect([...choix.options].map((o) => o.textContent)).toEqual(['Aucun pour l’instant', 'ticket-fictif.pdf — 02/11/2026'])
    fireEvent.change(within(f).getByLabelText('Nature'), { target: { value: 'repas' } })
    fireEvent.change(within(f).getByLabelText('Motif'), { target: { value: 'Déjeuner client fictif' } })
    fireEvent.change(within(f).getByLabelText('Montant TTC (€)'), { target: { value: '30,005' } })
    expect(within(f).getByText(REFUS_DES_NOTES.ttc)).toBeTruthy()
    fireEvent.change(within(f).getByLabelText('Montant TTC (€)'), { target: { value: '30,50' } })
    fireEvent.change(within(f).getByLabelText('Dont TVA (€, facultatif)'), { target: { value: '31' } })
    expect(within(f).getByText(REFUS_DES_NOTES.tva)).toBeTruthy()
    fireEvent.change(within(f).getByLabelText('Dont TVA (€, facultatif)'), { target: { value: '2,77' } })
    fireEvent.change(choix, { target: { value: 'p1' } })
    expect(enregistrer.disabled).toBe(false)
    act(() => { fireEvent.click(enregistrer); fireEvent.click(enregistrer) })
    expect(faux.appels).toEqual([{ nom: 'enregistrer_note_de_frais', args: {
      p_dossier_id: 'd1', p_note_id: null, p_version_lue: null, p_date: '2026-11-11', p_nature: 'repas', p_motif: 'Déjeuner client fictif',
      p_montant_ttc: 30.5, p_montant_tva: 2.77, p_beneficiaire_salarie: null, p_piece_id: 'p1', p_distance_km: null,
      p_vehicule_type: null, p_puissance_fiscale: null, p_electrique: null,
    } }])
    const avant = faux.lectures
    faux.lecture = lecture([note({ id: 'n9', date_depense: '2026-11-11', montant_ttc: 30.5, montant_tva: 2.77 })], [piece({})])
    await act(async () => { faux.retenir.forEach((r) => r()) })
    await waitFor(() => expect(faux.lectures).toBe(avant + 1))
    expect(await screen.findByText('Ton brouillon est enregistré : soumets-le quand il est prêt.')).toBeTruthy()
    expect(await carte('Repas du 11/11/2026')).toBeTruthy()
    expect(motsDuCabinet(globalThis.document.body.textContent ?? '')).toEqual([])
  })

  it('des kilomètres : le montant du barème, sans TVA ni justificatif ; le signal de la première tranche', async () => {
    const anciens = note({ id: 'k0', nature: 'kilometres', etat: 'soumise', soumise_le: '2026-10-02T10:00:00Z', montant_ttc: 2000, piece_id: null,
      distance_km: 4980, vehicule_type: 'voiture', puissance_fiscale: 3, electrique: false, date_depense: '2026-10-01' })
    faux.lecture = lecture([anciens], [piece({})])
    render(<ClientNotesDeFrais />)
    fireEvent.click(await screen.findByRole('button', { name: 'Nouvelle note' }))
    const f = screen.getByLabelText('Nouvelle note de frais')
    fireEvent.change(within(f).getByLabelText('Nature'), { target: { value: 'kilometres' } })
    expect(within(f).queryByLabelText('Justificatif')).toBeNull()
    fireEvent.change(within(f).getByLabelText('Motif'), { target: { value: 'Rendez-vous fictif' } })
    fireEvent.change(within(f).getByLabelText('Distance (km)'), { target: { value: '45' } })
    fireEvent.change(within(f).getByLabelText('Véhicule'), { target: { value: 'voiture' } })
    fireEvent.change(within(f).getByLabelText('Puissance fiscale (CV)'), { target: { value: '3' } })
    expect(within(f).getByText(REFUS_DES_NOTES.vehicule)).toBeTruthy()
    fireEvent.change(within(f).getByLabelText('Électrique'), { target: { value: 'non' } })
    expect(within(f).getByText(/Montant au barème de 2026/).textContent).toContain('23,81')
    expect(within(f).getByRole('note').textContent).toContain('ton cabinet régularise')
    const enregistrer = within(f).getByRole('button', { name: 'Enregistrer le brouillon' })
    act(() => { fireEvent.click(enregistrer) })
    expect(faux.appels[0].args).toMatchObject({ p_nature: 'kilometres', p_montant_ttc: 23.81, p_montant_tva: null, p_piece_id: null,
      p_distance_km: 45, p_vehicule_type: 'voiture', p_puissance_fiscale: 3, p_electrique: false })
  })

  it('soumettre et retirer un brouillon, sur une confirmation qui le nomme ; le refus de la soumission dit avant le clic', async () => {
    faux.lecture = lecture([note({}), note({ id: 'n2', piece_id: null, date_depense: '2026-11-03', motif: 'Taxi fictif', nature: 'transport' })], [piece({})])
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<ClientNotesDeFrais />)
    const sans = await carte('Transport du 03/11/2026')
    expect((within(sans).getByRole('button', { name: 'Soumettre' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(sans).getByText(REFUS_DES_NOTES.sansJustificatif)).toBeTruthy()
    const c = await carte('Repas du 02/11/2026')
    expect(within(c).getByText('ticket-fictif.pdf')).toBeTruthy()
    const soumettre = within(c).getByRole('button', { name: 'Soumettre' })
    act(() => { fireEvent.click(soumettre); fireEvent.click(soumettre) })
    expect(confirmer).toHaveBeenCalledTimes(1)
    expect(confirmer.mock.calls[0][0]).toContain('Repas du 02/11/2026 — « Déjeuner fictif »')
    expect(faux.appels).toEqual([{ nom: 'soumettre_note_de_frais', args: { p_note_id: 'n1', p_version_lue: 3 } }])
    await act(async () => { faux.retenir.forEach((r) => r()) })
    faux.appels = []
    faux.retenir = []
    fireEvent.click(within(await carte('Repas du 02/11/2026')).getByRole('button', { name: 'Retirer' }))
    expect(confirmer.mock.calls[1][0]).toContain('« ticket-fictif.pdf »')
    expect(faux.appels).toEqual([{ nom: 'retirer_note_de_frais', args: { p_note_id: 'n1', p_version_lue: 3 } }])
  })

  it('avec « Achats » : le salarié sans accès ; refuser sous un motif que l’auteur lit, rembourser ; le refus de la base se dit', async () => {
    faux.lecture = lecture([
      note({ id: 's1', auteur: 'u2', etat: 'soumise', soumise_le: '2026-11-03T10:00:00Z' }),
      note({ id: 'a1', auteur: 'u2', etat: 'approuvee', date_depense: '2026-11-01', motif: 'Hôtel fictif', nature: 'hebergement',
        soumise_le: '2026-11-02T10:00:00Z', approuvee_le: '2026-11-04T10:00:00Z' }),
    ], [], true)
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<ClientNotesDeFrais />)
    const s = await carte('Repas du 02/11/2026')
    expect(within(s).getByText('La note d’un autre accès de ta société')).toBeTruthy()
    fireEvent.click(within(s).getByRole('button', { name: 'Refuser' }))
    const refuser = within(s).getByRole('button', { name: 'Refuser la note' }) as HTMLButtonElement
    expect(refuser.disabled).toBe(true)
    expect(within(s).getByText(REFUS_DES_NOTES.motifDuRefus)).toBeTruthy()
    fireEvent.change(within(s).getByLabelText('Motif du refus (l’auteur de la note le lit, et ton cabinet aussi)'), { target: { value: 'Hors activité' } })
    faux.erreur = { message: REFUS_DES_NOTES.version, code: '22023' }
    act(() => { fireEvent.click(refuser); fireEvent.click(refuser) })
    expect(confirmer).toHaveBeenCalledTimes(1)
    expect(faux.appels).toEqual([{ nom: 'refuser_note_de_frais', args: { p_note_id: 's1', p_version_lue: 3, p_motif: 'Hors activité' } }])
    await act(async () => { faux.retenir.forEach((r) => r()) })
    expect(await screen.findByText(`La note n’est pas refusée : ${REFUS_DES_NOTES.version}`)).toBeTruthy()
    faux.erreur = null
    faux.appels = []
    faux.retenir = []
    const a = await carte('Hébergement du 01/11/2026')
    fireEvent.click(within(a).getByRole('button', { name: 'Déclarer remboursée' }))
    fireEvent.change(within(a).getByLabelText('Moyen du remboursement'), { target: { value: 'virement' } })
    fireEvent.click(within(a).getByRole('button', { name: 'Déclarer le remboursement' }))
    expect(faux.appels).toEqual([{ nom: 'rembourser_note_de_frais', args: { p_note_id: 'a1', p_version_lue: 3, p_date: '2026-11-11', p_moyen: 'virement' } }])
    await act(async () => { faux.retenir.forEach((r) => r()) })
    // La note d'un salarié sans accès : offerte avec « Achats ».
    fireEvent.click(screen.getByRole('button', { name: 'Nouvelle note' }))
    const f = screen.getByLabelText('Nouvelle note de frais')
    fireEvent.click(within(f).getByLabelText('Pour un salarié sans accès'))
    expect(within(f).getByLabelText('Nom du salarié')).toBeTruthy()
    expect(within(f).getByText(REFUS_DES_NOTES.nomDuSalarie)).toBeTruthy()
    expect(motsDuCabinet(globalThis.document.body.textContent ?? '')).toEqual([])
  })
})
