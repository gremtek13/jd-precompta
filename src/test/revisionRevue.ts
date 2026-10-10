import type { RevisionConclusion, RevisionNote, RevisionRevue } from '../lib/types'
import { AUTEUR, DOSSIER } from './revision'

// LES FABRIQUES DES TESTS DES CYCLES DE LA RÉVISION (ligne 41, étape R4) : une ligne entière de chaque table de l'étape
// — colonnes NOT NULL comprises —, que chaque cas complète de ce qui le distingue. Des jeux FICTIFS.

export const CHEF = 'c4ef0000-0000-4000-8000-000000000001'

export function conclusion(o: Partial<RevisionConclusion>): RevisionConclusion {
  return {
    id: 'k', dossier_id: DOSSIER, annee: 2025, cycle: 'tresorerie', etat: 'revise', travaux: [], conclusion: 'Conclusion fictive',
    a_suivre: null, remplace_id: null, auteur: AUTEUR, cree_le: '2026-02-01T10:00:00+00:00', ...o,
  }
}

export function noteDuJournal(o: Partial<RevisionNote>): RevisionNote {
  return {
    id: 'n', dossier_id: DOSSIER, annee: 2025, cycle: 'tresorerie', nature: 'travail', texte: 'Note fictive', auteur: AUTEUR,
    cree_le: '2026-02-01T11:00:00+00:00', ...o,
  }
}

export function revue(o: Partial<RevisionRevue>): RevisionRevue {
  return {
    id: 'v', dossier_id: DOSSIER, annee: 2025, conclusion_id: 'k', avis: 'approuve', observation: null, revu_par: CHEF,
    revu_le: '2026-02-01T12:00:00+00:00', ...o,
  }
}
