-- Ligne 26.6 de la feuille de route, étape (b) : le FORFAIT KILOMÉTRIQUE s'écrit. La 2035 le comptait en case
-- BJ depuis le cadre 7 (la table `vehicules`, une ligne par véhicule et par exercice), et rien ne l'écrivait :
-- ni charge ni contrepartie au brouillon, donc rien au FEC — un vérificateur qui additionne le fichier ne
-- retrouvait pas la ligne 23 de la déclaration. Troisième migration du chantier, après `bareme_kilometrique`
-- (le barème et son calcul) et `ecritures_brouillon_vehicule` (le lien d'une écriture vers sa ligne du cadre 7).
--
-- L'ÉCRITURE : au 31 décembre de l'exercice, l'indemnité au débit du 625110 (indemnités kilométriques au
-- barème) et au crédit du compte du DIRIGEANT — 108000 pour un dossier tenu en trésorerie, le compte choisi
-- pour le dirigeant (`compte_notes_de_frais` : 455, 108 ou 467) en engagement. C'est lui qui a supporté les
-- frais du véhicule, et le barème les lui rend ; ni la banque ni une pièce n'y prennent part. Une écriture
-- par ligne du cadre 7, composée par l'application, VÉRIFIÉE ici contre le barème
-- (`indemnite_kilometrique_centimes`), au centime, et qui remplace la précédente en une transaction (voir
-- supabase/essais/forfaitKilometrique.sql).

create function public.ecrire_forfait_kilometrique(
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

  -- Le compte du dirigeant se lit dans le dossier, jamais dans ce que l'application envoie — la règle du
  -- virement personnel (`classer_virement_personnel`).
  select case when mode_comptable = 'engagement' then compte_notes_de_frais else '108000' end
    into v_compte from public.dossiers where id = v_vehicule.dossier_id;

  -- L'écriture attendue, comparée en MULTIENSEMBLE : autant de lignes, et chacune des attendues présente. Un
  -- forfait nul n'en attend aucune — l'appel retire alors celui qui aurait été écrit.
  with attendues as (
    select a.compte, a.sens, a.montant from (values
      ('625110', 'debit', v_montant),
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
  'Écrit le forfait kilométrique d''une ligne du cadre 7 (625110 au débit, le compte du dirigeant au crédit, '
  'au 31 décembre de son exercice), vérifié contre le barème, et remplace celui qui était écrit. Un forfait '
  'nul (zéro kilomètre, exercice antérieur à l''ouverture du dossier) retire celui qui existait.';

-- Un véhicule dont le forfait est écrit ne se supprime pas directement (la clé `ecritures_brouillon.vehicule_id`
-- est SANS action) : il se retire par cette fonction, qui emporte son forfait avec lui, dans une transaction.
create function public.retirer_vehicule(p_vehicule_id uuid) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_vehicule public.vehicules%rowtype;
  v_nb integer;
begin
  select * into v_vehicule from public.vehicules where id = p_vehicule_id for update;
  if not found or not admin_du_dossier(v_vehicule.dossier_id) then
    raise exception 'Accès refusé à ce véhicule.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon where vehicule_id = p_vehicule_id and statut <> 'proposee'
  ) then
    raise exception 'Le forfait de ce véhicule est validé : il ne se retire plus.' using errcode = '23514';
  end if;

  delete from public.ecritures_brouillon where vehicule_id = p_vehicule_id;
  get diagnostics v_nb = row_count;
  delete from public.vehicules where id = p_vehicule_id;
  return v_nb;
end;
$$;

comment on function public.retirer_vehicule(uuid) is
  'Retire un véhicule du cadre 7 ET son forfait écrit, dans une transaction. Refuse si le forfait est validé.';

revoke execute on function public.ecrire_forfait_kilometrique(uuid, jsonb) from public, anon;
grant execute on function public.ecrire_forfait_kilometrique(uuid, jsonb) to authenticated;
revoke execute on function public.retirer_vehicule(uuid) from public, anon;
grant execute on function public.retirer_vehicule(uuid) to authenticated;
