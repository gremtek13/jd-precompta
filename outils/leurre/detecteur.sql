-- LE DÉTECTEUR D'ÉCRITURES DU BANC (outils/leurre/banc.py ; SUR UNE RÉPLIQUE SEULEMENT, sur une base à leurre) : un
-- déclencheur APRÈS chaque ligne insérée, modifiée ou supprimée dans toute table du schéma public, et dans auth.users,
-- storage.objects et storage.buckets, actif même sous `session_replication_role = replica` (ENABLE ALWAYS). Il ne change
-- rien à la ligne ; il dit, par un WARNING qui sort de la transaction même annulée, la table, le geste et la classe de la
-- ligne : LEURRE (elle porte un identifiant ou le marqueur d'un dossier de leurre — le dossier « réel »), FICTIF (un des
-- quatre dossiers fictifs de la réplique), AUTRE (un autre dossier : en général un dossier jetable de l'essai) ou
-- SANS-DOSSIER (une ligne commune). Son motif est celui des marqueurs et des identifiants de regles.json.
\set ON_ERROR_STOP on
begin;
create or replace function public.zzz_detecteur_ecritures() returns trigger language plpgsql as $f$
declare
  j text;
  o text;
  classe text;
  d text;
  motif constant text := '(leurre-7q3|00000000-0000-4000-8000-0000000|fffffff0-0000-4000-8000-0000000|7e570000-0000-4000-8000-|7e57e000-0000-4000-8000-)';
begin
  if tg_op in ('INSERT', 'UPDATE') then j := to_jsonb(new)::text; end if;
  if tg_op in ('UPDATE', 'DELETE') then o := to_jsonb(old)::text; end if;
  if tg_table_schema = 'public' and tg_table_name = 'dossiers' then
    d := coalesce(j::jsonb ->> 'id', o::jsonb ->> 'id');
  else
    d := coalesce(j::jsonb ->> 'dossier_id', o::jsonb ->> 'dossier_id');
  end if;
  if coalesce(j, '') ~* motif or coalesce(o, '') ~* motif then
    classe := 'LEURRE';
  elsif d is null then
    classe := 'SANS-DOSSIER';
  elsif d in ('001c7ed7-c23b-4590-901e-693489f8af24', 'ac538d93-7da3-4403-bca6-2d7836810a6f',
              'd0551e20-0000-4000-8000-000000000003', 'd0551e20-0000-4000-8000-000000000004') then
    classe := 'FICTIF';
  else
    classe := 'AUTRE';
  end if;
  raise warning 'DETECTEUR|%|%.%|%|%', classe, tg_table_schema, tg_table_name, tg_op, coalesce(d, '');
  return null;
end $f$;
do $d$
declare t record;
begin
  for t in select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where c.relkind = 'r' and (n.nspname = 'public' or (n.nspname = 'auth' and c.relname = 'users')
                                       or (n.nspname = 'storage' and c.relname in ('objects', 'buckets'))) loop
    execute format('create trigger zzz_detecteur after insert or update or delete on %I.%I for each row execute function public.zzz_detecteur_ecritures()', t.nspname, t.relname);
    execute format('alter table %I.%I enable always trigger zzz_detecteur', t.nspname, t.relname);
  end loop;
end $d$;
select 'détecteur', count(*) from pg_trigger where tgname = 'zzz_detecteur';
commit;
