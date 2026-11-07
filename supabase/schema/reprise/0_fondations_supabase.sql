-- LES FONDATIONS QUE SUPABASE FOURNIT, AU MINIMUM, POUR REJOUER L'EXPORT DANS UNE GRAPPE POSTGRESQL NEUVE (ligne 20.6).
--
-- Ce fichier n'est PAS une migration et ne s'applique jamais à un projet Supabase : un projet neuf porte déjà tout cela,
-- et bien davantage. Il sert à REPÉTER la reprise sur une grappe locale (PostgreSQL 17, UTF8, ICU en-US, en_US.UTF-8,
-- comme la production), avant que l'export s'y rejoue par `rejouer.py`, qui le passe en premier, sous le super-utilisateur
-- de la grappe, dans la base déjà créée. Le mode d'emploi : PLAN_DE_REPRISE.md, §4, étape 2.
--
-- D'OÙ VIENT CE QU'IL POSE. De ce que l'export lui-même demande — `auth.users` (clés étrangères), `auth.uid()` (les
-- policies), `storage.buckets`, `storage.objects` et `storage.foldername()` (les seaux et leurs policies),
-- `supabase_migrations.schema_migrations` (sept migrations y cherchent une version précédente), le schéma `extensions`
-- (pgcrypto, pg_net) — et, pour la forme de ces objets, du catalogue de la réplique mère, relevé en production le
-- 06/11/2026 (HISTORIQUE.md, « LA RÉPLIQUE MÈRE REMONTÉE DEPUIS LE CATALOGUE ») : les définitions de `auth.uid()`, de
-- `storage.foldername()` et des deux tables du stockage sont celles de Supabase, telles que la production les porte.
--
-- CE QUI N'EST QU'UNE APPROXIMATION DU VRAI SUPABASE, dit pour qu'on ne le prenne pas pour lui :
--   - le rôle qui applique les migrations s'appelle ici `proprietaire` (en production `postgres`, qui n'est pas
--     super-utilisateur) ; `postgres` est ici le super-utilisateur de la grappe. `signature.sql` retire le propriétaire
--     des droits comparés, et la garde de `droits_hors_rls` ne nomme aucun rôle ;
--   - `proprietaire` est membre de `supabase_storage_admin`, pour poser les policies de `storage.objects` (il faut en
--     être propriétaire) : en production, `postgres` les pose, mais le chemin exact n'est pas dans le dépôt ;
--   - `auth.users` n'a que trois colonnes (`id`, `email`, `created_at`) : celles que l'export et les essais lisent ; le
--     schéma `auth` de Supabase (identités, sessions, facteurs, jetons…) n'est pas là, ni ses fonctions hors des quatre ;
--   - `supabase_admin` n'est ni super-utilisateur ni connectable (il l'est chez Supabase) : il ne porte que ses droits par
--     défaut dans public, ceux que relève la garde de `droits_hors_rls` ;
--   - pg_net est une DOUBLURE (`reprise/pg_net/`, à installer dans le répertoire des extensions) : le schéma `net` et deux
--     fonctions qui ne font rien ; aucune migration n'appelle `net`. Les déclencheurs d'événement de Supabase, le rôle
--     `authenticator`, PostgREST, GoTrue, l'API du stockage et ses fichiers manquent ;
--   - aucune donnée : ni compte, ni seau (les migrations posent les seaux), ni secret.
--
-- LES DROITS PAR DÉFAUT DE `proprietaire` DANS PUBLIC sont ceux d'un projet Supabase AVANT `droits_hors_rls` : tout aux
-- quatre rôles sur les tables (les huit droits de PostgreSQL 17, MAINTAIN compris), les séquences et les fonctions. C'est
-- l'état que la garde de tête de cette migration exige (son point (e)) ; un projet neuf qui ne les donnerait plus ferait
-- refuser cette migration — PLAN_DE_REPRISE.md, §4, étape 2, dit quoi faire alors.

\set ON_ERROR_STOP on

-- ── Les rôles (ceux de la grappe : une seconde base de la même grappe les trouve déjà) ──
do $$
declare
  r record;
begin
  for r in select * from (values ('anon', 'nologin'), ('authenticated', 'nologin'), ('service_role', 'nologin bypassrls'),
                                 ('supabase_admin', 'nologin'), ('supabase_storage_admin', 'noinherit createrole login'),
                                 ('proprietaire', 'createrole createdb login bypassrls')) v(nom, options)
  loop
    if to_regrole(r.nom) is null then
      execute format('create role %I %s', r.nom, r.options);
    end if;
  end loop;
end
$$;
alter role proprietaire set search_path to "$user", public, extensions;
grant anon, authenticated, service_role to proprietaire;
grant supabase_storage_admin to proprietaire;

-- La base appartient au rôle qui applique les migrations, comme `postgres` en production ; son chemin de recherche aussi.
do $$
begin
  execute format('alter database %I owner to proprietaire', current_database());
  execute format('alter database %I set search_path to "$user", public, extensions', current_database());
end
$$;

-- ── Les schémas ──
grant usage on schema public to anon, authenticated, service_role, proprietaire;

create schema extensions;
grant usage on schema extensions to anon, authenticated, service_role, proprietaire;
create extension pgcrypto with schema extensions;
create extension "uuid-ossp" with schema extensions;

create schema supabase_migrations;
grant usage on schema supabase_migrations to proprietaire;
create table supabase_migrations.schema_migrations (
  version text not null primary key,
  statements text[],
  name text
);
grant select, insert, update, delete, truncate, references, trigger on supabase_migrations.schema_migrations to proprietaire;

-- ── auth : les comptes et l'identité de la session, lue dans les réclamations du jeton ──
create schema auth;
grant usage on schema auth to anon, authenticated, service_role, proprietaire;
create table auth.users (
  id uuid not null primary key,
  email text,
  created_at timestamp with time zone default now()
);
grant select, insert, update, delete, truncate, references, trigger on auth.users to proprietaire;
grant select on auth.users to service_role;

create function auth.uid() returns uuid language sql stable as $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;
create function auth.email() returns text language sql stable as $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;

-- ── storage : les seaux, les objets et les fonctions de chemin ──
create schema storage authorization supabase_storage_admin;
grant usage on schema storage to anon, authenticated, service_role;
grant all on schema storage to proprietaire;
create type storage.buckettype as enum ('STANDARD', 'ANALYTICS', 'VECTOR');
alter type storage.buckettype owner to supabase_storage_admin;

create table storage.buckets (
  id text not null primary key,
  name text not null,
  owner uuid,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  public boolean default false,
  avif_autodetection boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  owner_id text,
  type storage.buckettype default 'STANDARD'::storage.buckettype not null,
  versioning_status text default 'DISABLED'::text not null,
  lifecycle_configuration jsonb,
  lifecycle_configuration_generation uuid,
  constraint buckets_versioning_status_check check (versioning_status = any (array['DISABLED'::text, 'ENABLED'::text, 'SUSPENDED'::text]))
);
create unique index bname on storage.buckets using btree (name);

create table storage.objects (
  id uuid default gen_random_uuid() not null primary key,
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  last_accessed_at timestamp with time zone default now(),
  metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/'::text)) stored,
  version text,
  owner_id text,
  user_metadata jsonb,
  archived_at timestamp with time zone,
  is_delete_marker boolean default false not null,
  is_versioned boolean default false not null
);
alter table storage.objects rename constraint objects_bucket_id_fkey to "objects_bucketId_fkey";
create index idx_objects_bucket_id_name on storage.objects using btree (bucket_id, name collate "C");
create index idx_objects_bucket_id_name_lower on storage.objects using btree (bucket_id, lower(name) collate "C");
create unique index idx_objects_current_version on storage.objects using btree (bucket_id, name collate "C") where (archived_at is null);
create index idx_objects_delete_markers on storage.objects using btree (bucket_id, name collate "C") where is_delete_marker;
create unique index idx_objects_null_version on storage.objects using btree (bucket_id, name collate "C") where (not is_versioned);
create index name_prefix_search on storage.objects using btree (name text_pattern_ops);
create unique index objects_bucket_id_name_version_key on storage.objects using btree (bucket_id, name collate "C", version) nulls not distinct;

alter table storage.buckets owner to supabase_storage_admin;
alter table storage.objects owner to supabase_storage_admin;
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.buckets, storage.objects to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on storage.buckets, storage.objects to service_role;
grant select, insert, update, delete, truncate, references, trigger on storage.buckets, storage.objects to proprietaire with grant option;

create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
DECLARE
    _parts text[];
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Return everything except the last segment
    RETURN _parts[1 : array_length(_parts,1) - 1];
END
$$;
create function storage.filename(name text) returns text language plpgsql immutable as $$
DECLARE
    _parts text[];
BEGIN
    SELECT string_to_array(name, '/') INTO _parts;
    RETURN _parts[array_length(_parts, 1)];
END
$$;
create function storage.extension(name text) returns text language plpgsql immutable as $$
DECLARE
    _parts text[];
    _filename text;
BEGIN
    SELECT string_to_array(name, '/') INTO _parts;
    SELECT _parts[array_length(_parts, 1)] INTO _filename;
    RETURN reverse(split_part(reverse(_filename), '.', 1));
END
$$;
-- La suppression directe d'un objet ou d'un seau est refusée par Supabase hors de l'API du stockage (relevé de la mère) :
-- la répétition garde ce refus, que les essais connaissent.
create function storage.protect_delete() returns trigger language plpgsql as $$
BEGIN
    IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') != 'true' THEN
        RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            USING HINT = 'This prevents accidental data loss from orphaned objects.',
                  ERRCODE = '42501';
    END IF;
    RETURN NULL;
END;
$$;
create function storage.update_updated_at_column() returns trigger language plpgsql as $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;
create trigger protect_buckets_delete before delete on storage.buckets for each statement execute function storage.protect_delete();
create trigger protect_objects_delete before delete on storage.objects for each statement execute function storage.protect_delete();
create trigger update_objects_updated_at before update on storage.objects for each row execute function storage.update_updated_at_column();

-- ── Les droits par défaut dans public, ceux d'un projet Supabase avant `droits_hors_rls` ──
alter default privileges for role proprietaire in schema public grant all on tables to anon, authenticated, service_role, proprietaire;
alter default privileges for role proprietaire in schema public grant all on sequences to anon, authenticated, service_role, proprietaire;
alter default privileges for role proprietaire in schema public grant execute on functions to anon, authenticated, service_role, proprietaire;
alter default privileges for role supabase_admin in schema public grant all on tables to anon, authenticated, service_role, proprietaire;
alter default privileges for role supabase_admin in schema public grant all on sequences to anon, authenticated, service_role, proprietaire;
alter default privileges for role supabase_admin in schema public grant execute on functions to anon, authenticated, service_role, proprietaire;
