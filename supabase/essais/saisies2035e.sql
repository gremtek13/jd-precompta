-- L'ANNEXE 2035-E : LES SAISIES DU CABINET PAR EXERCICE (ligne 48 ; la migration `saisies_2035e`, PRÉPARÉE le 11/11/2026,
-- supabase/preparees/20261111240000_saisies_2035e.sql). Le récit : HISTORIQUE.md, « 11/11/2026 — LA SAISIE DE L'ANNEXE
-- 2035-E PAR EXERCICE, EN BASE (PRÉPARÉE, PAS APPLIQUÉE) ».
-- SUR UNE RÉPLIQUE SEULEMENT : il prend le membre d'équipe fictif de la réplique (un comptable du cabinet de `test`, qu'aucun
-- dossier jetable n'assigne), que la production n'a pas. À rejouer par psql (`-f`), sous le propriétaire, après toute
-- migration qui touche `saisies_2035e`, ses contraintes, `garder_saisie_2035e_validee`, `enregistrer_saisies_2035e`,
-- `admin_du_dossier` ou la frontière de la validation.
--
-- Ce qui se prouve ici :
--   - le catalogue : les colonnes (huit saisies nulles possibles), les contraintes au texte près, la RLS et sa seule
--     policy (le cabinet du dossier, à authenticated), le gel avant toute écriture, les droits d'exécution ;
--   - l'écriture : la ligne entière d'un exercice, relue ; une valeur changée depuis sa lecture refuse le tout (40001) ;
--     une clé de trop ou de moins, un montant décimal ou négatif (hors EK), un effectif sans le cadre coché, une seconde
--     ligne pour le même exercice se refusent ; nul reste nul (« à saisir »), jamais zéro ;
--   - les droits : le client d'essai, qui n'a pas ce dossier, et le membre d'équipe non assigné n'écrivent ni ne lisent
--     rien ; l'anonyme n'exécute pas la fonction ;
--   - le gel : l'exercice 2025 validé ne change plus (la fonction, une mise à jour, une insertion en 2024), une mise à jour
--     qui ne change rien passe, 2026 s'écrit encore.
-- Tout se joue dans un dossier jetable, et tout s'annule à la fin. Sans la migration, une ligne le dit, et rien ne s'écrit.

do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  membre constant text := '3e3b0000-0000-4000-8000-000000000001';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  verdicts jsonb := '[]'::jsonb;
  e record;
  v_obs text;
  v_code text;
  v_msg text;
begin
  if to_regclass('public.saisies_2035e') is null then
    perform set_config('essai.saisies2035e', jsonb_build_array(jsonb_build_object('rang', 1,
      'etape', '0. EN ATTENTE de la migration saisies_2035e', 'ok', true,
      'observe', 'la table absente : rien ne s''écrit'))::text, true);
    return;
  end if;

  begin
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values
      ('5e20352e-0000-4000-8111-000000000001', 'ESSAI SAISIES 2035-E', cabinet, 'tresorerie', '455000');

    for e in select * from (values
      (1, 'proprietaire', '0. le membre d''équipe est du cabinet, et n''est pas assigné au dossier jetable', $q$select (select count(*) from cabinet_admins where user_id = '3e3b0000-0000-4000-8000-000000000001' and role = 'comptable'
  and cabinet_id = (select cabinet_id from dossiers where id = '5e20352e-0000-4000-8111-000000000001'))
  || '|' || (select count(*) from dossier_assignations where dossier_id = '5e20352e-0000-4000-8111-000000000001')$q$, 'OK', '1|0'),
      (2, 'proprietaire', '1. le catalogue : treize colonnes, les huit saisies seules nullables', $q$select string_agg(a.attname || ':'
  || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' order by a.attnum)
  from pg_attribute a where a.attrelid = 'public.saisies_2035e'::regclass and a.attnum > 0 and not a.attisdropped$q$,
        'OK', 'id:uuid:true,dossier_id:uuid:true,annee:integer:true,loyers_deductibles:bigint:false,plus_values:bigint:false,variation_de_stock:bigint:false,taxes_sur_le_chiffre_d_affaires:bigint:false,dotations_biens_mis_a_disposition:bigint:false,moins_values:bigint:false,mono_etablissement:boolean:false,effectif:integer:false,created_at:timestamp with time zone:true,updated_at:timestamp with time zone:true'),
      (3, 'proprietaire', '1b. … ses contraintes, au texte près (la clé, le dossier en cascade, trois contrôles, l''unicité TOTALE)', $q$select count(*) || ' ' || md5(string_agg(c.conname || ' ' || pg_get_constraintdef(c.oid), ' ; ' order by c.conname collate "C"))
  from pg_constraint c where c.conrelid = 'public.saisies_2035e'::regclass$q$, 'OK', '6 e2d93f667724f7850fc4c98a71e65c59'),
      (4, 'proprietaire', '1c. … la RLS active et sa seule policy, le cabinet du dossier, à authenticated', $q$select (select c.relrowsecurity::text from pg_class c where c.oid = 'public.saisies_2035e'::regclass) || ' ' || string_agg(p.policyname || ':' || p.cmd || ':'
  || p.roles::text || ':' || coalesce(p.qual, '-') || ':' || coalesce(p.with_check, '-'), ' ; ' order by p.policyname)
  from pg_policies p where p.schemaname = 'public' and p.tablename = 'saisies_2035e' and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')$q$,
        'OK', 'true saisies_2035e_cabinet:ALL:{authenticated}:admin_du_dossier(dossier_id):admin_du_dossier(dossier_id)'),
      (5, 'proprietaire', '1d. … le gel, avant toute insertion, mise à jour ou suppression, ligne par ligne', $q$select string_agg(t.tgname || ':' || t.tgtype || ':' || t.tgfoid::regprocedure::text, ',')
  from pg_trigger t where t.tgrelid = 'public.saisies_2035e'::regclass and not t.tgisinternal$q$,
        'OK', 'saisies_2035e_figees_par_la_validation:31:garder_saisie_2035e_validee()'),
      (6, 'proprietaire', '1e. … les droits : la garde à personne, l''écriture à authenticated seul, aux droits de l''appelant', $q$select has_function_privilege('anon', 'public.enregistrer_saisies_2035e(uuid, integer, jsonb, jsonb)', 'execute')
  || '|' || has_function_privilege('authenticated', 'public.enregistrer_saisies_2035e(uuid, integer, jsonb, jsonb)', 'execute')
  || '|' || has_function_privilege('authenticated', 'public.garder_saisie_2035e_validee()', 'execute')
  || '|' || has_function_privilege('anon', 'public.garder_saisie_2035e_validee()', 'execute')
  || '|' || (select p.prosecdef from pg_proc p where p.oid = 'public.enregistrer_saisies_2035e(uuid, integer, jsonb, jsonb)'::regprocedure)
  || '|' || (select p.prosecdef from pg_proc p where p.oid = 'public.garder_saisie_2035e_validee()'::regprocedure)$q$, 'OK', 'false|true|false|false|false|true'),
      (7, 'chef', '2. la saisie de 2025 : EM, EK négative, le cadre coché et son effectif, le reste à saisir', $q$select enregistrer_saisies_2035e('5e20352e-0000-4000-8111-000000000001', 2025,
  '{"loyers_deductibles": null, "plus_values": null, "variation_de_stock": null, "taxes_sur_le_chiffre_d_affaires": null, "dotations_biens_mis_a_disposition": null, "moins_values": null, "mono_etablissement": null, "effectif": null}',
  '{"loyers_deductibles": 1800, "plus_values": null, "variation_de_stock": -250, "taxes_sur_le_chiffre_d_affaires": 0, "dotations_biens_mis_a_disposition": null, "moins_values": null, "mono_etablissement": true, "effectif": 2}') is not null$q$,
        'OK', 'true'),
      (8, 'chef', '2b. … relue : nul reste nul, zéro reste zéro', $q$select concat_ws(',', loyers_deductibles, coalesce(plus_values::text, 'nul'), variation_de_stock, taxes_sur_le_chiffre_d_affaires,
  coalesce(dotations_biens_mis_a_disposition::text, 'nul'), coalesce(moins_values::text, 'nul'), mono_etablissement, effectif)
  from saisies_2035e where dossier_id = '5e20352e-0000-4000-8111-000000000001'$q$, 'OK', '1800,nul,-250,0,nul,nul,t,2'),
      (9, 'chef', '3. une valeur changée depuis sa lecture refuse le tout', $q$select enregistrer_saisies_2035e('5e20352e-0000-4000-8111-000000000001', 2025,
  '{"loyers_deductibles": 1700, "plus_values": null, "variation_de_stock": -250, "taxes_sur_le_chiffre_d_affaires": 0, "dotations_biens_mis_a_disposition": null, "moins_values": null, "mono_etablissement": true, "effectif": 2}',
  '{"loyers_deductibles": 1900, "plus_values": 10, "variation_de_stock": -250, "taxes_sur_le_chiffre_d_affaires": 0, "dotations_biens_mis_a_disposition": null, "moins_values": null, "mono_etablissement": true, "effectif": 2}')$q$,
        '40001', 'Les saisies de l''annexe 2035-E de l''exercice 2025 ont changé depuis leur lecture : relis-les avant de les enregistrer.'),
      (10, 'chef', '3b. … rien n''a changé', $q$select loyers_deductibles || ',' || coalesce(plus_values::text, 'nul') from saisies_2035e where dossier_id = '5e20352e-0000-4000-8111-000000000001'$q$,
        'OK', '1800,nul'),
      (11, 'chef', '4. une clé de moins se refuse', $q$select enregistrer_saisies_2035e('5e20352e-0000-4000-8111-000000000001', 2026,
  '{"loyers_deductibles": null, "plus_values": null, "variation_de_stock": null, "taxes_sur_le_chiffre_d_affaires": null, "dotations_biens_mis_a_disposition": null, "moins_values": null, "mono_etablissement": null, "effectif": null}',
  '{"loyers_deductibles": 1}')$q$, '22023', '%les huit valeurs, ni plus ni moins.'),
      (12, 'chef', '4b. … une clé de trop', $q$select enregistrer_saisies_2035e('5e20352e-0000-4000-8111-000000000001', 2026,
  '{"loyers_deductibles": null, "plus_values": null, "variation_de_stock": null, "taxes_sur_le_chiffre_d_affaires": null, "dotations_biens_mis_a_disposition": null, "moins_values": null, "mono_etablissement": null, "effectif": null}',
  '{"loyers_deductibles": null, "plus_values": null, "variation_de_stock": null, "taxes_sur_le_chiffre_d_affaires": null, "dotations_biens_mis_a_disposition": null, "moins_values": null, "mono_etablissement": null, "effectif": null, "BW": 1}')$q$,
        '22023', '%les huit valeurs, ni plus ni moins.'),
      (13, 'chef', '4c. … un montant décimal', $q$select enregistrer_saisies_2035e('5e20352e-0000-4000-8111-000000000001', 2026,
  '{"loyers_deductibles": null, "plus_values": null, "variation_de_stock": null, "taxes_sur_le_chiffre_d_affaires": null, "dotations_biens_mis_a_disposition": null, "moins_values": null, "mono_etablissement": null, "effectif": null}',
  '{"loyers_deductibles": 12.5, "plus_values": null, "variation_de_stock": null, "taxes_sur_le_chiffre_d_affaires": null, "dotations_biens_mis_a_disposition": null, "moins_values": null, "mono_etablissement": null, "effectif": null}')$q$,
        '22023', 'La valeur loyers_deductibles part mal formée : un nombre entier d''euros.'),
      (14, 'chef', '4d. … un texte pour un montant', $q$select enregistrer_saisies_2035e('5e20352e-0000-4000-8111-000000000001', 2026,
  '{"loyers_deductibles": null, "plus_values": null, "variation_de_stock": null, "taxes_sur_le_chiffre_d_affaires": null, "dotations_biens_mis_a_disposition": null, "moins_values": null, "mono_etablissement": null, "effectif": null}',
  '{"loyers_deductibles": "100", "plus_values": null, "variation_de_stock": null, "taxes_sur_le_chiffre_d_affaires": null, "dotations_biens_mis_a_disposition": null, "moins_values": null, "mono_etablissement": null, "effectif": null}')$q$,
        '22023', '%un nombre entier d''euros, ou à saisir.'),
      (15, 'chef', '4e. … un loyer déduit négatif (EK seule est signée)', $q$select enregistrer_saisies_2035e('5e20352e-0000-4000-8111-000000000001', 2026,
  '{"loyers_deductibles": null, "plus_values": null, "variation_de_stock": null, "taxes_sur_le_chiffre_d_affaires": null, "dotations_biens_mis_a_disposition": null, "moins_values": null, "mono_etablissement": null, "effectif": null}',
  '{"loyers_deductibles": -1, "plus_values": null, "variation_de_stock": null, "taxes_sur_le_chiffre_d_affaires": null, "dotations_biens_mis_a_disposition": null, "moins_values": null, "mono_etablissement": null, "effectif": null}')$q$,
        '23514', '%saisies_2035e_montants%'),
      (16, 'chef', '4f. … un effectif sans le cadre coché', $q$select enregistrer_saisies_2035e('5e20352e-0000-4000-8111-000000000001', 2026,
  '{"loyers_deductibles": null, "plus_values": null, "variation_de_stock": null, "taxes_sur_le_chiffre_d_affaires": null, "dotations_biens_mis_a_disposition": null, "moins_values": null, "mono_etablissement": null, "effectif": null}',
  '{"loyers_deductibles": null, "plus_values": null, "variation_de_stock": null, "taxes_sur_le_chiffre_d_affaires": null, "dotations_biens_mis_a_disposition": null, "moins_values": null, "mono_etablissement": false, "effectif": 1}')$q$,
        '23514', '%saisies_2035e_effectif%'),
      (17, 'chef', '4g. … le cadre en texte', $q$select enregistrer_saisies_2035e('5e20352e-0000-4000-8111-000000000001', 2026,
  '{"loyers_deductibles": null, "plus_values": null, "variation_de_stock": null, "taxes_sur_le_chiffre_d_affaires": null, "dotations_biens_mis_a_disposition": null, "moins_values": null, "mono_etablissement": null, "effectif": null}',
  '{"loyers_deductibles": null, "plus_values": null, "variation_de_stock": null, "taxes_sur_le_chiffre_d_affaires": null, "dotations_biens_mis_a_disposition": null, "moins_values": null, "mono_etablissement": "oui", "effectif": null}')$q$,
        '22023', 'La valeur mono_etablissement part mal formée : vrai, faux ou à dire.'),
      (18, 'chef', '4h. … une seconde ligne pour 2025, en direct', $q$insert into saisies_2035e (dossier_id, annee) values ('5e20352e-0000-4000-8111-000000000001', 2025)$q$,
        '23505', '%saisies_2035e_une_par_exercice%'),
      (19, 'client', '5. le client d''essai, qui n''a pas ce dossier, n''écrit pas par la fonction', $q$select enregistrer_saisies_2035e('5e20352e-0000-4000-8111-000000000001', 2026,
  '{"loyers_deductibles": null, "plus_values": null, "variation_de_stock": null, "taxes_sur_le_chiffre_d_affaires": null, "dotations_biens_mis_a_disposition": null, "moins_values": null, "mono_etablissement": null, "effectif": null}',
  '{"loyers_deductibles": 1, "plus_values": null, "variation_de_stock": null, "taxes_sur_le_chiffre_d_affaires": null, "dotations_biens_mis_a_disposition": null, "moins_values": null, "mono_etablissement": null, "effectif": null}')$q$,
        '42501', 'Les saisies de l''annexe 2035-E ne s''écrivent que par le cabinet du dossier.'),
      (20, 'client', '5b. … ne lit rien', $q$select count(*) from saisies_2035e where dossier_id = '5e20352e-0000-4000-8111-000000000001'$q$, 'OK', '0'),
      (21, 'client', '5c. … n''insère pas en direct', $q$insert into saisies_2035e (dossier_id, annee) values ('5e20352e-0000-4000-8111-000000000001', 2026)$q$,
        '42501', '%row-level security%'),
      (22, 'membre', '6. le membre d''équipe non assigné n''écrit pas par la fonction', $q$select enregistrer_saisies_2035e('5e20352e-0000-4000-8111-000000000001', 2026,
  '{"loyers_deductibles": null, "plus_values": null, "variation_de_stock": null, "taxes_sur_le_chiffre_d_affaires": null, "dotations_biens_mis_a_disposition": null, "moins_values": null, "mono_etablissement": null, "effectif": null}',
  '{"loyers_deductibles": 1, "plus_values": null, "variation_de_stock": null, "taxes_sur_le_chiffre_d_affaires": null, "dotations_biens_mis_a_disposition": null, "moins_values": null, "mono_etablissement": null, "effectif": null}')$q$,
        '42501', 'Les saisies de l''annexe 2035-E ne s''écrivent que par le cabinet du dossier.'),
      (23, 'membre', '6b. … ne lit rien', $q$select count(*) from saisies_2035e where dossier_id = '5e20352e-0000-4000-8111-000000000001'$q$, 'OK', '0'),
      (24, 'membre', '6c. … ne réécrit rien', $q$with u as (update saisies_2035e set loyers_deductibles = 1 where dossier_id = '5e20352e-0000-4000-8111-000000000001' returning 1)
  select count(*) from u$q$, 'OK', '0'),
      (25, 'anon', '6d. l''anonyme n''exécute pas la fonction', $q$select enregistrer_saisies_2035e('5e20352e-0000-4000-8111-000000000001', 2026, '{}', '{}')$q$, '42501', '%permission denied%'),
      (26, 'chef', '7. l''exercice 2025 se valide', $q$select valider_exercice('5e20352e-0000-4000-8111-000000000001', 2025, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb) is not null$q$, 'OK', ''),
      (27, 'chef', '7b. sa saisie ne change plus par la fonction', $q$select enregistrer_saisies_2035e('5e20352e-0000-4000-8111-000000000001', 2025,
  '{"loyers_deductibles": 1800, "plus_values": null, "variation_de_stock": -250, "taxes_sur_le_chiffre_d_affaires": 0, "dotations_biens_mis_a_disposition": null, "moins_values": null, "mono_etablissement": true, "effectif": 2}',
  '{"loyers_deductibles": 1900, "plus_values": null, "variation_de_stock": -250, "taxes_sur_le_chiffre_d_affaires": 0, "dotations_biens_mis_a_disposition": null, "moins_values": null, "mono_etablissement": true, "effectif": 2}')$q$,
        '23514', 'L''exercice 2025 est validé : ses saisies de l''annexe 2035-E ne changent plus.'),
      (28, 'chef', '7c. … ni en direct', $q$update saisies_2035e set effectif = 3 where dossier_id = '5e20352e-0000-4000-8111-000000000001' and annee = 2025$q$,
        '23514', 'L''exercice 2025 est validé : ses saisies de l''annexe 2035-E ne changent plus.'),
      (29, 'chef', '7d. … une mise à jour qui ne change rien passe', $q$with u as (update saisies_2035e set effectif = effectif
  where dossier_id = '5e20352e-0000-4000-8111-000000000001' and annee = 2025 returning 1) select count(*) from u$q$, 'OK', '1'),
      (30, 'chef', '7e. … une saisie de 2024, que la validation de 2025 fige, ne s''ajoute plus', $q$insert into saisies_2035e (dossier_id, annee, loyers_deductibles)
  values ('5e20352e-0000-4000-8111-000000000001', 2024, 10)$q$,
        '23514', 'L''exercice 2024 est figé par la validation de l''exercice 2025 : ses saisies de l''annexe 2035-E ne changent plus.'),
      (31, 'chef', '7f. 2026 s''écrit encore', $q$select enregistrer_saisies_2035e('5e20352e-0000-4000-8111-000000000001', 2026,
  '{"loyers_deductibles": null, "plus_values": null, "variation_de_stock": null, "taxes_sur_le_chiffre_d_affaires": null, "dotations_biens_mis_a_disposition": null, "moins_values": null, "mono_etablissement": null, "effectif": null}',
  '{"loyers_deductibles": null, "plus_values": 400, "variation_de_stock": null, "taxes_sur_le_chiffre_d_affaires": null, "dotations_biens_mis_a_disposition": null, "moins_values": null, "mono_etablissement": false, "effectif": null}') is not null$q$,
        'OK', 'true'),
      (32, 'chef', '7g. … et 2025 est restée telle qu''elle a été validée', $q$select string_agg(annee || ':' || coalesce(loyers_deductibles::text, 'nul') || ':' || coalesce(plus_values::text, 'nul') || ':' || coalesce(effectif::text, 'nul'), ',' order by annee)
  from saisies_2035e where dossier_id = '5e20352e-0000-4000-8111-000000000001'$q$, 'OK', '2025:1800:nul:2,2026:nul:400:nul')
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
          perform set_config('request.jwt.claims', json_build_object('sub',
            case e.profil when 'chef' then chef when 'membre' then membre else client end, 'role', 'authenticated')::text, true);
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
  perform set_config('essai.saisies2035e', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.saisies2035e')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
