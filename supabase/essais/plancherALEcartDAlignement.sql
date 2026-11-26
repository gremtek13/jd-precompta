-- LA PIÈCE CITÉE RÉGLÉE À L'ÉCART D'ALIGNEMENT PRÈS : LE PLANCHER PREND LA PIÈCE ENTIÈRE (ligne 51.5, A8Q5Q3Q2-Q3 ; la migration
-- `plancher_a_l_ecart_d_alignement`, en production depuis le 16/11/2026 (232), supabase/schema/20261116174644_plancher_a_l_ecart_d_alignement.sql). Le
-- récit : HISTORIQUE.md, « 16/11/2026 — A8Q5-Q4, A8Q5Q3Q2-Q3 ET A8Q5Q3Q2Q2-Q1 : TROIS MIGRATIONS PRÉPARÉES APRÈS LA GARDE DES
-- RÈGLEMENTS ». À rejouer après toute migration qui touche `recu_par_la_piece`, `recu_par_la_piece_au_montant`,
-- `garder_plancher_d_une_piece_citee`, `garder_recu_d_une_piece_citee`, `enregistrer_encaissement`,
-- `citer_piece_de_facture_reprise`, `reprise_de_la_facture` ou les tables des paiements d'une pièce. SANS LA MIGRATION (la
-- fonction neuve absente du catalogue), il se dit EN ATTENTE ; reglementsDeLaPieceCitee.sql et recuParLaPieceCitee.sql jouent
-- le reste du mécanisme.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   1. LE CATALOGUE : les deux fonctions du plancher aux droits de l'appelant, `stable`, leur chemin fixé, exécutables par
--      aucun rôle de session ; la garde du montant aux droits de son propriétaire, exécutable par personne ; son déclencheur
--      différé sur la mise à jour du montant d'une pièce ;
--   2. LA RÈGLE DE LA 2035, en entiers : un reçu sous le montant qui en laisse au plus 2 % et au plus 5 € compte la pièce
--      entière (118 € et 117,60 € d'une pièce de 120 € ; 295 € d'une pièce de 300 €) ; au-delà, ce reçu (117,59 € ; 294,99 €) ;
--      payée au-delà de son montant, ce qu'elle a reçu ; sans paiement, ou un paiement et son rejet, zéro ; la part d'un
--      virement groupé comme un mouvement ;
--   3. LE REGISTRE ET SA FENÊTRE : la pièce citée réglée de 118 € (non réalignée), l'import qui déclare 0 € : il reste 0,00 €
--      à encaisser — le cas de la question ; réglée de 117,59 €, 2,41 € s'encaissent, pas 2,42 € ; la fenêtre lit 12 000 ;
--   4. LA CITATION (son 4 bis) et LA GARDE DES RÈGLEMENTS jugent sur ce plancher ;
--   5. LE MONTANT DE LA PIÈCE CITÉE : ramené dans l'écart (125 € → 120 €), le registre ayant des encaissements, se refuse à la
--      fin du geste — à un taux comme à plusieurs ; ce qui laisse le plancher (124 €), ce qui le fait baisser (le réalignement
--      sur la banque, un état déjà fautif qu'on défait), le registre vide : passent.
--
-- Un dossier jetable du cabinet du dossier `test` (préfixe `a8570000-0000-4000-8000`) : DQ, basculé, en trésorerie, redevable.
-- Les pièces de vente P (l'original de la facture reprise, 120 € TTC) et Q (300 € TTC), déclarées ventes hors des factures et
-- validées ; la facture de l'ancien logiciel R-Q3-1, importée à chaque étape sous la forme qu'elle demande (à un taux, 120 €
-- TTC ; ou à deux, 230 € TTC) avec ce qu'elle déclare encaissé avant la reprise. N est l'année qui précède la date de reprise
-- (le premier jour du mois de Paris) ; les paiements de P sont du 10 décembre de N, les encaissements du registre du jour de la
-- reprise. Chaque étape se joue dans sa sous-transaction et s'y ANNULE (`ANNULATION_ETAPE`) : ce que le chef pose d'abord, ce
-- que le propriétaire pose ensuite (un état que seule la garde neuve refuserait : son déclencheur coupé le temps de l'écrire),
-- la fin de la transaction simulée (`set constraints all immediate`), le geste du chef, la fin simulée de nouveau, puis ce qu'on
-- relit ; le jeu s'annule à la fin (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le relit. Les verdicts voyagent dans un
-- réglage LOCAL à la transaction (`essai.plancher_a_l_ecart_d_alignement`) : le fichier se joue d'un seul appel, ne crée ni
-- table ni fonction, ne contient aucune instruction de suppression, et ne rend rien qui dépende d'une ligne hors de son
-- dossier. Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`).
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dq constant text := 'a8570000-0000-4000-8000-0000000000d1';
  p constant text := 'a8570000-0000-4000-8000-0000000000b1';
  q constant text := 'a8570000-0000-4000-8000-0000000000b2';
  m1 constant text := 'a8570000-0000-4000-8000-0000000000e1';
  m2 constant text := 'a8570000-0000-4000-8000-0000000000e2';
  m3 constant text := 'a8570000-0000-4000-8000-0000000000e3';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  reprise constant date := date_trunc('month', now() at time zone 'Europe/Paris')::date;
  date_p constant date := make_date(extract(year from reprise)::integer - 1, 11, 20);
  date_m constant date := make_date(extract(year from reprise)::integer - 1, 12, 10);
  appliquee constant boolean := to_regprocedure('public.recu_par_la_piece_au_montant(uuid, numeric)') is not null;
  -- La facture de l'ancien logiciel : à un taux (120 € TTC), ou à deux (230 € TTC) ; ce qu'elle déclare encaissé avant la reprise.
  un_taux constant text := '[{"numero": "R-Q3-1", "type": "facture", "date_emission": "{DP}", "tiers_nom": "Client Q3",
    "type_client": "non_assujetti", "nature_operation": "services", "option_debits": false, "montant_ht": 100,
    "montant_tva": 20, "montant_ttc": 120, "encaisse_avant_reprise": {E}, "encaisse_par_taux": [{"taux": 20, "encaisse": {E}}],
    "lignes": [{"designation": "Prestation", "quantite": 1, "prix_unitaire_ht": 100, "taux_tva": 20}], "transmise_par": "pdf"}]';
  deux_taux constant text := '[{"numero": "R-Q3-1", "type": "facture", "date_emission": "{DP}", "tiers_nom": "Client Q3",
    "type_client": "non_assujetti", "nature_operation": "services", "option_debits": false, "montant_ht": 200,
    "montant_tva": 30, "montant_ttc": 230, "encaisse_avant_reprise": {E}, "encaisse_par_taux": [{"taux": 20, "encaisse": {E20}}, {"taux": 10, "encaisse": {E10}}],
    "lignes": [{"designation": "Prestation A", "quantite": 1, "prix_unitaire_ht": 100, "taux_tva": 20},
               {"designation": "Prestation B", "quantite": 1, "prix_unitaire_ht": 100, "taux_tva": 10}], "transmise_par": "pdf"}]';
  importer constant text := $q$select fixer_reprise_des_factures('{DQ}', '{R}'); select importer_factures('{DQ}', '{"format": "csv"}'::jsonb, '{L}'::jsonb);$q$;
  citer constant text := $q$ select citer_piece_de_facture_reprise('{DQ}', {R1}, '{P}');$q$;
  encaisser constant text := $q$ select enregistrer_encaissement('{DQ}', {R1}, '{R}', {MONTANT}, 'virement', null, '[{"taux": 20, "montant": {MONTANT}}]'::jsonb);$q$;
  -- Un mouvement {M} de {X} € du 10 décembre de N, rapproché de la pièce {PIECE} : le geste de l'onglet Banque.
  rapprocher constant text := $q$ insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values
    ('{M}', '{DQ}', '{DM}', 'ESSAI A8Q5Q3Q2Q3 PAIEMENT', {X}, 'non_rapprochee');
    update lignes_bancaires set statut = 'rapprochee', piece_id = '{PIECE}' where id = '{M}';$q$;
  recu constant text := $q$recu_par_la_piece('{P}')::text$q$;
  -- La facture à un taux, rien de déclaré, la pièce réglée de {X} € puis citée : l'état du cas de la question.
  reglee_puis_citee constant text := replace(importer, '{L}', replace(un_taux, '{E}', '0'))
    || replace(replace(rapprocher, '{M}', '{M1}'), '{PIECE}', '{P}') || citer;
  -- Une pièce de 125 € réglée de 118 € (au-delà de l'écart : le plancher est 118 €), citée, et 2 € au registre.
  a_125 constant text := $q$update pieces set montant_ttc = 125, montant_ht = 104.17, montant_tva = 20.83 where id = '{P}';$q$
    || replace(importer, '{L}', replace(un_taux, '{E}', '0'))
    || replace(replace(replace(rapprocher, '{M}', '{M1}'), '{PIECE}', '{P}'), '{X}', '118') || citer
    || replace(encaisser, '{MONTANT}', '2');
  plancher_deux_fois constant text := 'Cette pièce est l''original d''une facture reprise dont le registre a déjà reçu des encaissements : à ce montant, ses paiements d''avant la reprise la règlent à l''écart d''alignement près, la 2035 la compte entière, et avec ce registre elle dépasserait ce que la facture porte, nette de ses avoirs : la même vente compterait deux fois. Le cabinet retire d''abord ces encaissements, ou garde le montant de la pièce.';
  plancher_plusieurs_taux constant text := 'Cette pièce est l''original d''une facture reprise qui porte plusieurs taux de TVA et dont le registre a déjà reçu des encaissements : à ce montant, ses paiements d''avant la reprise la règlent à l''écart d''alignement près, la 2035 la compte entière, et le registre ne saurait plus sur quels taux elle a porté. Le cabinet retire d''abord ces encaissements, ou garde le montant de la pièce.';
  deja_encaissee constant text := 'Cette pièce est l''original d''une facture reprise dont le registre a déjà reçu des encaissements : avec ce paiement, ce qu''elle a reçu avant la reprise et ce registre dépasseraient ensemble ce que la facture porte, nette de ses avoirs, et la même vente compterait deux fois. Le cabinet retire d''abord ces encaissements, ou ce paiement ne règle pas cette pièce.';
  e record; v_code text; v_msg text; v_obs text; v_textes text[];
  verdicts jsonb := '[]'::jsonb;
begin
  if not appliquee then
    perform set_config('essai.plancher_a_l_ecart_d_alignement', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration plancher_a_l_ecart_d_alignement (A8Q5Q3Q2-Q3)', 'ok', true,
      'observe', 'absente : le plancher du registre est ce que la pièce citée a reçu, même réglée à l''écart d''alignement près ; l''essai se joue dès qu''elle y est'))::text, true);
    return;
  end if;
  begin
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, ventes_par_les_factures, statut_tva, siret,
                          adresse, forme_juridique, denomination_imprimee) values
      (dq::uuid, 'ESSAI A8Q5Q3Q2Q3 DQ', cabinet, 'tresorerie', '455000', true, 'redevable', '12345678200010',
       'ESSAI A8Q5Q3Q2Q3 ADRESSE', '5710', 'ESSAI A8Q5Q3Q2Q3 SOCIÉTÉ');
    insert into pieces (id, dossier_id, storage_path, nom_fichier, storage_hash, type_piece, statut, date_piece, montant_ht,
                        montant_tva, montant_ttc) values
      (p::uuid, dq::uuid, dq || '/essai-q3-p.pdf', 'essai-q3-p.pdf', repeat('7', 64), 'vente', 'a_valider', date_p, 100, 20, 120),
      (q::uuid, dq::uuid, dq || '/essai-q3-q.pdf', 'essai-q3-q.pdf', repeat('8', 64), 'vente', 'a_valider', date_p, 250, 50, 300);
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform declarer_vente_hors_des_factures(dq::uuid, p::uuid);
    perform declarer_vente_hors_des_factures(dq::uuid, q::uuid);
    update pieces set statut = 'validee' where id in (p::uuid, q::uuid);
    reset role;
    perform set_config('request.jwt.claims', '', true);

    -- Une étape : {rang, étape, ce que le chef pose, ce que le propriétaire pose ensuite, le geste du chef, ce qu'on relit
    -- après la fin simulée de la transaction, le code attendu (`OK` : accepté) et ce qu'on relit, ou les mots du refus}.
    for e in select * from (values
      (1, '1. le catalogue : les deux fonctions du plancher aux droits de l''appelant, stables, leur chemin fixé, exécutables par aucun rôle de session ; la garde du montant aux droits de son propriétaire ; son déclencheur différé',
        null, null, null,
        $q$(select string_agg(p.proname || ':' || p.prosecdef::text || ':' || p.provolatile::text || ':' || array_to_string(p.proconfig, ',')
                                || ':' || has_function_privilege('authenticated', p.oid, 'execute') || ':' || has_function_privilege('anon', p.oid, 'execute'),
                              ',' order by p.proname collate "C")
              from pg_proc p where p.oid in ('public.recu_par_la_piece(uuid)'::regprocedure, 'public.recu_par_la_piece_au_montant(uuid, numeric)'::regprocedure,
                                             'public.garder_plancher_d_une_piece_citee()'::regprocedure))
           || ' ' || has_function_privilege('service_role', 'public.garder_plancher_d_une_piece_citee()', 'execute')
           || ' ' || (select string_agg(t.tgrelid::regclass::text || ':' || t.tgtype || ':' || t.tgdeferrable || ':' || t.tginitdeferred || ':' || t.tgenabled::text, ',')
                        from pg_trigger t where t.tgfoid = 'public.garder_plancher_d_une_piece_citee()'::regprocedure and not t.tgisinternal)$q$,
        'OK', 'garder_plancher_d_une_piece_citee:true:v:search_path=public:false:false,recu_par_la_piece:false:s:search_path=public:false:false,recu_par_la_piece_au_montant:false:s:search_path=public:false:false false pieces:17:true:true:O'),
      (2, '2. 118 € reçus d''une pièce de 120 € (2 €, sous l''écart de 2,40 €) : la 2035 la tient pour réglée — le plancher est la pièce entière',
        replace(replace(replace(rapprocher, '{M}', '{M1}'), '{PIECE}', '{P}'), '{X}', '118'), null, null, recu, 'OK', '12000'),
      (3, '2b. 117,60 € (2,40 €, à l''écart même) : la pièce entière',
        replace(replace(replace(rapprocher, '{M}', '{M1}'), '{PIECE}', '{P}'), '{X}', '117.60'), null, null, recu, 'OK', '12000'),
      (4, '2c. 117,59 € (2,41 €, au-delà) : ce qu''elle a reçu',
        replace(replace(replace(rapprocher, '{M}', '{M1}'), '{PIECE}', '{P}'), '{X}', '117.59'), null, null, recu, 'OK', '11759'),
      (5, '2d. 125 € (payée au-delà de son montant) : ce qu''elle a reçu',
        replace(replace(replace(rapprocher, '{M}', '{M1}'), '{PIECE}', '{P}'), '{X}', '125'), null, null, recu, 'OK', '12500'),
      (6, '2e. sans paiement : zéro',
        null, null, null, recu, 'OK', '0'),
      (7, '2f. 118 € et leur rejet : zéro (rien ne règle la pièce)',
        replace(replace(replace(rapprocher, '{M}', '{M1}'), '{PIECE}', '{P}'), '{X}', '118')
          || replace(replace(replace(rapprocher, '{M}', '{M2}'), '{PIECE}', '{P}'), '{X}', '-118'), null, null, recu, 'OK', '0'),
      (8, '2g. 295 € reçus d''une pièce de 300 € (5 €, le plafond de l''écart) : la pièce entière',
        replace(replace(replace(rapprocher, '{M}', '{M1}'), '{PIECE}', '{Q}'), '{X}', '295'), null, null,
        $q$recu_par_la_piece('{Q}')::text$q$, 'OK', '30000'),
      (9, '2h. 294,99 € (5,01 €, au-delà du plafond, sous 2 %) : ce qu''elle a reçu',
        replace(replace(replace(rapprocher, '{M}', '{M1}'), '{PIECE}', '{Q}'), '{X}', '294.99'), null, null,
        $q$recu_par_la_piece('{Q}')::text$q$, 'OK', '29499'),
      (10, '2i. la part de 118 € d''un virement groupé (regler_pieces_par_mouvement) compte comme un mouvement : la pièce entière',
        $q$ insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values ('{M1}', '{DQ}', '{DM}', 'ESSAI A8Q5Q3Q2Q3 GROUPE', 418, 'non_rapprochee');
           select regler_pieces_par_mouvement('{M1}', '[{"piece_id": "{P}", "montant": 118}, {"piece_id": "{Q}", "montant": 300}]'::jsonb);$q$,
        null, null, recu, 'OK', '12000'),
      (11, '3. le registre : la pièce citée réglée de 118 € (non réalignée), l''import déclarant 0 € encaissé — il reste 0,00 € (hier 2,00 €)',
        replace(reglee_puis_citee, '{X}', '118'), null, replace(encaisser, '{MONTANT}', '1'), null, '22023',
        'L''encaissement dépasserait ce que la facture reprise porte encore, nette de ses avoirs et de ce qui en était encaissé avant la reprise : il reste 0,00 € à encaisser.'),
      (12, '3b. … réglée de 117,59 € (au-delà de l''écart) : 2,41 € s''encaissent',
        replace(reglee_puis_citee, '{X}', '117.59'), null, replace(encaisser, '{MONTANT}', '2.41'),
        $q$(select sum(e.montant)::text from encaissements_factures e where e.facture_id = {R1} and e.retire_le is null)$q$, 'OK', '2.41'),
      (13, '3c. … pas 2,42 €',
        replace(reglee_puis_citee, '{X}', '117.59'), null, replace(encaisser, '{MONTANT}', '2.42'), null, '22023',
        'L''encaissement dépasserait ce que la facture reprise porte encore, nette de ses avoirs et de ce qui en était encaissé avant la reprise : il reste 2,41 € à encaisser.'),
      (14, '3d. la fenêtre des encaissements lit le même plancher (reprise_de_la_facture) : 12 000',
        replace(reglee_puis_citee, '{X}', '118'), null,
        $q$select set_config('essai.plancher_lu', reprise_de_la_facture('{DQ}', {R1}) ->> 'recu_par_sa_piece_centimes', true);$q$,
        $q$current_setting('essai.plancher_lu')$q$, 'OK', '12000'),
      (15, '4. la citation (son 4 bis) : 118 € reçus, le registre a reçu 2 € — refusée, la pièce comptée entière',
        replace(importer, '{L}', replace(un_taux, '{E}', '0')) || replace(encaisser, '{MONTANT}', '2')
          || replace(replace(replace(rapprocher, '{M}', '{M1}'), '{PIECE}', '{P}'), '{X}', '118'), null,
        citer, null, '23514',
        'La pièce « essai-q3-p.pdf » a reçu 120,00 € avant la reprise, et le registre de la facture reprise R-Q3-1 en a déjà reçu 2,00 € : ensemble, ils dépassent ce qu''elle porte (120,00 €, nette de ses avoirs), et la même vente compterait deux fois. Retirer d''abord ces encaissements, ou citer une autre pièce.'),
      (16, '4b. … 117,59 € reçus, 2,41 € au registre : la citation passe',
        replace(importer, '{L}', replace(un_taux, '{E}', '0')) || replace(encaisser, '{MONTANT}', '2.41')
          || replace(replace(replace(rapprocher, '{M}', '{M1}'), '{PIECE}', '{P}'), '{X}', '117.59'), null,
        citer, $q$(select count(*)::text from pieces_des_factures_reprises r where r.piece_id = '{P}' and r.retire_le is null)$q$, 'OK', '1'),
      (17, '4c. la garde des règlements : la pièce citée, 2 € au registre, un mouvement de 118 € rapproché — refusé (hier accepté : 2 € et 118 €)',
        replace(importer, '{L}', replace(un_taux, '{E}', '0')) || citer || replace(encaisser, '{MONTANT}', '2'), null,
        replace(replace(replace(rapprocher, '{M}', '{M1}'), '{PIECE}', '{P}'), '{X}', '118'), null, '23514', deja_encaissee),
      (18, '4d. … 117,59 € : accepté (le plancher est ce qu''elle a reçu)',
        replace(importer, '{L}', replace(un_taux, '{E}', '0')) || citer || replace(encaisser, '{MONTANT}', '2'), null,
        replace(replace(replace(rapprocher, '{M}', '{M1}'), '{PIECE}', '{P}'), '{X}', '117.59'), recu, 'OK', '11759'),
      (19, '5. le montant de la pièce citée ramené dans l''écart (125 € → 120 €), 118 € reçus, 2 € au registre : refusé à la fin du geste',
        a_125, null, $q$update pieces set montant_ttc = 120, montant_ht = 100, montant_tva = 20 where id = '{P}';$q$,
        null, '23514', plancher_deux_fois),
      (20, '5b. … à 119 € (1 €, dans l''écart) : refusé de même',
        a_125, null, $q$update pieces set montant_ttc = 119, montant_ht = 99.17, montant_tva = 19.83 where id = '{P}';$q$,
        null, '23514', plancher_deux_fois),
      (21, '5c. … à 124 € (6 €, au-delà de l''écart) : le plancher ne bouge pas, accepté',
        a_125, null, $q$update pieces set montant_ttc = 124, montant_ht = 103.33, montant_tva = 20.67 where id = '{P}';$q$,
        recu, 'OK', '11800'),
      (22, '5d. … réalignée sur la banque (118 €) : le plancher ne monte pas, accepté',
        a_125, null, $q$update pieces set montant_ttc = 118, montant_ht = 98.33, montant_tva = 19.67 where id = '{P}';$q$,
        recu, 'OK', '11800'),
      (23, '5e. le registre vide : ramenée à 120 €, acceptée — la pièce comptée entière',
        $q$update pieces set montant_ttc = 125, montant_ht = 104.17, montant_tva = 20.83 where id = '{P}';$q$
          || replace(importer, '{L}', replace(un_taux, '{E}', '0'))
          || replace(replace(replace(rapprocher, '{M}', '{M1}'), '{PIECE}', '{P}'), '{X}', '118') || citer, null,
        $q$update pieces set montant_ttc = 120, montant_ht = 100, montant_tva = 20 where id = '{P}';$q$,
        recu, 'OK', '12000'),
      (24, '5f. deux taux, le déclaré (228 €) couvre le reçu, 1 € au registre : la pièce de 240 € ramenée à 230 € (2 €, dans l''écart) — refusée plutôt que deviner',
        $q$update pieces set montant_ttc = 240, montant_ht = 200, montant_tva = 40 where id = '{P}';$q$
          || replace(replace(replace(replace(importer, '{L}', deux_taux), '{E20}', '118'), '{E10}', '110'), '{E}', '228')
          || replace(replace(replace(rapprocher, '{M}', '{M1}'), '{PIECE}', '{P}'), '{X}', '228') || citer
          || replace(encaisser, '{MONTANT}', '1'), null,
        $q$update pieces set montant_ttc = 230, montant_ht = 200, montant_tva = 30 where id = '{P}';$q$,
        null, '23514', plancher_plusieurs_taux),
      (25, '5g. un état déjà fautif (posé la garde coupée : 101 €, 100 € reçus, 20 € au registre) : ce qui fait baisser le plancher (100,50 €) passe, l''état restât-il fautif',
        $q$update pieces set montant_ttc = 125, montant_ht = 104.17, montant_tva = 20.83 where id = '{P}';$q$
          || replace(importer, '{L}', replace(un_taux, '{E}', '0'))
          || replace(replace(replace(rapprocher, '{M}', '{M1}'), '{PIECE}', '{P}'), '{X}', '100') || citer
          || replace(encaisser, '{MONTANT}', '20'),
        $q$alter table pieces disable trigger pieces_plancher_d_une_piece_citee;
           update pieces set montant_ttc = 101, montant_ht = 84.17, montant_tva = 16.83 where id = '{P}';
           alter table pieces enable trigger pieces_plancher_d_une_piece_citee;$q$,
        $q$update pieces set montant_ttc = 100.50, montant_ht = 83.75, montant_tva = 16.75 where id = '{P}';$q$,
        recu, 'OK', '10050')
    ) as v(rang, etape, pose, pose_proprio, geste, relu, code, attendu) order by rang
    loop
      v_code := 'OK';
      v_msg := null;
      v_obs := null;
      begin
        v_textes := array[e.pose, e.pose_proprio, e.geste, e.relu, e.attendu];
        for i in 1 .. 5 loop
          if v_textes[i] is null then continue; end if;
          v_textes[i] := replace(replace(replace(replace(v_textes[i], '{DQ}', dq), '{P}', p), '{Q}', q), '{M1}', m1);
          v_textes[i] := replace(replace(v_textes[i], '{M2}', m2), '{M3}', m3);
          v_textes[i] := replace(replace(replace(v_textes[i], '{DP}', date_p::text), '{DM}', date_m::text), '{R}', reprise::text);
          v_textes[i] := replace(v_textes[i], '{R1}', '(select f.id from factures_emises f where f.dossier_id = ''' || dq || ''' and f.numero = ''R-Q3-1'')');
        end loop;
        if v_textes[1] is not null then
          execute 'set local role authenticated';
          perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
          execute v_textes[1];
          reset role;
          perform set_config('request.jwt.claims', '', true);
        end if;
        -- Ce que le chef a posé, jugé avant ce que le propriétaire pose : la fin d'une transaction, simulée.
        set constraints all immediate;
        set constraints all deferred;
        if v_textes[2] is not null then
          execute v_textes[2];
        end if;
        -- Ce que la pose a écrit, jugé avant le geste : la fin d'une transaction, simulée.
        set constraints all immediate;
        set constraints all deferred;
        begin
          if v_textes[3] is not null then
            execute 'set local role authenticated';
            perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
            execute v_textes[3];
            reset role;
            perform set_config('request.jwt.claims', '', true);
          end if;
          -- La fin de la transaction, simulée : les déclencheurs différés jugent ce que le geste a laissé.
          set constraints all immediate;
          set constraints all deferred;
          if v_textes[4] is not null then
            execute 'select (' || v_textes[4] || ')::text' into v_obs;
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
        'ok', v_code = e.code and v_msg = v_textes[5], 'observe', v_code || ' ' || coalesce(v_msg, '-'));
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni le dossier jetable, ni ses pièces, ses paiements, sa facture, ses encaissements',
    'ok', not exists (select 1 from dossiers where id = dq::uuid)
      and not exists (select 1 from pieces where id in (p::uuid, q::uuid))
      and not exists (select 1 from lignes_bancaires where id in (m1::uuid, m2::uuid, m3::uuid))
      and not exists (select 1 from factures_emises where dossier_id = dq::uuid)
      and not exists (select 1 from encaissements_factures where dossier_id = dq::uuid),
    'observe', 'relu');
  perform set_config('essai.plancher_a_l_ecart_d_alignement', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.plancher_a_l_ecart_d_alignement')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
