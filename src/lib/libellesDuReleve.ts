import { libelleExploitable } from './appariementBanque'
import { formatDate } from './format'
import type { LigneEcritureMouvement } from './affectationBanque'
import type { LigneBancaire } from './types'

// LE LIBELLÉ DE L'ÉCRITURE D'UN MOUVEMENT DU RELEVÉ CLASSÉ HORS DES VENTES FACTURÉES (JJ1-Q1, tranchée par le cabinet le
// 07/11/2026 : « la règle de l'assistant, crédits et remboursements composés » ; HISTORIQUE.md, « JJ1-Q1 : LE LIBELLÉ DE LA
// BANQUE HORS DES ÉCRITURES DU RELEVÉ »). Le FEC part chez l'expert-comptable et, sur demande, chez l'administration
// (EcritureLib, LPF art. A47 A-1) ; chez un praticien, le libellé que la banque donne à un crédit (« VIR SEPA RECU DE
// MME … ») nomme un patient, comme celui d'un remboursement, d'un chèque impayé ou d'un virement rejeté (CGI, art. 99 ;
// code pénal, art. 226-13). LA RÈGLE, ÉCRITE ICI SEULEMENT, pour toute écriture qu'un mouvement du relevé reçoit de
// l'application — affecté à une catégorie (à la main ou par une règle et ses lots), ventilé, virement personnel, compte de
// bilan (la caisse comprise : le versement et le retrait d'espèces), échéance de cotisation, d'emprunt, déclaration de TVA :
//   - un CRÉDIT : « Crédit du relevé du JJ/MM/AAAA », jamais le texte de la banque ;
//   - un DÉBIT qui rend ou défait l'argent d'un client — l'une de ses lignes sur un compte de produit (classe 7) ou de client
//     (classe 41), la définition de l'assistant (VF9CQ1B, `debitQuiRendLArgentDUnClient`, supabase/functions/agent-comptable,
//     dont `RACINES_DES_COMPTES_D_UN_CLIENT` est confronté à celle-ci par libellesDuReleve.test.ts) : « Débit du relevé du
//     JJ/MM/AAAA » ;
//   - tout autre débit (un fournisseur, un organisme) garde le libellé de la banque, utile à l'expert-comptable : le libellé
//     complet quand l'import n'a gardé que le générique « Mouvement bancaire » (`libelleExploitable`), comme hier.
// L'écriture d'un mouvement que ses encaissements classent a la sienne (`libelleDUnMouvementDesVentes`,
// lib/libellesDesVentes.ts, JJ1). Ce qui est déjà au brouillon garde son libellé : ni la base ni `ecritureConforme` ne le
// comparent, et rien ne le réécrit (comme FEC22Q7-Q1). Un module PUR : ni la base, ni l'horloge. libellesDuReleve.test.ts
// relève, dans TOUTE la source, les écritures composées : un libellé de la banque lu hors d'ici y est une faute.

/** Les racines des comptes qui disent qu'un débit rend ou défait l'argent d'un client : un produit, un client. Des racines
 *  du plan comptable général, aucun compte de rôle — les mêmes que celles de l'assistant (VF9CQ1B). */
export const RACINES_DES_COMPTES_D_UN_CLIENT: readonly string[] = ['7', '41']

/** Un mouvement du relevé tel que le libellé de son écriture le lit. */
export type MouvementLibelle = Pick<LigneBancaire, 'date' | 'montant' | 'libelle' | 'libelle_brut'>

/** Ce débit, écrit sur ces comptes, rend-il ou défait-il l'argent d'un client ? L'une des lignes sur un produit ou un
 *  client suffit, comme pour l'assistant. */
export function debitQuiRendLArgentDUnClient(comptes: readonly string[]): boolean {
  return comptes.some((c) => RACINES_DES_COMPTES_D_UN_CLIENT.some((r) => c.startsWith(r)))
}

/**
 * Le libellé de chaque ligne de l'écriture d'un mouvement du relevé, selon le sens du mouvement et les COMPTES de
 * l'écriture composée (toutes ses lignes : la banque et la TVA n'y changent rien). Un mouvement de zéro euro n'a rien à
 * écrire ; il se dit crédit, le côté qui ne recopie rien.
 */
export function libelleDeLEcritureDuReleve(mouvement: MouvementLibelle, comptes: readonly string[]): string {
  if (mouvement.montant >= 0) return `Crédit du relevé du ${formatDate(mouvement.date)}`
  if (debitQuiRendLArgentDUnClient(comptes)) return `Débit du relevé du ${formatDate(mouvement.date)}`
  return libelleExploitable(mouvement) || mouvement.libelle
}

/** Les lignes d'une écriture d'un mouvement du relevé, composées sans libellé, chacune avec celui de la règle. */
export function libellerLEcritureDuReleve(
  mouvement: MouvementLibelle,
  lignes: readonly Omit<LigneEcritureMouvement, 'libelle'>[],
): LigneEcritureMouvement[] {
  const libelle = libelleDeLEcritureDuReleve(mouvement, lignes.map((l) => l.compte))
  return lignes.map((l) => ({ ...l, libelle }))
}
