-- L'ALERTE DE HAUSSE DU CHIFFRE D'AFFAIRES DEVANT UNE SUPPRESSION (la migration `hausse_du_chiffre_d_affaires`, PRÉPARÉE le
-- 15/11/2026) — SUR UNE RÉPLIQUE SEULEMENT : l'outil d'exécution de la production soumet toute suppression à une confirmation
-- qui n'arrive pas, et l'appel expire. Le compagnon de `hausseDuChiffreDAffaires.sql`, à rejouer avec lui, par psql (`-f`),
-- sous le propriétaire, après toute migration qui touche les deux tables, leurs gardes ou leurs policies. Sans la migration,
-- une ligne dit qu'il attend (EN ATTENTE) et rien ne s'écrit.
--
-- Ce qui se prouve ici, et ne se relit pas : le chef ne retire pas une marque (aucune policy de retrait : aucune ligne) ; le
-- propriétaire non plus (la garde, 23514) ; le chef retire le seuil de son dossier (la policy du cabinet le permet : sans
-- seuil, pas d'alerte) ; la suppression du dossier emporte son seuil et ses marques, sans que la garde la retienne. Un dossier
-- jetable du cabinet du dossier `test` ; tout s'annule à la fin. Une garde de tête refuse de le jouer hors d'une réplique
-- (ESSAI_HORS_REPLIQUE : le rôle `proprietaire` manque à la production).

do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier constant text := 'ca520000-0000-4000-8000-0000000000d2';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  verdicts jsonb := '[]'::jsonb;
  e record;
  v_obs text;
  v_code text;
  v_msg text;
begin
  -- La garde de tête (le patron d'AUDIT-Q1) : sur une réplique seulement, avant toute écriture.
  if not exists (select 1 from pg_roles where rolname = 'proprietaire') then
    raise exception 'ESSAI_HORS_REPLIQUE : cet essai supprime des lignes et ne se joue que sur une réplique ; le rôle proprietaire, que toute réplique porte, est absent : rien n''est écrit.';
  end if;
  if to_regclass('public.hausses_vues_avec_le_client') is null then
    perform set_config('essai.hausse_du_ca_suppression', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration hausse_du_chiffre_d_affaires', 'ok', true,
      'observe', 'absente : rien ne s''écrit'))::text, true);
    return;
  end if;

  begin
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, statut_tva) values
      (dossier::uuid, 'ESSAI HAUSSE DU CHIFFRE D''AFFAIRES (SUPPRESSION)', cabinet, 'tresorerie', '455000', 'exonere');
    -- Par le chef (le super-administrateur d'essai) : un seuil, et deux marques de trimestres clos depuis longtemps.
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    insert into seuils_du_chiffre_d_affaires (dossier_id, seuil_de_hausse, regle_par) values (dossier::uuid, 20, chef::uuid);
    insert into hausses_vues_avec_le_client (dossier_id, annee, trimestre, vue_par) values
      (dossier::uuid, 2024, 1, chef::uuid), (dossier::uuid, 2024, 2, chef::uuid);
    reset role;
    perform set_config('request.jwt.claims', '', true);

    for e in select * from (values
      (1, 'chef', '1. le chef ne retire pas une marque : aucune policy de retrait, aucune ligne', $q$with s as (delete from hausses_vues_avec_le_client where dossier_id = 'ca520000-0000-4000-8000-0000000000d2' and trimestre = 1 returning 1) select count(*) from s$q$, 'OK', '0'),
      (2, 'proprietaire', '2. ni le propriétaire, que la garde refuse', $q$delete from hausses_vues_avec_le_client where dossier_id = 'ca520000-0000-4000-8000-0000000000d2' and trimestre = 1$q$,
        '23514', 'Une hausse vue avec le client ne se retire pas : elle part avec son dossier.'),
      (3, 'chef', '3. le chef retire le seuil de son dossier : plus d''alerte', $q$with s as (delete from seuils_du_chiffre_d_affaires where dossier_id = 'ca520000-0000-4000-8000-0000000000d2' returning 1) select count(*) from s$q$, 'OK', '1'),
      (4, 'proprietaire', '4. la suppression du dossier emporte ses marques, la garde ne la retient pas', $q$with s as (delete from dossiers where id = 'ca520000-0000-4000-8000-0000000000d2' returning 1)
  select count(*) from s$q$, 'OK', '1'),
      (5, 'proprietaire', '4b. … plus rien du dossier', $q$select (select count(*) from hausses_vues_avec_le_client where dossier_id = 'ca520000-0000-4000-8000-0000000000d2')
  || '|' || (select count(*) from seuils_du_chiffre_d_affaires where dossier_id = 'ca520000-0000-4000-8000-0000000000d2')$q$, 'OK', '0|0')
    ) as t(rang, profil, etape, requete, code, attendu) order by rang loop
      v_obs := null;
      v_code := 'OK';
      v_msg := '';
      begin
        if e.profil <> 'proprietaire' then
          execute 'set local role authenticated';
          perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
        end if;
        execute e.requete into v_obs;
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
  perform set_config('essai.hausse_du_ca_suppression', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.hausse_du_ca_suppression')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
