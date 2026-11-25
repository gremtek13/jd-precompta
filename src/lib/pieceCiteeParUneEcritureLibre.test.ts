import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  SUPPRESSION_CITEE_PAR_UNE_ECRITURE_LIBRE, ecrituresLibresQuiCitent, motifDesCitationsDesEcrituresLibres,
  refusDeSuppressionParLesEcrituresLibres, refusDeSuppressionParUneEcritureLibre, type CitationsDesEcrituresLibres,
} from './pieceCiteeParUneEcritureLibre'

// LA PIÈCE CITÉE PAR UNE ÉCRITURE LIBRE, DITE AVANT LE CLIC (ELQ8Q1-Q1 (A)). La phrase nomme l'écriture par sa référence, jamais par
// son libellé ni son motif ; une lecture partielle, refusée ou absente ne dit rien de cité ; le refus de la base (la clé étrangère
// d'EL2) se traduit après le clic.

const lues = (citations: { exercice: number; numero: number; piece_citee_id: string }[]): CitationsDesEcrituresLibres =>
  ({ dossierId: 'd1', etat: 'lues', citations })

describe('refusDeSuppressionParLesEcrituresLibres', () => {
  it('nomme l’écriture qui cite par sa référence, sur quatre chiffres', () => {
    expect(refusDeSuppressionParLesEcrituresLibres('p-1', lues([{ exercice: 2026, numero: 3, piece_citee_id: 'p-1' }]))).toBe(
      'Cette pièce est citée par l’écriture libre EL2026-0003 : elle ne se supprime plus, sauf avec son dossier. '
      + 'Pour la supprimer, retire d’abord la citation de l’écriture, dans l’onglet Écritures.',
    )
  })

  it('nomme toutes les écritures qui citent, dans l’ordre des exercices puis des numéros, et ignore la casse de l’identifiant', () => {
    const lecture = lues([
      { exercice: 2026, numero: 12, piece_citee_id: 'P-1' },
      { exercice: 2025, numero: 7, piece_citee_id: 'p-1' },
      { exercice: 2026, numero: 2, piece_citee_id: 'p-1' },
      { exercice: 2026, numero: 1, piece_citee_id: 'p-2' },
    ])
    expect(ecrituresLibresQuiCitent('p-1', lecture)).toEqual(['EL2025-0007', 'EL2026-0002', 'EL2026-0012'])
    expect(refusDeSuppressionParLesEcrituresLibres('p-1', lecture))
      .toMatch(/^Cette pièce est citée par les écritures libres EL2025-0007, EL2026-0002 et EL2026-0012 : elle ne se supprime plus/)
  })

  it('ne dit rien d’une pièce que rien ne cite, ni sur une lecture absente, partielle ou pas encore revenue', () => {
    expect(refusDeSuppressionParLesEcrituresLibres('p-9', lues([{ exercice: 2026, numero: 3, piece_citee_id: 'p-1' }]))).toBeNull()
    expect(refusDeSuppressionParLesEcrituresLibres('p-1', { dossierId: 'd1', etat: 'absentes' })).toBeNull()
    expect(refusDeSuppressionParLesEcrituresLibres('p-1', { dossierId: 'd1', etat: 'illisibles', motif: 'coupure' })).toBeNull()
    expect(refusDeSuppressionParLesEcrituresLibres('p-1', null)).toBeNull()
  })

  it('le motif ne vient que d’une lecture illisible', () => {
    expect(motifDesCitationsDesEcrituresLibres({ dossierId: 'd1', etat: 'illisibles', motif: 'coupure' })).toBe('coupure')
    expect(motifDesCitationsDesEcrituresLibres(lues([]))).toBeNull()
    expect(motifDesCitationsDesEcrituresLibres({ dossierId: 'd1', etat: 'absentes' })).toBeNull()
    expect(motifDesCitationsDesEcrituresLibres(null)).toBeNull()
  })
})

describe('refusDeSuppressionParUneEcritureLibre', () => {
  it('traduit le refus de la clé des écritures libres, et lui seul', () => {
    expect(refusDeSuppressionParUneEcritureLibre({
      code: '23503',
      message: 'update or delete on table "pieces" violates foreign key constraint "ecritures_libres_piece_citee_id_fkey" on table "ecritures_libres"',
    })).toBe(SUPPRESSION_CITEE_PAR_UNE_ECRITURE_LIBRE)
    expect(refusDeSuppressionParUneEcritureLibre({ code: '23503', message: 'x', details: 'Key (id)=(…) is still referenced from table "ecritures_libres".' }))
      .toBe(SUPPRESSION_CITEE_PAR_UNE_ECRITURE_LIBRE)
    expect(refusDeSuppressionParUneEcritureLibre({ code: '23503', message: 'violates foreign key constraint "operations_caisse_piece"' })).toBeNull()
    expect(refusDeSuppressionParUneEcritureLibre({ code: '42501', message: '"ecritures_libres"' })).toBeNull()
    expect(refusDeSuppressionParUneEcritureLibre(null)).toBeNull()
  })

  it('la clé que la traduction reconnaît est celle de la migration : sans clause `on delete`, sous son nom par défaut', () => {
    const racine = new URL('../../supabase/schema/', import.meta.url).pathname
    const fichier = readdirSync(racine).find((n) => /^\d{14}_ecritures_libres\.sql$/.test(n))
    expect(fichier).toBeTruthy()
    const texte = readFileSync(`${racine}${fichier}`, 'utf8')
    // NO ACTION : la base refuse la suppression d'une pièce citée. Une clause `on delete` changerait la règle, et ce module avec.
    expect(texte).toMatch(/\n {2}piece_citee_id uuid references public\.pieces\(id\),\n/)
    // Aucun nom explicite : PostgreSQL nomme la clé `ecritures_libres_piece_citee_id_fkey`.
    expect(texte).not.toMatch(/constraint \w+ foreign key \(piece_citee_id\)/i)
  })
})
