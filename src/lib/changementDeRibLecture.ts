import { useEffect, useState } from 'react'
import { CHANGEMENT_DE_RIB_EXPORTE, lireLeChangementDeRib, type DernierChangementLu } from './changementDeRib'
import type { ReponseDeLaBase } from './couvertureReleve'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'

// LE DERNIER CHANGEMENT DU RIB DES FACTURES D'UN DOSSIER, LU POUR L'ÉCRAN (espace client, étape A5b3a). L'avis de l'étape
// A5b3b — sur l'accueil du cabinet, du client « Ventes » et du client « Banque » — le lira par ce crochet : une seule copie
// de l'appel, de sa garde et de son annulation (le patron de lib/etatFactureElectroniqueLecture.ts).
//
// La fonction `dernier_changement_de_rib` (migration du même nom) rend UNE valeur, l'accès d'abord. Ce module l'appelle par
// UN `.rpc(`, lit son erreur, et passe la valeur par `lireLeChangementDeRib` (lib/changementDeRib.ts) — qui ne devine rien.
// Quatre états, jamais un cinquième :
//  · `en_cours` : pas revenue. Rien ne se dit alors — ni « aucun changement », ni un avis.
//  · `lue` : la valeur a la forme attendue ; c'est la seule qui permette de dire « aucun changement » ou l'avis.
//  · `illisible` : la base a répondu, mais pas sous la forme attendue. Ni avis, ni silence qu'on croirait un « rien ».
//  · `refusee` : la base a refusé, ou la requête a levé, avec son motif (`messageErreur`) — jamais une valeur vide.
// La lecture ne REJETTE jamais : sa panne ne tait que son avis, jamais l'écran qui le porte.
//
// Tant que la migration n'est pas en base (`CHANGEMENT_DE_RIB_EXPORTE` faux), RIEN ne se lit : le crochet rend `null`, que
// l'écran prend pour « pas d'avis à dire », et aucun appel ne part — une fonction absente rendrait un refus à chaque accueil.
//
// La lecture est GARDÉE avec le dossier pour lequel elle a été faite : un autre dossier repart de « en cours », et la
// réponse tardive d'un dossier quitté ne s'inscrit pas (une lecture plus lente écrit en dernier).

export type LectureDuChangement =
  | { etat: 'en_cours' }
  | { etat: 'lue'; lu: DernierChangementLu }
  | { etat: 'illisible' }
  | { etat: 'refusee'; motif: string }

export type LectureDuChangementRevenue = Exclude<LectureDuChangement, { etat: 'en_cours' }>

/** La valeur rendue par la base, lue : `lue`, ou `illisible`, ou `refusee` quand elle porte une erreur. */
export function changementDeLaReponse(reponse: ReponseDeLaBase): LectureDuChangementRevenue {
  if (reponse.error) return { etat: 'refusee', motif: messageErreur(reponse.error, 'la base a refusé la lecture') }
  const lu = lireLeChangementDeRib(reponse.data)
  return lu === null ? { etat: 'illisible' } : { etat: 'lue', lu }
}

/**
 * La lecture telle que l'écran la fait : `lireLaReponseDuChangement(supabase.rpc('dernier_changement_de_rib', …))`. La
 * requête est ATTENDUE ici, et son erreur lue (ecrituresVerifiees.test.ts compte tout `.rpc(` comme une écriture possible,
 * et nomme ce consommateur) : un constructeur de requête n'est pas une promesse, et une requête qui lève tombe du côté
 * signalé, comme un refus — jamais une valeur.
 */
export async function lireLaReponseDuChangement(requete: PromiseLike<ReponseDeLaBase>): Promise<LectureDuChangementRevenue> {
  try {
    return changementDeLaReponse(await requete)
  } catch (erreur) {
    return { etat: 'refusee', motif: messageErreur(erreur, 'la lecture a échoué') }
  }
}

/**
 * Le dernier changement du RIB du dossier, lu en base. Ne rejette JAMAIS : même l'appel qui lève avant d'avoir rendu une
 * requête (un client sans la fonction, un SDK qui lève) tombe du côté signalé.
 */
export async function lireLeDernierChangementDeRib(dossierId: string): Promise<LectureDuChangementRevenue> {
  try {
    return await lireLaReponseDuChangement(supabase.rpc('dernier_changement_de_rib', { p_dossier_id: dossierId }))
  } catch (erreur) {
    return { etat: 'refusee', motif: messageErreur(erreur, 'la lecture a échoué') }
  }
}

/**
 * Le dernier changement du RIB du dossier `dossierId` : `en_cours` tant qu'il n'est pas revenu pour CE dossier ; `null` —
 * rien à dire, rien de lu — tant que la fonction n'est pas en base, ou sans dossier.
 */
export function useDernierChangementDeRib(dossierId: string | null): LectureDuChangement | null {
  const [lue, setLue] = useState<{ dossierId: string; lecture: LectureDuChangementRevenue } | null>(null)

  useEffect(() => {
    if (!CHANGEMENT_DE_RIB_EXPORTE || !dossierId) return
    let annule = false
    lireLeDernierChangementDeRib(dossierId).then((lecture) => { if (!annule) setLue({ dossierId, lecture }) })
    return () => { annule = true }
  }, [dossierId])

  if (!CHANGEMENT_DE_RIB_EXPORTE || !dossierId) return null
  return lue !== null && lue.dossierId === dossierId ? lue.lecture : { etat: 'en_cours' }
}
