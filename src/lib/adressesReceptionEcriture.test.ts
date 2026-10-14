import { beforeEach, describe, expect, it, vi } from 'vitest'
import { declarerAdresseReception } from './adressesReceptionEcriture'
import type { SaisieAdresseReception } from './adressesReception'
import { adresse, SIREN_FICTIF } from '../test/adressesReception'

// LA DÉCLARATION D'UNE ADRESSE (espace client, étape A6b1) : par `declarer_adresse_reception` SEULE, avec les huit paramètres
// de la base, champ pour champ ; son refus se lève sous les mots de la base ; ce qu'elle rend est la ligne écrite, vérifiée.

const faux = vi.hoisted(() => ({
  appels: [] as { nom: string; params: Record<string, unknown> }[],
  reponse: null as { data: unknown; error: { message: string } | null } | null,
}))

vi.mock('./supabase', () => ({
  supabase: {
    rpc: async (nom: string, params: Record<string, unknown>) => {
      faux.appels.push({ nom, params })
      return faux.reponse ?? { data: null, error: null }
    },
  },
}))

const saisie = (o: Partial<SaisieAdresseReception> = {}): SaisieAdresseReception => ({
  forme: 'siren', identifiant: SIREN_FICTIF, plateforme: 'Plateforme fictive', prise_effet: '2026-09-01',
  verification: 'portail_annuaire', verifiee_le: '2026-10-01', remplace_id: null, ...o,
})

beforeEach(() => {
  faux.appels = []
  faux.reponse = null
})

describe('declarerAdresseReception', () => {
  it('appelle la fonction de la base, ses huit paramètres, et rend la ligne écrite', async () => {
    faux.reponse = { data: adresse({ id: 'neuve', verification: 'portail_annuaire', verifiee_le: '2026-10-01' }), error: null }
    const ecrite = await declarerAdresseReception('d1', saisie())
    expect(faux.appels).toEqual([{
      nom: 'declarer_adresse_reception',
      params: {
        p_dossier_id: 'd1', p_forme: 'siren', p_identifiant: SIREN_FICTIF, p_plateforme: 'Plateforme fictive',
        p_prise_effet: '2026-09-01', p_verification: 'portail_annuaire', p_verifiee_le: '2026-10-01', p_remplace_id: null,
      },
    }])
    expect(ecrite.id).toBe('neuve')
  })

  it('une version qui en remplace une : son identifiant part, et la ligne rendue doit la remplacer', async () => {
    faux.reponse = { data: adresse({ id: 'neuve', remplace_id: 'a1' }), error: null }
    await declarerAdresseReception('d1', saisie({ remplace_id: 'a1' }))
    expect(faux.appels[0].params.p_remplace_id).toBe('a1')
  })

  it('un refus de la base se lève sous ses mots', async () => {
    faux.reponse = { data: null, error: { message: 'Accès refusé à ce dossier.' } }
    await expect(declarerAdresseReception('d1', saisie())).rejects.toThrow('Accès refusé à ce dossier.')
  })

  it.each([
    ['rien', null],
    ['une ligne d’un autre dossier', adresse({ dossier_id: 'd2' })],
    ['une ligne qui en remplace une autre que celle annoncée', adresse({ remplace_id: 'a9' })],
    ['une valeur qui n’est pas une ligne', 'ok'],
  ])('ce que la base rend n’est pas l’adresse visée (%s) : on le dit, on ne le suppose pas écrit', async (_nom, data) => {
    faux.reponse = { data, error: null }
    await expect(declarerAdresseReception('d1', saisie())).rejects.toThrow('La base n’a pas rendu l’adresse déclarée')
  })
})
