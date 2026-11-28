// LES HONORAIRES DU DOSSIER DU CABINET À LA RESTAURATION (ligne 47, LM7 et LM8 ; HR-Q1, relecture adverse du 28/11/2026).
// Module PUR (aucun appel). Le récit : HISTORIQUE.md, « 28/11/2026 — LA RELECTURE ADVERSE DES HONORAIRES DU CABINET ».
//
// Une sauvegarde est par dossier, et la désignation du dossier du cabinet (`cabinets.dossier_du_cabinet`, LM1) n'en est
// d'aucune : un dossier du cabinet restauré revient sans elle (src/lib/sauvegarde.ts). Or les gardes de `honoraires_factures`
// et de `honoraires_deposes`, en production depuis le 12/11/2026, exigent pour tout auteur, la restauration comprise, que le
// dossier de la ligne SOIT le dossier désigné : la restauration du dossier du cabinet s'arrêtait à son premier lien
// d'honoraires (23514), après avoir écrit le dossier, ses lettres et ses factures. La migration préparée
// `honoraires_restaures_avant_la_designation` (supabase/preparees/20261128100000_…) ouvre cette porte au seul
// super-administrateur, comme LM3 pour la fiche liée ; d'ici à son collage, la restauration REFUSE de commencer une
// sauvegarde qui porte des liens ou des dépôts d'honoraires, rien d'écrit, plutôt que de s'arrêter à eux
// (PLAN_DE_REPRISE.md, § 5 : elle « refuse tout ce qu'elle ne peut pas faire honnêtement »).
//
// Le drapeau se lève dans le commit qui suit le collage de la migration et son export (supabase/schema/).

/** La migration `honoraires_restaures_avant_la_designation` est en production. BAISSÉ : préparée, pas appliquée. */
export const HONORAIRES_RESTAURES_AVANT_LA_DESIGNATION_PREVUS: boolean = false

/** Les tables dont la garde exige la désignation du dossier du cabinet tant que la migration n'est pas en base. */
export const TABLES_GARDEES_PAR_LA_DESIGNATION: readonly string[] = ['honoraires_factures', 'honoraires_deposes']

/**
 * Le refus d'une restauration, avant la première écriture : une ligne par table d'honoraires que la sauvegarde porte et que
 * la base refuserait de réinsérer dans un dossier qu'elle ne désigne pas encore. Vide quand la migration est en base, ou
 * quand la sauvegarde n'en porte aucune.
 */
export function refusDesHonorairesALaRestauration(
  contenu: Readonly<Record<string, readonly unknown[] | undefined>>, migrationEnBase: boolean,
): string[] {
  if (migrationEnBase) return []
  return TABLES_GARDEES_PAR_LA_DESIGNATION.flatMap((table) => {
    const n = contenu[table]?.length ?? 0
    if (n === 0) return []
    return [`La sauvegarde porte ${n} ligne(s) de « ${table} » : c'est celle d'un dossier du cabinet, et la base ne réinsère `
      + 'ses honoraires que dans le dossier qu\'elle désigne, ce qu\'un dossier restauré n\'est pas encore. La restauration '
      + 's\'arrêterait à elles, le dossier à moitié écrit : elle attend la migration honoraires_restaures_avant_la_designation.']
  })
}
