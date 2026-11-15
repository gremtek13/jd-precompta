import { useEffect, useState } from 'react'
import { lireTout, type LectureComplete } from './lectureComplete'
import { messageErreur } from './messageErreur'
import type { PrevisionPubliee } from './previsionsPubliees'
import { supabase } from './supabase'

// LA PRÉVISION DE TRÉSORERIE PUBLIÉE, CE QUE LES ÉCRANS LISENT (espace client, C8-Q2 ; le patron : les situations
// publiées, lib/situationsPublieesLecture.ts). Aucune de ces lectures ne rejette : une requête qui lève ou un refus tombent
// du côté signalé, avec leur motif — jamais une liste vide. Chacune se rend AVEC le dossier qu'elle a lu : un écran ne prend
// pas la réponse d'un autre dossier. Ni l'auteur ni rien d'autre que le geste, le contenu, le lien et le jour ne se lisent.

const COLONNES = 'id, dossier_id, geste, contenu, remplace_id, publiee_le'

/** Une lecture dont une ligne n'est pas du dossier demandé ne se croit pas. */
function duDossier<T extends { dossier_id: string }>(lecture: LectureComplete<T>, dossierId: string): LectureComplete<T> {
  if (lecture.lignes.every((l) => l.dossier_id === dossierId)) return lecture
  return { lignes: [], complete: false, motif: lecture.motif ?? 'une ligne rendue n’est pas de ce dossier' }
}

// ── Côté cabinet ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Toutes les lignes du dossier — publications et retraits (`previsions_publiees_lecture`, le cabinet du dossier) : la
// prévision en cours s'en déduit, et une publication cite celle qu'elle remplace. Lue en partie, elle se rend telle quelle,
// son motif avec elle : l'écran n'offre alors aucun geste.
export interface LectureDuCabinet {
  dossierId: string
  previsions: LectureComplete<PrevisionPubliee>
}

export async function lireLesPrevisionsDuCabinet(dossierId: string): Promise<LectureDuCabinet> {
  try {
    const previsions = await lireTout<PrevisionPubliee>((debut, fin) =>
      supabase.from('previsions_publiees').select(COLONNES, { count: 'exact' })
        .eq('dossier_id', dossierId).order('publiee_le').order('id').range(debut, fin))
    return { dossierId, previsions: previsions.complete ? duDossier(previsions, dossierId) : previsions }
  } catch (erreur) {
    return { dossierId, previsions: { lignes: [], complete: false, motif: messageErreur(erreur, 'lecture refusée') } }
  }
}

// ── Côté client ───────────────────────────────────────────────────────────────────────────────────────────────────────
// LA CASE SE RELIT À LA BASE (`droits_sur_le_dossier`), dans la même vague que la prévision : une case retirée depuis la
// connexion rendrait la prévision VIDE, sans erreur, et la page dirait « aucune prévision » d'un dossier qui en a une. Sans
// la case, rien de ce qui a été lu n'est rendu. La RLS ne rend au client que la publication EN COURS
// (`previsions_publiees_lecture_banque`).
export type LectureDuClient =
  | { dossierId: string; etat: 'echec'; motif: string }
  | { dossierId: string; etat: 'sans_banque' }
  | { dossierId: string; etat: 'lue'; previsions: LectureComplete<PrevisionPubliee> }

export async function lireLaPrevisionDuClient(dossierId: string): Promise<LectureDuClient> {
  try {
    const [droits, previsions] = await Promise.all([
      supabase.rpc('droits_sur_le_dossier', { p_dossier_id: dossierId }),
      lireTout<PrevisionPubliee>((debut, fin) =>
        supabase.from('previsions_publiees').select(COLONNES, { count: 'exact' })
          .eq('dossier_id', dossierId).order('publiee_le').order('id').range(debut, fin)),
    ])
    if (droits.error) return { dossierId, etat: 'echec', motif: `ton accès à ta banque n’a pas pu être vérifié (${messageErreur(droits.error, 'droits illisibles')})` }
    const data: unknown = droits.data
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return { dossierId, etat: 'echec', motif: 'ton accès à ta banque n’a pas pu être vérifié (droits illisibles)' }
    }
    if ((data as Record<string, unknown>).banque !== true) return { dossierId, etat: 'sans_banque' }
    return { dossierId, etat: 'lue', previsions: previsions.complete ? duDossier(previsions, dossierId) : previsions }
  } catch (erreur) {
    return { dossierId, etat: 'echec', motif: messageErreur(erreur, 'la prévision de ton cabinet n’a pas pu être lue') }
  }
}

/**
 * La prévision publiée de la société `dossierId`, ou `null` tant qu'elle n'est pas revenue (toujours sans société, ou le
 * drapeau baissé : rien ne se lit). Gardée avec la société : un client à plusieurs sociétés ne voit jamais la prévision de
 * l'une sous l'autre.
 */
export function usePrevisionDuClient(dossierId: string | null, prevues: boolean): LectureDuClient | null {
  const [lue, setLue] = useState<LectureDuClient | null>(null)

  useEffect(() => {
    if (!dossierId || !prevues) return
    let annule = false
    lireLaPrevisionDuClient(dossierId).then((lecture) => { if (!annule) setLue(lecture) })
    return () => { annule = true }
  }, [dossierId, prevues])

  return prevues && lue !== null && lue.dossierId === dossierId ? lue : null
}
