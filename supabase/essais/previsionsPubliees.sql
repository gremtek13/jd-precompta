-- LA PRÉVISION DE TRÉSORERIE PUBLIÉE (espace client, C8-Q2 ; la migration `previsions_publiees`, PRÉPARÉE le 15/11/2026,
-- supabase/preparees/20261115100000_previsions_publiees.sql). Le récit : HISTORIQUE.md, « 15/11/2026 — C8-Q2 : LA PRÉVISION
-- DE TRÉSORERIE PUBLIÉE AU CLIENT ». À rejouer par `execute_sql` après toute migration qui touche `memberships`,
-- `client_du_dossier`, `admin_du_dossier`, `previsions_publiees` ou ses fonctions. Le retrait d'une ligne hors de la
-- suppression de son dossier ne se joue pas ici (l'outil d'exécution de la production retient une suppression) : la garde
-- le refuse, ce que la réplique de l'étape a éprouvé.
--
-- Ce qui se prouve ici, et ne se relit pas : le cabinet publie, remplace et retire ; chaque refus sous ses mots, dans
-- l'ordre de la migration ; la prévision datée du jour de Paris où la base la reçoit ; le client « Banque » ne lit que la
-- prévision EN COURS de son dossier, le client sans la case rien, ni celui d'un autre dossier, ni un compte sans accès, ni
-- l'anonyme ; la case décochée, il ne lit plus rien ; `prevision_publiee_en_cours` ne dit une prévision en cours qu'au
-- cabinet du dossier et à un accès « Banque » de ce dossier ; personne n'écrit ni ne réécrit la table en direct (ni le
-- client, ni un chef qui n'est pas super-administrateur, ni le rôle des Edge Functions) ; le catalogue.
--
-- Trois dossiers jetables du cabinet du dossier `test` (préfixe `c8200000-0000-4000-8000`) : DB, où l'accès du client
-- d'essai porte « Banque », DS, où il ne la porte pas, et DX, où il n'a aucun accès. Chaque étape se joue dans sa
-- sous-transaction et s'y ANNULE (`ANNULATION_ETAPE`) : ce que le chef pose d'abord, puis la requête du profil ; le jeu
-- s'annule à la fin (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le relit. Les verdicts voyagent dans un réglage
-- LOCAL à la transaction (`essai.previsions_publiees`), que la requête finale lit : le fichier se joue d'un seul appel, ne
-- crée ni table ni fonction, ne contient aucune instruction de suppression, et ne rend rien qui dépende d'une ligne hors de
-- ses dossiers. Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`). Sans la migration, une ligne dit
-- qu'il attend (EN ATTENTE) et rien ne s'écrit.
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  db constant text := 'c8200000-0000-4000-8000-0000000000d1';
  ds constant text := 'c8200000-0000-4000-8000-0000000000d2';
  dx constant text := 'c8200000-0000-4000-8000-0000000000d3';
  acces_b constant text := 'c8200000-0000-4000-8000-0000000000a1';
  acces_s constant text := 'c8200000-0000-4000-8000-0000000000a2';
  -- Un compte connecté qu'aucun accès ni aucun cabinet ne nomme (le profil `inconnu`).
  inconnu constant text := 'c8200000-0000-4000-8000-0000000000f1';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  -- Le jour de Paris où la base reçoit la prévision, et l'index de son mois (année × 12 + mois − 1).
  jour constant date := (now() at time zone 'Europe/Paris')::date;
  k constant integer := extract(year from (now() at time zone 'Europe/Paris')::date)::integer * 12
    + extract(month from (now() at time zone 'Europe/Paris')::date)::integer - 1;
  contenu text;
  publier constant text := $q$publier_prevision('{DB}', '{C}'::jsonb, null)$q$;
  e record; v_code text; v_msg text; v_req text; v_pose text; v_obs text;
  verdicts jsonb := '[]'::jsonb;
begin
  if to_regclass('public.previsions_publiees') is null then
    perform set_config('essai.previsions_publiees', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration previsions_publiees', 'ok', true,
      'observe', 'absente : l''essai se joue dès que la migration y est'))::text, true);
    return;
  end if;
  -- Une prévision bien formée pour ce jour : partie de 12 345,67 € dix jours plus tôt, au rythme de six mois complets
  -- (cinq observés), sur les trois mois qui suivent celui du jour ; des centimes.
  contenu := jsonb_build_object(
    'version', 1, 'etablie_le', to_char(jour, 'YYYY-MM-DD'), 'avec_especes', false,
    'depart', jsonb_build_object('au', to_char(jour - 10, 'YYYY-MM-DD'), 'solde', 1234567),
    'rythme', jsonb_build_object(
      'debut', lpad(((k - 6) / 12)::text, 4, '0') || '-' || lpad((((k - 6) % 12) + 1)::text, 2, '0'),
      'fin', lpad(((k - 1) / 12)::text, 4, '0') || '-' || lpad((((k - 1) % 12) + 1)::text, 2, '0'),
      'mois', 6, 'mois_observes', 5, 'encaissements', 500000, 'decaissements', 420000),
    'mois', jsonb_build_array(
      jsonb_build_object('mois', lpad(((k + 1) / 12)::text, 4, '0') || '-' || lpad((((k + 1) % 12) + 1)::text, 2, '0'),
        'solde_debut', 1234567, 'encaissements', 500000, 'decaissements', 420000, 'solde_fin', 1314567),
      jsonb_build_object('mois', lpad(((k + 2) / 12)::text, 4, '0') || '-' || lpad((((k + 2) % 12) + 1)::text, 2, '0'),
        'solde_debut', 1314567, 'encaissements', 500000, 'decaissements', 420000, 'solde_fin', 1394567),
      jsonb_build_object('mois', lpad(((k + 3) / 12)::text, 4, '0') || '-' || lpad((((k + 3) % 12) + 1)::text, 2, '0'),
        'solde_debut', 1394567, 'encaissements', 500000, 'decaissements', 420000, 'solde_fin', 1474567)))::text;
  begin
    -- Le jeu : trois dossiers jetables, et un accès du client d'essai à DB (« Banque ») et à DS (sans elle), insérés par le
    -- propriétaire comme `create-client-access` les insère — la case posée à l'insertion (une insertion du cabinet pose les
    -- cases).
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, statut_tva) values
      (db::uuid, 'ESSAI PRÉVISIONS PUBLIÉES DB', cabinet, 'tresorerie', '455000', 'exonere'),
      (ds::uuid, 'ESSAI PRÉVISIONS PUBLIÉES DS', cabinet, 'tresorerie', '455000', 'exonere'),
      (dx::uuid, 'ESSAI PRÉVISIONS PUBLIÉES DX', cabinet, 'tresorerie', '455000', 'exonere');
    insert into memberships (id, user_id, dossier_id, role, email, droit_banque) values
      (acces_b::uuid, client::uuid, db::uuid, 'client', 'essai-previsions-b@example.test', true),
      (acces_s::uuid, client::uuid, ds::uuid, 'client', 'essai-previsions-s@example.test', false);

    -- Une étape : {rang, étape, ce que le CHEF pose d'abord (super-administrateur, sous sa session), le profil — `chef`,
    -- `chef_simple` (le compte client rattaché au cabinet, le temps de l'étape), `client`, `inconnu` (un compte connecté sans
    -- aucun accès), `service` (le rôle des Edge Functions) ou `anon` —, sa requête, le code attendu (`OK` : acceptée) et ce
    -- qu'elle rend, ou les mots du refus}. `{J}` : le jour de Paris, `{M+n}` : le mois décalé de n, `{J+n}` : le jour décalé.
    for e in select * from (values
      (1, '1. le chef publie : une publication, à lui, datée du jour de Paris', null, 'chef',
        $q$select s.geste || ' ' || (s.auteur::text = '{CHEF}') || ' ' || (s.contenu ->> 'etablie_le' = '{J}') || ' ' || (s.remplace_id is null) from {P} s$q$,
        'OK', 'publication true true true'),
      (2, '2. le client « Banque » lit la prévision en cours de son dossier, telle qu''elle s''est figée', 'select 1 from {P}', 'client',
        $q$select count(*)::text || ' ' || min(s.contenu #>> '{depart,solde}') || ' ' || min(s.contenu #>> '{mois,2,solde_fin}') from previsions_publiees s where s.dossier_id = '{DB}'$q$,
        'OK', '1 1234567 1474567'),
      (3, '3. le client sans la case ne lit rien de la prévision de DS', $q$select 1 from publier_prevision('{DS}', '{C}'::jsonb, null)$q$, 'client',
        $q$select count(*)::text from previsions_publiees s where s.dossier_id = '{DS}'$q$, 'OK', '0'),
      (4, '4. le client ne lit rien d''un dossier où il n''a aucun accès (DX)', $q$select 1 from publier_prevision('{DX}', '{C}'::jsonb, null)$q$, 'client',
        $q$select count(*)::text from previsions_publiees s where s.dossier_id = '{DX}'$q$, 'OK', '0'),
      (5, '5. remplacée : le client ne lit que la nouvelle',
        $q$select 1 from publier_prevision('{DB}', jsonb_set('{C}'::jsonb, '{avec_especes}', 'true'), (select s.id from {P} s))$q$,
        'client', $q$select count(*)::text || ' ' || min(s.contenu ->> 'avec_especes') from previsions_publiees s where s.dossier_id = '{DB}'$q$, 'OK', '1 true'),
      (6, '6. retirée : le client ne lit plus rien', $q$select 1 from retirer_prevision((select s.id from {P} s))$q$, 'client',
        $q$select count(*)::text from previsions_publiees s where s.dossier_id = '{DB}'$q$, 'OK', '0'),
      (7, '7. le cabinet lit la publication, la remplacée et le retrait ; le retrait cite la remplaçante',
        $q$select 1 from retirer_prevision((select s2.id from publier_prevision('{DB}', '{C}'::jsonb, (select s.id from {P} s)) s2))$q$, 'chef',
        $q$select string_agg(s.geste, ',' order by s.publiee_le, s.geste) || ' ' || (select count(*) from previsions_publiees r where r.dossier_id = '{DB}' and r.geste = 'retrait' and r.remplace_id = (select p.id from previsions_publiees p where p.dossier_id = '{DB}' and p.remplace_id is not null and p.geste = 'publication')) from previsions_publiees s where s.dossier_id = '{DB}'$q$,
        'OK', 'publication,publication,retrait 1'),
      (8, '8. la case « Banque » décochée par le cabinet, le client ne lit plus la prévision en cours',
        $q$select 1 from {P}; select 1 from changer_droits_acces('{AB}', null, false)$q$, 'client',
        $q$select count(*)::text from previsions_publiees s where s.dossier_id = '{DB}'$q$, 'OK', '0'),
      (9, '9. un compte connecté sans accès ne lit rien', 'select 1 from {P}', 'inconnu',
        $q$select count(*)::text from previsions_publiees s where s.dossier_id = '{DB}'$q$, 'OK', '0'),
      (10, '10. le client ne publie pas, même « Banque » (42501)', null, 'client', $q$select 1 from {P}$q$, '42501', 'Accès refusé à ce dossier.'),
      (11, '11. le client ne retire pas (42501)', 'select 1 from {P}', 'client',
        $q$select 1 from retirer_prevision((select s.id from previsions_publiees s where s.dossier_id = '{DB}'))$q$, '42501', 'Accès refusé à ce dossier.'),
      (12, '12. un compte sans accès ne publie pas (42501)', null, 'inconnu', $q$select 1 from {P}$q$, '42501', 'Accès refusé à ce dossier.'),
      (13, '13. le client n''écrit pas en direct (la garde, avant la RLS)', null, 'client',
        $q$insert into previsions_publiees (dossier_id, geste, contenu, auteur) values ('{DB}', 'publication', '{C}'::jsonb, '{CLIENT}') returning 1$q$,
        '42501', 'Une prévision ne s''écrit que par sa publication ou son retrait.'),
      (14, '14. un chef qui n''est pas super-administrateur n''écrit pas en direct non plus', null, 'chef_simple',
        $q$insert into previsions_publiees (dossier_id, geste, contenu, auteur) values ('{DB}', 'publication', '{C}'::jsonb, '{CLIENT}') returning 1$q$,
        '42501', 'Une prévision ne s''écrit que par sa publication ou son retrait.'),
      (15, '15. un chef qui n''est pas super-administrateur publie par la fonction', null, 'chef_simple',
        $q$select s.geste from {P} s$q$, 'OK', 'publication'),
      (16, '16. le rôle des Edge Functions, qui passe la RLS, ne réécrit pas une prévision (la garde)', 'select 1 from {P}', 'service',
        $q$update previsions_publiees set contenu = contenu where dossier_id = '{DB}' returning 1$q$, '23514',
        'Une prévision publiée ne se modifie pas : elle se remplace ou se retire, et l''historique reste.'),
      (17, '17. le super-administrateur ne réécrit rien non plus : aucune policy de mise à jour, aucune ligne touchée', 'select 1 from {P}', 'chef',
        $q$with t as (update previsions_publiees set contenu = contenu where dossier_id = '{DB}' returning 1) select count(*)::text from t$q$, 'OK', '0'),
      (18, '18. une forme inconnue : la version 2 (22023)', null, 'chef',
        $q$select 1 from publier_prevision('{DB}', jsonb_set('{C}'::jsonb, '{version}', '2'), null)$q$, '22023', 'La prévision n''est pas dans la forme que la base connaît (version 1).'),
      (19, '19. une forme inconnue : une clé de plus, un texte libre (22023)', null, 'chef',
        $q$select 1 from publier_prevision('{DB}', '{C}'::jsonb || '{"note": "texte libre"}'::jsonb, null)$q$, '22023', 'La prévision n''est pas dans la forme que la base connaît (version 1).'),
      (20, '20. une forme inconnue : les espèces dites par un texte (22023)', null, 'chef',
        $q$select 1 from publier_prevision('{DB}', jsonb_set('{C}'::jsonb, '{avec_especes}', '"non"'), null)$q$, '22023', 'La prévision n''est pas dans la forme que la base connaît (version 1).'),
      (21, '21. établie la veille : le jour n''est pas celui de la publication (22023)', null, 'chef',
        $q$select 1 from publier_prevision('{DB}', jsonb_set('{C}'::jsonb, '{etablie_le}', to_jsonb('{J-1}'::text)), null)$q$, '22023', 'Une prévision se publie le jour où elle est établie : recalcule-la.'),
      (22, '22. un jour qui n''existe pas (22023)', null, 'chef',
        $q$select 1 from publier_prevision('{DB}', jsonb_set('{C}'::jsonb, '{etablie_le}', '"2026-02-30"'), null)$q$, '22023', 'Une prévision se publie le jour où elle est établie : recalcule-la.'),
      (23, '23. un départ à venir (22023)', null, 'chef',
        $q$select 1 from publier_prevision('{DB}', jsonb_set('{C}'::jsonb, '{depart,au}', to_jsonb('{J+1}'::text)), null)$q$, '22023', 'Le départ de la prévision est mal formé : un solde en centimes entiers, à une date qui n''est pas à venir.'),
      (24, '24. un solde de départ en fraction de centime (22023)', null, 'chef',
        $q$select 1 from publier_prevision('{DB}', jsonb_set('{C}'::jsonb, '{depart,solde}', '1234567.5'), null)$q$, '22023', 'Le départ de la prévision est mal formé : un solde en centimes entiers, à une date qui n''est pas à venir.'),
      (25, '25. un rythme de vingt-cinq mois (22023)', null, 'chef',
        $q$select 1 from publier_prevision('{DB}', jsonb_set('{C}'::jsonb, '{rythme,mois}', '25'), null)$q$, '22023', 'Le rythme de la prévision est mal formé : de 1 à 24 mois complets, jusqu''au mois qui précède celui où elle est établie, et des moyennes en centimes entiers, positives.'),
      (26, '26. un rythme qui finit au mois du jour, incomplet (22023)', null, 'chef',
        $q$select 1 from publier_prevision('{DB}', jsonb_set('{C}'::jsonb, '{rythme,fin}', to_jsonb('{M+0}'::text)), null)$q$, '22023', 'Le rythme de la prévision est mal formé : de 1 à 24 mois complets, jusqu''au mois qui précède celui où elle est établie, et des moyennes en centimes entiers, positives.'),
      (27, '27. une moyenne d''encaissements négative (22023)', null, 'chef',
        $q$select 1 from publier_prevision('{DB}', jsonb_set('{C}'::jsonb, '{rythme,encaissements}', '-1'), null)$q$, '22023', 'Le rythme de la prévision est mal formé : de 1 à 24 mois complets, jusqu''au mois qui précède celui où elle est établie, et des moyennes en centimes entiers, positives.'),
      (28, '28. aucun mouvement observé (22023)', null, 'chef',
        $q$select 1 from publier_prevision('{DB}', jsonb_set('{C}'::jsonb, '{rythme,mois_observes}', '0'), null)$q$, '22023', 'La prévision ne repose sur aucun mouvement observé : elle ne se publie pas.'),
      (29, '29. un premier mois qui est celui du jour (22023)', null, 'chef',
        $q$select 1 from publier_prevision('{DB}', jsonb_set('{C}'::jsonb, '{mois,0,mois}', to_jsonb('{M+0}'::text)), null)$q$, '22023', 'Les mois de la prévision ne se suivent pas : de 1 à 24, du mois qui suit celui où elle est établie, chacun parti du solde du précédent, au rythme moyen.'),
      (30, '30. un mois qui ne part pas du solde du précédent (22023)', null, 'chef',
        $q$select 1 from publier_prevision('{DB}', jsonb_set(jsonb_set('{C}'::jsonb, '{mois,1,solde_debut}', '1314568'), '{mois,1,solde_fin}', '1394568'), null)$q$, '22023', 'Les mois de la prévision ne se suivent pas : de 1 à 24, du mois qui suit celui où elle est établie, chacun parti du solde du précédent, au rythme moyen.'),
      (31, '31. un solde de fin qui n''est pas le départ plus les entrées moins les sorties (22023)', null, 'chef',
        $q$select 1 from publier_prevision('{DB}', jsonb_set('{C}'::jsonb, '{mois,2,solde_fin}', '1474568'), null)$q$, '22023', 'Les mois de la prévision ne se suivent pas : de 1 à 24, du mois qui suit celui où elle est établie, chacun parti du solde du précédent, au rythme moyen.'),
      (32, '32. des encaissements d''un mois qui ne sont pas le rythme moyen (22023)', null, 'chef',
        $q$select 1 from publier_prevision('{DB}', jsonb_set(jsonb_set('{C}'::jsonb, '{mois,0,encaissements}', '500001'), '{mois,0,solde_fin}', '1314568'), null)$q$, '22023', 'Les mois de la prévision ne se suivent pas : de 1 à 24, du mois qui suit celui où elle est établie, chacun parti du solde du précédent, au rythme moyen.'),
      (33, '33. aucun mois (22023)', null, 'chef',
        $q$select 1 from publier_prevision('{DB}', jsonb_set('{C}'::jsonb, '{mois}', '[]'), null)$q$, '22023', 'Les mois de la prévision ne se suivent pas : de 1 à 24, du mois qui suit celui où elle est établie, chacun parti du solde du précédent, au rythme moyen.'),
      (34, '34. une seconde publication, sans remplacer celle en cours (22023)', 'select 1 from {P}', 'chef',
        $q$select 1 from {P}$q$, '22023', 'Une prévision est déjà publiée pour ce dossier : remplace-la.'),
      (35, '35. le remplacement d''une prévision inconnue (22023)', 'select 1 from {P}', 'chef',
        $q$select 1 from publier_prevision('{DB}', '{C}'::jsonb, gen_random_uuid())$q$, '22023', 'La prévision remplacée n''est pas celle publiée en cours pour ce dossier.'),
      (36, '36. le remplacement d''une prévision d''un autre dossier (22023)', $q$select set_config('essai.prevision', (select s.id::text from publier_prevision('{DS}', '{C}'::jsonb, null) s), true)$q$, 'chef',
        $q$select 1 from publier_prevision('{DB}', '{C}'::jsonb, current_setting('essai.prevision')::uuid)$q$, '22023', 'La prévision remplacée n''est pas celle publiée en cours pour ce dossier.'),
      (37, '37. le remplacement d''une prévision déjà remplacée (22023)',
        $q$select set_config('essai.prevision', (select s.id::text from {P} s), true); select 1 from publier_prevision('{DB}', '{C}'::jsonb, current_setting('essai.prevision')::uuid)$q$, 'chef',
        $q$select 1 from publier_prevision('{DB}', '{C}'::jsonb, current_setting('essai.prevision')::uuid)$q$, '22023', 'La prévision remplacée n''est pas celle publiée en cours pour ce dossier.'),
      (38, '38. retirer une prévision déjà retirée (22023)', $q$select 1 from retirer_prevision((select s.id from {P} s))$q$, 'chef',
        $q$select 1 from retirer_prevision((select s.id from previsions_publiees s where s.dossier_id = '{DB}' and s.geste = 'publication'))$q$, '22023', 'Cette prévision n''est plus publiée : elle a été remplacée ou retirée.'),
      (39, '39. retirer un retrait (22023)', $q$select 1 from retirer_prevision((select s.id from {P} s))$q$, 'chef',
        $q$select 1 from retirer_prevision((select s.id from previsions_publiees s where s.dossier_id = '{DB}' and s.geste = 'retrait'))$q$, '22023', 'Cette prévision n''est plus publiée : elle a été remplacée ou retirée.'),
      (40, '40. retirer une prévision inconnue (42501 : rien n''apprend qu''elle existe)', null, 'chef_simple',
        $q$select 1 from retirer_prevision(gen_random_uuid())$q$, '42501', 'Accès refusé à ce dossier.'),
      (41, '41. l''anonyme ne lit rien et n''exécute pas la publication', 'select 1 from {P}', 'anon',
        $q$select count(*)::text || ' ' || has_function_privilege('anon', 'public.publier_prevision(uuid, jsonb, uuid)', 'execute')::text from previsions_publiees$q$, 'OK', '0 false'),
      -- La prévision en cours, dite par sa fonction (le réglage `essai.prevision` porte l'identifiant que le chef vient de
      -- publier) : vraie au cabinet et au client « Banque », fausse à tout autre compte — un bit par identifiant.
      (42, '42. prevision_publiee_en_cours : vraie au client « Banque », pour la prévision en cours de son dossier',
        $q$select set_config('essai.prevision', (select s.id::text from {P} s), true)$q$, 'client',
        $q$select prevision_publiee_en_cours(current_setting('essai.prevision')::uuid)::text$q$, 'OK', 'true'),
      (43, '43. … fausse au même client, la prévision retirée',
        $q$select set_config('essai.prevision', (select s.id::text from {P} s), true); select 1 from retirer_prevision(current_setting('essai.prevision')::uuid)$q$, 'client',
        $q$select prevision_publiee_en_cours(current_setting('essai.prevision')::uuid)::text$q$, 'OK', 'false'),
      (44, '44. … fausse au client qui a un accès au dossier sans la case « Banque » (DS) : il n''apprend pas qu''elle est en cours',
        $q$select set_config('essai.prevision', (select s.id::text from publier_prevision('{DS}', '{C}'::jsonb, null) s), true)$q$, 'client',
        $q$select prevision_publiee_en_cours(current_setting('essai.prevision')::uuid)::text$q$, 'OK', 'false'),
      (45, '45. … fausse à un compte connecté qui n''a aucun accès au dossier',
        $q$select set_config('essai.prevision', (select s.id::text from {P} s), true)$q$, 'inconnu',
        $q$select prevision_publiee_en_cours(current_setting('essai.prevision')::uuid)::text$q$, 'OK', 'false'),
      (46, '46. … vraie au cabinet : un chef qui n''est pas super-administrateur, pour la prévision de DS',
        $q$select set_config('essai.prevision', (select s.id::text from publier_prevision('{DS}', '{C}'::jsonb, null) s), true)$q$, 'chef_simple',
        $q$select prevision_publiee_en_cours(current_setting('essai.prevision')::uuid)::text$q$, 'OK', 'true')
    ) as t(rang, etape, pose, profil, requete, code, attendu) loop
      v_code := 'OK'; v_msg := null; v_obs := null;
      begin
        if e.profil = 'chef_simple' then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client::uuid, cabinet, 'comptable_en_chef');
        end if;
        if e.pose is not null then
          v_pose := replace(replace(replace(replace(replace(replace(e.pose, '{P}', publier), '{C}', contenu), '{DB}', db), '{DS}', ds),
            '{DX}', dx), '{AB}', acces_b);
          execute 'set local role authenticated';
          perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
          execute v_pose;
          reset role;
          perform set_config('request.jwt.claims', '', true);
        end if;
        v_req := replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
          e.requete, '{P}', publier), '{C}', contenu), '{DB}', db), '{DS}', ds), '{DX}', dx), '{AB}', acces_b), '{AS}', acces_s),
          '{CHEF}', chef), '{CLIENT}', client), '{J}', to_char(jour, 'YYYY-MM-DD')), '{J-1}', to_char(jour - 1, 'YYYY-MM-DD')),
          '{J+1}', to_char(jour + 1, 'YYYY-MM-DD')), '{M+0}', lpad((k / 12)::text, 4, '0') || '-' || lpad(((k % 12) + 1)::text, 2, '0'));
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

    -- Le catalogue : la RLS active ; trois policies, toutes à authenticated ; la garde avant chaque écriture ; les
    -- fonctions aux droits du propriétaire, search_path fixé ; ni anon ni PUBLIC ne les exécutent.
    verdicts := verdicts || jsonb_build_object('rang', 47, 'etape', '47. le catalogue : RLS, trois policies à authenticated, la garde, les fonctions',
      'ok', (select c.relrowsecurity from pg_class c where c.oid = 'public.previsions_publiees'::regclass)
        and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'previsions_publiees'
               and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) = 3
        and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'previsions_publiees'
               and p.roles = array['authenticated']::name[]
               and ((p.policyname = 'previsions_publiees_lecture' and p.cmd = 'SELECT' and p.qual = 'admin_du_dossier(dossier_id)')
                 or (p.policyname = 'previsions_publiees_lecture_banque' and p.cmd = 'SELECT'
                     and p.qual = '(client_du_dossier(dossier_id, ''banque''::text) AND (geste = ''publication''::text) AND prevision_publiee_en_cours(id))')
                 or (p.policyname = 'previsions_publiees_restauration' and p.cmd = 'INSERT' and p.with_check = 'is_super_admin()'))) = 3
        and exists (select 1 from pg_trigger t where t.tgname = 'previsions_publiees_garde' and not t.tgisinternal
                     and t.tgtype = 31)
        and (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
               and p.oid in ('public.publier_prevision(uuid, jsonb, uuid)'::regprocedure, 'public.retirer_prevision(uuid)'::regprocedure,
                             'public.prevision_publiee_en_cours(uuid)'::regprocedure)
               and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
               and not has_function_privilege('anon', p.oid, 'execute')
               and has_function_privilege('authenticated', p.oid, 'execute')) = 3
        and not has_function_privilege('authenticated', 'public.refus_de_la_prevision(jsonb, date)', 'execute')
        and not has_function_privilege('authenticated', 'public.garder_prevision_publiee()', 'execute'),
      'observe', 'relu au catalogue');
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  -- Rien n'est resté : ni les dossiers jetables, ni leurs accès, ni leurs prévisions, ni le compte d'essai dans le cabinet.
  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni leurs accès, ni leurs prévisions, ni le compte d''essai dans le cabinet',
    'ok', not exists (select 1 from dossiers where id in (db::uuid, ds::uuid, dx::uuid))
      and not exists (select 1 from memberships where id in (acces_b::uuid, acces_s::uuid))
      and not exists (select 1 from previsions_publiees where dossier_id in (db::uuid, ds::uuid, dx::uuid))
      and not exists (select 1 from cabinet_admins where user_id::text = client),
    'observe', 'relu');
  perform set_config('essai.previsions_publiees', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.previsions_publiees')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
