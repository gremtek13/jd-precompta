import { supabase } from './supabase'
import { lireTout, type LectureComplete } from './lectureComplete'
import type { EntreeDossierPermanent } from './types'

// LE DOSSIER PERMANENT D'UN DOSSIER (ligne 41, étape R7), lu EN ENTIER, versions remplacées et entrées retirées comprises :
// la version courante d'une entrée se lit sur la chaîne de ses versions (lib/dossierPermanent.ts,
// `entreesDuDossierPermanent`), et ce qu'une version remplacée ou une entrée retirée citait reste gardé par la base — une
// pièce ou un document cité ne se supprime plus (hypothèse Q8, `garder_source_citee`). C'est la source que les refus de
// `consigner_au_dossier_permanent` et de `retirer_du_dossier_permanent` lisent avant le clic (`refusDeConsigner`,
// `refusDeRetirer`) et que la garde des sources citées lit (`refusDuRetraitDUneSourceCitee`) ; son drapeau `complete`,
// l'appelant le transmet tel quel — une lecture partielle ne commande aucune écriture, et ne dit pas qu'une source n'est
// pas citée.
//
// Le dossier ENTIER, trié sur la clé primaire : une entrée vaut pour plusieurs exercices, et une citation garde sa source
// quelle que soit l'année qu'on regarde.
export async function lireLeDossierPermanent(dossierId: string): Promise<LectureComplete<EntreeDossierPermanent>> {
  const lecture = await lireTout<EntreeDossierPermanent>((debut, fin) =>
    supabase.from('dossier_permanent').select('*', { count: 'exact' })
      .eq('dossier_id', dossierId).order('id').range(debut, fin),
  )
  // Le drapeau et son motif passent tels quels : c'est l'appelant qui ne dit rien et ne commande rien sur une lecture
  // partielle (lecturesSignalees.test.ts les voit lus ici).
  return { lignes: lecture.lignes, complete: lecture.complete, motif: lecture.motif }
}
