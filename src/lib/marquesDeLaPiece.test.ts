import { describe, expect, it } from 'vitest'
import {
  auteurDuGeste, CONTEXTE_D_UN_DOSSIER_NON_BASCULE, facturesDuVirementMixte, journalDeLaPiece, pieceAJour,
  type LigneDuJournal, type MarquesDeLaPiece,
} from './marquesDeLaPiece'
import type { EncaissementLu } from './encaissementsFactures'

// CE QU'UNE PIÈCE DE VENTE EST (lib/marquesDeLaPiece.ts, étape VF6c) : la marque relue après un geste, les factures d'un
// virement mixte classé (comme les rangs 14 et 15 de `designer_exemplaire_facture` les cherchent), le journal de la pièce —
// ordonné, et ce qui est resté dans un autre dossier (VF6B-Q1) —, et qui l'a fait, nommé seulement d'après ce qui a été lu.
// Données FICTIVES.
const D = 'd1'

describe('pieceAJour — la marque relue par la fiche, quand elle n’est pas plus ancienne', () => {
  const piece: MarquesDeLaPiece = {
    id: 'p1', dossier_id: D, type_piece: 'vente', statut: 'a_valider', nom_fichier: 'vente.pdf', facture_id: null,
    vente_hors_des_factures: false, updated_at: '2026-10-24T09:00:00.000000+00:00',
  }

  it('rien de relu : la pièce de l’écran appelant', () => {
    expect(pieceAJour(piece, null)).toBe(piece)
  })

  it('relue plus tard ou au même instant : sa marque l’emporte', () => {
    const relue = { ...piece, vente_hors_des_factures: true, updated_at: '2026-10-24T09:05:00.000000+00:00' }
    expect(pieceAJour(piece, relue)).toEqual(relue)
    expect(pieceAJour(piece, { ...piece, facture_id: 'f1' }).facture_id).toBe('f1')
  })

  it('relue plus tôt que la pièce que l’écran appelant a relue depuis : la plus récente reste', () => {
    expect(pieceAJour(piece, { ...piece, facture_id: 'f1', updated_at: '2026-10-24T08:00:00.000000+00:00' })).toBe(piece)
  })

  it('la relecture d’une autre pièce ne s’applique jamais', () => {
    expect(pieceAJour(piece, { ...piece, id: 'p2', facture_id: 'f1' })).toBe(piece)
  })
})

describe('facturesDuVirementMixte — un encaissement vivant, sur un mouvement classé, qui le justifie', () => {
  const enc = (o: Partial<EncaissementLu> & Pick<EncaissementLu, 'id'>): EncaissementLu => ({
    dossier_id: D, facture_id: 'f1', montant: 100, ligne_bancaire_id: 'm1', annule_id: null, retire_le: null, ...o,
  })
  const classes = new Set(['m1'])

  it('l’encaissement d’une facture sur un mouvement classé : sa facture', () => {
    expect([...facturesDuVirementMixte(D, [enc({ id: 'e1' })], classes)]).toEqual(['f1'])
  })

  it('ni un mouvement qui n’est pas classé, ni un encaissement sans mouvement', () => {
    expect([...facturesDuVirementMixte(D, [enc({ id: 'e1', ligne_bancaire_id: 'm2' })], classes)]).toEqual([])
    expect([...facturesDuVirementMixte(D, [enc({ id: 'e1', ligne_bancaire_id: null })], classes)]).toEqual([])
  })

  it('ni un encaissement retiré, ni celui d’un autre dossier', () => {
    expect([...facturesDuVirementMixte(D, [enc({ id: 'e1', retire_le: '2026-10-01T00:00:00Z' })], classes)]).toEqual([])
    expect([...facturesDuVirementMixte(D, [enc({ id: 'e1', dossier_id: 'd2' })], classes)]).toEqual([])
  })

  it('ni un encaissement qu’une contre-passation sans mouvement annule : il ne justifie plus son mouvement', () => {
    const annule = [enc({ id: 'e1' }), enc({ id: 'c1', annule_id: 'e1', ligne_bancaire_id: null, montant: -100 })]
    expect([...facturesDuVirementMixte(D, annule, classes)]).toEqual([])
  })

  it('hors d’un dossier basculé, le contexte n’a aucune facture d’un virement mixte, aucun lien, aucun pont, aucun exercice qui fige', () => {
    // Aucune facture n'y est source : rien ne fige une désignation de ce côté (le gel des désignations, VF7e).
    expect(CONTEXTE_D_UN_DOSSIER_NON_BASCULE).toEqual({
      dossierBascule: false, pont: { genre: 'aucune' },
      liens: { rapprochee: false, reglee: false, ecrite: false, lettree: false }, facturesDuVirementMixte: new Set(),
      exercicesValides: [],
    })
  })
})

describe('journalDeLaPiece — les gestes de ce dossier, ordonnés, et ceux restés ailleurs (VF6B-Q1)', () => {
  const ligne = (o: Partial<LigneDuJournal> & Pick<LigneDuJournal, 'id'>): LigneDuJournal => ({
    dossier_id: D, piece_id: 'p1', geste: 'designation', facture_id: 'f1', auteur_id: 'u1', fait_le: '2026-10-24T09:00:00Z', ...o,
  })

  it('du plus ancien au plus récent ; à un même instant, le retrait avant le geste qui le remplace', () => {
    const lignes = [
      // Un remplacement : deux lignes au même instant, dans l'ordre tiré des identifiants — le retrait passe d'abord.
      ligne({ id: 'a', geste: 'designation', facture_id: 'f2', fait_le: '2026-10-24T10:00:00Z' }),
      ligne({ id: 'b', geste: 'retrait_designation', facture_id: 'f1', fait_le: '2026-10-24T10:00:00Z' }),
      ligne({ id: 'z', geste: 'designation', facture_id: 'f1', fait_le: '2026-10-24T09:00:00Z' }),
      ligne({ id: 'c', geste: 'declaration', facture_id: null, fait_le: '2026-10-24T11:00:00Z' }),
      ligne({ id: 'd', geste: 'retrait_designation', facture_id: 'f2', fait_le: '2026-10-24T11:00:00Z' }),
    ]
    expect(journalDeLaPiece(lignes, D, 'p1').ici.map((l) => l.id)).toEqual(['z', 'b', 'a', 'd', 'c'])
    expect(journalDeLaPiece(lignes, D, 'p1').ailleurs).toEqual([])
  })

  it('un retrait de déclaration passe avant la désignation qui le remplace', () => {
    const lignes = [
      ligne({ id: 'a', geste: 'designation', fait_le: '2026-10-24T10:00:00Z' }),
      ligne({ id: 'b', geste: 'retrait_declaration', facture_id: null, fait_le: '2026-10-24T10:00:00Z' }),
    ]
    expect(journalDeLaPiece(lignes, D, 'p1').ici.map((l) => l.geste)).toEqual(['retrait_declaration', 'designation'])
  })

  it('les lignes d’un autre dossier ne sont pas d’ici : elles se comptent par dossier, dans l’ordre de leur premier geste', () => {
    const lignes = [
      ligne({ id: 'x1', dossier_id: 'ancien', fait_le: '2026-09-01T09:00:00Z' }),
      ligne({ id: 'x2', dossier_id: 'ancien', geste: 'retrait_designation', fait_le: '2026-09-02T09:00:00Z' }),
      ligne({ id: 'y1', dossier_id: 'autre', geste: 'declaration', facture_id: null, fait_le: '2026-09-03T09:00:00Z' }),
      ligne({ id: 'i1', fait_le: '2026-10-01T09:00:00Z' }),
    ]
    const j = journalDeLaPiece(lignes, D, 'p1')
    expect(j.ici.map((l) => l.id)).toEqual(['i1'])
    expect(j.ailleurs).toEqual([{ dossierId: 'ancien', gestes: 2 }, { dossierId: 'autre', gestes: 1 }])
  })

  it('les lignes d’une autre pièce ne sont jamais de celle-ci', () => {
    const j = journalDeLaPiece([ligne({ id: 'a', piece_id: 'p2' }), ligne({ id: 'b', piece_id: 'p2', dossier_id: 'ancien' })], D, 'p1')
    expect(j).toEqual({ ici: [], ailleurs: [] })
  })
})

describe('auteurDuGeste — nommé d’après ce qui a été lu, jamais deviné', () => {
  const equipe = { etat: 'lue' as const, courriels: new Map([['u2', 'collegue@cabinet-fictif.fr'], ['u3', '  ']]) }

  it('le compte connecté : « vous », avant toute équipe', () => {
    expect(auteurDuGeste('u1', 'u1', equipe)).toBe('vous')
    expect(auteurDuGeste('u1', 'u1', null)).toBe('vous')
  })

  it('un membre de l’équipe lue en entier : son adresse', () => {
    expect(auteurDuGeste('u2', 'u1', equipe)).toBe('collegue@cabinet-fictif.fr')
  })

  it('un compte que l’équipe lue ne nomme pas, une adresse vide, une équipe incomplète ou non lue : « un autre compte »', () => {
    expect(auteurDuGeste('u9', 'u1', equipe)).toBe('un autre compte')
    expect(auteurDuGeste('u3', 'u1', equipe)).toBe('un autre compte')
    expect(auteurDuGeste('u2', 'u1', { etat: 'incomplete', motif: 'refusée' })).toBe('un autre compte')
    expect(auteurDuGeste('u2', null, null)).toBe('un autre compte')
  })
})
