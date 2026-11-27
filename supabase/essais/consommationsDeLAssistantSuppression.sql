-- LE JOURNAL DE CONSOMMATION DE L'ASSISTANT DEVANT UNE SORTIE DE LIGNE (ASSIST-Q1 (A) ; migration
-- `consommations_de_l_assistant`) — SUR UNE RÉPLIQUE SEULEMENT : l'outil d'exécution de la production soumet toute suppression
-- à une confirmation qui n'arrive pas, et l'appel expire. Le compagnon de `consommationsDeLAssistant.sql`, à rejouer avec lui.
-- Sans la migration, une ligne dit qu'il attend (EN ATTENTE) et rien ne s'écrit.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - la suppression d'un dossier laisse ses consommations, le dossier mis à nul (sa clé étrangère, que la garde admet) : le
--     mois de son cabinet ne se vide pas ;
--   - la suppression d'un cabinet emporte ses consommations (la cascade, que la garde admet), qu'elles nomment un dossier ou
--     non ;
--   - personne ne retire une consommation : un connecté (le droit, 42501), le rôle des Edge Functions et le propriétaire (la
--     garde, 42501) ; ni ne met à nul le dossier d'une ligne tant qu'il existe (42501).
-- Trois mutations doivent mordre : la garde qui refuse toute sortie (la suppression du cabinet échoue), toute réécriture (la
-- suppression du dossier échoue), et celle qui laisse sortir une ligne (la sortie directe passe).
--
-- Une garde de tête refuse de le jouer hors d'une réplique (ESSAI_HORS_REPLIQUE : le rôle `proprietaire` manque à la
-- production). Un cabinet et un dossier fictifs (préfixe `c0450000-0000-4000-8000`), le temps de chaque sous-transaction ;
-- « rien n'est resté » le relit. Joué en UNE transaction (`psql -1`).
do $essai$
declare
  chef constant uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  cab constant uuid := 'c0450000-0000-4000-8000-0000000000ca';
  dos constant uuid := 'c0450000-0000-4000-8000-0000000000d0';
  v_ligne uuid;
  v_a text; v_b text; v_c text; v_d text;
  v_n bigint; v_m bigint;
  verdicts jsonb := '[]'::jsonb;
begin
  if to_regrole('proprietaire') is null then
    raise exception 'ESSAI_HORS_REPLIQUE : le rôle proprietaire manque — cet essai ne se joue que sur une réplique';
  end if;
  if to_regclass('public.consommations_de_l_assistant') is null then
    perform set_config('essai.consommations_de_l_assistant_suppression', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', 'CO-S. EN ATTENTE de la migration consommations_de_l_assistant', 'ok', true, 'observe', 'table absente'))::text, true);
    return;
  end if;

  -- 1. La suppression d'un dossier : ses consommations restent, le dossier à nul ; puis celle du cabinet les emporte.
  v_a := null; v_b := null; v_c := null;
  begin
    insert into cabinets (id, nom) values (cab, 'Cabinet fictif des consommations');
    insert into dossiers (id, nom, cabinet_id) values (dos, 'Dossier fictif des consommations', cab);
    set local role service_role;
    insert into consommations_de_l_assistant (cabinet_id, dossier_id, compte, tokens_entree, tokens_sortie)
    values (cab, dos, chef, 100, 10), (cab, dos, chef, 200, 20), (cab, null, chef, 300, 30);
    reset role;
    delete from dossiers where id = dos;
    select count(*), count(c.dossier_id) into v_n, v_m from consommations_de_l_assistant c where c.cabinet_id = cab;
    v_a := v_n || ' ' || v_m;
    select coalesce(sum(c.tokens_entree), 0)::text into v_b from consommations_de_l_assistant c where c.cabinet_id = cab;
    delete from cabinets where id = cab;
    select count(*)::text into v_c from consommations_de_l_assistant c where c.cabinet_id = cab;
    raise exception 'ANNULATION_ETAPE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ETAPE' then v_c := coalesce(v_c, sqlstate || ' ' || sqlerrm); end if;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('rang', 1, 'etape', '1. la suppression d''un dossier laisse ses consommations, le dossier à nul, les sommes intactes ; celle du cabinet les emporte toutes',
    'ok', v_a = '3 0' and v_b = '600' and v_c = '0',
    'observe', coalesce(v_a, 'nul') || ' | ' || coalesce(v_b, 'nul') || ' | ' || coalesce(v_c, 'nul'));

  -- 2. Personne ne retire une consommation, ni ne met à nul le dossier d'une ligne tant qu'il existe.
  v_a := null; v_b := null; v_c := null; v_d := null;
  begin
    insert into cabinets (id, nom) values (cab, 'Cabinet fictif des consommations');
    insert into dossiers (id, nom, cabinet_id) values (dos, 'Dossier fictif des consommations', cab);
    set local role service_role;
    insert into consommations_de_l_assistant (cabinet_id, dossier_id, compte, tokens_entree, tokens_sortie)
    values (cab, dos, chef, 100, 10) returning id into v_ligne;
    begin delete from consommations_de_l_assistant where id = v_ligne; v_a := 'RETIRÉE'; exception when others then v_a := sqlstate; end;
    begin update consommations_de_l_assistant set dossier_id = null where id = v_ligne; v_b := 'RÉÉCRITE'; exception when others then v_b := sqlstate; end;
    reset role;
    begin delete from consommations_de_l_assistant where id = v_ligne; v_c := 'RETIRÉE'; exception when others then v_c := sqlstate; end;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    begin delete from consommations_de_l_assistant where id = v_ligne; v_d := 'RETIRÉE'; exception when others then v_d := sqlstate; end;
    reset role;
    raise exception 'ANNULATION_ETAPE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ETAPE' then v_d := coalesce(v_d, sqlstate || ' ' || sqlerrm); end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  verdicts := verdicts || jsonb_build_object('rang', 2, 'etape', '2. ni le rôle des Edge Functions ni le propriétaire ne retirent une consommation, ni ne mettent à nul son dossier tant qu''il existe (42501, la garde) ; un connecté, le super-administrateur compris, n''en a pas le droit (42501)',
    'ok', v_a = '42501' and v_b = '42501' and v_c = '42501' and v_d = '42501',
    'observe', coalesce(v_a, 'nul') || ' ' || coalesce(v_b, 'nul') || ' ' || coalesce(v_c, 'nul') || ' ' || coalesce(v_d, 'nul'));

  -- 3. Les mutations, chacune annulée avec sa sous-transaction : elles doivent mordre.
  v_a := null; v_b := null; v_c := null;
  -- M1 : la garde qui refuse toute sortie : la suppression du cabinet échoue.
  begin
    insert into cabinets (id, nom) values (cab, 'Cabinet fictif des consommations');
    set local role service_role;
    insert into consommations_de_l_assistant (cabinet_id, dossier_id, compte, tokens_entree, tokens_sortie) values (cab, null, chef, 1, 1);
    reset role;
    create or replace function public.garder_consommations_de_l_assistant() returns trigger
    language plpgsql set search_path = public
    as $m1$
    begin
      if tg_op = 'INSERT' then return new; end if;
      raise exception 'Une consommation de l''assistant ne se retire pas (mutation).' using errcode = '42501';
    end
    $m1$;
    begin delete from cabinets where id = cab; v_a := 'PARTI'; exception when others then v_a := sqlstate; end;
    raise exception 'ANNULATION_ETAPE';
  exception when others then if sqlerrm <> 'ANNULATION_ETAPE' then v_a := coalesce(v_a, sqlstate); end if;
  end;
  reset role;
  -- M2 : la garde qui refuse toute réécriture : la suppression du dossier échoue.
  begin
    insert into cabinets (id, nom) values (cab, 'Cabinet fictif des consommations');
    insert into dossiers (id, nom, cabinet_id) values (dos, 'Dossier fictif des consommations', cab);
    set local role service_role;
    insert into consommations_de_l_assistant (cabinet_id, dossier_id, compte, tokens_entree, tokens_sortie) values (cab, dos, chef, 1, 1);
    reset role;
    create or replace function public.garder_consommations_de_l_assistant() returns trigger
    language plpgsql set search_path = public
    as $m2$
    begin
      if tg_op = 'UPDATE' then raise exception 'Une consommation de l''assistant ne se réécrit pas (mutation).' using errcode = '42501'; end if;
      return case when tg_op = 'INSERT' then new else old end;
    end
    $m2$;
    begin delete from dossiers where id = dos; v_b := 'PARTI'; exception when others then v_b := sqlstate; end;
    raise exception 'ANNULATION_ETAPE';
  exception when others then if sqlerrm <> 'ANNULATION_ETAPE' then v_b := coalesce(v_b, sqlstate); end if;
  end;
  reset role;
  -- M3 : la garde qui laisse sortir une ligne : le rôle des Edge Functions la retire.
  begin
    insert into cabinets (id, nom) values (cab, 'Cabinet fictif des consommations');
    set local role service_role;
    insert into consommations_de_l_assistant (cabinet_id, dossier_id, compte, tokens_entree, tokens_sortie)
    values (cab, null, chef, 1, 1) returning id into v_ligne;
    reset role;
    create or replace function public.garder_consommations_de_l_assistant() returns trigger
    language plpgsql set search_path = public
    as $m3$
    begin
      return case when tg_op = 'INSERT' then new else old end;
    end
    $m3$;
    set local role service_role;
    begin delete from consommations_de_l_assistant where id = v_ligne; v_c := 'RETIRÉE'; exception when others then v_c := sqlstate; end;
    reset role;
    raise exception 'ANNULATION_ETAPE';
  exception when others then if sqlerrm <> 'ANNULATION_ETAPE' then v_c := coalesce(v_c, sqlstate); end if;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('rang', 3, 'etape', '3. les mutations mordent : la garde qui refuse toute sortie (le cabinet ne part plus), toute réécriture (le dossier ne part plus), ou qui laisse sortir une ligne (le rôle des Edge Functions la retire)',
    'ok', v_a = '42501' and v_b = '42501' and v_c = 'RETIRÉE',
    'observe', coalesce(v_a, 'nul') || ' | ' || coalesce(v_b, 'nul') || ' | ' || coalesce(v_c, 'nul'));

  -- 4. Rien n'est resté.
  verdicts := verdicts || jsonb_build_object('rang', 4, 'etape', '4. rien n''est resté des sous-transactions',
    'ok', not exists (select 1 from cabinets where id = cab) and not exists (select 1 from dossiers where id = dos)
      and not exists (select 1 from consommations_de_l_assistant c where c.cabinet_id = cab)
      and strpos((select p.prosrc from pg_proc p where p.oid = 'public.garder_consommations_de_l_assistant()'::regprocedure), 'elle part avec son cabinet') > 0,
    'observe', 'relu');
  perform set_config('essai.consommations_de_l_assistant_suppression', verdicts::text, true);
end
$essai$;

-- Un verdict nul est une faute : une comparaison à un nul ne passe jamais pour juste.
select v.rang, v.etape, coalesce(v.ok, false) as ok, coalesce(v.observe, 'nul') as observe
from jsonb_to_recordset(current_setting('essai.consommations_de_l_assistant_suppression')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
