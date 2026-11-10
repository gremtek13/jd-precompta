-- LES ENCAISSEMENTS ET L'AVOIR D'UNE FACTURE REPRISE (ligne 51.5, étape A8b ; la migration
-- `factures_reprises_encaissements`, PRÉPARÉE le 10/11/2026, supabase/preparees/, après A8a et A9a). Le récit :
-- HISTORIQUE.md, « 10/11/2026 — A8B : LES ENCAISSEMENTS ET L'AVOIR D'UNE FACTURE REPRISE, EN BASE (PRÉPARÉE, PAS
-- APPLIQUÉE) ». À rejouer après toute migration qui touche `enregistrer_encaissement`, `garder_encaissement_facture`,
-- `calcul_vente_facturee`, `ecritures_attendues_de_la_periode`, `ecriture_attendue_vente_facturee`,
-- `ventes_facturees_de_la_simulation`, `enregistrer_facture`, `montants_par_taux_du_document`, les factures reprises
-- (`factures_importees`, `importer_factures`, `retirer_import`) ou la numérotation qui continue.
--
-- Ce qui se prouve ici, et ne se relit pas : l'encaissement d'une facture reprise — accepté du cabinet et du client
-- « Ventes », daté de la reprise ; refusé daté d'avant, sur une facture reprise qui mêle biens et services, au-delà de ce
-- qui lui reste (son TTC net de ses avoirs repris et de ce qui en était encaissé avant la reprise, au total puis à chaque
-- taux), à un compte sans accès ; sa TVA arrondie par taux retrouvée dans ses lignes — ; la règle du cumul d'une facture
-- reprise — son départ (l'encaissé avant la reprise), V et T nets de ses avoirs repris, ligne à ligne, ni document, ses
-- seules exigibilités (des services à l'encaissement, l'avoir de l'application à sa date ; rien d'un bien, rien des débits),
-- la vente écartée quand un avoir repris annule le taux de son départ — ; ses écritures (composées source par source
-- comme d'un bloc, écrites par `ecrire_vente_facturee`, son mouvement compté comme celui d'une facture source) ; « Ma
-- simulation » ; l'avoir d'une facture reprise — émis par le cabinet dans la série de son mandataire, par le client dans
-- la sienne, l'émetteur du dossier ; refusé au-delà de ce qui lui reste, avoirs repris déduits, daté d'avant la reprise,
-- sur une facture reprise qui mêle biens et services, sur un avoir repris — ; l'import qu'un encaissement ou un avoir
-- retient ; la restauration d'un encaissement par la garde ; le catalogue.
--
-- Un dossier jetable du cabinet du dossier `test` (préfixe `a8b00000-0000-4000-8000`) : DR, basculé, en trésorerie,
-- redevable, dont l'accès du client d'essai porte « Ventes » ; sa date de reprise, le premier jour du mois de Paris ; son
-- lot, neuf factures reprises (`{L}`). Chaque étape se joue dans sa sous-transaction et s'y ANNULE (`ANNULATION_ETAPE`) :
-- ce que le chef pose d'abord (`{P}` : la date de reprise et le lot), puis la requête du profil ; le jeu s'annule à la
-- fin (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le relit. Les verdicts voyagent dans un réglage LOCAL à la
-- transaction (`essai.encaissements_des_reprises`), que la requête finale lit : le fichier se joue d'un seul appel, ne crée
-- ni table ni fonction, ne contient aucune instruction de suppression, et ne rend rien qui dépende d'une ligne hors de son
-- dossier. Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`). Sans la migration, une ligne dit qu'il
-- attend (EN ATTENTE) et rien ne s'écrit.
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  dr constant text := 'a8b00000-0000-4000-8000-0000000000d1';
  acces_v constant text := 'a8b00000-0000-4000-8000-0000000000a1';
  mouvement constant text := 'a8b00000-0000-4000-8000-0000000000e1';
  -- Un compte connecté qu'aucun accès ni aucun cabinet ne nomme (le profil `inconnu`).
  inconnu constant text := 'a8b00000-0000-4000-8000-0000000000f1';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  -- La date de reprise : le premier jour du mois de Paris, celui de la bascule de DR (posée à son insertion, maintenant) ;
  -- le jour de Paris, celui des avoirs de l'application.
  reprise constant date := date_trunc('month', now() at time zone 'Europe/Paris')::date;
  jour constant date := (now() at time zone 'Europe/Paris')::date;
  -- Le lot : R-SERV-1, des services à 20 % et 10 %, 300,01 € encaissés avant la reprise à 20 %, crédités à 10 % par l'avoir
  -- repris R-AV-1 ; R-BIENS-1, un bien ; R-DEB-1, des services sur les débits ; R-MIXTE-1, les deux natures ; R-TAUX-1, sa
  -- TVA arrondie par taux (20,02 €, ses lignes en font 20,03 € une à une) ; R-NUL-1, 50 € encaissés avant la reprise à
  -- 10 %, taux que l'avoir repris R-AV-2 annule ; R-NET-1, crédité par l'avoir repris R-AV-3, dix lignes de 0,04 € dont la
  -- TVA s'arrondit ligne à ligne (0,10 € ; 0,08 € par taux).
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
    {"numero": "R-BIENS-1", "type": "facture", "date_emission": "{AVANT}", "tiers_nom": "Client B", "type_client": "non_assujetti",
     "nature_operation": "biens", "option_debits": false, "montant_ht": 500, "montant_tva": 100, "montant_ttc": 600,
     "lignes": [{"designation": "Fournitures", "quantite": 5, "prix_unitaire_ht": 100, "taux_tva": 20}], "transmise_par": "papier"},
    {"numero": "R-DEB-1", "type": "facture", "date_emission": "{AVANT}", "tiers_nom": "Client D", "type_client": "non_assujetti",
     "nature_operation": "services", "option_debits": true, "montant_ht": 100, "montant_tva": 20, "montant_ttc": 120,
     "lignes": [{"designation": "Conseil", "quantite": 1, "prix_unitaire_ht": 100, "taux_tva": 20}], "transmise_par": "inconnu"},
    {"numero": "R-MIXTE-1", "type": "facture", "date_emission": "{AVANT}", "tiers_nom": "Client M", "type_client": "non_assujetti",
     "nature_operation": "mixte", "option_debits": false, "montant_ht": 300, "montant_tva": 60, "montant_ttc": 360,
     "lignes": [{"designation": "Objet", "quantite": 1, "prix_unitaire_ht": 100, "taux_tva": 20, "nature": "biens"},
                {"designation": "Pose", "quantite": 1, "prix_unitaire_ht": 200, "taux_tva": 20, "nature": "services"}],
     "transmise_par": "inconnu"},
    {"numero": "R-TAUX-1", "type": "facture", "date_emission": "{AVANT}", "tiers_nom": "Client T", "type_client": "non_assujetti",
     "nature_operation": "services", "option_debits": false, "montant_ht": 100.09, "montant_tva": 20.02, "montant_ttc": 120.11,
     "lignes": [{"designation": "Forfait", "quantite": 1, "prix_unitaire_ht": 100, "taux_tva": 20},
                {"designation": "Frais a", "quantite": 1, "prix_unitaire_ht": 0.03, "taux_tva": 20},
                {"designation": "Frais b", "quantite": 1, "prix_unitaire_ht": 0.03, "taux_tva": 20},
                {"designation": "Frais c", "quantite": 1, "prix_unitaire_ht": 0.03, "taux_tva": 20}], "transmise_par": "inconnu"},
    {"numero": "R-NUL-1", "type": "facture", "date_emission": "{AVANT}", "tiers_nom": "Client N", "type_client": "non_assujetti",
     "nature_operation": "services", "option_debits": false, "montant_ht": 200, "montant_tva": 30, "montant_ttc": 230,
     "lignes": [{"designation": "Séance", "quantite": 1, "prix_unitaire_ht": 100, "taux_tva": 10},
                {"designation": "Prestation", "quantite": 1, "prix_unitaire_ht": 100, "taux_tva": 20}],
     "encaisse_avant_reprise": 50, "encaisse_par_taux": [{"taux": 10, "encaisse": 50}, {"taux": 20, "encaisse": 0}],
     "transmise_par": "inconnu"},
    {"numero": "R-AV-2", "type": "avoir", "origine_numero": "R-NUL-1", "date_emission": "{AVANT2}", "tiers_nom": "Client N",
     "type_client": "non_assujetti", "nature_operation": "services", "option_debits": false,
     "montant_ht": -100, "montant_tva": -10, "montant_ttc": -110,
     "lignes": [{"designation": "Séance annulée", "quantite": -1, "prix_unitaire_ht": 100, "taux_tva": 10}], "transmise_par": "papier"},
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
  -- Ce que le chef pose : la date de reprise, puis le lot.
  poser constant text := $q$select fixer_reprise_des_factures('{DR}', '{R}'); select importer_factures('{DR}', '{"format": "csv"}'::jsonb, '{L}'::jsonb);$q$;
  -- Le premier encaissement de R-SERV-1 (`{E1}`), et l'avoir que l'application émet sur R-BIENS-1 (`{AVB}`, `{AB}`).
  encaisser constant text := $q$select enregistrer_encaissement('{DR}', {FS}, '{R}', 450.02, 'virement', null, '[{"taux": 20, "montant": 450.02}]'::jsonb);$q$;
  avoir constant text := $q$select * from enregistrer_facture('{DR}', null, jsonb_build_object('type', 'avoir', 'facture_origine_id', {FB}, 'date_emission', '{J}', 'montant_ht', -100, 'montant_tva', -20, 'montant_ttc', -120), '[{"designation": "Retour", "quantite": -1, "prix_unitaire_ht": 100, "taux_tva": 20}]'::jsonb, true)$q$;
  e record; v_code text; v_msg text; v_req text; v_pose text; v_obs text; v_texte text; v_f record;
  verdicts jsonb := '[]'::jsonb;
begin
  if to_regprocedure('public.montants_par_taux_du_document(uuid)') is null then
    perform set_config('essai.encaissements_des_reprises', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration factures_reprises_encaissements', 'ok', true,
      'observe', 'absente : l''essai se joue dès que la migration y est'))::text, true);
    return;
  end if;
  begin
    -- Le jeu : le dossier jetable et l'accès « Ventes » du client d'essai, insérés par le propriétaire comme
    -- `create-client-access` les insère ; l'identité que la validation d'un accès « Ventes » exige.
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, ventes_par_les_factures, statut_tva, siret,
                          adresse, forme_juridique, denomination_imprimee) values
      (dr::uuid, 'ESSAI A8B DR', cabinet, 'tresorerie', '455000', true, 'redevable', '12345678200010',
       'ESSAI A8B ADRESSE DR', '5710', 'ESSAI A8B SOCIÉTÉ DR');
    insert into memberships (id, user_id, dossier_id, role, email, droit_ventes) values
      (acces_v::uuid, client::uuid, dr::uuid, 'client', 'essai-a8b-v@example.test', true);

    -- Une étape : {rang, étape, ce que le CHEF pose d'abord (sous sa session), le profil — `chef`, `client`, `inconnu` —, sa
    -- requête, le code attendu (`OK` : acceptée) et ce qu'elle rend, ou les mots du refus}.
    for e in select * from (values
      -- L'encaissement d'une facture reprise.
      (1, '1. le cabinet encaisse une facture reprise, daté de la reprise', '{P}', 'chef',
        $q$select x.montant::text from enregistrer_encaissement('{DR}', {FS}, '{R}', 450.02, 'virement', null, '[{"taux": 20, "montant": 450.02}]'::jsonb) x$q$,
        'OK', '450.02'),
      (2, '2. le client « Ventes » aussi', '{P}', 'client',
        $q$select x.montant::text from enregistrer_encaissement('{DR}', {FS}, '{R}', 450.02, 'virement', null, '[{"taux": 20, "montant": 450.02}]'::jsonb) x$q$,
        'OK', '450.02'),
      (3, '3. daté de la veille de la reprise (22023)', '{P}', 'chef',
        $q$select x.montant::text from enregistrer_encaissement('{DR}', {FS}, ('{R}'::date - 1), 10, 'virement', null, '[{"taux": 20, "montant": 10}]'::jsonb) x$q$,
        '22023', format('La facture R-SERV-1 est reprise de l''ancien logiciel : un encaissement s''y date du jour de la reprise des factures, le %s, ou d''après — ce qui en était encaissé avant est déjà dans sa reprise.', to_char(reprise, 'DD/MM/YYYY'))),
      (4, '4. une facture reprise qui mêle biens et services (22023)', '{P}', 'chef',
        $q$select x.montant::text from enregistrer_encaissement('{DR}', {FM}, '{R}', 10, 'virement', null, '[{"taux": 20, "montant": 10}]'::jsonb) x$q$,
        '22023', 'La facture R-MIXTE-1 est reprise de l''ancien logiciel et mêle biens et services : ses encaissements ne se répartissent pas encore entre les deux, et elle n''en reçoit pas — un paiement d''après la reprise se classe dans le relevé, comme une recette.'),
      (5, '5. au-delà de ce qui lui reste, net de ses avoirs repris et de l''encaissé avant la reprise (22023)', '{P}', 'chef',
        $q$select x.montant::text from enregistrer_encaissement('{DR}', {FS}, '{R}', 1010, 'virement', null, '[{"taux": 20, "montant": 900}, {"taux": 10, "montant": 110}]'::jsonb) x$q$,
        '22023', 'L''encaissement dépasserait ce que la facture reprise porte encore, nette de ses avoirs et de ce qui en était encaissé avant la reprise : il reste 1009,99 € à encaisser.'),
      (6, '6. à 10 %, au-delà de ce que l''avoir repris y laisse (22023)', '{P}', 'chef',
        $q$select x.montant::text from enregistrer_encaissement('{DR}', {FS}, '{R}', 110.01, 'virement', null, '[{"taux": 10, "montant": 110.01}]'::jsonb) x$q$,
        '22023', 'À 10 %, l''encaissement dépasserait ce que la facture reprise porte encore, nette de ses avoirs et de ce qui en était encaissé avant la reprise : il reste 110,00 € à encaisser à ce taux.'),
      (7, '7. à 20 %, au-delà de ce que l''encaissé avant la reprise y laisse (22023)', '{P}', 'chef',
        $q$select x.montant::text from enregistrer_encaissement('{DR}', {FS}, '{R}', 900, 'virement', null, '[{"taux": 20, "montant": 900}]'::jsonb) x$q$,
        '22023', 'À 20 %, l''encaissement dépasserait ce que la facture reprise porte encore, nette de ses avoirs et de ce qui en était encaissé avant la reprise : il reste 899,99 € à encaisser à ce taux.'),
      (8, '8. tout ce qui lui reste, aux deux taux, s''encaisse', '{P}', 'chef',
        $q$select x.montant::text from enregistrer_encaissement('{DR}', {FS}, '{R}', 1009.99, 'virement', null, '[{"taux": 20, "montant": 899.99}, {"taux": 10, "montant": 110}]'::jsonb) x$q$,
        'OK', '1009.99'),
      (9, '9. sa TVA arrondie par taux se retrouve dans ses lignes : son TTC entier s''encaisse', '{P}', 'chef',
        $q$select x.montant::text from enregistrer_encaissement('{DR}', {FT}, '{R}', 120.11, 'virement', null, '[{"taux": 20, "montant": 120.11}]'::jsonb) x$q$,
        'OK', '120.11'),
      (10, '10. un taux que l''avoir repris annule, son encaissé avant la reprise y étant : il n''y reste rien (22023)', '{P}', 'chef',
        $q$select x.montant::text from enregistrer_encaissement('{DR}', {FN}, '{R}', 1, 'virement', null, '[{"taux": 10, "montant": 1}]'::jsonb) x$q$,
        '22023', 'À 10 %, l''encaissement dépasserait ce que la facture reprise porte encore, nette de ses avoirs et de ce qui en était encaissé avant la reprise : il reste 0,00 € à encaisser à ce taux.'),
      (11, '11. un compte sans accès n''encaisse pas (42501)', '{P}', 'inconnu',
        $q$select x.montant::text from enregistrer_encaissement('{DR}', {FS}, '{R}', 10, 'virement', null, '[{"taux": 20, "montant": 10}]'::jsonb) x$q$,
        '42501', 'Accès refusé à ce dossier.'),
      (12, '12. la restauration réinsère l''encaissement d''une facture reprise : la garde l''admet', '{P}', 'chef',
        $q$insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen) values ('{DR}', {FS}, '{R}', 10, 'virement') returning montant::text$q$,
        'OK', '10'),
      -- La règle du cumul d'une facture reprise.
      (13, '13. le cumul part de l''encaissé avant la reprise : 450,02 € à 20 % portent 75,01 € de TVA', '{P} {E1}', 'postgres',
        $q$select string_agg(c.ttc_centimes || ':' || c.base_centimes || ':' || c.tva_centimes, ' ') from calcul_vente_facturee({FS}) c where c.genre = 'part'$q$,
        'OK', '45002:37501:7501'),
      (14, '14. ni document ; des services, exigibles à l''encaissement', '{P} {E1}', 'postgres',
        $q$select string_agg(c.genre || ':' || coalesce(c.origine, '-') || ':' || c.tva_centimes, ' ' order by c.genre, c.origine) from calcul_vente_facturee({FS}) c$q$,
        'OK', 'exigibilite:encaissement:7501 part:-:7501'),
      (15, '15. un bien repris : sa part comptée, ni document ni exigibilité', $q${P} select enregistrer_encaissement('{DR}', {FB}, '{R}', 600, 'virement', null, '[{"taux": 20, "montant": 600}]'::jsonb);$q$, 'postgres',
        $q$select string_agg(c.genre || ':' || coalesce(c.origine, '-') || ':' || c.tva_centimes, ' ' order by c.genre, c.origine) from calcul_vente_facturee({FB}) c$q$,
        'OK', 'part:-:10000'),
      (16, '16. des services repris sur les débits : de même', $q${P} select enregistrer_encaissement('{DR}', {FD}, '{R}', 120, 'virement', null, '[{"taux": 20, "montant": 120}]'::jsonb);$q$, 'postgres',
        $q$select string_agg(c.genre || ':' || coalesce(c.origine, '-') || ':' || c.tva_centimes, ' ' order by c.genre, c.origine) from calcul_vente_facturee({FD}) c$q$,
        'OK', 'part:-:2000'),
      (17, '17. l''avoir que l''application émet sur un bien repris régularise sa TVA, à sa date', '{P} {AB}', 'postgres',
        $q$select string_agg(c.genre || ':' || coalesce(c.origine, '-') || ':' || c.tva_centimes || ':' || (c.date_effet = '{J}'), ' ' order by c.genre, c.origine) from calcul_vente_facturee({FB}) c$q$,
        'OK', 'document:-:-2000:true exigibilite:avoir:-2000:true'),
      (18, '18. les avoirs repris diminuent V et T, ligne à ligne : 119,50 € soldent R-NET-1 et portent 19,90 € de TVA', $q${P} select enregistrer_encaissement('{DR}', {FE}, '{R}', 119.50, 'virement', null, '[{"taux": 20, "montant": 119.50}]'::jsonb);$q$, 'postgres',
        $q$select string_agg(c.ttc_centimes || ':' || c.base_centimes || ':' || c.tva_centimes, ' ') from calcul_vente_facturee({FE}) c where c.genre = 'part'$q$,
        'OK', '11950:9960:1990'),
      (19, '19. la TVA arrondie par taux : 120,11 € portent les 20,02 € déclarés', $q${P} select enregistrer_encaissement('{DR}', {FT}, '{R}', 120.11, 'virement', null, '[{"taux": 20, "montant": 120.11}]'::jsonb);$q$, 'postgres',
        $q$select string_agg(c.ttc_centimes || ':' || c.base_centimes || ':' || c.tva_centimes, ' ') from calcul_vente_facturee({FT}) c where c.genre = 'part'$q$,
        'OK', '12011:10009:2002'),
      (20, '20. un taux que l''avoir repris annule, son encaissé avant la reprise y étant : la vente se dit écartée', '{P}', 'postgres',
        $q$select string_agg(c.genre || ':' || c.motif, ' ') from calcul_vente_facturee({FN}) c$q$,
        'OK', 'ecartee:ttc_nul'),
      -- Ses écritures.
      (21, '21. l''encaissement s''écrit : 511 au débit, 706 et 44571 au crédit', '{P} {E1}', 'postgres',
        $q$select string_agg(split_part(t, '|', 2) || ':' || split_part(t, '|', 3) || ':' || split_part(t, '|', 4), ' ' order by t collate "C") from ecriture_attendue_vente_facturee('{DR}', 'encaissement', {E1ID}) a cross join lateral unnest(a.lignes) t$q$,
        'OK', '445710:credit:7501 511000:debit:45002 706000:credit:37501'),
      (22, '22. un bien repris : sa TVA, que l''ancien logiciel a déclarée, solde le 411', $q${P} select enregistrer_encaissement('{DR}', {FB}, '{R}', 600, 'virement', null, '[{"taux": 20, "montant": 600}]'::jsonb);$q$, 'postgres',
        $q$select string_agg(split_part(t, '|', 2) || ':' || split_part(t, '|', 3) || ':' || split_part(t, '|', 4), ' ' order by t collate "C") from ecriture_attendue_vente_facturee('{DR}', 'encaissement', (select e.id from encaissements_factures e where e.facture_id = {FB})) a cross join lateral unnest(a.lignes) t$q$,
        'OK', '411000:credit:10000 511000:debit:60000 707000:credit:50000'),
      (23, '23. ecrire_vente_facturee l''écrit', '{P} {E1}', 'postgres',
        $q$select ecrire_vente_facturee('{DR}', 'encaissement', {E1ID}, (select jsonb_agg(jsonb_build_object('date', split_part(t, '|', 1), 'compte', split_part(t, '|', 2), 'sens', split_part(t, '|', 3), 'montant', split_part(t, '|', 4)::numeric / 100, 'ligne_bancaire_id', nullif(split_part(t, '|', 5), ''))) from ecriture_attendue_vente_facturee('{DR}', 'encaissement', {E1ID}) a cross join lateral unnest(a.lignes) t))::text$q$,
        'OK', '3'),
      (24, '24. le mouvement d''un encaissement d''une facture reprise, classé par lui, s''écrit comme celui d''une facture source, source par source et d''un bloc : ses frais', $q${P} insert into lignes_bancaires (id, dossier_id, date, libelle, montant) values ('{M}', '{DR}', '{R}', 'ESSAI A8B', 450); select enregistrer_encaissement('{DR}', {FS}, '{R}', 450.02, 'virement', '{M}', '[{"taux": 20, "montant": 450.02}]'::jsonb); select classer_mouvement_par_encaissements('{DR}', '{M}');$q$, 'postgres',
        $q$select coalesce(a.motif, 'aucun') || ' ' || coalesce(a.detail, '-') || ' ' || coalesce((select string_agg(split_part(t, '|', 2) || ':' || split_part(t, '|', 3) || ':' || split_part(t, '|', 4), ' ' order by t collate "C") from unnest(a.lignes) t), '∅')
                  || ' | ' || coalesce((select coalesce(b.motif, 'aucun') || ' ' || coalesce((select string_agg(split_part(t, '|', 2) || ':' || split_part(t, '|', 3) || ':' || split_part(t, '|', 4), ' ' order by t collate "C") from unnest(b.lignes) t), '∅') from ecritures_attendues_de_la_periode('{DR}', null, '{J}') b where b.genre = 'mouvement' and b.source_id = '{M}'), 'absent')
             from ecriture_attendue_vente_facturee('{DR}', 'mouvement', '{M}') a$q$,
        'OK', 'aucun - 512000:credit:2 627000:debit:2 | aucun 512000:credit:2 627000:debit:2'),
      (25, '25. d''un bloc, chaque source du dossier rend ce que la composition source par source rend', $q${P} {E1} select enregistrer_encaissement('{DR}', {FB}, '{R}', 600, 'virement', null, '[{"taux": 20, "montant": 600}]'::jsonb); {AB} select enregistrer_encaissement('{DR}', {FE}, '{R}', 119.50, 'virement', null, '[{"taux": 20, "montant": 119.50}]'::jsonb); select enregistrer_encaissement('{DR}', {FT}, '{R}', 120.11, 'virement', null, '[{"taux": 20, "montant": 120.11}]'::jsonb);$q$, 'postgres',
        $q$select count(*) filter (where b.lignes is distinct from a.lignes or b.motif is distinct from a.motif) || '/' || count(*) from ecritures_attendues_de_la_periode('{DR}', null, '{J}') b cross join lateral ecriture_attendue_vente_facturee('{DR}', b.genre, b.source_id) a$q$,
        'OK', '0/5'),
      (26, '26. « Ma simulation » compte la part d''après la reprise', '{P} {E1}', 'chef',
        $q$select ventes_facturees_de_la_simulation('{DR}', extract(year from '{R}'::date)::integer) -> 'par_mois' ->> to_char('{R}'::date, 'YYYY-MM')$q$,
        'OK', '37501'),
      -- L'avoir d'une facture reprise.
      (27, '27. le cabinet émet l''avoir d''une facture reprise : la série de son mandataire, une source, l''émetteur du dossier', '{P} {AB}', 'chef',
        $q$select f.numero || ' ' || f.source_de_la_vente || ' ' || f.emetteur_nom || ' ' || f.emetteur_siret || ' ' || f.emetteur_adresse || ' ' || (f.mandataire_nom is not null) || ' ' || (f.facture_origine_id = {FB}) from factures_emises f where f.dossier_id = '{DR}' and f.type = 'avoir' and f.statut = 'validee'$q$,
        'OK', 'MA' || extract(year from jour)::integer || '-0001 true ESSAI A8B DR 12345678200010 ESSAI A8B ADRESSE DR true true'),
      (28, '28. le client « Ventes » l''émet dans sa série', '{P}', 'client',
        $q$select x.numero from ({AVB}) x$q$,
        'OK', 'A' || extract(year from jour)::integer || '-0001'),
      (29, '29. ce qui reste à créditer, ses avoirs repris déduits : 120,00 € s''émettent, 120,01 € non (22023)', $q${P} select * from enregistrer_facture('{DR}', null, jsonb_build_object('type', 'avoir', 'facture_origine_id', {FN}, 'date_emission', '{J}', 'montant_ht', -100, 'montant_tva', -20, 'montant_ttc', -120), '[{"designation": "Avoir", "quantite": -1, "prix_unitaire_ht": 100, "taux_tva": 20}]'::jsonb, true);$q$, 'chef',
        $q$select x.numero from enregistrer_facture('{DR}', null, jsonb_build_object('type', 'avoir', 'facture_origine_id', {FN}, 'date_emission', '{J}', 'montant_ht', -0.01, 'montant_tva', 0, 'montant_ttc', -0.01), '[{"designation": "Avoir", "quantite": -1, "prix_unitaire_ht": 0.01, "taux_tva": 20}]'::jsonb, true) x$q$,
        '22023', 'Cet avoir créditerait 0,01 € : la facture R-NUL-1 n''a plus que 0,00 € à créditer.'),
      (30, '30. daté d''avant la reprise (22023)', '{P}', 'chef',
        $q$select x.numero from enregistrer_facture('{DR}', null, jsonb_build_object('type', 'avoir', 'facture_origine_id', {FB}, 'date_emission', ('{R}'::date - 1), 'montant_ht', -100, 'montant_tva', -20, 'montant_ttc', -120), '[{"designation": "Retour", "quantite": -1, "prix_unitaire_ht": 100, "taux_tva": 20}]'::jsonb, true) x$q$,
        '22023', format('La facture R-BIENS-1 est reprise de l''ancien logiciel : son avoir se date du jour de la reprise des factures, le %s, ou d''après — ce qui précède, l''ancien logiciel l''a émis.', to_char(reprise, 'DD/MM/YYYY'))),
      (31, '31. sur une facture reprise qui mêle biens et services (22023)', '{P}', 'chef',
        $q$select x.numero from enregistrer_facture('{DR}', null, jsonb_build_object('type', 'avoir', 'facture_origine_id', {FM}, 'date_emission', '{J}', 'montant_ht', -100, 'montant_tva', -20, 'montant_ttc', -120), '[{"designation": "Retour", "quantite": -1, "prix_unitaire_ht": 100, "taux_tva": 20}]'::jsonb, true) x$q$,
        '22023', 'La facture R-MIXTE-1 est reprise de l''ancien logiciel et mêle biens et services : son avoir ne se fait pas encore dans l''application, qui ne sait pas répartir entre les deux ce qu''il crédite.'),
      (32, '32. sur un avoir repris, comme sur un autre avoir (22023)', '{P}', 'chef',
        $q$select x.numero from enregistrer_facture('{DR}', null, jsonb_build_object('type', 'avoir', 'facture_origine_id', {FA}, 'date_emission', '{J}', 'montant_ht', -10, 'montant_tva', -1, 'montant_ttc', -11), '[{"designation": "Retour", "quantite": -1, "prix_unitaire_ht": 10, "taux_tva": 10}]'::jsonb, true) x$q$,
        '22023', 'Un avoir corrige une facture validée, jamais un brouillon ni un autre avoir.'),
      -- L'import que l'encaissement ou l'avoir retient.
      (33, '33. un encaissement retient le retrait de l''import (23514)', '{P} {E1}', 'chef',
        $q$select retirer_import('{DR}', (select l.id from imports_factures l where l.dossier_id = '{DR}'))::text$q$,
        '23514', 'La facture reprise R-SERV-1 a un encaissement : son import ne se retire plus.'),
      (34, '34. un avoir de l''application aussi (23514)', '{P} {AB}', 'chef',
        $q$select retirer_import('{DR}', (select l.id from imports_factures l where l.dossier_id = '{DR}'))::text$q$,
        '23514', 'La facture reprise R-BIENS-1 a un avoir de l''application (MA' || extract(year from jour)::integer || '-0001) : son import ne se retire plus.')
    ) as t(rang, etape, pose, profil, requete, code, attendu) loop
      v_code := 'OK'; v_msg := null; v_obs := null;
      begin
        -- Les remplacements, la pose puis la requête : les gestes nommés, le lot et ses dates, l'encaissement relu, les
        -- factures du lot par leur numéro, le mouvement, le dossier, les dates.
        for v_f in select x.rang, x.texte from (values (1, e.pose), (2, e.requete)) as x(rang, texte) where x.texte is not null loop
          v_texte := replace(replace(replace(replace(v_f.texte, '{P}', poser), '{E1}', encaisser), '{AB}', 'select * from ({AVB}) x;'), '{AVB}', avoir);
          v_texte := replace(replace(replace(replace(v_texte, '{L}', lot), '{AVANT}', (reprise - 10)::text), '{AVANT2}', (reprise - 5)::text),
            '{E1ID}', '(select e.id from encaissements_factures e where e.facture_id = {FS} order by e.cree_le, e.id limit 1)');
          v_texte := replace(replace(replace(replace(replace(replace(replace(replace(v_texte,
            '{FS}', '(select f.id from factures_emises f where f.dossier_id = ''{DR}'' and f.numero = ''R-SERV-1'')'),
            '{FB}', '(select f.id from factures_emises f where f.dossier_id = ''{DR}'' and f.numero = ''R-BIENS-1'')'),
            '{FD}', '(select f.id from factures_emises f where f.dossier_id = ''{DR}'' and f.numero = ''R-DEB-1'')'),
            '{FM}', '(select f.id from factures_emises f where f.dossier_id = ''{DR}'' and f.numero = ''R-MIXTE-1'')'),
            '{FT}', '(select f.id from factures_emises f where f.dossier_id = ''{DR}'' and f.numero = ''R-TAUX-1'')'),
            '{FN}', '(select f.id from factures_emises f where f.dossier_id = ''{DR}'' and f.numero = ''R-NUL-1'')'),
            '{FE}', '(select f.id from factures_emises f where f.dossier_id = ''{DR}'' and f.numero = ''R-NET-1'')'),
            '{FA}', '(select f.id from factures_emises f where f.dossier_id = ''{DR}'' and f.numero = ''R-AV-1'')');
          v_texte := replace(replace(replace(replace(v_texte, '{M}', mouvement), '{DR}', dr), '{R}', reprise::text), '{J}', jour::text);
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
        begin
          -- `postgres` : le propriétaire, qui exécute la règle du cumul et ses compositions (aucun connecté ne les
          -- exécute), sous la session du chef pour les fonctions qui jugent l'accès.
          if e.profil <> 'postgres' then
            execute 'set local role authenticated';
          end if;
          perform set_config('request.jwt.claims',
            json_build_object('sub', case e.profil when 'inconnu' then inconnu when 'client' then client else chef end, 'role', 'authenticated')::text, true);
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

    -- Le catalogue : la fonction neuve aux droits de l'appelant, stable, son chemin fixé, ni à l'anonyme ni aux connectés ;
    -- les sept fonctions remplacées gardent leur forme et leurs droits ; la garde des encaissements, celle de leur
    -- déclencheur.
    verdicts := verdicts || jsonb_build_object('rang', 35, 'etape', '35. le catalogue : la fonction neuve et les sept remplacées, leur forme et leurs droits',
      'ok', exists (select 1 from pg_proc p
                     where p.oid = to_regprocedure('public.montants_par_taux_du_document(uuid)')
                       and not p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=public']
                       and not has_function_privilege('anon', p.oid, 'execute')
                       and not has_function_privilege('authenticated', p.oid, 'execute'))
        and (select string_agg(p.proname || ':' || p.prosecdef::int || p.provolatile::text || ':'
                               || has_function_privilege('anon', p.oid, 'execute')::int
                               || has_function_privilege('authenticated', p.oid, 'execute')::int, ',' order by p.proname collate "C")
               from pg_proc p
              where p.pronamespace = 'public'::regnamespace
                and p.proname in ('calcul_vente_facturee', 'ecriture_attendue_vente_facturee', 'ecritures_attendues_de_la_periode',
                                  'enregistrer_encaissement', 'enregistrer_facture', 'garder_encaissement_facture',
                                  'ventes_facturees_de_la_simulation'))
            = 'calcul_vente_facturee:0s:00,ecriture_attendue_vente_facturee:0s:00,ecritures_attendues_de_la_periode:0s:00,'
              || 'enregistrer_encaissement:1v:01,enregistrer_facture:1v:01,garder_encaissement_facture:0v:00,'
              || 'ventes_facturees_de_la_simulation:1s:01'
        and exists (select 1 from pg_trigger t
                     where t.tgrelid = 'public.encaissements_factures'::regclass and t.tgname = 'encaissements_factures_gardes'
                       and t.tgfoid = 'public.garder_encaissement_facture()'::regprocedure),
      'observe', 'relu au catalogue');
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  -- Rien n'est resté : ni le dossier jetable, ni son accès, ni ses factures, ses lots, ses encaissements, son mouvement.
  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni le dossier jetable, ni son accès, ni ses factures, ses lots, ses encaissements, son mouvement',
    'ok', not exists (select 1 from dossiers where id = dr::uuid)
      and not exists (select 1 from memberships where id = acces_v::uuid)
      and not exists (select 1 from factures_emises where dossier_id = dr::uuid)
      and not exists (select 1 from imports_factures where dossier_id = dr::uuid)
      and not exists (select 1 from encaissements_factures where dossier_id = dr::uuid)
      and not exists (select 1 from lignes_bancaires where id = mouvement::uuid),
    'observe', 'relu');
  perform set_config('essai.encaissements_des_reprises', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.encaissements_des_reprises')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
