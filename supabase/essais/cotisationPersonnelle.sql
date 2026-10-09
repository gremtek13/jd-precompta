-- L'ÉCHÉANCE DE COTISATION PAYÉE DEPUIS LE COMPTE PERSONNEL, ÉPROUVÉE EN BASE — à rejouer par `execute_sql` après toute
-- migration qui touche `enregistrer_paiement_personnel_cotisation`, l'un des trois déclencheurs du paiement personnel
-- (`garder_paiement_personnel`, `garder_mouvement_paiement_personnel`, `garder_ecriture_paiement_personnel`),
-- `garder_cotisation_valide`, `rapprocher_cotisation`, `supprimer_echeance_cotisation`, `valider_exercice`, la table
-- `cotisations_declarees` ou les contraintes de `ecritures_brouillon` et de `lignes_bancaires` (ligne 26.6 de la feuille
-- de route ; migration `paiement_personnel_des_cotisations`). Le RETRAIT d'un paiement, dans une migration à part que le
-- cabinet colle, a son propre essai (`retraitPaiementPersonnel.sql`).
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - QUI déclare : un anonyme n'a pas le droit d'appeler ; un compte rattaché à rien et un client — sur le dossier d'un
--     autre comme sur le SIEN — se font refuser l'accès au dossier ; le chef du cabinet déclare (le contrôle POSITIF) ;
--   - CE QUI S'ÉCRIT, d'un seul tenant avec la date du paiement : en trésorerie, la cotisation hors CSG-CRDS au 646000
--     face au 108000, datée du paiement — un appel au débit du 646000, un remboursement au crédit —, et rien pour une
--     échéance toute de CSG-CRDS ; le versement saisi fait foi sur l'appel ; en engagement, toute l'échéance au 646000
--     face au compte choisi pour le dirigeant ;
--   - CE QUI SE REFUSE, avec sa RAISON, dans l'ordre de la fonction : l'échéance d'un autre dossier, déjà payée,
--     rapprochée, figée ; la date absente, d'avant 2000, dans l'avenir, dans un exercice figé, d'avant l'ouverture
--     d'un dossier repris ; une échéance nulle, pas au centime, une CSG-CRDS pas au centime ou au-delà de l'échéance ;
--     une écriture illisible ou qui n'est pas celle qu'on attend — dont celle d'un rapprochement, à trois lignes ;
--   - JAMAIS LES DEUX : une échéance payée depuis le compte personnel ne se rapproche pas, ni par la fonction ni par une
--     mise à jour directe du mouvement ; une échéance rapprochée ne reçoit pas la date d'un paiement, même sous le
--     réglage de la fonction ;
--   - CE QUE LES DÉCLENCHEURS TIENNENT SANS LA FONCTION : la date ne se pose ni ne change en direct ; les montants
--     d'une échéance payée ne changent plus (son échéance et son caractère prévisionnel, si) ; l'écriture ne se
--     modifie pas et ne s'écrit pas en direct — sauf par la porte de la restauration, le super-administrateur dans un
--     dossier sans exercice validé, et encore au jour du paiement de son échéance ;
--   - CE QUE LA VALIDATION FIGE : une échéance compte à la date de son paiement personnel, et c'est cette date qui la
--     fige ; ses écritures, numérotées par la validation, ne changent plus ; un paiement ne se déclare plus dans un
--     exercice validé, ni sur une échéance qu'il fige ; supprimer une échéance payée dans un exercice validé se refuse ;
--   - SUPPRIMER UNE ÉCHÉANCE PAYÉE (`supprimer_echeance_cotisation`) emporte son écriture, par la cascade de la clé ;
--   - CE QUE LE CATALOGUE DIT, faute de pouvoir le jouer ici : les droits d'exécution, la cascade de la clé, les
--     déclencheurs et ce que le déclencheur de l'écriture laisse passer à la suppression ;
--   - et que RIEN ne reste en base après l'essai.
--
-- CE QUI NE SE JOUE PAS ICI, ET SE JOUE SUR UNE RÉPLIQUE LOCALE DU SCHÉMA (signature.sql) : une suppression directe de
-- l'écriture (refusée) et celle d'un dossier entier (permise), deux sessions qui déclarent et rapprochent la même
-- échéance en même temps, et un membre du cabinet qui n'est pas super-administrateur (aucun n'existe sur ce projet) —
-- l'outil d'exécution soumet une suppression à une confirmation qui n'arrive pas ici.
--
-- Tout se joue dans des dossiers JETABLES du cabinet du dossier `test`, au sein d'un bloc qui s'annule entièrement à la
-- fin (`ANNULATION_ESSAI_GLOBALE`) ; chaque contrôle dans sa sous-transaction, annulée elle aussi (`ANNULATION_ESSAI`,
-- P0001), le verdict posé dans une VARIABLE avant — le moteur d'étapes de validationExercice.sql, dont les quatre genres
-- sont repris : `jeu` (posé par le propriétaire, gardé), `controle` (joué sous un profil puis annulé ; « OK » attend
-- qu'il passe), `fait` (joué et gardé jusqu'à l'annulation finale), `valeur` (une lecture qui doit rendre exactement la
-- valeur attendue). Un refus se juge à son code ET à son message (motif LIKE). Les identifiants jetables sont FIXES
-- (préfixe `e55c0700`), désignés par leur nom entre accolades. Les verdicts voyagent dans un réglage LOCAL à la
-- transaction (`essai.paiement_personnel`), que la requête finale lit : hors de l'outil d'exécution, le fichier se joue
-- en UNE transaction (`psql -1`). Aucune instruction de suppression.
--
-- JOUÉ EN PRODUCTION LE 09/10/2026, juste après la migration : 90 contrôles sur 90, et 4/43/3/998/0/0/0/0 lignes avant
-- comme après (dossiers, échéances, écritures, mouvements, à-nouveaux, exercices validés, soldes reportés, échéances
-- payées depuis le compte personnel). Le texte reçu par la base est le fichier d'alors — sans ce paragraphe ni son saut
-- de ligne final (46 786 caractères, empreinte 8465d3e9…) ; rejoué le même jour, le même texte, après la migration
-- `revision_des_soldes` d'un autre chantier : les mêmes 90. Sur une réplique dont la signature (signature.sql) est
-- celle de la production : les mêmes 90 ; quinze contrôles qui suppriment (le dossier entier, l'écriture en direct,
-- l'échéance figée) ou qui demandent un membre du cabinet non super-administrateur, et cinq scénarios de deux sessions
-- concurrentes — essais locaux de la session, hors du dépôt, comme ceux du 04/10/2026 ; les cinquante-six mutations
-- de la migration mordent toutes.
do $essai$
declare
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  inconnu uuid := gen_random_uuid();
  dossier_test uuid := '001c7ed7-c23b-4590-901e-693489f8af24';
  dossier_client uuid; cabinet uuid;
  demain text := to_char((now() at time zone 'Europe/Paris')::date + 1, 'YYYY-MM-DD');
  ids jsonb;
  etapes text[];
  etape text[];
  cle text; valeur text; s text;
  accepte boolean; code_recu text; message text; obs text;
  avant text; apres text;
  verdicts jsonb := '[]'::jsonb;
begin
  select m.dossier_id into dossier_client from memberships m where m.user_id = client order by m.dossier_id limit 1;
  select cabinet_id into cabinet from dossiers where id = dossier_test;
  if dossier_client is null or cabinet is null or dossier_client = dossier_test
     or not exists (select 1 from super_admins where user_id = chef)
     or not exists (select 1 from cabinet_admins where user_id = chef and cabinet_id = cabinet and role = 'comptable_en_chef')
     or extract(year from (now() at time zone 'Europe/Paris'))::int <> 2026 then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable (ou l''année n''est plus 2026 : les dates de l''essai sont à avancer)';
  end if;

  ids := jsonb_build_object('CAB', cabinet, 'DC', dossier_client, 'DEMAIN', demain)
    || jsonb_build_object(
      'T', 'e55c0700-0000-4000-8000-0000000000a1', 'E', 'e55c0700-0000-4000-8000-0000000000a2',
      'V', 'e55c0700-0000-4000-8000-0000000000a3', 'O', 'e55c0700-0000-4000-8000-0000000000a4')
    || jsonb_build_object(
      'C1', 'e55c0700-0000-4000-8001-000000000001', 'C2', 'e55c0700-0000-4000-8001-000000000002',
      'C3', 'e55c0700-0000-4000-8001-000000000003', 'C4', 'e55c0700-0000-4000-8001-000000000004',
      'C5', 'e55c0700-0000-4000-8001-000000000005', 'C6', 'e55c0700-0000-4000-8001-000000000006',
      'C7', 'e55c0700-0000-4000-8001-000000000007', 'C8', 'e55c0700-0000-4000-8001-000000000008',
      'C9', 'e55c0700-0000-4000-8001-000000000009', 'CN', 'e55c0700-0000-4000-8001-00000000000a',
      'CR', 'e55c0700-0000-4000-8001-00000000000b', 'CP', 'e55c0700-0000-4000-8001-00000000000c',
      'CK', 'e55c0700-0000-4000-8001-00000000000d', 'CC', 'e55c0700-0000-4000-8001-00000000000e',
      'CZ', 'e55c0700-0000-4000-8001-00000000000f')
    || jsonb_build_object(
      'CE', 'e55c0700-0000-4000-8002-000000000001', 'CO', 'e55c0700-0000-4000-8002-000000000002',
      'CE2', 'e55c0700-0000-4000-8002-000000000003',
      'CV1', 'e55c0700-0000-4000-8002-000000000011', 'CV2', 'e55c0700-0000-4000-8002-000000000012',
      'CV3', 'e55c0700-0000-4000-8002-000000000013', 'CV4', 'e55c0700-0000-4000-8002-000000000014',
      'CV5', 'e55c0700-0000-4000-8002-000000000015')
    || jsonb_build_object(
      'MR', 'e55c0700-0000-4000-8003-000000000001', 'MX', 'e55c0700-0000-4000-8003-000000000002',
      'MY', 'e55c0700-0000-4000-8003-000000000003', 'AO1', 'e55c0700-0000-4000-8004-000000000001',
      'AO2', 'e55c0700-0000-4000-8004-000000000002', 'ER', 'e55c0700-0000-4000-8005-000000000001');

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from cotisations_declarees)), ((select count(*) from ecritures_brouillon)),
    ((select count(*) from lignes_bancaires)), ((select count(*) from a_nouveaux)), ((select count(*) from exercices_valides)),
    ((select count(*) from soldes_reportes)), ((select count(*) from cotisations_declarees where paiement_personnel_le is not null))
  ) as t(n);

  -- Une étape : {genre, contrôle, qui, requête, code attendu, message attendu (motif LIKE) ou valeur attendue}.
  etapes := array[
    -- ══ Le jeu : quatre dossiers jetables du cabinet du dossier test, leurs échéances et leurs mouvements ══════════
    array['jeu', 'dossiers jetables', 'postgres', $q$insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values
      ('{T}', 'ESSAI PAIEMENT PERSONNEL T', '{CAB}', 'tresorerie', '455000'), ('{E}', 'ESSAI PAIEMENT PERSONNEL E', '{CAB}', 'engagement', '455000'),
      ('{V}', 'ESSAI PAIEMENT PERSONNEL V', '{CAB}', 'tresorerie', '455000'), ('{O}', 'ESSAI PAIEMENT PERSONNEL O', '{CAB}', 'tresorerie', '455000')$q$, '', ''],
    array['jeu', 'échéances de T', 'postgres', $q$insert into cotisations_declarees (id, dossier_id, echeance, montant_appele, montant_verse, montant_csg_crds) values
      ('{C1}', '{T}', '2026-03-05', 1000, null, 300), ('{C2}', '{T}', '2026-04-05', -120, null, -11.64),
      ('{C3}', '{T}', '2026-05-05', 250, null, 250), ('{C4}', '{T}', '2026-06-05', 500, null, null),
      ('{C5}', '{T}', '2026-01-05', 0, null, null), ('{C6}', '{T}', '2026-01-06', 100.005, null, null),
      ('{C7}', '{T}', '2026-01-07', 100, null, 10.001), ('{C8}', '{T}', '2026-01-08', 100, null, 150),
      ('{C9}', '{T}', '2026-07-05', 500, 480, 48), ('{CN}', '{T}', '2026-08-05', 90, null, null),
      ('{CR}', '{T}', '2026-03-05', 400, null, null), ('{CP}', '{T}', '2026-09-05', 600, null, null),
      ('{CK}', '{T}', '2026-09-15', 1000, null, 300), ('{CZ}', '{T}', '2026-05-15', 250, null, 250)$q$, '', ''],
    array['jeu', 'échéance du client', 'postgres', $q$insert into cotisations_declarees (id, dossier_id, echeance, montant_appele) values ('{CC}', '{DC}', '2026-03-05', 100)$q$, '', ''],
    array['jeu', 'échéance de E', 'postgres', $q$insert into cotisations_declarees (id, dossier_id, echeance, montant_appele, montant_csg_crds) values ('{CE}', '{E}', '2026-03-05', 1000, 300), ('{CE2}', '{E}', '2026-03-08', 100, 150)$q$, '', ''],
    array['jeu', 'échéances de V', 'postgres', $q$insert into cotisations_declarees (id, dossier_id, echeance, montant_appele) values
      ('{CV1}', '{V}', '2025-03-05', 800), ('{CV2}', '{V}', '2026-02-05', 300), ('{CV3}', '{V}', '2025-12-05', 200),
      ('{CV4}', '{V}', '2025-12-15', 150), ('{CV5}', '{V}', '2026-03-01', 50)$q$, '', ''],
    array['jeu', 'ouverture de O, et son échéance', 'postgres', $q$insert into a_nouveaux (id, dossier_id, date, compte, sens, montant, source_nom, source_empreinte) values
      ('{AO1}', '{O}', '2025-01-01', '512000', 'debit', 10, 'balance-essai-o.csv', repeat('e', 64)),
      ('{AO2}', '{O}', '2025-01-01', '101000', 'credit', 10, 'balance-essai-o.csv', repeat('e', 64))$q$, '', ''],
    array['jeu', 'échéance de O', 'postgres', $q$insert into cotisations_declarees (id, dossier_id, echeance, montant_appele) values ('{CO}', '{O}', '2025-02-05', 60)$q$, '', ''],
    -- Un prélèvement rapproché de CR, et deux mouvements à traiter de T pour rapprocher CP.
    array['jeu', 'mouvements de T', 'postgres', $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut, cotisation_id) values
      ('{MR}', '{T}', '2026-03-05', 'ESSAI PRLV URSSAF CR', -400, 'rapprochee', '{CR}'),
      ('{MX}', '{T}', '2026-09-05', 'ESSAI PRLV URSSAF CP', -600, 'non_rapprochee', null)$q$, '', ''],

    -- ══ 1 à 4. Qui déclare ══════════
    array['controle', '1. anonyme : pas le droit d''appeler', 'anon', $q$select enregistrer_paiement_personnel_cotisation('{T}', '{C4}', '2026-06-05', '[]'::jsonb)$q$,
      '42501', 'permission denied for function enregistrer_paiement_personnel_cotisation'],
    array['controle', '2. rattaché à rien : l''accès au dossier, avant de rien lire', 'inconnu', $q$select enregistrer_paiement_personnel_cotisation('{T}', '{C4}', '2026-06-05', '[]'::jsonb)$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '3. client, le dossier d''un autre', 'client', $q$select enregistrer_paiement_personnel_cotisation('{T}', '{C4}', '2026-06-05', '[]'::jsonb)$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '4. client, son propre dossier', 'client', $q$select enregistrer_paiement_personnel_cotisation('{DC}', '{CC}', '2026-03-10', '[{"compte":"646000","sens":"debit","montant":100},{"compte":"108000","sens":"credit","montant":100}]'::jsonb)$q$,
      '42501', 'Accès refusé à ce dossier.'],

    -- ══ 5 à 13. Ce qui s'écrit ══════════
    array['fait', '5. le chef déclare un appel payé de sa poche (CSG-CRDS saisie) : deux lignes, nettes de la CSG-CRDS', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{T}', '{C1}', '2026-03-10', '[{"compte":"646000","sens":"debit","montant":700.00,"libelle":"Cotisation, échéance du 05/03/2026, payée depuis le compte personnel"},{"compte":"108000","sens":"credit","montant":700.00,"libelle":"Cotisation, échéance du 05/03/2026, payée depuis le compte personnel"}]'::jsonb)$q$, 'OK', ''],
    array['valeur', '6. son écriture : 646000 au débit, 108000 au crédit, au jour du paiement, désignant l''échéance', 'postgres', $q$select string_agg(compte || ':' || sens || ':' || trim_scale(montant) || ':' || date || ':' || statut || ':' || (piece_id is null and ligne_bancaire_id is null)::text, ',' order by compte collate "C") from ecritures_brouillon where cotisation_id = '{C1}'$q$, '',
      '108000:credit:700:2026-03-10:proposee:true,646000:debit:700:2026-03-10:proposee:true'],
    array['valeur', '7. et la date du paiement, sur l''échéance', 'postgres', $q$select paiement_personnel_le::text from cotisations_declarees where id = '{C1}'$q$, '', '2026-03-10'],
    array['fait', '8. un remboursement reçu sur le compte personnel', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{T}', '{C2}', '2026-04-12', '[{"compte":"646000","sens":"credit","montant":108.36},{"compte":"108000","sens":"debit","montant":108.36}]'::jsonb)$q$, 'OK', ''],
    array['valeur', '9. son écriture : 646000 au crédit, 108000 au débit', 'postgres', $q$select string_agg(compte || ':' || sens || ':' || trim_scale(montant) || ':' || date, ',' order by compte collate "C") from ecritures_brouillon where cotisation_id = '{C2}'$q$, '',
      '108000:debit:108.36:2026-04-12,646000:credit:108.36:2026-04-12'],
    array['fait', '10. une échéance faite toute de CSG-CRDS : rien à écrire, la date posée', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{T}', '{C3}', '2026-05-07', '[]'::jsonb)$q$, 'OK', ''],
    array['valeur', '11. aucune ligne, et la date', 'postgres', $q$select (select count(*) from ecritures_brouillon where cotisation_id = '{C3}') || ':' || paiement_personnel_le from cotisations_declarees where id = '{C3}'$q$, '', '0:2026-05-07'],
    array['fait', '12. le versement saisi fait foi sur l''appel', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{T}', '{C9}', '2026-07-06', '[{"compte":"646000","sens":"debit","montant":432},{"compte":"108000","sens":"credit","montant":432}]'::jsonb)$q$, 'OK', ''],
    array['controle', '13. en ENGAGEMENT, toute l''échéance au 646000 face au compte choisi pour le dirigeant', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{E}', '{CE}', '2026-03-10', '[{"compte":"646000","sens":"debit","montant":1000},{"compte":"455000","sens":"credit","montant":1000}]'::jsonb)$q$, 'OK', ''],

    -- ══ 14 à 39. Les refus, dans l'ordre de la fonction ══════════
    array['controle', '14. l''échéance d''un autre dossier : introuvable dans celui-ci', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{E}', '{C4}', '2026-06-05', '[]'::jsonb)$q$,
      'P0002', 'Échéance introuvable dans ce dossier.'],
    array['controle', '15. déjà payée : un paiement ne se remplace pas', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{T}', '{C1}', '2026-03-11', '[{"compte":"646000","sens":"debit","montant":700},{"compte":"108000","sens":"credit","montant":700}]'::jsonb)$q$,
      '22023', 'Cette échéance est déjà payée depuis le compte personnel, le 10/03/2026 : retire d''abord ce paiement.'],
    array['controle', '16. rapprochée d''un prélèvement : jamais les deux', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{T}', '{CR}', '2026-03-10', '[{"compte":"646000","sens":"debit","montant":400},{"compte":"108000","sens":"credit","montant":400}]'::jsonb)$q$,
      '22023', 'Cette échéance est rapprochée du mouvement du 05/03/2026 : elle ne se paie pas aussi depuis le compte personnel.'],
    array['controle', '17. la date est à renseigner', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{T}', '{C4}', null, '[]'::jsonb)$q$,
      '22023', 'La date du paiement depuis le compte personnel est à renseigner.'],
    array['controle', '18. pas avant l''an 2000', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{T}', '{C4}', '1999-12-31', '[]'::jsonb)$q$,
      '22023', 'Un paiement ne se date pas avant l''an 2000.'],
    array['controle', '19. pas dans l''avenir, le jour lu à Paris', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{T}', '{C4}', '{DEMAIN}', '[]'::jsonb)$q$,
      '22023', 'Un paiement ne se date pas dans l''avenir : nous sommes le %.'],
    array['controle', '20. avant l''ouverture d''un dossier repris : dans les comptes repris', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{O}', '{CO}', '2024-12-20', '[{"compte":"646000","sens":"debit","montant":60},{"compte":"108000","sens":"credit","montant":60}]'::jsonb)$q$,
      '22023', 'Ce paiement précède l''ouverture du dossier, le 01/01/2025 : il est dans les comptes repris.'],
    array['controle', '21. une échéance de zéro euro', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{T}', '{C5}', '2026-01-05', '[]'::jsonb)$q$,
      '22023', 'Une échéance de zéro euro n''a rien à payer.'],
    array['controle', '22. un montant qui n''est pas au centime', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{T}', '{C6}', '2026-01-06', '[]'::jsonb)$q$,
      '22023', 'Le montant de cette échéance n''est pas au centime.'],
    array['controle', '23. une CSG-CRDS qui n''est pas au centime', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{T}', '{C7}', '2026-01-07', '[]'::jsonb)$q$,
      '22023', 'La CSG-CRDS de cette échéance n''est pas au centime.'],
    array['controle', '24. une CSG-CRDS au-delà de l''échéance', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{T}', '{C8}', '2026-01-08', '[]'::jsonb)$q$,
      '22023', 'La CSG-CRDS de cette échéance (150,00 €) dépasse son montant (100,00 €).'],
    array['controle', '25. en engagement, une CSG-CRDS au-delà de l''échéance ne gêne pas : elle reste au 646000', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{E}', '{CE2}', '2026-03-12', '[{"compte":"646000","sens":"debit","montant":100},{"compte":"455000","sens":"credit","montant":100}]'::jsonb)$q$, 'OK', ''],
    array['controle', '26. l''écriture n''est pas une liste', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{T}', '{C4}', '2026-06-05', '{}'::jsonb)$q$,
      '22023', 'L''écriture proposée est incomplète.'],
    array['controle', '27. une ligne sans montant', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{T}', '{C4}', '2026-06-05', '[{"compte":"646000","sens":"debit"},{"compte":"108000","sens":"credit","montant":500}]'::jsonb)$q$,
      '22023', 'L''écriture proposée est incomplète.'],
    array['controle', '28. un montant écrit en texte', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{T}', '{C4}', '2026-06-05', '[{"compte":"646000","sens":"debit","montant":"500"},{"compte":"108000","sens":"credit","montant":500}]'::jsonb)$q$,
      '22023', 'L''écriture proposée est incomplète.'],
    array['controle', '29. un autre montant', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{T}', '{C4}', '2026-06-05', '[{"compte":"646000","sens":"debit","montant":499.99},{"compte":"108000","sens":"credit","montant":499.99}]'::jsonb)$q$,
      '22023', 'L''écriture proposée ne correspond pas à cette échéance et au compte du dirigeant (108000).'],
    array['controle', '30. un millième de trop', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{T}', '{C4}', '2026-06-05', '[{"compte":"646000","sens":"debit","montant":500.001},{"compte":"108000","sens":"credit","montant":500}]'::jsonb)$q$,
      '22023', 'L''écriture proposée ne correspond pas à cette échéance et au compte du dirigeant (108000).'],
    array['controle', '31. une ligne de plus, à zéro', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{T}', '{C4}', '2026-06-05', '[{"compte":"646000","sens":"debit","montant":500},{"compte":"108000","sens":"credit","montant":500},{"compte":"108000","sens":"debit","montant":0}]'::jsonb)$q$,
      '22023', 'L''écriture proposée ne correspond pas à cette échéance et au compte du dirigeant (108000).'],
    array['controle', '32. la banque à la place du compte du dirigeant', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{T}', '{C4}', '2026-06-05', '[{"compte":"646000","sens":"debit","montant":500},{"compte":"512000","sens":"credit","montant":500}]'::jsonb)$q$,
      '22023', 'L''écriture proposée ne correspond pas à cette échéance et au compte du dirigeant (108000).'],
    array['controle', '33. l''écriture d''un rapprochement, à trois lignes, n''est pas celle d''un paiement personnel', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{T}', '{CK}', '2026-09-06', '[{"compte":"646000","sens":"debit","montant":700},{"compte":"108000","sens":"debit","montant":300},{"compte":"108000","sens":"credit","montant":1000}]'::jsonb)$q$,
      '22023', 'L''écriture proposée ne correspond pas à cette échéance et au compte du dirigeant (108000).'],
    array['controle', '34. le sens inversé', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{T}', '{C4}', '2026-06-05', '[{"compte":"646000","sens":"credit","montant":500},{"compte":"108000","sens":"debit","montant":500}]'::jsonb)$q$,
      '22023', 'L''écriture proposée ne correspond pas à cette échéance et au compte du dirigeant (108000).'],
    array['controle', '35. en engagement, l''écriture nette de la trésorerie est refusée', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{E}', '{CE}', '2026-03-10', '[{"compte":"646000","sens":"debit","montant":700},{"compte":"455000","sens":"credit","montant":700}]'::jsonb)$q$,
      '22023', 'L''écriture proposée ne correspond pas à cette échéance et au compte du dirigeant (455000).'],
    array['controle', '36. en engagement, le 108000 n''est pas le compte du dirigeant de ce dossier', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{E}', '{CE}', '2026-03-10', '[{"compte":"646000","sens":"debit","montant":1000},{"compte":"108000","sens":"credit","montant":1000}]'::jsonb)$q$,
      '22023', 'L''écriture proposée ne correspond pas à cette échéance et au compte du dirigeant (455000).'],
    array['controle', '37. une échéance toute de CSG-CRDS n''attend aucune ligne', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{T}', '{CZ}', '2026-05-16', '[{"compte":"646000","sens":"debit","montant":0.01},{"compte":"108000","sens":"credit","montant":0.01}]'::jsonb)$q$,
      '22023', 'L''écriture proposée ne correspond pas à cette échéance et au compte du dirigeant (108000).'],
    -- ══ 40 à 45. Jamais les deux, sans la fonction ══════════
    array['fait', '40. CP est payée de la poche de l''exploitant', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{T}', '{CP}', '2026-09-06', '[{"compte":"646000","sens":"debit","montant":600},{"compte":"108000","sens":"credit","montant":600}]'::jsonb)$q$, 'OK', ''],
    array['controle', '40b. le réglage de la fonction ne survit pas à son appel : la date de CP ne se change pas ensuite en direct', 'chef', $q$update cotisations_declarees set paiement_personnel_le = '2026-09-07' where id = '{CP}'$q$,
      '42501', 'Une échéance ne se déclare payée depuis le compte personnel que par l''application, avec son écriture.'],
    array['controle', '41. le prélèvement ne la rapproche plus, par la fonction', 'chef', $q$select rapprocher_cotisation('{MX}', '{CP}', '[{"compte":"512000","sens":"credit","montant":600},{"compte":"646000","sens":"debit","montant":600}]'::jsonb)$q$,
      '23514', 'Cette échéance est payée depuis le compte personnel, le 06/09/2026 : un mouvement ne la paie pas aussi.'],
    array['controle', '42. ni par une mise à jour directe du mouvement', 'chef', $q$update lignes_bancaires set statut = 'rapprochee', cotisation_id = '{CP}' where id = '{MX}'$q$,
      '23514', 'Cette échéance est payée depuis le compte personnel, le 06/09/2026 : un mouvement ne la paie pas aussi.'],
    array['controle', '43. ni par un mouvement inséré déjà rapproché', 'postgres', $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut, cotisation_id) values ('{MY}', '{T}', '2026-09-06', 'ESSAI PRLV', -600, 'rapprochee', '{CP}')$q$,
      '23514', 'Cette échéance est payée depuis le compte personnel, le 06/09/2026 : un mouvement ne la paie pas aussi.'],
    array['controle', '44. une échéance rapprochée ne reçoit pas de date de paiement, même sous le réglage de la fonction', 'postgres', $q$update cotisations_declarees set paiement_personnel_le = '2026-03-10' where id = '{CR}' and set_config('jd.paiement_personnel', '{CR}', true) is not null$q$,
      '23514', 'Cette échéance est rapprochée du mouvement du 05/03/2026 : elle ne se paie pas aussi depuis le compte personnel.'],
    array['controle', '45. un mouvement qui ne change pas d''échéance passe toujours', 'postgres', $q$update lignes_bancaires set cotisation_id = '{CR}', libelle = 'ESSAI PRLV URSSAF CR (relu)' where id = '{MR}'$q$, 'OK', ''],

    -- ══ 46 à 58. Ce que les déclencheurs tiennent sans la fonction ══════════
    array['controle', '46. la date ne se pose pas en direct, même par le chef', 'chef', $q$update cotisations_declarees set paiement_personnel_le = '2026-08-06' where id = '{CN}'$q$,
      '42501', 'Une échéance ne se déclare payée depuis le compte personnel que par l''application, avec son écriture.'],
    array['controle', '47. ni ne change', 'chef', $q$update cotisations_declarees set paiement_personnel_le = '2026-03-11' where id = '{C1}'$q$,
      '42501', 'Une échéance ne se déclare payée depuis le compte personnel que par l''application, avec son écriture.'],
    array['controle', '48. ni ne s''efface', 'chef', $q$update cotisations_declarees set paiement_personnel_le = null where id = '{C1}'$q$,
      '42501', 'Une échéance ne se déclare payée depuis le compte personnel que par l''application, avec son écriture.'],
    array['controle', '49. le réglage d''une AUTRE échéance n''ouvre rien', 'postgres', $q$update cotisations_declarees set paiement_personnel_le = '2026-08-06' where id = '{CN}' and set_config('jd.paiement_personnel', '{C1}', true) is not null$q$,
      '42501', 'Une échéance ne se déclare payée depuis le compte personnel que par l''application, avec son écriture.'],
    array['controle', '50. les montants d''une échéance payée ne changent plus', 'chef', $q$update cotisations_declarees set montant_appele = 999 where id = '{C1}'$q$,
      '23514', 'Cette échéance est payée depuis le compte personnel, le 10/03/2026 : ni ses montants ni son dossier ne changent tant que ce paiement n''est pas retiré.'],
    array['controle', '51. ni sa CSG-CRDS', 'chef', $q$update cotisations_declarees set montant_csg_crds = 301 where id = '{C1}'$q$,
      '23514', 'Cette échéance est payée depuis le compte personnel, le 10/03/2026 : ni ses montants ni son dossier ne changent tant que ce paiement n''est pas retiré.'],
    array['controle', '52. ni son versement', 'chef', $q$update cotisations_declarees set montant_verse = 1000 where id = '{C1}'$q$,
      '23514', 'Cette échéance est payée depuis le compte personnel, le 10/03/2026 : ni ses montants ni son dossier ne changent tant que ce paiement n''est pas retiré.'],
    array['controle', '52b. ni son dossier : son écriture resterait dans l''autre', 'chef', $q$update cotisations_declarees set dossier_id = '{E}' where id = '{C1}'$q$,
      '23514', 'Cette échéance est payée depuis le compte personnel, le 10/03/2026 : ni ses montants ni son dossier ne changent tant que ce paiement n''est pas retiré.'],
    array['controle', '53. son échéance et son caractère prévisionnel, si', 'chef', $q$update cotisations_declarees set echeance = '2026-03-06', previsionnel = true where id = '{C1}'$q$, 'OK', ''],
    array['controle', '54. l''écriture ne se modifie pas', 'chef', $q$update ecritures_brouillon set montant = 701 where cotisation_id = '{C1}' and compte = '646000'$q$,
      '42501', 'L''écriture d''un paiement depuis le compte personnel ne se modifie pas : retire le paiement, puis déclare-le de nouveau.'],
    array['controle', '55. ni son libellé, ni son lien', 'chef', $q$update ecritures_brouillon set libelle = 'autre', cotisation_id = '{C4}' where cotisation_id = '{C1}'$q$,
      '42501', 'L''écriture d''un paiement depuis le compte personnel ne se modifie pas : retire le paiement, puis déclare-le de nouveau.'],
    array['controle', '55b. ni son libellé seul', 'chef', $q$update ecritures_brouillon set libelle = 'autre' where cotisation_id = '{C1}'$q$,
      '42501', 'L''écriture d''un paiement depuis le compte personnel ne se modifie pas : retire le paiement, puis déclare-le de nouveau.'],
    array['controle', '56. une écriture ne s''écrit pas en direct par le rôle des Edge Functions', 'service_role', $q$insert into ecritures_brouillon (id, dossier_id, cotisation_id, date, compte, libelle, montant, sens) values ('{ER}', '{T}', '{C1}', '2026-03-10', '646000', 'ESSAI', 1, 'debit')$q$,
      '42501', 'L''écriture d''un paiement depuis le compte personnel ne s''écrit qu''avec ce paiement, par l''application.'],
    array['controle', '57. ni une date posée par lui', 'service_role', $q$update cotisations_declarees set paiement_personnel_le = '2026-08-06' where id = '{CN}'$q$,
      '42501', 'Une échéance ne se déclare payée depuis le compte personnel que par l''application, avec son écriture.'],
    array['controle', '58. ni une échéance insérée déjà payée par lui', 'service_role', $q$insert into cotisations_declarees (dossier_id, echeance, montant_appele, paiement_personnel_le) values ('{T}', '2026-10-01', 10, '2026-10-02')$q$,
      '42501', 'Une échéance ne se déclare payée depuis le compte personnel que par l''application, avec son écriture.'],
    array['controle', '59. la porte de la restauration : le super-administrateur insère une échéance payée, dans un dossier sans exercice validé', 'chef', $q$insert into cotisations_declarees (dossier_id, echeance, montant_appele, paiement_personnel_le) values ('{T}', '2026-10-01', 10, '2026-10-02')$q$, 'OK', ''],
    array['controle', '60. et son écriture, au jour du paiement', 'chef', $q$insert into ecritures_brouillon (id, dossier_id, cotisation_id, date, compte, libelle, montant, sens) values ('{ER}', '{T}', '{C1}', '2026-03-10', '646000', 'ESSAI', 1, 'debit')$q$, 'OK', ''],
    array['controle', '61. mais pas à un autre jour', 'chef', $q$insert into ecritures_brouillon (id, dossier_id, cotisation_id, date, compte, libelle, montant, sens) values ('{ER}', '{T}', '{C1}', '2026-03-12', '646000', 'ESSAI', 1, 'debit')$q$,
      '23514', 'Cette écriture ne suit pas le paiement depuis le compte personnel de son échéance.'],
    array['controle', '62. ni dans un autre dossier que celui de l''échéance', 'chef', $q$insert into ecritures_brouillon (id, dossier_id, cotisation_id, date, compte, libelle, montant, sens) values ('{ER}', '{E}', '{C1}', '2026-03-10', '646000', 'ESSAI', 1, 'debit')$q$,
      '23514', 'Cette écriture ne suit pas le paiement depuis le compte personnel de son échéance.'],
    array['controle', '63. ni pour une échéance qui n''est pas payée depuis le compte personnel', 'chef', $q$insert into ecritures_brouillon (id, dossier_id, cotisation_id, date, compte, libelle, montant, sens) values ('{ER}', '{T}', '{CN}', '2026-08-05', '646000', 'ESSAI', 1, 'debit')$q$,
      '23514', 'Cette écriture ne suit pas le paiement depuis le compte personnel de son échéance.'],
    array['controle', '64. une écriture de paiement personnel n''a ni pièce ni mouvement', 'chef', $q$insert into ecritures_brouillon (id, dossier_id, cotisation_id, ligne_bancaire_id, date, compte, libelle, montant, sens) values ('{ER}', '{T}', '{C1}', '{MX}', '2026-03-10', '646000', 'ESSAI', 1, 'debit')$q$,
      '23514', '%ecritures_brouillon_cotisation_sans_autre_source%'],

    -- ══ 65 à 67. Supprimer une échéance payée emporte son écriture ══════════
    array['fait', '65. supprimer l''échéance payée (par la fonction de l''écran)', 'chef', $q$select supprimer_echeance_cotisation('{C9}')$q$, 'OK', ''],
    array['valeur', '66. l''échéance et son écriture sont parties', 'postgres', $q$select (select count(*) from cotisations_declarees where id = '{C9}') || ':' || (select count(*) from ecritures_brouillon where cotisation_id = '{C9}')$q$, '', '0:0'],

    -- ══ 70 à 84. Ce que la validation fige ══════════
    array['fait', '70. V : une échéance de 2025 payée de la poche de l''exploitant en 2025', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{V}', '{CV1}', '2025-03-10', '[{"compte":"646000","sens":"debit","montant":800},{"compte":"108000","sens":"credit","montant":800}]'::jsonb)$q$, 'OK', ''],
    array['fait', '71. V : une échéance de 2026 payée d''avance, en décembre 2025', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{V}', '{CV2}', '2025-12-20', '[{"compte":"646000","sens":"debit","montant":300},{"compte":"108000","sens":"credit","montant":300}]'::jsonb)$q$, 'OK', ''],
    array['fait', '72. V : une échéance de décembre 2025 payée en janvier 2026', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{V}', '{CV4}', '2026-01-10', '[{"compte":"646000","sens":"debit","montant":150},{"compte":"108000","sens":"credit","montant":150}]'::jsonb)$q$, 'OK', ''],
    array['fait', '73. V : la validation de 2025 numérote les écritures des deux paiements de 2025, au journal des opérations diverses', 'chef', $q$select valider_exercice('{V}', 2025, (select jsonb_agg(jsonb_build_object('id', e.id, 'journal', 'OD',
        'numero', case e.cotisation_id when '{CV1}' then 1 else 2 end, 'piece_ref', 'Compte personnel du ' || to_char(e.date, 'DD/MM/YYYY'),
        'piece_date', e.date, 'compte_lib', case e.compte when '646000' then 'Cotisations sociales personnelles de l''exploitant' else 'Compte de l''exploitant' end))
      from ecritures_brouillon e where e.dossier_id = '{V}' and e.date <= '2025-12-31'), '[]'::jsonb, '{}'::jsonb)$q$, 'OK', ''],
    array['valeur', '74. elles sont validées, au journal OD, sous la pièce de leur paiement', 'postgres', $q$select string_agg(journal_code || numero_ecriture || ':' || compte || ':' || statut || ':' || piece_ref, ',' order by numero_ecriture, compte collate "C") from ecritures_brouillon where dossier_id = '{V}' and date <= '2025-12-31'$q$, '',
      'OD1:108000:validee:Compte personnel du 10/03/2025,OD1:646000:validee:Compte personnel du 10/03/2025,OD2:108000:validee:Compte personnel du 20/12/2025,OD2:646000:validee:Compte personnel du 20/12/2025'],
    array['controle', '75. l''échéance payée en 2025 ne change plus', 'chef', $q$update cotisations_declarees set montant_appele = 801 where id = '{CV1}'$q$,
      '23514', 'L''exercice 2025 est validé : cette échéance ne change plus.'],
    array['controle', '76. l''échéance de 2026 payée en 2025 non plus : c''est la date de son paiement qui la fige', 'chef', $q$update cotisations_declarees set previsionnel = true where id = '{CV2}'$q$,
      '23514', 'L''exercice 2025 est validé : cette échéance ne change plus.'],
    array['controle', '77. l''échéance de 2025 payée en 2026 reste libre de ce que son paiement ne fige pas', 'chef', $q$update cotisations_declarees set previsionnel = true where id = '{CV4}'$q$, 'OK', ''],
    array['controle', '78. mais pas de ses montants', 'chef', $q$update cotisations_declarees set montant_appele = 151 where id = '{CV4}'$q$,
      '23514', 'Cette échéance est payée depuis le compte personnel, le 10/01/2026 : ni ses montants ni son dossier ne changent tant que ce paiement n''est pas retiré.'],
    array['controle', '79. une échéance figée sans paiement ne se déclare pas payée après coup', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{V}', '{CV3}', '2026-01-15', '[{"compte":"646000","sens":"debit","montant":200},{"compte":"108000","sens":"credit","montant":200}]'::jsonb)$q$,
      '23514', 'L''exercice 2025 est validé : cette échéance ne change plus.'],
    array['controle', '79b. une échéance figée se dit avant la date : la fonction la regarde d''abord', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{V}', '{CV3}', null, '[]'::jsonb)$q$,
      '23514', 'L''exercice 2025 est validé : cette échéance ne change plus.'],
    array['controle', '80. un paiement ne se déclare pas dans un exercice validé', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{V}', '{CV5}', '2025-12-28', '[{"compte":"646000","sens":"debit","montant":50},{"compte":"108000","sens":"credit","montant":50}]'::jsonb)$q$,
      '23514', 'L''exercice 2025 est validé : un paiement ne s''y déclare plus.'],
    array['controle', '81. après la frontière, si', 'chef', $q$select enregistrer_paiement_personnel_cotisation('{V}', '{CV5}', '2026-01-02', '[{"compte":"646000","sens":"debit","montant":50},{"compte":"108000","sens":"credit","montant":50}]'::jsonb)$q$, 'OK', ''],
    array['controle', '82. une écriture validée du paiement ne change plus', 'chef', $q$update ecritures_brouillon set montant = 801 where cotisation_id = '{CV1}' and compte = '646000'$q$,
      '23514', 'Cette écriture est validée (exercice 2025) : elle ne se modifie plus.'],
    array['controle', '83. supprimer une échéance payée dans l''exercice validé se refuse', 'chef', $q$select supprimer_echeance_cotisation('{CV2}')$q$,
      '23514', 'L''exercice 2025 est validé : cette échéance ne se supprime plus.'],
    array['controle', '84. la porte de la restauration se ferme dès qu''un exercice est validé', 'chef', $q$insert into cotisations_declarees (dossier_id, echeance, montant_appele, paiement_personnel_le) values ('{V}', '2026-05-05', 10, '2026-05-06')$q$,
      '42501', 'Une échéance ne se déclare payée depuis le compte personnel que par l''application, avec son écriture.'],
    array['controle', '85. sous le réglage de la fonction, une date de paiement dans l''exercice validé y ferait compter l''échéance : refusée', 'postgres', $q$update cotisations_declarees set paiement_personnel_le = '2025-12-28' where id = '{CV5}' and set_config('jd.paiement_personnel', '{CV5}', true) is not null$q$,
      '23514', 'L''exercice 2025 est validé : une échéance ne s''y ajoute plus.'],

    -- ══ 90 à 94. Ce que le catalogue dit, faute de pouvoir le jouer ══════════
    array['valeur', '90. les droits d''exécution (anonyme, connecté)', 'postgres', $q$select string_agg(f || ':' || has_function_privilege('anon', 'public.' || f || a, 'execute') || ':' || has_function_privilege('authenticated', 'public.' || f || a, 'execute'), ',' order by f collate "C") from (values
      ('enregistrer_paiement_personnel_cotisation', '(uuid, uuid, date, jsonb)'), ('garder_paiement_personnel', '()'),
      ('garder_mouvement_paiement_personnel', '()'), ('garder_ecriture_paiement_personnel', '()')) as t(f, a)$q$, '',
      'enregistrer_paiement_personnel_cotisation:false:true,garder_ecriture_paiement_personnel:false:false,garder_mouvement_paiement_personnel:false:false,garder_paiement_personnel:false:false'],
    array['valeur', '91. la fonction et les trois déclencheurs contournent la RLS, chacun avec son propre contrôle', 'postgres', $q$select string_agg(proname || ':' || prosecdef, ',' order by proname collate "C") from pg_proc where pronamespace = 'public'::regnamespace and proname in ('enregistrer_paiement_personnel_cotisation', 'garder_paiement_personnel', 'garder_mouvement_paiement_personnel', 'garder_ecriture_paiement_personnel')$q$, '',
      'enregistrer_paiement_personnel_cotisation:true,garder_ecriture_paiement_personnel:true,garder_mouvement_paiement_personnel:true,garder_paiement_personnel:true'],
    array['valeur', '92. la clé de l''écriture vers l''échéance est en cascade', 'postgres', $q$select string_agg(conname || ':' || confdeltype::text, ',') from pg_constraint where conrelid = 'public.ecritures_brouillon'::regclass and contype = 'f' and confrelid = 'public.cotisations_declarees'::regclass$q$, '',
      'ecritures_brouillon_cotisation_id_fkey:c'],
    array['valeur', '93. les trois déclencheurs, actifs, et ce sur quoi ils veillent', 'postgres', $q$select string_agg(c.relname || ':' || ((t.tgtype & 4) <> 0)::text || ':' || ((t.tgtype & 16) <> 0)::text || ':' || ((t.tgtype & 8) <> 0)::text || ':' || t.tgenabled::text, ',' order by c.relname collate "C") from pg_trigger t join pg_class c on c.oid = t.tgrelid where t.tgname in ('cotisations_declarees_paiement_personnel', 'ecritures_brouillon_paiement_personnel', 'lignes_bancaires_paiement_personnel')$q$, '',
      'cotisations_declarees:true:true:false:O,ecritures_brouillon:true:true:true:O,lignes_bancaires:true:true:false:O'],
    array['valeur', '94. l''écriture se supprime avec son dossier, avec son échéance ou par la fonction du retrait, et sinon jamais', 'postgres', $q$select (prosrc like '%not exists (select 1 from public.dossiers where id = old.dossier_id)%'
      and prosrc like '%not exists (select 1 from public.cotisations_declarees where id = old.cotisation_id)%'
      and prosrc like '%current_setting(''jd.paiement_personnel'', true), '''') = old.cotisation_id::text%')::text from pg_proc where proname = 'garder_ecriture_paiement_personnel'$q$, '', 'true']
  ];

  begin
    foreach etape slice 1 in array etapes loop
      s := etape[4];
      for cle, valeur in select key, value from jsonb_each_text(ids) loop
        s := replace(s, '{' || cle || '}', valeur);
      end loop;
      accepte := false; code_recu := null; message := null; obs := null;
      if etape[1] = 'jeu' then
        begin
          execute s;
        exception when others then
          verdicts := verdicts || jsonb_build_object('controle', '0. le jeu : ' || etape[2], 'observe', sqlstate || ' ' || sqlerrm, 'ok', false);
        end;
      elsif etape[1] = 'valeur' then
        begin
          execute s into obs;
        exception when others then obs := sqlstate || ' ' || sqlerrm;
        end;
        verdicts := verdicts || jsonb_build_object('controle', etape[2], 'observe', coalesce(obs, '∅'), 'ok', coalesce(obs = etape[6], false));
      else
        begin
          if etape[3] = 'service_role' then
            set local role service_role;
          elsif etape[3] <> 'postgres' then
            execute format('set local role %I', case when etape[3] = 'anon' then 'anon' else 'authenticated' end);
            perform set_config('request.jwt.claims', case when etape[3] = 'anon' then json_build_object('role', 'anon')::text
              else json_build_object('sub', case etape[3] when 'chef' then chef when 'client' then client else inconnu end,
                                     'role', 'authenticated')::text end, true);
          end if;
          execute s;
          accepte := true;
          if etape[1] = 'controle' then
            raise exception 'ANNULATION_ESSAI';
          end if;
        exception when others then code_recu := sqlstate; message := sqlerrm;
        end;
        reset role;
        perform set_config('request.jwt.claims', '', true);
        verdicts := verdicts || jsonb_build_object('controle', etape[2],
          'observe', case when accepte then 'accepté' else coalesce(code_recu, '?') || ' ' || coalesce(message, '') end,
          'ok', case when etape[5] = 'OK' then accepte and (etape[1] = 'fait' or coalesce(code_recu = 'P0001', false))
                     else not accepte and coalesce(code_recu = etape[5] and message like etape[6], false) end);
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

  -- ══ 99. Rien n'est resté ══════════
  select string_agg(n::text, '/') into apres from (values
    ((select count(*) from dossiers)), ((select count(*) from cotisations_declarees)), ((select count(*) from ecritures_brouillon)),
    ((select count(*) from lignes_bancaires)), ((select count(*) from a_nouveaux)), ((select count(*) from exercices_valides)),
    ((select count(*) from soldes_reportes)), ((select count(*) from cotisations_declarees where paiement_personnel_le is not null))
  ) as t(n);
  verdicts := verdicts || jsonb_build_object('controle', '99. rien n''est resté en base',
    'observe', avant || ' -> ' || apres,
    'ok', avant = apres and not exists (select 1 from dossiers where nom like 'ESSAI PAIEMENT PERSONNEL%')
      and coalesce(current_setting('jd.paiement_personnel', true), '') = '');

  perform set_config('essai.paiement_personnel', verdicts::text, true);
end $essai$;

-- Un verdict qui n'a pas pu se calculer est une faute, pas un silence. La ligne 0 dit le texte que la base a reçu — par
-- l'outil MCP, qui ajoute sa signature après lui —, pour le comparer au fichier par son empreinte.
select x.controle, x.ok, x.observe from (
  select v.controle, coalesce(v.ok, false) as ok, v.observe
  from jsonb_to_recordset(current_setting('essai.paiement_personnel')::jsonb) as v(controle text, ok boolean, observe text)
  union all
  select '0. information : le texte reçu par la base', true, length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by (regexp_match(x.controle, '^(\d+)'))[1]::int, x.controle;
