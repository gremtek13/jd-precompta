import { describe, expect, it, vi } from 'vitest'
import { ETAT_FICTIF, ETAT_NEUF } from '../test/etatFactureElectronique'

// L'ÉTAT DE LA FACTURE ÉLECTRONIQUE, LU POUR L'ÉCRAN (espace client, étape A6b2) : la lecture sous un faux client. Ce que ces
// cas gardent : QUATRE états, et jamais un cinquième — une valeur de la forme attendue est `lue` ; une valeur d'une autre
// forme est `illisible` (jamais un état) ; un refus de la base, ou une requête qui lève, est `refusee` avec son motif.
// Le crochet (la garde avec le dossier, l'annulation) est joué dans etatFactureElectroniqueLecture.crochet.test.tsx.

vi.mock('./supabase', () => ({ supabase: {} }))

import { etatDeLaReponse, lireLEtatDeLaFactureElectronique, lireLEtatDuDossier } from './etatFactureElectroniqueLecture'

describe('la valeur que rend la base', () => {
  it('de la forme attendue : lue, telle quelle', () => {
    expect(etatDeLaReponse({ data: ETAT_FICTIF, error: null })).toEqual({ etat: 'lue', lu: ETAT_FICTIF })
    expect(etatDeLaReponse({ data: ETAT_NEUF, error: null })).toEqual({ etat: 'lue', lu: ETAT_NEUF })
  })

  it.each([
    ['rien', null],
    ['une liste', []],
    ['un texte', 'actif'],
    ['un objet vide', {}],
    ['une clé de plus', { ...ETAT_FICTIF, portee: 'x' }],
    ['la plateforme sans son nom', { ...ETAT_FICTIF, plateforme: { ...ETAT_FICTIF.plateforme, nom: undefined } }],
    ['une plateforme reliée sans date de création', { ...ETAT_FICTIF, plateforme: { ...ETAT_FICTIF.plateforme, creee_le: null } }],
    ['une adresse d’une maille inconnue', { ...ETAT_FICTIF, adresse: { ...ETAT_FICTIF.adresse, forme: 'siret' } }],
  ])('%s : illisible — jamais un état', (_nom, rendu) => {
    expect(etatDeLaReponse({ data: rendu, error: null })).toEqual({ etat: 'illisible' })
  })

  it('une erreur : refusée, avec son motif — même quand une valeur lisible l’accompagne', () => {
    expect(etatDeLaReponse({ data: null, error: { message: 'permission denied', code: '42501' } }))
      .toEqual({ etat: 'refusee', motif: 'permission denied' })
    expect(etatDeLaReponse({ data: ETAT_FICTIF, error: { message: 'panne fictive' } })).toEqual({ etat: 'refusee', motif: 'panne fictive' })
  })

  it('une erreur sans message : un repli qui dit le refus, jamais un texte vide', () => {
    expect(etatDeLaReponse({ data: null, error: {} })).toEqual({ etat: 'refusee', motif: 'la base a refusé la lecture' })
  })
})

describe('la requête, attendue', () => {
  it('une réponse lisible, illisible ou refusée', async () => {
    expect(await lireLEtatDeLaFactureElectronique(Promise.resolve({ data: ETAT_FICTIF, error: null }))).toEqual({ etat: 'lue', lu: ETAT_FICTIF })
    expect(await lireLEtatDeLaFactureElectronique(Promise.resolve({ data: { plateforme: 1 }, error: null }))).toEqual({ etat: 'illisible' })
    expect(await lireLEtatDeLaFactureElectronique(Promise.resolve({ data: null, error: { message: 'refus fictif' } })))
      .toEqual({ etat: 'refusee', motif: 'refus fictif' })
  })

  it('une requête qui lève tombe du côté signalé : refusée, avec son motif — jamais un état', async () => {
    expect(await lireLEtatDeLaFactureElectronique(Promise.reject(new Error('réseau coupé')))).toEqual({ etat: 'refusee', motif: 'réseau coupé' })
    // Un constructeur de requête n'est pas une promesse : son `then` rend ce qu'il veut, `await` attend la réponse qu'il passe.
    const constructeur: PromiseLike<{ data: unknown; error: unknown }> = {
      then: (suite) => Promise.resolve(suite ? suite({ data: ETAT_NEUF, error: null }) : undefined) as never,
    }
    expect(await lireLEtatDeLaFactureElectronique(constructeur)).toEqual({ etat: 'lue', lu: ETAT_NEUF })
    const quiLeve: PromiseLike<{ data: unknown; error: unknown }> = { then: () => { throw new Error('levée fictive') } }
    expect(await lireLEtatDeLaFactureElectronique(quiLeve)).toEqual({ etat: 'refusee', motif: 'levée fictive' })
  })
})

describe('la lecture du dossier ne rejette jamais', () => {
  it('un client sans la fonction (l’appel lève avant d’avoir rendu une requête) : refusée, jamais une levée vers l’écran', async () => {
    // Le faux client de ce fichier n'a pas de `rpc` : `supabase.rpc(…)` lève un TypeError avant toute requête.
    const lecture = await lireLEtatDuDossier('d1')
    expect(lecture.etat).toBe('refusee')
    expect(lecture.etat === 'refusee' && lecture.motif).toMatch(/rpc/)
  })
})
