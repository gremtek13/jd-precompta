-- LA RLS JUGE L'APPELANT AVANT LES GARDES (ligne 43 de la feuille de route, vu en passant par PC7Q2-Q1 ; PRÉPARÉE le
-- 13/11/2026, PAS APPLIQUÉE). Le récit : HISTORIQUE.md, « 13/11/2026 — LES GARDES PARLAIENT AVANT LA RLS : UNE PORTE
-- D'ACCÈS DEVANT ELLES » ; l'essai : supabase/essais/accesAvantLesGardes.sql ; le retour :
-- supabase/preparees/retour/20261113120100_retour_acces_avant_les_gardes.sql.
--
-- SOURCES. PostgreSQL 17 : CREATE POLICY (une expression WITH CHECK juge la ligne proposée ; une policy FOR ALL sans WITH
-- CHECK y prend son USING ; les policies permissives s'additionnent, les restrictives s'imposent toutes ; une policy ne
-- vaut que pour ses rôles) ; « Overview of Trigger Behavior » et CREATE TRIGGER (les déclencheurs d'un même genre tirent
-- dans l'ordre alphabétique de leur nom, et un BEFORE … FOR EACH ROW qui lève annule l'instruction) ; « System Information
-- Functions » (`row_security_active` : la RLS est-elle active pour cette table, pour l'utilisateur courant) et « System
-- Catalog Information Functions » (`pg_get_expr`). Le code de l'exécuteur (nodeModifyTable.c, ExecInsert) juge les
-- expressions WITH CHECK APRÈS les déclencheurs BEFORE ROW : vu sur la réplique en PostgreSQL 17 (l'essai, étapes 1 à 9).
--
-- LE DÉFAUT. Une garde BEFORE … FOR EACH ROW tire avant l'expression WITH CHECK de la policy. Écrite `security definer`,
-- elle lit la base au-delà de ce que l'appelant lit ; si elle lève selon ce qu'elle a lu, son refus le dit à un appelant
-- que la policy aurait refusé, l'anonyme compris (la clé publique suffit, et l'anonyme garde INSERT sur les tables de
-- public depuis `droits_hors_rls`). Mesuré sur la réplique : la garde des catégories (PC7) dit à l'anonyme les codes des
-- catégories communes, que la RLS lui cache, et à tout compte, le client du dossier compris, le compte du barème
-- kilométrique du plan d'un dossier dont il a l'identifiant (le message le cite) ; la garde des lignes d'une facture dit le
-- numéro d'une facture validée ; celles des exercices validés, la date où un dossier est figé ; et celles qui prennent le
-- verrou de la validation font attendre l'anonyme pendant une validation en cours. Relevé au catalogue : 32 tables portent
-- une garde `security definer` sur l'insertion ou la mise à jour qui lit la base avant de lever ; `dossiers` aussi, mais
-- ses gardes n'y disent rien qu'à l'administrateur du dossier (voir plus bas).
--
-- CE QU'ELLE FAIT : une porte, `public.acces_avant_les_gardes()`, `security INVOKER`, posée par un déclencheur BEFORE
-- INSERT OR UPDATE FOR EACH ROW nommé `_acces_avant_les_gardes` sur chacune des 32 tables. Son nom commence par un trait
-- bas, qui précède toute lettre : elle tire la première, avant toutes les gardes de la table. Elle :
--   1. ne juge rien hors de la RLS (`row_security_active` faux : le propriétaire, toute fonction `security definer` — qui a
--      contrôlé l'accès elle-même —, le rôle des Edge Functions, la cascade d'une clé, la restauration par le
--      super-utilisateur) : les gardes jugent comme hier ;
--   2. sinon, juge la ligne proposée par LES POLICIES ELLES-MÊMES, lues au catalogue à chaque ligne — celles de la commande
--      (INSERT, ou UPDATE ; FOR ALL comprises), du rôle courant, le WITH CHECK ou à défaut le USING, les permissives en
--      « ou », les restrictives en « et » — évaluées par l'appelant sur la ligne telle qu'elle est proposée : la règle de la
--      policy, sans copie qui dériverait ;
--   3. sans accès, lève le refus de la RLS — 42501, le message même de PostgreSQL — avant qu'aucune garde ait lu quoi que
--      ce soit ; avec accès, laisse passer, et les gardes disent leurs refus à qui la policy admet, comme hier.
-- Laisser passer l'appelant refusé jusqu'à la policy demanderait que CHAQUE garde sache le reconnaître : réécrire
-- cinquante corps, dont ceux que des migrations préparées remplacent déjà en vérifiant leur empreinte (PC7-Q2, PC7Q2-Q1) ;
-- la porte ne touche à aucun, et ces migrations s'appliquent avant ou après elle, dans n'importe quel ordre.
--
-- POURQUOI LA PREMIÈRE PLACE NE TROMPE PAS : la porte juge la ligne avant les autres déclencheurs BEFORE, qui peuvent la
-- modifier ; la policy, elle, juge la ligne finale. Relu au catalogue : sur ces 32 tables, aucun déclencheur ne modifie une
-- colonne que leurs policies d'insertion ou de mise à jour lisent (les modifications : `lignes_bancaires.compte_bancaire_id`,
-- `factures_emises.source_de_la_vente`, `plan_comptable_dossier.origine`) — l'essai le revérifie (étape 30). `dossiers`
-- en est écartée pour cela : `set_cabinet_id_dossier` y remplit `cabinet_id`, que sa policy d'insertion lit ; et ses gardes
-- ne disent rien à un appelant refusé (à l'insertion, aucune ne lit la base ; à la mise à jour, seul l'administrateur du
-- dossier les atteint, et elles ne lisent que son dossier). La porte n'est pas plus large que la policy : la policy
-- SELECT qu'une mise à jour ou un RETURNING ajoute reste jugée par la RLS, après les gardes, comme hier — elle ne
-- concerne qu'un appelant que la policy d'écriture admet déjà.
--
-- CE QU'ELLE NE CHANGE PAS : aucune donnée, aucune policy, aucune garde, aucun déclencheur existant. Pour un appelant que la
-- policy admet, rien ne change. Pour un appelant qu'elle refuse, le refus est celui d'aujourd'hui (42501, « new row
-- violates row-level security policy for table … »), dit avant les gardes au lieu d'après : les écrans qui disent un refus
-- de droit le disent pareil. Le coût : une lecture de `pg_policy` et une évaluation par ligne écrite DANS la RLS (une
-- écriture directe d'un compte connecté) ; rien pour les fonctions `security definer` ni les Edge Functions.
-- Le texte ne porte aucun mot de retrait ni de vidage : par l'outil.

-- La garde de tête : les 32 tables, leur RLS active et non forcée ; aucun déclencheur dont le nom tirerait avant la porte ;
-- `pg_policy` lisible par les rôles de l'API (sinon la porte refuserait tout le monde) ; chaque composition des policies
-- analysable ; et la raison qui écarte `dossiers`.
do $garde$
declare
  c_tables constant text[] := array['a_nouveaux', 'cabinets', 'categories', 'contacts', 'continuite_des_series',
    'cotisations_declarees', 'declarations_tva', 'devis', 'documents_divers', 'ecritures_brouillon', 'encaissements_factures',
    'encaissements_factures_taux', 'facture_lignes', 'factures_emises', 'factures_importees', 'immobilisations',
    'imports_factures', 'lettrages_manuels', 'lignes_bancaires', 'modeles_numerotation', 'operations_caisse',
    'parametres_des_cotisations', 'pieces', 'pieces_des_factures_reprises', 'plan_comptable_cabinet', 'plan_comptable_dossier',
    'reglements_groupes', 'saisies_2035', 'saisies_2035e', 'soldes_reportes', 'vehicules', 'ventilations_bancaires'];
  v_table text;
  v_relid oid;
  v_cmd text;
  v_expr text;
  v_manque text;
  v_chemin constant text := current_setting('search_path');
begin
  -- Le chemin vide de la porte : `pg_get_expr` y qualifie chaque nom, comme la porte le lira.
  perform set_config('search_path', '', true);
  if to_regprocedure('public.acces_avant_les_gardes()') is not null then
    raise exception 'acces_avant_les_gardes : la porte est déjà en base ; cette migration ne se rejoue pas.';
  end if;
  foreach v_table in array c_tables loop
    v_relid := to_regclass('public.' || v_table);
    if v_relid is null then
      raise exception 'acces_avant_les_gardes : la table public.% manque.', v_table;
    end if;
    if not (select c.relrowsecurity and not c.relforcerowsecurity from pg_catalog.pg_class c where c.oid = v_relid) then
      raise exception 'acces_avant_les_gardes : la RLS de public.% n''est pas active, ou elle est forcée au propriétaire : la porte jugerait autrement que la base.', v_table;
    end if;
    select string_agg(t.tgname, ', ') into v_manque from pg_catalog.pg_trigger t
     where t.tgrelid = v_relid and not t.tgisinternal and (t.tgname collate "C") <= ('_acces_avant_les_gardes' collate "C");
    if v_manque is not null then
      raise exception 'acces_avant_les_gardes : sur public.%, le déclencheur % tirerait avant la porte, ou porte son nom.', v_table, v_manque;
    end if;
    -- Chaque composition s'analyse et s'évalue (une ligne nulle, sans rôle filtré) : une policy qui ne se relirait pas
    -- ferait refuser la porte à tous.
    foreach v_cmd in array array['a', 'w'] loop
      select string_agg('(' || coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), pg_catalog.pg_get_expr(p.polqual, p.polrelid)) || ')', ' or ')
        into v_expr
        from pg_catalog.pg_policy p where p.polrelid = v_relid and p.polcmd in ('*', v_cmd);
      if v_expr is not null then
        execute format('select (%s) from (select (null::public.%I).*) as %I', v_expr, v_table, v_table);
      end if;
    end loop;
  end loop;
  perform set_config('search_path', v_chemin, true);
  if not (has_table_privilege('anon', 'pg_catalog.pg_policy', 'select') and has_table_privilege('authenticated', 'pg_catalog.pg_policy', 'select')) then
    raise exception 'acces_avant_les_gardes : pg_policy n''est pas lisible par anon et authenticated : la porte refuserait toute écriture dans la RLS.';
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = 'public.dossiers'::regclass and t.tgname = 'dossiers_set_cabinet_id'
                  and t.tgfoid = 'public.set_cabinet_id_dossier()'::regprocedure) then
    raise exception 'acces_avant_les_gardes : dossiers_set_cabinet_id n''est plus là : la raison qui écarte `dossiers` de la porte est à relire.';
  end if;
end
$garde$;

create function public.acces_avant_les_gardes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fonction$
declare
  v_permissives text;
  v_restrictives text;
  v_admis boolean;
begin
  -- 1. Hors de la RLS (le propriétaire, une fonction security definer, le rôle des Edge Functions, une cascade) : rien à
  --    juger ici ; les gardes jugent comme hier.
  if not pg_catalog.row_security_active(tg_relid) then
    return new;
  end if;
  -- 2. Les policies de la commande et du rôle courant, telles que la RLS les appliquera : le WITH CHECK, ou à défaut le
  --    USING (une policy FOR ALL qui n'en a qu'un) ; les permissives en « ou », les restrictives en « et ».
  select string_agg('(' || coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), pg_catalog.pg_get_expr(p.polqual, p.polrelid)) || ')', ' or ')
           filter (where p.polpermissive),
         string_agg('(' || coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), pg_catalog.pg_get_expr(p.polqual, p.polrelid)) || ')', ' and ')
           filter (where not p.polpermissive)
    into v_permissives, v_restrictives
    from pg_catalog.pg_policy p
   where p.polrelid = tg_relid
     and p.polcmd in ('*', case tg_op when 'INSERT' then 'a' else 'w' end)
     and (0::oid = any (p.polroles)
          or exists (select 1 from unnest(p.polroles) as r(role_id) where pg_catalog.pg_has_role(current_user, r.role_id, 'USAGE')));
  -- 3. Évaluées par l'appelant, sur la ligne proposée : la sous-requête porte le nom de la table et ses colonnes.
  if v_permissives is not null then
    execute pg_catalog.format('select (%s) and (%s) from (select ($1).*) as %I', v_permissives, coalesce(v_restrictives, 'true'), tg_table_name)
      into v_admis using new;
  end if;
  if v_admis is not true then
    raise exception 'new row violates row-level security policy for table "%"', tg_table_name using errcode = '42501';
  end if;
  return new;
end
$fonction$;

revoke all on function public.acces_avant_les_gardes() from public, anon, authenticated;

create trigger _acces_avant_les_gardes before insert or update on public.a_nouveaux for each row execute function public.acces_avant_les_gardes();
create trigger _acces_avant_les_gardes before insert or update on public.cabinets for each row execute function public.acces_avant_les_gardes();
create trigger _acces_avant_les_gardes before insert or update on public.categories for each row execute function public.acces_avant_les_gardes();
create trigger _acces_avant_les_gardes before insert or update on public.contacts for each row execute function public.acces_avant_les_gardes();
create trigger _acces_avant_les_gardes before insert or update on public.continuite_des_series for each row execute function public.acces_avant_les_gardes();
create trigger _acces_avant_les_gardes before insert or update on public.cotisations_declarees for each row execute function public.acces_avant_les_gardes();
create trigger _acces_avant_les_gardes before insert or update on public.declarations_tva for each row execute function public.acces_avant_les_gardes();
create trigger _acces_avant_les_gardes before insert or update on public.devis for each row execute function public.acces_avant_les_gardes();
create trigger _acces_avant_les_gardes before insert or update on public.documents_divers for each row execute function public.acces_avant_les_gardes();
create trigger _acces_avant_les_gardes before insert or update on public.ecritures_brouillon for each row execute function public.acces_avant_les_gardes();
create trigger _acces_avant_les_gardes before insert or update on public.encaissements_factures for each row execute function public.acces_avant_les_gardes();
create trigger _acces_avant_les_gardes before insert or update on public.encaissements_factures_taux for each row execute function public.acces_avant_les_gardes();
create trigger _acces_avant_les_gardes before insert or update on public.facture_lignes for each row execute function public.acces_avant_les_gardes();
create trigger _acces_avant_les_gardes before insert or update on public.factures_emises for each row execute function public.acces_avant_les_gardes();
create trigger _acces_avant_les_gardes before insert or update on public.factures_importees for each row execute function public.acces_avant_les_gardes();
create trigger _acces_avant_les_gardes before insert or update on public.immobilisations for each row execute function public.acces_avant_les_gardes();
create trigger _acces_avant_les_gardes before insert or update on public.imports_factures for each row execute function public.acces_avant_les_gardes();
create trigger _acces_avant_les_gardes before insert or update on public.lettrages_manuels for each row execute function public.acces_avant_les_gardes();
create trigger _acces_avant_les_gardes before insert or update on public.lignes_bancaires for each row execute function public.acces_avant_les_gardes();
create trigger _acces_avant_les_gardes before insert or update on public.modeles_numerotation for each row execute function public.acces_avant_les_gardes();
create trigger _acces_avant_les_gardes before insert or update on public.operations_caisse for each row execute function public.acces_avant_les_gardes();
create trigger _acces_avant_les_gardes before insert or update on public.parametres_des_cotisations for each row execute function public.acces_avant_les_gardes();
create trigger _acces_avant_les_gardes before insert or update on public.pieces for each row execute function public.acces_avant_les_gardes();
create trigger _acces_avant_les_gardes before insert or update on public.pieces_des_factures_reprises for each row execute function public.acces_avant_les_gardes();
create trigger _acces_avant_les_gardes before insert or update on public.plan_comptable_cabinet for each row execute function public.acces_avant_les_gardes();
create trigger _acces_avant_les_gardes before insert or update on public.plan_comptable_dossier for each row execute function public.acces_avant_les_gardes();
create trigger _acces_avant_les_gardes before insert or update on public.reglements_groupes for each row execute function public.acces_avant_les_gardes();
create trigger _acces_avant_les_gardes before insert or update on public.saisies_2035 for each row execute function public.acces_avant_les_gardes();
create trigger _acces_avant_les_gardes before insert or update on public.saisies_2035e for each row execute function public.acces_avant_les_gardes();
create trigger _acces_avant_les_gardes before insert or update on public.soldes_reportes for each row execute function public.acces_avant_les_gardes();
create trigger _acces_avant_les_gardes before insert or update on public.vehicules for each row execute function public.acces_avant_les_gardes();
create trigger _acces_avant_les_gardes before insert or update on public.ventilations_bancaires for each row execute function public.acces_avant_les_gardes();
