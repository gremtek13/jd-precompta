-- LA BASE LIT LE PLAN, SANS RIEN CHANGER — ligne 43, étape PC2, migration 2 sur 6 :
-- l'affectation et la ventilation d'un mouvement.
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
  if not exists (select 1 from supabase_migrations.schema_migrations where name = 'la_base_lit_le_plan_1')
     or exists (select 1 from (values
                     ('enregistrer_paiement_personnel_cotisation(uuid, uuid, date, jsonb)', '413e4db0288b1507644f381f934ccf6a'),
                     ('lettrer_pieces(uuid, text, uuid[])', '5ce7f42bd97dc1d0f86d055d95f3f63b'),
                     ('soldes_a_reporter(uuid, integer)', '25b9a225872874ef24d6044cfa097483')
                   ) as v(f, apres)
                 where md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.' || v.f)),
                                   E'\r\n', E'\n')) is distinct from v.apres) then
    raise exception 'La migration la_base_lit_le_plan_1 n''est pas en base : l''appliquer d''abord, puis celle-ci.';
  end if;
  -- Chaque corps remplacé est celui sur lequel cette migration a été écrite (fins de ligne ramenées à \n).
  for f in select * from (values
    ('affecter_mouvement_bancaire(uuid, uuid, jsonb, numeric)', '4fb61eddac8c1a2872fc076c2b9f3e8d', 'd6a960d105dc2e317eb2cf71c41259bb'),
    ('ventiler_mouvement_bancaire(uuid, jsonb, jsonb)', 'f9651d3833511a10785ebb4bd3c3e0c6', '6972d28e548e9717fdd5f959d38a6e80')
  ) as v(fonction, avant, apres) loop
    select md5(replace(p.prosrc, E'\r\n', E'\n')) into v_corps
      from pg_proc p where p.oid = to_regprocedure('public.' || f.fonction);
    if v_corps = f.avant then v_avant := v_avant + 1;
    elsif v_corps = f.apres then v_apres := v_apres + 1;
    else v_autres := concat_ws(', ', v_autres, f.fonction);
    end if;
  end loop;
  if v_apres = 2 then
    raise exception 'La migration la_base_lit_le_plan_2 est déjà en base : rien à faire.';
  end if;
  if v_avant <> 2 then
    raise exception 'Une fonction n''est plus celle sur laquelle cette migration a été écrite (%) : rien n''est remplacé.',
      coalesce(v_autres, 'en partie déjà remplacée');
  end if;
end
$garde$;

-- ══ affecter_mouvement_bancaire ══
create or replace function public.affecter_mouvement_bancaire(
  p_ligne_bancaire_id uuid,
  p_categorie_id uuid,
  p_ecritures jsonb,
  p_taux_tva numeric default null
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_categorie public.categories%rowtype;
  v_assujetti boolean;
  v_avec_taux boolean;
  v_tva numeric := 0;
  v_sens_banque text;
  v_sens_compte text;
  v_conforme boolean;
  v_nb integer;
  v_debit numeric;
  v_credit numeric;
  v_banque text;
  v_tva_collectee text;
begin
  select * into v_ligne from public.lignes_bancaires where id = p_ligne_bancaire_id for update;
  if not found or not admin_du_dossier(v_ligne.dossier_id) then
    raise exception 'Accès refusé à ce mouvement.' using errcode = '42501';
  end if;
  if v_ligne.piece_id is not null or v_ligne.cotisation_id is not null or v_ligne.prelevement_personnel then
    raise exception 'Ce mouvement est rapproché d''une pièce ou d''une échéance, ou classé en virement personnel : annule d''abord ce classement.'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
    where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se remplace plus.' using errcode = '23514';
  end if;

  select * into v_categorie from public.categories where id = p_categorie_id;
  if not found or (v_categorie.dossier_id is not null and v_categorie.dossier_id <> v_ligne.dossier_id) then
    raise exception 'Cette catégorie n''existe pas pour ce dossier.' using errcode = '22023';
  end if;
  if v_categorie.compte_comptable is null or v_categorie.compte_comptable !~ '^[67][0-9]{2}' then
    raise exception 'La catégorie « % » n''a pas de compte de charge ou de produit (classe 6 ou 7).', v_categorie.libelle
      using errcode = '22023';
  end if;

  -- Le taux : exigé pour une recette d'un dossier assujetti, refusé partout ailleurs.
  select assujetti_tva into v_assujetti from public.dossiers where id = v_ligne.dossier_id;
  v_avec_taux := v_assujetti and v_categorie.compte_comptable ~ '^7';
  if v_avec_taux and p_taux_tva is null then
    raise exception 'Sur un dossier assujetti à la TVA, une recette porte son taux : choisis-le, ou « exonérée ».'
      using errcode = '22023';
  end if;
  if not v_avec_taux and p_taux_tva is not null then
    raise exception 'Un taux de TVA ne s''applique qu''à une recette d''un dossier assujetti.' using errcode = '22023';
  end if;
  if p_taux_tva is not null and p_taux_tva not in (0, 5.5, 8.5, 10, 20) then
    raise exception 'Ce taux de TVA n''est pas pris en charge.' using errcode = '22023';
  end if;
  if v_ligne.montant = 0 then
    raise exception 'Un mouvement de zéro euro n''a rien à écrire.' using errcode = '22023';
  end if;

  -- L'écriture attendue : la banque au montant et dans le sens du mouvement, la catégorie au hors taxe
  -- dans le sens inverse, et la TVA collectée à côté d'elle quand le taux en porte. Comparée en
  -- MULTIENSEMBLE, comme celle d'une ventilation : autant de lignes, et chacune des attendues présente.
  if p_taux_tva is not null then
    v_tva := public.tva_incluse(v_ligne.montant, p_taux_tva);
  end if;
  v_sens_banque := case when v_ligne.montant > 0 then 'debit' else 'credit' end;
  v_sens_compte := case when v_ligne.montant > 0 then 'credit' else 'debit' end;
  if jsonb_typeof(p_ecritures) is distinct from 'array' then
    raise exception 'L''écriture proposée est incomplète.' using errcode = '22023';
  end if;
  -- Le plan du dossier (ligne 43) se lit sous son verrou PARTAGÉ — la clé de `cle_validation`, que l'appelant
  -- n'exécute pas — : un changement du plan (étape PC4) et cet appel ne se croisent pas.
  perform pg_advisory_xact_lock_shared(hashtextextended('jd.validation_exercice:' || v_ligne.dossier_id::text, 0));
  v_banque := public.compte_du_role(v_ligne.dossier_id, 'banque');
  v_tva_collectee := public.compte_du_role(v_ligne.dossier_id, 'tva_collectee');
  with attendues as (
    select v_banque as compte, v_sens_banque as sens, abs(v_ligne.montant) as montant
    union all
    select v_categorie.compte_comptable, v_sens_compte, abs(v_ligne.montant) - v_tva
    union all
    select v_tva_collectee, v_sens_compte, v_tva where v_tva > 0
  ), recues as (
    select e->>'compte' as compte, e->>'sens' as sens, (e->>'montant')::numeric as montant
    from jsonb_array_elements(p_ecritures) as e
  )
  select (select count(*) from recues) = (select count(*) from attendues)
     and not exists (select compte, sens, montant from attendues except all select compte, sens, montant from recues)
    into v_conforme;
  if not coalesce(v_conforme, false) then
    raise exception 'L''écriture proposée ne correspond pas à ce mouvement et à cette catégorie.' using errcode = '22023';
  end if;

  update public.lignes_bancaires
     set categorie_id = p_categorie_id, taux_tva = p_taux_tva, statut = 'rapprochee'
   where id = p_ligne_bancaire_id;

  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null;

  insert into public.ecritures_brouillon (dossier_id, piece_id, ligne_bancaire_id, date, compte, libelle, montant, sens, statut)
  select v_ligne.dossier_id, null, p_ligne_bancaire_id, v_ligne.date, e->>'compte', coalesce(e->>'libelle', ''),
         (e->>'montant')::numeric, e->>'sens', 'proposee'
  from jsonb_array_elements(p_ecritures) as e;
  get diagnostics v_nb = row_count;

  select coalesce(sum(montant) filter (where sens = 'debit'), 0),
         coalesce(sum(montant) filter (where sens = 'credit'), 0)
    into v_debit, v_credit
  from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null;
  if v_debit <> v_credit then
    raise exception 'Écriture déséquilibrée : % au débit, % au crédit.', v_debit, v_credit using errcode = '23514';
  end if;

  return v_nb;
end;
$$;

-- ══ ventiler_mouvement_bancaire ══
create or replace function public.ventiler_mouvement_bancaire(
  p_ligne_bancaire_id uuid,
  p_parts jsonb,
  p_ecritures jsonb
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_part record;
  v_somme numeric := 0;
  v_nb_parts integer;
  v_nb_cibles integer;
  v_assujetti boolean;
  v_compte_dirigeant text;
  v_banque text;
  v_tva_collectee text;
  v_libelle text;
  v_conforme boolean;
  v_nb integer;
  v_debit numeric;
  v_credit numeric;
begin
  select * into v_ligne from public.lignes_bancaires where id = p_ligne_bancaire_id for update;
  if not found or not admin_du_dossier(v_ligne.dossier_id) then
    raise exception 'Accès refusé à ce mouvement.' using errcode = '42501';
  end if;
  if v_ligne.piece_id is not null or v_ligne.cotisation_id is not null or v_ligne.categorie_id is not null
     or v_ligne.emprunt_id is not null or v_ligne.prelevement_personnel then
    raise exception 'Ce mouvement est rapproché d''une pièce, d''une cotisation ou d''un emprunt, affecté à une catégorie ou classé en virement personnel : annule d''abord ce classement.'
      using errcode = '22023';
  end if;
  if v_ligne.montant = 0 then
    raise exception 'Un mouvement de zéro euro n''a rien à écrire.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
    where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se remplace plus.' using errcode = '23514';
  end if;

  -- Les parts : au moins deux — une seule serait une affectation, qui a sa forme à elle —, chacune une
  -- cible et un montant non nul au centime (la colonne arrondirait en silence), une part par cible, et
  -- leur somme est le mouvement, au centime.
  if jsonb_typeof(p_parts) is distinct from 'array' or jsonb_array_length(p_parts) < 2 then
    raise exception 'Une ventilation porte au moins deux parts.' using errcode = '22023';
  end if;
  for v_part in
    select (e->>'categorie_id')::uuid as categorie_id,
           coalesce((e->>'part_personnelle')::boolean, false) as part_personnelle,
           (e->>'montant')::numeric as montant
    from jsonb_array_elements(p_parts) as e
  loop
    if num_nonnulls(v_part.categorie_id, nullif(v_part.part_personnelle, false)) <> 1 then
      raise exception 'Chaque part va à une catégorie ou au compte du dirigeant, jamais aux deux ni à aucun.'
        using errcode = '22023';
    end if;
    if v_part.montant is null or v_part.montant = 0 or v_part.montant <> round(v_part.montant, 2) then
      raise exception 'Chaque part porte un montant non nul, au centime.' using errcode = '22023';
    end if;
    v_somme := v_somme + v_part.montant;
  end loop;
  select count(*), count(distinct coalesce((e->>'categorie_id')::uuid::text, 'dirigeant'))
    into v_nb_parts, v_nb_cibles
  from jsonb_array_elements(p_parts) as e;
  if v_nb_cibles <> v_nb_parts then
    raise exception 'Deux parts vont à la même catégorie, ou au compte du dirigeant : réunis-les en une.'
      using errcode = '22023';
  end if;
  if v_somme <> v_ligne.montant then
    raise exception 'Les parts font % € au lieu des % € du mouvement.',
      replace(to_char(v_somme, 'FM999999999990.00'), '.', ','),
      replace(to_char(v_ligne.montant, 'FM999999999990.00'), '.', ',')
      using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_parts) as e
     where e->>'categorie_id' is not null
       and not exists (
         select 1 from public.categories c
          where c.id = (e->>'categorie_id')::uuid
            and (c.dossier_id is null or c.dossier_id = v_ligne.dossier_id)
       )
  ) then
    raise exception 'Cette catégorie n''existe pas pour ce dossier.' using errcode = '22023';
  end if;
  select c.libelle into v_libelle
    from public.categories c
   where c.id in (select (e->>'categorie_id')::uuid from jsonb_array_elements(p_parts) as e)
     and (c.compte_comptable is null or c.compte_comptable !~ '^[67][0-9]{2}')
   order by c.libelle
   limit 1;
  if found then
    raise exception 'La catégorie « % » n''a pas de compte de charge ou de produit (classe 6 ou 7).', v_libelle
      using errcode = '22023';
  end if;
  -- Le plan du dossier (ligne 43) se lit sous son verrou PARTAGÉ — la clé de `cle_validation`, que l'appelant
  -- n'exécute pas — : un changement du plan (étape PC4) et cet appel ne se croisent pas.
  perform pg_advisory_xact_lock_shared(hashtextextended('jd.validation_exercice:' || v_ligne.dossier_id::text, 0));
  v_banque := public.compte_du_role(v_ligne.dossier_id, 'banque');
  v_tva_collectee := public.compte_du_role(v_ligne.dossier_id, 'tva_collectee');
  select assujetti_tva, public.compte_du_dirigeant(id)
    into v_assujetti, v_compte_dirigeant
  from public.dossiers where id = v_ligne.dossier_id;

  -- Le taux de chaque part : exigé pour une part de recette d'un dossier assujetti, refusé ailleurs. La
  -- première part fautive dans l'ordre des libellés, comme ci-dessus : deux parts fautives ne font pas
  -- deux messages différents selon leur ordre.
  select c.libelle into v_libelle
    from jsonb_array_elements(p_parts) as e
    join public.categories c on c.id = (e->>'categorie_id')::uuid
   where v_assujetti and c.compte_comptable ~ '^7' and e->>'taux_tva' is null
   order by c.libelle
   limit 1;
  if found then
    raise exception 'Sur un dossier assujetti à la TVA, la part « % » est une recette : choisis son taux, ou « exonérée ».', v_libelle
      using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_parts) as e
    left join public.categories c on c.id = (e->>'categorie_id')::uuid
    where e->>'taux_tva' is not null
      and not (v_assujetti and coalesce(c.compte_comptable ~ '^7', false))
  ) then
    raise exception 'Un taux de TVA ne s''applique qu''à une part de recette d''un dossier assujetti.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_parts) as e
    where (e->>'taux_tva')::numeric not in (0, 5.5, 8.5, 10, 20)
  ) then
    raise exception 'Ce taux de TVA n''est pas pris en charge.' using errcode = '22023';
  end if;

  -- L'écriture attendue : la banque au montant et dans le sens du mouvement, puis une ligne par part, sur
  -- le compte de sa catégorie ou celui du dirigeant, dans le sens de son signe — au hors taxe pour une
  -- part de recette taxée, dont la TVA collectée prend une ligne à côté. Comparée en MULTIENSEMBLE, comme
  -- celle d'une échéance d'emprunt : autant de lignes, et chacune des attendues présente.
  if jsonb_typeof(p_ecritures) is distinct from 'array' then
    raise exception 'L''écriture proposée est incomplète.' using errcode = '22023';
  end if;
  with parts as (
    select (e->>'categorie_id')::uuid as categorie_id, (e->>'montant')::numeric as montant,
           (e->>'taux_tva')::numeric as taux
    from jsonb_array_elements(p_parts) as e
  ), lignes_parts as (
    select coalesce(c.compte_comptable, v_compte_dirigeant) as compte,
           case when p.montant > 0 then 'credit' else 'debit' end as sens,
           abs(p.montant) as montant,
           coalesce(public.tva_incluse(p.montant, p.taux), 0) as tva
    from parts p left join public.categories c on c.id = p.categorie_id
  ), attendues as (
    select v_banque as compte,
           case when v_ligne.montant > 0 then 'debit' else 'credit' end as sens,
           abs(v_ligne.montant) as montant
    union all
    select compte, sens, montant - tva from lignes_parts
    union all
    select v_tva_collectee, sens, tva from lignes_parts where tva > 0
  ), recues as (
    select e->>'compte' as compte, e->>'sens' as sens, (e->>'montant')::numeric as montant
    from jsonb_array_elements(p_ecritures) as e
  )
  select (select count(*) from recues) = (select count(*) from attendues)
     and not exists (select compte, sens, montant from attendues except all select compte, sens, montant from recues)
    into v_conforme;
  if not coalesce(v_conforme, false) then
    raise exception 'L''écriture proposée ne correspond pas à ce mouvement et à cette ventilation.' using errcode = '22023';
  end if;

  update public.lignes_bancaires
     set statut = 'rapprochee', ventilee = true
   where id = p_ligne_bancaire_id;

  delete from public.ventilations_bancaires where ligne_bancaire_id = p_ligne_bancaire_id;
  insert into public.ventilations_bancaires (dossier_id, ligne_bancaire_id, categorie_id, part_personnelle, montant, taux_tva)
  select v_ligne.dossier_id, p_ligne_bancaire_id, (e->>'categorie_id')::uuid,
         coalesce((e->>'part_personnelle')::boolean, false), (e->>'montant')::numeric, (e->>'taux_tva')::numeric
  from jsonb_array_elements(p_parts) as e;

  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null;

  insert into public.ecritures_brouillon (dossier_id, piece_id, ligne_bancaire_id, date, compte, libelle, montant, sens, statut)
  select v_ligne.dossier_id, null, p_ligne_bancaire_id, v_ligne.date, e->>'compte', coalesce(e->>'libelle', ''),
         (e->>'montant')::numeric, e->>'sens', 'proposee'
  from jsonb_array_elements(p_ecritures) as e;
  get diagnostics v_nb = row_count;

  select coalesce(sum(montant) filter (where sens = 'debit'), 0),
         coalesce(sum(montant) filter (where sens = 'credit'), 0)
    into v_debit, v_credit
  from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null;
  if v_debit <> v_credit then
    raise exception 'Écriture déséquilibrée : % au débit, % au crédit.', v_debit, v_credit using errcode = '23514';
  end if;

  return v_nb;
end;
$$;
