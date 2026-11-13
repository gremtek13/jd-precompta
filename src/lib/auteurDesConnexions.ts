// QUI A ÉCRIT LA CONNEXION À LA PLATEFORME DU CLIENT (B4RS-Q1, tranchée par le cabinet le 12/11/2026 : « (B) Garder EC-Q4,
// refuser sur une connexion écrite par un client »). La base efface l'auteur à toute écriture de la configuration et ne le
// pose que pour le cabinet du dossier (migration PRÉPARÉE `auteur_des_connexions_plateformes`) ; l'Edge Function
// `plateforme-agreee`, sa constante `AUTEUR_DES_CONNEXIONS_EN_BASE` levée, en dit un booléen dans la vue publique
// (`ecrite_par_le_cabinet`, jamais le compte) et refuse la relève depuis l'espace client sur une connexion que le cabinet
// n'a pas écrite (`raison: "connexion_hors_du_cabinet"`). Ce module, pur, dit l'un et l'autre aux deux espaces.
//
// `AUTEUR_DES_CONNEXIONS_PREVU` se lève avec la migration et la fonction déployée sa constante levée : baissé, l'écran
// d'hier — ni la ligne de l'auteur dans la fiche de la plateforme, ni le refus nommé (la phrase générique du serveur).

import { formatDate } from './format'

export const AUTEUR_DES_CONNEXIONS_PREVU: boolean = false

/** La raison que la fonction nomme quand le cabinet n'a pas écrit la configuration en vigueur. */
export const RAISON_CONNEXION_HORS_DU_CABINET = 'connexion_hors_du_cabinet'

/** Ce que la vue publique de la connexion dit de son auteur : rien tant que la fonction ne le lit pas. */
export interface AuteurDeLaVue {
  ecrite_par_le_cabinet?: boolean
  ecrite_le?: string | null
}

/**
 * La ligne « Écrite par » de la fiche de la plateforme, ou null quand rien ne se dit : le drapeau baissé, ou une vue qui ne
 * porte pas l'auteur (la fonction d'avant). Jamais le compte : la vue ne le porte pas.
 */
export function auteurDeLaConnexionDit(
  vue: AuteurDeLaVue, espace: 'cabinet' | 'client', drapeau: boolean = AUTEUR_DES_CONNEXIONS_PREVU,
): string | null {
  if (!drapeau || vue.ecrite_par_le_cabinet === undefined) return null
  if (vue.ecrite_par_le_cabinet) {
    const le = vue.ecrite_le ? `, le ${formatDate(vue.ecrite_le)}` : ''
    return espace === 'cabinet' ? `le cabinet${le}` : `ton cabinet${le}`
  }
  return espace === 'cabinet'
    ? 'pas par le cabinet (un accès client, ou avant que la base le retienne) : la relève depuis l’espace client y reste fermée '
      + 'tant que vous ne l’avez pas enregistrée vous-même'
    : 'pas par ton cabinet : « Relever ma plateforme » attend qu’il l’enregistre'
}

/** Le refus nommé de la relève, dit au client ; null quand le drapeau est baissé ou que la raison est une autre. */
export function refusDeLAuteurDitAuClient(raison: string | null, drapeau: boolean = AUTEUR_DES_CONNEXIONS_PREVU): string | null {
  if (!drapeau || raison !== RAISON_CONNEXION_HORS_DU_CABINET) return null
  return 'La connexion à ta plateforme n’a pas été enregistrée par ton cabinet : la relève depuis ton espace attend qu’il '
    + 'l’enregistre lui-même. Parles-en à ton cabinet.'
}
