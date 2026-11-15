-- RETOUR D'exoneration_en_zone_prioritaire (supabase/preparees/20261115131000_exoneration_en_zone_prioritaire.sql, RET2-Q2) :
-- la case de l'exonération et ses deux contraintes retirées, et `enregistrer_parametres_des_cotisations` rendue telle que la
-- production la porte avant la migration, au caractère près (supabase/schema/20261115074806_cumul_et_dispense_du_medecin.sql :
-- son corps rend l'empreinte 29c27650…). CE QU'IL DÉTRUIT : l'exonération de 2025 en zone d'intervention prioritaire que le
-- cabinet a dite, exercice par exercice (la colonne `exoneration_zone_prioritaire` et ses valeurs), et les contraintes
-- `parametres_des_cotisations_exoneration_de_2025` et `parametres_des_cotisations_exoneration_en_cumul` ; rien d'autre. Un
-- exercice validé n'y change rien d'autre que cette valeur (la garde du gel ne juge pas un `alter table`).
-- `EXONERATION_EN_ZONE_PRIORITAIRE_PREVUE` doit être baissé AVANT (l'écran levé enverrait six clés, que la fonction d'hier
-- refuse). DESTRUCTIF (des `drop`) : il se colle dans l'éditeur SQL de Supabase, dans une transaction, avec sa ligne
-- d'historique, sur l'accord du cabinet. Il ne retire que ce que la migration a posé : la garde de tête vérifie l'empreinte
-- de la fonction qu'elle a laissée.

do $garde$
begin
  if md5(replace(coalesce((select p.prosrc from pg_catalog.pg_proc p
                           where p.oid = to_regprocedure('public.enregistrer_parametres_des_cotisations(uuid, integer, jsonb, jsonb)')), ''), chr(13), ''))
       <> 'f983fc220a8a5c429807b82ae1cd453b' then
    raise exception 'retour_exoneration_en_zone_prioritaire : la fonction en base n''est pas celle que la migration laisse ; relire avant de retirer.';
  end if;
  if not exists (select 1 from pg_catalog.pg_attribute a where a.attrelid = 'public.parametres_des_cotisations'::regclass
                  and a.attname = 'exoneration_zone_prioritaire' and not a.attisdropped) then
    raise exception 'retour_exoneration_en_zone_prioritaire : la migration n''est pas en base ; rien à retirer.';
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
  -- RET-Q2 : les cinq clés, les deux cases d'un médecin comprises ; la même forme pour les valeurs lues et les saisies.
  v_cles_du_medecin constant text[] := array['acre', 'cumul_emploi_retraite', 'debut_activite', 'dispense_complementaire', 'taux_dentiste'];
  v_avec_les_cases boolean;
  v_objet jsonb;
  v_debut_lu date;
  v_debut_saisi date;
  v_acre_lu boolean;
  v_acre_saisi boolean;
  v_taux_lu numeric;
  v_taux_saisi numeric;
  v_cumul_lu boolean;
  v_cumul_saisi boolean;
  v_dispense_lue boolean;
  v_dispense_saisie boolean;
  v_debut_actuel date;
  v_acre_actuel boolean;
  v_taux_actuel numeric;
  v_cumul_actuel boolean;
  v_dispense_actuelle boolean;
  v_n integer := 0;
begin
  if p_dossier_id is null or not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Les paramètres des cotisations ne s''écrivent que par le cabinet du dossier.' using errcode = '42501';
  end if;
  if p_annee is null or jsonb_typeof(p_lus) is distinct from 'object' or jsonb_typeof(p_saisis) is distinct from 'object' then
    raise exception 'Les paramètres des cotisations partent mal formés : un exercice, les valeurs saisies et celles lues.'
      using errcode = '22023';
  end if;
  v_avec_les_cases := (select array_agg(k order by k collate "C") from jsonb_object_keys(p_saisis) k) is not distinct from v_cles_du_medecin;
  foreach v_objet in array array[p_lus, p_saisis] loop
    if (select array_agg(k order by k collate "C") from jsonb_object_keys(v_objet) k)
         is distinct from (case when v_avec_les_cases then v_cles_du_medecin else v_cles end)
       or jsonb_typeof(v_objet -> 'debut_activite') not in ('string', 'null')
       or jsonb_typeof(v_objet -> 'acre') not in ('boolean', 'null')
       or jsonb_typeof(v_objet -> 'taux_dentiste') not in ('number', 'null')
       or (v_avec_les_cases and (jsonb_typeof(v_objet -> 'cumul_emploi_retraite') not in ('boolean', 'null')
                                 or jsonb_typeof(v_objet -> 'dispense_complementaire') not in ('boolean', 'null')))
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
  v_cumul_lu := (p_lus ->> 'cumul_emploi_retraite')::boolean;
  v_cumul_saisi := (p_saisis ->> 'cumul_emploi_retraite')::boolean;
  v_dispense_lue := (p_lus ->> 'dispense_complementaire')::boolean;
  v_dispense_saisie := (p_saisis ->> 'dispense_complementaire')::boolean;
  perform pg_advisory_xact_lock(hashtextextended('parametres_des_cotisations:' || p_dossier_id::text, 0));
  select d.date_debut into v_debut_actuel from public.debuts_d_activite d where d.dossier_id = p_dossier_id;
  select c.acre, c.taux_dentiste, c.cumul_emploi_retraite, c.dispense_complementaire
    into v_acre_actuel, v_taux_actuel, v_cumul_actuel, v_dispense_actuelle
    from public.parametres_des_cotisations c where c.dossier_id = p_dossier_id and c.annee = p_annee;
  if v_debut_actuel is distinct from v_debut_lu or v_acre_actuel is distinct from v_acre_lu
     or v_taux_actuel is distinct from v_taux_lu
     or (v_avec_les_cases and (v_cumul_actuel is distinct from v_cumul_lu or v_dispense_actuelle is distinct from v_dispense_lue)) then
    raise exception 'Les paramètres des cotisations de l''exercice % ont changé depuis leur lecture : relis-les avant de les enregistrer.', p_annee
      using errcode = '40001';
  end if;
  if v_debut_saisi is distinct from v_debut_actuel then
    insert into public.debuts_d_activite (dossier_id, date_debut) values (p_dossier_id, v_debut_saisi)
      on conflict on constraint debuts_d_activite_un_par_dossier do update
        set date_debut = excluded.date_debut, updated_at = now();
    v_n := v_n + 1;
  end if;
  -- Sous la forme à trois clés, les deux cases ne s'écrivent pas : elles gardent ce qu'elles sont (nulles à la création).
  if not v_avec_les_cases then
    v_cumul_saisi := v_cumul_actuel;
    v_dispense_saisie := v_dispense_actuelle;
  end if;
  if v_acre_saisi is distinct from v_acre_actuel or v_taux_saisi is distinct from v_taux_actuel
     or v_cumul_saisi is distinct from v_cumul_actuel or v_dispense_saisie is distinct from v_dispense_actuelle then
    insert into public.parametres_des_cotisations (dossier_id, annee, acre, taux_dentiste, cumul_emploi_retraite, dispense_complementaire)
      values (p_dossier_id, p_annee, v_acre_saisi, v_taux_saisi, v_cumul_saisi, v_dispense_saisie)
      on conflict on constraint parametres_des_cotisations_un_par_exercice do update
        set acre = excluded.acre, taux_dentiste = excluded.taux_dentiste, cumul_emploi_retraite = excluded.cumul_emploi_retraite,
            dispense_complementaire = excluded.dispense_complementaire, updated_at = now();
    v_n := v_n + 1;
  end if;
  return v_n;
end;
$$;

comment on function public.enregistrer_parametres_des_cotisations(uuid, integer, jsonb, jsonb) is
  'Le début d''activité du dossier et l''ACRE, le taux dentiste — et, sous la forme à cinq clés, le cumul emploi-retraite et la dispense du complémentaire d''un médecin — d''un exercice, tout ou rien, contre les valeurs lues qu''ils remplacent (TNS-Q1, TNS-Q4, RET-Q2). Aux droits de l''appelant.';

alter table public.parametres_des_cotisations
  drop constraint parametres_des_cotisations_exoneration_en_cumul,
  drop constraint parametres_des_cotisations_exoneration_de_2025,
  drop column exoneration_zone_prioritaire;
