// LES FACTURES REPRISES DE L'ANCIEN LOGICIEL D'UN CLIENT (ligne 51.5, étape A8a ; A8-Q1 à A8-Q6, tranchées par le cabinet à
// la recommandation). La migration `factures_importees` (supabase/preparees/20261107210000_factures_importees.sql, PRÉPARÉE,
// pas appliquée, à COLLER) pose un troisième état de `factures_emises` (`importee`), la date de reprise d'un dossier, deux
// tables — `imports_factures`, le lot, et `factures_importees`, une ligne par facture reprise (clé : la facture) —, leurs
// gardes, `importer_factures` et `retirer_import`, le cabinet du dossier seul. Le récit : HISTORIQUE.md, « A8A : LES FACTURES
// REPRISES, EN BASE (PRÉPARÉE, PAS APPLIQUÉE) » ; l'essai : supabase/essais/facturesImportees.sql. Rien ne s'en lit encore
// (les lecteurs testent l'état par égalité à « validee ») : les modules s'ouvrent nommément avec A8c, l'écran avec A8d.
//
// LE DRAPEAU : baissé tant que la migration n'est pas dans l'export. Le jour de son application, il se lève, et les deux
// tables entrent au plan de sauvegarde (`auPlanAujourdHui`, src/lib/sauvegarde.ts) : avant, les lire ferait échouer toute
// sauvegarde. sauvegardeFacturesImportees.test.ts éprouve le plan prévu et le plan du jour, sous chaque état du drapeau.
export const FACTURES_IMPORTEES_PREVUES = false
