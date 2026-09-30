import { describe, expect, it } from 'vitest'
import {
  anneesDesRattachements,
  paiementsDesPieces,
  partDansLaPeriode,
  partDeLAnnee,
  partsDesPaiements,
  piecesPayees,
  rattachements,
  rattachementsTresorerie,
  type PartReglee,
} from './rattachement'
import type { LigneBancaire, Piece } from './types'

// Jeu d'essai typé SANS `as` : le compilateur vérifie chaque champ contre la table.
function piece(o: Partial<Piece> = {}): Piece {
  return {
    id: 'p1', dossier_id: 'd1', uploaded_by: null, source: 'upload', storage_path: 'd1/p1.pdf',
    nom_fichier: 'facture.pdf', storage_hash: null, date_piece: '2025-12-20', tiers: 'Fournisseur',
    montant_ht: 1000, montant_tva: 0, montant_ttc: 1000, devise: 'EUR', montant_devise: null,
    taux_change: null, conversion_source: null, categorie_id: null, sous_dossier_id: null,
    type_piece: 'achat', statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null,
    created_at: '2025-12-21T09:00:00Z', updated_at: '2025-12-21T09:00:00Z', ...o,
  }
}

function mouvement(o: Partial<LigneBancaire> = {}): LigneBancaire {
  return {
    id: 'l1', dossier_id: 'd1', date: '2026-01-05', libelle: 'PRLV FOURNISSEUR', montant: -1000,
    statut: 'rapprochee', piece_id: 'p1', cotisation_id: null, categorie_id: null, prelevement_personnel: false,
    emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, id_externe: null,
    source_fichier: null, libelle_brut: null, created_at: '2026-01-06T09:00:00Z', ...o,
  }
}

describe('rattachementsTresorerie', () => {
  it("compte une facture de décembre réglée en janvier dans l'année du PAIEMENT", () => {
    // Le défaut d'origine : la 2035 lisait `anneeDe(date_piece)`, donc 2025 pour cette dépense payée
    // en 2026 — déduite un an trop tôt.
    const r = rattachementsTresorerie(piece(), [mouvement()])
    expect(r).toEqual([{ date: '2026-01-05', part: 1, source: 'paiement' }])
    expect(partDeLAnnee(r, 2026)).toBe(1)
    expect(partDeLAnnee(r, 2025)).toBe(0)
  })

  it("retombe sur la date de facture quand aucun paiement n'est rapproché, et le dit", () => {
    expect(rattachementsTresorerie(piece(), [])).toEqual([{ date: '2025-12-20', part: 1, source: 'sans_paiement' }])
  })

  it('compte une note de frais à sa date, sans la tenir pour un paiement manquant', () => {
    expect(rattachementsTresorerie(piece({ type_piece: 'note_frais' }), []))
      .toEqual([{ date: '2025-12-20', part: 1, source: 'note_de_frais' }])
  })

  it('compte une note de frais au paiement quand un mouvement la rattache au relevé', () => {
    expect(rattachementsTresorerie(piece({ type_piece: 'note_frais' }), [mouvement()]))
      .toEqual([{ date: '2026-01-05', part: 1, source: 'paiement' }])
  })

  it('rend une date nulle quand ni paiement ni date de pièce ne la situent', () => {
    expect(rattachementsTresorerie(piece({ date_piece: null }), [])).toEqual([{ date: null, part: 1, source: 'sans_paiement' }])
  })

  it("date une pièce SANS date de facture par son paiement, au lieu de l'écarter", () => {
    expect(rattachementsTresorerie(piece({ date_piece: null }), [mouvement()]))
      .toEqual([{ date: '2026-01-05', part: 1, source: 'paiement' }])
  })

  it('tient une recette encaissée comme une dépense payée : le sens ne change rien', () => {
    const recette = piece({ type_piece: 'vente', montant_ttc: 850 })
    expect(rattachementsTresorerie(recette, [mouvement({ montant: 850 })]))
      .toEqual([{ date: '2026-01-05', part: 1, source: 'paiement' }])
  })

  it('tient un avoir remboursé pour réglé', () => {
    const avoir = piece({ montant_ttc: -120 })
    expect(rattachementsTresorerie(avoir, [mouvement({ montant: 120 })]))
      .toEqual([{ date: '2026-01-05', part: 1, source: 'paiement' }])
  })

  it('tient pour réglée une pièce dont le paiement ne diffère que de frais sous le seuil', () => {
    // 1 000 € de pièce, 997 € débités : 3 € sous le plafond de 5 € — pas un reste à dater ailleurs.
    expect(rattachementsTresorerie(piece(), [mouvement({ montant: -997 })]))
      .toEqual([{ date: '2026-01-05', part: 1, source: 'paiement' }])
  })

  it('ne fait pas compter une pièce plus d’une fois quand des frais font payer plus', () => {
    const r = rattachementsTresorerie(piece(), [mouvement({ montant: -1003.5 })])
    expect(r).toEqual([{ date: '2026-01-05', part: 1, source: 'paiement' }])
  })

  it('juge l’écart au centime : un écart pile au seuil ne devient pas un paiement partiel', () => {
    // 256,16 − 251,16 vaut 5,000000000000028 en virgule flottante : sans l'arrondi au centime, cette
    // pièce passait pour réglée à moitié, et un reste de 5 € partait à la date de la facture.
    expect(rattachementsTresorerie(piece({ montant_ttc: 256.16 }), [mouvement({ montant: -251.16 })]))
      .toEqual([{ date: '2026-01-05', part: 1, source: 'paiement' }])
  })

  it('date à la facture le reste d’un paiement partiel, et le dit', () => {
    const r = rattachementsTresorerie(piece(), [mouvement({ montant: -400 })])
    expect(r).toEqual([
      { date: '2025-12-20', part: 0.6, source: 'sans_paiement' },
      { date: '2026-01-05', part: 0.4, source: 'paiement' },
    ])
    expect(partDeLAnnee(r, 2025) + partDeLAnnee(r, 2026)).toBeCloseTo(1, 12)
  })

  it('rend le reste sans date quand la pièce n’en porte pas', () => {
    expect(rattachementsTresorerie(piece({ date_piece: null }), [mouvement({ montant: -400 })])).toEqual([
      { date: '2026-01-05', part: 0.4, source: 'paiement' },
      { date: null, part: 0.6, source: 'sans_paiement' },
    ])
  })

  it('répartit une pièce réglée en deux fois selon la part de chaque paiement', () => {
    const r = rattachementsTresorerie(piece(), [
      mouvement({ id: 'l1', date: '2025-12-28', montant: -250 }),
      mouvement({ id: 'l2', date: '2026-01-28', montant: -750 }),
    ])
    expect(r).toEqual([
      { date: '2025-12-28', part: 0.25, source: 'paiement' },
      { date: '2026-01-28', part: 0.75, source: 'paiement' },
    ])
  })

  it('réunit deux paiements du même jour en une seule date', () => {
    const r = rattachementsTresorerie(piece(), [
      mouvement({ id: 'l1', montant: -600 }),
      mouvement({ id: 'l2', montant: -400 }),
    ])
    expect(r).toEqual([{ date: '2026-01-05', part: 1, source: 'paiement' }])
  })

  it('garde deux sources distinctes à la même date, le paiement d’abord', () => {
    const r = rattachementsTresorerie(piece({ date_piece: '2026-01-05' }), [mouvement({ montant: -400 })])
    expect(r).toEqual([
      { date: '2026-01-05', part: 0.4, source: 'paiement' },
      { date: '2026-01-05', part: 0.6, source: 'sans_paiement' },
    ])
  })

  it('rend le même ordre quel que soit l’ordre des paiements', () => {
    const a = mouvement({ id: 'l1', date: '2026-02-01', montant: -500 })
    const b = mouvement({ id: 'l2', date: '2026-01-01', montant: -500 })
    expect(rattachementsTresorerie(piece(), [a, b])).toEqual(rattachementsTresorerie(piece(), [b, a]))
    expect(rattachementsTresorerie(piece(), [a, b]).map((r) => r.date)).toEqual(['2026-01-01', '2026-02-01'])
  })

  it('tient pour réglée une pièce au montant illisible dès qu’un paiement la rattache', () => {
    expect(rattachementsTresorerie(piece({ montant_ttc: null }), [mouvement()]))
      .toEqual([{ date: '2026-01-05', part: 1, source: 'paiement' }])
  })

  it('ignore un mouvement à zéro, qui ne règle rien', () => {
    expect(rattachementsTresorerie(piece(), [mouvement({ montant: 0 })]))
      .toEqual([{ date: '2025-12-20', part: 1, source: 'sans_paiement' }])
  })
})

describe('partsDesPaiements', () => {
  it('rend un reste entier sans paiement', () => {
    expect(partsDesPaiements(piece(), [])).toEqual({ parts: [], reste: 1 })
  })

  it('rend la part de chaque paiement d’un paiement partiel, et le reste', () => {
    expect(partsDesPaiements(piece(), [mouvement({ montant: -500 })]))
      .toEqual({ parts: [{ date: '2026-01-05', part: 0.5 }], reste: 0.5 })
  })
})

describe('paiementsDesPieces', () => {
  it('ne retient que les mouvements RAPPROCHÉS qui désignent une pièce', () => {
    const lignes = [
      mouvement({ id: 'a', piece_id: 'p1' }),
      mouvement({ id: 'b', piece_id: 'p1', date: '2026-02-01' }),
      mouvement({ id: 'c', piece_id: 'p2' }),
      mouvement({ id: 'd', piece_id: null, cotisation_id: 'c1' }),
      mouvement({ id: 'e', piece_id: 'p3', statut: 'non_rapprochee' }),
      mouvement({ id: 'f', piece_id: 'p4', statut: 'ignoree' }),
    ]
    const parPiece = paiementsDesPieces(lignes, [])
    expect([...parPiece.keys()].sort()).toEqual(['p1', 'p2'])
    expect(parPiece.get('p1')).toEqual([
      { id: 'a', date: '2026-01-05', montant: -1000, origine: 'rapprochement' },
      { id: 'b', date: '2026-02-01', montant: -1000, origine: 'rapprochement' },
    ])
  })

  // Le cœur de la ligne 26 : une part est un paiement de SA pièce, à la date du mouvement et de SON
  // montant — jamais du mouvement entier, qui paie aussi les autres.
  it('rend chaque part d’un virement groupé comme un paiement de sa pièce, à la date du mouvement', () => {
    const groupe = mouvement({ id: 'g', piece_id: null, reglement_groupe: true, montant: -900, date: '2026-03-10' })
    const parts: PartReglee[] = [
      { ligne_bancaire_id: 'g', piece_id: 'p1', montant: -1000 },
      { ligne_bancaire_id: 'g', piece_id: 'p2', montant: 100 },
    ]
    const parPiece = paiementsDesPieces([groupe], parts)
    expect(parPiece.get('p1')).toEqual([{ id: 'g', date: '2026-03-10', montant: -1000, origine: 'groupe' }])
    expect(parPiece.get('p2')).toEqual([{ id: 'g', date: '2026-03-10', montant: 100, origine: 'groupe' }])
  })

  it('réunit une part et un rapprochement simple de la même pièce, triés par date', () => {
    const acompte = mouvement({ id: 'z', piece_id: 'p1', montant: -300, date: '2026-02-01' })
    const groupe = mouvement({ id: 'a', piece_id: null, reglement_groupe: true, montant: -900, date: '2026-01-15' })
    const parPiece = paiementsDesPieces([acompte, groupe], [
      { ligne_bancaire_id: 'a', piece_id: 'p1', montant: -700 },
      { ligne_bancaire_id: 'a', piece_id: 'p2', montant: -200 },
    ])
    // Par date d'abord : le virement groupé du 15 janvier avant l'acompte du 1er février, quel que soit
    // l'ordre de la lecture.
    expect(parPiece.get('p1')?.map((p) => [p.id, p.montant])).toEqual([['a', -700], ['z', -300]])
  })

  it('départage deux paiements du même jour par leur mouvement, pour rendre toujours le même ordre', () => {
    const lignes = [mouvement({ id: 'b', montant: -400 }), mouvement({ id: 'a', montant: -600 })]
    expect(paiementsDesPieces(lignes, []).get('p1')?.map((p) => p.id)).toEqual(['a', 'b'])
    expect(paiementsDesPieces([...lignes].reverse(), []).get('p1')?.map((p) => p.id)).toEqual(['a', 'b'])
  })

  // Une part ne paie que si son mouvement est LU, RAPPROCHÉ et RÉGLÉ EN GROUPE : sinon rien ne la date,
  // et `reglementsGroupesIncoherents` le dit.
  it('écarte une part dont le mouvement manque, n’est plus rapproché ou ne règle pas en groupe', () => {
    const parts: PartReglee[] = [
      { ligne_bancaire_id: 'absent', piece_id: 'p1', montant: -100 },
      { ligne_bancaire_id: 'defait', piece_id: 'p2', montant: -100 },
      { ligne_bancaire_id: 'simple', piece_id: 'p3', montant: -100 },
    ]
    const lignes = [
      mouvement({ id: 'defait', piece_id: null, reglement_groupe: true, statut: 'non_rapprochee' }),
      mouvement({ id: 'simple', piece_id: null, reglement_groupe: false }),
    ]
    expect(paiementsDesPieces(lignes, parts).size).toBe(0)
  })

  it('écarte la part d’une pièce supprimée depuis : elle ne paie plus rien', () => {
    const groupe = mouvement({ id: 'g', piece_id: null, reglement_groupe: true, montant: -300 })
    const parPiece = paiementsDesPieces([groupe], [
      { ligne_bancaire_id: 'g', piece_id: null, montant: -100 },
      { ligne_bancaire_id: 'g', piece_id: 'p2', montant: -200 },
    ])
    expect([...parPiece.keys()]).toEqual(['p2'])
  })

  it('dit payées les pièces qu’au moins un paiement règle, parts comprises', () => {
    const groupe = mouvement({ id: 'g', piece_id: null, reglement_groupe: true, montant: -300 })
    const payees = piecesPayees(paiementsDesPieces(
      [groupe, mouvement({ id: 's', piece_id: 'p9' })],
      [{ ligne_bancaire_id: 'g', piece_id: 'p1', montant: -100 }, { ligne_bancaire_id: 'g', piece_id: 'p2', montant: -200 }],
    ))
    expect([...payees].sort()).toEqual(['p1', 'p2', 'p9'])
  })
})

describe('partDansLaPeriode et anneesDesRattachements', () => {
  const r = [
    { date: '2025-12-28', part: 0.25, source: 'paiement' as const },
    { date: '2026-01-28', part: 0.75, source: 'paiement' as const },
    { date: null, part: 0, source: 'sans_paiement' as const },
  ]

  it('prend les bornes comprises', () => {
    expect(partDansLaPeriode(r, '2025-12-28', '2026-01-28')).toBe(1)
    expect(partDansLaPeriode(r, '2025-12-29', '2026-01-27')).toBe(0)
    expect(partDansLaPeriode(r, '2026-01-01', '2026-01-31')).toBe(0.75)
  })

  it('rend les exercices touchés, sans la part sans date', () => {
    expect(anneesDesRattachements(r).sort()).toEqual([2025, 2026])
  })
})

describe('rattachements — selon le modèle comptable du dossier', () => {
  // Les paiements d'une pièce, par le vrai constructeur : une conversion écrite ici pourrait dire autre
  // chose que lui.
  const payee = (...lignes: LigneBancaire[]) => paiementsDesPieces(lignes, []).get('p1') ?? []

  it('rend en trésorerie exactement la règle de la 2035', () => {
    const p = piece()
    const paiements = payee(mouvement({ montant: -400 }))
    expect(rattachements(p, paiements, 'tresorerie')).toEqual(rattachementsTresorerie(p, paiements))
  })

  it('compte en engagement la pièce entière à sa date de facture, quel que soit son paiement', () => {
    // La facture de décembre réglée en janvier reste en décembre : c'est elle qui crée la charge.
    expect(rattachements(piece(), payee(mouvement()), 'engagement')).toEqual([{ date: '2025-12-20', part: 1, source: 'facture' }])
    expect(rattachements(piece(), [], 'engagement')).toEqual([{ date: '2025-12-20', part: 1, source: 'facture' }])
  })

  it('ne date en engagement ni une note de frais ni une pièce sans date par autre chose que leur facture', () => {
    expect(rattachements(piece({ type_piece: 'note_frais' }), payee(mouvement()), 'engagement')[0]).toMatchObject({ date: '2025-12-20', source: 'facture' })
    expect(rattachements(piece({ date_piece: null }), payee(mouvement()), 'engagement')).toEqual([{ date: null, part: 1, source: 'facture' }])
  })

  it('date en trésorerie une pièce réglée par un virement groupé à la date de ce virement', () => {
    const groupe = mouvement({ id: 'g', piece_id: null, reglement_groupe: true, montant: -1500, date: '2026-02-12' })
    const paiements = paiementsDesPieces([groupe], [
      { ligne_bancaire_id: 'g', piece_id: 'p1', montant: -1000 },
      { ligne_bancaire_id: 'g', piece_id: 'p2', montant: -500 },
    ]).get('p1') ?? []
    expect(rattachements(piece(), paiements, 'tresorerie')).toEqual([{ date: '2026-02-12', part: 1, source: 'paiement' }])
  })
})
