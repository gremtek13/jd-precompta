import { describe, expect, it } from 'vitest'
import { analyserEcritures, calculerBalance, ecrituresSansObjet, lignesChargeProduitPourPiece, lignesPourPiece, piecesAComptabiliser, soldeCompte } from './ecritures'
import type { LigneAGenerer } from './ecritures'
import { COMPTE_BANQUE, COMPTE_FOURNISSEURS, COMPTE_TVA_COLLECTEE, COMPTE_TVA_DEDUCTIBLE } from './comptes'
import { lignesEngagementPourPiece, lignesFactureEngagement, lignesReglementEngagement } from './engagement'
import type { ANouveau, Categorie, EcritureBrouillon, LigneBancaire, Piece } from './types'
import type { ModeleComptable } from './engagement'

const ACHATS = '606100'
// Le modèle de tous les dossiers d'avant l'engagement : les contrôles de trésorerie s'y lisent tels quels.
const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000' }
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
    expect(lignesChargeProduitPourPiece('d1', piece(), ACHATS, true, [])).toEqual([
      expect.objectContaining({ compte: ACHATS, sens: 'debit', montant: 120 }),
    ])
    expect(lignesChargeProduitPourPiece('d1', piece({ type_piece: 'vente' }), VENTES, true, [])).toEqual([
      expect.objectContaining({ compte: VENTES, sens: 'credit', montant: 120 }),
    ])
  })

  it('sépare la TVA sur son propre compte, collectée ou déductible', () => {
    const achat = lignesChargeProduitPourPiece('d1', piece({ montant_ttc: 120, montant_tva: 20 }), ACHATS, true, [])
    expect(achat).toHaveLength(2)
    expect(achat[0]).toMatchObject({ compte: ACHATS, montant: 100, sens: 'debit' }) // HT déduit du TTC
    expect(achat[1]).toMatchObject({ compte: COMPTE_TVA_DEDUCTIBLE, montant: 20, sens: 'debit' })

    const vente = lignesChargeProduitPourPiece('d1', piece({ type_piece: 'vente', montant_ttc: 120, montant_tva: 20 }), VENTES, true, [])
    expect(vente[1]).toMatchObject({ compte: COMPTE_TVA_COLLECTEE, sens: 'credit' })
  })

  it('préfère le HT saisi au HT recalculé', () => {
    const lignes = lignesChargeProduitPourPiece('d1', piece({ montant_ht: 99, montant_ttc: 120, montant_tva: 20 }), ACHATS, true, [])
    expect(lignes[0].montant).toBe(99)
  })

  it('inverse le sens d’un montant négatif plutôt que de porter un montant négatif', () => {
    // Un avoir ou un remboursement. Garder un montant négatif au débit fausserait le contrôle
    // débit = crédit : un groupe doublé dans le mauvais sens paraîtrait équilibré.
    const avoir = lignesChargeProduitPourPiece('d1', piece({ montant_ttc: -50 }), ACHATS, true, [])
    expect(avoir[0]).toMatchObject({ sens: 'credit', montant: 50 })
    expect(avoir.every((l) => l.montant >= 0)).toBe(true)
  })

  it('date par la pièce, sinon par son dépôt', () => {
    expect(lignesChargeProduitPourPiece('d1', piece({ date_piece: '2026-01-05' }), ACHATS, true, [])[0].date).toBe('2026-01-05')
    const sansDate = lignesChargeProduitPourPiece('d1', piece({ date_piece: null }), ACHATS, true, [])[0].date
    expect(sansDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('libelle par le tiers, sinon par le nom du fichier', () => {
    expect(lignesChargeProduitPourPiece('d1', piece({ tiers: 'EDF' }), ACHATS, true, [])[0].libelle).toBe('EDF')
    expect(lignesChargeProduitPourPiece('d1', piece({ tiers: null }), ACHATS, true, [])[0].libelle).toBe('facture.pdf')
  })
})

// Un mouvement rapproché d'une pièce : c'est lui qui date l'écriture (lib/rattachement.ts).
const paiement = (o: Partial<LigneBancaire> = {}): LigneBancaire => ({
  id: 'l1', dossier_id: 'd1', date: '2026-01-05', libelle: 'PRLV', montant: -120, statut: 'rapprochee',
  piece_id: 'p1', cotisation_id: null, categorie_id: null, prelevement_personnel: false, source_fichier: null, libelle_brut: null,
  created_at: '2026-01-06T09:00:00Z', ...o,
})

// L'ÉCRITURE EST DATÉE COMME LA 2035 COMPTE LA PIÈCE : au paiement quand le rapprochement le connaît.
// Elle portait la date de facture pendant que sa contrepartie portait celle du paiement — une facture
// de décembre réglée en janvier avait sa charge dans un exercice et sa 2035 dans l'autre.
describe('lignesChargeProduitPourPiece — la date du paiement', () => {
  const decembre = piece({ date_piece: '2025-12-20', montant_ht: 100, montant_tva: 20, montant_ttc: 120 })

  it('date toutes les lignes au paiement quand le rapprochement le connaît', () => {
    const lignes = lignesChargeProduitPourPiece('d1', decembre, ACHATS, true, [paiement()])
    expect(lignes.map((l) => [l.compte, l.date, l.montant])).toEqual([
      [ACHATS, '2026-01-05', 100],
      [COMPTE_TVA_DEDUCTIBLE, '2026-01-05', 20],
    ])
  })

  it('répartit une pièce réglée en partie entre la facture et le paiement, au centime', () => {
    // 100 € dont 16,67 de TVA, 33,33 € rapprochés : deux tiers restent à la date de facture.
    const p = piece({ date_piece: '2025-12-20', montant_ht: 83.33, montant_tva: 16.67, montant_ttc: 100 })
    const lignes = lignesChargeProduitPourPiece('d1', p, ACHATS, true, [paiement({ montant: -33.33 })])
    expect(lignes.map((l) => [l.date, l.compte, l.montant])).toEqual([
      ['2025-12-20', ACHATS, 55.56],
      ['2025-12-20', COMPTE_TVA_DEDUCTIBLE, 11.11],
      ['2026-01-05', ACHATS, 27.77],
      ['2026-01-05', COMPTE_TVA_DEDUCTIBLE, 5.56],
    ])
    // La somme des morceaux est celle de la pièce, et chaque date porte la part qui lui revient.
    const somme = (date?: string) => Math.round(lignes.filter((l) => !date || l.date === date).reduce((s, l) => s + l.montant, 0) * 100) / 100
    expect(somme()).toBe(100)
    expect(somme('2026-01-05')).toBe(33.33)
  })

  it('garde la somme de la pièce quand chaque moitié s’arrondit vers le haut', () => {
    // 83,33 + 16,67, payée pour moitié : chaque moitié arrondie seule donnerait 41,67 + 41,67 et
    // 8,34 + 8,34, soit un centime de trop par compte. Le dernier morceau prend le reste.
    const p = piece({ date_piece: '2025-12-20', montant_ht: 83.33, montant_tva: 16.67, montant_ttc: 100 })
    const lignes = lignesChargeProduitPourPiece('d1', p, ACHATS, true, [paiement({ montant: -50 })])
    const parCompte = (compte: string) => Math.round(lignes.filter((l) => l.compte === compte).reduce((s, l) => s + l.montant, 0) * 100) / 100
    expect(parCompte(ACHATS)).toBe(83.33)
    expect(parCompte(COMPTE_TVA_DEDUCTIBLE)).toBe(16.67)
  })

  it('ne fait pas de ligne de TVA vide quand sa part s’arrondit à zéro', () => {
    const p = piece({ date_piece: '2025-12-20', montant_ht: 1, montant_tva: 0.01, montant_ttc: 1.01 })
    const lignes = lignesChargeProduitPourPiece('d1', p, ACHATS, true, [paiement({ montant: -0.5 })])
    expect(lignes.every((l) => l.montant > 0)).toBe(true)
    expect(lignes.filter((l) => l.date === '2026-01-05').map((l) => l.compte)).toEqual([ACHATS])
  })

  it('date au dépôt la part que rien ne date', () => {
    const p = piece({ date_piece: null, created_at: '2025-12-21T10:00:00Z', montant_ttc: 120 })
    const lignes = lignesChargeProduitPourPiece('d1', p, ACHATS, true, [paiement({ montant: -60 })])
    expect(lignes.map((l) => [l.date, l.montant])).toEqual([['2026-01-05', 60], ['2025-12-21', 60]])
  })
})

// UN DOSSIER EXONÉRÉ NE VENTILE PAS LA TVA (voir lib/montantRetenu.ts). Il ne la récupère pas : sa
// charge est le TTC, sur une seule ligne, et une TVA déductible en 445660 serait un actif qu'il ne
// déduira jamais — pendant que sa charge, dans le FEC et la balance, serait amputée d'autant.
describe('un dossier exonéré ne ventile pas la TVA', () => {
  const avecTva = { montant_ht: 100, montant_tva: 20, montant_ttc: 120 }

  it('porte la charge TTC sur une seule ligne, sans 445660', () => {
    expect(lignesChargeProduitPourPiece('d1', piece(avecTva), ACHATS, false, [])).toEqual([
      expect.objectContaining({ compte: ACHATS, sens: 'debit', montant: 120 }),
    ])
  })

  it('porte une recette TTC sur une seule ligne, sans 445710', () => {
    expect(lignesChargeProduitPourPiece('d1', piece({ ...avecTva, type_piece: 'vente' }), VENTES, false, [])).toEqual([
      expect.objectContaining({ compte: VENTES, sens: 'credit', montant: 120 }),
    ])
  })

  it('ne signale pas « à régénérer » une écriture TTC juste', () => {
    const p = piece({ id: 'ttc', ...avecTva })
    const lignes = [ecriture({ piece_id: 'ttc', compte: ACHATS, montant: 120 })]
    expect(analyserEcritures(lignes, [{ piece: p, compte: ACHATS }], false, [], TRESORERIE).piecesDesynchronisees).toEqual([])
  })

  it('signale une écriture qui ventile encore la TVA', () => {
    const p = piece({ id: 'ventilee', ...avecTva })
    const lignes = [
      ecriture({ piece_id: 'ventilee', compte: ACHATS, montant: 100 }),
      ecriture({ piece_id: 'ventilee', compte: COMPTE_TVA_DEDUCTIBLE, montant: 20 }),
    ]
    expect(analyserEcritures(lignes, [{ piece: p, compte: ACHATS }], false, [], TRESORERIE).piecesDesynchronisees).toEqual([p])
  })

  // L'ALLER-RETOUR : ce que la génération produit, le contrôle l'accepte, pour les deux statuts et
  // pour une pièce avec ou sans TVA, achat comme vente. Deux fonctions qui décident chacune de la TVA
  // attendue peuvent diverger sans qu'aucun des deux tests unitaires ne le voie ; celui-ci le verrait.
  it.each([false, true])('ce que la génération produit, le contrôle l’accepte (assujetti : %s)', (assujetti) => {
    const pieces = [
      piece({ id: 'a1', ...avecTva }),
      piece({ id: 'a2' }),
      piece({ id: 'v1', type_piece: 'vente', ...avecTva }),
      piece({ id: 'r1', montant_ht: -50, montant_tva: -10, montant_ttc: -60 }),
    ]
    const lignes = pieces.flatMap((p) => lignesChargeProduitPourPiece('d1', p, p.type_piece === 'vente' ? VENTES : ACHATS, assujetti, []))
      .map((l, i) => ecriture({ ...l, id: `g${i}` }))
    const aComptabiliser = pieces.map((p) => ({ piece: p, compte: p.type_piece === 'vente' ? VENTES : ACHATS }))
    expect(analyserEcritures(lignes, aComptabiliser, assujetti, [], TRESORERIE).piecesDesynchronisees).toEqual([])
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

describe('analyserEcritures', () => {
  it('compte les pièces encore sans contrepartie banque', () => {
    const lignes = [
      ecriture({ piece_id: 'sans', compte: ACHATS }),
      ecriture({ piece_id: 'avec', compte: ACHATS }),
      ecriture({ piece_id: 'avec', compte: COMPTE_BANQUE, sens: 'credit' }),
    ]
    expect(analyserEcritures(lignes, [], true, [], TRESORERIE).nbSansContrepartie).toBe(1)
  })

  it('ne signale un déséquilibre que sur une écriture complète', () => {
    // Une pièce sans contrepartie est forcément déséquilibrée : la signaler serait un faux positif.
    const incomplete = [ecriture({ piece_id: 'x', compte: ACHATS, montant: 120 })]
    expect(analyserEcritures(incomplete, [], true, [], TRESORERIE).groupesDesequilibres).toEqual([])

    const desequilibree = [
      ecriture({ piece_id: 'y', compte: ACHATS, sens: 'debit', montant: 120 }),
      ecriture({ piece_id: 'y', compte: COMPTE_BANQUE, sens: 'credit', montant: 100 }),
    ]
    expect(analyserEcritures(desequilibree, [], true, [], TRESORERIE).groupesDesequilibres).toEqual([{ pieceId: 'y', solde: 20 }])
  })

  it('absorbe un écart d’arrondi de deux centimes, pas davantage', () => {
    const ecart = (montantBanque: number) =>
      analyserEcritures([
        ecriture({ piece_id: 'z', compte: ACHATS, sens: 'debit', montant: 120 }),
        ecriture({ piece_id: 'z', compte: COMPTE_BANQUE, sens: 'credit', montant: montantBanque }),
      ], [], true, [], TRESORERIE).groupesDesequilibres.length

    expect(ecart(119.99)).toBe(0) // un centime : arrondi
    expect(ecart(119.9)).toBe(1)  // dix centimes : écart réel
  })

  it('repère une pièce dont le montant ne correspond plus à son écriture', () => {
    const p = piece({ id: 'maj', montant_ttc: 200 })
    const lignes = [ecriture({ piece_id: 'maj', compte: ACHATS, sens: 'debit', montant: 120 })]
    expect(analyserEcritures(lignes, [{ piece: p, compte: ACHATS }], true, [], TRESORERIE).piecesDesynchronisees).toEqual([p])
  })

  it('ne déclare pas désynchronisée une pièce à montant négatif correctement enregistrée', () => {
    // Ses lignes sont au sens inverse du sens naturel de la pièce : une somme non signée
    // conclurait à tort à un écart.
    const avoir = piece({ id: 'avoir', montant_ttc: -50 })
    const lignes = [ecriture({ piece_id: 'avoir', compte: ACHATS, sens: 'credit', montant: 50 })]
    expect(analyserEcritures(lignes, [{ piece: avoir, compte: ACHATS }], true, [], TRESORERIE).piecesDesynchronisees).toEqual([])
  })

  it('ne déclare pas désynchronisée une pièce sans écriture encore générée', () => {
    expect(analyserEcritures([], [{ piece: piece({ id: 'vierge' }), compte: ACHATS }], true, [], TRESORERIE).piecesDesynchronisees).toEqual([])
  })
})

describe('calculerBalance', () => {
  it('regroupe par compte, avec totaux et solde signé', () => {
    const lignes = [
      ecriture({ compte: ACHATS, sens: 'debit', montant: 100 }),
      ecriture({ compte: ACHATS, sens: 'credit', montant: 30 }),
      ecriture({ compte: VENTES, sens: 'credit', montant: 500 }),
    ]
    const balance = calculerBalance(lignes, [], [])
    expect(balance.map((l) => l.compte)).toEqual([ACHATS, VENTES]) // trié par numéro
    expect(balance[0]).toMatchObject({ nbEcritures: 2, totalDebit: 100, totalCredit: 30, solde: 70 })
    expect(balance[1]).toMatchObject({ solde: -500 }) // créditeur
  })

  it('nomme les comptes fixes, puis les catégories, sinon un tiret', () => {
    const categories = [{ compte_comptable: ACHATS, libelle: 'Achats fournisseurs' } as Categorie]
    const balance = calculerBalance(
      [ecriture({ compte: ACHATS }), ecriture({ compte: COMPTE_BANQUE }), ecriture({ compte: '999999' })],
      categories,
      [],
    )
    // Trié par numéro de compte : 512000 (Banque) avant 606100 (Achats) avant 999999.
    expect(balance.map((l) => l.libelle)).toEqual(['Banque', 'Achats fournisseurs', '—'])
  })

  const aNouveau = (o: Partial<ANouveau>): ANouveau => ({
    id: 'an-1', dossier_id: 'd1', date: '2026-01-01', compte: COMPTE_BANQUE, compte_origine: '51210000',
    libelle: 'Banque Populaire', sens: 'debit', montant: 6000, source_nom: 'balance.csv',
    source_empreinte: 'a'.repeat(64), created_at: '2026-09-26T10:00:00Z', ...o,
  })

  it('compte les à-nouveaux avec les écritures, et nomme un compte que seule la balance reprise connaît', () => {
    const balance = calculerBalance(
      [ecriture({ compte: COMPTE_BANQUE, sens: 'credit', montant: 120 })],
      [],
      [aNouveau({}), aNouveau({ id: 'an-2', compte: '164', compte_origine: '164', libelle: 'Emprunts', sens: 'credit', montant: 6000 })],
    )
    expect(balance).toEqual([
      { compte: '164', libelle: 'Emprunts', nbEcritures: 1, totalDebit: 0, totalCredit: 6000, solde: -6000 },
      // La banque garde son nom d'application, pas celui de la banque d'origine.
      { compte: COMPTE_BANQUE, libelle: 'Banque', nbEcritures: 2, totalDebit: 6000, totalCredit: 120, solde: 5880 },
    ])
  })

  it('ne laisse pas le libellé d’une balance reprise masquer celui d’une catégorie', () => {
    const categories = [{ compte_comptable: '164', libelle: 'Emprunts bancaires' } as Categorie]
    const balance = calculerBalance([], categories, [aNouveau({ compte: '164', libelle: 'EMPRUNT CA', sens: 'credit' })])
    expect(balance[0].libelle).toBe('Emprunts bancaires')
  })
})

const categorie = (o: Partial<Categorie> = {}): Categorie => ({
  id: 'c1', dossier_id: null, code: 'achats_fournisseurs', libelle: 'Achats', ordre: 1,
  compte_comptable: ACHATS, poste_2035: 'Achats', ...o,
} as Categorie)

describe('piecesAComptabiliser', () => {
  const cats = [categorie(), categorie({ id: 'c2', compte_comptable: null })]

  it('rend le compte de la catégorie de chaque pièce', () => {
    expect(piecesAComptabiliser([piece()], cats, new Set())).toEqual([{ piece: piece(), compte: ACHATS }])
  })

  it('écarte les trois portes de la chaîne comptable', () => {
    const ecartees = [
      piece({ id: 'sans-cat', categorie_id: null }),
      piece({ id: 'cat-sans-compte', categorie_id: 'c2' }),
      piece({ id: 'sans-montant', montant_ttc: null }),
    ]
    expect(piecesAComptabiliser(ecartees, cats, new Set())).toEqual([])
  })

  it("écarte une pièce enregistrée en immobilisation — c'est un actif, pas une charge", () => {
    expect(piecesAComptabiliser([piece({ id: 'immo' })], cats, new Set(['immo']))).toEqual([])
  })
})

describe('piecesDesynchronisees — le compte autant que le montant', () => {
  const p = piece({ id: 'recat', montant_ttc: 120 })

  it('signale une pièce recatégorisée, dont le montant n’a pourtant pas bougé', () => {
    // LE CAS QUI NE DÉPLACE AUCUN TOTAL. L'écriture reste sur l'ancien compte, le montant est le
    // même au centime près : un contrôle qui ne compare que le montant la déclare synchronisée,
    // et le FEC part sur un compte que la pièce ne désigne plus.
    const lignes = [ecriture({ piece_id: 'recat', compte: ACHATS, sens: 'debit', montant: 120 })]
    expect(analyserEcritures(lignes, [{ piece: p, compte: '613200' }], true, [], TRESORERIE).piecesDesynchronisees).toEqual([p])
    // Et le même jeu sur le bon compte ne bouge pas : c'est ce qui rend le cas ci-dessus distinctif.
    expect(analyserEcritures(lignes, [{ piece: p, compte: ACHATS }], true, [], TRESORERIE).piecesDesynchronisees).toEqual([])
  })

  it('ne prend pas les comptes de TVA pour un autre compte', () => {
    // Sinon TOUTE pièce portant de la TVA serait déclarée désynchronisée, et le contrôle
    // deviendrait inécoutable dès la première facture au taux normal.
    // La pièce DÉCLARE sa TVA (le jeu d'essai portait 20 € au brouillon sur une pièce dont
    // `montant_tva` est nul — une combinaison que `lignesChargeProduitPourPiece` ne produit jamais,
    // et que le contrôle de ventilation ci-dessous signale à juste titre).
    const avecTva = [
      ecriture({ piece_id: 'recat', compte: ACHATS, sens: 'debit', montant: 100 }),
      ecriture({ piece_id: 'recat', compte: COMPTE_TVA_DEDUCTIBLE, sens: 'debit', montant: 20 }),
    ]
    const ventilee = piece({ id: 'recat', montant_ht: 100, montant_tva: 20, montant_ttc: 120 })
    expect(analyserEcritures(avecTva, [{ piece: ventilee, compte: ACHATS }], true, [], TRESORERIE).piecesDesynchronisees).toEqual([])
  })

  it('ne regarde pas la contrepartie banque, qui vit sur son propre compte', () => {
    const complete = [
      ecriture({ piece_id: 'recat', compte: ACHATS, sens: 'debit', montant: 120 }),
      ecriture({ piece_id: 'recat', compte: COMPTE_BANQUE, sens: 'credit', montant: 120 }),
    ]
    expect(analyserEcritures(complete, [{ piece: p, compte: ACHATS }], true, [], TRESORERIE).piecesDesynchronisees).toEqual([])
  })
})

describe('piecesDesynchronisees — la ventilation de la TVA, que le total ne peut pas voir', () => {
  it('signale une TVA corrigée à TTC constant — total identique, comptes identiques', () => {
    // LE CAS DÉMONTRÉ SUR UNE PIÈCE RÉELLE DU SCHÉMA : 57,00 € portés en charge entière alors que la
    // pièce annonce 50,91 + 6,09 de TVA. Les deux lignes attendues se compensent exactement, donc le
    // total du groupe ne bouge pas d'un centime et le compte est le bon : ni la comparaison de
    // montant ni celle de compte ne peut en dire un mot. La charge et la TVA déductible partent
    // pourtant FAUSSES en FEC et en balance, à somme juste.
    const p = piece({ id: 'tva', montant_ht: 50.91, montant_tva: 6.09, montant_ttc: 57 })
    const nonVentilee = [ecriture({ piece_id: 'tva', compte: ACHATS, sens: 'debit', montant: 57 })]
    expect(analyserEcritures(nonVentilee, [{ piece: p, compte: ACHATS }], true, [], TRESORERIE).piecesDesynchronisees).toEqual([p])

    // Le garde symétrique : correctement ventilée, elle ne bouge pas. Sans lui, le test ci-dessus
    // serait satisfait par un contrôle qui signale toute pièce portant de la TVA.
    const ventilee = [
      ecriture({ piece_id: 'tva', compte: ACHATS, sens: 'debit', montant: 50.91 }),
      ecriture({ piece_id: 'tva', compte: COMPTE_TVA_DEDUCTIBLE, sens: 'debit', montant: 6.09 }),
    ]
    expect(analyserEcritures(ventilee, [{ piece: p, compte: ACHATS }], true, [], TRESORERIE).piecesDesynchronisees).toEqual([])
  })

  it('voit aussi une TVA EFFACÉE après coup, dont la ligne survit', () => {
    // Le cas inverse, et le total est encore juste : la pièce ne porte plus de TVA, l'écriture en
    // garde une. `montant_tva` nul vaut 0 attendu, ce qui couvre l'ajout et l'effacement d'un coup.
    const p = piece({ id: 'effacee', montant_ht: null, montant_tva: null, montant_ttc: 120 })
    const lignes = [
      ecriture({ piece_id: 'effacee', compte: ACHATS, sens: 'debit', montant: 100 }),
      ecriture({ piece_id: 'effacee', compte: COMPTE_TVA_DEDUCTIBLE, sens: 'debit', montant: 20 }),
    ]
    expect(analyserEcritures(lignes, [{ piece: p, compte: ACHATS }], true, [], TRESORERIE).piecesDesynchronisees).toEqual([p])
  })

  it('compte la TVA COLLECTÉE d’une vente comme la déductible d’un achat', () => {
    // Une vente ventile sur 445710, pas 445660. Ne regarder qu'un seul des deux comptes rendrait le
    // contrôle aveugle sur la moitié des pièces — et bavard sur l'autre.
    const p = piece({ id: 'vente', type_piece: 'vente', montant_ht: 100, montant_tva: 20, montant_ttc: 120 })
    const justes = [
      ecriture({ piece_id: 'vente', compte: VENTES, sens: 'credit', montant: 100 }),
      ecriture({ piece_id: 'vente', compte: COMPTE_TVA_COLLECTEE, sens: 'credit', montant: 20 }),
    ]
    expect(analyserEcritures(justes, [{ piece: p, compte: VENTES }], true, [], TRESORERIE).piecesDesynchronisees).toEqual([])
  })

  it('ne prend pas un avoir correctement ventilé pour un écart', () => {
    // Ses lignes sont au sens INVERSE du sens naturel de la pièce (voir lignesChargeProduitPourPiece).
    // Une somme non signée de la TVA conclurait à -20 contre +20 attendu, soit un faux positif sur
    // chaque avoir portant de la TVA.
    const p = piece({ id: 'avoir', montant_ht: -100, montant_tva: -20, montant_ttc: -120 })
    const lignes = [
      ecriture({ piece_id: 'avoir', compte: ACHATS, sens: 'credit', montant: 100 }),
      ecriture({ piece_id: 'avoir', compte: COMPTE_TVA_DEDUCTIBLE, sens: 'credit', montant: 20 }),
    ]
    expect(analyserEcritures(lignes, [{ piece: p, compte: ACHATS }], true, [], TRESORERIE).piecesDesynchronisees).toEqual([])
  })
})

describe('piecesDesynchronisees — la date, qui déplace l’écriture d’EXERCICE', () => {
  it('signale une pièce datée APRÈS coup, dont ni le montant ni le compte n’ont bougé', () => {
    // LE CHEMIN RÉEL DES GESTES. Une pièce validée sans date reçoit une écriture datée de son DÉPÔT
    // (le repli de lignesChargeProduitPourPiece). « Retrouver les dates manquantes » écrit ensuite
    // `date_piece` et RIEN D'AUTRE — c'est ce qui la rend sûre à lancer sur un dossier relu à la
    // main — donc personne ne réconcilie l'écriture. Corriger la date à la main fait pareil.
    const datee = piece({ id: 'datee', date_piece: '2025-03-14', created_at: '2026-09-16T09:00:00Z' })
    const lignes = [ecriture({ piece_id: 'datee', date: '2026-09-16', compte: ACHATS, sens: 'debit', montant: 120 })]
    expect(analyserEcritures(lignes, [{ piece: datee, compte: ACHATS }], true, [], TRESORERIE).piecesDesynchronisees).toEqual([datee])

    // Le cas symétrique, sans lequel le test ci-dessus serait satisfait par un contrôle qui signale
    // tout : la même écriture à la bonne date ne bouge pas.
    const aJour = [ecriture({ piece_id: 'datee', date: '2025-03-14', compte: ACHATS, sens: 'debit', montant: 120 })]
    expect(analyserEcritures(aJour, [{ piece: datee, compte: ACHATS }], true, [], TRESORERIE).piecesDesynchronisees).toEqual([])
  })

  it('ne déplace aucun total — c’est pour ça que rien d’autre ne peut le voir', () => {
    // Le montant est le même au centime, le compte est le même : ni groupesDesequilibres ni la
    // comparaison de montant ne peuvent rien en dire. Seule la DATE diffère, et elle décide de
    // l'exercice — `ecrituresFiltrees` et le FEC lisent la date de l'ÉCRITURE, pendant que Clôture
    // et la 2035 lisent celle de la PIÈCE. Deux livrables, deux années, aucun signal.
    const p = piece({ id: 'exercice', date_piece: '2025-12-28' })
    const lignes = [
      ecriture({ piece_id: 'exercice', date: '2026-01-04', compte: ACHATS, sens: 'debit', montant: 100 }),
      ecriture({ piece_id: 'exercice', date: '2026-01-04', compte: COMPTE_TVA_DEDUCTIBLE, sens: 'debit', montant: 20 }),
      ecriture({ piece_id: 'exercice', date: '2026-01-04', compte: COMPTE_BANQUE, sens: 'credit', montant: 120 }),
    ]
    const analyse = analyserEcritures(lignes, [{ piece: p, compte: ACHATS }], true, [], TRESORERIE)
    expect(analyse.groupesDesequilibres).toEqual([]) // équilibré : le montant n'a pas bougé
    expect(analyse.piecesDesynchronisees).toEqual([p])
  })

  it('se tait sur une pièce SANS date — il n’y a rien à contredire', () => {
    // Une pièce sans date ne prétend à aucun exercice (même arbitrage que la feuille « Pièces sans
    // date » d'un pack). Comparer son écriture au repli ferait pire que rien : `dateLocaleDe` lit un
    // INSTANT, donc une écriture générée dans un autre fuseau que celui qui la relit serait déclarée
    // désynchronisée à tort — un avertissement qui se trompe emporte ses voisins qui, eux, disent vrai.
    const sansDate = piece({ id: 'sans-date', date_piece: null, created_at: '2026-09-16T23:30:00Z' })
    const lignes = [ecriture({ piece_id: 'sans-date', date: '2026-09-17', compte: ACHATS, sens: 'debit', montant: 120 })]
    expect(analyserEcritures(lignes, [{ piece: sansDate, compte: ACHATS }], true, [], TRESORERIE).piecesDesynchronisees).toEqual([])
  })

  it('suffit d’UNE ligne en retard — le sens sûr, et il est défensif', () => {
    // Les dates présentes doivent être EXACTEMENT celles attendues. Une pièce réglée en partie porte
    // légitimement deux dates (voir plus bas) ; ici une seule est attendue, et une ligne à une autre
    // date est un groupe à moitié périmé — le seul état où le brouillon se contredit lui-même.
    // Le contrôle qui parle trop se corrige ; celui qui se tait ne se voit pas.
    const p = piece({ id: 'moitie', date_piece: '2025-06-30' })
    const lignes = [
      ecriture({ piece_id: 'moitie', date: '2025-06-30', compte: ACHATS, sens: 'debit', montant: 100 }),
      ecriture({ piece_id: 'moitie', date: '2026-09-16', compte: COMPTE_TVA_DEDUCTIBLE, sens: 'debit', montant: 20 }),
    ]
    expect(analyserEcritures(lignes, [{ piece: p, compte: ACHATS }], true, [], TRESORERIE).piecesDesynchronisees).toEqual([p])
  })

  it('ne compte pas la date de la contrepartie banque, qui est celle du PAIEMENT', () => {
    // Elle diffère de la date de la facture presque toujours — la retenir déclarerait désynchronisée
    // chaque pièce rapprochée du dossier, c'est-à-dire exactement celles qui sont en ordre.
    const p = piece({ id: 'payee', date_piece: '2026-03-10' })
    const lignes = [
      ecriture({ piece_id: 'payee', date: '2026-03-10', compte: ACHATS, sens: 'debit', montant: 120 }),
      ecriture({ piece_id: 'payee', date: '2026-04-05', compte: COMPTE_BANQUE, sens: 'credit', montant: 120 }),
    ]
    expect(analyserEcritures(lignes, [{ piece: p, compte: ACHATS }], true, [], TRESORERIE).piecesDesynchronisees).toEqual([])
  })
})

describe('piecesDesynchronisees — la date du PAIEMENT, quand le rapprochement la connaît', () => {
  const decembre = piece({ id: 'p1', date_piece: '2025-12-20', montant_ttc: 120 })
  const aComptabiliser = [{ piece: decembre, compte: ACHATS }]

  it('signale une écriture restée à la date de facture alors que le paiement est connu', () => {
    // Le cas de toute écriture générée avant son rapprochement : elle compterait dans l'exercice de la
    // facture pendant que la 2035 la compte dans celui du paiement.
    const aLaFacture = [ecriture({ date: '2025-12-20' })]
    expect(analyserEcritures(aLaFacture, aComptabiliser, true, [paiement()], TRESORERIE).piecesDesynchronisees).toEqual([decembre])
    // Le garde symétrique : datée au paiement, elle est à jour.
    const auPaiement = [ecriture({ date: '2026-01-05' })]
    expect(analyserEcritures(auPaiement, aComptabiliser, true, [paiement()], TRESORERIE).piecesDesynchronisees).toEqual([])
  })

  it('accepte une pièce réglée en partie répartie sur ses deux dates, et elle seule', () => {
    const payee = [paiement({ montant: -48 })]
    const reparties = lignesChargeProduitPourPiece('d1', decembre, ACHATS, true, payee)
      .map((l, i) => ecriture({ ...l, id: `e${i}` }))
    expect(analyserEcritures(reparties, aComptabiliser, true, payee, TRESORERIE).piecesDesynchronisees).toEqual([])
    // Toute l'écriture passée au paiement — ce que ferait un rapprochement qui ignorerait la part
    // restante : la part non payée quitterait l'exercice de la facture.
    const toutAuPaiement = [ecriture({ date: '2026-01-05' })]
    expect(analyserEcritures(toutAuPaiement, aComptabiliser, true, payee, TRESORERIE).piecesDesynchronisees).toEqual([decembre])
  })

  it('se tait quand une part n’a pas de date — le repli sur le dépôt est un instant', () => {
    const sansDate = piece({ id: 'p1', date_piece: null, montant_ttc: 120 })
    const lignes = [ecriture({ date: '2026-01-05', montant: 60 }), ecriture({ id: 'e2', date: '2025-12-21', montant: 60 })]
    expect(analyserEcritures(lignes, [{ piece: sansDate, compte: ACHATS }], true, [paiement({ montant: -60 })], TRESORERIE).piecesDesynchronisees).toEqual([])
  })

  it('ne se laisse pas dater par un mouvement qui n’est plus rapproché', () => {
    const remis = [paiement({ statut: 'non_rapprochee' })]
    expect(analyserEcritures([ecriture({ date: '2025-12-20' })], aComptabiliser, true, remis, TRESORERIE).piecesDesynchronisees).toEqual([])
  })
})

describe('ecrituresSansObjet', () => {
  const cats = [categorie(), categorie({ id: 'c2', compte_comptable: null })]

  it('voit la charge qu’une pièce devenue immobilisation continue de compter', () => {
    // L'ordre naturel des gestes : générer, puis découvrir en ouvrant Immobilisations que cet achat
    // est un actif. Rien ne retire l'écriture, et les trois autres contrôles partent de la pièce
    // ÉLIGIBLE — dont celle-ci vient précisément de sortir.
    const lignes = [
      ecriture({ piece_id: 'immo', compte: ACHATS, sens: 'debit', montant: 100 }),
      ecriture({ piece_id: 'immo', compte: COMPTE_TVA_DEDUCTIBLE, sens: 'debit', montant: 20 }),
      ecriture({ piece_id: 'immo', compte: COMPTE_BANQUE, sens: 'credit', montant: 120 }),
    ]
    const p = piece({ id: 'immo' })
    expect(ecrituresSansObjet(lignes, [p], cats, new Set(['immo']))).toEqual([
      // La contrepartie banque est exclue : elle reflète un mouvement RÉEL, qui a bien eu lieu.
      { piece: p, motif: 'immobilisee', nbLignes: 2, montant: 120 },
    ])
    // Les trois contrôles qui partent de la pièce n'en voient rien.
    const analyse = analyserEcritures(lignes, piecesAComptabiliser([p], cats, new Set(['immo'])), true, [], TRESORERIE)
    expect(analyse.piecesDesynchronisees).toEqual([])
    expect(analyse.groupesDesequilibres).toEqual([])
    expect(analyse.nbSansContrepartie).toBe(0)
  })

  it('nomme le motif plutôt que de laisser deviner', () => {
    const cas: [Partial<Piece>, string][] = [
      [{ id: 'a', categorie_id: null }, 'sans_categorie'],
      [{ id: 'b', categorie_id: 'c2' }, 'categorie_sans_compte'],
      [{ id: 'c', montant_ttc: null }, 'sans_montant'],
    ]
    for (const [modif, motif] of cas) {
      const p = piece(modif)
      const lignes = [ecriture({ piece_id: p.id, compte: ACHATS })]
      expect(ecrituresSansObjet(lignes, [p], cats, new Set())[0]?.motif, motif).toBe(motif)
    }
  })

  it('se tait quand la pièce est introuvable — filtrage ou lien nul, jamais une rupture d’ici', () => {
    // Les deux entrées passent par le MÊME garde-fou (`piece` introuvable), et c'est pour ça
    // qu'elles sont dans un seul test : une mutation retirant le test de `piece_id` nul survit,
    // puisque la clé de regroupement devient alors `null` et qu'aucune pièce ne porte cet id. Ce
    // test-là ne garde donc pas deux choses, il garde une entrée de plus sur le même chemin.
    //
    // - « ailleurs » : l'appelant ne charge que les pièces VALIDÉES, donc une pièce repassée « à
    //   valider » tomberait ici. Crier au loup dessus rendrait les avertissements voisins
    //   inécoutables — c'est un artefact de chargement, pas un défaut comptable.
    // - `piece_id` nul : le lien a été effacé par un ON DELETE SET NULL, et c'est le domaine de
    //   rupturesPisteAudit (lib/pisteAudit.ts). Le dire deux fois ferait compter le même défaut
    //   deux fois en Checklist.
    expect(ecrituresSansObjet([ecriture({ piece_id: 'ailleurs', compte: ACHATS })], [], cats, new Set())).toEqual([])
    expect(ecrituresSansObjet([ecriture({ piece_id: null, compte: ACHATS })], [piece()], cats, new Set())).toEqual([])
  })

  it('se tait sur une pièce parfaitement comptabilisable', () => {
    const p = piece()
    expect(ecrituresSansObjet([ecriture({ piece_id: p.id })], [p], cats, new Set())).toEqual([])
  })
})

// ═══ Engagement (lib/engagement.ts) ═══════════════════════════════════════════════════════════════
const ENGAGEMENT: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000' }

// Les lignes que la génération écrit, telles que la base les rend : c'est contre elles que le contrôle
// doit se taire — un contrôle vérifié sur des lignes écrites à la main pourrait l'être sur des lignes
// que l'application ne produit jamais.
const enBase = (lignes: LigneAGenerer[]): EcritureBrouillon[] =>
  lignes.map((l, i) => ecriture({ ...l, id: `g${i}`, ligne_bancaire_id: l.ligne_bancaire_id ?? null }))

describe('lignesPourPiece — la génération suit le modèle du dossier', () => {
  it('produit en trésorerie exactement ce que produisait lignesChargeProduitPourPiece', () => {
    const p = piece({ montant_ttc: 120, montant_tva: 20 })
    const payee = [paiement()]
    expect(lignesPourPiece('d1', p, ACHATS, true, payee, TRESORERIE)).toEqual(lignesChargeProduitPourPiece('d1', p, ACHATS, true, payee))
  })

  it('produit en engagement la facture à sa date et un règlement par mouvement', () => {
    const p = piece({ montant_ttc: 120, montant_tva: 20 })
    expect(lignesPourPiece('d1', p, ACHATS, true, [paiement()], ENGAGEMENT))
      .toEqual(lignesEngagementPourPiece('d1', p, ACHATS, true, '455000', [paiement()]))
  })
})

describe('analyserEcritures — en engagement', () => {
  const p = piece({ id: 'p1', date_piece: '2025-12-20', montant_ht: 100, montant_tva: 20, montant_ttc: 120 })
  const aComptabiliser = [{ piece: p, compte: ACHATS }]
  const genere = (piecePassee: Piece = p, mouvements: LigneBancaire[] = [paiement()]) =>
    enBase(lignesEngagementPourPiece('d1', piecePassee, ACHATS, true, '455000', mouvements))

  it('se tait sur une facture et son règlement tels que la génération les écrit', () => {
    const analyse = analyserEcritures(genere(), aComptabiliser, true, [paiement()], ENGAGEMENT)
    expect(analyse).toEqual({ nbSansContrepartie: 0, groupesDesequilibres: [], piecesDesynchronisees: [] })
  })

  it('compte une facture sans règlement comme en attente de rapprochement, sans la dire périmée', () => {
    const analyse = analyserEcritures(genere(p, []), aComptabiliser, true, [], ENGAGEMENT)
    expect(analyse.nbSansContrepartie).toBe(1)
    expect(analyse.piecesDesynchronisees).toEqual([])
  })

  it('garde la facture à SA date quand le paiement tombe dans l’exercice suivant', () => {
    // Le cœur du modèle : la facture de décembre reste en décembre, seul le règlement passe en janvier.
    const lignes = genere()
    expect(lignes.filter((l) => !l.ligne_bancaire_id).map((l) => l.date)).toEqual(['2025-12-20', '2025-12-20', '2025-12-20'])
    expect(lignes.filter((l) => l.ligne_bancaire_id).map((l) => l.date)).toEqual(['2026-01-05', '2026-01-05'])
  })

  it('juge chaque écriture seule : un frais bancaire ne déséquilibre rien, il reste au 401', () => {
    // En trésorerie, ce même écart déséquilibrerait le groupe de la pièce.
    const frais = [paiement({ montant: -118.5 })]
    const analyse = analyserEcritures(genere(p, frais), aComptabiliser, true, frais, ENGAGEMENT)
    expect(analyse.groupesDesequilibres).toEqual([])
    expect(analyse.piecesDesynchronisees).toEqual([])
  })

  it('dit déséquilibrée une facture dont la TVA ne recoupe pas le TTC', () => {
    const fausse = piece({ id: 'p1', date_piece: '2025-12-20', montant_ht: 100, montant_tva: 30, montant_ttc: 120 })
    const analyse = analyserEcritures(genere(fausse), [{ piece: fausse, compte: ACHATS }], true, [paiement()], ENGAGEMENT)
    expect(analyse.groupesDesequilibres).toEqual([{ pieceId: 'p1', solde: 10 }])
  })

  it('voit un règlement déséquilibré que la somme du groupe masquerait', () => {
    // Deux écarts de signes opposés : le groupe entier s'équilibre, chacune de ses écritures non.
    // Facture : 120 au débit, 130 au crédit du 401 (−10). Règlement : 130 au débit du 401, 120 au
    // crédit de la banque (+10). La pièce entière solde à zéro.
    const lignes = genere()
    lignes.find((l) => l.compte === COMPTE_FOURNISSEURS && !l.ligne_bancaire_id)!.montant = 130
    lignes.find((l) => l.compte === COMPTE_FOURNISSEURS && l.ligne_bancaire_id)!.montant = 130
    expect(lignes.reduce((s, l) => s + (l.sens === 'debit' ? l.montant : -l.montant), 0)).toBe(0)
    const analyse = analyserEcritures(lignes, aComptabiliser, true, [paiement()], ENGAGEMENT)
    expect(analyse.groupesDesequilibres).toEqual([{ pieceId: 'p1', solde: -10 }])
  })

  it('signale un mouvement rapproché dont le règlement manque — la dette resterait ouverte au 401', () => {
    const analyse = analyserEcritures(genere(p, []), aComptabiliser, true, [paiement()], ENGAGEMENT)
    expect(analyse.piecesDesynchronisees).toEqual([p])
  })

  it('signale un règlement que plus aucun rapprochement ne justifie', () => {
    const analyse = analyserEcritures(genere(), aComptabiliser, true, [paiement({ statut: 'non_rapprochee' })], ENGAGEMENT)
    expect(analyse.piecesDesynchronisees).toEqual([p])
  })

  it('signale une pièce devenue note de frais : sa dette quitte le 401 pour le compte du dossier', () => {
    const noteDeFrais = { ...p, type_piece: 'note_frais' as const }
    const analyse = analyserEcritures(genere(), [{ piece: noteDeFrais, compte: ACHATS }], true, [paiement()], ENGAGEMENT)
    expect(analyse.piecesDesynchronisees).toEqual([noteDeFrais])
  })

  it('signale un règlement resté sur l’ancien compte de tiers, même quand la facture est à jour', () => {
    const noteDeFrais = { ...p, type_piece: 'note_frais' as const }
    const lignes = [
      ...enBase(lignesFactureEngagement('d1', noteDeFrais, ACHATS, true, '455000')),
      ...enBase(lignesReglementEngagement('d1', p, paiement(), '455000')).map((l) => ({ ...l, id: `r-${l.id}` })),
    ]
    const analyse = analyserEcritures(lignes, [{ piece: noteDeFrais, compte: ACHATS }], true, [paiement()], ENGAGEMENT)
    expect(analyse.piecesDesynchronisees).toEqual([noteDeFrais])
  })

  it('signale une date, un montant ou une TVA changés sur la pièce, comme en trésorerie', () => {
    for (const modifiee of [
      { ...p, date_piece: '2025-12-21' },
      { ...p, montant_ht: 110, montant_ttc: 130 },
      { ...p, montant_ht: 110, montant_tva: 10 },
    ]) {
      const analyse = analyserEcritures(genere(), [{ piece: modifiee, compte: ACHATS }], true, [paiement()], ENGAGEMENT)
      expect(analyse.piecesDesynchronisees, JSON.stringify(modifiee)).toEqual([modifiee])
    }
  })

  it('signale une recatégorisation, et une facture datée au paiement comme en trésorerie', () => {
    expect(analyserEcritures(genere(), [{ piece: p, compte: '613200' }], true, [paiement()], ENGAGEMENT).piecesDesynchronisees).toEqual([p])
    const auPaiement = genere().map((l) => (l.ligne_bancaire_id ? l : { ...l, date: '2026-01-05' }))
    expect(analyserEcritures(auPaiement, aComptabiliser, true, [paiement()], ENGAGEMENT).piecesDesynchronisees).toEqual([p])
  })

  it('voit une ligne de la facture qui ne porte plus son montant — cas défensif', () => {
    // Deux totaux, deux contrôles : la charge avec sa TVA, et le compte de tiers. Un changement de TTC
    // fausse les deux ensemble, donc seule une ligne réécrite à part distingue l'un de l'autre. La
    // génération ne produit jamais ces lignes ; une écriture reprise à la main, si.
    const tiersFaux = genere()
    tiersFaux.find((l) => l.compte === COMPTE_FOURNISSEURS && !l.ligne_bancaire_id)!.montant = 110
    expect(analyserEcritures(tiersFaux, aComptabiliser, true, [paiement()], ENGAGEMENT).piecesDesynchronisees).toEqual([p])
    const chargeFausse = genere()
    chargeFausse.find((l) => l.compte === ACHATS)!.montant = 110
    expect(analyserEcritures(chargeFausse, aComptabiliser, true, [paiement()], ENGAGEMENT).piecesDesynchronisees).toEqual([p])
  })

  it('signale des règlements sans leur facture — la génération ne les produit jamais ainsi', () => {
    const reglementsSeuls = genere().filter((l) => l.ligne_bancaire_id)
    expect(analyserEcritures(reglementsSeuls, aComptabiliser, true, [paiement()], ENGAGEMENT).piecesDesynchronisees).toEqual([p])
  })

  it('se tait sur une pièce sans date, dont la facture est au dépôt — comme en trésorerie', () => {
    const sansDate = { ...p, date_piece: null }
    const analyse = analyserEcritures(genere(sansDate), [{ piece: sansDate, compte: ACHATS }], true, [paiement()], ENGAGEMENT)
    expect(analyse.piecesDesynchronisees).toEqual([])
  })

  it('exige le bon modèle : lu dans l’autre, chaque brouillon juste paraît périmé', () => {
    // C'est pour ça que le modèle n'a pas de valeur par défaut.
    const tresorerie = enBase(lignesChargeProduitPourPiece('d1', p, ACHATS, true, [paiement()]))
    expect(analyserEcritures(tresorerie, aComptabiliser, true, [paiement()], ENGAGEMENT).piecesDesynchronisees).toEqual([p])
    expect(analyserEcritures(genere(), aComptabiliser, true, [paiement()], TRESORERIE).piecesDesynchronisees).toEqual([p])
  })
})

describe('ecrituresSansObjet — en engagement', () => {
  it('compte la charge et la TVA d’une facture immobilisée, pas sa dette ni ses règlements', () => {
    const p = piece({ id: 'immo', montant_ht: 100, montant_tva: 20, montant_ttc: 120 })
    const lignes = enBase(lignesEngagementPourPiece('d1', p, ACHATS, true, '455000', [paiement({ piece_id: 'immo' })]))
    expect(ecrituresSansObjet(lignes, [p], [categorie()], new Set(['immo']))).toEqual([
      { piece: p, motif: 'immobilisee', nbLignes: 2, montant: 120 },
    ])
  })
})

describe('calculerBalance — les comptes de tiers', () => {
  it('nomme les comptes que l’engagement mouvemente', () => {
    const balance = calculerBalance(
      ['401000', '411000', '455000', '108000', '467000'].map((compte) => ecriture({ compte })), [], [],
    )
    expect(balance.map((l) => l.libelle)).toEqual([
      "Compte de l'exploitant", 'Fournisseurs', 'Clients', 'Associés — comptes courants', 'Autres comptes débiteurs ou créditeurs',
    ])
  })
})
