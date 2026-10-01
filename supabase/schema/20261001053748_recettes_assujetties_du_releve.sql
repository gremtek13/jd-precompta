-- Ligne 26.6 de la feuille de route, étape (a), fin : les RECETTES d'un dossier ASSUJETTI à la TVA
-- s'affectent et se ventilent depuis le relevé. Jusqu'ici l'affectation et la ventilation les
-- refusaient : la TVA d'une recette ne se lit pas sur un relevé, et l'écrire au TTC en 706 aurait
-- compté la taxe en chiffre d'affaires sans qu'aucune CA3 la voie.
--
-- LE TAUX SE CHOISIT à l'affectation — 20, 10, 5,5 ou 8,5 %, ou zéro pour une recette exonérée ou non
-- imposable (les actes de soins d'un praticien dont une autre activité est taxée) —, il n'est jamais
-- deviné, et la TVA se calcule sur le montant du mouvement : TTC × taux / (100 + taux), au centime, le
-- demi-centime vers le haut. L'écriture d'une recette taxée porte trois lignes, dans le sens du
-- mouvement comme toute affectation : la banque au TTC, la recette au hors taxe, la TVA collectée
-- (445710). Elle est composée par l'application (lib/affectationBanque.ts, lib/ventilationBanque.ts,
-- testés) ; la base la VÉRIFIE en multiensemble contre le mouvement, la catégorie et le taux.
--
-- LE TAUX SE GARDE sur le mouvement (affectation), sur la part (ventilation) et sur la règle, pour que
-- le lot le reprenne : la CA3 et la 2035 le lisent là, comme le découpage d'une échéance d'emprunt. Les
-- contraintes n'admettent un taux que là où une catégorie est désignée ; les fonctions l'exigent pour
-- une recette d'un dossier assujetti et le refusent ailleurs — un taux sur une dépense dirait une TVA
-- déductible, que seule la facture ouvre.

alter table public.lignes_bancaires add column taux_tva numeric(4,2);

comment on column public.lignes_bancaires.taux_tva is
  'Taux de TVA d''une recette affectée sur un dossier assujetti (20, 10, 5,5 ou 8,5 ; 0 : exonérée ou non '
  'imposable), choisi à l''affectation. Nul pour une dépense, sur un dossier non assujetti et sur un '
  'mouvement non affecté. Écrit avec l''affectation par affecter_mouvement_bancaire, effacé avec elle.';

alter table public.lignes_bancaires add constraint lignes_bancaires_taux_tva
  check (taux_tva is null or (categorie_id is not null and taux_tva in (0, 5.5, 8.5, 10, 20)));

alter table public.ventilations_bancaires add column taux_tva numeric(4,2);

comment on column public.ventilations_bancaires.taux_tva is
  'Taux de TVA d''une part de recette sur un dossier assujetti (20, 10, 5,5 ou 8,5 ; 0 : exonérée ou non '
  'imposable). Nul pour une part de dépense, pour la part personnelle et sur un dossier non assujetti.';

alter table public.ventilations_bancaires add constraint ventilations_bancaires_taux_tva
  check (taux_tva is null or (categorie_id is not null and taux_tva in (0, 5.5, 8.5, 10, 20)));

alter table public.regles_affectation_bancaire add column taux_tva numeric(4,2);

comment on column public.regles_affectation_bancaire.taux_tva is
  'Le taux de TVA que la règle propose avec sa catégorie, pour une recette d''un dossier assujetti. Le lot '
  'ne le transmet qu''à une recette d''un dossier assujetti, et il est nul ailleurs.';

alter table public.regles_affectation_bancaire add constraint regles_affectation_bancaire_taux_tva
  check (taux_tva is null or taux_tva in (0, 5.5, 8.5, 10, 20));

-- La TVA comprise dans un montant TTC, au centime. Arithmétique ENTIÈRE — en centimes et en dixièmes de
-- point — pour que la base et l'application (lib/tvaDuReleve.ts) arrondissent EXACTEMENT de la même
-- façon : une écriture refusée pour un centime serait un défaut que personne ne comprendrait.
create function public.tva_incluse(p_montant numeric, p_taux numeric) returns numeric
language sql
immutable
strict
set search_path = public
as $$
  select round(
    ((2 * round(abs(p_montant) * 100)::bigint * round(p_taux * 10)::bigint + 1000 + round(p_taux * 10)::bigint)
      / (2 * (1000 + round(p_taux * 10)::bigint)))::numeric / 100,
    2)
$$;

comment on function public.tva_incluse(numeric, numeric) is
  'La TVA comprise dans un montant TTC à un taux donné, positive, au centime (demi-centime vers le haut). '
  'Même calcul que tvaIncluse (lib/tvaDuReleve.ts).';

revoke execute on function public.tva_incluse(numeric, numeric) from public, anon;
grant execute on function public.tva_incluse(numeric, numeric) to authenticated;

-- L'affectation prend le taux en quatrième argument, nul par défaut : un appel à trois arguments — le
-- lot d'avant, les essais — reste celui d'une catégorie sans TVA.
drop function public.affecter_mouvement_bancaire(uuid, uuid, jsonb);

create function public.affecter_mouvement_bancaire(
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
  with attendues as (
    select '512000'::text as compte, v_sens_banque as sens, abs(v_ligne.montant) as montant
    union all
    select v_categorie.compte_comptable, v_sens_compte, abs(v_ligne.montant) - v_tva
    union all
    select '445710', v_sens_compte, v_tva where v_tva > 0
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

comment on function public.affecter_mouvement_bancaire(uuid, uuid, jsonb, numeric) is
  'Affecte un mouvement sans justificatif à une catégorie de résultat ET écrit son écriture, dans une '
  'transaction : la catégorie face à la banque, et la TVA collectée d''une recette d''un dossier assujetti, '
  'à son taux. Rejouée sur un mouvement affecté, elle remplace l''affectation et l''écriture.';

revoke execute on function public.affecter_mouvement_bancaire(uuid, uuid, jsonb, numeric) from public, anon;
grant execute on function public.affecter_mouvement_bancaire(uuid, uuid, jsonb, numeric) to authenticated;

-- Le lot transmet le taux de chaque affectation : celui de la règle, pour une recette d'un dossier
-- assujetti, et rien ailleurs (lib/reglesAffectation.ts).
create or replace function public.affecter_mouvements_bancaires(p_affectations jsonb) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_affectation jsonb;
  v_ligne public.lignes_bancaires%rowtype;
  v_nb integer := 0;
begin
  if jsonb_typeof(p_affectations) is distinct from 'array' or jsonb_array_length(p_affectations) = 0 then
    raise exception 'Aucune affectation à enregistrer.' using errcode = '22023';
  end if;
  for v_affectation in select value from jsonb_array_elements(p_affectations) loop
    select * into v_ligne from public.lignes_bancaires
     where id = (v_affectation->>'ligne_bancaire_id')::uuid for update;
    if not found or not admin_du_dossier(v_ligne.dossier_id) then
      raise exception 'Accès refusé à ce mouvement.' using errcode = '42501';
    end if;
    -- En lot, seul ce qui est À TRAITER s'affecte. Un mouvement rapproché ou affecté depuis
    -- l'affichage — un autre onglet, un collègue — porte une décision humaine que le lot écraserait :
    -- affecter_mouvement_bancaire REMPLACE une affectation, ce qui est voulu pour « Réaffecter », pas ici.
    if v_ligne.statut <> 'non_rapprochee' then
      raise exception 'Le mouvement du % (% €) n''est plus à traiter : il a changé depuis l''affichage.',
        to_char(v_ligne.date, 'DD/MM/YYYY'), replace(v_ligne.montant::text, '.', ',')
        using errcode = '22023';
    end if;
    -- Tout ou rien : le refus d'un seul défait tout l'appel. Il est renvoyé avec le mouvement qui
    -- l'a provoqué, et son code d'origine.
    begin
      perform public.affecter_mouvement_bancaire(v_ligne.id, (v_affectation->>'categorie_id')::uuid,
        v_affectation->'ecritures', (v_affectation->>'taux_tva')::numeric);
    exception when others then
      raise exception 'Mouvement du % (% €) : %', to_char(v_ligne.date, 'DD/MM/YYYY'),
        replace(v_ligne.montant::text, '.', ','), sqlerrm
        using errcode = sqlstate;
    end;
    v_nb := v_nb + 1;
  end loop;
  return v_nb;
end;
$$;

-- Le retrait efface le taux avec la catégorie : la contrainte n'admet pas un taux sans elle.
create or replace function public.retirer_affectation_mouvement_bancaire(p_ligne_bancaire_id uuid) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_nb integer;
begin
  select * into v_ligne from public.lignes_bancaires where id = p_ligne_bancaire_id for update;
  if not found or not admin_du_dossier(v_ligne.dossier_id) then
    raise exception 'Accès refusé à ce mouvement.' using errcode = '42501';
  end if;
  if v_ligne.categorie_id is null then
    raise exception 'Ce mouvement n''est affecté à aucune catégorie.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
    where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se retire plus.' using errcode = '23514';
  end if;

  update public.lignes_bancaires
     set categorie_id = null, taux_tva = null, statut = 'non_rapprochee'
   where id = p_ligne_bancaire_id;

  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null;
  get diagnostics v_nb = row_count;
  return v_nb;
end;
$$;

-- La ventilation porte un taux par part, sous la même règle que l'affectation, et une part de recette
-- taxée s'écrit sur deux lignes : la catégorie au hors taxe, la TVA collectée à côté.
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
  select assujetti_tva,
         case when mode_comptable = 'engagement' then compte_notes_de_frais else '108000' end
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
    select '512000'::text as compte,
           case when v_ligne.montant > 0 then 'debit' else 'credit' end as sens,
           abs(v_ligne.montant) as montant
    union all
    select compte, sens, montant - tva from lignes_parts
    union all
    select '445710', sens, tva from lignes_parts where tva > 0
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
