-- LE REPORT DES SOLDES D'UN EXERCICE SUR L'AUTRE, ÉPROUVÉ EN BASE — à rejouer par `execute_sql` après toute migration
-- qui touche `soldes_reportes`, `soldes_a_reporter`, `garder_soldes_reportes`, `valider_exercice` ou
-- `empreinte_exercice` (ligne 34 de la feuille de route, décisions du cabinet du 06/10/2026).
--
-- Valider un exercice écrit, dans le même appel, l'ouverture du suivant : ses soldes de fin, datés du 1er janvier
-- suivant, chacun portant l'empreinte de l'exercice dont il vient. Ce qui se prouve ici, et ne se relit pas :
--   - CE QUI SE REPORTE, au centime et sous quel libellé : pour une entreprise individuelle — en trésorerie, ou en
--     engagement quand le compte du dirigeant est le 108 —, le 108, le 101, le 12 et le résultat passent au 101000,
--     « Capital individuel » quand l'exercice ne le nomme pas ; une société garde son résultat en 120 (bénéfice) ou 129
--     (perte), avec son exercice, et un bénéfice qui s'ajoute à un bénéfice encore en attente d'affectation le dit ; tout
--     autre compte se reporte sous son numéro et le libellé que l'exercice lui a figé ; un résultat nul n'ouvre rien ;
--   - CE QUI SE REFUSE, avec sa RAISON, sans rien écrire : un exercice qui se clôt sur le solde d'un compte hors des
--     classes 1 à 7, et des soldes qui ne s'équilibrent pas — une reprise déséquilibrée posée hors de la fonction qui
--     l'aurait refusée ;
--   - L'EXERCICE SUIVANT : il ne se valide pas sans les libellés de son ouverture reportée, qui comptent dans la règle
--     « un compte, un libellé » ; ils se posent alors, une fois, et l'empreinte de l'exercice les couvre — une échelle
--     réécrite ne la change pas, un libellé falsifié hors déclencheur se voit ;
--   - L'INTANGIBILITÉ : personne n'écrit un solde reporté hors de la validation — ni le chef du cabinet, ni le
--     super-administrateur dans un dossier qui a un exercice validé, ni le propriétaire de la base ; personne ne le
--     modifie, même sous le drapeau de la validation au-delà des libellés, ni ne le relibelle une seconde fois ; un
--     chef qui modifie ne touche aucune ligne (aucune policy de modification) ;
--   - LA RESTAURATION : le super-administrateur réinsère des soldes reportés, libellés compris, dans un dossier sans
--     exercice validé, puis l'exercice validé ; ensuite plus rien n'entre, et un compte rattaché à rien ou un client
--     ne restaurent rien ;
--   - QUI LIT : l'anonyme, un compte rattaché à rien et le client — sur SON propre dossier — ne lisent aucun solde
--     reporté ; le chef du cabinet les lit (le contrôle POSITIF) ;
--   - CE QUE LE CATALOGUE DIT : le déclencheur actif sur l'insertion, la modification et la suppression, les
--     policies (lecture, restauration), et les droits d'exécution. La SUPPRESSION ne se joue pas ici — l'outil
--     d'exécution soumet une instruction de suppression à une confirmation — : le refus d'une suppression et le
--     passage de la cascade d'un dossier sont éprouvés sur une réplique locale du schéma, et la condition de la
--     cascade est lue au catalogue par l'essai de la validation (contrôle 141) — plus faible, et annoncé comme tel ;
--   - et que RIEN ne reste en base après l'essai.
--
-- Le harnais est celui de `validationExercice.sql` : des dossiers JETABLES (préfixe `e55b2000`), dans le cabinet du
-- dossier `test` et dans un cabinet jetable, au sein d'un bloc qui s'annule entièrement à la fin
-- (`ANNULATION_ESSAI_GLOBALE`) ; chaque contrôle dans sa propre sous-transaction, annulée (`ANNULATION_ESSAI`, P0001),
-- le verdict posé dans une VARIABLE avant ; les étapes « fait » gardées jusqu'à l'annulation finale. Un refus se juge à
-- son code ET à son message. Hors de l'outil d'exécution, le fichier se joue en UNE transaction (`psql -1`).
--
-- JOUÉ EN PRODUCTION LE 07/10/2026, juste après la migration `report_des_soldes` : 52 contrôles sur 52, et
-- 4/1/1/3/0/0/0 lignes avant comme après (dossiers, cabinets, chefs et membres, écritures, à-nouveaux, exercices
-- validés, soldes reportés). Le texte transmis est identique au fichier sur 390 lignes.
--
-- MIS AU POINT SUR UNE RÉPLIQUE LOCALE, ET MUTÉ AVANT D'ÊTRE CRU. Trente-cinq mutations de la migration, chacune
-- appliquée à une base neuve puis jouée par cet essai, par celui de la validation et par un essai local de la
-- suppression, mordent toutes :
--   - ce qui se reporte : le 108, puis le 12, qui ne passent plus au capital ; l'entreprise individuelle décidée par
--     le seul modèle comptable ; bénéfice et perte inversés ; le cumul de deux résultats jamais dit, puis toujours ;
--     le libellé figé qui ne prime plus ; le capital individuel sans son nom ; le sens inversé ; les soldes nuls
--     reportés ; le résultat compté sur tous les comptes ; l'ouverture datée d'une autre année ; l'empreinte d'une
--     autre source que l'exercice ;
--   - la validation : les libellés des soldes reportés qui ne se posent pas, la couverture qui les oublie, chacun des
--     deux refus retiré, l'empreinte qui les oublie, la clôture qui lit l'ouverture d'un autre exercice, toute la
--     reprise ou les écritures des autres exercices, le compte rendu muet, et l'ouverture écrite hors du drapeau ;
--   - le déclencheur, les policies et la table : le super-administrateur qui insère partout, relibeller à volonté,
--     tout changer sous le drapeau, le drapeau d'un autre dossier qui suffit à modifier ou à insérer, la suppression
--     permise, la cascade refusée, la lecture et la restauration ouvertes, le calcul exécutable par tous, plusieurs
--     lignes par compte, une ouverture à n'importe quelle date.
-- Trois ont d'abord SURVÉCU, et c'est l'essai qu'elles accusaient : insérer sous le drapeau d'un autre dossier,
-- plusieurs lignes par compte et une ouverture à n'importe quelle date — aucun contrôle ne les regardait ; les
-- contrôles 35 à 37 sont nés d'elles. Deux mutations du harnais mordent aussi : sans changement de rôle, cinq
-- contrôles tombent (27, 38, 44 à 46) ; sans l'annulation de chaque contrôle, six (31, 38, 44 à 47). La suppression,
-- jouée sur la réplique : un solde reporté ne se supprime pas, même sous le drapeau de la validation ; un chef qui
-- supprime ne touche aucune ligne ; la suppression du dossier les emporte.
do $essai$
declare
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  inconnu uuid := gen_random_uuid();
  dossier_test uuid := '001c7ed7-c23b-4590-901e-693489f8af24';
  dossier_client uuid; cabinet uuid;
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
     or exists (select 1 from cabinet_admins where user_id = client)
     or not exists (select 1 from super_admins where user_id = chef) then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable';
  end if;

  ids := jsonb_build_object('CAB', cabinet, 'DC', dossier_client, 'CHEF', chef, 'CLIENT', client)
    || jsonb_build_object(
      'I', 'e55b2000-0000-4000-8000-0000000000a1', 'E', 'e55b2000-0000-4000-8000-0000000000a2',
      'S', 'e55b2000-0000-4000-8000-0000000000a3', 'L', 'e55b2000-0000-4000-8000-0000000000a4',
      'K', 'e55b2000-0000-4000-8000-0000000000a5', 'Z', 'e55b2000-0000-4000-8000-0000000000a6',
      'U', 'e55b2000-0000-4000-8000-0000000000a7', 'R', 'e55b2000-0000-4000-8000-0000000000a8',
      'CJ', 'e55b2000-0000-4000-8000-0000000000c1', 'J1', 'e55b2000-0000-4000-8000-0000000000c2')
    || jsonb_build_object(
      'IAN1', 'e55b2000-0000-4000-8008-000000000001', 'IAN2', 'e55b2000-0000-4000-8008-000000000002',
      'IAN3', 'e55b2000-0000-4000-8008-000000000003', 'UAN1', 'e55b2000-0000-4000-8008-000000000011',
      'UAN2', 'e55b2000-0000-4000-8008-000000000012', 'RS1', 'e55b2000-0000-4000-8009-000000000001',
      'RS2', 'e55b2000-0000-4000-8009-000000000002', 'DCS', 'e55b2000-0000-4000-8009-000000000011')
    || jsonb_build_object(
      'I1', 'e55b2000-0000-4000-8003-000000000001', 'I2', 'e55b2000-0000-4000-8003-000000000002',
      'I3', 'e55b2000-0000-4000-8003-000000000003', 'I4', 'e55b2000-0000-4000-8003-000000000004',
      'I5', 'e55b2000-0000-4000-8003-000000000005', 'I6', 'e55b2000-0000-4000-8003-000000000006',
      'I7', 'e55b2000-0000-4000-8003-000000000007', 'I8', 'e55b2000-0000-4000-8003-000000000008',
      'E1', 'e55b2000-0000-4000-8003-000000000011', 'E2', 'e55b2000-0000-4000-8003-000000000012',
      'E3', 'e55b2000-0000-4000-8003-000000000013', 'E4', 'e55b2000-0000-4000-8003-000000000014',
      'E5', 'e55b2000-0000-4000-8003-000000000015', 'E6', 'e55b2000-0000-4000-8003-000000000016')
    || jsonb_build_object(
      'S1', 'e55b2000-0000-4000-8003-000000000021', 'S2', 'e55b2000-0000-4000-8003-000000000022',
      'S3', 'e55b2000-0000-4000-8003-000000000023', 'S4', 'e55b2000-0000-4000-8003-000000000024',
      'S5', 'e55b2000-0000-4000-8003-000000000025', 'S6', 'e55b2000-0000-4000-8003-000000000026',
      'S7', 'e55b2000-0000-4000-8003-000000000027', 'S8', 'e55b2000-0000-4000-8003-000000000028',
      'S9', 'e55b2000-0000-4000-8003-000000000029', 'S10', 'e55b2000-0000-4000-8003-00000000002a',
      'L1', 'e55b2000-0000-4000-8003-000000000031', 'L2', 'e55b2000-0000-4000-8003-000000000032',
      'L3', 'e55b2000-0000-4000-8003-000000000033', 'L4', 'e55b2000-0000-4000-8003-000000000034')
    || jsonb_build_object(
      'K1', 'e55b2000-0000-4000-8003-000000000041', 'K2', 'e55b2000-0000-4000-8003-000000000042',
      'K3', 'e55b2000-0000-4000-8003-000000000043', 'K4', 'e55b2000-0000-4000-8003-000000000044',
      'Z1', 'e55b2000-0000-4000-8003-000000000051', 'Z2', 'e55b2000-0000-4000-8003-000000000052',
      'Z3', 'e55b2000-0000-4000-8003-000000000053', 'Z4', 'e55b2000-0000-4000-8003-000000000054');

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from cabinets)), ((select count(*) from cabinet_admins)),
    ((select count(*) from ecritures_brouillon)), ((select count(*) from a_nouveaux)),
    ((select count(*) from exercices_valides)), ((select count(*) from soldes_reportes))
  ) as t(n);

  -- Une étape : {genre, contrôle, qui, requête, code attendu, message attendu (motif LIKE) ou valeur attendue} — les
  -- genres de `validationExercice.sql` : « jeu » (posé par le propriétaire, gardé), « controle » (joué sous « qui »
  -- puis annulé ; « OK » attend qu'il passe), « fait » (joué sous « qui » et gardé), « valeur » (une lecture qui doit
  -- rendre exactement la valeur attendue).
  etapes := array[
    -- ══ Le jeu ══════════════════════════════════════════════════════════════════════════════════════════════════
    -- I : entreprise individuelle en trésorerie, reprise au 1er janvier 2024 avec un bénéfice de 2023 en attente.
    -- E : entreprise individuelle en engagement (compte du dirigeant : 108). S et L : sociétés en engagement. K : un
    -- exercice sans résultat ni solde. Z : un compte de classe 8 qui garde un solde. U : une reprise déséquilibrée,
    -- posée hors de la fonction qui l'aurait refusée. R : la restauration.
    array['jeu', 'dossiers jetables', 'postgres', $q$insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values
      ('{I}', 'ESSAI REPORT I', '{CAB}', 'tresorerie', '455000'), ('{E}', 'ESSAI REPORT E', '{CAB}', 'engagement', '108000'),
      ('{S}', 'ESSAI REPORT S', '{CAB}', 'engagement', '455000'), ('{L}', 'ESSAI REPORT L', '{CAB}', 'engagement', '467000'),
      ('{K}', 'ESSAI REPORT K', '{CAB}', 'tresorerie', '455000'), ('{Z}', 'ESSAI REPORT Z', '{CAB}', 'tresorerie', '455000'),
      ('{U}', 'ESSAI REPORT U', '{CAB}', 'tresorerie', '455000'), ('{R}', 'ESSAI REPORT R', '{CAB}', 'tresorerie', '455000')$q$, '', ''],
    array['jeu', 'cabinet jetable et son dossier', 'postgres', $q$insert into cabinets (id, nom) values ('{CJ}', 'ESSAI REPORT CABINET')$q$, '', ''],
    array['jeu', '', 'postgres', $q$insert into dossiers (id, nom, cabinet_id) values ('{J1}', 'ESSAI REPORT J1', '{CJ}')$q$, '', ''],
    array['jeu', 'le client devient chef du cabinet jetable, sans être super-administrateur', 'postgres', $q$insert into cabinet_admins (user_id, cabinet_id, role) values ('{CLIENT}', '{CJ}', 'comptable_en_chef')$q$, '', ''],
    array['jeu', 'la reprise de I', 'postgres', $q$insert into a_nouveaux (id, dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte) values
      ('{IAN1}', '{I}', '2024-01-01', '512000', 'Banque Populaire', 'debit', 1000, 'balance-essai-i.csv', repeat('a', 64)),
      ('{IAN2}', '{I}', '2024-01-01', '120000', 'Résultat de l’exercice 2023 (bénéfice), en attente d’affectation', 'credit', 300, 'balance-essai-i.csv', repeat('a', 64)),
      ('{IAN3}', '{I}', '2024-01-01', '101000', 'Capital', 'credit', 700, 'balance-essai-i.csv', repeat('a', 64))$q$, '', ''],
    array['jeu', 'écritures de I', 'postgres', $q$insert into ecritures_brouillon (id, dossier_id, date, compte, libelle, montant, sens) values
      ('{I1}', '{I}', '2024-02-01', '706000', 'ESSAI HONORAIRES', 500, 'credit'), ('{I2}', '{I}', '2024-02-01', '512000', 'ESSAI HONORAIRES', 500, 'debit'),
      ('{I3}', '{I}', '2024-03-01', '108000', 'ESSAI PRÉLÈVEMENT', 200, 'debit'), ('{I4}', '{I}', '2024-03-01', '512000', 'ESSAI PRÉLÈVEMENT', 200, 'credit'),
      ('{I5}', '{I}', '2024-04-01', '606100', 'ESSAI ACHAT', 100, 'debit'), ('{I6}', '{I}', '2024-04-01', '512000', 'ESSAI ACHAT', 100, 'credit'),
      ('{I7}', '{I}', '2025-05-01', '606100', 'ESSAI ACHAT 2025', 40, 'debit'), ('{I8}', '{I}', '2025-05-01', '512000', 'ESSAI ACHAT 2025', 40, 'credit')$q$, '', ''],
    array['jeu', 'écritures de E', 'postgres', $q$insert into ecritures_brouillon (id, dossier_id, date, compte, libelle, montant, sens) values
      ('{E1}', '{E}', '2024-02-01', '606100', 'ESSAI FACTURE', 120, 'debit'), ('{E2}', '{E}', '2024-02-01', '401000', 'ESSAI FACTURE', 120, 'credit'),
      ('{E3}', '{E}', '2024-03-01', '401000', 'ESSAI RÈGLEMENT', 50, 'debit'), ('{E4}', '{E}', '2024-03-01', '512000', 'ESSAI RÈGLEMENT', 50, 'credit'),
      ('{E5}', '{E}', '2024-04-01', '625100', 'ESSAI NOTE DE FRAIS', 30, 'debit'), ('{E6}', '{E}', '2024-04-01', '108000', 'ESSAI NOTE DE FRAIS', 30, 'credit')$q$, '', ''],
    array['jeu', 'écritures de S', 'postgres', $q$insert into ecritures_brouillon (id, dossier_id, date, compte, libelle, montant, sens) values
      ('{S1}', '{S}', '2024-02-01', '411000', 'ESSAI VENTE', 1000, 'debit'), ('{S2}', '{S}', '2024-02-01', '706000', 'ESSAI VENTE', 1000, 'credit'),
      ('{S3}', '{S}', '2024-03-01', '512000', 'ESSAI ENCAISSEMENT', 1000, 'debit'), ('{S4}', '{S}', '2024-03-01', '411000', 'ESSAI ENCAISSEMENT', 1000, 'credit'),
      ('{S5}', '{S}', '2024-04-01', '606100', 'ESSAI ACHAT', 400, 'debit'), ('{S6}', '{S}', '2024-04-01', '512000', 'ESSAI ACHAT', 400, 'credit'),
      ('{S7}', '{S}', '2024-05-01', '625100', 'ESSAI NOTE DE FRAIS', 60, 'debit'), ('{S8}', '{S}', '2024-05-01', '455000', 'ESSAI NOTE DE FRAIS', 60, 'credit'),
      ('{S9}', '{S}', '2025-02-01', '512000', 'ESSAI VENTE 2025', 200, 'debit'), ('{S10}', '{S}', '2025-02-01', '706000', 'ESSAI VENTE 2025', 200, 'credit')$q$, '', ''],
    array['jeu', 'écritures de L', 'postgres', $q$insert into ecritures_brouillon (id, dossier_id, date, compte, libelle, montant, sens) values
      ('{L1}', '{L}', '2024-02-01', '606100', 'ESSAI ACHAT', 300, 'debit'), ('{L2}', '{L}', '2024-02-01', '512000', 'ESSAI ACHAT', 300, 'credit'),
      ('{L3}', '{L}', '2025-02-01', '512000', 'ESSAI VENTE', 500, 'debit'), ('{L4}', '{L}', '2025-02-01', '706000', 'ESSAI VENTE', 500, 'credit')$q$, '', ''],
    array['jeu', 'écritures de K', 'postgres', $q$insert into ecritures_brouillon (id, dossier_id, date, compte, libelle, montant, sens) values
      ('{K1}', '{K}', '2024-02-01', '706000', 'ESSAI RECETTE', 100, 'credit'), ('{K2}', '{K}', '2024-02-01', '512000', 'ESSAI RECETTE', 100, 'debit'),
      ('{K3}', '{K}', '2024-03-01', '606100', 'ESSAI ACHAT', 100, 'debit'), ('{K4}', '{K}', '2024-03-01', '512000', 'ESSAI ACHAT', 100, 'credit')$q$, '', ''],
    array['jeu', 'écritures de Z, deux comptes hors des classes 1 à 7', 'postgres', $q$insert into ecritures_brouillon (id, dossier_id, date, compte, libelle, montant, sens) values
      ('{Z1}', '{Z}', '2024-02-01', '801000', 'ESSAI HORS BILAN', 10, 'debit'), ('{Z2}', '{Z}', '2024-02-01', '512000', 'ESSAI HORS BILAN', 10, 'credit'),
      ('{Z3}', '{Z}', '2024-03-01', '901000', 'ESSAI ANALYTIQUE', 4, 'debit'), ('{Z4}', '{Z}', '2024-03-01', '512000', 'ESSAI ANALYTIQUE', 4, 'credit')$q$, '', ''],
    array['jeu', 'la reprise déséquilibrée de U', 'postgres', $q$insert into a_nouveaux (id, dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte) values
      ('{UAN1}', '{U}', '2024-01-01', '512000', 'Banque', 'debit', 100, 'balance-essai-u.csv', repeat('b', 64)),
      ('{UAN2}', '{U}', '2024-01-01', '101000', 'Capital', 'credit', 90, 'balance-essai-u.csv', repeat('b', 64))$q$, '', ''],

    -- ══ Une entreprise individuelle en trésorerie (I) ═══════════════════════════════════════════════════════════════
    -- Fin 2024 : la banque à 1 000 + 500 − 200 − 100 ; le capital repris (700), le bénéfice repris de 2023 (300), le 108
    -- (200 prélevés) et le bénéfice de 2024 (400) au capital individuel, sous le libellé que 2024 lui a figé.
    array['fait', '1. le chef valide 2024, et la validation dit qu''elle reporte deux soldes', 'chef', $q$do $x$ declare r jsonb; begin
      r := valider_exercice('{I}', 2024, '[
        {"id":"{I1}","journal":"BQ","numero":1,"piece_ref":"Relevé essai","piece_date":"2024-02-01","compte_lib":"Honoraires"},
        {"id":"{I2}","journal":"BQ","numero":1,"piece_ref":"Relevé essai","piece_date":"2024-02-01","compte_lib":"Banque"},
        {"id":"{I3}","journal":"BQ","numero":2,"piece_ref":"Relevé essai","piece_date":"2024-03-01","compte_lib":"Compte de l''exploitant"},
        {"id":"{I4}","journal":"BQ","numero":2,"piece_ref":"Relevé essai","piece_date":"2024-03-01","compte_lib":"Banque"},
        {"id":"{I5}","journal":"BQ","numero":3,"piece_ref":"Relevé essai","piece_date":"2024-04-01","compte_lib":"Achats"},
        {"id":"{I6}","journal":"BQ","numero":3,"piece_ref":"Relevé essai","piece_date":"2024-04-01","compte_lib":"Banque"}]'::jsonb,
        '[{"id":"{IAN1}","compte_lib":"Banque","ecriture_lib":"À-nouveau Banque Populaire"},
          {"id":"{IAN2}","compte_lib":"Résultat de l’exercice 2023 (bénéfice), en attente d’affectation","ecriture_lib":"À-nouveau Résultat de l’exercice 2023"},
          {"id":"{IAN3}","compte_lib":"Capital","ecriture_lib":"À-nouveau Capital"}]'::jsonb, '{"essai":"I"}'::jsonb);
      if r->>'reportes' is distinct from '2' then raise exception 'REPORTES %', r->>'reportes'; end if;
    end $x$$q$, 'OK', ''],
    array['valeur', '2. 2025 s''ouvre sur le capital individuel et la banque, sans libellé de compte encore', 'postgres', $q$select string_agg(compte || ':' || sens || ':' || montant || ':' || libelle, ',' order by compte collate "C") || '/' || min(date) || '/' || min(source_nom) || '/' || bool_and(source_empreinte = (select empreinte from exercices_valides where dossier_id = '{I}' and annee = 2024)) || '/' || count(compte_lib) from soldes_reportes where dossier_id = '{I}'$q$, '',
      '101000:credit:1200.00:Capital,512000:debit:1200.00:Banque/2025-01-01/Exercice 2024 validé/true/0'],
    array['valeur', '3. ni le 108, ni le résultat, ni une charge ou un produit ne se reportent', 'postgres', $q$select count(*) from soldes_reportes where dossier_id = '{I}' and compte !~ '^(101000|512000)$'$q$, '', '0'],
    array['controle', '4. 2025 ne se valide pas sans les libellés de son ouverture', 'chef', $q$select valider_exercice('{I}', 2025, '[{"id":"{I7}","journal":"BQ","numero":1,"piece_ref":"Relevé essai","piece_date":"2025-05-01","compte_lib":"Achats"},{"id":"{I8}","journal":"BQ","numero":1,"piece_ref":"Relevé essai","piece_date":"2025-05-01","compte_lib":"Banque"}]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'Les libellés proposés ne couvrent pas exactement les 2 à-nouveaux de l''exercice 2025.'],
    array['controle', '5. ni en nommant la banque de son ouverture autrement que ses écritures', 'chef', $q$select valider_exercice('{I}', 2025, '[{"id":"{I7}","journal":"BQ","numero":1,"piece_ref":"Relevé essai","piece_date":"2025-05-01","compte_lib":"Achats"},{"id":"{I8}","journal":"BQ","numero":1,"piece_ref":"Relevé essai","piece_date":"2025-05-01","compte_lib":"Banque"}]'::jsonb, (select jsonb_agg(jsonb_build_object('id', id, 'compte_lib', libelle || ' reportée', 'ecriture_lib', 'À-nouveau ' || libelle)) from soldes_reportes where dossier_id = '{I}'), '{}'::jsonb)$q$, '22023', 'Un même compte porte deux libellés.'],
    array['fait', '6. avec ses libellés, le chef valide 2025', 'chef', $q$select valider_exercice('{I}', 2025, '[{"id":"{I7}","journal":"BQ","numero":1,"piece_ref":"Relevé essai","piece_date":"2025-05-01","compte_lib":"Achats"},{"id":"{I8}","journal":"BQ","numero":1,"piece_ref":"Relevé essai","piece_date":"2025-05-01","compte_lib":"Banque"}]'::jsonb, (select jsonb_agg(jsonb_build_object('id', id, 'compte_lib', libelle, 'ecriture_lib', 'À-nouveau ' || libelle)) from soldes_reportes where dossier_id = '{I}' and date = '2025-01-01'), '{}'::jsonb)$q$, 'OK', ''],
    array['valeur', '7. l''ouverture de 2025 porte ses libellés, et 2026 s''ouvre sur 2025', 'postgres', $q$select (select string_agg(compte || ':' || compte_lib || ':' || ecriture_lib, ',' order by compte collate "C") from soldes_reportes where dossier_id = '{I}' and date = '2025-01-01') || '/' || string_agg(compte || ':' || sens || ':' || montant || ':' || libelle, ',' order by compte collate "C") || '/' || bool_and(source_empreinte = (select empreinte from exercices_valides where dossier_id = '{I}' and annee = 2025)) from soldes_reportes where dossier_id = '{I}' and date = '2026-01-01'$q$, '',
      '101000:Capital:À-nouveau Capital,512000:Banque:À-nouveau Banque/101000:credit:1160.00:Capital,512000:debit:1160.00:Banque/true'],
    array['valeur', '8. 2025 se vérifie, son ouverture comprise', 'postgres', $q$select verifier_exercice_valide('{I}', 2025)::text$q$, '', 'true'],
    array['jeu', 'falsifier le libellé d''un solde reporté hors déclencheur', 'postgres', $q$set local session_replication_role = replica$q$, '', ''],
    array['jeu', '', 'postgres', $q$update soldes_reportes set ecriture_lib = 'falsifié' where dossier_id = '{I}' and date = '2025-01-01' and compte = '512000'$q$, '', ''],
    array['jeu', '', 'postgres', $q$set local session_replication_role = origin$q$, '', ''],
    array['valeur', '9. un solde reporté falsifié se voit sur l''exercice qu''il ouvre', 'postgres', $q$select verifier_exercice_valide('{I}', 2025)::text || '/' || verifier_exercice_valide('{I}', 2024)::text$q$, '', 'false/true'],
    array['jeu', 'rétablir le libellé', 'postgres', $q$set local session_replication_role = replica$q$, '', ''],
    array['jeu', '', 'postgres', $q$update soldes_reportes set ecriture_lib = 'À-nouveau Banque' where dossier_id = '{I}' and date = '2025-01-01' and compte = '512000'$q$, '', ''],
    array['jeu', '', 'postgres', $q$set local session_replication_role = origin$q$, '', ''],
    array['valeur', '10. rétabli, il se relit', 'postgres', $q$select verifier_exercice_valide('{I}', 2025)::text$q$, '', 'true'],

    -- ══ Une entreprise individuelle en engagement (E), sans reprise ════════════════════════════════════════════════
    -- Fin 2024 : le fournisseur (120 − 50) et la banque sous leur libellé ; la note de frais du dirigeant (108) et la
    -- perte (120 + 30) au 101000, que 2024 ne nomme pas.
    array['fait', '11. le chef valide 2024 de E', 'chef', $q$select valider_exercice('{E}', 2024, '[
      {"id":"{E1}","journal":"AC","numero":1,"piece_ref":"essai-e1.pdf","piece_date":"2024-02-01","compte_lib":"Achats"},
      {"id":"{E2}","journal":"AC","numero":1,"piece_ref":"essai-e1.pdf","piece_date":"2024-02-01","compte_lib":"Fournisseurs"},
      {"id":"{E3}","journal":"BQ","numero":1,"piece_ref":"essai-e1.pdf","piece_date":"2024-02-01","compte_lib":"Fournisseurs"},
      {"id":"{E4}","journal":"BQ","numero":1,"piece_ref":"essai-e1.pdf","piece_date":"2024-02-01","compte_lib":"Banque"},
      {"id":"{E5}","journal":"AC","numero":2,"piece_ref":"essai-e2.pdf","piece_date":"2024-04-01","compte_lib":"Déplacements"},
      {"id":"{E6}","journal":"AC","numero":2,"piece_ref":"essai-e2.pdf","piece_date":"2024-04-01","compte_lib":"Compte de l''exploitant"}]'::jsonb, '[]'::jsonb, null)$q$, 'OK', ''],
    array['valeur', '12. le 108 et la perte passent au capital individuel', 'postgres', $q$select string_agg(compte || ':' || sens || ':' || montant || ':' || libelle, ',' order by compte collate "C") from soldes_reportes where dossier_id = '{E}'$q$, '',
      '101000:debit:120.00:Capital individuel,401000:credit:70.00:Fournisseurs,512000:credit:50.00:Banque'],

    -- ══ Une société (S) : le résultat en attente d'affectation ═════════════════════════════════════════════════════
    -- Fin 2024 : la banque (1 000 − 400), le compte courant du dirigeant (455), le client soldé ; le bénéfice de 2024 (540)
    -- au 120000, avec son exercice. Fin 2025 : un bénéfice de 200 s'y ajoute, encore en attente, et le libellé le dit.
    array['fait', '13. le chef valide 2024 de S', 'chef', $q$select valider_exercice('{S}', 2024, '[
      {"id":"{S1}","journal":"VE","numero":1,"piece_ref":"essai-s1.pdf","piece_date":"2024-02-01","compte_lib":"Clients"},
      {"id":"{S2}","journal":"VE","numero":1,"piece_ref":"essai-s1.pdf","piece_date":"2024-02-01","compte_lib":"Ventes"},
      {"id":"{S3}","journal":"BQ","numero":1,"piece_ref":"essai-s1.pdf","piece_date":"2024-02-01","compte_lib":"Banque"},
      {"id":"{S4}","journal":"BQ","numero":1,"piece_ref":"essai-s1.pdf","piece_date":"2024-02-01","compte_lib":"Clients"},
      {"id":"{S5}","journal":"BQ","numero":2,"piece_ref":"Relevé essai","piece_date":"2024-04-01","compte_lib":"Achats"},
      {"id":"{S6}","journal":"BQ","numero":2,"piece_ref":"Relevé essai","piece_date":"2024-04-01","compte_lib":"Banque"},
      {"id":"{S7}","journal":"AC","numero":1,"piece_ref":"essai-s2.pdf","piece_date":"2024-05-01","compte_lib":"Déplacements"},
      {"id":"{S8}","journal":"AC","numero":1,"piece_ref":"essai-s2.pdf","piece_date":"2024-05-01","compte_lib":"Associés — comptes courants"}]'::jsonb, '[]'::jsonb, null)$q$, 'OK', ''],
    array['valeur', '14. le bénéfice de 2024 attend son affectation au 120000', 'postgres', $q$select string_agg(compte || ':' || sens || ':' || montant || ':' || libelle, ',' order by compte collate "C") from soldes_reportes where dossier_id = '{S}'$q$, '',
      '120000:credit:540.00:Résultat de l’exercice 2024 (bénéfice), en attente d’affectation,455000:credit:60.00:Associés — comptes courants,512000:debit:600.00:Banque'],
    array['fait', '15. puis 2025', 'chef', $q$select valider_exercice('{S}', 2025, '[{"id":"{S9}","journal":"BQ","numero":1,"piece_ref":"Relevé essai","piece_date":"2025-02-01","compte_lib":"Banque"},{"id":"{S10}","journal":"BQ","numero":1,"piece_ref":"Relevé essai","piece_date":"2025-02-01","compte_lib":"Ventes"}]'::jsonb, (select jsonb_agg(jsonb_build_object('id', id, 'compte_lib', libelle, 'ecriture_lib', 'À-nouveau ' || libelle)) from soldes_reportes where dossier_id = '{S}' and date = '2025-01-01'), null)$q$, 'OK', ''],
    array['valeur', '16. deux bénéfices en attente d''affectation se cumulent, et le libellé le dit', 'postgres', $q$select string_agg(compte || ':' || sens || ':' || montant || ':' || libelle, ',' order by compte collate "C") from soldes_reportes where dossier_id = '{S}' and date = '2026-01-01'$q$, '',
      '120000:credit:740.00:Résultats en attente d’affectation,455000:credit:60.00:Associés — comptes courants,512000:debit:800.00:Banque'],

    -- ══ Une société (L) : une perte, puis un bénéfice ══════════════════════════════════════════════════════════════
    array['fait', '17. le chef valide 2024 de L', 'chef', $q$select valider_exercice('{L}', 2024, '[{"id":"{L1}","journal":"BQ","numero":1,"piece_ref":"Relevé essai","piece_date":"2024-02-01","compte_lib":"Achats"},{"id":"{L2}","journal":"BQ","numero":1,"piece_ref":"Relevé essai","piece_date":"2024-02-01","compte_lib":"Banque"}]'::jsonb, '[]'::jsonb, null)$q$, 'OK', ''],
    array['fait', '18. puis 2025', 'chef', $q$select valider_exercice('{L}', 2025, '[{"id":"{L3}","journal":"BQ","numero":1,"piece_ref":"Relevé essai","piece_date":"2025-02-01","compte_lib":"Banque"},{"id":"{L4}","journal":"BQ","numero":1,"piece_ref":"Relevé essai","piece_date":"2025-02-01","compte_lib":"Ventes"}]'::jsonb, (select jsonb_agg(jsonb_build_object('id', id, 'compte_lib', libelle, 'ecriture_lib', 'À-nouveau ' || libelle)) from soldes_reportes where dossier_id = '{L}' and date = '2025-01-01'), null)$q$, 'OK', ''],
    array['valeur', '19. la perte de 2024 au 129000 ; le bénéfice de 2025 au 120000 ; la perte reportée garde son libellé', 'postgres', $q$select string_agg(to_char(date, 'YYYY') || ':' || compte || ':' || sens || ':' || montant || ':' || libelle, ',' order by date, compte collate "C") from soldes_reportes where dossier_id = '{L}'$q$, '',
      '2025:129000:debit:300.00:Résultat de l’exercice 2024 (perte), en attente d’affectation,2025:512000:credit:300.00:Banque,2026:120000:credit:500.00:Résultat de l’exercice 2025 (bénéfice), en attente d’affectation,2026:129000:debit:300.00:Résultat de l’exercice 2024 (perte), en attente d’affectation,2026:512000:debit:200.00:Banque'],

    -- ══ Un exercice sans solde (K) ═══════════════════════════════════════════════════════════════════════════════════
    array['fait', '20. un exercice qui se clôt sans solde n''ouvre rien, et la validation le dit', 'chef', $q$do $x$ declare r jsonb; begin
      r := valider_exercice('{K}', 2024, '[
        {"id":"{K1}","journal":"BQ","numero":1,"piece_ref":"Relevé essai","piece_date":"2024-02-01","compte_lib":"Honoraires"},
        {"id":"{K2}","journal":"BQ","numero":1,"piece_ref":"Relevé essai","piece_date":"2024-02-01","compte_lib":"Banque"},
        {"id":"{K3}","journal":"BQ","numero":2,"piece_ref":"Relevé essai","piece_date":"2024-03-01","compte_lib":"Achats"},
        {"id":"{K4}","journal":"BQ","numero":2,"piece_ref":"Relevé essai","piece_date":"2024-03-01","compte_lib":"Banque"}]'::jsonb, '[]'::jsonb, '{}'::jsonb);
      if r->>'reportes' is distinct from '0' then raise exception 'REPORTES %', r->>'reportes'; end if;
    end $x$$q$, 'OK', ''],
    array['valeur', '21. rien n''est reporté', 'postgres', $q$select count(*) from soldes_reportes where dossier_id = '{K}'$q$, '', '0'],
    array['fait', '22. et 2025 se valide sans libellé d''ouverture', 'chef', $q$select valider_exercice('{K}', 2025, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, 'OK', ''],

    -- ══ Ce qui se refuse ══════════════════════════════════════════════════════════════════════════════════════════
    array['controle', '23. un exercice qui se clôt sur le solde de comptes ni de bilan ni de résultat', 'chef', $q$select valider_exercice('{Z}', 2024, '[
      {"id":"{Z1}","journal":"BQ","numero":1,"piece_ref":"Relevé essai","piece_date":"2024-02-01","compte_lib":"Hors bilan"},
      {"id":"{Z2}","journal":"BQ","numero":1,"piece_ref":"Relevé essai","piece_date":"2024-02-01","compte_lib":"Banque"},
      {"id":"{Z3}","journal":"BQ","numero":2,"piece_ref":"Relevé essai","piece_date":"2024-03-01","compte_lib":"Analytique"},
      {"id":"{Z4}","journal":"BQ","numero":2,"piece_ref":"Relevé essai","piece_date":"2024-03-01","compte_lib":"Banque"}]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '23514', 'L''exercice 2024 se clôt sur le solde de comptes qui ne sont ni de bilan ni de résultat (801000, 901000) : il ne se reporte pas, corriger leurs écritures avant la validation.'],
    array['controle', '24. des soldes qui ne s''équilibrent pas, à-nouveaux compris', 'chef', $q$select valider_exercice('{U}', 2024, '[]'::jsonb, '[{"id":"{UAN1}","compte_lib":"Banque","ecriture_lib":"À-nouveau Banque"},{"id":"{UAN2}","compte_lib":"Capital","ecriture_lib":"À-nouveau Capital"}]'::jsonb, '{}'::jsonb)$q$, '23514', 'Les soldes de l''exercice 2024 ne s''équilibrent pas, à-nouveaux compris : l''ouverture de l''exercice suivant ne peut pas s''écrire.'],
    array['valeur', '25. un refus n''écrit rien : ni exercice validé, ni écriture validée, ni solde reporté', 'postgres', $q$select (select count(*) from exercices_valides where dossier_id in ('{Z}', '{U}')) || '/' || (select count(*) from ecritures_brouillon where dossier_id = '{Z}' and statut = 'validee') || '/' || (select count(*) from soldes_reportes where dossier_id in ('{Z}', '{U}')) || '/' || (select count(compte_lib) from a_nouveaux where dossier_id = '{U}')$q$, '', '0/0/0/0'],

    -- ══ L'intangibilité ══════════════════════════════════════════════════════════════════════════════════════════
    array['controle', '26. le chef n''écrit pas de solde reporté, même super-administrateur, dans un dossier qui a un exercice validé', 'chef', $q$insert into soldes_reportes (dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte) values ('{I}', '2027-01-01', '512000', 'Banque', 'debit', 1, 'x', repeat('0', 64))$q$, '42501', 'Les soldes reportés ne s''écrivent qu''à la validation d''un exercice.'],
    -- Le déclencheur refuse avant la policy ; pour voir la policy, le drapeau de la validation est posé à la main — ce que
    -- l'interface de programmation n'offre à personne.
    array['controle', '27. ni un chef de cabinet qui n''est pas super-administrateur : la policy refuse, même sous le drapeau', 'client', $q$do $x$ begin
      perform set_config('jd.validation_exercice', '{J1}', true);
      insert into soldes_reportes (dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte) values ('{J1}', '2025-01-01', '512000', 'Banque', 'debit', 1, 'x', repeat('0', 64));
    end $x$$q$, '42501', 'new row violates row-level security policy%'],
    array['controle', '28. ni le propriétaire de la base', 'postgres', $q$insert into soldes_reportes (dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte) values ('{K}', '2027-01-01', '512000', 'Banque', 'debit', 1, 'x', repeat('0', 64))$q$, '42501', 'Les soldes reportés ne s''écrivent qu''à la validation d''un exercice.'],
    array['controle', '29. un solde reporté ne change plus', 'postgres', $q$update soldes_reportes set montant = 1 where dossier_id = '{I}' and date = '2026-01-01' and compte = '512000'$q$, '23514', 'Les soldes reportés d''un exercice validé ne changent plus.'],
    array['controle', '30. ni par une sauvegarde sans changement', 'postgres', $q$update soldes_reportes set libelle = libelle where dossier_id = '{I}' and date = '2026-01-01' and compte = '512000'$q$, '23514', 'Les soldes reportés d''un exercice validé ne changent plus.'],
    array['controle', '31. sous le drapeau de la validation, ses libellés se posent une fois', 'postgres', $q$do $x$ begin
      perform set_config('jd.validation_exercice', '{I}', true);
      update soldes_reportes set compte_lib = 'Banque', ecriture_lib = 'À-nouveau Banque' where dossier_id = '{I}' and date = '2026-01-01' and compte = '512000';
    end $x$$q$, 'OK', ''],
    array['controle', '32. mais rien d''autre', 'postgres', $q$do $x$ begin
      perform set_config('jd.validation_exercice', '{I}', true);
      update soldes_reportes set compte_lib = 'Banque', ecriture_lib = 'À-nouveau Banque', montant = 1 where dossier_id = '{I}' and date = '2026-01-01' and compte = '512000';
    end $x$$q$, '23514', 'Les soldes reportés d''un exercice validé ne changent plus.'],
    array['controle', '33. ni une seconde fois', 'postgres', $q$do $x$ begin
      perform set_config('jd.validation_exercice', '{I}', true);
      update soldes_reportes set compte_lib = 'Autre', ecriture_lib = 'À-nouveau Autre' where dossier_id = '{I}' and date = '2025-01-01' and compte = '512000';
    end $x$$q$, '23514', 'Les soldes reportés d''un exercice validé ne changent plus.'],
    array['controle', '34. ni sous le drapeau d''un autre dossier', 'postgres', $q$do $x$ begin
      perform set_config('jd.validation_exercice', '{E}', true);
      update soldes_reportes set compte_lib = 'Banque', ecriture_lib = 'À-nouveau Banque' where dossier_id = '{I}' and date = '2026-01-01' and compte = '512000';
    end $x$$q$, '23514', 'Les soldes reportés d''un exercice validé ne changent plus.'],
    array['controle', '35. ni insérer sous le drapeau d''un autre dossier', 'postgres', $q$do $x$ begin
      perform set_config('jd.validation_exercice', '{E}', true);
      insert into soldes_reportes (dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte) values ('{I}', '2027-01-01', '512000', 'Banque', 'debit', 1, 'x', repeat('0', 64));
    end $x$$q$, '42501', 'Les soldes reportés ne s''écrivent qu''à la validation d''un exercice.'],
    array['controle', '36. une ouverture porte une ligne par compte', 'postgres', $q$do $x$ begin
      perform set_config('jd.validation_exercice', '{I}', true);
      insert into soldes_reportes (dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte) values ('{I}', '2025-01-01', '512000', 'Banque', 'debit', 1, 'x', repeat('0', 64));
    end $x$$q$, '23505', 'duplicate key value violates unique constraint "soldes_reportes_un_par_compte"%'],
    array['controle', '37. et tombe un 1er janvier', 'postgres', $q$do $x$ begin
      perform set_config('jd.validation_exercice', '{I}', true);
      insert into soldes_reportes (dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte) values ('{I}', '2025-06-30', '445660', 'TVA', 'debit', 1, 'x', repeat('0', 64));
    end $x$$q$, '23514', 'new row for relation "soldes_reportes" violates check constraint "soldes_reportes_ouverture"%'],
    array['controle', '38. le chef qui modifie ne touche aucune ligne : aucune policy ne le lui ouvre', 'chef', $q$do $x$ declare n integer; begin
      update soldes_reportes set montant = 1 where dossier_id = '{I}';
      get diagnostics n = row_count;
      if n <> 0 then raise exception 'MODIFIÉ %', n; end if;
    end $x$$q$, 'OK', ''],

    -- ══ La restauration ══════════════════════════════════════════════════════════════════════════════════════════
    array['fait', '39. le super-administrateur réinsère des soldes reportés, libellés compris, dans un dossier sans exercice validé', 'chef', $q$insert into soldes_reportes (id, dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte, compte_lib, ecriture_lib) values
      ('{RS1}', '{R}', '2025-01-01', '512000', 'Banque', 'debit', 7, 'Exercice 2024 validé', repeat('c', 64), 'Banque', 'À-nouveau Banque'),
      ('{RS2}', '{R}', '2025-01-01', '101000', 'Capital individuel', 'credit', 7, 'Exercice 2024 validé', repeat('c', 64), 'Capital individuel', 'À-nouveau Capital individuel')$q$, 'OK', ''],
    array['controle', '40. un compte rattaché à rien ne restaure pas', 'inconnu', $q$insert into soldes_reportes (dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte) values ('{R}', '2026-01-01', '512000', 'Banque', 'debit', 1, 'x', repeat('0', 64))$q$, '42501', 'Les soldes reportés ne s''écrivent qu''à la validation d''un exercice.'],
    array['controle', '41. ni le client', 'client', $q$insert into soldes_reportes (dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte) values ('{R}', '2026-01-01', '512000', 'Banque', 'debit', 1, 'x', repeat('0', 64))$q$, '42501', 'Les soldes reportés ne s''écrivent qu''à la validation d''un exercice.'],
    array['fait', '42. puis l''exercice validé, en dernier', 'chef', $q$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte, declaration) values ('{R}', 2025, '2026-02-01 10:00+00', '{CHEF}', 'tresorerie', 0, 0, 0, 0, repeat('d', 64), '{}'::jsonb)$q$, 'OK', ''],
    array['controle', '43. restauré, plus rien n''entre', 'chef', $q$insert into soldes_reportes (dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte) values ('{R}', '2026-01-01', '512000', 'Banque', 'debit', 1, 'x', repeat('0', 64))$q$, '42501', 'Les soldes reportés ne s''écrivent qu''à la validation d''un exercice.'],

    -- ══ Qui lit ══════════════════════════════════════════════════════════════════════════════════════════════════
    array['jeu', 'un solde reporté dans le dossier du client, posé sous le drapeau', 'postgres', $q$do $x$ begin
      perform set_config('jd.validation_exercice', '{DC}', true);
      insert into soldes_reportes (id, dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte) values ('{DCS}', '{DC}', '2001-01-01', '512000', 'Banque', 'debit', 1, 'Exercice 2000 validé', repeat('f', 64));
      perform set_config('jd.validation_exercice', '', true);
    end $x$$q$, '', ''],
    array['controle', '44. l''anonyme ne lit aucun solde reporté', 'anon', $q$do $x$ begin if exists (select 1 from soldes_reportes) then raise exception 'VU'; end if; end $x$$q$, 'OK', ''],
    array['controle', '45. ni un compte rattaché à rien', 'inconnu', $q$do $x$ begin if exists (select 1 from soldes_reportes) then raise exception 'VU'; end if; end $x$$q$, 'OK', ''],
    array['controle', '46. ni le client, sur son propre dossier', 'client', $q$do $x$ begin if exists (select 1 from soldes_reportes where dossier_id in ('{DC}', '{I}')) then raise exception 'VU'; end if; end $x$$q$, 'OK', ''],
    array['controle', '47. le chef du cabinet les lit', 'chef', $q$do $x$ begin if (select count(*) from soldes_reportes where dossier_id in ('{I}', '{DC}')) <> 5 then raise exception 'PAS VU'; end if; end $x$$q$, 'OK', ''],

    -- ══ Ce que le catalogue dit ══════════════════════════════════════════════════════════════════════════════════
    array['valeur', '48. le déclencheur est actif sur l''insertion, la modification et la suppression, avant la ligne', 'postgres', $q$select ((t.tgtype & 2) <> 0)::text || ':' || ((t.tgtype & 4) <> 0)::text || ':' || ((t.tgtype & 16) <> 0)::text || ':' || ((t.tgtype & 8) <> 0)::text || ':' || t.tgenabled::text || ':' || t.tgfoid::regproc::text from pg_trigger t where t.tgname = 'soldes_reportes_ecrits_par_la_validation' and t.tgrelid = 'public.soldes_reportes'::regclass$q$, '', 'true:true:true:true:O:garder_soldes_reportes'],
    array['valeur', '49. lus par le cabinet, réinsérés par le super-administrateur, jamais modifiés ni supprimés', 'postgres', $q$select string_agg(policyname || ':' || cmd || ':' || array_to_string(roles, '+'), ',' order by policyname collate "C") || '/' || (select relrowsecurity::text from pg_class where oid = 'public.soldes_reportes'::regclass) from pg_policies where schemaname = 'public' and tablename = 'soldes_reportes'$q$, '',
      'soldes_reportes_lecture:SELECT:authenticated,soldes_reportes_restauration:INSERT:authenticated/true'],
    array['valeur', '50. partis avec leur dossier', 'postgres', $q$select string_agg(confdeltype::text, ',') from pg_constraint where conrelid = 'public.soldes_reportes'::regclass and contype = 'f'$q$, '', 'c'],
    array['valeur', '51. les droits d''exécution (anonyme, connecté)', 'postgres', $q$select string_agg(f || ':' || has_function_privilege('anon', 'public.' || f || a, 'execute') || ':' || has_function_privilege('authenticated', 'public.' || f || a, 'execute'), ',' order by f collate "C") from (values
      ('valider_exercice', '(uuid, integer, jsonb, jsonb, jsonb)'), ('empreinte_exercice', '(uuid, integer, text)'),
      ('soldes_a_reporter', '(uuid, integer)'), ('garder_soldes_reportes', '()')) as t(f, a)$q$, '',
      'empreinte_exercice:false:true,garder_soldes_reportes:false:false,soldes_a_reporter:false:false,valider_exercice:false:true']
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
          if etape[3] <> 'postgres' then
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
        perform set_config('jd.validation_exercice', '', true);
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
  perform set_config('jd.validation_exercice', '', true);

  -- ══ 52. Rien n'est resté ═════════════════════════════════════════════════════════════════════════════════════════
  select string_agg(n::text, '/') into apres from (values
    ((select count(*) from dossiers)), ((select count(*) from cabinets)), ((select count(*) from cabinet_admins)),
    ((select count(*) from ecritures_brouillon)), ((select count(*) from a_nouveaux)),
    ((select count(*) from exercices_valides)), ((select count(*) from soldes_reportes))
  ) as t(n);
  verdicts := verdicts || jsonb_build_object('controle', '52. rien n''est resté en base',
    'observe', avant || ' -> ' || apres,
    'ok', avant = apres and not exists (select 1 from dossiers where nom like 'ESSAI REPORT%')
      and not exists (select 1 from cabinet_admins where user_id = client)
      and current_setting('session_replication_role') = 'origin');

  perform set_config('essai.report', verdicts::text, true);
end $essai$;

select v.controle, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.report')::jsonb) as v(controle text, ok boolean, observe text)
order by (regexp_match(v.controle, '^(\d+)'))[1]::int, v.controle;
