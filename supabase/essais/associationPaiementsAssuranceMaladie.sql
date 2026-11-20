-- L'ASSOCIATION DES PAIEMENTS DE L'ASSURANCE MALADIE AUX MOUVEMENTS DU RELEVÉ (conception 53, NOE5 ; la migration
-- `association_paiements_assurance_maladie`, préparée le 17/11/2026, EN PRODUCTION depuis le 20/11/2026, 247, collée :
-- supabase/schema/20261120110100_association_paiements_assurance_maladie.sql). Le récit : HISTORIQUE.md, « 17/11/2026 —
-- NOE5 : L'ASSOCIATION DES PAIEMENTS DE L'ASSURANCE MALADIE AUX CRÉDITS DU RELEVÉ (PRÉPARÉE, PAS APPLIQUÉE) », puis « NOE3,
-- NOE5 ET BOR3 EN PRODUCTION ». À rejouer après
-- toute migration qui touche `admin_du_dossier`, `client_du_dossier`, `exercices_valides`, `lignes_bancaires`, les
-- encaissements des factures, les tables des paiements de l'assurance maladie ou leurs fonctions.
--
-- La suppression, sur une réplique seulement, par associationPaiementsAssuranceMaladieSuppression.sql : ce qu'elle rencontre
-- (un dossier, un mouvement, une association en direct).
--
-- Ce qui se prouve ici : le cabinet (le chef, un membre qui n'est pas super-administrateur) associe et défait ; un paiement
-- seul, les deux parts d'une journée ; le client « Banque » lit les associations de son dossier et n'associe ni ne défait ; la
-- case décochée, il ne lit plus ; un compte sans accès et l'anonyme ne lisent ni n'exécutent rien ; chaque refus sous ses
-- mots, dans l'ordre de la migration ; un import associé ne se retire pas, défait il se retire ; personne n'écrit ni ne
-- réécrit en direct, sauf la restauration ; le catalogue.
--
-- Deux dossiers jetables du cabinet du dossier `test` (préfixe `e5500000-0000-4000-8000`) : DB, où l'accès du client d'essai
-- porte « Banque », et DX, où il n'a aucun accès. Chaque étape se joue dans sa sous-transaction et s'y ANNULE
-- (`ANNULATION_ETAPE`) ; le jeu s'annule à la fin (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le relit. Les verdicts
-- voyagent dans un réglage LOCAL (`essai.association_assurance_maladie`), que la requête finale lit : un seul appel, ni table
-- ni fonction créée, aucune instruction de suppression, rien qui dépende d'une ligne hors de ses dossiers. Hors de l'outil
-- d'exécution, il se joue en UNE transaction (`psql -1`). Sans la migration, une ligne dit qu'il attend (EN ATTENTE).
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  inconnu constant text := 'e5500000-0000-4000-8000-0000000000f1';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  jeu constant jsonb := jsonb_build_object(
    '{DB}', 'e5500000-0000-4000-8000-0000000000d1', '{DX}', 'e5500000-0000-4000-8000-0000000000d3',
    '{AB}', 'e5500000-0000-4000-8000-0000000000a1', '{I}', 'e5500000-0000-4000-8000-0000000000c1',
    '{IX}', 'e5500000-0000-4000-8000-0000000000c3',
    '{L1}', 'e5500000-0000-4000-8000-000000000101', '{L2}', 'e5500000-0000-4000-8000-000000000102',
    '{L3}', 'e5500000-0000-4000-8000-000000000103', '{L4}', 'e5500000-0000-4000-8000-000000000104',
    '{L5}', 'e5500000-0000-4000-8000-000000000105', '{LX}', 'e5500000-0000-4000-8000-000000000109',
    '{P1}', 'e5500000-0000-4000-8000-000000000201', '{PO}', 'e5500000-0000-4000-8000-000000000202',
    '{PC}', 'e5500000-0000-4000-8000-000000000203', '{P6}', 'e5500000-0000-4000-8000-000000000206',
    '{PX}', 'e5500000-0000-4000-8000-000000000209',
    '{CHEF}', 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162', '{CLIENT}', '797fe440-df8d-4b8e-828b-d148927bfd60');
  associer constant text := $q$associer_paiements_assurance_maladie('{DB}', array['{P1}']::uuid[], array['{L1}']::uuid[])$q$;
  valider constant text := $q$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte) values ('{DB}', 2026, now(), '{CHEF}', 'engagement', 0, 0, 0, 0, repeat('0', 64))$q$;
  forme constant text := 'L''association est mal formée : autant de paiements que de mouvements, chaque paiement une fois, de 1 à 1 000.';
  e record; r record; v_code text; v_msg text; v_req text; v_pose text; v_obs text;
  verdicts jsonb := '[]'::jsonb;
begin
  if to_regclass('public.paiements_assurance_maladie_mouvements') is null then
    perform set_config('essai.association_assurance_maladie', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration association_paiements_assurance_maladie', 'ok', true,
      'observe', 'absente : l''essai se joue dès que la migration y est'))::text, true);
    return;
  end if;
  begin
    -- Le jeu, posé par le propriétaire : deux dossiers, l'accès « Banque » du client à DB, des mouvements, un import et ses
    -- paiements par dossier (le réglage de l'import, comme la restauration de rls.sql les écrit).
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, statut_tva) values
      ((jeu ->> '{DB}')::uuid, 'ESSAI ASSOCIATION ASSURANCE MALADIE DB', cabinet, 'tresorerie', '455000', 'exonere'),
      ((jeu ->> '{DX}')::uuid, 'ESSAI ASSOCIATION ASSURANCE MALADIE DX', cabinet, 'tresorerie', '455000', 'exonere');
    insert into memberships (id, user_id, dossier_id, role, email, droit_banque) values
      ((jeu ->> '{AB}')::uuid, client::uuid, (jeu ->> '{DB}')::uuid, 'client', 'essai-association-b@example.test', true);
    insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut, prelevement_personnel) values
      ((jeu ->> '{L1}')::uuid, (jeu ->> '{DB}')::uuid, '2026-03-05', 'VIREMENT CPAM ESSAI 0012345678260303', 123.45, 'non_rapprochee', false),
      ((jeu ->> '{L2}')::uuid, (jeu ->> '{DB}')::uuid, '2026-03-06', 'VIREMENT CPAM ESSAI', 100.00, 'non_rapprochee', false),
      ((jeu ->> '{L3}')::uuid, (jeu ->> '{DB}')::uuid, '2026-03-06', 'VIREMENT CPAM ESSAI', 50.00, 'ignoree', false),
      ((jeu ->> '{L4}')::uuid, (jeu ->> '{DB}')::uuid, '2026-03-07', 'VIREMENT CPAM ESSAI', 50.00, 'rapprochee', true),
      ((jeu ->> '{LX}')::uuid, (jeu ->> '{DX}')::uuid, '2026-03-05', 'VIREMENT CPAM ESSAI', 123.45, 'non_rapprochee', false);
    -- Un mouvement classé par ses encaissements ne naît que sous la session du super-administrateur (garder_mouvement_reserve).
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut, encaissements_de_factures) values
      ((jeu ->> '{L5}')::uuid, (jeu ->> '{DB}')::uuid, '2026-03-07', 'VIREMENT ESSAI', 60.00, 'rapprochee', true);
    reset role;
    perform set_config('request.jwt.claims', '', true);
    perform set_config('jd.paiements_assurance_maladie', jeu ->> '{I}', true);
    insert into imports_assurance_maladie (id, dossier_id, periode_du, periode_au, importe_par) values
      ((jeu ->> '{I}')::uuid, (jeu ->> '{DB}')::uuid, '2026-03-03', '2026-03-05', chef::uuid);
    insert into paiements_assurance_maladie (id, dossier_id, import_id, date_journee_comptable, regime, caisse, part, montant_centimes, regularisations_centimes, nombre_de_factures) values
      ((jeu ->> '{P1}')::uuid, (jeu ->> '{DB}')::uuid, (jeu ->> '{I}')::uuid, '2026-03-03', 1, 691, 'obligatoire', 12345, 0, 7),
      ((jeu ->> '{PO}')::uuid, (jeu ->> '{DB}')::uuid, (jeu ->> '{I}')::uuid, '2026-03-04', 1, 692, 'obligatoire', 8000, 0, 4),
      ((jeu ->> '{PC}')::uuid, (jeu ->> '{DB}')::uuid, (jeu ->> '{I}')::uuid, '2026-03-04', 1, 692, 'complementaire', 2000, 0, 2),
      ((jeu ->> '{P6}')::uuid, (jeu ->> '{DB}')::uuid, (jeu ->> '{I}')::uuid, '2026-03-05', 1, 691, 'obligatoire', 6000, 0, 1);
    perform set_config('jd.paiements_assurance_maladie', jeu ->> '{IX}', true);
    insert into imports_assurance_maladie (id, dossier_id, periode_du, periode_au, importe_par) values
      ((jeu ->> '{IX}')::uuid, (jeu ->> '{DX}')::uuid, '2026-03-03', '2026-03-03', chef::uuid);
    insert into paiements_assurance_maladie (id, dossier_id, import_id, date_journee_comptable, regime, caisse, part, montant_centimes, regularisations_centimes, nombre_de_factures) values
      ((jeu ->> '{PX}')::uuid, (jeu ->> '{DX}')::uuid, (jeu ->> '{IX}')::uuid, '2026-03-03', 1, 691, 'obligatoire', 12345, 0, 7);
    perform set_config('jd.paiements_assurance_maladie', '', true);

    -- Une étape : {rang, étape, ce que le CHEF pose d'abord (sous sa session), ce que le PROPRIÉTAIRE pose ensuite, le profil
    -- (`chef`, `chef_simple` : le compte client rattaché au cabinet le temps de l'étape, `client`, `inconnu`, `service`,
    -- `anon`), la requête, le code attendu (`OK` : acceptée) et ce qu'elle rend, ou les mots du refus}. `{ASSOCIER}` : le
    -- paiement P1 associé au mouvement L1, au centime.
    for e in select * from (values
      (1, '1. le chef associe un paiement seul à son crédit : l''auteur posé par la base', null, null, 'chef',
        $q$select count(*) || ' ' || bool_and(a.associe_par::text = '{CHEF}') || ' ' || bool_and(a.dossier_id::text = '{DB}') from {ASSOCIER} a$q$, 'OK', '1 true true'),
      (2, '2. le chef associe les deux parts d''une journée à un seul crédit', null, null, 'chef',
        $q$select count(*)::text from associer_paiements_assurance_maladie('{DB}', array['{PO}', '{PC}']::uuid[], array['{L2}', '{L2}']::uuid[])$q$, 'OK', '2'),
      (3, '3. un membre du cabinet qui n''est pas super-administrateur associe', null, null, 'chef_simple',
        $q$select (a.associe_par::text = '{CLIENT}')::text from {ASSOCIER} a$q$, 'OK', 'true'),
      (4, '4. le client « Banque » n''associe pas (42501)', null, null, 'client', $q$select 1 from {ASSOCIER}$q$, '42501', 'Accès refusé à ce dossier.'),
      (5, '5. le client « Banque » lit les associations de son dossier', 'select 1 from {ASSOCIER}', null, 'client',
        $q$select count(*)::text from paiements_assurance_maladie_mouvements a where a.dossier_id = '{DB}'$q$, 'OK', '1'),
      (6, '6. la case « Banque » décochée, il ne les lit plus', $q$select 1 from {ASSOCIER}; select 1 from changer_droits_acces('{AB}', null, false)$q$, null, 'client',
        $q$select count(*)::text from paiements_assurance_maladie_mouvements a where a.dossier_id = '{DB}'$q$, 'OK', '0'),
      (7, '7. un compte connecté sans accès ne lit rien et n''associe pas (42501)', 'select 1 from {ASSOCIER}', null, 'inconnu',
        $q$select 1 from associer_paiements_assurance_maladie('{DB}', array['{P6}']::uuid[], array['{L1}']::uuid[]) where (select count(*) from paiements_assurance_maladie_mouvements) = 0$q$,
        '42501', 'Accès refusé à ce dossier.'),
      (8, '8. l''anonyme ne lit rien et n''exécute ni l''association ni son retrait', 'select 1 from {ASSOCIER}', null, 'anon',
        $q$select (select count(*) from paiements_assurance_maladie_mouvements) || ' ' || has_function_privilege('anon', 'public.associer_paiements_assurance_maladie(uuid, uuid[], uuid[])', 'execute') || ' ' || has_function_privilege('anon', 'public.defaire_association_assurance_maladie(uuid, uuid)', 'execute')$q$,
        'OK', '0 false false'),
      (9, '9. la forme : aucune paire (22023)', null, null, 'chef',
        $q$select 1 from associer_paiements_assurance_maladie('{DB}', array[]::uuid[], array[]::uuid[])$q$, '22023', '{FORME}'),
      (10, '10. la forme : deux listes de longueurs différentes (22023)', null, null, 'chef',
        $q$select 1 from associer_paiements_assurance_maladie('{DB}', array['{P1}']::uuid[], array['{L1}', '{L1}']::uuid[])$q$, '22023', '{FORME}'),
      (11, '11. la forme : un paiement deux fois (22023)', null, null, 'chef',
        $q$select 1 from associer_paiements_assurance_maladie('{DB}', array['{P1}', '{P1}']::uuid[], array['{L1}', '{L2}']::uuid[])$q$, '22023', '{FORME}'),
      (12, '12. la forme : un vide (22023)', null, null, 'chef',
        $q$select 1 from associer_paiements_assurance_maladie('{DB}', array['{P1}', null]::uuid[], array['{L1}', '{L1}']::uuid[])$q$, '22023', '{FORME}'),
      (13, '13. la forme : deux dimensions (22023)', null, null, 'chef',
        $q$select 1 from associer_paiements_assurance_maladie('{DB}', array[array['{P1}'::uuid]], array[array['{L1}'::uuid]])$q$, '22023', '{FORME}'),
      (14, '14. un mouvement d''un autre dossier (22023)', null, null, 'chef',
        $q$select 1 from associer_paiements_assurance_maladie('{DB}', array['{P1}']::uuid[], array['{LX}']::uuid[])$q$, '22023', 'Un mouvement de l''association n''est pas un mouvement de ce dossier.'),
      (15, '15. un paiement d''un autre dossier (22023)', null, null, 'chef',
        $q$select 1 from associer_paiements_assurance_maladie('{DB}', array['{PX}']::uuid[], array['{L1}']::uuid[])$q$, '22023', 'Un paiement de l''association n''est pas un paiement de l''assurance maladie de ce dossier.'),
      (16, '16. un mouvement d''un exercice validé (22023)', null, '{VALIDER}', 'chef', $q$select 1 from {ASSOCIER}$q$, '22023',
        'Un mouvement de l''association tombe dans un exercice que le cabinet a validé : il ne s''associe plus.'),
      (17, '17. un mouvement écarté (23514)', null, null, 'chef',
        $q$select 1 from associer_paiements_assurance_maladie('{DB}', array['{P6}']::uuid[], array['{L3}']::uuid[])$q$, '23514', 'Un mouvement écarté ou classé en virement personnel ne justifie pas un paiement de l''assurance maladie.'),
      (18, '18. un mouvement personnel (23514)', null, null, 'chef',
        $q$select 1 from associer_paiements_assurance_maladie('{DB}', array['{P6}']::uuid[], array['{L4}']::uuid[])$q$, '23514', 'Un mouvement écarté ou classé en virement personnel ne justifie pas un paiement de l''assurance maladie.'),
      (19, '19. un mouvement classé par ses encaissements (23514, la règle G2)', null, null, 'chef',
        $q$select 1 from associer_paiements_assurance_maladie('{DB}', array['{P6}']::uuid[], array['{L5}']::uuid[])$q$, '23514', 'Un mouvement classé ou réservé par des encaissements de factures ne s''associe pas à un paiement de l''assurance maladie.'),
      (20, '20. un paiement déjà associé (22023)', 'select 1 from {ASSOCIER}', null, 'chef', $q$select 1 from {ASSOCIER}$q$, '22023',
        'Un paiement de l''association est déjà associé à un mouvement : défaire d''abord cette association.'),
      (21, '21. un mouvement déjà associé (22023)', 'select 1 from {ASSOCIER}', null, 'chef',
        $q$select 1 from associer_paiements_assurance_maladie('{DB}', array['{P6}']::uuid[], array['{L1}']::uuid[])$q$, '22023',
        'Un mouvement de l''association est déjà associé à des paiements de l''assurance maladie : défaire d''abord son association.'),
      (22, '22. une somme qui ne fait pas le montant, le mouvement nommé par sa date (22023)', null, null, 'chef',
        $q$select 1 from associer_paiements_assurance_maladie('{DB}', array['{P6}']::uuid[], array['{L1}']::uuid[])$q$, '22023',
        'Les paiements associés au mouvement du 05/03/2026 ne font pas son montant au centime.'),
      (23, '23. une seule part pour le crédit des deux : la somme manque (22023)', null, null, 'chef',
        $q$select 1 from associer_paiements_assurance_maladie('{DB}', array['{PO}']::uuid[], array['{L2}']::uuid[])$q$, '22023',
        'Les paiements associés au mouvement du 06/03/2026 ne font pas son montant au centime.'),
      (24, '24. tout ou rien : une paire juste et une fausse, rien d''écrit', null, null, 'chef',
        $q$select 1 from associer_paiements_assurance_maladie('{DB}', array['{P1}', '{PO}']::uuid[], array['{L1}', '{L2}']::uuid[])$q$, '22023',
        'Les paiements associés au mouvement du 06/03/2026 ne font pas son montant au centime.'),
      (25, '25. le chef défait : le groupe entier', $q$select 1 from associer_paiements_assurance_maladie('{DB}', array['{PO}', '{PC}']::uuid[], array['{L2}', '{L2}']::uuid[])$q$, null, 'chef',
        $q$select count(*)::text from defaire_association_assurance_maladie('{DB}', '{L2}')$q$, 'OK', '2'),
      (26, '26. défait, le paiement se réassocie', $q$select 1 from {ASSOCIER}; select 1 from defaire_association_assurance_maladie('{DB}', '{L1}')$q$, null, 'chef_simple',
        $q$select count(*)::text from {ASSOCIER}$q$, 'OK', '1'),
      (27, '27. rien à défaire (22023)', null, null, 'chef',
        $q$select 1 from defaire_association_assurance_maladie('{DB}', '{L1}')$q$, '22023', 'Ce mouvement n''est associé à aucun paiement de l''assurance maladie.'),
      (28, '28. l''exercice validé retient le retrait (22023)', 'select 1 from {ASSOCIER}', '{VALIDER}', 'chef',
        $q$select 1 from defaire_association_assurance_maladie('{DB}', '{L1}')$q$, '22023', 'Ce mouvement tombe dans un exercice que le cabinet a validé : son association ne se défait plus.'),
      (29, '29. le client « Banque » ne défait pas (42501)', 'select 1 from {ASSOCIER}', null, 'client',
        $q$select 1 from defaire_association_assurance_maladie('{DB}', '{L1}')$q$, '42501', 'Accès refusé à ce dossier.'),
      (30, '30. un import dont un paiement est associé ne se retire pas, même par le client « Banque » (22023)', 'select 1 from {ASSOCIER}', null, 'client',
        $q$select 1 from retirer_import_assurance_maladie('{I}')$q$, '22023', 'Un paiement de cet import est associé à un crédit du relevé : le cabinet défait d''abord cette association.'),
      (31, '31. défaite, l''import se retire', $q$select 1 from {ASSOCIER}; select 1 from defaire_association_assurance_maladie('{DB}', '{L1}')$q$, null, 'chef',
        $q$select (r.id::text = '{I}')::text from retirer_import_assurance_maladie('{I}') r$q$, 'OK', 'true'),
      (32, '32. le client n''écrit pas en direct (la garde, avant la RLS)', null, null, 'client',
        $q$insert into paiements_assurance_maladie_mouvements (dossier_id, paiement_id, ligne_bancaire_id, associe_par) values ('{DB}', '{P1}', '{L1}', '{CLIENT}') returning 1$q$,
        '42501', 'Les associations des paiements de l''assurance maladie ne s''écrivent que par leur fonction.'),
      (33, '33. un membre qui n''est pas super-administrateur non plus', null, null, 'chef_simple',
        $q$insert into paiements_assurance_maladie_mouvements (dossier_id, paiement_id, ligne_bancaire_id, associe_par) values ('{DB}', '{P1}', '{L1}', '{CLIENT}') returning 1$q$,
        '42501', 'Les associations des paiements de l''assurance maladie ne s''écrivent que par leur fonction.'),
      (34, '34. ni le rôle des Edge Functions, qui passe la RLS', null, null, 'service',
        $q$insert into paiements_assurance_maladie_mouvements (dossier_id, paiement_id, ligne_bancaire_id, associe_par) values ('{DB}', '{P1}', '{L1}', '{CHEF}') returning 1$q$,
        '42501', 'Les associations des paiements de l''assurance maladie ne s''écrivent que par leur fonction.'),
      (35, '35. le super-administrateur insère en direct : la restauration', null, null, 'chef',
        $q$insert into paiements_assurance_maladie_mouvements (dossier_id, paiement_id, ligne_bancaire_id, associe_par) values ('{DB}', '{P1}', '{L1}', '{CHEF}') returning 1$q$, 'OK', '1'),
      (36, '36. … mais pas un paiement d''un autre dossier (23514)', null, null, 'chef',
        $q$insert into paiements_assurance_maladie_mouvements (dossier_id, paiement_id, ligne_bancaire_id, associe_par) values ('{DB}', '{PX}', '{L1}', '{CHEF}') returning 1$q$,
        '23514', 'Une association tient un paiement et un mouvement de son dossier.'),
      (37, '37. le rôle des Edge Functions ne réécrit pas une association (la garde)', 'select 1 from {ASSOCIER}', null, 'service',
        $q$update paiements_assurance_maladie_mouvements set associe_le = associe_le where dossier_id = '{DB}' returning 1$q$, '23514',
        'Une association d''un paiement de l''assurance maladie ne se modifie pas : elle se défait et se refait.'),
      (38, '38. le super-administrateur ne réécrit rien : aucune policy de mise à jour', 'select 1 from {ASSOCIER}', null, 'chef',
        $q$with t as (update paiements_assurance_maladie_mouvements set associe_le = associe_le where dossier_id = '{DB}' returning 1) select count(*)::text from t$q$, 'OK', '0'),
      (39, '39. associé, le crédit reste libre de son classement (hors du seul rapprochement)', 'select 1 from {ASSOCIER}', null, 'chef',
        $q$select l.statut || ' ' || mouvement_libre(l) || ' ' || (select count(*) from paiements_assurance_maladie_mouvements a where a.ligne_bancaire_id = l.id) from lignes_bancaires l where l.id = '{L1}'$q$, 'OK', 'non_rapprochee true 1'),
      (40, '40. aucun connecté n''exécute les deux gardes', null, null, 'client',
        $q$select has_function_privilege('authenticated', 'public.garder_paiements_assurance_maladie_mouvements()', 'execute') || ' ' || has_function_privilege('authenticated', 'public.retenir_import_associe()', 'execute')$q$,
        'OK', 'false false')
    ) as t(rang, etape, pose, pose_proprietaire, profil, requete, code, attendu) loop
      v_code := 'OK'; v_msg := null; v_obs := null;
      begin
        if e.profil = 'chef_simple' then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client::uuid, cabinet, 'comptable_en_chef');
        end if;
        if e.pose is not null then
          v_pose := replace(e.pose, '{ASSOCIER}', associer);
          for r in select * from jsonb_each_text(jeu) loop v_pose := replace(v_pose, r.key, r.value); end loop;
          execute 'set local role authenticated';
          perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
          execute v_pose;
          reset role;
          perform set_config('request.jwt.claims', '', true);
        end if;
        if e.pose_proprietaire is not null then
          v_pose := replace(e.pose_proprietaire, '{VALIDER}', valider);
          for r in select * from jsonb_each_text(jeu) loop v_pose := replace(v_pose, r.key, r.value); end loop;
          execute v_pose;
        end if;
        v_req := replace(e.requete, '{ASSOCIER}', associer);
        for r in select * from jsonb_each_text(jeu) loop v_req := replace(v_req, r.key, r.value); end loop;
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
        'ok', v_code = e.code and v_msg = replace(replace(e.attendu, '{FORME}', forme), '{CLIENT}', client),
        'observe', v_code || ' ' || coalesce(v_msg, '-'));
    end loop;

    -- Le catalogue : la RLS ; trois policies permissives à authenticated, aux expressions exactes (la restrictive
    -- `deux_facteurs` mise à part) ; la garde avant chaque écriture, la retenue avant le retrait d'un import ; aucune colonne
    -- de texte ; la clé vers le paiement sans action à la suppression ; les deux fonctions aux droits du propriétaire.
    verdicts := verdicts || jsonb_build_object('rang', 41, 'etape', '41. le catalogue : RLS, trois policies à authenticated, les deux gardes, aucune colonne de texte, la clé qui retient, les fonctions',
      'ok', (select c.relrowsecurity from pg_class c where c.oid = 'public.paiements_assurance_maladie_mouvements'::regclass)
        and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'paiements_assurance_maladie_mouvements'
               and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) = 3
        and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'paiements_assurance_maladie_mouvements'
               and p.roles = array['authenticated']::name[] and p.permissive = 'PERMISSIVE'
               and ((p.policyname = p.tablename || '_lecture' and p.cmd = 'SELECT' and p.qual = 'admin_du_dossier(dossier_id)' and p.with_check is null)
                 or (p.policyname = p.tablename || '_lecture_banque' and p.cmd = 'SELECT'
                     and p.qual = 'client_du_dossier(dossier_id, ''banque''::text)' and p.with_check is null)
                 or (p.policyname = p.tablename || '_restauration' and p.cmd = 'INSERT' and p.qual is null and p.with_check = 'is_super_admin()'))) = 3
        and (select count(*) from pg_trigger t where not t.tgisinternal and t.tgtype = 31
               and t.tgfoid = 'public.garder_paiements_assurance_maladie_mouvements()'::regprocedure
               and t.tgrelid = 'public.paiements_assurance_maladie_mouvements'::regclass) = 1
        and (select count(*) from pg_trigger t where not t.tgisinternal and t.tgtype = 11
               and t.tgfoid = 'public.retenir_import_associe()'::regprocedure and t.tgrelid = 'public.imports_assurance_maladie'::regclass) = 1
        and not exists (select 1 from pg_attribute a
               where a.attrelid = 'public.paiements_assurance_maladie_mouvements'::regclass and a.attnum > 0 and not a.attisdropped
                 and a.atttypid in ('text'::regtype, 'varchar'::regtype, 'bpchar'::regtype, 'json'::regtype, 'jsonb'::regtype))
        and (select c.confdeltype from pg_constraint c where c.conrelid = 'public.paiements_assurance_maladie_mouvements'::regclass
               and c.contype = 'f' and c.confrelid = 'public.paiements_assurance_maladie'::regclass) = 'a'
        and (select count(*) from pg_proc p
               where p.oid in ('public.associer_paiements_assurance_maladie(uuid, uuid[], uuid[])'::regprocedure,
                               'public.defaire_association_assurance_maladie(uuid, uuid)'::regprocedure)
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

  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni leur accès, ni leurs mouvements, paiements et associations, ni le compte d''essai dans le cabinet',
    'ok', not exists (select 1 from dossiers where id in ((jeu ->> '{DB}')::uuid, (jeu ->> '{DX}')::uuid))
      and not exists (select 1 from memberships where id = (jeu ->> '{AB}')::uuid)
      and not exists (select 1 from lignes_bancaires where dossier_id in ((jeu ->> '{DB}')::uuid, (jeu ->> '{DX}')::uuid))
      and not exists (select 1 from paiements_assurance_maladie where dossier_id in ((jeu ->> '{DB}')::uuid, (jeu ->> '{DX}')::uuid))
      and not exists (select 1 from paiements_assurance_maladie_mouvements where dossier_id in ((jeu ->> '{DB}')::uuid, (jeu ->> '{DX}')::uuid))
      and not exists (select 1 from cabinet_admins where user_id::text = client),
    'observe', 'relu');
  perform set_config('essai.association_assurance_maladie', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.association_assurance_maladie')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
