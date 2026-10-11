import { supabase } from './supabase'
import { lireTout, type LectureComplete } from './lectureComplete'
import type { PieceEcarteeEreporting, RegimeEreporting } from './types'

// LE RÉGIME D'E-REPORTING CONFIRMÉ D'UN DOSSIER, SON HISTOIRE, ET SES PIÈCES ÉCARTÉES (ligne 28.5, étape e5a), lus EN
// ENTIER, retirés compris : l'histoire se lit sur les lignes actives (lib/regimesEreporting.ts), et un écart retiré dit
// que sa pièce est de nouveau à vérifier. Ce sont les deux sources que le contenu d'une déclaration lit de la base
// (lib/ereporting.ts : `ContexteDeclaration.regimes`, `SourcesDesAchats.ecarts`) et que les refus des quatre fonctions
// lisent avant le clic (`refusConfirmationRegime`, `refusEcartPiece`) ; chacune garde son drapeau `complete`, que
// l'appelant transmet tel quel — des régimes lus en partie ne laissent rien juger, des écarts lus en partie rien
// déclarer.
//
// Le dossier ENTIER : un régime vaut pour le dossier, et la déclaration des achats regarde toutes ses pièces.
export interface LectureRegimesEtEcarts {
  regimes: LectureComplete<RegimeEreporting>
  ecarts: LectureComplete<PieceEcarteeEreporting>
  /** Non nul quand l'une des deux lectures est partielle : l'écran le dit (`BandeauLecturePartielle`) et n'offre
   * aucun geste — une lecture partielle ne commande aucune écriture. */
  motif: string | null
}

// Les régimes SEULS (étape e5c) : la carte de l'onglet TVA n'a pas besoin des écarts, et une lecture ratée des écarts ne
// doit pas lui faire dire qu'elle ne sait pas le régime. La table n'est nommée qu'ici (un seul site de lecture,
// `encaissementsEcritures.test.ts`). Le drapeau est recopié, non jeté (`lecturesSignalees.test.ts`).
export async function lireRegimes(dossierId: string): Promise<LectureComplete<RegimeEreporting>> {
  const lecture = await lireTout<RegimeEreporting>((debut, fin) =>
    supabase.from('regimes_ereporting').select('*', { count: 'exact' })
      .eq('dossier_id', dossierId).order('id').range(debut, fin),
  )
  return { lignes: lecture.lignes, complete: lecture.complete, motif: lecture.motif }
}

// Les écarts SEULS (étape e5c) : la fiche d'une pièce n'a besoin que d'eux.
export async function lireEcarts(dossierId: string): Promise<LectureComplete<PieceEcarteeEreporting>> {
  const lecture = await lireTout<PieceEcarteeEreporting>((debut, fin) =>
    supabase.from('pieces_ecartees_ereporting').select('*', { count: 'exact' })
      .eq('dossier_id', dossierId).order('id').range(debut, fin),
  )
  return { lignes: lecture.lignes, complete: lecture.complete, motif: lecture.motif }
}

export async function lireRegimesEtEcarts(dossierId: string): Promise<LectureRegimesEtEcarts> {
  const [regimes, ecarts] = await Promise.all([lireRegimes(dossierId), lireEcarts(dossierId)])
  return { regimes, ecarts, motif: [regimes, ecarts].find((l) => !l.complete)?.motif ?? null }
}
