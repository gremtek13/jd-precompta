-- LES OPTIONS PAR CABINET (conception 56, lot OPT1 ; la migration `options_des_cabinets`, préparée le 19/11/2026, pas
-- appliquée : supabase/schema/20261119140325_options_des_cabinets.sql). Le récit : HISTORIQUE.md, « 19/11/2026 — OPT1 ET
-- OPT2 : LES OPTIONS PAR CABINET, LE MODULE ET LA MIGRATION (PRÉPARÉE, PAS APPLIQUÉE) ». À rejouer par `execute_sql` après
-- toute migration qui touche `options_des_cabinets`, `regler_option_du_cabinet`, `modules_ouverts_du_dossier`,
-- `garder_plafonds_de_l_assistant`, `cabinets`, `is_super_admin`, `admin_du_cabinet`, `admin_du_dossier` ou
-- `client_du_dossier`.
--
-- Ce qui se prouve ici : le catalogue (la RLS, la seule policy de lecture à l'équipe du cabinet, la clé, la liste fermée,
-- les deux fonctions aux droits du propriétaire, la garde des plafonds aux droits de l'appelant) ; un cabinet neuf n'a que
-- le socle (OPT-Q3 (B)) ; qui lit (l'équipe du cabinet, l'accès client par la fonction seule, jamais la table ; ni un autre
-- dossier, ni l'anonyme) ; qui règle (le super-administrateur seul : ni l'anonyme, ni le client, ni un chef de cabinet, ni
-- un membre de l'équipe) ; les refus de la demande sous leurs mots ; ouvrir les honoraires ouvre la facturation, fermer la
-- facturation sous les honoraires se refuse ; l'extinction gardée de la facturation, qui nomme les dossiers basculés, cinq
-- au plus ; la facture électronique et l'assurance maladie se ferment quand rien n'en dépend ; les plafonds de l'assistant,
-- que le chef ne change plus quand il règle encore le reste de sa ligne ; rien n'est resté.
--
-- Le jeu : un cabinet et ses dossiers que l'essai crée lui-même (les seuls dont il dit des noms), le super-administrateur
-- d'essai, le client d'essai (rattaché à l'équipe du cabinet d'essai, comme chef ou comme membre, le temps d'une étape). Le
-- cabinet du dossier `test` n'est que relu, jamais réglé. Chaque étape se joue dans sa sous-transaction et s'y ANNULE ; le
-- jeu s'annule à la fin, et « rien n'est resté » relit l'écart seul. Les verdicts voyagent dans un réglage LOCAL
-- (`essai.options_des_cabinets`) : le fichier se joue d'un seul appel, ne crée ni table ni fonction, ne contient aucune
-- suppression ni mise à jour sans `where`, et ne rend rien qui dépende d'une ligne hors de son cabinet. Sans la migration,
-- une ligne EN ATTENTE. Les refus d'une extinction sur un envoi en cours ou un paiement associé, qui demandent de poser des
-- lignes sans leurs gardes : optionsDesCabinetsEnCours.sql, sur une réplique seulement.
do $essai$
declare
  super constant uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  dossier_du_client constant uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  c_modules constant text[] := array['tenue', 'facturation', 'facture_electronique', 'assurance_maladie', 'espace_client',
                                     'assistant', 'honoraires', 'connexion_bancaire'];
  v_cab uuid := gen_random_uuid();
  v_dos uuid := gen_random_uuid();
  v_lignes_avant text;
  v_obs text;
  v_rendu text[];
  v_attendu text[];
  v_code text;
  v_message text;
  v_n bigint;
  verdicts jsonb := '[]'::jsonb;
begin
  if to_regclass('public.options_des_cabinets') is null then
    perform set_config('essai.options_des_cabinets', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', 'OC. EN ATTENTE de la migration options_des_cabinets', 'ok', true, 'observe', 'table absente'))::text, true);
    return;
  end if;
  if not exists (select 1 from super_admins where user_id = super) then
    raise exception 'ESSAI_IMPOSSIBLE : le compte d''essai n''est plus super-administrateur';
  end if;
  if exists (select 1 from cabinet_admins where user_id = client) then
    raise exception 'ESSAI_IMPOSSIBLE : le client d''essai est dans une équipe';
  end if;
  -- Le cabinet du dossier `test` : relu avant et après, l'écart seul.
  select coalesce(string_agg(o.module || ':' || o.ouverte || ':' || coalesce(o.changee_par::text, '-') || ':' || o.changee_le,
                             ',' order by o.module), '')
    into v_lignes_avant
    from options_des_cabinets o
   where o.cabinet_id = (select d.cabinet_id from dossiers d where d.id = '001c7ed7-c23b-4590-901e-693489f8af24');
  begin
    -- Le jeu : un cabinet neuf et son dossier, écrits par le propriétaire (la création d'un cabinet est celle de
    -- `create-cabinet`, hors de la RLS).
    perform set_config('request.jwt.claims', '', true);
    insert into cabinets (id, nom) values (v_cab, 'Cabinet d''essai des options');
    insert into dossiers (id, nom, cabinet_id) values (v_dos, 'Dossier d''essai des options', v_cab);

    -- 1. Le catalogue.
    select format('%s %s %s %s %s %s %s',
             (select c.relrowsecurity from pg_class c where c.oid = 'public.options_des_cabinets'::regclass),
             (select string_agg(pp.policyname || ':' || pp.cmd || ':' || array_to_string(pp.roles, ',') || ':' || pp.qual, ' ')
                from pg_policies pp where pp.schemaname = 'public' and pp.tablename = 'options_des_cabinets'
                 and not (pp.policyname = 'deux_facteurs' and pp.permissive = 'RESTRICTIVE')),
             (select pg_get_constraintdef(k.oid) from pg_constraint k
               where k.conrelid = 'public.options_des_cabinets'::regclass and k.contype = 'p'),
             (select count(*) from pg_proc p
               where p.oid in ('public.regler_option_du_cabinet(uuid, text, boolean)'::regprocedure,
                               'public.modules_ouverts_du_dossier(uuid)'::regprocedure)
                 and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
                 and not has_function_privilege('anon', p.oid, 'execute')
                 and has_function_privilege('authenticated', p.oid, 'execute')),
             (select count(*) from pg_trigger t
               where t.tgrelid = 'public.cabinets'::regclass and not t.tgisinternal and t.tgtype = 23
                 and t.tgfoid = 'public.garder_plafonds_de_l_assistant()'::regprocedure),
             (select p.prosecdef from pg_proc p where p.oid = 'public.garder_plafonds_de_l_assistant()'::regprocedure),
             has_function_privilege('authenticated', 'public.garder_plafonds_de_l_assistant()', 'execute'))
      into v_obs;
    verdicts := verdicts || jsonb_build_object('rang', 1, 'etape', '1. le catalogue : la RLS, une policy de lecture à l''équipe du cabinet, la clé (cabinet, module), les deux fonctions aux droits du propriétaire et sans l''anonyme, la garde des plafonds aux droits de l''appelant',
      'ok', v_obs = 't options_des_cabinets_lecture:SELECT:authenticated:admin_du_cabinet(cabinet_id) PRIMARY KEY (cabinet_id, module) 2 1 f f',
      'observe', v_obs);
    begin
      insert into options_des_cabinets (cabinet_id, module, ouverte) values (v_cab, 'socle', true);
      v_obs := 'ACCEPTÉ';
    exception when others then v_obs := sqlstate;
    end;
    verdicts := verdicts || jsonb_build_object('rang', 2, 'etape', '2. la liste fermée : le socle n''est pas un module de la table',
      'ok', v_obs = '23514', 'observe', v_obs);

    -- 3. Un cabinet neuf n'a que le socle (OPT-Q3 (B)) : aucune ligne, aucun module ouvert.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', super, 'role', 'authenticated')::text, true);
    v_rendu := modules_ouverts_du_dossier(v_dos);
    select count(*) into v_n from options_des_cabinets where cabinet_id = v_cab;
    reset role;
    verdicts := verdicts || jsonb_build_object('rang', 3, 'etape', '3. un cabinet neuf n''a que le socle : aucune ligne, aucun module ouvert',
      'ok', v_rendu = '{}'::text[] and v_n = 0, 'observe', coalesce(v_rendu::text, 'nul') || ' ' || v_n);

    -- 4. Qui lit : l'accès client par la fonction, et c'est ce que son cabinet a d'ouvert ; jamais la table ; ni un autre
    --    dossier ; ni l'anonyme.
    select array(select o.module from options_des_cabinets o join dossiers d on d.cabinet_id = o.cabinet_id
                  where d.id = dossier_du_client and o.ouverte order by array_position(c_modules, o.module))
      into v_attendu;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    v_rendu := modules_ouverts_du_dossier(dossier_du_client);
    select count(*) into v_n from options_des_cabinets;
    begin
      perform modules_ouverts_du_dossier(v_dos);
      v_obs := 'ACCEPTÉ';
    exception when others then v_obs := sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    begin
      set local role anon;
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      perform modules_ouverts_du_dossier(dossier_du_client);
      v_message := 'ACCEPTÉ';
    exception when others then v_message := sqlstate;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('rang', 4, 'etape', '4. l''accès client lit les modules de son dossier par la fonction (ceux de son cabinet), aucune ligne de la table ; ni ceux d''un autre dossier, ni l''anonyme',
      'ok', v_rendu = v_attendu and v_n = 0 and v_obs = '42501 Accès refusé à ce dossier.' and v_message = '42501',
      'observe', (v_rendu = v_attendu)::text || ' | la table : ' || (v_n = 0)::text || ' | un autre dossier : ' || v_obs || ' | l''anonyme : ' || v_message);

    -- 5. L'équipe du cabinet lit ses lignes ; un membre qui n'est pas affecté au dossier n'en lit pas les modules par la
    --    fonction (`admin_du_dossier`).
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', super, 'role', 'authenticated')::text, true);
      set local role authenticated;
      perform regler_option_du_cabinet(v_cab, 'assistant', true);
      reset role;
      insert into cabinet_admins (user_id, cabinet_id, role) values (client, v_cab, 'comptable');
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      select count(*) into v_n from options_des_cabinets where cabinet_id = v_cab and module = 'assistant' and ouverte;
      begin
        perform modules_ouverts_du_dossier(v_dos);
        v_obs := 'ACCEPTÉ';
      exception when others then v_obs := sqlstate || ' ' || sqlerrm;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('rang', 5, 'etape', '5. un membre de l''équipe lit les options de son cabinet ; pas les modules d''un dossier qui ne lui est pas affecté',
        'ok', v_n = 1 and v_obs = '42501 Accès refusé à ce dossier.', 'observe', v_n || ' | ' || v_obs);
      raise exception 'ANNULATION_ETAPE';
    exception when others then
      reset role;
      if sqlerrm <> 'ANNULATION_ETAPE' then
        verdicts := verdicts || jsonb_build_object('rang', 5, 'etape', '5. un membre de l''équipe lit', 'ok', false, 'observe', sqlstate || ' ' || sqlerrm);
      end if;
    end;

    -- 6. Qui règle : le super-administrateur seul — ni l'anonyme, ni le client, ni un chef de cabinet, ni un membre.
    v_obs := '';
    begin
      set local role anon;
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      perform regler_option_du_cabinet(v_cab, 'tenue', true);
      v_obs := v_obs || 'anonyme ACCEPTÉ';
    exception when others then v_obs := v_obs || 'anonyme ' || sqlstate;
    end;
    reset role;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform regler_option_du_cabinet(v_cab, 'tenue', true);
      v_obs := v_obs || ' | client ACCEPTÉ';
    exception when others then v_obs := v_obs || ' | client ' || sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    begin
      perform set_config('request.jwt.claims', '', true);
      insert into cabinet_admins (user_id, cabinet_id, role) values (client, v_cab, 'comptable_en_chef');
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      begin
        perform regler_option_du_cabinet(v_cab, 'tenue', true);
        v_obs := v_obs || ' | chef ACCEPTÉ';
      exception when others then v_obs := v_obs || ' | chef ' || sqlstate || ' ' || sqlerrm;
      end;
      reset role;
      raise exception 'ANNULATION_ETAPE';
    exception when others then
      reset role;
      if sqlerrm <> 'ANNULATION_ETAPE' then v_obs := v_obs || ' | chef : ' || sqlstate || ' ' || sqlerrm; end if;
    end;
    select count(*) into v_n from options_des_cabinets where cabinet_id = v_cab;
    verdicts := verdicts || jsonb_build_object('rang', 6, 'etape', '6. ni l''anonyme, ni le client, ni le chef d''un cabinet ne règlent ses options ; rien n''est écrit',
      'ok', v_obs = 'anonyme 42501 | client 42501 Seul le super-administrateur règle les options d''un cabinet. | chef 42501 Seul le super-administrateur règle les options d''un cabinet.'
        and v_n = 0,
      'observe', v_obs || ' | lignes : ' || v_n);

    -- 7. Les refus de la demande, au super-administrateur : un module hors de la liste (le socle compris), un sens nul, un
    --    cabinet inconnu.
    v_obs := '';
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', super, 'role', 'authenticated')::text, true);
    begin
      perform regler_option_du_cabinet(v_cab, 'socle', true);
      v_obs := 'ACCEPTÉ';
    exception when others then v_obs := sqlstate || ' ' || sqlerrm;
    end;
    begin
      perform regler_option_du_cabinet(v_cab, 'tenue', null);
      v_obs := v_obs || ' | ACCEPTÉ';
    exception when others then v_obs := v_obs || ' | ' || sqlstate || ' ' || sqlerrm;
    end;
    begin
      perform regler_option_du_cabinet(gen_random_uuid(), 'tenue', true);
      v_obs := v_obs || ' | ACCEPTÉ';
    exception when others then v_obs := v_obs || ' | ' || sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('rang', 7, 'etape', '7. les refus de la demande, sous leurs mots : un module hors de la liste, un sens nul, un cabinet inconnu',
      'ok', v_obs = '22023 Ce module n''existe pas : les modules sont tenue, facturation, facture_electronique, assurance_maladie, espace_client, assistant, honoraires et connexion_bancaire.'
        || ' | 22023 Dire si le module s''ouvre ou se ferme. | 22023 Ce cabinet n''existe pas.',
      'observe', v_obs);

    -- 8. Ouvrir les honoraires ouvre la facturation, à son nom ; fermer la facturation sous les honoraires se refuse ;
    --    fermer les honoraires puis la facturation passe, et fermer une seconde fois n'ajoute rien.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', super, 'role', 'authenticated')::text, true);
      v_rendu := regler_option_du_cabinet(v_cab, 'honoraires', true);
      v_obs := v_rendu::text || ' ' || (select string_agg(o.module || ':' || o.ouverte || ':' || coalesce((o.changee_par = super)::text, 'nul'), ',' order by o.module)
                                         from options_des_cabinets o where o.cabinet_id = v_cab)
               || ' ' || modules_ouverts_du_dossier(v_dos)::text;
      begin
        perform regler_option_du_cabinet(v_cab, 'facturation', false);
        v_message := 'ACCEPTÉ';
      exception when others then v_message := sqlstate || ' ' || sqlerrm;
      end;
      v_obs := v_obs || ' | ' || v_message;
      -- Un appel par instruction : une sous-requête de la même instruction ne verrait pas ce que les appels écrivent.
      v_obs := v_obs || ' | ' || regler_option_du_cabinet(v_cab, 'honoraires', false)::text;
      v_obs := v_obs || ' ' || regler_option_du_cabinet(v_cab, 'facturation', false)::text;
      v_obs := v_obs || ' ' || regler_option_du_cabinet(v_cab, 'facturation', false)::text;
      select count(*) into v_n from options_des_cabinets o where o.cabinet_id = v_cab and not o.ouverte;
      v_obs := v_obs || ' ' || v_n;
      reset role;
      verdicts := verdicts || jsonb_build_object('rang', 8, 'etape', '8. ouvrir les honoraires ouvre la facturation ; fermer la facturation sous les honoraires se refuse ; fermer les honoraires puis la facturation passe, une seconde fois sans rien ajouter',
        'ok', v_obs = '{facturation,honoraires} facturation:true:true,honoraires:true:true {facturation,honoraires}'
          || ' | P0001 Le module « Facturation » ne se ferme pas tant qu''un module qui le suppose est ouvert : « Honoraires du cabinet ».'
          || ' | {facturation} {} {} 2',
        'observe', v_obs);
      raise exception 'ANNULATION_ETAPE';
    exception when others then
      reset role;
      if sqlerrm <> 'ANNULATION_ETAPE' then
        verdicts := verdicts || jsonb_build_object('rang', 8, 'etape', '8. ouvrir et fermer', 'ok', false, 'observe', sqlstate || ' ' || sqlerrm);
      end if;
    end;

    -- 9. L'extinction gardée de la facturation : un dossier basculé la retient, nommé ; six la retiennent, cinq nommés dans
    --    l'ordre de leur nom, le sixième compté ; la bascule défaite (aucune facture source), elle se ferme.
    begin
      perform set_config('request.jwt.claims', '', true);
      update dossiers set ventes_par_les_factures = true where id = v_dos;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', super, 'role', 'authenticated')::text, true);
      perform regler_option_du_cabinet(v_cab, 'facturation', true);
      begin
        perform regler_option_du_cabinet(v_cab, 'facturation', false);
        v_obs := 'ACCEPTÉ';
      exception when others then v_obs := sqlstate || ' ' || sqlerrm;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      insert into dossiers (nom, cabinet_id, ventes_par_les_factures)
      select 'Essai des options ' || x, v_cab, true from unnest(array['E', 'B', 'D', 'A', 'C']) as x;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', super, 'role', 'authenticated')::text, true);
      begin
        perform regler_option_du_cabinet(v_cab, 'facturation', false);
        v_message := 'ACCEPTÉ';
      exception when others then v_message := sqlstate || ' ' || sqlerrm;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      update dossiers set ventes_par_les_factures = false where cabinet_id = v_cab;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', super, 'role', 'authenticated')::text, true);
      v_obs := v_obs || ' | ' || v_message || ' | ' || regler_option_du_cabinet(v_cab, 'facturation', false)::text;
      reset role;
      verdicts := verdicts || jsonb_build_object('rang', 9, 'etape', '9. la facturation d''un dossier basculé ne se ferme pas, le dossier nommé (cinq au plus, dans l''ordre de leur nom, les autres comptés) ; la bascule défaite, elle se ferme',
        'ok', v_obs = 'P0001 Le module « Facturation » ne se ferme pas : les ventes de ces dossiers passent par leurs factures, irréversiblement : « Dossier d''essai des options ».'
          || ' | P0001 Le module « Facturation » ne se ferme pas : les ventes de ces dossiers passent par leurs factures, irréversiblement : « Dossier d''essai des options », « Essai des options A », « Essai des options B », « Essai des options C », « Essai des options D » et 1 autre(s).'
          || ' | {}',
        'observe', v_obs);
      raise exception 'ANNULATION_ETAPE';
    exception when others then
      reset role;
      if sqlerrm <> 'ANNULATION_ETAPE' then
        verdicts := verdicts || jsonb_build_object('rang', 9, 'etape', '9. l''extinction de la facturation', 'ok', false, 'observe', sqlstate || ' ' || sqlerrm);
      end if;
    end;

    -- 10. La facture électronique sans envoi en cours, et l'assurance maladie sans paiement associé, se ferment ; tout le
    --     reste aussi. Les refus sur des lignes posées : optionsDesCabinetsEnCours.sql, sur une réplique.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', super, 'role', 'authenticated')::text, true);
      v_obs := '';
      foreach v_message in array c_modules loop
        perform regler_option_du_cabinet(v_cab, v_message, true);
      end loop;
      v_obs := modules_ouverts_du_dossier(v_dos)::text;
      foreach v_message in array array['honoraires', 'tenue', 'facturation', 'facture_electronique', 'assurance_maladie',
                                       'espace_client', 'assistant', 'connexion_bancaire'] loop
        v_rendu := regler_option_du_cabinet(v_cab, v_message, false);
      end loop;
      v_obs := v_obs || ' | ' || v_rendu::text;
      reset role;
      verdicts := verdicts || jsonb_build_object('rang', 10, 'etape', '10. les huit modules s''ouvrent, puis se ferment tous quand rien n''en dépend (la facture électronique sans envoi en cours, l''assurance maladie sans paiement associé)',
        'ok', v_obs = '{tenue,facturation,facture_electronique,assurance_maladie,espace_client,assistant,honoraires,connexion_bancaire} | {}',
        'observe', v_obs);
      raise exception 'ANNULATION_ETAPE';
    exception when others then
      reset role;
      if sqlerrm <> 'ANNULATION_ETAPE' then
        verdicts := verdicts || jsonb_build_object('rang', 10, 'etape', '10. ouvrir et fermer les huit', 'ok', false, 'observe', sqlstate || ' ' || sqlerrm);
      end if;
    end;

    -- 11. Les plafonds de l'assistant : le chef du cabinet (qui n'est pas super-administrateur) règle encore le reste de sa
    --     ligne, plus ses plafonds ; le super-administrateur les règle.
    begin
      perform set_config('request.jwt.claims', '', true);
      insert into cabinet_admins (user_id, cabinet_id, role) values (client, v_cab, 'comptable_en_chef');
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      with t as (update cabinets set nom = 'Cabinet d''essai des options, renommé', couleur_primaire = '#123456' where id = v_cab returning 1)
        select count(*) into v_n from t;
      begin
        update cabinets set limite_ia_blocage_usd = 1000 where id = v_cab;
        v_obs := 'ACCEPTÉ';
      exception when others then v_obs := sqlstate || ' ' || sqlerrm;
      end;
      begin
        update cabinets set limite_ia_alerte_usd = 10 where id = v_cab;
        v_message := 'ACCEPTÉ';
      exception when others then v_message := sqlstate;
      end;
      reset role;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', super, 'role', 'authenticated')::text, true);
      with t as (update cabinets set limite_ia_alerte_usd = 20, limite_ia_blocage_usd = 40 where id = v_cab returning 1)
        select v_n || ' ' || count(*) into v_code from t;
      reset role;
      verdicts := verdicts || jsonb_build_object('rang', 11, 'etape', '11. le chef règle encore le nom et la charte de son cabinet, plus les plafonds de l''assistant ; le super-administrateur les règle',
        'ok', v_obs = '42501 Les plafonds de l''assistant ne se règlent que par le super-administrateur.' and v_message = '42501' and v_code = '1 1',
        'observe', v_obs || ' | ' || v_message || ' | ' || v_code);
      raise exception 'ANNULATION_ETAPE';
    exception when others then
      reset role;
      if sqlerrm <> 'ANNULATION_ETAPE' then
        verdicts := verdicts || jsonb_build_object('rang', 11, 'etape', '11. les plafonds', 'ok', false, 'observe', sqlstate || ' ' || sqlerrm);
      end if;
    end;

    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    reset role;
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;
  perform set_config('request.jwt.claims', '', true);
  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni le cabinet d''essai, ni le client dans une équipe, ni un changement des options du cabinet de `test` (l''écart seul)',
    'ok', not exists (select 1 from cabinets where id = v_cab)
      and not exists (select 1 from cabinet_admins where user_id = client)
      and v_lignes_avant = (select coalesce(string_agg(o.module || ':' || o.ouverte || ':' || coalesce(o.changee_par::text, '-') || ':' || o.changee_le,
                                                       ',' order by o.module), '')
                              from options_des_cabinets o
                             where o.cabinet_id = (select d.cabinet_id from dossiers d where d.id = '001c7ed7-c23b-4590-901e-693489f8af24')),
    'observe', 'relu');
  perform set_config('essai.options_des_cabinets', verdicts::text, true);
end
$essai$;

-- Un verdict nul est une faute : une comparaison à un nul ne passe jamais pour juste.
select v.rang, v.etape, coalesce(v.ok, false) as ok, coalesce(v.observe, 'nul') as observe
from jsonb_to_recordset(current_setting('essai.options_des_cabinets')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
