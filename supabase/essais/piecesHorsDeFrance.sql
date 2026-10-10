-- LA FICHE « FOURNISSEUR ÉTABLI HORS DE FRANCE » D'UNE PIÈCE, ÉPROUVÉE EN BASE — à rejouer par `execute_sql` après toute
-- migration qui touche `enregistrer_fiche_hors_de_france`, `retirer_fiche_hors_de_france`, `exercice_figeant_la_piece`,
-- les gardes `garder_fiche_hors_de_france`, `garder_fiche_hors_de_france_taux`, `garder_piece_hors_de_france`, les deux
-- tables `pieces_hors_de_france` et `pieces_hors_de_france_taux`, `garder_piece_validee`, `valider_exercice`,
-- `admin_du_dossier` ou `memberships` (ligne 28.5, étape e2 ; migration `pieces_hors_de_france`).
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - QUI écrit, par impersonation : un anonyme n'a pas le droit d'appeler ; un compte rattaché à rien, un client — sur
--     le dossier d'un autre comme sur le SIEN —, un membre du cabinet affecté à un AUTRE dossier se font refuser l'accès
--     au dossier ; le chef du cabinet, un chef qui n'est pas super-administrateur et un membre affecté au dossier
--     écrivent (les contrôles POSITIFS) ;
--   - QUI lit : le client ne voit aucune fiche, pas même celle d'une pièce de SON dossier ; l'anonyme et le compte
--     rattaché à rien non plus ; le membre affecté voit celles de son dossier, et elles seules ; et le client qui tente
--     d'écrire n'apprend rien de ses pièces (la RLS lui répond avant le gel de la validation) ;
--   - CE QUI S'ÉCRIT, d'un seul tenant : la fiche, sa devise recopiée de la pièce, son auteur, sa ventilation ; une fiche
--     qui en remplace une autre, une fiche retirée, puis remplacée à son tour ;
--   - CE QUI SE REFUSE, avec sa RAISON, dans l'ordre de la fonction — que src/lib/piecesHorsDeFrance.test.ts relit ici ;
--   - CE QUE LES GARDES ET LES CONTRAINTES TIENNENT SANS LA FONCTION : une fiche ne se modifie pas, sauf son retrait, une
--     fois, et sur la fiche courante ; sa ventilation ne se modifie pas ; une fiche décrit une pièce de son dossier et en
--     remplace une de la même pièce ; une seule première fiche par pièce, une seule suite par fiche ; une pièce qui a une
--     fiche ne change pas de dossier ; les formats du numéro, du pays, des codes et des taux ;
--   - CE QUE LA VALIDATION FIGE : la fiche d'une pièce qui porte une écriture validée — la sienne ou celle de son bien —
--     ne se remplace ni ne se retire plus, et la règle est celle de `garder_piece_validee` ;
--   - CE QUE LE CATALOGUE DIT : les droits d'exécution, la sécurité des fonctions, les policies, la RLS, les
--     déclencheurs et les clés ;
--   - LES MUTATIONS (contrôles 140 à 147) : chacune rejoue un contrôle avec un profil délibérément faux, et doit MORDRE ;
--   - et que RIEN ne reste en base.
--
-- CE QUI NE SE JOUE PAS ICI, ET SE JOUE SUR UNE RÉPLIQUE LOCALE dont signature.sql montre les neuf familles égales à la
-- production : la suppression d'une pièce et d'un dossier entier (leurs fiches partent avec eux), une suppression
-- directe (refusée), et deux sessions qui se croisent — l'outil d'exécution soumet une suppression à une confirmation
-- qui n'arrive pas ici.
--
-- Tout se joue dans des dossiers JETABLES du cabinet du dossier `test` et dans le dossier du client, au sein d'un bloc
-- qui s'annule entièrement à la fin (`ANNULATION_ESSAI_GLOBALE`) ; chaque contrôle dans sa sous-transaction, annulée elle
-- aussi (`ANNULATION_ESSAI`, P0001) — le moteur d'étapes de cotisationPersonnelle.sql, dont les quatre genres sont repris
-- (`jeu`, `controle`, `fait`, `valeur`), avec deux de plus : `retenir` (une lecture du propriétaire, gardée sous un nom
-- pour les étapes qui suivent) et `lecture` (une lecture jouée sous un profil, puis annulée, qui doit rendre exactement la
-- valeur attendue). Les profils « membre » (affecté au dossier T), « membre_ailleurs » (affecté au dossier A) et
-- « chef_simple » (chef du cabinet, pas super-administrateur) sont le compte client rattaché au cabinet le temps de la
-- sous-transaction, « client_v » le client rattaché au dossier V (`memberships`) : ils ne servent qu'aux genres
-- `controle` et `lecture`, qui s'annulent. Un refus se juge à son code ET à son message (motif LIKE). Les identifiants
-- jetables sont FIXES (préfixe `e2f10e00`). Les verdicts voyagent dans un réglage LOCAL à la transaction
-- (`essai.hors_de_france`) : hors de l'outil d'exécution, le fichier se joue en UNE transaction (`psql -1`). Aucune
-- instruction de suppression.
--
-- JOUÉ EN PRODUCTION LE 10/10/2026, juste après la migration : 196 contrôles sur 196 (plus la ligne d'information), et
-- 4/77/0/0/3/0/2/1/0/2 lignes avant comme après (dossiers, pièces, fiches, lignes de ventilation, écritures, exercices
-- validés, biens, rattachements au cabinet, affectations, accès clients). Le texte reçu par la base est le fichier
-- d'alors — sans ce paragraphe, avec son saut de ligne final (99 452 caractères, empreinte 03d33b0a…). Sur une réplique
-- dont la signature (signature.sql) est celle de la production, privée des objets de deux migrations d'autres
-- chantiers qui ne touchent rien d'ici : les mêmes 196 ; onze contrôles qui suppriment (la fiche et sa ventilation en
-- direct, une pièce, un dossier, un dossier figé, une pièce figée) et onze courses de deux sessions — essais locaux de
-- la session, hors du dépôt ; les cent quarante-huit mutations de la migration mordent toutes.
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
     or (select cabinet_id from dossiers where id = dossier_client) <> cabinet
     or not exists (select 1 from super_admins where user_id = chef)
     or not exists (select 1 from cabinet_admins where user_id = chef and cabinet_id = cabinet and role = 'comptable_en_chef')
     or exists (select 1 from cabinet_admins where user_id = client) or exists (select 1 from super_admins where user_id = client)
     or extract(year from (now() at time zone 'Europe/Paris'))::int <> 2026 then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable, client déjà rattaché au cabinet (ou l''année n''est plus 2026 : les dates de l''essai sont à avancer)';
  end if;

  ids := jsonb_build_object('CAB', cabinet, 'DC', dossier_client, 'DEMAIN', demain, 'AUTRE', gen_random_uuid())
    || jsonb_build_object(
      'T', 'e2f10e00-0000-4000-8000-0000000000a1', 'V', 'e2f10e00-0000-4000-8000-0000000000a2',
      'A', 'e2f10e00-0000-4000-8000-0000000000a3')
    || jsonb_build_object(
      'P1', 'e2f10e00-0000-4000-8001-000000000001', 'P2', 'e2f10e00-0000-4000-8001-000000000002',
      'P3', 'e2f10e00-0000-4000-8001-000000000003', 'P4', 'e2f10e00-0000-4000-8001-000000000004',
      'P5', 'e2f10e00-0000-4000-8001-000000000005', 'P6', 'e2f10e00-0000-4000-8001-000000000006',
      'P7', 'e2f10e00-0000-4000-8001-000000000007', 'P8', 'e2f10e00-0000-4000-8001-000000000008',
      'P9', 'e2f10e00-0000-4000-8001-000000000009', 'PA', 'e2f10e00-0000-4000-8001-00000000000a',
      'PB', 'e2f10e00-0000-4000-8001-00000000000b', 'PU', 'e2f10e00-0000-4000-8001-00000000000c',
      'PW', 'e2f10e00-0000-4000-8001-00000000000d',
      'PC', 'e2f10e00-0000-4000-8001-0000000000c1', 'PC2', 'e2f10e00-0000-4000-8001-0000000000c2',
      'PX', 'e2f10e00-0000-4000-8001-0000000000a3')
    || jsonb_build_object(
      'PV', 'e2f10e00-0000-4000-8002-000000000001', 'PV2', 'e2f10e00-0000-4000-8002-000000000002',
      'PI', 'e2f10e00-0000-4000-8002-000000000003', 'IV', 'e2f10e00-0000-4000-8003-000000000001',
      'E1', 'e2f10e00-0000-4000-8004-000000000001', 'E2', 'e2f10e00-0000-4000-8004-000000000002',
      'E3', 'e2f10e00-0000-4000-8004-000000000003', 'E4', 'e2f10e00-0000-4000-8004-000000000004',
      'E5', 'e2f10e00-0000-4000-8004-000000000005', 'E6', 'e2f10e00-0000-4000-8004-000000000006',
      'FD', 'e2f10e00-0000-4000-8005-000000000001', 'FE', 'e2f10e00-0000-4000-8005-000000000002');

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from pieces)), ((select count(*) from pieces_hors_de_france)),
    ((select count(*) from pieces_hors_de_france_taux)), ((select count(*) from ecritures_brouillon)),
    ((select count(*) from exercices_valides)), ((select count(*) from immobilisations)), ((select count(*) from cabinet_admins)),
    ((select count(*) from dossier_assignations)), ((select count(*) from memberships))
  ) as t(n);

  -- Une étape : {genre, contrôle, qui, requête, code attendu, message attendu (motif LIKE) ou valeur attendue}.
  etapes := array[
    -- ══ Le jeu : trois dossiers jetables du cabinet du dossier test, leurs pièces, un bien, des écritures ══════════
    array['jeu', 'dossiers jetables', 'postgres', $q$insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values
      ('{T}', 'ESSAI HORS DE FRANCE T', '{CAB}', 'tresorerie', '455000'), ('{V}', 'ESSAI HORS DE FRANCE V', '{CAB}', 'tresorerie', '455000'),
      ('{A}', 'ESSAI HORS DE FRANCE A', '{CAB}', 'tresorerie', '455000')$q$, '', ''],
    array['jeu', 'pièces de T', 'postgres', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, date_piece, montant_ht, montant_tva, montant_ttc, devise, montant_devise, taux_change, conversion_source) values
      ('{P1}', '{T}', '{T}/essai-e2-p1.pdf', 'essai-e2-p1.pdf', 'achat', '2026-03-10', 120, null, 120, 'EUR', null, null, null),
      ('{P2}', '{T}', '{T}/essai-e2-p2.pdf', 'essai-e2-p2.pdf', 'achat', '2026-04-02', 85.47, 0, 85.47, 'USD', 99.99, 1.1699, 'bce'),
      ('{P3}', '{T}', '{T}/essai-e2-p3.pdf', 'essai-e2-p3.pdf', 'achat', '2026-03-12', 100, 20, 120, 'EUR', null, null, null),
      ('{P4}', '{T}', '{T}/essai-e2-p4.pdf', 'essai-e2-p4.pdf', 'vente', '2026-03-13', 50, null, 50, 'EUR', null, null, null),
      ('{P5}', '{T}', '{T}/essai-e2-p5.pdf', 'essai-e2-p5.pdf', 'achat', '2026-03-14', null, null, null, 'EUR', null, null, null),
      ('{P6}', '{T}', '{T}/essai-e2-p6.pdf', 'essai-e2-p6.pdf', 'achat', '2026-03-15', -50, null, -50, 'EUR', null, null, null),
      ('{P7}', '{T}', '{T}/essai-e2-p7.pdf', 'essai-e2-p7.pdf', 'note_frais', '2026-03-16', 60, null, 60, 'EUR', null, null, null),
      ('{P8}', '{T}', '{T}/essai-e2-p8.pdf', 'essai-e2-p8.pdf', 'achat', '2026-03-17', 120, null, 120, 'EUR', null, null, null),
      ('{P9}', '{T}', '{T}/essai-e2-p9.pdf', 'essai-e2-p9.pdf', 'achat', '2026-03-18', 300, null, 300, 'EUR', null, null, null),
      ('{PA}', '{T}', '{T}/essai-e2-pa.pdf', 'essai-e2-pa.pdf', 'achat', '2026-03-19', 40, null, 40, 'EUR', null, null, null),
      ('{PB}', '{T}', '{T}/essai-e2-pb.pdf', 'essai-e2-pb.pdf', 'achat', '2026-03-20', 70, null, 70, 'EUR', null, null, null),
      ('{PU}', '{T}', '{T}/essai-e2-pu.pdf', 'essai-e2-pu.pdf', 'achat', '2026-03-21', 80, null, 80, 'USD', null, null, null),
      ('{PW}', '{T}', '{T}/essai-e2-pw.pdf', 'essai-e2-pw.pdf', 'achat', '2026-03-22', null, null, null, 'USD', 80, null, null)$q$, '', ''],
    array['jeu', 'pièces du dossier du client, et pièce de A', 'postgres', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, date_piece, montant_ttc, devise) values
      ('{PC}', '{DC}', '{DC}/essai-e2-pc.pdf', 'essai-e2-pc.pdf', 'achat', '2026-03-10', 10, 'EUR'),
      ('{PC2}', '{DC}', '{DC}/essai-e2-pc2.pdf', 'essai-e2-pc2.pdf', 'achat', '2026-03-11', 15, 'EUR'),
      ('{PX}', '{A}', '{A}/essai-e2-px.pdf', 'essai-e2-px.pdf', 'achat', '2026-03-10', 25, 'EUR')$q$, '', ''],
    array['jeu', 'pièces de V (2025) et le bien de PI', 'postgres', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, date_piece, montant_ttc, devise) values
      ('{PV}', '{V}', '{V}/essai-e2-pv.pdf', 'essai-e2-pv.pdf', 'achat', '2025-06-10', 100, 'EUR'),
      ('{PV2}', '{V}', '{V}/essai-e2-pv2.pdf', 'essai-e2-pv2.pdf', 'achat', '2025-07-10', 50, 'EUR'),
      ('{PI}', '{V}', '{V}/essai-e2-pi.pdf', 'essai-e2-pi.pdf', 'achat', '2025-08-10', 1000, 'EUR');
      insert into immobilisations (id, dossier_id, piece_id, libelle, valeur, date_acquisition, duree_annees) values ('{IV}', '{V}', '{PI}', 'ESSAI BIEN', 1000, '2025-08-10', 5)$q$, '', ''],
    array['jeu', 'écritures de V en 2025 : deux pièces, la dotation du bien', 'postgres', $q$insert into ecritures_brouillon (id, dossier_id, piece_id, immobilisation_id, date, compte, libelle, montant, sens) values
      ('{E1}', '{V}', '{PV}', null, '2025-06-10', '606100', 'ESSAI PV', 100, 'debit'), ('{E2}', '{V}', '{PV}', null, '2025-06-10', '401000', 'ESSAI PV', 100, 'credit'),
      ('{E3}', '{V}', '{PV2}', null, '2025-07-10', '606100', 'ESSAI PV2', 50, 'debit'), ('{E4}', '{V}', '{PV2}', null, '2025-07-10', '401000', 'ESSAI PV2', 50, 'credit'),
      ('{E5}', '{V}', null, '{IV}', '2025-12-31', '681100', 'ESSAI DOTATION', 79.45, 'debit'), ('{E6}', '{V}', null, '{IV}', '2025-12-31', '281830', 'ESSAI DOTATION', 79.45, 'credit')$q$, '', ''],

    -- ══ 1 à 7. Qui écrit ══════════
    array['controle', '1. anonyme : pas le droit d''appeler', 'anon', $q$select enregistrer_fiche_hors_de_france('{T}', '{P1}', null, 'INV-2026-001', '2026-03-10', '380', null, null, 'IE', '0223', 'IE6388047V', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":120,"tva":0}]'::jsonb)$q$,
      '42501', 'permission denied for function enregistrer_fiche_hors_de_france'],
    array['controle', '2. rattaché à rien : l''accès au dossier, avant de rien lire', 'inconnu', $q$select enregistrer_fiche_hors_de_france('{T}', '{P1}', null, 'INV-2026-001', '2026-03-10', '380', null, null, 'IE', '0223', 'IE6388047V', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":120,"tva":0}]'::jsonb)$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '3. client, le dossier d''un autre', 'client', $q$select enregistrer_fiche_hors_de_france('{T}', '{P1}', null, 'INV-2026-001', '2026-03-10', '380', null, null, 'IE', '0223', 'IE6388047V', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":120,"tva":0}]'::jsonb)$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '4. client, son propre dossier', 'client', $q$select enregistrer_fiche_hors_de_france('{DC}', '{PC}', null, 'INV-C-1', '2026-03-10', '380', null, null, 'IE', '0223', 'IE6388047V', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":10,"tva":0}]'::jsonb)$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '5. membre du cabinet affecté à un AUTRE dossier', 'membre_ailleurs', $q$select enregistrer_fiche_hors_de_france('{T}', '{P1}', null, 'INV-2026-001', '2026-03-10', '380', null, null, 'IE', '0223', 'IE6388047V', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":120,"tva":0}]'::jsonb)$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '6. un dossier qui n''existe pas, même pour le super-administrateur', 'chef', $q$select enregistrer_fiche_hors_de_france('{AUTRE}', '{P1}', null, 'INV-2026-001', '2026-03-10', '380', null, null, 'IE', '0223', 'IE6388047V', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":120,"tva":0}]'::jsonb)$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '7. la pièce d''un autre dossier : introuvable dans celui-ci', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{PC}', null, 'INV-C-1', '2026-03-10', '380', null, null, 'IE', '0223', 'IE6388047V', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":10,"tva":0}]'::jsonb)$q$,
      'P0002', 'Pièce introuvable dans ce dossier.'],

    -- ══ 8 à 10. La pièce ══════════
    array['controle', '8. une vente n''a pas de fiche', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P4}', null, 'V-1', '2026-03-13', '380', null, null, 'IE', '0223', 'IE6388047V', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":50,"tva":0}]'::jsonb)$q$,
      '22023', 'Seule une pièce d''achat ou une note de frais reçoit une fiche « fournisseur établi hors de France ».'],
    array['controle', '9. une pièce sans son montant TTC', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P5}', null, 'INV-5', '2026-03-14', '380', null, null, 'IE', '0223', 'IE6388047V', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":50,"tva":0}]'::jsonb)$q$,
      '22023', 'La pièce n''a pas encore son montant TTC dans sa devise (EUR) : le saisir sur la pièce d''abord.'],
    array['controle', '9b. une pièce en dollars sans son montant en dollars', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{PU}', null, 'INV-U', '2026-03-21', '380', null, null, 'US', '0227', 'USACME SOFTWARE IN', 'services', true, null, null, null, '[{"code":"O","taux":0,"base":80,"tva":0}]'::jsonb)$q$,
      '22023', 'La pièce n''a pas encore son montant TTC dans sa devise (USD) : le saisir sur la pièce d''abord.'],
    array['controle', '10. une pièce qui porte une TVA : mise de côté (hypothèse Q7)', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P3}', null, 'INV-3', '2026-03-12', '380', null, null, 'IE', '0223', 'IE6388047V', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":120,"tva":0}]'::jsonb)$q$,
      '22023', 'La pièce porte une TVA de 20,00 € : un achat à un fournisseur établi hors de France facturé avec une TVA — la sienne ou la TVA française — est mis de côté, à trancher par le cabinet.'],

    -- ══ 11 à 17. Ce qui s'écrit ══════════
    array['fait', '11. le chef enregistre la fiche d''un service autoliquidé, acheté à un fournisseur irlandais', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P1}', null, 'INV-2026-001', '2026-03-10', '380', null, null, 'IE', '0223', 'IE6388047V', 'services', true, null, '2026-03-01', '2026-03-31', '[{"code":"AE","taux":0,"base":120,"tva":0,"motif_code":"VATEX-EU-AE","motif_texte":"Autoliquidation"}]'::jsonb)$q$, 'OK', ''],
    array['retenir', 'F1', 'postgres', $q$select id::text from pieces_hors_de_france where piece_id = '{P1}'$q$, '', ''],
    array['valeur', '12. la fiche : la devise de la pièce, l''auteur, aucune fiche remplacée, rien de retiré', 'postgres', $q$select string_agg(numero || ':' || date_facture || ':' || type_document || ':' || devise || ':' || pays || ':' || schema_identifiant || ':' || identifiant || ':' || nature || ':' || autoliquidation || ':' || coalesce(periode_debut::text, '-') || ':' || coalesce(periode_fin::text, '-') || ':' || (cree_par = '{CHEF}')::text || ':' || (remplace_id is null)::text || ':' || (retire_le is null)::text, ',') from pieces_hors_de_france where piece_id = '{P1}'$q$, '',
      'INV-2026-001:2026-03-10:380:EUR:IE:0223:IE6388047V:services:true:2026-03-01:2026-03-31:true:true:true'],
    array['valeur', '13. sa ventilation', 'postgres', $q$select string_agg(code_tva || ':' || trim_scale(taux) || ':' || trim_scale(base) || ':' || trim_scale(tva) || ':' || coalesce(motif_code, '-') || ':' || coalesce(motif_texte, '-') || ':' || (dossier_id = '{T}')::text, ',') from pieces_hors_de_france_taux where fiche_id = '{F1}'$q$, '',
      'AE:0:120:0:VATEX-EU-AE:Autoliquidation:true'],
    array['fait', '14. un service acheté aux États-Unis, en dollars, écrit O (AE ou O : le point 5 de la conception) ; la fiche prend la devise de la pièce', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P2}', null, 'US-778', '2026-04-02', '380', null, null, 'US', '0227', 'USACME SOFTWARE IN', 'services', true, null, null, null, '[{"code":"O","taux":0,"base":99.99,"tva":0}]'::jsonb)$q$, 'OK', ''],
    array['retenir', 'F2', 'postgres', $q$select id::text from pieces_hors_de_france where piece_id = '{P2}'$q$, '', ''],
    array['valeur', '15. sa devise est celle de la pièce', 'postgres', $q$select devise || ':' || identifiant from pieces_hors_de_france where id = '{F2}'$q$, '', 'USD:USACME SOFTWARE IN'],
    array['fait', '16. un avoir, qui cite sa facture d''origine, sur une pièce au montant négatif', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P6}', null, 'AV-12', '2026-03-15', '381', 'INV-2026-001', '2026-03-10', 'IE', '0223', 'IE6388047V', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":50,"tva":0}]'::jsonb)$q$, 'OK', ''],
    array['valeur', '16b. ses deux mentions', 'postgres', $q$select type_document || ':' || facture_origine_numero || ':' || facture_origine_date from pieces_hors_de_france where piece_id = '{P6}'$q$, '', '381:INV-2026-001:2026-03-10'],
    array['retenir', 'F6', 'postgres', $q$select id::text from pieces_hors_de_france where piece_id = '{P6}'$q$, '', ''],
    array['controle', '17. une note de frais reçoit aussi une fiche', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P7}', null, 'NF-1', '2026-03-16', '380', null, null, 'DE', '0223', 'DE123456789', 'biens', true, '2026-03-16', null, null, '[{"code":"K","taux":0,"base":60,"tva":0}]'::jsonb)$q$, 'OK', ''],

    -- ══ 20 à 22. La fiche courante ══════════
    array['controle', '20. une fiche existe, et l''écran n''en savait rien', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P1}', null, 'INV-2026-001', '2026-03-10', '380', null, null, 'IE', '0223', 'IE6388047V', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":120,"tva":0}]'::jsonb)$q$,
      '22023', 'Une autre fiche a été enregistrée pour cette pièce depuis : relire avant d''enregistrer.'],
    array['controle', '21. la fiche à remplacer n''existe pas', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P1}', '{AUTRE}', 'INV-2026-001', '2026-03-10', '380', null, null, 'IE', '0223', 'IE6388047V', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":120,"tva":0}]'::jsonb)$q$,
      '22023', 'La fiche à remplacer n''est pas une fiche de cette pièce.'],
    array['controle', '22. la fiche à remplacer est celle d''une autre pièce', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', '{F1}', 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":300,"tva":0}]'::jsonb)$q$,
      '22023', 'La fiche à remplacer n''est pas une fiche de cette pièce.'],

    -- ══ 30 à 56. La facture, son fournisseur ══════════
    array['controle', '30. le numéro est à renseigner', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, '  ', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":300,"tva":0}]'::jsonb)$q$,
      '22023', 'Le numéro de la facture est à renseigner.'],
    array['controle', '31. un point dans le numéro', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'INV.2026.9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":300,"tva":0}]'::jsonb)$q$,
      '22023', 'Le numéro de la facture tient en 35 caractères : lettres sans accent, chiffres, espaces simples et « - + _ / », sans espace au début ni à la fin.'],
    array['controle', '31b. trente-six caractères', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, repeat('A', 36), '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":300,"tva":0}]'::jsonb)$q$,
      '22023', 'Le numéro de la facture tient en 35 caractères : lettres sans accent, chiffres, espaces simples et « - + _ / », sans espace au début ni à la fin.'],
    array['controle', '31c. deux espaces de suite', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'INV  9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":300,"tva":0}]'::jsonb)$q$,
      '22023', 'Le numéro de la facture tient en 35 caractères : lettres sans accent, chiffres, espaces simples et « - + _ / », sans espace au début ni à la fin.'],
    array['controle', '32. la date est à renseigner', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', null, '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":300,"tva":0}]'::jsonb)$q$,
      '22023', 'La date de la facture est à renseigner.'],
    array['controle', '33. pas avant l''an 2000', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '1999-12-31', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":300,"tva":0}]'::jsonb)$q$,
      '22023', 'Une facture ne se date pas avant l''an 2000.'],
    array['controle', '34. pas dans l''avenir, le jour lu à Paris', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '{DEMAIN}', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":300,"tva":0}]'::jsonb)$q$,
      '22023', 'Une facture ne se date pas dans l''avenir : nous sommes le %.'],
    array['controle', '35. une facture d''acompte ne s''écrit pas encore', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '386', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":300,"tva":0}]'::jsonb)$q$,
      '22023', 'Une fiche décrit une facture (380) ou un avoir (381).'],
    array['controle', '36. une facture sur une pièce au montant négatif', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P6}', '{F6}', 'AV-12', '2026-03-15', '380', null, null, 'IE', '0223', 'IE6388047V', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":50,"tva":0}]'::jsonb)$q$,
      '22023', 'La pièce et sa fiche ne disent pas le même sens : une facture (380) porte un montant positif dans la pièce, un avoir (381) un montant négatif.'],
    array['controle', '36b. un avoir sur une pièce au montant positif', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'AV-9', '2026-03-18', '381', 'INV-1', '2026-01-10', 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":300,"tva":0}]'::jsonb)$q$,
      '22023', 'La pièce et sa fiche ne disent pas le même sens : une facture (380) porte un montant positif dans la pièce, un avoir (381) un montant négatif.'],
    array['controle', '36c. un avoir sur une pièce en dollars au montant positif : le sens se lit dans sa devise', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{PW}', null, 'AV-W', '2026-03-22', '381', 'INV-W', '2026-03-01', 'US', '0227', 'USACME SOFTWARE IN', 'services', true, null, null, null, '[{"code":"O","taux":0,"base":80,"tva":0}]'::jsonb)$q$,
      '22023', 'La pièce et sa fiche ne disent pas le même sens : une facture (380) porte un montant positif dans la pièce, un avoir (381) un montant négatif.'],
    array['controle', '37. un avoir sans sa facture d''origine', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P6}', '{F6}', 'AV-12', '2026-03-15', '381', null, null, 'IE', '0223', 'IE6388047V', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":50,"tva":0}]'::jsonb)$q$,
      '22023', 'Un avoir cite la facture qu''il corrige : son numéro et sa date.'],
    array['controle', '37b. un numéro de facture d''origine fait de blancs', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P6}', '{F6}', 'AV-12', '2026-03-15', '381', '  ', '2026-03-10', 'IE', '0223', 'IE6388047V', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":50,"tva":0}]'::jsonb)$q$,
      '22023', 'Un avoir cite la facture qu''il corrige : son numéro et sa date.'],
    array['controle', '38. un avoir sans la date de sa facture d''origine', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P6}', '{F6}', 'AV-12', '2026-03-15', '381', 'INV-2026-001', null, 'IE', '0223', 'IE6388047V', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":50,"tva":0}]'::jsonb)$q$,
      '22023', 'Un avoir cite la facture qu''il corrige : son numéro et sa date.'],
    array['controle', '39. la facture d''origine, mal écrite', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P6}', '{F6}', 'AV-12', '2026-03-15', '381', 'F.1', '2026-03-10', 'IE', '0223', 'IE6388047V', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":50,"tva":0}]'::jsonb)$q$,
      '22023', 'La facture d''origine se cite par un numéro de 35 caractères (lettres sans accent, chiffres, espaces simples et « - + _ / ») et une date entre le 01/01/2000 et aujourd''hui.'],
    array['controle', '39b. la facture d''origine, datée de demain', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P6}', '{F6}', 'AV-12', '2026-03-15', '381', 'INV-2026-001', '{DEMAIN}', 'IE', '0223', 'IE6388047V', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":50,"tva":0}]'::jsonb)$q$,
      '22023', 'La facture d''origine se cite par un numéro de 35 caractères (lettres sans accent, chiffres, espaces simples et « - + _ / ») et une date entre le 01/01/2000 et aujourd''hui.'],
    array['controle', '39c. la facture d''origine, d''avant l''an 2000', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P6}', '{F6}', 'AV-12', '2026-03-15', '381', 'INV-2026-001', '1999-12-31', 'IE', '0223', 'IE6388047V', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":50,"tva":0}]'::jsonb)$q$,
      '22023', 'La facture d''origine se cite par un numéro de 35 caractères (lettres sans accent, chiffres, espaces simples et « - + _ / ») et une date entre le 01/01/2000 et aujourd''hui.'],
    array['controle', '40. une facture ne cite pas de facture d''origine', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', 'INV-1', '2026-01-10', 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":300,"tva":0}]'::jsonb)$q$,
      '22023', 'Seul un avoir cite une facture d''origine.'],
    array['controle', '41. un code de pays inconnu', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'XX', '0227', 'XXACME', 'services', true, null, null, null, '[{"code":"O","taux":0,"base":300,"tva":0}]'::jsonb)$q$,
      '22023', 'Le pays du fournisseur est un code de pays à deux lettres (norme ISO 3166).'],
    array['controle', '41b. XI n''est pas un code de pays de l''ISO 3166', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'XI', '0223', 'XI123456789', 'biens', true, null, null, null, '[{"code":"K","taux":0,"base":300,"tva":0}]'::jsonb)$q$,
      '22023', 'Le pays du fournisseur est un code de pays à deux lettres (norme ISO 3166).'],
    array['controle', '42. un fournisseur établi en France', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'FR', '0223', 'FR12345678901', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":300,"tva":0}]'::jsonb)$q$,
      '22023', 'Un fournisseur établi en France n''a pas de fiche « hors de France ».'],
    array['controle', '43. Monaco', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'MC', '0227', 'MCSOCIETE', 'services', true, null, null, null, '[{"code":"O","taux":0,"base":300,"tva":0}]'::jsonb)$q$,
      '22023', 'Un fournisseur établi à Monaco est traité comme un fournisseur établi en France : il n''a pas de fiche « hors de France ».'],
    array['controle', '44. la Guadeloupe', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'GP', '0227', 'GPSOCIETE', 'services', true, null, null, null, '[{"code":"O","taux":0,"base":300,"tva":0}]'::jsonb)$q$,
      '22023', 'Un achat à un fournisseur établi en Guadeloupe, en Martinique ou à La Réunion passe par la facture électronique, pas par cette fiche.'],
    array['controle', '45. la Nouvelle-Calédonie', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'NC', '0227', 'NCSOCIETE', 'services', true, null, null, null, '[{"code":"O","taux":0,"base":300,"tva":0}]'::jsonb)$q$,
      '22023', 'L''outre-mer français a ses propres règles (Guyane, Mayotte, collectivités d''outre-mer, Nouvelle-Calédonie, Terres australes) : cette fiche ne le couvre pas encore.'],
    array['controle', '46. un schéma inconnu', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0002', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":300,"tva":0}]'::jsonb)$q$,
      '22023', 'Le fournisseur se désigne par son numéro de TVA s''il est établi dans l''Union (schéma 0223), par son pays et son nom sinon (schéma 0227).'],
    array['controle', '47. un fournisseur allemand désigné par son nom', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0227', 'DEACME GMBH', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":300,"tva":0}]'::jsonb)$q$,
      '22023', 'Un fournisseur établi dans l''Union se désigne par son numéro de TVA (schéma 0223).'],
    array['controle', '48. un fournisseur américain désigné par un numéro de TVA', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'US', '0223', 'US123456789', 'services', true, null, null, null, '[{"code":"O","taux":0,"base":300,"tva":0}]'::jsonb)$q$,
      '22023', 'Un fournisseur établi hors de l''Union se désigne par son pays et son nom (schéma 0227).'],
    array['controle', '49. l''identifiant est à renseigner', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', ' ', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":300,"tva":0}]'::jsonb)$q$,
      '22023', 'L''identifiant du fournisseur est à renseigner.'],
    array['controle', '50. un numéro de TVA d''un autre pays', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'NL123456789B01', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":300,"tva":0}]'::jsonb)$q$,
      '22023', 'Le numéro de TVA d''un fournisseur établi dans ce pays (DE) commence par DE et tient en 18 caractères au plus : des lettres sans accent et des chiffres.'],
    array['controle', '50b. la Grèce : EL, et non GR', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'GR', '0223', 'GR123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":300,"tva":0}]'::jsonb)$q$,
      '22023', 'Le numéro de TVA d''un fournisseur établi dans ce pays (GR) commence par EL et tient en 18 caractères au plus : des lettres sans accent et des chiffres.'],
    array['controle', '50c. la Grèce, sous son préfixe EL', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'GR', '0223', 'EL123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":300,"tva":0}]'::jsonb)$q$, 'OK', ''],
    array['controle', '51. un fournisseur hors de l''Union : son code pays d''abord', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'US', '0227', 'ACME SOFTWARE INC', 'services', true, null, null, null, '[{"code":"O","taux":0,"base":300,"tva":0}]'::jsonb)$q$,
      '22023', 'L''identifiant d''un fournisseur établi hors de l''Union est son code de pays (US) suivi des seize premiers caractères de sa dénomination, sans espace au début ni à la fin.'],
    array['controle', '51b. dix-neuf caractères', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'US', '0227', 'USACME SOFTWARE INC', 'services', true, null, null, null, '[{"code":"O","taux":0,"base":300,"tva":0}]'::jsonb)$q$,
      '22023', 'L''identifiant d''un fournisseur établi hors de l''Union est son code de pays (US) suivi des seize premiers caractères de sa dénomination, sans espace au début ni à la fin.'],
    array['controle', '52. la nature de l''achat', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'logiciel', true, null, null, null, '[{"code":"AE","taux":0,"base":300,"tva":0}]'::jsonb)$q$,
      '22023', 'La nature de l''achat est des biens, des services, ou les deux.'],
    array['controle', '53. l''autoliquidation se dit', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', null, null, null, null, '[{"code":"AE","taux":0,"base":300,"tva":0}]'::jsonb)$q$,
      '22023', 'Dire si le dossier autoliquide la TVA de cet achat.'],
    array['controle', '54. une date de livraison et une période', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, '2026-03-18', '2026-03-01', '2026-03-31', '[{"code":"AE","taux":0,"base":300,"tva":0}]'::jsonb)$q$,
      '22023', 'Une facture porte une date de livraison ou une période de facturation, pas les deux.'],
    array['controle', '55. une période sans fin', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, '2026-03-01', null, '[{"code":"AE","taux":0,"base":300,"tva":0}]'::jsonb)$q$,
      '22023', 'Une période de facturation a un début et une fin, et ne finit pas avant de commencer.'],
    array['controle', '55b. une période qui finit avant de commencer', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, '2026-03-31', '2026-03-01', '[{"code":"AE","taux":0,"base":300,"tva":0}]'::jsonb)$q$,
      '22023', 'Une période de facturation a un début et une fin, et ne finit pas avant de commencer.'],
    array['controle', '56. une livraison en 2100', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'biens', true, '2100-01-01', null, null, '[{"code":"K","taux":0,"base":300,"tva":0}]'::jsonb)$q$,
      '22023', 'Une date de livraison ou de période se situe entre l''an 2000 et 2099.'],

    -- ══ 60 à 72. La ventilation ══════════
    array['controle', '60. la ventilation n''est pas une liste', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '{}'::jsonb)$q$,
      '22023', 'La ventilation par taux est illisible : une liste de codes, de taux et de montants.'],
    array['controle', '60b. une liste vide', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[]'::jsonb)$q$,
      '22023', 'La ventilation par taux est illisible : une liste de codes, de taux et de montants.'],
    array['controle', '60c. une ligne sans TVA', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":300}]'::jsonb)$q$,
      '22023', 'La ventilation par taux est illisible : une liste de codes, de taux et de montants.'],
    array['controle', '60d. un montant écrit en texte', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":"300","tva":0}]'::jsonb)$q$,
      '22023', 'La ventilation par taux est illisible : une liste de codes, de taux et de montants.'],
    array['controle', '60e. une clé inconnue', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":300,"tva":0,"devise":"EUR"}]'::jsonb)$q$,
      '22023', 'La ventilation par taux est illisible : une liste de codes, de taux et de montants.'],
    array['controle', '60f. un motif qui n''est pas un texte', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":300,"tva":0,"motif_code":12}]'::jsonb)$q$,
      '22023', 'La ventilation par taux est illisible : une liste de codes, de taux et de montants.'],
    array['controle', '60g. une ligne qui n''est pas un objet', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":300,"tva":0}, 12]'::jsonb)$q$,
      '22023', 'La ventilation par taux est illisible : une liste de codes, de taux et de montants.'],
    array['controle', '60h. aucune ventilation', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, null)$q$,
      '22023', 'La ventilation par taux est illisible : une liste de codes, de taux et de montants.'],
    array['controle', '61. la même ligne deux fois', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":150,"tva":0},{"code":"AE","taux":0.0,"base":150,"tva":0}]'::jsonb)$q$,
      '22023', 'Le code AE au taux de 0 % figure deux fois dans la ventilation.'],
    array['controle', '62. un code inconnu', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":100,"tva":0},{"code":"L","taux":0,"base":200,"tva":0}]'::jsonb)$q$,
      '22023', 'Le code de TVA « L » n''est pas un code que la facturation électronique admet.'],
    array['controle', '63. une ligne au taux normal : mise de côté (hypothèse Q7), avant une forme à reprendre', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":20,"base":250,"tva":0},{"code":"S","taux":20,"base":50,"tva":10}]'::jsonb)$q$,
      '22023', 'Une ligne au taux normal (S) dit une TVA facturée par le fournisseur : cet achat est mis de côté, à trancher par le cabinet.'],
    array['controle', '64. un taux sur une ligne sans TVA facturée', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"K","taux":0,"base":100,"tva":0},{"code":"AE","taux":20,"base":200,"tva":0}]'::jsonb)$q$,
      '22023', 'Une ligne AE ne porte ni taux ni TVA : sans TVA facturée, l''un et l''autre sont nuls.'],
    array['controle', '64b. une TVA sur une ligne hors du champ', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'US', '0227', 'USACME', 'services', true, null, null, null, '[{"code":"O","taux":0,"base":295,"tva":5}]'::jsonb)$q$,
      '22023', 'Une ligne O ne porte ni taux ni TVA : sans TVA facturée, l''un et l''autre sont nuls.'],
    array['controle', '65. une base négative', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":-300,"tva":0}]'::jsonb)$q$,
      '22023', 'Chaque base de la ventilation est un montant positif, au centime.'],
    array['controle', '65b. une base au millième', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":299.995,"tva":0}]'::jsonb)$q$,
      '22023', 'Chaque base de la ventilation est un montant positif, au centime.'],
    array['controle', '66. une exonération sans son motif', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":200,"tva":0},{"code":"E","taux":0,"base":100,"tva":0,"motif_code":"VATEX-EU-132"}]'::jsonb)$q$,
      '22023', 'Une exonération (E) porte son motif : un code VATEX et son libellé.'],
    array['controle', '67. un code de motif qui n''est pas VATEX', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":300,"tva":0,"motif_code":"EXO-261","motif_texte":"Autoliquidation"}]'::jsonb)$q$,
      '22023', 'Un motif se compose d''un code VATEX de 30 caractères au plus et d''un libellé de 1 024 caractères au plus, qui ne se compose pas que de blancs.'],
    array['controle', '67b. un libellé de motif fait de blancs', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":300,"tva":0,"motif_code":"VATEX-EU-AE","motif_texte":"   "}]'::jsonb)$q$,
      '22023', 'Un motif se compose d''un code VATEX de 30 caractères au plus et d''un libellé de 1 024 caractères au plus, qui ne se compose pas que de blancs.'],
    array['controle', '68. un taux zéro ne porte pas de motif', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":200,"tva":0},{"code":"Z","taux":0,"base":100,"tva":0,"motif_texte":"Taux zéro"}]'::jsonb)$q$,
      '22023', 'Une ligne au taux zéro (Z) ne porte pas de motif.'],
    array['controle', '69. une exonération d''un fournisseur hors de l''Union', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'CH', '0227', 'CHSOCIETE SUISSE', 'services', true, null, null, null, '[{"code":"O","taux":0,"base":200,"tva":0},{"code":"E","taux":0,"base":100,"tva":0,"motif_code":"VATEX-EU-132","motif_texte":"Exonération"}]'::jsonb)$q$,
      '22023', 'Une exonération (E) demande le numéro de TVA du fournisseur : un fournisseur établi hors de l''Union n''en a pas.'],
    array['controle', '70. une ligne AE que le dossier n''autoliquiderait pas', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', false, null, null, null, '[{"code":"AE","taux":0,"base":300,"tva":0}]'::jsonb)$q$,
      '22023', 'Une ligne en autoliquidation (AE) ou une acquisition dans l''Union (K) suppose que le dossier autoliquide la TVA de cet achat ; une acquisition de biens qu''il n''a pas à autoliquider est à trancher par le cabinet.'],
    array['controle', '70b. une acquisition de biens dans l''Union, sans autoliquidation : à trancher (point 15)', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'biens', false, null, null, null, '[{"code":"K","taux":0,"base":300,"tva":0}]'::jsonb)$q$,
      '22023', 'Une ligne en autoliquidation (AE) ou une acquisition dans l''Union (K) suppose que le dossier autoliquide la TVA de cet achat ; une acquisition de biens qu''il n''a pas à autoliquider est à trancher par le cabinet.'],
    array['controle', '71. rien à autoliquider : que des exonérations', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"E","taux":0,"base":300,"tva":0,"motif_code":"VATEX-EU-132","motif_texte":"Exonération"}]'::jsonb)$q$,
      '22023', 'Rien à autoliquider : une exonération (E) ou un taux zéro (Z) ne laisse aucune TVA due.'],
    array['controle', '71b. une exonération que le dossier n''autoliquide pas s''écrit', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', false, null, null, null, '[{"code":"E","taux":0,"base":300,"tva":0,"motif_code":"VATEX-EU-132","motif_texte":"Exonération"}]'::jsonb)$q$, 'OK', ''],
    array['controle', '72. la ventilation ne fait pas le montant de la pièce', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":299.98,"tva":0}]'::jsonb)$q$,
      '22023', 'La ventilation (299,98 EUR) ne fait pas le montant TTC de la pièce (300,00 EUR), à un centime près.'],
    array['controle', '72b. un centime d''écart passe', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":299.99,"tva":0}]'::jsonb)$q$, 'OK', ''],
    array['controle', '72c. en dollars, contre le montant en dollars de la pièce', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P2}', '{F2}', 'US-778', '2026-04-02', '380', null, null, 'US', '0227', 'USACME SOFTWARE IN', 'services', true, null, null, null, '[{"code":"O","taux":0,"base":85.47,"tva":0}]'::jsonb)$q$,
      '22023', 'La ventilation (85,47 USD) ne fait pas le montant TTC de la pièce (99,99 USD), à un centime près.'],
    array['controle', '72d. un avoir : la valeur absolue de la pièce', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P6}', '{F6}', 'AV-12', '2026-03-15', '381', 'INV-2026-001', '2026-03-10', 'IE', '0223', 'IE6388047V', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":49,"tva":0}]'::jsonb)$q$,
      '22023', 'La ventilation (49,00 EUR) ne fait pas le montant TTC de la pièce (50,00 EUR), à un centime près.'],

    -- ══ 80 à 82. La même facture sur deux pièces ══════════
    array['controle', '80. la facture de F1, sur une autre pièce : une facture ne se déclare qu''une fois', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P8}', null, 'inv-2026-001', '2026-05-02', '380', null, null, 'IE', '0223', 'IE6388047V', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":120,"tva":0}]'::jsonb)$q$,
      '22023', 'Cette facture a déjà une fiche, sur une autre pièce du dossier : une facture ne se déclare qu''une fois.'],
    array['controle', '81. le même numéro une autre année passe', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P8}', null, 'INV-2026-001', '2025-03-10', '380', null, null, 'IE', '0223', 'IE6388047V', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":120,"tva":0}]'::jsonb)$q$, 'OK', ''],
    array['controle', '82. le même numéro d''un autre fournisseur passe', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P8}', null, 'INV-2026-001', '2026-03-10', '380', null, null, 'IE', '0223', 'IE9999999W', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":120,"tva":0}]'::jsonb)$q$, 'OK', ''],

    -- ══ 85 à 98. Remplacer, retirer ══════════
    array['fait', '85. F1 remplacée : le numéro corrigé', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P1}', '{F1}', 'INV-2026-0001', '2026-03-10', '380', null, null, 'IE', '0223', 'IE6388047V', 'services', true, null, '2026-03-01', '2026-03-31', '[{"code":"AE","taux":0,"base":120,"tva":0}]'::jsonb)$q$, 'OK', ''],
    array['retenir', 'F1B', 'postgres', $q$select id::text from pieces_hors_de_france where remplace_id = '{F1}'$q$, '', ''],
    array['valeur', '86. deux versions chaînées, chacune sa ventilation : rien n''est réécrit', 'postgres', $q$select count(*) || ':' || (select count(*) from pieces_hors_de_france_taux t join pieces_hors_de_france f on f.id = t.fiche_id where f.piece_id = '{P1}') || ':' || (select numero from pieces_hors_de_france where id = '{F1}') || ':' || (select numero from pieces_hors_de_france where id = '{F1B}') from pieces_hors_de_france where piece_id = '{P1}'$q$, '',
      '2:2:INV-2026-001:INV-2026-0001'],
    array['controle', '87. remplacer une version qui ne l''est plus : relire', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P1}', '{F1}', 'INV-2026-0002', '2026-03-10', '380', null, null, 'IE', '0223', 'IE6388047V', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":120,"tva":0}]'::jsonb)$q$,
      '22023', 'Une autre fiche a été enregistrée pour cette pièce depuis : relire avant d''enregistrer.'],
    array['controle', '88. l''ancienne version de F1 ne garde plus la facture : la nouvelle, si', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P8}', null, 'INV-2026-0001', '2026-03-10', '380', null, null, 'IE', '0223', 'IE6388047V', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":120,"tva":0}]'::jsonb)$q$,
      '22023', 'Cette facture a déjà une fiche, sur une autre pièce du dossier : une facture ne se déclare qu''une fois.'],
    array['controle', '88b. et l''ancien numéro est libre', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P8}', null, 'INV-2026-001', '2026-03-10', '380', null, null, 'IE', '0223', 'IE6388047V', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":120,"tva":0}]'::jsonb)$q$, 'OK', ''],
    array['fait', '89. F2 retirée : la pièce n''était pas un achat à l''étranger', 'chef', $q$select retirer_fiche_hors_de_france('{T}', '{F2}')$q$, 'OK', ''],
    array['valeur', '90. retirée par le chef, et toujours là', 'postgres', $q$select (retire_le is not null)::text || ':' || (retire_par = '{CHEF}')::text || ':' || count(*) over () from pieces_hors_de_france where id = '{F2}'$q$, '', 'true:true:1'],
    array['controle', '91. déjà retirée', 'chef', $q$select retirer_fiche_hors_de_france('{T}', '{F2}')$q$, '22023', 'Cette fiche est déjà retirée.'],
    array['controle', '92. une version remplacée ne se retire pas', 'chef', $q$select retirer_fiche_hors_de_france('{T}', '{F1}')$q$, '22023', 'Cette fiche a été remplacée depuis : relire avant de la retirer.'],
    array['controle', '93. une fiche introuvable dans ce dossier', 'chef', $q$select retirer_fiche_hors_de_france('{A}', '{F1B}')$q$, 'P0002', 'Fiche introuvable dans ce dossier.'],
    array['controle', '94. le client ne retire pas', 'client', $q$select retirer_fiche_hors_de_france('{T}', '{F1B}')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '94b. l''anonyme n''a pas le droit d''appeler', 'anon', $q$select retirer_fiche_hors_de_france('{T}', '{F1B}')$q$, '42501', 'permission denied for function retirer_fiche_hors_de_france'],
    array['controle', '95. la fiche retirée d''une autre pièce ne garde pas sa facture', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{PA}', null, 'US-778', '2026-04-02', '380', null, null, 'US', '0227', 'USACME SOFTWARE IN', 'services', true, null, null, null, '[{"code":"O","taux":0,"base":40,"tva":0}]'::jsonb)$q$, 'OK', ''],
    array['fait', '96. réversible : la fiche retirée se remplace par une nouvelle', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P2}', '{F2}', 'US-778', '2026-04-02', '380', null, null, 'US', '0227', 'USACME SOFTWARE IN', 'services', true, null, null, null, '[{"code":"O","taux":0,"base":99.99,"tva":0}]'::jsonb)$q$, 'OK', ''],
    array['valeur', '97. la nouvelle n''est pas retirée, l''ancienne le reste', 'postgres', $q$select string_agg((remplace_id is null)::text || ':' || (retire_le is null)::text, ',' order by (remplace_id is null) desc) from pieces_hors_de_france where piece_id = '{P2}'$q$, '', 'true:false,false:true'],
    array['controle', '98. et sa facture se garde de nouveau', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{PA}', null, 'US-778', '2026-04-02', '380', null, null, 'US', '0227', 'USACME SOFTWARE IN', 'services', true, null, null, null, '[{"code":"O","taux":0,"base":40,"tva":0}]'::jsonb)$q$,
      '22023', 'Cette facture a déjà une fiche, sur une autre pièce du dossier : une facture ne se déclare qu''une fois.'],

    -- ══ 100 à 112. Qui lit, qui écrit en direct ══════════
    array['fait', '100. une fiche dans le dossier du client, par le chef', 'chef', $q$select enregistrer_fiche_hors_de_france('{DC}', '{PC}', null, 'INV-C-1', '2026-03-10', '380', null, null, 'IE', '0223', 'IE6388047V', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":10,"tva":0}]'::jsonb)$q$, 'OK', ''],
    array['retenir', 'FC', 'postgres', $q$select id::text from pieces_hors_de_france where piece_id = '{PC}'$q$, '', ''],
    array['lecture', '101. le client ne lit aucune fiche, pas même celle d''une pièce de son dossier', 'client', $q$select (select count(*) from pieces_hors_de_france) || ':' || (select count(*) from pieces_hors_de_france_taux)$q$, '', '0:0'],
    array['lecture', '102. le compte rattaché à rien non plus', 'inconnu', $q$select (select count(*) from pieces_hors_de_france) || ':' || (select count(*) from pieces_hors_de_france_taux)$q$, '', '0:0'],
    array['lecture', '103. l''anonyme non plus', 'anon', $q$select (select count(*) from pieces_hors_de_france) || ':' || (select count(*) from pieces_hors_de_france_taux)$q$, '', '0:0'],
    array['lecture', '104. le membre affecté à T en lit les fiches, et elles seules', 'membre', $q$select (select count(*) from pieces_hors_de_france where dossier_id = '{T}') || ':' || (select count(*) from pieces_hors_de_france where dossier_id <> '{T}') || ':' || (select count(*) from pieces_hors_de_france_taux where dossier_id = '{T}')$q$, '', '5:0:5'],
    array['lecture', '105. le membre affecté à un autre dossier n''en lit aucune de T', 'membre_ailleurs', $q$select (select count(*) from pieces_hors_de_france where dossier_id = '{T}') || ':' || (select count(*) from pieces_hors_de_france_taux where dossier_id = '{T}')$q$, '', '0:0'],
    array['controle', '106. le membre affecté au dossier enregistre une fiche', 'membre', $q$select enregistrer_fiche_hors_de_france('{T}', '{PB}', null, 'B-1', '2026-03-20', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":70,"tva":0}]'::jsonb)$q$, 'OK', ''],
    array['controle', '107. un chef du cabinet qui n''est pas super-administrateur enregistre aussi', 'chef_simple', $q$select enregistrer_fiche_hors_de_france('{T}', '{PB}', null, 'B-1', '2026-03-20', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":70,"tva":0}]'::jsonb)$q$, 'OK', ''],
    array['controle', '108. le client n''écrit pas en direct, même sur sa pièce', 'client', $q$insert into pieces_hors_de_france (dossier_id, piece_id, numero, date_facture, type_document, devise, pays, schema_identifiant, identifiant, nature, autoliquidation) values ('{DC}', '{PC2}', 'C-2', '2026-03-11', '380', 'EUR', 'IE', '0223', 'IE6388047V', 'services', true)$q$,
      '42501', 'new row violates row-level security policy for table "pieces_hors_de_france"'],
    array['controle', '109. le membre affecté n''écrit pas en direct : la fonction seule', 'membre', $q$insert into pieces_hors_de_france (dossier_id, piece_id, numero, date_facture, type_document, devise, pays, schema_identifiant, identifiant, nature, autoliquidation) values ('{T}', '{PB}', 'B-2', '2026-03-20', '380', 'EUR', 'DE', '0223', 'DE123456789', 'services', true)$q$,
      '42501', 'new row violates row-level security policy for table "pieces_hors_de_france"'],
    array['controle', '110. ni le chef qui n''est pas super-administrateur', 'chef_simple', $q$insert into pieces_hors_de_france (dossier_id, piece_id, numero, date_facture, type_document, devise, pays, schema_identifiant, identifiant, nature, autoliquidation) values ('{T}', '{PB}', 'B-2', '2026-03-20', '380', 'EUR', 'DE', '0223', 'DE123456789', 'services', true)$q$,
      '42501', 'new row violates row-level security policy for table "pieces_hors_de_france"'],
    array['controle', '110b. ni sa ventilation', 'membre', $q$insert into pieces_hors_de_france_taux (fiche_id, dossier_id, code_tva, taux, base, tva) values ('{F1B}', '{T}', 'K', 0, 1, 0)$q$,
      '42501', 'new row violates row-level security policy for table "pieces_hors_de_france_taux"'],
    array['controle', '111. la porte de la restauration : le super-administrateur insère une fiche, et sa ventilation', 'chef', $q$with f as (insert into pieces_hors_de_france (id, dossier_id, piece_id, numero, date_facture, type_document, devise, pays, schema_identifiant, identifiant, nature, autoliquidation, cree_le) values ('{FD}', '{T}', '{PB}', 'B-3', '2026-03-20', '380', 'EUR', 'DE', '0223', 'DE123456789', 'services', true, '2026-03-21T10:00:00Z') returning id) insert into pieces_hors_de_france_taux (fiche_id, dossier_id, code_tva, taux, base, tva) select id, '{T}', 'AE', 0, 70, 0 from f$q$, 'OK', ''],
    array['controle', '112. le client ne modifie pas une fiche de son dossier : aucune ligne touchée', 'client', $q$do $m$ declare n int; begin update pieces_hors_de_france set numero = 'X' where dossier_id = '{DC}'; get diagnostics n = row_count; if n <> 0 then raise exception 'ÉCRITURE ACCEPTÉE' using errcode = '42501'; end if; end $m$$q$, 'OK', ''],

    -- ══ 115 à 129. Ce que les gardes et les contraintes tiennent sans la fonction ══════════
    array['controle', '115. une fiche ne se modifie pas, même par le propriétaire', 'postgres', $q$update pieces_hors_de_france set numero = 'AUTRE' where id = '{F1B}'$q$,
      '23514', 'Une fiche « hors de France » ne se modifie pas : elle se remplace par une nouvelle, ou se retire, une fois.'],
    array['controle', '116. un retrait ne se défait pas', 'postgres', $q$update pieces_hors_de_france set retire_le = null, retire_par = null where id = '{F2}'$q$,
      '23514', 'Une fiche « hors de France » ne se modifie pas : elle se remplace par une nouvelle, ou se retire, une fois.'],
    array['controle', '115b. un retrait qui modifie autre chose', 'postgres', $q$update pieces_hors_de_france set retire_le = now(), numero = 'AUTRE' where id = '{F1B}'$q$,
      '23514', 'Une fiche « hors de France » ne se modifie pas : elle se remplace par une nouvelle, ou se retire, une fois.'],
    array['controle', '116b. un retrait ne se redate pas', 'postgres', $q$update pieces_hors_de_france set retire_le = retire_le + interval '1 day' where id = '{F2}'$q$,
      '23514', 'Une fiche « hors de France » ne se modifie pas : elle se remplace par une nouvelle, ou se retire, une fois.'],
    array['controle', '116c. une écriture qui ne retire rien n''est pas un retrait', 'postgres', $q$update pieces_hors_de_france set retire_le = null where id = '{F1B}'$q$,
      '23514', 'Une fiche « hors de France » ne se modifie pas : elle se remplace par une nouvelle, ou se retire, une fois.'],
    array['controle', '117. seule la fiche courante se retire', 'postgres', $q$update pieces_hors_de_france set retire_le = now() where id = '{F1}'$q$,
      '23514', 'Seule la fiche courante d''une pièce se retire.'],
    array['controle', '118. la ventilation ne se modifie pas', 'postgres', $q$update pieces_hors_de_france_taux set base = 121 where fiche_id = '{F1B}'$q$,
      '23514', 'La ventilation d''une fiche « hors de France » ne se modifie pas : la fiche se remplace.'],
    array['controle', '119. une ligne de ventilation appartient à une fiche de son dossier', 'postgres', $q$insert into pieces_hors_de_france_taux (fiche_id, dossier_id, code_tva, taux, base, tva) values ('{F1B}', '{A}', 'K', 0, 1, 0)$q$,
      '23514', 'Une ligne de ventilation appartient à une fiche de son dossier.'],
    array['controle', '120. une fiche décrit une pièce de son dossier', 'postgres', $q$insert into pieces_hors_de_france (dossier_id, piece_id, numero, date_facture, type_document, devise, pays, schema_identifiant, identifiant, nature, autoliquidation) values ('{T}', '{PX}', 'X-1', '2026-03-10', '380', 'EUR', 'DE', '0223', 'DE123456789', 'services', true)$q$,
      '23514', 'Une fiche « hors de France » décrit une pièce de son dossier.'],
    array['controle', '121. une fiche en remplace une de la même pièce', 'postgres', $q$insert into pieces_hors_de_france (dossier_id, piece_id, remplace_id, numero, date_facture, type_document, devise, pays, schema_identifiant, identifiant, nature, autoliquidation) values ('{T}', '{P9}', '{F1B}', 'X-2', '2026-03-18', '380', 'EUR', 'DE', '0223', 'DE123456789', 'services', true)$q$,
      '23514', 'Une fiche en remplace une de la même pièce.'],
    array['controle', '122. une seule première fiche par pièce', 'postgres', $q$insert into pieces_hors_de_france (dossier_id, piece_id, numero, date_facture, type_document, devise, pays, schema_identifiant, identifiant, nature, autoliquidation) values ('{T}', '{P1}', 'X-3', '2026-03-10', '380', 'EUR', 'IE', '0223', 'IE6388047V', 'services', true)$q$,
      '23505', '%"pieces_hors_de_france_une_premiere"'],
    array['controle', '123. une seule suite par fiche', 'postgres', $q$insert into pieces_hors_de_france (dossier_id, piece_id, remplace_id, numero, date_facture, type_document, devise, pays, schema_identifiant, identifiant, nature, autoliquidation) values ('{T}', '{P1}', '{F1}', 'X-4', '2026-03-10', '380', 'EUR', 'IE', '0223', 'IE6388047V', 'services', true)$q$,
      '23505', '%"pieces_hors_de_france_une_suite"'],
    array['controle', '124. une pièce qui a une fiche ne change pas de dossier', 'postgres', $q$update pieces set dossier_id = '{A}' where id = '{P1}'$q$,
      '23514', 'Cette pièce a une fiche « hors de France » : elle ne change plus de dossier.'],
    array['controle', '124b. une pièce sans fiche, si', 'postgres', $q$update pieces set dossier_id = '{A}' where id = '{P5}'$q$, 'OK', ''],
    array['controle', '124c. une écriture de la pièce qui reprend son dossier sans le changer passe', 'postgres', $q$update pieces set dossier_id = dossier_id, notes = 'essai' where id = '{P1}'$q$, 'OK', ''],
    array['controle', '125. le numéro suit G1.05, sans la fonction', 'postgres', $q$insert into pieces_hors_de_france (dossier_id, piece_id, numero, date_facture, type_document, devise, pays, schema_identifiant, identifiant, nature, autoliquidation) values ('{T}', '{P9}', 'INV.9', '2026-03-18', '380', 'EUR', 'DE', '0223', 'DE123456789', 'services', true)$q$,
      '23514', '%"pieces_hors_de_france_numero"'],
    array['controle', '126. jamais la France, sans la fonction', 'postgres', $q$insert into pieces_hors_de_france (dossier_id, piece_id, numero, date_facture, type_document, devise, pays, schema_identifiant, identifiant, nature, autoliquidation) values ('{T}', '{P9}', 'INV-9', '2026-03-18', '380', 'EUR', 'FR', '0223', 'FR12345678901', 'services', true)$q$,
      '23514', '%"pieces_hors_de_france_pays"'],
    array['controle', '127. un avoir cite sa facture d''origine, sans la fonction', 'postgres', $q$insert into pieces_hors_de_france (dossier_id, piece_id, numero, date_facture, type_document, devise, pays, schema_identifiant, identifiant, nature, autoliquidation) values ('{T}', '{P9}', 'AV-9', '2026-03-18', '381', 'EUR', 'DE', '0223', 'DE123456789', 'services', true)$q$,
      '23514', '%"pieces_hors_de_france_origine"'],
    array['controle', '128. sans TVA facturée, taux et TVA nuls, sans la fonction', 'postgres', $q$insert into pieces_hors_de_france_taux (fiche_id, dossier_id, code_tva, taux, base, tva) values ('{F1B}', '{T}', 'K', 20, 1, 0)$q$,
      '23514', '%"pieces_hors_de_france_taux_sans_tva"'],
    array['controle', '128b. une exonération porte son motif, sans la fonction', 'postgres', $q$insert into pieces_hors_de_france_taux (fiche_id, dossier_id, code_tva, taux, base, tva) values ('{F1B}', '{T}', 'E', 0, 1, 0)$q$,
      '23514', '%"pieces_hors_de_france_taux_motif_exoneration"'],
    array['controle', '128c. un taux normal est positif, sans la fonction', 'postgres', $q$insert into pieces_hors_de_france_taux (fiche_id, dossier_id, code_tva, taux, base, tva) values ('{F1B}', '{T}', 'S', 0, 1, 0)$q$,
      '23514', '%"pieces_hors_de_france_taux_normal"'],
    array['controle', '128d. une ligne au taux normal s''inscrit sans la fonction : la table l''admet, la fonction la refuse (hypothèse Q7)', 'postgres', $q$insert into pieces_hors_de_france_taux (fiche_id, dossier_id, code_tva, taux, base, tva) values ('{F1B}', '{T}', 'S', 20, 10, 2)$q$, 'OK', ''],
    array['controle', '129a. la date de la facture, entre 2000 et 2099, sans la fonction', 'postgres', $q$insert into pieces_hors_de_france (dossier_id, piece_id, numero, date_facture, type_document, facture_origine_numero, facture_origine_date, devise, pays, schema_identifiant, identifiant, nature, autoliquidation, date_operation, periode_debut, periode_fin) values ('{T}', '{P9}', 'INV-9', '1999-12-31', '380', null, null, 'EUR', 'DE', '0223', 'DE123456789', 'services', true, null, null, null)$q$,
      '23514', '%"pieces_hors_de_france_date_facture"'],
    array['controle', '129b. un type de G1.01, sans la fonction', 'postgres', $q$insert into pieces_hors_de_france (dossier_id, piece_id, numero, date_facture, type_document, facture_origine_numero, facture_origine_date, devise, pays, schema_identifiant, identifiant, nature, autoliquidation, date_operation, periode_debut, periode_fin) values ('{T}', '{P9}', 'INV-9', '2026-03-18', '999', null, null, 'EUR', 'DE', '0223', 'DE123456789', 'services', true, null, null, null)$q$,
      '23514', '%"pieces_hors_de_france_type_document"'],
    array['controle', '129c. une devise en trois capitales, sans la fonction', 'postgres', $q$insert into pieces_hors_de_france (dossier_id, piece_id, numero, date_facture, type_document, facture_origine_numero, facture_origine_date, devise, pays, schema_identifiant, identifiant, nature, autoliquidation, date_operation, periode_debut, periode_fin) values ('{T}', '{P9}', 'INV-9', '2026-03-18', '380', null, null, 'eur', 'DE', '0223', 'DE123456789', 'services', true, null, null, null)$q$,
      '23514', '%"pieces_hors_de_france_devise"'],
    array['controle', '129d. un schéma 0223 ou 0227, sans la fonction', 'postgres', $q$insert into pieces_hors_de_france (dossier_id, piece_id, numero, date_facture, type_document, facture_origine_numero, facture_origine_date, devise, pays, schema_identifiant, identifiant, nature, autoliquidation, date_operation, periode_debut, periode_fin) values ('{T}', '{P9}', 'INV-9', '2026-03-18', '380', null, null, 'EUR', 'DE', '0002', 'DE123456789', 'services', true, null, null, null)$q$,
      '23514', '%"pieces_hors_de_france_schema"'],
    array['controle', '129e. un identifiant sans blanc en tête, sans la fonction', 'postgres', $q$insert into pieces_hors_de_france (dossier_id, piece_id, numero, date_facture, type_document, facture_origine_numero, facture_origine_date, devise, pays, schema_identifiant, identifiant, nature, autoliquidation, date_operation, periode_debut, periode_fin) values ('{T}', '{P9}', 'INV-9', '2026-03-18', '380', null, null, 'EUR', 'DE', '0223', ' DE123456789', 'services', true, null, null, null)$q$,
      '23514', '%"pieces_hors_de_france_identifiant"'],
    array['controle', '129f. une nature connue, sans la fonction', 'postgres', $q$insert into pieces_hors_de_france (dossier_id, piece_id, numero, date_facture, type_document, facture_origine_numero, facture_origine_date, devise, pays, schema_identifiant, identifiant, nature, autoliquidation, date_operation, periode_debut, periode_fin) values ('{T}', '{P9}', 'INV-9', '2026-03-18', '380', null, null, 'EUR', 'DE', '0223', 'DE123456789', 'logiciel', true, null, null, null)$q$,
      '23514', '%"pieces_hors_de_france_nature"'],
    array['controle', '129g. une date de livraison avant 2100, sans la fonction', 'postgres', $q$insert into pieces_hors_de_france (dossier_id, piece_id, numero, date_facture, type_document, facture_origine_numero, facture_origine_date, devise, pays, schema_identifiant, identifiant, nature, autoliquidation, date_operation, periode_debut, periode_fin) values ('{T}', '{P9}', 'INV-9', '2026-03-18', '380', null, null, 'EUR', 'DE', '0223', 'DE123456789', 'services', true, '2100-01-01', null, null)$q$,
      '23514', '%"pieces_hors_de_france_date_operation"'],
    array['controle', '129h. un début de période après 1999, sans la fonction', 'postgres', $q$insert into pieces_hors_de_france (dossier_id, piece_id, numero, date_facture, type_document, facture_origine_numero, facture_origine_date, devise, pays, schema_identifiant, identifiant, nature, autoliquidation, date_operation, periode_debut, periode_fin) values ('{T}', '{P9}', 'INV-9', '2026-03-18', '380', null, null, 'EUR', 'DE', '0223', 'DE123456789', 'services', true, null, '1999-01-01', '2026-01-31')$q$,
      '23514', '%"pieces_hors_de_france_periode_debut"'],
    array['controle', '129i. une fin de période avant 2100, sans la fonction', 'postgres', $q$insert into pieces_hors_de_france (dossier_id, piece_id, numero, date_facture, type_document, facture_origine_numero, facture_origine_date, devise, pays, schema_identifiant, identifiant, nature, autoliquidation, date_operation, periode_debut, periode_fin) values ('{T}', '{P9}', 'INV-9', '2026-03-18', '380', null, null, 'EUR', 'DE', '0223', 'DE123456789', 'services', true, null, '2026-01-01', '2100-01-01')$q$,
      '23514', '%"pieces_hors_de_france_periode_fin"'],
    array['controle', '129j. une période entière, sans la fonction', 'postgres', $q$insert into pieces_hors_de_france (dossier_id, piece_id, numero, date_facture, type_document, facture_origine_numero, facture_origine_date, devise, pays, schema_identifiant, identifiant, nature, autoliquidation, date_operation, periode_debut, periode_fin) values ('{T}', '{P9}', 'INV-9', '2026-03-18', '380', null, null, 'EUR', 'DE', '0223', 'DE123456789', 'services', true, null, '2026-03-01', null)$q$,
      '23514', '%"pieces_hors_de_france_periode"'],
    array['controle', '129k. une livraison ou une période, sans la fonction', 'postgres', $q$insert into pieces_hors_de_france (dossier_id, piece_id, numero, date_facture, type_document, facture_origine_numero, facture_origine_date, devise, pays, schema_identifiant, identifiant, nature, autoliquidation, date_operation, periode_debut, periode_fin) values ('{T}', '{P9}', 'INV-9', '2026-03-18', '380', null, null, 'EUR', 'DE', '0223', 'DE123456789', 'services', true, '2026-03-18', '2026-03-01', '2026-03-31')$q$,
      '23514', '%"pieces_hors_de_france_livraison_ou_periode"'],
    array['controle', '129l. une facture rectificative (384) cite aussi sa facture d''origine, sans la fonction', 'postgres', $q$insert into pieces_hors_de_france (dossier_id, piece_id, numero, date_facture, type_document, facture_origine_numero, facture_origine_date, devise, pays, schema_identifiant, identifiant, nature, autoliquidation, date_operation, periode_debut, periode_fin) values ('{T}', '{P9}', 'INV-9', '2026-03-18', '384', null, null, 'EUR', 'DE', '0223', 'DE123456789', 'services', true, null, null, null)$q$,
      '23514', '%"pieces_hors_de_france_origine"'],
    array['controle', '129m. un numéro de facture d''origine selon G1.05, sans la fonction', 'postgres', $q$insert into pieces_hors_de_france (dossier_id, piece_id, numero, date_facture, type_document, facture_origine_numero, facture_origine_date, devise, pays, schema_identifiant, identifiant, nature, autoliquidation, date_operation, periode_debut, periode_fin) values ('{T}', '{P9}', 'INV-9', '2026-03-18', '381', 'F.1', '2026-03-10', 'EUR', 'DE', '0223', 'DE123456789', 'services', true, null, null, null)$q$,
      '23514', '%"pieces_hors_de_france_origine_numero"'],
    array['controle', '129n. une date de facture d''origine après 1999, sans la fonction', 'postgres', $q$insert into pieces_hors_de_france (dossier_id, piece_id, numero, date_facture, type_document, facture_origine_numero, facture_origine_date, devise, pays, schema_identifiant, identifiant, nature, autoliquidation, date_operation, periode_debut, periode_fin) values ('{T}', '{P9}', 'INV-9', '2026-03-18', '381', 'F-1', '1999-12-31', 'EUR', 'DE', '0223', 'DE123456789', 'services', true, null, null, null)$q$,
      '23514', '%"pieces_hors_de_france_origine_date"'],
    array['controle', '129o. un code de G2.31, sans la fonction', 'postgres', $q$insert into pieces_hors_de_france_taux (fiche_id, dossier_id, code_tva, taux, base, tva, motif_code, motif_texte) values ('{F1B}', '{T}', 'L', 0, 1, 0, null, null)$q$,
      '23514', '%"pieces_hors_de_france_taux_code"'],
    array['controle', '129p. un taux de G1.24, sans la fonction', 'postgres', $q$insert into pieces_hors_de_france_taux (fiche_id, dossier_id, code_tva, taux, base, tva, motif_code, motif_texte) values ('{F1B}', '{T}', 'S', 21, 10, 2.1, null, null)$q$,
      '23514', '%"pieces_hors_de_france_taux_taux"'],
    array['controle', '129q. une base positive, sans la fonction', 'postgres', $q$insert into pieces_hors_de_france_taux (fiche_id, dossier_id, code_tva, taux, base, tva, motif_code, motif_texte) values ('{F1B}', '{T}', 'K', 0, 0, 0, null, null)$q$,
      '23514', '%"pieces_hors_de_france_taux_base"'],
    array['controle', '129r. une TVA positive ou nulle, sans la fonction', 'postgres', $q$insert into pieces_hors_de_france_taux (fiche_id, dossier_id, code_tva, taux, base, tva, motif_code, motif_texte) values ('{F1B}', '{T}', 'S', 20, 10, -1, null, null)$q$,
      '23514', '%"pieces_hors_de_france_taux_tva"'],
    array['controle', '129s. un code de motif VATEX, sans la fonction', 'postgres', $q$insert into pieces_hors_de_france_taux (fiche_id, dossier_id, code_tva, taux, base, tva, motif_code, motif_texte) values ('{F1B}', '{T}', 'K', 0, 1, 0, 'EXO-1', 'Motif')$q$,
      '23514', '%"pieces_hors_de_france_taux_motif_code"'],
    array['controle', '129t. un libellé de motif qui n''est pas fait de blancs, sans la fonction', 'postgres', $q$insert into pieces_hors_de_france_taux (fiche_id, dossier_id, code_tva, taux, base, tva, motif_code, motif_texte) values ('{F1B}', '{T}', 'K', 0, 1, 0, 'VATEX-EU-IC', '   ')$q$,
      '23514', '%"pieces_hors_de_france_taux_motif_texte"'],
    array['controle', '129u. un taux zéro sans motif, sans la fonction', 'postgres', $q$insert into pieces_hors_de_france_taux (fiche_id, dossier_id, code_tva, taux, base, tva, motif_code, motif_texte) values ('{F1B}', '{T}', 'Z', 0, 1, 0, null, 'Motif')$q$,
      '23514', '%"pieces_hors_de_france_taux_sans_motif"'],
    array['controle', '129v. une ligne par code et par taux, sans la fonction', 'postgres', $q$insert into pieces_hors_de_france_taux (fiche_id, dossier_id, code_tva, taux, base, tva, motif_code, motif_texte) values ('{F1B}', '{T}', 'AE', 0, 1, 0, null, null)$q$,
      '23505', '%"pieces_hors_de_france_taux_pkey"'],

    -- ══ 130 à 139. Ce que la validation fige ══════════
    array['fait', '130. V : la fiche de PV, avant la validation', 'chef', $q$select enregistrer_fiche_hors_de_france('{V}', '{PV}', null, 'V-1', '2025-06-10', '380', null, null, 'DE', '0223', 'DE123456789', 'biens', true, null, null, null, '[{"code":"K","taux":0,"base":100,"tva":0}]'::jsonb)$q$, 'OK', ''],
    array['fait', '130b. V : la fiche de PI, la pièce du bien', 'chef', $q$select enregistrer_fiche_hors_de_france('{V}', '{PI}', null, 'V-3', '2025-08-10', '380', null, null, 'DE', '0223', 'DE123456789', 'biens', true, null, null, null, '[{"code":"K","taux":0,"base":1000,"tva":0}]'::jsonb)$q$, 'OK', ''],
    array['retenir', 'FV', 'postgres', $q$select id::text from pieces_hors_de_france where piece_id = '{PV}'$q$, '', ''],
    array['retenir', 'FI', 'postgres', $q$select id::text from pieces_hors_de_france where piece_id = '{PI}'$q$, '', ''],
    array['fait', '131. V : la validation de 2025', 'chef', $q$select valider_exercice('{V}', 2025, (select jsonb_agg(jsonb_build_object('id', e.id, 'journal', case when e.immobilisation_id is null then 'AC' else 'OD' end,
        'numero', case e.piece_id when '{PV}' then 1 when '{PV2}' then 2 else 1 end, 'piece_ref', 'ESSAI ' || coalesce(e.piece_id::text, 'DOTATION'),
        'piece_date', e.date, 'compte_lib', case e.compte when '606100' then 'Achats' when '401000' then 'Fournisseurs' when '681100' then 'Dotations' else 'Amortissements' end))
      from ecritures_brouillon e where e.dossier_id = '{V}' and e.date <= '2025-12-31'), '[]'::jsonb, '{}'::jsonb)$q$, 'OK', ''],
    array['controle', '132. la fiche d''une pièce figée ne se remplace plus', 'chef', $q$select enregistrer_fiche_hors_de_france('{V}', '{PV}', '{FV}', 'V-1B', '2025-06-10', '380', null, null, 'DE', '0223', 'DE123456789', 'biens', true, null, null, null, '[{"code":"K","taux":0,"base":100,"tva":0}]'::jsonb)$q$,
      '22023', 'Cette pièce porte une écriture validée de l''exercice 2025 : sa fiche ne change plus.'],
    array['controle', '133. une pièce figée ne reçoit pas de première fiche', 'chef', $q$select enregistrer_fiche_hors_de_france('{V}', '{PV2}', null, 'V-2', '2025-07-10', '380', null, null, 'DE', '0223', 'DE123456789', 'biens', true, null, null, null, '[{"code":"K","taux":0,"base":50,"tva":0}]'::jsonb)$q$,
      '22023', 'Cette pièce porte une écriture validée de l''exercice 2025 : sa fiche ne change plus.'],
    array['controle', '134. la pièce d''un bien que fige sa dotation validée', 'chef', $q$select enregistrer_fiche_hors_de_france('{V}', '{PI}', '{FI}', 'V-3B', '2025-08-10', '380', null, null, 'DE', '0223', 'DE123456789', 'biens', true, null, null, null, '[{"code":"K","taux":0,"base":1000,"tva":0}]'::jsonb)$q$,
      '22023', 'Cette pièce porte une écriture validée de l''exercice 2025 : sa fiche ne change plus.'],
    array['controle', '135. ni ne se retire', 'chef', $q$select retirer_fiche_hors_de_france('{V}', '{FV}')$q$,
      '22023', 'Cette pièce porte une écriture validée de l''exercice 2025 : sa fiche ne se retire plus.'],
    array['controle', '136. ni en direct', 'postgres', $q$insert into pieces_hors_de_france (dossier_id, piece_id, remplace_id, numero, date_facture, type_document, devise, pays, schema_identifiant, identifiant, nature, autoliquidation) values ('{V}', '{PV}', '{FV}', 'V-1C', '2025-06-10', '380', 'EUR', 'DE', '0223', 'DE123456789', 'biens', true)$q$,
      '23514', 'Cette pièce porte une écriture validée de l''exercice 2025 : sa fiche ne change plus.'],
    array['controle', '137. ni son retrait en direct', 'postgres', $q$update pieces_hors_de_france set retire_le = now() where id = '{FV}'$q$,
      '23514', 'Cette pièce porte une écriture validée de l''exercice 2025 : sa fiche ne se retire plus.'],
    array['controle', '138. la pièce aussi est figée : la règle est la même', 'postgres', $q$update pieces set montant_ttc = 101 where id = '{PV}'$q$,
      '23514', 'Cette pièce porte une écriture validée de l''exercice 2025 : ses montants, sa date et sa catégorie ne changent plus.'],
    array['controle', '138b. le client du dossier V n''apprend pas qu''une de ses pièces est figée : la RLS parle avant le gel', 'client_v', $q$insert into pieces_hors_de_france (dossier_id, piece_id, numero, date_facture, type_document, devise, pays, schema_identifiant, identifiant, nature, autoliquidation) values ('{V}', '{PV2}', 'V-2', '2025-07-10', '380', 'EUR', 'DE', '0223', 'DE123456789', 'biens', true)$q$,
      '42501', 'new row violates row-level security policy for table "pieces_hors_de_france"'],
    array['controle', '138c. ni par la fonction', 'client_v', $q$select enregistrer_fiche_hors_de_france('{V}', '{PV2}', null, 'V-2', '2025-07-10', '380', null, null, 'DE', '0223', 'DE123456789', 'biens', true, null, null, null, '[{"code":"K","taux":0,"base":50,"tva":0}]'::jsonb)$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['lecture', '138d. ni en lisant les fiches de son dossier', 'client_v', $q$select (select count(*) from pieces_hors_de_france where dossier_id = '{V}') || ':' || (select count(*) from pieces where dossier_id = '{V}')$q$, '', '0:3'],
    array['valeur', '139. l''exercice qui fige : PV par son écriture, PI par son bien, P1 rien', 'postgres', $q$select coalesce(exercice_figeant_la_piece('{PV}')::text, '-') || ':' || coalesce(exercice_figeant_la_piece('{PI}')::text, '-') || ':' || coalesce(exercice_figeant_la_piece('{P1}')::text, '-')$q$, '', '2025:2025:-'],

    -- ══ 140 à 147. Les mutations : chacune doit MORDRE ══════════
    array['lecture', '140. MUTATION — le contrôle 101 sans le changement de rôle : il doit voir les fiches', 'postgres', $q$select ((select count(*) from pieces_hors_de_france where dossier_id = '{DC}') > 0)::text$q$, '', 'true'],
    array['controle', '141. MUTATION — le contrôle 4 joué sous le chef : il doit passer', 'chef', $q$select enregistrer_fiche_hors_de_france('{DC}', '{PC}', '{FC}', 'INV-C-1', '2026-03-10', '380', null, null, 'IE', '0223', 'IE6388047V', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":10,"tva":0}]'::jsonb)$q$, 'OK', ''],
    array['controle', '142. MUTATION — le contrôle 5 affecté au BON dossier : il doit passer', 'membre', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":300,"tva":0}]'::jsonb)$q$, 'OK', ''],
    array['lecture', '143. MUTATION — le contrôle 105 affecté au BON dossier : il doit voir les fiches de T', 'membre', $q$select ((select count(*) from pieces_hors_de_france where dossier_id = '{T}') > 0)::text$q$, '', 'true'],
    array['controle', '144. MUTATION — le contrôle 108 joué sous le chef (super-administrateur) : l''insertion doit passer', 'chef', $q$insert into pieces_hors_de_france (id, dossier_id, piece_id, numero, date_facture, type_document, devise, pays, schema_identifiant, identifiant, nature, autoliquidation) values ('{FE}', '{DC}', '{PC2}', 'C-2', '2026-03-11', '380', 'EUR', 'IE', '0223', 'IE6388047V', 'services', true)$q$, 'OK', ''],
    array['controle', '145. MUTATION — le contrôle 132 sur une pièce que rien ne fige : il doit passer', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'ACHAT-9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'biens', true, null, null, null, '[{"code":"K","taux":0,"base":300,"tva":0}]'::jsonb)$q$, 'OK', ''],
    array['controle', '146. MUTATION — le contrôle 138b joué sous le chef : c''est le gel qui parle', 'chef', $q$insert into pieces_hors_de_france (dossier_id, piece_id, numero, date_facture, type_document, devise, pays, schema_identifiant, identifiant, nature, autoliquidation) values ('{V}', '{PV2}', 'V-2', '2025-07-10', '380', 'EUR', 'DE', '0223', 'DE123456789', 'biens', true)$q$,
      '23514', 'Cette pièce porte une écriture validée de l''exercice 2025 : sa fiche ne change plus.'],
    array['lecture', '147. MUTATION — le contrôle 138d sans le rattachement au dossier : le client ne voit même plus les pièces de V', 'client', $q$select (select count(*) from pieces_hors_de_france where dossier_id = '{V}') || ':' || (select count(*) from pieces where dossier_id = '{V}')$q$, '', '0:0'],

    -- ══ 150 à 156. Ce que le catalogue dit ══════════
    array['valeur', '150. les droits d''exécution (anonyme, connecté)', 'postgres', $q$select string_agg(f || ':' || has_function_privilege('anon', 'public.' || f || a, 'execute') || ':' || has_function_privilege('authenticated', 'public.' || f || a, 'execute'), ',' order by f collate "C") from (values
      ('enregistrer_fiche_hors_de_france', '(uuid, uuid, uuid, text, date, text, text, date, text, text, text, text, boolean, date, date, date, jsonb)'),
      ('retirer_fiche_hors_de_france', '(uuid, uuid)'), ('exercice_figeant_la_piece', '(uuid)'), ('cle_hors_de_france', '(uuid)'),
      ('garder_fiche_hors_de_france', '()'), ('garder_fiche_hors_de_france_taux', '()'), ('garder_piece_hors_de_france', '()')) as t(f, a)$q$, '',
      'cle_hors_de_france:false:false,enregistrer_fiche_hors_de_france:false:true,exercice_figeant_la_piece:false:true,garder_fiche_hors_de_france:false:false,garder_fiche_hors_de_france_taux:false:false,garder_piece_hors_de_france:false:false,retirer_fiche_hors_de_france:false:true'],
    array['valeur', '151. ce qui contourne la RLS, et ce qui ne la contourne pas', 'postgres', $q$select string_agg(proname || ':' || prosecdef, ',' order by proname collate "C") from pg_proc where pronamespace = 'public'::regnamespace and proname in ('enregistrer_fiche_hors_de_france', 'retirer_fiche_hors_de_france', 'exercice_figeant_la_piece', 'cle_hors_de_france', 'garder_fiche_hors_de_france', 'garder_fiche_hors_de_france_taux', 'garder_piece_hors_de_france')$q$, '',
      'cle_hors_de_france:false,enregistrer_fiche_hors_de_france:true,exercice_figeant_la_piece:false,garder_fiche_hors_de_france:false,garder_fiche_hors_de_france_taux:false,garder_piece_hors_de_france:true,retirer_fiche_hors_de_france:true'],
    array['valeur', '152. quatre policies : la lecture sous admin_du_dossier, l''insertion du super-administrateur, aux connectés, aucune branche client', 'postgres', $q$select string_agg(tablename || ':' || policyname || ':' || cmd || ':' || array_to_string(roles, ',') || ':' || coalesce(qual, '-') || ':' || coalesce(with_check, '-'), ',' order by policyname collate "C") from pg_policies where schemaname = 'public' and tablename in ('pieces_hors_de_france', 'pieces_hors_de_france_taux')$q$, '',
      'pieces_hors_de_france:pieces_hors_de_france_lecture:SELECT:authenticated:admin_du_dossier(dossier_id):-,pieces_hors_de_france:pieces_hors_de_france_restauration:INSERT:authenticated:-:is_super_admin(),pieces_hors_de_france_taux:pieces_hors_de_france_taux_lecture:SELECT:authenticated:admin_du_dossier(dossier_id):-,pieces_hors_de_france_taux:pieces_hors_de_france_taux_restauration:INSERT:authenticated:-:is_super_admin()'],
    array['valeur', '153. la RLS est active sur les deux tables', 'postgres', $q$select string_agg(relname || ':' || relrowsecurity, ',' order by relname collate "C") from pg_class where oid in ('public.pieces_hors_de_france'::regclass, 'public.pieces_hors_de_france_taux'::regclass)$q$, '',
      'pieces_hors_de_france:true,pieces_hors_de_france_taux:true'],
    array['valeur', '154. les trois déclencheurs, actifs, et les deux gardes veillent aussi sur la suppression (jouée sur la réplique)', 'postgres', $q$select string_agg(pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text, ' | ' order by t.tgname collate "C") from pg_trigger t where t.tgname in ('pieces_hors_de_france_gardes', 'pieces_hors_de_france_taux_gardes', 'pieces_hors_de_france_dossier') and not t.tgisinternal$q$, '',
      'CREATE TRIGGER pieces_hors_de_france_dossier BEFORE UPDATE OF dossier_id ON public.pieces FOR EACH ROW EXECUTE FUNCTION garder_piece_hors_de_france() O'
      || ' | CREATE TRIGGER pieces_hors_de_france_gardes BEFORE INSERT OR DELETE OR UPDATE ON public.pieces_hors_de_france FOR EACH ROW EXECUTE FUNCTION garder_fiche_hors_de_france() O'
      || ' | CREATE TRIGGER pieces_hors_de_france_taux_gardes BEFORE INSERT OR DELETE OR UPDATE ON public.pieces_hors_de_france_taux FOR EACH ROW EXECUTE FUNCTION garder_fiche_hors_de_france_taux() O'],
    array['valeur', '155. les clés : la fiche part avec sa pièce et son dossier, sa ventilation avec elle', 'postgres', $q$select string_agg(c.conrelid::regclass::text || '.' || a.attname || '>' || c.confrelid::regclass::text || ':' || c.confdeltype::text, ',' order by c.conrelid::regclass::text collate "C", a.attname collate "C") from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1] where c.contype = 'f' and c.conrelid in ('public.pieces_hors_de_france'::regclass, 'public.pieces_hors_de_france_taux'::regclass)$q$, '',
      'pieces_hors_de_france.dossier_id>dossiers:c,pieces_hors_de_france.piece_id>pieces:c,pieces_hors_de_france.remplace_id>pieces_hors_de_france:a,pieces_hors_de_france_taux.dossier_id>dossiers:c,pieces_hors_de_france_taux.fiche_id>pieces_hors_de_france:c'],
    array['valeur', '156. les fonctions qui nomment la fiche : celles de la migration, et elles seules', 'postgres', $q$select string_agg(proname, ',' order by proname collate "C") from pg_proc where pronamespace = 'public'::regnamespace and prosrc ~ 'pieces_hors_de_france'$q$, '',
      'cle_hors_de_france,enregistrer_fiche_hors_de_france,garder_fiche_hors_de_france,garder_fiche_hors_de_france_taux,garder_piece_hors_de_france,retirer_fiche_hors_de_france']
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
        if etape[3] in ('membre', 'membre_ailleurs', 'chef_simple', 'client_v') and etape[1] not in ('controle', 'lecture') then
          raise exception 'ESSAI_MAL_ECRIT : le profil % ne sert qu''à un contrôle ou à une lecture, qui s''annulent', etape[3];
        end if;
        begin
          if etape[3] in ('membre', 'membre_ailleurs') then
            insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable');
            insert into dossier_assignations (dossier_id, user_id)
              values (case etape[3] when 'membre' then (ids ->> 'T')::uuid else (ids ->> 'A')::uuid end, client);
          elsif etape[3] = 'chef_simple' then
            insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable_en_chef');
          elsif etape[3] = 'client_v' then
            insert into memberships (user_id, dossier_id, role) values (client, (ids ->> 'V')::uuid, 'client');
          end if;
          if etape[3] = 'service_role' then
            set local role service_role;
          elsif etape[3] <> 'postgres' then
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
    ((select count(*) from dossiers)), ((select count(*) from pieces)), ((select count(*) from pieces_hors_de_france)),
    ((select count(*) from pieces_hors_de_france_taux)), ((select count(*) from ecritures_brouillon)),
    ((select count(*) from exercices_valides)), ((select count(*) from immobilisations)), ((select count(*) from cabinet_admins)),
    ((select count(*) from dossier_assignations)), ((select count(*) from memberships))
  ) as t(n);
  verdicts := verdicts || jsonb_build_object('controle', '199. rien n''est resté en base',
    'observe', avant || ' -> ' || apres,
    'ok', avant = apres and not exists (select 1 from dossiers where nom like 'ESSAI HORS DE FRANCE%')
      and not exists (select 1 from cabinet_admins where user_id = client));

  perform set_config('essai.hors_de_france', verdicts::text, true);
end $essai$;

-- Un verdict qui n'a pas pu se calculer est une faute, pas un silence. La ligne 0 dit le texte que la base a reçu — par
-- l'outil MCP, qui ajoute sa signature après lui —, pour le comparer au fichier par son empreinte.
select x.controle, x.ok, x.observe from (
  select v.controle, coalesce(v.ok, false) as ok, v.observe
  from jsonb_to_recordset(current_setting('essai.hors_de_france')::jsonb) as v(controle text, ok boolean, observe text)
  union all
  select '0. information : le texte reçu par la base', true, length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by (regexp_match(x.controle, '^(\d+)'))[1]::int, x.controle;
