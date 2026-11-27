-- LE JOURNAL DE CONSOMMATION DE L'ASSISTANT (ASSIST-Q1 (A) ; la migration `consommations_de_l_assistant`, préparée le
-- 27/11/2026 : supabase/preparees/20261127230000_consommations_de_l_assistant.sql). Le récit : HISTORIQUE.md, « 27/11/2026 —
-- ASSIST-Q1 : LE JOURNAL DE CONSOMMATION DE L'ASSISTANT (PRÉPARÉE, PAS APPLIQUÉE) ». À rejouer par `execute_sql` après toute
-- migration qui touche la table, sa garde, `consommation_de_l_assistant`, `is_super_admin`, `cabinets` ou `dossiers`. La sortie
-- d'une ligne (la cascade du cabinet, la mise à nul du dossier retiré, une sortie directe refusée) se joue dans son compagnon,
-- consommationsDeLAssistantSuppression.sql, que l'outil de la production ne joue pas.
--
-- Ce qui se prouve ici, par impersonation (l'anonyme ; un compte connecté rattaché à rien ; le client d'essai, qui a un accès
-- à un dossier du cabinet ; le même rattaché le temps d'une sous-transaction à l'équipe, chef du cabinet ; le
-- super-administrateur) et sous le rôle du service : aucun rôle de l'API ne lit, n'écrit ni ne réécrit le journal (42501, le
-- droit, avant la RLS) ; la lecture des sommes au super-administrateur seul, qui voit les lignes de l'essai s'y ajouter, à
-- l'unité près, et aucune avant `p_depuis` ; le rôle du service écrit une ligne, dont la base pose l'instant, et ne la réécrit
-- pas ; un dossier d'un autre cabinet, une borne dépassée, un nombre négatif refusés (23514). Et le catalogue. Sept mutations
-- doivent mordre. Rien n'est rendu qui dépende d'une ligne hors des dossiers d'essai : des booléens, des codes d'erreur, des
-- écarts, jamais une somme ni un compte de lignes du journal. Toutes les écritures sont annulées par leur sous-transaction.
-- Avant la migration, une ligne EN ATTENTE.
do $essai$
declare
  super constant uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  dossier_du_client constant uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  inconnu constant uuid := gen_random_uuid();
  autre_cabinet constant uuid := gen_random_uuid();
  v_cab uuid;
  v_ligne uuid;
  v_avant_e bigint; v_avant_s bigint; v_apres_e bigint; v_apres_s bigint; v_depuis_e bigint; v_depuis_s bigint;
  v_a text; v_b text; v_c text; v_d text; v_e text; v_f text;
  v_n bigint;
  verdicts jsonb := '[]'::jsonb;
begin
  if to_regclass('public.consommations_de_l_assistant') is null then
    perform set_config('essai.consommations_de_l_assistant', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', 'CO. EN ATTENTE de la migration consommations_de_l_assistant', 'ok', true, 'observe', 'table absente'))::text, true);
    return;
  end if;
  if not exists (select 1 from super_admins where user_id = super) then
    raise exception 'ESSAI_IMPOSSIBLE : le compte d''essai n''est plus super-administrateur';
  end if;
  if exists (select 1 from cabinet_admins where user_id = client)
     or not exists (select 1 from memberships m where m.user_id = client and m.dossier_id = dossier_du_client) then
    raise exception 'ESSAI_IMPOSSIBLE : le client d''essai est dans une équipe, ou n''a plus d''accès à son dossier';
  end if;
  select d.cabinet_id into v_cab from dossiers d where d.id = dossier_du_client;

  -- 1. Le catalogue, tout chemin compris.
  -- La restrictive de la double authentification mise à part (le bloc DF de rls.sql la juge) : aucune autre policy.
  verdicts := verdicts || jsonb_build_object('rang', 1, 'etape', '1. la RLS active, aucune policy hors de la restrictive de la double authentification ; aucun droit des rôles de l''API ni de PUBLIC (table et colonnes), le DML au rôle du service ; la garde avant les trois écritures, aux droits de l''appelant, qu''aucun connecté n''exécute ; la lecture aux droits du propriétaire, exécutée par authenticated seul ; les deux bornes, les deux index',
    'ok', (select c.relrowsecurity from pg_class c where c.oid = 'public.consommations_de_l_assistant'::regclass)
      and (select count(*) from pg_policy p
            where p.polrelid = 'public.consommations_de_l_assistant'::regclass
              and not (p.polname = 'deux_facteurs' and not p.polpermissive)) = 0
      and not exists (select 1 from (values ('anon'), ('authenticated'), ('public')) r(n)
                       cross join (select distinct d.privilege_type from aclexplode(acldefault('r', to_regrole('anon'))) d) p
                       where has_table_privilege(r.n, 'public.consommations_de_l_assistant', p.privilege_type))
      and not exists (select 1 from (values ('anon'), ('authenticated'), ('public')) r(n)
                       cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) p(p)
                       where has_any_column_privilege(r.n, 'public.consommations_de_l_assistant', p.p))
      and has_table_privilege('service_role', 'public.consommations_de_l_assistant', 'SELECT')
      and has_table_privilege('service_role', 'public.consommations_de_l_assistant', 'INSERT')
      and (select count(*) from pg_trigger t
            where t.tgrelid = 'public.consommations_de_l_assistant'::regclass and not t.tgisinternal
              and t.tgfoid = 'public.garder_consommations_de_l_assistant()'::regprocedure and t.tgtype = 31) = 1
      and not (select p.prosecdef from pg_proc p where p.oid = 'public.garder_consommations_de_l_assistant()'::regprocedure)
      and not has_function_privilege('authenticated', 'public.garder_consommations_de_l_assistant()', 'execute')
      and (select p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
              and not has_function_privilege('anon', p.oid, 'execute') and has_function_privilege('authenticated', p.oid, 'execute')
              and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
             from pg_proc p where p.oid = 'public.consommation_de_l_assistant(timestamptz)'::regprocedure)
      and (select count(*) from pg_constraint c where c.conrelid = 'public.consommations_de_l_assistant'::regclass and c.contype = 'c'
            and c.conname in ('consommations_de_l_assistant_tokens_entree', 'consommations_de_l_assistant_tokens_sortie')) = 2
      and to_regclass('public.consommations_de_l_assistant_cabinet_mois') is not null
      and to_regclass('public.consommations_de_l_assistant_dossier') is not null,
    'observe', 'relu au catalogue');

  -- 2. Les rôles de l'API : ni lecture, ni écriture, ni réécriture (42501, le droit). L'anonyme, l'inconnu, le client.
  v_a := ''; v_b := '';
  for v_c in select x from unnest(array['anon', 'inconnu', 'client']) x loop
    begin
      if v_c = 'anon' then
        set local role anon;
        perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      else
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', case when v_c = 'client' then client else inconnu end,
          'role', 'authenticated')::text, true);
      end if;
      begin perform count(*) from consommations_de_l_assistant; v_d := 'LU'; exception when others then v_d := sqlstate; end;
      begin
        insert into consommations_de_l_assistant (cabinet_id, dossier_id, compte, tokens_entree, tokens_sortie)
        values (v_cab, dossier_du_client, client, 1, 1);
        v_e := 'ÉCRIT';
      exception when others then v_e := sqlstate;
      end;
      begin
        update consommations_de_l_assistant set tokens_entree = 0 where cabinet_id = v_cab;
        v_f := 'RÉÉCRIT';
      exception when others then v_f := sqlstate;
      end;
      reset role;
      raise exception 'ANNULATION_ETAPE';
    exception when others then
      if sqlerrm <> 'ANNULATION_ETAPE' then v_d := coalesce(v_d, sqlstate); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    v_a := v_a || v_c || ' ' || coalesce(v_d, 'nul') || '/' || coalesce(v_e, 'nul') || '/' || coalesce(v_f, 'nul') || ' ; ';
    v_b := v_b || case when v_d = '42501' and v_e = '42501' and v_f = '42501' then '' else 'x' end;
  end loop;
  verdicts := verdicts || jsonb_build_object('rang', 2, 'etape', '2. l''anonyme, un compte rattaché à rien et le client ne lisent, n''écrivent ni ne réécrivent le journal (42501, le droit)',
    'ok', v_b = '', 'observe', v_a);

  -- 3. Le chef du cabinet (le client rattaché à l'équipe le temps d'une sous-transaction) : pas davantage, ni par la lecture.
  v_a := null; v_b := null; v_c := null;
  begin
    insert into cabinet_admins (user_id, cabinet_id, role) values (client, v_cab, 'comptable_en_chef');
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    begin perform count(*) from consommations_de_l_assistant; v_a := 'LU'; exception when others then v_a := sqlstate; end;
    begin
      insert into consommations_de_l_assistant (cabinet_id, dossier_id, compte, tokens_entree, tokens_sortie)
      values (v_cab, dossier_du_client, client, 1, 1);
      v_b := 'ÉCRIT';
    exception when others then v_b := sqlstate;
    end;
    begin perform count(*) from consommation_de_l_assistant(now()); v_c := 'LU'; exception when others then v_c := sqlstate || ' ' || sqlerrm; end;
    reset role;
    raise exception 'ANNULATION_ETAPE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ETAPE' then v_a := coalesce(v_a, sqlstate || ' ' || sqlerrm); end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  verdicts := verdicts || jsonb_build_object('rang', 3, 'etape', '3. le chef du cabinet ne lit ni n''écrit le journal (42501), et la lecture des sommes le refuse (42501, la fonction elle-même)',
    'ok', v_a = '42501' and v_b = '42501' and v_c like '42501 Seul le super-administrateur%',
    'observe', coalesce(v_a, 'nul') || ' | ' || coalesce(v_b, 'nul') || ' | ' || coalesce(left(v_c, 40), 'nul'));

  -- 4. La lecture des sommes : ni l'anonyme (le droit d'exécution), ni le client (la fonction).
  v_a := null; v_b := null;
  begin
    set local role anon;
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    begin perform count(*) from consommation_de_l_assistant(now()); v_a := 'EXÉCUTÉE'; exception when others then v_a := sqlstate || ' ' || sqlerrm; end;
    reset role;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    begin perform count(*) from consommation_de_l_assistant(now()); v_b := 'EXÉCUTÉE'; exception when others then v_b := sqlstate || ' ' || sqlerrm; end;
    reset role;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  verdicts := verdicts || jsonb_build_object('rang', 4, 'etape', '4. la lecture des sommes : l''anonyme ne l''exécute pas (le droit), le client se la voit refuser (la fonction)',
    'ok', v_a like '42501 permission denied%' and v_b like '42501 Seul le super-administrateur%',
    'observe', coalesce(left(v_a, 40), 'nul') || ' | ' || coalesce(left(v_b, 40), 'nul'));

  -- 5. Le rôle du service écrit deux lignes, et le super-administrateur les voit s'ajouter aux sommes du cabinet, à l'unité ;
  --    aucune avant `p_depuis` ; `p_depuis` nul refusé (22023). La base pose l'instant, et le rôle du service ne réécrit pas.
  v_a := null; v_b := null; v_c := null; v_d := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', super, 'role', 'authenticated')::text, true);
    select coalesce(sum(c.tokens_entree), 0), coalesce(sum(c.tokens_sortie), 0) into v_avant_e, v_avant_s
      from consommation_de_l_assistant(now() - interval '1 day') c where c.cabinet_id = v_cab;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    set local role service_role;
    insert into consommations_de_l_assistant (cabinet_id, dossier_id, compte, consommee_le, tokens_entree, tokens_sortie)
    values (v_cab, dossier_du_client, client, '2020-01-01', 1234, 56) returning id into v_ligne;
    insert into consommations_de_l_assistant (cabinet_id, dossier_id, compte, tokens_entree, tokens_sortie)
    values (v_cab, null, client, 10000000, 1000000);
    select (c.consommee_le = now())::text into v_a from consommations_de_l_assistant c where c.id = v_ligne;
    begin
      update consommations_de_l_assistant set tokens_entree = 0 where id = v_ligne;
      v_b := 'RÉÉCRIT';
    exception when others then v_b := sqlstate;
    end;
    begin
      update consommations_de_l_assistant set dossier_id = null where id = v_ligne;
      v_c := 'RÉÉCRIT';
    exception when others then v_c := sqlstate;
    end;
    reset role;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', super, 'role', 'authenticated')::text, true);
    select coalesce(sum(c.tokens_entree), 0), coalesce(sum(c.tokens_sortie), 0) into v_apres_e, v_apres_s
      from consommation_de_l_assistant(now() - interval '1 day') c where c.cabinet_id = v_cab;
    select coalesce(sum(c.tokens_entree_depuis), 0) + coalesce(sum(c.tokens_sortie_depuis), 0), count(*) into v_depuis_e, v_n
      from consommation_de_l_assistant(now() + interval '1 second') c where c.cabinet_id = v_cab;
    begin perform count(*) from consommation_de_l_assistant(null); v_d := 'LU'; exception when others then v_d := sqlstate; end;
    reset role;
    raise exception 'ANNULATION_ETAPE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ETAPE' then v_a := coalesce(v_a, sqlstate || ' ' || sqlerrm); end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  verdicts := verdicts || jsonb_build_object('rang', 5, 'etape', '5. le rôle du service écrit ; la base pose l''instant ; il ne réécrit pas (42501, la garde), pas même le dossier ; le super-administrateur voit les lignes s''ajouter aux sommes du cabinet, à l''unité, aucune après « maintenant », et un « depuis » nul refusé (22023)',
    'ok', v_a = 'true' and v_b = '42501' and v_c = '42501'
      and v_apres_e - v_avant_e = 10001234 and v_apres_s - v_avant_s = 1000056 and v_depuis_e = 0 and v_n = 1 and v_d = '22023',
    'observe', coalesce(v_a, 'nul') || ' | ' || coalesce(v_b, 'nul') || ' ' || coalesce(v_c, 'nul')
      || ' | écarts ' || coalesce((v_apres_e - v_avant_e)::text, 'nul') || ' ' || coalesce((v_apres_s - v_avant_s)::text, 'nul')
      || ' | après maintenant ' || coalesce(v_depuis_e::text, 'nul') || ' | ' || coalesce(v_d, 'nul'));

  -- 6. Les refus du rôle du service : un dossier d'un autre cabinet, une borne dépassée, un nombre négatif (23514) ; un nombre
  --    absent (23502) ; un dossier qui n'existe pas (23503, sa clé étrangère : la garde ne le juge pas, la fonction note
  --    alors sans lui). Un cabinet fictif, le temps de la sous-transaction.
  v_a := ''; v_b := '';
  begin
    insert into cabinets (id, nom) values (autre_cabinet, 'Cabinet fictif de l''essai des consommations');
    set local role service_role;
    for v_c, v_d, v_e, v_f in select * from (values
        ('un dossier d''un autre cabinet', '1', '1', '23514'), ('entrée au-delà de la borne', '10000001', '0', '23514'),
        ('sortie au-delà de la borne', '0', '1000001', '23514'), ('entrée négative', '-1', '0', '23514'),
        ('sortie négative', '0', '-1', '23514'), ('entrée absente', null, '0', '23502'),
        ('un dossier absent', '1', '1', '23503')) t(quoi, e, s, attendu) loop
      begin
        insert into consommations_de_l_assistant (cabinet_id, dossier_id, compte, tokens_entree, tokens_sortie)
        values (case when v_c = 'un dossier d''un autre cabinet' then autre_cabinet else v_cab end,
                case when v_c = 'un dossier absent' then autre_cabinet else dossier_du_client end, client,
                v_d::integer, v_e::integer);
        v_a := v_a || v_c || ' ÉCRIT ; ';
        v_b := v_b || 'x';
      exception when others then
        v_a := v_a || v_c || ' ' || sqlstate || ' ; ';
        v_b := v_b || case when sqlstate = v_f then '' else 'x' end;
      end;
    end loop;
    reset role;
    raise exception 'ANNULATION_ETAPE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ETAPE' then v_b := v_b || 'x'; v_a := v_a || sqlstate || ' ' || sqlerrm; end if;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('rang', 6, 'etape', '6. le rôle du service ne note ni le dossier d''un autre cabinet, ni une borne dépassée, ni un nombre négatif (23514), ni un nombre absent (23502), ni un dossier qui n''existe pas (23503, sa clé étrangère)',
    'ok', v_b = '', 'observe', v_a);

  -- 7. Les mutations, chacune annulée avec sa sous-transaction : elles doivent mordre.
  v_a := null; v_b := null; v_c := null; v_d := null; v_e := null; v_f := null;
  -- M1 : la lecture rendue à authenticated — le client ne bute plus sur le droit.
  begin
    grant select on public.consommations_de_l_assistant to authenticated;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    begin perform count(*) from consommations_de_l_assistant; v_a := 'LU'; exception when others then v_a := sqlstate; end;
    reset role;
    raise exception 'ANNULATION_ETAPE';
  exception when others then if sqlerrm <> 'ANNULATION_ETAPE' then v_a := coalesce(v_a, sqlstate); end if;
  end;
  reset role;
  -- M2 : une policy permissive et le droit : le client lit la ligne de l'essai.
  begin
    set local role service_role;
    insert into consommations_de_l_assistant (cabinet_id, dossier_id, compte, tokens_entree, tokens_sortie)
    values (v_cab, dossier_du_client, client, 7, 7) returning id into v_ligne;
    reset role;
    grant select on public.consommations_de_l_assistant to authenticated;
    create policy essai_consommations_ouvertes on public.consommations_de_l_assistant for select to authenticated using (true);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*)::text into v_b from consommations_de_l_assistant c where c.id = v_ligne;
    reset role;
    raise exception 'ANNULATION_ETAPE';
  exception when others then if sqlerrm <> 'ANNULATION_ETAPE' then v_b := coalesce(v_b, sqlstate); end if;
  end;
  reset role;
  -- M3 : la lecture des sommes sans son contrôle : le client la lit.
  begin
    create or replace function public.consommation_de_l_assistant(p_depuis timestamptz)
      returns table (cabinet_id uuid, tokens_entree bigint, tokens_sortie bigint, tokens_entree_depuis bigint, tokens_sortie_depuis bigint)
      language plpgsql stable security definer set search_path = public
    as $m3$
    begin
      return query select c.cabinet_id, sum(c.tokens_entree)::bigint, sum(c.tokens_sortie)::bigint, 0::bigint, 0::bigint
        from public.consommations_de_l_assistant c group by c.cabinet_id;
    end
    $m3$;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    begin perform count(*) from consommation_de_l_assistant(now()); v_c := 'LU'; exception when others then v_c := sqlstate; end;
    reset role;
    raise exception 'ANNULATION_ETAPE';
  exception when others then if sqlerrm <> 'ANNULATION_ETAPE' then v_c := coalesce(v_c, sqlstate); end if;
  end;
  reset role;
  -- M4 : l'exécution donnée à l'anonyme : il atteint la fonction (son refus est le sien, plus celui du droit).
  begin
    grant execute on function public.consommation_de_l_assistant(timestamptz) to anon;
    set local role anon;
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    begin perform count(*) from consommation_de_l_assistant(now()); v_d := 'EXÉCUTÉE'; exception when others then v_d := sqlerrm; end;
    reset role;
    raise exception 'ANNULATION_ETAPE';
  exception when others then if sqlerrm <> 'ANNULATION_ETAPE' then v_d := coalesce(v_d, sqlstate); end if;
  end;
  reset role;
  -- M5, M6, M7 : la garde sans le cabinet du dossier, sans le refus d'une réécriture, sans l'instant de la base.
  begin
    insert into cabinets (id, nom) values (autre_cabinet, 'Cabinet fictif de l''essai des consommations');
    create or replace function public.garder_consommations_de_l_assistant() returns trigger
    language plpgsql set search_path = public
    as $m5$
    begin
      if tg_op = 'INSERT' then return new; end if;
      if tg_op = 'UPDATE' then return new; end if;
      return old;
    end
    $m5$;
    set local role service_role;
    begin
      insert into consommations_de_l_assistant (cabinet_id, dossier_id, compte, consommee_le, tokens_entree, tokens_sortie)
      values (autre_cabinet, dossier_du_client, client, '2020-01-01', 1, 1) returning id into v_ligne;
      v_e := 'ÉCRIT';
      select (c.consommee_le = '2020-01-01'::timestamptz)::text into v_f from consommations_de_l_assistant c where c.id = v_ligne;
      update consommations_de_l_assistant set tokens_entree = 0 where id = v_ligne;
      v_e := v_e || ' RÉÉCRIT';
    exception when others then v_e := coalesce(v_e, '') || ' ' || sqlstate;
    end;
    reset role;
    raise exception 'ANNULATION_ETAPE';
  exception when others then if sqlerrm <> 'ANNULATION_ETAPE' then v_e := coalesce(v_e, sqlstate); end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  verdicts := verdicts || jsonb_build_object('rang', 7, 'etape', '7. les mutations mordent : la lecture rendue à authenticated (M1), une policy permissive (M2), la lecture des sommes sans son contrôle (M3), son exécution donnée à l''anonyme (M4), la garde sans le cabinet du dossier, sans le refus d''une réécriture, sans l''instant de la base (M5 à M7)',
    'ok', v_a = 'LU' and v_b = '1' and v_c = 'LU' and v_d like 'Seul le super-administrateur%' and v_e = 'ÉCRIT RÉÉCRIT' and v_f = 'true',
    'observe', coalesce(v_a, 'nul') || ' | ' || coalesce(v_b, 'nul') || ' | ' || coalesce(v_c, 'nul') || ' | '
      || coalesce(left(v_d, 40), 'nul') || ' | ' || coalesce(v_e, 'nul') || ' | ' || coalesce(v_f, 'nul'));

  -- 8. Rien n'est resté : ni droit, ni policy, ni ligne de l'essai, ni corps muté.
  verdicts := verdicts || jsonb_build_object('rang', 8, 'etape', '8. rien n''est resté des sous-transactions',
    'ok', not has_table_privilege('authenticated', 'public.consommations_de_l_assistant', 'SELECT')
      and not has_function_privilege('anon', 'public.consommation_de_l_assistant(timestamptz)', 'execute')
      and (select count(*) from pg_policy p
            where p.polrelid = 'public.consommations_de_l_assistant'::regclass
              and not (p.polname = 'deux_facteurs' and not p.polpermissive)) = 0
      and not exists (select 1 from cabinet_admins where user_id = client)
      and not exists (select 1 from cabinets where id = autre_cabinet)
      and not exists (select 1 from consommations_de_l_assistant c where c.compte = client)
      and strpos((select p.prosrc from pg_proc p where p.oid = 'public.consommation_de_l_assistant(timestamptz)'::regprocedure), 'is_super_admin') > 0
      and strpos((select p.prosrc from pg_proc p where p.oid = 'public.garder_consommations_de_l_assistant()'::regprocedure), 'ne se réécrit pas') > 0,
    'observe', 'relu');
  perform set_config('essai.consommations_de_l_assistant', verdicts::text, true);
end
$essai$;

-- Un verdict nul est une faute : une comparaison à un nul ne passe jamais pour juste.
select v.rang, v.etape, coalesce(v.ok, false) as ok, coalesce(v.observe, 'nul') as observe
from jsonb_to_recordset(current_setting('essai.consommations_de_l_assistant')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
