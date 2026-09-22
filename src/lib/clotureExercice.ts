// Clôturer un exercice est le geste EXPLICITE qui déclenche la purge du texte OCR des pièces
// sensibles (justificatifs de recette — bordereaux de télétransmission, `type_piece === 'vente'`)
// de cet exercice. Décision du cabinet du 22/09/2026 (« Décisions en attente ») : option B —
// purger après clôture — restreinte aux pièces sensibles. Voir RGPD.md §8.3.
//
// Ce geste ne prétend PAS être une clôture comptable réelle : `ClotureTab` reste un brouillon (voir
// son bandeau), et ce module n'écrit ni résultat ni impôt. `exercices_clotures` n'existe que pour
// porter la date à laquelle le cabinet a demandé la purge — c'est la marque, pas le calcul.
//
// `type_piece` et non la classification d'origine : une fois orientée par `orientationDe`
// (extraction.ts), la classification transitoire `facture_vente` ne survit nulle part sur la pièce
// créée — seul `type_piece === 'vente'` reste stocké et capture « justificatif de recette ».
//
// La lecture des pièces sensibles passe par `lireTout` : `pieces` n'est pas une collection bornée
// (voir lib/lectureComplete.ts), et une purge qui s'appuierait sur une lecture tronquée croirait
// avoir tout purgé sans l'avoir fait — pire que ne rien purger, puisque la clôture serait quand même
// enregistrée. Elle se refuse donc plutôt que de purger une partie.
import { supabase } from './supabase'
import { messageErreur } from './messageErreur'
import { lireTout } from './lectureComplete'

export async function estExerciceCloture(dossierId: string, annee: number): Promise<boolean> {
  const { data, error } = await supabase
    .from('exercices_clotures')
    .select('id')
    .eq('dossier_id', dossierId)
    .eq('annee', annee)
    .maybeSingle()
  if (error) throw new Error(messageErreur(error, "Impossible de vérifier si l'exercice est clôturé."))
  return data !== null
}

export interface ResultatCloture {
  // Vrai si l'exercice était déjà marqué clôturé — la purge est alors rejouée (pour rattraper les
  // pièces sensibles validées depuis) sans reposer une seconde ligne de clôture.
  dejaCloture: boolean
  piecesPurgees: number
}

export async function cloturerExercice(dossierId: string, annee: number): Promise<ResultatCloture> {
  const dejaCloture = await estExerciceCloture(dossierId, annee)
  if (!dejaCloture) {
    const { error } = await supabase
      .from('exercices_clotures')
      .insert({ dossier_id: dossierId, annee })
    if (error) throw new Error(messageErreur(error, "Impossible de clôturer l'exercice."))
  }

  // Une pièce sans date_piece n'a pas d'exercice déterminable (voir CLAUDE.md, "pieces sans date") :
  // exclue par construction (`.not('date_piece', 'is', null)`), jamais rattachée à un exercice par
  // défaut — ce serait aussi faux que de l'exclure de la 2035 au hasard.
  const lecture = await lireTout<{ id: string }>((debut, fin) =>
    supabase.from('pieces').select('id', { count: 'exact' })
      .eq('dossier_id', dossierId)
      .eq('statut', 'validee')
      .eq('type_piece', 'vente')
      .not('date_piece', 'is', null)
      .gte('date_piece', `${annee}-01-01`)
      .lte('date_piece', `${annee}-12-31`)
      .order('id')
      .range(debut, fin),
  )
  if (!lecture.complete) {
    throw new Error(
      `Exercice clôturé, mais la liste des pièces sensibles à purger est incomplète (${lecture.motif}) — `
      + 'la purge est refusée plutôt que d\'en oublier une partie. Relance la clôture pour réessayer.',
    )
  }

  const ids = lecture.lignes.map((p) => p.id)
  if (ids.length === 0) return { dejaCloture, piecesPurgees: 0 }

  const { error: erreurPurge } = await supabase
    .from('piece_textes_ocr')
    .delete()
    .in('piece_id', ids)
  if (erreurPurge) {
    throw new Error(messageErreur(erreurPurge, "Exercice clôturé, mais la purge du texte OCR a échoué."))
  }

  return { dejaCloture, piecesPurgees: ids.length }
}

// LA MARQUE DE CLÔTURE EST LUE PAR LES TROIS ÉCRANS QUI RÉCLAMENT DES DOCUMENTS (voir
// `resteAEnvoyer.ts`), et elle ne doit JAMAIS les faire taire par accident.
//
// Cette lecture NE LÈVE PAS et ne rend pas d'exception à traiter : un refus, une session expirée ou
// une coupure rendent « aucun exercice connu comme clos », c'est-à-dire qu'on CONTINUE de réclamer
// l'exercice précédent. C'est le seul sens sûr — l'autre ferait cesser la réclamation sur une panne,
// et un écran qui cesse de demander est indiscernable d'un dossier à jour. Le motif est rendu à part
// pour que l'écran puisse le dire au lieu de l'avaler.
//
// Lecture non paginée assumée : au plus une ligne par année civile pour ce dossier (voir
// lecturesPaginees.test.ts).
export async function lireAnneesCloturees(
  dossierId: string,
): Promise<{ annees: number[]; erreur: string | null }> {
  const { data, error } = await supabase
    .from('exercices_clotures')
    .select('annee')
    .eq('dossier_id', dossierId)
  if (error) {
    return { annees: [], erreur: messageErreur(error, "Impossible de lire les exercices clôturés.") }
  }
  return { annees: (data ?? []).map((c: { annee: number }) => c.annee), erreur: null }
}
