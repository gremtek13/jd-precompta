import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import NotesDeFraisDuClient from './NotesDeFraisDuClient'
import { REFUS_DES_NOTES } from '../../lib/notesDeFrais'
import { LIBELLE_MOTIF_REFUS_NOTE_DE_FRAIS } from '../../lib/droitsAcces'
import type { NoteDeFrais } from '../../lib/notesDeFraisVue'
import type { NotesDeFraisDuDossierLues } from '../../lib/notesDeFraisLecture'

// Les notes de frais du client, côté cabinet (étape B8), dans l'onglet Justificatifs : rien sous le drapeau baissé ; rien avant
// le retour ; une lecture partielle n'offre aucun geste ; un brouillon ne se dit qu'en nombre ; approuver sur une confirmation
// qui nomme la note, un envoi pour deux clics ; refuser sous un motif dont le libellé dit que l'auteur le lit, le refus du
// module avant le clic ; déclarer le remboursement.

const faux = vi.hoisted(() => ({
  leve: true,
  lecture: null as NotesDeFraisDuDossierLues | null,
  lectures: 0,
  appels: [] as { nom: string; args: Record<string, unknown> }[],
  retenir: [] as (() => void)[],
}))

vi.mock('../../lib/notesDeFrais', async (original) => {
  const vrai = await original<typeof import('../../lib/notesDeFrais')>()
  return { ...vrai, get NOTES_DE_FRAIS_PREVUES() { return faux.leve } }
})
vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (nom: string, args: Record<string, unknown>) => {
      faux.appels.push({ nom, args })
      return new Promise((r) => { faux.retenir.push(() => r({ data: {}, error: null })) })
    },
  },
}))
vi.mock('../../lib/notesDeFraisLecture', () => ({
  lireLesNotesDeFraisDuDossier: () => { faux.lectures++; return faux.lecture ? Promise.resolve(faux.lecture) : new Promise(() => {}) },
}))

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-11T10:00:00Z')) })
afterAll(() => { vi.useRealTimers() })
afterEach(() => { faux.leve = true; faux.lecture = null; faux.lectures = 0; faux.appels = []; faux.retenir = []; vi.restoreAllMocks() })

const note = (n: Partial<NoteDeFrais>): NoteDeFrais => ({
  id: 'n1', dossier_id: 'd1', auteur: 'u1', beneficiaire_salarie: null, date_depense: '2026-11-02', nature: 'repas',
  motif: 'Déjeuner fictif', montant_ttc: 24.5, montant_tva: 0, distance_km: null, vehicule_type: null, puissance_fiscale: null,
  electrique: null, piece_id: 'p1', etat: 'soumise', version: 2, cree_le: '2026-11-02T10:00:00Z', soumise_le: '2026-11-03T10:00:00Z',
  approuvee_le: null, refusee_le: null, motif_refus: null, remboursee_le: null, date_remboursement: null, moyen_remboursement: null,
  ...n,
})
const lue = <T,>(lignes: T[], complete = true) => ({ lignes, complete, motif: complete ? null : 'lecture interrompue' })
const lecture = (notes: NoteDeFrais[], p: Partial<NotesDeFraisDuDossierLues> = {}): NotesDeFraisDuDossierLues => ({
  dossierId: 'd1', lesNotes: lue(notes), justificatifs: lue([{ id: 'p1', dossier_id: 'd1', nom_fichier: 'ticket-fictif.pdf', statut: 'a_valider' }]),
  ...p,
})
const carte = (nom: string) => screen.findByRole('listitem', { name: `Note « ${nom} »` })

describe('les notes de frais du client, côté cabinet', () => {
  it('rien sous le drapeau baissé ; rien avant le retour ; une lecture partielle n’offre rien ; un brouillon se compte seulement', async () => {
    faux.leve = false
    const baisse = render(<NotesDeFraisDuClient dossierId="d1" />)
    expect(baisse.container.textContent).toBe('')
    expect(faux.lectures).toBe(0)
    baisse.unmount()
    faux.leve = true
    const premier = render(<NotesDeFraisDuClient dossierId="d1" />)
    expect(screen.getByText('Chargement…')).toBeTruthy()
    premier.unmount()
    faux.lecture = lecture([note({})], { justificatifs: lue([], false) })
    const second = render(<NotesDeFraisDuClient dossierId="d1" />)
    expect(await screen.findByText(/Les notes de frais du client n'ont pas pu être lues/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    second.unmount()
    faux.lecture = lecture([note({ etat: 'brouillon', soumise_le: null })])
    render(<NotesDeFraisDuClient dossierId="d1" />)
    expect(await screen.findByText(/Un brouillon est en cours/)).toBeTruthy()
    expect(screen.getByText('Le client n’a soumis aucune note de frais.')).toBeTruthy()
    expect(screen.queryByText(/Déjeuner fictif/)).toBeNull()
  })

  it('approuver : une confirmation qui nomme la note, un envoi pour deux clics, à la version lue', async () => {
    faux.lecture = lecture([note({ beneficiaire_salarie: 'Salarié fictif' })])
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<NotesDeFraisDuClient dossierId="d1" />)
    const c = await carte('Repas du 02/11/2026')
    expect(within(c).getByText('Pour le salarié Salarié fictif, saisie par un accès du client')).toBeTruthy()
    expect(within(c).getByText('ticket-fictif.pdf')).toBeTruthy()
    const approuver = within(c).getByRole('button', { name: 'Approuver' })
    act(() => { fireEvent.click(approuver); fireEvent.click(approuver) })
    expect(confirmer).toHaveBeenCalledTimes(1)
    expect(confirmer.mock.calls[0][0]).toContain('Repas du 02/11/2026 — « Déjeuner fictif »')
    expect(faux.appels).toEqual([{ nom: 'approuver_note_de_frais', args: { p_note_id: 'n1', p_version_lue: 2 } }])
    const avant = faux.lectures
    await act(async () => { faux.retenir.forEach((r) => r()) })
    expect(faux.lectures).toBe(avant + 1)
    expect(await screen.findByText('La note est approuvée.')).toBeTruthy()
  })

  it('refuser sous un motif que l’auteur lit, le refus avant le clic ; déclarer le remboursement d’une approuvée', async () => {
    faux.lecture = lecture([note({}), note({ id: 'n2', etat: 'approuvee', approuvee_le: '2026-11-04T10:00:00Z', date_depense: '2026-11-01',
      nature: 'transport', motif: 'Train fictif', piece_id: null })])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<NotesDeFraisDuClient dossierId="d1" />)
    const c = await carte('Repas du 02/11/2026')
    fireEvent.click(within(c).getByRole('button', { name: 'Refuser' }))
    const champ = within(c).getByLabelText(LIBELLE_MOTIF_REFUS_NOTE_DE_FRAIS)
    expect(LIBELLE_MOTIF_REFUS_NOTE_DE_FRAIS).toContain('le lit')
    const refuser = within(c).getByRole('button', { name: 'Refuser la note' }) as HTMLButtonElement
    expect(refuser.disabled).toBe(true)
    expect(within(c).getByText(REFUS_DES_NOTES.motifDuRefus)).toBeTruthy()
    fireEvent.change(champ, { target: { value: 'Sans justificatif lisible' } })
    act(() => { fireEvent.click(refuser) })
    expect(faux.appels).toEqual([{ nom: 'refuser_note_de_frais', args: { p_note_id: 'n1', p_version_lue: 2, p_motif: 'Sans justificatif lisible' } }])
    await act(async () => { faux.retenir.forEach((r) => r()) })
    faux.appels = []
    faux.retenir = []
    const a = await carte('Transport du 01/11/2026')
    expect(within(a).queryByRole('button', { name: 'Approuver' })).toBeNull()
    fireEvent.click(within(a).getByRole('button', { name: 'Déclarer remboursée' }))
    fireEvent.change(within(a).getByLabelText('Remboursée le'), { target: { value: '2026-10-30' } })
    expect(within(a).getByText(REFUS_DES_NOTES.dateDuRemboursement)).toBeTruthy()
    fireEvent.change(within(a).getByLabelText('Remboursée le'), { target: { value: '2026-11-05' } })
    fireEvent.change(within(a).getByLabelText('Moyen du remboursement'), { target: { value: 'cheque' } })
    fireEvent.click(within(a).getByRole('button', { name: 'Déclarer le remboursement' }))
    expect(faux.appels).toEqual([{ nom: 'rembourser_note_de_frais', args: { p_note_id: 'n2', p_version_lue: 2, p_date: '2026-11-05', p_moyen: 'cheque' } }])
  })
})
