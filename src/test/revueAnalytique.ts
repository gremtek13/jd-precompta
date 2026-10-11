import type { LigneDeclaration } from '../lib/declaration2035'
import type { PartDuReleve } from '../lib/partsDuReleve'
import type { RevisionExplication, RevisionSeuil } from '../lib/types'
import { AUTEUR, DOSSIER, ligne } from './revision'

// LES FABRIQUES DES TESTS DE LA REVUE ANALYTIQUE (ligne 41, étape R5) : une ligne entière de chaque table de l'étape —
// colonnes NOT NULL comprises —, une part du relevé et une ligne de la 2035, que chaque cas complète de ce qui le
// distingue. Des jeux FICTIFS.

export function seuil(o: Partial<RevisionSeuil>): RevisionSeuil {
  return {
    id: 's', dossier_id: DOSSIER, annee: 2025, seuil: 1000, motif: 'Motif fictif', remplace_id: null, auteur: AUTEUR,
    cree_le: '2026-02-01T10:00:00+00:00', ...o,
  }
}

export function explication(o: Partial<RevisionExplication>): RevisionExplication {
  return {
    id: 'x', dossier_id: DOSSIER, annee: 2025, objet_type: 'compte', objet: '512000', nature: null, montant: 0,
    montant_precedent: null, source_precedent: 'aucune', explication: 'Explication fictive', remplace_id: null, auteur: AUTEUR,
    cree_le: '2026-02-01T11:00:00+00:00', ...o,
  }
}

export function posteDeclare(o: Partial<LigneDeclaration>): LigneDeclaration {
  return { poste: 'Poste fictif', nature: 'depense', montant: 0, nbPieces: 0, nbMouvements: 0, ...o }
}

// Une part du relevé comptée sans pièce : le mouvement entier pour une affectation, la part pour une ventilation.
export function part(o: Partial<PartDuReleve> & { ligneId?: string; date?: string; montantDuMouvement?: number }): PartDuReleve {
  const { ligneId = 'l', date = '2025-01-01', montantDuMouvement = -1, ...reste } = o
  return {
    ligne: ligne({ id: ligneId, date, montant: montantDuMouvement }), origine: 'affectation', libelle: 'Catégorie fictive',
    poste: 'Poste fictif', nature: 'depense', compte: '627000', taux: null, montantPoste: 1, montantReleve: montantDuMouvement,
    ...reste,
  }
}
