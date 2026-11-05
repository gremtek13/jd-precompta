-- LA TRACE DES DROITS DEVANT UNE SUPPRESSION (espace client, étape P1-trace ; migration `trace_des_droits`) — SUR UNE
-- RÉPLIQUE SEULEMENT : l'outil d'exécution de la production soumet toute suppression à une confirmation qui n'arrive pas,
-- et l'appel expire. Le compagnon de `traceDesDroits.sql`, à rejouer avec lui, après toute migration qui touche
-- `memberships`, ses policies, `trace_des_droits` ou ses fonctions. Sans la migration, une ligne dit qu'il attend (EN
-- ATTENTE) et rien ne s'écrit.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - le retrait d'un accès qui porte des cases les écrit en « retrait », à son auteur — le chef, le membre affecté, le
--     propriétaire sans session, le rôle des Edge Functions — ; un accès sans case n'écrit rien ; le client ne retire pas
--     son accès (la policy d'hier : aucune ligne), rien de tracé ;
--   - la suppression d'un dossier, par le propriétaire comme par le chef, emporte ses accès et leur trace sans rien écrire :
--     le déclencheur ne trace pas un accès dont le dossier n'est plus là, la garde laisse partir la ligne avec lui ;
--   - personne ne retire une ligne de la trace : le chef (aucune policy, aucune ligne touchée), le rôle des Edge Functions
--     et le propriétaire (la garde, 23514).
--
-- Une garde de tête refuse de le jouer hors d'une réplique (ESSAI_HORS_REPLIQUE : le rôle `proprietaire` manque à la
-- production). Le jeu, les profils et le mécanisme sont ceux de `traceDesDroits.sql` (préfixe `b1d70000-0000-4000-8024`) : chaque étape
-- s'annule dans sa sous-transaction, le jeu à la fin ; « rien n'est resté » le relit. Joué en UNE transaction (`psql -1`).
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  dt constant text := 'b1d70000-0000-4000-8024-0000000000d1';
  du constant text := 'b1d70000-0000-4000-8024-0000000000d2';
  acces_a constant text := 'b1d70000-0000-4000-8024-0000000000a1';
  acces_b constant text := 'b1d70000-0000-4000-8024-0000000000b1';
  acces_n constant text := 'b1d70000-0000-4000-8024-0000000000c1';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  verdicts jsonb := '[]'::jsonb;
  e record;
  v_obs text;
  v_code text;
  v_msg text;
  v_apres text;
  v_req text;
  -- Ce que la trace des deux dossiers dit, relu par le propriétaire : le dossier, l'accès (« (chef) » quand c'est celui
  -- du compte du chef), le droit, la case, le geste, l'auteur, et le jour quand ce n'est pas l'instant de l'étape.
  resume constant text := $r$select coalesce(string_agg(
      case t.dossier_id::text when '{DT}' then 'DT' when '{DU}' then 'DU' else '?' end
      || ' ' || case t.acces_id::text when '{A}' then 'A' when '{B}' then 'B' when '{N}' then 'N' else '?' end
      || case t.client_id::text when '{CLIENT}' then '' when '{CHEF}' then '(chef)' else '(?)' end
      || ' ' || t.droit || ' ' || case when t.coche then 'cochée' else 'décochée' end || ' ' || t.geste || ' par '
      || case when t.auteur_id is null then 'sans session' when t.auteur_id::text = '{CHEF}' then 'le chef'
              when t.auteur_id::text = '{CLIENT}' then 'le compte d''essai' else 'un autre' end
      || case when t.fait_le = now() then '' else ' le ' || to_char(t.fait_le at time zone 'UTC', 'YYYY-MM-DD') end,
      ', ' order by t.dossier_id, t.acces_id, t.droit, t.geste, t.coche desc), 'rien')
    from trace_des_droits t where t.dossier_id in ('{DT}', '{DU}')$r$;
  -- L'accès du compte du chef, réinséré par le super-administrateur (la porte de la restauration : rien de tracé), « Banque »
  -- cochée — le jeu de l'étape 18.
  -- Les cases d'un accès posées avant l'étape, par le propriétaire sous la session du chef (tracées, à lui) ou sans session.
  cases_du_chef constant text := $p$select set_config('request.jwt.claims', json_build_object('sub', '{CHEF}', 'role', 'authenticated')::text, true);
    update memberships set droit_banque = true, droit_caisse = true where id = '{A}'$p$;
  une_ligne constant text := $p$update memberships set droit_banque = true where id = '{A}' and not droit_banque$p$;
  retirer_a constant text := $q$with m as (delete from memberships where id = '{A}' returning 1) select count(*)::text from m$q$;
  retirer_dt constant text := $q$with d as (delete from dossiers where id = '{DT}' returning 1) select count(*)::text from d$q$;
  effacer constant text := $q$with t as (delete from trace_des_droits where dossier_id = '{DT}' returning 1) select count(*)::text from t$q$;
  ligne_lue constant text := 'DT A banque cochée changement par sans session';
  refus_reecriture constant text := 'La trace des droits ne se réécrit pas : une ligne ne part qu''avec son dossier.';
begin
  -- La garde de tête (le patron d'AUDIT-Q1) : sur une réplique seulement, avant toute écriture.
  if not exists (select 1 from pg_roles where rolname = 'proprietaire') then
    raise exception 'ESSAI_HORS_REPLIQUE : cet essai supprime des lignes et ne se joue que sur une réplique ; le rôle proprietaire, que toute réplique porte, est absent : rien n''est écrit.';
  end if;
  if to_regclass('public.trace_des_droits') is null then
    perform set_config('essai.trace_des_droits_suppression', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration trace_des_droits', 'ok', true,
      'observe', 'la table trace_des_droits absente : rien ne s''écrit'))::text, true);
    return;
  end if;

  -- Ce que les profils supposent : le chef, super-administrateur et chef du cabinet ; le compte d'essai, ni l'un ni l'autre.
  verdicts := verdicts || jsonb_build_object('rang', 0, 'etape', '0. les profils : le chef super-administrateur et chef du cabinet, le compte d''essai ni membre ni super-administrateur',
    'ok', exists (select 1 from cabinet_admins where user_id::text = chef and cabinet_id = cabinet and role = 'comptable_en_chef')
      and exists (select 1 from super_admins where user_id::text = chef)
      and not exists (select 1 from cabinet_admins where user_id::text = client)
      and not exists (select 1 from super_admins where user_id::text = client),
    'observe', 'lus');

  begin
    -- Le jeu : deux dossiers jetables, exonérés et basculés (les gardes des cases « Ventes » et « Caisse » les admettent) ;
    -- un accès sans droit du client d'essai à chacun, inséré par le propriétaire comme `create-client-access` l'insère.
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, statut_tva, ventes_par_les_factures) values
      (dt::uuid, 'ESSAI TRACE DES DROITS DT', cabinet, 'tresorerie', '455000', 'exonere', true),
      (du::uuid, 'ESSAI TRACE DES DROITS DU', cabinet, 'tresorerie', '455000', 'exonere', true);
    insert into memberships (id, user_id, dossier_id, role, email) values
      (acces_a::uuid, client::uuid, dt::uuid, 'client', 'essai-trace-a@example.test'),
      (acces_b::uuid, client::uuid, du::uuid, 'client', 'essai-trace-b@example.test');

    -- Une étape : {rang, profil — `chef` (super-administrateur), `chef_simple` (un chef qui ne l'est pas), `membre` (affecté
    -- à DT), `membre_ailleurs` (affecté à DU seul), `client`, `service` (le rôle des Edge Functions), `anon`, ou
    -- `proprietaire` (sans session) —, étape, ce que le propriétaire pose d'abord, la requête du profil, ce que le
    -- propriétaire relit après (`R` : la trace des deux dossiers), le code attendu (`OK` : acceptée), ce qui est attendu :
    -- « la valeur rendue | ce qui est relu »}.
    for e in select * from (values
      (1, 'chef', '1. le chef retire un accès qui porte « Banque » et « Caisse » : deux lignes en « retrait », à lui', 'CASES_DU_CHEF', 'RETIRER_A', 'R', 'OK',
        '1 | DT A banque cochée changement par le chef, DT A banque décochée retrait par le chef, DT A caisse cochée changement par le chef, DT A caisse décochée retrait par le chef'),
      (2, 'chef', '2. un accès sans case retiré : rien de tracé', null,
        $q$with m as (delete from memberships where id = '{B}' returning 1) select count(*)::text from m$q$, 'R', 'OK', '1 | rien'),
      (3, 'membre', '3. le membre affecté retire un accès qui porte « Banque » : une ligne, à lui', 'UNE_LIGNE', 'RETIRER_A', 'R', 'OK',
        '1 | LIGNE, DT A banque décochée retrait par le compte d''essai'),
      (4, 'client', '4. le client ne retire pas son accès (aucune ligne touchée) : rien de tracé', 'UNE_LIGNE', 'RETIRER_A', 'R', 'OK', '0 | LIGNE'),
      (5, 'proprietaire', '5. le propriétaire, sans session : tracé, sans auteur', 'UNE_LIGNE', 'RETIRER_A', 'R', 'OK',
        '1 | LIGNE, DT A banque décochée retrait par sans session'),
      (6, 'service', '6. le rôle des Edge Functions : tracé, sans auteur', 'UNE_LIGNE', 'RETIRER_A', 'R', 'OK',
        '1 | LIGNE, DT A banque décochée retrait par sans session'),
      (7, 'proprietaire', '7. le propriétaire supprime le dossier : ses accès et sa trace partent avec lui, rien d''écrit', 'UNE_LIGNE', 'RETIRER_DT', 'R', 'OK', '1 | rien'),
      (8, 'chef', '8. le chef supprime le dossier : de même', 'UNE_LIGNE', 'RETIRER_DT', 'R', 'OK', '1 | rien'),
      (9, 'chef', '9. personne ne retire une ligne de la trace : le chef (aucune policy, aucune ligne touchée)', 'UNE_LIGNE', 'EFFACER', 'R', 'OK', '0 | LIGNE'),
      (10, 'service', '10. … le rôle des Edge Functions (la garde, 23514)', 'UNE_LIGNE', 'EFFACER', 'R', '23514', 'REECRITURE'),
      (11, 'proprietaire', '11. … le propriétaire (la garde, 23514)', 'UNE_LIGNE', 'EFFACER', 'R', '23514', 'REECRITURE')
    ) as t(rang, profil, etape, avant, requete, apres, code, attendu) order by rang loop
      v_obs := null;
      v_code := 'OK';
      v_msg := '';
      v_apres := null;
      begin
        -- La place du profil dans le cabinet, posée par le propriétaire le temps de l'étape.
        perform set_config('request.jwt.claims', '', true);
        if e.profil = 'chef_simple' then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client::uuid, cabinet, 'comptable_en_chef');
        elsif e.profil in ('membre', 'membre_ailleurs') then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client::uuid, cabinet, 'comptable');
          insert into dossier_assignations (dossier_id, user_id)
            values (case when e.profil = 'membre' then dt else du end::uuid, client::uuid);
        end if;
        if e.avant is not null then
          v_req := case e.avant when 'CASES_DU_CHEF' then cases_du_chef when 'UNE_LIGNE' then une_ligne else e.avant end;
          execute replace(replace(replace(replace(replace(replace(replace(v_req, '{DT}', dt), '{DU}', du), '{A}', acces_a), '{B}', acces_b),
            '{N}', acces_n), '{CHEF}', chef), '{CLIENT}', client);
          perform set_config('request.jwt.claims', '', true);
        end if;
        v_req := case e.requete when 'RETIRER_A' then retirer_a when 'RETIRER_DT' then retirer_dt when 'EFFACER' then effacer else e.requete end;
        v_req := replace(replace(replace(replace(replace(replace(replace(v_req, '{DT}', dt), '{DU}', du), '{A}', acces_a), '{B}', acces_b),
          '{N}', acces_n), '{CHEF}', chef), '{CLIENT}', client);
        begin
          if e.profil = 'anon' then
            execute 'set local role anon';
            perform set_config('request.jwt.claims', '{"role":"anon"}', true);
          elsif e.profil = 'service' then
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

  -- Rien n'est resté : ni les deux dossiers, ni leurs accès, ni leur trace, ni le compte d'essai dans le cabinet.
  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni leurs accès, ni leur trace, ni le compte d''essai dans le cabinet',
    'ok', not exists (select 1 from dossiers where id in (dt::uuid, du::uuid))
      and not exists (select 1 from memberships where id in (acces_a::uuid, acces_b::uuid, acces_n::uuid))
      and not exists (select 1 from trace_des_droits where dossier_id in (dt::uuid, du::uuid))
      and not exists (select 1 from cabinet_admins where user_id::text = client)
      and not exists (select 1 from dossier_assignations where user_id::text = client),
    'observe', 'relu');
  perform set_config('essai.trace_des_droits_suppression', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.trace_des_droits_suppression')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
