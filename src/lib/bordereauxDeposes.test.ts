import { describe, expect, it } from 'vitest'
import {
  cibleDesBordereaux, ciblesDesBordereaux, nomDuBordereau, nombreDeBordereauxDeposes, ordonnerLesBordereaux, phraseDeLaRecherche,
  PREFILTRE_DES_BORDEREAUX,
} from './bordereauxDeposes'

// LES BORDEREAUX DÉJÀ DÉPOSÉS (BOR6T-Q2 (A)). Des textes FICTIFS, écrits pour ce test : aucun bordereau réel.

const TITRE = 'Bordereau de Teletransmission'
const ENTETE = 'Facture Date Prescription Numéro Assuré Nom Bénéficiaire Naissance Total Caisse Mutuelle Assuré'

describe('ciblesDesBordereaux', () => {
  it('retient la pièce au titre, le document à l’en-tête des colonnes, et rien d’autre', () => {
    expect(ciblesDesBordereaux([
      { piece_id: 'p-titre', document_id: null, texte: `CABINET FICTIF\n${TITRE}\nLot 12` },
      { piece_id: null, document_id: 'd-entete', texte: `page 2\n${ENTETE}\n001 PATIENT FICTIF` },
      // Le titre dans une phrase n'est pas un titre (la règle de BOR1, mesurée dans refusDesBordereaux.test.ts).
      { piece_id: 'p-facture', document_id: null, texte: 'FACTURE\nImpression du bordereau de télétransmission 12,00' },
      { piece_id: 'p-remise', document_id: null, texte: 'Bordereau de remise de chèques\nTotal 120,00' },
      { piece_id: 'p-vide', document_id: null, texte: null },
    ])).toEqual({ pieces: ['p-titre'], documents: ['d-entete'] })
  })

  it('un texte reconnu de chaque côté se compte une fois', () => {
    expect(ciblesDesBordereaux([
      { piece_id: 'p', document_id: null, texte: TITRE },
      { piece_id: 'p', document_id: null, texte: TITRE },
    ]).pieces).toEqual(['p'])
  })

  it('le tri de la base laisse passer tout ce que le jugement reconnaît', () => {
    // `ilike` de PostgreSQL : sans égard à la casse ; ici, la même règle en expression régulière.
    const termes = PREFILTRE_DES_BORDEREAUX.split(',').map((t) => t.replace(/^texte\.ilike\.\*/, '').replace(/\*$/, ''))
    expect(termes).toEqual(['bordereau', 'naissance'])
    for (const texte of [TITRE, TITRE.toUpperCase(), ENTETE, ENTETE.toUpperCase()]) {
      expect(ciblesDesBordereaux([{ piece_id: 'p', document_id: null, texte }]).pieces).toEqual(['p'])
      expect(termes.some((t) => texte.toLowerCase().includes(t))).toBe(true)
    }
  })
})

describe('les mots', () => {
  it('nomme par la date de dépôt, jamais autrement', () => {
    expect(nomDuBordereau({ type: 'piece', deposeLe: '2026-03-12' })).toBe('Pièce déposée le 12/03/2026')
    expect(nomDuBordereau({ type: 'document', deposeLe: '2026-03-12' })).toBe('Document déposé le 12/03/2026')
  })

  it('ordonne par le dépôt, puis l’identifiant', () => {
    expect(ordonnerLesBordereaux([
      { type: 'piece', id: 'b', deposeLe: '2026-02-01T10:00:00Z' },
      { type: 'document', id: 'c', deposeLe: '2026-01-01T10:00:00Z' },
      { type: 'piece', id: 'a', deposeLe: '2026-02-01T10:00:00Z' },
    ]).map((b) => b.id)).toEqual(['c', 'a', 'b'])
  })

  it('ne compte que d’une recherche finie, et le dit sinon', () => {
    const trouves = { etat: 'trouves' as const, dossierId: 'd', bordereaux: [{ type: 'document' as const, id: 'x', deposeLe: '2026-01-01' }] }
    expect(nombreDeBordereauxDeposes(null)).toBe(0)
    expect(nombreDeBordereauxDeposes({ etat: 'incomplete', dossierId: 'd', motif: 'm' })).toBe(0)
    expect(nombreDeBordereauxDeposes(trouves)).toBe(1)
    expect(cibleDesBordereaux(trouves)).toBe('documents')
    expect(cibleDesBordereaux(null)).toBe('pieces')
    expect(phraseDeLaRecherche({ etat: 'incomplete', dossierId: 'd', motif: 'coupé' })).toMatch(/rien ne se conclut/)
    expect(phraseDeLaRecherche({ etat: 'trouves', dossierId: 'd', bordereaux: [] })).toMatch(/^Aucune pièce/)
    expect(phraseDeLaRecherche(trouves)).toMatch(/ouvre sa fiche/)
  })
})
