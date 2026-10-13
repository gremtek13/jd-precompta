import { useEffect, useState } from 'react'
import type { LectureComplete } from './lectureComplete'
import { ECARTEES_DU_CLIENT_EXPORTEES, lireLesEcarteesDuClient } from './piecesJointesEcarteesClient'
import { supabase } from './supabase'
import type { PieceJointeEcarteeDuClient } from './types'

// CE QUE « MES PIÈCES » ET L'ACCUEIL DU CLIENT LISENT DES PIÈCES JOINTES ÉCARTÉES : une lecture, écrite une fois (ligne
// 22.94). « Mes pièces » la faisait en ligne (ligne 22.9) ; l'accueil dit le NOMBRE de ce que la carte détaille, et une
// seconde copie de l'appel, de sa garde ou de son annulation pourrait diverger de la première sans un mot (le patron de
// `lib/ventesLecture.ts`, partagé par l'onglet Factures et les tuiles de l'accueil).
//
// La lecture vit À PART de toute autre lecture de l'écran : sa panne ne rend aucune autre liste fausse, et la panne des
// autres ne la tait pas. Elle est GARDÉE avec la société pour laquelle elle a été faite, et nulle tant qu'elle n'est pas
// revenue : l'état d'une société ne se montre jamais sous une autre (« une lecture plus lente écrit en dernier »), et le
// drapeau d'annulation empêche qu'une réponse tardive s'écrive après le changement. Aucun dépôt ne la change : elle ne se
// relit pas. Rien ne se lit tant que la fonction n'est pas en base (`ECARTEES_DU_CLIENT_EXPORTEES`) ni sans société.
//
// Ce module importe `supabase.ts` ; la logique pure (forme des lignes, phrases) reste dans `piecesJointesEcarteesClient.ts`.

/**
 * La lecture des pièces jointes écartées de la société `dossierId`, ou `null` tant qu'elle n'est pas revenue (et toujours,
 * drapeau baissé ou sans société). Lue, elle peut être incomplète (`complete` faux, avec son motif) : refusée, illisible,
 * ou une requête qui lève — jamais une liste vide qu'on croirait lue.
 */
export function useEcarteesDuClient(dossierId: string | null): LectureComplete<PieceJointeEcarteeDuClient> | null {
  const [lue, setLue] = useState<{ dossierId: string; lecture: LectureComplete<PieceJointeEcarteeDuClient> } | null>(null)

  useEffect(() => {
    if (!ECARTEES_DU_CLIENT_EXPORTEES || !dossierId) return
    let annule = false
    lireLesEcarteesDuClient(supabase.rpc('pieces_jointes_ecartees_du_client', { p_dossier_id: dossierId }))
      .then((lecture) => { if (!annule) setLue({ dossierId, lecture }) })
    return () => { annule = true }
  }, [dossierId])

  return lue !== null && lue.dossierId === dossierId ? lue.lecture : null
}
