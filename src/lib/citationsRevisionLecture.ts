import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { refusDuRetraitDUneSource } from './revision'
import type { RevisionJustification, RevisionPreuve } from './types'

// CE QUE LA RÉVISION DES SOLDES CITE, lu pour que les écrans qui retirent une pièce ou un document le disent AVANT le
// clic (ligne 41, étape R3). Une pièce ou un document cité par une décision — même remplacée depuis : l'historique garde
// ses preuves — ne se supprime plus, sauf avec son dossier (hypothèse Q8 du cabinet, `garder_source_citee`). La phrase
// est celle de la base, composée par `refusDuRetraitDUneSource` (lib/revision.ts) ; ce module ne fait que lire ce
// qu'elle demande : les décisions et les preuves de TOUT le dossier, quel que soit leur exercice.
//
// `motif` : non nul quand l'une des deux lectures est partielle. Une source citée peut alors paraître supprimable — la
// base refusera, avec sa raison —, et l'écran le dit plutôt que de laisser croire la liste complète.
export interface LectureDesCitations {
  decisions: Pick<RevisionJustification, 'id' | 'annee' | 'compte'>[]
  preuves: Pick<RevisionPreuve, 'justification_id' | 'piece_id' | 'document_id'>[]
  motif: string | null
}

export async function lireCitationsDeLaRevision(dossierId: string): Promise<LectureDesCitations> {
  const [lectureDecisions, lecturePreuves] = await Promise.all([
    lireTout<Pick<RevisionJustification, 'id' | 'annee' | 'compte'>>((debut, fin) =>
      supabase.from('revision_justifications').select('id, annee, compte', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
    lireTout<Pick<RevisionPreuve, 'justification_id' | 'piece_id' | 'document_id'>>((debut, fin) =>
      supabase.from('revision_preuves').select('id, justification_id, piece_id, document_id', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
  ])
  return {
    decisions: lectureDecisions.lignes,
    preuves: lecturePreuves.lignes,
    motif: [lectureDecisions, lecturePreuves].find((l) => !l.complete)?.motif ?? null,
  }
}

/**
 * Le refus de la base pour la SUPPRESSION de cette source, mot pour mot, ou rien quand ce qui a été lu ne la cite pas.
 * Rien non plus avant la première lecture : la base reste juge, et elle dit sa raison.
 */
export function refusDeSuppression(
  source: { pieceId: string } | { documentId: string },
  citations: LectureDesCitations | null,
): string | null {
  if (citations === null) return null
  return refusDuRetraitDUneSource(source, 'suppression', citations.decisions, citations.preuves)
}
