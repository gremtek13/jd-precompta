-- LE DÉPART D'UN CLIENT (ligne 44, lot INAL5 ; la migration `depart_du_client`, PRÉPARÉE le 11/11/2026,
-- supabase/preparees/20261111191000_depart_du_client.sql). Le récit : HISTORIQUE.md, « 11/11/2026 — INAL5 ».
-- SUR UNE RÉPLIQUE SEULEMENT : il supprime des dossiers jetables, ce que l'outil d'exécution de la production retient. À
-- rejouer par psql (`-f`, pas `-1` : le fichier ouvre et ANNULE sa propre transaction), après toute migration qui touche
-- la suppression d'un dossier, `exercices_valides`, `pieces`, `ecritures_brouillon`, `memberships` ou les fonctions de la
-- migration.
--
-- Ce qui se prouve ici. LE PAQUET TÉLÉCHARGÉ : `enregistrer_paquet_telecharge` refusée à l'anonyme, à un compte rattaché à
-- rien et au client ; acceptée à un membre de l'équipe affecté au dossier (le contrôle POSITIF) ; ses refus à leurs codes
-- et à leurs mots (une empreinte qui n'est pas celle de l'exercice validé, un exercice non validé, un manifeste ou des
-- comptes illisibles, un exercice dont l'empreinte ne se vérifie plus) ; ni l'insertion directe hors du
-- super-administrateur, ni la mise à jour, ni la suppression ; le client ne lit rien. LA CONSERVATION : posée et levée par
-- le chef seul ; refusée sur un dossier qui a un accès client, sans exercice validé, ou déjà conservé ; son terme, le 31
-- décembre de la dixième année qui suit le dernier exercice validé ; dans un dossier conservé, aucune pièce, écriture,
-- accès ni validation, le super-administrateur compris ; une conservation ne se réécrit pas, et ne cohabite pas avec un
-- accès client. LA SUPPRESSION : refusée par un chef qui n'est pas super-administrateur tant qu'une conservation court,
-- puis tant qu'un paquet manque à l'empreinte de son exercice ; acceptée paquets téléchargés, conservation échue,
-- exercice dont la conservation est close, et par le super-administrateur. Le catalogue : les fonctions, leurs droits,
-- les policies — hors la restrictive `deux_facteurs` de la double authentification exigée, jugée à part : sur les deux
-- tables si celle-ci est en base, sur aucune sinon. Quatre mutations, qui doivent mordre. Sans la migration, une ligne dit
-- qu'il attend (EN ATTENTE).
begin;
create temp table essai_dp (rang int, controle text, attendu text, observe text, ok boolean) on commit drop;
create temp table mutation_dp (mutation text, attendu text, observe text, mord boolean) on commit drop;

-- Joue `requete` sous le profil `qui` (un `sub`, 'anon' ou null : le propriétaire sans session) ; rend 'OK:<valeur>' ou
-- '<sqlstate>:<message>'.
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
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    return sqlstate || ':' || sqlerrm;
  end;
end
$f$;

do $essai$
declare
  cabinet constant uuid := 'cab10000-0000-4000-8000-000000000001';
  d1 constant uuid := '1a500000-0000-4000-8000-0000000000d1';
  d2 constant uuid := '1a500000-0000-4000-8000-0000000000d2';
  d3 constant uuid := '1a500000-0000-4000-8000-0000000000d3';
  d4 constant uuid := '1a500000-0000-4000-8000-0000000000d4';
  d5 constant uuid := '1a500000-0000-4000-8000-0000000000d5';
  d6 constant uuid := '1a500000-0000-4000-8000-0000000000d6';
  d7 constant uuid := '1a500000-0000-4000-8000-0000000000d7';
  d8 constant uuid := '1a500000-0000-4000-8000-0000000000d8';
  super constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  chef constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  membre constant text := '3e3b0000-0000-4000-8000-000000000001';
  inconnu constant text := gen_random_uuid()::text;
  manifeste constant text := repeat('c', 64);
  e2025 text; e2026 text; e_d2 text; e_d4 text;
  r text;
  n bigint;
  enregistrer constant text := $q$select enregistrer_paquet_telecharge('%s', %s, '%s', '%s', %s, %s)::text$q$;
  piece constant text := $q$insert into pieces (dossier_id, storage_path, nom_fichier) values ('%s', '%s/essai.pdf', 'essai.pdf') returning id::text$q$;
  ecriture constant text := $q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens) values ('%s', '2027-01-15', '606000', 'ESSAI', 1, 'debit') returning id::text$q$;
begin
  if not exists (select 1 from pg_roles where rolname = 'proprietaire') then
    raise exception 'ESSAI_HORS_REPLIQUE : cet essai supprime des dossiers et ne se joue que sur une réplique ; le rôle proprietaire, que toute réplique porte, est absent : rien n''est écrit.';
  end if;
  if to_regclass('public.conservations_des_dossiers') is null then
    insert into essai_dp values (0, 'DP. le départ d''un client : EN ATTENTE de la migration depart_du_client', 'la migration', 'absente', true);
    return;
  end if;

  -- Le jeu : sept dossiers jetables du cabinet. d1 : 2025 et 2026 validés, le membre affecté ; d2 : 2025 validé et un
  -- accès client ; d3 : aucun exercice validé ; d4 : 2014 seul (sa conservation close le 31/12/2024) ; d5 : 2025 validé
  -- sous une empreinte qui ne se vérifie pas ; d6 : 2014 validé et une conservation échue ; d7 : 2025 validé, conservé.
  insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values
    (d1, 'ESSAI INAL5 D1', cabinet, 'tresorerie', '455000'), (d2, 'ESSAI INAL5 D2', cabinet, 'tresorerie', '455000'),
    (d3, 'ESSAI INAL5 D3', cabinet, 'tresorerie', '455000'), (d4, 'ESSAI INAL5 D4', cabinet, 'tresorerie', '455000'),
    (d5, 'ESSAI INAL5 D5', cabinet, 'tresorerie', '455000'), (d6, 'ESSAI INAL5 D6', cabinet, 'tresorerie', '455000'),
    (d7, 'ESSAI INAL5 D7', cabinet, 'tresorerie', '455000');
  e2025 := public.empreinte_exercice(d1, 2025, null);
  e2026 := public.empreinte_exercice(d1, 2026, e2025);
  e_d2 := public.empreinte_exercice(d2, 2025, null);
  e_d4 := public.empreinte_exercice(d4, 2014, null);
  insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit,
    total_credit, empreinte_precedente, empreinte, declaration) values
    (d1, 2025, now(), super::uuid, 'tresorerie', 0, 0, 0, 0, null, e2025, '{}'),
    (d1, 2026, now(), super::uuid, 'tresorerie', 0, 0, 0, 0, e2025, e2026, '{}'),
    (d2, 2025, now(), super::uuid, 'tresorerie', 0, 0, 0, 0, null, e_d2, '{}'),
    (d4, 2014, now(), super::uuid, 'tresorerie', 0, 0, 0, 0, null, e_d4, '{}'),
    (d5, 2025, now(), super::uuid, 'tresorerie', 0, 0, 0, 0, null, repeat('a', 64), '{}'),
    (d6, 2014, now(), super::uuid, 'tresorerie', 0, 0, 0, 0, null, public.empreinte_exercice(d6, 2014, null), '{}'),
    (d7, 2025, now(), super::uuid, 'tresorerie', 0, 0, 0, 0, null, public.empreinte_exercice(d7, 2025, null), '{}');
  insert into dossier_assignations (dossier_id, user_id) values (d1, membre::uuid);
  insert into memberships (user_id, dossier_id, role) values (chef::uuid, d2, 'client');
  insert into conservations_des_dossiers (dossier_id, dernier_exercice, jusqu_au, posee_le, posee_par) values
    (d6, 2014, '2024-12-31', now() - interval '3 years', super::uuid), (d7, 2025, '2035-12-31', now(), super::uuid);
  insert into essai_dp values (0, 'le jeu : sept dossiers jetables, six exercices validés, un accès client, deux conservations', '7',
    (select count(*) from dossiers where nom like 'ESSAI INAL5 %')::text, (select count(*) from dossiers where nom like 'ESSAI INAL5 %') = 7);

  -- 1. Le paquet téléchargé : qui l'enregistre.
  r := pg_temp.essayer('anon', format(enregistrer, d1, 2025, e2025, manifeste, 5, 0));
  insert into essai_dp values (1, 'l''anonyme n''enregistre pas de paquet', '42501', r, r like '42501:%');
  r := pg_temp.essayer(inconnu, format(enregistrer, d1, 2025, e2025, manifeste, 5, 0));
  insert into essai_dp values (1, 'un compte rattaché à rien n''enregistre pas de paquet', '42501:Accès refusé à ce dossier.', r, r = '42501:Accès refusé à ce dossier.');
  -- Le client de d2 (cet utilisateur ne devient chef du cabinet qu'au contrôle 6).
  r := pg_temp.essayer(chef, format(enregistrer, d2, 2025, e_d2, manifeste, 5, 0));
  insert into essai_dp values (1, 'le client n''enregistre pas le paquet de son dossier', '42501:Accès refusé à ce dossier.', r, r = '42501:Accès refusé à ce dossier.');
  r := pg_temp.essayer(membre, format(enregistrer, d1, 2025, e2025, manifeste, 5, 1));
  insert into essai_dp values (2, 'un membre affecté au dossier enregistre le paquet de 2025 (contrôle positif)', 'OK', r,
    r like 'OK:%' and exists (select 1 from paquets_d_archive_telecharges where dossier_id = d1 and annee = 2025
      and empreinte_exercice = e2025 and telecharge_par = membre::uuid and nb_fichiers = 5 and nb_non_verifiees = 1));
  r := pg_temp.essayer(membre, 'select count(*)::text from paquets_d_archive_telecharges where dossier_id = ''' || d1 || '''');
  insert into essai_dp values (2, 'le membre le relit', 'OK:1', r, r = 'OK:1');

  -- 3. Ses refus, à leurs codes et à leurs mots.
  r := pg_temp.essayer(membre, format(enregistrer, d1, 2025, repeat('b', 64), manifeste, 5, 0));
  insert into essai_dp values (3, 'une empreinte qui n''est pas celle de l''exercice validé', '23514', r,
    r = '23514:Ce paquet ne porte pas l’empreinte de l’exercice 2025 tel qu’il est validé : il ne s’enregistre pas.');
  r := pg_temp.essayer(membre, format(enregistrer, d1, 2024, e2025, manifeste, 5, 0));
  insert into essai_dp values (3, 'un exercice non validé', 'P0002', r, r = 'P0002:L’exercice 2024 n’est pas validé : il n’a pas de paquet d’archive.');
  r := pg_temp.essayer(membre, format(enregistrer, d1, 2025, e2025, repeat('C', 64), 5, 0));
  insert into essai_dp values (3, 'un manifeste illisible (capitales)', '22023', r, r = '22023:L’empreinte du manifeste du paquet est illisible.');
  r := pg_temp.essayer(membre, format(enregistrer, d1, 2025, e2025, manifeste, 2, 2));
  insert into essai_dp values (3, 'des comptes illisibles (tous les fichiers non vérifiés)', '22023', r, r = '22023:Les comptes du paquet sont illisibles.');
  r := pg_temp.essayer(super, format(enregistrer, d5, 2025, repeat('a', 64), manifeste, 5, 0));
  insert into essai_dp values (3, 'un exercice dont l''empreinte ne se vérifie plus', '23514', r,
    r = '23514:L’empreinte de l’exercice 2025 ne correspond plus à ce qui a été validé : à signaler sans attendre.');

  -- 4. La table : ni insertion directe hors du super-administrateur, ni mise à jour, ni suppression ; le client ne lit rien.
  r := pg_temp.essayer(membre, format($q$insert into paquets_d_archive_telecharges (dossier_id, annee, empreinte_exercice, empreinte_du_manifeste, nb_fichiers, nb_non_verifiees, telecharge_par) values ('%s', 2026, '%s', '%s', 5, 0, '%s') returning id::text$q$, d1, e2026, manifeste, membre));
  insert into essai_dp values (4, 'un membre n''insère pas de téléchargement directement', '42501', r, r like '42501:%');
  r := pg_temp.essayer(membre, format('with u as (update paquets_d_archive_telecharges set nb_fichiers = 9 where dossier_id = ''%s'' returning 1) select count(*)::text from u', d1));
  insert into essai_dp values (4, 'ni ne le modifie (aucune policy de mise à jour)', 'OK:0', r, r = 'OK:0');
  r := pg_temp.essayer(membre, format('with u as (delete from paquets_d_archive_telecharges where dossier_id = ''%s'' returning 1) select count(*)::text from u', d1));
  insert into essai_dp values (4, 'ni ne le supprime (aucune policy de suppression)', 'OK:0', r, r = 'OK:0');
  r := pg_temp.essayer(super, format(enregistrer, d2, 2025, e_d2, manifeste, 5, 0));
  r := pg_temp.essayer(chef, format('select count(*)::text from paquets_d_archive_telecharges where dossier_id = ''%s''', d2));
  insert into essai_dp values (4, 'le client ne lit pas le paquet de son dossier', 'OK:0', r, r = 'OK:0');

  -- 5. La conservation : qui la pose.
  r := pg_temp.essayer(membre, format('select conserver_le_dossier(''%s'')::text', d1));
  insert into essai_dp values (5, 'un membre de l''équipe ne conserve pas un dossier', '42501', r,
    r = '42501:Seul le chef du cabinet conserve un dossier ou lève sa conservation.');
  r := pg_temp.essayer(chef, format('select conserver_le_dossier(''%s'')::text', d2));
  insert into essai_dp values (5, 'le client ne conserve pas son dossier', '42501', r, r like '42501:%');
  r := pg_temp.essayer('anon', format('select conserver_le_dossier(''%s'')::text', d1));
  insert into essai_dp values (5, 'l''anonyme non plus', '42501', r, r like '42501:%');

  -- 6. Le chef du cabinet, qui n'est pas super-administrateur (l'utilisateur client de d2, promu le temps de l'essai).
  insert into cabinet_admins (user_id, cabinet_id, role) values (chef::uuid, cabinet, 'comptable_en_chef');
  r := pg_temp.essayer(chef, format('select conserver_le_dossier(''%s'')::text', d2));
  insert into essai_dp values (6, 'un dossier qui a un accès client ne se conserve pas', '23514', r,
    r = '23514:Ce dossier a encore 1 accès client : un dossier conservé n’en a aucun. Les retirer d’abord (onglet Accès).');
  r := pg_temp.essayer(chef, format('select conserver_le_dossier(''%s'')::text', d3));
  insert into essai_dp values (6, 'un dossier sans exercice validé ne se conserve pas', '23514', r,
    r = '23514:Aucun exercice n’est validé : il n’y a pas de livres à conserver dix ans. Valider d’abord le dernier exercice, ou supprimer le dossier.');
  r := pg_temp.essayer(chef, format('select conserver_le_dossier(''%s'')::text', d1));
  insert into essai_dp values (6, 'le chef conserve d1 jusqu''au 31/12/2036 (dernier exercice validé 2026, contrôle positif)', 'OK:2036-12-31', r,
    r = 'OK:2036-12-31' and exists (select 1 from conservations_des_dossiers where dossier_id = d1 and levee_le is null
      and dernier_exercice = 2026 and posee_par = chef::uuid));
  r := pg_temp.essayer(chef, format('select conserver_le_dossier(''%s'')::text', d1));
  insert into essai_dp values (6, 'une conservation déjà posée ne se repose pas', '23514', r, r = '23514:Ce dossier est déjà conservé jusqu’au 31/12/2036.');

  -- 7. Ce qu'un dossier conservé interdit, à tout auteur.
  r := pg_temp.essayer(chef, format(piece, d1, d1));
  insert into essai_dp values (7, 'aucune pièce ne se dépose dans un dossier conservé', '23514', r,
    r = '23514:Ce dossier est conservé jusqu’au 31/12/2036 : aucune pièce ne s’y dépose plus. La conservation se lève dans l’onglet Informations.');
  r := pg_temp.essayer(super, format(piece, d1, d1));
  insert into essai_dp values (7, 'ni par le super-administrateur', '23514', r, r like '23514:Ce dossier est conservé jusqu’au 31/12/2036 : aucune pièce%');
  r := pg_temp.essayer(null, format(ecriture, d1));
  insert into essai_dp values (7, 'aucune écriture ne s''y passe (le propriétaire sans session compris)', '23514', r,
    r like '23514:Ce dossier est conservé jusqu’au 31/12/2036 : aucune écriture ne s’y passe plus.%');
  r := pg_temp.essayer(null, format($q$insert into memberships (user_id, dossier_id, role) values ('%s', '%s', 'client') returning id::text$q$, membre, d1));
  insert into essai_dp values (7, 'aucun accès client ne s''y pose', '23514', r, r like '23514:Ce dossier est conservé jusqu’au 31/12/2036 : aucun accès client%');
  r := pg_temp.essayer(null, format($q$update memberships set dossier_id = '%s' where dossier_id = '%s' returning id::text$q$, d1, d2));
  insert into essai_dp values (7, 'ni ne s''y déplace d''un autre dossier', '23514', r, r like '23514:Ce dossier est conservé%aucun accès client%');
  r := pg_temp.essayer(null, format($q$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte, declaration) values ('%s', 2027, now(), '%s', 'tresorerie', 0, 0, 0, 0, '%s', '{}') returning annee::text$q$, d1, super, repeat('d', 64)));
  insert into essai_dp values (7, 'aucun exercice ne s''y valide', '23514', r, r like '23514:Ce dossier est conservé jusqu’au 31/12/2036 : aucun exercice ne s’y valide plus.%');
  -- M-DP1 : la même pièce dans un dossier qui n'est pas conservé passe la garde.
  r := pg_temp.essayer(null, format(piece, d3, d3));
  insert into mutation_dp values ('M-DP1 — la pièce déposée dans d3, qui n''est pas conservé', 'la pièce acceptée', r, r like 'OK:%');

  -- 8. Une conservation ne se réécrit pas, et ne cohabite pas avec un accès client.
  r := pg_temp.essayer(chef, format($q$insert into conservations_des_dossiers (dossier_id, dernier_exercice, jusqu_au, posee_par) values ('%s', 2025, '2035-12-31', '%s') returning id::text$q$, d3, chef));
  insert into essai_dp values (8, 'le chef n''insère pas de conservation directement (la restauration est au super-administrateur)', '42501', r, r like '42501:%');
  r := pg_temp.essayer(null, format($q$update conservations_des_dossiers set jusqu_au = '2030-12-31', dernier_exercice = 2020 where dossier_id = '%s' and levee_le is null returning id::text$q$, d1));
  insert into essai_dp values (8, 'une conservation en cours ne change pas de terme, même par le propriétaire', '23514', r,
    r = '23514:Une conservation ne se réécrit pas : elle se lève, une seule fois.');
  r := pg_temp.essayer(null, format($q$insert into conservations_des_dossiers (dossier_id, dernier_exercice, jusqu_au, posee_par) values ('%s', 2025, '2035-12-31', '%s') returning id::text$q$, d2, super));
  insert into essai_dp values (8, 'une conservation en cours ne s''insère pas sur un dossier qui a un accès client', '23514', r,
    r = '23514:Ce dossier a un accès client : un dossier conservé n’en a aucun. Les retirer d’abord (onglet Accès).');
  r := pg_temp.essayer(null, format($q$insert into conservations_des_dossiers (dossier_id, dernier_exercice, jusqu_au, posee_par) values ('%s', 2025, '2034-12-31', '%s') returning id::text$q$, d3, super));
  insert into essai_dp values (8, 'un terme qui n''est pas le 31 décembre de la dixième année se refuse', '23514', r, r like '23514:%conservations_des_dossiers_terme%');

  -- 9. La suppression, par le chef qui n'est pas super-administrateur.
  r := pg_temp.essayer(chef, format('with s as (delete from dossiers where id = ''%s'' returning 1) select count(*)::text from s', d1));
  insert into essai_dp values (9, 'un dossier conservé ne se supprime pas avant son terme', '23514', r,
    r = '23514:Ce dossier est conservé jusqu’au 31/12/2036 : il ne se supprime pas avant. Seul le super-administrateur le retire plus tôt.');
  r := pg_temp.essayer(membre, format('select lever_la_conservation(''%s'')::text', d1));
  insert into essai_dp values (9, 'un membre de l''équipe ne lève pas la conservation', '42501', r, r like '42501:Seul le chef%');
  r := pg_temp.essayer(chef, format('select lever_la_conservation(''%s'')::text', d1));
  insert into essai_dp values (9, 'le chef la lève (contrôle positif), la ligne reste, levée', 'OK', r,
    r like 'OK:%' and exists (select 1 from conservations_des_dossiers where dossier_id = d1 and levee_le is not null and levee_par = chef::uuid));
  r := pg_temp.essayer(chef, format('select lever_la_conservation(''%s'')::text', d1));
  insert into essai_dp values (9, 'une conservation levée ne se lève pas deux fois', 'P0002', r, r = 'P0002:Ce dossier n’est pas conservé : rien à lever.');
  r := pg_temp.essayer(null, format($q$update conservations_des_dossiers set levee_le = now() where dossier_id = '%s' and levee_le is not null returning id::text$q$, d1));
  insert into essai_dp values (9, 'une conservation levée ne se réécrit pas', '23514', r, r = '23514:Une conservation ne se réécrit pas : elle se lève, une seule fois.');
  r := pg_temp.essayer(chef, format('with s as (delete from dossiers where id = ''%s'' returning 1) select count(*)::text from s', d1));
  insert into essai_dp values (9, 'levée, d1 ne se supprime pas tant que le paquet de 2026 manque — il le nomme', '23514', r,
    r like '23514:Le paquet d’archive n’a pas été téléchargé pour l’exercice validé 2026. %');
  -- M-DP2 : le paquet de 2026 enregistré sous une autre empreinte (directement, par le propriétaire) ne compte pas.
  insert into paquets_d_archive_telecharges (dossier_id, annee, empreinte_exercice, empreinte_du_manifeste, nb_fichiers, nb_non_verifiees, telecharge_par)
    values (d1, 2026, repeat('e', 64), manifeste, 5, 0, super::uuid);
  r := pg_temp.essayer(chef, format('with s as (delete from dossiers where id = ''%s'' returning 1) select count(*)::text from s', d1));
  insert into mutation_dp values ('M-DP2 — un paquet de 2026 à une autre empreinte', 'la suppression refusée, 2026 nommé', r,
    r like '23514:Le paquet d’archive n’a pas été téléchargé pour l’exercice validé 2026.%');
  r := pg_temp.essayer(chef, format(enregistrer, d1, 2026, e2026, manifeste, 4, 0));
  r := pg_temp.essayer(chef, format('with s as (delete from dossiers where id = ''%s'' returning 1) select count(*)::text from s', d1));
  insert into essai_dp values (9, 'ses deux paquets téléchargés, d1 se supprime, ses téléchargements et sa conservation avec lui', 'OK:1', r,
    r = 'OK:1' and not exists (select 1 from paquets_d_archive_telecharges where dossier_id = d1)
      and not exists (select 1 from conservations_des_dossiers where dossier_id = d1));
  r := pg_temp.essayer(chef, format('with s as (delete from dossiers where id = ''%s'' returning 1) select count(*)::text from s', d4));
  insert into essai_dp values (9, 'un exercice dont la conservation est close (2014) ne demande plus de paquet', 'OK:1', r, r = 'OK:1');
  r := pg_temp.essayer(chef, format('with s as (delete from dossiers where id = ''%s'' returning 1) select count(*)::text from s', d6));
  insert into essai_dp values (9, 'un dossier conservé dont le terme est échu se supprime', 'OK:1', r, r = 'OK:1');
  r := pg_temp.essayer(chef, format('with s as (delete from dossiers where id = ''%s'' returning 1) select count(*)::text from s', d3));
  insert into essai_dp values (9, 'un dossier sans exercice validé se supprime comme hier', 'OK:1', r, r = 'OK:1');

  -- 10. Le super-administrateur.
  r := pg_temp.essayer(super, format('with s as (delete from dossiers where id = ''%s'' returning 1) select count(*)::text from s', d7));
  insert into essai_dp values (10, 'le super-administrateur supprime un dossier conservé avant son terme', 'OK:1', r, r = 'OK:1');
  r := pg_temp.essayer(super, format('with s as (delete from dossiers where id = ''%s'' returning 1) select count(*)::text from s', d5));
  insert into essai_dp values (10, 'et un dossier dont le paquet manque', 'OK:1', r, r = 'OK:1');
  -- M-DP3 : le même geste par le chef qui ne l'est pas, sur d2 (2025 validé, aucun paquet : il a été enregistré au 4 par
  -- le super-administrateur, puis retiré ici par le propriétaire).
  delete from paquets_d_archive_telecharges where dossier_id = d2;
  r := pg_temp.essayer(chef, format('with s as (delete from dossiers where id = ''%s'' returning 1) select count(*)::text from s', d2));
  insert into mutation_dp values ('M-DP3 — la suppression de d2 par le chef qui n''est pas super-administrateur', 'refusée, 2025 nommé', r,
    r like '23514:Le paquet d’archive n’a pas été téléchargé pour l’exercice validé 2025.%');
  -- M-DP4 : la levée défait l'interdit (une pièce se dépose de nouveau dans un dossier levé — d1 est parti : on le rejoue
  -- sur d8, conservé puis levé).
  insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values (d8, 'ESSAI INAL5 D8', cabinet, 'tresorerie', '455000');
  insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte, declaration)
    values (d8, 2025, now(), super::uuid, 'tresorerie', 0, 0, 0, 0, public.empreinte_exercice(d8, 2025, null), '{}');
  perform pg_temp.essayer(chef, format('select conserver_le_dossier(''%s'')::text', d8));
  perform pg_temp.essayer(chef, format('select lever_la_conservation(''%s'')::text', d8));
  r := pg_temp.essayer(chef, format(piece, d8, d8));
  insert into mutation_dp values ('M-DP4 — une pièce déposée dans un dossier dont la conservation est levée', 'la pièce acceptée', r, r like 'OK:%');

  -- 11. Le catalogue.
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proconfig = array['search_path=public']
     and p.proname in ('enregistrer_paquet_telecharge', 'conserver_le_dossier', 'lever_la_conservation')
     and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute');
  insert into essai_dp values (11, 'les trois fonctions : security definer, search_path, authenticated seul', '3', n::text, n = 3);
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proconfig = array['search_path=public']
     and p.proname in ('garder_conservation_du_dossier', 'garder_dossier_conserve', 'garder_depart_du_dossier')
     and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute');
  insert into essai_dp values (11, 'les trois gardes : security definer, search_path, aucun rôle de session', '3', n::text, n = 3);
  -- Les policies des deux tables, hors la restrictive `deux_facteurs` de la double authentification exigée (C7), qu'elles
  -- portent dès que celle-ci est en base : la migration la pose si elle la précède, elle-même sinon (le contrôle suivant).
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename in ('paquets_d_archive_telecharges', 'conservations_des_dossiers')
     and not (policyname = 'deux_facteurs' and permissive = 'RESTRICTIVE')
     and roles = '{authenticated}' and cmd in ('SELECT', 'INSERT');
  insert into essai_dp values (11, 'les deux tables : quatre policies to authenticated, de lecture et de restauration', '4', n::text,
    n = 4 and (select count(*) from pg_policies where schemaname = 'public' and tablename in ('paquets_d_archive_telecharges', 'conservations_des_dossiers')
                 and not (policyname = 'deux_facteurs' and permissive = 'RESTRICTIVE')) = 4);
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename in ('paquets_d_archive_telecharges', 'conservations_des_dossiers')
     and policyname = 'deux_facteurs' and permissive = 'RESTRICTIVE' and cmd = 'ALL' and roles = '{authenticated}';
  r := case when to_regprocedure('public.deux_facteurs_satisfaits()') is null then '0' else '2' end;
  insert into essai_dp values (11, 'la restrictive deux_facteurs sur chacune des deux tables si la double authentification exigée est en base, sur aucune sinon',
    r, n::text, n::text = r);
  select count(*) into n from pg_trigger t
   where not t.tgisinternal and t.tgname in ('pieces_dossier_conserve', 'ecritures_brouillon_dossier_conserve', 'memberships_dossier_conserve',
     'exercices_valides_dossier_conserve', 'dossiers_depart_du_client', 'conservations_des_dossiers_gardes');
  insert into essai_dp values (11, 'les six déclencheurs', '6', n::text, n = 6);
end
$essai$;

select rang, controle, attendu, observe, ok from essai_dp order by rang, controle;
select mutation, attendu, observe, case when mord then 'mord' else 'NE MORD PAS' end from mutation_dp order by mutation;
select case when count(*) filter (where not ok) = 0 then 'bilan' else '*** EN FAUTE ***' end,
       count(*) filter (where not ok) || ' en faute / ' || count(*) || ' contrôles' from essai_dp;
rollback;
