-- L'ÉTAT DU DOSSIER CHEZ LE CABINET, MONTRÉ AU CLIENT (ligne 51.5, partie C, étape C2 ; la migration `phase_des_exercices`,
-- PRÉPARÉE le 06/11/2026, supabase/preparees/). Le récit : HISTORIQUE.md, « 06/11/2026 — L'ÉTAT DU DOSSIER CHEZ LE
-- CABINET, MONTRÉ AU CLIENT (C2) (PRÉPARÉE, PAS APPLIQUÉE) ». À rejouer par `execute_sql` après toute migration qui touche
-- `phase_des_exercices`, `exercices_valides`, `exercices_clotures`, les tables de la révision, `admin_du_dossier` ou
-- `client_du_dossier`.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - la PHASE de chaque exercice, sur sept exercices d'un dossier jetable, relatifs à l'exercice en cours à Paris (N) :
--     N, rien → « pieces_attendues » ; N−1, une note de révision sans clôture → « pieces_attendues » (la collecte
--     l'emporte sur la révision commencée) ; N−2, clôturé et une note → « en_revision » ; N−3, validé en trésorerie le
--     30 avril à 23 h 30 UTC → « validee », le 1er mai (le jour de Paris), la 2035 enregistrée ; N−4, clôturé seul →
--     « en_cours » ; N−5, validé en engagement → « validee », sans 2035 ; N−6, une note sans clôture, hors de la fenêtre
--     de la collecte → « en_revision » ; et rien d'autre : la valeur rendue est comparée ENTIÈRE, quatre clés par
--     exercice, aucune de plus ;
--   - qui la lit : le cabinet (le chef) et le client de CE dossier, la même valeur ; le client d'un autre dossier, une
--     session sans identifiant, le chef sur un dossier qui n'existe pas : 42501 et leurs mots ; l'anonyme n'exécute pas la
--     fonction ; un dossier sans rien rend l'exercice en cours et le précédent, attendus ;
--   - le catalogue : `security definer`, `search_path` fixé, `stable`, un `jsonb`, exécutable par les connectés, ni par
--     `public` ni par `anon`.
--
-- Deux dossiers jetables du cabinet du dossier `test` (préfixe `c2c20000-0000-4000-8026`), le premier avec un accès sans
-- case du client d'essai (inséré comme `create-client-access` l'insère). Les notes de révision s'écrivent par
-- `noter_revision`, sous la session du chef, avant les validations ; les clôtures et les validations, par le propriétaire.
-- Le jeu s'annule à la fin (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le relit. Les verdicts voyagent dans un
-- réglage LOCAL à la transaction (`essai.phase_des_exercices`), que la requête finale lit : le fichier se joue d'un seul
-- appel, ne crée ni table ni fonction, ne contient aucune instruction de suppression, et ne rend rien qui dépende d'une
-- ligne hors de ses dossiers. Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`). Sans la migration,
-- une ligne dit qu'il attend (EN ATTENTE) et rien ne s'écrit.
do $essai$
declare
  chef constant uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  da constant uuid := 'c2c20000-0000-4000-8026-0000000000d1';
  db constant uuid := 'c2c20000-0000-4000-8026-0000000000d2';
  inconnu constant uuid := 'c2c20000-0000-4000-8026-0000000000ff';
  acces constant uuid := 'c2c20000-0000-4000-8026-0000000000a1';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  n constant integer := extract(year from (now() at time zone 'Europe/Paris'))::integer;
  attendu jsonb;
  attendu_vide jsonb;
  verdicts jsonb := '[]'::jsonb;
  v_rendu jsonb;
  v_code text;
  v_msg text;
  profil record;
begin
  if to_regprocedure('public.phase_des_exercices(uuid)') is null then
    perform set_config('essai.phase_des_exercices', jsonb_build_array(jsonb_build_object('rang', 0,
      'controle', '0. EN ATTENTE de la migration phase_des_exercices', 'ok', true,
      'observe', 'la fonction n''est pas en base : rien ne s''écrit'))::text, true);
    return;
  end if;

  attendu := jsonb_build_array(
    jsonb_build_object('annee', n, 'phase', 'pieces_attendues', 'valide_le', null, 'declaration_2035', false),
    jsonb_build_object('annee', n - 1, 'phase', 'pieces_attendues', 'valide_le', null, 'declaration_2035', false),
    jsonb_build_object('annee', n - 2, 'phase', 'en_revision', 'valide_le', null, 'declaration_2035', false),
    jsonb_build_object('annee', n - 3, 'phase', 'validee', 'valide_le', make_date(n - 2, 5, 1), 'declaration_2035', true),
    jsonb_build_object('annee', n - 4, 'phase', 'en_cours', 'valide_le', null, 'declaration_2035', false),
    jsonb_build_object('annee', n - 5, 'phase', 'validee', 'valide_le', make_date(n - 4, 3, 2), 'declaration_2035', false),
    jsonb_build_object('annee', n - 6, 'phase', 'en_revision', 'valide_le', null, 'declaration_2035', false));
  attendu_vide := jsonb_build_array(
    jsonb_build_object('annee', n, 'phase', 'pieces_attendues', 'valide_le', null, 'declaration_2035', false),
    jsonb_build_object('annee', n - 1, 'phase', 'pieces_attendues', 'valide_le', null, 'declaration_2035', false));

  begin
    -- ══ Le jeu ══
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, statut_tva) values
      (da, 'ESSAI PHASE DES EXERCICES DA', cabinet, 'tresorerie', '455000', 'exonere'),
      (db, 'ESSAI PHASE DES EXERCICES DB', cabinet, 'tresorerie', '455000', 'exonere');
    insert into memberships (id, user_id, dossier_id, role, email) values
      (acces, client, da, 'client', 'essai-phase@example.test');
    -- La révision, par sa fonction et sous la session du chef, avant que les validations ne figent quoi que ce soit.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform noter_revision(da, n - 1, 'ensemble', 'travail', 'Essai : la révision commencée.');
    perform noter_revision(da, n - 2, 'ensemble', 'travail', 'Essai : la révision commencée.');
    perform noter_revision(da, n - 6, 'ensemble', 'travail', 'Essai : la révision commencée.');
    reset role;
    perform set_config('request.jwt.claims', '', true);
    insert into exercices_clotures (dossier_id, annee, cloture_le) values (da, n - 2, now()), (da, n - 4, now());
    insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures,
                                   total_debit, total_credit, empreinte, declaration) values
      (da, n - 3, make_timestamptz(n - 2, 4, 30, 23, 30, 0, 'UTC'), chef, 'tresorerie', 0, 0, 0, 0, repeat('c', 64), '{}'::jsonb),
      (da, n - 5, make_timestamptz(n - 4, 3, 2, 10, 0, 0, 'UTC'), chef, 'engagement', 0, 0, 0, 0, repeat('d', 64), null);

    -- ══ Les profils : qui lit, quel dossier, ce qu'il doit recevoir ══
    for profil in
      select * from (values
        (1, '1. le cabinet (le chef) lit les sept exercices du dossier du client, phase par phase (le contrôle positif)',
            'authenticated', chef, da, attendu, null::text, null::text),
        (2, '2. le client de ce dossier, sans case, lit la même valeur',
            'authenticated', client, da, attendu, null, null),
        (3, '3. le client d''un autre dossier du cabinet est refusé',
            'authenticated', client, db, null, '42501', 'Accès refusé à ce dossier.'),
        (4, '4. une session sans identifiant est refusée',
            'authenticated', null, da, null, '42501', 'Accès refusé à ce dossier.'),
        (5, '5. l''anonyme n''exécute pas la fonction',
            'anon', null, da, null, '42501', 'permission denied for function phase_des_exercices'),
        (6, '6. le chef, sur un dossier qui n''existe pas, est refusé sous les mêmes mots',
            'authenticated', chef, inconnu, null, '42501', 'Accès refusé à ce dossier.'),
        (7, '7. un dossier sans rien : l''exercice en cours et le précédent, attendus',
            'authenticated', chef, db, attendu_vide, null, null)
      ) as t(rang, controle, role_, sub, dossier, valeur, code, message)
    loop
      v_rendu := null;
      v_code := null;
      v_msg := null;
      begin
        if profil.role_ = 'anon' then
          set local role anon;
          perform set_config('request.jwt.claims', '{"role":"anon"}', true);
        else
          set local role authenticated;
          perform set_config('request.jwt.claims', case when profil.sub is null then '{"role":"authenticated"}'
            else json_build_object('sub', profil.sub, 'role', 'authenticated')::text end, true);
        end if;
        -- Par EXECUTE, jamais par une affectation : PL/pgSQL garde l'état d'une expression simple pour la transaction, et
        -- le droit d'exécuter la fonction ne s'y juge qu'à la première évaluation — l'anonyme passait derrière une
        -- session acceptée (vu sur la réplique, la mutation M1). Chaque appel se prépare ici sous son propre rôle.
        execute 'select public.phase_des_exercices($1)' into v_rendu using profil.dossier;
        reset role;
      exception when others then
        get stacked diagnostics v_code = returned_sqlstate, v_msg = message_text;
        reset role;
      end;
      perform set_config('request.jwt.claims', '', true);
      verdicts := verdicts || jsonb_build_object('rang', profil.rang, 'controle', profil.controle,
        'ok', case when profil.code is null then v_code is null and v_rendu is not distinct from profil.valeur
                   else v_rendu is null and v_code = profil.code and v_msg = profil.message end,
        'observe', case when v_code is not null then v_code || ' ' || v_msg
                        else coalesce((select string_agg('N-' || (n - (e->>'annee')::integer) || ' ' || (e->>'phase')
                                         || coalesce(' le ' || (e->>'valide_le'), '')
                                         || case when (e->>'declaration_2035')::boolean then ' 2035' else '' end
                                         || case when (select count(*) from jsonb_object_keys(e)) <> 4 then ' (clés en trop)' else '' end,
                                         ', ' order by (e->>'annee')::integer desc)
                                       from jsonb_array_elements(v_rendu) e), 'rien') end);
    end loop;

    -- ══ Le catalogue ══
    verdicts := verdicts || (select jsonb_build_object('rang', 8,
      'controle', '8. le catalogue : security definer, search_path fixé, stable, un jsonb ; exécutable par authenticated, ni par public ni par anon',
      'ok', p.prosecdef and p.proconfig = array['search_path=public'] and p.provolatile = 's'
            and pg_get_function_result(p.oid) = 'jsonb'
            and has_function_privilege('authenticated', p.oid, 'execute')
            and not has_function_privilege('anon', p.oid, 'execute')
            and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0),
      'observe', p.prosecdef::text || ' ' || coalesce(array_to_string(p.proconfig, ','), '-') || ' ' || p.provolatile::text
                 || ' ' || pg_get_function_result(p.oid))
      from pg_proc p where p.oid = to_regprocedure('public.phase_des_exercices(uuid)'));

    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  -- Rien n'est resté : ni les deux dossiers, ni l'accès, ni les clôtures, les validations ou les notes du jeu.
  verdicts := verdicts || jsonb_build_object('rang', 99,
    'controle', '99. rien n''est resté : ni les dossiers jetables, ni l''accès, ni les clôtures, validations et notes du jeu',
    'ok', not exists (select 1 from dossiers where id in (da, db))
      and not exists (select 1 from memberships where id = acces)
      and not exists (select 1 from exercices_clotures where dossier_id in (da, db))
      and not exists (select 1 from exercices_valides where dossier_id in (da, db))
      and not exists (select 1 from revision_notes where dossier_id in (da, db)),
    'observe', 'relu');
  perform set_config('essai.phase_des_exercices', verdicts::text, true);
end
$essai$;

select v.rang, v.controle, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.phase_des_exercices')::jsonb) as v(rang integer, controle text, ok boolean, observe text)
order by v.rang;
