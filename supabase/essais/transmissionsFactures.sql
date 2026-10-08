-- LES TRANSMISSIONS D'UNE FACTURE, ÉPROUVÉES EN BASE — à rejouer par `execute_sql` après toute migration qui touche
-- `transmissions_factures`, son déclencheur `garder_transmission_facture` ou ses policies (ligne 28.5, étape c).
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - QUI LIT ET QUI ÉCRIT : un anonyme, un compte rattaché à rien et un client ne voient AUCUNE transmission — alors
--     qu'il en existe une — et se font refuser l'écriture ; le chef du cabinet la VOIT et n'en modifie aucune ; le
--     rôle `service_role`, celui des Edge Functions, écrit et fait avancer une transmission (le contrôle POSITIF) ; le
--     super-administrateur en insère une (la restauration d'une sauvegarde) ;
--   - CE QUE LA TABLE REFUSE SEULE : un canal ou un état inconnu, un hôte qui n'est pas un nom de domaine, une
--     empreinte qui n'est pas un SHA-256, un flux vide, une transmission déposée sans flux ;
--   - CE QUE LE DÉCLENCHEUR GARANTIT : une transmission désigne une facture VALIDÉE de SON dossier ; elle ne change ni
--     de facture, ni de dossier, ni de canal, ni d'hôte, ni de fichier ; son flux ne se renomme pas ; elle ne revient
--     pas en arrière ;
--   - UNE SEULE TRANSMISSION ACTIVE PAR FACTURE, tous canaux confondus, et une nouvelle après un échec ;
--   - UNE FACTURE REJETÉE OU REFUSÉE S'ANNULE PAR UN AVOIR INTERNE, qui ne se transmet pas (DGFiP, spécifications
--     externes, § 3.6.4 ; migration `avoir_interne_d_une_facture_rejetee`) : une facture rejetée ne repart pas, sauf
--     un rejet postérieur — une restauration rejoue l'historique avec ses dates — ; l'avoir d'une facture rejetée, ou
--     refusée chez Super PDP (statut 210), ne se transmet pas ; celui d'une facture simplement transmise, si ;
--   - CE QUE LE CATALOGUE DIT, faute de pouvoir le jouer sans suppression : ni modification ni suppression depuis le
--     navigateur (deux policies seulement), la suppression d'un dossier ou d'une facture emporte ses transmissions, et
--     personne n'appelle le déclencheur en RPC ;
--   - et que RIEN ne reste en base après l'essai.
--
-- QUI REFUSE L'ÉCRITURE, ET POURQUOI CE N'EST PAS TOUJOURS LA RLS : le déclencheur lit la facture avec les droits de
-- l'appelant, et il passe AVANT la RLS. Un anonyme, un compte rattaché à rien ou un client ne voient pas la facture,
-- donc le déclencheur les refuse le premier (23514) — sans leur dire si elle existe, ce qu'un déclencheur
-- `security definer` aurait trahi. La policy d'insertion (le super-administrateur seul) ne décide donc que pour qui VOIT
-- la facture : un membre du cabinet qui n'est pas super-administrateur. Aucun n'existe sur ce projet, et en créer un
-- demanderait un compte : ce cas n'est pas joué ici, et c'est dit plutôt que promis.
--
-- Chaque contrôle s'annule dans sa sous-transaction (`ANNULATION_ESSAI`, P0001), le verdict posé dans une VARIABLE
-- avant le `raise`, comme rls.sql. Un refus se juge à son code ET à son message. Les verdicts voyagent dans un réglage
-- LOCAL à la transaction (`essai.transmissions`), que la requête finale lit.
--
-- ÉPROUVÉ LE 08/10/2026 : 38 contrôles sur 38 en production — les contrôles 1 à 3 rejoués après la correction de leur
-- verdict, qui n'attendait d'abord que le refus de la RLS. Aucune campagne de mutations sur une réplique pour cet essai.
-- Puis, le même jour, 43 sur 43 après la migration `avoir_interne_d_une_facture_rejetee`, dont viennent les contrôles
-- 38 à 42 (« rien n'est resté », d'abord le 38e, est devenu le 43e).
--
-- L'AVOIR D'ESSAI se crée par `enregistrer_facture`, sous le chef du cabinet, dans la sous-transaction du contrôle :
-- son numéro de la série « A » est consommé puis rendu par l'annulation, et rien ne reste.
do $$
declare
  inconnu uuid := gen_random_uuid();
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  empreinte text := repeat('ab', 32);

  facture_v uuid; dossier_f uuid; autre_dossier uuid; brouillon uuid; ident uuid; chef_super boolean; avoir uuid;
  accepte boolean; code_recu text; message_recu text; obs text; attendu boolean; requete text; motif text;
  a text; b text; vus int; n_maj int;
  transmissions_avant int; factures_avant int;
  verdicts jsonb := '[]'::jsonb;
begin
  select f.id, f.dossier_id into facture_v, dossier_f from factures_emises f where f.statut = 'validee' order by f.id limit 1;
  select d.id into autre_dossier from dossiers d where d.id <> dossier_f order by d.id limit 1;
  select exists (select 1 from super_admins s where s.user_id = chef) into chef_super;
  if facture_v is null or autre_dossier is null then
    raise exception 'ESSAI_IMPOSSIBLE : il faut une facture validée et un second dossier';
  end if;
  if exists (select 1 from transmissions_factures where facture_id = facture_v) then
    raise exception 'ESSAI_IMPOSSIBLE : la facture d''essai porte déjà une transmission';
  end if;
  select count(*) into transmissions_avant from transmissions_factures;
  select count(*) into factures_avant from factures_emises;

  -- ══ 1 à 3. Une transmission EXISTE, et l'anonyme, le compte rattaché à rien et le client ne l'atteignent pas ═══
  for obs in select unnest(array['1. anonyme', '2. rattaché à rien', '3. client']) loop
    accepte := false; code_recu := null; message_recu := null; vus := null; n_maj := null;
    begin
      insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256)
        values (dossier_f, facture_v, 'superpdp', 'api.superpdp.tech', empreinte);
      if obs like '1.%' then
        set local role anon;
        perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      else
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub',
          case when obs like '2.%' then inconnu else client end, 'role', 'authenticated')::text, true);
      end if;
      select count(*) into vus from transmissions_factures;
      update transmissions_factures set detail = 'essai' where facture_id = facture_v;
      get diagnostics n_maj = row_count;
      insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat)
        values (dossier_f, facture_v, 'superpdp', 'api.superpdp.tech', empreinte, 'echec');
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message_recu := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', obs || ' : ne voit, ne modifie ni n''écrit aucune transmission',
      'observe', 'vues : ' || coalesce(vus::text, '?') || ', modifiées : ' || coalesce(n_maj::text, '?') || ' — '
        || coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''),
      'ok', not accepte and vus = 0 and n_maj = 0
        and (code_recu = '42501' and message_recu like 'new row violates row-level security policy%'
             or code_recu = '23514' and message_recu like 'Seule une facture validée de son dossier se transmet%'));
  end loop;

  -- ══ 4. Le chef la voit et n'en modifie aucune ; super-administrateur, il en insère une (la restauration) ═══════
  accepte := false; code_recu := null; message_recu := null; vus := null; n_maj := null;
  begin
    insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256)
      values (dossier_f, facture_v, 'superpdp', 'api.superpdp.tech', empreinte);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select count(*) into vus from transmissions_factures where facture_id = facture_v;
    update transmissions_factures set detail = 'essai' where facture_id = facture_v;
    get diagnostics n_maj = row_count;
    insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat)
      values (dossier_f, facture_v, 'plateforme', 'pa.exemple.fr', empreinte, 'echec');
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message_recu := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '4. le chef voit la transmission, n''en modifie aucune, et en insère une s''il est super-administrateur',
    'observe', 'super-administrateur : ' || chef_super || ', vues : ' || coalesce(vus::text, '?') || ', modifiées : '
      || coalesce(n_maj::text, '?') || ' — ' || coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''),
    'ok', vus = 1 and n_maj = 0 and (case when chef_super then accepte and code_recu = 'P0001'
      else not accepte and code_recu = '42501' end));

  -- ══ 5. Le rôle des Edge Functions écrit et fait avancer une transmission ═════════════════════════════════════
  accepte := false; code_recu := null; message_recu := null; obs := null;
  begin
    set local role service_role;
    insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256)
      values (dossier_f, facture_v, 'plateforme', 'pa.exemple.fr', empreinte) returning id into ident;
    update transmissions_factures set etat = 'depose', flux_id = 'flux-1' where id = ident;
    update transmissions_factures set etat = 'accepte', detail = 'accusé positif' where id = ident;
    select etat || ':' || flux_id || ':' || detail into obs from transmissions_factures where id = ident;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message_recu := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '5. la fonction (service_role) écrit, dépose et fait accepter',
    'observe', coalesce(obs, '?') || ' — ' || coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''),
    'ok', accepte and code_recu = 'P0001' and obs = 'accepte:flux-1:accusé positif');

  -- ══ 6 à 16. Ce que la table et son déclencheur refusent à l'insertion ════════════════════════════════════════
  for obs, motif, requete in
    select * from (values
      ('6. un canal inconnu', 'transmissions_factures_canal',
        format('insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256) values (%L, %L, ''courrier'', ''api.superpdp.tech'', %L)', dossier_f, facture_v, empreinte)),
      ('7. un hôte qui est une adresse', 'transmissions_factures_hote',
        format('insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256) values (%L, %L, ''plateforme'', ''https://pa.exemple.fr'', %L)', dossier_f, facture_v, empreinte)),
      ('8. un hôte sans point', 'transmissions_factures_hote',
        format('insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256) values (%L, %L, ''plateforme'', ''localhost'', %L)', dossier_f, facture_v, empreinte)),
      ('9. une empreinte qui n''est pas un SHA-256', 'transmissions_factures_sha256',
        format('insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256) values (%L, %L, ''superpdp'', ''api.superpdp.tech'', ''ABC'')', dossier_f, facture_v)),
      ('10. un état inconnu', 'transmissions_factures_etat',
        format('insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat) values (%L, %L, ''superpdp'', ''api.superpdp.tech'', %L, ''perdu'')', dossier_f, facture_v, empreinte)),
      ('11. un flux vide', 'transmissions_factures_flux_id',
        format('insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, flux_id) values (%L, %L, ''superpdp'', ''api.superpdp.tech'', %L, '''')', dossier_f, facture_v, empreinte)),
      ('12. une transmission déposée sans flux', 'transmissions_factures_flux_connu',
        format('insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat) values (%L, %L, ''superpdp'', ''api.superpdp.tech'', %L, ''depose'')', dossier_f, facture_v, empreinte)),
      ('13. une facture qui n''existe pas', 'Seule une facture validée de son dossier se transmet',
        format('insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256) values (%L, %L, ''superpdp'', ''api.superpdp.tech'', %L)', dossier_f, gen_random_uuid(), empreinte)),
      ('14. la facture d''un autre dossier', 'Seule une facture validée de son dossier se transmet',
        format('insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256) values (%L, %L, ''superpdp'', ''api.superpdp.tech'', %L)', autre_dossier, facture_v, empreinte)),
      ('16. une seconde transmission active', 'transmissions_factures_une_active',
        format('insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256) values (%L, %L, ''superpdp'', ''api.superpdp.tech'', %L), (%L, %L, ''plateforme'', ''pa.exemple.fr'', %L)',
          dossier_f, facture_v, empreinte, dossier_f, facture_v, empreinte))
    ) t(o, m, r)
  loop
    accepte := false; code_recu := null; message_recu := null;
    begin
      set local role service_role;
      execute requete;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message_recu := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', obs || ' : refusé',
      'observe', coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''),
      'ok', not accepte and code_recu in ('23514', '23505') and message_recu like '%' || motif || '%');
  end loop;

  -- Le brouillon naît et disparaît dans la sous-transaction du contrôle : rien ne reste.
  accepte := false; code_recu := null; message_recu := null;
  begin
    insert into factures_emises (dossier_id, tiers_nom) values (dossier_f, 'Essai brouillon') returning id into brouillon;
    set local role service_role;
    insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256)
      values (dossier_f, brouillon, 'superpdp', 'api.superpdp.tech', empreinte);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message_recu := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '15. un brouillon : refusé',
    'observe', coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''),
    'ok', not accepte and code_recu = '23514' and message_recu like 'Seule une facture validée de son dossier se transmet%');

  -- ══ 17 et 18. Une nouvelle transmission après un échec, pas après un dépôt ═══════════════════════════════════
  for obs, a, attendu in
    select * from (values ('17. après un échec, une nouvelle transmission part', 'echec', true),
                          ('18. après un dépôt, aucune autre ne part', 'depose', false)) t(o, e, x)
  loop
    accepte := false; code_recu := null; message_recu := null;
    begin
      set local role service_role;
      insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat, flux_id)
        values (dossier_f, facture_v, 'superpdp', 'api.superpdp.tech', empreinte, a, 'flux-1');
      insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256)
        values (dossier_f, facture_v, 'plateforme', 'pa.exemple.fr', empreinte);
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message_recu := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', obs,
      'observe', coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''),
      'ok', case when attendu then accepte and code_recu = 'P0001'
        else not accepte and code_recu = '23505' and message_recu like '%transmissions_factures_une_active%' end);
  end loop;

  -- ══ 19 à 27. Une transmission avance, elle ne revient pas en arrière ═════════════════════════════════════════
  for obs, a, b, attendu in
    select * from (values
      ('19. un envoi se dépose', 'envoi', 'depose', true),
      ('20. un envoi échoue', 'envoi', 'echec', true),
      ('21. un dépôt est accepté', 'depose', 'accepte', true),
      ('22. un dépôt est rejeté', 'depose', 'rejete', true),
      ('23. un dépôt ne redevient pas un envoi', 'depose', 'envoi', false),
      ('24. un dépôt ne devient pas un échec', 'depose', 'echec', false),
      ('25. un échec ne se dépose pas', 'echec', 'depose', false),
      ('26. une transmission acceptée ne change plus', 'accepte', 'rejete', false),
      ('27. une transmission rejetée ne repart pas', 'rejete', 'envoi', false)
    ) t(o, e1, e2, x)
  loop
    accepte := false; code_recu := null; message_recu := null;
    begin
      set local role service_role;
      insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat, flux_id)
        values (dossier_f, facture_v, 'superpdp', 'api.superpdp.tech', empreinte, a, 'flux-1') returning id into ident;
      update transmissions_factures set etat = b where id = ident;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message_recu := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', obs,
      'observe', coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''),
      'ok', case when attendu then accepte and code_recu = 'P0001'
        else not accepte and code_recu = '23514' and message_recu like 'Une transmission ne revient pas en arrière%' end);
  end loop;

  -- ══ 28 à 33. Ce qui ne change pas après l'insertion ══════════════════════════════════════════════════════════
  for obs, motif, requete in
    select * from (values
      ('28. le canal', 'ne change ni de facture', 'canal = ''plateforme'''),
      ('29. l''hôte', 'ne change ni de facture', 'hote = ''autre.exemple.fr'''),
      ('30. le fichier', 'ne change ni de facture', format('sha256 = %L', repeat('cd', 32))),
      ('31. le dossier', 'ne change ni de facture', format('dossier_id = %L', autre_dossier)),
      ('32. la date de création', 'ne change ni de facture', 'cree_le = cree_le - interval ''1 day'''),
      ('33. le flux, une fois nommé', 'Le flux d''une transmission ne se renomme pas', 'flux_id = ''flux-2''')
    ) t(o, m, r)
  loop
    accepte := false; code_recu := null; message_recu := null;
    begin
      set local role service_role;
      insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat, flux_id)
        values (dossier_f, facture_v, 'superpdp', 'api.superpdp.tech', empreinte, 'depose', 'flux-1') returning id into ident;
      execute format('update transmissions_factures set %s where id = %L', requete, ident);
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message_recu := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', obs || ' ne change pas',
      'observe', coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''),
      'ok', not accepte and code_recu = '23514' and message_recu like '%' || motif || '%');
  end loop;

  -- ══ 34 à 37. Ce que le catalogue dit ═════════════════════════════════════════════════════════════════════════
  select string_agg(p.policyname || ' ' || p.roles::text || ' ' || p.cmd, ', ' order by p.policyname) into obs
    from pg_policies p where p.schemaname = 'public' and p.tablename = 'transmissions_factures';
  verdicts := verdicts || jsonb_build_object('controle', '34. catalogue : deux policies, lecture et restauration, rien d''autre',
    'observe', obs, 'ok', obs = 'transmissions_factures_lecture {authenticated} SELECT, transmissions_factures_restauration {authenticated} INSERT');

  select string_agg(c.conname || ':' || c.confdeltype::text, ', ' order by c.conname) into obs
    from pg_constraint c where c.conrelid = 'public.transmissions_factures'::regclass and c.contype = 'f';
  verdicts := verdicts || jsonb_build_object('controle', '35. catalogue : la suppression d''un dossier ou d''une facture emporte ses transmissions',
    'observe', obs, 'ok', obs = 'transmissions_factures_dossier_id_fkey:c, transmissions_factures_facture_id_fkey:c');

  select (select relrowsecurity from pg_class where oid = 'public.transmissions_factures'::regclass)::text || ' '
      || has_function_privilege('anon', 'public.garder_transmission_facture()', 'execute')::text || ' '
      || has_function_privilege('authenticated', 'public.garder_transmission_facture()', 'execute')::text into obs;
  verdicts := verdicts || jsonb_build_object('controle', '36. catalogue : RLS activée, déclencheur hors de portée en RPC',
    'observe', obs, 'ok', obs = 'true false false');

  select pg_get_indexdef(i.indexrelid) into obs from pg_index i
    where i.indexrelid = 'public.transmissions_factures_une_active'::regclass;
  verdicts := verdicts || jsonb_build_object('controle', '37. catalogue : une seule transmission active par facture',
    'observe', obs, 'ok', obs like 'CREATE UNIQUE INDEX transmissions_factures_une_active%(facture_id) WHERE%envoi%depose%accepte%');

  -- ══ 38 et 39. Une facture rejetée ne repart pas, sauf un rejet postérieur (la restauration) ════════════════════
  for obs, attendu in
    select * from (values ('38. après un rejet, aucune transmission ne part', false),
                          ('39. un rejet postérieur n''empêche pas de restaurer une transmission antérieure', true)) t(o, x)
  loop
    accepte := false; code_recu := null; message_recu := null;
    begin
      set local role service_role;
      insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat, flux_id)
        values (dossier_f, facture_v, 'plateforme', 'pa.exemple.fr', empreinte, 'rejete', 'flux-1');
      if attendu then
        insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat, cree_le)
          values (dossier_f, facture_v, 'superpdp', 'api.superpdp.tech', empreinte, 'echec', now() - interval '1 day');
      else
        insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256)
          values (dossier_f, facture_v, 'superpdp', 'api.superpdp.tech', empreinte);
      end if;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message_recu := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', obs,
      'observe', coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''),
      'ok', case when attendu then accepte and code_recu = 'P0001'
        else not accepte and code_recu = '23514' and message_recu like 'Une facture rejetée ne repart pas%' end);
  end loop;

  -- ══ 40 à 42. L'avoir d'une facture rejetée ou refusée est interne ; celui d'une facture transmise se transmet ═════
  for obs, motif, attendu in
    select * from (values
      ('40. l''avoir d''une facture rejetée par une plateforme ne se transmet pas', 'rejete', false),
      ('41. l''avoir d''une facture refusée chez Super PDP (210) ne se transmet pas', 'fr:210', false),
      ('42. l''avoir d''une facture transmise et acceptée se transmet', 'accepte', true)
    ) t(o, m, x)
  loop
    accepte := false; code_recu := null; message_recu := null; avoir := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      select r.facture_id into avoir from enregistrer_facture(dossier_f, null,
        jsonb_build_object('type', 'avoir', 'facture_origine_id', facture_v, 'date_emission', current_date,
          'montant_ht', -1, 'montant_tva', 0, 'montant_ttc', -1, 'notes', 'essai'),
        '[{"designation": "essai", "quantite": -1, "prix_unitaire_ht": 1, "taux_tva": 0}]'::jsonb, true) r;
      reset role;
      set local role service_role;
      if motif = 'fr:210' then
        insert into facture_superpdp_events (dossier_id, facture_id, superpdp_event_id, status_code, status_text, occurred_at)
          values (dossier_f, facture_v, -1, 'fr:210', 'essai', now());
        insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat, flux_id)
          values (dossier_f, facture_v, 'superpdp', 'api.superpdp.tech', empreinte, 'accepte', '-1');
      else
        insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat, flux_id)
          values (dossier_f, facture_v, 'plateforme', 'pa.exemple.fr', empreinte, motif, 'flux-1');
      end if;
      insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256)
        values (dossier_f, avoir, 'plateforme', 'pa.exemple.fr', empreinte);
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message_recu := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', obs,
      'observe', 'avoir ' || coalesce(left(avoir::text, 8), '?') || ' — ' || coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''),
      'ok', avoir is not null and case when attendu then accepte and code_recu = 'P0001'
        else not accepte and code_recu = '23514' and message_recu like 'Cet avoir annule une facture rejetée ou refusée%' end);
  end loop;

  -- ══ 43. Rien n'est resté ══════════════════════════════════════════════════════════════════════════════════════
  verdicts := verdicts || jsonb_build_object('controle', '43. rien n''est resté en base',
    'observe', 'transmissions ' || transmissions_avant || ' -> ' || (select count(*) from transmissions_factures)
      || ', factures ' || factures_avant || ' -> ' || (select count(*) from factures_emises),
    'ok', transmissions_avant = (select count(*) from transmissions_factures)
      and factures_avant = (select count(*) from factures_emises));

  perform set_config('essai.transmissions', verdicts::text, true);
end $$;

select v.controle, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.transmissions')::jsonb) as v(controle text, ok boolean, observe text)
order by (regexp_match(v.controle, '^(\d+)'))[1]::int, v.controle;
