import { supabase } from './supabase'
import { messageErreur } from './messageErreur'
import {
  FONCTION_DES_LETTRES_DU_CLIENT, REFUS_DES_LETTRES_DU_CLIENT, lettresDuClientRendues, type LettreDuClient,
} from './lettresDuClient'

// LA LECTURE de « Mes lettres de mission » (LM6, ligne 47) : par la fonction `lettres_de_mission_du_client` seule (le client
// ne lit aucune des deux tables). Elle NE REJETTE JAMAIS : une réponse refusée se dit refusée (la case « Documents » relue
// à la base), une valeur qu'on ne reconnaît pas ENTIÈRE se dit illisible, jamais « aucune lettre ». Gardée avec le dossier
// lu : l'écran n'affiche une lecture que pour le dossier qu'il montre.

export type LettresDuClientLues =
  | { etat: 'lue'; dossierId: string; dossierDuCabinetDesigne: boolean; lettres: LettreDuClient[] }
  | { etat: 'refusee'; dossierId: string; motif: string }
  | { etat: 'illisible'; dossierId: string; motif: string }

export async function lireLesLettresDuClient(dossierId: string): Promise<LettresDuClientLues> {
  try {
    const { data, error } = await supabase.rpc(FONCTION_DES_LETTRES_DU_CLIENT, { p_dossier_id: dossierId })
    if (error) {
      const code = (error as { code?: unknown }).code
      return code === REFUS_DES_LETTRES_DU_CLIENT.code
        ? { etat: 'refusee', dossierId, motif: messageErreur(error, REFUS_DES_LETTRES_DU_CLIENT.acces) }
        : { etat: 'illisible', dossierId, motif: messageErreur(error, 'tes lettres de mission n’ont pas pu être lues') }
    }
    const rendues = lettresDuClientRendues(data)
    if (rendues === null) return { etat: 'illisible', dossierId, motif: 'la réponse ne se lit pas telle quelle' }
    return { etat: 'lue', dossierId, dossierDuCabinetDesigne: rendues.dossierDuCabinetDesigne, lettres: rendues.lettres }
  } catch (e) {
    return { etat: 'illisible', dossierId, motif: messageErreur(e, 'tes lettres de mission n’ont pas pu être lues') }
  }
}
