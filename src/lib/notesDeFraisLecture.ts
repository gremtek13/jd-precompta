import { lireTout, type LectureComplete } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'
import { NOTES_DE_FRAIS_PREVUES } from './notesDeFrais'
import type { NoteDeFrais, PieceDeLAuteur } from './notesDeFraisVue'

// LES NOTES DE FRAIS, CE QUE LES ÉCRANS LISENT (espace client, ligne 51.5, étape B8 ; le patron : lib/achatsClientLecture.ts).
// Aucune de ces lectures ne rejette : une requête qui lève ou un refus tombent du côté signalé, avec leur motif — jamais une
// liste vide. Chacune se rend AVEC le dossier qu'elle a lu. Les écrans ne lisent que sous `NOTES_DE_FRAIS_PREVUES` : avant la
// migration, la table n'existe pas.

const COLONNES_NOTE = 'id, dossier_id, auteur, beneficiaire_salarie, date_depense, nature, motif, montant_ttc, montant_tva, distance_km, vehicule_type, puissance_fiscale, electrique, piece_id, etat, version, cree_le, soumise_le, approuvee_le, refusee_le, motif_refus, remboursee_le, date_remboursement, moyen_remboursement'
const COLONNES_PIECE = 'id, dossier_id, nom_fichier, statut, uploaded_by, date_piece, montant_ttc, created_at'

const echec = <T>(motif: string): LectureComplete<T> => ({ lignes: [], complete: false, motif })

/** Une lecture dont une ligne n'est pas du dossier demandé ne se croit pas ; une lecture incomplète se rend telle quelle. */
function duDossier<T extends { dossier_id: string }>(lecture: LectureComplete<T>, dossierId: string): LectureComplete<T> {
  if (!lecture.complete || lecture.lignes.every((l) => l.dossier_id === dossierId)) return lecture
  return echec(lecture.motif ?? 'une ligne rendue n’est pas de ce dossier')
}

// ── Côté client ───────────────────────────────────────────────────────────────────────────────────────────────────────
// « MES NOTES DE FRAIS » : LA CASE SE LIT DEUX FOIS — à la connexion (AuthContext), pour la route et l'entrée ; puis à la BASE,
// dans la même vague que les notes (`droits_sur_le_dossier`) : une case retirée entre-temps rendrait les notes VIDES, sans
// erreur, et l'écran dirait « aucune note » d'un dossier qui en a. La case « Achats » se relit de même : elle ouvre la saisie
// pour un salarié et les décisions. Les notes, la base les filtre (les siennes ; avec « Achats », celles des autres dès leur
// soumission) ; les pièces, celles que le compte a déposées — les seules qu'une note cite.
export type MesNotesDeFraisLues =
  | { dossierId: string; etat: 'echec'; motif: string }
  | { dossierId: string; etat: 'sans_frais' }
  | {
    dossierId: string; etat: 'lues'; achats: boolean
    lesNotes: LectureComplete<NoteDeFrais>; pieces: LectureComplete<PieceDeLAuteur>
  }

export async function lireMesNotesDeFrais(dossierId: string, moi: string): Promise<MesNotesDeFraisLues> {
  // Drapeau baissé, la table n'existe pas : rien ne se lit (l'écran ne se monte pas non plus).
  if (!NOTES_DE_FRAIS_PREVUES) return { dossierId, etat: 'echec', motif: 'tes notes de frais ne sont pas encore ouvertes' }
  try {
    const [droits, lesNotes, pieces] = await Promise.all([
      supabase.rpc('droits_sur_le_dossier', { p_dossier_id: dossierId }),
      lireTout<NoteDeFrais>((debut, fin) =>
        supabase.from('notes_de_frais').select(COLONNES_NOTE, { count: 'exact' })
          .eq('dossier_id', dossierId).order('cree_le').order('id').range(debut, fin)),
      lireTout<PieceDeLAuteur>((debut, fin) =>
        supabase.from('pieces').select(COLONNES_PIECE, { count: 'exact' })
          .eq('dossier_id', dossierId).eq('uploaded_by', moi).order('created_at').order('id').range(debut, fin)),
    ])
    if (droits.error) {
      return { dossierId, etat: 'echec', motif: `ton accès à tes notes de frais n’a pas pu être vérifié (${messageErreur(droits.error, 'droits illisibles')})` }
    }
    const data: unknown = droits.data
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return { dossierId, etat: 'echec', motif: 'ton accès à tes notes de frais n’a pas pu être vérifié (droits illisibles)' }
    }
    const lus = data as Record<string, unknown>
    if (lus.frais !== true) return { dossierId, etat: 'sans_frais' }
    return {
      dossierId, etat: 'lues', achats: lus.achats === true,
      lesNotes: lesNotes.complete ? duDossier(lesNotes, dossierId) : lesNotes,
      pieces: pieces.complete ? duDossier(pieces, dossierId) : pieces,
    }
  } catch (erreur) {
    return { dossierId, etat: 'echec', motif: messageErreur(erreur, 'tes notes de frais n’ont pas pu être lues') }
  }
}

// ── Côté cabinet ──────────────────────────────────────────────────────────────────────────────────────────────────────
// La section de l'onglet Justificatifs : toutes les notes du dossier (la base les ouvre au cabinet), et le nom des pièces
// qu'elles citent — lues dans une seconde vague, par leurs identifiants.
export interface NotesDeFraisDuDossierLues {
  dossierId: string
  lesNotes: LectureComplete<NoteDeFrais>
  justificatifs: LectureComplete<{ id: string; dossier_id: string; nom_fichier: string; statut: string }>
}

export async function lireLesNotesDeFraisDuDossier(dossierId: string): Promise<NotesDeFraisDuDossierLues> {
  if (!NOTES_DE_FRAIS_PREVUES) {
    const motif = 'les notes de frais ne sont pas encore en base'
    return { dossierId, lesNotes: echec(motif), justificatifs: echec(motif) }
  }
  try {
    const lues = await lireTout<NoteDeFrais>((debut, fin) =>
      supabase.from('notes_de_frais').select(COLONNES_NOTE, { count: 'exact' })
        .eq('dossier_id', dossierId).order('cree_le').order('id').range(debut, fin))
    const lesNotes = lues.complete ? duDossier(lues, dossierId) : lues
    if (!lesNotes.complete) return { dossierId, lesNotes, justificatifs: echec(lesNotes.motif ?? 'les notes de frais n’ont pas été lues') }
    const ids = [...new Set(lesNotes.lignes.flatMap((n) => (n.piece_id === null ? [] : [n.piece_id])))].sort()
    if (ids.length === 0) return { dossierId, lesNotes, justificatifs: { lignes: [], complete: true, motif: null } }
    const justificatifs = await lireTout<{ id: string; dossier_id: string; nom_fichier: string; statut: string }>((debut, fin) =>
      supabase.from('pieces').select('id, dossier_id, nom_fichier, statut', { count: 'exact' })
        .eq('dossier_id', dossierId).in('id', ids).order('id').range(debut, fin))
    return { dossierId, lesNotes, justificatifs: justificatifs.complete ? duDossier(justificatifs, dossierId) : justificatifs }
  } catch (erreur) {
    const motif = messageErreur(erreur, 'lecture refusée')
    return { dossierId, lesNotes: echec(motif), justificatifs: echec(motif) }
  }
}
