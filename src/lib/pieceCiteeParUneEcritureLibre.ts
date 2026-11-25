import { referenceDeLEcritureLibre } from './ecrituresLibresDesExports'

// LA PIÈCE CITÉE PAR UNE ÉCRITURE LIBRE NE SE SUPPRIME PAS, DIT AVANT LE CLIC (ELQ8Q1-Q1 (A), 25/11/2026). Pur, sans réseau et
// sans import de `supabase.ts`.
//
// En base (EL2, `ecritures_libres.piece_citee_id references public.pieces(id)`, sans clause `on delete` : NO ACTION), une pièce
// qu'une écriture libre cite ne se supprime plus — la base lève 23503 sur la clé `ecritures_libres_piece_citee_id_fkey` —, sauf
// avec son dossier (les deux tables partent alors en cascade). Depuis ELQ8-Q1 (B), une pièce « à valider » peut être citée :
// l'écran le disait après le clic seulement. La règle est celle de `garder_source_citee` pour la révision et le dossier
// permanent (lib/citationsRevisionLecture.ts) : la fiche n'offre pas « Supprimer », la sélection écarte la pièce et la NOMME.
//
// LES MOTS NOMMENT L'ÉCRITURE PAR SA RÉFÉRENCE (« EL2026-0003 », `referenceDeLEcritureLibre`, celle du FEC et de l'état),
// jamais son libellé ni son motif : ni l'un ni l'autre ne sont lus ici.
//
// UNE LECTURE PARTIELLE OU REFUSÉE NE DIT RIEN DE FAUX : aucune pièce n'est dite citée (la base reste juge, et le refus de
// la base se traduit après le clic, `refusDeSuppressionParUneEcritureLibre`), et l'écran le dit dans un bandeau. Une lecture pas
// encore revenue est NULLE : rien n'est dit non plus. Le drapeau baissé (`absentes`) : aucune écriture libre, rien ne cite.

/** Ce que la garde lit d'une écriture libre : sa référence et la pièce qu'elle cite — jamais son libellé ni son motif. */
export interface CitationDUneEcritureLibre {
  exercice: number
  numero: number
  piece_citee_id: string
}

export type CitationsDesEcrituresLibres =
  | { dossierId: string; etat: 'absentes' }
  | { dossierId: string; etat: 'lues'; citations: readonly CitationDUneEcritureLibre[] }
  | { dossierId: string; etat: 'illisibles'; motif: string }

/** Le motif d'une lecture des citations qui n'a pas été faite en entier, ou nul (lue, absente, ou pas encore revenue). */
export function motifDesCitationsDesEcrituresLibres(lecture: CitationsDesEcrituresLibres | null): string | null {
  return lecture !== null && lecture.etat === 'illisibles' ? lecture.motif : null
}

/** Les références des écritures libres qui citent cette pièce, dans l'ordre des exercices puis des numéros. */
export function ecrituresLibresQuiCitent(pieceId: string, lecture: CitationsDesEcrituresLibres | null): string[] {
  if (lecture === null || lecture.etat !== 'lues') return []
  const cible = pieceId.toLowerCase()
  return lecture.citations
    .filter((c) => c.piece_citee_id.toLowerCase() === cible)
    .slice()
    .sort((a, b) => a.exercice - b.exercice || a.numero - b.numero)
    .map(referenceDeLEcritureLibre)
}

function enumeration(elements: readonly string[]): string {
  return elements.length <= 1 ? (elements[0] ?? '') : `${elements.slice(0, -1).join(', ')} et ${elements[elements.length - 1]}`
}

/**
 * Le refus de la SUPPRESSION de cette pièce par les écritures libres qui la citent, sous leur référence ; nul quand rien de ce qui
 * a été lu ne la cite — ou quand rien n'a été lu en entier : la base reste juge, et elle dit sa raison.
 */
export function refusDeSuppressionParLesEcrituresLibres(pieceId: string, lecture: CitationsDesEcrituresLibres | null): string | null {
  const references = ecrituresLibresQuiCitent(pieceId, lecture)
  if (references.length === 0) return null
  const qui = references.length === 1 ? `l’écriture libre ${references[0]}` : `les écritures libres ${enumeration(references)}`
  return `Cette pièce est citée par ${qui} : elle ne se supprime plus, sauf avec son dossier. `
    + `Pour la supprimer, retire d’abord la citation de l’écriture, dans l’onglet Écritures.`
}

/** Le refus de la base, après le clic, quand la lecture n'a pas su dire la citation : la clé des écritures libres. */
export const SUPPRESSION_CITEE_PAR_UNE_ECRITURE_LIBRE =
  'Cette pièce est citée par une écriture libre du dossier : elle ne se supprime plus, sauf avec son dossier. '
  + 'Pour la supprimer, retire d’abord la citation de l’écriture, dans l’onglet Écritures.'

/**
 * LE REFUS DE LA BASE DEVANT LA SUPPRESSION D'UNE PIÈCE QU'UNE ÉCRITURE LIBRE CITE, TRADUIT : la clé étrangère
 * `ecritures_libres_piece_citee_id_fkey` lève 23503 (« violates foreign key constraint … on table "ecritures_libres" »). Les mots
 * de l'écran, ou rien pour tout autre refus — l'appelant dit alors celui de la base, tel quel.
 */
export function refusDeSuppressionParUneEcritureLibre(
  erreur: { code?: string | null; message?: string | null; details?: string | null } | null | undefined,
): string | null {
  if (!erreur || erreur.code !== '23503') return null
  const texte = `${erreur.message ?? ''} ${erreur.details ?? ''}`
  return /ecritures_libres_piece_citee_id_fkey|"ecritures_libres"/.test(texte) ? SUPPRESSION_CITEE_PAR_UNE_ECRITURE_LIBRE : null
}
