import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ContactsVue from './ContactsVue'
import { contact } from '../../test/contacts'
import type { AccesDuDossier } from '../../lib/auteursVentes'
import type { LectureDesActivites } from '../../lib/contactsInactifsLecture'
import type { LectureDesContacts } from '../../lib/contactsLecture'

// « CLIENTS SANS ACTIVITÉ DEPUIS TROIS ANS » DANS LA VUE « CLIENTS ». Ce que ces cas gardent : drapeau levé, la liste de
// lectures entières, au jour de Paris ; « Effacer » ouvre la confirmation d'hier, sous son verrou (deux clics dans le même
// `act`, un seul effacement) ; une lecture partielle ou rompue le dit et n'offre aucun geste ; drapeau baissé, ni section ni
// lecture de l'activité.

const etat = vi.hoisted(() => ({
  drapeau: true,
  contacts: null as unknown as LectureDesContacts,
  activites: null as unknown as Promise<LectureDesActivites>,
  effacer: vi.fn(),
  lireActivites: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../lib/devis', async (original) => {
  const vrai = await original<typeof import('../../lib/devis')>()
  return { ...vrai, get DEVIS_CITENT_UN_CONTACT() { return etat.drapeau } }
})
vi.mock('../../lib/contactsLecture', () => ({ lireLesContacts: () => Promise.resolve(etat.contacts) }))
vi.mock('../../lib/contactsInactifsLecture', () => ({
  lireLesActivitesDesContacts: (dossierId: string) => { etat.lireActivites(dossierId); return etat.activites },
}))
vi.mock('../../lib/contactsEcriture', () => ({
  effacerContact: (...a: unknown[]) => etat.effacer(...a),
  enregistrerContact: vi.fn(), importerContacts: vi.fn(), reprendreContact: vi.fn(), retirerContact: vi.fn(),
}))

const ACCES: AccesDuDossier = { etat: 'lus', comptes: [] }
const ANCIEN = contact({ id: 'k-ancien', nom: 'Client Ancien', siren: null, siret: null, cree_le: '2021-01-10T09:00:00Z' })
const RECENT = contact({ id: 'k-recent', nom: 'Client Récent', siren: null, siret: null, cree_le: '2021-01-10T09:00:00Z' })
const EFFACE = contact({
  id: 'k-efface', nom: 'Contact effacé le 01/01/2022', type_client: null, adresse: null, siren: null, siret: null, delai_paiement_jours: null,
  cree_le: '2020-01-10T09:00:00Z', efface_le: '2022-01-01T09:00:00Z', efface_par: 'u',
})
const LISTE = () => screen.queryByRole('list', { name: 'Clients sans activité depuis trois ans' })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-06T11:00:00Z'))
  etat.drapeau = true
  etat.contacts = { lignes: [ANCIEN, RECENT, EFFACE], complete: true, motif: null }
  // Un DEVIS récent cite « Client Récent » : il n'est pas proposé.
  etat.activites = Promise.resolve({ activites: [{ contactId: 'k-recent', date: '2026-10-01' }, { contactId: 'k-ancien', date: '2022-03-01' }], complete: true, motif: null })
  etat.effacer.mockReset()
  etat.effacer.mockResolvedValue(undefined)
  etat.lireActivites.mockReset()
})
afterEach(() => { vi.useRealTimers() })

describe('la section, drapeau levé', () => {
  it('la liste : le client sans facture ni devis depuis trois ans, ni le récent ni l’effacé', async () => {
    render(<ContactsVue espace="cabinet" acces={ACCES} dossierId="d1" articleExoneration={null} />)
    const liste = await waitFor(() => { const l = LISTE(); if (!l) throw new Error('pas encore'); return l })
    const items = within(liste).getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toHaveLength(1)
    expect(items[0]).toContain('Client Ancien')
    expect(items[0]).toContain('dernière facture ou dernier devis le 01/03/2022')
    expect(etat.lireActivites).toHaveBeenCalledWith('d1')
  })

  it('« Effacer » ouvre la confirmation d’hier ; deux clics dans le même act n’effacent qu’une fois', async () => {
    render(<ContactsVue espace="cabinet" acces={ACCES} dossierId="d1" articleExoneration={null} />)
    const liste = await waitFor(() => { const l = LISTE(); if (!l) throw new Error('pas encore'); return l })
    fireEvent.click(within(liste).getByRole('button', { name: 'Effacer' }))
    const dialogue = await screen.findByRole('alertdialog')
    const bouton = within(dialogue).getByRole('button', { name: 'Effacer le client' })
    await act(async () => { fireEvent.click(bouton); fireEvent.click(bouton) })
    await waitFor(() => expect(etat.effacer).toHaveBeenCalledTimes(1))
    expect(etat.effacer).toHaveBeenCalledWith('d1', 'k-ancien')
  })

  it('une lecture partielle de l’activité le dit, sans liste ni geste', async () => {
    etat.activites = Promise.resolve({ activites: [], complete: false, motif: 'devis : 1 ligne lue sur 2' })
    render(<ContactsVue espace="cabinet" acces={ACCES} dossierId="d1" articleExoneration={null} />)
    await screen.findByText(/La liste des clients sans activité depuis trois ans ne se dit donc pas/)
    expect(LISTE()).toBeNull()
    expect(screen.queryByText('Aucun client sans facture ni devis depuis trois ans.')).toBeNull()
  })

  it('une lecture qui lève le dit, sans liste', async () => {
    etat.activites = Promise.reject(new Error('réseau coupé'))
    render(<ContactsVue espace="cabinet" acces={ACCES} dossierId="d1" articleExoneration={null} />)
    await screen.findByText(/la liste ne se dit pas/)
    expect(LISTE()).toBeNull()
  })

  it('les contacts lus en partie : la section ne dit pas la liste non plus', async () => {
    etat.contacts = { lignes: [ANCIEN], complete: false, motif: '1 ligne lue sur 3' }
    render(<ContactsVue espace="cabinet" acces={ACCES} dossierId="d1" articleExoneration={null} />)
    await screen.findByText(/La liste des clients sans activité depuis trois ans ne se dit donc pas/)
    expect(LISTE()).toBeNull()
  })
})

describe('drapeau baissé', () => {
  it('ni section ni lecture de l’activité : l’écran d’hier', async () => {
    etat.drapeau = false
    render(<ContactsVue espace="cabinet" acces={ACCES} dossierId="d1" articleExoneration={null} />)
    await screen.findByRole('table', { name: 'Clients' })
    expect(screen.queryByText('Clients sans activité depuis trois ans')).toBeNull()
    expect(etat.lireActivites).not.toHaveBeenCalled()
  })
})
