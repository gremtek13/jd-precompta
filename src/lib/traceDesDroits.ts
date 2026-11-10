// LA TRACE DES DROITS D'UN ACCÈS CLIENT (espace client, étape P1-trace ; décision du cabinet du 18/10/2026 : garder qui a coché
// ou décoché les droits d'un accès, et quand). La migration `trace_des_droits` (en production depuis le 07/11/2026 :
// supabase/schema/20261107163158_trace_des_droits.sql)
// pose la table `trace_des_droits` — une ligne par case qui change : le dossier, l'accès et son compte, le droit, la case après
// le geste, le geste (« changement », « creation », « retrait »), l'auteur (nul sans session) et l'instant —, écrite par un
// déclencheur sur `memberships` pour que tout chemin soit pris, immuable, lue par le cabinet du dossier seul. Le récit :
// HISTORIQUE.md, « LA TRACE DES DROITS D'UN ACCÈS, EN BASE (P1-TRACE) (PRÉPARÉE, PAS APPLIQUÉE) » ; les essais :
// supabase/essais/traceDesDroits.sql et, sur une réplique seulement, traceDesDroitsSuppression.sql. L'écran qui la montre (10/11/2026) :
// pages/dossier/TraceDesDroitsDesAcces.tsx, les règles dans lib/traceDesDroitsVue.ts.
//
// LE DRAPEAU : levé le 07/11/2026, la migration dans l'export sous la version 20261107163158 (traceDesDroits.test.ts le lie
// au fichier) : la table entre au plan de sauvegarde (`auPlanAujourdHui`, src/lib/sauvegarde.ts). Baissé — l'état d'avant,
// que sauvegardeTraceDesDroits.test.ts joue encore par `vi.doMock` —, elle n'y est pas : la lire avant sa migration aurait
// fait échouer toute sauvegarde.
export const TRACE_DES_DROITS_PREVUE = true
