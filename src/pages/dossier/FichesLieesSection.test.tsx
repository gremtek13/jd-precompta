import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FichesLieesSection from './FichesLieesSection'
import { REFUS_ENREGISTREMENT_CONTACT } from '../../lib/contacts'
import type { LectureDesFichesLiees } from '../../lib/fichesLieesLecture'
import { PHRASE_DE_L_IDENTITE_ILLISIBLE, PHRASE_DU_DOSSIER_PARTI } from '../../lib/fichesLieesVue'
import { contact } from '../../test/contacts'
import type { Contact } from '../../lib/types'

// LES FICHES RELIÉES AUX DOSSIERS DES CLIENTS (LM3), la section de la vue « Clients » du dossier du cabinet, montée seule : la
// lecture est simulée (lib/fichesLieesLecture.ts), les gestes remontent à la vue (qui les écrit sous son verrou :
// ContactsVueFichesLiees.test.tsx). Ce que ces cas gardent :
//  1. « Chargement… » avant la lecture ; hors du dossier du cabinet, rien ; illisible, ou les contacts lus en partie : AUCUN geste ;
//  2. la ligne d'une fiche : l'identité LUE de son dossier (jamais la fiche), le dossier parti dit, l'identité illisible dite ;
//  3. « Relier un dossier client » : les seuls dossiers sans fiche, l'identité que le dossier donne, le refus du module avant le
//     clic, la confirmation qui NOMME le dossier et ce que la fiche garde, puis la saisie telle qu'elle part ;
//  4. « Modifier » : le lien ne se choisit plus, l'adresse électronique à une entreprise seule ; « Retirer ». Données FICTIVES.
const lecture = vi.hoisted(() => ({ rendu: null as LectureDesFichesLiees | null, appels: 0, enAttente: false }))
vi.mock('../../lib/fichesLieesLecture', () => ({
  lireCeQueLesFichesLieesDemandent: () => {
    lecture.appels += 1
    return lecture.enAttente ? new Promise(() => {}) : Promise.resolve(lecture.rendu)
  },
}))

const K = '1b300000-0000-4000-8000-0000000000a1'
const C = '1b300000-0000-4000-8000-0000000000c1'
const C2 = '1b300000-0000-4000-8000-0000000000c2'
const C3 = '1b300000-0000-4000-8000-0000000000c3'
const liee = (o: Partial<Contact> = {}) => contact({
  id: 'f1', dossier_id: K, nom: null as unknown as string, type_client: null, adresse: null, siren: null, siret: null,
  dossier_client_id: C, delai_paiement_jours: 30, ...o,
})
const LUE: LectureDesFichesLiees = {
  etat: 'lue', dossierDuCabinetId: K,
  dossiers: [
    { id: K, nom: 'Cabinet', denomination_imprimee: null, adresse: null, siret: null },
    { id: C, nom: 'Dossier Un', denomination_imprimee: 'UN SARL', adresse: '1 rue A', siret: '12345678200010' },
    { id: C2, nom: 'Dossier Deux', denomination_imprimee: null, adresse: '2 rue B', siret: '12345678200010' },
    { id: C3, nom: 'Dossier Trois', denomination_imprimee: null, adresse: null, siret: null },
  ],
  identites: [{
    contact_id: 'f1', dossier_client_id: C, dossier_present: true, tiers_nom: 'UN SARL', tiers_adresse: '1 rue A',
    tiers_siret: '12345678200010', tiers_siren: '123456782', type_client: 'assujetti',
  }],
}

const gestes = { enregistrer: [] as unknown[][], basculer: [] as unknown[][], fenetre: [] as boolean[], reussit: true }
beforeEach(() => {
  lecture.rendu = LUE; lecture.appels = 0; lecture.enAttente = false
  gestes.enregistrer = []; gestes.basculer = []; gestes.fenetre = []; gestes.reussit = true
})
afterEach(() => { vi.restoreAllMocks() })

async function monter(contacts: readonly Contact[], o: { complete?: boolean; erreur?: string | null } = {}) {
  render(
    <FichesLieesSection
      dossierId={K} contacts={contacts} complete={o.complete ?? true} occupe={false} erreur={o.erreur ?? null}
      onEnregistrer={async (...a) => { gestes.enregistrer.push(a); return gestes.reussit }}
      onBasculer={async (...a) => { gestes.basculer.push(a); return true }}
      onFenetre={(o2) => { gestes.fenetre.push(o2) }}
    />,
  )
  await act(async () => {})
}
const bouton = (nom: string | RegExp) => screen.getByRole('button', { name: nom }) as HTMLButtonElement

describe('les fiches reliées, dans la vue « Clients » du dossier du cabinet (LM3)', () => {
  it('rien n’est affirmé avant la lecture, rien n’est montré hors du dossier du cabinet', async () => {
    lecture.enAttente = true
    await monter([liee()])
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText(/Aucun dossier client/)).toBeNull()
  })

  it('hors du dossier du cabinet, la section se tait', async () => {
    lecture.rendu = { etat: 'horsDuDossierDuCabinet' }
    await monter([])
    expect(document.body.textContent).toBe('')
  })

  it('une lecture illisible se dit, et aucun geste n’est offert', async () => {
    lecture.rendu = { etat: 'illisible', motif: 'réseau coupé' }
    await monter([liee()])
    expect(screen.getByRole('alert').textContent).toContain('réseau coupé')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('la ligne dit l’identité LUE, le dossier parti, l’identité illisible ; les contacts lus en partie n’offrent aucun geste', async () => {
    lecture.rendu = {
      ...LUE, identites: [...LUE.identites, {
        contact_id: 'f2', dossier_client_id: C2, dossier_present: false, tiers_nom: null, tiers_adresse: null, tiers_siret: null,
        tiers_siren: null, type_client: null,
      }],
    }
    await monter([liee(), liee({ id: 'f2', dossier_client_id: C2 }), liee({ id: 'f3', dossier_client_id: C3 })], { complete: false })
    const liste = screen.getByRole('list', { name: 'Fiches reliées' })
    expect(liste.textContent).toContain('UN SARL')
    expect(liste.textContent).toContain('Entreprise établie en France · SIRET 12345678200010 · délai 30 jours')
    expect(liste.textContent).toContain(PHRASE_DU_DOSSIER_PARTI)
    expect(liste.textContent).toContain(PHRASE_DE_L_IDENTITE_ILLISIBLE)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('« Relier un dossier client » : refus avant le clic, confirmation qui nomme, saisie telle qu’elle part', async () => {
    await monter([liee()])
    fireEvent.click(bouton('Relier un dossier client'))
    expect(gestes.fenetre).toEqual([true])
    const fenetre = screen.getByRole('dialog', { name: 'Relier un dossier client' })
    // Les seuls dossiers sans fiche, hors du dossier du cabinet.
    const options = [...fenetre.querySelectorAll('option')].map((o) => o.textContent)
    expect(options).toEqual(['Choisir…', 'Dossier Deux', 'Dossier Trois'])
    expect((within(fenetre).getByRole('button', { name: 'Relier…' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(fenetre.querySelector('#fiche-liee-dossier')!, { target: { value: C2 } })
    expect(within(fenetre).getByRole('note').textContent).toContain('Lu de son dossier : Dossier Deux — entreprise établie en France (SIREN 123456782)')
    fireEvent.change(fenetre.querySelector('#fiche-liee-delai')!, { target: { value: 'trente' } })
    expect(within(fenetre).getByRole('alert').textContent).toBe(REFUS_ENREGISTREMENT_CONTACT.find((r) => r.cle === 'delai_invalide')?.modele)
    expect((within(fenetre).getByRole('button', { name: 'Relier…' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(fenetre.querySelector('#fiche-liee-delai')!, { target: { value: '45' } })
    fireEvent.change(fenetre.querySelector('#fiche-liee-email')!, { target: { value: 'compta@essai.invalid' } })
    fireEvent.change(fenetre.querySelector('#fiche-liee-adresse')!, { target: { value: '123456782' } })
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Relier…' }))
    expect(gestes.enregistrer).toEqual([])
    const confirmation = within(fenetre).getAllByRole('note')[1]
    expect(confirmation.textContent).toContain('Relier le dossier « Dossier Deux » ?')
    expect(confirmation.textContent).toContain('l’adresse de facturation électronique 123456782')
    expect(confirmation.textContent).toContain('le délai de paiement de 45 jours')
    expect(confirmation.textContent).toContain('ne change plus')
    await act(async () => { fireEvent.click(within(fenetre).getByRole('button', { name: 'Relier ce dossier' })) })
    expect(gestes.enregistrer).toEqual([[null, {
      dossier_client_id: C2, adresse_electronique: '123456782', email: 'compta@essai.invalid', delai_paiement_jours: 45, observations: null,
    }, 'Dossier Deux']])
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(gestes.fenetre).toEqual([true, false])
  })

  it('un refus de la base se dit dans la fenêtre, qui reste ouverte', async () => {
    gestes.reussit = false
    await monter([], { erreur: 'Ce dossier a déjà sa fiche de facturation.' })
    fireEvent.click(bouton('Relier un dossier client'))
    const fenetre = screen.getByRole('dialog')
    fireEvent.change(fenetre.querySelector('#fiche-liee-dossier')!, { target: { value: C3 } })
    // Un dossier sans SIRET : un particulier ou un autre non-assujetti, sans adresse électronique à saisir.
    expect(fenetre.querySelector('#fiche-liee-adresse')).toBeNull()
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Relier…' }))
    await act(async () => { fireEvent.click(within(fenetre).getByRole('button', { name: 'Relier ce dossier' })) })
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toBe('Ce dossier a déjà sa fiche de facturation.')
  })

  it('« Modifier » garde le lien, et « Retirer » remonte à la vue', async () => {
    await monter([liee({ email: 'a@b.fr' })])
    fireEvent.click(bouton('Modifier'))
    const fenetre = screen.getByRole('dialog', { name: 'Modifier la fiche de « UN SARL »' })
    expect(fenetre.querySelector('#fiche-liee-dossier')).toBeNull()
    fireEvent.change(fenetre.querySelector('#fiche-liee-adresse')!, { target: { value: '987654324' } })
    expect(within(fenetre).getByRole('alert').textContent).toBe(REFUS_ENREGISTREMENT_CONTACT.find((r) => r.cle === 'adresse_electronique_siren')?.modele)
    fireEvent.change(fenetre.querySelector('#fiche-liee-adresse')!, { target: { value: '' } })
    await act(async () => { fireEvent.click(within(fenetre).getByRole('button', { name: 'Enregistrer' })) })
    expect(gestes.enregistrer).toEqual([[expect.objectContaining({ id: 'f1' }), {
      dossier_client_id: C, adresse_electronique: null, email: 'a@b.fr', delai_paiement_jours: 30, observations: null,
    }, 'UN SARL']])
    await act(async () => { fireEvent.click(bouton('Retirer')) })
    expect(gestes.basculer).toEqual([[expect.objectContaining({ id: 'f1' }), 'UN SARL']])
  })

  it('une fiche retirée ne se modifie pas : elle se reprend', async () => {
    await monter([liee({ retire_le: '2027-10-05T08:00:00Z' })])
    expect(bouton('Modifier').disabled).toBe(true)
    expect(screen.getByText(/Retirée le/)).toBeTruthy()
    await act(async () => { fireEvent.click(bouton('Reprendre')) })
    expect(gestes.basculer).toHaveLength(1)
  })
})
