-- LA PIÈCE QU'UNE ÉCRITURE LIBRE CITE, TENUE DANS SON DOSSIER (ligne 26.9, SECU4-Q1 ; la migration
-- `piece_d_une_ecriture_libre_dans_son_dossier`, en production depuis le 27/11/2026, 260, par l'outil :
-- supabase/schema/20261127213748_piece_d_une_ecriture_libre_dans_son_dossier.sql). Le récit : HISTORIQUE.md, « 27/11/2026 —
-- LA RELECTURE ADVERSE DE SÉCURITÉ DES MIGRATIONS 218 À 259 », puis « SECU4-Q1 ET MCBR-Q2 EN PRODUCTION (260, 261) ». À rejouer
-- après toute migration qui touche `garder_piece_d_une_ecriture_libre`, les gardes BEFORE de `ecritures_libres` ou de `pieces`,
-- ou `enregistrer_ecriture_libre`.
-- SANS LA MIGRATION (la garde absente du catalogue), il se dit EN ATTENTE.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   1. LE CATALOGUE : la garde aux droits de son propriétaire, son chemin fixé, exécutable par aucun rôle de session ; ses deux
--      déclencheurs BEFORE, et leur rang — sur `ecritures_libres`, après la porte d'accès et les deux gardes de la table ;
--   2. LE CÔTÉ PIÈCE : une pièce qu'une écriture libre cite ne change pas de dossier, sous la session d'un membre de l'équipe
--      assigné aux deux dossiers (il n'est pas super-administrateur) comme pour le propriétaire hors de la RLS ; le refus nomme
--      l'écriture de son dossier ; une pièce que rien ne cite change de dossier, avec son chemin (le contrôle positif) ;
--   3. LE CÔTÉ ÉCRITURE : `enregistrer_ecriture_libre` refusait déjà la pièce d'un autre dossier (ses mots) ; la restauration du
--      super-administrateur, qui écrit en direct, ne cite plus la pièce d'un autre dossier ni un identifiant inconnu (les mêmes
--      mots, avant la clé étrangère), et cite celle de son dossier ; une réécriture de la pièce citée sous le réglage de la
--      fonction, hors d'elle, se refuse de même.
--
-- Deux dossiers jetables du cabinet du dossier `test` (préfixe `5ec40000-0000-4000-8000`) : DA et DB, en trésorerie ; les pièces
-- PA et PA2 de DA, PB de DB ; le membre de l'équipe du dossier `test` assigné aux deux le temps de l'essai. L'écriture libre de
-- DA qui cite PA est passée par sa fonction, sous la session du membre, au 15 janvier de l'année en cours (lue à Paris). Chaque
-- étape se joue dans sa sous-transaction et s'y ANNULE (`ANNULATION_ETAPE`) : ce que le membre pose d'abord, puis le geste (du
-- membre ou du super-administrateur sous la RLS, ou du propriétaire), puis ce qu'on relit ; le jeu s'annule à la fin
-- (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le relit. Les verdicts voyagent dans un réglage LOCAL à la transaction
-- (`essai.piece_d_une_ecriture_libre_dans_son_dossier`) : le fichier se joue d'un seul appel, ne crée ni table ni fonction, ne
-- contient aucune instruction de suppression, et ne rend rien qui dépende d'une ligne hors de ses dossiers. Hors de l'outil
-- d'exécution, il se joue en UNE transaction (`psql -1`).
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  membre constant text := '3e3b0000-0000-4000-8000-000000000001';
  da constant text := '5ec40000-0000-4000-8000-0000000000d1';
  db constant text := '5ec40000-0000-4000-8000-0000000000d2';
  pa constant text := '5ec40000-0000-4000-8000-0000000000b1';
  pa2 constant text := '5ec40000-0000-4000-8000-0000000000b2';
  pb constant text := '5ec40000-0000-4000-8000-0000000000b3';
  inconnue constant text := '5ec40000-0000-4000-8000-0000000000ff';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  annee constant integer := extract(year from (now() at time zone 'Europe/Paris'))::integer;
  date_e constant date := make_date(extract(year from (now() at time zone 'Europe/Paris'))::integer, 1, 15);
  appliquee constant boolean := to_regprocedure('public.garder_piece_d_une_ecriture_libre()') is not null;
  -- L'écriture libre de DA qui cite une pièce, par sa fonction : deux lignes de bilan équilibrées, sans poste.
  ecrire constant text := $q$select enregistrer_ecriture_libre('{DA}', jsonb_build_object('date', '{DE}', 'avec_extourne', false,
      'libelle', 'ESSAI SECU4 ECRITURE', 'motif', 'ESSAI SECU4 MOTIF', 'piece_citee_id', '{CITEE}',
      'lignes', jsonb_build_array(jsonb_build_object('compte', '471000', 'sens', 'debit', 'centimes', 1000),
                                  jsonb_build_object('compte', '401000', 'sens', 'credit', 'centimes', 1000))),
    jsonb_build_array(jsonb_build_object('journal', 'OD', 'date', '{DE}', 'libelle', 'ESSAI SECU4 ECRITURE',
      'lignes', jsonb_build_array(jsonb_build_object('compte', '471000', 'sens', 'debit', 'centimes', 1000),
                                  jsonb_build_object('compte', '401000', 'sens', 'credit', 'centimes', 1000)))), null);$q$;
  -- La restauration : une copie de l'écriture de DA, sous un autre numéro, qui cite la pièce donnée.
  restaurer constant text := $q$insert into ecritures_libres (dossier_id, exercice, numero, date, libelle, motif, lignes, avec_extourne,
      piece_citee_id, version, cree_par)
    select e.dossier_id, e.exercice, 99, e.date, e.libelle, e.motif, e.lignes, false, '{CITEE}', 1, e.cree_par
      from ecritures_libres e where e.dossier_id = '{DA}' and e.numero = 1;$q$;
  citee_par_l_ecriture constant text := 'Cette pièce est citée par l''écriture libre EL' || extract(year from (now() at time zone 'Europe/Paris'))::integer
    || '-0001 de son dossier : elle ne change pas de dossier.';
  de_son_dossier constant text := 'La pièce qu''une écriture libre cite est une pièce de son dossier.';
  e record; v_code text; v_msg text; v_obs text; v_textes text[];
  verdicts jsonb := '[]'::jsonb;
begin
  if not appliquee then
    perform set_config('essai.piece_d_une_ecriture_libre_dans_son_dossier', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration piece_d_une_ecriture_libre_dans_son_dossier (SECU4-Q1)', 'ok', true,
      'observe', 'absente : une pièce qu''une écriture libre cite change encore de dossier ; l''essai se joue dès qu''elle y est'))::text, true);
    return;
  end if;
  begin
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values
      (da::uuid, 'ESSAI SECU4 DA', cabinet, 'tresorerie', '455000'),
      (db::uuid, 'ESSAI SECU4 DB', cabinet, 'tresorerie', '455000');
    insert into dossier_assignations (dossier_id, user_id) values (da::uuid, membre::uuid), (db::uuid, membre::uuid);
    insert into pieces (id, dossier_id, storage_path, nom_fichier, storage_hash, type_piece, statut, date_piece, montant_ht,
                        montant_tva, montant_ttc) values
      (pa::uuid, da::uuid, da || '/essai-secu4-pa.pdf', 'essai-secu4-pa.pdf', repeat('a', 64), 'achat', 'a_valider', date_e, 10, 0, 10),
      (pa2::uuid, da::uuid, da || '/essai-secu4-pa2.pdf', 'essai-secu4-pa2.pdf', repeat('b', 64), 'achat', 'a_valider', date_e, 10, 0, 10),
      (pb::uuid, db::uuid, db || '/essai-secu4-pb.pdf', 'essai-secu4-pb.pdf', repeat('c', 64), 'achat', 'a_valider', date_e, 10, 0, 10);

    -- Une étape : {rang, étape, ce que le membre pose d'abord, qui fait le geste (`membre` ou `super` sous la RLS, `proprio`
    -- hors d'elle), le geste, ce qu'on relit, le code attendu (`OK` : accepté) et ce qu'on relit, ou les mots du refus}.
    for e in select * from (values
      (1, '1. le catalogue : la garde aux droits de son propriétaire, son chemin fixé, exécutable par aucun rôle de session ; ses deux déclencheurs BEFORE',
        null, 'proprio', null,
        $q$(select p.prosecdef::text || ' ' || array_to_string(p.proconfig, ',') from pg_proc p where p.oid = 'public.garder_piece_d_une_ecriture_libre()'::regprocedure)
           || ' ' || has_function_privilege('authenticated', 'public.garder_piece_d_une_ecriture_libre()', 'execute')
           || ' ' || has_function_privilege('anon', 'public.garder_piece_d_une_ecriture_libre()', 'execute')
           || ' ' || has_function_privilege('service_role', 'public.garder_piece_d_une_ecriture_libre()', 'execute')
           || ' ' || (select string_agg(t.tgrelid::regclass::text || ':' || t.tgtype || ':' || t.tgenabled::text, ',' order by t.tgname collate "C")
                        from pg_trigger t where t.tgfoid = 'public.garder_piece_d_une_ecriture_libre()'::regprocedure and not t.tgisinternal)$q$,
        'OK', 'true search_path=public false false false ecritures_libres:23:O,pieces:19:O'),
      (2, '1b. leur rang sur ecritures_libres : après la porte d''accès et les deux gardes de la table',
        null, 'proprio', null,
        $q$(select string_agg(t.tgname, ',' order by t.tgname collate "C") from pg_trigger t
             where t.tgrelid = 'public.ecritures_libres'::regclass and not t.tgisinternal and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4)$q$,
        'OK', '_acces_avant_les_gardes,ecritures_libres_garde,ecritures_libres_garde_de_la_contre_passation,ecritures_libres_piece_de_son_dossier'),
      (3, '2. le membre assigné aux deux dossiers passe à DB une pièce que l''écriture libre de DA cite, avec son chemin : refusé, l''écriture nommée',
        replace(ecrire, '{CITEE}', '{PA}'), 'membre',
        $q$update pieces set dossier_id = '{DB}', storage_path = '{DB}/essai-secu4-pa.pdf' where id = '{PA}';$q$,
        null, '23514', citee_par_l_ecriture),
      (4, '2b. … le propriétaire, hors de la RLS : refusé de même',
        replace(ecrire, '{CITEE}', '{PA}'), 'proprio',
        $q$update pieces set dossier_id = '{DB}', storage_path = '{DB}/essai-secu4-pa.pdf' where id = '{PA}';$q$,
        null, '23514', citee_par_l_ecriture),
      (5, '2c. une pièce que rien ne cite change de dossier, avec son chemin (le contrôle positif)',
        replace(ecrire, '{CITEE}', '{PA}'), 'membre',
        $q$update pieces set dossier_id = '{DB}', storage_path = '{DB}/essai-secu4-pa2.pdf' where id = '{PA2}';$q$,
        $q$(select dossier_id::text || ' ' || storage_path from pieces where id = '{PA2}')$q$, 'OK',
        '5ec40000-0000-4000-8000-0000000000d2 5ec40000-0000-4000-8000-0000000000d2/essai-secu4-pa2.pdf'),
      (6, '2d. l''écriture de DA citée par son numéro : elle cite toujours PA, de DA (le contrôle positif de la pose)',
        replace(ecrire, '{CITEE}', '{PA}'), 'proprio', null,
        $q$(select e.exercice || '-' || e.numero || ' ' || p.dossier_id::text from ecritures_libres e join pieces p on p.id = e.piece_citee_id where e.dossier_id = '{DA}')$q$,
        'OK', extract(year from (now() at time zone 'Europe/Paris'))::integer || '-1 5ec40000-0000-4000-8000-0000000000d1'),
      (7, '3. la fonction refusait déjà la pièce d''un autre dossier, sous ses mots',
        null, 'membre', replace(ecrire, '{CITEE}', '{PB}'),
        null, '22023', 'La pièce citée n’est pas une pièce de ce dossier.'),
      (8, '3b. la restauration du super-administrateur, en direct, ne cite pas la pièce d''un autre dossier',
        replace(ecrire, '{CITEE}', '{PA}'), 'super', replace(restaurer, '{CITEE}', '{PB}'),
        null, '23514', de_son_dossier),
      (9, '3c. … ni un identifiant inconnu : les mêmes mots, avant la clé étrangère',
        replace(ecrire, '{CITEE}', '{PA}'), 'super', replace(restaurer, '{CITEE}', '{X}'),
        null, '23514', de_son_dossier),
      (10, '3d. … et cite la pièce de son dossier (le contrôle positif de la restauration)',
        replace(ecrire, '{CITEE}', '{PA}'), 'super', replace(restaurer, '{CITEE}', '{PA2}'),
        $q$(select count(*)::text from ecritures_libres where dossier_id = '{DA}' and piece_citee_id = '{PA2}')$q$, 'OK', '1'),
      (11, '3e. la pièce citée réécrite sous le réglage de la fonction, hors d''elle, par le propriétaire : refusé',
        replace(ecrire, '{CITEE}', '{PA}'), 'proprio',
        $q$select set_config('jd.ecriture_libre', '{DA}', true);
           update ecritures_libres set piece_citee_id = '{PB}' where dossier_id = '{DA}';$q$,
        null, '23514', de_son_dossier)
    ) as v(rang, etape, pose, qui, geste, relu, code, attendu) order by rang
    loop
      v_code := 'OK';
      v_msg := null;
      v_obs := null;
      begin
        v_textes := array[e.pose, e.geste, e.relu, e.attendu];
        for i in 1 .. 4 loop
          if v_textes[i] is null then continue; end if;
          v_textes[i] := replace(replace(replace(replace(replace(v_textes[i], '{DA}', da), '{DB}', db), '{PA2}', pa2), '{PA}', pa), '{PB}', pb);
          v_textes[i] := replace(replace(v_textes[i], '{X}', inconnue), '{DE}', date_e::text);
        end loop;
        if v_textes[1] is not null then
          execute 'set local role authenticated';
          perform set_config('request.jwt.claims', json_build_object('sub', membre, 'role', 'authenticated')::text, true);
          execute v_textes[1];
          reset role;
          perform set_config('request.jwt.claims', '', true);
        end if;
        begin
          if v_textes[2] is not null then
            if e.qui in ('membre', 'super') then
              execute 'set local role authenticated';
              perform set_config('request.jwt.claims', json_build_object('sub', case e.qui when 'membre' then membre else chef end,
                'role', 'authenticated')::text, true);
            end if;
            execute v_textes[2];
            reset role;
            perform set_config('request.jwt.claims', '', true);
            perform set_config('jd.ecriture_libre', '', true);
          end if;
          if v_textes[3] is not null then
            execute 'select (' || v_textes[3] || ')::text' into v_obs;
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
        'ok', v_code = e.code and v_msg = v_textes[4], 'observe', v_code || ' ' || coalesce(v_msg, '-'));
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni leurs pièces, écritures libres, lignes, assignations',
    'ok', not exists (select 1 from dossiers where id in (da::uuid, db::uuid))
      and not exists (select 1 from pieces where id in (pa::uuid, pa2::uuid, pb::uuid))
      and not exists (select 1 from ecritures_libres where dossier_id in (da::uuid, db::uuid))
      and not exists (select 1 from ecritures_brouillon where dossier_id in (da::uuid, db::uuid))
      and not exists (select 1 from dossier_assignations where dossier_id in (da::uuid, db::uuid)),
    'observe', 'relu');
  perform set_config('essai.piece_d_une_ecriture_libre_dans_son_dossier', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.piece_d_une_ecriture_libre_dans_son_dossier')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
