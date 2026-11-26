-- QUI A OUVERT UN ACCÈS CLIENT : LE COMPTE DU CABINET, ATTESTÉ SOUS SA SESSION (espace client, ligne 51.5, P1TQ2-Q1 ; la
-- migration `auteur_des_ouvertures_d_acces`, en production depuis le 16/11/2026 (234), supabase/schema/20261116174937_auteur_des_ouvertures_d_acces.sql).
-- Le récit : HISTORIQUE.md, « 16/11/2026 — P1TQ2-Q1 : QUI A OUVERT UN ACCÈS CLIENT ». À rejouer par `execute_sql` après
-- toute migration qui touche `memberships`, ses déclencheurs, `trace_des_droits`, `auteurs_des_ouvertures` ou leurs
-- fonctions.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - l'ouverture écrite sans session (le rôle des Edge Functions, comme `create-client-access`) laisse à la trace une
--     arrivée sans auteur ; le cabinet du dossier qui l'atteste sous sa session en devient l'auteur, nommé par la base
--     (`auth.uid()`), sur CETTE arrivée — le chef super-administrateur, un membre affecté, un chef qui ne l'est pas ;
--   - personne d'autre ne l'atteste (un membre d'un autre dossier, le client, le rôle des Edge Functions, le propriétaire,
--     l'anonyme : 42501), ni deux fois, ni passé cinq minutes, ni une arrivée écrite sous une session, ni un accès qui a
--     quitté le dossier, ni par le titulaire de l'accès (22023) ;
--   - la restauration réinsère une attestation telle que la sauvegarde la porte (le super-administrateur) ; personne n'écrit
--     la table en direct ni ne la réécrit (la garde, AVANT la RLS) ; le cabinet du dossier la lit, ni un membre d'ailleurs, ni
--     le client, ni l'anonyme ;
--   - le catalogue : la table, ses contraintes, ses deux policies, ses deux fonctions, leurs empreintes et leurs droits, sa
--     garde ; la garde de la trace inchangée.
--
-- Deux dossiers jetables du cabinet du dossier `test` (préfixe `a0700000-0000-4000-8026`) ; deux accès d'essai — A, au compte
-- client d'essai, et N, au compte du chef. LE CHEF QUI N'EST PAS SUPER-ADMINISTRATEUR ET LES MEMBRES D'ESSAI sont le compte
-- client du jeu, rattaché au cabinet le temps d'une étape — le patron de `traceDesDroits.sql` : l'essai ne suppose aucun
-- membre d'équipe d'essai. Chaque étape se joue dans sa sous-transaction et s'y ANNULE (`ANNULATION_ETAPE`), le jeu à la fin
-- (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le relit. Les verdicts voyagent dans un réglage LOCAL
-- (`essai.auteur_des_ouvertures`) : le fichier se joue d'un seul appel, ne crée ni table ni fonction, ne contient aucune
-- instruction de suppression, et ne rend rien qui dépende d'une ligne hors de ses dossiers. Hors de l'outil d'exécution, en
-- UNE transaction (`psql -1`). Sans la migration, une ligne dit qu'il attend (EN ATTENTE) et rien ne s'écrit.
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  dt constant text := 'a0700000-0000-4000-8026-0000000000d1';
  du constant text := 'a0700000-0000-4000-8026-0000000000d2';
  acces_a constant text := 'a0700000-0000-4000-8026-0000000000a1';
  acces_n constant text := 'a0700000-0000-4000-8026-0000000000c1';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  verdicts jsonb := '[]'::jsonb;
  e record;
  v_obs text;
  v_code text;
  v_msg text;
  v_apres text;
  v_req text;
  -- Ce que la base dit des deux dossiers, relu par le propriétaire : les arrivées d'accès de la trace et leur auteur, puis
  -- les attestations — l'accès, le compte, et si la ligne de la trace qu'elle nomme est bien l'arrivée de CET accès, ici,
  -- sans auteur.
  resume constant text := $r$select coalesce((select string_agg(
        case t.acces_id::text when '{A}' then 'A' when '{N}' then 'N' else '?' end || ' '
        || case when t.auteur_id is null then 'sans session' when t.auteur_id::text = '{CHEF}' then 'CHEF'
                when t.auteur_id::text = '{CLIENT}' then 'CLIENT' else '?' end,
        ', ' order by t.acces_id, t.fait_le)
      from trace_des_droits t where t.dossier_id in ('{DT}', '{DU}') and t.droit = 'acces' and t.geste = 'creation'), 'aucune arrivée')
    || ' / ' || coalesce((select string_agg(
        case a.acces_id::text when '{A}' then 'A' when '{N}' then 'N' else '?' end || ' '
        || case a.auteur_id::text when '{CHEF}' then 'CHEF' when '{CLIENT}' then 'CLIENT' else '?' end
        || case when exists (select 1 from trace_des_droits t where t.id = a.trace_id and t.dossier_id = a.dossier_id
                               and t.acces_id = a.acces_id and t.droit = 'acces' and t.geste = 'creation' and t.auteur_id is null)
                then '' else ' (ligne étrangère)' end,
        ', ' order by a.acces_id, a.atteste_le)
      from auteurs_des_ouvertures a where a.dossier_id in ('{DT}', '{DU}')), 'rien d''attesté')$r$;
  -- L'ouverture de A par le propriétaire, sans session : ce que la trace voit de l'Edge Function sous la clé secrète.
  ouvrir_a constant text := $p$select set_config('request.jwt.claims', '', true);
    insert into memberships (id, user_id, dossier_id, role, email) values ('{A}', '{CLIENT}', '{DT}', 'client', 'essai-ouverture-a@example.test')$p$;
  ouvrir_n constant text := $p$select set_config('request.jwt.claims', '', true);
    insert into memberships (id, user_id, dossier_id, role, email) values ('{N}', '{CHEF}', '{DT}', 'client', 'essai-ouverture-n@example.test')$p$;
  -- Une arrivée de A plus ancienne : l'accès réinséré par le super-administrateur (rien de tracé), puis son arrivée par la
  -- porte de la restauration, sans auteur, datée d'avant l'instant de l'essai.
  ancienne constant text := $p$select set_config('request.jwt.claims', json_build_object('sub', '{CHEF}', 'role', 'authenticated')::text, true);
    insert into memberships (id, user_id, dossier_id, role, email) values ('{A}', '{CLIENT}', '{DT}', 'client', 'essai-ouverture-a@example.test');
    insert into trace_des_droits (dossier_id, acces_id, client_id, droit, coche, geste, auteur_id, fait_le)
    values ('{DT}', '{A}', '{CLIENT}', 'acces', true, 'creation', null, now() - interval '{AGE}')$p$;
  attester_a constant text := $q$select (attester_ouverture_d_acces('{DT}', '{A}') = now())::text$q$;
  attester_n constant text := $q$select (attester_ouverture_d_acces('{DT}', '{N}') = now())::text$q$;
  ecrire constant text := $q$insert into auteurs_des_ouvertures (dossier_id, acces_id, trace_id, auteur_id)
    values ('{DT}', '{A}', (select t.id from trace_des_droits t where t.dossier_id = '{DT}' and t.acces_id = '{A}'), '{CHEF}') returning 'insérée'$q$;
  reecrire constant text := $q$with r as (update auteurs_des_ouvertures set auteur_id = '{CLIENT}' where dossier_id = '{DT}' returning 1)
    select count(*)::text from r$q$;
  lire constant text := $q$select count(*)::text from auteurs_des_ouvertures where dossier_id = '{DT}'$q$;
  ligne_attestee constant text := 'A sans session / A CHEF';
  refus_droit constant text := 'Accès refusé à ce dossier.';
  refus_arrivee constant text := 'Cette ouverture d''accès ne s''atteste pas : aucune arrivée de cet accès dans ce dossier, écrite sans session dans les cinq dernières minutes et pas encore attestée.';
  refus_garde constant text := 'L''auteur d''une ouverture d''accès ne s''écrit que par attester_ouverture_d_acces, sous la session du cabinet.';
  refus_reecriture constant text := 'L''auteur d''une ouverture d''accès ne se réécrit pas : il ne part qu''avec son dossier.';
begin
  if to_regclass('public.auteurs_des_ouvertures') is null then
    perform set_config('essai.auteur_des_ouvertures', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration auteur_des_ouvertures_d_acces', 'ok', true,
      'observe', 'la table auteurs_des_ouvertures absente : rien ne s''écrit'))::text, true);
    return;
  end if;

  -- Ce que les profils supposent : le chef, super-administrateur et chef du cabinet ; le compte d'essai, ni l'un ni l'autre.
  verdicts := verdicts || jsonb_build_object('rang', 0, 'etape', '0. les profils : le chef super-administrateur et chef du cabinet, le compte d''essai ni membre ni super-administrateur',
    'ok', exists (select 1 from cabinet_admins where user_id::text = chef and cabinet_id = cabinet and role = 'comptable_en_chef')
      and exists (select 1 from super_admins where user_id::text = chef)
      and not exists (select 1 from cabinet_admins where user_id::text = client)
      and not exists (select 1 from super_admins where user_id::text = client),
    'observe', 'lus');

  begin
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, statut_tva) values
      (dt::uuid, 'ESSAI AUTEUR DES OUVERTURES DT', cabinet, 'tresorerie', '455000', 'exonere'),
      (du::uuid, 'ESSAI AUTEUR DES OUVERTURES DU', cabinet, 'tresorerie', '455000', 'exonere');

    -- Une étape : {rang, profil — `chef` (super-administrateur), `chef_simple` (un chef qui ne l'est pas), `membre` (affecté
    -- à DT), `membre_ailleurs` (affecté à DU seul), `client`, `service` (le rôle des Edge Functions), `anon`, ou
    -- `proprietaire` (sans session) —, étape, ce que le propriétaire pose d'abord, la requête du profil, le code attendu
    -- (`OK` : acceptée), ce qui est attendu : « la valeur rendue | ce que la base dit des deux dossiers »}.
    for e in select * from (values
      (1, 'service', '1. l''Edge Function ouvre un accès (le rôle du service, sans session) : la trace en écrit l''arrivée sans auteur, rien d''attesté', null,
        $q$with m as (insert into memberships (id, user_id, dossier_id, role, email) values ('{A}', '{CLIENT}', '{DT}', 'client', 'essai-ouverture-a@example.test') returning 1) select count(*)::text from m$q$,
        'OK', '1 | A sans session / rien d''attesté'),
      (2, 'chef', '2. le chef (super-administrateur) atteste l''ouverture sous sa session : il en est l''auteur, à l''instant, sur cette arrivée', 'OUVRIR_A', 'ATTESTER_A', 'OK', 'true | A sans session / A CHEF'),
      (3, 'membre', '3. un membre affecté au dossier atteste l''ouverture d''un accès qui n''est pas le sien : il en est l''auteur', 'OUVRIR_N', 'ATTESTER_N', 'OK', 'true | N sans session / N CLIENT'),
      (4, 'chef_simple', '4. un chef qui n''est pas super-administrateur aussi', 'OUVRIR_N', 'ATTESTER_N', 'OK', 'true | N sans session / N CLIENT'),
      (5, 'chef', '5. le réglage que la garde lit est remis à vide après l''attestation', 'OUVRIR_A',
        $q$select (attester_ouverture_d_acces('{DT}', '{A}') = now())::text || ' ' || coalesce(nullif(current_setting('jd.auteur_d_une_ouverture', true), ''), 'vide')$q$,
        'OK', 'true vide | A sans session / A CHEF'),
      (6, 'membre_ailleurs', '6. un membre affecté à un autre dossier n''atteste pas (42501, avant toute lecture)', 'OUVRIR_A', 'ATTESTER_A', '42501', 'DROIT | A sans session / rien d''attesté'),
      (7, 'client', '7. le client non plus — le titulaire de l''accès', 'OUVRIR_A', 'ATTESTER_A', '42501', 'DROIT | A sans session / rien d''attesté'),
      (8, 'service', '8. le rôle des Edge Functions non plus, sans session', 'OUVRIR_A', 'ATTESTER_A', '42501', 'DROIT | A sans session / rien d''attesté'),
      (9, 'proprietaire', '9. le propriétaire non plus, sans session', 'OUVRIR_A', 'ATTESTER_A', '42501', 'DROIT | A sans session / rien d''attesté'),
      (10, 'anon', '10. l''anonyme n''exécute pas la fonction', 'OUVRIR_A', 'ATTESTER_A', '42501',
        'permission denied for function attester_ouverture_d_acces | A sans session / rien d''attesté'),
      (11, 'chef', '11. une seconde attestation de la même arrivée se refuse (22023), la première reste', 'ATTESTEE', 'ATTESTER_A',
        '22023', 'ARRIVEE | LIGNE'),
      (12, 'chef', '12. une arrivée de 4 minutes 59 : attestée', 'ANCIENNE:4 minutes 59 seconds', 'ATTESTER_A', 'OK', 'true | A sans session / A CHEF'),
      (13, 'chef', '13. une arrivée de 5 minutes 1 : passée la fenêtre, elle ne s''atteste plus (22023)', 'ANCIENNE:5 minutes 1 second', 'ATTESTER_A', '22023',
        'ARRIVEE | A sans session / rien d''attesté'),
      -- L'arrivée écrite sous la session du compte d'essai (qui n'est pas le chef : l'insertion du super-administrateur ne se
      -- trace pas), sur l'accès A — dont le chef n'est pas le titulaire : seule la règle de l'auteur la refuse.
      (14, 'chef', '14. une arrivée écrite sous une session a déjà son auteur : elle ne s''atteste pas (22023)',
        $p$select set_config('request.jwt.claims', json_build_object('sub', '{CLIENT}', 'role', 'authenticated')::text, true);
    insert into memberships (id, user_id, dossier_id, role, email) values ('{A}', '{CLIENT}', '{DT}', 'client', 'essai-ouverture-a@example.test')$p$,
        'ATTESTER_A', '22023', 'ARRIVEE | A CLIENT / rien d''attesté'),
      (15, 'chef', '15. un accès qui a quitté le dossier depuis son arrivée ne s''atteste plus (22023)',
        $p$select set_config('request.jwt.claims', '', true);
    insert into memberships (id, user_id, dossier_id, role, email) values ('{A}', '{CLIENT}', '{DT}', 'client', 'essai-ouverture-a@example.test');
    update memberships set dossier_id = '{DU}' where id = '{A}'$p$,
        'ATTESTER_A', '22023', 'ARRIVEE | A sans session, A sans session / rien d''attesté'),
      (16, 'chef', '16. le titulaire de l''accès ne s''en nomme pas l''auteur : le chef, sur l''accès à son compte (22023)', 'OUVRIR_N', 'ATTESTER_N', '22023',
        'ARRIVEE | N sans session / rien d''attesté'),
      (17, 'chef', '17. un accès qui n''est pas du dossier nommé ne s''atteste pas sous lui (22023)', 'OUVRIR_A',
        $q$select (attester_ouverture_d_acces('{DU}', '{A}') = now())::text$q$, '22023', 'ARRIVEE | A sans session / rien d''attesté'),
      (18, 'chef', '18. la restauration : le super-administrateur réinsère une attestation telle que la sauvegarde la porte', 'OUVRIR_A',
        'ECRIRE', 'OK', 'insérée | A sans session / A CHEF'),
      (19, 'client', '19. le client n''écrit pas la table (la garde, avant la RLS)', 'OUVRIR_A', 'ECRIRE', '42501', 'GARDE'),
      (20, 'membre', '20. le membre affecté non plus', 'OUVRIR_A', 'ECRIRE', '42501', 'GARDE'),
      (21, 'chef_simple', '21. un chef qui n''est pas super-administrateur non plus', 'OUVRIR_A', 'ECRIRE', '42501', 'GARDE'),
      (22, 'service', '22. le rôle des Edge Functions non plus', 'OUVRIR_A', 'ECRIRE', '42501', 'GARDE'),
      (23, 'proprietaire', '23. le propriétaire non plus', 'OUVRIR_A', 'ECRIRE', '42501', 'GARDE'),
      (24, 'anon', '24. l''anonyme non plus', 'OUVRIR_A', 'ECRIRE', '42501', 'GARDE'),
      (25, 'chef', '25. personne ne réécrit une attestation : le chef super-administrateur (aucune policy, aucune ligne touchée)', 'ATTESTEE', 'REECRIRE', 'OK', '0 | LIGNE'),
      (26, 'service', '26. … le rôle des Edge Functions (la garde, 23514)', 'ATTESTEE', 'REECRIRE', '23514', 'REECRITURE'),
      (27, 'proprietaire', '27. … le propriétaire (la garde, 23514)', 'ATTESTEE', 'REECRIRE', '23514', 'REECRITURE'),
      (28, 'chef', '28. le chef lit l''attestation de son dossier', 'ATTESTEE', 'LIRE', 'OK', '1 | LIGNE'),
      (29, 'membre', '29. le membre affecté au dossier la lit', 'ATTESTEE', 'LIRE', 'OK', '1 | LIGNE'),
      (30, 'membre_ailleurs', '30. un membre affecté à un autre dossier n''en lit rien', 'ATTESTEE', 'LIRE', 'OK', '0 | LIGNE'),
      (31, 'client', '31. le client n''en lit rien, pas même de son dossier — il lit son accès', 'ATTESTEE',
        $q$select (select count(*) from auteurs_des_ouvertures where dossier_id = '{DT}')::text || ' ' || (select count(*) from memberships where id = '{A}')::text$q$,
        'OK', '0 1 | LIGNE'),
      (32, 'anon', '32. l''anonyme n''en lit rien', 'ATTESTEE', 'LIRE', 'OK', '0 | LIGNE'),
      (33, 'proprietaire', '33. le catalogue : la table, la RLS active et non forcée, ses colonnes', null,
        $q$select c.relrowsecurity || ' ' || c.relforcerowsecurity || ' | ' || (select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
  || case when a.attnotnull then ' not null' else '' end || coalesce(' = ' || pg_get_expr(d.adbin, d.adrelid), ''), ', ' order by a.attnum)
  from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) from pg_class c where c.oid = 'public.auteurs_des_ouvertures'::regclass$q$, 'OK',
        'true false | id uuid not null = gen_random_uuid(), dossier_id uuid not null, acces_id uuid not null, trace_id uuid not null, auteur_id uuid not null, atteste_le timestamp with time zone not null = now() | VIDE'),
      (34, 'proprietaire', '34. … ses contraintes : le dossier en cascade, une attestation par arrivée, aucune clé vers l''accès, la trace ni le compte', null,
        $q$select string_agg(c.conname || ' ' || pg_get_constraintdef(c.oid), ' ; ' order by c.conname) from pg_constraint c
  where c.conrelid = 'public.auteurs_des_ouvertures'::regclass$q$, 'OK',
        'auteurs_des_ouvertures_dossier_id_fkey FOREIGN KEY (dossier_id) REFERENCES dossiers(id) ON DELETE CASCADE ; auteurs_des_ouvertures_pkey PRIMARY KEY (id) ; auteurs_des_ouvertures_trace UNIQUE (trace_id) | VIDE'),
      (35, 'proprietaire', '35. … ses deux policies, à authenticated seul : la lecture du cabinet du dossier, l''insertion du super-administrateur', null,
        $q$select string_agg(p.policyname || ' ' || p.cmd || ' ' || array_to_string(p.roles, ',') || ' ' || coalesce(p.qual, '-') || ' '
  || coalesce(p.with_check, '-') || ' ' || p.permissive, ' ; ' order by p.policyname) from pg_policies p
  where p.schemaname = 'public' and p.tablename = 'auteurs_des_ouvertures'
    and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')$q$, 'OK',
        'auteurs_des_ouvertures_lecture SELECT authenticated admin_du_dossier(dossier_id) - PERMISSIVE ; auteurs_des_ouvertures_restauration INSERT authenticated - is_super_admin() PERMISSIVE | VIDE'),
      (36, 'proprietaire', '36. … ses deux fonctions : la garde aux droits de l''appelant, l''attestation aux droits du propriétaire, leur chemin vide, l''attestation au seul authenticated, leurs corps à leur empreinte', null,
        $q$select string_agg(p.proname || ' ' || p.prosecdef || ' ' || coalesce(array_to_string(p.proconfig, ','), '-') || ' '
  || has_function_privilege('anon', p.oid, 'execute') || ' ' || has_function_privilege('authenticated', p.oid, 'execute') || ' '
  || exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0 and x.privilege_type = 'EXECUTE')
  || ' ' || md5(replace(p.prosrc, chr(13), '')), ' ; ' order by p.proname) from pg_proc p
  where p.oid in (to_regprocedure('public.garder_auteurs_des_ouvertures()'), to_regprocedure('public.attester_ouverture_d_acces(uuid, uuid)'))$q$, 'OK',
        'attester_ouverture_d_acces true search_path="" false true false 3a43ddacb2e7c663397dd1f61cb5194d ; garder_auteurs_des_ouvertures false search_path="" false false false 6298dbb265626e86de5557a504011851 | VIDE'),
      (37, 'proprietaire', '37. … sa garde, seul déclencheur, active ; la garde de la trace inchangée', null,
        $q$select string_agg(pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text, ' ; ' order by t.tgname) || ' | '
  || (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.garder_trace_des_droits()'))
  from pg_trigger t where t.tgrelid = 'public.auteurs_des_ouvertures'::regclass and not t.tgisinternal$q$, 'OK',
        'CREATE TRIGGER auteurs_des_ouvertures_garde BEFORE INSERT OR DELETE OR UPDATE ON public.auteurs_des_ouvertures FOR EACH ROW EXECUTE FUNCTION garder_auteurs_des_ouvertures() O | a63a4b732282845e7cb30e3ce2dd763d | VIDE')
    ) as t(rang, profil, etape, avant, requete, code, attendu) order by rang loop
      v_obs := null;
      v_code := 'OK';
      v_msg := '';
      v_apres := null;
      begin
        -- La place du profil dans le cabinet, posée par le propriétaire le temps de l'étape.
        perform set_config('request.jwt.claims', '', true);
        if e.profil = 'chef_simple' then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client::uuid, cabinet, 'comptable_en_chef');
        elsif e.profil in ('membre', 'membre_ailleurs') then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client::uuid, cabinet, 'comptable');
          insert into dossier_assignations (dossier_id, user_id)
            values (case when e.profil = 'membre' then dt else du end::uuid, client::uuid);
        end if;
        if e.avant is not null then
          v_req := case when e.avant = 'OUVRIR_A' then ouvrir_a when e.avant = 'OUVRIR_N' then ouvrir_n
                        when e.avant like 'ANCIENNE:%' then replace(ancienne, '{AGE}', substr(e.avant, 10))
                        when e.avant = 'ATTESTEE' then ouvrir_a || '; ' || $p$select set_config('request.jwt.claims', json_build_object('sub', '{CHEF}', 'role', 'authenticated')::text, true);
    select attester_ouverture_d_acces('{DT}', '{A}')$p$
                        else e.avant end;
          execute replace(replace(replace(replace(replace(replace(v_req, '{DT}', dt), '{DU}', du), '{A}', acces_a), '{N}', acces_n),
            '{CHEF}', chef), '{CLIENT}', client);
          perform set_config('request.jwt.claims', '', true);
        end if;
        v_req := case e.requete when 'ECRIRE' then ecrire when 'REECRIRE' then reecrire when 'LIRE' then lire
                   when 'ATTESTER_A' then attester_a when 'ATTESTER_N' then attester_n else e.requete end;
        v_req := replace(replace(replace(replace(replace(replace(v_req, '{DT}', dt), '{DU}', du), '{A}', acces_a), '{N}', acces_n),
          '{CHEF}', chef), '{CLIENT}', client);
        begin
          if e.profil = 'anon' then
            execute 'set local role anon';
            perform set_config('request.jwt.claims', '{"role":"anon"}', true);
          elsif e.profil = 'service' then
            execute 'set local role service_role';
            perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
          elsif e.profil <> 'proprietaire' then
            execute 'set local role authenticated';
            perform set_config('request.jwt.claims',
              json_build_object('sub', case e.profil when 'chef' then chef else client end, 'role', 'authenticated')::text, true);
          end if;
          execute v_req into v_obs;
          set constraints all immediate;
          set constraints all deferred;
          reset role;
          v_msg := coalesce(v_obs, '');
        exception when others then
          reset role;
          v_code := sqlstate;
          v_msg := sqlerrm;
        end;
        reset role;
        perform set_config('request.jwt.claims', '', true);
        execute replace(replace(replace(replace(replace(replace(resume, '{DT}', dt), '{DU}', du), '{A}', acces_a), '{N}', acces_n),
          '{CHEF}', chef), '{CLIENT}', client) into v_apres;
        raise exception 'ANNULATION_ETAPE';
      exception when others then
        if sqlerrm <> 'ANNULATION_ETAPE' then
          v_code := 'ESSAI';
          v_msg := sqlstate || ' ' || sqlerrm;
        end if;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      verdicts := verdicts || jsonb_build_object('rang', e.rang, 'etape', e.etape,
        'ok', v_code = e.code and v_msg || ' | ' || coalesce(v_apres, '-')
          = case e.attendu when 'GARDE' then refus_garde || ' | A sans session / rien d''attesté'
                           when 'REECRITURE' then refus_reecriture || ' | ' || ligne_attestee
                           else replace(replace(replace(replace(e.attendu, 'LIGNE', ligne_attestee), 'DROIT', refus_droit),
                                        'ARRIVEE', refus_arrivee), 'VIDE', 'aucune arrivée / rien d''attesté') end,
        'observe', v_code || ' ' || v_msg || ' | ' || coalesce(v_apres, '-'));
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  -- Rien n'est resté : ni les deux dossiers, ni leurs accès, ni leur trace, ni leurs attestations, ni le compte d'essai dans le cabinet.
  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni leurs accès, ni leur trace, ni leurs attestations, ni le compte d''essai dans le cabinet',
    'ok', not exists (select 1 from dossiers where id in (dt::uuid, du::uuid))
      and not exists (select 1 from memberships where id in (acces_a::uuid, acces_n::uuid))
      and not exists (select 1 from trace_des_droits where dossier_id in (dt::uuid, du::uuid))
      and not exists (select 1 from auteurs_des_ouvertures where dossier_id in (dt::uuid, du::uuid))
      and not exists (select 1 from cabinet_admins where user_id::text = client)
      and not exists (select 1 from dossier_assignations where user_id::text = client),
    'observe', 'relu');
  perform set_config('essai.auteur_des_ouvertures', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.auteur_des_ouvertures')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
