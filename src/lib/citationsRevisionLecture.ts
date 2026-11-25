import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { refusDuRetraitDUneSourceCitee, refusDuRetraitParLeDossierPermanent } from './dossierPermanent'
import { lireLeDossierPermanent } from './dossierPermanentLecture'
import { refusDuRetraitDUneSource } from './revision'
import { refusDeSuppressionParLesEcrituresLibres, type CitationsDesEcrituresLibres } from './pieceCiteeParUneEcritureLibre'
import type { EntreeDossierPermanent, RevisionJustification, RevisionPreuve } from './types'

// CE QUE LA RÉVISION CITE, lu pour que les écrans qui retirent une pièce ou un document le disent AVANT le clic (ligne 41,
// étape R3, puis R7). Une pièce ou un document cité par une décision de la révision d'un solde, ou par une entrée du
// dossier permanent — même remplacée depuis, même retirée : l'historique garde ses preuves — ne se supprime plus, sauf
// avec son dossier (hypothèse Q8 du cabinet, `garder_source_citee`). La phrase est celle de la base, composée par
// `refusDuRetraitDUneSourceCitee` (lib/dossierPermanent.ts : la révision d'un solde d'abord, mot pour mot, puis la nature
// de l'entrée qui cite) ; ce module ne fait que lire ce qu'elle demande : les décisions, les preuves et les entrées du
// dossier permanent de TOUT le dossier, quel que soit leur exercice.
//
// `motif` : non nul quand l'une des trois lectures est partielle (la première qui l'est parle) ; c'est lui qui suspend ce
// qui ne se défait pas (« C'est une facture »). `motifRevision` et `motifDossierPermanent` disent LAQUELLE : l'écran la
// nomme, la révision d'un solde sous les mots d'hier. Une source citée peut alors paraître supprimable — la base refusera,
// avec sa raison —, et l'écran le dit plutôt que de laisser croire la liste complète.
export interface LectureDesCitations {
  decisions: Pick<RevisionJustification, 'id' | 'annee' | 'compte'>[]
  preuves: Pick<RevisionPreuve, 'justification_id' | 'piece_id' | 'document_id'>[]
  // Du dossier permanent, ce que la garde lit : la nature et la source citée de chaque version — jamais un titre ni un texte.
  entrees: Pick<EntreeDossierPermanent, 'nature' | 'piece_id' | 'document_id'>[]
  motif: string | null
  motifRevision: string | null
  motifDossierPermanent: string | null
}

export async function lireCitationsDeLaRevision(dossierId: string): Promise<LectureDesCitations> {
  const [lectureDecisions, lecturePreuves, lectureEntrees] = await Promise.all([
    lireTout<Pick<RevisionJustification, 'id' | 'annee' | 'compte'>>((debut, fin) =>
      supabase.from('revision_justifications').select('id, annee, compte', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
    lireTout<Pick<RevisionPreuve, 'justification_id' | 'piece_id' | 'document_id'>>((debut, fin) =>
      supabase.from('revision_preuves').select('id, justification_id, piece_id, document_id', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
    lireLeDossierPermanent(dossierId),
  ])
  return {
    decisions: lectureDecisions.lignes,
    preuves: lecturePreuves.lignes,
    // Seules la nature et la source passent : un titre ou un texte saisi n'a rien à faire dans un refus.
    entrees: lectureEntrees.lignes.map((e) => ({ nature: e.nature, piece_id: e.piece_id, document_id: e.document_id })),
    motif: [lectureDecisions, lecturePreuves, lectureEntrees].find((l) => !l.complete)?.motif ?? null,
    motifRevision: [lectureDecisions, lecturePreuves].find((l) => !l.complete)?.motif ?? null,
    motifDossierPermanent: lectureEntrees.complete ? null : lectureEntrees.motif,
  }
}

/**
 * Le refus de la base pour la SUPPRESSION de cette source (la révision d'un solde, puis le dossier permanent), mot pour mot, ou rien quand ce qui a été lu ne la cite pas.
 * Rien non plus avant la première lecture : la base reste juge, et elle dit sa raison.
 */
export function refusDeSuppression(
  source: { pieceId: string } | { documentId: string },
  citations: LectureDesCitations | null,
): string | null {
  if (citations === null) return null
  return refusDuRetraitDUneSourceCitee(source, 'suppression', citations, citations.entrees)
}

/** Qui cite une source : la révision d'un solde (qui se dit d'abord, comme la base), le dossier permanent, ou — pour une pièce —
 *  une écriture libre (ELQ8Q1-Q1 (A), lib/pieceCiteeParUneEcritureLibre.ts). */
export type QuiCite = 'revision' | 'dossier-permanent' | 'ecriture-libre'

export function quiCite(
  source: { pieceId: string } | { documentId: string },
  citations: LectureDesCitations | null,
): QuiCite | null {
  if (citations === null) return null
  if (refusDuRetraitDUneSource(source, 'suppression', citations.decisions, citations.preuves) !== null) return 'revision'
  return refusDuRetraitParLeDossierPermanent(source, 'suppression', citations.entrees) !== null ? 'dossier-permanent' : null
}

// UNE PIÈCE, CITÉE AUSSI PAR UNE ÉCRITURE LIBRE (ELQ8Q1-Q1 (A), 25/11/2026) : la clé `ecritures_libres_piece_citee_id_fkey` refuse sa
// suppression comme `garder_source_citee` celle d'une source de la révision. La même règle, dans le même ordre : la révision et le
// dossier permanent d'abord, sous les mots de la base, puis les écritures libres sous leur référence. Un document n'est jamais
// cité par une écriture libre : ces deux fonctions ne valent que pour une pièce.

/** Le refus de la suppression de cette pièce : la révision, le dossier permanent, puis les écritures libres ; nul sinon. */
export function refusDeSuppressionDUnePiece(
  pieceId: string, citations: LectureDesCitations | null, libres: CitationsDesEcrituresLibres | null,
): string | null {
  return refusDeSuppression({ pieceId }, citations) ?? refusDeSuppressionParLesEcrituresLibres(pieceId, libres)
}

/** Qui cite cette pièce, dans le même ordre. */
export function quiCiteLaPiece(
  pieceId: string, citations: LectureDesCitations | null, libres: CitationsDesEcrituresLibres | null,
): QuiCite | null {
  return quiCite({ pieceId }, citations)
    ?? (refusDeSuppressionParLesEcrituresLibres(pieceId, libres) !== null ? 'ecriture-libre' : null)
}

/**
 * Ce qui cite, dit pour une liste de sources écartées : « la révision des soldes » (les mots d'hier) tant que toutes sont
 * citées par elle, « le dossier permanent » quand toutes le sont par lui, « une écriture libre » (« des écritures libres » dès
 * deux pièces), et leur énumération sinon.
 */
export function citantDe(sortes: readonly (QuiCite | null)[]): string {
  const libres = sortes.filter((s) => s === 'ecriture-libre').length
  const noms = [
    sortes.includes('revision') ? 'la révision des soldes' : null,
    sortes.includes('dossier-permanent') ? 'le dossier permanent' : null,
    libres === 0 ? null : libres === 1 ? 'une écriture libre' : 'des écritures libres',
  ].filter((n): n is string => n !== null)
  if (noms.length === 0) return 'la révision des soldes'
  return noms.length === 1 ? noms[0] : `${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}`
}
