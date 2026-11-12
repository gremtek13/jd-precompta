-- LE CHEMIN D'UN FICHIER DANS SON DOSSIER (CFCS-Q1, ligne 44 ; la migration `chemin_dans_son_dossier`, PRÉPARÉE le
-- 12/11/2026, supabase/preparees/). Le récit : HISTORIQUE.md, « 12/11/2026 — CFCS-Q1 : LE CHEMIN D'UN FICHIER DANS SON
-- DOSSIER, EN BASE (PRÉPARÉE, PAS APPLIQUÉE) ». SUR UNE RÉPLIQUE SEULEMENT (il insère des pièces et des documents, puis les
-- annule) ; à rejouer après toute migration qui touche `pieces`, `documents_divers`, leurs policies ou leurs contraintes.
--
-- Ce qui se prouve ici : le client d'un dossier insère une pièce et un document sous un chemin de SON dossier, jamais sous
-- celui d'un autre dossier du cabinet (23514, la contrainte nommée), ni sous un chemin que l'adresse d'un fichier
-- réécrirait (segment vide, « . », « .. », barre oblique inverse, « %2e », tabulation, saut de ligne, « ? », « # », le
-- dossier en majuscules) ; le cabinet ne pose pas une version lisible hors du dossier, ni ne déplace un chemin par une mise à
-- jour ; la restauration du super-administrateur réinsère les chemins d'origine, sous toutes les formes que l'application
-- compose ; le catalogue (trois contraintes, validées).
--
-- Le jeu : le client d'essai et son dossier (`ac538d93…`), le dossier `test` (`001c7ed7…`) du même cabinet, le chef
-- d'essai (aussi super-administrateur de la réplique). Chaque étape se joue dans sa sous-transaction et s'y ANNULE ; le jeu
-- s'annule à la fin, et « rien n'est resté » relit l'écart seul. Les verdicts voyagent dans un réglage LOCAL
-- (`essai.chemins_dans_leur_dossier`) : le fichier se joue d'un seul appel, ne crée ni table ni fonction. Sans la
-- migration, une ligne EN ATTENTE.
do $essai$
declare
  client constant uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef constant uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  p constant text := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  a constant text := '001c7ed7-c23b-4590-901e-693489f8af24';
  -- Les chemins qu'aucune ligne du dossier P ne doit porter : un autre dossier, et tout ce que l'adresse réécrirait.
  fautifs constant text[] := array[
    a || '/1731400000000-facture.pdf',
    p, p || '/', p || '//x.pdf', '/' || p || '/x.pdf',
    p || '/./x.pdf', p || '/../' || a || '/x.pdf', p || '/x/..', p || '/.',
    p || '/..' || chr(92) || a || '/x.pdf',
    p || '/%2e%2e/' || a || '/x.pdf', p || '/.%2E/' || a || '/x.pdf',
    p || '/.' || chr(9) || './' || a || '/x.pdf', p || '/x' || chr(10) || '.pdf',
    p || '/x.pdf?' || a, p || '/x.pdf#' || a,
    upper(p) || '/x.pdf'];
  -- Les formes que l'application compose (lib/depot.ts, Cotisations, superpdp-sync, la version lisible), et des noms que le
  -- stockage admet : la restauration les réinsère tels quels.
  legitimes constant text[] := array[
    p || '/1731400000000-facture.pdf', p || '/documents/1731400000000-regul.pdf', p || '/superpdp-123.txt',
    p || '/Facture (1).pdf', p || '/a...b.pdf', p || '/.cache.pdf'];
  avant_p bigint;
  avant_a bigint;
  avant_dp bigint;
  avant_da bigint;
  v_chemin text;
  v_n integer;
  v_bons integer;
  v_obs text;
  v_id uuid;
  verdicts jsonb := '[]'::jsonb;
begin
  if (select count(*) from pg_constraint c
       where c.conname in ('pieces_storage_path_dans_son_dossier', 'pieces_lisible_path_dans_son_dossier',
                           'documents_divers_storage_path_dans_son_dossier')) = 0 then
    perform set_config('essai.chemins_dans_leur_dossier', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', 'CD. EN ATTENTE de la migration chemin_dans_son_dossier', 'ok', true, 'observe', 'contraintes absentes'))::text, true);
    return;
  end if;
  select count(*) into avant_p from pieces where dossier_id = p::uuid;
  select count(*) into avant_a from pieces where dossier_id = a::uuid;
  select count(*) into avant_dp from documents_divers where dossier_id = p::uuid;
  select count(*) into avant_da from documents_divers where dossier_id = a::uuid;
  begin
    -- 1. Le client insère une pièce de son dossier, sous un chemin de son dossier : acceptée.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      insert into pieces (dossier_id, uploaded_by, source, storage_path, nom_fichier, statut)
      values (p::uuid, client, 'upload', p || '/1731400000000-facture.pdf', 'facture.pdf', 'a_valider') returning id into v_id;
      reset role;
      verdicts := verdicts || jsonb_build_object('rang', 1, 'etape', '1. le client insère une pièce de son dossier sous un chemin de son dossier : acceptée',
        'ok', v_id is not null, 'observe', 'insérée');
      raise exception 'ANNULATION_ETAPE';
    exception when others then
      reset role;
      if sqlerrm <> 'ANNULATION_ETAPE' then
        verdicts := verdicts || jsonb_build_object('rang', 1, 'etape', '1. le client insère une pièce de son dossier', 'ok', false, 'observe', sqlstate || ' ' || sqlerrm);
      end if;
    end;

    -- 2. Le client insère une pièce de son dossier sous le chemin d'un fichier d'un autre dossier du cabinet : 23514.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      insert into pieces (dossier_id, uploaded_by, source, storage_path, nom_fichier, statut)
      values (p::uuid, client, 'upload', a || '/1731400000000-facture.pdf', 'facture.pdf', 'a_valider');
      reset role;
      verdicts := verdicts || jsonb_build_object('rang', 2, 'etape', '2. le client ne nomme pas le fichier d''un autre dossier', 'ok', false, 'observe', 'insérée');
      raise exception 'ANNULATION_ETAPE';
    exception when others then
      reset role;
      if sqlerrm <> 'ANNULATION_ETAPE' then
        verdicts := verdicts || jsonb_build_object('rang', 2, 'etape', '2. le client ne nomme pas le fichier d''un autre dossier (23514, pieces_storage_path_dans_son_dossier)',
          'ok', sqlstate = '23514' and sqlerrm like '%pieces_storage_path_dans_son_dossier%', 'observe', sqlstate || ' ' || sqlerrm);
      end if;
    end;

    -- 3. Chaque chemin fautif, une pièce puis un document du client, chacun dans sa sous-transaction : 23514, la contrainte
    --    de la table nommée. Le compte rend « refusés pour leur raison / essayés ».
    v_n := 0;
    v_bons := 0;
    foreach v_chemin in array fautifs loop
      begin
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
        insert into pieces (dossier_id, uploaded_by, source, storage_path, nom_fichier, statut)
        values (p::uuid, client, 'upload', v_chemin, 'x.pdf', 'a_valider');
        reset role;
        v_n := v_n + 1;
        raise exception 'ANNULATION_ETAPE';
      exception when others then
        reset role;
        if sqlerrm <> 'ANNULATION_ETAPE' then
          v_n := v_n + 1;
          if sqlstate = '23514' and sqlerrm like '%pieces_storage_path_dans_son_dossier%' then v_bons := v_bons + 1; end if;
        end if;
      end;
      begin
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
        insert into documents_divers (dossier_id, storage_path, nom_fichier, categorie)
        values (p::uuid, v_chemin, 'x.pdf', 'autre');
        reset role;
        v_n := v_n + 1;
        raise exception 'ANNULATION_ETAPE';
      exception when others then
        reset role;
        if sqlerrm <> 'ANNULATION_ETAPE' then
          v_n := v_n + 1;
          if sqlstate = '23514' and sqlerrm like '%documents_divers_storage_path_dans_son_dossier%' then v_bons := v_bons + 1; end if;
        end if;
      end;
    end loop;
    verdicts := verdicts || jsonb_build_object('rang', 3, 'etape', '3. aucun chemin fautif (autre dossier, segment vide, « . », « .. », barre inverse, « %2e », tabulation, saut de ligne, « ? », « # », majuscules) : chaque pièce et chaque document du client refusés en 23514, leur contrainte nommée',
      'ok', v_bons = v_n and v_n = 2 * cardinality(fautifs), 'observe', format('%s/%s', v_bons, v_n));

    -- 4. Le client dépose un document sous un chemin de son dossier : accepté.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      insert into documents_divers (dossier_id, storage_path, nom_fichier, categorie)
      values (p::uuid, p || '/1731400000000-releve.pdf', 'releve.pdf', 'autre') returning id into v_id;
      reset role;
      verdicts := verdicts || jsonb_build_object('rang', 4, 'etape', '4. le client dépose un document sous un chemin de son dossier : accepté',
        'ok', v_id is not null, 'observe', 'inséré');
      raise exception 'ANNULATION_ETAPE';
    exception when others then
      reset role;
      if sqlerrm <> 'ANNULATION_ETAPE' then
        verdicts := verdicts || jsonb_build_object('rang', 4, 'etape', '4. le client dépose un document', 'ok', false, 'observe', sqlstate || ' ' || sqlerrm);
      end if;
    end;

    -- 5. Le cabinet ne pose pas une version lisible hors du dossier (23514) ; dans le dossier, ou nulle, elle passe.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      begin
        insert into pieces (dossier_id, source, storage_path, lisible_path, nom_fichier, statut)
        values (p::uuid, 'upload', p || '/1731400000000-f.xml', a || '/1731400000000-f-lisible.pdf', 'f.xml', 'a_valider');
        v_obs := 'insérée';
      exception when others then
        v_obs := sqlstate || ' ' || sqlerrm;
      end;
      insert into pieces (dossier_id, source, storage_path, lisible_path, nom_fichier, statut)
      values (p::uuid, 'upload', p || '/1731400000001-f.xml', p || '/1731400000001-f-lisible.pdf', 'f.xml', 'a_valider'),
             (p::uuid, 'upload', p || '/1731400000002-f.xml', null, 'f.xml', 'a_valider');
      reset role;
      verdicts := verdicts || jsonb_build_object('rang', 5, 'etape', '5. le cabinet ne pose pas une version lisible hors du dossier (23514, pieces_lisible_path_dans_son_dossier) ; dans le dossier, ou nulle, elle passe',
        'ok', v_obs like '23514 %pieces_lisible_path_dans_son_dossier%', 'observe', v_obs);
      raise exception 'ANNULATION_ETAPE';
    exception when others then
      reset role;
      if sqlerrm <> 'ANNULATION_ETAPE' then
        verdicts := verdicts || jsonb_build_object('rang', 5, 'etape', '5. la version lisible', 'ok', false, 'observe', sqlstate || ' ' || sqlerrm);
      end if;
    end;

    -- 6. Une mise à jour du cabinet ne déplace pas le chemin d'une pièce ni d'un document hors du dossier (23514).
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      insert into pieces (dossier_id, source, storage_path, nom_fichier, statut)
      values (p::uuid, 'upload', p || '/1731400000003-g.pdf', 'g.pdf', 'a_valider') returning id into v_id;
      begin
        update pieces set storage_path = a || '/1731400000003-g.pdf' where id = v_id;
        v_obs := 'pièce déplacée';
      exception when others then
        v_obs := sqlstate || ' ' || sqlerrm;
      end;
      insert into documents_divers (dossier_id, storage_path, nom_fichier, categorie)
      values (p::uuid, p || '/documents/1731400000003-h.pdf', 'h.pdf', 'autre') returning id into v_id;
      begin
        update documents_divers set storage_path = p || '/documents/..' || chr(92) || '..' || chr(92) || a || '/h.pdf' where id = v_id;
        v_obs := v_obs || ' | document déplacé';
      exception when others then
        v_obs := v_obs || ' | ' || sqlstate || ' ' || sqlerrm;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('rang', 6, 'etape', '6. une mise à jour ne déplace ni le chemin d''une pièce ni celui d''un document hors du dossier (23514)',
        'ok', v_obs like '23514 %pieces_storage_path_dans_son_dossier% | 23514 %documents_divers_storage_path_dans_son_dossier%', 'observe', v_obs);
      raise exception 'ANNULATION_ETAPE';
    exception when others then
      reset role;
      if sqlerrm <> 'ANNULATION_ETAPE' then
        verdicts := verdicts || jsonb_build_object('rang', 6, 'etape', '6. une mise à jour', 'ok', false, 'observe', sqlstate || ' ' || sqlerrm);
      end if;
    end;

    -- 7. La restauration du super-administrateur réinsère les chemins d'origine, sous chaque forme que l'application compose
    --    (identifiant et instant d'origine, une version lisible, un document) : acceptée.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      v_n := 0;
      foreach v_chemin in array legitimes loop
        insert into pieces (id, dossier_id, uploaded_by, source, storage_path, lisible_path, nom_fichier, statut, created_at)
        values (gen_random_uuid(), p::uuid, null, 'email', v_chemin,
                case when v_chemin like '%-facture.pdf' then p || '/1731400000000-facture-lisible.pdf' end,
                'restauree.pdf', 'a_valider', '2026-01-15 10:00:00+01');
        insert into documents_divers (id, dossier_id, storage_path, nom_fichier, categorie)
        values (gen_random_uuid(), p::uuid, v_chemin, 'restaure.pdf', 'autre');
        v_n := v_n + 2;
      end loop;
      reset role;
      verdicts := verdicts || jsonb_build_object('rang', 7, 'etape', '7. la restauration du super-administrateur réinsère les chemins d''origine, sous chaque forme que l''application compose : acceptée',
        'ok', v_n = 2 * cardinality(legitimes), 'observe', format('%s lignes', v_n));
      raise exception 'ANNULATION_ETAPE';
    exception when others then
      reset role;
      if sqlerrm <> 'ANNULATION_ETAPE' then
        verdicts := verdicts || jsonb_build_object('rang', 7, 'etape', '7. la restauration', 'ok', false, 'observe', sqlstate || ' ' || sqlerrm);
      end if;
    end;

    -- 8. Le catalogue : trois contraintes CHECK, validées, la règle entière dans chacune, commentées.
    select format('%s %s %s %s', count(*), bool_and(c.contype = 'c' and c.convalidated),
                  bool_and(pg_get_constraintdef(c.oid) like '%split_part(%dossier_id)::text%' and pg_get_constraintdef(c.oid) like '%[.][.]?%'
                           and pg_get_constraintdef(c.oid) like '%[%?#[:cntrl:]]%' and pg_get_constraintdef(c.oid) like '%chr(92)%'),
                  bool_and(obj_description(c.oid, 'pg_constraint') like '%CFCS-Q1%'))
      into v_obs from pg_constraint c
     where c.conname in ('pieces_storage_path_dans_son_dossier', 'pieces_lisible_path_dans_son_dossier',
                         'documents_divers_storage_path_dans_son_dossier');
    verdicts := verdicts || jsonb_build_object('rang', 8, 'etape', '8. le catalogue : trois contraintes CHECK, validées, la règle entière, commentées',
      'ok', v_obs = '3 t t t', 'observe', v_obs);
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    reset role;
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;
  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni une pièce ni un document des deux dossiers (l''écart seul)',
    'ok', (select count(*) from pieces where dossier_id = p::uuid) = avant_p and (select count(*) from pieces where dossier_id = a::uuid) = avant_a
      and (select count(*) from documents_divers where dossier_id = p::uuid) = avant_dp
      and (select count(*) from documents_divers where dossier_id = a::uuid) = avant_da,
    'observe', 'relu');
  perform set_config('essai.chemins_dans_leur_dossier', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.chemins_dans_leur_dossier')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
