-- L'ALERTE DU CHIFFRE D'AFFAIRES : LES SEUILS DE HAUSSE ET DE BAISSE DU DOSSIER ET LA MARQUE « VUE AVEC LE CLIENT » (la
-- migration `hausse_du_chiffre_d_affaires`, PRÉPARÉE le 15/11/2026, REPRISE le 16/11/2026 sur les réponses du cabinet,
-- supabase/preparees/20261115140000_hausse_du_chiffre_d_affaires.sql). Le récit : HISTORIQUE.md, « 15/11/2026 — L'ALERTE DE
-- HAUSSE DU CHIFFRE D'AFFAIRES » et « 16/11/2026 — L'ALERTE DU CHIFFRE D'AFFAIRES REPRISE ». À rejouer par `execute_sql` après
-- toute migration qui touche `seuils_du_chiffre_d_affaires`, `hausses_vues_avec_le_client`, leurs gardes, leurs deux
-- fonctions, `admin_du_dossier` ou `is_super_admin`. Le retrait d'une ligne ne se joue pas ici (l'outil d'exécution de la
-- production retient une suppression) : il se joue dans son compagnon de réplique, hausseDuChiffreDAffairesSuppression.sql.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - le catalogue : les colonnes, les contraintes au texte près, la RLS et les policies (le cabinet du dossier, à
--     authenticated ; aucune mise à jour ni aucun retrait d'une marque), les gardes avant toute écriture, les droits
--     d'exécution (les deux fonctions à authenticated seul, les gardes à personne, aux droits de l'appelant) ;
--   - les seuils, chacun réglé à part : la hausse puis la baisse réglées par le chef, relues, le dernier réglage à son nom et
--     à l'instant de l'écriture ; un seuil changé depuis sa lecture refuse le tout (40001), sens par sens ; hors de ses bornes
--     (de 1 à 1 000 pour la hausse, de 1 à 100 pour la baisse), refusé (22023) ; un sens inconnu ou nul, refusé (22023) ; régler
--     ou vider l'un laisse l'autre intact ; une seconde ligne, un autre auteur écrit en direct, un passage à un autre dossier,
--     un seuil hors bornes écrit en direct : refusés ou effacés par la base ;
--   - la marque : posée par le chef sur le dernier trimestre clos, à son nom ; une seconde fois, le trimestre en cours, un
--     rang hors de 1 à 4 : refusés sous leurs mots ; écrite en direct, son auteur et son instant sont ceux de l'écriture ; ni le
--     chef ni le propriétaire ne la réécrivent ;
--   - les droits : le client d'essai, même avec un accès au dossier, un compte connecté qu'aucun accès ne nomme et l'anonyme
--     n'écrivent ni ne lisent rien ;
--   - la porte de la restauration : le super-administrateur (le chef d'essai l'est) garde l'auteur et l'instant qu'il écrit en
--     direct ; un chef qui ne l'est pas — le client d'essai rattaché au cabinet le temps de son étape, que l'étape annule
--     (`ANNULATION_ETAPE`, le patron de previsionsPubliees.sql) — non : la base les pose.
-- Un dossier jetable du cabinet du dossier `test` (préfixe `ca520000-0000-4000-8000`), et un accès du client d'essai à ce
-- dossier, sans case. Chaque étape se joue dans sa sous-transaction ; le jeu s'annule à la fin (`ANNULATION_ESSAI_GLOBALE`). Les
-- verdicts voyagent dans un réglage LOCAL à la transaction (`essai.hausse_du_ca`), que la requête finale lit : le fichier se
-- joue d'un seul appel, ne crée ni table ni fonction, ne contient aucune instruction de suppression, et ne rend rien qui
-- dépende d'une ligne hors de son dossier. Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`). Sans la
-- migration, une ligne dit qu'il attend (EN ATTENTE) et rien ne s'écrit.

do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  -- Un compte connecté qu'aucun accès ni aucun cabinet ne nomme.
  inconnu constant text := 'ca520000-0000-4000-8000-0000000000f1';
  dossier constant text := 'ca520000-0000-4000-8000-0000000000d1';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  -- Le jour de Paris, le trimestre qui le porte et le dernier trimestre clos.
  jour constant date := (now() at time zone 'Europe/Paris')::date;
  en_cours_annee constant integer := extract(year from (now() at time zone 'Europe/Paris')::date)::integer;
  en_cours_rang constant integer := (extract(month from (now() at time zone 'Europe/Paris')::date)::integer + 2) / 3;
  clos_annee integer;
  clos_rang integer;
  verdicts jsonb := '[]'::jsonb;
  e record;
  v_req text;
  v_obs text;
  v_code text;
  v_msg text;
begin
  if to_regclass('public.seuils_du_chiffre_d_affaires') is null then
    perform set_config('essai.hausse_du_ca', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration hausse_du_chiffre_d_affaires', 'ok', true,
      'observe', 'absente : l''essai se joue dès que la migration y est'))::text, true);
    return;
  end if;
  if en_cours_rang = 1 then
    clos_annee := en_cours_annee - 1;
    clos_rang := 4;
  else
    clos_annee := en_cours_annee;
    clos_rang := en_cours_rang - 1;
  end if;

  begin
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, statut_tva) values
      (dossier::uuid, 'ESSAI HAUSSE DU CHIFFRE D''AFFAIRES', cabinet, 'tresorerie', '455000', 'exonere');
    insert into memberships (id, user_id, dossier_id, role, email) values
      ('ca520000-0000-4000-8000-0000000000a1', client::uuid, dossier::uuid, 'client', 'essai-hausse-du-ca@example.test');

    for e in select * from (values
      (1, 'proprietaire', '0. le chef est du cabinet du dossier jetable ; le client y a un accès sans case ; l''inconnu, rien', $q$select (select count(*) from cabinet_admins where user_id = 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162'
  and cabinet_id = (select cabinet_id from dossiers where id = '{D}'))
  || '|' || (select count(*) from memberships where dossier_id = '{D}' and user_id = '797fe440-df8d-4b8e-828b-d148927bfd60'
    and not droit_ventes and not droit_banque and not droit_caisse)
  || '|' || (select count(*) from memberships where user_id = 'ca520000-0000-4000-8000-0000000000f1')
  || '|' || (select count(*) from cabinet_admins where user_id = 'ca520000-0000-4000-8000-0000000000f1')$q$, 'OK', '1|1|0|0'),
      (2, 'proprietaire', '1. le catalogue : les colonnes des seuils, les deux seuils seuls nullables', $q$select string_agg(a.attname || ':'
  || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' order by a.attnum)
  from pg_attribute a where a.attrelid = 'public.seuils_du_chiffre_d_affaires'::regclass and a.attnum > 0 and not a.attisdropped$q$,
        'OK', 'id:uuid:true,dossier_id:uuid:true,seuil_de_hausse:integer:false,seuil_de_baisse:integer:false,regle_par:uuid:true,regle_le:timestamp with time zone:true'),
      (3, 'proprietaire', '1b. … celles de la marque, aucune nullable', $q$select string_agg(a.attname || ':'
  || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' order by a.attnum)
  from pg_attribute a where a.attrelid = 'public.hausses_vues_avec_le_client'::regclass and a.attnum > 0 and not a.attisdropped$q$,
        'OK', 'id:uuid:true,dossier_id:uuid:true,annee:integer:true,trimestre:integer:true,vue_par:uuid:true,vue_le:timestamp with time zone:true'),
      (4, 'proprietaire', '1c. … leurs contraintes, au texte près (les clés, le dossier en cascade, les bornes de chaque seuil, les unicités TOTALES)', $q$select count(*) || ' ' || md5(string_agg(c.conrelid::regclass::text || ' ' || c.conname || ' ' || pg_get_constraintdef(c.oid), ' ; '
  order by c.conrelid::regclass::text collate "C", c.conname collate "C"))
  from pg_constraint c where c.conrelid in ('public.seuils_du_chiffre_d_affaires'::regclass, 'public.hausses_vues_avec_le_client'::regclass)$q$,
        'OK', '10 4425c9527e392ceec3c433f320a335a0'),
      (5, 'proprietaire', '1d. … la RLS active des deux, et leurs policies, toutes à authenticated (aucune mise à jour ni aucun retrait d''une marque)', $q$select (select string_agg(c.relrowsecurity::text, ',' order by c.relname) from pg_class c
  where c.oid in ('public.seuils_du_chiffre_d_affaires'::regclass, 'public.hausses_vues_avec_le_client'::regclass))
  || ' ' || string_agg(p.policyname || ':' || p.cmd || ':' || p.roles::text || ':' || coalesce(p.qual, '-') || ':' || coalesce(p.with_check, '-'),
    ' ; ' order by p.policyname)
  from pg_policies p where p.schemaname = 'public' and p.tablename in ('seuils_du_chiffre_d_affaires', 'hausses_vues_avec_le_client')
    and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')$q$,
        'OK', 'true,true hausses_vues_avec_le_client_insertion:INSERT:{authenticated}:-:admin_du_dossier(dossier_id) ; hausses_vues_avec_le_client_lecture:SELECT:{authenticated}:admin_du_dossier(dossier_id):- ; seuils_du_chiffre_d_affaires_cabinet:ALL:{authenticated}:admin_du_dossier(dossier_id):admin_du_dossier(dossier_id)'),
      (6, 'proprietaire', '1e. … les gardes, avant l''écriture, ligne par ligne (la marque aussi avant un retrait)', $q$select string_agg(t.tgrelid::regclass::text || ':' || t.tgname || ':' || t.tgtype || ':' || t.tgfoid::regprocedure::text, ',' order by t.tgname)
  from pg_trigger t where t.tgrelid in ('public.seuils_du_chiffre_d_affaires'::regclass, 'public.hausses_vues_avec_le_client'::regclass)
    and not t.tgisinternal and t.tgname <> '_acces_avant_les_gardes'$q$,
        'OK', 'hausses_vues_avec_le_client:hausses_vues_avec_le_client_garde:31:garder_hausse_vue_avec_le_client(),seuils_du_chiffre_d_affaires:seuils_du_chiffre_d_affaires_garde:23:garder_seuil_du_chiffre_d_affaires()'),
      (7, 'proprietaire', '1f. … les droits : les deux fonctions à authenticated seul, les gardes à personne, toutes aux droits de l''appelant', $q$select has_function_privilege('anon', 'public.regler_seuil_du_chiffre_d_affaires(uuid, text, integer, integer)', 'execute')
  || '|' || has_function_privilege('authenticated', 'public.regler_seuil_du_chiffre_d_affaires(uuid, text, integer, integer)', 'execute')
  || '|' || has_function_privilege('anon', 'public.marquer_hausse_vue_avec_le_client(uuid, integer, integer)', 'execute')
  || '|' || has_function_privilege('authenticated', 'public.marquer_hausse_vue_avec_le_client(uuid, integer, integer)', 'execute')
  || '|' || has_function_privilege('authenticated', 'public.garder_seuil_du_chiffre_d_affaires()', 'execute')
  || '|' || has_function_privilege('authenticated', 'public.garder_hausse_vue_avec_le_client()', 'execute')
  || '|' || (select string_agg(p.prosecdef::text, ',' order by p.proname) from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('regler_seuil_du_chiffre_d_affaires', 'marquer_hausse_vue_avec_le_client', 'garder_seuil_du_chiffre_d_affaires',
      'garder_hausse_vue_avec_le_client'))$q$, 'OK', 'false|true|false|true|false|false|false,false,false,false'),
      (8, 'chef', '2. le chef règle le seuil de hausse à 20 %, sur une lecture vide', $q$select regler_seuil_du_chiffre_d_affaires('{D}', 'hausse', null, 20)::text$q$, 'OK', '20'),
      (9, 'chef', '2b. … relu, à son nom, à l''instant de l''écriture ; la baisse reste nulle', $q$select seuil_de_hausse || '|' || coalesce(seuil_de_baisse::text, 'nul') || '|' || (regle_par = 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162') || '|' || (regle_le = now())
  from seuils_du_chiffre_d_affaires where dossier_id = '{D}'$q$, 'OK', '20|nul|true|true'),
      (10, 'chef', '3. un seuil de hausse changé depuis sa lecture refuse le tout', $q$select regler_seuil_du_chiffre_d_affaires('{D}', 'hausse', 15, 30)::text$q$,
        '40001', 'Le seuil de hausse a changé depuis sa lecture : relis-le avant de l''enregistrer.'),
      (11, 'chef', '3b. … un seuil de hausse de 0 %', $q$select regler_seuil_du_chiffre_d_affaires('{D}', 'hausse', 20, 0)::text$q$,
        '22023', 'Le seuil de hausse se règle en pour cent entier, de 1 à 1 000, ou se laisse vide.'),
      (12, 'chef', '3c. … de 1 001 %', $q$select regler_seuil_du_chiffre_d_affaires('{D}', 'hausse', 20, 1001)::text$q$,
        '22023', 'Le seuil de hausse se règle en pour cent entier, de 1 à 1 000, ou se laisse vide.'),
      (13, 'chef', '3d. … rien n''a changé ; puis 1 000 % s''écrit', $q$select (select seuil_de_hausse from seuils_du_chiffre_d_affaires where dossier_id = '{D}')
  || '|' || regler_seuil_du_chiffre_d_affaires('{D}', 'hausse', 20, 1000)$q$, 'OK', '20|1000'),
      (14, 'chef', '3e. le chef règle le seuil de baisse à 15 %, sur une lecture vide de la baisse', $q$select regler_seuil_du_chiffre_d_affaires('{D}', 'baisse', null, 15)::text$q$, 'OK', '15'),
      (15, 'chef', '3f. … relu : la hausse intacte, la baisse à 15 %, le dernier réglage à son nom et à l''instant', $q$select seuil_de_hausse || '|' || seuil_de_baisse || '|' || (regle_par = 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162') || '|' || (regle_le = now())
  from seuils_du_chiffre_d_affaires where dossier_id = '{D}'$q$, 'OK', '1000|15|true|true'),
      (16, 'chef', '3g. … un seuil de baisse de 0 %', $q$select regler_seuil_du_chiffre_d_affaires('{D}', 'baisse', 15, 0)::text$q$,
        '22023', 'Le seuil de baisse se règle en pour cent entier, de 1 à 100, ou se laisse vide.'),
      (17, 'chef', '3h. … de 101 %', $q$select regler_seuil_du_chiffre_d_affaires('{D}', 'baisse', 15, 101)::text$q$,
        '22023', 'Le seuil de baisse se règle en pour cent entier, de 1 à 100, ou se laisse vide.'),
      (18, 'chef', '3i. … un seuil de baisse changé depuis sa lecture refuse le tout', $q$select regler_seuil_du_chiffre_d_affaires('{D}', 'baisse', 20, 30)::text$q$,
        '40001', 'Le seuil de baisse a changé depuis sa lecture : relis-le avant de l''enregistrer.'),
      (19, 'chef', '3j. … la valeur lue de la hausse ne juge pas la baisse : 100 % s''écrit contre la baisse lue', $q$select regler_seuil_du_chiffre_d_affaires('{D}', 'baisse', 15, 100)::text$q$, 'OK', '100'),
      (20, 'chef', '3k. … un sens inconnu', $q$select regler_seuil_du_chiffre_d_affaires('{D}', 'stable', null, 10)::text$q$,
        '22023', 'Un seuil se dit d''une hausse ou d''une baisse.'),
      (21, 'chef', '3l. … un sens nul', $q$select regler_seuil_du_chiffre_d_affaires('{D}', null, null, 10)::text$q$,
        '22023', 'Un seuil se dit d''une hausse ou d''une baisse.'),
      (22, 'chef', '3m. la hausse vidée, nulle : plus d''alerte de hausse', $q$select coalesce(regler_seuil_du_chiffre_d_affaires('{D}', 'hausse', 1000, null)::text, 'nul')$q$, 'OK', 'nul'),
      (23, 'chef', '3n. … relue nulle, la baisse restée à 100 %', $q$select coalesce((select seuil_de_hausse::text from seuils_du_chiffre_d_affaires where dossier_id = '{D}'), 'nul')
  || '|' || (select seuil_de_baisse from seuils_du_chiffre_d_affaires where dossier_id = '{D}')$q$, 'OK', 'nul|100'),
      (24, 'chef', '4. une seconde ligne pour le dossier, en direct', $q$insert into seuils_du_chiffre_d_affaires (dossier_id, seuil_de_hausse, regle_par) values ('{D}', 10, 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162')$q$,
        '23505', '%seuils_du_chiffre_d_affaires_un_par_dossier%'),
      (25, 'chef_simple', '4b. … en direct, par un chef qui n''est pas super-administrateur : l''auteur et l''instant sont ceux de l''écriture', $q$with u as (update seuils_du_chiffre_d_affaires set seuil_de_hausse = 25,
  regle_par = 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162', regle_le = '2020-01-01' where dossier_id = '{D}' returning seuil_de_hausse, regle_par, regle_le)
  select seuil_de_hausse || '|' || (regle_par = '797fe440-df8d-4b8e-828b-d148927bfd60') || '|' || (regle_le = now()) from u$q$, 'OK', '25|true|true'),
      (26, 'chef', '4b2. … le super-administrateur, la porte de la restauration, garde ce qu''il écrit', $q$with u as (update seuils_du_chiffre_d_affaires set seuil_de_hausse = 25,
  regle_par = '797fe440-df8d-4b8e-828b-d148927bfd60', regle_le = '2020-01-01' where dossier_id = '{D}' returning seuil_de_hausse, regle_par, regle_le)
  select seuil_de_hausse || '|' || (regle_par = '797fe440-df8d-4b8e-828b-d148927bfd60') || '|' || (regle_le = '2020-01-01') from u$q$, 'OK', '25|true|true'),
      (27, 'chef', '4c. … ni le passage à un autre dossier du cabinet', $q$update seuils_du_chiffre_d_affaires set dossier_id = '001c7ed7-c23b-4590-901e-693489f8af24' where dossier_id = '{D}'$q$,
        '23514', 'Les seuils d''un dossier ne passent pas à un autre dossier.'),
      (28, 'chef', '4d. … ni un seuil de hausse hors bornes, en direct', $q$update seuils_du_chiffre_d_affaires set seuil_de_hausse = 0 where dossier_id = '{D}'$q$,
        '23514', '%seuils_du_chiffre_d_affaires_bornes_de_hausse%'),
      (29, 'chef', '4e. … ni un seuil de baisse hors bornes, en direct', $q$update seuils_du_chiffre_d_affaires set seuil_de_baisse = 101 where dossier_id = '{D}'$q$,
        '23514', '%seuils_du_chiffre_d_affaires_bornes_de_baisse%'),
      (30, 'client', '5. le client d''essai, avec un accès au dossier, ne règle aucun seuil', $q$select regler_seuil_du_chiffre_d_affaires('{D}', 'baisse', 100, 30)::text$q$,
        '42501', 'Les seuils de l''alerte du chiffre d''affaires ne se règlent que par le cabinet du dossier.'),
      (31, 'client', '5b. … ne les lit pas', $q$select count(*) from seuils_du_chiffre_d_affaires where dossier_id = '{D}'$q$, 'OK', '0'),
      (32, 'client', '5c. … ne les réécrit pas en direct', $q$with u as (update seuils_du_chiffre_d_affaires set seuil_de_baisse = 1 where dossier_id = '{D}' returning 1) select count(*) from u$q$, 'OK', '0'),
      (33, 'client', '5d. … n''en insère pas', $q$insert into seuils_du_chiffre_d_affaires (dossier_id, seuil_de_baisse, regle_par) values ('ca520000-0000-4000-8000-0000000000d1', 1, '797fe440-df8d-4b8e-828b-d148927bfd60')$q$,
        '42501', '%row-level security%'),
      (34, 'inconnu', '6. un compte qu''aucun accès ne nomme ne règle rien, ne lit rien', $q$select (select count(*) from seuils_du_chiffre_d_affaires) || '|' || coalesce(regler_seuil_du_chiffre_d_affaires('{D}', 'hausse', 25, 30)::text, '?')$q$,
        '42501', 'Les seuils de l''alerte du chiffre d''affaires ne se règlent que par le cabinet du dossier.'),
      (35, 'anon', '6b. l''anonyme n''exécute pas la fonction', $q$select regler_seuil_du_chiffre_d_affaires('{D}', 'hausse', null, 20)::text$q$, '42501', '%permission denied%'),
      (36, 'chef', '7. le chef marque vu avec le client le dernier trimestre clos', $q$select (marquer_hausse_vue_avec_le_client('{D}', {CA}, {CT}) = now())::text$q$, 'OK', 'true'),
      (37, 'chef', '7b. … relue, à son nom', $q$select count(*) from hausses_vues_avec_le_client where dossier_id = '{D}' and annee = {CA} and trimestre = {CT}
  and vue_par = 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162'$q$, 'OK', '1'),
      (38, 'chef', '7c. … une seconde fois, refusé sous ses mots', $q$select marquer_hausse_vue_avec_le_client('{D}', {CA}, {CT})::text$q$,
        '22023', 'Ce trimestre est déjà marqué vu avec le client.'),
      (39, 'chef', '7d. … le trimestre en cours, pas encore clos', $q$select marquer_hausse_vue_avec_le_client('{D}', {NA}, {NT})::text$q$,
        '22023', 'Un trimestre ne se marque vu avec le client qu''une fois clos.'),
      (40, 'chef', '7e. … un rang hors de 1 à 4', $q$select marquer_hausse_vue_avec_le_client('{D}', {CA}, 5)::text$q$,
        '22023', 'Le trimestre se dit par son année et son rang, de 1 à 4.'),
      (41, 'chef_simple', '7f. en direct, par un chef qui n''est pas super-administrateur : l''auteur et l''instant sont ceux de l''écriture', $q$with i as (insert into hausses_vues_avec_le_client (dossier_id, annee, trimestre, vue_par, vue_le)
  values ('{D}', {CA} - 1, 4, 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162', '2020-01-01') returning vue_par, vue_le)
  select (vue_par = '797fe440-df8d-4b8e-828b-d148927bfd60') || '|' || (vue_le = now()) from i$q$, 'OK', 'true|true'),
      (42, 'chef', '7f2. … le super-administrateur, la porte de la restauration, garde l''auteur et l''instant qu''il écrit', $q$with i as (insert into hausses_vues_avec_le_client (dossier_id, annee, trimestre, vue_par, vue_le)
  values ('{D}', {CA} - 1, 3, '797fe440-df8d-4b8e-828b-d148927bfd60', '2021-03-01') returning vue_par, vue_le)
  select (vue_par = '797fe440-df8d-4b8e-828b-d148927bfd60') || '|' || (vue_le = '2021-03-01') from i$q$, 'OK', 'true|true'),
      (43, 'chef', '7g. … et le trimestre en cours se refuse aussi en direct', $q$insert into hausses_vues_avec_le_client (dossier_id, annee, trimestre, vue_par) values ('{D}', {NA}, {NT}, 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162')$q$,
        '22023', 'Un trimestre ne se marque vu avec le client qu''une fois clos.'),
      (44, 'chef', '8. le chef ne réécrit pas une marque (aucune policy de mise à jour : aucune ligne)', $q$with u as (update hausses_vues_avec_le_client set trimestre = 1 where dossier_id = '{D}' returning 1) select count(*) from u$q$, 'OK', '0'),
      (45, 'proprietaire', '8b. … ni le propriétaire, que la garde refuse', $q$update hausses_vues_avec_le_client set vue_le = now() where dossier_id = '{D}' and annee = {CA} and trimestre = {CT}$q$,
        '23514', 'Une alerte vue avec le client ne se modifie pas.'),
      (46, 'client', '9. le client d''essai ne marque rien', $q$select marquer_hausse_vue_avec_le_client('{D}', {CA}, {CT})::text$q$,
        '42501', 'L''alerte du chiffre d''affaires ne se marque vue avec le client que par le cabinet du dossier.'),
      (47, 'client', '9b. … ne lit aucune marque', $q$select count(*) from hausses_vues_avec_le_client where dossier_id = '{D}'$q$, 'OK', '0'),
      (48, 'client', '9c. … n''en insère pas en direct', $q$insert into hausses_vues_avec_le_client (dossier_id, annee, trimestre, vue_par) values ('ca520000-0000-4000-8000-0000000000d1', 2001, 1, '797fe440-df8d-4b8e-828b-d148927bfd60')$q$,
        '42501', '%row-level security%'),
      (49, 'inconnu', '9d. un compte qu''aucun accès ne nomme ne lit ni ne marque rien', $q$select (select count(*) from hausses_vues_avec_le_client) || '|' || coalesce(marquer_hausse_vue_avec_le_client('{D}', {CA}, {CT})::text, '?')$q$,
        '42501', 'L''alerte du chiffre d''affaires ne se marque vue avec le client que par le cabinet du dossier.'),
      (50, 'anon', '9e. l''anonyme n''exécute pas la fonction', $q$select marquer_hausse_vue_avec_le_client('{D}', {CA}, {CT})::text$q$, '42501', '%permission denied%'),
      (51, 'chef', '10. ce qui est resté du jeu : la hausse de 25 % et la baisse de 100 %, le dernier réglage du super-administrateur, ses deux marques (celles du chef simple annulées avec leur étape)', $q$select (select seuil_de_hausse || '|' || seuil_de_baisse || '|' || (regle_par = '797fe440-df8d-4b8e-828b-d148927bfd60') from seuils_du_chiffre_d_affaires where dossier_id = '{D}')
  || '|' || (select count(*) from hausses_vues_avec_le_client where dossier_id = '{D}')
  || '|' || (select count(*) from cabinet_admins where user_id = '797fe440-df8d-4b8e-828b-d148927bfd60')$q$, 'OK', '25|100|true|2|0')
    ) as t(rang, profil, etape, requete, code, attendu) order by rang loop
      v_obs := null;
      v_code := 'OK';
      v_msg := '';
      v_req := replace(replace(replace(replace(replace(e.requete, '{D}', dossier), '{CA}', clos_annee::text), '{CT}', clos_rang::text),
        '{NA}', en_cours_annee::text), '{NT}', en_cours_rang::text);
      begin
        if e.profil = 'chef_simple' then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client::uuid, cabinet, 'comptable_en_chef');
        end if;
        if e.profil = 'anon' then
          execute 'set local role anon';
          perform set_config('request.jwt.claims', '{"role":"anon"}', true);
        elsif e.profil <> 'proprietaire' then
          execute 'set local role authenticated';
          perform set_config('request.jwt.claims', json_build_object('sub',
            case e.profil when 'chef' then chef when 'inconnu' then inconnu else client end, 'role', 'authenticated')::text, true);
        end if;
        execute v_req into v_obs;
        set constraints all immediate;
        set constraints all deferred;
        reset role;
        v_msg := coalesce(v_obs, '');
        -- Le chef simple ne dure que son étape : ce qu'elle a posé s'annule, son observation reste.
        if e.profil = 'chef_simple' then
          raise exception 'ANNULATION_ETAPE' using detail = v_msg;
        end if;
      exception when others then
        reset role;
        if sqlerrm = 'ANNULATION_ETAPE' then
          get stacked diagnostics v_msg = pg_exception_detail;
        else
          v_code := sqlstate;
          v_msg := sqlerrm;
        end if;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      verdicts := verdicts || jsonb_build_object('rang', e.rang, 'etape', e.etape,
        'ok', v_code = e.code and (e.attendu = '' or v_msg like e.attendu), 'observe', v_code || ' ' || v_msg);
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;
  -- Rien n'est resté du jeu : le dossier jetable, son accès, ses seuils et ses marques sont partis avec l'annulation.
  verdicts := verdicts || jsonb_build_object('rang', 52, 'etape', '11. rien n''est resté du jeu',
    'ok', not exists (select 1 from dossiers where id = dossier::uuid)
      and not exists (select 1 from seuils_du_chiffre_d_affaires where dossier_id = dossier::uuid)
      and not exists (select 1 from hausses_vues_avec_le_client where dossier_id = dossier::uuid),
    'observe', 'relu après l''annulation');
  perform set_config('essai.hausse_du_ca', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.hausse_du_ca')::jsonb) as v(rang numeric, etape text, ok boolean, observe text)
order by v.rang;
