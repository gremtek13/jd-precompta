-- LA FACTURE À UN CLIENT ÉTABLI HORS DE FRANCE, ÉPROUVÉE EN BASE (ligne 28.5, étape e7a) — à rejouer par `execute_sql`
-- après toute migration qui touche `factures_emises`, `facture_lignes`, `enregistrer_facture` ou la garde des factures
-- (`garder_factures_validees`). La migration : supabase/preparees/20261107120000_facture_internationale.sql (PRÉPARÉE, PAS
-- APPLIQUÉE) ; le module qui la redit : src/lib/factureInternationale.ts (`FACTURE_INTERNATIONALE_EXPORTEE`) ; le récit :
-- HISTORIQUE.md, « LA FACTURE À UN CLIENT ÉTABLI HORS DE FRANCE, EN BASE (E7A, LIGNE 28.5) (PRÉPARÉE, PAS APPLIQUÉE) ».
--
-- Ce qui se prouve ici :
--   - LE CATALOGUE : les trois colonnes, des textes nullables ; leurs trois contraintes de forme ; `enregistrer_facture`
--     exécutable par les connectés, ni par l'anonyme, et la garde par aucun ;
--   - LES FORMES (23514) : le pays (la France, deux minuscules), le numéro (un blanc), le régime inconnu ;
--   - L'ÉCRITURE du brouillon par `enregistrer_facture` : les trois colonnes écrites, gardées quand la clé est absente,
--     effacées quand elle est vide ; un IBAN dans le numéro de TVA du client refusé ;
--   - LA VALIDATION : une autoliquidation conforme se valide, puis ne se modifie plus ; chacun des quinze refus du bloc
--     « E7A » de la garde (22023, les mots du module), chacun avec, à côté, le cas qui passe ; la mention de TVA d'un
--     franchisé refusée sous une autoliquidation, exigée sous une opération taxable en France ; une facture qui ne porte
--     aucune des trois colonnes se valide comme hier ; l'avoir reprend les trois colonnes de sa facture et se juge sur la
--     mention de TVA ; le client « Ventes » écrit et voit les mêmes refus ;
--   - et que RIEN ne reste en base.
-- Tout se joue dans trois dossiers JETABLES du cabinet du chef (A, redevable ; F, en franchise sans numéro attribué ;
-- V, basculé, où le client de l'essai a un accès « Ventes »), au sein d'un bloc qui s'annule entièrement à la fin
-- (`ANNULATION_ESSAI_GLOBALE`) ; chaque contrôle dans sa sous-transaction, annulée elle aussi (`ANNULATION_ESSAI`) ; les
-- étapes « jeu » et « fait » restent jusqu'à l'annulation finale, et une étape peut rendre une valeur que les suivantes
-- citent (`{CLE}`). Un refus se juge à son code ET à son message (`like`). Le fichier se joue d'un seul appel, ne crée
-- aucun objet et ne porte AUCUNE instruction de retrait de ligne ; il ne rend rien qui dépende d'une ligne hors de ses
-- dossiers (l'écart seul). Sans la migration, le contrôle 00 se dit EN ATTENTE et ceux qui la demandent sont en faute.
-- Données FICTIVES.

do $essai$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  jour date := (now() at time zone 'Europe/Paris')::date;
  cabinet uuid;
  ids jsonb;
  verdicts jsonb := '[]'::jsonb;
  en_base boolean;
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
  en_base := exists (select 1 from pg_attribute where attrelid = 'public.factures_emises'::regclass
                      and attname = 'regime_international' and not attisdropped);
  select ca.cabinet_id into cabinet from cabinet_admins ca where ca.user_id = chef and ca.role = 'comptable_en_chef'
   order by ca.cabinet_id limit 1;
  if cabinet is null or exists (select 1 from cabinet_admins where user_id = client)
     or exists (select 1 from super_admins where user_id = client) then
    raise exception 'ESSAI_IMPOSSIBLE : le chef de l''essai ou le client d''essai (sans cabinet) manque';
  end if;

  ids := jsonb_build_object('CLIENT', client, 'CHEF', chef, 'CAB', cabinet,
    'DA', 'e7a00000-0000-4000-8000-0000000000a1', 'DF', 'e7a00000-0000-4000-8000-0000000000f1',
    'DV', 'e7a00000-0000-4000-8000-0000000000b1', 'ACCES', 'e7a00000-0000-4000-8000-0000000000c1',
    'JOUR', to_char(jour, 'YYYY-MM-DD'),
    -- Une autoliquidation conforme : un service à une entreprise allemande, au taux 0.
    'BASE', jsonb_build_object('type', 'facture', 'tiers_nom', 'ESSAI E7A CLIENT', 'tiers_adresse', '1 Hauptstrasse, 10115 Berlin',
      'type_client', 'etranger', 'nature_operation', 'services', 'date_emission', to_char(jour, 'YYYY-MM-DD'),
      'date_echeance', to_char(jour, 'YYYY-MM-DD'), 'emetteur_nom', 'ESSAI E7A SAS', 'emetteur_siret', '12345678200010',
      'emetteur_adresse', '1 rue de l Essai, 75001 Paris', 'montant_ht', 100, 'montant_tva', 0, 'montant_ttc', 100,
      'mentions_legales', 'Escompte : néant.', 'client_pays', 'DE', 'client_numero_tva', 'DE123456789',
      'regime_international', 'autoliquidation_ue')::text,
    'L0', '[{"designation":"ESSAI E7A","quantite":1,"prix_unitaire_ht":100,"taux_tva":0,"nature":"services"}]',
    'LB', '[{"designation":"ESSAI E7A BIENS","quantite":1,"prix_unitaire_ht":100,"taux_tva":0,"nature":"biens"}]',
    'L20', '[{"designation":"ESSAI E7A TAXEE","quantite":1,"prix_unitaire_ht":100,"taux_tva":20,"nature":"services"}]',
    'LAV', '[{"designation":"ESSAI E7A AVOIR","quantite":-1,"prix_unitaire_ht":100,"taux_tva":0,"nature":"services"}]',
    'LIRE', 'select coalesce(regime_international, ''∅'') || ''|'' || coalesce(client_pays, ''∅'') || ''|'' || coalesce(client_numero_tva, ''∅'') || ''|'' || statut from factures_emises where id = ');

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from factures_emises)),
    ((select count(*) from facture_lignes)), ((select count(*) from facture_numerotation))
  ) as x(n);

  verdicts := verdicts || jsonb_build_object('controle', '00. la migration facture_internationale est en base (son témoin : factures_emises.regime_international)',
    'genre', case when en_base then 'controle' else 'attente' end,
    'observe', case when en_base then 'présente' else 'absente : les contrôles qui la demandent sont en faute' end, 'ok', en_base);

  begin
    for s in select * from (values
      -- (numéro, genre, contrôle, qui, ordre, code attendu ou OK, message ou valeur attendus, clé)

      -- ══ Le jeu ══════════
      ('j1', 'jeu', 'dossiers jetables A (redevable), F (franchise sans numéro attribué) et V (basculé)', 'proprietaire',
        $q$insert into dossiers (id, nom, cabinet_id, siret, adresse, statut_tva, assujetti_tva, article_exoneration, numero_tva_attribue,
             ventes_par_les_factures, forme_juridique, denomination_imprimee) values
          ('{DA}', 'ESSAI E7A A', '{CAB}', '12345678200010', '1 rue de l''Essai, 75001 Paris', 'redevable', true, null, false, false, '5710', 'ESSAI E7A SAS'),
          ('{DF}', 'ESSAI E7A F', '{CAB}', '12345678200010', '2 rue de l''Essai, 75001 Paris', 'franchise', false, null, false, false, '5710', 'ESSAI E7A FRANCHISE SAS'),
          ('{DV}', 'ESSAI E7A V', '{CAB}', '12345678200010', '3 rue de la Paix, 75001 Paris', 'redevable', true, null, false, true, '5710', 'ESSAI E7A VENTES SAS')
          returning id::text$q$, 'OK', null, null),
      ('j2', 'jeu', 'l''accès « Ventes » du client d''essai au dossier V', 'proprietaire',
        $q$insert into memberships (id, user_id, dossier_id, role, email, droit_ventes) values ('{ACCES}', '{CLIENT}', '{DV}', 'client', 'essai-e7a@example.test', true) returning id::text$q$, 'OK', null, null),

      -- ══ 0. Le catalogue ══════════
      ('01', 'controle', 'les trois colonnes : des textes nullables', 'proprietaire',
        $q$select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by column_name) from information_schema.columns
            where table_schema = 'public' and table_name = 'factures_emises' and column_name in ('client_pays', 'client_numero_tva', 'regime_international')$q$,
        'OK', 'client_numero_tva:text:YES,client_pays:text:YES,regime_international:text:YES', null),
      ('02', 'controle', 'leurs trois contraintes de forme', 'proprietaire',
        $q$select count(*)::text from pg_constraint where conrelid = 'public.factures_emises'::regclass and contype = 'c'
            and conname in ('factures_emises_client_pays_check', 'factures_emises_client_numero_tva_check', 'factures_emises_regime_international_check')$q$,
        'OK', '3', null),
      ('03', 'controle', 'enregistrer_facture : les connectés l''exécutent, ni l''anonyme ni PUBLIC ; la garde, personne', 'proprietaire',
        $q$select has_function_privilege('anon', 'public.enregistrer_facture(uuid, uuid, jsonb, jsonb, boolean)', 'execute')::text
            || '|' || has_function_privilege('authenticated', 'public.enregistrer_facture(uuid, uuid, jsonb, jsonb, boolean)', 'execute')::text
            || '|' || has_function_privilege('authenticated', 'public.garder_factures_validees()', 'execute')::text$q$,
        'OK', 'false|true|false', null),

      -- ══ 1. Les formes (23514) ══════════
      ('10', 'controle', 'un client « établi hors de France » en France : refusé', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{BASE}'::jsonb || '{"client_pays":"FR"}'::jsonb, '{L0}'::jsonb, false) f$q$,
        '23514', '%factures_emises_client_pays_check%', null),
      ('11', 'controle', 'un pays en minuscules : refusé', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{BASE}'::jsonb || '{"client_pays":"de"}'::jsonb, '{L0}'::jsonb, false) f$q$,
        '23514', '%factures_emises_client_pays_check%', null),
      ('12', 'controle', 'un numéro de TVA qui porte un blanc : refusé', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{BASE}'::jsonb || '{"client_numero_tva":"DE 123456789"}'::jsonb, '{L0}'::jsonb, false) f$q$,
        '23514', '%factures_emises_client_numero_tva_check%', null),
      ('13', 'controle', 'un régime inconnu : refusé', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{BASE}'::jsonb || '{"regime_international":"autre"}'::jsonb, '{L0}'::jsonb, false) f$q$,
        '23514', '%factures_emises_regime_international_check%', null),

      -- ══ 2. Le brouillon ══════════
      ('20', 'controle', 'le brouillon écrit les trois colonnes', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{BASE}'::jsonb, '{L0}'::jsonb, false) f ;; {LIRE} '{RENDU}'$q$,
        'OK', 'autoliquidation_ue|DE|DE123456789|brouillon', null),
      ('f1', 'fait', 'BR : un brouillon de A qui les porte', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{BASE}'::jsonb, '{L0}'::jsonb, false) f$q$, 'OK', null, 'BR'),
      ('21', 'controle', 'BR réécrit sans les trois clés : elles restent', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', '{BR}', ('{BASE}'::jsonb - 'client_pays' - 'client_numero_tva' - 'regime_international') || '{"tiers_nom":"ESSAI E7A AUTRE"}'::jsonb, '{L0}'::jsonb, false) f ;; {LIRE} '{RENDU}'$q$,
        'OK', 'autoliquidation_ue|DE|DE123456789|brouillon', null),
      ('22', 'controle', 'BR réécrit avec les trois clés vides : effacées', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', '{BR}', '{BASE}'::jsonb || '{"client_pays":"","client_numero_tva":"","regime_international":""}'::jsonb, '{L0}'::jsonb, false) f ;; {LIRE} '{RENDU}'$q$,
        'OK', '∅|∅|∅|brouillon', null),
      ('23', 'controle', 'un IBAN belge dans le numéro de TVA du client : refusé dès le brouillon', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{BASE}'::jsonb || '{"client_pays":"BE","client_numero_tva":"BE71096123456769"}'::jsonb, '{L0}'::jsonb, false) f$q$,
        '22023', 'Un IBAN figure dans le numéro de TVA du client : %', null),
      ('M23', 'mutation', 'le contrôle 23 avec un numéro de TVA belge : il s''écrit', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{BASE}'::jsonb || '{"client_pays":"BE","client_numero_tva":"BE0123456749"}'::jsonb, '{L0}'::jsonb, false) f ;; {LIRE} '{RENDU}'$q$,
        'OK', 'autoliquidation_ue|BE|BE0123456749|brouillon', null),

      -- ══ 3. La validation : l'autoliquidation conforme, puis figée ══════════
      ('30', 'controle', 'une autoliquidation conforme se valide', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{BASE}'::jsonb, '{L0}'::jsonb, true) f ;; {LIRE} '{RENDU}'$q$,
        'OK', 'autoliquidation_ue|DE|DE123456789|validee', null),
      ('f2', 'fait', 'FV : une autoliquidation validée de A', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{BASE}'::jsonb, '{L0}'::jsonb, true) f$q$, 'OK', null, 'FV'),
      ('31', 'controle', 'FV validée : son pays ne se modifie plus', 'chef',
        $q$update factures_emises set client_pays = 'AT' where id = '{FV}' returning id::text$q$,
        '23514', 'La facture % est validée : elle ne se modifie plus%', null),

      -- ══ 4. Les quinze refus du bloc E7A, et ce qui passe à côté ══════════
      ('32', 'controle', 'un régime sans pays', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{BASE}'::jsonb || '{"client_pays":""}'::jsonb, '{L0}'::jsonb, true) f$q$,
        '22023', 'Le pays où le client est établi manque : le régime de l''opération et le numéro de TVA du client se portent avec lui.', null),
      ('33', 'controle', 'un pays qui n''est pas attribué', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{BASE}'::jsonb || '{"client_pays":"XX","client_numero_tva":"XX123456789"}'::jsonb, '{L0}'::jsonb, true) f$q$,
        '22023', 'Le pays du client, « XX », n''est pas un code de pays attribué (ISO 3166-1, deux lettres).', null),
      ('34', 'controle', 'un pays sans régime', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{BASE}'::jsonb || '{"regime_international":""}'::jsonb, '{L0}'::jsonb, true) f$q$,
        '22023', 'Le client est établi hors de France (DE) : la facture dit le régime de l''opération, d''où vient la mention de TVA qu''elle imprime.', null),
      ('35', 'controle', 'un pays étranger sur une entreprise établie en France', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{BASE}'::jsonb || '{"type_client":"assujetti"}'::jsonb, '{L0}'::jsonb, true) f$q$,
        '22023', 'Un client établi hors de France est une entreprise établie hors de France ou un particulier : la facture le dit par le type de son client.', null),
      ('36', 'controle', 'le hors champ du 259 B à une entreprise', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{BASE}'::jsonb || '{"client_pays":"US","client_numero_tva":"","regime_international":"hors_champ"}'::jsonb, '{L0}'::jsonb, true) f$q$,
        '22023', 'Le hors champ de l''art. 259 B du CGI ne vise qu''un client non assujetti : %', null),
      ('M36', 'mutation', 'le contrôle 36 pour un particulier : il se valide', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{BASE}'::jsonb || '{"type_client":"non_assujetti","client_pays":"US","client_numero_tva":"","regime_international":"hors_champ"}'::jsonb, '{L0}'::jsonb, true) f ;; {LIRE} '{RENDU}'$q$,
        'OK', 'hors_champ|US|∅|validee', null),
      ('37', 'controle', 'une autoliquidation à un particulier', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{BASE}'::jsonb || '{"type_client":"non_assujetti"}'::jsonb, '{L0}'::jsonb, true) f$q$,
        '22023', 'La facture porte une autoliquidation par le client, qui ne se facture qu''à une entreprise (un assujetti), jamais à un particulier.', null),
      ('38', 'controle', 'une autoliquidation hors de l''Union', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{BASE}'::jsonb || '{"client_pays":"US","client_numero_tva":"US123456"}'::jsonb, '{L0}'::jsonb, true) f$q$,
        '22023', 'La facture porte une autoliquidation par le client, qui vise un client établi dans un autre État membre de l''Union : « US » n''en est pas un.', null),
      ('M38', 'mutation', 'le contrôle 38 en prestation hors de l''Union : il se valide', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{BASE}'::jsonb || '{"client_pays":"US","client_numero_tva":"US123456","regime_international":"prestation_hors_ue"}'::jsonb, '{L0}'::jsonb, true) f ;; {LIRE} '{RENDU}'$q$,
        'OK', 'prestation_hors_ue|US|US123456|validee', null),
      ('39', 'controle', 'une exportation vers un État membre', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{BASE}'::jsonb || '{"regime_international":"exportation","nature_operation":"biens"}'::jsonb, '{LB}'::jsonb, true) f$q$,
        '22023', 'La facture porte une exportation, qui vise un client établi hors de l''Union : « DE » en est un État membre.', null),
      ('M39', 'mutation', 'le contrôle 39 vers la Suisse : il se valide', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{BASE}'::jsonb || '{"regime_international":"exportation","nature_operation":"biens","client_pays":"CH","client_numero_tva":"CHE123456789MWST"}'::jsonb, '{LB}'::jsonb, true) f ;; {LIRE} '{RENDU}'$q$,
        'OK', 'exportation|CH|CHE123456789MWST|validee', null),
      ('40', 'controle', 'une livraison intracommunautaire de services', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{BASE}'::jsonb || '{"regime_international":"livraison_intracommunautaire"}'::jsonb, '{L0}'::jsonb, true) f$q$,
        '22023', 'La facture porte une livraison intracommunautaire, une livraison de biens : sa nature est « biens ».', null),
      ('M40', 'mutation', 'le contrôle 40 en biens : il se valide', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{BASE}'::jsonb || '{"regime_international":"livraison_intracommunautaire","nature_operation":"biens"}'::jsonb, '{LB}'::jsonb, true) f ;; {LIRE} '{RENDU}'$q$,
        'OK', 'livraison_intracommunautaire|DE|DE123456789|validee', null),
      ('41', 'controle', 'une autoliquidation de biens', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{BASE}'::jsonb || '{"nature_operation":"biens"}'::jsonb, '{LB}'::jsonb, true) f$q$,
        '22023', 'La facture porte une autoliquidation par le client, une prestation de services : sa nature est « services ».', null),
      ('42', 'controle', 'une autoliquidation sans le numéro de TVA du client', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{BASE}'::jsonb || '{"client_numero_tva":""}'::jsonb, '{L0}'::jsonb, true) f$q$,
        '22023', 'La facture porte une autoliquidation par le client, qui exige le numéro de TVA du client (CGI, ann. II, art. 242 nonies A, I, 3° et 4°).', null),
      ('43', 'controle', 'un numéro de TVA qui n''est pas du pays du client', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{BASE}'::jsonb || '{"client_numero_tva":"FR12345678901"}'::jsonb, '{L0}'::jsonb, true) f$q$,
        '22023', 'Le numéro de TVA du client, « FR12345678901 », commence par le code de son pays, « DE » (norme EN 16931, règle BR-CO-09).', null),
      ('44', 'controle', 'un client grec dont le numéro commence par GR', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{BASE}'::jsonb || '{"client_pays":"GR","client_numero_tva":"GR123456789"}'::jsonb, '{L0}'::jsonb, true) f$q$,
        '22023', 'Le numéro de TVA du client, « GR123456789 », commence par le code de son pays, « EL » (norme EN 16931, règle BR-CO-09).', null),
      ('M44', 'mutation', 'le contrôle 44 sous EL : il se valide', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{BASE}'::jsonb || '{"client_pays":"GR","client_numero_tva":"EL123456789"}'::jsonb, '{L0}'::jsonb, true) f ;; {LIRE} '{RENDU}'$q$,
        'OK', 'autoliquidation_ue|GR|EL123456789|validee', null),
      ('45', 'controle', 'un numéro de l''Union de treize caractères après son préfixe', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{BASE}'::jsonb || '{"client_numero_tva":"DE1234567890123"}'::jsonb, '{L0}'::jsonb, true) f$q$,
        '22023', 'Le numéro de TVA d''un client de l''Union tient en deux lettres suivies de deux à douze chiffres ou lettres : « DE1234567890123 » n''en a pas la forme.', null),
      ('46', 'controle', 'une autoliquidation d''un franchisé sans numéro attribué', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DF}', null, '{BASE}'::jsonb || '{"emetteur_nom":"ESSAI E7A FRANCHISE SAS"}'::jsonb, '{L0}'::jsonb, true) f$q$,
        '22023', 'La facture porte une autoliquidation par le client, qui exige le numéro de TVA du vendeur (CGI, ann. II, art. 242 nonies A, I, 3° et 4°) : ce dossier n''en imprime aucun.%', null),
      ('M46', 'mutation', 'le contrôle 46, le numéro attribué coché : il se valide', 'chef',
        $q$update dossiers set numero_tva_attribue = true where id = '{DF}' returning id::text ;; select f.facture_id::text from enregistrer_facture('{DF}', null, '{BASE}'::jsonb || '{"emetteur_nom":"ESSAI E7A FRANCHISE SAS"}'::jsonb, '{L0}'::jsonb, true) f$q$,
        'OK', null, null),
      ('47', 'controle', 'une autoliquidation dont une ligne est taxée', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{BASE}'::jsonb || '{"montant_tva":20,"montant_ttc":120}'::jsonb, '{L20}'::jsonb, true) f$q$,
        '22023', 'La facture porte une autoliquidation par le client, que la TVA française ne taxe pas : chaque ligne est au taux 0.', null),
      ('48', 'controle', 'une autoliquidation dont une ligne est taxée, sa TVA enregistrée nulle : la ligne suffit', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{BASE}'::jsonb, '{L20}'::jsonb, true) f$q$,
        '22023', 'La facture porte une autoliquidation par le client, que la TVA française ne taxe pas : chaque ligne est au taux 0.', null),

      -- ══ 5. La mention de TVA du dossier, selon le régime ══════════
      ('f3', 'fait', 'F : le numéro attribué coché', 'chef',
        $q$update dossiers set numero_tva_attribue = true where id = '{DF}' returning id::text$q$, 'OK', null, null),
      ('50', 'controle', 'une autoliquidation d''un franchisé qui porte la mention de la franchise', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DF}', null, '{BASE}'::jsonb || '{"mentions_legales":"TVA non applicable, art. 293 B du CGI."}'::jsonb, '{L0}'::jsonb, true) f$q$,
        '22023', 'Les mentions légales portent « TVA non applicable, art. 293 B du CGI. », la mention de TVA du dossier : elle ne vaut que pour une opération que la TVA française taxe, et la facture porte une autoliquidation par le client, qui imprime la sienne.', null),
      ('51', 'controle', 'la même sans la mention de la franchise : elle se valide', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DF}', null, '{BASE}'::jsonb, '{L0}'::jsonb, true) f ;; {LIRE} '{RENDU}'$q$,
        'OK', 'autoliquidation_ue|DE|DE123456789|validee', null),
      ('52', 'controle', 'une opération taxable en France d''un franchisé, sans la mention de la franchise : refusée comme hier', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DF}', null, '{BASE}'::jsonb || '{"regime_international":"taxable_en_france","client_numero_tva":""}'::jsonb, '{L0}'::jsonb, true) f$q$,
        '22023', 'Les mentions légales ne portent pas la mention de TVA du dossier, « TVA non applicable, art. 293 B du CGI. »%', null),
      ('M52', 'mutation', 'le contrôle 52 avec la mention : il se valide', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DF}', null, '{BASE}'::jsonb || '{"regime_international":"taxable_en_france","client_numero_tva":"","mentions_legales":"TVA non applicable, art. 293 B du CGI."}'::jsonb, '{L0}'::jsonb, true) f ;; {LIRE} '{RENDU}'$q$,
        'OK', 'taxable_en_france|DE|∅|validee', null),
      ('53', 'controle', 'une facture d''avant (un client établi hors de France, aucune des trois colonnes) se valide comme hier', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{BASE}'::jsonb - 'client_pays' - 'client_numero_tva' - 'regime_international', '{L0}'::jsonb, true) f ;; {LIRE} '{RENDU}'$q$,
        'OK', '∅|∅|∅|validee', null),

      -- ══ 6. L'avoir ══════════
      ('60', 'controle', 'l''avoir de FV reprend ses trois colonnes', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{"type":"avoir","facture_origine_id":"{FV}","date_emission":"{JOUR}","montant_ht":-100,"montant_tva":0,"montant_ttc":-100,"mentions_legales":"Avoir"}'::jsonb, '{LAV}'::jsonb, true) f ;; {LIRE} '{RENDU}'$q$,
        'OK', 'autoliquidation_ue|DE|DE123456789|validee', null),
      ('f4', 'fait', 'FVF : une autoliquidation validée de F', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DF}', null, '{BASE}'::jsonb, '{L0}'::jsonb, true) f$q$, 'OK', null, 'FVF'),
      ('61', 'controle', 'l''avoir de FVF qui porte la mention de la franchise : refusé', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DF}', null, '{"type":"avoir","facture_origine_id":"{FVF}","date_emission":"{JOUR}","montant_ht":-100,"montant_tva":0,"montant_ttc":-100,"mentions_legales":"TVA non applicable, art. 293 B du CGI."}'::jsonb, '{LAV}'::jsonb, true) f$q$,
        '22023', 'Les mentions légales portent « TVA non applicable, art. 293 B du CGI. », la mention de TVA du dossier : %', null),
      ('M61', 'mutation', 'le contrôle 61 sans la mention : il se valide', 'chef',
        $q$select f.facture_id::text from enregistrer_facture('{DF}', null, '{"type":"avoir","facture_origine_id":"{FVF}","date_emission":"{JOUR}","montant_ht":-100,"montant_tva":0,"montant_ttc":-100,"mentions_legales":"Avoir"}'::jsonb, '{LAV}'::jsonb, true) f ;; {LIRE} '{RENDU}'$q$,
        'OK', 'autoliquidation_ue|DE|DE123456789|validee', null),

      -- ══ 7. Le client « Ventes » ══════════
      ('70', 'controle', 'le client « Ventes » écrit les trois colonnes sur un brouillon', 'client',
        $q$select f.facture_id::text from enregistrer_facture('{DV}', null, '{BASE}'::jsonb || '{"emetteur_nom":"ESSAI E7A VENTES SAS","emetteur_adresse":"3 rue de la Paix, 75001 Paris"}'::jsonb, '{L0}'::jsonb, false) f ;; {LIRE} '{RENDU}'$q$,
        'OK', 'autoliquidation_ue|DE|DE123456789|brouillon', null),
      ('71', 'controle', 'le client « Ventes » : une autoliquidation sans le numéro du client, refusée', 'client',
        $q$select f.facture_id::text from enregistrer_facture('{DV}', null, '{BASE}'::jsonb || '{"emetteur_nom":"ESSAI E7A VENTES SAS","emetteur_adresse":"3 rue de la Paix, 75001 Paris","client_numero_tva":""}'::jsonb, '{L0}'::jsonb, true) f$q$,
        '22023', 'La facture porte une autoliquidation par le client, qui exige le numéro de TVA du client %', null),
      ('M71', 'mutation', 'le contrôle 71 avec le numéro : il se valide', 'client',
        $q$select f.facture_id::text from enregistrer_facture('{DV}', null, '{BASE}'::jsonb || '{"emetteur_nom":"ESSAI E7A VENTES SAS","emetteur_adresse":"3 rue de la Paix, 75001 Paris"}'::jsonb, '{L0}'::jsonb, true) f ;; {LIRE} '{RENDU}'$q$,
        'OK', 'autoliquidation_ue|DE|DE123456789|validee', null)
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
  perform set_config('essai.facture_internationale', verdicts::text, true);
end
$essai$;

select v.genre, v.controle, case when v.genre = 'attente' then '*** EN ATTENTE ***'
                                 when v.genre = 'mutation' then case when v.ok then 'mord' else '*** NE MORD PAS ***' end
                                 else case when v.ok then 'ok' else '*** EN FAUTE ***' end end as verdict, v.observe
from jsonb_to_recordset(current_setting('essai.facture_internationale')::jsonb) as v(controle text, genre text, ok boolean, observe text)
order by v.genre desc, v.controle collate "C";
