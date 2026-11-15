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

// L'ACCÈS LUI-MÊME DANS LA TRACE (P1T-Q2, tranchée par le cabinet le 07/11/2026 : « Oui, plus tard avec l'écran » ; sa
// migration, le 15/11/2026 : « La coller, le drapeau levé d'abord ») : la migration PRÉPARÉE `arrivee_et_depart_des_acces`
// (supabase/preparees/20261113202000) fait écrire une ligne au mot « acces » quand un accès arrive dans un dossier (cochée,
// « creation ») ou en part (décochée, « retrait »), qu'il porte ou non des cases.
//
// DEUX CONSTANTES, parce que l'écran fait deux choses de ce mot :
//  - `ACCES_DANS_LA_TRACE_PREVU`, LEVÉ le 15/11/2026, AVANT le collage : l'écran LIT le mot (lib/traceDesDroitsVue.ts) —
//    baissé, une ligne « acces » serait un mot inconnu et rendrait la lecture partielle. Sans effet tant que la base ne
//    l'écrit pas : la contrainte `trace_des_droits_droit` de l'export n'admet que les sept cases, aucune ligne ne le porte
//    (traceDesDroitsVue.test.ts le relit dans l'export).
//  - `ARRIVEE_ET_DEPART_DES_ACCES_EXPORTEE`, BAISSÉ jusqu'au collage : la carte « Droits changés » DIT qu'elle trace chaque
//    accès ouvert ou retiré, même sans case — une affirmation sur la base, qui attend la base ; levée avant, elle serait
//    fausse pour tout accès ouvert ou retiré sans case entre le déploiement et le collage. Elle se lève le jour où la
//    migration entre dans l'export (traceDesDroitsVue.test.ts l'y lie), et se baisse AVANT tout retour.
export const ACCES_DANS_LA_TRACE_PREVU: boolean = true

export const ARRIVEE_ET_DEPART_DES_ACCES_EXPORTEE: boolean = false

