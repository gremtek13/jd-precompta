-- LA GARDE DES RÈGLEMENTS JUGE CE QUE LA PIÈCE CITÉE A REÇU (ligne 51.5, A8Q5Q3Q2-Q2 ; la migration préparée
-- `reglements_de_la_piece_citee`, supabase/preparees/20261115130000_reglements_de_la_piece_citee.sql). Le récit :
-- HISTORIQUE.md, « 15/11/2026 — A8Q5Q3Q2-Q2 : LA GARDE DES RÈGLEMENTS JUGE CE QUE LA PIÈCE CITÉE A REÇU ». À rejouer après
-- toute migration qui touche `garder_recu_d_une_piece_citee`, `garder_reglement_d_une_piece_reprise`, `recu_par_la_piece`,
-- `enregistrer_encaissement`, `citer_piece_de_facture_reprise`, les fonctions de la caisse, `regler_pieces_par_mouvement`
-- ou les tables des paiements d'une pièce. SANS LA MIGRATION (la garde et ses trois déclencheurs absents du catalogue), il
-- se dit EN ATTENTE ; recuParLaPieceCitee.sql et pieceDUneFactureReprise.sql jouent le reste du mécanisme.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   1. LE CATALOGUE : la garde aux droits de son propriétaire, son chemin fixé, exécutable par aucun rôle de session ; ses
--      cinq déclencheurs différés jusqu'à la fin de la transaction, dont deux de l'image d'avant ;
--   2. CE QUI MONTE ET SE REFUSE, quand le registre de la facture reprise a déjà des encaissements : un mouvement rapproché
--      de la pièce, la part d'un virement groupé, un paiement par la caisse, sa correction, le statut seul qui passe
--      « rapproché », un mouvement marqué réglé en groupe sous une part posée à la main — refusés quand le registre et ce
--      reçu dépassent ensemble ce que la facture porte, ou qu'elle porte plusieurs taux ; acceptés juste à ce qu'elle porte ;
--   3. CE QUI PASSE : le registre vide (et le registre refuse ensuite), le déclaré qui couvre le reçu, le lien retiré, une
--      pièce jamais citée, ce qui fait baisser le reçu (un rejet) même sur un état déjà fautif, un mouvement d'un autre
--      dossier (A8Q5-Q4, ouverte : il ne compte pas dans le reçu) ; et la correction d'un paiement en espèces, qui écrit le
--      nouveau avant de retirer l'ancien, jugée une fois finie ;
--   4. LA GARDE DES RÈGLEMENTS garde son rang et ses mots : un paiement du jour de la reprise se refuse à l'écriture, par elle ;
--   5. CE QUI DÉFAISAIT LE REÇU ET NE LE DÉFAIT PLUS (relecture adverse du 15/11/2026) : un rejet dont le rapprochement
--      s'annule, qui s'ignore ou passe à une autre pièce, une part négative d'un virement groupé qui monte ou cesse de
--      compter — refusés comme ce qui monte ; le registre vide, ou ce qui baisse, passent.
--
-- Deux dossiers jetables du cabinet du dossier `test` (préfixe `a8540000-0000-4000-8000`) : DQ, basculé, en trésorerie,
-- redevable ; DR, nu. Les pièces de vente P (l'original de la facture reprise, 120 € TTC, datée du 20 novembre de N) et Q
-- (jamais citée, 120 € TTC), déclarées ventes hors des factures et validées ; la facture de l'ancien logiciel R-Q2Q2-1,
-- importée à chaque étape sous la forme qu'elle demande — à un taux (100 € HT à 20 %, 120 € TTC) ou à deux (100 € HT à 20 %
-- et 100 € HT à 10 %, 230 € TTC) — avec ce qu'elle déclare encaissé avant la reprise, puis P citée et le registre garni.
-- N est l'année qui précède la date de reprise (le premier jour du mois de Paris) ; les paiements de P sont du 10 décembre
-- de N, les encaissements du registre du jour de la reprise. Chaque étape se joue dans sa sous-transaction et s'y ANNULE
-- (`ANNULATION_ETAPE`) : ce que le propriétaire pose d'abord, ce que le chef pose ensuite, ce que le propriétaire pose
-- après (un paiement que seule la garde neuve refuserait : son déclencheur coupé le temps de l'écrire), puis le geste du
-- chef, puis la fin de la transaction simulée (`set constraints all immediate` : les déclencheurs différés jugent alors),
-- puis ce qu'on relit ; le jeu s'annule à la fin (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le relit. Les
-- verdicts voyagent dans un réglage LOCAL à la transaction (`essai.reglements_de_la_piece_citee`) : le fichier se joue d'un
-- seul appel, ne crée ni table ni fonction, ne contient aucune instruction de suppression, et ne rend rien qui dépende d'une
-- ligne hors de ses dossiers. Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`).
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dq constant text := 'a8540000-0000-4000-8000-0000000000d1';
  dr constant text := 'a8540000-0000-4000-8000-0000000000d2';
  p constant text := 'a8540000-0000-4000-8000-0000000000b1';
  q constant text := 'a8540000-0000-4000-8000-0000000000b2';
  m1 constant text := 'a8540000-0000-4000-8000-0000000000e1';
  m2 constant text := 'a8540000-0000-4000-8000-0000000000e2';
  m3 constant text := 'a8540000-0000-4000-8000-0000000000e3';
  m4 constant text := 'a8540000-0000-4000-8000-0000000000e4';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  reprise constant date := date_trunc('month', now() at time zone 'Europe/Paris')::date;
  date_p constant date := make_date(extract(year from reprise)::integer - 1, 11, 20);
  date_m constant date := make_date(extract(year from reprise)::integer - 1, 12, 10);
  -- La migration en base : la garde et ses cinq déclencheurs au catalogue.
  appliquee constant boolean := to_regprocedure('public.garder_recu_d_une_piece_citee()') is not null
    and (select count(*) from pg_trigger t where t.tgname like '%recu_d_une_piece_citee' and not t.tgisinternal) = 5;
  -- La facture de l'ancien logiciel : à un taux, ou à deux ; ce qu'elle déclare encaissé avant la reprise.
  un_taux constant text := '[{"numero": "R-Q2Q2-1", "type": "facture", "date_emission": "{DP}", "tiers_nom": "Client Q2Q2",
    "type_client": "non_assujetti", "nature_operation": "services", "option_debits": false, "montant_ht": 100,
    "montant_tva": 20, "montant_ttc": 120, "encaisse_avant_reprise": {E}, "encaisse_par_taux": [{"taux": 20, "encaisse": {E}}],
    "lignes": [{"designation": "Prestation", "quantite": 1, "prix_unitaire_ht": 100, "taux_tva": 20}], "transmise_par": "pdf"}]';
  deux_taux constant text := '[{"numero": "R-Q2Q2-1", "type": "facture", "date_emission": "{DP}", "tiers_nom": "Client Q2Q2",
    "type_client": "non_assujetti", "nature_operation": "services", "option_debits": false, "montant_ht": 200,
    "montant_tva": 30, "montant_ttc": 230, "encaisse_avant_reprise": {E}, "encaisse_par_taux": [{"taux": 20, "encaisse": {E20}}, {"taux": 10, "encaisse": {E10}}],
    "lignes": [{"designation": "Prestation A", "quantite": 1, "prix_unitaire_ht": 100, "taux_tva": 20},
               {"designation": "Prestation B", "quantite": 1, "prix_unitaire_ht": 100, "taux_tva": 10}], "transmise_par": "pdf"}]';
  importer constant text := $q$select fixer_reprise_des_factures('{DQ}', '{R}'); select importer_factures('{DQ}', '{"format": "csv"}'::jsonb, '{L}'::jsonb);$q$;
  citer constant text := $q$select citer_piece_de_facture_reprise('{DQ}', {R1}, '{P}');$q$;
  encaisser constant text := $q$select enregistrer_encaissement('{DQ}', {R1}, '{R}', {MONTANT}, 'virement', null, '[{"taux": 20, "montant": {MONTANT}}]'::jsonb);$q$;
  -- Le registre garni de {MONTANT} € à 20 %, sur la facture à un taux qui déclare {E} € encaissés avant la reprise.
  garni constant text := replace(importer, '{L}', un_taux) || citer || encaisser;
  -- La facture à deux taux qui déclare {E} € encaissés avant la reprise ({E20} € à 20 %, {E10} € à 10 %), citée.
  deux_taux_cites constant text := replace(importer, '{L}', deux_taux) || citer;
  -- L'état déjà fautif, posé par le propriétaire, la garde coupée : 50 € reçus par la pièce par-dessus 100 € encaissés.
  fautif constant text := $q$alter table lignes_bancaires disable trigger lignes_bancaires_recu_d_une_piece_citee;
    update lignes_bancaires set statut = 'rapprochee', piece_id = '{P}' where id = '{M1}';
    alter table lignes_bancaires enable trigger lignes_bancaires_recu_d_une_piece_citee;$q$;
  mouvement_fautif constant text := $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values ('{M1}', '{DQ}', '{DM}', 'ESSAI A8Q5Q3Q2Q2 PAIEMENT', 50, 'non_rapprochee');$q$;
  -- Un mouvement de {X} € du 10 décembre de N, rapproché de la pièce {PIECE} : le geste de l'onglet Banque.
  rapprocher constant text := $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values
    ('{M}', '{DQ}', '{DM}', 'ESSAI A8Q5Q3Q2Q2 PAIEMENT', {X}, 'non_rapprochee');
    update lignes_bancaires set statut = 'rapprochee', piece_id = '{PIECE}' where id = '{M}';$q$;
  recu constant text := $q$recu_par_la_piece('{P}')::text$q$;
  -- Un paiement de 50 € et son rejet (−50 €), du 10 décembre de N, rapprochés de la pièce : ce qu'elle a reçu est nul.
  paiement_et_rejet constant text := $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values
    ('{M1}', '{DQ}', '{DM}', 'ESSAI A8Q5Q3Q2Q2 PAIEMENT', 50, 'non_rapprochee'), ('{M3}', '{DQ}', '{DM}', 'ESSAI A8Q5Q3Q2Q2 REJET', -50, 'non_rapprochee');
    update lignes_bancaires set statut = 'rapprochee', piece_id = '{P}' where id in ('{M1}', '{M3}');$q$;
  -- Ce que la pose a écrit, jugé avant le geste : la fin d'une transaction, simulée.
  jugee constant text := $q$ set constraints all immediate; set constraints all deferred;$q$;
  -- Un paiement de 50 € rapproché de la pièce, et un virement groupé de 70 € qui lui reprend 50 € (une part négative) et
  -- règle 120 € de l'autre pièce : ce qu'elle a reçu est nul. Posé par le propriétaire, les déclencheurs de la garde coupés.
  part_negative constant text := $q$alter table lignes_bancaires disable trigger lignes_bancaires_recu_d_une_piece_citee;
    alter table lignes_bancaires disable trigger lignes_bancaires_depart_recu_d_une_piece_citee;
    alter table reglements_groupes disable trigger reglements_groupes_recu_d_une_piece_citee;
    alter table reglements_groupes disable trigger reglements_groupes_depart_recu_d_une_piece_citee;
    update lignes_bancaires set statut = 'rapprochee', piece_id = '{P}' where id = '{M1}';
    update lignes_bancaires set statut = 'rapprochee', reglement_groupe = true where id = '{M2}';
    insert into reglements_groupes (dossier_id, ligne_bancaire_id, piece_id, montant) values ('{DQ}', '{M2}', '{P}', -50), ('{DQ}', '{M2}', '{Q}', 120);
    alter table lignes_bancaires enable trigger lignes_bancaires_recu_d_une_piece_citee;
    alter table lignes_bancaires enable trigger lignes_bancaires_depart_recu_d_une_piece_citee;
    alter table reglements_groupes enable trigger reglements_groupes_recu_d_une_piece_citee;
    alter table reglements_groupes enable trigger reglements_groupes_depart_recu_d_une_piece_citee;$q$;
  mouvements_de_la_part_negative constant text := $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values
    ('{M1}', '{DQ}', '{DM}', 'ESSAI A8Q5Q3Q2Q2 PAIEMENT', 50, 'non_rapprochee'), ('{M2}', '{DQ}', '{DM}', 'ESSAI A8Q5Q3Q2Q2 GROUPE', 70, 'non_rapprochee');$q$;
  deja_encaissee constant text := 'Cette pièce est l''original d''une facture reprise dont le registre a déjà reçu des encaissements : avec ce paiement, ce qu''elle a reçu avant la reprise et ce registre dépasseraient ensemble ce que la facture porte, nette de ses avoirs, et la même vente compterait deux fois. Le cabinet retire d''abord ces encaissements, ou ce paiement ne règle pas cette pièce.';
  plusieurs_taux constant text := 'Cette pièce est l''original d''une facture reprise qui porte plusieurs taux de TVA et dont le registre a déjà reçu des encaissements : avec ce paiement, elle aurait reçu avant la reprise plus que l''import n''en déclare encaissé, et le registre ne saurait plus sur lesquels il a porté. Le cabinet retire d''abord ces encaissements, ou reprend l''import en y déclarant, taux par taux, ce que la pièce a reçu.';
  date_de_la_garde constant text := 'La pièce « essai-q2q2-p.pdf » est l''original de la facture reprise R-Q2Q2-1 : ses règlements datés de la reprise des factures (le {RJ}) ou d''après passent par le registre de la facture, et le règlement du {RJ} ne la cite pas.';
  e record; v_code text; v_msg text; v_f record; v_texte text; v_textes text[]; v_obs text;
  verdicts jsonb := '[]'::jsonb;
begin
  if not appliquee then
    perform set_config('essai.reglements_de_la_piece_citee', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration reglements_de_la_piece_citee (A8Q5Q3Q2-Q2)', 'ok', true,
      'observe', 'absente : un paiement d''avant la reprise rapproché après le registre passe encore ; l''essai se joue dès qu''elle y est'))::text, true);
    return;
  end if;
  begin
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, ventes_par_les_factures, statut_tva, siret,
                          adresse, forme_juridique, denomination_imprimee) values
      (dq::uuid, 'ESSAI A8Q5Q3Q2Q2 DQ', cabinet, 'tresorerie', '455000', true, 'redevable', '12345678200010',
       'ESSAI A8Q5Q3Q2Q2 ADRESSE', '5710', 'ESSAI A8Q5Q3Q2Q2 SOCIÉTÉ');
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values
      (dr::uuid, 'ESSAI A8Q5Q3Q2Q2 DR', cabinet, 'tresorerie', '455000');
    insert into pieces (id, dossier_id, storage_path, nom_fichier, storage_hash, type_piece, statut, date_piece, montant_ht,
                        montant_tva, montant_ttc) values
      (p::uuid, dq::uuid, dq || '/essai-q2q2-p.pdf', 'essai-q2q2-p.pdf', repeat('c', 64), 'vente', 'a_valider', date_p, 100, 20, 120),
      (q::uuid, dq::uuid, dq || '/essai-q2q2-q.pdf', 'essai-q2q2-q.pdf', repeat('d', 64), 'vente', 'a_valider', date_p, 100, 20, 120);
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform declarer_vente_hors_des_factures(dq::uuid, p::uuid);
    perform declarer_vente_hors_des_factures(dq::uuid, q::uuid);
    update pieces set statut = 'validee' where id in (p::uuid, q::uuid);
    reset role;
    perform set_config('request.jwt.claims', '', true);

    -- Une étape : {rang, étape, ce que le propriétaire pose d'abord, ce que le chef pose ensuite, ce que le propriétaire
    -- pose après, le geste du chef, ce qu'on relit après la fin simulée de la transaction, le code attendu (`OK` : accepté)
    -- et ce qu'on relit, ou les mots du refus}.
    for e in select * from (values
      (1, '1. le catalogue : la garde aux droits de son propriétaire, son chemin fixé, exécutable par aucun rôle de session ; cinq déclencheurs différés, dont deux de l''image d''avant',
        null, null, null, null,
        $q$(select p.prosecdef::text || ' ' || array_to_string(p.proconfig, ',') from pg_proc p where p.oid = 'public.garder_recu_d_une_piece_citee()'::regprocedure)
           || ' ' || has_function_privilege('authenticated', 'public.garder_recu_d_une_piece_citee()', 'execute')
           || ' ' || has_function_privilege('anon', 'public.garder_recu_d_une_piece_citee()', 'execute')
           || ' ' || has_function_privilege('service_role', 'public.garder_recu_d_une_piece_citee()', 'execute')
           || ' ' || (select string_agg(t.tgrelid::regclass::text || ':' || t.tgtype || ':' || t.tgdeferrable || ':' || t.tginitdeferred || ':' || t.tgenabled::text, ',' order by t.tgname collate "C")
                        from pg_trigger t where t.tgname like '%recu_d_une_piece_citee' and not t.tgisinternal)$q$,
        'OK', 'true search_path=public false false false lignes_bancaires:25:true:true:O,lignes_bancaires:21:true:true:O,operations_caisse:5:true:true:O,reglements_groupes:25:true:true:O,reglements_groupes:21:true:true:O'),
      (2, '2. un taux, le registre a reçu 100 € : un mouvement de 20 € du 10 décembre rapproché de la pièce — ensemble, juste ce qu''elle porte : accepté',
        null, replace(replace(garni, '{E}', '0'), '{MONTANT}', '100'), null,
        replace(replace(replace(rapprocher, '{M}', '{M1}'), '{X}', '20'), '{PIECE}', '{P}'), recu, 'OK', '2000'),
      (3, '3. … 21 € : refusé à la fin du geste',
        null, replace(replace(garni, '{E}', '0'), '{MONTANT}', '100'), null,
        replace(replace(replace(rapprocher, '{M}', '{M1}'), '{X}', '21'), '{PIECE}', '{P}'), recu, '23514', deja_encaissee),
      (4, '4. la part d''un virement groupé (regler_pieces_par_mouvement) : 21 € pour la pièce, 24 € pour une autre — refusé',
        null, replace(replace(garni, '{E}', '0'), '{MONTANT}', '100'), null,
        $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values ('{M2}', '{DQ}', '{DM}', 'ESSAI A8Q5Q3Q2Q2 GROUPE', 45, 'non_rapprochee');
           select regler_pieces_par_mouvement('{M2}', '[{"piece_id": "{P}", "montant": 21}, {"piece_id": "{Q}", "montant": 24}]'::jsonb);$q$,
        recu, '23514', deja_encaissee),
      (5, '4b. … 20 € pour la pièce, 25 € pour l''autre : accepté',
        null, replace(replace(garni, '{E}', '0'), '{MONTANT}', '100'), null,
        $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values ('{M2}', '{DQ}', '{DM}', 'ESSAI A8Q5Q3Q2Q2 GROUPE', 45, 'non_rapprochee');
           select regler_pieces_par_mouvement('{M2}', '[{"piece_id": "{P}", "montant": 20}, {"piece_id": "{Q}", "montant": 25}]'::jsonb);$q$,
        recu, 'OK', '2000'),
      (6, '5. un paiement par la caisse (regler_piece_par_la_caisse) de 21 € : refusé',
        null, replace(replace(garni, '{E}', '0'), '{MONTANT}', '100'), null,
        $q$select regler_piece_par_la_caisse('{DQ}', '{P}', '{DM}', 21);$q$, recu, '23514', deja_encaissee),
      (7, '5b. … de 20 € : accepté',
        null, replace(replace(garni, '{E}', '0'), '{MONTANT}', '100'), null,
        $q$select regler_piece_par_la_caisse('{DQ}', '{P}', '{DM}', 20);$q$, recu, 'OK', '2000'),
      (8, '6. sa correction (remplacer_paiement_par_la_caisse) de 20 € à 19 € : acceptée — jugée finie, pas au nouveau paiement écrit avant le retrait de l''ancien (39 € de passage)',
        null, replace(replace(garni, '{E}', '0'), '{MONTANT}', '100') || $q$ select regler_piece_par_la_caisse('{DQ}', '{P}', '{DM}', 20);$q$, null,
        $q$select remplacer_paiement_par_la_caisse('{DQ}', (select o.id from operations_caisse o where o.piece_id = '{P}' and o.retire_le is null), '{DM}', 19);$q$,
        recu, 'OK', '1900'),
      (9, '6b. … de 20 € à 21 € : refusée',
        null, replace(replace(garni, '{E}', '0'), '{MONTANT}', '100') || $q$ select regler_piece_par_la_caisse('{DQ}', '{P}', '{DM}', 20);$q$, null,
        $q$select remplacer_paiement_par_la_caisse('{DQ}', (select o.id from operations_caisse o where o.piece_id = '{P}' and o.retire_le is null), '{DM}', 21);$q$,
        recu, '23514', deja_encaissee),
      (10, '7. deux taux, le registre a reçu 10 € à 20 % : un mouvement de 30 € rapproché de la pièce — refusé plutôt que deviner',
        null, replace(replace(replace(deux_taux_cites, '{E20}', '0'), '{E10}', '0'), '{E}', '0') || replace(encaisser, '{MONTANT}', '10'), null,
        replace(replace(replace(rapprocher, '{M}', '{M1}'), '{X}', '30'), '{PIECE}', '{P}'), recu, '23514', plusieurs_taux),
      (11, '7b. … le registre vide : 30 € passent',
        null, replace(replace(replace(deux_taux_cites, '{E20}', '0'), '{E10}', '0'), '{E}', '0'), null,
        replace(replace(replace(rapprocher, '{M}', '{M1}'), '{X}', '30'), '{PIECE}', '{P}'), recu, 'OK', '3000'),
      (12, '7c. … le déclaré (100 € : 90 € à 20 %, 10 € à 10 %) couvre le reçu (30 €), le registre a reçu 10 € à 10 % : passe',
        null, replace(replace(replace(deux_taux_cites, '{E20}', '90'), '{E10}', '10'), '{E}', '100')
          || $q$ select enregistrer_encaissement('{DQ}', {R1}, '{R}', 10, 'virement', null, '[{"taux": 10, "montant": 10}]'::jsonb);$q$, null,
        replace(replace(replace(rapprocher, '{M}', '{M1}'), '{X}', '30'), '{PIECE}', '{P}'), recu, 'OK', '3000'),
      (13, '8. le registre vide : 120 € rapprochés passent',
        null, replace(replace(importer, '{L}', un_taux), '{E}', '0') || citer, null,
        replace(replace(replace(rapprocher, '{M}', '{M1}'), '{X}', '120'), '{PIECE}', '{P}'), recu, 'OK', '12000'),
      (14, '8b. … et le registre refuse ensuite d''encaisser la même vente (A8Q5Q3-Q2) : il reste 0,00 €',
        null, replace(replace(importer, '{L}', un_taux), '{E}', '0') || citer
          || replace(replace(replace(rapprocher, '{M}', '{M1}'), '{X}', '120'), '{PIECE}', '{P}'), null,
        replace(encaisser, '{MONTANT}', '1'), null, '22023',
        'L''encaissement dépasserait ce que la facture reprise porte encore, nette de ses avoirs et de ce qui en était encaissé avant la reprise : il reste 0,00 € à encaisser.'),
      (15, '9. le déclaré (80 €) couvre le reçu : le registre a reçu 30 €, un mouvement de 50 € passe',
        null, replace(replace(garni, '{E}', '80'), '{MONTANT}', '30'), null,
        replace(replace(replace(rapprocher, '{M}', '{M1}'), '{X}', '50'), '{PIECE}', '{P}'), recu, 'OK', '5000'),
      (16, '9b. … 90 € : le reçu dépasse le déclaré, et le registre et lui font juste ce qu''elle porte : accepté',
        null, replace(replace(garni, '{E}', '80'), '{MONTANT}', '30'), null,
        replace(replace(replace(rapprocher, '{M}', '{M1}'), '{X}', '90'), '{PIECE}', '{P}'), recu, 'OK', '9000'),
      (17, '9c. … 91 € : refusé',
        null, replace(replace(garni, '{E}', '80'), '{MONTANT}', '30'), null,
        replace(replace(replace(rapprocher, '{M}', '{M1}'), '{X}', '91'), '{PIECE}', '{P}'), recu, '23514', deja_encaissee),
      (18, '10. le statut seul : un mouvement de 21 € qui cite déjà la pièce, à traiter, passe « rapproché » — refusé',
        null, replace(replace(garni, '{E}', '0'), '{MONTANT}', '100'), null,
        $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut, piece_id) values ('{M1}', '{DQ}', '{DM}', 'ESSAI A8Q5Q3Q2Q2 A TRAITER', 21, 'non_rapprochee', '{P}');
           update lignes_bancaires set statut = 'rapprochee' where id = '{M1}';$q$, recu, '23514', deja_encaissee),
      (19, '11. le règlement groupé posé à la main : une part de 21 € sur un mouvement à traiter, puis le mouvement marqué réglé en groupe — refusé',
        null, replace(replace(garni, '{E}', '0'), '{MONTANT}', '100'), null,
        $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values ('{M2}', '{DQ}', '{DM}', 'ESSAI A8Q5Q3Q2Q2 GROUPE', 21, 'non_rapprochee');
           insert into reglements_groupes (dossier_id, ligne_bancaire_id, piece_id, montant) values ('{DQ}', '{M2}', '{P}', 21);
           set constraints all immediate;
           set constraints all deferred;
           update lignes_bancaires set statut = 'rapprochee', reglement_groupe = true where id = '{M2}';$q$, recu, '23514', deja_encaissee),
      (20, '11b. … une part qui monte, posée à la main sur un mouvement déjà réglé en groupe (20 € et 25 €, jugés) : 21 € pour la pièce, refusé',
        null, replace(replace(garni, '{E}', '0'), '{MONTANT}', '100')
          || $q$ insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values ('{M2}', '{DQ}', '{DM}', 'ESSAI A8Q5Q3Q2Q2 GROUPE', 45, 'non_rapprochee');
           select regler_pieces_par_mouvement('{M2}', '[{"piece_id": "{P}", "montant": 20}, {"piece_id": "{Q}", "montant": 25}]'::jsonb);$q$,
        $q$set constraints all immediate;
           set constraints all deferred;$q$,
        $q$update reglements_groupes set montant = 21 where ligne_bancaire_id = '{M2}' and piece_id = '{P}';
           update reglements_groupes set montant = 24 where ligne_bancaire_id = '{M2}' and piece_id = '{Q}';$q$, recu, '23514', deja_encaissee),
      (21, '12. ce qui fait baisser le reçu passe toujours : la pièce a reçu 50 € par-dessus 100 € encaissés (posés par le propriétaire, la garde coupée), puis un rejet de 10 € se rapproche d''elle',
        mouvement_fautif, replace(replace(garni, '{E}', '0'), '{MONTANT}', '100'), fautif,
        replace(replace(replace(rapprocher, '{M}', '{M3}'), '{X}', '-10'), '{PIECE}', '{P}'), recu, 'OK', '4000'),
      (22, '12b. … et sur cet état fautif, un mouvement d''un autre dossier qui la cite passe aussi (A8Q5-Q4 ne s''aggrave pas)',
        mouvement_fautif, replace(replace(garni, '{E}', '0'), '{MONTANT}', '100'), fautif,
        $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values ('{M4}', '{DR}', '{DM}', 'ESSAI A8Q5Q3Q2Q2 AUTRE DOSSIER', 21, 'non_rapprochee');
           update lignes_bancaires set statut = 'rapprochee', piece_id = '{P}' where id = '{M4}';$q$, recu, 'OK', '5000'),
      (23, '12c. … et une part d''un virement groupé qui baisse, sur un état fautif (la part de 40 € posée la garde coupée) : passe',
        $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values ('{M2}', '{DQ}', '{DM}', 'ESSAI A8Q5Q3Q2Q2 GROUPE', 45, 'non_rapprochee');$q$,
        replace(replace(garni, '{E}', '0'), '{MONTANT}', '100'),
        $q$alter table lignes_bancaires disable trigger lignes_bancaires_recu_d_une_piece_citee;
           alter table reglements_groupes disable trigger reglements_groupes_recu_d_une_piece_citee;
           update lignes_bancaires set statut = 'rapprochee', reglement_groupe = true where id = '{M2}';
           insert into reglements_groupes (dossier_id, ligne_bancaire_id, piece_id, montant) values ('{DQ}', '{M2}', '{P}', 40), ('{DQ}', '{M2}', '{Q}', 5);
           alter table lignes_bancaires enable trigger lignes_bancaires_recu_d_une_piece_citee;
           alter table reglements_groupes enable trigger reglements_groupes_recu_d_une_piece_citee;$q$,
        $q$update reglements_groupes set montant = 35 where ligne_bancaire_id = '{M2}' and piece_id = '{P}';$q$, recu, 'OK', '3500'),
      (24, '13. le lien retiré (la pièce n''est plus l''original) : 21 € passent',
        null, replace(replace(garni, '{E}', '0'), '{MONTANT}', '100') || $q$ select retirer_piece_de_facture_reprise('{DQ}', {R1});$q$, null,
        replace(replace(replace(rapprocher, '{M}', '{M1}'), '{X}', '21'), '{PIECE}', '{P}'), recu, 'OK', '2100'),
      (25, '14. la garde des règlements garde son rang et ses mots : un paiement du jour de la reprise se refuse à l''écriture, par elle',
        null, replace(replace(garni, '{E}', '0'), '{MONTANT}', '100'), null,
        $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values ('{M1}', '{DQ}', '{R}', 'ESSAI A8Q5Q3Q2Q2 PAIEMENT', 21, 'non_rapprochee');
           update lignes_bancaires set statut = 'rapprochee', piece_id = '{P}' where id = '{M1}';$q$, recu, '23514', date_de_la_garde),
      (26, '15. une autre pièce, jamais citée : 120 € rapprochés passent',
        null, replace(replace(garni, '{E}', '0'), '{MONTANT}', '100'), null,
        replace(replace(replace(rapprocher, '{M}', '{M1}'), '{X}', '120'), '{PIECE}', '{Q}'), $q$recu_par_la_piece('{Q}')::text$q$, 'OK', '12000'),
      (27, '16. un mouvement d''un autre dossier qui cite la pièce (A8Q5-Q4, ouverte) : il ne compte pas dans ce qu''elle a reçu, et la garde ne le juge pas',
        null, replace(replace(garni, '{E}', '0'), '{MONTANT}', '100'), null,
        $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values ('{M4}', '{DR}', '{DM}', 'ESSAI A8Q5Q3Q2Q2 AUTRE DOSSIER', 21, 'non_rapprochee');
           update lignes_bancaires set statut = 'rapprochee', piece_id = '{P}' where id = '{M4}';$q$, recu, 'OK', '0'),
      -- CE QUI DÉFAISAIT LE REÇU ET NE LE DÉFAIT PLUS (relecture adverse du 15/11/2026) : la ligne quitte la pièce, et le
      -- déclencheur de l'image d'avant la juge. La suppression d'un rejet se juge de même (son déclencheur tire aussi sur la
      -- suppression) : éprouvée sur une réplique, elle n'entre pas dans ce fichier, qui n'en contient aucune.
      (28, '17. un paiement de 50 € et son rejet, rapprochés de la pièce avant la reprise ; le registre a reçu 100 € : le rapprochement du rejet annulé, comme l''onglet Banque l''annule — la pièce reçoit de nouveau 50 € — refusé',
        null, paiement_et_rejet || replace(replace(garni, '{E}', '0'), '{MONTANT}', '100') || jugee, null,
        $q$update lignes_bancaires set statut = 'non_rapprochee', piece_id = null, prelevement_personnel = false where id = '{M3}';$q$,
        recu, '23514', deja_encaissee),
      (29, '17b. … le rejet ignoré : refusé',
        null, paiement_et_rejet || replace(replace(garni, '{E}', '0'), '{MONTANT}', '100') || jugee, null,
        $q$update lignes_bancaires set statut = 'ignoree', piece_id = null where id = '{M3}';$q$, recu, '23514', deja_encaissee),
      (30, '17c. … le rejet rapproché d''une autre pièce : refusé',
        null, paiement_et_rejet || replace(replace(garni, '{E}', '0'), '{MONTANT}', '100') || jugee, null,
        $q$update lignes_bancaires set piece_id = '{Q}' where id = '{M3}';$q$, recu, '23514', deja_encaissee),
      (31, '17d. … le registre vide : le rapprochement du rejet annulé passe, la pièce a reçu 50 €',
        null, paiement_et_rejet || replace(replace(importer, '{L}', un_taux), '{E}', '0') || citer || jugee, null,
        $q$update lignes_bancaires set statut = 'non_rapprochee', piece_id = null where id = '{M3}';$q$, recu, 'OK', '5000'),
      (32, '17e. … le paiement défait, le rejet gardé : ce qui baisse passe',
        null, paiement_et_rejet || replace(replace(garni, '{E}', '0'), '{MONTANT}', '100') || jugee, null,
        $q$update lignes_bancaires set statut = 'non_rapprochee', piece_id = null where id = '{M1}';$q$, recu, 'OK', '0'),
      (33, '18. une part négative d''un virement groupé (−50 €) qui monte à −10 €, l''autre pièce de 120 € à 80 € : refusé',
        mouvements_de_la_part_negative, replace(replace(garni, '{E}', '0'), '{MONTANT}', '100'), part_negative,
        $q$update reglements_groupes set montant = -10 where ligne_bancaire_id = '{M2}' and piece_id = '{P}';
           update reglements_groupes set montant = 80 where ligne_bancaire_id = '{M2}' and piece_id = '{Q}';$q$, recu, '23514', deja_encaissee),
      (34, '18b. … le virement groupé remis à traiter, ses parts laissées : sa part négative ne compte plus, refusé',
        mouvements_de_la_part_negative, replace(replace(garni, '{E}', '0'), '{MONTANT}', '100'), part_negative,
        $q$update lignes_bancaires set statut = 'non_rapprochee', reglement_groupe = false where id = '{M2}';$q$, recu, '23514', deja_encaissee),
      (35, '18c. … la part négative qui descend à −60 €, l''autre pièce à 130 € : ce qui baisse passe',
        mouvements_de_la_part_negative, replace(replace(garni, '{E}', '0'), '{MONTANT}', '100'), part_negative,
        $q$update reglements_groupes set montant = -60 where ligne_bancaire_id = '{M2}' and piece_id = '{P}';
           update reglements_groupes set montant = 130 where ligne_bancaire_id = '{M2}' and piece_id = '{Q}';$q$, recu, 'OK', '0')
    ) as t(rang, etape, pose_super, pose, pose_apres, geste, relu, code, attendu) loop
      v_code := 'OK'; v_msg := null; v_obs := null;
      begin
        v_textes := array[e.pose_super, e.pose, e.pose_apres, e.geste, e.relu, e.attendu];
        for i in 1 .. 6 loop
          if v_textes[i] is null then continue; end if;
          v_texte := replace(replace(replace(replace(v_textes[i], '{DQ}', dq), '{DR}', dr), '{P}', p), '{Q}', q);
          v_texte := replace(replace(replace(replace(v_texte, '{M1}', m1), '{M2}', m2), '{M3}', m3), '{M4}', m4);
          v_texte := replace(replace(replace(v_texte, '{DP}', date_p::text), '{DM}', date_m::text), '{RJ}', to_char(reprise, 'DD/MM/YYYY'));
          v_texte := replace(v_texte, '{R}', reprise::text);
          v_texte := replace(v_texte, '{R1}', '(select f.id from factures_emises f where f.dossier_id = ''' || dq || ''' and f.numero = ''R-Q2Q2-1'')');
          v_textes[i] := v_texte;
        end loop;
        if v_textes[1] is not null then
          execute v_textes[1];
        end if;
        execute 'set local role authenticated';
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
        if v_textes[2] is not null then
          execute v_textes[2];
        end if;
        reset role;
        perform set_config('request.jwt.claims', '', true);
        if v_textes[3] is not null then
          execute v_textes[3];
        end if;
        begin
          if v_textes[4] is not null then
            execute 'set local role authenticated';
            perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
            execute v_textes[4];
            reset role;
            perform set_config('request.jwt.claims', '', true);
          end if;
          -- La fin de la transaction, simulée : les déclencheurs différés jugent ce que le geste a laissé.
          set constraints all immediate;
          set constraints all deferred;
          if v_textes[5] is not null then
            execute 'select (' || v_textes[5] || ')::text' into v_obs;
          end if;
          v_msg := coalesce(v_obs, '');
        exception when others then
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
        'ok', v_code = e.code and v_msg = v_textes[6], 'observe', v_code || ' ' || coalesce(v_msg, '-'));
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni les pièces, leurs paiements, leurs factures, leurs encaissements',
    'ok', not exists (select 1 from dossiers where id in (dq::uuid, dr::uuid))
      and not exists (select 1 from pieces where id in (p::uuid, q::uuid))
      and not exists (select 1 from lignes_bancaires where id in (m1::uuid, m2::uuid, m3::uuid, m4::uuid))
      and not exists (select 1 from operations_caisse where dossier_id = dq::uuid)
      and not exists (select 1 from factures_emises where dossier_id = dq::uuid)
      and not exists (select 1 from encaissements_factures where dossier_id = dq::uuid),
    'observe', 'relu');
  perform set_config('essai.reglements_de_la_piece_citee', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.reglements_de_la_piece_citee')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
