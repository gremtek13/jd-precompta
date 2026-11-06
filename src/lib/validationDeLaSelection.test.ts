import { describe, expect, it } from 'vitest'
import { confirmationDeLaSelection, RAISON_SANS_MONTANT, selectionDeLaValidation } from './validationDeLaSelection'
import type { JugeDeLaValidation } from './lotsDeLaJumelleInversee'
import type { Piece } from './types'

// « VALIDER LA SÉLECTION » DIT TOUT CE QUI PART, ET TOUT CE QUI NE PART PAS (relecture du 04/11/2026, D7). Le module seul ; le
// câblage de l'écran est gardé par PiecesTab.relecture.test.tsx et PiecesTab.validationEnLot.test.tsx. Données FICTIVES.

const piece = (o: Partial<Piece> & Pick<Piece, 'id'>): Piece => ({
  dossier_id: 'd1', uploaded_by: null, source: 'upload', storage_path: `d1/${o.id}.pdf`, nom_fichier: `${o.id}.pdf`, storage_hash: null,
  date_piece: '2025-06-02', tiers: 'ALPHA', montant_ht: null, montant_tva: null, montant_ttc: 42, devise: 'EUR', montant_devise: null,
  taux_change: null, conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'achat', statut: 'a_valider', 
  confiance: 'haute', superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null, identite_numero: null,
  identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null, vente_hors_des_factures: false,
  created_at: '2026-11-20T09:00:00Z', updated_at: '2026-11-20T09:00:00Z', ...o,
})
const DORMANTE: JugeDeLaValidation = { etat: 'dormante' }
const SANS_DOUBLON = new Map<string, Piece[]>()

describe('selectionDeLaValidation', () => {
  it('écarte la pièce sans montant avec sa raison ; le reste part, dans l’ordre de la sélection', () => {
    const r = selectionDeLaValidation([piece({ id: 'a' }), piece({ id: 'vide', montant_ttc: null }), piece({ id: 'b' })], DORMANTE, SANS_DOUBLON)
    expect(r.aValider.map((p) => p.id)).toEqual(['a', 'b'])
    expect(r.ecartees).toEqual([{ piece: expect.objectContaining({ id: 'vide' }), raison: RAISON_SANS_MONTANT }])
    expect(r.aSignaler).toEqual([])
  })

  it('signale ce qui part et mérite un regard : sans date, confiance basse, doublon probable — une pièce validée, jamais', () => {
    const autre = piece({ id: 'photo', nom_fichier: 'IMG_3001.jpg' })
    const r = selectionDeLaValidation([
      piece({ id: 'sans-date', date_piece: null }),
      piece({ id: 'basse', confiance: 'basse', montant_ttc: 4120 }),
      piece({ id: 'double' }),
      piece({ id: 'deja', statut: 'validee', date_piece: null, confiance: 'basse' }),
    ], DORMANTE, new Map([['double', [autre]], ['deja', [autre]]]))
    expect(r.aValider.map((p) => p.id)).toEqual(['sans-date', 'basse', 'double', 'deja'])
    expect(r.aSignaler.map((s) => [s.piece.id, s.motifs.length])).toEqual([['sans-date', 1], ['basse', 1], ['double', 1]])
    expect(r.aSignaler[1].motifs[0].replace(/\s/g, ' ')).toBe('confiance basse de la lecture (4 120,00 €) : un champ est peut-être faux')
    expect(r.aSignaler[2].motifs[0]).toBe('doublon probable de « IMG_3001.jpg »')
  })

  it('la garde G3 écarte après le montant, sous ses mots', () => {
    const r = selectionDeLaValidation([piece({ id: 'vente', type_piece: 'vente' }), piece({ id: 'vide', montant_ttc: null })],
      { etat: 'non_lue', motif: null }, SANS_DOUBLON)
    expect(r.aValider).toEqual([])
    expect(r.ecartees.map((e) => e.piece.id)).toEqual(['vide', 'vente'])
  })
})

describe('confirmationDeLaSelection', () => {
  it('nulle quand rien ne mérite un regard ; sinon, nomme chaque pièce et ses motifs, et dit ce que fait Annuler', () => {
    expect(confirmationDeLaSelection(3, [])).toBeNull()
    const texte = confirmationDeLaSelection(1, [{ piece: piece({ id: 'x' }), motifs: ['sans date', 'doublon probable de « y.pdf »'] }])
    expect(texte).toBe('Valider 1 pièce ?\n\nL’une d’elles mérite un regard avant :\n• x.pdf — sans date ; doublon probable de « y.pdf »'
      + '\n\nOK valide toute la sélection ; Annuler ne valide rien, pour les ouvrir une à une.')
  })

  it('nomme les dix premières, et compte le reste', () => {
    const douze = Array.from({ length: 12 }, (_, i) => ({ piece: piece({ id: `p${i}` }), motifs: ['sans date'] }))
    const texte = confirmationDeLaSelection(12, douze) ?? ''
    expect(texte.match(/^• /gm)).toHaveLength(10)
    expect(texte).toContain('… et 2 autre(s)')
    expect(texte).toContain('12 d’entre elles méritent un regard avant :')
  })
})
