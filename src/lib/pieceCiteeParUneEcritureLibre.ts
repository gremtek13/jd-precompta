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
//
// LE REMÈDE N'EST DIT QUE S'IL EXISTE (relecture adverse du 25/11/2026) : « retire d'abord la citation de l'écriture » ne vaut que
// pour une écriture d'un exercice OUVERT. Celle d'un exercice validé est figée (`enregistrer_ecriture_libre` et
// `retirer_ecriture_libre` la refusent, 23514 ; sa contre-passation, EL7, ne retire pas la citation et la fige davantage) : sa
// pièce citée reste au dossier, et la phrase le dit au lieu d'offrir un geste que la base refuserait. Figée : son exercice au
// plus tard le dernier exercice validé du dossier (la frontière de `frontiere_validation`, le 31 décembre de celui-ci).

/** Ce que la garde lit d'une écriture libre : sa référence, la pièce qu'elle cite et son gel — jamais son libellé ni son motif. */
export interface CitationDUneEcritureLibre {
  exercice: number
  numero: number
  piece_citee_id: string
  /** Figée par la validation de son exercice : sa citation ne se retire plus. */
  figee: boolean
}

export type CitationsDesEcrituresLibres =
  | { dossierId: string; etat: 'absentes' }
  | { dossierId: string; etat: 'lues'; citations: readonly CitationDUneEcritureLibre[] }
  | { dossierId: string; etat: 'illisibles'; motif: string }

/** Le motif d'une lecture des citations qui n'a pas été faite en entier, ou nul (lue, absente, ou pas encore revenue). */
export function motifDesCitationsDesEcrituresLibres(lecture: CitationsDesEcrituresLibres | null): string | null {
  return lecture !== null && lecture.etat === 'illisibles' ? lecture.motif : null
}

/** Les citations de cette pièce parmi les lues, dans l'ordre des exercices puis des numéros. */
function citationsDeLaPiece(pieceId: string, lecture: CitationsDesEcrituresLibres | null): CitationDUneEcritureLibre[] {
  if (lecture === null || lecture.etat !== 'lues') return []
  const cible = pieceId.toLowerCase()
  return lecture.citations
    .filter((c) => c.piece_citee_id.toLowerCase() === cible)
    .slice()
    .sort((a, b) => a.exercice - b.exercice || a.numero - b.numero)
}

/** Les références des écritures libres qui citent cette pièce, dans l'ordre des exercices puis des numéros. */
export function ecrituresLibresQuiCitent(pieceId: string, lecture: CitationsDesEcrituresLibres | null): string[] {
  return citationsDeLaPiece(pieceId, lecture).map(referenceDeLEcritureLibre)
}

function enumeration(elements: readonly string[]): string {
  return elements.length <= 1 ? (elements[0] ?? '') : `${elements.slice(0, -1).join(', ')} et ${elements[elements.length - 1]}`
}

/** Le remède, quand toutes les écritures qui citent sont d'un exercice ouvert. */
export const REMEDE_D_UNE_CITATION_OUVERTE = 'Pour la supprimer, retire d’abord la citation de l’écriture, dans l’onglet Écritures.'

/**
 * Le refus de la SUPPRESSION de cette pièce par les écritures libres qui la citent, sous leur référence ; nul quand rien de ce qui
 * a été lu ne la cite — ou quand rien n'a été lu en entier : la base reste juge, et elle dit sa raison. Le remède n'est dit que si
 * aucune écriture qui la cite n'est figée : la citation d'une écriture d'un exercice validé ne se retire plus.
 */
export function refusDeSuppressionParLesEcrituresLibres(pieceId: string, lecture: CitationsDesEcrituresLibres | null): string | null {
  const citations = citationsDeLaPiece(pieceId, lecture)
  if (citations.length === 0) return null
  const references = citations.map(referenceDeLEcritureLibre)
  const qui = references.length === 1 ? `l’écriture libre ${references[0]}` : `les écritures libres ${enumeration(references)}`
  const figees = citations.filter((c) => c.figee).map(referenceDeLEcritureLibre)
  const suite = figees.length === 0 ? REMEDE_D_UNE_CITATION_OUVERTE
    : figees.length === 1 ? `L’écriture ${figees[0]} est d’un exercice validé : sa citation ne se retire plus, et la pièce reste au dossier.`
      : `Les écritures ${enumeration(figees)} sont d’exercices validés : leur citation ne se retire plus, et la pièce reste au dossier.`
  return `Cette pièce est citée par ${qui} : elle ne se supprime plus, sauf avec son dossier. ${suite}`
}

/** Le refus de la base, après le clic, quand la lecture n'a pas su dire la citation : la clé des écritures libres. Il ne sait pas
 *  quelle écriture cite : le remède dit sa condition. */
export const SUPPRESSION_CITEE_PAR_UNE_ECRITURE_LIBRE =
  'Cette pièce est citée par une écriture libre du dossier : elle ne se supprime plus, sauf avec son dossier. '
  + 'Pour la supprimer, retire d’abord la citation de l’écriture, dans l’onglet Écritures, si son exercice n’est pas validé ; '
  + 'validé, la citation ne se retire plus.'

// LE FICHIER D'UNE PIÈCE CITÉE NE SE REMPLACE PAS À L'ÉCRAN (RA253-Q3 (A), réponse du cabinet du 27/11/2026). Depuis la 254e
// migration (`fichier_cite_par_une_ecriture_libre`), `fichier_fige` refuse de retirer du stockage le fichier d'une pièce qu'une
// écriture libre cite, ouverte ou figée : « Remplacer le fichier » déposait le nouveau et échouait à retirer l'ancien. La fiche ne
// l'offre plus et dit pourquoi, comme pour une pièce figée par la validation. CÔTÉ FERMÉ : tant que les citations ne sont pas
// revenues en entier pour ce dossier (pas encore lues, lues en partie, lues pour un autre), on ne sait pas si une écriture cite
// la pièce — le geste n'est pas offert non plus, et la phrase dit pourquoi. Le drapeau baissé (`absentes`) : rien ne cite, le
// geste reste. Le remède, comme pour la suppression, n'est dit que si aucune écriture qui cite n'est figée.

/** Le remède, quand toutes les écritures qui citent sont d'un exercice ouvert. */
export const REMEDE_DU_REMPLACEMENT = 'Pour le remplacer, retire d’abord la citation de l’écriture, dans l’onglet Écritures.'

/** Les citations ne sont pas encore revenues : le fichier ne se remplace pas d'ici, faute de savoir. */
export const REMPLACEMENT_AVANT_LA_LECTURE = 'Les écritures libres du dossier ne sont pas encore lues : son fichier ne se remplace '
  + 'pas tant qu’on ne sait pas si l’une d’elles cite cette pièce.'

/** Les citations n'ont pas été lues en entier : le fichier ne se remplace pas d'ici. */
export function remplacementSansLecture(motif: string): string {
  return `Les écritures libres du dossier n’ont pas pu être lues en entier (${motif}) : son fichier ne se remplace pas tant `
    + 'qu’on ne sait pas si l’une d’elles cite cette pièce.'
}

/**
 * Pourquoi le fichier de cette pièce ne se remplace pas d'ici, ou nul quand il se remplace : aucune écriture libre lue en entier
 * ne la cite, ou les écritures libres ne sont pas en base. Une lecture pas revenue, partielle ou d'un autre dossier le retient.
 */
export function remplacementDuFichierRetenu(
  dossierId: string, pieceId: string, lecture: CitationsDesEcrituresLibres | null,
): string | null {
  if (lecture === null || lecture.dossierId !== dossierId) return REMPLACEMENT_AVANT_LA_LECTURE
  if (lecture.etat === 'absentes') return null
  if (lecture.etat === 'illisibles') return remplacementSansLecture(lecture.motif)
  const citations = citationsDeLaPiece(pieceId, lecture)
  if (citations.length === 0) return null
  const references = citations.map(referenceDeLEcritureLibre)
  const qui = references.length === 1 ? `l’écriture libre ${references[0]} cite` : `les écritures libres ${enumeration(references)} citent`
  const figees = citations.filter((c) => c.figee).map(referenceDeLEcritureLibre)
  const suite = figees.length === 0 ? REMEDE_DU_REMPLACEMENT
    : figees.length === 1 ? `L’écriture ${figees[0]} est d’un exercice validé : sa citation ne se retire plus, et le fichier reste celui-ci.`
      : `Les écritures ${enumeration(figees)} sont d’exercices validés : leur citation ne se retire plus, et le fichier reste celui-ci.`
  return `Son fichier ne se remplace plus : ${qui} ce fichier-là. ${suite}`
}

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
