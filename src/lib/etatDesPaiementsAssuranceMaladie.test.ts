import { describe, expect, it } from 'vitest'
import { entierTire, tirage } from '../test/encaissementsBatterie'
import {
  etatsEcartesDits,
  importDesEtats,
  LIBELLES_DES_ETATS_ECARTES,
  rangerLesEtatsDesPaiements,
  type EtatDesPaiementsLu,
  type LigneDeLEtat,
  type RaisonDEcartDUnEtat,
} from './etatDesPaiementsAssuranceMaladie'
import { refusDeLImport } from './paiementsAssuranceMaladie'

// L'ÉTAT DES PAIEMENTS, RANGÉ AUX AGRÉGATS DE LA BASE (conception 53, § 12 ; le gabarit de la page attend une page réelle,
// BOR6-Q2 (A)). Les états de ces essais sont FABRIQUÉS : des journées, des codes et des montants inventés, aucune page
// réelle ; ils jouent ce que les manuels de l'éditeur disent de l'état (un par journée et par caisse, les aides, les indus, les
// régularisations, un total par journée) et ce que la base admet (l'essai paiementsAssuranceMaladie.sql, étapes 60 à 72).

const JOUR = '2026-11-27'
const CPAM = { genre: 'caisse' as const, regime: 1, caisse: 349 }
const facture = (montant: number, part: LigneDeLEtat['part'] = 'obligatoire'): LigneDeLEtat =>
  ({ part, paieUneFacture: true, montant_centimes: montant })
const sansFacture = (montant: number, part: LigneDeLEtat['part'] = 'obligatoire'): LigneDeLEtat =>
  ({ part, paieUneFacture: false, montant_centimes: montant })
const etat = (e: Partial<EtatDesPaiementsLu>): EtatDesPaiementsLu => ({
  journee: '2026-10-05', organisme: CPAM, lignes: [facture(2_310)], totalImprimeCentimes: null, ...e,
})

describe('le rangement d’un état de la caisse', () => {
  it('le total d’une facture paie sa part ; une aide est un forfait ; un indu se déduit du net de sa part', () => {
    const r = rangerLesEtatsDesPaiements([etat({
      lignes: [facture(2_310), facture(1_540), facture(770, 'complementaire'), sansFacture(5_000), sansFacture(-1_200)],
      totalImprimeCentimes: 8_420,
    })], JOUR)
    expect(r.ecartes).toEqual([])
    expect(r.ranges).toBe(1)
    expect(r.sansTotal).toBe(0)
    expect(r.paiements).toEqual([
      { date_journee_comptable: '2026-10-05', regime: 1, caisse: 349, organisme_complementaire: null, part: 'complementaire',
        montant_centimes: 770, regularisations_centimes: 0, nombre_de_factures: 1 },
      { date_journee_comptable: '2026-10-05', regime: 1, caisse: 349, organisme_complementaire: null, part: 'forfait',
        montant_centimes: 5_000, regularisations_centimes: 0, nombre_de_factures: 0 },
      { date_journee_comptable: '2026-10-05', regime: 1, caisse: 349, organisme_complementaire: null, part: 'obligatoire',
        montant_centimes: 2_650, regularisations_centimes: -1_200, nombre_de_factures: 2 },
    ])
    expect(r.periode).toEqual({ du: '2026-10-05', au: '2026-10-05' })
    const imp = importDesEtats(r)
    expect(imp?.rejets).toBeNull()
    expect(refusDeLImport(imp, JOUR)).toBeNull()
  })

  it('un indu seul, et un net négatif, se rangent comme la base les admet', () => {
    const seul = rangerLesEtatsDesPaiements([etat({ lignes: [sansFacture(-3_000)] })], JOUR)
    expect(seul.paiements).toEqual([expect.objectContaining({ part: 'obligatoire', montant_centimes: -3_000,
      regularisations_centimes: -3_000, nombre_de_factures: 0 })])
    const negatif = rangerLesEtatsDesPaiements([etat({ lignes: [facture(1_000), facture(-4_000)] })], JOUR)
    expect(negatif.paiements).toEqual([expect.objectContaining({ part: 'obligatoire', montant_centimes: -3_000,
      regularisations_centimes: -4_000, nombre_de_factures: 1 })])
    expect(refusDeLImport(importDesEtats(seul), JOUR)).toBeNull()
    expect(refusDeLImport(importDesEtats(negatif), JOUR)).toBeNull()
  })

  it('les lignes à zéro ne paient rien, elles se comptent ; un état sans montant s’écarte', () => {
    const r = rangerLesEtatsDesPaiements([etat({ lignes: [facture(0), facture(900)] }), etat({ journee: '2026-10-06', lignes: [facture(0)] })], JOUR)
    expect(r.lignesSansMontant).toBe(1)
    expect(r.ecartes).toEqual([{ rang: 2, raison: 'vide' }])
    expect(r.sansTotal).toBe(1)
  })

  it('l’état d’une complémentaire range sa part sous son numéro, ou « non dit »', () => {
    const r = rangerLesEtatsDesPaiements([
      etat({ organisme: { genre: 'complementaire', organisme: 75_123_456 }, lignes: [facture(1_100, 'complementaire')] }),
      etat({ organisme: { genre: 'complementaire', organisme: null }, lignes: [facture(800, 'complementaire')] }),
    ], JOUR)
    expect(r.paiements.map((p) => [p.regime, p.caisse, p.organisme_complementaire, p.part])).toEqual([
      [null, null, null, 'complementaire'], [null, null, 75_123_456, 'complementaire'],
    ])
    expect(refusDeLImport(importDesEtats(r), JOUR)).toBeNull()
  })
})

describe('tout doute écarte l’état entier, sous son rang et sa raison', () => {
  const cas: [RaisonDEcartDUnEtat, EtatDesPaiementsLu][] = [
    ['journee', etat({ journee: '05/10/2026' })],
    ['journee', etat({ journee: '2026-02-30' })],
    ['a_venir', etat({ journee: '2026-11-28' })],
    ['organisme', etat({ organisme: { genre: 'caisse', regime: 11, caisse: 349 } })],
    ['organisme', etat({ organisme: { genre: 'caisse', regime: 1, caisse: 1000 } })],
    ['organisme', etat({ organisme: { genre: 'complementaire', organisme: 10_000_000_000 } })],
    ['montant', etat({ lignes: [facture(12.5)] })],
    ['montant', etat({ lignes: [facture(100_000_000_000_000)] })],
    ['montant', etat({ totalImprimeCentimes: 0.5 })],
    ['part', etat({ organisme: { genre: 'complementaire', organisme: null }, lignes: [facture(500)] })],
    ['total', etat({ lignes: [facture(2_310), facture(1_000)], totalImprimeCentimes: 3_309 })],
    ['versement_complementaire', etat({ lignes: [facture(2_310), sansFacture(600, 'complementaire')] })],
    ['vide', etat({ lignes: [] })],
  ]

  it.each(cas)('%s', (raison, e) => {
    const r = rangerLesEtatsDesPaiements([e, etat({ journee: '2026-10-07' })], JOUR)
    expect(r.ecartes).toEqual([{ rang: 1, raison }])
    // L'autre état de l'envoi se range, et rien de l'écarté n'entre dans un agrégat.
    expect(r.paiements).toEqual([expect.objectContaining({ date_journee_comptable: '2026-10-07', montant_centimes: 2_310 })])
  })

  it('la même journée sous le même organisme deux fois : les deux s’écartent, une autre caisse se range', () => {
    const r = rangerLesEtatsDesPaiements([
      etat({}), etat({ organisme: { genre: 'caisse', regime: 1, caisse: 350 } }), etat({ lignes: [facture(2_310)] }),
    ], JOUR)
    expect(r.ecartes).toEqual([{ rang: 1, raison: 'deux_fois' }, { rang: 3, raison: 'deux_fois' }])
    expect(r.paiements.map((p) => p.caisse)).toEqual([350])
  })

  it('le total imprimé qui se referme confirme la lecture ; sans lui, l’état se compte à part', () => {
    const r = rangerLesEtatsDesPaiements([etat({ totalImprimeCentimes: 2_310 }), etat({ journee: '2026-10-06' })], JOUR)
    expect([r.ranges, r.sansTotal, r.ecartes]).toEqual([2, 1, []])
  })

  it('un jour de référence illisible écarte tout, comme la base refuse une journée à venir', () => {
    expect(rangerLesEtatsDesPaiements([etat({})], '27/11/2026').ecartes).toEqual([{ rang: 1, raison: 'a_venir' }])
  })

  it('chaque raison a ses mots, dits sous le rang, sans valeur', () => {
    const r = rangerLesEtatsDesPaiements(cas.map(([, e]) => e), JOUR)
    expect(etatsEcartesDits(r)).toHaveLength(cas.length)
    expect(etatsEcartesDits(r)[10]).toBe('État n° 11 : ses lignes ne font pas le total que l’état imprime.')
    for (const phrase of etatsEcartesDits(r)) expect(phrase.replace(/^État n° \d+ : /, '')).not.toMatch(/\d/)
    expect(Object.keys(LIBELLES_DES_ETATS_ECARTES).sort()).toEqual([...new Set(cas.map(([r]) => r)), 'deux_fois'].sort())
  })
})

describe('une batterie tirée : ce qui se range, la base l’admet, et rien ne se perd ni ne se double', () => {
  it('3 000 envois tirés d’une graine fixe', () => {
    const suivant = tirage(20261127)
    const n = (k: number) => entierTire(suivant, k)
    for (let essai = 0; essai < 3_000; essai++) {
      const etats: EtatDesPaiementsLu[] = Array.from({ length: 1 + n(4) }, () => {
        const caisse = n(3) === 0
          ? { genre: 'complementaire' as const, organisme: n(2) === 0 ? null : 1 + n(9_999) }
          : { genre: 'caisse' as const, regime: [1, 2, 4, 91][n(4)], caisse: n(1000) }
        const lignes: LigneDeLEtat[] = Array.from({ length: n(6) }, () => ({
          part: caisse.genre === 'complementaire' || n(2) === 0 ? 'complementaire' : 'obligatoire',
          paieUneFacture: n(4) !== 0,
          montant_centimes: n(5) === 0 ? -n(50_000) : n(200_000),
        }))
        const total = lignes.reduce((s, l) => s + l.montant_centimes, 0)
        return { journee: `2026-${String(1 + n(11)).padStart(2, '0')}-${String(1 + n(28)).padStart(2, '0')}`, organisme: caisse,
          lignes, totalImprimeCentimes: [null, total, total + 1][n(3)] }
      })
      const r = rangerLesEtatsDesPaiements(etats, JOUR)
      expect(r.ranges + r.ecartes.length).toBe(etats.length)
      const ranges = etats.filter((_, i) => !r.ecartes.some((e) => e.rang === i + 1))
      const lignes = ranges.flatMap((e) => e.lignes)
      expect(r.paiements.reduce((s, p) => s + p.montant_centimes, 0)).toBe(lignes.reduce((s, l) => s + l.montant_centimes, 0))
      expect(r.paiements.reduce((s, p) => s + p.nombre_de_factures, 0))
        .toBe(lignes.filter((l) => l.paieUneFacture && l.montant_centimes > 0).length)
      for (const e of r.ecartes) if (etats[e.rang - 1].totalImprimeCentimes !== null && e.raison === 'total') {
        const lu = etats[e.rang - 1]
        expect(lu.lignes.reduce((s, l) => s + l.montant_centimes, 0)).not.toBe(lu.totalImprimeCentimes)
      }
      const imp = importDesEtats(r)
      if (imp) expect(refusDeLImport(imp, JOUR)).toBeNull()
      else expect(r.paiements).toEqual([])
    }
  })
})

describe('le canari : la sortie n’a que des dates, des entiers et les mots de la liste fermée', () => {
  it('sérialisée, chaque texte est une journée ou une part', () => {
    const r = rangerLesEtatsDesPaiements([
      etat({ lignes: [facture(2_310), sansFacture(5_000), sansFacture(-100), facture(300, 'complementaire')] }),
      etat({ journee: '2026-13-01' }),
    ], JOUR)
    const textes: string[] = []
    JSON.stringify(r, (_cle, v: unknown) => {
      if (typeof v === 'string') textes.push(v)
      return v
    })
    const permis = /^(\d{4}-\d{2}-\d{2}|obligatoire|complementaire|forfait|journee|a_venir|organisme|montant|part|total|versement_complementaire|vide|deux_fois)$/
    expect(textes.length).toBeGreaterThan(0)
    expect(textes.filter((t) => !permis.test(t))).toEqual([])
  })
})
