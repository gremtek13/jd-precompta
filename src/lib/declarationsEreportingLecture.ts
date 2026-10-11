import { supabase } from './supabase'
import { lireTout, type LectureComplete } from './lectureComplete'
import type { DeclarationEreportingHorsApplication, SourceDeclarationEreporting } from './types'

// LES DÉCLARATIONS D'E-REPORTING D'UN DOSSIER ET LEURS SOURCES (ligne 28.5, étape e5b1), lues EN ENTIER, remplacées
// comprises : l'active d'une période se lit sur la chaîne de ses déclarations (lib/declarationsEreporting.ts), et ce
// qu'une remplacée avait déclaré reste l'histoire de la période. Ce sont les deux sources que les refus de
// `declarer_ereporting_hors_application` lisent avant le clic (`refusDeclaration`), que « à rectifier » compare au calcul
// d'aujourd'hui (`etatDeLaDeclaration`), et que la garde d'une pièce déclarée lit (`declarationQuiRetientLaPiece`) ;
// chacune garde son drapeau `complete`, que l'appelant transmet tel quel — une lecture partielle ne commande aucune
// écriture, et ne dit pas qu'une période est déclarée, ni qu'elle ne l'est pas.
//
// Le dossier ENTIER : une période se déclare une fois par dossier, et une source déclarée dans une période retient sa
// pièce, quelle que soit celle qu'on regarde.
export interface LectureDesDeclarations {
  declarations: LectureComplete<DeclarationEreportingHorsApplication>
  sources: LectureComplete<SourceDeclarationEreporting>
  /** Non nul quand l'une des deux lectures est partielle : l'écran le dit (`BandeauLecturePartielle`) et n'offre aucun
   * geste. */
  motif: string | null
}

export async function lireDeclarationsEreporting(dossierId: string): Promise<LectureDesDeclarations> {
  const [declarations, sources] = await Promise.all([
    lireTout<DeclarationEreportingHorsApplication>((debut, fin) =>
      supabase.from('declarations_ereporting').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
    lireTout<SourceDeclarationEreporting>((debut, fin) =>
      supabase.from('declarations_ereporting_sources').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('declaration_id').order('genre').order('source_id').range(debut, fin),
    ),
  ])
  return { declarations, sources, motif: [declarations, sources].find((l) => !l.complete)?.motif ?? null }
}
