-- LA SIGNATURE DU SCHÉMA PUBLIC, PAR FAMILLE D'OBJETS — la même requête en production (outil MCP `execute_sql`) et
-- sur une réplique locale (psql), pour dire si la réplique EST la production avant de croire ce qu'on y joue : les
-- suppressions et les verrous que la production ne peut pas jouer (essais des étapes d1 et d4), les mutations d'une
-- migration, la batterie des encaissements (batterieEncaissements.mjs). Neuf lignes de chaque côté — colonnes,
-- contraintes, index, déclencheurs, fonctions (corps, sécurité, volatilité, réglages, résultat, langage), policies, RLS,
-- droits d'exécution des fonctions, droits sur les tables —, comparées une à une : égales, la réplique décrit la
-- production ; une seule diffère, ce qu'on y a joué ne prouve rien de la production.
--
-- Le propriétaire (postgres en production, proprietaire sur la réplique) est retiré des droits comparés, et le droit
-- MAINTAIN des tables, que PostgreSQL 17 ajoute et que la réplique (16) ne connaît pas. Les fins de ligne `\r\n` d'un
-- corps de fonction sont ramenées à `\n` (une migration collée dans l'éditeur SQL de Supabase les y laisse).
--
-- Elle ne MONTE pas la réplique : le procédé, et pourquoi il n'est pas dans le dépôt, dans HISTORIQUE.md, entrée de
-- l'étape d4.
--
-- ÉPROUVÉE LE 08/10/2026 : égale des deux côtés, ligne à ligne, après encaissements_des_factures (étape d1) puis après
-- transmissions_des_encaissements (étape d4).
with
col as (
  select c.relname || '|' || a.attname || '|' || format_type(a.atttypid, a.atttypmod) || '|' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') || '|' || a.attnotnull || '|' || a.attgenerated::text as s
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
  where n.nspname = 'public' and c.relkind = 'r'),
con as (
  select c.relname || '|' || co.conname || '|' || co.contype::text || '|' || pg_get_constraintdef(co.oid) || '|' || co.condeferrable::text || co.condeferred::text as s
  from pg_constraint co join pg_class c on c.oid = co.conrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'),
idx as (
  select pg_get_indexdef(i.indexrelid) as s
  from pg_index i join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'),
trg as (
  select pg_get_triggerdef(t.oid) || '|' || t.tgenabled::text as s
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal),
fct as (
  select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|' || md5(replace(p.prosrc, E'\r\n', E'\n')) || '|' || p.prosecdef || '|' || p.provolatile::text
    || '|' || coalesce(array_to_string(p.proconfig, ','), '') || '|' || pg_get_function_result(p.oid) || '|' || l.lanname || '|' || p.proisstrict as s
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
  where n.nspname = 'public'),
pol as (
  select tablename || '|' || policyname || '|' || permissive || '|' || cmd || '|' || array_to_string(roles, ',') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '') as s
  from pg_policies where schemaname = 'public'),
rls as (
  select c.relname || '|' || c.relrowsecurity || '|' || c.relforcerowsecurity as s
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'),
aclf as (
  select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|' || coalesce((
    select string_agg(x, ',' order by x) from (select case when a.grantee = 0 then 'public' else pg_get_userbyid(a.grantee) end || '=' || a.privilege_type as x
    from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee <> p.proowner) q), '') as s
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'),
aclt as (
  select c.relname || '|' || coalesce((
    select string_agg(x, ',' order by x) from (select case when a.grantee = 0 then 'public' else pg_get_userbyid(a.grantee) end || '=' || a.privilege_type as x
    from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where a.grantee <> c.relowner and a.privilege_type <> 'MAINTAIN') q), '') as s
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r')
select 'colonnes' as famille, count(*) as n, md5(string_agg(s, E'\n' order by s)) as empreinte from col
union all select 'contraintes', count(*), md5(string_agg(s, E'\n' order by s)) from con
union all select 'index', count(*), md5(string_agg(s, E'\n' order by s)) from idx
union all select 'declencheurs', count(*), md5(string_agg(s, E'\n' order by s)) from trg
union all select 'fonctions', count(*), md5(string_agg(s, E'\n' order by s)) from fct
union all select 'policies', count(*), md5(string_agg(s, E'\n' order by s)) from pol
union all select 'rls', count(*), md5(string_agg(s, E'\n' order by s)) from rls
union all select 'droits_fonctions', count(*), md5(string_agg(s, E'\n' order by s)) from aclf
union all select 'droits_tables', count(*), md5(string_agg(s, E'\n' order by s)) from aclt
order by 1;
