-- LE MODÈLE DE PLAN DU CABINET : CE QU'UN RETRAIT RENCONTRE (ligne 43, étape PC5 ; la migration
-- `modele_de_plan_du_cabinet`). Sur une RÉPLIQUE seulement : il porte des instructions de retrait, que l'outil de la
-- production retient. Le reste se prouve par modeleDuCabinet.sql.
--   S1. Le retrait d'un cabinet emporte son modèle (la clé en cascade ; la garde laisse partir la ligne d'un cabinet qui
--       n'existe plus).
--   S2. Le propriétaire ne retire pas une ligne d'un modèle dont le cabinet existe : la garde (42501).
--   S3. Le chef du cabinet, en session, n'en retire aucune : aucune policy de retrait (aucune ligne touchée).
-- Tout s'annule (`ANNULATION_ETAPE`) ; sans la migration, une ligne dit qu'il attend.
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  autre constant uuid := 'f5c00000-0000-4000-8000-0000000000cb';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  -- Le modèle se stocke entier : une ligne par rôle du catalogue, que l'essai LIT (34 depuis `ecarts_de_reglement`).
  nr constant text := (select count(*)::text from roles_comptables);
  n bigint; v_obs text;
  verdicts jsonb := '[]'::jsonb;
begin
  if to_regprocedure('public.regler_modele_du_cabinet(uuid, jsonb)') is null then
    perform set_config('essai.modele_du_cabinet_suppression', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration modele_de_plan_du_cabinet', 'ok', true, 'observe', 'absente'))::text, true);
    return;
  end if;
  -- S1.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    insert into cabinets (id, nom) values (autre, 'ESSAI PC5 SUPPRESSION');
    perform regler_modele_du_cabinet(autre, '[{"role": "banque", "compte": "512100"}]'::jsonb);
    perform set_config('request.jwt.claims', '', true);
    select count(*) into n from plan_comptable_cabinet where cabinet_id = autre;
    delete from cabinets where id = autre;
    v_obs := n || ' ligne(s) avant, ' || (select count(*) from plan_comptable_cabinet where cabinet_id = autre) || ' après';
    raise exception 'ANNULATION_ETAPE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ETAPE' then v_obs := sqlstate || ' ' || sqlerrm; end if;
  end;
  verdicts := verdicts || jsonb_build_object('rang', 1, 'etape', 'S1. le retrait d''un cabinet emporte son modèle',
    'ok', v_obs = nr || ' ligne(s) avant, 0 après', 'observe', v_obs);
  -- S2.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform regler_modele_du_cabinet(cabinet, '[{"role": "banque", "compte": "512100"}]'::jsonb);
    perform set_config('request.jwt.claims', '', true);
    delete from plan_comptable_cabinet where cabinet_id = cabinet and role = 'banque';
    v_obs := 'ACCEPTÉ';
    raise exception 'ANNULATION_ETAPE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ETAPE' then v_obs := sqlstate || ' ' || sqlerrm; end if;
  end;
  verdicts := verdicts || jsonb_build_object('rang', 2, 'etape', 'S2. le propriétaire ne retire pas une ligne d''un modèle dont le cabinet existe (42501)',
    'ok', v_obs = '42501 Une ligne du modèle de plan d''un cabinet ne se retire pas : un rôle revient au catalogue par regler_modele_du_cabinet, et le modèle part avec son cabinet.',
    'observe', v_obs);
  -- S3.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform regler_modele_du_cabinet(cabinet, '[{"role": "banque", "compte": "512100"}]'::jsonb);
    set local role authenticated;
    with t as (delete from plan_comptable_cabinet where cabinet_id = cabinet returning 1) select count(*) into n from t;
    reset role;
    v_obs := n || ' retirée(s), ' || (select count(*) from plan_comptable_cabinet where cabinet_id = cabinet) || ' restante(s)';
    raise exception 'ANNULATION_ETAPE';
  exception when others then
    reset role;
    if sqlerrm <> 'ANNULATION_ETAPE' then v_obs := sqlstate || ' ' || sqlerrm; end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  verdicts := verdicts || jsonb_build_object('rang', 3, 'etape', 'S3. le chef, en session, n''en retire aucune ligne : aucune policy de retrait',
    'ok', v_obs = '0 retirée(s), ' || nr || ' restante(s)', 'observe', v_obs);
  perform set_config('essai.modele_du_cabinet_suppression', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.modele_du_cabinet_suppression')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
