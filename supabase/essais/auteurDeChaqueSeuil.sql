-- L'AUTEUR ET L'INSTANT DE CHAQUE SEUIL DE L'ALERTE DU CHIFFRE D'AFFAIRES (CA2-Q1 ; la migration `auteur_de_chaque_seuil`,
-- en production depuis le 17/11/2026, supabase/schema/20261117133253_auteur_de_chaque_seuil.sql). Le récit : HISTORIQUE.md,
-- « 16/11/2026 — CA2-Q1 : L'AUTEUR DE CHAQUE SEUIL », « 17/11/2026 — CA2-Q1 ET RET2-Q2 EN PRODUCTION ». À rejouer par `execute_sql` après toute migration qui touche
-- `seuils_du_chiffre_d_affaires`, sa garde, `regler_seuil_du_chiffre_d_affaires` ou `is_super_admin`. Les droits du client, d'un
-- compte qu'aucun accès ne nomme et de l'anonyme ne changent pas : hausseDuChiffreDAffaires.sql les éprouve.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - le catalogue : les quatre colonnes, nullables, et leurs deux contraintes au texte près ;
--   - par la fonction, sous un compte du cabinet qui n'est pas super-administrateur (le client d'essai, rattaché au cabinet du
--     dossier le temps du jeu, que l'annulation retire) et sous le super-administrateur (le chef d'essai) : chaque seuil prend le
--     compte et l'instant de SON réglage, l'autre garde les siens ; un seuil retiré garde qui l'a retiré ; un réglage qui ne
--     change pas le seuil n'écrit rien ; le dernier réglage de la ligne suit ;
--   - en direct : un compte qui n'est pas super-administrateur ne choisit ni le compte ni l'instant d'un seuil — ceux qu'il y
--     écrit sont écartés, ceux de l'écriture posés quand le seuil change, ceux d'avant gardés sinon ; à l'insertion, un seuil nul
--     n'a pas de réglage ;
--   - la porte de la restauration : le super-administrateur garde ce qu'il écrit ; un seuil qu'il écrit avec une valeur et sans
--     réglage à lui (une sauvegarde d'avant la migration) prend le dernier réglage de la ligne ; un compte sans instant, ou un
--     seuil sans réglage écrit par un autre chemin, se refusent (les contraintes).
-- Les instants posés par la base sont ceux de la transaction (`now()`), le même pour toutes les étapes : ce qui distingue un
-- réglage d'un autre est son compte, et les instants écrits d'avance par le super-administrateur (des dates de 2020 à 2023).
-- Trois dossiers jetables du cabinet du dossier `test` (préfixe `ca5a0000-0000-4000-8000`). Chaque étape se joue dans sa
-- sous-transaction ; le jeu s'annule à la fin (`ANNULATION_ESSAI_GLOBALE`). Les verdicts voyagent dans un réglage LOCAL à la
-- transaction (`essai.auteur_de_chaque_seuil`), que la requête finale lit : le fichier se joue d'un seul appel, ne crée ni table
-- ni fonction, ne contient aucune instruction de suppression, et ne rend rien qui dépende d'une ligne hors de ses dossiers.
-- Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`). Sans la migration, une ligne dit qu'il attend (EN
-- ATTENTE) et rien ne s'écrit.

do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  -- Le second compte du cabinet, qui n'est pas super-administrateur : le client d'essai, rattaché le temps du jeu.
  second constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  dossier constant text := 'ca5a0000-0000-4000-8000-0000000000d1';
  dossier2 constant text := 'ca5a0000-0000-4000-8000-0000000000d2';
  dossier3 constant text := 'ca5a0000-0000-4000-8000-0000000000d3';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  verdicts jsonb := '[]'::jsonb;
  e record;
  v_req text;
  v_obs text;
  v_code text;
  v_msg text;
begin
  if not exists (select 1 from pg_attribute a where a.attrelid = to_regclass('public.seuils_du_chiffre_d_affaires')
                  and a.attname = 'seuil_de_hausse_regle_par' and not a.attisdropped) then
    perform set_config('essai.auteur_de_chaque_seuil', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration auteur_de_chaque_seuil', 'ok', true,
      'observe', 'absente : l''essai se joue dès que la migration y est'))::text, true);
    return;
  end if;

  begin
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, statut_tva) values
      (dossier::uuid, 'ESSAI AUTEUR DE CHAQUE SEUIL', cabinet, 'tresorerie', '455000', 'exonere'),
      (dossier2::uuid, 'ESSAI AUTEUR DE CHAQUE SEUIL 2', cabinet, 'tresorerie', '455000', 'exonere'),
      (dossier3::uuid, 'ESSAI AUTEUR DE CHAQUE SEUIL 3', cabinet, 'tresorerie', '455000', 'exonere');
    insert into cabinet_admins (user_id, cabinet_id, role) values (second::uuid, cabinet, 'comptable_en_chef');

    for e in select * from (values
      (1, 'proprietaire', '0. le chef est super-administrateur ; le second compte, chef du cabinet du dossier, ne l''est pas', $q$select (select count(*) from super_admins where user_id = 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162')
  || '|' || (select count(*) from super_admins where user_id = '797fe440-df8d-4b8e-828b-d148927bfd60')
  || '|' || (select count(*) from cabinet_admins where user_id = '797fe440-df8d-4b8e-828b-d148927bfd60'
    and cabinet_id = (select cabinet_id from dossiers where id = '{D}'))$q$, 'OK', '1|0|1'),
      (2, 'proprietaire', '1. le catalogue : les quatre colonnes, nullables, après les sept d''hier', $q$select string_agg(a.attname || ':'
  || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' order by a.attnum)
  from pg_attribute a where a.attrelid = 'public.seuils_du_chiffre_d_affaires'::regclass and a.attnum > 0 and not a.attisdropped
    and a.attname in ('seuil_de_hausse_regle_par', 'seuil_de_hausse_regle_le', 'seuil_de_baisse_regle_par', 'seuil_de_baisse_regle_le')$q$,
        'OK', 'seuil_de_hausse_regle_par:uuid:false,seuil_de_hausse_regle_le:timestamp with time zone:false,seuil_de_baisse_regle_par:uuid:false,seuil_de_baisse_regle_le:timestamp with time zone:false'),
      (3, 'proprietaire', '1b. … leurs deux contraintes, validées, au texte près', $q$select string_agg(c.conname || ':' || c.convalidated || ':' || pg_get_constraintdef(c.oid), ' ; ' order by c.conname)
  from pg_constraint c where c.conrelid = 'public.seuils_du_chiffre_d_affaires'::regclass and c.conname in ('seuils_du_chiffre_d_affaires_reglage_de_hausse', 'seuils_du_chiffre_d_affaires_reglage_de_baisse')$q$,
        'OK', 'seuils_du_chiffre_d_affaires_reglage_de_baisse:true:CHECK ((((seuil_de_baisse_regle_par IS NULL) = (seuil_de_baisse_regle_le IS NULL)) AND ((seuil_de_baisse IS NULL) OR (seuil_de_baisse_regle_par IS NOT NULL)))) ; seuils_du_chiffre_d_affaires_reglage_de_hausse:true:CHECK ((((seuil_de_hausse_regle_par IS NULL) = (seuil_de_hausse_regle_le IS NULL)) AND ((seuil_de_hausse IS NULL) OR (seuil_de_hausse_regle_par IS NOT NULL))))'),
      (4, 'second', '2. le second compte règle la hausse à 20 %, sur une lecture vide', $q$select regler_seuil_du_chiffre_d_affaires('{D}', 'hausse', null, 20)::text$q$, 'OK', '20'),
      (5, 'second', '2b. … la hausse à son compte et à l''instant de l''écriture ; la baisse, sans réglage ; la ligne, à lui', $q$select seuil_de_hausse || '|' || (seuil_de_hausse_regle_par = '797fe440-df8d-4b8e-828b-d148927bfd60') || '|' || (seuil_de_hausse_regle_le = now())
  || '|' || coalesce(seuil_de_baisse::text, 'nul') || '|' || coalesce(seuil_de_baisse_regle_par::text, 'nul') || '|' || coalesce(seuil_de_baisse_regle_le::text, 'nul')
  || '|' || (regle_par = '797fe440-df8d-4b8e-828b-d148927bfd60') || '|' || (regle_le = now())
  from seuils_du_chiffre_d_affaires where dossier_id = '{D}'$q$, 'OK', '20|true|true|nul|nul|nul|true|true'),
      (6, 'chef', '3. le chef (super-administrateur) règle la baisse à 15 %, par la fonction', $q$select regler_seuil_du_chiffre_d_affaires('{D}', 'baisse', null, 15)::text$q$, 'OK', '15'),
      (7, 'chef', '3b. … la baisse à son compte, la hausse toujours au second compte, la ligne au chef', $q$select (seuil_de_hausse_regle_par = '797fe440-df8d-4b8e-828b-d148927bfd60') || '|' || seuil_de_baisse
  || '|' || (seuil_de_baisse_regle_par = 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162') || '|' || (seuil_de_baisse_regle_le = now())
  || '|' || (regle_par = 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162')
  from seuils_du_chiffre_d_affaires where dossier_id = '{D}'$q$, 'OK', 'true|15|true|true|true'),
      (8, 'chef', '4. le super-administrateur, la porte de la restauration, garde les comptes et les instants qu''il écrit', $q$with u as (update seuils_du_chiffre_d_affaires set
  seuil_de_hausse_regle_par = 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162', seuil_de_hausse_regle_le = '2020-01-01',
  seuil_de_baisse_regle_par = '797fe440-df8d-4b8e-828b-d148927bfd60', seuil_de_baisse_regle_le = '2021-01-01',
  regle_par = 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162', regle_le = '2022-01-01'
  where dossier_id = '{D}' returning *)
  select (seuil_de_hausse_regle_par = 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162') || '|' || (seuil_de_hausse_regle_le = '2020-01-01')
  || '|' || (seuil_de_baisse_regle_par = '797fe440-df8d-4b8e-828b-d148927bfd60') || '|' || (seuil_de_baisse_regle_le = '2021-01-01')
  || '|' || (regle_le = '2022-01-01') from u$q$, 'OK', 'true|true|true|true|true'),
      (9, 'second', '5. un réglage qui ne change pas le seuil (20 % contre 20 %) rend sa valeur', $q$select regler_seuil_du_chiffre_d_affaires('{D}', 'hausse', 20, 20)::text$q$, 'OK', '20'),
      (10, 'second', '5b. … et n''a rien écrit : ni la hausse, ni la ligne n''ont bougé', $q$select (seuil_de_hausse_regle_par = 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162') || '|' || (seuil_de_hausse_regle_le = '2020-01-01')
  || '|' || (regle_par = 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162') || '|' || (regle_le = '2022-01-01')
  from seuils_du_chiffre_d_affaires where dossier_id = '{D}'$q$, 'OK', 'true|true|true|true'),
      (11, 'second', '6. le second compte règle la hausse à 25 %', $q$select regler_seuil_du_chiffre_d_affaires('{D}', 'hausse', 20, 25)::text$q$, 'OK', '25'),
      (12, 'second', '6b. … la hausse à lui, maintenant ; la baisse garde son compte et son instant de 2021 ; la ligne à lui', $q$select (seuil_de_hausse_regle_par = '797fe440-df8d-4b8e-828b-d148927bfd60') || '|' || (seuil_de_hausse_regle_le = now())
  || '|' || (seuil_de_baisse_regle_par = '797fe440-df8d-4b8e-828b-d148927bfd60') || '|' || (seuil_de_baisse_regle_le = '2021-01-01')
  || '|' || (regle_par = '797fe440-df8d-4b8e-828b-d148927bfd60') || '|' || (regle_le = now())
  from seuils_du_chiffre_d_affaires where dossier_id = '{D}'$q$, 'OK', 'true|true|true|true|true|true'),
      (13, 'second', '7. il retire la hausse', $q$select coalesce(regler_seuil_du_chiffre_d_affaires('{D}', 'hausse', 25, null)::text, 'nul')$q$, 'OK', 'nul'),
      (14, 'second', '7b. … la hausse nulle garde qui l''a retirée et quand', $q$select coalesce(seuil_de_hausse::text, 'nul') || '|' || (seuil_de_hausse_regle_par = '797fe440-df8d-4b8e-828b-d148927bfd60') || '|' || (seuil_de_hausse_regle_le = now())
  from seuils_du_chiffre_d_affaires where dossier_id = '{D}'$q$, 'OK', 'nul|true|true'),
      (15, 'second', '8. en direct, le compte et l''instant qu''il écrit sur la baisse, inchangée, sont écartés : ceux de 2021 restent', $q$with u as (update seuils_du_chiffre_d_affaires set
  seuil_de_baisse_regle_par = 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162', seuil_de_baisse_regle_le = '2000-01-01'
  where dossier_id = '{D}' returning seuil_de_baisse_regle_par, seuil_de_baisse_regle_le)
  select (seuil_de_baisse_regle_par = '797fe440-df8d-4b8e-828b-d148927bfd60') || '|' || (seuil_de_baisse_regle_le = '2021-01-01') from u$q$, 'OK', 'true|true'),
      (16, 'second', '8b. … la baisse changée en direct, avec un autre compte écrit : celui de l''écriture, maintenant', $q$with u as (update seuils_du_chiffre_d_affaires set seuil_de_baisse = 40,
  seuil_de_baisse_regle_par = 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162', seuil_de_baisse_regle_le = '2000-01-01'
  where dossier_id = '{D}' returning seuil_de_baisse, seuil_de_baisse_regle_par, seuil_de_baisse_regle_le)
  select seuil_de_baisse || '|' || (seuil_de_baisse_regle_par = '797fe440-df8d-4b8e-828b-d148927bfd60') || '|' || (seuil_de_baisse_regle_le = now()) from u$q$, 'OK', '40|true|true'),
      (17, 'second', '8c. une ligne insérée en direct : la hausse à l''écriture, la baisse nulle sans réglage, rien de ce qui était écrit', $q$with i as (insert into seuils_du_chiffre_d_affaires (dossier_id, seuil_de_hausse, seuil_de_hausse_regle_par, seuil_de_hausse_regle_le,
  seuil_de_baisse_regle_par, seuil_de_baisse_regle_le, regle_par, regle_le)
  values ('{D2}', 10, 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162', '2000-01-01', 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162', '2000-01-01',
    'bd6bd047-0ef0-4c9d-a319-1b642aaf2162', '2000-01-01') returning *)
  select (seuil_de_hausse_regle_par = '797fe440-df8d-4b8e-828b-d148927bfd60') || '|' || (seuil_de_hausse_regle_le = now())
  || '|' || coalesce(seuil_de_baisse_regle_par::text, 'nul') || '|' || coalesce(seuil_de_baisse_regle_le::text, 'nul')
  || '|' || (regle_par = '797fe440-df8d-4b8e-828b-d148927bfd60') from i$q$, 'OK', 'true|true|nul|nul|true'),
      (18, 'chef', '9. le super-administrateur restaure une ligne d''avant la migration : chaque seuil non nul prend le dernier réglage de la ligne, le nul reste sans réglage', $q$with i as (insert into seuils_du_chiffre_d_affaires (dossier_id, seuil_de_hausse, seuil_de_baisse, regle_par, regle_le)
  values ('{D3}', 30, null, '797fe440-df8d-4b8e-828b-d148927bfd60', '2023-05-01') returning *)
  select (seuil_de_hausse_regle_par = '797fe440-df8d-4b8e-828b-d148927bfd60') || '|' || (seuil_de_hausse_regle_le = '2023-05-01')
  || '|' || coalesce(seuil_de_baisse_regle_par::text, 'nul') || '|' || coalesce(seuil_de_baisse_regle_le::text, 'nul') from i$q$, 'OK', 'true|true|nul|nul'),
      (19, 'chef', '9b. … une baisse posée en direct sans réglage à elle prend aussi celui de la ligne', $q$with u as (update seuils_du_chiffre_d_affaires set seuil_de_baisse = 50, regle_par = 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162', regle_le = '2023-06-01'
  where dossier_id = '{D3}' returning *)
  select (seuil_de_baisse_regle_par = 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162') || '|' || (seuil_de_baisse_regle_le = '2023-06-01')
  || '|' || (seuil_de_hausse_regle_par = '797fe440-df8d-4b8e-828b-d148927bfd60') || '|' || (seuil_de_hausse_regle_le = '2023-05-01') from u$q$, 'OK', 'true|true|true|true'),
      (20, 'chef', '9c. … un compte sans instant se refuse', $q$update seuils_du_chiffre_d_affaires set seuil_de_hausse_regle_le = null where dossier_id = '{D3}'$q$,
        '23514', '%seuils_du_chiffre_d_affaires_reglage_de_hausse%'),
      (21, 'chef', '9d. … un instant sans compte, sur un seuil nul, aussi', $q$update seuils_du_chiffre_d_affaires set seuil_de_baisse = null, seuil_de_baisse_regle_par = null where dossier_id = '{D3}'$q$,
        '23514', '%seuils_du_chiffre_d_affaires_reglage_de_baisse%'),
      (22, 'chef', '9e. … un seuil nul retiré par un compte connu se restaure tel quel', $q$with u as (update seuils_du_chiffre_d_affaires set seuil_de_baisse = null where dossier_id = '{D3}' returning *)
  select coalesce(seuil_de_baisse::text, 'nul') || '|' || (seuil_de_baisse_regle_par = 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162') || '|' || (seuil_de_baisse_regle_le = '2023-06-01') from u$q$, 'OK', 'nul|true|true'),
      (23, 'chef', '9f. le super-administrateur règle par la fonction une hausse déjà réglée par un autre : elle passe à son compte, maintenant', $q$select regler_seuil_du_chiffre_d_affaires('{D3}', 'hausse', 30, 35)::text$q$, 'OK', '35'),
      (24, 'chef', '9g. … relue : la hausse à 35 %, au chef, maintenant ; la ligne au chef', $q$select seuil_de_hausse || '|' || (seuil_de_hausse_regle_par = 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162') || '|' || (seuil_de_hausse_regle_le = now())
  || '|' || (regle_par = 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162') from seuils_du_chiffre_d_affaires where dossier_id = '{D3}'$q$, 'OK', '35|true|true|true'),
      (25, 'chef', '10. ce qui est resté du jeu, relu : les trois lignes, chaque seuil à son réglage (le chef, le second compte, ou aucun)', $q$select string_agg(coalesce(seuil_de_hausse::text, 'nul') || ':'
  || case when seuil_de_hausse_regle_par is null then 'aucun' when seuil_de_hausse_regle_par = 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162' then 'chef' when seuil_de_hausse_regle_par = '797fe440-df8d-4b8e-828b-d148927bfd60' then 'second' else 'autre' end
  || ':' || coalesce(seuil_de_baisse::text, 'nul') || ':'
  || case when seuil_de_baisse_regle_par is null then 'aucun' when seuil_de_baisse_regle_par = 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162' then 'chef' when seuil_de_baisse_regle_par = '797fe440-df8d-4b8e-828b-d148927bfd60' then 'second' else 'autre' end,
  ' ; ' order by dossier_id)
  from seuils_du_chiffre_d_affaires where dossier_id in ('{D}', '{D2}', '{D3}')$q$, 'OK', 'nul:second:40:second ; 10:second:nul:aucun ; 35:chef:nul:chef')
    ) as t(rang, profil, etape, requete, code, attendu) order by rang loop
      v_obs := null;
      v_code := 'OK';
      v_msg := '';
      v_req := replace(replace(replace(e.requete, '{D}', dossier), '{D2}', dossier2), '{D3}', dossier3);
      begin
        if e.profil <> 'proprietaire' then
          execute 'set local role authenticated';
          perform set_config('request.jwt.claims', json_build_object('sub',
            case e.profil when 'chef' then chef else second end, 'role', 'authenticated')::text, true);
        end if;
        execute v_req into v_obs;
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
  -- Rien n'est resté du jeu : les dossiers jetables, leurs seuils et le rattachement du second compte sont partis avec
  -- l'annulation.
  verdicts := verdicts || jsonb_build_object('rang', 26, 'etape', '11. rien n''est resté du jeu',
    'ok', not exists (select 1 from dossiers where id in (dossier::uuid, dossier2::uuid, dossier3::uuid))
      and not exists (select 1 from seuils_du_chiffre_d_affaires where dossier_id in (dossier::uuid, dossier2::uuid, dossier3::uuid))
      and not exists (select 1 from cabinet_admins where user_id = second::uuid),
    'observe', 'relu après l''annulation');
  perform set_config('essai.auteur_de_chaque_seuil', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.auteur_de_chaque_seuil')::jsonb) as v(rang numeric, etape text, ok boolean, observe text)
order by v.rang;
