import { describe, expect, it } from 'vitest'
import {
  detailDesNotesRapprochees, estNoteDeLExploitant, horsDesNotesDeLExploitant, notesDeFraisRapprochees, notesRembourseesPeutEtre,
  refusNoteDeFraisAuReleve,
} from './noteDeFraisEnTresorerie'
import { SANS_FACTURE_SOURCE } from '../test/ventesFacturees'
import type { PaiementDePiece } from './rattachement'
import type { LigneBancaire, Piece } from './types'

// Données FICTIVES.
const piece = (o: Partial<Piece> = {}): Piece => ({
  id: 'n1', dossier_id: 'd1', uploaded_by: null, source: 'upload', storage_path: 'd1/n1.pdf', nom_fichier: 'n1.pdf', storage_hash: null,
  date_piece: '2025-12-20', tiers: null, montant_ht: null, montant_tva: null, montant_ttc: 84.5, devise: 'EUR', montant_devise: null,
  taux_change: null, conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'note_frais', statut: 'validee',
  confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null, identite_numero: null,
  identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null, vente_hors_des_factures: false,
  created_at: '2025-12-20T09:00:00Z', updated_at: '2025-12-20T09:00:00Z', ...o,
})

const ligne = (o: Partial<LigneBancaire> = {}): LigneBancaire => ({
  id: 'm1', dossier_id: 'd1', date: '2025-12-23', libelle: 'VIREMENT FICTIF', montant: -84.5, statut: 'non_rapprochee', piece_id: null,
  cotisation_id: null, categorie_id: null, taux_tva: null, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null,
  emprunt_assurance: null, ventilee: false, reglement_groupe: false, compte_bilan: null, declaration_tva_id: null,
  prelevement_personnel: false, source_fichier: 'releve.csv', libelle_brut: 'VIREMENT FICTIF', id_externe: null,
  created_at: '2025-12-24T10:00:00Z', encaissements_de_factures: false, ...o,
})

const AUCUNE = new Set<string>()

describe('la note de frais de l’exploitant en trésorerie (conception 58, § 2.1)', () => {
  it('n’est une note de l’exploitant qu’en trésorerie, et sort des justificatifs du relevé', () => {
    const achat = piece({ id: 'a1', type_piece: 'achat' })
    expect(estNoteDeLExploitant(piece(), 'tresorerie')).toBe(true)
    expect(estNoteDeLExploitant(piece(), 'engagement')).toBe(false)
    expect(horsDesNotesDeLExploitant([piece(), achat], 'tresorerie')).toEqual([achat])
    expect(horsDesNotesDeLExploitant([piece(), achat], 'engagement')).toHaveLength(2)
    expect(refusNoteDeFraisAuReleve(piece(), 'tresorerie')).toContain('virement personnel')
    expect(refusNoteDeFraisAuReleve(piece(), 'engagement')).toBeNull()
    expect(refusNoteDeFraisAuReleve(achat, 'tresorerie')).toBeNull()
    expect(refusNoteDeFraisAuReleve(undefined, 'tresorerie')).toBeNull()
  })

  it('un débit du même montant la rembourse peut-être ; ni un crédit, ni en engagement, ni une note déjà rapprochée', () => {
    expect(notesRembourseesPeutEtre(ligne(), [piece()], AUCUNE, SANS_FACTURE_SOURCE, 'tresorerie').map((p) => p.id)).toEqual(['n1'])
    // Le remboursement de janvier d'une note de décembre : dans la fenêtre de l'appariement.
    expect(notesRembourseesPeutEtre(ligne({ date: '2025-12-27' }), [piece()], AUCUNE, SANS_FACTURE_SOURCE, 'tresorerie')).toHaveLength(1)
    expect(notesRembourseesPeutEtre(ligne({ montant: 84.5 }), [piece()], AUCUNE, SANS_FACTURE_SOURCE, 'tresorerie')).toEqual([])
    expect(notesRembourseesPeutEtre(ligne(), [piece()], AUCUNE, SANS_FACTURE_SOURCE, 'engagement')).toEqual([])
    expect(notesRembourseesPeutEtre(ligne(), [piece()], new Set(['n1']), SANS_FACTURE_SOURCE, 'tresorerie')).toEqual([])
    expect(notesRembourseesPeutEtre(ligne(), [piece({ type_piece: 'achat' })], AUCUNE, SANS_FACTURE_SOURCE, 'tresorerie')).toEqual([])
    expect(notesRembourseesPeutEtre(ligne({ montant: -90 }), [piece()], AUCUNE, SANS_FACTURE_SOURCE, 'tresorerie')).toEqual([])
  })

  it('l’ancien rapprochement se dit, en trésorerie, sur un exercice ouvert, par le relevé seulement', () => {
    const parReleve: PaiementDePiece = { id: 'm1', date: '2026-01-05', montant: -84.5, origine: 'rapprochement' }
    const parCaisse: PaiementDePiece = { operation_caisse_id: 'o1', date: '2026-01-05', montant: -84.5, origine: 'caisse' }
    const note = piece()
    const r = notesDeFraisRapprochees([note, piece({ id: 'a1', type_piece: 'achat' })],
      new Map([['n1', [parReleve]], ['a1', [parReleve]]]), 'tresorerie', [])
    expect(r).toEqual([{ piece: note, datesDesMouvements: ['2026-01-05'] }])
    expect(detailDesNotesRapprochees(r)).toContain('la note du 20/12/2025')
    expect(detailDesNotesRapprochees(r)).toContain('payée par le mouvement du 05/01/2026')
    expect(notesDeFraisRapprochees([note], new Map([['n1', [parReleve]]]), 'engagement', [])).toEqual([])
    expect(notesDeFraisRapprochees([note], new Map([['n1', [parReleve]]]), 'tresorerie', [2026])).toEqual([])
    expect(notesDeFraisRapprochees([note], new Map([['n1', [parCaisse]]]), 'tresorerie', [])).toEqual([])
    expect(notesDeFraisRapprochees([note], new Map(), 'tresorerie', [])).toEqual([])
    expect(detailDesNotesRapprochees([])).toBeUndefined()
  })
})
