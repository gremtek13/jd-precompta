import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { accesDuReleveDeLaLecture, envoisDeLaLecture, type AccesDuReleve, type EnvoisDuClient } from './banqueCabinet'
import type { JustificatifPropose, PrecisionMouvement } from './types'

// CE QUE LE CLIENT A ENVOYÉ POUR LE RELEVÉ, LU PAR L'ONGLET BANQUE DU CABINET (espace client, étape P9b). Les deux
// registres de la banque du client (`justificatifs_proposes`, `precisions_mouvements`) : leur policy de lecture,
// `gere_la_banque(dossier_id)`, les ouvre au cabinet du dossier (`admin_du_dossier`). Et les accès du dossier
// (`memberships_select` : le cabinet lit toutes les lignes du dossier), pour reconnaître le client et savoir si un accès
// porte la case « Banque » — rien n'y est écrit.
//
// Par `lireTout`, tri TOTAL terminé par la clé primaire (`created_at` n'est pas unique). Une requête qui LÈVE tombe du côté
// signalé, comme une lecture refusée : jamais une liste vide qui dirait « rien de proposé ».
export async function lireLesEnvoisDuClient(dossierId: string): Promise<EnvoisDuClient> {
  try {
    const propositions = await lireTout<JustificatifPropose>((debut, fin) =>
      supabase.from('justificatifs_proposes').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('created_at').order('id').range(debut, fin),
    )
    const precisions = await lireTout<PrecisionMouvement>((debut, fin) =>
      supabase.from('precisions_mouvements').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('created_at').order('id').range(debut, fin),
    )
    // Les drapeaux `complete` sont lus ICI : ils décident si le moindre envoi se dit (lib/banqueCabinet.ts).
    return envoisDeLaLecture(
      { lignes: propositions.lignes, complete: propositions.complete, motif: propositions.motif },
      { lignes: precisions.lignes, complete: precisions.complete, motif: precisions.motif },
    )
  } catch (e) {
    return { etat: 'incomplets', motif: messageErreur(e, 'la lecture a échoué') }
  }
}

export async function lireLesAccesDuReleve(dossierId: string): Promise<AccesDuReleve> {
  try {
    const lecture = await lireTout<{ id: string; user_id: string; droit_banque: boolean }>((debut, fin) =>
      supabase.from('memberships').select('id, user_id, droit_banque', { count: 'exact' })
        .eq('dossier_id', dossierId).order('created_at').order('id').range(debut, fin),
    )
    // Le drapeau `complete` est lu ICI : sans lui, aucun compte ne se reconnaît (lib/banqueCabinet.ts).
    return accesDuReleveDeLaLecture({ lignes: lecture.lignes, complete: lecture.complete, motif: lecture.motif })
  } catch (e) {
    return { acces: { etat: 'incomplets', motif: messageErreur(e, 'la lecture a échoué') }, avecBanque: null }
  }
}
