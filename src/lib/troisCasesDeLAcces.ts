// LES TROIS CASES DE PLUS D'UN ACCÈS CLIENT (espace client, ligne 51.5, étape B1 ; MEG2-Q1) : « Achats », « Notes de frais »
// et « Documents ». La migration `trois_cases_de_l_acces` (supabase/preparees/20261107140000) est PRÉPARÉE, pas appliquée ;
// elle vient après `trace_des_droits` (P1-trace) et `situations_publiees` (C4a). Le drapeau se lève le jour où son fichier
// entre dans `supabase/schema/` : l'onglet Accès et AuthContext demandent alors les trois colonnes, et l'onglet appelle la
// forme à huit de `changer_droits_acces`. Levé, il suppose `SITUATIONS_PUBLIEES_EXPORTEES` (troisCasesDeLAcces.test.ts).
// Les cases n'ouvrent encore rien : B2, B4 et B7 s'en serviront.
export const TROIS_CASES_EXPORTEES = false
