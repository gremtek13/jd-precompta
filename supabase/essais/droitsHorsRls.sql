-- LES DROITS HORS DE LA RLS, PROUVÉS PAR LE GESTE (relecture de sécurité du 06/11/2026 ; migration `droits_hors_rls`) —
-- SUR UNE RÉPLIQUE SEULEMENT : chaque geste tenté prend un verrou fort sur la table qu'il vise (ACCESS EXCLUSIVE pour le
-- vidage, SHARE ROW EXCLUSIVE pour un déclencheur ou une clé étrangère, SHARE pour REINDEX), et le vidage vide la table le
-- temps de sa sous-transaction : une base en service ne le subit pas. Le compagnon du bloc HR de `rls.sql`, qui lit le
-- catalogue en production : ici, chaque geste est tenté.
--
-- Pour chaque table de public, sous chaque profil, chaque geste dans une sous-transaction annulée :
--   - vider la table : TRUNCATE ;
--   - y poser un déclencheur : CREATE TRIGGER, sur une fonction créée pour l'essai, EXECUTE donné au profil ;
--   - la viser d'une clé étrangère : une table créée dans un schéma jetable, où le profil a CREATE le temps de l'essai,
--     dont la clé étrangère vise la clé primaire de la table (à défaut, une contrainte unique immédiate), mêmes types et
--     mêmes collations — PostgreSQL ne juge le droit REFERENCES qu'après avoir trouvé la clé : une table sans clé ne se
--     vise pas, et se compte « sans clé » ;
--   - la maintenir : REINDEX TABLE (MAINTAIN, PostgreSQL 17).
-- Les profils : anon (le jeton anonyme) et authenticated (le jeton du chef du cabinet de `test`, super-administrateur de
-- l'application : le plus large des comptes) — attendu, pour chaque geste, 42501 « permission denied for table <la
-- table> » ; service_role et le propriétaire de la table — le contrôle POSITIF : chaque geste passe (le vidage d'une table
-- qu'une clé étrangère vise, refusé pour elle en 0A000, a passé le droit avant). Sans la migration, anon et authenticated
-- passent aussi : c'est la mutation naturelle de l'essai, EN FAUTE partout alors. Après elle, une mutation qui doit mordre :
-- les quatre droits rendus à anon sur cabinet_admins, le temps d'une sous-transaction — ses quatre gestes passent le droit.
--
-- Une garde de tête refuse de le jouer hors d'une réplique (ESSAI_HORS_REPLIQUE : le rôle `proprietaire` manque à la
-- production), ou sous un autre rôle que le super-utilisateur (ESSAI_IMPOSSIBLE : il prend chaque profil tour à tour). Le
-- décor (le schéma jetable, la fonction, leurs droits) s'annule avec l'essai entier ; « rien n'est resté » le relit, et
-- compare l'empreinte des droits du schéma public à celle d'avant l'essai. Joué en UNE transaction (`psql -1`).
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  decor constant text := 'essai_droits_hors_rls';
  noms_gestes constant text[] := array['vider', 'declencheur', 'reference', 'maintenance'];
  libelles_gestes constant text[] := array[
    'vider la table (TRUNCATE)',
    'y poser un déclencheur (CREATE TRIGGER)',
    'la viser d''une clé étrangère (REFERENCES)',
    'la maintenir (REINDEX TABLE, MAINTAIN)'];
  -- Les droits du schéma public (relations, colonnes, défauts de public et globaux), lus avant et après l'essai.
  empreinte_droits constant text := $q$
    select md5(coalesce(string_agg(l.s, ';' order by l.s collate "C"), ''))
      from (select 'table|' || c.relname || '|' || coalesce(c.relacl::text, '-') as s
              from pg_class c where c.relnamespace = 'public'::regnamespace
            union all
            select 'colonne|' || c.relname || '.' || att.attname || '|' || att.attacl::text
              from pg_class c join pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and att.attacl is not null
             where c.relnamespace = 'public'::regnamespace
            union all
            select 'defaut|' || d.defaclrole::regrole::text || '|' || d.defaclobjtype::text || '|' || d.defaclnamespace::text
                   || '|' || d.defaclacl::text
              from pg_default_acl d where d.defaclnamespace in (0, 'public'::regnamespace)) l$q$;
  avant text; apres text;
  gestes jsonb := '{}'::jsonb;
  rel record; profil record; i int; g text; instruction text; colonnes text; cles text; visees text;
  accepte boolean; code text; message text; ok boolean;
  essayes int; fautes int; sans_cle int; detail text; autres text; tables int;
  mutation text;
  verdicts jsonb := '[]'::jsonb;
begin
  -- La garde de tête : sur une réplique seulement, sous son super-utilisateur, avant toute écriture.
  if not exists (select 1 from pg_roles where rolname = 'proprietaire') then
    raise exception 'ESSAI_HORS_REPLIQUE : cet essai vide des tables et pose des verrous forts ; il ne se joue que sur une réplique ; le rôle proprietaire, que toute réplique porte, est absent : rien n''est écrit.';
  end if;
  if not coalesce((select r.rolsuper from pg_roles r where r.rolname = current_user), false) then
    raise exception 'ESSAI_IMPOSSIBLE : cet essai prend chaque profil tour à tour et se joue sous le super-utilisateur de la réplique ; % ne l''est pas : rien n''est écrit.', current_user;
  end if;
  execute empreinte_droits into avant;

  -- 1. Toutes les relations de public sont des tables ordinaires : une autre sorte (vue, vue matérialisée, table étrangère
  -- ou partitionnée) demanderait d'autres gestes — REINDEX d'une table partitionnée ne se joue pas dans une transaction.
  select string_agg(c.relname || ' (' || c.relkind::text || ')', ', ' order by c.relname)
    into autres
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('p', 'v', 'm', 'f');
  verdicts := verdicts || jsonb_build_object('rang', 1,
    'etape', '1. les relations de public sont toutes des tables ordinaires (une autre sorte se dirait ici : l''essai serait à reprendre pour elle)',
    'ok', autres is null, 'observe', coalesce(autres, 'toutes'));

  -- 2. Le plancher : au moins les 85 tables du relevé du 06/11/2026.
  select count(*) into tables from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r';
  verdicts := verdicts || jsonb_build_object('rang', 2,
    'etape', '2. au moins les 85 tables du relevé du 06/11/2026, chacune essayée',
    'ok', tables >= 85, 'observe', tables || ' table(s)');

  -- Les gestes de chaque table, écrits une fois : la clé primaire, à défaut une contrainte unique immédiate, ses colonnes
  -- dans l'ordre de la clé, leurs types et leurs collations.
  for rel in select c.oid, c.relname::text as nom
               from pg_class c
              where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
              order by c.relname collate "C" loop
    colonnes := null; cles := null; visees := null;
    select string_agg(format('c%s %s%s', k.n, format_type(att.atttypid, att.atttypmod),
                             case when att.attcollation <> 0 and att.attcollation <> t.typcollation
                                  then ' collate ' || att.attcollation::regcollation::text else '' end), ', ' order by k.n),
           string_agg(format('c%s', k.n), ', ' order by k.n),
           string_agg(quote_ident(att.attname), ', ' order by k.n)
      into colonnes, cles, visees
      from (select con.conkey
              from pg_constraint con
             where con.conrelid = rel.oid and con.contype in ('p', 'u') and not con.condeferrable
             order by con.contype = 'p' desc, con.conname collate "C"
             limit 1) choisie
     cross join lateral unnest(choisie.conkey) with ordinality k(attnum, n)
      join pg_attribute att on att.attrelid = rel.oid and att.attnum = k.attnum
      join pg_type t on t.oid = att.atttypid;
    gestes := gestes || jsonb_build_object(rel.nom, jsonb_build_object(
      'vider', format('truncate table public.%I', rel.nom),
      'declencheur', format('create trigger essai_droits_hors_rls before insert on public.%I for each row execute function %I.declencheur()', rel.nom, decor),
      'reference', case when colonnes is null then null
                        else format('create table %I.reference (%s, foreign key (%s) references public.%I (%s))', decor, colonnes, cles, rel.nom, visees) end,
      'maintenance', format('reindex table public.%I', rel.nom)));
  end loop;

  begin
    -- ── Le décor, le temps de l'essai : un schéma jetable, une fonction de déclencheur, et ce qu'il faut à chaque profil
    -- pour que seul le droit éprouvé décide (USAGE et CREATE sur le schéma, EXECUTE sur la fonction) ──
    execute format('create schema %I', decor);
    execute format('create function %I.declencheur() returns trigger language plpgsql as %L', decor, 'begin return null; end');
    for profil in select r.rolname
                    from pg_roles r
                   where r.rolname in ('anon', 'authenticated', 'service_role')
                      or r.oid in (select c.relowner from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r') loop
      execute format('grant usage, create on schema %I to %I', decor, profil.rolname);
      execute format('grant execute on function %I.declencheur() to %I', decor, profil.rolname);
    end loop;

    -- ── Chaque profil, chaque geste, chaque table ──
    for profil in select *
                    from (values
                      (10, 'anon (le jeton anonyme)', 'anon', '{"role":"anon"}', true),
                      (20, 'authenticated (le jeton du chef du cabinet, super-administrateur)', 'authenticated',
                       json_build_object('sub', chef, 'role', 'authenticated')::text, true),
                      (30, 'service_role (le contrôle positif)', 'service_role', '{"role":"service_role"}', false),
                      (40, 'le propriétaire de la table (le contrôle positif)', null, '', false)) p(rang, libelle, role_sql, claims, refuse)
                   order by 1 loop
      for i in 1 .. 4 loop
        g := noms_gestes[i];
        essayes := 0; fautes := 0; sans_cle := 0; detail := null;
        for rel in select c.relname::text as nom, c.relowner
                     from pg_class c
                    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
                    order by c.relname collate "C" loop
          instruction := gestes -> rel.nom ->> g;
          if instruction is null then
            sans_cle := sans_cle + 1;
            continue;
          end if;
          essayes := essayes + 1;
          accepte := false; code := null; message := null;
          begin
            execute format('set local role %I', coalesce(profil.role_sql, pg_get_userbyid(rel.relowner)));
            perform set_config('request.jwt.claims', profil.claims, true);
            execute instruction;
            accepte := true;
            raise exception 'ANNULATION_ESSAI';
          exception when others then
            if not accepte then code := sqlstate; message := sqlerrm; end if;
          end;
          reset role;
          perform set_config('request.jwt.claims', '', true);
          if profil.refuse then
            ok := not accepte and code = '42501' and message = 'permission denied for table ' || rel.nom;
          else
            ok := accepte or (g = 'vider' and code = '0A000');
          end if;
          if not ok then
            fautes := fautes + 1;
            if fautes <= 5 then
              detail := coalesce(detail || ' ; ', '') || rel.nom || ' : ' || case when accepte then 'accepté' else code || ' ' || message end;
            end if;
          end if;
        end loop;
        verdicts := verdicts || jsonb_build_object('rang', profil.rang + i,
          'etape', (profil.rang + i) || '. ' || profil.libelle || ' — ' || libelles_gestes[i] || ' : '
                   || case when profil.refuse then 'refusé, 42501 « permission denied for table … »' else 'passe le droit' end,
          'ok', fautes = 0 and essayes > 0,
          'observe', essayes || ' table(s) essayée(s), ' || fautes || ' en faute'
                     || case when sans_cle > 0 then ', ' || sans_cle || ' sans clé (le geste ne se pose pas)' else '' end
                     || coalesce(' : ' || detail, ''));
      end loop;
    end loop;

    -- ── La mutation : les quatre droits rendus à anon sur cabinet_admins, le temps d'une sous-transaction ; ses quatre
    -- gestes doivent passer le droit (le vidage refusé en 0A000 pour une clé étrangère l'a passé) ──
    mutation := '';
    begin
      grant truncate, trigger, references, maintain on table public.cabinet_admins to anon;
      for i in 1 .. 4 loop
        instruction := gestes -> 'cabinet_admins' ->> noms_gestes[i];
        accepte := false; code := null; message := null;
        begin
          set local role anon;
          perform set_config('request.jwt.claims', '{"role":"anon"}', true);
          execute instruction;
          accepte := true;
          raise exception 'ANNULATION_ESSAI';
        exception when others then
          if not accepte then code := sqlstate; message := sqlerrm; end if;
        end;
        reset role;
        perform set_config('request.jwt.claims', '', true);
        mutation := mutation || noms_gestes[i] || ' '
                    || case when accepte then 'passe' when noms_gestes[i] = 'vider' and code = '0A000' then 'passe (0A000)'
                            else coalesce(code, 'ni accepté ni refusé') || ' ' || coalesce(message, '') end || ' ; ';
      end loop;
      raise exception 'ANNULATION_ESSAI';
    exception when others then
      if sqlerrm <> 'ANNULATION_ESSAI' then mutation := mutation || '[' || sqlstate || ' ' || sqlerrm || ']'; end if;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('rang', 50,
      'etape', '50. la mutation : les quatre droits rendus à anon sur cabinet_admins, ses quatre gestes passent le droit',
      'ok', mutation = 'vider passe ; declencheur passe ; reference passe ; maintenance passe ; '
            or mutation = 'vider passe (0A000) ; declencheur passe ; reference passe ; maintenance passe ; ',
      'observe', mutation);

    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- Rien n'est resté : ni le schéma jetable, ni un déclencheur de l'essai, et les droits du schéma public tels qu'avant.
  execute empreinte_droits into apres;
  verdicts := verdicts || jsonb_build_object('rang', 99,
    'etape', '99. rien n''est resté : ni le schéma jetable, ni un déclencheur de l''essai, les droits du schéma public tels qu''avant',
    'ok', to_regnamespace(decor) is null
      and not exists (select 1 from pg_trigger tg where tg.tgname = 'essai_droits_hors_rls')
      and apres = avant,
    'observe', 'relu');
  perform set_config('essai.droits_hors_rls', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.droits_hors_rls')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
