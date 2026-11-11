-- LA FACTURE D'HONORAIRES DÉPOSÉE CHEZ LE CLIENT (ligne 47, lot LM8 ; la migration `depot_des_honoraires`, PRÉPARÉE le
-- 11/11/2026, supabase/preparees/20261111230000_depot_des_honoraires.sql, après `dossier_du_cabinet` (LM1),
-- `lettres_de_mission` (LM4) et `honoraires_factures` (LM7)). Le récit : HISTORIQUE.md, « 11/11/2026 — LM8 ».
-- SUR UNE RÉPLIQUE SEULEMENT : il désigne le dossier du cabinet de la réplique, y valide des factures, range des fichiers
-- dans le seau des pièces, retire une pièce et supprime deux dossiers. À rejouer, par psql (`-f`, pas `-1` : le fichier
-- ouvre et ANNULE sa propre transaction), sous le super-utilisateur, après toute migration qui touche la table, ses
-- fonctions, les pièces, `enregistrer_facture`, les liens des honoraires (LM7) ou la désignation du dossier du cabinet.
--
-- Ce qui se prouve ici : qui dépose (l'accès au dossier du cabinet d'abord : ni l'anonyme, ni le client, ni un membre que
-- le dossier du cabinet n'a pas ; puis le dossier du cabinet seul ; puis l'accès au dossier du client) ; les refus de
-- `deposer_honoraires_chez_le_client`, dans leur ordre, à leurs mots et à leurs codes ; la pièce écrite des valeurs de la
-- facture (date, nom légal de l'émetteur, montants, nom du fichier), « à valider », d'achat, sans catégorie ; le dépôt
-- (premier, à l'auteur, l'empreinte) ; une facture ne se dépose qu'une fois, la pièce retirée la rend à déposer (le dépôt
-- suivant) ; l'avoir après sa facture, aux montants négatifs ; les deux lectures (le cabinet ; le dossier du client, que
-- son client lit, sans rien du dossier du cabinet) ; la garde pour tout auteur (ni modification ni retrait, le dossier du
-- cabinet, une facture validée, le client que ses honoraires désignent, une seule pièce présente) ; la porte de la
-- restauration ; le dossier du client supprimé ; le dossier du cabinet supprimé, qui emporte ses dépôts et laisse les
-- pièces chez le client ; le catalogue.
--
-- Le jeu, inséré par le propriétaire : au cabinet de la réplique, le dossier du cabinet K (SIRET, adresse, redevable de
-- la TVA), deux dossiers clients C (SIRET, adresse, un accès client) et C2 ; deux lettres ACCEPTÉES sur papier, écrites
-- comme une restauration les réinsère : L1 (C, un forfait mensuel), L2 (C2, un forfait mensuel) ; des factures facturées
-- par `facturer_honoraires` puis validées par `enregistrer_facture` ; des fichiers rangés dans le seau des pièces. Le
-- membre de l'équipe de la réplique est affecté à K, puis à C. Sans la migration, une ligne dit qu'il attend (EN ATTENTE).
-- Une garde de tête refuse de le jouer hors d'une réplique (ESSAI_HORS_REPLIQUE), avant toute écriture.
begin;
create temp table essai_hd (rang int, controle text, attendu text, observe text, ok boolean) on commit drop;

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

create function pg_temp.noter(p_rang int, p_controle text, p_attendu text, p_observe text) returns void
language sql as $f$ insert into essai_hd values (p_rang, p_controle, p_attendu, p_observe, p_observe like p_attendu || '%') $f$;

create function pg_temp.id(r text) returns uuid language sql as $f$
  select case when r ~ '^OK:[0-9a-f-]{36}$' then substr(r, 4)::uuid end $f$;

-- L'appel du dépôt, en texte, pour `essayer`.
create function pg_temp.deposer(k uuid, f uuid, chemin text, empreinte text) returns text language sql as $f$
  select format('select deposer_honoraires_chez_le_client(%L, %L, %L, %L)::text', k, f, chemin, empreinte) $f$;

-- Un fichier dans le seau des pièces, comme le navigateur l'y dépose (le type que le stockage range).
create function pg_temp.ranger(chemin text, type text default 'application/pdf') returns void language sql as $f$
  insert into storage.objects (bucket_id, name, metadata) values ('pieces', chemin, jsonb_build_object('mimetype', type, 'size', 1234)) $f$;

-- Facture des honoraires (LM7), puis la valide comme toute facture ; rend son identifiant (nul si un pas échoue).
create function pg_temp.facture_validee(qui text, k uuid, l uuid, debut text, fin text) returns uuid language plpgsql as $f$
declare
  r text;
  f uuid;
begin
  r := pg_temp.essayer(qui, format('select facturer_honoraires(%L, %L::jsonb, 20, null)::text', k,
         jsonb_build_array(jsonb_build_object('lettre_id', l, 'ligne', 1, 'periode_debut', debut, 'periode_fin', fin))));
  f := pg_temp.id(r);
  if f is null then raise notice 'facturer : %', r; return null; end if;
  r := pg_temp.essayer(qui, format($q$select numero from enregistrer_facture(%L, %L, (select to_jsonb(f) from factures_emises f where f.id = %L),
         (select jsonb_agg(jsonb_build_object('designation', designation, 'quantite', quantite, 'prix_unitaire_ht', prix_unitaire_ht,
                 'taux_tva', taux_tva, 'unite', unite, 'nature', nature) order by ordre) from facture_lignes where facture_id = %L), true)$q$, k, f, f, f));
  if r not like 'OK:%' then raise notice 'valider : %', r; return null; end if;
  return f;
end
$f$;

do $essai$
declare
  cabinet constant uuid := 'cab10000-0000-4000-8000-000000000001';
  k constant uuid := '1b800000-0000-4000-8000-0000000000a1';
  c constant uuid := '1b800000-0000-4000-8000-0000000000c1';
  c2 constant uuid := '1b800000-0000-4000-8000-0000000000c2';
  dk constant uuid := '1b800000-0000-4000-8000-0000000000d1';
  l1 constant uuid := '1b800000-0000-4000-8000-0000000000e1';
  l2 constant uuid := '1b800000-0000-4000-8000-0000000000e2';
  super constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  membre constant text := '3e3b0000-0000-4000-8000-000000000001';
  hash_dk constant text := repeat('ab', 32);
  e1 constant text := repeat('1', 64);
  e2 constant text := repeat('2', 64);
  e3 constant text := repeat('3', 64);
  e4 constant text := repeat('4', 64);
  r text;
  n int;
  f1 uuid; f2 uuid; f3 uuid; f4 uuid; fb uuid; a1 uuid; p1 uuid; p2 uuid; p3 uuid; pa uuid;
  v record;
begin
  if not exists (select 1 from pg_roles where rolname = 'proprietaire') then
    raise exception 'ESSAI_HORS_REPLIQUE : cet essai désigne le dossier du cabinet, range des fichiers et supprime deux dossiers ; il ne se joue que sur une réplique ; le rôle proprietaire, que toute réplique porte, est absent : rien n''est écrit.';
  end if;
  if to_regclass('public.honoraires_deposes') is null then
    insert into essai_hd values (0, 'HD. le dépôt des honoraires : EN ATTENTE de la migration depot_des_honoraires', 'la migration', 'absente', true);
    return;
  end if;

  insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, siret, adresse, statut_tva) values
    (k, 'ESSAI LM8 CABINET', cabinet, 'tresorerie', '455000', '12345678200010', 'ESSAI LM8 ADRESSE DU CABINET', 'redevable'),
    (c, 'ESSAI LM8 CLIENT', cabinet, 'tresorerie', '455000', '98765432100017', 'ESSAI LM8 ADRESSE DU CLIENT', null),
    (c2, 'ESSAI LM8 SECOND CLIENT', cabinet, 'tresorerie', '455000', '11122233300015', 'ESSAI LM8 AILLEURS', null);
  insert into documents_divers (id, dossier_id, storage_path, nom_fichier, categorie, storage_hash) values
    (dk, k, k || '/divers/signee.pdf', 'signee.pdf', 'autre', hash_dk);
  insert into memberships (user_id, dossier_id, role, email) values (client::uuid, c, 'client', 'essai-lm8@example.test');
  r := pg_temp.essayer(super, format($q$select designer_dossier_du_cabinet(%L, %L)$q$, cabinet, k));
  perform pg_temp.noter(1, 'le chef désigne le dossier du cabinet (LM1)', 'OK:' || k, r);
  insert into lettres_de_mission (id, dossier_id, dossier_client_id, missions, honoraires, date_effet, premier_exercice,
      fin_initiale, reconduction_tacite, signataire_nom, identite_client, identite_cabinet, clauses, empreinte, proposee_le,
      proposee_par, acceptee_le, acceptee_par, mode_acceptation, empreinte_acceptee, document_signe_id, empreinte_papier,
      signee_le, auteur)
  select l, k, d, '{tenue_comptable}', '[{"forme": "forfait", "libelle": "Tenue mensuelle", "montant_ht": 150, "periodicite": "mois"}]',
         '2026-01-01', 2026, '2026-12-31', true, 'Signataire', '{}', '{}', '{sous_traitance}', repeat(x, 64), '2025-12-01',
         super::uuid, '2025-12-05', super::uuid, 'papier', repeat(x, 64), dk, hash_dk, '2025-12-04', super::uuid
    from (values (l1, c, '7'), (l2, c2, '8')) as t(l, d, x);
  -- Une facture d'avant A7 (ses mentions non figées), telle qu'une restauration la réinsère dans un dossier encore sans
  -- numérotation, liée à ses honoraires de décembre 2025.
  r := pg_temp.essayer(super, format($q$insert into factures_emises (id, dossier_id, numero, statut, date_emission, tiers_nom, montant_ht,
         montant_tva, montant_ttc, type, mentions_figees, validated_at) values (%L, %L, 'F2025-0001', 'validee', '2025-12-31', 'ESSAI LM8 CLIENT',
         150, 30, 180, 'facture', false, '2025-12-31') returning 1$q$, '1b800000-0000-4000-8000-0000000000f0', k));
  r := r || ' ' || pg_temp.essayer(super, format($q$insert into honoraires_factures (dossier_id, facture_id, lettre_id, ligne, periode_debut,
         periode_fin, auteur) values (%L, %L, %L, 1, '2025-12-01', '2025-12-31', %L) returning 1$q$, k, '1b800000-0000-4000-8000-0000000000f0', l1, super));
  perform pg_temp.noter(67, 'une facture d''honoraires d''avant A7 se restaure, ses mentions non figées', 'OK:1 OK:1', r);
  insert into dossier_assignations (dossier_id, user_id) values (k, membre::uuid);
  f1 := pg_temp.facture_validee(membre, k, l1, '2026-01-01', '2026-01-31');
  f2 := pg_temp.facture_validee(membre, k, l1, '2026-02-01', '2026-02-28');
  f3 := pg_temp.facture_validee(membre, k, l2, '2026-01-01', '2026-01-31');
  f4 := pg_temp.facture_validee(membre, k, l2, '2026-02-01', '2026-02-28');
  r := pg_temp.essayer(membre, format('select facturer_honoraires(%L, %L::jsonb, 20, null)::text', k,
         jsonb_build_array(jsonb_build_object('lettre_id', l1, 'ligne', 1, 'periode_debut', '2026-03-01', 'periode_fin', '2026-03-31'))));
  fb := pg_temp.id(r);
  perform pg_temp.noter(2, 'quatre factures d''honoraires validées et un brouillon (LM7)', '5',
    (select count(*) from factures_emises where id in (f1, f2, f3, f4, fb))::text
    || case when (select count(*) from factures_emises where id in (f1, f2, f3, f4) and statut = 'validee' and mentions_figees) = 4 then '' else ' (pas toutes validées et figées)' end);
  perform pg_temp.ranger(c || '/lm8-f1.pdf');
  perform pg_temp.ranger(c || '/lm8-image.pdf', 'image/png');
  perform pg_temp.ranger(c2 || '/lm8-f3.pdf');
  perform pg_temp.ranger(k || '/lm8-k.pdf');

  -- L'accès au dossier du cabinet, d'abord ; puis le dossier du cabinet ; puis la forme.
  r := pg_temp.essayer('anon', pg_temp.deposer(k, f1, c || '/lm8-f1.pdf', e1));
  perform pg_temp.noter(3, 'l''anonyme n''exécute pas la fonction', '42501', r);
  r := pg_temp.essayer(client, pg_temp.deposer(k, f1, c || '/lm8-f1.pdf', e1));
  perform pg_temp.noter(4, 'le client est refusé', '42501:Accès refusé à ce dossier.', r);
  delete from dossier_assignations where dossier_id = k and user_id = membre::uuid;
  r := pg_temp.essayer(membre, pg_temp.deposer(k, f1, c || '/lm8-f1.pdf', e1));
  perform pg_temp.noter(5, 'un membre que le dossier du cabinet n''a pas est refusé', '42501:Accès refusé à ce dossier.', r);
  insert into dossier_assignations (dossier_id, user_id) values (k, membre::uuid);
  r := pg_temp.essayer(super, pg_temp.deposer(c, f1, c || '/lm8-f1.pdf', e1));
  perform pg_temp.noter(6, 'un dossier qui n''est pas le dossier du cabinet est refusé', '23514:Les factures d''honoraires se déposent depuis le dossier du cabinet.', r);
  r := pg_temp.essayer(membre, pg_temp.deposer(k, f1, c || '/lm8-f1.pdf', upper(repeat('ab', 32))));
  perform pg_temp.noter(7, 'une empreinte en capitales se refuse', '22023:L''empreinte du fichier est son SHA-256', r);
  r := pg_temp.essayer(membre, pg_temp.deposer(k, f1, c || '/lm8-f1.png', e1));
  perform pg_temp.noter(8, 'un fichier qui n''est pas un PDF se refuse', '22023:Le fichier se dépose dans le dossier du client, en PDF', r);
  r := pg_temp.essayer(membre, pg_temp.deposer(k, f1, c || '/sous/lm8-f1.pdf', e1));
  perform pg_temp.noter(9, 'un fichier rangé dans un sous-dossier se refuse', '22023:Le fichier se dépose dans le dossier du client, en PDF', r);
  r := pg_temp.essayer(membre, pg_temp.deposer(k, f1, 'pas-un-dossier/lm8-f1.pdf', e1));
  perform pg_temp.noter(10, 'un fichier hors d''un dossier se refuse', '22023:Le fichier se dépose dans le dossier du client, en PDF', r);

  -- La facture.
  r := pg_temp.essayer(membre, pg_temp.deposer(k, gen_random_uuid(), c || '/lm8-f1.pdf', e1));
  perform pg_temp.noter(11, 'une facture inconnue est introuvable', 'P0002:Facture introuvable dans le dossier du cabinet.', r);
  r := pg_temp.essayer(super, pg_temp.deposer(k, (select id from factures_emises where dossier_id <> k and statut = 'validee' limit 1), c || '/lm8-f1.pdf', e1));
  perform pg_temp.noter(12, 'la facture d''un autre dossier est introuvable', 'P0002:Facture introuvable dans le dossier du cabinet.', r);
  r := pg_temp.essayer(membre, pg_temp.deposer(k, fb, c || '/lm8-f1.pdf', e1));
  perform pg_temp.noter(13, 'un brouillon ne se dépose pas', '22023:Seule une facture validée se dépose chez le client.', r);
  r := pg_temp.essayer(membre, pg_temp.deposer(k, '1b800000-0000-4000-8000-0000000000f0', c || '/lm8-f1.pdf', e1));
  perform pg_temp.noter(68, 'une facture qui n''a pas figé ses mentions ne se dépose pas', '22023:Une facture reprise de l''ancien logiciel, ou qui n''a pas figé ses mentions', r);
  r := pg_temp.essayer(membre, format('select count(*)::text from factures_emises where id = %L and statut = ''validee'' and mentions_figees', f1));
  perform pg_temp.noter(14, 'la facture à déposer est validée et a figé ses mentions', 'OK:1', r);

  -- L'avoir avant sa facture.
  r := pg_temp.essayer(membre, format($q$select numero from enregistrer_facture(%L, null, '{"type": "avoir", "facture_origine_id": "%s", "montant_ht": -50, "montant_tva": -10, "montant_ttc": -60}'::jsonb,
         '[{"designation": "Geste", "quantite": -1, "prix_unitaire_ht": 50, "taux_tva": 20, "unite": "C62", "nature": "services"}]'::jsonb, true)$q$, k, f1));
  select id into a1 from factures_emises where facture_origine_id = f1 and type = 'avoir';
  perform pg_temp.noter(15, 'un avoir partiel de la facture de janvier se valide', 'OK:', r || case when a1 is null then ' (introuvable)' else '' end);
  perform pg_temp.ranger(c || '/lm8-a1.pdf');
  r := pg_temp.essayer(membre, pg_temp.deposer(k, a1, c || '/lm8-a1.pdf', e3));
  perform pg_temp.noter(16, 'un avoir ne se dépose pas avant sa facture', '22023:Un avoir se dépose après la facture qu''il corrige', r);

  -- Le dossier du client : ouvert au compte ; le fichier sous lui, dans le seau, en PDF.
  r := pg_temp.essayer(membre, pg_temp.deposer(k, f1, c || '/lm8-f1.pdf', e1));
  perform pg_temp.noter(17, 'un membre que le dossier du client n''a pas est refusé', '42501:Le dossier du client n''est pas ouvert à ce compte', r);
  insert into dossier_assignations (dossier_id, user_id) values (c, membre::uuid);
  r := pg_temp.essayer(membre, pg_temp.deposer(k, f1, k || '/lm8-k.pdf', e1));
  perform pg_temp.noter(18, 'un fichier rangé sous le dossier du cabinet se refuse', '22023:Le PDF n''est pas déposé dans le seau des pièces, sous le dossier du client', r);
  r := pg_temp.essayer(membre, pg_temp.deposer(k, f1, c || '/lm8-absent.pdf', e1));
  perform pg_temp.noter(19, 'un fichier absent du seau se refuse', '22023:Le PDF n''est pas déposé dans le seau des pièces, sous le dossier du client', r);
  r := pg_temp.essayer(membre, pg_temp.deposer(k, f1, c || '/lm8-image.pdf', e1));
  perform pg_temp.noter(20, 'un fichier que le stockage ne range pas en PDF se refuse', '22023:Le PDF n''est pas déposé dans le seau des pièces, sous le dossier du client', r);

  -- Le dépôt : la pièce, des valeurs de la facture ; le lien.
  r := pg_temp.essayer(membre, pg_temp.deposer(k, f1, c || '/lm8-f1.pdf', e1));
  p1 := pg_temp.id(r);
  perform pg_temp.noter(21, 'la facture de janvier se dépose chez le client', 'OK:', r);
  select * into v from pieces where id = p1;
  perform pg_temp.noter(22, 'une pièce d''achat « à valider » du dossier du client, sans catégorie, chargée par le membre, du fichier et de l''empreinte donnés',
    'c achat a_valider upload  membre ' || c || '/lm8-f1.pdf ' || e1 || ' haute EUR',
    case when v.dossier_id = c then 'c' else coalesce(v.dossier_id::text, '∅') end || ' ' || v.type_piece || ' ' || v.statut || ' ' || v.source || ' '
    || coalesce(v.categorie_id::text, '') || ' ' || case when v.uploaded_by = membre::uuid then 'membre' else coalesce(v.uploaded_by::text, '∅') end
    || ' ' || v.storage_path || ' ' || v.storage_hash || ' ' || coalesce(v.confiance, '∅') || ' ' || v.devise);
  select f.numero, f.date_emission, f.montant_ht, f.montant_tva, f.montant_ttc, f.denomination_imprimee, f.emetteur_nom into v
    from factures_emises f where f.id = f1;
  perform pg_temp.noter(23, 'sa date, son émetteur, ses montants et son nom sont ceux de la facture',
    'Facture ' || v.numero || '.pdf ' || v.date_emission || ' ' || coalesce(nullif(btrim(v.denomination_imprimee), ''), v.emetteur_nom)
    || ' ' || v.montant_ht || ' ' || v.montant_tva || ' ' || v.montant_ttc,
    (select p.nom_fichier || ' ' || p.date_piece || ' ' || coalesce(p.tiers, '∅') || ' ' || p.montant_ht || ' ' || p.montant_tva || ' ' || p.montant_ttc
       from pieces p where p.id = p1));
  perform pg_temp.noter(24, 'l''émetteur a un nom (le dossier du cabinet)', 'oui', case when (select tiers from pieces where id = p1) is not null then 'oui' else 'non' end);
  select count(*) into n from honoraires_deposes
   where facture_id = f1 and depot = 1 and dossier_id = k and dossier_client_id = c and piece_id = p1 and empreinte = e1 and auteur = membre::uuid;
  perform pg_temp.noter(25, 'le dépôt : premier, du dossier du cabinet au dossier du client, la pièce, l''empreinte, l''auteur', '1', n::text);

  -- Une seule fois ; ni le même fichier ni la même empreinte pour une autre facture.
  perform pg_temp.ranger(c || '/lm8-f1-bis.pdf');
  r := pg_temp.essayer(membre, pg_temp.deposer(k, f1, c || '/lm8-f1-bis.pdf', e2));
  perform pg_temp.noter(26, 'la facture déposée ne se dépose plus', '23514:Cette facture est déjà déposée chez le client.', r);
  r := pg_temp.essayer(membre, pg_temp.deposer(k, f1, c || '/lm8-pas-range.pdf', e2));
  perform pg_temp.noter(65, 'la facture déjà déposée se dit avant le fichier (la fonction, pas seulement la garde)', '23514:Cette facture est déjà déposée chez le client.', r);
  r := pg_temp.essayer(membre, pg_temp.deposer(k, f2, c || '/lm8-f1.pdf', e2));
  perform pg_temp.noter(27, 'le fichier d''une autre pièce du client se refuse', '23505:Ce fichier est déjà une pièce du dossier du client.', r);
  r := pg_temp.essayer(membre, pg_temp.deposer(k, f2, c || '/lm8-f1-bis.pdf', e1));
  perform pg_temp.noter(28, 'l''empreinte d''une autre pièce du client se refuse', '23505:Ce fichier est déjà une pièce du dossier du client.', r);
  r := pg_temp.essayer(membre, pg_temp.deposer(k, f2, c2 || '/lm8-f3.pdf', e2));
  perform pg_temp.noter(29, 'le fichier rangé sous un autre client se refuse', '22023:Le PDF n''est pas déposé dans le seau des pièces, sous le dossier du client', r);

  -- L'avoir après sa facture : ses montants négatifs.
  r := pg_temp.essayer(membre, pg_temp.deposer(k, a1, c || '/lm8-a1.pdf', e3));
  pa := pg_temp.id(r);
  perform pg_temp.noter(30, 'l''avoir se dépose après sa facture', 'OK:', r);
  perform pg_temp.noter(31, 'une pièce d''achat aux montants négatifs, nommée « Avoir … »', 'achat -50.00 -10.00 -60.00 Avoir ',
    (select p.type_piece || ' ' || p.montant_ht || ' ' || p.montant_tva || ' ' || p.montant_ttc || ' ' || p.nom_fichier from pieces p where p.id = pa));

  -- Les deux lectures.
  r := pg_temp.essayer(client, format('select string_agg(nature || '':'' || case when piece_id = %L then ''p1'' when piece_id = %L then ''pa'' else ''?'' end, '','' order by nature desc) from honoraires_deposes_au_dossier(%L)', p1, pa, c));
  perform pg_temp.noter(32, 'le client lit lesquelles de ses pièces sont des honoraires, et leur nature', 'OK:facture:p1,avoir:pa', r);
  r := pg_temp.essayer(client, format('select string_agg(t.k, '','' order by t.k) from honoraires_deposes_au_dossier(%L) h, jsonb_object_keys(to_jsonb(h)) t(k)', c));
  perform pg_temp.noter(33, 'rien d''autre : la pièce, la nature, le jour (ni facture, ni dossier du cabinet)', 'OK:depose_le,depose_le,nature,nature,piece_id,piece_id', r);
  r := pg_temp.essayer(client, format('select count(*)::text from honoraires_deposes_au_dossier(%L)', c2));
  perform pg_temp.noter(34, 'le client ne lit pas un autre dossier', '42501:Accès refusé à ce dossier.', r);
  r := pg_temp.essayer(client, 'select count(*)::text from honoraires_deposes');
  perform pg_temp.noter(35, 'le client ne lit aucun dépôt', 'OK:0', r);
  r := pg_temp.essayer(client, format('select count(*)::text from depots_des_honoraires(%L)', k));
  perform pg_temp.noter(36, 'le client ne lit pas les dépôts du cabinet', '42501:Accès refusé à ce dossier.', r);
  r := pg_temp.essayer('anon', format('select count(*)::text from honoraires_deposes_au_dossier(%L)', c));
  perform pg_temp.noter(37, 'l''anonyme ne lit rien', '42501', r);
  r := pg_temp.essayer(membre, format('select string_agg(case when facture_id = %L then ''f1'' else ''a1'' end || '':'' || depot || '':'' || presente, '','' order by depot, presente) from depots_des_honoraires(%L)', f1, k));
  perform pg_temp.noter(38, 'le cabinet lit le dernier dépôt de ses factures, et leur pièce présente', 'OK:', r || case when r like '%f1:1:true%' and r like '%a1:1:true%' then '' else ' (inattendu)' end);
  r := pg_temp.essayer(membre, 'select count(*)::text from honoraires_deposes');
  perform pg_temp.noter(39, 'le membre du dossier du cabinet lit ses dépôts', 'OK:2', r);

  -- La pièce retirée rend la facture à déposer : le dépôt suivant.
  r := pg_temp.essayer(membre, format('delete from pieces where id = %L returning 1', pa));
  perform pg_temp.noter(40, 'la pièce de l''avoir se retire du dossier du client (rien ne la retient)', 'OK:1', r);
  r := pg_temp.essayer(membre, format('select string_agg(depot || '':'' || presente, '','') from depots_des_honoraires(%L) where facture_id = %L', k, a1));
  perform pg_temp.noter(41, 'son dépôt reste, sa pièce n''est plus là', 'OK:1:false', r);
  r := pg_temp.essayer(client, format('select count(*)::text from honoraires_deposes_au_dossier(%L)', c));
  perform pg_temp.noter(42, 'le client ne la compte plus', 'OK:1', r);
  r := pg_temp.essayer(membre, pg_temp.deposer(k, a1, c || '/lm8-a1.pdf', e3));
  perform pg_temp.noter(43, 'l''avoir se dépose de nouveau : le dépôt suivant', 'OK:', r || ' ' || coalesce((select max(depot)::text from honoraires_deposes where facture_id = a1), '∅'));

  -- La garde, pour tout auteur.
  r := pg_temp.essayer(membre, format('insert into honoraires_deposes (dossier_id, facture_id, depot, dossier_client_id, piece_id, empreinte, auteur) values (%L, %L, 9, %L, gen_random_uuid(), %L, %L) returning 1', k, f2, c, e4, membre));
  perform pg_temp.noter(44, 'le membre n''écrit pas un dépôt directement', '42501', r);
  r := pg_temp.essayer(super, format('insert into honoraires_deposes (dossier_id, facture_id, depot, dossier_client_id, piece_id, empreinte, auteur) values (%L, %L, 1, %L, gen_random_uuid(), %L, %L) returning 1', k, f2, c2, e4, super));
  perform pg_temp.noter(45, 'la restauration : pas chez un autre client que celui des honoraires', '23514:Une facture d''honoraires se dépose chez le client que ses honoraires désignent.', r);
  r := pg_temp.essayer(super, format('insert into honoraires_deposes (dossier_id, facture_id, depot, dossier_client_id, piece_id, empreinte, auteur) values (%L, %L, 1, %L, gen_random_uuid(), %L, %L) returning 1', k, fb, c, e4, super));
  perform pg_temp.noter(46, 'la restauration : pas un brouillon', '23514:Seule une facture ou un avoir validé du dossier du cabinet se dépose chez le client.', r);
  r := pg_temp.essayer(super, format('insert into honoraires_deposes (dossier_id, facture_id, depot, dossier_client_id, piece_id, empreinte, auteur) values (%L, %L, 1, %L, gen_random_uuid(), %L, %L) returning 1', c, f2, c, e4, super));
  perform pg_temp.noter(47, 'la restauration : depuis le dossier du cabinet seul', '23514:Une facture d''honoraires se dépose depuis le dossier du cabinet.', r);
  r := pg_temp.essayer(super, format('insert into honoraires_deposes (dossier_id, facture_id, depot, dossier_client_id, piece_id, empreinte, auteur) values (%L, %L, 7, %L, %L, %L, %L) returning 1', k, f2, c, p1, e4, super));
  perform pg_temp.noter(48, 'la restauration : la pièce présente d''une autre facture se refuse (la clé de la pièce)', '23505', r);
  insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut) values (gen_random_uuid(), c, c || '/lm8-vente.pdf', 'vente.pdf', 'vente', 'a_valider') returning id into p3;
  r := pg_temp.essayer(super, format('insert into honoraires_deposes (dossier_id, facture_id, depot, dossier_client_id, piece_id, empreinte, auteur) values (%L, %L, 1, %L, %L, %L, %L) returning 1', k, f2, c, p3, e4, super));
  perform pg_temp.noter(49, 'la restauration : une pièce présente qui n''est pas un achat du client se refuse', '23514:La pièce d''un dépôt est une pièce d''achat du dossier du client.', r);
  insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut) values (gen_random_uuid(), c, c || '/lm8-achat.pdf', 'achat.pdf', 'achat', 'a_valider') returning id into p2;
  r := pg_temp.essayer(super, format('insert into honoraires_deposes (dossier_id, facture_id, depot, dossier_client_id, piece_id, empreinte, auteur) values (%L, %L, 5, %L, %L, %L, %L) returning 1', k, f1, c, p2, e4, super));
  perform pg_temp.noter(50, 'la restauration : une seconde pièce présente de la même facture se refuse', '23514:Cette facture est déjà déposée chez le client.', r);
  r := pg_temp.essayer(super, format('insert into honoraires_deposes (dossier_id, facture_id, depot, dossier_client_id, piece_id, empreinte, auteur) values (%L, %L, 1, %L, %L, %L, %L) returning 1', k, f2, c, p2, e4, super));
  perform pg_temp.noter(51, 'la restauration : un dépôt cohérent passe la porte du super-administrateur', 'OK:1', r);
  r := pg_temp.essayer(super, format('insert into honoraires_deposes (dossier_id, facture_id, depot, dossier_client_id, piece_id, empreinte, auteur) values (%L, %L, 1, %L, gen_random_uuid(), %L, %L) returning 1', k, f2, c, e4, super));
  perform pg_temp.noter(52, 'la contrainte totale : un même numéro de dépôt ne se répète pas', '23505', r);
  r := pg_temp.essayer(super, format('update honoraires_deposes set empreinte = %L where facture_id = %L returning 1', e4, f1));
  perform pg_temp.noter(53, 'un dépôt ne se modifie pas (le super-administrateur non plus)', '', r || case when r like 'OK:%' then ' (aucune policy : rien de touché)' else '' end);
  r := pg_temp.essayer(null, format('update honoraires_deposes set empreinte = %L where facture_id = %L returning 1', e4, f1));
  perform pg_temp.noter(54, 'un dépôt ne se modifie pas (le propriétaire non plus)', '23514:Le dépôt d''une facture d''honoraires ne se modifie pas.', r);
  r := pg_temp.essayer(null, format('delete from honoraires_deposes where facture_id = %L returning 1', f1));
  perform pg_temp.noter(55, 'un dépôt ne se retire pas, tant que son dossier existe', '23514:Le dépôt d''une facture d''honoraires ne se retire pas', r);

  -- Le dossier du client supprimé : son dépôt reste, sans pièce ; il ne reçoit plus rien.
  r := pg_temp.essayer(membre, pg_temp.deposer(k, f3, c2 || '/lm8-f3.pdf', e2));
  perform pg_temp.noter(56, 'un membre que le second client n''a pas est refusé', '42501:Le dossier du client n''est pas ouvert à ce compte', r);
  r := pg_temp.essayer(super, pg_temp.deposer(k, f3, c2 || '/lm8-f3.pdf', e2));
  perform pg_temp.noter(57, 'le chef dépose chez le second client', 'OK:', r);
  r := pg_temp.essayer(client, format('select count(*)::text from honoraires_deposes_au_dossier(%L)', c));
  perform pg_temp.noter(66, 'le client ne lit que ses trois pièces (janvier, l''avoir, le dépôt restauré), jamais le dépôt chez un autre client', 'OK:3', r);
  delete from dossiers where id = c2;
  perform pg_temp.ranger(c2 || '/lm8-f4.pdf');
  r := pg_temp.essayer(super, pg_temp.deposer(k, f4, c2 || '/lm8-f4.pdf', e4));
  perform pg_temp.noter(58, 'le dossier du client supprimé ne reçoit plus rien', '22023:Le dossier du client n''existe plus dans ce cabinet.', r);
  r := pg_temp.essayer(super, format('select string_agg(depot || '':'' || presente, '','') from depots_des_honoraires(%L) where facture_id = %L', k, f3));
  perform pg_temp.noter(59, 'le dépôt chez le client supprimé reste, sans pièce', 'OK:1:false', r);

  -- Le catalogue.
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and p.proname in ('deposer_honoraires_chez_le_client', 'depots_des_honoraires', 'honoraires_deposes_au_dossier')
     and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
     and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=public%';
  perform pg_temp.noter(60, 'les trois fonctions : security definer, search_path fixé, authenticated seul', '3', n::text);
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'garder_honoraires_deposes'
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  perform pg_temp.noter(61, 'la garde : aucun rôle de session', '0', n::text);
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and not p.prosecdef and p.proname = 'client_de_la_facture_d_honoraires'
     and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute');
  perform pg_temp.noter(62, 'le contrôle : aux droits de l''appelant, authenticated seul', '1', n::text);
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'honoraires_deposes'
     and roles = '{authenticated}' and cmd in ('SELECT', 'INSERT');
  perform pg_temp.noter(63, 'deux policies to authenticated, lecture et restauration', '2', n::text
    || case when (select count(*) from pg_policies where schemaname = 'public' and tablename = 'honoraires_deposes') = 2 then '' else ' (et d''autres)' end);

  -- En dernier : le dossier du cabinet supprimé (le super-administrateur seul, LM1) emporte ses dépôts ; les pièces
  -- restent chez le client.
  select count(*) into n from honoraires_deposes where dossier_id = k;
  r := pg_temp.essayer(super, format('delete from dossiers where id = %L returning 1', k));
  perform pg_temp.noter(64, 'le dossier du cabinet supprimé emporte ses dépôts, les pièces restent chez le client', 'OK:1 0 2',
    r || ' ' || (select count(*) from honoraires_deposes where dossier_id = k) || ' '
    || (select count(*) from pieces where dossier_id = c and storage_path in (c || '/lm8-f1.pdf', c || '/lm8-a1.pdf'))
    || case when n = 0 then ' (aucun dépôt avant)' else '' end);
end
$essai$;

select case when ok then 'OK  ' else 'FAUX' end || ' ' || lpad(rang::text, 2) || '. ' || controle
       || case when ok then '' else ' — attendu « ' || attendu || ' », observé « ' || observe || ' »' end as ligne
  from essai_hd order by rang, controle;
select count(*) filter (where not ok) || ' en faute / ' || count(*) || ' étapes' as bilan from essai_hd;
rollback;
