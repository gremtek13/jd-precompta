-- NI UNE PIÈCE NI UN DOCUMENT NE CHANGE DE DOSSIER (SECU4-Q2 ; la migration `ni_piece_ni_document_ne_change_de_dossier`,
-- préparée le 27/11/2026, PAS APPLIQUÉE : supabase/preparees/20261127230000_ni_piece_ni_document_ne_change_de_dossier.sql). Le
-- récit : HISTORIQUE.md, « 27/11/2026 — SECU4-Q2 ET MCBR2-Q2 ». À rejouer après toute migration qui touche
-- `garder_dossier_de_depot`, ou qui pose un déclencheur BEFORE sur `pieces` ou `documents_divers`. SANS LA MIGRATION (la garde
-- absente du catalogue), il se dit EN ATTENTE.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   1. LE CATALOGUE : la garde aux droits de l'appelant (elle ne lit rien), son chemin fixé, exécutable par aucun rôle de
--      session ; ses deux déclencheurs BEFORE UPDATE par ligne, sans liste de colonnes, sous leur condition ; chacun le DERNIER
--      des déclencheurs BEFORE de sa table ;
--   2. LE REFUS, pour tout auteur : une pièce que rien ne cite, puis un document, ne passent pas à l'autre dossier, avec leur
--      chemin — sous la session d'un membre de l'équipe assigné aux deux dossiers (il n'est pas super-administrateur), sous celle
--      du super-administrateur, et pour le propriétaire hors de la RLS ; l'upsert qui changerait le dossier non plus ;
--   3. CE QUI PASSE : une écriture qui renvoie son propre dossier (la fiche d'une pièce), l'upsert qui le garde, l'insertion
--      directe du super-administrateur (la restauration réinsère) ;
--   4. LE RANG : une pièce qu'un mouvement du relevé cite, et un document rangé dans un sous-dossier, se refusent sous les mots
--      de LEUR garde, qui tire avant la règle neuve — les mots d'hier.
--
-- Deux dossiers jetables du cabinet du dossier `test` (préfixe `5ec42000-0000-4000-8000`) : DA et DB, en trésorerie ; les pièces
-- PA et PC de DA ; les documents DOA et DOS de DA, DOS rangé dans le sous-dossier SA de DA ; le mouvement LA de DA ; le membre de
-- l'équipe du dossier `test` assigné aux deux le temps de l'essai. Chaque étape se joue dans sa sous-transaction et s'y ANNULE
-- (`ANNULATION_ETAPE`) : ce que le membre pose d'abord, puis le geste (du membre ou du super-administrateur sous la RLS, ou du
-- propriétaire), puis ce qu'on relit ; le jeu s'annule à la fin (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le relit.
-- Les verdicts voyagent dans un réglage LOCAL à la transaction (`essai.ni_piece_ni_document_ne_change_de_dossier`) : le fichier
-- se joue d'un seul appel, ne crée ni table ni fonction, ne contient aucune instruction de suppression, et ne rend rien qui
-- dépende d'une ligne hors de ses dossiers. Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`).
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  membre constant text := '3e3b0000-0000-4000-8000-000000000001';
  da constant text := '5ec42000-0000-4000-8000-0000000000d1';
  db constant text := '5ec42000-0000-4000-8000-0000000000d2';
  pa constant text := '5ec42000-0000-4000-8000-0000000000b1';
  pc constant text := '5ec42000-0000-4000-8000-0000000000b2';
  pn constant text := '5ec42000-0000-4000-8000-0000000000b3';
  doa constant text := '5ec42000-0000-4000-8000-0000000000c1';
  dos constant text := '5ec42000-0000-4000-8000-0000000000c2';
  sa constant text := '5ec42000-0000-4000-8000-0000000000a1';
  la constant text := '5ec42000-0000-4000-8000-0000000000e1';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  date_e constant date := make_date(extract(year from (now() at time zone 'Europe/Paris'))::integer, 1, 15);
  appliquee constant boolean := to_regprocedure('public.garder_dossier_de_depot()') is not null;
  piece_reste constant text := 'Une pièce reste dans le dossier où elle a été déposée : elle ne change pas de dossier.';
  document_reste constant text := 'Un document reste dans le dossier où il a été déposé : il ne change pas de dossier.';
  -- L'upsert d'une application : la pièce PA réécrite par son identifiant, son dossier et son chemin pris dans la proposition.
  upsert constant text := $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, storage_hash, type_piece, statut, date_piece,
      montant_ht, montant_tva, montant_ttc)
    values ('{PA}', '{VERS}', '{VERS}/essai-secu4q2-pa.pdf', 'essai-secu4q2-pa.pdf', repeat('1', 64), 'achat', 'a_valider', '{DE}', 10, 0, 10)
    on conflict (id) do update set dossier_id = excluded.dossier_id, storage_path = excluded.storage_path, tiers = 'ESSAI SECU4Q2 UPSERT';$q$;
  e record; v_code text; v_msg text; v_obs text; v_textes text[];
  verdicts jsonb := '[]'::jsonb;
begin
  if not appliquee then
    perform set_config('essai.ni_piece_ni_document_ne_change_de_dossier', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration ni_piece_ni_document_ne_change_de_dossier (SECU4-Q2)', 'ok', true,
      'observe', 'absente : une pièce ou un document que rien ne cite change encore de dossier ; l''essai se joue dès qu''elle y est'))::text, true);
    return;
  end if;
  begin
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values
      (da::uuid, 'ESSAI SECU4Q2 DA', cabinet, 'tresorerie', '455000'),
      (db::uuid, 'ESSAI SECU4Q2 DB', cabinet, 'tresorerie', '455000');
    insert into dossier_assignations (dossier_id, user_id) values (da::uuid, membre::uuid), (db::uuid, membre::uuid);
    insert into sous_dossiers (id, dossier_id, nom, ordre) values (sa::uuid, da::uuid, 'ESSAI SECU4Q2 SA', 1);
    insert into pieces (id, dossier_id, storage_path, nom_fichier, storage_hash, type_piece, statut, date_piece, montant_ht,
                        montant_tva, montant_ttc) values
      (pa::uuid, da::uuid, da || '/essai-secu4q2-pa.pdf', 'essai-secu4q2-pa.pdf', repeat('1', 64), 'achat', 'a_valider', date_e, 10, 0, 10),
      (pc::uuid, da::uuid, da || '/essai-secu4q2-pc.pdf', 'essai-secu4q2-pc.pdf', repeat('2', 64), 'achat', 'a_valider', date_e, 10, 0, 10);
    insert into documents_divers (id, dossier_id, storage_path, nom_fichier, categorie, sous_dossier_id) values
      (doa::uuid, da::uuid, da || '/essai-secu4q2-doa.pdf', 'essai-secu4q2-doa.pdf', 'autre', null),
      (dos::uuid, da::uuid, da || '/essai-secu4q2-dos.pdf', 'essai-secu4q2-dos.pdf', 'autre', sa::uuid);
    insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values
      (la::uuid, da::uuid, date_e, 'ESSAI SECU4Q2 MOUVEMENT', -10, 'non_rapprochee');

    -- Une étape : {rang, étape, ce que le membre pose d'abord, qui fait le geste (`membre` ou `super` sous la RLS, `proprio`
    -- hors d'elle), le geste, ce qu'on relit, le code attendu (`OK` : accepté) et ce qu'on relit, ou les mots du refus}.
    for e in select * from (values
      (1, '1. le catalogue : la garde aux droits de l''appelant, son chemin fixé, exécutable par aucun rôle de session ; ses deux déclencheurs BEFORE UPDATE par ligne',
        null, 'proprio', null,
        $q$(select p.prosecdef::text || ' ' || array_to_string(p.proconfig, ',') from pg_proc p where p.oid = 'public.garder_dossier_de_depot()'::regprocedure)
           || ' ' || has_function_privilege('authenticated', 'public.garder_dossier_de_depot()', 'execute')
           || ' ' || has_function_privilege('anon', 'public.garder_dossier_de_depot()', 'execute')
           || ' ' || has_function_privilege('service_role', 'public.garder_dossier_de_depot()', 'execute')
           || ' ' || (select string_agg(t.tgrelid::regclass::text || ':' || t.tgtype || ':' || t.tgenabled::text, ',' order by t.tgname collate "C")
                        from pg_trigger t where t.tgfoid = 'public.garder_dossier_de_depot()'::regprocedure and not t.tgisinternal)$q$,
        'OK', 'false search_path="" false false false documents_divers:19:O,pieces:19:O'),
      (2, '1b. leurs définitions : sans liste de colonnes, sous la condition que le dossier change',
        null, 'proprio', null,
        $q$(select string_agg(pg_get_triggerdef(t.oid), ' ; ' order by t.tgname collate "C") from pg_trigger t
             where t.tgfoid = 'public.garder_dossier_de_depot()'::regprocedure and not t.tgisinternal)$q$,
        'OK', 'CREATE TRIGGER documents_divers_vers_un_autre_dossier BEFORE UPDATE ON public.documents_divers FOR EACH ROW WHEN ((old.dossier_id IS DISTINCT FROM new.dossier_id)) EXECUTE FUNCTION garder_dossier_de_depot() ; '
          || 'CREATE TRIGGER pieces_vers_un_autre_dossier BEFORE UPDATE ON public.pieces FOR EACH ROW WHEN ((old.dossier_id IS DISTINCT FROM new.dossier_id)) EXECUTE FUNCTION garder_dossier_de_depot()'),
      (3, '1c. leur rang : chacun le dernier des déclencheurs BEFORE de sa table, après les gardes relation par relation',
        null, 'proprio', null,
        $q$(select string_agg(x.tgrelid::regclass::text || ':' || x.tgname, ',' order by x.tgrelid::regclass::text collate "C")
              from (select distinct on (t.tgrelid) t.tgrelid, t.tgname from pg_trigger t
                     where t.tgrelid in ('public.pieces'::regclass, 'public.documents_divers'::regclass)
                       and not t.tgisinternal and (t.tgtype & 2) = 2
                     order by t.tgrelid, t.tgname collate "C" desc) x)$q$,
        'OK', 'documents_divers:documents_divers_vers_un_autre_dossier,pieces:pieces_vers_un_autre_dossier'),
      (4, '2. le membre assigné aux deux dossiers passe à DB une pièce de DA que rien ne cite, avec son chemin : refusé',
        null, 'membre', $q$update pieces set dossier_id = '{DB}', storage_path = '{DB}/essai-secu4q2-pa.pdf' where id = '{PA}';$q$,
        null, '23514', piece_reste),
      (5, '2b. … le super-administrateur, sous la RLS : refusé de même',
        null, 'super', $q$update pieces set dossier_id = '{DB}', storage_path = '{DB}/essai-secu4q2-pa.pdf' where id = '{PA}';$q$,
        null, '23514', piece_reste),
      (6, '2c. … le propriétaire, hors de la RLS : refusé de même',
        null, 'proprio', $q$update pieces set dossier_id = '{DB}', storage_path = '{DB}/essai-secu4q2-pa.pdf' where id = '{PA}';$q$,
        null, '23514', piece_reste),
      (7, '2d. un document de DA que rien ne cite, avec son chemin, par le membre : refusé',
        null, 'membre', $q$update documents_divers set dossier_id = '{DB}', storage_path = '{DB}/essai-secu4q2-doa.pdf' where id = '{DOA}';$q$,
        null, '23514', document_reste),
      (8, '2e. … par le propriétaire : refusé de même',
        null, 'proprio', $q$update documents_divers set dossier_id = '{DB}', storage_path = '{DB}/essai-secu4q2-doa.pdf' where id = '{DOA}';$q$,
        null, '23514', document_reste),
      (9, '2f. l''upsert qui change le dossier de la pièce (la ligne en conflit passe par la mise à jour) : refusé',
        null, 'membre', replace(upsert, '{VERS}', '{DB}'),
        null, '23514', piece_reste),
      (10, '3. la fiche d''une pièce renvoie son propre dossier, avec un autre champ : accepté (le contrôle positif)',
        null, 'membre', $q$update pieces set dossier_id = '{DA}', tiers = 'ESSAI SECU4Q2 TIERS' where id = '{PA}';$q$,
        $q$(select dossier_id::text || ' ' || tiers from pieces where id = '{PA}')$q$, 'OK',
        '5ec42000-0000-4000-8000-0000000000d1 ESSAI SECU4Q2 TIERS'),
      (11, '3b. un document qui garde son dossier, sa catégorie changée : accepté',
        null, 'membre', $q$update documents_divers set dossier_id = dossier_id, categorie = 'autre' where id = '{DOA}';$q$,
        $q$(select dossier_id::text from documents_divers where id = '{DOA}')$q$, 'OK', '5ec42000-0000-4000-8000-0000000000d1'),
      (12, '3c. l''upsert qui garde le dossier : accepté',
        null, 'membre', replace(upsert, '{VERS}', '{DA}'),
        $q$(select dossier_id::text || ' ' || tiers from pieces where id = '{PA}')$q$, 'OK',
        '5ec42000-0000-4000-8000-0000000000d1 ESSAI SECU4Q2 UPSERT'),
      (13, '3d. le super-administrateur insère une pièce dans DB, comme la restauration la réinsère : accepté',
        null, 'super', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, storage_hash, type_piece, statut, date_piece,
             montant_ht, montant_tva, montant_ttc)
           values ('{PN}', '{DB}', '{DB}/essai-secu4q2-pn.pdf', 'essai-secu4q2-pn.pdf', repeat('3', 64), 'achat', 'a_valider', '{DE}', 10, 0, 10);$q$,
        $q$(select dossier_id::text from pieces where id = '{PN}')$q$, 'OK', '5ec42000-0000-4000-8000-0000000000d2'),
      (14, '4. une pièce qu''un mouvement de son dossier cite : refusée sous les mots de la garde des paiements, qui tire avant',
        $q$update lignes_bancaires set statut = 'rapprochee', piece_id = '{PC}' where id = '{LA}';$q$, 'membre',
        $q$update pieces set dossier_id = '{DB}', storage_path = '{DB}/essai-secu4q2-pc.pdf' where id = '{PC}';$q$,
        null, '23514', 'Cette pièce est citée par un mouvement du relevé, ou par la part d''un virement groupé, de son dossier : elle ne change pas de dossier.'),
      (15, '4b. un document rangé dans un sous-dossier de DA, passé à DB avec lui : refusé sous les mots de la garde du sous-dossier, qui tire avant',
        null, 'membre', $q$update documents_divers set dossier_id = '{DB}', storage_path = '{DB}/essai-secu4q2-dos.pdf' where id = '{DOS}';$q$,
        null, '23514', 'Le sous-dossier d''un document est un sous-dossier de son dossier.')
    ) as v(rang, etape, pose, qui, geste, relu, code, attendu) order by rang
    loop
      v_code := 'OK';
      v_msg := null;
      v_obs := null;
      begin
        v_textes := array[e.pose, e.geste, e.relu, e.attendu];
        for i in 1 .. 4 loop
          if v_textes[i] is null then continue; end if;
          v_textes[i] := replace(replace(replace(replace(replace(v_textes[i], '{DA}', da), '{DB}', db), '{PA}', pa), '{PC}', pc), '{PN}', pn);
          v_textes[i] := replace(replace(replace(replace(v_textes[i], '{DOA}', doa), '{DOS}', dos), '{LA}', la), '{DE}', date_e::text);
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

  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni leurs pièces, documents, sous-dossiers, mouvements, assignations',
    'ok', not exists (select 1 from dossiers where id in (da::uuid, db::uuid))
      and not exists (select 1 from pieces where id in (pa::uuid, pc::uuid, pn::uuid))
      and not exists (select 1 from documents_divers where id in (doa::uuid, dos::uuid))
      and not exists (select 1 from sous_dossiers where id = sa::uuid)
      and not exists (select 1 from lignes_bancaires where id = la::uuid)
      and not exists (select 1 from dossier_assignations where dossier_id in (da::uuid, db::uuid)),
    'observe', 'relu');
  perform set_config('essai.ni_piece_ni_document_ne_change_de_dossier', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.ni_piece_ni_document_ne_change_de_dossier')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
