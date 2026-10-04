-- LES DOTATIONS AUX AMORTISSEMENTS ET LEURS ÉCRITURES, ÉPROUVÉES EN BASE — à rejouer par `execute_sql`
-- après toute migration qui touche `ecrire_dotation_amortissement`, `retirer_immobilisation`, le calcul
-- (`dotation_amortissement`, `amortissement_cumule_centimes`, `rang_360`, `compte_amortissement`), les
-- tables `immobilisations` et `natures_immobilisation` ou les contraintes d'`ecritures_brouillon` (ligne
-- 26.6 de la feuille de route, étape b).
--
-- La première fonction écrit la dotation d'un bien pour un exercice — le 681100 au débit, le compte 28 de
-- sa nature au crédit, au 31 décembre —, vérifiée contre le registre, et remplace celle qui était écrite ;
-- la seconde retire un bien ET ses dotations. Ce qui se prouve ici, et ne se relit pas :
--   - QUI peut : un anonyme n'a pas le droit d'appeler, un compte rattaché à rien et un client se font
--     refuser — le client sur le dossier d'un autre comme sur le SIEN —, et le chef du cabinet écrit bien
--     (le contrôle POSITIF, sans lequel les refus seraient satisfaits par une fonction qui refuse tout le
--     monde) ;
--   - CE QUI s'écrit : deux lignes au 31 décembre, liées au bien, au montant du calcul prorata temporis ;
--     une seconde écriture REMPLACE la première ; une dotation devenue nulle retire celle qui était écrite,
--     y compris avant l'ouverture du dossier ; un retrait de bien emporte ses dotations ;
--   - CE QUI est refusé, avec sa RAISON : un montant, un compte, un sens ou une ligne qui ne correspondent
--     pas, une écriture non vide là où la dotation est nulle, un exercice à venir, un exercice antérieur à
--     l'ouverture, un bien sans nature, une dotation validée — à l'écriture comme au retrait ;
--   - CE QUE LES CONTRAINTES TIENNENT SANS LE CODE : une dotation ne porte ni pièce ni mouvement, et tombe
--     au 31 décembre ; le compte d'une nature est de classe 20 ou 21 ; une valeur est au centime ;
--   - CE QUE LE CATALOGUE DIT, faute de pouvoir le jouer : un bien qui porte une dotation ne se supprime pas
--     directement (la clé est SANS action), et la suppression d'un dossier passe (ses biens et ses écritures
--     partent en cascade, la clé sans action ne se vérifiant qu'en fin d'instruction). Les jouer demande une
--     instruction de suppression, que l'outil d'exécution soumet à une confirmation de l'utilisateur : une
--     lecture du catalogue, plus faible et annoncée comme telle, comme la suppression d'un fichier dans
--     rls.sql ;
--   - QUELQUES DOTATIONS DE RÉFÉRENCE, que src/lib/amortissements.test.ts confronte au calcul de
--     l'application sur une table plus large relevée ici ;
--   - et que RIEN ne reste en base après l'essai.
--
-- Le dossier `test` ne porte aucun bien : chaque contrôle crée le sien DANS sa sous-transaction, qui
-- l'emporte en s'annulant (`raise exception 'ANNULATION_ESSAI'`, P0001), le verdict étant posé dans une
-- VARIABLE avant le `raise` — le mécanisme de rls.sql. Un refus se juge à son code ET à son message : un
-- P0001 sans rapport ressemblerait sinon à un refus. La table des verdicts disparaît avec la transaction
-- (`on commit drop`) : le fichier se joue d'un seul appel.
--
-- ÉPROUVÉ LE 01/10/2026 : 30 contrôles sur 30, le texte transmis identique au fichier. Et l'essai sait
-- échouer : sans le `set local role anon`, les contrôles 1 et 2 virent au rouge (l'appel passe le droit
-- d'exécution, et c'est la fonction qui refuse, avec un autre message). Les autres restent verts sous cette
-- mutation, et c'est attendu : leurs refus viennent du contrôle d'accès de la fonction, qui lit la session
-- et non le rôle, ou des contraintes, qui valent pour tout le monde.
--
-- REJOUÉ LE 04/10/2026 après les migrations de la validation d'un exercice : l'écriture validée dont
-- l'essai a besoin se pose désormais comme `valider_exercice` la pose, sous le réglage
-- `jd.validation_exercice` du dossier et avec les champs que lit son FEC — une écriture ne passe plus à
-- `validee` autrement. 30 contrôles sur 30 en production, le texte transmis identique au fichier sans ses
-- commentaires.
create temp table essai_dotation (controle text, observe text, ok boolean) on commit drop;

do $$
declare
  inconnu uuid := gen_random_uuid();
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_test uuid := '001c7ed7-c23b-4590-901e-693489f8af24';

  dossier_client uuid; nature_info uuid; cabinet uuid;
  bien uuid; dossier_jetable uuid;
  accepte boolean; code_recu text; message text; obs text; ok boolean;
  n int; nb_avant int; nb_apres int; biens_avant int; natures_avant int; dossiers_avant int; ouvertures_avant int;
  annee_courante int := extract(year from (now() at time zone 'Europe/Paris'))::int;

  -- Un bien de 1 200 € sur trois ans mis en service le 1er juillet 2025 : 180 jours en 2025, donc 200 €,
  -- puis 400 € par an, et 200 € de reliquat en 2028. Sa nature (Informatique) porte le 218300 : la
  -- dotation va au 281830.
  d2025 jsonb := jsonb_build_array(
    jsonb_build_object('compte', '681100', 'sens', 'debit', 'montant', 200, 'libelle', 'essai'),
    jsonb_build_object('compte', '281830', 'sens', 'credit', 'montant', 200, 'libelle', 'essai'));
  d2026 jsonb := jsonb_build_array(
    jsonb_build_object('compte', '681100', 'sens', 'debit', 'montant', 400),
    jsonb_build_object('compte', '281830', 'sens', 'credit', 'montant', 400));
  vide jsonb := '[]'::jsonb;
begin
  select m.dossier_id into dossier_client from memberships m where m.user_id = client order by m.dossier_id limit 1;
  select id into nature_info from natures_immobilisation
   where dossier_id is null and libelle = 'Informatique (ordinateur, imprimante...)';
  select cabinet_id into cabinet from dossiers where id = dossier_test;
  if dossier_client is null or nature_info is null or cabinet is null or dossier_client = dossier_test then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable';
  end if;

  select count(*) into nb_avant from ecritures_brouillon;
  select count(*) into biens_avant from immobilisations;
  select count(*) into natures_avant from natures_immobilisation;
  select count(*) into dossiers_avant from dossiers;
  select count(*) into ouvertures_avant from a_nouveaux;

  -- ══ 1 et 2. Anonyme : pas d'EXECUTE, sur aucune des deux fonctions ══════════════════════════════
  for obs in select unnest(array['1. anonyme, écrire', '2. anonyme, retirer']) loop
    set local role anon;
    perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
    accepte := false; code_recu := null; message := null;
    begin
      if obs like '1.%' then perform ecrire_dotation_amortissement(gen_random_uuid(), 2025, d2025);
      else perform retirer_immobilisation(gen_random_uuid());
      end if;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    insert into essai_dotation values (obs, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and code_recu = '42501' and message like 'permission denied%');
  end loop;

  -- ══ 3 et 4. Rattaché à rien : refusé par la fonction ═══════════════════════════════════════════════
  for obs in select unnest(array['3. rattaché à rien, écrire', '4. rattaché à rien, retirer']) loop
    accepte := false; code_recu := null; message := null;
    begin
      insert into immobilisations (dossier_id, nature_id, libelle, valeur, date_acquisition, duree_annees)
      values (dossier_test, nature_info, 'BIEN ESSAI', 1200, '2025-07-01', 3) returning id into bien;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role','authenticated')::text, true);
      if obs like '3.%' then perform ecrire_dotation_amortissement(bien, 2025, d2025);
      else perform retirer_immobilisation(bien);
      end if;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    insert into essai_dotation values (obs, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and code_recu = '42501' and message = 'Accès refusé à ce bien.');
  end loop;

  -- ══ 5 à 7. Le client : sur le dossier d'un autre comme sur le SIEN ═══════════════════════════════
  for obs in select unnest(array['5. client, bien du dossier d''un autre', '6. client, bien de son propre dossier',
                                 '7. client, retirer un bien de son dossier']) loop
    accepte := false; code_recu := null; message := null;
    begin
      insert into immobilisations (dossier_id, nature_id, libelle, valeur, date_acquisition, duree_annees)
      values (case when obs like '5.%' then dossier_test else dossier_client end, nature_info, 'BIEN ESSAI', 1200,
              '2025-07-01', 3) returning id into bien;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
      if obs like '7.%' then perform retirer_immobilisation(bien);
      else perform ecrire_dotation_amortissement(bien, 2025, d2025);
      end if;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    insert into essai_dotation values (obs, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and code_recu = '42501' and message = 'Accès refusé à ce bien.');
  end loop;

  -- ══ 8. Le chef écrit la dotation 2025 : deux lignes, au 31 décembre, liées au bien ═══════════════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    insert into immobilisations (dossier_id, nature_id, libelle, valeur, date_acquisition, duree_annees)
    values (dossier_test, nature_info, 'BIEN ESSAI', 1200, '2025-07-01', 3) returning id into bien;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    n := ecrire_dotation_amortissement(bien, 2025, d2025);
    select string_agg(e.compte || ':' || e.sens || ':' || e.montant::text || ':' || e.date::text
                      || ':' || (e.piece_id is null and e.ligne_bancaire_id is null)::text || ':' || e.statut,
                      ',' order by e.compte)
      into obs from ecritures_brouillon e where e.immobilisation_id = bien;
    ok := n = 2 and obs = '281830:credit:200:2025-12-31:true:proposee,681100:debit:200:2025-12-31:true:proposee';
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_dotation values ('8. le chef écrit la dotation 2025', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 9. La dotation de l'exercice en cours s'écrit déjà ═══════════════════════════════════════════
  -- Un bien mis en service le 1er juillet de l'an dernier : sa deuxième année est pleine, 400 €, quelle
  -- que soit l'année où l'essai tourne.
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    insert into immobilisations (dossier_id, nature_id, libelle, valeur, date_acquisition, duree_annees)
    values (dossier_test, nature_info, 'BIEN ESSAI', 1200, make_date(annee_courante - 1, 7, 1), 3) returning id into bien;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    n := ecrire_dotation_amortissement(bien, annee_courante, d2026);
    select string_agg(e.compte || ':' || e.montant::text || ':' || (e.date = make_date(annee_courante, 12, 31))::text,
                      ',' order by e.compte)
      into obs from ecritures_brouillon e where e.immobilisation_id = bien;
    ok := n = 2 and obs = '281830:400:true,681100:400:true';
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_dotation values ('9. la dotation de l''exercice en cours', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 10. Une seconde écriture REMPLACE la première ════════════════════════════════════════════════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    insert into immobilisations (dossier_id, nature_id, libelle, valeur, date_acquisition, duree_annees)
    values (dossier_test, nature_info, 'BIEN ESSAI', 1200, '2025-07-01', 3) returning id into bien;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform ecrire_dotation_amortissement(bien, 2025, d2025);
    perform ecrire_dotation_amortissement(bien, 2025, jsonb_build_array(
      jsonb_build_object('compte', '681100', 'sens', 'debit', 'montant', 200, 'libelle', 'réécrite'),
      jsonb_build_object('compte', '281830', 'sens', 'credit', 'montant', 200, 'libelle', 'réécrite')));
    select count(*)::text || ' ligne(s), ' || string_agg(distinct e.libelle, ',')
      into obs from ecritures_brouillon e where e.immobilisation_id = bien;
    ok := obs = '2 ligne(s), réécrite';
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_dotation values ('10. une seconde écriture remplace la première', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 11. Une dotation devenue nulle retire celle qui était écrite ═════════════════════════════════
  -- La mise en service repoussée en 2026 : 2025 n'a plus de dotation, et l'appel vide la retire.
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    insert into immobilisations (dossier_id, nature_id, libelle, valeur, date_acquisition, duree_annees)
    values (dossier_test, nature_info, 'BIEN ESSAI', 1200, '2025-07-01', 3) returning id into bien;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform ecrire_dotation_amortissement(bien, 2025, d2025);
    update immobilisations set date_mise_en_service = '2026-01-01' where id = bien;
    n := ecrire_dotation_amortissement(bien, 2025, vide);
    select count(*) into n from ecritures_brouillon e where e.immobilisation_id = bien;
    obs := n || ' ligne(s) restante(s)';
    ok := n = 0;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_dotation values ('11. une dotation devenue nulle retire l''écriture', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 12 à 16. Une écriture qui ne correspond pas est refusée ═══════════════════════════════════════
  for obs in select unnest(array[
      '12. refus : écriture non vide sur une dotation nulle', '13. refus : montant faux',
      '14. refus : compte d''amortissement faux', '15. refus : une ligne de trop', '16. refus : sens inversés']) loop
    accepte := false; code_recu := null; message := null;
    begin
      insert into immobilisations (dossier_id, nature_id, libelle, valeur, date_acquisition, date_mise_en_service, duree_annees)
      values (dossier_test, nature_info, 'BIEN ESSAI', 1200, '2025-07-01',
              case when obs like '12.%' then date '2026-01-01' end, 3) returning id into bien;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      perform ecrire_dotation_amortissement(bien, 2025, case substring(obs from '^(\d+)')
        when '12' then d2025
        when '13' then jsonb_build_array(
          jsonb_build_object('compte', '681100', 'sens', 'debit', 'montant', 400),
          jsonb_build_object('compte', '281830', 'sens', 'credit', 'montant', 400))
        when '14' then jsonb_build_array(
          jsonb_build_object('compte', '681100', 'sens', 'debit', 'montant', 200),
          jsonb_build_object('compte', '281800', 'sens', 'credit', 'montant', 200))
        when '15' then d2025 || jsonb_build_array(jsonb_build_object('compte', '681100', 'sens', 'debit', 'montant', 0.01))
        else jsonb_build_array(
          jsonb_build_object('compte', '681100', 'sens', 'credit', 'montant', 200),
          jsonb_build_object('compte', '281830', 'sens', 'debit', 'montant', 200))
      end);
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    insert into essai_dotation values (obs, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and code_recu = '22023' and message = 'L''écriture proposée ne correspond pas à la dotation 2025 de ce bien.');
  end loop;

  -- ══ 17. Refus : un exercice à venir ══════════════════════════════════════════════════════════════
  accepte := false; code_recu := null; message := null;
  begin
    insert into immobilisations (dossier_id, nature_id, libelle, valeur, date_acquisition, duree_annees)
    values (dossier_test, nature_info, 'BIEN ESSAI', 1200, '2025-07-01', 3) returning id into bien;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform ecrire_dotation_amortissement(bien, annee_courante + 1, d2026);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_dotation values ('17. refus : un exercice à venir', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '22023' and message = 'La dotation d''un exercice à venir ne s''écrit pas encore.');

  -- ══ 18. Refus : un bien sans nature ══════════════════════════════════════════════════════════════
  accepte := false; code_recu := null; message := null;
  begin
    insert into immobilisations (dossier_id, nature_id, libelle, valeur, date_acquisition, duree_annees)
    values (dossier_test, null, 'BIEN ESSAI', 1200, '2025-07-01', 3) returning id into bien;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform ecrire_dotation_amortissement(bien, 2025, d2025);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_dotation values ('18. refus : un bien sans nature', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '22023'
      and message = 'Choisissez la nature de ce bien : c''est elle qui donne son compte d''amortissement.');

  -- ══ 19 et 20. Refus : une dotation validée ne se remplace ni ne se retire ════════════════════════
  for obs in select unnest(array['19. refus : réécrire une dotation validée', '20. refus : retirer un bien dont une dotation est validée']) loop
    accepte := false; code_recu := null; message := null;
    begin
      insert into immobilisations (dossier_id, nature_id, libelle, valeur, date_acquisition, duree_annees)
      values (dossier_test, nature_info, 'BIEN ESSAI', 1200, '2025-07-01', 3) returning id into bien;
      -- Une dotation se valide comme `valider_exercice` la valide : sous le réglage de son dossier, avec les
      -- champs que son FEC lit (contrainte `ecritures_brouillon_validation_complete`).
      perform set_config('jd.validation_exercice', dossier_test::text, true);
      insert into ecritures_brouillon (dossier_id, immobilisation_id, date, compte, libelle, montant, sens, statut,
                                       valide_le, journal_code, numero_ecriture, piece_ref, piece_date, compte_lib)
      values (dossier_test, bien, '2025-12-31', '681100', 'essai', 200, 'debit', 'validee',
              now(), 'OD', 1, 'essai', '2025-12-31', 'essai'),
             (dossier_test, bien, '2025-12-31', '281830', 'essai', 200, 'credit', 'validee',
              now(), 'OD', 1, 'essai', '2025-12-31', 'essai');
      perform set_config('jd.validation_exercice', '', true);
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      if obs like '19.%' then perform ecrire_dotation_amortissement(bien, 2025, d2025);
      else perform retirer_immobilisation(bien);
      end if;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    insert into essai_dotation values (obs, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and code_recu = '23514' and message = case when obs like '19.%'
        then 'La dotation 2025 de ce bien est validée : elle ne se remplace plus.'
        else 'Une dotation de ce bien est validée : il ne se retire plus.' end);
  end loop;

  -- ══ 21. Refus : un exercice antérieur à l'ouverture du dossier ═══════════════════════════════════
  -- Un dossier jetable ouvert au 1er janvier 2026 : l'amortissement de 2025 est dans ses à-nouveaux.
  accepte := false; code_recu := null; message := null;
  begin
    insert into dossiers (nom, cabinet_id) values ('Dossier d''essai (dotations)', cabinet) returning id into dossier_jetable;
    insert into a_nouveaux (dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte)
    values (dossier_jetable, '2026-01-01', '218300', 'essai', 'debit', 1200, 'balance-essai.csv', repeat('a', 64)),
           (dossier_jetable, '2026-01-01', '101000', 'essai', 'credit', 1200, 'balance-essai.csv', repeat('a', 64));
    insert into immobilisations (dossier_id, nature_id, libelle, valeur, date_acquisition, duree_annees)
    values (dossier_jetable, nature_info, 'BIEN ESSAI', 1200, '2025-07-01', 3) returning id into bien;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform ecrire_dotation_amortissement(bien, 2025, d2025);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_dotation values ('21. refus : un exercice antérieur à l''ouverture', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '22023'
      and message = 'L''exercice 2025 précède l''ouverture du dossier : sa dotation est déjà dans les à-nouveaux.');

  -- ══ 22. Avant l'ouverture, une dotation écrite avant la reprise se retire ═══════════════════════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    insert into dossiers (nom, cabinet_id) values ('Dossier d''essai (dotations)', cabinet) returning id into dossier_jetable;
    insert into immobilisations (dossier_id, nature_id, libelle, valeur, date_acquisition, duree_annees)
    values (dossier_jetable, nature_info, 'BIEN ESSAI', 1200, '2025-07-01', 3) returning id into bien;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform ecrire_dotation_amortissement(bien, 2025, d2025);
    reset role;
    insert into a_nouveaux (dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte)
    values (dossier_jetable, '2026-01-01', '218300', 'essai', 'debit', 1200, 'balance-essai.csv', repeat('a', 64)),
           (dossier_jetable, '2026-01-01', '101000', 'essai', 'credit', 1200, 'balance-essai.csv', repeat('a', 64));
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    n := ecrire_dotation_amortissement(bien, 2025, vide);
    select count(*) into n from ecritures_brouillon e where e.immobilisation_id = bien;
    obs := n || ' ligne(s) restante(s)';
    ok := n = 0;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_dotation values ('22. avant l''ouverture, l''écriture se retire', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 23. Le chef retire un bien : ses dotations partent avec lui ═════════════════════════════════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    insert into immobilisations (dossier_id, nature_id, libelle, valeur, date_acquisition, duree_annees)
    values (dossier_test, nature_info, 'BIEN ESSAI', 1200, '2025-07-01', 3) returning id into bien;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform ecrire_dotation_amortissement(bien, 2025, d2025);
    perform ecrire_dotation_amortissement(bien, 2026, d2026);
    n := retirer_immobilisation(bien);
    obs := n || ' ligne(s) retirée(s), bien restant : ' || (select count(*) from immobilisations where id = bien)
           || ', lignes restantes : ' || (select count(*) from ecritures_brouillon where immobilisation_id = bien);
    ok := obs = '4 ligne(s) retirée(s), bien restant : 0, lignes restantes : 0';
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_dotation values ('23. le chef retire un bien et ses dotations', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 24. Ce que le catalogue dit des suppressions ════════════════════════════════════════════════
  -- La clé d'une dotation vers son bien est SANS action (un bien amorti ne se supprime pas directement,
  -- mais par `retirer_immobilisation`), et celles des biens et des écritures vers le dossier sont en
  -- CASCADE : supprimer un dossier les emporte, la clé sans action ne se vérifiant qu'en fin d'instruction.
  -- RESTRICT, lui, se vérifierait aussitôt, et la suppression d'un dossier qui porte une dotation
  -- échouerait.
  select string_agg(c.conrelid::regclass::text || '.' || a.attname || ':' || c.confdeltype::text, ',' order by c.conrelid::regclass::text, a.attname)
    into obs
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.contype = 'f'
    and ((c.conrelid = 'public.ecritures_brouillon'::regclass and a.attname in ('immobilisation_id', 'dossier_id'))
      or (c.conrelid = 'public.immobilisations'::regclass and a.attname = 'dossier_id'));
  insert into essai_dotation values ('24. catalogue : suppressions', obs,
    obs = 'ecritures_brouillon.dossier_id:c,ecritures_brouillon.immobilisation_id:a,immobilisations.dossier_id:c');

  -- 25 à 28. Une contrainte nommée refuse.
  for obs in select unnest(array[
      '25. contrainte : une dotation ne porte pas de pièce', '26. contrainte : une dotation tombe au 31 décembre',
      '27. contrainte : le compte d''une nature est de classe 20 ou 21', '28. contrainte : une valeur est au centime']) loop
    accepte := false; code_recu := null; message := null;
    begin
      insert into immobilisations (dossier_id, nature_id, libelle, valeur, date_acquisition, duree_annees)
      values (dossier_test, nature_info, 'BIEN ESSAI', 1200, '2025-07-01', 3) returning id into bien;
      case substring(obs from '^(\d+)')
        when '25' then
          insert into ecritures_brouillon (dossier_id, immobilisation_id, piece_id, date, compte, libelle, montant, sens)
          values (dossier_test, bien, (select id from pieces where dossier_id = dossier_test order by id limit 1),
                  '2025-12-31', '681100', 'essai', 200, 'debit');
        when '26' then
          insert into ecritures_brouillon (dossier_id, immobilisation_id, date, compte, libelle, montant, sens)
          values (dossier_test, bien, '2025-06-30', '681100', 'essai', 200, 'debit');
        when '27' then
          update natures_immobilisation set compte_immobilisation = '618000' where id = nature_info;
        else
          update immobilisations set valeur = 1200.005 where id = bien;
      end case;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    insert into essai_dotation values (obs, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and code_recu = '23514' and message like '%' || case substring(obs from '^(\d+)')
        when '25' then 'ecritures_brouillon_dotation_sans_piece_ni_mouvement'
        when '26' then 'ecritures_brouillon_dotation_au_31_decembre'
        when '27' then 'natures_immobilisation_compte_immobilisation_format'
        else 'immobilisations_valeur_au_centime' end || '%');
  end loop;

  -- ══ 29. Quelques dotations de référence ══════════════════════════════════════════════════════════
  -- Le reste de la table vit dans src/lib/amortissements.test.ts, qui la confronte au calcul de
  -- l'application.
  select string_agg(x, ',') into obs from (values
    (dotation_amortissement(1233, 3, '2023-11-30', 2023)::text),
    (dotation_amortissement(1233, 3, '2023-11-30', 2026)::text),
    (dotation_amortissement(1.01, 1, '2025-07-01', 2025)::text),
    (dotation_amortissement(750, 2, '2025-12-31', 2025)::text),
    (dotation_amortissement(1000, 1, '2025-02-28', 2025)::text),
    (dotation_amortissement(12000, 5, '2026-07-01', 2031)::text),
    (dotation_amortissement(12000, 5, '2026-07-01', 2032)::text),
    (compte_amortissement('205000')),
    (compte_amortissement('218300'))
  ) as t(x);
  insert into essai_dotation values ('29. dotations de référence', obs,
    obs = '35.39,375.61,0.51,1.04,841.67,1200.00,0.00,280500,281830');

  -- ══ 30. Rien n'est resté ══════════════════════════════════════════════════════════════════════════
  select count(*) into nb_apres from ecritures_brouillon;
  insert into essai_dotation values ('30. rien n''est resté en base',
    'écritures ' || nb_avant || ' -> ' || nb_apres
      || ', biens ' || biens_avant || ' -> ' || (select count(*) from immobilisations)
      || ', natures ' || natures_avant || ' -> ' || (select count(*) from natures_immobilisation)
      || ', comptes des natures intacts ' || (select count(*) = 0 from natures_immobilisation where compte_immobilisation = '618000')::text
      || ', dossiers ' || dossiers_avant || ' -> ' || (select count(*) from dossiers)
      || ', ouvertures ' || ouvertures_avant || ' -> ' || (select count(*) from a_nouveaux),
    nb_avant = nb_apres
      and biens_avant = (select count(*) from immobilisations)
      and natures_avant = (select count(*) from natures_immobilisation)
      and not exists (select 1 from natures_immobilisation where compte_immobilisation = '618000')
      and dossiers_avant = (select count(*) from dossiers)
      and ouvertures_avant = (select count(*) from a_nouveaux)
      and not exists (select 1 from immobilisations where libelle = 'BIEN ESSAI'));
end $$;

select controle, ok, observe from essai_dotation order by
  (regexp_match(controle, '^(\d+)'))[1]::int, controle;
