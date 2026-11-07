-- RETOUR ARRIÈRE DE `trace_des_droits` (P1-trace) — DESTRUCTIF, À ACCORDER PAR LE CABINET, À COLLER dans l'éditeur SQL de
-- Supabase, dans une transaction, avec sa ligne d'historique (le texte retire une table, un déclencheur et deux fonctions).
-- La migration : supabase/schema/20261107163158_trace_des_droits.sql (en production depuis le 07/11/2026) ; le récit : HISTORIQUE.md, « 05/11/2026 — LA TRACE
-- DES DROITS D'UN ACCÈS, EN BASE (P1-TRACE) (PRÉPARÉE, PAS APPLIQUÉE) ».
--
-- L'ORDRE : D'ABORD l'application, son drapeau baissé (`TRACE_DES_DROITS_PREVUE`, le fichier de la migration sorti de
-- l'export) et remise en ligne — levé, une sauvegarde lirait la table —, PUIS ce texte.
--
-- CE QU'IL REND : `memberships` telle qu'hier, ses deux gardes seules ; aucune fonction d'hier n'a été remplacée.
--
-- CE QU'IL RETIRE — ce qu'il DÉTRUIRAIT : la table `trace_des_droits` et ce qu'elle porte (qui a coché ou décoché quelle case,
-- et quand), ses deux policies, sa garde et son déclencheur ; le déclencheur `memberships_trace_des_droits` et
-- `tracer_les_droits`. Il SE REFUSE tant que la trace porte une ligne : la perdre est une décision du cabinet, qui
-- l'exporterait d'abord (une sauvegarde du dossier, le drapeau encore levé). Une sauvegarde prise pendant que la migration
-- était en base porte la table : elle ne se restaure plus sur la base d'après ce retour sans retirer la trace de son contenu.
--
-- Ni barre oblique inverse, ni retour chariot. Après lui : la signature d'avant la migration (`signature.sql`), les essais
-- `traceDesDroits.sql` et `traceDesDroitsSuppression.sql` EN ATTENTE, le contrôle 83 de `droitsAcces.sql` et le bloc TD de
-- `rls.sql` comme hier, et les trois contrôles de l'export, le fichier de la migration sorti de l'export.

-- ══ 0. La garde ══════════
do $garde$
declare
  v_lignes bigint;
begin
  if to_regclass('public.trace_des_droits') is null then
    raise exception 'La migration trace_des_droits n''est pas en base (ou ce retour est déjà fait) : rien à défaire.';
  end if;
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.tracer_les_droits()'))
       is distinct from '0ef7ead57a5829ec8fed54fd7e561371'
     or (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.garder_trace_des_droits()'))
       is distinct from 'a63a4b732282845e7cb30e3ce2dd763d' then
    raise exception 'Les fonctions de la trace des droits ne sont plus celles que la migration a posées : relire la base avant ce retour.';
  end if;
  select count(*) into v_lignes from public.trace_des_droits;
  if v_lignes > 0 then
    raise exception 'La trace des droits porte % ligne(s) : ce retour les détruirait. Le cabinet décide d''abord de leur sort (une sauvegarde du dossier), puis un retour qui les retire en connaissance de cause.', v_lignes;
  end if;
end
$garde$;

-- ══ 1. Le déclencheur des accès, puis la table, puis les fonctions ══════════
drop trigger memberships_trace_des_droits on public.memberships;
drop table public.trace_des_droits;
drop function public.tracer_les_droits();
drop function public.garder_trace_des_droits();
