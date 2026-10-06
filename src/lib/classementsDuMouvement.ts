import { libelleCompteTenu, libelleDuPlanComptable } from './comptes'
import type { LigneBancaire } from './types'

// UN MOUVEMENT DU RELEVÉ N'EST CLASSÉ QU'UNE FOIS, et la base le tient : `lignes_bancaires_un_seul_rapprochement`
// n'admet qu'un lien — une pièce, une cotisation, une catégorie, un emprunt, un compte de bilan, une ventilation ou
// un règlement groupé. Chaque classement dit AVANT le clic que le mouvement en porte déjà un autre.
//
// LE COMPTE DE BILAN (ligne 26.7, lib/compteDeBilan.ts) est le seul que les fonctions SQL des autres classements ne
// refusent pas nommément : elles rencontrent la contrainte, et leur refus serait celui de Postgres — le nom d'une
// contrainte, que personne ne sait lire. La phrase vit ICI, dans un module qui ne dépend que des numéros de comptes :
// lib/compteDeBilan.ts dépend de lib/affectationBanque.ts, qui en a besoin, et une dépendance circulaire ne
// tiendrait qu'à l'ordre dans lequel les modules s'évaluent.
export function refusEcritSurUnCompteDeBilan(ligne: Pick<LigneBancaire, 'compte_bilan'>): string | null {
  if (!ligne.compte_bilan) return null
  const libelle = libelleCompteTenu(ligne.compte_bilan) ?? libelleDuPlanComptable(ligne.compte_bilan)
  return `Ce mouvement est écrit sur le compte ${ligne.compte_bilan}${libelle ? ` (${libelle})` : ''} : annule d’abord ce classement.`
}
