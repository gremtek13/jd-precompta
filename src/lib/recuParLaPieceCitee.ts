import type { RefusNeuf } from './encaissementsDesReprises'
import { REFUS_CITER, remplir, type RefusDeLaBase } from './pieceDUneFactureReprise'

// CE QUE LA PIÈCE CITÉE D'UNE FACTURE REPRISE A DÉJÀ REÇU, PLANCHER DE SON REGISTRE (ligne 51.5 ; A8Q5Q3-Q2, « Le plus grand
// des deux montants », tranchée par le cabinet le 11/11/2026 à la recommandation ; HISTORIQUE.md, « 13/11/2026 — PC4Q2-Q1,
// A8B-Q3 ET A8Q5Q3-Q2 : TROIS MIGRATIONS PRÉPARÉES »).
//
// Une pièce de vente payée et comptée — en N, par ses paiements, dans la 2035 et la CA3 —, puis citée par une facture reprise
// dont l'import déclare moins d'encaissé avant la reprise : le registre (A8b) partait du déclaré et acceptait d'encaisser de
// nouveau la même somme. La migration PRÉPARÉE `recu_par_la_piece_citee` (supabase/preparees/20261113212000_recu_par_la_piece_citee.sql) :
//   - `recu_par_la_piece` : ce qu'une pièce a reçu, la somme signée de ses paiements (un mouvement rapproché, la part d'un
//     virement groupé, un paiement par la caisse non retiré), jamais négative, en centimes ;
//   - `enregistrer_encaissement` : l'encaissé avant la reprise est le plus grand du déclaré et de ce que la pièce citée a
//     reçu ; d'une facture à plusieurs taux, un reçu qui dépasse le déclaré refuse l'encaissement (un refus neuf, à son rang) ;
//   - `reprise_de_la_facture` : une septième clé, `recu_par_sa_piece_centimes`, que la fenêtre des encaissements lit pour
//     juger avant le clic comme la base (lib/reprisesAuClient.ts, lib/encaissementsFactures.ts) ;
//   - `citer_piece_de_facture_reprise` : deux refus neufs quand le registre a déjà des encaissements.
// Ce module en dit les refus, aux mots de la migration, et le plancher ; recuParLaPieceCitee.test.ts les confronte à son texte.
//
// LE DRAPEAU, BAISSÉ jusqu'à l'application : la lecture de la reprise attend six clés (la fonction d'aujourd'hui), le module
// juge sans le plancher — comme la base d'aujourd'hui —, et aucun refus neuf ne se dit. Levé le jour de l'application, la
// lecture attend sept clés : l'application se déploie aussitôt après la migration (entre les deux, la reprise se lit
// « illisible », et la fenêtre retient l'encaissement — le côté fermé). Il se lit À CHAQUE APPEL : les tests jouent ses deux
// états sur l'objet ci-dessous.
export const DRAPEAU_DE_LA_PIECE_RECUE = {
  /** Vrai le jour où la migration `recu_par_la_piece_citee` est en production et dans l'export. */
  RECU_PAR_LA_PIECE_CITEE_PREVU: false as boolean,
}

/** Le drapeau, lu à l'appel. */
export function recuParLaPieceCiteePrevu(): boolean {
  return DRAPEAU_DE_LA_PIECE_RECUE.RECU_PAR_LA_PIECE_CITEE_PREVU
}

/** La clé que `reprise_de_la_facture` rend en plus, la migration en base. */
export const CLE_DU_RECU = 'recu_par_sa_piece_centimes'

// Le refus neuf d'`enregistrer_encaissement`, juste avant le plafond d'une reprise (après « La répartition (% €) ne fait pas
// le montant encaissé (% €). ») : sans nom de fichier ni montant — le client « Ventes » l'appelle aussi —, et il nomme le
// geste du cabinet, que le client ne fait pas.
export const REFUS_ENCAISSEMENT_DE_LA_PIECE_CITEE = [
  {
    cle: 'reprise_piece_plusieurs_taux',
    modele: "La pièce citée par la facture reprise % a reçu, avant la reprise, plus que l'import n'en déclare encaissé, et la facture porte plusieurs taux de TVA : l'application ne devine pas sur lesquels ce paiement a porté, et la facture ne reçoit pas d'encaissement : le cabinet reprend d'abord son import, en y déclarant, taux par taux, ce que sa pièce a reçu.",
    apres: 'repartition_somme',
  },
] as const satisfies readonly RefusNeuf<string>[]

export type CleRefusDeLaPieceCitee = (typeof REFUS_ENCAISSEMENT_DE_LA_PIECE_CITEE)[number]['cle']

// Les deux refus neufs de `citer_piece_de_facture_reprise`, après « réglée le %, à la date de reprise … » : un geste du
// cabinet seul, qui lit le nom de la pièce et les montants.
export const REFUS_CITER_DE_LA_PIECE_RECUE = [
  {
    cle: 'recue_plusieurs_taux',
    code: '23514',
    modele: "La pièce « % » a reçu, avant la reprise, plus que l'import de la facture reprise % n'en déclare encaissé, et la facture porte plusieurs taux de TVA : son registre, qui a déjà reçu des encaissements, ne saurait plus sur lesquels ce paiement a porté. Retirer d'abord ces encaissements, ou reprendre l'import en y déclarant, taux par taux, ce que la pièce a reçu.",
  },
  {
    cle: 'recue_deja_encaissee',
    code: '23514',
    modele: "La pièce « % » a reçu % € avant la reprise, et le registre de la facture reprise % en a déjà reçu % € : ensemble, ils dépassent ce qu'elle porte (% €, nette de ses avoirs), et la même vente compterait deux fois. Retirer d'abord ces encaissements, ou citer une autre pièce.",
  },
] as const satisfies readonly RefusDeLaBase[]

/** Les refus de `citer_piece_de_facture_reprise` avec la migration, dans l'ordre où la fonction les dit. */
export const REFUS_CITER_AVEC_LA_PIECE_RECUE: readonly RefusDeLaBase[] = [...REFUS_CITER, ...REFUS_CITER_DE_LA_PIECE_RECUE]

/** Les refus de la citation tels que la base les porte, selon l'état (sans valeur par défaut). */
export function refusDeCiterSelon(prevu: boolean): readonly RefusDeLaBase[] {
  return prevu ? REFUS_CITER_AVEC_LA_PIECE_RECUE : REFUS_CITER
}

/**
 * L'encaissé avant la reprise que les plafonds lisent, en centimes : le plus grand du déclaré à l'import et de ce que la pièce
 * citée a reçu — absent (`undefined`), la base d'avant la migration, qui ne le lit pas : le déclaré seul.
 */
export function encaisseAvantLaRepriseCentimes(reprise: { encaisseAvantRepriseCentimes: number; recuParSaPieceCentimes?: number }): number {
  return Math.max(reprise.encaisseAvantRepriseCentimes, reprise.recuParSaPieceCentimes ?? 0)
}

/**
 * Le reçu de la pièce dépasse-t-il le déclaré, sur une facture à plusieurs taux ? Alors l'encaissement se refuse
 * (`reprise_piece_plusieurs_taux`) : ce reçu ne se répartit pas entre les taux sans deviner. `nombreDeTaux` : les taux des
 * montants du document (`montantsParTauxDuDocument`), comme la base les compte.
 */
export function recuARepartirEntreLesTaux(
  reprise: { encaisseAvantRepriseCentimes: number; recuParSaPieceCentimes?: number },
  nombreDeTaux: number,
): boolean {
  return (reprise.recuParSaPieceCentimes ?? 0) > reprise.encaisseAvantRepriseCentimes && nombreDeTaux > 1
}

/**
 * Ce que `citer_piece_de_facture_reprise` refuserait de plus, la migration en base, avant le lien : nul quand rien. Tous les
 * montants en centimes ; `nombreDeTaux` comme ci-dessus ; `netCentimes` : le TTC de la facture net de ses avoirs (de
 * l'application et repris), comme la fonction le compte. Le cabinet seul cite : ses mots portent le nom de la pièce.
 */
export function refusDeLaCitationPourLaPieceRecue(c: {
  nomFichier: string
  numero: string
  recuCentimes: number
  declareCentimes: number
  dejaCentimes: number
  netCentimes: number
  nombreDeTaux: number
}): { cle: (typeof REFUS_CITER_DE_LA_PIECE_RECUE)[number]['cle']; message: string } | null {
  if (!(c.recuCentimes > c.declareCentimes && c.dejaCentimes !== 0)) return null
  if (c.nombreDeTaux > 1) {
    return { cle: 'recue_plusieurs_taux', message: remplir(REFUS_CITER_DE_LA_PIECE_RECUE[0].modele, c.nomFichier, c.numero) }
  }
  if (c.dejaCentimes + c.recuCentimes > c.netCentimes) {
    return {
      cle: 'recue_deja_encaissee',
      message: remplir(REFUS_CITER_DE_LA_PIECE_RECUE[1].modele, c.nomFichier, euros(c.recuCentimes), c.numero, euros(c.dejaCentimes),
        euros(c.netCentimes)),
    }
  }
  return null
}

// `replace(to_char(x, 'FM999999999990.00'), '.', ',')`, d'un nombre de centimes positif ou nul.
function euros(centimes: number): string {
  const a = Math.abs(centimes)
  return `${centimes < 0 ? '-' : ''}${Math.floor(a / 100)},${String(a % 100).padStart(2, '0')}`
}
