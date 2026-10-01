import { describe, expect, it } from 'vitest'
import type { MouvementBancaire } from './affectationBanque'
import { refusAffectation } from './affectationBanque'
import { mouvementRapprocheSansObjet } from './controles'
import { refusEcheanceEmprunt } from './echeanceEmprunt'
import { formatMoney } from './format'
import { paiementsDesPieces, type PartReglee } from './rattachement'
import {
  REFUS_REGLE_EN_GROUPE, nomDeLaPiece, partSaisieDe, partSigneeDe, piecesPayeesEnTrop, refusReglementGroupe,
  reglementsGroupesIncoherents, resteARegler, resteARepartir, signeReglant, type PartReglement,
} from './reglementGroupe'
import type { Categorie, LigneBancaire, Piece } from './types'
import { refusVentilation } from './ventilationBanque'
import { refusVirementPersonnel } from './virementPersonnel'

// TYPÉS sans `as` : le compilateur confronte chaque champ au type, donc à la table.
function mouvement(o: Partial<LigneBancaire> = {}): LigneBancaire {
  return {
    id: 'g', dossier_id: 'd1', date: '2026-03-10', libelle: 'VIR FOURNISSEUR', libelle_brut: null, montant: -900,
    statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
    source_fichier: null, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null,
    ventilee: false, reglement_groupe: false, id_externe: null, created_at: '2026-03-11T09:00:00Z', ...o,
  }
}

function piece(o: Partial<Piece> = {}): Piece {
  return {
    id: 'p1', dossier_id: 'd1', uploaded_by: null, source: 'upload', storage_path: 'd1/p1.pdf',
    nom_fichier: 'facture.pdf', storage_hash: null, date_piece: '2026-02-20', tiers: 'Fournisseur',
    montant_ht: null, montant_tva: null, montant_ttc: 1000, devise: 'EUR', montant_devise: null,
    taux_change: null, conversion_source: null, categorie_id: null, sous_dossier_id: null,
    type_piece: 'achat', statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null,
    created_at: '2026-02-21T09:00:00Z', updated_at: '2026-02-21T09:00:00Z', ...o,
  }
}

// Le cas qui justifie la ligne 26 : un paiement de 900 € qui solde une facture de 1 000 € dont on déduit un
// avoir de 100 €.
const FACTURE = piece({ id: 'fa', tiers: 'Grossiste', montant_ttc: 1000 })
const AVOIR = piece({ id: 'av', tiers: 'Grossiste', nom_fichier: 'avoir.pdf', montant_ttc: -100 })
const PIECES = [FACTURE, AVOIR, piece({ id: 'p3', montant_ttc: 250 }), piece({ id: 'vente', type_piece: 'vente', montant_ttc: 600 })]
const PARTS: PartReglement[] = [{ piece_id: 'fa', montant: -1000 }, { piece_id: 'av', montant: 100 }]
const SANS_PAIEMENT = paiementsDesPieces([], [])

describe('signeReglant et la saisie des parts', () => {
  it('règle une dépense par une sortie, une recette par une entrée, un avoir à l’inverse', () => {
    expect(signeReglant(FACTURE)).toBe(-1)
    expect(signeReglant(AVOIR)).toBe(1)
    expect(signeReglant(piece({ type_piece: 'vente', montant_ttc: 600 }))).toBe(1)
    expect(signeReglant(piece({ type_piece: 'vente', montant_ttc: -60 }))).toBe(-1)
    expect(signeReglant(piece({ type_piece: 'note_frais', montant_ttc: 40 }))).toBe(-1)
    expect(signeReglant(piece({ montant_ttc: null }))).toBe(0)
    expect(signeReglant(piece({ montant_ttc: 0 }))).toBe(0)
  })

  it('convertit la part saisie positive en part signée comme le relevé, et retour', () => {
    expect(partSigneeDe(FACTURE, 1000)).toBe(-1000)
    expect(partSigneeDe(AVOIR, 100)).toBe(100)
    expect(partSaisieDe(FACTURE, -1000)).toBe(1000)
    expect(partSaisieDe(AVOIR, 100)).toBe(100)
    expect(partSaisieDe(piece({ montant_ttc: null }), -40)).toBe(40)
  })

  it('nomme une pièce par son tiers, les blancs réduits, sinon par son fichier', () => {
    expect(nomDeLaPiece(piece({ tiers: '  Grand   Grossiste ' }))).toBe('Grand Grossiste')
    expect(nomDeLaPiece(piece({ tiers: '   ', nom_fichier: 'x.pdf' }))).toBe('x.pdf')
    expect(nomDeLaPiece(piece({ tiers: null, nom_fichier: 'x.pdf' }))).toBe('x.pdf')
  })
})

describe('resteARegler et resteARepartir', () => {
  it('rend ce qu’aucun AUTRE mouvement ne paie encore de la pièce', () => {
    const paiements = paiementsDesPieces([mouvement({ id: 'acompte', piece_id: 'fa', statut: 'rapprochee', montant: -300 })], [])
    expect(resteARegler(FACTURE, paiements.get('fa') ?? [], 'g')).toBe(700)
    // Le mouvement qu'on règle de nouveau ne compte pas : ses parts vont être remplacées.
    expect(resteARegler(FACTURE, paiements.get('fa') ?? [], 'acompte')).toBe(1000)
    expect(resteARegler(AVOIR, [], 'g')).toBe(100)
    expect(resteARegler(FACTURE, [{ id: 'x', montant: -1200 }], 'g')).toBe(0)
  })

  it('rend ce qu’il reste à répartir dans le sens du mouvement, au centime', () => {
    expect(resteARepartir(mouvement({ montant: -900 }), [{ piece_id: 'fa', montant: -1000 }])).toBe(-100)
    expect(resteARepartir(mouvement({ montant: -900 }), PARTS)).toBe(0)
    expect(resteARepartir(mouvement({ montant: -900 }), [{ piece_id: 'fa', montant: -600 }])).toBe(300)
    expect(resteARepartir(mouvement({ montant: 0.3 }), [{ piece_id: 'x', montant: 0.1 }, { piece_id: 'y', montant: 0.1 }])).toBe(0.1)
  })
})

describe('refusReglementGroupe — ce que la base refuserait, dans le même ordre', () => {
  const refus = (o: Partial<LigneBancaire>, parts: PartReglement[], paiements = SANS_PAIEMENT) =>
    refusReglementGroupe(mouvement(o), parts, PIECES, paiements)

  it('accepte une facture et l’avoir déduit du paiement', () => {
    expect(refus({}, PARTS)).toBeNull()
  })

  it('accepte de régler de nouveau un mouvement déjà réglé en groupe : ses parts sont remplacées', () => {
    const deja = mouvement({ statut: 'rapprochee', reglement_groupe: true })
    const paiements = paiementsDesPieces([deja], [{ ligne_bancaire_id: 'g', piece_id: 'fa', montant: -1000 }, { ligne_bancaire_id: 'g', piece_id: 'av', montant: 100 }])
    expect(refusReglementGroupe(deja, PARTS, PIECES, paiements)).toBeNull()
  })

  it('refuse un mouvement déjà rapproché, affecté, ventilé ou classé en virement personnel', () => {
    for (const o of [
      { piece_id: 'p3' }, { cotisation_id: 'c1' }, { categorie_id: 'cat' }, { emprunt_id: 'e1' }, { ventilee: true },
      { prelevement_personnel: true },
    ] satisfies Partial<LigneBancaire>[]) {
      expect(refus(o, PARTS)).toMatch(/^Ce mouvement est rapproché d’une pièce, .*annule d’abord ce classement\.$/)
    }
  })

  it('refuse un mouvement de zéro euro, puis moins de deux pièces', () => {
    expect(refus({ montant: 0 }, PARTS)).toBe('Un mouvement de zéro euro ne règle rien.')
    expect(refus({ montant: -1000 }, [{ piece_id: 'fa', montant: -1000 }])).toBe('Un règlement groupé porte au moins deux pièces.')
  })

  it('refuse une part sans pièce, puis une part nulle ou au-delà du centime', () => {
    expect(refus({}, [{ piece_id: '', montant: -1000 }, PARTS[1]])).toBe('Chaque part désigne une pièce.')
    expect(refus({}, [{ piece_id: 'fa', montant: 0 }, PARTS[1]])).toBe('Chaque part porte un montant non nul, au centime.')
    expect(refus({}, [{ piece_id: 'fa', montant: -999.995 }, PARTS[1]])).toBe('Chaque part porte un montant non nul, au centime.')
    expect(refus({}, [{ piece_id: 'fa', montant: Number.NaN }, PARTS[1]])).toBe('Chaque part porte un montant non nul, au centime.')
  })

  it('refuse la même pièce deux fois, puis une pièce d’un autre dossier', () => {
    expect(refus({}, [PARTS[0], { piece_id: 'fa', montant: 100 }])).toBe('La même pièce figure deux fois : réunis ses parts en une.')
    expect(refus({}, [PARTS[0], { piece_id: 'ailleurs', montant: 100 }])).toBe('Cette pièce n’existe pas pour ce dossier.')
  })

  it('refuse la première pièce sans montant lu, puis la première part à contre-sens', () => {
    const pieces = [...PIECES, piece({ id: 'nue', tiers: 'Sans montant', montant_ttc: null })]
    expect(refusReglementGroupe(mouvement(), [PARTS[0], { piece_id: 'nue', montant: 100 }], pieces, SANS_PAIEMENT))
      .toBe('La pièce « Sans montant » n’a pas de montant lu : saisis-le avant de la régler avec d’autres.')
    // L'avoir PAYÉ par une sortie : il se déduit, il ne se paie pas.
    expect(refus({ montant: -1100 }, [PARTS[0], { piece_id: 'av', montant: -100 }]))
      .toBe('La part de la pièce « Grossiste » va dans le mauvais sens : une dépense se règle par une sortie, une recette par une entrée, un avoir à l’inverse.')
  })

  it('refuse des parts qui ne font pas le mouvement, dites dans le sens du mouvement', () => {
    expect(refus({ montant: -800 }, PARTS)).toBe(`Les parts font ${formatMoney(900)} au lieu des ${formatMoney(800)} du mouvement.`)
    expect(refus({ montant: 700 }, [{ piece_id: 'vente', montant: 600 }, { piece_id: 'av', montant: 50 }]))
      .toBe(`Les parts font ${formatMoney(650)} au lieu des ${formatMoney(700)} du mouvement.`)
  })

  // Le refus que la base n'a pas : une pièce payée deux fois compterait une fois dans la 2035.
  // Le débit réel d'une facture en devise dépasse souvent son provisoire au cours de la BCE : l'écart de change
  // de la banque. Seul paiement de la pièce, la part devient son montant — la refuser bloquerait un règlement
  // juste. Payée aussi ailleurs, la pièce reste jugée sur ses euros.
  it('accepte le débit réel d’une pièce en devise qu’elle seule paie, au-delà de son provisoire', () => {
    const usd = piece({ id: 'usd', tiers: 'Fournisseur US', devise: 'USD', montant_devise: 1080, montant_ttc: 1000, taux_change: 1.08 })
    const autre = piece({ id: 'eur', tiers: 'Autre', montant_ttc: 200 })
    const ligne = mouvement({ montant: -1240 })
    const parts = [{ piece_id: 'usd', montant: -1040 }, { piece_id: 'eur', montant: -200 }]
    expect(refusReglementGroupe(ligne, parts, [usd, autre], new Map())).toBeNull()
    // Un acompte l'a déjà payée en partie : la part n'en est qu'une fraction, comparée au reste.
    const acompte = paiementsDesPieces([mouvement({ id: 'a', piece_id: 'usd', statut: 'rapprochee', montant: -500 })], [])
    const ligne2 = mouvement({ montant: -740 })
    expect(refusReglementGroupe(ligne2, [{ piece_id: 'usd', montant: -540 }, { piece_id: 'eur', montant: -200 }], [usd, autre], acompte))
      .toMatch(/dépasse ce qu’il en reste à régler/)
    // Sans montant d'origine, rien ne la réaligne : elle reste jugée sur ses euros.
    const sansOrigine = { ...usd, montant_devise: null }
    expect(refusReglementGroupe(ligne, parts, [sansOrigine, autre], new Map())).toMatch(/dépasse ce qu’il en reste à régler/)
  })

  it('refuse une part qui dépasse ce qu’il reste à régler de sa pièce, au-delà de l’écart d’alignement', () => {
    const acompte = paiementsDesPieces([mouvement({ id: 'acompte', piece_id: 'fa', statut: 'rapprochee', montant: -300 })], [])
    expect(refus({}, PARTS, acompte))
      .toBe(`La part de la pièce « Grossiste » dépasse ce qu’il en reste à régler (${formatMoney(700)}) : une pièce ne se paie pas deux fois.`)
    // Sous l'écart (5 € sur cette facture), c'est un frais : accepté.
    expect(refus({ montant: -604 }, [{ piece_id: 'fa', montant: -704 }, { piece_id: 'av', montant: 100 }], acompte)).toBeNull()
    expect(refus({ montant: -606 }, [{ piece_id: 'fa', montant: -706 }, { piece_id: 'av', montant: 100 }], acompte)).toMatch(/dépasse/)
  })
})

describe('les autres classements refusent un mouvement réglé en groupe', () => {
  const groupe: MouvementBancaire = mouvement({ statut: 'rapprochee', reglement_groupe: true })
  const categorie: Categorie = {
    id: 'cat', dossier_id: null, code: 'autre', libelle: 'Autre', ordre: 1, compte_comptable: '628000', poste_2035: 'Divers',
  }

  it('dit d’annuler d’abord le règlement groupé', () => {
    expect(refusAffectation(groupe, categorie, false, null)).toBe(REFUS_REGLE_EN_GROUPE)
    expect(refusVirementPersonnel(groupe)).toBe(REFUS_REGLE_EN_GROUPE)
    expect(refusEcheanceEmprunt(groupe)).toBe(REFUS_REGLE_EN_GROUPE)
    expect(refusVentilation(groupe, [], [categorie], false)).toBe(REFUS_REGLE_EN_GROUPE)
  })

  it('ne le dit pas « rapproché sans justificatif » : ses pièces sont dans ses parts', () => {
    expect(mouvementRapprocheSansObjet(groupe)).toBe(false)
    expect(mouvementRapprocheSansObjet({ ...groupe, reglement_groupe: false })).toBe(true)
  })
})

describe('reglementsGroupesIncoherents', () => {
  const groupe = mouvement({ statut: 'rapprochee', reglement_groupe: true })
  const parts = (o: Partial<PartReglee>[] = []): PartReglee[] => [
    { ligne_bancaire_id: 'g', piece_id: 'fa', montant: -1000, ...o[0] },
    { ligne_bancaire_id: 'g', piece_id: 'av', montant: 100, ...o[1] },
  ]

  it('se tait sur un règlement que ses parts justifient', () => {
    expect(reglementsGroupesIncoherents([groupe], parts())).toEqual([])
  })

  // Le cas réel : la pièce supprimée laisse sa part, sans pièce, avec son montant.
  it('dit la somme du virement qu’une pièce supprimée ne justifie plus', () => {
    expect(reglementsGroupesIncoherents([groupe], parts([{ piece_id: null }]))).toEqual([
      { ligne: groupe, raison: 'part_sans_piece', montant: -1000 },
    ])
  })

  it('dit des parts qui ne font plus le mouvement, et des parts sur un mouvement qui ne règle plus en groupe', () => {
    expect(reglementsGroupesIncoherents([groupe], parts([{ montant: -950 }]))).toEqual([
      { ligne: groupe, raison: 'somme_differente', montant: -50 },
    ])
    expect(reglementsGroupesIncoherents([groupe], [])).toEqual([{ ligne: groupe, raison: 'somme_differente', montant: -900 }])
    const simple = mouvement({ statut: 'non_rapprochee' })
    expect(reglementsGroupesIncoherents([simple], parts())).toEqual([{ ligne: simple, raison: 'parts_sans_reglement', montant: -900 }])
  })

  // Défensif : la base refuse le drapeau sur un mouvement qui n'est pas rapproché
  // (`lignes_bancaires_reglement_groupe_rapproche`). S'il arrivait par un autre chemin, ses parts ne règlent
  // rien — `paiementsDesPieces` ne les compte pas —, et c'est ce qu'il faut dire, pas un écart de somme.
  it('un mouvement marqué mais pas rapproché ne règle rien : ses parts sont sans règlement', () => {
    const marque = mouvement({ statut: 'non_rapprochee', reglement_groupe: true })
    expect(reglementsGroupesIncoherents([marque], parts())).toEqual([{ ligne: marque, raison: 'parts_sans_reglement', montant: -900 }])
  })

  it('ne juge pas une part dont le mouvement n’a pas été lu', () => {
    expect(reglementsGroupesIncoherents([], parts())).toEqual([])
  })
})

describe('piecesPayeesEnTrop', () => {
  it('dit une pièce payée par un rapprochement ET par la part d’un virement groupé', () => {
    const paiements = paiementsDesPieces(
      [mouvement({ id: 's', piece_id: 'fa', statut: 'rapprochee', montant: -1000 }), mouvement({ statut: 'rapprochee', reglement_groupe: true })],
      [{ ligne_bancaire_id: 'g', piece_id: 'fa', montant: -1000 }, { ligne_bancaire_id: 'g', piece_id: 'av', montant: 100 }],
    )
    expect(piecesPayeesEnTrop(PIECES, paiements)).toEqual([{ piece: FACTURE, paye: 2000, enTrop: 1000 }])
  })

  it('se tait sous l’écart d’alignement : un frais ne fait pas payer la pièce deux fois', () => {
    const frais = paiementsDesPieces([mouvement({ id: 's', piece_id: 'fa', statut: 'rapprochee', montant: -1005 })], [])
    expect(piecesPayeesEnTrop(PIECES, frais)).toEqual([])
    const au_dela = paiementsDesPieces([mouvement({ id: 's', piece_id: 'fa', statut: 'rapprochee', montant: -1005.01 })], [])
    expect(piecesPayeesEnTrop(PIECES, au_dela)).toEqual([{ piece: FACTURE, paye: 1005.01, enTrop: 5.01 }])
  })

  // Une pièce dont le montant n'a pas été lu n'a pas de montant à dépasser : la dire payée « en trop »
  // accuserait un paiement juste, sur une pièce qu'il faut d'abord compléter.
  it('se tait sur une pièce dont le montant n’a pas été lu', () => {
    const sansMontant = piece({ id: 'sm', montant_ttc: null })
    const paiements = paiementsDesPieces([mouvement({ id: 's', piece_id: 'sm', statut: 'rapprochee', montant: -40 })], [])
    expect(piecesPayeesEnTrop([sansMontant], paiements)).toEqual([])
  })
})
