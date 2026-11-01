-- LES DROITS D'UN ACCÈS CLIENT, ÉPROUVÉS EN BASE (espace client, étape P1) — à rejouer par `execute_sql` après toute
-- migration qui touche `memberships`, ses policies, `admin_du_dossier`, `client_du_dossier`, `gere_les_ventes`,
-- `gere_la_banque`, `gere_la_caisse`, `droits_sur_le_dossier`, `changer_droits_acces`, ou le statut de TVA d'un dossier.
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
--
-- « VENTES » NE SE PORTE QUE SUR UN DOSSIER BASCULÉ (chantier EC-Q3, étape VF8f ; migration `ventes_sur_dossier_bascule`,
-- appliquée le 27/10/2026, 20261027163348). La garde `garder_droit_ventes` refuse, en 23514, « Ventes » qui arrive sur
-- un accès d'un dossier dont les factures ne sont pas la source de leurs ventes, pour tout auteur, hors de l'insertion du
-- super-administrateur (la restauration). Les contrôles qui cochent « Ventes » sur les dossiers du client les basculent
-- donc d'abord, dans leur sous-transaction ; les contrôles 70 à 83 et les mutations 90 à 95 jouent la garde elle-même, sur un
-- dossier jetable qui n'a pas basculé (DJ) et un autre qui a basculé (DK), créés dans chaque sous-transaction ; « rien n'est
-- resté » (60) compte aussi les dossiers basculés. Sans la migration, les refus de la garde manquent : ses contrôles sont
-- en faute, et eux seuls. Ce que deux sessions concurrentes rencontrent (le réglage baissé pendant que « Ventes » arrive) se
-- joue sur une réplique, hors du dépôt (HISTORIQUE.md, « « VENTES » NE SE PORTE QUE SUR UN DOSSIER BASCULÉ »).
--
-- Passage du 27/10/2026, en production, juste après les migrations `equipe_par_son_role` et
-- `ventes_sur_dossier_bascule` (versions 20261027163235 et 20261027163348) : 65 lignes, toutes justes — 63 contrôles,
-- dont les vingt de la garde (70 à 83, 90 à 95), et 2 lignes d'information ; rien de resté en base ; le texte reçu est
-- ce fichier sans ses lignes de commentaire ni son dernier saut de ligne (53 876 caractères, empreinte
-- 2f8b8661f1983beabda57cb8a8b7619b) (HISTORIQUE.md, « LES DEUX MIGRATIONS DE 23Q2Q2-Q3 ET VF8F EN PRODUCTION »).
--
-- LE DROIT « CAISSE » (ligne 26.6, étape C10 ; migration `caisse_du_client`, PRÉPARÉE, pas appliquée). Une troisième case,
-- `droit_caisse`, que `changer_droits_acces` à QUATRE paramètres pose — celle à trois l'appelle, « Caisse » nul —, et deux
-- gardes : « Caisse » qui arrive sur un accès se refuse (23514) sur un dossier ni exonéré de TVA ni en franchise en base,
-- pour tout auteur, l'insertion du super-administrateur exceptée ; un dossier dont un accès porte la case ne quitte pas ces
-- deux statuts, par aucun chemin. Les contrôles 100 à 147 et les mutations 150 à 155 les jouent sur quatre dossiers
-- jetables (DX exonéré, DF en franchise, DR redevable, DN à préciser) ; sans la migration, une ligne dit qu'ils attendent
-- (EN ATTENTE), et le reste rend ce qu'il rendait, la forme des contrôles 3, 4, 40 et 83 près — ce que la migration y
-- ajoute (la forme à quatre, son refus aux trois mots, le déclencheur de la case) ne s'y attend qu'avec elle ; « rien n'est
-- resté » (60) relit aussi le statut de TVA et la nature des recettes de chaque dossier.
do $$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  inconnu uuid := gen_random_uuid();

  cabinet uuid; dossier_client uuid; dossier_client_2 uuid; autre_dossier uuid; troisieme_dossier uuid;
  acces_client uuid; acces_client_2 uuid; acces_essai uuid;
  instantane jsonb; admins_avant int; assignations_avant int; supers_avant int; bascules_avant int; dossiers_avant int;
  -- Étape VF8f : deux dossiers jetables du cabinet, DJ qui n'a pas basculé et DK qui a basculé, et l'accès d'essai du client
  -- à chacun, sans droit — créés dans la sous-transaction de chaque contrôle qui s'en sert, annulés avec elle.
  dj uuid := 'f8f00000-0000-4000-8000-0000000000d1';
  dk uuid := 'f8f00000-0000-4000-8000-0000000000d2';
  acces_dj uuid := 'f8f00000-0000-4000-8000-0000000000a1';
  acces_dk uuid := 'f8f00000-0000-4000-8000-0000000000a2';
  refus_ventes text := 'Le droit « Ventes » suppose que les factures de ce dossier soient la source de leurs ventes, ce qu''elles ne sont pas : changer d''abord la source des ventes du dossier.';
  -- Étape C10 (la migration `caisse_du_client`, préparée) : quatre dossiers jetables du cabinet — DX exonéré, DF en
  -- franchise, DR redevable, DN à préciser — et l'accès d'essai du client à chacun, sans droit, créés dans la
  -- sous-transaction de chaque contrôle qui s'en sert, annulés avec elle.
  c10 boolean := to_regprocedure('public.caisse_du_client(uuid, integer)') is not null;
  dx uuid := 'c10d0000-0000-4000-8000-0000000000d1';
  df uuid := 'c10d0000-0000-4000-8000-0000000000d2';
  dr uuid := 'c10d0000-0000-4000-8000-0000000000d3';
  dn uuid := 'c10d0000-0000-4000-8000-0000000000d4';
  acces_dx uuid := 'c10d0000-0000-4000-8000-0000000000a1';
  acces_df uuid := 'c10d0000-0000-4000-8000-0000000000a2';
  acces_dr uuid := 'c10d0000-0000-4000-8000-0000000000a3';
  acces_dn uuid := 'c10d0000-0000-4000-8000-0000000000a4';
  refus_caisse text := 'Le droit « Caisse » suppose un dossier exonéré de TVA ou en franchise en base, ce que le statut de ce dossier ne dit pas : sa caisse reste tenue par le cabinet.';
  refus_statut text := 'Un accès de ce dossier porte la case « Caisse », qui suppose un dossier exonéré de TVA ou en franchise en base : décoche-la d''abord.';
  aucun_droit_c10 text := 'Aucun droit à changer : précise « Ventes », « Banque » ou « Caisse ».';
  statuts_avant text;
  t record; n int; m int; sig text; code_recu text; message text; obs text; avant jsonb; apres jsonb; rendu jsonb;
  verdicts jsonb := '[]'::jsonb;
begin
  select mb.dossier_id, mb.id into dossier_client, acces_client from memberships mb where mb.user_id = client
    order by mb.dossier_id limit 1;
  select mb.dossier_id, mb.id into dossier_client_2, acces_client_2 from memberships mb where mb.user_id = client
    and mb.dossier_id <> dossier_client order by mb.dossier_id limit 1;
  select cabinet_id into cabinet from dossiers where id = dossier_client;
  -- L'autre dossier est le dossier `test`, nommément, et le troisième un dossier JETABLE du cabinet, créé dans la
  -- sous-transaction de chaque contrôle qui s'en sert : choisis « les premiers dossiers du cabinet sans le client », ils
  -- seraient un dossier réel (dès le 20/11/2026, le troisième l'est presque sûrement), où l'essai poserait des accès, des
  -- affectations et sa bascule (audit du 29/10/2026).
  select d.id into autre_dossier from dossiers d where d.id = '001c7ed7-c23b-4590-901e-693489f8af24' and d.cabinet_id = cabinet
    and not exists (select 1 from memberships mb where mb.dossier_id = d.id and mb.user_id = client);
  troisieme_dossier := 'f8f00000-0000-4000-8000-0000000000d3';
  if dossier_client is null or dossier_client_2 is null or cabinet is null or autre_dossier is null or exists (select 1 from dossiers where id = troisieme_dossier)
     or exists (select 1 from dossiers where id in (dx, df, dr, dn))
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
  select count(*), count(*) filter (where d.ventes_par_les_factures) into dossiers_avant, bascules_avant from dossiers d;
  -- Le statut de TVA et la nature des recettes du client de chaque dossier, sous une empreinte : les contrôles de l'étape C10
  -- les changent dans leurs sous-transactions, et « rien n'est resté » (60) ne dit que leur égalité.
  select md5(coalesce(string_agg(d.id::text || ':' || coalesce(d.statut_tva, '-') || ':' || coalesce(to_jsonb(d) ->> 'categorie_recettes_client', '-'),
           ',' order by d.id), '')) into statuts_avant from dossiers d;

  -- ══ 0 à 4. Le catalogue ═════════════════════════════════════════════════════════════════════════════════════
  -- Les accès du client d'essai seuls : ceux de toute la base diraient ceux d'un dossier réel (audit du 29/10/2026).
  select count(*) filter (where droit_ventes), count(*) filter (where droit_banque) into n, m from memberships where user_id = client;
  verdicts := verdicts || jsonb_build_object('controle', '0b. information : les accès du client d''essai et leurs droits',
    'observe', (select count(*) from memberships where user_id = client) || ' accès, ' || n || ' avec « Ventes », ' || m
      || ' avec « Banque »', 'ok', true);

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
  -- Avec la migration de l'étape C10, `changer_droits_acces` a deux formes : six définitions.
  verdicts := verdicts || jsonb_build_object('controle', '3. les cinq fonctions : SECURITY DEFINER, search_path fixé ; les quatre lectures stables',
    'observe', n || ' conforme(s) sur ' || m, 'ok', n = case when c10 then 6 else 5 end and m = n);

  select string_agg(p.proname, ', ' order by p.proname) filter (where has_function_privilege('anon', p.oid, 'execute')
           or exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0 and x.privilege_type = 'EXECUTE')
           or not has_function_privilege('authenticated', p.oid, 'execute')
           or not has_function_privilege('service_role', p.oid, 'execute')),
         count(*)
    into obs, n
    from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('client_du_dossier', 'gere_les_ventes', 'gere_la_banque', 'droits_sur_le_dossier', 'changer_droits_acces');
  verdicts := verdicts || jsonb_build_object('controle', '4. aucune des cinq ne s''exécute par anon ni PUBLIC ; authenticated et service_role les exécutent',
    'observe', n || ' fonction(s), en faute : ' || coalesce(obs, 'aucune'), 'ok', n = case when c10 then 6 else 5 end and obs is null);

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
      -- « Ventes » ne se porte que sur un dossier basculé (étape VF8f) : ses dossiers basculent d'abord, le temps du
      -- contrôle, par le propriétaire sans session.
      if t.reglage in ('ventes', 'deux', 'tous') then
        perform set_config('request.jwt.claims', '', true);
        update dossiers set ventes_par_les_factures = true where id in (dossier_client, dossier_client_2) and not ventes_par_les_factures;
      end if;
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
          insert into dossiers (id, nom, cabinet_id) values (troisieme_dossier, 'ESSAI DROITS TROISIÈME DOSSIER', cabinet);
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
    perform set_config('request.jwt.claims', '', true);
    update dossiers set ventes_par_les_factures = true where id in (dossier_client, dossier_client_2) and not ventes_par_les_factures;
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
        insert into dossiers (id, nom, cabinet_id) values (troisieme_dossier, 'ESSAI DROITS TROISIÈME DOSSIER', cabinet);
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
  -- Le chef : accepté, l'accès rendu est celui qu'on relit, et seules les deux colonnes ont changé. Les contrôles 38 à 44
  -- et les mutations 51 à 57 qui cochent « Ventes » basculent d'abord le dossier de l'accès (étape VF8f).
  code_recu := null; message := null; avant := null; apres := null; rendu := null;
  begin
    perform set_config('request.jwt.claims', '', true);
    update dossiers set ventes_par_les_factures = true where id = dossier_client and not ventes_par_les_factures;
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
    perform set_config('request.jwt.claims', '', true);
    update dossiers set ventes_par_les_factures = true where id = dossier_client and not ventes_par_les_factures;
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
    -- Avec la migration de l'étape C10, la forme à trois appelle celle à quatre : son refus dit les trois mots.
    verdicts := verdicts || jsonb_build_object('controle', t.num || '. le chef, ' || t.quoi,
      'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      'ok', coalesce(code_recu = t.code and message = case when t.num = '40' and c10 then aucun_droit_c10 else t.mots end, false));
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
    perform set_config('request.jwt.claims', '', true);
    update dossiers set ventes_par_les_factures = true where id = dossier_client and not ventes_par_les_factures;
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
    perform set_config('request.jwt.claims', '', true);
    update dossiers set ventes_par_les_factures = true where id in (dossier_client, dossier_client_2) and not ventes_par_les_factures;
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
    perform set_config('request.jwt.claims', '', true);
    update dossiers set ventes_par_les_factures = true where id = dossier_client and not ventes_par_les_factures;
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
    perform set_config('request.jwt.claims', '', true);
    update dossiers set ventes_par_les_factures = true where id = dossier_client and not ventes_par_les_factures;
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
    perform set_config('request.jwt.claims', '', true);
    update dossiers set ventes_par_les_factures = true where id = dossier_client and not ventes_par_les_factures;
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
    perform set_config('request.jwt.claims', '', true);
    update dossiers set ventes_par_les_factures = true where id = dossier_client_2 and not ventes_par_les_factures;
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
    perform set_config('request.jwt.claims', '', true);
    update dossiers set ventes_par_les_factures = true where id = autre_dossier and not ventes_par_les_factures;
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

  -- ══ 70 à 83. « Ventes » ne se porte que sur un dossier basculé (étape VF8f) ══════════════════════════════════
  -- La garde `garder_droit_ventes`, après la RLS et aux droits du propriétaire : « Ventes » qui ARRIVE sur un accès —
  -- porté à son insertion, coché, emporté vers un autre dossier — se refuse sur un dossier qui n'a pas basculé (23514, ses
  -- mots), pour tout auteur ; seule passe l'insertion du super-administrateur (la restauration). Chaque contrôle crée dans
  -- sa sous-transaction DJ (qui n'a pas basculé), DK (qui a basculé) et l'accès d'essai du client à chacun, sans droit, par
  -- le propriétaire sans session ; un refus s'exige par son code ET ses mots, et la ligne visée est RELUE après.
  for t in select * from (values
      ('70', 'le chef du cabinet (super-administrateur), par la fonction, coche « Ventes » sur un dossier qui n''a pas basculé', 'chef', 'fonction_ventes', 'dj', 'refus'),
      ('71', 'le chef du cabinet qui n''est pas super-administrateur, par la fonction', 'client_chef', 'fonction_ventes', 'dj', 'refus'),
      ('72', 'le membre du cabinet affecté au dossier, par la fonction', 'client_membre', 'fonction_ventes', 'dj', 'refus'),
      ('73', 'le chef du cabinet, par la fonction, coche « Banque » seul sur le même accès : la garde ne regarde que « Ventes »', 'chef', 'fonction_banque', 'dj', 'accepte'),
      ('74', 'le chef du cabinet qui n''est pas super-administrateur insère directement un accès qui porte « Ventes »', 'client_chef', 'insertion_ventes', 'dj', 'refus'),
      ('75', 'le super-administrateur insère un accès qui porte « Ventes » (la restauration rend ce qui a été)', 'chef', 'insertion_ventes', 'dj', 'accepte'),
      ('76', 'le propriétaire, sans session, coche « Ventes » par une mise à jour', 'proprietaire', 'mise_a_jour_ventes', 'dj', 'refus'),
      ('77', 'le propriétaire, sans session, insère un accès qui porte « Ventes »', 'proprietaire', 'insertion_ventes', 'dj', 'refus'),
      ('78', 'le rôle des Edge Functions insère un accès qui porte « Ventes »', 'service', 'insertion_ventes', 'dj', 'refus'),
      ('79', 'le rôle des Edge Functions insère l''accès de create-client-access, sans droit : accepté', 'service', 'insertion_sans_droit', 'dj', 'accepte'),
      ('80', 'sur un dossier qui a basculé, le chef du cabinet coche « Ventes » par la fonction : accepté', 'chef', 'fonction_ventes', 'dk', 'accepte'),
      ('81', 'sur un dossier qui a basculé, le chef du cabinet qui n''est pas super-administrateur insère un accès « Ventes » : accepté', 'client_chef', 'insertion_ventes', 'dk', 'accepte')
    ) as v(num, quoi, qui, geste, cible, attendu) loop
    code_recu := null; message := null; avant := null; apres := null; rendu := null; obs := null;
    begin
      perform set_config('request.jwt.claims', '', true);
      insert into dossiers (id, nom, cabinet_id, ventes_par_les_factures) values
        (dj, 'ESSAI VF8F DJ', cabinet, false), (dk, 'ESSAI VF8F DK', cabinet, true);
      insert into memberships (id, user_id, dossier_id, role, email) values
        (acces_dj, client, dj, 'client', 'essai-vf8f@example.test'), (acces_dk, client, dk, 'client', 'essai-vf8f@example.test');
      if t.qui = 'client_chef' then
        insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable_en_chef');
      elsif t.qui = 'client_membre' then
        insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable');
        insert into dossier_assignations (dossier_id, user_id) values (dj, client), (dk, client);
      end if;
      select to_jsonb(mb) into avant from memberships mb
       where mb.id = case t.cible when 'dj' then acces_dj else acces_dk end;
      begin
        if t.qui in ('chef', 'client_chef', 'client_membre') then
          set local role authenticated;
          perform set_config('request.jwt.claims',
            json_build_object('sub', case t.qui when 'chef' then chef else client end, 'role', 'authenticated')::text, true);
        elsif t.qui = 'service' then
          set local role service_role;
          perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
        end if;
        case t.geste
          when 'fonction_ventes' then
            select to_jsonb(r) into rendu from changer_droits_acces(case t.cible when 'dj' then acces_dj else acces_dk end, true, null) r;
          when 'fonction_banque' then
            select to_jsonb(r) into rendu from changer_droits_acces(case t.cible when 'dj' then acces_dj else acces_dk end, null, true) r;
          when 'mise_a_jour_ventes' then
            update memberships set droit_ventes = true where id = case t.cible when 'dj' then acces_dj else acces_dk end
              returning to_jsonb(memberships.*) into rendu;
          when 'insertion_ventes' then
            -- L'accès du compte du chef, qui n'en a aucun (le jeu de départ l'exige).
            insert into memberships (user_id, dossier_id, role, email, droit_ventes)
              values (chef, case t.cible when 'dj' then dj else dk end, 'client', 'essai-vf8f@example.test', true)
              returning to_jsonb(memberships.*) into rendu;
          when 'insertion_sans_droit' then
            insert into memberships (user_id, dossier_id, role, email)
              values (chef, case t.cible when 'dj' then dj else dk end, 'client', 'essai-vf8f@example.test')
              returning to_jsonb(memberships.*) into rendu;
        end case;
        code_recu := 'ACCEPTÉ';
      exception when others then code_recu := sqlstate; message := sqlerrm;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      select to_jsonb(mb) into apres from memberships mb
       where mb.id = case t.cible when 'dj' then acces_dj else acces_dk end;
      obs := case when t.geste in ('insertion_ventes', 'insertion_sans_droit')
                  then 'accès ' || case when rendu is null then 'absent' else 'inséré, « Ventes » ' || (rendu ->> 'droit_ventes') end
                  else 'ligne relue ' || case when avant = apres then 'inchangée' else '« Ventes » ' || coalesce(apres ->> 'droit_ventes', '?')
                       || ', « Banque » ' || coalesce(apres ->> 'droit_banque', '?') end end;
      raise exception 'ANNULATION_ESSAI';
    exception when others then
      if sqlstate <> 'P0001' or sqlerrm <> 'ANNULATION_ESSAI' then code_recu := sqlstate; message := sqlerrm; end if;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', t.num || '. ' || t.quoi
        || case t.attendu when 'refus' then ' : refusé (23514), rien d''écrit' else '' end,
      'observe', coalesce(code_recu, '?') || coalesce(' ' || message, '') || ', ' || coalesce(obs, '?'),
      'ok', coalesce(case t.attendu
        when 'refus' then code_recu = '23514' and message = refus_ventes
          and (t.geste like 'insertion%' or avant = apres)
        else code_recu = 'ACCEPTÉ'
          and case t.geste
                when 'fonction_ventes' then rendu = apres and (apres ->> 'droit_ventes') = 'true'
                when 'fonction_banque' then rendu = apres and (apres ->> 'droit_ventes') = 'false' and (apres ->> 'droit_banque') = 'true'
                when 'insertion_ventes' then (rendu ->> 'droit_ventes') = 'true'
                when 'insertion_sans_droit' then (rendu ->> 'droit_ventes') = 'false'
                else false end
        end, false));
  end loop;

  -- 82. Un accès qui porte déjà « Ventes » sur un dossier qui n'a pas basculé (posé par la restauration : le propriétaire sous
  -- la session du super-administrateur) : « Banque » s'y change, « Ventes » s'y décoche, et ne s'y recoche plus — par la
  -- fonction, sous le super-administrateur, ni par le propriétaire. Puis un autre accès « Ventes » restauré sur DJ, emporté
  -- vers DK, qui a basculé : accepté ; ramené vers DJ : refusé.
  obs := null; code_recu := null; message := null;
  begin
    perform set_config('request.jwt.claims', '', true);
    insert into dossiers (id, nom, cabinet_id, ventes_par_les_factures) values
      (dj, 'ESSAI VF8F DJ', cabinet, false), (dk, 'ESSAI VF8F DK', cabinet, true);
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    insert into memberships (id, user_id, dossier_id, role, email, droit_ventes) values
      (acces_dj, client, dj, 'client', 'essai-vf8f@example.test', true),
      (acces_dk, chef, dj, 'client', 'essai-vf8f@example.test', true);
    set local role authenticated;
    select 'Banque ' || r.droit_ventes::int || r.droit_banque::int into obs from changer_droits_acces(acces_dj, null, true) r;
    select obs || ' ; décoché ' || r.droit_ventes::int || r.droit_banque::int into obs from changer_droits_acces(acces_dj, false, null) r;
    begin
      perform changer_droits_acces(acces_dj, true, null);
      obs := obs || ' ; recoché ACCEPTÉ';
    exception when others then obs := obs || ' ; recoché ' || sqlstate || case when sqlerrm = refus_ventes then ' (ses mots)' else ' ' || sqlerrm end;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    begin
      update memberships set droit_ventes = true where id = acces_dj;
      obs := obs || ' ; propriétaire ACCEPTÉ';
    exception when others then obs := obs || ' ; propriétaire ' || sqlstate || case when sqlerrm = refus_ventes then ' (ses mots)' else ' ' || sqlerrm end;
    end;
    begin
      update memberships set dossier_id = dk where id = acces_dk;
      obs := obs || ' ; emporté vers DK ACCEPTÉ';
    exception when others then obs := obs || ' ; emporté vers DK ' || sqlstate || ' ' || sqlerrm;
    end;
    begin
      update memberships set dossier_id = dj where id = acces_dk;
      obs := obs || ' ; ramené vers DJ ACCEPTÉ';
    exception when others then obs := obs || ' ; ramené vers DJ ' || sqlstate || case when sqlerrm = refus_ventes then ' (ses mots)' else ' ' || sqlerrm end;
    end;
    raise exception 'ANNULATION_ESSAI';
  exception when others then
    if sqlstate <> 'P0001' or sqlerrm <> 'ANNULATION_ESSAI' then code_recu := sqlstate; message := sqlerrm; end if;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '82. un accès « Ventes » restauré sur un dossier qui n''a pas basculé : « Banque » s''y change, « Ventes » s''y décoche et ne s''y recoche plus ; un accès « Ventes » emporté vers ce dossier, refusé',
    'observe', coalesce(obs, '?') || coalesce(', ' || code_recu || ' ' || message, ''),
    'ok', coalesce(obs = 'Banque 11 ; décoché 01 ; recoché 23514 (ses mots) ; propriétaire 23514 (ses mots) ; emporté vers DK ACCEPTÉ ; ramené vers DJ 23514 (ses mots)'
      and code_recu is null, false));

  -- 83. Le catalogue : la garde, aux droits du propriétaire, chemin fixé, qu'aucun rôle de l'API n'exécute ; son déclencheur,
  -- APRÈS l'insertion et la mise à jour de `droit_ventes` ou de `dossier_id`, ligne par ligne, actif.
  select p.prosecdef || ' ' || p.provolatile::text || ' ' || coalesce(array_to_string(p.proconfig, ','), '') || ' ' || l.lanname
         || ' anon ' || has_function_privilege('anon', p.oid, 'execute')
         || ' authenticated ' || has_function_privilege('authenticated', p.oid, 'execute')
         || ' public ' || exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0 and x.privilege_type = 'EXECUTE')
         || ' | ' || coalesce((select string_agg(pg_get_triggerdef(tg.oid) || ' ' || tg.tgenabled::text, ' ; ' order by tg.tgname) from pg_trigger tg
                                where tg.tgrelid = 'public.memberships'::regclass and not tg.tgisinternal), 'aucun déclencheur')
    into obs
    from pg_proc p join pg_language l on l.oid = p.prolang where p.oid = to_regprocedure('public.garder_droit_ventes()');
  verdicts := verdicts || jsonb_build_object('controle', '83. la garde : security definer, chemin fixé, exécutée par aucun rôle de l''API ; son déclencheur, après l''insertion et la mise à jour de droit_ventes ou de dossier_id',
    'observe', coalesce(obs, 'garde absente'),
    'ok', coalesce(obs = 'true v search_path=public plpgsql anon false authenticated false public false | '
      || case when c10 then 'CREATE TRIGGER memberships_droit_caisse AFTER INSERT OR UPDATE OF droit_caisse, dossier_id ON public.memberships FOR EACH ROW EXECUTE FUNCTION garder_droit_caisse() O ; ' else '' end
      || 'CREATE TRIGGER memberships_droit_ventes AFTER INSERT OR UPDATE OF droit_ventes, dossier_id ON public.memberships FOR EACH ROW EXECUTE FUNCTION garder_droit_ventes() O', false));

  -- ══ 90 à 95. Les mutations de la garde : chacune doit MORDRE ════════════════════════════════════════════════
  for t in select * from (values
      ('90', 'le contrôle 70 joué sur le dossier qui a basculé : le chef coche « Ventes »', 'chef', 'fonction_ventes', 'dk', 'accepte'),
      ('91', 'le contrôle 74 joué sur le dossier qui a basculé : l''insertion du cabinet passe', 'client_chef', 'insertion_ventes', 'dk', 'accepte'),
      ('92', 'le contrôle 75 joué par le propriétaire, sans la session du super-administrateur : l''insertion se refuse', 'proprietaire', 'insertion_ventes', 'dj', 'refus'),
      ('93', 'le contrôle 76 joué sur le dossier qui a basculé : la mise à jour du propriétaire passe', 'proprietaire', 'mise_a_jour_ventes', 'dk', 'accepte'),
      ('94', 'le contrôle 78 joué sur le dossier qui a basculé : l''insertion du rôle des Edge Functions passe', 'service', 'insertion_ventes', 'dk', 'accepte'),
      ('95', 'le contrôle 73 joué avec « Ventes » au lieu de « Banque » : refusé', 'chef', 'fonction_ventes', 'dj', 'refus')
    ) as v(num, quoi, qui, geste, cible, attendu) loop
    code_recu := null; message := null; rendu := null;
    begin
      perform set_config('request.jwt.claims', '', true);
      insert into dossiers (id, nom, cabinet_id, ventes_par_les_factures) values
        (dj, 'ESSAI VF8F DJ', cabinet, false), (dk, 'ESSAI VF8F DK', cabinet, true);
      insert into memberships (id, user_id, dossier_id, role, email) values
        (acces_dj, client, dj, 'client', 'essai-vf8f@example.test'), (acces_dk, client, dk, 'client', 'essai-vf8f@example.test');
      if t.qui = 'client_chef' then
        insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable_en_chef');
      end if;
      begin
        if t.qui in ('chef', 'client_chef') then
          set local role authenticated;
          perform set_config('request.jwt.claims',
            json_build_object('sub', case t.qui when 'chef' then chef else client end, 'role', 'authenticated')::text, true);
        elsif t.qui = 'service' then
          set local role service_role;
          perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
        end if;
        case t.geste
          when 'fonction_ventes' then
            select to_jsonb(r) into rendu from changer_droits_acces(case t.cible when 'dj' then acces_dj else acces_dk end, true, null) r;
          when 'mise_a_jour_ventes' then
            update memberships set droit_ventes = true where id = case t.cible when 'dj' then acces_dj else acces_dk end
              returning to_jsonb(memberships.*) into rendu;
          when 'insertion_ventes' then
            insert into memberships (user_id, dossier_id, role, email, droit_ventes)
              values (chef, case t.cible when 'dj' then dj else dk end, 'client', 'essai-vf8f@example.test', true)
              returning to_jsonb(memberships.*) into rendu;
        end case;
        code_recu := 'ACCEPTÉ';
      exception when others then code_recu := sqlstate; message := sqlerrm;
      end;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then
      if sqlstate <> 'P0001' or sqlerrm <> 'ANNULATION_ESSAI' then code_recu := sqlstate; message := sqlerrm; end if;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', t.num || '. MUTATION — ' || t.quoi,
      'observe', coalesce(code_recu, '?') || coalesce(' ' || message, ''),
      'ok', coalesce(case t.attendu when 'refus' then code_recu = '23514' and message = refus_ventes
                     else code_recu = 'ACCEPTÉ' and (rendu ->> 'droit_ventes') = 'true' end, false));
  end loop;

  -- ══ 100 à 155. Le droit « Caisse » (ligne 26.6, étape C10 ; la migration `caisse_du_client`, préparée) ════════════
  -- Sans la migration, une ligne dit que ces contrôles attendent (EN ATTENTE), et rien d'autre ne change. Avec elle : le
  -- catalogue ; la table de vérité du mot « caisse » (client_du_dossier, gere_la_caisse, la clé « caisse » de
  -- droits_sur_le_dossier) ; la forme à quatre de changer_droits_acces, et celle à trois qui l'appelle ; la garde de la case
  -- (« Caisse » qui arrive, sur un dossier exonéré de TVA ou en franchise en base seulement, pour tout auteur, l'insertion du
  -- super-administrateur exceptée) et celle du statut (un dossier dont un accès porte la case ne quitte pas ces deux
  -- statuts, par aucun chemin) ; leurs mutations, qui doivent MORDRE. Quatre dossiers jetables du cabinet — DX exonéré, DF
  -- en franchise, DR redevable, DN à préciser — et l'accès d'essai du client à chacun, sans droit, créés par le
  -- propriétaire sans session dans la sous-transaction de chaque contrôle, annulés avec elle. Ce que deux sessions
  -- concurrentes rencontrent (la case qui arrive pendant que le statut change) se joue sur une réplique, hors du dépôt.
  if not c10 then
    verdicts := verdicts || jsonb_build_object('controle', '100. EN ATTENTE de la migration caisse_du_client (étape C10) : le droit « Caisse », ses deux gardes et leurs mutations',
      'observe', 'absente : ils se jouent dès qu''elle y est', 'ok', true);
  else
    -- 100. Les deux colonnes : la case, booléenne, non nulle, fausse par défaut ; la nature des recettes, nulle.
    select string_agg(c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
             || case when a.attnotnull then ' non nulle' else ' NULLABLE' end || ' défaut ' || coalesce(pg_get_expr(d.adbin, d.adrelid), 'aucun'),
             ', ' order by c.relname, a.attname)
      into obs
      from pg_attribute a join pg_class c on c.oid = a.attrelid left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where ((c.oid = 'public.memberships'::regclass and a.attname = 'droit_caisse')
            or (c.oid = 'public.dossiers'::regclass and a.attname = 'categorie_recettes_client')) and not a.attisdropped;
    verdicts := verdicts || jsonb_build_object('controle', '100. le droit « Caisse » : booléen, non nul, faux par défaut ; la nature des recettes du client, nulle',
      'observe', coalesce(obs, 'colonnes absentes'),
      'ok', coalesce(obs = 'dossiers.categorie_recettes_client uuid NULLABLE défaut aucun, memberships.droit_caisse boolean non nulle défaut false', false));

    -- 101. Les fonctions neuves des droits : aux droits du propriétaire, le chemin fixé ; la lecture stable ; ni l'anonyme ni
    -- PUBLIC ne les exécutent, un compte connecté et le rôle des Edge Functions si ; les deux gardes, aucun rôle de l'API.
    select string_agg(p.oid::regprocedure::text || ' ' || p.prosecdef || ' ' || p.provolatile::text || ' ' || coalesce(array_to_string(p.proconfig, ','), '')
             || ' anon ' || has_function_privilege('anon', p.oid, 'execute') || ' authenticated ' || has_function_privilege('authenticated', p.oid, 'execute')
             || ' public ' || exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0 and x.privilege_type = 'EXECUTE'),
             ' ; ' order by p.oid::regprocedure::text collate "C")
      into obs
      from pg_proc p
     where p.oid in (to_regprocedure('public.gere_la_caisse(uuid)'), to_regprocedure('public.changer_droits_acces(uuid, boolean, boolean, boolean)'),
                     to_regprocedure('public.garder_droit_caisse()'), to_regprocedure('public.garder_statut_tva_de_la_caisse()'));
    verdicts := verdicts || jsonb_build_object('controle', '101. gere_la_caisse et changer_droits_acces à quatre : security definer, chemin fixé, exécutées par un compte connecté seul ; les deux gardes, par aucun rôle de l''API',
      'observe', coalesce(obs, 'fonctions absentes'),
      'ok', coalesce(obs = 'changer_droits_acces(uuid,boolean,boolean,boolean) true v search_path=public anon false authenticated true public false'
        || ' ; garder_droit_caisse() true v search_path=public anon false authenticated false public false'
        || ' ; garder_statut_tva_de_la_caisse() true v search_path=public anon false authenticated false public false'
        || ' ; gere_la_caisse(uuid) true s search_path=public anon false authenticated true public false'
        and has_function_privilege('service_role', 'public.changer_droits_acces(uuid, boolean, boolean, boolean)', 'execute')
        and has_function_privilege('service_role', 'public.gere_la_caisse(uuid)', 'execute'), false));

    -- 102. L'anonyme n'atteint ni la lecture du droit, ni la forme à quatre, ni la caisse du client.
    obs := '';
    for t in select * from (values
        ('gere_la_caisse', 'select gere_la_caisse($1)::text'),
        ('changer_droits_acces', 'select changer_droits_acces($2, null, null, true)::text'),
        ('caisse_du_client', 'select count(*)::text from caisse_du_client($1, 2026)')) as v(fonction, appel) loop
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
    verdicts := verdicts || jsonb_build_object('controle', '102. l''anonyme n''exécute ni gere_la_caisse, ni changer_droits_acces à quatre, ni caisse_du_client (42501, permission denied)',
      'observe', case when obs = '' then 'trois refus' else 'en faute : ' || obs end, 'ok', obs = '');

    -- 103 à 112. La table de vérité du mot « caisse » : client_du_dossier(…, 'caisse') | gere_la_caisse | droits_sur_le_dossier.caisse.
    for t in select * from (values
        ('103', 'compte rattaché à rien, sur DX dont l''accès du client porte « Caisse »', inconnu, dx, 'caisse_dx', '0|0|0'),
        ('104', 'client de DX, sans droit', client, dx, 'aucun', '0|0|0'),
        ('105', 'client de DX, « Caisse » sur son accès', client, dx, 'caisse_dx', '1|1|1'),
        ('106', 'client de DX, « Banque » seul : un autre droit ne donne pas la caisse', client, dx, 'banque_dx', '0|0|0'),
        ('107', 'le droit vaut pour SON accès : « Caisse » sur DF, lue sur DX', client, dx, 'caisse_df', '0|0|0'),
        ('108', 'client qui porte « Caisse » sur DX et DF, sur un dossier où il n''a pas d''accès', client, autre_dossier, 'caisse_tous', '0|0|0'),
        ('109', 'chef du cabinet (super-administrateur), sur DX', chef, dx, 'aucun', '0|1|1'),
        ('110', 'chef du cabinet qui n''est pas super-administrateur, sur DX', client, dx, 'chef', '0|1|1'),
        ('111', 'membre du cabinet affecté à DX', client, dx, 'membre_affecte', '0|1|1'),
        ('112', 'membre du cabinet affecté à DF, sur DX', client, dx, 'membre_ailleurs', '0|0|0'),
        ('154', 'MUTATION — le contrôle 105 joué avec « Banque » au lieu de « Caisse » : la signature doit changer', client, dx, 'banque_dx', '1|1|1')
      ) as v(num, profil, sujet, dossier, reglage, attendu) loop
      sig := null; code_recu := null; message := null;
      begin
        perform set_config('request.jwt.claims', '', true);
        insert into dossiers (id, nom, cabinet_id, statut_tva) values
          (dx, 'ESSAI C10 DX', cabinet, 'exonere'), (df, 'ESSAI C10 DF', cabinet, 'franchise'), (dr, 'ESSAI C10 DR', cabinet, 'redevable'), (dn, 'ESSAI C10 DN', cabinet, null);
        insert into memberships (id, user_id, dossier_id, role, email) values (acces_dx, client, dx, 'client', 'essai-c10@example.test'),
          (acces_df, client, df, 'client', 'essai-c10@example.test'), (acces_dr, client, dr, 'client', 'essai-c10@example.test'),
          (acces_dn, client, dn, 'client', 'essai-c10@example.test');
        case t.reglage
          when 'aucun' then null;
          when 'caisse_dx' then update memberships set droit_caisse = true where id = acces_dx;
          when 'banque_dx' then update memberships set droit_banque = true where id = acces_dx;
          when 'caisse_df' then update memberships set droit_caisse = true where id = acces_df;
          when 'caisse_tous' then update memberships set droit_caisse = true where id in (acces_dx, acces_df);
          when 'chef' then insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable_en_chef');
          when 'membre_affecte' then
            insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable');
            insert into dossier_assignations (dossier_id, user_id) values (dx, client);
          when 'membre_ailleurs' then
            insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable');
            insert into dossier_assignations (dossier_id, user_id) values (df, client);
        end case;
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', t.sujet, 'role', 'authenticated')::text, true);
        select concat_ws('|', client_du_dossier(t.dossier, 'caisse')::int, gere_la_caisse(t.dossier)::int,
                 (droits_sur_le_dossier(t.dossier) ->> 'caisse')::boolean::int) || case when is_super_admin() then ' super' else '' end
          into sig;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; message := sqlerrm;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('controle', t.num || '. ' || t.profil || case when t.num = '154' then '' else ' : ' || t.attendu end,
        'observe', coalesce(sig, '?') || ', ' || coalesce(code_recu, '?') || case when code_recu = 'P0001' then '' else ' ' || coalesce(message, '') end,
        'ok', coalesce(case when t.num = '154' then split_part(sig, ' ', 1) <> t.attendu
                            else split_part(sig, ' ', 1) = t.attendu and (sig like '% super') = (t.num = '109') end
          and code_recu = 'P0001', false));
    end loop;

    -- 113. Un mot que la fonction ne connaît pas ne vaut rien, même quand l'accès porte « Caisse ».
    n := null; m := null; code_recu := null;
    begin
      perform set_config('request.jwt.claims', '', true);
      insert into dossiers (id, nom, cabinet_id, statut_tva) values (dx, 'ESSAI C10 DX', cabinet, 'exonere');
      insert into memberships (id, user_id, dossier_id, role, email, droit_caisse) values (acces_dx, client, dx, 'client', 'essai-c10@example.test', true);
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      select count(*) filter (where client_du_dossier(dx, w)) into n
        from unnest(array['Caisse', 'CAISSE', ' caisse', 'caisses', 'especes', 'espèces', '', null]) as w;
      m := client_du_dossier(dx, 'caisse')::int;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', '113. un mot inconnu (casse, espace, pluriel, synonyme, nul) ne vaut rien, même avec « Caisse »',
      'observe', coalesce(n::text, '?') || ' vrai(s) sur 8 mots inconnus, ' || coalesce(m::text, '?') || ' sur le mot connu, ' || coalesce(code_recu, '?'),
      'ok', coalesce(n = 0 and m = 1 and code_recu = 'P0001', false));

    -- 114. Le chef coche « Caisse » sur l'accès du client à DX : l'accès rendu est l'accès relu, et seule la case a changé.
    code_recu := null; message := null; avant := null; apres := null; rendu := null;
    begin
      perform set_config('request.jwt.claims', '', true);
      insert into dossiers (id, nom, cabinet_id, statut_tva) values (dx, 'ESSAI C10 DX', cabinet, 'exonere');
      insert into memberships (id, user_id, dossier_id, role, email) values (acces_dx, client, dx, 'client', 'essai-c10@example.test');
      select to_jsonb(mb) into avant from memberships mb where mb.id = acces_dx;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      select to_jsonb(r) into rendu from changer_droits_acces(acces_dx, null, null, true) r;
      reset role;
      select to_jsonb(mb) into apres from memberships mb where mb.id = acces_dx;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', '114. le chef coche « Caisse » sur un accès d''un dossier exonéré : l''accès rendu est l''accès relu, et rien d''autre n''a changé',
      'observe', 'rendu ' || case when rendu is null then 'aucun' when rendu = apres then '= relu' else '≠ relu' end
        || ', « Caisse » ' || coalesce(apres ->> 'droit_caisse', '?')
        || ', autres colonnes ' || case when avant - 'droit_caisse' = apres - 'droit_caisse' then 'identiques' else 'CHANGÉES' end
        || ', ' || coalesce(code_recu, '?') || case when code_recu = 'P0001' then '' else ' ' || coalesce(message, '') end,
      'ok', coalesce(rendu = apres and (apres ->> 'droit_caisse') = 'true' and avant - 'droit_caisse' = apres - 'droit_caisse'
        and code_recu = 'P0001', false));

    -- 115. Un droit nul reste tel quel : « Caisse » seule, « Banque » par la forme à trois (« Caisse » gardée), « Caisse » retirée.
    obs := null; code_recu := null; message := null;
    begin
      perform set_config('request.jwt.claims', '', true);
      insert into dossiers (id, nom, cabinet_id, statut_tva) values (dx, 'ESSAI C10 DX', cabinet, 'exonere');
      insert into memberships (id, user_id, dossier_id, role, email) values (acces_dx, client, dx, 'client', 'essai-c10@example.test');
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      select r.droit_ventes::int || '' || r.droit_banque::int || r.droit_caisse::int into obs from changer_droits_acces(acces_dx, null, null, true) r;
      select obs || ' puis ' || r.droit_ventes::int || r.droit_banque::int || r.droit_caisse::int into obs from changer_droits_acces(acces_dx, null, true) r;
      select obs || ' puis ' || r.droit_ventes::int || r.droit_banque::int || r.droit_caisse::int into obs from changer_droits_acces(acces_dx, null, null, false) r;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', '115. un droit nul reste tel quel : « Caisse » seule, « Banque » par la forme à trois, puis « Caisse » retirée',
      'observe', coalesce(obs, '?') || ', ' || coalesce(code_recu, '?') || case when code_recu = 'P0001' then '' else ' ' || coalesce(message, '') end,
      'ok', coalesce(obs = '001 puis 011 puis 010' and code_recu = 'P0001', false));

    -- 116 à 118. Les refus de la forme à quatre, et de la forme à trois qui l'appelle : ses mots.
    for t in select * from (values
        ('116', 'le chef, aucun droit donné par la forme à quatre (les trois nuls) : refusé (22023)', 'quatre_nuls', '22023', aucun_droit_c10),
        ('117', 'le chef, aucun droit donné par la forme à trois (les deux nuls) : refusé sous les mêmes mots (22023)', 'trois_nuls', '22023', aucun_droit_c10),
        ('118', 'le chef, un accès qui n''existe pas : refusé sous les mêmes mots qu''un accès interdit (42501)', 'inexistant', '42501', 'Accès refusé à ce dossier.')
      ) as v(num, quoi, geste, code, mots) loop
      code_recu := null; message := null;
      begin
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
        case t.geste
          when 'quatre_nuls' then perform changer_droits_acces(acces_client, null, null, null);
          when 'trois_nuls' then perform changer_droits_acces(acces_client, null, null);
          else perform changer_droits_acces(gen_random_uuid(), null, null, true);
        end case;
        code_recu := 'ACCEPTÉ';
        raise exception 'ANNULATION_ESSAI';
      exception when others then
        if code_recu is null then code_recu := sqlstate; message := sqlerrm; end if;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('controle', t.num || '. ' || t.quoi,
        'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''), 'ok', coalesce(code_recu = t.code and message = t.mots, false));
    end loop;

    -- 119. Ni le client sur SON accès, ni un compte rattaché à rien : refusés (42501), la ligne relue n'a pas changé.
    obs := '';
    for t in select * from (values ('client', client), ('compte rattaché à rien', inconnu)) as v(profil, sujet) loop
      code_recu := null; message := null; avant := null; apres := null;
      begin
        perform set_config('request.jwt.claims', '', true);
        insert into dossiers (id, nom, cabinet_id, statut_tva) values (dx, 'ESSAI C10 DX', cabinet, 'exonere');
        insert into memberships (id, user_id, dossier_id, role, email) values (acces_dx, client, dx, 'client', 'essai-c10@example.test');
        select to_jsonb(mb) into avant from memberships mb where mb.id = acces_dx;
        begin
          set local role authenticated;
          perform set_config('request.jwt.claims', json_build_object('sub', t.sujet, 'role', 'authenticated')::text, true);
          perform changer_droits_acces(acces_dx, null, null, true);
          code_recu := 'ACCEPTÉ';
        exception when others then code_recu := sqlstate; message := sqlerrm;
        end;
        reset role;
        perform set_config('request.jwt.claims', '', true);
        select to_jsonb(mb) into apres from memberships mb where mb.id = acces_dx;
        raise exception 'ANNULATION_ESSAI';
      exception when others then
        if sqlstate <> 'P0001' or sqlerrm <> 'ANNULATION_ESSAI' then code_recu := sqlstate; message := sqlerrm; end if;
      end;
      reset role;
      if not (code_recu = '42501' and message = 'Accès refusé à ce dossier.' and avant is not null and avant = apres) then
        obs := obs || t.profil || ' (' || coalesce(code_recu, '?') || ' ' || coalesce(message, '') || ') ';
      end if;
    end loop;
    verdicts := verdicts || jsonb_build_object('controle', '119. ni le client sur son accès, ni un compte rattaché à rien ne cochent « Caisse » : refusés (42501), la ligne relue n''a pas changé',
      'observe', case when obs = '' then 'deux refus, lignes inchangées' else 'en faute : ' || obs end, 'ok', obs = '');

    -- 120. Le membre du cabinet affecté à DX coche « Caisse » sur un accès de DX (celui du compte du chef, le temps du bloc).
    code_recu := null; message := null; rendu := null; apres := null; acces_essai := null;
    begin
      perform set_config('request.jwt.claims', '', true);
      insert into dossiers (id, nom, cabinet_id, statut_tva) values (dx, 'ESSAI C10 DX', cabinet, 'exonere');
      insert into memberships (user_id, dossier_id, role, email) values (chef, dx, 'client', 'essai-c10@example.test') returning id into acces_essai;
      insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable');
      insert into dossier_assignations (dossier_id, user_id) values (dx, client);
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      select to_jsonb(r) into rendu from changer_droits_acces(acces_essai, null, null, true) r;
      reset role;
      select to_jsonb(mb) into apres from memberships mb where mb.id = acces_essai;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', '120. le membre du cabinet affecté au dossier coche « Caisse » sur un accès de ce dossier',
      'observe', '« Caisse » relue ' || coalesce(apres ->> 'droit_caisse', '?') || ', rendu ' || case when rendu is null then 'aucun' when rendu = apres then '= relu' else '≠ relu' end
        || ', ' || coalesce(code_recu, '?') || case when code_recu = 'P0001' then '' else ' ' || coalesce(message, '') end,
      'ok', coalesce(rendu = apres and (apres ->> 'droit_caisse') = 'true' and code_recu = 'P0001', false));

    -- 121 à 133, et les mutations 150 à 152. La garde de la case : « Caisse » qui ARRIVE sur un accès se refuse sur un
    -- dossier ni exonéré ni en franchise (23514, ses mots), pour tout auteur ; seule passe l'insertion du super-administrateur.
    for t in select * from (values
        ('121', 'le chef du cabinet (super-administrateur), par la fonction, coche « Caisse » sur un dossier redevable', 'chef', 'fonction_caisse', 'dr', 'refus'),
        ('122', 'le chef du cabinet, par la fonction, sur un dossier au statut à préciser', 'chef', 'fonction_caisse', 'dn', 'refus'),
        ('123', 'le chef du cabinet qui n''est pas super-administrateur, par la fonction, sur un dossier redevable', 'client_chef', 'fonction_caisse', 'dr', 'refus'),
        ('124', 'le membre du cabinet affecté au dossier, par la fonction, sur un dossier redevable', 'client_membre', 'fonction_caisse', 'dr', 'refus'),
        ('125', 'sur un dossier exonéré, le chef coche « Caisse » par la fonction : accepté', 'chef', 'fonction_caisse', 'dx', 'accepte'),
        ('126', 'sur un dossier en franchise en base, le chef coche « Caisse » par la fonction : accepté', 'chef', 'fonction_caisse', 'df', 'accepte'),
        ('127', 'le chef coche « Banque » seul sur l''accès d''un dossier redevable : la garde ne regarde que « Caisse »', 'chef', 'fonction_banque', 'dr', 'accepte'),
        ('128', 'le chef du cabinet qui n''est pas super-administrateur insère directement un accès qui porte « Caisse » sur un dossier redevable', 'client_chef', 'insertion_caisse', 'dr', 'refus'),
        ('129', 'le super-administrateur insère un accès qui porte « Caisse » sur un dossier redevable (la restauration rend ce qui a été)', 'chef', 'insertion_caisse', 'dr', 'accepte'),
        ('130', 'le propriétaire, sans session, coche « Caisse » par une mise à jour, sur un dossier redevable', 'proprietaire', 'mise_a_jour_caisse', 'dr', 'refus'),
        ('131', 'le propriétaire, sans session, insère un accès qui porte « Caisse » sur un dossier redevable', 'proprietaire', 'insertion_caisse', 'dr', 'refus'),
        ('132', 'le rôle des Edge Functions insère un accès qui porte « Caisse » sur un dossier redevable', 'service', 'insertion_caisse', 'dr', 'refus'),
        ('133', 'le rôle des Edge Functions insère l''accès de create-client-access, sans droit, sur un dossier redevable : accepté', 'service', 'insertion_sans_droit', 'dr', 'accepte'),
        ('150', 'MUTATION — le contrôle 121 joué sur le dossier exonéré : le chef coche « Caisse »', 'chef', 'fonction_caisse', 'dx', 'accepte'),
        ('151', 'MUTATION — le contrôle 128 joué sur le dossier exonéré : l''insertion du cabinet passe', 'client_chef', 'insertion_caisse', 'dx', 'accepte'),
        ('152', 'MUTATION — le contrôle 129 joué par le propriétaire, sans la session du super-administrateur : l''insertion se refuse', 'proprietaire', 'insertion_caisse', 'dr', 'refus')
      ) as v(num, quoi, qui, geste, cible, attendu) loop
      code_recu := null; message := null; avant := null; apres := null; rendu := null; obs := null;
      begin
        perform set_config('request.jwt.claims', '', true);
        insert into dossiers (id, nom, cabinet_id, statut_tva) values
          (dx, 'ESSAI C10 DX', cabinet, 'exonere'), (df, 'ESSAI C10 DF', cabinet, 'franchise'), (dr, 'ESSAI C10 DR', cabinet, 'redevable'), (dn, 'ESSAI C10 DN', cabinet, null);
        insert into memberships (id, user_id, dossier_id, role, email) values (acces_dx, client, dx, 'client', 'essai-c10@example.test'),
          (acces_df, client, df, 'client', 'essai-c10@example.test'), (acces_dr, client, dr, 'client', 'essai-c10@example.test'),
          (acces_dn, client, dn, 'client', 'essai-c10@example.test');
        if t.qui = 'client_chef' then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable_en_chef');
        elsif t.qui = 'client_membre' then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable');
          insert into dossier_assignations (dossier_id, user_id) values (dr, client);
        end if;
        select to_jsonb(mb) into avant from memberships mb
         where mb.id = case t.cible when 'dx' then acces_dx when 'df' then acces_df when 'dr' then acces_dr else acces_dn end;
        begin
          if t.qui in ('chef', 'client_chef', 'client_membre') then
            set local role authenticated;
            perform set_config('request.jwt.claims',
              json_build_object('sub', case t.qui when 'chef' then chef else client end, 'role', 'authenticated')::text, true);
          elsif t.qui = 'service' then
            set local role service_role;
            perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
          end if;
          case t.geste
            when 'fonction_caisse' then
              select to_jsonb(r) into rendu from changer_droits_acces(
                case t.cible when 'dx' then acces_dx when 'df' then acces_df when 'dr' then acces_dr else acces_dn end, null, null, true) r;
            when 'fonction_banque' then
              select to_jsonb(r) into rendu from changer_droits_acces(
                case t.cible when 'dx' then acces_dx when 'df' then acces_df when 'dr' then acces_dr else acces_dn end, null, true, null) r;
            when 'mise_a_jour_caisse' then
              update memberships set droit_caisse = true
               where id = case t.cible when 'dx' then acces_dx when 'df' then acces_df when 'dr' then acces_dr else acces_dn end
              returning to_jsonb(memberships.*) into rendu;
            when 'insertion_caisse' then
              -- L'accès du compte du chef, qui n'en a aucun (le jeu de départ l'exige).
              insert into memberships (user_id, dossier_id, role, email, droit_caisse)
                values (chef, case t.cible when 'dx' then dx when 'df' then df when 'dr' then dr else dn end, 'client', 'essai-c10@example.test', true)
                returning to_jsonb(memberships.*) into rendu;
            when 'insertion_sans_droit' then
              insert into memberships (user_id, dossier_id, role, email)
                values (chef, case t.cible when 'dx' then dx when 'df' then df when 'dr' then dr else dn end, 'client', 'essai-c10@example.test')
                returning to_jsonb(memberships.*) into rendu;
          end case;
          code_recu := 'ACCEPTÉ';
        exception when others then code_recu := sqlstate; message := sqlerrm;
        end;
        reset role;
        perform set_config('request.jwt.claims', '', true);
        select to_jsonb(mb) into apres from memberships mb
         where mb.id = case t.cible when 'dx' then acces_dx when 'df' then acces_df when 'dr' then acces_dr else acces_dn end;
        obs := case when t.geste in ('insertion_caisse', 'insertion_sans_droit')
                    then 'accès ' || case when rendu is null then 'absent' else 'inséré, « Caisse » ' || (rendu ->> 'droit_caisse') end
                    else 'ligne relue ' || case when avant = apres then 'inchangée' else '« Caisse » ' || coalesce(apres ->> 'droit_caisse', '?')
                         || ', « Banque » ' || coalesce(apres ->> 'droit_banque', '?') end end;
        raise exception 'ANNULATION_ESSAI';
      exception when others then
        if sqlstate <> 'P0001' or sqlerrm <> 'ANNULATION_ESSAI' then code_recu := sqlstate; message := sqlerrm; end if;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('controle', t.num || '. ' || t.quoi
          || case when t.attendu = 'refus' and t.num::int < 150 then ' : refusé (23514), rien d''écrit' else '' end,
        'observe', coalesce(code_recu, '?') || coalesce(' ' || message, '') || ', ' || coalesce(obs, '?'),
        'ok', coalesce(case t.attendu
          when 'refus' then code_recu = '23514' and message = refus_caisse and (t.geste like 'insertion%' or avant = apres)
          else code_recu = 'ACCEPTÉ'
            and case t.geste
                  when 'fonction_caisse' then rendu = apres and (apres ->> 'droit_caisse') = 'true'
                  when 'fonction_banque' then rendu = apres and (apres ->> 'droit_caisse') = 'false' and (apres ->> 'droit_banque') = 'true'
                  when 'insertion_caisse' then (rendu ->> 'droit_caisse') = 'true'
                  when 'insertion_sans_droit' then (rendu ->> 'droit_caisse') = 'false'
                  else false end
          end, false));
    end loop;

    -- 134. Un accès qui porte déjà « Caisse » sur un dossier redevable (posé par la restauration : le propriétaire sous la
    -- session du super-administrateur) : « Banque » s'y change, « Caisse » s'y décoche, et ne s'y recoche plus — par la
    -- fonction, sous le super-administrateur, ni par le propriétaire. Puis un autre accès « Caisse » restauré sur DR,
    -- emporté vers DX, exonéré : accepté ; ramené vers DR : refusé.
    obs := null; code_recu := null; message := null;
    begin
      perform set_config('request.jwt.claims', '', true);
      insert into dossiers (id, nom, cabinet_id, statut_tva) values (dx, 'ESSAI C10 DX', cabinet, 'exonere'), (dr, 'ESSAI C10 DR', cabinet, 'redevable');
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      insert into memberships (id, user_id, dossier_id, role, email, droit_caisse) values
        (acces_dr, client, dr, 'client', 'essai-c10@example.test', true),
        (acces_dn, chef, dr, 'client', 'essai-c10@example.test', true);
      set local role authenticated;
      select 'Banque ' || r.droit_banque::int || r.droit_caisse::int into obs from changer_droits_acces(acces_dr, null, true, null) r;
      select obs || ' ; décochée ' || r.droit_banque::int || r.droit_caisse::int into obs from changer_droits_acces(acces_dr, null, null, false) r;
      begin
        perform changer_droits_acces(acces_dr, null, null, true);
        obs := obs || ' ; recochée ACCEPTÉ';
      exception when others then obs := obs || ' ; recochée ' || sqlstate || case when sqlerrm = refus_caisse then ' (ses mots)' else ' ' || sqlerrm end;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      begin
        update memberships set droit_caisse = true where id = acces_dr;
        obs := obs || ' ; propriétaire ACCEPTÉ';
      exception when others then obs := obs || ' ; propriétaire ' || sqlstate || case when sqlerrm = refus_caisse then ' (ses mots)' else ' ' || sqlerrm end;
      end;
      begin
        update memberships set dossier_id = dx where id = acces_dn;
        obs := obs || ' ; emporté vers DX ACCEPTÉ';
      exception when others then obs := obs || ' ; emporté vers DX ' || sqlstate || ' ' || sqlerrm;
      end;
      begin
        update memberships set dossier_id = dr where id = acces_dn;
        obs := obs || ' ; ramené vers DR ACCEPTÉ';
      exception when others then obs := obs || ' ; ramené vers DR ' || sqlstate || case when sqlerrm = refus_caisse then ' (ses mots)' else ' ' || sqlerrm end;
      end;
      raise exception 'ANNULATION_ESSAI';
    exception when others then
      if sqlstate <> 'P0001' or sqlerrm <> 'ANNULATION_ESSAI' then code_recu := sqlstate; message := sqlerrm; end if;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', '134. un accès « Caisse » restauré sur un dossier redevable : « Banque » s''y change, « Caisse » s''y décoche et ne s''y recoche plus ; un accès « Caisse » emporté vers ce dossier, refusé',
      'observe', coalesce(obs, '?') || coalesce(', ' || code_recu || ' ' || message, ''),
      'ok', coalesce(obs = 'Banque 11 ; décochée 10 ; recochée 23514 (ses mots) ; propriétaire 23514 (ses mots) ; emporté vers DX ACCEPTÉ ; ramené vers DR 23514 (ses mots)'
        and code_recu is null, false));

    -- 135. Le catalogue de la garde de la case : aux droits du propriétaire, chemin fixé, qu'aucun rôle de l'API n'exécute ;
    -- son déclencheur, APRÈS l'insertion et la mise à jour de `droit_caisse` ou de `dossier_id`, ligne par ligne, actif.
    select p.prosecdef || ' ' || p.provolatile::text || ' ' || coalesce(array_to_string(p.proconfig, ','), '') || ' ' || l.lanname
           || ' anon ' || has_function_privilege('anon', p.oid, 'execute')
           || ' authenticated ' || has_function_privilege('authenticated', p.oid, 'execute')
           || ' public ' || exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0 and x.privilege_type = 'EXECUTE')
           || ' | ' || coalesce((select string_agg(pg_get_triggerdef(tg.oid) || ' ' || tg.tgenabled::text, ' ; ' order by tg.tgname) from pg_trigger tg
                                  where tg.tgfoid = p.oid and not tg.tgisinternal), 'aucun déclencheur')
      into obs
      from pg_proc p join pg_language l on l.oid = p.prolang where p.oid = to_regprocedure('public.garder_droit_caisse()');
    verdicts := verdicts || jsonb_build_object('controle', '135. la garde de la case : security definer, chemin fixé, exécutée par aucun rôle de l''API ; son déclencheur, après l''insertion et la mise à jour de droit_caisse ou de dossier_id',
      'observe', coalesce(obs, 'garde absente'),
      'ok', coalesce(obs = 'true v search_path=public plpgsql anon false authenticated false public false | CREATE TRIGGER memberships_droit_caisse AFTER INSERT OR UPDATE OF droit_caisse, dossier_id ON public.memberships FOR EACH ROW EXECUTE FUNCTION garder_droit_caisse() O', false));

    -- 140 à 146, et les mutations 153 et 155. La garde du statut : un dossier dont un accès porte « Caisse » ne quitte pas
    -- les deux statuts exclus (23514, ses mots), par aucun chemin — le statut, ou le booléen que `deduire_assujetti_tva`
    -- traduit en statut — ; passer de l'un à l'autre, ou y entrer, passe. La ligne du dossier est RELUE après.
    for t in select * from (values
        ('140', 'le propriétaire, sans session, passe redevable un dossier exonéré dont un accès porte « Caisse »', 'proprietaire', 'redevable', 'case', 'refus', 'exonere'),
        ('141', 'le propriétaire le passe au statut à préciser (nul)', 'proprietaire', 'nul', 'case', 'refus', 'exonere'),
        ('142', 'le chef du cabinet, sous sa session, le passe redevable', 'chef', 'redevable', 'case', 'refus', 'exonere'),
        ('143', 'le chef du cabinet le dit assujetti (le booléen, que deduire_assujetti_tva traduit en « redevable »)', 'chef', 'assujetti', 'case', 'refus', 'exonere'),
        ('144', 'le chef le passe en franchise en base, puis de nouveau exonéré : accepté', 'chef', 'franchise_puis_exonere', 'case', 'accepte', 'exonere'),
        ('145', 'un dossier exonéré sans case « Caisse », passé redevable par le chef : accepté', 'chef', 'redevable', 'sans_case', 'accepte', 'redevable'),
        ('146', 'un dossier redevable où la restauration a posé « Caisse », passé exonéré par le chef : accepté (y entrer ne se juge pas)', 'chef', 'dr_exonere', 'case_restauree', 'accepte', 'exonere'),
        ('153', 'MUTATION — le contrôle 140 sans la case : la mise à jour passe', 'proprietaire', 'redevable', 'sans_case', 'accepte', 'redevable'),
        ('155', 'MUTATION — le contrôle 143 avec le booléen inchangé (faux) : rien à juger, la mise à jour passe', 'chef', 'non_assujetti', 'case', 'accepte', 'exonere')
      ) as v(num, quoi, qui, geste, case_posee, attendu, statut_attendu) loop
      code_recu := null; message := null; obs := null;
      begin
        perform set_config('request.jwt.claims', '', true);
        insert into dossiers (id, nom, cabinet_id, statut_tva) values (dx, 'ESSAI C10 DX', cabinet, 'exonere'), (dr, 'ESSAI C10 DR', cabinet, 'redevable');
        insert into memberships (id, user_id, dossier_id, role, email, droit_caisse) values
          (acces_dx, client, dx, 'client', 'essai-c10@example.test', t.case_posee = 'case');
        if t.case_posee = 'case_restauree' then
          perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
          insert into memberships (id, user_id, dossier_id, role, email, droit_caisse) values (acces_dr, client, dr, 'client', 'essai-c10@example.test', true);
          perform set_config('request.jwt.claims', '', true);
        end if;
        begin
          if t.qui = 'chef' then
            set local role authenticated;
            perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
          end if;
          case t.geste
            when 'redevable' then update dossiers set statut_tva = 'redevable' where id = dx;
            when 'nul' then update dossiers set statut_tva = null where id = dx;
            when 'assujetti' then update dossiers set assujetti_tva = true where id = dx;
            when 'non_assujetti' then update dossiers set assujetti_tva = false where id = dx;
            when 'franchise_puis_exonere' then
              update dossiers set statut_tva = 'franchise' where id = dx;
              update dossiers set statut_tva = 'exonere' where id = dx;
            when 'dr_exonere' then update dossiers set statut_tva = 'exonere' where id = dr;
          end case;
          get diagnostics n = row_count;
          code_recu := case when n = 1 then 'ACCEPTÉ' else 'AUCUNE LIGNE' end;
        exception when others then code_recu := sqlstate; message := sqlerrm;
        end;
        reset role;
        perform set_config('request.jwt.claims', '', true);
        select coalesce(d.statut_tva, 'nul') into obs from dossiers d where d.id = case when t.geste = 'dr_exonere' then dr else dx end;
        raise exception 'ANNULATION_ESSAI';
      exception when others then
        if sqlstate <> 'P0001' or sqlerrm <> 'ANNULATION_ESSAI' then code_recu := sqlstate; message := sqlerrm; end if;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('controle', t.num || '. ' || t.quoi || case when t.attendu = 'refus' then ' : refusé (23514), le statut relu inchangé' else '' end,
        'observe', coalesce(code_recu, '?') || coalesce(' ' || message, '') || ', statut relu ' || coalesce(obs, '?'),
        'ok', coalesce(case t.attendu when 'refus' then code_recu = '23514' and message = refus_statut
                                      else code_recu = 'ACCEPTÉ' end
          and obs = t.statut_attendu, false));
    end loop;

    -- 147. Le catalogue de la garde du statut et de celle de la nature : aux droits du propriétaire, chemin fixé, qu'aucun
    -- rôle de l'API n'exécute ; leurs déclencheurs, APRÈS la ligne — le statut, sur toute mise à jour qui le CHANGE (la
    -- clause `when`, quel que soit le chemin) ; la nature, sur l'insertion et la mise à jour de sa colonne.
    select string_agg(p.proname || ' ' || p.prosecdef || ' ' || coalesce(array_to_string(p.proconfig, ','), '')
             || ' anon ' || has_function_privilege('anon', p.oid, 'execute') || ' authenticated ' || has_function_privilege('authenticated', p.oid, 'execute')
             || ' public ' || exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0 and x.privilege_type = 'EXECUTE')
             || ' | ' || coalesce((select string_agg(pg_get_triggerdef(tg.oid) || ' ' || tg.tgenabled::text, ' ; ' order by tg.tgname) from pg_trigger tg
                                    where tg.tgfoid = p.oid and not tg.tgisinternal), 'aucun déclencheur'), ' ; ' order by p.proname collate "C")
      into obs
      from pg_proc p where p.oid in (to_regprocedure('public.garder_statut_tva_de_la_caisse()'), to_regprocedure('public.garder_categorie_recettes_client()'));
    verdicts := verdicts || jsonb_build_object('controle', '147. les gardes du statut et de la nature : security definer, chemin fixé, exécutées par aucun rôle de l''API ; leurs déclencheurs, après la ligne',
      'observe', coalesce(obs, 'gardes absentes'),
      'ok', coalesce(obs = 'garder_categorie_recettes_client true search_path=public anon false authenticated false public false | CREATE TRIGGER dossiers_categorie_recettes_client AFTER INSERT OR UPDATE OF categorie_recettes_client ON public.dossiers FOR EACH ROW EXECUTE FUNCTION garder_categorie_recettes_client() O'
        || ' ; garder_statut_tva_de_la_caisse true search_path=public anon false authenticated false public false | CREATE TRIGGER dossiers_statut_tva_de_la_caisse AFTER UPDATE ON public.dossiers FOR EACH ROW WHEN ((old.statut_tva IS DISTINCT FROM new.statut_tva)) EXECUTE FUNCTION garder_statut_tva_de_la_caisse() O', false));
  end if;

  -- ══ 60. Rien n'est resté ════════════════════════════════════════════════════════════════════════════════════
  select coalesce(jsonb_agg(to_jsonb(mb) order by mb.id), '[]'::jsonb) into apres from memberships mb;
  -- L'écart seul, non plus les comptes de toute la base, qui diraient le volume d'un dossier réel (audit du 29/10/2026).
  verdicts := verdicts || jsonb_build_object('controle', '60. rien n''est resté en base',
    'observe', 'accès ' || case when apres = instantane then 'identiques, droits compris' else 'CHANGÉS' end
      || ', chefs et membres ' || to_char((select count(*) from cabinet_admins) - admins_avant, 'FMSG9999999990')
      || ', affectations ' || to_char((select count(*) from dossier_assignations) - assignations_avant, 'FMSG9999999990')
      || ', super-administrateurs ' || to_char((select count(*) from super_admins) - supers_avant, 'FMSG9999999990')
      || ', dossiers ' || to_char((select count(*) from dossiers) - dossiers_avant, 'FMSG9999999990')
      || ', dont basculés ' || to_char((select count(*) from dossiers where ventes_par_les_factures) - bascules_avant, 'FMSG9999999990')
      || ', droit d''exécution d''anon ' || has_function_privilege('anon', 'public.changer_droits_acces(uuid, boolean, boolean)', 'execute')
      || ', statuts et natures ' || case when statuts_avant = (select md5(coalesce(string_agg(d.id::text || ':' || coalesce(d.statut_tva, '-') || ':'
           || coalesce(to_jsonb(d) ->> 'categorie_recettes_client', '-'), ',' order by d.id), '')) from dossiers d) then 'identiques' else 'CHANGÉS' end,
    'ok', coalesce(apres = instantane
      and admins_avant = (select count(*) from cabinet_admins)
      and assignations_avant = (select count(*) from dossier_assignations)
      and supers_avant = (select count(*) from super_admins)
      and dossiers_avant = (select count(*) from dossiers)
      and bascules_avant = (select count(*) from dossiers where ventes_par_les_factures)
      and not exists (select 1 from cabinet_admins where user_id = client)
      and not has_function_privilege('anon', 'public.changer_droits_acces(uuid, boolean, boolean)', 'execute')
      and not exists (select 1 from dossiers where id in (dx, df, dr, dn))
      and statuts_avant = (select md5(coalesce(string_agg(d.id::text || ':' || coalesce(d.statut_tva, '-') || ':'
           || coalesce(to_jsonb(d) ->> 'categorie_recettes_client', '-'), ',' order by d.id), '')) from dossiers d), false));

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
