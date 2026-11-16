import type { RefusDeLaBase } from './pieceDUneFactureReprise'

// LA PIÈCE CITÉE RÉGLÉE À L'ÉCART D'ALIGNEMENT PRÈS : LE PLANCHER PREND LA PIÈCE ENTIÈRE (ligne 51.5 ; A8Q5Q3Q2-Q3, « (A) La
// pièce entière sous le seuil », tranchée par le cabinet le 16/11/2026 à la recommandation ; HISTORIQUE.md, « 16/11/2026 —
// A8Q5-Q4, A8Q5Q3Q2-Q3 ET A8Q5Q3Q2Q2-Q1 : TROIS MIGRATIONS PRÉPARÉES APRÈS LA GARDE DES RÈGLEMENTS »).
//
// Le plancher du registre d'une facture reprise (`recu_par_la_piece`, A8Q5Q3-Q2) était ce que sa pièce citée a REÇU. Sous
// l'écart d'alignement (lib/alignementBanque.ts, `seuilAlignement` : 2 % du montant, 5 € au plus), la 2035 tient pourtant une
// pièce pour réglée en entier (lib/rattachement.ts, `partsDesPaiements`) : non réalignée, la pièce laissait le registre
// recevoir l'écart, compté deux fois. La migration `plancher_a_l_ecart_d_alignement`, en production
// depuis le 16/11/2026 (supabase/schema/20261116174644_plancher_a_l_ecart_d_alignement.sql), fait de `recu_par_la_piece` ce que la 2035 compte
// de la pièce — la pièce entière quand son reçu la règle à l'écart près —, en entiers, dans la base ; et, le plancher
// dépendant désormais du montant de la pièce, `garder_plancher_d_une_piece_citee` juge à la fin du geste un montant qui le
// fait monter, comme la garde des règlements juge un paiement.
//
// Ce module redit la règle (`plancherDUnePiece`) et les deux refus de la garde, aux mots de la base ;
// plancherALEcartDAlignement.test.ts les confronte au texte de la migration, à son essai, et à la règle de la 2035 elle-même
// sur un balayage de montants. Pur : il n'importe jamais `supabase.ts`. La fenêtre des encaissements n'a rien à recalculer :
// elle lit le plancher que la base rend (`recu_par_sa_piece_centimes`, lib/recuParLaPieceCitee.ts). Aucun écran ne change le
// montant d'une pièce citée en disant ce refus avant le clic : la fiche d'une pièce ne lit pas le lien d'une pièce à sa
// facture reprise (comme les règlements, lib/reglementsDeLaPieceCitee.ts).

// LE DRAPEAU, LEVÉ depuis l'application de la migration le 16/11/2026 (le fichier entré dans supabase/schema/ sous la version
// 20261116174644, texte inchangé) ; il se baisse AVANT tout retour. Il se lit À CHAQUE APPEL : les tests jouent ses deux états sur
// l'objet ci-dessous.
export const DRAPEAU_DU_PLANCHER_A_L_ECART = {
  /** Vrai depuis l'application de `plancher_a_l_ecart_d_alignement`, le 16/11/2026. */
  PLANCHER_A_L_ECART_D_ALIGNEMENT_PREVU: true as boolean,
}

/** Le drapeau, lu à l'appel. */
export function plancherALEcartDAlignementPrevu(): boolean {
  return DRAPEAU_DU_PLANCHER_A_L_ECART.PLANCHER_A_L_ECART_D_ALIGNEMENT_PREVU
}

/** L'écart d'alignement, en entiers : (pièce − reçu) × DIVISEUR ≤ pièce (2 %), et pièce − reçu ≤ PLAFOND (5 €). */
export const DIVISEUR_DE_L_ECART = 50
export const PLAFOND_DE_L_ECART_CENTIMES = 500

/**
 * Ce que la 2035 compte d'une pièce dont les paiements de son dossier somment `recuCentimes` (jamais négatif), en centimes : la
 * pièce entière quand ce reçu, positif et sous son montant, en laisse au plus 2 % et au plus 5 € ; sinon, ce reçu — payée
 * au-delà de son montant, ou sans paiement, rien ne change. Le calcul de `recu_par_la_piece_au_montant`, en entiers.
 */
export function plancherDUnePiece(recuCentimes: number, montantTtc: number | null): number {
  const piece = Math.round(Math.abs(montantTtc ?? 0) * 100)
  const ecart = piece - recuCentimes
  if (recuCentimes > 0 && recuCentimes < piece && ecart * DIVISEUR_DE_L_ECART <= piece && ecart <= PLAFOND_DE_L_ECART_CENTIMES) return piece
  return recuCentimes
}

/** Le plancher selon l'état de la base (sans valeur par défaut) : baissé, ce que la pièce a reçu, comme hier. */
export function plancherSelon(prevu: boolean, recuCentimes: number, montantTtc: number | null): number {
  return prevu ? plancherDUnePiece(recuCentimes, montantTtc) : recuCentimes
}

/** Les deux refus de `garder_plancher_d_une_piece_citee`, dans l'ordre où elle les dit. */
export const REFUS_DU_MONTANT_DE_LA_PIECE_CITEE = [
  {
    cle: 'montant_plusieurs_taux',
    code: '23514',
    modele: "Cette pièce est l'original d'une facture reprise qui porte plusieurs taux de TVA et dont le registre a déjà reçu des encaissements : à ce montant, ses paiements d'avant la reprise la règlent à l'écart d'alignement près, la 2035 la compte entière, et le registre ne saurait plus sur quels taux elle a porté. Le cabinet retire d'abord ces encaissements, ou garde le montant de la pièce.",
  },
  {
    cle: 'montant_deux_fois',
    code: '23514',
    modele: "Cette pièce est l'original d'une facture reprise dont le registre a déjà reçu des encaissements : à ce montant, ses paiements d'avant la reprise la règlent à l'écart d'alignement près, la 2035 la compte entière, et avec ce registre elle dépasserait ce que la facture porte, nette de ses avoirs : la même vente compterait deux fois. Le cabinet retire d'abord ces encaissements, ou garde le montant de la pièce.",
  },
] as const satisfies readonly RefusDeLaBase[]

export type CleDuRefusDuMontant = (typeof REFUS_DU_MONTANT_DE_LA_PIECE_CITEE)[number]['cle']

/** Ce qu'il faut savoir du montant changé d'une pièce citée pour le juger comme la base. Tous les montants en centimes. */
export interface MontantDeLaPieceCitee {
  /** Ce que la pièce a reçu de son dossier, à la fin du geste (jamais négatif). */
  recuCentimes: number
  ancienMontantTtc: number | null
  nouveauMontantTtc: number | null
  /** L'encaissé avant la reprise que l'import de la facture déclare. */
  declareCentimes: number
  /** Ce que le registre de la facture a déjà reçu, net de ses contre-passations. */
  dejaCentimes: number
  /** Le TTC de la facture, net de ses avoirs (de l'application et repris), comme la base le compte. */
  netCentimes: number
  /** Les taux des montants du document (`montants_par_taux_du_document`). */
  nombreDeTaux: number
}

/**
 * Ce que `garder_plancher_d_une_piece_citee` refuserait de ce montant, la pièce citée par une facture reprise (le lien actif) ;
 * nul quand rien. Le plancher qui ne monte pas, le registre vide, le déclaré qui couvre : rien.
 */
export function refusDuMontantDeLaPieceCitee(m: MontantDeLaPieceCitee): { cle: CleDuRefusDuMontant; message: string } | null {
  const apres = plancherDUnePiece(m.recuCentimes, m.nouveauMontantTtc)
  if (apres <= plancherDUnePiece(m.recuCentimes, m.ancienMontantTtc)) return null
  if (!(apres > m.declareCentimes && m.dejaCentimes !== 0)) return null
  if (m.nombreDeTaux > 1) return { cle: 'montant_plusieurs_taux', message: REFUS_DU_MONTANT_DE_LA_PIECE_CITEE[0].modele }
  if (m.dejaCentimes + apres > m.netCentimes) return { cle: 'montant_deux_fois', message: REFUS_DU_MONTANT_DE_LA_PIECE_CITEE[1].modele }
  return null
}
