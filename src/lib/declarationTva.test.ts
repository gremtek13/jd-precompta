import { describe, expect, it } from 'vitest'
import {
  calculerCa3,
  comparerDeclarations,
  creditReporte,
  declarationPrecedente,
  dernierePeriodeClose,
  libellePeriode,
  ligneDuTaux,
  periodesDeLAnnee,
  type DonneesTva,
} from './declarationTva'
import { partsDuReleve, type PartDuReleve } from './partsDuReleve'
import { paiementsDesPieces, type PartReglee } from './rattachement'
import type { Categorie, DeclarationTva, LigneBancaire, Piece, VentilationBancaire } from './types'

// Jeu d'essai typé SANS `as` : le compilateur vérifie chaque champ contre la table, et un champ
// oublié ou mal typé échoue au build plutôt que de laisser un test prouver autre chose.
function piece(o: Partial<Piece> = {}): Piece {
  return {
    id: 'p1', dossier_id: 'd1', uploaded_by: null, source: 'upload', storage_path: 'd1/p1.pdf',
    nom_fichier: 'facture.pdf', storage_hash: null, date_piece: '2027-02-10', tiers: 'Client',
    montant_ht: 1000, montant_tva: 200, montant_ttc: 1200, devise: 'EUR', montant_devise: null,
    taux_change: null, conversion_source: null, categorie_id: null, sous_dossier_id: null,
    type_piece: 'vente', statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null,
    created_at: '2027-02-10T09:00:00Z', updated_at: '2027-02-10T09:00:00Z', ...o,
  }
}

function mouvement(o: Partial<LigneBancaire> = {}): LigneBancaire {
  return {
    id: 'l1', dossier_id: 'd1', date: '2027-02-20', libelle: 'VIR CLIENT', montant: 1200,
    statut: 'rapprochee', piece_id: 'p1', cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
    emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, compte_bilan: null, id_externe: null,
    source_fichier: null, libelle_brut: null, created_at: '2027-02-21T09:00:00Z', ...o,
  }
}

function declaration(o: Partial<DeclarationTva> = {}): DeclarationTva {
  return {
    id: 'decl1', dossier_id: 'd1', periode_debut: '2027-01-01', periode_fin: '2027-03-31',
    tva_declaree: 200, credit_anterieur: 0, date_declaration: '2027-04-20', notes: null,
    created_at: '2027-04-20T10:00:00Z', ...o,
  }
}

const T1 = { debut: '2027-01-01', fin: '2027-03-31' }
const T2 = { debut: '2027-04-01', fin: '2027-06-30' }

function donnees(
  pieces: Piece[], lignesBancaires: LigneBancaire[] = [], immobilisees: string[] = [], parts: PartReglee[] = [],
  releve: PartDuReleve[] = [],
): DonneesTva {
  return { pieces, paiements: paiementsDesPieces(lignesBancaires, parts), pieceIdsImmobilisees: new Set(immobilisees), releve }
}

describe('periodesDeLAnnee', () => {
  it('découpe une année en quatre trimestres', () => {
    expect(periodesDeLAnnee(2027, 'trimestrielle')).toEqual([
      { debut: '2027-01-01', fin: '2027-03-31', libelle: '1er trimestre 2027' },
      { debut: '2027-04-01', fin: '2027-06-30', libelle: '2e trimestre 2027' },
      { debut: '2027-07-01', fin: '2027-09-30', libelle: '3e trimestre 2027' },
      { debut: '2027-10-01', fin: '2027-12-31', libelle: '4e trimestre 2027' },
    ])
  })

  it('découpe une année en douze mois, février bissextile compris', () => {
    const mois = periodesDeLAnnee(2028, 'mensuelle')
    expect(mois).toHaveLength(12)
    expect(mois[1]).toEqual({ debut: '2028-02-01', fin: '2028-02-29', libelle: 'février 2028' })
    expect(mois[11]).toEqual({ debut: '2028-12-01', fin: '2028-12-31', libelle: 'décembre 2028' })
  })
})

describe('libellePeriode', () => {
  it('nomme un trimestre ou un mois, et donne les dates de toute autre période', () => {
    expect(libellePeriode('2027-04-01', '2027-06-30')).toBe('2e trimestre 2027')
    expect(libellePeriode('2027-03-01', '2027-03-31')).toBe('mars 2027')
    expect(libellePeriode('2027-01-15', '2027-02-14')).toBe('du 15/01/2027 au 14/02/2027')
  })
})

describe('dernierePeriodeClose', () => {
  it('rend la dernière période TERMINÉE, pas celle qui court', () => {
    expect(dernierePeriodeClose('2026-09-28', 'trimestrielle')).toMatchObject({ debut: '2026-04-01', fin: '2026-06-30' })
    expect(dernierePeriodeClose('2026-09-28', 'mensuelle')).toMatchObject({ debut: '2026-08-01', fin: '2026-08-31' })
  })

  it('le premier jour d\'une période désigne celle qui vient de finir', () => {
    expect(dernierePeriodeClose('2026-10-01', 'trimestrielle')).toMatchObject({ debut: '2026-07-01', fin: '2026-09-30' })
  })

  it('passe le réveillon', () => {
    expect(dernierePeriodeClose('2027-01-05', 'trimestrielle')).toMatchObject({ debut: '2026-10-01', fin: '2026-12-31' })
    expect(dernierePeriodeClose('2027-01-05', 'mensuelle')).toMatchObject({ debut: '2026-12-01', fin: '2026-12-31', libelle: 'décembre 2026' })
  })
})

describe('ligneDuTaux', () => {
  it('range chaque taux sur sa ligne', () => {
    expect(ligneDuTaux(1000, 200)).toBe('08')
    expect(ligneDuTaux(1000, 100)).toBe('9B')
    expect(ligneDuTaux(1000, 55)).toBe('09')
    expect(ligneDuTaux(1000, 85)).toBe('10')
  })

  it('ne place jamais 2,1 % d\'office : trois lignes s\'en réclament', () => {
    expect(ligneDuTaux(1000, 21)).toBe('taux_a_placer')
  })

  it('reconnaît un avoir à son taux, signe compris', () => {
    expect(ligneDuTaux(-100, -20)).toBe('08')
  })

  it('tolère l\'arrondi d\'une petite facture', () => {
    // 0,83 € à 20 % donne 0,166 € de TVA, imprimée 0,17 €.
    expect(ligneDuTaux(0.83, 0.17)).toBe('08')
    expect(ligneDuTaux(10, 2.01)).toBe('08')
  })

  it('refuse une facture à plusieurs taux plutôt que de la ranger sous un seul', () => {
    // 1 000 € dont moitié à 10 %, moitié à 20 % : 150 € de TVA, soit 15 %.
    expect(ligneDuTaux(1000, 150)).toBeNull()
    // Sur une grosse facture, un dixième de point est déjà 100 € d'écart : 99 000 € à 20 % et
    // 1 000 € à 10 % ne sont pas une facture à 20 %.
    expect(ligneDuTaux(100000, 19900)).toBeNull()
  })
})

describe('calculerCa3 — la date qui décide de la période', () => {
  it('déclare une recette au trimestre de son ENCAISSEMENT, pas de sa facture', () => {
    const facture = piece({ date_piece: '2027-03-20' })
    const d = donnees([facture], [mouvement({ date: '2027-04-05' })])
    expect(calculerCa3(d, T1, false, 0).cases.taxe08).toBe(0)
    expect(calculerCa3(d, T2, false, 0).cases).toMatchObject({ A1: 1000, base08: 1000, taxe08: 200 })
  })

  it('sur option pour les débits, la déclare au trimestre de sa facture', () => {
    const d = donnees([piece({ date_piece: '2027-03-20' })], [mouvement({ date: '2027-04-05' })])
    expect(calculerCa3(d, T1, true, 0).cases.taxe08).toBe(200)
    expect(calculerCa3(d, T2, true, 0).cases.taxe08).toBe(0)
  })

  it('déduit la TVA d\'un achat au PAIEMENT, même sur option pour les débits', () => {
    // L'option ne vise que les recettes : elle ne change pas la date d'une déduction.
    const achat = piece({ type_piece: 'achat', date_piece: '2027-03-20', montant_ht: 100, montant_tva: 20, montant_ttc: 120 })
    const d = donnees([achat], [mouvement({ date: '2027-04-02', montant: -120 })])
    for (const surDebits of [false, true]) {
      expect(calculerCa3(d, T1, surDebits, 0).cases.l20).toBe(0)
      expect(calculerCa3(d, T2, surDebits, 0).cases.l20).toBe(20)
    }
  })

  it('compte une note de frais à sa date, faute de mouvement : elle se paie hors du compte', () => {
    const note = piece({ type_piece: 'note_frais', date_piece: '2027-02-14', montant_ht: 50, montant_tva: 10, montant_ttc: 60 })
    expect(calculerCa3(donnees([note]), T1, false, 0).cases.l20).toBe(10)
    // Rattachée à un mouvement, c'est lui qui la date.
    const d = donnees([note], [mouvement({ date: '2027-04-10', montant: -60 })])
    expect(calculerCa3(d, T1, false, 0).cases.l20).toBe(0)
    expect(calculerCa3(d, T2, false, 0).cases.l20).toBe(10)
  })

  it('rend à part la pièce qu\'aucun paiement ne date, au lieu de se taire sur elle', () => {
    const impayee = piece({ id: 'imp', date_piece: '2027-02-10' })
    const achat = piece({ id: 'ach', type_piece: 'achat', date_piece: '2027-01-15', montant_tva: 20, montant_ttc: 120, montant_ht: 100 })
    const apres = piece({ id: 'apres', date_piece: '2027-04-10' })
    const ca3 = calculerCa3(donnees([impayee, achat, apres]), T1, false, 0)
    expect(ca3.cases.taxe08).toBe(0)
    expect(ca3.cases.l20).toBe(0)
    // Celle datée après la période ne la concerne pas.
    expect(ca3.nonPlacees.map((n) => [n.piece.id, n.motif])).toEqual([['imp', 'non_rapprochee'], ['ach', 'non_rapprochee']])
  })

  it('sur les débits, une recette sans date ne rejoint aucune période', () => {
    const ca3 = calculerCa3(donnees([piece({ date_piece: null })]), T1, true, 0)
    expect(ca3.nonPlacees.map((n) => n.motif)).toEqual(['sans_date'])
    expect(ca3.cases.taxe08).toBe(0)
  })

  it('ne rend jamais un achat sans TVA parmi les pièces à rattacher', () => {
    const sansTva = piece({ type_piece: 'achat', montant_ht: 30, montant_tva: 0, montant_ttc: 30 })
    expect(calculerCa3(donnees([sansTva]), T1, false, 0).nonPlacees).toEqual([])
  })

  it('ne rend exigible que la part payée d\'une recette réglée en deux fois', () => {
    const d = donnees([piece()], [
      mouvement({ id: 'm1', date: '2027-03-15', montant: 600 }),
      mouvement({ id: 'm2', date: '2027-04-15', montant: 600 }),
    ])
    expect(calculerCa3(d, T1, false, 0).cases).toMatchObject({ A1: 500, base08: 500, taxe08: 100 })
    expect(calculerCa3(d, T2, false, 0).cases).toMatchObject({ A1: 500, base08: 500, taxe08: 100 })
  })

  // Ligne 26 : un virement qui règle plusieurs factures. Chacune devient exigible à la date du virement,
  // pour la PART qui la règle — jamais le virement entier, qui paie aussi les autres.
  it('rend exigible chaque facture d\'un virement groupé à la date du virement, pour sa part', () => {
    const d = donnees(
      [piece({ id: 'p1' }), piece({ id: 'p2', montant_ht: 500, montant_tva: 100, montant_ttc: 600 })],
      [mouvement({ id: 'g', piece_id: null, reglement_groupe: true, montant: 1800, date: '2027-04-03' })],
      [],
      [{ ligne_bancaire_id: 'g', piece_id: 'p1', montant: 1200 }, { ligne_bancaire_id: 'g', piece_id: 'p2', montant: 600 }],
    )
    expect(calculerCa3(d, T1, false, 0).cases.taxe08).toBe(0)
    expect(calculerCa3(d, T2, false, 0).cases).toMatchObject({ A1: 1500, base08: 1500, taxe08: 300 })
  })

  it('ne rend exigible d\'une facture réglée en partie par un virement groupé que ce que sa part paie', () => {
    const d = donnees(
      [piece({ id: 'p1' }), piece({ id: 'p2', montant_ht: 500, montant_tva: 100, montant_ttc: 600 })],
      [mouvement({ id: 'g', piece_id: null, reglement_groupe: true, montant: 900, date: '2027-02-03' })],
      [],
      [{ ligne_bancaire_id: 'g', piece_id: 'p1', montant: 300 }, { ligne_bancaire_id: 'g', piece_id: 'p2', montant: 600 }],
    )
    expect(calculerCa3(d, T1, false, 0).cases).toMatchObject({ base08: 750, taxe08: 150 })
  })

  it('un acompte seul ne rend exigible que ce qu\'il paie', () => {
    const d = donnees([piece()], [mouvement({ date: '2027-03-15', montant: 300 })])
    expect(calculerCa3(d, T1, false, 0).cases).toMatchObject({ base08: 250, taxe08: 50 })
  })

  it('une recette réglée à l\'écart d\'alignement près compte en entier', () => {
    // 1 200 € facturés, 1 197 € encaissés : 3 € de frais, sous le seuil de lib/alignementBanque.ts.
    // La part est celle de la 2035 (lib/rattachement.ts) : la pièce est réglée, pas payée à 99,75 %.
    const d = donnees([piece()], [mouvement({ date: '2027-03-15', montant: 1197 })])
    expect(calculerCa3(d, T1, false, 0).cases).toMatchObject({ base08: 1000, taxe08: 200 })
  })

  it('des frais bancaires ne font pas compter la pièce plus d\'une fois', () => {
    const d = donnees([piece()], [
      mouvement({ id: 'm1', date: '2027-03-15', montant: 700 }),
      mouvement({ id: 'm2', date: '2027-03-20', montant: 700 }),
    ])
    expect(calculerCa3(d, T1, false, 0).cases).toMatchObject({ base08: 1000, taxe08: 200 })
  })

  it('ne compte pas une pièce encore à valider, mais la rend pour qu\'on la valide avant de déposer', () => {
    const d = donnees([piece({ statut: 'a_valider' })], [mouvement({ date: '2027-02-20' })])
    const ca3 = calculerCa3(d, T1, false, 0)
    expect(ca3.cases.taxe08).toBe(0)
    expect(ca3.aValider.map((p) => p.id)).toEqual(['p1'])
  })
})

describe('calculerCa3 — les cases', () => {
  const paye = (id: string, montant: number, date = '2027-02-20') => mouvement({ id: `m-${id}`, piece_id: id, montant, date })

  it('range chaque recette sur la ligne de son taux, et tout le taxé en A1', () => {
    const d = donnees(
      [
        piece({ id: 'a', montant_ht: 1000, montant_tva: 200, montant_ttc: 1200 }),
        piece({ id: 'b', montant_ht: 400, montant_tva: 40, montant_ttc: 440 }),
        piece({ id: 'c', montant_ht: 200, montant_tva: 11, montant_ttc: 211 }),
        piece({ id: 'e', montant_ht: 100, montant_tva: 8.5, montant_ttc: 108.5 }),
      ],
      [paye('a', 1200), paye('b', 440), paye('c', 211), paye('e', 108.5)],
    )
    expect(calculerCa3(d, T1, false, 0).cases).toMatchObject({
      A1: 1700, base08: 1000, taxe08: 200, base9B: 400, taxe9B: 40, base09: 200, taxe09: 11,
      base10: 100, taxe10: 9, l16: 260,
    })
  })

  it('déduit la TVA d\'une immobilisation en ligne 19, celle du reste en ligne 20', () => {
    const d = donnees(
      [
        piece({ id: 'ordi', type_piece: 'achat', montant_ht: 1500, montant_tva: 300, montant_ttc: 1800 }),
        piece({ id: 'papier', type_piece: 'achat', montant_ht: 50, montant_tva: 10, montant_ttc: 60 }),
      ],
      [paye('ordi', -1800), paye('papier', -60)],
      ['ordi'],
    )
    expect(calculerCa3(d, T1, false, 0).cases).toMatchObject({ l19: 300, l20: 10, l23: 310 })
  })

  it('porte un avoir consenti en B5 et en ligne 21, jamais en négatif sur la ligne de taux', () => {
    const d = donnees(
      [
        piece({ id: 'fac' }),
        piece({ id: 'avoir', montant_ht: -100, montant_tva: -20, montant_ttc: -120 }),
      ],
      [paye('fac', 1200), paye('avoir', -120)],
    )
    const { cases } = calculerCa3(d, T1, false, 0)
    expect(cases).toMatchObject({ A1: 1000, base08: 1000, taxe08: 200, B5: 100, l21: 20, l16: 200, l23: 20, lTD: 180 })
  })

  it('reverse en ligne 15 la TVA d\'un avoir reçu d\'un fournisseur', () => {
    const d = donnees(
      [
        piece({ id: 'fac', type_piece: 'achat', montant_ht: 500, montant_tva: 100, montant_ttc: 600 }),
        piece({ id: 'avoir', type_piece: 'achat', montant_ht: -50, montant_tva: -10, montant_ttc: -60 }),
      ],
      [paye('fac', -600), paye('avoir', 60)],
    )
    expect(calculerCa3(d, T1, false, 0).cases).toMatchObject({ l15: 10, l16: 10, l20: 100, l25: 90 })
  })

  it('porte une recette sans TVA en E2, et son avoir en F8', () => {
    const d = donnees(
      [
        piece({ id: 'exo', montant_ht: 300, montant_tva: 0, montant_ttc: 300 }),
        piece({ id: 'exo2', montant_ht: 200, montant_tva: null, montant_ttc: 200 }),
        piece({ id: 'rembourse', montant_ht: -50, montant_tva: 0, montant_ttc: -50 }),
      ],
      [paye('exo', 300), paye('exo2', 200), paye('rembourse', -50)],
    )
    expect(calculerCa3(d, T1, false, 0).cases).toMatchObject({ E2: 500, F8: 50, A1: 0 })
  })

  it('écarte la recette dont la TVA n\'a pas été lue plutôt que de la croire exonérée', () => {
    const d = donnees(
      [
        piece({ id: 'difference', montant_ht: 100, montant_tva: null, montant_ttc: 120 }),
        piece({ id: 'ttc-seul', montant_ht: null, montant_tva: null, montant_ttc: 120 }),
      ],
      [paye('difference', 120), paye('ttc-seul', 120)],
    )
    const ca3 = calculerCa3(d, T1, false, 0)
    expect(ca3.cases.E2).toBe(0)
    expect(ca3.ecartees.map((e) => [e.piece.id, e.motif])).toEqual([['difference', 'tva_non_lue'], ['ttc-seul', 'tva_non_lue']])
  })

  it('écarte, avec sa part, ce qu\'on ne sait pas placer sans deviner', () => {
    const d = donnees(
      [
        piece({ id: 'presse', montant_ht: 1000, montant_tva: 21, montant_ttc: 1021 }),
        piece({ id: 'mixte', montant_ht: 1000, montant_tva: 150, montant_ttc: 1150 }),
      ],
      [paye('presse', 510.5), paye('mixte', 1150)],
    )
    const ca3 = calculerCa3(d, T1, false, 0)
    expect(ca3.cases.l16).toBe(0)
    expect(ca3.cases.A1).toBe(0)
    expect(ca3.ecartees.map((e) => [e.piece.id, e.motif, e.part])).toEqual([['presse', 'taux_a_placer', 0.5], ['mixte', 'taux_non_reconnu', 1]])
  })

  it('écarte une TVA démontrée fausse et une devise jamais convertie', () => {
    const d = donnees(
      [
        piece({ id: 'faux', type_piece: 'achat', montant_ht: 20, montant_tva: 20.6, montant_ttc: 24 }),
        piece({ id: 'usd', type_piece: 'achat', devise: 'USD', montant_devise: 24, taux_change: null, montant_ht: 20, montant_tva: 4, montant_ttc: 24 }),
      ],
      [paye('faux', -24), paye('usd', -24)],
    )
    const ca3 = calculerCa3(d, T1, false, 0)
    expect(ca3.cases.l20).toBe(0)
    expect(ca3.ecartees.map((e) => [e.piece.id, e.motif])).toEqual([['faux', 'tva_impossible'], ['usd', 'devise_non_convertie']])
    expect(ca3.ecartees[0].detail).toBe('TVA impossible : HT + TVA ne fait pas le TTC')
  })

  it('signale l\'achat en devise sans TVA, qui peut être à autoliquider — pas celui en euros', () => {
    const d = donnees(
      [
        piece({ id: 'openai', type_piece: 'achat', devise: 'USD', montant_devise: 24, taux_change: 1.1, conversion_source: 'banque', montant_ht: 21.82, montant_tva: null, montant_ttc: 21.82 }),
        piece({ id: 'assurance', type_piece: 'achat', montant_ht: 90, montant_tva: 0, montant_ttc: 90 }),
      ],
      [paye('openai', -21.82), paye('assurance', -90)],
    )
    const ca3 = calculerCa3(d, T1, false, 0)
    expect(ca3.achatsEnDeviseSansTva.map((p) => p.id)).toEqual(['openai'])
    expect(ca3.cases.l20).toBe(0)
  })

  it('écarte l\'achat dont la TVA n\'a pas été lue', () => {
    const d = donnees([piece({ id: 'a', type_piece: 'achat', montant_ht: 100, montant_tva: null, montant_ttc: 120 })], [paye('a', -120)])
    expect(calculerCa3(d, T1, false, 0).ecartees.map((e) => e.motif)).toEqual(['tva_non_lue'])
  })

  it('dit d\'où vient chaque case', () => {
    const d = donnees(
      [piece({ id: 'v' }), piece({ id: 'a', type_piece: 'achat', montant_ht: 50, montant_tva: 10, montant_ttc: 60 })],
      [paye('v', 1200), paye('a', -60)],
    )
    expect(calculerCa3(d, T1, false, 0).retenues.map((r) => [r.piece.id, r.ligne, r.part])).toEqual([['v', '08', 1], ['a', '20', 1]])
  })
})

describe('calculerCa3 — les arrondis', () => {
  const paye = (id: string, montant: number) => mouvement({ id: `m-${id}`, piece_id: id, montant })

  it('arrondit le TOTAL de chaque ligne, jamais pièce par pièce', () => {
    // Trois recettes de 0,40 € HT : 1,20 €, soit 1 €. Arrondies une à une, elles feraient zéro.
    const pieces = ['a', 'b', 'c'].map((id) => piece({ id, montant_ht: 0.4, montant_tva: 0.08, montant_ttc: 0.48 }))
    const ca3 = calculerCa3(donnees(pieces, pieces.map((p) => paye(p.id, 0.48))), T1, false, 0)
    expect(ca3.cases.base08).toBe(1)
    expect(ca3.cases.A1).toBe(1)
  })

  it('compte 0,50 € pour un euro, et néglige 0,49 €', () => {
    const d = donnees(
      [piece({ id: 'a', montant_ht: 10.5, montant_tva: 2.1, montant_ttc: 12.6 })],
      [paye('a', 12.6)],
    )
    expect(calculerCa3(d, T1, false, 0).cases).toMatchObject({ base08: 11, taxe08: 2 })
    const d2 = donnees(
      [piece({ id: 'b', montant_ht: 10.49, montant_tva: 2.1, montant_ttc: 12.59 })],
      [paye('b', 12.59)],
    )
    expect(calculerCa3(d2, T1, false, 0).cases.base08).toBe(10)
  })
})

describe('calculerCa3 — ce qui reste à payer', () => {
  const paye = (id: string, montant: number) => mouvement({ id: `m-${id}`, piece_id: id, montant })
  const vente = piece({ id: 'v' })
  const achat = (tva: number) => piece({ id: 'a', type_piece: 'achat', montant_ht: tva * 5, montant_tva: tva, montant_ttc: tva * 6 })

  it('rend la TVA due quand la brute dépasse la déductible', () => {
    const ca3 = calculerCa3(donnees([vente, achat(50)], [paye('v', 1200), paye('a', -300)]), T1, false, 0)
    expect(ca3.cases).toMatchObject({ l16: 200, l23: 50, lTD: 150, l25: 0, l27: 0, l28: 150, l32: 150 })
    expect(ca3.netPeriode).toBe(150)
  })

  it('rend un crédit, et le reporte, quand la déductible dépasse la brute', () => {
    const ca3 = calculerCa3(donnees([vente, achat(300)], [paye('v', 1200), paye('a', -1800)]), T1, false, 0)
    expect(ca3.cases).toMatchObject({ l16: 200, l23: 300, l25: 100, l27: 100, lTD: 0, l28: 0, l32: 0 })
    expect(ca3.netPeriode).toBe(-100)
  })

  it('impute le crédit de la déclaration précédente, sans le mêler à la TVA de la période', () => {
    const ca3 = calculerCa3(donnees([vente, achat(50)], [paye('v', 1200), paye('a', -300)]), T1, false, 80)
    expect(ca3.cases).toMatchObject({ l22: 80, l23: 130, lTD: 70, l28: 70 })
    // La TVA nette DE LA PÉRIODE ne dépend pas du crédit reçu : c'est ce qui la rend comparable.
    expect(ca3.netPeriode).toBe(150)
  })

  it('dépose « néant » quand aucune case n\'est remplie, et pas quand un crédit est reporté', () => {
    expect(calculerCa3(donnees([]), T1, false, 0).neant).toBe(true)
    const avecCredit = calculerCa3(donnees([]), T1, false, 40)
    expect(avecCredit.neant).toBe(false)
    expect(avecCredit.cases).toMatchObject({ l22: 40, l23: 40, l25: 40, l27: 40 })
  })
})

describe('creditReporte et declarationPrecedente', () => {
  it('le crédit reporté est le crédit reçu moins la TVA nette de la période, jamais négatif', () => {
    expect(creditReporte({ tva_declaree: -200, credit_anterieur: 0 })).toBe(200)
    expect(creditReporte({ tva_declaree: 50, credit_anterieur: 80 })).toBe(30)
    expect(creditReporte({ tva_declaree: 150, credit_anterieur: 80 })).toBe(0)
  })

  it('retrouve la déclaration qui finit la veille, la plus récente s\'il y en a deux', () => {
    const t4 = declaration({ id: 't4', periode_debut: '2026-10-01', periode_fin: '2026-12-31', created_at: '2027-01-20T10:00:00Z' })
    const rectificative = declaration({ id: 't4-bis', periode_debut: '2026-10-01', periode_fin: '2026-12-31', created_at: '2027-01-25T10:00:00Z' })
    const autre = declaration({ id: 't3', periode_debut: '2026-07-01', periode_fin: '2026-09-30' })
    expect(declarationPrecedente([t4, rectificative, autre], '2027-01-01')?.id).toBe('t4-bis')
    expect(declarationPrecedente([autre], '2027-01-01')).toBeNull()
  })
})

describe('comparerDeclarations', () => {
  const paye = (id: string, montant: number, date = '2027-02-20') => mouvement({ id: `m-${id}`, piece_id: id, montant, date })

  it('ne signale rien quand le recalcul retombe sur ce qui a été déposé', () => {
    const d = donnees([piece()], [paye('p1', 1200)])
    expect(comparerDeclarations([declaration({ tva_declaree: 200 })], d, false)).toEqual([
      expect.objectContaining({ recalcul: 200, ecart: 0, enEcart: false }),
    ])
  })

  it('signale la période qu\'un rapprochement tardif a changée depuis le dépôt', () => {
    // Déposée à 200 €, une seconde recette du trimestre a été rapprochée après coup.
    const d = donnees(
      [piece(), piece({ id: 'tardive', montant_ht: 500, montant_tva: 100, montant_ttc: 600 })],
      [paye('p1', 1200), paye('tardive', 600, '2027-03-30')],
    )
    expect(comparerDeclarations([declaration({ tva_declaree: 200 })], d, false)[0]).toMatchObject({ recalcul: 300, ecart: -100, enEcart: true })
  })

  it('ne prend pas les centimes d\'une déclaration saisie à la main pour un écart', () => {
    const d = donnees([piece()], [paye('p1', 1200)])
    expect(comparerDeclarations([declaration({ tva_declaree: 200.4 })], d, false)[0].enEcart).toBe(false)
  })

  it('recalcule avec la règle du dossier', () => {
    // Facturée en mars, encaissée en avril : dans le premier trimestre sur les débits seulement.
    const d = donnees([piece({ date_piece: '2027-03-20' })], [paye('p1', 1200, '2027-04-05')])
    const decl = declaration({ tva_declaree: 200 })
    expect(comparerDeclarations([decl], d, true)[0].enEcart).toBe(false)
    expect(comparerDeclarations([decl], d, false)[0]).toMatchObject({ recalcul: 0, enEcart: true })
  })
})

describe('calculerCa3 — les recettes du relevé', () => {
  // lib/tvaDuReleve.ts : sur un dossier assujetti, une recette encaissée sans facture — affectée ou ventilée
  // depuis le relevé — porte son taux, et sa TVA collectée entre dans la CA3 à la date de l'encaissement.
  const categories: Categorie[] = [
    { id: 'c-recettes', dossier_id: null, code: 'ventes', libelle: 'Ventes / prestations', ordre: 80, compte_comptable: '706000', poste_2035: 'Recettes' },
    { id: 'c-frais', dossier_id: null, code: 'frais', libelle: 'Frais bancaires', ordre: 70, compte_comptable: '627000', poste_2035: 'Frais financiers' },
  ]
  const encaissement = (o: Partial<LigneBancaire> = {}) =>
    mouvement({ id: 'enc', piece_id: null, categorie_id: 'c-recettes', taux_tva: 20, date: '2027-02-15', montant: 120, ...o })
  const releve = (lignes: LigneBancaire[], ventilations: VentilationBancaire[] = []) => partsDuReleve(lignes, categories, ventilations, true)
  const ca3 = (lignes: LigneBancaire[], surDebits = false, ventilations: VentilationBancaire[] = []) =>
    calculerCa3(donnees([], [], [], [], releve(lignes, ventilations)), T1, surDebits, 0)

  it('une recette taxée : le hors taxe sur la ligne de son taux, la TVA à côté', () => {
    const d = ca3([encaissement()])
    expect(d.cases).toMatchObject({ A1: 100, base08: 100, taxe08: 20, l16: 20, lTD: 20 })
    expect(d.releveRetenues.map((r) => [r.part.ligne.id, r.ligne])).toEqual([['enc', '08']])
    expect(d.netPeriode).toBe(20)
  })

  it('chaque taux sur sa ligne', () => {
    const d = ca3([
      encaissement({ id: 'a', taux_tva: 10, montant: 110 }),
      encaissement({ id: 'b', taux_tva: 5.5, montant: 105.5 }),
      encaissement({ id: 'c', taux_tva: 8.5, montant: 108.5 }),
    ])
    expect(d.cases).toMatchObject({ base9B: 100, taxe9B: 10, base09: 100, taxe09: 6, base10: 100, taxe10: 9, A1: 300 })
    expect(d.releveRetenues.map((r) => r.ligne)).toEqual(['9B', '09', '10'])
  })

  it('une recette exonérée va en E2, sans taxe', () => {
    const d = ca3([encaissement({ taux_tva: 0 })])
    expect(d.cases).toMatchObject({ E2: 120, A1: 0, l16: 0 })
    expect(d.releveRetenues.map((r) => r.ligne)).toEqual(['E2'])
  })

  it('un remboursement versé se déclare comme un avoir consenti : B5 et 21, jamais une ligne négative', () => {
    const d = ca3([encaissement(), encaissement({ id: 'rembourse', montant: -60 })])
    expect(d.cases).toMatchObject({ A1: 100, taxe08: 20, B5: 50, l21: 10, l16: 20, l23: 10, lTD: 10 })
    expect(d.releveRetenues.map((r) => r.ligne)).toEqual(['08', 'B5'])
  })

  it('un remboursement exonéré va en F8', () => {
    const d = ca3([encaissement({ taux_tva: 0, montant: -40 })])
    expect(d.cases).toMatchObject({ F8: 40, E2: 0 })
  })

  it('compte à la date de l’encaissement, et pas hors de la période', () => {
    expect(ca3([encaissement({ date: '2027-04-02' })]).cases.A1).toBe(0)
    expect(ca3([encaissement({ date: '2027-03-31' })]).cases.A1).toBe(100)
    // La borne de début aussi : un encaissement de décembre appartient à la déclaration d'avant, et une
    // recette sans taux d'avant la période ne se dit pas écartée de celle-ci.
    expect(ca3([encaissement({ date: '2026-12-31' })]).cases.A1).toBe(0)
    expect(ca3([encaissement({ date: '2027-01-01' })]).cases.A1).toBe(100)
    expect(ca3([encaissement({ date: '2026-12-31', taux_tva: null })]).releveEcartees).toEqual([])
  })

  it('une part de recette ventilée compte pour son montant, la commission jamais', () => {
    const remise = mouvement({ id: 'v', piece_id: null, ventilee: true, date: '2027-02-15', montant: 115 })
    const parts: VentilationBancaire[] = [
      { id: 'a', dossier_id: 'd1', ligne_bancaire_id: 'v', categorie_id: 'c-recettes', part_personnelle: false, montant: 120, taux_tva: 20, created_at: '2027-02-15T10:00:00Z' },
      { id: 'b', dossier_id: 'd1', ligne_bancaire_id: 'v', categorie_id: 'c-frais', part_personnelle: false, montant: -5, taux_tva: null, created_at: '2027-02-15T10:00:00Z' },
    ]
    const d = ca3([remise], false, parts)
    expect(d.cases).toMatchObject({ A1: 100, base08: 100, taxe08: 20 })
    expect(d.releveRetenues.map((r) => [r.part.origine, r.part.libelle, r.ligne])).toEqual([['ventilation', 'Ventes / prestations', '08']])
  })

  it('une dépense du relevé n’ouvre aucune déduction', () => {
    const d = ca3([encaissement({ id: 'frais', categorie_id: 'c-frais', taux_tva: null, montant: -8.5 })])
    expect(d.neant).toBe(true)
    expect(d.releveRetenues).toEqual([])
    expect(d.releveEcartees).toEqual([])
  })

  it('une recette sans taux est écartée et dite — pas devinée', () => {
    const d = ca3([encaissement({ taux_tva: null })])
    expect(d.cases.A1).toBe(0)
    expect(d.cases.E2).toBe(0)
    expect(d.releveEcartees.map((e) => [e.part.ligne.id, e.motif])).toEqual([['enc', 'sans_taux']])
  })

  it('un taux que la base n’admet pas est écarté, jamais rangé en E2 comme une exonération', () => {
    // Défensif : la base n'écrit que 20, 10, 5,5, 8,5 ou zéro. Une part venue d'ailleurs ne doit pas
    // passer pour une recette non imposable.
    const [part] = releve([encaissement()])
    const d = calculerCa3(donnees([], [], [], [], [{ ...part, taux: 2.1 }]), T1, false, 0)
    expect(d.cases.E2).toBe(0)
    expect(d.releveEcartees.map((e) => e.motif)).toEqual(['sans_taux'])
  })

  it('sur option pour les débits, toute recette du relevé est écartée : la date de facture manque', () => {
    const d = ca3([encaissement(), encaissement({ id: 'soins', taux_tva: 0 })], true)
    expect(d.cases.A1).toBe(0)
    expect(d.cases.E2).toBe(0)
    expect(d.releveEcartees.map((e) => e.motif)).toEqual(['sur_debits', 'sur_debits'])
  })

  it('les totaux en centimes, arrondis à l’euro une seule fois', () => {
    // Trois encaissements de 3,00 € à 20 % : 0,50 € de TVA chacun, 1,50 € au total — 2 €, pas 3 × 1 €.
    const d = ca3([encaissement({ id: 'a', montant: 3 }), encaissement({ id: 'b', montant: 3 }), encaissement({ id: 'c', montant: 3 })])
    expect(d.cases.taxe08).toBe(2)
    expect(d.cases.base08).toBe(8)
  })

  it('le recalcul d’une déclaration déposée compte aussi les recettes du relevé', () => {
    const d = donnees([], [], [], [], releve([encaissement()]))
    expect(comparerDeclarations([declaration({ tva_declaree: 20 })], d, false)[0]).toMatchObject({ recalcul: 20, enEcart: false })
  })
})
