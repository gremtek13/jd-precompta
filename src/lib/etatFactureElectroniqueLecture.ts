import { useEffect, useState } from 'react'
import type { ReponseDeLaBase } from './couvertureReleve'
import { lireEtatFactureElectronique } from './etatFactureElectronique'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'
import type { EtatFactureElectroniqueLu } from './types'

// L'ÉTAT DE LA FACTURE ÉLECTRONIQUE D'UN DOSSIER, LU POUR L'ÉCRAN (espace client, étape A6b2 ; conception : HISTORIQUE.md,
// « L'ESPACE CLIENT, LOGICIEL DE GESTION DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », §A.6). L'encart de
// l'accueil du client et la carte de la Vue d'ensemble du cabinet la lisent de la même façon, par ce crochet : une seule
// copie de l'appel, de sa garde et de son annulation.
//
// La fonction `etat_facture_electronique` (migration `adresses_reception`, A6a) rend UNE valeur, l'accès d'abord
// (`gere_les_ventes`). Ce module l'appelle, lit son erreur, et passe la valeur par `lireEtatFactureElectronique`
// (lib/etatFactureElectronique.ts) — qui ne devine rien — : QUATRE états, jamais un cinquième.
//  · `en_cours` : pas revenue. Rien ne se dit alors.
//  · `lue` : la valeur a la forme attendue ; c'est la seule qui permette de dire « active » ou « à compléter ».
//  · `illisible` : la base a répondu, mais pas sous la forme attendue (une clé de plus, de moins, une date qui n'en est pas
//    une). Ni état ni « active » : un écran qui lirait de travers dirait un état faux.
//  · `refusee` : la base a refusé, ou la requête a levé, avec son motif (`messageErreur`) — jamais une valeur vide.
//
// Rien ne part vers l'extérieur : l'état se LIT en base, et le chargement d'un écran n'appelle aucune plateforme.
//
// La lecture est GARDÉE avec le dossier pour lequel elle a été faite : un autre dossier repart de « en cours », et la
// réponse tardive d'un dossier quitté ne s'inscrit pas (une lecture plus lente écrit en dernier).

export type LectureDeLEtat =
  | { etat: 'en_cours' }
  | { etat: 'lue'; lu: EtatFactureElectroniqueLu }
  | { etat: 'illisible' }
  | { etat: 'refusee'; motif: string }

export type LectureRevenue = Exclude<LectureDeLEtat, { etat: 'en_cours' }>

/** La valeur rendue par la base, lue : `lue`, ou `illisible`, ou `refusee` quand elle porte une erreur. */
export function etatDeLaReponse(reponse: ReponseDeLaBase): LectureRevenue {
  if (reponse.error) return { etat: 'refusee', motif: messageErreur(reponse.error, 'la base a refusé la lecture') }
  const lu = lireEtatFactureElectronique(reponse.data)
  return lu === null ? { etat: 'illisible' } : { etat: 'lue', lu }
}

/**
 * La lecture telle que l'écran la fait :
 * `lireLEtatDeLaFactureElectronique(supabase.rpc('etat_facture_electronique', { p_dossier_id }))`. La requête est ATTENDUE
 * ici, et son erreur lue (ecrituresVerifiees.test.ts compte tout `.rpc(` comme une écriture possible, et nomme ce
 * consommateur) : un constructeur de requête n'est pas une promesse, et une requête qui lève tombe du côté signalé, comme
 * un refus — jamais un état.
 */
export async function lireLEtatDeLaFactureElectronique(requete: PromiseLike<ReponseDeLaBase>): Promise<LectureRevenue> {
  try {
    return etatDeLaReponse(await requete)
  } catch (erreur) {
    return { etat: 'refusee', motif: messageErreur(erreur, 'la lecture a échoué') }
  }
}

/**
 * L'état du dossier, lu en base. Ne rejette JAMAIS : même l'appel qui lève avant d'avoir rendu une requête (un client sans la
 * fonction, un SDK qui lève) tombe du côté signalé — la panne de cette lecture ne tait que sa carte, jamais l'écran qui la porte.
 */
export async function lireLEtatDuDossier(dossierId: string): Promise<LectureRevenue> {
  try {
    return await lireLEtatDeLaFactureElectronique(supabase.rpc('etat_facture_electronique', { p_dossier_id: dossierId }))
  } catch (erreur) {
    return { etat: 'refusee', motif: messageErreur(erreur, 'la lecture a échoué') }
  }
}

/** L'état de la facture électronique du dossier `dossierId` : `en_cours` tant qu'il n'est pas revenu pour CE dossier. */
export function useEtatFactureElectronique(dossierId: string): LectureDeLEtat {
  const [lue, setLue] = useState<{ dossierId: string; lecture: LectureRevenue } | null>(null)

  useEffect(() => {
    let annule = false
    lireLEtatDuDossier(dossierId).then((lecture) => { if (!annule) setLue({ dossierId, lecture }) })
    return () => { annule = true }
  }, [dossierId])

  return lue !== null && lue.dossierId === dossierId ? lue.lecture : { etat: 'en_cours' }
}
