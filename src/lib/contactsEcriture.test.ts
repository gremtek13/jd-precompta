import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effacerContact, enregistrerContact, reprendreContact, retirerContact } from './contactsEcriture'
import type { ContactEnvoye } from './contacts'
import { contact } from '../test/contacts'
import type { Contact } from './types'

// LES QUATRE GESTES D'UN CONTACT (espace client, étape A4b1). Ce que ces cas gardent : chaque geste n'appelle que SA fonction
// de la base, avec ses arguments ; le refus de la base se lève sous ses mots ; une réponse qui n'est pas le contact visé (ou
// pas dans l'état attendu : retiré, effacé) est une panne dite, jamais un succès supposé.

const faux = vi.hoisted(() => ({
  appels: [] as { nom: string; params: Record<string, unknown> }[],
  reponse: { data: null, error: null } as { data: unknown; error: { message: string } | null },
}))

vi.mock('./supabase', () => ({
  supabase: {
    rpc: (nom: string, params: Record<string, unknown>) => {
      faux.appels.push({ nom, params })
      return Promise.resolve(faux.reponse)
    },
  },
}))

const SAISIE: ContactEnvoye = {
  nom: 'Société Essai', type_client: 'assujetti', adresse: 'Adresse fictive', siren: '123456782', siret: null,
  adresse_electronique: null, code_service: null, email: null, delai_paiement_jours: 30, observations: null,
}
const RETIRE = '2027-10-05T08:00:00Z'
const EFFACE = '2027-10-06T08:00:00Z'
const PANNE = 'La base n’a pas rendu le contact écrit'

beforeEach(() => {
  faux.appels = []
  faux.reponse = { data: null, error: null }
})

describe('enregistrerContact', () => {
  it('crée : sa fonction, le dossier, aucun identifiant, la saisie entière', async () => {
    faux.reponse = { data: contact({ id: 'nouveau' }), error: null }
    const ecrit: Contact = await enregistrerContact('d1', null, SAISIE)
    expect(ecrit.id).toBe('nouveau')
    expect(faux.appels).toEqual([{ nom: 'enregistrer_contact', params: { p_dossier_id: 'd1', p_contact_id: null, p_contact: SAISIE } }])
  })

  it('modifie : l’identifiant du contact visé, et la base doit rendre CE contact', async () => {
    faux.reponse = { data: contact({ id: 'c1' }), error: null }
    await enregistrerContact('d1', 'c1', SAISIE)
    expect(faux.appels[0].params.p_contact_id).toBe('c1')
    faux.reponse = { data: contact({ id: 'c2' }), error: null }
    await expect(enregistrerContact('d1', 'c1', SAISIE)).rejects.toThrow(PANNE)
  })

  it('le refus de la base se lève sous ses mots', async () => {
    faux.reponse = { data: null, error: { message: 'Ce contact est retiré : le reprendre avant de le modifier.' } }
    await expect(enregistrerContact('d1', 'c1', SAISIE)).rejects.toThrow('Ce contact est retiré : le reprendre avant de le modifier.')
  })

  it.each([[null], [undefined], ['texte'], [{}], [{ id: 12 }]])('une réponse qui n’est pas une ligne de contact (%j) est une panne dite', async (data) => {
    faux.reponse = { data, error: null }
    await expect(enregistrerContact('d1', null, SAISIE)).rejects.toThrow(PANNE)
  })

  it('une écriture qui rend un contact RETIRÉ ou EFFACÉ n’est pas celle qu’on a demandée', async () => {
    faux.reponse = { data: contact({ id: 'c1', retire_le: RETIRE }), error: null }
    await expect(enregistrerContact('d1', 'c1', SAISIE)).rejects.toThrow(PANNE)
    faux.reponse = { data: contact({ id: 'c1', efface_le: EFFACE }), error: null }
    await expect(enregistrerContact('d1', 'c1', SAISIE)).rejects.toThrow(PANNE)
  })
})

describe('retirerContact', () => {
  it('sa fonction, le dossier, le contact ; la base rend le contact retiré', async () => {
    faux.reponse = { data: contact({ id: 'c1', retire_le: RETIRE, retire_par: 'u' }), error: null }
    const ecrit = await retirerContact('d1', 'c1')
    expect(ecrit.retire_le).toBe(RETIRE)
    expect(faux.appels).toEqual([{ nom: 'retirer_contact', params: { p_dossier_id: 'd1', p_contact_id: 'c1' } }])
  })

  it('un contact rendu NON retiré, effacé, ou un autre contact, est une panne dite', async () => {
    faux.reponse = { data: contact({ id: 'c1' }), error: null }
    await expect(retirerContact('d1', 'c1')).rejects.toThrow(PANNE)
    faux.reponse = { data: contact({ id: 'c1', retire_le: RETIRE, efface_le: EFFACE }), error: null }
    await expect(retirerContact('d1', 'c1')).rejects.toThrow(PANNE)
    faux.reponse = { data: contact({ id: 'c9', retire_le: RETIRE }), error: null }
    await expect(retirerContact('d1', 'c1')).rejects.toThrow(PANNE)
  })

  it('le refus de la base se lève sous ses mots', async () => {
    faux.reponse = { data: null, error: { message: 'Ce contact est déjà retiré.' } }
    await expect(retirerContact('d1', 'c1')).rejects.toThrow('Ce contact est déjà retiré.')
  })
})

describe('reprendreContact', () => {
  it('sa fonction, le dossier, le contact ; la base rend le contact repris', async () => {
    faux.reponse = { data: contact({ id: 'c1', modifie_par: 'u', modifie_le: RETIRE }), error: null }
    const ecrit = await reprendreContact('d1', 'c1')
    expect(ecrit.retire_le).toBeNull()
    expect(faux.appels).toEqual([{ nom: 'reprendre_contact', params: { p_dossier_id: 'd1', p_contact_id: 'c1' } }])
  })

  it('un contact rendu encore retiré ou effacé est une panne dite', async () => {
    faux.reponse = { data: contact({ id: 'c1', retire_le: RETIRE }), error: null }
    await expect(reprendreContact('d1', 'c1')).rejects.toThrow(PANNE)
    faux.reponse = { data: contact({ id: 'c1', efface_le: EFFACE }), error: null }
    await expect(reprendreContact('d1', 'c1')).rejects.toThrow(PANNE)
  })

  it('le refus de la base se lève sous ses mots', async () => {
    faux.reponse = { data: null, error: { message: "Ce contact n'est pas retiré." } }
    await expect(reprendreContact('d1', 'c1')).rejects.toThrow("Ce contact n'est pas retiré.")
  })
})

describe('effacerContact', () => {
  it('sa fonction, le dossier, le contact ; la base rend le contact effacé', async () => {
    faux.reponse = { data: contact({ id: 'c1', efface_le: EFFACE, efface_par: 'u', nom: 'Contact effacé le 06/10/2027' }), error: null }
    const ecrit = await effacerContact('d1', 'c1')
    expect(ecrit.efface_le).toBe(EFFACE)
    expect(faux.appels).toEqual([{ nom: 'effacer_contact', params: { p_dossier_id: 'd1', p_contact_id: 'c1' } }])
  })

  it('un contact rendu NON effacé, ou encore retiré, ou un autre contact, est une panne dite : l’effacement ne se suppose jamais', async () => {
    faux.reponse = { data: contact({ id: 'c1' }), error: null }
    await expect(effacerContact('d1', 'c1')).rejects.toThrow(PANNE)
    faux.reponse = { data: contact({ id: 'c1', retire_le: RETIRE, efface_le: EFFACE }), error: null }
    await expect(effacerContact('d1', 'c1')).rejects.toThrow(PANNE)
    faux.reponse = { data: contact({ id: 'c9', efface_le: EFFACE }), error: null }
    await expect(effacerContact('d1', 'c1')).rejects.toThrow(PANNE)
  })

  it('le refus de la base se lève sous ses mots', async () => {
    faux.reponse = { data: null, error: { message: 'Ce contact est déjà effacé.' } }
    await expect(effacerContact('d1', 'c1')).rejects.toThrow('Ce contact est déjà effacé.')
  })
})
