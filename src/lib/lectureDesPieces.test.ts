import { describe, expect, it, vi } from 'vitest'
import type { Piece } from './types'
import {
  avisDeLectureClient, badgeDeLaPieceNonLue, ceQuiManque, issueDeLaLecture, lectureIncompleteCabinet, pieceNonLue,
  rangSousAValider,
} from './lectureDesPieces'

// `extraction.ts` importe le client Supabase, qui lève sans variables d'environnement : remplacé par un objet vide, que les
// deux fonctions éprouvées ici ne touchent pas.
vi.mock('./supabase', () => ({ supabase: {} }))
const { conseilPdfTropLourd, pdfTropLourdPourEtreLu, TAILLE_MAX_LECTURE } = await import('./extraction')

// UNE LECTURE RATÉE SE DIT (relecture du 04/11/2026, D5 ; PIECES-Q5). Données fictives.

const piece = (o: Partial<Piece> = {}): Piece => ({
  id: 'p', statut: 'a_valider', montant_ht: null, montant_tva: null, montant_ttc: null, montant_devise: null, confiance: null,
  ...o,
} as Piece)

describe('l’issue d’une lecture, au dépôt', () => {
  it('rien de rendu : ratée ; sans date ou sans montant : incomplète ; tout : lue', () => {
    expect(issueDeLaLecture(null)).toBe('ratee')
    expect(issueDeLaLecture({ date_piece: null, montant_ttc: null, montant_ht: null, montant_tva: null })).toBe('incomplete')
    expect(issueDeLaLecture({ date_piece: '2025-03-10', montant_ttc: null, montant_ht: null, montant_tva: null })).toBe('incomplete')
    expect(issueDeLaLecture({ date_piece: null, montant_ttc: 12, montant_ht: null, montant_tva: null })).toBe('incomplete')
    expect(issueDeLaLecture({ date_piece: '2025-03-10', montant_ttc: null, montant_ht: 10, montant_tva: null })).toBe('lue')
  })

  it('ce qui manque se nomme, et s’accorde dans le message du cabinet', () => {
    expect(ceQuiManque({ date_piece: null, montant_ttc: null, montant_ht: null, montant_tva: null })).toBe('montant et date')
    expect(ceQuiManque({ date_piece: '2025-03-10', montant_ttc: null, montant_ht: null, montant_tva: 2 })).toBeNull()
    expect(lectureIncompleteCabinet('Classé', 'montant')).toBe('Classé — montant non lu, à saisir')
    expect(lectureIncompleteCabinet('Classé', 'date')).toBe('Classé — date non lue, à saisir')
    expect(lectureIncompleteCabinet('Classé', 'montant et date')).toBe('Classé — montant et date non lus, à saisir')
  })

  it('l’avis du praticien : rien, un fichier nommé, ou le compte et les noms', () => {
    expect(avisDeLectureClient([])).toBeNull()
    expect(avisDeLectureClient(['a.pdf'])).toBe('a.pdf : déposé, la lecture n’a pas abouti : ton cabinet le complétera.')
    expect(avisDeLectureClient(['a.pdf', 'b.jpg'])).toBe(
      '2 fichiers déposés, la lecture n’a pas abouti : ton cabinet les complétera (a.pdf, b.jpg).')
  })
})

describe('la pièce que rien n’a lue', () => {
  it('à valider et sans aucun montant — ni en euros, ni dans sa devise', () => {
    expect(pieceNonLue(piece())).toBe(true)
    expect(pieceNonLue(piece({ statut: 'validee' }))).toBe(false)
    expect(pieceNonLue(piece({ montant_ttc: 0 }))).toBe(false)
    expect(pieceNonLue(piece({ montant_tva: 2 }))).toBe(false)
    // Une pièce en dollars sans taux du jour : ses montants en euros sont vides, mais elle a été lue.
    expect(pieceNonLue(piece({ montant_devise: 24 }))).toBe(false)
  })

  it('son badge dit si une lecture a eu lieu', () => {
    expect(badgeDeLaPieceNonLue(piece())).toBe('Non lue')
    expect(badgeDeLaPieceNonLue(piece({ confiance: 'moyenne' }))).toBe('Montant non lu')
  })

  it('passe en tête de « À valider », avant l’impossibilité démontrée ; une confiance nulle au rang de « basse »', () => {
    // L'ordre que la relecture a vu à l'écran : basse, haute, haute, NULLE — la pièce non lue en dernier.
    const pieces = [
      piece({ id: 'basse', confiance: 'basse', montant_ttc: 10 }),
      piece({ id: 'haute', confiance: 'haute', montant_ttc: 10 }),
      piece({ id: 'nulle-saisie', confiance: null, montant_ttc: 10 }),
      piece({ id: 'demontree', confiance: 'haute', montant_ttc: 10 }),
      piece({ id: 'non-lue', confiance: null }),
    ]
    const tri = [...pieces].sort((a, b) => rangSousAValider(a, a.id === 'demontree') - rangSousAValider(b, b.id === 'demontree'))
    expect(tri.map((p) => p.id)).toEqual(['non-lue', 'demontree', 'basse', 'nulle-saisie', 'haute'])
  })
})

describe('le PDF trop lourd pour être lu', () => {
  const fichier = (name: string, size: number, type = '') => ({ name, size, type })

  it('un PDF au-delà de 10 Mio, par son type ou son nom — jamais une photo, que le navigateur réencode', () => {
    expect(TAILLE_MAX_LECTURE).toBe(10 * 1024 * 1024)
    expect(pdfTropLourdPourEtreLu(fichier('scan.pdf', TAILLE_MAX_LECTURE + 1))).toBe(true)
    expect(pdfTropLourdPourEtreLu(fichier('SCAN.PDF', TAILLE_MAX_LECTURE + 1))).toBe(true)
    expect(pdfTropLourdPourEtreLu(fichier('sans-extension', TAILLE_MAX_LECTURE + 1, 'application/pdf'))).toBe(true)
    expect(pdfTropLourdPourEtreLu(fichier('scan.pdf', TAILLE_MAX_LECTURE))).toBe(false)
    expect(pdfTropLourdPourEtreLu(fichier('photo.jpg', 15 * 1024 * 1024, 'image/jpeg'))).toBe(false)
  })

  it('le conseil nomme le fichier, son poids à la virgule, et le remède', () => {
    expect(conseilPdfTropLourd(fichier('scan.pdf', 15.25 * 1024 * 1024))).toBe(
      'scan.pdf (15,3 Mo) dépasse les 10 Mo que la lecture automatique accepte : il sera déposé sans être lu, sans date ni '
      + 'montant. Le mieux est de le scinder en plusieurs fichiers de moins de 10 Mo (une facture par fichier).')
  })
})
