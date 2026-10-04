import type { ExerciceValide } from '../lib/types'

// Un exercice validé de test. Seule l'année décide de ce qui est figé ; le reste de la ligne est celui d'un exercice
// validé sans écriture, pour que le type reste celui de la table.
export function exerciceValide(annee: number, autres: Partial<ExerciceValide> = {}): ExerciceValide {
  return {
    dossier_id: 'd1', annee, valide_le: `${annee + 1}-03-01T10:00:00Z`, valide_par: 'u-chef', mode_comptable: 'tresorerie',
    nb_lignes: 0, nb_ecritures: 0, total_debit: 0, total_credit: 0, empreinte_precedente: null,
    empreinte: 'empreinte-de-test', declaration: null, ...autres,
  }
}
