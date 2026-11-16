import type { RefusDeLaBase } from './pieceDUneFactureReprise'

// LA PIÈCE D'UN PAIEMENT, TENUE DANS SON DOSSIER (ligne 51.5 ; A8Q5-Q4, « (A) Une garde en base », tranchée par le cabinet le
// 16/11/2026 à la recommandation ; HISTORIQUE.md, « 16/11/2026 — A8Q5-Q4, A8Q5Q3Q2-Q3 ET A8Q5Q3Q2Q2-Q1 : TROIS MIGRATIONS
// PRÉPARÉES APRÈS LA GARDE DES RÈGLEMENTS »).
//
// Rien ne tenait la pièce d'un mouvement du relevé, ni celle de la part d'un virement groupé, dans le dossier de la ligne : la
// base vérifiait seulement qu'elle existe, et une garde qui juge la pièce citée (celle des factures reprises, celle de
// l'exemplaire d'une facture source) répondait alors sur la pièce d'un dossier que l'auteur du geste ne lit pas, en en disant le
// nom de fichier et la facture. La migration `piece_d_un_paiement_dans_son_dossier`, en production
// depuis le 16/11/2026 (supabase/schema/20261116174425_piece_d_un_paiement_dans_son_dossier.sql), pose `garder_piece_dans_son_dossier`, qui tire
// juste après la porte d'accès et avant toute garde qui lit la pièce : la pièce d'un mouvement est de son dossier ; celle d'une
// part, du dossier de la part et de son mouvement ; une pièce qu'un mouvement ou une part cite, un mouvement dont des parts
// citent une pièce, ne changent pas de dossier. Le paiement par la caisse la tenait déjà (sa fonction, la garde de la table).
//
// Ce module en redit les refus, aux mots de la base et dans l'ordre où elle les dit, et le jugement ; le test les confronte au
// texte de la migration et à son essai. Pur : il n'importe jamais `supabase.ts`. Aucun écran ne s'en sert : aucun n'offre la
// pièce d'un autre dossier — les rapprochements, le virement groupé et la caisse ne listent que les pièces du dossier, et
// aucun écran ne change le dossier d'une pièce ni d'un mouvement. La garde ne dit rien de la pièce (ni nom, ni dossier) et ne
// distingue pas une pièce d'un autre dossier d'un identifiant inconnu : elle tire avant la clé étrangère.

// LE DRAPEAU, LEVÉ depuis l'application de la migration le 16/11/2026 (le fichier entré dans supabase/schema/ sous la version
// 20261116174425, texte inchangé) ; il se baisse AVANT tout retour. Il se lit À CHAQUE APPEL : les tests jouent ses deux états sur
// l'objet ci-dessous.
export const DRAPEAU_DE_LA_PIECE_D_UN_PAIEMENT = {
  /** Vrai depuis l'application de `piece_d_un_paiement_dans_son_dossier`, le 16/11/2026. */
  PIECE_D_UN_PAIEMENT_DANS_SON_DOSSIER_PREVUE: true as boolean,
}

/** Le drapeau, lu à l'appel. */
export function pieceDUnPaiementDansSonDossierPrevue(): boolean {
  return DRAPEAU_DE_LA_PIECE_D_UN_PAIEMENT.PIECE_D_UN_PAIEMENT_DANS_SON_DOSSIER_PREVUE
}

/** Les quatre refus de `garder_piece_dans_son_dossier`, dans l'ordre de son texte. */
export const REFUS_DE_LA_PIECE_D_UN_PAIEMENT = [
  {
    cle: 'piece_citee_change_de_dossier',
    code: '23514',
    modele: 'Cette pièce est citée par un mouvement du relevé, ou par la part d\'un virement groupé, de son dossier : elle ne change pas de dossier.',
  },
  {
    cle: 'part_hors_du_dossier',
    code: '23514',
    modele: 'La pièce d\'une part d\'un virement groupé est une pièce du dossier de ce virement.',
  },
  {
    cle: 'mouvement_hors_du_dossier',
    code: '23514',
    modele: 'La pièce d\'un mouvement du relevé est une pièce de son dossier.',
  },
  {
    cle: 'mouvement_groupe_change_de_dossier',
    code: '23514',
    modele: 'Ce mouvement règle en groupe des pièces de son dossier : il ne change pas de dossier.',
  },
] as const satisfies readonly RefusDeLaBase[]

export type CleDuRefusDeLaPiece = (typeof REFUS_DE_LA_PIECE_D_UN_PAIEMENT)[number]['cle']

function refus(cle: CleDuRefusDeLaPiece): { cle: CleDuRefusDeLaPiece; message: string } {
  return { cle, message: REFUS_DE_LA_PIECE_D_UN_PAIEMENT.find((r) => r.cle === cle)!.modele }
}

/**
 * Ce que la garde refuserait d'un mouvement qui cite une pièce : `dossierDeLaPiece` est le dossier de la pièce, nul quand la
 * pièce est inconnue (la garde le refuse sous les mêmes mots). Nul quand rien.
 */
export function refusDuMouvement(m: { dossierId: string; pieceId: string | null; dossierDeLaPiece: string | null }):
  { cle: CleDuRefusDeLaPiece; message: string } | null {
  if (m.pieceId === null) return null
  return m.dossierDeLaPiece === m.dossierId ? null : refus('mouvement_hors_du_dossier')
}

/** Ce que la garde refuserait d'une part : sa pièce, du dossier de la part et de celui de son mouvement. Nul quand rien. */
export function refusDeLaPart(p: { dossierId: string; dossierDuMouvement: string; pieceId: string | null; dossierDeLaPiece: string | null }):
  { cle: CleDuRefusDeLaPiece; message: string } | null {
  if (p.pieceId === null) return null
  return p.dossierDeLaPiece === p.dossierId && p.dossierDuMouvement === p.dossierId ? null : refus('part_hors_du_dossier')
}

/** Le refus selon l'état de la base (sans valeur par défaut) : baissé, la base d'aujourd'hui ne refuse rien de tel. */
export function refusDuMouvementSelon(prevue: boolean, m: Parameters<typeof refusDuMouvement>[0]):
  { cle: CleDuRefusDeLaPiece; message: string } | null {
  return prevue ? refusDuMouvement(m) : null
}
