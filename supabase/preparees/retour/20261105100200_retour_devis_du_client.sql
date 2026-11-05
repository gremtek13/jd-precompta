-- LE RETOUR ARRIÈRE DES DEUX MIGRATIONS DES DEVIS (`devis_du_client` et `devis_du_client_suppression` ; espace client, étape
-- P5) — PRÉPARÉ, À NE COLLER QU'AVEC L'ACCORD EXPLICITE DU CABINET : il DÉTRUIT des données. À coller dans l'éditeur SQL de
-- Supabase, dans une transaction, avec sa ligne d'historique (CLAUDE.md, « Quand `apply_migration` attend une
-- confirmation »). Les migrations : supabase/schema/20261104204904_devis_du_client.sql et
-- 20261105073709_devis_du_client_suppression.sql ; le récit : HISTORIQUE.md, « LES DEVIS, EN BASE ». Retrouvé de la
-- version du 10/10/2026, ajusté le 04/11/2026 aux objets que les migrations réécrites posent.
--
-- L'ORDRE : D'ABORD l'application, `DEVIS_EXPORTES` (src/lib/devis.ts) repassé à `false` et les deux fichiers des
-- migrations sortis de supabase/schema/, remise en ligne — sinon une sauvegarde lirait des tables qui n'existent plus et
-- échouerait —, PUIS ce texte. Le retour SANS rien détruire existe : décocher le droit « Ventes » des accès (onglet Accès)
-- ferme les devis au client ; le cabinet seul les voit encore.
--
-- CE QU'IL DÉTRUIT, sans retour :
--   - TOUS les devis de tous les dossiers (`devis`) : brouillons et devis émis, leurs lignes, leurs montants, leur
--     destinataire et ses mentions, leurs conditions, mentions légales et notes, leur numéro, leur réponse, et qui les a
--     créés, émis, et a enregistré la réponse ;
--   - les liens d'un devis accepté à la facture qui en a été tirée (`devis_factures`) ;
--   - les séries de numéros des devis (`devis_numerotation`) : une nouvelle application repartirait de D<année>-0001, sauf
--     à restaurer les devis émis, d'où la série se reprend.
-- CE QU'IL RETIRE, et qu'une nouvelle application des deux migrations recréerait à l'identique : les six policies des
-- devis et de leurs liens, les deux index des liens, les deux gardes et leurs déclencheurs (`devis_figes`,
-- `devis_factures_gardes`), la porte de la restauration et les quatre fonctions (`enregistrer_devis`, `decider_devis`,
-- `facturer_devis`, `supprimer_brouillon_devis`).
-- CE QU'IL NE TOUCHE PAS : les factures tirées d'un devis — brouillons ou validées, elles restent, et perdent seulement la
-- trace du devis dont elles viennent ; aucune autre table, policy ni fonction.
--
-- Après lui : rls.sql, ventesClient.sql et devis.sql (qui se dit alors impossible) se rejouent, puis les trois contrôles
-- de l'export.
--
-- Ni barre oblique inverse, ni retour chariot. VERSION PROVISOIRE : le fichier prendra la version que portera sa ligne
-- d'historique.

-- ══ 0. La première migration doit être en base ══════════
do $garde$
begin
  if to_regclass('public.devis') is null then
    raise exception 'La migration devis_du_client n''est pas en base : rien à défaire ici.';
  end if;
end
$garde$;

-- ══ 1. Les fonctions qui écrivent (avant les tables : `decider_devis` rend une ligne de `devis`) ══════════
-- La quatrième n'existe que si la seconde migration a été collée.
drop function if exists public.supprimer_brouillon_devis(uuid, uuid);
drop function public.facturer_devis(uuid, uuid);
drop function public.decider_devis(uuid, uuid, text, date, boolean);
drop function public.enregistrer_devis(uuid, uuid, jsonb, jsonb, boolean);
drop function public.emetteur_du_dossier(text, text, text, text);

-- ══ 2. Les tables, leurs données, leurs policies, leurs index et leurs déclencheurs ══════════
drop table public.devis_factures;
drop table public.devis_numerotation;
drop table public.devis;

-- ══ 3. Les gardes et la porte de la restauration ══════════
drop function public.garder_devis_facture();
drop function public.garder_devis();
drop function public.restauration_des_devis(uuid);
