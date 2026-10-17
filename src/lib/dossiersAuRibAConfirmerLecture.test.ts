import { describe, expect, it, vi } from 'vitest'

// LES DOSSIERS DONT UN RIB PROPOSÉ ATTEND LE CABINET, LUS POUR L'ÉCRAN (espace client, étape A5b3c) : la lecture sous un
// faux client. Ce que ces cas gardent : QUATRE états, et jamais un cinquième — une valeur de la forme attendue est `lue`
// (« aucun dossier » compris, que la base AFFIRME) ; une valeur d'une autre forme est `illisible` ; un refus de la base, ou
// une requête qui lève, est `refusee` avec son motif — jamais « aucun dossier ». Le crochet (le drapeau, la garde avec la
// clé, l'annulation) est joué dans dossiersAuRibAConfirmerLecture.crochet.test.tsx.

vi.mock('./supabase', () => ({ supabase: {} }))

import { dossiersAuRibDeLaReponse, lireLaReponseDesDossiersAuRib, lireLesDossiersAuRibAConfirmerEnBase } from './dossiersAuRibAConfirmerLecture'

const AUCUN = { dossiers: [] }
const UN = {
  dossiers: [{ dossier_id: 'a5b3c000-0000-4000-8000-0000000000d1', nom: 'Dossier fictif', archive: false,
    changement: { etat: 'propose', jour: '2026-10-16', geste: 'change', auteur: 'client', rib_en_vigueur: 'inchange' } }],
}
const UN_LU = {
  dossiers: [{ dossierId: 'a5b3c000-0000-4000-8000-0000000000d1', nom: 'Dossier fictif', archive: false,
    changement: { jour: '2026-10-16', geste: 'change', auteur: 'client', etat: 'propose', ribEnVigueur: 'inchange' } }],
}

describe('la valeur que rend la base', () => {
  it('de la forme attendue : lue — « aucun dossier » compris, puisque la base l’affirme', () => {
    expect(dossiersAuRibDeLaReponse({ data: AUCUN, error: null })).toEqual({ etat: 'lue', lu: { dossiers: [] } })
    expect(dossiersAuRibDeLaReponse({ data: UN, error: null })).toEqual({ etat: 'lue', lu: UN_LU })
  })

  it.each([
    ['un nul nu', null],
    ['rien', undefined],
    ['une liste nue', []],
    ['un objet vide', {}],
    ['la liste nulle', { dossiers: null }],
    ['l’IBAN de plus', { dossiers: [{ ...UN.dossiers[0], iban: 'FR7199999002480000RIBDEUX00' }] }],
    ['un RIB confirmé dans la liste', { dossiers: [{ ...UN.dossiers[0], changement: { ...UN.dossiers[0].changement, etat: 'confirme' } }] }],
  ])('%s : illisible — jamais « aucun dossier »', (_nom, rendu) => {
    expect(dossiersAuRibDeLaReponse({ data: rendu, error: null })).toEqual({ etat: 'illisible' })
  })

  it('une erreur : refusée, avec son motif — même quand une valeur lisible l’accompagne', () => {
    expect(dossiersAuRibDeLaReponse({ data: null, error: { message: 'Seul le cabinet lit les RIB à confirmer.', code: '42501' } }))
      .toEqual({ etat: 'refusee', motif: 'Seul le cabinet lit les RIB à confirmer.' })
    expect(dossiersAuRibDeLaReponse({ data: AUCUN, error: { message: 'panne fictive' } })).toEqual({ etat: 'refusee', motif: 'panne fictive' })
  })

  it('une erreur sans message : un repli qui dit le refus, jamais un texte vide', () => {
    expect(dossiersAuRibDeLaReponse({ data: null, error: {} })).toEqual({ etat: 'refusee', motif: 'la base a refusé la lecture' })
  })
})

describe('la requête, attendue', () => {
  it('une réponse lisible, illisible ou refusée', async () => {
    expect(await lireLaReponseDesDossiersAuRib(Promise.resolve({ data: UN, error: null }))).toEqual({ etat: 'lue', lu: UN_LU })
    expect(await lireLaReponseDesDossiersAuRib(Promise.resolve({ data: { dossiers: 1 }, error: null }))).toEqual({ etat: 'illisible' })
    expect(await lireLaReponseDesDossiersAuRib(Promise.resolve({ data: null, error: { message: 'refus fictif' } })))
      .toEqual({ etat: 'refusee', motif: 'refus fictif' })
  })

  it('une requête qui lève tombe du côté signalé : refusée, avec son motif — jamais « aucun dossier »', async () => {
    expect(await lireLaReponseDesDossiersAuRib(Promise.reject(new Error('réseau coupé')))).toEqual({ etat: 'refusee', motif: 'réseau coupé' })
    // Un constructeur de requête n'est pas une promesse : son `then` rend ce qu'il veut, `await` attend la réponse qu'il passe.
    const constructeur: PromiseLike<{ data: unknown; error: unknown }> = {
      then: (suite) => Promise.resolve(suite ? suite({ data: AUCUN, error: null }) : undefined) as never,
    }
    expect(await lireLaReponseDesDossiersAuRib(constructeur)).toEqual({ etat: 'lue', lu: { dossiers: [] } })
    const quiLeve: PromiseLike<{ data: unknown; error: unknown }> = { then: () => { throw new Error('levée fictive') } }
    expect(await lireLaReponseDesDossiersAuRib(quiLeve)).toEqual({ etat: 'refusee', motif: 'levée fictive' })
  })
})

describe('la lecture en base ne rejette jamais', () => {
  it('un client sans la fonction (l’appel lève avant d’avoir rendu une requête) : refusée, jamais une levée vers l’écran', async () => {
    // Le faux client de ce fichier n'a pas de `rpc` : `supabase.rpc(…)` lève un TypeError avant toute requête.
    const lecture = await lireLesDossiersAuRibAConfirmerEnBase()
    expect(lecture.etat).toBe('refusee')
    expect(lecture.etat === 'refusee' && lecture.motif).toMatch(/rpc/)
  })
})
