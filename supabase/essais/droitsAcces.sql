-- LES DROITS D'UN ACCÈS CLIENT, ÉPROUVÉS EN BASE (espace client, étape P1) — à rejouer par `execute_sql` après toute
-- migration qui touche `memberships`, ses policies, `admin_du_dossier`, `client_du_dossier`, `gere_les_ventes`,
-- `gere_la_banque`, `droits_sur_le_dossier` ou `changer_droits_acces`.
--
-- Ce qui se prouve ici, par impersonation de sept profils — anonyme, compte rattaché à rien, client du dossier, client
-- d'un autre dossier, chef du cabinet, membre du cabinet affecté au dossier, membre affecté à un AUTRE dossier :
--   - la table de vérité des quatre fonctions de lecture, profil par profil et droit par droit : un droit ne vaut que pour
--     SON accès, un mot inconnu ne vaut rien, le cabinet du dossier les a tous, l'anonyme n'atteint aucune fonction ;
--   - le client lit ses seules lignes de `memberships`, droits compris — jamais l'accès d'une autre personne ;
--   - le client ne change pas ses droits : un `update` sans policy ne lève pas, il ne touche aucune ligne — l'essai RELIT
--     la ligne ; il ne s'écrit pas un accès ; le chef non plus ne passe pas par un `update` : la fonction est le seul
--     chemin ;
--   - `changer_droits_acces` refuse en 42501 tout profil qui n'est pas `admin_du_dossier` du dossier de l'accès — un
--     accès qui n'existe pas sous les mêmes mots —, accepte le chef et le membre affecté, n'écrit que les deux colonnes,
--     garde le droit qu'on ne lui donne pas, et rend l'accès relu ;
--   - et que RIEN ne reste en base.
--
-- LE CHEF D'ESSAI ET LES MEMBRES D'ESSAI sont le compte client du jeu, rattaché au cabinet le temps d'un bloc qui
-- s'annule — la base n'a qu'un chef, qui est aussi super-administrateur, et aucun membre affecté. L'accès d'une AUTRE
-- personne est un accès d'essai donné au compte du chef, le temps d'un bloc. Rien n'élargit un droit hors de ces blocs.
-- Chaque contrôle s'annule dans sa sous-transaction (`ANNULATION_ESSAI`, P0001), le verdict étant posé dans une VARIABLE
-- avant le `raise` — le mécanisme de rls.sql. Les verdicts voyagent dans un réglage LOCAL à la transaction
-- (`essai.droits_acces`), que la requête finale lit : le fichier se joue d'un seul appel et ne crée aucune table. Il ne
-- porte AUCUNE instruction de suppression.
--
-- LA SIGNATURE d'un profil sur un dossier tient en neuf chiffres, dans cet ordre :
--   client_du_dossier « membre », « ventes », « banque » | gere_les_ventes, gere_la_banque |
--   droits_sur_le_dossier : cabinet, membre, ventes, banque.
--
-- LES MUTATIONS (contrôles 50 à 58) rejouent un contrôle avec un profil, un droit ou un réglage délibérément faux :
-- chacune doit MORDRE, sans quoi le contrôle qu'elle vise ne regarde rien.
--
-- Passage du 09/10/2026, en production, juste après la migration `droits_des_acces_clients` (version 20261009224031) :
-- 43 verdicts verts et 2 lignes d'information, dont les neuf mutations qui mordent ; rien de resté en base ; le texte
-- reçu est ce fichier sans ses lignes de commentaire, saut de ligne final compris (36 401 caractères, empreinte
-- 861960c6ae0f236ce961ef7bb31735c9). Sans la migration, sur une réplique partielle locale, l'essai échoue dès le contrôle
-- 0b (colonne inconnue) ; dix-huit mutations de la migration, jouées sur la même réplique (un défaut vrai, une colonne
-- nullable, un mot inconnu qui vaut tout, un droit lu dans l'autre colonne, un prédicat sur « membre », le client oublié,
-- l'écriture sans contrôle d'accès, un accès inconnu dit « introuvable », un droit nul écrit nul, une autre colonne
-- écrite, l'exécution laissée à anon ou à PUBLIC, une policy de mise à jour, l'exécution retirée à authenticated, une
-- fonction `security invoker`, « rien à changer » accepté, la casse ignorée), font toutes virer au moins un verdict.
do $$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  inconnu uuid := gen_random_uuid();

  cabinet uuid; dossier_client uuid; dossier_client_2 uuid; autre_dossier uuid; troisieme_dossier uuid;
  acces_client uuid; acces_client_2 uuid; acces_essai uuid;
  instantane jsonb; admins_avant int; assignations_avant int; supers_avant int;
  t record; n int; m int; sig text; code_recu text; message text; obs text; avant jsonb; apres jsonb; rendu jsonb;
  verdicts jsonb := '[]'::jsonb;
begin
  select mb.dossier_id, mb.id into dossier_client, acces_client from memberships mb where mb.user_id = client
    order by mb.dossier_id limit 1;
  select mb.dossier_id, mb.id into dossier_client_2, acces_client_2 from memberships mb where mb.user_id = client
    and mb.dossier_id <> dossier_client order by mb.dossier_id limit 1;
  select cabinet_id into cabinet from dossiers where id = dossier_client;
  select d.id into autre_dossier from dossiers d where d.cabinet_id = cabinet
    and not exists (select 1 from memberships mb where mb.dossier_id = d.id and mb.user_id = client) order by d.id limit 1;
  select d.id into troisieme_dossier from dossiers d where d.cabinet_id = cabinet and d.id <> autre_dossier
    and not exists (select 1 from memberships mb where mb.dossier_id = d.id and mb.user_id = client) order by d.id limit 1;
  if dossier_client is null or dossier_client_2 is null or cabinet is null or autre_dossier is null or troisieme_dossier is null
     or (select cabinet_id from dossiers where id = dossier_client_2) <> cabinet
     or not exists (select 1 from cabinet_admins where user_id = chef and cabinet_id = cabinet and role = 'comptable_en_chef')
     or not exists (select 1 from super_admins where user_id = chef)
     or exists (select 1 from cabinet_admins where user_id = client) or exists (select 1 from super_admins where user_id = client)
     or exists (select 1 from memberships where user_id = chef) then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable, ou comptes déjà rattachés autrement qu''attendu';
  end if;
  select coalesce(jsonb_agg(to_jsonb(mb) order by mb.id), '[]'::jsonb) into instantane from memberships mb;
  select count(*) into admins_avant from cabinet_admins;
  select count(*) into assignations_avant from dossier_assignations;
  select count(*) into supers_avant from super_admins;

  -- ══ 0 à 4. Le catalogue ═════════════════════════════════════════════════════════════════════════════════════
  select count(*) filter (where droit_ventes), count(*) filter (where droit_banque) into n, m from memberships;
  verdicts := verdicts || jsonb_build_object('controle', '0b. information : les accès en base et leurs droits',
    'observe', (select count(*) from memberships) || ' accès, ' || n || ' avec « Ventes », ' || m || ' avec « Banque »', 'ok', true);

  select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then ' non nulle' else ' NULLABLE' end
           || ' défaut ' || coalesce(pg_get_expr(d.adbin, d.adrelid), 'aucun'), ', ' order by a.attname)
    into obs
    from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = 'public.memberships'::regclass and a.attname in ('droit_ventes', 'droit_banque') and not a.attisdropped;
  verdicts := verdicts || jsonb_build_object('controle', '1. les deux droits : booléens, non nuls, faux par défaut',
    'observe', coalesce(obs, 'colonnes absentes'),
    'ok', coalesce(obs = 'droit_banque boolean non nulle défaut false, droit_ventes boolean non nulle défaut false', false));

  select string_agg(po.polname || ' ' || po.polcmd::text, ', ' order by po.polname) into obs
    from pg_policy po where po.polrelid = 'public.memberships'::regclass;
  verdicts := verdicts || jsonb_build_object('controle', '2. aucune policy de mise à jour sur memberships, pour personne : les trois d''avant (lecture, insertion, suppression)',
    'observe', coalesce(obs, 'aucune') || ', RLS ' || (select relrowsecurity from pg_class where oid = 'public.memberships'::regclass),
    'ok', coalesce(obs = 'memberships_delete d, memberships_select r, memberships_write a'
      and (select relrowsecurity from pg_class where oid = 'public.memberships'::regclass), false));

  select count(*) filter (where p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
                             and p.provolatile = case when p.proname = 'changer_droits_acces' then 'v' else 's' end),
         count(*)
    into n, m
    from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('client_du_dossier', 'gere_les_ventes', 'gere_la_banque', 'droits_sur_le_dossier', 'changer_droits_acces');
  verdicts := verdicts || jsonb_build_object('controle', '3. les cinq fonctions : SECURITY DEFINER, search_path fixé ; les quatre lectures stables',
    'observe', n || ' conforme(s) sur ' || m, 'ok', n = 5 and m = 5);

  select string_agg(p.proname, ', ' order by p.proname) filter (where has_function_privilege('anon', p.oid, 'execute')
           or exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0 and x.privilege_type = 'EXECUTE')
           or not has_function_privilege('authenticated', p.oid, 'execute')
           or not has_function_privilege('service_role', p.oid, 'execute')),
         count(*)
    into obs, n
    from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('client_du_dossier', 'gere_les_ventes', 'gere_la_banque', 'droits_sur_le_dossier', 'changer_droits_acces');
  verdicts := verdicts || jsonb_build_object('controle', '4. aucune des cinq ne s''exécute par anon ni PUBLIC ; authenticated et service_role les exécutent',
    'observe', n || ' fonction(s), en faute : ' || coalesce(obs, 'aucune'), 'ok', n = 5 and obs is null);

  -- ══ 6. Le client lit ses seules lignes ═════════════════════════════════════════════════════════════════════
  -- L'accès d'une autre personne à SON dossier (le compte du chef, le temps du bloc) ne lui est pas rendu ; ses deux
  -- accès le sont, droits compris.
  n := null; m := null; code_recu := null;
  begin
    insert into memberships (user_id, dossier_id, role, email) values (chef, dossier_client, 'client', 'essai-droits@exemple.invalid');
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into n from memberships where dossier_id = dossier_client;
    select count(*) into m from memberships where user_id = client and droit_ventes is not null and droit_banque is not null;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '6. le client lit ses seules lignes de memberships, droits compris : pas l''accès d''une autre personne à son dossier',
    'observe', coalesce(n::text, '?') || ' ligne(s) vue(s) sur son dossier (2 en base, dont la sienne), ' || coalesce(m::text, '?')
      || ' accès à lui avec leurs droits, ' || coalesce(code_recu, '?'),
    'ok', coalesce(n = 1 and m = 2 and code_recu = 'P0001', false));

  -- ══ 10. L'anonyme n'atteint aucune des cinq fonctions ══════════════════════════════════════════════════════
  obs := '';
  for t in select * from (values
      ('client_du_dossier', 'select client_du_dossier($1, ''membre'')::text'),
      ('gere_les_ventes', 'select gere_les_ventes($1)::text'),
      ('gere_la_banque', 'select gere_la_banque($1)::text'),
      ('droits_sur_le_dossier', 'select droits_sur_le_dossier($1)::text'),
      ('changer_droits_acces', 'select changer_droits_acces($2, true, true)::text')) as v(fonction, appel) loop
    code_recu := null; message := null; sig := null;
    begin
      set local role anon;
      perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      execute t.appel into sig using dossier_client, acces_client;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    if not (code_recu = '42501' and message = 'permission denied for function ' || t.fonction) then
      obs := obs || t.fonction || ' (' || coalesce(code_recu, '?') || ' ' || coalesce(message, '') || ' ' || coalesce(sig, '') || ') ';
    end if;
  end loop;
  verdicts := verdicts || jsonb_build_object('controle', '10. l''anonyme n''exécute aucune des cinq : refus du droit d''exécution (42501, permission denied)',
    'observe', case when obs = '' then 'cinq refus' else 'en faute : ' || obs end, 'ok', obs = '');

  -- ══ 11 à 22. La table de vérité ═════════════════════════════════════════════════════════════════════════════
  for t in select * from (values
      ('11', 'compte rattaché à rien, sur le dossier du client', inconnu, dossier_client, 'aucun', '000|00|0000'),
      ('12', 'client du dossier, sans droit', client, dossier_client, 'sans', '100|00|0100'),
      ('13', 'client du dossier, droit « Ventes » seul', client, dossier_client, 'ventes', '110|10|0110'),
      ('14', 'client du dossier, droit « Banque » seul', client, dossier_client, 'banque', '101|01|0101'),
      ('15', 'client du dossier, les deux droits', client, dossier_client, 'deux', '111|11|0111'),
      ('17', 'le droit vaut pour SON accès : les deux droits sur un dossier, son autre accès sans droit', client, dossier_client_2, 'deux', '100|00|0100'),
      ('18', 'client d''un autre dossier (les deux droits sur ses accès), sur un dossier où il n''a pas d''accès', client, autre_dossier, 'tous', '000|00|0000'),
      ('19', 'chef du cabinet (super-administrateur), sur le dossier du client', chef, dossier_client, 'aucun', '000|11|1011'),
      ('20', 'chef du cabinet qui n''est pas super-administrateur', client, autre_dossier, 'chef', '000|11|1011'),
      ('21', 'membre du cabinet affecté au dossier', client, autre_dossier, 'membre_affecte', '000|11|1011'),
      ('22', 'membre du cabinet affecté à un autre dossier', client, autre_dossier, 'membre_ailleurs', '000|00|0000')
    ) as v(num, profil, sujet, dossier, reglage, attendu) loop
    sig := null; code_recu := null; message := null;
    begin
      case t.reglage
        when 'aucun' then null;
        when 'sans' then update memberships set droit_ventes = false, droit_banque = false where user_id = client;
        when 'ventes' then update memberships set droit_ventes = (id = acces_client), droit_banque = false where user_id = client;
        when 'banque' then update memberships set droit_ventes = false, droit_banque = (id = acces_client) where user_id = client;
        when 'deux' then update memberships set droit_ventes = (id = acces_client), droit_banque = (id = acces_client) where user_id = client;
        when 'tous' then update memberships set droit_ventes = true, droit_banque = true where user_id = client;
        when 'chef' then insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable_en_chef');
        when 'membre_affecte' then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable');
          insert into dossier_assignations (dossier_id, user_id) values (autre_dossier, client);
        when 'membre_ailleurs' then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable');
          insert into dossier_assignations (dossier_id, user_id) values (troisieme_dossier, client);
      end case;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', t.sujet, 'role', 'authenticated')::text, true);
      select concat_ws('|',
               concat(client_du_dossier(t.dossier, 'membre')::int, client_du_dossier(t.dossier, 'ventes')::int, client_du_dossier(t.dossier, 'banque')::int),
               concat(gere_les_ventes(t.dossier)::int, gere_la_banque(t.dossier)::int),
               concat((x ->> 'cabinet')::boolean::int, (x ->> 'membre')::boolean::int, (x ->> 'ventes')::boolean::int, (x ->> 'banque')::boolean::int)
             ) || case when is_super_admin() then ' super' else '' end
        into sig
        from (select droits_sur_le_dossier(t.dossier) as x) s;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', t.num || '. ' || t.profil || ' : ' || t.attendu,
      'observe', coalesce(sig, '?') || ', ' || coalesce(code_recu, '?') || case when code_recu = 'P0001' then '' else ' ' || coalesce(message, '') end,
      'ok', coalesce(split_part(sig, ' ', 1) = t.attendu and (sig like '% super') = (t.num = '19') and code_recu = 'P0001', false));
  end loop;

  -- Un mot que la fonction ne connaît pas ne vaut rien, même quand l'accès porte les deux droits.
  n := null; code_recu := null;
  begin
    update memberships set droit_ventes = true, droit_banque = true where user_id = client;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) filter (where client_du_dossier(dossier_client, w)) into n
      from unnest(array['Ventes', 'VENTES', ' ventes', 'vente', 'Banque', 'cabinet', 'tout', '', null]) as w;
    m := client_du_dossier(dossier_client, 'ventes')::int + client_du_dossier(dossier_client, 'banque')::int;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '16. un mot inconnu (casse, espace, singulier, nul) ne vaut rien, même avec les deux droits',
    'observe', coalesce(n::text, '?') || ' vrai(s) sur 9 mots inconnus, ' || coalesce(m::text, '?') || ' sur les 2 mots connus, ' || coalesce(code_recu, '?'),
    'ok', coalesce(n = 0 and m = 2 and code_recu = 'P0001', false));

  -- ══ 30 à 37. Ce qui n'écrit pas les droits ══════════════════════════════════════════════════════════════════
  -- Chaque refus de `changer_droits_acces` est exigé par son code ET ses mots, et la ligne visée est RELUE après.
  for t in select * from (values
      ('31', 'compte rattaché à rien, sur l''accès du client', inconnu, 'client', 'aucun'),
      ('32', 'client du dossier, sur SON accès', client, 'client', 'aucun'),
      ('33', 'client d''un autre dossier, sur l''accès d''une autre personne à un dossier où il n''en a pas', client, 'essai', 'aucun'),
      ('34', 'membre du cabinet affecté à un autre dossier, sur un accès de ce dossier-ci', client, 'essai', 'membre_ailleurs')
    ) as v(num, profil, sujet, cible, reglage) loop
    code_recu := null; message := null; avant := null; apres := null; acces_essai := null;
    begin
      insert into memberships (user_id, dossier_id, role, email) values (chef, autre_dossier, 'client', 'essai-droits@exemple.invalid')
        returning id into acces_essai;
      if t.reglage = 'membre_ailleurs' then
        insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable');
        insert into dossier_assignations (dossier_id, user_id) values (troisieme_dossier, client);
      end if;
      select to_jsonb(mb) into avant from memberships mb where mb.id = case t.cible when 'client' then acces_client else acces_essai end;
      begin
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', t.sujet, 'role', 'authenticated')::text, true);
        perform changer_droits_acces(case t.cible when 'client' then acces_client else acces_essai end, true, true);
        code_recu := 'ACCEPTÉ';
      exception when others then code_recu := sqlstate; message := sqlerrm;
      end;
      reset role;
      select to_jsonb(mb) into apres from memberships mb where mb.id = case t.cible when 'client' then acces_client else acces_essai end;
      raise exception 'ANNULATION_ESSAI';
    exception when sqlstate 'P0001' then null;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', t.num || '. ' || t.profil || ' : changer_droits_acces refusé (42501), la ligne relue n''a pas changé',
      'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, '') || ', ligne ' || case when avant is null then 'introuvable' when avant = apres then 'inchangée' else 'CHANGÉE' end,
      'ok', coalesce(code_recu = '42501' and message = 'Accès refusé à ce dossier.' and avant is not null and avant = apres, false));
  end loop;

  -- L'anonyme sur l'accès du client : refusé par le droit d'exécution (contrôle 10), et la ligne n'a pas bougé.
  code_recu := null; message := null; avant := null; apres := null;
  select to_jsonb(mb) into avant from memberships mb where mb.id = acces_client;
  begin
    set local role anon;
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    perform changer_droits_acces(acces_client, true, true);
    code_recu := 'ACCEPTÉ';
    raise exception 'ANNULATION_ESSAI';
  exception when others then
    if code_recu is null then code_recu := sqlstate; message := sqlerrm; end if;
  end;
  reset role;
  select to_jsonb(mb) into apres from memberships mb where mb.id = acces_client;
  verdicts := verdicts || jsonb_build_object('controle', '30. l''anonyme, sur l''accès du client : refusé par le droit d''exécution (42501), la ligne relue n''a pas changé',
    'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, '') || ', ligne ' || case when avant = apres then 'inchangée' else 'CHANGÉE' end,
    'ok', coalesce(code_recu = '42501' and message = 'permission denied for function changer_droits_acces' and avant = apres, false));

  -- Un `update` sans policy ne lève pas : il ne touche aucune ligne. On RELIT la ligne.
  n := null; code_recu := null; message := null; avant := null; apres := null;
  begin
    update memberships set droit_ventes = false, droit_banque = false where id = acces_client;
    select to_jsonb(mb) into avant from memberships mb where mb.id = acces_client;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    update memberships set droit_ventes = true, droit_banque = true where id = acces_client;
    get diagnostics n = row_count;
    reset role;
    select to_jsonb(mb) into apres from memberships mb where mb.id = acces_client;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '35. le client ne se donne pas un droit : son update ne touche aucune ligne, sans erreur, et la ligne relue n''a pas changé',
    'observe', coalesce(n::text, '?') || ' ligne(s) touchée(s), ligne ' || case when avant is null then '?' when avant = apres then 'inchangée' else 'CHANGÉE' end
      || ', ' || coalesce(code_recu, '?') || case when code_recu = 'P0001' then '' else ' ' || coalesce(message, '') end,
    'ok', coalesce(n = 0 and avant = apres and (apres ->> 'droit_ventes') = 'false' and code_recu = 'P0001', false));

  code_recu := null; message := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    insert into memberships (user_id, dossier_id, role, droit_ventes, droit_banque) values (client, autre_dossier, 'client', true, true);
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '36. le client ne s''écrit pas un accès portant les deux droits : refusé par la policy (42501)',
    'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''), 'ok', coalesce(code_recu = '42501', false));

  n := null; code_recu := null; avant := null; apres := null;
  begin
    select to_jsonb(mb) into avant from memberships mb where mb.id = acces_client;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    update memberships set droit_ventes = not droit_ventes, droit_banque = not droit_banque where id = acces_client;
    get diagnostics n = row_count;
    reset role;
    select to_jsonb(mb) into apres from memberships mb where mb.id = acces_client;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '37. le chef lui-même ne change pas un droit par un update direct : la fonction est le seul chemin',
    'observe', coalesce(n::text, '?') || ' ligne(s) touchée(s), ligne ' || case when avant = apres then 'inchangée' else 'CHANGÉE' end || ', ' || coalesce(code_recu, '?'),
    'ok', coalesce(n = 0 and avant = apres and code_recu = 'P0001', false));

  -- ══ 38 à 44. Ce qui écrit les droits ════════════════════════════════════════════════════════════════════════
  -- Le chef : accepté, l'accès rendu est celui qu'on relit, et seules les deux colonnes ont changé.
  code_recu := null; message := null; avant := null; apres := null; rendu := null;
  begin
    update memberships set droit_ventes = false, droit_banque = false where id = acces_client;
    select to_jsonb(mb) into avant from memberships mb where mb.id = acces_client;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select to_jsonb(r) into rendu from changer_droits_acces(acces_client, true, true) r;
    reset role;
    select to_jsonb(mb) into apres from memberships mb where mb.id = acces_client;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '38. le chef change les droits : l''accès rendu est l''accès relu, aux droits demandés, et rien d''autre n''a changé',
    'observe', 'rendu ' || case when rendu is null then 'aucun' when rendu = apres then '= relu' else '≠ relu' end
      || ', droits ' || coalesce(apres ->> 'droit_ventes', '?') || '/' || coalesce(apres ->> 'droit_banque', '?')
      || ', autres colonnes ' || case when avant - 'droit_ventes' - 'droit_banque' = apres - 'droit_ventes' - 'droit_banque' then 'identiques' else 'CHANGÉES' end
      || ', ' || coalesce(code_recu, '?') || case when code_recu = 'P0001' then '' else ' ' || coalesce(message, '') end,
    'ok', coalesce(rendu = apres and (apres ->> 'droit_ventes') = 'true' and (apres ->> 'droit_banque') = 'true'
      and avant - 'droit_ventes' - 'droit_banque' = apres - 'droit_ventes' - 'droit_banque' and code_recu = 'P0001', false));

  -- Un droit nul reste tel quel : « Ventes » seul, puis « Banque » seul — le premier n'est pas défait par le second.
  obs := null; code_recu := null; message := null;
  begin
    update memberships set droit_ventes = false, droit_banque = false where id = acces_client;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select r.droit_ventes::int || '' || r.droit_banque::int into obs from changer_droits_acces(acces_client, true, null) r;
    select obs || ' puis ' || r.droit_ventes::int || r.droit_banque::int into obs from changer_droits_acces(acces_client, null, true) r;
    select obs || ' puis ' || r.droit_ventes::int || r.droit_banque::int into obs from changer_droits_acces(acces_client, false, null) r;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '39. un droit nul reste tel quel : « Ventes » seul, « Banque » seul, puis « Ventes » retiré',
    'observe', coalesce(obs, '?') || ', ' || coalesce(code_recu, '?') || case when code_recu = 'P0001' then '' else ' ' || coalesce(message, '') end,
    'ok', coalesce(obs = '10 puis 11 puis 01' and code_recu = 'P0001', false));

  for t in select * from (values
      ('40', 'aucun droit donné (les deux nuls) : refusé (22023)', '22023', 'Aucun droit à changer : précise « Ventes », « Banque », ou les deux.'),
      ('41', 'un accès qui n''existe pas : refusé sous les mêmes mots qu''un accès interdit (42501)', '42501', 'Accès refusé à ce dossier.')
    ) as v(num, quoi, code, mots) loop
    code_recu := null; message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      if t.num = '40' then perform changer_droits_acces(acces_client, null, null);
      else perform changer_droits_acces(gen_random_uuid(), true, true);
      end if;
      code_recu := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then
      if code_recu is null then code_recu := sqlstate; message := sqlerrm; end if;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', t.num || '. le chef, ' || t.quoi,
      'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''), 'ok', coalesce(code_recu = t.code and message = t.mots, false));
  end loop;

  for t in select * from (values
      ('42', 'le chef du cabinet qui n''est pas super-administrateur', 'chef'),
      ('43', 'le membre du cabinet affecté au dossier de l''accès', 'membre_affecte')
    ) as v(num, profil, reglage) loop
    code_recu := null; message := null; rendu := null; apres := null; acces_essai := null; obs := null;
    begin
      insert into memberships (user_id, dossier_id, role, email) values (chef, autre_dossier, 'client', 'essai-droits@exemple.invalid')
        returning id into acces_essai;
      if t.reglage = 'chef' then
        insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable_en_chef');
      else
        insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable');
        insert into dossier_assignations (dossier_id, user_id) values (autre_dossier, client);
      end if;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      obs := 'super-administrateur ' || is_super_admin();
      select to_jsonb(r) into rendu from changer_droits_acces(acces_essai, false, true) r;
      reset role;
      select to_jsonb(mb) into apres from memberships mb where mb.id = acces_essai;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', t.num || '. ' || t.profil || ' change les droits d''un accès de ce dossier',
      'observe', coalesce(obs, '?') || ', droits relus ' || coalesce(apres ->> 'droit_ventes', '?') || '/' || coalesce(apres ->> 'droit_banque', '?')
        || ', rendu ' || case when rendu is null then 'aucun' when rendu = apres then '= relu' else '≠ relu' end
        || ', ' || coalesce(code_recu, '?') || case when code_recu = 'P0001' then '' else ' ' || coalesce(message, '') end,
      'ok', coalesce(obs = 'super-administrateur false' and rendu = apres and (apres ->> 'droit_ventes') = 'false'
        and (apres ->> 'droit_banque') = 'true' and code_recu = 'P0001', false));
  end loop;

  -- Ce que le cabinet a posé, le client le LIT sur sa ligne : c'est ce qu'AuthContext lira.
  n := null; code_recu := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform changer_droits_acces(acces_client, true, false);
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into n from memberships where id = acces_client and droit_ventes and not droit_banque;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '44. le droit posé par le cabinet, le client le lit sur sa propre ligne',
    'observe', coalesce(n::text, '?') || ' ligne(s), ' || coalesce(code_recu, '?'), 'ok', coalesce(n = 1 and code_recu = 'P0001', false));

  -- ══ 50 à 58. Les mutations : chacune doit MORDRE ═══════════════════════════════════════════════════════════
  -- 50. Le contrôle 12 joué sous le chef : la signature n'est plus celle du client sans droit.
  sig := null;
  begin
    update memberships set droit_ventes = false, droit_banque = false where user_id = client;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select concat_ws('|', concat(client_du_dossier(dossier_client, 'membre')::int, client_du_dossier(dossier_client, 'ventes')::int,
             client_du_dossier(dossier_client, 'banque')::int), concat(gere_les_ventes(dossier_client)::int, gere_la_banque(dossier_client)::int))
      into sig;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '50. MUTATION — le contrôle 12 joué sous le chef : la signature doit changer',
    'observe', coalesce(sig, '?'), 'ok', coalesce(sig <> '100|00', false));

  -- 51. Le contrôle 18 joué sur le dossier du client : `membre` et les deux droits doivent valoir vrai.
  sig := null;
  begin
    update memberships set droit_ventes = true, droit_banque = true where user_id = client;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select concat(client_du_dossier(dossier_client, 'membre')::int, client_du_dossier(dossier_client, 'ventes')::int,
             client_du_dossier(dossier_client, 'banque')::int) into sig;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '51. MUTATION — le contrôle 18 joué sur le dossier du client : il doit y être membre, avec ses droits',
    'observe', coalesce(sig, '?'), 'ok', coalesce(sig = '111', false));

  -- 52. Le contrôle 32 joué sous le chef : l'écriture passe.
  code_recu := null; rendu := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select to_jsonb(r) into rendu from changer_droits_acces(acces_client, true, true) r;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '52. MUTATION — le contrôle 32 joué sous le chef : l''écriture doit passer',
    'observe', case when rendu is null then 'refusée' else 'acceptée' end, 'ok', rendu is not null);

  -- 53. Le contrôle 35 sans le changement de rôle (le propriétaire passe la RLS) : la ligne est touchée.
  n := null;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    update memberships set droit_ventes = true, droit_banque = true where id = acces_client;
    get diagnostics n = row_count;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  verdicts := verdicts || jsonb_build_object('controle', '53. MUTATION — le contrôle 35 sans le changement de rôle : la ligne doit être touchée',
    'observe', coalesce(n::text, '?') || ' ligne(s)', 'ok', coalesce(n = 1, false));

  -- 54. Le contrôle 30 avec le droit d'exécution rendu à anon, le temps d'une sous-transaction annulée — la migration
  -- défaite : l'appel atteint la fonction, et le refus n'est plus celui du droit d'exécution.
  code_recu := null; message := null;
  begin
    grant execute on function changer_droits_acces(uuid, boolean, boolean) to anon;
    set local role anon;
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    perform changer_droits_acces(acces_client, true, true);
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '54. MUTATION — le contrôle 30 avec le droit d''exécution rendu à anon : le refus ne doit plus être celui du droit d''exécution',
    'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, '') || ', droit rendu annulé : '
      || (not has_function_privilege('anon', 'public.changer_droits_acces(uuid, boolean, boolean)', 'execute')),
    'ok', coalesce(message <> 'permission denied for function changer_droits_acces'
      and not has_function_privilege('anon', 'public.changer_droits_acces(uuid, boolean, boolean)', 'execute'), false));

  -- 55. Le contrôle 38 quand une autre colonne change aussi (l'adresse, écrite par le propriétaire) : la comparaison le voit.
  avant := null; apres := null;
  begin
    select to_jsonb(mb) into avant from memberships mb where mb.id = acces_client;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform changer_droits_acces(acces_client, true, true);
    reset role;
    update memberships set email = 'mutation@exemple.invalid' where id = acces_client;
    select to_jsonb(mb) into apres from memberships mb where mb.id = acces_client;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '55. MUTATION — le contrôle 38 quand l''adresse change aussi : les autres colonnes doivent différer',
    'observe', case when avant - 'droit_ventes' - 'droit_banque' = apres - 'droit_ventes' - 'droit_banque' then 'identiques' else 'différentes' end,
    'ok', coalesce(avant - 'droit_ventes' - 'droit_banque' <> apres - 'droit_ventes' - 'droit_banque', false));

  -- 56. Le contrôle 41 sur un accès qui existe : l'écriture passe.
  rendu := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select to_jsonb(r) into rendu from changer_droits_acces(acces_client_2, true, true) r;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '56. MUTATION — le contrôle 41 sur un accès qui existe : l''écriture doit passer',
    'observe', case when rendu is null then 'refusée' else 'acceptée' end, 'ok', rendu is not null);

  -- 57. Le contrôle 34 avec l'affectation au BON dossier : l'écriture passe.
  rendu := null;
  begin
    insert into memberships (user_id, dossier_id, role, email) values (chef, autre_dossier, 'client', 'essai-droits@exemple.invalid')
      returning id into acces_essai;
    insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable');
    insert into dossier_assignations (dossier_id, user_id) values (autre_dossier, client);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select to_jsonb(r) into rendu from changer_droits_acces(acces_essai, true, true) r;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '57. MUTATION — le contrôle 34 affecté au bon dossier : l''écriture doit passer',
    'observe', case when rendu is null then 'refusée' else 'acceptée' end, 'ok', rendu is not null);

  -- 58. Le contrôle 6 joué sous le chef : il voit l'accès de l'autre personne.
  n := null;
  begin
    insert into memberships (user_id, dossier_id, role, email) values (chef, dossier_client, 'client', 'essai-droits@exemple.invalid');
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select count(*) into n from memberships where dossier_id = dossier_client;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '58. MUTATION — le contrôle 6 joué sous le chef : il doit voir les deux accès du dossier',
    'observe', coalesce(n::text, '?') || ' ligne(s)', 'ok', coalesce(n = 2, false));

  -- ══ 60. Rien n'est resté ════════════════════════════════════════════════════════════════════════════════════
  select coalesce(jsonb_agg(to_jsonb(mb) order by mb.id), '[]'::jsonb) into apres from memberships mb;
  verdicts := verdicts || jsonb_build_object('controle', '60. rien n''est resté en base',
    'observe', 'accès ' || case when apres = instantane then 'identiques, droits compris' else 'CHANGÉS' end
      || ', chefs et membres ' || admins_avant || ' -> ' || (select count(*) from cabinet_admins)
      || ', affectations ' || assignations_avant || ' -> ' || (select count(*) from dossier_assignations)
      || ', super-administrateurs ' || supers_avant || ' -> ' || (select count(*) from super_admins)
      || ', droit d''exécution d''anon ' || has_function_privilege('anon', 'public.changer_droits_acces(uuid, boolean, boolean)', 'execute'),
    'ok', coalesce(apres = instantane
      and admins_avant = (select count(*) from cabinet_admins)
      and assignations_avant = (select count(*) from dossier_assignations)
      and supers_avant = (select count(*) from super_admins)
      and not exists (select 1 from cabinet_admins where user_id = client)
      and not has_function_privilege('anon', 'public.changer_droits_acces(uuid, boolean, boolean)', 'execute'), false));

  perform set_config('essai.droits_acces', verdicts::text, true);
end $$;

-- Un verdict qui n'a pas pu se calculer est une faute, pas un silence. La ligne 0 dit le texte que la base a reçu — par
-- l'outil MCP, qui ajoute sa signature après lui —, pour le comparer au fichier sans ses lignes de commentaire
-- (`grep -v '^\s*--'`) par son empreinte.
select x.controle, x.ok, x.observe from (
  select v.controle, coalesce(v.ok, false) as ok, v.observe
  from jsonb_to_recordset(current_setting('essai.droits_acces')::jsonb) as v(controle text, ok boolean, observe text)
  union all
  select '0. information : le texte reçu par la base', true, length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by (regexp_match(x.controle, '^(\d+)'))[1]::int, x.controle;
