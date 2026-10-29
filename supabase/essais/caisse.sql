-- LA CAISSE D'UN DOSSIER BNC, ÉPROUVÉE EN BASE (ligne 26.6, étape C1 ; migration `caisse`, préparée dans
-- `supabase/preparees/`) — à rejouer par `execute_sql` après toute migration qui touche `operations_caisse`,
-- `enregistrer_operation_caisse`, `enregistrer_operations_de_caisse`, `premier_jour_negatif_de_la_caisse`,
-- `texte_caisse_negative`, `qui_ecrit_la_caisse`, les trois gardes de la caisse (`garder_operation_caisse`,
-- `garder_ecriture_de_caisse`, `garder_la_caisse`), les contraintes d'`ecritures_brouillon` et de `lignes_bancaires`,
-- le registre des encaissements ou les à-nouveaux. Avant la migration, il le dit (ESSAI_IMPOSSIBLE) et n'écrit rien.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - QUI écrit : un anonyme n'a pas le droit d'appeler ; un compte rattaché à rien, le client — sur son dossier comme
--     sur un autre — et le chef d'un autre cabinet se font refuser l'accès ; le chef du cabinet écrit dans le dossier
--     même du client (le contrôle POSITIF), le chef de l'autre cabinet dans le sien ; le client ne lit rien de la
--     caisse de son dossier ; personne n'écrit en direct — la garde d'abord, la policy ensuite, sous le réglage même
--     d'une fonction ;
--   - CHAQUE REFUS d'`enregistrer_operation_caisse`, sous ses mots et son code, et DANS L'ORDRE : chaque paire de refus
--     voisins se joue sur une saisie qui viole les deux, et le premier l'emporte ;
--   - L'ÉCRITURE recomposée en centimes et comparée en multiensemble : un compte, un sens, un montant, une ligne de
--     trop ou de moins, un libellé qui n'est pas celui de la base se refusent ; ce qui s'écrit, ligne à ligne, aux taux
--     du relevé ;
--   - LA SAISIE D'UN MOIS, tout ou rien : le premier refus nommé par son rang et son jour, la caisse jugée à la fin ;
--   - L'ENSEMBLE DU JOUR (CAISSE-Q2, (A)) : une recette reconnaît exactement les espèces des factures sources de son
--     jour que la caisse compte — ni une de moins, ni une de plus, ni deux fois, ni celle d'un autre dossier ;
--   - LA CAISSE JAMAIS NÉGATIVE, par chacun de ses chemins — une opération (un prélèvement, des espèces rendues, un
--     retrait, un paiement), un versement en banque et un retrait pour la caisse classés sur son compte, un
--     encaissement en espèces retiré, rattaché ou contre-passé, l'ouverture du compte de la caisse —, jugée à la FIN de
--     la transaction (une sortie que la même transaction couvre passe) ;
--   - LA FRONTIÈRE de la validation : ni opération, ni retrait, ni écriture directe dans un exercice figé ;
--   - LA RESTAURATION : une ligne RÉINSÉRÉE (son instant de création d'avant) par le super-administrateur dans un
--     dossier sans exercice validé passe, même d'un état partiel ; la même ligne créée dans la transaction se juge ;
--   - LES GARDES ET LES CONTRAINTES, sans les fonctions ; ce que le catalogue dit ; et que RIEN ne reste en base.
--
-- CE QUI NE SE JOUE PAS ICI : une suppression — l'ouverture de la caisse, une opération ou son écriture, un mouvement
-- classé sur la caisse, une pièce qu'un paiement cite, un dossier entier —, que l'outil d'exécution de la production
-- soumet à une confirmation qui n'arrive pas : elle se joue sur une réplique, comme les deux sessions concurrentes. La
-- contre-passation SANS mouvement d'un encaissement suppose sa déclaration, donc une transmission acceptée par une
-- plateforme : l'essai l'insère comme `annuler_encaissement` l'insère (la ligne et sa part par taux), et le déclencheur
-- de la caisse, qui ne regarde que la ligne, la juge de même ; celle qui cite un débit passe par la fonction.
--
-- Tout se joue dans des dossiers JETABLES du cabinet du dossier `test`, dans le dossier du client et dans un cabinet
-- jetable, au sein d'un bloc qui s'annule entièrement à la fin (`ANNULATION_ESSAI_GLOBALE`) ; chaque contrôle dans sa
-- sous-transaction, annulée elle aussi (`ANNULATION_ESSAI`, P0001). Le moteur d'étapes de `cotisationPersonnelle.sql` :
-- `jeu` (posé par le propriétaire et gardé), `controle` (joué sous un profil, jugé, annulé), `fait` (joué sous un
-- profil et gardé), `valeur` (une lecture, sous un profil, qui doit rendre exactement la valeur attendue) ; après
-- chaque étape qui écrit, les dix déclencheurs de la caisse, DIFFÉRÉS, se déclenchent (`set constraints … immediate`),
-- là où la production les juge, au COMMIT de chaque appel. Un refus se juge à son code ET à son message (motif LIKE).
-- Les identifiants jetables sont FIXES (préfixe `ca155e00`), désignés par leur nom entre accolades. Hors de l'outil
-- d'exécution, le fichier se joue en UNE transaction (`psql -1`). Aucune instruction de suppression ; toute mise à jour
-- porte son `where`.
--
-- ÉPROUVÉ LE 29/10/2026 SUR LA RÉPLIQUE DE L'ÉTAPE (la production à 159 migrations, son historique et ses neuf familles
-- égaux à ceux de la production), la migration appliquée comme l'outil l'appliquera : 232 verdicts justes et la ligne
-- d'information, rien n'est resté ; de même après les deux migrations d'A7, dans les trois ordres ; sans elle,
-- ESSAI_IMPOSSIBLE, rien d'écrit. Avec `caisseSuppression.sql`, l'essai de la frontière des encaissements et deux
-- sessions concurrentes, il juge les 203 mutations de la migration : 193 tuées, dix équivalentes, chacune avec sa
-- raison (HISTORIQUE.md, « LA CAISSE, EN BASE : LA MIGRATION `CAISSE` (C1, LIGNE 26.6) »). En production, il se
-- rejoue entier après l'application.
do $essai$
declare
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  inconnu uuid := gen_random_uuid();
  dossier_test uuid := '001c7ed7-c23b-4590-901e-693489f8af24';
  dossier_client uuid; cabinet uuid;
  demain text := to_char((now() at time zone 'Europe/Paris')::date + 1, 'YYYY-MM-DD');
  declencheurs text := 'operations_caisse_jamais_negative, lignes_bancaires_caisse_jamais_negative_insertion, '
    || 'lignes_bancaires_caisse_jamais_negative_modification, lignes_bancaires_caisse_jamais_negative_suppression, '
    || 'encaissements_factures_caisse_jamais_negative_insertion, encaissements_factures_caisse_jamais_negative_modification, '
    || 'encaissements_factures_caisse_jamais_negative_suppression, a_nouveaux_caisse_jamais_negative_insertion, '
    || 'a_nouveaux_caisse_jamais_negative_modification, a_nouveaux_caisse_jamais_negative_suppression';
  immediat text := 'set constraints ' || declencheurs || ' immediate';
  differe text := 'set constraints ' || declencheurs || ' deferred';
  facture text := $f$jsonb_build_object('tiers_nom', 'ESSAI', 'tiers_siret', '12345678900012', 'emetteur_nom', 'ESSAI',
    'montant_ht', 1000, 'montant_tva', 200, 'montant_ttc', 1200, 'date_emission', '2026-03-01', 'nature_operation', 'services'),
    jsonb_build_array(jsonb_build_object('designation', 'x', 'quantite', 1, 'prix_unitaire_ht', 1000, 'taux_tva', 20)), true$f$;
  ids jsonb;
  etapes text[];
  etape text[];
  cle text; valeur text; s text;
  accepte boolean; code_recu text; message text; obs text;
  avant text; apres text;
  verdicts jsonb := '[]'::jsonb;
begin
  if to_regclass('public.operations_caisse') is null
     or to_regprocedure('public.enregistrer_operation_caisse(uuid, text, date, numeric, uuid, numeric, uuid[], jsonb)') is null then
    raise exception 'ESSAI_IMPOSSIBLE : la migration caisse n''est pas en base';
  end if;
  select m.dossier_id into dossier_client from memberships m join dossiers d on d.id = m.dossier_id
   where m.user_id = client and d.mode_comptable = 'tresorerie'
     and not exists (select 1 from exercices_valides v where v.dossier_id = d.id)
     and not exists (select 1 from a_nouveaux a where a.dossier_id = d.id and a.date > date '2026-03-03')
   order by m.dossier_id limit 1;
  select cabinet_id into cabinet from dossiers where id = dossier_test;
  if dossier_client is null or cabinet is null
     or not exists (select 1 from super_admins where user_id = chef)
     or not exists (select 1 from cabinet_admins where user_id = chef and cabinet_id = cabinet and role = 'comptable_en_chef')
     or not exists (select 1 from dossiers d where d.id = dossier_client and d.cabinet_id = cabinet)
     or exists (select 1 from cabinet_admins where user_id = client)
     or exists (select 1 from dossiers where id::text like 'ca155e00-%')
     or extract(year from (now() at time zone 'Europe/Paris'))::int <> 2026 then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable, dossier jetable déjà présent, ou l''année n''est plus 2026 (les dates de l''essai sont à avancer)';
  end if;

  ids := jsonb_build_object('CAB', cabinet, 'DC', dossier_client, 'CHEF', chef, 'DEMAIN', demain, 'FACTURE', facture)
    || jsonb_build_object(
      'T', 'ca155e00-0000-4000-8000-000000000001', 'A', 'ca155e00-0000-4000-8000-000000000002',
      'E', 'ca155e00-0000-4000-8000-000000000003', 'V', 'ca155e00-0000-4000-8000-000000000004',
      'O', 'ca155e00-0000-4000-8000-000000000005', 'B', 'ca155e00-0000-4000-8000-000000000006',
      'R', 'ca155e00-0000-4000-8000-000000000007', 'L', 'ca155e00-0000-4000-8000-000000000008',
      'DA', 'ca155e00-0000-4000-8000-000000000009', 'G', 'ca155e00-0000-4000-8000-00000000000a',
      'P', 'ca155e00-0000-4000-8000-00000000000b',
      'AUTRE', 'ca155e00-0000-4000-8000-0000000000ca')
    || jsonb_build_object(
      'KT', 'ca155e00-0000-4000-8001-000000000001', 'KTC', 'ca155e00-0000-4000-8001-000000000002',
      'KA', 'ca155e00-0000-4000-8001-000000000003', 'KB', 'ca155e00-0000-4000-8001-000000000004',
      'KO', 'ca155e00-0000-4000-8001-000000000005', 'KL', 'ca155e00-0000-4000-8001-000000000006',
      'KCOM', 'ca155e00-0000-4000-8001-000000000007', 'KV', 'ca155e00-0000-4000-8001-000000000008',
      'KR', 'ca155e00-0000-4000-8001-000000000009', 'KDA', 'ca155e00-0000-4000-8001-00000000000a',
      'KG', 'ca155e00-0000-4000-8001-00000000000b', 'KSANS', 'ca155e00-0000-4000-8001-00000000000c')
    || jsonb_build_object(
      'MV1', 'ca155e00-0000-4000-8002-000000000001', 'MD1', 'ca155e00-0000-4000-8002-000000000002',
      'MB1', 'ca155e00-0000-4000-8002-000000000003', 'MB2', 'ca155e00-0000-4000-8002-000000000004',
      'MB3', 'ca155e00-0000-4000-8002-000000000005', 'MR1', 'ca155e00-0000-4000-8002-000000000006',
      'MP1', 'ca155e00-0000-4000-8002-000000000007',
      'PR', 'ca155e00-0000-4000-8003-000000000001', 'PT', 'ca155e00-0000-4000-8003-000000000002')
    || jsonb_build_object(
      'X1', 'ca155e00-0000-4000-8004-000000000001', 'X2', 'ca155e00-0000-4000-8004-000000000002',
      'X3', 'ca155e00-0000-4000-8004-000000000003', 'X4', 'ca155e00-0000-4000-8004-000000000004',
      'X5', 'ca155e00-0000-4000-8004-000000000005', 'X6', 'ca155e00-0000-4000-8004-000000000006',
      'X7', 'ca155e00-0000-4000-8004-000000000007', 'X8', 'ca155e00-0000-4000-8004-000000000008',
      'X9', 'ca155e00-0000-4000-8004-000000000009')
    || jsonb_build_object(
      'AN1', 'ca155e00-0000-4000-8005-000000000001', 'AN2', 'ca155e00-0000-4000-8005-000000000002',
      'AN3', 'ca155e00-0000-4000-8005-000000000003', 'AN4', 'ca155e00-0000-4000-8005-000000000004',
      'AN5', 'ca155e00-0000-4000-8005-000000000005', 'AN6', 'ca155e00-0000-4000-8005-000000000006');

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from operations_caisse)), ((select count(*) from ecritures_brouillon)),
    ((select count(*) from lignes_bancaires)), ((select count(*) from a_nouveaux)), ((select count(*) from exercices_valides)),
    ((select count(*) from encaissements_factures)), ((select count(*) from encaissements_factures_taux)),
    ((select count(*) from factures_emises)), ((select count(*) from categories)), ((select count(*) from pieces)),
    ((select count(*) from cabinets)), ((select count(*) from cabinet_admins)), ((select count(*) from facture_lignes)),
    ((select count(*) from facture_numerotation)), ((select count(*) from plan_comptable_dossier))
  ) as t(n);

  -- Une étape : {genre, contrôle, qui, requête, code attendu, message attendu (motif LIKE) ou valeur attendue}.
  etapes := array[
    -- ══ Le jeu : les dossiers jetables, leurs catégories, leurs mouvements, leurs pièces, une ouverture ══════════
    array['jeu', 'dossiers jetables', 'postgres', $q$insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, statut_tva, ventes_par_les_factures) values
      ('{T}', 'ESSAI CAISSE T', '{CAB}', 'tresorerie', '455000', null, false), ('{A}', 'ESSAI CAISSE A', '{CAB}', 'tresorerie', '455000', 'redevable', false),
      ('{E}', 'ESSAI CAISSE E', '{CAB}', 'engagement', '455000', null, false), ('{V}', 'ESSAI CAISSE V', '{CAB}', 'tresorerie', '455000', null, false),
      ('{O}', 'ESSAI CAISSE O', '{CAB}', 'tresorerie', '455000', null, false), ('{B}', 'ESSAI CAISSE B', '{CAB}', 'tresorerie', '455000', null, true),
      ('{R}', 'ESSAI CAISSE R', '{CAB}', 'tresorerie', '455000', null, false), ('{L}', 'ESSAI CAISSE L', '{CAB}', 'tresorerie', '455000', null, false),
      ('{G}', 'ESSAI CAISSE G', '{CAB}', 'tresorerie', '455000', null, false), ('{P}', 'ESSAI CAISSE P', '{CAB}', 'tresorerie', '455000', null, false)$q$, '', ''],
    array['jeu', 'catégories', 'postgres', $q$insert into categories (id, dossier_id, code, libelle, compte_comptable, poste_2035) values
      ('{KT}', '{T}', 'essai_hon', 'Honoraires', '706000', 'AA'), ('{KTC}', '{T}', 'essai_fou', 'Fournitures', '606400', null),
      ('{KA}', '{A}', 'essai_hon', 'Honoraires', '706000', 'AA'), ('{KB}', '{B}', 'essai_hon', 'Honoraires', '706000', 'AA'),
      ('{KO}', '{O}', 'essai_hon', 'Honoraires', '706000', 'AA'), ('{KL}', '{L}', 'essai_hon', 'Honoraires', '706000', 'AA'),
      ('{KCOM}', null, 'essai_caisse_commune', 'Gains divers (essai)', '758000', null), ('{KV}', '{V}', 'essai_hon', 'Honoraires', '706000', 'AA'),
      ('{KR}', '{R}', 'essai_hon', 'Honoraires', '706000', 'AA'), ('{KG}', '{G}', 'essai_hon', 'Honoraires', '706000', 'AA'),
      ('{KSANS}', '{T}', 'essai_sans', 'Sans compte', null, null)$q$, '', ''],
    array['jeu', 'mouvements', 'postgres', $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values
      ('{MV1}', '{T}', '2026-03-05', 'ESSAI VERSEMENT ESPECES', 500, 'non_rapprochee'), ('{MD1}', '{T}', '2026-03-06', 'ESSAI RETRAIT DAB', -200, 'non_rapprochee'),
      ('{MB1}', '{B}', '2026-03-12', 'ESSAI REMISE', 15, 'non_rapprochee'), ('{MB2}', '{B}', '2026-03-20', 'ESSAI REMISE', 30, 'non_rapprochee'),
      ('{MB3}', '{B}', '2026-03-18', 'ESSAI REMBOURSEMENT', -20, 'non_rapprochee'), ('{MP1}', '{P}', '2026-03-05', 'ESSAI VERSEMENT ESPECES', 20, 'non_rapprochee')$q$, '', ''],
    array['jeu', 'pièces', 'postgres', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut) values
      ('{PR}', '{R}', '{R}/essai-caisse-r.pdf', 'essai-caisse-r.pdf', 'achat', 'a_valider'),
      ('{PT}', '{T}', '{T}/essai-caisse-t.pdf', 'essai-caisse-t.pdf', 'achat', 'a_valider')$q$, '', ''],
    array['jeu', 'l''ouverture de O, reprise au 1er janvier 2026', 'postgres', $q$insert into a_nouveaux (id, dossier_id, date, compte, sens, montant, source_nom, source_empreinte) values
      ('{AN1}', '{O}', '2026-01-01', '512000', 'debit', 10, 'balance-essai-caisse.csv', repeat('c', 64)),
      ('{AN2}', '{O}', '2026-01-01', '101000', 'credit', 10, 'balance-essai-caisse.csv', repeat('c', 64))$q$, '', ''],

    -- ══ 1 à 9. Qui écrit, qui lit ══════════
    array['controle', '1. un anonyme n''exécute pas la fonction', 'anon', $q$select enregistrer_operation_caisse('{T}', 'apport', '2026-03-03', 10, null, null, null, '[{"compte":"530000","sens":"debit","montant":10},{"compte":"108000","sens":"credit","montant":10}]')$q$,
      '42501', 'permission denied for function enregistrer_operation_caisse'],
    array['controle', '1b. … ni la saisie d''un mois', 'anon', $q$select enregistrer_operations_de_caisse('{T}', '[]')$q$,
      '42501', 'permission denied for function enregistrer_operations_de_caisse'],
    array['controle', '2. un compte rattaché à rien', 'inconnu', $q$select enregistrer_operation_caisse('{T}', 'apport', '2026-03-03', 10, null, null, null, '[{"compte":"530000","sens":"debit","montant":10},{"compte":"108000","sens":"credit","montant":10}]')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '3. le client, sur son dossier', 'client', $q$select enregistrer_operation_caisse('{DC}', 'apport', '2026-03-03', 10, null, null, null, '[{"compte":"530000","sens":"debit","montant":10},{"compte":"108000","sens":"credit","montant":10}]')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '3b. le client, sur un autre dossier', 'client', $q$select enregistrer_operation_caisse('{T}', 'apport', '2026-03-03', 10, null, null, null, '[{"compte":"530000","sens":"debit","montant":10},{"compte":"108000","sens":"credit","montant":10}]')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '3c. le client, la saisie d''un mois de son dossier, avant même d''en lire la forme', 'client', $q$select enregistrer_operations_de_caisse('{DC}', '"pas un tableau"')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '3d. un dossier qui n''existe pas, sous les mêmes mots, même pour le super-administrateur', 'chef', $q$select enregistrer_operation_caisse('ca155e00-0000-4000-8000-0000000000ff', 'apport', '2026-03-03', 10, null, null, null, '[]')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['fait', '4. le chef écrit dans le dossier du client (le contrôle POSITIF)', 'chef', $q$select enregistrer_operation_caisse('{DC}', 'apport', '2026-03-03', 10, null, null, null, '[{"compte":"530000","sens":"debit","montant":10},{"compte":"108000","sens":"credit","montant":10}]')$q$,
      'OK', ''],
    array['valeur', '4b. le client ne lit aucune opération de la caisse de son dossier', 'client', $q$select count(*)::text from operations_caisse where dossier_id = '{DC}'$q$, '', '0'],
    array['valeur', '4c. … que le chef y lit', 'chef', $q$select count(*)::text from operations_caisse where dossier_id = '{DC}'$q$, '', '1'],
    array['valeur', '4d. … ni les lignes de son écriture', 'client', $q$select count(*)::text from ecritures_brouillon where operation_caisse_id is not null$q$, '', '0'],
    array['controle', '5. le client n''écrit pas en direct : la garde', 'client', $q$insert into operations_caisse (dossier_id, genre, date, montant, origine) values ('{DC}', 'apport', '2026-03-03', 10, 'client')$q$,
      '42501', 'Une opération de caisse ne s''écrit que par les fonctions de la caisse, avec son écriture.'],
    array['controle', '5b. … ni sous le réglage d''une fonction : la policy', 'client', $q$select set_config('jd.caisse', '{X8}', true);
      insert into operations_caisse (id, dossier_id, genre, date, montant, origine) values ('{X8}', '{DC}', 'apport', '2026-03-03', 10, 'client')$q$,
      '42501', 'new row violates row-level security policy for table "operations_caisse"'],
    array['valeur', '5c. le client ne modifie rien en direct (aucune ligne visible)', 'client', $q$with m as (update operations_caisse set montant = 1 where dossier_id = '{DC}' returning 1) select count(*)::text from m$q$, '', '0'],
    -- Le chef d'un autre cabinet : le compte du client, fait chef d'un cabinet jetable (il ne l'est d'aucun).
    array['jeu', 'un autre cabinet, son chef et son dossier', 'postgres', $q$insert into cabinets (id, nom) values ('{AUTRE}', 'ESSAI CAISSE AUTRE CABINET');
      insert into cabinet_admins (user_id, cabinet_id, role) values ('797fe440-df8d-4b8e-828b-d148927bfd60', '{AUTRE}', 'comptable_en_chef');
      insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values ('{DA}', 'ESSAI CAISSE DA', '{AUTRE}', 'tresorerie', '455000');
      insert into categories (id, dossier_id, code, libelle, compte_comptable, poste_2035) values ('{KDA}', '{DA}', 'essai_hon', 'Honoraires', '706000', 'AA')$q$, '', ''],
    array['controle', '6. le chef d''un autre cabinet', 'autre', $q$select enregistrer_operation_caisse('{T}', 'apport', '2026-03-03', 10, null, null, null, '[{"compte":"530000","sens":"debit","montant":10},{"compte":"108000","sens":"credit","montant":10}]')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['fait', '6b. … écrit dans son dossier (le contrôle POSITIF du profil)', 'autre', $q$select enregistrer_operation_caisse('{DA}', 'apport', '2026-03-03', 10, null, null, null, '[{"compte":"530000","sens":"debit","montant":10},{"compte":"108000","sens":"credit","montant":10}]')$q$,
      'OK', ''],
    array['valeur', '6c. … et ne lit rien de la caisse du cabinet', 'autre', $q$select count(*)::text from operations_caisse where dossier_id in ('{T}', '{DC}')$q$, '', '0'],
    array['controle', '6d. … ni n''écrit en direct dans son dossier : la garde', 'autre', $q$insert into operations_caisse (dossier_id, genre, date, montant, origine) values ('{DA}', 'apport', '2026-03-04', 10, 'cabinet')$q$,
      '42501', 'Une opération de caisse ne s''écrit que par les fonctions de la caisse, avec son écriture.'],
    array['controle', '6e. … ni sous le réglage d''une fonction : la policy', 'autre', $q$select set_config('jd.caisse', '{X8}', true);
      insert into operations_caisse (id, dossier_id, genre, date, montant, origine) values ('{X8}', '{DA}', 'apport', '2026-03-04', 10, 'cabinet')$q$,
      '42501', 'new row violates row-level security policy for table "operations_caisse"'],
    array['controle', '6f. … ni l''écriture d''une opération, que la RLS du brouillon lui ouvre dans son dossier', 'autre', $q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, operation_caisse_id)
      select '{DA}', '2026-03-03', '530000', 'x', 1, 'debit', o.id from operations_caisse o where o.dossier_id = '{DA}'$q$,
      '42501', 'L''écriture d''une opération de caisse ne s''écrit qu''avec cette opération, par la fonction de la caisse.'],

    -- ══ 10 à 32. Chaque refus, sous ses mots, et dans l'ordre ══════════
    -- 2. Le dossier en trésorerie (l'accès d'abord).
    array['controle', '10. le dossier en engagement', 'chef', $q$select enregistrer_operation_caisse('{E}', 'apport', '2026-03-03', 10, null, null, null, '[]')$q$,
      '22023', 'La caisse ne se tient que dans un dossier en comptabilité de trésorerie.'],
    array['controle', '10b. ordre : l''accès avant le dossier en engagement', 'client', $q$select enregistrer_operation_caisse('{E}', 'don', null, null, null, null, null, '[]')$q$,
      '42501', 'Accès refusé à ce dossier.'],
    -- 3. Le genre.
    array['controle', '11. le genre inconnu', 'chef', $q$select enregistrer_operation_caisse('{T}', 'don', '2026-03-03', 10, null, null, null, '[]')$q$,
      '22023', 'Une opération de caisse est une recette en espèces, un apport ou un prélèvement de l''exploitant.'],
    array['controle', '11b. le paiement d''une pièce n''est pas un genre de cette fonction', 'chef', $q$select enregistrer_operation_caisse('{T}', 'paiement', '2026-03-03', -10, null, null, null, '[]')$q$,
      '22023', 'Une opération de caisse est une recette en espèces, un apport ou un prélèvement de l''exploitant.'],
    array['controle', '11c. le genre nul', 'chef', $q$select enregistrer_operation_caisse('{T}', null, '2026-03-03', 10, null, null, null, '[]')$q$,
      '22023', 'Une opération de caisse est une recette en espèces, un apport ou un prélèvement de l''exploitant.'],
    array['controle', '11d. ordre : l''engagement avant le genre', 'chef', $q$select enregistrer_operation_caisse('{E}', 'don', null, null, null, null, null, '[]')$q$,
      '22023', 'La caisse ne se tient que dans un dossier en comptabilité de trésorerie.'],
    -- 4. La date (la frontière de la validation : 16 et 16b, section 80).
    array['controle', '12. la date nulle', 'chef', $q$select enregistrer_operation_caisse('{T}', 'apport', null, 10, null, null, null, '[]')$q$,
      '22023', 'La date de l''opération de caisse est à renseigner.'],
    array['controle', '12b. ordre : le genre avant la date', 'chef', $q$select enregistrer_operation_caisse('{T}', 'don', null, null, null, null, null, '[]')$q$,
      '22023', 'Une opération de caisse est une recette en espèces, un apport ou un prélèvement de l''exploitant.'],
    array['controle', '13. la date d''avant 2000', 'chef', $q$select enregistrer_operation_caisse('{T}', 'apport', '1999-12-31', null, null, null, null, '[]')$q$,
      '22023', 'Une opération de caisse ne se date pas avant l''an 2000.'],
    array['controle', '14. la date dans l''avenir, à Paris', 'chef', $q$select enregistrer_operation_caisse('{T}', 'apport', '{DEMAIN}', null, null, null, null, '[]')$q$,
      '22023', 'Une opération de caisse ne se date pas dans l''avenir : nous sommes le __/__/20__.'],
    array['controle', '15. la date d''avant l''ouverture d''un dossier repris', 'chef', $q$select enregistrer_operation_caisse('{O}', 'apport', '2025-12-31', null, null, null, null, '[]')$q$,
      '22023', 'Cette opération précède l''ouverture du dossier, le 01/01/2026 : elle est dans les comptes repris.'],
    -- 5. Le montant.
    array['controle', '17. le montant nul', 'chef', $q$select enregistrer_operation_caisse('{T}', 'apport', '2026-03-03', null, '{KT}', null, null, '[]')$q$,
      '22023', 'Le montant de l''opération de caisse est à renseigner.'],
    array['controle', '17b. ordre : la date avant le montant', 'chef', $q$select enregistrer_operation_caisse('{T}', 'apport', '1999-12-31', 0, null, null, null, '[]')$q$,
      '22023', 'Une opération de caisse ne se date pas avant l''an 2000.'],
    array['controle', '18. le montant pas au centime', 'chef', $q$select enregistrer_operation_caisse('{T}', 'apport', '2026-03-03', 10.005, '{KT}', null, null, '[]')$q$,
      '22023', 'Le montant d''une opération de caisse est au centime.'],
    array['controle', '19. le montant de zéro euro', 'chef', $q$select enregistrer_operation_caisse('{T}', 'apport', '2026-03-03', 0, '{KT}', null, null, '[]')$q$,
      '22023', 'Une opération de caisse de zéro euro n''a rien à écrire.'],
    array['controle', '20. un apport négatif', 'chef', $q$select enregistrer_operation_caisse('{T}', 'apport', '2026-03-03', -10, '{KT}', null, null, '[]')$q$,
      '22023', 'Le montant d''un apport ou d''un prélèvement est positif : un apport fait entrer des espèces, un prélèvement les fait sortir.'],
    array['controle', '20b. un prélèvement négatif', 'chef', $q$select enregistrer_operation_caisse('{T}', 'prelevement', '2026-03-03', -10, null, null, null, '[]')$q$,
      '22023', 'Le montant d''un apport ou d''un prélèvement est positif : un apport fait entrer des espèces, un prélèvement les fait sortir.'],
    array['controle', '21. un montant au-delà de ce que l''application compte', 'chef', $q$select enregistrer_operation_caisse('{T}', 'apport', '2026-03-03', 10000000000000, '{KT}', null, null, '[]')$q$,
      '22023', 'Le montant d''une opération de caisse dépasse ce que l''application compte.'],
    -- 6. La catégorie.
    array['controle', '22. une recette sans catégorie', 'chef', $q$select enregistrer_operation_caisse('{T}', 'recette', '2026-03-03', 10, null, 20, null, '[]')$q$,
      '22023', 'La nature d''une recette en espèces est une catégorie de produit du dossier : à choisir.'],
    array['controle', '22b. ordre : le montant avant la catégorie', 'chef', $q$select enregistrer_operation_caisse('{T}', 'recette', '2026-03-03', 0, null, 20, null, '[]')$q$,
      '22023', 'Une opération de caisse de zéro euro n''a rien à écrire.'],
    array['controle', '23. la catégorie d''un autre dossier', 'chef', $q$select enregistrer_operation_caisse('{T}', 'recette', '2026-03-03', 10, '{KA}', null, '{}', '[]')$q$,
      '22023', 'Cette catégorie n''existe pas pour ce dossier.'],
    array['controle', '23b. une catégorie qui n''existe pas', 'chef', $q$select enregistrer_operation_caisse('{T}', 'recette', '2026-03-03', 10, 'ca155e00-0000-4000-8001-0000000000ff', null, '{}', '[]')$q$,
      '22023', 'Cette catégorie n''existe pas pour ce dossier.'],
    array['controle', '24. une catégorie de charge', 'chef', $q$select enregistrer_operation_caisse('{T}', 'recette', '2026-03-03', 10, '{KTC}', null, '{}', '[]')$q$,
      '22023', 'La catégorie « Fournitures » n''a pas de compte de produit (classe 7) : une recette en espèces ne s''y range pas.'],
    array['controle', '24b. une catégorie sans compte', 'chef', $q$select enregistrer_operation_caisse('{T}', 'recette', '2026-03-03', 10, '{KSANS}', null, '{}', '[]')$q$,
      '22023', 'La catégorie « Sans compte » n''a pas de compte de produit (classe 7) : une recette en espèces ne s''y range pas.'],
    array['controle', '25. un apport avec une catégorie', 'chef', $q$select enregistrer_operation_caisse('{T}', 'apport', '2026-03-03', 10, '{KT}', null, null, '[]')$q$,
      '22023', 'Un apport ou un prélèvement n''a pas de catégorie : il s''écrit face au compte de l''exploitant.'],
    -- 7. Le taux.
    array['controle', '26. une recette d''un dossier assujetti sans taux', 'chef', $q$select enregistrer_operation_caisse('{A}', 'recette', '2026-03-03', 10, '{KA}', null, '{}', '[]')$q$,
      '22023', 'Sur un dossier assujetti à la TVA, une recette porte son taux : choisis-le, ou « exonérée ».'],
    array['controle', '26b. ordre : la catégorie avant le taux', 'chef', $q$select enregistrer_operation_caisse('{A}', 'recette', '2026-03-03', 10, null, null, null, '[]')$q$,
      '22023', 'La nature d''une recette en espèces est une catégorie de produit du dossier : à choisir.'],
    array['controle', '27. un taux qui n''est pas pris en charge', 'chef', $q$select enregistrer_operation_caisse('{A}', 'recette', '2026-03-03', 10, '{KA}', 7, '{}', '[]')$q$,
      '22023', 'Ce taux de TVA n''est pas pris en charge.'],
    array['controle', '28. un taux sur un dossier qui n''est pas assujetti', 'chef', $q$select enregistrer_operation_caisse('{T}', 'recette', '2026-03-03', 10, '{KT}', 20, '{}', '[]')$q$,
      '22023', 'Un taux de TVA ne s''applique qu''à une recette d''un dossier assujetti.'],
    array['controle', '28b. un taux sur un apport d''un dossier assujetti', 'chef', $q$select enregistrer_operation_caisse('{A}', 'apport', '2026-03-03', 10, null, 20, null, '[]')$q$,
      '22023', 'Un taux de TVA ne s''applique qu''à une recette d''un dossier assujetti.'],
    -- 8. L'ensemble du jour (sa lecture, section 60).
    array['controle', '29. une recette sans ensemble du jour', 'chef', $q$select enregistrer_operation_caisse('{T}', 'recette', '2026-03-03', 10, '{KT}', null, null, '[]')$q$,
      '22023', 'La saisie d''une recette dit les encaissements en espèces de factures de son jour qu''elle a lus : une liste d''identifiants, vide s''il n''y en a aucun.'],
    array['controle', '29b. ordre : le taux avant l''ensemble du jour', 'chef', $q$select enregistrer_operation_caisse('{T}', 'recette', '2026-03-03', 10, '{KT}', 20, null, '[]')$q$,
      '22023', 'Un taux de TVA ne s''applique qu''à une recette d''un dossier assujetti.'],
    array['controle', '29c. un apport qui reconnaît un encaissement', 'chef', $q$select enregistrer_operation_caisse('{T}', 'apport', '2026-03-03', 10, null, null, array['ca155e00-0000-4000-8000-0000000000ee']::uuid[], '[]')$q$,
      '22023', 'Seule une recette reconnaît les encaissements en espèces de son jour.'],
    -- 9. L'écriture.
    array['controle', '30. l''écriture illisible : un objet', 'chef', $q$select enregistrer_operation_caisse('{T}', 'apport', '2026-03-03', 10, null, null, null, '{"compte":"530000"}')$q$,
      '22023', 'L''écriture proposée est incomplète.'],
    array['controle', '30b. ordre : l''ensemble du jour avant l''écriture', 'chef', $q$select enregistrer_operation_caisse('{T}', 'recette', '2026-03-03', 10, '{KT}', null, null, '{"compte":"530000"}')$q$,
      '22023', 'La saisie d''une recette dit les encaissements en espèces de factures de son jour qu''elle a lus : une liste d''identifiants, vide s''il n''y en a aucun.'],
    array['controle', '30c. une ligne sans compte', 'chef', $q$select enregistrer_operation_caisse('{T}', 'apport', '2026-03-03', 10, null, null, null, '[{"sens":"debit","montant":10},{"compte":"108000","sens":"credit","montant":10}]')$q$,
      '22023', 'L''écriture proposée est incomplète.'],
    array['controle', '30d. un montant en texte', 'chef', $q$select enregistrer_operation_caisse('{T}', 'apport', '2026-03-03', 10, null, null, null, '[{"compte":"530000","sens":"debit","montant":"10"},{"compte":"108000","sens":"credit","montant":10}]')$q$,
      '22023', 'L''écriture proposée est incomplète.'],
    array['controle', '30e. un libellé qui n''est pas un texte', 'chef', $q$select enregistrer_operation_caisse('{T}', 'apport', '2026-03-03', 10, null, null, null, '[{"compte":"530000","sens":"debit","montant":10,"libelle":1},{"compte":"108000","sens":"credit","montant":10}]')$q$,
      '22023', 'L''écriture proposée est incomplète.'],
    array['controle', '31. le compte de la caisse remplacé par la banque', 'chef', $q$select enregistrer_operation_caisse('{T}', 'apport', '2026-03-03', 10, null, null, null, '[{"compte":"512000","sens":"debit","montant":10},{"compte":"108000","sens":"credit","montant":10}]')$q$,
      '22023', 'L''écriture proposée ne correspond pas à cette opération de caisse et au plan du dossier (la caisse : 530000).'],
    array['controle', '31b. les sens inversés', 'chef', $q$select enregistrer_operation_caisse('{T}', 'apport', '2026-03-03', 10, null, null, null, '[{"compte":"530000","sens":"credit","montant":10},{"compte":"108000","sens":"debit","montant":10}]')$q$,
      '22023', 'L''écriture proposée ne correspond pas à cette opération de caisse et au plan du dossier (la caisse : 530000).'],
    array['controle', '31c. un centime de moins', 'chef', $q$select enregistrer_operation_caisse('{T}', 'apport', '2026-03-03', 10, null, null, null, '[{"compte":"530000","sens":"debit","montant":9.99},{"compte":"108000","sens":"credit","montant":10}]')$q$,
      '22023', 'L''écriture proposée ne correspond pas à cette opération de caisse et au plan du dossier (la caisse : 530000).'],
    array['controle', '31d. un montant qui n''est pas au centime', 'chef', $q$select enregistrer_operation_caisse('{T}', 'apport', '2026-03-03', 10, null, null, null, '[{"compte":"530000","sens":"debit","montant":10.001},{"compte":"108000","sens":"credit","montant":10}]')$q$,
      '22023', 'L''écriture proposée ne correspond pas à cette opération de caisse et au plan du dossier (la caisse : 530000).'],
    array['controle', '31e. une ligne de moins', 'chef', $q$select enregistrer_operation_caisse('{T}', 'apport', '2026-03-03', 10, null, null, null, '[{"compte":"530000","sens":"debit","montant":10}]')$q$,
      '22023', 'L''écriture proposée ne correspond pas à cette opération de caisse et au plan du dossier (la caisse : 530000).'],
    array['controle', '31f. une ligne de trop', 'chef', $q$select enregistrer_operation_caisse('{T}', 'apport', '2026-03-03', 10, null, null, null, '[{"compte":"530000","sens":"debit","montant":10},{"compte":"108000","sens":"credit","montant":10},{"compte":"445710","sens":"credit","montant":0.01}]')$q$,
      '22023', 'L''écriture proposée ne correspond pas à cette opération de caisse et au plan du dossier (la caisse : 530000).'],
    array['controle', '31g. une ligne deux fois, l''autre absente', 'chef', $q$select enregistrer_operation_caisse('{T}', 'apport', '2026-03-03', 10, null, null, null, '[{"compte":"530000","sens":"debit","montant":10},{"compte":"530000","sens":"debit","montant":10}]')$q$,
      '22023', 'L''écriture proposée ne correspond pas à cette opération de caisse et au plan du dossier (la caisse : 530000).'],
    array['controle', '31h. un libellé qui nomme quelqu''un', 'chef', $q$select enregistrer_operation_caisse('{T}', 'apport', '2026-03-03', 10, null, null, null, '[{"compte":"530000","sens":"debit","montant":10,"libelle":"Apport de M. Fictif"},{"compte":"108000","sens":"credit","montant":10}]')$q$,
      '22023', 'L''écriture proposée ne correspond pas à cette opération de caisse et au plan du dossier (la caisse : 530000).'],
    array['controle', '31i. le libellé de la base, envoyé : passe', 'chef', $q$select enregistrer_operation_caisse('{T}', 'apport', '2026-03-03', 10, null, null, null, '[{"compte":"530000","sens":"debit","montant":10,"libelle":"Apport en caisse de l''exploitant"},{"compte":"108000","sens":"credit","montant":10,"libelle":null}]')$q$,
      'OK', ''],
    array['controle', '32. une recette assujettie : sa TVA d''un centime fausse', 'chef', $q$select enregistrer_operation_caisse('{A}', 'recette', '2026-03-03', 120, '{KA}', 20, '{}', '[{"compte":"530000","sens":"debit","montant":120},{"compte":"706000","sens":"credit","montant":100.01},{"compte":"445710","sens":"credit","montant":19.99}]')$q$,
      '22023', 'L''écriture proposée ne correspond pas à cette opération de caisse et au plan du dossier (la caisse : 530000).'],
    array['controle', '32b. une recette exonérée (taux 0) portant une ligne de TVA à zéro', 'chef', $q$select enregistrer_operation_caisse('{A}', 'recette', '2026-03-03', 50, '{KA}', 0, '{}', '[{"compte":"530000","sens":"debit","montant":50},{"compte":"706000","sens":"credit","montant":50},{"compte":"445710","sens":"credit","montant":0}]')$q$,
      '22023', 'L''écriture proposée ne correspond pas à cette opération de caisse et au plan du dossier (la caisse : 530000).'],

    -- ══ 40 à 48. Ce qui s'écrit ══════════
    array['fait', '40. l''apport d''ouverture de la caisse de T', 'chef', $q$select enregistrer_operation_caisse('{T}', 'apport', '2026-03-01', 100, null, null, null, '[{"compte":"530000","sens":"debit","montant":100},{"compte":"108000","sens":"credit","montant":100}]')$q$,
      'OK', ''],
    array['fait', '41. une recette de T, la nature des honoraires, ses lignes dans un autre ordre et un libellé', 'chef', $q$select enregistrer_operation_caisse('{T}', 'recette', '2026-03-02', 85.5, '{KT}', null, '{}', '[{"compte":"706000","sens":"credit","montant":85.5},{"compte":"530000","sens":"debit","montant":85.5,"libelle":"Recettes en espèces du 02/03/2026 — Honoraires"}]')$q$,
      'OK', ''],
    array['valeur', '42. les opérations de T, telles que la base les écrit', 'postgres', $q$select string_agg(o.genre || '|' || o.date || '|' || o.montant || '|' || coalesce(o.categorie_id::text, '-') || '|' || coalesce(o.taux_tva::text, '-') || '|'
        || coalesce(o.encaissements_du_jour::text, '-') || '|' || o.origine || '|' || (o.cree_par = '{CHEF}') || '|' || (o.cree_le = now()) || '|' || (o.retire_le is null) || '|'
        || coalesce(o.piece_id::text, '-') || '|' || coalesce(o.remplace_id::text, '-'), ',' order by o.date)
      from operations_caisse o where o.dossier_id = '{T}'$q$, '',
      'apport|2026-03-01|100|-|-|-|cabinet|true|true|true|-|-,recette|2026-03-02|85.5|ca155e00-0000-4000-8001-000000000001|-|{}|cabinet|true|true|true|-|-'],
    array['valeur', '43. leurs écritures, ligne à ligne : la caisse, le produit, l''exploitant, sous le libellé de la base', 'postgres', $q$select string_agg(b.date || '|' || b.compte || '|' || b.sens || '|' || b.montant || '|' || b.libelle || '|' || b.statut || '|'
        || num_nonnulls(b.piece_id, b.ligne_bancaire_id, b.facture_id, b.encaissement_id, b.immobilisation_id, b.vehicule_id, b.declaration_tva_id, b.cotisation_id),
        ',' order by b.date, b.compte)
      from ecritures_brouillon b join operations_caisse o on o.id = b.operation_caisse_id where o.dossier_id = '{T}'$q$, '',
      '2026-03-01|108000|credit|100|Apport en caisse de l''exploitant|proposee|0,2026-03-01|530000|debit|100|Apport en caisse de l''exploitant|proposee|0,2026-03-02|530000|debit|85.5|Recettes en espèces du 02/03/2026 — Honoraires|proposee|0,2026-03-02|706000|credit|85.5|Recettes en espèces du 02/03/2026 — Honoraires|proposee|0'],
    array['fait', '44. une recette d''un dossier assujetti, au taux de 20 %', 'chef', $q$select enregistrer_operation_caisse('{A}', 'recette', '2026-03-03', 120, '{KA}', 20, '{}', '[{"compte":"530000","sens":"debit","montant":120},{"compte":"706000","sens":"credit","montant":100},{"compte":"445710","sens":"credit","montant":20}]')$q$,
      'OK', ''],
    array['fait', '44b. … au taux de 5,5 % (la TVA incluse, arrondie comme le relevé)', 'chef', $q$select enregistrer_operation_caisse('{A}', 'recette', '2026-03-04', 100, '{KA}', 5.5, '{}', '[{"compte":"530000","sens":"debit","montant":100},{"compte":"706000","sens":"credit","montant":94.79},{"compte":"445710","sens":"credit","montant":5.21}]')$q$,
      'OK', ''],
    array['fait', '44c. … exonérée (0) : deux lignes', 'chef', $q$select enregistrer_operation_caisse('{A}', 'recette', '2026-03-05', 50, '{KA}', 0, '{}', '[{"compte":"530000","sens":"debit","montant":50},{"compte":"706000","sens":"credit","montant":50}]')$q$,
      'OK', ''],
    array['fait', '44d. … des espèces rendues : les sens inversés', 'chef', $q$select enregistrer_operation_caisse('{A}', 'recette', '2026-03-06', -12, '{KA}', 20, '{}', '[{"compte":"530000","sens":"credit","montant":12},{"compte":"706000","sens":"debit","montant":10},{"compte":"445710","sens":"debit","montant":2}]')$q$,
      'OK', ''],
    array['valeur', '45. les écritures du dossier assujetti', 'postgres', $q$select string_agg(b.date || '|' || b.compte || '|' || b.sens || '|' || b.montant || '|' || b.libelle, ',' order by b.date, b.compte)
      from ecritures_brouillon b join operations_caisse o on o.id = b.operation_caisse_id where o.dossier_id = '{A}'$q$, '',
      '2026-03-03|445710|credit|20|Recettes en espèces du 03/03/2026 — Honoraires,2026-03-03|530000|debit|120|Recettes en espèces du 03/03/2026 — Honoraires,2026-03-03|706000|credit|100|Recettes en espèces du 03/03/2026 — Honoraires,'
      || '2026-03-04|445710|credit|5.21|Recettes en espèces du 04/03/2026 — Honoraires,2026-03-04|530000|debit|100|Recettes en espèces du 04/03/2026 — Honoraires,2026-03-04|706000|credit|94.79|Recettes en espèces du 04/03/2026 — Honoraires,'
      || '2026-03-05|530000|debit|50|Recettes en espèces du 05/03/2026 — Honoraires,2026-03-05|706000|credit|50|Recettes en espèces du 05/03/2026 — Honoraires,'
      || '2026-03-06|445710|debit|2|Espèces rendues le 06/03/2026 — Honoraires,2026-03-06|530000|credit|12|Espèces rendues le 06/03/2026 — Honoraires,2026-03-06|706000|debit|10|Espèces rendues le 06/03/2026 — Honoraires'],
    array['valeur', '45b. leurs taux', 'postgres', $q$select string_agg(o.montant || ':' || o.taux_tva, ',' order by o.date) from operations_caisse o where o.dossier_id = '{A}'$q$, '', '120:20.00,100:5.50,50:0.00,-12:20.00'],
    array['controle', '46. une catégorie commune passe', 'chef', $q$select enregistrer_operation_caisse('{T}', 'recette', '2026-03-03', 5, '{KCOM}', null, '{}', '[{"compte":"530000","sens":"debit","montant":5},{"compte":"758000","sens":"credit","montant":5}]')$q$,
      'OK', ''],
    array['controle', '47. un prélèvement de l''exploitant', 'chef', $q$select enregistrer_operation_caisse('{T}', 'prelevement', '2026-03-03', 20, null, null, null, '[{"compte":"108000","sens":"debit","montant":20},{"compte":"530000","sens":"credit","montant":20,"libelle":"Prélèvement en espèces de l''exploitant"}]')$q$,
      'OK', ''],
    array['controle', '48. la caisse vidée exactement à zéro passe (un solde nul n''est pas négatif)', 'chef', $q$select enregistrer_operation_caisse('{T}', 'prelevement', '2026-03-03', 185.5, null, null, null, '[{"compte":"108000","sens":"debit","montant":185.5},{"compte":"530000","sens":"credit","montant":185.5}]')$q$,
      'OK', ''],

    -- ══ 50 à 56. La saisie d'un mois, dossier L ══════════
    array['controle', '50. une saisie qui n''est pas un tableau', 'chef', $q$select enregistrer_operations_de_caisse('{L}', '{"genre":"apport"}')$q$,
      '22023', 'Une saisie de caisse est un tableau JSON d''opérations.'],
    array['controle', '50b. une saisie vide', 'chef', $q$select enregistrer_operations_de_caisse('{L}', '[]')$q$,
      '22023', 'La saisie ne porte aucune opération.'],
    array['controle', '50c. mille et une opérations', 'chef', $q$select enregistrer_operations_de_caisse('{L}', (select jsonb_agg('{}'::jsonb) from generate_series(1, 1001)))$q$,
      '22023', 'Une saisie range mille opérations au plus ; celle-ci en porte 1001 : la partager.'],
    array['controle', '51. une opération qui n''est pas un objet', 'chef', $q$select enregistrer_operations_de_caisse('{L}', '[1]')$q$,
      '22023', 'Opération n° 1 : Une opération de la saisie est un objet JSON aux champs d''une opération de caisse.'],
    array['controle', '51b. un champ inconnu — un libellé libre n''entre pas', 'chef', $q$select enregistrer_operations_de_caisse('{L}', '[{"genre":"apport","date":"2026-03-09","montant":100,"libelle":"Apport de M. Fictif","ecritures":[]}]')$q$,
      '22023', 'Opération n° 1 : « libelle » n''est pas un champ d''une opération de caisse.'],
    array['controle', '51c. une date en JJ/MM/AAAA', 'chef', $q$select enregistrer_operations_de_caisse('{L}', '[{"genre":"apport","date":"09/03/2026","montant":100,"ecritures":[]}]')$q$,
      '22023', 'Opération n° 1 : La date de l''opération est illisible : elle s''écrit AAAA-MM-JJ.'],
    array['controle', '51d. une date qui n''existe pas', 'chef', $q$select enregistrer_operations_de_caisse('{L}', '[{"genre":"apport","date":"2026-02-30","montant":100,"ecritures":[]}]')$q$,
      '22023', 'Opération n° 1 : La date de l''opération est illisible : elle s''écrit AAAA-MM-JJ.'],
    array['controle', '51e. un montant en texte', 'chef', $q$select enregistrer_operations_de_caisse('{L}', '[{"genre":"apport","date":"2026-03-09","montant":"100","ecritures":[]}]')$q$,
      '22023', 'Opération n° 1 : Une opération de la saisie porte un champ illisible : le genre, la date, la catégorie et les encaissements du jour sont des textes, le montant et le taux des nombres.'],
    array['controle', '51f. une catégorie illisible', 'chef', $q$select enregistrer_operations_de_caisse('{L}', '[{"genre":"recette","date":"2026-03-09","montant":100,"categorie_id":"pas-un-uuid","encaissements_du_jour":[],"ecritures":[]}]')$q$,
      '22023', 'Opération n° 1, du 09/03/2026 : Une opération de la saisie porte un identifiant illisible (sa catégorie ou un encaissement du jour).'],
    array['controle', '52. le premier refus nommé par son rang et son jour ; rien d''écrit', 'chef', $q$select enregistrer_operations_de_caisse('{L}', '[{"genre":"apport","date":"2026-03-09","montant":100,"ecritures":[{"compte":"530000","sens":"debit","montant":100},{"compte":"108000","sens":"credit","montant":100}]},{"genre":"don","date":"2026-03-10","montant":5,"ecritures":[]}]')$q$,
      '22023', 'Opération n° 2, du 10/03/2026 : Une opération de caisse est une recette en espèces, un apport ou un prélèvement de l''exploitant.'],
    array['controle', '52b. … une écriture fausse au rang 3, après une sortie que la saisie couvre', 'chef', $q$select enregistrer_operations_de_caisse('{L}', '[{"genre":"apport","date":"2026-03-09","montant":10,"ecritures":[{"compte":"530000","sens":"debit","montant":10},{"compte":"108000","sens":"credit","montant":10}]},{"genre":"recette","date":"2026-03-09","montant":-5,"categorie_id":"ca155e00-0000-4000-8001-000000000006","encaissements_du_jour":[],"ecritures":[{"compte":"530000","sens":"credit","montant":5},{"compte":"706000","sens":"debit","montant":5}]},{"genre":"apport","date":"2026-03-09","montant":10,"ecritures":[{"compte":"512000","sens":"debit","montant":10},{"compte":"108000","sens":"credit","montant":10}]}]')$q$,
      '22023', 'Opération n° 3, du 09/03/2026 : L''écriture proposée ne correspond pas à cette opération de caisse et au plan du dossier (la caisse : 530000).'],
    array['controle', '53. un jour qui retire avant qu''un autre ajoute : la caisse se juge à la fin', 'chef', $q$select enregistrer_operations_de_caisse('{L}', '[{"genre":"prelevement","date":"2026-03-10","montant":50,"ecritures":[{"compte":"108000","sens":"debit","montant":50},{"compte":"530000","sens":"credit","montant":50}]},{"genre":"apport","date":"2026-03-09","montant":100,"ecritures":[{"compte":"530000","sens":"debit","montant":100},{"compte":"108000","sens":"credit","montant":100}]}]')$q$,
      'OK', ''],
    array['controle', '54. la caisse négative à la fin : refusée, nommée par son jour', 'chef', $q$select enregistrer_operations_de_caisse('{L}', '[{"genre":"apport","date":"2026-03-09","montant":100,"ecritures":[{"compte":"530000","sens":"debit","montant":100},{"compte":"108000","sens":"credit","montant":100}]},{"genre":"prelevement","date":"2026-03-10","montant":150,"ecritures":[{"compte":"108000","sens":"debit","montant":150},{"compte":"530000","sens":"credit","montant":150}]}]')$q$,
      '23514', 'La caisse serait négative le 10/03/2026 (−50,00 €) : saisis d''abord les recettes en espèces qui précèdent ce jour.'],
    array['fait', '55. un mois de trois opérations', 'chef', $q$select enregistrer_operations_de_caisse('{L}', '[{"genre":"apport","date":"2026-03-09","montant":100,"ecritures":[{"compte":"530000","sens":"debit","montant":100},{"compte":"108000","sens":"credit","montant":100}]},{"genre":"recette","date":"2026-03-10","montant":30,"categorie_id":"ca155e00-0000-4000-8001-000000000006","encaissements_du_jour":[],"ecritures":[{"compte":"530000","sens":"debit","montant":30},{"compte":"706000","sens":"credit","montant":30}]},{"genre":"prelevement","date":"2026-03-11","montant":120,"ecritures":[{"compte":"108000","sens":"debit","montant":120},{"compte":"530000","sens":"credit","montant":120}]}]')$q$,
      'OK', ''],
    array['valeur', '55b. … écrites avec leurs six lignes, rien d''autre (les refus d''avant n''ont rien laissé)', 'postgres', $q$select (select count(*) from operations_caisse where dossier_id = '{L}') || '/' || (select count(*) from ecritures_brouillon b join operations_caisse o on o.id = b.operation_caisse_id where o.dossier_id = '{L}')$q$, '', '3/6'],
    array['controle', '56. une opération seule, après le mois : sa caisse jugée à la fin de l''appel', 'chef', $q$select enregistrer_operation_caisse('{L}', 'prelevement', '2026-03-12', 20, null, null, null, '[{"compte":"108000","sens":"debit","montant":20},{"compte":"530000","sens":"credit","montant":20}]')$q$,
      '23514', 'Ce prélèvement de 20,00 € rendrait la caisse négative le 12/03/2026 (−10,00 €) : saisis d''abord les recettes en espèces qui le précèdent.'],
    array['valeur', '56b. le réglage de la saisie d''un mois ne survit pas à la saisie', 'postgres', $q$select coalesce(current_setting('jd.caisse_d_un_lot', true), '') || '|' || coalesce(current_setting('jd.caisse', true), '')$q$, '', '|'],

    -- ══ 57 à 59. Les comptes viennent du plan du dossier, jamais en dur : P range sa caisse au 531000 ══════════
    array['jeu', '57. le plan de P, restauré par le super-administrateur avant toute écriture : la caisse au 531000, l''exploitant au 108100', 'postgres', $q$select set_config('request.jwt.claims', json_build_object('sub', '{CHEF}', 'role', 'authenticated')::text, true);
      insert into plan_comptable_dossier (dossier_id, role, compte, origine) values ('{P}', 'caisse', '531000', 'dossier'), ('{P}', 'exploitant', '108100', 'dossier');
      select set_config('request.jwt.claims', '', true)$q$, '', ''],
    array['valeur', '57a. … que la base lit', 'postgres', $q$select compte_du_role('{P}', 'caisse') || '/' || compte_du_dirigeant('{P}')$q$, '', '531000/108100'],
    array['controle', '57b. un apport écrit au 530000 du catalogue se refuse, la caisse du plan nommée', 'chef', $q$select enregistrer_operation_caisse('{P}', 'apport', '2026-03-01', 10, null, null, null, '[{"compte":"530000","sens":"debit","montant":10},{"compte":"108000","sens":"credit","montant":10}]')$q$,
      '22023', 'L''écriture proposée ne correspond pas à cette opération de caisse et au plan du dossier (la caisse : 531000).'],
    array['fait', '58. un apport de 10 € au 531000, face au 108100', 'chef', $q$select enregistrer_operation_caisse('{P}', 'apport', '2026-03-01', 10, null, null, null, '[{"compte":"531000","sens":"debit","montant":10},{"compte":"108100","sens":"credit","montant":10}]')$q$,
      'OK', ''],
    array['controle', '58b. un prélèvement de 15 € : la caisse du plan, de 10 €, ne le couvre pas', 'chef', $q$select enregistrer_operation_caisse('{P}', 'prelevement', '2026-03-02', 15, null, null, null, '[{"compte":"108100","sens":"debit","montant":15},{"compte":"531000","sens":"credit","montant":15}]')$q$,
      '23514', 'Ce prélèvement de 15,00 € rendrait la caisse négative le 02/03/2026 (−5,00 €) : saisis d''abord les recettes en espèces qui le précèdent.'],
    array['controle', '59. un versement classé sur le 531000 du plan vide la caisse de P', 'chef', $q$update lignes_bancaires set compte_bilan = '531000', statut = 'rapprochee' where id = '{MP1}'$q$,
      '23514', 'Ce versement de 20,00 € rendrait la caisse négative le 05/03/2026 (−10,00 €) : saisis d''abord les recettes en espèces qui le précèdent.'],
    array['controle', '59b. … classé sur le 530000, qui n''est pas sa caisse, non', 'chef', $q$update lignes_bancaires set compte_bilan = '530000', statut = 'rapprochee' where id = '{MP1}'$q$,
      'OK', ''],

    -- ══ 60 à 65. L'ensemble du jour, dossier B (basculé) : sa facture source et ses espèces ══════════
    array['fait', '60. une facture source de B, validée', 'chef', $q$select enregistrer_facture('{B}', null, {FACTURE})$q$, 'OK', ''],
    array['fait', '60b. ses encaissements : deux en espèces et un virement le 10/03, des espèces du 11/03 remises par le crédit du 12/03, des espèces le 14/03', 'chef', $q$select enregistrer_encaissement('{B}', f.id, '2026-03-10', 30, 'especes', null, '[{"taux":20,"montant":30}]'),
        enregistrer_encaissement('{B}', f.id, '2026-03-10', 20, 'especes', null, '[{"taux":20,"montant":20}]'),
        enregistrer_encaissement('{B}', f.id, '2026-03-10', 10, 'virement', null, '[{"taux":20,"montant":10}]'),
        enregistrer_encaissement('{B}', f.id, '2026-03-11', 15, 'especes', '{MB1}', '[{"taux":20,"montant":15}]'),
        enregistrer_encaissement('{B}', f.id, '2026-03-14', 25, 'especes', null, '[{"taux":20,"montant":25}]')
      from factures_emises f where f.dossier_id = '{B}' and f.type = 'facture'$q$, 'OK', ''],
    array['jeu', '60c. la contre-passation sans mouvement des espèces du 14/03, le 15/03, et sa part', 'postgres', $q$insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, annule_id, motif)
      select e.dossier_id, e.facture_id, '2026-03-15', -e.montant, e.moyen, e.id, 'ESSAI CAISSE' from encaissements_factures e where e.dossier_id = '{B}' and e.date_encaissement = '2026-03-14';
      insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant)
      select a.id, a.dossier_id, 20, a.montant from encaissements_factures a where a.dossier_id = '{B}' and a.date_encaissement = '2026-03-15'$q$, '', ''],
    array['valeur', '60d. la facture est la source de sa vente, ses six lignes de registre là, chacune avec sa part', 'postgres', $q$select (select string_agg(f.source_de_la_vente::text, ',') from factures_emises f where f.dossier_id = '{B}') || '/'
      || (select count(*) from encaissements_factures e where e.dossier_id = '{B}') || '/' || (select count(*) from encaissements_factures_taux t where t.dossier_id = '{B}')$q$, '', 'true/6/6'],
    array['fait', '61. une recette du 10/03 qui reconnaît ses deux encaissements en espèces, dans le désordre', 'chef', $q$select enregistrer_operation_caisse('{B}', 'recette', '2026-03-10', 40, '{KB}', null,
        array(select e.id from encaissements_factures e where e.dossier_id = '{B}' and e.date_encaissement = '2026-03-10' and e.moyen = 'especes' order by e.id desc),
        '[{"compte":"530000","sens":"debit","montant":40},{"compte":"706000","sens":"credit","montant":40}]')$q$, 'OK', ''],
    array['valeur', '61b. … l''ensemble gardé trié, tel que la base le compte', 'postgres', $q$select (o.encaissements_du_jour = array(select e.id from encaissements_factures e where e.dossier_id = '{B}' and e.date_encaissement = '2026-03-10' and e.moyen = 'especes' order by e.id))::text
        || '/' || cardinality(o.encaissements_du_jour)
      from operations_caisse o where o.dossier_id = '{B}' and o.genre = 'recette'$q$, '', 'true/2'],
    array['controle', '62. … un encaissement de moins : enregistré depuis la lecture', 'chef', $q$select enregistrer_operation_caisse('{B}', 'recette', '2026-03-10', 40, '{KB}', null,
        array(select e.id from encaissements_factures e where e.dossier_id = '{B}' and e.date_encaissement = '2026-03-10' and e.moyen = 'especes' and e.montant = 30),
        '[{"compte":"530000","sens":"debit","montant":40},{"compte":"706000","sens":"credit","montant":40}]')$q$,
      '22023', 'Un encaissement en espèces de la facture F2026-0001 du même jour a été enregistré depuis ta lecture : relis la caisse.'],
    array['controle', '62b. … un de plus : le virement du même jour', 'chef', $q$select enregistrer_operation_caisse('{B}', 'recette', '2026-03-10', 40, '{KB}', null,
        array(select e.id from encaissements_factures e where e.dossier_id = '{B}' and e.date_encaissement = '2026-03-10'),
        '[{"compte":"530000","sens":"debit","montant":40},{"compte":"706000","sens":"credit","montant":40}]')$q$,
      '22023', 'L''encaissement de la facture F2026-0001 que ta lecture comptait n''est pas dans la caisse de ce jour : relis la caisse.'],
    array['controle', '62c. … un identifiant qui n''est pas un encaissement du dossier', 'chef', $q$select enregistrer_operation_caisse('{B}', 'recette', '2026-03-10', 40, '{KB}', null,
        array(select e.id from encaissements_factures e where e.dossier_id = '{B}' and e.date_encaissement = '2026-03-10' and e.moyen = 'especes') || 'ca155e00-0000-4000-8000-0000000000ee'::uuid,
        '[{"compte":"530000","sens":"debit","montant":40},{"compte":"706000","sens":"credit","montant":40}]')$q$,
      '22023', 'Un encaissement que ta lecture comptait n''est pas un encaissement de ce dossier : relis la caisse.'],
    array['controle', '62d. … un encaissement nommé deux fois', 'chef', $q$select enregistrer_operation_caisse('{B}', 'recette', '2026-03-10', 40, '{KB}', null,
        array(select e.id from encaissements_factures e where e.dossier_id = '{B}' and e.date_encaissement = '2026-03-10' and e.moyen = 'especes')
          || array(select e.id from encaissements_factures e where e.dossier_id = '{B}' and e.date_encaissement = '2026-03-10' and e.moyen = 'especes' and e.montant = 30),
        '[{"compte":"530000","sens":"debit","montant":40},{"compte":"706000","sens":"credit","montant":40}]')$q$,
      '22023', 'La saisie d''une recette nomme chaque encaissement de son jour une seule fois.'],
    array['controle', '62e. … un identifiant nul dans la liste', 'chef', $q$select enregistrer_operation_caisse('{B}', 'recette', '2026-03-10', 40, '{KB}', null, array[null]::uuid[], '[]')$q$,
      '22023', 'La saisie d''une recette dit les encaissements en espèces de factures de son jour qu''elle a lus : une liste d''identifiants, vide s''il n''y en a aucun.'],
    array['controle', '63. le 11/03 : les espèces remises en banque par leur mouvement ne sont pas dans la caisse du jour', 'chef', $q$select enregistrer_operation_caisse('{B}', 'recette', '2026-03-11', 40, '{KB}', null, '{}',
        '[{"compte":"530000","sens":"debit","montant":40},{"compte":"706000","sens":"credit","montant":40}]')$q$, 'OK', ''],
    array['controle', '63b. … et les reconnaître se refuse', 'chef', $q$select enregistrer_operation_caisse('{B}', 'recette', '2026-03-11', 40, '{KB}', null,
        array(select e.id from encaissements_factures e where e.dossier_id = '{B}' and e.date_encaissement = '2026-03-11'),
        '[{"compte":"530000","sens":"debit","montant":40},{"compte":"706000","sens":"credit","montant":40}]')$q$,
      '22023', 'L''encaissement de la facture F2026-0001 que ta lecture comptait n''est pas dans la caisse de ce jour : relis la caisse.'],
    array['controle', '64. le 15/03 : la contre-passation sans mouvement est dans la caisse du jour', 'chef', $q$select enregistrer_operation_caisse('{B}', 'recette', '2026-03-15', 40, '{KB}', null,
        array(select e.id from encaissements_factures e where e.dossier_id = '{B}' and e.date_encaissement = '2026-03-15'),
        '[{"compte":"530000","sens":"debit","montant":40},{"compte":"706000","sens":"credit","montant":40}]')$q$, 'OK', ''],
    array['controle', '64b. … et l''oublier se refuse, la facture nommée', 'chef', $q$select enregistrer_operation_caisse('{B}', 'recette', '2026-03-15', 40, '{KB}', null, '{}',
        '[{"compte":"530000","sens":"debit","montant":40},{"compte":"706000","sens":"credit","montant":40}]')$q$,
      '22023', 'Un encaissement en espèces de la facture F2026-0001 du même jour a été enregistré depuis ta lecture : relis la caisse.'],
    array['fait', '64c. des espèces de 5 € le 21/03, retirées (rien ne les avait dépensées)', 'chef', $q$select enregistrer_encaissement('{B}', f.id, '2026-03-21', 5, 'especes', null, '[{"taux":20,"montant":5}]') from factures_emises f where f.dossier_id = '{B}';
      select retirer_encaissement('{B}', e.id) from encaissements_factures e where e.dossier_id = '{B}' and e.date_encaissement = '2026-03-21'$q$, 'OK', ''],
    array['controle', '64d. … la recette du 21/03 ne les compte plus', 'chef', $q$select enregistrer_operation_caisse('{B}', 'recette', '2026-03-21', 40, '{KB}', null, '{}',
        '[{"compte":"530000","sens":"debit","montant":40},{"compte":"706000","sens":"credit","montant":40}]')$q$, 'OK', ''],
    array['controle', '64e. … et les reconnaître se refuse', 'chef', $q$select enregistrer_operation_caisse('{B}', 'recette', '2026-03-21', 40, '{KB}', null,
        array(select e.id from encaissements_factures e where e.dossier_id = '{B}' and e.date_encaissement = '2026-03-21'),
        '[{"compte":"530000","sens":"debit","montant":40},{"compte":"706000","sens":"credit","montant":40}]')$q$,
      '22023', 'L''encaissement de la facture F2026-0001 que ta lecture comptait n''est pas dans la caisse de ce jour : relis la caisse.'],
    array['controle', '65. un dossier qui n''a pas basculé : l''encaissement en espèces de sa facture n''est pas dans sa caisse', 'chef', $q$select enregistrer_facture('{T}', null, {FACTURE});
      select enregistrer_encaissement('{T}', f.id, '2026-03-02', 100, 'especes', null, '[{"taux":20,"montant":100}]') from factures_emises f where f.dossier_id = '{T}';
      select enregistrer_operation_caisse('{T}', 'recette', '2026-03-02', 1, '{KT}', null, array(select e.id from encaissements_factures e where e.dossier_id = '{T}'),
        '[{"compte":"530000","sens":"debit","montant":1},{"compte":"706000","sens":"credit","montant":1}]')$q$,
      '22023', 'L''encaissement de la facture F2026-0001 que ta lecture comptait n''est pas dans la caisse de ce jour : relis la caisse.'],

    array['controle', '65b. … ni ne la remplit : un prélèvement qu''elles seules couvriraient se refuse', 'chef', $q$select enregistrer_facture('{T}', null, {FACTURE});
      select enregistrer_encaissement('{T}', f.id, '2026-03-02', 100, 'especes', null, '[{"taux":20,"montant":100}]') from factures_emises f where f.dossier_id = '{T}';
      select enregistrer_operation_caisse('{T}', 'prelevement', '2026-03-03', 250, null, null, null, '[{"compte":"108000","sens":"debit","montant":250},{"compte":"530000","sens":"credit","montant":250}]')$q$,
      '23514', 'Ce prélèvement de 250,00 € rendrait la caisse négative le 03/03/2026 (−64,50 €) : saisis d''abord les recettes en espèces qui le précèdent.'],

    -- ══ 70 à 76. La caisse jamais négative, par chacun de ses chemins ══════════
    -- Une opération (T : 100 le 01/03, 85,50 le 02/03).
    array['controle', '70. un prélèvement qui viderait la caisse', 'chef', $q$select enregistrer_operation_caisse('{T}', 'prelevement', '2026-03-03', 500, null, null, null, '[{"compte":"108000","sens":"debit","montant":500},{"compte":"530000","sens":"credit","montant":500}]')$q$,
      '23514', 'Ce prélèvement de 500,00 € rendrait la caisse négative le 03/03/2026 (−314,50 €) : saisis d''abord les recettes en espèces qui le précèdent.'],
    array['controle', '70b. … daté AVANT les recettes qui le couvriraient', 'chef', $q$select enregistrer_operation_caisse('{T}', 'prelevement', '2026-03-01', 150, null, null, null, '[{"compte":"108000","sens":"debit","montant":150},{"compte":"530000","sens":"credit","montant":150}]')$q$,
      '23514', 'Ce prélèvement de 150,00 € rendrait la caisse négative le 01/03/2026 (−50,00 €) : saisis d''abord les recettes en espèces qui le précèdent.'],
    array['controle', '70c. des espèces rendues qui la videraient', 'chef', $q$select enregistrer_operation_caisse('{T}', 'recette', '2026-03-03', -200, '{KT}', null, '{}', '[{"compte":"530000","sens":"credit","montant":200},{"compte":"706000","sens":"debit","montant":200}]')$q$,
      '23514', 'Ces espèces rendues, 200,00 €, rendraient la caisse négative le 03/03/2026 (−14,50 €) : saisis d''abord les recettes en espèces qui les précèdent.'],
    array['controle', '70d. le même prélèvement, couvert : passe (le refus de 70 n''est pas aveugle)', 'chef', $q$select enregistrer_operation_caisse('{T}', 'prelevement', '2026-03-03', 50, null, null, null, '[{"compte":"108000","sens":"debit","montant":50},{"compte":"530000","sens":"credit","montant":50}]')$q$,
      'OK', ''],
    -- Le refus d'une sortie se dit dans l'appel même, par la fonction, et non seulement à la fin de la transaction
    -- par les déclencheurs : l'instruction qui suit l'appel ne s'exécute pas.
    array['controle', '70e. le refus d''un prélèvement vient de la fonction, dans l''appel même', 'chef', $q$select enregistrer_operation_caisse('{T}', 'prelevement', '2026-03-03', 500, null, null, null, '[{"compte":"108000","sens":"debit","montant":500},{"compte":"530000","sens":"credit","montant":500}]');
      select 1 / 0$q$,
      '23514', 'Ce prélèvement de 500,00 € rendrait la caisse négative le 03/03/2026 (−314,50 €) : saisis d''abord les recettes en espèces qui le précèdent.'],
    array['controle', '70f. … celui d''espèces rendues aussi', 'chef', $q$select enregistrer_operation_caisse('{T}', 'recette', '2026-03-03', -200, '{KT}', null, '{}', '[{"compte":"530000","sens":"credit","montant":200},{"compte":"706000","sens":"debit","montant":200}]');
      select 1 / 0$q$,
      '23514', 'Ces espèces rendues, 200,00 €, rendraient la caisse négative le 03/03/2026 (−14,50 €) : saisis d''abord les recettes en espèces qui les précèdent.'],
    -- Un versement en banque : un crédit du relevé classé sur le compte de la caisse, ici en direct, comme la RLS le
    -- permet au cabinet (la fonction du relevé l'apprendra à l'étape C1b).
    array['controle', '71. un versement qui viderait la caisse', 'chef', $q$update lignes_bancaires set compte_bilan = '530000', statut = 'rapprochee' where id = '{MV1}'$q$,
      '23514', 'Ce versement de 500,00 € rendrait la caisse négative le 05/03/2026 (−314,50 €) : saisis d''abord les recettes en espèces qui le précèdent.'],
    array['controle', '71b. … couvert dans la même transaction par un apport : la caisse se juge à la fin', 'chef', $q$update lignes_bancaires set compte_bilan = '530000', statut = 'rapprochee' where id = '{MV1}';
      select enregistrer_operation_caisse('{T}', 'apport', '2026-03-04', 400, null, null, null, '[{"compte":"530000","sens":"debit","montant":400},{"compte":"108000","sens":"credit","montant":400}]')$q$,
      'OK', ''],
    array['controle', '71c. un versement classé sur un autre compte 53 ne touche pas la caisse du dossier', 'chef', $q$update lignes_bancaires set compte_bilan = '531000', statut = 'rapprochee' where id = '{MV1}'$q$,
      'OK', ''],
    -- Un retrait d'espèces pour la caisse : un débit du relevé classé sur son compte.
    array['fait', '72. un retrait de 200 € pour la caisse, le 06/03', 'chef', $q$update lignes_bancaires set compte_bilan = '530000', statut = 'rapprochee' where id = '{MD1}'$q$, 'OK', ''],
    array['fait', '72b. un prélèvement de 320 € le 07/03, que le retrait couvre', 'chef', $q$select enregistrer_operation_caisse('{T}', 'prelevement', '2026-03-07', 320, null, null, null, '[{"compte":"108000","sens":"debit","montant":320},{"compte":"530000","sens":"credit","montant":320}]')$q$,
      'OK', ''],
    array['controle', '72c. déclasser le retrait se refuse', 'chef', $q$update lignes_bancaires set compte_bilan = null, statut = 'non_rapprochee' where id = '{MD1}'$q$,
      '23514', 'Retirer ce retrait d''espèces de 200,00 € pour la caisse rendrait la caisse négative le 07/03/2026 (−134,50 €) : retire d''abord les sorties d''espèces qui le suivent.'],
    array['controle', '72d. … le dater après le prélèvement aussi', 'chef', $q$update lignes_bancaires set date = '2026-03-08' where id = '{MD1}'$q$,
      '23514', 'Ce changement d''un mouvement classé sur la caisse la rendrait négative le 07/03/2026 (−134,50 €).'],
    array['controle', '72e. … le dater plus tôt passe', 'chef', $q$update lignes_bancaires set date = '2026-03-04' where id = '{MD1}'$q$,
      'OK', ''],
    array['controle', '72f. … un mouvement sans compte de bilan qui change ne se juge pas', 'chef', $q$update lignes_bancaires set libelle = 'ESSAI VERSEMENT ESPECES (bis)' where id = '{MV1}'$q$,
      'OK', ''],
    array['controle', '72g. … le déplacer dans un autre dossier aussi : la caisse qu''il quitte se juge', 'chef', $q$update lignes_bancaires set dossier_id = '{G}' where id = '{MD1}'$q$,
      '23514', 'Ce changement d''un mouvement classé sur la caisse la rendrait négative le 07/03/2026 (−134,50 €).'],
    array['controle', '72h. … ou dans un dossier dont la caisse est un autre compte : pour la caisse qu''il quitte, il est retiré', 'chef', $q$update lignes_bancaires set dossier_id = '{P}' where id = '{MD1}'$q$,
      '23514', 'Retirer ce retrait d''espèces de 200,00 € pour la caisse rendrait la caisse négative le 07/03/2026 (−134,50 €) : retire d''abord les sorties d''espèces qui le suivent.'],
    -- Une opération retirée : le retrait (la fonction de l'étape C1b), simulé sous son réglage, par le propriétaire.
    array['controle', '73. retirer l''apport qui couvre le prélèvement', 'postgres', $q$select set_config('jd.caisse', (select id::text from operations_caisse where dossier_id = '{T}' and genre = 'apport'), true);
      update operations_caisse set retire_le = now(), retire_par = '{CHEF}' where dossier_id = '{T}' and genre = 'apport'$q$,
      '23514', 'Retirer cet apport de 100,00 € rendrait la caisse négative le 07/03/2026 (−34,50 €) : retire d''abord les sorties d''espèces qui le suivent.'],
    array['controle', '73b. retirer la recette', 'postgres', $q$select set_config('jd.caisse', (select id::text from operations_caisse where dossier_id = '{T}' and genre = 'recette'), true);
      update operations_caisse set retire_le = now(), retire_par = '{CHEF}' where dossier_id = '{T}' and genre = 'recette'$q$,
      '23514', 'Retirer cette recette de 85,50 € rendrait la caisse négative le 07/03/2026 (−20,00 €) : retire d''abord les sorties d''espèces qui la suivent.'],
    array['controle', '73c. retirer le prélèvement passe', 'postgres', $q$select set_config('jd.caisse', (select id::text from operations_caisse where dossier_id = '{T}' and genre = 'prelevement'), true);
      update operations_caisse set retire_le = now(), retire_par = '{CHEF}' where dossier_id = '{T}' and genre = 'prelevement'$q$,
      'OK', ''],
    -- Un encaissement en espèces : B compte 90 le 10/03 (30 et 20 d'espèces de la facture, 40 de recettes), 25 le
    -- 14/03, −25 le 15/03 ; un prélèvement de 90 le 13/03 la vide exactement.
    array['fait', '74. un prélèvement de 90 € le 13/03 dans B', 'chef', $q$select enregistrer_operation_caisse('{B}', 'prelevement', '2026-03-13', 90, null, null, null, '[{"compte":"108000","sens":"debit","montant":90},{"compte":"530000","sens":"credit","montant":90}]')$q$,
      'OK', ''],
    array['controle', '74b. retirer un encaissement en espèces dont les espèces ont servi', 'chef', $q$select retirer_encaissement('{B}', e.id) from encaissements_factures e where e.dossier_id = '{B}' and e.date_encaissement = '2026-03-10' and e.montant = 20$q$,
      '23514', 'Retirer cet encaissement de 20,00 € en espèces rendrait la caisse négative le 13/03/2026 (−20,00 €) : ses espèces ont déjà servi.'],
    array['controle', '74c. le rattacher à un crédit du relevé', 'chef', $q$select rattacher_mouvement_encaissement('{B}', e.id, '{MB2}') from encaissements_factures e where e.dossier_id = '{B}' and e.date_encaissement = '2026-03-10' and e.montant = 30$q$,
      '23514', 'Rattacher à un mouvement cet encaissement de 30,00 € en espèces rendrait la caisse négative le 13/03/2026 (−30,00 €) : ses espèces ont déjà servi.'],
    array['fait', '74d. des espèces de 20 € le 16/03, puis un prélèvement de 20 € le 17/03', 'chef', $q$select enregistrer_encaissement('{B}', f.id, '2026-03-16', 20, 'especes', null, '[{"taux":20,"montant":20}]') from factures_emises f where f.dossier_id = '{B}';
      select enregistrer_operation_caisse('{B}', 'prelevement', '2026-03-17', 20, null, null, null, '[{"compte":"108000","sens":"debit","montant":20},{"compte":"530000","sens":"credit","montant":20}]')$q$,
      'OK', ''],
    array['controle', '74e. une contre-passation sans mouvement de ces espèces, le 18/03', 'chef', $q$insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, annule_id, motif)
      select e.dossier_id, e.facture_id, '2026-03-18', -e.montant, e.moyen, e.id, 'ESSAI CAISSE' from encaissements_factures e where e.dossier_id = '{B}' and e.date_encaissement = '2026-03-16';
      insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant)
      select a.id, a.dossier_id, 20, a.montant from encaissements_factures a where a.dossier_id = '{B}' and a.date_encaissement = '2026-03-18'$q$,
      '23514', 'Cette contre-passation de 20,00 € en espèces rendrait la caisse négative le 18/03/2026 (−20,00 €) : la caisse n''a plus ces espèces ce jour-là.'],
    array['controle', '74f. … celle qui cite le débit qui les a rendues ne touche pas la caisse', 'chef', $q$select annuler_encaissement('{B}', e.id, '2026-03-18', 'ESSAI CAISSE', '{MB3}') from encaissements_factures e where e.dossier_id = '{B}' and e.date_encaissement = '2026-03-16'$q$,
      'OK', ''],
    array['controle', '74g. un encaissement en espèces de plus ne se juge pas (il ne fait que remplir)', 'chef', $q$select enregistrer_encaissement('{B}', f.id, '2026-03-19', 0.01, 'especes', null, '[{"taux":20,"montant":0.01}]') from factures_emises f where f.dossier_id = '{B}'$q$,
      'OK', ''],
    -- Deux contre-passations sans mouvement, gardées : la caisse lue de B (76b) ne les compte pas.
    array['fait', '74h. la contre-passation sans mouvement d''un virement ne touche pas la caisse', 'chef', $q$insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, annule_id, motif)
      select e.dossier_id, e.facture_id, '2026-03-13', -e.montant, e.moyen, e.id, 'ESSAI CAISSE' from encaissements_factures e where e.dossier_id = '{B}' and e.moyen = 'virement';
      insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant)
      select a.id, a.dossier_id, 20, a.montant from encaissements_factures a
       where a.annule_id = (select e.id from encaissements_factures e where e.dossier_id = '{B}' and e.moyen = 'virement' and e.annule_id is null)$q$,
      'OK', ''],
    array['fait', '74i. … ni celle d''espèces remises en banque par leur mouvement', 'chef', $q$insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, annule_id, motif)
      select e.dossier_id, e.facture_id, '2026-03-13', -e.montant, e.moyen, e.id, 'ESSAI CAISSE' from encaissements_factures e where e.dossier_id = '{B}' and e.date_encaissement = '2026-03-11';
      insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant)
      select a.id, a.dossier_id, 20, a.montant from encaissements_factures a
       where a.annule_id = (select e.id from encaissements_factures e where e.dossier_id = '{B}' and e.date_encaissement = '2026-03-11')$q$,
      'OK', ''],
    -- L'ouverture du compte de la caisse : O, repris au 1er janvier 2026.
    array['controle', '75. une ouverture de la caisse au crédit', 'chef', $q$insert into a_nouveaux (id, dossier_id, date, compte, sens, montant, source_nom, source_empreinte) values ('{AN3}', '{O}', '2026-01-01', '530000', 'credit', 50, 'balance-essai-caisse.csv', repeat('c', 64))$q$,
      '23514', 'Une ouverture de la caisse au crédit, 50,00 €, la rendrait négative le 01/01/2026 (−50,00 €) : le solde d''une caisse est débiteur ou nul.'],
    array['fait', '75b. une ouverture de la caisse au débit, 50 €', 'chef', $q$insert into a_nouveaux (id, dossier_id, date, compte, sens, montant, source_nom, source_empreinte) values ('{AN4}', '{O}', '2026-01-01', '530000', 'debit', 50, 'balance-essai-caisse.csv', repeat('c', 64))$q$,
      'OK', ''],
    array['controle', '75c. un prélèvement qu''elle ne couvre pas', 'chef', $q$select enregistrer_operation_caisse('{O}', 'prelevement', '2026-02-01', 60, null, null, null, '[{"compte":"108000","sens":"debit","montant":60},{"compte":"530000","sens":"credit","montant":60}]')$q$,
      '23514', 'Ce prélèvement de 60,00 € rendrait la caisse négative le 01/02/2026 (−10,00 €) : saisis d''abord les recettes en espèces qui le précèdent.'],
    array['fait', '75d. un prélèvement qu''elle couvre', 'chef', $q$select enregistrer_operation_caisse('{O}', 'prelevement', '2026-02-01', 45, null, null, null, '[{"compte":"108000","sens":"debit","montant":45},{"compte":"530000","sens":"credit","montant":45}]')$q$,
      'OK', ''],
    array['controle', '75e. réduire l''ouverture se refuse', 'chef', $q$update a_nouveaux set montant = 40 where id = '{AN4}'$q$,
      '23514', 'Ce changement de l''ouverture de la caisse la rendrait négative le 01/02/2026 (−5,00 €).'],
    array['controle', '75f. une ouverture sur un autre compte 53 ne compte pas dans la caisse du dossier', 'chef', $q$insert into a_nouveaux (id, dossier_id, date, compte, sens, montant, source_nom, source_empreinte) values ('{AN5}', '{O}', '2026-01-01', '531000', 'debit', 1000, 'balance-essai-caisse.csv', repeat('c', 64));
      select enregistrer_operation_caisse('{O}', 'prelevement', '2026-02-02', 10, null, null, null, '[{"compte":"108000","sens":"debit","montant":10},{"compte":"530000","sens":"credit","montant":10}]')$q$,
      '23514', 'Ce prélèvement de 10,00 € rendrait la caisse négative le 02/02/2026 (−5,00 €) : saisis d''abord les recettes en espèces qui le précèdent.'],
    array['controle', '75g. l''ouverture de la caisse portée sur un autre compte : la caisse la perd', 'chef', $q$update a_nouveaux set compte = '512000' where id = '{AN4}'$q$,
      '23514', 'Retirer l''ouverture de la caisse, 50,00 €, la rendrait négative le 01/02/2026 (−45,00 €) : retire d''abord les sorties d''espèces qui la suivent.'],
    array['valeur', '76. la caisse lue de O : aucun jour négatif', 'postgres', $q$select coalesce((select n.jour || ' ' || n.solde from premier_jour_negatif_de_la_caisse('{O}') n), 'aucun')$q$, '', 'aucun'],
    array['valeur', '76b. la caisse lue de B : aucun jour négatif', 'postgres', $q$select coalesce((select n.jour || ' ' || n.solde from premier_jour_negatif_de_la_caisse('{B}') n), 'aucun')$q$, '', 'aucun'],
    array['valeur', '76c. la caisse lue de T : aucun jour négatif', 'postgres', $q$select coalesce((select n.jour || ' ' || n.solde from premier_jour_negatif_de_la_caisse('{T}') n), 'aucun')$q$, '', 'aucun'],

    -- ══ 80 à 84. La frontière de la validation : V, une opération de 2025, puis l'exercice 2025 validé ══════════
    array['fait', '80. un apport de juin 2025 dans V, avant la validation', 'chef', $q$select enregistrer_operation_caisse('{V}', 'apport', '2025-06-01', 100, null, null, null, '[{"compte":"530000","sens":"debit","montant":100},{"compte":"108000","sens":"credit","montant":100}]')$q$,
      'OK', ''],
    array['jeu', 'l''exercice 2025 de V, validé', 'postgres', $q$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte, declaration)
      values ('{V}', 2025, now(), '{CHEF}', 'tresorerie', 0, 0, 0, 0, repeat('a', 64), '{}')$q$, '', ''],
    array['controle', '16. une opération du 31 décembre de l''exercice validé', 'chef', $q$select enregistrer_operation_caisse('{V}', 'apport', '2025-12-31', 10, null, null, null, '[]')$q$,
      '23514', 'L''exercice 2025 est validé : sa caisse ne change plus.'],
    array['controle', '16b. ordre : la frontière avant le montant', 'chef', $q$select enregistrer_operation_caisse('{V}', 'apport', '2025-12-31', 0, '{KV}', null, null, '[]')$q$,
      '23514', 'L''exercice 2025 est validé : sa caisse ne change plus.'],
    array['controle', '81. le 1er janvier qui suit passe', 'chef', $q$select enregistrer_operation_caisse('{V}', 'apport', '2026-01-01', 10, null, null, null, '[{"compte":"530000","sens":"debit","montant":10},{"compte":"108000","sens":"credit","montant":10}]')$q$,
      'OK', ''],
    array['controle', '82. le retrait d''une opération de l''exercice validé, même sous le réglage', 'postgres', $q$select set_config('jd.caisse', (select id::text from operations_caisse where dossier_id = '{V}'), true);
      update operations_caisse set retire_le = now(), retire_par = '{CHEF}' where dossier_id = '{V}'$q$,
      '23514', 'L''exercice 2025 est validé : sa caisse ne change plus.'],
    array['controle', '82b. une insertion sous le réglage, datée de l''exercice validé : la garde la refuse', 'postgres', $q$select set_config('jd.caisse', '{X9}', true); insert into operations_caisse (id, dossier_id, genre, date, montant, origine) values ('{X9}', '{V}', 'apport', '2025-06-02', 10, 'cabinet')$q$,
      '23514', 'L''exercice 2025 est validé : sa caisse ne change plus.'],
    array['controle', '83. la porte de la restauration se ferme dès qu''un exercice est validé', 'chef', $q$insert into operations_caisse (dossier_id, genre, date, montant, origine, cree_le) values ('{V}', 'apport', '2026-02-01', 10, 'cabinet', '2026-01-15 10:00+01')$q$,
      '42501', 'Une opération de caisse ne s''écrit que par les fonctions de la caisse, avec son écriture.'],
    array['controle', '84. … de même pour l''écriture d''une opération', 'chef', $q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, operation_caisse_id)
      select '{V}', '2025-06-01', '530000', 'x', 1, 'debit', o.id from operations_caisse o where o.dossier_id = '{V}'$q$,
      '42501', 'L''écriture d''une opération de caisse ne s''écrit qu''avec cette opération, par la fonction de la caisse.'],

    -- ══ 85 à 89. La restauration : R, sans exercice validé, par le super-administrateur ══════════
    array['controle', '85. une opération réinsérée qui vide la caisse passe (un état partiel)', 'chef', $q$insert into operations_caisse (id, dossier_id, genre, date, montant, origine, cree_le, cree_par) values ('{X1}', '{R}', 'prelevement', '2026-02-01', 1000, 'cabinet', '2026-01-15 10:00+01', '{CHEF}')$q$,
      'OK', ''],
    array['controle', '85b. … créée dans la transaction, elle se juge', 'chef', $q$insert into operations_caisse (id, dossier_id, genre, date, montant, origine, cree_par) values ('{X1}', '{R}', 'prelevement', '2026-02-01', 1000, 'cabinet', '{CHEF}')$q$,
      '23514', 'Ce prélèvement de 1000,00 € rendrait la caisse négative le 01/02/2026 (−1000,00 €) : saisis d''abord les recettes en espèces qui le précèdent.'],
    array['controle', '85c. une opération retirée, réinsérée telle quelle, une autre et son écriture', 'chef', $q$insert into operations_caisse (id, dossier_id, genre, date, montant, categorie_id, encaissements_du_jour, origine, cree_le, cree_par, retire_le, retire_par)
      values ('{X2}', '{R}', 'recette', '2026-02-02', 40, '{KR}', '{}', 'cabinet', '2026-01-15 10:00+01', '{CHEF}', '2026-01-16 10:00+01', '{CHEF}');
      insert into operations_caisse (id, dossier_id, genre, date, montant, origine, cree_le, cree_par) values ('{X3}', '{R}', 'apport', '2026-02-03', 40, 'cabinet', '2026-01-15 10:00+01', '{CHEF}');
      insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, operation_caisse_id) values
        ('{R}', '2026-02-03', '530000', 'Apport en caisse de l''exploitant', 40, 'debit', '{X3}'), ('{R}', '2026-02-03', '108000', 'Apport en caisse de l''exploitant', 40, 'credit', '{X3}')$q$,
      'OK', ''],
    array['controle', '85d. … une écriture qui n''est pas au jour de son opération', 'chef', $q$insert into operations_caisse (id, dossier_id, genre, date, montant, origine, cree_le, cree_par) values ('{X3}', '{R}', 'apport', '2026-02-03', 40, 'cabinet', '2026-01-15 10:00+01', '{CHEF}');
      insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, operation_caisse_id) values ('{R}', '2026-02-04', '530000', 'x', 40, 'debit', '{X3}')$q$,
      '23514', 'Cette écriture ne suit pas son opération de caisse : son dossier, sa date, ou sa pièce.'],
    array['controle', '85e. … ni sur une opération retirée', 'chef', $q$insert into operations_caisse (id, dossier_id, genre, date, montant, categorie_id, encaissements_du_jour, origine, cree_le, cree_par, retire_le, retire_par)
      values ('{X2}', '{R}', 'recette', '2026-02-02', 40, '{KR}', '{}', 'cabinet', '2026-01-15 10:00+01', '{CHEF}', '2026-01-16 10:00+01', '{CHEF}');
      insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, operation_caisse_id) values ('{R}', '2026-02-02', '530000', 'x', 40, 'debit', '{X2}')$q$,
      '23514', 'Cette écriture ne suit pas son opération de caisse : son dossier, sa date, ou sa pièce.'],
    array['controle', '86. un paiement par la caisse réinséré, sa pièce du dossier, et sa contrepartie', 'chef', $q$insert into operations_caisse (id, dossier_id, genre, date, montant, piece_id, origine, cree_le, cree_par) values ('{X4}', '{R}', 'paiement', '2026-02-05', -30, '{PR}', 'cabinet', '2026-01-15 10:00+01', '{CHEF}');
      insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, operation_caisse_id, piece_id) values ('{R}', '2026-02-05', '530000', 'essai', 30, 'credit', '{X4}', '{PR}')$q$,
      'OK', ''],
    array['controle', '86b. … la pièce d''un autre dossier', 'chef', $q$insert into operations_caisse (id, dossier_id, genre, date, montant, piece_id, origine, cree_le, cree_par) values ('{X4}', '{R}', 'paiement', '2026-02-05', -30, '{PT}', 'cabinet', '2026-01-15 10:00+01', '{CHEF}')$q$,
      '23514', 'La pièce d''un paiement par la caisse est une pièce de son dossier.'],
    array['controle', '86c. … une contrepartie sur une autre pièce', 'chef', $q$insert into operations_caisse (id, dossier_id, genre, date, montant, piece_id, origine, cree_le, cree_par) values ('{X4}', '{R}', 'paiement', '2026-02-05', -30, '{PR}', 'cabinet', '2026-01-15 10:00+01', '{CHEF}');
      insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, operation_caisse_id, piece_id) values ('{R}', '2026-02-05', '530000', 'essai', 30, 'credit', '{X4}', '{PT}')$q$,
      '23514', 'Cette écriture ne suit pas son opération de caisse : son dossier, sa date, ou sa pièce.'],
    array['controle', '86d. … un paiement créé dans la transaction qui viderait la caisse', 'chef', $q$insert into operations_caisse (id, dossier_id, genre, date, montant, piece_id, origine, cree_par) values ('{X4}', '{R}', 'paiement', '2026-02-05', -30, '{PR}', 'cabinet', '{CHEF}')$q$,
      '23514', 'Ce paiement de 30,00 € rendrait la caisse négative le 05/02/2026 (−30,00 €) : saisis d''abord les recettes en espèces qui le précèdent ; si tu as payé de ta poche, ce n''est pas la caisse : c''est une note de frais.'],
    array['controle', '87. un versement réinséré qui vide la caisse passe', 'chef', $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut, compte_bilan, created_at) values ('{MR1}', '{R}', '2026-02-06', 'ESSAI VERSEMENT', 100, 'rapprochee', '530000', '2026-01-15 10:00+01')$q$,
      'OK', ''],
    array['controle', '87b. … créé dans la transaction, il se juge', 'chef', $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut, compte_bilan) values ('{MR1}', '{R}', '2026-02-06', 'ESSAI VERSEMENT', 100, 'rapprochee', '530000')$q$,
      '23514', 'Ce versement de 100,00 € rendrait la caisse négative le 06/02/2026 (−100,00 €) : saisis d''abord les recettes en espèces qui le précèdent.'],
    array['controle', '87c. … réinsérée dans un dossier dont un exercice est validé, la porte se ferme : il se juge', 'chef', $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut, compte_bilan, created_at) values ('{MR1}', '{V}', '2026-02-06', 'ESSAI VERSEMENT', 200, 'rapprochee', '530000', '2026-01-15 10:00+01')$q$,
      '23514', 'Ce versement de 200,00 € rendrait la caisse négative le 06/02/2026 (−100,00 €) : saisis d''abord les recettes en espèces qui le précèdent.'],
    array['controle', '88. une ouverture au crédit réinsérée passe', 'chef', $q$insert into a_nouveaux (id, dossier_id, date, compte, sens, montant, source_nom, source_empreinte, created_at) values ('{AN6}', '{R}', '2026-01-01', '530000', 'credit', 5, 'balance-essai-caisse-r.csv', repeat('d', 64), '2026-01-15 10:00+01')$q$,
      'OK', ''],
    array['controle', '88b. … créée dans la transaction, elle se juge', 'chef', $q$insert into a_nouveaux (id, dossier_id, date, compte, sens, montant, source_nom, source_empreinte) values ('{AN6}', '{R}', '2026-01-01', '530000', 'credit', 5, 'balance-essai-caisse-r.csv', repeat('d', 64))$q$,
      '23514', 'Une ouverture de la caisse au crédit, 5,00 €, la rendrait négative le 01/01/2026 (−5,00 €) : le solde d''une caisse est débiteur ou nul.'],
    array['controle', '88c. une caisse que la restauration laisse négative se remplit encore : un apport ne se juge pas', 'chef', $q$insert into operations_caisse (id, dossier_id, genre, date, montant, origine, cree_le, cree_par) values ('{X1}', '{R}', 'prelevement', '2026-02-01', 1000, 'cabinet', '2026-01-15 10:00+01', '{CHEF}');
      select enregistrer_operation_caisse('{R}', 'apport', '2026-02-02', 10, null, null, null, '[{"compte":"530000","sens":"debit","montant":10},{"compte":"108000","sens":"credit","montant":10}]')$q$,
      'OK', ''],
    array['controle', '89. une contre-passation en espèces réinsérée passe (créée dans la transaction : 74e)', 'chef', $q$insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, annule_id, motif, cree_le)
      select e.dossier_id, e.facture_id, '2026-03-18', -e.montant, e.moyen, e.id, 'ESSAI CAISSE', '2026-01-15 10:00+01' from encaissements_factures e where e.dossier_id = '{B}' and e.date_encaissement = '2026-03-16'$q$,
      'OK', ''],
    array['controle', '89b. un compte qui n''est pas super-administrateur ne réinsère pas : la garde', 'autre', $q$insert into operations_caisse (dossier_id, genre, date, montant, origine, cree_le) values ('{DA}', 'prelevement', '2026-02-01', 1000, 'cabinet', '2026-01-15 10:00+01')$q$,
      '42501', 'Une opération de caisse ne s''écrit que par les fonctions de la caisse, avec son écriture.'],

    -- ══ 90 à 95. Les gardes et les contraintes, sans les fonctions ══════════
    array['controle', '90. une opération ne se modifie pas, même par le propriétaire', 'postgres', $q$update operations_caisse set montant = 1 where dossier_id = '{T}' and genre = 'apport'$q$,
      '42501', 'Une opération de caisse ne se modifie pas : elle se retire, puis se saisit de nouveau.'],
    array['controle', '90b. … ni son retrait sans le réglage de cette opération', 'postgres', $q$select set_config('jd.caisse', 'ca155e00-0000-4000-8000-0000000000ee', true);
      update operations_caisse set retire_le = now() where dossier_id = '{T}' and genre = 'prelevement'$q$,
      '42501', 'Une opération de caisse ne se modifie pas : elle se retire, puis se saisit de nouveau.'],
    array['controle', '90c. … ni le retrait mêlé à une autre colonne', 'postgres', $q$select set_config('jd.caisse', (select id::text from operations_caisse where dossier_id = '{T}' and genre = 'prelevement'), true);
      update operations_caisse set retire_le = now(), montant = 1 where dossier_id = '{T}' and genre = 'prelevement'$q$,
      '42501', 'Une opération de caisse ne se modifie pas : elle se retire, puis se saisit de nouveau.'],
    array['controle', '90d. … ni deux fois', 'postgres', $q$select set_config('jd.caisse', (select id::text from operations_caisse where dossier_id = '{T}' and genre = 'prelevement'), true);
      update operations_caisse set retire_le = now() where dossier_id = '{T}' and genre = 'prelevement';
      update operations_caisse set retire_le = now() + interval '1 second' where dossier_id = '{T}' and genre = 'prelevement'$q$,
      '42501', 'Une opération de caisse ne se modifie pas : elle se retire, puis se saisit de nouveau.'],
    array['controle', '90d2. … ni après la fonction, dans la même transaction : son réglage ne lui survit pas', 'postgres', $q$select set_config('request.jwt.claims', json_build_object('sub', '{CHEF}', 'role', 'authenticated')::text, true);
      select enregistrer_operation_caisse('{T}', 'apport', '2026-03-04', 5, null, null, null, '[{"compte":"530000","sens":"debit","montant":5},{"compte":"108000","sens":"credit","montant":5}]');
      select set_config('request.jwt.claims', '', true);
      update operations_caisse set retire_le = now() where dossier_id = '{T}' and date = '2026-03-04'$q$,
      '42501', 'Une opération de caisse ne se modifie pas : elle se retire, puis se saisit de nouveau.'],
    array['valeur', '90e. le chef ne modifie rien en direct : aucune policy de mise à jour', 'chef', $q$with m as (update operations_caisse set montant = 1 where dossier_id = '{T}' returning 1) select count(*)::text from m$q$, '', '0'],
    array['controle', '91. l''écriture d''une opération ne se modifie pas', 'chef', $q$update ecritures_brouillon set libelle = 'x' where operation_caisse_id = (select id from operations_caisse where dossier_id = '{T}' and genre = 'apport')$q$,
      '42501', 'L''écriture d''une opération de caisse ne se modifie pas : retire l''opération, puis saisis-la de nouveau.'],
    array['controle', '91b. … ni ne s''écrit sur une ligne qui n''en citait pas', 'chef', $q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens) values ('{G}', '2026-03-01', '606000', 'essai', 1, 'debit');
      update ecritures_brouillon set operation_caisse_id = (select id from operations_caisse where dossier_id = '{T}' and genre = 'apport') where dossier_id = '{G}'$q$,
      '42501', 'L''écriture d''une opération de caisse ne s''écrit qu''avec cette opération, par la fonction de la caisse.'],
    array['controle', '91c. la ligne d''une opération ne porte aucune autre source', 'postgres', $q$select set_config('jd.caisse', (select id::text from operations_caisse where dossier_id = '{T}' and genre = 'apport'), true);
      insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, operation_caisse_id, ligne_bancaire_id)
      select '{T}', '2026-03-01', '530000', 'x', 1, 'debit', o.id, '{MV1}' from operations_caisse o where o.dossier_id = '{T}' and o.genre = 'apport'$q$,
      '23514', 'new row for relation "ecritures_brouillon" violates check constraint "ecritures_brouillon_caisse_sans_autre_source"%'],
    array['controle', '91d. … ni, hors d''un paiement, une pièce', 'postgres', $q$select set_config('jd.caisse', (select id::text from operations_caisse where dossier_id = '{T}' and genre = 'apport'), true);
      insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, operation_caisse_id, piece_id)
      select '{T}', '2026-03-01', '530000', 'x', 1, 'debit', o.id, '{PT}' from operations_caisse o where o.dossier_id = '{T}' and o.genre = 'apport'$q$,
      '23514', 'Cette écriture ne suit pas son opération de caisse : son dossier, sa date, ou sa pièce.'],
    array['controle', '91e. … et sous ce réglage, la ligne au jour de son opération passe (le contrôle POSITIF de la garde)', 'postgres', $q$select set_config('jd.caisse', (select id::text from operations_caisse where dossier_id = '{T}' and genre = 'apport'), true);
      insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, operation_caisse_id)
      select '{T}', '2026-03-01', '530000', 'x', 1, 'debit', o.id from operations_caisse o where o.dossier_id = '{T}' and o.genre = 'apport'$q$,
      'OK', ''],
    array['controle', '91f. … ni la pièce de l''écriture d''une opération', 'chef', $q$update ecritures_brouillon set piece_id = '{PT}' where operation_caisse_id = (select id from operations_caisse where dossier_id = '{T}' and genre = 'apport')$q$,
      '42501', 'L''écriture d''une opération de caisse ne se modifie pas : retire l''opération, puis saisis-la de nouveau.'],
    array['controle', '91g. … ni dans un autre dossier que le sien', 'postgres', $q$select set_config('jd.caisse', (select id::text from operations_caisse where dossier_id = '{T}' and genre = 'apport'), true);
      insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, operation_caisse_id)
      select '{G}', '2026-03-01', '530000', 'x', 1, 'debit', o.id from operations_caisse o where o.dossier_id = '{T}' and o.genre = 'apport'$q$,
      '23514', 'Cette écriture ne suit pas son opération de caisse : son dossier, sa date, ou sa pièce.'],
    array['controle', '92. une opération ne s''écrit pas en direct, sans réglage et hors de la restauration', 'postgres', $q$insert into operations_caisse (dossier_id, genre, date, montant, origine) values ('{G}', 'apport', '2026-03-01', 10, 'cabinet')$q$,
      '42501', 'Une opération de caisse ne s''écrit que par les fonctions de la caisse, avec son écriture.'],
    -- Les contraintes de la table : chaque insertion, sous le réglage de son identifiant, pour passer la garde.
    array['controle', '93. le genre', 'postgres', $q$select set_config('jd.caisse', '{X5}', true); insert into operations_caisse (id, dossier_id, genre, date, montant, origine) values ('{X5}', '{G}', 'don', '2026-03-01', 10, 'cabinet')$q$,
      '23514', '%violates check constraint "operations_caisse_genre"%'],
    array['controle', '93b. la date d''avant 2000', 'postgres', $q$select set_config('jd.caisse', '{X5}', true); insert into operations_caisse (id, dossier_id, genre, date, montant, origine) values ('{X5}', '{G}', 'apport', '1999-12-31', 10, 'cabinet')$q$,
      '23514', '%violates check constraint "operations_caisse_date"%'],
    array['controle', '93c. le montant nul', 'postgres', $q$select set_config('jd.caisse', '{X5}', true); insert into operations_caisse (id, dossier_id, genre, date, montant, origine) values ('{X5}', '{G}', 'apport', '2026-03-01', 0, 'cabinet')$q$,
      '23514', '%violates check constraint "operations_caisse_montant"%'],
    array['controle', '93d. le montant pas au centime', 'postgres', $q$select set_config('jd.caisse', '{X5}', true); insert into operations_caisse (id, dossier_id, genre, date, montant, origine) values ('{X5}', '{G}', 'apport', '2026-03-01', 1.005, 'cabinet')$q$,
      '23514', '%violates check constraint "operations_caisse_montant"%'],
    array['controle', '93e. un prélèvement négatif', 'postgres', $q$select set_config('jd.caisse', '{X5}', true); insert into operations_caisse (id, dossier_id, genre, date, montant, origine) values ('{X5}', '{G}', 'prelevement', '2026-03-01', -10, 'cabinet')$q$,
      '23514', '%violates check constraint "operations_caisse_montant_positif"%'],
    array['controle', '93f. une recette sans catégorie', 'postgres', $q$select set_config('jd.caisse', '{X5}', true); insert into operations_caisse (id, dossier_id, genre, date, montant, encaissements_du_jour, origine) values ('{X5}', '{G}', 'recette', '2026-03-01', 10, '{}', 'cabinet')$q$,
      '23514', '%violates check constraint "operations_caisse_categorie"%'],
    array['controle', '93g. un taux sur un apport', 'postgres', $q$select set_config('jd.caisse', '{X5}', true); insert into operations_caisse (id, dossier_id, genre, date, montant, taux_tva, origine) values ('{X5}', '{G}', 'apport', '2026-03-01', 10, 20, 'cabinet')$q$,
      '23514', '%violates check constraint "operations_caisse_taux"%'],
    array['controle', '93h. une recette sans ensemble du jour', 'postgres', $q$select set_config('jd.caisse', '{X5}', true); insert into operations_caisse (id, dossier_id, genre, date, montant, categorie_id, origine) values ('{X5}', '{G}', 'recette', '2026-03-01', 10, '{KG}', 'cabinet')$q$,
      '23514', '%violates check constraint "operations_caisse_encaissements_du_jour"%'],
    array['controle', '93i. un ensemble du jour qui porte un nul', 'postgres', $q$select set_config('jd.caisse', '{X5}', true); insert into operations_caisse (id, dossier_id, genre, date, montant, categorie_id, encaissements_du_jour, origine) values ('{X5}', '{G}', 'recette', '2026-03-01', 10, '{KG}', array[null]::uuid[], 'cabinet')$q$,
      '23514', '%violates check constraint "operations_caisse_encaissements_du_jour"%'],
    array['controle', '93j. un paiement sans pièce', 'postgres', $q$select set_config('jd.caisse', '{X5}', true); insert into operations_caisse (id, dossier_id, genre, date, montant, origine) values ('{X5}', '{G}', 'paiement', '2026-03-01', -10, 'cabinet')$q$,
      '23514', '%violates check constraint "operations_caisse_piece"%'],
    array['controle', '93k. une origine inconnue', 'postgres', $q$select set_config('jd.caisse', '{X5}', true); insert into operations_caisse (id, dossier_id, genre, date, montant, origine) values ('{X5}', '{G}', 'apport', '2026-03-01', 10, 'banque')$q$,
      '23514', '%violates check constraint "operations_caisse_origine"%'],
    array['controle', '93l. une opération qui se remplace elle-même (la garde, avant la contrainte)', 'postgres', $q$select set_config('jd.caisse', '{X5}', true); insert into operations_caisse (id, dossier_id, genre, date, montant, origine, remplace_id) values ('{X5}', '{G}', 'apport', '2026-03-01', 10, 'cabinet', '{X5}')$q$,
      '23514', 'Une opération de caisse ne remplace qu''une opération de son dossier.'],
    array['controle', '93m. un auteur de retrait sans retrait', 'postgres', $q$select set_config('jd.caisse', '{X5}', true); insert into operations_caisse (id, dossier_id, genre, date, montant, origine, retire_par) values ('{X5}', '{G}', 'apport', '2026-03-01', 10, 'cabinet', '{CHEF}')$q$,
      '23514', '%violates check constraint "operations_caisse_retrait"%'],
    array['controle', '93n. un montant au-delà de ce que l''application compte', 'postgres', $q$select set_config('jd.caisse', '{X5}', true); insert into operations_caisse (id, dossier_id, genre, date, montant, origine) values ('{X5}', '{G}', 'apport', '2026-03-01', 10000000000000, 'cabinet')$q$,
      '23514', '%violates check constraint "operations_caisse_montant"%'],
    array['controle', '93o. un taux qui n''est pas celui du relevé', 'postgres', $q$select set_config('jd.caisse', '{X5}', true); insert into operations_caisse (id, dossier_id, genre, date, montant, categorie_id, taux_tva, encaissements_du_jour, origine) values ('{X5}', '{G}', 'recette', '2026-03-01', 10, '{KG}', 7, '{}', 'cabinet')$q$,
      '23514', '%violates check constraint "operations_caisse_taux"%'],
    array['controle', '94. une catégorie d''un autre dossier (la garde)', 'postgres', $q$select set_config('jd.caisse', '{X5}', true); insert into operations_caisse (id, dossier_id, genre, date, montant, categorie_id, encaissements_du_jour, origine) values ('{X5}', '{G}', 'recette', '2026-03-01', 10, '{KT}', '{}', 'cabinet')$q$,
      '23514', 'La catégorie d''une opération de caisse est une catégorie de son dossier, ou commune.'],
    array['controle', '94b. l''opération remplacée, d''un autre dossier', 'postgres', $q$select set_config('jd.caisse', '{X5}', true); insert into operations_caisse (id, dossier_id, genre, date, montant, origine, remplace_id)
      select '{X5}', '{G}', 'apport', '2026-03-01', 10, 'cabinet', o.id from operations_caisse o where o.dossier_id = '{T}' and o.genre = 'apport'$q$,
      '23514', 'Une opération de caisse ne remplace qu''une opération de son dossier.'],
    array['controle', '94c. deux opérations qui en remplacent une même', 'postgres', $q$select set_config('jd.caisse', '{X5}', true); insert into operations_caisse (id, dossier_id, genre, date, montant, origine, remplace_id)
      select '{X5}', '{T}', 'apport', '2026-03-01', 10, 'cabinet', o.id from operations_caisse o where o.dossier_id = '{T}' and o.genre = 'apport';
      select set_config('jd.caisse', '{X6}', true); insert into operations_caisse (id, dossier_id, genre, date, montant, origine, remplace_id)
      select '{X6}', '{T}', 'apport', '2026-03-01', 10, 'cabinet', o.id from operations_caisse o where o.dossier_id = '{T}' and o.genre = 'apport' and o.remplace_id is null$q$,
      '23505', '%violates unique constraint "operations_caisse_un_remplacement"%'],
    array['controle', '94d. une opération sous le réglage de son identifiant passe la garde (le contrôle POSITIF des contraintes)', 'postgres', $q$select set_config('jd.caisse', '{X5}', true); insert into operations_caisse (id, dossier_id, genre, date, montant, origine) values ('{X5}', '{G}', 'apport', '2026-03-01', 10, 'cabinet')$q$,
      'OK', ''],
    array['controle', '94e. une catégorie commune passe la garde', 'postgres', $q$select set_config('jd.caisse', '{X5}', true); insert into operations_caisse (id, dossier_id, genre, date, montant, categorie_id, encaissements_du_jour, origine) values ('{X5}', '{G}', 'recette', '2026-03-01', 10, '{KCOM}', '{}', 'cabinet')$q$,
      'OK', ''],
    array['controle', '95. un paiement sous le réglage, sa pièce du dossier : passe la garde ; il vide la caisse : la caisse le refuse', 'postgres', $q$select set_config('jd.caisse', '{X7}', true); insert into operations_caisse (id, dossier_id, genre, date, montant, piece_id, origine) values ('{X7}', '{R}', 'paiement', '2026-03-01', -10, '{PR}', 'cabinet')$q$,
      '23514', 'Ce paiement de 10,00 € rendrait la caisse négative le 01/03/2026 (−10,00 €) : saisis d''abord les recettes en espèces qui le précèdent ; si tu as payé de ta poche, ce n''est pas la caisse : c''est une note de frais.'],

    -- ══ 96 à 98. Ce que le catalogue dit ══════════
    array['valeur', '96. les droits d''exécution (anonyme, connecté)', 'postgres', $q$select string_agg(f || ':' || has_function_privilege('anon', 'public.' || f || a, 'execute') || ':' || has_function_privilege('authenticated', 'public.' || f || a, 'execute'), ',' order by f collate "C") from (values
      ('enregistrer_operation_caisse', '(uuid, text, date, numeric, uuid, numeric, uuid[], jsonb)'), ('enregistrer_operations_de_caisse', '(uuid, jsonb)'),
      ('garder_ecriture_de_caisse', '()'), ('garder_la_caisse', '()'), ('garder_operation_caisse', '()'),
      ('premier_jour_negatif_de_la_caisse', '(uuid)'), ('qui_ecrit_la_caisse', '(uuid)'), ('texte_caisse_negative', '(text, numeric, date, numeric)')) as t(f, a)$q$, '',
      'enregistrer_operation_caisse:false:true,enregistrer_operations_de_caisse:false:true,garder_ecriture_de_caisse:false:false,garder_la_caisse:false:false,garder_operation_caisse:false:false,premier_jour_negatif_de_la_caisse:false:false,qui_ecrit_la_caisse:false:false,texte_caisse_negative:false:false'],
    array['valeur', '96b. qui contourne la RLS, chacune avec son propre contrôle (les mots, non)', 'postgres', $q$select string_agg(proname || ':' || prosecdef, ',' order by proname collate "C") from pg_proc where pronamespace = 'public'::regnamespace and proname in ('enregistrer_operation_caisse', 'enregistrer_operations_de_caisse', 'garder_ecriture_de_caisse', 'garder_la_caisse', 'garder_operation_caisse', 'premier_jour_negatif_de_la_caisse', 'qui_ecrit_la_caisse', 'texte_caisse_negative')$q$, '',
      'enregistrer_operation_caisse:true,enregistrer_operations_de_caisse:true,garder_ecriture_de_caisse:true,garder_la_caisse:true,garder_operation_caisse:true,premier_jour_negatif_de_la_caisse:true,qui_ecrit_la_caisse:true,texte_caisse_negative:false'],
    -- Les déclencheurs lus par leur FONCTION, non par leur nom : un de plus se verrait. Les événements : insertion,
    -- suppression, mise à jour ; puis le moment (avant la ligne ou après elle).
    array['valeur', '97. les déclencheurs : dix de contrainte, différés, après chaque ligne — un sur les opérations, un par événement sur chacun des trois autres flux — ; deux gardes, avant chaque ligne', 'postgres', $q$select string_agg(t.tgname || ':' || c.relname || ':' || t.tgdeferrable || ':' || t.tginitdeferred || ':' || ((t.tgtype & 4) <> 0) || ((t.tgtype & 8) <> 0) || ((t.tgtype & 16) <> 0) || ':' || case when (t.tgtype & 1) = 0 then 'instruction' when (t.tgtype & 2) <> 0 then 'avant' else 'après' end || ':' || t.tgenabled::text, ',' order by t.tgname collate "C")
      from pg_trigger t join pg_class c on c.oid = t.tgrelid where t.tgfoid in ('public.garder_la_caisse()'::regprocedure, 'public.garder_operation_caisse()'::regprocedure, 'public.garder_ecriture_de_caisse()'::regprocedure)$q$, '',
      'a_nouveaux_caisse_jamais_negative_insertion:a_nouveaux:true:true:truefalsefalse:après:O,a_nouveaux_caisse_jamais_negative_modification:a_nouveaux:true:true:falsefalsetrue:après:O,a_nouveaux_caisse_jamais_negative_suppression:a_nouveaux:true:true:falsetruefalse:après:O,'
      || 'ecritures_brouillon_caisse:ecritures_brouillon:false:false:truetruetrue:avant:O,'
      || 'encaissements_factures_caisse_jamais_negative_insertion:encaissements_factures:true:true:truefalsefalse:après:O,encaissements_factures_caisse_jamais_negative_modification:encaissements_factures:true:true:falsefalsetrue:après:O,encaissements_factures_caisse_jamais_negative_suppression:encaissements_factures:true:true:falsetruefalse:après:O,'
      || 'lignes_bancaires_caisse_jamais_negative_insertion:lignes_bancaires:true:true:truefalsefalse:après:O,lignes_bancaires_caisse_jamais_negative_modification:lignes_bancaires:true:true:falsefalsetrue:après:O,lignes_bancaires_caisse_jamais_negative_suppression:lignes_bancaires:true:true:falsetruefalse:après:O,'
      || 'operations_caisse_gardes:operations_caisse:false:false:truetruetrue:avant:O,operations_caisse_jamais_negative:operations_caisse:true:true:truetruetrue:après:O'],
    -- La condition de chacun, telle que le catalogue la rend : la racine 53, les espèces, une contre-passation ; aucune
    -- sur les opérations. Puis la racine du rôle `caisse`, que la condition suppose (la garde de tête la vérifie).
    array['valeur', '97d. la condition des déclencheurs de contrainte', 'postgres', $q$select string_agg(t.tgname || ' ' || coalesce(substring(pg_get_triggerdef(t.oid) from 'WHEN \((.*)\) EXECUTE'), '-'), ' | ' order by t.tgname collate "C")
      from pg_trigger t where t.tgfoid = 'public.garder_la_caisse()'::regprocedure$q$, '',
      'a_nouveaux_caisse_jamais_negative_insertion ("left"(new.compte, 2) = ''53''::text) | a_nouveaux_caisse_jamais_negative_modification (("left"(old.compte, 2) = ''53''::text) OR ("left"(new.compte, 2) = ''53''::text)) | a_nouveaux_caisse_jamais_negative_suppression ("left"(old.compte, 2) = ''53''::text)'
      || ' | encaissements_factures_caisse_jamais_negative_insertion ((new.moyen = ''especes''::text) OR (new.annule_id IS NOT NULL)) | encaissements_factures_caisse_jamais_negative_modification ((old.moyen = ''especes''::text) OR (new.moyen = ''especes''::text) OR (old.annule_id IS NOT NULL) OR (new.annule_id IS NOT NULL)) | encaissements_factures_caisse_jamais_negative_suppression ((old.moyen = ''especes''::text) OR (old.annule_id IS NOT NULL))'
      || ' | lignes_bancaires_caisse_jamais_negative_insertion ("left"(new.compte_bilan, 2) = ''53''::text) | lignes_bancaires_caisse_jamais_negative_modification (("left"(old.compte_bilan, 2) = ''53''::text) OR ("left"(new.compte_bilan, 2) = ''53''::text)) | lignes_bancaires_caisse_jamais_negative_suppression ("left"(old.compte_bilan, 2) = ''53''::text)'
      || ' | operations_caisse_jamais_negative -'],
    array['valeur', '97e. … et la racine du rôle de la caisse, que cette condition suppose', 'postgres', $q$select string_agg(role || ':' || racines::text, ',') from roles_comptables where role = 'caisse'$q$, '', 'caisse:{53}'],
    array['valeur', '97b. les clés : le dossier et l''écriture en cascade, la pièce gardée, la catégorie et l''opération remplacée sans action', 'postgres', $q$select string_agg(conname || ':' || confdeltype::text, ',' order by conname collate "C") from pg_constraint where contype = 'f'
      and (conrelid = 'public.operations_caisse'::regclass or conname = 'ecritures_brouillon_operation_caisse_id_fkey')$q$, '',
      'ecritures_brouillon_operation_caisse_id_fkey:c,operations_caisse_categorie_id_fkey:a,operations_caisse_dossier_id_fkey:c,operations_caisse_piece_id_fkey:r,operations_caisse_remplace_id_fkey:a'],
    array['valeur', '97c. la RLS et les deux policies, au compte connecté', 'postgres', $q$select (select relrowsecurity::text from pg_class where oid = 'public.operations_caisse'::regclass) || ',' || string_agg(policyname || ':' || cmd || ':' || array_to_string(roles, '+'), ',' order by policyname collate "C") from pg_policies where tablename = 'operations_caisse'$q$, '',
      'true,operations_caisse_lecture:SELECT:authenticated,operations_caisse_restauration:INSERT:authenticated'],
    array['valeur', '98. les mots de chaque refus de la caisse négative', 'postgres', $q$select string_agg(texte_caisse_negative(g, 500, '2026-03-05', -314.5), ' | ' order by o) from unnest(array['prelevement', 'especes_rendues', 'paiement', 'retrait_recette', 'retrait_apport', 'retrait_paiement',
      'versement', 'retrait_d_especes_retire', 'mouvement_change', 'contre_passation', 'retrait_encaissement', 'rattachement_encaissement', 'ouverture_au_credit', 'retrait_ouverture', 'ouverture_change', 'lot', 'autre']) with ordinality as u(g, o)$q$, '',
      'Ce prélèvement de 500,00 € rendrait la caisse négative le 05/03/2026 (−314,50 €) : saisis d''abord les recettes en espèces qui le précèdent.'
      || ' | Ces espèces rendues, 500,00 €, rendraient la caisse négative le 05/03/2026 (−314,50 €) : saisis d''abord les recettes en espèces qui les précèdent.'
      || ' | Ce paiement de 500,00 € rendrait la caisse négative le 05/03/2026 (−314,50 €) : saisis d''abord les recettes en espèces qui le précèdent ; si tu as payé de ta poche, ce n''est pas la caisse : c''est une note de frais.'
      || ' | Retirer cette recette de 500,00 € rendrait la caisse négative le 05/03/2026 (−314,50 €) : retire d''abord les sorties d''espèces qui la suivent.'
      || ' | Retirer cet apport de 500,00 € rendrait la caisse négative le 05/03/2026 (−314,50 €) : retire d''abord les sorties d''espèces qui le suivent.'
      || ' | Retirer ce paiement de 500,00 € rendrait la caisse négative le 05/03/2026 (−314,50 €) : retire d''abord les sorties d''espèces qui le suivent.'
      || ' | Ce versement de 500,00 € rendrait la caisse négative le 05/03/2026 (−314,50 €) : saisis d''abord les recettes en espèces qui le précèdent.'
      || ' | Retirer ce retrait d''espèces de 500,00 € pour la caisse rendrait la caisse négative le 05/03/2026 (−314,50 €) : retire d''abord les sorties d''espèces qui le suivent.'
      || ' | Ce changement d''un mouvement classé sur la caisse la rendrait négative le 05/03/2026 (−314,50 €).'
      || ' | Cette contre-passation de 500,00 € en espèces rendrait la caisse négative le 05/03/2026 (−314,50 €) : la caisse n''a plus ces espèces ce jour-là.'
      || ' | Retirer cet encaissement de 500,00 € en espèces rendrait la caisse négative le 05/03/2026 (−314,50 €) : ses espèces ont déjà servi.'
      || ' | Rattacher à un mouvement cet encaissement de 500,00 € en espèces rendrait la caisse négative le 05/03/2026 (−314,50 €) : ses espèces ont déjà servi.'
      || ' | Une ouverture de la caisse au crédit, 500,00 €, la rendrait négative le 05/03/2026 (−314,50 €) : le solde d''une caisse est débiteur ou nul.'
      || ' | Retirer l''ouverture de la caisse, 500,00 €, la rendrait négative le 05/03/2026 (−314,50 €) : retire d''abord les sorties d''espèces qui la suivent.'
      || ' | Ce changement de l''ouverture de la caisse la rendrait négative le 05/03/2026 (−314,50 €).'
      || ' | La caisse serait négative le 05/03/2026 (−314,50 €) : saisis d''abord les recettes en espèces qui précèdent ce jour.'
      || ' | Cette écriture rendrait la caisse négative le 05/03/2026 (−314,50 €).']
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
          execute immediat;
          execute differe;
        exception when others then
          verdicts := verdicts || jsonb_build_object('controle', '0. le jeu : ' || etape[2], 'observe', sqlstate || ' ' || sqlerrm, 'ok', false);
        end;
      else
        begin
          if etape[3] <> 'postgres' then
            execute format('set local role %I', case when etape[3] = 'anon' then 'anon' else 'authenticated' end);
            perform set_config('request.jwt.claims', case when etape[3] = 'anon' then json_build_object('role', 'anon')::text
              else json_build_object('sub', case etape[3] when 'chef' then chef when 'client' then client when 'autre' then client else inconnu end,
                                     'role', 'authenticated')::text end, true);
          end if;
          if etape[1] = 'valeur' then
            execute s into obs;
          else
            execute s;
            -- La fin de la transaction, telle que la production la juge : les déclencheurs différés de la caisse.
            execute immediat;
            execute differe;
            accepte := true;
            if etape[1] = 'controle' then
              raise exception 'ANNULATION_ESSAI';
            end if;
          end if;
        exception when others then code_recu := sqlstate; message := sqlerrm;
        end;
        reset role;
        perform set_config('request.jwt.claims', '', true);
        perform set_config('jd.caisse', '', true);
        if etape[1] = 'valeur' then
          verdicts := verdicts || jsonb_build_object('controle', etape[2],
            'observe', coalesce(obs, case when code_recu is not null then code_recu || ' ' || coalesce(message, '') else '∅' end),
            'ok', coalesce(obs = etape[6], false));
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

  -- ══ 99. Rien n'est resté ══════════
  select string_agg(n::text, '/') into apres from (values
    ((select count(*) from dossiers)), ((select count(*) from operations_caisse)), ((select count(*) from ecritures_brouillon)),
    ((select count(*) from lignes_bancaires)), ((select count(*) from a_nouveaux)), ((select count(*) from exercices_valides)),
    ((select count(*) from encaissements_factures)), ((select count(*) from encaissements_factures_taux)),
    ((select count(*) from factures_emises)), ((select count(*) from categories)), ((select count(*) from pieces)),
    ((select count(*) from cabinets)), ((select count(*) from cabinet_admins)), ((select count(*) from facture_lignes)),
    ((select count(*) from facture_numerotation)), ((select count(*) from plan_comptable_dossier))
  ) as t(n);
  -- L'écart seul, non plus les comptes de toute la base, qui diraient le volume d'un dossier réel (audit du 29/10/2026).
  verdicts := verdicts || jsonb_build_object('controle', '99. rien n''est resté en base',
    'observe', 'écarts ' || (select string_agg(to_char(ecart_.apres_::bigint - ecart_.avant_::bigint, 'FMSG9999999990'), '/' order by ecart_.rang_) from unnest(string_to_array(avant, '/'), string_to_array(apres, '/')) with ordinality as ecart_(avant_, apres_, rang_)),
    'ok', avant = apres and not exists (select 1 from dossiers where id::text like 'ca155e00-%')
      and not exists (select 1 from cabinet_admins where user_id = client)
      and coalesce(current_setting('jd.caisse', true), '') = '' and coalesce(current_setting('jd.caisse_d_un_lot', true), '') = '');

  perform set_config('essai.caisse', verdicts::text, true);
end $essai$;

-- Un verdict qui n'a pas pu se calculer est une faute, pas un silence. La ligne 0 dit le texte que la base a reçu — par
-- l'outil MCP, qui ajoute sa signature après lui —, pour le comparer au fichier par son empreinte.
select x.controle, x.ok, x.observe from (
  select v.controle, coalesce(v.ok, false) as ok, v.observe
  from jsonb_to_recordset(current_setting('essai.caisse')::jsonb) as v(controle text, ok boolean, observe text)
  union all
  select '0. information : le texte reçu par la base', true, length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by (regexp_match(x.controle, '^(\d+)'))[1]::int, x.controle;
