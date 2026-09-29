-- MOITIÉ « BASE » DE L'INVENTAIRE — voir `supabase/essais/inventaire.py` pour le pourquoi.
--
-- Rend, une ligne par objet du schéma vivant, ce que `inventaire.py` tire des fichiers de l'export :
-- colonnes, contraintes, index qui ne portent pas une contrainte, déclencheurs, policies (celles du
-- stockage comprises), fonctions (nom et nombre d'arguments) et tables sous RLS. Nombre et empreinte
-- égaux des deux côtés ⇒ rien n'existe en base qui ne soit dans l'export.
--
-- L'ordre est celui des octets (`collate "C"`), pour que Postgres trie comme Python : trier selon la
-- collation de la base ferait diverger deux listes identiques sur un `_` ou un `.`.
--
-- À rejouer après TOUTE migration, avec `socle.sql` : c'est ce contrôle qui dit si un objet a été
-- créé hors `apply_migration` — onze l'avaient été le 29/09/2026.
--
-- Pour le détail, remplacer la dernière requête par :
--   select string_agg(x, E'\n' order by x collate "C") from inventaire;
with inventaire(x) as (
  select 'colonne|' || c.relname || '.' || a.attname
  from pg_attribute a join pg_class c on c.oid = a.attrelid
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
  union all
  select 'contrainte|' || conrelid::regclass::text || '.' || conname
  from pg_constraint where connamespace = 'public'::regnamespace and conrelid <> 0
  union all
  select 'index|' || i.tablename || '.' || i.indexname
  from pg_indexes i
  where i.schemaname = 'public'
    and not exists (select 1 from pg_constraint k
                    where k.conindid = (quote_ident(i.schemaname) || '.' || quote_ident(i.indexname))::regclass)
  union all
  select 'declencheur|' || t.tgrelid::regclass::text || '.' || t.tgname
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
  where not t.tgisinternal and c.relnamespace = 'public'::regnamespace
  union all
  select 'policy|' || tablename || '.' || policyname from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'fonction|' || p.proname || '/' || p.pronargs from pg_proc p where p.pronamespace = 'public'::regnamespace
  union all
  select 'rls|' || relname from pg_class
  where relnamespace = 'public'::regnamespace and relkind = 'r' and relrowsecurity
)
select count(*) as objets, md5(string_agg(x, E'\n' order by x collate "C")) as empreinte from inventaire;
