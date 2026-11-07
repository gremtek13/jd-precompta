-- DOUBLURE de pg_net (voir pg_net.control) : ce que la réplique mère porte, relevé de la production — le schéma `net` et
-- deux fonctions, qui rendent 0 et n'appellent rien. La vraie extension a aussi ses deux tables et son processus.
create schema net;
grant usage on schema net to anon, authenticated, service_role, proprietaire;
create function net.http_get(url text, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb,
                             timeout_milliseconds integer default 5000) returns bigint
  language sql as $$ select 0::bigint $$;
create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
                              headers jsonb default '{"Content-Type": "application/json"}'::jsonb,
                              timeout_milliseconds integer default 5000) returns bigint
  language sql as $$ select 0::bigint $$;
