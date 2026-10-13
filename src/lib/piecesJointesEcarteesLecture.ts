import { supabase } from './supabase'
import { lireTout, type LectureComplete } from './lectureComplete'
import { messageErreur } from './messageErreur'
import type { PieceJointeEcartee } from './types'

// LES PIÈCES JOINTES ÉCARTÉES D'UN DOSSIER (ligne 22.7), lues EN ENTIER, vues comprises : l'onglet Justificatifs en dit
// combien, quand et pourquoi, et n'en marque vues que sur une liste lue en entier (src/lib/piecesJointesEcartees.ts).
// Triées des plus récentes aux plus anciennes, l'identifiant fermant le tri (un tri TOTAL : `lireTout` avance par
// tranches). Une requête qui LÈVE tombe du côté signalé, comme un refus — jamais une liste vide qu'on prendrait pour
// « rien d'écarté ».
export async function lirePiecesJointesEcartees(dossierId: string): Promise<LectureComplete<PieceJointeEcartee>> {
  try {
    const lecture = await lireTout<PieceJointeEcartee>((debut, fin) =>
      supabase.from('pieces_jointes_ecartees').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('recue_le', { ascending: false }).order('id').range(debut, fin),
    )
    // Le drapeau et son motif passent tels quels : c'est l'écran qui ne dit rien et ne commande rien sur une lecture
    // partielle (lecturesSignalees.test.ts les voit lus ici).
    return { lignes: lecture.lignes, complete: lecture.complete, motif: lecture.motif }
  } catch (erreur) {
    return { lignes: [], complete: false, motif: `lecture impossible : ${messageErreur(erreur, 'raison inconnue')}` }
  }
}
