import { describe, expect, it } from 'vitest'
import { cadre7DeLExercice } from './cadre7'
import { calculerDeclaration2035, POSTE_INDEMNITES_KM } from './declaration2035'
import { forfaitKilometriqueDesPostes } from './declaration2035E'
import { arrondirPourFormulaire, valeursDesCases } from './cases2035'
import { AUCUNE_SAISIE_2035 } from './saisies2035'
import { instantane2035, lireInstantane2035 } from './validationExercice'
import { cotisationsComptees } from './cotisationRapprochee'
import { paiementsDesPieces } from './rattachement'
import { PLAN_PAR_DEFAUT } from './planComptable'
import { ventesFactureesVides } from '../test/ventesFacturees'
import { CAISSE_ABSENTE } from './recettesDeCaisse'
import type { Categorie, Piece, VehiculeDossier } from './types'

// LE CADRE 7 DE LA 2035-B (17/11/2026) : ce que chaque ligne porte, et le total A, qui est la part de BJ venue du barème.

const vehicule = (o: Partial<VehiculeDossier>): VehiculeDossier => ({
  id: 'v', dossier_id: 'd1', annee: 2025, modele: 'Clio', type: 'voiture', puissance_fiscale: 6, bareme: 'bnc',
  motorisation: 'thermique', carburant: 'diesel', km_professionnel: 4000, inscrit_immobilisations: false,
  amortissements_a_reintegrer: null, created_at: '2025-01-05T10:00:00Z', updated_at: '2025-01-05T10:00:00Z', ...o,
})

const categories = [{ id: 'c-deplacements', poste_2035: 'Frais de déplacement' }] as Categorie[]
// Un péage payé à part : il compte en BJ par son poste, à côté du forfait.
const peage = { id: 'p1', statut: 'validee', type_piece: 'achat', date_piece: '2025-03-10', montant_ht: 37.4, montant_ttc: 37.4, categorie_id: 'c-deplacements' } as Piece

const declaration = (vehicules: VehiculeDossier[], pieces: Piece[] = [], annee = 2025) => calculerDeclaration2035(
  annee, pieces, categories, [], cotisationsComptees([], [], 'tresorerie'), vehicules, false,
  paiementsDesPieces([], [], [], []), [], [], PLAN_PAR_DEFAUT, ventesFactureesVides('d1'), { etat: 'sans_bascule' }, CAISSE_ABSENTE,
)
const attenduDe = (d: ReturnType<typeof declaration>) => Math.round(forfaitKilometriqueDesPostes(d.depenses) * 100)

// Trois véhicules dont les indemnités portent des centimes : 4 001 km à 0,665 €, 4 003 km à 0,665 €, 2 999 km de moto.
const TROIS = [
  vehicule({ id: 'a', km_professionnel: 4001, created_at: '2025-01-01T00:00:00Z' }),
  vehicule({ id: 'b', modele: '  ', km_professionnel: 4003, motorisation: null, carburant: null, created_at: '2025-01-02T00:00:00Z' }),
  vehicule({ id: 'c', modele: 'Vespa', type: 'moto', puissance_fiscale: 3, km_professionnel: 2999, carburant: 'super_sans_plomb', created_at: '2025-01-03T00:00:00Z' }),
]

describe('cadre7DeLExercice — le total A est la part de BJ venue du barème', () => {
  it('égale, à l’euro, le poste des indemnités kilométriques de la 2035, et BJ moins ses autres postes', () => {
    const d = declaration(TROIS, [peage])
    const poste = d.depenses.find((l) => l.poste === POSTE_INDEMNITES_KM)!
    const { cadre, ecart } = cadre7DeLExercice(TROIS, 2025, attenduDe(d), false)
    expect(ecart).toBeNull()
    expect(cadre!.totalA).toBe(Math.round(poste.montant))
    // Au centime, BJ est le forfait plus le péage : le total A en est la part du barème, et rien d'autre.
    const { valeurs } = valeursDesCases(d, AUCUNE_SAISIE_2035)
    expect(Math.round((valeurs.get('BJ')! - 37.4) * 100)).toBe(Math.round(poste.montant * 100))
    // Et BJ imprimé (à l'euro) contient le total A imprimé, à l'arrondi près du péage.
    expect(Math.abs(arrondirPourFormulaire(valeurs, 2025).get('BJ')! - 37 - (cadre!.totalA as number))).toBeLessThanOrEqual(1)
  })

  it('ses lignes s’additionnent exactement au total imprimé, chacune à un euro au plus de son indemnité', () => {
    const d = declaration(TROIS)
    const { cadre } = cadre7DeLExercice(TROIS, 2025, attenduDe(d), false)
    const euros = cadre!.lignes.map((l) => l.indemnite as number)
    expect(euros.reduce((s, e) => s + e, 0)).toBe(cadre!.totalA)
    // 2 660,67 + 2 662,00 + 1 403,53 = 6 726,20 € : arrondies chacune, 2 661 + 2 662 + 1 404 = 6 727 sous un total de 6 726.
    // L'euro manquant aux floors va au plus grand reste (0,67) : la moto reste à 1 403.
    expect(cadre!.totalA).toBe(6726)
    expect(euros).toEqual([2661, 2662, 1403])
  })

  it('pour un exercice validé, l’instantané porte le poste : le recalcul le retrouve, ou les montants restent vides', () => {
    const d = declaration(TROIS)
    const { valeurs } = valeursDesCases(d, AUCUNE_SAISIE_2035)
    const instantane = lireInstantane2035(JSON.parse(JSON.stringify(
      instantane2035(d, valeurs, arrondirPourFormulaire(valeurs, 2025), { nom: 'X', activite: null, siret: null }),
    )))!
    const attendu = Math.round(forfaitKilometriqueDesPostes(instantane.postes) * 100)
    expect(cadre7DeLExercice(TROIS, 2025, attendu, false).ecart).toBeNull()
    // Un barème changé depuis la validation : la 2035 validée fait foi, rien ne la contredit sur le papier.
    const { cadre, ecart } = cadre7DeLExercice(TROIS, 2025, attendu + 100, false)
    expect(ecart).toEqual({ calculeCentimes: attendu, attenduCentimes: attendu + 100 })
    expect(cadre!.totalA).toBeNull()
    expect(cadre!.lignes.every((l) => l.indemnite === null)).toBe(true)
    expect(cadre!.lignes.map((l) => l.kilometres)).toEqual([4001, 4003, 2999])
  })
})

describe('cadre7DeLExercice — ce que chaque ligne porte, et ce qui reste vide', () => {
  it('le type, la puissance, le barème, la motorisation et le carburant aux mots du formulaire ; un champ non saisi reste vide', () => {
    const { cadre } = cadre7DeLExercice(TROIS, 2025, attenduDe(declaration(TROIS)), false)
    expect(cadre!.lignes.map((l) => [l.modele, l.type, l.puissanceFiscale, l.bareme, l.motorisation, l.carburant, l.kilometres])).toEqual([
      ['Clio', 'T', 6, 'bnc', 'Thermique', 'Diesel', 4001],
      [null, 'T', 6, 'bnc', null, null, 4003],
      ['Vespa', 'M', 3, 'bnc', 'Thermique', 'Sans plomb', 2999],
    ])
  })

  it('un cyclomoteur sans puissance, un véhicule sans kilomètre ni ligne, l’ordre de saisie', () => {
    const vs = [
      vehicule({ id: 'z', type: 'cyclomoteur', puissance_fiscale: 0, km_professionnel: 500, bareme: 'bic', created_at: '2025-02-01T00:00:00Z' }),
      vehicule({ id: 'y', km_professionnel: 0, created_at: '2025-01-01T00:00:00Z' }),
      vehicule({ id: 'x', modele: 'Zoé', motorisation: 'electrique', carburant: null, created_at: '2025-01-15T00:00:00Z' }),
      vehicule({ id: 'w', annee: 2024 }),
    ]
    const { cadre } = cadre7DeLExercice(vs, 2025, attenduDe(declaration(vs)), false)
    expect(cadre!.lignes.map((l) => [l.modele, l.type, l.puissanceFiscale, l.bareme, l.motorisation])).toEqual([
      ['Zoé', 'T', 6, 'bnc', 'Électrique'],
      ['Clio', 'V', null, 'bic', 'Thermique'],
    ])
  })

  it('aucun véhicule au barème : le cadre reste vierge', () => {
    expect(cadre7DeLExercice([], 2025, 0, true)).toEqual({ cadre: null, ecart: null })
    expect(cadre7DeLExercice([vehicule({ km_professionnel: 0 })], 2025, 0, true)).toEqual({ cadre: null, ecart: null })
    expect(cadre7DeLExercice([vehicule({ annee: 2024 })], 2025, 0, false).cadre).toBeNull()
  })

  it('une indemnité que le barème ne calcule pas : « à saisir » sur sa ligne et au total A, jamais un total qui l’omet', () => {
    // Puissance hors des tranches : 0 CV pour une moto. La 2035 n'en compte rien.
    const vs = [vehicule({ id: 'a' }), vehicule({ id: 'b', type: 'moto', puissance_fiscale: 0, created_at: '2025-02-01T00:00:00Z' })]
    const { cadre, ecart } = cadre7DeLExercice(vs, 2025, attenduDe(declaration(vs)), false)
    expect(ecart).toBeNull()
    expect(cadre!.lignes.map((l) => l.indemnite)).toEqual([2660, 'a_saisir'])
    expect(cadre!.totalA).toBe('a_saisir')
  })

  it('le total B : « à saisir » quand un bien du matériel de transport est amorti l’année du barème, sinon rien — jamais un montant', () => {
    const attendu = attenduDe(declaration([vehicule({})]))
    expect(cadre7DeLExercice([vehicule({})], 2025, attendu, true).cadre!.totalB).toBe('a_saisir')
    expect(cadre7DeLExercice([vehicule({})], 2025, attendu, false).cadre!.totalB).toBeNull()
    // Même un montant dans la table, qu'aucun écran ne saisit, ne s'imprime pas.
    const inscrit = vehicule({ inscrit_immobilisations: true, amortissements_a_reintegrer: 1200 })
    expect(cadre7DeLExercice([inscrit], 2025, attendu, false).cadre!.totalB).toBeNull()
  })
})
