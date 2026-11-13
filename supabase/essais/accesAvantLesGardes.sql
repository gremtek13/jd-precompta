-- ESSAI DE LA PORTE D'ACCÈS DEVANT LES GARDES (ligne 43, vu en passant par PC7Q2-Q1 ; la migration PRÉPARÉE
-- supabase/preparees/20261113120000_acces_avant_les_gardes.sql). À rejouer après toute migration qui pose ou change un
-- déclencheur BEFORE d'une table de public, une policy d'écriture d'une des 32 tables de la porte, `row_security_active`,
-- ou les droits de `pg_policy`.
--
-- Sans la migration — la dernière des deux lignes d'historique `acces_avant_les_gardes` et `retour_acces_avant_les_gardes`
-- n'est pas la première —, l'essai se dit EN ATTENTE et ne joue rien. Avec elle, chaque étape se joue dans un bloc annulé,
-- sous un profil : « anon » (la clé publique, sans session) ; « etranger » (un compte connecté rattaché à rien) ;
-- « client » (le compte client du jeu, un accès sans droit sur le dossier jetable DA) ; « membre » (le membre d'équipe du
-- jeu, assigné à DA le temps de l'essai : le cabinet) ; « super » (le super-administrateur) ; « postgres » (sans rôle) ;
-- « service » (le rôle des Edge Functions). Rien ne reste : DA, son plan, sa facture, son mouvement, l'accès et
-- l'assignation partent avec le bloc global.
--
-- CE QUE L'ESSAI ÉTABLIT. Les étapes 1 à 7 : la garde des catégories ne dit plus rien à l'anonyme, à l'étranger ni au
-- client (42501, le refus de la RLS), et dit encore au cabinet ses deux raisons (b) et (c). 9 à 11 : la garde des lignes
-- d'une facture ne dit plus le numéro d'une facture validée qu'au cabinet. 12 : un membre qui déplace un mouvement vers un
-- dossier qu'il n'administre pas bute sur la porte (la mise à jour). 13 à 17 : ce que la policy admet passe comme hier —
-- le dépôt d'une pièce par le client, la commune du super-administrateur — et ce qui contourne la RLS (le propriétaire, le
-- rôle des Edge Functions, une fonction `security definer`) rencontre les gardes comme hier. 30 à 34 : le catalogue — la
-- porte, `security invoker` au chemin vide ; la première des déclencheurs BEFORE de chacune des 32 tables ; toute table qui
-- porte une garde `security definer` sur l'insertion ou la mise à jour la porte, `dossiers` seule exceptée, pour sa raison
-- (un déclencheur y remplit `cabinet_id`, que sa policy lit) ; aucun déclencheur qui tire après elle ne modifie une colonne
-- que ses policies lisent ; et l'anonyme comme l'étranger reçoivent sur les 32 tables le refus de la porte, jamais celui
-- d'une garde. 35 : le relevé de l'étape 33, appliqué à des corps plantés, voit chaque forme d'affectation que PL/pgSQL
-- accepte, et ne prend pas une comparaison pour une affectation.
--
-- Mutations de la migration qui doivent virer au rouge (jouées sur la réplique, le 13/11/2026) : la porte nommée après les
-- gardes ; la porte `security definer` ; sans le saut hors de la RLS ; sur l'insertion seule ; absente de facture_lignes ;
-- un autre code que 42501. Le relevé de l'étape 33 d'avant (`new.col :=` en début de ligne, en minuscules) ne voyait aucun
-- des quatre corps plantés de l'étape 35 (relu sur la réplique, le 13/11/2026).

do $essai$
declare
  super constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  membre constant text := '3e3b0000-0000-4000-8000-000000000001';
  etranger constant text := '5e5e5e5e-0000-4000-8000-0000000000a1';
  da constant text := 'ac000000-0000-4000-8000-0000000000d1';
  dl constant text := 'd0551e20-0000-4000-8000-000000000003';
  fv constant text := 'ac000000-0000-4000-8000-0000000000f1';
  l1 constant text := 'ac000000-0000-4000-8000-0000000000b1';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  porte constant boolean := coalesce((select m.name = 'acces_avant_les_gardes' from supabase_migrations.schema_migrations m
    where m.name in ('acces_avant_les_gardes', 'retour_acces_avant_les_gardes') order by m.version desc limit 1), false);
  facture constant text := $p$alter table factures_emises disable trigger user; insert into factures_emises (id, dossier_id, tiers_nom, statut, numero, validated_at) values ('{FV}', '{DA}', 'Essai porte', 'validee', 'ESSAI-PORTE-1', now()); alter table factures_emises enable trigger user$p$;
  mouvement constant text := $p$insert into lignes_bancaires (id, dossier_id, date, libelle, montant) values ('{L1}', '{DA}', '2026-02-01', 'ESSAI PORTE', -1)$p$;
  refus_categories constant text := 'new row violates row-level security policy for table "categories"';
  e record; v_code text; v_obs text; v_requete text; v_table text; v_profil text; v_bons integer; v_vus integer; v_autres text; v_plantes text;
  verdicts jsonb := '[]'::jsonb;
begin
  if not porte then
    perform set_config('essai.acces_avant_les_gardes', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration acces_avant_les_gardes', 'ok', true,
      'observe', 'absente, ou rendue par son retour : l''essai se joue dès qu''elle y est'))::text, true);
    return;
  end if;
  if exists (select 1 from super_admins where user_id in (client::uuid, membre::uuid))
     or exists (select 1 from cabinet_admins where user_id = client::uuid)
     or exists (select 1 from memberships where user_id = membre::uuid)
     or not exists (select 1 from cabinet_admins where user_id = membre::uuid and cabinet_id = cabinet and role <> 'comptable_en_chef') then
    raise exception 'Le jeu a changé : le client est du cabinet, ou le membre n''est pas un simple membre du cabinet du dossier test ; l''essai ne prouverait rien.';
  end if;
  begin
    insert into dossiers (id, nom, cabinet_id) values (da::uuid, 'ESSAI PORTE DA', cabinet);
    insert into memberships (user_id, dossier_id, role) values (client::uuid, da::uuid, 'client');
    insert into dossier_assignations (user_id, dossier_id) values (membre::uuid, da::uuid);
    -- Le barème kilométrique du plan de DA déplacé au 625150, posé par le super-administrateur (la porte de la restauration).
    perform set_config('request.jwt.claims', json_build_object('sub', super, 'role', 'authenticated')::text, true);
    insert into plan_comptable_dossier (dossier_id, role, compte) values (da::uuid, 'indemnites_kilometriques', '625150');
    perform set_config('request.jwt.claims', '', true);

    -- {rang, étape, profil, préparation (sous postgres, ou nulle), requête, code attendu, ce qu'elle rend (« ~ » : le
    -- message le contient)}.
    for e in select * from (values
      (1, '1. (b) l''anonyme n''apprend plus le code d''une commune : le refus de la RLS', 'anon', null,
        $q$insert into categories (dossier_id, code, libelle) values ('{DA}', 'loyer', 'x') returning code$q$, '42501', refus_categories),
      (2, '2. (c) ni le compte du barème du plan d''un dossier', 'anon', null,
        $q$insert into categories (dossier_id, code, libelle, compte_comptable) values ('{DA}', 'essai_porte', 'x', '625150') returning code$q$, '42501', refus_categories),
      (3, '3. (c) l''étranger non plus', 'etranger', null,
        $q$insert into categories (dossier_id, code, libelle, compte_comptable) values ('{DA}', 'essai_porte', 'x', '625150') returning code$q$, '42501', refus_categories),
      (4, '4. (b) le client du dossier : la RLS d''abord', 'client', null,
        $q$insert into categories (dossier_id, code, libelle) values ('{DA}', 'loyer', 'x') returning code$q$, '42501', refus_categories),
      (5, '5. (c) le client n''apprend plus le barème de son propre plan, qu''il ne lit pas', 'client', null,
        $q$insert into categories (dossier_id, code, libelle, compte_comptable) values ('{DA}', 'essai_porte', 'x', '625150') returning code$q$, '42501', refus_categories),
      (6, '6. (b) le cabinet reçoit la raison', 'membre', null,
        $q$insert into categories (dossier_id, code, libelle) values ('{DA}', 'loyer', 'x') returning code$q$, '23514', '~Le code « loyer » est celui d''une catégorie commune'),
      (7, '7. (c) et celle du barème', 'membre', null,
        $q$insert into categories (dossier_id, code, libelle, compte_comptable) values ('{DA}', 'essai_porte', 'x', '625150') returning code$q$, '23514', '~(« 625150 »)'),
      (8, '8. le cabinet crée sa catégorie', 'membre', null,
        $q$insert into categories (dossier_id, code, libelle, compte_comptable) values ('{DA}', 'essai_porte', 'Essai porte', '606400') returning code$q$, 'OK', 'essai_porte'),
      (9, '9. l''anonyme n''apprend plus le numéro d''une facture validée', 'anon', '{FACTURE}',
        $q$insert into facture_lignes (facture_id, designation) values ('{FV}', 'x') returning designation$q$, '42501', 'new row violates row-level security policy for table "facture_lignes"'),
      (10, '10. l''étranger non plus', 'etranger', '{FACTURE}',
        $q$insert into facture_lignes (facture_id, designation) values ('{FV}', 'x') returning designation$q$, '42501', 'new row violates row-level security policy for table "facture_lignes"'),
      (11, '11. le cabinet reçoit la raison', 'membre', '{FACTURE}',
        $q$insert into facture_lignes (facture_id, designation) values ('{FV}', 'x') returning designation$q$, '23514', '~La facture ESSAI-PORTE-1 est validée'),
      (12, '12. la mise à jour : un membre ne déplace pas un mouvement vers un dossier qu''il n''administre pas, et aucune garde ne lit ce dossier', 'membre', '{MOUVEMENT}',
        $q$update lignes_bancaires set dossier_id = '{DL}' where id = '{L1}' returning id::text$q$, '42501', 'new row violates row-level security policy for table "lignes_bancaires"'),
      (13, '13. ce que la policy admet passe : le client dépose une pièce', 'client', null,
        $q$insert into pieces (dossier_id, storage_path, nom_fichier, type_piece, statut, source, uploaded_by) values ('{DA}', '{DA}/essai-porte.pdf', 'essai-porte.pdf', 'achat', 'a_valider', 'upload', '{CLIENT}') returning nom_fichier$q$, 'OK', 'essai-porte.pdf'),
      (14, '14. le super-administrateur pose une commune', 'super', null,
        $q$insert into categories (dossier_id, code, libelle, compte_comptable) values (null, 'essai_porte_commune', 'Essai porte', '606400') returning code$q$, 'OK', 'essai_porte_commune'),
      (15, '15. hors de la RLS, le propriétaire rencontre la garde comme hier', 'postgres', null,
        $q$insert into categories (dossier_id, code, libelle) values ('{DA}', 'loyer', 'x') returning code$q$, '23514', '~Le code « loyer » est celui d''une catégorie commune'),
      (16, '16. le rôle des Edge Functions aussi', 'service', null,
        $q$insert into categories (dossier_id, code, libelle) values ('{DA}', 'loyer', 'x') returning code$q$, '23514', '~Le code « loyer » est celui d''une catégorie commune'),
      (17, '17. une fonction security definer écrit comme hier : le cabinet règle le plan de DA', 'membre', null,
        $q$select regler_plan_du_dossier('{DA}', '[{"role": "indemnites_kilometriques", "compte": "625160"}]'::jsonb)::text$q$, 'OK', '~')
    ) as x(rang, etape, profil, preparation, requete, attendu, rend)
    loop
      v_code := 'OK'; v_obs := null;
      begin
        if e.preparation is not null then
          v_requete := replace(replace(e.preparation, '{FACTURE}', facture), '{MOUVEMENT}', mouvement);
          execute replace(replace(replace(v_requete, '{DA}', da), '{FV}', fv), '{L1}', l1);
        end if;
        if e.profil = 'anon' then
          execute 'set local role anon';
          perform set_config('request.jwt.claims', '{"role": "anon"}', true);
        elsif e.profil = 'service' then
          execute 'set local role service_role';
          perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
        elsif e.profil <> 'postgres' then
          execute 'set local role authenticated';
          perform set_config('request.jwt.claims', json_build_object('sub', case e.profil when 'super' then super when 'client' then client
            when 'membre' then membre else etranger end, 'role', 'authenticated')::text, true);
        end if;
        begin
          execute replace(replace(replace(replace(replace(e.requete, '{DA}', da), '{DL}', dl), '{FV}', fv), '{L1}', l1), '{CLIENT}', client) into v_obs;
        exception when others then
          v_code := sqlstate; v_obs := sqlerrm;
        end;
        reset role;
        perform set_config('request.jwt.claims', '', true);
        raise exception 'ANNULATION_ETAPE';
      exception when others then
        reset role;
        perform set_config('request.jwt.claims', '', true);
        if sqlerrm <> 'ANNULATION_ETAPE' then
          v_code := 'PREPARATION ' || sqlstate; v_obs := sqlerrm;
        end if;
      end;
      verdicts := verdicts || jsonb_build_object('rang', e.rang, 'etape', e.etape,
        'ok', v_code = e.attendu and case when left(e.rend, 1) = '~' then position(substr(e.rend, 2) in coalesce(v_obs, '')) > 0
                                          else coalesce(v_obs, '') = e.rend end,
        'observe', v_code || ' ' || coalesce(v_obs, ''));
    end loop;

    -- 30. La porte au catalogue.
    verdicts := verdicts || jsonb_build_object('rang', 30, 'etape', '30. la porte : security invoker, chemin vide, exécutable par aucun rôle de l''API',
      'ok', coalesce((select not p.prosecdef and p.proconfig = array['search_path=""'] and p.prorettype = 'trigger'::regtype
                       and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')
                  from pg_proc p where p.oid = to_regprocedure('public.acces_avant_les_gardes()')), false),
      'observe', 'relu au catalogue');
    -- 31. Sur chaque table qui la porte : BEFORE INSERT OR UPDATE FOR EACH ROW, active, et la première des BEFORE.
    select count(*), string_agg(c.relname, ', ' order by c.relname) filter (where not (t.tgtype = 23 and t.tgenabled = 'O'
             and t.tgname = (select min(u.tgname collate "C") from pg_trigger u where u.tgrelid = t.tgrelid and not u.tgisinternal and u.tgtype & 2 = 2)))
      into v_vus, v_autres
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where t.tgname = '_acces_avant_les_gardes' and t.tgfoid = to_regprocedure('public.acces_avant_les_gardes()');
    verdicts := verdicts || jsonb_build_object('rang', 31, 'etape', '31. la porte sur 32 tables, BEFORE INSERT OR UPDATE FOR EACH ROW, active, la première de chacune',
      'ok', v_vus = 32 and v_autres is null, 'observe', v_vus || ' tables ; hors de la règle : ' || coalesce(v_autres, 'aucune'));
    -- 32. Le relevé part de TOUT : chaque table qui porte une garde security definer sur l'insertion ou la mise à jour porte la
    --     porte, `dossiers` seule exceptée ; un plancher distingue « aucune faute » d'« aveugle ».
    select count(*), string_agg(r.relname, ', ' order by r.relname) filter (where not r.porte and r.relname <> 'dossiers')
      into v_vus, v_autres
      from (select c.relname, exists (select 1 from pg_trigger d where d.tgrelid = c.oid and d.tgname = '_acces_avant_les_gardes') as porte
              from pg_class c where c.relnamespace = 'public'::regnamespace
               and exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
                            where t.tgrelid = c.oid and not t.tgisinternal and t.tgtype & 3 = 3 and t.tgtype & 20 <> 0
                              and p.prosecdef and t.tgname <> '_acces_avant_les_gardes')) r;
    verdicts := verdicts || jsonb_build_object('rang', 32, 'etape', '32. toute table à garde security definer sur l''insertion ou la mise à jour porte la porte, dossiers excepté (plancher : 33)',
      'ok', v_vus >= 33 and v_autres is null, 'observe', v_vus || ' tables ; sans la porte : ' || coalesce(v_autres, 'aucune'));
    -- 33. Aucun déclencheur qui tire après la porte ne modifie une colonne que les policies d'écriture lisent ; sur
    --     `dossiers`, la raison de l'exception : cabinet_id. Le relevé lit chaque corps sans tenir compte de la casse, à
    --     chaque début d'instruction (début du corps ou de ligne, « ; », then, else, loop, begin), l'affectation en « := »
    --     comme en « = », que PL/pgSQL accepte aussi ; une forme qu'il ne lit pas colonne par colonne — `into new`, la
    --     ligne entière remplacée (`new :=`), `#=`, `populate_record(new` — est une faute, quelle que soit la colonne.
    -- 35. Le même relevé, sur des corps plantés comme s'ils étaient ceux d'une garde de lignes_bancaires (dont la policy lit
    --     dossier_id) : il voit a à d, et ni e (une comparaison) ni f (une colonne qu'aucune policy ne lit).
    with corps as (
      select c.oid as relid, c.relname, p.prosrc as src, null::text as plante
        from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
       where c.relnamespace = 'public'::regnamespace and not t.tgisinternal and t.tgtype & 3 = 3 and t.tgtype & 20 <> 0
         and t.tgname <> '_acces_avant_les_gardes'
         and (c.relname = 'dossiers' or exists (select 1 from pg_trigger d where d.tgrelid = c.oid and d.tgname = '_acces_avant_les_gardes'))
      union all
      select 'public.lignes_bancaires'::regclass::oid, 'lignes_bancaires', x.src, x.plante
        from (values
          ('a. NEW en capitales, après then', $c$begin if true then NEW.dossier_id := null; end if; return new; end$c$),
          ('b. l''affectation en « = »', $c$begin
  new.dossier_id = null;
  return new;
end$c$),
          ('c. select … into new', $c$begin select d.id into new.dossier_id from public.dossiers d where d.id = new.dossier_id; return new; end$c$),
          ('d. la ligne entière remplacée', $c$begin new := jsonb_populate_record(new, '{}'); return new; end$c$),
          ('e. une comparaison, pas une affectation', $c$begin if new.dossier_id = old.dossier_id then return new; end if; return new; end$c$),
          ('f. une colonne qu''aucune policy ne lit', $c$begin new.libelle := upper(new.libelle); return new; end$c$)) as x(plante, src)),
    fautes as (
      select k.relname, k.plante, a.attname::text as colonne
        from corps k
        cross join lateral regexp_matches(k.src, '(?:^|[;\n]|\mthen\M|\melse\M|\mloop\M|\mbegin\M)\s*new\s*\.\s*"?(\w+)"?\s*:?=', 'gi') as m(col)
        join pg_attribute a on a.attrelid = k.relid and a.attname = lower(m.col[1])
       where exists (select 1 from pg_depend d join pg_policy o on o.oid = d.objid
                      where d.classid = 'pg_policy'::regclass and d.refobjid = k.relid and d.refobjsubid = a.attnum and o.polcmd in ('a', 'w', '*'))
      union all
      select k.relname, k.plante, '(la ligne entière)'
        from corps k
       where k.src ~* '\minto\s+(strict\s+)?new\M|(?:^|[;\n]|\mthen\M|\melse\M|\mloop\M|\mbegin\M)\s*new\s*:?=|#=|populate_record(set)?\s*\(\s*new\M')
    select string_agg(distinct f.relname || '.' || f.colonne, ', ') filter (where f.plante is null and f.relname <> 'dossiers'),
           string_agg(distinct f.colonne, ', ') filter (where f.plante is null and f.relname = 'dossiers'),
           string_agg(distinct left(f.plante, 1), '' order by left(f.plante, 1)) filter (where f.plante is not null)
      into v_autres, v_obs, v_plantes
      from fautes f;
    verdicts := verdicts || jsonb_build_object('rang', 33, 'etape', '33. aucun déclencheur ne modifie après la porte une colonne lue par une policy d''écriture ; dossiers : cabinet_id, la raison de l''exception',
      'ok', v_autres is null and v_obs = 'cabinet_id', 'observe', 'tables de la porte : ' || coalesce(v_autres, 'aucune') || ' ; dossiers : ' || coalesce(v_obs, 'aucune'));
    verdicts := verdicts || jsonb_build_object('rang', 35, 'etape', '35. le relevé de l''étape 33 voit les quatre corps plantés qui modifient dossier_id (a à d), ni la comparaison (e) ni la colonne qu''aucune policy ne lit (f)',
      'ok', v_plantes = 'abcd', 'observe', 'corps vus : ' || coalesce(v_plantes, 'aucun'));
    -- 34. L'anonyme et l'étranger, sur chacune des 32 tables : le refus de la porte, jamais celui d'une garde.
    v_bons := 0; v_vus := 0; v_autres := null;
    for v_table in select c.relname from pg_trigger t join pg_class c on c.oid = t.tgrelid where t.tgname = '_acces_avant_les_gardes' order by 1 loop
      foreach v_profil in array array['anon', 'etranger'] loop
        v_vus := v_vus + 1;
        begin
          if v_profil = 'anon' then
            execute 'set local role anon';
            perform set_config('request.jwt.claims', '{"role": "anon"}', true);
          else
            execute 'set local role authenticated';
            perform set_config('request.jwt.claims', json_build_object('sub', etranger, 'role', 'authenticated')::text, true);
          end if;
          begin
            execute format('insert into public.%I default values', v_table);
            v_code := 'OK'; v_obs := '';
          exception when others then
            v_code := sqlstate; v_obs := sqlerrm;
          end;
          reset role;
          perform set_config('request.jwt.claims', '', true);
          raise exception 'ANNULATION_ETAPE';
        exception when others then
          reset role;
          perform set_config('request.jwt.claims', '', true);
        end;
        if v_code = '42501' and v_obs = format('new row violates row-level security policy for table "%s"', v_table) then
          v_bons := v_bons + 1;
        else
          v_autres := coalesce(v_autres || ' ; ', '') || v_table || '/' || v_profil || ' ' || v_code || ' ' || left(v_obs, 80);
        end if;
      end loop;
    end loop;
    verdicts := verdicts || jsonb_build_object('rang', 34, 'etape', '34. l''anonyme et l''étranger reçoivent sur les 32 tables le refus de la porte, jamais celui d''une garde',
      'ok', v_vus = 64 and v_bons = 64, 'observe', v_bons || ' sur ' || v_vus || coalesce(' ; autres : ' || v_autres, ''));
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni DA, ni son plan, sa facture, son mouvement, sa pièce, ni l''accès ni l''assignation ; aucune commune d''essai',
    'ok', not exists (select 1 from dossiers where id = da::uuid)
      and not exists (select 1 from factures_emises where id = fv::uuid)
      and not exists (select 1 from lignes_bancaires where id = l1::uuid)
      and not exists (select 1 from categories where code like 'essai_porte%')
      and not exists (select 1 from memberships where user_id = client::uuid and dossier_id = da::uuid)
      and not exists (select 1 from dossier_assignations where user_id = membre::uuid and dossier_id = da::uuid),
    'observe', 'relu');
  perform set_config('essai.acces_avant_les_gardes', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.acces_avant_les_gardes')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
