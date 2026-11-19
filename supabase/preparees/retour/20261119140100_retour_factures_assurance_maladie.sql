-- RETOUR ARRIÈRE DE `factures_assurance_maladie` (conception 59, BOR3) — DESTRUCTIF, À ACCORDER PAR LE CABINET, À COLLER dans
-- l'éditeur SQL de Supabase, dans une transaction, avec sa ligne d'historique (le texte retire quatre tables, leur garde et
-- quatre fonctions). La migration : supabase/preparees/20261119140000_factures_assurance_maladie.sql (préparée le 19/11/2026,
-- sous une version provisoire) ; le récit : HISTORIQUE.md, « 19/11/2026 — BOR3 : LE FACTURÉ À L'ASSURANCE MALADIE, EN BASE
-- (PRÉPARÉE, PAS APPLIQUÉE) ».
--
-- L'ORDRE : D'ABORD l'application, son drapeau baissé (`FACTURES_ASSURANCE_MALADIE_PREVUES`, le fichier de la migration sorti
-- de l'export) et remise en ligne — levé, une sauvegarde lirait les tables —, PUIS ce texte.
--
-- CE QU'IL REND : la base d'avant la migration ; aucune fonction d'hier n'a été remplacée.
--
-- CE QU'IL RETIRE — ce qu'il DÉTRUIRAIT : les tables `imports_factures_assurance_maladie`, `factures_assurance_maladie`,
-- `lots_teletransmission_importes` et `cles_des_lots_teletransmission` et ce qu'elles portent (le facturé agrégé importé, ses
-- imports, le registre des empreintes des lots, la clé de chaque dossier — sans elle, les empreintes ne se recalculent plus),
-- leurs policies (la restrictive `deux_facteurs` comprise, si la double authentification est en base), leur garde et ses
-- déclencheurs ; `importer_factures_assurance_maladie`, `retirer_import_factures_assurance_maladie`,
-- `refus_de_l_import_des_factures_assurance_maladie`, `garder_factures_assurance_maladie`. Il SE REFUSE tant qu'une des tables
-- porte une ligne : la perdre est une décision du cabinet, qui exporterait d'abord le facturé (une sauvegarde du dossier, le
-- drapeau encore levé — elle ne porte ni le registre ni la clé : après lui, les bordereaux se réimportent).
--
-- Ni barre oblique inverse, ni retour chariot. Après lui : la signature d'avant la migration (`signature.sql`), les essais
-- `facturesAssuranceMaladie.sql` et `facturesAssuranceMaladieSuppression.sql` EN ATTENTE, le bloc FM de `rls.sql` EN ATTENTE
-- (et la section P7 sans les tables), et les trois contrôles de l'export.

-- ══ 0. La garde ══════════
do $garde$
declare
  v_lignes bigint;
begin
  if to_regclass('public.imports_factures_assurance_maladie') is null or to_regclass('public.factures_assurance_maladie') is null
     or to_regclass('public.lots_teletransmission_importes') is null or to_regclass('public.cles_des_lots_teletransmission') is null then
    raise exception 'La migration factures_assurance_maladie n''est pas en base (ou ce retour est déjà fait) : rien à défaire.';
  end if;
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.importer_factures_assurance_maladie(uuid,jsonb)'))
       is distinct from '7a4d62773ec7914e7cc9259b3de82db2'
     or (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.retirer_import_factures_assurance_maladie(uuid)'))
       is distinct from '16cd14b2434f804c7044af585ce7c286'
     or (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.refus_de_l_import_des_factures_assurance_maladie(jsonb,date)'))
       is distinct from 'c8094aa357fa455e1b224a80fa501eba'
     or (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.garder_factures_assurance_maladie()'))
       is distinct from '6e9c549411efffe3768cfcf398f8d4c2' then
    raise exception 'Les fonctions du facturé à l''assurance maladie ne sont plus celles que la migration a posées : relire la base avant ce retour.';
  end if;
  select (select count(*) from public.imports_factures_assurance_maladie) + (select count(*) from public.factures_assurance_maladie)
       + (select count(*) from public.lots_teletransmission_importes) + (select count(*) from public.cles_des_lots_teletransmission)
    into v_lignes;
  if v_lignes > 0 then
    raise exception 'Les tables du facturé à l''assurance maladie portent % ligne(s) : ce retour les détruirait. Le cabinet décide d''abord de leur sort (une sauvegarde du dossier), puis un retour qui les retire en connaissance de cause.', v_lignes;
  end if;
end
$garde$;

-- ══ 1. Les deux fonctions qui rendent une ligne d'une table, les tables (leurs policies, leurs déclencheurs, leurs index
-- partent avec elles ; les totaux et le registre d'abord, qui citent leur import), puis la fonction de leur garde et celle du
-- refus ══════════
drop function public.importer_factures_assurance_maladie(uuid, jsonb);
drop function public.retirer_import_factures_assurance_maladie(uuid);
drop table public.lots_teletransmission_importes;
drop table public.factures_assurance_maladie;
drop table public.imports_factures_assurance_maladie;
drop table public.cles_des_lots_teletransmission;
drop function public.garder_factures_assurance_maladie();
drop function public.refus_de_l_import_des_factures_assurance_maladie(jsonb, date);
