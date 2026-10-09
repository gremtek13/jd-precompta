import { describe, expect, it } from 'vitest'
import {
  analyserEcritures, calculerBalance, ecrituresAGenerer, ecrituresSansObjet, ligneContrepartieBanque, ligneContrepartieDirigeant,
  lignesChargeProduitPourPiece, lignesOuvertes, lignesPourPiece, piecesAComptabiliser, soldeCompte,
} from './ecritures'
import type { CibleComptable, LigneAGenerer } from './ecritures'
import { COMPTE_BANQUE, COMPTE_EXPLOITANT, COMPTE_FOURNISSEURS, COMPTE_TVA_COLLECTEE, COMPTE_TVA_DEDUCTIBLE } from './comptes'
import { lignesEngagementPourPiece, lignesFactureEngagement, lignesReglementEngagement } from './engagement'
import type { ANouveau, Categorie, EcritureBrouillon, LigneBancaire, Piece } from './types'
import type { AcquisitionDuBien } from './amortissements'
import type { ModeleComptable } from './engagement'
import { paiementsDesPieces } from './rattachement'
import { A_NOUVEAU_NON_VALIDE } from '../test/ecritures'

const ACHATS = '606100'
// Le modèle de tous les dossiers d'avant l'engagement : les contrôles de trésorerie s'y lisent tels quels.
const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000' }
const VENTES = '706000'
// La cible d'une pièce ordinaire : le compte de sa catégorie. Celle de la facture d'un bien immobilisé
// porte le compte de sa nature et `immobilisation` (lib/ecritures.ts, `CibleComptable`).
const cible = (compte: string): CibleComptable => ({ compte, immobilisation: false })
const bien = (compte: string): CibleComptable => ({ compte, immobilisation: true })

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

// Ce que la facture d'un bien du registre écrit (`acquisitionsDesBiens`) : le compte de sa nature, ou rien.
const acq = (compte: string): AcquisitionDuBien => ({ compte, motif: null })
const SANS_NATURE: AcquisitionDuBien = { compte: null, motif: 'sans_nature' }
const REPRIS: AcquisitionDuBien = { compte: null, motif: 'repris' }

describe('lignesChargeProduitPourPiece', () => {
  it('passe un achat au débit et une vente au crédit', () => {
    expect(lignesChargeProduitPourPiece('d1', piece(), cible(ACHATS), true, [])).toEqual([
      expect.objectContaining({ compte: ACHATS, sens: 'debit', montant: 120 }),
    ])
    expect(lignesChargeProduitPourPiece('d1', piece({ type_piece: 'vente' }), cible(VENTES), true, [])).toEqual([
      expect.objectContaining({ compte: VENTES, sens: 'credit', montant: 120 }),
    ])
  })

  it('sépare la TVA sur son propre compte, collectée ou déductible', () => {
    const achat = lignesChargeProduitPourPiece('d1', piece({ montant_ttc: 120, montant_tva: 20 }), cible(ACHATS), true, [])
    expect(achat).toHaveLength(2)
    expect(achat[0]).toMatchObject({ compte: ACHATS, montant: 100, sens: 'debit' }) // HT déduit du TTC
    expect(achat[1]).toMatchObject({ compte: COMPTE_TVA_DEDUCTIBLE, montant: 20, sens: 'debit' })

    const vente = lignesChargeProduitPourPiece('d1', piece({ type_piece: 'vente', montant_ttc: 120, montant_tva: 20 }), cible(VENTES), true, [])
    expect(vente[1]).toMatchObject({ compte: COMPTE_TVA_COLLECTEE, sens: 'credit' })
  })

  it('préfère le HT saisi au HT recalculé', () => {
    const lignes = lignesChargeProduitPourPiece('d1', piece({ montant_ht: 99, montant_ttc: 120, montant_tva: 20 }), cible(ACHATS), true, [])
    expect(lignes[0].montant).toBe(99)
  })

  it('inverse le sens d’un montant négatif plutôt que de porter un montant négatif', () => {
    // Un avoir ou un remboursement. Garder un montant négatif au débit fausserait le contrôle
    // débit = crédit : un groupe doublé dans le mauvais sens paraîtrait équilibré.
    const avoir = lignesChargeProduitPourPiece('d1', piece({ montant_ttc: -50 }), cible(ACHATS), true, [])
    expect(avoir[0]).toMatchObject({ sens: 'credit', montant: 50 })
    expect(avoir.every((l) => l.montant >= 0)).toBe(true)
  })

  it('date par la pièce, sinon par son dépôt', () => {
    expect(lignesChargeProduitPourPiece('d1', piece({ date_piece: '2026-01-05' }), cible(ACHATS), true, [])[0].date).toBe('2026-01-05')
    const sansDate = lignesChargeProduitPourPiece('d1', piece({ date_piece: null }), cible(ACHATS), true, [])[0].date
    expect(sansDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('libelle par le tiers, sinon par le nom du fichier', () => {
    expect(lignesChargeProduitPourPiece('d1', piece({ tiers: 'EDF' }), cible(ACHATS), true, [])[0].libelle).toBe('EDF')
    expect(lignesChargeProduitPourPiece('d1', piece({ tiers: null }), cible(ACHATS), true, [])[0].libelle).toBe('facture.pdf')
  })
})

// Un mouvement rapproché d'une pièce : c'est lui qui date l'écriture (lib/rattachement.ts).
const paiement = (o: Partial<LigneBancaire> = {}): LigneBancaire => ({
  id: 'l1', dossier_id: 'd1', date: '2026-01-05', libelle: 'PRLV', montant: -120, statut: 'rapprochee',
  piece_id: 'p1', cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false, source_fichier: null, libelle_brut: null,
  emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, id_externe: null,
  created_at: '2026-01-06T09:00:00Z', ...o,
})

// Les paiements, par le vrai constructeur (lib/rattachement.ts) : une conversion écrite ici pourrait dire
// autre chose que lui.
const payes = (...lignes: LigneBancaire[]) => [...paiementsDesPieces(lignes, []).values()].flat()

// La contrepartie banque du paiement par défaut, telle que la génération l'écrit.
const contrepartie = (o: Partial<EcritureBrouillon> = {}): EcritureBrouillon =>
  ecriture({ id: 'banque', date: '2026-01-05', compte: COMPTE_BANQUE, sens: 'credit', montant: 120, ligne_bancaire_id: 'l1', ...o })

// L'ÉCRITURE EST DATÉE COMME LA 2035 COMPTE LA PIÈCE : au paiement quand le rapprochement le connaît.
// Elle portait la date de facture pendant que sa contrepartie portait celle du paiement — une facture
// de décembre réglée en janvier avait sa charge dans un exercice et sa 2035 dans l'autre.
describe('lignesChargeProduitPourPiece — la date du paiement', () => {
  const decembre = piece({ date_piece: '2025-12-20', montant_ht: 100, montant_tva: 20, montant_ttc: 120 })

  it('date toutes les lignes au paiement quand le rapprochement le connaît', () => {
    const lignes = lignesChargeProduitPourPiece('d1', decembre, cible(ACHATS), true, [paiement()])
    expect(lignes.map((l) => [l.compte, l.date, l.montant])).toEqual([
      [ACHATS, '2026-01-05', 100],
      [COMPTE_TVA_DEDUCTIBLE, '2026-01-05', 20],
    ])
  })

  it('répartit une pièce réglée en partie entre la facture et le paiement, au centime', () => {
    // 100 € dont 16,67 de TVA, 33,33 € rapprochés : deux tiers restent à la date de facture.
    const p = piece({ date_piece: '2025-12-20', montant_ht: 83.33, montant_tva: 16.67, montant_ttc: 100 })
    const lignes = lignesChargeProduitPourPiece('d1', p, cible(ACHATS), true, [paiement({ montant: -33.33 })])
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
    const lignes = lignesChargeProduitPourPiece('d1', p, cible(ACHATS), true, [paiement({ montant: -50 })])
    const parCompte = (compte: string) => Math.round(lignes.filter((l) => l.compte === compte).reduce((s, l) => s + l.montant, 0) * 100) / 100
    expect(parCompte(ACHATS)).toBe(83.33)
    expect(parCompte(COMPTE_TVA_DEDUCTIBLE)).toBe(16.67)
  })

  // UNE PIÈCE PAYÉE EN DEUX FOIS S'ÉQUILIBRE À CHAQUE DATE. La charge et la TVA arrondies chacune de son côté ajoutaient
  // un centime à une date et l'ôtaient à l'autre : 40 € TTC (33,33 + 6,67) payés 20 + 20, c'était 16,67 + 3,34 face à
  // 20,00 de banque. Payée sur deux exercices, l'écriture de chacun ne tombait plus juste, et la validation, qui la
  // veut équilibrée au centime, la refusait sans qu'aucun geste ne puisse la réparer.
  it('équilibre l’écriture de chaque date face à sa banque, la TVA de la pièce entière', () => {
    const p = piece({ date_piece: '2025-12-20', montant_ht: 33.33, montant_tva: 6.67, montant_ttc: 40 })
    const deux = [paiement({ id: 'l1', date: '2025-12-28', montant: -20 }), paiement({ id: 'l2', date: '2026-01-05', montant: -20 })]
    const lignes = lignesPourPiece('d1', p, cible(ACHATS), true, paiementsDesPieces(deux, []).get('p1')!, TRESORERIE)
    for (const date of ['2025-12-28', '2026-01-05']) {
      const solde = lignes.filter((l) => l.date === date).reduce((s, l) => s + (l.sens === 'debit' ? 1 : -1) * Math.round(l.montant * 100), 0)
      expect(solde, date).toBe(0)
    }
    expect(lignes.filter((l) => l.compte === COMPTE_TVA_DEDUCTIBLE).reduce((s, l) => s + Math.round(l.montant * 100), 0)).toBe(667)
    // La charge, elle, reste celle que la 2035 compte à chaque date (`centimesParDate`).
    expect(lignes.filter((l) => l.compte === ACHATS).map((l) => [l.date, l.montant])).toEqual([['2025-12-28', 16.67], ['2026-01-05', 16.66]])
  })

  // Une part nulle ne fait pas de ligne : la base refuse un montant nul (ecritures_brouillon_montant_positif), et
  // l'insertion d'un seul tenant de la génération emporterait tout le lot avec elle.
  it('n’écrit pas de charge nulle — un hors taxe lu à zéro ne laisse que sa TVA', () => {
    const p = piece({ montant_ht: 0, montant_tva: 20, montant_ttc: 20 })
    expect(lignesChargeProduitPourPiece('d1', p, cible(ACHATS), true, [])).toEqual([
      expect.objectContaining({ compte: COMPTE_TVA_DEDUCTIBLE, sens: 'debit', montant: 20 }),
    ])
    expect(lignesPourPiece('d1', p, cible(ACHATS), true, [], ENGAGEMENT).every((l) => l.montant > 0)).toBe(true)
  })

  it('ne fait pas de ligne de TVA vide quand sa part s’arrondit à zéro', () => {
    const p = piece({ date_piece: '2025-12-20', montant_ht: 1, montant_tva: 0.01, montant_ttc: 1.01 })
    const lignes = lignesChargeProduitPourPiece('d1', p, cible(ACHATS), true, [paiement({ montant: -0.5 })])
    expect(lignes.every((l) => l.montant > 0)).toBe(true)
    expect(lignes.filter((l) => l.date === '2026-01-05').map((l) => l.compte)).toEqual([ACHATS])
  })

  it('date au dépôt la part que rien ne date', () => {
    const p = piece({ date_piece: null, created_at: '2025-12-21T10:00:00Z', montant_ttc: 120 })
    const lignes = lignesChargeProduitPourPiece('d1', p, cible(ACHATS), true, [paiement({ montant: -60 })])
    expect(lignes.map((l) => [l.date, l.montant])).toEqual([['2026-01-05', 60], ['2025-12-21', 60]])
  })
})

// UN DOSSIER EXONÉRÉ NE VENTILE PAS LA TVA (voir lib/montantRetenu.ts). Il ne la récupère pas : sa
// charge est le TTC, sur une seule ligne, et une TVA déductible en 445660 serait un actif qu'il ne
// déduira jamais — pendant que sa charge, dans le FEC et la balance, serait amputée d'autant.
describe('un dossier exonéré ne ventile pas la TVA', () => {
  const avecTva = { montant_ht: 100, montant_tva: 20, montant_ttc: 120 }

  it('porte la charge TTC sur une seule ligne, sans 445660', () => {
    expect(lignesChargeProduitPourPiece('d1', piece(avecTva), cible(ACHATS), false, [])).toEqual([
      expect.objectContaining({ compte: ACHATS, sens: 'debit', montant: 120 }),
    ])
  })

  it('porte une recette TTC sur une seule ligne, sans 445710', () => {
    expect(lignesChargeProduitPourPiece('d1', piece({ ...avecTva, type_piece: 'vente' }), cible(VENTES), false, [])).toEqual([
      expect.objectContaining({ compte: VENTES, sens: 'credit', montant: 120 }),
    ])
  })

  it('ne signale pas « à régénérer » une écriture TTC juste', () => {
    const p = piece({ id: 'ttc', ...avecTva })
    const lignes = [ecriture({ piece_id: 'ttc', compte: ACHATS, montant: 120 })]
    expect(analyserEcritures(lignes, [{ piece: p, compte: ACHATS, immobilisation: false }], false, new Map(), TRESORERIE, null).piecesDesynchronisees).toEqual([])
  })

  it('signale une écriture qui ventile encore la TVA', () => {
    const p = piece({ id: 'ventilee', ...avecTva })
    const lignes = [
      ecriture({ piece_id: 'ventilee', compte: ACHATS, montant: 100 }),
      ecriture({ piece_id: 'ventilee', compte: COMPTE_TVA_DEDUCTIBLE, montant: 20 }),
    ]
    expect(analyserEcritures(lignes, [{ piece: p, compte: ACHATS, immobilisation: false }], false, new Map(), TRESORERIE, null).piecesDesynchronisees).toEqual([p])
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
    const lignes = pieces.flatMap((p) => lignesChargeProduitPourPiece('d1', p, cible(p.type_piece === 'vente' ? VENTES : ACHATS), assujetti, []))
      .map((l, i) => ecriture({ ...l, id: `g${i}` }))
    const aComptabiliser = pieces.map((p) => ({ piece: p, compte: p.type_piece === 'vente' ? VENTES : ACHATS, immobilisation: false }))
    expect(analyserEcritures(lignes, aComptabiliser, assujetti, new Map(), TRESORERIE, null).piecesDesynchronisees).toEqual([])
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
    expect(analyserEcritures(lignes, [], true, new Map(), TRESORERIE, null).nbSansContrepartie).toBe(1)
  })

  it('ne signale un déséquilibre que sur une écriture complète', () => {
    // Une pièce sans contrepartie est forcément déséquilibrée : la signaler serait un faux positif.
    const incomplete = [ecriture({ piece_id: 'x', compte: ACHATS, montant: 120 })]
    expect(analyserEcritures(incomplete, [], true, new Map(), TRESORERIE, null).groupesDesequilibres).toEqual([])

    const desequilibree = [
      ecriture({ piece_id: 'y', compte: ACHATS, sens: 'debit', montant: 120 }),
      ecriture({ piece_id: 'y', compte: COMPTE_BANQUE, sens: 'credit', montant: 100 }),
    ]
    expect(analyserEcritures(desequilibree, [], true, new Map(), TRESORERIE, null).groupesDesequilibres).toEqual([{ pieceId: 'y', solde: 20 }])
  })

  it('absorbe un écart d’arrondi de deux centimes, pas davantage', () => {
    const ecart = (montantBanque: number) =>
      analyserEcritures([
        ecriture({ piece_id: 'z', compte: ACHATS, sens: 'debit', montant: 120 }),
        ecriture({ piece_id: 'z', compte: COMPTE_BANQUE, sens: 'credit', montant: montantBanque }),
      ], [], true, new Map(), TRESORERIE, null).groupesDesequilibres.length

    expect(ecart(119.99)).toBe(0) // un centime : arrondi
    expect(ecart(119.9)).toBe(1)  // dix centimes : écart réel
  })

  it('repère une pièce dont le montant ne correspond plus à son écriture', () => {
    const p = piece({ id: 'maj', montant_ttc: 200 })
    const lignes = [ecriture({ piece_id: 'maj', compte: ACHATS, sens: 'debit', montant: 120 })]
    expect(analyserEcritures(lignes, [{ piece: p, compte: ACHATS, immobilisation: false }], true, new Map(), TRESORERIE, null).piecesDesynchronisees).toEqual([p])
  })

  it('ne déclare pas désynchronisée une pièce à montant négatif correctement enregistrée', () => {
    // Ses lignes sont au sens inverse du sens naturel de la pièce : une somme non signée
    // conclurait à tort à un écart.
    const avoir = piece({ id: 'avoir', montant_ttc: -50 })
    const lignes = [ecriture({ piece_id: 'avoir', compte: ACHATS, sens: 'credit', montant: 50 })]
    expect(analyserEcritures(lignes, [{ piece: avoir, compte: ACHATS, immobilisation: false }], true, new Map(), TRESORERIE, null).piecesDesynchronisees).toEqual([])
  })

  it('ne déclare pas désynchronisée une pièce sans écriture encore générée', () => {
    expect(analyserEcritures([], [{ piece: piece({ id: 'vierge' }), compte: ACHATS, immobilisation: false }], true, new Map(), TRESORERIE, null).piecesDesynchronisees).toEqual([])
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
    source_empreinte: 'a'.repeat(64), ...A_NOUVEAU_NON_VALIDE, created_at: '2026-09-26T10:00:00Z', ...o,
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

  // Ligne 26.7 : un mouvement s'écrit sur un compte de bilan que le cabinet choisit. Sans nom de l'application,
  // d'une catégorie ou de la balance reprise, il prend celui du compte du plan qui le contient — en DERNIER : un
  // nom plus précis l'emporte.
  it('nomme par le plan comptable un compte de bilan que rien d’autre ne nomme, en dernier recours', () => {
    const balance = calculerBalance(
      [ecriture({ compte: '274100' }), ecriture({ compte: '580000' }), ecriture({ compte: '165000' })],
      [],
      [aNouveau({ id: 'an-3', compte: '165000', libelle: 'Dépôt du sous-locataire' })],
    )
    expect(balance.map((l) => [l.compte, l.libelle])).toEqual([
      ['165000', 'Dépôt du sous-locataire'],
      ['274100', 'Prêts'],
      ['580000', 'Virements internes'],
    ])
  })
})

const categorie = (o: Partial<Categorie> = {}): Categorie => ({
  id: 'c1', dossier_id: null, code: 'achats_fournisseurs', libelle: 'Achats', ordre: 1,
  compte_comptable: ACHATS, poste_2035: 'Achats', ...o,
} as Categorie)

describe('piecesAComptabiliser', () => {
  const cats = [categorie(), categorie({ id: 'c2', compte_comptable: null })]

  it('rend le compte de la catégorie de chaque pièce', () => {
    expect(piecesAComptabiliser([piece()], cats, new Map())).toEqual([{ piece: piece(), compte: ACHATS, immobilisation: false }])
  })

  it('écarte les trois portes de la chaîne comptable', () => {
    const ecartees = [
      piece({ id: 'sans-cat', categorie_id: null }),
      piece({ id: 'cat-sans-compte', categorie_id: 'c2' }),
      piece({ id: 'sans-montant', montant_ttc: null }),
    ]
    expect(piecesAComptabiliser(ecartees, cats, new Map())).toEqual([])
  })

  // Une pièce à 0 € : la base refuse une ligne nulle, donc rien ne pourrait jamais l'écrire — comptée ici, elle restait
  // « sans écriture » pour toujours, et bloquait la validation de son exercice.
  it('écarte une pièce à 0 €, en charge comme en bien du registre', () => {
    const zero = piece({ id: 'zero', montant_ht: 0, montant_tva: 0, montant_ttc: 0 })
    expect(piecesAComptabiliser([zero], cats, new Map())).toEqual([])
    expect(piecesAComptabiliser([zero], cats, new Map([['zero', acq('218300')]]))).toEqual([])
  })

  // L'ÉCRITURE D'ACQUISITION (ligne 26.6, étape b) : la facture d'un bien est un actif, pas une charge.
  // Elle s'écrit sur le compte d'immobilisation de sa nature, quelle que soit sa catégorie.
  it("écrit la facture d'un bien sur le compte de sa nature, pas sur sa catégorie", () => {
    expect(piecesAComptabiliser([piece({ id: 'immo' })], cats, new Map([['immo', acq('218300')]]))).toEqual([
      { piece: piece({ id: 'immo' }), compte: '218300', immobilisation: true },
    ])
  })

  it('écrit un bien sans catégorie, ou dont la catégorie n’a pas de compte : seule sa nature décide', () => {
    const sansCategorie = piece({ id: 'a', categorie_id: null })
    const surCategorieSansCompte = piece({ id: 'b', categorie_id: 'c2' })
    const biens = new Map([['a', acq('218300')], ['b', acq('218400')]])
    expect(piecesAComptabiliser([sansCategorie, surCategorieSansCompte], cats, biens)).toEqual([
      { piece: sansCategorie, compte: '218300', immobilisation: true },
      { piece: surCategorieSansCompte, compte: '218400', immobilisation: true },
    ])
  })

  it("n'écrit pas un bien sans nature — son compte n'est pas connu —, ni un bien sans montant", () => {
    // Et surtout pas sur sa catégorie : ce serait la charge que l'acquisition existe pour remplacer.
    expect(piecesAComptabiliser([piece({ id: 'immo' })], cats, new Map([['immo', SANS_NATURE]]))).toEqual([])
    expect(piecesAComptabiliser([piece({ id: 'immo', montant_ttc: null })], cats, new Map([['immo', acq('218300')]]))).toEqual([])
  })

  // UN BIEN ACQUIS AVANT L'OUVERTURE D'UN DOSSIER REPRIS : la balance reprise porte déjà sa valeur brute, en
  // classe 2. L'écrire encore la compterait deux fois — et sur sa catégorie, en charge, ce serait pire.
  it("n'écrit pas un bien repris, ni sur le compte de sa nature ni sur sa catégorie", () => {
    expect(piecesAComptabiliser([piece({ id: 'immo' })], cats, new Map([['immo', REPRIS]]))).toEqual([])
  })
})

describe('piecesDesynchronisees — le compte autant que le montant', () => {
  const p = piece({ id: 'recat', montant_ttc: 120 })

  it('signale une pièce recatégorisée, dont le montant n’a pourtant pas bougé', () => {
    // LE CAS QUI NE DÉPLACE AUCUN TOTAL. L'écriture reste sur l'ancien compte, le montant est le
    // même au centime près : un contrôle qui ne compare que le montant la déclare synchronisée,
    // et le FEC part sur un compte que la pièce ne désigne plus.
    const lignes = [ecriture({ piece_id: 'recat', compte: ACHATS, sens: 'debit', montant: 120 })]
    expect(analyserEcritures(lignes, [{ piece: p, compte: '613200', immobilisation: false }], true, new Map(), TRESORERIE, null).piecesDesynchronisees).toEqual([p])
    // Et le même jeu sur le bon compte ne bouge pas : c'est ce qui rend le cas ci-dessus distinctif.
    expect(analyserEcritures(lignes, [{ piece: p, compte: ACHATS, immobilisation: false }], true, new Map(), TRESORERIE, null).piecesDesynchronisees).toEqual([])
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
    expect(analyserEcritures(avecTva, [{ piece: ventilee, compte: ACHATS, immobilisation: false }], true, new Map(), TRESORERIE, null).piecesDesynchronisees).toEqual([])
  })

  it('ne prend pas la contrepartie banque pour un autre compte', () => {
    const complete = [
      ecriture({ piece_id: 'recat', compte: ACHATS, sens: 'debit', montant: 120 }),
      ecriture({ id: 'b', piece_id: 'recat', compte: COMPTE_BANQUE, sens: 'credit', montant: 120, ligne_bancaire_id: 'l1' }),
    ]
    const payee = paiementsDesPieces([paiement({ piece_id: 'recat', date: '2026-03-10' })], [])
    expect(analyserEcritures(complete, [{ piece: p, compte: ACHATS, immobilisation: false }], true, payee, TRESORERIE, null).piecesDesynchronisees).toEqual([])
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
    expect(analyserEcritures(nonVentilee, [{ piece: p, compte: ACHATS, immobilisation: false }], true, new Map(), TRESORERIE, null).piecesDesynchronisees).toEqual([p])

    // Le garde symétrique : correctement ventilée, elle ne bouge pas. Sans lui, le test ci-dessus
    // serait satisfait par un contrôle qui signale toute pièce portant de la TVA.
    const ventilee = [
      ecriture({ piece_id: 'tva', compte: ACHATS, sens: 'debit', montant: 50.91 }),
      ecriture({ piece_id: 'tva', compte: COMPTE_TVA_DEDUCTIBLE, sens: 'debit', montant: 6.09 }),
    ]
    expect(analyserEcritures(ventilee, [{ piece: p, compte: ACHATS, immobilisation: false }], true, new Map(), TRESORERIE, null).piecesDesynchronisees).toEqual([])
  })

  it('voit aussi une TVA EFFACÉE après coup, dont la ligne survit', () => {
    // Le cas inverse, et le total est encore juste : la pièce ne porte plus de TVA, l'écriture en
    // garde une. `montant_tva` nul vaut 0 attendu, ce qui couvre l'ajout et l'effacement d'un coup.
    const p = piece({ id: 'effacee', montant_ht: null, montant_tva: null, montant_ttc: 120 })
    const lignes = [
      ecriture({ piece_id: 'effacee', compte: ACHATS, sens: 'debit', montant: 100 }),
      ecriture({ piece_id: 'effacee', compte: COMPTE_TVA_DEDUCTIBLE, sens: 'debit', montant: 20 }),
    ]
    expect(analyserEcritures(lignes, [{ piece: p, compte: ACHATS, immobilisation: false }], true, new Map(), TRESORERIE, null).piecesDesynchronisees).toEqual([p])
  })

  it('compte la TVA COLLECTÉE d’une vente comme la déductible d’un achat', () => {
    // Une vente ventile sur 445710, pas 445660. Ne regarder qu'un seul des deux comptes rendrait le
    // contrôle aveugle sur la moitié des pièces — et bavard sur l'autre.
    const p = piece({ id: 'vente', type_piece: 'vente', montant_ht: 100, montant_tva: 20, montant_ttc: 120 })
    const justes = [
      ecriture({ piece_id: 'vente', compte: VENTES, sens: 'credit', montant: 100 }),
      ecriture({ piece_id: 'vente', compte: COMPTE_TVA_COLLECTEE, sens: 'credit', montant: 20 }),
    ]
    expect(analyserEcritures(justes, [{ piece: p, compte: VENTES, immobilisation: false }], true, new Map(), TRESORERIE, null).piecesDesynchronisees).toEqual([])
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
    expect(analyserEcritures(lignes, [{ piece: p, compte: ACHATS, immobilisation: false }], true, new Map(), TRESORERIE, null).piecesDesynchronisees).toEqual([])
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
    expect(analyserEcritures(lignes, [{ piece: datee, compte: ACHATS, immobilisation: false }], true, new Map(), TRESORERIE, null).piecesDesynchronisees).toEqual([datee])

    // Le cas symétrique, sans lequel le test ci-dessus serait satisfait par un contrôle qui signale
    // tout : la même écriture à la bonne date ne bouge pas.
    const aJour = [ecriture({ piece_id: 'datee', date: '2025-03-14', compte: ACHATS, sens: 'debit', montant: 120 })]
    expect(analyserEcritures(aJour, [{ piece: datee, compte: ACHATS, immobilisation: false }], true, new Map(), TRESORERIE, null).piecesDesynchronisees).toEqual([])
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
    const analyse = analyserEcritures(lignes, [{ piece: p, compte: ACHATS, immobilisation: false }], true, new Map(), TRESORERIE, null)
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
    expect(analyserEcritures(lignes, [{ piece: sansDate, compte: ACHATS, immobilisation: false }], true, new Map(), TRESORERIE, null).piecesDesynchronisees).toEqual([])
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
    expect(analyserEcritures(lignes, [{ piece: p, compte: ACHATS, immobilisation: false }], true, new Map(), TRESORERIE, null).piecesDesynchronisees).toEqual([p])
  })

  it('juge la date de la contrepartie banque à son PAIEMENT, jamais à la facture', () => {
    // Elle diffère de la date de la facture presque toujours — la comparer à la facture déclarerait
    // désynchronisée chaque pièce rapprochée du dossier, c'est-à-dire exactement celles qui sont en ordre.
    const p = piece({ id: 'payee', date_piece: '2026-03-10' })
    const payee = paiementsDesPieces([paiement({ piece_id: 'payee', date: '2026-04-05' })], [])
    const banque = (date: string) =>
      ecriture({ id: 'b', piece_id: 'payee', date, compte: COMPTE_BANQUE, sens: 'credit', montant: 120, ligne_bancaire_id: 'l1' })
    const charge = ecriture({ piece_id: 'payee', date: '2026-04-05', compte: ACHATS, sens: 'debit', montant: 120 })
    expect(analyserEcritures([charge, banque('2026-04-05')], [{ piece: p, compte: ACHATS, immobilisation: false }], true, payee, TRESORERIE, null).piecesDesynchronisees).toEqual([])
    // Le garde symétrique : une contrepartie à une autre date que son paiement ne le suit plus.
    expect(analyserEcritures([charge, banque('2026-03-10')], [{ piece: p, compte: ACHATS, immobilisation: false }], true, payee, TRESORERIE, null).piecesDesynchronisees).toEqual([p])
  })
})

// LE SOLDE DE CHAQUE COMPTE À CHAQUE DATE. Une écriture juste au total, aux bonnes dates et sur les bons comptes peut
// encore être fausse à chaque date : c'est ce que l'ancien arrondi de la TVA produisait sur une pièce payée en deux
// fois, et ce qui la rendait invalidable sur deux exercices sans que « Régénérer » soit proposé.
describe('piecesDesynchronisees — le solde de chaque compte à chaque date', () => {
  const p = piece({ id: 'p1', date_piece: '2025-12-20', montant_ht: 33.33, montant_tva: 6.67, montant_ttc: 40 })
  const aComptabiliser = [{ piece: p, compte: ACHATS, immobilisation: false }]
  const deux = paiementsDesPieces([paiement({ id: 'l1', date: '2025-12-28', montant: -20 }), paiement({ id: 'l2', date: '2026-01-05', montant: -20 })], [])
  const generee = lignesPourPiece('d1', p, cible(ACHATS), true, deux.get('p1')!, TRESORERIE)
    .map((l, i) => ecriture({ ...l, id: `e${i}`, ligne_bancaire_id: l.ligne_bancaire_id ?? null }))
  const desynchronisees = (lignes: EcritureBrouillon[]) =>
    analyserEcritures(lignes, aComptabiliser, true, deux, TRESORERIE, null).piecesDesynchronisees

  it('signale l’écriture de l’ancien arrondi — juste au total, déséquilibrée à chaque date', () => {
    expect(desynchronisees(generee)).toEqual([])
    // La TVA de chaque date arrondie de son côté : 3,34 puis 3,33, face à 16,67 puis 16,66 de charge.
    const ancienArrondi = generee.map((e) => e.compte !== COMPTE_TVA_DEDUCTIBLE ? e : { ...e, montant: e.date === '2025-12-28' ? 3.34 : 3.33 })
    expect(ancienArrondi.filter((e) => e.compte === COMPTE_TVA_DEDUCTIBLE).reduce((s, e) => s + Math.round(e.montant * 100), 0)).toBe(667)
    expect(desynchronisees(ancienArrondi)).toEqual([p])
  })

  it('signale une charge répartie autrement entre les deux dates, chaque date restant équilibrée', () => {
    // 16,66 puis 16,67 de charge, 3,34 puis 3,33 de TVA : 20,00 face à 20,00 de banque à chaque date, les totaux et
    // les dates justes — mais la 2035 compte 16,67 au premier exercice, et l'écriture 16,66.
    const inversee = generee.map((e) => e.compte === ACHATS ? { ...e, montant: e.date === '2025-12-28' ? 16.66 : 16.67 }
      : e.compte === COMPTE_TVA_DEDUCTIBLE ? { ...e, montant: e.date === '2025-12-28' ? 3.34 : 3.33 } : e)
    expect(desynchronisees(inversee)).toEqual([p])
  })

  it('compare le solde de chaque compte, pas son découpage en lignes', () => {
    // La charge de la première date écrite en deux lignes : même solde, rien à régénérer.
    const coupee = generee.flatMap((e) => e.compte === ACHATS && e.date === '2025-12-28'
      ? [{ ...e, id: `${e.id}a`, montant: 10 }, { ...e, id: `${e.id}b`, montant: 6.67 }] : [e])
    expect(desynchronisees(coupee)).toEqual([])
    // Et deux lignes qui s'annulent — à une date qui n'en porte pas d'autre — ne déplacent aucun solde.
    const annulees = [...generee, ecriture({ id: 'x1', date: '2025-12-30', montant: 5 }), ecriture({ id: 'x2', date: '2025-12-30', sens: 'credit', montant: 5 })]
    expect(desynchronisees(annulees)).toEqual([])
  })
})

describe('piecesDesynchronisees — la date du PAIEMENT, quand le rapprochement la connaît', () => {
  const decembre = piece({ id: 'p1', date_piece: '2025-12-20', montant_ttc: 120 })
  const aComptabiliser = [{ piece: decembre, compte: ACHATS, immobilisation: false }]

  it('signale une écriture restée à la date de facture alors que le paiement est connu', () => {
    // Le cas de toute écriture générée avant son rapprochement : elle compterait dans l'exercice de la
    // facture pendant que la 2035 la compte dans celui du paiement.
    const aLaFacture = [ecriture({ date: '2025-12-20' })]
    expect(analyserEcritures(aLaFacture, aComptabiliser, true, paiementsDesPieces([paiement()], []), TRESORERIE, null).piecesDesynchronisees).toEqual([decembre])
    // Le garde symétrique : datée au paiement, sa contrepartie avec elle, elle est à jour.
    const auPaiement = [ecriture({ date: '2026-01-05' }), contrepartie()]
    expect(analyserEcritures(auPaiement, aComptabiliser, true, paiementsDesPieces([paiement()], []), TRESORERIE, null).piecesDesynchronisees).toEqual([])
  })

  it('accepte une pièce réglée en partie répartie sur ses deux dates, et elle seule', () => {
    const payee = paiementsDesPieces([paiement({ montant: -48 })], [])
    const reparties = lignesPourPiece('d1', decembre, cible(ACHATS), true, payee.get('p1') ?? [], TRESORERIE)
      .map((l, i) => ecriture({ ...l, id: `e${i}`, ligne_bancaire_id: l.ligne_bancaire_id ?? null }))
    expect(analyserEcritures(reparties, aComptabiliser, true, payee, TRESORERIE, null).piecesDesynchronisees).toEqual([])
    // Toute l'écriture passée au paiement — ce que ferait un rapprochement qui ignorerait la part
    // restante : la part non payée quitterait l'exercice de la facture.
    const toutAuPaiement = [ecriture({ date: '2026-01-05' }), contrepartie({ montant: 48 })]
    expect(analyserEcritures(toutAuPaiement, aComptabiliser, true, payee, TRESORERIE, null).piecesDesynchronisees).toEqual([decembre])
  })

  it('se tait quand une part n’a pas de date — le repli sur le dépôt est un instant', () => {
    const sansDate = piece({ id: 'p1', date_piece: null, montant_ttc: 120 })
    const lignes = [
      ecriture({ date: '2026-01-05', montant: 60 }), ecriture({ id: 'e2', date: '2025-12-21', montant: 60 }),
      contrepartie({ montant: 60 }),
    ]
    expect(analyserEcritures(lignes, [{ piece: sansDate, compte: ACHATS, immobilisation: false }], true, paiementsDesPieces([paiement({ montant: -60 })], []), TRESORERIE, null).piecesDesynchronisees).toEqual([])
  })

  it('ne se laisse pas dater par un mouvement qui n’est plus rapproché', () => {
    const remis = [paiement({ statut: 'non_rapprochee' })]
    expect(analyserEcritures([ecriture({ date: '2025-12-20' })], aComptabiliser, true, paiementsDesPieces(remis, []), TRESORERIE, null).piecesDesynchronisees).toEqual([])
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
    // Un bien SANS NATURE : son compte d'immobilisation n'est pas connu, donc rien ne sait réécrire la
    // pièce — l'écriture n'a plus d'objet. Avec une nature, c'est « à régénérer » (test suivant).
    const sansNature = new Map([['immo', SANS_NATURE]])
    expect(ecrituresSansObjet(lignes, [p], cats, sansNature, null)).toEqual([
      // La contrepartie banque est exclue : elle reflète un mouvement RÉEL, qui a bien eu lieu.
      { piece: p, motif: 'bien_sans_nature', nbLignes: 2, montant: 120 },
    ])
    // Les trois contrôles qui partent de la pièce n'en voient rien.
    const analyse = analyserEcritures(lignes, piecesAComptabiliser([p], cats, sansNature), true, new Map(), TRESORERIE, null)
    expect(analyse.piecesDesynchronisees).toEqual([])
    expect(analyse.groupesDesequilibres).toEqual([])
    expect(analyse.nbSansContrepartie).toBe(0)
  })

  it('laisse « à régénérer » la charge d’un bien dont la nature est connue : Régénérer la passe sur le compte du bien', () => {
    const lignes = [
      ecriture({ piece_id: 'immo', compte: ACHATS, sens: 'debit', montant: 100 }),
      ecriture({ piece_id: 'immo', compte: COMPTE_TVA_DEDUCTIBLE, sens: 'debit', montant: 20 }),
    ]
    const p = piece({ id: 'immo', montant_tva: 20 })
    const avecNature = new Map([['immo', acq('218300')]])
    expect(ecrituresSansObjet(lignes, [p], cats, avecNature, null)).toEqual([])
    expect(analyserEcritures(lignes, piecesAComptabiliser([p], cats, avecNature), true, new Map(), TRESORERIE, null).piecesDesynchronisees)
      .toEqual([p])
  })

  // Le bien REPRIS : toute écriture de sa facture le compte une seconde fois — sur le compte du bien quand
  // l'acquisition a été écrite avant que les à-nouveaux le soient, en charge quand elle précède son inscription
  // au registre. Les deux ont le même motif, et le même geste : retirer.
  it('voit l’écriture d’un bien repris, acquisition comme charge, et la nomme', () => {
    const p = piece({ id: 'immo', montant_tva: 20 })
    const acquisition = [
      ecriture({ piece_id: 'immo', compte: '218300', sens: 'debit', montant: 100 }),
      ecriture({ piece_id: 'immo', compte: '445620', sens: 'debit', montant: 20 }),
      ecriture({ piece_id: 'immo', compte: COMPTE_BANQUE, sens: 'credit', montant: 120 }),
    ]
    const charge = acquisition.map((e) => (e.compte === '218300' ? { ...e, compte: ACHATS } : e))
    const repris = new Map([['immo', REPRIS]])
    for (const lignes of [acquisition, charge]) {
      expect(ecrituresSansObjet(lignes, [p], cats, repris, null)).toEqual([{ piece: p, motif: 'bien_repris', nbLignes: 2, montant: 120 }])
      // Et rien ne propose de la régénérer : elle n'est plus à comptabiliser.
      expect(analyserEcritures(lignes, piecesAComptabiliser([p], cats, repris), true, new Map(), TRESORERIE, null).piecesDesynchronisees).toEqual([])
    }
  })

  it('dit « sans montant » d’un bien dont le TTC a été effacé, pas « immobilisée »', () => {
    const p = piece({ id: 'immo', montant_ttc: null })
    const lignes = [ecriture({ piece_id: 'immo', compte: '218300' })]
    expect(ecrituresSansObjet(lignes, [p], cats, new Map([['immo', acq('218300')]]), null)[0]?.motif).toBe('sans_montant')
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
      expect(ecrituresSansObjet(lignes, [p], cats, new Map(), null)[0]?.motif, motif).toBe(motif)
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
    expect(ecrituresSansObjet([ecriture({ piece_id: 'ailleurs', compte: ACHATS })], [], cats, new Map(), null)).toEqual([])
    expect(ecrituresSansObjet([ecriture({ piece_id: null, compte: ACHATS })], [piece()], cats, new Map(), null)).toEqual([])
  })

  it('se tait sur une pièce parfaitement comptabilisable', () => {
    const p = piece()
    expect(ecrituresSansObjet([ecriture({ piece_id: p.id })], [p], cats, new Map(), null)).toEqual([])
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
  it('produit en trésorerie la charge de lignesChargeProduitPourPiece et la contrepartie de chaque paiement', () => {
    const p = piece({ montant_ttc: 120, montant_tva: 20 })
    const payee = payes(paiement())
    expect(lignesPourPiece('d1', p, cible(ACHATS), true, payee, TRESORERIE)).toEqual([
      ...lignesChargeProduitPourPiece('d1', p, cible(ACHATS), true, payee),
      {
        dossier_id: 'd1', piece_id: p.id, ligne_bancaire_id: 'l1', date: '2026-01-05', libelle: 'facture.pdf',
        statut: 'proposee', compte: COMPTE_BANQUE, montant: 120, sens: 'credit',
      },
    ])
  })

  it('produit en engagement la facture à sa date et un règlement par mouvement', () => {
    const p = piece({ montant_ttc: 120, montant_tva: 20 })
    expect(lignesPourPiece('d1', p, cible(ACHATS), true, payes(paiement()), ENGAGEMENT))
      .toEqual(lignesEngagementPourPiece('d1', p, cible(ACHATS), true, '455000', [paiement()]))
  })
})

// LIGNE 26 : une pièce peut être payée en plusieurs fois — un acompte, puis la part d'un virement qui
// règle plusieurs factures. Le rapprochement n'écrivait qu'UNE contrepartie banque par pièce, celle du
// premier paiement : l'écriture restait déséquilibrée, et rien ne savait la compléter.
describe('ligneContrepartieBanque et la génération en trésorerie — une contrepartie par paiement', () => {
  const p = piece({ id: 'p1', date_piece: '2026-01-02', montant_ttc: 1000, tiers: 'Fournisseur' })
  const groupe = paiement({ id: 'g', piece_id: null, reglement_groupe: true, montant: -1500, date: '2026-02-12' })
  const acompte = paiement({ id: 'a', piece_id: 'p1', montant: -300, date: '2026-01-20' })
  const paiements = paiementsDesPieces([acompte, groupe], [
    { ligne_bancaire_id: 'g', piece_id: 'p1', montant: -700 },
    { ligne_bancaire_id: 'g', piece_id: 'p2', montant: -800 },
  ])

  it('porte le montant de CE paiement — la part, jamais le virement entier —, à sa date et dans le sens de son signe', () => {
    const part = paiements.get('p1')!.find((m) => m.id === 'g')!
    expect(ligneContrepartieBanque('d1', p, part)).toEqual({
      dossier_id: 'd1', piece_id: 'p1', ligne_bancaire_id: 'g', date: '2026-02-12', libelle: 'Fournisseur',
      statut: 'proposee', compte: COMPTE_BANQUE, montant: 700, sens: 'credit',
    })
    // Une entrée l'augmente au débit : l'avoir déduit d'un virement groupé, un remboursement.
    expect(ligneContrepartieBanque('d1', p, { id: 'g', date: '2026-02-12', montant: 100 })).toMatchObject({ sens: 'debit', montant: 100 })
    expect(ligneContrepartieBanque('d1', p, { id: 'z', date: '2026-02-12', montant: 0 })).toBeNull()
  })

  it('génère une contrepartie par paiement, et une écriture qui s’équilibre', () => {
    const lignes = lignesPourPiece('d1', p, cible(ACHATS), false, paiements.get('p1')!, TRESORERIE)
    expect(lignes.filter((l) => l.compte === COMPTE_BANQUE).map((l) => [l.ligne_bancaire_id, l.date, l.montant]))
      .toEqual([['a', '2026-01-20', 300], ['g', '2026-02-12', 700]])
    // La charge répartie entre les deux paiements, à leurs dates.
    expect(lignes.filter((l) => l.compte === ACHATS).map((l) => [l.date, l.montant])).toEqual([['2026-01-20', 300], ['2026-02-12', 700]])
    expect(lignes.reduce((s, l) => s + (l.sens === 'debit' ? l.montant : -l.montant), 0)).toBe(0)
    const analyse = analyserEcritures(enBase(lignes), [{ piece: p, compte: ACHATS, immobilisation: false }], false, paiements, TRESORERIE, null)
    expect(analyse).toEqual({ nbSansContrepartie: 0, piecesSansContrepartie: [], groupesDesequilibres: [], piecesDesynchronisees: [] })
  })

  it('signale la pièce payée deux fois dont une seule contrepartie est au brouillon — le défaut d’avant', () => {
    const lignes = enBase(lignesPourPiece('d1', p, cible(ACHATS), false, paiements.get('p1')!, TRESORERIE))
      .filter((l) => l.ligne_bancaire_id !== 'g')
    expect(analyserEcritures(lignes, [{ piece: p, compte: ACHATS, immobilisation: false }], false, paiements, TRESORERIE, null).piecesDesynchronisees).toEqual([p])
  })

  it('signale une contrepartie restée sur l’ancienne part d’un virement groupé réglé de nouveau', () => {
    // Le même mouvement, en face de la même pièce : seule la comparaison des MONTANTS le voit.
    const avant = paiementsDesPieces([acompte, groupe], [
      { ligne_bancaire_id: 'g', piece_id: 'p1', montant: -600 },
      { ligne_bancaire_id: 'g', piece_id: 'p2', montant: -900 },
    ])
    const lignes = enBase(lignesPourPiece('d1', p, cible(ACHATS), false, avant.get('p1')!, TRESORERIE))
    expect(analyserEcritures(lignes, [{ piece: p, compte: ACHATS, immobilisation: false }], false, paiements, TRESORERIE, null).piecesDesynchronisees).toEqual([p])
  })

  it('signale une contrepartie que plus rien ne rapproche, ou qui ne désigne plus aucun mouvement', () => {
    const seul = paiementsDesPieces([acompte], [])
    const lignes = enBase(lignesPourPiece('d1', p, cible(ACHATS), false, seul.get('p1')!, TRESORERIE))
    expect(analyserEcritures(lignes, [{ piece: p, compte: ACHATS, immobilisation: false }], false, seul, TRESORERIE, null).piecesDesynchronisees).toEqual([])
    // Le mouvement a été remis à traiter : sa contrepartie reste au brouillon.
    expect(analyserEcritures(lignes, [{ piece: p, compte: ACHATS, immobilisation: false }], false, new Map(), TRESORERIE, null).piecesDesynchronisees).toEqual([p])
    // Le mouvement a disparu : la clé est tombée à nul.
    const orpheline = lignes.map((l) => (l.compte === COMPTE_BANQUE ? { ...l, ligne_bancaire_id: null } : l))
    expect(analyserEcritures(orpheline, [{ piece: p, compte: ACHATS, immobilisation: false }], false, seul, TRESORERIE, null).piecesDesynchronisees).toEqual([p])
  })

  // Le cas ci-dessus se voit aussi à la DATE : la charge reste datée au paiement disparu. Une contrepartie de
  // trop À CÔTÉ de la juste — l'annulation d'un paiement dont la ligne est restée, un mouvement supprimé —
  // ne laisse ni date ni total faux : seule la comparaison des lignes de banque aux paiements la voit.
  it('signale une contrepartie de trop à côté de la juste : un autre mouvement, ou plus aucun', () => {
    const seul = paiementsDesPieces([acompte], [])
    const justes = enBase(lignesPourPiece('d1', p, cible(ACHATS), false, seul.get('p1')!, TRESORERIE))
    const contrepartie = justes.find((l) => l.compte === COMPTE_BANQUE)!
    expect(analyserEcritures(justes, [{ piece: p, compte: ACHATS, immobilisation: false }], false, seul, TRESORERIE, null).piecesDesynchronisees).toEqual([])
    for (const deTrop of [{ id: 'x', ligne_bancaire_id: 'x' }, { id: 'y', ligne_bancaire_id: null }]) {
      const lignes = [...justes, { ...contrepartie, ...deTrop, montant: 50 }]
      expect(analyserEcritures(lignes, [{ piece: p, compte: ACHATS, immobilisation: false }], false, seul, TRESORERIE, null).piecesDesynchronisees).toEqual([p])
    }
  })

  it('signale des contreparties restées sans leur charge', () => {
    const banqueSeule = enBase(lignesPourPiece('d1', p, cible(ACHATS), false, paiements.get('p1')!, TRESORERIE))
      .filter((l) => l.compte === COMPTE_BANQUE)
    expect(analyserEcritures(banqueSeule, [{ piece: p, compte: ACHATS, immobilisation: false }], false, paiements, TRESORERIE, null).piecesDesynchronisees).toEqual([p])
  })

  it('ne dit « en attente de rapprochement » qu’une pièce qu’aucun paiement ne règle', () => {
    const chargeSeule = enBase(lignesChargeProduitPourPiece('d1', p, cible(ACHATS), false, []))
    // Payée, la pièce sans contrepartie n'attend pas un rapprochement — elle l'a : son écriture est à
    // régénérer.
    const payee = analyserEcritures(chargeSeule, [{ piece: p, compte: ACHATS, immobilisation: false }], false, paiements, TRESORERIE, null)
    expect(payee.nbSansContrepartie).toBe(0)
    expect(payee.piecesDesynchronisees).toEqual([p])
    const enAttente = analyserEcritures(chargeSeule, [{ piece: p, compte: ACHATS, immobilisation: false }], false, new Map(), TRESORERIE, null)
    expect(enAttente.nbSansContrepartie).toBe(1)
    expect(enAttente.piecesDesynchronisees).toEqual([])
  })
})

describe('analyserEcritures — en engagement', () => {
  const p = piece({ id: 'p1', date_piece: '2025-12-20', montant_ht: 100, montant_tva: 20, montant_ttc: 120 })
  const aComptabiliser = [{ piece: p, compte: ACHATS, immobilisation: false }]
  const genere = (piecePassee: Piece = p, mouvements: LigneBancaire[] = [paiement()]) =>
    enBase(lignesEngagementPourPiece('d1', piecePassee, cible(ACHATS), true, '455000', mouvements))

  it('se tait sur une facture et son règlement tels que la génération les écrit', () => {
    const analyse = analyserEcritures(genere(), aComptabiliser, true, paiementsDesPieces([paiement()], []), ENGAGEMENT, null)
    expect(analyse).toEqual({ nbSansContrepartie: 0, piecesSansContrepartie: [], groupesDesequilibres: [], piecesDesynchronisees: [] })
  })

  it('compte une facture sans règlement comme en attente de rapprochement, sans la dire périmée', () => {
    const analyse = analyserEcritures(genere(p, []), aComptabiliser, true, new Map(), ENGAGEMENT, null)
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
    const analyse = analyserEcritures(genere(p, frais), aComptabiliser, true, paiementsDesPieces(frais, []), ENGAGEMENT, null)
    expect(analyse.groupesDesequilibres).toEqual([])
    expect(analyse.piecesDesynchronisees).toEqual([])
  })

  it('dit déséquilibrée une facture dont la TVA ne recoupe pas le TTC', () => {
    const fausse = piece({ id: 'p1', date_piece: '2025-12-20', montant_ht: 100, montant_tva: 30, montant_ttc: 120 })
    const analyse = analyserEcritures(genere(fausse), [{ piece: fausse, compte: ACHATS, immobilisation: false }], true, paiementsDesPieces([paiement()], []), ENGAGEMENT, null)
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
    const analyse = analyserEcritures(lignes, aComptabiliser, true, paiementsDesPieces([paiement()], []), ENGAGEMENT, null)
    expect(analyse.groupesDesequilibres).toEqual([{ pieceId: 'p1', solde: -10 }])
  })

  it('signale un mouvement rapproché dont le règlement manque — la dette resterait ouverte au 401', () => {
    const analyse = analyserEcritures(genere(p, []), aComptabiliser, true, paiementsDesPieces([paiement()], []), ENGAGEMENT, null)
    expect(analyse.piecesDesynchronisees).toEqual([p])
  })

  it('signale un règlement resté sur l’ancienne part d’un virement groupé réglé de nouveau', () => {
    // Le même mouvement en face de la même pièce : les identifiants concordent, seul le MONTANT a bougé.
    const groupe = paiement({ id: 'g', piece_id: null, reglement_groupe: true, montant: -200 })
    const avant = paiementsDesPieces([groupe], [{ ligne_bancaire_id: 'g', piece_id: 'p1', montant: -120 }, { ligne_bancaire_id: 'g', piece_id: 'p2', montant: -80 }])
    const apres = paiementsDesPieces([groupe], [{ ligne_bancaire_id: 'g', piece_id: 'p1', montant: -100 }, { ligne_bancaire_id: 'g', piece_id: 'p2', montant: -100 }])
    const lignes = enBase(lignesEngagementPourPiece('d1', p, cible(ACHATS), true, '455000', avant.get('p1')!))
    expect(analyserEcritures(lignes, aComptabiliser, true, avant, ENGAGEMENT, null).piecesDesynchronisees).toEqual([])
    expect(analyserEcritures(lignes, aComptabiliser, true, apres, ENGAGEMENT, null).piecesDesynchronisees).toEqual([p])
  })

  it('n’attend aucun règlement d’un paiement de zéro euro, qui n’en écrit aucun', () => {
    const nul = [paiement({ montant: 0 })]
    const analyse = analyserEcritures(genere(p, nul), aComptabiliser, true, paiementsDesPieces(nul, []), ENGAGEMENT, null)
    expect(analyse.piecesDesynchronisees).toEqual([])
  })

  it('signale un règlement que plus aucun rapprochement ne justifie', () => {
    const analyse = analyserEcritures(genere(), aComptabiliser, true, paiementsDesPieces([paiement({ statut: 'non_rapprochee' })], []), ENGAGEMENT, null)
    expect(analyse.piecesDesynchronisees).toEqual([p])
  })

  it('signale une pièce devenue note de frais : sa dette quitte le 401 pour le compte du dossier', () => {
    const noteDeFrais = { ...p, type_piece: 'note_frais' as const }
    const analyse = analyserEcritures(genere(), [{ piece: noteDeFrais, compte: ACHATS, immobilisation: false }], true, paiementsDesPieces([paiement()], []), ENGAGEMENT, null)
    expect(analyse.piecesDesynchronisees).toEqual([noteDeFrais])
  })

  it('signale un règlement resté sur l’ancien compte de tiers, même quand la facture est à jour', () => {
    const noteDeFrais = { ...p, type_piece: 'note_frais' as const }
    const lignes = [
      ...enBase(lignesFactureEngagement('d1', noteDeFrais, cible(ACHATS), true, '455000')),
      ...enBase(lignesReglementEngagement('d1', p, paiement(), '455000', false)).map((l) => ({ ...l, id: `r-${l.id}` })),
    ]
    const analyse = analyserEcritures(lignes, [{ piece: noteDeFrais, compte: ACHATS, immobilisation: false }], true, paiementsDesPieces([paiement()], []), ENGAGEMENT, null)
    expect(analyse.piecesDesynchronisees).toEqual([noteDeFrais])
  })

  it('signale une date, un montant ou une TVA changés sur la pièce, comme en trésorerie', () => {
    for (const modifiee of [
      { ...p, date_piece: '2025-12-21' },
      { ...p, montant_ht: 110, montant_ttc: 130 },
      { ...p, montant_ht: 110, montant_tva: 10 },
    ]) {
      const analyse = analyserEcritures(genere(), [{ piece: modifiee, compte: ACHATS, immobilisation: false }], true, paiementsDesPieces([paiement()], []), ENGAGEMENT, null)
      expect(analyse.piecesDesynchronisees, JSON.stringify(modifiee)).toEqual([modifiee])
    }
  })

  it('signale une recatégorisation, et une facture datée au paiement comme en trésorerie', () => {
    expect(analyserEcritures(genere(), [{ piece: p, compte: '613200', immobilisation: false }], true, paiementsDesPieces([paiement()], []), ENGAGEMENT, null).piecesDesynchronisees).toEqual([p])
    const auPaiement = genere().map((l) => (l.ligne_bancaire_id ? l : { ...l, date: '2026-01-05' }))
    expect(analyserEcritures(auPaiement, aComptabiliser, true, paiementsDesPieces([paiement()], []), ENGAGEMENT, null).piecesDesynchronisees).toEqual([p])
  })

  it('voit une ligne de la facture qui ne porte plus son montant — cas défensif', () => {
    // Deux totaux, deux contrôles : la charge avec sa TVA, et le compte de tiers. Un changement de TTC
    // fausse les deux ensemble, donc seule une ligne réécrite à part distingue l'un de l'autre. La
    // génération ne produit jamais ces lignes ; une écriture reprise à la main, si.
    const tiersFaux = genere()
    tiersFaux.find((l) => l.compte === COMPTE_FOURNISSEURS && !l.ligne_bancaire_id)!.montant = 110
    expect(analyserEcritures(tiersFaux, aComptabiliser, true, paiementsDesPieces([paiement()], []), ENGAGEMENT, null).piecesDesynchronisees).toEqual([p])
    const chargeFausse = genere()
    chargeFausse.find((l) => l.compte === ACHATS)!.montant = 110
    expect(analyserEcritures(chargeFausse, aComptabiliser, true, paiementsDesPieces([paiement()], []), ENGAGEMENT, null).piecesDesynchronisees).toEqual([p])
  })

  it('signale des règlements sans leur facture — la génération ne les produit jamais ainsi', () => {
    const reglementsSeuls = genere().filter((l) => l.ligne_bancaire_id)
    expect(analyserEcritures(reglementsSeuls, aComptabiliser, true, paiementsDesPieces([paiement()], []), ENGAGEMENT, null).piecesDesynchronisees).toEqual([p])
  })

  it('se tait sur une pièce sans date, dont la facture est au dépôt — comme en trésorerie', () => {
    const sansDate = { ...p, date_piece: null }
    const analyse = analyserEcritures(genere(sansDate), [{ piece: sansDate, compte: ACHATS, immobilisation: false }], true, paiementsDesPieces([paiement()], []), ENGAGEMENT, null)
    expect(analyse.piecesDesynchronisees).toEqual([])
  })

  it('exige le bon modèle : lu dans l’autre, chaque brouillon juste paraît périmé', () => {
    // C'est pour ça que le modèle n'a pas de valeur par défaut.
    const tresorerie = enBase(lignesChargeProduitPourPiece('d1', p, cible(ACHATS), true, [paiement()]))
    expect(analyserEcritures(tresorerie, aComptabiliser, true, paiementsDesPieces([paiement()], []), ENGAGEMENT, null).piecesDesynchronisees).toEqual([p])
    expect(analyserEcritures(genere(), aComptabiliser, true, paiementsDesPieces([paiement()], []), TRESORERIE, null).piecesDesynchronisees).toEqual([p])
  })
})

describe('ecrituresSansObjet — en engagement', () => {
  it('compte la charge et la TVA d’une facture immobilisée sans nature, pas sa dette ni ses règlements', () => {
    const p = piece({ id: 'immo', montant_ht: 100, montant_tva: 20, montant_ttc: 120 })
    const lignes = enBase(lignesEngagementPourPiece('d1', p, cible(ACHATS), true, '455000', [paiement({ piece_id: 'immo' })]))
    expect(ecrituresSansObjet(lignes, [p], [categorie()], new Map([['immo', SANS_NATURE]]), null)).toEqual([
      { piece: p, motif: 'bien_sans_nature', nbLignes: 2, montant: 120 },
    ])
  })
})

describe('calculerBalance — les comptes de tiers', () => {
  it('nomme les comptes que l’engagement mouvemente', () => {
    const balance = calculerBalance(
      ['401000', '411000', '455000', '108000', '467000'].map((compte) => ecriture({ compte })), [], [],
    )
    expect(balance.map((l) => l.libelle)).toEqual([
      "Compte de l'exploitant", 'Fournisseurs', 'Clients', 'Associés — comptes courants', 'Divers comptes débiteurs et produits à recevoir',
    ])
  })
})

// ═══ L'écriture d'acquisition (ligne 26.6, étape b) ══════════════════════════════════════════════════
// La facture d'un bien immobilisé s'écrit sur le compte d'immobilisation de sa NATURE, pas en charge : sans
// elle, le FEC amortissait un bien qu'il n'avait jamais vu entrer, et la banque de l'application dépassait le
// relevé de tout ce que les biens avaient coûté. Sa TVA va au 445620 (ligne 19 de la CA3) et, en engagement,
// sa dette au 404000.
describe("l'écriture d'acquisition d'un bien", () => {
  const facture = piece({ montant_ht: 1000, montant_tva: 200, montant_ttc: 1200, tiers: 'Matériel Médical SA' })
  const reglement = paiement({ montant: -1200 })

  it('passe le hors taxe au compte du bien et la TVA au 445620, pour un dossier assujetti', () => {
    expect(lignesChargeProduitPourPiece('d1', facture, bien('218300'), true, [])).toEqual([
      expect.objectContaining({ compte: '218300', sens: 'debit', montant: 1000, date: '2026-03-10' }),
      expect.objectContaining({ compte: '445620', sens: 'debit', montant: 200, date: '2026-03-10' }),
    ])
  })

  it('passe le TTC au compte du bien pour un dossier exonéré, qui ne récupère pas la TVA', () => {
    expect(lignesChargeProduitPourPiece('d1', facture, bien('218300'), false, [])).toEqual([
      expect.objectContaining({ compte: '218300', sens: 'debit', montant: 1200 }),
    ])
  })

  it('inverse les sens d’un avoir sur immobilisation, la TVA comprise', () => {
    const avoir = piece({ montant_ht: -100, montant_tva: -20, montant_ttc: -120 })
    expect(lignesChargeProduitPourPiece('d1', avoir, bien('218300'), true, [])).toEqual([
      expect.objectContaining({ compte: '218300', sens: 'credit', montant: 100 }),
      expect.objectContaining({ compte: '445620', sens: 'credit', montant: 20 }),
    ])
  })

  it('en trésorerie : datée au paiement, face à la banque', () => {
    const lignes = lignesPourPiece('d1', facture, bien('218300'), true, payes(reglement), TRESORERIE)
    expect(lignes.map((l) => [l.compte, l.sens, l.montant, l.date, l.ligne_bancaire_id ?? null])).toEqual([
      ['218300', 'debit', 1000, '2026-01-05', null],
      ['445620', 'debit', 200, '2026-01-05', null],
      [COMPTE_BANQUE, 'credit', 1200, '2026-01-05', 'l1'],
    ])
  })

  it('en engagement : la facture à sa date, dette au 404000, puis le règlement à la date du paiement', () => {
    const lignes = lignesPourPiece('d1', facture, bien('218300'), true, payes(reglement), ENGAGEMENT)
    expect(lignes.map((l) => [l.compte, l.sens, l.montant, l.date, l.ligne_bancaire_id ?? null])).toEqual([
      ['218300', 'debit', 1000, '2026-03-10', null],
      ['445620', 'debit', 200, '2026-03-10', null],
      ['404000', 'credit', 1200, '2026-03-10', null],
      ['404000', 'debit', 1200, '2026-01-05', 'l1'],
      [COMPTE_BANQUE, 'credit', 1200, '2026-01-05', 'l1'],
    ])
    expect(lignes.some((l) => l.compte === COMPTE_FOURNISSEURS)).toBe(false)
  })

  it('une note de frais immobilisée reste due au dirigeant, pas au fournisseur d’immobilisations', () => {
    const ndf = piece({ type_piece: 'note_frais', montant_ht: 1000, montant_tva: 200, montant_ttc: 1200 })
    const lignes = lignesPourPiece('d1', ndf, bien('218300'), true, [], ENGAGEMENT)
    expect(lignes.at(-1)).toMatchObject({ compte: '455000', sens: 'credit', montant: 1200 })
  })

  // L'ALLER-RETOUR : ce que la génération écrit pour un bien, le contrôle l'accepte, dans les deux modèles et
  // les deux statuts — et la même pièce écrite en charge, il la dit « à régénérer ».
  it.each([
    [TRESORERIE, true], [TRESORERIE, false], [ENGAGEMENT, true], [ENGAGEMENT, false],
  ] as const)('ce que la génération produit, le contrôle l’accepte (%o, assujetti : %s)', (modele, assujetti) => {
    const cats = [categorie()]
    const biens = new Map([['p1', acq('218300')]])
    const aComptabiliser = piecesAComptabiliser([facture], cats, biens)
    const paiements = paiementsDesPieces([reglement], [])
    const acquisition = enBase(lignesPourPiece('d1', facture, bien('218300'), assujetti, payes(reglement), modele))
    const analyse = analyserEcritures(acquisition, aComptabiliser, assujetti, paiements, modele, null)
    expect(analyse.piecesDesynchronisees).toEqual([])
    expect(analyse.groupesDesequilibres).toEqual([])
    expect(ecrituresSansObjet(acquisition, [facture], cats, biens, null)).toEqual([])

    const enCharge = enBase(lignesPourPiece('d1', facture, cible(ACHATS), assujetti, payes(reglement), modele))
    expect(analyserEcritures(enCharge, aComptabiliser, assujetti, paiements, modele, null).piecesDesynchronisees).toEqual([facture])
  })

  it('dit « à régénérer » l’acquisition d’un bien qu’on a retiré du registre : elle repasse en charge', () => {
    const cats = [categorie()]
    const acquisition = enBase(lignesPourPiece('d1', facture, bien('218300'), true, payes(reglement), TRESORERIE))
    const aComptabiliser = piecesAComptabiliser([facture], cats, new Map())
    expect(analyserEcritures(acquisition, aComptabiliser, true, paiementsDesPieces([reglement], []), TRESORERIE, null).piecesDesynchronisees)
      .toEqual([facture])
  })

  it('voit une TVA d’acquisition restée en 445660 : la ventilation compte autant que le compte de charge', () => {
    // Le cas qui ne déplace aucun total : 1 000 sur le bien, 200 de TVA, mais au compte des biens et
    // services. Seul le compte de TVA attendu (`compteTvaDe`) le voit.
    const cats = [categorie()]
    const acquisition = enBase(lignesPourPiece('d1', facture, bien('218300'), true, payes(reglement), TRESORERIE))
      .map((e) => (e.compte === '445620' ? { ...e, compte: COMPTE_TVA_DEDUCTIBLE } : e))
    const aComptabiliser = piecesAComptabiliser([facture], cats, new Map([['p1', acq('218300')]]))
    expect(analyserEcritures(acquisition, aComptabiliser, true, paiementsDesPieces([reglement], []), TRESORERIE, null).piecesDesynchronisees)
      .toEqual([facture])
  })

  // DÉFENSIF, et dit comme tel : aucune génération ne partage la TVA d'un bien entre les deux comptes. Mais une
  // ligne au 445660 dans l'écriture d'un bien porterait sa TVA sur la mauvaise ligne de la CA3 sans déplacer un
  // centime du total ni du 445620 — seule la question « un autre compte ? » la voit.
  it('voit une ligne au 445660 à côté d’une TVA juste au 445620', () => {
    const cats = [categorie()]
    const acquisition = enBase(lignesPourPiece('d1', facture, bien('218300'), true, payes(reglement), TRESORERIE))
      .flatMap((e) => (e.compte === '218300'
        ? [{ ...e, montant: 995 }, { ...e, id: `${e.id}-tva`, compte: COMPTE_TVA_DEDUCTIBLE, montant: 5 }]
        : [e]))
    const aComptabiliser = piecesAComptabiliser([facture], cats, new Map([['p1', acq('218300')]]))
    expect(analyserEcritures(acquisition, aComptabiliser, true, paiementsDesPieces([reglement], []), TRESORERIE, null).piecesDesynchronisees)
      .toEqual([facture])
  })

  // En ENGAGEMENT, la dette au 404000 SOLDE l'écriture d'un bien : comptée parmi ce que la pièce porte en trop,
  // elle ferait annoncer « 0,00 € » pour l'acquisition d'un bien repris que la balance reprise porte déjà.
  it('compte ce que l’acquisition d’un bien repris porte en trop, sans la dette au 404000 qui la solde', () => {
    const acquisition = enBase(lignesPourPiece('d1', facture, bien('218300'), true, [], ENGAGEMENT))
    expect(acquisition.map((e) => e.compte)).toEqual(['218300', '445620', '404000'])
    expect(ecrituresSansObjet(acquisition, [facture], [categorie()], new Map([['p1', { compte: null, motif: 'repris' as const }]]), null))
      .toEqual([expect.objectContaining({ motif: 'bien_repris', nbLignes: 2, montant: 1200 })])
  })

  it('nomme les comptes que l’acquisition mouvemente', () => {
    const balance = calculerBalance(['218300', '205000', '445620', '404000'].map((compte) => ecriture({ compte })), [], [])
    expect(balance.map((l) => [l.compte, l.libelle])).toEqual([
      ['205000', 'Concessions et droits similaires, brevets, licences, logiciels'],
      ['218300', 'Matériel de bureau et matériel informatique'],
      ['404000', "Fournisseurs d'immobilisations"],
      ['445620', 'TVA déductible sur immobilisations'],
    ])
  })

  // Un compte de classe 2 qu'aucune nature du cabinet ne désigne garde un libellé — incorporelle en 20,
  // corporelle en 21 —, sans quoi la balance et le FEC le nommeraient de son seul numéro.
  it('nomme d’un libellé générique un compte d’immobilisation qu’aucune nature du cabinet ne désigne', () => {
    const balance = calculerBalance(['201100', '213500'].map((compte) => ecriture({ compte })), [], [])
    expect(balance.map((l) => [l.compte, l.libelle])).toEqual([
      ['201100', 'Immobilisations incorporelles'],
      ['213500', 'Immobilisations corporelles'],
    ])
  })
})

// LIGNE 26.6 (d) : CE QU'UN EXERCICE VALIDÉ A FIGÉ NE SE COMPARE PLUS ET NE S'ÉCRIT PLUS. La frontière est le
// 31 décembre du dernier exercice validé (lib/validationExercice.ts) : la base refuse toute écriture au plus tard à
// elle, et refuse de modifier ou de retirer celles qui y sont. Un contrôle qui jugerait encore une part figée dirait
// « à régénérer » pour toujours, sur un geste que la base refuse ; une génération qui l'écrirait ferait refuser le
// lot entier.
describe('la frontière de validation — une part figée ne se compare plus et ne s’écrit plus', () => {
  const FRONTIERE = '2025-12-31'
  const AUTRES_ACHATS = '606300'
  // Une facture de novembre 2025 payée en deux fois : 400 € en décembre, dans l'exercice validé, 600 € en février.
  // En trésorerie, chaque paiement porte sa part de la charge (lib/rattachement.ts) : la frontière coupe la pièce.
  const coupee = piece({ id: 'p1', date_piece: '2025-11-15', montant_ttc: 1000, tiers: 'Fournisseur' })
  const paiements = paiementsDesPieces([
    paiement({ id: 'l-dec', date: '2025-12-10', montant: -400 }),
    paiement({ id: 'l-fev', date: '2026-02-10', montant: -600 }),
  ], [])
  const attendues = (compte: string) => lignesPourPiece('d1', coupee, cible(compte), true, paiements.get('p1') ?? [], TRESORERIE)
  // Ce que la génération a écrit sur le compte d'alors ; la part de décembre a été validée avec 2025.
  const ecrite = (compte: string) => enBase(attendues(compte)).map((e) => (e.date <= FRONTIERE ? { ...e, statut: 'validee' as const } : e))
  const sur = (compte: string) => [{ piece: coupee, compte, immobilisation: false }]
  const resume = (lignes: readonly { date: string; compte: string; montant: number }[]) =>
    lignes.map((l) => `${l.date} ${l.compte} ${l.montant}`).sort()

  it('coupe la pièce : la part de décembre est figée, celle de février reste ouverte', () => {
    expect(resume(attendues(ACHATS))).toEqual(['2025-12-10 512000 400', '2025-12-10 606100 400', '2026-02-10 512000 600', '2026-02-10 606100 600'])
    expect(resume(lignesOuvertes(attendues(ACHATS), FRONTIERE))).toEqual(['2026-02-10 512000 600', '2026-02-10 606100 600'])
    // Sans exercice validé, rien n'est figé.
    expect(lignesOuvertes(attendues(ACHATS), null)).toEqual(attendues(ACHATS))
  })

  it('ne compare plus la part validée : la catégorie a changé de compte depuis, la part ouverte a été régénérée', () => {
    const regeneree = [...ecrite(ACHATS).filter((e) => e.date <= FRONTIERE), ...enBase(lignesOuvertes(attendues(AUTRES_ACHATS), FRONTIERE))]
    expect(analyserEcritures(regeneree, sur(AUTRES_ACHATS), true, paiements, TRESORERIE, FRONTIERE).piecesDesynchronisees).toEqual([])
    // Sans la frontière, la part validée la ferait dire « à régénérer » pour toujours.
    expect(analyserEcritures(regeneree, sur(AUTRES_ACHATS), true, paiements, TRESORERIE, null).piecesDesynchronisees).toEqual([coupee])
  })

  it('juge encore la part ouverte, ligne pour ligne', () => {
    // Encore sur l'ancien compte : « Régénérer » la réécrira.
    expect(analyserEcritures(ecrite(ACHATS), sur(AUTRES_ACHATS), true, paiements, TRESORERIE, FRONTIERE).piecesDesynchronisees).toEqual([coupee])
    // Telle que la génération l'écrit : rien à dire.
    expect(analyserEcritures(ecrite(ACHATS), sur(ACHATS), true, paiements, TRESORERIE, FRONTIERE).piecesDesynchronisees).toEqual([])
    // Absente, d'un autre montant, à une autre date, ou avec une ligne de trop : périmée.
    const ouverte = (e: EcritureBrouillon) => e.date > FRONTIERE
    const cas: EcritureBrouillon[][] = [
      ecrite(ACHATS).filter((e) => !ouverte(e)),
      ecrite(ACHATS).map((e) => (ouverte(e) && e.compte === ACHATS ? { ...e, montant: 599 } : e)),
      ecrite(ACHATS).map((e) => (ouverte(e) ? { ...e, date: '2026-02-11' } : e)),
      [...ecrite(ACHATS), ecriture({ id: 'en-trop', date: '2026-03-01', montant: 10 })],
    ]
    for (const ecritures of cas) {
      expect(analyserEcritures(ecritures, sur(ACHATS), true, paiements, TRESORERIE, FRONTIERE).piecesDesynchronisees).toEqual([coupee])
    }
  })

  // Sans aucune ligne, elle n'est pas « à régénérer » : elle est à générer, et la génération n'en écrit que la part
  // ouverte (`ecrituresAGenerer`).
  it('ne dit pas « à régénérer » une pièce coupée qui n’a encore aucune ligne', () => {
    expect(analyserEcritures([], sur(ACHATS), true, paiements, TRESORERIE, FRONTIERE).piecesDesynchronisees).toEqual([])
  })

  it('ne juge plus une pièce entièrement figée, même quand sa catégorie a changé de compte depuis', () => {
    const mars = piece({ id: 'p1', date_piece: '2025-03-10', montant_ttc: 120 })
    const payeeEnMars = paiementsDesPieces([paiement({ id: 'l-mars', date: '2025-03-12', montant: -120 })], [])
    const validee = enBase(lignesPourPiece('d1', mars, cible(ACHATS), true, payeeEnMars.get('p1') ?? [], TRESORERIE))
      .map((e) => ({ ...e, statut: 'validee' as const }))
    const recategorisee = [{ piece: mars, compte: AUTRES_ACHATS, immobilisation: false }]
    expect(analyserEcritures(validee, recategorisee, true, payeeEnMars, TRESORERIE, FRONTIERE).piecesDesynchronisees).toEqual([])
    expect(analyserEcritures(validee, recategorisee, true, payeeEnMars, TRESORERIE, null).piecesDesynchronisees).toEqual([mars])
  })

  // Le garde symétrique : une pièce que la frontière ne touche pas se juge comme avant, par le contrôle de son modèle,
  // qui compare des totaux et non des lignes. Cas DÉFENSIF : aucune génération n'écrit une charge en deux lignes,
  // mais un contrôle ligne pour ligne étendu à tout le brouillon dirait « à régénérer » d'écritures justes.
  it('juge une pièce que la frontière ne touche pas comme avant', () => {
    const avril = piece({ id: 'p1', date_piece: '2026-04-10', montant_ttc: 120 })
    const enDeuxLignes = [ecriture({ id: 'a', date: '2026-04-10', montant: 60 }), ecriture({ id: 'b', date: '2026-04-10', montant: 60 })]
    const surAchats = [{ piece: avril, compte: ACHATS, immobilisation: false }]
    expect(analyserEcritures(enDeuxLignes, surAchats, true, new Map(), TRESORERIE, FRONTIERE).piecesDesynchronisees).toEqual([])
    expect(analyserEcritures(enDeuxLignes, surAchats, true, new Map(), TRESORERIE, null).piecesDesynchronisees).toEqual([])
    // Et sur un autre compte qu'attendu, elle est périmée, frontière ou non.
    const ailleurs = [{ piece: avril, compte: AUTRES_ACHATS, immobilisation: false }]
    expect(analyserEcritures(enDeuxLignes, ailleurs, true, new Map(), TRESORERIE, FRONTIERE).piecesDesynchronisees).toEqual([avril])
  })

  it('en engagement, la facture validée ne se compare plus ; son règlement d’après la frontière, si', () => {
    const facture = piece({ id: 'p1', date_piece: '2025-12-20', montant_ttc: 120, tiers: 'Fournisseur' })
    const payee = paiementsDesPieces([paiement({ id: 'l-jan', date: '2026-01-05', montant: -120 })], [])
    const ecrites = enBase(lignesPourPiece('d1', facture, cible(ACHATS), true, payee.get('p1') ?? [], ENGAGEMENT))
      .map((e) => (e.date <= FRONTIERE ? { ...e, statut: 'validee' as const } : e))
    // La catégorie a changé de compte depuis la validation : la facture validée reste sur l'ancien.
    const recategorisee = [{ piece: facture, compte: AUTRES_ACHATS, immobilisation: false }]
    expect(analyserEcritures(ecrites, recategorisee, true, payee, ENGAGEMENT, FRONTIERE).piecesDesynchronisees).toEqual([])
    expect(analyserEcritures(ecrites, recategorisee, true, payee, ENGAGEMENT, null).piecesDesynchronisees).toEqual([facture])
    // Le règlement manque — le mouvement de janvier rapproché, son écriture pas encore là : la part ouverte le dit.
    const sansReglement = ecrites.filter((e) => e.date <= FRONTIERE)
    expect(analyserEcritures(sansReglement, recategorisee, true, payee, ENGAGEMENT, FRONTIERE).piecesDesynchronisees).toEqual([facture])
  })

  it('ne propose pas de retirer une écriture validée — la base le refuse —, et juge encore la part ouverte', () => {
    // Cas DÉFENSIF pour la part validée : la catégorie d'une pièce figée ne change plus, la base la fige avec elle.
    const sansCategorie = piece({ id: 'p1', date_piece: '2025-03-10', categorie_id: null })
    const validee = [ecriture({ id: 'v', date: '2025-03-10', statut: 'validee' })]
    expect(ecrituresSansObjet(validee, [sansCategorie], [categorie()], new Map(), FRONTIERE)).toEqual([])
    expect(ecrituresSansObjet(validee, [sansCategorie], [categorie()], new Map(), null)).toEqual([expect.objectContaining({ motif: 'sans_categorie' })])
    // La part ouverte d'une pièce coupée se signale encore, et seule elle est comptée.
    expect(ecrituresSansObjet(ecrite(ACHATS), [{ ...coupee, categorie_id: null }], [categorie()], new Map(), FRONTIERE))
      .toEqual([expect.objectContaining({ motif: 'sans_categorie', nbLignes: 1, montant: 600 })])
  })

  it('génère la part ouverte d’une pièce coupée et la nomme ; n’écrit rien d’une pièce entièrement figée', () => {
    const ouverte = piece({ id: 'p-ouverte', date_piece: '2026-03-10', montant_ttc: 50 })
    const figee = piece({ id: 'p-figee', date_piece: '2025-06-10', montant_ttc: 80 })
    const dejaEcrite = piece({ id: 'p-ecrite', date_piece: '2026-01-20', montant_ttc: 30 })
    const aComptabiliser = [coupee, ouverte, figee, dejaEcrite].map((p) => ({ piece: p, compte: ACHATS, immobilisation: false }))
    const existantes = [ecriture({ id: 'x', piece_id: 'p-ecrite', date: '2026-01-20', montant: 30 })]
    const generation = ecrituresAGenerer('d1', aComptabiliser, existantes, true, paiements, TRESORERIE, FRONTIERE)
    expect(generation.pieces.map((p) => p.id)).toEqual(['p1', 'p-ouverte'])
    expect(generation.lignes).toEqual([
      ...lignesOuvertes(attendues(ACHATS), FRONTIERE),
      ...lignesPourPiece('d1', ouverte, cible(ACHATS), true, [], TRESORERIE),
    ])
    expect(generation.dansUnExerciceValide.map((x) => [x.piece.id, x.suite])).toEqual([['p1', 'partielle'], ['p-figee', 'a_payer']])
    // Rien ne tombe dans l'exercice validé : la base refuserait le lot entier.
    expect(generation.lignes.every((l) => l.date > FRONTIERE)).toBe(true)
  })

  // Ce qui attend une pièce entièrement figée n'est pas le même pour toutes, et l'écran le dit (EcrituresTab) : seule
  // une part qui attend son paiement s'écrira un jour. Une note de frais compte à sa date, une pièce payée dans
  // l'exercice validé et une facture d'engagement y restent — l'écran ne doit pas promettre qu'elles s'écriront.
  it('dit ce qui attend chaque pièce figée, selon ce qui la date et selon le modèle', () => {
    const aPayer = piece({ id: 'p-a-payer', date_piece: '2025-06-10', montant_ttc: 80 })
    const note = piece({ id: 'p-note', date_piece: '2025-06-12', montant_ttc: 40, type_piece: 'note_frais' })
    const payee = piece({ id: 'p-payee', date_piece: '2025-06-14', montant_ttc: 60 })
    // Payée en partie dans l'exercice validé : le reste attend encore son paiement, et c'est lui qui l'emporte.
    const enPartie = piece({ id: 'p-en-partie', date_piece: '2025-06-16', montant_ttc: 100 })
    const reglees = paiementsDesPieces([
      paiement({ id: 'l-payee', date: '2025-06-20', montant: -60, piece_id: 'p-payee' }),
      paiement({ id: 'l-acompte', date: '2025-06-22', montant: -30, piece_id: 'p-en-partie' }),
    ], [])
    const aComptabiliser = [aPayer, note, payee, enPartie].map((p) => ({ piece: p, compte: ACHATS, immobilisation: false }))
    const suites = (modele: ModeleComptable) => ecrituresAGenerer('d1', aComptabiliser, [], true, reglees, modele, FRONTIERE)
      .dansUnExerciceValide.map((x) => [x.piece.id, x.suite])
    expect(suites(TRESORERIE)).toEqual([['p-a-payer', 'a_payer'], ['p-note', 'note_de_frais'], ['p-payee', 'payee'], ['p-en-partie', 'a_payer']])
    expect(suites(ENGAGEMENT)).toEqual([['p-a-payer', 'facture'], ['p-note', 'note_de_frais'], ['p-payee', 'facture'], ['p-en-partie', 'facture']])
    // Le garde symétrique : payée APRÈS la frontière, la même pièce s'écrit en partie, et c'est ce qu'on dit.
    const payeeEnJanvier = paiementsDesPieces([paiement({ id: 'l-jan', date: '2026-01-05', montant: -60, piece_id: 'p-payee' })], [])
    expect(ecrituresAGenerer('d1', [{ piece: payee, compte: ACHATS, immobilisation: false }], [], true, payeeEnJanvier, TRESORERIE, FRONTIERE).dansUnExerciceValide)
      .toEqual([])
    expect(ecrituresAGenerer('d1', [{ piece: payee, compte: ACHATS, immobilisation: false }], [], true, payeeEnJanvier, ENGAGEMENT, FRONTIERE).dansUnExerciceValide)
      .toEqual([{ piece: payee, suite: 'partielle' }])
  })

  it('sans exercice validé, génère tout et ne nomme rien', () => {
    const figee = piece({ id: 'p-figee', date_piece: '2025-06-10', montant_ttc: 80 })
    const aComptabiliser = [coupee, figee].map((p) => ({ piece: p, compte: ACHATS, immobilisation: false }))
    const generation = ecrituresAGenerer('d1', aComptabiliser, [], true, paiements, TRESORERIE, null)
    expect(generation.pieces.map((p) => p.id)).toEqual(['p1', 'p-figee'])
    expect(generation.lignes).toEqual([...attendues(ACHATS), ...lignesPourPiece('d1', figee, cible(ACHATS), true, [], TRESORERIE)])
    expect(generation.dansUnExerciceValide).toEqual([])
  })
})

// LA NOTE DE FRAIS EN TRÉSORERIE S'ÉCRIT FACE AU COMPTE DE L'EXPLOITANT : sans cette contrepartie, sa charge restait
// seule au brouillon, l'écriture de la pièce déséquilibrée, et la validation refusait son exercice en conseillant de
// « rapprocher son paiement » — qui n'existe pas, le dirigeant l'ayant payée de sa poche.
describe('la note de frais en trésorerie — face au compte de l’exploitant', () => {
  const FRAIS = '625100'
  const note = (o: Partial<Piece> = {}) => piece({ id: 'p-note', type_piece: 'note_frais', date_piece: '2026-03-10', montant_ttc: 40, tiers: 'Repas', ...o })
  const solde = (lignes: readonly Pick<LigneAGenerer, 'sens' | 'montant'>[]) =>
    lignes.reduce((s, l) => s + (l.sens === 'debit' ? 1 : -1) * Math.round(l.montant * 100), 0)
  const ligne = (l: LigneAGenerer) => [l.compte, l.sens, l.montant, l.date]

  it('écrit la charge et sa contrepartie au 108000, à la date de la pièce, et l’écriture s’équilibre', () => {
    const lignes = lignesPourPiece('d1', note(), cible(FRAIS), false, [], TRESORERIE)
    expect(lignes.map(ligne)).toEqual([[FRAIS, 'debit', 40, '2026-03-10'], [COMPTE_EXPLOITANT, 'credit', 40, '2026-03-10']])
    expect(lignes[1]).toMatchObject({ piece_id: 'p-note', libelle: 'Repas', statut: 'proposee' })
    expect(lignes[1].ligne_bancaire_id).toBeUndefined()
    expect(solde(lignes)).toBe(0)
  })

  it('sur un dossier assujetti, solde la charge ET sa TVA', () => {
    const lignes = lignesPourPiece('d1', note({ montant_ttc: 120, montant_tva: 20 }), cible(FRAIS), true, [], TRESORERIE)
    expect(lignes.map(ligne)).toEqual([
      [FRAIS, 'debit', 100, '2026-03-10'], [COMPTE_TVA_DEDUCTIBLE, 'debit', 20, '2026-03-10'], [COMPTE_EXPLOITANT, 'credit', 120, '2026-03-10'],
    ])
  })

  it('remboursée en entier par un virement rapproché, la banque la paie : pas de 108000', () => {
    const lignes = lignesPourPiece('d1', note(), cible(FRAIS), false, payes(paiement({ piece_id: 'p-note', montant: -40, date: '2026-04-02' })), TRESORERIE)
    expect(lignes.map((l) => l.compte)).toEqual([FRAIS, COMPTE_BANQUE])
    expect(solde(lignes)).toBe(0)
  })

  // Deux remboursements qui la couvrent à l'écart d'alignement près — 50 et 49 pour 100 — : la banque la paie
  // toute, la note n'a plus de part à elle, et rien ne passe au 108000. L'euro d'écart reste à aligner (#183).
  it('remboursée en deux fois à l’écart d’alignement près : pas de 108000', () => {
    const lignes = lignesPourPiece('d1', note({ montant_ttc: 100 }), cible(FRAIS), false, payes(
      paiement({ id: 'l1', piece_id: 'p-note', montant: -50, date: '2026-04-02' }),
      paiement({ id: 'l2', piece_id: 'p-note', montant: -49, date: '2026-04-09' }),
    ), TRESORERIE)
    expect(lignes.map((l) => l.compte)).not.toContain(COMPTE_EXPLOITANT)
    expect(lignes.filter((l) => l.compte === COMPTE_BANQUE).map((l) => l.montant)).toEqual([50, 49])
  })

  it('remboursée en partie, la banque paie sa part et le 108000 le reste, chacun à sa date', () => {
    const lignes = lignesPourPiece('d1', note({ montant_ttc: 100 }), cible(FRAIS), false,
      payes(paiement({ piece_id: 'p-note', montant: -60, date: '2026-04-02' })), TRESORERIE)
    expect(lignes.map(ligne)).toEqual([
      [FRAIS, 'debit', 40, '2026-03-10'], [FRAIS, 'debit', 60, '2026-04-02'],
      [COMPTE_BANQUE, 'credit', 60, '2026-04-02'], [COMPTE_EXPLOITANT, 'credit', 40, '2026-03-10'],
    ])
    expect(solde(lignes)).toBe(0)
  })

  // Un acompte versé AVANT la date de la note : la contrepartie paie la part du dirigeant, datée de la note — pas du
  // premier paiement venu.
  it('un acompte versé avant la date de la note : la contrepartie reste à la date de la note', () => {
    const lignes = lignesPourPiece('d1', note({ montant_ttc: 100 }), cible(FRAIS), false,
      payes(paiement({ piece_id: 'p-note', montant: -60, date: '2026-03-01' })), TRESORERIE)
    expect(lignes.map(ligne)).toEqual([
      [FRAIS, 'debit', 60, '2026-03-01'], [FRAIS, 'debit', 40, '2026-03-10'],
      [COMPTE_BANQUE, 'credit', 60, '2026-03-01'], [COMPTE_EXPLOITANT, 'credit', 40, '2026-03-10'],
    ])
  })

  // Une note incohérente — un hors taxe lu qui ne fait pas le TTC — dont la charge vaut déjà ce que la banque paie :
  // rien à solder, et aucune ligne à zéro euro.
  it('n’écrit pas de contrepartie à zéro quand la charge vaut déjà ce qui est payé', () => {
    const lignes = lignesPourPiece('d1', note({ montant_ttc: 120, montant_ht: 50, montant_tva: 10 }), cible(FRAIS), true,
      payes(paiement({ piece_id: 'p-note', montant: -60, date: '2026-04-02' })), TRESORERIE)
    expect(solde(lignes)).toBe(0)
    expect(lignes.filter((l) => l.compte === COMPTE_EXPLOITANT)).toEqual([])
  })

  it('sans date, prend celle du dépôt, comme la charge', () => {
    const lignes = lignesPourPiece('d1', note({ date_piece: null, created_at: '2026-05-02T09:00:00Z' }), cible(FRAIS), false, [], TRESORERIE)
    expect(lignes.map((l) => l.date)).toEqual(['2026-05-02', '2026-05-02'])
  })

  it('une note de frais négative — un trop-perçu rendu — passe dans l’autre sens', () => {
    const lignes = lignesPourPiece('d1', note({ montant_ttc: -30 }), cible(FRAIS), false, [], TRESORERIE)
    expect(lignes.map(ligne)).toEqual([[FRAIS, 'credit', 30, '2026-03-10'], [COMPTE_EXPLOITANT, 'debit', 30, '2026-03-10']])
  })

  it('le solde se calcule au centime, quelle que soit la répartition des centimes', () => {
    // 10,01 + 1,99 réglés pour 6,00 : la charge et la TVA s'arrondissent chacune de leur côté.
    const lignes = lignesPourPiece('d1', note({ montant_ttc: 12, montant_tva: 1.99 }), cible(FRAIS), true,
      payes(paiement({ piece_id: 'p-note', montant: -6, date: '2026-04-02' })), TRESORERIE)
    expect(solde(lignes)).toBe(0)
  })

  it('rien pour une pièce qui n’est pas une note de frais, ni en engagement', () => {
    expect(lignesPourPiece('d1', note({ type_piece: 'achat' }), cible(FRAIS), false, [], TRESORERIE).map((l) => l.compte)).toEqual([FRAIS])
    expect(ligneContrepartieDirigeant('d1', note({ type_piece: 'achat' }), [{ sens: 'debit', montant: 40 }], [])).toBeNull()
    // En engagement, la dette au dirigeant passe déjà par le compte choisi pour le dossier (lib/engagement.ts).
    expect(lignesPourPiece('d1', note(), cible(FRAIS), false, [], ENGAGEMENT).map((l) => l.compte)).toEqual([FRAIS, '455000'])
  })

  describe('le contrôle des écritures', () => {
    const aComptabiliser = (p: Piece) => [{ piece: p, compte: FRAIS, immobilisation: false }]
    const analyse = (ecritures: EcritureBrouillon[], p: Piece, paiements = paiementsDesPieces([], [])) =>
      analyserEcritures(ecritures, aComptabiliser(p), false, paiements, TRESORERIE, null)

    it('ce que la génération écrit, il l’accepte — sans paiement, remboursée en partie ou en entier', () => {
      for (const montant of [null, -60, -100]) {
        const p = note({ montant_ttc: 100 })
        const mouvements = montant === null ? [] : [paiement({ piece_id: 'p-note', montant, date: '2026-04-02' })]
        const paiements = paiementsDesPieces(mouvements, [])
        const ecritures = enBase(lignesPourPiece('d1', p, cible(FRAIS), false, paiements.get('p-note') ?? [], TRESORERIE))
        expect(analyse(ecritures, p, paiements), `remboursement ${montant}`).toEqual({ nbSansContrepartie: 0, piecesSansContrepartie: [], groupesDesequilibres: [], piecesDesynchronisees: [] })
      }
    })

    // L'écriture générée AVANT : la charge seule. Elle n'attend aucun rapprochement — elle est à régénérer.
    it('l’écriture d’avant, sans sa contrepartie, est à régénérer, pas « en attente de rapprochement »', () => {
      const p = note()
      const charge = enBase(lignesChargeProduitPourPiece('d1', p, cible(FRAIS), false, []))
      expect(analyse(charge, p)).toEqual({ nbSansContrepartie: 0, piecesSansContrepartie: [], groupesDesequilibres: [], piecesDesynchronisees: [p] })
    })

    it('une contrepartie d’un autre montant est à régénérer, et l’écriture est déséquilibrée', () => {
      const p = note()
      const ecritures = enBase(lignesPourPiece('d1', p, cible(FRAIS), false, [], TRESORERIE)).map((e) =>
        e.compte === COMPTE_EXPLOITANT ? { ...e, montant: 35 } : e)
      const resultat = analyse(ecritures, p)
      expect(resultat.piecesDesynchronisees).toEqual([p])
      expect(resultat.groupesDesequilibres).toEqual([{ pieceId: 'p-note', solde: 5 }])
    })

    it('une contrepartie restée après un remboursement rapproché est à régénérer', () => {
      const p = note()
      const paiements = paiementsDesPieces([paiement({ piece_id: 'p-note', montant: -40, date: '2026-04-02' })], [])
      const avant = enBase(lignesPourPiece('d1', p, cible(FRAIS), false, [], TRESORERIE))
      const banque = enBase(lignesPourPiece('d1', p, cible(FRAIS), false, paiements.get('p-note')!, TRESORERIE))
        .filter((e) => e.compte === COMPTE_BANQUE).map((e) => ({ ...e, id: 'b1' }))
      const redatees = avant.map((e) => ({ ...e, date: '2026-04-02' }))
      expect(analyse([...redatees, ...banque], p, paiements).piecesDesynchronisees).toEqual([p])
      // Le garde symétrique : la contrepartie retirée, comme le fait le rapprochement, l'écriture est juste.
      expect(analyse([...redatees.filter((e) => e.compte !== COMPTE_EXPLOITANT), ...banque], p, paiements).piecesDesynchronisees).toEqual([])
    })

    it('une contrepartie à une autre date est à régénérer — sauf sur une pièce sans date', () => {
      const p = note()
      const ecritures = enBase(lignesPourPiece('d1', p, cible(FRAIS), false, [], TRESORERIE)).map((e) =>
        e.compte === COMPTE_EXPLOITANT ? { ...e, date: '2026-03-11' } : e)
      expect(analyse(ecritures, p).piecesDesynchronisees).toEqual([p])
      // Sans date de pièce, la date est celle du dépôt — un instant, lu dans le fuseau de qui génère.
      const sansDate = note({ date_piece: null, created_at: '2026-05-02T09:00:00Z' })
      const decalees = enBase(lignesPourPiece('d1', sansDate, cible(FRAIS), false, [], TRESORERIE)).map((e) =>
        e.compte === COMPTE_EXPLOITANT ? { ...e, date: '2026-05-01' } : e)
      expect(analyse(decalees, sansDate).piecesDesynchronisees).toEqual([])
    })

    // Le garde symétrique du modèle : en engagement, la dette au dirigeant passe déjà par le compte choisi, et une
    // note de frais sans règlement reste une facture qui attend le sien.
    it('en engagement, une note de frais sans règlement attend toujours le sien', () => {
      const p = note()
      const ecritures = enBase(lignesPourPiece('d1', p, cible(FRAIS), false, [], ENGAGEMENT))
      expect(analyserEcritures(ecritures, aComptabiliser(p), false, paiementsDesPieces([], []), ENGAGEMENT, null))
        .toEqual({ nbSansContrepartie: 1, piecesSansContrepartie: [p.id], groupesDesequilibres: [], piecesDesynchronisees: [] })
    })

    // Hors du jeu fourni, le type de la pièce n'est pas connu : une ligne au 108000 peut y être une CHARGE (un achat
    // rangé dans une catégorie au compte de l'exploitant). La banque seule fait foi, comme avant.
    it('hors du jeu fourni, une ligne au 108000 ne passe pas pour une contrepartie', () => {
      const p = note()
      const ecritures = enBase(lignesPourPiece('d1', p, cible(FRAIS), false, [], TRESORERIE)).map((e) =>
        e.compte === COMPTE_EXPLOITANT ? { ...e, montant: 30 } : e)
      const resultat = analyserEcritures(ecritures, [], false, paiementsDesPieces([], []), TRESORERIE, null)
      expect(resultat.nbSansContrepartie).toBe(1)
      expect(resultat.groupesDesequilibres).toEqual([])
    })

    // Le garde symétrique : un achat sans paiement reste « en attente de rapprochement ».
    it('un achat sans paiement attend toujours son rapprochement', () => {
      const p = note({ type_piece: 'achat' })
      expect(analyse(enBase(lignesPourPiece('d1', p, cible(FRAIS), false, [], TRESORERIE)), p).nbSansContrepartie).toBe(1)
    })

    // UNE CATÉGORIE DONT LE COMPTE EST LE 108000 — un achat classé en prélèvement personnel, ou une note de frais
    // rangée là : la charge EST au compte du dirigeant. La note n'y reçoit pas de contrepartie à part, qui
    // annulerait sa charge ; les deux suivent la règle de toute pièce, la banque de leur paiement.
    describe('rangée dans une catégorie au compte de l’exploitant', () => {
      const surLe108 = (p: Piece) => [{ piece: p, compte: COMPTE_EXPLOITANT, immobilisation: false }]
      const analyse108 = (ecritures: EcritureBrouillon[], p: Piece, paiements = paiementsDesPieces([], [])) =>
        analyserEcritures(ecritures, surLe108(p), false, paiements, TRESORERIE, null)

      it('la génération n’écrit pas de contrepartie qui annulerait la charge', () => {
        expect(lignesPourPiece('d1', note(), cible(COMPTE_EXPLOITANT), false, [], TRESORERIE).map(ligne))
          .toEqual([[COMPTE_EXPLOITANT, 'debit', 40, '2026-03-10']])
      })

      it('sans paiement, elle attend son rapprochement comme toute pièce — ni « déséquilibrée » ni « à régénérer »', () => {
        for (const type_piece of ['note_frais', 'achat'] as const) {
          const p = note({ type_piece })
          expect(analyse108(enBase(lignesPourPiece('d1', p, cible(COMPTE_EXPLOITANT), false, [], TRESORERIE)), p), type_piece)
            .toEqual({ nbSansContrepartie: 1, piecesSansContrepartie: [p.id], groupesDesequilibres: [], piecesDesynchronisees: [] })
        }
      })

      it('payée, son écriture face à la banque est juste', () => {
        const p = note()
        const paiements = paiementsDesPieces([paiement({ piece_id: 'p-note', montant: -40, date: '2026-04-02' })], [])
        const ecritures = enBase(lignesPourPiece('d1', p, cible(COMPTE_EXPLOITANT), false, paiements.get('p-note')!, TRESORERIE))
        expect(ecritures.map((e) => e.compte)).toEqual([COMPTE_EXPLOITANT, COMPTE_BANQUE])
        expect(analyse108(ecritures, p, paiements)).toEqual({ nbSansContrepartie: 0, piecesSansContrepartie: [], groupesDesequilibres: [], piecesDesynchronisees: [] })
      })
    })
  })
})
