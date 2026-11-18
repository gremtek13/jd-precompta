-- RETOUR ARRIÈRE DE `previsions_publiees` (C8-Q2) — DESTRUCTIF, À ACCORDER PAR LE CABINET, À COLLER dans l'éditeur SQL de
-- Supabase, dans une transaction, avec sa ligne d'historique (le texte retire une table, sa garde et quatre fonctions). La
-- migration : supabase/preparees/20261115100000_previsions_publiees.sql (préparée le 15/11/2026, sous une version
-- provisoire) ; le récit : HISTORIQUE.md, « 15/11/2026 — C8-Q2 : LA PRÉVISION DE TRÉSORERIE PUBLIÉE AU CLIENT ».
--
-- L'ORDRE : D'ABORD l'application, son drapeau baissé (`PREVISIONS_PUBLIEES_PREVUES`, le fichier de la migration sorti de
-- l'export) et remise en ligne — levé, une sauvegarde lirait la table, et l'onglet Financement publierait —, PUIS ce texte.
--
-- CE QU'IL REND : la base d'avant la migration ; aucune fonction d'hier n'a été remplacée. Sa garde exige les corps de la
-- migration telle que corrigée le 18/11/2026 (le raccord, C8Q2-Q3 : `refus_de_la_prevision` en `7f891e25…`).
--
-- CE QU'IL RETIRE — ce qu'il DÉTRUIRAIT : la table `previsions_publiees` et ce qu'elle porte (chaque prévision publiée au
-- client « Banque », ses remplacements et ses retraits), ses policies (la restrictive `deux_facteurs` comprise, si la double
-- authentification est en base), sa garde et son déclencheur ; `publier_prevision`, `retirer_prevision`,
-- `prevision_publiee_en_cours`, `refus_de_la_prevision`. Il SE REFUSE tant que la table porte une ligne : la perdre est une
-- décision du cabinet, qui l'exporterait d'abord (une sauvegarde du dossier, le drapeau encore levé). Une sauvegarde prise
-- pendant que la migration était en base porte la table : elle ne se restaure plus sur la base d'après ce retour sans en
-- retirer la table.
--
-- Ni barre oblique inverse, ni retour chariot. Après lui : la signature d'avant la migration (`signature.sql`), l'essai
-- `previsionsPubliees.sql` EN ATTENTE, le bloc PP de `rls.sql` EN ATTENTE (et la section P7 sans la table), et les trois
-- contrôles de l'export.

-- ══ 0. La garde ══════════
do $garde$
declare
  v_lignes bigint;
begin
  if to_regclass('public.previsions_publiees') is null then
    raise exception 'La migration previsions_publiees n''est pas en base (ou ce retour est déjà fait) : rien à défaire.';
  end if;
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.publier_prevision(uuid,jsonb,uuid)'))
       is distinct from '265b40b1e8beb6f0643390bb48ac7c1d'
     or (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.retirer_prevision(uuid)'))
       is distinct from 'b9de708f7a5d072b91e4257df2f31a13'
     or (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.prevision_publiee_en_cours(uuid)'))
       is distinct from '04498c75008f1446d4ffb92eb064c646'
     or (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.refus_de_la_prevision(jsonb,date)'))
       is distinct from '7f891e256e383cd36297ae2177e8cb92'
     or (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.garder_prevision_publiee()'))
       is distinct from '470150e2aa56475f16bd4c7fede22a41' then
    raise exception 'Les fonctions de la prévision publiée ne sont plus celles que la migration a posées : relire la base avant ce retour.';
  end if;
  select count(*) into v_lignes from public.previsions_publiees;
  if v_lignes > 0 then
    raise exception 'La table previsions_publiees porte % ligne(s) : ce retour les détruirait. Le cabinet décide d''abord de leur sort (une sauvegarde du dossier), puis un retour qui les retire en connaissance de cause.', v_lignes;
  end if;
end
$garde$;

-- ══ 1. Les deux fonctions qui rendent une ligne de la table, la table (ses policies, sa garde, son index partent avec
-- elle), puis les fonctions que ses policies et sa garde appelaient ══════════
drop function public.publier_prevision(uuid, jsonb, uuid);
drop function public.retirer_prevision(uuid);
drop table public.previsions_publiees;
drop function public.prevision_publiee_en_cours(uuid);
drop function public.refus_de_la_prevision(jsonb, date);
drop function public.garder_prevision_publiee();
