-- LA COPIE DES FICHIERS SUR UN SUPPORT DU CABINET (lignes 20.65 et 44, INAL6 ; la migration `copies_des_fichiers`,
-- PRÉPARÉE le 12/11/2026, supabase/preparees/). Le récit : HISTORIQUE.md, « 12/11/2026 — LA COPIE DES FICHIERS SUR UN
-- SUPPORT DU CABINET (LIGNES 20.65 ET 44, INAL6) ». À rejouer par `execute_sql` après toute migration qui touche
-- `copies_des_fichiers`, `enregistrer_copie_des_fichiers`, `admin_du_cabinet`, `est_chef_du_cabinet` ou `dossiers`.
--
-- Ce qui se prouve ici : qui enregistre une copie (le chef du cabinet seul ; ni un membre de l'équipe qui n'est pas chef, ni
-- le client d'un dossier du cabinet, ni l'anonyme) et qui la lit (l'équipe, chef ou non ; ni le client, ni l'anonyme) ;
-- chaque refus de la fonction sous ses mots (les comptes, les empreintes, la couverture de tous les dossiers) ; aucune
-- écriture directe (insertion, mise à jour, suppression) ; le catalogue.
--
-- Le jeu : le cabinet du dossier `test`, le chef d'essai, le client d'essai (rattaché à l'équipe comme comptable le temps
-- d'une étape). Chaque étape se joue dans sa sous-transaction et s'y ANNULE ; le jeu s'annule à la fin, et « rien n'est
-- resté » relit l'écart seul. Les verdicts voyagent dans un réglage LOCAL (`essai.copies_des_fichiers`) : le fichier se joue
-- d'un seul appel, ne crée ni table ni fonction, ne contient aucune suppression ni mise à jour sans `where`, et ne rend rien
-- qui dépende d'une ligne hors de son cabinet (aucun compte de dossiers n'est dit). Sans la migration, une ligne EN ATTENTE.
do $essai$
declare
  chef constant uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  h1 constant text := repeat('a', 64);
  h2 constant text := repeat('b', 64);
  n_dossiers integer;
  avant bigint;
  v_obs text;
  v_id uuid;
  verdicts jsonb := '[]'::jsonb;
begin
  if to_regclass('public.copies_des_fichiers') is null then
    perform set_config('essai.copies_des_fichiers', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', 'CF. EN ATTENTE de la migration copies_des_fichiers', 'ok', true, 'observe', 'table absente'))::text, true);
    return;
  end if;
  select count(*) into avant from copies_des_fichiers where cabinet_id = cabinet;
  select count(*) into n_dossiers from dossiers where cabinet_id = cabinet;
  begin
    -- 1. Le chef enregistre une copie de tous les dossiers ; il la relit, à son nom.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      v_id := enregistrer_copie_des_fichiers(cabinet, n_dossiers, 10, 7, 1, 1, 12345, array_fill(h1, array[n_dossiers + 1]));
      select format('%s %s %s', count(*), bool_and(faite_par = chef), bool_and(nb_ecarts = 1 and nb_manquants = 1))
        into v_obs from copies_des_fichiers where id = v_id;
      reset role;
      verdicts := verdicts || jsonb_build_object('rang', 1, 'etape', '1. le chef enregistre une copie de tous les dossiers et la relit, à son nom',
        'ok', v_obs = '1 t t', 'observe', v_obs);
      raise exception 'ANNULATION_ETAPE';
    exception when others then
      reset role;
      if sqlerrm <> 'ANNULATION_ETAPE' then
        verdicts := verdicts || jsonb_build_object('rang', 1, 'etape', '1. le chef enregistre une copie', 'ok', false, 'observe', sqlstate || ' ' || sqlerrm);
      end if;
    end;

    -- 2. Un membre de l'équipe qui n'est pas chef lit la copie, ne l'enregistre pas.
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      set local role authenticated;
      v_id := enregistrer_copie_des_fichiers(cabinet, n_dossiers, 0, 0, 0, 0, 0, array_fill(h2, array[n_dossiers]));
      reset role;
      insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable');
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      select count(*)::text into v_obs from copies_des_fichiers where id = v_id;
      begin
        perform enregistrer_copie_des_fichiers(cabinet, n_dossiers, 0, 0, 0, 0, 0, array_fill(h2, array[n_dossiers]));
        v_obs := v_obs || ' | ACCEPTÉ';
      exception when others then v_obs := v_obs || ' | ' || sqlstate || ' ' || sqlerrm;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('rang', 2, 'etape', '2. un membre de l''équipe qui n''est pas chef lit la copie (le contrôle positif), ne l''enregistre pas',
        'ok', v_obs = '1 | 42501 Seul le chef du cabinet enregistre une copie des fichiers.', 'observe', v_obs);
      raise exception 'ANNULATION_ETAPE';
    exception when others then
      reset role;
      if sqlerrm <> 'ANNULATION_ETAPE' then
        verdicts := verdicts || jsonb_build_object('rang', 2, 'etape', '2. le membre de l''équipe', 'ok', false, 'observe', sqlstate || ' ' || sqlerrm);
      end if;
    end;

    -- 3. Le client d'un dossier du cabinet ne lit rien, n'enregistre rien ; l'anonyme non plus.
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      set local role authenticated;
      perform enregistrer_copie_des_fichiers(cabinet, n_dossiers, 0, 0, 0, 0, 0, array_fill(h2, array[n_dossiers]));
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      select count(*)::text into v_obs from copies_des_fichiers;
      begin
        perform enregistrer_copie_des_fichiers(cabinet, n_dossiers, 0, 0, 0, 0, 0, array_fill(h2, array[n_dossiers]));
        v_obs := v_obs || ' | ACCEPTÉ';
      exception when others then v_obs := v_obs || ' | ' || sqlstate || ' ' || sqlerrm;
      end;
      reset role;
      set local role anon;
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      begin
        v_obs := v_obs || ' | anon lit ' || (select count(*) from copies_des_fichiers);
      exception when others then v_obs := v_obs || ' | anon lit ' || sqlstate;
      end;
      begin
        perform enregistrer_copie_des_fichiers(cabinet, n_dossiers, 0, 0, 0, 0, 0, array_fill(h2, array[n_dossiers]));
        v_obs := v_obs || ' | anon ACCEPTÉ';
      exception when others then v_obs := v_obs || ' | anon ' || sqlstate;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('rang', 3, 'etape', '3. le client d''un dossier du cabinet ne lit ni n''enregistre une copie ; l''anonyme non plus',
        'ok', v_obs in ('0 | 42501 Seul le chef du cabinet enregistre une copie des fichiers. | anon lit 0 | anon 42501',
                        '0 | 42501 Seul le chef du cabinet enregistre une copie des fichiers. | anon lit 42501 | anon 42501'),
        'observe', v_obs);
      raise exception 'ANNULATION_ETAPE';
    exception when others then
      reset role;
      if sqlerrm <> 'ANNULATION_ETAPE' then
        verdicts := verdicts || jsonb_build_object('rang', 3, 'etape', '3. le client et l''anonyme', 'ok', false, 'observe', sqlstate || ' ' || sqlerrm);
      end if;
    end;

    -- 4. Les refus du chef, sous leurs mots : un dossier de moins, des comptes illisibles, une empreinte illisible, trop peu
    --    de manifestes, un cabinet nul.
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      set local role authenticated;
      v_obs := '';
      begin
        perform enregistrer_copie_des_fichiers(cabinet, n_dossiers + 1, 0, 0, 0, 0, 0, array_fill(h1, array[n_dossiers + 1]));
        v_obs := v_obs || 'couverture ACCEPTÉE';
      exception when others then
        v_obs := v_obs || sqlstate || (case when sqlerrm like 'La copie porte % dossier(s), le cabinet en a % : elle ne les couvre pas tous. La refaire.' then ' mots' else ' ' || sqlerrm end);
      end;
      begin
        perform enregistrer_copie_des_fichiers(cabinet, n_dossiers, 2, 2, 1, 0, 0, array_fill(h1, array[n_dossiers]));
        v_obs := v_obs || ' | comptes ACCEPTÉS';
      exception when others then v_obs := v_obs || ' | ' || sqlstate || ' ' || sqlerrm;
      end;
      begin
        perform enregistrer_copie_des_fichiers(cabinet, n_dossiers, 0, 0, 0, 0, 0, array_fill(upper(h1), array[n_dossiers]));
        v_obs := v_obs || ' | empreinte ACCEPTÉE';
      exception when others then v_obs := v_obs || ' | ' || sqlstate || ' ' || sqlerrm;
      end;
      begin
        perform enregistrer_copie_des_fichiers(cabinet, n_dossiers, 0, 0, 0, 0, 0, array_fill(h1, array[n_dossiers - 1]));
        v_obs := v_obs || ' | manifestes ACCEPTÉS';
      exception when others then v_obs := v_obs || ' | ' || sqlstate;
      end;
      begin
        perform enregistrer_copie_des_fichiers(null, n_dossiers, 0, 0, 0, 0, 0, array_fill(h1, array[n_dossiers]));
        v_obs := v_obs || ' | cabinet nul ACCEPTÉ';
      exception when others then v_obs := v_obs || ' | ' || sqlstate;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('rang', 4, 'etape', '4. les refus du chef : un dossier de plus que le cabinet, des comptes, une empreinte et des manifestes illisibles, un cabinet nul',
        'ok', v_obs = '23514 mots | 22023 Les comptes de la copie sont illisibles. | 22023 Les empreintes des manifestes de la copie sont illisibles. | 22023 | 42501',
        'observe', v_obs);
      raise exception 'ANNULATION_ETAPE';
    exception when others then
      reset role;
      if sqlerrm <> 'ANNULATION_ETAPE' then
        verdicts := verdicts || jsonb_build_object('rang', 4, 'etape', '4. les refus', 'ok', false, 'observe', sqlstate || ' ' || sqlerrm);
      end if;
    end;

    -- 5. Aucune écriture directe, même du chef : insertion refusée, mise à jour et suppression sans effet.
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      set local role authenticated;
      v_id := enregistrer_copie_des_fichiers(cabinet, n_dossiers, 0, 0, 0, 0, 0, array_fill(h1, array[n_dossiers]));
      begin
        insert into copies_des_fichiers (cabinet_id, faite_par, nb_dossiers, nb_fichiers, nb_verifies, nb_ecarts, nb_manquants, octets, empreintes_des_manifestes)
        values (cabinet, chef, 1, 0, 0, 0, 0, 0, array[h1]);
        v_obs := 'insertion ACCEPTÉE';
      exception when others then v_obs := 'insertion ' || sqlstate;
      end;
      with t as (update copies_des_fichiers set nb_ecarts = 0 where id = v_id returning 1) select v_obs || ' | réécrites ' || count(*) into v_obs from t;
      with t as (delete from copies_des_fichiers where id = v_id returning 1) select v_obs || ' | retirées ' || count(*) into v_obs from t;
      reset role;
      verdicts := verdicts || jsonb_build_object('rang', 5, 'etape', '5. aucune écriture directe, même du chef : insertion refusée, mise à jour et suppression sans effet',
        'ok', v_obs = 'insertion 42501 | réécrites 0 | retirées 0', 'observe', v_obs);
      raise exception 'ANNULATION_ETAPE';
    exception when others then
      reset role;
      if sqlerrm <> 'ANNULATION_ETAPE' then
        verdicts := verdicts || jsonb_build_object('rang', 5, 'etape', '5. les écritures directes', 'ok', false, 'observe', sqlstate || ' ' || sqlerrm);
      end if;
    end;

    -- 6. Le catalogue : la fonction en `security definer`, hors de portée de l'anonyme ; la RLS active et une seule policy,
    --    en lecture, à authenticated, `admin_du_cabinet` (la policy restrictive `deux_facteurs` mise à part).
    select format('%s %s %s %s %s', p.prosecdef, has_function_privilege('anon', p.oid, 'execute'),
                  has_function_privilege('authenticated', p.oid, 'execute'),
                  (select c.relrowsecurity from pg_class c where c.oid = 'public.copies_des_fichiers'::regclass),
                  (select string_agg(pp.policyname || ':' || pp.cmd || ':' || array_to_string(pp.roles, ',') || ':' || pp.qual, ',')
                     from pg_policies pp where pp.schemaname = 'public' and pp.tablename = 'copies_des_fichiers'
                      and not (pp.policyname = 'deux_facteurs' and pp.permissive = 'RESTRICTIVE')))
      into v_obs from pg_proc p
     where p.oid = 'public.enregistrer_copie_des_fichiers(uuid, integer, integer, integer, integer, integer, bigint, text[])'::regprocedure;
    verdicts := verdicts || jsonb_build_object('rang', 6, 'etape', '6. le catalogue : security definer, l''anonyme sans exécution ; la RLS active, une policy de lecture à l''équipe du cabinet',
      'ok', v_obs = 't f t t copies_des_fichiers_lecture:SELECT:authenticated:admin_du_cabinet(cabinet_id)', 'observe', v_obs);
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    reset role;
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;
  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni une copie (l''écart seul), ni le compte d''essai dans l''équipe',
    'ok', (select count(*) from copies_des_fichiers where cabinet_id = cabinet) = avant
      and not exists (select 1 from cabinet_admins where user_id = client),
    'observe', 'relu');
  perform set_config('essai.copies_des_fichiers', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.copies_des_fichiers')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
