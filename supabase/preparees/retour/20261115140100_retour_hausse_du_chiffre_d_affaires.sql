-- RETOUR ARRIÈRE DE `hausse_du_chiffre_d_affaires` (l'alerte de hausse du chiffre d'affaires, MVP) — DESTRUCTIF, À ACCORDER PAR
-- LE CABINET, À COLLER dans l'éditeur SQL de Supabase, dans une transaction, avec sa ligne d'historique (le texte retire deux
-- tables, leurs gardes et deux fonctions). La migration : supabase/preparees/20261115140000_hausse_du_chiffre_d_affaires.sql
-- (préparée le 15/11/2026, sous une version provisoire) ; le récit : HISTORIQUE.md, « 15/11/2026 — L'ALERTE DE HAUSSE DU
-- CHIFFRE D'AFFAIRES ».
--
-- L'ORDRE : D'ABORD l'application, son drapeau baissé (`HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE`, le fichier de la migration sorti
-- de l'export) et remise en ligne — levé, une sauvegarde lirait les tables, et les écrans les liraient —, PUIS ce texte.
--
-- CE QU'IL REND : la base d'avant la migration (la signature de `signature.sql`) ; aucune fonction d'hier n'a été remplacée.
--
-- CE QU'IL RETIRE — ce qu'il DÉTRUIRAIT : les tables `seuils_du_chiffre_d_affaires` (le seuil de chaque dossier, qui l'a réglé
-- et quand) et `hausses_vues_avec_le_client` (chaque trimestre marqué vu avec le client, son auteur et son instant), leurs
-- policies (la restrictive `deux_facteurs` comprise, si la double authentification est en base), leurs gardes et leurs
-- déclencheurs ; `regler_seuil_du_chiffre_d_affaires` et `marquer_hausse_vue_avec_le_client`. Il SE REFUSE tant que l'une des
-- deux tables porte une ligne : la perdre est une décision du cabinet, qui l'exporterait d'abord (une sauvegarde du dossier,
-- le drapeau encore levé). Une sauvegarde prise pendant que la migration était en base porte les tables : elle ne se restaure
-- plus sur la base d'après ce retour sans les en retirer.
--
-- Ni barre oblique inverse, ni retour chariot. Après lui : la signature d'avant la migration, l'essai
-- `hausseDuChiffreDAffaires.sql` EN ATTENTE, et les trois contrôles de l'export.

-- ══ 0. La garde ══════════
do $garde$
begin
  if to_regclass('public.seuils_du_chiffre_d_affaires') is null or to_regclass('public.hausses_vues_avec_le_client') is null then
    raise exception 'La migration hausse_du_chiffre_d_affaires n''est pas en base (ou ce retour est déjà fait) : rien à défaire.';
  end if;
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.regler_seuil_du_chiffre_d_affaires(uuid,integer,integer)'))
       is distinct from 'c2e53b28f9f2e7badf24cf2a6648f60e'
     or (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.marquer_hausse_vue_avec_le_client(uuid,integer,integer)'))
       is distinct from '5f026953ae3a49838aef4cd580c09832'
     or (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.garder_seuil_du_chiffre_d_affaires()'))
       is distinct from 'f9f2a13ee8ad11ccd3de55928a7521ff'
     or (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.garder_hausse_vue_avec_le_client()'))
       is distinct from 'b4c9f0139c865e7be8da33afb7b2251c' then
    raise exception 'Les fonctions de l''alerte de hausse ne sont plus celles de la migration : la relire avant ce retour.';
  end if;
  if exists (select 1 from public.seuils_du_chiffre_d_affaires) or exists (select 1 from public.hausses_vues_avec_le_client) then
    raise exception 'L''alerte de hausse porte des seuils ou des marques : ce retour les détruirait. Les exporter d''abord, et le décider.';
  end if;
end
$garde$;

-- ══ 1. Les fonctions, puis les tables (leurs policies, leurs déclencheurs avec elles), puis les gardes ══════════
drop function public.marquer_hausse_vue_avec_le_client(uuid, integer, integer);
drop function public.regler_seuil_du_chiffre_d_affaires(uuid, integer, integer);
drop table public.hausses_vues_avec_le_client;
drop table public.seuils_du_chiffre_d_affaires;
drop function public.garder_hausse_vue_avec_le_client();
drop function public.garder_seuil_du_chiffre_d_affaires();
