import { describe, expect, it } from 'vitest'
import { analyserEcritures, calculerBalance, ecrituresSansObjet, lignesChargeProduitPourPiece, piecesAComptabiliser, soldeCompte, tvaNettePourPeriode } from './ecritures'
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
    expect(analyserEcritures(lignes, [{ piece: p, compte: ACHATS }]).piecesDesynchronisees).toEqual([p])
  })

  it('ne déclare pas désynchronisée une pièce à montant négatif correctement enregistrée', () => {
    // Ses lignes sont au sens inverse du sens naturel de la pièce : une somme non signée
    // conclurait à tort à un écart.
    const avoir = piece({ id: 'avoir', montant_ttc: -50 })
    const lignes = [ecriture({ piece_id: 'avoir', compte: ACHATS, sens: 'credit', montant: 50 })]
    expect(analyserEcritures(lignes, [{ piece: avoir, compte: ACHATS }]).piecesDesynchronisees).toEqual([])
  })

  it('ne déclare pas désynchronisée une pièce sans écriture encore générée', () => {
    expect(analyserEcritures([], [{ piece: piece({ id: 'vierge' }), compte: ACHATS }]).piecesDesynchronisees).toEqual([])
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
    expect(analyserEcritures(lignes, [{ piece: p, compte: '613200' }]).piecesDesynchronisees).toEqual([p])
    // Et le même jeu sur le bon compte ne bouge pas : c'est ce qui rend le cas ci-dessus distinctif.
    expect(analyserEcritures(lignes, [{ piece: p, compte: ACHATS }]).piecesDesynchronisees).toEqual([])
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
    expect(analyserEcritures(avecTva, [{ piece: ventilee, compte: ACHATS }]).piecesDesynchronisees).toEqual([])
  })

  it('ne regarde pas la contrepartie banque, qui vit sur son propre compte', () => {
    const complete = [
      ecriture({ piece_id: 'recat', compte: ACHATS, sens: 'debit', montant: 120 }),
      ecriture({ piece_id: 'recat', compte: COMPTE_BANQUE, sens: 'credit', montant: 120 }),
    ]
    expect(analyserEcritures(complete, [{ piece: p, compte: ACHATS }]).piecesDesynchronisees).toEqual([])
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
    expect(analyserEcritures(nonVentilee, [{ piece: p, compte: ACHATS }]).piecesDesynchronisees).toEqual([p])

    // Le garde symétrique : correctement ventilée, elle ne bouge pas. Sans lui, le test ci-dessus
    // serait satisfait par un contrôle qui signale toute pièce portant de la TVA.
    const ventilee = [
      ecriture({ piece_id: 'tva', compte: ACHATS, sens: 'debit', montant: 50.91 }),
      ecriture({ piece_id: 'tva', compte: COMPTE_TVA_DEDUCTIBLE, sens: 'debit', montant: 6.09 }),
    ]
    expect(analyserEcritures(ventilee, [{ piece: p, compte: ACHATS }]).piecesDesynchronisees).toEqual([])
  })

  it('voit aussi une TVA EFFACÉE après coup, dont la ligne survit', () => {
    // Le cas inverse, et le total est encore juste : la pièce ne porte plus de TVA, l'écriture en
    // garde une. `montant_tva` nul vaut 0 attendu, ce qui couvre l'ajout et l'effacement d'un coup.
    const p = piece({ id: 'effacee', montant_ht: null, montant_tva: null, montant_ttc: 120 })
    const lignes = [
      ecriture({ piece_id: 'effacee', compte: ACHATS, sens: 'debit', montant: 100 }),
      ecriture({ piece_id: 'effacee', compte: COMPTE_TVA_DEDUCTIBLE, sens: 'debit', montant: 20 }),
    ]
    expect(analyserEcritures(lignes, [{ piece: p, compte: ACHATS }]).piecesDesynchronisees).toEqual([p])
  })

  it('compte la TVA COLLECTÉE d’une vente comme la déductible d’un achat', () => {
    // Une vente ventile sur 445710, pas 445660. Ne regarder qu'un seul des deux comptes rendrait le
    // contrôle aveugle sur la moitié des pièces — et bavard sur l'autre.
    const p = piece({ id: 'vente', type_piece: 'vente', montant_ht: 100, montant_tva: 20, montant_ttc: 120 })
    const justes = [
      ecriture({ piece_id: 'vente', compte: VENTES, sens: 'credit', montant: 100 }),
      ecriture({ piece_id: 'vente', compte: COMPTE_TVA_COLLECTEE, sens: 'credit', montant: 20 }),
    ]
    expect(analyserEcritures(justes, [{ piece: p, compte: VENTES }]).piecesDesynchronisees).toEqual([])
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
    expect(analyserEcritures(lignes, [{ piece: p, compte: ACHATS }]).piecesDesynchronisees).toEqual([])
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
    expect(analyserEcritures(lignes, [{ piece: datee, compte: ACHATS }]).piecesDesynchronisees).toEqual([datee])

    // Le cas symétrique, sans lequel le test ci-dessus serait satisfait par un contrôle qui signale
    // tout : la même écriture à la bonne date ne bouge pas.
    const aJour = [ecriture({ piece_id: 'datee', date: '2025-03-14', compte: ACHATS, sens: 'debit', montant: 120 })]
    expect(analyserEcritures(aJour, [{ piece: datee, compte: ACHATS }]).piecesDesynchronisees).toEqual([])
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
    const analyse = analyserEcritures(lignes, [{ piece: p, compte: ACHATS }])
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
    expect(analyserEcritures(lignes, [{ piece: sansDate, compte: ACHATS }]).piecesDesynchronisees).toEqual([])
  })

  it('suffit d’UNE ligne en retard — le sens sûr, et il est défensif', () => {
    // CE CAS N'EST PAS PRODUCTIBLE PAR LE CODE D'AUJOURD'HUI, et le dire vaut mieux que de le
    // laisser croire : `lignesChargeProduitPourPiece` donne la MÊME date à toutes ses lignes et la
    // régénération les remplace toutes, donc un groupe à dates mélangées n'existe pas (vérifié en
    // base : 0 groupe sur les 2 du schéma). Le test fige quand même `some` plutôt qu'`every`, parce
    // que les deux ne coûtent pas la même chose le jour où un écrivain partiel apparaîtra : `every`
    // se TAIRAIT sur un groupe à moitié périmé, c'est-à-dire sur le seul état où le brouillon se
    // contredit lui-même. Le contrôle qui parle trop se corrige ; celui qui se tait ne se voit pas.
    const p = piece({ id: 'moitie', date_piece: '2025-06-30' })
    const lignes = [
      ecriture({ piece_id: 'moitie', date: '2025-06-30', compte: ACHATS, sens: 'debit', montant: 100 }),
      ecriture({ piece_id: 'moitie', date: '2026-09-16', compte: COMPTE_TVA_DEDUCTIBLE, sens: 'debit', montant: 20 }),
    ]
    expect(analyserEcritures(lignes, [{ piece: p, compte: ACHATS }]).piecesDesynchronisees).toEqual([p])
  })

  it('ne compte pas la date de la contrepartie banque, qui est celle du PAIEMENT', () => {
    // Elle diffère de la date de la facture presque toujours — la retenir déclarerait désynchronisée
    // chaque pièce rapprochée du dossier, c'est-à-dire exactement celles qui sont en ordre.
    const p = piece({ id: 'payee', date_piece: '2026-03-10' })
    const lignes = [
      ecriture({ piece_id: 'payee', date: '2026-03-10', compte: ACHATS, sens: 'debit', montant: 120 }),
      ecriture({ piece_id: 'payee', date: '2026-04-05', compte: COMPTE_BANQUE, sens: 'credit', montant: 120 }),
    ]
    expect(analyserEcritures(lignes, [{ piece: p, compte: ACHATS }]).piecesDesynchronisees).toEqual([])
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
    const analyse = analyserEcritures(lignes, piecesAComptabiliser([p], cats, new Set(['immo'])))
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
