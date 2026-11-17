import { describe, expect, it } from 'vitest'
import {
  comptesSurPlusieursPostes, detailDesComptesSurPlusieursPostes, type LigneDuBrouillonPostee, type SourcesDesPostes,
} from './unCompteUnPoste'

const PLAN: SourcesDesPostes['plan'] = {
  cotisations_exploitant: '646100', dotations_amortissements: '681100', indemnites_kilometriques: '625110',
  interets_emprunt: '661110', assurance_emprunt: '616810', prestations_de_services: '706000', ventes_de_biens: '707000',
}

const ligne = (o: Partial<LigneDuBrouillonPostee>): LigneDuBrouillonPostee => ({
  compte: '606400', date: '2025-03-01', piece_id: null, ligne_bancaire_id: null, cotisation_id: null, immobilisation_id: null,
  vehicule_id: null, encaissement_id: null, facture_id: null, operation_caisse_id: null, ...o,
})

const sources = (o: Partial<SourcesDesPostes>): SourcesDesPostes => ({
  ecritures: [], categories: [], pieces: [], mouvements: [], ventilations: [], operationsDeCaisse: [], plan: PLAN, ...o,
})

const CATEGORIES: SourcesDesPostes['categories'] = [
  { id: 'fournitures', compte_comptable: '606400', poste_2035: 'Fournitures de bureau' },
  { id: 'achats', compte_comptable: '606400', poste_2035: 'Achats' },
  { id: 'achats-bis', compte_comptable: '606400', poste_2035: 'achats' },
  { id: 'recettes', compte_comptable: '706000', poste_2035: 'Recettes' },
  { id: 'urssaf', compte_comptable: '646100', poste_2035: 'Impôts et taxes' },
  { id: 'sans-poste', compte_comptable: '606400', poste_2035: null },
]

describe('comptesSurPlusieursPostes (conception 58, § 1.3)', () => {
  it('deux pièces au même compte sous deux postes : le compte, son exercice et ses deux lignes du formulaire', () => {
    const r = comptesSurPlusieursPostes(sources({
      categories: CATEGORIES,
      pieces: [{ id: 'p1', categorie_id: 'fournitures' }, { id: 'p2', categorie_id: 'achats' }],
      ecritures: [ligne({ piece_id: 'p1' }), ligne({ piece_id: 'p2' }), ligne({ piece_id: 'p2', compte: '512000' })],
    }))
    expect(r).toEqual([{
      annee: 2025, compte: '606400',
      lignesDuFormulaire: ['Achats', 'Fournitures de bureau, frais de documentation, de correspondance et de téléphone'],
    }])
    expect(detailDesComptesSurPlusieursPostes(r)).toContain('606400 (2025) : Achats / Fournitures de bureau')
  })

  it('un seul poste, à la casse près, ou une catégorie sans poste : rien', () => {
    expect(comptesSurPlusieursPostes(sources({
      categories: CATEGORIES,
      pieces: [{ id: 'p1', categorie_id: 'achats' }, { id: 'p2', categorie_id: 'achats-bis' }, { id: 'p3', categorie_id: 'sans-poste' }],
      ecritures: [ligne({ piece_id: 'p1' }), ligne({ piece_id: 'p2' }), ligne({ piece_id: 'p3' })],
    }))).toEqual([])
  })

  it('deux exercices différents ne se mêlent pas', () => {
    expect(comptesSurPlusieursPostes(sources({
      categories: CATEGORIES,
      pieces: [{ id: 'p1', categorie_id: 'fournitures' }, { id: 'p2', categorie_id: 'achats' }],
      ecritures: [ligne({ piece_id: 'p1', date: '2025-12-31' }), ligne({ piece_id: 'p2', date: '2026-01-01' })],
    }))).toEqual([])
  })

  it('« Recettes » et une vente facturée disent la même ligne 1 : un seul poste', () => {
    expect(comptesSurPlusieursPostes(sources({
      categories: CATEGORIES,
      mouvements: [{ id: 'm1', categorie_id: 'recettes', ventilee: false, cotisation_id: null, emprunt_id: null }],
      ecritures: [ligne({ compte: '706000', ligne_bancaire_id: 'm1' }), ligne({ compte: '706000', encaissement_id: 'e1' })],
    }))).toEqual([])
  })

  it('une catégorie sur le compte d’un rôle que le moteur range ailleurs : le conflit se dit', () => {
    const r = comptesSurPlusieursPostes(sources({
      categories: CATEGORIES,
      mouvements: [
        { id: 'm1', categorie_id: 'urssaf', ventilee: false, cotisation_id: null, emprunt_id: null },
        { id: 'm2', categorie_id: null, ventilee: false, cotisation_id: 'c1', emprunt_id: null },
      ],
      ecritures: [ligne({ compte: '646100', ligne_bancaire_id: 'm1' }), ligne({ compte: '646100', ligne_bancaire_id: 'm2' })],
    }))
    expect(r).toEqual([{ annee: 2025, compte: '646100', lignesDuFormulaire: ['Autres impôts', 'Charges sociales personnelles'] }])
  })

  it('un mouvement ventilé dont deux parts portent le même compte sous deux postes', () => {
    const r = comptesSurPlusieursPostes(sources({
      categories: CATEGORIES,
      mouvements: [{ id: 'm1', categorie_id: null, ventilee: true, cotisation_id: null, emprunt_id: null }],
      ventilations: [{ ligne_bancaire_id: 'm1', categorie_id: 'fournitures' }, { ligne_bancaire_id: 'm1', categorie_id: 'achats' }],
      ecritures: [ligne({ ligne_bancaire_id: 'm1' })],
    }))
    expect(r.map((c) => c.compte)).toEqual(['606400'])
  })

  it('une recette de caisse et une pièce de vente, deux postes de recette sur le même compte', () => {
    const r = comptesSurPlusieursPostes(sources({
      categories: [...CATEGORIES, { id: 'retro', compte_comptable: '706000', poste_2035: 'Produits financiers' }],
      operationsDeCaisse: [{ id: 'o1', categorie_id: 'recettes' }],
      pieces: [{ id: 'p1', categorie_id: 'retro' }],
      ecritures: [ligne({ compte: '706000', operation_caisse_id: 'o1' }), ligne({ compte: '706000', piece_id: 'p1' })],
    }))
    expect(r.map((c) => c.compte)).toEqual(['706000'])
  })

  it('une source non lue, un compte de bilan ou une ligne sans source n’apportent rien', () => {
    expect(comptesSurPlusieursPostes(sources({
      categories: CATEGORIES,
      pieces: [{ id: 'p1', categorie_id: 'fournitures' }],
      ecritures: [ligne({ piece_id: 'p1' }), ligne({ piece_id: 'inconnue' }), ligne({ ligne_bancaire_id: 'inconnu' }),
        ligne({ compte: '108000', piece_id: 'p1' }), ligne({})],
    }))).toEqual([])
  })

  it('le détail s’arrête à cinq comptes et compte le reste', () => {
    const comptes = Array.from({ length: 7 }, (_, i) => ({ annee: 2025, compte: `60${i}000`, lignesDuFormulaire: ['A', 'B'] }))
    expect(detailDesComptesSurPlusieursPostes(comptes)).toContain('et 2 autre(s)')
    expect(detailDesComptesSurPlusieursPostes([])).toBeUndefined()
  })
})
