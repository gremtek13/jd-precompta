-- LA DÉCLARATION D'E-REPORTING HORS APPLICATION, ÉPROUVÉE EN BASE — à rejouer par `execute_sql` après toute migration qui
-- touche `declarer_ereporting_hors_application`, `periode_ereporting`, les gardes `garder_declaration_ereporting`,
-- `garder_source_declaree`, `garder_piece_declaree`, les tables `declarations_ereporting` et
-- `declarations_ereporting_sources`, le régime d'e-reporting (étape e5a), la fiche « hors de France » (étape e2), les
-- factures émises, le registre des encaissements, `admin_du_dossier` ou `memberships` (ligne 28.5, étape e5b1 ; migration
-- `declarations_ereporting`).
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - QUI écrit, par impersonation : un anonyme n'a pas le droit d'appeler ; un compte rattaché à rien, un client — sur le
--     dossier d'un autre comme sur le SIEN —, un membre du cabinet affecté à un AUTRE dossier se font refuser l'accès au
--     dossier ; le chef du cabinet, un chef qui n'est pas super-administrateur et un membre affecté au dossier atteignent
--     les refus qui suivent l'accès (les contrôles POSITIFS) ;
--   - QUI lit : le client ne voit ni déclaration ni source, pas même celles de SON dossier ; l'anonyme et le compte
--     rattaché à rien non plus ; le membre affecté voit celles de son dossier, et elles seules ;
--   - CE QUI SE REFUSE, avec sa RAISON, dans l'ordre de la fonction — que src/lib/declarationsEreporting.test.ts relit ici,
--     appel par appel ;
--   - CE QUE LES GARDES ET LES CONTRAINTES TIENNENT SANS LA FONCTION : une déclaration ne se modifie pas, sauf son passage à
--     « remplacée », une fois ; une seule active par dossier, objet et période ; aucune active n'en chevauche une autre ; une
--     empreinte est celle du contenu ; une rectificative remplace la déclaration de sa période, déjà remplacée ; ses
--     sources ne se modifient pas et ont le genre de son objet ;
--   - CE QUE LE CATALOGUE DIT : les droits d'exécution, la sécurité des fonctions, les policies, la RLS, les déclencheurs,
--     les clés, et la période d'e1 portée en SQL — sa grille de 2026 à 2030, confrontée à `periodeDe` par le test du module ;
--   - LES MUTATIONS (contrôles 70 à 74) : chacune rejoue un contrôle avec un profil délibérément faux, et doit MORDRE ;
--   - et que RIEN ne reste en base.
--
-- DEUX PARTIES, À CAUSE DU CALENDRIER. Une déclaration ne se fait que d'une période FINIE dont la fin est au 01/09/2027 ou
-- après : aucune base ne peut en accepter avant le 2 septembre 2027. La partie A (contrôles 1 à 89) se joue à toute date —
-- ses périodes vont jusqu'en 2099, et la fonction juge « la période finie » en DERNIER : chaque autre refus s'y atteint dès
-- aujourd'hui. La partie B (contrôles 100 à 127 : des déclarations acceptées, la rectificative, la source déjà déclarée, le
-- régime retiré sous une déclaration, la frontière de « la période finie » — le mois du jour et celui qui le précède, lus
-- à Paris —, la pièce que retient une déclaration active quelle que soit la version de sa fiche) déclare septembre et
-- octobre 2027 : elle se joue quand la base lit un jour à partir du 01/11/2027 ; avant, une ligne le dit, SANS OBJET, et
-- c'est sur une réplique dont l'horloge du serveur est avancée (HISTORIQUE.md, « LA DÉCLARATION D'E-REPORTING HORS
-- APPLICATION, EN BASE ») qu'elle a été jouée.
--
-- CE QUI NE SE JOUE PAS ICI, ET SE JOUE SUR UNE RÉPLIQUE LOCALE dont signature.sql montre les neuf familles égales à la
-- production : la suppression d'une pièce que sa déclaration retient (hypothèse E5-Q6), celle d'un dossier, une
-- suppression directe, et deux sessions qui se croisent — l'outil d'exécution soumet une suppression à une confirmation
-- qui n'arrive pas ici.
--
-- Tout se joue dans trois dossiers JETABLES du cabinet du dossier `test` (T, A, et H pour l'histoire des régimes) et dans
-- le dossier du client, au sein d'un bloc qui s'annule entièrement à la fin (`ANNULATION_ESSAI_GLOBALE`) ; chaque contrôle
-- dans sa sous-transaction, annulée elle aussi (`ANNULATION_ESSAI`, P0001) — le moteur d'étapes de regimesEreporting.sql,
-- ses six genres (`jeu`, `controle`, `fait`, `valeur`, `retenir`, `lecture`) et ses profils (« membre » affecté au dossier
-- T, « membre_ailleurs » affecté au dossier A, « chef_simple », chef du cabinet sans être super-administrateur : le compte
-- client rattaché au cabinet le temps de la sous-transaction). Un refus se juge à son code ET à son message (motif LIKE).
-- Les identifiants jetables sont FIXES (préfixe `e5b00000`). Les contenus insérés par la porte de la restauration portent
-- l'empreinte que la base calcule — relevée sur la réplique, et que le test du module recalcule. Les verdicts voyagent dans
-- un réglage LOCAL à la transaction (`essai.declarations_ereporting`) : hors de l'outil d'exécution, le fichier se joue en
-- UNE transaction (`psql -1`). Aucune instruction de suppression.
do $essai$
declare
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  inconnu uuid := gen_random_uuid();
  dossier_test uuid := '001c7ed7-c23b-4590-901e-693489f8af24';
  dossier_client uuid; cabinet uuid;
  aujourd_hui date := (now() at time zone 'Europe/Paris')::date;
  ids jsonb;
  etapes text[];
  etapes_apres text[];
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
     or exists (select 1 from cabinet_admins where user_id = client) or exists (select 1 from super_admins where user_id = client)
     or aujourd_hui < date '2026-10-11' then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable, client déjà rattaché au cabinet (ou un jour d''avant le 11/10/2026 : les régimes de l''essai seraient dans l''avenir)';
  end if;

  ids := jsonb_build_object('CAB', cabinet, 'DC', dossier_client, 'AUTRE', gen_random_uuid())
    || jsonb_build_object('T', 'e5b00000-0000-4000-8000-0000000000a1', 'A', 'e5b00000-0000-4000-8000-0000000000a3',
                          'H', 'e5b00000-0000-4000-8000-0000000000a5')
    || jsonb_build_object(
      'P1', 'e5b00000-0000-4000-8001-000000000001', 'P2', 'e5b00000-0000-4000-8001-000000000002',
      'P3', 'e5b00000-0000-4000-8001-000000000003', 'PX', 'e5b00000-0000-4000-8001-0000000000a3',
      'PB1', 'e5b00000-0000-4000-8001-0000000000b1', 'PB2', 'e5b00000-0000-4000-8001-0000000000b2',
      'PB3', 'e5b00000-0000-4000-8001-0000000000b3')
    || jsonb_build_object(
      'DA', 'e5b00000-0000-4000-8004-0000000000da', 'DB', 'e5b00000-0000-4000-8004-0000000000db',
      'DC1', 'e5b00000-0000-4000-8004-0000000000c1', 'DC2', 'e5b00000-0000-4000-8004-0000000000c2',
      'DD', 'e5b00000-0000-4000-8004-0000000000dd', 'DE', 'e5b00000-0000-4000-8004-0000000000de',
      'DP', 'e5b00000-0000-4000-8004-0000000000df', 'DN', 'e5b00000-0000-4000-8004-0000000000d0',
      'DP2', 'e5b00000-0000-4000-8004-0000000000d2')
    || jsonb_build_object(
      'RH4', 'e5b00000-0000-4000-8002-0000000000a4', 'RH5', 'e5b00000-0000-4000-8002-0000000000a5',
      'RH6', 'e5b00000-0000-4000-8002-0000000000a6', 'RH7', 'e5b00000-0000-4000-8002-0000000000a7');

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from pieces)), ((select count(*) from regimes_ereporting)),
    ((select count(*) from pieces_hors_de_france)), ((select count(*) from factures_emises)),
    ((select count(*) from encaissements_factures)), ((select count(*) from declarations_ereporting)),
    ((select count(*) from declarations_ereporting_sources)), ((select count(*) from cabinet_admins)),
    ((select count(*) from dossier_assignations)), ((select count(*) from memberships))
  ) as t(n);

  -- Une étape : {genre, contrôle, qui, requête, code attendu, message attendu (motif LIKE) ou valeur attendue}.
  etapes := array[
    -- ══ Le jeu : trois dossiers jetables du cabinet du dossier test, leurs pièces, deux fiches « hors de France » ═════
    array['jeu', 'dossiers jetables', 'postgres', $q$insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values
      ('{T}', 'ESSAI DECLARATIONS T', '{CAB}', 'tresorerie', '455000'), ('{A}', 'ESSAI DECLARATIONS A', '{CAB}', 'tresorerie', '455000'),
      ('{H}', 'ESSAI DECLARATIONS H', '{CAB}', 'tresorerie', '455000')$q$, '', ''],
    array['jeu', 'pièces de T et de A', 'postgres', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, date_piece, montant_ht, montant_tva, montant_ttc, devise) values
      ('{P1}', '{T}', '{T}/essai-e5b-p1.pdf', 'essai-e5b-p1.pdf', 'achat', '2026-03-10', 120, null, 120, 'EUR'),
      ('{P2}', '{T}', '{T}/essai-e5b-p2.pdf', 'essai-e5b-p2.pdf', 'achat', '2026-03-11', 80, null, 80, 'EUR'),
      ('{P3}', '{T}', '{T}/essai-e5b-p3.pdf', 'essai-e5b-p3.pdf', 'achat', '2026-03-12', 60, null, 60, 'EUR'),
      ('{PX}', '{A}', '{A}/essai-e5b-px.pdf', 'essai-e5b-px.pdf', 'achat', '2026-03-10', 25, null, 25, 'EUR')$q$, '', ''],
    array['fait', '0. le jeu : la fiche de P1', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P1}', null, 'INV-P1', '2026-03-10', '380', null, null, 'IE', '0223', 'IE7777777T', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":120,"tva":0}]'::jsonb)$q$, 'OK', ''],
    array['retenir', 'F1', 'postgres', $q$select id::text from pieces_hors_de_france where piece_id = '{P1}'$q$, '', ''],
    array['fait', '0. le jeu : la fiche de P2', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P2}', null, 'INV-P2', '2026-03-11', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":80,"tva":0}]'::jsonb)$q$, 'OK', ''],
    array['retenir', 'F2', 'postgres', $q$select id::text from pieces_hors_de_france where piece_id = '{P2}'$q$, '', ''],
    array['fait', '0. le jeu : la fiche de PX, dans A', 'chef', $q$select enregistrer_fiche_hors_de_france('{A}', '{PX}', null, 'INV-PX', '2026-03-10', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":25,"tva":0}]'::jsonb)$q$, 'OK', ''],
    array['retenir', 'FX', 'postgres', $q$select id::text from pieces_hors_de_france where piece_id = '{PX}'$q$, '', ''],
    array['fait', '0. le jeu : une facture validée à un particulier, et un brouillon', 'chef', $q$select enregistrer_facture('{T}', null, '{"tiers_nom": "Essai", "type_client": "non_assujetti", "nature_operation": "services", "date_emission": "2026-03-15", "montant_ht": 10, "montant_tva": 2, "montant_ttc": 12}'::jsonb, '[{"designation": "a", "quantite": 1, "prix_unitaire_ht": 10, "taux_tva": 20}]'::jsonb, true), enregistrer_facture('{T}', null, '{"tiers_nom": "Essai", "type_client": "non_assujetti", "nature_operation": "services", "date_emission": "2026-03-16", "montant_ht": 10, "montant_tva": 2, "montant_ttc": 12}'::jsonb, '[{"designation": "a", "quantite": 1, "prix_unitaire_ht": 10, "taux_tva": 20}]'::jsonb, false)$q$, 'OK', ''],
    array['retenir', 'FV', 'postgres', $q$select id::text from factures_emises where dossier_id = '{T}' and statut = 'validee'$q$, '', ''],
    array['retenir', 'FB', 'postgres', $q$select id::text from factures_emises where dossier_id = '{T}' and statut = 'brouillon'$q$, '', ''],
    array['fait', '0. le jeu : un encaissement de la facture', 'chef', $q$select enregistrer_encaissement('{T}', '{FV}', '2026-03-20', 12, 'virement', null, '[{"taux": 20, "montant": 12}]'::jsonb)$q$, 'OK', ''],
    array['retenir', 'E1', 'postgres', $q$select id::text from encaissements_factures where facture_id = '{FV}'$q$, '', ''],
    array['fait', '0. le jeu : une facture validée dans A, et son encaissement', 'chef', $q$select enregistrer_facture('{A}', null, '{"tiers_nom": "Essai", "type_client": "non_assujetti", "nature_operation": "services", "date_emission": "2026-03-15", "montant_ht": 10, "montant_tva": 2, "montant_ttc": 12}'::jsonb, '[{"designation": "a", "quantite": 1, "prix_unitaire_ht": 10, "taux_tva": 20}]'::jsonb, true)$q$, 'OK', ''],
    array['retenir', 'FA', 'postgres', $q$select id::text from factures_emises where dossier_id = '{A}' and statut = 'validee'$q$, '', ''],
    array['fait', '0. le jeu : l''encaissement de la facture de A', 'chef', $q$select enregistrer_encaissement('{A}', '{FA}', '2026-03-20', 12, 'virement', null, '[{"taux": 20, "montant": 12}]'::jsonb)$q$, 'OK', ''],
    array['retenir', 'EA', 'postgres', $q$select id::text from encaissements_factures where facture_id = '{FA}'$q$, '', ''],
    -- Les régimes : T redevable au réel trimestriel depuis le 1er janvier 2026 (chaque mois) ; A et le dossier du client,
    -- un régime chacun ; H, une histoire — un régime retiré, un redevable mensuel sur les débits (par décade, aucun
    -- paiement), le même à partir du 5 juin, un exonéré à partir du 15 septembre.
    array['fait', '0. le jeu : le régime de T', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-01-01', 'redevable', null, 'trimestrielle', false, 'mois', 'mois', null)$q$, 'OK', ''],
    array['retenir', 'R1', 'postgres', $q$select id::text from regimes_ereporting where dossier_id = '{T}' and depuis = '2026-01-01'$q$, '', ''],
    array['fait', '0. le jeu : le régime de A et celui du dossier du client', 'chef', $q$select confirmer_regime_ereporting('{A}', '2026-01-01', 'redevable', null, 'trimestrielle', false, 'mois', 'mois', null), confirmer_regime_ereporting('{DC}', '2026-01-01', 'exonere', null, null, false, 'mois', 'mois', null)$q$, 'OK', ''],
    array['retenir', 'RA', 'postgres', $q$select id::text from regimes_ereporting where dossier_id = '{A}' and depuis = '2026-01-01'$q$, '', ''],
    array['retenir', 'RDC', 'postgres', $q$select id::text from regimes_ereporting where dossier_id = '{DC}' and depuis = '2026-01-01'$q$, '', ''],
    array['fait', '0. le jeu : l''histoire de H', 'chef', $q$select confirmer_regime_ereporting('{H}', '2025-01-01', 'franchise', null, null, false, 'bimestre', 'bimestre', null), confirmer_regime_ereporting('{H}', '2026-01-01', 'redevable', null, 'mensuelle', true, 'decade', null, null), confirmer_regime_ereporting('{H}', '2026-06-05', 'redevable', null, 'mensuelle', true, 'decade', null, null), confirmer_regime_ereporting('{H}', '2026-09-15', 'exonere', 'cgi_261_4_1', null, false, 'mois', 'mois', null)$q$, 'OK', ''],
    array['retenir', 'RH0', 'postgres', $q$select id::text from regimes_ereporting where dossier_id = '{H}' and depuis = '2025-01-01'$q$, '', ''],
    array['retenir', 'RH1', 'postgres', $q$select id::text from regimes_ereporting where dossier_id = '{H}' and depuis = '2026-01-01'$q$, '', ''],
    array['retenir', 'RH2', 'postgres', $q$select id::text from regimes_ereporting where dossier_id = '{H}' and depuis = '2026-06-05'$q$, '', ''],
    array['retenir', 'RH3', 'postgres', $q$select id::text from regimes_ereporting where dossier_id = '{H}' and depuis = '2026-09-15'$q$, '', ''],
    array['fait', '0. le jeu : le premier régime de H, retiré', 'chef', $q$select retirer_regime_ereporting('{H}', '{RH0}')$q$, 'OK', ''],
    -- La suite de l'histoire de H, en 2099, pour les bords du régime en vigueur : un régime égal au précédent qui commence
    -- un premier jour de mois (1er avril), un qui ne change que la fréquence des paiements (15 mai), un qui revient à la
    -- précédente le DERNIER jour d'un mois (30 juin), un qui en change de nouveau le 20 juillet, retiré. Un régime ne se
    -- confirme pas pour l'avenir : ils entrent par la porte de la restauration (le super-administrateur), que la garde
    -- d'un régime ne regarde pas.
    array['fait', '0. le jeu : la suite de l''histoire de H, en 2099 (par la porte de la restauration)', 'chef', $q$insert into regimes_ereporting (id, dossier_id, depuis, statut_tva, article_exoneration, tva_periodicite, tva_sur_debits, frequence_transactions, frequence_paiements, retire_le) values
      ('{RH4}', '{H}', '2099-04-01', 'exonere', 'cgi_261_4_1', null, false, 'mois', 'mois', null),
      ('{RH5}', '{H}', '2099-05-15', 'exonere', 'cgi_261_4_1', null, false, 'mois', 'bimestre', null),
      ('{RH6}', '{H}', '2099-06-30', 'exonere', 'cgi_261_4_1', null, false, 'mois', 'mois', null),
      ('{RH7}', '{H}', '2099-07-20', 'exonere', 'cgi_261_4_1', null, false, 'mois', 'bimestre', '2026-10-01T10:00:00Z')$q$, 'OK', ''],
    -- Les déclarations déjà faites, par la porte de la restauration (le super-administrateur), avec l'empreinte que la base
    -- calcule de leur contenu : les ventes de T de janvier-février 2099 (des bornes d'un bimestre : un régime d'une autre
    -- fréquence, retiré depuis), ses achats de mars 2099 et leur source, une rectificative de mai 2099 et la déclaration
    -- qu'elle remplace, ses paiements de février 2099, une déclaration dans le dossier du client et une dans A.
    array['fait', '0. le jeu : les déclarations déjà faites', 'chef', $q$insert into declarations_ereporting (id, dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, remplace_id, canal, plateforme, contenu, empreinte, nb_operations, etat, note, cree_le) values
      ('{DA}', '{T}', 'ventes', '2099-01-01', '2099-02-28', '{R1}', 'IN', null, 'manuel', 'Plateforme A', '{"objet": "ventes", "debut": "2099-01-01", "fin": "2099-02-28", "role": "SE", "nombreOperations": 1}'::jsonb, '967f9b892bd8cb112cf465035a7afec26fb6d9b0fcb99970cfd0ec56a27306e0', 1, 'declaree', null, '2026-04-01T10:00:00Z'),
      ('{DB}', '{T}', 'achats', '2099-03-01', '2099-03-31', '{R1}', 'IN', null, 'manuel', 'Plateforme B', '{"objet": "achats", "debut": "2099-03-01", "fin": "2099-03-31", "role": "BY", "nombreOperations": 1}'::jsonb, '8ddf2b86e5c36ce6fb38fb15d0dccabfe178683503dcf2707b28ecb1cda9a131', 1, 'declaree', null, '2026-04-02T10:00:00Z'),
      ('{DC1}', '{T}', 'achats', '2099-05-01', '2099-05-31', '{R1}', 'IN', null, 'manuel', 'Plateforme C', '{"objet": "achats", "debut": "2099-05-01", "fin": "2099-05-31", "role": "BY", "nombreOperations": 1}'::jsonb, 'bdf05aa867601c917e08e38a91b7f3ce7ade5364f08f2ce1156d99c624478f87', 1, 'remplacee', null, '2026-04-03T10:00:00Z'),
      ('{DP}', '{T}', 'paiements', '2099-02-01', '2099-02-28', '{R1}', 'IN', null, 'manuel', 'Plateforme P', '{"objet": "paiements", "debut": "2099-02-01", "fin": "2099-02-28", "role": "SE", "nombreOperations": 1}'::jsonb, 'e8cd21e0cd6f531b3cfdd58cf54112a9afb65fdb5e5b9fbb8a5585956c696df8', 1, 'declaree', null, '2026-04-05T10:00:00Z'),
      ('{DD}', '{DC}', 'achats', '2099-01-01', '2099-01-31', '{RDC}', 'IN', null, 'manuel', 'Plateforme D', '{"objet": "achats", "debut": "2099-01-01", "fin": "2099-01-31", "role": "BY", "nombreOperations": 1, "dossier": "client"}'::jsonb, '4c6dcdace37ab1ef571813d090220a5724b7751b52c649e1346643158eea030e', 1, 'declaree', null, '2026-04-06T10:00:00Z'),
      ('{DE}', '{A}', 'achats', '2099-01-01', '2099-01-31', '{RA}', 'IN', null, 'manuel', 'Plateforme E', '{"objet": "achats", "debut": "2099-01-01", "fin": "2099-01-31", "role": "BY", "nombreOperations": 1, "dossier": "autre"}'::jsonb, '1b17949310edc6ed6522ef8989adf84aaea3d90a4b2be5937071ab73973d793b', 1, 'declaree', null, '2026-04-07T10:00:00Z')$q$, 'OK', ''],
    array['fait', '0. le jeu : la rectificative de mai 2099, après la déclaration qu''elle remplace', 'chef', $q$insert into declarations_ereporting (id, dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, remplace_id, canal, plateforme, contenu, empreinte, nb_operations, etat, note, cree_le) values
      ('{DC2}', '{T}', 'achats', '2099-05-01', '2099-05-31', '{R1}', 'RE', '{DC1}', 'manuel', 'Plateforme C', '{"objet": "achats", "debut": "2099-05-01", "fin": "2099-05-31", "role": "BY", "nombreOperations": 2}'::jsonb, 'c8ea40762fa1d0accd1d8adcabf5ac3b419b98e3493d55bebe50c2b5cd0db8e1', 2, 'declaree', null, '2026-04-04T10:00:00Z')$q$, 'OK', ''],
    array['fait', '0. le jeu : leurs sources', 'chef', $q$insert into declarations_ereporting_sources (declaration_id, dossier_id, genre, source_id) values
      ('{DB}', '{T}', 'fiche', '{F2}'), ('{DP}', '{T}', 'encaissement', '{E1}'), ('{DE}', '{A}', 'fiche', '{FX}')$q$, 'OK', ''],

    -- ══ 1 à 6. Qui déclare ══════════
    array['controle', '1. anonyme : pas le droit d''appeler', 'anon', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', null, null)$q$,
      '42501', 'permission denied for function declarer_ereporting_hors_application'],
    array['controle', '2. rattaché à rien : l''accès au dossier, avant de rien lire', 'inconnu', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', null, null)$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '3. client, le dossier d''un autre', 'client', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', null, null)$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '4. client, son propre dossier', 'client', $q$select declarer_ereporting_hors_application('{DC}', 'achats', '2099-06-01', '2099-06-30', '{RDC}', null, 'Plateforme', null, null)$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '5. membre du cabinet affecté à un AUTRE dossier', 'membre_ailleurs', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', null, null)$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '6. un dossier qui n''existe pas, même pour le super-administrateur', 'chef', $q$select declarer_ereporting_hors_application('{AUTRE}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', null, null)$q$,
      '42501', 'Accès refusé à ce dossier.'],

    -- ══ 7 et 8. L'objet, les bornes ══════════
    array['controle', '7. un objet inconnu', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'tout', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', null, null)$q$,
      '22023', 'Une déclaration d''e-reporting porte sur les ventes, les achats ou les paiements du dossier.'],
    array['controle', '7b. aucun objet, et rien d''autre : l''objet se dit d''abord', 'chef', $q$select declarer_ereporting_hors_application('{T}', null, null, null, null, null, null, null, null)$q$,
      '22023', 'Une déclaration d''e-reporting porte sur les ventes, les achats ou les paiements du dossier.'],
    array['controle', '8. le début absent', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', null, '2099-06-30', '{R1}', null, 'Plateforme', null, null)$q$,
      '22023', 'Les deux bornes de la période sont à renseigner.'],
    array['controle', '8b. la fin absente, et aucun régime : les bornes avant le régime', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', null, null, null, null, null, null)$q$,
      '22023', 'Les deux bornes de la période sont à renseigner.'],

    -- ══ 9 à 16. Le régime, la période, l'obligation ══════════
    array['controle', '9. aucun régime désigné', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', null, null, 'Plateforme', null, null)$q$,
      'P0002', 'Régime introuvable dans ce dossier.'],
    array['controle', '9b. le régime d''un autre dossier', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{RDC}', null, 'Plateforme', null, null)$q$,
      'P0002', 'Régime introuvable dans ce dossier.'],
    array['controle', '9c. un régime qui n''existe pas', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{AUTRE}', null, 'Plateforme', null, null)$q$,
      'P0002', 'Régime introuvable dans ce dossier.'],
    array['controle', '10. un régime retiré', 'chef', $q$select declarer_ereporting_hors_application('{H}', 'achats', '2099-01-01', '2099-01-10', '{RH0}', null, 'Plateforme', null, null)$q$,
      '22023', 'Ce régime est retiré : une période se déclare sous le régime confirmé qui la couvre.'],
    array['controle', '11. un régime qui ne couvre pas le début de la période', 'chef', $q$select declarer_ereporting_hors_application('{H}', 'achats', '2025-12-21', '2025-12-31', '{RH1}', null, 'Plateforme', null, null)$q$,
      '22023', 'Ce régime ne vaut qu''à partir du 01/01/2026 : il ne couvre pas le début de la période.'],
    array['controle', '11b. un régime qui commence DANS la période ne couvre pas son début', 'chef', $q$select declarer_ereporting_hors_application('{H}', 'achats', '2026-09-11', '2026-09-20', '{RH3}', null, 'Plateforme', null, null)$q$,
      '22023', 'Ce régime ne vaut qu''à partir du 15/09/2026 : il ne couvre pas le début de la période.'],
    array['controle', '12. un régime que d''autres ont suivi : le dernier avant le début de la période est en vigueur', 'chef', $q$select declarer_ereporting_hors_application('{H}', 'achats', '2099-01-01', '2099-01-10', '{RH1}', null, 'Plateforme', null, null)$q$,
      '22023', 'Le régime en vigueur le 01/01/2099 est celui confirmé à partir du 15/09/2026 : relisez.'],
    array['controle', '12b. un régime qui commence le premier jour de la période est en vigueur ce jour-là, même égal', 'chef', $q$select declarer_ereporting_hors_application('{H}', 'achats', '2099-04-01', '2099-04-30', '{RH3}', null, 'Plateforme', null, null)$q$,
      '22023', 'Le régime en vigueur le 01/04/2099 est celui confirmé à partir du 01/04/2099 : relisez.'],
    array['controle', '12c. un régime retiré entre-temps n''est pas en vigueur : la plateforme se dit ensuite', 'chef', $q$select declarer_ereporting_hors_application('{H}', 'achats', '2099-08-01', '2099-08-31', '{RH6}', null, null, null, null)$q$,
      '22023', 'La plateforme sur laquelle la période a été déclarée est à nommer.'],
    array['controle', '13. un régime qui déclare autrement commence dans la période', 'chef', $q$select declarer_ereporting_hors_application('{H}', 'achats', '2026-09-11', '2026-09-20', '{RH2}', null, 'Plateforme', null, null)$q$,
      '22023', 'Le régime du dossier change dans la période, le 15/09/2026 : une période à cheval sur deux régimes ne se déclare pas ici, les sources publiques ne disant pas comment. À trancher par le cabinet.'],
    array['controle', '13b. un régime égal qui commence dans la période n''est pas un changement : l''obligation se dit ensuite', 'chef', $q$select declarer_ereporting_hors_application('{H}', 'achats', '2026-06-01', '2026-06-10', '{RH1}', null, 'Plateforme', null, null)$q$,
      '22023', 'La période finit le 10/06/2026, avant le 1er septembre 2027 : l''e-reporting d''une PME ou d''une micro-entreprise commence avec les factures de ce jour.'],
    array['controle', '13c. un régime qui ne change que la fréquence des paiements change aussi le régime', 'chef', $q$select declarer_ereporting_hors_application('{H}', 'achats', '2099-05-01', '2099-05-31', '{RH4}', null, 'Plateforme', null, null)$q$,
      '22023', 'Le régime du dossier change dans la période, le 15/05/2099 : une période à cheval sur deux régimes ne se déclare pas ici, les sources publiques ne disant pas comment. À trancher par le cabinet.'],
    array['controle', '13d. un changement le dernier jour de la période est dans la période', 'chef', $q$select declarer_ereporting_hors_application('{H}', 'achats', '2099-06-01', '2099-06-30', '{RH5}', null, 'Plateforme', null, null)$q$,
      '22023', 'Le régime du dossier change dans la période, le 30/06/2099 : une période à cheval sur deux régimes ne se déclare pas ici, les sources publiques ne disant pas comment. À trancher par le cabinet.'],
    array['controle', '13e. un régime retiré qui commençait dans la période n''est pas un changement : la plateforme se dit ensuite', 'chef', $q$select declarer_ereporting_hors_application('{H}', 'achats', '2099-07-01', '2099-07-31', '{RH6}', null, null, null, null)$q$,
      '22023', 'La plateforme sur laquelle la période a été déclarée est à nommer.'],
    array['controle', '14. des paiements sur option pour les débits', 'chef', $q$select declarer_ereporting_hors_application('{H}', 'paiements', '2026-02-01', '2026-02-28', '{RH1}', null, 'Plateforme', null, null)$q$,
      '22023', 'Sous ce régime, sur option pour la TVA sur les débits, le dossier n''a pas de données de paiement à déclarer.'],
    array['controle', '14b. les achats du même régime, si : la décade se dit ensuite', 'chef', $q$select declarer_ereporting_hors_application('{H}', 'achats', '2026-02-01', '2026-02-28', '{RH1}', null, 'Plateforme', null, null)$q$,
      '22023', 'Du 01/02/2026 au 28/02/2026 n''est pas une période de ses déclarations : sous ce régime, elles se font par décade.'],
    array['controle', '15. une décade sous un régime au mois', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-01-01', '2099-01-10', '{R1}', null, 'Plateforme', null, null)$q$,
      '22023', 'Du 01/01/2099 au 10/01/2099 n''est pas une période de ses déclarations : sous ce régime, elles se font chaque mois.'],
    array['controle', '15b. des bornes à l''envers', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-01-31', '2099-01-01', '{R1}', null, 'Plateforme', null, null)$q$,
      '22023', 'Du 31/01/2099 au 01/01/2099 n''est pas une période de ses déclarations : sous ce régime, elles se font chaque mois.'],
    array['controle', '15c. un bimestre sous un régime au mois', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'paiements', '2099-03-01', '2099-04-30', '{R1}', null, 'Plateforme', null, null)$q$,
      '22023', 'Du 01/03/2099 au 30/04/2099 n''est pas une période de ses déclarations : sous ce régime, elles se font chaque mois.'],
    array['controle', '16. une période finie avant le 1er septembre 2027', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2027-08-01', '2027-08-31', '{R1}', null, 'Plateforme', null, null)$q$,
      '22023', 'La période finit le 31/08/2027, avant le 1er septembre 2027 : l''e-reporting d''une PME ou d''une micro-entreprise commence avec les factures de ce jour.'],
    array['controle', '16b. septembre 2027 entre dans l''obligation : la plateforme se dit ensuite', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2027-09-01', '2027-09-30', '{R1}', null, null, null, null)$q$,
      '22023', 'La plateforme sur laquelle la période a été déclarée est à nommer.'],

    -- ══ 17 à 21. Une seule active ; l'initiale et la rectificative ══════════
    array['controle', '17. une période que chevauche une déclaration active d''autres bornes', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'ventes', '2099-01-01', '2099-01-31', '{R1}', null, 'Plateforme', null, null)$q$,
      '22023', 'La période chevauche celle d''une déclaration active, du 01/01/2099 au 28/02/2099 : une même opération ne se déclare pas deux fois. À trancher par le cabinet.'],
    array['controle', '17b. un autre objet ne chevauche pas : les paiements de janvier se jugent ensuite', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'paiements', '2099-01-01', '2099-01-31', '{R1}', null, null, null, null)$q$,
      '22023', 'La plateforme sur laquelle la période a été déclarée est à nommer.'],
    array['controle', '18. une initiale sur une période déjà déclarée', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-03-01', '2099-03-31', '{R1}', null, 'Plateforme', null, null)$q$,
      '22023', 'Une déclaration de cette période est déjà active, faite sur « Plateforme B » : une correction se fait par une déclaration rectificative, qui la remplace entière.'],
    array['controle', '18b. et elle se dit avant la plateforme', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-03-01', '2099-03-31', '{R1}', null, null, null, null)$q$,
      '22023', 'Une déclaration de cette période est déjà active, faite sur « Plateforme B » : une correction se fait par une déclaration rectificative, qui la remplace entière.'],
    array['controle', '19. une rectificative d''une déclaration qui n''existe pas', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-03-01', '2099-03-31', '{R1}', '{AUTRE}', 'Plateforme', null, null)$q$,
      'P0002', 'Déclaration introuvable dans ce dossier.'],
    array['controle', '19b. une rectificative d''une déclaration d''un autre dossier', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-01-01', '2099-01-31', '{R1}', '{DE}', 'Plateforme', null, null)$q$,
      'P0002', 'Déclaration introuvable dans ce dossier.'],
    array['controle', '20. une rectificative d''une autre période', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-04-01', '2099-04-30', '{R1}', '{DB}', 'Plateforme', null, null)$q$,
      '22023', 'Une rectificative remplace la déclaration de la même période et du même objet : celle-ci en déclare une autre.'],
    array['controle', '20b. une rectificative d''un autre objet', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'paiements', '2099-03-01', '2099-03-31', '{R1}', '{DB}', 'Plateforme', null, null)$q$,
      '22023', 'Une rectificative remplace la déclaration de la même période et du même objet : celle-ci en déclare une autre.'],
    array['controle', '21. une rectificative d''une déclaration déjà remplacée', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-05-01', '2099-05-31', '{R1}', '{DC1}', 'Plateforme', null, null)$q$,
      '22023', 'Cette déclaration est déjà remplacée : une rectificative remplace la déclaration active de la période.'],
    array['controle', '21b. la rectificative de l''active : la plateforme se dit ensuite', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-05-01', '2099-05-31', '{R1}', '{DC2}', '   ', null, null)$q$,
      '22023', 'La plateforme sur laquelle la période a été déclarée est à nommer.'],

    -- ══ 22 à 24. La plateforme, la note ══════════
    array['controle', '22. la plateforme absente', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, null, null, null)$q$,
      '22023', 'La plateforme sur laquelle la période a été déclarée est à nommer.'],
    array['controle', '23. une plateforme de plus de 200 caractères', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, repeat('p', 201), null, repeat('n', 2001))$q$,
      '22023', 'Le nom de la plateforme dépasse 200 caractères.'],
    array['controle', '24. une note de plus de 2 000 caractères', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, repeat('p', 200), null, repeat('n', 2001))$q$,
      '22023', 'La note de la déclaration dépasse 2 000 caractères.'],
    array['controle', '24b. 2 000 caractères, si : le contenu se dit ensuite', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', null, repeat('n', 2000))$q$,
      '22023', 'Le contenu déclaré est à joindre : celui que l''application a calculé pour la période.'],
    array['controle', '24c. des espaces ne sont pas une note', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', null, repeat(' ', 3000))$q$,
      '22023', 'Le contenu déclaré est à joindre : celui que l''application a calculé pour la période.'],

    -- ══ 25 à 35. Le contenu ══════════
    array['controle', '25. un contenu qui n''est pas un objet', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', '[]'::jsonb, null)$q$,
      '22023', 'Le contenu déclaré est à joindre : celui que l''application a calculé pour la période.'],
    array['controle', '25b. une chaîne non plus', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', '"contenu"'::jsonb, null)$q$,
      '22023', 'Le contenu déclaré est à joindre : celui que l''application a calculé pour la période.'],
    array['controle', '26. un contenu de plus d''un mégaoctet', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', jsonb_set('{"version": 1, "objet": "ventes"}'::jsonb, '{bourre}', to_jsonb(repeat('b', 1048576))), null)$q$,
      '22023', 'Le contenu déclaré dépasse un mégaoctet (1 048 576 octets).'],
    array['controle', '26b. un octet de trop : 1 048 577', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', jsonb_build_object('bourre', repeat('b', 1048563)), null)$q$,
      '22023', 'Le contenu déclaré dépasse un mégaoctet (1 048 576 octets).'],
    array['controle', '26c. 1 048 576 octets, si : l''objet se dit ensuite', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', jsonb_build_object('bourre', repeat('b', 1048562)), null)$q$,
      '22023', 'Le contenu ne porte pas sur cet objet et cette période : relisez.'],
    array['controle', '26d. des octets, pas des caractères : 600 014 caractères, 1 200 014 octets', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', jsonb_build_object('bourre', repeat('é', 600000)), null)$q$,
      '22023', 'Le contenu déclaré dépasse un mégaoctet (1 048 576 octets).'],
    array['controle', '27. un contenu d''un autre objet', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "ventes", "debut": "2099-06-01", "fin": "2099-06-30", "role": "BY", "achats": [], "nombreOperations": 0}'::jsonb, null)$q$,
      '22023', 'Le contenu ne porte pas sur cet objet et cette période : relisez.'],
    array['controle', '27b. d''une autre période', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "achats", "debut": "2099-07-01", "fin": "2099-06-30", "role": "BY", "achats": [], "nombreOperations": 0}'::jsonb, null)$q$,
      '22023', 'Le contenu ne porte pas sur cet objet et cette période : relisez.'],
    array['controle', '27c. d''un autre déclarant', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "achats", "debut": "2099-06-01", "fin": "2099-06-30", "role": "SE", "achats": [], "nombreOperations": 0}'::jsonb, null)$q$,
      '22023', 'Le contenu ne porte pas sur cet objet et cette période : relisez.'],
    array['controle', '27d. sans son rôle', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'paiements', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "paiements", "debut": "2099-06-01", "fin": "2099-06-30", "paiements": [], "nombreOperations": 0}'::jsonb, null)$q$,
      '22023', 'Le contenu ne porte pas sur cet objet et cette période : relisez.'],
    array['controle', '27e. une fin écrite comme un nombre', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "achats", "debut": "2099-06-01", "fin": 20990630, "role": "BY", "achats": [], "nombreOperations": 0}'::jsonb, null)$q$,
      '22023', 'Le contenu ne porte pas sur cet objet et cette période : relisez.'],
    array['controle', '28. des opérations absentes', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "achats", "debut": "2099-06-01", "fin": "2099-06-30", "role": "BY", "nombreOperations": 0}'::jsonb, null)$q$,
      '22023', 'Le contenu déclaré ne se lit pas : chaque opération porte sa date et ses sources.'],
    array['controle', '28b. des opérations qui ne sont pas une liste', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "achats", "debut": "2099-06-01", "fin": "2099-06-30", "role": "BY", "achats": {"ficheId": "{F1}"}, "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'Le contenu déclaré ne se lit pas : chaque opération porte sa date et ses sources.'],
    array['controle', '28c. une opération qui n''est pas un objet', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "achats", "debut": "2099-06-01", "fin": "2099-06-30", "role": "BY", "achats": ["{F1}"], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'Le contenu déclaré ne se lit pas : chaque opération porte sa date et ses sources.'],
    array['controle', '28d. une opération sans date', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "achats", "debut": "2099-06-01", "fin": "2099-06-30", "role": "BY", "achats": [{"ficheId": "{F1}", "pieceId": "{P1}"}], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'Le contenu déclaré ne se lit pas : chaque opération porte sa date et ses sources.'],
    array['controle', '28e. une date qui n''existe pas', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "achats", "debut": "2099-06-01", "fin": "2099-06-30", "role": "BY", "achats": [{"ficheId": "{F1}", "pieceId": "{P1}", "date": "2099-06-31"}], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'Le contenu déclaré ne se lit pas : chaque opération porte sa date et ses sources.'],
    array['controle', '28f. une date qui n''est pas civile', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "achats", "debut": "2099-06-01", "fin": "2099-06-30", "role": "BY", "achats": [{"ficheId": "{F1}", "pieceId": "{P1}", "date": "2099-06-10T00:00"}], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'Le contenu déclaré ne se lit pas : chaque opération porte sa date et ses sources.'],
    array['controle', '28g. un achat sans sa fiche', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "achats", "debut": "2099-06-01", "fin": "2099-06-30", "role": "BY", "achats": [{"pieceId": "{P1}", "date": "2099-06-10"}], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'Le contenu déclaré ne se lit pas : chaque opération porte sa date et ses sources.'],
    array['controle', '28h. une fiche qui n''est pas un identifiant', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "achats", "debut": "2099-06-01", "fin": "2099-06-30", "role": "BY", "achats": [{"ficheId": "F1", "pieceId": "{P1}", "date": "2099-06-10"}], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'Le contenu déclaré ne se lit pas : chaque opération porte sa date et ses sources.'],
    array['controle', '28i. une pièce écrite comme un nombre', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "achats", "debut": "2099-06-01", "fin": "2099-06-30", "role": "BY", "achats": [{"ficheId": "{F1}", "pieceId": 1, "date": "2099-06-10"}], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'Le contenu déclaré ne se lit pas : chaque opération porte sa date et ses sources.'],
    array['controle', '28j. des factures qui ne sont pas une liste', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'ventes', '2099-07-01', '2099-07-31', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "ventes", "debut": "2099-07-01", "fin": "2099-07-31", "role": "SE", "transactions": [{"date": "2099-07-10", "factures": "{FV}"}], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'Le contenu déclaré ne se lit pas : chaque opération porte sa date et ses sources.'],
    array['controle', '28k. une facture écrite comme un nombre', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'ventes', '2099-07-01', '2099-07-31', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "ventes", "debut": "2099-07-01", "fin": "2099-07-31", "role": "SE", "transactions": [{"date": "2099-07-10", "factures": [12]}], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'Le contenu déclaré ne se lit pas : chaque opération porte sa date et ses sources.'],
    array['controle', '28l. un encaissement qui n''est pas un identifiant', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'paiements', '2099-07-01', '2099-07-31', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "paiements", "debut": "2099-07-01", "fin": "2099-07-31", "role": "SE", "paiements": [{"date": "2099-07-10", "encaissements": [" {E1}"]}], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'Le contenu déclaré ne se lit pas : chaque opération porte sa date et ses sources.'],
    -- Un nombre de 32 chiffres se lit comme un identifiant (`->>` le rend en texte, et 32 chiffres hexadécimaux en sont un) :
    -- une source écrite comme un nombre se refuse à sa FORME, avant d'être cherchée.
    array['controle', '28m. une pièce écrite comme un nombre de 32 chiffres', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "achats", "debut": "2099-06-01", "fin": "2099-06-30", "role": "BY", "achats": [{"ficheId": "{F1}", "pieceId": 12345678123456781234567812345678, "date": "2099-06-10"}], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'Le contenu déclaré ne se lit pas : chaque opération porte sa date et ses sources.'],
    array['controle', '28n. une fiche écrite comme un nombre de 32 chiffres', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "achats", "debut": "2099-06-01", "fin": "2099-06-30", "role": "BY", "achats": [{"ficheId": 12345678123456781234567812345678, "pieceId": "{P1}", "date": "2099-06-10"}], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'Le contenu déclaré ne se lit pas : chaque opération porte sa date et ses sources.'],
    array['controle', '28o. une facture écrite comme un nombre de 32 chiffres', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'ventes', '2099-07-01', '2099-07-31', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "ventes", "debut": "2099-07-01", "fin": "2099-07-31", "role": "SE", "transactions": [{"date": "2099-07-10", "factures": [12345678123456781234567812345678]}], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'Le contenu déclaré ne se lit pas : chaque opération porte sa date et ses sources.'],
    array['controle', '29. une opération datée hors de la période', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "achats", "debut": "2099-06-01", "fin": "2099-06-30", "role": "BY", "achats": [{"ficheId": "{F1}", "pieceId": "{P1}", "date": "2099-07-01"}], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'Une opération du contenu est datée du 01/07/2099, hors de la période : relisez.'],
    array['controle', '29b. deux, et la plus ancienne se dit', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'ventes', '2099-07-01', '2099-07-31', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "ventes", "debut": "2099-07-01", "fin": "2099-07-31", "role": "SE", "transactions": [{"date": "2099-08-01", "factures": ["{FV}"]}, {"date": "2099-06-30", "factures": ["{FB}"]}], "nombreOperations": 2}'::jsonb, null)$q$,
      '22023', 'Une opération du contenu est datée du 30/06/2099, hors de la période : relisez.'],
    array['controle', '30. aucune opération : jamais à blanc', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "achats", "debut": "2099-06-01", "fin": "2099-06-30", "role": "BY", "achats": [], "nombreOperations": 0}'::jsonb, null)$q$,
      '22023', 'Une période sans opération ne se déclare pas : aucune transmission n''est attendue.'],
    array['controle', '30b. un agrégat sans facture non plus', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'ventes', '2099-07-01', '2099-07-31', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "ventes", "debut": "2099-07-01", "fin": "2099-07-31", "role": "SE", "transactions": [{"date": "2099-07-10", "factures": []}], "nombreOperations": 0}'::jsonb, null)$q$,
      '22023', 'Une période sans opération ne se déclare pas : aucune transmission n''est attendue.'],
    array['controle', '31. la même fiche deux fois', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "achats", "debut": "2099-06-01", "fin": "2099-06-30", "role": "BY", "achats": [{"ficheId": "{F1}", "pieceId": "{P1}", "date": "2099-06-10"}, {"ficheId": "{F1}", "pieceId": "{P1}", "date": "2099-06-11"}], "nombreOperations": 2}'::jsonb, null)$q$,
      '22023', 'Une même source figure deux fois dans le contenu : une opération ne se déclare qu''une fois.'],
    array['controle', '31b. la même facture dans deux agrégats, écrite deux fois autrement', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'ventes', '2099-07-01', '2099-07-31', '{R1}', null, 'Plateforme', jsonb_set('{"version": 1, "objet": "ventes", "debut": "2099-07-01", "fin": "2099-07-31", "role": "SE", "transactions": [{"date": "2099-07-10", "factures": ["{FV}"]}, {"date": "2099-07-11", "factures": []}], "nombreOperations": 2}'::jsonb, '{transactions,1,factures}', jsonb_build_array(upper('{FV}'))), null)$q$,
      '22023', 'Une même source figure deux fois dans le contenu : une opération ne se déclare qu''une fois.'],
    array['controle', '32. un nombre d''opérations qui n''est pas le sien', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "achats", "debut": "2099-06-01", "fin": "2099-06-30", "role": "BY", "achats": [{"ficheId": "{F1}", "pieceId": "{P1}", "date": "2099-06-10"}], "nombreOperations": 2}'::jsonb, null)$q$,
      '22023', 'Le contenu n''annonce pas le nombre de ses opérations (1) : relisez.'],
    array['controle', '32b. aucun nombre annoncé', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "achats", "debut": "2099-06-01", "fin": "2099-06-30", "role": "BY", "achats": [{"ficheId": "{F1}", "pieceId": "{P1}", "date": "2099-06-10"}]}'::jsonb, null)$q$,
      '22023', 'Le contenu n''annonce pas le nombre de ses opérations (1) : relisez.'],
    array['controle', '32c. un nombre écrit comme un texte', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "achats", "debut": "2099-06-01", "fin": "2099-06-30", "role": "BY", "achats": [{"ficheId": "{F1}", "pieceId": "{P1}", "date": "2099-06-10"}], "nombreOperations": "1"}'::jsonb, null)$q$,
      '22023', 'Le contenu n''annonce pas le nombre de ses opérations (1) : relisez.'],
    array['controle', '32d. le nombre des factures, non des agrégats', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'ventes', '2099-07-01', '2099-07-31', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "ventes", "debut": "2099-07-01", "fin": "2099-07-31", "role": "SE", "transactions": [{"date": "2099-07-10", "factures": ["{FV}", "{FB}"]}], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'Le contenu n''annonce pas le nombre de ses opérations (2) : relisez.'],
    array['controle', '33. la fiche d''une pièce d''un autre dossier', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "achats", "debut": "2099-06-01", "fin": "2099-06-30", "role": "BY", "achats": [{"ficheId": "{FX}", "pieceId": "{PX}", "date": "2099-06-10"}], "nombreOperations": 1.0}'::jsonb, null)$q$,
      '22023', 'Une source du contenu n''est pas la fiche « fournisseur établi hors de France » d''une pièce de ce dossier : relisez.'],
    array['controle', '33b. la fiche d''une autre pièce', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "achats", "debut": "2099-06-01", "fin": "2099-06-30", "role": "BY", "achats": [{"ficheId": "{F1}", "pieceId": "{P2}", "date": "2099-06-10"}], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'Une source du contenu n''est pas la fiche « fournisseur établi hors de France » d''une pièce de ce dossier : relisez.'],
    array['controle', '33c. une fiche qui n''existe pas', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "achats", "debut": "2099-06-01", "fin": "2099-06-30", "role": "BY", "achats": [{"ficheId": "{AUTRE}", "pieceId": "{P1}", "date": "2099-06-10"}], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'Une source du contenu n''est pas la fiche « fournisseur établi hors de France » d''une pièce de ce dossier : relisez.'],
    array['controle', '33d. une facture qui n''est pas validée', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'ventes', '2099-07-01', '2099-07-31', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "ventes", "debut": "2099-07-01", "fin": "2099-07-31", "role": "SE", "transactions": [{"date": "2099-07-10", "factures": ["{FV}", "{FB}"]}], "nombreOperations": 2}'::jsonb, null)$q$,
      '22023', 'Une source du contenu n''est pas une facture validée de ce dossier : relisez.'],
    array['controle', '33e. un encaissement qui n''existe pas', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'paiements', '2099-07-01', '2099-07-31', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "paiements", "debut": "2099-07-01", "fin": "2099-07-31", "role": "SE", "paiements": [{"date": "2099-07-10", "encaissements": ["{AUTRE}"]}], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'Une source du contenu n''est pas un encaissement de ce dossier : relisez.'],
    array['controle', '33f. la facture validée d''un autre dossier', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'ventes', '2099-07-01', '2099-07-31', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "ventes", "debut": "2099-07-01", "fin": "2099-07-31", "role": "SE", "transactions": [{"date": "2099-07-10", "factures": ["{FA}"]}], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'Une source du contenu n''est pas une facture validée de ce dossier : relisez.'],
    array['controle', '33g. l''encaissement d''un autre dossier', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'paiements', '2099-07-01', '2099-07-31', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "paiements", "debut": "2099-07-01", "fin": "2099-07-31", "role": "SE", "paiements": [{"date": "2099-07-10", "encaissements": ["{EA}"]}], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'Une source du contenu n''est pas un encaissement de ce dossier : relisez.'],
    array['controle', '34. une pièce déjà déclarée dans une autre période active', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-04-01', '2099-04-30', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "achats", "debut": "2099-04-01", "fin": "2099-04-30", "role": "BY", "achats": [{"ficheId": "{F2}", "pieceId": "{P2}", "date": "2099-04-10"}], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'Une opération du contenu est déjà déclarée, dans la période du 01/03/2099 au 31/03/2099 : la période qui la porte se rectifie d''abord.'],
    array['controle', '34b. un encaissement déjà déclaré', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'paiements', '2099-07-01', '2099-07-31', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "paiements", "debut": "2099-07-01", "fin": "2099-07-31", "role": "SE", "paiements": [{"date": "2099-07-10", "encaissements": ["{E1}"]}], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'Une opération du contenu est déjà déclarée, dans la période du 01/02/2099 au 28/02/2099 : la période qui la porte se rectifie d''abord.'],
    array['controle', '34c. la rectificative de la période qui la porte, si : la période se dit ensuite', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-03-01', '2099-03-31', '{R1}', '{DB}', 'Plateforme', '{"version": 1, "objet": "achats", "debut": "2099-03-01", "fin": "2099-03-31", "role": "BY", "achats": [{"ficheId": "{F2}", "pieceId": "{P2}", "date": "2099-03-10"}], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'La période n''est pas finie : elle se déclare à partir du 01/04/2099.'],
    array['controle', '35. une période qui n''est pas finie', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "achats", "debut": "2099-06-01", "fin": "2099-06-30", "role": "BY", "achats": [{"ficheId": "{F1}", "pieceId": "{P1}", "date": "2099-06-10"}], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'La période n''est pas finie : elle se déclare à partir du 01/07/2099.'],
    array['controle', '35b. des ventes non plus', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'ventes', '2099-07-01', '2099-07-31', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "ventes", "debut": "2099-07-01", "fin": "2099-07-31", "role": "SE", "transactions": [{"date": "2099-07-10", "factures": ["{FV}"]}], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'La période n''est pas finie : elle se déclare à partir du 01/08/2099.'],
    array['controle', '35c. une fiche écrite en majuscules et entre accolades est la même fiche', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', jsonb_set('{"version": 1, "objet": "achats", "debut": "2099-06-01", "fin": "2099-06-30", "role": "BY", "achats": [{"pieceId": "{P1}", "date": "2099-06-10"}], "nombreOperations": 1}'::jsonb, '{achats,0,ficheId}', to_jsonb('{' || upper('{F1}') || '}')), null)$q$,
      '22023', 'La période n''est pas finie : elle se déclare à partir du 01/07/2099.'],

    -- ══ 36 et 37. Les autres profils du cabinet atteignent les refus qui suivent l'accès ══════════
    array['controle', '36. le membre affecté au dossier', 'membre', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "achats", "debut": "2099-06-01", "fin": "2099-06-30", "role": "BY", "achats": [{"ficheId": "{F1}", "pieceId": "{P1}", "date": "2099-06-10"}], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'La période n''est pas finie : elle se déclare à partir du 01/07/2099.'],
    array['controle', '37. un chef du cabinet qui n''est pas super-administrateur', 'chef_simple', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "achats", "debut": "2099-06-01", "fin": "2099-06-30", "role": "BY", "achats": [{"ficheId": "{F1}", "pieceId": "{P1}", "date": "2099-06-10"}], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'La période n''est pas finie : elle se déclare à partir du 01/07/2099.'],

    -- ══ 40 à 49. L'écriture directe, et ce que la garde et les contraintes tiennent sans la fonction ══════════
    array['controle', '40. le membre affecté n''écrit pas en direct : la fonction seule', 'membre', $q$insert into declarations_ereporting (dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, canal, plateforme, contenu, empreinte, nb_operations, etat) values ('{T}', 'achats', '2099-08-01', '2099-08-31', '{R1}', 'IN', 'manuel', 'Plateforme', '{"objet": "achats", "debut": "2099-03-01", "fin": "2099-03-31", "role": "BY", "nombreOperations": 1}'::jsonb, '8ddf2b86e5c36ce6fb38fb15d0dccabfe178683503dcf2707b28ecb1cda9a131', 1, 'declaree')$q$,
      '42501', 'new row violates row-level security policy for table "declarations_ereporting"'],
    array['controle', '41. ni le chef qui n''est pas super-administrateur', 'chef_simple', $q$insert into declarations_ereporting (dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, canal, plateforme, contenu, empreinte, nb_operations, etat) values ('{T}', 'achats', '2099-08-01', '2099-08-31', '{R1}', 'IN', 'manuel', 'Plateforme', '{"objet": "achats", "debut": "2099-03-01", "fin": "2099-03-31", "role": "BY", "nombreOperations": 1}'::jsonb, '8ddf2b86e5c36ce6fb38fb15d0dccabfe178683503dcf2707b28ecb1cda9a131', 1, 'declaree')$q$,
      '42501', 'new row violates row-level security policy for table "declarations_ereporting"'],
    array['controle', '42. ni le client, dans son dossier : la garde ne voit pas son régime, et n''en dit rien de plus', 'client', $q$insert into declarations_ereporting (dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, canal, plateforme, contenu, empreinte, nb_operations, etat) values ('{DC}', 'achats', '2099-08-01', '2099-08-31', '{RDC}', 'IN', 'manuel', 'Plateforme', '{"objet": "achats", "debut": "2099-03-01", "fin": "2099-03-31", "role": "BY", "nombreOperations": 1}'::jsonb, '8ddf2b86e5c36ce6fb38fb15d0dccabfe178683503dcf2707b28ecb1cda9a131', 1, 'declaree')$q$,
      '23514', 'Une déclaration se fait sous un régime de son dossier.'],
    array['controle', '43. le super-administrateur insère en direct pour restaurer, un contenu que la base empreinte comme le module', 'chef', $q$insert into declarations_ereporting (id, dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, canal, plateforme, contenu, empreinte, nb_operations, etat, cree_le) values ('{DN}', '{T}', 'achats', '2099-08-01', '2099-08-31', '{R1}', 'IN', 'manuel', 'Plateforme N', '{"objet": "achats", "debut": "2099-08-01", "fin": "2099-08-31", "role": "BY", "nombreOperations": 1, "z": "a\"b\\c\u0001d\te", "é": "€ — 😀", "aa": [1.5, 0.1, -3, 1e-7], "b": {"kk": null, "k": true}, "ab": []}'::jsonb, '6b46a6a524abf2987ceb0335d394d40960ebaf09c86fdc4fa6262cc824958111', 1, 'declaree', '2026-04-08T10:00:00Z')$q$, 'OK', ''],
    array['controle', '44. une empreinte qui n''est pas celle du contenu', 'chef', $q$insert into declarations_ereporting (dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, canal, plateforme, contenu, empreinte, nb_operations, etat) values ('{T}', 'achats', '2099-08-01', '2099-08-31', '{R1}', 'IN', 'manuel', 'Plateforme', '{"objet": "achats", "debut": "2099-03-01", "fin": "2099-03-31", "role": "BY", "nombreOperations": 1}'::jsonb, '0000000000000000000000000000000000000000000000000000000000000000', 1, 'declaree')$q$,
      '23514', 'L''empreinte d''une déclaration est celle de son contenu, calculée par la base.'],
    array['controle', '44b. le régime d''un autre dossier', 'postgres', $q$insert into declarations_ereporting (dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, canal, plateforme, contenu, empreinte, nb_operations, etat) values ('{T}', 'achats', '2099-08-01', '2099-08-31', '{RDC}', 'IN', 'manuel', 'Plateforme', '{"objet": "achats", "debut": "2099-03-01", "fin": "2099-03-31", "role": "BY", "nombreOperations": 1}'::jsonb, '8ddf2b86e5c36ce6fb38fb15d0dccabfe178683503dcf2707b28ecb1cda9a131', 1, 'declaree')$q$,
      '23514', 'Une déclaration se fait sous un régime de son dossier.'],
    array['controle', '44c. une rectificative dont la déclaration remplacée est encore active', 'postgres', $q$insert into declarations_ereporting (dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, remplace_id, canal, plateforme, contenu, empreinte, nb_operations, etat) values ('{T}', 'achats', '2099-03-01', '2099-03-31', '{R1}', 'RE', '{DB}', 'manuel', 'Plateforme', '{"objet": "achats", "debut": "2099-03-01", "fin": "2099-03-31", "role": "BY", "nombreOperations": 1}'::jsonb, '8ddf2b86e5c36ce6fb38fb15d0dccabfe178683503dcf2707b28ecb1cda9a131', 1, 'remplacee')$q$,
      '23514', 'Une rectificative remplace la déclaration de la même période et du même objet, dans son dossier, passée « remplacée ».'],
    array['controle', '44d. une rectificative d''une autre période', 'postgres', $q$insert into declarations_ereporting (dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, remplace_id, canal, plateforme, contenu, empreinte, nb_operations, etat) values ('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', 'RE', '{DC1}', 'manuel', 'Plateforme', '{"objet": "achats", "debut": "2099-03-01", "fin": "2099-03-31", "role": "BY", "nombreOperations": 1}'::jsonb, '8ddf2b86e5c36ce6fb38fb15d0dccabfe178683503dcf2707b28ecb1cda9a131', 1, 'declaree')$q$,
      '23514', 'Une rectificative remplace la déclaration de la même période et du même objet, dans son dossier, passée « remplacée ».'],
    array['controle', '44e. une active qui en chevauche une autre', 'postgres', $q$insert into declarations_ereporting (dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, canal, plateforme, contenu, empreinte, nb_operations, etat) values ('{T}', 'achats', '2099-03-15', '2099-04-30', '{R1}', 'IN', 'manuel', 'Plateforme', '{"objet": "achats", "debut": "2099-03-01", "fin": "2099-03-31", "role": "BY", "nombreOperations": 1}'::jsonb, '8ddf2b86e5c36ce6fb38fb15d0dccabfe178683503dcf2707b28ecb1cda9a131', 1, 'declaree')$q$,
      '23514', 'Une déclaration active ne chevauche pas une autre déclaration active du même objet : une même opération ne se déclare pas deux fois.'],
    array['controle', '44f. une remplacée peut chevaucher : seules les actives se comptent', 'postgres', $q$insert into declarations_ereporting (dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, canal, plateforme, contenu, empreinte, nb_operations, etat) values ('{T}', 'achats', '2099-03-15', '2099-04-30', '{R1}', 'IN', 'manuel', 'Plateforme', '{"objet": "achats", "debut": "2099-03-01", "fin": "2099-03-31", "role": "BY", "nombreOperations": 1}'::jsonb, '8ddf2b86e5c36ce6fb38fb15d0dccabfe178683503dcf2707b28ecb1cda9a131', 1, 'remplacee')$q$, 'OK', ''],
    array['controle', '44g. une active qui ne partage qu''un jour avec une autre la chevauche aussi', 'postgres', $q$insert into declarations_ereporting (dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, canal, plateforme, contenu, empreinte, nb_operations, etat) values ('{T}', 'achats', '2099-03-31', '2099-04-30', '{R1}', 'IN', 'manuel', 'Plateforme', '{"objet": "achats", "debut": "2099-03-01", "fin": "2099-03-31", "role": "BY", "nombreOperations": 1}'::jsonb, '8ddf2b86e5c36ce6fb38fb15d0dccabfe178683503dcf2707b28ecb1cda9a131', 1, 'declaree')$q$,
      '23514', 'Une déclaration active ne chevauche pas une autre déclaration active du même objet : une même opération ne se déclare pas deux fois.'],
    array['controle', '45. une seule active par dossier, objet et période, sans la fonction', 'postgres', $q$insert into declarations_ereporting (dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, canal, plateforme, contenu, empreinte, nb_operations, etat) values ('{T}', 'achats', '2099-03-01', '2099-03-31', '{R1}', 'IN', 'manuel', 'Plateforme', '{"objet": "achats", "debut": "2099-03-01", "fin": "2099-03-31", "role": "BY", "nombreOperations": 1}'::jsonb, '8ddf2b86e5c36ce6fb38fb15d0dccabfe178683503dcf2707b28ecb1cda9a131', 1, 'declaree')$q$,
      '23505', '%"declarations_ereporting_une_active"'],
    array['controle', '45b. une seule suite par déclaration', 'postgres', $q$insert into declarations_ereporting (dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, remplace_id, canal, plateforme, contenu, empreinte, nb_operations, etat) values ('{T}', 'achats', '2099-05-01', '2099-05-31', '{R1}', 'RE', '{DC1}', 'manuel', 'Plateforme', '{"objet": "achats", "debut": "2099-03-01", "fin": "2099-03-31", "role": "BY", "nombreOperations": 1}'::jsonb, '8ddf2b86e5c36ce6fb38fb15d0dccabfe178683503dcf2707b28ecb1cda9a131', 1, 'remplacee')$q$,
      '23505', '%"declarations_ereporting_une_suite"'],
    array['controle', '46. un objet inconnu, sans la fonction', 'postgres', $q$insert into declarations_ereporting (dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, canal, plateforme, contenu, empreinte, nb_operations, etat) values ('{T}', 'tout', '2099-08-01', '2099-08-31', '{R1}', 'IN', 'manuel', 'Plateforme', '{"objet": "achats", "debut": "2099-03-01", "fin": "2099-03-31", "role": "BY", "nombreOperations": 1}'::jsonb, '8ddf2b86e5c36ce6fb38fb15d0dccabfe178683503dcf2707b28ecb1cda9a131', 1, 'declaree')$q$,
      '23514', '%"declarations_ereporting_objet"'],
    array['controle', '46b. une rectificative sans la déclaration qu''elle remplace', 'postgres', $q$insert into declarations_ereporting (dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, canal, plateforme, contenu, empreinte, nb_operations, etat) values ('{T}', 'achats', '2099-08-01', '2099-08-31', '{R1}', 'RE', 'manuel', 'Plateforme', '{"objet": "achats", "debut": "2099-03-01", "fin": "2099-03-31", "role": "BY", "nombreOperations": 1}'::jsonb, '8ddf2b86e5c36ce6fb38fb15d0dccabfe178683503dcf2707b28ecb1cda9a131', 1, 'declaree')$q$,
      '23514', '%"declarations_ereporting_rectificative"'],
    array['controle', '46c. une initiale qui en remplace une', 'postgres', $q$insert into declarations_ereporting (dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, remplace_id, canal, plateforme, contenu, empreinte, nb_operations, etat) values ('{T}', 'achats', '2099-05-01', '2099-05-31', '{R1}', 'IN', '{DC1}', 'manuel', 'Plateforme', '{"objet": "achats", "debut": "2099-03-01", "fin": "2099-03-31", "role": "BY", "nombreOperations": 1}'::jsonb, '8ddf2b86e5c36ce6fb38fb15d0dccabfe178683503dcf2707b28ecb1cda9a131', 1, 'remplacee')$q$,
      '23514', '%"declarations_ereporting_rectificative"'],
    array['controle', '46d. un autre canal que la saisie manuelle', 'postgres', $q$insert into declarations_ereporting (dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, canal, plateforme, contenu, empreinte, nb_operations, etat) values ('{T}', 'achats', '2099-08-01', '2099-08-31', '{R1}', 'IN', 'plateforme', 'Plateforme', '{"objet": "achats", "debut": "2099-03-01", "fin": "2099-03-31", "role": "BY", "nombreOperations": 1}'::jsonb, '8ddf2b86e5c36ce6fb38fb15d0dccabfe178683503dcf2707b28ecb1cda9a131', 1, 'declaree')$q$,
      '23514', '%"declarations_ereporting_canal"'],
    array['controle', '46e. une plateforme faite d''espaces', 'postgres', $q$insert into declarations_ereporting (dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, canal, plateforme, contenu, empreinte, nb_operations, etat) values ('{T}', 'achats', '2099-08-01', '2099-08-31', '{R1}', 'IN', 'manuel', '   ', '{"objet": "achats", "debut": "2099-03-01", "fin": "2099-03-31", "role": "BY", "nombreOperations": 1}'::jsonb, '8ddf2b86e5c36ce6fb38fb15d0dccabfe178683503dcf2707b28ecb1cda9a131', 1, 'declaree')$q$,
      '23514', '%"declarations_ereporting_plateforme"'],
    array['controle', '46f. un contenu qui n''est pas un objet', 'postgres', $q$insert into declarations_ereporting (dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, canal, plateforme, contenu, empreinte, nb_operations, etat) values ('{T}', 'achats', '2099-08-01', '2099-08-31', '{R1}', 'IN', 'manuel', 'Plateforme', '[]'::jsonb, '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945', 1, 'declaree')$q$,
      '23514', '%"declarations_ereporting_contenu"'],
    array['controle', '46g. aucune opération, sans la fonction', 'postgres', $q$insert into declarations_ereporting (dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, canal, plateforme, contenu, empreinte, nb_operations, etat) values ('{T}', 'achats', '2099-08-01', '2099-08-31', '{R1}', 'IN', 'manuel', 'Plateforme', '{"objet": "achats", "debut": "2099-03-01", "fin": "2099-03-31", "role": "BY", "nombreOperations": 1}'::jsonb, '8ddf2b86e5c36ce6fb38fb15d0dccabfe178683503dcf2707b28ecb1cda9a131', 0, 'declaree')$q$,
      '23514', '%"declarations_ereporting_nb_operations"'],
    array['controle', '46h. un état inconnu', 'postgres', $q$insert into declarations_ereporting (dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, canal, plateforme, contenu, empreinte, nb_operations, etat) values ('{T}', 'achats', '2099-08-01', '2099-08-31', '{R1}', 'IN', 'manuel', 'Plateforme', '{"objet": "achats", "debut": "2099-03-01", "fin": "2099-03-31", "role": "BY", "nombreOperations": 1}'::jsonb, '8ddf2b86e5c36ce6fb38fb15d0dccabfe178683503dcf2707b28ecb1cda9a131', 1, 'envoi')$q$,
      '23514', '%"declarations_ereporting_etat"'],
    array['controle', '46i. une fin avant le début', 'postgres', $q$insert into declarations_ereporting (dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, canal, plateforme, contenu, empreinte, nb_operations, etat) values ('{T}', 'achats', '2099-08-31', '2099-08-01', '{R1}', 'IN', 'manuel', 'Plateforme', '{"objet": "achats", "debut": "2099-03-01", "fin": "2099-03-31", "role": "BY", "nombreOperations": 1}'::jsonb, '8ddf2b86e5c36ce6fb38fb15d0dccabfe178683503dcf2707b28ecb1cda9a131', 1, 'declaree')$q$,
      '23514', '%"declarations_ereporting_periode"'],
    array['controle', '46j. une note faite d''espaces', 'postgres', $q$insert into declarations_ereporting (dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, canal, plateforme, contenu, empreinte, nb_operations, etat, note) values ('{T}', 'achats', '2099-08-01', '2099-08-31', '{R1}', 'IN', 'manuel', 'Plateforme', '{"objet": "achats", "debut": "2099-03-01", "fin": "2099-03-31", "role": "BY", "nombreOperations": 1}'::jsonb, '8ddf2b86e5c36ce6fb38fb15d0dccabfe178683503dcf2707b28ecb1cda9a131', 1, 'declaree', '  ')$q$,
      '23514', '%"declarations_ereporting_note"'],
    array['controle', '46k. une note de plus de 2 000 caractères, sans la fonction', 'postgres', $q$insert into declarations_ereporting (dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, canal, plateforme, contenu, empreinte, nb_operations, etat, note) values ('{T}', 'achats', '2099-08-01', '2099-08-31', '{R1}', 'IN', 'manuel', 'Plateforme', '{"objet": "achats", "debut": "2099-03-01", "fin": "2099-03-31", "role": "BY", "nombreOperations": 1}'::jsonb, '8ddf2b86e5c36ce6fb38fb15d0dccabfe178683503dcf2707b28ecb1cda9a131', 1, 'declaree', repeat('n', 2001))$q$,
      '23514', '%"declarations_ereporting_note"'],
    array['controle', '46l. une plateforme de plus de 200 caractères, sans la fonction', 'postgres', $q$insert into declarations_ereporting (dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, canal, plateforme, contenu, empreinte, nb_operations, etat) values ('{T}', 'achats', '2099-08-01', '2099-08-31', '{R1}', 'IN', 'manuel', repeat('p', 201), '{"objet": "achats", "debut": "2099-03-01", "fin": "2099-03-31", "role": "BY", "nombreOperations": 1}'::jsonb, '8ddf2b86e5c36ce6fb38fb15d0dccabfe178683503dcf2707b28ecb1cda9a131', 1, 'declaree')$q$,
      '23514', '%"declarations_ereporting_plateforme"'],
    array['controle', '46m. un contenu de plus d''un mégaoctet, sans la fonction', 'postgres', $q$insert into declarations_ereporting (dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, canal, plateforme, contenu, empreinte, nb_operations, etat) select '{T}', 'achats', '2099-08-01', '2099-08-31', '{R1}', 'IN', 'manuel', 'Plateforme', c, encode(sha256(convert_to(c::text, 'UTF8')), 'hex'), 1, 'declaree' from (select jsonb_build_object('bourre', repeat('b', 1048576)) as c) x$q$,
      '23514', '%"declarations_ereporting_contenu"'],
    array['controle', '46n. une transmission ni initiale ni rectificative', 'postgres', $q$insert into declarations_ereporting (dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, canal, plateforme, contenu, empreinte, nb_operations, etat) values ('{T}', 'achats', '2099-08-01', '2099-08-31', '{R1}', 'MO', 'manuel', 'Plateforme', '{"objet": "achats", "debut": "2099-03-01", "fin": "2099-03-31", "role": "BY", "nombreOperations": 1}'::jsonb, '8ddf2b86e5c36ce6fb38fb15d0dccabfe178683503dcf2707b28ecb1cda9a131', 1, 'declaree')$q$,
      '23514', '%"declarations_ereporting_type_transmission"'],
    array['controle', '46o. une période d''avant 2000', 'postgres', $q$insert into declarations_ereporting (dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, canal, plateforme, contenu, empreinte, nb_operations, etat) values ('{T}', 'achats', '1999-12-01', '1999-12-31', '{R1}', 'IN', 'manuel', 'Plateforme', '{"objet": "achats", "debut": "2099-03-01", "fin": "2099-03-31", "role": "BY", "nombreOperations": 1}'::jsonb, '8ddf2b86e5c36ce6fb38fb15d0dccabfe178683503dcf2707b28ecb1cda9a131', 1, 'declaree')$q$,
      '23514', '%"declarations_ereporting_periode_debut"'],
    array['controle', '47. une déclaration ne se modifie pas, même par le propriétaire', 'postgres', $q$update declarations_ereporting set plateforme = 'Autre' where id = '{DB}'$q$,
      '23514', 'Une déclaration d''e-reporting ne se modifie pas : une rectificative la remplace, et elle passe « remplacée », une fois.'],
    array['controle', '47b. ni son contenu', 'postgres', $q$update declarations_ereporting set contenu = contenu || '{"x": 1}'::jsonb where id = '{DB}'$q$,
      '23514', 'Une déclaration d''e-reporting ne se modifie pas : une rectificative la remplace, et elle passe « remplacée », une fois.'],
    array['controle', '47c. une remplacée ne redevient pas active', 'postgres', $q$update declarations_ereporting set etat = 'declaree' where id = '{DC1}'$q$,
      '23514', 'Une déclaration d''e-reporting ne se modifie pas : une rectificative la remplace, et elle passe « remplacée », une fois.'],
    array['controle', '47d. un passage à « remplacée » qui change autre chose', 'postgres', $q$update declarations_ereporting set etat = 'remplacee', note = 'Remplacée.' where id = '{DB}'$q$,
      '23514', 'Une déclaration d''e-reporting ne se modifie pas : une rectificative la remplace, et elle passe « remplacée », une fois.'],
    array['controle', '47e. le passage à « remplacée », seul, passe', 'postgres', $q$update declarations_ereporting set etat = 'remplacee' where id = '{DB}'$q$, 'OK', ''],
    array['controle', '47f. une seule fois : une remplacée ne se « remplace » pas de nouveau', 'postgres', $q$update declarations_ereporting set etat = 'remplacee' where id = '{DC1}'$q$,
      '23514', 'Une déclaration d''e-reporting ne se modifie pas : une rectificative la remplace, et elle passe « remplacée », une fois.'],
    array['controle', '47g. une active ne se réécrit pas, même à l''identique', 'postgres', $q$update declarations_ereporting set etat = 'declaree' where id = '{DB}'$q$,
      '23514', 'Une déclaration d''e-reporting ne se modifie pas : une rectificative la remplace, et elle passe « remplacée », une fois.'],
    array['controle', '48. le membre affecté n''écrit pas de source en direct', 'membre', $q$insert into declarations_ereporting_sources (declaration_id, dossier_id, genre, source_id) values ('{DB}', '{T}', 'fiche', '{F1}')$q$,
      '42501', 'new row violates row-level security policy for table "declarations_ereporting_sources"'],
    array['controle', '48b. le super-administrateur, pour restaurer, si', 'chef', $q$insert into declarations_ereporting_sources (declaration_id, dossier_id, genre, source_id) values ('{DB}', '{T}', 'fiche', '{F1}')$q$, 'OK', ''],
    array['controle', '48c. une source d''une déclaration d''un autre dossier', 'postgres', $q$insert into declarations_ereporting_sources (declaration_id, dossier_id, genre, source_id) values ('{DE}', '{T}', 'fiche', '{F1}')$q$,
      '23514', 'Une source appartient à une déclaration de son dossier, et en a le genre : une fiche pour les achats, une facture pour les ventes, un encaissement pour les paiements.'],
    array['controle', '48d. une facture comme source d''une déclaration des achats', 'postgres', $q$insert into declarations_ereporting_sources (declaration_id, dossier_id, genre, source_id) values ('{DB}', '{T}', 'facture', '{FV}')$q$,
      '23514', 'Une source appartient à une déclaration de son dossier, et en a le genre : une fiche pour les achats, une facture pour les ventes, un encaissement pour les paiements.'],
    array['controle', '48e. un genre inconnu, sans la fonction', 'postgres', $q$insert into declarations_ereporting_sources (declaration_id, dossier_id, genre, source_id) values ('{DP}', '{T}', 'piece', '{P1}')$q$,
      '23514', '%"declarations_ereporting_sources_genre"'],
    array['controle', '49. une source ne se modifie pas', 'postgres', $q$update declarations_ereporting_sources set source_id = '{F1}' where declaration_id = '{DB}'$q$,
      '23514', 'Les sources d''une déclaration d''e-reporting ne se modifient pas.'],

    -- ══ 60 à 65. Qui lit ══════════
    array['lecture', '61. le client ne lit ni déclaration ni source, pas même celles de son dossier', 'client', $q$select (select count(*) from declarations_ereporting) || ':' || (select count(*) from declarations_ereporting_sources)$q$, '', '0:0'],
    array['lecture', '62. le compte rattaché à rien non plus', 'inconnu', $q$select (select count(*) from declarations_ereporting) || ':' || (select count(*) from declarations_ereporting_sources)$q$, '', '0:0'],
    array['lecture', '63. l''anonyme non plus', 'anon', $q$select (select count(*) from declarations_ereporting) || ':' || (select count(*) from declarations_ereporting_sources)$q$, '', '0:0'],
    array['lecture', '64. le membre affecté à T en lit les déclarations et les sources, et elles seules', 'membre', $q$select (select count(*) from declarations_ereporting where dossier_id = '{T}') || ':' || (select count(*) from declarations_ereporting where dossier_id <> '{T}') || ':' || (select count(*) from declarations_ereporting_sources where dossier_id = '{T}') || ':' || (select count(*) from declarations_ereporting_sources where dossier_id <> '{T}')$q$, '', '5:0:2:0'],
    array['lecture', '65. le membre affecté à un autre dossier n''en lit aucune de T', 'membre_ailleurs', $q$select (select count(*) from declarations_ereporting where dossier_id = '{T}') || ':' || (select count(*) from declarations_ereporting_sources where dossier_id = '{T}')$q$, '', '0:0'],

    -- ══ 70 à 74. Les mutations : chacune doit MORDRE ══════════
    array['lecture', '70. MUTATION — le contrôle 61 sans le changement de rôle : il doit voir celles du dossier du client', 'postgres', $q$select ((select count(*) from declarations_ereporting where dossier_id = '{DC}') > 0)::text$q$, '', 'true'],
    array['controle', '71. MUTATION — le contrôle 4 joué sous le chef : il doit passer l''accès', 'chef', $q$select declarer_ereporting_hors_application('{DC}', 'achats', '2099-06-01', '2099-06-30', '{RDC}', null, 'Plateforme', null, null)$q$,
      '22023', 'Le contenu déclaré est à joindre : celui que l''application a calculé pour la période.'],
    array['controle', '72. MUTATION — le contrôle 5 affecté au BON dossier : il doit passer l''accès', 'membre', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2099-06-01', '2099-06-30', '{R1}', null, 'Plateforme', null, null)$q$,
      '22023', 'Le contenu déclaré est à joindre : celui que l''application a calculé pour la période.'],
    array['controle', '73. MUTATION — le contrôle 40 joué sous le chef (super-administrateur) : l''insertion doit passer', 'chef', $q$insert into declarations_ereporting (dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, canal, plateforme, contenu, empreinte, nb_operations, etat) values ('{T}', 'achats', '2099-08-01', '2099-08-31', '{R1}', 'IN', 'manuel', 'Plateforme', '{"objet": "achats", "debut": "2099-03-01", "fin": "2099-03-31", "role": "BY", "nombreOperations": 1}'::jsonb, '8ddf2b86e5c36ce6fb38fb15d0dccabfe178683503dcf2707b28ecb1cda9a131', 1, 'declaree')$q$, 'OK', ''],
    array['lecture', '74. MUTATION — le contrôle 65 affecté au BON dossier : il doit voir celles de T', 'membre', $q$select ((select count(*) from declarations_ereporting where dossier_id = '{T}') > 0)::text || ':' || ((select count(*) from declarations_ereporting_sources where dossier_id = '{T}') > 0)::text$q$, '', 'true:true'],

    -- ══ 80 à 88. Ce que le catalogue dit ══════════
    array['valeur', '80. les droits d''exécution (anonyme, connecté)', 'postgres', $q$select string_agg(f || ':' || has_function_privilege('anon', 'public.' || f || a, 'execute') || ':' || has_function_privilege('authenticated', 'public.' || f || a, 'execute'), ',' order by f collate "C") from (values
      ('declarer_ereporting_hors_application', '(uuid, text, date, date, uuid, uuid, text, jsonb, text)'), ('periode_ereporting', '(date, text)'),
      ('garder_declaration_ereporting', '()'), ('garder_source_declaree', '()'), ('garder_piece_declaree', '()')) as t(f, a)$q$, '',
      'declarer_ereporting_hors_application:false:true,garder_declaration_ereporting:false:false,garder_piece_declaree:false:false,garder_source_declaree:false:false,periode_ereporting:false:false'],
    array['valeur', '81. ce qui contourne la RLS, et ce qui ne la contourne pas', 'postgres', $q$select string_agg(proname || ':' || prosecdef || ':' || provolatile::text, ',' order by proname collate "C") from pg_proc where pronamespace = 'public'::regnamespace and proname in ('declarer_ereporting_hors_application', 'periode_ereporting', 'garder_declaration_ereporting', 'garder_source_declaree', 'garder_piece_declaree')$q$, '',
      'declarer_ereporting_hors_application:true:v,garder_declaration_ereporting:false:v,garder_piece_declaree:true:v,garder_source_declaree:false:v,periode_ereporting:false:i'],
    array['valeur', '82. quatre policies : la lecture sous admin_du_dossier, l''insertion du super-administrateur, aux connectés, aucune branche client', 'postgres', $q$select string_agg(tablename || ':' || policyname || ':' || cmd || ':' || array_to_string(roles, ',') || ':' || coalesce(qual, '-') || ':' || coalesce(with_check, '-'), ',' order by policyname collate "C") from pg_policies where schemaname = 'public' and tablename in ('declarations_ereporting', 'declarations_ereporting_sources')$q$, '',
      'declarations_ereporting:declarations_ereporting_lecture:SELECT:authenticated:admin_du_dossier(dossier_id):-,declarations_ereporting:declarations_ereporting_restauration:INSERT:authenticated:-:is_super_admin(),declarations_ereporting_sources:declarations_ereporting_sources_lecture:SELECT:authenticated:admin_du_dossier(dossier_id):-,declarations_ereporting_sources:declarations_ereporting_sources_restauration:INSERT:authenticated:-:is_super_admin()'],
    array['valeur', '83. la RLS est active sur les deux tables', 'postgres', $q$select string_agg(relname || ':' || relrowsecurity, ',' order by relname collate "C") from pg_class where oid in ('public.declarations_ereporting'::regclass, 'public.declarations_ereporting_sources'::regclass)$q$, '',
      'declarations_ereporting:true,declarations_ereporting_sources:true'],
    array['valeur', '84. les trois déclencheurs, actifs, qui veillent aussi sur la suppression (jouée sur la réplique)', 'postgres', $q$select string_agg(pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text, ' | ' order by t.tgname collate "C") from pg_trigger t where t.tgname in ('declarations_ereporting_gardes', 'declarations_ereporting_sources_gardes', 'pieces_declarees_ereporting') and not t.tgisinternal$q$, '',
      'CREATE TRIGGER declarations_ereporting_gardes BEFORE INSERT OR DELETE OR UPDATE ON public.declarations_ereporting FOR EACH ROW EXECUTE FUNCTION garder_declaration_ereporting() O'
      || ' | CREATE TRIGGER declarations_ereporting_sources_gardes BEFORE INSERT OR DELETE OR UPDATE ON public.declarations_ereporting_sources FOR EACH ROW EXECUTE FUNCTION garder_source_declaree() O'
      || ' | CREATE TRIGGER pieces_declarees_ereporting BEFORE DELETE ON public.pieces FOR EACH ROW EXECUTE FUNCTION garder_piece_declaree() O'],
    array['valeur', '85. les clés : la déclaration part avec son dossier, garde son régime et la déclaration qu''elle remplace ; la source part avec sa déclaration et son dossier', 'postgres', $q$select string_agg(c.conrelid::regclass::text || '.' || a.attname || '>' || c.confrelid::regclass::text || ':' || c.confdeltype::text, ',' order by c.conrelid::regclass::text collate "C", a.attname collate "C") from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1] where c.contype = 'f' and c.conrelid in ('public.declarations_ereporting'::regclass, 'public.declarations_ereporting_sources'::regclass)$q$, '',
      'declarations_ereporting.dossier_id>dossiers:c,declarations_ereporting.regime_id>regimes_ereporting:a,declarations_ereporting.remplace_id>declarations_ereporting:a,declarations_ereporting_sources.declaration_id>declarations_ereporting:c,declarations_ereporting_sources.dossier_id>dossiers:c'],
    array['valeur', '86. les fonctions qui nomment les deux tables : celles de la migration, et elles seules', 'postgres', $q$select string_agg(proname, ',' order by proname collate "C") from pg_proc where pronamespace = 'public'::regnamespace and prosrc ~ '(declarations_ereporting)'$q$, '',
      'declarer_ereporting_hors_application,garder_declaration_ereporting,garder_piece_declaree,garder_source_declaree'],
    array['valeur', '87. la période d''e1 en SQL : sa grille, chaque jour de 2026 à 2030 sous les trois fréquences (relevée par le test du module)', 'postgres', $q$select md5(string_agg(f || ':' || j::date || ':' || p.debut || ':' || p.fin, ',' order by f, j)) from generate_series(date '2026-01-01', date '2030-12-31', interval '1 day') j, unnest(array['decade', 'mois', 'bimestre']) f, lateral periode_ereporting(j::date, f) p$q$, '',
      '68c73f879aa7c8389ebd8b6bc27facb8'],
    array['valeur', '87b. ses bords : la deuxième décade de février, la fin d''un bimestre bissextile, une fréquence inconnue', 'postgres', $q$select (select debut || '/' || fin from periode_ereporting('2028-02-15', 'decade')) || ',' || (select debut || '/' || fin from periode_ereporting('2028-02-29', 'decade')) || ',' || (select debut || '/' || fin from periode_ereporting('2028-02-10', 'bimestre')) || ',' || (select debut || '/' || fin from periode_ereporting('2027-12-31', 'bimestre')) || ',' || (select coalesce(debut::text, '-') || '/' || coalesce(fin::text, '-') from periode_ereporting('2027-09-10', 'annee'))$q$, '',
      '2028-02-11/2028-02-20,2028-02-21/2028-02-29,2028-01-01/2028-02-29,2027-11-01/2027-12-31,-/-'],
    array['valeur', '88. une seule active : l''index partiel, sur l''état', 'postgres', $q$select pg_get_indexdef('public.declarations_ereporting_une_active'::regclass)$q$, '',
      'CREATE UNIQUE INDEX declarations_ereporting_une_active ON public.declarations_ereporting USING btree (dossier_id, objet, periode_debut, periode_fin) WHERE (etat = ''declaree''::text)'],

    -- ══ 89. Deux déclarations actives qui portent la même source — la restauration seule le peut — : la plus ancienne se dit ══════════
    array['fait', '0. le jeu : les paiements d''avril 2099, qui portent aussi l''encaissement de février (par la porte de la restauration)', 'chef', $q$insert into declarations_ereporting (id, dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, remplace_id, canal, plateforme, contenu, empreinte, nb_operations, etat, note, cree_le) values
      ('{DP2}', '{T}', 'paiements', '2099-04-01', '2099-04-30', '{R1}', 'IN', null, 'manuel', 'Plateforme P', '{"objet": "paiements", "debut": "2099-04-01", "fin": "2099-04-30", "role": "SE", "nombreOperations": 1}'::jsonb, 'e51866122744f43a7063ff923bbfd1e6da971ad9d956b5337082ab37db04f762', 1, 'declaree', null, '2026-04-08T10:00:00Z')$q$, 'OK', ''],
    array['fait', '0. le jeu : sa source', 'chef', $q$insert into declarations_ereporting_sources (declaration_id, dossier_id, genre, source_id) values ('{DP2}', '{T}', 'encaissement', '{E1}')$q$, 'OK', ''],
    array['controle', '89. un encaissement que deux déclarations actives portent : la plus ancienne se dit', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'paiements', '2099-07-01', '2099-07-31', '{R1}', null, 'Plateforme', '{"version": 1, "objet": "paiements", "debut": "2099-07-01", "fin": "2099-07-31", "role": "SE", "paiements": [{"date": "2099-07-10", "encaissements": ["{E1}"]}], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'Une opération du contenu est déjà déclarée, dans la période du 01/02/2099 au 28/02/2099 : la période qui la porte se rectifie d''abord.']
  ];

  -- La partie B : des déclarations acceptées. Septembre et octobre 2027 ne se déclarent qu'une fois finis : à partir du
  -- 01/11/2027 en production, et sur une réplique à l'horloge avancée d'ici là (voir l'en-tête).
  etapes_apres := array[
    array['jeu', 'pièces de septembre 2027', 'postgres', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, date_piece, montant_ht, montant_tva, montant_ttc, devise) values
      ('{PB1}', '{T}', '{T}/essai-e5b-pb1.pdf', 'essai-e5b-pb1.pdf', 'achat', '2027-09-10', 100, null, 100, 'EUR'),
      ('{PB2}', '{T}', '{T}/essai-e5b-pb2.pdf', 'essai-e5b-pb2.pdf', 'achat', '2027-09-12', 50, null, 50, 'EUR'),
      ('{PB3}', '{T}', '{T}/essai-e5b-pb3.pdf', 'essai-e5b-pb3.pdf', 'achat', '2027-09-14', 30, null, 30, 'EUR')$q$, '', ''],
    array['fait', '100. le jeu : leurs fiches', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{PB1}', null, 'INV-B1', '2027-09-10', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":100,"tva":0}]'::jsonb), enregistrer_fiche_hors_de_france('{T}', '{PB2}', null, 'INV-B2', '2027-09-12', '380', null, null, 'IE', '0223', 'IE7777777T', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":50,"tva":0}]'::jsonb)$q$, 'OK', ''],
    array['retenir', 'FB1', 'postgres', $q$select id::text from pieces_hors_de_france where piece_id = '{PB1}'$q$, '', ''],
    array['retenir', 'FB2', 'postgres', $q$select id::text from pieces_hors_de_france where piece_id = '{PB2}'$q$, '', ''],
    array['fait', '100a. le jeu : la fiche d''une troisième pièce', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{PB3}', null, 'INV-B3', '2027-09-14', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":30,"tva":0}]'::jsonb)$q$, 'OK', ''],
    array['retenir', 'FB3', 'postgres', $q$select id::text from pieces_hors_de_france where piece_id = '{PB3}'$q$, '', ''],
    -- Le mois du jour et celui qui le précède, lus à Paris : la frontière de « la période finie » se juge à toute date.
    array['retenir', 'MD', 'postgres', $q$select to_char(to_char((now() at time zone 'Europe/Paris')::date, 'YYYY-MM-01')::date, 'YYYY-MM-DD')$q$, '', ''],
    array['retenir', 'MF', 'postgres', $q$select to_char((to_char((now() at time zone 'Europe/Paris')::date, 'YYYY-MM-01')::date + interval '1 month')::date - 1, 'YYYY-MM-DD')$q$, '', ''],
    array['retenir', 'PD', 'postgres', $q$select to_char(to_char((now() at time zone 'Europe/Paris')::date, 'YYYY-MM-01')::date - interval '1 month', 'YYYY-MM-DD')$q$, '', ''],
    array['retenir', 'PF', 'postgres', $q$select to_char(to_char((now() at time zone 'Europe/Paris')::date, 'YYYY-MM-01')::date - 1, 'YYYY-MM-DD')$q$, '', ''],
    array['fait', '100b. le jeu : une vente à un particulier de septembre 2027', 'chef', $q$select enregistrer_facture('{T}', null, '{"tiers_nom": "Essai", "type_client": "non_assujetti", "nature_operation": "services", "date_emission": "2027-09-15", "montant_ht": 100, "montant_tva": 20, "montant_ttc": 120}'::jsonb, '[{"designation": "a", "quantite": 1, "prix_unitaire_ht": 100, "taux_tva": 20}]'::jsonb, true)$q$, 'OK', ''],
    array['retenir', 'FVB', 'postgres', $q$select id::text from factures_emises where dossier_id = '{T}' and date_emission = '2027-09-15'$q$, '', ''],
    array['fait', '100c. le jeu : ses deux encaissements', 'chef', $q$select enregistrer_encaissement('{T}', '{FVB}', '2027-09-20', 60, 'virement', null, '[{"taux": 20, "montant": 60}]'::jsonb), enregistrer_encaissement('{T}', '{FVB}', '2027-10-05', 60, 'virement', null, '[{"taux": 20, "montant": 60}]'::jsonb)$q$, 'OK', ''],
    array['retenir', 'EB', 'postgres', $q$select id::text from encaissements_factures where facture_id = '{FVB}' and date_encaissement = '2027-09-20'$q$, '', ''],
    array['retenir', 'EB2', 'postgres', $q$select id::text from encaissements_factures where facture_id = '{FVB}' and date_encaissement = '2027-10-05'$q$, '', ''],

    -- ══ 101 à 108. Les achats de septembre 2027 : l'initiale, puis la rectificative ══════════
    array['fait', '101. le chef déclare les achats de septembre 2027', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2027-09-01', '2027-09-30', '{R1}', null, 'Plateforme du dossier', '{"version": 1, "objet": "achats", "debut": "2027-09-01", "fin": "2027-09-30", "role": "BY", "siren": null, "numeroTva": null, "achats": [{"ficheId": "{FB1}", "pieceId": "{PB1}", "date": "2027-09-10", "numero": "INV-B1", "dateFacture": "2027-09-10", "typeDocument": "380", "origine": null, "devise": "EUR", "pays": "DE", "schema": "0223", "identifiant": "DE123456789", "nature": "services", "cadre": "S1", "autoliquidation": true, "dateOperation": null, "periodeDebut": null, "periodeFin": null, "lignes": [{"code": "AE", "taux": 0, "baseCentimes": 10000, "tvaCentimes": 0, "motifCode": null, "motifTexte": null}], "htCentimes": 10000, "tvaEurosCentimes": 0}], "nombreOperations": 1, "totauxParDevise": [{"devise": "EUR", "htCentimes": 10000}]}'::jsonb, 'Déclarée le jour même.')$q$, 'OK', ''],
    array['retenir', 'DI', 'postgres', $q$select id::text from declarations_ereporting where dossier_id = '{T}' and objet = 'achats' and periode_debut = '2027-09-01' and type_transmission = 'IN'$q$, '', ''],
    array['valeur', '102. la déclaration : initiale, active, saisie, sa plateforme, une opération, son régime, son auteur, sa note, l''empreinte de son contenu', 'postgres', $q$select type_transmission || ':' || etat || ':' || canal || ':' || plateforme || ':' || nb_operations || ':' || (regime_id = '{R1}')::text || ':' || (remplace_id is null)::text || ':' || (cree_par = '{CHEF}')::text || ':' || note || ':' || (empreinte = encode(sha256(convert_to(contenu::text, 'UTF8')), 'hex'))::text from declarations_ereporting where id = '{DI}'$q$, '',
      'IN:declaree:manuel:Plateforme du dossier:1:true:true:true:Déclarée le jour même.:true'],
    array['valeur', '103. sa source : la fiche de l''achat', 'postgres', $q$select string_agg(genre || ':' || (source_id = '{FB1}')::text || ':' || (dossier_id = '{T}')::text, ',') from declarations_ereporting_sources where declaration_id = '{DI}'$q$, '', 'fiche:true:true'],
    array['controle', '104. une seconde initiale de la même période', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2027-09-01', '2027-09-30', '{R1}', null, 'Plateforme du dossier', '{"version": 1, "objet": "achats", "debut": "2027-09-01", "fin": "2027-09-30", "role": "BY", "achats": [{"ficheId": "{FB1}", "pieceId": "{PB1}", "date": "2027-09-10"}], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'Une déclaration de cette période est déjà active, faite sur « Plateforme du dossier » : une correction se fait par une déclaration rectificative, qui la remplace entière.'],
    array['fait', '105. la rectificative remplace la période entière : deux achats', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2027-09-01', '2027-09-30', '{R1}', '{DI}', 'Plateforme du dossier', '{"version": 1, "objet": "achats", "debut": "2027-09-01", "fin": "2027-09-30", "role": "BY", "siren": null, "numeroTva": null, "achats": [{"ficheId": "{FB1}", "pieceId": "{PB1}", "date": "2027-09-10"}, {"ficheId": "{FB2}", "pieceId": "{PB2}", "date": "2027-09-12"}], "nombreOperations": 2, "totauxParDevise": []}'::jsonb, null)$q$, 'OK', ''],
    array['retenir', 'DR', 'postgres', $q$select id::text from declarations_ereporting where dossier_id = '{T}' and objet = 'achats' and periode_debut = '2027-09-01' and type_transmission = 'RE'$q$, '', ''],
    array['valeur', '106. l''initiale est remplacée, la rectificative active, ses deux sources', 'postgres', $q$select (select etat from declarations_ereporting where id = '{DI}') || ':' || (select type_transmission || ':' || etat || ':' || (remplace_id = '{DI}')::text || ':' || nb_operations from declarations_ereporting where id = '{DR}') || ':' || (select string_agg(genre, ',' order by genre) || ':' || count(*) filter (where source_id in ('{FB1}', '{FB2}')) from declarations_ereporting_sources where declaration_id = '{DR}')$q$, '',
      'remplacee:RE:declaree:true:2:fiche,fiche:2'],
    array['controle', '107. une rectificative de l''initiale, déjà remplacée', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2027-09-01', '2027-09-30', '{R1}', '{DI}', 'Plateforme du dossier', '{"version": 1, "objet": "achats", "debut": "2027-09-01", "fin": "2027-09-30", "role": "BY", "achats": [{"ficheId": "{FB1}", "pieceId": "{PB1}", "date": "2027-09-10"}], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'Cette déclaration est déjà remplacée : une rectificative remplace la déclaration active de la période.'],
    array['controle', '108. la même pièce dans octobre, la période de septembre active', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2027-10-01', '2027-10-31', '{R1}', null, 'Plateforme du dossier', '{"version": 1, "objet": "achats", "debut": "2027-10-01", "fin": "2027-10-31", "role": "BY", "achats": [{"ficheId": "{FB2}", "pieceId": "{PB2}", "date": "2027-10-05"}], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'Une opération du contenu est déjà déclarée, dans la période du 01/09/2027 au 30/09/2027 : la période qui la porte se rectifie d''abord.'],

    -- ══ 109 à 113. Les ventes et les paiements ══════════
    array['fait', '109. les ventes de septembre 2027', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'ventes', '2027-09-01', '2027-09-30', '{R1}', null, 'Plateforme du dossier', '{"version": 1, "objet": "ventes", "debut": "2027-09-01", "fin": "2027-09-30", "role": "SE", "siren": null, "transactions": [{"date": "2027-09-15", "devise": "EUR", "categorie": "TPS1", "optionDebits": false, "htCentimes": 10000, "tvaCentimes": 2000, "parTaux": [{"taux": 20, "baseCentimes": 10000, "tvaCentimes": 2000}], "factures": ["{FVB}"]}], "nombreOperations": 1, "htCentimes": 10000, "tvaCentimes": 2000}'::jsonb, null)$q$, 'OK', ''],
    array['fait', '110. et leurs paiements', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'paiements', '2027-09-01', '2027-09-30', '{R1}', null, 'Plateforme du dossier', '{"version": 1, "objet": "paiements", "debut": "2027-09-01", "fin": "2027-09-30", "role": "SE", "siren": null, "paiements": [{"date": "2027-09-20", "montantCentimes": 6000, "parTaux": [{"taux": 20, "montantCentimes": 6000}], "encaissements": ["{EB}"]}], "nombreOperations": 1, "montantCentimes": 6000}'::jsonb, null)$q$, 'OK', ''],
    array['valeur', '111. trois déclarations actives pour septembre 2027, une par objet, et leurs sources', 'postgres', $q$select string_agg(d.objet || ':' || d.type_transmission || ':' || (select count(*) from declarations_ereporting_sources s where s.declaration_id = d.id), ',' order by d.objet) from declarations_ereporting d where d.dossier_id = '{T}' and d.periode_debut = '2027-09-01' and d.etat = 'declaree'$q$, '',
      'achats:RE:2,paiements:IN:1,ventes:IN:1'],
    array['controle', '112. le membre affecté déclare les paiements d''octobre', 'membre', $q$select declarer_ereporting_hors_application('{T}', 'paiements', '2027-10-01', '2027-10-31', '{R1}', null, 'Plateforme du dossier', '{"version": 1, "objet": "paiements", "debut": "2027-10-01", "fin": "2027-10-31", "role": "SE", "paiements": [{"date": "2027-10-05", "encaissements": ["{EB2}"]}], "nombreOperations": 1}'::jsonb, null)$q$, 'OK', ''],
    array['controle', '113. un chef qui n''est pas super-administrateur aussi', 'chef_simple', $q$select declarer_ereporting_hors_application('{T}', 'paiements', '2027-10-01', '2027-10-31', '{R1}', null, 'Plateforme du dossier', '{"version": 1, "objet": "paiements", "debut": "2027-10-01", "fin": "2027-10-31", "role": "SE", "paiements": [{"date": "2027-10-05", "encaissements": ["{EB2}"]}], "nombreOperations": 1}'::jsonb, null)$q$, 'OK', ''],
    array['controle', '113b. un encaissement déjà déclaré en septembre ne se déclare pas en octobre', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'paiements', '2027-10-01', '2027-10-31', '{R1}', null, 'Plateforme du dossier', '{"version": 1, "objet": "paiements", "debut": "2027-10-01", "fin": "2027-10-31", "role": "SE", "paiements": [{"date": "2027-10-05", "encaissements": ["{EB2}", "{EB}"]}], "nombreOperations": 2}'::jsonb, null)$q$,
      '22023', 'Une opération du contenu est déjà déclarée, dans la période du 01/09/2027 au 30/09/2027 : la période qui la porte se rectifie d''abord.'],

    -- ══ 114 à 117. Le régime retiré sous une période déclarée (hypothèse E5-Q7) ══════════
    array['fait', '114. le régime de T se retire, ses déclarations le gardent', 'chef', $q$select retirer_regime_ereporting('{T}', '{R1}')$q$, 'OK', ''],
    array['valeur', '115. les déclarations de T désignent encore le régime retiré', 'postgres', $q$select count(*) filter (where d.regime_id = '{R1}') || ':' || count(*) || ':' || (select (retire_le is not null)::text from regimes_ereporting where id = '{R1}') from declarations_ereporting d where d.dossier_id = '{T}' and d.periode_debut = '2027-09-01'$q$, '', '4:4:true'],
    array['controle', '116. une rectificative ne se fait pas sous le régime retiré', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2027-09-01', '2027-09-30', '{R1}', '{DR}', 'Plateforme du dossier', '{"version": 1, "objet": "achats", "debut": "2027-09-01", "fin": "2027-09-30", "role": "BY", "achats": [{"ficheId": "{FB1}", "pieceId": "{PB1}", "date": "2027-09-10"}], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'Ce régime est retiré : une période se déclare sous le régime confirmé qui la couvre.'],
    array['fait', '117. le cabinet confirme de nouveau le régime de T', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-01-01', 'redevable', null, 'trimestrielle', false, 'mois', 'mois', null)$q$, 'OK', ''],
    array['retenir', 'R1B', 'postgres', $q$select id::text from regimes_ereporting where dossier_id = '{T}' and depuis = '2026-01-01' and retire_le is null$q$, '', ''],
    array['controle', '118. la rectificative se fait sous le régime confirmé de nouveau', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2027-09-01', '2027-09-30', '{R1B}', '{DR}', 'Plateforme du dossier', '{"version": 1, "objet": "achats", "debut": "2027-09-01", "fin": "2027-09-30", "role": "BY", "achats": [{"ficheId": "{FB1}", "pieceId": "{PB1}", "date": "2027-09-10"}], "nombreOperations": 1}'::jsonb, null)$q$, 'OK', ''],
    array['controle', '119. MUTATION — le contrôle 118 sous le client : l''accès doit tomber', 'client', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2027-09-01', '2027-09-30', '{R1B}', '{DR}', 'Plateforme du dossier', '{"version": 1, "objet": "achats", "debut": "2027-09-01", "fin": "2027-09-30", "role": "BY", "achats": [{"ficheId": "{FB1}", "pieceId": "{PB1}", "date": "2027-09-10"}], "nombreOperations": 1}'::jsonb, null)$q$,
      '42501', 'Accès refusé à ce dossier.'],

    -- ══ 120 à 127. La frontière de « la période finie », lue à Paris, et ce qu'une source déclarée retient ══════════
    array['controle', '120. le mois du jour ne se déclare pas : il n''est pas fini', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '{MD}', '{MF}', '{R1B}', null, 'Plateforme du dossier', '{"version": 1, "objet": "achats", "debut": "{MD}", "fin": "{MF}", "role": "BY", "achats": [{"ficheId": "{FB3}", "pieceId": "{PB3}", "date": "{MD}"}], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'La période n''est pas finie : elle se déclare à partir du %.'],
    array['controle', '121. le mois qui précède le jour, lu à Paris, se déclare ; une note faite d''espaces n''est pas une note', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '{PD}', '{PF}', '{R1B}', null, 'Plateforme du dossier', '{"version": 1, "objet": "achats", "debut": "{PD}", "fin": "{PF}", "role": "BY", "achats": [{"ficheId": "{FB3}", "pieceId": "{PB3}", "date": "{PF}"}], "nombreOperations": 1}'::jsonb, '   ')$q$, 'OK', ''],
    array['fait', '122. une rectificative de septembre qui ne cite plus que le premier achat', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2027-09-01', '2027-09-30', '{R1B}', '{DR}', 'Plateforme du dossier', '{"version": 1, "objet": "achats", "debut": "2027-09-01", "fin": "2027-09-30", "role": "BY", "achats": [{"ficheId": "{FB1}", "pieceId": "{PB1}", "date": "2027-09-10"}], "nombreOperations": 1}'::jsonb, null)$q$, 'OK', ''],
    array['retenir', 'DR2', 'postgres', $q$select id::text from declarations_ereporting where remplace_id = '{DR}'$q$, '', ''],
    array['controle', '123. le second achat, que seules des déclarations remplacées citent, se déclare en octobre', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2027-10-01', '2027-10-31', '{R1B}', null, 'Plateforme du dossier', '{"version": 1, "objet": "achats", "debut": "2027-10-01", "fin": "2027-10-31", "role": "BY", "achats": [{"ficheId": "{FB2}", "pieceId": "{PB2}", "date": "2027-10-05"}], "nombreOperations": 1}'::jsonb, null)$q$, 'OK', ''],
    array['fait', '124. une nouvelle version de la fiche du premier achat', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{PB1}', '{FB1}', 'INV-B1', '2027-09-10', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":100,"tva":0}]'::jsonb)$q$, 'OK', ''],
    array['retenir', 'FB1V2', 'postgres', $q$select id::text from pieces_hors_de_france where remplace_id = '{FB1}'$q$, '', ''],
    array['controle', '125. sous sa nouvelle fiche, le premier achat reste déclaré en septembre : la pièce compte, pas la version', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2027-10-01', '2027-10-31', '{R1B}', null, 'Plateforme du dossier', '{"version": 1, "objet": "achats", "debut": "2027-10-01", "fin": "2027-10-31", "role": "BY", "achats": [{"ficheId": "{FB1V2}", "pieceId": "{PB1}", "date": "2027-10-05"}], "nombreOperations": 1}'::jsonb, null)$q$,
      '22023', 'Une opération du contenu est déjà déclarée, dans la période du 01/09/2027 au 30/09/2027 : la période qui la porte se rectifie d''abord.'],
    array['controle', '126. la base garde ce qui a été déclaré : une version remplacée de la fiche se cite encore (le module la dit « à rectifier »)', 'chef', $q$select declarer_ereporting_hors_application('{T}', 'achats', '2027-09-01', '2027-09-30', '{R1B}', '{DR2}', 'Plateforme du dossier', '{"version": 1, "objet": "achats", "debut": "2027-09-01", "fin": "2027-09-30", "role": "BY", "achats": [{"ficheId": "{FB1}", "pieceId": "{PB1}", "date": "2027-09-10"}], "nombreOperations": 1}'::jsonb, null)$q$, 'OK', ''],
    array['valeur', '127. septembre : trois déclarations des achats, une seule active, une chaîne linéaire', 'postgres', $q$select count(*) || ':' || count(*) filter (where etat = 'declaree') || ':' || count(distinct remplace_id) from declarations_ereporting where dossier_id = '{T}' and objet = 'achats' and periode_debut = '2027-09-01'$q$, '',
      '3:1:2']
  ];

  if aujourd_hui >= date '2027-11-01' then
    etapes := etapes || etapes_apres;
  else
    verdicts := verdicts || jsonb_build_object('controle', '100. partie B, les déclarations acceptées',
      'observe', 'SANS OBJET : la base lit le ' || to_char(aujourd_hui, 'DD/MM/YYYY')
        || ', avant le 01/11/2027 — septembre et octobre 2027 ne sont pas finis ; jouée sur une réplique à l''horloge avancée',
      'ok', true);
  end if;

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
    ((select count(*) from dossiers)), ((select count(*) from pieces)), ((select count(*) from regimes_ereporting)),
    ((select count(*) from pieces_hors_de_france)), ((select count(*) from factures_emises)),
    ((select count(*) from encaissements_factures)), ((select count(*) from declarations_ereporting)),
    ((select count(*) from declarations_ereporting_sources)), ((select count(*) from cabinet_admins)),
    ((select count(*) from dossier_assignations)), ((select count(*) from memberships))
  ) as t(n);
  -- L'écart seul, non plus les comptes de toute la base, qui diraient le volume d'un dossier réel (audit du 29/10/2026).
  verdicts := verdicts || jsonb_build_object('controle', '199. rien n''est resté en base',
    'observe', 'écarts ' || (select string_agg(to_char(ecart_.apres_::bigint - ecart_.avant_::bigint, 'FMSG9999999990'), '/' order by ecart_.rang_) from unnest(string_to_array(avant, '/'), string_to_array(apres, '/')) with ordinality as ecart_(avant_, apres_, rang_)),
    'ok', avant = apres and not exists (select 1 from dossiers where nom like 'ESSAI DECLARATIONS%')
      and not exists (select 1 from cabinet_admins where user_id = client));

  perform set_config('essai.declarations_ereporting', verdicts::text, true);
end $essai$;

-- Un verdict qui n'a pas pu se calculer est une faute, pas un silence. La ligne 0 dit le texte que la base a reçu — par
-- l'outil MCP, qui ajoute sa signature après lui —, pour le comparer au fichier par son empreinte.
select x.controle, x.ok, x.observe from (
  select v.controle, coalesce(v.ok, false) as ok, v.observe
  from jsonb_to_recordset(current_setting('essai.declarations_ereporting')::jsonb) as v(controle text, ok boolean, observe text)
  union all
  select '0. information : le texte reçu par la base', true, length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by (regexp_match(x.controle, '^(\d+)'))[1]::int, x.controle;
