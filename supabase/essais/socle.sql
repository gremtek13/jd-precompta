-- MOITIÉ « BASE » DU CONTRÔLE DU SOCLE — voir `supabase/essais/socle.py` pour le pourquoi.
--
-- Régénère depuis `pg_catalog` les 57 instructions qui reconstruisent les douze tables absentes de
-- l'historique de migrations, et rend leur empreinte agrégée. Égale à celle du fichier ⇒ la
-- reconstruction décrit encore la base.
--
-- Rien n'est NORMALISÉ des deux côtés : le fichier est le rendu exact du catalogue, donc la
-- comparaison est au caractère près. Une comparaison indulgente finit par tout accepter.
--
-- À rejouer après TOUTE migration touchant l'une de ces douze tables — c'est le seul moment où le
-- fichier peut dériver, et sa dérive ne se voit nulle part ailleurs.
with manquantes(t) as (
  values ('cotisations_declarees'),('documents_divers'),('ecritures_brouillon'),('immobilisations'),
         ('informations_dossier'),('lignes_bancaires'),('natures_immobilisation'),('references_annuelles'),
         ('references_postes_annuels'),('regles_bancaires_ignorees'),('sous_dossiers'),('tiers_categories')
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
)
select count(*) as instructions,
       md5(string_agg(s, E'\n' order by s)) as empreinte
from instructions;
