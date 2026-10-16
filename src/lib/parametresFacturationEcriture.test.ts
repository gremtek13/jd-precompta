import { beforeEach, describe, expect, it, vi } from 'vitest'
import { confirmerRib, enregistrerParametresFacturation } from './parametresFacturationEcriture'
import type { ParametresEnvoyes } from './parametresFacturation'
import { versionParametres } from '../test/parametresFacturation'

// LES DEUX GESTES DES PARAMÈTRES DE FACTURATION (espace client, étape A5b1) : par `enregistrer_parametres_facturation` et
// `confirmer_rib` SEULES, avec les paramètres de la base, champ pour champ ; un refus se lève sous les mots de la base ; ce
// qu'elles rendent est la version écrite, vérifiée. IBAN FICTIF (le code banque 99999, à clé juste).

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

const IBAN = 'FR9399999000010000000000100'
const envoyes = (o: Partial<ParametresEnvoyes> = {}): ParametresEnvoyes => ({
  delai_paiement_jours: 30, moyen_prefere: 'virement', escompte: null, penalites: null, mentions_complementaires: null,
  pied_de_page: null, iban: IBAN, bic: null, titulaire_compte: null, ...o,
})

beforeEach(() => {
  faux.appels = []
  faux.reponse = null
})

describe('enregistrerParametresFacturation', () => {
  it('appelle la fonction de la base, ses trois paramètres, et rend la version écrite', async () => {
    faux.reponse = { data: versionParametres({ id: 'neuve', iban: IBAN, rib_etat: 'confirme' }), error: null }
    const ecrite = await enregistrerParametresFacturation('d1', null, envoyes())
    expect(faux.appels).toEqual([{
      nom: 'enregistrer_parametres_facturation', params: { p_dossier_id: 'd1', p_remplace_id: null, p_parametres: envoyes() },
    }])
    expect(ecrite.id).toBe('neuve')
  })

  it('une version qui en remplace une : son identifiant part, et la version rendue doit la remplacer', async () => {
    faux.reponse = { data: versionParametres({ id: 'v2', remplace_id: 'v1' }), error: null }
    await enregistrerParametresFacturation('d1', 'v1', envoyes())
    expect(faux.appels[0].params.p_remplace_id).toBe('v1')
  })

  it('un refus de la base se lève sous ses mots', async () => {
    faux.reponse = { data: null, error: { message: 'Le délai de paiement est un nombre entier de jours, de 0 à 60.' } }
    await expect(enregistrerParametresFacturation('d1', null, envoyes())).rejects.toThrow('Le délai de paiement est un nombre entier de jours, de 0 à 60.')
  })

  it.each([
    ['rien', null],
    ['une version d’un autre dossier', versionParametres({ dossier_id: 'd2' })],
    ['une version qui en remplace une autre que celle annoncée', versionParametres({ remplace_id: 'v9' })],
    ['une valeur qui n’est pas une version', 'ok'],
  ])('ce que la base rend n’est pas la version visée (%s) : on le dit, on ne la suppose pas écrite', async (_nom, data) => {
    faux.reponse = { data, error: null }
    await expect(enregistrerParametresFacturation('d1', null, envoyes())).rejects.toThrow('La base n’a pas rendu les paramètres écrits')
  })
})

describe('confirmerRib', () => {
  it('appelle la fonction de la base, ses deux paramètres, et rend la version confirmée', async () => {
    faux.reponse = { data: versionParametres({ id: 'v1', iban: IBAN, rib_etat: 'confirme' }), error: null }
    const confirmee = await confirmerRib('d1', 'v1')
    expect(faux.appels).toEqual([{ nom: 'confirmer_rib', params: { p_dossier_id: 'd1', p_version_id: 'v1' } }])
    expect(confirmee.rib_etat).toBe('confirme')
  })

  it('un refus de la base se lève sous ses mots', async () => {
    faux.reponse = { data: null, error: { message: 'Le RIB de cette version est déjà confirmé.' } }
    await expect(confirmerRib('d1', 'v1')).rejects.toThrow('Le RIB de cette version est déjà confirmé.')
  })

  it.each([
    ['rien', null],
    ['une autre version', versionParametres({ id: 'v2', iban: IBAN, rib_etat: 'confirme' })],
    ['la version, encore proposée', versionParametres({ id: 'v1', iban: IBAN, rib_etat: 'propose' })],
    ['une version d’un autre dossier', versionParametres({ id: 'v1', dossier_id: 'd2', iban: IBAN, rib_etat: 'confirme' })],
  ])('ce que la base rend n’est pas la version confirmée (%s) : on le dit', async (_nom, data) => {
    faux.reponse = { data, error: null }
    await expect(confirmerRib('d1', 'v1')).rejects.toThrow('La base n’a pas rendu les paramètres écrits')
  })
})
