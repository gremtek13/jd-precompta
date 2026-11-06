import { lireTout, type LectureComplete } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'
import type { SituationPubliee } from './situationsPubliees'

// LES SITUATIONS PUBLIÉES, CE QUE LES ÉCRANS LISENT (espace client, ligne 51.5, étape C4b ; le patron : « Ma caisse »,
// lib/caisseClientLecture.ts). Aucune de ces lectures ne rejette : une requête qui lève ou un refus tombent du côté signalé,
// avec leur motif — jamais une liste vide. Chacune se rend AVEC le dossier qu'elle a lu : un écran ne prend pas la réponse
// d'un autre dossier.

const COLONNES = 'id, dossier_id, annee, geste, arretee_au, statut, contenu, remplace_id, auteur, publiee_le'

// Tri TOTAL, terminé par la clé primaire (`lireTout`).
function lireLesSituations(dossierId: string): Promise<LectureComplete<SituationPubliee>> {
  return lireTout<SituationPubliee>((debut, fin) =>
    supabase.from('situations_publiees').select(COLONNES, { count: 'exact' })
      .eq('dossier_id', dossierId).order('publiee_le').order('id').range(debut, fin),
  )
}

/** Une lecture dont une ligne n'est pas du dossier demandé ne se croit pas. */
function duDossier<T extends { dossier_id: string }>(lecture: LectureComplete<T>, dossierId: string): LectureComplete<T> {
  if (lecture.lignes.every((l) => l.dossier_id === dossierId)) return lecture
  return { lignes: [], complete: false, motif: lecture.motif ?? 'une ligne rendue n’est pas de ce dossier' }
}

// ── Côté cabinet ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Toutes les lignes du dossier — publications et retraits (`situations_publiees_lecture`, le cabinet du dossier) —, et les
// exercices validés, dont le statut se lit : la base refuse un statut qui ne serait plus le sien.
export interface LectureDuCabinet {
  dossierId: string
  situations: LectureComplete<SituationPubliee>
  anneesValidees: LectureComplete<number>
}

export async function lireLesSituationsDuCabinet(dossierId: string): Promise<LectureDuCabinet> {
  try {
    const [situations, exercices] = await Promise.all([
      lireLesSituations(dossierId),
      lireTout<{ annee: number; dossier_id: string }>((debut, fin) =>
        supabase.from('exercices_valides').select('annee, dossier_id', { count: 'exact' })
          .eq('dossier_id', dossierId).order('annee').order('dossier_id').range(debut, fin),
      ),
    ])
    const exercicesGardes = duDossier(exercices, dossierId)
    return {
      dossierId,
      situations: duDossier(situations, dossierId),
      anneesValidees: { ...exercicesGardes, lignes: exercicesGardes.lignes.map((e) => e.annee) },
    }
  } catch (erreur) {
    const motif = messageErreur(erreur, 'lecture refusée')
    return {
      dossierId,
      situations: { lignes: [], complete: false, motif },
      anneesValidees: { lignes: [], complete: false, motif },
    }
  }
}

// ── Côté client ───────────────────────────────────────────────────────────────────────────────────────────────────────
// LA CASE SE LIT DEUX FOIS : à la connexion (AuthContext), pour la route et l'entrée ; puis à la BASE, dans la même vague que
// les situations (`droits_sur_le_dossier`) — une case retirée entre-temps rendrait les situations VIDES, sans erreur, et
// l'écran dirait « aucune situation » d'un dossier qui en a. Sans la case, rien de ce qui a été lu n'est rendu. La RLS ne
// rend au client que les publications EN COURS (`situations_publiees_lecture_comptes`).
export type LectureDuClient =
  | { dossierId: string; etat: 'echec'; motif: string }
  | { dossierId: string; etat: 'sans_comptes' }
  | { dossierId: string; etat: 'lue'; situations: LectureComplete<SituationPubliee> }

export async function lireLesSituationsDuClient(dossierId: string): Promise<LectureDuClient> {
  try {
    const [droits, situations] = await Promise.all([
      supabase.rpc('droits_sur_le_dossier', { p_dossier_id: dossierId }),
      lireLesSituations(dossierId),
    ])
    if (droits.error) return { dossierId, etat: 'echec', motif: `ton accès à tes comptes n’a pas pu être vérifié (${messageErreur(droits.error, 'droits illisibles')})` }
    const data: unknown = droits.data
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return { dossierId, etat: 'echec', motif: 'ton accès à tes comptes n’a pas pu être vérifié (droits illisibles)' }
    }
    if ((data as Record<string, unknown>).comptes !== true) return { dossierId, etat: 'sans_comptes' }
    return { dossierId, etat: 'lue', situations: duDossier(situations, dossierId) }
  } catch (erreur) {
    return { dossierId, etat: 'echec', motif: messageErreur(erreur, 'tes comptes n’ont pas pu être lus') }
  }
}
