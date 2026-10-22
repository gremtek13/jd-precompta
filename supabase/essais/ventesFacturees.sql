-- LA FACTURE VALIDÉE, SOURCE DE SA VENTE, ÉPROUVÉE EN BASE (ligne 28.6, chantier EC-Q3, étape VF2 ; migrations
-- `source_de_la_vente`, 20261018201312, et `encaissements_de_la_vente_facturee`, 20261019070229, en base) — à rejouer par
-- `execute_sql` après toute migration qui touche le réglage `dossiers.ventes_par_les_factures`, la source
-- `factures_emises.source_de_la_vente` et la validation d'une facture (`enregistrer_facture`, les gardes des factures),
-- `lignes_bancaires` (ses contraintes de rapprochement, ses gardes, les fonctions des classements du relevé),
-- `encaissements_factures` et ses fonctions, les colonnes `encaissement_id` et `facture_id` des écritures, le catalogue
-- des rôles, `admin_du_dossier`, `gere_les_ventes`, `gere_la_banque`, `memberships` ou `cabinet_admins`.
--
-- Ce qui se prouve ici, et ne se relit pas — chaque refus jugé à son code ET à ses mots, ceux du texte des migrations,
-- que src/lib/sourceDeLaVente.test.ts et src/lib/encaissementsVenteFacturee.test.ts relisent ici :
--   - LE RÉGLAGE (1 à 5) : le cabinet le pose par sa policy ; le client ne le touche pas ; il ne se baisse plus dès
--     qu'une facture source existe, ni pour le cabinet ni pour le propriétaire, la facture nommée ; avant, il se baisse ;
--   - LA SOURCE FIXÉE À LA VALIDATION (10 à 24) : la facture validée d'un dossier qui a basculé est source, son avoir
--     aussi ; une facture validée avant la bascule ne l'est pas, ni son avoir ; un dossier qui n'a pas basculé valide
--     comme hier (sans nature, mixte, dans un exercice validé) ; dans un dossier qui a basculé, la validation se refuse
--     sans nature, mixte, ou à une date que la frontière fige (ses deux phrases, avoir compris), dans cet ordre ; la
--     restauration réinsère une source dans un dossier qui a basculé, jamais ailleurs ; personne ne pose ni ne retire
--     la source ;
--   - LES COLONNES DES ÉCRITURES, FERMÉES (30 à 38) : ni le chef qui n'est pas super-administrateur, ni le membre, ni le
--     propriétaire ne les posent ; le réglage d'une AUTRE source n'ouvre rien ; celui de SA source et la restauration du
--     super-administrateur les ouvrent ; personne ne les change sans le réglage ; une écriture ordinaire s'écrit comme hier ;
--   - G2, LE MOUVEMENT RÉSERVÉ, ET G1 (40 à 59) : le drapeau ne naît posé qu'à la restauration et ne change que par les
--     deux fonctions du cabinet, sous le réglage de CE mouvement ; le mouvement qui justifie un encaissement d'une
--     facture source ne reçoit aucun autre classement — par la policy du cabinet, par une fonction du relevé, par le rôle
--     des Edge Functions — ; libre, cité par une facture qui n'est pas source, par un encaissement retiré ou contre-passé
--     sans mouvement, il se classe comme hier ; contre-passé par un débit, il reste réservé, et le débit aussi ; classé,
--     il ne reçoit rien d'autre ; les deux contraintes de G1 ;
--   - LA GARDE DES ENCAISSEMENTS sans les fonctions (60 à 67) ;
--   - LES REFUS NEUFS des fonctions, à leur rang : enregistrer (11, 17, 27, 29), retirer (6, 7), contre-passer (12,
--     15 à 20, le cinquième paramètre ; et 2, le droit « Banque » que ce débit demande depuis la migration
--     `contre_passation_banque` : 94 à 96), rattacher (1 à 16), classer (1 à 10), retirer le classement (1 à 4) ; et,
--     pour une facture qui n'est pas source, ce qu'hier rendait : ni frontière, ni mouvement réservé, les plafonds
--     bruts ;
--   - LE CATALOGUE (150 à 157) : les six rôles et leurs défauts, aucune racine qui en commence une autre, les colonnes,
--     les contraintes, les déclencheurs, la sécurité et les droits des fonctions, les réglages et qui les nomme ;
--   - LES MUTATIONS (160 à 170) : chacune rejoue un contrôle avec un profil, une cible ou un réglage délibérément faux,
--     et doit MORDRE ;
--   - et que RIEN ne reste en base (199).
--
-- Un seul état : les deux migrations en base. Tout se joue dans quatre dossiers JETABLES du cabinet du dossier `test`
-- (T et R ont basculé, A et N non), au sein d'un bloc qui s'annule entièrement à la fin (`ANNULATION_ESSAI_GLOBALE`) ;
-- chaque contrôle dans sa sous-transaction, annulée elle aussi (`ANNULATION_ESSAI`, P0001) — le moteur d'étapes de
-- exemplairesDesFactures.sql, ses six genres et ses profils : « chef » (super-administrateur), « chef_simple » (le compte
-- client rattaché au cabinet comme chef, le temps du contrôle), « membre » (le même, affecté au dossier T), « client_vb »
-- (un accès du compte client à T, avec « Ventes » et « Banque »), « client_v » (le même accès, avec « Ventes » seul :
-- migration `contre_passation_banque`), « service » (le rôle des Edge Functions), « postgres »
-- (le propriétaire) ; le moteur connaît aussi « client », « inconnu » et « anon », que rien n'emploie ici (l'accès de
-- l'anonyme aux fonctions neuves se lit au catalogue, 155). Une étape « retenir » nommée « * » fusionne aux identifiants
-- l'objet JSON que sa requête rend. Les exercices 2025 validés de T et de A, et les déclarations, se
-- posent en direct par le propriétaire. Les identifiants jetables sont FIXES (préfixe `5f200000`) ; ceux que les
-- fonctions donnent se retiennent. Des macros (`{FJ1}`, `{L1}`…) abrègent les arguments répétés. Les verdicts voyagent
-- dans un réglage LOCAL à la transaction (`essai.ventes_facturees`) : hors de l'outil d'exécution, le fichier se joue en
-- UNE transaction (`psql -1`). Aucune instruction de suppression, aucune mise à jour sans `where`.
--
-- ÉPROUVÉ LE 19/10/2026 SUR UNE RÉPLIQUE, PAS EN PRODUCTION (PostgreSQL 16, UTF8 ; `signature.sql` : les neuf familles
-- égales à la production, les deux migrations en base) : 164 contrôles, 0 en faute, rien n'est resté ; le texte sans
-- ses lignes de commentaire, envoyé en une requête comme le fait l'outil, rend les mêmes verdicts (59 764 caractères,
-- empreinte 1a9d47e64de41b962a5200ccb5269ad5). Les mutations des deux migrations — chaque refus retiré, chaque refus
-- neuf sous un autre code, cinquante opérateurs et conditions, trente et une de la structure (défauts, contraintes,
-- index, déclencheurs, catalogue des rôles, droits) — jouées contre cet essai, encaissementsFactures.sql, factures.sql,
-- planComptable.sql, restauration.sql, rls.sql, transmissionsEncaissements.sql et ventesClient.sql : 251 sur 253 tuées
-- (cet essai seul en tue 201) ; une seule ne l'est que par la suppression d'un encaissement, jouée à part sur la
-- réplique ; les deux survivantes sont équivalentes (un `coalesce` dont la valeur nulle ne se rencontre pas : un avoir
-- validé a toujours sa facture, une facture son dossier).
--
-- 20/10/2026, étape VF4b (migration `ecritures_de_la_vente_facturee`, préparée) : deux contrôles suivent G5 — 38 modifie
-- l'écriture ordinaire qu'il vient de poser, et non la ligne de l'encaissement, que G5 ne laisse plus changer qu'à sa
-- fonction (ecrituresVentesFacturees.sql, 80 à 86) ; 157 lit qui nomme les réglages hors des trois fonctions de VF4b, que
-- ecrituresVentesFacturees.sql (154) compte. Sur la réplique, 164 contrôles justes avant comme après la migration.
--
-- 22/10/2026, migration `contre_passation_banque` (appliquée sous la version `20261022185455` ; chantier EC-Q3, ligne
-- 28.65) : le débit qu'une contre-passation cite demande aussi « Banque », au rang 2, sous les mots et le code du rang
-- 2 d'`enregistrer_encaissement`, avant toute lecture ; les rangs suivants d'`annuler_encaissement` avancent d'un cran
-- (85 à 91). Huit contrôles de plus : 94 à 94e (le client « Ventes » sans « Banque » qui cite un débit, refusé avant ce
-- que les refus suivants lui apprenaient — le montant du débit, un encaissement inconnu, un mouvement d'un autre
-- dossier, un crédit, un débit classé), 95 (sans débit, il contre-passe comme hier), 96 (avec « Banque », il cite le
-- débit) et la mutation 170 (avec « Banque », le rang 2 passe). Sur une réplique dont `signature.sql` égalait la
-- production à 144 migrations (les neuf familles, et l'historique) : sans la migration, 172 contrôles, 5 en faute — 94
-- à 94e, exactement — ; avec elle, 172 justes, rien n'est resté, et les 164 d'hier rendent, ligne à ligne, ce qu'ils
-- rendaient. Dix mutations de la migration (le refus retiré, déplacé après la lecture de l'encaissement ou avant le
-- débit, un autre prédicat, la condition élargie ou faussée, un autre code, un mot changé) : dix tuées par cet essai.
-- Rejoué en production après l'application, sans ses lignes de commentaire (61 813 caractères, `7f0248f2…`) : 172
-- justes, rien n'est resté.
do $essai$
declare
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  inconnu uuid := gen_random_uuid();
  cabinet uuid;
  ids jsonb;
  etapes text[];
  etape text[];
  cle text; valeur text; s text; attendu text; n bigint;
  tables text[] := array['dossiers', 'factures_emises', 'facture_lignes', 'facture_numerotation', 'lignes_bancaires',
    'encaissements_factures', 'encaissements_factures_taux', 'ecritures_brouillon', 'exercices_valides', 'transmissions_factures',
    'transmissions_encaissements', 'cabinet_admins', 'dossier_assignations', 'memberships'];
  accepte boolean; code_recu text; message text; obs text;
  avant text; apres text;
  verdicts jsonb := '[]'::jsonb;
begin
  select cabinet_id into cabinet from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24';
  if cabinet is null
     or not exists (select 1 from super_admins where user_id = chef)
     or not exists (select 1 from cabinet_admins where user_id = chef and cabinet_id = cabinet and role = 'comptable_en_chef')
     or not exists (select 1 from auth.users where id = client)
     or exists (select 1 from cabinet_admins where user_id = client) or exists (select 1 from super_admins where user_id = client) then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable, ou client déjà rattaché au cabinet';
  end if;

  ids := jsonb_build_object('CAB', cabinet, 'X', gen_random_uuid(),
      'T', '5f200000-0000-4000-8000-0000000000d1', 'A', '5f200000-0000-4000-8000-0000000000d2',
      'R', '5f200000-0000-4000-8000-0000000000d3', 'N', '5f200000-0000-4000-8000-0000000000d4',
      'W', '5f200000-0000-4000-8000-0000000000e1', 'CP', '5f200000-0000-4000-8000-0000000000e2',
      'Y1', '5f200000-0000-4000-8000-0000000000e3', 'Y2', '5f200000-0000-4000-8000-0000000000e4')
    || jsonb_build_object(
      'M1', '5f200000-0000-4000-8000-0000000000b1', 'M2', '5f200000-0000-4000-8000-0000000000b2',
      'M3', '5f200000-0000-4000-8000-0000000000b3', 'M4', '5f200000-0000-4000-8000-0000000000b4',
      'M5', '5f200000-0000-4000-8000-0000000000b5', 'M6', '5f200000-0000-4000-8000-0000000000b6',
      'M7', '5f200000-0000-4000-8000-0000000000b7', 'M8', '5f200000-0000-4000-8000-0000000000b8',
      'M9', '5f200000-0000-4000-8000-0000000000b9', 'M10', '5f200000-0000-4000-8000-0000000000ba',
      'M11', '5f200000-0000-4000-8000-0000000000bb', 'M12', '5f200000-0000-4000-8000-0000000000bc',
      'MB', '5f200000-0000-4000-8000-0000000000bd', 'MC', '5f200000-0000-4000-8000-0000000000be',
      'MA', '5f200000-0000-4000-8000-0000000000c1', 'MD', '5f200000-0000-4000-8000-0000000000c2',
      'MK', '5f200000-0000-4000-8000-0000000000c3', 'M0', '5f200000-0000-4000-8000-0000000000bf', 'M13', '5f200000-0000-4000-8000-0000000000c4')
    || jsonb_build_object(
      'FJ1', $m$'{"tiers_nom":"ESSAI","tiers_siret":"12345678900012","emetteur_nom":"ESSAI","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb$m$,
      'FJ2', $m$'{"tiers_nom":"ESSAI","tiers_siret":"12345678900012","emetteur_nom":"ESSAI","montant_ht":200,"montant_tva":25.5,"montant_ttc":225.5}'::jsonb$m$,
      'L1', $m$'[{"designation":"x","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb$m$,
      'L2', $m$'[{"designation":"x","quantite":1,"prix_unitaire_ht":100,"taux_tva":20},{"designation":"y","quantite":1,"prix_unitaire_ht":100,"taux_tva":5.5}]'::jsonb$m$,
      'AV', $m$'{"type":"avoir","montant_ht":-10,"montant_tva":-2,"montant_ttc":-12}'::jsonb$m$,
      'LAV', $m$'[{"designation":"x","quantite":-1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb$m$,
      'BIL', $m$set statut = 'rapprochee', compte_bilan = '467000'$m$,
      'EC', $m$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, encaissement_id, facture_id) values ('5f200000-0000-4000-8000-0000000000d1', '2026-03-02', '512000', 'ESSAI', 1, 'debit'$m$,
      'ENC', $m$insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id, annule_id, motif) values$m$,
      'ENI', $m$insert into encaissements_factures (id, dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id, annule_id, motif) values$m$,
      'MOT', $m$Ce mouvement est déjà classé : l'encaissement d'une facture source de sa vente ne cite qu'un mouvement que rien ne classe encore — retirer d'abord ce classement.$m$,
      'RES', $m$Ce mouvement justifie un encaissement de la facture F2026-0002, source de sa vente : il se classe par ses encaissements, et par rien d'autre.$m$,
      'ECR', $m$Une écriture ne porte une facture ou un encaissement que par la fonction qui écrit la vente facturée.$m$,
      'DEP', $m$Le mouvement dont dépend cet encaissement est classé : le cabinet retire d'abord ce classement.$m$,
      'MLI', $m$Ce mouvement ne justifie aucun encaissement d'une facture source de sa vente : il ne se classe pas par des encaissements.$m$,
      'M50', $m$Les encaissements que ce mouvement justifie font 50,00 € pour un crédit de 100,00 € : ce qui le dépasse reste à traiter.$m$,
      'NAI', $m$Un mouvement ne naît pas classé par des encaissements : le cabinet l'y classe ensuite, par sa fonction.$m$,
      'DRA', $m$Un mouvement ne se classe par ses encaissements, et ne cesse de l'être, que par la fonction du cabinet.$m$,
      'SRC', $m$La source de la vente se fixe à la validation de la facture : elle ne se pose pas.$m$,
      'REG', $m$Les factures de ce dossier sont la source de leurs ventes depuis la facture F2025-0001 : ce réglage ne se défait pas.$m$,
      'FR5', $m$L'exercice 2025 est validé : une facture source de sa vente, ou son avoir, ne s'y valide plus.$m$,
      'SEU', $m$Seul l'encaissement d'une facture source de sa vente se rattache après coup au mouvement qui le prouve.$m$,
      'DEB', $m$Une contre-passation se justifie par un débit : ce mouvement n'en est pas un.$m$,
      'CRE', $m$Un encaissement se justifie par un crédit : ce mouvement n'en est pas un.$m$,
      'BQE', $m$Le mouvement bancaire d'un encaissement ne se désigne qu'avec le droit « Banque » sur ce dossier : sans lui, l'encaissement s'enregistre sans mouvement.$m$)
    || jsonb_build_object(
      'ENE', $m$select enregistrer_encaissement($m$,
      'ENF', $m$select enregistrer_facture($m$,
      'RAT', $m$select rattacher_mouvement_encaissement($m$,
      'CLA', $m$select classer_mouvement_par_encaissements($m$,
      'RCL', $m$select retirer_classement_par_encaissements($m$,
      'ANN', $m$select annuler_encaissement($m$,
      'RET', $m$select retirer_encaissement($m$);

  foreach cle in array tables loop
    execute format('select count(*) from %I', cle) into n;
    avant := concat_ws('/', avant, n);
  end loop;

  -- Une étape : {genre, contrôle, qui, requête, code attendu, message attendu (exact, ou motif LIKE fini par « % ») ou valeur}.
  etapes := array[
    -- ══ Le jeu : quatre dossiers, des mouvements, des factures validées par leur fonction, des encaissements ══════
    array['jeu', 'dossiers jetables', 'postgres', $q$insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, ventes_par_les_factures) values
      ('{T}', 'ESSAI VF2 T', '{CAB}', 'tresorerie', '455000', false), ('{A}', 'ESSAI VF2 A', '{CAB}', 'tresorerie', '455000', false),
      ('{R}', 'ESSAI VF2 R', '{CAB}', 'tresorerie', '455000', true), ('{N}', 'ESSAI VF2 N', '{CAB}', 'tresorerie', '455000', false)$q$, '', ''],
    array['jeu', 'mouvements', 'postgres', $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut, compte_bilan) values
      ('{M1}', '{T}', '2026-03-02', 'ESSAI', 100, 'non_rapprochee', null), ('{M2}', '{T}', '2026-03-03', 'ESSAI', 100, 'non_rapprochee', null),
      ('{M3}', '{T}', '2026-03-10', 'ESSAI', -100, 'non_rapprochee', null), ('{M4}', '{T}', '2026-03-04', 'ESSAI', 50, 'rapprochee', '467000'),
      ('{M5}', '{T}', '2026-03-05', 'ESSAI', 10, 'non_rapprochee', null), ('{M6}', '{T}', '2026-03-11', 'ESSAI', -50, 'non_rapprochee', null),
      ('{M7}', '{T}', '2026-03-06', 'ESSAI', 100, 'non_rapprochee', null), ('{M8}', '{T}', '2026-03-12', 'ESSAI', -100, 'non_rapprochee', null),
      ('{M9}', '{T}', '2025-12-31', 'ESSAI', 50, 'non_rapprochee', null), ('{M10}', '{T}', '2026-03-08', 'ESSAI', 50, 'non_rapprochee', null),
      ('{M11}', '{T}', '2026-03-13', 'ESSAI', 1, 'non_rapprochee', null), ('{M12}', '{T}', '2026-03-13', 'ESSAI', -1, 'non_rapprochee', null),
      ('{MB}', '{T}', '2025-12-31', 'ESSAI', 20, 'non_rapprochee', null), ('{MC}', '{T}', '2026-03-14', 'ESSAI', -20, 'rapprochee', '467000'),
      ('{MA}', '{A}', '2026-03-02', 'ESSAI', 100, 'non_rapprochee', null), ('{MD}', '{A}', '2026-03-12', 'ESSAI', -30, 'non_rapprochee', null),
      ('{MK}', '{A}', '2026-03-04', 'ESSAI', 20, 'rapprochee', '467000'), ('{M0}', '{T}', '2026-03-15', 'ESSAI', 0, 'non_rapprochee', null),
      ('{M13}', '{T}', '2026-03-15', 'ESSAI', 98, 'non_rapprochee', null)$q$, '', ''],
    array['fait', '0. le jeu : une facture validée dans T AVANT la bascule (F2026-0001)', 'chef', $q${ENF}'{T}', null, {FJ1} || '{"date_emission":"2026-02-01"}', {L1}, true)$q$, 'OK', ''],
    array['fait', '1. le cabinet pose le réglage, par la policy des dossiers', 'chef', $q$update dossiers set ventes_par_les_factures = true where id = '{T}'$q$, 'OK', ''],
    array['fait', '0. le jeu : F2025-0001', 'chef', $q${ENF}'{T}', null, {FJ1} || '{"date_emission":"2025-06-01","nature_operation":"services"}', {L1}, true)$q$, 'OK', ''],
    array['fait', '0. le jeu : F2026-0002', 'chef', $q${ENF}'{T}', null, {FJ2} || '{"date_emission":"2026-03-01","nature_operation":"services"}', {L2}, true)$q$, 'OK', ''],
    array['retenir', '*', 'postgres', $q$select jsonb_object_agg(case numero when 'F2026-0001' then 'FP' when 'F2025-0001' then 'F25' else 'F1' end, id)::text from factures_emises where dossier_id = '{T}'$q$, '', ''],
    array['fait', '0. le jeu : l''avoir de F2026-0002', 'chef', $q${ENF}'{T}', null, {AV} || jsonb_build_object('facture_origine_id', '{F1}', 'date_emission', '2026-03-15'), {LAV}, true)$q$, 'OK', ''],
    array['fait', '0. le jeu : l''avoir de la facture d''avant la bascule', 'chef', $q${ENF}'{T}', null, {AV} || jsonb_build_object('facture_origine_id', '{FP}', 'date_emission', '2026-03-15'), {LAV}, true)$q$, 'OK', ''],
    array['fait', '18a. hors bascule, comme hier : sans nature', 'chef', $q${ENF}'{A}', null, {FJ2} || '{"date_emission":"2026-03-01"}', {L2}, true)$q$, 'OK', ''],
    array['retenir', 'FA1', 'postgres', $q$select id::text from factures_emises where dossier_id = '{A}' and numero = 'F2026-0001'$q$, '', ''],
    array['fait', '0. le jeu : l''avoir de la facture de A', 'chef', $q${ENF}'{A}', null, {AV} || jsonb_build_object('facture_origine_id', '{FA1}', 'date_emission', '2026-03-15'), {LAV}, true)$q$, 'OK', ''],
    array['valeur', '10. la source fixée à la validation', 'postgres', $q$select string_agg(numero || '=' || source_de_la_vente, ',' order by dossier_id = '{A}', numero collate "C") from factures_emises where dossier_id in ('{T}', '{A}')$q$, '',
      'A2026-0001=true,A2026-0002=false,F2025-0001=true,F2026-0001=false,F2026-0002=true,A2026-0001=false,F2026-0001=false'],
    array['fait', '0. le jeu : E1', 'chef', $q${ENE}'{T}', '{F1}', '2026-03-02', 100, 'virement', '{M1}', '[{"taux":20,"montant":100}]')$q$, 'OK', ''],
    array['fait', '0. le jeu : ES', 'chef', $q${ENE}'{T}', '{F1}', '2026-03-05', 5, 'cheque', null, '[{"taux":20,"montant":5}]')$q$, 'OK', ''],
    array['fait', '0. le jeu : E7', 'chef', $q${ENE}'{T}', '{F1}', '2026-03-06', 50, 'virement', '{M7}', '[{"taux":5.5,"montant":50}]')$q$, 'OK', ''],
    array['fait', '0. le jeu : E25', 'chef', $q${ENE}'{T}', '{F25}', '2025-06-15', 50, 'virement', '{M9}', '[{"taux":20,"montant":50}]')$q$, 'OK', ''],
    array['fait', '0. le jeu : E25b', 'chef', $q${ENE}'{T}', '{F25}', '2025-12-31', 10, 'cheque', null, '[{"taux":20,"montant":10}]')$q$, 'OK', ''],
    array['fait', '0. le jeu : E26', 'chef', $q${ENE}'{T}', '{F25}', '2026-03-08', 50, 'virement', '{M10}', '[{"taux":20,"montant":50}]')$q$, 'OK', ''],
    array['fait', '0. le jeu : ES2', 'chef', $q${ENE}'{T}', '{F25}', '2026-03-07', 1, 'cheque', null, '[{"taux":20,"montant":1}]')$q$, 'OK', ''],
    array['fait', '0. le jeu : EA', 'chef', $q${ENE}'{A}', '{FA1}', '2026-03-02', 100, 'virement', '{MA}', '[{"taux":20,"montant":100}]')$q$, 'OK', ''],
    array['fait', '0. le jeu : EA25', 'chef', $q${ENE}'{A}', '{FA1}', '2025-06-15', 10, 'cheque', null, '[{"taux":20,"montant":10}]')$q$, 'OK', ''],
    array['retenir', '*', 'postgres', $q$select jsonb_object_agg(case when ligne_bancaire_id = '{M1}' then 'E1' when ligne_bancaire_id = '{M7}' then 'E7' when ligne_bancaire_id = '{M9}' then 'E25' when ligne_bancaire_id = '{M10}' then 'E26' when ligne_bancaire_id = '{MA}' then 'EA' when montant = 5 then 'ES' when montant = 1 then 'ES2' when facture_id = '{FA1}' then 'EA25' else 'E25b' end, id)::text from encaissements_factures where dossier_id in ('{T}', '{A}')$q$, '', ''],
    array['fait', '0. le jeu : M9 classé par ses encaissements', 'chef', $q${CLA}'{T}', '{M9}')$q$, 'OK', ''],
    array['fait', '0. le jeu : M10 classé par ses encaissements', 'chef', $q${CLA}'{T}', '{M10}')$q$, 'OK', ''],
    array['jeu', 'l''exercice 2025 validé dans T et dans A', 'postgres', $q$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte, declaration) values
      ('{T}', 2025, now(), '{CHEF}', 'tresorerie', 0, 0, 0, 0, repeat('a', 64), '{}'), ('{A}', 2025, now(), '{CHEF}', 'tresorerie', 0, 0, 0, 0, repeat('b', 64), '{}')$q$, '', ''],
    array['jeu', 'les factures acceptées, E1, ES, E25 et EA déclarés', 'postgres', $q$insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat, flux_id) values
      ('{T}', '{F1}', 'plateforme', 'pa.exemple.fr', repeat('ab', 32), 'accepte', 'vf2-1'), ('{T}', '{F25}', 'plateforme', 'pa.exemple.fr', repeat('ab', 32), 'accepte', 'vf2-2'),
      ('{A}', '{FA1}', 'plateforme', 'pa.exemple.fr', repeat('ab', 32), 'accepte', 'vf2-3');
      insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values
      ('{T}', '{E1}', '{F1}', 'manuel', 'pa.exemple.fr', 'depose'), ('{T}', '{ES}', '{F1}', 'manuel', 'pa.exemple.fr', 'depose'),
      ('{T}', '{E25}', '{F25}', 'manuel', 'pa.exemple.fr', 'depose'), ('{A}', '{EA}', '{FA1}', 'manuel', 'pa.exemple.fr', 'depose')$q$, '', ''],

    -- ══ 1 à 5. Le réglage ══════════
    array['lecture', '2. le client ne touche pas au réglage (la policy le filtre)', 'client_vb', $q$with u as (update dossiers set ventes_par_les_factures = true where id = '{T}' returning 1) select count(*)::text from u$q$, '', '0'],
    array['controle', '3. le réglage ne se baisse plus, la première source nommée', 'chef', $q$update dossiers set ventes_par_les_factures = false where id = '{T}'$q$, '23514', '{REG}'],
    array['controle', '4. … ni pour le propriétaire', 'postgres', $q$update dossiers set ventes_par_les_factures = false where id = '{T}'$q$, '23514', '{REG}'],
    array['controle', '5. avant toute facture source, il se pose et se baisse', 'chef', $q$update dossiers set ventes_par_les_factures = true where id = '{A}'; update dossiers set ventes_par_les_factures = false where id = '{A}'$q$, 'OK', ''],

    -- ══ 11 à 26. La source à la validation ══════════
    array['controle', '11. basculé : sans nature, elle ne se valide pas', 'chef', $q${ENF}'{T}', null, {FJ1} || '{"date_emission":"2026-03-20"}', {L1}, true)$q$, '23514', 'Dans un dossier dont les factures sont la source de leurs ventes, une facture dit si elle porte sur des biens ou sur des services : la nature de ses opérations est à renseigner avant sa validation.'],
    array['controle', '12. … ni une facture mixte', 'chef', $q${ENF}'{T}', null, {FJ1} || '{"date_emission":"2026-03-20","nature_operation":"mixte"}', {L1}, true)$q$, '23514', 'Dans un dossier dont les factures sont la source de leurs ventes, une facture qui mêle biens et services ne se valide pas encore : elle se scinde en deux factures, l''une de biens, l''autre de services, tant que ses lignes ne disent pas leur nature.'],
    array['controle', '13. … ni à une date d''un exercice validé', 'chef', $q${ENF}'{T}', null, {FJ1} || '{"date_emission":"2025-07-01","nature_operation":"biens"}', {L1}, true)$q$, '23514', '{FR5}'],
    array['controle', '14. … ni d''un exercice que la validation d''un autre fige', 'chef', $q${ENF}'{T}', null, {FJ1} || '{"date_emission":"2024-07-01","nature_operation":"services"}', {L1}, true)$q$, '23514', 'L''exercice 2024 est figé par la validation de l''exercice 2025 : une facture source de sa vente, ou son avoir, ne s''y valide plus.'],
    array['controle', '15. … ni l''avoir d''une facture source à une date figée', 'chef', $q${ENF}'{T}', null, {AV} || jsonb_build_object('facture_origine_id', '{F25}', 'date_emission', '2025-12-31'), {LAV}, true)$q$, '23514', '{FR5}'],
    array['controle', '16. l''ordre : la nature avant la frontière', 'chef', $q${ENF}'{T}', null, {FJ1} || '{"date_emission":"2025-07-01"}', {L1}, true)$q$, '23514', 'Dans un dossier dont les factures sont la source de leurs ventes, une facture dit si elle porte sur des biens ou sur des services%'],
    array['controle', '17. l''ordre : la facture mixte avant la frontière', 'chef', $q${ENF}'{T}', null, {FJ1} || '{"date_emission":"2025-07-01","nature_operation":"mixte"}', {L1}, true)$q$, '23514', 'Dans un dossier dont les factures sont la source de leurs ventes, une facture qui mêle biens et services%'],
    array['controle', '18b. hors bascule, comme hier : mixte, à une date figée', 'chef', $q${ENF}'{A}', null, {FJ1} || '{"date_emission":"2025-07-01","nature_operation":"mixte"}', {L1}, true)$q$, 'OK', ''],
    array['controle', '20. la restauration réinsère une source où le dossier a basculé', 'chef', $q$insert into factures_emises (dossier_id, numero, statut, type, date_emission, tiers_nom, emetteur_siret, montant_ht, montant_tva, montant_ttc, validated_at, source_de_la_vente) values ('{R}', 'F2026-0001', 'validee', 'facture', '2026-03-01', 'ESSAI', '12345678900012', 0, 0, 0, now(), true)$q$, 'OK', ''],
    array['controle', '21. … jamais dans un dossier qui n''a pas basculé', 'chef', $q$insert into factures_emises (dossier_id, numero, statut, type, date_emission, tiers_nom, emetteur_siret, montant_ht, montant_tva, montant_ttc, validated_at, source_de_la_vente) values ('{N}', 'F2026-0001', 'validee', 'facture', '2026-03-01', 'ESSAI', '12345678900012', 0, 0, 0, now(), true)$q$, '23514', 'Une facture n''est la source de sa vente que dans un dossier dont les factures sont la source de leurs ventes.'],
    array['controle', '22. personne ne pose la source d''un brouillon : à l''insertion', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, source_de_la_vente) values ('{T}', 'ESSAI', true)$q$, '42501', '{SRC}'],
    array['controle', '23. … ni après', 'chef', $q$insert into factures_emises (id, dossier_id, tiers_nom) values ('{X}', '{T}', 'ESSAI'); update factures_emises set source_de_la_vente = true where id = '{X}'$q$, '42501', '{SRC}'],
    array['controle', '24. personne ne retire la source d''une facture validée', 'postgres', $q$update factures_emises set source_de_la_vente = false where id = '{F1}'$q$, '23514', 'La facture F2026-0002 est validée : elle ne se modifie plus — la corriger passe par un avoir.'],

    -- ══ 30 à 38. Les colonnes des écritures, fermées ══════════
    array['controle', '30. le chef simple ne pose pas facture_id', 'chef_simple', $q${EC}, null, '{F1}')$q$, '42501', '{ECR}'],
    array['controle', '31. le membre ne pose pas encaissement_id', 'membre', $q${EC}, '{E1}', null)$q$, '42501', '{ECR}'],
    array['controle', '32. le propriétaire non plus, sans le réglage', 'postgres', $q${EC}, '{E1}', '{F1}')$q$, '42501', '{ECR}'],
    array['controle', '33. le réglage d''une AUTRE source n''ouvre rien', 'postgres', $q$select set_config('jd.ecriture_vente_facturee', '{F1}', true); {EC}, '{E1}', '{F1}')$q$, '42501', '{ECR}'],
    array['controle', '34. le réglage de SA source ouvre l''écriture', 'postgres', $q$select set_config('jd.ecriture_vente_facturee', '{E1}', true); {EC}, '{E1}', '{F1}')$q$, 'OK', ''],
    array['fait', '35. la restauration du super-administrateur l''ouvre aussi', 'chef', $q$insert into ecritures_brouillon (id, dossier_id, date, compte, libelle, montant, sens, encaissement_id, facture_id) values ('{W}', '{T}', '2026-03-02', '512000', 'ESSAI', 1, 'debit', '{E1}', '{F1}')$q$, 'OK', ''],
    array['controle', '36. personne ne les change sans le réglage', 'chef', $q$update ecritures_brouillon set facture_id = null where id = '{W}'$q$, '42501', '{ECR}'],
    array['controle', '37. sous le réglage de sa source, elles changent', 'postgres', $q$select set_config('jd.ecriture_vente_facturee', '{E1}', true); update ecritures_brouillon set facture_id = null where id = '{W}'$q$, 'OK', ''],
    array['controle', '38. une écriture ordinaire s''écrit comme hier', 'chef_simple', $q$insert into ecritures_brouillon (id, dossier_id, date, compte, libelle, montant, sens) values ('{X}', '{T}', '2026-03-02', '512000', 'ESSAI', 1, 'debit'); update ecritures_brouillon set libelle = 'ESSAI 2' where id = '{X}'$q$, 'OK', ''],

    -- ══ 40 à 59. G2, le mouvement réservé, et G1 ══════════
    array['controle', '40. un mouvement ne naît pas classé', 'chef_simple', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant, statut, encaissements_de_factures) values ('{T}', '2026-03-02', 'ESSAI', 1, 'rapprochee', true)$q$, '42501', '{NAI}'],
    array['controle', '41. … ni sous le propriétaire', 'postgres', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant, statut, encaissements_de_factures) values ('{T}', '2026-03-02', 'ESSAI', 1, 'rapprochee', true)$q$, '42501', '{NAI}'],
    array['controle', '42. la restauration du super-administrateur le réinsère classé', 'chef', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant, statut, encaissements_de_factures) values ('{T}', '2026-03-02', 'ESSAI', 1, 'rapprochee', true)$q$, 'OK', ''],
    array['controle', '43. le drapeau ne se pose pas par la policy du cabinet', 'chef', $q$update lignes_bancaires set encaissements_de_factures = true, statut = 'rapprochee' where id = '{M2}'$q$, '42501', '{DRA}'],
    array['controle', '44. … ni par le rôle des Edge Functions', 'service', $q$update lignes_bancaires set encaissements_de_factures = true, statut = 'rapprochee' where id = '{M2}'$q$, '42501', '{DRA}'],
    array['controle', '45. … ni sous le réglage d''un AUTRE mouvement', 'postgres', $q$select set_config('jd.classement_encaissements', '{M1}', true); update lignes_bancaires set encaissements_de_factures = true, statut = 'rapprochee' where id = '{M2}'$q$, '42501', '{DRA}'],
    array['controle', '46. réservé, aucun autre classement par la policy du cabinet', 'chef', $q$update lignes_bancaires {BIL} where id = '{M1}'$q$, '23514', '{RES}'],
    array['controle', '46b. la facture nommée : celle du premier encaissement', 'chef', $q$insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id, cree_le) values ('{T}', '{F1}', '2026-03-03', 1, 'virement', '{M2}', '2026-03-03 10:00+00'), ('{T}', '{F25}', '2026-03-03', 1, 'virement', '{M2}', '2026-03-03 09:00+00'); update lignes_bancaires {BIL} where id = '{M2}'$q$, '23514', 'Ce mouvement justifie un encaissement de la facture F2025-0001, source de sa vente : il se classe par ses encaissements, et par rien d''autre.'],
    array['controle', '47. … ni par une fonction du relevé', 'chef', $q$select ecrire_mouvement_compte_bilan('{M1}', '467000', '[{"compte":"512000","sens":"debit","montant":100},{"compte":"467000","sens":"credit","montant":100}]')$q$, '23514', '{RES}'],
    array['controle', '48. … ni par le rôle des Edge Functions, ni en virement personnel', 'service', $q$update lignes_bancaires set prelevement_personnel = true where id = '{M1}'$q$, '23514', '{RES}'],
    array['controle', '48b. … ni écarté', 'chef', $q$update lignes_bancaires set statut = 'ignoree' where id = '{M1}'$q$, '23514', '{RES}'],
    array['controle', '48c. … ni rapproché sans lien', 'chef', $q$update lignes_bancaires set statut = 'rapprochee' where id = '{M1}'$q$, '23514', '{RES}'],
    array['controle', '49. une mise à jour qui ne le classe pas passe', 'chef', $q$update lignes_bancaires set libelle = 'ESSAI 2' where id = '{M1}'$q$, 'OK', ''],
    array['controle', '50. cité par une facture non source, il se classe comme hier', 'chef', $q$update lignes_bancaires {BIL} where id = '{MA}'$q$, 'OK', ''],
    array['controle', '51. … par un encaissement retiré aussi', 'chef', $q${RET}'{T}', '{E7}'); update lignes_bancaires {BIL} where id = '{M7}'$q$, 'OK', ''],
    array['controle', '52. … et contre-passé sans mouvement', 'chef', $q${ANN}'{T}', '{E1}', '2026-03-12', 'ESSAI'); update lignes_bancaires {BIL} where id = '{M1}'$q$, 'OK', ''],
    array['controle', '52b. réservé de nouveau, la contre-passation retirée', 'chef', $q${ENI} ('{CP}', '{T}', '{F1}', '2026-03-12', -50, 'virement', null, '{E7}', 'ESSAI'); {RET}'{T}', '{CP}'); update lignes_bancaires {BIL} where id = '{M7}'$q$, '23514', '{RES}'],
    array['controle', '53. contre-passé par un débit, il reste réservé', 'chef', $q${ANN}'{T}', '{E1}', '2026-03-12', 'ESSAI', '{M3}'); update lignes_bancaires {BIL} where id = '{M1}'$q$, '23514', '{RES}'],
    array['controle', '54. … et le débit aussi', 'chef', $q${ANN}'{T}', '{E1}', '2026-03-12', 'ESSAI', '{M3}'); update lignes_bancaires {BIL} where id = '{M3}'$q$, '23514', '{RES}'],
    array['lecture', '55. le cabinet le classe ; le réglage retiré après l''appel', 'chef', $q$select concat_ws('|', l.statut, l.encaissements_de_factures::text, coalesce(nullif(current_setting('jd.classement_encaissements', true), ''), 'retiré')) from classer_mouvement_par_encaissements('{T}', '{M1}') l$q$, '', 'rapprochee|true|retiré'],
    array['fait', '56. M1 classé par ses encaissements', 'chef', $q${CLA}'{T}', '{M1}')$q$, 'OK', ''],
    array['controle', '57. classé, il ne reçoit aucun autre classement', 'chef', $q$update lignes_bancaires {BIL} where id = '{M1}'$q$, '23514', 'Ce mouvement est classé par ses encaissements : il ne reçoit aucun autre classement — le cabinet retire d''abord celui-ci.'],
    array['controle', '58. G1 : classé, il ne porte rien d''autre', 'chef', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant, statut, encaissements_de_factures, compte_bilan) values ('{T}', '2026-03-02', 'ESSAI', 1, 'rapprochee', true, '467000')$q$, '23514', '%lignes_bancaires_un_seul_rapprochement%'],
    array['controle', '59. G1 : classé, il est rapproché', 'chef', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant, encaissements_de_factures) values ('{T}', '2026-03-02', 'ESSAI', 1, true)$q$, '23514', '%lignes_bancaires_encaissements_rapproches%'],

    -- ══ 60 à 67. La garde des encaissements, sans les fonctions ══════════
    array['controle', '60. sous son réglage, une facture non source ne se rattache pas', 'postgres', $q$select set_config('jd.rattachement_encaissement', '{EA25}', true); update encaissements_factures set ligne_bancaire_id = '{MA}' where id = '{EA25}'$q$, '23514', '{SEU}'],
    array['controle', '61. sans le réglage, celui d''une facture source non plus', 'postgres', $q$update encaissements_factures set ligne_bancaire_id = '{M2}' where id = '{ES2}'$q$, '23514', 'Un encaissement ne se modifie pas : jamais déclaré, il se retire, une fois ; déclaré, il se contre-passe.'],
    array['controle', '62. sous son réglage, un mouvement classé ne se cite pas', 'postgres', $q$select set_config('jd.rattachement_encaissement', '{ES2}', true); update encaissements_factures set ligne_bancaire_id = '{M4}' where id = '{ES2}'$q$, '23514', 'Un mouvement déjà classé ne se cite pas : l''encaissement d''une facture source de sa vente ne cite qu''un mouvement que rien d''autre ne classe.'],
    array['controle', '62b. sous son réglage, un débit ne prouve pas un encaissement', 'postgres', $q$select set_config('jd.rattachement_encaissement', '{ES2}', true); update encaissements_factures set ligne_bancaire_id = '{M3}' where id = '{ES2}'$q$, '23514', 'Un encaissement se justifie par un crédit de son dossier.'],
    array['controle', '63. ni à l''insertion par le propriétaire', 'postgres', $q${ENC} ('{T}', '{F1}', '2026-03-04', 1, 'virement', '{M4}', null, null)$q$, '23514', 'Un mouvement déjà classé ne se cite pas%'],
    array['controle', '64. la restauration du super-administrateur le réinsère', 'chef', $q${ENC} ('{T}', '{F1}', '2026-03-04', 1, 'virement', '{M4}', null, null)$q$, 'OK', ''],
    array['controle', '64b. en direct, il cite un mouvement classé par ses encaissements', 'postgres', $q${ENC} ('{T}', '{F1}', '2026-03-04', 1, 'virement', '{M1}', null, null)$q$, 'OK', ''],
    array['controle', '65. la contre-passation d''une source cite un débit, pas zéro', 'postgres', $q${ENC} ('{T}', '{F1}', '2026-03-12', -5, 'cheque', '{M0}', '{ES}', 'ESSAI')$q$, '23514', 'Une contre-passation se justifie par un débit de son dossier.'],
    array['controle', '66. celle d''une facture non source ne cite aucun mouvement', 'postgres', $q${ENC} ('{A}', '{FA1}', '2026-03-12', -100, 'virement', '{MD}', '{EA}', 'ESSAI')$q$, '23514', 'Seule la contre-passation d''une facture source de sa vente cite un mouvement : celui qui défait l''encaissement.'],
    array['controle', '67. le retrait direct, le mouvement classé', 'service', $q$update encaissements_factures set retire_le = now() where id = '{E26}'$q$, '23514', '{DEP}'],
    array['controle', '67b. … celui de l''encaissement qu''une contre-passation annule', 'service', $q${ENI} ('{CP}', '{T}', '{F25}', '2026-03-12', -50, 'virement', null, '{E26}', 'ESSAI'); update encaissements_factures set retire_le = now() where id = '{CP}'$q$, '23514', '{DEP}'],

    -- ══ 70 à 79. Enregistrer un encaissement ══════════
    array['controle', '70. rang 11 : une date d''un exercice validé', 'chef', $q${ENE}'{T}', '{F1}', '2025-12-31', 1, 'cheque', null, '[{"taux":20,"montant":1}]')$q$, '22023', 'L''exercice 2025 est validé : un encaissement de cette facture ne s''y date plus.'],
    array['controle', '71. … et d''un exercice figé par un autre', 'chef', $q${ENE}'{T}', '{F1}', '2024-03-01', 1, 'cheque', null, '[{"taux":20,"montant":1}]')$q$, '22023', 'L''exercice 2024 est figé par la validation de l''exercice 2025 : un encaissement de cette facture ne s''y date plus.'],
    array['controle', '72. une facture qui n''est pas source : ni frontière…', 'chef', $q${ENE}'{A}', '{FA1}', '2025-03-01', 1, 'cheque', null, '[{"taux":20,"montant":1}]')$q$, 'OK', ''],
    array['controle', '73. rang 17 : un mouvement classé autrement', 'chef', $q${ENE}'{T}', '{F1}', '2026-03-04', 1, 'virement', '{M4}', '[{"taux":20,"montant":1}]')$q$, '22023', '{MOT}'],
    array['controle', '74. … ou par ses encaissements (avant le rang 18)', 'chef', $q${ENE}'{T}', '{F1}', '2026-03-04', 1, 'virement', '{M1}', '[{"taux":20,"montant":1}]')$q$, '22023', '{MOT}'],
    array['controle', '75. … ni mouvement réservé', 'chef', $q${ENE}'{A}', '{FA1}', '2026-03-04', 20, 'virement', '{MK}', '[{"taux":5.5,"montant":20}]')$q$, 'OK', ''],
    array['controle', '76. l''ordre : un débit, avant qu''il soit classé', 'chef', $q${ENE}'{T}', '{F1}', '2026-03-14', 1, 'virement', '{MC}', '[{"taux":20,"montant":1}]')$q$, '22023', '{CRE}'],
    array['controle', '77. rang 27 : le total, net des avoirs validés', 'chef', $q${ENE}'{T}', '{F1}', '2026-03-09', 58.51, 'virement', null, '[{"taux":20,"montant":3},{"taux":5.5,"montant":55.51}]')$q$, '22023', 'L''encaissement dépasserait le total de la facture, net de ses avoirs : il reste 58,50 € à encaisser.'],
    array['controle', '78. rang 29 : un taux, net des avoirs', 'chef', $q${ENE}'{T}', '{F1}', '2026-03-09', 4, 'virement', null, '[{"taux":20,"montant":4}]')$q$, '22023', 'À 20 %, l''encaissement dépasserait ce que la facture porte, net de ses avoirs : il reste 3,00 € à encaisser à ce taux.'],
    array['controle', '79. … et les plafonds bruts d''hier', 'chef', $q${ENE}'{A}', '{FA1}', '2026-03-09', 10, 'virement', null, '[{"taux":20,"montant":10}]')$q$, 'OK', ''],

    -- ══ 80 à 82. Retirer un encaissement ══════════
    array['controle', '80. rang 6 : daté d''un exercice validé', 'chef', $q${RET}'{T}', '{E25b}')$q$, '22023', 'L''exercice 2025 est validé : cet encaissement ne se retire plus.'],
    array['controle', '81. rang 7 : son mouvement est classé', 'chef', $q${RET}'{T}', '{E26}')$q$, '22023', '{DEP}'],
    array['controle', '81b. … ou celui de l''encaissement que la contre-passation annule', 'chef', $q${ENI} ('{CP}', '{T}', '{F25}', '2026-03-12', -50, 'virement', null, '{E26}', 'ESSAI'); {RET}'{T}', '{CP}')$q$, '22023', '{DEP}'],
    array['controle', '82. une facture qui n''est pas source : comme hier', 'chef', $q${RET}'{A}', '{EA25}')$q$, 'OK', ''],

    -- ══ 85 à 93. Contre-passer, et le cinquième paramètre ══════════
    array['controle', '85. rang 12 : une date d''un exercice validé', 'chef', $q${ANN}'{T}', '{E25}', '2025-12-31', 'ESSAI')$q$, '22023', 'L''exercice 2025 est validé : une contre-passation ne s''y date plus.'],
    array['controle', '86. rang 15 : le débit d''une facture qui n''est pas source', 'chef', $q${ANN}'{A}', '{EA}', '2026-03-12', 'ESSAI', '{MD}')$q$, '22023', 'Seule la contre-passation d''une facture source de sa vente cite le mouvement qui défait l''encaissement.'],
    array['controle', '87. rang 16 : un mouvement d''un autre dossier', 'chef', $q${ANN}'{T}', '{E1}', '2026-03-12', 'ESSAI', '{MD}')$q$, '22023', 'Ce mouvement n''est pas un mouvement de ce dossier.'],
    array['controle', '88. rang 17 : zéro, ni un crédit', 'chef', $q${ANN}'{T}', '{E1}', '2026-03-12', 'ESSAI', '{M0}')$q$, '22023', '{DEB}'],
    array['controle', '89. rang 18 : un débit déjà classé', 'chef', $q${ANN}'{T}', '{E1}', '2026-03-12', 'ESSAI', '{MC}')$q$, '22023', '{MOT}'],
    array['controle', '90. rang 19 : un débit que la contre-passation dépasse', 'chef', $q${ANN}'{T}', '{E1}', '2026-03-12', 'ESSAI', '{M6}')$q$, '22023', 'Ce mouvement de 50,00 € justifierait 100,00 € de contre-passations : l''écart dépasse ce que des frais bancaires expliquent.'],
    array['controle', '91. rang 20 : sans débit, le mouvement classé par ses encaissements', 'chef', $q${ANN}'{T}', '{E1}', '2026-03-12', 'ESSAI')$q$, '22023', 'Le mouvement de l''encaissement contre-passé est classé par ses encaissements : la contre-passation cite le débit qui défait l''encaissement, ou le cabinet retire d''abord ce classement.'],
    array['controle', '92. le débit qui défait l''encaissement : la contre-passation passe', 'chef', $q${ANN}'{T}', '{E1}', '2026-03-12', 'Chèque revenu impayé', '{M3}')$q$, 'OK', ''],
    array['controle', '93. non source : l''appel d''hier, à quatre paramètres', 'chef', $q${ANN}'{A}', '{EA}', '2026-03-12', 'ESSAI')$q$, 'OK', ''],
    array['controle', '93b. … même sur un mouvement classé (VF2-Q2)', 'chef', $q${ENI} ('{CP}', '{T}', '{FP}', '2026-03-02', 10, 'virement', '{M1}', null, null); insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat, flux_id) values ('{T}', '{FP}', 'plateforme', 'pa.exemple.fr', repeat('ab', 32), 'accepte', 'vf2-4'); insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values ('{T}', '{CP}', '{FP}', 'manuel', 'pa.exemple.fr', 'depose'); {ANN}'{T}', '{CP}', '2026-03-12', 'ESSAI')$q$, 'OK', ''],

    -- ══ 94 à 96. Le débit cité demande aussi « Banque » (migration contre_passation_banque) ══════════
    -- Le refus du rang 2 d'enregistrer_encaissement, sous ses mots et son code, AVANT toute lecture : sans lui, le
    -- client qui n'a que « Ventes » apprenait du refus suivant ce que la RLS lui cache — le montant d'un débit (94),
    -- qu'un encaissement n'existe pas (94b), qu'un mouvement n'est pas de son dossier (94c), un crédit (94d), un débit
    -- déjà classé (94e).
    array['controle', '94. rang 2 : sans « Banque », le client « Ventes » ne cite pas de débit — le montant ne se dit plus', 'client_v', $q${ANN}'{T}', '{E1}', '2026-03-12', 'ESSAI', '{M6}')$q$, '42501', '{BQE}'],
    array['controle', '94b. … avant l''encaissement : un encaissement qui n''existe pas', 'client_v', $q${ANN}'{T}', '{X}', '2026-03-12', 'ESSAI', '{M6}')$q$, '42501', '{BQE}'],
    array['controle', '94c. … avant le mouvement : celui d''un autre dossier', 'client_v', $q${ANN}'{T}', '{E1}', '2026-03-12', 'ESSAI', '{MD}')$q$, '42501', '{BQE}'],
    array['controle', '94d. … un crédit', 'client_v', $q${ANN}'{T}', '{E1}', '2026-03-12', 'ESSAI', '{M2}')$q$, '42501', '{BQE}'],
    array['controle', '94e. … un débit déjà classé', 'client_v', $q${ANN}'{T}', '{E1}', '2026-03-12', 'ESSAI', '{MC}')$q$, '42501', '{BQE}'],
    array['controle', '95. sans débit, le client « Ventes » contre-passe comme hier : le rang 2 ne s''interpose pas', 'client_v', $q${ANN}'{T}', '{ES}', '2026-03-12', 'ESSAI')$q$, 'OK', ''],
    array['controle', '96. avec « Banque », le client cite le débit qui défait l''encaissement', 'client_vb', $q${ANN}'{T}', '{E1}', '2026-03-12', 'Chèque revenu impayé', '{M3}')$q$, 'OK', ''],

    -- ══ 100 à 117. Rattacher un encaissement à son mouvement ══════════
    array['controle', '100. rang 1 : le client, même avec « Ventes » et « Banque »', 'client_vb', $q${RAT}'{T}', '{ES2}', '{M5}')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '101. rang 2 : l''encaissement d''un autre dossier', 'chef', $q${RAT}'{T}', '{EA25}', '{M5}')$q$, 'P0002', 'Encaissement introuvable dans ce dossier.'],
    array['controle', '102. rang 3 : retiré', 'chef', $q${RET}'{T}', '{ES2}'); {RAT}'{T}', '{ES2}', '{M5}')$q$, '22023', 'Cet encaissement est retiré : il ne se rattache plus à un mouvement.'],
    array['controle', '103. rang 4 : il cite déjà un mouvement', 'chef', $q${RAT}'{T}', '{E1}', '{M5}')$q$, '22023', 'Cet encaissement cite déjà un mouvement : il ne se rattache qu''une fois.'],
    array['controle', '104. rang 5 : une facture qui n''est pas source', 'chef', $q${RAT}'{A}', '{EA25}', '{MA}')$q$, '22023', '{SEU}'],
    array['controle', '105. rang 6 : daté d''un exercice validé', 'chef', $q${RAT}'{T}', '{E25b}', '{M5}')$q$, '22023', 'L''exercice 2025 est validé : cet encaissement ne se rattache plus à un mouvement.'],
    array['controle', '106. rang 7 : aucun mouvement désigné', 'chef', $q${RAT}'{T}', '{ES2}', null)$q$, '22023', 'Le mouvement à rattacher est à désigner.'],
    array['controle', '107. rang 8 : un mouvement d''un autre dossier', 'chef', $q${RAT}'{T}', '{ES2}', '{MA}')$q$, '22023', 'Ce mouvement n''est pas un mouvement de ce dossier.'],
    array['controle', '108. rang 9 : zéro, ni un débit, pour un encaissement', 'chef', $q${RAT}'{T}', '{ES2}', '{M0}')$q$, '22023', '{CRE}'],
    array['controle', '109. rang 10 : un crédit pour une contre-passation', 'chef', $q${RAT}'{T}', (annuler_encaissement('{T}', '{ES}', '2026-03-13', 'ESSAI')).id, '{M5}')$q$, '22023', '{DEB}'],
    array['controle', '110. rang 11 : un mouvement déjà classé', 'chef', $q${RAT}'{T}', '{ES2}', '{M4}')$q$, '22023', '{MOT}'],
    array['controle', '111. rang 12 : il justifie déjà un encaissement de la facture', 'chef', $q${RAT}'{T}', '{ES}', '{M7}')$q$, '22023', 'Ce mouvement justifie déjà un encaissement de cette facture.'],
    array['controle', '112. rang 13 : l''écart des frais, sur les encaissements', 'chef', $q${RAT}'{T}', '{ES}', '{M11}')$q$, '22023', 'Ce mouvement de 1,00 € justifierait 5,00 € d''encaissements : l''écart dépasse ce que des frais bancaires expliquent.'],
    array['controle', '113. rang 14 : l''écart des frais, sur les contre-passations', 'chef', $q${RAT}'{T}', (annuler_encaissement('{T}', '{ES}', '2026-03-13', 'ESSAI')).id, '{M12}')$q$, '22023', 'Ce mouvement de 1,00 € justifierait 5,00 € de contre-passations : l''écart dépasse ce que des frais bancaires expliquent.'],
    array['controle', '114. rang 15 : le mouvement de l''encaissement contre-passé, classé', 'chef', $q${ENC} ('{T}', '{F1}', '2026-03-12', -100, 'virement', null, '{E1}', 'ESSAI'); {RAT}'{T}', (select id from encaissements_factures where annule_id = '{E1}'), '{M3}')$q$, '22023', 'Le mouvement de l''encaissement contre-passé est classé : rattachée à un débit, la contre-passation le lui ferait justifier de nouveau — le cabinet retire d''abord ce classement.'],
    array['controle', '115. rang 16 : … ou qu''il justifierait alors au-delà des frais', 'chef', $q${ENC} ('{T}', '{F1}', '2026-03-12', -50, 'virement', null, '{E7}', 'ESSAI'); {ENE}'{T}', '{F1}', '2026-03-06', 55, 'virement', '{M7}', '[{"taux":5.5,"montant":55}]'); {RAT}'{T}', (select id from encaissements_factures where annule_id = '{E7}'), '{M6}')$q$, '22023', 'Le mouvement de l''encaissement contre-passé, de 100,00 €, justifierait alors 105,00 € d''encaissements : l''écart dépasse ce que des frais bancaires expliquent.'],
    array['lecture', '116. le cabinet rattache ; le réglage retiré après l''appel', 'chef', $q$select concat_ws('|', (e.ligne_bancaire_id = '{M5}')::text, coalesce(nullif(current_setting('jd.rattachement_encaissement', true), ''), 'retiré')) from rattacher_mouvement_encaissement('{T}', '{ES2}', '{M5}') e$q$, '', 'true|retiré'],
    array['controle', '117. la contre-passation rattachée, l''encaissement justifie de nouveau', 'chef', $q${ENC} ('{T}', '{F1}', '2026-03-12', -50, 'virement', null, '{E7}', 'ESSAI'); {RAT}'{T}', (select id from encaissements_factures where annule_id = '{E7}'), '{M6}'); {CLA}'{T}', '{M7}')$q$, '22023', '{M50}'],

    -- ══ 120 à 139. Classer un mouvement par ses encaissements, et retirer ce classement ══════════
    array['controle', '120. rang 1 : le client, même avec « Ventes » et « Banque »', 'client_vb', $q${CLA}'{T}', '{M7}')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '121. le client cite un mouvement (P2), et ne le classe pas', 'client_vb', $q${ENE}'{T}', '{F25}', '2026-03-05', 9, 'virement', '{M5}', '[{"taux":20,"montant":9}]'); {CLA}'{T}', '{M5}')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '122. … le citer, il le peut', 'client_vb', $q${ENE}'{T}', '{F25}', '2026-03-05', 9, 'virement', '{M5}', '[{"taux":20,"montant":9}]')$q$, 'OK', ''],
    array['controle', '124. rang 2 : le mouvement d''un autre dossier', 'chef', $q${CLA}'{T}', '{MA}')$q$, 'P0002', 'Mouvement introuvable dans ce dossier.'],
    array['controle', '125. rang 3 : daté d''un exercice validé', 'chef', $q${CLA}'{T}', '{MB}')$q$, '22023', 'L''exercice 2025 est validé : ce mouvement ne change plus.'],
    array['controle', '126. rang 4 : déjà classé par ses encaissements', 'chef', $q${CLA}'{T}', '{M1}')$q$, '22023', 'Ce mouvement est déjà classé par ses encaissements.'],
    array['controle', '127. rang 5 : classé autrement', 'chef', $q${CLA}'{T}', '{M4}')$q$, '22023', 'Ce mouvement est déjà classé : retirer d''abord ce classement.'],
    array['controle', '128. rang 6 : rien d''une facture source', 'chef', $q${CLA}'{T}', '{M2}')$q$, '22023', '{MLI}'],
    array['controle', '128b. … une facture qui n''est pas source n''y compte pas', 'chef', $q${CLA}'{A}', '{MA}')$q$, '22023', '{MLI}'],
    array['controle', '128c. … ni sur un crédit partagé avec une facture d''avant la bascule (VF2-Q2)', 'chef', $q${ENC} ('{T}', '{F1}', '2026-03-03', 50, 'virement', '{M2}', null, null), ('{T}', '{FP}', '2026-03-03', 50, 'virement', '{M2}', null, null); {CLA}'{T}', '{M2}')$q$, '22023', '{M50}'],
    array['controle', '129. rang 7 : un crédit que ses encaissements ne font pas', 'chef', $q${CLA}'{T}', '{M7}')$q$, '22023', '{M50}'],
    array['controle', '130. rang 8 : … ou qu''ils dépassent au-delà des frais', 'chef', $q${ENC} ('{T}', '{F1}', '2026-03-03', 120, 'virement', '{M2}', null, null); {CLA}'{T}', '{M2}')$q$, '22023', 'Les encaissements que ce mouvement justifie font 120,00 € pour un crédit de 100,00 € : l''écart dépasse ce que des frais bancaires expliquent.'],
    array['controle', '131. rang 9 : un débit que ses contre-passations dépassent', 'chef', $q$insert into encaissements_factures (id, dossier_id, facture_id, date_encaissement, montant, moyen) values ('{Y1}', '{T}', '{F1}', '2026-03-12', 120, 'virement'); insert into encaissements_factures (id, dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id, annule_id, motif) values ('{Y2}', '{T}', '{F1}', '2026-03-12', -120, 'virement', '{M8}', '{Y1}', 'ESSAI'); {CLA}'{T}', '{M8}')$q$, '22023', 'Les contre-passations que ce mouvement justifie font 120,00 € pour un débit de 100,00 € : elles le dépassent.'],
    array['controle', '131b. rang 10 : … ou qu''elles ne le font pas aux frais près', 'chef', $q$insert into encaissements_factures (id, dossier_id, facture_id, date_encaissement, montant, moyen) values ('{Y1}', '{T}', '{F1}', '2026-03-12', 90, 'virement'); insert into encaissements_factures (id, dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id, annule_id, motif) values ('{Y2}', '{T}', '{F1}', '2026-03-12', -90, 'virement', '{M8}', '{Y1}', 'ESSAI'); {CLA}'{T}', '{M8}')$q$, '22023', 'Les contre-passations que ce mouvement justifie font 90,00 € pour un débit de 100,00 € : l''écart dépasse ce que des frais bancaires expliquent.'],
    array['controle', '132. crédité de 2 % de moins (le seuil) : il se classe', 'chef', $q${ENC} ('{T}', '{F1}', '2026-03-15', 100, 'virement', '{M13}', null, null); {CLA}'{T}', '{M13}')$q$, 'OK', ''],
    array['controle', '135. retirer le classement, rang 1 : le client', 'client_vb', $q${RCL}'{T}', '{M1}')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '136. rang 2 : le mouvement d''un autre dossier', 'chef', $q${RCL}'{T}', '{MA}')$q$, 'P0002', 'Mouvement introuvable dans ce dossier.'],
    array['controle', '137. rang 3 : daté d''un exercice validé', 'chef', $q${RCL}'{T}', '{M9}')$q$, '22023', 'L''exercice 2025 est validé : ce mouvement ne change plus.'],
    array['controle', '138. rang 4 : pas classé par ses encaissements', 'chef', $q${RCL}'{T}', '{M2}')$q$, '22023', 'Ce mouvement n''est pas classé par ses encaissements.'],
    array['lecture', '139. le cabinet retire le classement ; le réglage retiré', 'chef', $q$select concat_ws('|', l.statut, l.encaissements_de_factures::text, coalesce(nullif(current_setting('jd.classement_encaissements', true), ''), 'retiré')) from retirer_classement_par_encaissements('{T}', '{M1}') l$q$, '', 'non_rapprochee|false|retiré'],
    array['controle', '139b. … et le mouvement redevient réservé', 'chef', $q${RCL}'{T}', '{M1}'); update lignes_bancaires {BIL} where id = '{M1}'$q$, '23514', '{RES}'],

    -- ══ 150 à 157. Ce que le catalogue dit ══════════
    array['valeur', '150. les six rôles, et leur défaut lu par un dossier sans plan', 'postgres', $q$select string_agg(role || ':' || array_to_string(racines, '/') || ':' || compte_defaut || ':' || coalesce(libelle_defaut, '∅') || ':' || coalesce(prefixe_auxiliaire_defaut, '∅') || ':' || public.compte_du_role('{T}', role), ',' order by ordre) from roles_comptables where ordre >= 270$q$, '',
      'prestations_de_services:706:706000:Prestations de services:∅:706000,ventes_de_biens:701/707:707000:Ventes de marchandises:∅:707000,tva_collectee_en_attente:44580/44574:445800:Taxes sur le chiffre d''affaires à régulariser ou en attente:∅:445800,valeurs_a_l_encaissement:511:511000:Valeurs à l''encaissement:∅:511000,caisse:53:530000:Caisse:∅:530000,services_bancaires:627:627000:Services bancaires et assimilés:∅:627000'],
    array['valeur', '151. aucune racine du catalogue n''en commence une autre', 'postgres', $q$select count(*)::text from roles_comptables a cross join unnest(a.racines) ra, roles_comptables b cross join unnest(b.racines) rb where a.role <> b.role and rb like ra || '%'$q$, '', '0'],
    array['valeur', '152. les cinq colonnes', 'postgres', $q$select string_agg(c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-'), ',' order by c.relname, a.attname) from pg_attribute a join pg_class c on c.oid = a.attrelid left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where c.relnamespace = 'public'::regnamespace and not a.attisdropped and (c.relname, a.attname) in (('dossiers', 'ventes_par_les_factures'), ('factures_emises', 'source_de_la_vente'), ('lignes_bancaires', 'encaissements_de_factures'), ('ecritures_brouillon', 'encaissement_id'), ('ecritures_brouillon', 'facture_id'))$q$, '',
      'dossiers.ventes_par_les_factures boolean true false,ecritures_brouillon.encaissement_id uuid false -,ecritures_brouillon.facture_id uuid false -,factures_emises.source_de_la_vente boolean true false,lignes_bancaires.encaissements_de_factures boolean true false'],
    array['valeur', '153. les contraintes, et celle des annulations retirée', 'postgres', $q$select string_agg(conname || ' ' || pg_get_constraintdef(oid), ' | ' order by conname) from pg_constraint where conrelid in ('public.factures_emises'::regclass, 'public.lignes_bancaires'::regclass, 'public.ecritures_brouillon'::regclass, 'public.encaissements_factures'::regclass) and conname in ('factures_emises_source_d_une_facture_validee', 'lignes_bancaires_un_seul_rapprochement', 'lignes_bancaires_encaissements_rapproches', 'ecritures_brouillon_encaissement_id_fkey', 'ecritures_brouillon_facture_id_fkey', 'encaissements_factures_annulation_sans_mouvement')$q$, '',
      'ecritures_brouillon_encaissement_id_fkey FOREIGN KEY (encaissement_id) REFERENCES encaissements_factures(id) | ecritures_brouillon_facture_id_fkey FOREIGN KEY (facture_id) REFERENCES factures_emises(id) | factures_emises_source_d_une_facture_validee CHECK (((NOT source_de_la_vente) OR (statut = ''validee''::text))) | lignes_bancaires_encaissements_rapproches CHECK (((NOT encaissements_de_factures) OR ((statut = ''rapprochee''::text) AND (NOT prelevement_personnel)))) | lignes_bancaires_un_seul_rapprochement CHECK ((num_nonnulls(piece_id, cotisation_id, categorie_id, emprunt_id, compte_bilan, declaration_tva_id, NULLIF(ventilee, false), NULLIF(reglement_groupe, false), NULLIF(encaissements_de_factures, false)) <= 1))'],
    array['valeur', '153b. les deux index partiels des écritures', 'postgres', $q$select string_agg(d, ' | ' order by d) from (select pg_get_indexdef(indexrelid) d from pg_index where indrelid = 'public.ecritures_brouillon'::regclass) x where d ~ '(encaissement|facture)_id\)'$q$, '',
      'CREATE INDEX ecritures_brouillon_encaissement_id_idx ON public.ecritures_brouillon USING btree (encaissement_id) WHERE (encaissement_id IS NOT NULL) | CREATE INDEX ecritures_brouillon_facture_id_idx ON public.ecritures_brouillon USING btree (facture_id) WHERE (facture_id IS NOT NULL)'],
    array['valeur', '154. les quatre déclencheurs, actifs', 'postgres', $q$select string_agg(pg_get_triggerdef(oid) || ' ' || tgenabled::text, ' | ' order by tgname) from pg_trigger where not tgisinternal and tgname in ('dossiers_ventes_par_les_factures', 'factures_emises_source_de_la_vente', 'ecritures_brouillon_vente_facturee', 'lignes_bancaires_reservees_aux_encaissements')$q$, '',
      'CREATE TRIGGER dossiers_ventes_par_les_factures BEFORE UPDATE OF ventes_par_les_factures ON public.dossiers FOR EACH ROW EXECUTE FUNCTION garder_ventes_par_les_factures() O | CREATE TRIGGER ecritures_brouillon_vente_facturee BEFORE INSERT OR UPDATE OF encaissement_id, facture_id ON public.ecritures_brouillon FOR EACH ROW EXECUTE FUNCTION garder_ecriture_vente_facturee() O | CREATE TRIGGER factures_emises_source_de_la_vente BEFORE INSERT OR UPDATE ON public.factures_emises FOR EACH ROW EXECUTE FUNCTION fixer_source_de_la_vente() O | CREATE TRIGGER lignes_bancaires_reservees_aux_encaissements BEFORE INSERT OR UPDATE ON public.lignes_bancaires FOR EACH ROW EXECUTE FUNCTION garder_mouvement_reserve() O'],
    array['valeur', '155. sécurité, chemin et droits des fonctions', 'postgres', $q$select string_agg(proname || ':' || prosecdef || ':' || coalesce(array_to_string(proconfig, ','), '-') || ':' || has_function_privilege('anon', oid, 'execute') || ':' || has_function_privilege('authenticated', oid, 'execute'), ',' order by proname collate "C") from pg_proc where pronamespace = 'public'::regnamespace and proname in ('annuler_encaissement', 'classer_mouvement_par_encaissements', 'encaissement_justifie_son_mouvement', 'enregistrer_encaissement', 'fixer_source_de_la_vente', 'garder_ecriture_vente_facturee', 'garder_encaissement_facture', 'garder_mouvement_reserve', 'garder_ventes_par_les_factures', 'mouvement_libre', 'rattacher_mouvement_encaissement', 'retirer_classement_par_encaissements', 'retirer_encaissement')$q$, '',
      'annuler_encaissement:true:search_path=public:false:true,classer_mouvement_par_encaissements:true:search_path=public:false:true,encaissement_justifie_son_mouvement:false:search_path=public:false:false,enregistrer_encaissement:true:search_path=public:false:true,fixer_source_de_la_vente:true:search_path=public:false:false,garder_ecriture_vente_facturee:false:search_path=public:false:false,garder_encaissement_facture:false:search_path=public:false:false,garder_mouvement_reserve:true:search_path=public:false:false,garder_ventes_par_les_factures:true:search_path=public:false:false,mouvement_libre:false:search_path=public:false:true,rattacher_mouvement_encaissement:true:search_path=public:false:true,retirer_classement_par_encaissements:true:search_path=public:false:true,retirer_encaissement:true:search_path=public:false:true'],
    array['valeur', '156. contre-passer : une seule signature, à cinq paramètres', 'postgres', $q$select string_agg(pg_get_function_identity_arguments(oid), ' | ') from pg_proc where pronamespace = 'public'::regnamespace and proname = 'annuler_encaissement'$q$, '', 'p_dossier_id uuid, p_encaissement_id uuid, p_date date, p_motif text, p_ligne_bancaire_id uuid'],
    array['valeur', '157. qui nomme les trois réglages', 'postgres', $q$select string_agg(r || ':' || (select string_agg(proname, ',' order by proname collate "C") from pg_proc where pronamespace = 'public'::regnamespace and prosrc like '%' || r || '%' and proname not in ('ecrire_vente_facturee', 'garder_lignes_de_la_vente_facturee', 'retirer_ecriture_vente_facturee')), ' | ' order by r) from unnest(array['jd.classement_encaissements', 'jd.ecriture_vente_facturee', 'jd.rattachement_encaissement']) r$q$, '',
      'jd.classement_encaissements:classer_mouvement_par_encaissements,garder_mouvement_reserve,retirer_classement_par_encaissements | jd.ecriture_vente_facturee:garder_ecriture_vente_facturee | jd.rattachement_encaissement:garder_encaissement_facture,rattacher_mouvement_encaissement'],

    -- ══ 160 à 169. Les mutations : chacune doit MORDRE ══════════
    array['controle', '160. MUTATION de 3 : sans facture source, il se baisse', 'chef', $q$update dossiers set ventes_par_les_factures = false where id = '{R}'$q$, 'OK', ''],
    array['controle', '161. MUTATION de 11 : hors bascule, elle se valide', 'chef', $q${ENF}'{A}', null, {FJ1} || '{"date_emission":"2026-03-20"}', {L1}, true)$q$, 'OK', ''],
    array['controle', '162. MUTATION de 30 : le super-administrateur la pose', 'chef', $q${EC}, null, '{F1}')$q$, 'OK', ''],
    array['controle', '163. MUTATION de 45 : sous SON réglage, il change', 'postgres', $q$select set_config('jd.classement_encaissements', '{M2}', true); update lignes_bancaires set encaissements_de_factures = true, statut = 'rapprochee' where id = '{M2}'$q$, 'OK', ''],
    array['controle', '164. MUTATION de 46 : non cité, il se classe', 'chef', $q$update lignes_bancaires {BIL} where id = '{M2}'$q$, 'OK', ''],
    array['controle', '165. MUTATION de 73 : libre, il se cite', 'chef', $q${ENE}'{T}', '{F1}', '2026-03-04', 1, 'virement', '{M2}', '[{"taux":20,"montant":1}]')$q$, 'OK', ''],
    array['controle', '166. MUTATION de 100 : le membre affecté rattache', 'membre', $q${RAT}'{T}', '{ES2}', '{M5}')$q$, 'OK', ''],
    array['controle', '167. MUTATION de 120 : le chef simple classe', 'chef_simple', $q${RCL}'{T}', '{M1}'); {CLA}'{T}', '{M1}')$q$, 'OK', ''],
    array['controle', '168. MUTATION de 60 : une facture source se rattache', 'postgres', $q$select set_config('jd.rattachement_encaissement', '{ES2}', true); update encaissements_factures set ligne_bancaire_id = '{M5}' where id = '{ES2}'$q$, 'OK', ''],
    array['controle', '169. MUTATION de 81 : le classement retiré, il se retire', 'chef', $q${RCL}'{T}', '{M10}'); {RET}'{T}', '{E26}')$q$, 'OK', ''],
    array['controle', '170. MUTATION de 94 : avec « Banque », le rang 2 passe, et le rang 19 dit le montant', 'client_vb', $q${ANN}'{T}', '{E1}', '2026-03-12', 'ESSAI', '{M6}')$q$, '22023', 'Ce mouvement de 50,00 € justifierait 100,00 € de contre-passations : l''écart dépasse ce que des frais bancaires expliquent.']
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
        elsif etape[2] = '*' then
          ids := ids || obs::jsonb;
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
        if etape[3] in ('membre', 'chef_simple', 'client_vb', 'client_v') and etape[1] not in ('controle', 'lecture') then
          raise exception 'ESSAI_MAL_ECRIT : le profil % ne sert qu''à un contrôle ou à une lecture, qui s''annulent', etape[3];
        end if;
        begin
          if etape[3] in ('membre', 'chef_simple') then
            insert into cabinet_admins (user_id, cabinet_id, role)
              values (client, cabinet, case etape[3] when 'membre' then 'comptable' else 'comptable_en_chef' end);
            if etape[3] = 'membre' then
              insert into dossier_assignations (dossier_id, user_id) values ((ids ->> 'T')::uuid, client);
            end if;
          elsif etape[3] = 'client_vb' then
            insert into memberships (user_id, dossier_id, role, droit_ventes, droit_banque) values (client, (ids ->> 'T')::uuid, 'client', true, true);
          elsif etape[3] = 'client_v' then
            insert into memberships (user_id, dossier_id, role, droit_ventes, droit_banque) values (client, (ids ->> 'T')::uuid, 'client', true, false);
          end if;
          if etape[3] <> 'postgres' then
            execute format('set local role %I', case etape[3] when 'anon' then 'anon' when 'service' then 'service_role' else 'authenticated' end);
            perform set_config('request.jwt.claims', case etape[3] when 'anon' then '{"role":"anon"}' when 'service' then '{"role":"service_role"}'
              else json_build_object('sub', case etape[3] when 'chef' then chef when 'inconnu' then inconnu else client end, 'role', 'authenticated')::text end, true);
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
        perform set_config('jd.ecriture_vente_facturee', '', true);
        perform set_config('jd.classement_encaissements', '', true);
        perform set_config('jd.rattachement_encaissement', '', true);
        if etape[1] = 'lecture' then
          verdicts := verdicts || jsonb_build_object('controle', etape[2],
            'observe', case when accepte then coalesce(obs, '∅') else coalesce(code_recu, '?') || ' ' || coalesce(message, '') end,
            'ok', accepte and coalesce(code_recu = 'P0001', false) and coalesce(obs = attendu, false));
        else
          verdicts := verdicts || jsonb_build_object('controle', etape[2],
            'observe', case when accepte then 'accepté' else coalesce(code_recu, '?') || ' ' || coalesce(message, '') end,
            'ok', case when etape[5] = 'OK' then accepte and (etape[1] = 'fait' or coalesce(code_recu = 'P0001', false))
                       else not accepte and coalesce(code_recu = etape[5]
                         and case when right(attendu, 1) = '%' then message like attendu else message = attendu end, false) end);
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
  foreach cle in array tables loop
    execute format('select count(*) from %I', cle) into n;
    apres := concat_ws('/', apres, n);
  end loop;
  verdicts := verdicts || jsonb_build_object('controle', '199. rien n''est resté en base', 'observe', avant || ' -> ' || apres,
    'ok', avant = apres and not exists (select 1 from dossiers where nom like 'ESSAI VF2%')
      and not exists (select 1 from cabinet_admins where user_id = client));

  perform set_config('essai.ventes_facturees', verdicts::text, true);
end $essai$;

-- Un verdict qui n'a pas pu se calculer est une faute, pas un silence. La ligne 0 dit le texte que la base a reçu — par
-- l'outil MCP, qui ajoute sa signature après lui —, pour le comparer au fichier par son empreinte.
select x.controle, x.ok, x.observe from (
  select v.controle, coalesce(v.ok, false) as ok, v.observe
  from jsonb_to_recordset(current_setting('essai.ventes_facturees')::jsonb) as v(controle text, ok boolean, observe text)
  union all
  select '0. information : le texte reçu par la base', true, length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by (regexp_match(x.controle, '^(\d+)'))[1]::int, x.controle;
