-- « À FACTURER » ET LES FACTURES D'HONORAIRES (ligne 47, lot LM7 ; la migration `honoraires_factures`, PRÉPARÉE le
-- 11/11/2026, supabase/preparees/20261111180000_honoraires_factures.sql, après `dossier_du_cabinet` (LM1) et
-- `lettres_de_mission` (LM4)). Le récit : HISTORIQUE.md, « 11/11/2026 — LM7 ».
-- SUR UNE RÉPLIQUE SEULEMENT : il désigne le dossier du cabinet de la réplique, y valide des factures et supprime un
-- brouillon. À rejouer, par psql (`-f`, pas `-1` : le fichier ouvre et ANNULE sa propre transaction), après toute
-- migration qui touche la table, sa fonction, `enregistrer_facture`, `supprimer_brouillon_facture`, les avoirs, les
-- lettres de mission ou la désignation du dossier du cabinet. La course de deux sessions se joue à part (deux psql).
--
-- Ce qui se prouve ici : qui facture (l'accès d'abord : ni l'anonyme, ni un membre que le dossier du cabinet n'a pas, ni
-- le client ; puis le dossier du cabinet seul) ; les refus de `facturer_honoraires`, dans leur ordre, à leurs mots et à
-- leurs codes ; le brouillon composé (le client lu de son dossier, l'émetteur du dossier du cabinet, une ligne par
-- période au montant figé par la lettre, les totaux au centime, la période) et ses liens ; une période ne se facture
-- qu'une fois — le brouillon la tient, sa suppression la rend, la facture validée la tient, un avoir partiel la laisse
-- facturée, l'avoir qui crédite le reste la rend (la facturation suivante) ; la lettre en vigueur (l'avenant remplace,
-- la résiliation arrête, le premier exercice borne) ; la même période d'une autre version de la lettre ; la garde pour
-- tout auteur (ni avoir, ni autre dossier, un seul client, ni modification ni retrait, la contrainte totale) ; qui lit ;
-- la porte de la restauration au super-administrateur ; le catalogue.
--
-- Le jeu, inséré par le propriétaire : au cabinet de la réplique, le dossier du cabinet K (SIRET, adresse, redevable de
-- la TVA), deux dossiers clients C (SIRET, adresse) et C2 ; des lettres ACCEPTÉES sur papier (un document de K), écrites
-- comme une restauration les réinsère : L1 (C, du 01/01/2026 : un forfait mensuel, la 2035, un forfait trimestriel, une
-- tâche « autre »), L2 (C2, un forfait annuel), L3 (C, proposée seulement), L4 (C, résiliée au 15/03/2026) ; puis, en
-- cours d'essai, L1B, l'avenant de L1 (C, d'effet au 01/07/2026). Le membre de l'équipe de la réplique est affecté à K.
-- Sans la migration, une ligne dit qu'il attend (EN ATTENTE). Une garde de tête refuse de le jouer hors d'une réplique
-- (ESSAI_HORS_REPLIQUE), avant toute écriture.
begin;
create temp table essai_hf (rang int, controle text, attendu text, observe text, ok boolean) on commit drop;

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
language sql as $f$ insert into essai_hf values (p_rang, p_controle, p_attendu, p_observe, p_observe like p_attendu || '%') $f$;

-- L'identifiant qu'un appel réussi rend ; nul sinon (l'étape qui le suit le dira FAUX, l'essai ne s'arrête pas).
create function pg_temp.id(r text) returns uuid language sql as $f$
  select case when r ~ '^OK:[0-9a-f-]{36}$' then substr(r, 4)::uuid end $f$;

-- Un élément à facturer.
create function pg_temp.el(l uuid, ligne int, debut text, fin text) returns jsonb language sql as $f$
  select jsonb_build_object('lettre_id', l, 'ligne', ligne, 'periode_debut', debut, 'periode_fin', fin) $f$;

-- L'appel de la fonction, en texte, pour `essayer`.
create function pg_temp.facturer(k uuid, elements jsonb, taux numeric default 20, facture jsonb default null) returns text
language sql as $f$ select format('select facturer_honoraires(%L, %L::jsonb, %s, %L::jsonb)::text', k, elements, taux, facture) $f$;

do $essai$
declare
  cabinet constant uuid := 'cab10000-0000-4000-8000-000000000001';
  k constant uuid := '1b700000-0000-4000-8000-0000000000a1';
  c constant uuid := '1b700000-0000-4000-8000-0000000000c1';
  c2 constant uuid := '1b700000-0000-4000-8000-0000000000c2';
  dk constant uuid := '1b700000-0000-4000-8000-0000000000d1';
  l1 constant uuid := '1b700000-0000-4000-8000-0000000000e1';
  l2 constant uuid := '1b700000-0000-4000-8000-0000000000e2';
  l3 constant uuid := '1b700000-0000-4000-8000-0000000000e3';
  l4 constant uuid := '1b700000-0000-4000-8000-0000000000e4';
  l1b constant uuid := '1b700000-0000-4000-8000-0000000000e5';
  super constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  membre constant text := '3e3b0000-0000-4000-8000-000000000001';
  hash_dk constant text := repeat('ab', 32);
  h1 constant jsonb := '[{"forme": "forfait", "libelle": "Tenue mensuelle", "montant_ht": 150, "periodicite": "mois"},
                         {"forme": "tache", "libelle": "Déclaration 2035", "montant_ht": 600, "livrable": "declaration_2035"},
                         {"forme": "forfait", "libelle": "Forfait social", "montant_ht": 300, "periodicite": "trimestre"},
                         {"forme": "tache", "libelle": "Conseil", "montant_ht": 80, "livrable": "autre"}]';
  h1b constant jsonb := '[{"forme": "forfait", "libelle": "Tenue mensuelle (avenant)", "montant_ht": 160, "periodicite": "mois"},
                          {"forme": "tache", "libelle": "Déclaration 2035", "montant_ht": 650, "livrable": "declaration_2035"},
                          {"forme": "tache", "libelle": "Conseil", "montant_ht": 90, "livrable": "autre"}]';
  futur date := (date_trunc('month', (now() at time zone 'Europe/Paris')::date + 62))::date;
  r text;
  n int;
  f1 uuid; f2 uuid; f3 uuid; f4 uuid; f5 uuid; fc uuid;
  ligne record;
begin
  if not exists (select 1 from pg_roles where rolname = 'proprietaire') then
    raise exception 'ESSAI_HORS_REPLIQUE : cet essai désigne le dossier du cabinet, y valide des factures et supprime un brouillon ; il ne se joue que sur une réplique ; le rôle proprietaire, que toute réplique porte, est absent : rien n''est écrit.';
  end if;
  if to_regclass('public.honoraires_factures') is null then
    insert into essai_hf values (0, 'HF. les factures d''honoraires : EN ATTENTE de la migration honoraires_factures', 'la migration', 'absente', true);
    return;
  end if;

  insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, siret, adresse, statut_tva) values
    (k, 'ESSAI LM7 CABINET', cabinet, 'tresorerie', '455000', '12345678200010', 'ESSAI LM7 ADRESSE DU CABINET', 'redevable'),
    (c, 'ESSAI LM7 CLIENT', cabinet, 'tresorerie', '455000', '98765432100017', 'ESSAI LM7 ADRESSE DU CLIENT', null),
    (c2, 'ESSAI LM7 SECOND CLIENT', cabinet, 'tresorerie', '455000', null, 'ESSAI LM7 AILLEURS', null);
  insert into documents_divers (id, dossier_id, storage_path, nom_fichier, categorie, storage_hash) values
    (dk, k, k || '/divers/signee.pdf', 'signee.pdf', 'autre', hash_dk);
  insert into memberships (user_id, dossier_id, role, email) values (client::uuid, c, 'client', 'essai-lm7@example.test');
  r := pg_temp.essayer(super, format($q$select designer_dossier_du_cabinet(%L, %L)$q$, cabinet, k));
  perform pg_temp.noter(1, 'le chef désigne le dossier du cabinet (LM1)', 'OK:' || k, r);
  -- Les lettres acceptées, telles qu'une restauration les réinsère (la garde de LM4 accepte l'histoire écrite).
  insert into lettres_de_mission (id, dossier_id, dossier_client_id, missions, honoraires, date_effet, premier_exercice,
      fin_initiale, reconduction_tacite, signataire_nom, identite_client, identite_cabinet, clauses, empreinte, proposee_le,
      proposee_par, acceptee_le, acceptee_par, mode_acceptation, empreinte_acceptee, document_signe_id, empreinte_papier,
      signee_le, retiree_le, retiree_par, fin_au, auteur)
  values
    (l1, k, c, '{tenue_comptable}', h1, '2026-01-01', 2026, '2026-12-31', true, 'Signataire', '{}', '{}', '{sous_traitance}',
     repeat('1', 64), '2025-12-01', super::uuid, '2025-12-05', super::uuid, 'papier', repeat('1', 64), dk, hash_dk, '2025-12-04',
     null, null, null, super::uuid),
    (l2, k, c2, '{tenue_comptable}', '[{"forme": "forfait", "libelle": "Forfait annuel", "montant_ht": 1200, "periodicite": "annee"}]',
     '2026-01-01', 2026, '2026-12-31', true, 'Signataire', '{}', '{}', '{sous_traitance}', repeat('2', 64), '2025-12-01', super::uuid,
     '2025-12-05', super::uuid, 'papier', repeat('2', 64), dk, hash_dk, '2025-12-04', null, null, null, super::uuid),
    (l4, k, c, '{tenue_comptable}', h1, '2026-01-01', 2026, '2026-12-31', true, 'Signataire', '{}', '{}', '{sous_traitance}',
     repeat('4', 64), '2025-12-01', super::uuid, '2025-12-05', super::uuid, 'papier', repeat('4', 64), dk, hash_dk, '2025-12-04',
     '2026-03-01', super::uuid, '2026-03-15', super::uuid);
  insert into lettres_de_mission (id, dossier_id, dossier_client_id, missions, honoraires, date_effet, premier_exercice,
      fin_initiale, signataire_nom, identite_client, identite_cabinet, clauses, empreinte, proposee_le, proposee_par, auteur)
  values (l3, k, c, '{tenue_comptable}', h1, '2026-01-01', 2026, '2026-12-31', 'Signataire', '{}', '{}', '{sous_traitance}',
          repeat('3', 64), '2025-12-01', super::uuid, super::uuid);

  -- L'accès, d'abord ; puis le dossier du cabinet.
  r := pg_temp.essayer('anon', pg_temp.facturer(k, jsonb_build_array(pg_temp.el(l1, 1, '2026-01-01', '2026-01-31'))));
  perform pg_temp.noter(2, 'l''anonyme n''exécute pas la fonction', '42501', r);
  r := pg_temp.essayer(membre, pg_temp.facturer(k, jsonb_build_array(pg_temp.el(l1, 1, '2026-01-01', '2026-01-31'))));
  perform pg_temp.noter(3, 'un membre que le dossier du cabinet n''a pas est refusé', '42501:Accès refusé à ce dossier.', r);
  r := pg_temp.essayer(client, pg_temp.facturer(k, jsonb_build_array(pg_temp.el(l1, 1, '2026-01-01', '2026-01-31'))));
  perform pg_temp.noter(4, 'le client est refusé', '42501:Accès refusé à ce dossier.', r);
  r := pg_temp.essayer(super, pg_temp.facturer(c, jsonb_build_array(pg_temp.el(l1, 1, '2026-01-01', '2026-01-31'))));
  perform pg_temp.noter(5, 'un dossier qui n''est pas le dossier du cabinet est refusé', '23514:Les honoraires se facturent dans le dossier du cabinet.', r);
  insert into dossier_assignations (dossier_id, user_id) values (k, membre::uuid);

  -- Les refus de forme, avant toute lecture des lettres.
  r := pg_temp.essayer(membre, pg_temp.facturer(k, '[]'));
  perform pg_temp.noter(6, 'aucun élément se refuse', '22023:Une facture d''honoraires porte de une à cinquante périodes ou tâches.', r);
  r := pg_temp.essayer(membre, pg_temp.facturer(k, jsonb_build_array(pg_temp.el(l1, 1, '2026-01-01', '2026-01-31') || '{"montant_ht": 1}')));
  perform pg_temp.noter(7, 'un élément à clé de plus (un montant donné par l''appelant) se refuse', '22023:Un élément à facturer se lit', r);
  r := pg_temp.essayer(membre, pg_temp.facturer(k, jsonb_build_array(pg_temp.el(l1, 1, '2026-02-30', '2026-03-31'))));
  perform pg_temp.noter(8, 'une date impossible se refuse', '22023:Un élément à facturer se lit', r);
  r := pg_temp.essayer(membre, pg_temp.facturer(k, jsonb_build_array(pg_temp.el(l1, 1, '2026-01-01', '2026-01-31')), 5.5));
  perform pg_temp.noter(9, 'un taux de 5,5 % se refuse', '22023:Le taux de TVA des honoraires est de 20 %, de 8,5 %', r);
  r := pg_temp.essayer(membre, pg_temp.facturer(k, jsonb_build_array(pg_temp.el(l1, 1, '2026-01-01', '2026-01-31')), 20, '{"tiers_nom": "Autre"}'));
  perform pg_temp.noter(10, 'le client donné par l''appelant se refuse (LM-Q3)', '22023:La facture ne reçoit ici que son échéance', r);
  r := pg_temp.essayer(membre, pg_temp.facturer(k, jsonb_build_array(pg_temp.el(l1, 1, '2026-01-01', '2026-01-31'), pg_temp.el(l1, 1, '2026-01-01', '2026-01-31'))));
  perform pg_temp.noter(11, 'un élément en double se refuse', '22023:Un élément à facturer figure deux fois dans la demande.', r);

  -- Élément par élément.
  r := pg_temp.essayer(membre, pg_temp.facturer(k, jsonb_build_array(pg_temp.el(gen_random_uuid(), 1, '2026-01-01', '2026-01-31'))));
  perform pg_temp.noter(12, 'une lettre introuvable se refuse', 'P0002:Lettre de mission introuvable dans ce dossier.', r);
  r := pg_temp.essayer(membre, pg_temp.facturer(k, jsonb_build_array(pg_temp.el(l3, 1, '2026-01-01', '2026-01-31'))));
  perform pg_temp.noter(13, 'une lettre proposée, pas acceptée, se refuse', '22023:Une lettre de mission se facture une fois acceptée.', r);
  r := pg_temp.essayer(membre, pg_temp.facturer(k, jsonb_build_array(pg_temp.el(l1, 1, '2026-01-01', '2026-01-31'), pg_temp.el(l2, 1, '2026-01-01', '2026-12-31'))));
  perform pg_temp.noter(14, 'deux clients dans une facture se refusent', '22023:Une facture d''honoraires s''adresse à un seul client.', r);
  r := pg_temp.essayer(membre, pg_temp.facturer(k, jsonb_build_array(pg_temp.el(l1, 9, '2026-01-01', '2026-01-31'))));
  perform pg_temp.noter(15, 'une ligne introuvable se refuse', '22023:Ligne d''honoraires introuvable dans la lettre.', r);
  r := pg_temp.essayer(membre, pg_temp.facturer(k, jsonb_build_array(pg_temp.el(l1, 1, '2026-01-02', '2026-02-01'))));
  perform pg_temp.noter(16, 'un mois qui n''est pas civil se refuse', '22023:Une période de forfait est un mois, un trimestre ou une année civils', r);
  r := pg_temp.essayer(membre, pg_temp.facturer(k, jsonb_build_array(pg_temp.el(l1, 3, '2026-02-01', '2026-04-30'))));
  perform pg_temp.noter(17, 'un trimestre qui n''est pas civil se refuse', '22023:Une période de forfait est un mois, un trimestre ou une année civils', r);
  r := pg_temp.essayer(membre, pg_temp.facturer(k, jsonb_build_array(pg_temp.el(l1, 2, '2026-01-01', '2027-01-01'))));
  perform pg_temp.noter(18, 'une tâche sur plus d''un an se refuse', '22023:La période d''une tâche tient en un an au plus', r);
  r := pg_temp.essayer(membre, pg_temp.facturer(k, jsonb_build_array(pg_temp.el(l1, 1, futur::text, ((futur + interval '1 month')::date - 1)::text))));
  perform pg_temp.noter(19, 'un mois pas commencé se refuse', '22023:Une période ne se facture pas avant d''avoir commencé.', r);
  r := pg_temp.essayer(membre, pg_temp.facturer(k, jsonb_build_array(pg_temp.el(l4, 1, '2026-04-01', '2026-04-30'))));
  perform pg_temp.noter(20, 'un mois après la résiliation se refuse', '22023:La lettre n''est pas en vigueur pour cette période.', r);
  r := pg_temp.essayer(membre, pg_temp.facturer(k, jsonb_build_array(pg_temp.el(l4, 1, '2026-03-01', '2026-03-31'))));
  perform pg_temp.noter(21, 'le mois de la résiliation, la lettre close avant son dernier jour, se refuse', '22023:La lettre n''est pas en vigueur pour cette période.', r);
  r := pg_temp.essayer(membre, pg_temp.facturer(k, jsonb_build_array(pg_temp.el(l1, 2, '2025-01-01', '2025-12-31'))));
  perform pg_temp.noter(22, 'une tâche d''avant le premier exercice se refuse', '22023:La lettre n''est pas en vigueur pour cette période.', r);

  -- Le brouillon : composé de la lettre et des deux dossiers ; ses liens.
  r := pg_temp.essayer(membre, pg_temp.facturer(k, jsonb_build_array(pg_temp.el(l1, 1, '2026-01-01', '2026-01-31'), pg_temp.el(l1, 3, '2026-01-01', '2026-03-31')), 20, '{"tiers_email": "client@example.test", "date_echeance": "2026-12-31"}'));
  perform pg_temp.noter(23, 'le membre affecté facture janvier et le premier trimestre (contrôle positif)', 'OK:', r);
  f1 := pg_temp.id(r);
  select f.* into ligne from factures_emises f where f.id = f1;
  perform pg_temp.noter(24, 'le brouillon : le client de son dossier, l''émetteur du dossier du cabinet, les totaux, la période, l''échéance', 'composé',
    case when ligne.statut = 'brouillon' and ligne.tiers_nom = 'ESSAI LM7 CLIENT' and ligne.tiers_siret = '98765432100017'
              and ligne.tiers_siren = '987654321' and ligne.tiers_adresse = 'ESSAI LM7 ADRESSE DU CLIENT' and ligne.type_client = 'assujetti'
              and ligne.emetteur_nom = 'ESSAI LM7 CABINET' and ligne.emetteur_siret = '12345678200010'
              and ligne.montant_ht = 450 and ligne.montant_tva = 90 and ligne.montant_ttc = 540
              and ligne.periode_debut = '2026-01-01' and ligne.periode_fin = '2026-03-31' and ligne.nature_operation = 'services'
              and ligne.tiers_email = 'client@example.test' and ligne.date_echeance = '2026-12-31' and ligne.dossier_id = k
         then 'composé' else 'MAL COMPOSÉ : ' || row_to_json(ligne)::text end);
  select string_agg(fl.designation || ' ' || fl.quantite || '×' || fl.prix_unitaire_ht || ' ' || fl.taux_tva || '%', ' | ' order by fl.ordre)
    into r from facture_lignes fl where fl.facture_id = f1;
  perform pg_temp.noter(25, 'une ligne par période, au libellé et au montant figés par la lettre', 'Tenue mensuelle — janvier 2026 1×150 20% | Forfait social — 1er trimestre 2026 1×300 20%', r);
  select count(*) into n from honoraires_factures where facture_id = f1 and facturation = 1 and auteur = membre::uuid and dossier_id = k;
  perform pg_temp.noter(26, 'deux liens, première facturation, à l''auteur', '2', n::text);
  r := pg_temp.essayer(membre, pg_temp.facturer(k, jsonb_build_array(pg_temp.el(l1, 1, '2026-01-01', '2026-01-31'))));
  perform pg_temp.noter(27, 'le brouillon tient sa période : la facturer de nouveau se refuse', '23514:Cette période est déjà facturée', r);
  r := pg_temp.essayer(membre, format($q$select supprimer_brouillon_facture(%L, %L)::text$q$, k, f1));
  select count(*) into n from honoraires_factures where facture_id = f1;
  perform pg_temp.noter(28, 'le brouillon supprimé emporte ses liens', 'OK:' || f1 || ' 0', r || ' ' || n);

  -- La facture validée tient sa période ; un avoir partiel la laisse facturée ; l'avoir du reste la rend.
  r := pg_temp.essayer(membre, pg_temp.facturer(k, jsonb_build_array(pg_temp.el(l1, 1, '2026-01-01', '2026-01-31'))));
  f2 := pg_temp.id(r);
  r := pg_temp.essayer(membre, format($q$select numero from enregistrer_facture(%L, %L, (select to_jsonb(f) from factures_emises f where f.id = %L),
         (select jsonb_agg(jsonb_build_object('designation', designation, 'quantite', quantite, 'prix_unitaire_ht', prix_unitaire_ht,
                 'taux_tva', taux_tva, 'unite', unite, 'nature', nature) order by ordre) from facture_lignes where facture_id = %L), true)$q$, k, f2, f2, f2));
  perform pg_temp.noter(29, 'la facture de janvier se valide comme toute facture', 'OK:F2026-', r);
  r := pg_temp.essayer(membre, pg_temp.facturer(k, jsonb_build_array(pg_temp.el(l1, 1, '2026-01-01', '2026-01-31'))));
  perform pg_temp.noter(30, 'validée, elle tient sa période', '23514:Cette période est déjà facturée', r);
  r := pg_temp.essayer(membre, format($q$select numero from enregistrer_facture(%L, null, '{"type": "avoir", "facture_origine_id": "%s", "montant_ht": -50, "montant_tva": -10, "montant_ttc": -60}'::jsonb,
         '[{"designation": "Geste", "quantite": -1, "prix_unitaire_ht": 50, "taux_tva": 20, "unite": "C62", "nature": "services"}]'::jsonb, true)$q$, k, f2));
  perform pg_temp.noter(31, 'un avoir partiel se crée', 'OK:', r);
  r := pg_temp.essayer(membre, pg_temp.facturer(k, jsonb_build_array(pg_temp.el(l1, 1, '2026-01-01', '2026-01-31'))));
  perform pg_temp.noter(32, 'un avoir partiel laisse la période facturée', '23514:Cette période est déjà facturée', r);
  r := pg_temp.essayer(membre, format($q$select numero from enregistrer_facture(%L, null, '{"type": "avoir", "facture_origine_id": "%s", "montant_ht": -100, "montant_tva": -20, "montant_ttc": -120}'::jsonb,
         '[{"designation": "Annulation", "quantite": -1, "prix_unitaire_ht": 100, "taux_tva": 20, "unite": "C62", "nature": "services"}]'::jsonb, true)$q$, k, f2));
  perform pg_temp.noter(33, 'l''avoir du reste crédite la facture en entier', 'OK:', r || ' ' || facture_creditee_en_entier(f2));
  r := pg_temp.essayer(membre, pg_temp.facturer(k, jsonb_build_array(pg_temp.el(l1, 1, '2026-01-01', '2026-01-31'))));
  f3 := pg_temp.id(r);
  select facturation into n from honoraires_factures where facture_id = f3;
  perform pg_temp.noter(34, 'la facture créditée en entier rend la période : sa seconde facturation', 'OK: 2', substr(r, 1, 3) || ' ' || n);

  -- L'avenant : la même période d'une autre version de la lettre.
  r := pg_temp.essayer(membre, pg_temp.facturer(k, jsonb_build_array(pg_temp.el(l1, 1, '2026-08-01', '2026-08-31'), pg_temp.el(l1, 4, '2026-06-15', '2026-06-15'))));
  perform pg_temp.noter(35, 'août et un conseil du 15 juin, sous la lettre d''avant l''avenant', 'OK:', r);
  f4 := pg_temp.id(r);
  insert into lettres_de_mission (id, dossier_id, dossier_client_id, remplace_id, missions, honoraires, date_effet, premier_exercice,
      fin_initiale, reconduction_tacite, signataire_nom, identite_client, identite_cabinet, clauses, empreinte, proposee_le,
      proposee_par, acceptee_le, acceptee_par, mode_acceptation, empreinte_acceptee, document_signe_id, empreinte_papier,
      signee_le, auteur)
  values (l1b, k, c, l1, '{tenue_comptable}', h1b, '2026-07-01', 2026, '2027-06-30', true, 'Signataire', '{}', '{}', '{sous_traitance}',
          repeat('5', 64), '2026-09-01', super::uuid, '2026-09-10', super::uuid, 'papier', repeat('5', 64), dk, hash_dk, '2026-09-09', super::uuid);
  r := pg_temp.essayer(membre, pg_temp.facturer(k, jsonb_build_array(pg_temp.el(l1, 1, '2026-09-01', '2026-09-30'))));
  perform pg_temp.noter(36, 'l''avenant remplace la lettre d''avant : septembre ne se facture plus sous elle', '22023:La lettre n''est pas en vigueur pour cette période.', r);
  r := pg_temp.essayer(membre, pg_temp.facturer(k, jsonb_build_array(pg_temp.el(l1b, 1, '2026-08-01', '2026-08-31'))));
  perform pg_temp.noter(37, 'août, facturé sous la version d''avant, ne se facture pas sous l''avenant', '23514:Cette période est déjà facturée', r);
  r := pg_temp.essayer(membre, pg_temp.facturer(k, jsonb_build_array(pg_temp.el(l1b, 1, '2026-09-01', '2026-09-30'), pg_temp.el(l1b, 2, '2026-01-01', '2026-12-31'), pg_temp.el(l1b, 3, '2026-06-15', '2026-06-15'))));
  perform pg_temp.noter(38, 'septembre, la 2035 de 2026 et un autre conseil du 15 juin sous l''avenant (une tâche « autre » ne se compare pas d''une version à l''autre)', 'OK:', r);
  f5 := pg_temp.id(r);
  select string_agg(fl.designation, ' | ' order by fl.ordre) into r from facture_lignes fl where fl.facture_id = f5;
  perform pg_temp.noter(39, 'les libellés : le mois, l''exercice d''une tâche annuelle, le jour', 'Tenue mensuelle (avenant) — septembre 2026 | Déclaration 2035 — exercice 2026 | Conseil — le 15/06/2026', r);

  -- La garde, pour tout auteur (le propriétaire sans session).
  r := pg_temp.essayer(null, format($q$insert into honoraires_factures (dossier_id, facture_id, lettre_id, ligne, periode_debut, periode_fin, auteur) values (%L, %L, %L, 2, '2026-01-01', '2026-12-31', %L) returning 1$q$, k, f4, l1, super));
  perform pg_temp.noter(40, 'la 2035 de 2026 sous la version d''avant, déjà facturée sous l''avenant : la garde la refuse', '23514:Cette période est déjà facturée', r);
  r := pg_temp.essayer(null, format($q$insert into honoraires_factures (dossier_id, facture_id, lettre_id, ligne, periode_debut, periode_fin, auteur) values (%L, (select id from factures_emises where facture_origine_id = %L limit 1), %L, 1, '2026-10-01', '2026-10-31', %L) returning 1$q$, k, f2, l1b, super));
  perform pg_temp.noter(41, 'un avoir ne facture pas une période', '23514:Une facture d''honoraires est une facture du dossier du cabinet, ni un avoir ni un acompte.', r);
  r := pg_temp.essayer(null, format($q$insert into honoraires_factures (dossier_id, facture_id, lettre_id, ligne, periode_debut, periode_fin, auteur) values (%L, %L, %L, 1, '2026-01-01', '2026-12-31', %L) returning 1$q$, k, f4, l2, super));
  perform pg_temp.noter(42, 'une facture d''un client ne facture pas un autre client', '23514:Une facture d''honoraires s''adresse à un seul client.', r);
  r := pg_temp.essayer(null, format($q$insert into honoraires_factures (dossier_id, facture_id, lettre_id, ligne, periode_debut, periode_fin, auteur) values (%L, %L, %L, 1, '2026-10-02', '2026-11-01', %L) returning 1$q$, k, f4, l1b, super));
  perform pg_temp.noter(43, 'la garde juge la forme de la période d''un forfait', '23514:Une période de forfait est un mois', r);
  r := pg_temp.essayer(null, format($q$insert into honoraires_factures (dossier_id, facture_id, lettre_id, ligne, periode_debut, periode_fin, auteur) values (%L, %L, %L, 1, '2026-10-01', '2026-10-31', %L) returning 1$q$, k, f4, l3, super));
  perform pg_temp.noter(44, 'la garde refuse une lettre qui n''est pas acceptée', '23514:Une lettre de mission se facture une fois acceptée.', r);
  r := pg_temp.essayer(null, format($q$update honoraires_factures set periode_debut = '2026-10-01', periode_fin = '2026-10-31' where facture_id = %L returning 1$q$, f5));
  perform pg_temp.noter(45, 'un lien ne se modifie pas, même par le propriétaire', '23514:Le lien d''une facture d''honoraires ne se modifie pas.', r);
  r := pg_temp.essayer(null, format($q$delete from honoraires_factures where facture_id = %L returning 1$q$, f5));
  perform pg_temp.noter(46, 'un lien ne se retire pas, même par le propriétaire', '23514:Le lien d''une facture d''honoraires ne se retire pas', r);
  r := pg_temp.essayer(null, format($q$insert into honoraires_factures (dossier_id, facture_id, lettre_id, ligne, periode_debut, periode_fin, facturation, auteur) values (%L, %L, %L, 1, '2026-01-01', '2026-01-31', 1, %L) returning 1$q$, k, f2, l1, super));
  perform pg_temp.noter(47, 'la contrainte totale : la même facturation de la même période deux fois', '23505:', r);

  -- Qui écrit directement, qui lit, la restauration.
  r := pg_temp.essayer(membre, format($q$insert into honoraires_factures (dossier_id, facture_id, lettre_id, ligne, periode_debut, periode_fin, auteur) values (%L, %L, %L, 1, '2026-10-01', '2026-10-31', %L) returning 1$q$, k, f5, l1b, membre));
  perform pg_temp.noter(48, 'le membre n''insère pas directement (la fonction écrit)', '42501', r);
  r := pg_temp.essayer(super, format($q$insert into honoraires_factures (dossier_id, facture_id, lettre_id, ligne, periode_debut, periode_fin, facturation, auteur) values (%L, %L, %L, 1, '2026-01-01', '2026-01-31', 3, %L) returning 1$q$, k, f2, l1, super));
  perform pg_temp.noter(49, 'la restauration réinsère un lien d''une facture créditée (le super-administrateur)', 'OK:1', r);
  r := pg_temp.essayer(membre, format($q$select count(*)::text from honoraires_factures where dossier_id = %L$q$, k));
  perform pg_temp.noter(50, 'le membre affecté lit les liens du dossier du cabinet (2 de janvier sous la facture créditée, 1 sous la suivante, 2 sous août, 3 sous septembre)', 'OK:8', r);
  r := pg_temp.essayer(client, format($q$select count(*)::text from honoraires_factures where dossier_id = %L$q$, k));
  perform pg_temp.noter(51, 'le client ne lit rien', 'OK:0', r);
  r := pg_temp.essayer(gen_random_uuid()::text, format($q$select count(*)::text from honoraires_factures where dossier_id = %L$q$, k));
  perform pg_temp.noter(52, 'un compte rattaché à rien ne lit rien', 'OK:0', r);

  -- Le catalogue.
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname = 'facturer_honoraires'
     and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
     and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=public%';
  perform pg_temp.noter(53, 'la fonction : security definer, search_path fixé, authenticated seul', '1', n::text);
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'garder_honoraires_factures'
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  perform pg_temp.noter(54, 'la garde : aucun rôle de session', '0', n::text);
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and not p.prosecdef
     and p.proname in ('periode_de_forfait_valide', 'lettre_en_vigueur_le', 'facture_creditee_en_entier', 'racine_de_la_lettre')
     and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute');
  perform pg_temp.noter(55, 'les quatre contrôles : aux droits de l''appelant, authenticated seul', '4', n::text);
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'honoraires_factures'
     and roles = '{authenticated}' and cmd in ('SELECT', 'INSERT');
  perform pg_temp.noter(56, 'deux policies to authenticated, lecture et restauration', '2', n::text
    || case when (select count(*) from pg_policies where schemaname = 'public' and tablename = 'honoraires_factures') = 2 then '' else ' (et d''autres)' end);

  -- En dernier : le brouillon supprimé directement (la policy des factures) emporte aussi ses liens ; le dossier aussi.
  r := pg_temp.essayer(membre, format($q$delete from factures_emises where id = %L returning 1$q$, f5));
  select count(*) into n from honoraires_factures where facture_id = f5;
  perform pg_temp.noter(57, 'un brouillon supprimé directement emporte ses liens', 'OK:1 0', r || ' ' || n);
  r := pg_temp.essayer(membre, pg_temp.facturer(k, jsonb_build_array(pg_temp.el(l1b, 2, '2026-01-01', '2026-12-31'))));
  perform pg_temp.noter(58, 'la 2035 de 2026 redevient à facturer', 'OK:', r);
end
$essai$;

select case when ok then 'OK  ' else 'FAUX' end || ' ' || lpad(rang::text, 2) || '. ' || controle
       || case when ok then '' else ' — attendu « ' || attendu || ' », observé « ' || observe || ' »' end as ligne
  from essai_hf order by rang, controle;
select count(*) filter (where not ok) || ' en faute / ' || count(*) || ' étapes' as bilan from essai_hf;
rollback;
