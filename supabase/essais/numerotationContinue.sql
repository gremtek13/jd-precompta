-- LA NUMÉROTATION QUI CONTINUE (ligne 51.5, étape A9a ; la migration `numerotation_continue`, PRÉPARÉE le 10/11/2026,
-- supabase/preparees/, par-dessus `factures_importees`, A8a). Le récit : HISTORIQUE.md, « 10/11/2026 — A9A : LA
-- NUMÉROTATION QUI CONTINUE, EN BASE (PRÉPARÉE, PAS APPLIQUÉE) ». À rejouer par `execute_sql` après toute migration qui
-- touche `attribuer_numero_facture`, `prochain_numero_facture`, `enregistrer_facture`, la garde ou les contraintes de
-- `factures_emises`, `facture_numerotation`, les factures reprises, `modeles_numerotation`, `continuite_des_series` ou
-- leurs fonctions. La suppression directe d'une ligne de ces tables ne se joue pas ici (l'outil d'exécution de la
-- production retient une suppression) : la garde la refuse, ce que la réplique de l'étape a éprouvé ; le retrait d'un
-- import, lui, passe par sa fonction, et se joue ici.
--
-- Ce qui se prouve ici, et ne se relit pas : le modèle de numéro, posé par le chef seul — ni un membre de l'équipe, ni le
-- client « Ventes », ni un compte sans accès, ni l'anonyme —, sous ses refus et leurs mots (l'alphabet, le compteur,
-- l'année, les espaces, le compteur annuel sans l'année, le nombre après le premier tiret, la longueur, l'année d'effet,
-- le premier numéro, la nature, l'émetteur ; la racine du mandataire, G1.45 ; deux séries qui se recouvriraient) ; la
-- série de QUI valide — le client dans la sienne, le cabinet (son chef ou un membre) dans celle du mandataire, factures
-- et avoirs, le mandataire posé sur les siennes seules — ; le modèle en vigueur pour l'année, le plus récemment posé ;
-- le compteur continu et le premier numéro ; la continuité d'une suite reprise — la fin confirmée, les trous nommés,
-- levés, motif écrit, et leurs refus — ; la chronologie de la série, validées et reprises ; une reprise qui ne rejoint
-- pas une série continuée, un import qui ne se retire plus ; la garde d'hier, que deux séries ne font pas échouer ; l'état
-- que la carte du cabinet lira ; la garde des deux tables ; la validation qui ne prend pas un numéro d'une autre série ;
-- le catalogue.
--
-- Deux dossiers jetables du cabinet du dossier `test` (préfixe `a9a00000-0000-4000-8000`) : D, basculé, en trésorerie,
-- en franchise, une société dont l'identité est réglée, où l'accès du client d'essai porte « Ventes » ; D2, ni basculé,
-- sans accès. La bascule de D est posée à son insertion (maintenant) ; sa date de reprise, le 01/07/2026, au plus tard
-- le jour de la bascule ; les factures reprises sont de juin 2026, les factures validées de juillet à octobre 2026 : le
-- jeu ne dépend pas du jour où il se joue (à partir du 01/11/2026). Chaque étape se joue dans sa sous-transaction et s'y
-- ANNULE (`ANNULATION_ETAPE`) : ce que le chef pose d'abord (sous sa session ; `{CLIENT}` et `{CHEF}` y changent de
-- session), puis la requête du profil ; le jeu s'annule à la fin (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le
-- relit. Les verdicts voyagent dans un réglage LOCAL à la transaction (`essai.numerotation_continue`), que la requête
-- finale lit : le fichier se joue d'un seul appel, ne crée ni table ni fonction, ne contient aucune instruction de
-- suppression, et ne rend rien qui dépende d'une ligne hors de ses dossiers. Hors de l'outil d'exécution, il se joue en
-- UNE transaction (`psql -1`). Sans la migration, une ligne dit qu'il attend (EN ATTENTE) et rien ne s'écrit.
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  d constant text := 'a9a00000-0000-4000-8000-0000000000d1';
  d2 constant text := 'a9a00000-0000-4000-8000-0000000000d2';
  acces constant text := 'a9a00000-0000-4000-8000-0000000000a1';
  -- Un compte connecté qu'aucun accès ni aucun cabinet ne nomme (le profil `inconnu`).
  inconnu constant text := 'a9a00000-0000-4000-8000-0000000000f1';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  -- Une facture de D, validée (`{V:date}`) — par la session en cours, le client ou le cabinet — ; l'avoir qui crédite
  -- entièrement une facture de D (`{AV:numéro:date}`) ; un brouillon (`{B:date}`).
  facture constant text := $q$enregistrer_facture('{D}', null, '{"tiers_nom":"Client N","type_client":"non_assujetti","nature_operation":"services","montant_ht":80,"montant_tva":0,"montant_ttc":80,"date_emission":"\1","mentions_legales":"TVA non applicable, art. 293 B du CGI.","emetteur_nom":"ESSAI NUMÉROTATION SOCIÉTÉ D","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI NUMÉROTATION ADRESSE D"}'::jsonb, '[{"designation":"Séance","quantite":1,"prix_unitaire_ht":80,"taux_tva":0}]'::jsonb, $q$;
  avoir constant text := $q$(enregistrer_facture('{D}', null, jsonb_build_object('type', 'avoir', 'facture_origine_id', (select f.id from factures_emises f where f.dossier_id = '{D}' and f.numero = '\1'), 'date_emission', '\2', 'montant_ht', -80, 'montant_tva', 0, 'montant_ttc', -80, 'mentions_legales', 'TVA non applicable, art. 293 B du CGI.'), '[{"designation":"Séance","quantite":-1,"prix_unitaire_ht":80,"taux_tva":0}]'::jsonb, true)).numero$q$;
  -- Les lots repris de l'ancien logiciel (juin 2026), dans la série du modèle FA-{AAAA}-{N:5}.
  lot_trou text; lot_un text; lot_57 text; lot_epars text; lot_sept text;
  e record; v_code text; v_msg text; v_req text; v_pose text; v_obs text;
  verdicts jsonb := '[]'::jsonb;
begin
  if to_regclass('public.modeles_numerotation') is null then
    perform set_config('essai.numerotation_continue', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration numerotation_continue', 'ok', true,
      'observe', 'absente : l''essai se joue dès que la migration y est'))::text, true);
    return;
  end if;
  select string_agg(format('{"numero":"%s","type":"facture","date_emission":"%s","tiers_nom":"Client R","type_client":"non_assujetti","nature_operation":"services","option_debits":false,"montant_ht":10,"montant_tva":0,"montant_ttc":10,"lignes":[{"designation":"Séance","quantite":1,"prix_unitaire_ht":10,"taux_tva":0}],"transmise_par":"pdf"}', x.n, x.j), ',' order by x.j)
    filter (where x.lot = 'trou') ,
         string_agg(format('{"numero":"%s","type":"facture","date_emission":"%s","tiers_nom":"Client R","type_client":"non_assujetti","nature_operation":"services","option_debits":false,"montant_ht":10,"montant_tva":0,"montant_ttc":10,"lignes":[{"designation":"Séance","quantite":1,"prix_unitaire_ht":10,"taux_tva":0}],"transmise_par":"pdf"}', x.n, x.j), ',' order by x.j)
    filter (where x.lot = 'un'),
         string_agg(format('{"numero":"%s","type":"facture","date_emission":"%s","tiers_nom":"Client R","type_client":"non_assujetti","nature_operation":"services","option_debits":false,"montant_ht":10,"montant_tva":0,"montant_ttc":10,"lignes":[{"designation":"Séance","quantite":1,"prix_unitaire_ht":10,"taux_tva":0}],"transmise_par":"pdf"}', x.n, x.j), ',' order by x.j)
    filter (where x.lot = '57'),
         string_agg(format('{"numero":"%s","type":"facture","date_emission":"%s","tiers_nom":"Client R","type_client":"non_assujetti","nature_operation":"services","option_debits":false,"montant_ht":10,"montant_tva":0,"montant_ttc":10,"lignes":[{"designation":"Séance","quantite":1,"prix_unitaire_ht":10,"taux_tva":0}],"transmise_par":"pdf"}', x.n, x.j), ',' order by x.j)
    filter (where x.lot = 'epars'),
         string_agg(format('{"numero":"%s","type":"facture","date_emission":"%s","tiers_nom":"Client R","type_client":"non_assujetti","nature_operation":"services","option_debits":false,"montant_ht":10,"montant_tva":0,"montant_ttc":10,"lignes":[{"designation":"Séance","quantite":1,"prix_unitaire_ht":10,"taux_tva":0}],"transmise_par":"pdf"}', x.n, x.j), ',' order by x.j)
    filter (where x.lot = 'sept')
    into lot_trou, lot_un, lot_57, lot_epars, lot_sept
    from (values ('trou', 'FA-2026-00001', '2026-06-02'), ('trou', 'FA-2026-00002', '2026-06-05'), ('trou', 'FA-2026-00005', '2026-06-25'),
                 ('un', 'FA-2026-00001', '2026-06-02'),
                 ('57', 'FA-2026-00057', '2026-06-10'), ('57', 'FA-2026-00058', '2026-06-12'),
                 ('epars', 'FA-2026-00001', '2026-06-01'), ('epars', 'FA-2026-00003', '2026-06-03'), ('epars', 'FA-2026-00005', '2026-06-05'),
                 ('epars', 'FA-2026-00007', '2026-06-07'), ('epars', 'FA-2026-00009', '2026-06-09'), ('epars', 'FA-2026-00011', '2026-06-11'),
                 ('epars', 'FA-2026-00013', '2026-06-13'),
                 ('sept', 'FA-2026-00007', '2026-06-20')) as x(lot, n, j);
  begin
    -- Le jeu : deux dossiers jetables, et l'accès « Ventes » du client d'essai à D, insérés par le propriétaire comme
    -- `create-client-access` les insère.
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, ventes_par_les_factures, statut_tva,
                          siret, adresse, forme_juridique, denomination_imprimee) values
      (d::uuid, 'ESSAI NUMÉROTATION D', cabinet, 'tresorerie', '455000', true, 'franchise', '12345678200010',
       'ESSAI NUMÉROTATION ADRESSE D', '5710', 'ESSAI NUMÉROTATION SOCIÉTÉ D'),
      (d2::uuid, 'ESSAI NUMÉROTATION D2', cabinet, 'tresorerie', '455000', false, null, null, null, null, null);
    insert into memberships (id, user_id, dossier_id, role, email, droit_ventes) values
      (acces::uuid, client::uuid, d::uuid, 'client', 'essai-numerotation@example.test', true);

    -- Une étape : {rang, étape, ce que le CHEF pose d'abord (sous sa session), le profil — `chef`, `chef_simple` (le compte
    -- client rattaché au cabinet comme chef, le temps de l'étape), `membre` (rattaché comme comptable, affecté à D),
    -- `client`, `inconnu`, `service`, `anon` ou `postgres` —, sa requête, le code attendu (`OK` : acceptée) et ce qu'elle
    -- rend, ou les mots du refus (un `%` : le motif d'un LIKE)}.
    for e in select * from (values
      -- ── LE MODÈLE : QUI LE POSE ──
      (1, '1. le chef pose le modèle des factures du client ; la table le porte, son auteur nommé', $q${FA}$q$, 'chef',
        $q$select (exists (select 1 from modeles_numerotation m where m.dossier_id = '{D}' and m.nature = 'facture' and m.emetteur = 'client' and m.modele = 'FA-{AAAA}-{N:5}' and m.annuel and m.depuis = 2026 and m.premier_numero = 1 and m.pose_par = '{CHEF_ID}'))::text$q$,
        'OK', 'true'),
      (2, '2. un chef qui n''est pas super-administrateur le pose aussi', null, 'chef_simple',
        $q$select (fixer_modele_numerotation('{D}', 'facture', 'client', 'FA-{AAAA}-{N:5}', true, 2026) is not null)::text$q$, 'OK', 'true'),
      (3, '3. un membre de l''équipe, affecté au dossier, ne le pose pas (42501)', null, 'membre',
        $q$select fixer_modele_numerotation('{D}', 'facture', 'client', 'FA-{AAAA}-{N:5}', true, 2026)::text$q$, '42501',
        'Seul le chef du cabinet pose le modèle de numéro d''un dossier.'),
      (4, '4. le client « Ventes » non plus (42501)', null, 'client',
        $q$select fixer_modele_numerotation('{D}', 'facture', 'client', 'FA-{AAAA}-{N:5}', true, 2026)::text$q$, '42501', 'Accès refusé à ce dossier.'),
      (5, '5. ni un compte sans accès (42501)', null, 'inconnu',
        $q$select fixer_modele_numerotation('{D}', 'facture', 'client', 'FA-{AAAA}-{N:5}', true, 2026)::text$q$, '42501', 'Accès refusé à ce dossier.'),
      (6, '6. ni l''anonyme, qui n''exécute pas la fonction (42501)', null, 'anon',
        $q$select fixer_modele_numerotation('{D}', 'facture', 'client', 'FA-{AAAA}-{N:5}', true, 2026)::text$q$, '42501',
        'permission denied for function fixer_modele_numerotation'),
      -- ── LE MODÈLE : SES REFUS ──
      (7, '7. un caractère hors de G1.05 (22023)', null, 'chef',
        $q$select fixer_modele_numerotation('{D}', 'facture', 'client', 'Fé{N:2}', false, 2026)::text$q$, '22023',
        'Un modèle de numéro s''écrit en lettres, chiffres, espaces et signes « - + _ / », avec l''année {AAAA} et le compteur {N:k}, k de 1 à 9 (DGFiP, annexe 7, G1.05).'),
      (8, '8. pas de compteur (22023)', null, 'chef',
        $q$select fixer_modele_numerotation('{D}', 'facture', 'client', 'F{AAAA}', true, 2026)::text$q$, '22023',
        'Un modèle de numéro porte un compteur, et un seul : {N:k}, au moins k chiffres (k de 1 à 9).'),
      (9, '9. l''année deux fois (22023)', null, 'chef',
        $q$select fixer_modele_numerotation('{D}', 'facture', 'client', '{AAAA}-{AAAA}-{N:2}', true, 2026)::text$q$, '22023',
        'Un modèle de numéro porte l''année une fois au plus : {AAAA}.'),
      (10, '10. deux espaces de suite (22023)', null, 'chef',
        $q$select fixer_modele_numerotation('{D}', 'facture', 'client', 'F  {N:2}', false, 2026)::text$q$, '22023',
        'Un numéro ne commence ni ne finit par une espace, et n''en porte jamais deux de suite (DGFiP, annexe 7, G1.05).'),
      (11, '11. un compteur annuel sans l''année (22023)', null, 'chef',
        $q$select fixer_modele_numerotation('{D}', 'facture', 'client', 'C{N:5}', true, 2026)::text$q$, '22023',
        'Un compteur qui repart de 1 chaque année porte l''année dans le numéro, {AAAA} : sans elle, deux factures auraient le même numéro d''une année sur l''autre.'),
      (12, '12. après le premier tiret, autre chose qu''un nombre seul (22023)', null, 'chef',
        $q$select fixer_modele_numerotation('{D}', 'facture', 'client', 'F-{AAAA}/{N:4}', true, 2026)::text$q$, '22023',
        'Après son premier tiret, un numéro porte un nombre seul jusqu''au tiret suivant — le compteur, l''année ou des chiffres, neuf au plus — : la garde des factures y lit le rang d''une facture pour en suivre l''ordre.'),
      (13, '13. plus de 35 caractères, le compteur compté sur neuf chiffres (22023)', null, 'chef',
        $q$select fixer_modele_numerotation('{D}', 'facture', 'client', 'FACTURESDUCLIENTABCDEFGHIJKLMNO{AAAA}{N:4}', true, 2026)::text$q$, '22023',
        'Ce modèle donnerait des numéros de 44 caractères, le compteur compté sur neuf chiffres : un numéro en compte 35 au plus (DGFiP, annexe 7, G1.05).'),
      (14, '14. une année d''effet hors de 2000 à 2099 (22023)', null, 'chef',
        $q$select fixer_modele_numerotation('{D}', 'facture', 'client', 'FA-{AAAA}-{N:5}', true, 1999)::text$q$, '22023',
        'Un modèle de numéro s''applique à partir d''une année, de 2000 à 2099 (DGFiP, annexe 7, G1.36).'),
      (15, '15. un premier numéro nul (22023)', null, 'chef',
        $q$select fixer_modele_numerotation('{D}', 'facture', 'client', 'FA-{AAAA}-{N:5}', true, 2026, 0)::text$q$, '22023',
        'Le premier numéro d''une série est un compteur de 1 à 999 999 999.'),
      (16, '16. une nature inconnue (22023)', null, 'chef',
        $q$select fixer_modele_numerotation('{D}', 'note', 'client', 'FA-{AAAA}-{N:5}', true, 2026)::text$q$, '22023',
        'Un modèle de numéro vaut pour les factures ou pour les avoirs.'),
      (17, '17. un émetteur inconnu (22023)', null, 'chef',
        $q$select fixer_modele_numerotation('{D}', 'facture', 'cabinet', 'FA-{AAAA}-{N:5}', true, 2026)::text$q$, '22023',
        'Un modèle de numéro vaut pour la série du client (les factures qu''il valide) ou pour celle du cabinet mandataire (celles que le cabinet valide en son nom, DGFiP, annexe 7, G1.45).'),
      (18, '18. la série du cabinet sous le modèle du client : refusée, la racine du mandataire (G1.45, 22023)', null, 'chef',
        $q$select fixer_modele_numerotation('{D}', 'facture', 'mandataire', 'F{AAAA}-{N:4}', true, 2026)::text$q$, '22023',
        'Le modèle F{AAAA}-{N:4} est celui de la série des factures du client : la série du cabinet mandataire porte une racine propre, distincte de celle du client (DGFiP, annexe 7, G1.45).'),
      (19, '19. un modèle qui produirait des numéros d''une autre série (22023)', null, 'chef',
        $q$select fixer_modele_numerotation('{D}', 'facture', 'client', 'A{AAAA}-{N:5}', true, 2026)::text$q$, '22023',
        'Le modèle A{AAAA}-{N:5} produirait des numéros de la série des avoirs du client (A{AAAA}-{N:4}) : deux séries d''un dossier ne partagent jamais un numéro.'),
      (20, '20. un modèle qui recouvre celui qu''il remplace (22023)', null, 'chef',
        $q$select fixer_modele_numerotation('{D}', 'facture', 'client', 'F{AAAA}-{N:5}', true, 2026)::text$q$, '22023',
        'Le modèle F{AAAA}-{N:5} recouvre celui qu''il remplace (F{AAAA}-{N:4}) : un même numéro se lirait dans les deux séries. Une nouvelle série porte un préfixe distinct (BOI-TVA-DECLA-30-20-20-10, § 90).'),
      (21, '21. les avoirs du client sous le modèle de ses factures : un seul compteur', $q$select fixer_modele_numerotation('{D}', 'facture', 'client', 'FA-{AAAA}-{N:5}', true, 2026); select fixer_modele_numerotation('{D}', 'avoir', 'client', 'FA-{AAAA}-{N:5}', true, 2026); {CLIENT} select {V:2026-07-20}$q$, 'client',
        $q$select {AV:FA-2026-00001:2026-07-21}$q$, 'OK', 'FA-2026-00002'),
      (22, '22. un modèle posé pour une année suivante ne vaut pas avant elle', $q$select fixer_modele_numerotation('{D}', 'facture', 'client', 'FA-{AAAA}-{N:5}', true, 2026); select fixer_modele_numerotation('{D}', 'facture', 'client', 'FB-{AAAA}-{N:5}', true, 2027)$q$, 'client',
        $q$select {V:2026-07-20}$q$, 'OK', 'FA-2026-00001'),
      (23, '23. le plus récemment posé l''emporte pour les années qu''il couvre', $q$select fixer_modele_numerotation('{D}', 'facture', 'client', 'FA-{AAAA}-{N:5}', true, 2026); select fixer_modele_numerotation('{D}', 'facture', 'client', 'FB-{AAAA}-{N:5}', true, 2027); select fixer_modele_numerotation('{D}', 'facture', 'client', 'FC-{AAAA}-{N:5}', true, 2000)$q$, 'client',
        $q$select {V:2026-07-20}$q$, 'OK', 'FC-2026-00001'),
      -- ── LA SÉRIE DE QUI VALIDE ──
      (24, '24. le client « Ventes » valide dans la série du client, celle d''hier', null, 'client',
        $q$select {V:2026-07-20}$q$, 'OK', 'F2026-0001'),
      (25, '25. le chef valide dans la série du cabinet mandataire', null, 'chef',
        $q$select {V:2026-07-20}$q$, 'OK', 'M2026-0001'),
      (26, '26. un membre de l''équipe aussi', null, 'membre',
        $q$select {V:2026-07-20}$q$, 'OK', 'M2026-0001'),
      (27, '27. l''avoir du client, dans la série des avoirs du client', $q${CLIENT} select {V:2026-07-20}$q$, 'client',
        $q$select {AV:F2026-0001:2026-07-21}$q$, 'OK', 'A2026-0001'),
      (28, '28. l''avoir du cabinet, dans la série des avoirs du mandataire', $q$select {V:2026-07-20}$q$, 'chef',
        $q$select {AV:M2026-0001:2026-07-21}$q$, 'OK', 'MA2026-0001'),
      (29, '29. les deux séries se suivent chacune', $q${CLIENT} select {V:2026-07-20}; {CHEF} select {V:2026-07-21}$q$, 'client',
        $q$select {V:2026-07-22}$q$, 'OK', 'F2026-0002'),
      (30, '30. le mandataire est posé sur les factures du cabinet, jamais sur celles du client', $q${CLIENT} select {V:2026-07-20}; {CHEF} select {V:2026-07-21}$q$, 'chef',
        $q$select string_agg(f.numero || ':' || (f.mandataire_nom is not null)::text, ',' order by f.numero collate "C") from factures_emises f where f.dossier_id = '{D}'$q$, 'OK',
        'F2026-0001:false,M2026-0001:true'),
      (31, '31. leurs compteurs : la série d''hier sous sa clé, celle du cabinet sous la clé de son modèle', $q${CLIENT} select {V:2026-07-20}; {CHEF} select {V:2026-07-21}$q$, 'postgres',
        $q$select string_agg(n.type || ':' || n.annee || ':' || n.dernier_numero, ',' order by n.type collate "C") from facture_numerotation n where n.dossier_id = '{D}'$q$, 'OK',
        'facture:2026:1,modele:a:M{AAAA}-{N:4}:2026:1'),
      (32, '32. un compteur continu, sans l''année, se range à l''année 0', $q$select fixer_modele_numerotation('{D}', 'facture', 'client', 'C{N:6}', false, 2000); {CLIENT} select {V:2026-07-20}$q$, 'postgres',
        $q$select string_agg(f.numero || '|' || n.annee || '|' || n.dernier_numero, ',') from factures_emises f, facture_numerotation n where f.dossier_id = '{D}' and n.dossier_id = '{D}' and n.type = 'modele:c:C{N:6}'$q$, 'OK',
        'C000001|0|1'),
      (33, '33. le premier numéro d''une série ouverte en cours d''année', $q$select fixer_modele_numerotation('{D}', 'facture', 'client', 'FA-{AAAA}-{N:5}', true, 2026, 57)$q$, 'client',
        $q$select {V:2026-07-20}$q$, 'OK', 'FA-2026-00057'),
      -- ── LA CONTINUITÉ D'UNE SUITE REPRISE ──
      (34, '34. une suite reprise que le cabinet n''a pas confirmée : la série ne continue pas (22023)', $q${FA} {REPRISE} {I:TROU}$q$, 'client',
        $q$select {V:2026-07-20}$q$, '22023',
        'La suite reprise de la série du modèle FA-{AAAA}-{N:5} (2026) n''est pas confirmée : le cabinet dit le dernier numéro que l''ancien logiciel y a émis (FA-2026-00005 au moins) avant que l''application la continue.'),
      (35, '35. sa fin confirmée, ses trous nommés (22023)', $q${FA} {REPRISE} {I:TROU} {FIN:5}$q$, 'client',
        $q$select {V:2026-07-20}$q$, '22023',
        'La série du modèle FA-{AAAA}-{N:5} (2026) a des trous : FA-2026-00003 à FA-2026-00004. Chaque numéro manquant s''importe, ou le cabinet le lève, motif écrit, avant que l''application continue la série.'),
      (36, '36. ses trous levés, la série continue', $q${FA} {REPRISE} {I:TROU} {FIN:5} {LEVER:3:4}$q$, 'client',
        $q$select {V:2026-07-20}$q$, 'OK', 'FA-2026-00006'),
      (37, '37. une fin au-delà du plus haut repris : ce qui manque jusqu''à elle est un trou (22023)', $q${FA} {REPRISE} {I:TROU} {FIN:7} {LEVER:3:4}$q$, 'client',
        $q$select {V:2026-07-20}$q$, '22023',
        'La série du modèle FA-{AAAA}-{N:5} (2026) a des trous : FA-2026-00006 à FA-2026-00007. Chaque numéro manquant s''importe, ou le cabinet le lève, motif écrit, avant que l''application continue la série.'),
      (38, '38. … levé, la série continue après la fin', $q${FA} {REPRISE} {I:TROU} {FIN:7} {LEVER:3:4} {LEVER:6:7}$q$, 'client',
        $q$select {V:2026-07-20}$q$, 'OK', 'FA-2026-00008'),
      (39, '39. ce qui n''est pas un trou ne se lève pas (22023)', $q${FA} {REPRISE} {I:TROU} {FIN:5}$q$, 'chef',
        $q$select lever_trous_de_numerotation('{D}', 'facture', 'client', 2026, 5, 5, 'Essai')::text$q$, '22023',
        'Les compteurs 5 à 5 ne sont pas un trou de la série du modèle FA-{AAAA}-{N:5} (2026) que rien ne couvre encore : seul un numéro qui manque se lève.'),
      (40, '40. une fin sous le plus haut repris (22023)', $q${FA} {REPRISE} {I:TROU}$q$, 'chef',
        $q$select confirmer_fin_de_serie('{D}', 'facture', 'client', 2026, 4, 'Essai')::text$q$, '22023',
        'La fin de la suite reprise de la série du modèle FA-{AAAA}-{N:5} (2026) est le compteur de son dernier numéro, au moins 5 : le plus haut repris, ou le premier de la série.'),
      (41, '41. une fin, une fois la série continuée (22023)', $q${FA} {REPRISE} {I:TROU} {FIN:5} {LEVER:3:4} {CLIENT} select {V:2026-07-20}$q$, 'chef',
        $q$select confirmer_fin_de_serie('{D}', 'facture', 'client', 2026, 9, 'Essai')::text$q$, '22023',
        'L''application a déjà continué la série du modèle FA-{AAAA}-{N:5} (2026) : la fin de sa suite reprise ne se confirme plus.'),
      (42, '42. une fin confirmée ne recule pas (22023)', $q${FA} {REPRISE} {I:TROU} {FIN:7}$q$, 'chef',
        $q$select confirmer_fin_de_serie('{D}', 'facture', 'client', 2026, 6, 'Essai')::text$q$, '22023',
        'La fin de la suite reprise de la série du modèle FA-{AAAA}-{N:5} (2026) est déjà confirmée au numéro FA-2026-00007 : une fin confirmée ne recule pas.'),
      (43, '43. le client « Ventes » ne confirme pas une fin (42501)', $q${FA} {REPRISE} {I:TROU}$q$, 'client',
        $q$select confirmer_fin_de_serie('{D}', 'facture', 'client', 2026, 5, 'Essai')::text$q$, '42501', 'Accès refusé à ce dossier.'),
      (44, '44. un membre de l''équipe ne lève pas un trou (42501)', $q${FA} {REPRISE} {I:TROU} {FIN:5}$q$, 'membre',
        $q$select lever_trous_de_numerotation('{D}', 'facture', 'client', 2026, 3, 4, 'Essai')::text$q$, '42501',
        'Seul le chef du cabinet confirme la fin d''une suite reprise ou lève les trous d''une série.'),
      (45, '45. un geste sans motif (22023)', $q${FA} {REPRISE} {I:TROU} {FIN:5}$q$, 'chef',
        $q$select lever_trous_de_numerotation('{D}', 'facture', 'client', 2026, 3, 4, '  ')::text$q$, '22023',
        'Le cabinet écrit ce qui fonde son geste : un motif de 1 000 caractères au plus.'),
      (46, '46. le premier numéro d''une série ouverte en cours d''année : rien ne manque avant lui', $q$select fixer_modele_numerotation('{D}', 'facture', 'client', 'FA-{AAAA}-{N:5}', true, 2026, 57); {REPRISE} {I:57} {FIN:58}$q$, 'client',
        $q$select {V:2026-07-20}$q$, 'OK', 'FA-2026-00059'),
      (47, '47. des trous nombreux : les cinq premiers nommés, le reste compté (22023)', $q${FA} {REPRISE} {I:EPARS} {FIN:13}$q$, 'client',
        $q$select {V:2026-07-20}$q$, '22023',
        'La série du modèle FA-{AAAA}-{N:5} (2026) a des trous : FA-2026-00002, FA-2026-00004, FA-2026-00006, FA-2026-00008, FA-2026-00010 — et un intervalle de plus, 6 numéros manquants en tout. Chaque numéro manquant s''importe, ou le cabinet le lève, motif écrit, avant que l''application continue la série.'),
      (48, '48. une série de l''application seule ne se juge pas : un trou restauré n''y retient rien', $q$insert into factures_emises (dossier_id, numero, statut, type, date_emission, tiers_nom, montant_ht, montant_tva, montant_ttc, validated_at) values ('{D2}', 'M2026-0001', 'validee', 'facture', '2026-07-01', 'ESSAI', 0, 0, 0, now()), ('{D2}', 'M2026-0003', 'validee', 'facture', '2026-07-02', 'ESSAI', 0, 0, 0, now())$q$, 'chef',
        $q$select (enregistrer_facture('{D2}', null, '{"tiers_nom":"Client N","type_client":"non_assujetti","montant_ht":80,"montant_tva":0,"montant_ttc":80,"date_emission":"2026-07-20"}'::jsonb, '[{"designation":"Séance","quantite":1,"prix_unitaire_ht":80,"taux_tva":0}]'::jsonb, true)).numero$q$,
        'OK', 'M2026-0004'),
      -- ── LA CHRONOLOGIE DE LA SÉRIE ──
      (49, '49. datée d''avant la plus récente reprise de sa série (22023)', $q${FA} {REPRISE} {I:TROU} {FIN:5} {LEVER:3:4}$q$, 'client',
        $q$select {V:2026-06-20}$q$, '22023',
        'La date d''émission, le 20/06/2026, précède celle de FA-2026-00005 (le 25/06/2026), la plus récente des factures reprises de la même série : les numéros suivent l''ordre des dates d''émission (CGI, ann. II, art. 242 nonies A, I, 7°). Une date du 25/06/2026 ou d''après se valide.'),
      (50, '50. datée de la même, elle se valide', $q${FA} {REPRISE} {I:TROU} {FIN:5} {LEVER:3:4}$q$, 'client',
        $q$select {V:2026-06-25}$q$, 'OK', 'FA-2026-00006'),
      (51, '51. datée d''avant la plus récente validée d''une série sans tiret, que la garde d''hier ne range pas (22023)', $q$select fixer_modele_numerotation('{D}', 'facture', 'client', 'FX{AAAA}{N:4}', true, 2026); {CLIENT} select {V:2026-09-10}$q$, 'client',
        $q$select {V:2026-09-05}$q$, '22023',
        'La date d''émission, le 05/09/2026, précède celle de FX20260001 (le 10/09/2026), la plus récente de la même série : les numéros suivent l''ordre des dates d''émission (CGI, ann. II, art. 242 nonies A, I, 7°). Une date du 10/09/2026 ou d''après se valide.'),
      (52, '52. … datée du même jour ou d''après, elle se valide', $q$select fixer_modele_numerotation('{D}', 'facture', 'client', 'FX{AAAA}{N:4}', true, 2026); {CLIENT} select {V:2026-09-10}$q$, 'client',
        $q$select {V:2026-09-10}$q$, 'OK', 'FX20260002'),
      -- ── LES REPRISES FACE AUX SÉRIES CONTINUÉES ──
      (53, '53. une reprise ne rejoint pas une série que l''application a continuée (22023)', $q${FA} {REPRISE} {CLIENT} select {V:2026-07-20}$q$, 'chef',
        $q$select importer_factures('{D}', '{"format":"csv"}'::jsonb, '{LOT:SEPT}'::jsonb)::text$q$, '22023',
        'La facture reprise FA-2026-00007 reprendrait la série que l''application a déjà continuée (la facture FA-2026-00001) : une facture reprise précède toujours celles de l''application.'),
      (54, '54. l''import d''une série continuée ne se retire plus (23514)', $q${FA} {REPRISE} {I:UN} {FIN:1} {CLIENT} select {V:2026-07-20}$q$, 'chef',
        $q$select retirer_import('{D}', (select l.id from imports_factures l where l.dossier_id = '{D}'))::text$q$, '23514',
        'L''application a continué la série de la facture reprise FA-2026-00001 (la facture FA-2026-00002) : son import ne se retire plus, il y creuserait un trou.'),
      (55, '55. … avant, il se retire', $q${FA} {REPRISE} {I:UN} {FIN:1}$q$, 'chef',
        $q$select retirer_import('{D}', (select l.id from imports_factures l where l.dossier_id = '{D}'))::text$q$, 'OK', '1'),
      -- ── LA GARDE D'HIER, QUE DEUX SÉRIES NE FONT PAS ÉCHOUER ──
      (56, '56. un numéro qui commencerait comme une facture validée sans nombre après son tiret : dit avant que la garde d''hier n''échoue (22023)', $q$select fixer_modele_numerotation('{D}', 'facture', 'client', 'X{N:1}', false, 2000); select fixer_modele_numerotation('{D}', 'facture', 'mandataire', 'X1-{N:4}', false, 2000); {CLIENT} select {V:2026-07-20}$q$, 'chef',
        $q$select {V:2026-07-21}$q$, '22023',
        'Le numéro X1-0001 commencerait comme la facture X1 sans qu''un nombre suive son premier tiret : la garde des factures ne saurait les ordonner. Le modèle de l''une des deux séries est à changer.'),
      -- ── L'ÉTAT QUE LA CARTE DU CABINET LIRA ──
      (57, '57. l''état d''un dossier sans modèle : les quatre séries d''hier et du cabinet, leur prochain numéro', null, 'chef',
        $q$select string_agg(x.nature || '/' || x.emetteur || '=' || x.modele || ':' || x.modele_par_defaut::text || ':' || coalesce(x.prochain_numero, '-'), ',' order by x.rang) from etat_de_la_numerotation('{D}', 2026) with ordinality as x(nature, emetteur, modele, annuel, depuis, modele_par_defaut, premier, emis, importes, valides, fin, trous, refus, prochain_numero, rang)$q$, 'OK',
        'facture/client=F{AAAA}-{N:4}:true:F2026-0001,avoir/client=A{AAAA}-{N:4}:true:A2026-0001,facture/mandataire=M{AAAA}-{N:4}:true:M2026-0001,avoir/mandataire=MA{AAAA}-{N:4}:true:MA2026-0001'),
      (58, '58. l''état d''une suite reprise : ce qui est repris, la fin, les trous, aucun prochain numéro', $q${FA} {REPRISE} {I:TROU} {FIN:6}$q$, 'chef',
        $q$select x.importes || '|' || x.valides || '|' || x.fin || '|' || x.trous::text || '|' || coalesce(x.prochain_numero, '-') || '|' || (x.refus like 'La série du modèle FA-{AAAA}-{N:5} (2026) a des trous : FA-2026-00003 à FA-2026-00004, FA-2026-00006.%')::text from etat_de_la_numerotation('{D}', 2026) x where x.nature = 'facture' and x.emetteur = 'client'$q$, 'OK',
        '3|0|6|[[3, 4], [6, 6]]|-|true'),
      (59, '59. le client ne lit pas l''état (42501)', null, 'client',
        $q$select count(*)::text from etat_de_la_numerotation('{D}', 2026)$q$, '42501', 'Accès refusé à ce dossier.'),
      -- ── LA GARDE DES DEUX TABLES ──
      (60, '60. un chef qui n''est pas super-administrateur n''écrit pas un modèle en direct (42501)', null, 'chef_simple',
        $q$insert into modeles_numerotation (dossier_id, nature, emetteur, modele, annuel, depuis) values ('{D2}', 'facture', 'client', 'FA-{AAAA}-{N:5}', true, 2026) returning 1$q$, '42501',
        'Un modèle de numéro ne se pose que par sa fonction, qui le juge.'),
      (61, '61. le super-administrateur non plus, une fois le dossier numéroté (42501)', $q${CLIENT} select {V:2026-07-20}$q$, 'chef',
        $q$insert into modeles_numerotation (dossier_id, nature, emetteur, modele, annuel, depuis) values ('{D}', 'facture', 'client', 'FA-{AAAA}-{N:5}', true, 2026) returning 1$q$, '42501',
        'Un modèle de numéro ne se pose que par sa fonction, qui le juge.'),
      (62, '62. la restauration réinsère un modèle et un geste dans un dossier sans compteur, au super-administrateur', null, 'chef',
        $q$with m as (insert into modeles_numerotation (dossier_id, nature, emetteur, modele, annuel, depuis) values ('{D2}', 'facture', 'client', 'FA-{AAAA}-{N:5}', true, 2026) returning 1),
                c as (insert into continuite_des_series (dossier_id, modele, annuel, annee, geste, premier, dernier, motif) values ('{D2}', 'FA-{AAAA}-{N:5}', true, 2026, 'fin', 5, 5, 'Essai') returning 1)
           select (select count(*) from m) || ' ' || (select count(*) from c)$q$, 'OK', '1 1'),
      (63, '63. un modèle ne se réécrit pas, même par le rôle des Edge Functions (23514)', $q$select fixer_modele_numerotation('{D}', 'facture', 'client', 'FA-{AAAA}-{N:5}', true, 2026)$q$, 'service',
        $q$update modeles_numerotation set depuis = 2025 where dossier_id = '{D}' returning 1$q$, '23514',
        'Un modèle de numéro ne se modifie pas : un nouveau geste du cabinet le remplace ou le complète.'),
      (64, '64. un geste sur la suite reprise ne se réécrit pas (23514)', $q${FA} {REPRISE} {I:TROU} {FIN:5}$q$, 'service',
        $q$update continuite_des_series set dernier = 9, premier = 9 where dossier_id = '{D}' returning 1$q$, '23514',
        'Une fin de suite confirmée ou une levée de trous ne se modifie pas : un nouveau geste du cabinet le remplace ou le complète.'),
      -- ── LA VALIDATION NE PREND PAS UN NUMÉRO D'UNE AUTRE SÉRIE ──
      (65, '65. une validation forcée sous le réglage, d''un numéro hors de sa série (23514)', $q$select enregistrer_facture('{D}', null, '{"tiers_nom":"Client N","type_client":"non_assujetti","nature_operation":"services","montant_ht":80,"montant_tva":0,"montant_ttc":80,"date_emission":"2026-07-20"}'::jsonb, '[{"designation":"Séance","quantite":1,"prix_unitaire_ht":80,"taux_tva":0}]'::jsonb, false)$q$, 'chef',
        $q$select set_config('jd.validation_facture', (select f.id::text from factures_emises f where f.dossier_id = '{D}' and f.statut = 'brouillon'), true); update factures_emises set statut = 'validee', numero = 'Z2026-0001', validated_at = now() where dossier_id = '{D}' and statut = 'brouillon' returning 1$q$, '23514',
        'Le numéro Z2026-0001 n''est pas de la série où cette facture se valide, celle du modèle F{AAAA}-{N:4} (2026) : une facture ne se valide que par enregistrer_facture, qui le prend dans la série de qui valide.')
    ) as t(rang, etape, pose, profil, requete, code, attendu) loop
      v_code := 'OK'; v_msg := null; v_obs := null;
      begin
        if e.profil = 'chef_simple' then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client::uuid, cabinet, 'comptable_en_chef');
        elsif e.profil = 'membre' then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client::uuid, cabinet, 'comptable');
          insert into dossier_assignations (dossier_id, user_id) values (d::uuid, client::uuid);
        end if;
        if e.pose is not null then
          v_pose := e.pose;
          execute 'set local role authenticated';
          perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
          v_pose := replace(replace(replace(replace(replace(replace(v_pose,
            '{FA}', $q$select fixer_modele_numerotation('{D}', 'facture', 'client', 'FA-{AAAA}-{N:5}', true, 2026);$q$),
            '{REPRISE}', $q$select fixer_reprise_des_factures('{D}', '2026-07-01');$q$),
            '{CLIENT}', format($q$select set_config('request.jwt.claims', '{"sub":"%s","role":"authenticated"}', true);$q$, client)),
            '{CHEF}', format($q$select set_config('request.jwt.claims', '{"sub":"%s","role":"authenticated"}', true);$q$, chef)),
            '{I:TROU}', $q$select importer_factures('{D}', '{"format":"csv"}'::jsonb, '{LOT:TROU}'::jsonb);$q$),
            '{I:UN}', $q$select importer_factures('{D}', '{"format":"csv"}'::jsonb, '{LOT:UN}'::jsonb);$q$);
          v_pose := replace(replace(v_pose,
            '{I:57}', $q$select importer_factures('{D}', '{"format":"csv"}'::jsonb, '{LOT:57}'::jsonb);$q$),
            '{I:EPARS}', $q$select importer_factures('{D}', '{"format":"csv"}'::jsonb, '{LOT:EPARS}'::jsonb);$q$);
          v_pose := regexp_replace(v_pose, '\{FIN:([0-9]+)\}',
            $q$select confirmer_fin_de_serie('{D}', 'facture', 'client', 2026, \1, 'Dernier numéro émis par l''ancien logiciel');$q$, 'g');
          v_pose := regexp_replace(v_pose, '\{LEVER:([0-9]+):([0-9]+)\}',
            $q$select lever_trous_de_numerotation('{D}', 'facture', 'client', 2026, \1, \2, 'Numéros annulés dans l''ancien logiciel');$q$, 'g');
          v_pose := regexp_replace(v_pose, '\{V:([0-9-]{10})\}', '(' || facture || 'true)).numero', 'g');
          v_pose := replace(replace(replace(replace(replace(replace(replace(v_pose,
            '{LOT:TROU}', '[' || lot_trou || ']'), '{LOT:UN}', '[' || lot_un || ']'), '{LOT:57}', '[' || lot_57 || ']'),
            '{LOT:EPARS}', '[' || lot_epars || ']'), '{D}', d), '{D2}', d2), '{CHEF_ID}', chef);
          execute v_pose;
          reset role;
          perform set_config('request.jwt.claims', '', true);
        end if;
        v_req := regexp_replace(e.requete, '\{AV:([^:]+):([0-9-]{10})\}', avoir, 'g');
        v_req := regexp_replace(v_req, '\{V:([0-9-]{10})\}', '(' || facture || 'true)).numero', 'g');
        v_req := replace(replace(replace(replace(v_req, '{LOT:SEPT}', '[' || lot_sept || ']'), '{D}', d), '{D2}', d2), '{CHEF_ID}', chef);
        begin
          if e.profil = 'anon' then
            execute 'set local role anon';
            perform set_config('request.jwt.claims', '{"role":"anon"}', true);
          elsif e.profil = 'service' then
            execute 'set local role service_role';
            perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
          elsif e.profil <> 'postgres' then
            execute 'set local role authenticated';
            perform set_config('request.jwt.claims',
              json_build_object('sub', case e.profil when 'chef' then chef when 'inconnu' then inconnu else client end, 'role', 'authenticated')::text, true);
          end if;
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
        'ok', v_code = e.code and case when strpos(e.attendu, '%') > 0 then v_msg like e.attendu else v_msg = e.attendu end,
        'observe', v_code || ' ' || coalesce(v_msg, '-'));
    end loop;

    -- Le catalogue : la RLS active sur les deux tables, deux policies chacune (la lecture du cabinet, la restauration),
    -- toutes à authenticated, aucune qui modifie ou supprime, aucune au client ; les gardes avant chaque écriture, celle de
    -- la numérotation après la marque d'acompte ; les fonctions aux droits du propriétaire, search_path fixé — les gestes
    -- et la lecture du cabinet exécutés par authenticated, les fonctions internes par personne — ; les deux contraintes.
    verdicts := verdicts || jsonb_build_object('rang', 66, 'etape', '66. le catalogue : RLS, policies à authenticated, les gardes et leur ordre, les fonctions et leurs droits, les contraintes',
      'ok', (select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('public.modeles_numerotation'::regclass, 'public.continuite_des_series'::regclass))
        and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename in ('modeles_numerotation', 'continuite_des_series')
               and p.permissive = 'PERMISSIVE') = 4
        and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename in ('modeles_numerotation', 'continuite_des_series')
               and p.permissive = 'PERMISSIVE' and p.roles = array['authenticated']::name[]
               and ((p.policyname like '%\_lecture' and p.cmd = 'SELECT' and p.qual = 'admin_du_dossier(dossier_id)')
                 or (p.policyname like '%\_restauration' and p.cmd = 'INSERT' and p.with_check = 'is_super_admin()'))) = 4
        and (select string_agg(t.tgname, ',' order by t.tgname collate "C") from pg_trigger t
              where t.tgrelid = 'public.factures_emises'::regclass and not t.tgisinternal and (t.tgtype & 2) = 2)
            = 'factures_emises_figees,factures_emises_figees_mentions,factures_emises_figees_reprises,factures_emises_marque_d_acompte,factures_emises_numerotation,factures_emises_source_de_la_vente'
        and (select count(*) from pg_trigger t where not t.tgisinternal and t.tgtype = 31
               and t.tgname in ('modeles_numerotation_garde', 'continuite_des_series_garde', 'factures_emises_numerotation')) = 3
        and (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
               and p.oid in ('public.fixer_modele_numerotation(uuid, text, text, text, boolean, integer, integer)'::regprocedure,
                             'public.confirmer_fin_de_serie(uuid, text, text, integer, integer, text)'::regprocedure,
                             'public.lever_trous_de_numerotation(uuid, text, text, integer, integer, integer, text)'::regprocedure,
                             'public.etat_de_la_numerotation(uuid, integer)'::regprocedure)
               and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
               and not has_function_privilege('anon', p.oid, 'execute')
               and has_function_privilege('authenticated', p.oid, 'execute')) = 4
        and (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
               and p.oid in ('public.numerotation_suivante(uuid, integer, text)'::regprocedure,
                             'public.jugement_de_la_serie(uuid, text, boolean, integer, integer, integer)'::regprocedure,
                             'public.modele_en_vigueur(uuid, text, text, integer)'::regprocedure,
                             'public.serie_d_un_numero(uuid, text, integer)'::regprocedure,
                             'public.attribuer_numero_facture(uuid, integer, text)'::regprocedure,
                             'public.prochain_numero_facture(uuid, integer, text)'::regprocedure,
                             'public.garder_la_numerotation()'::regprocedure,
                             'public.garder_tables_de_numerotation()'::regprocedure)
               and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
               and not has_function_privilege('authenticated', p.oid, 'execute')
               and not has_function_privilege('anon', p.oid, 'execute')
               and not has_function_privilege('service_role', p.oid, 'execute')) = 8
        and (select pg_get_constraintdef(c.oid) from pg_constraint c
              where c.conrelid = 'public.factures_emises'::regclass and c.conname = 'factures_emises_numero_de_sa_serie')
            = 'CHECK (((char_length(numero) <= 35) AND (numero ~ ''^[-+_/A-Za-z0-9]( ?[-+_/A-Za-z0-9])*$''::text)))'
        and (select count(*) from pg_constraint c
              where c.conrelid = 'public.modeles_numerotation'::regclass and c.conname = 'modeles_numerotation_modele_recu') = 1,
      'observe', 'relu au catalogue');
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  -- Rien n'est resté : ni les dossiers jetables, ni leur accès, ni leurs factures, ni leurs modèles, ni le compte d'essai
  -- dans le cabinet.
  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni leur accès, ni leurs factures, ni leurs modèles, ni leurs gestes, ni le compte d''essai dans le cabinet',
    'ok', not exists (select 1 from dossiers where id in (d::uuid, d2::uuid))
      and not exists (select 1 from memberships where id = acces::uuid)
      and not exists (select 1 from factures_emises where dossier_id in (d::uuid, d2::uuid))
      and not exists (select 1 from modeles_numerotation where dossier_id in (d::uuid, d2::uuid))
      and not exists (select 1 from continuite_des_series where dossier_id in (d::uuid, d2::uuid))
      and not exists (select 1 from facture_numerotation where dossier_id in (d::uuid, d2::uuid))
      and not exists (select 1 from cabinet_admins where user_id::text = client),
    'observe', 'relu');
  perform set_config('essai.numerotation_continue', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.numerotation_continue')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
