-- LE RÉGIME D'E-REPORTING CONFIRMÉ D'UN DOSSIER ET LA PIÈCE ÉCARTÉE, ÉPROUVÉS EN BASE — à rejouer par `execute_sql` après
-- toute migration qui touche `confirmer_regime_ereporting`, `retirer_regime_ereporting`, `ecarter_piece_ereporting`,
-- `reprendre_piece_ereporting`, les gardes `garder_regime_ereporting`, `garder_ecart_ereporting`, `garder_piece_ecartee`,
-- les deux tables `regimes_ereporting` et `pieces_ecartees_ereporting`, la fiche « hors de France » (étape e2),
-- `admin_du_dossier` ou `memberships` (ligne 28.5, étape e5a ; migration `regimes_ereporting_et_pieces_ecartees`).
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - QUI écrit, par impersonation : un anonyme n'a pas le droit d'appeler ; un compte rattaché à rien, un client — sur
--     le dossier d'un autre comme sur le SIEN —, un membre du cabinet affecté à un AUTRE dossier se font refuser l'accès
--     au dossier ; le chef du cabinet, un chef qui n'est pas super-administrateur et un membre affecté au dossier
--     écrivent (les contrôles POSITIFS) ;
--   - QUI lit : le client ne voit ni régime ni écart, pas même ceux de SON dossier ; l'anonyme et le compte rattaché à
--     rien non plus ; le membre affecté voit ceux de son dossier, et eux seuls ;
--   - CE QUI S'ÉCRIT : un régime confirmé — son statut, ses fréquences, sa note, son auteur —, puis retiré et confirmé de
--     nouveau le même jour ; un écart, son motif et son auteur, puis repris et posé de nouveau ;
--   - CE QUI SE REFUSE, avec sa RAISON, dans l'ordre des fonctions — que src/lib/regimesEreporting.test.ts relit ici ;
--   - CE QUE LES GARDES ET LES CONTRAINTES TIENNENT SANS LES FONCTIONS : un régime et un écart ne se modifient pas, sauf
--     leur retrait, une fois ; un régime actif par jour de départ, un écart actif par pièce ; les fréquences que les
--     textes écrivent pour un redevable et un franchisé ; un écart vise une pièce de son dossier ; une pièce écartée ne
--     change pas de dossier ;
--   - CE QUE LE CATALOGUE DIT : les droits d'exécution, la sécurité des fonctions, les policies, la RLS, les
--     déclencheurs et les clés ;
--   - LES MUTATIONS (contrôles 140 à 147) : chacune rejoue un contrôle avec un profil délibérément faux, et doit MORDRE ;
--   - et que RIEN ne reste en base.
--
-- CE QUI NE SE JOUE PAS ICI, ET SE JOUE SUR UNE RÉPLIQUE LOCALE dont signature.sql montre les neuf familles égales à la
-- production : la suppression d'une pièce et d'un dossier (leurs écarts et leurs régimes partent avec eux), une
-- suppression directe (refusée), et deux sessions qui se croisent — l'outil d'exécution soumet une suppression à une
-- confirmation qui n'arrive pas ici.
--
-- Tout se joue dans deux dossiers JETABLES du cabinet du dossier `test` et dans le dossier du client, au sein d'un bloc
-- qui s'annule entièrement à la fin (`ANNULATION_ESSAI_GLOBALE`) ; chaque contrôle dans sa sous-transaction, annulée elle
-- aussi (`ANNULATION_ESSAI`, P0001) — le moteur d'étapes de piecesHorsDeFrance.sql, ses six genres (`jeu`, `controle`,
-- `fait`, `valeur`, `retenir`, `lecture`) et ses profils (« membre » affecté au dossier T, « membre_ailleurs » affecté au
-- dossier A, « chef_simple », chef du cabinet sans être super-administrateur : le compte client rattaché au cabinet le
-- temps de la sous-transaction). Un refus se juge à son code ET à son message (motif LIKE). Les identifiants jetables
-- sont FIXES (préfixe `e5a00000`). Les verdicts voyagent dans un réglage LOCAL à la transaction
-- (`essai.regimes_ereporting`) : hors de l'outil d'exécution, le fichier se joue en UNE transaction (`psql -1`). Aucune
-- instruction de suppression.
do $essai$
declare
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  inconnu uuid := gen_random_uuid();
  dossier_test uuid := '001c7ed7-c23b-4590-901e-693489f8af24';
  dossier_client uuid; cabinet uuid;
  aujourd_hui text := to_char((now() at time zone 'Europe/Paris')::date, 'YYYY-MM-DD');
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
     or (now() at time zone 'Europe/Paris')::date < date '2026-10-11' then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable, client déjà rattaché au cabinet (ou un jour d''avant le 11/10/2026 : les régimes de l''essai seraient dans l''avenir)';
  end if;

  ids := jsonb_build_object('CAB', cabinet, 'DC', dossier_client, 'AUJOURDHUI', aujourd_hui, 'DEMAIN', demain,
      'AUTRE', gen_random_uuid())
    || jsonb_build_object('T', 'e5a00000-0000-4000-8000-0000000000a1', 'A', 'e5a00000-0000-4000-8000-0000000000a3')
    || jsonb_build_object(
      'P1', 'e5a00000-0000-4000-8001-000000000001', 'P2', 'e5a00000-0000-4000-8001-000000000002',
      'P3', 'e5a00000-0000-4000-8001-000000000003', 'P4', 'e5a00000-0000-4000-8001-000000000004',
      'P5', 'e5a00000-0000-4000-8001-000000000005', 'P6', 'e5a00000-0000-4000-8001-000000000006',
      'P7', 'e5a00000-0000-4000-8001-000000000007', 'P8', 'e5a00000-0000-4000-8001-000000000008',
      'P9', 'e5a00000-0000-4000-8001-000000000009', 'PA', 'e5a00000-0000-4000-8001-00000000000a',
      'PC', 'e5a00000-0000-4000-8001-0000000000c1', 'PX', 'e5a00000-0000-4000-8001-0000000000a3')
    || jsonb_build_object('RE', 'e5a00000-0000-4000-8002-000000000001', 'EE', 'e5a00000-0000-4000-8003-000000000001');

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from pieces)), ((select count(*) from regimes_ereporting)),
    ((select count(*) from pieces_ecartees_ereporting)), ((select count(*) from pieces_hors_de_france)),
    ((select count(*) from pieces_hors_de_france_taux)), ((select count(*) from cabinet_admins)),
    ((select count(*) from dossier_assignations)), ((select count(*) from memberships))
  ) as t(n);

  -- Une étape : {genre, contrôle, qui, requête, code attendu, message attendu (motif LIKE) ou valeur attendue}.
  etapes := array[
    -- ══ Le jeu : deux dossiers jetables du cabinet du dossier test, leurs pièces, deux fiches « hors de France » ════
    array['jeu', 'dossiers jetables', 'postgres', $q$insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values
      ('{T}', 'ESSAI REGIMES T', '{CAB}', 'tresorerie', '455000'), ('{A}', 'ESSAI REGIMES A', '{CAB}', 'tresorerie', '455000')$q$, '', ''],
    array['jeu', 'pièces de T', 'postgres', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, date_piece, montant_ht, montant_tva, montant_ttc, devise, montant_devise, taux_change, conversion_source) values
      ('{P1}', '{T}', '{T}/essai-e5a-p1.pdf', 'essai-e5a-p1.pdf', 'achat', '2026-03-10', 120, null, 120, 'EUR', null, null, null),
      ('{P2}', '{T}', '{T}/essai-e5a-p2.pdf', 'essai-e5a-p2.pdf', 'achat', '2026-03-11', 80, null, 80, 'EUR', null, null, null),
      ('{P3}', '{T}', '{T}/essai-e5a-p3.pdf', 'essai-e5a-p3.pdf', 'achat', '2026-03-12', 60, null, 60, 'EUR', null, null, null),
      ('{P4}', '{T}', '{T}/essai-e5a-p4.pdf', 'essai-e5a-p4.pdf', 'vente', '2026-03-13', 50, null, 50, 'EUR', null, null, null),
      ('{P5}', '{T}', '{T}/essai-e5a-p5.pdf', 'essai-e5a-p5.pdf', 'note_frais', '2026-03-14', 30, null, 30, 'EUR', null, null, null),
      ('{P6}', '{T}', '{T}/essai-e5a-p6.pdf', 'essai-e5a-p6.pdf', 'achat', '2026-03-15', 45, null, 45, 'USD', 52.65, 1.17, 'bce'),
      ('{P7}', '{T}', '{T}/essai-e5a-p7.pdf', 'essai-e5a-p7.pdf', 'achat', '2026-03-16', 82.5, 16.5, 99, 'EUR', null, null, null),
      ('{P8}', '{T}', '{T}/essai-e5a-p8.pdf', 'essai-e5a-p8.pdf', 'achat', '2026-03-17', 70, null, 70, 'EUR', null, null, null),
      ('{P9}', '{T}', '{T}/essai-e5a-p9.pdf', 'essai-e5a-p9.pdf', 'achat', '2026-03-18', 75, null, 75, 'EUR', null, null, null),
      ('{PA}', '{T}', '{T}/essai-e5a-pa.pdf', 'essai-e5a-pa.pdf', 'achat', '2026-03-19', 65, null, 65, 'EUR', null, null, null)$q$, '', ''],
    array['jeu', 'pièce du dossier du client, et pièce de A', 'postgres', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, date_piece, montant_ttc, devise) values
      ('{PC}', '{DC}', '{DC}/essai-e5a-pc.pdf', 'essai-e5a-pc.pdf', 'achat', '2026-03-10', 10, 'EUR'),
      ('{PX}', '{A}', '{A}/essai-e5a-px.pdf', 'essai-e5a-px.pdf', 'achat', '2026-03-10', 25, 'EUR')$q$, '', ''],
    array['fait', '0. le jeu : la fiche courante de P2', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P2}', null, 'INV-P2', '2026-03-11', '380', null, null, 'IE', '0223', 'IE6388047V', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":80,"tva":0}]'::jsonb)$q$, 'OK', ''],
    array['fait', '0. le jeu : la fiche de P3', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P3}', null, 'INV-P3', '2026-03-12', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":60,"tva":0}]'::jsonb)$q$, 'OK', ''],
    array['retenir', 'F3', 'postgres', $q$select id::text from pieces_hors_de_france where piece_id = '{P3}'$q$, '', ''],
    array['fait', '0. le jeu : la fiche de P3, retirée', 'chef', $q$select retirer_fiche_hors_de_france('{T}', '{F3}')$q$, 'OK', ''],
    -- P8 : une fiche retirée, puis remplacée — la courante n'est pas retirée. P9 : une fiche remplacée, puis la courante
    -- retirée. Une recherche de la fiche « courante » qui oublierait la chaîne y lirait la mauvaise.
    array['fait', '0. le jeu : la première fiche de P8', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P8}', null, 'INV-P8', '2026-03-17', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":70,"tva":0}]'::jsonb)$q$, 'OK', ''],
    array['retenir', 'F8', 'postgres', $q$select id::text from pieces_hors_de_france where piece_id = '{P8}'$q$, '', ''],
    array['fait', '0. le jeu : retirée', 'chef', $q$select retirer_fiche_hors_de_france('{T}', '{F8}')$q$, 'OK', ''],
    array['fait', '0. le jeu : puis remplacée', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P8}', '{F8}', 'INV-P8', '2026-03-17', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":70,"tva":0}]'::jsonb)$q$, 'OK', ''],
    array['fait', '0. le jeu : la première fiche de P9', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', null, 'INV-P9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":75,"tva":0}]'::jsonb)$q$, 'OK', ''],
    array['retenir', 'F9', 'postgres', $q$select id::text from pieces_hors_de_france where piece_id = '{P9}'$q$, '', ''],
    array['fait', '0. le jeu : remplacée', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P9}', '{F9}', 'INV-P9', '2026-03-18', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":75,"tva":0}]'::jsonb)$q$, 'OK', ''],
    array['retenir', 'F9B', 'postgres', $q$select id::text from pieces_hors_de_france where remplace_id = '{F9}'$q$, '', ''],
    array['fait', '0. le jeu : la courante de P9, retirée', 'chef', $q$select retirer_fiche_hors_de_france('{T}', '{F9B}')$q$, 'OK', ''],

    -- ══ 1 à 6. Qui confirme un régime ══════════
    array['controle', '1. anonyme : pas le droit d''appeler', 'anon', $q$select confirmer_regime_ereporting('{T}', '2026-01-01', 'franchise', null, null, false, 'bimestre', 'bimestre', null)$q$,
      '42501', 'permission denied for function confirmer_regime_ereporting'],
    array['controle', '2. rattaché à rien : l''accès au dossier, avant de rien lire', 'inconnu', $q$select confirmer_regime_ereporting('{T}', '2026-01-01', 'franchise', null, null, false, 'bimestre', 'bimestre', null)$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '3. client, le dossier d''un autre', 'client', $q$select confirmer_regime_ereporting('{T}', '2026-01-01', 'franchise', null, null, false, 'bimestre', 'bimestre', null)$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '4. client, son propre dossier', 'client', $q$select confirmer_regime_ereporting('{DC}', '2026-01-01', 'franchise', null, null, false, 'bimestre', 'bimestre', null)$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '5. membre du cabinet affecté à un AUTRE dossier', 'membre_ailleurs', $q$select confirmer_regime_ereporting('{T}', '2026-01-01', 'franchise', null, null, false, 'bimestre', 'bimestre', null)$q$,
      '42501', 'Accès refusé à ce dossier.'],
    array['controle', '6. un dossier qui n''existe pas, même pour le super-administrateur', 'chef', $q$select confirmer_regime_ereporting('{AUTRE}', '2026-01-01', 'franchise', null, null, false, 'bimestre', 'bimestre', null)$q$,
      '42501', 'Accès refusé à ce dossier.'],

    -- ══ 7 à 9. Le jour de départ ══════════
    array['controle', '7. le jour de départ est à renseigner', 'chef', $q$select confirmer_regime_ereporting('{T}', null, 'franchise', null, null, false, 'bimestre', 'bimestre', null)$q$,
      '22023', 'Le jour à partir duquel ce régime vaut est à renseigner.'],
    array['controle', '7b. le jour se juge avant le statut', 'chef', $q$select confirmer_regime_ereporting('{T}', null, null, null, null, null, null, null, null)$q$,
      '22023', 'Le jour à partir duquel ce régime vaut est à renseigner.'],
    array['controle', '8. pas avant l''an 2000', 'chef', $q$select confirmer_regime_ereporting('{T}', '1999-12-31', 'franchise', null, null, false, 'bimestre', 'bimestre', null)$q$,
      '22023', 'Un régime ne se date pas avant l''an 2000.'],
    array['controle', '9. pas dans l''avenir, le jour lu à Paris', 'chef', $q$select confirmer_regime_ereporting('{T}', '{DEMAIN}', 'franchise', null, null, false, 'bimestre', 'bimestre', null)$q$,
      '22023', 'Un régime ne se confirme pas pour l''avenir : nous sommes le %.'],
    array['controle', '9b. aujourd''hui, si', 'chef', $q$select confirmer_regime_ereporting('{T}', '{AUJOURDHUI}', 'franchise', null, null, false, 'bimestre', 'bimestre', null)$q$, 'OK', ''],

    -- ══ 10 à 13. Ce qui s'écrit ══════════
    array['fait', '10. le chef confirme le régime d''un franchisé depuis le 1er janvier', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-01-01', 'franchise', null, null, false, 'bimestre', 'bimestre', null)$q$, 'OK', ''],
    array['retenir', 'R1', 'postgres', $q$select id::text from regimes_ereporting where dossier_id = '{T}' and depuis = '2026-01-01'$q$, '', ''],
    array['valeur', '11. le régime : ses fréquences, aucune note, son auteur, rien de retiré', 'postgres', $q$select string_agg(depuis || ':' || statut_tva || ':' || coalesce(article_exoneration, '-') || ':' || coalesce(tva_periodicite, '-') || ':' || tva_sur_debits || ':' || frequence_transactions || ':' || coalesce(frequence_paiements, '-') || ':' || coalesce(note, '-') || ':' || (cree_par = '{CHEF}')::text || ':' || (retire_le is null and retire_par is null)::text, ',') from regimes_ereporting where id = '{R1}'$q$, '',
      '2026-01-01:franchise:-:-:false:bimestre:bimestre:-:true:true'],
    array['controle', '12. un régime est déjà confirmé ce jour-là', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-01-01', 'redevable', null, 'trimestrielle', false, 'mois', 'mois', null)$q$,
      '22023', 'Un régime est déjà confirmé à partir du 01/01/2026 : le retirer d''abord pour en confirmer un autre ce jour-là.'],
    array['controle', '13. le même jour, même un régime qui serait faux par ailleurs : le jour se juge d''abord', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-01-01', null, null, null, null, null, null, null)$q$,
      '22023', 'Un régime est déjà confirmé à partir du 01/01/2026 : le retirer d''abord pour en confirmer un autre ce jour-là.'],

    -- ══ 14 à 24. Le régime ══════════
    array['controle', '14. un statut à préciser ne se confirme pas', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-02-01', null, null, null, false, 'mois', 'mois', null)$q$,
      '22023', 'Un régime confirmé est celui d''un dossier redevable, en franchise en base ou exonéré : un statut à préciser ne se confirme pas.'],
    array['controle', '14b. un statut qui n''est pas l''un des trois', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-02-01', 'assujetti', null, null, false, 'mois', 'mois', null)$q$,
      '22023', 'Un régime confirmé est celui d''un dossier redevable, en franchise en base ou exonéré : un statut à préciser ne se confirme pas.'],
    array['controle', '15. un article inconnu', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-02-01', 'exonere', 'cgi_262', null, false, 'mois', 'mois', null)$q$,
      '22023', 'Cet article d''exonération n''est pas un de ceux que l''application connaît.'],
    array['controle', '15b. un article inconnu se dit avant la franchise', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-02-01', 'franchise', 'cgi_262', null, false, 'bimestre', 'bimestre', null)$q$,
      '22023', 'Cet article d''exonération n''est pas un de ceux que l''application connaît.'],
    array['controle', '16. un article en franchise en base', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-02-01', 'franchise', 'cgi_261_4_1', null, false, 'bimestre', 'bimestre', null)$q$,
      '22023', 'Un dossier en franchise en base ne porte pas d''article d''exonération.'],
    array['controle', '16b. l''article se dit avant la périodicité et l''option', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-02-01', 'franchise', 'cgi_261_4_1', 'trimestrielle', true, 'mois', 'mois', null)$q$,
      '22023', 'Un dossier en franchise en base ne porte pas d''article d''exonération.'],
    array['controle', '17. un redevable sans périodicité', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-02-01', 'redevable', null, null, false, 'mois', 'mois', null)$q$,
      '22023', 'Un redevable déclare sa TVA chaque mois ou chaque trimestre : la périodicité est à renseigner.'],
    array['controle', '17b. une périodicité inconnue', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-02-01', 'redevable', null, 'annuelle', false, 'mois', 'mois', null)$q$,
      '22023', 'Un redevable déclare sa TVA chaque mois ou chaque trimestre : la périodicité est à renseigner.'],
    array['controle', '18. une périodicité en franchise en base', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-02-01', 'franchise', null, 'trimestrielle', false, 'bimestre', 'bimestre', null)$q$,
      '22023', 'Seul un redevable a une périodicité de déclaration de TVA.'],
    array['controle', '18b. la périodicité se dit avant l''option', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-02-01', 'franchise', null, 'trimestrielle', null, 'mois', 'mois', null)$q$,
      '22023', 'Seul un redevable a une périodicité de déclaration de TVA.'],
    array['controle', '19. l''option pour les débits, dite', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-02-01', 'franchise', null, null, null, 'bimestre', 'bimestre', null)$q$,
      '22023', 'Dire si le dossier a opté pour la TVA sur les débits.'],
    array['controle', '19b. l''option se dit avant les fréquences', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-02-01', 'redevable', null, 'trimestrielle', null, 'decade', null, null)$q$,
      '22023', 'Dire si le dossier a opté pour la TVA sur les débits.'],
    array['controle', '20. l''option pour les débits d''un exonéré', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-02-01', 'exonere', null, null, true, 'mois', 'mois', null)$q$,
      '22023', 'Seul un redevable opte pour la TVA sur les débits.'],
    array['controle', '21. un redevable mensuel déclare par décade', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-02-01', 'redevable', null, 'mensuelle', false, 'mois', 'mois', null)$q$,
      '22023', 'Sous ce régime, ses ventes et ses achats se déclarent par décade : c''est la fréquence que le cabinet confirme.'],
    array['controle', '21b. un redevable trimestriel, chaque mois', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-02-01', 'redevable', null, 'trimestrielle', false, 'decade', 'mois', null)$q$,
      '22023', 'Sous ce régime, ses ventes et ses achats se déclarent chaque mois : c''est la fréquence que le cabinet confirme.'],
    array['controle', '21c. un franchisé, tous les deux mois', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-02-01', 'franchise', null, null, false, 'mois', 'bimestre', null)$q$,
      '22023', 'Sous ce régime, ses ventes et ses achats se déclarent tous les deux mois : c''est la fréquence que le cabinet confirme.'],
    array['controle', '21d. un exonéré, chaque mois (hypothèse Q4)', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-02-01', 'exonere', null, null, false, 'decade', 'mois', null)$q$,
      '22023', 'Sous ce régime, ses ventes et ses achats se déclarent chaque mois : c''est la fréquence que le cabinet confirme.'],
    array['controle', '21e. une fréquence absente', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-02-01', 'redevable', null, 'mensuelle', false, null, 'mois', null)$q$,
      '22023', 'Sous ce régime, ses ventes et ses achats se déclarent par décade : c''est la fréquence que le cabinet confirme.'],
    array['controle', '21f. la fréquence des ventes et des achats se dit avant celle des paiements', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-02-01', 'redevable', null, 'trimestrielle', false, 'decade', null, null)$q$,
      '22023', 'Sous ce régime, ses ventes et ses achats se déclarent chaque mois : c''est la fréquence que le cabinet confirme.'],
    array['controle', '22. sur option pour les débits, aucun paiement ne se déclare', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-02-01', 'redevable', null, 'mensuelle', true, 'decade', 'mois', null)$q$,
      '22023', 'Sur option pour la TVA sur les débits, ses paiements ne se déclarent pas : aucune fréquence ne se confirme pour eux.'],
    array['controle', '23. sans l''option, les paiements chaque mois', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-02-01', 'redevable', null, 'trimestrielle', false, 'mois', null, null)$q$,
      '22023', 'Sous ce régime, ses paiements se déclarent chaque mois : c''est la fréquence que le cabinet confirme.'],
    array['controle', '23b. un franchisé, ses paiements tous les deux mois', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-02-01', 'franchise', null, null, false, 'bimestre', 'mois', null)$q$,
      '22023', 'Sous ce régime, ses paiements se déclarent tous les deux mois : c''est la fréquence que le cabinet confirme.'],
    array['controle', '23c. un exonéré, ses paiements chaque mois (hypothèse Q4)', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-02-01', 'exonere', null, null, false, 'mois', 'bimestre', null)$q$,
      '22023', 'Sous ce régime, ses paiements se déclarent chaque mois : c''est la fréquence que le cabinet confirme.'],
    array['controle', '23d. les paiements se disent avant la note', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-02-01', 'franchise', null, null, false, 'bimestre', 'mois', repeat('n', 2001))$q$,
      '22023', 'Sous ce régime, ses paiements se déclarent tous les deux mois : c''est la fréquence que le cabinet confirme.'],
    array['controle', '24. une note de plus de 2 000 caractères', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-02-01', 'franchise', null, null, false, 'bimestre', 'bimestre', repeat('n', 2001))$q$,
      '22023', 'La note de la confirmation dépasse 2 000 caractères.'],
    array['controle', '24b. 2 000 caractères, si', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-02-01', 'franchise', null, null, false, 'bimestre', 'bimestre', repeat('n', 2000))$q$, 'OK', ''],

    -- ══ 25 à 29. L'histoire d'un dossier ══════════
    array['fait', '25. un redevable mensuel sur les débits depuis le 1er juillet ; une note faite d''espaces n''est pas une note', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-07-01', 'redevable', null, 'mensuelle', true, 'decade', null, '   ')$q$, 'OK', ''],
    array['valeur', '26. son régime, sans note', 'postgres', $q$select string_agg(statut_tva || ':' || coalesce(tva_periodicite, '-') || ':' || tva_sur_debits || ':' || frequence_transactions || ':' || coalesce(frequence_paiements, '-') || ':' || coalesce(note, '-'), ',') from regimes_ereporting where dossier_id = '{T}' and depuis = '2026-07-01'$q$, '',
      'redevable:mensuelle:true:decade:-:-'],
    array['fait', '27. un exonéré (soins) depuis le 1er septembre, avec sa note', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-09-01', 'exonere', 'cgi_261_4_1', null, false, 'mois', 'mois', 'Confirmé avec son service des impôts.')$q$, 'OK', ''],
    array['fait', '28. un redevable trimestriel en partie exonéré depuis le 1er octobre', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-10-01', 'redevable', 'cgi_261_4_4_a', 'trimestrielle', false, 'mois', 'mois', null)$q$, 'OK', ''],
    array['valeur', '29. l''histoire de T, dans l''ordre', 'postgres', $q$select string_agg(depuis || ':' || statut_tva || ':' || coalesce(article_exoneration, '-') || ':' || frequence_transactions || ':' || coalesce(frequence_paiements, '-') || ':' || coalesce(note, '-'), ',' order by depuis) from regimes_ereporting where dossier_id = '{T}' and retire_le is null$q$, '',
      '2026-01-01:franchise:-:bimestre:bimestre:-,2026-07-01:redevable:-:decade:-:-,2026-09-01:exonere:cgi_261_4_1:mois:mois:Confirmé avec son service des impôts.,2026-10-01:redevable:cgi_261_4_4_a:mois:mois:-'],

    -- ══ 30 à 40. Retirer un régime ══════════
    array['controle', '30. anonyme : pas le droit d''appeler', 'anon', $q$select retirer_regime_ereporting('{T}', '{R1}')$q$,
      '42501', 'permission denied for function retirer_regime_ereporting'],
    array['controle', '31. rattaché à rien', 'inconnu', $q$select retirer_regime_ereporting('{T}', '{R1}')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '32. client', 'client', $q$select retirer_regime_ereporting('{T}', '{R1}')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '33. membre affecté ailleurs', 'membre_ailleurs', $q$select retirer_regime_ereporting('{T}', '{R1}')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '34. le régime de T, demandé dans A', 'chef', $q$select retirer_regime_ereporting('{A}', '{R1}')$q$, 'P0002', 'Régime introuvable dans ce dossier.'],
    array['controle', '35. un régime qui n''existe pas', 'chef', $q$select retirer_regime_ereporting('{T}', '{AUTRE}')$q$, 'P0002', 'Régime introuvable dans ce dossier.'],
    array['fait', '36. le chef retire le régime du 1er janvier', 'chef', $q$select retirer_regime_ereporting('{T}', '{R1}')$q$, 'OK', ''],
    array['valeur', '37. il reste, retiré par le chef', 'postgres', $q$select (retire_le is not null)::text || ':' || (retire_par = '{CHEF}')::text || ':' || statut_tva from regimes_ereporting where id = '{R1}'$q$, '', 'true:true:franchise'],
    array['controle', '38. déjà retiré', 'chef', $q$select retirer_regime_ereporting('{T}', '{R1}')$q$, '22023', 'Ce régime est déjà retiré.'],
    array['fait', '39. le même jour se confirme de nouveau, autrement', 'chef', $q$select confirmer_regime_ereporting('{T}', '2026-01-01', 'exonere', null, null, false, 'mois', 'mois', null)$q$, 'OK', ''],
    array['valeur', '40. deux régimes du 1er janvier, un seul actif : le nouveau', 'postgres', $q$select count(*) || ':' || string_agg(statut_tva || ':' || (retire_le is null)::text, ',' order by statut_tva) from regimes_ereporting where dossier_id = '{T}' and depuis = '2026-01-01'$q$, '', '2:exonere:true,franchise:false'],

    -- ══ 41 à 46. Les autres profils du cabinet, et l'écriture directe ══════════
    array['controle', '41. le membre affecté au dossier confirme', 'membre', $q$select confirmer_regime_ereporting('{T}', '2026-02-01', 'franchise', null, null, false, 'bimestre', 'bimestre', null)$q$, 'OK', ''],
    array['controle', '42. un chef du cabinet qui n''est pas super-administrateur confirme aussi', 'chef_simple', $q$select confirmer_regime_ereporting('{T}', '2026-02-01', 'franchise', null, null, false, 'bimestre', 'bimestre', null)$q$, 'OK', ''],
    array['controle', '43. et le membre affecté retire', 'membre', $q$select retirer_regime_ereporting('{T}', (select id from regimes_ereporting where dossier_id = '{T}' and depuis = '2026-07-01'))$q$, 'OK', ''],
    array['controle', '44. le membre affecté n''écrit pas en direct : les fonctions seules', 'membre', $q$insert into regimes_ereporting (dossier_id, depuis, statut_tva, tva_sur_debits, frequence_transactions, frequence_paiements) values ('{T}', '2026-03-01', 'franchise', false, 'bimestre', 'bimestre')$q$,
      '42501', 'new row violates row-level security policy for table "regimes_ereporting"'],
    array['controle', '45. ni le chef qui n''est pas super-administrateur', 'chef_simple', $q$insert into regimes_ereporting (dossier_id, depuis, statut_tva, tva_sur_debits, frequence_transactions, frequence_paiements) values ('{T}', '2026-03-01', 'franchise', false, 'bimestre', 'bimestre')$q$,
      '42501', 'new row violates row-level security policy for table "regimes_ereporting"'],
    array['controle', '46. ni le client, dans son dossier', 'client', $q$insert into regimes_ereporting (dossier_id, depuis, statut_tva, tva_sur_debits, frequence_transactions, frequence_paiements) values ('{DC}', '2026-03-01', 'franchise', false, 'bimestre', 'bimestre')$q$,
      '42501', 'new row violates row-level security policy for table "regimes_ereporting"'],
    array['controle', '47. le super-administrateur insère en direct pour restaurer : l''histoire telle qu''elle a été écrite, retrait compris', 'chef', $q$insert into regimes_ereporting (id, dossier_id, depuis, statut_tva, tva_sur_debits, frequence_transactions, frequence_paiements, cree_le, retire_le) values ('{RE}', '{T}', '2026-03-01', 'franchise', false, 'bimestre', 'bimestre', '2026-03-01T09:00:00Z', '2026-03-02T09:00:00Z')$q$, 'OK', ''],

    -- ══ 48 à 59. Ce que la garde et les contraintes tiennent sans les fonctions ══════════
    array['controle', '48. un régime ne se modifie pas, même par le propriétaire', 'postgres', $q$update regimes_ereporting set statut_tva = 'redevable', tva_periodicite = 'trimestrielle', frequence_transactions = 'mois', frequence_paiements = 'mois' where dossier_id = '{T}' and depuis = '2026-09-01'$q$,
      '23514', 'Un régime confirmé ne se modifie pas : il se retire, une fois, et un autre se confirme.'],
    array['controle', '48b. ni sa note', 'postgres', $q$update regimes_ereporting set note = 'autre' where dossier_id = '{T}' and depuis = '2026-09-01'$q$,
      '23514', 'Un régime confirmé ne se modifie pas : il se retire, une fois, et un autre se confirme.'],
    array['controle', '49. un retrait ne se défait pas', 'postgres', $q$update regimes_ereporting set retire_le = null, retire_par = null where id = '{R1}'$q$,
      '23514', 'Un régime confirmé ne se modifie pas : il se retire, une fois, et un autre se confirme.'],
    array['controle', '49b. un retrait ne se redate pas', 'postgres', $q$update regimes_ereporting set retire_le = retire_le + interval '1 day' where id = '{R1}'$q$,
      '23514', 'Un régime confirmé ne se modifie pas : il se retire, une fois, et un autre se confirme.'],
    array['controle', '49c. un retrait qui modifie autre chose', 'postgres', $q$update regimes_ereporting set retire_le = now(), depuis = '2026-09-02' where dossier_id = '{T}' and depuis = '2026-09-01'$q$,
      '23514', 'Un régime confirmé ne se modifie pas : il se retire, une fois, et un autre se confirme.'],
    array['controle', '49c2. ni un retrait qui change la note', 'postgres', $q$update regimes_ereporting set retire_le = now(), note = 'autre' where dossier_id = '{T}' and depuis = '2026-09-01'$q$,
      '23514', 'Un régime confirmé ne se modifie pas : il se retire, une fois, et un autre se confirme.'],
    array['controle', '49d. une écriture qui ne retire rien n''est pas un retrait', 'postgres', $q$update regimes_ereporting set retire_le = null where dossier_id = '{T}' and depuis = '2026-09-01'$q$,
      '23514', 'Un régime confirmé ne se modifie pas : il se retire, une fois, et un autre se confirme.'],
    array['controle', '49e. un retrait en direct, une fois, passe', 'postgres', $q$update regimes_ereporting set retire_le = now() where dossier_id = '{T}' and depuis = '2026-09-01'$q$, 'OK', ''],
    array['controle', '50. un seul régime actif par jour de départ, sans la fonction', 'postgres', $q$insert into regimes_ereporting (dossier_id, depuis, statut_tva, tva_sur_debits, frequence_transactions, frequence_paiements) values ('{T}', '2026-09-01', 'franchise', false, 'bimestre', 'bimestre')$q$,
      '23505', '%"regimes_ereporting_un_par_jour"'],
    array['controle', '50b. un régime retiré ne compte pas', 'postgres', $q$insert into regimes_ereporting (dossier_id, depuis, statut_tva, tva_sur_debits, frequence_transactions, frequence_paiements, retire_le) values ('{T}', '2026-09-01', 'franchise', false, 'bimestre', 'bimestre', now())$q$, 'OK', ''],
    array['controle', '51. le statut, sans la fonction', 'postgres', $q$insert into regimes_ereporting (dossier_id, depuis, statut_tva, tva_sur_debits, frequence_transactions, frequence_paiements) values ('{T}', '2026-03-01', 'assujetti', false, 'mois', 'mois')$q$,
      '23514', '%"regimes_ereporting_statut_tva"'],
    array['controle', '51b. un article connu, sans la fonction', 'postgres', $q$insert into regimes_ereporting (dossier_id, depuis, statut_tva, article_exoneration, tva_sur_debits, frequence_transactions, frequence_paiements) values ('{T}', '2026-03-01', 'exonere', 'cgi_262', false, 'mois', 'mois')$q$,
      '23514', '%"regimes_ereporting_article_exoneration"'],
    array['controle', '51c. aucun article en franchise, sans la fonction', 'postgres', $q$insert into regimes_ereporting (dossier_id, depuis, statut_tva, article_exoneration, tva_sur_debits, frequence_transactions, frequence_paiements) values ('{T}', '2026-03-01', 'franchise', 'cgi_261_4_1', false, 'bimestre', 'bimestre')$q$,
      '23514', '%"regimes_ereporting_article_coherent"'],
    array['controle', '52. la périodicité d''un redevable seul, sans la fonction', 'postgres', $q$insert into regimes_ereporting (dossier_id, depuis, statut_tva, tva_periodicite, tva_sur_debits, frequence_transactions, frequence_paiements) values ('{T}', '2026-03-01', 'franchise', 'trimestrielle', false, 'bimestre', 'bimestre')$q$,
      '23514', '%"regimes_ereporting_periodicite_coherente"'],
    array['controle', '52b. et toujours la sienne, sans la fonction', 'postgres', $q$insert into regimes_ereporting (dossier_id, depuis, statut_tva, tva_sur_debits, frequence_transactions, frequence_paiements) values ('{T}', '2026-03-01', 'redevable', false, 'mois', 'mois')$q$,
      '23514', '%"regimes_ereporting_periodicite_coherente"'],
    array['controle', '52c. une périodicité connue, sans la fonction', 'postgres', $q$insert into regimes_ereporting (dossier_id, depuis, statut_tva, tva_periodicite, tva_sur_debits, frequence_transactions, frequence_paiements) values ('{T}', '2026-03-01', 'redevable', 'annuelle', false, 'mois', 'mois')$q$,
      '23514', '%"regimes_ereporting_tva_periodicite"'],
    array['controle', '53. l''option pour les débits d''un redevable seul, sans la fonction', 'postgres', $q$insert into regimes_ereporting (dossier_id, depuis, statut_tva, tva_sur_debits, frequence_transactions, frequence_paiements) values ('{T}', '2026-03-01', 'exonere', true, 'mois', 'mois')$q$,
      '23514', '%"regimes_ereporting_debits_coherents"'],
    array['controle', '54. un redevable mensuel déclare par décade, sans la fonction', 'postgres', $q$insert into regimes_ereporting (dossier_id, depuis, statut_tva, tva_periodicite, tva_sur_debits, frequence_transactions, frequence_paiements) values ('{T}', '2026-03-01', 'redevable', 'mensuelle', false, 'mois', 'mois')$q$,
      '23514', '%"regimes_ereporting_frequences_ecrites"'],
    array['controle', '54b. un redevable trimestriel, chaque mois, sans la fonction', 'postgres', $q$insert into regimes_ereporting (dossier_id, depuis, statut_tva, tva_periodicite, tva_sur_debits, frequence_transactions, frequence_paiements) values ('{T}', '2026-03-01', 'redevable', 'trimestrielle', false, 'decade', 'mois')$q$,
      '23514', '%"regimes_ereporting_frequences_ecrites"'],
    array['controle', '54c. sur les débits, aucun paiement, sans la fonction', 'postgres', $q$insert into regimes_ereporting (dossier_id, depuis, statut_tva, tva_periodicite, tva_sur_debits, frequence_transactions, frequence_paiements) values ('{T}', '2026-03-01', 'redevable', 'mensuelle', true, 'decade', 'mois')$q$,
      '23514', '%"regimes_ereporting_frequences_ecrites"'],
    array['controle', '54d. sans l''option, les paiements chaque mois, sans la fonction', 'postgres', $q$insert into regimes_ereporting (dossier_id, depuis, statut_tva, tva_periodicite, tva_sur_debits, frequence_transactions, frequence_paiements) values ('{T}', '2026-03-01', 'redevable', 'mensuelle', false, 'decade', null)$q$,
      '23514', '%"regimes_ereporting_frequences_ecrites"'],
    array['controle', '54e. un franchisé, tous les deux mois, sans la fonction', 'postgres', $q$insert into regimes_ereporting (dossier_id, depuis, statut_tva, tva_sur_debits, frequence_transactions, frequence_paiements) values ('{T}', '2026-03-01', 'franchise', false, 'bimestre', 'mois')$q$,
      '23514', '%"regimes_ereporting_frequences_ecrites"'],
    array['controle', '54f. un franchisé, ses ventes aussi, sans la fonction', 'postgres', $q$insert into regimes_ereporting (dossier_id, depuis, statut_tva, tva_sur_debits, frequence_transactions, frequence_paiements) values ('{T}', '2026-03-01', 'franchise', false, 'mois', 'bimestre')$q$,
      '23514', '%"regimes_ereporting_frequences_ecrites"'],
    array['controle', '54g. un exonéré déclare ses paiements, sans la fonction', 'postgres', $q$insert into regimes_ereporting (dossier_id, depuis, statut_tva, tva_sur_debits, frequence_transactions, frequence_paiements) values ('{T}', '2026-03-01', 'exonere', false, 'mois', null)$q$,
      '23514', '%"regimes_ereporting_frequences_ecrites"'],
    array['controle', '54h. la fréquence d''un exonéré n''est pas écrite : la table l''admet libre, la fonction la confirme chaque mois (hypothèse Q4)', 'postgres', $q$insert into regimes_ereporting (dossier_id, depuis, statut_tva, tva_sur_debits, frequence_transactions, frequence_paiements) values ('{T}', '2026-03-01', 'exonere', false, 'decade', 'bimestre')$q$, 'OK', ''],
    array['controle', '55. une fréquence connue, sans la fonction', 'postgres', $q$insert into regimes_ereporting (dossier_id, depuis, statut_tva, tva_sur_debits, frequence_transactions, frequence_paiements) values ('{T}', '2026-03-01', 'exonere', false, 'annee', 'mois')$q$,
      '23514', '%"regimes_ereporting_frequence_transactions"'],
    array['controle', '55b. une fréquence des paiements connue, sans la fonction', 'postgres', $q$insert into regimes_ereporting (dossier_id, depuis, statut_tva, tva_sur_debits, frequence_transactions, frequence_paiements) values ('{T}', '2026-03-01', 'exonere', false, 'mois', 'decade')$q$,
      '23514', '%"regimes_ereporting_frequence_paiements"'],
    array['controle', '56. pas avant l''an 2000, sans la fonction', 'postgres', $q$insert into regimes_ereporting (dossier_id, depuis, statut_tva, tva_sur_debits, frequence_transactions, frequence_paiements) values ('{T}', '1999-12-31', 'franchise', false, 'bimestre', 'bimestre')$q$,
      '23514', '%"regimes_ereporting_depuis"'],
    array['controle', '57. une note faite d''espaces, sans la fonction', 'postgres', $q$insert into regimes_ereporting (dossier_id, depuis, statut_tva, tva_sur_debits, frequence_transactions, frequence_paiements, note) values ('{T}', '2026-03-01', 'franchise', false, 'bimestre', 'bimestre', '  ')$q$,
      '23514', '%"regimes_ereporting_note"'],
    array['controle', '57b. une note de plus de 2 000 caractères, sans la fonction', 'postgres', $q$insert into regimes_ereporting (dossier_id, depuis, statut_tva, tva_sur_debits, frequence_transactions, frequence_paiements, note) values ('{T}', '2026-03-01', 'franchise', false, 'bimestre', 'bimestre', repeat('n', 2001))$q$,
      '23514', '%"regimes_ereporting_note"'],

    -- ══ 60 à 66. Qui écarte une pièce ══════════
    array['controle', '60. anonyme : pas le droit d''appeler', 'anon', $q$select ecarter_piece_ereporting('{T}', '{P1}', 'Vérifiée.')$q$,
      '42501', 'permission denied for function ecarter_piece_ereporting'],
    array['controle', '61. rattaché à rien', 'inconnu', $q$select ecarter_piece_ereporting('{T}', '{P1}', 'Vérifiée.')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '62. client, le dossier d''un autre', 'client', $q$select ecarter_piece_ereporting('{T}', '{P1}', 'Vérifiée.')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '63. client, son propre dossier', 'client', $q$select ecarter_piece_ereporting('{DC}', '{PC}', 'Vérifiée.')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '64. membre du cabinet affecté à un AUTRE dossier', 'membre_ailleurs', $q$select ecarter_piece_ereporting('{T}', '{P1}', 'Vérifiée.')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '65. un dossier qui n''existe pas', 'chef', $q$select ecarter_piece_ereporting('{AUTRE}', '{P1}', 'Vérifiée.')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '66. la pièce d''un autre dossier : introuvable dans celui-ci', 'chef', $q$select ecarter_piece_ereporting('{T}', '{PX}', 'Vérifiée.')$q$, 'P0002', 'Pièce introuvable dans ce dossier.'],

    -- ══ 67 à 72. La pièce, le motif ══════════
    array['controle', '67. une vente n''est jamais candidate', 'chef', $q$select ecarter_piece_ereporting('{T}', '{P4}', 'Vérifiée.')$q$,
      '22023', 'Seule une pièce d''achat ou une note de frais s''écarte de l''e-reporting des achats.'],
    array['controle', '68. une pièce qui a une fiche courante : c''est sa fiche qui se retire', 'chef', $q$select ecarter_piece_ereporting('{T}', '{P2}', 'Vérifiée.')$q$,
      '22023', 'Cette pièce a une fiche « fournisseur établi hors de France » : elle ne s''écarte pas — si elle n''est pas un achat à l''étranger, c''est sa fiche qui se retire.'],
    array['controle', '67b. le type se dit avant le motif', 'chef', $q$select ecarter_piece_ereporting('{T}', '{P4}', null)$q$,
      '22023', 'Seule une pièce d''achat ou une note de frais s''écarte de l''e-reporting des achats.'],
    array['controle', '68b. une fiche retirée puis remplacée : la courante ne l''est pas', 'chef', $q$select ecarter_piece_ereporting('{T}', '{P8}', 'Vérifiée.')$q$,
      '22023', 'Cette pièce a une fiche « fournisseur établi hors de France » : elle ne s''écarte pas — si elle n''est pas un achat à l''étranger, c''est sa fiche qui se retire.'],
    array['controle', '69. une pièce dont la fiche est retirée n''est déjà plus à vérifier', 'chef', $q$select ecarter_piece_ereporting('{T}', '{P3}', 'Vérifiée.')$q$,
      '22023', 'La fiche « fournisseur établi hors de France » de cette pièce est retirée : la pièce n''est déjà plus à vérifier.'],
    array['controle', '69b. une fiche remplacée puis retirée : la courante l''est', 'chef', $q$select ecarter_piece_ereporting('{T}', '{P9}', 'Vérifiée.')$q$,
      '22023', 'La fiche « fournisseur établi hors de France » de cette pièce est retirée : la pièce n''est déjà plus à vérifier.'],
    array['controle', '69c. la fiche se dit avant le motif', 'chef', $q$select ecarter_piece_ereporting('{T}', '{P3}', null)$q$,
      '22023', 'La fiche « fournisseur établi hors de France » de cette pièce est retirée : la pièce n''est déjà plus à vérifier.'],
    array['controle', '70. le motif est à renseigner', 'chef', $q$select ecarter_piece_ereporting('{T}', '{P1}', null)$q$,
      '22023', 'Le motif de l''écart est à renseigner : ce que la vérification a établi.'],
    array['controle', '71. des espaces ne sont pas un motif', 'chef', $q$select ecarter_piece_ereporting('{T}', '{P1}', '   ')$q$,
      '22023', 'Le motif de l''écart est à renseigner : ce que la vérification a établi.'],
    array['controle', '72. un motif de plus de 2 000 caractères', 'chef', $q$select ecarter_piece_ereporting('{T}', '{P1}', repeat('m', 2001))$q$,
      '22023', 'Le motif de l''écart dépasse 2 000 caractères.'],
    array['controle', '72b. 2 000 caractères, si', 'chef', $q$select ecarter_piece_ereporting('{T}', '{P1}', repeat('m', 2000))$q$, 'OK', ''],

    -- ══ 73 à 79. Ce qui s'écrit ══════════
    array['fait', '73. le chef écarte une pièce en dollars d''un fournisseur établi en France', 'chef', $q$select ecarter_piece_ereporting('{T}', '{P1}', 'Fournisseur établi en France : sa facture est en dollars.')$q$, 'OK', ''],
    array['retenir', 'E1', 'postgres', $q$select id::text from pieces_ecartees_ereporting where piece_id = '{P1}'$q$, '', ''],
    array['valeur', '74. l''écart : son dossier, son motif, son auteur, rien de retiré', 'postgres', $q$select (dossier_id = '{T}')::text || ':' || motif || ':' || (cree_par = '{CHEF}')::text || ':' || (retire_le is null and retire_par is null)::text from pieces_ecartees_ereporting where id = '{E1}'$q$, '',
      'true:Fournisseur établi en France : sa facture est en dollars.:true:true'],
    array['controle', '75. une pièce déjà écartée', 'chef', $q$select ecarter_piece_ereporting('{T}', '{P1}', 'Une seconde fois.')$q$,
      '22023', 'Cette pièce est déjà écartée de l''e-reporting.'],
    array['controle', '75b. et c''est l''écart qui se dit avant le motif', 'chef', $q$select ecarter_piece_ereporting('{T}', '{P1}', null)$q$,
      '22023', 'Cette pièce est déjà écartée de l''e-reporting.'],
    array['fait', '76. une note de frais s''écarte aussi', 'chef', $q$select ecarter_piece_ereporting('{T}', '{P5}', 'Frais engagés en France.')$q$, 'OK', ''],
    array['retenir', 'E5', 'postgres', $q$select id::text from pieces_ecartees_ereporting where piece_id = '{P5}'$q$, '', ''],
    array['fait', '77. un achat facturé avec une TVA, tranché par le cabinet (hypothèse Q7 d''e2)', 'chef', $q$select ecarter_piece_ereporting('{T}', '{P7}', 'TVA française facturée : le cabinet a tranché de ne pas le déclarer.')$q$, 'OK', ''],
    array['fait', '78. une pièce écartée, puis décrite par une fiche (la fiche l''emporte)', 'chef', $q$select ecarter_piece_ereporting('{T}', '{PA}', 'Vérifiée.'), enregistrer_fiche_hors_de_france('{T}', '{PA}', null, 'INV-PA', '2026-03-19', '380', null, null, 'DE', '0223', 'DE123456789', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":65,"tva":0}]'::jsonb)$q$, 'OK', ''],
    array['controle', '79. la fiche se dit avant l''écart déjà posé', 'chef', $q$select ecarter_piece_ereporting('{T}', '{PA}', 'Une seconde fois.')$q$,
      '22023', 'Cette pièce a une fiche « fournisseur établi hors de France » : elle ne s''écarte pas — si elle n''est pas un achat à l''étranger, c''est sa fiche qui se retire.'],

    -- ══ 80 à 89. Reprendre une pièce écartée ══════════
    array['controle', '80. anonyme : pas le droit d''appeler', 'anon', $q$select reprendre_piece_ereporting('{T}', '{E1}')$q$,
      '42501', 'permission denied for function reprendre_piece_ereporting'],
    array['controle', '81. rattaché à rien', 'inconnu', $q$select reprendre_piece_ereporting('{T}', '{E1}')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '82. client', 'client', $q$select reprendre_piece_ereporting('{T}', '{E1}')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '83. membre affecté ailleurs', 'membre_ailleurs', $q$select reprendre_piece_ereporting('{T}', '{E1}')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '84. l''écart de T, demandé dans A', 'chef', $q$select reprendre_piece_ereporting('{A}', '{E1}')$q$, 'P0002', 'Écart introuvable dans ce dossier.'],
    array['controle', '84b. un écart qui n''existe pas', 'chef', $q$select reprendre_piece_ereporting('{T}', '{AUTRE}')$q$, 'P0002', 'Écart introuvable dans ce dossier.'],
    array['fait', '85. le chef reprend la note de frais', 'chef', $q$select reprendre_piece_ereporting('{T}', '{E5}')$q$, 'OK', ''],
    array['valeur', '86. l''écart reste, retiré par le chef', 'postgres', $q$select (retire_le is not null)::text || ':' || (retire_par = '{CHEF}')::text from pieces_ecartees_ereporting where id = '{E5}'$q$, '', 'true:true'],
    array['controle', '87. déjà retiré', 'chef', $q$select reprendre_piece_ereporting('{T}', '{E5}')$q$, '22023', 'Cet écart est déjà retiré : la pièce est de nouveau à vérifier.'],
    array['fait', '88. la pièce reprise s''écarte de nouveau', 'chef', $q$select ecarter_piece_ereporting('{T}', '{P5}', 'Revue : frais engagés en France.')$q$, 'OK', ''],
    array['valeur', '89. deux écarts de la note de frais, un seul actif', 'postgres', $q$select count(*) || ':' || count(*) filter (where retire_le is null) from pieces_ecartees_ereporting where piece_id = '{P5}'$q$, '', '2:1'],

    -- ══ 90 à 99. Les autres profils, l'écriture directe, la garde ══════════
    array['controle', '90. le membre affecté au dossier écarte', 'membre', $q$select ecarter_piece_ereporting('{T}', '{P6}', 'Vérifiée par le membre.')$q$, 'OK', ''],
    array['controle', '91. un chef qui n''est pas super-administrateur écarte aussi', 'chef_simple', $q$select ecarter_piece_ereporting('{T}', '{P6}', 'Vérifiée par le chef.')$q$, 'OK', ''],
    array['controle', '92. et le membre affecté reprend', 'membre', $q$select reprendre_piece_ereporting('{T}', '{E1}')$q$, 'OK', ''],
    array['controle', '93. le membre affecté n''écrit pas en direct : les fonctions seules', 'membre', $q$insert into pieces_ecartees_ereporting (dossier_id, piece_id, motif) values ('{T}', '{P6}', 'En direct.')$q$,
      '42501', 'new row violates row-level security policy for table "pieces_ecartees_ereporting"'],
    array['controle', '94. ni le chef qui n''est pas super-administrateur', 'chef_simple', $q$insert into pieces_ecartees_ereporting (dossier_id, piece_id, motif) values ('{T}', '{P6}', 'En direct.')$q$,
      '42501', 'new row violates row-level security policy for table "pieces_ecartees_ereporting"'],
    array['controle', '95. ni le client, sur une pièce de son dossier : la garde la voit, la RLS refuse', 'client', $q$insert into pieces_ecartees_ereporting (dossier_id, piece_id, motif) values ('{DC}', '{PC}', 'En direct.')$q$,
      '42501', 'new row violates row-level security policy for table "pieces_ecartees_ereporting"'],
    array['controle', '96. ni sur une pièce d''un autre dossier : la garde ne la voit pas, et n''en dit rien', 'client', $q$insert into pieces_ecartees_ereporting (dossier_id, piece_id, motif) values ('{T}', '{P6}', 'En direct.')$q$,
      '23514', 'Un écart vise une pièce de son dossier.'],
    array['controle', '97. le super-administrateur insère en direct pour restaurer, retrait compris', 'chef', $q$insert into pieces_ecartees_ereporting (id, dossier_id, piece_id, motif, cree_le, retire_le) values ('{EE}', '{T}', '{P6}', 'Restauré.', '2026-03-20T09:00:00Z', '2026-03-21T09:00:00Z')$q$, 'OK', ''],
    array['controle', '98. un écart vise une pièce de son dossier, même pour le propriétaire', 'postgres', $q$insert into pieces_ecartees_ereporting (dossier_id, piece_id, motif) values ('{T}', '{PX}', 'Ailleurs.')$q$,
      '23514', 'Un écart vise une pièce de son dossier.'],
    array['controle', '99. un écart ne se modifie pas', 'postgres', $q$update pieces_ecartees_ereporting set motif = 'Autre.' where id = '{E1}'$q$,
      '23514', 'Un écart ne se modifie pas : il se retire, une fois.'],
    array['controle', '99b. un retrait ne se défait pas', 'postgres', $q$update pieces_ecartees_ereporting set retire_le = null, retire_par = null where id = '{E5}'$q$,
      '23514', 'Un écart ne se modifie pas : il se retire, une fois.'],
    array['controle', '99c. ni ne se redate', 'postgres', $q$update pieces_ecartees_ereporting set retire_le = retire_le + interval '1 day' where id = '{E5}'$q$,
      '23514', 'Un écart ne se modifie pas : il se retire, une fois.'],
    array['controle', '99d. un retrait qui change de pièce', 'postgres', $q$update pieces_ecartees_ereporting set retire_le = now(), piece_id = '{P6}' where id = '{E1}'$q$,
      '23514', 'Un écart ne se modifie pas : il se retire, une fois.'],
    array['controle', '99e. une écriture qui ne retire rien n''est pas un retrait', 'postgres', $q$update pieces_ecartees_ereporting set retire_le = null where id = '{E1}'$q$,
      '23514', 'Un écart ne se modifie pas : il se retire, une fois.'],
    array['controle', '99f. un retrait en direct, une fois, passe', 'postgres', $q$update pieces_ecartees_ereporting set retire_le = now() where id = '{E1}'$q$, 'OK', ''],
    array['controle', '100. un seul écart actif par pièce, sans la fonction', 'postgres', $q$insert into pieces_ecartees_ereporting (dossier_id, piece_id, motif) values ('{T}', '{P1}', 'Deux fois.')$q$,
      '23505', '%"pieces_ecartees_ereporting_un_actif"'],
    array['controle', '100b. un motif fait d''espaces, sans la fonction', 'postgres', $q$insert into pieces_ecartees_ereporting (dossier_id, piece_id, motif) values ('{T}', '{P6}', '   ')$q$,
      '23514', '%"pieces_ecartees_ereporting_motif"'],
    array['controle', '100c. un motif de plus de 2 000 caractères, sans la fonction', 'postgres', $q$insert into pieces_ecartees_ereporting (dossier_id, piece_id, motif) values ('{T}', '{P6}', repeat('m', 2001))$q$,
      '23514', '%"pieces_ecartees_ereporting_motif"'],

    -- ══ 101 à 104. La pièce écartée ══════════
    array['controle', '101. une pièce écartée ne change pas de dossier', 'postgres', $q$update pieces set dossier_id = '{A}' where id = '{P1}'$q$,
      '23514', 'Cette pièce a été écartée de l''e-reporting : elle ne change plus de dossier.'],
    array['controle', '101b. même reprise : son écart reste dans l''histoire de son dossier', 'postgres', $q$update pieces_ecartees_ereporting set retire_le = now() where id = '{E1}'; update pieces set dossier_id = '{A}' where id = '{P1}'$q$,
      '23514', 'Cette pièce a été écartée de l''e-reporting : elle ne change plus de dossier.'],
    array['controle', '101c. une pièce jamais écartée, si', 'postgres', $q$update pieces set dossier_id = '{A}' where id = '{P6}'$q$, 'OK', ''],
    array['controle', '101d. une écriture de la pièce qui reprend son dossier sans le changer passe', 'postgres', $q$update pieces set dossier_id = dossier_id, date_piece = '2026-03-09' where id = '{P1}'$q$, 'OK', ''],
    array['controle', '102. une fiche posée après l''écart l''emporte : la fonction d''e2 ne lit pas les écarts', 'chef', $q$select enregistrer_fiche_hors_de_france('{T}', '{P1}', null, 'INV-P1', '2026-03-10', '380', null, null, 'IE', '0223', 'IE6388047V', 'services', true, null, null, null, '[{"code":"AE","taux":0,"base":120,"tva":0}]'::jsonb)$q$, 'OK', ''],

    -- ══ 105 à 112. Qui lit ══════════
    array['fait', '105. le chef confirme un régime et écarte une pièce dans le dossier du client', 'chef', $q$select confirmer_regime_ereporting('{DC}', '2026-01-01', 'exonere', null, null, false, 'mois', 'mois', null), ecarter_piece_ereporting('{DC}', '{PC}', 'Vérifiée.')$q$, 'OK', ''],
    array['lecture', '106. le client ne lit ni régime ni écart, pas même ceux de son dossier', 'client', $q$select (select count(*) from regimes_ereporting) || ':' || (select count(*) from pieces_ecartees_ereporting)$q$, '', '0:0'],
    array['lecture', '107. le compte rattaché à rien non plus', 'inconnu', $q$select (select count(*) from regimes_ereporting) || ':' || (select count(*) from pieces_ecartees_ereporting)$q$, '', '0:0'],
    array['lecture', '108. l''anonyme non plus', 'anon', $q$select (select count(*) from regimes_ereporting) || ':' || (select count(*) from pieces_ecartees_ereporting)$q$, '', '0:0'],
    array['lecture', '109. le membre affecté à T en lit les régimes et les écarts, et eux seuls', 'membre', $q$select (select count(*) from regimes_ereporting where dossier_id = '{T}') || ':' || (select count(*) from regimes_ereporting where dossier_id <> '{T}') || ':' || (select count(*) from pieces_ecartees_ereporting where dossier_id = '{T}') || ':' || (select count(*) from pieces_ecartees_ereporting where dossier_id <> '{T}')$q$, '', '5:0:5:0'],
    array['lecture', '110. le membre affecté à un autre dossier n''en lit aucun de T', 'membre_ailleurs', $q$select (select count(*) from regimes_ereporting where dossier_id = '{T}') || ':' || (select count(*) from pieces_ecartees_ereporting where dossier_id = '{T}')$q$, '', '0:0'],

    -- ══ 140 à 147. Les mutations : chacune doit MORDRE ══════════
    array['lecture', '140. MUTATION — le contrôle 106 sans le changement de rôle : il doit voir ceux du dossier du client', 'postgres', $q$select ((select count(*) from regimes_ereporting where dossier_id = '{DC}') > 0)::text || ':' || ((select count(*) from pieces_ecartees_ereporting where dossier_id = '{DC}') > 0)::text$q$, '', 'true:true'],
    array['controle', '141. MUTATION — le contrôle 4 joué sous le chef : il doit passer', 'chef', $q$select confirmer_regime_ereporting('{DC}', '2026-02-01', 'franchise', null, null, false, 'bimestre', 'bimestre', null)$q$, 'OK', ''],
    array['controle', '142. MUTATION — le contrôle 5 affecté au BON dossier : il doit passer', 'membre', $q$select confirmer_regime_ereporting('{T}', '2026-03-01', 'franchise', null, null, false, 'bimestre', 'bimestre', null)$q$, 'OK', ''],
    array['controle', '143. MUTATION — le contrôle 63 joué sous le chef : il doit passer', 'chef', $q$select reprendre_piece_ereporting('{DC}', (select id from pieces_ecartees_ereporting where piece_id = '{PC}'))$q$, 'OK', ''],
    array['controle', '144. MUTATION — le contrôle 44 joué sous le chef (super-administrateur) : l''insertion doit passer', 'chef', $q$insert into regimes_ereporting (dossier_id, depuis, statut_tva, tva_sur_debits, frequence_transactions, frequence_paiements) values ('{T}', '2026-03-01', 'franchise', false, 'bimestre', 'bimestre')$q$, 'OK', ''],
    array['controle', '145. MUTATION — le contrôle 96 joué sous le chef : la garde voit la pièce, l''insertion passe', 'chef', $q$insert into pieces_ecartees_ereporting (dossier_id, piece_id, motif) values ('{T}', '{P6}', 'En direct.')$q$, 'OK', ''],
    array['lecture', '146. MUTATION — le contrôle 110 affecté au BON dossier : il doit voir ceux de T', 'membre', $q$select ((select count(*) from regimes_ereporting where dossier_id = '{T}') > 0)::text || ':' || ((select count(*) from pieces_ecartees_ereporting where dossier_id = '{T}') > 0)::text$q$, '', 'true:true'],
    array['controle', '147. MUTATION — le contrôle 67 sur un achat sans fiche : il doit passer', 'chef', $q$select ecarter_piece_ereporting('{T}', '{P6}', 'Vérifiée.')$q$, 'OK', ''],

    -- ══ 150 à 156. Ce que le catalogue dit ══════════
    array['valeur', '150. les droits d''exécution (anonyme, connecté)', 'postgres', $q$select string_agg(f || ':' || has_function_privilege('anon', 'public.' || f || a, 'execute') || ':' || has_function_privilege('authenticated', 'public.' || f || a, 'execute'), ',' order by f collate "C") from (values
      ('confirmer_regime_ereporting', '(uuid, date, text, text, text, boolean, text, text, text)'), ('retirer_regime_ereporting', '(uuid, uuid)'),
      ('ecarter_piece_ereporting', '(uuid, uuid, text)'), ('reprendre_piece_ereporting', '(uuid, uuid)'), ('cle_ereporting', '(uuid)'),
      ('garder_regime_ereporting', '()'), ('garder_ecart_ereporting', '()'), ('garder_piece_ecartee', '()')) as t(f, a)$q$, '',
      'cle_ereporting:false:false,confirmer_regime_ereporting:false:true,ecarter_piece_ereporting:false:true,garder_ecart_ereporting:false:false,garder_piece_ecartee:false:false,garder_regime_ereporting:false:false,reprendre_piece_ereporting:false:true,retirer_regime_ereporting:false:true'],
    array['valeur', '151. ce qui contourne la RLS, et ce qui ne la contourne pas', 'postgres', $q$select string_agg(proname || ':' || prosecdef, ',' order by proname collate "C") from pg_proc where pronamespace = 'public'::regnamespace and proname in ('confirmer_regime_ereporting', 'retirer_regime_ereporting', 'ecarter_piece_ereporting', 'reprendre_piece_ereporting', 'cle_ereporting', 'garder_regime_ereporting', 'garder_ecart_ereporting', 'garder_piece_ecartee')$q$, '',
      'cle_ereporting:false,confirmer_regime_ereporting:true,ecarter_piece_ereporting:true,garder_ecart_ereporting:false,garder_piece_ecartee:true,garder_regime_ereporting:false,reprendre_piece_ereporting:true,retirer_regime_ereporting:true'],
    array['valeur', '152. quatre policies : la lecture sous admin_du_dossier, l''insertion du super-administrateur, aux connectés, aucune branche client', 'postgres', $q$select string_agg(tablename || ':' || policyname || ':' || cmd || ':' || array_to_string(roles, ',') || ':' || coalesce(qual, '-') || ':' || coalesce(with_check, '-'), ',' order by policyname collate "C") from pg_policies where schemaname = 'public' and tablename in ('regimes_ereporting', 'pieces_ecartees_ereporting')$q$, '',
      'pieces_ecartees_ereporting:pieces_ecartees_ereporting_lecture:SELECT:authenticated:admin_du_dossier(dossier_id):-,pieces_ecartees_ereporting:pieces_ecartees_ereporting_restauration:INSERT:authenticated:-:is_super_admin(),regimes_ereporting:regimes_ereporting_lecture:SELECT:authenticated:admin_du_dossier(dossier_id):-,regimes_ereporting:regimes_ereporting_restauration:INSERT:authenticated:-:is_super_admin()'],
    array['valeur', '153. la RLS est active sur les deux tables', 'postgres', $q$select string_agg(relname || ':' || relrowsecurity, ',' order by relname collate "C") from pg_class where oid in ('public.regimes_ereporting'::regclass, 'public.pieces_ecartees_ereporting'::regclass)$q$, '',
      'pieces_ecartees_ereporting:true,regimes_ereporting:true'],
    array['valeur', '154. les trois déclencheurs, actifs, et les deux gardes veillent aussi sur la suppression (jouée sur la réplique)', 'postgres', $q$select string_agg(pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text, ' | ' order by t.tgname collate "C") from pg_trigger t where t.tgname in ('regimes_ereporting_gardes', 'pieces_ecartees_ereporting_gardes', 'pieces_ecartees_ereporting_dossier') and not t.tgisinternal$q$, '',
      'CREATE TRIGGER pieces_ecartees_ereporting_dossier BEFORE UPDATE OF dossier_id ON public.pieces FOR EACH ROW EXECUTE FUNCTION garder_piece_ecartee() O'
      || ' | CREATE TRIGGER pieces_ecartees_ereporting_gardes BEFORE INSERT OR DELETE OR UPDATE ON public.pieces_ecartees_ereporting FOR EACH ROW EXECUTE FUNCTION garder_ecart_ereporting() O'
      || ' | CREATE TRIGGER regimes_ereporting_gardes BEFORE DELETE OR UPDATE ON public.regimes_ereporting FOR EACH ROW EXECUTE FUNCTION garder_regime_ereporting() O'],
    array['valeur', '155. les clés : le régime part avec son dossier, l''écart avec sa pièce et son dossier', 'postgres', $q$select string_agg(c.conrelid::regclass::text || '.' || a.attname || '>' || c.confrelid::regclass::text || ':' || c.confdeltype::text, ',' order by c.conrelid::regclass::text collate "C", a.attname collate "C") from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1] where c.contype = 'f' and c.conrelid in ('public.regimes_ereporting'::regclass, 'public.pieces_ecartees_ereporting'::regclass)$q$, '',
      'pieces_ecartees_ereporting.dossier_id>dossiers:c,pieces_ecartees_ereporting.piece_id>pieces:c,regimes_ereporting.dossier_id>dossiers:c'],
    array['valeur', '156. les fonctions qui nomment les deux tables : celles de la migration, celles de la déclaration hors application (e5b1), et elles seules', 'postgres', $q$select string_agg(proname, ',' order by proname collate "C") from pg_proc where pronamespace = 'public'::regnamespace and prosrc ~ '(regimes_ereporting|pieces_ecartees_ereporting)'$q$, '',
      'confirmer_regime_ereporting,declarer_ereporting_hors_application,ecarter_piece_ereporting,garder_declaration_ereporting,garder_piece_ecartee,reprendre_piece_ereporting,retirer_regime_ereporting']
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
    ((select count(*) from dossiers)), ((select count(*) from pieces)), ((select count(*) from regimes_ereporting)),
    ((select count(*) from pieces_ecartees_ereporting)), ((select count(*) from pieces_hors_de_france)),
    ((select count(*) from pieces_hors_de_france_taux)), ((select count(*) from cabinet_admins)),
    ((select count(*) from dossier_assignations)), ((select count(*) from memberships))
  ) as t(n);
  verdicts := verdicts || jsonb_build_object('controle', '199. rien n''est resté en base',
    'observe', avant || ' -> ' || apres,
    'ok', avant = apres and not exists (select 1 from dossiers where nom like 'ESSAI REGIMES%')
      and not exists (select 1 from cabinet_admins where user_id = client));

  perform set_config('essai.regimes_ereporting', verdicts::text, true);
end $essai$;

-- Un verdict qui n'a pas pu se calculer est une faute, pas un silence. La ligne 0 dit le texte que la base a reçu — par
-- l'outil MCP, qui ajoute sa signature après lui —, pour le comparer au fichier par son empreinte.
select x.controle, x.ok, x.observe from (
  select v.controle, coalesce(v.ok, false) as ok, v.observe
  from jsonb_to_recordset(current_setting('essai.regimes_ereporting')::jsonb) as v(controle text, ok boolean, observe text)
  union all
  select '0. information : le texte reçu par la base', true, length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by (regexp_match(x.controle, '^(\d+)'))[1]::int, x.controle;
