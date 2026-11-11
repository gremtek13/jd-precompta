-- L'ADRESSE D'UN ACCÈS RETIRÉ DEVANT UNE SUPPRESSION (espace client, ligne 51.5, P1T-E2 ; migration
-- `adresse_des_acces_retires`) — SUR UNE RÉPLIQUE SEULEMENT : l'outil d'exécution de la production soumet toute suppression
-- à une confirmation qui n'arrive pas, et l'appel expire. Le compagnon de `adresseDesAccesRetires.sql`, à rejouer avec lui.
-- Sans la migration, une ligne dit qu'il attend (EN ATTENTE) et rien ne s'écrit.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - le retrait d'un accès que la trace nomme laisse son adresse, à l'instant du retrait — par le chef, le membre affecté,
--     le propriétaire sans session, le rôle des Edge Functions — ; un accès que la trace ne nomme pas, ou sans adresse, ne
--     laisse rien ; le client ne retire pas son accès (aucune ligne), rien de retenu ;
--   - la suppression d'un dossier, par le propriétaire comme par le chef, emporte ses accès et leurs adresses sans rien
--     retenir : le déclencheur ne retient pas un accès dont le dossier n'est plus là, la garde laisse partir la ligne ;
--   - personne ne retire une adresse : le chef (aucune policy, aucune ligne touchée), le rôle des Edge Functions et le
--     propriétaire (la garde, 23514).
--
-- Une garde de tête refuse de le jouer hors d'une réplique (ESSAI_HORS_REPLIQUE : le rôle `proprietaire` manque à la
-- production). Le jeu, les profils et le mécanisme sont ceux de `adresseDesAccesRetires.sql` (préfixe
-- `b1d70000-0000-4000-8025`) : chaque étape s'annule dans sa sous-transaction, le jeu à la fin ; « rien n'est resté » le
-- relit. Joué en UNE transaction (`psql -1`).
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  dt constant text := 'b1d70000-0000-4000-8025-0000000000d1';
  du constant text := 'b1d70000-0000-4000-8025-0000000000d2';
  acces_a constant text := 'b1d70000-0000-4000-8025-0000000000a1';
  acces_b constant text := 'b1d70000-0000-4000-8025-0000000000b1';
  acces_n constant text := 'b1d70000-0000-4000-8025-0000000000c1';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  verdicts jsonb := '[]'::jsonb;
  e record;
  v_obs text;
  v_code text;
  v_msg text;
  v_apres text;
  v_req text;
  -- Ce que la table dit des deux dossiers, relu par le propriétaire, et le nombre de retraits que la trace porte.
  resume constant text := $r$select coalesce(string_agg(
      case r.dossier_id::text when '{DT}' then 'DT' when '{DU}' then 'DU' else '?' end
      || ' ' || case r.acces_id::text when '{A}' then 'A' when '{B}' then 'B' when '{N}' then 'N' else '?' end
      || ' ' || r.adresse
      || case when r.retire_le = now() then '' else ' le ' || to_char(r.retire_le at time zone 'UTC', 'YYYY-MM-DD') end,
      ', ' order by r.dossier_id, r.acces_id, r.retire_le), 'rien')
    || ' / retraits tracés : ' || (select count(*) from trace_des_droits t where t.dossier_id in ('{DT}', '{DU}') and t.geste = 'retrait')
    from adresses_des_acces_retires r where r.dossier_id in ('{DT}', '{DU}')$r$;
  pose_n constant text := $p$select set_config('request.jwt.claims', json_build_object('sub', '{CHEF}', 'role', 'authenticated')::text, true);
    insert into memberships (id, user_id, dossier_id, role, email, droit_banque)
    values ('{N}', '{CHEF}', '{DT}', 'client', 'essai-adresse-n@example.test', true)$p$;
  pose_n_sans_case constant text := $p$select set_config('request.jwt.claims', json_build_object('sub', '{CHEF}', 'role', 'authenticated')::text, true);
    insert into memberships (id, user_id, dossier_id, role, email)
    values ('{N}', '{CHEF}', '{DT}', 'client', 'essai-adresse-n@example.test')$p$;
  pose_n_sans_adresse constant text := $p$select set_config('request.jwt.claims', json_build_object('sub', '{CHEF}', 'role', 'authenticated')::text, true);
    insert into memberships (id, user_id, dossier_id, role, email, droit_banque)
    values ('{N}', '{CHEF}', '{DT}', 'client', '  ', true)$p$;
  -- Une adresse retenue dans DT, posée par le retrait de N (propriétaire) : la ligne que les étapes 9 à 13 suppriment.
  une_ligne constant text := $p$select set_config('request.jwt.claims', json_build_object('sub', '{CHEF}', 'role', 'authenticated')::text, true);
    insert into memberships (id, user_id, dossier_id, role, email, droit_banque)
    values ('{N}', '{CHEF}', '{DT}', 'client', 'essai-adresse-n@example.test', true);
    select set_config('request.jwt.claims', '', true);
    update memberships set droit_banque = true where id = '{A}';
    delete from memberships where id = '{N}'$p$;
  retirer_n constant text := $q$with m as (delete from memberships where id = '{N}' returning 1) select count(*)::text from m$q$;
  retirer_dt constant text := $q$with d as (delete from dossiers where id = '{DT}' returning 1) select count(*)::text from d$q$;
  effacer constant text := $q$with r as (delete from adresses_des_acces_retires where dossier_id = '{DT}' returning 1) select count(*)::text from r$q$;
  ligne_lue constant text := 'DT N essai-adresse-n@example.test / retraits tracés : 1';
  refus_reecriture constant text := 'L''adresse d''un accès retiré ne se réécrit pas : elle ne part qu''avec son dossier.';
begin
  -- La garde de tête : sur une réplique seulement, avant toute écriture.
  if not exists (select 1 from pg_roles where rolname = 'proprietaire') then
    raise exception 'ESSAI_HORS_REPLIQUE : cet essai supprime des lignes et ne se joue que sur une réplique ; le rôle proprietaire, que toute réplique porte, est absent : rien n''est écrit.';
  end if;
  if to_regclass('public.adresses_des_acces_retires') is null then
    perform set_config('essai.adresse_des_acces_retires_suppression', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration adresse_des_acces_retires', 'ok', true,
      'observe', 'la table adresses_des_acces_retires absente : rien ne s''écrit'))::text, true);
    return;
  end if;

  verdicts := verdicts || jsonb_build_object('rang', 0, 'etape', '0. les profils : le chef super-administrateur et chef du cabinet, le compte d''essai ni membre ni super-administrateur',
    'ok', exists (select 1 from cabinet_admins where user_id::text = chef and cabinet_id = cabinet and role = 'comptable_en_chef')
      and exists (select 1 from super_admins where user_id::text = chef)
      and not exists (select 1 from cabinet_admins where user_id::text = client)
      and not exists (select 1 from super_admins where user_id::text = client),
    'observe', 'lus');

  begin
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, statut_tva, ventes_par_les_factures) values
      (dt::uuid, 'ESSAI ADRESSE DES ACCES RETIRES DT', cabinet, 'tresorerie', '455000', 'exonere', true),
      (du::uuid, 'ESSAI ADRESSE DES ACCES RETIRES DU', cabinet, 'tresorerie', '455000', 'exonere', true);
    insert into memberships (id, user_id, dossier_id, role, email) values
      (acces_a::uuid, client::uuid, dt::uuid, 'client', 'essai-adresse-a@example.test'),
      (acces_b::uuid, client::uuid, du::uuid, 'client', 'essai-adresse-b@example.test');

    for e in select * from (values
      (1, 'chef', '1. le chef retire un accès qui porte « Banque » : son adresse est retenue, à l''instant du retrait', 'POSE_N', 'RETIRER_N', 'R', 'OK',
        '1 | DT N essai-adresse-n@example.test / retraits tracés : 1'),
      (2, 'membre', '2. … le membre affecté au dossier aussi', 'POSE_N', 'RETIRER_N', 'R', 'OK', '1 | DT N essai-adresse-n@example.test / retraits tracés : 1'),
      (3, 'proprietaire', '3. … le propriétaire, sans session, aussi', 'POSE_N', 'RETIRER_N', 'R', 'OK', '1 | DT N essai-adresse-n@example.test / retraits tracés : 1'),
      (4, 'service', '4. … le rôle des Edge Functions aussi', 'POSE_N', 'RETIRER_N', 'R', 'OK', '1 | DT N essai-adresse-n@example.test / retraits tracés : 1'),
      (5, 'chef', '5. un accès que la trace ne nomme pas (aucune case) retiré : rien de retenu', 'POSE_N_SANS_CASE', 'RETIRER_N', 'R', 'OK', '1 | rien / retraits tracés : 0'),
      (6, 'chef', '6. un accès tracé dont l''adresse est blanche, retiré : rien de retenu, le retrait passe', 'POSE_N_SANS_ADRESSE', 'RETIRER_N', 'R', 'OK',
        '1 | rien / retraits tracés : 1'),
      (7, 'client', '7. le client ne retire pas son accès : aucune ligne, rien de retenu', null,
        $q$with m as (delete from memberships where id = '{A}' returning 1) select count(*)::text from m$q$, 'R', 'OK', '0 | rien / retraits tracés : 0'),
      (8, 'proprietaire', '8. la suppression du dossier, par le propriétaire, emporte ses accès et leurs adresses, sans rien retenir', 'UNE_LIGNE', 'RETIRER_DT', 'R', 'OK',
        '1 | rien / retraits tracés : 0'),
      (9, 'chef', '9. … par le chef aussi', 'UNE_LIGNE', 'RETIRER_DT', 'R', 'OK', '1 | rien / retraits tracés : 0'),
      (10, 'chef', '10. personne ne retire une adresse : le chef (aucune policy, aucune ligne touchée)', 'UNE_LIGNE', 'EFFACER', 'R', 'OK', '0 | LIGNE'),
      (11, 'service', '11. … le rôle des Edge Functions (la garde, 23514)', 'UNE_LIGNE', 'EFFACER', 'R', '23514', 'REECRITURE'),
      (12, 'proprietaire', '12. … le propriétaire (la garde, 23514)', 'UNE_LIGNE', 'EFFACER', 'R', '23514', 'REECRITURE')
    ) as t(rang, profil, etape, avant, requete, apres, code, attendu) order by rang loop
      v_obs := null;
      v_code := 'OK';
      v_msg := '';
      v_apres := null;
      begin
        perform set_config('request.jwt.claims', '', true);
        if e.profil in ('membre', 'membre_ailleurs') then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client::uuid, cabinet, 'comptable');
          insert into dossier_assignations (dossier_id, user_id)
            values (case when e.profil = 'membre' then dt else du end::uuid, client::uuid);
        end if;
        if e.avant is not null then
          v_req := case e.avant when 'POSE_N' then pose_n when 'POSE_N_SANS_CASE' then pose_n_sans_case
                     when 'POSE_N_SANS_ADRESSE' then pose_n_sans_adresse when 'UNE_LIGNE' then une_ligne else e.avant end;
          execute replace(replace(replace(replace(replace(replace(replace(v_req, '{DT}', dt), '{DU}', du), '{A}', acces_a), '{B}', acces_b),
            '{N}', acces_n), '{CHEF}', chef), '{CLIENT}', client);
          perform set_config('request.jwt.claims', '', true);
        end if;
        v_req := case e.requete when 'RETIRER_N' then retirer_n when 'RETIRER_DT' then retirer_dt when 'EFFACER' then effacer else e.requete end;
        v_req := replace(replace(replace(replace(replace(replace(replace(v_req, '{DT}', dt), '{DU}', du), '{A}', acces_a), '{B}', acces_b),
          '{N}', acces_n), '{CHEF}', chef), '{CLIENT}', client);
        begin
          if e.profil = 'service' then
            execute 'set local role service_role';
            perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
          elsif e.profil <> 'proprietaire' then
            execute 'set local role authenticated';
            perform set_config('request.jwt.claims',
              json_build_object('sub', case e.profil when 'chef' then chef else client end, 'role', 'authenticated')::text, true);
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
        if e.apres = 'R' then
          execute replace(replace(replace(replace(replace(replace(replace(resume, '{DT}', dt), '{DU}', du), '{A}', acces_a), '{B}', acces_b),
            '{N}', acces_n), '{CHEF}', chef), '{CLIENT}', client) into v_apres;
        end if;
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
        'ok', v_code = e.code and v_msg || ' | ' || coalesce(v_apres, '-')
          = case e.attendu when 'REECRITURE' then refus_reecriture || ' | ' || ligne_lue
                           else replace(e.attendu, 'LIGNE', ligne_lue) end,
        'observe', v_code || ' ' || v_msg || ' | ' || coalesce(v_apres, '-'));
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni leurs accès, ni leur trace, ni leurs adresses, ni le compte d''essai dans le cabinet',
    'ok', not exists (select 1 from dossiers where id in (dt::uuid, du::uuid))
      and not exists (select 1 from memberships where id in (acces_a::uuid, acces_b::uuid, acces_n::uuid))
      and not exists (select 1 from trace_des_droits where dossier_id in (dt::uuid, du::uuid))
      and not exists (select 1 from adresses_des_acces_retires where dossier_id in (dt::uuid, du::uuid))
      and not exists (select 1 from cabinet_admins where user_id::text = client)
      and not exists (select 1 from dossier_assignations where user_id::text = client),
    'observe', 'relu');
  perform set_config('essai.adresse_des_acces_retires_suppression', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.adresse_des_acces_retires_suppression')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
