-- L'EXEMPLAIRE D'UNE FACTURE ÉMISE, ÉPROUVÉ EN BASE (ligne 28.6, chantier EC-Q3, étape VF1a ; migration
-- `exemplaires_des_factures`) — à rejouer par `execute_sql` après toute migration qui touche `pieces.facture_id`, la garde
-- `garder_exemplaire_facture`, `designer_exemplaire_facture`, `defaire_exemplaire_facture`, les policies ou les gardes de
-- `pieces`, la garde des factures validées, `exercice_figeant_la_piece`, `admin_du_dossier`, `memberships` ou
-- `cabinet_admins`.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - QUI DÉSIGNE ET DÉFAIT, par impersonation : un anonyme n'a pas le droit d'appeler ; un compte rattaché à rien, le
--     client — sur un dossier qui n'est pas le sien, sur le SIEN sans case, sur le sien avec « Ventes » et « Banque » —, un
--     membre du cabinet affecté à un AUTRE dossier se font refuser l'accès au dossier, comme un dossier qui n'existe pas ;
--     le chef du cabinet (super-administrateur), un chef qui ne l'est pas et un membre affecté au dossier le font ;
--   - CE QUI SE REFUSE, avec sa RAISON, dans l'ordre des deux fonctions — que src/lib/exemplairesDesFactures.test.ts relit
--     ici et rejoue appel par appel : la pièce introuvable dans le dossier, une pièce qui n'est pas une vente, une pièce
--     figée par une écriture validée, une pièce déjà désignée (à cette facture, à une autre), la facture introuvable dans
--     le dossier, un brouillon ; pour défaire : une pièce que rien ne désigne, une pièce figée ; et l'ordre des refus quand
--     deux tiennent ensemble ;
--   - CE QUI S'ÉCRIT : la désignation, et elle seule ; plusieurs exemplaires d'une même facture ; l'exemplaire d'un avoir ;
--     défaire, puis désigner de nouveau ; le réglage `jd.exemplaire_facture` retiré après chaque appel ;
--   - CE QUE LA GARDE TIENT SANS LES FONCTIONS : personne — le cabinet par sa policy, le propriétaire, le rôle des Edge
--     Functions — ne pose, ne retire ni ne change la désignation directement ; le client qui dépose une pièce ne la pose
--     pas, et son dépôt ordinaire passe toujours ; il ne met à jour aucune pièce ; la restauration par le
--     super-administrateur réinsère une pièce désignée, mais jamais d'une facture d'un autre dossier, d'un brouillon, d'une
--     facture qui n'existe pas, ni sur une pièce qui n'est pas une vente ; une pièce désignée ne change ni de dossier ni de
--     nature, une pièce qui ne l'est pas, si ; tout le reste d'une pièce désignée se modifie comme avant ; le réglage d'une
--     autre pièce n'ouvre rien ; le gel de la validation tient la désignation même sous un réglage forgé ;
--   - QUI LIT la désignation : le client du dossier, comme toute la ligne de ses pièces, le membre affecté ; personne
--     d'autre ;
--   - CE QUE LE CATALOGUE DIT : la colonne, sa clé sans action à la suppression, son index, le déclencheur, la sécurité
--     et le chemin des trois fonctions, leurs droits d'exécution, les policies de `pieces` inchangées, la garde des pièces
--     figées qui compare toujours la ligne entière ;
--   - LES MUTATIONS (contrôles 140 à 149) : chacune rejoue un contrôle avec un profil, une cible ou un réglage
--     délibérément faux, et doit MORDRE — rendre ce que le contrôle qu'elle vise refuse ;
--   - et que RIEN ne reste en base.
--
-- SANS LA MIGRATION, une seule ligne le dit, « EN ATTENTE », SANS être une faute : elle est présentée au cabinet avant
-- d'être appliquée, et une base qui ne la porte pas se rejoue aussi. Elle EN EST UNE si l'historique porte
-- `exemplaires_des_factures` sans la colonne — sauf si une ligne `retour_exemplaires_des_factures`, plus récente, dit son
-- retour arrière.
--
-- CE QUI NE SE JOUE PAS ICI, ET SE JOUE SUR UNE RÉPLIQUE LOCALE dont signature.sql montre les neuf familles égales à la
-- production : la suppression d'une pièce désignée et celle d'un dossier dont des pièces sont désignées (la clé sans
-- action se vérifie à la fin de l'instruction de la cascade), et deux désignations concurrentes de la même pièce —
-- l'outil d'exécution soumet une suppression à une confirmation qui n'arrive pas ici.
--
-- Tout se joue dans deux dossiers JETABLES du cabinet du dossier `test`, au sein d'un bloc qui s'annule entièrement à la
-- fin (`ANNULATION_ESSAI_GLOBALE`) ; chaque contrôle dans sa sous-transaction, annulée elle aussi (`ANNULATION_ESSAI`,
-- P0001) — le moteur d'étapes de regimesEreporting.sql, ses six genres (`jeu`, `controle`, `fait`, `valeur`, `retenir`,
-- `lecture`) et ses profils (« membre » affecté au dossier T, « membre_ailleurs » affecté au dossier A, « chef_simple »,
-- chef du cabinet sans être super-administrateur : le compte client rattaché au cabinet le temps de la sous-transaction),
-- et deux de plus : « client_t », un accès du compte client au dossier T, sans case, et « client_t_ventes », le même avec
-- « Ventes » et « Banque », posés le temps de la sous-transaction. Les factures validées du jeu et les écritures validées
-- qui figent trois pièces entrent par la porte de la restauration, que le super-administrateur seul passe, dans un
-- dossier sans série ni exercice validé. Un refus se juge à son code ET à son message (motif LIKE) ; une valeur lue, au
-- texte exact, ses identifiants jetables remplacés. Les identifiants jetables sont FIXES (préfixe `f1a00000`). Les
-- verdicts voyagent dans un réglage LOCAL à la transaction (`essai.exemplaires_des_factures`) : hors de l'outil
-- d'exécution, le fichier se joue en UNE transaction (`psql -1`). Aucune instruction de suppression, aucune mise à jour
-- sans `where`.
do $essai$
declare
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  inconnu uuid := gen_random_uuid();
  dossier_test uuid := '001c7ed7-c23b-4590-901e-693489f8af24';
  cabinet uuid;
  applique text; retour text;
  ids jsonb;
  etapes text[];
  etape text[];
  cle text; valeur text; s text; attendu text;
  accepte boolean; code_recu text; message text; obs text;
  avant text; apres text;
  verdicts jsonb := '[]'::jsonb;
begin
  -- La migration d'abord : sans elle, une ligne le dit, en faute seulement si l'historique la porte sans retour arrière.
  if not exists (select 1 from pg_attribute where attrelid = 'public.pieces'::regclass and attname = 'facture_id' and not attisdropped)
     or to_regprocedure('public.designer_exemplaire_facture(uuid, uuid, uuid)') is null then
    select max(version) filter (where name = 'exemplaires_des_factures'), max(version) filter (where name = 'retour_exemplaires_des_factures')
      into applique, retour from supabase_migrations.schema_migrations;
    verdicts := verdicts || jsonb_build_object('controle', '0. EN ATTENTE : la migration exemplaires_des_factures (étape VF1a) n''est pas en base',
      'observe', 'historique : ' || coalesce('exemplaires_des_factures ' || applique, 'sans exemplaires_des_factures')
                 || coalesce(', retour_exemplaires_des_factures ' || retour, ''),
      'ok', applique is null or (retour is not null and retour > applique));
    perform set_config('essai.exemplaires_des_factures', verdicts::text, true);
    return;
  end if;

  select cabinet_id into cabinet from dossiers where id = dossier_test;
  if cabinet is null
     or not exists (select 1 from super_admins where user_id = chef)
     or not exists (select 1 from cabinet_admins where user_id = chef and cabinet_id = cabinet and role = 'comptable_en_chef')
     or not exists (select 1 from auth.users where id = client)
     or exists (select 1 from cabinet_admins where user_id = client) or exists (select 1 from super_admins where user_id = client) then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable, ou client déjà rattaché au cabinet';
  end if;

  ids := jsonb_build_object('CAB', cabinet, 'AUTRE', gen_random_uuid())
    || jsonb_build_object('T', 'f1a00000-0000-4000-8000-0000000000a1', 'A', 'f1a00000-0000-4000-8000-0000000000a3')
    || jsonb_build_object(
      'F1', 'f1a00000-0000-4000-8001-000000000001', 'F2', 'f1a00000-0000-4000-8001-000000000002',
      'AV', 'f1a00000-0000-4000-8001-000000000003', 'FB', 'f1a00000-0000-4000-8001-000000000004',
      'FA', 'f1a00000-0000-4000-8001-000000000005')
    || jsonb_build_object(
      'PV1', 'f1a00000-0000-4000-8002-000000000001', 'PV2', 'f1a00000-0000-4000-8002-000000000002',
      'PV3', 'f1a00000-0000-4000-8002-000000000003', 'PV4', 'f1a00000-0000-4000-8002-000000000004',
      'PV5', 'f1a00000-0000-4000-8002-000000000005', 'PACH', 'f1a00000-0000-4000-8002-000000000006',
      'PNDF', 'f1a00000-0000-4000-8002-000000000007', 'PAUT', 'f1a00000-0000-4000-8002-000000000008',
      'PFIG', 'f1a00000-0000-4000-8002-000000000009', 'PFIG2', 'f1a00000-0000-4000-8002-00000000000a',
      'PFIGA', 'f1a00000-0000-4000-8002-00000000000b', 'PDEP', 'f1a00000-0000-4000-8002-00000000000c',
      'PX', 'f1a00000-0000-4000-8002-00000000000d', 'PN', 'f1a00000-0000-4000-8002-0000000000f1')
    || jsonb_build_object('E1', 'f1a00000-0000-4000-8003-000000000001', 'E2', 'f1a00000-0000-4000-8003-000000000002',
      'E3', 'f1a00000-0000-4000-8003-000000000003');

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from pieces)), ((select count(*) from pieces where facture_id is not null)),
    ((select count(*) from factures_emises)), ((select count(*) from ecritures_brouillon)), ((select count(*) from cabinet_admins)),
    ((select count(*) from dossier_assignations)), ((select count(*) from memberships)), ((select count(*) from facture_numerotation))
  ) as t(n);

  -- Une étape : {genre, contrôle, qui, requête, code attendu, message attendu (motif LIKE) ou valeur attendue}.
  etapes := array[
    -- ══ Le jeu : deux dossiers jetables, leurs factures, leurs pièces, trois désignations, trois pièces figées ══════
    array['jeu', 'dossiers jetables', 'postgres', $q$insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values
      ('{T}', 'ESSAI EXEMPLAIRES T', '{CAB}', 'tresorerie', '455000'), ('{A}', 'ESSAI EXEMPLAIRES A', '{CAB}', 'tresorerie', '455000')$q$, '', ''],
    array['fait', '0. le jeu : les factures de T et de A, validées par la porte de la restauration, et un brouillon', 'chef', $q$insert into factures_emises (id, dossier_id, numero, statut, type, facture_origine_id, date_emission, tiers_nom, montant_ht, montant_tva, montant_ttc, emetteur_siret, validated_at) values
      ('{F1}', '{T}', 'F2026-0001', 'validee', 'facture', null, '2026-03-14', 'CLIENT ESSAI', 100, 20, 120, '12345678900012', '2026-03-14 10:00:00+00'),
      ('{F2}', '{T}', 'F2026-0002', 'validee', 'facture', null, '2026-03-15', 'CLIENT ESSAI', 50, 10, 60, '12345678900012', '2026-03-14 10:00:00+00'),
      ('{AV}', '{T}', 'A2026-0001', 'validee', 'avoir', '{F1}', '2026-03-20', 'CLIENT ESSAI', -100, -20, -120, '12345678900012', '2026-03-14 10:00:00+00'),
      ('{FB}', '{T}', null, 'brouillon', 'facture', null, '2026-03-21', 'CLIENT ESSAI', 10, 2, 12, null, null),
      ('{FA}', '{A}', 'F2026-0001', 'validee', 'facture', null, '2026-03-14', 'CLIENT ESSAI', 100, 20, 120, '98765432100019', '2026-03-14 10:00:00+00')$q$, 'OK', ''],
    array['jeu', 'pièces de T et de A', 'postgres', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut, date_piece, montant_ttc) values
      ('{PV1}', '{T}', '{T}/essai-vf1a-pv1.pdf', 'essai-vf1a-pv1.pdf', 'vente', 'a_valider', '2026-03-14', 120),
      ('{PV2}', '{T}', '{T}/essai-vf1a-pv2.pdf', 'essai-vf1a-pv2.pdf', 'vente', 'validee', '2026-03-14', 120),
      ('{PV3}', '{T}', '{T}/essai-vf1a-pv3.pdf', 'essai-vf1a-pv3.pdf', 'vente', 'a_valider', '2026-03-20', -120),
      ('{PV4}', '{T}', '{T}/essai-vf1a-pv4.pdf', 'essai-vf1a-pv4.pdf', 'vente', 'a_valider', '2026-03-15', 60),
      ('{PV5}', '{T}', '{T}/essai-vf1a-pv5.pdf', 'essai-vf1a-pv5.pdf', 'vente', 'a_valider', '2026-03-14', 120),
      ('{PACH}', '{T}', '{T}/essai-vf1a-pach.pdf', 'essai-vf1a-pach.pdf', 'achat', 'a_valider', '2026-03-10', 30),
      ('{PNDF}', '{T}', '{T}/essai-vf1a-pndf.pdf', 'essai-vf1a-pndf.pdf', 'note_frais', 'a_valider', '2026-03-11', 20),
      ('{PAUT}', '{T}', '{T}/essai-vf1a-paut.pdf', 'essai-vf1a-paut.pdf', 'autre', 'a_valider', '2026-03-12', 10),
      ('{PFIG}', '{T}', '{T}/essai-vf1a-pfig.pdf', 'essai-vf1a-pfig.pdf', 'vente', 'validee', '2026-02-10', 50),
      ('{PFIG2}', '{T}', '{T}/essai-vf1a-pfig2.pdf', 'essai-vf1a-pfig2.pdf', 'vente', 'validee', '2026-02-11', 120),
      ('{PFIGA}', '{T}', '{T}/essai-vf1a-pfiga.pdf', 'essai-vf1a-pfiga.pdf', 'achat', 'validee', '2026-02-12', 40),
      ('{PDEP}', '{T}', '{T}/essai-vf1a-pdep.pdf', 'essai-vf1a-pdep.pdf', 'vente', 'a_valider', '2026-03-16', 70),
      ('{PX}', '{A}', '{A}/essai-vf1a-px.pdf', 'essai-vf1a-px.pdf', 'vente', 'a_valider', '2026-03-14', 120)$q$, '', ''],
    array['fait', '0. le jeu : PV4 exemplaire de F2, PV5 et PFIG2 de F1', 'chef', $q$select designer_exemplaire_facture('{T}', '{PV4}', '{F2}'), designer_exemplaire_facture('{T}', '{PV5}', '{F1}'), designer_exemplaire_facture('{T}', '{PFIG2}', '{F1}')$q$, 'OK', ''],
    array['fait', '0. le jeu : les écritures validées qui figent PFIG, PFIG2 et PFIGA (exercice 2026), par la porte de la restauration', 'chef', $q$insert into ecritures_brouillon (id, dossier_id, piece_id, date, compte, libelle, montant, sens, statut, valide_le, journal_code, numero_ecriture, piece_ref, piece_date, compte_lib) values
      ('{E1}', '{T}', '{PFIG}', '2026-02-10', '706000', 'ESSAI PFIG', 50, 'credit', 'validee', '2026-10-01 10:00:00+00', 'VE', 1, 'ESSAI PFIG', '2026-02-10', 'Prestations'),
      ('{E2}', '{T}', '{PFIG2}', '2026-02-11', '706000', 'ESSAI PFIG2', 120, 'credit', 'validee', '2026-10-01 10:00:00+00', 'VE', 2, 'ESSAI PFIG2', '2026-02-11', 'Prestations'),
      ('{E3}', '{T}', '{PFIGA}', '2026-02-12', '606100', 'ESSAI PFIGA', 40, 'debit', 'validee', '2026-10-01 10:00:00+00', 'AC', 3, 'ESSAI PFIGA', '2026-02-12', 'Achats')$q$, 'OK', ''],

    -- ══ 1 à 10. Qui désigne ══════════
    array['controle', '1. anonyme : pas le droit d''appeler', 'anon', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{F1}')$q$,
      '42501', 'permission denied for function designer_exemplaire_facture'],
    array['controle', '2. rattaché à rien : l''accès au dossier, avant de rien lire', 'inconnu', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{F1}')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '3. client, un dossier qui n''est pas le sien', 'client', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{F1}')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '4. client, son propre dossier, sans case', 'client_t', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{F1}')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '5. client, son propre dossier, avec « Ventes » et « Banque »', 'client_t_ventes', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{F1}')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '6. membre du cabinet affecté à un AUTRE dossier', 'membre_ailleurs', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{F1}')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '7. un dossier qui n''existe pas, même pour le super-administrateur', 'chef', $q$select designer_exemplaire_facture('{AUTRE}', '{PV1}', '{F1}')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '8. le membre affecté au dossier désigne', 'membre', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{F1}')$q$, 'OK', ''],
    array['controle', '9. un chef du cabinet qui n''est pas super-administrateur désigne', 'chef_simple', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{F1}')$q$, 'OK', ''],
    array['controle', '10. le chef du cabinet, super-administrateur, désigne', 'chef', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{F1}')$q$, 'OK', ''],

    -- ══ 11 à 22. Les refus de la désignation, dans l'ordre de la fonction ══════════
    array['controle', '11. la pièce d''un autre dossier : introuvable dans celui-ci', 'chef', $q$select designer_exemplaire_facture('{T}', '{PX}', '{F1}')$q$,
      'P0002', 'Pièce introuvable dans ce dossier.'],
    array['controle', '12. une pièce qui n''existe pas', 'chef', $q$select designer_exemplaire_facture('{T}', '{AUTRE}', '{F1}')$q$,
      'P0002', 'Pièce introuvable dans ce dossier.'],
    array['controle', '13. un achat n''est l''exemplaire d''aucune facture émise', 'chef', $q$select designer_exemplaire_facture('{T}', '{PACH}', '{F1}')$q$,
      '22023', 'Seule une pièce de vente est l''exemplaire d''une facture émise.'],
    array['controle', '14. une note de frais non plus', 'chef', $q$select designer_exemplaire_facture('{T}', '{PNDF}', '{F1}')$q$,
      '22023', 'Seule une pièce de vente est l''exemplaire d''une facture émise.'],
    array['controle', '15. une pièce « autre » non plus', 'chef', $q$select designer_exemplaire_facture('{T}', '{PAUT}', '{F1}')$q$,
      '22023', 'Seule une pièce de vente est l''exemplaire d''une facture émise.'],
    array['controle', '16. une pièce figée par une écriture validée ne se désigne plus', 'chef', $q$select designer_exemplaire_facture('{T}', '{PFIG}', '{F1}')$q$,
      '22023', 'Cette pièce porte une écriture validée de l''exercice 2026 : sa désignation ne change plus.'],
    array['controle', '17. une pièce déjà exemplaire de cette facture', 'chef', $q$select designer_exemplaire_facture('{T}', '{PV4}', '{F2}')$q$,
      '22023', 'Cette pièce est déjà l''exemplaire de la facture F2026-0002.'],
    array['controle', '18. une pièce déjà exemplaire d''une autre facture : défaire d''abord', 'chef', $q$select designer_exemplaire_facture('{T}', '{PV4}', '{F1}')$q$,
      '22023', 'Cette pièce est déjà l''exemplaire de la facture F2026-0002 : défaire cette désignation avant d''en faire une autre.'],
    array['controle', '19. la facture d''un autre dossier : introuvable dans celui-ci', 'chef', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{FA}')$q$,
      'P0002', 'Facture introuvable dans ce dossier.'],
    array['controle', '20. une facture qui n''existe pas', 'chef', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{AUTRE}')$q$,
      'P0002', 'Facture introuvable dans ce dossier.'],
    array['controle', '21. aucune facture', 'chef', $q$select designer_exemplaire_facture('{T}', '{PV1}', null)$q$,
      'P0002', 'Facture introuvable dans ce dossier.'],
    array['controle', '22. un brouillon n''a pas d''exemplaire', 'chef', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{FB}')$q$,
      '22023', 'Seule une facture validée a un exemplaire : un brouillon n''est pas encore une facture émise.'],

    -- ══ 23 à 27. Deux refus ensemble : le premier dans l'ordre de la fonction ══════════
    array['controle', '23. un achat, avec un brouillon : la nature de la pièce d''abord', 'chef', $q$select designer_exemplaire_facture('{T}', '{PACH}', '{FB}')$q$,
      '22023', 'Seule une pièce de vente est l''exemplaire d''une facture émise.'],
    array['controle', '24. un achat figé : la nature de la pièce avant son gel', 'chef', $q$select designer_exemplaire_facture('{T}', '{PFIGA}', '{F1}')$q$,
      '22023', 'Seule une pièce de vente est l''exemplaire d''une facture émise.'],
    array['controle', '25. une pièce figée, déjà désignée : le gel avant la désignation', 'chef', $q$select designer_exemplaire_facture('{T}', '{PFIG2}', '{F2}')$q$,
      '22023', 'Cette pièce porte une écriture validée de l''exercice 2026 : sa désignation ne change plus.'],
    array['controle', '26. une pièce déjà désignée, avec la facture d''un autre dossier : la désignation avant la facture', 'chef', $q$select designer_exemplaire_facture('{T}', '{PV4}', '{FA}')$q$,
      '22023', 'Cette pièce est déjà l''exemplaire de la facture F2026-0002 : défaire cette désignation avant d''en faire une autre.'],
    array['controle', '27. la pièce d''un autre dossier, avec un brouillon : la pièce avant la facture', 'chef', $q$select designer_exemplaire_facture('{T}', '{PX}', '{FB}')$q$,
      'P0002', 'Pièce introuvable dans ce dossier.'],

    -- ══ 28 à 35. Ce qui s'écrit ══════════
    array['lecture', '28. la désignation s''écrit, et la fonction rend la pièce écrite', 'chef', $q$select (p).id || ' ' || (p).facture_id from (select designer_exemplaire_facture('{T}', '{PV1}', '{F1}') as p) x$q$,
      '', '{PV1} {F1}'],
    array['lecture', '29. elle seule : le reste de la pièce n''a pas bougé', 'chef', $q$select ((select to_jsonb(p) - 'facture_id' from pieces p where p.id = '{PV1}') = (select to_jsonb(d) - 'facture_id' from designer_exemplaire_facture('{T}', '{PV1}', '{F1}') d))::text$q$,
      '', 'true'],
    array['lecture', '30. plusieurs exemplaires d''une même facture : une pièce à valider, une validée, et celles du jeu', 'chef', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{F1}'); select designer_exemplaire_facture('{T}', '{PV2}', '{F1}'); select string_agg(nom_fichier, ',' order by nom_fichier collate "C") from pieces where facture_id = '{F1}'$q$,
      '', 'essai-vf1a-pfig2.pdf,essai-vf1a-pv1.pdf,essai-vf1a-pv2.pdf,essai-vf1a-pv5.pdf'],
    array['lecture', '31. un avoir a son exemplaire', 'chef', $q$select designer_exemplaire_facture('{T}', '{PV3}', '{AV}'); select facture_id::text from pieces where id = '{PV3}'$q$,
      '', '{AV}'],
    array['lecture', '32. le réglage est retiré après l''appel : il ne laisse rien ouvert derrière lui', 'chef', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{F1}'); select '[' || coalesce(current_setting('jd.exemplaire_facture', true), 'nul') || ']'$q$,
      '', '[]'],
    array['controle', '33. après l''appel, une écriture directe de la même pièce est refusée', 'chef', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{F1}'); update pieces set facture_id = null where id = '{PV1}'$q$,
      '42501', 'Une pièce ne se désigne exemplaire d''une facture, et ne cesse de l''être, que par l''application.'],
    array['lecture', '34. défaire, puis désigner de nouveau, à une autre facture', 'chef', $q$select defaire_exemplaire_facture('{T}', '{PV4}'); select designer_exemplaire_facture('{T}', '{PV4}', '{F1}'); select facture_id::text from pieces where id = '{PV4}'$q$,
      '', '{F1}'],
    array['lecture', '35. défaire : la désignation, et elle seule — la fonction rend la pièce écrite', 'chef', $q$select ((select to_jsonb(p) - 'facture_id' from pieces p where p.id = '{PV5}') = (select to_jsonb(d) - 'facture_id' from defaire_exemplaire_facture('{T}', '{PV5}') d) and (select facture_id from pieces p where p.id = '{PV5}') is not null)::text$q$,
      '', 'true'],
    array['lecture', '36. défaire : la pièce ne désigne plus rien', 'chef', $q$select defaire_exemplaire_facture('{T}', '{PV5}'); select coalesce((select facture_id::text from pieces where id = '{PV5}'), 'nulle')$q$,
      '', 'nulle'],

    -- ══ 40 à 52. Qui défait, et les refus, dans l'ordre de la fonction ══════════
    array['controle', '40. anonyme : pas le droit d''appeler', 'anon', $q$select defaire_exemplaire_facture('{T}', '{PV5}')$q$,
      '42501', 'permission denied for function defaire_exemplaire_facture'],
    array['controle', '41. rattaché à rien', 'inconnu', $q$select defaire_exemplaire_facture('{T}', '{PV5}')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '42. client, un dossier qui n''est pas le sien', 'client', $q$select defaire_exemplaire_facture('{T}', '{PV5}')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '43. client, son propre dossier, sans case', 'client_t', $q$select defaire_exemplaire_facture('{T}', '{PV5}')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '44. client, son propre dossier, avec « Ventes » et « Banque »', 'client_t_ventes', $q$select defaire_exemplaire_facture('{T}', '{PV5}')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '45. membre du cabinet affecté à un AUTRE dossier', 'membre_ailleurs', $q$select defaire_exemplaire_facture('{T}', '{PV5}')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '46. un dossier qui n''existe pas', 'chef', $q$select defaire_exemplaire_facture('{AUTRE}', '{PV5}')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '47. la pièce d''un autre dossier : introuvable dans celui-ci', 'chef', $q$select defaire_exemplaire_facture('{T}', '{PX}')$q$,
      'P0002', 'Pièce introuvable dans ce dossier.'],
    array['controle', '48. une pièce que rien ne désigne', 'chef', $q$select defaire_exemplaire_facture('{T}', '{PV1}')$q$,
      '22023', 'Cette pièce n''est l''exemplaire d''aucune facture.'],
    array['controle', '49. une pièce désignée, figée ensuite par une écriture validée', 'chef', $q$select defaire_exemplaire_facture('{T}', '{PFIG2}')$q$,
      '22023', 'Cette pièce porte une écriture validée de l''exercice 2026 : sa désignation ne change plus.'],
    array['controle', '50. une pièce figée que rien ne désigne : la désignation avant le gel', 'chef', $q$select defaire_exemplaire_facture('{T}', '{PFIG}')$q$,
      '22023', 'Cette pièce n''est l''exemplaire d''aucune facture.'],
    array['controle', '51. le membre affecté au dossier défait', 'membre', $q$select defaire_exemplaire_facture('{T}', '{PV5}')$q$, 'OK', ''],
    array['controle', '52. un chef qui n''est pas super-administrateur défait', 'chef_simple', $q$select defaire_exemplaire_facture('{T}', '{PV5}')$q$, 'OK', ''],

    -- ══ 60 à 79. Ce que la garde tient sans les fonctions ══════════
    array['controle', '60. le cabinet ne pose pas la désignation par sa policy', 'chef', $q$update pieces set facture_id = '{F1}' where id = '{PV1}'$q$,
      '42501', 'Une pièce ne se désigne exemplaire d''une facture, et ne cesse de l''être, que par l''application.'],
    array['controle', '61. ni ne la retire', 'chef', $q$update pieces set facture_id = null where id = '{PV4}'$q$,
      '42501', 'Une pièce ne se désigne exemplaire d''une facture, et ne cesse de l''être, que par l''application.'],
    array['controle', '62. ni ne la change d''une facture à une autre', 'chef', $q$update pieces set facture_id = '{F1}' where id = '{PV4}'$q$,
      '42501', 'Une pièce ne se désigne exemplaire d''une facture, et ne cesse de l''être, que par l''application.'],
    array['controle', '63. le membre affecté non plus', 'membre', $q$update pieces set facture_id = '{F1}' where id = '{PV1}'$q$,
      '42501', 'Une pièce ne se désigne exemplaire d''une facture, et ne cesse de l''être, que par l''application.'],
    array['controle', '64. le propriétaire non plus — ni, à plus forte raison, le rôle des Edge Functions', 'postgres', $q$update pieces set facture_id = '{F1}' where id = '{PV1}'$q$,
      '42501', 'Une pièce ne se désigne exemplaire d''une facture, et ne cesse de l''être, que par l''application.'],
    array['controle', '65. le client qui dépose une pièce dans son dossier ne la dit pas exemplaire d''une facture', 'client_t', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, facture_id) values ('{PN}', '{T}', '{T}/essai-vf1a-pn.pdf', 'essai-vf1a-pn.pdf', 'vente', '{F1}')$q$,
      '42501', 'Une pièce ne se désigne exemplaire d''une facture, et ne cesse de l''être, que par l''application.'],
    array['controle', '66. son dépôt ordinaire passe toujours', 'client_t', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece) values ('{PN}', '{T}', '{T}/essai-vf1a-pn.pdf', 'essai-vf1a-pn.pdf', 'vente')$q$, 'OK', ''],
    array['controle', '67. le client « Ventes » non plus', 'client_t_ventes', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, facture_id) values ('{PN}', '{T}', '{T}/essai-vf1a-pn.pdf', 'essai-vf1a-pn.pdf', 'vente', '{F1}')$q$,
      '42501', 'Une pièce ne se désigne exemplaire d''une facture, et ne cesse de l''être, que par l''application.'],
    array['lecture', '68. le client ne met à jour aucune pièce de son dossier — la désignation pas davantage', 'client_t', $q$with m as (update pieces set facture_id = '{F1}' where id = '{PV1}' returning 1) select count(*)::text from m$q$,
      '', '0'],
    array['controle', '69. un chef qui n''est pas super-administrateur n''insère pas une pièce désignée', 'chef_simple', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, facture_id) values ('{PN}', '{T}', '{T}/essai-vf1a-pn.pdf', 'essai-vf1a-pn.pdf', 'vente', '{F1}')$q$,
      '42501', 'Une pièce ne se désigne exemplaire d''une facture, et ne cesse de l''être, que par l''application.'],
    array['controle', '70. le propriétaire non plus : une Edge Function n''importe pas une pièce désignée', 'postgres', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, facture_id) values ('{PN}', '{T}', '{T}/essai-vf1a-pn.pdf', 'essai-vf1a-pn.pdf', 'vente', '{F1}')$q$,
      '42501', 'Une pièce ne se désigne exemplaire d''une facture, et ne cesse de l''être, que par l''application.'],
    array['controle', '71. la restauration par le super-administrateur réinsère une pièce désignée', 'chef', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, facture_id) values ('{PN}', '{T}', '{T}/essai-vf1a-pn.pdf', 'essai-vf1a-pn.pdf', 'vente', '{F1}')$q$, 'OK', ''],
    array['controle', '72. jamais d''une facture d''un autre dossier', 'chef', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, facture_id) values ('{PN}', '{T}', '{T}/essai-vf1a-pn.pdf', 'essai-vf1a-pn.pdf', 'vente', '{FA}')$q$,
      '23514', 'Une pièce n''est l''exemplaire que d''une facture de son dossier.'],
    array['controle', '73. ni d''une facture qui n''existe pas', 'chef', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, facture_id) values ('{PN}', '{T}', '{T}/essai-vf1a-pn.pdf', 'essai-vf1a-pn.pdf', 'vente', '{AUTRE}')$q$,
      '23514', 'Une pièce n''est l''exemplaire que d''une facture de son dossier.'],
    array['controle', '74. ni d''un brouillon', 'chef', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, facture_id) values ('{PN}', '{T}', '{T}/essai-vf1a-pn.pdf', 'essai-vf1a-pn.pdf', 'vente', '{FB}')$q$,
      '23514', 'Seule une facture validée a un exemplaire.'],
    array['controle', '75. ni sur une pièce qui n''est pas une vente', 'chef', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, facture_id) values ('{PN}', '{T}', '{T}/essai-vf1a-pn.pdf', 'essai-vf1a-pn.pdf', 'achat', '{F1}')$q$,
      '23514', 'Seule une pièce de vente est l''exemplaire d''une facture émise.'],
    array['controle', '76. une pièce désignée ne change pas de dossier', 'chef', $q$update pieces set dossier_id = '{A}' where id = '{PV4}'$q$,
      '23514', 'Cette pièce est l''exemplaire de la facture F2026-0002 : elle ne change plus de dossier — défaire d''abord la désignation.'],
    array['controle', '77. une pièce désignée reste une vente', 'chef', $q$update pieces set type_piece = 'achat' where id = '{PV4}'$q$,
      '23514', 'Cette pièce est l''exemplaire de la facture F2026-0002 : elle reste une pièce de vente — défaire d''abord la désignation.'],
    array['controle', '78. une pièce que rien ne désigne change de nature et de dossier', 'chef', $q$update pieces set type_piece = 'achat' where id = '{PV1}'; update pieces set dossier_id = '{A}' where id = '{PDEP}'$q$, 'OK', ''],
    array['controle', '79. le reste d''une pièce désignée se modifie comme avant, la désignation réécrite à l''identique comprise', 'chef', $q$update pieces set date_piece = '2026-03-16', montant_ttc = 61, statut = 'validee', facture_id = facture_id, type_piece = 'vente', dossier_id = dossier_id where id = '{PV4}'$q$, 'OK', ''],
    array['controle', '80. le réglage d''une autre pièce n''ouvre rien', 'postgres', $q$select set_config('jd.exemplaire_facture', '{PV1}', true); update pieces set facture_id = null where id = '{PV4}'$q$,
      '42501', 'Une pièce ne se désigne exemplaire d''une facture, et ne cesse de l''être, que par l''application.'],
    array['controle', '81. le gel tient la désignation même sous un réglage forgé : la garde des pièces figées', 'postgres', $q$select set_config('jd.exemplaire_facture', '{PFIG2}', true); update pieces set facture_id = null where id = '{PFIG2}'$q$,
      '23514', 'Cette pièce porte une écriture validée de l''exercice 2026 : ses montants, sa date et sa catégorie ne changent plus.'],
    array['controle', '82. une pièce figée et désignée : la garde de la désignation parle la première', 'chef', $q$update pieces set facture_id = null where id = '{PFIG2}'$q$,
      '42501', 'Une pièce ne se désigne exemplaire d''une facture, et ne cesse de l''être, que par l''application.'],

    -- ══ 90 à 95. Qui lit la désignation ══════════
    array['lecture', '90. le client du dossier la lit, comme toute la ligne de ses pièces', 'client_t', $q$select coalesce((select facture_id::text from pieces where id = '{PV4}'), 'aucune ligne')$q$,
      '', '{F2}'],
    array['lecture', '91. le client d''un autre dossier ne voit aucune pièce de celui-ci', 'client', $q$select count(*)::text from pieces where dossier_id = '{T}'$q$, '', '0'],
    array['lecture', '92. le compte rattaché à rien non plus', 'inconnu', $q$select count(*)::text from pieces where dossier_id = '{T}'$q$, '', '0'],
    array['lecture', '93. l''anonyme non plus', 'anon', $q$select count(*)::text from pieces where dossier_id = '{T}'$q$, '', '0'],
    array['lecture', '94. le membre affecté au dossier la lit', 'membre', $q$select coalesce((select facture_id::text from pieces where id = '{PV4}'), 'aucune ligne')$q$,
      '', '{F2}'],
    array['lecture', '95. le membre affecté à un autre dossier n''en voit rien', 'membre_ailleurs', $q$select count(*)::text from pieces where dossier_id = '{T}'$q$, '', '0'],

    -- ══ 140 à 149. Les mutations : chacune doit MORDRE ══════════
    array['controle', '140. MUTATION — le contrôle 4 joué sous le chef : il doit passer', 'chef', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{F1}')$q$, 'OK', ''],
    array['controle', '141. MUTATION — le contrôle 6 affecté au BON dossier : il doit passer', 'membre', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{F1}')$q$, 'OK', ''],
    array['controle', '142. MUTATION — le contrôle 65 joué par le super-administrateur : l''insertion doit passer', 'chef', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, facture_id) values ('{PN}', '{T}', '{T}/essai-vf1a-pn.pdf', 'essai-vf1a-pn.pdf', 'vente', '{F2}')$q$, 'OK', ''],
    array['controle', '143. MUTATION — le contrôle 64 sous le réglage de SA pièce : il doit passer (seule la fonction le pose)', 'postgres', $q$select set_config('jd.exemplaire_facture', '{PV1}', true); update pieces set facture_id = '{F1}' where id = '{PV1}'$q$, 'OK', ''],
    array['lecture', '144. MUTATION — le contrôle 91 joué par le client du dossier : il doit voir ses pièces', 'client_t', $q$select (count(*) > 0)::text from pieces where dossier_id = '{T}'$q$, '', 'true'],
    array['controle', '145. MUTATION — le contrôle 11 dans le dossier de la pièce : il doit passer', 'chef', $q$select designer_exemplaire_facture('{A}', '{PX}', '{FA}')$q$, 'OK', ''],
    array['controle', '146. MUTATION — le contrôle 22 sur une facture validée : il doit passer', 'chef', $q$select designer_exemplaire_facture('{T}', '{PV1}', '{F2}')$q$, 'OK', ''],
    array['controle', '147. MUTATION — le contrôle 16 sur une pièce que rien ne fige : il doit passer', 'chef', $q$select designer_exemplaire_facture('{T}', '{PDEP}', '{F1}')$q$, 'OK', ''],
    array['controle', '148. MUTATION — le contrôle 48 sur une pièce désignée : il doit passer', 'chef', $q$select defaire_exemplaire_facture('{T}', '{PV4}')$q$, 'OK', ''],
    array['controle', '149. MUTATION — le contrôle 76 sur une pièce que rien ne désigne : il doit passer', 'chef', $q$update pieces set dossier_id = '{A}' where id = '{PDEP}'$q$, 'OK', ''],

    -- ══ 150 à 158. Ce que le catalogue dit ══════════
    array['valeur', '150. la colonne : facultative, sans valeur par défaut', 'postgres', $q$select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || (not a.attnotnull)::text || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-'), ',') from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid = 'public.pieces'::regclass and a.attname = 'facture_id' and not a.attisdropped$q$, '',
      'facture_id uuid true -'],
    array['valeur', '151. la clé : vers les factures émises, sans action à la suppression ni à la mise à jour, immédiate', 'postgres', $q$select string_agg(c.conname || ' ' || pg_get_constraintdef(c.oid) || ' ' || c.confdeltype::text || c.confupdtype::text || ' ' || c.condeferrable::text, ',') from pg_constraint c where c.conrelid = 'public.pieces'::regclass and c.contype = 'f' and c.conkey = array[(select attnum from pg_attribute where attrelid = 'public.pieces'::regclass and attname = 'facture_id')]::int2[]$q$, '',
      'pieces_facture_id_fkey FOREIGN KEY (facture_id) REFERENCES factures_emises(id) aa false'],
    array['valeur', '152. l''index partiel', 'postgres', $q$select string_agg(pg_get_indexdef(i.indexrelid), ' | ') from pg_index i where i.indrelid = 'public.pieces'::regclass and pg_get_indexdef(i.indexrelid) like '%(facture_id)%'$q$, '',
      'CREATE INDEX pieces_facture_idx ON public.pieces USING btree (facture_id) WHERE (facture_id IS NOT NULL)'],
    array['valeur', '153. le déclencheur, actif : l''insertion, et la mise à jour de la désignation, du dossier et de la nature', 'postgres', $q$select string_agg(pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text, ' | ') from pg_trigger t where t.tgrelid = 'public.pieces'::regclass and not t.tgisinternal and t.tgfoid = 'public.garder_exemplaire_facture()'::regprocedure$q$, '',
      'CREATE TRIGGER pieces_exemplaire_de_facture BEFORE INSERT OR UPDATE OF facture_id, dossier_id, type_piece ON public.pieces FOR EACH ROW EXECUTE FUNCTION garder_exemplaire_facture() O'],
    array['valeur', '154. les droits d''exécution (anonyme, connecté)', 'postgres', $q$select string_agg(f || ':' || has_function_privilege('anon', 'public.' || f || a, 'execute') || ':' || has_function_privilege('authenticated', 'public.' || f || a, 'execute'), ',' order by f collate "C") from (values
      ('designer_exemplaire_facture', '(uuid, uuid, uuid)'), ('defaire_exemplaire_facture', '(uuid, uuid)'), ('garder_exemplaire_facture', '()')) as t(f, a)$q$, '',
      'defaire_exemplaire_facture:false:true,designer_exemplaire_facture:false:true,garder_exemplaire_facture:false:false'],
    array['valeur', '155. ce qui contourne la RLS et ce qui ne la contourne pas, le chemin fixé, ce que chacune rend', 'postgres', $q$select string_agg(proname || ':' || prosecdef || ':' || coalesce(array_to_string(proconfig, ','), '-') || ':' || pg_get_function_result(oid), ',' order by proname collate "C") from pg_proc where pronamespace = 'public'::regnamespace and proname in ('designer_exemplaire_facture', 'defaire_exemplaire_facture', 'garder_exemplaire_facture')$q$, '',
      'defaire_exemplaire_facture:true:search_path=public:pieces,designer_exemplaire_facture:true:search_path=public:pieces,garder_exemplaire_facture:false:search_path=public:trigger'],
    array['valeur', '156. les policies de pieces sont celles d''avant la migration (l''empreinte de identiteFacturesRecues.sql)', 'postgres', $q$select count(*) || ' ' || md5(string_agg(p.policyname || ' ' || p.roles::text || ' ' || p.cmd || ' ' || coalesce(p.qual, '-') || ' ' || coalesce(p.with_check, '-'), ' | ' order by p.policyname)) from pg_policies p where p.schemaname = 'public' and p.tablename = 'pieces'$q$, '',
      '4 95217063cdf4065ac70bf19b67c62fda'],
    array['valeur', '157. le réglage n''est nommé que par les deux fonctions et la garde', 'postgres', $q$select string_agg(proname, ',' order by proname collate "C") from pg_proc where pronamespace = 'public'::regnamespace and prosrc like '%jd.exemplaire_facture%'$q$, '',
      'defaire_exemplaire_facture,designer_exemplaire_facture,garder_exemplaire_facture'],
    array['valeur', '158. la garde des pièces figées compare toujours la ligne entière : la désignation y est comprise', 'postgres', $q$select (prosrc like '%(to_jsonb(new) - array[''notes'', ''sous_dossier_id'', ''confiance'', ''updated_at''])%')::text from pg_proc where oid = 'public.garder_piece_validee()'::regprocedure$q$, '',
      'true']
  ];

  begin
    foreach etape slice 1 in array etapes loop
      s := etape[4];
      attendu := etape[6];
      for cle, valeur in select key, value from jsonb_each_text(ids || jsonb_build_object('CHEF', chef)) loop
        s := replace(s, '{' || cle || '}', valeur);
        attendu := replace(attendu, '{' || cle || '}', valeur);
      end loop;
      accepte := false; code_recu := null; message := null; obs := null;
      if etape[1] = 'jeu' then
        begin
          execute s;
        exception when others then
          verdicts := verdicts || jsonb_build_object('controle', '0. le jeu : ' || etape[2], 'observe', sqlstate || ' ' || sqlerrm, 'ok', false);
        end;
      elsif etape[1] = 'retenir' then
        begin
          execute s into obs;
        exception when others then obs := null;
        end;
        if obs is null then
          verdicts := verdicts || jsonb_build_object('controle', '0. retenir ' || etape[2], 'observe', 'rien à retenir', 'ok', false);
        else
          ids := ids || jsonb_build_object(etape[2], obs);
        end if;
      elsif etape[1] = 'valeur' then
        begin
          execute s into obs;
        exception when others then obs := sqlstate || ' ' || sqlerrm;
        end;
        verdicts := verdicts || jsonb_build_object('controle', etape[2], 'observe', coalesce(obs, '∅'), 'ok', coalesce(obs = attendu, false));
      else
        if etape[3] in ('membre', 'membre_ailleurs', 'chef_simple', 'client_t', 'client_t_ventes') and etape[1] not in ('controle', 'lecture') then
          raise exception 'ESSAI_MAL_ECRIT : le profil % ne sert qu''à un contrôle ou à une lecture, qui s''annulent', etape[3];
        end if;
        begin
          if etape[3] in ('membre', 'membre_ailleurs') then
            insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable');
            insert into dossier_assignations (dossier_id, user_id)
              values (case etape[3] when 'membre' then (ids ->> 'T')::uuid else (ids ->> 'A')::uuid end, client);
          elsif etape[3] = 'chef_simple' then
            insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable_en_chef');
          elsif etape[3] in ('client_t', 'client_t_ventes') then
            insert into memberships (user_id, dossier_id, role, droit_ventes, droit_banque)
              values (client, (ids ->> 'T')::uuid, 'client', etape[3] = 'client_t_ventes', etape[3] = 'client_t_ventes');
          end if;
          if etape[3] <> 'postgres' then
            execute format('set local role %I', case when etape[3] = 'anon' then 'anon' else 'authenticated' end);
            perform set_config('request.jwt.claims', case when etape[3] = 'anon' then json_build_object('role', 'anon')::text
              else json_build_object('sub', case etape[3] when 'chef' then chef when 'inconnu' then inconnu else client end,
                                     'role', 'authenticated')::text end, true);
          end if;
          if etape[1] = 'lecture' then
            execute s into obs;
          else
            execute s;
          end if;
          accepte := true;
          if etape[1] in ('controle', 'lecture') then
            raise exception 'ANNULATION_ESSAI';
          end if;
        exception when others then code_recu := sqlstate; message := sqlerrm;
        end;
        reset role;
        perform set_config('request.jwt.claims', '', true);
        perform set_config('jd.exemplaire_facture', '', true);
        if etape[1] = 'lecture' then
          verdicts := verdicts || jsonb_build_object('controle', etape[2],
            'observe', case when accepte then coalesce(obs, '∅') else coalesce(code_recu, '?') || ' ' || coalesce(message, '') end,
            'ok', accepte and coalesce(code_recu = 'P0001', false) and coalesce(obs = attendu, false));
        else
          verdicts := verdicts || jsonb_build_object('controle', etape[2],
            'observe', case when accepte then 'accepté' else coalesce(code_recu, '?') || ' ' || coalesce(message, '') end,
            'ok', case when etape[5] = 'OK' then accepte and (etape[1] = 'fait' or coalesce(code_recu = 'P0001', false))
                       else not accepte and coalesce(code_recu = etape[5] and message like attendu, false) end);
        end if;
      end if;
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      verdicts := verdicts || jsonb_build_object('controle', '0. le déroulé de l''essai', 'observe', sqlstate || ' ' || sqlerrm, 'ok', false);
    end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- ══ 199. Rien n'est resté ══════════
  select string_agg(n::text, '/') into apres from (values
    ((select count(*) from dossiers)), ((select count(*) from pieces)), ((select count(*) from pieces where facture_id is not null)),
    ((select count(*) from factures_emises)), ((select count(*) from ecritures_brouillon)), ((select count(*) from cabinet_admins)),
    ((select count(*) from dossier_assignations)), ((select count(*) from memberships)), ((select count(*) from facture_numerotation))
  ) as t(n);
  verdicts := verdicts || jsonb_build_object('controle', '199. rien n''est resté en base',
    'observe', avant || ' -> ' || apres,
    'ok', avant = apres and not exists (select 1 from dossiers where nom like 'ESSAI EXEMPLAIRES%')
      and not exists (select 1 from cabinet_admins where user_id = client));

  perform set_config('essai.exemplaires_des_factures', verdicts::text, true);
end $essai$;

-- Un verdict qui n'a pas pu se calculer est une faute, pas un silence. La ligne 0 dit le texte que la base a reçu — par
-- l'outil MCP, qui ajoute sa signature après lui —, pour le comparer au fichier par son empreinte.
select x.controle, x.ok, x.observe from (
  select v.controle, coalesce(v.ok, false) as ok, v.observe
  from jsonb_to_recordset(current_setting('essai.exemplaires_des_factures')::jsonb) as v(controle text, ok boolean, observe text)
  union all
  select '0. information : le texte reçu par la base', true, length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by (regexp_match(x.controle, '^(\d+)'))[1]::int, x.controle;
