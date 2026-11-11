-- TROIS CASES DE PLUS SUR UN ACCÈS CLIENT : « ACHATS », « NOTES DE FRAIS », « DOCUMENTS » (espace client, ligne 51.5, étape
-- B1 ; la migration `trois_cases_de_l_acces`, PRÉPARÉE le 07/11/2026, supabase/preparees/, après `trace_des_droits` et
-- `situations_publiees`). Le récit : HISTORIQUE.md, « 07/11/2026 — TROIS CASES DE PLUS : « ACHATS », « NOTES DE FRAIS »,
-- « DOCUMENTS » (B1, LIGNE 51.5) (PRÉPARÉE, PAS APPLIQUÉE) ». À rejouer par `execute_sql` après toute migration qui touche
-- `memberships`, `changer_droits_acces`, `client_du_dossier`, `droits_sur_le_dossier` ou la trace des droits — et d'abord
-- après celles de B2, B4 et B7, qui ouvriront ce que ces cases promettent : leur rang 12 changera avec elles.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - les trois colonnes, booléennes, non nulles, fausses par défaut ; la forme à huit, ses droits d'exécution ;
--   - `changer_droits_acces` à huit : une case cochée puis décochée par le cabinet, les autres inchangées ; un droit nul
--     inchangé ; ses refus dans l'ordre (aucun droit, sous les mots qui nomment les sept cases ; le client lui-même ; un
--     accès inconnu) ; les formes à cinq, quatre et trois laissent les trois cases telles qu'elles sont ;
--   - `client_du_dossier` et `droits_sur_le_dossier` : la case de l'accès de l'appelant à CE dossier, le cabinet pour les
--     trois clés, neuf clés en tout ;
--   - la trace : un accès qui arrive en portant les trois cases les écrit en « creation », une case changée en
--     « changement », avec l'auteur ;
--   - B1 N'OUVRE RIEN : aucune policy, aucune autre fonction ne lit les trois cases ; et, par le geste, le client qui les
--     porte sur son dossier voit, table par table et dans le stockage, exactement ce qu'il voit sans elles ;
--   - le client lit ses cases sur sa ligne, et ne les écrit pas.
--
-- Deux dossiers jetables du cabinet du dossier `test` (préfixe `b1ca0000-0000-4000-8051`), exonérés, en trésorerie : DT,
-- où l'accès A du client d'essai ne porte aucune case ; DU, où l'accès B les porte toutes les trois (inséré par le
-- propriétaire, comme `create-client-access` insère). Le dossier du client du jeu (`ac538d93`) sert à la comparaison par le
-- geste. Tout se joue dans une sous-transaction ANNULÉE (`ANNULATION_ESSAI_GLOBALE`) ; les verdicts voyagent dans des
-- variables, puis dans un réglage LOCAL à la transaction (`essai.trois_cases`), que la requête finale lit : un seul appel,
-- ni table ni fonction créée, aucune instruction de suppression, rien qui dépende d'une ligne hors de ses dossiers (la
-- comparaison ne rend que l'écart). Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`). Sans la
-- migration, une ligne dit qu'il attend (EN ATTENTE) et rien ne s'écrit.
do $essai$
declare
  chef constant uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  dossier_du_client constant uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  dt constant uuid := 'b1ca0000-0000-4000-8051-0000000000d1';
  du constant uuid := 'b1ca0000-0000-4000-8051-0000000000d2';
  acces_a constant uuid := 'b1ca0000-0000-4000-8051-0000000000a1';
  acces_b constant uuid := 'b1ca0000-0000-4000-8051-0000000000b1';
  huit constant text := 'public.changer_droits_acces(uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean)';
  aucun_droit constant text := 'Aucun droit à changer : précise « Ventes », « Banque », « Caisse », « Comptes », « Achats », « Notes de frais » ou « Documents ».';
  verdicts jsonb := '[]'::jsonb;
  -- L'accès relu par le propriétaire : ses sept cases, dans l'ordre des colonnes (« t » ou « f »).
  cases constant text := $c$select concat_ws(' ', m.droit_ventes, m.droit_banque, m.droit_caisse, m.droit_comptes, m.droit_achats, m.droit_frais, m.droit_documents) from memberships m where m.id = $1$c$;
  -- La trace des deux dossiers, relue par le propriétaire.
  trace constant text := $t$select coalesce(string_agg(case t.acces_id when $1 then 'A' when $2 then 'B' else '?' end || ' ' || t.droit || ' '
      || case when t.coche then 'cochée' else 'décochée' end || ' ' || t.geste || ' par '
      || case when t.auteur_id is null then 'sans session' when t.auteur_id = $3 then 'le chef' else 'un autre' end,
      ', ' order by t.acces_id, t.droit, t.geste, t.coche desc), 'rien') from trace_des_droits t where t.dossier_id in ($4, $5)$t$;
  obs text; obs2 text; code text; rendu public.memberships; vues_sans jsonb := '{}'::jsonb; vues_avec jsonb := '{}'::jsonb;
  t record; n bigint;
  -- B2 (`documents_et_demandes`, préparée) se sert de « Documents » : en base, les rangs 12 et 13 ne jugent plus que
  -- « Achats » et « Notes de frais », et documentsCabinet.sql juge ce que « Documents » ouvre.
  b2 constant boolean := to_regclass('public.documents_cabinet') is not null;
  mots constant text := case when to_regclass('public.documents_cabinet') is not null then 'achats|frais' else 'achats|frais|documents' end;
begin
  if not exists (select 1 from pg_attribute a where a.attrelid = 'public.memberships'::regclass and a.attname = 'droit_documents'
                  and not a.attisdropped) then
    perform set_config('essai.trois_cases', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration trois_cases_de_l_acces', 'ok', true,
      'observe', 'absente : il se juge dès que la migration y est'))::text, true);
    return;
  end if;
  begin
    -- ── Le jeu ──
    perform set_config('request.jwt.claims', '', true);
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, statut_tva)
      select x.id, x.nom, d.cabinet_id, 'tresorerie', '455000', 'exonere'
      from dossiers d, (values (dt, 'ESSAI B1 DT'), (du, 'ESSAI B1 DU')) as x(id, nom) where d.id = '001c7ed7-c23b-4590-901e-693489f8af24';
    insert into memberships (id, user_id, dossier_id, role, email) values (acces_a, client, dt, 'client', 'essai-b1-a@example.test');
    insert into memberships (id, user_id, dossier_id, role, email, droit_achats, droit_frais, droit_documents)
      values (acces_b, client, du, 'client', 'essai-b1-b@example.test', true, true, true);

    -- 1. Le catalogue des colonnes.
    select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then ' not null' else '' end
             || ' = ' || pg_get_expr(d.adbin, d.adrelid) || ' ' || (col_description(a.attrelid, a.attnum) like '%il n''ouvre encore rien : l''étape B_ s''en servira%'),
             ', ' order by a.attnum) into obs
      from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.attrelid = 'public.memberships'::regclass and a.attname in ('droit_achats', 'droit_frais', 'droit_documents');
    verdicts := verdicts || jsonb_build_object('rang', 1, 'etape', '1. trois colonnes booléennes, non nulles, fausses par défaut ; leur commentaire dit qu''elles n''ouvrent encore rien', 'observe', obs,
      'ok', obs = 'droit_achats boolean not null = false true, droit_frais boolean not null = false true, droit_documents boolean not null = false true');

    -- 2. La forme à huit : SECURITY DEFINER, chemin fixé ; authenticated et le rôle des Edge Functions l'exécutent, ni anon
    --    ni PUBLIC ; quatre formes en tout.
    select p.prosecdef || ' ' || coalesce(array_to_string(p.proconfig, ','), '-') || ' ' || has_function_privilege('anon', p.oid, 'execute')
           || ' ' || has_function_privilege('authenticated', p.oid, 'execute') || ' ' || has_function_privilege('service_role', p.oid, 'execute')
           || ' ' || exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0 and x.privilege_type = 'EXECUTE')
           || ' | ' || (select count(*) from pg_proc q where q.pronamespace = 'public'::regnamespace and q.proname = 'changer_droits_acces')
      into obs from pg_proc p where p.oid = to_regprocedure(huit);
    verdicts := verdicts || jsonb_build_object('rang', 2, 'etape', '2. la forme à huit : SECURITY DEFINER, chemin fixé, ni anon ni PUBLIC ; quatre formes', 'observe', obs,
      'ok', obs = 'true search_path=public false true true false | 4');

    -- 3 à 5. Le chef coche « Achats » sur A par la forme à huit, puis la décoche ; « Frais » sur B décochée, nul ailleurs.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    rendu := changer_droits_acces(acces_a, null, null, null, null, true, null, null);
    obs := concat_ws(' ', rendu.droit_ventes, rendu.droit_banque, rendu.droit_caisse, rendu.droit_comptes, rendu.droit_achats, rendu.droit_frais, rendu.droit_documents);
    perform changer_droits_acces(acces_a, null, null, null, null, false, null, null);
    perform changer_droits_acces(acces_b, null, null, null, null, null, false, null);
    reset role;
    perform set_config('request.jwt.claims', '', true);
    execute cases using acces_a into obs2;
    verdicts := verdicts || jsonb_build_object('rang', 3, 'etape', '3. le chef coche « Achats » (rendu), puis la décoche (relu) : les six autres cases inchangées', 'observe', obs || ' | ' || obs2,
      'ok', obs = 'f f f f t f f' and obs2 = 'f f f f f f f');
    execute cases using acces_b into obs;
    -- Une case changée seule, par le propriétaire sans session : le déclencheur doit nommer sa colonne pour la voir.
    update memberships set droit_frais = true where id = acces_a;
    verdicts := verdicts || jsonb_build_object('rang', 4, 'etape', '4. « Notes de frais » décochée sur B, les deux autres cases gardées (un droit nul est inchangé)', 'observe', obs,
      'ok', obs = 'f f f f t f t');
    execute trace using acces_a, acces_b, chef, dt, du into obs;
    verdicts := verdicts || jsonb_build_object('rang', 5, 'etape', '5. la trace : B arrive en « creation » sous ses trois cases, puis chaque case changée par le chef ; « Notes de frais » changée seule sur A, sans session', 'observe', obs,
      'ok', obs = 'A achats cochée changement par le chef, A achats décochée changement par le chef, A frais cochée changement par sans session, '
        || 'B achats cochée creation par sans session, '
        || 'B documents cochée creation par sans session, B frais décochée changement par le chef, B frais cochée creation par sans session');

    -- 6. Les formes à cinq, quatre et trois ne touchent pas les trois cases : « Comptes », « Caisse », « Banque » cochées sur B.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform changer_droits_acces(acces_a, null, null, null, true);
    perform changer_droits_acces(acces_b, null, null, true);
    perform changer_droits_acces(acces_b, null, true);
    reset role;
    perform set_config('request.jwt.claims', '', true);
    execute cases using acces_b into obs;
    execute cases using acces_a into obs2;
    verdicts := verdicts || jsonb_build_object('rang', 6, 'etape', '6. la forme à cinq coche « Comptes » sur A, celles à quatre et trois « Caisse » et « Banque » sur B : les trois cases restent telles qu''elles étaient', 'observe', 'B : ' || obs || ' | A : ' || obs2,
      'ok', obs = 'f t t f t f t' and obs2 = 'f f f t f t f');

    -- 7 à 9. Les refus de la forme à huit, dans l'ordre.
    for t in select * from (values
        (7, '7. aucun droit donné (sept nuls) : refusé (22023), les mots nomment les sept cases', chef, acces_a, '22023 ' || aucun_droit),
        (8, '8. le client lui-même, sur son accès : refusé (42501)', client, acces_b, '42501 Accès refusé à ce dossier.'),
        (9, '9. un accès qui n''existe pas : refusé (42501), les mêmes mots', chef, 'b1ca0000-0000-4000-8051-0000000000ff'::uuid, '42501 Accès refusé à ce dossier.')
      ) as x(rang, etape, qui, cible, attendu) loop
      begin
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', t.qui, 'role', 'authenticated')::text, true);
        if t.rang = 7 then
          perform changer_droits_acces(t.cible, null, null, null, null, null, null, null);
        else
          perform changer_droits_acces(t.cible, null, null, null, null, true, true, true);
        end if;
        code := 'ACCEPTÉ';
      exception when others then code := sqlstate || ' ' || sqlerrm;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      verdicts := verdicts || jsonb_build_object('rang', t.rang, 'etape', t.etape, 'observe', code, 'ok', code = t.attendu);
    end loop;

    -- 10 et 11. Ce que l'appelant lit de ses droits : le client sur DU (B porte « Achats » et « Documents ») et sur DT (A n'en
    --    porte aucune) ; le chef, le cabinet, sur DT.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    obs := concat_ws(' ', client_du_dossier(du, 'achats'), client_du_dossier(du, 'frais'), client_du_dossier(du, 'documents'),
      client_du_dossier(dt, 'achats'), client_du_dossier(dt, 'documents'), client_du_dossier(du, 'membre'), client_du_dossier(du, 'achat'),
      client_du_dossier(du, 'Achats'));
    obs2 := (select string_agg(k || '=' || v, ' ' order by k) from jsonb_each_text(droits_sur_le_dossier(du)) as e(k, v))
      || ' | ' || (select string_agg(k || '=' || v, ' ' order by k) from jsonb_each_text(droits_sur_le_dossier(dt)) as e(k, v)
                    where k in ('achats', 'frais', 'documents'));
    reset role;
    verdicts := verdicts || jsonb_build_object('rang', 10, 'etape', '10. client_du_dossier : la case de l''accès de l''appelant à CE dossier ; « membre » vrai ; tout autre mot faux', 'observe', obs,
      'ok', obs = 't f t f f t f f');
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    obs := (select string_agg(k || '=' || v, ' ' order by k) from jsonb_each_text(droits_sur_le_dossier(dt)) as e(k, v)
             where k in ('achats', 'frais', 'documents', 'cabinet'));
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('rang', 11, 'etape', '11. droits_sur_le_dossier : neuf clés ; le client sur DU (« Banque » et « Caisse » cochées au rang 6) et sur DT (« Notes de frais » au rang 4) ; le chef, cabinet du dossier, porte les trois', 'observe', obs2 || ' | le chef : ' || obs,
      'ok', obs2 = 'achats=true banque=true cabinet=false caisse=true comptes=false documents=true frais=false membre=true ventes=false | achats=false documents=false frais=true'
        and obs = 'achats=true cabinet=true documents=true frais=true');

    -- 12. B1 n'ouvre rien, au catalogue : aucune policy (de tous les schémas) ne nomme les trois mots ; aucune fonction hors des
    --     quatre de la migration ne lit les trois colonnes, ni ne porte les trois mots en appelant client_du_dossier ou
    --     droits_sur_le_dossier (la garde du retour, au mot près : le mot seul ne suffit pas, l'e-reporting porte 'achats').
    select coalesce((select string_agg(p.schemaname || '.' || p.tablename || '.' || p.policyname, ', ') from pg_policies p
              where coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') ~ ('''(' || mots || ')''')), 'aucune policy')
        || ' | ' || coalesce((select string_agg(p.proname, ', ' order by p.proname) from pg_proc p
              where p.pronamespace = 'public'::regnamespace
                and p.proname not in ('client_du_dossier', 'droits_sur_le_dossier', 'changer_droits_acces', 'tracer_les_droits')
                and (p.prosrc ~ ('droit_(' || mots || ')')
                     or (p.prosrc ~ ('''(' || mots || ')''') and p.prosrc ~ '(client_du_dossier|droits_sur_le_dossier)'))), 'aucune autre fonction')
      into obs;
    verdicts := verdicts || jsonb_build_object('rang', 12, 'etape', '12. B1 n''ouvre rien, au catalogue : ni policy ni autre fonction ne lit les trois cases', 'observe', obs,
      'ok', obs = 'aucune policy | aucune autre fonction');

    -- 13. … et par le geste : le client, ses trois cases cochées sur son dossier, voit table par table et dans le stockage
    --     exactement ce qu'il voit sans elles (seul l'écart est rendu).
    for n in 1 .. 2 loop
      update memberships set droit_achats = (n = 2), droit_frais = (n = 2), droit_documents = case when b2 then droit_documents else (n = 2) end
       where user_id = client and dossier_id = dossier_du_client;
      for t in select c.relname as nom from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
                where ns.nspname = 'public' and c.relkind = 'r' order by c.relname loop
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
        begin
          execute format('select count(*)::text from public.%I', t.nom) into obs;
        exception when others then obs := sqlstate;
        end;
        reset role;
        if n = 1 then vues_sans := vues_sans || jsonb_build_object(t.nom, obs); else vues_avec := vues_avec || jsonb_build_object(t.nom, obs); end if;
      end loop;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      begin
        select count(*)::text into obs from storage.objects;
      exception when others then obs := sqlstate;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      if n = 1 then vues_sans := vues_sans || jsonb_build_object('storage.objects', obs); else vues_avec := vues_avec || jsonb_build_object('storage.objects', obs); end if;
    end loop;
    select coalesce(string_agg(k, ', ' order by k), 'aucun') into obs
      from jsonb_each_text(vues_avec) as e(k, v) where v is distinct from vues_sans ->> k;
    verdicts := verdicts || jsonb_build_object('rang', 13, 'etape', '13. … et par le geste : les trois cases cochées, le client voit les mêmes lignes partout (tables de public et stockage)',
      'observe', 'écarts : ' || obs || ' (' || (select count(*) from jsonb_object_keys(vues_avec)) || ' relations comparées)',
      'ok', obs = 'aucun' and (select count(*) from jsonb_object_keys(vues_avec)) > 50);

    -- 14. Le client lit ses cases sur sa ligne, et ne les écrit pas en direct (aucune policy de mise à jour : aucune ligne).
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select concat_ws(' ', m.droit_achats, m.droit_frais, m.droit_documents) into obs from memberships m where m.id = acces_b;
    with x as (update memberships set droit_frais = true where id in (acces_a, acces_b) returning 1) select count(*)::text into obs2 from x;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('rang', 14, 'etape', '14. le client lit ses trois cases sur sa ligne ; il ne les écrit pas (aucune ligne touchée)', 'observe', obs || ' | ' || obs2 || ' écrite(s)',
      'ok', obs = 't f t' and obs2 = '0');

    -- 15. La trace connaît les sept cases : la contrainte, le déclencheur.
    select (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = 'public.trace_des_droits'::regclass and c.conname = 'trace_des_droits_droit')
        || ' | ' || (select pg_get_triggerdef(tg.oid) from pg_trigger tg where tg.tgname = 'memberships_trace_des_droits' and not tg.tgisinternal)
      into obs;
    verdicts := verdicts || jsonb_build_object('rang', 15, 'etape', '15. la trace admet et nomme les sept cases (la contrainte du droit, le déclencheur)', 'observe', obs,
      'ok', obs = 'CHECK ((droit = ANY (ARRAY[''ventes''::text, ''banque''::text, ''caisse''::text, ''comptes''::text, ''achats''::text, ''frais''::text, ''documents''::text]))) | '
        || 'CREATE TRIGGER memberships_trace_des_droits AFTER INSERT OR DELETE OR UPDATE OF droit_ventes, droit_banque, droit_caisse, droit_comptes, droit_achats, droit_frais, droit_documents, dossier_id, user_id, id ON public.memberships FOR EACH ROW EXECUTE FUNCTION tracer_les_droits()');

    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    reset role;
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      verdicts := verdicts || jsonb_build_object('rang', 98, 'etape', '98. le jeu s''est déroulé jusqu''au bout', 'ok', false, 'observe', sqlstate || ' ' || sqlerrm);
    end if;
  end;
  perform set_config('request.jwt.claims', '', true);

  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni leurs accès, ni leur trace, ni les cases du client du jeu',
    'ok', not exists (select 1 from dossiers where id in (dt, du))
      and not exists (select 1 from memberships where id in (acces_a, acces_b))
      and not exists (select 1 from trace_des_droits where dossier_id in (dt, du))
      and not exists (select 1 from memberships where user_id = client and (droit_achats or droit_frais or droit_documents)),
    'observe', 'relu');
  perform set_config('essai.trois_cases', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.trois_cases')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
