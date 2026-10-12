-- LE DOSSIER PERMANENT DE LA RÉVISION, ÉPROUVÉ EN BASE — à rejouer par `execute_sql` après toute migration qui touche
-- `dossier_permanent`, sa garde `garder_dossier_permanent` ou ses policies, `consigner_au_dossier_permanent`,
-- `retirer_du_dossier_permanent`, la garde des sources citées `garder_source_citee` (étape R1), ce qu'elles lisent — les
-- pièces et les documents cités — ou l'accès (`admin_du_dossier`) et les verrous de la validation et de la révision
-- (ligne 41, étape R7 ; migration `dossier_permanent`).
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - QUI CONSIGNE ET QUI RETIRE, par impersonation : un anonyme n'a pas le droit d'appeler ; un compte rattaché à rien,
--     un client — sur le dossier d'un autre comme sur le SIEN —, un membre du cabinet affecté à un AUTRE dossier, un chef
--     de cabinet hors de son cabinet se font refuser l'accès au dossier ; le chef du cabinet (super-administrateur), un
--     chef qui ne l'est pas et un membre affecté au dossier écrivent (les contrôles POSITIFS, hypothèse Q2) ;
--   - QUI LIT : le client ne voit aucune entrée, pas même celles de SON dossier ; l'anonyme et le compte rattaché à rien
--     non plus ; le membre affecté voit celles de son dossier, et elles seules ; un chef, celles de son cabinet ;
--   - LES REFUS DES DEUX FONCTIONS — `consigner_au_dossier_permanent` (neuf rangs), `retirer_du_dossier_permanent`
--     (quatre) —, chacun jugé à son code ET à son message, et leur ORDRE, par paires de refus voisins qu'une même demande
--     déclenche ensemble ;
--   - CE QUI S'ÉCRIT : la nature, le titre, le texte, la citation et l'empreinte RECOPIÉE de sa source (un SHA-256 en
--     minuscules, sinon rien), la validité, l'auteur — le membre affecté compris — ; la chaîne des versions, qui ne vise
--     que la courante d'une entrée du dossier ; le retrait, une fois, de la courante seule, et une entrée retirée qui ne se
--     remplace plus ;
--   - LA SOURCE CITÉE (hypothèse Q8, la règle de l'étape R1) : une pièce ou un document cité par le dossier permanent —
--     même par une version remplacée ou une entrée retirée — ne change plus de dossier ; la révision d'un solde se dit
--     d'abord, sous ses mots d'hier ; le dossier permanent nomme la nature de l'entrée, chacune des huit sous son libellé,
--     la première dans l'ordre de A9 ; une source qu'aucune entrée ne cite, si ;
--   - CE QUE LA GARDE ET LES CONTRAINTES TIENNENT SANS LES FONCTIONS : rien ne se modifie, sauf le retrait, une fois,
--     de la courante ; le super-administrateur réinsère (la restauration), jamais une entrée qui en remplace une d'un autre
--     dossier ou une retirée, ni qui cite une source d'ailleurs ou un fichier du cabinet ; chaque contrainte par son nom ;
--   - CE QUE LE CATALOGUE DIT, faute de pouvoir le jouer ici : les droits d'exécution, la sécurité des fonctions, les
--     policies, la RLS, les déclencheurs, les clés, les index, les colonnes, les contraintes, ce que les fonctions prennent
--     et rendent ;
--   - LES MUTATIONS (contrôles 160 à 166) : chacune rejoue un contrôle avec un profil délibérément faux, et doit MORDRE ;
--   - et que RIEN ne reste en base.
--
-- CE QUI NE SE JOUE PAS ICI, ET SE JOUE SUR UNE RÉPLIQUE LOCALE dont signature.sql montre les neuf familles égales à la
-- production : une suppression — d'une entrée, refusée en direct ; d'une pièce ou d'un document cité, refusée ; la cascade
-- d'un dossier qui emporte ensemble ses sources et son dossier permanent — et deux sessions qui se croisent : l'outil
-- d'exécution soumet une suppression à une confirmation qui n'arrive pas ici.
--
-- Le harnais est celui de regimesEreporting.sql (le moteur d'étapes de piecesHorsDeFrance.sql) : deux dossiers JETABLES
-- du cabinet du dossier `test`, un cabinet jetable et son dossier, au sein d'un bloc qui s'annule entièrement à la fin
-- (`ANNULATION_ESSAI_GLOBALE`) ; chaque contrôle dans sa sous-transaction, annulée elle aussi (`ANNULATION_ESSAI`, P0001) ;
-- six genres (`jeu`, `controle`, `fait`, `valeur`, `retenir`, `lecture`) et ses profils (« membre » affecté au dossier
-- T, « membre_ailleurs » affecté au dossier A, « chef_simple », chef du cabinet sans être super-administrateur : le compte
-- client rattaché au cabinet le temps de la sous-transaction). Un refus se juge à son code ET à son message (motif LIKE).
-- Les identifiants jetables sont FIXES (préfixe `d7a70000`) ; un caractère hors de l'ASCII se fabrique en base (`chr`).
-- Les verdicts voyagent dans un réglage LOCAL à la transaction (`essai.dossier_permanent`) : hors de l'outil d'exécution, le
-- fichier se joue en UNE transaction (`psql -1`). Aucune instruction de suppression. src/lib/dossierPermanentEssai.test.ts
-- rejoue chacun de ses appels aux deux fonctions sur le module, qui doit dire avant le clic ce que la base a dit.
--
-- JOUÉ EN PRODUCTION LE 12/10/2026, juste après la migration (`20261012070920`, 126 migrations) : 189 lignes, la ligne
-- 0 et 188 verdicts, tous vrais ; le texte reçu par la base est la copie de ce fichier sans ses lignes de commentaire,
-- saut de ligne final compris (68 349 caractères, empreinte 6147a5b1…) — sur la réplique de l'étape, la copie et le
-- fichier rendent les mêmes verdicts, à l'octet ; le contrôle 199 compte les mêmes lignes avant et après.
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
     or (select cabinet_id from dossiers where id = dossier_client) <> cabinet
     or not exists (select 1 from super_admins where user_id = chef)
     or not exists (select 1 from cabinet_admins where user_id = chef and cabinet_id = cabinet and role = 'comptable_en_chef')
     or exists (select 1 from cabinet_admins where user_id = client) or exists (select 1 from super_admins where user_id = client) then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable, ou client déjà rattaché au cabinet';
  end if;

  ids := jsonb_build_object('CAB', cabinet, 'DC', dossier_client, 'CLIENT', client, 'AUTRE', gen_random_uuid(),
      'BLANCS', E' \t\n\r', 'NBSP', chr(160),
      'E500', repeat(chr(233), 500), 'E501', repeat(chr(233), 501),
      'E8000', repeat(chr(233), 8000), 'E8001', repeat(chr(233), 8001),
      'H1', repeat('ab', 32), 'H2', repeat('cd', 32), 'HMAJ', repeat('AB', 32))
    || jsonb_build_object(
      'T', 'd7a70000-0000-4000-8000-0000000000a1', 'A', 'd7a70000-0000-4000-8000-0000000000a2',
      'CJ', 'd7a70000-0000-4000-8000-0000000000c9', 'J', 'd7a70000-0000-4000-8000-0000000000ca',
      'ABSENT', 'd7a70000-0000-4000-8000-0000000000ff')
    || jsonb_build_object(
      'P1', 'd7a70000-0000-4000-8001-000000000001', 'P2', 'd7a70000-0000-4000-8001-000000000002',
      'P3', 'd7a70000-0000-4000-8001-000000000003', 'P4', 'd7a70000-0000-4000-8001-000000000004',
      'PX', 'd7a70000-0000-4000-8001-0000000000a2', 'PC', 'd7a70000-0000-4000-8001-0000000000dc',
      'PJ', 'd7a70000-0000-4000-8001-0000000000ca', 'P1U', 'D7A70000-0000-4000-8001-000000000001',
      'D1', 'd7a70000-0000-4000-8002-000000000001', 'D2', 'd7a70000-0000-4000-8002-000000000002',
      'DX', 'd7a70000-0000-4000-8002-0000000000a2', 'DD', 'd7a70000-0000-4000-8002-0000000000dc',
      'RJ', 'd7a70000-0000-4000-8003-000000000001');

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from cabinets)), ((select count(*) from pieces)),
    ((select count(*) from documents_divers)), ((select count(*) from dossier_permanent)),
    ((select count(*) from revision_justifications)), ((select count(*) from revision_preuves)),
    ((select count(*) from cabinet_admins)), ((select count(*) from dossier_assignations)), ((select count(*) from memberships))
  ) as t(n);

  -- Une étape : {genre, contrôle, qui, requête, code attendu, message attendu (motif LIKE) ou valeur attendue}.
  etapes := array[
    -- ══ Le jeu : deux dossiers jetables du cabinet du dossier test, un cabinet jetable, des pièces et des documents ══
    array['jeu', 'dossiers jetables', 'postgres', $q$insert into dossiers (id, nom, cabinet_id) values ('{T}', 'ESSAI DOSSIER PERMANENT T', '{CAB}'), ('{A}', 'ESSAI DOSSIER PERMANENT A', '{CAB}')$q$, '', ''],
    array['jeu', 'un cabinet jetable', 'postgres', $q$insert into cabinets (id, nom) values ('{CJ}', 'ESSAI DOSSIER PERMANENT CABINET J')$q$, '', ''],
    array['jeu', 'son dossier', 'postgres', $q$insert into dossiers (id, nom, cabinet_id) values ('{J}', 'ESSAI DOSSIER PERMANENT J', '{CJ}')$q$, '', ''],
    -- P1 porte une empreinte, P2 aucune, P3 une empreinte en majuscules (que la base ne recopie pas), P4 n'est jamais
    -- citée ; PX est de A, PC du dossier du client, PJ de J.
    array['jeu', 'pièces', 'postgres', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, storage_hash) values
      ('{P1}', '{T}', '{T}/essai-r7-p1.pdf', 'essai-r7-p1.pdf', 'achat', '{H1}'),
      ('{P2}', '{T}', '{T}/essai-r7-p2.pdf', 'essai-r7-p2.pdf', 'achat', null),
      ('{P3}', '{T}', '{T}/essai-r7-p3.pdf', 'essai-r7-p3.pdf', 'achat', '{HMAJ}'),
      ('{P4}', '{T}', '{T}/essai-r7-p4.pdf', 'essai-r7-p4.pdf', 'achat', null),
      ('{PX}', '{A}', '{A}/essai-r7-px.pdf', 'essai-r7-px.pdf', 'achat', null),
      ('{PC}', '{DC}', '{DC}/essai-r7-pc.pdf', 'essai-r7-pc.pdf', 'achat', null),
      ('{PJ}', '{J}', '{J}/essai-r7-pj.pdf', 'essai-r7-pj.pdf', 'achat', null)$q$, '', ''],
    array['jeu', 'documents', 'postgres', $q$insert into documents_divers (id, dossier_id, storage_path, nom_fichier, categorie, storage_hash) values
      ('{D1}', '{T}', '{T}/essai-r7-d1.pdf', 'essai-r7-d1.pdf', 'autre', '{H2}'),
      ('{D2}', '{T}', '{T}/essai-r7-d2.pdf', 'essai-r7-d2.pdf', 'autre', null),
      ('{DX}', '{A}', '{A}/essai-r7-dx.pdf', 'essai-r7-dx.pdf', 'autre', null),
      ('{DD}', '{DC}', '{DC}/essai-r7-dd.pdf', 'essai-r7-dd.pdf', 'autre', null)$q$, '', ''],
    -- Une décision de la révision d'un solde (étape R1), posée en direct par le propriétaire, qui cite P2 : la révision
    -- d'un solde se dit avant le dossier permanent.
    array['jeu', 'une décision de la révision qui cite P2', 'postgres', $q$insert into revision_justifications (id, dossier_id, annee, compte, solde, etat, motif, portee, auteur) values ('{RJ}', '{T}', 2025, '512000', 0, 'accepte', 'Essai.', 'exercice', '{CHEF}'); insert into revision_preuves (dossier_id, justification_id, piece_id) values ('{T}', '{RJ}', '{P2}')$q$, '', ''],

    -- ══ 1 à 9. Qui consigne ══════════
    array['controle', '1. anonyme : pas le droit d''appeler', 'anon', $q$select consigner_au_dossier_permanent('{T}', 'description', 'Description', 'Texte.', null, null, null, null)$q$,
      '42501', 'permission denied for function consigner_au_dossier_permanent'],
    array['controle', '2. rattaché à rien : l''accès au dossier, avant de rien lire', 'inconnu', $q$select consigner_au_dossier_permanent('{T}', 'description', 'Description', 'Texte.', null, null, null, null)$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '3. client, le dossier d''un autre', 'client', $q$select consigner_au_dossier_permanent('{T}', 'description', 'Description', 'Texte.', null, null, null, null)$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '4. client, son propre dossier', 'client', $q$select consigner_au_dossier_permanent('{DC}', 'description', 'Description', 'Texte.', null, null, null, null)$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '5. membre du cabinet affecté à un AUTRE dossier', 'membre_ailleurs', $q$select consigner_au_dossier_permanent('{T}', 'description', 'Description', 'Texte.', null, null, null, null)$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '6. un dossier qui n''existe pas, même pour le super-administrateur', 'chef', $q$select consigner_au_dossier_permanent('{AUTRE}', 'description', 'Description', 'Texte.', null, null, null, null)$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '7. le membre affecté au dossier consigne (hypothèse Q2)', 'membre', $q$select consigner_au_dossier_permanent('{T}', 'description', 'Description', 'Texte.', null, null, null, null)$q$, 'OK', ''],
    array['controle', '8. un chef qui n''est pas super-administrateur, dans son cabinet', 'chef_simple', $q$select consigner_au_dossier_permanent('{T}', 'description', 'Description', 'Texte.', null, null, null, null)$q$, 'OK', ''],
    array['controle', '9. le même, hors de son cabinet', 'chef_simple', $q$select consigner_au_dossier_permanent('{J}', 'description', 'Description', 'Texte.', null, null, null, null)$q$,
      '42501', 'Accès refusé à ce dossier.'],

    -- ══ 10 à 14. La nature ══════════
    array['controle', '10. une nature absente', 'chef', $q$select consigner_au_dossier_permanent('{T}', null, 'Titre', 'Texte.', null, null, null, null)$q$,
      '22023', 'Une entrée du dossier permanent est la lettre de mission, la description de l''entité, son organisation comptable, ses statuts, un bail, un contrat d''emprunt, un autre contrat, ou autre chose.'],
    array['controle', '11. une nature inconnue', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'contrat_de_travail', 'Titre', 'Texte.', null, null, null, null)$q$,
      '22023', 'Une entrée du dossier permanent est la lettre de mission, la description de l''entité, son organisation comptable, ses statuts, un bail, un contrat d''emprunt, un autre contrat, ou autre chose.'],
    array['controle', '12. une nature à la casse près', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'Bail', 'Titre', 'Texte.', null, null, null, null)$q$,
      '22023', 'Une entrée du dossier permanent est la lettre de mission, la description de l''entité, son organisation comptable, ses statuts, un bail, un contrat d''emprunt, un autre contrat, ou autre chose.'],
    array['controle', '13. une nature à une espace près', 'chef', $q$select consigner_au_dossier_permanent('{T}', ' bail', 'Titre', 'Texte.', null, null, null, null)$q$,
      '22023', 'Une entrée du dossier permanent est la lettre de mission, la description de l''entité, son organisation comptable, ses statuts, un bail, un contrat d''emprunt, un autre contrat, ou autre chose.'],
    array['controle', '14. les huit natures', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'lettre_mission', 'N1', 'Texte.', null, null, null, null), consigner_au_dossier_permanent('{T}', 'description', 'N2', 'Texte.', null, null, null, null), consigner_au_dossier_permanent('{T}', 'organisation_comptable', 'N3', 'Texte.', null, null, null, null), consigner_au_dossier_permanent('{T}', 'statuts', 'N4', 'Texte.', null, null, null, null), consigner_au_dossier_permanent('{T}', 'bail', 'N5', 'Texte.', null, null, null, null), consigner_au_dossier_permanent('{T}', 'contrat_emprunt', 'N6', 'Texte.', null, null, null, null), consigner_au_dossier_permanent('{T}', 'contrat', 'N7', 'Texte.', null, null, null, null), consigner_au_dossier_permanent('{T}', 'autre', 'N8', 'Texte.', null, null, null, null)$q$, 'OK', ''],

    -- ══ 15 à 21. Le titre ══════════
    array['controle', '15. un titre absent', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'description', null, 'Texte.', null, null, null, null)$q$,
      '22023', 'Une entrée du dossier permanent porte un titre.'],
    array['controle', '16. un titre vide', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'description', '', 'Texte.', null, null, null, null)$q$,
      '22023', 'Une entrée du dossier permanent porte un titre.'],
    array['controle', '17. un titre fait de blancs', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'description', '{BLANCS}', 'Texte.', null, null, null, null)$q$,
      '22023', 'Une entrée du dossier permanent porte un titre.'],
    array['controle', '18. une espace insécable n''est pas un blanc pour la base', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'description', '{NBSP}', 'Texte.', null, null, null, null)$q$, 'OK', ''],
    array['controle', '19. un titre de 500 caractères', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'description', repeat('t', 500), 'Texte.', null, null, null, null)$q$, 'OK', ''],
    array['controle', '19b. de 501', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'description', repeat('t', 501), 'Texte.', null, null, null, null)$q$,
      '22023', 'Un titre tient en 500 caractères au plus.'],
    array['controle', '20. 500 caractères qui font 1 000 octets', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'description', '{E500}', 'Texte.', null, null, null, null)$q$, 'OK', ''],
    array['controle', '20b. 501 caractères', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'description', '{E501}', 'Texte.', null, null, null, null)$q$,
      '22023', 'Un titre tient en 500 caractères au plus.'],

    -- ══ 22 à 27. Le texte ══════════
    array['controle', '22. un texte fait de blancs', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'description', 'Titre', '{BLANCS}', '{"document_id": "{D1}"}'::jsonb, null, null, null)$q$,
      '22023', 'Un texte ne se compose pas que de blancs : le laisser vide.'],
    array['controle', '23. un texte vide', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'description', 'Titre', '', '{"document_id": "{D1}"}'::jsonb, null, null, null)$q$,
      '22023', 'Un texte ne se compose pas que de blancs : le laisser vide.'],
    array['controle', '24. un texte de 8 000 caractères', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'description', 'Titre', repeat('t', 8000), null, null, null, null)$q$, 'OK', ''],
    array['controle', '24b. de 8 001', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'description', 'Titre', repeat('t', 8001), null, null, null, null)$q$,
      '22023', 'Un texte tient en 8 000 caractères au plus.'],
    array['controle', '25. 8 000 caractères qui font 16 000 octets', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'description', 'Titre', '{E8000}', null, null, null, null)$q$, 'OK', ''],
    array['controle', '25b. 8 001 caractères', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'description', 'Titre', '{E8001}', null, null, null, null)$q$,
      '22023', 'Un texte tient en 8 000 caractères au plus.'],
    array['controle', '26. un texte d''une espace insécable', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'description', 'Titre', '{NBSP}', null, null, null, null)$q$, 'OK', ''],
    array['controle', '27. aucun texte, la citation suffit', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'description', 'Titre', null, '{"document_id": "{D1}"}'::jsonb, null, null, null)$q$, 'OK', ''],

    -- ══ 28 à 44. La citation ══════════
    array['controle', '28. une liste', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'Titre', 'Texte.', '[]'::jsonb, null, null, null)$q$,
      '22023', 'La citation est illisible : une pièce ou un document du dossier, désigné par son identifiant.'],
    array['controle', '29. un identifiant seul, sans sa clé', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'Titre', 'Texte.', '"{P1}"'::jsonb, null, null, null)$q$,
      '22023', 'La citation est illisible : une pièce ou un document du dossier, désigné par son identifiant.'],
    array['controle', '30. un nombre', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'Titre', 'Texte.', '1'::jsonb, null, null, null)$q$,
      '22023', 'La citation est illisible : une pièce ou un document du dossier, désigné par son identifiant.'],
    array['controle', '31. un booléen', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'Titre', 'Texte.', 'true'::jsonb, null, null, null)$q$,
      '22023', 'La citation est illisible : une pièce ou un document du dossier, désigné par son identifiant.'],
    array['controle', '32. un objet vide', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'Titre', 'Texte.', '{}'::jsonb, null, null, null)$q$,
      '22023', 'La citation est illisible : une pièce ou un document du dossier, désigné par son identifiant.'],
    array['controle', '33. une pièce ET un document : au plus une citation', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'Titre', 'Texte.', '{"piece_id": "{P1}", "document_id": "{D1}"}'::jsonb, null, null, null)$q$,
      '22023', 'La citation est illisible : une pièce ou un document du dossier, désigné par son identifiant.'],
    array['controle', '34. un fichier du cabinet attend l''étape R8', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'Titre', 'Texte.', '{"fichier_id": "{P1}"}'::jsonb, null, null, null)$q$,
      '22023', 'La citation est illisible : une pièce ou un document du dossier, désigné par son identifiant.'],
    array['controle', '35. une clé inconnue', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'Titre', 'Texte.', '{"piece": "{P1}"}'::jsonb, null, null, null)$q$,
      '22023', 'La citation est illisible : une pièce ou un document du dossier, désigné par son identifiant.'],
    array['controle', '36. un identifiant nul', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'Titre', 'Texte.', '{"piece_id": null}'::jsonb, null, null, null)$q$,
      '22023', 'La citation est illisible : une pièce ou un document du dossier, désigné par son identifiant.'],
    array['controle', '37. un identifiant en nombre', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'Titre', 'Texte.', '{"piece_id": 12}'::jsonb, null, null, null)$q$,
      '22023', 'La citation est illisible : une pièce ou un document du dossier, désigné par son identifiant.'],
    array['controle', '38. un texte qui n''est pas un identifiant', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'Titre', 'Texte.', '{"piece_id": "pas-un-identifiant"}'::jsonb, null, null, null)$q$,
      '22023', 'La citation est illisible : une pièce ou un document du dossier, désigné par son identifiant.'],
    array['controle', '39. un identifiant dans une liste', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'Titre', 'Texte.', '{"piece_id": ["{P1}"]}'::jsonb, null, null, null)$q$,
      '22023', 'La citation est illisible : une pièce ou un document du dossier, désigné par son identifiant.'],
    array['controle', '40. un identifiant dans un objet', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'Titre', 'Texte.', '{"piece_id": {"id": "{P1}"}}'::jsonb, null, null, null)$q$,
      '22023', 'La citation est illisible : une pièce ou un document du dossier, désigné par son identifiant.'],
    array['controle', '41. un identifiant précédé d''une espace', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'Titre', 'Texte.', '{"document_id": " {D1}"}'::jsonb, null, null, null)$q$,
      '22023', 'La citation est illisible : une pièce ou un document du dossier, désigné par son identifiant.'],
    array['controle', '42. le JSON null : aucune citation', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'Titre', 'Texte.', 'null'::jsonb, null, null, null)$q$, 'OK', ''],
    array['controle', '43. un identifiant en majuscules', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'Titre', 'Texte.', '{"piece_id": "{P1U}"}'::jsonb, null, null, null)$q$, 'OK', ''],
    array['controle', '44. un document, sans texte', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'Titre', null, '{"document_id": "{D1}"}'::jsonb, null, null, null)$q$, 'OK', ''],

    -- ══ 45 et 46. Une entrée dit quelque chose ══════════
    array['controle', '45. ni texte ni citation', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'description', 'Titre', null, null, null, null, null)$q$,
      '22023', 'Une entrée du dossier permanent dit quelque chose : un texte, ou la pièce ou le document qu''elle cite.'],
    array['controle', '46. ni texte, et le JSON null', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'description', 'Titre', null, 'null'::jsonb, null, null, null)$q$,
      '22023', 'Une entrée du dossier permanent dit quelque chose : un texte, ou la pièce ou le document qu''elle cite.'],

    -- ══ 47 à 55. La validité ══════════
    array['controle', '47. un début avant 1900', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'statuts', 'Titre', 'Texte.', null, '1899-12-31', null, null)$q$,
      '22023', 'Une date de validité est comprise entre 1900 et 2100.'],
    array['controle', '48. le 1er janvier 1900', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'statuts', 'Titre', 'Texte.', null, '1900-01-01', null, null)$q$, 'OK', ''],
    array['controle', '49. une fin après 2100', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'statuts', 'Titre', 'Texte.', null, null, '2101-01-01', null)$q$,
      '22023', 'Une date de validité est comprise entre 1900 et 2100.'],
    array['controle', '50. le 31 décembre 2100', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'statuts', 'Titre', 'Texte.', null, null, '2100-12-31', null)$q$, 'OK', ''],
    array['controle', '51. une fin qui précède le début', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'statuts', 'Titre', 'Texte.', null, '2026-01-02', '2026-01-01', null)$q$,
      '22023', 'La fin de validité précède son début.'],
    array['controle', '52. un seul jour', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'statuts', 'Titre', 'Texte.', null, '2026-01-01', '2026-01-01', null)$q$, 'OK', ''],
    array['controle', '53. une borne seule, l''une puis l''autre', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'statuts', 'Titre', 'Texte.', null, null, '2026-12-31', null), consigner_au_dossier_permanent('{T}', 'statuts', 'Titre', 'Texte.', null, '2026-01-01', null, null)$q$, 'OK', ''],
    array['controle', '54. un début après 2100', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'statuts', 'Titre', 'Texte.', null, '2101-01-01', null, null)$q$,
      '22023', 'Une date de validité est comprise entre 1900 et 2100.'],
    array['controle', '55. une fin avant 1900', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'statuts', 'Titre', 'Texte.', null, null, '1899-12-31', null)$q$,
      '22023', 'Une date de validité est comprise entre 1900 et 2100.'],

    -- ══ 56 à 61. La source citée est du dossier ══════════
    array['controle', '56. une pièce d''un autre dossier du cabinet', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'Titre', 'Texte.', '{"piece_id": "{PX}"}'::jsonb, null, null, null)$q$,
      '22023', 'La pièce ou le document cité n''est pas de ce dossier.'],
    array['controle', '57. un document d''un autre dossier', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'Titre', 'Texte.', '{"document_id": "{DX}"}'::jsonb, null, null, null)$q$,
      '22023', 'La pièce ou le document cité n''est pas de ce dossier.'],
    array['controle', '58. une pièce du dossier du client', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'Titre', 'Texte.', '{"piece_id": "{PC}"}'::jsonb, null, null, null)$q$,
      '22023', 'La pièce ou le document cité n''est pas de ce dossier.'],
    array['controle', '59. une pièce qui n''existe pas', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'Titre', 'Texte.', '{"piece_id": "{ABSENT}"}'::jsonb, null, null, null)$q$,
      '22023', 'La pièce ou le document cité n''est pas de ce dossier.'],
    array['controle', '60. une pièce désignée comme un document', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'Titre', 'Texte.', '{"document_id": "{P1}"}'::jsonb, null, null, null)$q$,
      '22023', 'La pièce ou le document cité n''est pas de ce dossier.'],
    array['controle', '61. un document désigné comme une pièce', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'Titre', 'Texte.', '{"piece_id": "{D1}"}'::jsonb, null, null, null)$q$,
      '22023', 'La pièce ou le document cité n''est pas de ce dossier.'],

    -- ══ 62 à 89. Ce qui s'écrit : les entrées, la chaîne des versions, le retrait ══════════
    array['fait', '62. la lettre de mission de T, qui cite D1', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'lettre_mission', 'Lettre de mission', 'Présentation des comptes annuels.', '{"document_id": "{D1}"}'::jsonb, '2026-01-01', null, null)$q$, 'OK', ''],
    array['retenir', 'E1', 'postgres', $q$select id::text from dossier_permanent where dossier_id = '{T}' and titre = 'Lettre de mission'$q$, '', ''],
    array['valeur', '63. ce qui s''est écrit : la nature, le texte, la citation, l''empreinte de D1 recopiée, la validité, l''auteur', 'postgres', $q$select nature || ':' || (texte = 'Présentation des comptes annuels.')::text || ':' || (piece_id is null)::text || ':' || (document_id = '{D1}')::text || ':' || (fichier_id is null)::text || ':' || (empreinte = '{H2}')::text || ':' || valable_du::text || ':' || (valable_jusqu_au is null)::text || ':' || (remplace_id is null)::text || ':' || (auteur = '{CHEF}')::text || ':' || (cree_le is not null)::text || ':' || (retire_le is null and retire_par is null)::text from dossier_permanent where id = '{E1}'$q$, '',
      'lettre_mission:true:true:true:true:true:2026-01-01:true:true:true:true:true'],
    array['fait', '64. la description de T, un texte seul', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'description', 'Description de l''entité', 'Cabinet libéral.', null, null, null, null)$q$, 'OK', ''],
    array['retenir', 'E2', 'postgres', $q$select id::text from dossier_permanent where dossier_id = '{T}' and titre = 'Description de l''entité'$q$, '', ''],
    array['fait', '65. un bail qui cite P1', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'Bail', null, '{"piece_id": "{P1}"}'::jsonb, '2024-07-01', '2033-06-30', null)$q$, 'OK', ''],
    array['retenir', 'E3', 'postgres', $q$select id::text from dossier_permanent where dossier_id = '{T}' and titre = 'Bail'$q$, '', ''],
    array['valeur', '66. le bail : la pièce, son empreinte recopiée, aucun texte', 'postgres', $q$select (piece_id = '{P1}')::text || ':' || (empreinte = '{H1}')::text || ':' || (texte is null)::text || ':' || valable_du::text || ':' || valable_jusqu_au::text from dossier_permanent where id = '{E3}'$q$, '',
      'true:true:true:2024-07-01:2033-06-30'],
    array['fait', '67. un contrat qui cite P3, un contrat d''emprunt qui cite P2', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'contrat', 'Contrat de maintenance', null, '{"piece_id": "{P3}"}'::jsonb, null, null, null), consigner_au_dossier_permanent('{T}', 'contrat_emprunt', 'Contrat d''emprunt', 'Prêt du véhicule.', '{"piece_id": "{P2}"}'::jsonb, null, null, null)$q$, 'OK', ''],
    array['retenir', 'E4', 'postgres', $q$select id::text from dossier_permanent where dossier_id = '{T}' and titre = 'Contrat de maintenance'$q$, '', ''],
    array['retenir', 'E5', 'postgres', $q$select id::text from dossier_permanent where dossier_id = '{T}' and titre = 'Contrat d''emprunt'$q$, '', ''],
    array['valeur', '68. une empreinte en majuscules, ou aucune : rien de recopié', 'postgres', $q$select string_agg(titre || ':' || coalesce(empreinte, '∅'), ',' order by titre collate "C") from dossier_permanent where id in ('{E4}', '{E5}')$q$, '',
      'Contrat d''emprunt:∅,Contrat de maintenance:∅'],
    array['fait', '69. une nouvelle version de la lettre de mission, qui cite D2', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'lettre_mission', 'Lettre de mission', 'Présentation des comptes annuels, avec attestation.', '{"document_id": "{D2}"}'::jsonb, '2026-01-01', null, '{E1}')$q$, 'OK', ''],
    array['retenir', 'E1B', 'postgres', $q$select id::text from dossier_permanent where remplace_id = '{E1}'$q$, '', ''],
    array['valeur', '70. la chaîne : la nouvelle version remplace l''ancienne, qui reste telle quelle', 'postgres', $q$select (select count(*) from dossier_permanent where dossier_id = '{T}' and titre = 'Lettre de mission')::text || ':' || (select (document_id = '{D2}' and empreinte is null and remplace_id = '{E1}')::text from dossier_permanent where id = '{E1B}') || ':' || (select (document_id = '{D1}' and retire_le is null)::text from dossier_permanent where id = '{E1}')$q$, '',
      '2:true:true'],
    array['controle', '71. remplacer de nouveau l''ancienne version', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'lettre_mission', 'Lettre de mission', 'Encore.', null, null, null, '{E1}')$q$,
      '22023', 'Cette entrée a été remplacée depuis : relire avant de la remplacer.'],
    array['controle', '72. remplacer la version courante', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'lettre_mission', 'Lettre de mission', 'Encore.', null, null, null, '{E1B}')$q$, 'OK', ''],
    array['controle', '72b. une nouvelle version peut changer de nature', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'contrat', 'Lettre de mission', 'Encore.', null, null, null, '{E1B}')$q$, 'OK', ''],
    array['fait', '73. le bail se retire', 'chef', $q$select retirer_du_dossier_permanent('{T}', '{E3}')$q$, 'OK', ''],
    array['valeur', '74. le retrait : qui, quand ; rien d''autre ne change', 'postgres', $q$select (retire_le is not null)::text || ':' || (retire_par = '{CHEF}')::text || ':' || (piece_id = '{P1}' and empreinte = '{H1}' and titre = 'Bail')::text from dossier_permanent where id = '{E3}'$q$, '',
      'true:true:true'],
    array['controle', '75. une entrée retirée ne se remplace plus', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'Bail', 'Renouvelé.', null, null, null, '{E3}')$q$,
      '22023', 'Cette entrée est retirée : elle ne se remplace plus, une nouvelle entrée se consigne.'],
    array['controle', '76. ni ne se retire une seconde fois', 'chef', $q$select retirer_du_dossier_permanent('{T}', '{E3}')$q$,
      '22023', 'Cette entrée est déjà retirée.'],
    array['controle', '77. une version remplacée ne se retire pas : la courante seule', 'chef', $q$select retirer_du_dossier_permanent('{T}', '{E1}')$q$,
      '22023', 'Cette entrée a été remplacée depuis : relire avant de la retirer.'],
    array['controle', '77b. la courante, si', 'chef', $q$select retirer_du_dossier_permanent('{T}', '{E1B}')$q$, 'OK', ''],
    array['fait', '78. une entrée de A', 'chef', $q$select consigner_au_dossier_permanent('{A}', 'description', 'Entrée de A', 'Autre dossier.', null, null, null, null)$q$, 'OK', ''],
    array['retenir', 'EA', 'postgres', $q$select id::text from dossier_permanent where dossier_id = '{A}' and titre = 'Entrée de A'$q$, '', ''],
    array['controle', '79. remplacer depuis T une entrée de A', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'description', 'Entrée de A', 'Texte.', null, null, null, '{EA}')$q$,
      '22023', 'L''entrée à remplacer n''est pas une entrée du dossier permanent de ce dossier.'],
    array['controle', '80. remplacer une entrée qui n''existe pas', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'description', 'Titre', 'Texte.', null, null, null, '{ABSENT}')$q$,
      '22023', 'L''entrée à remplacer n''est pas une entrée du dossier permanent de ce dossier.'],
    array['controle', '81. retirer depuis T une entrée de A', 'chef', $q$select retirer_du_dossier_permanent('{T}', '{EA}')$q$,
      'P0002', 'Entrée introuvable dans ce dossier.'],
    array['controle', '82. retirer une entrée qui n''existe pas', 'chef', $q$select retirer_du_dossier_permanent('{T}', '{ABSENT}')$q$,
      'P0002', 'Entrée introuvable dans ce dossier.'],
    array['controle', '83. retirer sans dire quoi', 'chef', $q$select retirer_du_dossier_permanent('{T}', null)$q$,
      'P0002', 'Entrée introuvable dans ce dossier.'],
    array['controle', '84. le membre affecté retire dans son dossier (hypothèse Q2)', 'membre', $q$select retirer_du_dossier_permanent('{T}', '{E1B}')$q$, 'OK', ''],
    array['controle', '85. pas dans un dossier qui ne lui est pas confié', 'membre', $q$select retirer_du_dossier_permanent('{A}', '{EA}')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '85b. l''accès se juge avant l''entrée : une entrée d''ailleurs ne se devine pas', 'membre_ailleurs', $q$select retirer_du_dossier_permanent('{T}', '{ABSENT}')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '85c. retirer, pour l''anonyme : pas le droit d''appeler', 'anon', $q$select retirer_du_dossier_permanent('{T}', '{E2}')$q$,
      '42501', 'permission denied for function retirer_du_dossier_permanent'],
    array['controle', '85d. ni dans un dossier qui n''existe pas, même pour le super-administrateur', 'chef', $q$select retirer_du_dossier_permanent('{AUTRE}', '{E2}')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['lecture', '86. le membre affecté est l''auteur de ce qu''il consigne', 'membre', $q$select ((consigner_au_dossier_permanent('{T}', 'autre', 'Note', 'Texte.', null, null, null, null)).auteur = '{CLIENT}')::text$q$, '', 'true'],
    array['lecture', '87. et l''auteur du retrait', 'membre', $q$select ((retirer_du_dossier_permanent('{T}', '{E2}')).retire_par = '{CLIENT}')::text$q$, '', 'true'],
    array['lecture', '88. la fonction rend l''entrée écrite', 'chef', $q$select (consigner_au_dossier_permanent('{T}', 'autre', 'Rendue', 'Texte.', null, '2026-03-01', null, null)).titre$q$, '', 'Rendue'],
    array['valeur', '89. les entrées de T : six, dont une retirée et une version qui en remplace une', 'postgres', $q$select count(*)::text || ':' || count(*) filter (where retire_le is not null)::text || ':' || count(*) filter (where remplace_id is not null)::text from dossier_permanent where dossier_id = '{T}'$q$, '',
      '6:1:1'],

    -- ══ 90 à 99. L'ordre des refus, par paires de refus voisins ══════════
    array['controle', '90. l''accès avant la nature', 'membre_ailleurs', $q$select consigner_au_dossier_permanent('{T}', null, null, null, null, null, null, null)$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '91. la nature avant le titre', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'x', null, 'Texte.', null, null, null, null)$q$,
      '22023', 'Une entrée du dossier permanent est la lettre de mission, la description de l''entité, son organisation comptable, ses statuts, un bail, un contrat d''emprunt, un autre contrat, ou autre chose.'],
    array['controle', '92. le titre avant le texte', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', '{BLANCS}', '{BLANCS}', null, null, null, null)$q$,
      '22023', 'Une entrée du dossier permanent porte un titre.'],
    array['controle', '93. un titre trop long avant un texte trop long', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', repeat('t', 501), repeat('t', 8001), null, null, null, null)$q$,
      '22023', 'Un titre tient en 500 caractères au plus.'],
    array['controle', '94. le texte avant la citation', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'Titre', '{BLANCS}', '[]'::jsonb, null, null, null)$q$,
      '22023', 'Un texte ne se compose pas que de blancs : le laisser vide.'],
    array['controle', '95. un texte trop long avant la citation', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'Titre', repeat('t', 8001), '{}'::jsonb, null, null, null)$q$,
      '22023', 'Un texte tient en 8 000 caractères au plus.'],
    array['controle', '96. la citation avant la validité', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'Titre', null, '[]'::jsonb, '1899-12-31', null, null)$q$,
      '22023', 'La citation est illisible : une pièce ou un document du dossier, désigné par son identifiant.'],
    array['controle', '97. une entrée qui ne dit rien, avant la validité', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'Titre', null, null, '2101-01-01', '1899-12-31', null)$q$,
      '22023', 'Une entrée du dossier permanent dit quelque chose : un texte, ou la pièce ou le document qu''elle cite.'],
    array['controle', '98. la validité avant le remplacement', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'Titre', 'Texte.', null, '2026-02-01', '2026-01-01', '{EA}')$q$,
      '22023', 'La fin de validité précède son début.'],
    array['controle', '99. le remplacement avant la source', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'Titre', 'Texte.', '{"piece_id": "{PX}"}'::jsonb, null, null, '{E1}')$q$,
      '22023', 'Cette entrée a été remplacée depuis : relire avant de la remplacer.'],
    array['controle', '99b. une entrée retirée, avant la source', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'Titre', 'Texte.', '{"piece_id": "{PX}"}'::jsonb, null, null, '{E3}')$q$,
      '22023', 'Cette entrée est retirée : elle ne se remplace plus, une nouvelle entrée se consigne.'],
    array['controle', '99c. une entrée d''ailleurs, avant la source', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'Titre', 'Texte.', '{"piece_id": "{PX}"}'::jsonb, null, null, '{EA}')$q$,
      '22023', 'L''entrée à remplacer n''est pas une entrée du dossier permanent de ce dossier.'],

    -- ══ 100 à 127. La garde et les contraintes, sans les fonctions ══════════
    array['controle', '100. un membre affecté n''insère pas en direct', 'membre', $q$insert into dossier_permanent (dossier_id, nature, titre, texte, auteur) values ('{T}', 'autre', 'En direct', 'Texte.', '{CLIENT}')$q$,
      '42501', 'new row violates row-level security policy for table "dossier_permanent"'],
    array['controle', '100b. ni un chef qui n''est pas super-administrateur', 'chef_simple', $q$insert into dossier_permanent (dossier_id, nature, titre, texte, auteur) values ('{T}', 'autre', 'En direct', 'Texte.', '{CLIENT}')$q$,
      '42501', 'new row violates row-level security policy for table "dossier_permanent"'],
    array['controle', '101. le super-administrateur réinsère (la restauration), une citation et son empreinte comprises', 'chef', $q$insert into dossier_permanent (dossier_id, nature, titre, texte, piece_id, empreinte, auteur) values ('{T}', 'bail', 'Restauré', null, '{P1}', '{H1}', '{CHEF}')$q$, 'OK', ''],
    array['controle', '101b. une entrée retirée, telle qu''elle a été retirée', 'chef', $q$insert into dossier_permanent (dossier_id, nature, titre, document_id, auteur, retire_le, retire_par) values ('{T}', 'contrat', 'Restauré', '{D1}', '{CHEF}', now(), '{CHEF}')$q$, 'OK', ''],
    array['controle', '101c. une version qui remplace la courante', 'chef', $q$insert into dossier_permanent (dossier_id, nature, titre, texte, remplace_id, auteur) values ('{T}', 'description', 'Restauré', 'Texte.', '{E5}', '{CHEF}')$q$, 'OK', ''],
    array['controle', '102. jamais une entrée qui cite une pièce d''un autre dossier', 'chef', $q$insert into dossier_permanent (dossier_id, nature, titre, piece_id, auteur) values ('{T}', 'bail', 'Restauré', '{PX}', '{CHEF}')$q$,
      '23514', 'Une entrée du dossier permanent cite une pièce de son dossier.'],
    array['controle', '103. ni un document d''un autre dossier', 'chef', $q$insert into dossier_permanent (dossier_id, nature, titre, document_id, auteur) values ('{T}', 'bail', 'Restauré', '{DX}', '{CHEF}')$q$,
      '23514', 'Une entrée du dossier permanent cite un document de son dossier.'],
    array['controle', '104. ni un fichier du cabinet, avant l''étape R8', 'chef', $q$insert into dossier_permanent (dossier_id, nature, titre, fichier_id, auteur) values ('{T}', 'bail', 'Restauré', '{P1}', '{CHEF}')$q$,
      '23514', 'Un fichier du cabinet ne se cite pas encore : une entrée cite une pièce ou un document du dossier.'],
    array['controle', '105. ni une version d''une entrée d''un autre dossier', 'chef', $q$insert into dossier_permanent (dossier_id, nature, titre, texte, remplace_id, auteur) values ('{T}', 'description', 'Restauré', 'Texte.', '{EA}', '{CHEF}')$q$,
      '23514', 'Une entrée du dossier permanent en remplace une de son dossier.'],
    array['controle', '106. ni une version d''une entrée retirée', 'chef', $q$insert into dossier_permanent (dossier_id, nature, titre, texte, remplace_id, auteur) values ('{T}', 'bail', 'Restauré', 'Texte.', '{E3}', '{CHEF}')$q$,
      '23514', 'Une entrée retirée du dossier permanent ne se remplace plus.'],
    array['controle', '107. une seule suite à une version', 'chef', $q$insert into dossier_permanent (dossier_id, nature, titre, texte, remplace_id, auteur) values ('{T}', 'lettre_mission', 'Restauré', 'Texte.', '{E1}', '{CHEF}')$q$,
      '23505', '%"dossier_permanent_une_suite"%'],
    array['controle', '108. une pièce et un document : au plus une citation', 'postgres', $q$insert into dossier_permanent (dossier_id, nature, titre, texte, piece_id, document_id, auteur) values ('{T}', 'bail', 'Direct', 'Texte.', '{P1}', '{D1}', '{CHEF}')$q$,
      '23514', '%"dossier_permanent_une_citation"%'],
    array['controle', '109. ni texte ni citation', 'postgres', $q$insert into dossier_permanent (dossier_id, nature, titre, auteur) values ('{T}', 'bail', 'Direct', '{CHEF}')$q$,
      '23514', '%"dossier_permanent_dit_quelque_chose"%'],
    array['controle', '110. une empreinte sans citation', 'postgres', $q$insert into dossier_permanent (dossier_id, nature, titre, texte, empreinte, auteur) values ('{T}', 'bail', 'Direct', 'Texte.', '{H1}', '{CHEF}')$q$,
      '23514', '%"dossier_permanent_empreinte_citee"%'],
    array['controle', '111. une empreinte en majuscules', 'postgres', $q$insert into dossier_permanent (dossier_id, nature, titre, piece_id, empreinte, auteur) values ('{T}', 'bail', 'Direct', '{P3}', '{HMAJ}', '{CHEF}')$q$,
      '23514', '%"dossier_permanent_empreinte"%'],
    array['controle', '112. une validité inversée', 'postgres', $q$insert into dossier_permanent (dossier_id, nature, titre, texte, valable_du, valable_jusqu_au, auteur) values ('{T}', 'bail', 'Direct', 'Texte.', '2026-02-01', '2026-01-01', '{CHEF}')$q$,
      '23514', '%"dossier_permanent_validite"%'],
    array['controle', '113. une nature inconnue', 'postgres', $q$insert into dossier_permanent (dossier_id, nature, titre, texte, auteur) values ('{T}', 'x', 'Direct', 'Texte.', '{CHEF}')$q$,
      '23514', '%"dossier_permanent_nature"%'],
    array['controle', '114. un titre fait de blancs', 'postgres', $q$insert into dossier_permanent (dossier_id, nature, titre, texte, auteur) values ('{T}', 'bail', '{BLANCS}', 'Texte.', '{CHEF}')$q$,
      '23514', '%"dossier_permanent_titre"%'],
    array['controle', '114b. un titre de 501 caractères', 'postgres', $q$insert into dossier_permanent (dossier_id, nature, titre, texte, auteur) values ('{T}', 'bail', repeat('t', 501), 'Texte.', '{CHEF}')$q$,
      '23514', '%"dossier_permanent_titre"%'],
    array['controle', '115. un texte fait de blancs', 'postgres', $q$insert into dossier_permanent (dossier_id, nature, titre, texte, auteur) values ('{T}', 'bail', 'Direct', '{BLANCS}', '{CHEF}')$q$,
      '23514', '%"dossier_permanent_texte"%'],
    array['controle', '115b. un texte de 8 001 caractères', 'postgres', $q$insert into dossier_permanent (dossier_id, nature, titre, texte, auteur) values ('{T}', 'bail', 'Direct', repeat('t', 8001), '{CHEF}')$q$,
      '23514', '%"dossier_permanent_texte"%'],
    array['controle', '116. un début avant 1900', 'postgres', $q$insert into dossier_permanent (dossier_id, nature, titre, texte, valable_du, auteur) values ('{T}', 'bail', 'Direct', 'Texte.', '1899-12-31', '{CHEF}')$q$,
      '23514', '%"dossier_permanent_valable_du"%'],
    array['controle', '116b. une fin après 2100', 'postgres', $q$insert into dossier_permanent (dossier_id, nature, titre, texte, valable_jusqu_au, auteur) values ('{T}', 'bail', 'Direct', 'Texte.', '2101-01-01', '{CHEF}')$q$,
      '23514', '%"dossier_permanent_valable_jusqu_au"%'],
    array['controle', '117. un retrait sans son auteur', 'postgres', $q$insert into dossier_permanent (dossier_id, nature, titre, texte, auteur, retire_le) values ('{T}', 'bail', 'Direct', 'Texte.', '{CHEF}', now())$q$,
      '23514', '%"dossier_permanent_retrait"%'],
    array['controle', '118. une entrée sans auteur', 'postgres', $q$insert into dossier_permanent (dossier_id, nature, titre, texte) values ('{T}', 'bail', 'Direct', 'Texte.')$q$,
      '23502', '%"auteur"%'],
    array['controle', '119. une entrée ne se modifie pas, même pour le propriétaire', 'postgres', $q$update dossier_permanent set titre = 'Changé' where id = '{E2}'$q$,
      '23514', 'Une entrée du dossier permanent ne se modifie pas : elle se remplace par une nouvelle, ou se retire, une fois.'],
    array['controle', '119b. ni par une mise à jour qui ne change rien', 'postgres', $q$update dossier_permanent set titre = titre where id = '{E2}'$q$,
      '23514', 'Une entrée du dossier permanent ne se modifie pas : elle se remplace par une nouvelle, ou se retire, une fois.'],
    array['controle', '120. un retrait ne se défait pas', 'postgres', $q$update dossier_permanent set retire_le = null, retire_par = null where id = '{E3}'$q$,
      '23514', 'Une entrée du dossier permanent ne se modifie pas : elle se remplace par une nouvelle, ou se retire, une fois.'],
    array['controle', '121. ni ne se redate', 'postgres', $q$update dossier_permanent set retire_le = retire_le + interval '1 day' where id = '{E3}'$q$,
      '23514', 'Une entrée du dossier permanent ne se modifie pas : elle se remplace par une nouvelle, ou se retire, une fois.'],
    array['controle', '122. un retrait qui change autre chose', 'postgres', $q$update dossier_permanent set retire_le = now(), retire_par = '{CHEF}', titre = 'Changé' where id = '{E2}'$q$,
      '23514', 'Une entrée du dossier permanent ne se modifie pas : elle se remplace par une nouvelle, ou se retire, une fois.'],
    array['controle', '123. une version remplacée ne se retire pas, même en direct', 'postgres', $q$update dossier_permanent set retire_le = now(), retire_par = '{CHEF}' where id = '{E1}'$q$,
      '23514', 'Seule la version courante d''une entrée du dossier permanent se retire.'],
    array['controle', '124. le retrait de la courante, en direct, passe la garde', 'postgres', $q$update dossier_permanent set retire_le = now(), retire_par = '{CHEF}' where id = '{E2}'$q$, 'OK', ''],
    array['controle', '125. un retrait sans son auteur', 'postgres', $q$update dossier_permanent set retire_le = now() where id = '{E2}'$q$,
      '23514', '%"dossier_permanent_retrait"%'],
    array['lecture', '126. sans policy de mise à jour, un membre affecté ne touche aucune ligne', 'membre', $q$with u as (update dossier_permanent set titre = 'Changé' where id = '{E2}' returning 1) select count(*)::text from u$q$, '', '0'],
    array['lecture', '127. ni le super-administrateur', 'chef', $q$with u as (update dossier_permanent set retire_le = now(), retire_par = '{CHEF}' where id = '{E2}' returning 1) select count(*)::text from u$q$, '', '0'],

    -- ══ 130 à 140. La source citée ne change plus de dossier (hypothèse Q8, la règle de l'étape R1) ══════════
    array['controle', '130. une pièce citée par une entrée RETIRÉE ne change pas de dossier', 'chef', $q$update pieces set dossier_id = '{A}' where id = '{P1}'$q$,
      '23514', 'Cette pièce est citée par le dossier permanent (bail) : elle ne change plus de dossier, sauf avec son dossier.'],
    array['controle', '131. un document cité par une version REMPLACÉE non plus', 'chef', $q$update documents_divers set dossier_id = '{A}' where id = '{D1}'$q$,
      '23514', 'Ce document est cité par le dossier permanent (lettre de mission) : il ne change plus de dossier, sauf avec son dossier.'],
    array['controle', '132. la révision d''un solde se dit d''abord, sous ses mots d''hier', 'chef', $q$update pieces set dossier_id = '{A}' where id = '{P2}'$q$,
      '23514', 'Cette pièce est citée par la révision du solde du compte 512000 (exercice 2025) : elle ne change plus de dossier, sauf avec son dossier.'],
    array['controle', '133. ni pour le propriétaire de la base', 'postgres', $q$update pieces set dossier_id = '{A}' where id = '{P3}'$q$,
      '23514', 'Cette pièce est citée par le dossier permanent (contrat) : elle ne change plus de dossier, sauf avec son dossier.'],
    array['controle', '134. la première nature dans l''ordre de A9', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'statuts', 'Statuts', null, '{"piece_id": "{P1}"}'::jsonb, null, null, null); update pieces set dossier_id = '{A}' where id = '{P1}'$q$,
      '23514', 'Cette pièce est citée par le dossier permanent (statuts) : elle ne change plus de dossier, sauf avec son dossier.'],
    array['controle', '135. un document cité par la version courante', 'chef', $q$update documents_divers set dossier_id = '{A}' where id = '{D2}'$q$,
      '23514', 'Ce document est cité par le dossier permanent (lettre de mission) : il ne change plus de dossier, sauf avec son dossier.'],
    array['controle', '136. une pièce qu''aucune entrée ne cite, si', 'chef', $q$update pieces set dossier_id = '{A}' where id = '{P4}'$q$, 'OK', ''],
    array['controle', '137. et le contenu d''une source citée reste libre', 'chef', $q$update pieces set date_piece = '2026-01-01', dossier_id = dossier_id where id = '{P1}'$q$, 'OK', ''],
    array['controle', '138a. chaque nature sous son libellé : la lettre de mission', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'lettre_mission', 'L', null, '{"piece_id": "{P4}"}'::jsonb, null, null, null); update pieces set dossier_id = '{A}' where id = '{P4}'$q$,
      '23514', 'Cette pièce est citée par le dossier permanent (lettre de mission) : elle ne change plus de dossier, sauf avec son dossier.'],
    array['controle', '138b. la description de l''entité', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'description', 'L', null, '{"piece_id": "{P4}"}'::jsonb, null, null, null); update pieces set dossier_id = '{A}' where id = '{P4}'$q$,
      '23514', 'Cette pièce est citée par le dossier permanent (description de l''entité) : elle ne change plus de dossier, sauf avec son dossier.'],
    array['controle', '138c. l''organisation comptable', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'organisation_comptable', 'L', null, '{"piece_id": "{P4}"}'::jsonb, null, null, null); update pieces set dossier_id = '{A}' where id = '{P4}'$q$,
      '23514', 'Cette pièce est citée par le dossier permanent (organisation comptable) : elle ne change plus de dossier, sauf avec son dossier.'],
    array['controle', '138d. les statuts', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'statuts', 'L', null, '{"piece_id": "{P4}"}'::jsonb, null, null, null); update pieces set dossier_id = '{A}' where id = '{P4}'$q$,
      '23514', 'Cette pièce est citée par le dossier permanent (statuts) : elle ne change plus de dossier, sauf avec son dossier.'],
    array['controle', '138e. un bail', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'bail', 'L', null, '{"piece_id": "{P4}"}'::jsonb, null, null, null); update pieces set dossier_id = '{A}' where id = '{P4}'$q$,
      '23514', 'Cette pièce est citée par le dossier permanent (bail) : elle ne change plus de dossier, sauf avec son dossier.'],
    array['controle', '138f. un contrat d''emprunt', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'contrat_emprunt', 'L', null, '{"piece_id": "{P4}"}'::jsonb, null, null, null); update pieces set dossier_id = '{A}' where id = '{P4}'$q$,
      '23514', 'Cette pièce est citée par le dossier permanent (contrat d''emprunt) : elle ne change plus de dossier, sauf avec son dossier.'],
    array['controle', '138g. un autre contrat', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'contrat', 'L', null, '{"piece_id": "{P4}"}'::jsonb, null, null, null); update pieces set dossier_id = '{A}' where id = '{P4}'$q$,
      '23514', 'Cette pièce est citée par le dossier permanent (contrat) : elle ne change plus de dossier, sauf avec son dossier.'],
    array['controle', '138h. autre chose', 'chef', $q$select consigner_au_dossier_permanent('{T}', 'autre', 'L', null, '{"piece_id": "{P4}"}'::jsonb, null, null, null); update pieces set dossier_id = '{A}' where id = '{P4}'$q$,
      '23514', 'Cette pièce est citée par le dossier permanent (autre document) : elle ne change plus de dossier, sauf avec son dossier.'],

    -- ══ 141 à 149. Qui lit ══════════
    array['fait', '141. le chef consigne dans le dossier du client — un texte, et une entrée qui cite un document du client — et dans J', 'chef', $q$select consigner_au_dossier_permanent('{DC}', 'description', 'Description du client', 'Texte.', null, null, null, null), consigner_au_dossier_permanent('{DC}', 'statuts', 'Statuts du client', null, '{"document_id": "{DD}"}'::jsonb, null, null, null), consigner_au_dossier_permanent('{J}', 'description', 'Description de J', 'Texte.', null, null, null, null)$q$, 'OK', ''],
    array['lecture', '142. le client ne lit aucune entrée, pas même celles de son dossier', 'client', $q$select count(*)::text from dossier_permanent$q$, '', '0'],
    array['lecture', '143. le compte rattaché à rien non plus', 'inconnu', $q$select count(*)::text from dossier_permanent$q$, '', '0'],
    array['lecture', '144. l''anonyme non plus', 'anon', $q$select count(*)::text from dossier_permanent$q$, '', '0'],
    array['lecture', '145. le membre affecté à T lit les entrées de T, et elles seules', 'membre', $q$select ((select count(*) from dossier_permanent where dossier_id = '{T}') > 0)::text || ':' || (select count(*) from dossier_permanent where dossier_id <> '{T}')::text$q$, '', 'true:0'],
    array['lecture', '146. le membre affecté à un autre dossier n''en lit aucune de T', 'membre_ailleurs', $q$select (select count(*) from dossier_permanent where dossier_id = '{T}')::text$q$, '', '0'],
    array['lecture', '147. un chef qui n''est pas super-administrateur lit celles de son cabinet, et elles seules', 'chef_simple', $q$select ((select count(*) from dossier_permanent where dossier_id = '{T}') > 0)::text || ':' || ((select count(*) from dossier_permanent where dossier_id = '{DC}') > 0)::text || ':' || (select count(*) from dossier_permanent where dossier_id = '{J}')::text$q$, '', 'true:true:0'],
    array['controle', '148. le client ne retire rien, pas même dans son dossier', 'client', $q$select retirer_du_dossier_permanent('{DC}', (select id from dossier_permanent where titre = 'Description du client'))$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['lecture', '149. le super-administrateur lit partout', 'chef', $q$select ((select count(*) from dossier_permanent where dossier_id = '{J}') > 0)::text$q$, '', 'true'],

    -- ══ 160 à 166. Les mutations : chacune rejoue un contrôle avec un profil faux, et doit MORDRE ══════════
    array['lecture', '160. MUTATION — le contrôle 142 sans le changement de rôle : il doit voir celles du dossier du client', 'postgres', $q$select ((select count(*) from dossier_permanent where dossier_id = '{DC}') > 0)::text$q$, '', 'true'],
    array['controle', '161. MUTATION — le contrôle 4 joué sous le chef : il doit passer', 'chef', $q$select consigner_au_dossier_permanent('{DC}', 'description', 'Description', 'Texte.', null, null, null, null)$q$, 'OK', ''],
    array['controle', '162. MUTATION — le contrôle 5 affecté au BON dossier : il doit passer', 'membre', $q$select consigner_au_dossier_permanent('{T}', 'description', 'Description', 'Texte.', null, null, null, null)$q$, 'OK', ''],
    array['controle', '163. MUTATION — le contrôle 9 joué sous le super-administrateur : il doit passer', 'chef', $q$select consigner_au_dossier_permanent('{J}', 'description', 'Description', 'Texte.', null, null, null, null)$q$, 'OK', ''],
    array['controle', '164. MUTATION — le contrôle 100 joué sous le super-administrateur : l''insertion doit passer', 'chef', $q$insert into dossier_permanent (dossier_id, nature, titre, texte, auteur) values ('{T}', 'autre', 'En direct', 'Texte.', '{CLIENT}')$q$, 'OK', ''],
    array['lecture', '165. MUTATION — le contrôle 146 affecté au BON dossier : il doit voir celles de T', 'membre', $q$select ((select count(*) from dossier_permanent where dossier_id = '{T}') > 0)::text$q$, '', 'true'],
    array['controle', '166. MUTATION — le contrôle 148 joué sous le chef : il doit passer', 'chef', $q$select retirer_du_dossier_permanent('{DC}', (select id from dossier_permanent where titre = 'Description du client'))$q$, 'OK', ''],

    -- ══ 170 à 180. Ce que le catalogue dit ══════════
    array['valeur', '170. les droits d''exécution (anonyme, connecté)', 'postgres', $q$select string_agg(f || ':' || has_function_privilege('anon', 'public.' || f || a, 'execute') || ':' || has_function_privilege('authenticated', 'public.' || f || a, 'execute'), ',' order by f collate "C") from (values ('consigner_au_dossier_permanent', '(uuid, text, text, text, jsonb, date, date, uuid)'), ('retirer_du_dossier_permanent', '(uuid, uuid)'), ('garder_dossier_permanent', '()'), ('garder_source_citee', '()')) as t(f, a)$q$, '',
      'consigner_au_dossier_permanent:false:true,garder_dossier_permanent:false:false,garder_source_citee:false:false,retirer_du_dossier_permanent:false:true'],
    array['valeur', '171. ce qui contourne la RLS, et ce qui ne la contourne pas ; le search_path, la volatilité', 'postgres', $q$select string_agg(proname || ':' || prosecdef || ':' || coalesce(array_to_string(proconfig, ','), '-') || ':' || provolatile::text, ',' order by proname collate "C") from pg_proc where pronamespace = 'public'::regnamespace and proname in ('consigner_au_dossier_permanent', 'retirer_du_dossier_permanent', 'garder_dossier_permanent', 'garder_source_citee')$q$, '',
      'consigner_au_dossier_permanent:true:search_path=public:v,garder_dossier_permanent:false:search_path=public:v,garder_source_citee:true:search_path=public:v,retirer_du_dossier_permanent:true:search_path=public:v'],
    array['valeur', '172. deux policies : la lecture sous admin_du_dossier, l''insertion du super-administrateur, aux connectés, aucune branche client', 'postgres', $q$select string_agg(tablename || ':' || policyname || ':' || cmd || ':' || array_to_string(roles, ',') || ':' || coalesce(qual, '-') || ':' || coalesce(with_check, '-'), ',' order by policyname collate "C") from pg_policies where schemaname = 'public' and tablename = 'dossier_permanent'$q$, '',
      'dossier_permanent:dossier_permanent_lecture:SELECT:authenticated:admin_du_dossier(dossier_id):-,dossier_permanent:dossier_permanent_restauration:INSERT:authenticated:-:is_super_admin()'],
    array['valeur', '173. la RLS est active', 'postgres', $q$select relname || ':' || relrowsecurity from pg_class where oid = 'public.dossier_permanent'::regclass$q$, '',
      'dossier_permanent:true'],
    array['valeur', '174. les déclencheurs : la garde de la table, et ceux des sources citées (étape R1), actifs, sur les bons gestes', 'postgres', $q$select string_agg(pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text, ' | ' order by t.tgname collate "C") from pg_trigger t where t.tgname in ('dossier_permanent_gardes', 'pieces_citees_en_revision', 'documents_divers_cites_en_revision') and not t.tgisinternal$q$, '',
      'CREATE TRIGGER documents_divers_cites_en_revision BEFORE DELETE OR UPDATE OF dossier_id ON public.documents_divers FOR EACH ROW EXECUTE FUNCTION garder_source_citee() O | CREATE TRIGGER dossier_permanent_gardes BEFORE INSERT OR DELETE OR UPDATE ON public.dossier_permanent FOR EACH ROW EXECUTE FUNCTION garder_dossier_permanent() O | CREATE TRIGGER pieces_citees_en_revision BEFORE DELETE OR UPDATE OF dossier_id ON public.pieces FOR EACH ROW EXECUTE FUNCTION garder_source_citee() O'],
    array['valeur', '175. les clés : l''entrée part avec son dossier, la chaîne est sans action, aucune vers une source', 'postgres', $q$select string_agg(c.conrelid::regclass::text || '.' || a.attname || '>' || c.confrelid::regclass::text || ':' || c.confdeltype::text, ',' order by a.attname collate "C") from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1] where c.contype = 'f' and c.conrelid = 'public.dossier_permanent'::regclass$q$, '',
      'dossier_permanent.dossier_id>dossiers:c,dossier_permanent.remplace_id>dossier_permanent:a'],
    array['valeur', '176. les fonctions qui nomment la table : celles de la migration, et elles seules', 'postgres', $q$select string_agg(proname, ',' order by proname collate "C") from pg_proc where pronamespace = 'public'::regnamespace and prosrc ~ 'dossier_permanent'$q$, '',
      'consigner_au_dossier_permanent,garder_dossier_permanent,garder_source_citee,retirer_du_dossier_permanent'],
    array['valeur', '177. les index', 'postgres', $q$select string_agg(pg_get_indexdef(i.indexrelid), ' | ' order by pg_get_indexdef(i.indexrelid) collate "C") from pg_index i where i.indrelid = 'public.dossier_permanent'::regclass$q$, '',
      'CREATE INDEX dossier_permanent_document ON public.dossier_permanent USING btree (document_id) | CREATE INDEX dossier_permanent_dossier ON public.dossier_permanent USING btree (dossier_id) | CREATE INDEX dossier_permanent_piece ON public.dossier_permanent USING btree (piece_id) | CREATE UNIQUE INDEX dossier_permanent_pkey ON public.dossier_permanent USING btree (id) | CREATE UNIQUE INDEX dossier_permanent_une_suite ON public.dossier_permanent USING btree (remplace_id)'],
    array['valeur', '178. les colonnes : leur type, leur obligation, leur défaut', 'postgres', $q$select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-'), ',' order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid = 'public.dossier_permanent'::regclass and a.attnum > 0 and not a.attisdropped$q$, '',
      'id:uuid:true:gen_random_uuid(),dossier_id:uuid:true:-,nature:text:true:-,titre:text:true:-,texte:text:false:-,piece_id:uuid:false:-,document_id:uuid:false:-,fichier_id:uuid:false:-,empreinte:text:false:-,valable_du:date:false:-,valable_jusqu_au:date:false:-,remplace_id:uuid:false:-,auteur:uuid:true:-,cree_le:timestamp with time zone:true:now(),retire_le:timestamp with time zone:false:-,retire_par:uuid:false:-'],
    array['valeur', '179. les contraintes de vérification, par leur texte', 'postgres', $q$select string_agg(conname || '=' || replace(replace(replace(pg_get_constraintdef(oid), E'\t', '\t'), E'\n', '\n'), E'\r', '\r'), ' | ' order by conname collate "C") from pg_constraint where conrelid = 'public.dossier_permanent'::regclass and contype = 'c'$q$, '',
      'dossier_permanent_dit_quelque_chose=CHECK (((texte IS NOT NULL) OR (num_nonnulls(piece_id, document_id, fichier_id) = 1))) | dossier_permanent_empreinte=CHECK ((empreinte ~ ''^[0-9a-f]{64}$''::text)) | dossier_permanent_empreinte_citee=CHECK (((empreinte IS NULL) OR (num_nonnulls(piece_id, document_id, fichier_id) = 1))) | dossier_permanent_nature=CHECK ((nature = ANY (ARRAY[''lettre_mission''::text, ''description''::text, ''organisation_comptable''::text, ''statuts''::text, ''bail''::text, ''contrat_emprunt''::text, ''contrat''::text, ''autre''::text]))) | dossier_permanent_retrait=CHECK (((retire_le IS NULL) = (retire_par IS NULL))) | dossier_permanent_texte=CHECK (((btrim(texte, '' \t\n\r''::text) <> ''''::text) AND (length(texte) <= 8000))) | dossier_permanent_titre=CHECK (((btrim(titre, '' \t\n\r''::text) <> ''''::text) AND (length(titre) <= 500))) | dossier_permanent_une_citation=CHECK ((num_nonnulls(piece_id, document_id, fichier_id) <= 1)) | dossier_permanent_valable_du=CHECK (((valable_du >= ''1900-01-01''::date) AND (valable_du <= ''2100-12-31''::date))) | dossier_permanent_valable_jusqu_au=CHECK (((valable_jusqu_au >= ''1900-01-01''::date) AND (valable_jusqu_au <= ''2100-12-31''::date))) | dossier_permanent_validite=CHECK ((valable_jusqu_au >= valable_du))'],
    array['valeur', '180. ce que les fonctions prennent et rendent', 'postgres', $q$select pg_get_function_identity_arguments('public.consigner_au_dossier_permanent'::regproc) || ' -> ' || pg_get_function_result('public.consigner_au_dossier_permanent'::regproc) || ' ; ' || pg_get_function_identity_arguments('public.retirer_du_dossier_permanent'::regproc) || ' -> ' || pg_get_function_result('public.retirer_du_dossier_permanent'::regproc)$q$, '',
      'p_dossier_id uuid, p_nature text, p_titre text, p_texte text, p_citation jsonb, p_valable_du date, p_valable_jusqu_au date, p_remplace_id uuid -> dossier_permanent ; p_dossier_id uuid, p_entree_id uuid -> dossier_permanent']
  ];

  begin
    foreach etape slice 1 in array etapes loop
      s := etape[4];
      for cle, valeur in select key, value from jsonb_each_text(ids || jsonb_build_object('CHEF', chef)) loop
        s := replace(s, '{' || cle || '}', valeur);
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
        verdicts := verdicts || jsonb_build_object('controle', etape[2], 'observe', coalesce(obs, '∅'), 'ok', coalesce(obs = etape[6], false));
      else
        if etape[3] in ('membre', 'membre_ailleurs', 'chef_simple') and etape[1] not in ('controle', 'lecture') then
          raise exception 'ESSAI_MAL_ECRIT : le profil % ne sert qu''à un contrôle ou à une lecture, qui s''annulent', etape[3];
        end if;
        begin
          if etape[3] in ('membre', 'membre_ailleurs') then
            insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable');
            insert into dossier_assignations (dossier_id, user_id)
              values (case etape[3] when 'membre' then (ids ->> 'T')::uuid else (ids ->> 'A')::uuid end, client);
          elsif etape[3] = 'chef_simple' then
            insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable_en_chef');
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
        if etape[1] = 'lecture' then
          verdicts := verdicts || jsonb_build_object('controle', etape[2],
            'observe', case when accepte then coalesce(obs, '∅') else coalesce(code_recu, '?') || ' ' || coalesce(message, '') end,
            'ok', accepte and coalesce(code_recu = 'P0001', false) and coalesce(obs = etape[6], false));
        else
          verdicts := verdicts || jsonb_build_object('controle', etape[2],
            'observe', case when accepte then 'accepté' else coalesce(code_recu, '?') || ' ' || coalesce(message, '') end,
            'ok', case when etape[5] = 'OK' then accepte and (etape[1] = 'fait' or coalesce(code_recu = 'P0001', false))
                       else not accepte and coalesce(code_recu = etape[5] and message like etape[6], false) end);
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
    ((select count(*) from dossiers)), ((select count(*) from cabinets)), ((select count(*) from pieces)),
    ((select count(*) from documents_divers)), ((select count(*) from dossier_permanent)),
    ((select count(*) from revision_justifications)), ((select count(*) from revision_preuves)),
    ((select count(*) from cabinet_admins)), ((select count(*) from dossier_assignations)), ((select count(*) from memberships))
  ) as t(n);
  verdicts := verdicts || jsonb_build_object('controle', '199. rien n''est resté en base',
    'observe', avant || ' -> ' || apres,
    'ok', avant = apres and not exists (select 1 from dossiers where nom like 'ESSAI DOSSIER PERMANENT%')
      and not exists (select 1 from cabinets where nom like 'ESSAI DOSSIER PERMANENT%')
      and not exists (select 1 from cabinet_admins where user_id = client));

  perform set_config('essai.dossier_permanent', verdicts::text, true);
end $essai$;

-- Un verdict qui n'a pas pu se calculer est une faute, pas un silence. La ligne 0 dit le texte que la base a reçu — par
-- l'outil MCP, qui ajoute sa signature après lui —, pour le comparer au fichier par son empreinte.
select x.controle, x.ok, x.observe from (
  select v.controle, coalesce(v.ok, false) as ok, v.observe
  from jsonb_to_recordset(current_setting('essai.dossier_permanent')::jsonb) as v(controle text, ok boolean, observe text)
  union all
  select '0. information : le texte reçu par la base', true, length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by (regexp_match(x.controle, '^(\d+)'))[1]::int, x.controle;
