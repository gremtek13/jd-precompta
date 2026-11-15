-- RETOUR DE cumul_et_dispense_du_medecin (supabase/schema/20261115074806_cumul_et_dispense_du_medecin.sql — en production
-- depuis le 15/11/2026, version 20261115074806 —, RET-Q2) : les deux cases retirées, et
-- `enregistrer_parametres_des_cotisations` rendue telle que la production la porte avant la migration, au caractère près
-- (supabase/schema/20261107165534_parametres_des_cotisations.sql : son corps rend l'empreinte 30d980ad…). CE QU'IL DÉTRUIT :
-- le cumul emploi-retraite et la dispense du complémentaire que le cabinet a dits, exercice par exercice (les colonnes
-- `cumul_emploi_retraite` et `dispense_complementaire` et leurs valeurs) ; rien d'autre. Un exercice validé n'y change rien
-- d'autre que ces deux valeurs (la garde du gel ne juge pas un `alter table`). `CASES_DU_MEDECIN_PREVUES` doit être baissé
-- AVANT (l'écran levé enverrait cinq clés, que la fonction d'hier refuse). DESTRUCTIF (des `drop`) : il se colle dans
-- l'éditeur SQL de Supabase, dans une transaction, avec sa ligne d'historique, sur l'accord du cabinet. Il ne retire que ce
-- que la migration a posé : la garde de tête vérifie l'empreinte de la fonction qu'elle a laissée.

do $garde$
begin
  if md5(replace(coalesce((select p.prosrc from pg_catalog.pg_proc p
                           where p.oid = to_regprocedure('public.enregistrer_parametres_des_cotisations(uuid, integer, jsonb, jsonb)')), ''), chr(13), ''))
       <> '29c276503685c3bcf8a3c5a1375ef345' then
    raise exception 'retour_cumul_et_dispense_du_medecin : la fonction en base n''est pas celle que la migration laisse ; relire avant de retirer.';
  end if;
  if not exists (select 1 from pg_catalog.pg_attribute a where a.attrelid = 'public.parametres_des_cotisations'::regclass
                  and a.attname = 'cumul_emploi_retraite' and not a.attisdropped) then
    raise exception 'retour_cumul_et_dispense_du_medecin : la migration n''est pas en base ; rien à retirer.';
  end if;
end
$garde$;

create or replace function public.enregistrer_parametres_des_cotisations(p_dossier_id uuid, p_annee integer, p_lus jsonb, p_saisis jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cles constant text[] := array['acre', 'debut_activite', 'taux_dentiste'];
  v_objet jsonb;
  v_debut_lu date;
  v_debut_saisi date;
  v_acre_lu boolean;
  v_acre_saisi boolean;
  v_taux_lu numeric;
  v_taux_saisi numeric;
  v_debut_actuel date;
  v_acre_actuel boolean;
  v_taux_actuel numeric;
  v_n integer := 0;
begin
  if p_dossier_id is null or not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Les paramètres des cotisations ne s''écrivent que par le cabinet du dossier.' using errcode = '42501';
  end if;
  if p_annee is null or jsonb_typeof(p_lus) is distinct from 'object' or jsonb_typeof(p_saisis) is distinct from 'object' then
    raise exception 'Les paramètres des cotisations partent mal formés : un exercice, les valeurs saisies et celles lues.'
      using errcode = '22023';
  end if;
  foreach v_objet in array array[p_lus, p_saisis] loop
    if (select array_agg(k order by k collate "C") from jsonb_object_keys(v_objet) k) is distinct from v_cles
       or jsonb_typeof(v_objet -> 'debut_activite') not in ('string', 'null')
       or jsonb_typeof(v_objet -> 'acre') not in ('boolean', 'null')
       or jsonb_typeof(v_objet -> 'taux_dentiste') not in ('number', 'null')
       or (jsonb_typeof(v_objet -> 'debut_activite') = 'string' and (v_objet ->> 'debut_activite') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then
      raise exception 'Les paramètres des cotisations partent mal formés : le début d''activité (AAAA-MM-JJ), l''ACRE et le taux dentiste, saisis et lus.'
        using errcode = '22023';
    end if;
  end loop;
  begin
    v_debut_lu := (p_lus ->> 'debut_activite')::date;
    v_debut_saisi := (p_saisis ->> 'debut_activite')::date;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'Le début d''activité n''est pas une date du calendrier.' using errcode = '22023';
  end;
  v_acre_lu := (p_lus ->> 'acre')::boolean;
  v_acre_saisi := (p_saisis ->> 'acre')::boolean;
  v_taux_lu := (p_lus ->> 'taux_dentiste')::numeric;
  v_taux_saisi := (p_saisis ->> 'taux_dentiste')::numeric;

  perform pg_advisory_xact_lock(hashtextextended('parametres_des_cotisations:' || p_dossier_id::text, 0));
  select d.date_debut into v_debut_actuel from public.debuts_d_activite d where d.dossier_id = p_dossier_id;
  select c.acre, c.taux_dentiste into v_acre_actuel, v_taux_actuel
    from public.parametres_des_cotisations c where c.dossier_id = p_dossier_id and c.annee = p_annee;
  if v_debut_actuel is distinct from v_debut_lu or v_acre_actuel is distinct from v_acre_lu
     or v_taux_actuel is distinct from v_taux_lu then
    raise exception 'Les paramètres des cotisations de l''exercice % ont changé depuis leur lecture : relis-les avant de les enregistrer.', p_annee
      using errcode = '40001';
  end if;

  if v_debut_saisi is distinct from v_debut_actuel then
    insert into public.debuts_d_activite (dossier_id, date_debut) values (p_dossier_id, v_debut_saisi)
      on conflict on constraint debuts_d_activite_un_par_dossier do update
        set date_debut = excluded.date_debut, updated_at = now();
    v_n := v_n + 1;
  end if;
  if v_acre_saisi is distinct from v_acre_actuel or v_taux_saisi is distinct from v_taux_actuel then
    insert into public.parametres_des_cotisations (dossier_id, annee, acre, taux_dentiste)
      values (p_dossier_id, p_annee, v_acre_saisi, v_taux_saisi)
      on conflict on constraint parametres_des_cotisations_un_par_exercice do update
        set acre = excluded.acre, taux_dentiste = excluded.taux_dentiste, updated_at = now();
    v_n := v_n + 1;
  end if;
  return v_n;
end;
$$;

comment on function public.enregistrer_parametres_des_cotisations(uuid, integer, jsonb, jsonb) is
  'Le début d''activité du dossier et l''ACRE et le taux dentiste d''un exercice, tout ou rien, contre les valeurs lues qu''ils remplacent (TNS-Q1, TNS-Q4). Aux droits de l''appelant.';

alter table public.parametres_des_cotisations
  drop column cumul_emploi_retraite,
  drop column dispense_complementaire;
