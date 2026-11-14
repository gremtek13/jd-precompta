-- QUI A ÉCRIT LA CONNEXION À LA PLATEFORME DU CLIENT (B4RS-Q1 ; la migration `auteur_des_connexions_plateformes`, PRÉPARÉE,
-- supabase/preparees/20261113201000_auteur_des_connexions_plateformes.sql). Le récit : HISTORIQUE.md, « 13/11/2026 —
-- B4RS-Q1, P1T-Q2 ET RET-Q2 ». À rejouer après toute migration qui touche `connexions_plateformes`, sa garde,
-- `attester_connexion_plateforme` ou `admin_du_dossier`.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - une connexion écrite comme l'Edge Function l'écrit (la clé secrète, sans session) n'a pas d'auteur, et ne peut pas en
--     porter un (42501) ; personne ne pose l'auteur en direct, ni le rôle des Edge Functions, ni le propriétaire ;
--   - `attester_connexion_plateforme` : le cabinet du dossier (le chef super-administrateur, le membre affecté) attribue la
--     configuration à son compte, à SA version ; un membre d'un autre dossier, le client du dossier (qui porte « Ventes » et
--     écrit la connexion par l'Edge Function, EC-Q4), le rôle des Edge Functions sans session et l'anonyme sont refusés
--     (42501), une version périmée aussi (22023), sans rien attribuer ;
--   - une écriture de la configuration (une adresse, le secret) efface l'auteur ; le point de reprise, ou la même
--     configuration réenregistrée, le laissent ; la version d'une écriture est celle de la base : deux écritures qui en
--     proposent une même en reçoivent deux, et l'attestation de la première ne vise pas la seconde (13b) ;
--   - le client ne lit ni n'écrit la table (aucune policy) ; le réglage de l'attestation est remis à vide ;
--   - le catalogue : les deux colonnes et leur contrainte, la garde et l'attestation (leurs droits, leurs corps à leur
--     empreinte), le seul déclencheur de la table.
--
-- Deux dossiers jetables du cabinet du dossier `test` (préfixe `b4a50000-0000-4000-8013`), une connexion sur le premier,
-- posée comme l'Edge Function la pose ; l'accès « Ventes » du client d'essai sur lui. LE MEMBRE D'ESSAI est le compte client
-- du jeu, rattaché au cabinet le temps d'une étape — le patron de `traceDesDroits.sql`. Chaque étape se joue dans sa
-- sous-transaction et s'y ANNULE (`ANNULATION_ETAPE`) ; le jeu lui-même s'annule à la fin (`ANNULATION_ESSAI_GLOBALE`), et
-- « rien n'est resté » le relit. Les verdicts voyagent dans un réglage LOCAL à la transaction (`essai.auteur_des_connexions`),
-- que la requête finale lit : le fichier se joue d'un seul appel, ne crée ni table ni fonction, ne contient aucune
-- instruction de suppression, et ne rend rien qui dépende d'une ligne hors de ses dossiers. Hors de l'outil d'exécution, il
-- se joue en UNE transaction (`psql -1`). Sans la migration, une ligne dit qu'il attend (EN ATTENTE) et rien ne s'écrit.
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  dt constant text := 'b4a50000-0000-4000-8013-0000000000d1';
  du constant text := 'b4a50000-0000-4000-8013-0000000000d2';
  acces_v constant text := 'b4a50000-0000-4000-8013-0000000000a1';
  version constant text := '2026-10-01 08:00:00+00';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  verdicts jsonb := '[]'::jsonb;
  e record;
  v_obs text;
  v_code text;
  v_msg text;
  v_apres text;
  v_req text;
  -- L'auteur de la connexion du premier dossier, relu par le propriétaire.
  auteur constant text := $r$select coalesce((select case when c.ecrite_par is null then 'sans auteur'
      when c.ecrite_par::text = '{CHEF}' then 'écrite par le chef' when c.ecrite_par::text = '{CLIENT}' then 'écrite par le compte d''essai'
      else 'écrite par un autre' end || case when (c.ecrite_par is null) = (c.ecrite_le is null) then '' else ' (incohérente)' end
    from connexions_plateformes c where c.dossier_id = '{DT}'), 'aucune connexion')$r$;
  attester constant text := $q$select case when attester_connexion_plateforme('{DT}', '{VERSION}') is not null then 'attestée' end$q$;
  -- Le chef atteste d'abord : l'état que les étapes 10 à 16 réécrivent.
  atteste_avant constant text := $p$select set_config('request.jwt.claims', json_build_object('sub', '{CHEF}', 'role', 'authenticated')::text, true);
    select attester_connexion_plateforme('{DT}', '{VERSION}')$p$;
  refus_garde constant text := 'L''auteur d''une connexion ne se pose que par attester_connexion_plateforme, sous la session du cabinet.';
begin
  if to_regprocedure('public.attester_connexion_plateforme(uuid, timestamp with time zone)') is null then
    perform set_config('essai.auteur_des_connexions', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration auteur_des_connexions_plateformes', 'ok', true,
      'observe', 'attester_connexion_plateforme absente : rien ne s''écrit'))::text, true);
    return;
  end if;

  verdicts := verdicts || jsonb_build_object('rang', 0, 'etape', '0. les profils : le chef super-administrateur et chef du cabinet, le compte d''essai ni membre ni super-administrateur',
    'ok', exists (select 1 from cabinet_admins where user_id::text = chef and cabinet_id = cabinet and role = 'comptable_en_chef')
      and exists (select 1 from super_admins where user_id::text = chef)
      and not exists (select 1 from cabinet_admins where user_id::text = client)
      and not exists (select 1 from super_admins where user_id::text = client),
    'observe', 'lus');

  begin
    -- Le jeu : deux dossiers jetables, exonérés et basculés (la garde de « Ventes » admet l'accès) ; l'accès « Ventes » du
    -- client d'essai au premier ; sa connexion, posée par le propriétaire comme l'Edge Function la pose (sans session).
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, statut_tva, ventes_par_les_factures) values
      (dt::uuid, 'ESSAI AUTEUR DES CONNEXIONS DT', cabinet, 'tresorerie', '455000', 'exonere', true),
      (du::uuid, 'ESSAI AUTEUR DES CONNEXIONS DU', cabinet, 'tresorerie', '455000', 'exonere', true);
    insert into memberships (id, user_id, dossier_id, role, email, droit_ventes) values
      (acces_v::uuid, client::uuid, dt::uuid, 'client', 'essai-auteur-v@example.test', true);
    insert into connexions_plateformes (dossier_id, nom, url_flux, url_jeton, client_id, client_secret, created_by, created_at, updated_at)
    values (dt::uuid, 'Plateforme fictive', 'https://pa.plateforme-fictive.fr/afnor', 'https://pa.plateforme-fictive.fr/oauth/token',
            'client-essai', 'secret-essai', client::uuid, version::timestamptz, version::timestamptz);

    -- Une étape : {rang, profil — `chef` (super-administrateur), `membre` (affecté à DT), `membre_ailleurs` (affecté à DU
    -- seul), `client`, `service` (le rôle des Edge Functions, sans session), `anon`, ou `proprietaire` (sans session) —,
    -- étape, ce que le propriétaire pose d'abord, la requête du profil, ce que le propriétaire relit après (`R` : l'auteur),
    -- le code attendu (`OK` : acceptée), ce qui est attendu : « la valeur rendue | ce qui est relu »}.
    for e in select * from (values
      (1, 'proprietaire', '1. la connexion posée comme l''Edge Function la pose : sans auteur', null, $q$select 'posée'$q$, 'R', 'OK', 'posée | sans auteur'),
      (2, 'service', '2. le rôle des Edge Functions insère une connexion qui porterait un auteur : refusée (42501)', null,
        $q$insert into connexions_plateformes (dossier_id, nom, url_flux, url_jeton, client_id, client_secret, ecrite_par, ecrite_le)
  values ('{DU}', 'Autre', 'https://pa.plateforme-fictive.fr/afnor', 'https://pa.plateforme-fictive.fr/oauth/token', 'c', 's', '{CHEF}', now())
  returning 'insérée'$q$, 'R', '42501', 'GARDE'),
      (3, 'chef', '3. le chef (super-administrateur) atteste la configuration à sa version : elle est à lui', null, 'ATTESTER', 'R', 'OK',
        'attestée | écrite par le chef'),
      (4, 'membre', '4. le membre affecté au dossier l''atteste : elle est à lui', null, 'ATTESTER', 'R', 'OK',
        'attestée | écrite par le compte d''essai'),
      (5, 'membre_ailleurs', '5. un membre affecté à un AUTRE dossier : refusé (42501), rien d''attribué', null, 'ATTESTER', 'R', '42501',
        'Accès refusé à ce dossier. | sans auteur'),
      (6, 'client', '6. le client du dossier, qui porte « Ventes » (il écrit la connexion par l''Edge Function, EC-Q4) : refusé (42501)', null,
        'ATTESTER', 'R', '42501', 'Accès refusé à ce dossier. | sans auteur'),
      (7, 'anon', '7. l''anonyme n''exécute pas l''attestation', null, 'ATTESTER', 'R', '42501',
        'permission denied for function attester_connexion_plateforme | sans auteur'),
      (8, 'service', '8. le rôle des Edge Functions, sans session : refusé (42501)', null, 'ATTESTER', 'R', '42501',
        'Accès refusé à ce dossier. | sans auteur'),
      (9, 'chef', '9. le chef, sur une version périmée : refusé (22023), rien d''attribué', null,
        $q$select attester_connexion_plateforme('{DT}', '2026-10-02 08:00:00+00')::text$q$, 'R', '22023',
        'La connexion à la plateforme a changé entre-temps, ou a été retirée : l''enregistrer de nouveau. | sans auteur'),
      (10, 'service', '10. l''Edge Function réécrit une adresse (un accès « Ventes » qui enregistre) : l''auteur s''efface', 'ATTESTE_AVANT',
        $q$with c as (update connexions_plateformes set url_flux = 'https://autre.plateforme-fictive.fr/afnor', updated_at = now()
  where dossier_id = '{DT}' returning 1) select count(*)::text from c$q$, 'R', 'OK', '1 | sans auteur'),
      (11, 'service', '11. … le secret seul : l''auteur s''efface aussi', 'ATTESTE_AVANT',
        $q$with c as (update connexions_plateformes set client_secret = 'autre-secret', updated_at = now()
  where dossier_id = '{DT}' returning 1) select count(*)::text from c$q$, 'R', 'OK', '1 | sans auteur'),
      (12, 'service', '12. le point de reprise et la dernière récupération : l''auteur reste', 'ATTESTE_AVANT',
        $q$with c as (update connexions_plateformes set recherche_depuis = now(), derniere_recuperation = now()
  where dossier_id = '{DT}' returning 1) select count(*)::text from c$q$, 'R', 'OK', '1 | écrite par le chef'),
      (13, 'service', '13. la même configuration réenregistrée (seule la version change) : l''auteur reste', 'ATTESTE_AVANT',
        $q$with c as (update connexions_plateformes set nom = 'Plateforme fictive', url_flux = 'https://pa.plateforme-fictive.fr/afnor',
  client_secret = 'secret-essai', updated_at = now() where dossier_id = '{DT}' returning 1) select count(*)::text from c$q$, 'R', 'OK',
        '1 | écrite par le chef'),
      -- La version d'une configuration écrite est celle de la base (relecture du 14/11/2026) : deux écritures qui proposent la
      -- même — la milliseconde de l'Edge Function — en reçoivent deux, et l'attestation à la version que la base a rendue à
      -- la première ne vise pas la seconde.
      (13, 'chef', '13b. deux écritures de la configuration proposent la même version : la seconde en reçoit une autre, et l''attestation à la version de la première se refuse (22023), sans rien attribuer',
        $p$with c as (update connexions_plateformes set url_flux = 'https://autre.plateforme-fictive.fr/afnor',
    updated_at = '2026-10-03 08:00:00.123+00' where dossier_id = '{DT}' returning updated_at)
  select set_config('essai.version_de_la_premiere', c.updated_at::text, true) from c;
  update connexions_plateformes set url_flux = 'https://tierce.plateforme-fictive.fr/afnor', updated_at = '2026-10-03 08:00:00.123+00'
   where dossier_id = '{DT}'$p$,
        $q$select attester_connexion_plateforme('{DT}', current_setting('essai.version_de_la_premiere')::timestamptz)::text$q$, 'R', '22023',
        'La connexion à la plateforme a changé entre-temps, ou a été retirée : l''enregistrer de nouveau. | sans auteur'),
      (14, 'service', '14. le rôle des Edge Functions pose l''auteur en direct : refusé (42501)', null,
        $q$with c as (update connexions_plateformes set ecrite_par = '{CHEF}', ecrite_le = now() where dossier_id = '{DT}' returning 1)
  select count(*)::text from c$q$, 'R', '42501', 'GARDE'),
      (15, 'proprietaire', '15. le propriétaire non plus', null,
        $q$with c as (update connexions_plateformes set ecrite_par = '{CHEF}', ecrite_le = now() where dossier_id = '{DT}' returning 1)
  select count(*)::text from c$q$, 'R', '42501', 'GARDE'),
      (16, 'service', '16. … ni ne l''efface en direct', 'ATTESTE_AVANT',
        $q$with c as (update connexions_plateformes set ecrite_par = null, ecrite_le = null where dossier_id = '{DT}' returning 1)
  select count(*)::text from c$q$, 'R', '42501', 'GARDE_ATTESTEE'),
      (17, 'client', '17. le client ne lit pas la table (aucune policy) : ni le secret, ni l''auteur', 'ATTESTE_AVANT',
        $q$select count(*)::text from connexions_plateformes where dossier_id = '{DT}'$q$, 'R', 'OK', '0 | écrite par le chef'),
      (18, 'client', '18. … ni ne l''écrit : aucune ligne touchée', null,
        $q$with c as (update connexions_plateformes set url_flux = 'https://autre.plateforme-fictive.fr/afnor' where dossier_id = '{DT}' returning 1)
  select count(*)::text from c$q$, 'R', 'OK', '0 | sans auteur'),
      (19, 'chef', '19. le réglage de l''attestation est remis à vide après l''écriture', null,
        $q$select attester_connexion_plateforme('{DT}', '{VERSION}'); select coalesce(nullif(current_setting('jd.auteur_de_la_connexion', true), ''), 'vide')$q$,
        'R', 'OK', 'vide | écrite par le chef'),
      (20, 'proprietaire', '20. le catalogue : les deux colonnes et leur contrainte', null,
        $q$select (select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then ' not null' else '' end, ', ' order by a.attname)
  from pg_attribute a where a.attrelid = 'public.connexions_plateformes'::regclass and a.attname in ('ecrite_par', 'ecrite_le') and not a.attisdropped)
  || ' ; ' || (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = 'public.connexions_plateformes'::regclass and c.conname = 'connexions_plateformes_auteur')
  || ' ; policies ' || (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'connexions_plateformes'
       and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE'))$q$, null, 'OK',
        'ecrite_le timestamp with time zone, ecrite_par uuid ; CHECK (((ecrite_par IS NULL) = (ecrite_le IS NULL))) ; policies 0 | -'),
      (21, 'proprietaire', '21. … la garde aux droits de l''appelant, l''attestation aux droits du propriétaire, leur chemin vide, leurs droits, leurs corps à leur empreinte', null,
        $q$select string_agg(p.proname || ' ' || p.prosecdef || ' ' || coalesce(array_to_string(p.proconfig, ','), '-') || ' '
  || has_function_privilege('anon', p.oid, 'execute') || ' ' || has_function_privilege('authenticated', p.oid, 'execute') || ' '
  || exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0 and x.privilege_type = 'EXECUTE')
  || ' ' || md5(replace(p.prosrc, chr(13), '')), ' ; ' order by p.proname) from pg_proc p
  where p.oid in (to_regprocedure('public.garder_auteur_de_la_connexion()'), to_regprocedure('public.attester_connexion_plateforme(uuid, timestamp with time zone)'))$q$,
        null, 'OK',
        'attester_connexion_plateforme true search_path="" false true false 2b23f498dfbb3e921ac6c6ed5acb0fcc ; garder_auteur_de_la_connexion false search_path="" false false false e48b49003974ed54b9c758d1154ec5ce | -'),
      (22, 'proprietaire', '22. … son déclencheur, le seul de la table, actif', null,
        $q$select string_agg(pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text, ' ; ' order by t.tgname) from pg_trigger t
  where t.tgrelid = 'public.connexions_plateformes'::regclass and not t.tgisinternal$q$, null, 'OK',
        'CREATE TRIGGER connexions_plateformes_auteur BEFORE INSERT OR UPDATE ON public.connexions_plateformes FOR EACH ROW EXECUTE FUNCTION garder_auteur_de_la_connexion() O | -')
    ) as t(rang, profil, etape, avant, requete, apres, code, attendu) order by rang loop
      v_obs := null;
      v_code := 'OK';
      v_msg := '';
      v_apres := null;
      begin
        perform set_config('request.jwt.claims', '', true);
        if e.profil in ('membre', 'membre_ailleurs') then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client::uuid, cabinet, 'comptable');
          insert into dossier_assignations (dossier_id, user_id)
            values (case when e.profil = 'membre' then dt else du end::uuid, client::uuid);
        end if;
        if e.avant is not null then
          v_req := case e.avant when 'ATTESTE_AVANT' then atteste_avant else e.avant end;
          execute replace(replace(replace(replace(replace(v_req, '{DT}', dt), '{DU}', du), '{CHEF}', chef), '{CLIENT}', client), '{VERSION}', version);
          perform set_config('request.jwt.claims', '', true);
        end if;
        v_req := case e.requete when 'ATTESTER' then attester else e.requete end;
        v_req := replace(replace(replace(replace(replace(v_req, '{DT}', dt), '{DU}', du), '{CHEF}', chef), '{CLIENT}', client), '{VERSION}', version);
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
          execute replace(replace(replace(auteur, '{DT}', dt), '{CHEF}', chef), '{CLIENT}', client) into v_apres;
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
          = case e.attendu when 'GARDE' then refus_garde || ' | sans auteur'
                           when 'GARDE_ATTESTEE' then refus_garde || ' | écrite par le chef'
                           else e.attendu end,
        'observe', v_code || ' ' || v_msg || ' | ' || coalesce(v_apres, '-'));
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  -- Rien n'est resté : ni les deux dossiers, ni l'accès, ni la connexion, ni le compte d'essai dans le cabinet.
  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni l''accès, ni la connexion, ni le compte d''essai dans le cabinet',
    'ok', not exists (select 1 from dossiers where id in (dt::uuid, du::uuid))
      and not exists (select 1 from memberships where id = acces_v::uuid)
      and not exists (select 1 from connexions_plateformes where dossier_id in (dt::uuid, du::uuid))
      and not exists (select 1 from cabinet_admins where user_id::text = client)
      and not exists (select 1 from dossier_assignations where user_id::text = client),
    'observe', 'relu');
  perform set_config('essai.auteur_des_connexions', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.auteur_des_connexions')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
