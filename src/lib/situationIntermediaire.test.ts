import { describe, expect, it } from 'vitest'
import { calculerSituationIntermediaire } from './situationIntermediaire'
import type { Categorie, CotisationDeclaree, Immobilisation, Piece } from './types'

const categorie = { id: 'c1', libelle: 'Achats', poste_2035: 'Achats', compte_comptable: '606100' } as Categorie
const recette = { id: 'c2', libelle: 'Recettes', poste_2035: 'Recettes', compte_comptable: '706000' } as Categorie

const piece = (o: Partial<Piece>): Piece => ({
  id: 'p', dossier_id: 'd1', nom_fichier: 'x.pdf', statut: 'validee', type_piece: 'achat',
  date_piece: '2026-03-10', montant_ht: null, montant_tva: null, montant_ttc: 100,
  categorie_id: 'c1', created_at: '2026-03-10T00:00:00Z', ...o,
} as Piece)

const immo = (o: Partial<Immobilisation>): Immobilisation => ({
  id: 'i', dossier_id: 'd1', piece_id: null, nature_id: null, libelle: 'Matériel',
  valeur: 3000, duree_annees: 3, date_acquisition: '2026-01-01', ...o,
} as Immobilisation)

describe('calculerSituationIntermediaire', () => {
  it('ne retient que les pièces validées de la période', () => {
    const s = calculerSituationIntermediaire(
      [
        piece({ id: 'a', montant_ttc: 100 }),
        piece({ id: 'b', montant_ttc: 500, statut: 'a_valider' }),   // pas validée
        piece({ id: 'c', montant_ttc: 700, date_piece: '2025-12-31' }), // hors période
      ],
      [categorie], [], [], '2026-01-01', '2026-06-30',
    )
    expect(s.charges).toBe(100)
    expect(s.resultat).toBe(-100)
  })

  it('signe les ventes en positif et les achats en négatif', () => {
    const s = calculerSituationIntermediaire(
      [
        piece({ id: 'v', type_piece: 'vente', categorie_id: 'c2', montant_ttc: 900 }),
        piece({ id: 'a', montant_ttc: 300 }),
      ],
      [categorie, recette], [], [], '2026-01-01', '2026-12-31',
    )
    expect(s.recettes).toBe(900)
    expect(s.charges).toBe(300)
    expect(s.resultat).toBe(600)
  })

  it('compte la dotation en entier pour une immobilisation acquise un 1er janvier', () => {
    // L'année d'acquisition était lue via `new Date(...).getFullYear()` : à l'ouest de Greenwich,
    // un 1er janvier se lisait dans l'année précédente, ce qui décalait toute la fenêtre
    // d'amortissement d'un an — dotation absente la première année, présente une année de trop.
    const lignes = (annee: number) =>
      calculerSituationIntermediaire([], [], [immo({ date_acquisition: '2026-01-01' })], [], `${annee}-01-01`, `${annee}-12-31`)
        .totauxParPoste.find(([poste]) => poste === 'Amortissements')?.[1]

    expect(lignes(2025)).toBeUndefined()  // avant l'acquisition
    expect(lignes(2026)).toBe(-1000)      // 3000 / 3 ans
    expect(lignes(2028)).toBe(-1000)      // dernière année de la durée
    expect(lignes(2029)).toBeUndefined()  // amortissement terminé
  })

  it('retient le montant versé d’une cotisation, sinon celui appelé', () => {
    const cotisations = [
      { id: 'x', dossier_id: 'd1', echeance: '2026-02-05', montant_appele: 300, montant_verse: 280 },
      { id: 'y', dossier_id: 'd1', echeance: '2026-03-05', montant_appele: 400, montant_verse: null },
      { id: 'z', dossier_id: 'd1', echeance: '2027-01-05', montant_appele: 999, montant_verse: null }, // hors période
    ] as CotisationDeclaree[]
    const s = calculerSituationIntermediaire([], [], [], cotisations, '2026-01-01', '2026-12-31')
    expect(s.totauxParPoste.find(([p]) => p === 'Cotisations sociales personnelles')?.[1]).toBe(-680)
  })

  it('ne compte pas deux fois une pièce devenue immobilisation', () => {
    const s = calculerSituationIntermediaire(
      [piece({ id: 'p-immo', montant_ttc: 3000 })],
      [categorie],
      [immo({ piece_id: 'p-immo' })],
      [], '2026-01-01', '2026-12-31',
    )
    // La pièce sort des charges courantes ; seule la dotation annuelle reste.
    expect(s.charges).toBe(1000)
  })
})
