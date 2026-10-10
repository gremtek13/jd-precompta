import { describe, expect, it } from 'vitest'
import {
  COUVERTURE_EXPORTEE, SIMULATION_BANQUE_INVERIFIABLE, SIMULATION_SANS_BANQUE, droitBanqueDeLaBase, lectureDeLaCouverture,
  lireLaCouverture, lireLeDroitBanque, moisDeLaCouverture, simulationOuverte, type ReponseDeLaBase,
} from './couvertureReleve'
import { exercicesAReclamer, moisManquantsDe } from './resteAEnvoyer'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'

// LA COUVERTURE DU RELEVÉ ET LA SIMULATION SOUS LA CASE « BANQUE » (espace client, étape P7). Ce qui se garde ici : une
// réponse de la base qu'on ne sait pas lire ne passe jamais pour un relevé (vide ou complet) ; la case « Banque » ne
// s'accorde que sur `true` ; la simulation ne se ferme qu'une fois la couverture en base ; et le drapeau dit ce que porte
// l'export — le jour où la migration `banque_du_client` y entre, ce fichier vire au rouge tant qu'il reste faux.

describe('les mois de la couverture : un tableau de dates au premier du mois, et rien d’autre', () => {
  it('rend chaque mois sous la forme qu’attend moisManquantsDe', () => {
    expect(moisDeLaCouverture(['2025-12-01', '2026-01-01', '2026-03-01'])).toEqual([
      { date: '2025-12-01' }, { date: '2026-01-01' }, { date: '2026-03-01' },
    ])
    expect(moisDeLaCouverture([])).toEqual([])
  })

  it('une forme inconnue n’est ni un relevé vide ni un relevé complet : null', () => {
    for (const rendu of [null, undefined, '2026-01-01', 42, { mois: [] }, [null], [20260101], ['2026-01-15'],
      ['2026-13-01'], ['2026-00-01'], ['2026-1-01'], ['26-01-01'], ['2026-01-01T00:00:00'], ['2026-01-01', 'janvier']]) {
      expect(moisDeLaCouverture(rendu), JSON.stringify(rendu)).toBeNull()
    }
  })

  it('les mois couverts décident des mois manquants, comme les mouvements le faisaient', () => {
    const exercice = exercicesAReclamer(2026, 8, [2025])[0]
    expect(moisManquantsDe(exercice, moisDeLaCouverture(['2026-01-01', '2026-02-01', '2026-04-01', '2025-05-01'])!))
      .toEqual([3, 5, 6, 7, 8])
  })
})

describe('la lecture de la couverture : un refus et une réponse illisible se signalent', () => {
  it('une réponse lue rend ses mois, et une lecture complète', () => {
    expect(lectureDeLaCouverture({ data: ['2026-02-01'], error: null }))
      .toEqual({ lignes: [{ date: '2026-02-01' }], complete: true, motif: null })
    expect(lectureDeLaCouverture({ data: [], error: null })).toEqual({ lignes: [], complete: true, motif: null })
  })

  it('un refus de la base ne rend aucun mois, et dit sa raison', () => {
    expect(lectureDeLaCouverture({ data: null, error: { message: 'Accès refusé à ce dossier.', code: '42501' } }))
      .toEqual({ lignes: [], complete: false, motif: 'couverture du relevé refusée : Accès refusé à ce dossier.' })
    expect(lectureDeLaCouverture({ data: ['2026-01-01'], error: { message: '' } }))
      .toEqual({ lignes: [], complete: false, motif: 'couverture du relevé refusée : raison inconnue' })
  })

  it('une réponse illisible non plus', () => {
    expect(lectureDeLaCouverture({ data: [{ mois: '2026-01-01' }], error: null }))
      .toEqual({ lignes: [], complete: false, motif: 'couverture du relevé illisible' })
    expect(lectureDeLaCouverture({ data: null, error: null }))
      .toEqual({ lignes: [], complete: false, motif: 'couverture du relevé illisible' })
  })
})

// La requête telle qu'un écran la passe : un objet qui a un `then`, PAS une promesse — et dont le `then` ne rend rien,
// comme la doublure qui retient les réponses (src/test/clientRetenu.ts). Enchaîner `.then(lecture)` sur lui rendait
// `undefined` : seul `await` le suit.
function requete(reponse: () => ReponseDeLaBase): PromiseLike<ReponseDeLaBase> {
  const objet = {
    then(suite: (r: ReponseDeLaBase) => unknown, echec?: (e: unknown) => unknown) {
      Promise.resolve().then(reponse).then(suite, echec)
      return undefined
    },
  }
  return objet as unknown as PromiseLike<ReponseDeLaBase>
}

describe('l’écran passe la requête, le module l’attend', () => {
  it('lireLaCouverture attend une requête qui n’est pas une promesse, et en lit la réponse', async () => {
    await expect(lireLaCouverture(requete(() => ({ data: ['2026-01-01'], error: null }))))
      .resolves.toEqual({ lignes: [{ date: '2026-01-01' }], complete: true, motif: null })
    await expect(lireLaCouverture(requete(() => ({ data: null, error: { message: 'Accès refusé à ce dossier.' } }))))
      .resolves.toEqual({ lignes: [], complete: false, motif: 'couverture du relevé refusée : Accès refusé à ce dossier.' })
  })

  it('une requête qui lève se SIGNALE, et ne rend aucun mois', async () => {
    await expect(lireLaCouverture(requete(() => { throw new Error('réseau coupé') })))
      .resolves.toEqual({ lignes: [], complete: false, motif: 'couverture du relevé refusée : réseau coupé' })
  })

  it('lireLeDroitBanque attend de même, et une requête qui lève FERME', async () => {
    await expect(lireLeDroitBanque(requete(() => ({ data: { membre: true, banque: true }, error: null }))))
      .resolves.toEqual({ banque: true, motif: null })
    await expect(lireLeDroitBanque(requete(() => { throw new Error('réseau coupé') })))
      .resolves.toEqual({ banque: false, motif: 'réseau coupé' })
  })
})

describe('« Ma simulation » sous la case « Banque »', () => {
  it('tant que la couverture n’est pas en base, elle s’ouvre à tout accès ; ensuite, à la seule case « Banque »', () => {
    expect(simulationOuverte(false, false)).toBe(true)
    expect(simulationOuverte(false, true)).toBe(true)
    expect(simulationOuverte(true, false)).toBe(false)
    expect(simulationOuverte(true, true)).toBe(true)
  })

  it('la case vue par la base : seul `true` l’accorde', () => {
    expect(droitBanqueDeLaBase({ data: { cabinet: false, membre: true, ventes: false, banque: true }, error: null }))
      .toEqual({ banque: true, motif: null })
    for (const banque of [false, 'true', 1, null, undefined]) {
      expect(droitBanqueDeLaBase({ data: { membre: true, banque }, error: null }), String(banque)).toEqual({ banque: false, motif: null })
    }
  })

  it('un refus ou une réponse d’une autre forme tombent du côté fermé, avec leur motif', () => {
    expect(droitBanqueDeLaBase({ data: null, error: { message: 'JWT expired' } })).toEqual({ banque: false, motif: 'JWT expired' })
    expect(droitBanqueDeLaBase({ data: { banque: true }, error: { message: 'permission denied' } }))
      .toEqual({ banque: false, motif: 'permission denied' })
    for (const data of [null, [], [{ banque: true }], 'banque', true]) {
      expect(droitBanqueDeLaBase({ data, error: null }), JSON.stringify(data)).toEqual({ banque: false, motif: 'droits illisibles' })
    }
  })

  // Ce que l'écran dit quand il se tait : la raison et le geste, dans la langue du client — et aucun mot que le garde des
  // écrans (ecransAvantLecture.test.tsx) prendrait pour une affirmation du vide (« aucun », « rien », un zéro).
  it('les phrases disent pourquoi, et quoi faire, sans affirmer de vide', () => {
    expect(SIMULATION_SANS_BANQUE).toContain('ta banque')
    expect(SIMULATION_SANS_BANQUE).toContain('« Banque »')
    expect(SIMULATION_SANS_BANQUE).toMatch(/demande-lui/)
    expect(SIMULATION_BANQUE_INVERIFIABLE).toContain('Recharge la page.')
    for (const phrase of [SIMULATION_SANS_BANQUE, SIMULATION_BANQUE_INVERIFIABLE]) {
      expect(phrase).not.toMatch(/\b(aucun|aucune|rien)\b|(^|[^\d,.])0(\s|$|,00)/i)
    }
  })
})

describe('le drapeau dit ce que porte l’export', () => {
  // LA MIGRATION `banque_du_client` S'APPLIQUE APRÈS PRÉSENTATION AU CABINET : tant que son fichier n'est pas dans
  // supabase/schema, la couverture n'est pas lue et rien ne change pour le client. Le jour où il y arrive, ce test vire au
  // rouge et demande de passer `COUVERTURE_EXPORTEE` à vrai — les deux écrans passent alors à la couverture, la simulation
  // à la case « Banque », et ce test confronte la fonction exportée à ce que les écrans lui envoient et en attendent.
  it('l’export porte couverture_du_releve si et seulement si COUVERTURE_EXPORTEE le dit — et alors, sa forme est celle qu’on lit', () => {
    const exportee = fichiersDuSchema().some((f) => /create (or replace )?function public\.couverture_du_releve\(/.test(f.texte))
    expect(exportee, 'COUVERTURE_EXPORTEE ne dit plus ce que porte l’export').toBe(COUVERTURE_EXPORTEE)
    if (!exportee) return
    const sql = derniereDefinitionSql('couverture_du_releve')
    // Le paramètre que les écrans envoient, et une seule valeur en retour : un tableau de dates.
    expect(sql).toMatch(/couverture_du_releve\(p_dossier_id uuid\) returns date\[\]/)
    expect(sql).toContain("date_trunc('month', l.date::timestamp)::date")
    expect(sql).toContain("client_du_dossier(p_dossier_id, 'membre')")
  })
})
