-- L'ADRESSE D'UN ACCÈS RETIRÉ, GARDÉE AVEC LA TRACE DES DROITS (espace client, ligne 51.5, décision du cabinet P1T-E2 ; la
-- migration `adresse_des_acces_retires`, PRÉPARÉE : supabase/preparees/20261111173000_adresse_des_acces_retires.sql). Le
-- récit : HISTORIQUE.md, « 11/11/2026 — P1T-E2 : L'ADRESSE D'UN ACCÈS RETIRÉ, GARDÉE AVEC LA TRACE (PRÉPARÉE, PAS
-- APPLIQUÉE) ». À rejouer par `execute_sql` après toute migration qui touche `memberships`, ses déclencheurs,
-- `trace_des_droits`, `adresses_des_acces_retires` ou leurs fonctions. Le retrait d'un accès et la suppression d'un dossier
-- se jouent à part, sur une réplique : `adresseDesAccesRetiresSuppression.sql`.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - un accès que la trace nomme, emporté vers un autre dossier ou sous un autre identifiant, laisse son adresse au
--     dossier qu'il quitte, à l'instant du départ ; un accès que la trace ne nomme pas, ou sans adresse, ne laisse rien ; un
--     accès qui reste — une case, son compte, son adresse changés — n'écrit rien ;
--   - la restauration réinsère une adresse telle que la sauvegarde la porte (le super-administrateur) ;
--   - personne n'écrit la table en direct — ni le client, ni le membre, ni un chef qui n'est pas super-administrateur, ni le
--     rôle des Edge Functions, ni le propriétaire, ni l'anonyme : la garde, AVANT la RLS — ; personne ne la réécrit ; le
--     cabinet du dossier la lit, ni un membre d'ailleurs, ni le client, ni l'anonyme ;
--   - le catalogue : la table, ses contraintes, ses deux policies, ses deux fonctions et leurs déclencheurs, le sien APRÈS
--     celui de la trace sur `memberships`.
--
-- Deux dossiers jetables du cabinet du dossier `test` (préfixe `b1d70000-0000-4000-8025`), exonérés et basculés, chacun avec
-- un accès sans droit du client d'essai (inséré comme `create-client-access` l'insère) ; un accès d'essai donné au compte du
-- chef, le temps d'une étape. LE CHEF QUI N'EST PAS SUPER-ADMINISTRATEUR ET LES MEMBRES D'ESSAI sont le compte client du jeu,
-- rattaché au cabinet le temps d'une étape — le patron de `traceDesDroits.sql`. Chaque étape se joue dans sa
-- sous-transaction et s'y ANNULE (`ANNULATION_ETAPE`), le jeu à la fin (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté »
-- le relit. Les verdicts voyagent dans un réglage LOCAL (`essai.adresse_des_acces_retires`) : le fichier se joue d'un seul
-- appel, ne crée ni table ni fonction, ne contient aucune instruction de suppression, et ne rend rien qui dépende d'une
-- ligne hors de ses dossiers. Hors de l'outil d'exécution, en UNE transaction (`psql -1`). Sans la migration, une ligne dit
-- qu'il attend (EN ATTENTE) et rien ne s'écrit.
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  dt constant text := 'b1d70000-0000-4000-8025-0000000000d1';
  du constant text := 'b1d70000-0000-4000-8025-0000000000d2';
  acces_a constant text := 'b1d70000-0000-4000-8025-0000000000a1';
  acces_b constant text := 'b1d70000-0000-4000-8025-0000000000b1';
  acces_n constant text := 'b1d70000-0000-4000-8025-0000000000c1';
  acces_x constant text := 'b1d70000-0000-4000-8025-0000000000c2';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  verdicts jsonb := '[]'::jsonb;
  e record;
  v_obs text;
  v_code text;
  v_msg text;
  v_apres text;
  v_req text;
  -- Ce que la table dit des deux dossiers, relu par le propriétaire : le dossier, l'accès, l'adresse, et le jour quand ce
  -- n'est pas l'instant de l'étape.
  resume constant text := $r$select coalesce(string_agg(
      case r.dossier_id::text when '{DT}' then 'DT' when '{DU}' then 'DU' else '?' end
      || ' ' || case r.acces_id::text when '{A}' then 'A' when '{B}' then 'B' when '{N}' then 'N' when '{X}' then 'X' else '?' end
      || ' ' || r.adresse
      || case when r.retire_le = now() then '' else ' le ' || to_char(r.retire_le at time zone 'UTC', 'YYYY-MM-DD') end,
      ', ' order by r.dossier_id, r.acces_id, r.retire_le), 'rien')
    from adresses_des_acces_retires r where r.dossier_id in ('{DT}', '{DU}')$r$;
  -- L'accès du compte du chef, réinséré par le super-administrateur (la porte de la restauration : rien de tracé), avec ou
  -- sans case, avec ou sans adresse.
  pose_n constant text := $p$select set_config('request.jwt.claims', json_build_object('sub', '{CHEF}', 'role', 'authenticated')::text, true);
    insert into memberships (id, user_id, dossier_id, role, email, droit_banque)
    values ('{N}', '{CHEF}', '{DT}', 'client', 'essai-adresse-n@example.test', true)$p$;
  pose_n_sans_case constant text := $p$select set_config('request.jwt.claims', json_build_object('sub', '{CHEF}', 'role', 'authenticated')::text, true);
    insert into memberships (id, user_id, dossier_id, role, email)
    values ('{N}', '{CHEF}', '{DT}', 'client', 'essai-adresse-n@example.test')$p$;
  pose_n_sans_adresse constant text := $p$select set_config('request.jwt.claims', json_build_object('sub', '{CHEF}', 'role', 'authenticated')::text, true);
    insert into memberships (id, user_id, dossier_id, role, email, droit_banque)
    values ('{N}', '{CHEF}', '{DT}', 'client', null, true)$p$;
  -- Une case de l'accès A changée par le propriétaire : la trace le nomme dans DT.
  trace_a constant text := $p$update memberships set droit_banque = true where id = '{A}' and not droit_banque$p$;
  -- L'accès N emporté vers DU : il part de DT.
  emporter_n constant text := $q$with m as (update memberships set dossier_id = '{DU}' where id = '{N}' returning 1) select count(*)::text from m$q$;
  -- Une adresse réinsérée par la restauration : la ligne que les étapes 17 à 24 réécrivent ou lisent.
  une_ligne constant text := $p$select set_config('request.jwt.claims', json_build_object('sub', '{CHEF}', 'role', 'authenticated')::text, true);
    insert into adresses_des_acces_retires (id, dossier_id, acces_id, adresse, retire_le)
    values ('b1d70000-0000-4000-8025-0000000000e1', '{DT}', '{A}', 'essai-adresse-a@example.test', '2026-10-01 10:00:00+00')$p$;
  ecrire constant text := $q$insert into adresses_des_acces_retires (dossier_id, acces_id, adresse)
    values ('{DT}', '{A}', 'essai-adresse-a@example.test') returning 'insérée'$q$;
  reecrire constant text := $q$with r as (update adresses_des_acces_retires set adresse = 'autre@example.test' where dossier_id = '{DT}' returning 1)
    select count(*)::text from r$q$;
  lire constant text := $q$select count(*)::text from adresses_des_acces_retires where dossier_id = '{DT}'$q$;
  ligne_lue constant text := 'DT A essai-adresse-a@example.test le 2026-10-01';
  refus_garde constant text := 'L''adresse d''un accès retiré ne s''écrit que par le retrait de l''accès.';
  refus_reecriture constant text := 'L''adresse d''un accès retiré ne se réécrit pas : elle ne part qu''avec son dossier.';
  -- Les déclencheurs de memberships : ceux de P1-trace et de la caisse, et celui-ci, rangé après celui de la trace.
  declencheurs constant text := 'memberships_droit_caisse, memberships_droit_ventes, memberships_trace_des_droits, memberships_trace_des_droits_adresse';
begin
  if to_regclass('public.adresses_des_acces_retires') is null then
    perform set_config('essai.adresse_des_acces_retires', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration adresse_des_acces_retires', 'ok', true,
      'observe', 'la table adresses_des_acces_retires absente : rien ne s''écrit'))::text, true);
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
    -- Le jeu : deux dossiers jetables, exonérés et basculés ; un accès sans droit du client d'essai à chacun, inséré par le
    -- propriétaire comme `create-client-access` l'insère.
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, statut_tva, ventes_par_les_factures) values
      (dt::uuid, 'ESSAI ADRESSE DES ACCES RETIRES DT', cabinet, 'tresorerie', '455000', 'exonere', true),
      (du::uuid, 'ESSAI ADRESSE DES ACCES RETIRES DU', cabinet, 'tresorerie', '455000', 'exonere', true);
    insert into memberships (id, user_id, dossier_id, role, email) values
      (acces_a::uuid, client::uuid, dt::uuid, 'client', 'essai-adresse-a@example.test'),
      (acces_b::uuid, client::uuid, du::uuid, 'client', 'essai-adresse-b@example.test');

    -- Une étape : {rang, profil — `chef` (super-administrateur), `chef_simple` (un chef qui ne l'est pas), `membre` (affecté
    -- à DT), `membre_ailleurs` (affecté à DU seul), `client`, `service` (le rôle des Edge Functions), `anon`, ou
    -- `proprietaire` (sans session) —, étape, ce que le propriétaire pose d'abord, la requête du profil, ce que le
    -- propriétaire relit après (`R` : les adresses des deux dossiers), le code attendu (`OK` : acceptée), ce qui est
    -- attendu : « la valeur rendue | ce qui est relu »}.
    for e in select * from (values
      (1, 'proprietaire', '1. le jeu posé : deux accès sans droit — rien de retenu', null, $q$select 'posé'$q$, 'R', 'OK', 'posé | rien'),
      (2, 'proprietaire', '2. un accès qui porte « Banque », emporté vers un autre dossier : son adresse reste au dossier qu''il quitte, à l''instant du départ',
        'POSE_N', 'EMPORTER_N', 'R', 'OK', '1 | DT N essai-adresse-n@example.test'),
      (3, 'service', '3. … par le rôle des Edge Functions aussi', 'POSE_N', 'EMPORTER_N', 'R', 'OK', '1 | DT N essai-adresse-n@example.test'),
      (4, 'proprietaire', '4. un accès que la trace ne nomme pas (aucune case, rien de tracé) emporté : rien de retenu', 'POSE_N_SANS_CASE', 'EMPORTER_N', 'R', 'OK', '1 | rien'),
      (5, 'proprietaire', '5. un accès tracé sans adresse emporté : rien de retenu', 'POSE_N_SANS_ADRESSE', 'EMPORTER_N', 'R', 'OK', '1 | rien'),
      (6, 'proprietaire', '6. un accès tracé dont l''identifiant change : l''adresse reste sous l''ancien', 'TRACE_A',
        $q$with m as (update memberships set id = '{X}' where id = '{A}' returning 1) select count(*)::text from m$q$, 'R', 'OK',
        '1 | DT A essai-adresse-a@example.test'),
      (7, 'chef', '7. une case cochée par changer_droits_acces : l''accès reste, rien de retenu', null,
        $q$select (changer_droits_acces('{A}', null, true, null)).droit_banque::text$q$, 'R', 'OK', 'true | rien'),
      (8, 'proprietaire', '8. le compte d''un accès tracé changé : l''accès reste dans le dossier, rien de retenu', 'TRACE_A',
        $q$with m as (update memberships set user_id = '{CHEF}' where id = '{A}' returning 1) select count(*)::text from m$q$, 'R', 'OK', '1 | rien'),
      (9, 'proprietaire', '9. l''adresse d''un accès tracé changée : rien de retenu', 'TRACE_A',
        $q$with m as (update memberships set email = 'essai-adresse-autre@example.test' where id = '{A}' returning 1) select count(*)::text from m$q$,
        'R', 'OK', '1 | rien'),
      (10, 'proprietaire', '10. un accès emporté vers un dossier où la garde de « Caisse » le refuse : refusé (23514), rien de retenu',
        $p$select set_config('request.jwt.claims', json_build_object('sub', '{CHEF}', 'role', 'authenticated')::text, true);
    insert into memberships (id, user_id, dossier_id, role, email, droit_caisse) values ('{N}', '{CHEF}', '{DT}', 'client', 'essai-adresse-n@example.test', true);
    update dossiers set statut_tva = 'redevable' where id = '{DU}'$p$,
        'EMPORTER_N', 'R', '23514',
        'Le droit « Caisse » suppose un dossier exonéré de TVA ou en franchise en base, ce que le statut de ce dossier ne dit pas : sa caisse reste tenue par le cabinet. | rien'),
      (11, 'chef', '11. la restauration : le super-administrateur réinsère une adresse telle que la sauvegarde la porte', null,
        $q$with r as (insert into adresses_des_acces_retires (id, dossier_id, acces_id, adresse, retire_le)
  values ('b1d70000-0000-4000-8025-0000000000e1', '{DT}', '{A}', 'essai-adresse-a@example.test', '2026-10-01 10:00:00+00')
  returning 1) select count(*)::text from r$q$, 'R', 'OK', '1 | LIGNE'),
      (12, 'proprietaire', '12. le réglage que la garde lit est remis à vide après l''écriture', 'POSE_N',
        $q$with m as (update memberships set dossier_id = '{DU}' where id = '{N}' returning 1) select count(*)::text || ' ' || coalesce(nullif(current_setting('jd.adresse_d_un_acces_retire', true), ''), 'vide') from m$q$,
        'R', 'OK', '1 vide | DT N essai-adresse-n@example.test'),
      (13, 'client', '13. le client n''écrit pas la table (la garde, avant la RLS)', null, 'ECRIRE', 'R', '42501', 'GARDE'),
      (14, 'membre', '14. le membre affecté non plus', null, 'ECRIRE', 'R', '42501', 'GARDE'),
      (15, 'chef_simple', '15. un chef qui n''est pas super-administrateur non plus', null, 'ECRIRE', 'R', '42501', 'GARDE'),
      (16, 'service', '16. le rôle des Edge Functions non plus', null, 'ECRIRE', 'R', '42501', 'GARDE'),
      (17, 'proprietaire', '17. le propriétaire non plus', null, 'ECRIRE', 'R', '42501', 'GARDE'),
      (18, 'anon', '18. l''anonyme non plus', null, 'ECRIRE', 'R', '42501', 'GARDE'),
      (19, 'chef', '19. personne ne réécrit une adresse : le chef super-administrateur (aucune policy, aucune ligne touchée)', 'UNE_LIGNE', 'REECRIRE', 'R', 'OK', '0 | LIGNE'),
      (20, 'service', '20. … le rôle des Edge Functions (la garde, 23514)', 'UNE_LIGNE', 'REECRIRE', 'R', '23514', 'REECRITURE'),
      (21, 'proprietaire', '21. … le propriétaire (la garde, 23514)', 'UNE_LIGNE', 'REECRIRE', 'R', '23514', 'REECRITURE'),
      (22, 'chef', '22. le chef lit l''adresse retenue de son dossier', 'UNE_LIGNE', 'LIRE', 'R', 'OK', '1 | LIGNE'),
      (23, 'membre', '23. le membre affecté au dossier la lit', 'UNE_LIGNE', 'LIRE', 'R', 'OK', '1 | LIGNE'),
      (24, 'membre_ailleurs', '24. un membre affecté à un autre dossier n''en lit rien', 'UNE_LIGNE', 'LIRE', 'R', 'OK', '0 | LIGNE'),
      (25, 'client', '25. le client n''en lit rien, pas même de son dossier — il lit son accès', 'UNE_LIGNE',
        $q$select (select count(*) from adresses_des_acces_retires where dossier_id = '{DT}')::text || ' ' || (select count(*) from memberships where id = '{A}')::text$q$,
        'R', 'OK', '0 1 | LIGNE'),
      (26, 'anon', '26. l''anonyme n''en lit rien', 'UNE_LIGNE', 'LIRE', 'R', 'OK', '0 | LIGNE'),
      (27, 'proprietaire', '27. le catalogue : la table, la RLS active et non forcée, ses colonnes', null,
        $q$select c.relrowsecurity || ' ' || c.relforcerowsecurity || ' | ' || (select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
  || case when a.attnotnull then ' not null' else '' end || coalesce(' = ' || pg_get_expr(d.adbin, d.adrelid), ''), ', ' order by a.attnum)
  from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) from pg_class c where c.oid = 'public.adresses_des_acces_retires'::regclass$q$, null, 'OK',
        'true false | id uuid not null = gen_random_uuid(), dossier_id uuid not null, acces_id uuid not null, adresse text not null, retire_le timestamp with time zone not null = now() | -'),
      (28, 'proprietaire', '28. … ses contraintes : le dossier en cascade, aucune clé vers l''accès, une adresse jamais vide', null,
        $q$select string_agg(c.conname || ' ' || pg_get_constraintdef(c.oid), ' ; ' order by c.conname) from pg_constraint c
  where c.conrelid = 'public.adresses_des_acces_retires'::regclass$q$, null, 'OK',
        'adresses_des_acces_retires_adresse CHECK ((btrim(adresse) <> ''''::text)) ; adresses_des_acces_retires_dossier_id_fkey FOREIGN KEY (dossier_id) REFERENCES dossiers(id) ON DELETE CASCADE ; adresses_des_acces_retires_pkey PRIMARY KEY (id) | -'),
      (29, 'proprietaire', '29. … ses deux policies, à authenticated seul : la lecture du cabinet du dossier, l''insertion du super-administrateur', null,
        $q$select string_agg(p.policyname || ' ' || p.cmd || ' ' || array_to_string(p.roles, ',') || ' ' || coalesce(p.qual, '-') || ' '
  || coalesce(p.with_check, '-') || ' ' || p.permissive, ' ; ' order by p.policyname) from pg_policies p
  where p.schemaname = 'public' and p.tablename = 'adresses_des_acces_retires'
    and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')$q$, null, 'OK',
        'adresses_des_acces_retires_lecture SELECT authenticated admin_du_dossier(dossier_id) - PERMISSIVE ; adresses_des_acces_retires_restauration INSERT authenticated - is_super_admin() PERMISSIVE | -'),
      (30, 'proprietaire', '30. … ses deux fonctions : la garde aux droits de l''appelant, le déclencheur aux droits du propriétaire, leur chemin fixé, aucun rôle de l''API, leurs corps à leur empreinte', null,
        $q$select string_agg(p.proname || ' ' || p.prosecdef || ' ' || coalesce(array_to_string(p.proconfig, ','), '-') || ' '
  || has_function_privilege('anon', p.oid, 'execute') || ' ' || has_function_privilege('authenticated', p.oid, 'execute') || ' '
  || exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0 and x.privilege_type = 'EXECUTE')
  || ' ' || md5(replace(p.prosrc, chr(13), '')), ' ; ' order by p.proname) from pg_proc p
  where p.oid in (to_regprocedure('public.garder_adresses_des_acces_retires()'), to_regprocedure('public.retenir_l_adresse_d_un_acces_retire()'))$q$, null, 'OK',
        'EMPREINTES | -'),
      (31, 'proprietaire', '31. … leurs déclencheurs, actifs ; celui des accès APRÈS celui de la trace', null,
        $q$select string_agg(pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text, ' ; ' order by t.tgname) || ' | '
  || (select string_agg(m.tgname, ', ' order by m.tgname) from pg_trigger m where m.tgrelid = 'public.memberships'::regclass and not m.tgisinternal)
  from pg_trigger t where t.tgname in ('memberships_trace_des_droits_adresse', 'adresses_des_acces_retires_garde') and not t.tgisinternal$q$, null, 'OK',
        'CREATE TRIGGER adresses_des_acces_retires_garde BEFORE INSERT OR DELETE OR UPDATE ON public.adresses_des_acces_retires FOR EACH ROW EXECUTE FUNCTION garder_adresses_des_acces_retires() O ; CREATE TRIGGER memberships_trace_des_droits_adresse AFTER DELETE OR UPDATE OF dossier_id, id ON public.memberships FOR EACH ROW EXECUTE FUNCTION retenir_l_adresse_d_un_acces_retire() O | DECLENCHEURS | -')
    ) as t(rang, profil, etape, avant, requete, apres, code, attendu) order by rang loop
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
          v_req := case e.avant when 'POSE_N' then pose_n when 'POSE_N_SANS_CASE' then pose_n_sans_case
                     when 'POSE_N_SANS_ADRESSE' then pose_n_sans_adresse when 'TRACE_A' then trace_a when 'UNE_LIGNE' then une_ligne
                     else e.avant end;
          execute replace(replace(replace(replace(replace(replace(replace(replace(v_req, '{DT}', dt), '{DU}', du), '{A}', acces_a), '{B}', acces_b),
            '{N}', acces_n), '{X}', acces_x), '{CHEF}', chef), '{CLIENT}', client);
          perform set_config('request.jwt.claims', '', true);
        end if;
        v_req := case e.requete when 'ECRIRE' then ecrire when 'REECRIRE' then reecrire when 'LIRE' then lire
                   when 'EMPORTER_N' then emporter_n else e.requete end;
        v_req := replace(replace(replace(replace(replace(replace(replace(replace(v_req, '{DT}', dt), '{DU}', du), '{A}', acces_a), '{B}', acces_b),
          '{N}', acces_n), '{X}', acces_x), '{CHEF}', chef), '{CLIENT}', client);
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
        if e.apres = 'R' then
          execute replace(replace(replace(replace(replace(replace(replace(replace(resume, '{DT}', dt), '{DU}', du), '{A}', acces_a), '{B}', acces_b),
            '{N}', acces_n), '{X}', acces_x), '{CHEF}', chef), '{CLIENT}', client) into v_apres;
        end if;
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
          = case e.attendu when 'GARDE' then refus_garde || ' | rien'
                           when 'REECRITURE' then refus_reecriture || ' | ' || ligne_lue
                           else replace(replace(replace(e.attendu, 'LIGNE', ligne_lue), 'DECLENCHEURS', declencheurs),
                                        'EMPREINTES', 'garder_adresses_des_acces_retires false search_path=public false false false ac096e5d4a501cd5403639067113cf24 ; retenir_l_adresse_d_un_acces_retire true search_path=public false false false 42d83ab463bace62e8e587480193eb9e') end,
        'observe', v_code || ' ' || v_msg || ' | ' || coalesce(v_apres, '-'));
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  -- Rien n'est resté : ni les deux dossiers, ni leurs accès, ni leurs adresses, ni le compte d'essai dans le cabinet.
  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni leurs accès, ni leur trace, ni leurs adresses, ni le compte d''essai dans le cabinet',
    'ok', not exists (select 1 from dossiers where id in (dt::uuid, du::uuid))
      and not exists (select 1 from memberships where id in (acces_a::uuid, acces_b::uuid, acces_n::uuid, acces_x::uuid))
      and not exists (select 1 from trace_des_droits where dossier_id in (dt::uuid, du::uuid))
      and not exists (select 1 from adresses_des_acces_retires where dossier_id in (dt::uuid, du::uuid))
      and not exists (select 1 from cabinet_admins where user_id::text = client)
      and not exists (select 1 from dossier_assignations where user_id::text = client),
    'observe', 'relu');
  perform set_config('essai.adresse_des_acces_retires', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.adresse_des_acces_retires')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
