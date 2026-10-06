import { libelleCompteTenu, libelleDuPlanComptable } from './comptes'
import type { LigneBancaire } from './types'

// UN MOUVEMENT DU RELEVÉ N'EST CLASSÉ QU'UNE FOIS, et la base le tient : `lignes_bancaires_un_seul_rapprochement`
// n'admet qu'un lien — une pièce, une cotisation, une catégorie, un emprunt, un compte de bilan, une déclaration de
// TVA, une ventilation ou un règlement groupé. Chaque classement dit AVANT le clic que le mouvement en porte déjà un
// autre.
//
// LE COMPTE DE BILAN (ligne 26.7, lib/compteDeBilan.ts) ET LA DÉCLARATION DE TVA (ligne 26.8, lib/liquidationTva.ts)
// sont les deux que les fonctions SQL des autres classements ne refusent pas nommément : elles rencontrent la
// contrainte, et leur refus serait celui de Postgres — le nom d'une contrainte, que personne ne sait lire. Les
// phrases vivent ICI, dans un module qui ne dépend que des numéros de comptes : lib/compteDeBilan.ts dépend de
// lib/affectationBanque.ts, qui en a besoin, et une dépendance circulaire ne tiendrait qu'à l'ordre dans lequel les
// modules s'évaluent.
export function refusEcritSurUnCompteDeBilan(ligne: Pick<LigneBancaire, 'compte_bilan'>): string | null {
  if (!ligne.compte_bilan) return null
  const libelle = libelleCompteTenu(ligne.compte_bilan) ?? libelleDuPlanComptable(ligne.compte_bilan)
  return `Ce mouvement est écrit sur le compte ${ligne.compte_bilan}${libelle ? ` (${libelle})` : ''} : annule d’abord ce classement.`
}

// Un mouvement rapproché d'une déclaration de TVA : un prélèvement qui la paie, ou le virement du Trésor qui rembourse
// le crédit qu'elle a demandé (ligne 26 de la CA3). Son écriture solde le 445510 ou le 445830 face à la banque, et le
// classer autrement laisserait la déclaration impayée — ou son remboursement attendu — sans que rien ne le dise.
export function refusPaieUneDeclarationTva(ligne: Pick<LigneBancaire, 'declaration_tva_id' | 'montant'>): string | null {
  if (!ligne.declaration_tva_id) return null
  return ligne.montant > 0
    ? 'Ce mouvement est le remboursement d’un crédit de TVA : annule d’abord ce rapprochement.'
    : 'Ce mouvement paie une déclaration de TVA : annule d’abord ce rapprochement.'
}
