-- OPT6 — LA FRONTIÈRE DE LA TENUE, EN BASE (conception 56, § 3.2 et § 5 ; OPT-Q1 (A) et OPT-Q4 (A), tranchées à la
-- recommandation le 17/11/2026). PRÉPARÉE le 26/11/2026, PAS APPLIQUÉE. Le récit : HISTORIQUE.md, « 26/11/2026 — OPT6 : LA
-- FRONTIÈRE DE LA TENUE, EN BASE (PRÉPARÉE, PAS APPLIQUÉE) » ; l'essai : supabase/essais/frontiereDeLaTenue.sql (EN ATTENTE
-- sans elle) ; le retour : supabase/preparees/retour/20261126120100_retour_frontiere_de_la_tenue.sql ; le module qui redit son
-- refus : src/lib/modulesDuCabinet.ts (`REFUS_DE_LA_TENUE`, `FRONTIERE_DE_LA_TENUE_PREVUE`, baissé jusqu'à l'application).
--
-- SOURCES. Ordonnance n° 45-2138 du 19/09/1945, art. 2 (Légifrance) : tenir, arrêter, redresser les comptabilités est réservé
-- à l'expert-comptable ; un cabinet non inscrit en reste à la précomptabilité (CLAUDE.md, « Objectif et périmètre »).
-- PostgreSQL 17 : CREATE TRIGGER (un déclencheur AFTER … FOR EACH ROW qui lève annule l'instruction, et avec elle la
-- fonction qui l'a lancée ; la clause WHEN) ; « Overview of Trigger Behavior » et l'exécuteur (nodeModifyTable.c, ExecInsert :
-- les expressions WITH CHECK des policies se jugent APRÈS les déclencheurs BEFORE ROW et AVANT les déclencheurs AFTER ROW).
--
-- CE QU'ELLE FAIT. Un cabinet sans le module « Tenue et déclarations » (`options_des_cabinets`, OPT1 : une ligne absente est
-- un module fermé) ne franchit pas, en base, la frontière de la tenue (OPT-Q4 (A)) : la validation d'un exercice
-- (`exercices_valides`), la publication d'une situation (`situations_publiees`, le geste `publication` ; le RETRAIT reste
-- permis : il ôte au client ce qu'il ne doit plus lire), l'écriture libre (`ecritures_libres`, l'insertion et la modification
-- qui pose une nouvelle version ; la contre-passation est une insertion). Le refus : P0001, les mots de `REFUS_DE_LA_TENUE`.
-- Le super-administrateur passe (la restauration). Aucune lecture n'est refusée (§ 3.2, étage 4 : « un resserrement vient
-- en dernier ») ; aucune fonction n'est remplacée (`valider_exercice` l'est déjà par cinq chantiers préparés) ; aucune
-- donnée n'est écrite.
--
-- POURQUOI DES DÉCLENCHEURS AFTER, ET NON BEFORE comme la conception le disait. Un BEFORE `security definer` est une garde
-- qui lit la base avant la RLS : il demanderait la porte `_acces_avant_les_gardes` sur `exercices_valides` et
-- `situations_publiees` (l'étape 32 d'accesAvantLesGardes.sql), et la préparée d'INAL5 (`depart_du_client`), qui l'y pose
-- elle-même, refuserait alors de s'appliquer. Un BEFORE `security invoker` répondrait P0001 à qui la policy refuse en 42501
-- (rls.sql exige 42501) et, sous la RLS, lirait les options avec les droits de l'appelant. Un AFTER ROW tire après le WITH
-- CHECK : la RLS a déjà refusé (42501) qui n'a pas le droit d'écrire, et le refus de la tenue ne parle qu'à un appelant que la
-- policy admet, ou à une fonction `security definer` qui a contrôlé l'accès. Le coût : la ligne est écrite puis défaite par
-- l'annulation de l'instruction ; la validation refusée a fait son travail pour rien, rien ne reste.
--
-- LES DONNÉES D'AVANT. Rien n'est rejugé : un exercice validé, une situation publiée, une écriture libre déjà en base restent
-- tels quels, et se lisent, se comptent et s'exportent (OPT-Q2 (A)). Les cabinets créés depuis le 19/11/2026 n'ont que le
-- socle (OPT-Q3 (B)) : leurs dossiers ne valident plus rien tant que le super-administrateur n'ouvre pas la tenue — c'est
-- l'effet voulu, et l'écran du super-administrateur le dit avant de la fermer.

do $garde$
begin
  if to_regprocedure('public.garder_frontiere_de_la_tenue()') is not null
     or exists (select 1 from pg_catalog.pg_trigger t where t.tgname in ('frontiere_de_la_tenue', 'frontiere_de_la_tenue_a_la_modification') and not t.tgisinternal) then
    raise exception 'OPT6 : la frontière de la tenue est déjà en base : cette migration ne se rejoue pas.';
  end if;
  if to_regclass('public.options_des_cabinets') is null
     or not exists (select 1 from pg_catalog.pg_constraint c
                     where c.conrelid = 'public.options_des_cabinets'::regclass and c.conname = 'options_des_cabinets_module'
                       and pg_catalog.pg_get_constraintdef(c.oid) like '%''tenue''::text%') then
    raise exception 'OPT6 : la table des options (OPT1) ou son module « tenue » manque : relire la base.';
  end if;
  if to_regprocedure('public.is_super_admin()') is null then
    raise exception 'OPT6 : public.is_super_admin() manque : relire la base.';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public'
         and (table_name, column_name) in (('options_des_cabinets', 'cabinet_id'), ('options_des_cabinets', 'module'),
                                           ('options_des_cabinets', 'ouverte'), ('dossiers', 'cabinet_id'),
                                           ('exercices_valides', 'dossier_id'), ('situations_publiees', 'dossier_id'),
                                           ('situations_publiees', 'geste'), ('ecritures_libres', 'dossier_id'),
                                           ('ecritures_libres', 'version'))) <> 9 then
    raise exception 'OPT6 : une colonne que la garde lit manque (options_des_cabinets, dossiers, exercices_valides, situations_publiees, ecritures_libres).';
  end if;
end
$garde$;

create function public.garder_frontiere_de_la_tenue() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- La restauration du super-administrateur réinsère ce que le dossier avait, quelles que soient les options.
  if public.is_super_admin() then
    return null;
  end if;
  -- Retirer une situation publiée ôte au client ce qu'il ne doit plus lire : jamais refusé. (Deux `if` : PL/pgSQL évalue
  -- `new.geste` même derrière un `and` faux, et la ligne des deux autres tables n'a pas ce champ.)
  if tg_table_name = 'situations_publiees' then
    if new.geste = 'retrait' then
      return null;
    end if;
  end if;
  if exists (select 1 from public.dossiers d
               join public.options_des_cabinets o on o.cabinet_id = d.cabinet_id
              where d.id = new.dossier_id and o.module = 'tenue' and o.ouverte) then
    return null;
  end if;
  raise exception 'Le module « Tenue et déclarations » n''est pas ouvert au cabinet de ce dossier : ni validation d''exercice, ni situation publiée, ni écriture libre.'
    using errcode = 'P0001';
end
$$;

comment on function public.garder_frontiere_de_la_tenue() is
  'OPT6 (conception 56, OPT-Q1 (A), OPT-Q4 (A)) : un cabinet sans le module tenue ne valide aucun exercice, ne publie aucune situation (le retrait reste permis) et n''enregistre aucune écriture libre (P0001). Déclencheur AFTER ROW : la RLS a jugé l''appelant avant lui. Le super-administrateur passe (la restauration). Ne lit que options_des_cabinets et dossiers ; n''écrit rien.';

revoke all on function public.garder_frontiere_de_la_tenue() from public, anon, authenticated, service_role;

create trigger frontiere_de_la_tenue after insert on public.exercices_valides
  for each row execute function public.garder_frontiere_de_la_tenue();
create trigger frontiere_de_la_tenue after insert on public.situations_publiees
  for each row execute function public.garder_frontiere_de_la_tenue();
create trigger frontiere_de_la_tenue after insert on public.ecritures_libres
  for each row execute function public.garder_frontiere_de_la_tenue();
-- La modification d'une écriture libre (`enregistrer_ecriture_libre` pose une nouvelle version) ; une mise à jour qui ne
-- change pas la version (le nul qu'écrirait une clé étrangère, par exemple) ne se juge pas.
create trigger frontiere_de_la_tenue_a_la_modification after update on public.ecritures_libres
  for each row when (new.version is distinct from old.version)
  execute function public.garder_frontiere_de_la_tenue();
