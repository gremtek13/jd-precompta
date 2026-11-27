-- ESSAI DU FILET DE LA BANQUE PARTAGÉE À LA VALIDATION (ligne 26.6, MCBR2-Q2 ; migration `banque_partagee_a_la_validation`,
-- préparée le 27/11/2026, supabase/preparees/20261127231000_banque_partagee_a_la_validation.sql). SUR UNE RÉPLIQUE SEULEMENT :
-- il crée des dossiers, des comptes bancaires, des relevés et des exercices validés fictifs, simule la fin de la transaction en
-- rendant les contraintes immédiates, et falsifie la fonction et le déclencheur du filet. Joué ENTIER, en une transaction qui
-- s'annule (`begin` … `rollback`), par psql, sans `-1` :
--   psql -v ON_ERROR_STOP=1 -f supabase/essais/banquePartageeALaValidation.sql
-- Sans la migration, une ligne dit que l'essai attend, et rien d'autre.
-- Le jeu, dans un dossier JETABLE du cabinet du dossier `test`, posé dans la sous-transaction de chaque contrôle : le principal
-- au 512000 et un second compte « ESSAI MCBR2Q2 SECOND », ouvert en 2024, qui ne tient son 512200 qu'au 01/01/2027 — il s'écrit
-- donc au 512000 au 31/12/2025 ; 2024 validé, ses soldes reportés au 01/01/2025 portant au 512000 les 1 250 € des deux comptes ;
-- aucun mouvement en 2025 ; les relevés de décembre 2025 : le principal à 1 000 €, le second à 250 €. `valider_exercice` (2025)
-- s'appelle sous le chef du cabinet, puis la fin de la transaction se simule (`set constraints all immediate`) : le filet,
-- différé, juge alors.
-- Ce qu'il juge :
--   BP-A. le catalogue : un déclencheur de contrainte AFTER INSERT par ligne, différé, sa condition sur le rôle courant, qui tire
--         APRÈS celui de l'ouverture suivante (261) ; la fonction en definer, son chemin posé, exécutable par aucun rôle de l'API ;
--   BP-B. de bout en bout, par `valider_exercice`, le second compte au 512000 au 31/12/2025 : les relevés font le 512000
--         reporté — 2025 se valide ; le second compte sans relevé, deux relevés qui se contredisent, la somme qui ne fait pas le
--         512000, le principal sans relevé, le second compte à zéro et le principal en écart, le second compte qui ne prendra son
--         512 propre qu'en 2099 — l'appel rend, la fin de la transaction refuse, aux mots de l'éclatement ;
--   BP-C. hors de ce cas, 2025 se valide comme hier, le 512000 en écart : le second compte clos en 2025 ; un dossier à un seul
--         compte ; un second compte qui tient déjà son 512 en 2025 ; un second compte qui ne s'ouvre qu'en 2026 ;
--   BP-D. qui est jugé : la ligne qu'insère le propriétaire (comme `valider_exercice`, en definer) ; jamais celle que la
--         restauration réinsère sous le rôle de l'API (le super-administrateur) ;
--   BP-E. l'ordre des deux filets : le second compte qui tient son 512 dès le 01/01/2026 (le cas de MCBR-Q2), ni lui ni le
--         principal n'ayant de relevé — la base dit d'abord le refus de l'éclatement (le second compte nommé), et non celui de
--         ce filet (qui nommerait le principal).
-- Puis des MUTATIONS de la fonction et du déclencheur, chacune dans une sous-transaction annulée, qui doivent faire virer un
-- contrôle au rouge.
-- Se lit : toute ligne « en faute » est une faute de la migration ; toute mutation qui « NE MORD PAS » est un contrôle qui ne
-- prouve plus rien.

begin;

create temp table bp_verdict (rang serial, controle text, observe text, ok boolean);
create temp table bp_mutation (rang serial, mutation text, observe text, mord boolean);

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
  insert into bp_verdict (controle, observe, ok) values (p_controle, p_observe, coalesce(p_ok, false))
$$;

do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  d constant text := 'cb5c0000-0000-4000-8000-0000000000d1';
  p constant text := 'cb5c0000-0000-4000-8000-0000000000a1';
  s constant text := 'cb5c0000-0000-4000-8000-0000000000a2';
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
  issue text;
  -- Un relevé de décembre 2025 d'un compte : `releve_de(compte, fichier, solde)`.
  rp1000 text;
  rs250 text;
  releves_2024 text;
  valide_ok constant text := 'OK 1:101000/credit/1250.00,512000/debit/1250.00';
  inconnu_s constant text := 'la fin de la transaction : 23514 Le solde au 31/12/2025 du compte bancaire « ESSAI MCBR2Q2 SECOND » ne se lit sur aucun de ses relevés contrôlés : importer le relevé qui finit ce jour-là, ou celui qui le couvre, avant d''éclater l''ouverture de la banque.';
  inconnu_p constant text := 'la fin de la transaction : 23514 Le solde au 31/12/2025 du compte bancaire « Compte principal » ne se lit sur aucun de ses relevés contrôlés : importer le relevé qui finit ce jour-là, ou celui qui le couvre, avant d''éclater l''ouverture de la banque.';
  plusieurs_s constant text := 'la fin de la transaction : 23514 Les relevés du compte bancaire « ESSAI MCBR2Q2 SECOND » disent des soldes différents au 31/12/2025 : l''un d''eux ne dit pas le bon, et l''ouverture de la banque ne s''éclate pas.';
  somme constant text := 'la fin de la transaction : 23514 Les soldes des relevés au 31/12/2025 (1300,00 €) ne font pas l''ouverture du compte 512000 (1250,00 €) : l''ouverture de la banque ne s''éclate pas entre ses comptes.';
  somme_zero constant text := 'la fin de la transaction : 23514 Les soldes des relevés au 31/12/2025 (1000,00 €) ne font pas l''ouverture du compte 512000 (1250,00 €) : l''ouverture de la banque ne s''éclate pas entre ses comptes.';
begin
  if to_regprocedure('public.garder_banque_partagee_a_la_validation()') is null then
    perform pg_temp.verdict('0. EN ATTENTE de la migration banque_partagee_a_la_validation (MCBR2-Q2)',
      'absente : l''essai se joue dès qu''elle est en base', true);
    return;
  end if;

  -- ══ BP-A. Le catalogue ══
  perform pg_temp.verdict('BP-A1. un déclencheur de contrainte AFTER INSERT par ligne, différé, actif, sous condition',
    (select pg_get_triggerdef(t.oid) from pg_trigger t
      where t.tgrelid = 'public.exercices_valides'::regclass and t.tgname = 'exercices_valides_releves_de_la_banque_partagee'),
    exists (select 1 from pg_trigger t where t.tgrelid = 'public.exercices_valides'::regclass
             and t.tgname = 'exercices_valides_releves_de_la_banque_partagee' and t.tgtype = 5 and t.tgenabled = 'O'
             and t.tgconstraint <> 0 and t.tgdeferrable and t.tginitdeferred
             and pg_get_triggerdef(t.oid) like '% WHEN ((CURRENT_USER <> ''authenticated''::name)) %'
             and t.tgfoid = 'public.garder_banque_partagee_a_la_validation()'::regprocedure));
  perform pg_temp.verdict('BP-A2. la fonction en definer, son chemin posé, exécutable par aucun rôle de l''API ; valider_exercice en definer',
    (select case when prosecdef then 'definer' else 'invoker' end || ' ' || coalesce(array_to_string(proconfig, ','), '')
       from pg_proc where oid = 'public.garder_banque_partagee_a_la_validation()'::regprocedure),
    exists (select 1 from pg_proc where oid = 'public.garder_banque_partagee_a_la_validation()'::regprocedure
             and prosecdef and proconfig @> array['search_path=public'])
      and not has_function_privilege('anon', 'public.garder_banque_partagee_a_la_validation()', 'execute')
      and not has_function_privilege('authenticated', 'public.garder_banque_partagee_a_la_validation()', 'execute')
      and not has_function_privilege('service_role', 'public.garder_banque_partagee_a_la_validation()', 'execute')
      and exists (select 1 from pg_proc where oid = 'public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb)'::regprocedure
                   and prosecdef));
  perform pg_temp.verdict('BP-A3. les déclencheurs différés de exercices_valides, dans l''ordre où ils tirent : l''ouverture suivante (261), puis la banque partagée',
    (select string_agg(t.tgname, ',' order by t.tgname collate "C") from pg_trigger t
      where t.tgrelid = 'public.exercices_valides'::regclass and not t.tgisinternal and t.tgdeferrable),
    (select string_agg(t.tgname, ',' order by t.tgname collate "C") from pg_trigger t
      where t.tgrelid = 'public.exercices_valides'::regclass and not t.tgisinternal and t.tgdeferrable)
      = 'exercices_valides_ouverture_suivante,exercices_valides_releves_de_la_banque_partagee');

  -- ══ Le jeu ══
  dossier := format($q$insert into dossiers (id, nom, cabinet_id) values (%L, 'ESSAI MCBR2Q2', %L);$q$, d, cabinet);
  principal := format($q$insert into comptes_bancaires (id, dossier_id, libelle, principal) values (%L, %L, 'Compte principal', true);$q$, p, d);
  second := format($q$insert into comptes_bancaires (id, dossier_id, libelle, compte, compte_propre_depuis, ouvert_le, clos_le)
      values (%L, %L, 'ESSAI MCBR2Q2 SECOND', '512200', '{DEPUIS}', '{OUVERT}', {CLOS});$q$, s, d);
  vingt_quatre := format($q$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes,
      nb_ecritures, total_debit, total_credit, empreinte, declaration)
      values (%1$L, 2024, now(), %2$L, 'tresorerie', 0, 0, 0, 0, repeat('b', 64), '{}'::jsonb);
    select set_config('jd.validation_exercice', %1$L, true);
    insert into soldes_reportes (id, dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte) values
      ('cb5c0000-0000-4000-8000-0000000000e1', %1$L, '2025-01-01', '512000', 'Banque', 'debit', 1250, 'Exercice 2024 validé', repeat('b', 64)),
      ('cb5c0000-0000-4000-8000-0000000000e2', %1$L, '2025-01-01', '101000', 'Capital individuel', 'credit', 1250, 'Exercice 2024 validé', repeat('b', 64));
    select set_config('jd.validation_exercice', '', true);$q$, d, chef);
  -- Un relevé de décembre 2025 d'un compte, qui finit le 31/12 à `solde` (sans mouvement : il le dit de son solde final).
  releve := $q$insert into controles_releves_bancaires (dossier_id, compte_bancaire_id, source_fichier, solde_initial, solde_final,
      somme_mouvements, ecart, coherent, periode_debut, periode_fin)
      values ('{D}', '{COMPTE}', '{FICHIER}', {SOLDE}, {SOLDE}, 0, 0, true, '2025-12-01', '2025-12-31');$q$;
  releve := replace(releve, '{D}', d);
  rp1000 := replace(replace(replace(releve, '{COMPTE}', p), '{FICHIER}', 'essai_mcbr2q2_p.csv'), '{SOLDE}', '1000');
  rs250 := replace(replace(replace(releve, '{COMPTE}', s), '{FICHIER}', 'essai_mcbr2q2_s.csv'), '{SOLDE}', '250');
  -- Les relevés de décembre 2024, qui font les 1 250 € que 2024 reporte au 512000 : la ligne de 2024, que le jeu insère sous le
  -- propriétaire, se juge elle aussi à la fin de la transaction, dès que le second compte partage le 512000 au 31/12/2024.
  releves_2024 := replace(replace(replace(replace(releve, '{COMPTE}', p), '{FICHIER}', 'essai_mcbr2q2_p_2024.csv'), '{SOLDE}', '1000'), '2025-12-', '2024-12-')
    || replace(replace(replace(replace(releve, '{COMPTE}', s), '{FICHIER}', 'essai_mcbr2q2_s_2024.csv'), '{SOLDE}', '250'), '2025-12-', '2024-12-');
  -- L'ouverture de 2026 telle que la validation de 2025 l'écrit, posée à la main (BP-D).
  report_2026 := format($q$select set_config('jd.validation_exercice', %1$L, true);
    insert into soldes_reportes (dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte) values
      (%1$L, '2026-01-01', '512000', 'Banque', 'debit', 1250, 'Exercice 2025 validé', repeat('c', 64)),
      (%1$L, '2026-01-01', '101000', 'Capital individuel', 'credit', 1250, 'Exercice 2025 validé', repeat('c', 64));
    select set_config('jd.validation_exercice', '', true);$q$, d);
  valide := format($q$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes,
      nb_ecritures, total_debit, total_credit, empreinte, declaration)
      values (%L, {ANNEE}, now(), %L, 'tresorerie', 0, 0, 0, 0, repeat('c', 64), '{}'::jsonb);$q$, d, chef);
  libelles_an := '[{"id":"cb5c0000-0000-4000-8000-0000000000e1","compte_lib":"Banque","ecriture_lib":"À-nouveaux"},'
    || '{"id":"cb5c0000-0000-4000-8000-0000000000e2","compte_lib":"Capital individuel","ecriture_lib":"À-nouveaux"}]';
  valider_2025 := format($q$select valider_exercice(%L, 2025, '[]'::jsonb, %L::jsonb, '{}'::jsonb)$q$, d, libelles_an);
  verif_2025 := format($q$select (select count(*) from exercices_valides where dossier_id = %1$L and annee = 2025) || ':'
      || (select string_agg(compte || '/' || sens || '/' || round(montant, 2), ',' order by compte) from soldes_reportes
           where dossier_id = %1$L and date = '2026-01-01')$q$, d);
  -- Le second compte au 512000 au 31/12/2025 : son 512 propre au 01/01/2027.
  base := dossier || principal || replace(replace(replace(second, '{DEPUIS}', '2027-01-01'), '{OUVERT}', '2024-06-01'), '{CLOS}', 'null') || vingt_quatre || releves_2024;

  -- ══ BP-B. De bout en bout, par valider_exercice ══
  issue := pg_temp.joue(base || rp1000 || rs250, valider_2025, 'chef', verif_2025);
  perform pg_temp.verdict('BP-B1. les relevés (1 000 € + 250 €) font le 512000 reporté : 2025 se valide, son ouverture écrite', issue, issue = valide_ok);
  issue := pg_temp.joue(base || rp1000, valider_2025, 'chef', verif_2025);
  perform pg_temp.verdict('BP-B2. le second compte sans relevé au 31/12/2025 : l''appel rend, la fin de la transaction refuse, le compte nommé',
    issue, issue = inconnu_s);
  issue := pg_temp.joue(base || rp1000 || rs250
      || replace(replace(replace(releve, '{COMPTE}', s), '{FICHIER}', 'essai_mcbr2q2_s_bis.csv'), '{SOLDE}', '260'),
    valider_2025, 'chef', verif_2025);
  perform pg_temp.verdict('BP-B3. deux relevés du second compte qui se contredisent au 31/12/2025 : refusée, à leurs mots', issue, issue = plusieurs_s);
  issue := pg_temp.joue(base || rp1000 || replace(replace(replace(releve, '{COMPTE}', s), '{FICHIER}', 'essai_mcbr2q2_s.csv'), '{SOLDE}', '300'),
    valider_2025, 'chef', verif_2025);
  perform pg_temp.verdict('BP-B4. les relevés (1 300 €) ne font pas le 512000 reporté (1 250 €) : refusée, les deux montants dits', issue, issue = somme);
  issue := pg_temp.joue(base || rs250, valider_2025, 'chef', verif_2025);
  perform pg_temp.verdict('BP-B5. le principal sans relevé au 31/12/2025, le second à 250 € : refusée, le principal nommé', issue, issue = inconnu_p);
  issue := pg_temp.joue(base || rp1000 || replace(replace(replace(releve, '{COMPTE}', s), '{FICHIER}', 'essai_mcbr2q2_s.csv'), '{SOLDE}', '0'),
    valider_2025, 'chef', verif_2025);
  perform pg_temp.verdict('BP-B6. le second compte à zéro au 31/12/2025, le principal à 1 000 € pour 1 250 € : refusée — un solde nul ne dispense de rien',
    issue, issue = somme_zero);
  issue := pg_temp.joue(dossier || principal || replace(replace(replace(second, '{DEPUIS}', '2099-01-01'), '{OUVERT}', '2024-06-01'), '{CLOS}', 'null')
      || vingt_quatre || releves_2024 || rp1000,
    valider_2025, 'chef', verif_2025);
  perform pg_temp.verdict('BP-B7. le second compte qui ne prendra son 512 propre qu''en 2099, sans relevé : refusée de même',
    issue, issue = inconnu_s);

  -- ══ BP-C. Hors de ce cas, comme hier ══
  issue := pg_temp.joue(dossier || principal || replace(replace(replace(second, '{DEPUIS}', '2027-01-01'), '{OUVERT}', '2024-06-01'), '{CLOS}', '''2025-11-30''')
      || vingt_quatre || releves_2024 || rp1000,
    valider_2025, 'chef', verif_2025);
  perform pg_temp.verdict('BP-C1. le second compte clos le 30/11/2025, sans relevé, le principal à 1 000 € pour 1 250 € : il ne s''écrit plus au 512000 le 31/12, 2025 se valide',
    issue, issue = valide_ok);
  issue := pg_temp.joue(dossier || principal || vingt_quatre
      || replace(replace(replace(releve, '{COMPTE}', p), '{FICHIER}', 'essai_mcbr2q2_p.csv'), '{SOLDE}', '900'),
    valider_2025, 'chef', verif_2025);
  perform pg_temp.verdict('BP-C2. un dossier à un seul compte, son relevé en écart (900 € pour 1 250 €) : 2025 se valide comme hier', issue, issue = valide_ok);
  issue := pg_temp.joue(dossier || principal || replace(replace(replace(second, '{DEPUIS}', '2025-01-01'), '{OUVERT}', '2025-02-01'), '{CLOS}', 'null')
      || vingt_quatre || rp1000,
    valider_2025, 'chef', verif_2025);
  perform pg_temp.verdict('BP-C3. un second compte ouvert en 2025 qui tient déjà son 512200, sans relevé, le principal en écart : rien ne partage le 512000, 2025 se valide',
    issue, issue = valide_ok);
  issue := pg_temp.joue(dossier || principal || replace(replace(replace(second, '{DEPUIS}', '2027-01-01'), '{OUVERT}', '2026-02-01'), '{CLOS}', 'null')
      || vingt_quatre || rp1000,
    valider_2025, 'chef', verif_2025);
  perform pg_temp.verdict('BP-C4. un second compte qui ne s''ouvre qu''en 2026, le principal en écart : il n''est pas tenu en 2025, 2025 se valide',
    issue, issue = valide_ok);

  -- ══ BP-D. Qui est jugé ══
  issue := pg_temp.joue(base || rp1000, report_2026 || replace(valide, '{ANNEE}', '2025'), 'proprietaire', null);
  perform pg_temp.verdict('BP-D1. la ligne de 2025 insérée par le propriétaire, comme valider_exercice : jugée, refusée à la fin',
    issue, issue = inconnu_s);
  issue := pg_temp.joue(base || rp1000 || report_2026, replace(valide, '{ANNEE}', '2025'), 'chef',
    format('select count(*)::text from exercices_valides where dossier_id = %L and annee = 2025', d));
  perform pg_temp.verdict('BP-D2. la restauration (le super-administrateur, sous le rôle de l''API) ne se rejuge pas : 2025 réinséré',
    issue, issue = 'OK 1');

  -- ══ BP-E. L'ordre des deux filets ══
  issue := pg_temp.joue(dossier || principal || replace(replace(replace(second, '{DEPUIS}', '2026-01-01'), '{OUVERT}', '2024-06-01'), '{CLOS}', 'null')
      || vingt_quatre || releves_2024, valider_2025, 'chef', verif_2025);
  perform pg_temp.verdict('BP-E1. le second compte au 512 propre dès le 01/01/2026, ni lui ni le principal n''ayant de relevé : la base dit d''abord le refus de l''éclatement, le second compte nommé',
    issue, issue = inconnu_s);

  -- ══ Les mutations ══
  -- M1 : le filet ne juge rien.
  begin
    execute 'create or replace function public.garder_banque_partagee_a_la_validation() returns trigger language plpgsql security definer set search_path = public as $f$ begin return null; end $f$';
    issue := pg_temp.joue(base || rp1000, valider_2025, 'chef', null);
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into bp_mutation (mutation, observe, mord) values ('M1 — le filet ne juge rien : le second compte sans relevé passe (BP-B2)', issue, issue like 'OK%');
  -- M2 : un compte clos compte comme un compte qui s'écrit au 512 du rôle.
  begin
    execute replace(pg_get_functiondef('public.garder_banque_partagee_a_la_validation()'::regprocedure), ' and s.etat <> ''clos''', '');
    issue := pg_temp.joue(dossier || principal || replace(replace(replace(second, '{DEPUIS}', '2027-01-01'), '{OUVERT}', '2024-06-01'), '{CLOS}', '''2025-11-30''')
        || vingt_quatre || releves_2024 || rp1000, valider_2025, 'chef', null);
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into bp_mutation (mutation, observe, mord) values ('M2 — un compte clos partage le 512 : le second clos en 2025 retient 2025 (BP-C1)', issue, issue not like 'OK%');
  -- M3 : le déclencheur sans sa condition : la restauration se rejuge.
  begin
    execute 'drop trigger exercices_valides_releves_de_la_banque_partagee on public.exercices_valides';
    execute 'create constraint trigger exercices_valides_releves_de_la_banque_partagee after insert on public.exercices_valides deferrable initially deferred for each row execute function public.garder_banque_partagee_a_la_validation()';
    issue := pg_temp.joue(base || rp1000 || report_2026, replace(valide, '{ANNEE}', '2025'), 'chef', null);
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into bp_mutation (mutation, observe, mord) values ('M3 — sans la condition sur le rôle : la restauration se rejuge et se refuse (BP-D2)', issue, issue not like 'OK%');
  -- M4 : le déclencheur immédiat (non différé) : il juge avant que l'ouverture de 2026 soit écrite.
  begin
    execute 'drop trigger exercices_valides_releves_de_la_banque_partagee on public.exercices_valides';
    execute 'create constraint trigger exercices_valides_releves_de_la_banque_partagee after insert on public.exercices_valides for each row when (current_user <> ''authenticated'') execute function public.garder_banque_partagee_a_la_validation()';
    issue := pg_temp.joue(base || rp1000 || rs250, valider_2025, 'chef', null);
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into bp_mutation (mutation, observe, mord) values ('M4 — immédiat, non différé : 2025 se refuse sur un 512 encore nul (BP-B1)', issue, issue not like 'OK%');
  -- M5 : la fonction aux droits de l'appelant : à la fin de la transaction, le rôle de l'API n'exécute pas la lecture des soldes.
  begin
    execute 'alter function public.garder_banque_partagee_a_la_validation() security invoker';
    issue := pg_temp.joue(base || rp1000 || rs250, valider_2025, 'chef', null);
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into bp_mutation (mutation, observe, mord) values ('M5 — aux droits de l''appelant : la fin de la transaction tombe sous le rôle de l''API (BP-B1)', issue, issue not like 'OK%');
  -- M6 : la sortie de l'éclatement remise : un second compte au solde nul ne partage plus le 512.
  begin
    execute replace(pg_get_functiondef('public.garder_banque_partagee_a_la_validation()'::regprocedure),
      ' and s.etat <> ''clos'')', ' and s.etat <> ''clos'' and coalesce(s.centimes, 1) <> 0)');
    issue := pg_temp.joue(base || rp1000 || replace(replace(replace(releve, '{COMPTE}', s), '{FICHIER}', 'essai_mcbr2q2_s.csv'), '{SOLDE}', '0'),
      valider_2025, 'chef', null);
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into bp_mutation (mutation, observe, mord) values ('M6 — un second compte à zéro ne partage plus le 512 : le 512000 en écart passe (BP-B6)', issue, issue like 'OK%');
  -- M7 : le filet renommé pour tirer AVANT celui de l'ouverture suivante : la base dit le principal d'abord.
  begin
    execute 'alter trigger exercices_valides_releves_de_la_banque_partagee on public.exercices_valides rename to exercices_valides_a_releves_de_la_banque_partagee';
    issue := pg_temp.joue(dossier || principal || replace(replace(replace(second, '{DEPUIS}', '2026-01-01'), '{OUVERT}', '2024-06-01'), '{CLOS}', 'null')
        || vingt_quatre || releves_2024, valider_2025, 'chef', null);
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into bp_mutation (mutation, observe, mord) values ('M7 — le filet tire avant celui de l''ouverture suivante : le principal nommé d''abord (BP-E1)', issue, issue is distinct from inconnu_s);
  -- M8 : le groupe et le partage sans la date du 512 propre : un compte qui tient déjà le sien partage le 512 du rôle.
  begin
    execute replace(replace(pg_get_functiondef('public.garder_banque_partagee_a_la_validation()'::regprocedure),
      'where not s.principal and s.compte_propre_depuis > v_fin and s.etat', 'where not s.principal and s.etat'),
      'where s.principal or s.compte_propre_depuis > v_fin', 'where true');
    issue := pg_temp.joue(dossier || principal || replace(replace(replace(second, '{DEPUIS}', '2025-01-01'), '{OUVERT}', '2025-02-01'), '{CLOS}', 'null')
        || vingt_quatre || rp1000, valider_2025, 'chef', null);
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into bp_mutation (mutation, observe, mord) values ('M8 — sans la date du 512 propre : un compte qui tient déjà le sien retient 2025 (BP-C3)', issue, issue not like 'OK%');
end
$essai$;

select 'INVARIANTS' as tableau, controle as ligne, case when ok then 'juste' else '*** EN FAUTE ***' end as resultat, observe as detail
  from bp_verdict
union all
select 'MUTATIONS', mutation, case when mord then 'le contrôle mord' else '*** NE MORD PAS ***' end, observe
  from bp_mutation
union all
select 'BILAN', 'invariants et mutations',
  (select count(*) filter (where not ok) from bp_verdict) || ' en faute / ' || (select count(*) from bp_verdict) || ' ; '
  || (select count(*) filter (where mord) from bp_mutation) || ' mutations sur ' || (select count(*) from bp_mutation) || ' qui mordent', ''
order by 1 desc, 2;

rollback;
