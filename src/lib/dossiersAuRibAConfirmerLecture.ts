import { useEffect, useState } from 'react'
import type { ReponseDeLaBase } from './couvertureReleve'
import { DOSSIERS_AU_RIB_A_CONFIRMER_EXPORTE, lireLesDossiersAuRibAConfirmer, type LectureDesDossiersAuRib } from './dossiersAuRibAConfirmer'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'

// LES DOSSIERS DONT UN RIB PROPOSÉ ATTEND LA CONFIRMATION DU CABINET, LUS POUR L'ÉCRAN (espace client, étape A5b3c). Le
// tableau de bord du cabinet (pages/DossiersList.tsx, étape A5b3d) les lit par ce crochet : une seule copie de l'appel, de
// sa garde et de son annulation (le patron de lib/changementDeRibLecture.ts).
//
// La fonction `dossiers_au_rib_a_confirmer` (migration du même nom) rend UNE valeur, l'accès d'abord : le cabinet seul — un
// accès client reçoit un refus (42501), jamais une liste vide. Ce module l'appelle par UN `.rpc(`, lit son erreur, et passe
// la valeur par `lireLesDossiersAuRibAConfirmer` (lib/dossiersAuRibAConfirmer.ts) — qui ne devine rien. Quatre états,
// jamais un cinquième :
//  · `en_cours` : pas revenue. Rien ne se dit alors — ni « aucun », ni une liste.
//  · `lue` : la valeur a la forme attendue ; c'est la seule qui permette de dire « aucun » ou la liste.
//  · `illisible` : la base a répondu, mais pas sous la forme attendue. Ni liste, ni silence qu'on croirait un « aucun ».
//  · `refusee` : la base a refusé, ou la requête a levé, avec son motif (`messageErreur`) — jamais une liste vide.
// La lecture ne REJETTE jamais : sa panne ne tait que la liste, jamais l'écran qui la porte.
//
// Tant que la migration n'est pas en base (`DOSSIERS_AU_RIB_A_CONFIRMER_EXPORTE` faux), RIEN ne se lit : le crochet rend
// `null`, que l'écran prend pour « rien à dire », et aucun appel ne part — une fonction absente rendrait un refus à chaque
// ouverture du tableau de bord.
//
// La lecture est GARDÉE avec la clé pour laquelle elle a été faite (`cle`, que l'écran choisit : la session du cabinet, un
// compteur de relecture) : une autre clé repart de « en cours », et la réponse tardive d'une clé quittée ne s'inscrit pas
// (une lecture plus lente écrit en dernier). Une clé nulle ne lit rien : l'écran ne la donne qu'au cabinet — la base
// refuserait tout autre appelant.

export type LectureDesDossiersAuRibRevenue = Exclude<LectureDesDossiersAuRib, { etat: 'en_cours' }>

/** La valeur rendue par la base, lue : `lue`, ou `illisible`, ou `refusee` quand elle porte une erreur. */
export function dossiersAuRibDeLaReponse(reponse: ReponseDeLaBase): LectureDesDossiersAuRibRevenue {
  if (reponse.error) return { etat: 'refusee', motif: messageErreur(reponse.error, 'la base a refusé la lecture') }
  const lu = lireLesDossiersAuRibAConfirmer(reponse.data)
  return lu === null ? { etat: 'illisible' } : { etat: 'lue', lu }
}

/**
 * La lecture telle que l'écran la fait : `lireLaReponseDesDossiersAuRib(supabase.rpc('dossiers_au_rib_a_confirmer'))`. La
 * requête est ATTENDUE ici, et son erreur lue (ecrituresVerifiees.test.ts compte tout `.rpc(` comme une écriture possible,
 * et nomme ce consommateur) : un constructeur de requête n'est pas une promesse, et une requête qui lève tombe du côté
 * signalé, comme un refus — jamais une liste.
 */
export async function lireLaReponseDesDossiersAuRib(requete: PromiseLike<ReponseDeLaBase>): Promise<LectureDesDossiersAuRibRevenue> {
  try {
    return dossiersAuRibDeLaReponse(await requete)
  } catch (erreur) {
    return { etat: 'refusee', motif: messageErreur(erreur, 'la lecture a échoué') }
  }
}

/**
 * Les dossiers de l'appelant dont un RIB proposé attend sa confirmation, lus en base. Ne rejette JAMAIS : même l'appel qui
 * lève avant d'avoir rendu une requête (un client sans la fonction, un SDK qui lève) tombe du côté signalé.
 */
export async function lireLesDossiersAuRibAConfirmerEnBase(): Promise<LectureDesDossiersAuRibRevenue> {
  try {
    return await lireLaReponseDesDossiersAuRib(supabase.rpc('dossiers_au_rib_a_confirmer'))
  } catch (erreur) {
    return { etat: 'refusee', motif: messageErreur(erreur, 'la lecture a échoué') }
  }
}

/**
 * Les dossiers dont un RIB proposé attend la confirmation du cabinet : `en_cours` tant qu'ils ne sont pas revenus pour
 * CETTE clé ; `null` — rien à dire, rien de lu — tant que la fonction n'est pas en base, ou sans clé.
 */
export function useDossiersAuRibAConfirmer(cle: string | number | null): LectureDesDossiersAuRib | null {
  const [lue, setLue] = useState<{ cle: string | number; lecture: LectureDesDossiersAuRibRevenue } | null>(null)

  useEffect(() => {
    if (!DOSSIERS_AU_RIB_A_CONFIRMER_EXPORTE || cle === null) return
    let annule = false
    lireLesDossiersAuRibAConfirmerEnBase().then((lecture) => { if (!annule) setLue({ cle, lecture }) })
    return () => { annule = true }
  }, [cle])

  if (!DOSSIERS_AU_RIB_A_CONFIRMER_EXPORTE || cle === null) return null
  return lue !== null && lue.cle === cle ? lue.lecture : { etat: 'en_cours' }
}
