// L'ORIGINAL D'UNE FACTURE REPRISE RETENU PAR SON IMPORT (ligne 51.5, A8D2A-Q1 ; décision du cabinet du 11/11/2026, réponse
// (B)). La migration `originaux_retenus_par_leur_import` (supabase/preparees/20261111180000_…, PRÉPARÉE, pas appliquée) :
//   - le seau `ventes` refuse la suppression de l'original d'un import qui existe — le fichier du lot ou celui d'une de ses
//     factures (`original_d_un_import`), au super-administrateur aussi ; « Retirer l'import » (`retirer_import`) retire
//     d'abord les lignes, et l'original redevient un fichier que le chef retire (l'ordre de `retirerLImport`) ;
//   - la suppression d'un dossier reste D'UN SEUL GESTE pour tout chef : le premier passage de `supprimerDossierDefinitivement`
//     laisse les originaux retenus, sans erreur ; la ligne du dossier partie, un déclencheur les a rangés sous le cabinet du
//     dossier (`originaux_liberes`), et le second passage — le même code, déjà là pour INAL1 — les retire, la lecture et la
//     suppression les ouvrant au chef de ce cabinet (`original_libere`) ;
//   - la restauration ne supprime aucun fichier du seau, et une ligne d'import réinsérée retient de nouveau son original.
// Le récit : HISTORIQUE.md, « 11/11/2026 — A8D2A-Q1 ». L'essai : supabase/essais/originalDUnImport.sql (réplique), le bloc
// OR de supabase/essais/rls.sql.
//
// Côté application, rien ne se lit ni ne s'écrit de neuf : la table `originaux_liberes` n'a aucune policy (seules les
// fonctions de la base la lisent). Le drapeau ne porte que sa place au plan de sauvegarde, où elle est une table de niveau
// cabinet (hors de l'export d'un dossier) : baissé, la production n'a pas la table, et le plan ne doit pas la nommer
// (sauvegardeOriginauxLiberes.test.ts). À lever le jour où la migration est collée et passe dans l'export.
export const ORIGINAUX_RETENUS_PREVUS = false

export const TABLES_DES_ORIGINAUX_LIBERES: readonly string[] = ['originaux_liberes']
