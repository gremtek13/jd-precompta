import { describe, expect, it } from 'vitest'
import { analyserEcritures, calculerBalance, lignesChargeProduitPourPiece, soldeCompte, tvaNettePourPeriode } from './ecritures'
import { COMPTE_BANQUE, COMPTE_TVA_COLLECTEE, COMPTE_TVA_DEDUCTIBLE } from './comptes'
import type { Categorie, EcritureBrouillon, Piece } from './types'

const ACHATS = '606100'
const VENTES = '706000'

const piece = (o: Partial<Piece> = {}): Piece => ({
  id: 'p1', dossier_id: 'd1', nom_fichier: 'facture.pdf', statut: 'validee', type_piece: 'achat',
  date_piece: '2026-03-10', montant_ht: null, montant_tva: null, montant_ttc: 120,
  tiers: null, categorie_id: 'c1', created_at: '2026-03-10T09:00:00Z', ...o,
} as Piece)

const ecriture = (o: Partial<EcritureBrouillon> = {}): EcritureBrouillon => ({
  id: 'e1', dossier_id: 'd1', piece_id: 'p1', ligne_bancaire_id: null, date: '2026-03-10',
  libelle: 'Fournisseur', sens: 'debit', statut: 'proposee', compte: ACHATS, montant: 120,
  created_at: '2026-03-10T09:00:00Z', ...o,
} as EcritureBrouillon)

describe('lignesChargeProduitPourPiece', () => {
  it('passe un achat au débit et une vente au crédit', () => {
    expect(lignesChargeProduitPourPiece('d1', piece(), ACHATS)).toEqual([
      expect.objectContaining({ compte: ACHATS, sens: 'debit', montant: 120 }),
    ])
    expect(lignesChargeProduitPourPiece('d1', piece({ type_piece: 'vente' }), VENTES)).toEqual([
      expect.objectContaining({ compte: VENTES, sens: 'credit', montant: 120 }),
    ])
  })

  it('sépare la TVA sur son propre compte, collectée ou déductible', () => {
    const achat = lignesChargeProduitPourPiece('d1', piece({ montant_ttc: 120, montant_tva: 20 }), ACHATS)
    expect(achat).toHaveLength(2)
    expect(achat[0]).toMatchObject({ compte: ACHATS, montant: 100, sens: 'debit' }) // HT déduit du TTC
    expect(achat[1]).toMatchObject({ compte: COMPTE_TVA_DEDUCTIBLE, montant: 20, sens: 'debit' })

    const vente = lignesChargeProduitPourPiece('d1', piece({ type_piece: 'vente', montant_ttc: 120, montant_tva: 20 }), VENTES)
    expect(vente[1]).toMatchObject({ compte: COMPTE_TVA_COLLECTEE, sens: 'credit' })
  })

  it('préfère le HT saisi au HT recalculé', () => {
    const lignes = lignesChargeProduitPourPiece('d1', piece({ montant_ht: 99, montant_ttc: 120, montant_tva: 20 }), ACHATS)
    expect(lignes[0].montant).toBe(99)
  })

  it('inverse le sens d’un montant négatif plutôt que de porter un montant négatif', () => {
    // Un avoir ou un remboursement. Garder un montant négatif au débit fausserait le contrôle
    // débit = crédit : un groupe doublé dans le mauvais sens paraîtrait équilibré.
    const avoir = lignesChargeProduitPourPiece('d1', piece({ montant_ttc: -50 }), ACHATS)
    expect(avoir[0]).toMatchObject({ sens: 'credit', montant: 50 })
    expect(avoir.every((l) => l.montant >= 0)).toBe(true)
  })

  it('date par la pièce, sinon par son dépôt', () => {
    expect(lignesChargeProduitPourPiece('d1', piece({ date_piece: '2026-01-05' }), ACHATS)[0].date).toBe('2026-01-05')
    const sansDate = lignesChargeProduitPourPiece('d1', piece({ date_piece: null }), ACHATS)[0].date
    expect(sansDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('libelle par le tiers, sinon par le nom du fichier', () => {
    expect(lignesChargeProduitPourPiece('d1', piece({ tiers: 'EDF' }), ACHATS)[0].libelle).toBe('EDF')
    expect(lignesChargeProduitPourPiece('d1', piece({ tiers: null }), ACHATS)[0].libelle).toBe('facture.pdf')
  })
})

describe('soldeCompte', () => {
  it('soustrait le sens inverse au lieu de tout additionner', () => {
    // Une somme aveugle des montants ajouterait l'avoir à la charge au lieu de l'en retrancher.
    const lignes = [
      ecriture({ compte: ACHATS, sens: 'debit', montant: 100 }),
      ecriture({ compte: ACHATS, sens: 'credit', montant: 30 }), // avoir
      ecriture({ compte: VENTES, sens: 'credit', montant: 500 }), // autre compte, ignoré
    ]
    expect(soldeCompte(lignes, ACHATS, 'debit')).toBe(70)
  })

  it('rend un solde positif dans le sens normal du compte', () => {
    const lignes = [ecriture({ compte: VENTES, sens: 'credit', montant: 500 })]
    expect(soldeCompte(lignes, VENTES, 'credit')).toBe(500)
    expect(soldeCompte(lignes, VENTES, 'debit')).toBe(-500)
  })

  it('rend zéro sur un compte absent', () => {
    expect(soldeCompte([ecriture()], '999999', 'debit')).toBe(0)
  })
})

describe('tvaNettePourPeriode', () => {
  it('fait collectée moins déductible, bornes incluses', () => {
    const lignes = [
      ecriture({ compte: COMPTE_TVA_COLLECTEE, sens: 'credit', montant: 200, date: '2026-01-01' }),
      ecriture({ compte: COMPTE_TVA_DEDUCTIBLE, sens: 'debit', montant: 50, date: '2026-03-31' }),
      ecriture({ compte: COMPTE_TVA_COLLECTEE, sens: 'credit', montant: 999, date: '2026-04-01' }), // hors période
    ]
    expect(tvaNettePourPeriode(lignes, '2026-01-01', '2026-03-31')).toBe(150)
  })
})

describe('analyserEcritures', () => {
  it('compte les pièces encore sans contrepartie banque', () => {
    const lignes = [
      ecriture({ piece_id: 'sans', compte: ACHATS }),
      ecriture({ piece_id: 'avec', compte: ACHATS }),
      ecriture({ piece_id: 'avec', compte: COMPTE_BANQUE, sens: 'credit' }),
    ]
    expect(analyserEcritures(lignes, []).nbSansContrepartie).toBe(1)
  })

  it('ne signale un déséquilibre que sur une écriture complète', () => {
    // Une pièce sans contrepartie est forcément déséquilibrée : la signaler serait un faux positif.
    const incomplete = [ecriture({ piece_id: 'x', compte: ACHATS, montant: 120 })]
    expect(analyserEcritures(incomplete, []).groupesDesequilibres).toEqual([])

    const desequilibree = [
      ecriture({ piece_id: 'y', compte: ACHATS, sens: 'debit', montant: 120 }),
      ecriture({ piece_id: 'y', compte: COMPTE_BANQUE, sens: 'credit', montant: 100 }),
    ]
    expect(analyserEcritures(desequilibree, []).groupesDesequilibres).toEqual([{ pieceId: 'y', solde: 20 }])
  })

  it('absorbe un écart d’arrondi de deux centimes, pas davantage', () => {
    const ecart = (montantBanque: number) =>
      analyserEcritures([
        ecriture({ piece_id: 'z', compte: ACHATS, sens: 'debit', montant: 120 }),
        ecriture({ piece_id: 'z', compte: COMPTE_BANQUE, sens: 'credit', montant: montantBanque }),
      ], []).groupesDesequilibres.length

    expect(ecart(119.99)).toBe(0) // un centime : arrondi
    expect(ecart(119.9)).toBe(1)  // dix centimes : écart réel
  })

  it('repère une pièce dont le montant ne correspond plus à son écriture', () => {
    const p = piece({ id: 'maj', montant_ttc: 200 })
    const lignes = [ecriture({ piece_id: 'maj', compte: ACHATS, sens: 'debit', montant: 120 })]
    expect(analyserEcritures(lignes, [p]).piecesDesynchronisees).toEqual([p])
  })

  it('ne déclare pas désynchronisée une pièce à montant négatif correctement enregistrée', () => {
    // Ses lignes sont au sens inverse du sens naturel de la pièce : une somme non signée
    // conclurait à tort à un écart.
    const avoir = piece({ id: 'avoir', montant_ttc: -50 })
    const lignes = [ecriture({ piece_id: 'avoir', compte: ACHATS, sens: 'credit', montant: 50 })]
    expect(analyserEcritures(lignes, [avoir]).piecesDesynchronisees).toEqual([])
  })

  it('ne déclare pas désynchronisée une pièce sans écriture encore générée', () => {
    expect(analyserEcritures([], [piece({ id: 'vierge' })]).piecesDesynchronisees).toEqual([])
  })
})

describe('calculerBalance', () => {
  it('regroupe par compte, avec totaux et solde signé', () => {
    const lignes = [
      ecriture({ compte: ACHATS, sens: 'debit', montant: 100 }),
      ecriture({ compte: ACHATS, sens: 'credit', montant: 30 }),
      ecriture({ compte: VENTES, sens: 'credit', montant: 500 }),
    ]
    const balance = calculerBalance(lignes, [])
    expect(balance.map((l) => l.compte)).toEqual([ACHATS, VENTES]) // trié par numéro
    expect(balance[0]).toMatchObject({ nbEcritures: 2, totalDebit: 100, totalCredit: 30, solde: 70 })
    expect(balance[1]).toMatchObject({ solde: -500 }) // créditeur
  })

  it('nomme les comptes fixes, puis les catégories, sinon un tiret', () => {
    const categories = [{ compte_comptable: ACHATS, libelle: 'Achats fournisseurs' } as Categorie]
    const balance = calculerBalance(
      [ecriture({ compte: ACHATS }), ecriture({ compte: COMPTE_BANQUE }), ecriture({ compte: '999999' })],
      categories,
    )
    // Trié par numéro de compte : 512000 (Banque) avant 606100 (Achats) avant 999999.
    expect(balance.map((l) => l.libelle)).toEqual(['Banque', 'Achats fournisseurs', '—'])
  })
})
