-- ESSAI DU FILET DE L'OUVERTURE SUIVANTE À LA VALIDATION (ligne 26.6, MCBR-Q2 ; migration `ouverture_suivante_a_la_validation`,
-- en production depuis le 27/11/2026, 261, par l'outil : supabase/schema/20261127214813_ouverture_suivante_a_la_validation.sql).
-- SUR UNE RÉPLIQUE SEULEMENT :
-- il crée des dossiers, des comptes bancaires, des relevés et des exercices validés fictifs, simule la fin de la transaction en
-- rendant les contraintes immédiates, et falsifie la fonction et le déclencheur du filet. Joué ENTIER, en une transaction qui
-- s'annule (`begin` … `rollback`), par psql, sans `-1` :
--   psql -v ON_ERROR_STOP=1 -f supabase/essais/ouvertureSuivanteALaValidation.sql
-- Sans la migration, une ligne dit que l'essai attend, et rien d'autre.
-- Le jeu, dans un dossier JETABLE du cabinet du dossier `test`, posé dans la sous-transaction de chaque contrôle : le principal
-- au 512000 et un second compte « ESSAI MCBR2 SECOND », ouvert en 2024, qui tient son 512200 depuis le 01/01/2026 ; 2024
-- validé, ses soldes reportés au 01/01/2025 portant au 512000 les 1 250 € des deux comptes ; aucun mouvement en 2025 ; les
-- relevés de décembre 2025 : le principal à 1 000 €, le second à 250 €. `valider_exercice` (2025) s'appelle sous le chef du
-- cabinet, puis la fin de la transaction se simule (`set constraints all immediate`) : le filet, différé, juge alors.
-- Ce qu'il juge :
--   OS-A. le catalogue : un déclencheur de contrainte AFTER INSERT par ligne, différé, sa condition sur le rôle courant ; la
--         fonction en definer, son chemin posé, exécutable par aucun rôle de l'API ; `valider_exercice` en definer ;
--   OS-B. de bout en bout, par `valider_exercice` : les relevés font le 512000 reporté — 2025 se valide, son ouverture écrite,
--         l'éclatement de 2026 recomposable ; le second compte sans relevé, deux relevés qui se contredisent, la somme qui ne
--         fait pas le 512000, le principal sans relevé — l'appel rend, la fin de la transaction refuse, aux mots de
--         `ouverture_eclatee_attendue` ;
--   OS-C. hors de ce seul cas, 2025 se valide comme hier : le second compte clos en 2025, ou qui ne tient son 512 qu'en 2027 ;
--         un dossier à un seul compte, son relevé en écart ;
--   OS-D. qui est jugé : la ligne qu'insère le propriétaire (comme `valider_exercice`, en definer) ; jamais celle que la
--         restauration réinsère sous le rôle de l'API (le super-administrateur) ;
--   OS-E. l'exercice suivant : 2026, l'éclatement de son ouverture écrit, se valide (rien ne sort au 01/01/2027).
-- Puis des MUTATIONS de la fonction et du déclencheur, chacune dans une sous-transaction annulée, qui doivent faire virer un
-- contrôle au rouge.
-- Se lit : toute ligne « en faute » est une faute de la migration ; toute mutation qui « NE MORD PAS » est un contrôle qui ne
-- prouve plus rien.

begin;

create temp table os_verdict (rang serial, controle text, observe text, ok boolean);
create temp table os_mutation (rang serial, mutation text, observe text, mord boolean);

-- Joue un contrôle dans une sous-transaction annulée : le jeu sous le propriétaire, puis l'appel — sous le chef du cabinet
-- (`chef`, le rôle de l'API) ou sous le propriétaire (`proprietaire`) —, puis la fin de la transaction simulée, puis la
-- vérification sous le propriétaire. Rend « OK <vérification> », ou « <étape> : <sqlstate> <message> ».
create function pg_temp.joue(p_jeu text, p_appel text, p_role text, p_verif text) returns text language plpgsql as $$
declare
  v_etape text := 'le jeu';
  v_issue text;
  v_obs text;
begin
  begin
    execute 'set constraints all deferred';
    execute p_jeu;
    v_etape := 'l''appel';
    perform set_config('request.jwt.claims', json_build_object('sub', 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162', 'role', 'authenticated')::text, true);
    if p_role = 'chef' then
      set local role authenticated;
    end if;
    execute p_appel;
    v_etape := 'la fin de la transaction';
    execute 'set constraints all immediate';
    reset role;
    if p_verif is not null then
      execute p_verif into v_obs;
    end if;
    v_issue := 'OK' || coalesce(' ' || v_obs, '');
    raise exception 'ANNULATION_ESSAI';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI' then v_issue := v_etape || ' : ' || sqlstate || ' ' || sqlerrm; end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_issue;
end $$;

create function pg_temp.verdict(p_controle text, p_observe text, p_ok boolean) returns void language sql as $$
  insert into os_verdict (controle, observe, ok) values (p_controle, p_observe, coalesce(p_ok, false))
$$;

do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  d constant text := 'cb5b0000-0000-4000-8000-0000000000d1';
  p constant text := 'cb5b0000-0000-4000-8000-0000000000a1';
  s constant text := 'cb5b0000-0000-4000-8000-0000000000a2';
  dossier text;
  principal text;
  second text;
  vingt_quatre text;
  releve text;
  report_2026 text;
  valide text;
  libelles_an text;
  valider_2025 text;
  verif_2025 text;
  base text;
  bonne jsonb;
  attendu text;
  issue text;
  inconnu_s constant text := 'la fin de la transaction : 23514 Le solde au 31/12/2025 du compte bancaire « ESSAI MCBR2 SECOND » ne se lit sur aucun de ses relevés contrôlés : importer le relevé qui finit ce jour-là, ou celui qui le couvre, avant d''éclater l''ouverture de la banque.';
  inconnu_p constant text := 'la fin de la transaction : 23514 Le solde au 31/12/2025 du compte bancaire « Compte principal » ne se lit sur aucun de ses relevés contrôlés : importer le relevé qui finit ce jour-là, ou celui qui le couvre, avant d''éclater l''ouverture de la banque.';
  plusieurs_s constant text := 'la fin de la transaction : 23514 Les relevés du compte bancaire « ESSAI MCBR2 SECOND » disent des soldes différents au 31/12/2025 : l''un d''eux ne dit pas le bon, et l''ouverture de la banque ne s''éclate pas.';
  somme constant text := 'la fin de la transaction : 23514 Les soldes des relevés au 31/12/2025 (1300,00 €) ne font pas l''ouverture du compte 512000 (1250,00 €) : l''ouverture de la banque ne s''éclate pas entre ses comptes.';
begin
  if to_regprocedure('public.garder_ouverture_suivante_a_la_validation()') is null then
    perform pg_temp.verdict('0. EN ATTENTE de la migration ouverture_suivante_a_la_validation (MCBR-Q2)',
      'absente : l''essai se joue dès qu''elle est en base', true);
    return;
  end if;

  -- ══ OS-A. Le catalogue ══
  perform pg_temp.verdict('OS-A1. un déclencheur de contrainte AFTER INSERT par ligne, différé, actif, sous condition',
    (select pg_get_triggerdef(t.oid) from pg_trigger t
      where t.tgrelid = 'public.exercices_valides'::regclass and t.tgname = 'exercices_valides_ouverture_suivante'),
    exists (select 1 from pg_trigger t where t.tgrelid = 'public.exercices_valides'::regclass
             and t.tgname = 'exercices_valides_ouverture_suivante' and t.tgtype = 5 and t.tgenabled = 'O'
             and t.tgconstraint <> 0 and t.tgdeferrable and t.tginitdeferred
             and pg_get_triggerdef(t.oid) like '% WHEN ((CURRENT_USER <> ''authenticated''::name)) %'
             and t.tgfoid = 'public.garder_ouverture_suivante_a_la_validation()'::regprocedure));
  perform pg_temp.verdict('OS-A2. la fonction en definer, son chemin posé, exécutable par aucun rôle de l''API ; valider_exercice en definer',
    (select case when prosecdef then 'definer' else 'invoker' end || ' ' || coalesce(array_to_string(proconfig, ','), '')
       from pg_proc where oid = 'public.garder_ouverture_suivante_a_la_validation()'::regprocedure),
    exists (select 1 from pg_proc where oid = 'public.garder_ouverture_suivante_a_la_validation()'::regprocedure
             and prosecdef and proconfig @> array['search_path=public'])
      and not has_function_privilege('anon', 'public.garder_ouverture_suivante_a_la_validation()', 'execute')
      and not has_function_privilege('authenticated', 'public.garder_ouverture_suivante_a_la_validation()', 'execute')
      and exists (select 1 from pg_proc where oid = 'public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb)'::regprocedure
                   and prosecdef));

  -- ══ Le jeu ══
  dossier := format($q$insert into dossiers (id, nom, cabinet_id) values (%L, 'ESSAI MCBR2', %L);$q$, d, cabinet);
  principal := format($q$insert into comptes_bancaires (id, dossier_id, libelle, principal) values (%L, %L, 'Compte principal', true);$q$, p, d);
  second := format($q$insert into comptes_bancaires (id, dossier_id, libelle, compte, compte_propre_depuis, ouvert_le, clos_le)
      values (%L, %L, 'ESSAI MCBR2 SECOND', '512200', '{DEPUIS}', '2024-06-01', {CLOS});$q$, s, d);
  vingt_quatre := format($q$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes,
      nb_ecritures, total_debit, total_credit, empreinte, declaration)
      values (%1$L, 2024, now(), %2$L, 'tresorerie', 0, 0, 0, 0, repeat('b', 64), '{}'::jsonb);
    select set_config('jd.validation_exercice', %1$L, true);
    insert into soldes_reportes (id, dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte) values
      ('cb5b0000-0000-4000-8000-0000000000e1', %1$L, '2025-01-01', '512000', 'Banque', 'debit', 1250, 'Exercice 2024 validé', repeat('b', 64)),
      ('cb5b0000-0000-4000-8000-0000000000e2', %1$L, '2025-01-01', '101000', 'Capital individuel', 'credit', 1250, 'Exercice 2024 validé', repeat('b', 64));
    select set_config('jd.validation_exercice', '', true);$q$, d, chef);
  -- Un relevé de décembre 2025 d'un compte, qui finit le 31/12 à `solde` (sans mouvement : il le dit de son solde final).
  releve := $q$insert into controles_releves_bancaires (dossier_id, compte_bancaire_id, source_fichier, solde_initial, solde_final,
      somme_mouvements, ecart, coherent, periode_debut, periode_fin)
      values ('{D}', '{COMPTE}', '{FICHIER}', {SOLDE}, {SOLDE}, 0, 0, true, '2025-12-01', '2025-12-31');$q$;
  releve := replace(releve, '{D}', d);
  -- L'ouverture de 2026 telle que la validation de 2025 l'écrit, posée à la main (OS-D, OS-E).
  report_2026 := format($q$select set_config('jd.validation_exercice', %1$L, true);
    insert into soldes_reportes (dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte) values
      (%1$L, '2026-01-01', '512000', 'Banque', 'debit', 1250, 'Exercice 2025 validé', repeat('c', 64)),
      (%1$L, '2026-01-01', '101000', 'Capital individuel', 'credit', 1250, 'Exercice 2025 validé', repeat('c', 64));
    select set_config('jd.validation_exercice', '', true);$q$, d);
  valide := format($q$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes,
      nb_ecritures, total_debit, total_credit, empreinte, declaration)
      values (%L, {ANNEE}, now(), %L, 'tresorerie', 0, 0, 0, 0, repeat('c', 64), '{}'::jsonb);$q$, d, chef);
  libelles_an := '[{"id":"cb5b0000-0000-4000-8000-0000000000e1","compte_lib":"Banque","ecriture_lib":"À-nouveaux"},'
    || '{"id":"cb5b0000-0000-4000-8000-0000000000e2","compte_lib":"Capital individuel","ecriture_lib":"À-nouveaux"}]';
  valider_2025 := format($q$select valider_exercice(%L, 2025, '[]'::jsonb, %L::jsonb, '{}'::jsonb)$q$, d, libelles_an);
  verif_2025 := format($q$select (select count(*) from exercices_valides where dossier_id = %1$L and annee = 2025) || ':'
      || (select string_agg(compte || '/' || sens || '/' || round(montant, 2), ',' order by compte) from soldes_reportes
           where dossier_id = %1$L and date = '2026-01-01') || ':'
      || coalesce((select string_agg(compte || '/' || sens || '/' || centimes, ',' order by compte desc)
                     from public.ouverture_eclatee_attendue(%1$L, 2026)), 'rien')$q$, d);
  base := dossier || principal || replace(replace(second, '{DEPUIS}', '2026-01-01'), '{CLOS}', 'null') || vingt_quatre;
  bonne := jsonb_build_array(
    jsonb_build_object('compte_bancaire_id', s, 'compte', '512200', 'sens', 'debit', 'montant', 250, 'libelle', 'Ouverture du 512200 au relevé du 31/12/2025'),
    jsonb_build_object('compte_bancaire_id', s, 'compte', '512000', 'sens', 'credit', 'montant', 250, 'libelle', 'Ouverture du 512200 au relevé du 31/12/2025'));

  -- ══ OS-B. De bout en bout, par valider_exercice ══
  attendu := 'OK 1:101000/credit/1250.00,512000/debit/1250.00:512200/debit/25000,512000/credit/25000';
  issue := pg_temp.joue(base
      || replace(replace(replace(releve, '{COMPTE}', p), '{FICHIER}', 'essai_mcbr2_p.csv'), '{SOLDE}', '1000')
      || replace(replace(replace(releve, '{COMPTE}', s), '{FICHIER}', 'essai_mcbr2_s.csv'), '{SOLDE}', '250'),
    valider_2025, 'chef', verif_2025);
  perform pg_temp.verdict('OS-B1. les relevés font le 512000 reporté : 2025 se valide, son ouverture écrite, l''éclatement de 2026 recomposable',
    issue, issue = attendu);
  issue := pg_temp.joue(replace(base || replace(replace(releve, '{COMPTE}', p), '{FICHIER}', 'essai_mcbr2_p.csv'), '{SOLDE}', '1000'),
    valider_2025, 'chef', verif_2025);
  perform pg_temp.verdict('OS-B2. le second compte sans relevé au 31/12/2025 : l''appel rend, la fin de la transaction refuse, le compte nommé',
    issue, issue = inconnu_s);
  issue := pg_temp.joue(base || replace(replace(replace(releve, '{COMPTE}', p), '{FICHIER}', 'essai_mcbr2_p.csv'), '{SOLDE}', '1000')
      || replace(replace(replace(releve, '{COMPTE}', s), '{FICHIER}', 'essai_mcbr2_s.csv'), '{SOLDE}', '250')
      || replace(replace(replace(releve, '{COMPTE}', s), '{FICHIER}', 'essai_mcbr2_s_bis.csv'), '{SOLDE}', '260'),
    valider_2025, 'chef', verif_2025);
  perform pg_temp.verdict('OS-B3. deux relevés du second compte qui se contredisent au 31/12/2025 : refusée, à leurs mots',
    issue, issue = plusieurs_s);
  issue := pg_temp.joue(base || replace(replace(replace(releve, '{COMPTE}', p), '{FICHIER}', 'essai_mcbr2_p.csv'), '{SOLDE}', '1000')
      || replace(replace(replace(releve, '{COMPTE}', s), '{FICHIER}', 'essai_mcbr2_s.csv'), '{SOLDE}', '300'),
    valider_2025, 'chef', verif_2025);
  perform pg_temp.verdict('OS-B4. les relevés (1 300 €) ne font pas le 512000 reporté (1 250 €) : refusée, les deux montants dits',
    issue, issue = somme);
  issue := pg_temp.joue(base || replace(replace(replace(releve, '{COMPTE}', s), '{FICHIER}', 'essai_mcbr2_s.csv'), '{SOLDE}', '250'),
    valider_2025, 'chef', verif_2025);
  perform pg_temp.verdict('OS-B5. le principal sans relevé au 31/12/2025, le second à 250 € : refusée, le principal nommé',
    issue, issue = inconnu_p);

  -- ══ OS-C. Hors de ce seul cas ══
  issue := pg_temp.joue(dossier || principal || replace(replace(second, '{DEPUIS}', '2026-01-01'), '{CLOS}', '''2025-11-30''') || vingt_quatre
      || replace(replace(replace(releve, '{COMPTE}', p), '{FICHIER}', 'essai_mcbr2_p.csv'), '{SOLDE}', '1000'),
    valider_2025, 'chef', verif_2025);
  perform pg_temp.verdict('OS-C1. le second compte clos le 30/11/2025, sans relevé : rien ne sort du 512000, 2025 se valide',
    issue, issue = 'OK 1:101000/credit/1250.00,512000/debit/1250.00:rien');
  issue := pg_temp.joue(dossier || principal || replace(replace(second, '{DEPUIS}', '2027-01-01'), '{CLOS}', 'null') || vingt_quatre
      || replace(replace(replace(releve, '{COMPTE}', p), '{FICHIER}', 'essai_mcbr2_p.csv'), '{SOLDE}', '1000'),
    valider_2025, 'chef', verif_2025);
  perform pg_temp.verdict('OS-C2. le second compte ne tient son 512 qu''au 01/01/2027, sans relevé : 2026 n''a rien à éclater, 2025 se valide',
    issue, issue = 'OK 1:101000/credit/1250.00,512000/debit/1250.00:rien');
  issue := pg_temp.joue(dossier || principal || vingt_quatre
      || replace(replace(replace(releve, '{COMPTE}', p), '{FICHIER}', 'essai_mcbr2_p.csv'), '{SOLDE}', '900'),
    valider_2025, 'chef', verif_2025);
  perform pg_temp.verdict('OS-C3. un dossier à un seul compte, son relevé en écart (900 € pour 1 250 €) : 2025 se valide comme hier',
    issue, issue = 'OK 1:101000/credit/1250.00,512000/debit/1250.00:rien');

  -- ══ OS-D. Qui est jugé ══
  issue := pg_temp.joue(base || replace(replace(replace(releve, '{COMPTE}', p), '{FICHIER}', 'essai_mcbr2_p.csv'), '{SOLDE}', '1000'),
    report_2026 || replace(valide, '{ANNEE}', '2025'), 'proprietaire', null);
  perform pg_temp.verdict('OS-D1. la ligne de 2025 insérée par le propriétaire, comme valider_exercice : jugée, refusée à la fin',
    issue, issue = inconnu_s);
  issue := pg_temp.joue(base || replace(replace(replace(releve, '{COMPTE}', p), '{FICHIER}', 'essai_mcbr2_p.csv'), '{SOLDE}', '1000') || report_2026,
    replace(valide, '{ANNEE}', '2025'), 'chef',
    format('select count(*)::text from exercices_valides where dossier_id = %L and annee = 2025', d));
  perform pg_temp.verdict('OS-D2. la restauration (le super-administrateur, sous le rôle de l''API) ne se rejuge pas : 2025 réinséré',
    issue, issue = 'OK 1');

  -- ══ OS-E. L'exercice suivant ══
  issue := pg_temp.joue(base || replace(replace(replace(releve, '{COMPTE}', p), '{FICHIER}', 'essai_mcbr2_p.csv'), '{SOLDE}', '1000')
      || replace(replace(replace(releve, '{COMPTE}', s), '{FICHIER}', 'essai_mcbr2_s.csv'), '{SOLDE}', '250')
      || report_2026 || replace(valide, '{ANNEE}', '2025'),
    format($q$set local role authenticated; select ecrire_ouverture_eclatee(%L, 2026, %L); reset role;$q$, d, bonne)
      || replace(valide, '{ANNEE}', '2026'), 'proprietaire',
    format('select count(*)::text from exercices_valides where dossier_id = %L and annee in (2025, 2026)', d));
  perform pg_temp.verdict('OS-E1. 2026, l''éclatement de son ouverture écrit, se valide : rien ne sort au 01/01/2027',
    issue, issue = 'OK 2');

  -- ══ Les mutations ══
  -- M1 : le filet ne recompose rien.
  begin
    execute 'create or replace function public.garder_ouverture_suivante_a_la_validation() returns trigger language plpgsql security definer set search_path = public as $f$ begin return null; end $f$';
    issue := pg_temp.joue(replace(base || replace(replace(releve, '{COMPTE}', p), '{FICHIER}', 'essai_mcbr2_p.csv'), '{SOLDE}', '1000'),
      valider_2025, 'chef', null);
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into os_mutation (mutation, observe, mord) values ('M1 — le filet ne recompose rien : le second compte sans relevé passe (OS-B2)', issue, issue like 'OK%');
  -- M2 : le filet recompose l'ouverture de l'exercice validé lui-même, et non celle du suivant.
  begin
    execute replace(pg_get_functiondef('public.garder_ouverture_suivante_a_la_validation()'::regprocedure), 'new.annee + 1', 'new.annee');
    issue := pg_temp.joue(replace(base || replace(replace(releve, '{COMPTE}', p), '{FICHIER}', 'essai_mcbr2_p.csv'), '{SOLDE}', '1000'),
      valider_2025, 'chef', null);
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into os_mutation (mutation, observe, mord) values ('M2 — l''ouverture de l''exercice lui-même : le second compte sans relevé passe (OS-B2)', issue, issue like 'OK%');
  -- M3 : le déclencheur sans sa condition : la restauration se rejuge.
  begin
    execute 'drop trigger exercices_valides_ouverture_suivante on public.exercices_valides';
    execute 'create constraint trigger exercices_valides_ouverture_suivante after insert on public.exercices_valides deferrable initially deferred for each row execute function public.garder_ouverture_suivante_a_la_validation()';
    issue := pg_temp.joue(base || replace(replace(replace(releve, '{COMPTE}', p), '{FICHIER}', 'essai_mcbr2_p.csv'), '{SOLDE}', '1000') || report_2026,
      replace(valide, '{ANNEE}', '2025'), 'chef', null);
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into os_mutation (mutation, observe, mord) values ('M3 — sans la condition sur le rôle : la restauration se rejuge et se refuse (OS-D2)', issue, issue not like 'OK%');
  -- M4 : le déclencheur immédiat (non différé) : il juge avant que l'ouverture de 2026 soit écrite.
  begin
    execute 'drop trigger exercices_valides_ouverture_suivante on public.exercices_valides';
    execute 'create constraint trigger exercices_valides_ouverture_suivante after insert on public.exercices_valides for each row when (current_user <> ''authenticated'') execute function public.garder_ouverture_suivante_a_la_validation()';
    issue := pg_temp.joue(base
        || replace(replace(replace(releve, '{COMPTE}', p), '{FICHIER}', 'essai_mcbr2_p.csv'), '{SOLDE}', '1000')
        || replace(replace(replace(releve, '{COMPTE}', s), '{FICHIER}', 'essai_mcbr2_s.csv'), '{SOLDE}', '250'),
      valider_2025, 'chef', null);
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into os_mutation (mutation, observe, mord) values ('M4 — immédiat, non différé : 2025 se refuse sur un 512 encore nul (OS-B1)', issue, issue not like 'OK%');
  -- M5 : la fonction aux droits de l'appelant : à la fin de la transaction, le rôle de l'API n'exécute pas la recomposition.
  begin
    execute 'alter function public.garder_ouverture_suivante_a_la_validation() security invoker';
    issue := pg_temp.joue(base
        || replace(replace(replace(releve, '{COMPTE}', p), '{FICHIER}', 'essai_mcbr2_p.csv'), '{SOLDE}', '1000')
        || replace(replace(replace(releve, '{COMPTE}', s), '{FICHIER}', 'essai_mcbr2_s.csv'), '{SOLDE}', '250'),
      valider_2025, 'chef', null);
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into os_mutation (mutation, observe, mord) values ('M5 — aux droits de l''appelant : la fin de la transaction tombe sous le rôle de l''API (OS-B1)', issue, issue not like 'OK%');
end
$essai$;

select 'INVARIANTS' as tableau, controle as ligne, case when ok then 'juste' else '*** EN FAUTE ***' end as resultat, observe as detail
  from os_verdict
union all
select 'MUTATIONS', mutation, case when mord then 'le contrôle mord' else '*** NE MORD PAS ***' end, observe
  from os_mutation
union all
select 'BILAN', 'invariants et mutations',
  (select count(*) filter (where not ok) from os_verdict) || ' en faute / ' || (select count(*) from os_verdict) || ' ; '
  || (select count(*) filter (where mord) from os_mutation) || ' mutations sur ' || (select count(*) from os_mutation) || ' qui mordent', ''
order by 1 desc, 2;

rollback;
