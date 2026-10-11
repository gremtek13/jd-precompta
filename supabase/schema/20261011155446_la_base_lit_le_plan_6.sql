-- LA BASE LIT LE PLAN, SANS RIEN CHANGER — ligne 43, étape PC2, migration 6 sur 6 :
-- la dotation aux amortissements et le forfait kilométrique.
-- Le pourquoi et la règle : l'en-tête de la_base_lit_le_plan_1. Collée par le cabinet : ses corps retirent
-- l'ancienne écriture avant d'écrire la nouvelle, comme avant, et `apply_migration` attend alors une confirmation qui
-- n'arrive pas.

-- ══ 0. Le point de départ : sinon, rien n'est remplacé ══
do $garde$
declare
  f record;
  v_corps text;
  v_avant int := 0;
  v_apres int := 0;
  v_autres text;
begin
  if to_regprocedure('public.compte_du_role(uuid, text)') is null
     or to_regprocedure('public.compte_du_dirigeant(uuid)') is null then
    raise exception 'L''étape PC1 (plan_comptable_des_dossiers) n''est pas en base : rien n''est remplacé.';
  end if;
  if exists (select 1 from public.plan_comptable_dossier) then
    raise exception 'Le plan d''un dossier porte une ligne : cette migration ne serait plus neutre, rien n''est remplacé.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where name = 'la_base_lit_le_plan_5')
     or exists (select 1 from (values
                     ('rapprocher_cotisation(uuid, uuid, jsonb)', 'ebb4427fc199c5f04e570621ef8c69e3'),
                     ('classer_virement_personnel(uuid, jsonb)', 'a65e86eb912525ffc0eeae6dad2e3380')
                   ) as v(f, apres)
                 where md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.' || v.f)),
                                   E'\r\n', E'\n')) is distinct from v.apres) then
    raise exception 'La migration la_base_lit_le_plan_5 n''est pas en base : l''appliquer d''abord, puis celle-ci.';
  end if;
  -- Chaque corps remplacé est celui sur lequel cette migration a été écrite (fins de ligne ramenées à \n).
  for f in select * from (values
    ('ecrire_dotation_amortissement(uuid, integer, jsonb)', '3fda29ba6b722f97e490cd587fd3d30c', '8137d0a88453629d1608f022e4df4df9'),
    ('ecrire_forfait_kilometrique(uuid, jsonb)', '19355a880a780347b3c82e37c9447bee', '57bfce0bf7700afc8f57be84be3198db')
  ) as v(fonction, avant, apres) loop
    select md5(replace(p.prosrc, E'\r\n', E'\n')) into v_corps
      from pg_proc p where p.oid = to_regprocedure('public.' || f.fonction);
    if v_corps = f.avant then v_avant := v_avant + 1;
    elsif v_corps = f.apres then v_apres := v_apres + 1;
    else v_autres := concat_ws(', ', v_autres, f.fonction);
    end if;
  end loop;
  if v_apres = 2 then
    raise exception 'La migration la_base_lit_le_plan_6 est déjà en base : rien à faire.';
  end if;
  if v_avant <> 2 then
    raise exception 'Une fonction n''est plus celle sur laquelle cette migration a été écrite (%) : rien n''est remplacé.',
      coalesce(v_autres, 'en partie déjà remplacée');
  end if;
end
$garde$;

-- ══ ecrire_dotation_amortissement ══
create or replace function public.ecrire_dotation_amortissement(
  p_immobilisation_id uuid,
  p_annee integer,
  p_ecritures jsonb
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_immo public.immobilisations%rowtype;
  v_date date;
  v_ouverture date;
  v_montant numeric;
  v_compte_immobilisation text;
  v_compte_amortissement text;
  v_compte_dotations text;
  v_conforme boolean;
  v_nb integer;
  v_debit numeric;
  v_credit numeric;
begin
  select * into v_immo from public.immobilisations where id = p_immobilisation_id for update;
  if not found or not admin_du_dossier(v_immo.dossier_id) then
    raise exception 'Accès refusé à ce bien.' using errcode = '42501';
  end if;
  if p_annee is null then
    raise exception 'L''exercice de la dotation manque.' using errcode = '22023';
  end if;
  -- L'exercice en cours s'écrit dès aujourd'hui, au 31 décembre ; un exercice à venir, pas encore. L'année
  -- se lit à Paris, comme dans l'application, sans quoi la nuit du 1er janvier les ferait diverger.
  if p_annee > extract(year from (now() at time zone 'Europe/Paris'))::integer then
    raise exception 'La dotation d''un exercice à venir ne s''écrit pas encore.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_ecritures) is distinct from 'array' then
    raise exception 'L''écriture proposée est incomplète.' using errcode = '22023';
  end if;
  v_date := make_date(p_annee, 12, 31);
  if exists (
    select 1 from public.ecritures_brouillon
    where immobilisation_id = p_immobilisation_id and date = v_date and statut <> 'proposee'
  ) then
    raise exception 'La dotation % de ce bien est validée : elle ne se remplace plus.', p_annee using errcode = '23514';
  end if;

  -- Avant l'ouverture du dossier (ses à-nouveaux), l'amortissement est déjà dans les soldes repris : la
  -- dotation de cet exercice ne s'écrit pas ici. Elle peut encore s'y RETIRER, si elle y avait été écrite
  -- avant la reprise.
  select min(date) into v_ouverture from public.a_nouveaux where dossier_id = v_immo.dossier_id;
  if v_ouverture is not null and v_date < v_ouverture then
    if jsonb_array_length(p_ecritures) > 0 then
      raise exception 'L''exercice % précède l''ouverture du dossier : sa dotation est déjà dans les à-nouveaux.', p_annee
        using errcode = '22023';
    end if;
    v_montant := 0;
  else
    v_montant := public.dotation_amortissement(v_immo.valeur, v_immo.duree_annees,
      coalesce(v_immo.date_mise_en_service, v_immo.date_acquisition), p_annee);
  end if;

  if v_montant > 0 then
    if v_immo.nature_id is null then
      raise exception 'Choisissez la nature de ce bien : c''est elle qui donne son compte d''amortissement.'
        using errcode = '22023';
    end if;
    select compte_immobilisation into v_compte_immobilisation
      from public.natures_immobilisation where id = v_immo.nature_id;
    if v_compte_immobilisation is null then
      raise exception 'La nature de ce bien est introuvable.' using errcode = '22023';
    end if;
    v_compte_amortissement := public.compte_amortissement(v_compte_immobilisation);
  end if;

  -- Le plan du dossier (ligne 43) se lit sous son verrou PARTAGÉ — la clé de `cle_validation`, que l'appelant
  -- n'exécute pas — : un changement du plan (étape PC4) et cet appel ne se croisent pas.
  perform pg_advisory_xact_lock_shared(hashtextextended('jd.validation_exercice:' || v_immo.dossier_id::text, 0));
  v_compte_dotations := public.compte_du_role(v_immo.dossier_id, 'dotations_amortissements');

  -- L'écriture attendue, comparée en MULTIENSEMBLE : autant de lignes, et chacune des attendues présente. Une
  -- dotation nulle n'en attend aucune — l'appel retire alors celle qui aurait été écrite.
  with attendues as (
    select a.compte, a.sens, a.montant from (values
      (v_compte_dotations, 'debit', v_montant),
      (v_compte_amortissement, 'credit', v_montant)
    ) as a(compte, sens, montant)
    where a.montant > 0
  ), recues as (
    select e->>'compte' as compte, e->>'sens' as sens, (e->>'montant')::numeric as montant
    from jsonb_array_elements(p_ecritures) as e
  )
  select (select count(*) from recues) = (select count(*) from attendues)
     and not exists (select compte, sens, montant from attendues except all select compte, sens, montant from recues)
    into v_conforme;
  if not coalesce(v_conforme, false) then
    raise exception 'L''écriture proposée ne correspond pas à la dotation % de ce bien.', p_annee using errcode = '22023';
  end if;

  delete from public.ecritures_brouillon where immobilisation_id = p_immobilisation_id and date = v_date;

  insert into public.ecritures_brouillon (dossier_id, piece_id, ligne_bancaire_id, immobilisation_id, date, compte,
                                          libelle, montant, sens, statut)
  select v_immo.dossier_id, null, null, p_immobilisation_id, v_date, e->>'compte', coalesce(e->>'libelle', ''),
         (e->>'montant')::numeric, e->>'sens', 'proposee'
  from jsonb_array_elements(p_ecritures) as e;
  get diagnostics v_nb = row_count;

  select coalesce(sum(montant) filter (where sens = 'debit'), 0),
         coalesce(sum(montant) filter (where sens = 'credit'), 0)
    into v_debit, v_credit
  from public.ecritures_brouillon where immobilisation_id = p_immobilisation_id and date = v_date;
  if v_debit <> v_credit then
    raise exception 'Écriture déséquilibrée : % au débit, % au crédit.', v_debit, v_credit using errcode = '23514';
  end if;

  return v_nb;
end;
$$;

comment on function public.ecrire_dotation_amortissement(uuid, integer, jsonb) is
  'Écrit la dotation aux amortissements d''un bien pour un exercice (le compte du rôle dotations_amortissements au débit — 681100 par défaut —, le compte 28 de sa nature au crédit, au 31 décembre), vérifiée contre le registre, et remplace celle qui était écrite. Une dotation nulle (avant la mise en service, après la durée, avant l''ouverture du dossier) retire celle qui existait.';

-- ══ ecrire_forfait_kilometrique ══
create or replace function public.ecrire_forfait_kilometrique(
  p_vehicule_id uuid,
  p_ecritures jsonb
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_vehicule public.vehicules%rowtype;
  v_date date;
  v_ouverture date;
  v_centimes bigint;
  v_montant numeric;
  v_compte text;
  v_compte_indemnites text;
  v_conforme boolean;
  v_nb integer;
  v_debit numeric;
  v_credit numeric;
begin
  select * into v_vehicule from public.vehicules where id = p_vehicule_id for update;
  if not found or not admin_du_dossier(v_vehicule.dossier_id) then
    raise exception 'Accès refusé à ce véhicule.' using errcode = '42501';
  end if;
  -- L'exercice en cours s'écrit dès aujourd'hui, au 31 décembre ; un exercice à venir, pas encore. L'année se
  -- lit à Paris, comme dans l'application, sans quoi la nuit du 1er janvier les ferait diverger.
  if v_vehicule.annee > extract(year from (now() at time zone 'Europe/Paris'))::integer then
    raise exception 'Le forfait d''un exercice à venir ne s''écrit pas encore.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_ecritures) is distinct from 'array' then
    raise exception 'L''écriture proposée est incomplète.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon where vehicule_id = p_vehicule_id and statut <> 'proposee'
  ) then
    raise exception 'Le forfait % de ce véhicule est validé : il ne se remplace plus.', v_vehicule.annee
      using errcode = '23514';
  end if;
  v_date := make_date(v_vehicule.annee, 12, 31);

  -- Avant l'ouverture du dossier (ses à-nouveaux), l'exercice est dans les comptes repris : son forfait ne
  -- s'écrit pas ici. Il peut encore s'y RETIRER, s'il y avait été écrit avant la reprise.
  select min(date) into v_ouverture from public.a_nouveaux where dossier_id = v_vehicule.dossier_id;
  if v_ouverture is not null and v_date < v_ouverture then
    if jsonb_array_length(p_ecritures) > 0 then
      raise exception 'L''exercice % précède l''ouverture du dossier : son forfait est dans les comptes repris.',
        v_vehicule.annee using errcode = '22023';
    end if;
    v_montant := 0;
  else
    if not exists (select 1 from public.bareme_kilometrique() b where v_vehicule.annee = any (b.annees)) then
      raise exception 'Le barème kilométrique % n''est pas renseigné dans l''application.', v_vehicule.annee
        using errcode = '22023';
    end if;
    -- Une motorisation non renseignée est thermique : seuls les 100 % électriques ont leur table. Comparée
    -- avec `is not distinct from`, sans quoi une motorisation nulle rendrait l'indemnité nulle elle aussi.
    v_centimes := public.indemnite_kilometrique_centimes(v_vehicule.annee, v_vehicule.type,
      v_vehicule.puissance_fiscale, v_vehicule.motorisation is not distinct from 'electrique',
      v_vehicule.km_professionnel);
    if v_centimes is null then
      raise exception 'La puissance fiscale de ce véhicule est hors du barème kilométrique %.', v_vehicule.annee
        using errcode = '22023';
    end if;
    v_montant := v_centimes::numeric / 100;
  end if;

  -- Le plan du dossier (ligne 43) se lit sous son verrou PARTAGÉ — la clé de `cle_validation`, que l'appelant
  -- n'exécute pas — : un changement du plan (étape PC4) et cet appel ne se croisent pas.
  perform pg_advisory_xact_lock_shared(hashtextextended('jd.validation_exercice:' || v_vehicule.dossier_id::text, 0));
  v_compte_indemnites := public.compte_du_role(v_vehicule.dossier_id, 'indemnites_kilometriques');
  -- Le compte du dirigeant se lit dans le dossier, jamais dans ce que l'application envoie — la règle du
  -- virement personnel (`classer_virement_personnel`).
  v_compte := public.compte_du_dirigeant(v_vehicule.dossier_id);

  -- L'écriture attendue, comparée en MULTIENSEMBLE : autant de lignes, et chacune des attendues présente. Un
  -- forfait nul n'en attend aucune — l'appel retire alors celui qui aurait été écrit.
  with attendues as (
    select a.compte, a.sens, a.montant from (values
      (v_compte_indemnites, 'debit', v_montant),
      (v_compte, 'credit', v_montant)
    ) as a(compte, sens, montant)
    where a.montant > 0
  ), recues as (
    select e->>'compte' as compte, e->>'sens' as sens, (e->>'montant')::numeric as montant
    from jsonb_array_elements(p_ecritures) as e
  )
  select (select count(*) from recues) = (select count(*) from attendues)
     and not exists (select compte, sens, montant from attendues except all select compte, sens, montant from recues)
    into v_conforme;
  if not coalesce(v_conforme, false) then
    raise exception 'L''écriture proposée ne correspond pas au forfait % de ce véhicule.', v_vehicule.annee
      using errcode = '22023';
  end if;

  delete from public.ecritures_brouillon where vehicule_id = p_vehicule_id;

  insert into public.ecritures_brouillon (dossier_id, piece_id, ligne_bancaire_id, immobilisation_id, vehicule_id,
                                          date, compte, libelle, montant, sens, statut)
  select v_vehicule.dossier_id, null, null, null, p_vehicule_id, v_date, e->>'compte', coalesce(e->>'libelle', ''),
         (e->>'montant')::numeric, e->>'sens', 'proposee'
  from jsonb_array_elements(p_ecritures) as e;
  get diagnostics v_nb = row_count;

  select coalesce(sum(montant) filter (where sens = 'debit'), 0),
         coalesce(sum(montant) filter (where sens = 'credit'), 0)
    into v_debit, v_credit
  from public.ecritures_brouillon where vehicule_id = p_vehicule_id;
  if v_debit <> v_credit then
    raise exception 'Écriture déséquilibrée : % au débit, % au crédit.', v_debit, v_credit using errcode = '23514';
  end if;

  return v_nb;
end;
$$;

comment on function public.ecrire_forfait_kilometrique(uuid, jsonb) is
  'Écrit le forfait kilométrique d''une ligne du cadre 7 (le compte du rôle indemnites_kilometriques au débit — 625110 par défaut —, le compte du dirigeant au crédit, au 31 décembre de son exercice), vérifié contre le barème, et remplace celui qui était écrit. Un forfait nul (zéro kilomètre, exercice antérieur à l''ouverture du dossier) retire celui qui existait.';
