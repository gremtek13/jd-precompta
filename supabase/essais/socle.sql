-- MOITIÉ « BASE » DU CONTRÔLE DU SOCLE — voir `supabase/essais/socle.py` pour le pourquoi.
--
-- Régénère depuis `pg_catalog` les 69 instructions du socle — les 58 de `1_tables_sans_migration.sql`
-- (les douze tables absentes de l'historique de migrations) et les 11 de
-- `2_objets_sans_migration.sql` (six colonnes et cinq objets ajoutés hors migration à des tables que
-- les migrations créent) — et rend leur empreinte agrégée. Égale à celle des fichiers ⇒ la
-- reconstruction décrit encore la base.
--
-- Rien n'est NORMALISÉ, à une conversion près : le corps de `generate_code_email` est enregistré avec
-- des fins de ligne `\r\n`, que le fichier écrit `\n` (voir son en-tête). Les deux côtés comparent
-- donc des `\n`. Toute autre différence est une dérive — une comparaison indulgente finit par tout
-- accepter.
--
-- À rejouer après TOUTE migration touchant l'une de ces douze tables ou l'un de ces onze objets —
-- c'est le seul moment où le socle peut dériver, et sa dérive ne se voit nulle part ailleurs. Et
-- `inventaire.sql` / `inventaire.py` disent si un objet NOUVEAU a été créé hors migration.
with manquantes(t) as (
  values ('cotisations_declarees'),('documents_divers'),('ecritures_brouillon'),('immobilisations'),
         ('informations_dossier'),('lignes_bancaires'),('natures_immobilisation'),('references_annuelles'),
         ('references_postes_annuels'),('regles_bancaires_ignorees'),('sous_dossiers'),('tiers_categories')
),
-- Les colonnes ajoutées hors migration à des tables que les migrations créent (le complément).
colonnes_ajoutees(ordre, t, c) as (
  values (1, 'categories', 'compte_comptable'), (2, 'categories', 'poste_2035'), (3, 'dossiers', 'assujetti_tva'),
         (4, 'dossiers', 'code_email'), (5, 'pieces', 'sous_dossier_id'), (6, 'pieces', 'storage_hash')
),
cibles as (
  select k.t, c.oid as relid, a.attnum, a.attname, a.atttypid, a.atttypmod, a.attnotnull
  from colonnes_ajoutees k
  join pg_class c on c.relname = k.t and c.relnamespace = 'public'::regnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = k.c and not a.attisdropped
),
cols as (
  select m.t,
         string_agg('  ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
           || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
           || case when a.attnotnull then ' not null' else '' end,
           E',\n' order by a.attnum) as def
  from manquantes m
  join pg_class c on c.relname = m.t and c.relnamespace = 'public'::regnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
  group by m.t
),
cons as (
  select m.t,
         string_agg('  constraint ' || con.conname || ' ' || pg_get_constraintdef(con.oid),
                    E',\n' order by con.contype desc, con.conname) as def
  from manquantes m
  join pg_class c on c.relname = m.t and c.relnamespace = 'public'::regnamespace
  join pg_constraint con on con.conrelid = c.oid
  group by m.t
),
instructions as (
  select 'create table public.' || cols.t || E' (\n' || cols.def
         || coalesce(E',\n' || cons.def, '') || E'\n);' as s
  from cols left join cons on cons.t = cols.t
  union all
  select pg_get_indexdef(i.indexrelid) || ';'
  from manquantes m
  join pg_class c on c.relname = m.t and c.relnamespace = 'public'::regnamespace
  join pg_index i on i.indrelid = c.oid
  where not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid)
  union all
  select 'alter table public.' || m.t || ' enable row level security;'
  from manquantes m
  join pg_class c on c.relname = m.t and c.relnamespace = 'public'::regnamespace
  where c.relrowsecurity
  union all
  select 'create policy "' || p.policyname || '" on public.' || p.tablename
         || E'\n  for ' || lower(p.cmd) || ' to ' || array_to_string(p.roles, ', ')
         || coalesce(E'\n  using (' || p.qual || ')', '')
         || coalesce(E'\n  with check (' || p.with_check || ')', '') || ';'
  from pg_policies p join manquantes m on m.t = p.tablename
  where p.schemaname = 'public'
  -- ── le complément : `2_objets_sans_migration.sql` ──
  union all
  select 'alter table public.' || t || ' add column ' || attname || ' ' || format_type(atttypid, atttypmod)
         || coalesce(' default ' || (select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d
                                      where d.adrelid = relid and d.adnum = attnum), '')
         || case when attnotnull then ' not null' else '' end || ';'
  from cibles
  union all
  select replace(rtrim(pg_get_functiondef('public.generate_code_email()'::regprocedure), E'\n'), E'\r\n', E'\n') || ';'
  union all
  select pg_get_triggerdef(t.oid) || ';'
  from pg_trigger t where t.tgrelid = 'public.dossiers'::regclass and t.tgname = 'trg_generate_code_email'
  union all
  select 'alter table public.' || con.conrelid::regclass::text || ' add constraint ' || con.conname || ' '
         || pg_get_constraintdef(con.oid) || ';'
  from pg_constraint con
  where exists (select 1 from cibles x where x.relid = con.conrelid and x.attnum = any (con.conkey))
  union all
  select pg_get_indexdef(i.indexrelid) || ';'
  from pg_index i
  where exists (select 1 from cibles x where x.relid = i.indrelid and x.attnum = any (i.indkey::int2[]))
    and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid)
)
select count(*) as instructions,
       md5(string_agg(s, E'\n' order by s)) as empreinte
from instructions;
