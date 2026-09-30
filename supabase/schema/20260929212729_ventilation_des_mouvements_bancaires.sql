-- Ligne 26.6 de la feuille de route, étape (a), suite : un mouvement sans justificatif se VENTILE sur
-- plusieurs comptes. Une affectation met tout le mouvement dans UNE catégorie ; or un même paiement mêle
-- souvent ce que la 2035 sépare : une dépense en partie personnelle (l'abonnement téléphonique pris en
-- charge à 70 %, le reste prélevé par l'exploitant), un achat qui relève de deux postes, une remise de
-- carte bancaire créditée nette de sa commission (la recette brute au 706, la commission au 627, en sens
-- inverse). Chaque part va à une catégorie de résultat ou au compte du dirigeant (108000 en trésorerie, le
-- compte choisi pour le dirigeant en engagement), et leur somme est le mouvement.
--
-- LES PARTS SE GARDENT DANS UNE TABLE, pas seulement dans l'écriture : la 2035 les lit là, comme l'écran
-- du client, qui n'a pas accès aux écritures — la règle de l'échéance d'emprunt. Le montant d'une part est
-- SIGNÉ comme le relevé (positif, une entrée ; négatif, une sortie), et chaque part s'écrit comme une
-- affectation de ce montant : le sens vient du signe, jamais de la nature du compte.
--
-- La ventilation, ses parts et son écriture s'écrivent ENSEMBLE, dans une transaction. L'écriture est
-- composée par l'application (lib/ventilationBanque.ts, testé) ; la base la VÉRIFIE ligne à ligne contre
-- le mouvement et les parts.
--
-- CE QUE LA BASE TIENT SANS LE CODE, ET CE QU'ELLE NE TIENT PAS. Le drapeau `ventilee` entre dans les
-- contraintes du mouvement (un seul rapprochement ; rapproché, jamais personnel) ; une part a une seule
-- cible, un montant non nul, et une cible ne reçoit qu'une part. Que les parts d'un mouvement ventilé
-- fassent son montant est un invariant ENTRE LIGNES, qu'aucune contrainte de ligne ne dit ; un déclencheur
-- différé le dirait, mais il rendrait impossible la restauration d'une sauvegarde, qui réinsère les
-- mouvements puis leurs parts en requêtes séparées. C'est donc la fonction qui le vérifie, et un contrôle
-- de l'application qui dit un écart (défensif).

alter table public.lignes_bancaires
  add column ventilee boolean not null default false;

comment on column public.lignes_bancaires.ventilee is
  'Mouvement sans justificatif ventilé sur plusieurs comptes : ses parts sont dans ventilations_bancaires. '
  'Exclusif d''une pièce, d''une cotisation, d''une catégorie et d''un emprunt '
  '(lignes_bancaires_un_seul_rapprochement). Posé avec les parts et l''écriture par '
  'ventiler_mouvement_bancaire, retiré avec elles par retirer_ventilation_mouvement_bancaire.';

alter table public.lignes_bancaires drop constraint lignes_bancaires_un_seul_rapprochement;
alter table public.lignes_bancaires add constraint lignes_bancaires_un_seul_rapprochement
  check (num_nonnulls(piece_id, cotisation_id, categorie_id, emprunt_id, nullif(ventilee, false)) <= 1);

alter table public.lignes_bancaires add constraint lignes_bancaires_ventilation_rapprochee
  check (not ventilee or (statut = 'rapprochee' and not prelevement_personnel));

create table public.ventilations_bancaires (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  ligne_bancaire_id uuid not null references public.lignes_bancaires(id) on delete cascade,
  categorie_id uuid references public.categories(id),
  part_personnelle boolean not null default false,
  montant numeric(12,2) not null,
  created_at timestamptz not null default now(),
  -- Une part va à une catégorie OU au compte du dirigeant : jamais aux deux, jamais à aucun.
  constraint ventilations_bancaires_cible check (num_nonnulls(categorie_id, nullif(part_personnelle, false)) = 1),
  constraint ventilations_bancaires_montant check (montant <> 0),
  -- Une part par cible : deux parts à la même catégorie n'en font qu'une, et le compte du dirigeant n'en
  -- reçoit qu'une — NULLS NOT DISTINCT, sans quoi deux parts personnelles, toutes deux sans catégorie, ne
  -- se heurteraient pas. Contrainte TOTALE, comme toute contrainte unique de ce schéma.
  constraint ventilations_bancaires_une_part_par_cible unique nulls not distinct (ligne_bancaire_id, categorie_id)
);

comment on table public.ventilations_bancaires is
  'Parts d''un mouvement bancaire ventilé sur plusieurs comptes (lignes_bancaires.ventilee) : une catégorie '
  'de résultat ou le compte du dirigeant, un montant signé comme le relevé, et leur somme est le mouvement. '
  'Écrites avec la ventilation et son écriture par ventiler_mouvement_bancaire.';
comment on column public.ventilations_bancaires.montant is
  'Signé comme le relevé : positif, une entrée ; négatif, une sortie. Une part de sens contraire au '
  'mouvement est légitime : la commission retenue sur une remise de carte bancaire.';
comment on column public.ventilations_bancaires.part_personnelle is
  'La part va au compte du dirigeant (108000 en trésorerie, compte_notes_de_frais en engagement) : la part '
  'personnelle d''une dépense mixte, ni charge ni recette.';

create index ventilations_bancaires_dossier_id_idx on public.ventilations_bancaires (dossier_id);
create index ventilations_bancaires_categorie_id_idx on public.ventilations_bancaires (categorie_id);

alter table public.ventilations_bancaires enable row level security;

-- La convention du projet, plus deux garanties que la relecture ne donne pas : le mouvement appartient au
-- dossier annoncé, et la catégorie est celle du dossier ou une catégorie partagée du cabinet.
create policy ventilations_bancaires_cabinet on public.ventilations_bancaires
  for all to authenticated
  using (admin_du_dossier(dossier_id))
  with check (
    admin_du_dossier(dossier_id)
    and exists (
      select 1 from public.lignes_bancaires l
       where l.id = ventilations_bancaires.ligne_bancaire_id
         and l.dossier_id = ventilations_bancaires.dossier_id
    )
    and (
      categorie_id is null
      or exists (
        select 1 from public.categories c
         where c.id = ventilations_bancaires.categorie_id
           and (c.dossier_id is null or c.dossier_id = ventilations_bancaires.dossier_id)
      )
    )
  );

-- Le client lit les parts de SES dossiers, comme il lit leurs mouvements : sa simulation compte les
-- recettes ventilées. Il n'en écrit aucune.
create policy ventilations_bancaires_lecture_client on public.ventilations_bancaires
  for select to authenticated
  using (exists (
    select 1 from public.memberships m
     where m.dossier_id = ventilations_bancaires.dossier_id and m.user_id = auth.uid()
  ));

create function public.ventiler_mouvement_bancaire(
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
  if v_assujetti and exists (
    select 1 from public.categories c
     where c.id in (select (e->>'categorie_id')::uuid from jsonb_array_elements(p_parts) as e)
       and c.compte_comptable ~ '^7'
  ) then
    raise exception 'Sur un dossier assujetti à la TVA, une recette sans facture n''est pas encore prise en charge : sa TVA ne serait pas calculée. Dépose la facture et rapproche-la.'
      using errcode = '22023';
  end if;

  -- L'écriture attendue : la banque au montant et dans le sens du mouvement, puis une ligne par part, sur
  -- le compte de sa catégorie ou celui du dirigeant, dans le sens de son signe. Comparée en MULTIENSEMBLE,
  -- comme celle d'une échéance d'emprunt : autant de lignes, et chacune des attendues présente.
  if jsonb_typeof(p_ecritures) is distinct from 'array' then
    raise exception 'L''écriture proposée est incomplète.' using errcode = '22023';
  end if;
  with parts as (
    select (e->>'categorie_id')::uuid as categorie_id, (e->>'montant')::numeric as montant
    from jsonb_array_elements(p_parts) as e
  ), attendues as (
    select '512000'::text as compte,
           case when v_ligne.montant > 0 then 'debit' else 'credit' end as sens,
           abs(v_ligne.montant) as montant
    union all
    select coalesce(c.compte_comptable, v_compte_dirigeant),
           case when p.montant > 0 then 'credit' else 'debit' end,
           abs(p.montant)
    from parts p left join public.categories c on c.id = p.categorie_id
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
  insert into public.ventilations_bancaires (dossier_id, ligne_bancaire_id, categorie_id, part_personnelle, montant)
  select v_ligne.dossier_id, p_ligne_bancaire_id, (e->>'categorie_id')::uuid,
         coalesce((e->>'part_personnelle')::boolean, false), (e->>'montant')::numeric
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

comment on function public.ventiler_mouvement_bancaire(uuid, jsonb, jsonb) is
  'Ventile un mouvement sans justificatif sur plusieurs comptes (catégories de résultat, compte du '
  'dirigeant) ET écrit ses parts et son écriture, dans une transaction. Rejouée sur un mouvement déjà '
  'ventilé, elle remplace ses parts et son écriture.';

create function public.retirer_ventilation_mouvement_bancaire(p_ligne_bancaire_id uuid) returns integer
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
  if not v_ligne.ventilee then
    raise exception 'Ce mouvement n''est pas ventilé.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
    where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se retire plus.' using errcode = '23514';
  end if;

  update public.lignes_bancaires
     set statut = 'non_rapprochee', ventilee = false
   where id = p_ligne_bancaire_id;

  delete from public.ventilations_bancaires where ligne_bancaire_id = p_ligne_bancaire_id;
  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null;
  get diagnostics v_nb = row_count;
  return v_nb;
end;
$$;

comment on function public.retirer_ventilation_mouvement_bancaire(uuid) is
  'Annule la ventilation d''un mouvement ET retire ses parts et son écriture, dans une transaction.';

revoke execute on function public.ventiler_mouvement_bancaire(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.ventiler_mouvement_bancaire(uuid, jsonb, jsonb) to authenticated;
revoke execute on function public.retirer_ventilation_mouvement_bancaire(uuid) from public, anon;
grant execute on function public.retirer_ventilation_mouvement_bancaire(uuid) to authenticated;
