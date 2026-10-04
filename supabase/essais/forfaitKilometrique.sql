-- LE FORFAIT KILOMÉTRIQUE ET SON ÉCRITURE, ÉPROUVÉS EN BASE — à rejouer par `execute_sql` après toute
-- migration qui touche `ecrire_forfait_kilometrique`, `retirer_vehicule`, le barème
-- (`bareme_kilometrique`, `indemnite_kilometrique_centimes`), la table `vehicules` ou les contraintes
-- d'`ecritures_brouillon` (ligne 26.6 de la feuille de route, étape b).
--
-- La première fonction écrit le forfait d'une ligne du cadre 7 — l'indemnité du barème au débit du 625110,
-- au crédit du compte du dirigeant, au 31 décembre de son exercice —, vérifié contre le barème, et remplace
-- celui qui était écrit ; la seconde retire un véhicule ET son forfait. Ce qui se prouve ici, et ne se relit
-- pas :
--   - QUI peut : un anonyme n'a pas le droit d'appeler, un compte rattaché à rien et un client se font
--     refuser — le client sur le dossier d'un autre comme sur le SIEN —, et le chef du cabinet écrit bien
--     (le contrôle POSITIF, sans lequel les refus seraient satisfaits par une fonction qui refuse tout le
--     monde) ;
--   - CE QUI s'écrit : deux lignes au 31 décembre, liées au véhicule, au montant du barème au centime — la
--     table électrique pour un 100 % électrique, la table thermique pour une motorisation non renseignée, le
--     demi-centime vers le haut —, au crédit du 108000 en trésorerie et du compte choisi pour le dirigeant en
--     engagement ; une seconde écriture REMPLACE la première ; un forfait devenu nul retire celui qui était
--     écrit, y compris avant l'ouverture du dossier ; un retrait de véhicule emporte son forfait ;
--   - CE QUI est refusé, avec sa RAISON : un montant, un compte, un sens ou une ligne qui ne correspondent
--     pas, une écriture non vide là où le forfait est nul, un exercice à venir, un barème absent, une
--     puissance hors barème, un exercice antérieur à l'ouverture, un forfait validé — à l'écriture comme au
--     retrait ;
--   - CE QUE LES CONTRAINTES TIENNENT SANS LE CODE : un forfait ne porte ni pièce, ni mouvement, ni bien, et
--     tombe au 31 décembre ;
--   - CE QUE LE CATALOGUE DIT, faute de pouvoir le jouer : un véhicule qui porte un forfait ne se supprime
--     pas directement (la clé est SANS action), et la suppression d'un dossier passe (ses véhicules et ses
--     écritures partent en cascade, la clé sans action ne se vérifiant qu'en fin d'instruction). Les jouer
--     demande une instruction de suppression, que l'outil d'exécution soumet à une confirmation de
--     l'utilisateur : une lecture du catalogue, plus faible et annoncée comme telle, comme pour les dotations ;
--   - QUELQUES INDEMNITÉS DE RÉFÉRENCE, celles que src/lib/baremeKilometrique.test.ts confronte au calcul de
--     l'application ;
--   - et que RIEN ne reste en base après l'essai.
--
-- Chaque contrôle crée son véhicule DANS sa sous-transaction, qui l'emporte en s'annulant (`raise exception
-- 'ANNULATION_ESSAI'`, P0001), le verdict étant posé dans une VARIABLE avant le `raise` — le mécanisme de
-- rls.sql. Un refus se juge à son code ET à son message : un P0001 sans rapport ressemblerait sinon à un refus.
-- Les verdicts voyagent dans un réglage LOCAL à la transaction (`essai.forfait`), que la requête finale lit :
-- le fichier se joue d'un seul appel, et ne crée aucune table, même temporaire.
--
-- Le contrôle 9 dépend du barème de l'exercice EN COURS : tant que celui-ci n'est pas saisi dans
-- l'application (celui des revenus 2027 ne paraîtra qu'au printemps 2028), c'est le refus « barème non
-- renseigné » qu'il attend, et il le dit.
--
-- ÉPROUVÉ LE 04/10/2026 : 35 contrôles sur 35, le texte transmis étant ce fichier sans ses commentaires
-- (vérifié par différence). Et l'essai sait échouer : sans le `set local role anon`, les contrôles 1 et 2
-- virent au rouge — l'appel passe le droit d'exécution, et c'est la fonction qui refuse, avec un autre
-- message. Les autres refus viennent du contrôle d'accès de la fonction, qui lit la session et non le rôle,
-- ou des contraintes, qui valent pour tout le monde.
--
-- REJOUÉ LE 04/10/2026 après les migrations de la validation d'un exercice : l'écriture validée dont
-- l'essai a besoin se pose désormais comme `valider_exercice` la pose, sous le réglage
-- `jd.validation_exercice` du dossier et avec les champs que lit son FEC — une écriture ne passe plus à
-- `validee` autrement. 35 contrôles sur 35 en production, le texte transmis identique au fichier sans ses
-- commentaires.
do $$
declare
  inconnu uuid := gen_random_uuid();
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_test uuid := '001c7ed7-c23b-4590-901e-693489f8af24';

  dossier_client uuid; cabinet uuid; vehicule uuid; dossier_jetable uuid;
  accepte boolean; code_recu text; message text; obs text; ok boolean; n int;
  nb_avant int; nb_apres int; vehicules_avant int; dossiers_avant int; ouvertures_avant int;
  annee_courante int := extract(year from (now() at time zone 'Europe/Paris'))::int;
  bareme_courant boolean;
  verdicts jsonb := '[]'::jsonb;

  -- Une voiture de 5 CV, thermique, 12 000 km en 2025 : 12 000 × 0,357 + 1 395 = 5 679 €.
  f2025 jsonb := jsonb_build_array(
    jsonb_build_object('compte', '625110', 'sens', 'debit', 'montant', 5679, 'libelle', 'essai'),
    jsonb_build_object('compte', '108000', 'sens', 'credit', 'montant', 5679, 'libelle', 'essai'));
  vide jsonb := '[]'::jsonb;
begin
  select m.dossier_id into dossier_client from memberships m where m.user_id = client order by m.dossier_id limit 1;
  select cabinet_id into cabinet from dossiers where id = dossier_test;
  if dossier_client is null or cabinet is null or dossier_client = dossier_test then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable';
  end if;
  select exists (select 1 from bareme_kilometrique() b where annee_courante = any (b.annees)) into bareme_courant;

  select count(*) into nb_avant from ecritures_brouillon;
  select count(*) into vehicules_avant from vehicules;
  select count(*) into dossiers_avant from dossiers;
  select count(*) into ouvertures_avant from a_nouveaux;

  -- ══ 1 et 2. Anonyme : pas d'EXECUTE, sur aucune des deux fonctions ══════════════════════════════════
  for obs in select unnest(array['1. anonyme, écrire', '2. anonyme, retirer']) loop
    set local role anon;
    perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
    accepte := false; code_recu := null; message := null;
    begin
      if obs like '1.%' then perform ecrire_forfait_kilometrique(gen_random_uuid(), f2025);
      else perform retirer_vehicule(gen_random_uuid());
      end if;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', obs, 'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      'ok', not accepte and code_recu = '42501' and message like 'permission denied%');
  end loop;

  -- ══ 3 et 4. Rattaché à rien : refusé par la fonction ═══════════════════════════════════════════════════
  for obs in select unnest(array['3. rattaché à rien, écrire', '4. rattaché à rien, retirer']) loop
    accepte := false; code_recu := null; message := null;
    begin
      insert into vehicules (dossier_id, annee, modele, type, puissance_fiscale, motorisation, km_professionnel)
      values (dossier_test, 2025, 'VÉHICULE ESSAI', 'voiture', 5, 'thermique', 12000) returning id into vehicule;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role','authenticated')::text, true);
      if obs like '3.%' then perform ecrire_forfait_kilometrique(vehicule, f2025);
      else perform retirer_vehicule(vehicule);
      end if;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', obs, 'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      'ok', not accepte and code_recu = '42501' and message = 'Accès refusé à ce véhicule.');
  end loop;

  -- ══ 5 à 7. Le client : sur le dossier d'un autre comme sur le SIEN ═════════════════════════════════════
  for obs in select unnest(array['5. client, véhicule du dossier d''un autre', '6. client, véhicule de son propre dossier',
                                 '7. client, retirer un véhicule de son dossier']) loop
    accepte := false; code_recu := null; message := null;
    begin
      insert into vehicules (dossier_id, annee, modele, type, puissance_fiscale, motorisation, km_professionnel)
      values (case when obs like '5.%' then dossier_test else dossier_client end, 2025, 'VÉHICULE ESSAI', 'voiture', 5,
              'thermique', 12000) returning id into vehicule;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
      if obs like '7.%' then perform retirer_vehicule(vehicule);
      else perform ecrire_forfait_kilometrique(vehicule, f2025);
      end if;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', obs, 'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      'ok', not accepte and code_recu = '42501' and message = 'Accès refusé à ce véhicule.');
  end loop;

  -- ══ 8. Le chef écrit le forfait 2025 : deux lignes, au 31 décembre, liées au véhicule ═══════════════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    insert into vehicules (dossier_id, annee, modele, type, puissance_fiscale, motorisation, km_professionnel)
    values (dossier_test, 2025, 'VÉHICULE ESSAI', 'voiture', 5, 'thermique', 12000) returning id into vehicule;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    n := ecrire_forfait_kilometrique(vehicule, f2025);
    select string_agg(e.compte || ':' || e.sens || ':' || e.montant::text || ':' || e.date::text
                      || ':' || (e.piece_id is null and e.ligne_bancaire_id is null and e.immobilisation_id is null)::text
                      || ':' || e.statut, ',' order by e.compte)
      into obs from ecritures_brouillon e where e.vehicule_id = vehicule;
    ok := n = 2 and obs = '108000:credit:5679:2025-12-31:true:proposee,625110:debit:5679:2025-12-31:true:proposee';
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '8. le chef écrit le forfait 2025',
    'observe', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    'ok', accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 9. Le forfait de l'exercice en cours s'écrit déjà — si son barème est saisi ═════════════════════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    insert into vehicules (dossier_id, annee, modele, type, puissance_fiscale, motorisation, km_professionnel)
    values (dossier_test, annee_courante, 'VÉHICULE ESSAI', 'voiture', 5, 'thermique', 12000) returning id into vehicule;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    n := ecrire_forfait_kilometrique(vehicule, f2025);
    select string_agg(e.compte || ':' || e.montant::text || ':' || (e.date = make_date(annee_courante, 12, 31))::text,
                      ',' order by e.compte)
      into obs from ecritures_brouillon e where e.vehicule_id = vehicule;
    ok := n = 2 and obs = '108000:5679:true,625110:5679:true';
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '9. le forfait de l''exercice en cours',
    'observe', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, ''))
      || case when bareme_courant then '' else ' (barème ' || annee_courante || ' non saisi : refus attendu)' end,
    'ok', case when bareme_courant then accepte and code_recu = 'P0001' and coalesce(ok, false)
               else not accepte and code_recu = '22023'
                 and message = 'Le barème kilométrique ' || annee_courante || ' n''est pas renseigné dans l''application.' end);

  -- ══ 10 à 12. Les tables du barème : électrique, motorisation non renseignée, demi-centime ════════════
  -- 8 000 km en 5 CV électrique : 8 000 × 0,428 + 1 674 = 5 098 €. Une motorisation non renseignée est
  -- thermique : 5 679 €. 45 km en 3 CV : 45 × 0,529 = 23,805 €, donc 23,81 € — le demi-centime vers le haut.
  for obs in select unnest(array['10. la table électrique', '11. une motorisation non renseignée est thermique',
                                 '12. le demi-centime vers le haut']) loop
    accepte := false; code_recu := null; message := null; ok := false;
    begin
      insert into vehicules (dossier_id, annee, modele, type, puissance_fiscale, motorisation, km_professionnel)
      values (dossier_test, 2025, 'VÉHICULE ESSAI', 'voiture',
              case when obs like '12.%' then 3 else 5 end,
              case when obs like '10.%' then 'electrique' when obs like '11.%' then null else 'thermique' end,
              case when obs like '10.%' then 8000 when obs like '11.%' then 12000 else 45 end) returning id into vehicule;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      n := ecrire_forfait_kilometrique(vehicule, jsonb_build_array(
        jsonb_build_object('compte', '625110', 'sens', 'debit', 'montant', case substring(obs from '^(\d+)') when '10' then 5098 when '11' then 5679 else 23.81 end),
        jsonb_build_object('compte', '108000', 'sens', 'credit', 'montant', case substring(obs from '^(\d+)') when '10' then 5098 when '11' then 5679 else 23.81 end)));
      ok := n = 2;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', obs, 'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      'ok', accepte and code_recu = 'P0001' and coalesce(ok, false));
  end loop;

  -- ══ 13. En engagement, le crédit va au compte choisi pour le dirigeant ══════════════════════════════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    insert into dossiers (nom, cabinet_id, mode_comptable, compte_notes_de_frais)
    values ('Dossier d''essai (forfait)', cabinet, 'engagement', '467000') returning id into dossier_jetable;
    insert into vehicules (dossier_id, annee, modele, type, puissance_fiscale, motorisation, km_professionnel)
    values (dossier_jetable, 2025, 'VÉHICULE ESSAI', 'voiture', 5, 'thermique', 12000) returning id into vehicule;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    n := ecrire_forfait_kilometrique(vehicule, jsonb_build_array(
      jsonb_build_object('compte', '625110', 'sens', 'debit', 'montant', 5679),
      jsonb_build_object('compte', '467000', 'sens', 'credit', 'montant', 5679)));
    select string_agg(e.compte || ':' || e.sens, ',' order by e.compte) into obs from ecritures_brouillon e where e.vehicule_id = vehicule;
    ok := n = 2 and obs = '467000:credit,625110:debit';
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '13. en engagement, le compte choisi pour le dirigeant',
    'observe', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    'ok', accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 14. Une seconde écriture REMPLACE la première ══════════════════════════════════════════════════════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    insert into vehicules (dossier_id, annee, modele, type, puissance_fiscale, motorisation, km_professionnel)
    values (dossier_test, 2025, 'VÉHICULE ESSAI', 'voiture', 5, 'thermique', 12000) returning id into vehicule;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform ecrire_forfait_kilometrique(vehicule, f2025);
    perform ecrire_forfait_kilometrique(vehicule, jsonb_build_array(
      jsonb_build_object('compte', '625110', 'sens', 'debit', 'montant', 5679, 'libelle', 'réécrit'),
      jsonb_build_object('compte', '108000', 'sens', 'credit', 'montant', 5679, 'libelle', 'réécrit')));
    select count(*)::text || ' ligne(s), ' || string_agg(distinct e.libelle, ',')
      into obs from ecritures_brouillon e where e.vehicule_id = vehicule;
    ok := obs = '2 ligne(s), réécrit';
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '14. une seconde écriture remplace la première',
    'observe', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    'ok', accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 15. Un forfait devenu nul retire celui qui était écrit ═════════════════════════════════════════════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    insert into vehicules (dossier_id, annee, modele, type, puissance_fiscale, motorisation, km_professionnel)
    values (dossier_test, 2025, 'VÉHICULE ESSAI', 'voiture', 5, 'thermique', 12000) returning id into vehicule;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform ecrire_forfait_kilometrique(vehicule, f2025);
    update vehicules set km_professionnel = 0 where id = vehicule;
    n := ecrire_forfait_kilometrique(vehicule, vide);
    select count(*) into n from ecritures_brouillon e where e.vehicule_id = vehicule;
    obs := n || ' ligne(s) restante(s)';
    ok := n = 0;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '15. un forfait devenu nul retire l''écriture',
    'observe', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    'ok', accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 16 à 21. Une écriture qui ne correspond pas est refusée ═════════════════════════════════════════════
  for obs in select unnest(array[
      '16. refus : écriture non vide sur un forfait nul', '17. refus : montant faux',
      '18. refus : le demi-centime arrondi vers le bas', '19. refus : compte du dirigeant faux',
      '20. refus : une ligne de trop', '21. refus : sens inversés']) loop
    accepte := false; code_recu := null; message := null;
    begin
      insert into vehicules (dossier_id, annee, modele, type, puissance_fiscale, motorisation, km_professionnel)
      values (dossier_test, 2025, 'VÉHICULE ESSAI', 'voiture',
              case when obs like '18.%' then 3 else 5 end, 'thermique',
              case when obs like '16.%' then 0 when obs like '18.%' then 45 else 12000 end) returning id into vehicule;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      perform ecrire_forfait_kilometrique(vehicule, case substring(obs from '^(\d+)')
        when '16' then f2025
        when '17' then jsonb_build_array(
          jsonb_build_object('compte', '625110', 'sens', 'debit', 'montant', 5678.99),
          jsonb_build_object('compte', '108000', 'sens', 'credit', 'montant', 5678.99))
        when '18' then jsonb_build_array(
          jsonb_build_object('compte', '625110', 'sens', 'debit', 'montant', 23.80),
          jsonb_build_object('compte', '108000', 'sens', 'credit', 'montant', 23.80))
        when '19' then jsonb_build_array(
          jsonb_build_object('compte', '625110', 'sens', 'debit', 'montant', 5679),
          jsonb_build_object('compte', '455000', 'sens', 'credit', 'montant', 5679))
        when '20' then f2025 || jsonb_build_array(jsonb_build_object('compte', '625110', 'sens', 'debit', 'montant', 0.01))
        else jsonb_build_array(
          jsonb_build_object('compte', '625110', 'sens', 'credit', 'montant', 5679),
          jsonb_build_object('compte', '108000', 'sens', 'debit', 'montant', 5679))
      end);
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', obs, 'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      'ok', not accepte and code_recu = '22023' and message = 'L''écriture proposée ne correspond pas au forfait 2025 de ce véhicule.');
  end loop;

  -- ══ 22 à 24. Refus : un exercice à venir, un barème absent, une puissance hors barème ═══════════════════
  for obs in select unnest(array['22. refus : un exercice à venir', '23. refus : un barème absent',
                                 '24. refus : une puissance hors barème']) loop
    accepte := false; code_recu := null; message := null;
    begin
      insert into vehicules (dossier_id, annee, modele, type, puissance_fiscale, motorisation, km_professionnel)
      values (dossier_test, case substring(obs from '^(\d+)') when '22' then annee_courante + 1 when '23' then 2024 else 2025 end,
              'VÉHICULE ESSAI', case when obs like '24.%' then 'moto' else 'voiture' end,
              case when obs like '24.%' then 0 else 5 end, 'thermique', 1000) returning id into vehicule;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      perform ecrire_forfait_kilometrique(vehicule, f2025);
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', obs, 'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      'ok', not accepte and code_recu = '22023' and message = case substring(obs from '^(\d+)')
        when '22' then 'Le forfait d''un exercice à venir ne s''écrit pas encore.'
        when '23' then 'Le barème kilométrique 2024 n''est pas renseigné dans l''application.'
        else 'La puissance fiscale de ce véhicule est hors du barème kilométrique 2025.' end);
  end loop;

  -- ══ 25 et 26. Refus : un forfait validé ne se remplace ni ne se retire ══════════════════════════════════
  for obs in select unnest(array['25. refus : réécrire un forfait validé', '26. refus : retirer un véhicule dont le forfait est validé']) loop
    accepte := false; code_recu := null; message := null;
    begin
      insert into vehicules (dossier_id, annee, modele, type, puissance_fiscale, motorisation, km_professionnel)
      values (dossier_test, 2025, 'VÉHICULE ESSAI', 'voiture', 5, 'thermique', 12000) returning id into vehicule;
      -- Un forfait se valide comme `valider_exercice` le valide : sous le réglage de son dossier, avec les
      -- champs que son FEC lit (contrainte `ecritures_brouillon_validation_complete`).
      perform set_config('jd.validation_exercice', dossier_test::text, true);
      insert into ecritures_brouillon (dossier_id, vehicule_id, date, compte, libelle, montant, sens, statut,
                                       valide_le, journal_code, numero_ecriture, piece_ref, piece_date, compte_lib)
      values (dossier_test, vehicule, '2025-12-31', '625110', 'essai', 5679, 'debit', 'validee',
              now(), 'OD', 1, 'essai', '2025-12-31', 'essai'),
             (dossier_test, vehicule, '2025-12-31', '108000', 'essai', 5679, 'credit', 'validee',
              now(), 'OD', 1, 'essai', '2025-12-31', 'essai');
      perform set_config('jd.validation_exercice', '', true);
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      if obs like '25.%' then perform ecrire_forfait_kilometrique(vehicule, f2025);
      else perform retirer_vehicule(vehicule);
      end if;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', obs, 'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      'ok', not accepte and code_recu = '23514' and message = case when obs like '25.%'
        then 'Le forfait 2025 de ce véhicule est validé : il ne se remplace plus.'
        else 'Le forfait de ce véhicule est validé : il ne se retire plus.' end);
  end loop;

  -- ══ 27. Refus : un exercice antérieur à l'ouverture du dossier ═════════════════════════════════════════
  -- Un dossier jetable ouvert au 1er janvier 2026 : le forfait de 2025 est dans ses comptes repris.
  accepte := false; code_recu := null; message := null;
  begin
    insert into dossiers (nom, cabinet_id) values ('Dossier d''essai (forfait)', cabinet) returning id into dossier_jetable;
    insert into a_nouveaux (dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte)
    values (dossier_jetable, '2026-01-01', '512000', 'essai', 'debit', 1200, 'balance-essai.csv', repeat('a', 64)),
           (dossier_jetable, '2026-01-01', '101000', 'essai', 'credit', 1200, 'balance-essai.csv', repeat('a', 64));
    insert into vehicules (dossier_id, annee, modele, type, puissance_fiscale, motorisation, km_professionnel)
    values (dossier_jetable, 2025, 'VÉHICULE ESSAI', 'voiture', 5, 'thermique', 12000) returning id into vehicule;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform ecrire_forfait_kilometrique(vehicule, f2025);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '27. refus : un exercice antérieur à l''ouverture',
    'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    'ok', not accepte and code_recu = '22023'
      and message = 'L''exercice 2025 précède l''ouverture du dossier : son forfait est dans les comptes repris.');

  -- ══ 28. Avant l'ouverture, un forfait écrit avant la reprise se retire ═════════════════════════════════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    insert into dossiers (nom, cabinet_id) values ('Dossier d''essai (forfait)', cabinet) returning id into dossier_jetable;
    insert into vehicules (dossier_id, annee, modele, type, puissance_fiscale, motorisation, km_professionnel)
    values (dossier_jetable, 2025, 'VÉHICULE ESSAI', 'voiture', 5, 'thermique', 12000) returning id into vehicule;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform ecrire_forfait_kilometrique(vehicule, f2025);
    reset role;
    insert into a_nouveaux (dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte)
    values (dossier_jetable, '2026-01-01', '512000', 'essai', 'debit', 1200, 'balance-essai.csv', repeat('a', 64)),
           (dossier_jetable, '2026-01-01', '101000', 'essai', 'credit', 1200, 'balance-essai.csv', repeat('a', 64));
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    n := ecrire_forfait_kilometrique(vehicule, vide);
    select count(*) into n from ecritures_brouillon e where e.vehicule_id = vehicule;
    obs := n || ' ligne(s) restante(s)';
    ok := n = 0;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '28. avant l''ouverture, le forfait se retire',
    'observe', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    'ok', accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 29. Le chef retire un véhicule : son forfait part avec lui ══════════════════════════════════════════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    insert into vehicules (dossier_id, annee, modele, type, puissance_fiscale, motorisation, km_professionnel)
    values (dossier_test, 2025, 'VÉHICULE ESSAI', 'voiture', 5, 'thermique', 12000) returning id into vehicule;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform ecrire_forfait_kilometrique(vehicule, f2025);
    n := retirer_vehicule(vehicule);
    obs := n || ' ligne(s) retirée(s), véhicule restant : ' || (select count(*) from vehicules where id = vehicule)
           || ', lignes restantes : ' || (select count(*) from ecritures_brouillon where vehicule_id = vehicule);
    ok := obs = '2 ligne(s) retirée(s), véhicule restant : 0, lignes restantes : 0';
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '29. le chef retire un véhicule et son forfait',
    'observe', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    'ok', accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 30. Ce que le catalogue dit des suppressions ════════════════════════════════════════════════════════
  -- La clé d'un forfait vers son véhicule est SANS action (un véhicule dont le forfait est écrit ne se
  -- supprime pas directement, mais par `retirer_vehicule`), et celles des véhicules et des écritures vers le
  -- dossier sont en CASCADE : supprimer un dossier les emporte, la clé sans action ne se vérifiant qu'en fin
  -- d'instruction.
  select string_agg(c.conrelid::regclass::text || '.' || a.attname || ':' || c.confdeltype::text, ','
                    order by c.conrelid::regclass::text, a.attname)
    into obs
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.contype = 'f'
    and ((c.conrelid = 'public.ecritures_brouillon'::regclass and a.attname in ('vehicule_id', 'dossier_id'))
      or (c.conrelid = 'public.vehicules'::regclass and a.attname = 'dossier_id'));
  verdicts := verdicts || jsonb_build_object('controle', '30. catalogue : suppressions', 'observe', obs,
    'ok', obs = 'ecritures_brouillon.dossier_id:c,ecritures_brouillon.vehicule_id:a,vehicules.dossier_id:c');

  -- ══ 31 à 33. Une contrainte nommée refuse ═══════════════════════════════════════════════════════════════
  for obs in select unnest(array[
      '31. contrainte : un forfait ne porte pas de pièce', '32. contrainte : un forfait ne porte pas de bien',
      '33. contrainte : un forfait tombe au 31 décembre']) loop
    accepte := false; code_recu := null; message := null;
    begin
      insert into vehicules (dossier_id, annee, modele, type, puissance_fiscale, motorisation, km_professionnel)
      values (dossier_test, 2025, 'VÉHICULE ESSAI', 'voiture', 5, 'thermique', 12000) returning id into vehicule;
      insert into ecritures_brouillon (dossier_id, vehicule_id, piece_id, immobilisation_id, date, compte, libelle, montant, sens)
      values (dossier_test, vehicule,
              case when obs like '31.%' then (select id from pieces where dossier_id = dossier_test order by id limit 1) end,
              case when obs like '32.%' then (select id from immobilisations order by id limit 1) end,
              case when obs like '33.%' then date '2025-06-30' else date '2025-12-31' end,
              '625110', 'essai', 5679, 'debit');
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    verdicts := verdicts || jsonb_build_object('controle', obs, 'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      'ok', not accepte and code_recu = '23514' and message like '%' || case when obs like '33.%'
        then 'ecritures_brouillon_forfait_au_31_decembre' else 'ecritures_brouillon_forfait_sans_piece_ni_mouvement' end || '%');
  end loop;

  -- ══ 34. Quelques indemnités de référence, en centimes ════════════════════════════════════════════════
  -- Celles que src/lib/baremeKilometrique.test.ts confronte au calcul de l'application.
  select string_agg(coalesce(x, 'null'), ',' order by i) into obs from (values
    (1, indemnite_kilometrique_centimes(2025, 'voiture', 5, false, 12000)::text),
    (2, indemnite_kilometrique_centimes(2026, 'voiture', 5, true, 20000)::text),
    (3, indemnite_kilometrique_centimes(2025, 'moto', 1, false, 3001)::text),
    (4, indemnite_kilometrique_centimes(2026, 'cyclomoteur', 0, true, 6001)::text),
    (5, indemnite_kilometrique_centimes(2025, 'voiture', 100, false, 1000)::text),
    (6, indemnite_kilometrique_centimes(2025, 'moto', 0, false, 1000)::text),
    (7, indemnite_kilometrique_centimes(2024, 'voiture', 5, false, 1000)::text),
    (8, indemnite_kilometrique_centimes(2025, 'voiture', 3, false, 45)::text)
  ) as t(i, x);
  verdicts := verdicts || jsonb_build_object('controle', '34. indemnités de référence', 'observe', obs,
    'ok', obs = '567900,1023400,118810,142824,null,null,null,2381');

  -- ══ 35. Rien n'est resté ══════════════════════════════════════════════════════════════════════════════
  select count(*) into nb_apres from ecritures_brouillon;
  verdicts := verdicts || jsonb_build_object('controle', '35. rien n''est resté en base',
    'observe', 'écritures ' || nb_avant || ' -> ' || nb_apres
      || ', véhicules ' || vehicules_avant || ' -> ' || (select count(*) from vehicules)
      || ', dossiers ' || dossiers_avant || ' -> ' || (select count(*) from dossiers)
      || ', ouvertures ' || ouvertures_avant || ' -> ' || (select count(*) from a_nouveaux),
    'ok', nb_avant = nb_apres
      and vehicules_avant = (select count(*) from vehicules)
      and dossiers_avant = (select count(*) from dossiers)
      and ouvertures_avant = (select count(*) from a_nouveaux)
      and not exists (select 1 from vehicules where modele = 'VÉHICULE ESSAI'));

  perform set_config('essai.forfait', verdicts::text, true);
end $$;

select v.controle, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.forfait')::jsonb) as v(controle text, ok boolean, observe text)
order by (regexp_match(v.controle, '^(\d+)'))[1]::int, v.controle;
