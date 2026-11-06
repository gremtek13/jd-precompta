-- LES SITUATIONS PUBLIÉES (espace client, étape C4a ; la migration `situations_publiees`, PRÉPARÉE le 06/11/2026,
-- supabase/preparees/). Le récit : HISTORIQUE.md, « 06/11/2026 — LES SITUATIONS PUBLIÉES, EN BASE (C4A) (PRÉPARÉE, PAS
-- APPLIQUÉE) ». À rejouer par `execute_sql` après toute migration qui touche `memberships`, `changer_droits_acces`,
-- `client_du_dossier`, `droits_sur_le_dossier`, `situations_publiees` ou ses fonctions. Le retrait d'une ligne hors de la
-- suppression de son dossier ne se joue pas ici (l'outil d'exécution de la production retient une suppression) : la garde
-- le refuse, ce que la réplique de l'étape a éprouvé.
--
-- Ce qui se prouve ici, et ne se relit pas : le cabinet publie, remplace et retire ; chaque refus sous ses mots ; le statut
-- lu de l'exercice ; le client « Comptes » ne lit que la situation EN COURS de son dossier, le client sans la case rien ;
-- `situation_publiee_en_cours` ne dit une situation en cours qu'au cabinet du dossier et à un accès « Comptes » de ce
-- dossier, faux à un accès sans la case et à un compte connecté sans accès (la relecture de sécurité du 06/11/2026) ;
-- personne n'écrit ni ne réécrit la table en direct (ni le client, ni un chef qui n'est pas super-administrateur) ; la case
-- par la forme à cinq de `changer_droits_acces`, et les formes à trois et à quatre sous ses mots ; le catalogue.
--
-- Deux dossiers jetables du cabinet du dossier `test` (préfixe `c4a00000-0000-4000-8000`) : DC, où l'accès du client
-- d'essai porte « Comptes », et DS, où il ne la porte pas. Chaque étape se joue dans sa sous-transaction et s'y ANNULE
-- (`ANNULATION_ETAPE`) : ce que le chef pose d'abord, puis la requête du profil ; le jeu s'annule à la fin
-- (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le relit. Les verdicts voyagent dans un réglage LOCAL à la
-- transaction (`essai.situations_publiees`), que la requête finale lit : le fichier se joue d'un seul appel, ne crée ni
-- table ni fonction, ne contient aucune instruction de suppression, et ne rend rien qui dépende d'une ligne hors de ses
-- dossiers. Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`). Sans la migration, une ligne dit qu'il
-- attend (EN ATTENTE) et rien ne s'écrit.
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  dc constant text := 'c4a00000-0000-4000-8000-0000000000d1';
  ds constant text := 'c4a00000-0000-4000-8000-0000000000d2';
  acces_c constant text := 'c4a00000-0000-4000-8000-0000000000a1';
  acces_s constant text := 'c4a00000-0000-4000-8000-0000000000a2';
  -- Un compte connecté qu'aucun accès ni aucun cabinet ne nomme (le profil `inconnu`).
  inconnu constant text := 'c4a00000-0000-4000-8000-0000000000f1';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  -- Une situation au 30 juin 2025, bien formée, et sa comparaison au 30 juin 2024 ; des centimes.
  contenu constant text := '{"version": 1, "statut": "provisoire", "periode": {"debut": "2025-01-01", "fin": "2025-06-30"},
    "postes": [{"poste": "Recettes", "montant": 1250000}, {"poste": "Achats", "montant": -230050}],
    "recettes": 1250000, "depenses": 230050, "resultat": 1019950, "tva": {"assujetti": false},
    "n_moins_1": {"periode": {"debut": "2024-01-01", "fin": "2024-06-30"}, "postes": [{"poste": "Recettes", "montant": 1100000}],
      "recettes": 1100000, "depenses": 0, "resultat": 1100000, "tva": {"assujetti": false}}}';
  publier constant text := $q$publier_situation('{DC}', '2025-06-30', '{C}'::jsonb, null)$q$;
  e record; v_code text; v_msg text; v_req text; v_pose text; v_obs text;
  verdicts jsonb := '[]'::jsonb;
begin
  if to_regclass('public.situations_publiees') is null then
    perform set_config('essai.situations_publiees', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration situations_publiees', 'ok', true,
      'observe', 'absente : l''essai se joue dès que la migration y est'))::text, true);
    return;
  end if;
  begin
    -- Le jeu : deux dossiers jetables, exonérés et basculés (la garde de « Ventes » admettrait la case), et un accès du client d'essai à chacun, inséré par le propriétaire comme
    -- `create-client-access` l'insère — « Comptes » posée à l'insertion sur DC (une insertion du cabinet pose les cases).
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, statut_tva, ventes_par_les_factures) values
      (dc::uuid, 'ESSAI SITUATIONS PUBLIÉES DC', cabinet, 'tresorerie', '455000', 'exonere', true),
      (ds::uuid, 'ESSAI SITUATIONS PUBLIÉES DS', cabinet, 'tresorerie', '455000', 'exonere', true);
    insert into memberships (id, user_id, dossier_id, role, email, droit_comptes) values
      (acces_c::uuid, client::uuid, dc::uuid, 'client', 'essai-situations-c@example.test', true),
      (acces_s::uuid, client::uuid, ds::uuid, 'client', 'essai-situations-s@example.test', false);

    -- Une étape : {rang, étape, ce que le CHEF pose d'abord (super-administrateur, sous sa session), le profil — `chef`,
    -- `chef_simple` (le compte client rattaché au cabinet, le temps de l'étape), `client`, `inconnu` (un compte connecté sans
    -- aucun accès), `service` (le rôle des Edge Functions) ou `anon` —, sa requête, le code
    -- attendu (`OK` : acceptée) et ce qu'elle rend, ou les mots du refus}.
    for e in select * from (values
      (1, '1. le chef publie au 30 juin 2025 : une publication, provisoire (l''exercice n''est pas validé), à lui', null, 'chef',
        $q$select s.geste || ' ' || s.statut || ' ' || s.annee || ' ' || (s.auteur::text = '{CHEF}') from {P} s$q$, 'OK', 'publication provisoire 2025 true'),
      (2, '2. le client « Comptes » lit la situation en cours de son dossier', 'select 1 from {P}', 'client',
        $q$select count(*)::text || ' ' || min(s.contenu ->> 'resultat') from situations_publiees s where s.dossier_id = '{DC}'$q$, 'OK', '1 1019950'),
      (3, '3. le client sans la case ne lit rien de la situation de DS', $q$select 1 from publier_situation('{DS}', '2025-06-30', '{C}'::jsonb, null)$q$, 'client',
        $q$select count(*)::text from situations_publiees s where s.dossier_id = '{DS}'$q$, 'OK', '0'),
      (4, '4. remplacée : le client ne lit que la nouvelle',
        $q$select 1 from publier_situation('{DC}', '2025-06-30', jsonb_set(jsonb_set(jsonb_set('{C}'::jsonb, '{postes,0,montant}', '1250100'), '{recettes}', '1250100'), '{resultat}', '1020050'), (select s.id from {P} s))$q$,
        'client', $q$select count(*)::text || ' ' || min(s.contenu ->> 'recettes') from situations_publiees s where s.dossier_id = '{DC}'$q$, 'OK', '1 1250100'),
      (5, '5. retirée : le client ne lit plus rien ; le retrait cite la publication', $q$select 1 from retirer_situation((select s.id from {P} s))$q$, 'client',
        $q$select count(*)::text from situations_publiees s where s.dossier_id = '{DC}'$q$, 'OK', '0'),
      (6, '6. le cabinet lit la publication et son retrait', $q$select 1 from retirer_situation((select s.id from {P} s))$q$, 'chef',
        $q$select string_agg(s.geste, ',' order by s.geste) from situations_publiees s where s.dossier_id = '{DC}'$q$, 'OK', 'publication,retrait'),
      (7, '7. le client ne publie pas, même « Comptes » (42501)', null, 'client', $q$select 1 from {P}$q$, '42501', 'Accès refusé à ce dossier.'),
      (8, '8. le client ne retire pas (42501)', 'select 1 from {P}', 'client',
        $q$select 1 from retirer_situation((select s.id from situations_publiees s where s.dossier_id = '{DC}'))$q$, '42501', 'Accès refusé à ce dossier.'),
      (9, '9. le client n''écrit pas en direct (la garde, avant la RLS)', null, 'client',
        $q$insert into situations_publiees (dossier_id, annee, geste, arretee_au, statut, contenu, auteur) values ('{DC}', 2025, 'publication', '2025-06-30', 'provisoire', '{C}'::jsonb, '{CLIENT}') returning 1$q$,
        '42501', 'Une situation ne s''écrit que par sa publication ou son retrait.'),
      (10, '10. un chef qui n''est pas super-administrateur n''écrit pas en direct non plus', null, 'chef_simple',
        $q$insert into situations_publiees (dossier_id, annee, geste, arretee_au, statut, contenu, auteur) values ('{DC}', 2025, 'publication', '2025-06-30', 'provisoire', '{C}'::jsonb, '{CLIENT}') returning 1$q$,
        '42501', 'Une situation ne s''écrit que par sa publication ou son retrait.'),
      (11, '11. un chef qui n''est pas super-administrateur publie par la fonction', null, 'chef_simple',
        $q$select s.geste from {P} s$q$, 'OK', 'publication'),
      (12, '12. le rôle des Edge Functions, qui passe la RLS, ne réécrit pas une situation (la garde)', 'select 1 from {P}', 'service',
        $q$update situations_publiees set statut = 'validee' where dossier_id = '{DC}' returning 1$q$, '23514', 'Une situation publiée ne se modifie pas : elle se remplace ou se retire, et l''historique reste.'),
      (32, '32. le super-administrateur ne réécrit rien non plus : aucune policy de mise à jour, aucune ligne touchée', 'select 1 from {P}', 'chef',
        $q$with t as (update situations_publiees set statut = 'validee' where dossier_id = '{DC}' returning 1) select count(*)::text from t$q$, 'OK', '0'),
      (13, '13. une date à venir, au jour de Paris (22023)', null, 'chef',
        $q$select 1 from publier_situation('{DC}', (now() at time zone 'Europe/Paris')::date + 1, '{C}'::jsonb, null)$q$, '22023', 'Une situation ne s''arrête pas à une date à venir.'),
      (14, '14. une forme inconnue (22023)', null, 'chef',
        $q$select 1 from publier_situation('{DC}', '2025-06-30', jsonb_set('{C}'::jsonb, '{version}', '2'), null)$q$, '22023', 'La situation n''est pas dans la forme que la base connaît (version 1).'),
      (15, '15. un statut qui n''est pas celui de l''exercice (22023)', null, 'chef',
        $q$select 1 from publier_situation('{DC}', '2025-06-30', jsonb_set('{C}'::jsonb, '{statut}', '"validee"'), null)$q$, '22023', 'L''exercice 2025 est ouvert, et la situation le disait autrement : elle se recalcule avant d''être publiée.'),
      (16, '16. une période qui ne va pas jusqu''à la date d''arrêté (22023)', null, 'chef',
        $q$select 1 from publier_situation('{DC}', '2025-06-29', '{C}'::jsonb, null)$q$, '22023', 'La période des chiffres ne va pas du 1er janvier à la date d''arrêté.'),
      (17, '17. un total qui n''est pas la somme des postes (22023)', null, 'chef',
        $q$select 1 from publier_situation('{DC}', '2025-06-30', jsonb_set('{C}'::jsonb, '{recettes}', '1250001'), null)$q$, '22023', 'Les totaux de la situation ne sont pas la somme de ses postes.'),
      (18, '18. un poste en fraction de centime (22023)', null, 'chef',
        $q$select 1 from publier_situation('{DC}', '2025-06-30', jsonb_set('{C}'::jsonb, '{postes,1,montant}', '-230050.5'), null)$q$, '22023', 'Un poste de la situation est mal formé : un nom, une fois, et un montant en centimes entiers.'),
      (19, '19. la TVA d''un non-assujetti qui porte un montant (22023)', null, 'chef',
        $q$select 1 from publier_situation('{DC}', '2025-06-30', jsonb_set('{C}'::jsonb, '{tva}', '{"assujetti": false, "nette": 100}'), null)$q$, '22023', 'La TVA de la situation est mal formée : celle d''un assujetti, nette en centimes entiers ; aucun montant sinon.'),
      (20, '20. la comparaison qui ne couvre pas la même période de N−1 (22023)', null, 'chef',
        $q$select 1 from publier_situation('{DC}', '2025-06-30', jsonb_set('{C}'::jsonb, '{n_moins_1,periode,fin}', '"2024-12-31"'), null)$q$, '22023', 'La comparaison à l''exercice précédent : La période des chiffres ne va pas du 1er janvier à la date d''arrêté.'),
      (21, '21. une seconde publication à la même date, sans remplacer (22023)', 'select 1 from {P}', 'chef',
        $q$select 1 from {P}$q$, '22023', 'Une situation est déjà publiée à cette date : remplace-la.'),
      (22, '22. le remplacement d''une situation qui n''est pas en cours à cette date (22023)', 'select 1 from {P}', 'chef',
        $q$select 1 from publier_situation('{DC}', '2025-06-30', '{C}'::jsonb, gen_random_uuid())$q$, '22023', 'La situation remplacée n''est pas celle publiée en cours pour ce dossier, à cette date.'),
      (23, '23. retirer une situation déjà retirée (22023)', $q$select 1 from retirer_situation((select s.id from {P} s))$q$, 'chef',
        $q$select 1 from retirer_situation((select s.id from situations_publiees s where s.dossier_id = '{DC}' and s.geste = 'publication'))$q$, '22023', 'Cette situation n''est plus publiée : elle a été remplacée ou retirée.'),
      (24, '24. « Comptes » cochée par la forme à cinq de changer_droits_acces', null, 'chef',
        $q$select (changer_droits_acces('{AS}', null, null, null, true)).droit_comptes::text || ' ' || (droits_sur_le_dossier('{DS}') ->> 'comptes')$q$, 'OK', 'true true'),
      (25, '25. aucune case donnée, par la forme à cinq (22023, les quatre cases nommées)', null, 'chef',
        $q$select 1 from changer_droits_acces('{AS}', null, null, null, null)$q$, '22023', 'Aucun droit à changer : précise « Ventes », « Banque », « Caisse » ou « Comptes ».'),
      (26, '26. aucune case donnée, par la forme à quatre : les mêmes mots', null, 'chef',
        $q$select 1 from changer_droits_acces('{AS}', null, null, null)$q$, '22023', 'Aucun droit à changer : précise « Ventes », « Banque », « Caisse » ou « Comptes ».'),
      (27, '27. la forme à trois laisse « Caisse » et « Comptes » telles quelles', null, 'chef',
        $q$select r.droit_banque::text || ' ' || r.droit_caisse::text || ' ' || r.droit_comptes::text from changer_droits_acces('{AC}', null, true) r$q$, 'OK', 'true false true'),
      (28, '28. le client ne coche pas sa case (42501)', null, 'client',
        $q$select 1 from changer_droits_acces('{AS}', null, null, null, true)$q$, '42501', 'Accès refusé à ce dossier.'),
      (29, '29. ce que la base dit au client de ses deux accès : « Comptes » sur DC, pas sur DS', null, 'client',
        $q$select (droits_sur_le_dossier('{DC}') ->> 'comptes') || ' ' || (droits_sur_le_dossier('{DS}') ->> 'comptes')$q$, 'OK', 'true false'),
      (30, '30. l''anonyme ne lit rien et n''exécute pas la publication', 'select 1 from {P}', 'anon',
        $q$select count(*)::text || ' ' || has_function_privilege('anon', 'public.publier_situation(uuid, date, jsonb, uuid)', 'execute')::text from situations_publiees$q$, 'OK', '0 false'),
      -- La situation en cours, dite par sa fonction (le réglage `essai.situation_en_cours` porte l'identifiant que le chef
      -- vient de publier) : vraie au cabinet et au client « Comptes », fausse à tout autre compte — un bit par identifiant.
      (33, '33. situation_publiee_en_cours : vraie au client « Comptes », pour la situation en cours de son dossier',
        $q$select set_config('essai.situation_en_cours', (select s.id::text from {P} s), true)$q$, 'client',
        $q$select situation_publiee_en_cours(current_setting('essai.situation_en_cours')::uuid)::text$q$, 'OK', 'true'),
      (34, '34. … fausse au même client, la situation retirée',
        $q$select set_config('essai.situation_en_cours', (select s.id::text from {P} s), true); select 1 from retirer_situation(current_setting('essai.situation_en_cours')::uuid)$q$, 'client',
        $q$select situation_publiee_en_cours(current_setting('essai.situation_en_cours')::uuid)::text$q$, 'OK', 'false'),
      (35, '35. … fausse au client qui a un accès au dossier sans la case « Comptes » (DS) : il n''apprend pas qu''elle est en cours',
        $q$select set_config('essai.situation_en_cours', (select s.id::text from publier_situation('{DS}', '2025-06-30', '{C}'::jsonb, null) s), true)$q$, 'client',
        $q$select situation_publiee_en_cours(current_setting('essai.situation_en_cours')::uuid)::text$q$, 'OK', 'false'),
      (36, '36. … fausse à un compte connecté qui n''a aucun accès au dossier',
        $q$select set_config('essai.situation_en_cours', (select s.id::text from {P} s), true)$q$, 'inconnu',
        $q$select situation_publiee_en_cours(current_setting('essai.situation_en_cours')::uuid)::text$q$, 'OK', 'false'),
      (37, '37. … vraie au cabinet : un chef qui n''est pas super-administrateur, pour la situation de DS',
        $q$select set_config('essai.situation_en_cours', (select s.id::text from publier_situation('{DS}', '2025-06-30', '{C}'::jsonb, null) s), true)$q$, 'chef_simple',
        $q$select situation_publiee_en_cours(current_setting('essai.situation_en_cours')::uuid)::text$q$, 'OK', 'true')
    ) as t(rang, etape, pose, profil, requete, code, attendu) loop
      v_code := 'OK'; v_msg := null; v_obs := null;
      begin
        if e.profil = 'chef_simple' then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client::uuid, cabinet, 'comptable_en_chef');
        end if;
        if e.pose is not null then
          v_pose := replace(replace(replace(replace(e.pose, '{P}', publier), '{C}', contenu), '{DC}', dc), '{DS}', ds);
          execute 'set local role authenticated';
          perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
          execute v_pose;
          reset role;
          perform set_config('request.jwt.claims', '', true);
        end if;
        v_req := replace(replace(replace(replace(replace(replace(replace(replace(e.requete, '{P}', publier), '{C}', contenu),
          '{DC}', dc), '{DS}', ds), '{AC}', acces_c), '{AS}', acces_s), '{CHEF}', chef), '{CLIENT}', client);
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
    verdicts := verdicts || jsonb_build_object('rang', 31, 'etape', '31. le catalogue : RLS, trois policies à authenticated, la garde, les fonctions',
      'ok', (select c.relrowsecurity from pg_class c where c.oid = 'public.situations_publiees'::regclass)
        and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'situations_publiees') = 3
        and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'situations_publiees'
               and p.roles = array['authenticated']::name[]
               and ((p.policyname = 'situations_publiees_lecture' and p.cmd = 'SELECT' and p.qual = 'admin_du_dossier(dossier_id)')
                 or (p.policyname = 'situations_publiees_lecture_comptes' and p.cmd = 'SELECT'
                     and p.qual = '(client_du_dossier(dossier_id, ''comptes''::text) AND (geste = ''publication''::text) AND situation_publiee_en_cours(id))')
                 or (p.policyname = 'situations_publiees_restauration' and p.cmd = 'INSERT' and p.with_check = 'is_super_admin()'))) = 3
        and exists (select 1 from pg_trigger t where t.tgname = 'situations_publiees_garde' and not t.tgisinternal
                     and t.tgtype = 31)
        and (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
               and p.oid in ('public.publier_situation(uuid, date, jsonb, uuid)'::regprocedure, 'public.retirer_situation(uuid)'::regprocedure,
                             'public.situation_publiee_en_cours(uuid)'::regprocedure,
                             'public.changer_droits_acces(uuid, boolean, boolean, boolean, boolean)'::regprocedure)
               and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
               and not has_function_privilege('anon', p.oid, 'execute')
               and has_function_privilege('authenticated', p.oid, 'execute')) = 4
        and not has_function_privilege('authenticated', 'public.refus_des_chiffres_de_la_situation(jsonb, date, date)', 'execute')
        and not has_function_privilege('authenticated', 'public.garder_situation_publiee()', 'execute'),
      'observe', 'relu au catalogue');
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  -- Rien n'est resté : ni les dossiers jetables, ni leurs accès, ni leurs situations, ni le compte d'essai dans le cabinet.
  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni leurs accès, ni leurs situations, ni le compte d''essai dans le cabinet',
    'ok', not exists (select 1 from dossiers where id in (dc::uuid, ds::uuid))
      and not exists (select 1 from memberships where id in (acces_c::uuid, acces_s::uuid))
      and not exists (select 1 from situations_publiees where dossier_id in (dc::uuid, ds::uuid))
      and not exists (select 1 from cabinet_admins where user_id::text = client),
    'observe', 'relu');
  perform set_config('essai.situations_publiees', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.situations_publiees')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
