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
--   - LA FACTURE VALIDÉE FIGÉE (étape c, premier temps, seconde migration) : ni son montant, ni son numéro, ni son statut,
--     ni ses lignes ne changent par un appel direct — seuls l'adresse d'envoi et le suivi de Super PDP s'écrivent après
--     coup ; une facture ne se valide que par la fonction, sous le réglage qui annonce CETTE facture, et ne naît pas
--     validée ; un avoir n'a pas de brouillon (une contrainte différée, éprouvée en la rendant immédiate) ; une facture ne
--     devient pas un avoir et ne change pas de dossier ; et chaque contrainte de la ligne — le numéro de la validation et
--     de sa série, les montants au centime, le TTC qui fait la somme, pas d'origine sur une facture — refuse, par son NOM ;
--   - LA NUMÉROTATION : personne, le chef compris, n'appelle plus les deux fonctions qui consomment un numéro ; la
--     restauration d'une sauvegarde pose des factures validées dans un dossier sans compteur et repose le lien d'un avoir,
--     rien d'autre ; la numérotation REPREND ensuite du plus haut numéro restauré, dans les deux séries, et la porte de la
--     restauration se referme ; un chef qui n'est pas super-administrateur ne restaure pas ; le dix-millième numéro de
--     l'année garde ses chiffres, et un compteur en avance n'est pas réattribué ;
--   - ce que la production ne peut que LIRE, ce fichier ne portant aucune suppression : les deux déclencheurs en place sur
--     les trois événements, et la contrainte différée. Les suppressions elles-mêmes — une facture validée refusée, un
--     brouillon parti avec ses lignes, un dossier entier emporté avec ses factures validées — se jouent sur une réplique
--     locale du schéma (voir CLAUDE.md) ;
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
--
-- 10/10/2026, SUR UNE RÉPLIQUE, PAS EN PRODUCTION (espace client, étape P2 : préparée, non appliquée). Les migrations
-- `ventes_du_client` font accepter par `enregistrer_facture` le client qui porte le droit « Ventes » sur le dossier
-- (`gere_les_ventes`), lui font écrire `valide_par`, et ajoutent `supprimer_brouillon_facture`. Le client d'essai doit
-- donc être SANS ce droit : coché sur ce compte, le refus attendu ici deviendrait une acceptation légitime, et l'essai
-- se dit impossible plutôt que de virer au rouge à tort ; le client qui le porte, `valide_par` et la suppression d'un
-- brouillon se jouent dans `ventesClient.sql`. Ses 118 verdicts justes sur une réplique identique à la production
-- (`signature.sql`), avant comme après les deux migrations de l'étape.
--
-- 10/10/2026, EN PRODUCTION, après les deux migrations de l'étape P2 (116 migrations) : 118 sur 118, rien resté. Le texte
-- reçu est la copie adaptée de la tête 0a711c7, ses lignes de commentaire retirées et une ligne qui rend le texte reçu
-- ajoutée au verdict (47 819 caractères, empreinte 18ee1b25b70510a80dd0aef0fe2ed7df) ; sur une réplique égale à la
-- production, la copie et ce fichier rendent les mêmes verdicts, à l'octet.
--
-- ADAPTÉ LE 19/10/2026 À L'ÉTAPE VF2 (chantier EC-Q3 ; migration `source_de_la_vente`, en base) : un déclencheur de plus
-- sur les factures, `factures_emises_source_de_la_vente` (avant l'insertion et la modification, ligne par ligne : 23),
-- qui fixe la source de la vente à la validation. Le contrôle 105 le compte ; rien d'autre ne change — aucun dossier
-- de l'essai n'a basculé, ses factures se valident comme hier. supabase/essais/ventesFacturees.sql éprouve le reste.
--
-- ADAPTÉ LE 28/10/2026 À L'ÉTAPE A7a (espace client, ligne 51.5 ; migration `mentions_figees`, PRÉPARÉE, pas encore en
-- base ; son témoin : la colonne `factures_emises.mentions_figees`) : le numéro d'engagement s'ouvre à tout acheteur
-- (C. com., art. L441-9, I : le numéro du bon de commande établi par l'acheteur), le code service restant à l'organisme
-- public. Le contrôle 28 attend l'état où la base se trouve — refusé avant la migration, accepté après ; le 27 ne change
-- pas. Le reste de l'étape — la provenance des lignes, ce que la validation fige, la garde — se joue dans
-- supabase/essais/mentionsFigees.sql.
--
-- ÉTENDU LE 31/10/2026 POUR LA CORRECTION DE LA FACTURE, REPRIS LE 02/11/2026 POUR FACTURE-Q1 (migration
-- `facture_dates_centimes_mention_tva`, PRÉPARÉE dans supabase/preparees/, pas encore en base ; son témoin : la garde des
-- factures porte « CE QUE LA VALIDATION EXIGE DE LA FACTURE ») : la section 107 à 116 éprouve les cinq refus neufs de la
-- garde à la validation — le statut de TVA à préciser (une facture, un accès « Ventes » : FACTURE-Q1, la réponse du
-- cabinet du 02/11/2026 ; le cabinet la valide encore, dans un dossier basculé comme dans un autre ; l'avoir du client
-- n'en est pas jugé), l'exonération sans article (un accès « Ventes » : FACTURE-Q2), la mention de TVA absente (une
-- facture comme un avoir, au caractère près : FACTURE-Q3), une date à venir, une date antérieure à la plus récente de la
-- série (le brouillon du 02/12/2025 qui attend pendant que la facture du 05/12/2025 se valide) —, chacun suivi d'une
-- mutation qui MORD (le même appel, la cause du refus ôtée — le statut posé, ou le cabinet pour auteur —, passe), et le
-- cas neutre (une facture du jour, d'un redevable, passe). Chaque contrôle attend l'état où la base se trouve : sans la
-- migration, la validation que la garde refusera passe — c'est le défaut qu'elle ferme. Une étape d'hier ADAPTÉE, sans
-- rien changer de ce qu'elle juge : la facture du dossier B, en franchise, porte la mention de l'art. 293 B (17). Le
-- dossier J1 du cabinet jetable reste sans statut : son chef y valide (58 à 60), ce que FACTURE-Q1 lui laisse.
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
  mentions_figees boolean;
  -- La correction de la facture (31/10/2026) : son témoin, et les jours que ses contrôles nomment, lus à Paris.
  correction boolean;
  -- La numérotation qui continue (étape A9a, préparée ; son témoin : la table `modeles_numerotation`).
  numerotation_continue boolean;
  aujourdhui date := (now() at time zone 'Europe/Paris')::date;
  demain date := (now() at time zone 'Europe/Paris')::date + 1;
  verdicts jsonb := '[]'::jsonb;
begin
  select m.dossier_id into dossier_client from memberships m where m.user_id = client order by m.dossier_id limit 1;
  select cabinet_id into cabinet from dossiers where id = dossier_test;
  if dossier_client is null or cabinet is null or dossier_client = dossier_test
     or exists (select 1 from cabinet_admins where user_id = client)
     or not exists (select 1 from super_admins where user_id = chef) then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable';
  end if;
  -- Le client d'essai est SANS le droit « Ventes » (espace client, étape P2) : avec lui, il enregistre les factures de
  -- son dossier, légitimement, et c'est `ventesClient.sql` qui le joue.
  if exists (select 1 from memberships m where m.user_id = client and m.droit_ventes) then
    raise exception 'ESSAI_IMPOSSIBLE : le client d''essai porte le droit « Ventes » sur un de ses dossiers (voir ventesClient.sql)';
  end if;
  -- Depuis la migration `mentions_figees` (étape A7a ; son témoin : la colonne `factures_emises.mentions_figees`), le
  -- numéro d'engagement s'ouvre à tout acheteur : le contrôle 28 attend l'état où la base se trouve.
  select exists (select 1 from pg_attribute where attrelid = 'public.factures_emises'::regclass and attname = 'mentions_figees'
                 and not attisdropped) into mentions_figees;
  -- Depuis la numérotation qui continue (étape A9a ; son témoin : la table `modeles_numerotation`), le cabinet valide dans
  -- la série de son mandataire (M, MA) : les dossiers de cet essai lui posent la série d'hier (F, A), celle du client
  -- prenant C et D, pour que les numéros qu'il éprouve restent ceux d'hier — la série de qui valide s'éprouve dans
  -- numerotationContinue.sql ; et la contrainte du numéro ne juge plus que sa forme (G1.05), le modèle se jugeant à la
  -- validation (101 à 103).
  numerotation_continue := to_regclass('public.modeles_numerotation') is not null;
  -- Depuis la correction de la facture (son témoin : le bloc de la garde), la validation exige le statut de TVA du dossier,
  -- sa mention de TVA et une date dans l'ordre de la série : la section 107 à 116 attend l'état où la base se trouve.
  select coalesce(strpos(p.prosrc, 'CE QUE LA VALIDATION EXIGE DE LA FACTURE') > 0, false) into correction
    from pg_proc p where p.oid = to_regprocedure('public.garder_factures_validees()');

  ids := jsonb_build_object('CAB', cabinet, 'DC', dossier_client, 'CLIENT', client,
    'A', 'e55a2000-0000-4000-8000-0000000000a1', 'B', 'e55a2000-0000-4000-8000-0000000000a2',
    'X', 'e55a2000-0000-4000-8000-0000000000a3', 'CJ', 'e55a2000-0000-4000-8000-0000000000c1',
    'J1', 'e55a2000-0000-4000-8000-0000000000c2', 'J2', 'e55a2000-0000-4000-8000-0000000000c3',
    'Y', 'e55a2000-0000-4000-8000-0000000000a4', 'RF', 'e55a2000-0000-4000-8000-0000000000b1',
    'RA', 'e55a2000-0000-4000-8000-0000000000b2', 'JF', 'e55a2000-0000-4000-8000-0000000000b3',
    'JA', 'e55a2000-0000-4000-8000-0000000000b4', 'JB', 'e55a2000-0000-4000-8000-0000000000b5',
    'RF2', 'e55a2000-0000-4000-8000-0000000000b6')
    -- La correction de la facture : K, redevable (les dates) ; F, en franchise ; E, exonéré pour ses soins ; N, au statut
    -- à préciser ; S, exonéré sans article, basculé, et l'accès « Ventes » du client à lui ; V, au statut à préciser,
    -- basculé, et l'accès « Ventes » du client à lui (FACTURE-Q1) ; la facture restaurée de V.
    || jsonb_build_object('CK', 'e55a2000-0000-4000-8000-0000000001a1', 'CF', 'e55a2000-0000-4000-8000-0000000001a2',
    'CE', 'e55a2000-0000-4000-8000-0000000001a3', 'CN', 'e55a2000-0000-4000-8000-0000000001a4',
    'CS', 'e55a2000-0000-4000-8000-0000000001a5', 'ACS', 'e55a2000-0000-4000-8000-0000000001b5',
    'CV', 'e55a2000-0000-4000-8000-0000000001a6', 'ACV', 'e55a2000-0000-4000-8000-0000000001b6',
    'CR', 'e55a2000-0000-4000-8000-0000000001c4', 'AUJ', aujourdhui::text, 'DEMAIN', demain::text);

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
    -- ══ Le jeu : des dossiers jetables ══════════
    -- A est redevable et a opté pour les débits, B est en franchise (une option sans objet), X sert de dossier voisin puis
    -- de dossier restauré, Y de dossier qui n'a jamais validé de facture.
    array['jeu', 'dossiers jetables', 'postgres', $q$insert into dossiers (id, nom, cabinet_id, statut_tva, assujetti_tva, tva_sur_debits) values
      ('{A}', 'ESSAI FACTURES A', '{CAB}', 'redevable', true, true), ('{B}', 'ESSAI FACTURES B', '{CAB}', 'franchise', false, true),
      ('{X}', 'ESSAI FACTURES X', '{CAB}', 'redevable', true, false), ('{Y}', 'ESSAI FACTURES Y', '{CAB}', 'redevable', true, false)$q$, '', ''],
    array['jeu', 'cabinet jetable', 'postgres', $q$insert into cabinets (id, nom) values ('{CJ}', 'ESSAI FACTURES CABINET')$q$, '', ''],
    -- J1 n'a pas de statut de TVA : son chef, qui n'est pas super-administrateur, y valide une facture (58) — depuis la
    -- correction de la facture, reprise pour FACTURE-Q1 (02/11/2026), seul un accès « Ventes » se voit refuser la facture
    -- d'un dossier au statut à préciser (section 107 à 116).
    array['jeu', 'ses dossiers', 'postgres', $q$insert into dossiers (id, nom, cabinet_id) values ('{J1}', 'ESSAI FACTURES J1', '{CJ}'), ('{J2}', 'ESSAI FACTURES J2', '{CJ}')$q$, '', ''],
    array['fait', 'A9a : la série d''hier au cabinet dans A, B, X, Y, J1 et J2', 'chef', $q$do $a9a$
      declare d uuid; m record;
      begin
        if to_regprocedure('public.fixer_modele_numerotation(uuid, text, text, text, boolean, integer, integer)') is null then
          return;
        end if;
        foreach d in array array['{A}', '{B}', '{X}', '{Y}', '{J1}', '{J2}']::uuid[] loop
          for m in select * from (values (1, 'facture', 'client', 'C{AAAA}-{N:4}'), (2, 'avoir', 'client', 'D{AAAA}-{N:4}'),
                                         (3, 'facture', 'mandataire', 'F{AAAA}-{N:4}'), (4, 'avoir', 'mandataire', 'A{AAAA}-{N:4}')) as v(rang, nature, emetteur, modele)
                   order by v.rang loop
            perform fixer_modele_numerotation(d, m.nature, m.emetteur, m.modele, true, 2000);
          end loop;
        end loop;
      end $a9a$$q$, 'OK', ''],

    -- ══ Qui enregistre ══════════
    array['controle', '1. anonyme : pas le droit d''appeler', 'anon', $q$select enregistrer_facture('{A}', null, '{"tiers_nom":"ESSAI"}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":1,"taux_tva":0}]'::jsonb, false)$q$, '42501', 'permission denied%'],
    array['controle', '2. rattaché à rien', 'inconnu', $q$select enregistrer_facture('{A}', null, '{"tiers_nom":"ESSAI"}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":1,"taux_tva":0}]'::jsonb, false)$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '3. client, le dossier d''un autre', 'client', $q$select enregistrer_facture('{A}', null, '{"tiers_nom":"ESSAI"}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":1,"taux_tva":0}]'::jsonb, false)$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '4. client, son propre dossier', 'client', $q$select enregistrer_facture('{DC}', null, '{"tiers_nom":"ESSAI"}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":1,"taux_tva":0}]'::jsonb, false)$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '4b. le client n''insère pas de facture en direct', 'client', $q$insert into factures_emises (dossier_id, tiers_nom) values ('{DC}', 'ESSAI DIRECT')$q$, '42501', 'new row violates row-level security policy%'],
    array['controle', '5. un type de document inconnu', 'chef', $q$select enregistrer_facture('{A}', null, '{"tiers_nom":"ESSAI","type":"devis"}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":1,"taux_tva":0}]'::jsonb, false)$q$, '22023', 'Type de document inconnu : devis.'],

    -- ══ Les mentions ══════════
    array['fait', '6. le chef enregistre un brouillon qui porte les mentions', 'chef', $q$select enregistrer_facture('{A}', null, '{"tiers_nom":"ESSAI CLIENT","tiers_siret":"12345678900012","date_emission":"2026-03-01","montant_ht":100,"montant_tva":20,"montant_ttc":120,"type_client":"assujetti","tiers_adresse":"Adresse fictive du client","tiers_siren":"123456789","tiers_adresse_electronique":"123456789","nature_operation":"services","date_prestation":"2026-02-20"}'::jsonb, '[{"designation":"Prestation","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$, 'OK', ''],
    array['valeur', '7. … elles sont enregistrées, sans option figée', 'postgres', $q$select concat_ws('|', type_client, tiers_siren, tiers_adresse_electronique, nature_operation, date_prestation, statut, coalesce(option_debits::text, '∅')) from factures_emises where dossier_id = '{A}' and tiers_nom = 'ESSAI CLIENT'$q$, '', 'assujetti|123456789|123456789|services|2026-02-20|brouillon|∅'],
    array['fait', '8. une fenêtre d''avant enregistre le brouillon sans les mentions', 'chef', $q$select enregistrer_facture('{A}', (select id from factures_emises where dossier_id = '{A}' and tiers_nom = 'ESSAI CLIENT'), '{"tiers_nom":"ESSAI CLIENT","tiers_adresse":"Adresse fictive du client","tiers_siret":"12345678900012","date_emission":"2026-03-01","montant_ht":200,"montant_tva":40,"montant_ttc":240}'::jsonb, '[{"designation":"Prestation","quantite":2,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$, 'OK', ''],
    array['valeur', '9. … elle ne les efface pas, et le reste suit', 'postgres', $q$select concat_ws('|', type_client, tiers_siren, tiers_adresse_electronique, nature_operation, date_prestation, montant_ttc, (select count(*) from facture_lignes l where l.facture_id = f.id)) from factures_emises f where dossier_id = '{A}' and tiers_nom = 'ESSAI CLIENT'$q$, '', 'assujetti|123456789|123456789|services|2026-02-20|240|1'],
    array['fait', '10. une mention portée vide s''efface, une autre se pose', 'chef', $q$select enregistrer_facture('{A}', (select id from factures_emises where dossier_id = '{A}' and tiers_nom = 'ESSAI CLIENT'), '{"tiers_nom":"ESSAI CLIENT","tiers_adresse":"Adresse fictive du client","tiers_siret":"12345678900012","date_emission":"2026-03-01","montant_ht":200,"montant_tva":40,"montant_ttc":240,"date_prestation":"","periode_debut":"2026-02-01","periode_fin":"2026-02-28"}'::jsonb, '[{"designation":"Prestation","quantite":2,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$, 'OK', ''],
    array['valeur', '11. … la date de prestation a laissé la place à la période', 'postgres', $q$select concat_ws('|', coalesce(date_prestation::text, '∅'), periode_debut, periode_fin, type_client) from factures_emises where dossier_id = '{A}' and tiers_nom = 'ESSAI CLIENT'$q$, '', '∅|2026-02-01|2026-02-28|assujetti'],
    array['controle', '12. la fonction ne passe pas outre une contrainte', 'chef', $q$select enregistrer_facture('{A}', null, '{"tiers_nom":"ESSAI","tiers_siren":"12345"}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":1,"taux_tva":0}]'::jsonb, false)$q$, '23514', '%"factures_emises_tiers_siren_check"%'],

    -- ══ L'option pour les débits, figée à la validation ══════════
    array['fait', '13. le chef valide la facture', 'chef', $q$select enregistrer_facture('{A}', (select id from factures_emises where dossier_id = '{A}' and tiers_nom = 'ESSAI CLIENT'), '{"tiers_nom":"ESSAI CLIENT","tiers_adresse":"Adresse fictive du client","tiers_siret":"12345678900012","date_emission":"2026-03-01","emetteur_nom":"ESSAI ÉMETTEUR","montant_ht":200,"montant_tva":40,"montant_ttc":240}'::jsonb, '[{"designation":"Prestation","quantite":2,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, true)$q$, 'OK', ''],
    array['valeur', '14. … numérotée, validée, l''option du dossier redevable figée', 'postgres', $q$select concat_ws('|', numero, statut, option_debits, validated_at is not null) from factures_emises where dossier_id = '{A}' and tiers_nom = 'ESSAI CLIENT'$q$, '', 'F2026-0001|validee|t|t'],
    array['valeur', '15. le réglage qui annonce la validation est retiré aussitôt', 'postgres', $q$select coalesce(nullif(current_setting('jd.validation_facture', true), ''), '∅')$q$, '', '∅'],
    array['jeu', 'le dossier A renonce à l''option', 'postgres', $q$update dossiers set tva_sur_debits = false where id = '{A}'$q$, '', ''],
    array['valeur', '16. la facture validée garde l''option qu''elle a figée', 'postgres', $q$select option_debits::text from factures_emises where dossier_id = '{A}' and numero = 'F2026-0001'$q$, '', 'true'],
    -- « Sans les mentions » : celles de la facture électronique ; la mention de TVA de la franchise, elle, y est (depuis le
    -- 31/10/2026, la garde l'exige : section 107 à 116).
    array['fait', '17. un dossier en franchise valide une facture sans les mentions', 'chef', $q$select enregistrer_facture('{B}', null, '{"tiers_nom":"ESSAI B","date_emission":"2026-03-02","mentions_legales":"TVA non applicable, art. 293 B du CGI.","montant_ht":50,"montant_tva":0,"montant_ttc":50}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":50,"taux_tva":0}]'::jsonb, true)$q$, 'OK', ''],
    array['valeur', '18. … l''option ne s''y fige pas, et les mentions restent à préciser', 'postgres', $q$select concat_ws('|', numero, option_debits, coalesce(type_client, '∅'), coalesce(nature_operation, '∅')) from factures_emises where dossier_id = '{B}'$q$, '', 'F2026-0001|f|∅|∅'],
    array['controle', '19. une option ne se pose pas sur un brouillon', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, option_debits) values ('{A}', 'ESSAI CONTRAINTE', true)$q$, '23514', '%"factures_emises_option_debits_validee"%'],

    -- ══ Ce que les contraintes refusent seules ══════════
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
    array['controle', '28. un numéro d''engagement sans client : refusé avant l''étape A7a, accepté depuis', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, numero_engagement) values ('{A}', 'ESSAI CONTRAINTE', 'EJ-1')$q$, case when mentions_figees then 'OK' else '23514' end, case when mentions_figees then '' else '%"factures_emises_organisme_public"%' end],
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

    -- ══ L'avoir, d'un seul tenant ══════════
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

    -- ══ Un chef de cabinet qui n'est pas super-administrateur ══════════
    array['jeu', 'le client devient chef du cabinet jetable', 'postgres', $q$insert into cabinet_admins (user_id, cabinet_id, role) values ('{CLIENT}', '{CJ}', 'comptable_en_chef')$q$, '', ''],
    array['fait', '58. il facture dans un dossier de son cabinet', 'client', $q$select enregistrer_facture('{J1}', null, '{"tiers_nom":"ESSAI J1","date_emission":"2026-04-01","montant_ht":80,"montant_tva":0,"montant_ttc":80,"type_client":"organisme_public","tiers_adresse":"Adresse fictive du client","code_service":"SERVICE","numero_engagement":"EJ-2026-1"}'::jsonb, '[{"designation":"Séance","quantite":2,"prix_unitaire_ht":40,"taux_tva":0}]'::jsonb, true)$q$, 'OK', ''],
    array['valeur', '59. … numérotée, sans option : son dossier n''a pas de statut', 'postgres', $q$select concat_ws('|', numero, option_debits, type_client, code_service, numero_engagement) from factures_emises where dossier_id = '{J1}'$q$, '', 'F2026-0001|f|organisme_public|SERVICE|EJ-2026-1'],
    array['controle', '60. il crédite cette facture', 'client', $q$select enregistrer_facture('{J1}', null, jsonb_build_object('type', 'avoir', 'facture_origine_id', (select id from factures_emises where dossier_id = '{J1}' and numero = 'F2026-0001'), 'date_emission', '2026-04-02', 'montant_ht', -40, 'montant_tva', 0, 'montant_ttc', -40), '[{"designation":"Séance","quantite":-1,"prix_unitaire_ht":40,"taux_tva":0}]'::jsonb, true)$q$, 'OK', ''],
    array['controle', '61. mais pas dans un dossier d''un autre cabinet', 'client', $q$select enregistrer_facture('{A}', null, '{"tiers_nom":"ESSAI"}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":1,"taux_tva":0}]'::jsonb, false)$q$, '42501', 'Accès refusé à ce dossier.'],

    -- ══ Une facture validée est figée (étape c, premier temps, seconde migration) ══════════
    array['controle', '62. le chef ne change pas le montant d''une facture validée', 'chef', $q$update factures_emises set montant_ht = 1, montant_tva = 0, montant_ttc = 1 where dossier_id = '{A}' and numero = 'F2026-0001'$q$, '23514', 'La facture F2026-0001 est validée : elle ne se modifie plus — la corriger passe par un avoir.'],
    array['controle', '63. ni son numéro', 'chef', $q$update factures_emises set numero = 'F2026-0002' where dossier_id = '{A}' and numero = 'F2026-0001'$q$, '23514', 'La facture F2026-0001 est validée : elle ne se modifie plus%'],
    array['controle', '63b. ni ce qu''elle dit d''autre', 'chef', $q$update factures_emises set notes = 'réécrite' where dossier_id = '{A}' and numero = 'F2026-0001'$q$, '23514', 'La facture F2026-0001 est validée : elle ne se modifie plus%'],
    array['controle', '64. elle ne redevient pas un brouillon', 'chef', $q$update factures_emises set statut = 'brouillon', numero = null, validated_at = null, option_debits = null where dossier_id = '{A}' and numero = 'F2026-0001'$q$, '23514', 'La facture F2026-0001 est validée : elle ne se modifie plus%'],
    array['controle', '65. elle garde modifiables l''adresse d''envoi et le suivi de Super PDP', 'chef', $q$update factures_emises set tiers_email = 'essai@example.invalid', superpdp_invoice_id = 42, superpdp_dernier_statut = 'api:essai' where dossier_id = '{A}' and numero = 'F2026-0001'$q$, 'OK', ''],
    array['controle', '66. ses lignes ne changent plus', 'chef', $q$update facture_lignes set prix_unitaire_ht = 1 where facture_id = (select id from factures_emises where dossier_id = '{A}' and numero = 'F2026-0001')$q$, '23514', 'La facture F2026-0001 est validée : ses lignes ne changent plus — la corriger passe par un avoir.'],
    array['controle', '67. on ne lui en ajoute pas', 'chef', $q$insert into facture_lignes (facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva) values ((select id from factures_emises where dossier_id = '{A}' and numero = 'F2026-0001'), 9, 'ajout', 1, 1, 0)$q$, '23514', 'La facture F2026-0001 est validée : ses lignes ne changent plus%'],
    array['controle', '67b. une ligne ne la quitte pas pour un brouillon', 'chef', $q$update facture_lignes set facture_id = (select id from factures_emises where dossier_id = '{A}' and tiers_nom = 'ESSAI BROUILLON') where facture_id = (select id from factures_emises where dossier_id = '{A}' and numero = 'F2026-0001')$q$, '23514', 'La facture F2026-0001 est validée : ses lignes ne changent plus%'],
    array['controle', '67c. une ligne d''un brouillon ne la rejoint pas', 'chef', $q$update facture_lignes set facture_id = (select id from factures_emises where dossier_id = '{A}' and numero = 'F2026-0001') where facture_id = (select id from factures_emises where dossier_id = '{A}' and tiers_nom = 'ESSAI BROUILLON')$q$, '23514', 'La facture F2026-0001 est validée : ses lignes ne changent plus%'],
    array['controle', '68. une facture ne se valide pas par un appel direct', 'chef', $q$update factures_emises set statut = 'validee', numero = 'F2026-0099', validated_at = now() where dossier_id = '{A}' and tiers_nom = 'ESSAI BROUILLON'$q$, '42501', 'Une facture ne se valide que par enregistrer_facture, qui lui donne son numéro.'],
    array['controle', '69. … ni sous le réglage d''une autre facture', 'chef', $q$select set_config('jd.validation_facture', (select id::text from factures_emises where dossier_id = '{A}' and numero = 'F2026-0001'), true); update factures_emises set statut = 'validee', numero = 'F2026-0099', validated_at = now() where dossier_id = '{A}' and tiers_nom = 'ESSAI BROUILLON'$q$, '42501', 'Une facture ne se valide que par enregistrer_facture%'],
    array['controle', '70. une facture ne naît pas validée', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, statut, numero, validated_at, date_emission) values ('{A}', 'ESSAI FORGÉE', 'validee', 'F2026-0050', now(), '2026-03-01')$q$, '42501', 'Une facture ne naît pas validée : elle se valide par enregistrer_facture, qui lui donne son numéro.'],
    array['controle', '71. un avoir posé en brouillon par un appel direct', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, type, facture_origine_id) values ('{A}', 'ESSAI AVOIR DIRECT', 'avoir', (select id from factures_emises where dossier_id = '{A}' and numero = 'F2026-0001')); set constraints factures_emises_avoir_sans_brouillon immediate$q$, '23514', 'Un avoir se crée par enregistrer_facture, qui le valide aussitôt : il n''a pas de brouillon.'],
    array['controle', '72. l''avoir de la fonction passe la même vérification', 'chef', $q$select enregistrer_facture('{A}', null, jsonb_build_object('type', 'avoir', 'facture_origine_id', (select id from factures_emises where dossier_id = '{A}' and numero = 'F2026-0001'), 'date_emission', '2026-03-12', 'montant_ht', -10, 'montant_tva', -2, 'montant_ttc', -12), '[{"designation":"Prestation","quantite":-1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true); set constraints factures_emises_avoir_sans_brouillon immediate$q$, 'OK', ''],
    array['controle', '73. une facture ne devient pas un avoir', 'chef', $q$update factures_emises set type = 'avoir', facture_origine_id = (select id from factures_emises where dossier_id = '{A}' and numero = 'F2026-0001') where dossier_id = '{A}' and tiers_nom = 'ESSAI BROUILLON'$q$, '42501', 'Une facture ne devient pas un avoir : un avoir se crée par enregistrer_facture, qui le valide aussitôt.'],
    array['controle', '74. une facture ne change pas de dossier', 'chef', $q$update factures_emises set dossier_id = '{X}' where dossier_id = '{A}' and tiers_nom = 'ESSAI BROUILLON'$q$, '23514', 'Une facture ne change pas de dossier.'],
    array['controle', '75. un brouillon se modifie toujours, ses lignes aussi', 'chef', $q$update factures_emises set notes = 'Brouillon modifié' where dossier_id = '{A}' and tiers_nom = 'ESSAI BROUILLON'; update facture_lignes set designation = 'Modifiée' where facture_id = (select id from factures_emises where dossier_id = '{A}' and tiers_nom = 'ESSAI BROUILLON')$q$, 'OK', ''],

    -- ══ La numérotation, fermée aux appels directs ══════════
    array['controle', '76. le chef n''appelle pas la numérotation', 'chef', $q$select attribuer_numero_facture('{A}', 2026, 'facture')$q$, '42501', 'permission denied for function attribuer_numero_facture'],
    array['controle', '77. … ni la fonction qui consomme le numéro', 'chef', $q$select prochain_numero_facture('{A}', 2026, 'facture')$q$, '42501', 'permission denied for function prochain_numero_facture'],
    array['controle', '78. le client non plus', 'client', $q$select attribuer_numero_facture('{DC}', 2026, 'facture')$q$, '42501', 'permission denied for function attribuer_numero_facture'],
    array['controle', '79. l''anonyme non plus', 'anon', $q$select prochain_numero_facture('{A}', 2026, 'facture')$q$, '42501', 'permission denied for function prochain_numero_facture'],
    array['controle', '79b. la porte de la restauration ne s''appelle pas non plus', 'chef', $q$select restauration_des_factures('{X}')$q$, '42501', 'permission denied for function restauration_des_factures'],
    -- Le contrôle POSITIF : sans lui, ces refus seraient satisfaits par une numérotation que plus personne n'atteint, la
    -- facturation à l'arrêt. `enregistrer_facture` appartient au propriétaire de la base, qui garde son droit d'exécution.
    array['controle', '80. la fonction, elle, numérote toujours', 'chef', $q$select enregistrer_facture('{A}', null, '{"tiers_nom":"ESSAI NUMÉRO","date_emission":"2026-03-20","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true)$q$, 'OK', ''],

    -- ══ La restauration, puis la numérotation qui reprend ══════════
    -- X n'a jamais validé de facture : c'est le dossier que restaure le super-administrateur (le chef, sur ce projet).
    array['fait', '81. la restauration pose une facture validée dans un dossier sans compteur', 'chef', $q$insert into factures_emises (id, dossier_id, tiers_nom, statut, numero, validated_at, date_emission, montant_ht, montant_tva, montant_ttc) values ('{RF}', '{X}', 'ESSAI RESTAURÉE', 'validee', 'F2026-0007', now(), '2026-02-01', 100, 20, 120), ('{RF2}', '{X}', 'ESSAI RESTAURÉE 2', 'validee', 'F2026-0005', now(), '2026-01-20', 10, 2, 12)$q$, 'OK', ''],
    array['fait', '82. … ses lignes', 'chef', $q$insert into facture_lignes (facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva) values ('{RF}', 0, 'Restaurée', 1, 100, 20)$q$, 'OK', ''],
    array['fait', '83. … et un avoir, sans son lien au premier passage', 'chef', $q$insert into factures_emises (id, dossier_id, type, tiers_nom, statut, numero, validated_at, date_emission, montant_ht, montant_tva, montant_ttc) values ('{RA}', '{X}', 'avoir', 'ESSAI RESTAURÉE', 'validee', 'A2026-0003', now(), '2026-02-10', -10, -2, -12)$q$, 'OK', ''],
    array['controle', '84. le second passage ne change rien d''autre que ce lien', 'chef', $q$update factures_emises set facture_origine_id = '{RF}', notes = 'ajoutée' where id = '{RA}'$q$, '23514', 'La facture A2026-0003 est validée : elle ne se modifie plus%'],
    array['fait', '85. le second passage repose le lien de l''avoir', 'chef', $q$update factures_emises set facture_origine_id = '{RF}' where id = '{RA}'$q$, 'OK', ''],
    array['valeur', '86. … qui est posé', 'postgres', $q$select (facture_origine_id = '{RF}')::text from factures_emises where id = '{RA}'$q$, '', 'true'],
    array['controle', '86b. il ne remplace pas un lien posé', 'chef', $q$update factures_emises set facture_origine_id = '{RF2}' where id = '{RA}'$q$, '23514', 'La facture A2026-0003 est validée : elle ne se modifie plus%'],
    array['fait', '87. une facture validée par la fonction dans le dossier restauré', 'chef', $q$select enregistrer_facture('{X}', null, '{"tiers_nom":"ESSAI APRÈS RESTAURATION","date_emission":"2026-03-01","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true)$q$, 'OK', ''],
    array['valeur', '88. … reprend du plus haut numéro restauré', 'postgres', $q$select numero from factures_emises where dossier_id = '{X}' and tiers_nom = 'ESSAI APRÈS RESTAURATION'$q$, '', 'F2026-0008'],
    array['fait', '89. un avoir validé par la fonction dans le dossier restauré', 'chef', $q$select enregistrer_facture('{X}', null, jsonb_build_object('type', 'avoir', 'facture_origine_id', (select id from factures_emises where dossier_id = '{X}' and numero = 'F2026-0008'), 'date_emission', '2026-03-02', 'montant_ht', -10, 'montant_tva', -2, 'montant_ttc', -12), '[{"designation":"x","quantite":-1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true)$q$, 'OK', ''],
    array['valeur', '90. … reprend la série des avoirs', 'postgres', $q$select numero from factures_emises where dossier_id = '{X}' and type = 'avoir' and facture_origine_id = (select id from factures_emises where dossier_id = '{X}' and numero = 'F2026-0008')$q$, '', 'A2026-0004'],
    array['controle', '91. la porte de la restauration s''est refermée', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, statut, numero, validated_at, date_emission) values ('{X}', 'ESSAI FORGÉE', 'validee', 'F2026-0050', now(), '2026-03-01')$q$, '42501', 'Une facture ne naît pas validée%'],
    array['controle', '92. … pour les lignes aussi', 'chef', $q$insert into facture_lignes (facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva) values ('{RF}', 1, 'ajout', 1, 1, 0)$q$, '23514', 'La facture F2026-0007 est validée : ses lignes ne changent plus%'],
    array['jeu', 'le compteur des factures de X passe en avance', 'postgres', $q$update facture_numerotation set dernier_numero = 9999 where dossier_id = '{X}' and annee = 2026 and type = 'facture'$q$, '', ''],
    array['fait', '93. la facture suivante', 'chef', $q$select enregistrer_facture('{X}', null, '{"tiers_nom":"ESSAI DIX MILLE","date_emission":"2026-03-03","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true)$q$, 'OK', ''],
    array['valeur', '94. … suit le compteur, et garde ses cinq chiffres', 'postgres', $q$select numero from factures_emises where dossier_id = '{X}' and tiers_nom = 'ESSAI DIX MILLE'$q$, '', 'F2026-10000'],
    array['controle', '95. un chef qui n''est pas super-administrateur ne restaure pas', 'client', $q$insert into factures_emises (dossier_id, tiers_nom, statut, numero, validated_at, date_emission) values ('{J2}', 'ESSAI FORGÉE', 'validee', 'F2026-0001', now(), '2026-03-01')$q$, '42501', 'Une facture ne naît pas validée%'],
    -- J2 n'a jamais validé de facture : le super-administrateur peut y restaurer, le chef du cabinet jetable non — même pour
    -- le second passage.
    array['fait', '95b. le super-administrateur y restaure une facture et son avoir', 'chef', $q$insert into factures_emises (id, dossier_id, type, tiers_nom, statut, numero, validated_at, date_emission, montant_ht, montant_tva, montant_ttc) values ('{JF}', '{J2}', 'facture', 'ESSAI RESTAURÉE J2', 'validee', 'F2026-0001', now(), '2026-02-01', 50, 0, 50), ('{JA}', '{J2}', 'avoir', 'ESSAI RESTAURÉE J2', 'validee', 'A2026-0001', now(), '2026-02-02', -50, 0, -50)$q$, 'OK', ''],
    array['controle', '95c. le chef qui n''est pas super-administrateur ne fait pas le second passage', 'client', $q$update factures_emises set facture_origine_id = '{JF}' where id = '{JA}'$q$, '23514', 'La facture A2026-0001 est validée : elle ne se modifie plus%'],
    array['fait', '95d. un brouillon dans J2, avec sa ligne', 'chef', $q$insert into factures_emises (id, dossier_id, tiers_nom) values ('{JB}', '{J2}', 'ESSAI BROUILLON J2'); insert into facture_lignes (facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva) values ('{JB}', 0, 'b', 1, 1, 0)$q$, 'OK', ''],
    array['controle', '95e. la restauration insère des lignes, elle n''en déplace pas', 'chef', $q$update facture_lignes set facture_id = '{JF}' where facture_id = '{JB}'$q$, '23514', 'La facture F2026-0001 est validée : ses lignes ne changent plus%'],

    -- ══ Ce que la ligne dit d'elle-même ══════════
    array['controle', '96. un brouillon ne porte pas de numéro', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, numero) values ('{A}', 'ESSAI CONTRAINTE', 'F2026-0099')$q$, '23514', '%"factures_emises_numero_de_la_validation"%'],
    array['controle', '97. ni de date de validation', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, validated_at) values ('{A}', 'ESSAI CONTRAINTE', now())$q$, '23514', '%"factures_emises_date_de_la_validation"%'],
    array['controle', '98. des montants au centime', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, montant_ht, montant_tva, montant_ttc) values ('{A}', 'ESSAI CONTRAINTE', 0.105, 0, 0.105)$q$, '23514', '%"factures_emises_montants_au_centime"%'],
    array['controle', '99. un TTC qui fait la somme du HT et de la TVA', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, montant_ht, montant_tva, montant_ttc) values ('{A}', 'ESSAI CONTRAINTE', 10, 2, 13)$q$, '23514', '%"factures_emises_ttc_du_ht_et_de_la_tva"%'],
    array['controle', '100. une facture n''a pas d''origine', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, facture_origine_id) values ('{A}', 'ESSAI CONTRAINTE', (select id from factures_emises where dossier_id = '{A}' and numero = 'F2026-0001'))$q$, '23514', '%"factures_emises_origine_d_un_avoir"%'],
    -- Y n'a jamais validé de facture : la porte de la restauration y est ouverte, et les contraintes s'y appliquent.
    -- Depuis A9a, la restauration pose un numéro de la forme de G1.05, quel qu'il soit : le modèle se juge à la validation.
    array['controle', '101. un numéro d''avoir sur une facture', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, statut, numero, validated_at, date_emission) values ('{Y}', 'ESSAI CONTRAINTE', 'validee', 'A2026-0001', now(), '2026-03-01')$q$, case when numerotation_continue then 'OK' else '23514' end, case when numerotation_continue then '' else '%"factures_emises_numero_de_sa_serie"%' end],
    array['controle', '102. un numéro d''une autre année', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, statut, numero, validated_at, date_emission) values ('{Y}', 'ESSAI CONTRAINTE', 'validee', 'F2025-0001', now(), '2026-03-01')$q$, case when numerotation_continue then 'OK' else '23514' end, case when numerotation_continue then '' else '%"factures_emises_numero_de_sa_serie"%' end],
    array['controle', '103. un numéro mal formé', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, statut, numero, validated_at, date_emission) values ('{Y}', 'ESSAI CONTRAINTE', 'validee', 'F2026-1', now(), '2026-03-01')$q$, case when numerotation_continue then 'OK' else '23514' end, case when numerotation_continue then '' else '%"factures_emises_numero_de_sa_serie"%' end],
    array['controle', '103b. un numéro hors de la forme de G1.05 (une espace en fin)', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, statut, numero, validated_at, date_emission) values ('{Y}', 'ESSAI CONTRAINTE', 'validee', 'F2026-0001 ', now(), '2026-03-01')$q$, '23514', '%"factures_emises_numero_de_sa_serie"%'],
    array['controle', '104. un numéro de sa série et de son année passe', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, statut, numero, validated_at, date_emission) values ('{Y}', 'ESSAI CONTRAINTE', 'validee', 'F2026-0001', now(), '2026-03-01')$q$, 'OK', ''],

    -- ══ Ce que la production ne peut que lire ══════════
    -- Les deux gardes de l'acompte d'un devis (migration acomptes_des_devis, préparée) se comptent dans leur essai,
    -- acomptesDesDevis.sql (son contrôle 4) : ce contrôle-ci se lit de même avant et après elle. Les deux gardes des
    -- factures reprises (A8a, migration factures_importees, préparée le 07/11/2026) de même, dans facturesImportees.sql
    -- (son contrôle 48). La garde des mentions (JJ-Q4 et A7C-Q1, migration adresse_du_client_exigee, préparée) de même,
    -- dans adresseDuClientExigee.sql.
    array['valeur', '105. les déclencheurs couvrent l''insertion, la modification et la suppression', 'postgres', $q$select string_agg(tgname || '=' || tgtype || case when tgdeferrable then ' différable' else '' end || case when tginitdeferred then ' différée' else '' end || case when tgenabled = 'O' then '' else ' DÉSACTIVÉ' end, '|' order by tgname) from pg_trigger where tgrelid in ('public.factures_emises'::regclass, 'public.facture_lignes'::regclass) and not tgisinternal and tgname not in ('_acces_avant_les_gardes', 'facture_lignes_gardes_d_acompte', 'factures_emises_marque_d_acompte', 'facture_lignes_figees_reprises', 'factures_emises_figees_reprises', 'factures_emises_figees_mentions', 'factures_emises_numerotation')$q$, '','facture_lignes_figees=31|factures_emises_avoir_sans_brouillon=5 différable différée|factures_emises_figees=31|factures_emises_source_de_la_vente=23'],

    -- ══ La correction de la facture (31/10/2026, reprise le 02/11/2026 pour FACTURE-Q1) : ce que la validation exige ═════
    -- Chaque contrôle attend l'état où la base se trouve (`correction`) : sans la migration, la validation passe — le
    -- défaut. Chaque mutation (« M… ») rejoue le contrôle qui la précède, la cause du refus ôtée — le statut posé, ou le
    -- cabinet pour auteur — : elle passe, dans les deux états, et prouve que le refus n'est pas vrai par construction. K est
    -- redevable ; F en franchise ; E exonéré pour ses soins ; N au statut à préciser ; S exonéré sans article et V au
    -- statut à préciser, basculés, deux sociétés dont le client a un accès « Ventes ».
    array['jeu', 'la correction : six dossiers jetables, les accès « Ventes » du client à S et à V', 'postgres', $q$insert into dossiers (id, nom, cabinet_id, statut_tva, article_exoneration, siret, adresse, ventes_par_les_factures, forme_juridique, denomination_imprimee) values
      ('{CK}', 'ESSAI FACTURES K', '{CAB}', 'redevable', null, null, null, false, null, null), ('{CF}', 'ESSAI FACTURES F', '{CAB}', 'franchise', null, null, null, false, null, null),
      ('{CE}', 'ESSAI FACTURES E', '{CAB}', 'exonere', 'cgi_261_4_1', null, null, false, null, null), ('{CN}', 'ESSAI FACTURES N', '{CAB}', null, null, null, null, false, null, null),
      ('{CS}', 'ESSAI FACTURES S', '{CAB}', 'exonere', null, '12345678200010', 'ESSAI FACTURES ADRESSE S', true, '5710', 'ESSAI FACTURES SOCIÉTÉ S'),
      ('{CV}', 'ESSAI FACTURES V', '{CAB}', null, null, '12345678200010', 'ESSAI FACTURES ADRESSE V', true, '5710', 'ESSAI FACTURES SOCIÉTÉ V');
      insert into memberships (id, user_id, dossier_id, role, email, droit_ventes) values ('{ACS}', '{CLIENT}', '{CS}', 'client', 'essai-factures-s@example.test', true),
      ('{ACV}', '{CLIENT}', '{CV}', 'client', 'essai-factures-v@example.test', true)$q$, '', ''],
    array['fait', 'A9a : la série d''hier au cabinet dans K, F, E, N, S et V', 'chef', $q$do $a9a$
      declare d uuid; m record;
      begin
        if to_regprocedure('public.fixer_modele_numerotation(uuid, text, text, text, boolean, integer, integer)') is null then
          return;
        end if;
        foreach d in array array['{CK}', '{CF}', '{CE}', '{CN}', '{CS}', '{CV}']::uuid[] loop
          for m in select * from (values (1, 'facture', 'client', 'C{AAAA}-{N:4}'), (2, 'avoir', 'client', 'D{AAAA}-{N:4}'),
                                         (3, 'facture', 'mandataire', 'F{AAAA}-{N:4}'), (4, 'avoir', 'mandataire', 'A{AAAA}-{N:4}')) as v(rang, nature, emetteur, modele)
                   order by v.rang loop
            perform fixer_modele_numerotation(d, m.nature, m.emetteur, m.modele, true, 2000);
          end loop;
        end loop;
      end $a9a$$q$, 'OK', ''],
    -- 1. Le statut de TVA à préciser (FACTURE-Q1, la réponse du cabinet du 02/11/2026 : « seulement depuis l'espace
    -- client ») : le client « Ventes » ne valide pas une facture ; le cabinet la valide encore, dans un dossier basculé
    -- comme dans un autre ; l'avoir du client n'en est pas jugé. La facture de V porte la mention de la franchise : sans
    -- statut, aucune n'est exigée, et la mutation M107b, la franchise posée, rejoue le même appel.
    array['controle', '107. une facture d''un dossier au statut de TVA à préciser : le client « Ventes » ne la valide pas', 'client', $q$select enregistrer_facture('{CV}', null, '{"tiers_nom":"ESSAI CLIENT V","type_client":"assujetti","tiers_adresse":"Adresse fictive du client","nature_operation":"services","date_emission":"2026-03-10","emetteur_nom":"ESSAI FACTURES V","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI FACTURES ADRESSE V","mentions_legales":"TVA non applicable, art. 293 B du CGI.","montant_ht":10,"montant_tva":0,"montant_ttc":10}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":0}]'::jsonb, true)$q$,
      case when correction then '22023' else 'OK' end,
      case when correction then 'Le statut de TVA du dossier est à préciser : la mention de TVA et le numéro de TVA qu''une facture imprime en dépendent. Le cabinet le précise avant qu''une facture se valide depuis l''espace client.' else '' end],
    array['controle', '107b. … son brouillon s''enregistre', 'client', $q$select enregistrer_facture('{CV}', null, '{"tiers_nom":"ESSAI CLIENT V","type_client":"assujetti","tiers_adresse":"Adresse fictive du client","nature_operation":"services","date_emission":"2026-03-10","emetteur_nom":"ESSAI FACTURES V","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI FACTURES ADRESSE V","mentions_legales":"TVA non applicable, art. 293 B du CGI.","montant_ht":10,"montant_tva":0,"montant_ttc":10}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":0}]'::jsonb, false)$q$, 'OK', ''],
    array['controle', 'M107. le contrôle 107 rejoué par le cabinet : il valide encore la facture (FACTURE-Q1)', 'chef', $q$select enregistrer_facture('{CV}', null, '{"tiers_nom":"ESSAI CLIENT V","type_client":"assujetti","tiers_adresse":"Adresse fictive du client","nature_operation":"services","date_emission":"2026-03-10","emetteur_nom":"ESSAI FACTURES V","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI FACTURES ADRESSE V","mentions_legales":"TVA non applicable, art. 293 B du CGI.","montant_ht":10,"montant_tva":0,"montant_ttc":10}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":0}]'::jsonb, true)$q$, 'OK', ''],
    array['controle', '107a. … et dans un dossier qui n''a pas basculé, le cabinet la valide aussi', 'chef', $q$select enregistrer_facture('{CN}', null, '{"tiers_nom":"ESSAI N","date_emission":"2026-03-02","montant_ht":10,"montant_tva":0,"montant_ttc":10}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":0}]'::jsonb, true)$q$, 'OK', ''],
    array['fait', 'la restauration pose une facture validée dans V, qui n''a jamais validé', 'chef', $q$insert into factures_emises (id, dossier_id, tiers_nom, statut, numero, validated_at, date_emission, montant_ht, montant_tva, montant_ttc, nature_operation) values ('{CR}', '{CV}', 'ESSAI V RESTAURÉE', 'validee', 'F2026-0001', now(), '2026-02-01', 10, 0, 10, 'services')$q$, 'OK', ''],
    array['controle', '107c. l''avoir du client « Ventes » n''est pas jugé sur le statut : la voie de la correction reste ouverte', 'client', $q$select enregistrer_facture('{CV}', null, jsonb_build_object('type', 'avoir', 'facture_origine_id', '{CR}', 'date_emission', '2026-02-05', 'montant_ht', -10, 'montant_tva', 0, 'montant_ttc', -10), '[{"designation":"x","quantite":-1,"prix_unitaire_ht":10,"taux_tva":0}]'::jsonb, true)$q$, 'OK', ''],
    array['jeu', 'le statut de TVA de V posé : la franchise', 'postgres', $q$update dossiers set statut_tva = 'franchise' where id = '{CV}'$q$, '', ''],
    array['controle', 'M107b. le contrôle 107 rejoué, le statut posé : le client « Ventes » valide la facture', 'client', $q$select enregistrer_facture('{CV}', null, '{"tiers_nom":"ESSAI CLIENT V","type_client":"assujetti","tiers_adresse":"Adresse fictive du client","nature_operation":"services","date_emission":"2026-03-10","emetteur_nom":"ESSAI FACTURES V","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI FACTURES ADRESSE V","mentions_legales":"TVA non applicable, art. 293 B du CGI.","montant_ht":10,"montant_tva":0,"montant_ttc":10}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":0}]'::jsonb, true)$q$, 'OK', ''],
    -- 2. L'exonération sans article : le client « Ventes » ne valide pas, le cabinet si.
    array['controle', '108. un dossier exonéré sans article : le client « Ventes » ne valide pas', 'client', $q$select enregistrer_facture('{CS}', null, '{"tiers_nom":"ESSAI CLIENT S","type_client":"assujetti","tiers_adresse":"Adresse fictive du client","nature_operation":"services","date_emission":"2026-03-10","emetteur_nom":"ESSAI FACTURES S","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI FACTURES ADRESSE S","montant_ht":10,"montant_tva":0,"montant_ttc":10}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":0}]'::jsonb, true)$q$,
      case when correction then '22023' else 'OK' end,
      case when correction then 'Le dossier est exonéré de TVA sans article d''exonération : la mention qu''une facture porte en dépend. Le cabinet choisit l''article avant qu''une facture se valide depuis l''espace client.' else '' end],
    array['controle', 'M108. le contrôle 108 rejoué par le cabinet : il valide, la mention d''un article hors de la liste étant à sa main', 'chef', $q$select enregistrer_facture('{CS}', null, '{"tiers_nom":"ESSAI CLIENT S","type_client":"assujetti","tiers_adresse":"Adresse fictive du client","nature_operation":"services","date_emission":"2026-03-10","emetteur_nom":"ESSAI FACTURES S","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI FACTURES ADRESSE S","montant_ht":10,"montant_tva":0,"montant_ttc":10}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":0}]'::jsonb, true)$q$, 'OK', ''],
    -- 3. La mention de TVA, au caractère près, d'une facture comme d'un avoir ; un redevable n'en doit aucune.
    array['controle', '109. un dossier en franchise : sans « TVA non applicable, art. 293 B du CGI. », la facture ne se valide pas', 'chef', $q$select enregistrer_facture('{CF}', null, '{"tiers_nom":"ESSAI F","date_emission":"2026-03-02","mentions_legales":"Paiement à réception.","montant_ht":50,"montant_tva":0,"montant_ttc":50}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":50,"taux_tva":0}]'::jsonb, true)$q$,
      case when correction then '22023' else 'OK' end,
      case when correction then 'Les mentions légales ne portent pas la mention de TVA du dossier, « TVA non applicable, art. 293 B du CGI. » : une facture ou un avoir qui ne facture pas de TVA la porte telle quelle (CGI, ann. II, art. 242 nonies A, I ; art. 293 B pour la franchise en base).' else '' end],
    array['controle', 'M109. le contrôle 109 rejoué, la mention parmi les autres : la facture se valide', 'chef', $q$select enregistrer_facture('{CF}', null, '{"tiers_nom":"ESSAI F","date_emission":"2026-03-02","mentions_legales":"Paiement à réception. TVA non applicable, art. 293 B du CGI. Merci.","montant_ht":50,"montant_tva":0,"montant_ttc":50}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":50,"taux_tva":0}]'::jsonb, true)$q$, 'OK', ''],
    array['controle', '110. un dossier exonéré pour ses soins : la mention d''une autre exonération ne vaut pas la sienne', 'chef', $q$select enregistrer_facture('{CE}', null, '{"tiers_nom":"ESSAI E","date_emission":"2026-03-02","mentions_legales":"Exonération de TVA, art. 261, 4, 4° a du CGI.","montant_ht":50,"montant_tva":0,"montant_ttc":50}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":50,"taux_tva":0}]'::jsonb, true)$q$,
      case when correction then '22023' else 'OK' end,
      case when correction then 'Les mentions légales ne portent pas la mention de TVA du dossier, « Exonération de TVA, art. 261, 4, 1° du CGI. » : une facture ou un avoir qui ne facture pas de TVA la porte telle quelle (CGI, ann. II, art. 242 nonies A, I ; art. 293 B pour la franchise en base).' else '' end],
    array['controle', '110b. … ni la sienne sans son point final : la mention se porte telle quelle', 'chef', $q$select enregistrer_facture('{CE}', null, '{"tiers_nom":"ESSAI E","date_emission":"2026-03-02","mentions_legales":"Exonération de TVA, art. 261, 4, 1° du CGI","montant_ht":50,"montant_tva":0,"montant_ttc":50}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":50,"taux_tva":0}]'::jsonb, true)$q$,
      case when correction then '22023' else 'OK' end,
      case when correction then 'Les mentions légales ne portent pas la mention de TVA du dossier, « Exonération de TVA, art. 261, 4, 1° du CGI. »%' else '' end],
    array['controle', 'M110. le contrôle 110 rejoué avec la mention de son article : la facture se valide', 'chef', $q$select enregistrer_facture('{CE}', null, '{"tiers_nom":"ESSAI E","date_emission":"2026-03-02","mentions_legales":"Exonération de TVA, art. 261, 4, 1° du CGI.","montant_ht":50,"montant_tva":0,"montant_ttc":50}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":50,"taux_tva":0}]'::jsonb, true)$q$, 'OK', ''],
    array['fait', 'une facture de F, validée avec sa mention', 'chef', $q$select enregistrer_facture('{CF}', null, '{"tiers_nom":"ESSAI F","date_emission":"2026-03-02","mentions_legales":"TVA non applicable, art. 293 B du CGI.","montant_ht":50,"montant_tva":0,"montant_ttc":50}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":50,"taux_tva":0}]'::jsonb, true)$q$, 'OK', ''],
    array['controle', '111. son avoir sans la mention ne se crée pas : un avoir est une facture qui en corrige une autre', 'chef', $q$select enregistrer_facture('{CF}', null, jsonb_build_object('type', 'avoir', 'facture_origine_id', (select id from factures_emises where dossier_id = '{CF}' and numero = 'F2026-0001'), 'date_emission', '2026-03-05', 'montant_ht', -10, 'montant_tva', 0, 'montant_ttc', -10), '[{"designation":"x","quantite":-1,"prix_unitaire_ht":10,"taux_tva":0}]'::jsonb, true)$q$,
      case when correction then '22023' else 'OK' end,
      case when correction then 'Les mentions légales ne portent pas la mention de TVA du dossier, « TVA non applicable, art. 293 B du CGI. »%' else '' end],
    array['controle', 'M111. le contrôle 111 rejoué avec la mention : l''avoir se crée', 'chef', $q$select enregistrer_facture('{CF}', null, jsonb_build_object('type', 'avoir', 'facture_origine_id', (select id from factures_emises where dossier_id = '{CF}' and numero = 'F2026-0001'), 'date_emission', '2026-03-05', 'mentions_legales', 'TVA non applicable, art. 293 B du CGI.', 'montant_ht', -10, 'montant_tva', 0, 'montant_ttc', -10), '[{"designation":"x","quantite":-1,"prix_unitaire_ht":10,"taux_tva":0}]'::jsonb, true)$q$, 'OK', ''],
    array['controle', '111b. un redevable ne doit aucune mention de TVA : sa facture sans mentions se valide', 'chef', $q$select enregistrer_facture('{CK}', null, '{"tiers_nom":"ESSAI K","date_emission":"2026-03-02","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true)$q$, 'OK', ''],
    -- 4. Une date à venir ; le cas neutre, une facture du jour.
    array['controle', '112. une facture datée de demain ne se valide pas', 'chef', $q$select enregistrer_facture('{CK}', null, '{"tiers_nom":"ESSAI K","date_emission":"{DEMAIN}","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true)$q$,
      case when correction then '22023' else 'OK' end,
      case when correction then 'La date d''émission, le ' || to_char(demain, 'DD/MM/YYYY') || ', est à venir : nous sommes le ' || to_char(aujourdhui, 'DD/MM/YYYY') || ' à Paris. Une facture ou un avoir se valide daté du jour au plus tard, sa numérotation suivant l''ordre des dates d''émission (CGI, ann. II, art. 242 nonies A, I, 7°).' else '' end],
    array['controle', '112b. … son brouillon s''enregistre', 'chef', $q$select enregistrer_facture('{CK}', null, '{"tiers_nom":"ESSAI K","date_emission":"{DEMAIN}","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false)$q$, 'OK', ''],
    array['controle', 'M112. le contrôle 112 rejoué daté du jour (le cas neutre) : la facture se valide', 'chef', $q$select enregistrer_facture('{CK}', null, '{"tiers_nom":"ESSAI K","date_emission":"{AUJ}","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true)$q$, 'OK', ''],
    -- 5. L'ordre des dates dans la série : le brouillon du 02/12/2025 attend, la facture du 05/12/2025 se valide avant lui.
    array['fait', 'un brouillon du 02/12/2025 attend', 'chef', $q$select enregistrer_facture('{CK}', null, '{"tiers_nom":"ESSAI K 02/12","date_emission":"2025-12-02","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false)$q$, 'OK', ''],
    array['fait', 'une facture du 05/12/2025 se valide avant lui', 'chef', $q$select enregistrer_facture('{CK}', null, '{"tiers_nom":"ESSAI K 05/12","date_emission":"2025-12-05","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true)$q$, 'OK', ''],
    array['controle', '113. le brouillon du 02/12/2025 ne se valide plus après elle : son numéro serait daté d''avant le précédent', 'chef', $q$select enregistrer_facture('{CK}', (select id from factures_emises where dossier_id = '{CK}' and tiers_nom = 'ESSAI K 02/12'), '{"tiers_nom":"ESSAI K 02/12","date_emission":"2025-12-02","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true)$q$,
      case when correction then '22023' else 'OK' end,
      case when correction then 'La date d''émission, le 02/12/2025, précède celle de F2025-0001 (le 05/12/2025), la plus récente de la même série : les numéros suivent l''ordre des dates d''émission (CGI, ann. II, art. 242 nonies A, I, 7°). Une date du 05/12/2025 ou d''après se valide.' else '' end],
    array['controle', 'M113. le contrôle 113 rejoué, le brouillon redaté du 05/12/2025 : il se valide, à la suite', 'chef', $q$select enregistrer_facture('{CK}', (select id from factures_emises where dossier_id = '{CK}' and tiers_nom = 'ESSAI K 02/12'), '{"tiers_nom":"ESSAI K 02/12","date_emission":"2025-12-05","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true)$q$, 'OK', ''],
    array['controle', '113b. une autre année n''est pas la même série : une facture du 02/12/2024 se valide', 'chef', $q$select enregistrer_facture('{CK}', null, '{"tiers_nom":"ESSAI K 2024","date_emission":"2024-12-02","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true)$q$, 'OK', ''],
    array['fait', 'un avoir de F2025-0001, du 06/12/2025', 'chef', $q$select enregistrer_facture('{CK}', null, jsonb_build_object('type', 'avoir', 'facture_origine_id', (select id from factures_emises where dossier_id = '{CK}' and numero = 'F2025-0001'), 'date_emission', '2025-12-06', 'montant_ht', -1, 'montant_tva', -0.2, 'montant_ttc', -1.2), '[{"designation":"x","quantite":-1,"prix_unitaire_ht":1,"taux_tva":20}]'::jsonb, true)$q$, 'OK', ''],
    array['controle', '114. un avoir du 05/12/2025 ne se crée plus après celui du 06/12/2025 : les avoirs ont leur série', 'chef', $q$select enregistrer_facture('{CK}', null, jsonb_build_object('type', 'avoir', 'facture_origine_id', (select id from factures_emises where dossier_id = '{CK}' and numero = 'F2025-0001'), 'date_emission', '2025-12-05', 'montant_ht', -1, 'montant_tva', -0.2, 'montant_ttc', -1.2), '[{"designation":"x","quantite":-1,"prix_unitaire_ht":1,"taux_tva":20}]'::jsonb, true)$q$,
      case when correction then '22023' else 'OK' end,
      case when correction then 'La date d''émission, le 05/12/2025, précède celle de A2025-0001 (le 06/12/2025), la plus récente de la même série : les numéros suivent l''ordre des dates d''émission (CGI, ann. II, art. 242 nonies A, I, 7°). Une date du 06/12/2025 ou d''après se valide.' else '' end],
    array['controle', 'M114. le contrôle 114 rejoué daté du 06/12/2025 : l''avoir se crée', 'chef', $q$select enregistrer_facture('{CK}', null, jsonb_build_object('type', 'avoir', 'facture_origine_id', (select id from factures_emises where dossier_id = '{CK}' and numero = 'F2025-0001'), 'date_emission', '2025-12-06', 'montant_ht', -1, 'montant_tva', -0.2, 'montant_ttc', -1.2), '[{"designation":"x","quantite":-1,"prix_unitaire_ht":1,"taux_tva":20}]'::jsonb, true)$q$, 'OK', ''],
    array['valeur', '115. la série de K : la facture du 05/12/2025, son avoir, le brouillon qui attend toujours', 'postgres', $q$select string_agg(coalesce(numero, 'brouillon') || ' ' || date_emission, '|' order by date_emission, numero) from factures_emises where dossier_id = '{CK}'$q$, '', 'brouillon 2025-12-02|F2025-0001 2025-12-05|A2025-0001 2025-12-06'],
    array['valeur', '116. la garde reste définisseuse, son chemin fixé, hors de portée en RPC', 'postgres', $q$select concat_ws('|', p.prosecdef, array_to_string(p.proconfig, ','), has_function_privilege('anon', p.oid, 'execute'), has_function_privilege('authenticated', p.oid, 'execute')) from pg_proc p where p.oid = to_regprocedure('public.garder_factures_validees()')$q$, '', 't|search_path=public|f|f']
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

  -- ══ 106. Rien n'est resté ══════════
  select string_agg(n::text, '/') into apres from (values
    ((select count(*) from dossiers)), ((select count(*) from cabinets)), ((select count(*) from cabinet_admins)),
    ((select count(*) from factures_emises)), ((select count(*) from facture_lignes)), ((select count(*) from facture_numerotation))
  ) as t(n);
  -- L'écart seul, non plus les comptes de toute la base, qui diraient le volume d'un dossier réel (audit du 29/10/2026).
  verdicts := verdicts || jsonb_build_object('controle', '106. rien n''est resté en base',
    'observe', 'écarts ' || (select string_agg(to_char(ecart_.apres_::bigint - ecart_.avant_::bigint, 'FMSG9999999990'), '/' order by ecart_.rang_) from unnest(string_to_array(avant, '/'), string_to_array(apres, '/')) with ordinality as ecart_(avant_, apres_, rang_)),
    'ok', avant = apres and not exists (select 1 from dossiers where nom like 'ESSAI FACTURES%')
      and not exists (select 1 from cabinet_admins where user_id = client));

  perform set_config('essai.factures', verdicts::text, true);
end $essai$;

select v.controle, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.factures')::jsonb) as v(controle text, ok boolean, observe text)
order by (regexp_match(v.controle, '^(\d+)'))[1]::int, v.controle;
