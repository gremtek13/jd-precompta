-- LES LETTRES DE MISSION (ligne 47, lot LM4 ; la migration `lettres_de_mission`, PRÉPARÉE le 11/11/2026,
-- supabase/preparees/20261111160000_lettres_de_mission.sql, après `dossier_du_cabinet`, LM1). Le récit : HISTORIQUE.md,
-- « 11/11/2026 — LM4 ».
-- SUR UNE RÉPLIQUE SEULEMENT : il désigne le dossier du cabinet de la réplique et supprime, en dernier, un dossier jetable
-- (le geste du super-administrateur qui retire un cabinet). À rejouer, par psql (`-f`, pas `-1` : le fichier ouvre et
-- ANNULE sa propre transaction), après toute migration qui touche les deux tables, leurs fonctions, la désignation du
-- dossier du cabinet, `memberships`, `documents_divers` ou la suppression d'un dossier.
--
-- Ce qui se prouve ici : qui écrit (l'accès d'abord : ni l'anonyme, ni un membre que le dossier du cabinet n'a pas, ni le
-- client ; puis le dossier du cabinet seul) ; les refus des modèles, du brouillon, de la proposition, de la réponse et du
-- retrait, à leurs mots et à leurs codes ; que la proposition FIGE (les copies lues par la base, les clauses exigées,
-- l'empreinte que la base recalcule, sous un autre fuseau aussi) et qu'ensuite rien ne se réécrit, même par le
-- propriétaire ; que l'acceptation en ligne se refuse à tout auteur, la restauration comprise, drapeau baissé ; le papier
-- signé (du dossier du cabinet, par son empreinte, daté entre la proposition et aujourd'hui), qui ne se supprime plus ;
-- une seule nouvelle version vivante, la version courante seule répondue ou retirée, la résiliation datée ; aucune
-- suppression, sauf avec le dossier ; qui lit (le cabinet du dossier, jamais le client) ; la porte de la restauration au
-- super-administrateur seul ; la désignation qui ne change plus ; le catalogue.
--
-- Le jeu, inséré par le propriétaire : au cabinet de la réplique, le dossier du cabinet K (SIRET et adresse), deux
-- dossiers clients C (une adresse, l'accès du client d'essai) et C2 (sans adresse), et, à un second cabinet, le dossier O ;
-- trois documents (dans K avec et sans empreinte, dans C). Le membre de l'équipe de la réplique est affecté à K en cours
-- d'essai. Sans la migration, une ligne dit qu'il attend (EN ATTENTE) et rien ne s'écrit. Une garde de tête refuse de le
-- jouer hors d'une réplique (ESSAI_HORS_REPLIQUE), avant toute écriture.
begin;
create temp table essai_lm (rang int, controle text, attendu text, observe text, ok boolean) on commit drop;

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
language sql as $f$ insert into essai_lm values (p_rang, p_controle, p_attendu, p_observe, p_observe like p_attendu || '%') $f$;

do $essai$
declare
  cabinet constant uuid := 'cab10000-0000-4000-8000-000000000001';
  autre_cabinet constant uuid := '1b400000-0000-4000-8000-0000000000cb';
  k constant uuid := '1b400000-0000-4000-8000-0000000000a1';
  c constant uuid := '1b400000-0000-4000-8000-0000000000c1';
  c2 constant uuid := '1b400000-0000-4000-8000-0000000000c2';
  o constant uuid := '1b400000-0000-4000-8000-0000000000b1';
  dk constant uuid := '1b400000-0000-4000-8000-0000000000d1';
  dk0 constant uuid := '1b400000-0000-4000-8000-0000000000d2';
  dc constant uuid := '1b400000-0000-4000-8000-0000000000d3';
  super constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  membre constant text := '3e3b0000-0000-4000-8000-000000000001';
  hash_dk constant text := repeat('ab', 32);
  missions_m constant jsonb := '{"tenue_comptable": "Tenir la comptabilité de trésorerie.", "declaration_2035": "Établir la 2035 ; le mandat de télétransmission dure autant que la lettre.", "facturation_au_nom_du_client": "Établir les factures au nom et pour le compte du client."}';
  contenu jsonb;
  ma uuid; mb uuid; mb2 uuid; l1 uuid; l2 uuid;
  r text;
  n int;
  ligne record;
  scelle boolean;
begin
  if not exists (select 1 from pg_roles where rolname = 'proprietaire') then
    raise exception 'ESSAI_HORS_REPLIQUE : cet essai désigne le dossier du cabinet et supprime un dossier ; il ne se joue que sur une réplique ; le rôle proprietaire, que toute réplique porte, est absent : rien n''est écrit.';
  end if;
  if to_regclass('public.lettres_de_mission') is null then
    insert into essai_lm values (0, 'LM. les lettres de mission : EN ATTENTE de la migration lettres_de_mission', 'la migration', 'absente', true);
    return;
  end if;

  insert into cabinets (id, nom) values (autre_cabinet, 'ESSAI LM4 AUTRE CABINET');
  insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, siret, adresse) values
    (k, 'ESSAI LM4 CABINET', cabinet, 'tresorerie', '455000', '12345678200010', 'ESSAI LM4 ADRESSE DU CABINET'),
    (c, 'ESSAI LM4 CLIENT', cabinet, 'tresorerie', '455000', null, 'ESSAI LM4 ADRESSE DU CLIENT'),
    (c2, 'ESSAI LM4 CLIENT SANS ADRESSE', cabinet, 'tresorerie', '455000', null, null),
    (o, 'ESSAI LM4 AUTRE', autre_cabinet, 'tresorerie', '455000', null, 'ESSAI LM4 AILLEURS');
  insert into documents_divers (id, dossier_id, storage_path, nom_fichier, categorie, storage_hash) values
    (dk, k, k || '/divers/signee.pdf', 'signee.pdf', 'autre', hash_dk),
    (dk0, k, k || '/divers/sans.pdf', 'sans.pdf', 'autre', null),
    (dc, c, c || '/divers/client.pdf', 'client.pdf', 'autre', repeat('cd', 32));
  insert into memberships (user_id, dossier_id, role, email) values (client::uuid, c, 'client', 'essai-lm4@example.test');

  -- L'accès, d'abord ; puis le dossier du cabinet.
  r := pg_temp.essayer('anon', format($q$select (enregistrer_modele_de_lettre(%L, 'T', 'CG', %L::jsonb, '{}', null)).id$q$, k, missions_m));
  perform pg_temp.noter(1, 'l''anonyme n''exécute pas les fonctions des lettres', '42501', r);
  r := pg_temp.essayer(membre, format($q$select (enregistrer_modele_de_lettre(%L, 'T', 'CG', %L::jsonb, '{}', null)).id$q$, k, missions_m));
  perform pg_temp.noter(2, 'un membre que le dossier du cabinet n''a pas est refusé', '42501:Accès refusé à ce dossier.', r);
  r := pg_temp.essayer(client, format($q$select (enregistrer_modele_de_lettre(%L, 'T', 'CG', %L::jsonb, '{}', null)).id$q$, k, missions_m));
  perform pg_temp.noter(3, 'le client est refusé', '42501:Accès refusé à ce dossier.', r);
  r := pg_temp.essayer(super, format($q$select (enregistrer_modele_de_lettre(%L, 'T', 'CG', %L::jsonb, '{}', null)).id$q$, k, missions_m));
  perform pg_temp.noter(4, 'un dossier qui n''est pas le dossier du cabinet est refusé', '23514:Les lettres de mission se rédigent dans le dossier du cabinet.', r);
  r := pg_temp.essayer(super, format($q$select designer_dossier_du_cabinet(%L, %L)$q$, cabinet, k));
  perform pg_temp.noter(5, 'le chef désigne le dossier du cabinet (LM1)', 'OK:' || k, r);
  -- Le dossier désigné, chaque fonction vérifie encore l'accès d'abord : le client est refusé partout.
  r := pg_temp.essayer(client, format($q$select (retirer_modele_de_lettre(%L, gen_random_uuid())).id$q$, k));
  perform pg_temp.noter(58, 'le client ne retire pas de modèle', '42501:Accès refusé à ce dossier.', r);
  r := pg_temp.essayer(client, format($q$select (enregistrer_brouillon_de_lettre(%L, null, '{}'::jsonb, null)).id$q$, k));
  perform pg_temp.noter(59, 'le client ne rédige pas de brouillon', '42501:Accès refusé à ce dossier.', r);
  r := pg_temp.essayer(client, format($q$select (proposer_lettre_de_mission(%L, gen_random_uuid(), null)).id$q$, k));
  perform pg_temp.noter(60, 'le client ne propose pas de lettre', '42501:Accès refusé à ce dossier.', r);
  r := pg_temp.essayer(client, format($q$select (enregistrer_reponse_a_la_lettre(%L, gen_random_uuid(), 'refusee', null, null)).id$q$, k));
  perform pg_temp.noter(61, 'le client n''enregistre pas de réponse par la fonction du cabinet', '42501:Accès refusé à ce dossier.', r);
  r := pg_temp.essayer(client, format($q$select (retirer_lettre_de_mission(%L, gen_random_uuid(), null)).id$q$, k));
  perform pg_temp.noter(62, 'le client ne retire pas de lettre', '42501:Accès refusé à ce dossier.', r);

  -- Les modèles.
  r := pg_temp.essayer(super, format($q$select (enregistrer_modele_de_lettre(%L, 'T', 'CG', '{"inconnue": "x"}'::jsonb, '{}', null)).id$q$, k));
  perform pg_temp.noter(6, 'un modèle à mission hors du catalogue se refuse', '22023:Un modèle décrit au moins une mission du catalogue', r);
  r := pg_temp.essayer(super, format($q$select (enregistrer_modele_de_lettre(%L, 'Modèle A', 'Conditions générales A', %L::jsonb, '{"sous_traitance": "Clause RGPD."}', null)).id$q$, k, missions_m));
  perform pg_temp.noter(7, 'le chef enregistre un modèle (sans mandat de facturation)', 'OK:', r);
  ma := substr(r, 4)::uuid;
  r := pg_temp.essayer(super, format($q$select (enregistrer_modele_de_lettre(%L, 'Modèle B', 'Conditions générales B', %L::jsonb, '{"sous_traitance": "Clause RGPD.", "mandat_de_facturation": "Mandat préalable."}', null)).id$q$, k, missions_m));
  mb := substr(r, 4)::uuid;
  r := pg_temp.essayer(super, format($q$select (enregistrer_modele_de_lettre(%L, 'Modèle B2', 'Conditions générales B2', %L::jsonb, '{"sous_traitance": "Clause RGPD.", "mandat_de_facturation": "Mandat préalable."}', %L)).id$q$, k, missions_m, mb));
  perform pg_temp.noter(8, 'une nouvelle version d''un modèle le remplace', 'OK:', r);
  mb2 := substr(r, 4)::uuid;
  r := pg_temp.essayer(super, format($q$select (enregistrer_modele_de_lettre(%L, 'Modèle B3', 'CG', %L::jsonb, '{}', %L)).id$q$, k, missions_m, mb));
  perform pg_temp.noter(9, 'un modèle remplacé ne se remplace plus', '22023:Ce modèle a été remplacé depuis', r);
  r := pg_temp.essayer(null, format($q$update modeles_lettre_de_mission set titre = 'Réécrit' where id = %L returning 1$q$, ma));
  perform pg_temp.noter(10, 'un modèle ne se réécrit pas, même par le propriétaire', '23514:Un modèle de lettre de mission ne se modifie pas', r);

  -- Le brouillon, écrit par un membre affecté au dossier du cabinet (LM-Q2).
  insert into dossier_assignations (dossier_id, user_id) values (k, membre::uuid);
  contenu := jsonb_build_object('dossier_client_id', c, 'modele_id', ma,
    'missions', jsonb_build_array('tenue_comptable', 'facturation_au_nom_du_client'),
    'repartition', '[{"tache": "Transmettre les pièces chaque mois", "par": "client"}, {"tache": "Tenir la comptabilité", "par": "cabinet"}]'::jsonb,
    'honoraires', '[{"forme": "forfait", "libelle": "Tenue mensuelle", "montant_ht": 150, "periodicite": "mois"}, {"forme": "tache", "libelle": "Déclaration 2035", "montant_ht": 600, "livrable": "declaration_2035"}]'::jsonb,
    'date_effet', '2027-01-01', 'premier_exercice', 2027, 'fin_initiale', '2027-12-31',
    'signataire_nom', 'Signataire Essai', 'signataire_qualite', 'Gérant');
  r := pg_temp.essayer(membre, format($q$select (enregistrer_brouillon_de_lettre(%L, null, %L::jsonb, null)).id$q$, k, contenu));
  perform pg_temp.noter(11, 'le membre affecté rédige un brouillon', 'OK:', r);
  l1 := substr(r, 4)::uuid;
  r := pg_temp.essayer(membre, format($q$select (enregistrer_brouillon_de_lettre(%L, null, %L::jsonb, null)).id$q$, k, contenu || '{"inconnue": 1}'));
  perform pg_temp.noter(12, 'un contenu à clé inconnue se refuse', '22023:Le contenu de la lettre est illisible', r);
  r := pg_temp.essayer(membre, format($q$select (enregistrer_brouillon_de_lettre(%L, null, %L::jsonb, null)).id$q$, k, contenu || jsonb_build_object('dossier_client_id', o)));
  perform pg_temp.noter(13, 'un client d''un autre cabinet se refuse', '22023:Le client est un dossier de ce cabinet', r);
  r := pg_temp.essayer(membre, format($q$select (enregistrer_brouillon_de_lettre(%L, null, %L::jsonb, null)).id$q$, k, contenu || '{"honoraires": [{"forme": "forfait", "libelle": "x", "montant_ht": 0.001, "periodicite": "mois"}]}'));
  perform pg_temp.noter(14, 'un montant au-delà du centime se refuse', '22023:Les honoraires sont illisibles', r);

  -- La proposition et ses refus.
  r := pg_temp.essayer(membre, format($q$select (proposer_lettre_de_mission(%L, %L, now())).id$q$, k, l1));
  perform pg_temp.noter(15, 'une proposition lue à une autre version se refuse', '22023:La lettre a changé depuis sa lecture', r);
  r := pg_temp.essayer(membre, format($q$select (proposer_lettre_de_mission(%L, %L, (select modifiee_le from lettres_de_mission where id = %L))).id$q$, k, l1, l1));
  perform pg_temp.noter(16, 'un modèle sans le texte du mandat de facturation se refuse', '22023:Le modèle ne porte pas le texte d''une clause', r);
  r := pg_temp.essayer(membre, format($q$select (enregistrer_brouillon_de_lettre(%L, %L, %L::jsonb, (select modifiee_le from lettres_de_mission where id = %L))).id$q$, k, l1, contenu || jsonb_build_object('modele_id', mb), l1));
  r := pg_temp.essayer(membre, format($q$select (proposer_lettre_de_mission(%L, %L, (select modifiee_le from lettres_de_mission where id = %L))).id$q$, k, l1, l1));
  perform pg_temp.noter(17, 'un modèle remplacé se refuse', '22023:Le modèle de la lettre a été remplacé ou retiré', r);
  contenu := contenu || jsonb_build_object('modele_id', mb2);
  r := pg_temp.essayer(membre, format($q$select (enregistrer_brouillon_de_lettre(%L, %L, %L::jsonb, (select modifiee_le from lettres_de_mission where id = %L))).id$q$, k, l1, contenu || '{"missions": ["tenue_comptable", "volet_social"]}', l1));
  r := pg_temp.essayer(membre, format($q$select (proposer_lettre_de_mission(%L, %L, (select modifiee_le from lettres_de_mission where id = %L))).id$q$, k, l1, l1));
  perform pg_temp.noter(18, 'une mission que le modèle ne décrit pas se refuse', '22023:Une mission de la lettre n''est pas décrite par son modèle.', r);
  r := pg_temp.essayer(membre, format($q$select (enregistrer_brouillon_de_lettre(%L, %L, %L::jsonb, (select modifiee_le from lettres_de_mission where id = %L))).id$q$, k, l1, contenu || '{"honoraires": [{"forme": "temps", "libelle": "Heure", "montant_ht": 90}]}', l1));
  r := pg_temp.essayer(membre, format($q$select (proposer_lettre_de_mission(%L, %L, (select modifiee_le from lettres_de_mission where id = %L))).id$q$, k, l1, l1));
  perform pg_temp.noter(19, 'le temps passé se refuse (LM9)', '22023:Le temps passé ne se facture pas encore', r);
  r := pg_temp.essayer(membre, format($q$select (enregistrer_brouillon_de_lettre(%L, %L, %L::jsonb, (select modifiee_le from lettres_de_mission where id = %L))).id$q$, k, l1, contenu || jsonb_build_object('signataire_compte', gen_random_uuid()), l1));
  r := pg_temp.essayer(membre, format($q$select (proposer_lettre_de_mission(%L, %L, (select modifiee_le from lettres_de_mission where id = %L))).id$q$, k, l1, l1));
  perform pg_temp.noter(20, 'un compte signataire qui n''est pas un accès du client se refuse', '22023:Le compte du signataire n''est pas un accès du dossier du client.', r);
  contenu := contenu || jsonb_build_object('signataire_compte', client);
  r := pg_temp.essayer(membre, format($q$select (enregistrer_brouillon_de_lettre(%L, %L, %L::jsonb, (select modifiee_le from lettres_de_mission where id = %L))).id$q$, k, l1, contenu || jsonb_build_object('dossier_client_id', c2), l1));
  r := pg_temp.essayer(membre, format($q$select (proposer_lettre_de_mission(%L, %L, (select modifiee_le from lettres_de_mission where id = %L))).id$q$, k, l1, l1));
  perform pg_temp.noter(21, 'un client sans adresse se refuse', '22023:L''adresse du client manque à son dossier', r);
  r := pg_temp.essayer(membre, format($q$select (enregistrer_brouillon_de_lettre(%L, %L, %L::jsonb, (select modifiee_le from lettres_de_mission where id = %L))).id$q$, k, l1, contenu, l1));
  r := pg_temp.essayer(membre, format($q$select (proposer_lettre_de_mission(%L, %L, (select modifiee_le from lettres_de_mission where id = %L))).id$q$, k, l1, l1));
  perform pg_temp.noter(22, 'le membre affecté propose la lettre (contrôle positif)', 'OK:' || l1, r);
  select l.*, empreinte_de_la_lettre(l) = l.empreinte as scelle into ligne from lettres_de_mission l where l.id = l1;
  perform pg_temp.noter(23, 'la proposition fige les copies lues par la base, les clauses exigées et l''empreinte que la base recalcule', 'figée',
    case when ligne.identite_client ->> 'nom' = 'ESSAI LM4 CLIENT' and ligne.identite_cabinet ->> 'siret' = '12345678200010'
              and ligne.clauses = array['mandat_de_facturation', 'sous_traitance'] and ligne.scelle
         then 'figée' else 'NON FIGÉE : ' || coalesce(ligne.empreinte, '∅') end);
  set local timezone = 'Pacific/Auckland';
  select empreinte_de_la_lettre(l) = l.empreinte into scelle from lettres_de_mission l where l.id = l1;
  perform pg_temp.noter(24, 'l''empreinte ne dépend pas du fuseau de la session', 'égale',
    case when scelle then 'égale' else 'DIFFÉRENTE' end);
  reset timezone;

  -- Une lettre proposée ne se réécrit plus.
  r := pg_temp.essayer(membre, format($q$select (enregistrer_brouillon_de_lettre(%L, %L, %L::jsonb, (select modifiee_le from lettres_de_mission where id = %L))).id$q$, k, l1, contenu, l1));
  perform pg_temp.noter(25, 'le brouillon d''une lettre proposée ne se réécrit plus', '22023:Cette lettre est proposée', r);
  r := pg_temp.essayer(null, format($q$update lettres_de_mission set missions = '{tenue_comptable}' where id = %L returning 1$q$, l1));
  perform pg_temp.noter(26, 'une lettre proposée ne se réécrit pas, même par le propriétaire', '23514:Une lettre de mission proposée ne se modifie plus', r);
  r := pg_temp.essayer(null, format($q$update lettres_de_mission set empreinte = repeat('0', 64) where id = %L returning 1$q$, l1));
  perform pg_temp.noter(27, 'son empreinte non plus', '23514:Une lettre de mission proposée ne se modifie plus', r);
  r := pg_temp.essayer(null, format($q$update lettres_de_mission set acceptee_le = now(), acceptee_par = %L, mode_acceptation = 'en_ligne', empreinte_acceptee = empreinte where id = %L returning 1$q$, client, l1));
  perform pg_temp.noter(28, 'l''acceptation en ligne se refuse, drapeau baissé, même au propriétaire', '23514:L''acceptation en ligne d''une lettre de mission n''est pas ouverte', r);
  r := pg_temp.essayer(super, format($q$insert into lettres_de_mission (dossier_id, dossier_client_id, modele_id, missions, repartition, honoraires, date_effet, premier_exercice, fin_initiale, signataire_nom, identite_client, identite_cabinet, clauses, empreinte, proposee_le, proposee_par, acceptee_le, acceptee_par, mode_acceptation, empreinte_acceptee, auteur) select dossier_id, dossier_client_id, modele_id, missions, repartition, honoraires, date_effet, premier_exercice, fin_initiale, signataire_nom, identite_client, identite_cabinet, clauses, empreinte, proposee_le, proposee_par, now(), %L, 'en_ligne', empreinte, auteur from lettres_de_mission where id = %L returning 1$q$, client, l1));
  perform pg_temp.noter(29, 'la restauration d''une acceptation en ligne se refuse aussi, drapeau baissé', '23514:L''acceptation en ligne d''une lettre de mission n''est pas ouverte', r);

  -- La réponse : le papier signé.
  r := pg_temp.essayer(membre, format($q$select (enregistrer_reponse_a_la_lettre(%L, %L, 'acceptee_sur_papier', %L, current_date)).id$q$, k, l1, dc));
  perform pg_temp.noter(30, 'un papier d''un autre dossier que celui du cabinet se refuse', '22023:Le papier signé est un document du dossier du cabinet.', r);
  r := pg_temp.essayer(membre, format($q$select (enregistrer_reponse_a_la_lettre(%L, %L, 'acceptee_sur_papier', %L, current_date)).id$q$, k, l1, dk0));
  perform pg_temp.noter(31, 'un papier sans empreinte se refuse', '22023:Le papier signé se cite par son empreinte', r);
  r := pg_temp.essayer(membre, format($q$select (enregistrer_reponse_a_la_lettre(%L, %L, 'acceptee_sur_papier', %L, ((now() at time zone 'Europe/Paris')::date + 1))).id$q$, k, l1, dk));
  perform pg_temp.noter(32, 'une signature datée de demain se refuse', '22023:La date de signature suit la proposition', r);
  r := pg_temp.essayer(membre, format($q$select (enregistrer_reponse_a_la_lettre(%L, %L, 'acceptee_sur_papier', %L, (now() at time zone 'Europe/Paris')::date)).mode_acceptation$q$, k, l1, dk));
  perform pg_temp.noter(33, 'le membre affecté enregistre l''acceptation sur papier (contrôle positif)', 'OK:papier', r);
  select * into ligne from lettres_de_mission where id = l1;
  perform pg_temp.noter(34, 'l''acceptation fige l''empreinte de la lettre et celle du papier', 'figée',
    case when ligne.empreinte_acceptee = ligne.empreinte and ligne.empreinte_papier = hash_dk then 'figée' else 'NON FIGÉE' end);
  r := pg_temp.essayer(membre, format($q$select (enregistrer_reponse_a_la_lettre(%L, %L, 'refusee', null, null)).id$q$, k, l1));
  perform pg_temp.noter(35, 'une lettre répondue ne reçoit pas d''autre réponse', '22023:Cette lettre a déjà sa réponse.', r);
  r := pg_temp.essayer(null, format($q$delete from documents_divers where id = %L returning 1$q$, dk));
  perform pg_temp.noter(36, 'le papier signé ne se supprime plus', '23503:', r);

  -- Les nouvelles versions, la version courante, le retrait.
  r := pg_temp.essayer(membre, format($q$select (enregistrer_brouillon_de_lettre(%L, null, %L::jsonb, null)).id$q$, k, contenu || jsonb_build_object('remplace_id', l1)));
  perform pg_temp.noter(37, 'un avenant remplace la lettre acceptée', 'OK:', r);
  l2 := substr(r, 4)::uuid;
  r := pg_temp.essayer(membre, format($q$select (enregistrer_brouillon_de_lettre(%L, null, %L::jsonb, null)).id$q$, k, contenu || jsonb_build_object('remplace_id', l1)));
  perform pg_temp.noter(38, 'une seule nouvelle version vivante', '22023:Cette lettre a déjà une nouvelle version en cours', r);
  r := pg_temp.essayer(membre, format($q$select (enregistrer_brouillon_de_lettre(%L, null, %L::jsonb, null)).id$q$, k, contenu || jsonb_build_object('remplace_id', l1, 'dossier_client_id', c2)));
  perform pg_temp.noter(39, 'une nouvelle version garde son client', '22023:Une nouvelle version garde le client', r);
  r := pg_temp.essayer(membre, format($q$select (retirer_lettre_de_mission(%L, %L, date '2027-06-30')).id$q$, k, l1));
  perform pg_temp.noter(40, 'la version qui a une suite vivante ne se retire pas', '22023:Cette lettre a une nouvelle version en cours', r);
  r := pg_temp.essayer(null, format($q$update lettres_de_mission set retiree_le = now(), retiree_par = %L, fin_au = date '2027-06-30' where id = %L returning 1$q$, membre, l1));
  perform pg_temp.noter(56, 'la garde aussi : la version qui a une suite vivante ne se retire pas, même par le propriétaire', '23514:Seule la version courante d''une lettre de mission', r);
  r := pg_temp.essayer(null, format($q$update lettres_de_mission set identite_client = '{}', identite_cabinet = '{}', clauses = '{}', empreinte = repeat('0', 64), proposee_le = now(), proposee_par = %L where id = %L returning 1$q$, membre, l2));
  perform pg_temp.noter(57, 'une proposition écrite à la main porte l''empreinte que la base calcule, ou se refuse', '23514:L''empreinte d''une lettre de mission est celle que la base calcule', r);
  r := pg_temp.essayer(membre, format($q$select (retirer_lettre_de_mission(%L, %L, date '2027-06-30')).id$q$, k, l2));
  perform pg_temp.noter(41, 'un brouillon se retire sans date', '22023:Seule une lettre acceptée se résilie à une date', r);
  r := pg_temp.essayer(membre, format($q$select (retirer_lettre_de_mission(%L, %L, null)).id$q$, k, l2));
  perform pg_temp.noter(42, 'le membre retire l''avenant en brouillon', 'OK:' || l2, r);
  r := pg_temp.essayer(membre, format($q$select (retirer_lettre_de_mission(%L, %L, null)).id$q$, k, l1));
  perform pg_temp.noter(43, 'une lettre acceptée se résilie à une date', '22023:Une lettre acceptée se résilie à une date', r);
  r := pg_temp.essayer(membre, format($q$select (retirer_lettre_de_mission(%L, %L, date '2027-06-30')).fin_au$q$, k, l1));
  perform pg_temp.noter(44, 'la lettre acceptée se résilie au 30/06/2027', 'OK:2027-06-30', r);
  r := pg_temp.essayer(null, format($q$delete from lettres_de_mission where id = %L returning 1$q$, l1));
  perform pg_temp.noter(45, 'une lettre ne se supprime pas, même par le propriétaire', '23514:Une lettre de mission ne se supprime pas', r);

  -- Qui lit, la porte de la restauration, la désignation.
  r := pg_temp.essayer(membre, format($q$select count(*) from lettres_de_mission where dossier_id = %L$q$, k));
  perform pg_temp.noter(46, 'le membre affecté au dossier du cabinet lit ses lettres (LM-Q2)', 'OK:2', r);
  r := pg_temp.essayer(client, format($q$select count(*) || '/' || (select count(*) from modeles_lettre_de_mission where dossier_id = %L) from lettres_de_mission where dossier_id = %L$q$, k, k));
  perform pg_temp.noter(47, 'le client ne lit ni les lettres ni les modèles', 'OK:0/0', r);
  r := pg_temp.essayer('anon', format($q$select count(*) from lettres_de_mission where dossier_id = %L$q$, k));
  perform pg_temp.noter(48, 'l''anonyme ne lit rien', 'OK:0', r);
  r := pg_temp.essayer(membre, format($q$insert into lettres_de_mission (dossier_id, auteur) values (%L, %L) returning 1$q$, k, membre));
  perform pg_temp.noter(49, 'un membre n''insère pas directement (la porte de la restauration est au super-administrateur)', '42501', r);
  r := pg_temp.essayer(super, format($q$insert into lettres_de_mission (dossier_id, dossier_client_id, modele_id, missions, repartition, honoraires, date_effet, premier_exercice, fin_initiale, signataire_nom, identite_client, identite_cabinet, clauses, empreinte, proposee_le, proposee_par, auteur) select dossier_id, dossier_client_id, modele_id, missions, repartition, honoraires, date_effet, premier_exercice, fin_initiale, signataire_nom, identite_client, identite_cabinet, clauses, empreinte, proposee_le, proposee_par, auteur from lettres_de_mission where id = %L returning 1$q$, l1));
  perform pg_temp.noter(50, 'le super-administrateur restaure une lettre proposée, telle qu''écrite', 'OK:1', r);
  r := pg_temp.essayer(super, format($q$select designer_dossier_du_cabinet(%L, null)$q$, cabinet));
  perform pg_temp.noter(51, 'le dossier du cabinet qui porte des lettres ne change plus de désignation', '23514:Le dossier du cabinet porte des lettres de mission', r);

  -- Le catalogue.
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and p.proname in ('enregistrer_modele_de_lettre', 'retirer_modele_de_lettre', 'enregistrer_brouillon_de_lettre',
                       'proposer_lettre_de_mission', 'enregistrer_reponse_a_la_lettre', 'retirer_lettre_de_mission')
     and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
     and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=public%';
  perform pg_temp.noter(52, 'les six fonctions : security definer, search_path fixé, authenticated seul', '6', n::text);
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('empreinte_de_la_lettre', 'garder_modele_de_lettre', 'garder_lettre_de_mission', 'garder_designation_des_lettres')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  perform pg_temp.noter(53, 'l''empreinte et les gardes : aucun rôle de session', '0', n::text);
  perform pg_temp.noter(54, 'le drapeau de l''acceptation en ligne est baissé', 'false', acceptation_en_ligne_ouverte()::text);

  -- En dernier : le dossier du cabinet supprimé par le super-administrateur emporte ses modèles et ses lettres.
  r := pg_temp.essayer(super, format($q$delete from dossiers where id = %L returning 1$q$, k));
  select count(*) into n from lettres_de_mission where dossier_id = k;
  perform pg_temp.noter(55, 'la suppression du dossier du cabinet emporte ses lettres et ses modèles', 'OK:1 0/0',
    r || ' ' || n || '/' || (select count(*) from modeles_lettre_de_mission where dossier_id = k));
end
$essai$;

select case when ok then 'OK  ' else 'FAUX' end || ' ' || lpad(rang::text, 2) || '. ' || controle
       || case when ok then '' else ' — attendu « ' || attendu || ' », observé « ' || observe || ' »' end as ligne
  from essai_lm order by rang, controle;
select count(*) filter (where not ok) || ' en faute / ' || count(*) || ' étapes' as bilan from essai_lm;
rollback;
