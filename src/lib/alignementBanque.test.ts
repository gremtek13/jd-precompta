import { describe, expect, it } from 'vitest'
import {
  alignerMontantsSurBanque, ecartAvecBanque, seuilAlignement, soldeDesPaiements,
  SEUIL_ALIGNEMENT_PLAFOND_EUR, SEUIL_ALIGNEMENT_RELATIF,
} from './alignementBanque'
import { pastillesDePaiement, piecesPayeesEnPartie, piecesPayeesPar, restesAReglerDesPieces } from './controles'
import type { PaiementDePiece } from './rattachement'
import type { LigneBancaire, Piece } from './types'

// Décision du cabinet (23/09/2026) : la banque fait foi SOUS UN SEUIL, et au-delà on signale.
// Ces tests figent la frontière, parce que c'est elle qui sépare « un frais bancaire » d'« un
// paiement partiel » — et que les données ne les distinguent par rien d'autre.

function piece(o: Partial<Piece> = {}): Piece {
  return {
    id: 'p1', dossier_id: 'd1', uploaded_by: null, source: 'upload',
    storage_path: 'd1/f.pdf', nom_fichier: 'f.pdf', storage_hash: null,
    date_piece: '2026-03-10', tiers: 'Fournisseur', montant_ht: null, montant_tva: null,
    montant_ttc: 100, devise: 'EUR', montant_devise: null, taux_change: null,
    conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'achat',
    statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null,
    created_at: '2026-03-10T09:00:00Z', updated_at: '2026-03-10T09:00:00Z', ...o,
  }
}

function ligne(o: Partial<LigneBancaire> = {}): LigneBancaire {
  return {
    id: 'l1', dossier_id: 'd1', date: '2026-03-12', montant: -100,
    libelle: 'PRLV FOURNISSEUR', libelle_brut: null, statut: 'rapprochee',
    piece_id: 'p1', cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false, source_fichier: null,
    emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, id_externe: null,
    created_at: '2026-03-12T09:00:00Z', ...o,
  }
}

describe('seuilAlignement', () => {
  it('est relatif sur les petits montants', () => {
    expect(seuilAlignement(100)).toBeCloseTo(2, 10)
    expect(seuilAlignement(12)).toBeCloseTo(0.24, 10)
  })

  // LE PLAFOND EST CE QUI EMPÊCHE D'AVALER UN ACOMPTE : 2 % de 5 000 € valent 100 €, largement de
  // quoi couvrir un règlement partiel — ce que le seuil ne doit jamais absorber.
  it('est plafonné sur les gros montants', () => {
    expect(seuilAlignement(5000)).toBe(SEUIL_ALIGNEMENT_PLAFOND_EUR)
    expect(seuilAlignement(250)).toBe(SEUIL_ALIGNEMENT_PLAFOND_EUR)
  })

  // La bascule exacte : au-dessus de 250 €, le plafond prend le relais du relatif.
  it('bascule du relatif au plafond au bon montant', () => {
    const bascule = SEUIL_ALIGNEMENT_PLAFOND_EUR / SEUIL_ALIGNEMENT_RELATIF
    expect(seuilAlignement(bascule - 1)).toBeLessThan(SEUIL_ALIGNEMENT_PLAFOND_EUR)
    expect(seuilAlignement(bascule + 1)).toBe(SEUIL_ALIGNEMENT_PLAFOND_EUR)
  })

  // PAS DE PLANCHER, et c'est mesuré : 2 % couvre déjà un centime dès 0,50 €.
  it('couvre un centime sur une pièce à 0,50 €', () => {
    expect(seuilAlignement(0.5)).toBeGreaterThanOrEqual(0.01)
  })
})

describe('ecartAvecBanque', () => {
  it('compare les VALEURS ABSOLUES — une pièce d’achat est positive, son mouvement négatif', () => {
    const e = ecartAvecBanque(piece({ montant_ttc: 100 }), ligne({ montant: -100.03 }))
    expect(e?.ecart).toBeCloseTo(0.03, 10)
    expect(e?.alignable).toBe(true)
  })

  it('refuse d’aligner un écart large', () => {
    const e = ecartAvecBanque(piece({ montant_ttc: 1000 }), ligne({ montant: -500 }))
    expect(e?.ecart).toBe(500)
    expect(e?.alignable).toBe(false)
  })

  // Un écart NUL n'est pas « alignable » : il n'y a rien à écrire, et le dire éviterait une écriture
  // inutile sur chaque rapprochement parfait — c'est-à-dire la quasi-totalité d'entre eux.
  it('n’aligne pas quand les montants sont identiques', () => {
    expect(ecartAvecBanque(piece({ montant_ttc: 100 }), ligne({ montant: -100 }))?.alignable).toBe(false)
  })

  it('se tait sur une pièce en devise — traitée sans seuil, ailleurs', () => {
    expect(ecartAvecBanque(piece({ devise: 'USD', montant_devise: 120 }), ligne())).toBeNull()
  })

  it('se tait quand le montant de la pièce n’a pas été lu', () => {
    expect(ecartAvecBanque(piece({ montant_ttc: null }), ligne())).toBeNull()
  })
})

describe('alignerMontantsSurBanque', () => {
  it('garde la PROPORTION de TVA que le document annonce', () => {
    const r = alignerMontantsSurBanque({ montant_ht: 100, montant_tva: 20, montant_ttc: 120 }, -120.06)
    expect(r.montant_ttc).toBeCloseTo(120.06, 10)
    expect(r.montant_tva).toBeCloseTo(20.01, 10)
    expect(r.montant_ht).toBeCloseTo(100.05, 10)
  })

  // Le SIGNE reste celui de la pièce : le reprendre de la ligne retournerait chaque montant.
  it('ne reprend pas le signe du mouvement', () => {
    expect(alignerMontantsSurBanque({ montant_ht: null, montant_tva: null, montant_ttc: 100 }, -100.5).montant_ttc)
      .toBeCloseTo(100.5, 10)
  })

  it('laisse HT et TVA intacts quand la pièce n’en porte pas', () => {
    const r = alignerMontantsSurBanque({ montant_ht: null, montant_tva: null, montant_ttc: 100 }, -100.02)
    expect(r.montant_ttc).toBeCloseTo(100.02, 10)
    expect(r.montant_tva).toBeNull()
  })
})

// Un paiement de la pièce : un mouvement rapproché, ou la part d'un virement groupé.
function paiement(montant: number, id = `m${montant}`, origine: PaiementDePiece['origine'] = 'rapprochement'): PaiementDePiece {
  return { id, date: '2026-03-12', montant, origine }
}

describe('soldeDesPaiements', () => {
  it('dit ce qui reste à payer, au centime', () => {
    expect(soldeDesPaiements(piece({ montant_ttc: 1000 }), [paiement(-500)]))
      .toEqual({ montantPiece: 1000, paye: 500, reste: 500, seuil: 5 })
  })

  // LE CAS QUI A FAIT ÉCRIRE CETTE FONCTION : deux paiements dont aucun ne fait la pièce, et qui la règlent ensemble.
  it('somme tous les paiements de la pièce — rapprochements et parts de virements groupés', () => {
    const s = soldeDesPaiements(piece({ montant_ttc: 1000 }), [paiement(-500), paiement(-500, 'g1', 'groupe')])
    expect(s?.reste).toBe(0)
    expect(s?.paye).toBe(1000)
  })

  it('dit un trop-payé par un reste négatif', () => {
    expect(soldeDesPaiements(piece({ montant_ttc: 100 }), [paiement(-100), paiement(-30)])?.reste).toBe(-30)
  })

  // En centimes entiers : sommés en flottants, 0,10 + 0,20 font 0,30000000000000004, et une pièce de 0,30 € réglée
  // par ses deux paiements garderait un reste qui n'existe pas.
  it('compte en centimes, pas en flottants', () => {
    expect(soldeDesPaiements(piece({ montant_ttc: 0.3 }), [paiement(-0.1), paiement(-0.2)])?.reste).toBe(0)
  })

  it('compare les valeurs absolues — un avoir est négatif, son remboursement positif', () => {
    expect(soldeDesPaiements(piece({ montant_ttc: -200 }), [paiement(150)])?.reste).toBe(50)
  })

  it('se tait sur une pièce sans paiement, en devise, ou dont le montant n’a pas été lu', () => {
    expect(soldeDesPaiements(piece({ montant_ttc: 1000 }), [])).toBeNull()
    expect(soldeDesPaiements(piece({ devise: 'USD', montant_devise: 120 }), [paiement(-50)])).toBeNull()
    expect(soldeDesPaiements(piece({ montant_ttc: null }), [paiement(-50)])).toBeNull()
  })

  // Le seuil est celui de l'alignement, sur le montant de la pièce — pas sur ce qui a été payé.
  it('porte le seuil de la pièce', () => {
    expect(soldeDesPaiements(piece({ montant_ttc: 100 }), [paiement(-10)])?.seuil).toBeCloseTo(2, 10)
  })
})

describe('piecesPayeesEnPartie', () => {
  const paiements = (...p: [string, PaiementDePiece[]][]) => new Map(p)

  it('signale une pièce dont les paiements laissent un reste au-delà du seuil', () => {
    const r = piecesPayeesEnPartie([piece({ montant_ttc: 1000 })], paiements(['p1', [paiement(-500)]]), 'tresorerie')
    expect(r).toEqual([{ piece: expect.objectContaining({ id: 'p1' }), paye: 500, reste: 500 }])
  })

  // L'ANCIEN CONTRÔLE comparait chaque mouvement à la pièce : ici, deux écarts de 500 € sur une pièce réglée.
  it('se tait sur une pièce réglée en plusieurs paiements', () => {
    expect(piecesPayeesEnPartie(
      [piece({ montant_ttc: 1000 })], paiements(['p1', [paiement(-500), paiement(-500, 'g1', 'groupe')]]), 'tresorerie',
    )).toEqual([])
  })

  // GARDE SYMÉTRIQUE — sans elle, « le contrôle signale » serait satisfait par un contrôle qui signale TOUTE pièce
  // payée, donc par un écran rouge en permanence. Et la borne : un reste égal au seuil est un frais, pas un reste.
  it('se tait sur un reste absorbé par le seuil, et sur un paiement exact', () => {
    expect(piecesPayeesEnPartie([piece({ montant_ttc: 100 })], paiements(['p1', [paiement(-98)]]), 'tresorerie')).toEqual([])
    expect(piecesPayeesEnPartie([piece({ montant_ttc: 100 })], paiements(['p1', [paiement(-100)]]), 'tresorerie')).toEqual([])
    expect(piecesPayeesEnPartie([piece({ montant_ttc: 100 })], paiements(['p1', [paiement(-97.99)]]), 'tresorerie')).toHaveLength(1)
  })

  // Un trop-payé n'est pas un paiement partiel : il a son propre contrôle, `piecesPayeesEnTrop`.
  it('se tait sur un trop-payé', () => {
    expect(piecesPayeesEnPartie([piece({ montant_ttc: 100 })], paiements(['p1', [paiement(-150)]]), 'tresorerie')).toEqual([])
  })

  it('se tait sur une pièce sans paiement', () => {
    expect(piecesPayeesEnPartie([piece({ montant_ttc: 1000 })], paiements(), 'tresorerie')).toEqual([])
  })

  // En engagement, le reste d'une facture payée en partie est une dette qui court encore, au 401 ou au 411.
  it('se tait en engagement', () => {
    expect(piecesPayeesEnPartie([piece({ montant_ttc: 1000 })], paiements(['p1', [paiement(-500)]]), 'engagement')).toEqual([])
  })

  // Une pièce hors du jeu fourni est un ARTEFACT DE FILTRAGE, pas une anomalie — la règle de `rupturesPisteAudit`.
  it('ne regarde que les pièces fournies', () => {
    expect(piecesPayeesEnPartie([piece({ id: 'p2' })], paiements(['p1', [paiement(-5)]]), 'tresorerie')).toEqual([])
  })
})

// CE QU'UN SECOND PAIEMENT PEUT ENCORE RÉGLER (ligne 26) : la fiche d'un mouvement offre la pièce au choix pour son reste.
// Les mêmes paiements et le même seuil que `piecesPayeesEnPartie`, dans les DEUX modèles : en engagement aussi, le
// solde d'une facture règle la dette qui court au 401.
describe('restesAReglerDesPieces', () => {
  const paiements = (...p: [string, PaiementDePiece[]][]) => new Map(p)

  it('rend le reste d’une pièce payée en partie, au centime', () => {
    expect(restesAReglerDesPieces([piece({ montant_ttc: 1000 })], paiements(['p1', [paiement(-300)]]))).toEqual(new Map([['p1', 700]]))
    // Trois paiements de 0,10 € : en flottants, 0,1 + 0,1 + 0,1 ne fait pas 0,3.
    const centimes = paiements(['p1', [paiement(-0.1, 'a'), paiement(-0.1, 'b'), paiement(-0.1, 'c')]])
    expect(restesAReglerDesPieces([piece({ montant_ttc: 10 })], centimes)).toEqual(new Map([['p1', 9.7]]))
  })

  it('réunit les paiements d’une pièce, rapprochements et parts de virements groupés', () => {
    expect(restesAReglerDesPieces([piece({ montant_ttc: 1000 })], paiements(['p1', [paiement(-300), paiement(-200, 'g1', 'groupe')]])))
      .toEqual(new Map([['p1', 500]]))
  })

  // GARDES SYMÉTRIQUES : rien n'est offert d'une pièce qui n'attend plus de second paiement — sans paiement (elle s'offre
  // comme toute pièce), réglée au seuil près, payée de trop, en devise (son montant en euros n'est qu'un provisoire) ou
  // sans montant lu.
  it('ne rend rien d’une pièce qui n’attend pas de second paiement', () => {
    expect(restesAReglerDesPieces([piece({ montant_ttc: 1000 })], paiements())).toEqual(new Map())
    expect(restesAReglerDesPieces([piece({ montant_ttc: 100 })], paiements(['p1', [paiement(-98)]]))).toEqual(new Map())
    expect(restesAReglerDesPieces([piece({ montant_ttc: 100 })], paiements(['p1', [paiement(-150)]]))).toEqual(new Map())
    expect(restesAReglerDesPieces([piece({ montant_ttc: 100, devise: 'USD' })], paiements(['p1', [paiement(-30)]]))).toEqual(new Map())
    expect(restesAReglerDesPieces([piece({ montant_ttc: null })], paiements(['p1', [paiement(-30)]]))).toEqual(new Map())
    // Un reste qui dépasse le seuil d'un centime, lui, s'offre.
    expect(restesAReglerDesPieces([piece({ montant_ttc: 100 })], paiements(['p1', [paiement(-97.99)]]))).toEqual(new Map([['p1', 2.01]]))
  })
})

describe('piecesPayeesPar', () => {
  it('rend la pièce d’un rapprochement, et les pièces des parts d’un virement groupé', () => {
    expect(piecesPayeesPar(ligne(), [])).toEqual(['p1'])
    expect(piecesPayeesPar(ligne({ piece_id: null, reglement_groupe: true }), [{ piece_id: 'pa' }, { piece_id: null }, { piece_id: 'pb' }]))
      .toEqual(['pa', 'pb'])
  })

  // Un virement groupé ne porte pas de pièce lui-même : sans ses parts, il n'en paie aucune.
  it('ne prend pas la pièce de la ligne pour un virement groupé', () => {
    expect(piecesPayeesPar(ligne({ reglement_groupe: true }), [{ piece_id: 'pa' }])).toEqual(['pa'])
  })

  it('ne rend rien d’un mouvement qui n’est pas rapproché', () => {
    expect(piecesPayeesPar(ligne({ statut: 'non_rapprochee' }), [])).toEqual([])
    expect(piecesPayeesPar(ligne({ statut: 'non_rapprochee', reglement_groupe: true }), [{ piece_id: 'pa' }])).toEqual([])
  })
})

describe('pastillesDePaiement', () => {
  const restes = new Map([['pa', 500], ['pb', 20]])
  const enTrop = new Map([['pc', 30], ['pd', 7]])
  // `formatMoney` sépare le montant de « € » par une espace insécable : les attentes s'écrivent avec une espace.
  const pastillesDePaiementLisibles = (...a: Parameters<typeof pastillesDePaiement>) =>
    pastillesDePaiement(...a).map((t) => t.replace(/\s/g, ' '))

  it('nomme le reste et le trop-payé de la pièce d’un rapprochement', () => {
    expect(pastillesDePaiementLisibles(['pa'], restes, enTrop, false)).toEqual(['Reste 500,00 € à payer sur la pièce'])
    expect(pastillesDePaiementLisibles(['pc'], restes, enTrop, false)).toEqual(['Pièce payée 30,00 € de trop'])
  })

  // Sur un virement qui règle plusieurs pièces : une pastille par sorte d'écart, qui dit combien sont concernées.
  it('compte les pièces d’un virement groupé', () => {
    expect(pastillesDePaiementLisibles(['pa', 'px'], restes, enTrop, true)).toEqual(['Reste 500,00 € à payer sur une pièce'])
    expect(pastillesDePaiementLisibles(['pa', 'pb', 'pc'], restes, enTrop, true)).toEqual(['Reste à payer sur 2 pièces', 'Une pièce payée 30,00 € de trop'])
    expect(pastillesDePaiementLisibles(['pc', 'pd'], restes, enTrop, true)).toEqual(['2 pièces payées de trop'])
  })

  it('se tait sur des pièces réglées', () => {
    expect(pastillesDePaiementLisibles(['px', 'py'], restes, enTrop, true)).toEqual([])
    expect(pastillesDePaiementLisibles([], restes, enTrop, false)).toEqual([])
  })
})
