-- LES PLAFONDS DE L'ASSISTANT HORS DE LA LECTURE DU CLIENT (OPT1-Q3 (B) ; la migration `plafonds_hors_du_client`, préparée le
-- 19/11/2026, pas appliquée : supabase/schema/20261120101707_plafonds_hors_du_client.sql). Le récit : HISTORIQUE.md,
-- « 19/11/2026 — OPT1-Q3 : LES PLAFONDS DE L'ASSISTANT HORS DE LA LECTURE DU CLIENT ». À rejouer par `execute_sql` après toute
-- migration qui touche `cabinets` (une colonne de plus, surtout), `plafonds_de_l_assistant`, `admin_du_cabinet`,
-- `mon_cabinet_id` ou `is_super_admin`.
--
-- Ce qui se prouve ici, par impersonation (le client d'essai, qui a un accès à un dossier du cabinet ; le même rattaché le
-- temps d'une sous-transaction à l'équipe, chef puis membre ; le super-administrateur ; l'anonyme) : le client lit la charte
-- de son cabinet et rien des plafonds — ni par la table (42501, même dans un filtre, par `*` ou la ligne entière), ni par la
-- fonction (aucune ligne) ; l'anonyme n'exécute pas la fonction ; un chef qui n'est pas super-administrateur lit par elle les
-- plafonds de son cabinet seul, tels que la table les porte, un membre de l'équipe aussi ; le super-administrateur ceux de
-- tous les cabinets ; l'écriture ne change pas (le chef règle sa charte, le super-administrateur les plafonds). Et le
-- catalogue. Quatre mutations doivent mordre. Rien n'est rendu qui dépende d'une ligne hors des dossiers d'essai : des
-- booléens et des codes d'erreur, jamais un plafond ni un compte de cabinets. Toutes les écritures sont annulées par leur
-- sous-transaction. Avant la migration, une ligne EN ATTENTE.
do $essai$
declare
  super constant uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  dossier_du_client constant uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  v_cab uuid;
  v_alerte numeric;
  v_blocage numeric;
  v_obs text;
  v_a text; v_b text; v_c text; v_d text; v_e text;
  v_n bigint;
  v_m bigint;
  verdicts jsonb := '[]'::jsonb;
begin
  if to_regprocedure('public.plafonds_de_l_assistant()') is null then
    perform set_config('essai.plafonds_hors_du_client', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', 'PL. EN ATTENTE de la migration plafonds_hors_du_client', 'ok', true, 'observe', 'fonction absente'))::text, true);
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
  select c.limite_ia_alerte_usd, c.limite_ia_blocage_usd into v_alerte, v_blocage from cabinets c where c.id = v_cab;

  -- 1. Le catalogue, tout chemin compris.
  verdicts := verdicts || jsonb_build_object('rang', 1, 'etape', '1. aucun rôle de l''API ne lit la table entière ni un plafond ; chacun lit chaque autre colonne ; la fonction aux droits du propriétaire, exécutée par authenticated seul',
    'ok', not exists (select 1 from (values ('anon'), ('authenticated')) r(n)
                       where has_table_privilege(r.n, 'public.cabinets', 'SELECT')
                          or has_column_privilege(r.n, 'public.cabinets', 'limite_ia_alerte_usd', 'SELECT')
                          or has_column_privilege(r.n, 'public.cabinets', 'limite_ia_blocage_usd', 'SELECT'))
      and not exists (select 1 from (values ('anon'), ('authenticated')) r(n) cross join pg_attribute a
                       where a.attrelid = 'public.cabinets'::regclass and a.attnum > 0 and not a.attisdropped
                         and a.attname not in ('limite_ia_alerte_usd', 'limite_ia_blocage_usd')
                         and not has_column_privilege(r.n, 'public.cabinets', a.attname::text, 'SELECT'))
      and (select p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
              and not has_function_privilege('anon', p.oid, 'execute') and has_function_privilege('authenticated', p.oid, 'execute')
              and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
             from pg_proc p where p.oid = 'public.plafonds_de_l_assistant()'::regprocedure),
    'observe', 'relu au catalogue');

  -- 2. Le client : la charte de son cabinet (le contrôle POSITIF), rien des plafonds par la table.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
  select count(*) into v_n from cabinets c where c.id = v_cab and c.nom is not null;
  begin perform c.limite_ia_alerte_usd from cabinets c where c.id = v_cab; v_a := 'LU'; exception when others then v_a := sqlstate; end;
  begin perform c.limite_ia_blocage_usd from cabinets c where c.id = v_cab; v_b := 'LU'; exception when others then v_b := sqlstate; end;
  begin perform c.id from cabinets c where c.limite_ia_blocage_usd is not null; v_c := 'LU'; exception when others then v_c := sqlstate; end;
  begin perform * from cabinets c where c.id = v_cab; v_d := 'LU'; exception when others then v_d := sqlstate; end;
  begin perform to_jsonb(c) from cabinets c where c.id = v_cab; v_e := 'LU'; exception when others then v_e := sqlstate; end;
  select count(*) into v_m from plafonds_de_l_assistant();
  reset role;
  perform set_config('request.jwt.claims', '', true);
  verdicts := verdicts || jsonb_build_object('rang', 2, 'etape', '2. le client lit la charte de son cabinet ; ni un plafond, ni un filtre sur lui, ni `*`, ni la ligne entière (42501) ; la fonction ne lui rend rien',
    'ok', v_n = 1 and v_a = '42501' and v_b = '42501' and v_c = '42501' and v_d = '42501' and v_e = '42501' and v_m = 0,
    'observe', 'charte : ' || v_n || ' | ' || v_a || ' ' || v_b || ' ' || v_c || ' ' || v_d || ' ' || v_e || ' | fonction : ' || v_m);

  -- 3. L'anonyme : ni la fonction, ni un plafond.
  begin
    set local role anon;
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    begin perform * from plafonds_de_l_assistant(); v_a := 'EXÉCUTÉE'; exception when others then v_a := sqlstate; end;
    begin perform c.limite_ia_blocage_usd from cabinets c; v_b := 'LU'; exception when others then v_b := sqlstate; end;
    reset role;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  verdicts := verdicts || jsonb_build_object('rang', 3, 'etape', '3. l''anonyme n''exécute pas la fonction, ne lit pas un plafond (42501)',
    'ok', v_a = '42501' and v_b = '42501', 'observe', v_a || ' | ' || v_b);

  -- 4. Un chef qui n'est pas super-administrateur, puis un membre de l'équipe : les plafonds de leur cabinet seul, par la
  --    fonction, tels que la table les porte ; jamais par la table. Et l'écriture de la charte, comme hier.
  begin
    insert into cabinet_admins (user_id, cabinet_id, role) values (client, v_cab, 'comptable_en_chef');
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*), count(*) filter (where p.cabinet_id = v_cab and p.limite_ia_alerte_usd is not distinct from v_alerte
                                       and p.limite_ia_blocage_usd is not distinct from v_blocage)
      into v_n, v_m from plafonds_de_l_assistant() p;
    begin perform c.limite_ia_blocage_usd from cabinets c where c.id = v_cab; v_a := 'LU'; exception when others then v_a := sqlstate; end;
    with t as (update cabinets set couleur_primaire = '#123456' where id = v_cab returning 1) select count(*)::text into v_b from t;
    reset role;
    verdicts := verdicts || jsonb_build_object('rang', 4, 'etape', '4. un chef qui n''est pas super-administrateur lit par la fonction les plafonds de son cabinet seul, tels que la table les porte ; pas par la table (42501) ; il règle sa charte comme hier',
      'ok', v_n = 1 and v_m = 1 and v_a = '42501' and v_b = '1', 'observe', v_n || ' ' || v_m || ' | ' || v_a || ' | ' || v_b);
    perform set_config('request.jwt.claims', '', true);
    update cabinet_admins set role = 'comptable' where user_id = client and cabinet_id = v_cab;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*), count(*) filter (where p.cabinet_id = v_cab) into v_n, v_m from plafonds_de_l_assistant() p;
    reset role;
    verdicts := verdicts || jsonb_build_object('rang', 5, 'etape', '5. un membre de l''équipe qui n''est pas chef les lit aussi, son cabinet seul',
      'ok', v_n = 1 and v_m = 1, 'observe', v_n || ' ' || v_m);
    raise exception 'ANNULATION_ETAPE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ETAPE' then
      verdicts := verdicts || jsonb_build_object('rang', 4, 'etape', '4. le chef et le membre de l''équipe', 'ok', false, 'observe', sqlstate || ' ' || sqlerrm);
    end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- 6. Le super-administrateur : tous les cabinets par la fonction (l'égalité seule), les plafonds réglés comme hier.
  begin
    select count(*) into v_m from cabinets;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', super, 'role', 'authenticated')::text, true);
    select count(*) into v_n from plafonds_de_l_assistant();
    with t as (update cabinets set limite_ia_alerte_usd = 20, limite_ia_blocage_usd = 40 where id = v_cab returning 1) select count(*)::text into v_b from t;
    reset role;
    verdicts := verdicts || jsonb_build_object('rang', 6, 'etape', '6. le super-administrateur lit les plafonds de tous les cabinets par la fonction, et les règle comme hier',
      'ok', v_n = v_m and v_b = '1', 'observe', (v_n = v_m)::text || ' | ' || v_b);
    raise exception 'ANNULATION_ETAPE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ETAPE' then
      verdicts := verdicts || jsonb_build_object('rang', 6, 'etape', '6. le super-administrateur', 'ok', false, 'observe', sqlstate || ' ' || sqlerrm);
    end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- 7. Les mutations, chacune annulée avec sa sous-transaction : elles doivent mordre.
  v_a := null; v_b := null; v_c := null; v_d := null;
  begin
    grant select on public.cabinets to authenticated;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    begin perform c.limite_ia_blocage_usd from cabinets c where c.id = v_cab; v_a := 'LU'; exception when others then v_a := sqlstate; end;
    reset role;
    raise exception 'ANNULATION_ETAPE';
  exception when others then if sqlerrm <> 'ANNULATION_ETAPE' then v_a := coalesce(v_a, sqlstate); end if;
  end;
  reset role;
  begin
    grant select (limite_ia_alerte_usd) on public.cabinets to authenticated;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    begin perform c.limite_ia_alerte_usd from cabinets c where c.id = v_cab; v_b := 'LU'; exception when others then v_b := sqlstate; end;
    reset role;
    raise exception 'ANNULATION_ETAPE';
  exception when others then if sqlerrm <> 'ANNULATION_ETAPE' then v_b := coalesce(v_b, sqlstate); end if;
  end;
  reset role;
  begin
    create or replace function public.plafonds_de_l_assistant()
    returns table (cabinet_id uuid, limite_ia_alerte_usd numeric, limite_ia_blocage_usd numeric)
    language sql stable security definer set search_path = public
    as 'select c.id, c.limite_ia_alerte_usd, c.limite_ia_blocage_usd from public.cabinets c';
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    -- Un booléen, jamais le nombre : sans filtre, la fonction compte TOUS les cabinets de la base.
    select (count(*) >= 1)::text into v_c from plafonds_de_l_assistant();
    reset role;
    raise exception 'ANNULATION_ETAPE';
  exception when others then if sqlerrm <> 'ANNULATION_ETAPE' then v_c := coalesce(v_c, sqlstate); end if;
  end;
  reset role;
  begin
    grant execute on function public.plafonds_de_l_assistant() to anon;
    set local role anon;
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    begin perform * from plafonds_de_l_assistant(); v_d := 'EXÉCUTÉE'; exception when others then v_d := sqlstate; end;
    reset role;
    raise exception 'ANNULATION_ETAPE';
  exception when others then if sqlerrm <> 'ANNULATION_ETAPE' then v_d := coalesce(v_d, sqlstate); end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  verdicts := verdicts || jsonb_build_object('rang', 7, 'etape', '7. les mutations mordent : la table rendue à authenticated, un plafond rendu par colonne (le client les lit), la fonction sans son filtre (le client en reçoit), son exécution donnée à l''anonyme',
    'ok', v_a = 'LU' and v_b = 'LU' and v_c = 'true' and v_d = 'EXÉCUTÉE',
    'observe', coalesce(v_a, 'nul') || ' | ' || coalesce(v_b, 'nul') || ' | ' || coalesce(v_c, 'nul') || ' | ' || coalesce(v_d, 'nul'));

  -- 8. Rien n'est resté : la fonction et les droits tels que la migration les pose.
  verdicts := verdicts || jsonb_build_object('rang', 8, 'etape', '8. rien n''est resté des sous-transactions',
    'ok', not has_table_privilege('authenticated', 'public.cabinets', 'SELECT')
      and not has_function_privilege('anon', 'public.plafonds_de_l_assistant()', 'execute')
      and not exists (select 1 from cabinet_admins where user_id = client)
      and strpos((select p.prosrc from pg_proc p where p.oid = 'public.plafonds_de_l_assistant()'::regprocedure), 'admin_du_cabinet') > 0,
    'observe', 'relu');
  perform set_config('essai.plafonds_hors_du_client', verdicts::text, true);
end
$essai$;

-- Un verdict nul est une faute : une comparaison à un nul ne passe jamais pour juste.
select v.rang, v.etape, coalesce(v.ok, false) as ok, coalesce(v.observe, 'nul') as observe
from jsonb_to_recordset(current_setting('essai.plafonds_hors_du_client')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
