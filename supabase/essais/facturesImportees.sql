-- LES FACTURES REPRISES DE L'ANCIEN LOGICIEL D'UN CLIENT (ligne 51.5, étape A8a ; la migration `factures_importees`,
-- PRÉPARÉE le 07/11/2026, supabase/preparees/). Le récit : HISTORIQUE.md, « 07/11/2026 — A8A : LES FACTURES REPRISES, EN
-- BASE (PRÉPARÉE, PAS APPLIQUÉE) ». À rejouer par `execute_sql` après toute migration qui touche `factures_emises`, ses
-- contraintes, sa garde, ses lignes, `fixer_source_de_la_vente`, `prochain_numero_facture`, `enregistrer_facture`,
-- `imports_factures`, `factures_importees`, la date de reprise d'un dossier ou leurs fonctions. La suppression directe
-- d'une facture reprise ne se joue pas ici (l'outil d'exécution de la production retient une suppression) : la garde la
-- refuse, ce que la réplique de l'étape a éprouvé ; le retrait d'un import, lui, passe par sa fonction, et se joue ici.
--
-- Ce qui se prouve ici, et ne se relit pas : le chef pose la date de reprise, sous ses refus (le premier d'un mois, au plus
-- tard le jour de la bascule, un dossier basculé, le chef seul, figée dès le premier import) ; l'import, tout ou rien,
-- par le cabinet seul — ni un accès « Ventes » (l'ouvrir se présente avec l'écran, A8d), ni un accès sans la case, ni un
-- compte sans accès, ni l'anonyme ; ses
-- refus sous leurs mots (l'engagement, la bascule, la date de reprise, le numéro, sa forme, sa série, les montants et leur
-- écart chiffré, l'encaissé, l'avoir, les clés inconnues, le fichier) ; ce qu'il écrit (l'état, la marque de source,
-- l'option, l'encaissé par taux et son repli au prorata, l'avoir et sa facture) ; la garde (une importée ne naît que par
-- l'import ou la restauration, ne se modifie pas, ses lignes non plus, aucune facture ne le devient) ; la validation d'une
-- facture de l'application refusée avant la plus récente reprise de sa série (validée par le client « Ventes », dont la
-- série la continue ; avec la numérotation qui continue, A9a, la suite reprise confirmée et ses trous levés d'abord) ; le
-- retrait d'un import et ses refus ; ce
-- que lit chaque profil ; le catalogue.
--
-- Quatre dossiers jetables du cabinet du dossier `test` (préfixe `a8a00000-0000-4000-8000`) : DV, basculé, en trésorerie,
-- où l'accès du client d'essai porte « Ventes » ; DS, basculé, où il ne la porte pas ; DE, basculé, en engagement ; DN, ni
-- basculé. Chaque étape se joue dans sa sous-transaction et s'y ANNULE (`ANNULATION_ETAPE`) : ce que le chef pose
-- d'abord, puis la requête du profil ; le jeu s'annule à la fin (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le
-- relit. Les verdicts voyagent dans un réglage LOCAL à la transaction (`essai.factures_importees`), que la requête finale
-- lit : le fichier se joue d'un seul appel, ne crée ni table ni fonction, ne contient aucune instruction de suppression,
-- et ne rend rien qui dépende d'une ligne hors de ses dossiers. Hors de l'outil d'exécution, il se joue en UNE
-- transaction (`psql -1`). Sans la migration, une ligne dit qu'il attend (EN ATTENTE) et rien ne s'écrit.
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  dv constant text := 'a8a00000-0000-4000-8000-0000000000d1';
  ds constant text := 'a8a00000-0000-4000-8000-0000000000d2';
  de constant text := 'a8a00000-0000-4000-8000-0000000000d3';
  dn constant text := 'a8a00000-0000-4000-8000-0000000000d4';
  acces_v constant text := 'a8a00000-0000-4000-8000-0000000000a1';
  acces_s constant text := 'a8a00000-0000-4000-8000-0000000000a2';
  -- Un compte connecté qu'aucun accès ni aucun cabinet ne nomme (le profil `inconnu`).
  inconnu constant text := 'a8a00000-0000-4000-8000-0000000000f1';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  -- La date de reprise : le premier jour du mois de Paris, celui de la bascule des dossiers jetables (posée à leur
  -- insertion, maintenant).
  reprise constant date := date_trunc('month', now() at time zone 'Europe/Paris')::date;
  -- Le lot type : une facture de la forme de l'application (2025), une facture d'un autre logiciel à deux taux et deux
  -- natures, l'encaissé donné en total (le repli au prorata), et un avoir repris qui la crédite.
  lot constant text := '[
    {"numero": "F2025-0007", "type": "facture", "date_emission": "2025-10-15", "tiers_nom": "Client A", "type_client": "assujetti",
     "tiers_siren": "123456789", "nature_operation": "services", "option_debits": false,
     "montant_ht": 1000, "montant_tva": 200, "montant_ttc": 1200,
     "lignes": [{"designation": "Prestation mensuelle", "quantite": 1, "prix_unitaire_ht": 1000, "taux_tva": 20}],
     "encaisse_avant_reprise": 300, "transmise_par": "pdf", "ligne_csv": 2},
    {"numero": "FAC-2025-118", "type": "facture", "date_emission": "2025-11-03", "tiers_nom": "Client B", "type_client": "non_assujetti",
     "nature_operation": "mixte", "option_debits": false,
     "montant_ht": 300, "montant_tva": 40, "montant_ttc": 340,
     "lignes": [{"designation": "Fournitures", "quantite": 2, "prix_unitaire_ht": 50, "taux_tva": 20, "nature": "biens"},
                {"designation": "Séance", "quantite": 1, "prix_unitaire_ht": 200, "taux_tva": 10, "nature": "services"}],
     "encaisse_avant_reprise": 170, "transmise_par": "plateforme", "plateforme_nom": "Plateforme essai", "ligne_csv": 3},
    {"numero": "AV 2025/3", "type": "avoir", "origine_numero": "FAC-2025-118", "date_emission": "2025-11-20", "tiers_nom": "Client B",
     "type_client": "non_assujetti", "nature_operation": "services", "option_debits": false,
     "montant_ht": -100, "montant_tva": -10, "montant_ttc": -110,
     "lignes": [{"designation": "Geste commercial", "quantite": -1, "prix_unitaire_ht": 100, "taux_tva": 10}],
     "transmise_par": "papier"}]';
  -- Une facture seule, de la forme de l'application dans la série de l'année de la reprise, datée d'avant elle.
  seule constant text := '[{"numero": "F{AN}-0042", "type": "facture", "date_emission": "{AVANT}", "tiers_nom": "Client C",
     "type_client": "non_assujetti", "nature_operation": "services", "option_debits": false,
     "montant_ht": 50, "montant_tva": 0, "montant_ttc": 50,
     "lignes": [{"designation": "Séance", "quantite": 1, "prix_unitaire_ht": 50, "taux_tva": 0}], "transmise_par": "inconnu"}]';
  poser constant text := $q$select fixer_reprise_des_factures('{DV}', '{R}')$q$;
  importer constant text := $q$importer_factures('{DV}', '{"format": "csv"}'::jsonb, '{L}'::jsonb)$q$;
  -- Une facture de l'application (enregistrer_facture), à une date donnée : validée par le client « Ventes », dont la
  -- série la continue — le cabinet valide dans celle de son mandataire depuis la numérotation qui continue (A9a,
  -- préparée) —, d'où l'identité, le statut et la mention de DV, ce que la validation d'un accès « Ventes » exige.
  valider constant text := $q$enregistrer_facture('{DV}', null, '{"tiers_nom": "Client D", "type_client": "non_assujetti", "nature_operation": "services", "date_emission": "{DATE}", "mentions_legales": "TVA non applicable, art. 293 B du CGI.", "emetteur_nom": "ESSAI FACTURES REPRISES SOCIÉTÉ DV", "emetteur_siret": "12345678200010", "emetteur_adresse": "ESSAI FACTURES REPRISES ADRESSE DV"}'::jsonb, '[{"designation": "Séance", "quantite": 1, "prix_unitaire_ht": 80, "taux_tva": 0}]'::jsonb, true)$q$;
  -- Datée d'avant la facture reprise de la série (dix jours avant la reprise), et d'après (cinq jours avant) : le même mois.
  valider_avant constant text := replace(valider, '{DATE}', (reprise - 20)::text);
  valider_apres constant text := replace(valider, '{DATE}', (reprise - 5)::text);
  -- La session du client, dans ce que le chef pose (`{CLIENT}`).
  au_client constant text := format($q$select set_config('request.jwt.claims', '{"sub": "%s", "role": "authenticated"}', true);$q$, client);
  -- Avec la numérotation qui continue (A9a, préparée), une série qui porte une facture reprise ne continue qu'une fois sa
  -- suite reprise confirmée — le dernier numéro de l'ancien logiciel, F…-0042 — et ses trous levés (`{SUITE}`) ; sans
  -- elle, rien.
  suite constant text := case when to_regprocedure('public.confirmer_fin_de_serie(uuid, text, text, integer, integer, text)') is null then ''
    else format($q$select confirmer_fin_de_serie('{DV}', 'facture', 'client', %1$s, 42, 'Dernier numéro de l''ancien logiciel'); select lever_trous_de_numerotation('{DV}', 'facture', 'client', %1$s, 1, 41, 'Numéros de l''ancien logiciel, non repris');$q$,
                extract(year from reprise - 10)::integer) end;
  e record; v_code text; v_msg text; v_req text; v_pose text; v_obs text; v_attendu text;
  verdicts jsonb := '[]'::jsonb;
begin
  if to_regclass('public.factures_importees') is null then
    perform set_config('essai.factures_importees', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration factures_importees', 'ok', true,
      'observe', 'absente : l''essai se joue dès que la migration y est'))::text, true);
    return;
  end if;
  begin
    -- Le jeu : quatre dossiers jetables, et un accès du client d'essai à DV (« Ventes ») et à DS (sans), insérés par le
    -- propriétaire comme `create-client-access` les insère.
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, ventes_par_les_factures, statut_tva, siret, adresse,
                          forme_juridique, denomination_imprimee) values
      (dv::uuid, 'ESSAI FACTURES REPRISES DV', cabinet, 'tresorerie', '455000', true, 'franchise', '12345678200010',
       'ESSAI FACTURES REPRISES ADRESSE DV', '5710', 'ESSAI FACTURES REPRISES SOCIÉTÉ DV'),
      (ds::uuid, 'ESSAI FACTURES REPRISES DS', cabinet, 'tresorerie', '455000', true, null, null, null, null, null),
      (de::uuid, 'ESSAI FACTURES REPRISES DE', cabinet, 'engagement', '455000', true, null, null, null, null, null),
      (dn::uuid, 'ESSAI FACTURES REPRISES DN', cabinet, 'tresorerie', '455000', false, null, null, null, null, null);
    insert into memberships (id, user_id, dossier_id, role, email, droit_ventes) values
      (acces_v::uuid, client::uuid, dv::uuid, 'client', 'essai-reprises-v@example.test', true),
      (acces_s::uuid, client::uuid, ds::uuid, 'client', 'essai-reprises-s@example.test', false);

    -- Une étape : {rang, étape, ce que le CHEF pose d'abord (super-administrateur, sous sa session), le profil — `chef`,
    -- `chef_simple` (le compte client rattaché au cabinet, le temps de l'étape), `client`, `inconnu`, `service` ou `anon` —,
    -- sa requête, le code attendu (`OK` : acceptée) et ce qu'elle rend, ou les mots du refus}.
    for e in select * from (values
      -- La date de reprise.
      (1, '1. le chef pose la date de reprise, le premier du mois de la bascule ; le dossier la porte', $q$select fixer_reprise_des_factures('{DV}', '{R}')$q$, 'chef',
        $q$select d.reprise_des_factures_le::text from dossiers d where d.id = '{DV}'$q$,
        'OK', reprise::text),
      (2, '2. un chef qui n''est pas super-administrateur la pose aussi', null, 'chef_simple',
        $q$select fixer_reprise_des_factures('{DV}', '{R}')::text$q$, 'OK', reprise::text),
      (3, '3. le client « Ventes » ne la pose pas (42501)', null, 'client',
        $q$select fixer_reprise_des_factures('{DV}', '{R}')::text$q$, '42501', 'Accès refusé à ce dossier.'),
      (4, '4. un jour qui n''est pas le premier d''un mois (22023)', null, 'chef',
        $q$select fixer_reprise_des_factures('{DV}', ('{R}'::date + 1))::text$q$, '22023',
        'La date de reprise des factures est le premier jour d''un mois : les factures d''avant ce jour se reprennent, l''application émet celles d''après.'),
      (5, '5. le mois qui suit la bascule (22023)', null, 'chef',
        $q$select fixer_reprise_des_factures('{DV}', ('{R}'::date + interval '1 month')::date)::text$q$, '22023',
        format('La date de reprise, le %s, suit le jour de la bascule (le %s) : elle est au plus tard le premier jour du mois de la bascule.',
          to_char((reprise + interval '1 month')::date, 'DD/MM/YYYY'), to_char((now() at time zone 'Europe/Paris')::date, 'DD/MM/YYYY'))),
      (6, '6. un dossier qui n''est pas basculé (22023)', null, 'chef',
        $q$select fixer_reprise_des_factures('{DN}', '{R}')::text$q$, '22023',
        'La date de reprise des factures suppose un dossier dont les factures sont la source de leurs ventes : la bascule d''abord.'),
      (7, '7. figée dès le premier import (23514)', $q$select fixer_reprise_des_factures('{DV}', '{R}'); select {I}$q$, 'chef',
        $q$select fixer_reprise_des_factures('{DV}', ('{R}'::date - interval '1 month')::date)::text$q$, '23514',
        format('La date de reprise est figée depuis le premier import de factures (le %s) : elle ne change qu''une fois tous les imports retirés.',
          to_char((now() at time zone 'Europe/Paris')::date, 'DD/MM/YYYY'))),
      (8, '8. le chef ne l''écrit pas en direct (la garde, 42501)', null, 'chef',
        $q$update dossiers set reprise_des_factures_le = '{R}' where id = '{DV}' returning 1$q$, '42501',
        'La date de reprise des factures ne se pose que par fixer_reprise_des_factures, le chef du cabinet seul.'),
      -- L'import, et ce qu'il écrit.
      (9, '9. le chef importe le lot : trois factures reprises, sources de leur vente, leur option posée', $q$select fixer_reprise_des_factures('{DV}', '{R}'); select {I}$q$, 'chef',
        $q$select string_agg(f.numero || ':' || f.statut || ':' || f.type || ':' || f.source_de_la_vente || ':' || f.option_debits || ':' || f.montant_ttc, ',' order by f.numero collate "C") from factures_emises f where f.dossier_id = '{DV}'$q$,
        'OK', 'AV 2025/3:importee:avoir:true:false:-110,F2025-0007:importee:facture:true:false:1200,FAC-2025-118:importee:facture:true:false:340'),
      (10, '10. l''encaissé avant la reprise par taux : donné en total, réparti au prorata des TTC et dit ; l''avoir cite sa facture', $q$select fixer_reprise_des_factures('{DV}', '{R}'); select {I}$q$, 'chef',
        $q$select string_agg(f.numero || '=' || fi.encaisse_avant_reprise || ' ' || fi.encaisse_par_taux::text || ' ' || fi.encaisse_au_prorata || ' ' || fi.transmise_par || ' ' || coalesce(fi.plateforme_nom, '-') || ' ' || coalesce(o.numero, '-') || ' ' || fi.rang, ' | ' order by f.numero collate "C") from factures_importees fi join factures_emises f on f.id = fi.facture_id left join factures_emises o on o.id = fi.origine_id where fi.dossier_id = '{DV}'$q$,
        'OK', 'AV 2025/3=0 [{"taux": 10, "encaisse": 0}] false papier - FAC-2025-118 3 | F2025-0007=300 [{"taux": 20, "encaisse": 300}] false pdf - - 1 | FAC-2025-118=170 [{"taux": 10, "encaisse": 110.00}, {"taux": 20, "encaisse": 60.00}] true plateforme Plateforme essai - 2'),
      (11, '11. le lot : son format, ses trois factures, son auteur ; les lignes reprises', $q$select fixer_reprise_des_factures('{DV}', '{R}'); select {I}$q$, 'chef',
        $q$select l.format || ' ' || l.nombre_factures || ' ' || (l.importe_par::text = '{CHEF}') || ' ' || (select count(*) from facture_lignes fl join factures_emises f on f.id = fl.facture_id where f.dossier_id = '{DV}') from imports_factures l where l.dossier_id = '{DV}'$q$,
        'OK', 'csv 3 true 4'),
      (12, '12. le client « Ventes » n''importe pas en A8a (42501) : l''ouvrir se présente avec l''écran', $q$select fixer_reprise_des_factures('{DV}', '{R}')$q$, 'client',
        $q$select ({I} is not null)::text$q$, '42501', 'Accès refusé à ce dossier.'),
      (13, '13. le client « Ventes » ne lit ni le lot ni ses factures reprises, ne retire rien', $q$select fixer_reprise_des_factures('{DV}', '{R}'); select {I}$q$, 'client',
        $q$select (select count(*) from imports_factures l where l.dossier_id = '{DV}') || ' ' || (select count(*) from factures_importees fi where fi.dossier_id = '{DV}') || ' ' || coalesce((select 'lu' from imports_factures l where l.dossier_id = '{DV}' limit 1), 'rien')$q$, 'OK', '0 0 rien'),
      (14, '14. le client sans la case n''importe pas (42501)', null, 'client',
        $q$select importer_factures('{DS}', '{"format": "csv"}'::jsonb, '{L}'::jsonb)::text$q$, '42501', 'Accès refusé à ce dossier.'),
      (15, '15. un compte connecté sans accès n''importe pas, ne lit rien (42501)', null, 'inconnu',
        $q$select importer_factures('{DV}', '{"format": "csv"}'::jsonb, '{L}'::jsonb)::text$q$, '42501', 'Accès refusé à ce dossier.'),
      (16, '16. l''anonyme ne lit rien et n''exécute pas l''import', $q$select fixer_reprise_des_factures('{DV}', '{R}'); select {I}$q$, 'anon',
        $q$select (select count(*) from imports_factures) || ' ' || (select count(*) from factures_importees) || ' ' || has_function_privilege('anon', 'public.importer_factures(uuid, jsonb, jsonb)', 'execute')$q$, 'OK', '0 0 false'),
      -- Les refus de l'import.
      (17, '17. un dossier tenu en engagement (A8-Q3, 22023)', null, 'chef',
        $q$select importer_factures('{DE}', '{"format": "csv"}'::jsonb, '{L}'::jsonb)::text$q$, '22023',
        'Les factures d''un ancien logiciel ne se reprennent pas encore dans un dossier tenu en comptabilité d''engagement : la créance d''une facture d''avant est au compte client de la reprise, que l''application n''écrit pas encore.'),
      (18, '18. un dossier qui n''est pas basculé (22023)', null, 'chef',
        $q$select importer_factures('{DN}', '{"format": "csv"}'::jsonb, '{L}'::jsonb)::text$q$, '22023',
        'Les factures d''un ancien logiciel se reprennent dans un dossier dont les factures sont la source de leurs ventes : la bascule d''abord.'),
      (19, '19. sans date de reprise (22023)', null, 'chef',
        $q$select {I}::text$q$, '22023',
        'La date de reprise des factures n''est pas posée : le chef du cabinet la pose d''abord (le premier jour d''un mois, au plus tard celui de la bascule).'),
      (20, '20. une facture datée de la reprise (22023)', $q$select fixer_reprise_des_factures('{DV}', '{R}')$q$, 'chef',
        $q$select importer_factures('{DV}', '{"format": "csv"}'::jsonb, jsonb_set('{L}'::jsonb, '{0,date_emission}', to_jsonb('{R}'::text)))::text$q$, '22023',
        format('La facture F2025-0007 (rang 1 du lot) est datée du %s, la date de reprise ou après (le %s) : l''application émet les factures d''après, une facture reprise se date d''avant.',
          to_char(reprise, 'DD/MM/YYYY'), to_char(reprise, 'DD/MM/YYYY'))),
      (21, '21. un numéro déjà au dossier : le même lot deux fois (22023)', $q$select fixer_reprise_des_factures('{DV}', '{R}'); select {I}$q$, 'chef',
        $q$select {I}::text$q$, '22023', 'Rang 1 du lot : le numéro F2025-0007 est déjà celui d''une facture de ce dossier — un numéro ne se réemploie jamais.'),
      (22, '22. un numéro hors de G1.05 : un espace doublé (22023)', $q$select fixer_reprise_des_factures('{DV}', '{R}')$q$, 'chef',
        $q$select importer_factures('{DV}', '{"format": "csv"}'::jsonb, jsonb_set('{L}'::jsonb, '{1,numero}', '"FAC  118"'))::text$q$, '22023',
        'Rang 2 du lot : le numéro se compose de 35 caractères au plus — lettres, chiffres, espace, « - + _ / » —, sans espace en tête, en fin ni doublé (DGFiP, annexe 7, G1.05).'),
      (23, '23. un numéro de la forme de l''application d''une autre année que sa date (22023)', $q$select fixer_reprise_des_factures('{DV}', '{R}')$q$, 'chef',
        $q$select importer_factures('{DV}', '{"format": "csv"}'::jsonb, jsonb_set('{L}'::jsonb, '{0,numero}', '"F2024-0007"'))::text$q$, '22023',
        'La facture F2024-0007 (rang 1 du lot) porte un numéro de la forme de l''application : sa lettre est celle de son type (F, A pour un avoir), son année celle de sa date, son compteur de neuf chiffres au plus.'),
      (24, '24. une clé inconnue se refuse plutôt que se perdre (22023)', $q$select fixer_reprise_des_factures('{DV}', '{R}')$q$, 'chef',
        $q$select importer_factures('{DV}', '{"format": "csv"}'::jsonb, jsonb_set('{L}'::jsonb, '{0,montant_tcc}', '1200'))::text$q$, '22023',
        'Rang 1 du lot : la facture porte des clés que l''import ne connaît pas : montant_tcc.'),
      (25, '25. une TVA qui n''est pas celle de ses lignes : l''écart chiffré (22023)', $q$select fixer_reprise_des_factures('{DV}', '{R}')$q$, 'chef',
        $q$select importer_factures('{DV}', '{"format": "csv"}'::jsonb, jsonb_set(jsonb_set('{L}'::jsonb, '{0,montant_tva}', '201'), '{0,montant_ttc}', '1201'))::text$q$, '22023',
        'La facture F2025-0007 (rang 1 du lot) déclare 201,00 € de TVA ; ses lignes en font 200,00 € par taux (EN 16931, BR-CO-17), 200,00 € ligne à ligne.'),
      (26, '26. un hors taxe qui n''est pas celui de ses lignes (22023)', $q$select fixer_reprise_des_factures('{DV}', '{R}')$q$, 'chef',
        $q$select importer_factures('{DV}', '{"format": "csv"}'::jsonb, jsonb_set(jsonb_set('{L}'::jsonb, '{0,montant_ht}', '999'), '{0,montant_ttc}', '1199'))::text$q$, '22023',
        'La facture F2025-0007 (rang 1 du lot) déclare 999,00 € hors taxe ; ses lignes en font 1000,00 € (un écart de -1,00 €).'),
      (27, '27. un encaissé au-delà du TTC (22023)', $q$select fixer_reprise_des_factures('{DV}', '{R}')$q$, 'chef',
        $q$select importer_factures('{DV}', '{"format": "csv"}'::jsonb, jsonb_set('{L}'::jsonb, '{0,encaisse_avant_reprise}', '1200.01'))::text$q$, '22023',
        'La facture F2025-0007 (rang 1 du lot) : ce qui en était encaissé avant la reprise est au centime, de zéro à son TTC (1200,00 €) ; un avoir n''en porte pas, il s''impute sur sa facture.'),
      (28, '28. l''encaissé par taux qui oublie un taux (22023)', $q$select fixer_reprise_des_factures('{DV}', '{R}')$q$, 'chef',
        $q$select importer_factures('{DV}', '{"format": "csv"}'::jsonb, jsonb_set('{L}'::jsonb, '{1,encaisse_par_taux}', '[{"taux": 20, "encaisse": 170}]'))::text$q$, '22023',
        'La facture FAC-2025-118 (rang 2 du lot) : l''encaissé par taux donne, pour chacun de ses taux et une fois, de zéro à son TTC, et sa somme est l''encaissé avant la reprise (170,00 €).'),
      (29, '29. l''encaissé donné par taux : gardé tel quel, sans prorata', $q$select fixer_reprise_des_factures('{DV}', '{R}'); select importer_factures('{DV}', '{"format": "csv"}'::jsonb, jsonb_set('{L}'::jsonb, '{1,encaisse_par_taux}', '[{"taux": 20, "encaisse": 120}, {"taux": 10, "encaisse": 50}]'))$q$, 'chef',
        $q$select fi.encaisse_par_taux::text || ' ' || fi.encaisse_au_prorata from factures_importees fi join factures_emises f on f.id = fi.facture_id where f.dossier_id = '{DV}' and f.numero = 'FAC-2025-118'$q$,
        'OK', '[{"taux": 10, "encaisse": 50}, {"taux": 20, "encaisse": 120}] false'),
      (30, '30. un avoir qui cite une facture qui n''est pas reprise (22023)', $q$select fixer_reprise_des_factures('{DV}', '{R}')$q$, 'chef',
        $q$select importer_factures('{DV}', '{"format": "csv"}'::jsonb, jsonb_set('{L}'::jsonb, '{2,origine_numero}', '"FAC-2025-999"'))::text$q$, '22023',
        'L''avoir AV 2025/3 (rang 3 du lot) cite la facture « FAC-2025-999 », qui n''est pas une facture reprise de ce dossier (plus haut dans ce lot, ou d''un import d''avant).'),
      (31, '31. des avoirs qui créditent plus que la facture, l''encaissé déduit (22023)', $q$select fixer_reprise_des_factures('{DV}', '{R}')$q$, 'chef',
        $q$select importer_factures('{DV}', '{"format": "csv"}'::jsonb, jsonb_set('{L}'::jsonb, '{1,encaisse_avant_reprise}', '240'))::text$q$, '22023',
        'La facture FAC-2025-118 : son encaissé avant la reprise (240,00 €) dépasse ce qui reste à encaisser, ses avoirs repris déduits (230,00 €).'),
      (32, '32. le même fichier deux fois (22023)', $q$select fixer_reprise_des_factures('{DV}', '{R}'); select importer_factures('{DV}', jsonb_build_object('format', 'csv', 'fichier_sha256', repeat('ab', 32), 'fichier_taille', 2048), '{L}'::jsonb)$q$, 'chef',
        $q$select importer_factures('{DV}', jsonb_build_object('format', 'csv', 'fichier_sha256', repeat('ab', 32), 'fichier_taille', 2048), '[]'::jsonb)::text$q$, '22023',
        'Ce fichier a déjà été importé dans ce dossier (la même empreinte).'),
      -- La garde.
      (34, '34. un chef qui n''est pas super-administrateur n''insère pas une facture reprise en direct (42501)', null, 'chef_simple',
        $q$insert into factures_emises (dossier_id, numero, statut, type, date_emission, tiers_nom, type_client, nature_operation, option_debits, source_de_la_vente) values ('{DV}', 'X-1', 'importee', 'facture', '2025-01-01', 'X', 'non_assujetti', 'services', false, true) returning 1$q$,
        '42501', 'Une facture reprise ne naît que par importer_factures, qui la juge.'),
      (35, '35. une facture reprise ne se modifie pas (23514)', $q$select fixer_reprise_des_factures('{DV}', '{R}'); select {I}$q$, 'chef',
        $q$update factures_emises set tiers_nom = 'Autre' where dossier_id = '{DV}' and numero = 'F2025-0007' returning 1$q$,
        '23514', 'La facture F2025-0007 est reprise de l''ancien logiciel : elle ne se modifie pas. Une reprise fausse se retire en entier (retirer_import), tant que rien ne s''y rattache.'),
      (36, '36. ses lignes non plus : ni modifiées, ni ajoutées (23514)', $q$select fixer_reprise_des_factures('{DV}', '{R}'); select {I}$q$, 'chef',
        $q$insert into facture_lignes (facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva) select f.id, 9, 'Ajout', 1, 1, 0 from factures_emises f where f.dossier_id = '{DV}' and f.numero = 'F2025-0007' returning 1$q$,
        '23514', 'La facture F2025-0007 est reprise de l''ancien logiciel : ses lignes ne changent pas.'),
      (37, '37. un brouillon ne devient pas une facture reprise (42501)', $q$select enregistrer_facture('{DV}', null, '{"tiers_nom": "Brouillon"}'::jsonb, '[{"designation": "x", "quantite": 1, "prix_unitaire_ht": 1, "taux_tva": 0}]'::jsonb, false)$q$, 'chef',
        $q$update factures_emises set statut = 'importee', numero = 'X-2', source_de_la_vente = true, option_debits = false, type_client = 'non_assujetti', nature_operation = 'services' where dossier_id = '{DV}' and statut = 'brouillon' returning 1$q$,
        '42501', 'Une facture ne devient pas une facture reprise : celle-ci naît par importer_factures.'),
      (38, '38. le lot ne se réécrit pas en direct, même par le rôle des Edge Functions (23514)', $q$select fixer_reprise_des_factures('{DV}', '{R}'); select {I}$q$, 'service',
        $q$update imports_factures set nombre_factures = 2 where dossier_id = '{DV}' returning 1$q$,
        '23514', 'Un import de factures ne se modifie pas : il se retire en entier (retirer_import), tant que rien ne s''y rattache.'),
      (39, '39. la restauration réinsère une facture reprise, son lot et sa ligne, au super-administrateur', null, 'chef',
        $q$with l as (insert into imports_factures (id, dossier_id, format, nombre_factures) values ('a8a00000-0000-4000-8000-0000000000c1', '{DV}', 'csv', 1) returning id),
                f as (insert into factures_emises (id, dossier_id, numero, statut, type, date_emission, tiers_nom, type_client, nature_operation, option_debits, source_de_la_vente, montant_ht, montant_ttc) values ('a8a00000-0000-4000-8000-0000000000c2', '{DV}', 'R-1', 'importee', 'facture', '2025-01-01', 'X', 'non_assujetti', 'services', false, true, 10, 10) returning id)
           select (select count(*) from l) || ' ' || (select count(*) from f)$q$,
        'OK', '1 1'),
      -- La chronologie de la série (le cinquième refus de la validation, étendu aux reprises).
      (40, '40. la validation d''une facture de l''application, datée d''avant la plus récente reprise de sa série (22023)', $q$select fixer_reprise_des_factures('{DV}', '{R}'); select importer_factures('{DV}', '{"format": "csv"}'::jsonb, '{S}'::jsonb); {SUITE}$q$, 'client',
        $q$select ({VA}).numero$q$, '22023',
        format('La date d''émission, le %s, précède celle de F%s-0042 (le %s), la plus récente des factures reprises de la même série : les numéros suivent l''ordre des dates d''émission (CGI, ann. II, art. 242 nonies A, I, 7°). Une date du %s ou d''après se valide.',
          to_char(reprise - 20, 'DD/MM/YYYY'), extract(year from reprise - 10)::integer, to_char(reprise - 10, 'DD/MM/YYYY'), to_char(reprise - 10, 'DD/MM/YYYY'))),
      (41, '41. datée de la reprise, elle se valide et continue la série reprise', $q$select fixer_reprise_des_factures('{DV}', '{R}'); select importer_factures('{DV}', '{"format": "csv"}'::jsonb, '{S}'::jsonb); {SUITE}$q$, 'client',
        $q$select ({VP}).numero$q$, 'OK', 'F' || extract(year from reprise - 10)::integer || '-0043'),
      -- Le retrait d'un import.
      (42, '42. le chef retire le lot : ses trois factures, leurs lignes, le lot', $q$select fixer_reprise_des_factures('{DV}', '{R}'); select {I}$q$, 'chef',
        $q$select retirer_import('{DV}', (select l.id from imports_factures l where l.dossier_id = '{DV}'))::text$q$, 'OK', '3'),
      (43, '43. … et rien n''en reste, la date de reprise de nouveau libre', $q$select fixer_reprise_des_factures('{DV}', '{R}'); select {I}; select retirer_import('{DV}', (select l.id from imports_factures l where l.dossier_id = '{DV}'))$q$, 'chef',
        $q$select (select count(*) from factures_emises f where f.dossier_id = '{DV}') || ' ' || (select count(*) from imports_factures l where l.dossier_id = '{DV}') || ' ' || (select count(*) from facture_lignes fl join factures_emises f on f.id = fl.facture_id where f.dossier_id = '{DV}') || ' ' || fixer_reprise_des_factures('{DV}', '{R}')$q$,
        'OK', '0 0 0 ' || reprise::text),
      (44, '44. le retrait refusé : un avoir d''un autre import crédite une de ses factures (23514)',
        $q$select fixer_reprise_des_factures('{DV}', '{R}'); select importer_factures('{DV}', '{"format": "csv"}'::jsonb, jsonb_path_query_array('{L}'::jsonb, '$[0 to 1]')); select importer_factures('{DV}', '{"format": "csv"}'::jsonb, jsonb_path_query_array('{L}'::jsonb, '$[2]'))$q$, 'chef',
        $q$select retirer_import('{DV}', (select fi.import_id from factures_importees fi join factures_emises f on f.id = fi.facture_id where f.dossier_id = '{DV}' and f.numero = 'FAC-2025-118'))::text$q$, '23514',
        'La facture reprise FAC-2025-118 est créditée par l''avoir repris AV 2025/3, d''un autre import : celui-ci se retire d''abord.'),
      (45, '45. le retrait refusé : l''application a continué la série (23514)',
        $q$select fixer_reprise_des_factures('{DV}', '{R}'); select importer_factures('{DV}', '{"format": "csv"}'::jsonb, '{S}'::jsonb); {SUITE} {CLIENT} select ({VP}).numero$q$, 'chef',
        $q$select retirer_import('{DV}', (select l.id from imports_factures l where l.dossier_id = '{DV}'))::text$q$, '23514',
        format('L''application a continué la série de la facture reprise F%s-0042 (la facture F%s-0043) : son import ne se retire plus, il y creuserait un trou.',
          extract(year from reprise - 10)::integer, extract(year from reprise - 10)::integer)),
      (46, '46. le client, même « Ventes », ne retire pas (42501)', $q$select fixer_reprise_des_factures('{DV}', '{R}'); select {I}$q$, 'client',
        $q$select retirer_import('{DV}', (select l.id from imports_factures l where l.dossier_id = '{DV}'))::text$q$, '42501', 'Accès refusé à ce dossier.'),
      (47, '47. une fois validée, une facture de la même série ne s''importe plus (22023)',
        $q$select fixer_reprise_des_factures('{DV}', '{R}'); {CLIENT} select ({VP}).numero$q$, 'chef',
        $q$select importer_factures('{DV}', '{"format": "csv"}'::jsonb, '{S}'::jsonb)::text$q$, '22023',
        format('La facture F%s-0042 (rang 1 du lot) reprendrait la série que l''application a déjà continuée (la facture F%s-0001) : une facture reprise précède toujours celles de l''application.',
          extract(year from reprise - 10)::integer, extract(year from reprise - 10)::integer))
    ) as t(rang, etape, pose, profil, requete, code, attendu) loop
      v_code := 'OK'; v_msg := null; v_obs := null;
      begin
        if e.profil = 'chef_simple' then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client::uuid, cabinet, 'comptable_en_chef');
        end if;
        if e.pose is not null then
          v_pose := replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(e.pose,
            '{SUITE}', suite), '{CLIENT}', au_client),
            '{I}', importer), '{VA}', valider_avant), '{VP}', valider_apres), '{S}', seule), '{L}', lot), '{AN}', extract(year from reprise - 10)::integer::text),
            '{AVANT}', (reprise - 10)::text), '{DV}', dv), '{DN}', dn), '{R}', reprise::text);
          execute 'set local role authenticated';
          perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
          execute v_pose;
          reset role;
          perform set_config('request.jwt.claims', '', true);
        end if;
        v_req := replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(e.requete,
          '{I}', importer), '{VA}', valider_avant), '{VP}', valider_apres), '{S}', seule), '{L}', lot), '{AN}', extract(year from reprise - 10)::integer::text),
          '{AVANT}', (reprise - 10)::text), '{DV}', dv), '{DS}', ds), '{DE}', de), '{DN}', dn), '{R}', reprise::text), '{CHEF}', chef);
        begin
          if e.profil = 'anon' then
            execute 'set local role anon';
            perform set_config('request.jwt.claims', '{"role":"anon"}', true);
          elsif e.profil = 'service' then
            execute 'set local role service_role';
            perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
          else
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
        'ok', v_code = e.code and v_msg = e.attendu, 'observe', v_code || ' ' || coalesce(v_msg, '-'));
    end loop;

    -- Le catalogue : la RLS active sur les deux tables, deux policies chacune (la lecture du cabinet, la restauration),
    -- toutes à authenticated, aucune qui modifie ou supprime, aucune au client ; la policy qui administre les factures à authenticated ; les gardes avant chaque écriture, celle des
    -- reprises après celle d'hier ; les fonctions aux droits du propriétaire, search_path fixé, exécutées par authenticated
    -- seul ; les gardes par personne.
    verdicts := verdicts || jsonb_build_object('rang', 48, 'etape', '48. le catalogue : RLS, policies à authenticated, les gardes et leur ordre, les fonctions',
      'ok', (select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('public.imports_factures'::regclass, 'public.factures_importees'::regclass))
        and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename in ('imports_factures', 'factures_importees')
               and p.permissive = 'PERMISSIVE') = 4
        and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename in ('imports_factures', 'factures_importees')
               and p.permissive = 'PERMISSIVE' and p.roles = array['authenticated']::name[]
               and ((p.policyname like '%\_lecture' and p.cmd = 'SELECT' and p.qual = 'admin_du_dossier(dossier_id)')
                 or (p.policyname like '%\_restauration' and p.cmd = 'INSERT' and p.with_check = 'is_super_admin()'))) = 4
        and (select p.roles = array['authenticated']::name[] from pg_policies p
              where p.schemaname = 'public' and p.tablename = 'factures_emises' and p.policyname = 'factures_emises_all')
        -- Celle des mentions à la validation (JJ-Q4, en production depuis le 08/11/2026) entre la garde d'hier et celle des
        -- reprises ; avec la numérotation qui continue (A9a, préparée), son déclencheur après la marque d'acompte.
        and (select string_agg(t.tgname, ',' order by t.tgname collate "C") from pg_trigger t
              where t.tgrelid = 'public.factures_emises'::regclass and not t.tgisinternal and (t.tgtype & 2) = 2 and t.tgname <> '_acces_avant_les_gardes')
            in ('factures_emises_figees,factures_emises_figees_mentions,factures_emises_figees_reprises,factures_emises_marque_d_acompte,factures_emises_source_de_la_vente',
                'factures_emises_figees,factures_emises_figees_mentions,factures_emises_figees_reprises,factures_emises_marque_d_acompte,factures_emises_numerotation,factures_emises_source_de_la_vente')
        and (select count(*) from pg_trigger t where not t.tgisinternal and t.tgtype = 31
               and t.tgname in ('imports_factures_garde', 'factures_importees_garde', 'factures_emises_figees_reprises', 'facture_lignes_figees_reprises')) = 4
        and (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
               and p.oid in ('public.importer_factures(uuid, jsonb, jsonb)'::regprocedure, 'public.retirer_import(uuid, uuid)'::regprocedure,
                             'public.fixer_reprise_des_factures(uuid, date)'::regprocedure)
               and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
               and not has_function_privilege('anon', p.oid, 'execute')
               and has_function_privilege('authenticated', p.oid, 'execute')) = 3
        and not has_function_privilege('authenticated', 'public.garder_factures_reprises()', 'execute')
        and not has_function_privilege('authenticated', 'public.garder_imports_factures()', 'execute')
        and not has_function_privilege('authenticated', 'public.garder_lignes_des_factures_reprises()', 'execute')
        and not has_function_privilege('authenticated', 'public.garder_reprise_des_factures()', 'execute'),
      'observe', 'relu au catalogue');
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  -- Rien n'est resté : ni les dossiers jetables, ni leurs accès, ni leurs factures et leurs lots, ni le compte d'essai
  -- dans le cabinet.
  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni leurs accès, ni leurs factures, ni leurs lots, ni le compte d''essai dans le cabinet',
    'ok', not exists (select 1 from dossiers where id in (dv::uuid, ds::uuid, de::uuid, dn::uuid))
      and not exists (select 1 from memberships where id in (acces_v::uuid, acces_s::uuid))
      and not exists (select 1 from factures_emises where dossier_id in (dv::uuid, ds::uuid, de::uuid, dn::uuid))
      and not exists (select 1 from imports_factures where dossier_id in (dv::uuid, ds::uuid, de::uuid, dn::uuid))
      and not exists (select 1 from cabinet_admins where user_id::text = client),
    'observe', 'relu');
  perform set_config('essai.factures_importees', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.factures_importees')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
