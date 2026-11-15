import type { RefusDeLaBase } from './pieceDUneFactureReprise'

// UN PAIEMENT D'AVANT LA REPRISE RAPPROCHÉ APRÈS LE REGISTRE (ligne 51.5 ; A8Q5Q3Q2-Q2, « Le refuser dans la garde », tranchée
// par le cabinet le 15/11/2026 à la recommandation ; HISTORIQUE.md, « 15/11/2026 — A8Q5Q3Q2-Q2 : LA GARDE DES RÈGLEMENTS
// JUGE CE QUE LA PIÈCE CITÉE A REÇU »).
//
// La garde des règlements (A8-Q5) refuse un règlement de la pièce citée par une facture reprise daté de la reprise ou d'après ;
// avant, elle le laisse passer — le relevé de décembre importé en janvier. Quand le registre de la facture a déjà reçu des
// encaissements, ce paiement d'avant la reprise, compté par la 2035 de l'année d'avant, recomptait la même vente : la
// citation et le registre le refusaient déjà (A8Q5Q3-Q2, lib/recuParLaPieceCitee.ts), ce troisième chemin non. La migration
// préparée `reglements_de_la_piece_citee` (supabase/preparees/20261115130000_reglements_de_la_piece_citee.sql) pose la
// garde sœur, `garder_recu_d_une_piece_citee`, DIFFÉRÉE jusqu'à la fin de la transaction sur les trois tables d'où ce reçu se
// lit (un mouvement rapproché, la part d'un virement groupé, un paiement par la caisse) : quand un geste fait monter ce que
// la pièce a reçu et que le registre a déjà des encaissements, elle refuse ce que la citation refuserait — à plusieurs taux,
// ou quand le registre et ce reçu dépassent ensemble ce que la facture porte, nette de ses avoirs. Ce qui fait baisser le
// reçu ne se refuse jamais. Ce module en redit les refus, aux mots de la base et dans l'ordre où elle les dit, et le
// jugement, pour qu'un écran les dise avant le clic ; reglementsDeLaPieceCitee.test.ts les confronte au texte de la
// migration et à son essai. Pur : il n'importe jamais `supabase.ts`. Aucun écran ne s'en sert encore, comme le jugement de
// la date de la garde des règlements (lib/pieceDUneFactureReprise.ts) : le rapprochement, le virement groupé et le paiement
// par la caisse ne lisent pas encore le lien d'une pièce à sa facture reprise.
//
// CE QUE LE CLIENT EN LIT : le client « Caisse » règle une pièce par la caisse ; les deux refus ne portent ni nom de fichier,
// ni montant, ni numéro de facture, et disent le geste du cabinet.

// LE DRAPEAU, BAISSÉ jusqu'à l'application de la migration : la base d'aujourd'hui ne refuse rien de tel, et le module ne
// le dit pas. Levé le jour de l'application (le fichier entré dans supabase/schema/, texte inchangé). Il se lit À CHAQUE
// APPEL : les tests jouent ses deux états sur l'objet ci-dessous.
export const DRAPEAU_DES_REGLEMENTS_DE_LA_PIECE_CITEE = {
  /** Faux jusqu'à l'application de `reglements_de_la_piece_citee`, préparée le 15/11/2026. */
  REGLEMENTS_DE_LA_PIECE_CITEE_PREVUS: false as boolean,
}

/** Le drapeau, lu à l'appel. */
export function reglementsDeLaPieceCiteePrevus(): boolean {
  return DRAPEAU_DES_REGLEMENTS_DE_LA_PIECE_CITEE.REGLEMENTS_DE_LA_PIECE_CITEE_PREVUS
}

/** Les deux refus de `garder_recu_d_une_piece_citee`, dans l'ordre où elle les dit. */
export const REFUS_DU_REGLEMENT_DE_LA_PIECE_CITEE = [
  {
    cle: 'reglement_plusieurs_taux',
    code: '23514',
    modele: "Cette pièce est l'original d'une facture reprise qui porte plusieurs taux de TVA et dont le registre a déjà reçu des encaissements : avec ce paiement, elle aurait reçu avant la reprise plus que l'import n'en déclare encaissé, et le registre ne saurait plus sur lesquels il a porté. Le cabinet retire d'abord ces encaissements, ou reprend l'import en y déclarant, taux par taux, ce que la pièce a reçu.",
  },
  {
    cle: 'reglement_deja_encaisse',
    code: '23514',
    modele: "Cette pièce est l'original d'une facture reprise dont le registre a déjà reçu des encaissements : avec ce paiement, ce qu'elle a reçu avant la reprise et ce registre dépasseraient ensemble ce que la facture porte, nette de ses avoirs, et la même vente compterait deux fois. Le cabinet retire d'abord ces encaissements, ou ce paiement ne règle pas cette pièce.",
  },
] as const satisfies readonly RefusDeLaBase[]

export type CleDuRefusDuReglement = (typeof REFUS_DU_REGLEMENT_DE_LA_PIECE_CITEE)[number]['cle']

/** Ce qu'il faut savoir d'un paiement de la pièce citée pour le juger comme la base. Tous les montants en centimes. */
export interface PaiementDeLaPieceCitee {
  /** Le paiement fait-il MONTER ce que la pièce a reçu (sa ligne lui apporte plus après le geste qu'avant) ? */
  hausse: boolean
  /** Ce que la pièce aurait reçu, ce paiement compris (`recu_par_la_piece` : jamais négatif). */
  recuApresCentimes: number
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
 * Ce que `garder_recu_d_une_piece_citee` refuserait de ce paiement, la pièce citée par une facture reprise (le lien actif) ;
 * nul quand rien. Le registre vide, le déclaré qui couvre le reçu, une baisse : rien.
 */
export function refusDuReglementDeLaPieceCitee(p: PaiementDeLaPieceCitee): { cle: CleDuRefusDuReglement; message: string } | null {
  if (!p.hausse) return null
  if (!(p.recuApresCentimes > p.declareCentimes && p.dejaCentimes !== 0)) return null
  if (p.nombreDeTaux > 1) return { cle: 'reglement_plusieurs_taux', message: REFUS_DU_REGLEMENT_DE_LA_PIECE_CITEE[0].modele }
  if (p.dejaCentimes + p.recuApresCentimes > p.netCentimes) {
    return { cle: 'reglement_deja_encaisse', message: REFUS_DU_REGLEMENT_DE_LA_PIECE_CITEE[1].modele }
  }
  return null
}

/** Le refus selon l'état de la base (sans valeur par défaut) : baissé, la base d'aujourd'hui ne refuse rien de tel. */
export function refusDuReglementSelon(prevus: boolean, p: PaiementDeLaPieceCitee): { cle: CleDuRefusDuReglement; message: string } | null {
  return prevus ? refusDuReglementDeLaPieceCitee(p) : null
}
