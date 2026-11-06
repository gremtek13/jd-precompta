import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DevisSaisieModal from './DevisSaisieModal'
import { contact } from '../../test/contacts'
import { ligneDevisVide, saisieDuDevis, type EmissionAJuger } from '../../lib/devis'
import type { LectureDesContacts } from '../../lib/contactsLecture'

// « CHOISIR UN CLIENT » DANS LE FORMULAIRE D'UN DEVIS. Ce que ces cas gardent : drapeau levé, les contacts lus à l'ouverture,
// le choix qui remplit le client ENTIER et son e-mail, la provenance qui part avec la saisie et la liste lue ; un client déjà
// saisi qui diffère ne se remplace qu'après confirmation ; une liste partielle n'offre aucun choix ; drapeau baissé, ni
// bouton ni lecture.

const etat = vi.hoisted(() => ({ drapeau: true, lecture: null as unknown as LectureDesContacts, lus: 0 }))

vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../lib/devis', async (original) => {
  const vrai = await original<typeof import('../../lib/devis')>()
  return { ...vrai, get DEVIS_CITENT_UN_CONTACT() { return etat.drapeau } }
})
vi.mock('../../lib/contactsLecture', () => ({ lireLesContacts: () => { etat.lus += 1; return Promise.resolve(etat.lecture) } }))

const KA = contact({ id: 'ka', nom: 'Société Choisie', adresse: '3 rue du Choix', siren: '123456782', siret: '12345678200010', email: 'compta@exemple.invalid' })
const EMISSION: EmissionAJuger = {
  dossier: { nom: 'D', siret: '12345678200010', adresse: '1 rue', forme_juridique: '5710', denomination_imprimee: 'D SAS' },
  cabinet: true,
}

function monter(onEnregistrer = vi.fn()) {
  render(
    <DevisSaisieModal
      espace="cabinet" dossierId="d1" statutTva="redevable" articleExoneration={null} cible={{ nouveau: true }}
      depart={saisieDuDevis(null, { aujourdHui: '2026-11-06', statutTva: 'redevable', articleExoneration: null })}
      lignesDeDepart={[{ ...ligneDevisVide('redevable', 'l0'), designation: 'Prestation', quantite: '1', prix: '100' }]}
      aujourdHui="2026-11-06" emission={EMISSION} occupe={false} erreur={null} onClose={vi.fn()} onEnregistrer={onEnregistrer}
    />,
  )
  return onEnregistrer
}

beforeEach(() => {
  etat.drapeau = true
  etat.lecture = { lignes: [KA], complete: true, motif: null }
  etat.lus = 0
})

describe('drapeau levé', () => {
  it('le choix remplit le client entier et son e-mail ; la provenance part avec la saisie et la liste lue', async () => {
    const onEnregistrer = monter()
    const bouton = screen.getByRole('button', { name: 'Choisir un client' })
    await waitFor(() => expect((bouton as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(bouton)
    fireEvent.click(within(screen.getByRole('list')).getByRole('button', { name: /Société Choisie/ }))
    expect((screen.getByLabelText('Client (nom ou raison sociale)') as HTMLInputElement).value).toBe('Société Choisie')
    expect((screen.getByLabelText('Adresse du client') as HTMLInputElement).value).toBe('3 rue du Choix')
    expect((screen.getByLabelText('E-mail du client') as HTMLInputElement).value).toBe('compta@exemple.invalid')
    expect(screen.getByText('Client tiré du fichier : Société Choisie')).toBeTruthy()
    const enregistrer = screen.getByRole('button', { name: 'Enregistrer le brouillon' }) as HTMLButtonElement
    expect(enregistrer.disabled, document.querySelector('.error-text')?.textContent ?? '').toBe(false)
    fireEvent.click(enregistrer)
    expect(onEnregistrer).toHaveBeenCalledTimes(1)
    const [saisie, emettre, contacts] = onEnregistrer.mock.calls[0]
    expect(saisie.contactId).toBe('ka')
    expect(emettre).toBe(false)
    expect(contacts).toEqual([KA])
  })

  it('la fenêtre ne dit aucune échéance (notion de facture), mais garde le délai', async () => {
    etat.lecture = { lignes: [contact({ id: 'kb', nom: 'Société Délai', delai_paiement_jours: 30 })], complete: true, motif: null }
    monter()
    const bouton = screen.getByRole('button', { name: 'Choisir un client' })
    await waitFor(() => expect((bouton as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(bouton)
    const ligne = within(screen.getByRole('list')).getByRole('button', { name: /Société Délai/ }).textContent ?? ''
    expect(ligne).toContain('délai 30 jours')
    expect(ligne).not.toContain('échéance')
  })

  it('un client déjà saisi qui diffère ne se remplace qu’après confirmation', async () => {
    monter()
    fireEvent.change(screen.getByLabelText('Client (nom ou raison sociale)'), { target: { value: 'Autre client' } })
    const bouton = screen.getByRole('button', { name: 'Choisir un client' })
    await waitFor(() => expect((bouton as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(bouton)
    fireEvent.click(within(screen.getByRole('list')).getByRole('button', { name: /Société Choisie/ }))
    expect((screen.getByLabelText('Client (nom ou raison sociale)') as HTMLInputElement).value).toBe('Autre client')
    fireEvent.click(screen.getByRole('button', { name: 'Remplacer' }))
    expect((screen.getByLabelText('Client (nom ou raison sociale)') as HTMLInputElement).value).toBe('Société Choisie')
  })

  it('une liste lue en partie n’offre aucun choix, et le dit', async () => {
    etat.lecture = { lignes: [KA], complete: false, motif: '1 ligne lue sur 2' }
    monter()
    await screen.findByText(/n’ont été lus qu’en partie/)
    expect((screen.getByRole('button', { name: 'Choisir un client' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('drapeau baissé', () => {
  it('ni bouton ni lecture : le formulaire d’hier', () => {
    etat.drapeau = false
    const onEnregistrer = monter()
    expect(screen.queryByRole('button', { name: 'Choisir un client' })).toBeNull()
    expect(screen.queryByText(/Client tiré du fichier/)).toBeNull()
    expect(etat.lus).toBe(0)
    fireEvent.change(screen.getByLabelText('Client (nom ou raison sociale)'), { target: { value: 'Client saisi' } })
    const enregistrer = screen.getByRole('button', { name: 'Enregistrer le brouillon' }) as HTMLButtonElement
    expect(enregistrer.disabled, document.querySelector('.error-text')?.textContent ?? '').toBe(false)
    fireEvent.click(enregistrer)
    expect(onEnregistrer.mock.calls[0][0].contactId).toBeUndefined()
  })
})
