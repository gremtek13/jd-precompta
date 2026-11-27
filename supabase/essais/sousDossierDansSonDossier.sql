-- LE SOUS-DOSSIER D'UN DOCUMENT OU D'UNE PIÈCE, TENU DANS SON DOSSIER (DOCF-Q1-B ; la migration
-- `sous_dossier_dans_son_dossier`, en production depuis le 27/11/2026, 257,
-- supabase/schema/20261127055603_sous_dossier_dans_son_dossier.sql). Le récit : HISTORIQUE.md, « 17/11/2026 — DOCF-Q1-B : LE
-- SOUS-DOSSIER TENU DANS SON DOSSIER, EN BASE (PRÉPARÉE, PAS APPLIQUÉE) », « 27/11/2026 — OPT6 EN PRODUCTION (255) ». À
-- rejouer après toute migration qui touche `garder_sous_dossier_dans_son_dossier`, `garder_sous_dossier_occupe`, les gardes
-- BEFORE de `documents_divers`, `pieces` ou `sous_dossiers`, ou leurs policies. SANS LA MIGRATION (la garde absente du
-- catalogue), il se dit EN ATTENTE.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   1. LE CATALOGUE : la garde de la ligne aux droits de son propriétaire, celle du sous-dossier aux droits de l'appelant,
--      chacune son chemin fixé, exécutables par aucun rôle de session ; leurs trois déclencheurs, et leur rang — sur
--      `documents_divers` et `pieces`, la première garde BEFORE après la porte d'accès ;
--   2. LE DOCUMENT : rangé dans le sous-dossier d'un autre dossier, ou d'un identifiant inconnu, il se refuse sous les mêmes
--      mots (la garde tire avant la clé étrangère), au chef comme au propriétaire hors de la RLS, à l'insertion comme à la mise
--      à jour ; il ne change pas de dossier avec son sous-dossier, il en change avec un sous-dossier de l'autre dossier ou sans
--      sous-dossier ; le client d'essai range ce qu'il dépose dans un sous-dossier de son dossier, jamais d'un autre ;
--   3. LA PIÈCE, de même ; et le nul que la clé étrangère écrit à la suppression d'un sous-dossier passe ; une ligne qui change
--      de dossier change aussi de chemin (2g, 2h, 3g) : le chemin d'une ligne commence par son dossier depuis CFCS-Q1
--      (`chemin_dans_son_dossier`, 238, en production le 17/11/2026, après l'écriture de cet essai ; reprise le 27/11/2026) —
--      SECU4-Q2 en base (`ni_piece_ni_document_ne_change_de_dossier`, préparée), aucune ligne ne change plus de dossier : la
--      garde la laisse passer, puis la règle du dossier, qui tire en dernier, la refuse sous ses mots (2g, 2h, 3g le disent
--      dans les deux états) ;
--   4. LE SOUS-DOSSIER : qui range un document ou une pièce ne change pas de dossier, au chef comme au propriétaire ; vide, il
--      en change, comme hier ; occupé, il se renomme.
--
-- Deux dossiers jetables du cabinet du dossier `test` (préfixe `d0cf0000-0000-4000-8000`) : DA et DB, nus, en trésorerie ;
-- et le dossier du client d'essai (DC). Les sous-dossiers SA et SV (vide) de DA, SB de DB, SC de DC ; le document DOA et la
-- pièce PIA de DA, sans sous-dossier. Chaque étape se joue dans sa sous-transaction et s'y ANNULE (`ANNULATION_ETAPE`) : ce
-- que le chef pose d'abord, puis le geste (du chef ou du client d'essai sous la RLS, ou du propriétaire), puis la fin de la
-- transaction simulée (`set constraints all immediate`), puis ce qu'on relit ; le jeu s'annule à la fin
-- (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le relit. Les verdicts voyagent dans un réglage LOCAL à la transaction
-- (`essai.sous_dossier_dans_son_dossier`) : le fichier se joue d'un seul appel, ne crée ni table ni fonction, ne contient
-- aucune instruction de suppression, et ne rend rien qui dépende d'une ligne hors de ses dossiers. Hors de l'outil
-- d'exécution, il se joue en UNE transaction (`psql -1`).
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  da constant text := 'd0cf0000-0000-4000-8000-0000000000d1';
  db constant text := 'd0cf0000-0000-4000-8000-0000000000d2';
  dc constant text := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  sa constant text := 'd0cf0000-0000-4000-8000-0000000000a1';
  sv constant text := 'd0cf0000-0000-4000-8000-0000000000a2';
  sb constant text := 'd0cf0000-0000-4000-8000-0000000000a3';
  sc constant text := 'd0cf0000-0000-4000-8000-0000000000a4';
  doa constant text := 'd0cf0000-0000-4000-8000-0000000000c1';
  don constant text := 'd0cf0000-0000-4000-8000-0000000000c2';
  pia constant text := 'd0cf0000-0000-4000-8000-0000000000b1';
  pin constant text := 'd0cf0000-0000-4000-8000-0000000000b2';
  inconnu constant text := 'd0cf0000-0000-4000-8000-0000000000ff';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  date_p constant date := make_date(extract(year from now() at time zone 'Europe/Paris')::integer - 1, 11, 20);
  appliquee constant boolean := to_regprocedure('public.garder_sous_dossier_dans_son_dossier()') is not null;
  document_hors constant text := 'Le sous-dossier d''un document est un sous-dossier de son dossier.';
  piece_hors constant text := 'Le sous-dossier d''une pièce est un sous-dossier de son dossier.';
  occupe constant text := 'Ce sous-dossier range des documents ou des pièces de son dossier : il ne change pas de dossier.';
  -- SECU4-Q2 (`ni_piece_ni_document_ne_change_de_dossier`, préparée) : la règle du dossier, en base ou non, et ses mots.
  depot constant boolean := to_regprocedure('public.garder_dossier_de_depot()') is not null;
  piece_reste constant text := 'Une pièce reste dans le dossier où elle a été déposée : elle ne change pas de dossier.';
  document_reste constant text := 'Un document reste dans le dossier où il a été déposé : il ne change pas de dossier.';
  e record; v_code text; v_msg text; v_obs text; v_textes text[];
  verdicts jsonb := '[]'::jsonb;
begin
  if not appliquee then
    perform set_config('essai.sous_dossier_dans_son_dossier', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration sous_dossier_dans_son_dossier (DOCF-Q1-B)', 'ok', true,
      'observe', 'absente : un document ou une pièce se range encore dans le sous-dossier d''un autre dossier ; l''essai se joue dès qu''elle y est'))::text, true);
    return;
  end if;
  begin
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values
      (da::uuid, 'ESSAI DOCFQ1B DA', cabinet, 'tresorerie', '455000'),
      (db::uuid, 'ESSAI DOCFQ1B DB', cabinet, 'tresorerie', '455000');
    insert into sous_dossiers (id, dossier_id, nom) values
      (sa::uuid, da::uuid, 'ESSAI DOCFQ1B SA'), (sv::uuid, da::uuid, 'ESSAI DOCFQ1B SV'),
      (sb::uuid, db::uuid, 'ESSAI DOCFQ1B SB'), (sc::uuid, dc::uuid, 'ESSAI DOCFQ1B SC');
    insert into documents_divers (id, dossier_id, storage_path, nom_fichier, categorie, storage_hash) values
      (doa::uuid, da::uuid, da || '/essai-docf-doa.pdf', 'essai-docf-doa.pdf', 'autre', repeat('d', 64));
    insert into pieces (id, dossier_id, storage_path, nom_fichier, storage_hash, type_piece, statut, date_piece, montant_ht,
                        montant_tva, montant_ttc) values
      (pia::uuid, da::uuid, da || '/essai-docf-pia.pdf', 'essai-docf-pia.pdf', repeat('c', 64), 'achat', 'a_valider', date_p, 100, 20, 120);

    -- Une étape : {rang, étape, ce que le chef pose d'abord, qui fait le geste (`chef` ou `client` sous la RLS, `proprio` hors
    -- d'elle), le geste, ce qu'on relit, le code attendu (`OK` : accepté) et ce qu'on relit, ou les mots du refus}.
    for e in select * from (values
      (1, '1. le catalogue : la garde de la ligne aux droits de son propriétaire, celle du sous-dossier aux droits de l''appelant, leur chemin fixé, exécutables par aucun rôle de session ; leurs trois déclencheurs BEFORE',
        null, 'proprio', null,
        $q$(select p.prosecdef::text || ' ' || array_to_string(p.proconfig, ',') from pg_proc p where p.oid = 'public.garder_sous_dossier_dans_son_dossier()'::regprocedure)
           || ' ' || (select p.prosecdef::text || ' ' || array_to_string(p.proconfig, ',') from pg_proc p where p.oid = 'public.garder_sous_dossier_occupe()'::regprocedure)
           || ' ' || has_function_privilege('authenticated', 'public.garder_sous_dossier_dans_son_dossier()', 'execute')
           || ' ' || has_function_privilege('anon', 'public.garder_sous_dossier_dans_son_dossier()', 'execute')
           || ' ' || has_function_privilege('service_role', 'public.garder_sous_dossier_dans_son_dossier()', 'execute')
           || ' ' || has_function_privilege('authenticated', 'public.garder_sous_dossier_occupe()', 'execute')
           || ' ' || has_function_privilege('anon', 'public.garder_sous_dossier_occupe()', 'execute')
           || ' ' || has_function_privilege('service_role', 'public.garder_sous_dossier_occupe()', 'execute')
           || ' ' || (select string_agg(t.tgrelid::regclass::text || ':' || t.tgtype || ':' || t.tgenabled::text, ',' order by t.tgrelid::regclass::text collate "C")
                        from pg_trigger t
                       where t.tgfoid in ('public.garder_sous_dossier_dans_son_dossier()'::regprocedure, 'public.garder_sous_dossier_occupe()'::regprocedure)
                         and not t.tgisinternal)$q$,
        'OK', 'true search_path=public false search_path=public false false false false false false documents_divers:23:O,pieces:23:O,sous_dossiers:19:O'),
      (2, '1b. leur rang : sur documents_divers et pieces, la première garde BEFORE après la porte d''accès',
        null, 'proprio', null,
        $q$(select string_agg(x.tgrelid::regclass::text || ':' || x.tgname, ',' order by x.tgrelid::regclass::text collate "C")
              from (select distinct on (t.tgrelid) t.tgrelid, t.tgname from pg_trigger t
                     where t.tgrelid in ('public.documents_divers'::regclass, 'public.pieces'::regclass)
                       and not t.tgisinternal and (t.tgtype & 2) = 2 and t.tgname <> '_acces_avant_les_gardes'
                     order by t.tgrelid, t.tgname collate "C") x)$q$,
        'OK', 'documents_divers:documents_divers_au_sous_dossier_de_leur_dossier,pieces:pieces_au_sous_dossier_de_leur_dossier'),
      (3, '2. le chef range le document de DA dans un sous-dossier de DB : refusé',
        null, 'chef', $q$update documents_divers set sous_dossier_id = '{SB}' where id = '{DOA}';$q$,
        null, '23514', document_hors),
      (4, '2b. … dans un sous-dossier inconnu : refusé sous les mêmes mots, avant la clé étrangère',
        null, 'chef', $q$update documents_divers set sous_dossier_id = '{X}' where id = '{DOA}';$q$,
        null, '23514', document_hors),
      (5, '2c. … dans un sous-dossier de DA : accepté',
        null, 'chef', $q$update documents_divers set sous_dossier_id = '{SA}' where id = '{DOA}';$q$,
        $q$(select sous_dossier_id::text from documents_divers where id = '{DOA}')$q$, 'OK', 'd0cf0000-0000-4000-8000-0000000000a1'),
      (6, '2d. le chef insère un document de DA rangé dans un sous-dossier de DB : refusé',
        null, 'chef', $q$insert into documents_divers (id, dossier_id, storage_path, nom_fichier, categorie, sous_dossier_id) values ('{DON}', '{DA}', '{DA}/essai-docf-don.pdf', 'essai-docf-don.pdf', 'autre', '{SB}');$q$,
        null, '23514', document_hors),
      (7, '2e. le propriétaire, hors de la RLS : refusé de même',
        null, 'proprio', $q$update documents_divers set sous_dossier_id = '{SB}' where id = '{DOA}';$q$,
        null, '23514', document_hors),
      (8, '2f. un document rangé dans un sous-dossier de DA ne passe pas à DB avec lui',
        $q$update documents_divers set sous_dossier_id = '{SA}' where id = '{DOA}';$q$, 'chef',
        $q$update documents_divers set dossier_id = '{DB}' where id = '{DOA}';$q$,
        null, '23514', document_hors),
      -- 2g, 2h et 3g, SECU4-Q2 en base (`ni_piece_ni_document_ne_change_de_dossier`, préparée) : aucune ligne ne change plus de
      -- dossier. La garde du sous-dossier, qui tire avant, la laisse passer, puis la règle du dossier la refuse sous ses mots :
      -- les pas les attendent, et un refus de la garde du sous-dossier les ferait virer au rouge dans les deux états.
      (9, '2g. … il y passe avec un sous-dossier de DB, dans la même mise à jour : accepté (SECU4-Q2 en base : la garde le laisse passer, la règle du dossier le refuse)',
        $q$update documents_divers set sous_dossier_id = '{SA}' where id = '{DOA}';$q$, 'chef',
        $q$update documents_divers set dossier_id = '{DB}', sous_dossier_id = '{SB}', storage_path = '{DB}/essai-docf-doa.pdf' where id = '{DOA}';$q$,
        $q$(select dossier_id::text || ' ' || sous_dossier_id::text from documents_divers where id = '{DOA}')$q$,
        case when depot then '23514' else 'OK' end,
        case when depot then document_reste else 'd0cf0000-0000-4000-8000-0000000000d2 d0cf0000-0000-4000-8000-0000000000a3' end),
      (10, '2h. … ou sans sous-dossier : accepté (SECU4-Q2 en base : refusé de même)',
        $q$update documents_divers set sous_dossier_id = '{SA}' where id = '{DOA}';$q$, 'chef',
        $q$update documents_divers set dossier_id = '{DB}', sous_dossier_id = null, storage_path = '{DB}/essai-docf-doa.pdf' where id = '{DOA}';$q$,
        $q$(select dossier_id::text || ' ' || coalesce(sous_dossier_id::text, 'nul') from documents_divers where id = '{DOA}')$q$,
        case when depot then '23514' else 'OK' end,
        case when depot then document_reste else 'd0cf0000-0000-4000-8000-0000000000d2 nul' end),
      (11, '2i. le client d''essai dépose un document dans son dossier, rangé dans un sous-dossier de son dossier : accepté',
        null, 'client', $q$insert into documents_divers (id, dossier_id, storage_path, nom_fichier, categorie, sous_dossier_id) values ('{DON}', '{DC}', '{DC}/essai-docf-don.pdf', 'essai-docf-don.pdf', 'autre', '{SC}');$q$,
        $q$(select sous_dossier_id::text from documents_divers where id = '{DON}')$q$, 'OK', 'd0cf0000-0000-4000-8000-0000000000a4'),
      (12, '2j. … rangé dans un sous-dossier d''un autre dossier : refusé sous les mots de la base, comme un identifiant inconnu',
        null, 'client', $q$insert into documents_divers (id, dossier_id, storage_path, nom_fichier, categorie, sous_dossier_id) values ('{DON}', '{DC}', '{DC}/essai-docf-don.pdf', 'essai-docf-don.pdf', 'autre', '{SA}');$q$,
        null, '23514', document_hors),
      (13, '2k. … rangé dans un sous-dossier inconnu : les mêmes mots',
        null, 'client', $q$insert into documents_divers (id, dossier_id, storage_path, nom_fichier, categorie, sous_dossier_id) values ('{DON}', '{DC}', '{DC}/essai-docf-don.pdf', 'essai-docf-don.pdf', 'autre', '{X}');$q$,
        null, '23514', document_hors),
      (14, '3. le chef range la pièce de DA dans un sous-dossier de DB : refusé',
        null, 'chef', $q$update pieces set sous_dossier_id = '{SB}' where id = '{PIA}';$q$,
        null, '23514', piece_hors),
      (15, '3b. … dans un sous-dossier inconnu : refusé sous les mêmes mots, avant la clé étrangère',
        null, 'chef', $q$update pieces set sous_dossier_id = '{X}' where id = '{PIA}';$q$,
        null, '23514', piece_hors),
      (16, '3c. … dans un sous-dossier de DA : accepté',
        null, 'chef', $q$update pieces set sous_dossier_id = '{SA}' where id = '{PIA}';$q$,
        $q$(select sous_dossier_id::text from pieces where id = '{PIA}')$q$, 'OK', 'd0cf0000-0000-4000-8000-0000000000a1'),
      (17, '3d. le chef insère une pièce de DA rangée dans un sous-dossier de DB : refusé',
        null, 'chef', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, storage_hash, type_piece, statut, date_piece, montant_ht, montant_tva, montant_ttc, sous_dossier_id) values ('{PIN}', '{DA}', '{DA}/essai-docf-pin.pdf', 'essai-docf-pin.pdf', repeat('b', 64), 'achat', 'a_valider', '{DP}', 100, 20, 120, '{SB}');$q$,
        null, '23514', piece_hors),
      (18, '3e. le propriétaire, hors de la RLS : refusé de même',
        null, 'proprio', $q$update pieces set sous_dossier_id = '{SB}' where id = '{PIA}';$q$,
        null, '23514', piece_hors),
      (19, '3f. une pièce rangée dans un sous-dossier de DA ne passe pas à DB avec lui',
        $q$update pieces set sous_dossier_id = '{SA}' where id = '{PIA}';$q$, 'chef',
        $q$update pieces set dossier_id = '{DB}' where id = '{PIA}';$q$,
        null, '23514', piece_hors),
      (20, '3g. … elle y passe avec un sous-dossier de DB, dans la même mise à jour : accepté (SECU4-Q2 en base : la garde la laisse passer, la règle du dossier la refuse)',
        $q$update pieces set sous_dossier_id = '{SA}' where id = '{PIA}';$q$, 'chef',
        $q$update pieces set dossier_id = '{DB}', sous_dossier_id = '{SB}', storage_path = '{DB}/essai-docf-pia.pdf' where id = '{PIA}';$q$,
        $q$(select dossier_id::text || ' ' || sous_dossier_id::text from pieces where id = '{PIA}')$q$,
        case when depot then '23514' else 'OK' end,
        case when depot then piece_reste else 'd0cf0000-0000-4000-8000-0000000000d2 d0cf0000-0000-4000-8000-0000000000a3' end),
      (21, '3h. le nul que la clé étrangère écrit à la suppression d''un sous-dossier : la garde ne le juge pas',
        $q$update pieces set sous_dossier_id = '{SA}' where id = '{PIA}';$q$, 'chef',
        $q$update pieces set sous_dossier_id = null where id = '{PIA}';$q$,
        $q$(select coalesce(sous_dossier_id::text, 'nul') from pieces where id = '{PIA}')$q$, 'OK', 'nul'),
      (22, '4. un sous-dossier qui range un document ne change pas de dossier',
        $q$update documents_divers set sous_dossier_id = '{SA}' where id = '{DOA}';$q$, 'chef',
        $q$update sous_dossiers set dossier_id = '{DB}' where id = '{SA}';$q$,
        null, '23514', occupe),
      (23, '4b. … ni un sous-dossier qui range une pièce',
        $q$update pieces set sous_dossier_id = '{SA}' where id = '{PIA}';$q$, 'chef',
        $q$update sous_dossiers set dossier_id = '{DB}' where id = '{SA}';$q$,
        null, '23514', occupe),
      (24, '4c. le propriétaire, hors de la RLS : refusé de même',
        $q$update documents_divers set sous_dossier_id = '{SA}' where id = '{DOA}';$q$, 'proprio',
        $q$update sous_dossiers set dossier_id = '{DB}' where id = '{SA}';$q$,
        null, '23514', occupe),
      (25, '4d. un sous-dossier vide change de dossier, comme hier',
        null, 'chef', $q$update sous_dossiers set dossier_id = '{DB}' where id = '{SV}';$q$,
        $q$(select dossier_id::text from sous_dossiers where id = '{SV}')$q$, 'OK', 'd0cf0000-0000-4000-8000-0000000000d2'),
      (26, '4e. un sous-dossier occupé se renomme',
        $q$update documents_divers set sous_dossier_id = '{SA}' where id = '{DOA}';$q$, 'chef',
        $q$update sous_dossiers set nom = 'ESSAI DOCFQ1B SA RENOMME' where id = '{SA}';$q$,
        $q$(select nom from sous_dossiers where id = '{SA}')$q$, 'OK', 'ESSAI DOCFQ1B SA RENOMME')
    ) as v(rang, etape, pose, qui, geste, relu, code, attendu) order by rang
    loop
      v_code := 'OK';
      v_msg := null;
      v_obs := null;
      begin
        v_textes := array[e.pose, e.geste, e.relu, e.attendu];
        for i in 1 .. 4 loop
          if v_textes[i] is null then continue; end if;
          v_textes[i] := replace(replace(replace(replace(replace(v_textes[i], '{DA}', da), '{DB}', db), '{DC}', dc), '{SA}', sa), '{SV}', sv);
          v_textes[i] := replace(replace(replace(replace(replace(v_textes[i], '{SB}', sb), '{SC}', sc), '{DOA}', doa), '{DON}', don), '{PIA}', pia);
          v_textes[i] := replace(replace(replace(v_textes[i], '{PIN}', pin), '{X}', inconnu), '{DP}', date_p::text);
        end loop;
        if v_textes[1] is not null then
          execute 'set local role authenticated';
          perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
          execute v_textes[1];
          reset role;
          perform set_config('request.jwt.claims', '', true);
        end if;
        begin
          if v_textes[2] is not null then
            if e.qui in ('chef', 'client') then
              execute 'set local role authenticated';
              perform set_config('request.jwt.claims', json_build_object('sub', case when e.qui = 'chef' then chef else client end,
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

  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni leurs sous-dossiers, documents et pièces, ni le sous-dossier du dossier du client d''essai',
    'ok', not exists (select 1 from dossiers where id in (da::uuid, db::uuid))
      and not exists (select 1 from sous_dossiers where id in (sa::uuid, sv::uuid, sb::uuid, sc::uuid))
      and not exists (select 1 from documents_divers where id in (doa::uuid, don::uuid))
      and not exists (select 1 from pieces where id in (pia::uuid, pin::uuid)),
    'observe', 'relu');
  perform set_config('essai.sous_dossier_dans_son_dossier', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.sous_dossier_dans_son_dossier')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
