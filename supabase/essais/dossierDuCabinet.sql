-- LE DOSSIER DU CABINET (ligne 47, lot LM1 ; la migration `dossier_du_cabinet`, PRÉPARÉE le 11/11/2026,
-- supabase/preparees/20261111150000_dossier_du_cabinet.sql). Le récit : HISTORIQUE.md, « 11/11/2026 — LM1 ».
-- SUR UNE RÉPLIQUE SEULEMENT : il supprime un dossier jetable (le geste du super-administrateur qui retire un cabinet),
-- ce que l'outil d'exécution de la production retient. À rejouer, par psql (`-f`, pas `-1` : le fichier ouvre et ANNULE
-- sa propre transaction), après toute migration qui touche `cabinets`, `memberships`, la suppression d'un dossier,
-- `enregistrer_facture`, `numerotation_suivante`, la garde de la numérotation ou les fonctions de la migration.
--
-- Ce qui se prouve ici : qui désigne le dossier du cabinet (le chef seul, le super-administrateur compris — ni
-- l'anonyme, ni un compte sans accès, ni le client, ni un membre de l'équipe affecté au dossier), et que la colonne ne
-- s'écrit pas autrement, même par le chef ; les refus de la désignation, leurs codes et leurs mots (un dossier d'un autre
-- cabinet, un dossier qui a un accès client, un dossier qui porte une facture validée au nom et pour le compte d'un
-- client, le changement ou le retrait après une facture validée) ; qu'elle se change et se retire tant qu'aucune facture
-- n'est validée ; qu'aucun accès client ne se pose sur le dossier du cabinet, ni ne s'y déplace, même sans session ;
-- qu'il ne change pas de cabinet ; qu'une facture validée sur ce dossier, par le chef ou par un membre affecté, ne fige aucun mandataire et prend la série
-- du dossier, quand la même validation sur un autre dossier fige le cabinet en mandataire, dans sa série (le contrôle
-- positif) ; que le dossier ne se supprime pas, même par son chef, et que le super-administrateur le retire, la
-- désignation suivant la ligne ; le catalogue (les droits d'exécution, `security definer`, le `search_path`, la clé
-- étrangère, son action et l'unicité).
--
-- Le jeu, inséré par le propriétaire : au cabinet de la réplique, quatre dossiers jetables (préfixe
-- `1a100000-0000-4000-8000`) — D et E, sans accès, D en franchise et son identité réglée ; M, où le cabinet a déjà
-- facturé en mandataire ; et un second cabinet avec son dossier F. Le chef « simple » est le compte du client d'essai,
-- rattaché au cabinet comme chef le temps de l'essai ; le membre de l'équipe de la réplique est affecté à D. Sans la
-- migration, une ligne dit qu'il attend (EN ATTENTE) et rien ne s'écrit. Une garde de tête refuse de le jouer hors d'une
-- réplique (ESSAI_HORS_REPLIQUE), avant toute écriture, comme `devisSuppression.sql`.
begin;
create temp table essai_dc (rang int, controle text, attendu text, observe text, ok boolean) on commit drop;

-- Joue `requete` sous le profil `qui` (un `sub`, 'anon' ou null : le propriétaire sans session) ; rend 'OK:<valeur>' ou
-- '<sqlstate>:<message>'. Temporaire : rien ne reste.
create function pg_temp.essayer(qui text, requete text) returns text language plpgsql as $f$
declare
  v text;
begin
  begin
    if qui = 'anon' then
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      execute 'set local role anon';
    elsif qui is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', qui, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
    end if;
    execute requete into v;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    return 'OK:' || coalesce(v, '∅');
  exception when others then
    return sqlstate || ':' || sqlerrm;
  end;
end
$f$;

do $essai$
declare
  cabinet constant uuid := 'cab10000-0000-4000-8000-000000000001';
  autre_cabinet constant uuid := '1a100000-0000-4000-8000-0000000000c2';
  d constant uuid := '1a100000-0000-4000-8000-0000000000d1';
  e constant uuid := '1a100000-0000-4000-8000-0000000000e1';
  m constant uuid := '1a100000-0000-4000-8000-0000000000a1';
  f constant uuid := '1a100000-0000-4000-8000-0000000000f1';
  acces_du_client constant uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  super constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  chef constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  membre constant text := '3e3b0000-0000-4000-8000-000000000001';
  inconnu constant text := gen_random_uuid()::text;
  facture constant text := $q$select (enregistrer_facture('%s', null, '{"tiers_nom":"Client LM1","type_client":"non_assujetti","nature_operation":"services","montant_ht":80,"montant_tva":0,"montant_ttc":80,"date_emission":"%s","mentions_legales":"TVA non applicable, art. 293 B du CGI.","emetteur_nom":"ESSAI LM1 SOCIÉTÉ","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI LM1 ADRESSE"}'::jsonb, '[{"designation":"Honoraires","quantite":1,"prix_unitaire_ht":80,"taux_tva":0}]'::jsonb, true)).numero$q$;
  r text;
  n int;
  rang int := 0;
  procedure_ok boolean;
begin
  -- La garde de tête : sur une réplique seulement, avant toute écriture (le rôle `proprietaire` manque à la production).
  if not exists (select 1 from pg_roles where rolname = 'proprietaire') then
    raise exception 'ESSAI_HORS_REPLIQUE : cet essai supprime un dossier et ne se joue que sur une réplique ; le rôle proprietaire, que toute réplique porte, est absent : rien n''est écrit.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'cabinets' and column_name = 'dossier_du_cabinet') then
    insert into essai_dc values (0, 'DC. le dossier du cabinet : EN ATTENTE de la migration dossier_du_cabinet', 'la migration', 'absente', true);
    return;
  end if;

  -- Le jeu.
  insert into cabinets (id, nom) values (autre_cabinet, 'ESSAI LM1 AUTRE CABINET');
  insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, statut_tva, siret, adresse,
                        forme_juridique, denomination_imprimee) values
    (d, 'ESSAI LM1 D', cabinet, 'tresorerie', '455000', 'franchise', '12345678200010', 'ESSAI LM1 ADRESSE', '5710', 'ESSAI LM1 SOCIÉTÉ'),
    (e, 'ESSAI LM1 E', cabinet, 'tresorerie', '455000', null, null, null, null, null),
    (m, 'ESSAI LM1 M', cabinet, 'tresorerie', '455000', 'franchise', '12345678200010', 'ESSAI LM1 ADRESSE', '5710', 'ESSAI LM1 SOCIÉTÉ'),
    (f, 'ESSAI LM1 F', autre_cabinet, 'tresorerie', '455000', null, null, null, null, null);
  insert into cabinet_admins (user_id, cabinet_id, role) values (chef::uuid, cabinet, 'comptable_en_chef');
  insert into dossier_assignations (dossier_id, user_id) values (d, membre::uuid);

  -- 1 à 5 : qui désigne.
  r := pg_temp.essayer('anon', format('select designer_dossier_du_cabinet(%L, %L)::text', cabinet, d));
  insert into essai_dc values (1, 'l''anonyme n''exécute pas la désignation', '42501', r, r like '42501:%');
  r := pg_temp.essayer(inconnu, format('select designer_dossier_du_cabinet(%L, %L)::text', cabinet, d));
  insert into essai_dc values (2, 'un compte sans accès est refusé', '42501 Accès refusé à ce cabinet.', r, r = '42501:Accès refusé à ce cabinet.');
  r := pg_temp.essayer(membre, format('select designer_dossier_du_cabinet(%L, %L)::text', cabinet, d));
  insert into essai_dc values (3, 'un membre de l''équipe affecté au dossier est refusé', '42501', r, r = '42501:Accès refusé à ce cabinet.');
  r := pg_temp.essayer(super, format('update cabinets set dossier_du_cabinet = %L where id = %L returning 1', d, cabinet));
  insert into essai_dc values (4, 'la colonne ne s''écrit pas directement, même par le chef', '42501 se désigne par la fonction seule', r,
    r = '42501:Le dossier du cabinet se désigne par designer_dossier_du_cabinet seule.');
  r := pg_temp.essayer(null, format('update cabinets set dossier_du_cabinet = %L where id = %L returning 1', d, cabinet));
  insert into essai_dc values (5, 'ni par le propriétaire sans session', '42501', r, r like '42501:%');

  -- 6 à 9 : les refus de la désignation.
  r := pg_temp.essayer(super, format('select designer_dossier_du_cabinet(%L, %L)::text', cabinet, f));
  insert into essai_dc values (6, 'un dossier d''un autre cabinet ne se désigne pas', 'P0002', r,
    r = 'P0002:Ce dossier n''est pas un dossier de ce cabinet.');
  r := pg_temp.essayer(super, format('select designer_dossier_du_cabinet(%L, %L)::text', cabinet, acces_du_client));
  insert into essai_dc values (7, 'un dossier qui a un accès client ne se désigne pas', '23514', r,
    r = '23514:Ce dossier a un accès client : le dossier du cabinet n''en a aucun, ses honoraires y seraient lus. Retirer d''abord ses accès.');
  r := pg_temp.essayer(super, format(facture, m, '2026-07-10'));
  select f2.mandataire_nom into r from factures_emises f2 where f2.dossier_id = m and f2.statut = 'validee';
  insert into essai_dc values (8, 'sur un dossier qui n''est pas le sien, le cabinet facture en mandataire (contrôle positif)',
    'le nom du cabinet en mandataire, la série M', coalesce(r, '∅') || ' / ' || coalesce((select f2.numero from factures_emises f2 where f2.dossier_id = m and f2.statut = 'validee'), '∅'),
    r = (select c.nom from cabinets c where c.id = cabinet)
      and (select f2.numero from factures_emises f2 where f2.dossier_id = m and f2.statut = 'validee') like 'M%');
  r := pg_temp.essayer(super, format('select designer_dossier_du_cabinet(%L, %L)::text', cabinet, m));
  insert into essai_dc values (9, 'un dossier facturé au nom et pour le compte d''un client ne se désigne pas', '23514', r,
    r = '23514:Ce dossier porte une facture validée au nom et pour le compte d''un client : il ne devient pas le dossier du cabinet.');

  -- 10 à 13 : la désignation se pose, se change et se retire tant qu'aucune facture n'est validée.
  r := pg_temp.essayer(chef, format('select designer_dossier_du_cabinet(%L, %L)::text', cabinet, e));
  insert into essai_dc values (10, 'le chef (qui n''est pas super-administrateur) désigne E', 'OK:E', r,
    r = 'OK:' || e and (select c.dossier_du_cabinet from cabinets c where c.id = cabinet) = e);
  r := pg_temp.essayer(chef, format('select designer_dossier_du_cabinet(%L, %L)::text', cabinet, d));
  insert into essai_dc values (11, 'il la change pour D, E n''ayant aucune facture validée', 'OK:D', r,
    r = 'OK:' || d and (select c.dossier_du_cabinet from cabinets c where c.id = cabinet) = d);
  r := pg_temp.essayer(chef, format('select coalesce(designer_dossier_du_cabinet(%L, null)::text, %L)', cabinet, 'nulle'));
  insert into essai_dc values (12, 'il la retire', 'OK:nulle', r,
    r = 'OK:nulle' and (select c.dossier_du_cabinet from cabinets c where c.id = cabinet) is null);
  r := pg_temp.essayer(chef, format('select designer_dossier_du_cabinet(%L, %L)::text', cabinet, d)) || ' | '
    || pg_temp.essayer(chef, format('select designer_dossier_du_cabinet(%L, %L)::text', cabinet, d));
  insert into essai_dc values (13, 'il redésigne D, et redésigner D ne change rien', 'OK:D | OK:D', r,
    r = 'OK:' || d || ' | OK:' || d);

  -- 14 à 16 : aucun accès client sur le dossier du cabinet.
  r := pg_temp.essayer(super, format($q$insert into memberships (user_id, dossier_id, role, email) values (%L, %L, 'client', 'essai-lm1@example.test') returning 1$q$, chef, d));
  insert into essai_dc values (14, 'le chef ne pose pas un accès client sur le dossier du cabinet', '23514', r,
    r = '23514:Le dossier du cabinet ne reçoit aucun accès client : il porte les honoraires de tous les clients du cabinet.');
  r := pg_temp.essayer(null, format($q$insert into memberships (user_id, dossier_id, role, email) values (%L, %L, 'client', 'essai-lm1@example.test') returning 1$q$, chef, d));
  insert into essai_dc values (15, 'ni le propriétaire sans session (la restauration comprise)', '23514', r, r like '23514:Le dossier du cabinet ne reçoit aucun accès client%');
  r := pg_temp.essayer(null, format('update memberships set dossier_id = %L where dossier_id = %L returning 1', d, acces_du_client));
  insert into essai_dc values (16, 'un accès ne s''y déplace pas', '23514', r, r like '23514:Le dossier du cabinet ne reçoit aucun accès client%');

  -- 17 et 18 : sur le dossier du cabinet, aucun mandataire, la série du dossier.
  r := pg_temp.essayer(membre, format(facture, d, '2026-07-20'));
  insert into essai_dc values (17, 'un membre affecté valide une facture d''honoraires : aucun mandataire, pas la série M',
    'OK, mandataire nul, numéro hors de M', r || ' / ' || coalesce((select string_agg(coalesce(f2.mandataire_nom, '∅'), ',') from factures_emises f2 where f2.dossier_id = d), '∅'),
    r like 'OK:%' and r not like 'OK:M%'
      and (select count(*) from factures_emises f2 where f2.dossier_id = d and f2.statut = 'validee' and f2.mandataire_nom is null) = 1);
  r := pg_temp.essayer(super, format(facture, d, '2026-07-21'));
  insert into essai_dc values (18, 'le chef super-administrateur aussi, dans la même série', 'OK, deux factures sans mandataire',
    r, r like 'OK:%' and r not like 'OK:M%'
      and (select count(*) from factures_emises f2 where f2.dossier_id = d and f2.statut = 'validee' and f2.mandataire_nom is null) = 2);

  -- 19 et 20 : irréversible dès une facture validée.
  r := pg_temp.essayer(chef, format('select designer_dossier_du_cabinet(%L, %L)::text', cabinet, e));
  insert into essai_dc values (19, 'la désignation ne passe plus à un autre dossier', '23514', r,
    r = '23514:Le dossier du cabinet porte déjà une facture validée : sa désignation ne change plus.');
  r := pg_temp.essayer(super, format('select designer_dossier_du_cabinet(%L, null)::text', cabinet));
  insert into essai_dc values (20, 'ni ne se retire, même par le super-administrateur', '23514', r,
    r = '23514:Le dossier du cabinet porte déjà une facture validée : sa désignation ne change plus.');

  -- 20bis : le dossier du cabinet ne change pas de cabinet, même par le propriétaire.
  r := pg_temp.essayer(null, format('update dossiers set cabinet_id = %L where id = %L returning 1', autre_cabinet, d));
  insert into essai_dc values (20, 'le dossier du cabinet ne change pas de cabinet', '23514', r,
    r = '23514:Le dossier du cabinet ne change pas de cabinet.');

  -- 21 et 22 : la suppression.
  r := pg_temp.essayer(chef, format('delete from dossiers where id = %L returning 1', d));
  insert into essai_dc values (21, 'son chef ne supprime pas le dossier du cabinet', '23514', r,
    r = '23514:Le dossier du cabinet ne se supprime pas : il porte les factures du cabinet. Seul le super-administrateur le retire, avec le cabinet.');
  r := pg_temp.essayer(chef, format('delete from dossiers where id = %L returning 1', e));
  insert into essai_dc values (21, 'il supprime un autre dossier du cabinet (contrôle positif)', 'OK:1', r, r = 'OK:1');
  r := pg_temp.essayer(super, format('delete from dossiers where id = %L returning 1', d));
  insert into essai_dc values (22, 'le super-administrateur le retire, la désignation suit la ligne', 'OK:1, désignation nulle', r,
    r = 'OK:1' and (select c.dossier_du_cabinet from cabinets c where c.id = cabinet) is null
      and not exists (select 1 from dossiers where id = d));

  -- 23 : le catalogue.
  select count(*) into n from pg_proc p
   where p.oid = 'public.designer_dossier_du_cabinet(uuid, uuid)'::regprocedure and p.prosecdef
     and p.proconfig = array['search_path=public']
     and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute');
  insert into essai_dc values (23, 'designer_dossier_du_cabinet : security definer, search_path, authenticated seul', '1', n::text, n = 1);
  select count(*) into n from pg_proc p
   where p.proname in ('est_dossier_du_cabinet', 'garder_dossier_du_cabinet', 'garder_acces_au_dossier_du_cabinet',
                       'garder_suppression_du_dossier_du_cabinet', 'garder_cabinet_du_dossier_du_cabinet')
     and p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proconfig = array['search_path=public']
     and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute');
  insert into essai_dc values (23, 'la lecture et les quatre gardes : security definer, search_path, aucun rôle de session', '5', n::text, n = 5);
  select count(*) into n from pg_constraint c
   where c.conrelid = 'public.cabinets'::regclass and c.conname = 'cabinets_dossier_du_cabinet_fkey'
     and pg_get_constraintdef(c.oid) = 'FOREIGN KEY (dossier_du_cabinet) REFERENCES dossiers(id) ON DELETE SET NULL';
  select n + count(*) into n from pg_constraint c
   where c.conrelid = 'public.cabinets'::regclass and c.conname = 'cabinets_dossier_du_cabinet_key'
     and pg_get_constraintdef(c.oid) = 'UNIQUE (dossier_du_cabinet)';
  insert into essai_dc values (23, 'la clé étrangère, la désignation suivant la ligne, et l''unicité', '2', n::text, n = 2);
end
$essai$;

select case when ok then 'OK  ' else 'FAUX' end || ' ' || lpad(rang::text, 2) || '. ' || controle
       || case when ok then '' else ' — attendu : ' || attendu || ' ; observé : ' || observe end as verdict
  from essai_dc order by rang, controle;
select count(*) filter (where not ok) || ' en faute / ' || count(*) || ' étapes' as bilan from essai_dc;
rollback;
