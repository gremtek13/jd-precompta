-- Ligne 26.6 de la feuille de route, étape (b) : les DOTATIONS AUX AMORTISSEMENTS s'écrivent. La 2035 les
-- comptait en case CH depuis le registre des immobilisations, et aucune écriture ne les portait : ni 681100
-- ni compte 28 au brouillon, donc rien au FEC — un vérificateur qui additionne le fichier ne retrouvait pas
-- la 2035.
--
-- LE CALCUL EST CELUI DE LA RÈGLE FISCALE : linéaire, PRORATA TEMPORIS depuis la mise en service, en mois de
-- trente jours (30/360). La première annuité d'un bien mis en service en cours d'année est réduite, et le
-- reliquat se déduit une année de plus, après la durée. L'application comptait jusqu'ici l'annuité pleine
-- dès l'année d'acquisition, et le disait (« à reprendre à la main avant de signer ») : écrire ce chiffre au
-- FEC aurait gravé une dotation connue pour fausse.
--
-- LE CUMUL S'ARRONDIT, PAS L'ANNUITÉ : l'amortissement cumulé au soir d'un jour vaut la valeur × les jours
-- en service ÷ (360 × la durée), au centime, le demi-centime vers le haut, plafonné à la valeur ; la
-- dotation d'un exercice est l'écart de deux cumuls. La somme des dotations fait donc EXACTEMENT la valeur.
-- Même calcul, en entiers, que src/lib/amortissements.ts — la parité est testée sur une table relevée ici.
--
-- L'ÉCRITURE : au 31 décembre de l'exercice, la dotation au débit du 681100 et au crédit du compte
-- d'amortissement du bien — 28 suivi de son compte d'immobilisation sans le 2, sur six chiffres (218300 →
-- 281830). Ce compte vient de la NATURE du bien, qui porte désormais son compte de classe 2. L'écriture est
-- composée par l'application, VÉRIFIÉE ici contre le registre, et remplace la précédente en une transaction
-- (voir supabase/essais/dotations.sql).

-- Le compte de classe 2 d'une nature : immobilisation incorporelle (20) ou corporelle (21), six chiffres. Le
-- défaut est le compte des « autres immobilisations corporelles ».
alter table public.natures_immobilisation
  add column compte_immobilisation text not null default '218000';
alter table public.natures_immobilisation add constraint natures_immobilisation_compte_immobilisation_format
  check (compte_immobilisation ~ '^2[01][0-9]{4}$');

-- Les huit natures partagées par le cabinet reçoivent le compte du plan comptable que leur libellé désigne.
update public.natures_immobilisation set compte_immobilisation = case libelle
    when 'Téléphone / matériel électronique' then '218300'
    when 'Informatique (ordinateur, imprimante...)' then '218300'
    when 'Logiciel' then '205000'
    when 'Mobilier de bureau' then '218400'
    when 'Matériel médical' then '215400'
    when 'Véhicule' then '218200'
    when 'Agencements / travaux' then '218100'
    else compte_immobilisation
  end
where dossier_id is null;

-- La mise en service : le point de départ de l'amortissement. Nulle, c'est la date d'acquisition.
alter table public.immobilisations add column date_mise_en_service date;

-- Une valeur au centime : le calcul la prend en centimes entiers, ici comme dans l'application, et une
-- fraction de centime y donnerait deux arrondis différents.
alter table public.immobilisations add constraint immobilisations_valeur_au_centime
  check (valeur = round(valeur, 2));

-- L'écriture d'une dotation désigne son bien. Clé SANS action à la suppression : un bien dont une dotation
-- est écrite ne se supprime que par `retirer_immobilisation`, qui retire ses dotations avec lui. Une
-- dotation n'est ni l'écriture d'une pièce ni celle d'un mouvement, et elle tombe au 31 décembre.
alter table public.ecritures_brouillon add column immobilisation_id uuid references public.immobilisations(id);
create index ecritures_brouillon_immobilisation_id_idx on public.ecritures_brouillon (immobilisation_id);
alter table public.ecritures_brouillon add constraint ecritures_brouillon_dotation_sans_piece_ni_mouvement
  check (immobilisation_id is null or (piece_id is null and ligne_bancaire_id is null));
alter table public.ecritures_brouillon add constraint ecritures_brouillon_dotation_au_31_decembre
  check (immobilisation_id is null or (extract(month from date) = 12 and extract(day from date) = 31));

-- Le compte d'amortissement d'un compte d'immobilisation : 28 suivi du compte sans son 2, sur six chiffres.
create function public.compte_amortissement(p_compte text) returns text
language sql
immutable
strict
set search_path = public
as $$
  select '28' || substr(p_compte, 2, 4)
$$;

-- Le rang d'un jour en mois de trente jours : douze mois de trente jours, le 31 compté comme le 30.
create function public.rang_360(p_jour date) returns integer
language sql
immutable
strict
set search_path = public
as $$
  select extract(year from p_jour)::integer * 360 + (extract(month from p_jour)::integer - 1) * 30
         + least(extract(day from p_jour)::integer, 30) - 1
$$;

-- L'amortissement cumulé d'un bien au soir du jour de rang `p_rang`, en centimes : la valeur × les jours en
-- service (le jour de mise en service compris) ÷ (360 × la durée), le demi-centime vers le haut, plafonné à
-- la valeur. Même calcul que amortissementCumuleCentimes (src/lib/amortissements.ts).
create function public.amortissement_cumule_centimes(
  p_valeur numeric, p_duree integer, p_mise_en_service date, p_rang integer
) returns bigint
language sql
immutable
strict
set search_path = public
as $$
  select (2 * round(p_valeur * 100)::bigint
            * least(greatest(p_rang - public.rang_360(p_mise_en_service) + 1, 0), 360 * p_duree)::bigint
          + 360 * p_duree) / (720 * p_duree)::bigint
$$;

-- La dotation d'un exercice : l'écart du cumul au 31 décembre et de celui de l'exercice précédent.
create function public.dotation_amortissement(
  p_valeur numeric, p_duree integer, p_mise_en_service date, p_annee integer
) returns numeric
language sql
immutable
strict
set search_path = public
as $$
  select round((public.amortissement_cumule_centimes(p_valeur, p_duree, p_mise_en_service,
                  public.rang_360(make_date(p_annee, 12, 31)))
              - public.amortissement_cumule_centimes(p_valeur, p_duree, p_mise_en_service,
                  public.rang_360(make_date(p_annee - 1, 12, 31))))::numeric / 100, 2)
$$;

create function public.ecrire_dotation_amortissement(
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

  -- L'écriture attendue, comparée en MULTIENSEMBLE : autant de lignes, et chacune des attendues présente. Une
  -- dotation nulle n'en attend aucune — l'appel retire alors celle qui aurait été écrite.
  with attendues as (
    select a.compte, a.sens, a.montant from (values
      ('681100', 'debit', v_montant),
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
  'Écrit la dotation aux amortissements d''un bien pour un exercice (681100 au débit, le compte 28 de sa nature '
  'au crédit, au 31 décembre), vérifiée contre le registre, et remplace celle qui était écrite. Une dotation '
  'nulle (avant la mise en service, après la durée, avant l''ouverture du dossier) retire celle qui existait.';

create function public.retirer_immobilisation(p_immobilisation_id uuid) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_immo public.immobilisations%rowtype;
  v_nb integer;
begin
  select * into v_immo from public.immobilisations where id = p_immobilisation_id for update;
  if not found or not admin_du_dossier(v_immo.dossier_id) then
    raise exception 'Accès refusé à ce bien.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon where immobilisation_id = p_immobilisation_id and statut <> 'proposee'
  ) then
    raise exception 'Une dotation de ce bien est validée : il ne se retire plus.' using errcode = '23514';
  end if;

  delete from public.ecritures_brouillon where immobilisation_id = p_immobilisation_id;
  get diagnostics v_nb = row_count;
  delete from public.immobilisations where id = p_immobilisation_id;
  return v_nb;
end;
$$;

comment on function public.retirer_immobilisation(uuid) is
  'Retire un bien du registre ET ses dotations écrites, dans une transaction. Refuse si l''une d''elles est '
  'validée.';

revoke execute on function public.compte_amortissement(text) from public, anon;
grant execute on function public.compte_amortissement(text) to authenticated;
revoke execute on function public.rang_360(date) from public, anon;
grant execute on function public.rang_360(date) to authenticated;
revoke execute on function public.amortissement_cumule_centimes(numeric, integer, date, integer) from public, anon;
grant execute on function public.amortissement_cumule_centimes(numeric, integer, date, integer) to authenticated;
revoke execute on function public.dotation_amortissement(numeric, integer, date, integer) from public, anon;
grant execute on function public.dotation_amortissement(numeric, integer, date, integer) to authenticated;
revoke execute on function public.ecrire_dotation_amortissement(uuid, integer, jsonb) from public, anon;
grant execute on function public.ecrire_dotation_amortissement(uuid, integer, jsonb) to authenticated;
revoke execute on function public.retirer_immobilisation(uuid) from public, anon;
grant execute on function public.retirer_immobilisation(uuid) to authenticated;
