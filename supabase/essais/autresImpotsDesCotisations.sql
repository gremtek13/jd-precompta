-- LA PART « AUTRES IMPÔTS » D'UNE ÉCHÉANCE DE COTISATION : LA CFP ET LA CURPS EN BS (EXP58-Q6 et EXP58-Q7 ; la migration
-- préparée `autres_impots_des_cotisations`, supabase/preparees/20261119120000_autres_impots_des_cotisations.sql). Le récit :
-- HISTORIQUE.md, « 19/11/2026 — EXP58-Q6 ET EXP58-Q7 : LA PART « AUTRES IMPÔTS » D'UNE ÉCHÉANCE (PRÉPARÉE, PAS APPLIQUÉE) ». À
-- rejouer après toute migration qui touche `rapprocher_cotisation`, `enregistrer_paiement_personnel_cotisation`,
-- `garder_paiement_personnel`, `garder_cotisation_valide`, la table `cotisations_declarees`, le catalogue des rôles
-- (`roles_comptables`) ou `regler_plan_du_dossier`. SANS LA MIGRATION (la colonne absente du catalogue), il se dit EN ATTENTE.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   1. LE CATALOGUE : une colonne nullable sans défaut ; le rôle `autres_impots` (635 et 637, 637800, « Taxes diverses », sans
--      préfixe, rang 660) ; les corps des trois fonctions, leur sécurité (le rapprochement aux droits de l'appelant, le paiement
--      personnel et la garde aux droits du propriétaire) et leurs droits d'exécution (la garde, à aucun rôle de session) ;
--   2. LE PLAN : un dossier sans plan lit le rôle à son défaut ; un plan réglé par le chef le tient sous ses racines, et
--      `regler_plan_du_dossier` refuse un compte hors d'elles ;
--   3. LE RAPPROCHEMENT : en trésorerie, la part au compte du rôle, la cotisation hors CSG-CRDS et hors part, la CSG-CRDS au
--      compte de l'exploitant ; l'écriture d'hier, sans la ligne de la part, se refuse ; une part qui n'est pas au centime, une
--      part qui dépasse le mouvement avec la CSG-CRDS, se refusent sous leurs mots ; en engagement, la part se sépare (la CSG-CRDS
--      non) ; un remboursement la crédite ; une échéance faite toute de CSG-CRDS et de part n'a pas de ligne de cotisation, et
--      une ligne à zéro se refuse ; sans part, l'écriture d'hier ; un plan réglé déplace la ligne ; le client se fait refuser ;
--   4. LE PAIEMENT DEPUIS LE COMPTE PERSONNEL : la même ligne de plus, face au compte du dirigeant, qui porte l'échéance hors
--      CSG-CRDS ; l'écriture d'hier se refuse ; le dépassement se refuse ; en engagement, face au compte choisi ;
--   5. LE FIGEMENT : la part d'une échéance payée depuis le compte personnel ne change plus tant que ce paiement tient, celle
--      d'une échéance d'un exercice validé non plus, sous les mots de la base ; ailleurs, elle se saisit.
--
-- Trois dossiers jetables du cabinet du dossier `test` (préfixe `a17e0000-0000-4000-8000`) : DT, en trésorerie, sans plan ; DE,
-- en engagement, le dirigeant au 455000 ; DP, en trésorerie, que le chef règle (la part au 635800) dans l'étape qui l'éprouve.
-- Chaque étape se joue dans sa sous-transaction et s'y ANNULE (`ANNULATION_ETAPE`) : ce que le propriétaire pose d'abord, puis
-- le geste (du chef ou du client sous la RLS, ou du propriétaire), puis la fin de la transaction simulée, puis ce qu'on relit ;
-- le jeu s'annule à la fin (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le relit. Les verdicts voyagent dans un
-- réglage LOCAL à la transaction (`essai.autres_impots_des_cotisations`) : le fichier se joue d'un seul appel, ne crée ni
-- table ni fonction, ne contient aucune instruction de suppression, et ne rend rien qui dépende d'une ligne hors de ses
-- dossiers. Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`).
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  dt constant text := 'a17e0000-0000-4000-8000-0000000000d1';
  de constant text := 'a17e0000-0000-4000-8000-0000000000d2';
  dp constant text := 'a17e0000-0000-4000-8000-0000000000d3';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  appliquee constant boolean := exists (select 1 from pg_attribute a where a.attrelid = 'public.cotisations_declarees'::regclass
                                          and a.attname = 'montant_autres_impots' and not a.attisdropped);
  -- Les mots de la base.
  pas_conforme constant text := 'L''écriture proposée ne correspond pas à ce mouvement et à cette échéance.';
  pas_conforme_perso constant text := 'L''écriture proposée ne correspond pas à cette échéance et au compte du dirigeant (%).';
  payee_perso constant text := 'Cette échéance est payée depuis le compte personnel, le 10/03/2026 : ni ses montants ni son dossier ne changent tant que ce paiement n''est pas retiré.';
  fige constant text := 'L''exercice 2025 est validé : cette échéance ne change plus.';
  valide_2025 constant text := $q$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes,
    nb_ecritures, total_debit, total_credit, empreinte, declaration) values ('{DT}', 2025, now(), '{CHEF}', 'tresorerie', 0, 0, 0, 0,
    repeat('0', 64), '{}'::jsonb);$q$;
  -- Le chef, pour ce que le propriétaire pose par une fonction qui lit la session (un plan réglé, un paiement personnel).
  en_chef constant text := $q$select set_config('request.jwt.claims', json_build_object('sub', '{CHEF}', 'role', 'authenticated')::text, true);$q$;
  -- Les lignes du brouillon d'un mouvement, ou d'une échéance payée depuis le compte personnel.
  lignes_du constant text := $q$(select coalesce(string_agg(e.compte || ':' || e.sens || ':' || e.montant::text, ',' order by e.compte, e.sens), 'aucune')
    from ecritures_brouillon e where e.ligne_bancaire_id = '{X}')$q$;
  lignes_de constant text := $q$(select coalesce(string_agg(e.compte || ':' || e.sens || ':' || e.montant::text, ',' order by e.compte, e.sens), 'aucune')
    from ecritures_brouillon e where e.cotisation_id = '{X}')$q$;
  e record; v_code text; v_msg text; v_obs text; v_textes text[];
  verdicts jsonb := '[]'::jsonb;
begin
  if not appliquee then
    perform set_config('essai.autres_impots_des_cotisations', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration autres_impots_des_cotisations (EXP58-Q6)', 'ok', true,
      'observe', 'absente : la part « autres impôts » d''une échéance ne se saisit pas encore ; l''essai se joue dès qu''elle y est'))::text, true);
    return;
  end if;
  begin
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values
      (dt::uuid, 'ESSAI EXP58Q6 DT', cabinet, 'tresorerie', '455000'),
      (de::uuid, 'ESSAI EXP58Q6 DE', cabinet, 'engagement', '455000'),
      (dp::uuid, 'ESSAI EXP58Q6 DP', cabinet, 'tresorerie', '455000');
    insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values
      ('a17e0000-0000-4000-8000-0000000000a1', dt::uuid, '2026-03-05', 'ESSAI EXP58Q6 PRLV', -500, 'non_rapprochee'),
      ('a17e0000-0000-4000-8000-0000000000a2', dt::uuid, '2026-03-06', 'ESSAI EXP58Q6 REMB', 300, 'non_rapprochee'),
      ('a17e0000-0000-4000-8000-0000000000a3', dt::uuid, '2026-03-07', 'ESSAI EXP58Q6 PRLV', -80, 'non_rapprochee'),
      ('a17e0000-0000-4000-8000-0000000000a4', de::uuid, '2026-03-05', 'ESSAI EXP58Q6 PRLV', -500, 'non_rapprochee'),
      ('a17e0000-0000-4000-8000-0000000000a5', dp::uuid, '2026-03-05', 'ESSAI EXP58Q6 PRLV', -500, 'non_rapprochee');
    insert into cotisations_declarees (id, dossier_id, echeance, montant_appele, montant_csg_crds, montant_autres_impots) values
      -- C1 : 500 € dont 60 de CSG-CRDS et 20 de CFP et de CURPS ; C2 : une part au millième ; C3 : 60 + 450 dépassent 500.
      ('a17e0000-0000-4000-8000-0000000000c1', dt::uuid, '2026-03-05', 500, 60, 20),
      ('a17e0000-0000-4000-8000-0000000000c2', dt::uuid, '2026-03-05', 500, 60, 20.005),
      ('a17e0000-0000-4000-8000-0000000000c3', dt::uuid, '2026-03-05', 500, 60, 450),
      -- C4 : un remboursement de 300 €, 30 de CSG-CRDS et 10 de part, imprimés en positif ; C5 : sans part, l'échéance d'hier.
      ('a17e0000-0000-4000-8000-0000000000c4', dt::uuid, '2026-03-06', -300, 30, 10),
      ('a17e0000-0000-4000-8000-0000000000c5', dt::uuid, '2026-03-05', 500, 60, null),
      -- C6 : 80 €, toute de CSG-CRDS (60) et de part (20) ; C7 : à payer depuis le compte personnel ; C8 : une échéance de 2025.
      ('a17e0000-0000-4000-8000-0000000000c6', dt::uuid, '2026-03-07', 80, 60, 20),
      ('a17e0000-0000-4000-8000-0000000000c7', dt::uuid, '2026-03-05', 500, 60, 20),
      ('a17e0000-0000-4000-8000-0000000000c8', dt::uuid, '2025-11-05', 500, 60, null),
      -- En engagement : E1 sépare la part, pas la CSG-CRDS ; E2, une part de 600 € sur un mouvement de 500 €.
      ('a17e0000-0000-4000-8000-0000000000e1', de::uuid, '2026-03-05', 500, 60, 20),
      ('a17e0000-0000-4000-8000-0000000000e2', de::uuid, '2026-03-05', 500, 60, 600),
      -- P1 : dans le dossier dont le chef règle le plan.
      ('a17e0000-0000-4000-8000-0000000000f1', dp::uuid, '2026-03-05', 500, 60, 20);

    -- Une étape : {rang, étape, ce que le PROPRIÉTAIRE pose d'abord, qui fait le geste (`chef` ou `client` sous la RLS,
    -- `proprio` hors d'elle), le geste, ce qu'on relit, le code attendu (`OK` : accepté) et ce qu'on relit, ou les mots du refus
    -- (un `%` s'y lit comme dans LIKE)}.
    for e in select * from (values
      (1, '1. le catalogue : la colonne nullable sans défaut ; le rôle (635, 637 ; 637800 « Taxes diverses » ; sans préfixe ; rang 660) ; les corps des trois fonctions, leur sécurité, et l''exécution de la garde refusée aux rôles de session',
        null, 'proprio', null,
        $q$(select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull::text || ' ' || a.atthasdef::text, ', ')
             from pg_attribute a where a.attrelid = 'public.cotisations_declarees'::regclass and a.attname = 'montant_autres_impots' and not a.attisdropped)
           || ' | ' || (select r.racines::text || ' ' || r.compte_defaut || ' ' || r.libelle_defaut || ' ' || coalesce(r.prefixe_auxiliaire_defaut, '-') || ' ' || r.ordre
                         from roles_comptables r where r.role = 'autres_impots')
           || ' | ' || (select string_agg(p.proname || '=' || md5(replace(p.prosrc, chr(13), '')) || ':' || p.prosecdef::text, ',' order by p.proname) from pg_proc p
                         where p.oid in ('public.rapprocher_cotisation(uuid, uuid, jsonb)'::regprocedure,
                                         'public.enregistrer_paiement_personnel_cotisation(uuid, uuid, date, jsonb)'::regprocedure,
                                         'public.garder_paiement_personnel()'::regprocedure))
           || ' | ' || has_function_privilege('authenticated', 'public.rapprocher_cotisation(uuid, uuid, jsonb)', 'execute')::text
           || ' ' || has_function_privilege('authenticated', 'public.enregistrer_paiement_personnel_cotisation(uuid, uuid, date, jsonb)', 'execute')::text
           || ' ' || (has_function_privilege('authenticated', 'public.garder_paiement_personnel()', 'execute')
                      or has_function_privilege('anon', 'public.garder_paiement_personnel()', 'execute'))::text$q$,
        'OK', 'montant_autres_impots numeric false false | {635,637} 637800 Taxes diverses - 660'
          || ' | enregistrer_paiement_personnel_cotisation=afd3787e3bdaff1744b4d0b23ed4b1b8:true,garder_paiement_personnel=6419de487f2f90f7f9e5a5b59a689c09:true,rapprocher_cotisation=1335506cd5644999189fb74496a06ea8:false'
          || ' | true true false'),
      (2, '2. le plan : un dossier sans plan lit le rôle à son défaut, au catalogue',
        null, 'chef', null,
        $q$(select p.compte || ' ' || p.libelle || ' ' || p.origine || ' ' || compte_du_role('{DT}', 'autres_impots') from plan_du_dossier('{DT}') p where p.role = 'autres_impots')$q$,
        'OK', '637800 Taxes diverses application 637800'),
      (3, '2b. … le chef le règle sous ses racines (637000), et la base le lit',
        null, 'chef', $q$select regler_plan_du_dossier('{DP}', '[{"role": "autres_impots", "compte": "637000"}]'::jsonb);$q$,
        $q$(select compte_du_role('{DP}', 'autres_impots'))$q$, 'OK', '637000'),
      (4, '2c. … et pas hors d''elles (646100)',
        null, 'chef', $q$select regler_plan_du_dossier('{DP}', '[{"role": "autres_impots", "compte": "646100"}]'::jsonb);$q$,
        null, '22023', 'Le compte du rôle « autres_impots » commence par sa racine du plan comptable (%) : « 646100 » n''en est pas un.'),
      (5, '3. le rapprochement en trésorerie : la part au 637800, la cotisation hors CSG-CRDS et hors part au 646000, la CSG-CRDS au 108000, face à la banque',
        null, 'chef', $q$select rapprocher_cotisation('{LT1}', '{C1}', '[{"compte": "512000", "sens": "credit", "montant": 500},
          {"compte": "646000", "sens": "debit", "montant": 420}, {"compte": "108000", "sens": "debit", "montant": 60},
          {"compte": "637800", "sens": "debit", "montant": 20, "libelle": "ESSAI EXP58Q6"}]'::jsonb);$q$,
        replace(lignes_du, '{X}', '{LT1}'), 'OK', '108000:debit:60,512000:credit:500,637800:debit:20,646000:debit:420'),
      (6, '3b. … l''écriture d''hier, sans la ligne de la part, se refuse',
        null, 'chef', $q$select rapprocher_cotisation('{LT1}', '{C1}', '[{"compte": "512000", "sens": "credit", "montant": 500},
          {"compte": "646000", "sens": "debit", "montant": 440}, {"compte": "108000", "sens": "debit", "montant": 60}]'::jsonb);$q$,
        null, '22023', pas_conforme),
      (7, '3c. … une part qui n''est pas au centime se refuse',
        null, 'chef', $q$select rapprocher_cotisation('{LT1}', '{C2}', '[{"compte": "512000", "sens": "credit", "montant": 500}]'::jsonb);$q$,
        null, '22023', 'La part « autres impôts » de cette échéance n''est pas au centime.'),
      (8, '3d. … une part qui, avec la CSG-CRDS, dépasse le mouvement se refuse',
        null, 'chef', $q$select rapprocher_cotisation('{LT1}', '{C3}', '[{"compte": "512000", "sens": "credit", "montant": 500}]'::jsonb);$q$,
        null, '22023', 'La CSG-CRDS et la part « autres impôts » de cette échéance (510,00 €) dépassent le mouvement (500,00 €).'),
      (9, '3e. en engagement, la part se sépare et la CSG-CRDS reste au 646000',
        null, 'chef', $q$select rapprocher_cotisation('{LE1}', '{E1}', '[{"compte": "512000", "sens": "credit", "montant": 500},
          {"compte": "646000", "sens": "debit", "montant": 480}, {"compte": "637800", "sens": "debit", "montant": 20}]'::jsonb);$q$,
        replace(lignes_du, '{X}', '{LE1}'), 'OK', '512000:credit:500,637800:debit:20,646000:debit:480'),
      (10, '3f. … et une part plus forte que le mouvement s''y refuse sous ses mots, sans la CSG-CRDS',
        null, 'chef', $q$select rapprocher_cotisation('{LE1}', '{E2}', '[{"compte": "512000", "sens": "credit", "montant": 500}]'::jsonb);$q$,
        null, '22023', 'La part « autres impôts » de cette échéance (600,00 €) dépasse le mouvement (500,00 €).'),
      (11, '3g. un remboursement crédite la part, comme la cotisation et la CSG-CRDS',
        null, 'chef', $q$select rapprocher_cotisation('{LT2}', '{C4}', '[{"compte": "512000", "sens": "debit", "montant": 300},
          {"compte": "646000", "sens": "credit", "montant": 260}, {"compte": "108000", "sens": "credit", "montant": 30},
          {"compte": "637800", "sens": "credit", "montant": 10}]'::jsonb);$q$,
        replace(lignes_du, '{X}', '{LT2}'), 'OK', '108000:credit:30,512000:debit:300,637800:credit:10,646000:credit:260'),
      (12, '3h. le contrôle positif d''hier : sans part, l''écriture d''hier',
        null, 'chef', $q$select rapprocher_cotisation('{LT1}', '{C5}', '[{"compte": "512000", "sens": "credit", "montant": 500},
          {"compte": "646000", "sens": "debit", "montant": 440}, {"compte": "108000", "sens": "debit", "montant": 60}]'::jsonb);$q$,
        replace(lignes_du, '{X}', '{LT1}'), 'OK', '108000:debit:60,512000:credit:500,646000:debit:440'),
      (13, '3i. une échéance toute de CSG-CRDS et de part n''a pas de ligne de cotisation',
        null, 'chef', $q$select rapprocher_cotisation('{LT3}', '{C6}', '[{"compte": "512000", "sens": "credit", "montant": 80},
          {"compte": "108000", "sens": "debit", "montant": 60}, {"compte": "637800", "sens": "debit", "montant": 20}]'::jsonb);$q$,
        replace(lignes_du, '{X}', '{LT3}'), 'OK', '108000:debit:60,512000:credit:80,637800:debit:20'),
      (14, '3j. … et une ligne de cotisation à zéro se refuse',
        null, 'chef', $q$select rapprocher_cotisation('{LT3}', '{C6}', '[{"compte": "512000", "sens": "credit", "montant": 80},
          {"compte": "646000", "sens": "debit", "montant": 0}, {"compte": "108000", "sens": "debit", "montant": 60},
          {"compte": "637800", "sens": "debit", "montant": 20}]'::jsonb);$q$,
        null, '22023', pas_conforme),
      (15, '3k. le plan réglé déplace la ligne de la part : au 635800, et plus au 637800',
        en_chef || $q$select regler_plan_du_dossier('{DP}', '[{"role": "autres_impots", "compte": "635800"}]'::jsonb);$q$,
        'chef', $q$select rapprocher_cotisation('{LP1}', '{P1}', '[{"compte": "512000", "sens": "credit", "montant": 500},
          {"compte": "646000", "sens": "debit", "montant": 420}, {"compte": "108000", "sens": "debit", "montant": 60},
          {"compte": "635800", "sens": "debit", "montant": 20}]'::jsonb);$q$,
        replace(lignes_du, '{X}', '{LP1}'), 'OK', '108000:debit:60,512000:credit:500,635800:debit:20,646000:debit:420'),
      (16, '3l. … où le 637800 se refuse',
        en_chef || $q$select regler_plan_du_dossier('{DP}', '[{"role": "autres_impots", "compte": "635800"}]'::jsonb);$q$,
        'chef', $q$select rapprocher_cotisation('{LP1}', '{P1}', '[{"compte": "512000", "sens": "credit", "montant": 500},
          {"compte": "646000", "sens": "debit", "montant": 420}, {"compte": "108000", "sens": "debit", "montant": 60},
          {"compte": "637800", "sens": "debit", "montant": 20}]'::jsonb);$q$,
        null, '22023', pas_conforme),
      (17, '3m. le client se fait refuser',
        null, 'client', $q$select rapprocher_cotisation('{LT1}', '{C1}', '[{"compte": "512000", "sens": "credit", "montant": 500},
          {"compte": "646000", "sens": "debit", "montant": 420}, {"compte": "108000", "sens": "debit", "montant": 60},
          {"compte": "637800", "sens": "debit", "montant": 20}]'::jsonb);$q$,
        null, '42501', 'Accès refusé à ce mouvement.'),
      (18, '4. le paiement depuis le compte personnel en trésorerie : la part au 637800, la cotisation hors CSG-CRDS et hors part au 646000, face au 108000 pour l''échéance hors CSG-CRDS',
        null, 'chef', $q$select enregistrer_paiement_personnel_cotisation('{DT}', '{C7}', '2026-03-10', '[{"compte": "646000", "sens": "debit", "montant": 420},
          {"compte": "637800", "sens": "debit", "montant": 20}, {"compte": "108000", "sens": "credit", "montant": 440}]'::jsonb);$q$,
        replace(lignes_de, '{X}', '{C7}'), 'OK', '108000:credit:440,637800:debit:20,646000:debit:420'),
      (19, '4b. … l''écriture d''hier se refuse',
        null, 'chef', $q$select enregistrer_paiement_personnel_cotisation('{DT}', '{C7}', '2026-03-10', '[{"compte": "646000", "sens": "debit", "montant": 440},
          {"compte": "108000", "sens": "credit", "montant": 440}]'::jsonb);$q$,
        null, '22023', pas_conforme_perso),
      (20, '4c. … une part qui, avec la CSG-CRDS, dépasse l''échéance se refuse',
        null, 'chef', $q$select enregistrer_paiement_personnel_cotisation('{DT}', '{C3}', '2026-03-10', '[]'::jsonb);$q$,
        null, '22023', 'La CSG-CRDS et la part « autres impôts » de cette échéance (510,00 €) dépassent son montant (500,00 €).'),
      (21, '4d. en engagement, face au compte du dirigeant (455000), toute l''échéance',
        null, 'chef', $q$select enregistrer_paiement_personnel_cotisation('{DE}', '{E1}', '2026-03-10', '[{"compte": "646000", "sens": "debit", "montant": 480},
          {"compte": "637800", "sens": "debit", "montant": 20}, {"compte": "455000", "sens": "credit", "montant": 500}]'::jsonb);$q$,
        replace(lignes_de, '{X}', '{E1}'), 'OK', '455000:credit:500,637800:debit:20,646000:debit:480'),
      (22, '5. le figement : la part d''une échéance payée depuis le compte personnel ne change plus',
        en_chef || $q$select enregistrer_paiement_personnel_cotisation('{DT}', '{C7}', '2026-03-10', '[{"compte": "646000", "sens": "debit", "montant": 420},
          {"compte": "637800", "sens": "debit", "montant": 20}, {"compte": "108000", "sens": "credit", "montant": 440}]'::jsonb);$q$,
        'chef', $q$update cotisations_declarees set montant_autres_impots = 25 where id = '{C7}';$q$,
        null, '23514', payee_perso),
      (23, '5b. … ni retirée',
        en_chef || $q$select enregistrer_paiement_personnel_cotisation('{DT}', '{C7}', '2026-03-10', '[{"compte": "646000", "sens": "debit", "montant": 420},
          {"compte": "637800", "sens": "debit", "montant": 20}, {"compte": "108000", "sens": "credit", "montant": 440}]'::jsonb);$q$,
        'chef', $q$update cotisations_declarees set montant_autres_impots = null where id = '{C7}';$q$,
        null, '23514', payee_perso),
      (24, '5c. la part d''une échéance d''un exercice validé ne se pose plus',
        valide_2025, 'chef', $q$update cotisations_declarees set montant_autres_impots = 20 where id = '{C8}';$q$,
        null, '23514', fige),
      (25, '5d. … ni pour le propriétaire, hors de la RLS',
        valide_2025, 'proprio', $q$update cotisations_declarees set montant_autres_impots = 20 where id = '{C8}';$q$,
        null, '23514', fige),
      (26, '5e. le contrôle positif : sans exercice validé ni paiement personnel, le chef la pose',
        null, 'chef', $q$update cotisations_declarees set montant_autres_impots = 20 where id = '{C8}';$q$,
        $q$(select montant_autres_impots::text from cotisations_declarees where id = '{C8}')$q$, 'OK', '20')
    ) as v(rang, etape, pose, qui, geste, relu, code, attendu) order by rang
    loop
      v_code := 'OK';
      v_msg := null;
      v_obs := null;
      begin
        v_textes := array[e.pose, e.geste, e.relu, e.attendu];
        for i in 1 .. 4 loop
          if v_textes[i] is null then continue; end if;
          v_textes[i] := replace(replace(replace(replace(v_textes[i], '{DT}', dt), '{DE}', de), '{DP}', dp), '{CHEF}', chef);
          v_textes[i] := replace(replace(replace(v_textes[i], '{LT1}', 'a17e0000-0000-4000-8000-0000000000a1'),
            '{LT2}', 'a17e0000-0000-4000-8000-0000000000a2'), '{LT3}', 'a17e0000-0000-4000-8000-0000000000a3');
          v_textes[i] := replace(replace(v_textes[i], '{LE1}', 'a17e0000-0000-4000-8000-0000000000a4'),
            '{LP1}', 'a17e0000-0000-4000-8000-0000000000a5');
          v_textes[i] := replace(replace(replace(replace(v_textes[i], '{C1}', 'a17e0000-0000-4000-8000-0000000000c1'),
            '{C2}', 'a17e0000-0000-4000-8000-0000000000c2'), '{C3}', 'a17e0000-0000-4000-8000-0000000000c3'),
            '{C4}', 'a17e0000-0000-4000-8000-0000000000c4');
          v_textes[i] := replace(replace(replace(replace(v_textes[i], '{C5}', 'a17e0000-0000-4000-8000-0000000000c5'),
            '{C6}', 'a17e0000-0000-4000-8000-0000000000c6'), '{C7}', 'a17e0000-0000-4000-8000-0000000000c7'),
            '{C8}', 'a17e0000-0000-4000-8000-0000000000c8');
          v_textes[i] := replace(replace(replace(v_textes[i], '{E1}', 'a17e0000-0000-4000-8000-0000000000e1'),
            '{E2}', 'a17e0000-0000-4000-8000-0000000000e2'), '{P1}', 'a17e0000-0000-4000-8000-0000000000f1');
        end loop;
        if v_textes[1] is not null then
          execute v_textes[1];
          perform set_config('request.jwt.claims', '', true);
        end if;
        begin
          if v_textes[2] is not null then
            if e.qui in ('chef', 'client') then
              execute 'set local role authenticated';
              perform set_config('request.jwt.claims', json_build_object('sub', case e.qui when 'chef' then chef else client end,
                'role', 'authenticated')::text, true);
            end if;
            execute v_textes[2];
            reset role;
            perform set_config('request.jwt.claims', '', true);
          end if;
          -- La fin de la transaction, simulée : les déclencheurs différés jugent ce que le geste a laissé.
          set constraints all immediate;
          set constraints all deferred;
          if v_textes[3] is not null then
            if e.qui = 'chef' then
              -- Ce qu'on relit sous la session du chef : `plan_du_dossier` la lit.
              perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
            end if;
            execute 'select (' || v_textes[3] || ')::text' into v_obs;
            perform set_config('request.jwt.claims', '', true);
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
        'ok', v_code = e.code and v_msg like v_textes[4], 'observe', v_code || ' ' || coalesce(v_msg, '-'));
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni leurs mouvements, leurs échéances, leurs écritures, leur plan ou leurs exercices validés',
    'ok', not exists (select 1 from dossiers where id in (dt::uuid, de::uuid, dp::uuid))
      and not exists (select 1 from lignes_bancaires where dossier_id in (dt::uuid, de::uuid, dp::uuid) or libelle like 'ESSAI EXP58Q6%')
      and not exists (select 1 from cotisations_declarees where dossier_id in (dt::uuid, de::uuid, dp::uuid))
      and not exists (select 1 from ecritures_brouillon where dossier_id in (dt::uuid, de::uuid, dp::uuid) or libelle = 'ESSAI EXP58Q6')
      and not exists (select 1 from plan_comptable_dossier where dossier_id in (dt::uuid, de::uuid, dp::uuid))
      and not exists (select 1 from exercices_valides where dossier_id in (dt::uuid, de::uuid, dp::uuid)),
    'observe', 'relu');
  perform set_config('essai.autres_impots_des_cotisations', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.autres_impots_des_cotisations')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
