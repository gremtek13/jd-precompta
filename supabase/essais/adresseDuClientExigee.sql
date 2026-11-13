-- L'ADRESSE DU CLIENT EXIGÉE À LA VALIDATION D'UNE FACTURE À UNE ENTREPRISE OU À UN ORGANISME PUBLIC (JJ-Q4), ET LA LIGNE
-- À 0 % D'UN DOSSIER REDEVABLE SANS ARTICLE D'EXONÉRATION (A7C-Q1), ÉPROUVÉES EN BASE (07/11/2026) — à rejouer par `execute_sql` après toute migration qui touche `factures_emises`, ses déclencheurs,
-- `enregistrer_facture` ou la garde des factures (`garder_factures_validees`). La migration :
-- supabase/schema/20261108190701_adresse_du_client_exigee.sql (en production depuis le 08/11/2026) ; le module qui la redit :
-- src/lib/validationDeLaFacture.ts (`refusDeLAdresseDuClient`, `refusDeLaLigneAZero`, sous `ADRESSE_DU_CLIENT_EXIGEE`) ; le
-- récit : HISTORIQUE.md, « JJ-Q4 : UNE FACTURE À UNE ENTREPRISE SANS ADRESSE NE SE VALIDE PAS, ET LA LIGNE À 0 % D'UN
-- REDEVABLE (A7C-Q1) (PRÉPARÉE, PAS APPLIQUÉE) ».
--
-- Ce qui se prouve ici :
--   - LE CATALOGUE : le déclencheur, ligne, avant la mise à jour, au seul passage à « validée », sur sa fonction, que
--     personne n'exécute ; il suit la garde des factures dans l'ordre des noms et précède la source de la vente ;
--   - LE REFUS (22023, les mots du module), pour le cabinet comme pour le client « Ventes » : une facture à une entreprise
--     sans adresse, ou d'une adresse faite de blancs, une facture à un organisme public sans adresse — chacune avec, à
--     côté, la même facture munie de son adresse, qui se valide (une mutation : sans elle, le refus ne mordrait pas) ;
--   - CE QUI SE VALIDE COMME HIER : un particulier sans adresse, un patient d'un dossier de soins sans adresse, un client
--     établi hors de France sans adresse, un type de client à préciser ; un brouillon à une entreprise sans adresse
--     s'enregistre ; l'avoir d'une facture à une entreprise se valide ;
--   - LA LIGNE À 0 % (A7C-Q1, 22023, les mots du module) : celle d'un redevable sans article, refusée, à côté de la même au
--     taux de 20 % ; celle d'un redevable qui a son article, d'un dossier exonéré ou en franchise, validée ; sous un régime
--     d'e7a que la TVA française ne taxe pas (une autoliquidation), validée quand `facture_internationale` est en base,
--     refusée sans elle (le régime ne s'enregistre pas) ; sous le régime « taxable en France », refusée dans les deux cas ;
--   - L'ORDRE : une date à venir se dit avant l'adresse (la garde d'abord), l'adresse avant la ligne à 0 %, et l'adresse
--     avant la nature qu'exige la source de la vente d'un dossier basculé ;
--   - et que RIEN ne reste en base.
-- Tout se joue dans cinq dossiers JETABLES du cabinet du chef (A, redevable sans article ; R, redevable qui a son article ;
-- F, en franchise ; S, de soins exonérés ; V, basculé, où le client de l'essai a un accès « Ventes »), au sein d'un bloc qui s'annule entièrement à la fin
-- (`ANNULATION_ESSAI_GLOBALE`) ; chaque contrôle dans sa sous-transaction, annulée elle aussi (`ANNULATION_ESSAI`) ; les
-- étapes « jeu » et « fait » restent jusqu'à l'annulation finale, et une étape peut rendre une valeur que les suivantes
-- citent (`{CLE}`). Un refus se juge à son code ET à son message (`like`). Le fichier se joue d'un seul appel, ne crée
-- aucun objet et ne porte AUCUNE instruction de retrait de ligne ; il ne rend rien qui dépende d'une ligne hors de ses
-- dossiers (l'écart seul). Sans la migration, le contrôle 00 se dit EN ATTENTE et ceux qui la demandent sont en faute.
-- Une facture validée AVANT la migration, sans adresse ou avec une ligne à 0 %, se prouve sur une réplique (HISTORIQUE.md) :
-- l'essai ne peut pas en faire naître une. Données FICTIVES.

do $essai$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  jour date := (now() at time zone 'Europe/Paris')::date;
  cabinet uuid;
  ids jsonb;
  verdicts jsonb := '[]'::jsonb;
  en_base boolean;
  -- La migration préparée `facture_internationale` (e7a) : avec elle, le régime d'une facture s'enregistre.
  fi boolean;
  s record;
  k text;
  ordre text;
  attendu text;
  rendu text;
  code_recu text;
  message text;
  ok boolean;
  erreur text;
  avant text;
  apres text;
begin
  if to_regclass('public.factures_emises') is null or to_regclass('public.facture_lignes') is null then
    raise exception 'ESSAI_IMPOSSIBLE : les factures ne sont pas en base';
  end if;
  en_base := exists (select 1 from pg_trigger where tgrelid = 'public.factures_emises'::regclass
                      and tgname = 'factures_emises_figees_mentions');
  fi := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'factures_emises'
                 and column_name = 'regime_international');
  select ca.cabinet_id into cabinet from cabinet_admins ca where ca.user_id = chef and ca.role = 'comptable_en_chef'
   order by ca.cabinet_id limit 1;
  if cabinet is null or exists (select 1 from cabinet_admins where user_id = client)
     or exists (select 1 from super_admins where user_id = client) then
    raise exception 'ESSAI_IMPOSSIBLE : le chef de l''essai ou le client d''essai (sans cabinet) manque';
  end if;

  ids := jsonb_build_object('CLIENT', client, 'CHEF', chef, 'CAB', cabinet,
    'DA', 'a4d00000-0000-4000-8000-0000000000a1', 'DS', 'a4d00000-0000-4000-8000-0000000000e1',
    'DR', 'a4d00000-0000-4000-8000-0000000000a2', 'DF', 'a4d00000-0000-4000-8000-0000000000f1',
    'DV', 'a4d00000-0000-4000-8000-0000000000b1', 'ACCES', 'a4d00000-0000-4000-8000-0000000000c1',
    'JOUR', to_char(jour, 'YYYY-MM-DD'), 'DEMAIN', to_char(jour + 1, 'YYYY-MM-DD'),
    -- Une facture à une entreprise établie en France, sans adresse, d'un dossier redevable : un service à 20 %.
    'ENT', jsonb_build_object('type', 'facture', 'tiers_nom', 'ESSAI JJQ4 CLIENT SARL', 'tiers_siret', '12345678200028',
      'tiers_siren', '123456782', 'type_client', 'assujetti', 'nature_operation', 'services',
      'date_emission', to_char(jour, 'YYYY-MM-DD'), 'date_echeance', to_char(jour, 'YYYY-MM-DD'),
      'emetteur_nom', 'ESSAI JJQ4 SAS', 'emetteur_siret', '12345678200010', 'emetteur_adresse', '1 rue de l Essai, 75001 Paris',
      'montant_ht', 100, 'montant_tva', 20, 'montant_ttc', 120,
      'mentions_legales', 'Pénalités de retard : 10 % par an. Indemnité forfaitaire de recouvrement : 40 €.')::text,
    -- Ce qui la complète : une adresse.
    'ADR', '{"tiers_adresse":"5 avenue de l Essai, 69001 Lyon"}',
    -- Une facture à un patient d'un dossier de soins exonérés : ni SIRET ni adresse, au taux 0, la mention de l'article.
    'PAT', jsonb_build_object('type', 'facture', 'tiers_nom', 'ESSAI JJQ4 PATIENT', 'type_client', 'non_assujetti',
      'nature_operation', 'services', 'date_emission', to_char(jour, 'YYYY-MM-DD'),
      'emetteur_nom', 'ESSAI JJQ4 SOINS', 'emetteur_siret', '12345678200010', 'emetteur_adresse', '2 rue de l Essai, 75001 Paris',
      'montant_ht', 50, 'montant_tva', 0, 'montant_ttc', 50,
      'mentions_legales', 'Exonération de TVA, art. 261, 4, 1° du CGI.')::text,
    'L20', '[{"designation":"ESSAI JJQ4 PRESTATION","quantite":1,"prix_unitaire_ht":100,"taux_tva":20,"nature":"services"}]',
    'L0', '[{"designation":"ESSAI JJQ4 SOIN","quantite":1,"prix_unitaire_ht":50,"taux_tva":0,"nature":"services"}]',
    'LAV', '[{"designation":"ESSAI JJQ4 AVOIR","quantite":-1,"prix_unitaire_ht":100,"taux_tva":20,"nature":"services"}]',
    'VENTES', '{"emetteur_nom":"ESSAI JJQ4 VENTES SAS","emetteur_adresse":"3 rue de l Essai, 75001 Paris"}',
    -- A7C-Q1 : une prestation à 0 % (et ce qui l'accompagne pour l'entreprise, son adresse).
    'Z', '{"tiers_adresse":"5 avenue de l Essai, 69001 Lyon","montant_ht":100,"montant_tva":0,"montant_ttc":100}',
    'LZ', '[{"designation":"ESSAI A7C PRESTATION","quantite":1,"prix_unitaire_ht":100,"taux_tva":0,"nature":"services"}]',
    -- Une autoliquidation (e7a) : un service à une entreprise allemande, au taux 0.
    'UE', '{"type_client":"etranger","tiers_siret":null,"tiers_siren":null,"client_pays":"DE","client_numero_tva":"DE123456789","regime_international":"autoliquidation_ue","mentions_legales":"Autoliquidation (art. 196 de la directive 2006/112/CE). Pénalités de retard : 10 % par an."}',
    'LIRE', 'select coalesce(type_client, ''∅'') || ''|'' || coalesce(tiers_adresse, ''∅'') || ''|'' || statut from factures_emises where id = ');

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from factures_emises)),
    ((select count(*) from facture_lignes)), ((select count(*) from facture_numerotation))
  ) as x(n);

  verdicts := verdicts || jsonb_build_object('controle', '00. la migration adresse_du_client_exigee est en base (son témoin : le déclencheur factures_emises_figees_mentions)',
    'genre', case when en_base then 'controle' else 'attente' end,
    'observe', case when en_base then 'présente' else 'absente : les contrôles qui la demandent sont en faute' end, 'ok', en_base);

  begin
    for s in select * from (values
      -- (numéro, genre, contrôle, qui, ordre, code attendu ou OK, message ou valeur attendus, clé)

      -- ══ Le jeu ══════════
      ('j1', 'jeu', 'dossiers jetables A (redevable), R (redevable, son article), F (franchise), S (soins exonérés) et V (basculé)', 'proprietaire',
        $q$insert into dossiers (id, nom, cabinet_id, siret, adresse, statut_tva, assujetti_tva, article_exoneration, numero_tva_attribue,
             ventes_par_les_factures, forme_juridique, denomination_imprimee) values
          ('{DA}', 'ESSAI JJQ4 A', '{CAB}', '12345678200010', '1 rue de l''Essai, 75001 Paris', 'redevable', true, null, false, false, '5710', 'ESSAI JJQ4 SAS'),
          ('{DR}', 'ESSAI JJQ4 R', '{CAB}', '12345678200010', '4 rue de l''Essai, 75001 Paris', 'redevable', true, 'cgi_261_4_4_a', false, false, '5710', 'ESSAI JJQ4 ENSEIGNEMENT'),
          ('{DF}', 'ESSAI JJQ4 F', '{CAB}', '12345678200010', '6 rue de l''Essai, 75001 Paris', 'franchise', false, null, false, false, '5710', 'ESSAI JJQ4 FRANCHISE'),
          ('{DS}', 'ESSAI JJQ4 S', '{CAB}', '12345678200010', '2 rue de l''Essai, 75001 Paris', 'exonere', false, 'cgi_261_4_1', false, false, '5710', 'ESSAI JJQ4 SOINS'),
          ('{DV}', 'ESSAI JJQ4 V', '{CAB}', '12345678200010', '3 rue de l Essai, 75001 Paris', 'redevable', true, null, false, true, '5710', 'ESSAI JJQ4 VENTES SAS')
          returning id::text$q$, 'OK', null, null),
      ('j2', 'jeu', 'l''accès « Ventes » du client d''essai au dossier V', 'proprietaire',
        $q$insert into memberships (id, user_id, dossier_id, role, email, droit_ventes) values ('{ACCES}', '{CLIENT}', '{DV}', 'client', 'essai-jjq4@example.test', true) returning id::text$q$, 'OK', null, null),

      -- ══ 0. Le catalogue ══════════
      ('01', 'controle', 'le déclencheur : ligne, avant la mise à jour, au seul passage à « validée », sur sa fonction, DEFINER', 'proprietaire',
        $q$select t.tgfoid::regproc::text || '|' || ((t.tgtype & 1) <> 0)::text || '|' || ((t.tgtype & 2) <> 0)::text || '|'
              || ((t.tgtype & 4) <> 0)::text || '|' || ((t.tgtype & 8) <> 0)::text || '|' || ((t.tgtype & 16) <> 0)::text || '|' || t.tgenabled::text
              || '|' || (pg_get_triggerdef(t.oid) like '%WHEN (((new.statut = ''validee''::text) AND (old.statut IS DISTINCT FROM ''validee''::text)))%')::text
              || '|' || (select p.prosecdef::text from pg_proc p where p.oid = t.tgfoid)
            from pg_trigger t where t.tgrelid = 'public.factures_emises'::regclass and t.tgname = 'factures_emises_figees_mentions'$q$,
        'OK', 'garder_mentions_a_la_validation|true|true|false|false|true|O|true|true', null),
      ('02', 'controle', 'sa fonction : personne ne l''exécute, ni l''anonyme ni les connectés', 'proprietaire',
        $q$select has_function_privilege('anon', 'public.garder_mentions_a_la_validation()', 'execute')::text
            || '|' || has_function_privilege('authenticated', 'public.garder_mentions_a_la_validation()', 'execute')::text$q$,
        'OK', 'false|false', null),
      ('03', 'controle', 'l''ordre des noms : la garde des factures, puis lui, puis la marque d''acompte et la source de la vente', 'proprietaire',
        $q$select string_agg(t.tgname::text, ',' order by t.tgname::text collate "C") from pg_trigger t
            where t.tgrelid = 'public.factures_emises'::regclass and not t.tgisinternal
              and (t.tgtype & 1) <> 0 and (t.tgtype & 2) <> 0 and (t.tgtype & 16) <> 0 and t.tgname <> '_acces_avant_les_gardes'$q$,
        'OK', 'factures_emises_figees,factures_emises_figees_mentions,factures_emises_figees_reprises,factures_emises_marque_d_acompte,factures_emises_numerotation,factures_emises_source_de_la_vente', null),

      -- ══ 1. Le refus ══════════
      ('10', 'controle', 'une facture à une entreprise sans adresse : refusée', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{ENT}'::jsonb, '{L20}'::jsonb, true) f$q$,
        '22023', 'L''adresse du client manque : une facture à une entreprise ou à un organisme public porte le nom complet et l''adresse de son client (CGI, ann. II, art. 242 nonies A, I, 1° ; code de commerce, art. L441-9, I). Elle se renseigne avant la validation : une facture validée ne se corrige que par un avoir.', null),
      ('M10', 'mutation', 'le contrôle 10 avec l''adresse : elle se valide', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{ENT}'::jsonb || '{ADR}'::jsonb, '{L20}'::jsonb, true) f ;; {LIRE} '{RENDU}'$q$,
        'OK', 'assujetti|5 avenue de l Essai, 69001 Lyon|validee', null),
      ('11', 'controle', 'une facture à une entreprise dont l''adresse n''est faite que de blancs (espace, tabulation, saut de ligne, espace insécable) : refusée', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{ENT}'::jsonb || jsonb_build_object('tiers_adresse', ' ' || chr(9) || chr(10) || chr(160) || ' '), '{L20}'::jsonb, true) f$q$,
        '22023', 'L''adresse du client manque : %', null),
      ('12', 'controle', 'une facture à un organisme public sans adresse : refusée', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{ENT}'::jsonb || '{"type_client":"organisme_public","tiers_nom":"ESSAI JJQ4 SERVICE PUBLIC"}'::jsonb, '{L20}'::jsonb, true) f$q$,
        '22023', 'L''adresse du client manque : %', null),
      ('M12', 'mutation', 'le contrôle 12 avec l''adresse : elle se valide', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{ENT}'::jsonb || '{"type_client":"organisme_public","tiers_nom":"ESSAI JJQ4 SERVICE PUBLIC"}'::jsonb || '{ADR}'::jsonb, '{L20}'::jsonb, true) f ;; {LIRE} '{RENDU}'$q$,
        'OK', 'organisme_public|5 avenue de l Essai, 69001 Lyon|validee', null),
      ('13', 'controle', 'le client « Ventes » : une facture à une entreprise sans adresse, refusée de même', 'client',
        $q$select f.facture_id::text from enregistrer_facture('{DV}', null, '{ENT}'::jsonb || '{VENTES}'::jsonb, '{L20}'::jsonb, true) f$q$,
        '22023', 'L''adresse du client manque : %', null),
      ('M13', 'mutation', 'le contrôle 13 avec l''adresse : elle se valide', 'client',
        $q$select f.facture_id::text from enregistrer_facture('{DV}', null, '{ENT}'::jsonb || '{VENTES}'::jsonb || '{ADR}'::jsonb, '{L20}'::jsonb, true) f ;; {LIRE} '{RENDU}'$q$,
        'OK', 'assujetti|5 avenue de l Essai, 69001 Lyon|validee', null),
      ('14', 'controle', 'un brouillon à une entreprise sans adresse s''enregistre (seule la validation se juge)', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{ENT}'::jsonb, '{L20}'::jsonb, false) f ;; {LIRE} '{RENDU}'$q$,
        'OK', 'assujetti|∅|brouillon', null),
      ('f1', 'fait', 'BR : le même brouillon, gardé', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{ENT}'::jsonb, '{L20}'::jsonb, false) f$q$, 'OK', null, 'BR'),
      ('15', 'controle', 'le brouillon BR validé sans adresse : refusé', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', '{BR}', '{ENT}'::jsonb, '{L20}'::jsonb, true) f$q$,
        '22023', 'L''adresse du client manque : %', null),
      ('M15', 'mutation', 'le brouillon BR validé avec l''adresse : il se valide', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', '{BR}', '{ENT}'::jsonb || '{ADR}'::jsonb, '{L20}'::jsonb, true) f ;; {LIRE} '{RENDU}'$q$,
        'OK', 'assujetti|5 avenue de l Essai, 69001 Lyon|validee', null),

      -- ══ 2. Ce qui se valide comme hier ══════════
      ('20', 'controle', 'un particulier sans adresse : validée', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{ENT}'::jsonb || '{"type_client":"non_assujetti","tiers_nom":"ESSAI JJQ4 PARTICULIER","tiers_siret":null,"tiers_siren":null}'::jsonb, '{L20}'::jsonb, true) f ;; {LIRE} '{RENDU}'$q$,
        'OK', 'non_assujetti|∅|validee', null),
      ('21', 'controle', 'un patient d''un dossier de soins, sans adresse : validée', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DS}', null, '{PAT}'::jsonb, '{L0}'::jsonb, true) f ;; {LIRE} '{RENDU}'$q$,
        'OK', 'non_assujetti|∅|validee', null),
      ('22', 'controle', 'un client établi hors de France sans adresse : validée (JJQ4-Q1)', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{ENT}'::jsonb || '{"type_client":"etranger","tiers_nom":"ESSAI JJQ4 CLIENT ETRANGER","tiers_siret":null,"tiers_siren":null}'::jsonb, '{L20}'::jsonb, true) f ;; {LIRE} '{RENDU}'$q$,
        'OK', 'etranger|∅|validee', null),
      ('23', 'controle', 'un type de client à préciser, sans adresse : validée', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, ('{ENT}'::jsonb - 'type_client' - 'tiers_siren') || '{"tiers_nom":"ESSAI JJQ4 CLIENT A PRECISER","tiers_siret":null}'::jsonb, '{L20}'::jsonb, true) f ;; {LIRE} '{RENDU}'$q$,
        'OK', '∅|∅|validee', null),
      ('f2', 'fait', 'FE : une facture à une entreprise, avec son adresse, validée', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{ENT}'::jsonb || '{ADR}'::jsonb, '{L20}'::jsonb, true) f$q$, 'OK', null, 'FE'),
      ('24', 'controle', 'l''avoir de FE reprend son client et se valide', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{"type":"avoir","facture_origine_id":"{FE}","date_emission":"{JOUR}","montant_ht":-100,"montant_tva":-20,"montant_ttc":-120,"mentions_legales":"Avoir"}'::jsonb, '{LAV}'::jsonb, true) f ;; {LIRE} '{RENDU}'$q$,
        'OK', 'assujetti|5 avenue de l Essai, 69001 Lyon|validee', null),

      -- ══ 4. La ligne à 0 % d'un redevable (A7C-Q1) ══════════
      ('40', 'controle', 'une ligne à 0 % d''un redevable sans article : refusée', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{ENT}'::jsonb || '{Z}'::jsonb, '{LZ}'::jsonb, true) f$q$,
        '22023', 'Une ligne est au taux 0 dans un dossier redevable de la TVA sans article d''exonération : la facture ne dirait pas pourquoi elle ne porte pas de TVA (CGI, ann. II, art. 242 nonies A, I). L''article d''exonération du dossier se choisit avant la validation, ou la ligne prend son taux ; des débours, payés au nom et pour le compte du client, restent hors de la facture (CGI, art. 267, II, 2°).', null),
      ('M40', 'mutation', 'le contrôle 40 au taux de 20 % : elle se valide', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{ENT}'::jsonb || '{ADR}'::jsonb, '{L20}'::jsonb, true) f ;; {LIRE} '{RENDU}'$q$,
        'OK', 'assujetti|5 avenue de l Essai, 69001 Lyon|validee', null),
      ('41', 'controle', 'la même ligne d''un redevable qui a son article : validée', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DR}', null, '{ENT}'::jsonb || '{Z}'::jsonb || '{"emetteur_nom":"ESSAI JJQ4 ENSEIGNEMENT","emetteur_adresse":"4 rue de l Essai, 75001 Paris"}'::jsonb, '{LZ}'::jsonb, true) f ;; {LIRE} '{RENDU}'$q$,
        'OK', 'assujetti|5 avenue de l Essai, 69001 Lyon|validee', null),
      ('42', 'controle', 'la même ligne d''un dossier en franchise, sa mention portée : validée', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DF}', null, '{ENT}'::jsonb || '{Z}'::jsonb || '{"emetteur_nom":"ESSAI JJQ4 FRANCHISE","emetteur_adresse":"6 rue de l Essai, 75001 Paris","mentions_legales":"TVA non applicable, art. 293 B du CGI. Pénalités de retard : 10 % par an."}'::jsonb, '{LZ}'::jsonb, true) f ;; {LIRE} '{RENDU}'$q$,
        'OK', 'assujetti|5 avenue de l Essai, 69001 Lyon|validee', null),
      ('43', 'controle', 'la même ligne d''un dossier exonéré (le contrôle 21, un patient) : validée', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DS}', null, '{PAT}'::jsonb, '{L0}'::jsonb, true) f ;; {LIRE} '{RENDU}'$q$,
        'OK', 'non_assujetti|∅|validee', null),
      ('44', 'controle', 'une autoliquidation (e7a) à 0 % d''un redevable sans article : validée avec facture_internationale, refusée sans elle', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{ENT}'::jsonb || '{Z}'::jsonb || '{UE}'::jsonb, '{LZ}'::jsonb, true) f ;; {LIRE} '{RENDU}'$q$,
        case when fi then 'OK' else '22023' end,
        case when fi then 'etranger|5 avenue de l Essai, 69001 Lyon|validee' else 'Une ligne est au taux 0 dans un dossier redevable %' end, null),
      ('45', 'controle', 'sous le régime « taxable en France », la ligne à 0 % d''un redevable sans article : refusée (avec ou sans e7a)', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{ENT}'::jsonb || '{Z}'::jsonb || '{UE}'::jsonb || '{"regime_international":"taxable_en_france","mentions_legales":"Pénalités de retard : 10 % par an."}'::jsonb, '{LZ}'::jsonb, true) f$q$,
        '22023', 'Une ligne est au taux 0 dans un dossier redevable %', null),
      ('46', 'controle', 'le client « Ventes » : la ligne à 0 % d''un redevable sans article, refusée de même', 'client',
        $q$select f.facture_id::text from enregistrer_facture('{DV}', null, '{ENT}'::jsonb || '{VENTES}'::jsonb || '{Z}'::jsonb, '{LZ}'::jsonb, true) f$q$,
        '22023', 'Une ligne est au taux 0 dans un dossier redevable %', null),

      -- ══ 3. L'ordre ══════════
      ('32', 'controle', 'une facture à une entreprise sans adresse et à 0 % d''un redevable sans article : l''adresse se dit d''abord', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{ENT}'::jsonb || '{"montant_ht":100,"montant_tva":0,"montant_ttc":100}'::jsonb, '{LZ}'::jsonb, true) f$q$,
        '22023', 'L''adresse du client manque : %', null),
      ('30', 'controle', 'une facture à une entreprise sans adresse, datée de demain : la date se dit d''abord (la garde)', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{ENT}'::jsonb || '{"date_emission":"{DEMAIN}","date_echeance":"{DEMAIN}"}'::jsonb, '{L20}'::jsonb, true) f$q$,
        '22023', 'La date d''émission, le %, est à venir : %', null),
      ('31', 'controle', 'une facture d''un dossier basculé à une entreprise, sans adresse ni nature : l''adresse se dit d''abord', 'client',
        $q$select f.facture_id::text from enregistrer_facture('{DV}', null, ('{ENT}'::jsonb - 'nature_operation') || '{VENTES}'::jsonb, '[{"designation":"ESSAI JJQ4 PRESTATION","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, true) f$q$,
        '22023', 'L''adresse du client manque : %', null),
      ('M31', 'mutation', 'le contrôle 31 avec l''adresse : la source de la vente refuse alors la nature absente', 'client',
        $q$select f.facture_id::text from enregistrer_facture('{DV}', null, ('{ENT}'::jsonb - 'nature_operation') || '{VENTES}'::jsonb || '{ADR}'::jsonb, '[{"designation":"ESSAI JJQ4 PRESTATION","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, true) f$q$,
        '23514', 'Dans un dossier dont les factures sont la source de leurs ventes, une facture dit si elle porte sur des biens ou sur des services : %', null)
    ) as x(num, genre, controle, qui, ordre, code, attendu, cle)
    loop
      ordre := s.ordre;
      attendu := s.attendu;
      for k in select jsonb_object_keys(ids) order by 1 desc loop
        ordre := replace(ordre, '{' || k || '}', ids ->> k);
        attendu := replace(attendu, '{' || k || '}', ids ->> k);
      end loop;
      code_recu := null; message := null; rendu := null;
      begin
        if s.qui in ('client', 'chef') then
          set local role authenticated;
          perform set_config('request.jwt.claims', json_build_object('sub',
            case s.qui when 'chef' then chef else client end, 'role', 'authenticated')::text, true);
        else
          perform set_config('request.jwt.claims', '', true);
        end if;
        -- « A ;; B » : B lit ce que A vient d'écrire, dans une seconde instruction qui le voit ({RENDU}, ce que A a rendu).
        if position(' ;; ' in ordre) > 0 then
          execute split_part(ordre, ' ;; ', 1) into rendu;
          execute replace(split_part(ordre, ' ;; ', 2), '{RENDU}', coalesce(rendu, '')) into rendu;
        else
          execute ordre into rendu;
        end if;
        code_recu := 'OK';
        if s.genre in ('controle', 'mutation') then
          raise exception 'ANNULATION_ESSAI';
        end if;
      exception when others then
        if sqlerrm <> 'ANNULATION_ESSAI' then code_recu := sqlstate; message := sqlerrm; end if;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      if s.cle is not null and code_recu = 'OK' then
        ids := ids || jsonb_build_object(s.cle, rendu);
      end if;
      ok := code_recu = s.code and (attendu is null
        or (s.code = 'OK' and rendu is not distinct from attendu)
        or (s.code <> 'OK' and message like attendu));
      if s.genre in ('jeu', 'fait') and not ok then
        erreur := s.num || ' : ' || coalesce(code_recu || ' ' || message, code_recu);
        raise exception 'ANNULATION_ESSAI_GLOBALE';
      end if;
      if s.genre in ('controle', 'mutation') then
        verdicts := verdicts || jsonb_build_object('controle', s.num || '. ' || s.controle, 'genre', s.genre,
          'observe', case when ok then coalesce(rendu, code_recu) else coalesce(code_recu || ' ' || message, 'rendu « ' || coalesce(rendu, '—') || ' »') end, 'ok', ok);
      end if;
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;

  select string_agg(n::text, '/') into apres from (values
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from factures_emises)),
    ((select count(*) from facture_lignes)), ((select count(*) from facture_numerotation))
  ) as x(n);
  -- L'écart seul, non les comptes de toute la base, qui diraient le volume d'un dossier réel.
  verdicts := verdicts || jsonb_build_object('controle', '999. l''essai s''est joué jusqu''au bout, et rien n''est resté en base', 'genre', 'controle',
    'observe', coalesce(erreur || ' — ', '') || 'écarts ' || (select string_agg((a.n::bigint - b.n::bigint)::text, '/' order by a.r)
      from unnest(string_to_array(apres, '/')) with ordinality as a(n, r) join unnest(string_to_array(avant, '/')) with ordinality as b(n, r) using (r)),
    'ok', erreur is null and apres = avant);
  perform set_config('essai.adresse_du_client', verdicts::text, true);
end
$essai$;

select v.genre, v.controle, case when v.genre = 'attente' then '*** EN ATTENTE ***'
                                 when v.genre = 'mutation' then case when v.ok then 'mord' else '*** NE MORD PAS ***' end
                                 else case when v.ok then 'ok' else '*** EN FAUTE ***' end end as verdict, v.observe
from jsonb_to_recordset(current_setting('essai.adresse_du_client')::jsonb) as v(controle text, genre text, ok boolean, observe text)
order by v.genre desc, v.controle collate "C";
