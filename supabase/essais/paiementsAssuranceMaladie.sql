-- LES PAIEMENTS DE L'ASSURANCE MALADIE (conception 53, NOE3 ; la migration `paiements_assurance_maladie`, PRÉPARÉE le
-- 16/11/2026, supabase/preparees/20261116190000_paiements_assurance_maladie.sql). Le récit : HISTORIQUE.md, « 16/11/2026 —
-- NOE1 ET NOE3 : LA LECTURE DES PAIEMENTS DE L'ASSURANCE MALADIE ET LEUR TABLE (PRÉPARÉE, PAS APPLIQUÉE) ». À rejouer par
-- `execute_sql` après toute migration qui touche `memberships`, `client_du_dossier`, `admin_du_dossier`, `exercices_valides`,
-- les deux tables ou leurs fonctions. Le retrait d'une ligne en direct ne se joue pas ici (l'outil d'exécution de la
-- production retient une suppression) : la garde le refuse, ce que la réplique de l'étape a éprouvé.
--
-- Ce qui se prouve ici, et ne se relit pas : le cabinet (le chef, un membre qui n'est pas super-administrateur) et le client
-- « Banque » importent et retirent ; chaque refus sous ses mots, dans l'ordre de la migration ; le client sans la case, celui
-- d'un autre dossier, un compte sans accès et l'anonyme ne lisent rien et n'écrivent rien ; la case décochée, le client ne lit
-- ni n'importe plus ; un fichier réimporté ne double rien, un fichier qui diverge se refuse ; un exercice validé retient
-- l'import et le retrait ; personne n'écrit ni ne réécrit en direct (ni le client, ni un chef qui n'est pas
-- super-administrateur, ni le rôle des Edge Functions) ; le catalogue.
--
-- Trois dossiers jetables du cabinet du dossier `test` (préfixe `e5300000-0000-4000-8000`) : DB, où l'accès du client d'essai
-- porte « Banque », DS, où il ne la porte pas, et DX, où il n'a aucun accès. Chaque étape se joue dans sa sous-transaction et
-- s'y ANNULE (`ANNULATION_ETAPE`) : ce que le chef pose d'abord (sous sa session), ce que le propriétaire pose ensuite, puis la
-- requête du profil ; le jeu s'annule à la fin (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le relit. Les verdicts
-- voyagent dans un réglage LOCAL à la transaction (`essai.paiements_assurance_maladie`), que la requête finale lit : le
-- fichier se joue d'un seul appel, ne crée ni table ni fonction, ne contient aucune instruction de suppression, et ne rend
-- rien qui dépende d'une ligne hors de ses dossiers. Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`).
-- Sans la migration, une ligne dit qu'il attend (EN ATTENTE) et rien ne s'écrit.
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  db constant text := 'e5300000-0000-4000-8000-0000000000d1';
  ds constant text := 'e5300000-0000-4000-8000-0000000000d2';
  dx constant text := 'e5300000-0000-4000-8000-0000000000d3';
  acces_b constant text := 'e5300000-0000-4000-8000-0000000000a1';
  acces_s constant text := 'e5300000-0000-4000-8000-0000000000a2';
  -- Un compte connecté qu'aucun accès ni aucun cabinet ne nomme (le profil `inconnu`).
  inconnu constant text := 'e5300000-0000-4000-8000-0000000000f1';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  jour constant date := (now() at time zone 'Europe/Paris')::date;
  -- L'import d'essai : quatre paiements sur trois journées (la part obligatoire et la complémentaire d'une même journée, un
  -- forfait sans organisme dit, une journée régularisée) et deux rejets ; des centimes.
  base jsonb;
  imp text; imp_plus text; imp_autre text;
  importer constant text := $q$importer_paiements_assurance_maladie('{DB}', '{I}'::jsonb)$q$;
  e record; v_code text; v_msg text; v_req text; v_pose text; v_obs text; v_attendu text;
  verdicts jsonb := '[]'::jsonb;
begin
  if to_regclass('public.paiements_assurance_maladie') is null then
    perform set_config('essai.paiements_assurance_maladie', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration paiements_assurance_maladie', 'ok', true,
      'observe', 'absente : l''essai se joue dès que la migration y est'))::text, true);
    return;
  end if;
  base := jsonb_build_object('version', 1, 'rejets', jsonb_build_object('nombre', 2, 'montant_centimes', 4500),
    'paiements', jsonb_build_array(
      jsonb_build_object('date_journee_comptable', to_char(jour - 3, 'YYYY-MM-DD'), 'regime', 1, 'caisse', 691, 'part', 'obligatoire',
        'montant_centimes', 12345, 'regularisations_centimes', 0, 'nombre_de_factures', 7),
      jsonb_build_object('date_journee_comptable', to_char(jour - 3, 'YYYY-MM-DD'), 'regime', 1, 'caisse', 691, 'part', 'complementaire',
        'montant_centimes', 2345, 'regularisations_centimes', 0, 'nombre_de_factures', 3),
      jsonb_build_object('date_journee_comptable', to_char(jour - 2, 'YYYY-MM-DD'), 'regime', null, 'caisse', null, 'part', 'forfait',
        'montant_centimes', 50000, 'regularisations_centimes', 0, 'nombre_de_factures', 0),
      jsonb_build_object('date_journee_comptable', to_char(jour - 1, 'YYYY-MM-DD'), 'regime', 1, 'caisse', 691, 'part', 'obligatoire',
        'montant_centimes', 900, 'regularisations_centimes', -100, 'nombre_de_factures', 1)));
  imp := base::text;
  -- Le même fichier, une journée de plus (celle du jour) : il recouvre le premier.
  imp_plus := jsonb_set(base, '{paiements}', (base -> 'paiements') || jsonb_build_array(jsonb_build_object(
    'date_journee_comptable', to_char(jour, 'YYYY-MM-DD'), 'regime', 1, 'caisse', 691, 'part', 'obligatoire',
    'montant_centimes', 4000, 'regularisations_centimes', 0, 'nombre_de_factures', 2)))::text;
  -- Un fichier qui diverge : la part obligatoire de la première journée, un centime de plus.
  imp_autre := jsonb_set(base, '{paiements,0,montant_centimes}', '12346')::text;
  begin
    -- Le jeu : trois dossiers jetables, et un accès du client d'essai à DB (« Banque ») et à DS (sans elle), insérés par le
    -- propriétaire comme `create-client-access` les insère — la case posée à l'insertion.
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, statut_tva) values
      (db::uuid, 'ESSAI PAIEMENTS ASSURANCE MALADIE DB', cabinet, 'tresorerie', '455000', 'exonere'),
      (ds::uuid, 'ESSAI PAIEMENTS ASSURANCE MALADIE DS', cabinet, 'tresorerie', '455000', 'exonere'),
      (dx::uuid, 'ESSAI PAIEMENTS ASSURANCE MALADIE DX', cabinet, 'tresorerie', '455000', 'exonere');
    insert into memberships (id, user_id, dossier_id, role, email, droit_banque) values
      (acces_b::uuid, client::uuid, db::uuid, 'client', 'essai-assurance-maladie-b@example.test', true),
      (acces_s::uuid, client::uuid, ds::uuid, 'client', 'essai-assurance-maladie-s@example.test', false);

    -- Une étape : {rang, étape, ce que le CHEF pose d'abord (super-administrateur, sous sa session), ce que le PROPRIÉTAIRE pose
    -- ensuite (sans session : un exercice validé), le profil — `chef`, `chef_simple` (le compte client rattaché au cabinet, le
    -- temps de l'étape), `client`, `inconnu`, `service` (le rôle des Edge Functions) ou `anon` —, sa requête, le code attendu
    -- (`OK` : acceptée) et ce qu'elle rend, ou les mots du refus}. `{J-n}` : le jour de Paris décalé, `{J-3fr}` : en JJ/MM/AAAA.
    for e in select * from (values
      -- La requête qui appelle une fonction d'écriture ne relit pas, dans la même instruction, ce qu'elle a écrit (l'image de
      -- l'instruction précède l'appel) : ce que l'import a écrit se lit à l'étape suivante, posé par le chef.
      (1, '1. le chef importe : la période lue, les rejets dits, l''auteur', null, null, 'chef',
        $q$select i.periode_du || ' ' || i.periode_au || ' ' || i.nombre_de_rejets || ' ' || i.montant_rejete_centimes || ' ' || (i.importe_par::text = '{CHEF}') from {IMP} i$q$,
        'OK', '{J-3} {J-1} 2 4500 true'),
      (2, '2. le client « Banque » importe : il en est l''auteur', null, null, 'client',
        $q$select (i.importe_par::text = '{CLIENT}')::text from {IMP} i$q$, 'OK', 'true'),
      (3, '3. le client « Banque » lit l''import et les paiements de son dossier, tels qu''ils ont été écrits', 'select 1 from {IMP}', null, 'client',
        $q$select count(*)::text || ' ' || (select count(*) from paiements_assurance_maladie p where p.dossier_id = '{DB}') || ' ' || (select sum(p.montant_centimes) from paiements_assurance_maladie p where p.dossier_id = '{DB}') || ' ' || (select sum(p.regularisations_centimes) from paiements_assurance_maladie p where p.dossier_id = '{DB}') || ' ' || (select sum(p.nombre_de_factures) from paiements_assurance_maladie p where p.dossier_id = '{DB}') from imports_assurance_maladie i where i.dossier_id = '{DB}'$q$,
        'OK', '1 4 65590 -100 11'),
      (4, '4. le client sans la case n''importe pas dans DS (42501)', null, null, 'client',
        $q$select 1 from importer_paiements_assurance_maladie('{DS}', '{I}'::jsonb)$q$, '42501', 'Accès refusé à ce dossier.'),
      (5, '5. le client sans la case ne lit rien de DS', $q$select 1 from importer_paiements_assurance_maladie('{DS}', '{I}'::jsonb)$q$, null, 'client',
        $q$select (select count(*) from imports_assurance_maladie i where i.dossier_id = '{DS}') || ' ' || (select count(*) from paiements_assurance_maladie p where p.dossier_id = '{DS}')$q$,
        'OK', '0 0'),
      (6, '6. le client n''importe pas dans un dossier où il n''a aucun accès (DX, 42501)', null, null, 'client',
        $q$select 1 from importer_paiements_assurance_maladie('{DX}', '{I}'::jsonb)$q$, '42501', 'Accès refusé à ce dossier.'),
      (7, '7. le client ne lit rien de DX', $q$select 1 from importer_paiements_assurance_maladie('{DX}', '{I}'::jsonb)$q$, null, 'client',
        $q$select (select count(*) from imports_assurance_maladie i where i.dossier_id = '{DX}') || ' ' || (select count(*) from paiements_assurance_maladie p where p.dossier_id = '{DX}')$q$,
        'OK', '0 0'),
      (8, '8. un compte connecté sans accès n''importe pas (42501)', null, null, 'inconnu', $q$select 1 from {IMP}$q$, '42501', 'Accès refusé à ce dossier.'),
      (9, '9. un compte connecté sans accès ne lit rien', 'select 1 from {IMP}', null, 'inconnu',
        $q$select (select count(*) from imports_assurance_maladie) || ' ' || (select count(*) from paiements_assurance_maladie)$q$, 'OK', '0 0'),
      (10, '10. un membre du cabinet qui n''est pas super-administrateur importe', null, null, 'chef_simple',
        $q$select (i.importe_par::text = '{CLIENT}')::text from {IMP} i$q$, 'OK', 'true'),
      (11, '11. la case « Banque » décochée par le cabinet, le client ne lit plus rien', $q$select 1 from {IMP}; select 1 from changer_droits_acces('{AB}', null, false)$q$, null, 'client',
        $q$select (select count(*) from imports_assurance_maladie i where i.dossier_id = '{DB}') || ' ' || (select count(*) from paiements_assurance_maladie p where p.dossier_id = '{DB}')$q$,
        'OK', '0 0'),
      (12, '12. … et n''importe plus (42501)', $q$select 1 from changer_droits_acces('{AB}', null, false)$q$, null, 'client',
        $q$select 1 from {IMP}$q$, '42501', 'Accès refusé à ce dossier.'),
      (13, '13. le client « Banque » retire un import de son dossier', 'select 1 from {IMP}', null, 'client',
        $q$select (r.dossier_id::text = '{DB}')::text from retirer_import_assurance_maladie((select i.id from imports_assurance_maladie i where i.dossier_id = '{DB}')) r$q$,
        'OK', 'true'),
      (113, '13 bis. retiré, l''import et ses paiements sont partis ensemble',
        $q$select 1 from {IMP}; select 1 from retirer_import_assurance_maladie((select i.id from imports_assurance_maladie i where i.dossier_id = '{DB}'))$q$, null, 'client',
        $q$select (select count(*) from imports_assurance_maladie i where i.dossier_id = '{DB}') || ' ' || (select count(*) from paiements_assurance_maladie p where p.dossier_id = '{DB}')$q$,
        'OK', '0 0'),
      (14, '14. le client sans la case ne retire pas un import de DS (42501)', $q$select set_config('essai.import', (select i.id::text from importer_paiements_assurance_maladie('{DS}', '{I}'::jsonb) i), true)$q$, null, 'client',
        $q$select 1 from retirer_import_assurance_maladie(current_setting('essai.import')::uuid)$q$, '42501', 'Accès refusé à ce dossier.'),
      (15, '15. un compte connecté sans accès ne retire pas (42501)', $q$select set_config('essai.import', (select i.id::text from {IMP} i), true)$q$, null, 'inconnu',
        $q$select 1 from retirer_import_assurance_maladie(current_setting('essai.import')::uuid)$q$, '42501', 'Accès refusé à ce dossier.'),
      (16, '16. retirer un import inconnu (42501 : rien n''apprend qu''il existe)', null, null, 'chef_simple',
        $q$select 1 from retirer_import_assurance_maladie(gen_random_uuid())$q$, '42501', 'Accès refusé à ce dossier.'),
      (17, '17. le client « Banque » n''écrit pas en direct (la garde, avant la RLS)', null, null, 'client',
        $q$insert into imports_assurance_maladie (dossier_id, periode_du, periode_au, importe_par) values ('{DB}', '{J-1}', '{J-1}', '{CLIENT}') returning 1$q$,
        '42501', 'Les paiements de l''assurance maladie ne s''écrivent que par leur import.'),
      (18, '18. un chef qui n''est pas super-administrateur n''écrit pas en direct non plus', 'select 1 from {IMP}', null, 'chef_simple',
        $q$insert into paiements_assurance_maladie (dossier_id, import_id, date_journee_comptable, regime, caisse, part, montant_centimes, regularisations_centimes, nombre_de_factures) values ('{DB}', (select i.id from imports_assurance_maladie i where i.dossier_id = '{DB}'), '{J}', 1, 691, 'obligatoire', 100, 0, 1) returning 1$q$,
        '42501', 'Les paiements de l''assurance maladie ne s''écrivent que par leur import.'),
      (119, '19 bis. … mais pas un paiement dans l''import d''un autre dossier (la garde, 23514)',
        $q$select set_config('essai.import', (select i.id::text from importer_paiements_assurance_maladie('{DS}', '{I}'::jsonb) i), true)$q$, null, 'chef',
        $q$insert into paiements_assurance_maladie (dossier_id, import_id, date_journee_comptable, regime, caisse, part, montant_centimes, regularisations_centimes, nombre_de_factures) values ('{DB}', current_setting('essai.import')::uuid, '{J}', 1, 691, 'obligatoire', 100, 0, 1) returning 1$q$,
        '23514', 'Un paiement de l''assurance maladie s''écrit dans le dossier de son import.'),
      (19, '19. le super-administrateur insère en direct : la restauration', null, null, 'chef',
        $q$insert into imports_assurance_maladie (dossier_id, periode_du, periode_au, importe_par) values ('{DB}', '{J-1}', '{J-1}', '{CHEF}') returning 1$q$,
        'OK', '1'),
      (20, '20. le rôle des Edge Functions, qui passe la RLS, ne réécrit pas un import (la garde)', 'select 1 from {IMP}', null, 'service',
        $q$update imports_assurance_maladie set periode_du = periode_du where dossier_id = '{DB}' returning 1$q$, '23514',
        'Un import des paiements de l''assurance maladie ne se modifie pas : il se retire et se refait.'),
      (21, '21. … ni n''écrit un paiement en direct (la garde)', 'select 1 from {IMP}', null, 'service',
        $q$insert into paiements_assurance_maladie (dossier_id, import_id, date_journee_comptable, regime, caisse, part, montant_centimes, regularisations_centimes, nombre_de_factures) values ('{DB}', (select i.id from imports_assurance_maladie i where i.dossier_id = '{DB}'), '{J}', 1, 691, 'obligatoire', 100, 0, 1) returning 1$q$,
        '42501', 'Les paiements de l''assurance maladie ne s''écrivent que par leur import.'),
      (22, '22. le super-administrateur ne réécrit rien : aucune policy de mise à jour, aucune ligne touchée', 'select 1 from {IMP}', null, 'chef',
        $q$with t as (update paiements_assurance_maladie set nombre_de_factures = nombre_de_factures where dossier_id = '{DB}' returning 1) select count(*)::text from t$q$, 'OK', '0'),
      (23, '23. le même fichier réimporté : rien de neuf (22023)', 'select 1 from {IMP}', null, 'chef',
        $q$select 1 from {IMP}$q$, '22023', 'Ces paiements sont déjà tous importés : rien de neuf.'),
      (24, '24. un fichier qui recouvre le premier s''importe ; la période lue est la sienne', 'select 1 from {IMP}', null, 'client',
        $q$select i.periode_du || ' ' || i.periode_au from importer_paiements_assurance_maladie('{DB}', '{I+}'::jsonb) i$q$,
        'OK', '{J-3} {J}'),
      (124, '24 bis. … et seule la journée nouvelle entre : deux imports, l''un de quatre paiements, l''autre d''un',
        $q$select 1 from {IMP}; select 1 from importer_paiements_assurance_maladie('{DB}', '{I+}'::jsonb)$q$, null, 'client',
        $q$select string_agg(n::text, ',' order by n) from (select count(*) as n from paiements_assurance_maladie p where p.dossier_id = '{DB}' group by p.import_id) c$q$,
        'OK', '1,4'),
      (25, '25. un fichier qui diverge sur une clé déjà en base : refusé, la journée nommée (22023)', 'select 1 from {IMP}', null, 'chef',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', '{I~}'::jsonb)$q$, '22023',
        'Un paiement de l''import est déjà en base avec d''autres chiffres (la journée comptable du {J-3fr}) : retirer d''abord l''import qui le porte.'),
      (26, '26. un exercice validé retient l''import (22023)', null,
        $q$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte) values ('{DB}', extract(year from date '{J-3}')::integer, now(), '{CHEF}', 'engagement', 0, 0, 0, 0, repeat('0', 64))$q$,
        'chef', $q$select 1 from {IMP}$q$, '22023', 'Un paiement de l''import tombe dans un exercice que le cabinet a validé : il ne s''importe plus.'),
      (27, '27. … et le retrait d''un import qui y tombe (22023)', $q$select set_config('essai.import', (select i.id::text from {IMP} i), true)$q$,
        $q$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte) values ('{DB}', extract(year from date '{J-3}')::integer, now(), '{CHEF}', 'engagement', 0, 0, 0, 0, repeat('0', 64))$q$,
        'client', $q$select 1 from retirer_import_assurance_maladie(current_setting('essai.import')::uuid)$q$, '22023',
        'Un paiement de cet import tombe dans un exercice que le cabinet a validé : l''import ne se retire plus.'),
      (28, '28. une forme inconnue : la version 2 (22023)', null, null, 'chef',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', jsonb_set('{I}'::jsonb, '{version}', '2'))$q$, '22023', 'L''import n''est pas dans la forme que la base connaît (version 1).'),
      (29, '29. une forme inconnue : une clé de plus, un texte libre (22023)', null, null, 'chef',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', '{I}'::jsonb || '{"note": "texte libre"}'::jsonb)$q$, '22023', 'L''import n''est pas dans la forme que la base connaît (version 1).'),
      (30, '30. des rejets dits par un nombre seul (22023)', null, null, 'chef',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', jsonb_set('{I}'::jsonb, '{rejets}', '3'))$q$, '22023', 'L''import n''est pas dans la forme que la base connaît (version 1).'),
      (31, '31. aucun paiement (22023)', null, null, 'chef',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', jsonb_set('{I}'::jsonb, '{paiements}', '[]'))$q$, '22023', 'Un import porte de 1 à 5 000 paiements.'),
      (32, '32. un paiement qui porte un nom (une clé de plus, 22023)', null, null, 'chef',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', jsonb_set('{I}'::jsonb, '{paiements,0,nom}', '"DUPONT-ESSAI"'))$q$, '22023', 'Un paiement de l''import est mal formé : une journée comptable, un organisme en chiffres ou rien, une part de la liste, des montants en centimes entiers et un nombre de factures.'),
      (33, '33. un organisme dit par un texte (22023)', null, null, 'chef',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', jsonb_set('{I}'::jsonb, '{paiements,0,regime}', '"01"'))$q$, '22023', 'Un paiement de l''import est mal formé : une journée comptable, un organisme en chiffres ou rien, une part de la liste, des montants en centimes entiers et un nombre de factures.'),
      (34, '34. une part hors de la liste (22023)', null, null, 'chef',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', jsonb_set('{I}'::jsonb, '{paiements,0,part}', '"autre"'))$q$, '22023', 'Un paiement de l''import est mal formé : une journée comptable, un organisme en chiffres ou rien, une part de la liste, des montants en centimes entiers et un nombre de factures.'),
      (35, '35. une fraction de centime (22023)', null, null, 'chef',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', jsonb_set('{I}'::jsonb, '{paiements,0,montant_centimes}', '12345.5'))$q$, '22023', 'Un paiement de l''import est mal formé : une journée comptable, un organisme en chiffres ou rien, une part de la liste, des montants en centimes entiers et un nombre de factures.'),
      (36, '36. une régularisation positive (22023)', null, null, 'chef',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', jsonb_set('{I}'::jsonb, '{paiements,0,regularisations_centimes}', '100'))$q$, '22023', 'Un paiement de l''import est mal formé : une journée comptable, un organisme en chiffres ou rien, une part de la liste, des montants en centimes entiers et un nombre de factures.'),
      (37, '37. un jour qui n''existe pas (22023)', null, null, 'chef',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', jsonb_set('{I}'::jsonb, '{paiements,0,date_journee_comptable}', '"2026-02-30"'))$q$, '22023', 'Un paiement de l''import est mal formé : une journée comptable, un organisme en chiffres ou rien, une part de la liste, des montants en centimes entiers et un nombre de factures.'),
      (38, '38. une journée comptable à venir (22023)', null, null, 'chef',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', jsonb_set('{I}'::jsonb, '{paiements,0,date_journee_comptable}', to_jsonb('{J+1}'::text)))$q$, '22023', 'Un paiement de l''import porte une journée comptable à venir.'),
      (39, '39. un forfait qui paierait une facture (22023)', null, null, 'chef',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', jsonb_set('{I}'::jsonb, '{paiements,2,nombre_de_factures}', '1'))$q$, '22023', 'Un paiement de l''import ne se tient pas : ses factures, son montant et ses régularisations ne s''accordent pas.'),
      (40, '40. un paiement de factures qui n''en paie aucune (22023)', null, null, 'chef',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', jsonb_set('{I}'::jsonb, '{paiements,0,nombre_de_factures}', '0'))$q$, '22023', 'Un paiement de l''import ne se tient pas : ses factures, son montant et ses régularisations ne s''accordent pas.'),
      (41, '41. un paiement de rien (22023)', null, null, 'chef',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', jsonb_set(jsonb_set('{I}'::jsonb, '{paiements,2,montant_centimes}', '0'), '{paiements,2,nombre_de_factures}', '0'))$q$, '22023', 'Un paiement de l''import ne se tient pas : ses factures, son montant et ses régularisations ne s''accordent pas.'),
      (42, '42. deux paiements de même clé (22023)', null, null, 'chef',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', jsonb_set('{I}'::jsonb, '{paiements,1,part}', '"obligatoire"'))$q$, '22023', 'L''import porte deux fois le même paiement : une même journée comptable, un même organisme et une même part.'),
      (43, '43. un montant rejeté sans facture rejetée (22023)', null, null, 'chef',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', jsonb_set('{I}'::jsonb, '{rejets,nombre}', '0'))$q$, '22023', 'Les rejets de l''import sont mal formés : un nombre de factures et un montant en centimes entiers, positifs, ou rien.'),
      (44, '44. des rejets qui portent un texte (22023)', null, null, 'chef',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', jsonb_set('{I}'::jsonb, '{rejets,motif}', '"libellé du rejet"'))$q$, '22023', 'Les rejets de l''import sont mal formés : un nombre de factures et un montant en centimes entiers, positifs, ou rien.'),
      (45, '45. des rejets non dits : nuls, jamais zéro', null, null, 'chef',
        $q$select coalesce(i.nombre_de_rejets::text, 'nul') || ' ' || coalesce(i.montant_rejete_centimes::text, 'nul') from importer_paiements_assurance_maladie('{DB}', jsonb_set('{I}'::jsonb, '{rejets}', 'null')) i$q$, 'OK', 'nul nul'),
      (46, '46. un nombre entier écrit avec une décimale nulle se lit comme l''entier',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', jsonb_set('{I}'::jsonb, '{paiements,0,montant_centimes}', '12345.0'))$q$, null, 'chef',
        $q$select sum(p.montant_centimes)::text from paiements_assurance_maladie p where p.dossier_id = '{DB}'$q$, 'OK', '65590'),
      (47, '47. l''anonyme ne lit rien et n''exécute ni l''import ni le retrait', 'select 1 from {IMP}', null, 'anon',
        $q$select (select count(*) from imports_assurance_maladie) || ' ' || (select count(*) from paiements_assurance_maladie) || ' ' || has_function_privilege('anon', 'public.importer_paiements_assurance_maladie(uuid, jsonb)', 'execute') || ' ' || has_function_privilege('anon', 'public.retirer_import_assurance_maladie(uuid)', 'execute')$q$,
        'OK', '0 0 false false'),
      (48, '48. aucun connecté n''exécute le refus ni la garde', null, null, 'client',
        $q$select has_function_privilege('authenticated', 'public.refus_de_l_import_assurance_maladie(jsonb, date)', 'execute') || ' ' || has_function_privilege('authenticated', 'public.garder_paiements_assurance_maladie()', 'execute')$q$,
        'OK', 'false false')
    ) as t(rang, etape, pose, pose_proprietaire, profil, requete, code, attendu) loop
      v_code := 'OK'; v_msg := null; v_obs := null;
      v_attendu := replace(replace(replace(replace(replace(replace(e.attendu,
        '{J-3fr}', to_char(jour - 3, 'DD/MM/YYYY')), '{J-3}', to_char(jour - 3, 'YYYY-MM-DD')), '{J-1}', to_char(jour - 1, 'YYYY-MM-DD')),
        '{J}', to_char(jour, 'YYYY-MM-DD')), '{CHEF}', chef), '{CLIENT}', client);
      begin
        if e.profil = 'chef_simple' then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client::uuid, cabinet, 'comptable_en_chef');
        end if;
        if e.pose is not null then
          v_pose := replace(replace(replace(replace(replace(replace(replace(e.pose, '{IMP}', importer), '{I+}', imp_plus), '{I}', imp), '{DB}', db), '{DS}', ds),
            '{DX}', dx), '{AB}', acces_b);
          execute 'set local role authenticated';
          perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
          execute v_pose;
          reset role;
          perform set_config('request.jwt.claims', '', true);
        end if;
        if e.pose_proprietaire is not null then
          execute replace(replace(replace(e.pose_proprietaire, '{DB}', db), '{CHEF}', chef), '{J-3}', to_char(jour - 3, 'YYYY-MM-DD'));
        end if;
        v_req := replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
          e.requete, '{IMP}', importer), '{I+}', imp_plus), '{I~}', imp_autre), '{I}', imp), '{DB}', db), '{DS}', ds), '{DX}', dx),
          '{CHEF}', chef), '{CLIENT}', client), '{J-1}', to_char(jour - 1, 'YYYY-MM-DD')), '{J+1}', to_char(jour + 1, 'YYYY-MM-DD')),
          '{J}', to_char(jour, 'YYYY-MM-DD')), '{AB}', acces_b);
        begin
          if e.profil = 'anon' then
            execute 'set local role anon';
            perform set_config('request.jwt.claims', '{"role":"anon"}', true);
          elsif e.profil = 'service' then
            execute 'set local role service_role';
            perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
          else
            execute 'set local role authenticated';
            perform set_config('request.jwt.claims',
              json_build_object('sub', case e.profil when 'chef' then chef when 'inconnu' then inconnu else client end, 'role', 'authenticated')::text, true);
          end if;
          execute v_req into v_obs;
          reset role;
          v_msg := coalesce(v_obs, '');
        exception when others then
          reset role;
          v_code := sqlstate;
          v_msg := sqlerrm;
        end;
        reset role;
        perform set_config('request.jwt.claims', '', true);
        raise exception 'ANNULATION_ETAPE';
      exception when others then
        if sqlerrm <> 'ANNULATION_ETAPE' then
          v_code := 'ESSAI';
          v_msg := sqlstate || ' ' || sqlerrm;
        end if;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      verdicts := verdicts || jsonb_build_object('rang', e.rang, 'etape', e.etape,
        'ok', v_code = e.code and v_msg = v_attendu, 'observe', v_code || ' ' || coalesce(v_msg, '-'));
    end loop;

    -- Le catalogue : la RLS active ; trois policies permissives par table, toutes à authenticated, aux expressions exactes ;
    -- la garde avant chaque écriture ; aucune colonne de texte hors de la part ; les fonctions de l'API aux droits du
    -- propriétaire, search_path fixé ; ni anon ni PUBLIC ne les exécutent.
    verdicts := verdicts || jsonb_build_object('rang', 49, 'etape', '49. le catalogue : RLS, trois policies par table à authenticated, la garde, aucune colonne de texte libre, les fonctions',
      'ok', (select bool_and(c.relrowsecurity) from pg_class c
              where c.oid in ('public.imports_assurance_maladie'::regclass, 'public.paiements_assurance_maladie'::regclass))
        and (select count(*) from pg_policies p where p.schemaname = 'public'
               and p.tablename in ('imports_assurance_maladie', 'paiements_assurance_maladie')
               and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) = 6
        and (select count(*) from pg_policies p where p.schemaname = 'public'
               and p.tablename in ('imports_assurance_maladie', 'paiements_assurance_maladie')
               and p.roles = array['authenticated']::name[] and p.permissive = 'PERMISSIVE'
               and ((p.policyname = p.tablename || '_lecture' and p.cmd = 'SELECT' and p.qual = 'admin_du_dossier(dossier_id)' and p.with_check is null)
                 or (p.policyname = p.tablename || '_lecture_banque' and p.cmd = 'SELECT'
                     and p.qual = 'client_du_dossier(dossier_id, ''banque''::text)' and p.with_check is null)
                 or (p.policyname = p.tablename || '_restauration' and p.cmd = 'INSERT' and p.qual is null and p.with_check = 'is_super_admin()'))) = 6
        and (select count(*) from pg_trigger t where not t.tgisinternal and t.tgtype = 31
               and t.tgfoid = 'public.garder_paiements_assurance_maladie()'::regprocedure
               and t.tgrelid in ('public.imports_assurance_maladie'::regclass, 'public.paiements_assurance_maladie'::regclass)) = 2
        and not exists (select 1 from pg_attribute a
               where a.attrelid in ('public.imports_assurance_maladie'::regclass, 'public.paiements_assurance_maladie'::regclass)
                 and a.attnum > 0 and not a.attisdropped
                 and a.atttypid in ('text'::regtype, 'varchar'::regtype, 'bpchar'::regtype, 'json'::regtype, 'jsonb'::regtype)
                 and not (a.attrelid = 'public.paiements_assurance_maladie'::regclass and a.attname = 'part'))
        and (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
               and p.oid in ('public.importer_paiements_assurance_maladie(uuid, jsonb)'::regprocedure,
                             'public.retirer_import_assurance_maladie(uuid)'::regprocedure)
               and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
               and not has_function_privilege('anon', p.oid, 'execute')
               and has_function_privilege('authenticated', p.oid, 'execute')
               and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)) = 2,
      'observe', 'relu au catalogue');
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  -- Rien n'est resté : ni les dossiers jetables, ni leurs accès, ni leurs imports, ni le compte d'essai dans le cabinet.
  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni leurs accès, ni leurs imports et paiements, ni le compte d''essai dans le cabinet',
    'ok', not exists (select 1 from dossiers where id in (db::uuid, ds::uuid, dx::uuid))
      and not exists (select 1 from memberships where id in (acces_b::uuid, acces_s::uuid))
      and not exists (select 1 from imports_assurance_maladie where dossier_id in (db::uuid, ds::uuid, dx::uuid))
      and not exists (select 1 from paiements_assurance_maladie where dossier_id in (db::uuid, ds::uuid, dx::uuid))
      and not exists (select 1 from cabinet_admins where user_id::text = client),
    'observe', 'relu');
  perform set_config('essai.paiements_assurance_maladie', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.paiements_assurance_maladie')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
