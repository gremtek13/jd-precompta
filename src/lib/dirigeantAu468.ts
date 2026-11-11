// LE 468 DU DIRIGEANT NON ASSOCIÉ (ligne 43 ; décisions du cabinet 43-Q7, le 17/10/2026, et PC4-Q2, le 11/11/2026). La
// migration `dirigeant_au_468` (PRÉPARÉE, pas appliquée : supabase/preparees/20261111174000_dirigeant_au_468.sql) donne au rôle
// `autres_debiteurs_crediteurs` du catalogue la racine 468 à côté de la 467 (PCG 2026, art. 1214-46) ; son défaut reste 467000.
// Le récit : HISTORIQUE.md, « 11/11/2026 — PC4-Q2 ».
//
// LE DRAPEAU, baissé tant que la migration n'est pas dans l'export (dirigeantAu468.test.ts le lie au fichier) : la copie du
// catalogue dans l'application (`ROLES_COMPTABLES`, src/lib/planComptable.ts) ne porte la racine de plus qu'avec lui — avant,
// la base refuserait un 468 que l'écran du plan aurait dit possible. Lire un plan réglé au 468 ne dépend pas de lui : la base
// n'en rend aucun avant sa migration.
export const DIRIGEANT_AU_468_PREVU = false

/** Les racines du dirigeant non associé (`autres_debiteurs_crediteurs`), selon l'état de la migration. */
export function racinesDuDirigeantNonAssocieSelon(prevu: boolean): readonly string[] {
  return prevu ? ['467', '468'] : ['467']
}
