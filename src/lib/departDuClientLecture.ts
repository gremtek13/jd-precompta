import { useEffect, useState } from 'react'
import {
  DEPART_DU_CLIENT_PREVU, type ConservationEnCours, type ExerciceValideDuDepart, type PaquetTelecharge,
} from './departDuClient'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'

// LE DÉPART D'UN CLIENT, LU ET ÉCRIT POUR L'ÉCRAN (ligne 44, INAL5 ; la base : la migration `depart_du_client`). Ce que
// l'écran en dit vit dans lib/departDuClient.ts (pur). Rien ne se lit ni ne s'écrit tant que `DEPART_DU_CLIENT_PREVU` est
// baissé : les deux tables n'existent pas encore, et les nommer ferait échouer chaque lecture.
//
// Aucune lecture ne REJETTE : une panne tombe du côté signalé, avec son motif. Lue en partie, la lecture est ILLISIBLE —
// jamais une liste plus courte : un paquet qui manquerait à la liste dirait « à télécharger » un exercice déjà remis, et un
// exercice qui manquerait laisserait croire la suppression possible.

export type LectureDuDepart =
  | {
    etat: 'lue'
    dossierId: string
    exercices: ExerciceValideDuDepart[]
    paquets: PaquetTelecharge[]
    conservation: ConservationEnCours | null
    /** Le nombre d'accès client du dossier (`memberships`). */
    accesClient: number
  }
  | { etat: 'illisible'; dossierId: string; motif: string }

/** Ce que le départ d'un dossier demande de savoir, lu en entier. Ne rejette jamais. */
export async function lireLeDepartDuDossier(dossierId: string): Promise<LectureDuDepart> {
  const illisible = (motif: string): LectureDuDepart => ({ etat: 'illisible', dossierId, motif })
  try {
    const exercices = await lireTout<ExerciceValideDuDepart>((debut, fin) =>
      supabase.from('exercices_valides').select('annee, empreinte', { count: 'exact' })
        .eq('dossier_id', dossierId).order('dossier_id').order('annee').range(debut, fin))
    if (!exercices.complete) return illisible(`les exercices validés sont lus en partie (${exercices.motif})`)
    const paquets = await lireTout<PaquetTelecharge & { id: string }>((debut, fin) =>
      supabase.from('paquets_d_archive_telecharges').select('id, annee, empreinte_exercice, telecharge_le', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin))
    if (!paquets.complete) return illisible(`les paquets téléchargés sont lus en partie (${paquets.motif})`)
    const conservation = await supabase.from('conservations_des_dossiers').select('jusqu_au, dernier_exercice, posee_le')
      .eq('dossier_id', dossierId).is('levee_le', null).maybeSingle()
    if (conservation.error) return illisible(messageErreur(conservation.error, 'la conservation n’a pas pu être lue'))
    const acces = await supabase.from('memberships').select('id', { count: 'exact', head: true }).eq('dossier_id', dossierId)
    if (acces.error) return illisible(messageErreur(acces.error, 'les accès client n’ont pas pu être comptés'))
    if (typeof acces.count !== 'number') return illisible('la base n’a pas rendu le compte des accès client')
    return {
      etat: 'lue', dossierId, exercices: exercices.lignes,
      paquets: paquets.lignes.map(({ annee, empreinte_exercice, telecharge_le }) => ({ annee, empreinte_exercice, telecharge_le })),
      conservation: (conservation.data as ConservationEnCours | null) ?? null, accesClient: acces.count,
    }
  } catch (e) {
    return illisible(messageErreur(e, 'le départ du dossier n’a pas pu être lu'))
  }
}

/**
 * Le départ d'un dossier, lu pour l'écran et gardé AVEC le dossier (et le compteur de relecture) pour lequel il a été lu :
 * un autre repart de `null` (« Chargement… »), et une réponse tardive ne s'inscrit pas. `null` aussi, et rien de lu, tant
 * que le drapeau est baissé.
 */
export function useDepartDuDossier(dossierId: string, relecture: number): LectureDuDepart | null {
  const [lue, setLue] = useState<{ cle: string; lecture: LectureDuDepart } | null>(null)
  const cle = `${dossierId}#${relecture}`
  useEffect(() => {
    if (!DEPART_DU_CLIENT_PREVU) return
    let annule = false
    void lireLeDepartDuDossier(dossierId).then((lecture) => { if (!annule) setLue({ cle: `${dossierId}#${relecture}`, lecture }) })
    return () => { annule = true }
  }, [dossierId, relecture])
  if (!DEPART_DU_CLIENT_PREVU) return null
  return lue !== null && lue.cle === cle ? lue.lecture : null
}

/** L'issue d'un geste du départ : la base l'a écrit, ou l'a refusé avec ses mots. */
export type IssueDuDepart = { ok: true } | { ok: false; message: string }

async function appelerLaBaseDuDepart(fonction: string, parametres: Record<string, unknown>, repli: string): Promise<IssueDuDepart> {
  try {
    const { error } = await supabase.rpc(fonction, parametres)
    if (error) return { ok: false, message: messageErreur(error, repli) }
    return { ok: true }
  } catch (e) {
    return { ok: false, message: messageErreur(e, repli) }
  }
}

/** Pose la conservation du dossier, par la fonction de la base seule (`conserver_le_dossier`). */
export function conserverLeDossier(dossierId: string): Promise<IssueDuDepart> {
  return appelerLaBaseDuDepart('conserver_le_dossier', { p_dossier_id: dossierId }, 'la base a refusé la conservation')
}

/** Lève la conservation du dossier (`lever_la_conservation`). */
export function leverLaConservation(dossierId: string): Promise<IssueDuDepart> {
  return appelerLaBaseDuDepart('lever_la_conservation', { p_dossier_id: dossierId }, 'la base a refusé la levée de la conservation')
}

/**
 * Enregistre le téléchargement d'un paquet d'archive (`enregistrer_paquet_telecharge`), APRÈS sa remise au navigateur : la
 * base ne voit pas le fichier, elle garde l'empreinte de l'exercice qu'il scelle et celle de son manifeste. Le drapeau
 * baissé, rien ne s'écrit (`{ ok: true }` : il n'y a rien à dire).
 */
export function enregistrerLePaquetTelecharge(p: {
  dossierId: string; annee: number; empreinteExercice: string; empreinteDuManifeste: string; fichiers: number; nonVerifiees: number
}): Promise<IssueDuDepart> {
  if (!DEPART_DU_CLIENT_PREVU) return Promise.resolve({ ok: true })
  return appelerLaBaseDuDepart('enregistrer_paquet_telecharge', {
    p_dossier_id: p.dossierId, p_annee: p.annee, p_empreinte_exercice: p.empreinteExercice,
    p_empreinte_du_manifeste: p.empreinteDuManifeste, p_nb_fichiers: p.fichiers, p_nb_non_verifiees: p.nonVerifiees,
  }, 'le téléchargement du paquet n’a pas été enregistré')
}

/**
 * Le refus de la suppression d'un dossier, LU juste avant elle (lib/suppressionDossier.ts) : LÈVE si la base ne le dit pas —
 * mieux vaut ne rien supprimer que vider le stockage d'un dossier dont la ligne se refusera ensuite. Le drapeau baissé : rien
 * à lire, aucun refus.
 */
export async function lireLeDepartAvantLaSuppression(dossierId: string): Promise<LectureDuDepart | null> {
  if (!DEPART_DU_CLIENT_PREVU) return null
  const lu = await lireLeDepartDuDossier(dossierId)
  if (lu.etat === 'illisible') {
    throw new Error(`Les paquets d’archive et la conservation du dossier n’ont pas pu être lus : rien n’a été supprimé (${lu.motif}).`)
  }
  return lu
}
