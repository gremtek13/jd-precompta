import { describe, expect, it, vi } from 'vitest'

// LE DERNIER CHANGEMENT DU RIB, LU POUR L'ÉCRAN (espace client, étape A5b3a) : la lecture sous un faux client. Ce que ces
// cas gardent : QUATRE états, et jamais un cinquième — une valeur de la forme attendue est `lue` (« aucun changement »
// compris, que la base AFFIRME) ; une valeur d'une autre forme est `illisible` ; un refus de la base, ou une requête qui
// lève, est `refusee` avec son motif — jamais « aucun changement ». Le crochet (le drapeau, la garde avec le dossier,
// l'annulation) est joué dans changementDeRibLecture.crochet.test.tsx.

vi.mock('./supabase', () => ({ supabase: {} }))

import { changementDeLaReponse, lireLaReponseDuChangement, lireLeDernierChangementDeRib } from './changementDeRibLecture'

const AUCUN = { changement: null }
const PROPOSE = { changement: { jour: '2026-10-16', geste: 'change', auteur: 'client', etat: 'propose', rib_en_vigueur: 'inchange' } }
const PROPOSE_LU = { changement: { jour: '2026-10-16', geste: 'change', auteur: 'client', etat: 'propose', ribEnVigueur: 'inchange' } }

describe('la valeur que rend la base', () => {
  it('de la forme attendue : lue — « aucun changement » compris, puisque la base l’affirme', () => {
    expect(changementDeLaReponse({ data: AUCUN, error: null })).toEqual({ etat: 'lue', lu: { changement: null } })
    expect(changementDeLaReponse({ data: PROPOSE, error: null })).toEqual({ etat: 'lue', lu: PROPOSE_LU })
  })

  it.each([
    ['un nul nu', null],
    ['rien', undefined],
    ['une liste', []],
    ['un objet vide', {}],
    ['l’IBAN de plus', { changement: { ...PROPOSE.changement, iban: 'FR5199999002480000RIBUN0100' } }],
    ['une proposition signée du cabinet', { changement: { ...PROPOSE.changement, auteur: 'cabinet' } }],
  ])('%s : illisible — jamais « aucun changement »', (_nom, rendu) => {
    expect(changementDeLaReponse({ data: rendu, error: null })).toEqual({ etat: 'illisible' })
  })

  it('une erreur : refusée, avec son motif — même quand une valeur lisible l’accompagne', () => {
    expect(changementDeLaReponse({ data: null, error: { message: 'Accès refusé à ce dossier.', code: '42501' } }))
      .toEqual({ etat: 'refusee', motif: 'Accès refusé à ce dossier.' })
    expect(changementDeLaReponse({ data: AUCUN, error: { message: 'panne fictive' } })).toEqual({ etat: 'refusee', motif: 'panne fictive' })
  })

  it('une erreur sans message : un repli qui dit le refus, jamais un texte vide', () => {
    expect(changementDeLaReponse({ data: null, error: {} })).toEqual({ etat: 'refusee', motif: 'la base a refusé la lecture' })
  })
})

describe('la requête, attendue', () => {
  it('une réponse lisible, illisible ou refusée', async () => {
    expect(await lireLaReponseDuChangement(Promise.resolve({ data: PROPOSE, error: null }))).toEqual({ etat: 'lue', lu: PROPOSE_LU })
    expect(await lireLaReponseDuChangement(Promise.resolve({ data: { changement: 1 }, error: null }))).toEqual({ etat: 'illisible' })
    expect(await lireLaReponseDuChangement(Promise.resolve({ data: null, error: { message: 'refus fictif' } })))
      .toEqual({ etat: 'refusee', motif: 'refus fictif' })
  })

  it('une requête qui lève tombe du côté signalé : refusée, avec son motif — jamais « aucun changement »', async () => {
    expect(await lireLaReponseDuChangement(Promise.reject(new Error('réseau coupé')))).toEqual({ etat: 'refusee', motif: 'réseau coupé' })
    // Un constructeur de requête n'est pas une promesse : son `then` rend ce qu'il veut, `await` attend la réponse qu'il passe.
    const constructeur: PromiseLike<{ data: unknown; error: unknown }> = {
      then: (suite) => Promise.resolve(suite ? suite({ data: AUCUN, error: null }) : undefined) as never,
    }
    expect(await lireLaReponseDuChangement(constructeur)).toEqual({ etat: 'lue', lu: { changement: null } })
    const quiLeve: PromiseLike<{ data: unknown; error: unknown }> = { then: () => { throw new Error('levée fictive') } }
    expect(await lireLaReponseDuChangement(quiLeve)).toEqual({ etat: 'refusee', motif: 'levée fictive' })
  })
})

describe('la lecture du dossier ne rejette jamais', () => {
  it('un client sans la fonction (l’appel lève avant d’avoir rendu une requête) : refusée, jamais une levée vers l’écran', async () => {
    // Le faux client de ce fichier n'a pas de `rpc` : `supabase.rpc(…)` lève un TypeError avant toute requête.
    const lecture = await lireLeDernierChangementDeRib('d1')
    expect(lecture.etat).toBe('refusee')
    expect(lecture.etat === 'refusee' && lecture.motif).toMatch(/rpc/)
  })
})
