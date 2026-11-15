-- ESSAI DU COMPTE PROPRE HORS D'UN EXERCICE VALIDÉ (ligne 26.6, MCB6Q2-Q1 ; migration `compte_propre_hors_des_exercices_valides`,
-- PRÉPARÉE le 15/11/2026). SUR UNE RÉPLIQUE SEULEMENT : il crée des dossiers, des comptes bancaires et des exercices validés
-- fictifs (posés par le propriétaire, sans la validation : seul compte ici le filet), et en falsifie la fonction. Joué ENTIER,
-- en une transaction qui s'annule (`begin` … `rollback`), par psql, sans `-1` :
--   psql -v ON_ERROR_STOP=1 -f supabase/essais/comptePropreHorsDesExercicesValides.sql
-- Sans la migration, une ligne dit que l'essai attend, et rien d'autre.
-- Ce qu'il juge, par impersonation (le chef, qui est aussi super-administrateur dans le semis ; un membre de l'équipe assigné ;
-- le même membre sur un dossier qui ne lui est pas assigné ; un client « Banque » du dossier ; l'anonyme) :
--   CP-A. le refus : une date posée sur un exercice validé, ou avant lui, en 23514 sous les mots de src/lib/comptesBancaires.ts
--         (`REFUS_DES_EXERCICES_VALIDES` : le premier exercice validé qui la retient, la première année restée ouverte), au chef
--         comme au membre ; une date d'après passe ;
--   CP-B. ce qui se garde : une date déjà posée, sur un exercice validé depuis, ne retient ni le libellé ni la clôture ; une date
--         changée se juge ; le principal ne se juge pas ;
--   CP-C. l'ordre : la garde d'hier parle d'abord (une date qui n'est pas un 1er janvier) ;
--   CP-D. l'accès : qui la policy refuse l'entend (42501), jamais l'exercice validé ;
--   CP-E. la restauration : le super-administrateur réinsère un compte puis l'exercice validé, dans l'ordre de la sauvegarde ;
--   CP-F. le verrou partagé de la validation, pris avant la lecture des exercices validés ;
--   CP-G. le catalogue : le déclencheur après la garde d'hier, sur l'insertion et la seule date, la fonction aux droits de
--         l'appelant et fermée à l'API.
-- Puis des MUTATIONS de la fonction, chacune dans une sous-transaction annulée, qui doivent faire virer un contrôle au rouge.
-- Se lit : toute ligne « en faute » est une faute de la migration ; toute mutation qui « NE MORD PAS » est un contrôle qui ne
-- prouve plus rien.

begin;

create temp table cp_verdict (rang serial, controle text, observe text, ok boolean);
create temp table cp_mutation (rang serial, mutation text, observe text, mord boolean);

-- Tente une écriture SOUS une identité, et l'annule : rend « OK <résultat> » ou « <sqlstate> <message> ».
create function pg_temp.tente(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare
  v_resultat text;
  v_issue text;
begin
  begin
    if p_uid is null then
      set local role anon;
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    else
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    end if;
    execute p_sql into v_resultat;
    v_issue := 'OK ' || coalesce(v_resultat, '');
    raise exception 'ANNULATION_ESSAI';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI' then v_issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_issue;
end $$;

-- Le même, qui GARDE ce qu'il a écrit quand l'écriture passe.
create function pg_temp.fait(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare
  v_resultat text;
  v_issue text;
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    execute p_sql into v_resultat;
    v_issue := 'OK ' || coalesce(v_resultat, '');
  exception when others then
    v_issue := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_issue;
end $$;

create function pg_temp.verdict(p_controle text, p_observe text, p_ok boolean) returns void language sql as $$
  insert into cp_verdict (controle, observe, ok) values (p_controle, p_observe, coalesce(p_ok, false))
$$;

-- Les mots de la base, tels que src/lib/comptesBancaires.ts les redit (`REFUS_DES_EXERCICES_VALIDES`), chaque % rempli.
create function pg_temp.mots(p_validee integer, p_ouverte integer) returns text language sql as $$
  select format('L’exercice %s du dossier est validé : un compte bancaire tient son propre compte du plan depuis le 1er janvier '
    || 'd’un exercice qui ne l’est pas, %s au plus tôt — son ouverture par compte suppose que cette année n’est pas figée.', p_validee, p_ouverte)
$$;

-- Un compte bancaire autre que le principal, posé par une insertion directe sous la policy, comme la fiche le pose.
create function pg_temp.second(p_dossier uuid, p_compte text, p_depuis text) returns text language sql as $$
  select format('insert into comptes_bancaires (dossier_id, libelle, compte, compte_propre_depuis) values (%L, %L, %L, %L) returning id::text',
                p_dossier, 'Compte pro ' || p_compte, p_compte, p_depuis)
$$;

-- Le verrou partagé de la validation, observé dans une sous-transaction annulée : un dossier créé sans le déclencheur du compte
-- du dirigeant (qui prend lui aussi ce verrou à la création), son principal, puis un compte qui tient son 512 — le verrou du
-- dossier tenu avant ce dernier, puis après.
create function pg_temp.verrou_pris(p_dossier uuid, p_cabinet uuid) returns text language plpgsql as $$
declare
  v_cle bigint;
  v_avant boolean;
  v_apres boolean;
  v_issue text;
begin
  begin
    alter table public.dossiers disable trigger dossiers_compte_du_dirigeant;
    insert into public.dossiers (id, nom, cabinet_id) values (p_dossier, 'MCB6Q2 essai L', p_cabinet);
    alter table public.dossiers enable trigger dossiers_compte_du_dirigeant;
    insert into public.comptes_bancaires (dossier_id, libelle, principal) values (p_dossier, 'Compte principal', true);
    v_cle := public.cle_validation(p_dossier);
    select exists (select 1 from pg_locks l where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.mode = 'ShareLock'
                     and l.classid = ((v_cle >> 32) & 4294967295)::oid and l.objid = (v_cle & 4294967295)::oid and l.objsubid = 1) into v_avant;
    insert into public.comptes_bancaires (dossier_id, libelle, compte, compte_propre_depuis) values (p_dossier, 'Compte pro du verrou', '512100', '2026-01-01');
    select exists (select 1 from pg_locks l where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.mode = 'ShareLock'
                     and l.classid = ((v_cle >> 32) & 4294967295)::oid and l.objid = (v_cle & 4294967295)::oid and l.objsubid = 1) into v_apres;
    v_issue := 'avant ' || v_avant::text || ', après ' || v_apres::text;
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then v_issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  return v_issue;
end $$;

do $essai$
declare
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  membre uuid := '3e3b0000-0000-4000-8000-000000000001';
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  cabinet uuid := 'cab10000-0000-4000-8000-000000000001';
  da uuid := 'cb6e0000-0000-4000-8000-0000000000a1';   -- 2025 validé ; assigné au membre ; ouvert au client « Banque »
  db uuid := 'cb6e0000-0000-4000-8000-0000000000a2';   -- 2025 validé ; NON assigné au membre
  dr uuid := 'cb6e0000-0000-4000-8000-0000000000a3';   -- la restauration : un dossier recréé, sans exercice validé
  -- Le verrou : un dossier créé dans la sous-transaction du contrôle, sans le déclencheur du compte du dirigeant, qui prend
  -- lui aussi le verrou partagé de la validation à la création d'un dossier : sans lui, rien d'autre ne l'a pris avant.
  dl uuid := 'cb6e0000-0000-4000-8000-0000000000a4';
  issue text;
  id_2026 uuid;
  id_2027 uuid;
  texte text;
begin
  if to_regprocedure('public.garder_compte_propre_hors_des_exercices_valides()') is null then
    perform pg_temp.verdict('0. EN ATTENTE de la migration compte_propre_hors_des_exercices_valides (MCB6Q2-Q1)',
      'absente : l''essai se joue dès qu''elle est en base', true);
    return;
  end if;

  -- ── Le jeu, écrit par le propriétaire ──
  insert into dossiers (id, nom, cabinet_id) values
    (da, 'MCB6Q2 essai A', cabinet), (db, 'MCB6Q2 essai B', cabinet), (dr, 'MCB6Q2 essai R', cabinet);
  insert into dossier_assignations (dossier_id, user_id) values (da, membre), (dr, membre);
  insert into memberships (user_id, dossier_id, role, email, droit_banque) values (client, da, 'client', 'essai-mcb6q2@example.test', true);
  insert into comptes_bancaires (dossier_id, libelle, principal) values
    (da, 'Compte principal', true), (db, 'Compte principal', true), (dr, 'Compte principal', true);
  insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte, declaration)
    values (da, 2025, now(), chef, 'tresorerie', 0, 0, 0, 0, repeat('0', 64), '{}'), (db, 2025, now(), chef, 'tresorerie', 0, 0, 0, 0, repeat('0', 64), '{}');

  -- ══ CP-A. Le refus ══
  issue := pg_temp.tente(chef, pg_temp.second(da, '512100', '2025-01-01'));
  perform pg_temp.verdict('CP-A1. le chef (aussi super-administrateur) pose une date sur l''exercice validé 2025 : refusée, aux mots du module', issue,
    issue = '23514 ' || pg_temp.mots(2025, 2026));
  issue := pg_temp.tente(membre, pg_temp.second(da, '512100', '2025-01-01'));
  perform pg_temp.verdict('CP-A2. le membre assigné aussi', issue, issue = '23514 ' || pg_temp.mots(2025, 2026));
  issue := pg_temp.tente(membre, pg_temp.second(da, '512100', '2024-01-01'));
  perform pg_temp.verdict('CP-A3. une date d''avant l''exercice validé (2024) : refusée, le premier exercice validé qui la retient nommé (2025)', issue,
    issue = '23514 ' || pg_temp.mots(2025, 2026));
  issue := pg_temp.fait(membre, pg_temp.second(da, '512200', '2026-01-01'));
  id_2026 := case when issue like 'OK %' then substr(issue, 4)::uuid end;
  perform pg_temp.verdict('CP-A4. la date du premier exercice resté ouvert (2026) passe (le contrôle positif)', issue, id_2026 is not null);

  -- ══ CP-B. Ce qui se garde ══
  issue := pg_temp.fait(membre, pg_temp.second(da, '512300', '2027-01-01'));
  id_2027 := case when issue like 'OK %' then substr(issue, 4)::uuid end;
  issue := pg_temp.tente(membre, format('update comptes_bancaires set compte_propre_depuis = ''2025-01-01'' where id = %L returning id::text', id_2027));
  perform pg_temp.verdict('CP-B1. une date changée vers l''exercice validé se juge, et se refuse', issue, id_2027 is not null and issue = '23514 ' || pg_temp.mots(2025, 2026));
  issue := pg_temp.tente(membre, format('update comptes_bancaires set compte_propre_depuis = ''2028-01-01'' where id = %L returning id::text', id_2027));
  perform pg_temp.verdict('CP-B2. une date changée vers un exercice ouvert passe (le contrôle positif)', issue, issue = 'OK ' || id_2027);
  -- 2026 se valide ensuite : le compte qui en part la garde.
  insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte, declaration)
    values (da, 2026, now(), chef, 'tresorerie', 0, 0, 0, 0, repeat('0', 64), '{}');
  issue := pg_temp.tente(membre, format('update comptes_bancaires set libelle = ''Compte pro renommé'' where id = %L returning id::text', id_2026));
  perform pg_temp.verdict('CP-B3. une date déjà posée sur un exercice validé depuis : le libellé se change (le contrôle positif)', issue, issue = 'OK ' || id_2026);
  issue := pg_temp.tente(membre, format('update comptes_bancaires set compte_propre_depuis = compte_propre_depuis, clos_le = ''2026-12-31'' where id = %L returning id::text', id_2026));
  perform pg_temp.verdict('CP-B4. la même date réécrite, avec la clôture : rien ne se juge (le contrôle positif)', issue, issue = 'OK ' || id_2026);
  issue := pg_temp.tente(membre, format('update comptes_bancaires set compte_propre_depuis = ''2027-01-01'' where id = %L returning id::text', id_2026));
  perform pg_temp.verdict('CP-B5. déplacée d''un an, encore ouvert (2027), elle passe (le contrôle positif)', issue, issue = 'OK ' || id_2026);
  issue := pg_temp.tente(membre, format('update comptes_bancaires set compte_propre_depuis = ''2026-01-01'' where id = %L returning id::text', id_2027));
  perform pg_temp.verdict('CP-B6. déplacée vers 2026, validé depuis : refusée, 2027 la première année ouverte', issue, issue = '23514 ' || pg_temp.mots(2026, 2027));
  issue := pg_temp.tente(membre, format('update comptes_bancaires set libelle = ''Principal renommé'' where dossier_id = %L and principal returning id::text', da));
  perform pg_temp.verdict('CP-B7. le principal, sans date à lui, ne se juge pas (le contrôle positif)', issue, issue like 'OK %');

  -- ══ CP-C. L'ordre : la garde d'hier parle d'abord ══
  issue := pg_temp.tente(membre, pg_temp.second(da, '512400', '2025-06-01'));
  perform pg_temp.verdict('CP-C1. une date qui n''est pas un 1er janvier, dans l''exercice validé : le refus de la garde d''hier, le premier', issue,
    issue = '23514 Un compte bancaire tient son propre compte depuis le premier jour d''un exercice, un 1er janvier : « 01/06/2025 » n''en est pas un.');

  -- ══ CP-D. L'accès ══
  issue := pg_temp.tente(membre, pg_temp.second(db, '512100', '2025-01-01'));
  perform pg_temp.verdict('CP-D1. le membre sur un dossier qui ne lui est pas assigné : la policy (42501), jamais l''exercice validé', issue,
    issue like '42501 %' and issue not like '%validé%');
  issue := pg_temp.tente(client, pg_temp.second(da, '512100', '2025-01-01'));
  perform pg_temp.verdict('CP-D2. le client « Banque » du dossier : la policy (42501), jamais l''exercice validé', issue,
    issue like '42501 %' and issue not like '%validé%');
  issue := pg_temp.tente(null, pg_temp.second(da, '512100', '2025-01-01'));
  perform pg_temp.verdict('CP-D3. l''anonyme : refusé, jamais l''exercice validé', issue, issue like '42501 %' and issue not like '%validé%');

  -- ══ CP-E. La restauration ══
  -- La sauvegarde réinsère les comptes, puis les exercices validés, sa dernière table : le compte d'abord, qui part de 2025.
  issue := pg_temp.fait(chef, format('insert into comptes_bancaires (dossier_id, libelle, compte, compte_propre_depuis, created_by) values (%L, %L, %L, %L, null) returning id::text',
    dr, 'Compte pro restauré', '512100', '2025-01-01'));
  perform pg_temp.verdict('CP-E1. le super-administrateur réinsère un compte qui part de 2025, avant les exercices validés (le contrôle positif)', issue, issue like 'OK %');
  begin
    insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte, declaration)
      values (dr, 2025, now(), chef, 'tresorerie', 0, 0, 0, 0, repeat('0', 64), '{}');
    issue := 'OK';
  exception when others then issue := sqlstate || ' ' || sqlerrm;
  end;
  perform pg_temp.verdict('CP-E2. puis l''exercice validé 2025 se réinsère : le filet ne regarde que le compte (le contrôle positif)', issue, issue = 'OK');

  -- ══ CP-F. Le verrou partagé de la validation ══
  issue := pg_temp.verrou_pris(dl, cabinet);
  perform pg_temp.verdict('CP-F1. un compte posé prend le verrou partagé de la validation de son dossier (la clé de cle_validation)',
    issue, issue = 'avant false, après true');

  -- ══ CP-G. Le catalogue ══
  select string_agg(t.tgname || ':' || ((t.tgtype & 2) <> 0)::text || ':' || ((t.tgtype & 4) <> 0)::text || ':' || ((t.tgtype & 8) <> 0)::text
                    || ':' || ((t.tgtype & 16) <> 0)::text || ':' || coalesce((select string_agg(a.attname, ',' order by a.attname) from pg_attribute a
                    where a.attrelid = t.tgrelid and a.attnum = any (t.tgattr)), '') || ':' || t.tgenabled::text, ' ' order by t.tgname collate "C")
    into texte
    from pg_trigger t where t.tgrelid = 'public.comptes_bancaires'::regclass and not t.tgisinternal and (t.tgtype & 2) <> 0;
  perform pg_temp.verdict('CP-G1. les déclencheurs BEFORE de la table, dans leur ordre : le filet après la garde d''hier, sur l''insertion et la seule date', texte,
    texte ~ '^(_acces_avant_les_gardes:[^ ]* )?comptes_bancaires_garde:true:true:true:true::O comptes_bancaires_garde_des_exercices_valides:true:true:false:true:compte_propre_depuis:O$');
  select p.prosecdef::text || ':' || array_to_string(p.proconfig, ',') || ':' || has_function_privilege('anon', p.oid, 'execute')::text
         || ':' || has_function_privilege('authenticated', p.oid, 'execute')::text
    into texte from pg_proc p where p.oid = 'public.garder_compte_propre_hors_des_exercices_valides()'::regprocedure;
  perform pg_temp.verdict('CP-G2. la fonction : aux droits de l''appelant, son chemin fixé, fermée à l''API', texte, texte = 'false:search_path=public:false:false');

  -- ══ Les mutations de la fonction : chacune doit faire virer un contrôle au rouge ══
  -- M-CP1 : le refus ôté ; la date sur l'exercice validé passe (CP-A2).
  begin
    execute replace(pg_get_functiondef('public.garder_compte_propre_hors_des_exercices_valides()'::regprocedure),
      'if v_validee is not null then', 'if false then');
    issue := pg_temp.tente(membre, pg_temp.second(da, '512100', '2025-01-01'));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into cp_mutation (mutation, observe, mord) values ('M-CP1 — le refus ôté : une date sur l''exercice validé', issue, issue like 'OK %');
  -- M-CP2 : l'exercice validé lui-même admis (> au lieu de >=) ; CP-A2 passe.
  begin
    execute replace(pg_get_functiondef('public.garder_compte_propre_hors_des_exercices_valides()'::regprocedure),
      'v.annee >= extract(year', 'v.annee > extract(year');
    issue := pg_temp.tente(membre, pg_temp.second(da, '512100', '2026-01-01'));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into cp_mutation (mutation, observe, mord) values ('M-CP2 — l''exercice validé lui-même admis : une date sur 2026, validé', issue, issue like 'OK %');
  -- M-CP3 : la date déjà posée jugée de nouveau ; la même date réécrite avec la clôture se refuse (CP-B4).
  begin
    execute replace(pg_get_functiondef('public.garder_compte_propre_hors_des_exercices_valides()'::regprocedure),
      'or (tg_op = ''UPDATE'' and new.compte_propre_depuis is not distinct from old.compte_propre_depuis)', '');
    issue := pg_temp.tente(membre, format('update comptes_bancaires set compte_propre_depuis = compte_propre_depuis, clos_le = ''2026-12-31'' where id = %L and compte_propre_depuis = ''2026-01-01'' returning id::text', id_2026));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into cp_mutation (mutation, observe, mord) values ('M-CP3 — la date déjà posée jugée de nouveau : la même date réécrite', issue, issue like '23514 %');
  -- M-CP4 : le super-administrateur exempté ; le chef (qui l'est) pose une date sur l'exercice validé (CP-A1).
  begin
    execute replace(pg_get_functiondef('public.garder_compte_propre_hors_des_exercices_valides()'::regprocedure),
      'if new.principal or new.compte_propre_depuis is null', 'if public.is_super_admin() or new.principal or new.compte_propre_depuis is null');
    issue := pg_temp.tente(chef, pg_temp.second(da, '512100', '2025-01-01'));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into cp_mutation (mutation, observe, mord) values ('M-CP4 — le super-administrateur exempté : le chef pose une date sur l''exercice validé', issue, issue like 'OK %');
  -- M-CP5 : le verrou de la validation ôté (CP-F1).
  begin
    execute replace(pg_get_functiondef('public.garder_compte_propre_hors_des_exercices_valides()'::regprocedure),
      'perform pg_advisory_xact_lock_shared(hashtextextended(''jd.validation_exercice:'' || new.dossier_id::text, 0));', '');
    issue := pg_temp.verrou_pris(dl, cabinet);
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into cp_mutation (mutation, observe, mord) values ('M-CP5 — le verrou de la validation ôté', issue, issue = 'avant false, après false');
  -- M-CP6 : le déclencheur sur l'insertion seule ; une date changée vers l'exercice validé passe (CP-B1).
  begin
    execute 'drop trigger comptes_bancaires_garde_des_exercices_valides on public.comptes_bancaires';
    execute 'create trigger comptes_bancaires_garde_des_exercices_valides before insert on public.comptes_bancaires for each row execute function public.garder_compte_propre_hors_des_exercices_valides()';
    issue := pg_temp.tente(membre, format('update comptes_bancaires set compte_propre_depuis = ''2025-01-01'' where id = %L returning id::text', id_2027));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into cp_mutation (mutation, observe, mord) values ('M-CP6 — le déclencheur sur l''insertion seule : une date changée vers l''exercice validé', issue, issue like 'OK %');
  -- M-CP7 : la fonction en definer ; le client « Banque », que la policy refuse, apprend que l'exercice est validé (CP-D2).
  begin
    execute 'alter function public.garder_compte_propre_hors_des_exercices_valides() security definer';
    issue := pg_temp.tente(client, pg_temp.second(da, '512100', '2025-01-01'));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into cp_mutation (mutation, observe, mord) values ('M-CP7 — la fonction en definer : le client apprend l''exercice validé', issue, issue like '%validé%');
end
$essai$;

select 'INVARIANTS' as tableau, controle as ligne, case when ok then 'juste' else '*** EN FAUTE ***' end as resultat, observe as detail
  from cp_verdict
union all
select 'MUTATIONS', mutation, case when mord then 'le contrôle mord' else '*** NE MORD PAS ***' end, observe
  from cp_mutation
union all
select 'BILAN', 'invariants et mutations',
  (select count(*) filter (where not ok) from cp_verdict) || ' en faute / ' || (select count(*) from cp_verdict) || ' ; '
  || (select count(*) filter (where mord) from cp_mutation) || ' mutations sur ' || (select count(*) from cp_mutation) || ' qui mordent', ''
order by 1 desc, 2;

rollback;
