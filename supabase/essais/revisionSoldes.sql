-- LA RÉVISION DES SOLDES, ÉPROUVÉE EN BASE — à rejouer par `execute_sql` après toute migration qui touche
-- `revision_justifications`, `revision_preuves`, leurs gardes ou leurs policies, `justifier_solde`, `solde_du_compte`,
-- `garder_source_citee`, ou ce que la fonction lit pour décider : l'ouverture d'un exercice (`a_nouveaux`,
-- `soldes_reportes`, `exercices_valides`, `valider_exercice`) et le brouillon (ligne 41, étape R1 ; migration
-- `revision_des_soldes`).
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - QUI LIT ET QUI ÉCRIT : une décision et sa preuve EXISTENT dans le dossier du client, et l'anonyme, un compte
--     rattaché à rien et le client ne les voient pas, ne les modifient pas, n'en écrivent pas, et n'appellent pas la
--     fonction ; le chef du cabinet les voit, ne les modifie pas, et, super-administrateur, en insère (la restauration) ;
--     un membre du cabinet AFFECTÉ au dossier, qui n'est pas super-administrateur, justifie par la fonction, ne voit et
--     n'atteint rien ailleurs, n'insère pas en direct ;
--   - LES TREIZE REFUS DE `justifier_solde`, chacun jugé à son code ET à son message, et leur ORDRE, par paires de refus
--     voisins qu'une même demande déclenche ensemble — la première raison dite est celle que l'ordre fixe ;
--   - CE QUI S'ÉCRIT : le solde du jour au centime, l'état, le motif, la portée, l'auteur, la chaîne des remplacements et
--     la reprise d'une décision permanente, l'empreinte de chaque source RECOPIÉE (nulle quand la source n'en a pas) ;
--   - LE SOLDE D'UN COMPTE (`solde_du_compte`) : les écritures de l'exercice, proposées comme validées, et son
--     ouverture — la reprise datée de l'exercice, les soldes reportés au 1er janvier —, rien d'un autre exercice ;
--   - L'IMMUABILITÉ ET LA RESTAURATION : rien ne se modifie, même pour le propriétaire ; le super-administrateur réinsère
--     des décisions et des preuves, jamais une décision qui en remplace une autre d'un autre compte ou avant elle, une
--     reprise sans sa cible, une preuve d'un autre dossier ou qui cite un fichier du cabinet ; chaque contrainte par son
--     nom ;
--   - UNE SOURCE CITÉE (hypothèse Q8 du cabinet) ne change pas de dossier — même citée par une décision remplacée
--     depuis —, une source qui ne l'est pas, si ; et le contenu d'une source citée reste libre ;
--   - CE QUE LE CATALOGUE DIT, faute de pouvoir le jouer ici : les déclencheurs, les policies, les clés et leur action à
--     la suppression, l'absence de clé vers les sources, la sécurité et les droits des fonctions, les index ;
--   - et que RIEN ne reste en base après l'essai.
--
-- CE QUI NE SE JOUE PAS ICI, ET SE JOUE SUR UNE RÉPLIQUE LOCALE DU SCHÉMA (HISTORIQUE.md, entrée de l'étape R1) : une
-- suppression — d'une décision ou d'une preuve (refusée en direct), d'une source citée (refusée), d'une source qui ne
-- l'est pas, et la cascade d'un dossier qui emporte ensemble sources et révision — et deux sessions concurrentes.
--
-- Le harnais est celui de `reportDesSoldes.sql` : des dossiers JETABLES (préfixe `e55b4100`), dans le cabinet du dossier
-- `test` et dans un cabinet jetable, au sein d'un bloc qui s'annule entièrement à la fin (`ANNULATION_ESSAI_GLOBALE`) ;
-- chaque contrôle dans sa propre sous-transaction, annulée (`ANNULATION_ESSAI`, P0001), le verdict posé dans une
-- VARIABLE avant ; les étapes « fait » gardées jusqu'à l'annulation finale. Un refus se juge à son code ET à son message.
-- L'exercice en cours se lit à Paris (`{AN}`). Aucune instruction de suppression. Hors de l'outil d'exécution, le fichier
-- se joue en UNE transaction (`psql -1`).
--
-- ÉPROUVÉ LE 09/10/2026, après la migration `revision_des_soldes` (version 20261009091615) : 165 verdicts sur 165 en
-- production (les contrôles 1 à 149 et leurs variantes, les deux validations du jeu), le texte transmis identique à ce
-- fichier, ce paragraphe retiré (76 915 caractères, empreinte 4be20935d373abfa6d03887f046939e5), rien laissé en base. Sur
-- une réplique dont signature.sql a montré les neuf familles égales à la production : les mêmes 165, ce qui ne se joue
-- pas ici (30 verdicts), huit courses de deux sessions, et cent trente-cinq mutations de la migration, dont cent
-- trente-quatre mordent — la survivante est équivalente : le solde écrit est celui que le refus 9 a exigé égal au solde
-- annoncé, dans une colonne au centime.
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
  cle text; valeur text; s text; attendu text;
  accepte boolean; code_recu text; message text; obs text;
  avant text; apres text;
  verdicts jsonb := '[]'::jsonb;
begin
  select m.dossier_id into dossier_client from memberships m where m.user_id = client order by m.dossier_id limit 1;
  select cabinet_id into cabinet from dossiers where id = dossier_test;
  if dossier_client is null or cabinet is null or dossier_client = dossier_test
     or exists (select 1 from cabinet_admins where user_id = client)
     or not exists (select 1 from super_admins where user_id = chef)
     or extract(year from (now() at time zone 'Europe/Paris'))::integer < 2026 then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable';
  end if;

  ids := jsonb_build_object('CAB', cabinet, 'DC', dossier_client, 'CHEF', chef, 'CLIENT', client,
      'AN', extract(year from (now() at time zone 'Europe/Paris'))::integer::text,
      'MOTIF4000', repeat('m', 4000), 'MOTIF4001', repeat('m', 4001), 'PREC501', repeat('p', 501),
      'GROS', '{"lignes":"' || repeat('x', 65536) || '"}')
    || jsonb_build_object(
      'A', 'e55b4100-0000-4000-8000-0000000000a1', 'B', 'e55b4100-0000-4000-8000-0000000000a2',
      'C', 'e55b4100-0000-4000-8000-0000000000a3', 'D', 'e55b4100-0000-4000-8000-0000000000a4',
      'E', 'e55b4100-0000-4000-8000-0000000000a5', 'F', 'e55b4100-0000-4000-8000-0000000000a6',
      'CJ', 'e55b4100-0000-4000-8000-0000000000c1', 'J1', 'e55b4100-0000-4000-8000-0000000000c2',
      'J2', 'e55b4100-0000-4000-8000-0000000000c3', 'ABSENT', 'e55b4100-0000-4000-8000-0000000000ff',
      'G', 'e55b4100-0000-4000-8000-0000000000b1', 'H', 'e55b4100-0000-4000-8000-0000000000b2',
      'I', 'e55b4100-0000-4000-8000-0000000000b3', 'K', 'e55b4100-0000-4000-8000-0000000000b4')
    || jsonb_build_object(
      'PA1', 'e55b4100-0000-4000-8001-000000000001', 'PA2', 'e55b4100-0000-4000-8001-000000000002',
      'PX', 'e55b4100-0000-4000-8001-000000000003', 'PB1', 'e55b4100-0000-4000-8001-000000000004',
      'PE1', 'e55b4100-0000-4000-8001-000000000005', 'PJ1', 'e55b4100-0000-4000-8001-000000000006',
      'PDC', 'e55b4100-0000-4000-8001-000000000007', 'PK1', 'e55b4100-0000-4000-8001-000000000008',
      'DA1', 'e55b4100-0000-4000-8002-000000000001', 'DA2', 'e55b4100-0000-4000-8002-000000000002',
      'DB1', 'e55b4100-0000-4000-8002-000000000003')
    || jsonb_build_object(
      'RDC', 'e55b4100-0000-4000-8004-000000000001', 'RDC2', 'e55b4100-0000-4000-8004-000000000002',
      'E1', 'e55b4100-0000-4000-8003-000000000011', 'E2', 'e55b4100-0000-4000-8003-000000000012');

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from revision_justifications)), ((select count(*) from revision_preuves)),
    ((select count(*) from dossiers)), ((select count(*) from cabinets)), ((select count(*) from cabinet_admins)),
    ((select count(*) from dossier_assignations)), ((select count(*) from pieces)), ((select count(*) from documents_divers)),
    ((select count(*) from ecritures_brouillon)), ((select count(*) from a_nouveaux)), ((select count(*) from exercices_valides)),
    ((select count(*) from soldes_reportes))
  ) as t(n);

  -- Une étape : {genre, contrôle, qui, requête, code attendu, message attendu (motif LIKE) ou valeur attendue} — les
  -- genres de `reportDesSoldes.sql` : « jeu » (posé par le propriétaire, gardé), « controle » (joué sous « qui » puis
  -- annulé ; « OK » attend qu'il passe), « fait » (joué sous « qui » et gardé), « valeur » (une lecture qui doit rendre
  -- exactement la valeur attendue). « qui » : postgres, chef, client, collaborateur (le même compte que le client, une
  -- fois devenu membre affecté du cabinet jetable), inconnu, anon.
  etapes := array[
    -- ══ Le jeu ══════════
    -- A : rien ne précède 2025, qui s'ouvre sans objet. B : reprise au 1er janvier 2024. C : une écriture de 2024, 2024
    -- non validé. D : une reprise au 1er janvier 2026, et une écriture de 2024. E : 2024 validé, qui ouvre 2025 par des
    -- soldes reportés. F : 2023 validé, 2024 non. G : une reprise au 31 décembre 2025, qui ouvre 2025. H : une reprise de
    -- 2024, et rien d'autre. I : une écriture du 1er janvier 2025, qui ne précède pas 2025. K : un montant au millième, et
    -- une pièce dont l'empreinte n'est pas un SHA-256 en minuscules. J1 et J2 : un cabinet jetable, dont J1 est confié au
    -- collaborateur.
    array['jeu', 'dossiers jetables', 'postgres', $q$insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values
      ('{A}', 'ESSAI REVISION A', '{CAB}', 'tresorerie', '455000'), ('{B}', 'ESSAI REVISION B', '{CAB}', 'tresorerie', '455000'),
      ('{C}', 'ESSAI REVISION C', '{CAB}', 'tresorerie', '455000'), ('{D}', 'ESSAI REVISION D', '{CAB}', 'tresorerie', '455000'),
      ('{E}', 'ESSAI REVISION E', '{CAB}', 'tresorerie', '455000'), ('{F}', 'ESSAI REVISION F', '{CAB}', 'tresorerie', '455000'),
      ('{G}', 'ESSAI REVISION G', '{CAB}', 'tresorerie', '455000'), ('{H}', 'ESSAI REVISION H', '{CAB}', 'tresorerie', '455000'),
      ('{I}', 'ESSAI REVISION I', '{CAB}', 'tresorerie', '455000'), ('{K}', 'ESSAI REVISION K', '{CAB}', 'tresorerie', '455000')$q$, '', ''],
    array['jeu', 'cabinet jetable et ses deux dossiers', 'postgres', $q$insert into cabinets (id, nom) values ('{CJ}', 'ESSAI REVISION CABINET')$q$, '', ''],
    array['jeu', '', 'postgres', $q$insert into dossiers (id, nom, cabinet_id) values ('{J1}', 'ESSAI REVISION J1', '{CJ}'), ('{J2}', 'ESSAI REVISION J2', '{CJ}')$q$, '', ''],
    array['jeu', 'pièces et documents', 'postgres', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, storage_hash) values
      ('{PA1}', '{A}', '{A}/essai-pa1.pdf', 'essai-pa1.pdf', repeat('ab', 32)), ('{PA2}', '{A}', '{A}/essai-pa2.pdf', 'essai-pa2.pdf', null),
      ('{PX}', '{A}', '{A}/essai-px.pdf', 'essai-px.pdf', repeat('ef', 32)), ('{PB1}', '{B}', '{B}/essai-pb1.pdf', 'essai-pb1.pdf', repeat('01', 32)),
      ('{PE1}', '{E}', '{E}/essai-pe1.pdf', 'essai-pe1.pdf', repeat('23', 32)), ('{PJ1}', '{J1}', '{J1}/essai-pj1.pdf', 'essai-pj1.pdf', null),
      ('{PDC}', '{DC}', '{DC}/essai-pdc.pdf', 'essai-pdc.pdf', null), ('{PK1}', '{K}', '{K}/essai-pk1.pdf', 'essai-pk1.pdf', upper(repeat('ab', 32)))$q$, '', ''],
    array['jeu', '', 'postgres', $q$insert into documents_divers (id, dossier_id, storage_path, nom_fichier, categorie, storage_hash) values
      ('{DA1}', '{A}', '{A}/essai-da1.pdf', 'essai-da1.pdf', 'releve_bancaire', repeat('cd', 32)),
      ('{DA2}', '{A}', '{A}/essai-da2.pdf', 'essai-da2.pdf', 'autre', null),
      ('{DB1}', '{B}', '{B}/essai-db1.pdf', 'essai-db1.pdf', 'releve_bancaire', null)$q$, '', ''],
    -- A, 2025 : la banque à 1 500,10 − 265,55 − 0,10 − 0,20 − 200 = 1 034,25 au débit (0,10 + 0,20 ne font 0,30 qu'en
    -- centimes) ; le 108 à 200 au débit ; le fournisseur à 12,34 au crédit. Un mouvement de 2026 n'en est pas.
    array['jeu', 'écritures de A', 'postgres', $q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens) values
      ('{A}', '2025-02-01', '512000', 'ESSAI HONORAIRES', 1500.10, 'debit'), ('{A}', '2025-02-01', '706000', 'ESSAI HONORAIRES', 1500.10, 'credit'),
      ('{A}', '2025-03-01', '606100', 'ESSAI ACHAT', 265.55, 'debit'), ('{A}', '2025-03-01', '512000', 'ESSAI ACHAT', 265.55, 'credit'),
      ('{A}', '2025-03-02', '627000', 'ESSAI FRAIS', 0.1, 'debit'), ('{A}', '2025-03-02', '512000', 'ESSAI FRAIS', 0.1, 'credit'),
      ('{A}', '2025-03-03', '627000', 'ESSAI FRAIS', 0.2, 'debit'), ('{A}', '2025-03-03', '512000', 'ESSAI FRAIS', 0.2, 'credit'),
      ('{A}', '2025-04-01', '108000', 'ESSAI PRÉLÈVEMENT', 200, 'debit'), ('{A}', '2025-04-01', '512000', 'ESSAI PRÉLÈVEMENT', 200, 'credit'),
      ('{A}', '2025-05-01', '445660', 'ESSAI TVA', 12.34, 'debit'), ('{A}', '2025-05-01', '401000', 'ESSAI FOURNISSEUR', 12.34, 'credit'),
      ('{A}', '2026-01-15', '512000', 'ESSAI 2026', 999, 'debit'), ('{A}', '2026-01-15', '706000', 'ESSAI 2026', 999, 'credit')$q$, '', ''],
    array['jeu', 'écritures de B, C, D et J1', 'postgres', $q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens) values
      ('{B}', '2024-06-01', '512000', 'ESSAI', 100, 'debit'), ('{B}', '2024-06-01', '706000', 'ESSAI', 100, 'credit'),
      ('{B}', '2025-06-01', '512000', 'ESSAI', 50, 'debit'), ('{B}', '2025-06-01', '706000', 'ESSAI', 50, 'credit'),
      ('{C}', '2024-12-31', '606100', 'ESSAI', 10, 'debit'), ('{C}', '2024-12-31', '512000', 'ESSAI', 10, 'credit'),
      ('{D}', '2024-05-01', '606100', 'ESSAI', 3, 'debit'), ('{D}', '2024-05-01', '512000', 'ESSAI', 3, 'credit'),
      ('{J1}', '2025-02-01', '512000', 'ESSAI', 42, 'debit'), ('{J1}', '2025-02-01', '706000', 'ESSAI', 42, 'credit'),
      ('{I}', '2025-01-01', '512000', 'ESSAI', 2, 'debit'), ('{I}', '2025-01-01', '706000', 'ESSAI', 2, 'credit'),
      ('{K}', '2025-06-01', '512000', 'ESSAI', 1.005, 'debit'), ('{K}', '2025-06-01', '706000', 'ESSAI', 1.005, 'credit'),
      ('{K}', '2025-06-02', '512000', 'ESSAI', 0.125, 'debit'), ('{K}', '2025-06-02', '706000', 'ESSAI', 0.125, 'credit')$q$, '', ''],
    array['jeu', 'les reprises de B et D', 'postgres', $q$insert into a_nouveaux (dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte) values
      ('{B}', '2024-01-01', '512000', 'Banque', 'debit', 800, 'balance-essai-b.csv', repeat('a', 64)),
      ('{B}', '2024-01-01', '101000', 'Capital', 'credit', 800, 'balance-essai-b.csv', repeat('a', 64)),
      ('{D}', '2026-01-01', '512000', 'Banque', 'debit', 5, 'balance-essai-d.csv', repeat('b', 64)),
      ('{D}', '2026-01-01', '101000', 'Capital', 'credit', 5, 'balance-essai-d.csv', repeat('b', 64)),
      ('{G}', '2025-12-31', '512000', 'Banque', 'debit', 4, 'balance-essai-g.csv', repeat('c', 64)),
      ('{G}', '2025-12-31', '101000', 'Capital', 'credit', 4, 'balance-essai-g.csv', repeat('c', 64)),
      ('{H}', '2024-01-01', '512000', 'Banque', 'debit', 6, 'balance-essai-h.csv', repeat('d', 64)),
      ('{H}', '2024-01-01', '101000', 'Capital', 'credit', 6, 'balance-essai-h.csv', repeat('d', 64))$q$, '', ''],
    array['jeu', 'écritures de E', 'postgres', $q$insert into ecritures_brouillon (id, dossier_id, date, compte, libelle, montant, sens) values
      ('{E1}', '{E}', '2024-01-10', '512000', 'ESSAI APPORT', 1000, 'debit'), ('{E2}', '{E}', '2024-01-10', '101000', 'ESSAI APPORT', 1000, 'credit')$q$, '', ''],
    array['jeu', '', 'postgres', $q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens) values
      ('{E}', '2025-03-01', '606100', 'ESSAI ACHAT', 300, 'debit'), ('{E}', '2025-03-01', '512000', 'ESSAI ACHAT', 300, 'credit')$q$, '', ''],
    array['fait', '0a. le chef valide 2024 de E, qui ouvre 2025 par ses soldes', 'chef', $q$select valider_exercice('{E}', 2024, '[
      {"id":"{E1}","journal":"BQ","numero":1,"piece_ref":"Relevé essai","piece_date":"2024-01-10","compte_lib":"Banque"},
      {"id":"{E2}","journal":"BQ","numero":1,"piece_ref":"Relevé essai","piece_date":"2024-01-10","compte_lib":"Capital"}]'::jsonb,
      '[]'::jsonb, '{"essai":"E"}'::jsonb)$q$, 'OK', ''],
    array['fait', '0b. le chef valide 2023 de F, vide', 'chef', $q$select valider_exercice('{F}', 2023, '[]'::jsonb, '[]'::jsonb, '{"essai":"F"}'::jsonb)$q$, 'OK', ''],
    array['jeu', 'une décision et sa preuve dans le dossier du client, posées par le propriétaire', 'postgres', $q$insert into revision_justifications (id, dossier_id, annee, compte, solde, etat, motif, portee, auteur) values
      ('{RDC}', '{DC}', 2001, '512000', 0, 'accepte', 'ESSAI', 'exercice', '{CHEF}')$q$, '', ''],
    array['jeu', '', 'postgres', $q$insert into revision_preuves (dossier_id, justification_id, piece_id) values ('{DC}', '{RDC}', '{PDC}')$q$, '', ''],

    -- ══ Qui lit, qui écrit ══════════
    array['controle', '1. l''anonyme ne lit aucune décision ni aucune preuve', 'anon', $q$do $x$ begin if exists (select 1 from revision_justifications) or exists (select 1 from revision_preuves) then raise exception 'VU'; end if; end $x$$q$, 'OK', ''],
    array['controle', '2. ni un compte rattaché à rien', 'inconnu', $q$do $x$ begin if exists (select 1 from revision_justifications) or exists (select 1 from revision_preuves) then raise exception 'VU'; end if; end $x$$q$, 'OK', ''],
    array['controle', '3. ni le client, sur son propre dossier', 'client', $q$do $x$ begin if exists (select 1 from revision_justifications where dossier_id = '{DC}') or exists (select 1 from revision_preuves where dossier_id = '{DC}') then raise exception 'VU'; end if; end $x$$q$, 'OK', ''],
    array['controle', '4. le chef du cabinet les lit', 'chef', $q$do $x$ begin if (select count(*) from revision_justifications where dossier_id = '{DC}') <> 1 or (select count(*) from revision_preuves where dossier_id = '{DC}') <> 1 then raise exception 'PAS VU'; end if; end $x$$q$, 'OK', ''],
    array['controle', '5. l''anonyme n''appelle pas la fonction', 'anon', $q$select justifier_solde('{A}', 2025, '512000', 1034.25, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '42501', 'permission denied for function justifier_solde'],
    array['controle', '6. refus 1 : un compte rattaché à rien', 'inconnu', $q$select justifier_solde('{A}', 2025, '512000', 1034.25, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '7. refus 1 : le client, sur son propre dossier', 'client', $q$select justifier_solde('{DC}', 2025, '512000', 0, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '8. refus 1 : un dossier qui n''existe pas se refuse comme un dossier interdit, même au super-administrateur', 'chef', $q$select justifier_solde('{ABSENT}', 2025, '512000', 0, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '9. refus 1 avant 2 : l''accès d''abord', 'inconnu', $q$select justifier_solde('{A}', 1999, '512000', 0, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '10. le client n''écrit pas une décision en direct', 'client', $q$insert into revision_justifications (dossier_id, annee, compte, solde, etat, motif, portee, auteur) values ('{DC}', 2002, '512000', 0, 'accepte', 'ESSAI', 'exercice', '{CLIENT}')$q$, '42501', 'new row violates row-level security policy for table "revision_justifications"'],
    array['controle', '11. ni une preuve : la garde ne lui montre pas la décision', 'client', $q$insert into revision_preuves (dossier_id, justification_id, piece_id) values ('{DC}', '{RDC}', '{PDC}')$q$, '23514', 'Une preuve appartient à une décision de son dossier.'],
    array['controle', '12. le client ne modifie aucune décision', 'client', $q$do $x$ declare n integer; begin
      update revision_justifications set motif = 'ESSAI MODIFIÉ' where dossier_id = '{DC}'; get diagnostics n = row_count;
      if n <> 0 then raise exception 'MODIFIÉ %', n; end if; end $x$$q$, 'OK', ''],
    array['controle', '13. le chef non plus : aucune policy ne le lui ouvre, aucune ligne touchée', 'chef', $q$do $x$ declare n integer; begin
      update revision_justifications set motif = 'ESSAI MODIFIÉ' where dossier_id = '{DC}'; get diagnostics n = row_count;
      if n <> 0 then raise exception 'MODIFIÉ %', n; end if;
      update revision_preuves set precision = 'ESSAI' where dossier_id = '{DC}'; get diagnostics n = row_count;
      if n <> 0 then raise exception 'MODIFIÉ %', n; end if; end $x$$q$, 'OK', ''],
    array['controle', '14. ni le propriétaire de la base : la garde refuse de modifier une décision', 'postgres', $q$update revision_justifications set motif = 'ESSAI MODIFIÉ' where id = '{RDC}'$q$, '23514', 'Une décision de la révision ne se modifie pas : elle se remplace par une autre, et l''historique reste.'],
    array['controle', '15. ni une preuve', 'postgres', $q$update revision_preuves set precision = 'ESSAI' where justification_id = '{RDC}'$q$, '23514', 'Une preuve de la révision ne se modifie pas.'],
    array['controle', '16. ni par une écriture sans changement', 'postgres', $q$update revision_justifications set motif = motif where id = '{RDC}'$q$, '23514', 'Une décision de la révision ne se modifie pas : elle se remplace par une autre, et l''historique reste.'],

    -- ══ Les refus 2 à 9, et leur ordre ══════════
    array['controle', '17. refus 2 : un exercice avant 2000', 'chef', $q$select justifier_solde('{A}', 1999, '512000', 0, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '22023', 'Exercice invalide.'],
    array['controle', '18. refus 2 : après 2100', 'chef', $q$select justifier_solde('{A}', 2101, '512000', 0, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '22023', 'Exercice invalide.'],
    array['controle', '19. refus 2 : sans exercice', 'chef', $q$select justifier_solde('{A}', null, '512000', 0, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '22023', 'Exercice invalide.'],
    array['controle', '20. refus 3 : l''exercice en cours, lu à Paris', 'chef', $q$select justifier_solde('{A}', {AN}, '512000', 0, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '22023', 'L''exercice {AN} n''est pas terminé : ses soldes se justifient une fois clos.'],
    array['controle', '21. refus 3 avant 5 : un compte de résultat dans l''exercice en cours', 'chef', $q$select justifier_solde('{A}', {AN}, '601000', 0, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '22023', 'L''exercice {AN} n''est pas terminé : ses soldes se justifient une fois clos.'],
    array['controle', '22. refus 5 : un compte de résultat', 'chef', $q$select justifier_solde('{A}', 2025, '601000', 0, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '22023', 'Seul un compte de bilan, classes 1 à 5, se justifie par son solde.'],
    array['controle', '23. refus 5 : un compte de la classe 8', 'chef', $q$select justifier_solde('{A}', 2025, '801000', 0, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '22023', 'Seul un compte de bilan, classes 1 à 5, se justifie par son solde.'],
    array['controle', '24. refus 5 : un numéro précédé d''un blanc', 'chef', $q$select justifier_solde('{A}', 2025, ' 512000', 0, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '22023', 'Seul un compte de bilan, classes 1 à 5, se justifie par son solde.'],
    array['controle', '25. refus 5 : deux chiffres', 'chef', $q$select justifier_solde('{A}', 2025, '51', 0, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '22023', 'Seul un compte de bilan, classes 1 à 5, se justifie par son solde.'],
    array['controle', '26. refus 5 : sans compte', 'chef', $q$select justifier_solde('{A}', 2025, null, 0, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '22023', 'Seul un compte de bilan, classes 1 à 5, se justifie par son solde.'],
    array['controle', '27. refus 5 avant 6 : un compte de résultat d''un exercice repris', 'chef', $q$select justifier_solde('{D}', 2025, '601000', 0, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '22023', 'Seul un compte de bilan, classes 1 à 5, se justifie par son solde.'],
    array['controle', '28. refus 6 avant 7 : un exercice antérieur à la reprise, qu''une écriture précède aussi', 'chef', $q$select justifier_solde('{D}', 2025, '512000', -3, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '22023', 'L''exercice 2025 précède la reprise du dossier : il est dans les comptes repris.'],
    array['controle', '29. refus 7 : une écriture de l''exercice précédent, qui n''est pas validé', 'chef', $q$select justifier_solde('{C}', 2025, '512000', 0, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '22023', 'L''exercice 2024 n''est pas validé : les soldes de 2025 ne sont pas encore définitifs.'],
    array['controle', '30. refus 7 : une reprise antérieure, l''exercice qu''elle ouvre n''étant pas validé', 'chef', $q$select justifier_solde('{B}', 2025, '512000', 950, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '22023', 'L''exercice 2024 n''est pas validé : les soldes de 2025 ne sont pas encore définitifs.'],
    array['controle', '31. refus 7 : un exercice validé plus ancien ne suffit pas', 'chef', $q$select justifier_solde('{F}', 2025, '512000', 0, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '22023', 'L''exercice 2024 n''est pas validé : les soldes de 2025 ne sont pas encore définitifs.'],
    array['controle', '32. refus 7 avant 8 : un état inconnu d''un exercice en attente', 'chef', $q$select justifier_solde('{C}', 2025, '512000', 0, 'valide', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '22023', 'L''exercice 2024 n''est pas validé : les soldes de 2025 ne sont pas encore définitifs.'],
    array['controle', '33. l''exercice que rien ne précède se justifie', 'chef', $q$select justifier_solde('{C}', 2024, '512000', -10, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, 'OK', ''],
    array['controle', '34. l''exercice de la reprise se justifie, la reprise comprise', 'chef', $q$select justifier_solde('{B}', 2024, '512000', 900, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, 'OK', ''],
    array['controle', '35. l''exercice qui suit un exercice validé se justifie', 'chef', $q$select justifier_solde('{F}', 2024, '512000', 0, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, 'OK', ''],
    array['controle', '35b. une reprise datée du 31 décembre ouvre son propre exercice', 'chef', $q$select justifier_solde('{G}', 2025, '512000', 4, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, 'OK', ''],
    array['controle', '35c. refus 7 : une reprise antérieure suffit à faire attendre l''ouverture', 'chef', $q$select justifier_solde('{H}', 2025, '512000', 0, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '22023', 'L''exercice 2024 n''est pas validé : les soldes de 2025 ne sont pas encore définitifs.'],
    array['controle', '35d. une écriture du 1er janvier ne précède pas son exercice', 'chef', $q$select justifier_solde('{I}', 2025, '512000', 2, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, 'OK', ''],
    array['controle', '36. refus 8 : un état inconnu', 'chef', $q$select justifier_solde('{A}', 2025, '512000', 1034.25, 'valide', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '22023', 'Une décision dit un solde justifié, accepté sur motif ou en anomalie.'],
    array['controle', '37. refus 8 : sans état', 'chef', $q$select justifier_solde('{A}', 2025, '512000', 1034.25, null, 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '22023', 'Une décision dit un solde justifié, accepté sur motif ou en anomalie.'],
    array['controle', '38. refus 8 : une portée inconnue', 'chef', $q$select justifier_solde('{A}', 2025, '512000', 1034.25, 'accepte', 'ESSAI', 'toujours', '[]'::jsonb, null, null, null)$q$, '22023', 'Une décision vaut pour l''exercice, ou de façon permanente.'],
    array['controle', '39. refus 8 : l''état avant la portée', 'chef', $q$select justifier_solde('{A}', 2025, '512000', 1034.25, 'valide', 'ESSAI', null, '[]'::jsonb, null, null, null)$q$, '22023', 'Une décision dit un solde justifié, accepté sur motif ou en anomalie.'],
    array['controle', '40. refus 8 : une anomalie sans motif', 'chef', $q$select justifier_solde('{A}', 2025, '512000', 1034.25, 'anomalie', null, 'exercice', '[]'::jsonb, null, null, null)$q$, '22023', 'Une anomalie se motive.'],
    array['controle', '41. refus 8 : une anomalie motivée de blancs', 'chef', $q$select justifier_solde('{A}', 2025, '512000', 1034.25, 'anomalie', E' \n\t\r ', 'exercice', '[]'::jsonb, null, null, null)$q$, '22023', 'Une anomalie se motive.'],
    array['controle', '42. refus 8 : un solde accepté sans pièce et sans motif (hypothèse Q3)', 'chef', $q$select justifier_solde('{A}', 2025, '512000', 1034.25, 'accepte', null, 'exercice', '[]'::jsonb, null, null, null)$q$, '22023', 'Un solde accepté sans pièce se motive.'],
    array['controle', '43. refus 8 : un motif de blancs sur un solde justifié', 'chef', $q$select justifier_solde('{A}', 2025, '512000', 1034.25, 'justifie', '   ', 'exercice', '[{"piece_id":"{PA1}"}]'::jsonb, null, null, null)$q$, '22023', 'Un motif ne se compose pas que de blancs : le laisser vide.'],
    array['controle', '44. refus 8 : un motif de 4 001 caractères', 'chef', $q$select justifier_solde('{A}', 2025, '512000', 1034.25, 'accepte', '{MOTIF4001}', 'exercice', '[]'::jsonb, null, null, null)$q$, '22023', 'Un motif tient en 4 000 caractères au plus.'],
    array['controle', '45. un motif de 4 000 caractères passe', 'chef', $q$select justifier_solde('{A}', 2025, '512000', 1034.25, 'accepte', '{MOTIF4000}', 'exercice', '[]'::jsonb, null, null, null)$q$, 'OK', ''],
    array['controle', '46. refus 8 avant 9 : un état inconnu et un solde faux', 'chef', $q$select justifier_solde('{A}', 2025, '512000', 1, 'valide', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '22023', 'Une décision dit un solde justifié, accepté sur motif ou en anomalie.'],
    array['controle', '47. refus 9 : sans solde', 'chef', $q$select justifier_solde('{A}', 2025, '512000', null, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '22023', 'Le solde annoncé n''est pas un montant au centime.'],
    array['controle', '48. refus 9 : un millième', 'chef', $q$select justifier_solde('{A}', 2025, '512000', 1034.255, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '22023', 'Le solde annoncé n''est pas un montant au centime.'],
    array['controle', '49. refus 9 : NaN', 'chef', $q$select justifier_solde('{A}', 2025, '512000', 'NaN'::numeric, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '22023', 'Le solde annoncé n''est pas un montant au centime.'],
    array['controle', '50. refus 9 : un solde qui n''est plus celui des écritures, au débit', 'chef', $q$select justifier_solde('{A}', 2025, '512000', 1034.24, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '22023', 'Le solde du compte 512000 a changé : au 31/12/2025, il est de 1034,25 € au débit.'],
    array['controle', '51. refus 9 : au crédit', 'chef', $q$select justifier_solde('{A}', 2025, '401000', 12.34, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '22023', 'Le solde du compte 401000 a changé : au 31/12/2025, il est de 12,34 € au crédit.'],
    array['controle', '52. refus 9 : un compte soldé', 'chef', $q$select justifier_solde('{A}', 2025, '580000', 1, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '22023', 'Le solde du compte 580000 a changé : au 31/12/2025, il est nul.'],
    array['controle', '53. refus 9 avant 10 : un solde faux et un remplacement inconnu', 'chef', $q$select justifier_solde('{A}', 2025, '512000', 1, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, '{ABSENT}', null)$q$, '22023', 'Le solde du compte 512000 a changé : au 31/12/2025, il est de 1034,25 € au débit.'],

    -- ══ Ce qui s'écrit, et la chaîne des décisions ══════════
    array['fait', '54. le chef justifie la banque de A par une pièce, un document et une pièce sans empreinte', 'chef', $q$select justifier_solde('{A}', 2025, '512000', 1034.25, 'justifie', null, 'exercice',
      '[{"piece_id":"{PA1}","precision":"relevé de décembre, page 2"},{"document_id":"{DA1}"},{"piece_id":"{PA2}","precision":null}]'::jsonb, null, null, null)$q$, 'OK', ''],
    array['valeur', '55. la décision écrite : le solde du jour, l''état, la portée, l''auteur, ni motif, ni instantané, ni remplacement', 'postgres', $q$select solde || '/' || etat || '/' || portee || '/' || (auteur = '{CHEF}') || '/' || coalesce(motif, '∅') || '/' || coalesce(preuve_application::text, '∅') || '/' || coalesce(remplace_id::text, '∅') || '/' || coalesce(reprise_de::text, '∅') || '/' || (cree_le = now()) from revision_justifications where dossier_id = '{A}' and compte = '512000'$q$, '',
      '1034.25/justifie/exercice/true/∅/∅/∅/∅/true'],
    array['valeur', '56. ses preuves : la source, l''empreinte RECOPIÉE (nulle sans empreinte), la précision', 'postgres', $q$select string_agg(coalesce(p.piece_id::text, 'doc ' || p.document_id::text) || ':' || coalesce(left(p.empreinte, 4), '∅') || ':' || coalesce(p.precision, '∅'), ',' order by coalesce(p.piece_id, p.document_id)) from revision_preuves p join revision_justifications j on j.id = p.justification_id where j.dossier_id = '{A}' and j.compte = '512000'$q$, '',
      '{PA1}:abab:relevé de décembre, page 2,{PA2}:∅:∅,doc {DA1}:cdcd:∅'],
    array['controle', '57. refus 10 : décider sans remplacer, quand le compte a déjà une décision', 'chef', $q$select justifier_solde('{A}', 2025, '512000', 1034.25, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '22023', 'Une autre décision a été prise sur ce compte depuis : relire avant de décider.'],
    array['controle', '58. refus 10 : remplacer la décision d''un autre dossier', 'chef', $q$select justifier_solde('{A}', 2025, '512000', 1034.25, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, '{RDC}', null)$q$, '22023', 'La décision à remplacer n''est pas une décision du compte 512000 pour l''exercice 2025.'],
    array['controle', '59. refus 10 : remplacer une décision qui n''existe pas', 'chef', $q$select justifier_solde('{A}', 2025, '512000', 1034.25, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, '{ABSENT}', null)$q$, '22023', 'La décision à remplacer n''est pas une décision du compte 512000 pour l''exercice 2025.'],
    array['fait', '60. le chef remplace la décision par une anomalie motivée, qui ne cite que la première pièce', 'chef', $q$select justifier_solde('{A}', 2025, '512000', 1034.25, 'anomalie', 'ESSAI : écart avec le relevé', 'exercice',
      '[{"piece_id":"{PA1}"}]'::jsonb, null, (select id from revision_justifications where dossier_id = '{A}' and compte = '512000' and remplace_id is null), null)$q$, 'OK', ''],
    array['controle', '61. refus 10 : remplacer la décision remplacée depuis', 'chef', $q$select justifier_solde('{A}', 2025, '512000', 1034.25, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, (select id from revision_justifications where dossier_id = '{A}' and compte = '512000' and remplace_id is null), null)$q$, '22023', 'Une autre décision a été prise sur ce compte depuis : relire avant de décider.'],
    array['valeur', '62. la chaîne : deux décisions, la courante remplace la première', 'postgres', $q$select count(*) || '/' || (select etat || ':' || (remplace_id = (select id from revision_justifications where dossier_id = '{A}' and compte = '512000' and remplace_id is null)) from revision_justifications c where c.dossier_id = '{A}' and c.compte = '512000' and not exists (select 1 from revision_justifications s where s.remplace_id = c.id)) from revision_justifications where dossier_id = '{A}' and compte = '512000'$q$, '',
      '2/anomalie:true'],
    array['controle', '63. refus 10 avant 11 : un remplacement inconnu et une reprise inconnue', 'chef', $q$select justifier_solde('{A}', 2025, '512000', 1034.25, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, '{ABSENT}', '{ABSENT}')$q$, '22023', 'La décision à remplacer n''est pas une décision du compte 512000 pour l''exercice 2025.'],

    -- ══ La reprise d'une justification permanente ══════════
    array['fait', '64. le chef justifie la banque de E en 2024, de façon permanente', 'chef', $q$select justifier_solde('{E}', 2024, '512000', 1000, 'justifie', null, 'permanente', '[{"piece_id":"{PE1}"}]'::jsonb, null, null, null)$q$, 'OK', ''],
    array['fait', '65. et son capital pour l''exercice seulement', 'chef', $q$select justifier_solde('{E}', 2024, '101000', -1000, 'accepte', 'ESSAI : apport', 'exercice', '[]'::jsonb, null, null, null)$q$, 'OK', ''],
    array['controle', '66. refus 11 : une reprise qui n''existe pas', 'chef', $q$select justifier_solde('{E}', 2025, '512000', 700, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, '{ABSENT}')$q$, '22023', 'Une reprise vise une décision du compte 512000 pour l''exercice 2024.'],
    array['controle', '67. refus 11 : la reprise d''un autre compte', 'chef', $q$select justifier_solde('{E}', 2025, '512000', 700, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, (select id from revision_justifications where dossier_id = '{E}' and compte = '101000'))$q$, '22023', 'Une reprise vise une décision du compte 512000 pour l''exercice 2024.'],
    array['controle', '68. refus 11 : la reprise d''une décision qui ne vaut que pour son exercice', 'chef', $q$select justifier_solde('{E}', 2025, '101000', -1000, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, (select id from revision_justifications where dossier_id = '{E}' and compte = '101000'))$q$, '22023', 'Seule une justification permanente se reprend d''un exercice à l''autre.'],
    array['fait', '69. le chef remplace la justification permanente de 2024', 'chef', $q$select justifier_solde('{E}', 2024, '512000', 1000, 'justifie', 'ESSAI : tableau reçu', 'permanente', '[{"piece_id":"{PE1}"}]'::jsonb, null, (select id from revision_justifications where dossier_id = '{E}' and compte = '512000' and remplace_id is null), null)$q$, 'OK', ''],
    array['controle', '70. refus 11 : la reprise d''une décision remplacée depuis', 'chef', $q$select justifier_solde('{E}', 2025, '512000', 700, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, (select id from revision_justifications where dossier_id = '{E}' and compte = '512000' and remplace_id is null))$q$, '22023', 'La décision de 2024 reprise a été remplacée depuis : relire avant de la reprendre.'],
    array['controle', '71. refus 11 avant 12 : une reprise inconnue et des preuves illisibles', 'chef', $q$select justifier_solde('{E}', 2025, '512000', 700, 'justifie', null, 'exercice', '{}'::jsonb, null, null, '{ABSENT}')$q$, '22023', 'Une reprise vise une décision du compte 512000 pour l''exercice 2024.'],
    array['fait', '72. 2025 reprend la justification permanente courante de 2024, au solde de 2025', 'chef', $q$select justifier_solde('{E}', 2025, '512000', 700, 'justifie', null, 'permanente', '[{"piece_id":"{PE1}"}]'::jsonb, null, null, (select id from revision_justifications where dossier_id = '{E}' and compte = '512000' and annee = 2024 and remplace_id is not null))$q$, 'OK', ''],
    array['valeur', '73. la reprise écrite : son solde, sa portée, l''exercice qu''elle reprend', 'postgres', $q$select j.solde || '/' || j.portee || '/' || r.annee || '/' || (r.remplace_id is not null) from revision_justifications j join revision_justifications r on r.id = j.reprise_de where j.dossier_id = '{E}' and j.annee = 2025$q$, '',
      '700.00/permanente/2024/true'],
    array['controle', '74. refus 11 : une reprise ne vise pas une décision du même exercice', 'chef', $q$select justifier_solde('{E}', 2025, '512000', 700, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, (select id from revision_justifications where dossier_id = '{E}' and annee = 2025), (select id from revision_justifications where dossier_id = '{E}' and annee = 2025))$q$, '22023', 'Une reprise vise une décision du compte 512000 pour l''exercice 2024.'],

    -- ══ Le refus 12 : les preuves ══════════
    array['controle', '75. refus 12 : des preuves qui ne sont pas une liste', 'chef', $q$select justifier_solde('{A}', 2025, '445660', 12.34, 'justifie', null, 'exercice', '{}'::jsonb, null, null, null)$q$, '22023', 'Les preuves citées sont illisibles : une liste de pièces et de documents, chacun avec sa précision.'],
    array['controle', '76. refus 12 : une preuve qui n''est pas un objet', 'chef', $q$select justifier_solde('{A}', 2025, '445660', 12.34, 'justifie', null, 'exercice', '[1]'::jsonb, null, null, null)$q$, '22023', 'Les preuves citées sont illisibles : une liste de pièces et de documents, chacun avec sa précision.'],
    array['controle', '77. refus 12 : une clé inconnue', 'chef', $q$select justifier_solde('{A}', 2025, '445660', 12.34, 'justifie', null, 'exercice', '[{"piece_id":"{PA1}","nom":"x"}]'::jsonb, null, null, null)$q$, '22023', 'Les preuves citées sont illisibles : une liste de pièces et de documents, chacun avec sa précision.'],
    array['controle', '78. refus 12 : une pièce et un document dans la même preuve', 'chef', $q$select justifier_solde('{A}', 2025, '445660', 12.34, 'justifie', null, 'exercice', '[{"piece_id":"{PA1}","document_id":"{DA1}"}]'::jsonb, null, null, null)$q$, '22023', 'Les preuves citées sont illisibles : une liste de pièces et de documents, chacun avec sa précision.'],
    array['controle', '79. refus 12 : ni pièce ni document', 'chef', $q$select justifier_solde('{A}', 2025, '445660', 12.34, 'justifie', null, 'exercice', '[{"precision":"x"}]'::jsonb, null, null, null)$q$, '22023', 'Les preuves citées sont illisibles : une liste de pièces et de documents, chacun avec sa précision.'],
    array['controle', '80. refus 12 : un identifiant qui n''en est pas un', 'chef', $q$select justifier_solde('{A}', 2025, '445660', 12.34, 'justifie', null, 'exercice', '[{"piece_id":"abc"}]'::jsonb, null, null, null)$q$, '22023', 'Les preuves citées sont illisibles : une liste de pièces et de documents, chacun avec sa précision.'],
    array['controle', '81. refus 12 : un identifiant en nombre', 'chef', $q$select justifier_solde('{A}', 2025, '445660', 12.34, 'justifie', null, 'exercice', '[{"piece_id":12}]'::jsonb, null, null, null)$q$, '22023', 'Les preuves citées sont illisibles : une liste de pièces et de documents, chacun avec sa précision.'],
    array['controle', '81b. refus 12 : un identifiant enveloppé dans un objet', 'chef', $q$select justifier_solde('{A}', 2025, '445660', 12.34, 'justifie', null, 'exercice', '[{"document_id":{"id":"{DA1}"}}]'::jsonb, null, null, null)$q$, '22023', 'Les preuves citées sont illisibles : une liste de pièces et de documents, chacun avec sa précision.'],
    array['controle', '81c. refus 12 : une précision en nombre', 'chef', $q$select justifier_solde('{A}', 2025, '445660', 12.34, 'justifie', null, 'exercice', '[{"piece_id":"{PA1}","precision":5}]'::jsonb, null, null, null)$q$, '22023', 'Les preuves citées sont illisibles : une liste de pièces et de documents, chacun avec sa précision.'],
    array['controle', '82. refus 12 : un fichier du cabinet, avant l''étape R8', 'chef', $q$select justifier_solde('{A}', 2025, '445660', 12.34, 'justifie', null, 'exercice', '[{"fichier_id":"{PA1}"}]'::jsonb, null, null, null)$q$, '22023', 'Les preuves citées sont illisibles : une liste de pièces et de documents, chacun avec sa précision.'],
    array['controle', '83. refus 12 : une précision de blancs', 'chef', $q$select justifier_solde('{A}', 2025, '445660', 12.34, 'justifie', null, 'exercice', '[{"piece_id":"{PA1}","precision":" \n "}]'::jsonb, null, null, null)$q$, '22023', 'Une précision ne se compose pas que de blancs : la laisser vide.'],
    array['controle', '84. refus 12 : une précision de 501 caractères', 'chef', $q$select justifier_solde('{A}', 2025, '445660', 12.34, 'justifie', null, 'exercice', '[{"piece_id":"{PA1}","precision":"{PREC501}"}]'::jsonb, null, null, null)$q$, '22023', 'Une précision tient en 500 caractères au plus.'],
    array['controle', '85. refus 12 : une pièce citée deux fois, l''identifiant écrit en capitales la seconde', 'chef', $q$select justifier_solde('{A}', 2025, '445660', 12.34, 'justifie', null, 'exercice', ('[{"piece_id":"{PA1}"},{"piece_id":"' || upper('{PA1}') || '"}]')::jsonb, null, null, null)$q$, '22023', 'Une même pièce, ou un même document, est citée deux fois.'],
    array['controle', '86. refus 12 : un document cité deux fois', 'chef', $q$select justifier_solde('{A}', 2025, '445660', 12.34, 'justifie', null, 'exercice', '[{"document_id":"{DA1}"},{"document_id":"{DA1}","precision":"x"}]'::jsonb, null, null, null)$q$, '22023', 'Une même pièce, ou un même document, est citée deux fois.'],
    array['controle', '87. refus 12 : une pièce d''un autre dossier', 'chef', $q$select justifier_solde('{A}', 2025, '445660', 12.34, 'justifie', null, 'exercice', '[{"piece_id":"{PA1}"},{"piece_id":"{PB1}"}]'::jsonb, null, null, null)$q$, '22023', 'Une pièce ou un document cité n''est pas de ce dossier.'],
    array['controle', '88. refus 12 : un document d''un autre dossier', 'chef', $q$select justifier_solde('{A}', 2025, '445660', 12.34, 'justifie', null, 'exercice', '[{"document_id":"{DB1}"}]'::jsonb, null, null, null)$q$, '22023', 'Une pièce ou un document cité n''est pas de ce dossier.'],
    array['controle', '89. refus 12 : une pièce qui n''existe pas', 'chef', $q$select justifier_solde('{A}', 2025, '445660', 12.34, 'justifie', null, 'exercice', '[{"piece_id":"{ABSENT}"}]'::jsonb, null, null, null)$q$, '22023', 'Une pièce ou un document cité n''est pas de ce dossier.'],
    array['controle', '90. refus 12 : une preuve de l''application qui n''est pas un objet', 'chef', $q$select justifier_solde('{A}', 2025, '445660', 12.34, 'justifie', null, 'exercice', '[]'::jsonb, '[1]'::jsonb, null, null)$q$, '22023', 'La preuve de l''application est illisible : un objet, non vide, de 64 Kio au plus.'],
    array['controle', '91. refus 12 : un objet vide', 'chef', $q$select justifier_solde('{A}', 2025, '445660', 12.34, 'justifie', null, 'exercice', '[]'::jsonb, '{}'::jsonb, null, null)$q$, '22023', 'La preuve de l''application est illisible : un objet, non vide, de 64 Kio au plus.'],
    array['controle', '92. refus 12 : plus de 64 Kio', 'chef', $q$select justifier_solde('{A}', 2025, '445660', 12.34, 'justifie', null, 'exercice', '[]'::jsonb, '{GROS}'::jsonb, null, null)$q$, '22023', 'La preuve de l''application est illisible : un objet, non vide, de 64 Kio au plus.'],
    array['controle', '93. refus 12 avant 13 : un solde justifié dont les preuves sont illisibles', 'chef', $q$select justifier_solde('{A}', 2025, '445660', 12.34, 'justifie', null, 'exercice', '"aucune"'::jsonb, null, null, null)$q$, '22023', 'Les preuves citées sont illisibles : une liste de pièces et de documents, chacun avec sa précision.'],
    array['controle', '94. refus 13 : un solde justifié sans rien citer', 'chef', $q$select justifier_solde('{A}', 2025, '445660', 12.34, 'justifie', null, 'exercice', '[]'::jsonb, null, null, null)$q$, '22023', 'Un solde justifié cite au moins une pièce, un document ou la preuve de l''application.'],
    array['controle', '95. refus 13 : le JSON null ne vaut ni preuve ni instantané', 'chef', $q$select justifier_solde('{A}', 2025, '445660', 12.34, 'justifie', null, 'exercice', 'null'::jsonb, 'null'::jsonb, null, null)$q$, '22023', 'Un solde justifié cite au moins une pièce, un document ou la preuve de l''application.'],
    array['fait', '96. la TVA de A se justifie par la seule preuve de l''application', 'chef', $q$select justifier_solde('{A}', 2025, '445660', 12.34, 'justifie', null, 'exercice', 'null'::jsonb, '{"preuve":"essai","version":1}'::jsonb, null, null)$q$, 'OK', ''],
    array['fait', '97. le compte de l''exploitant s''accepte sur motif, sans pièce (hypothèse Q3)', 'chef', $q$select justifier_solde('{A}', 2025, '108000', 200, 'accepte', 'ESSAI : prélèvement', 'exercice', '[]'::jsonb, null, null, null)$q$, 'OK', ''],
    array['fait', '98. un compte soldé se justifie aussi, par un document sans empreinte', 'chef', $q$select justifier_solde('{A}', 2025, '580000', 0, 'justifie', null, 'exercice', '[{"document_id":"{DA2}"}]'::jsonb, null, null, null)$q$, 'OK', ''],
    array['valeur', '99. ce que les trois décisions ont écrit', 'postgres', $q$select string_agg(j.compte || ':' || j.solde || ':' || j.etat || ':' || coalesce(j.preuve_application::text, '∅') || ':' || (select count(*) from revision_preuves p where p.justification_id = j.id) || ':' || coalesce((select coalesce(p.empreinte, '∅') from revision_preuves p where p.justification_id = j.id), '-'), ',' order by j.compte) from revision_justifications j where j.dossier_id = '{A}' and j.compte in ('445660', '108000', '580000')$q$, '',
      '108000:200.00:accepte:∅:0:-,445660:12.34:justifie:{"preuve": "essai", "version": 1}:0:-,580000:0.00:justifie:∅:1:∅'],

    -- ══ Le solde d'un compte ══════════
    array['valeur', '100. la banque de A : les écritures de 2025, sans celle de 2026, au centime', 'postgres', $q$select solde_du_compte('{A}', 2025, '512000')::text$q$, '', '1034.25'],
    array['valeur', '101. le fournisseur de A, au crédit ; un compte sans ligne, nul', 'postgres', $q$select solde_du_compte('{A}', 2025, '401000') || '/' || solde_du_compte('{A}', 2025, '580000')$q$, '', '-12.34/0.00'],
    array['valeur', '102. B en 2024 : la reprise et l''écriture de 2024, sans celle de 2025', 'postgres', $q$select solde_du_compte('{B}', 2024, '512000')::text$q$, '', '900.00'],
    array['valeur', '103. E en 2025 : les soldes reportés au 1er janvier, puis 2025', 'postgres', $q$select solde_du_compte('{E}', 2025, '512000') || '/' || solde_du_compte('{E}', 2025, '101000')$q$, '', '700.00/-1000.00'],
    array['valeur', '104. E en 2024 : ni 2025, ni les soldes reportés sur 2025', 'postgres', $q$select solde_du_compte('{E}', 2024, '512000')::text$q$, '', '1000.00'],
    array['valeur', '105. D en 2026 : la reprise datée de 2026 ouvre 2026', 'postgres', $q$select solde_du_compte('{D}', 2026, '512000') || '/' || solde_du_compte('{D}', 2024, '512000')$q$, '', '5.00/-3.00'],
    array['valeur', '105b. un montant au millième compte pour ses centimes comme dans le navigateur : 1,005 vaut 1,00 et 0,125 vaut 0,13', 'postgres', $q$select solde_du_compte('{K}', 2025, '512000')::text$q$, '', '1.13'],
    array['controle', '105c. refus 9 : le solde que dit le navigateur, pas celui d''un arrondi décimal', 'chef', $q$select justifier_solde('{K}', 2025, '512000', 1.14, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '22023', 'Le solde du compte 512000 a changé : au 31/12/2025, il est de 1,13 € au débit.'],
    array['fait', '105d. au solde du navigateur, la décision s''écrit, et cite une pièce à l''empreinte mal formée', 'chef', $q$select justifier_solde('{K}', 2025, '512000', 1.13, 'justifie', null, 'exercice', '[{"piece_id":"{PK1}"}]'::jsonb, null, null, null)$q$, 'OK', ''],
    array['valeur', '105e. une empreinte qui n''est pas un SHA-256 en minuscules ne se recopie pas : la preuve n''en porte aucune', 'postgres', $q$select coalesce(p.empreinte, '∅') from revision_preuves p where p.piece_id = '{PK1}'$q$, '', '∅'],

    -- ══ La restauration, et ce que la table refuse seule ══════════
    array['controle', '106. le super-administrateur réinsère une décision (la restauration)', 'chef', $q$insert into revision_justifications (dossier_id, annee, compte, solde, etat, motif, portee, auteur, cree_le) values ('{A}', 2025, '467000', 0, 'accepte', 'ESSAI', 'exercice', '{CHEF}', '2026-02-01 10:00+00')$q$, 'OK', ''],
    array['controle', '107. jamais une décision qui en remplace une d''un autre compte', 'chef', $q$insert into revision_justifications (dossier_id, annee, compte, solde, etat, motif, portee, auteur, remplace_id) values ('{A}', 2025, '445660', 12.34, 'accepte', 'ESSAI', 'exercice', '{CHEF}', (select id from revision_justifications where dossier_id = '{A}' and compte = '108000'))$q$, '23514', 'Une décision en remplace une du même compte, pour le même exercice.'],
    array['controle', '108. ni avant celle qu''elle remplace', 'chef', $q$insert into revision_justifications (dossier_id, annee, compte, solde, etat, motif, portee, auteur, remplace_id) values ('{A}', 2025, '445660', 12.34, 'accepte', 'ESSAI', 'exercice', '{CHEF}', '{ABSENT}')$q$, '23514', 'Une décision en remplace une du même compte, pour le même exercice.'],
    array['controle', '109. ni une reprise sans sa cible', 'chef', $q$insert into revision_justifications (dossier_id, annee, compte, solde, etat, motif, portee, auteur, reprise_de) values ('{A}', 2025, '467000', 0, 'accepte', 'ESSAI', 'exercice', '{CHEF}', '{ABSENT}')$q$, '23514', 'Une reprise vise une décision du même compte, pour l''exercice précédent.'],
    array['controle', '110. ni une reprise du même exercice', 'chef', $q$insert into revision_justifications (dossier_id, annee, compte, solde, etat, motif, portee, auteur, reprise_de) values ('{E}', 2024, '512000', 0, 'accepte', 'ESSAI', 'exercice', '{CHEF}', (select id from revision_justifications where dossier_id = '{E}' and annee = 2024 and compte = '512000' and remplace_id is null))$q$, '23514', 'Une reprise vise une décision du même compte, pour l''exercice précédent.'],
    array['controle', '111. une seule première décision par compte et par exercice', 'chef', $q$insert into revision_justifications (dossier_id, annee, compte, solde, etat, motif, portee, auteur) values ('{A}', 2025, '512000', 1034.25, 'accepte', 'ESSAI', 'exercice', '{CHEF}')$q$, '23505', 'duplicate key value violates unique constraint "revision_justifications_une_premiere"'],
    array['controle', '112. et une seule suite à chaque décision', 'chef', $q$insert into revision_justifications (dossier_id, annee, compte, solde, etat, motif, portee, auteur, remplace_id) values ('{A}', 2025, '512000', 1034.25, 'accepte', 'ESSAI', 'exercice', '{CHEF}', (select id from revision_justifications where dossier_id = '{A}' and compte = '512000' and remplace_id is null))$q$, '23505', 'duplicate key value violates unique constraint "revision_justifications_une_suite"'],
    array['controle', '112b. ni une décision qui en remplace une du même compte pour un autre exercice', 'chef', $q$insert into revision_justifications (dossier_id, annee, compte, solde, etat, motif, portee, auteur, remplace_id) values ('{E}', 2025, '512000', 700, 'accepte', 'ESSAI', 'exercice', '{CHEF}', (select id from revision_justifications where dossier_id = '{E}' and annee = 2024 and compte = '512000' and remplace_id is not null))$q$, '23514', 'Une décision en remplace une du même compte, pour le même exercice.'],
    array['controle', '112c. ni une reprise d''un autre compte à l''exercice précédent', 'chef', $q$insert into revision_justifications (dossier_id, annee, compte, solde, etat, motif, portee, auteur, reprise_de) values ('{E}', 2025, '101000', -1000, 'accepte', 'ESSAI', 'exercice', '{CHEF}', (select id from revision_justifications where dossier_id = '{E}' and annee = 2024 and compte = '512000' and remplace_id is not null))$q$, '23514', 'Une reprise vise une décision du même compte, pour l''exercice précédent.'],
    array['controle', '113. le super-administrateur réinsère une preuve', 'chef', $q$insert into revision_preuves (dossier_id, justification_id, document_id, empreinte, precision) values ('{A}', (select id from revision_justifications where dossier_id = '{A}' and compte = '108000'), '{DA1}', repeat('cd', 32), 'ESSAI')$q$, 'OK', ''],
    array['controle', '114. jamais un fichier du cabinet, avant l''étape R8', 'chef', $q$insert into revision_preuves (dossier_id, justification_id, fichier_id) values ('{A}', (select id from revision_justifications where dossier_id = '{A}' and compte = '108000'), '{ABSENT}')$q$, '23514', 'Un fichier du cabinet ne se cite pas encore : une preuve cite une pièce ou un document du dossier.'],
    array['controle', '115. ni une pièce d''un autre dossier', 'chef', $q$insert into revision_preuves (dossier_id, justification_id, piece_id) values ('{A}', (select id from revision_justifications where dossier_id = '{A}' and compte = '108000'), '{PB1}')$q$, '23514', 'Une preuve cite une pièce de son dossier.'],
    array['controle', '116. ni une pièce qui n''existe pas encore', 'chef', $q$insert into revision_preuves (dossier_id, justification_id, piece_id) values ('{A}', (select id from revision_justifications where dossier_id = '{A}' and compte = '108000'), '{ABSENT}')$q$, '23514', 'Une preuve cite une pièce de son dossier.'],
    array['controle', '117. ni un document d''un autre dossier', 'chef', $q$insert into revision_preuves (dossier_id, justification_id, document_id) values ('{A}', (select id from revision_justifications where dossier_id = '{A}' and compte = '108000'), '{DB1}')$q$, '23514', 'Une preuve cite un document de son dossier.'],
    array['controle', '118. ni la preuve d''une décision d''un autre dossier', 'chef', $q$insert into revision_preuves (dossier_id, justification_id, piece_id) values ('{A}', '{RDC}', '{PA1}')$q$, '23514', 'Une preuve appartient à une décision de son dossier.'],
    array['controle', '119. une pièce citée une fois par décision', 'chef', $q$insert into revision_preuves (dossier_id, justification_id, piece_id) values ('{A}', (select id from revision_justifications where dossier_id = '{A}' and compte = '512000' and remplace_id is null), '{PA1}')$q$, '23505', 'duplicate key value violates unique constraint "revision_preuves_piece_une_fois"'],
    array['controle', '119b. un document cité une fois par décision', 'chef', $q$insert into revision_preuves (dossier_id, justification_id, document_id) values ('{A}', (select id from revision_justifications where dossier_id = '{A}' and compte = '512000' and remplace_id is null), '{DA1}')$q$, '23505', 'duplicate key value violates unique constraint "revision_preuves_document_une_fois"'],
    array['controle', '120. une preuve cite une source, et une seule', 'chef', $q$insert into revision_preuves (dossier_id, justification_id, piece_id, document_id) values ('{A}', (select id from revision_justifications where dossier_id = '{A}' and compte = '108000'), '{PX}', '{DA2}')$q$, '23514', 'new row for relation "revision_preuves" violates check constraint "revision_preuves_une_source"%'],
    array['controle', '121. la table refuse un état inconnu', 'postgres', $q$insert into revision_justifications (dossier_id, annee, compte, solde, etat, motif, portee, auteur) values ('{A}', 2025, '411000', 0, 'valide', 'ESSAI', 'exercice', '{CHEF}')$q$, '23514', 'new row for relation "revision_justifications" violates check constraint "revision_justifications_etat"%'],
    array['controle', '121b. un motif de 4 001 caractères', 'postgres', $q$insert into revision_justifications (dossier_id, annee, compte, solde, etat, motif, portee, auteur) values ('{A}', 2025, '411000', 0, 'accepte', '{MOTIF4001}', 'exercice', '{CHEF}')$q$, '23514', 'new row for relation "revision_justifications" violates check constraint "revision_justifications_motif"%'],
    array['controle', '121c. un instantané de plus de 64 Kio', 'postgres', $q$insert into revision_justifications (dossier_id, annee, compte, solde, etat, motif, portee, auteur, preuve_application) values ('{A}', 2025, '411000', 0, 'accepte', 'ESSAI', 'exercice', '{CHEF}', '{GROS}')$q$, '23514', 'new row for relation "revision_justifications" violates check constraint "revision_justifications_preuve_application"%'],
    array['controle', '122. un solde accepté sans motif', 'postgres', $q$insert into revision_justifications (dossier_id, annee, compte, solde, etat, portee, auteur) values ('{A}', 2025, '411000', 0, 'accepte', 'exercice', '{CHEF}')$q$, '23514', 'new row for relation "revision_justifications" violates check constraint "revision_justifications_motif_requis"%'],
    array['controle', '123. un motif de blancs', 'postgres', $q$insert into revision_justifications (dossier_id, annee, compte, solde, etat, motif, portee, auteur) values ('{A}', 2025, '411000', 0, 'anomalie', E'\t ', 'exercice', '{CHEF}')$q$, '23514', 'new row for relation "revision_justifications" violates check constraint "revision_justifications_motif"%'],
    array['controle', '124. un compte de résultat', 'postgres', $q$insert into revision_justifications (dossier_id, annee, compte, solde, etat, motif, portee, auteur) values ('{A}', 2025, '606100', 0, 'accepte', 'ESSAI', 'exercice', '{CHEF}')$q$, '23514', 'new row for relation "revision_justifications" violates check constraint "revision_justifications_compte"%'],
    array['controle', '125. un solde NaN', 'postgres', $q$insert into revision_justifications (dossier_id, annee, compte, solde, etat, motif, portee, auteur) values ('{A}', 2025, '411000', 'NaN', 'accepte', 'ESSAI', 'exercice', '{CHEF}')$q$, '23514', 'new row for relation "revision_justifications" violates check constraint "revision_justifications_solde"%'],
    array['controle', '126. un instantané vide', 'postgres', $q$insert into revision_justifications (dossier_id, annee, compte, solde, etat, motif, portee, auteur, preuve_application) values ('{A}', 2025, '411000', 0, 'accepte', 'ESSAI', 'exercice', '{CHEF}', '{}')$q$, '23514', 'new row for relation "revision_justifications" violates check constraint "revision_justifications_preuve_application"%'],
    array['controle', '127. un exercice hors bornes', 'postgres', $q$insert into revision_justifications (dossier_id, annee, compte, solde, etat, motif, portee, auteur) values ('{A}', 1999, '411000', 0, 'accepte', 'ESSAI', 'exercice', '{CHEF}')$q$, '23514', 'new row for relation "revision_justifications" violates check constraint "revision_justifications_annee"%'],
    array['controle', '128. une portée inconnue', 'postgres', $q$insert into revision_justifications (dossier_id, annee, compte, solde, etat, motif, portee, auteur) values ('{A}', 2025, '411000', 0, 'accepte', 'ESSAI', 'toujours', '{CHEF}')$q$, '23514', 'new row for relation "revision_justifications" violates check constraint "revision_justifications_portee"%'],
    array['controle', '129. une empreinte qui n''est pas un SHA-256 en hexadécimal', 'postgres', $q$insert into revision_preuves (dossier_id, justification_id, piece_id, empreinte) values ('{A}', (select id from revision_justifications where dossier_id = '{A}' and compte = '108000'), '{PX}', upper(repeat('ab', 32)))$q$, '23514', 'new row for relation "revision_preuves" violates check constraint "revision_preuves_empreinte"%'],
    array['controle', '130. une précision de blancs', 'postgres', $q$insert into revision_preuves (dossier_id, justification_id, piece_id, precision) values ('{A}', (select id from revision_justifications where dossier_id = '{A}' and compte = '108000'), '{PX}', ' ')$q$, '23514', 'new row for relation "revision_preuves" violates check constraint "revision_preuves_precision"%'],

    -- ══ Un membre du cabinet affecté au dossier ══════════
    array['jeu', 'le client devient membre du cabinet jetable, affecté à J1 seulement, sans être super-administrateur', 'postgres', $q$insert into cabinet_admins (user_id, cabinet_id, role) values ('{CLIENT}', '{CJ}', 'comptable')$q$, '', ''],
    array['jeu', '', 'postgres', $q$insert into dossier_assignations (dossier_id, user_id) values ('{J1}', '{CLIENT}')$q$, '', ''],
    array['fait', '131. le collaborateur affecté justifie un solde de J1', 'collaborateur', $q$select justifier_solde('{J1}', 2025, '512000', 42, 'justifie', null, 'exercice', '[{"piece_id":"{PJ1}"}]'::jsonb, null, null, null)$q$, 'OK', ''],
    array['valeur', '132. sous son nom', 'postgres', $q$select (auteur = '{CLIENT}')::text || '/' || (select count(*) from revision_preuves where dossier_id = '{J1}') from revision_justifications where dossier_id = '{J1}'$q$, '', 'true/1'],
    array['controle', '133. pas dans J2, qui ne lui est pas confié', 'collaborateur', $q$select justifier_solde('{J2}', 2025, '512000', 0, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '134. ni dans A', 'collaborateur', $q$select justifier_solde('{A}', 2025, '411000', 0, 'accepte', 'ESSAI', 'exercice', '[]'::jsonb, null, null, null)$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '135. il n''écrit pas en direct, même dans J1', 'collaborateur', $q$insert into revision_justifications (dossier_id, annee, compte, solde, etat, motif, portee, auteur) values ('{J1}', 2025, '411000', 0, 'accepte', 'ESSAI', 'exercice', '{CLIENT}')$q$, '42501', 'new row violates row-level security policy for table "revision_justifications"'],
    array['controle', '136. il lit la révision de J1, rien ailleurs', 'collaborateur', $q$do $x$ begin
      if (select count(*) from revision_justifications where dossier_id = '{J1}') <> 1 or (select count(*) from revision_preuves where dossier_id = '{J1}') <> 1 then raise exception 'PAS VU'; end if;
      if exists (select 1 from revision_justifications where dossier_id <> '{J1}') or exists (select 1 from revision_preuves where dossier_id <> '{J1}') then raise exception 'VU AILLEURS'; end if;
    end $x$$q$, 'OK', ''],

    -- ══ Une source citée (hypothèse Q8) ══════════
    array['controle', '137. une pièce citée ne change pas de dossier', 'chef', $q$update pieces set dossier_id = '{B}' where id = '{PA1}'$q$, '23514', 'Cette pièce est citée par la révision du solde du compte 512000 (exercice 2025) : elle ne change plus de dossier, sauf avec son dossier.'],
    array['controle', '138. même citée par une décision remplacée depuis', 'chef', $q$update pieces set dossier_id = '{B}' where id = '{PA2}'$q$, '23514', 'Cette pièce est citée par la révision du solde du compte 512000 (exercice 2025) : elle ne change plus de dossier, sauf avec son dossier.'],
    array['controle', '139. un document cité non plus', 'chef', $q$update documents_divers set dossier_id = '{B}' where id = '{DA1}'$q$, '23514', 'Ce document est cité par la révision du solde du compte 512000 (exercice 2025) : il ne change plus de dossier, sauf avec son dossier.'],
    array['controle', '140. ni pour le propriétaire de la base', 'postgres', $q$update documents_divers set dossier_id = '{B}' where id = '{DA2}'$q$, '23514', 'Ce document est cité par la révision du solde du compte 580000 (exercice 2025) : il ne change plus de dossier, sauf avec son dossier.'],
    array['controle', '141. une pièce qui n''est pas citée, si', 'chef', $q$update pieces set dossier_id = '{B}' where id = '{PX}'$q$, 'OK', ''],
    array['controle', '142. et le contenu d''une source citée reste libre', 'chef', $q$update pieces set notes = 'ESSAI', dossier_id = '{A}' where id = '{PA1}'$q$, 'OK', ''],

    -- ══ Ce que le catalogue dit ══════════
    array['valeur', '143. les déclencheurs : avant la ligne, actifs, sur les bons gestes', 'postgres', $q$select string_agg(t.tgrelid::regclass::text || ':' || t.tgname || ':' || ((t.tgtype & 2) <> 0) || ':' || ((t.tgtype & 4) <> 0) || ':' || ((t.tgtype & 8) <> 0) || ':' || ((t.tgtype & 16) <> 0) || ':' || coalesce((select string_agg(a.attname, '+') from pg_attribute a where a.attrelid = t.tgrelid and a.attnum = any (t.tgattr::int2[])), '') || ':' || t.tgenabled::text || ':' || t.tgfoid::regproc::text, ',' order by t.tgname) from pg_trigger t where t.tgname in ('revision_justifications_gardes', 'revision_preuves_gardes', 'pieces_citees_en_revision', 'documents_divers_cites_en_revision')$q$, '',
      'documents_divers:documents_divers_cites_en_revision:true:false:true:true:dossier_id:O:garder_source_citee,pieces:pieces_citees_en_revision:true:false:true:true:dossier_id:O:garder_source_citee,revision_justifications:revision_justifications_gardes:true:true:true:true::O:garder_revision_justification,revision_preuves:revision_preuves_gardes:true:true:true:true::O:garder_revision_preuve'],
    array['valeur', '144. lues par le cabinet, réinsérées par le super-administrateur, jamais modifiées ni supprimées ; RLS active', 'postgres', $q$select string_agg(tablename || ':' || policyname || ':' || cmd || ':' || array_to_string(roles, '+') || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ',' order by policyname collate "C") || '/' || (select string_agg(relrowsecurity::text, '+' order by relname) from pg_class where oid in ('public.revision_justifications'::regclass, 'public.revision_preuves'::regclass)) from pg_policies where schemaname = 'public' and tablename in ('revision_justifications', 'revision_preuves')$q$, '',
      'revision_justifications:revision_justifications_lecture:SELECT:authenticated:admin_du_dossier(dossier_id):,revision_justifications:revision_justifications_restauration:INSERT:authenticated::is_super_admin(),revision_preuves:revision_preuves_lecture:SELECT:authenticated:admin_du_dossier(dossier_id):,revision_preuves:revision_preuves_restauration:INSERT:authenticated::is_super_admin()/true+true'],
    array['valeur', '145. les clés : le dossier et la décision en cascade, les chaînes sans action, aucune vers une source', 'postgres', $q$select string_agg(conrelid::regclass::text || '.' || (select string_agg(a.attname, '+') from pg_attribute a where a.attrelid = conrelid and a.attnum = any (conkey)) || '>' || confrelid::regclass::text || ':' || confdeltype::text, ',' order by conrelid::regclass::text, conname) from pg_constraint where contype = 'f' and conrelid in ('public.revision_justifications'::regclass, 'public.revision_preuves'::regclass)$q$, '',
      'revision_justifications.dossier_id>dossiers:c,revision_justifications.remplace_id>revision_justifications:a,revision_justifications.reprise_de>revision_justifications:a,revision_preuves.dossier_id>dossiers:c,revision_preuves.justification_id>revision_justifications:c'],
    array['valeur', '146. les fonctions : sécurité, search_path, droits de l''anonyme et d''un compte connecté', 'postgres', $q$select string_agg(p.proname || ':' || p.prosecdef || ':' || coalesce(array_to_string(p.proconfig, ','), '-') || ':' || p.provolatile::text || ':' || has_function_privilege('anon', p.oid, 'execute') || '/' || has_function_privilege('authenticated', p.oid, 'execute'), ',' order by p.proname) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('justifier_solde', 'solde_du_compte', 'cle_revision', 'garder_revision_justification', 'garder_revision_preuve', 'garder_source_citee')$q$, '',
      'cle_revision:false:search_path=public:i:false/false,garder_revision_justification:false:search_path=public:v:false/false,garder_revision_preuve:false:search_path=public:v:false/false,garder_source_citee:true:search_path=public:v:false/false,justifier_solde:true:search_path=public:v:false/true,solde_du_compte:false:search_path=public:s:false/false'],
    array['valeur', '147. les index', 'postgres', $q$select string_agg(pg_get_indexdef(i.indexrelid), ' | ' order by pg_get_indexdef(i.indexrelid) collate "C") from pg_index i where i.indrelid in ('public.revision_justifications'::regclass, 'public.revision_preuves'::regclass)$q$, '',
      'CREATE INDEX revision_justifications_dossier ON public.revision_justifications USING btree (dossier_id, annee, compte) | CREATE INDEX revision_justifications_reprise_de ON public.revision_justifications USING btree (reprise_de) | CREATE INDEX revision_preuves_document ON public.revision_preuves USING btree (document_id) | CREATE INDEX revision_preuves_dossier ON public.revision_preuves USING btree (dossier_id) | CREATE INDEX revision_preuves_piece ON public.revision_preuves USING btree (piece_id) | CREATE UNIQUE INDEX revision_justifications_pkey ON public.revision_justifications USING btree (id) | CREATE UNIQUE INDEX revision_justifications_une_premiere ON public.revision_justifications USING btree (dossier_id, annee, compte) WHERE (remplace_id IS NULL) | CREATE UNIQUE INDEX revision_justifications_une_suite ON public.revision_justifications USING btree (remplace_id) | CREATE UNIQUE INDEX revision_preuves_document_une_fois ON public.revision_preuves USING btree (justification_id, document_id) | CREATE UNIQUE INDEX revision_preuves_fichier_une_fois ON public.revision_preuves USING btree (justification_id, fichier_id) | CREATE UNIQUE INDEX revision_preuves_piece_une_fois ON public.revision_preuves USING btree (justification_id, piece_id) | CREATE UNIQUE INDEX revision_preuves_pkey ON public.revision_preuves USING btree (id)'],
    array['valeur', '148. la fonction rend la décision écrite', 'postgres', $q$select pg_get_function_identity_arguments('public.justifier_solde'::regproc) || ' -> ' || pg_get_function_result('public.justifier_solde'::regproc)$q$, '',
      'p_dossier_id uuid, p_annee integer, p_compte text, p_solde numeric, p_etat text, p_motif text, p_portee text, p_preuves jsonb, p_preuve_application jsonb, p_remplace_id uuid, p_reprise_de uuid -> revision_justifications']
  ];

  begin
    foreach etape slice 1 in array etapes loop
      s := etape[4];
      attendu := etape[6];
      for cle, valeur in select key, value from jsonb_each_text(ids) loop
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
      elsif etape[1] = 'valeur' then
        begin
          execute s into obs;
        exception when others then obs := sqlstate || ' ' || sqlerrm;
        end;
        verdicts := verdicts || jsonb_build_object('controle', etape[2], 'observe', coalesce(obs, '∅'), 'ok', coalesce(obs = attendu, false));
      else
        begin
          if etape[3] <> 'postgres' then
            execute format('set local role %I', case when etape[3] = 'anon' then 'anon' else 'authenticated' end);
            perform set_config('request.jwt.claims', case when etape[3] = 'anon' then json_build_object('role', 'anon')::text
              else json_build_object('sub', case etape[3] when 'chef' then chef when 'client' then client
                                                         when 'collaborateur' then client else inconnu end,
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
                     else not accepte and coalesce(code_recu = etape[5] and message like attendu, false) end);
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

  -- ══ 149. Rien n'est resté ══════════
  select string_agg(n::text, '/') into apres from (values
    ((select count(*) from revision_justifications)), ((select count(*) from revision_preuves)),
    ((select count(*) from dossiers)), ((select count(*) from cabinets)), ((select count(*) from cabinet_admins)),
    ((select count(*) from dossier_assignations)), ((select count(*) from pieces)), ((select count(*) from documents_divers)),
    ((select count(*) from ecritures_brouillon)), ((select count(*) from a_nouveaux)), ((select count(*) from exercices_valides)),
    ((select count(*) from soldes_reportes))
  ) as t(n);
  verdicts := verdicts || jsonb_build_object('controle', '149. rien n''est resté en base',
    'observe', avant || ' -> ' || apres,
    'ok', avant = apres and not exists (select 1 from dossiers where nom like 'ESSAI REVISION%')
      and not exists (select 1 from cabinet_admins where user_id = client));

  perform set_config('essai.revision', verdicts::text, true);
end $essai$;

-- Un verdict qui n'a pas pu se calculer (une valeur nulle dans sa comparaison) est une faute, pas un silence. La ligne 0
-- dit le texte que la base a reçu — par l'outil MCP, qui ajoute sa signature après lui —, pour le comparer au fichier
-- par son empreinte.
select x.controle, x.ok, x.observe from (
  select v.controle, coalesce(v.ok, false) as ok, v.observe
  from jsonb_to_recordset(current_setting('essai.revision')::jsonb) as v(controle text, ok boolean, observe text)
  union all
  select '0. information : le texte reçu par la base', true, length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by (regexp_match(x.controle, '^(\d+)'))[1]::int, x.controle;
