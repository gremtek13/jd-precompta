// LA TRACE DES DROITS D'UN ACCÈS CLIENT (espace client, étape P1-trace ; décision du cabinet du 18/10/2026 : garder qui a coché
// ou décoché les droits d'un accès, et quand). La migration `trace_des_droits` (supabase/preparees/, PRÉPARÉE, pas appliquée)
// pose la table `trace_des_droits` — une ligne par case qui change : le dossier, l'accès et son compte, le droit, la case après
// le geste, le geste (« changement », « creation », « retrait »), l'auteur (nul sans session) et l'instant —, écrite par un
// déclencheur sur `memberships` pour que tout chemin soit pris, immuable, lue par le cabinet du dossier seul. Le récit :
// HISTORIQUE.md, « LA TRACE DES DROITS D'UN ACCÈS, EN BASE (P1-TRACE) (PRÉPARÉE, PAS APPLIQUÉE) » ; les essais :
// supabase/essais/traceDesDroits.sql et, sur une réplique seulement, traceDesDroitsSuppression.sql. L'écran qui la montrera
// viendra dans un lot à part.
//
// LE DRAPEAU : baissé tant que la migration n'est pas dans l'export (traceDesDroits.test.ts le lie au fichier). Le jour de son
// application, il se lève, et la table entre au plan de sauvegarde (`auPlanAujourdHui`, src/lib/sauvegarde.ts) : avant, la lire
// ferait échouer toute sauvegarde.
export const TRACE_DES_DROITS_PREVUE = false
