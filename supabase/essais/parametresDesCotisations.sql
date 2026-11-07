-- LES PARAMÈTRES DES COTISATIONS : LE DÉBUT D'ACTIVITÉ, L'ACRE ET LE TAUX DENTISTE (ligne 27, TNS-Q1 et TNS-Q4 ; la
-- migration `parametres_des_cotisations`, PRÉPARÉE le 07/11/2026, supabase/preparees/). Le récit : HISTORIQUE.md,
-- « 07/11/2026 — LES PARAMÈTRES DES COTISATIONS : LE DÉBUT D'ACTIVITÉ, L'ACRE ET LE TAUX DENTISTE (TNS-Q1, TNS-Q4)
-- (PRÉPARÉE, PAS APPLIQUÉE) ». À rejouer par `execute_sql` après toute migration qui touche `debuts_d_activite`,
-- `parametres_des_cotisations`, leurs contraintes, `garder_parametres_des_cotisations_valides`,
-- `enregistrer_parametres_des_cotisations`, `admin_du_dossier` ou la frontière de la validation.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - le catalogue : les colonnes, les contraintes au texte près, la RLS et la seule policy de chaque table (le cabinet du
--     dossier, à authenticated), le gel des paramètres d'un exercice avant toute écriture (le début d'activité n'en a pas),
--     les droits d'exécution (la garde à personne, l'écriture à authenticated seul, aux droits de l'appelant) ;
--   - l'écriture : le début d'activité et l'ACRE d'un coup, relus ; une valeur changée depuis sa lecture refuse le tout
--     (40001) ; trois clés, ni plus ni moins, de leurs types, une date du calendrier ; un taux hors de 0 à 1 ou plus fin
--     que le centième, un exercice d'avant 2025, une seconde ligne se refusent ; ce qui ne change pas ne s'écrit pas ;
--   - les droits : le client d'essai, qui n'a pas ce dossier, n'écrit ni ne lit rien ; l'anonyme n'exécute pas la fonction ;
--   - le gel : l'exercice 2025 validé ne change plus ses paramètres (la fonction, une mise à jour directe), une mise à jour
--     qui ne change rien passe, le début d'activité se corrige encore (une donnée du dossier), 2026 s'écrit encore.
-- Un retrait direct des paramètres d'un exercice validé suit la même branche du gel ; il ne se joue pas ici (aucune
-- suppression dans un essai de la production) : l'écran n'en fait aucun, une valeur s'efface par null.
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
  if to_regclass('public.parametres_des_cotisations') is null then
    perform set_config('essai.parametresDesCotisations', jsonb_build_array(jsonb_build_object('rang', 1,
      'etape', '0. EN ATTENTE de la migration parametres_des_cotisations', 'ok', true,
      'observe', 'la table absente : rien ne s''écrit'))::text, true);
    return;
  end if;

  begin
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values
      ('c0715000-0000-4000-8107-000000000001', 'ESSAI PARAMETRES DES COTISATIONS', cabinet, 'tresorerie', '455000');

    for e in select * from (values
      (1, 'proprietaire', '1. le catalogue du début d''activité : cinq colonnes, la date seule nulle', $q$select string_agg(a.attname || ':'
  || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' order by a.attnum)
  from pg_attribute a where a.attrelid = 'public.debuts_d_activite'::regclass and a.attnum > 0 and not a.attisdropped$q$,
        'OK', 'id:uuid:true,dossier_id:uuid:true,date_debut:date:false,created_at:timestamp with time zone:true,updated_at:timestamp with time zone:true'),
      (2, 'proprietaire', '1b. … celui des paramètres d''un exercice : sept colonnes, l''ACRE et le taux nuls, le taux en décimal exact', $q$select string_agg(a.attname || ':'
  || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' order by a.attnum)
  from pg_attribute a where a.attrelid = 'public.parametres_des_cotisations'::regclass and a.attnum > 0 and not a.attisdropped$q$,
        'OK', 'id:uuid:true,dossier_id:uuid:true,annee:integer:true,acre:boolean:false,taux_dentiste:numeric:false,created_at:timestamp with time zone:true,updated_at:timestamp with time zone:true'),
      (3, 'proprietaire', '1c. … leurs contraintes, au texte près (les clés, le dossier en cascade, trois CHECK, deux unicités TOTALES)', $q$select count(*) || ' ' || md5(string_agg(c.conrelid::regclass::text || ' ' || c.conname || ' ' || pg_get_constraintdef(c.oid), ' ; ' order by c.conrelid::regclass::text collate "C", c.conname collate "C"))
  from pg_constraint c where c.conrelid in ('public.debuts_d_activite'::regclass, 'public.parametres_des_cotisations'::regclass)$q$,
        'OK', '9 3f6aaebe26f1e3ee69417f31ec4e4783'),
      (4, 'proprietaire', '1d. … la RLS active et une seule policy chacune, le cabinet du dossier, à authenticated', $q$select string_agg(c.relname || ':' || c.relrowsecurity, ',' order by c.relname) || ' ' || (select string_agg(p.tablename || '.' || p.policyname || ':' || p.cmd || ':'
  || p.roles::text || ':' || coalesce(p.qual, '-') || ':' || coalesce(p.with_check, '-'), ' ; ' order by p.tablename, p.policyname)
  from pg_policies p where p.schemaname = 'public' and p.tablename in ('debuts_d_activite', 'parametres_des_cotisations') and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE'))
  from pg_class c where c.oid in ('public.debuts_d_activite'::regclass, 'public.parametres_des_cotisations'::regclass)$q$,
        'OK', 'debuts_d_activite:true,parametres_des_cotisations:true debuts_d_activite.debuts_d_activite_cabinet:ALL:{authenticated}:admin_du_dossier(dossier_id):admin_du_dossier(dossier_id) ; parametres_des_cotisations.parametres_des_cotisations_cabinet:ALL:{authenticated}:admin_du_dossier(dossier_id):admin_du_dossier(dossier_id)'),
      (5, 'proprietaire', '1e. … le gel des paramètres d''un exercice, avant toute insertion, mise à jour ou suppression, ligne par ligne ; aucun sur le début d''activité', $q$select coalesce(string_agg(t.tgrelid::regclass::text || '.' || t.tgname || ':' || t.tgtype || ':' || t.tgfoid::regprocedure::text, ','), '-')
  from pg_trigger t where t.tgrelid in ('public.debuts_d_activite'::regclass, 'public.parametres_des_cotisations'::regclass) and not t.tgisinternal$q$,
        'OK', 'parametres_des_cotisations.parametres_des_cotisations_figes_par_la_validation:31:garder_parametres_des_cotisations_valides()'),
      (6, 'proprietaire', '1f. … les droits : la garde à personne, l''écriture à authenticated seul, aux droits de l''appelant', $q$select has_function_privilege('anon', 'public.enregistrer_parametres_des_cotisations(uuid, integer, jsonb, jsonb)', 'execute')
  || '|' || has_function_privilege('authenticated', 'public.enregistrer_parametres_des_cotisations(uuid, integer, jsonb, jsonb)', 'execute')
  || '|' || has_function_privilege('authenticated', 'public.garder_parametres_des_cotisations_valides()', 'execute')
  || '|' || has_function_privilege('anon', 'public.garder_parametres_des_cotisations_valides()', 'execute')
  || '|' || (select p.prosecdef from pg_proc p where p.oid = 'public.enregistrer_parametres_des_cotisations(uuid, integer, jsonb, jsonb)'::regprocedure)
  || '|' || (select p.prosecdef from pg_proc p where p.oid = 'public.garder_parametres_des_cotisations_valides()'::regprocedure)$q$, 'OK', 'false|true|false|false|false|true'),
      (7, 'chef', '2. le début d''activité et l''ACRE de 2025 d''un coup', $q$select enregistrer_parametres_des_cotisations('c0715000-0000-4000-8107-000000000001', 2025,
  '{"debut_activite": null, "acre": null, "taux_dentiste": null}', '{"debut_activite": "2025-07-01", "acre": true, "taux_dentiste": null}')$q$,
        'OK', '2'),
      (8, 'chef', '2b. … relus', $q$select (select date_debut::text from debuts_d_activite where dossier_id = 'c0715000-0000-4000-8107-000000000001')
  || ' ' || (select string_agg(annee || ':' || coalesce(acre::text, '-') || ':' || coalesce(taux_dentiste::text, '-'), ',' order by annee)
  from parametres_des_cotisations where dossier_id = 'c0715000-0000-4000-8107-000000000001')$q$, 'OK', '2025-07-01 2025:true:-'),
      (9, 'chef', '3. une valeur changée depuis sa lecture refuse le tout, le début d''activité compris', $q$select enregistrer_parametres_des_cotisations('c0715000-0000-4000-8107-000000000001', 2025,
  '{"debut_activite": "2025-07-01", "acre": false, "taux_dentiste": null}', '{"debut_activite": "2025-03-01", "acre": false, "taux_dentiste": 0.35}')$q$,
        '40001', 'Les paramètres des cotisations de l''exercice 2025 ont changé depuis leur lecture : relis-les avant de les enregistrer.'),
      (10, 'chef', '3b. … un début d''activité lu faux aussi', $q$select enregistrer_parametres_des_cotisations('c0715000-0000-4000-8107-000000000001', 2025,
  '{"debut_activite": "2025-06-30", "acre": true, "taux_dentiste": null}', '{"debut_activite": "2025-03-01", "acre": true, "taux_dentiste": null}')$q$,
        '40001', 'Les paramètres des cotisations de l''exercice 2025 ont changé%'),
      (11, 'chef', '3c. … rien n''a bougé', $q$select (select date_debut::text from debuts_d_activite where dossier_id = 'c0715000-0000-4000-8107-000000000001')
  || ' ' || (select acre::text from parametres_des_cotisations where dossier_id = 'c0715000-0000-4000-8107-000000000001' and annee = 2025)$q$,
        'OK', '2025-07-01 true'),
      (12, 'chef', '4. une clé de moins se refuse', $q$select enregistrer_parametres_des_cotisations('c0715000-0000-4000-8107-000000000001', 2026,
  '{"debut_activite": "2025-07-01", "acre": null}', '{"debut_activite": "2025-07-01", "acre": true, "taux_dentiste": null}')$q$,
        '22023', 'Les paramètres des cotisations partent mal formés%'),
      (13, 'chef', '4b. … une clé de plus aussi', $q$select enregistrer_parametres_des_cotisations('c0715000-0000-4000-8107-000000000001', 2026,
  '{"debut_activite": "2025-07-01", "acre": null, "taux_dentiste": null}', '{"debut_activite": "2025-07-01", "acre": true, "taux_dentiste": null, "remplacant": true}')$q$,
        '22023', 'Les paramètres des cotisations partent mal formés%'),
      (14, 'chef', '4c. … l''ACRE en texte', $q$select enregistrer_parametres_des_cotisations('c0715000-0000-4000-8107-000000000001', 2026,
  '{"debut_activite": "2025-07-01", "acre": null, "taux_dentiste": null}', '{"debut_activite": "2025-07-01", "acre": "oui", "taux_dentiste": null}')$q$,
        '22023', 'Les paramètres des cotisations partent mal formés%'),
      (15, 'chef', '4d. … une date d''une autre forme', $q$select enregistrer_parametres_des_cotisations('c0715000-0000-4000-8107-000000000001', 2026,
  '{"debut_activite": "2025-07-01", "acre": null, "taux_dentiste": null}', '{"debut_activite": "01/07/2025", "acre": null, "taux_dentiste": null}')$q$,
        '22023', 'Les paramètres des cotisations partent mal formés%'),
      (16, 'chef', '4e. … une date hors du calendrier', $q$select enregistrer_parametres_des_cotisations('c0715000-0000-4000-8107-000000000001', 2026,
  '{"debut_activite": "2025-07-01", "acre": null, "taux_dentiste": null}', '{"debut_activite": "2025-02-30", "acre": null, "taux_dentiste": null}')$q$,
        '22023', 'Le début d''activité n''est pas une date du calendrier.'),
      (17, 'chef', '4f. … un taux dentiste au-dessus de 1', $q$select enregistrer_parametres_des_cotisations('c0715000-0000-4000-8107-000000000001', 2026,
  '{"debut_activite": "2025-07-01", "acre": null, "taux_dentiste": null}', '{"debut_activite": "2025-07-01", "acre": null, "taux_dentiste": 1.01}')$q$,
        '23514', '%parametres_des_cotisations_taux_dentiste%'),
      (18, 'chef', '4g. … négatif', $q$select enregistrer_parametres_des_cotisations('c0715000-0000-4000-8107-000000000001', 2026,
  '{"debut_activite": "2025-07-01", "acre": null, "taux_dentiste": null}', '{"debut_activite": "2025-07-01", "acre": null, "taux_dentiste": -0.01}')$q$,
        '23514', '%parametres_des_cotisations_taux_dentiste%'),
      (19, 'chef', '4h. … plus fin que le centième', $q$select enregistrer_parametres_des_cotisations('c0715000-0000-4000-8107-000000000001', 2026,
  '{"debut_activite": "2025-07-01", "acre": null, "taux_dentiste": null}', '{"debut_activite": "2025-07-01", "acre": null, "taux_dentiste": 0.355}')$q$,
        '23514', '%parametres_des_cotisations_taux_dentiste%'),
      (20, 'chef', '4i. … un exercice d''avant 2025, que l''estimation ne couvre pas', $q$select enregistrer_parametres_des_cotisations('c0715000-0000-4000-8107-000000000001', 2024,
  '{"debut_activite": "2025-07-01", "acre": null, "taux_dentiste": null}', '{"debut_activite": "2025-07-01", "acre": false, "taux_dentiste": null}')$q$,
        '23514', '%parametres_des_cotisations_annee%'),
      (21, 'chef', '4j. … en direct, une seconde ligne de début d''activité', $q$insert into debuts_d_activite (dossier_id, date_debut)
  values ('c0715000-0000-4000-8107-000000000001', '2024-01-01')$q$, '23505', '%debuts_d_activite_un_par_dossier%'),
      (22, 'chef', '4k. … une seconde ligne pour 2025', $q$insert into parametres_des_cotisations (dossier_id, annee, acre)
  values ('c0715000-0000-4000-8107-000000000001', 2025, false)$q$, '23505', '%parametres_des_cotisations_un_par_exercice%'),
      (23, 'chef', '5. ce qui ne change pas ne s''écrit pas', $q$select enregistrer_parametres_des_cotisations('c0715000-0000-4000-8107-000000000001', 2025,
  '{"debut_activite": "2025-07-01", "acre": true, "taux_dentiste": null}', '{"debut_activite": "2025-07-01", "acre": true, "taux_dentiste": null}')$q$,
        'OK', '0'),
      (24, 'chef', '5b. le taux dentiste de 2026, au centième, sans toucher au début d''activité', $q$select enregistrer_parametres_des_cotisations('c0715000-0000-4000-8107-000000000001', 2026,
  '{"debut_activite": "2025-07-01", "acre": null, "taux_dentiste": null}', '{"debut_activite": "2025-07-01", "acre": null, "taux_dentiste": 0.35}')$q$,
        'OK', '1'),
      (25, 'client', '6. le client d''essai, qui n''a pas ce dossier, n''écrit pas par la fonction', $q$select enregistrer_parametres_des_cotisations('c0715000-0000-4000-8107-000000000001', 2026,
  '{"debut_activite": null, "acre": null, "taux_dentiste": null}', '{"debut_activite": "2020-01-01", "acre": null, "taux_dentiste": null}')$q$,
        '42501', 'Les paramètres des cotisations ne s''écrivent que par le cabinet du dossier.'),
      (26, 'client', '6b. … ne lit rien', $q$select (select count(*) from parametres_des_cotisations where dossier_id = 'c0715000-0000-4000-8107-000000000001')
  + (select count(*) from debuts_d_activite where dossier_id = 'c0715000-0000-4000-8107-000000000001')$q$, 'OK', '0'),
      (27, 'client', '6c. … n''insère pas en direct', $q$insert into parametres_des_cotisations (dossier_id, annee, acre)
  values ('c0715000-0000-4000-8107-000000000001', 2027, true)$q$, '42501', '%row-level security%'),
      (28, 'client', '6d. … ne réécrit rien', $q$with u as (update debuts_d_activite set date_debut = null where dossier_id = 'c0715000-0000-4000-8107-000000000001' returning 1),
  v as (update parametres_des_cotisations set acre = false where dossier_id = 'c0715000-0000-4000-8107-000000000001' returning 1)
  select (select count(*) from u) + (select count(*) from v)$q$, 'OK', '0'),
      (29, 'anon', '6e. l''anonyme n''exécute pas la fonction', $q$select enregistrer_parametres_des_cotisations('c0715000-0000-4000-8107-000000000001', 2026,
  '{"debut_activite": null, "acre": null, "taux_dentiste": null}', '{"debut_activite": "2020-01-01", "acre": null, "taux_dentiste": null}')$q$,
        '42501', '%permission denied%'),
      (30, 'chef', '7. l''exercice 2025 se valide', $q$select valider_exercice('c0715000-0000-4000-8107-000000000001', 2025, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb) is not null$q$, 'OK', ''),
      (31, 'chef', '7b. ses paramètres ne changent plus par la fonction', $q$select enregistrer_parametres_des_cotisations('c0715000-0000-4000-8107-000000000001', 2025,
  '{"debut_activite": "2025-07-01", "acre": true, "taux_dentiste": null}', '{"debut_activite": "2025-07-01", "acre": false, "taux_dentiste": null}')$q$,
        '23514', 'L''exercice 2025 est validé : ses paramètres des cotisations ne changent plus.'),
      (32, 'chef', '7c. … ni en direct', $q$update parametres_des_cotisations set taux_dentiste = 0.5 where dossier_id = 'c0715000-0000-4000-8107-000000000001' and annee = 2025$q$,
        '23514', 'L''exercice 2025 est validé : ses paramètres des cotisations ne changent plus.'),
      (33, 'chef', '7d. … une mise à jour qui ne change rien passe', $q$with u as (update parametres_des_cotisations set acre = acre
  where dossier_id = 'c0715000-0000-4000-8107-000000000001' and annee = 2025 returning 1) select count(*) from u$q$, 'OK', '1'),
      (34, 'chef', '7e. le début d''activité, une donnée du dossier, se corrige encore', $q$select enregistrer_parametres_des_cotisations('c0715000-0000-4000-8107-000000000001', 2026,
  '{"debut_activite": "2025-07-01", "acre": null, "taux_dentiste": 0.35}', '{"debut_activite": "2025-06-15", "acre": null, "taux_dentiste": 0.35}')$q$, 'OK', '1'),
      (35, 'chef', '7f. 2026 s''écrit encore, et l''effacement d''une valeur passe par null', $q$select enregistrer_parametres_des_cotisations('c0715000-0000-4000-8107-000000000001', 2026,
  '{"debut_activite": "2025-06-15", "acre": null, "taux_dentiste": 0.35}', '{"debut_activite": "2025-06-15", "acre": true, "taux_dentiste": null}')$q$, 'OK', '1'),
      (36, 'chef', '7g. … et 2025 est restée telle qu''elle a été validée', $q$select (select date_debut::text from debuts_d_activite where dossier_id = 'c0715000-0000-4000-8107-000000000001')
  || ' ' || (select string_agg(annee || ':' || coalesce(acre::text, '-') || ':' || coalesce(taux_dentiste::text, '-'), ',' order by annee)
  from parametres_des_cotisations where dossier_id = 'c0715000-0000-4000-8107-000000000001')$q$, 'OK', '2025-06-15 2025:true:-,2026:true:-')
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
  perform set_config('essai.parametresDesCotisations', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.parametresDesCotisations')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
