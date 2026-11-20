-- RETOUR ARRIÈRE DE `paiements_assurance_maladie` (conception 53, NOE3) — DESTRUCTIF, À ACCORDER PAR LE CABINET, À COLLER
-- dans l'éditeur SQL de Supabase, dans une transaction, avec sa ligne d'historique (le texte retire deux tables, leur garde
-- et quatre fonctions). La migration : supabase/schema/20261120110000_paiements_assurance_maladie.sql (préparée le
-- 16/11/2026, sous une version provisoire, amendée le 19/11/2026 avant tout collage : l'organisme complémentaire, BOR3) ; le
-- récit : HISTORIQUE.md, « 16/11/2026 — NOE1 ET NOE3 : LA LECTURE DES PAIEMENTS DE L'ASSURANCE MALADIE ET LEUR TABLE (PRÉPARÉE,
-- PAS APPLIQUÉE) » et « 19/11/2026 — BOR3 ». Les empreintes ci-dessous sont celles des corps amendés.
--
-- L'ORDRE : D'ABORD l'application, son drapeau baissé (`PAIEMENTS_ASSURANCE_MALADIE_PREVUS`, le fichier de la migration sorti
-- de l'export) et remise en ligne — levé, une sauvegarde lirait les tables —, PUIS ce texte.
--
-- CE QU'IL REND : la base d'avant la migration ; aucune fonction d'hier n'a été remplacée.
--
-- CE QU'IL RETIRE — ce qu'il DÉTRUIRAIT : les tables `imports_assurance_maladie` et `paiements_assurance_maladie` et ce
-- qu'elles portent (les paiements agrégés importés, leurs imports, leurs rejets comptés), leurs policies (la restrictive
-- `deux_facteurs` comprise, si la double authentification est en base), leur garde et ses déclencheurs ;
-- `importer_paiements_assurance_maladie`, `retirer_import_assurance_maladie`, `refus_de_l_import_assurance_maladie`,
-- `garder_paiements_assurance_maladie`. Il SE REFUSE tant qu'une des tables porte une ligne : la perdre est une décision du
-- cabinet, qui l'exporterait d'abord (une sauvegarde du dossier, le drapeau encore levé). Plus tard, une table qui les cite
-- (l'association à un crédit du relevé, NOE5) se retire AVANT ce texte, par son propre retour.
--
-- Ni barre oblique inverse, ni retour chariot. Après lui : la signature d'avant la migration (`signature.sql`), l'essai
-- `paiementsAssuranceMaladie.sql` EN ATTENTE, le bloc AM de `rls.sql` EN ATTENTE (et la section P7 sans les tables), et les
-- trois contrôles de l'export.

-- ══ 0. La garde ══════════
do $garde$
declare
  v_lignes bigint;
begin
  if to_regclass('public.imports_assurance_maladie') is null or to_regclass('public.paiements_assurance_maladie') is null then
    raise exception 'La migration paiements_assurance_maladie n''est pas en base (ou ce retour est déjà fait) : rien à défaire.';
  end if;
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.importer_paiements_assurance_maladie(uuid,jsonb)'))
       is distinct from '62b9f0f603ece252446552d81c39d24b'
     or (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.retirer_import_assurance_maladie(uuid)'))
       is distinct from '758c59154be4c08f680119c7cd0c1e4c'
     or (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.refus_de_l_import_assurance_maladie(jsonb,date)'))
       is distinct from '690d81f6c0e1c08c5149466068f21370'
     or (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.garder_paiements_assurance_maladie()'))
       is distinct from '97548e624b2380eab867a53f3f850189' then
    raise exception 'Les fonctions des paiements de l''assurance maladie ne sont plus celles que la migration a posées : relire la base avant ce retour.';
  end if;
  select (select count(*) from public.imports_assurance_maladie) + (select count(*) from public.paiements_assurance_maladie) into v_lignes;
  if v_lignes > 0 then
    raise exception 'Les tables des paiements de l''assurance maladie portent % ligne(s) : ce retour les détruirait. Le cabinet décide d''abord de leur sort (une sauvegarde du dossier), puis un retour qui les retire en connaissance de cause.', v_lignes;
  end if;
end
$garde$;

-- ══ 1. Les deux fonctions qui rendent une ligne d'une table, les tables (leurs policies, leurs déclencheurs, leurs index
-- partent avec elles ; les paiements d'abord, qui citent leur import), puis la fonction de leur garde et celle du refus ══════════
drop function public.importer_paiements_assurance_maladie(uuid, jsonb);
drop function public.retirer_import_assurance_maladie(uuid);
drop table public.paiements_assurance_maladie;
drop table public.imports_assurance_maladie;
drop function public.garder_paiements_assurance_maladie();
drop function public.refus_de_l_import_assurance_maladie(jsonb, date);
