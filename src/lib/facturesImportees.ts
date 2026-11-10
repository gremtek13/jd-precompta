// LES FACTURES REPRISES DE L'ANCIEN LOGICIEL D'UN CLIENT (ligne 51.5, étape A8a ; A8-Q1 à A8-Q6, tranchées par le cabinet à
// la recommandation). La migration `factures_importees` (supabase/schema/20261110143020_factures_importees.sql, collée par
// le cabinet le 10/11/2026) pose un troisième état de `factures_emises` (`importee`), la date de reprise d'un dossier, deux
// tables — `imports_factures`, le lot, et `factures_importees`, une ligne par facture reprise (clé : la facture) —, leurs
// gardes, `importer_factures` et `retirer_import`, le cabinet du dossier seul. Le récit : HISTORIQUE.md, « A8A : LES FACTURES
// REPRISES, EN BASE (PRÉPARÉE, PAS APPLIQUÉE) » et « LE JOUR J DU 10/11/2026 » ; l'essai : supabase/essais/facturesImportees.sql. Les modules s'ouvrent
// nommément avec A8c (lib/facturesReprises.ts), l'écran avec A8d.
//
// LE DRAPEAU : levé le 10/11/2026, les trois migrations — A8a, A9a (`numerotation_continue`) et A8b
// (`factures_reprises_encaissements`), collées ensemble — dans l'export : les deux tables sont au plan de sauvegarde
// (`auPlanAujourdHui`, src/lib/sauvegarde.ts), et les lecteurs ouverts comptent les reprises. Son état d'avant reste éprouvé
// tant que son code existe : sauvegardeFacturesImportees.test.ts joue le plan sous chaque état du drapeau, et les lecteurs
// l'interrogent par lib/facturesReprises.ts, que leurs tests basculent par un accesseur.
export const FACTURES_IMPORTEES_PREVUES: boolean = true
