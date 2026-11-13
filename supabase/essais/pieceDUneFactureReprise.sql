-- LA PIÈCE D'UNE FACTURE REPRISE (ligne 51.5, A8-Q5 ; la migration `piece_d_une_facture_reprise`, PRÉPARÉE le 10/11/2026,
-- supabase/preparees/, après A8a, A9a et A8b). Le récit : HISTORIQUE.md, « 10/11/2026 — A8-Q5 : LA PIÈCE D'UNE FACTURE
-- REPRISE, EN BASE (PRÉPARÉE, PAS APPLIQUÉE) ». À rejouer après toute migration qui touche `pieces_des_factures_reprises`,
-- `citer_piece_de_facture_reprise`, `retirer_piece_de_facture_reprise`, leurs trois gardes, les factures reprises
-- (`factures_importees`, `importer_factures`, `retirer_import`), ou les déclencheurs de `pieces`, `lignes_bancaires`,
-- `reglements_groupes`, `operations_caisse` et `ecritures_brouillon`.
--
-- Ce qui se prouve ici, et ne se relit pas : le lien d'une facture reprise à la pièce de vente qui en est l'original — cité
-- par le chef du cabinet, et par un chef qui n'est pas super-administrateur ; refusé au client « Ventes » et à un compte sans
-- accès, sur une pièce d'achat, sur une pièce d'un autre dossier, sur ce qui n'est pas une facture reprise, sur une facture
-- qui cite déjà une pièce, sur une pièce déjà citée, sur une pièce réglée à la date de reprise ou après, et accepté sur une
-- pièce réglée la veille et sur une pièce figée par une écriture validée (A8Q5-Q1, le 10/11/2026 : ni sa ligne ni l'écriture
-- qui la fige ne changent, à leur `xmin` près) — ; la garde des règlements — tant que le lien vit, le
-- rapprochement, la part d'un virement groupé et l'écriture datés de la reprise ou d'après se refusent, ceux de la veille
-- passent, et après le retrait le rapprochement s'ouvre de nouveau — ; le retrait (au cabinet seul, d'un lien qui vit, sur
-- une pièce que la validation n'a pas figée : la pièce figée garde son lien, qu'elle l'ait reçu figée ou avant) ; la garde du lien (il ne se modifie pas, ne s'insère pas hors de sa fonction ni
-- de la restauration, ne cite qu'une pièce de vente, ni une pièce qu'un règlement d'après la reprise cite) ; la garde de la
-- pièce citée (ni un autre type, ni une désignation) ; le retrait de l'import qui emporte le lien ; ce que le client lit ; le
-- catalogue. Ce qu'une suppression rencontre (la pièce citée qui ne se supprime pas, le dossier qui part avec son lien) se
-- joue sur une réplique, hors de ce fichier.
--
-- Deux dossiers jetables du cabinet du dossier `test` (préfixe `a8c50000-0000-4000-8000`) : DR, basculé, en trésorerie,
-- redevable, dont l'accès du client d'essai porte « Ventes », et DO, son voisin ; la date de reprise de DR, le premier jour
-- du mois de Paris ; son lot, deux factures reprises (`{L}`) ; ses pièces (deux de vente, une d'achat, une de vente que fige
-- une écriture validée), celle de DO ; ses trois mouvements (la veille de la reprise, le jour de la reprise, un virement
-- groupé du jour de la reprise). Chaque étape se joue dans sa sous-transaction et s'y ANNULE (`ANNULATION_ETAPE`) : ce que le
-- chef pose d'abord (`{P}` : la date de reprise et le lot ; `{C}` : la pièce citée), puis la requête du profil ; le jeu
-- s'annule à la fin (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le relit. Les verdicts voyagent dans un réglage
-- LOCAL à la transaction (`essai.piece_d_une_facture_reprise`), que la requête finale lit : le fichier se joue d'un seul
-- appel, ne crée ni table ni fonction, ne contient aucune instruction de suppression, et ne rend rien qui dépende d'une
-- ligne hors de ses dossiers. Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`). Sans la migration, une
-- ligne dit qu'il attend (EN ATTENTE) et rien ne s'écrit.
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  dr constant text := 'a8c50000-0000-4000-8000-0000000000d1';
  dov constant text := 'a8c50000-0000-4000-8000-0000000000d2';
  acces_v constant text := 'a8c50000-0000-4000-8000-0000000000a1';
  pv1 constant text := 'a8c50000-0000-4000-8000-0000000000b1';
  pv2 constant text := 'a8c50000-0000-4000-8000-0000000000b2';
  pa constant text := 'a8c50000-0000-4000-8000-0000000000b3';
  pf constant text := 'a8c50000-0000-4000-8000-0000000000b4';
  po constant text := 'a8c50000-0000-4000-8000-0000000000b5';
  ma constant text := 'a8c50000-0000-4000-8000-0000000000e1';
  mr constant text := 'a8c50000-0000-4000-8000-0000000000e2';
  mg constant text := 'a8c50000-0000-4000-8000-0000000000e3';
  efig constant text := 'a8c50000-0000-4000-8000-0000000000c1';
  -- Un compte connecté qu'aucun accès ni aucun cabinet ne nomme (le profil `inconnu`).
  inconnu constant text := 'a8c50000-0000-4000-8000-0000000000f1';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  -- La date de reprise : le premier jour du mois de Paris, celui de la bascule de DR (posée à son insertion, maintenant).
  reprise constant date := date_trunc('month', now() at time zone 'Europe/Paris')::date;
  -- Le lot : deux factures de services, l'une et l'autre dont le PDF est une pièce de vente de DR.
  lot constant text := '[
    {"numero": "R-PDF-1", "type": "facture", "date_emission": "{AVANT}", "tiers_nom": "Client P", "type_client": "non_assujetti",
     "nature_operation": "services", "option_debits": false, "montant_ht": 100, "montant_tva": 20, "montant_ttc": 120,
     "lignes": [{"designation": "Prestation", "quantite": 1, "prix_unitaire_ht": 100, "taux_tva": 20}], "transmise_par": "pdf"},
    {"numero": "R-PDF-2", "type": "facture", "date_emission": "{AVANT}", "tiers_nom": "Client Q", "type_client": "non_assujetti",
     "nature_operation": "services", "option_debits": false, "montant_ht": 50, "montant_tva": 10, "montant_ttc": 60,
     "lignes": [{"designation": "Séance", "quantite": 1, "prix_unitaire_ht": 50, "taux_tva": 20}], "transmise_par": "pdf"}]';
  poser constant text := $q$select fixer_reprise_des_factures('{DR}', '{R}'); select importer_factures('{DR}', '{"format": "csv"}'::jsonb, '{L}'::jsonb);$q$;
  citer constant text := $q$select citer_piece_de_facture_reprise('{DR}', {F1}, '{PV1}');$q$;
  -- Le message de la garde des règlements, pour un règlement du jour de la reprise.
  refus_reglement text := format('La pièce « essai-a8q5-r-pdf-1.pdf » est l''original de la facture reprise R-PDF-1 : ses règlements datés de la reprise des factures (le %s) ou d''après passent par le registre de la facture, et le règlement du %s ne la cite pas.',
    to_char(reprise, 'DD/MM/YYYY'), to_char(reprise, 'DD/MM/YYYY'));
  e record; v_code text; v_msg text; v_req text; v_pose text; v_obs text; v_texte text; v_f record;
  -- PF et l'écriture validée qui la fige, relues après le jeu (leur ligne entière et son `xmin`) : une citation qui les
  -- réécrirait, même à l'identique, changerait l'un ou l'autre (39).
  pf_avant text; efig_avant text;
  verdicts jsonb := '[]'::jsonb;
begin
  if to_regclass('public.pieces_des_factures_reprises') is null then
    perform set_config('essai.piece_d_une_facture_reprise', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration piece_d_une_facture_reprise', 'ok', true,
      'observe', 'absente : l''essai se joue dès que la migration y est'))::text, true);
    return;
  end if;
  begin
    -- Le jeu : les deux dossiers jetables et l'accès « Ventes » du client d'essai, insérés par le propriétaire comme
    -- `create-client-access` les insère ; les pièces et les mouvements, comme le dépôt et l'import d'un relevé.
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, ventes_par_les_factures, statut_tva, siret,
                          adresse, forme_juridique, denomination_imprimee) values
      (dr::uuid, 'ESSAI A8Q5 DR', cabinet, 'tresorerie', '455000', true, 'redevable', '12345678200010',
       'ESSAI A8Q5 ADRESSE DR', '5710', 'ESSAI A8Q5 SOCIÉTÉ DR'),
      (dov::uuid, 'ESSAI A8Q5 DO', cabinet, 'tresorerie', '455000', false, 'redevable', null, null, null, null);
    insert into memberships (id, user_id, dossier_id, role, email, droit_ventes) values
      (acces_v::uuid, client::uuid, dr::uuid, 'client', 'essai-a8q5-v@example.test', true);
    insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut, date_piece, montant_ttc) values
      (pv1::uuid, dr::uuid, dr || '/essai-a8q5-r-pdf-1.pdf', 'essai-a8q5-r-pdf-1.pdf', 'vente', 'a_valider', reprise - 10, 120),
      (pv2::uuid, dr::uuid, dr || '/essai-a8q5-r-pdf-2.pdf', 'essai-a8q5-r-pdf-2.pdf', 'vente', 'a_valider', reprise - 10, 60),
      (pa::uuid, dr::uuid, dr || '/essai-a8q5-achat.pdf', 'essai-a8q5-achat.pdf', 'achat', 'a_valider', reprise - 10, 30),
      (pf::uuid, dr::uuid, dr || '/essai-a8q5-figee.pdf', 'essai-a8q5-figee.pdf', 'vente', 'a_valider', reprise - 20, 50),
      (po::uuid, dov::uuid, dov || '/essai-a8q5-voisin.pdf', 'essai-a8q5-voisin.pdf', 'vente', 'a_valider', reprise - 10, 120);
    insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut, piece_id, reglement_groupe) values
      (ma::uuid, dr::uuid, reprise - 1, 'ESSAI A8Q5 VEILLE', 120, 'non_rapprochee', null, false),
      (mr::uuid, dr::uuid, reprise, 'ESSAI A8Q5 REPRISE', 120, 'non_rapprochee', null, false),
      (mg::uuid, dr::uuid, reprise, 'ESSAI A8Q5 GROUPE', 180, 'rapprochee', null, true);
    -- L'écriture validée qui fige PF, par la porte de la restauration (le super-administrateur, dans un dossier sans série
    -- ni exercice validé), comme exemplairesDesFactures.sql fige les siennes.
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    insert into ecritures_brouillon (id, dossier_id, piece_id, date, compte, libelle, montant, sens, statut, valide_le, journal_code,
                                     numero_ecriture, piece_ref, piece_date, compte_lib) values
      (efig::uuid, dr::uuid, pf::uuid, reprise - 20, '706000', 'ESSAI A8Q5 PF', 50, 'credit', 'validee', now(), 'VE', 1,
       'ESSAI A8Q5 PF', reprise - 20, 'Prestations');
    reset role;
    perform set_config('request.jwt.claims', '', true);
    pf_avant := (select md5(to_jsonb(p)::text) || ':' || p.xmin::text from pieces p where p.id = pf::uuid);
    efig_avant := (select md5(to_jsonb(x)::text) || ':' || x.xmin::text from ecritures_brouillon x where x.id = efig::uuid);

    -- Une étape : {rang, étape, ce que le CHEF pose d'abord (sous sa session), le profil — `chef`, `chef_simple` (un chef du
    -- cabinet qui n'est pas super-administrateur : le compte client rattaché au cabinet le temps de la sous-transaction),
    -- `client`, `inconnu`, `postgres` (le propriétaire sous la session du chef), `postgres_inconnu` (le propriétaire sous une
    -- session que rien ne nomme) —, sa requête, le code attendu (`OK` : acceptée) et ce qu'elle rend, ou les mots du refus}.
    for e in select * from (values
      -- Citer.
      (1, '1. le chef cite la pièce de vente qui est l''original d''une facture reprise', '{P}', 'chef',
        $q$select (citer_piece_de_facture_reprise('{DR}', {F1}, '{PV1}') is not null)::text$q$,
        'OK', 'true'),
      (2, '2. un chef du cabinet qui n''est pas super-administrateur aussi', '{P}', 'chef_simple',
        $q$select (citer_piece_de_facture_reprise('{DR}', {F1}, '{PV1}') is not null)::text$q$,
        'OK', 'true'),
      (3, '3. le client « Ventes » ne cite pas (42501)', '{P}', 'client',
        $q$select citer_piece_de_facture_reprise('{DR}', {F1}, '{PV1}')::text$q$,
        '42501', 'Accès refusé à ce dossier.'),
      (4, '4. un compte sans accès non plus (42501)', '{P}', 'inconnu',
        $q$select citer_piece_de_facture_reprise('{DR}', {F1}, '{PV1}')::text$q$,
        '42501', 'Accès refusé à ce dossier.'),
      (5, '5. une pièce d''achat n''est pas l''original d''une facture reprise (22023)', '{P}', 'chef',
        $q$select citer_piece_de_facture_reprise('{DR}', {F1}, '{PA}')::text$q$,
        '22023', 'Seule une pièce de vente est l''original d''une facture reprise.'),
      (6, '6. une pièce d''un autre dossier : introuvable (P0002)', '{P}', 'chef',
        $q$select citer_piece_de_facture_reprise('{DR}', {F1}, '{PO}')::text$q$,
        'P0002', 'Pièce introuvable dans ce dossier.'),
      (7, '7. ce qui n''est pas une facture reprise de ce dossier (22023)', '{P}', 'chef',
        $q$select citer_piece_de_facture_reprise('{DR}', '{PV2}', '{PV1}')::text$q$,
        '22023', 'Cette facture n''est pas une facture reprise de ce dossier.'),
      (8, '8. une facture reprise qui cite déjà une pièce (23514)', '{P} {C}', 'chef',
        $q$select citer_piece_de_facture_reprise('{DR}', {F1}, '{PV2}')::text$q$,
        '23514', 'La facture reprise R-PDF-1 cite déjà la pièce « essai-a8q5-r-pdf-1.pdf » : retirer ce lien d''abord.'),
      (9, '9. une pièce déjà l''original d''une autre facture reprise (23514)', '{P} {C}', 'chef',
        $q$select citer_piece_de_facture_reprise('{DR}', {F2}, '{PV1}')::text$q$,
        '23514', 'La pièce « essai-a8q5-r-pdf-1.pdf » est déjà l''original de la facture reprise R-PDF-1 : une pièce n''est l''original que d''une facture reprise.'),
      (10, '10. une pièce figée par une écriture validée se cite aussi (A8Q5-Q1)', '{P}', 'chef',
        $q$select (citer_piece_de_facture_reprise('{DR}', {F2}, '{PF}') is not null)::text$q$,
        'OK', 'true'),
      (11, '11. une pièce rapprochée d''un mouvement du jour de la reprise : le rapprochement se défait d''abord (23514)', '{P} update lignes_bancaires set piece_id = ''{PV1}'' where id = ''{MR}'';', 'chef',
        $q$select citer_piece_de_facture_reprise('{DR}', {F1}, '{PV1}')::text$q$,
        '23514', format('La pièce « essai-a8q5-r-pdf-1.pdf » est réglée le %s, à la date de reprise des factures (le %s) ou après : ce règlement passe par le registre de la facture reprise R-PDF-1. Défaire d''abord ce rapprochement.', to_char(reprise, 'DD/MM/YYYY'), to_char(reprise, 'DD/MM/YYYY'))),
      (12, '12. rapprochée d''un mouvement de la veille, elle se cite : ce qu''elle a compté avant reste', '{P} update lignes_bancaires set piece_id = ''{PV1}'' where id = ''{MA}'';', 'chef',
        $q$select (citer_piece_de_facture_reprise('{DR}', {F1}, '{PV1}') is not null)::text || ':' || (select count(*) from lignes_bancaires l where l.id = '{MA}' and l.piece_id = '{PV1}')$q$,
        'OK', 'true:1'),
      -- La garde des règlements, tant que le lien vit.
      (13, '13. le rapprochement d''un mouvement du jour de la reprise se refuse (23514)', '{P} {C}', 'chef',
        $q$update lignes_bancaires set piece_id = '{PV1}' where id = '{MR}' returning statut$q$,
        '23514', refus_reglement),
      (14, '14. celui d''un mouvement de la veille passe', '{P} {C}', 'chef',
        $q$update lignes_bancaires set piece_id = '{PV1}' where id = '{MA}' returning piece_id::text$q$,
        'OK', pv1),
      (15, '15. la part d''un virement groupé du jour de la reprise se refuse, datée de son mouvement (23514)', '{P} {C}', 'chef',
        $q$insert into reglements_groupes (dossier_id, ligne_bancaire_id, piece_id, montant) values ('{DR}', '{MG}', '{PV1}', 120) returning montant::text$q$,
        '23514', refus_reglement),
      (16, '16. l''écriture qui la cite, datée de la reprise, se refuse (23514)', '{P} {C}', 'chef',
        $q$insert into ecritures_brouillon (dossier_id, piece_id, date, compte, libelle, montant, sens) values ('{DR}', '{PV1}', '{R}', '706000', 'ESSAI A8Q5', 120, 'credit') returning montant::text$q$,
        '23514', refus_reglement),
      (17, '17. datée de la veille, elle passe', '{P} {C}', 'chef',
        $q$insert into ecritures_brouillon (dossier_id, piece_id, date, compte, libelle, montant, sens) values ('{DR}', '{PV1}', ('{R}'::date - 1), '706000', 'ESSAI A8Q5', 120, 'credit') returning montant::text$q$,
        'OK', '120'),
      (18, '18. la restauration ne passe pas la garde des règlements : le chef super-administrateur non plus, dans un dossier sans série (23514)', '{P} {C}', 'chef',
        $q$insert into lignes_bancaires (dossier_id, date, libelle, montant, statut, piece_id) values ('{DR}', '{R}', 'ESSAI A8Q5', 120, 'rapprochee', '{PV1}') returning statut$q$,
        '23514', refus_reglement),
      -- Retirer.
      (19, '19. le chef retire le lien : il est daté, la pièce rendue', '{P} {C}', 'chef',
        $q$select (retirer_piece_de_facture_reprise('{DR}', {F1}) = '{PV1}')::text$q$,
        'OK', 'true'),
      (20, '20. retiré, le rapprochement d''un mouvement du jour de la reprise passe de nouveau', '{P} {C} select retirer_piece_de_facture_reprise(''{DR}'', {F1});', 'chef',
        $q$update lignes_bancaires set piece_id = '{PV1}' where id = '{MR}' returning piece_id::text$q$,
        'OK', pv1),
      (21, '21. retirer un lien qui n''existe pas (22023)', '{P}', 'chef',
        $q$select retirer_piece_de_facture_reprise('{DR}', {F1})::text$q$,
        '22023', 'Cette facture reprise ne cite aucune pièce de ce dossier.'),
      (22, '22. le client « Ventes » ne retire pas (42501)', '{P} {C}', 'client',
        $q$select retirer_piece_de_facture_reprise('{DR}', {F1})::text$q$,
        '42501', 'Accès refusé à ce dossier.'),
      (23, '23. une pièce figée après la citation : le lien ne se retire plus (23514)', '{P} {C} insert into ecritures_brouillon (dossier_id, piece_id, date, compte, libelle, montant, sens, statut, valide_le, journal_code, numero_ecriture, piece_ref, piece_date, compte_lib) values (''{DR}'', ''{PV1}'', (''{R}''::date - 1), ''706000'', ''ESSAI A8Q5'', 120, ''credit'', ''validee'', now(), ''VE'', 2, ''ESSAI A8Q5'', (''{R}''::date - 1), ''Prestations'');', 'chef',
        $q$select retirer_piece_de_facture_reprise('{DR}', {F1})::text$q$,
        '23514', format('La pièce « essai-a8q5-r-pdf-1.pdf » justifie une écriture validée de l''exercice %s : le lien qui la cite ne se retire plus.', extract(year from reprise - 1)::integer)),
      -- La garde du lien.
      (24, '24. le lien ne se modifie pas (23514)', '{P} {C}', 'postgres',
        $q$update pieces_des_factures_reprises set piece_id = '{PV2}' where dossier_id = '{DR}' returning id::text$q$,
        '23514', 'Le lien d''une facture reprise à sa pièce ne se modifie pas : il se retire (retirer_piece_de_facture_reprise), puis se cite de nouveau.'),
      (25, '25. il ne s''insère pas hors de sa fonction (42501)', '{P}', 'postgres_inconnu',
        $q$insert into pieces_des_factures_reprises (dossier_id, facture_id, piece_id) values ('{DR}', {F1}, '{PV1}') returning id::text$q$,
        '42501', 'La pièce d''une facture reprise ne se cite que par citer_piece_de_facture_reprise, qui la juge.'),
      (26, '26. un chef qui n''est pas super-administrateur ne l''insère pas : la garde, avant la policy (42501)', '{P}', 'chef_simple',
        $q$insert into pieces_des_factures_reprises (dossier_id, facture_id, piece_id) values ('{DR}', {F1}, '{PV1}') returning id::text$q$,
        '42501', case when exists (select 1 from pg_trigger g where g.tgrelid = 'public.pieces_des_factures_reprises'::regclass and g.tgname = '_acces_avant_les_gardes') then 'new row violates row-level security policy for table "pieces_des_factures_reprises"' else 'La pièce d''une facture reprise ne se cite que par citer_piece_de_facture_reprise, qui la juge.' end),
      (27, '27. la restauration le réinsère', '{P}', 'chef',
        $q$insert into pieces_des_factures_reprises (dossier_id, facture_id, piece_id) values ('{DR}', {F1}, '{PV1}') returning (piece_id = '{PV1}')::text$q$,
        'OK', 'true'),
      (28, '28. … jamais vers une pièce d''achat (23514)', '{P}', 'chef',
        $q$insert into pieces_des_factures_reprises (dossier_id, facture_id, piece_id) values ('{DR}', {F1}, '{PA}') returning id::text$q$,
        '23514', 'Une facture reprise ne cite qu''une pièce de vente de son dossier.'),
      (29, '29. … ni vers une pièce qu''un règlement du jour de la reprise cite (23514)', '{P} update lignes_bancaires set piece_id = ''{PV1}'' where id = ''{MR}'';', 'chef',
        $q$insert into pieces_des_factures_reprises (dossier_id, facture_id, piece_id) values ('{DR}', {F1}, '{PV1}') returning id::text$q$,
        '23514', 'Une facture reprise ne cite pas une pièce qu''un règlement daté de la reprise des factures ou d''après cite.'),
      -- La garde de la pièce citée.
      (30, '30. la pièce citée ne change pas de type (23514)', '{P} {C}', 'chef',
        $q$update pieces set type_piece = 'achat' where id = '{PV1}' returning type_piece$q$,
        '23514', 'La pièce « essai-a8q5-r-pdf-1.pdf » est l''original de la facture reprise R-PDF-1 : elle reste une pièce de vente de son dossier, exemplaire d''aucune facture de l''application. Retirer ce lien d''abord.'),
      (31, '31. … ni ne devient l''exemplaire d''une facture (23514)', '{P} {C}', 'postgres',
        $q$update pieces set facture_id = {F1} where id = '{PV1}' returning facture_id::text$q$,
        '23514', 'La pièce « essai-a8q5-r-pdf-1.pdf » est l''original de la facture reprise R-PDF-1 : elle reste une pièce de vente de son dossier, exemplaire d''aucune facture de l''application. Retirer ce lien d''abord.'),
      (32, '32. ses autres colonnes changent comme hier', '{P} {C}', 'chef',
        $q$update pieces set montant_ttc = 121 where id = '{PV1}' returning montant_ttc::text$q$,
        'OK', '121.00'),
      -- Ce qui l'entoure.
      (33, '33. le retrait de l''import emporte le lien', '{P} {C} select retirer_import(''{DR}'', (select l.id from imports_factures l where l.dossier_id = ''{DR}''));', 'chef',
        $q$select count(*)::text from pieces_des_factures_reprises r where r.dossier_id = '{DR}'$q$,
        'OK', '0'),
      (34, '34. le client « Ventes » ne lit pas le lien ; le chef, si', '{P} {C}', 'client',
        $q$select count(*)::text || ':' || (select count(*) from factures_importees where dossier_id = '{DR}') from pieces_des_factures_reprises where dossier_id = '{DR}'$q$,
        'OK', '0:0'),
      (35, '35. … le chef, si', '{P} {C}', 'chef',
        $q$select count(*)::text from pieces_des_factures_reprises where dossier_id = '{DR}' and retire_le is null$q$,
        'OK', '1'),
      (37, '37. le lien dit qui l''a cité', '{P} {C}', 'chef',
        $q$select count(*)::text from pieces_des_factures_reprises r where r.dossier_id = '{DR}' and r.piece_id = '{PV1}' and r.retire_le is null and r.cite_par = '{CHEF}'$q$,
        'OK', '1'),
      (38, '38. le retrait est daté, et dit qui l''a fait', '{P} {C} select retirer_piece_de_facture_reprise(''{DR}'', {F1});', 'chef',
        $q$select count(*)::text from pieces_des_factures_reprises r where r.dossier_id = '{DR}' and r.retire_le is not null and r.retire_par = '{CHEF}'$q$,
        'OK', '1'),
      -- La pièce figée (A8Q5-Q1).
      (39, '39. la pièce figée citée : sa ligne et l''écriture validée qui la fige ne changent pas (la garde de la pièce citée et celle de la pièce validée laissent poser le lien)', '{P} select citer_piece_de_facture_reprise(''{DR}'', {F2}, ''{PF}'');', 'postgres',
        $q$select ((select md5(to_jsonb(p)::text) || ':' || p.xmin::text from pieces p where p.id = '{PF}') = '{PFA}')::text || ':'
          || ((select md5(to_jsonb(x)::text) || ':' || x.xmin::text from ecritures_brouillon x where x.id = '{EFIG}') = '{EFA}')::text || ':'
          || (select count(*) from pieces_des_factures_reprises r where r.piece_id = '{PF}' and r.retire_le is null)$q$,
        'OK', 'true:true:1'),
      (40, '40. … et son lien ne se retire pas (23514)', '{P} select citer_piece_de_facture_reprise(''{DR}'', {F2}, ''{PF}'');', 'chef',
        $q$select retirer_piece_de_facture_reprise('{DR}', {F2})::text$q$,
        '23514', format('La pièce « essai-a8q5-figee.pdf » justifie une écriture validée de l''exercice %s : le lien qui la cite ne se retire plus.', extract(year from reprise - 20)::integer))
    ) as t(rang, etape, pose, profil, requete, code, attendu) loop
      v_code := 'OK'; v_msg := null; v_obs := null;
      begin
        for v_f in select x.rang, x.texte from (values (1, e.pose), (2, e.requete)) as x(rang, texte) where x.texte is not null loop
          v_texte := replace(replace(v_f.texte, '{P}', poser), '{C}', citer);
          v_texte := replace(replace(v_texte, '{L}', lot), '{AVANT}', (reprise - 10)::text);
          v_texte := replace(replace(v_texte,
            '{F1}', '(select f.id from factures_emises f where f.dossier_id = ''{DR}'' and f.numero = ''R-PDF-1'')'),
            '{F2}', '(select f.id from factures_emises f where f.dossier_id = ''{DR}'' and f.numero = ''R-PDF-2'')');
          v_texte := replace(replace(replace(replace(replace(replace(v_texte, '{PV1}', pv1), '{PV2}', pv2), '{PA}', pa), '{PF}', pf), '{PO}', po), '{CHEF}', chef);
          v_texte := replace(replace(replace(replace(replace(v_texte, '{MA}', ma), '{MR}', mr), '{MG}', mg), '{DR}', dr), '{R}', reprise::text);
          v_texte := replace(replace(replace(v_texte, '{PFA}', pf_avant), '{EFA}', efig_avant), '{EFIG}', efig);
          if v_f.rang = 1 then
            v_pose := v_texte;
          else
            v_req := v_texte;
          end if;
        end loop;
        if e.pose is not null then
          execute 'set local role authenticated';
          perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
          execute v_pose;
          reset role;
          perform set_config('request.jwt.claims', '', true);
        end if;
        if e.profil = 'chef_simple' then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client::uuid, cabinet, 'comptable_en_chef');
        end if;
        begin
          if e.profil not in ('postgres', 'postgres_inconnu') then
            execute 'set local role authenticated';
          end if;
          perform set_config('request.jwt.claims',
            json_build_object('sub', case when e.profil in ('inconnu', 'postgres_inconnu') then inconnu
                                          when e.profil in ('client', 'chef_simple') then client else chef end,
                              'role', 'authenticated')::text, true);
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
        'ok', v_code = e.code and v_msg = e.attendu, 'observe', v_code || ' ' || coalesce(v_msg, '-'));
    end loop;

    -- Le catalogue : la table, sa RLS et ses deux policies (le cabinet lit, la restauration insère, rien d'autre) ; les deux
    -- fonctions aux droits du propriétaire, leur chemin fixé, aux connectés seuls ; les trois gardes à personne ; les six
    -- déclencheurs sur leurs tables, avec leur garde.
    verdicts := verdicts || jsonb_build_object('rang', 36, 'etape', '36. le catalogue : la table, ses policies, les deux fonctions, les trois gardes et leurs six déclencheurs',
      'ok', (select c.relrowsecurity from pg_class c where c.oid = 'public.pieces_des_factures_reprises'::regclass)
        and (select string_agg(p.polname::text || ':' || p.polcmd::text || ':' || array_to_string(p.polroles::regrole[], ',') || ':'
                               || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ':' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''),
                               ' ' order by p.polname collate "C")
               from pg_policy p where p.polrelid = 'public.pieces_des_factures_reprises'::regclass and p.polname <> 'deux_facteurs')
            = 'pieces_des_factures_reprises_lecture:r:authenticated:admin_du_dossier(dossier_id): '
              || 'pieces_des_factures_reprises_restauration:a:authenticated::is_super_admin()'
        and (select string_agg(p.proname::text || ':' || p.prosecdef::int || ':' || array_to_string(p.proconfig, ',') || ':'
                               || has_function_privilege('anon', p.oid, 'execute')::int
                               || has_function_privilege('authenticated', p.oid, 'execute')::int, ' ' order by p.proname collate "C")
               from pg_proc p
              where p.pronamespace = 'public'::regnamespace
                and p.proname in ('citer_piece_de_facture_reprise', 'retirer_piece_de_facture_reprise', 'garder_pieces_des_factures_reprises',
                                  'garder_reglement_d_une_piece_reprise', 'garder_piece_d_une_facture_reprise'))
            = 'citer_piece_de_facture_reprise:1:search_path=public:01 garder_piece_d_une_facture_reprise:1:search_path=public:00 '
              || 'garder_pieces_des_factures_reprises:1:search_path=public:00 garder_reglement_d_une_piece_reprise:1:search_path=public:00 '
              || 'retirer_piece_de_facture_reprise:1:search_path=public:01'
        and (select string_agg(t.tgrelid::regclass::text || ':' || t.tgname::text || ':' || t.tgfoid::regproc::text, ' ' order by t.tgname collate "C")
               from pg_trigger t
              where t.tgfoid in ('public.garder_pieces_des_factures_reprises()'::regprocedure,
                                 'public.garder_reglement_d_une_piece_reprise()'::regprocedure,
                                 'public.garder_piece_d_une_facture_reprise()'::regprocedure))
            = 'ecritures_brouillon:ecritures_brouillon_piece_d_une_facture_reprise:garder_reglement_d_une_piece_reprise '
              || 'lignes_bancaires:lignes_bancaires_piece_d_une_facture_reprise:garder_reglement_d_une_piece_reprise '
              || 'operations_caisse:operations_caisse_piece_d_une_facture_reprise:garder_reglement_d_une_piece_reprise '
              || 'pieces:pieces_cite_par_une_facture_reprise:garder_piece_d_une_facture_reprise '
              || 'pieces_des_factures_reprises:pieces_des_factures_reprises_garde:garder_pieces_des_factures_reprises '
              || 'reglements_groupes:reglements_groupes_piece_d_une_facture_reprise:garder_reglement_d_une_piece_reprise',
      'observe', 'relu au catalogue');
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  -- Rien n'est resté : ni les dossiers jetables, ni l'accès, ni les pièces, les mouvements, les factures, les liens.
  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni l''accès, ni les pièces, les mouvements, les factures, les liens',
    'ok', not exists (select 1 from dossiers where id in (dr::uuid, dov::uuid))
      and not exists (select 1 from memberships where id = acces_v::uuid)
      and not exists (select 1 from pieces where id in (pv1::uuid, pv2::uuid, pa::uuid, pf::uuid, po::uuid))
      and not exists (select 1 from lignes_bancaires where id in (ma::uuid, mr::uuid, mg::uuid))
      and not exists (select 1 from factures_emises where dossier_id = dr::uuid)
      and not exists (select 1 from pieces_des_factures_reprises where dossier_id = dr::uuid)
      and not exists (select 1 from cabinet_admins where user_id = client::uuid),
    'observe', 'relu');
  perform set_config('essai.piece_d_une_facture_reprise', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.piece_d_une_facture_reprise')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
