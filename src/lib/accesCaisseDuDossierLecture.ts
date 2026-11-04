import type { AccesDuDossierLus } from './droitsAcces'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'

// CE QUE LA CARTE DU STATUT DE TVA LIT DES ACCÈS DU DOSSIER (C11-Q1, le 04/11/2026 ; le module pur est lib/droitsAcces.ts,
// `avisDuStatutSousLaCase`). Les accès du dossier, EN ENTIER (`lireTout`, compte annoncé, tri total sur la clé primaire), leur
// seule case « Caisse » : `garder_statut_tva_de_la_caisse` refuse que le statut quitte l'exonération et la franchise tant
// qu'UN accès la porte — un seul qui manquerait à la lecture ferait promettre à tort. Rien d'autre n'est lu : ni l'adresse,
// ni les deux autres cases.
//
// Elle ne rejette jamais : lue en partie, refusée ou rompue, elle le dit avec son motif. Une ligne d'un autre dossier, ou dont
// la case n'est pas un booléen, rend la lecture illisible — jamais « aucun accès ne la porte ». La réponse se rend avec le
// dossier lu : la page d'un dossier reste montée quand on passe à un autre.

export type LectureDesAccesCaisse = { dossierId: string } & AccesDuDossierLus

type AccesLu = { id: string; dossier_id: string; droit_caisse: unknown }

export async function lireLesAccesCaisseDuDossier(dossierId: string): Promise<LectureDesAccesCaisse> {
  try {
    const lecture = await lireTout<AccesLu>((debut, fin) =>
      supabase.from('memberships').select('id, dossier_id, droit_caisse', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    )
    if (!lecture.complete) return { dossierId, etat: 'illisibles', motif: lecture.motif ?? 'lecture incomplète' }
    if (lecture.lignes.some((l) => l.dossier_id !== dossierId)) {
      return { dossierId, etat: 'illisibles', motif: 'un accès rendu n’est pas de ce dossier' }
    }
    if (lecture.lignes.some((l) => typeof l.droit_caisse !== 'boolean')) {
      return { dossierId, etat: 'illisibles', motif: 'la case « Caisse » d’un accès n’est pas lisible' }
    }
    return { dossierId, etat: 'lus', avecLaCase: lecture.lignes.filter((l) => l.droit_caisse === true).length }
  } catch (e) {
    return { dossierId, etat: 'illisibles', motif: messageErreur(e, 'la lecture des accès a échoué') }
  }
}
