import { describe, expect, it } from 'vitest'
import { soldeAuReleve } from './banqueClient'
import type { ComptesDuClient, CompteDuClient } from './banqueClientParCompte'
import { motsDuCabinet } from './espaceVentes'
import type { LectureComplete } from './lectureComplete'
import {
  banqueDeLAccueil, COURBE_A_VENIR, MOIS_DE_LA_COURBE, pointsDuSolde, premierMoisDeLaCourbe, SOLDE_ILLISIBLE, SOLDE_MUET,
  SOLDE_SANS_RELEVE, soldeDeLAccueil, soldeSansReleveSur, SOUS_TITRE_DU_SOLDE, TITRE_DU_SOLDE, type ControleDeLAccueil,
} from './soldeDeLAccueil'

// LE SOLDE DU COMPTE SUR L'ACCUEIL DU CLIENT : le montant de « Ma banque » (`soldeAuReleve`), jamais un autre ; la courbe des
// soldes LUS des relevés contrôlés, un point par fin de période, sur douze mois au plus ; muet sur une lecture partielle ; par
// compte, sans jamais additionner. Données FICTIVES.

const ctl = (o: Partial<ControleDeLAccueil> & { periode_fin: string | null }): ControleDeLAccueil => ({
  id: `c-${o.periode_fin}`, solde_final: 1000, coherent: true, created_at: `${o.periode_fin ?? '2026-01-01'}T08:00:00Z`, ...o,
})
const entiere = <T,>(lignes: T[]): LectureComplete<T> => ({ lignes, complete: true, motif: null })
const partielle = <T,>(lignes: T[]): LectureComplete<T> => ({ lignes, complete: false, motif: '2 ligne(s) lue(s) sur 3 annoncée(s)' })
const compte = (o: Partial<CompteDuClient>): CompteDuClient => ({
  id: 'P', libelle: 'Compte principal', principal: true, fin_d_identifiant: null, ouvert_le: null, clos_le: null, ...o,
})

describe('la fenêtre de la courbe', () => {
  it('douze mois, le mois du dernier relevé compris, à cheval sur deux années', () => {
    expect(MOIS_DE_LA_COURBE).toBe(12)
    expect(premierMoisDeLaCourbe('2026-10')).toBe('2025-11')
    expect(premierMoisDeLaCourbe('2026-12')).toBe('2026-01')
    expect(premierMoisDeLaCourbe('2026-01')).toBe('2025-02')
  })
})

describe('les points de la courbe', () => {
  it('les soldes LUS des relevés cohérents et datés, de l’ancien au récent, quel que soit l’ordre de lecture', () => {
    const points = pointsDuSolde([
      ctl({ periode_fin: '2026-08-31', solde_final: 12480.35 }),
      ctl({ periode_fin: '2026-06-30', solde_final: 11215.8 }),
      ctl({ periode_fin: '2026-07-31', solde_final: 10640.55 }),
      ctl({ periode_fin: '2026-05-31', solde_final: 9000, coherent: false }),
      ctl({ periode_fin: null, solde_final: 5 }),
    ])
    expect(points).toEqual([
      { au: '2026-06-30', solde: 11215.8 }, { au: '2026-07-31', solde: 10640.55 }, { au: '2026-08-31', solde: 12480.35 },
    ])
  })
  it('deux relevés de même fin de période font un point : le dernier enregistré, comme le montant de « Ma banque »', () => {
    const points = pointsDuSolde([
      ctl({ id: 'a', periode_fin: '2026-08-31', solde_final: 1, created_at: '2026-09-02T08:00:00Z' }),
      ctl({ id: 'b', periode_fin: '2026-08-31', solde_final: 2, created_at: '2026-09-03T08:00:00Z' }),
      ctl({ id: 'c', periode_fin: '2026-07-31', solde_final: 3 }),
    ])
    expect(points).toEqual([{ au: '2026-07-31', solde: 3 }, { au: '2026-08-31', solde: 2 }])
    // À égalité d'instant, l'identifiant départage, comme `soldeAuReleve`.
    const egalite = [
      ctl({ id: 'z', periode_fin: '2026-08-31', solde_final: 9, created_at: '2026-09-02T08:00:00Z' }),
      ctl({ id: 'y', periode_fin: '2026-08-31', solde_final: 8, created_at: '2026-09-02T08:00:00Z' }),
    ]
    expect(pointsDuSolde(egalite)).toEqual([{ au: '2026-08-31', solde: 9 }])
    expect(soldeAuReleve(entiere(egalite))).toEqual({ etat: 'lu', solde: 9, au: '2026-08-31' })
  })
  it('rien de plus vieux que douze mois avant le dernier relevé', () => {
    const points = pointsDuSolde([
      ctl({ periode_fin: '2025-10-31' }), ctl({ periode_fin: '2025-11-30' }), ctl({ periode_fin: '2026-10-31' }),
    ])
    expect(points.map((p) => p.au)).toEqual(['2025-11-30', '2026-10-31'])
  })
  it('aucun relevé retenu : aucun point', () => {
    expect(pointsDuSolde([])).toEqual([])
    expect(pointsDuSolde([ctl({ periode_fin: '2026-08-31', coherent: false })])).toEqual([])
  })
})

describe('le solde de l’accueil', () => {
  it('le montant ET la date de « Ma banque », et une courbe qui finit sur eux', () => {
    const lignes = [
      ctl({ periode_fin: '2026-06-30', solde_final: 11215.8 }), ctl({ periode_fin: '2026-07-31', solde_final: 10640.55 }),
      ctl({ periode_fin: '2026-08-31', solde_final: 12480.35 }),
    ]
    const solde = soldeDeLAccueil(entiere(lignes))
    expect(solde).toEqual({
      etat: 'lu', solde: 12480.35, au: '2026-08-31',
      courbe: [{ au: '2026-06-30', solde: 11215.8 }, { au: '2026-07-31', solde: 10640.55 }, { au: '2026-08-31', solde: 12480.35 }],
    })
    const deMaBanque = soldeAuReleve(entiere(lignes))
    expect(deMaBanque.etat === 'lu' && solde.etat === 'lu' && deMaBanque.solde === solde.solde && deMaBanque.au === solde.au).toBe(true)
  })
  it('un seul relevé : le montant, pas de courbe', () => {
    expect(soldeDeLAccueil(entiere([ctl({ periode_fin: '2026-08-31', solde_final: 42 })])))
      .toEqual({ etat: 'lu', solde: 42, au: '2026-08-31', courbe: null })
  })
  it('lue en partie : muet, avec son motif — ni montant ni courbe', () => {
    const solde = soldeDeLAccueil(partielle([ctl({ periode_fin: '2026-08-31' }), ctl({ periode_fin: '2026-07-31' })]))
    expect(solde).toEqual({ etat: 'muet', motif: '2 ligne(s) lue(s) sur 3 annoncée(s)' })
  })
  it('aucun relevé contrôlé, ou aucun solde sûr : dit, jamais un zéro', () => {
    expect(soldeDeLAccueil(entiere([]))).toEqual({ etat: 'aucun_releve' })
    expect(soldeDeLAccueil(entiere([ctl({ periode_fin: '2026-08-31', coherent: false }), ctl({ periode_fin: null })])))
      .toEqual({ etat: 'aucun_solde_sur', releves: 2 })
  })
})

describe('plusieurs comptes bancaires', () => {
  const P = compte({})
  const B = compte({ id: 'B', libelle: 'Livret pro', principal: false })
  const lus = (...comptes: CompteDuClient[]): ComptesDuClient => ({ etat: 'lus', comptes })

  it('le drapeau baissé (`sans_objet`), ou un seul compte : le solde du dossier', () => {
    const lignes = [ctl({ periode_fin: '2026-08-31', solde_final: 7 })]
    expect(banqueDeLAccueil({ etat: 'sans_objet' }, entiere(lignes)))
      .toEqual({ etat: 'un', solde: { etat: 'lu', solde: 7, au: '2026-08-31', courbe: null } })
    expect(banqueDeLAccueil(lus(P), entiere(lignes.map((l) => ({ ...l, compte_bancaire_id: 'P' })))).etat).toBe('un')
  })
  it('deux comptes : chacun son solde et sa courbe, jamais une somme de soldes de dates différentes', () => {
    const banque = banqueDeLAccueil(lus(B, P), entiere([
      ctl({ id: 'p1', compte_bancaire_id: 'P', periode_fin: '2026-07-31', solde_final: 100 }),
      ctl({ id: 'p2', compte_bancaire_id: 'P', periode_fin: '2026-08-31', solde_final: 150 }),
      ctl({ id: 'b1', compte_bancaire_id: 'B', periode_fin: '2026-06-30', solde_final: 5000 }),
    ]))
    expect(banque).toEqual({
      etat: 'comptes',
      comptes: [
        { compte: P, solde: { etat: 'lu', solde: 150, au: '2026-08-31', courbe: [{ au: '2026-07-31', solde: 100 }, { au: '2026-08-31', solde: 150 }] } },
        { compte: B, solde: { etat: 'lu', solde: 5000, au: '2026-06-30', courbe: null } },
      ],
    })
  })
  it('comptes illisibles, ou un relevé d’un compte que la lecture n’a pas rendu : rien ne se dit', () => {
    expect(banqueDeLAccueil({ etat: 'illisible', motif: 'refusé' }, entiere([])).etat).toBe('retenue')
    expect(banqueDeLAccueil(lus(P, B), entiere([ctl({ compte_bancaire_id: 'X', periode_fin: '2026-08-31' })])).etat).toBe('retenue')
    expect(banqueDeLAccueil(lus(P, B), entiere([ctl({ compte_bancaire_id: null, periode_fin: '2026-08-31' })])).etat).toBe('retenue')
  })
  it('un compte lu en partie se tait, compte par compte', () => {
    const banque = banqueDeLAccueil(lus(P, B), partielle([ctl({ compte_bancaire_id: 'P', periode_fin: '2026-08-31' })]))
    expect(banque.etat === 'comptes' && banque.comptes.every((c) => c.solde.etat === 'muet')).toBe(true)
  })
})

describe('les mots du client', () => {
  it('tutoiement, aucun nom d’onglet du cabinet', () => {
    for (const texte of [TITRE_DU_SOLDE, SOUS_TITRE_DU_SOLDE, SOLDE_SANS_RELEVE, SOLDE_MUET, SOLDE_ILLISIBLE, COURBE_A_VENIR, soldeSansReleveSur(2)]) {
      expect(motsDuCabinet(texte)).toEqual([])
    }
    expect(COURBE_A_VENIR).toBe('La courbe paraîtra avec un second relevé.')
    expect(SOLDE_SANS_RELEVE).toBe('Ton cabinet n’a pas encore contrôlé de relevé.')
  })
})
