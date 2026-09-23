import { describe, expect, it } from 'vitest'
import {
  alignerMontantsSurBanque, ecartAvecBanque, seuilAlignement,
  SEUIL_ALIGNEMENT_PLAFOND_EUR, SEUIL_ALIGNEMENT_RELATIF,
} from './alignementBanque'
import { rapprochementsEcartImportant } from './controles'
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
    statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null,
    created_at: '2026-03-10T09:00:00Z', updated_at: '2026-03-10T09:00:00Z', ...o,
  }
}

function ligne(o: Partial<LigneBancaire> = {}): LigneBancaire {
  return {
    id: 'l1', dossier_id: 'd1', date: '2026-03-12', montant: -100,
    libelle: 'PRLV FOURNISSEUR', libelle_brut: null, statut: 'rapprochee',
    piece_id: 'p1', cotisation_id: null, prelevement_personnel: false, source_fichier: null,
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

describe('rapprochementsEcartImportant', () => {
  it('signale un écart au-dessus du seuil', () => {
    const r = rapprochementsEcartImportant([ligne({ montant: -500 })], [piece({ montant_ttc: 1000 })])
    expect(r).toHaveLength(1)
    expect(r[0].ecart.ecart).toBe(500)
  })

  // GARDE SYMÉTRIQUE — sans lui, « le contrôle signale » serait satisfait par un contrôle qui
  // signale TOUT rapprochement, donc par un écran rouge en permanence.
  it('se tait sur un écart absorbé par le seuil, et sur un rapprochement exact', () => {
    expect(rapprochementsEcartImportant([ligne({ montant: -100.03 })], [piece({ montant_ttc: 100 })])).toHaveLength(0)
    expect(rapprochementsEcartImportant([ligne({ montant: -100 })], [piece({ montant_ttc: 100 })])).toHaveLength(0)
  })

  it('se tait sur un mouvement non rapproché ou sans pièce', () => {
    expect(rapprochementsEcartImportant([ligne({ statut: 'non_rapprochee', montant: -500 })], [piece()])).toHaveLength(0)
    expect(rapprochementsEcartImportant([ligne({ piece_id: null, montant: -500 })], [piece()])).toHaveLength(0)
  })

  // Une pièce hors du jeu chargé est un ARTEFACT DE FILTRAGE, pas une anomalie — la règle déjà
  // posée pour `rupturesPisteAudit`. La crier ici ferait un contrôle qui dépend de ce que l'écran
  // a décidé de lire.
  it('se tait quand la pièce désignée n’est pas dans le jeu fourni', () => {
    expect(rapprochementsEcartImportant([ligne({ piece_id: 'absente', montant: -500 })], [piece()])).toHaveLength(0)
  })
})
