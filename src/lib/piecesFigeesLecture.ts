import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { piecesFigees } from './validationExercice'
import type { EcritureBrouillon, Immobilisation } from './types'

// LES PIÈCES QU'UN EXERCICE VALIDÉ A FIGÉES, lues pour que les écrans le disent AVANT que la base refuse
// (`garder_piece_validee`) : une pièce qui porte une écriture validée, ou qui justifie un bien dont une écriture l'est
// — sa dotation, son acquisition. Le critère vit dans `piecesFigees` (lib/validationExercice.ts) ; ce module ne fait
// que le lire, sur les seules écritures VALIDÉES et les biens du dossier.
//
// `motif` : non nul quand l'une des deux lectures est partielle. Une pièce figée peut alors paraître modifiable — la
// base refusera de l'enregistrer, avec sa raison —, et l'écran le dit plutôt que de laisser croire la liste complète.
export interface LecturePiecesFigees {
  figees: Map<string, number>
  // Celles qui portent ELLES-MÊMES une écriture validée, et pas seulement le bien qu'elles justifient — la lecture ne rend
  // que des écritures validées. En trésorerie, elles ne se rapprochent plus d'aucun mouvement (voir BanqueTab) : leur
  // écriture, validée, s'équilibre déjà sans paiement.
  avecEcritureValidee: Set<string>
  motif: string | null
}

export async function lirePiecesFigees(dossierId: string): Promise<LecturePiecesFigees> {
  const lectureEcritures = await lireTout<Pick<EcritureBrouillon, 'id' | 'statut' | 'date' | 'piece_id' | 'immobilisation_id'>>(
    (debut, fin) => supabase.from('ecritures_brouillon').select('id, statut, date, piece_id, immobilisation_id', { count: 'exact' })
      .eq('dossier_id', dossierId).eq('statut', 'validee').order('date').order('id').range(debut, fin),
  )
  const lectureBiens = await lireTout<Pick<Immobilisation, 'id' | 'piece_id'>>(
    (debut, fin) => supabase.from('immobilisations').select('id, piece_id', { count: 'exact' })
      .eq('dossier_id', dossierId).order('id').range(debut, fin),
  )
  return {
    figees: piecesFigees(lectureEcritures.lignes, lectureBiens.lignes),
    avecEcritureValidee: new Set(lectureEcritures.lignes.flatMap((e) => (e.piece_id ? [e.piece_id] : []))),
    motif: [lectureEcritures, lectureBiens].find((l) => !l.complete)?.motif ?? null,
  }
}
