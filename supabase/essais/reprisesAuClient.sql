-- LES FACTURES REPRISES, AU CLIENT (ligne 51.5, A8C-Q1 et A8Q5-Q2 ; la migration `reprises_au_client`, PRÉPARÉE le
-- 11/11/2026, supabase/preparees/, après A8a, A8b et A8-Q5). Le récit : HISTORIQUE.md, « A8C-Q1 ET A8Q5-Q2 : LES FACTURES
-- REPRISES, AU CLIENT (PRÉPARÉE, PAS APPLIQUÉE) ». À rejouer après toute migration qui touche `reprise_de_la_facture`,
-- `pieces_citees_de_la_simulation`, `enregistrer_encaissement`, `montants_par_taux_du_document`, les factures reprises
-- (`factures_importees`, `importer_factures`), `pieces_des_factures_reprises` ou les prédicats `gere_les_ventes` et
-- `gere_la_banque`.
--
-- Ce qui se prouve ici, et ne se relit pas : `reprise_de_la_facture` rend au cabinet et au client « Ventes », d'une facture
-- reprise de leur dossier, sa date de reprise, sa nature, ce qui en était encaissé avant la reprise et ce que ses avoirs
-- repris créditent — au total et par taux, les chiffres mêmes que les plafonds d'`enregistrer_encaissement` jugent : le
-- reste qu'ils font s'encaisse au centime près, un centime de plus se refuse, au total puis à son taux — ; elle refuse le
-- client « Banque » seul, un accès sans case, un compte rattaché à rien, l'anonyme (qui ne l'exécute pas), et ce qui n'est
-- pas une facture reprise de ce dossier (un avoir repris, une facture de l'application, une facture d'un autre dossier, un
-- identifiant inconnu). `pieces_citees_de_la_simulation` rend au cabinet et au client « Banque » les pièces citées par un
-- lien ACTIF, et elles seules (un lien retiré n'y est plus) ; elle refuse le client « Ventes » seul, un accès sans case, un
-- autre dossier, un dossier qui n'existe pas, un compte rattaché à rien, l'anonyme. Le catalogue.
--
-- Deux dossiers jetables du cabinet du dossier `test` (préfixe `a8c10000-0000-4000-8000`) : DR, basculé, en trésorerie,
-- redevable, et DO, son voisin ; l'accès du client d'essai à DR, dont chaque étape pose les cases (`ventes`, `banque`,
-- `aucune`) ; la date de reprise de DR, le premier jour du mois de Paris ; son lot (`{L}`) : R-SERV-1, des services à 20 % et
-- 10 %, 300,01 € encaissés avant la reprise à 20 %, que l'avoir repris R-AV-1 crédite de 110 € à 10 % ; R-MIXTE-1, les deux
-- natures ; R-SANS-1, sans encaissé ni avoir ; R-NET-1, que l'avoir repris R-AV-3 crédite de dix lignes de 0,04 € dont la
-- TVA s'arrondit ligne à ligne (0,10 € ; 0,08 € par taux) ; deux pièces de vente de DR, PV1 et PV2. Chaque étape se joue
-- dans sa sous-transaction et s'y ANNULE (`ANNULATION_ETAPE`) : ce que le chef pose d'abord (`{P}` : la date de reprise et le
-- lot ; `{C}` : PV1 citée par R-SANS-1, et PV2 citée par R-SERV-1 puis retirée), puis la requête du profil ; le jeu s'annule
-- à la fin (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le relit. Les verdicts voyagent dans un réglage LOCAL à la
-- transaction (`essai.reprises_au_client`), que la requête finale lit : le fichier se joue d'un seul appel, ne crée ni table
-- ni fonction, ne contient aucune instruction de suppression, et ne rend rien qui dépende d'une ligne hors de ses dossiers.
-- Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`). Sans la migration, une ligne dit qu'il attend
-- (EN ATTENTE) et rien ne s'écrit.
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  dr constant text := 'a8c10000-0000-4000-8000-0000000000d1';
  dov constant text := 'a8c10000-0000-4000-8000-0000000000d2';
  acces constant text := 'a8c10000-0000-4000-8000-0000000000a1';
  pv1 constant text := 'a8c10000-0000-4000-8000-0000000000b1';
  pv2 constant text := 'a8c10000-0000-4000-8000-0000000000b2';
  fapp constant text := 'a8c10000-0000-4000-8000-0000000000c1';
  -- Un compte connecté qu'aucun accès ni aucun cabinet ne nomme (le profil `inconnu`), et un dossier qui n'existe pas.
  inconnu constant text := 'a8c10000-0000-4000-8000-0000000000f1';
  fantome constant text := 'a8c10000-0000-4000-8000-0000000000f2';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  -- La date de reprise : le premier jour du mois de Paris, celui de la bascule de DR (posée à son insertion, maintenant).
  reprise constant date := date_trunc('month', now() at time zone 'Europe/Paris')::date;
  lot constant text := '[
    {"numero": "R-SERV-1", "type": "facture", "date_emission": "{AVANT}", "tiers_nom": "Client S", "type_client": "assujetti",
     "tiers_siren": "123456789", "tiers_adresse": "1 rue des Essais", "nature_operation": "services", "option_debits": false,
     "montant_ht": 1200, "montant_tva": 220, "montant_ttc": 1420,
     "lignes": [{"designation": "Prestation", "quantite": 1, "prix_unitaire_ht": 1000, "taux_tva": 20},
                {"designation": "Séance", "quantite": 1, "prix_unitaire_ht": 200, "taux_tva": 10}],
     "encaisse_avant_reprise": 300.01, "encaisse_par_taux": [{"taux": 20, "encaisse": 300.01}, {"taux": 10, "encaisse": 0}],
     "transmise_par": "pdf"},
    {"numero": "R-AV-1", "type": "avoir", "origine_numero": "R-SERV-1", "date_emission": "{AVANT2}", "tiers_nom": "Client S",
     "type_client": "assujetti", "nature_operation": "services", "option_debits": false,
     "montant_ht": -100, "montant_tva": -10, "montant_ttc": -110,
     "lignes": [{"designation": "Geste commercial", "quantite": -1, "prix_unitaire_ht": 100, "taux_tva": 10}], "transmise_par": "papier"},
    {"numero": "R-MIXTE-1", "type": "facture", "date_emission": "{AVANT}", "tiers_nom": "Client M", "type_client": "non_assujetti",
     "nature_operation": "mixte", "option_debits": false, "montant_ht": 300, "montant_tva": 60, "montant_ttc": 360,
     "lignes": [{"designation": "Objet", "quantite": 1, "prix_unitaire_ht": 100, "taux_tva": 20, "nature": "biens"},
                {"designation": "Pose", "quantite": 1, "prix_unitaire_ht": 200, "taux_tva": 20, "nature": "services"}],
     "transmise_par": "inconnu"},
    {"numero": "R-SANS-1", "type": "facture", "date_emission": "{AVANT}", "tiers_nom": "Client P", "type_client": "non_assujetti",
     "nature_operation": "services", "option_debits": false, "montant_ht": 100, "montant_tva": 20, "montant_ttc": 120,
     "lignes": [{"designation": "Prestation", "quantite": 1, "prix_unitaire_ht": 100, "taux_tva": 20}], "transmise_par": "pdf"},
    {"numero": "R-NET-1", "type": "facture", "date_emission": "{AVANT}", "tiers_nom": "Client E", "type_client": "non_assujetti",
     "nature_operation": "services", "option_debits": false, "montant_ht": 100, "montant_tva": 20, "montant_ttc": 120,
     "lignes": [{"designation": "Prestation", "quantite": 1, "prix_unitaire_ht": 100, "taux_tva": 20}], "transmise_par": "inconnu"},
    {"numero": "R-AV-3", "type": "avoir", "origine_numero": "R-NET-1", "date_emission": "{AVANT2}", "tiers_nom": "Client E",
     "type_client": "non_assujetti", "nature_operation": "services", "option_debits": false,
     "montant_ht": -0.40, "montant_tva": -0.10, "montant_ttc": -0.50,
     "lignes": [{"designation": "Remise 1", "quantite": -1, "prix_unitaire_ht": 0.04, "taux_tva": 20},
                {"designation": "Remise 2", "quantite": -1, "prix_unitaire_ht": 0.04, "taux_tva": 20},
                {"designation": "Remise 3", "quantite": -1, "prix_unitaire_ht": 0.04, "taux_tva": 20},
                {"designation": "Remise 4", "quantite": -1, "prix_unitaire_ht": 0.04, "taux_tva": 20},
                {"designation": "Remise 5", "quantite": -1, "prix_unitaire_ht": 0.04, "taux_tva": 20},
                {"designation": "Remise 6", "quantite": -1, "prix_unitaire_ht": 0.04, "taux_tva": 20},
                {"designation": "Remise 7", "quantite": -1, "prix_unitaire_ht": 0.04, "taux_tva": 20},
                {"designation": "Remise 8", "quantite": -1, "prix_unitaire_ht": 0.04, "taux_tva": 20},
                {"designation": "Remise 9", "quantite": -1, "prix_unitaire_ht": 0.04, "taux_tva": 20},
                {"designation": "Remise 10", "quantite": -1, "prix_unitaire_ht": 0.04, "taux_tva": 20}], "transmise_par": "papier"}]';
  poser constant text := $q$select fixer_reprise_des_factures('{DR}', '{R}'); select importer_factures('{DR}', '{"format": "csv"}'::jsonb, '{L}'::jsonb);$q$;
  citer constant text := $q$select citer_piece_de_facture_reprise('{DR}', {F:R-SERV-1}, '{PV2}'); select retirer_piece_de_facture_reprise('{DR}', {F:R-SERV-1}); select citer_piece_de_facture_reprise('{DR}', {F:R-SANS-1}, '{PV1}');$q$;
  refus constant text := 'Accès refusé à ce dossier.';
  introuvable constant text := 'Facture reprise introuvable dans ce dossier.';
  -- Ce que `reprise_de_la_facture` rend de R-SERV-1 : 1 420 € TTC (1 200 € à 20 %, 220 € à 10 %), 300,01 € encaissés avant
  -- la reprise à 20 %, 110 € crédités à 10 % par R-AV-1.
  serv constant text := '{"reprise_le": "{R}", "nature_operation": "services", "encaisse_avant_reprise_centimes": 30001,
    "encaisse_par_taux": [{"taux": 20, "encaisse_centimes": 30001}, {"taux": 10, "encaisse_centimes": 0}],
    "credite_par_les_repris_centimes": 11000, "credite_par_les_repris_par_taux": [{"taux": 10, "ttc_centimes": 11000}]}';
  e record; v_code text; v_msg text; v_req text; v_pose text; v_obs text; v_texte text; v_f record;
  verdicts jsonb := '[]'::jsonb;
begin
  if to_regprocedure('public.reprise_de_la_facture(uuid, uuid)') is null
     or to_regprocedure('public.pieces_citees_de_la_simulation(uuid)') is null then
    perform set_config('essai.reprises_au_client', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration reprises_au_client', 'ok', true,
      'observe', 'absente : l''essai se joue dès que la migration y est'))::text, true);
    return;
  end if;
  begin
    -- Le jeu : les deux dossiers jetables et l'accès du client d'essai à DR, insérés par le propriétaire comme
    -- `create-client-access` les insère ; les pièces, comme le dépôt ; une facture brouillon de l'application.
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, ventes_par_les_factures, statut_tva, siret,
                          adresse, forme_juridique, denomination_imprimee) values
      (dr::uuid, 'ESSAI A8CQ1 DR', cabinet, 'tresorerie', '455000', true, 'redevable', '12345678200010',
       'ESSAI A8CQ1 ADRESSE DR', '5710', 'ESSAI A8CQ1 SOCIÉTÉ DR'),
      (dov::uuid, 'ESSAI A8CQ1 DO', cabinet, 'tresorerie', '455000', false, 'redevable', null, null, null, null);
    insert into memberships (id, user_id, dossier_id, role, email, droit_ventes, droit_banque) values
      (acces::uuid, client::uuid, dr::uuid, 'client', 'essai-a8cq1@example.test', false, false);
    insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut, date_piece, montant_ttc) values
      (pv1::uuid, dr::uuid, dr || '/essai-a8cq1-r-sans-1.pdf', 'essai-a8cq1-r-sans-1.pdf', 'vente', 'a_valider', reprise - 10, 120),
      (pv2::uuid, dr::uuid, dr || '/essai-a8cq1-r-serv-1.pdf', 'essai-a8cq1-r-serv-1.pdf', 'vente', 'a_valider', reprise - 10, 1420);
    insert into factures_emises (id, dossier_id, type, statut, tiers_nom, date_emission, montant_ht, montant_tva, montant_ttc) values
      (fapp::uuid, dr::uuid, 'facture', 'brouillon', 'ESSAI A8CQ1 BROUILLON', reprise, 100, 20, 120);

    -- Une étape : {rang, étape, ce que le CHEF pose d'abord (sous sa session), le profil — `chef`, `ventes`, `banque`,
    -- `aucune` (le client d'essai, ses cases posées sur DR), `inconnu`, `anon` —, sa requête, le code attendu (`OK` :
    -- acceptée) et ce qu'elle rend, ou les mots du refus}.
    for e in select * from (values
      -- reprise_de_la_facture : ce qu'elle rend.
      (1, '1. le chef lit ce que l''encaissement de R-SERV-1 demande : la date de reprise, sa nature, l''encaissé avant la reprise et les avoirs repris, au total et par taux', '{P}', 'chef',
        $q$select (reprise_de_la_facture('{DR}', {F:R-SERV-1}) = '{SERV}'::jsonb)::text$q$,
        'OK', 'true'),
      (2, '2. le client « Ventes » lit la même valeur (A8C-Q1, le contrôle positif)', '{P}', 'ventes',
        $q$select (reprise_de_la_facture('{DR}', {F:R-SERV-1}) = '{SERV}'::jsonb)::text$q$,
        'OK', 'true'),
      (3, '3. … et rien du registre : six clés, et elles seules', '{P}', 'ventes',
        $q$select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(reprise_de_la_facture('{DR}', {F:R-SERV-1})) k$q$,
        'OK', 'credite_par_les_repris_centimes,credite_par_les_repris_par_taux,encaisse_avant_reprise_centimes,encaisse_par_taux,nature_operation,reprise_le'),
      (4, '4. une facture reprise sans encaissé ni avoir : des zéros, chaque taux de ses lignes, aucun crédit', '{P}', 'ventes',
        $q$select reprise_de_la_facture('{DR}', {F:R-SANS-1})::text$q$,
        'OK', format('{"reprise_le": "%s", "nature_operation": "services", "encaisse_par_taux": [{"taux": 20, "encaisse_centimes": 0}], "credite_par_les_repris_centimes": 0, "credite_par_les_repris_par_taux": [], "encaisse_avant_reprise_centimes": 0}', reprise)),
      (5, '5. la nature « mixte » se lit (A8B-Q1 : la fenêtre la refuse avant le clic)', '{P}', 'ventes',
        $q$select reprise_de_la_facture('{DR}', {F:R-MIXTE-1}) ->> 'nature_operation'$q$,
        'OK', 'mixte'),
      (6, '6. un avoir repris arrondi ligne à ligne : 50 centimes au total, 50 à 20 % (la règle de montants_par_taux_du_document, pas la TVA par taux)', '{P}', 'ventes',
        $q$select (reprise_de_la_facture('{DR}', {F:R-NET-1}) ->> 'credite_par_les_repris_centimes') || ':' || (reprise_de_la_facture('{DR}', {F:R-NET-1}) -> 'credite_par_les_repris_par_taux')::text$q$,
        'OK', '50:[{"taux": 20, "ttc_centimes": 50}]'),
      -- Les chiffres rendus SONT les plafonds d'enregistrer_encaissement.
      (7, '7. le reste qu''ils font (1 420 − 110 − 300,01 = 1 009,99 € ; 899,99 € à 20 %, 110 € à 10 %) s''encaisse, par le client « Ventes »', '{P}', 'ventes',
        $q$select (enregistrer_encaissement('{DR}', {F:R-SERV-1}, '{R}', 1009.99, 'cheque', null, '[{"taux": 20, "montant": 899.99}, {"taux": 10, "montant": 110}]'::jsonb)).montant::text$q$,
        'OK', '1009.99'),
      (8, '8. un centime de plus au total se refuse, et le reste dit est celui qu''ils font', '{P}', 'ventes',
        $q$select (enregistrer_encaissement('{DR}', {F:R-SERV-1}, '{R}', 1010, 'cheque', null, '[{"taux": 20, "montant": 900}, {"taux": 10, "montant": 110}]'::jsonb)).montant::text$q$,
        '22023', 'L''encaissement dépasserait ce que la facture reprise porte encore, nette de ses avoirs et de ce qui en était encaissé avant la reprise : il reste 1009,99 € à encaisser.'),
      (9, '9. un centime de plus à 10 % se refuse à son taux, le reste du taux étant celui qu''ils font', '{P}', 'ventes',
        $q$select (enregistrer_encaissement('{DR}', {F:R-SERV-1}, '{R}', 110.01, 'cheque', null, '[{"taux": 10, "montant": 110.01}]'::jsonb)).montant::text$q$,
        '22023', 'À 10 %, l''encaissement dépasserait ce que la facture reprise porte encore, nette de ses avoirs et de ce qui en était encaissé avant la reprise : il reste 110,00 € à encaisser à ce taux.'),
      -- reprise_de_la_facture : qui ne la lit pas, et ce qu'elle ne rend pas.
      (10, '10. le client « Banque » seul ne la lit pas (42501)', '{P}', 'banque',
        $q$select reprise_de_la_facture('{DR}', {F:R-SERV-1})::text$q$,
        '42501', refus),
      (11, '11. un accès sans case non plus (42501)', '{P}', 'aucune',
        $q$select reprise_de_la_facture('{DR}', {F:R-SERV-1})::text$q$,
        '42501', refus),
      (12, '12. ni un compte rattaché à rien (42501)', '{P}', 'inconnu',
        $q$select reprise_de_la_facture('{DR}', {F:R-SERV-1})::text$q$,
        '42501', refus),
      (13, '13. l''anonyme ne l''exécute pas (42501)', '{P}', 'anon',
        $q$select reprise_de_la_facture('{DR}', {F:R-SERV-1})::text$q$,
        '42501', 'permission denied for function reprise_de_la_facture'),
      (14, '14. le client « Ventes » de DR ne lit pas une facture de DO, où il n''a pas d''accès (42501)', '{P}', 'ventes',
        $q$select reprise_de_la_facture('{DO}', {F:R-SERV-1})::text$q$,
        '42501', refus),
      (15, '15. un avoir repris n''est pas une facture reprise (P0002)', '{P}', 'chef',
        $q$select reprise_de_la_facture('{DR}', {F:R-AV-1})::text$q$,
        'P0002', introuvable),
      (16, '16. une facture de l''application non plus (P0002)', '{P}', 'chef',
        $q$select reprise_de_la_facture('{DR}', '{FAPP}')::text$q$,
        'P0002', introuvable),
      (17, '17. ni une facture reprise d''un autre dossier, le chef du cabinet des deux (P0002)', '{P}', 'chef',
        $q$select reprise_de_la_facture('{DO}', {F:R-SERV-1})::text$q$,
        'P0002', introuvable),
      (18, '18. ni un identifiant inconnu (P0002)', '{P}', 'chef',
        $q$select reprise_de_la_facture('{DR}', '{FANTOME}')::text$q$,
        'P0002', introuvable),
      -- pieces_citees_de_la_simulation.
      (20, '20. le chef lit les pièces citées par un lien actif : PV1, et non PV2, dont le lien est retiré', '{P} {C}', 'chef',
        $q$select pieces_citees_de_la_simulation('{DR}')::text$q$,
        'OK', format('["%s"]', pv1)),
      (21, '21. le client « Banque » les lit (A8Q5-Q2, le contrôle positif)', '{P} {C}', 'banque',
        $q$select pieces_citees_de_la_simulation('{DR}')::text$q$,
        'OK', format('["%s"]', pv1)),
      (22, '22. sans lien : un tableau vide', '{P}', 'banque',
        $q$select pieces_citees_de_la_simulation('{DR}')::text$q$,
        'OK', '[]'),
      (23, '23. le client « Ventes » seul ne les lit pas (42501)', '{P} {C}', 'ventes',
        $q$select pieces_citees_de_la_simulation('{DR}')::text$q$,
        '42501', refus),
      (24, '24. un accès sans case non plus (42501)', '{P} {C}', 'aucune',
        $q$select pieces_citees_de_la_simulation('{DR}')::text$q$,
        '42501', refus),
      (25, '25. ni le client « Banque » de DR sur DO (42501)', '{P} {C}', 'banque',
        $q$select pieces_citees_de_la_simulation('{DO}')::text$q$,
        '42501', refus),
      (26, '26. ni un dossier qui n''existe pas, le chef super-administrateur (42501)', '{P} {C}', 'chef',
        $q$select pieces_citees_de_la_simulation('{FANTOME}')::text$q$,
        '42501', refus),
      (27, '27. ni un compte rattaché à rien (42501)', '{P} {C}', 'inconnu',
        $q$select pieces_citees_de_la_simulation('{DR}')::text$q$,
        '42501', refus),
      (28, '28. l''anonyme ne l''exécute pas (42501)', '{P} {C}', 'anon',
        $q$select pieces_citees_de_la_simulation('{DR}')::text$q$,
        '42501', 'permission denied for function pieces_citees_de_la_simulation'),
      (29, '29. le client « Banque » lit les pièces du dossier, pas le lien (la RLS de la table, inchangée)', '{P} {C}', 'banque',
        $q$select count(*)::text from pieces_des_factures_reprises where dossier_id = '{DR}'$q$,
        'OK', '0')
    ) as t(rang, etape, pose, profil, requete, code, attendu) loop
      v_code := 'OK'; v_msg := null; v_obs := null;
      begin
        for v_f in select x.rang, x.texte from (values (1, e.pose), (2, e.requete)) as x(rang, texte) where x.texte is not null loop
          v_texte := replace(replace(replace(v_f.texte, '{P}', poser), '{C}', citer), '{SERV}', serv);
          v_texte := replace(replace(replace(v_texte, '{L}', lot), '{AVANT}', (reprise - 10)::text), '{AVANT2}', (reprise - 5)::text);
          v_texte := regexp_replace(v_texte, '\{F:([A-Z0-9-]+)\}',
            '(select f.id from factures_emises f where f.dossier_id = ''{DR}'' and f.numero = ''\1'')', 'g');
          v_texte := replace(replace(replace(replace(v_texte, '{PV1}', pv1), '{PV2}', pv2), '{FAPP}', fapp), '{FANTOME}', fantome);
          v_texte := replace(replace(replace(v_texte, '{DR}', dr), '{DO}', dov), '{R}', reprise::text);
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
        -- Les cases du client d'essai sur DR, par le propriétaire : `changer_droits_acces` n'est qu'au cabinet.
        update memberships set droit_ventes = (e.profil = 'ventes'), droit_banque = (e.profil = 'banque') where id = acces::uuid;
        begin
          execute format('set local role %I', case e.profil when 'anon' then 'anon' else 'authenticated' end);
          perform set_config('request.jwt.claims', case e.profil
            when 'anon' then '{"role":"anon"}'
            when 'chef' then json_build_object('sub', chef, 'role', 'authenticated')::text
            when 'inconnu' then json_build_object('sub', inconnu, 'role', 'authenticated')::text
            else json_build_object('sub', client, 'role', 'authenticated')::text end, true);
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

    -- Le catalogue : les deux fonctions aux droits du propriétaire, leur chemin fixé, une valeur jsonb, exécutables par les
    -- connectés, ni par l'anonyme ni par PUBLIC ; STABLES — PostgreSQL refuse alors toute écriture dans leur corps (« not
    -- allowed in a non-volatile function ») : elles ne peuvent rien écrire.
    verdicts := verdicts || jsonb_build_object('rang', 30, 'etape', '30. le catalogue : deux fonctions security definer, stables, leur chemin fixé, une valeur jsonb, aux connectés seuls',
      'ok', (select string_agg(p.proname::text || ':' || p.prosecdef::int || ':' || p.provolatile::text || ':' || array_to_string(p.proconfig, ',') || ':'
                               || pg_get_function_result(p.oid) || ':'
                               || has_function_privilege('anon', p.oid, 'execute')::int
                               || has_function_privilege('authenticated', p.oid, 'execute')::int || ':'
                               || exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)::int, ' ' order by p.proname collate "C")
               from pg_proc p
              where p.oid in (to_regprocedure('public.reprise_de_la_facture(uuid, uuid)'),
                              to_regprocedure('public.pieces_citees_de_la_simulation(uuid)')))
            = 'pieces_citees_de_la_simulation:1:s:search_path=public:jsonb:01:0 reprise_de_la_facture:1:s:search_path=public:jsonb:01:0',
      'observe', 'relu au catalogue');
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  -- Rien n'est resté : ni les dossiers jetables, ni l'accès, ni les pièces, les factures, les liens.
  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni l''accès, ni les pièces, les factures, les liens',
    'ok', not exists (select 1 from dossiers where id in (dr::uuid, dov::uuid))
      and not exists (select 1 from memberships where id = acces::uuid)
      and not exists (select 1 from pieces where id in (pv1::uuid, pv2::uuid))
      and not exists (select 1 from factures_emises where dossier_id in (dr::uuid, dov::uuid))
      and not exists (select 1 from pieces_des_factures_reprises where dossier_id = dr::uuid),
    'observe', 'relu');
  perform set_config('essai.reprises_au_client', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.reprises_au_client')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
