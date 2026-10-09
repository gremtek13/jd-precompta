import { supabase } from './supabase'
import { messageErreur } from './messageErreur'
import type { NoteInterne } from './types'

// LES NOTES INTERNES DU CABINET (espace client, étape P0 ; migration notes_internes_du_cabinet, 09/10/2026).
//
// Elles vivaient dans `pieces.notes` et `documents_divers.notes`, des colonnes de tables que le client du dossier LIT :
// aucun écran ne les lui montrait, mais son navigateur les recevait à chaque lecture de ses pièces. Elles vivent
// désormais dans `notes_internes`, que le cabinet du dossier SEUL lit et écrit (`admin_du_dossier`, aucune branche
// pour un accès client) — `supabase/essais/notesInternes.sql` le prouve par impersonation. Les anciennes colonnes ne
// sont plus ni lues ni écrites (`notesInternesEcritures.test.ts`), et attendent leur suppression (EC-Q7).
//
// Deux règles tiennent à la base et ne se discutent pas ici :
//   - une note par cible au plus — d'où l'upsert sur la cible ;
//   - effacée, une note reste une ligne au texte vide : l'écran ne la retire jamais. C'est ce qui permettra, avant de
//     retirer les anciennes colonnes, de distinguer une note reprise ici d'une note écrite APRÈS la recopie dans
//     l'ancienne colonne par un onglet resté ouvert sur l'application d'avant (la base date chaque modification).

/** Ce que porte une note : une pièce OU un document, jamais les deux (contrainte en base). */
export type CibleNoteInterne = { type: 'piece'; id: string } | { type: 'document'; id: string }

const colonneDe = (cible: CibleNoteInterne) => (cible.type === 'piece' ? 'piece_id' : 'document_id')

/**
 * La note d'une cible telle que la base l'a rendue : son texte — vide quand il n'y en a pas —, ou la raison qui empêche
 * de la lire. Une lecture refusée n'est PAS une note vide : l'écran qui l'offrirait à la saisie l'écraserait au premier
 * enregistrement (CLAUDE.md, « Lecture → formulaire → écriture »).
 */
export type LectureNoteInterne = { etat: 'lue'; texte: string } | { etat: 'illisible'; message: string }

/**
 * Une saisie à écrire : la note a été LUE et le texte tapé en diffère. Rien tant qu'elle n'est pas lue, ni si sa
 * lecture a échoué — c'est ce qui empêche un champ vide faute d'avoir lu d'effacer la note en base.
 */
export function noteModifiee(lecture: LectureNoteInterne | null, saisie: string): boolean {
  return lecture?.etat === 'lue' && saisie !== lecture.texte
}

/**
 * Lit la note d'une pièce ou d'un document : une ligne au plus, par sa cible. Ne lève jamais : l'écran l'appelle sans
 * attendre, et une exception perdue laisserait le champ « en lecture » pour toujours.
 */
export async function lireNoteInterne(cible: CibleNoteInterne): Promise<LectureNoteInterne> {
  try {
    const { data, error } = await supabase
      .from('notes_internes')
      .select('texte')
      .eq(colonneDe(cible), cible.id)
      .maybeSingle()
    if (error) return { etat: 'illisible', message: messageErreur(error, 'La note interne n’a pas pu être lue.') }
    const texte: unknown = (data as Pick<NoteInterne, 'texte'> | null)?.texte
    return { etat: 'lue', texte: typeof texte === 'string' ? texte : '' }
  } catch (e) {
    return { etat: 'illisible', message: messageErreur(e, 'La note interne n’a pas pu être lue.') }
  }
}

/**
 * Écrit la note d'une cible : la crée, ou la remplace — un texte vide compris, qui l'efface sans retirer sa ligne.
 * Lève, avec la raison de la base, si l'écriture est refusée : à l'appelant de dire ce qui n'a pas été gardé (la fiche
 * d'une pièce écrit la note AVANT la pièce ; l'import, qui ne connaît la pièce qu'après l'avoir créée, la retire).
 */
export async function enregistrerNoteInterne(dossierId: string, cible: CibleNoteInterne, texte: string): Promise<void> {
  // `onConflict` explicite : la clé primaire est un `id` de substitution, et sans lui l'upsert ne trouverait jamais de
  // conflit — la contrainte unique de la cible refuserait alors la seconde note au lieu de la remplacer.
  const { error } = await supabase
    .from('notes_internes')
    .upsert({ dossier_id: dossierId, [colonneDe(cible)]: cible.id, texte }, { onConflict: colonneDe(cible) })
  if (error) throw new Error(messageErreur(error, 'La note interne n’a pas pu être enregistrée.'))
}
