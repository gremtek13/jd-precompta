-- LES PROFESSIONS RELEVANT DE LA CIPAV DANS LE VOLET SOCIAL (ligne 27.1, RET-Q1 ; la migration `professions_cipav`,
-- PRÉPARÉE, supabase/preparees/20261111130000_professions_cipav.sql). Le récit : HISTORIQUE.md, « 11/11/2026 — LA CIPAV
-- DANS L'ESTIMATION DES COTISATIONS (LIGNE 27.1, RET-Q1) (PRÉPARÉE, PAS APPLIQUÉE) ». À rejouer par `execute_sql` après
-- toute migration qui touche `volet_social_pamc`, ses contraintes ou `admin_du_dossier`.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - le catalogue : la contrainte des professions au texte près, les six valeurs ; la RLS et la seule policy de la table
--     inchangées (le cabinet du dossier, à authenticated) ;
--   - l'écriture : le chef du cabinet enregistre une profession relevant de la CIPAV, la relit, revient à une profession
--     de santé ; une valeur hors de la liste se refuse (23514), celle d'hier comme une inventée ;
--   - les droits : le client d'essai, qui n'a pas ce dossier, n'écrit ni ne lit rien ; l'anonyme non plus.
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
  if (select pg_get_constraintdef(c.oid) from pg_constraint c
      where c.conrelid = 'public.volet_social_pamc'::regclass and c.conname = 'volet_social_pamc_profession_check')
     not like '%liberal_cipav%' then
    perform set_config('essai.professionsCipav', jsonb_build_array(jsonb_build_object('rang', 1,
      'etape', '0. EN ATTENTE de la migration professions_cipav', 'ok', true,
      'observe', 'la contrainte d''hier : rien ne s''écrit'))::text, true);
    return;
  end if;

  begin
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values
      ('c1a0a000-0000-4000-8111-000000000001', 'ESSAI PROFESSIONS CIPAV', cabinet, 'tresorerie', '455000');

    for e in select * from (values
      (1, 'proprietaire', '1. la contrainte des professions, au texte près : les cinq d''hier, puis liberal_cipav', $q$select pg_get_constraintdef(c.oid)
  from pg_constraint c where c.conrelid = 'public.volet_social_pamc'::regclass and c.conname = 'volet_social_pamc_profession_check'$q$,
        'OK', 'CHECK ((profession = ANY (ARRAY[''auxiliaire_medical''::text, ''sage_femme''::text, ''medecin_secteur_1''::text, ''medecin_secteur_2''::text, ''chirurgien_dentiste''::text, ''liberal_cipav''::text])))'),
      (2, 'proprietaire', '1b. … la RLS active et la seule policy d''hier, le cabinet du dossier, à authenticated', $q$select c.relrowsecurity || ' ' || (select string_agg(p.policyname || ':' || p.cmd || ':' || p.roles::text || ':'
  || coalesce(p.qual, '-') || ':' || coalesce(p.with_check, '-'), ' ; ' order by p.policyname)
  from pg_policies p where p.schemaname = 'public' and p.tablename = 'volet_social_pamc'
  and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE'))
  from pg_class c where c.oid = 'public.volet_social_pamc'::regclass$q$,
        'OK', 'true volet_social_pamc_cabinet:ALL:{authenticated}:admin_du_dossier(dossier_id):admin_du_dossier(dossier_id)'),
      (3, 'chef', '2. le chef enregistre une profession relevant de la CIPAV, sans rubrique du SNIR', $q$insert into volet_social_pamc
  (dossier_id, annee, profession, remplacant) values ('c1a0a000-0000-4000-8111-000000000001', 2026, 'liberal_cipav', false)
  returning profession$q$,
        'OK', 'liberal_cipav'),
      (4, 'chef', '2b. … la relit', $q$select profession || ':' || remplacant || ':' || coalesce(honoraires_conventionnes::text, 'null')
  from volet_social_pamc where dossier_id = 'c1a0a000-0000-4000-8111-000000000001' and annee = 2026$q$,
        'OK', 'liberal_cipav:false:null'),
      (5, 'chef', '2c. … et revient à une profession de santé', $q$update volet_social_pamc set profession = 'auxiliaire_medical'
  where dossier_id = 'c1a0a000-0000-4000-8111-000000000001' and annee = 2026 returning profession$q$,
        'OK', 'auxiliaire_medical'),
      (6, 'chef', '3. une profession hors de la liste se refuse', $q$update volet_social_pamc set profession = 'cipav'
  where dossier_id = 'c1a0a000-0000-4000-8111-000000000001' and annee = 2026 returning profession$q$,
        '23514', '%volet_social_pamc_profession_check%'),
      (7, 'chef', '3b. … le médecin non conventionné aussi, qu''aucun choix ne porte', $q$insert into volet_social_pamc
  (dossier_id, annee, profession) values ('c1a0a000-0000-4000-8111-000000000001', 2025, 'medecin_non_conventionne')
  returning profession$q$,
        '23514', '%volet_social_pamc_profession_check%'),
      (8, 'client', '4. le client d''essai, qui n''a pas ce dossier, n''écrit pas', $q$insert into volet_social_pamc
  (dossier_id, annee, profession) values ('c1a0a000-0000-4000-8111-000000000001', 2025, 'liberal_cipav') returning profession$q$,
        '42501', '%row-level security%'),
      (9, 'client', '4b. … ni ne lit', $q$select count(*)::text from volet_social_pamc where dossier_id = 'c1a0a000-0000-4000-8111-000000000001'$q$,
        'OK', '0'),
      (10, 'anon', '4c. l''anonyme ne lit rien', $q$select count(*)::text from volet_social_pamc where dossier_id = 'c1a0a000-0000-4000-8111-000000000001'$q$,
        'OK', '0')
    ) as t(rang, profil, etape, requete, code, attendu) loop
      v_code := 'OK';
      v_obs := null;
      begin
        if e.profil = 'anon' then
          execute 'set local role anon';
          perform set_config('request.jwt.claims', '{"role":"anon"}', true);
        elsif e.profil in ('chef', 'client') then
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
  perform set_config('essai.professionsCipav', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.professionsCipav')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
