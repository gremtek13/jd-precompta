import type { RefusDeLaBase } from './pieceDUneFactureReprise'

// LE SOUS-DOSSIER D'UN DOCUMENT OU D'UNE PIÈCE, TENU DANS SON DOSSIER (DOCF-Q1-B, « (A) Préparer la contrainte en base »,
// tranchée par le cabinet le 17/11/2026 à la recommandation ; HISTORIQUE.md, « 17/11/2026 — DOCF-Q1-B : LE SOUS-DOSSIER TENU
// DANS SON DOSSIER, EN BASE (PRÉPARÉE, PAS APPLIQUÉE) »).
//
// La base vérifiait seulement que le sous-dossier d'un document (`documents_divers`) ou d'une pièce (`pieces`) existe : la
// migration `sous_dossier_dans_son_dossier` (supabase/schema/20261127055603_sous_dossier_dans_son_dossier.sql, en production depuis le 27/11/2026, 257)
// pose `garder_sous_dossier_dans_son_dossier`, qui tire juste après la porte d'accès et avant la clé étrangère — le
// sous-dossier est un sous-dossier du dossier de la ligne, lu verrouillé en partage —, et `garder_sous_dossier_occupe` : un
// sous-dossier qui range un document ou une pièce ne change pas de dossier.
//
// Ce module en redit les refus, aux mots de la base et dans l'ordre de son texte, et le jugement ; le test les confronte au
// texte de la migration et à son essai. Pur : il n'importe jamais `supabase.ts`. Aucun écran ne s'en sert : les fiches d'un
// document et d'une pièce n'offrent que les sous-dossiers lus dans leur dossier, et la fiche d'un document revérifie le choix
// (DOCF-Q1) ; aucun écran ne change le dossier d'un sous-dossier. Un refus ne dit rien du sous-dossier, et ne distingue pas
// celui d'un autre dossier d'un identifiant inconnu.

// LE DRAPEAU, LEVÉ le 27/11/2026 (la migration appliquée, 257) ; baissé tant qu'elle ne l'était pas, il se lève le jour où son fichier entre dans
// supabase/schema/, texte inchangé, et se baisse AVANT tout retour. Il se lit À CHAQUE APPEL : les tests jouent ses deux états
// sur l'objet ci-dessous.
export const DRAPEAU_DU_SOUS_DOSSIER = {
  /** Vrai le jour de l'application de `sous_dossier_dans_son_dossier`. */
  SOUS_DOSSIER_DANS_SON_DOSSIER_PREVU: true as boolean,
}

/** Le drapeau, lu à l'appel. */
export function sousDossierDansSonDossierPrevu(): boolean {
  return DRAPEAU_DU_SOUS_DOSSIER.SOUS_DOSSIER_DANS_SON_DOSSIER_PREVU
}

/** Les trois refus des deux gardes, dans l'ordre du texte de la migration. */
export const REFUS_DU_SOUS_DOSSIER = [
  { cle: 'document_hors_du_dossier', code: '23514', modele: 'Le sous-dossier d\'un document est un sous-dossier de son dossier.' },
  { cle: 'piece_hors_du_dossier', code: '23514', modele: 'Le sous-dossier d\'une pièce est un sous-dossier de son dossier.' },
  {
    cle: 'sous_dossier_occupe_change_de_dossier',
    code: '23514',
    modele: 'Ce sous-dossier range des documents ou des pièces de son dossier : il ne change pas de dossier.',
  },
] as const satisfies readonly RefusDeLaBase[]

export type CleDuRefusDuSousDossier = (typeof REFUS_DU_SOUS_DOSSIER)[number]['cle']

function refus(cle: CleDuRefusDuSousDossier): { cle: CleDuRefusDuSousDossier; message: string } {
  return { cle, message: REFUS_DU_SOUS_DOSSIER.find((r) => r.cle === cle)!.modele }
}

/**
 * Ce que la garde refuserait d'un document ou d'une pièce rangé dans un sous-dossier : `dossierDuSousDossier` est le dossier
 * du sous-dossier, nul quand il est inconnu (la garde le refuse sous les mêmes mots). Nul quand rien : sans sous-dossier, ou
 * rangé dans un sous-dossier de son dossier.
 */
export function refusDuRangement(l: {
  table: 'documents_divers' | 'pieces'
  dossierId: string
  sousDossierId: string | null
  dossierDuSousDossier: string | null
}): { cle: CleDuRefusDuSousDossier; message: string } | null {
  if (l.sousDossierId === null || l.dossierDuSousDossier === l.dossierId) return null
  return refus(l.table === 'documents_divers' ? 'document_hors_du_dossier' : 'piece_hors_du_dossier')
}

/** Ce que la garde refuserait du changement de dossier d'un sous-dossier : occupé (un document ou une pièce), il n'en change pas. */
export function refusDuDeplacement(s: { dossierId: string; nouveauDossierId: string; occupe: boolean }):
  { cle: CleDuRefusDuSousDossier; message: string } | null {
  return s.nouveauDossierId !== s.dossierId && s.occupe ? refus('sous_dossier_occupe_change_de_dossier') : null
}

/** Le refus selon l'état de la base (sans valeur par défaut) : baissé, la base d'aujourd'hui ne refuse rien de tel. */
export function refusDuRangementSelon(prevu: boolean, l: Parameters<typeof refusDuRangement>[0]):
  { cle: CleDuRefusDuSousDossier; message: string } | null {
  return prevu ? refusDuRangement(l) : null
}
