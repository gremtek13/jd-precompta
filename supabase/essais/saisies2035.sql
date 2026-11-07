-- LA 2035 : LES SAISIES DU CABINET (étapes 2035S3 à S5 ; la migration `saisies_2035`, PRÉPARÉE le 07/11/2026,
-- supabase/preparees/). Le récit : HISTORIQUE.md, « 07/11/2026 — LA 2035 : LES SAISIES DU CABINET (2035S3 À S5) (PRÉPARÉE,
-- PAS APPLIQUÉE) ». À rejouer par `execute_sql` après toute migration qui touche `saisies_2035`, ses contraintes,
-- `garder_saisie_2035_validee`, `enregistrer_saisies_2035`, `admin_du_dossier` ou la frontière de la validation.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - le catalogue : les colonnes, les contraintes au texte près, la RLS et sa seule policy (le cabinet du dossier, à
--     authenticated), le gel avant toute écriture, les droits d'exécution (la garde à personne, l'écriture à authenticated
--     seul, aux droits de l'appelant) ;
--   - l'écriture : trois cases d'un coup, relues ; une valeur changée depuis sa lecture refuse le tout (40001), la case
--     écrite avant elle comprise ; un code hors de la liste, DE avant 2025, une note annexe hors de CC et CL, sur une case
--     nulle ou mal bornée, des centimes négatifs ou décimaux, une seconde ligne pour la même case se refusent ; zéro vide
--     une case sans la retirer ;
--   - les droits : le client d'essai, qui n'a pas ce dossier, n'écrit ni ne lit rien ; l'anonyme n'exécute pas la fonction ;
--   - le gel : l'exercice 2025 validé ne change plus (la fonction, une mise à jour, une insertion en 2024, que la
--     validation de 2025 fige), une mise à jour qui ne change rien passe, 2026 s'écrit encore.
-- Un retrait direct d'une saisie d'un exercice validé suit la même branche du gel ; il ne se joue pas ici (aucune
-- suppression dans un essai de la production) : l'écran n'en fait aucun, une case se vide par zéro.
-- Tout se joue dans un dossier jetable, et tout s'annule à la fin. Sans la migration, une ligne le dit, et rien ne s'écrit.

do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  verdicts jsonb := '[]'::jsonb;
  e record;
  v_obs text;
  v_code text;
  v_msg text;
begin
  if to_regclass('public.saisies_2035') is null then
    perform set_config('essai.saisies2035', jsonb_build_array(jsonb_build_object('rang', 1,
      'etape', '0. EN ATTENTE de la migration saisies_2035', 'ok', true,
      'observe', 'la table absente : rien ne s''écrit'))::text, true);
    return;
  end if;

  begin
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values
      ('5e203500-0000-4000-8107-000000000001', 'ESSAI SAISIES 2035', cabinet, 'tresorerie', '455000');

    for e in select * from (values
      (1, 'proprietaire', '1. le catalogue : huit colonnes, la note annexe seule nulle', $q$select string_agg(a.attname || ':'
  || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' order by a.attnum)
  from pg_attribute a where a.attrelid = 'public.saisies_2035'::regclass and a.attnum > 0 and not a.attisdropped$q$,
        'OK', 'id:uuid:true,dossier_id:uuid:true,annee:integer:true,code:text:true,centimes:bigint:true,note_annexe:text:false,created_at:timestamp with time zone:true,updated_at:timestamp with time zone:true'),
      (2, 'proprietaire', '1b. … ses contraintes, au texte près (la clé, le dossier en cascade, cinq contraintes, l''unicité TOTALE)', $q$select count(*) || ' ' || md5(string_agg(c.conname || ' ' || pg_get_constraintdef(c.oid), ' ; ' order by c.conname collate "C"))
  from pg_constraint c where c.conrelid = 'public.saisies_2035'::regclass$q$, 'OK', '8 5f02bdbddf6bc97e874d1bad9ed08c50'),
      (3, 'proprietaire', '1c. … la RLS active et sa seule policy, le cabinet du dossier, à authenticated', $q$select (select c.relrowsecurity::text from pg_class c where c.oid = 'public.saisies_2035'::regclass) || ' ' || string_agg(p.policyname || ':' || p.cmd || ':'
  || p.roles::text || ':' || coalesce(p.qual, '-') || ':' || coalesce(p.with_check, '-'), ' ; ' order by p.policyname)
  from pg_policies p where p.schemaname = 'public' and p.tablename = 'saisies_2035' and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')$q$,
        'OK', 'true saisies_2035_cabinet:ALL:{authenticated}:admin_du_dossier(dossier_id):admin_du_dossier(dossier_id)'),
      (4, 'proprietaire', '1d. … le gel, avant toute insertion, mise à jour ou suppression, ligne par ligne', $q$select string_agg(t.tgname || ':' || t.tgtype || ':' || t.tgfoid::regprocedure::text, ',')
  from pg_trigger t where t.tgrelid = 'public.saisies_2035'::regclass and not t.tgisinternal$q$,
        'OK', 'saisies_2035_figees_par_la_validation:31:garder_saisie_2035_validee()'),
      (5, 'proprietaire', '1e. … les droits : la garde à personne, l''écriture à authenticated seul, aux droits de l''appelant', $q$select has_function_privilege('anon', 'public.enregistrer_saisies_2035(uuid, integer, jsonb, jsonb)', 'execute')
  || '|' || has_function_privilege('authenticated', 'public.enregistrer_saisies_2035(uuid, integer, jsonb, jsonb)', 'execute')
  || '|' || has_function_privilege('authenticated', 'public.garder_saisie_2035_validee()', 'execute')
  || '|' || has_function_privilege('anon', 'public.garder_saisie_2035_validee()', 'execute')
  || '|' || (select p.prosecdef from pg_proc p where p.oid = 'public.enregistrer_saisies_2035(uuid, integer, jsonb, jsonb)'::regprocedure)
  || '|' || (select p.prosecdef from pg_proc p where p.oid = 'public.garder_saisie_2035_validee()'::regprocedure)$q$, 'OK', 'false|true|false|false|false|true'),
      (6, 'chef', '2. trois cases de 2025 d''un coup : CC et sa note annexe, CL, CS', $q$select enregistrer_saisies_2035('5e203500-0000-4000-8107-000000000001', 2025,
  '{"CC": {"centimes": 0, "note_annexe": null}, "CL": {"centimes": 0, "note_annexe": null}, "CS": {"centimes": 0, "note_annexe": null}}',
  '{"CC": {"centimes": 120000, "note_annexe": "Quote-part personnelle du loyer"}, "CL": {"centimes": 50000, "note_annexe": null}, "CS": {"centimes": 20000, "note_annexe": null}}')$q$,
        'OK', '3'),
      (7, 'chef', '2b. … relues', $q$select string_agg(code || ':' || centimes || ':' || coalesce(note_annexe, '-'), ',' order by code collate "C")
  from saisies_2035 where dossier_id = '5e203500-0000-4000-8107-000000000001'$q$, 'OK', 'CC:120000:Quote-part personnelle du loyer,CL:50000:-,CS:20000:-'),
      (8, 'chef', '3. une valeur changée depuis sa lecture se refuse', $q$select enregistrer_saisies_2035('5e203500-0000-4000-8107-000000000001', 2025,
  '{"CC": {"centimes": 0, "note_annexe": null}}', '{"CC": {"centimes": 1, "note_annexe": null}}')$q$,
        '40001', 'La case CC de l''exercice 2025 a changé depuis sa lecture : relis les saisies avant de les enregistrer.'),
      (9, 'chef', '3b. … et refuse le tout : CC, juste et écrite d''abord, avec CL, lue fausse', $q$select enregistrer_saisies_2035('5e203500-0000-4000-8107-000000000001', 2025,
  '{"CC": {"centimes": 120000, "note_annexe": "Quote-part personnelle du loyer"}, "CL": {"centimes": 0, "note_annexe": null}}',
  '{"CC": {"centimes": 130000, "note_annexe": "Quote-part personnelle du loyer"}, "CL": {"centimes": 60000, "note_annexe": null}}')$q$,
        '40001', 'La case CL de l''exercice 2025 a changé depuis sa lecture%'),
      (10, 'chef', '3c. … CC est restée telle qu''elle était', $q$select centimes from saisies_2035 where dossier_id = '5e203500-0000-4000-8107-000000000001' and annee = 2025 and code = 'CC'$q$,
        'OK', '120000'),
      (11, 'chef', '4. un code hors de la liste se refuse', $q$select enregistrer_saisies_2035('5e203500-0000-4000-8107-000000000001', 2025,
  '{"BK": {"centimes": 0, "note_annexe": null}}', '{"BK": {"centimes": 100, "note_annexe": null}}')$q$, '23514', '%saisies_2035_code%'),
      (12, 'chef', '4b. … DE avant 2025, l''exercice qui n''a pas de cadre 8, aussi', $q$select enregistrer_saisies_2035('5e203500-0000-4000-8107-000000000001', 2024,
  '{"DE": {"centimes": 0, "note_annexe": null}}', '{"DE": {"centimes": 100, "note_annexe": null}}')$q$, '23514', '%saisies_2035_cadre_8_depuis_2025%'),
      (13, 'chef', '4c. … une note annexe sur DE', $q$select enregistrer_saisies_2035('5e203500-0000-4000-8107-000000000001', 2025,
  '{"DE": {"centimes": 0, "note_annexe": null}}', '{"DE": {"centimes": 100, "note_annexe": "Intéressement"}}')$q$, '23514', '%saisies_2035_note_annexe%'),
      (14, 'chef', '4d. … une note annexe sur une case vidée', $q$select enregistrer_saisies_2035('5e203500-0000-4000-8107-000000000001', 2025,
  '{"CL": {"centimes": 50000, "note_annexe": null}}', '{"CL": {"centimes": 0, "note_annexe": "Exonération ZFRR"}}')$q$, '23514', '%saisies_2035_note_annexe%'),
      (15, 'chef', '4e. … une note annexe qui commence par une espace', $q$select enregistrer_saisies_2035('5e203500-0000-4000-8107-000000000001', 2025,
  '{"CL": {"centimes": 50000, "note_annexe": null}}', '{"CL": {"centimes": 50000, "note_annexe": " ZFRR"}}')$q$, '23514', '%saisies_2035_note_annexe%'),
      (16, 'chef', '4f. … des centimes négatifs', $q$select enregistrer_saisies_2035('5e203500-0000-4000-8107-000000000001', 2025,
  '{"CL": {"centimes": 50000, "note_annexe": null}}', '{"CL": {"centimes": -1, "note_annexe": null}}')$q$, '22023', 'La case CL part mal formée%'),
      (17, 'chef', '4g. … des centimes décimaux', $q$select enregistrer_saisies_2035('5e203500-0000-4000-8107-000000000001', 2025,
  '{"CL": {"centimes": 50000, "note_annexe": null}}', '{"CL": {"centimes": 12.5, "note_annexe": null}}')$q$, '22023', 'La case CL part mal formée%'),
      (18, 'chef', '4h. … une case sans sa valeur lue', $q$select enregistrer_saisies_2035('5e203500-0000-4000-8107-000000000001', 2025,
  '{}', '{"CL": {"centimes": 100, "note_annexe": null}}')$q$, '22023', 'La case CL part mal formée%'),
      (19, 'chef', '4i. … et, en direct, des centimes négatifs, puis une seconde ligne pour la même case', $q$insert into saisies_2035 (dossier_id, annee, code, centimes)
  values ('5e203500-0000-4000-8107-000000000001', 2026, 'CT', -1)$q$, '23514', '%saisies_2035_centimes%'),
      (20, 'chef', '4j. … une seconde ligne pour CC en 2025', $q$insert into saisies_2035 (dossier_id, annee, code, centimes)
  values ('5e203500-0000-4000-8107-000000000001', 2025, 'CC', 100)$q$, '23505', '%saisies_2035_une_par_case%'),
      (21, 'chef', '5. zéro vide une case, sans la retirer (la ligne reste : 7d la compte, 7g la relit à zéro)', $q$select enregistrer_saisies_2035('5e203500-0000-4000-8107-000000000001', 2025,
  '{"CS": {"centimes": 20000, "note_annexe": null}}', '{"CS": {"centimes": 0, "note_annexe": null}}')$q$, 'OK', '1'),
      (22, 'client', '6. le client d''essai, qui n''a pas ce dossier, n''écrit pas par la fonction', $q$select enregistrer_saisies_2035('5e203500-0000-4000-8107-000000000001', 2026,
  '{"CC": {"centimes": 0, "note_annexe": null}}', '{"CC": {"centimes": 100, "note_annexe": null}}')$q$,
        '42501', 'Les saisies de la 2035 ne s''écrivent que par le cabinet du dossier.'),
      (23, 'client', '6b. … ne lit rien', $q$select count(*) from saisies_2035 where dossier_id = '5e203500-0000-4000-8107-000000000001'$q$, 'OK', '0'),
      (24, 'client', '6c. … n''insère pas en direct', $q$insert into saisies_2035 (dossier_id, annee, code, centimes)
  values ('5e203500-0000-4000-8107-000000000001', 2026, 'CC', 100)$q$, '42501', '%row-level security%'),
      (25, 'client', '6d. … ne réécrit rien', $q$with u as (update saisies_2035 set centimes = 1 where dossier_id = '5e203500-0000-4000-8107-000000000001' returning 1)
  select count(*) from u$q$, 'OK', '0'),
      (26, 'anon', '6e. l''anonyme n''exécute pas la fonction', $q$select enregistrer_saisies_2035('5e203500-0000-4000-8107-000000000001', 2026,
  '{"CC": {"centimes": 0, "note_annexe": null}}', '{"CC": {"centimes": 100, "note_annexe": null}}')$q$, '42501', '%permission denied%'),
      (27, 'chef', '7. l''exercice 2025 se valide', $q$select valider_exercice('5e203500-0000-4000-8107-000000000001', 2025, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb) is not null$q$, 'OK', ''),
      (28, 'chef', '7b. ses saisies ne changent plus par la fonction', $q$select enregistrer_saisies_2035('5e203500-0000-4000-8107-000000000001', 2025,
  '{"CL": {"centimes": 50000, "note_annexe": null}}', '{"CL": {"centimes": 60000, "note_annexe": null}}')$q$,
        '23514', 'L''exercice 2025 est validé : ses saisies de la 2035 ne changent plus.'),
      (29, 'chef', '7c. … ni en direct', $q$update saisies_2035 set centimes = 1 where dossier_id = '5e203500-0000-4000-8107-000000000001' and annee = 2025 and code = 'CC'$q$,
        '23514', 'L''exercice 2025 est validé : ses saisies de la 2035 ne changent plus.'),
      (30, 'chef', '7d. … une mise à jour qui ne change rien passe', $q$with u as (update saisies_2035 set centimes = centimes
  where dossier_id = '5e203500-0000-4000-8107-000000000001' and annee = 2025 returning 1) select count(*) from u$q$, 'OK', '3'),
      (31, 'chef', '7e. … une saisie de 2024, que la validation de 2025 fige, ne s''ajoute plus', $q$select enregistrer_saisies_2035('5e203500-0000-4000-8107-000000000001', 2024,
  '{"CC": {"centimes": 0, "note_annexe": null}}', '{"CC": {"centimes": 100, "note_annexe": null}}')$q$,
        '23514', 'L''exercice 2024 est figé par la validation de l''exercice 2025 : ses saisies de la 2035 ne changent plus.'),
      (32, 'chef', '7f. 2026 s''écrit encore : DB, le reste du renvoi (25)', $q$select enregistrer_saisies_2035('5e203500-0000-4000-8107-000000000001', 2026,
  '{"DB": {"centimes": 0, "note_annexe": null}}', '{"DB": {"centimes": 45000, "note_annexe": null}}')$q$, 'OK', '1'),
      (33, 'chef', '7g. … et 2025 est restée telle qu''elle a été validée', $q$select string_agg(annee || code || ':' || centimes, ',' order by annee, code collate "C")
  from saisies_2035 where dossier_id = '5e203500-0000-4000-8107-000000000001'$q$, 'OK', '2025CC:120000,2025CL:50000,2025CS:0,2026DB:45000')
    ) as t(rang, profil, etape, requete, code, attendu) order by rang loop
      v_obs := null;
      v_code := 'OK';
      v_msg := '';
      begin
        if e.profil = 'anon' then
          execute 'set local role anon';
          perform set_config('request.jwt.claims', '{"role":"anon"}', true);
        elsif e.profil <> 'proprietaire' then
          execute 'set local role authenticated';
          perform set_config('request.jwt.claims',
            json_build_object('sub', case e.profil when 'chef' then chef else client end, 'role', 'authenticated')::text, true);
        end if;
        execute e.requete into v_obs;
        set constraints all immediate;
        set constraints all deferred;
        reset role;
        v_msg := coalesce(v_obs, '');
      exception when others then
        reset role;
        v_code := sqlstate;
        v_msg := sqlerrm;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      verdicts := verdicts || jsonb_build_object('rang', e.rang, 'etape', e.etape,
        'ok', v_code = e.code and (e.attendu = '' or v_msg like e.attendu), 'observe', v_code || ' ' || v_msg);
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;
  perform set_config('essai.saisies2035', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.saisies2035')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
