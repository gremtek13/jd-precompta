// LE 468 DU DIRIGEANT NON ASSOCIÉ (ligne 43 ; décisions du cabinet 43-Q7, le 17/10/2026, et PC4-Q2, le 11/11/2026). La
// migration `dirigeant_au_468` (en production depuis le 11/11/2026 : supabase/schema/20261111204559_dirigeant_au_468.sql) donne au rôle
// `autres_debiteurs_crediteurs` du catalogue la racine 468 à côté de la 467 (PCG 2026, art. 1214-46) ; son défaut reste 467000.
// Le récit : HISTORIQUE.md, « 11/11/2026 — PC4-Q2 ».
//
// LE DRAPEAU, levé depuis le 11/11/2026 (dirigeantAu468.test.ts le lie au fichier de l'export) ; baissé, son état d'avant,
// rejoué par `racinesDuDirigeantNonAssocieSelon(false)` (planComptable.test.ts) : la copie du
// catalogue dans l'application (`ROLES_COMPTABLES`, src/lib/planComptable.ts) ne porte la racine de plus qu'avec lui — avant,
// la base refuserait un 468 que l'écran du plan aurait dit possible. Lire un plan réglé au 468 ne dépend pas de lui : la base
// n'en rend aucun avant sa migration.
export const DIRIGEANT_AU_468_PREVU = true

/** Les racines du dirigeant non associé (`autres_debiteurs_crediteurs`), selon l'état de la migration. */
export function racinesDuDirigeantNonAssocieSelon(prevu: boolean): readonly string[] {
  return prevu ? ['467', '468'] : ['467']
}
