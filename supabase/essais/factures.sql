-- LES FACTURES ÉMISES, ÉPROUVÉES EN BASE — à rejouer par `execute_sql` après toute migration qui touche
-- `enregistrer_facture`, la numérotation des factures ou les contraintes de `factures_emises` (ligne 28.5 de la
-- feuille de route, étape c).
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - QUI enregistre : un anonyme n'a pas le droit d'appeler ; un compte rattaché à rien et un client — sur le dossier
--     d'un autre comme sur le SIEN — se font refuser ; le chef du cabinet enregistre (le contrôle POSITIF), et pas
--     seulement parce qu'il est aussi super-administrateur sur ce projet : le client, fait chef d'un cabinet jetable le
--     temps de l'essai, facture et crédite dans un dossier de ce cabinet-là ;
--   - LES MENTIONS de la facture électronique (client, SIREN, adresse électronique, organisme public, catégorie de
--     l'opération, date ou période de la prestation, adresse de livraison) : enregistrées, gardées quand le document
--     reçu ne les porte pas — une fenêtre ouverte avant le nouvel écran ne les efface pas —, effacées quand il les porte
--     vides, et chaque forme fausse refusée par sa contrainte, avec son NOM ;
--   - L'OPTION POUR LES DÉBITS figée à la validation : celle d'un dossier redevable, jamais celle d'un dossier en
--     franchise, et gardée par la facture quand le dossier y renonce ensuite ; le réglage qui annonce la validation
--     est retiré aussitôt ;
--   - L'AVOIR d'un seul tenant : refusé sans validation, sur une facture d'un autre dossier, sur un brouillon, sur un
--     avoir, à quantité positive, à total positif, daté avant sa facture et au-delà de ce qu'elle porte encore — le
--     reste dit en euros ; accepté sinon, numéroté dans la série « A », les parties et l'opération reprises de sa
--     facture et non de l'appelant, ses lignes négatives ;
--   - et que RIEN ne reste en base après l'essai.
--
-- Tout se joue dans des dossiers JETABLES, créés dans le cabinet du dossier `test` (et un cabinet jetable), au sein
-- d'un bloc qui s'annule entièrement à la fin (`ANNULATION_ESSAI_GLOBALE`), sur le harnais de validationExercice.sql :
-- chaque contrôle dans sa sous-transaction, annulée elle aussi (`ANNULATION_ESSAI`, P0001), le verdict posé dans une
-- VARIABLE avant ; les étapes « fait » sont gardées jusqu'à l'annulation finale. Un refus se juge à son code ET à son
-- message. Les verdicts voyagent dans un réglage LOCAL à la transaction (`essai.factures`) : le fichier se joue d'un seul
-- appel, ne crée aucune table et ne contient aucune instruction de suppression. Hors de l'outil d'exécution, il se joue
-- en UNE transaction (`psql -1`).
--
-- Les factures que crée la fonction ont des identifiants qu'on ne choisit pas : une étape les retrouve par leur dossier
-- et leur numéro, ou par le nom de leur client (« ESSAI … »).
do $essai$
declare
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  inconnu uuid := gen_random_uuid();
  dossier_test uuid := '001c7ed7-c23b-4590-901e-693489f8af24';
  dossier_client uuid; cabinet uuid;
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
     or exists (select 1 from cabinet_admins where user_id = client)
     or not exists (select 1 from super_admins where user_id = chef) then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable';
  end if;

  ids := jsonb_build_object('CAB', cabinet, 'DC', dossier_client, 'CLIENT', client,
    'A', 'e55a2000-0000-4000-8000-0000000000a1', 'B', 'e55a2000-0000-4000-8000-0000000000a2',
    'X', 'e55a2000-0000-4000-8000-0000000000a3', 'CJ', 'e55a2000-0000-4000-8000-0000000000c1',
    'J1', 'e55a2000-0000-4000-8000-0000000000c2');

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from cabinets)), ((select count(*) from cabinet_admins)),
    ((select count(*) from factures_emises)), ((select count(*) from facture_lignes)), ((select count(*) from facture_numerotation))
  ) as t(n);

  -- Une étape : {genre, contrôle, qui, requête, code attendu, message attendu (motif LIKE) ou valeur attendue}.
  --   jeu     : posée par le propriétaire de la base, gardée ; un échec est une faute de l'essai lui-même ;
  --   controle: jouée sous « qui », puis annulée ; « OK » attend qu'elle passe ;
  --   fait    : jouée sous « qui » et GARDÉE jusqu'à l'annulation finale ;
  --   valeur  : une lecture par le propriétaire, qui doit rendre exactement la valeur attendue.
  etapes := array[
    -- ══ Le jeu : des dossiers jetables ════════════════════════════════════════════════════════════════════════════════
    -- A est redevable et a opté pour les débits, B est en franchise (une option sans objet), X sert de dossier voisin.
    array['jeu', 'dossiers jetables', 'postgres', $q$insert into dossiers (id, nom, cabinet_id, statut_tva, assujetti_tva, tva_sur_debits) values
      ('{A}', 'ESSAI FACTURES A', '{CAB}', 'redevable', true, true), ('{B}', 'ESSAI FACTURES B', '{CAB}', 'franchise', false, true),
      ('{X}', 'ESSAI FACTURES X', '{CAB}', 'redevable', true, false)$q$, '', ''],
    array['jeu', 'cabinet jetable', 'postgres', $q$insert into cabinets (id, nom) values ('{CJ}', 'ESSAI FACTURES CABINET')$q$, '', ''],
    array['jeu', 'son dossier', 'postgres', $q$insert into dossiers (id, nom, cabinet_id) values ('{J1}', 'ESSAI FACTURES J1', '{CJ}')$q$, '', ''],

    -- ══ Qui enregistre ════════════════════════════════════════════════════════════════════════════════════════════════
    array['controle', '1. anonyme : pas le droit d''appeler', 'anon', $q$select enregistrer_facture('{A}', null, '{"tiers_nom":"ESSAI"}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":1,"taux_tva":0}]'::jsonb, false)$q$, '42501', 'permission denied%'],
    array['controle', '2. rattaché à rien', 'inconnu', $q$select enregistrer_facture('{A}', null, '{"tiers_nom":"ESSAI"}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":1,"taux_tva":0}]'::jsonb, false)$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '3. client, le dossier d''un autre', 'client', $q$select enregistrer_facture('{A}', null, '{"tiers_nom":"ESSAI"}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":1,"taux_tva":0}]'::jsonb, false)$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '4. client, son propre dossier', 'client', $q$select enregistrer_facture('{DC}', null, '{"tiers_nom":"ESSAI"}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":1,"taux_tva":0}]'::jsonb, false)$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '4b. le client n''insère pas de facture en direct', 'client', $q$insert into factures_emises (dossier_id, tiers_nom) values ('{DC}', 'ESSAI DIRECT')$q$, '42501', 'new row violates row-level security policy%'],
    array['controle', '5. un type de document inconnu', 'chef', $q$select enregistrer_facture('{A}', null, '{"tiers_nom":"ESSAI","type":"devis"}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":1,"taux_tva":0}]'::jsonb, false)$q$, '22023', 'Type de document inconnu : devis.'],

    -- ══ Les mentions ══════════════════════════════════════════════════════════════════════════════════════════════════
    array['fait', '6. le chef enregistre un brouillon qui porte les mentions', 'chef', $q$select enregistrer_facture('{A}', null, '{"tiers_nom":"ESSAI CLIENT","tiers_siret":"12345678900012","date_emission":"2026-03-01","montant_ht":100,"montant_tva":20,"montant_ttc":120,"type_client":"assujetti","tiers_siren":"123456789","tiers_adresse_electronique":"123456789","nature_operation":"services","date_prestation":"2026-02-20"}'::jsonb, '[{"designation":"Prestation","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$, 'OK', ''],
    array['valeur', '7. … elles sont enregistrées, sans option figée', 'postgres', $q$select concat_ws('|', type_client, tiers_siren, tiers_adresse_electronique, nature_operation, date_prestation, statut, coalesce(option_debits::text, '∅')) from factures_emises where dossier_id = '{A}' and tiers_nom = 'ESSAI CLIENT'$q$, '', 'assujetti|123456789|123456789|services|2026-02-20|brouillon|∅'],
    array['fait', '8. une fenêtre d''avant enregistre le brouillon sans les mentions', 'chef', $q$select enregistrer_facture('{A}', (select id from factures_emises where dossier_id = '{A}' and tiers_nom = 'ESSAI CLIENT'), '{"tiers_nom":"ESSAI CLIENT","tiers_siret":"12345678900012","date_emission":"2026-03-01","montant_ht":200,"montant_tva":40,"montant_ttc":240}'::jsonb, '[{"designation":"Prestation","quantite":2,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$, 'OK', ''],
    array['valeur', '9. … elle ne les efface pas, et le reste suit', 'postgres', $q$select concat_ws('|', type_client, tiers_siren, tiers_adresse_electronique, nature_operation, date_prestation, montant_ttc, (select count(*) from facture_lignes l where l.facture_id = f.id)) from factures_emises f where dossier_id = '{A}' and tiers_nom = 'ESSAI CLIENT'$q$, '', 'assujetti|123456789|123456789|services|2026-02-20|240|1'],
    array['fait', '10. une mention portée vide s''efface, une autre se pose', 'chef', $q$select enregistrer_facture('{A}', (select id from factures_emises where dossier_id = '{A}' and tiers_nom = 'ESSAI CLIENT'), '{"tiers_nom":"ESSAI CLIENT","tiers_siret":"12345678900012","date_emission":"2026-03-01","montant_ht":200,"montant_tva":40,"montant_ttc":240,"date_prestation":"","periode_debut":"2026-02-01","periode_fin":"2026-02-28"}'::jsonb, '[{"designation":"Prestation","quantite":2,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$, 'OK', ''],
    array['valeur', '11. … la date de prestation a laissé la place à la période', 'postgres', $q$select concat_ws('|', coalesce(date_prestation::text, '∅'), periode_debut, periode_fin, type_client) from factures_emises where dossier_id = '{A}' and tiers_nom = 'ESSAI CLIENT'$q$, '', '∅|2026-02-01|2026-02-28|assujetti'],
    array['controle', '12. la fonction ne passe pas outre une contrainte', 'chef', $q$select enregistrer_facture('{A}', null, '{"tiers_nom":"ESSAI","tiers_siren":"12345"}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":1,"taux_tva":0}]'::jsonb, false)$q$, '23514', '%"factures_emises_tiers_siren_check"%'],

    -- ══ L'option pour les débits, figée à la validation ═══════════════════════════════════════════════════════════════
    array['fait', '13. le chef valide la facture', 'chef', $q$select enregistrer_facture('{A}', (select id from factures_emises where dossier_id = '{A}' and tiers_nom = 'ESSAI CLIENT'), '{"tiers_nom":"ESSAI CLIENT","tiers_siret":"12345678900012","date_emission":"2026-03-01","emetteur_nom":"ESSAI ÉMETTEUR","montant_ht":200,"montant_tva":40,"montant_ttc":240}'::jsonb, '[{"designation":"Prestation","quantite":2,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, true)$q$, 'OK', ''],
    array['valeur', '14. … numérotée, validée, l''option du dossier redevable figée', 'postgres', $q$select concat_ws('|', numero, statut, option_debits, validated_at is not null) from factures_emises where dossier_id = '{A}' and tiers_nom = 'ESSAI CLIENT'$q$, '', 'F2026-0001|validee|t|t'],
    array['valeur', '15. le réglage qui annonce la validation est retiré aussitôt', 'postgres', $q$select coalesce(nullif(current_setting('jd.validation_facture', true), ''), '∅')$q$, '', '∅'],
    array['jeu', 'le dossier A renonce à l''option', 'postgres', $q$update dossiers set tva_sur_debits = false where id = '{A}'$q$, '', ''],
    array['valeur', '16. la facture validée garde l''option qu''elle a figée', 'postgres', $q$select option_debits::text from factures_emises where dossier_id = '{A}' and numero = 'F2026-0001'$q$, '', 'true'],
    array['fait', '17. un dossier en franchise valide une facture sans les mentions', 'chef', $q$select enregistrer_facture('{B}', null, '{"tiers_nom":"ESSAI B","date_emission":"2026-03-02","montant_ht":50,"montant_tva":0,"montant_ttc":50}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":50,"taux_tva":0}]'::jsonb, true)$q$, 'OK', ''],
    array['valeur', '18. … l''option ne s''y fige pas, et les mentions restent à préciser', 'postgres', $q$select concat_ws('|', numero, option_debits, coalesce(type_client, '∅'), coalesce(nature_operation, '∅')) from factures_emises where dossier_id = '{B}'$q$, '', 'F2026-0001|f|∅|∅'],
    array['controle', '19. une option ne se pose pas sur un brouillon', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, option_debits) values ('{A}', 'ESSAI CONTRAINTE', true)$q$, '23514', '%"factures_emises_option_debits_validee"%'],

    -- ══ Ce que les contraintes refusent seules ════════════════════════════════════════════════════════════════════════
    array['controle', '20. un client d''un type inconnu', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, type_client) values ('{A}', 'ESSAI CONTRAINTE', 'entreprise')$q$, '23514', '%"factures_emises_type_client_check"%'],
    array['controle', '21. un SIREN de huit chiffres', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, tiers_siren) values ('{A}', 'ESSAI CONTRAINTE', '12345678')$q$, '23514', '%"factures_emises_tiers_siren_check"%'],
    array['controle', '22. le SIRET d''un autre SIREN', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, tiers_siren, tiers_siret) values ('{A}', 'ESSAI CONTRAINTE', '123456789', '98765432100011')$q$, '23514', '%"factures_emises_siret_du_siren"%'],
    array['controle', '23. un SIRET illisible à côté d''un SIREN', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, tiers_siren, tiers_siret) values ('{A}', 'ESSAI CONTRAINTE', '123456789', '123 456 789 00012')$q$, '23514', '%"factures_emises_siret_du_siren"%'],
    array['controle', '24. une adresse électronique mal formée', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, type_client, tiers_adresse_electronique) values ('{A}', 'ESSAI CONTRAINTE', 'assujetti', 'FR123456789')$q$, '23514', '%"factures_emises_adresse_electronique_check"%'],
    array['controle', '25. un identifiant de routage de 101 caractères', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, type_client, tiers_adresse_electronique) values ('{A}', 'ESSAI CONTRAINTE', 'assujetti', '123456789_12345678900012_' || repeat('R', 101))$q$, '23514', '%"factures_emises_adresse_electronique_check"%'],
    array['controle', '25b. un suffixe de 101 caractères', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, type_client, tiers_adresse_electronique) values ('{A}', 'ESSAI CONTRAINTE', 'assujetti', '123456789_' || repeat('s', 101))$q$, '23514', '%"factures_emises_adresse_electronique_check"%'],
    array['controle', '26. une adresse électronique pour un particulier', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, type_client, tiers_adresse_electronique) values ('{A}', 'ESSAI CONTRAINTE', 'non_assujetti', '123456789')$q$, '23514', '%"factures_emises_adresse_electronique_routee"%'],
    array['controle', '26b. une adresse électronique sans client', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, tiers_adresse_electronique) values ('{A}', 'ESSAI CONTRAINTE', '123456789')$q$, '23514', '%"factures_emises_adresse_electronique_routee"%'],
    array['controle', '27. un code service pour un client qui n''est pas un organisme public', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, type_client, code_service) values ('{A}', 'ESSAI CONTRAINTE', 'assujetti', 'SERVICE')$q$, '23514', '%"factures_emises_organisme_public"%'],
    array['controle', '28. un numéro d''engagement sans client', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, numero_engagement) values ('{A}', 'ESSAI CONTRAINTE', 'EJ-1')$q$, '23514', '%"factures_emises_organisme_public"%'],
    array['controle', '29. un code service de 101 caractères', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, type_client, code_service) values ('{A}', 'ESSAI CONTRAINTE', 'organisme_public', repeat('S', 101))$q$, '23514', '%"factures_emises_code_service_check"%'],
    array['controle', '30. un code service blanc', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, type_client, code_service) values ('{A}', 'ESSAI CONTRAINTE', 'organisme_public', '   ')$q$, '23514', '%"factures_emises_code_service_check"%'],
    array['controle', '31. un numéro d''engagement de 51 caractères', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, type_client, numero_engagement) values ('{A}', 'ESSAI CONTRAINTE', 'organisme_public', repeat('E', 51))$q$, '23514', '%"factures_emises_numero_engagement_check"%'],
    array['controle', '32. une catégorie d''opération inconnue', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, nature_operation) values ('{A}', 'ESSAI CONTRAINTE', 'location')$q$, '23514', '%"factures_emises_nature_operation_check"%'],
    array['controle', '33. une période sans fin', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, periode_debut) values ('{A}', 'ESSAI CONTRAINTE', '2026-01-01')$q$, '23514', '%"factures_emises_periode_complete"%'],
    array['controle', '34. une période à l''envers', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, periode_debut, periode_fin) values ('{A}', 'ESSAI CONTRAINTE', '2026-02-01', '2026-01-31')$q$, '23514', '%"factures_emises_periode_ordonnee"%'],
    array['controle', '35. une date de prestation et une période', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, date_prestation, periode_debut, periode_fin) values ('{A}', 'ESSAI CONTRAINTE', '2026-01-15', '2026-01-01', '2026-01-31')$q$, '23514', '%"factures_emises_date_ou_periode"%'],
    array['controle', '36. une adresse de livraison sans pays', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, nature_operation, livraison_adresse, livraison_code_postal, livraison_ville) values ('{A}', 'ESSAI CONTRAINTE', 'biens', '1 rue de l''Essai', '13001', 'Marseille')$q$, '23514', '%"factures_emises_livraison_complete"%'],
    array['controle', '37. un pays en minuscules', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, nature_operation, livraison_adresse, livraison_code_postal, livraison_ville, livraison_pays) values ('{A}', 'ESSAI CONTRAINTE', 'biens', '1 rue de l''Essai', '13001', 'Marseille', 'fr')$q$, '23514', '%"factures_emises_livraison_pays_check"%'],
    array['controle', '38. une ville blanche', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, nature_operation, livraison_adresse, livraison_code_postal, livraison_ville, livraison_pays) values ('{A}', 'ESSAI CONTRAINTE', 'biens', '1 rue de l''Essai', '13001', ' ', 'FR')$q$, '23514', '%"factures_emises_livraison_non_vide"%'],
    array['controle', '39. une livraison sur des services', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, nature_operation, livraison_adresse, livraison_code_postal, livraison_ville, livraison_pays) values ('{A}', 'ESSAI CONTRAINTE', 'services', '1 rue de l''Essai', '13001', 'Marseille', 'FR')$q$, '23514', '%"factures_emises_livraison_de_biens"%'],
    array['controle', '40. une facture à un organisme public, complète', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, type_client, tiers_siren, tiers_siret, tiers_adresse_electronique, code_service, numero_engagement, nature_operation, livraison_adresse, livraison_code_postal, livraison_ville, livraison_pays) values ('{A}', 'ESSAI CONTRAINTE', 'organisme_public', '123456789', '12345678900012', '123456789_12345678900012', 'SERVICE_FACTURATION Éducation', repeat('E', 50), 'mixte', '1 rue de l''Essai', '13001', 'Marseille', 'FR')$q$, 'OK', ''],
    array['controle', '41. une adresse avec un identifiant de routage de 100 caractères', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, type_client, tiers_adresse_electronique) values ('{A}', 'ESSAI CONTRAINTE', 'assujetti', '123456789_12345678900012_' || repeat('R', 99) || '/')$q$, 'OK', ''],
    array['controle', '42. une adresse avec un suffixe', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, type_client, tiers_adresse_electronique) values ('{A}', 'ESSAI CONTRAINTE', 'assujetti', '123456789_compta.achats@x')$q$, 'OK', ''],

    -- ══ L'avoir, d'un seul tenant ═════════════════════════════════════════════════════════════════════════════════════
    array['fait', 'un brouillon dans A', 'chef', $q$select enregistrer_facture('{A}', null, '{"tiers_nom":"ESSAI BROUILLON","date_emission":"2026-03-05","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false)$q$, 'OK', ''],
    array['controle', '43. un avoir sans validation', 'chef', $q$select enregistrer_facture('{A}', null, jsonb_build_object('type', 'avoir', 'facture_origine_id', (select id from factures_emises where dossier_id = '{A}' and numero = 'F2026-0001'), 'date_emission', '2026-03-10', 'montant_ht', -50, 'montant_tva', -10, 'montant_ttc', -60), '[{"designation":"Prestation","quantite":-1,"prix_unitaire_ht":50,"taux_tva":20}]'::jsonb, false)$q$, '22023', 'Un avoir se crée validé : il n''a pas de brouillon.'],
    array['controle', '44. l''avoir d''une facture d''un autre dossier', 'chef', $q$select enregistrer_facture('{A}', null, jsonb_build_object('type', 'avoir', 'facture_origine_id', (select id from factures_emises where dossier_id = '{B}' and numero = 'F2026-0001'), 'date_emission', '2026-03-10', 'montant_ht', -50, 'montant_tva', 0, 'montant_ttc', -50), '[{"designation":"x","quantite":-1,"prix_unitaire_ht":50,"taux_tva":0}]'::jsonb, true)$q$, 'P0002', 'Facture d''origine introuvable dans ce dossier.'],
    array['controle', '45. l''avoir d''un brouillon', 'chef', $q$select enregistrer_facture('{A}', null, jsonb_build_object('type', 'avoir', 'facture_origine_id', (select id from factures_emises where dossier_id = '{A}' and tiers_nom = 'ESSAI BROUILLON'), 'date_emission', '2026-03-10', 'montant_ht', -10, 'montant_tva', -2, 'montant_ttc', -12), '[{"designation":"x","quantite":-1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true)$q$, '22023', 'Un avoir corrige une facture validée, jamais un brouillon ni un autre avoir.'],
    array['controle', '46. un avoir à quantité positive', 'chef', $q$select enregistrer_facture('{A}', null, jsonb_build_object('type', 'avoir', 'facture_origine_id', (select id from factures_emises where dossier_id = '{A}' and numero = 'F2026-0001'), 'date_emission', '2026-03-10', 'montant_ht', -50, 'montant_tva', -10, 'montant_ttc', -60), '[{"designation":"Prestation","quantite":1,"prix_unitaire_ht":-50,"taux_tva":20}]'::jsonb, true)$q$, '22023', 'Les lignes d''un avoir créditent : leurs quantités sont négatives.'],
    array['controle', '47. un avoir au total positif', 'chef', $q$select enregistrer_facture('{A}', null, jsonb_build_object('type', 'avoir', 'facture_origine_id', (select id from factures_emises where dossier_id = '{A}' and numero = 'F2026-0001'), 'date_emission', '2026-03-10', 'montant_ht', 50, 'montant_tva', 10, 'montant_ttc', 60), '[{"designation":"Prestation","quantite":-1,"prix_unitaire_ht":-50,"taux_tva":20}]'::jsonb, true)$q$, '22023', 'Un avoir crédite un montant : son total est négatif.'],
    array['controle', '48. un avoir daté avant sa facture', 'chef', $q$select enregistrer_facture('{A}', null, jsonb_build_object('type', 'avoir', 'facture_origine_id', (select id from factures_emises where dossier_id = '{A}' and numero = 'F2026-0001'), 'date_emission', '2026-02-28', 'montant_ht', -50, 'montant_tva', -10, 'montant_ttc', -60), '[{"designation":"Prestation","quantite":-1,"prix_unitaire_ht":50,"taux_tva":20}]'::jsonb, true)$q$, '22023', 'Un avoir ne précède pas la facture qu''il corrige (émise le 01/03/2026).'],
    array['controle', '49. un avoir plus grand que sa facture', 'chef', $q$select enregistrer_facture('{A}', null, jsonb_build_object('type', 'avoir', 'facture_origine_id', (select id from factures_emises where dossier_id = '{A}' and numero = 'F2026-0001'), 'date_emission', '2026-03-10', 'montant_ht', -250, 'montant_tva', -50, 'montant_ttc', -300), '[{"designation":"Prestation","quantite":-3,"prix_unitaire_ht":83.33,"taux_tva":20}]'::jsonb, true)$q$, '22023', 'Cet avoir créditerait 300,00 € : la facture F2026-0001 n''a plus que 240,00 € à créditer.'],
    array['controle', '50. le client ne crédite pas', 'client', $q$select enregistrer_facture('{A}', null, jsonb_build_object('type', 'avoir', 'facture_origine_id', 'e55a2000-0000-4000-8000-0000000000ff', 'date_emission', '2026-03-10', 'montant_ht', -50, 'montant_tva', -10, 'montant_ttc', -60), '[{"designation":"Prestation","quantite":-1,"prix_unitaire_ht":50,"taux_tva":20}]'::jsonb, true)$q$, '42501', 'Accès refusé à ce dossier.'],
    array['fait', '51. le chef crée un avoir partiel, d''un autre client en apparence', 'chef', $q$select enregistrer_facture('{A}', null, jsonb_build_object('type', 'avoir', 'facture_origine_id', (select id from factures_emises where dossier_id = '{A}' and numero = 'F2026-0001'), 'date_emission', '2026-03-10', 'tiers_nom', 'AUTRE CLIENT', 'tiers_siren', '999999999', 'type_client', 'non_assujetti', 'emetteur_nom', 'AUTRE ÉMETTEUR', 'notes', 'Remise accordée', 'mentions_legales', 'Mentions de l''avoir', 'montant_ht', -83.33, 'montant_tva', -16.67, 'montant_ttc', -100), '[{"designation":"Prestation","quantite":-1,"prix_unitaire_ht":83.33,"taux_tva":20}]'::jsonb, true)$q$, 'OK', ''],
    array['valeur', '52. … numéroté dans la série « A », les parties et l''opération reprises de sa facture', 'postgres', $q$select concat_ws('|', a.numero, a.type, a.statut, a.facture_origine_id = f.id, a.tiers_nom, a.tiers_siren, a.type_client, a.tiers_adresse_electronique, a.periode_debut, a.periode_fin, a.option_debits, a.montant_ttc, a.notes, a.mentions_legales, a.emetteur_nom) from factures_emises a join factures_emises f on f.dossier_id = a.dossier_id and f.numero = 'F2026-0001' where a.dossier_id = '{A}' and a.type = 'avoir'$q$, '', 'A2026-0001|avoir|validee|t|ESSAI CLIENT|123456789|assujetti|123456789|2026-02-01|2026-02-28|t|-100|Remise accordée|Mentions de l''avoir|ESSAI ÉMETTEUR'],
    array['valeur', '53. … ses lignes créditent', 'postgres', $q$select string_agg(concat_ws('|', l.quantite, l.prix_unitaire_ht, l.taux_tva), ';' order by l.ordre) from facture_lignes l join factures_emises a on a.id = l.facture_id where a.dossier_id = '{A}' and a.type = 'avoir'$q$, '', '-1|83.33|20'],
    array['controle', '54. un second avoir au-delà de ce qui reste', 'chef', $q$select enregistrer_facture('{A}', null, jsonb_build_object('type', 'avoir', 'facture_origine_id', (select id from factures_emises where dossier_id = '{A}' and numero = 'F2026-0001'), 'date_emission', '2026-03-11', 'montant_ht', -125, 'montant_tva', -25, 'montant_ttc', -150), '[{"designation":"Prestation","quantite":-1,"prix_unitaire_ht":125,"taux_tva":20}]'::jsonb, true)$q$, '22023', 'Cet avoir créditerait 150,00 € : la facture F2026-0001 n''a plus que 140,00 € à créditer.'],
    array['controle', '55. un second avoir de ce qui reste exactement', 'chef', $q$select enregistrer_facture('{A}', null, jsonb_build_object('type', 'avoir', 'facture_origine_id', (select id from factures_emises where dossier_id = '{A}' and numero = 'F2026-0001'), 'date_emission', '2026-03-11', 'montant_ht', -116.67, 'montant_tva', -23.33, 'montant_ttc', -140), '[{"designation":"Prestation","quantite":-1,"prix_unitaire_ht":116.67,"taux_tva":20}]'::jsonb, true)$q$, 'OK', ''],
    array['controle', '56. l''avoir d''un avoir', 'chef', $q$select enregistrer_facture('{A}', null, jsonb_build_object('type', 'avoir', 'facture_origine_id', (select id from factures_emises where dossier_id = '{A}' and numero = 'A2026-0001'), 'date_emission', '2026-03-11', 'montant_ht', -10, 'montant_tva', -2, 'montant_ttc', -12), '[{"designation":"x","quantite":-1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true)$q$, '22023', 'Un avoir corrige une facture validée, jamais un brouillon ni un autre avoir.'],
    array['valeur', '57. les deux séries de A : une facture, un avoir', 'postgres', $q$select string_agg(type || ':' || dernier_numero, '|' order by type) from facture_numerotation where dossier_id = '{A}'$q$, '', 'avoir:1|facture:1'],

    -- ══ Un chef de cabinet qui n'est pas super-administrateur ═════════════════════════════════════════════════════════
    array['jeu', 'le client devient chef du cabinet jetable', 'postgres', $q$insert into cabinet_admins (user_id, cabinet_id, role) values ('{CLIENT}', '{CJ}', 'comptable_en_chef')$q$, '', ''],
    array['fait', '58. il facture dans un dossier de son cabinet', 'client', $q$select enregistrer_facture('{J1}', null, '{"tiers_nom":"ESSAI J1","date_emission":"2026-04-01","montant_ht":80,"montant_tva":0,"montant_ttc":80,"type_client":"organisme_public","code_service":"SERVICE","numero_engagement":"EJ-2026-1"}'::jsonb, '[{"designation":"Séance","quantite":2,"prix_unitaire_ht":40,"taux_tva":0}]'::jsonb, true)$q$, 'OK', ''],
    array['valeur', '59. … numérotée, sans option : son dossier n''a pas de statut', 'postgres', $q$select concat_ws('|', numero, option_debits, type_client, code_service, numero_engagement) from factures_emises where dossier_id = '{J1}'$q$, '', 'F2026-0001|f|organisme_public|SERVICE|EJ-2026-1'],
    array['controle', '60. il crédite cette facture', 'client', $q$select enregistrer_facture('{J1}', null, jsonb_build_object('type', 'avoir', 'facture_origine_id', (select id from factures_emises where dossier_id = '{J1}' and numero = 'F2026-0001'), 'date_emission', '2026-04-02', 'montant_ht', -40, 'montant_tva', 0, 'montant_ttc', -40), '[{"designation":"Séance","quantite":-1,"prix_unitaire_ht":40,"taux_tva":0}]'::jsonb, true)$q$, 'OK', ''],
    array['controle', '61. mais pas dans un dossier d''un autre cabinet', 'client', $q$select enregistrer_facture('{A}', null, '{"tiers_nom":"ESSAI"}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":1,"taux_tva":0}]'::jsonb, false)$q$, '42501', 'Accès refusé à ce dossier.']
  ];

  begin
    foreach etape slice 1 in array etapes loop
      s := etape[4];
      for cle, valeur in select key, value from jsonb_each_text(ids) loop
        s := replace(s, '{' || cle || '}', valeur);
      end loop;
      accepte := false; code_recu := null; message := null; obs := null;
      if etape[1] = 'jeu' then
        begin
          execute s;
        exception when others then
          verdicts := verdicts || jsonb_build_object('controle', '0. le jeu : ' || etape[2], 'observe', sqlstate || ' ' || sqlerrm, 'ok', false);
        end;
      elsif etape[1] = 'valeur' then
        begin
          execute s into obs;
        exception when others then obs := sqlstate || ' ' || sqlerrm;
        end;
        verdicts := verdicts || jsonb_build_object('controle', etape[2], 'observe', coalesce(obs, '∅'), 'ok', coalesce(obs = etape[6], false));
      else
        begin
          if etape[3] <> 'postgres' then
            execute format('set local role %I', case when etape[3] = 'anon' then 'anon' else 'authenticated' end);
            perform set_config('request.jwt.claims', case when etape[3] = 'anon' then json_build_object('role', 'anon')::text
              else json_build_object('sub', case etape[3] when 'chef' then chef when 'client' then client else inconnu end,
                                     'role', 'authenticated')::text end, true);
          end if;
          execute s;
          accepte := true;
          if etape[1] = 'controle' then
            raise exception 'ANNULATION_ESSAI';
          end if;
        exception when others then code_recu := sqlstate; message := sqlerrm;
        end;
        reset role;
        perform set_config('request.jwt.claims', '', true);
        if etape[1] = 'fait' and etape[2] !~ '^\d' then
          -- Un « fait » sans numéro prépare le jeu : seul son échec se dit.
          if not accepte then
            verdicts := verdicts || jsonb_build_object('controle', '0. le jeu : ' || etape[2], 'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''), 'ok', false);
          end if;
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

  -- ══ 62. Rien n'est resté ═══════════════════════════════════════════════════════════════════════════════════════════
  select string_agg(n::text, '/') into apres from (values
    ((select count(*) from dossiers)), ((select count(*) from cabinets)), ((select count(*) from cabinet_admins)),
    ((select count(*) from factures_emises)), ((select count(*) from facture_lignes)), ((select count(*) from facture_numerotation))
  ) as t(n);
  verdicts := verdicts || jsonb_build_object('controle', '62. rien n''est resté en base',
    'observe', avant || ' -> ' || apres,
    'ok', avant = apres and not exists (select 1 from dossiers where nom like 'ESSAI FACTURES%')
      and not exists (select 1 from cabinet_admins where user_id = client));

  perform set_config('essai.factures', verdicts::text, true);
end $essai$;

select v.controle, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.factures')::jsonb) as v(controle text, ok boolean, observe text)
order by (regexp_match(v.controle, '^(\d+)'))[1]::int, v.controle;
