-- Ligne 26 de la feuille de route : un mouvement bancaire qui RÈGLE PLUSIEURS PIÈCES — un virement
-- fournisseur qui solde trois factures, un règlement client qui en paie deux, un avoir déduit d'un
-- paiement. Un mouvement ne se rapprochait que d'UNE pièce (`lignes_bancaires.piece_id`) : les autres
-- restaient sans paiement, comptées à leur date de facture dans la 2035 et dans AUCUNE déclaration de
-- TVA, et l'écriture de la seule pièce rapprochée portait en banque le virement entier.
--
-- LE GESTE EST MANUEL : l'opérateur choisit les pièces et la part de chacune, et leur somme est le
-- mouvement. Aucun moteur ne propose de regroupement — mesuré le 19 puis le 30/09/2026, aucun mouvement
-- des quatre dossiers ne vaut la somme de deux ou trois pièces sans paiement, donc rien sur quoi régler
-- un tel moteur.
--
-- UNE PART EST UN PAIEMENT DE SA PIÈCE, à la date du mouvement et de son montant : la 2035, la TVA et les
-- écritures la lisent comme un rapprochement simple. Son montant est SIGNÉ comme le relevé, et son signe
-- est celui qui RÈGLE sa pièce — une sortie pour une facture d'achat, une entrée pour une facture de vente
-- ou pour un avoir d'achat : c'est ce qui permet de déduire un avoir d'un paiement.
--
-- LA BASE ÉCRIT LE RÈGLEMENT, PAS LES ÉCRITURES. Celles-ci vivent dans le groupe de chaque pièce et
-- dépendent de ce qui est déjà généré : l'application les écrit par le chemin d'un rapprochement simple,
-- et le contrôle des écritures dit celles qui manquent. La fonction RETIRE en revanche les écritures de ce
-- mouvement quand elle le règle de nouveau, et quand on annule le règlement : aucune contrepartie ne
-- survit à la part qui la justifiait.
--
-- CE QUE LA BASE TIENT SANS LE CODE : le drapeau entre dans les contraintes du mouvement (un seul
-- rapprochement ; rapproché, jamais personnel) ; une part a un montant non nul, et une pièce ne reçoit
-- qu'une part d'un même mouvement. Que les parts fassent le mouvement est un invariant ENTRE LIGNES : la
-- fonction le vérifie, et un contrôle de l'application dit un écart (défensif) — la règle de la
-- ventilation, pour la même raison (une restauration réinsère les mouvements puis leurs parts).
--
-- UNE PIÈCE SUPPRIMÉE LAISSE SA PART, SANS PIÈCE (`on delete set null`) : supprimer une pièce reste
-- possible, comme pour un rapprochement simple, et la part orpheline garde son montant — c'est ce qui
-- permet de dire QUELLE somme du virement ne justifie plus rien.

alter table public.lignes_bancaires
  add column reglement_groupe boolean not null default false;

comment on column public.lignes_bancaires.reglement_groupe is
  'Mouvement qui règle plusieurs pièces : ses parts sont dans reglements_groupes. Exclusif d''une pièce, '
  'd''une cotisation, d''une catégorie, d''un emprunt et d''une ventilation '
  '(lignes_bancaires_un_seul_rapprochement). Posé avec les parts par regler_pieces_par_mouvement, retiré '
  'avec elles par retirer_reglement_groupe.';

alter table public.lignes_bancaires drop constraint lignes_bancaires_un_seul_rapprochement;
alter table public.lignes_bancaires add constraint lignes_bancaires_un_seul_rapprochement
  check (num_nonnulls(piece_id, cotisation_id, categorie_id, emprunt_id, nullif(ventilee, false),
                      nullif(reglement_groupe, false)) <= 1);

alter table public.lignes_bancaires add constraint lignes_bancaires_reglement_groupe_rapproche
  check (not reglement_groupe or (statut = 'rapprochee' and not prelevement_personnel));

create table public.reglements_groupes (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  ligne_bancaire_id uuid not null references public.lignes_bancaires(id) on delete cascade,
  piece_id uuid references public.pieces(id) on delete set null,
  montant numeric(12,2) not null,
  created_at timestamptz not null default now(),
  constraint reglements_groupes_montant check (montant <> 0),
  -- Une pièce ne reçoit qu'une part d'un même mouvement. NULLS DISTINCT, et c'est voulu : deux pièces du
  -- même règlement supprimées laissent deux parts sans pièce, qui ne doivent pas se heurter — sans quoi la
  -- suppression de la seconde échouerait. Contrainte TOTALE, comme toute contrainte unique de ce schéma.
  constraint reglements_groupes_une_part_par_piece unique (ligne_bancaire_id, piece_id)
);

comment on table public.reglements_groupes is
  'Parts d''un mouvement bancaire qui règle plusieurs pièces (lignes_bancaires.reglement_groupe) : la '
  'pièce réglée et le montant qui la règle, signé comme le relevé ; leur somme est le mouvement. Écrites '
  'par regler_pieces_par_mouvement.';
comment on column public.reglements_groupes.montant is
  'Signé comme le relevé : positif, une entrée ; négatif, une sortie. Le signe est celui qui règle la '
  'pièce : une sortie pour une facture d''achat, une entrée pour une facture de vente ou un avoir d''achat.';
comment on column public.reglements_groupes.piece_id is
  'Nulle quand la pièce a été supprimée depuis : la part garde son montant, et l''application la signale.';

create index reglements_groupes_dossier_id_idx on public.reglements_groupes (dossier_id);
create index reglements_groupes_piece_id_idx on public.reglements_groupes (piece_id);

alter table public.reglements_groupes enable row level security;

-- La convention du projet, plus deux garanties que la relecture ne donne pas : le mouvement et la pièce
-- appartiennent au dossier annoncé.
create policy reglements_groupes_cabinet on public.reglements_groupes
  for all to authenticated
  using (admin_du_dossier(dossier_id))
  with check (
    admin_du_dossier(dossier_id)
    and exists (
      select 1 from public.lignes_bancaires l
       where l.id = reglements_groupes.ligne_bancaire_id
         and l.dossier_id = reglements_groupes.dossier_id
    )
    and (
      piece_id is null
      or exists (
        select 1 from public.pieces p
         where p.id = reglements_groupes.piece_id
           and p.dossier_id = reglements_groupes.dossier_id
      )
    )
  );

-- Le client lit les parts de SES dossiers, comme il lit leurs mouvements : sa simulation date une recette
-- au paiement qui la règle. Il n'en écrit aucune.
create policy reglements_groupes_lecture_client on public.reglements_groupes
  for select to authenticated
  using (exists (
    select 1 from public.memberships m
     where m.dossier_id = reglements_groupes.dossier_id and m.user_id = (select auth.uid())
  ));

create function public.regler_pieces_par_mouvement(
  p_ligne_bancaire_id uuid,
  p_parts jsonb
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
  v_nb_pieces integer;
  v_nom text;
  v_nb integer;
begin
  select * into v_ligne from public.lignes_bancaires where id = p_ligne_bancaire_id for update;
  if not found or not admin_du_dossier(v_ligne.dossier_id) then
    raise exception 'Accès refusé à ce mouvement.' using errcode = '42501';
  end if;
  if v_ligne.piece_id is not null or v_ligne.cotisation_id is not null or v_ligne.categorie_id is not null
     or v_ligne.emprunt_id is not null or v_ligne.ventilee or v_ligne.prelevement_personnel then
    raise exception 'Ce mouvement est rapproché d''une pièce, d''une cotisation ou d''un emprunt, affecté à une catégorie, ventilé ou classé en virement personnel : annule d''abord ce classement.'
      using errcode = '22023';
  end if;
  if v_ligne.montant = 0 then
    raise exception 'Un mouvement de zéro euro ne règle rien.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
    where ligne_bancaire_id = p_ligne_bancaire_id and statut <> 'proposee'
  ) then
    raise exception 'Une écriture de ce mouvement est validée : son règlement ne se remplace plus.' using errcode = '23514';
  end if;

  -- Les parts : au moins deux — une seule serait un rapprochement simple, qui a sa forme à lui —, chacune
  -- une pièce et un montant non nul au centime (la colonne arrondirait en silence), une part par pièce.
  if jsonb_typeof(p_parts) is distinct from 'array' or jsonb_array_length(p_parts) < 2 then
    raise exception 'Un règlement groupé porte au moins deux pièces.' using errcode = '22023';
  end if;
  for v_part in
    select (e->>'piece_id')::uuid as piece_id, (e->>'montant')::numeric as montant
    from jsonb_array_elements(p_parts) as e
  loop
    if v_part.piece_id is null then
      raise exception 'Chaque part désigne une pièce.' using errcode = '22023';
    end if;
    if v_part.montant is null or v_part.montant = 0 or v_part.montant <> round(v_part.montant, 2) then
      raise exception 'Chaque part porte un montant non nul, au centime.' using errcode = '22023';
    end if;
    v_somme := v_somme + v_part.montant;
  end loop;
  select count(*), count(distinct (e->>'piece_id')::uuid)
    into v_nb_parts, v_nb_pieces
  from jsonb_array_elements(p_parts) as e;
  if v_nb_pieces <> v_nb_parts then
    raise exception 'La même pièce figure deux fois : réunis ses parts en une.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_parts) as e
     where not exists (
       select 1 from public.pieces p
        where p.id = (e->>'piece_id')::uuid and p.dossier_id = v_ligne.dossier_id
     )
  ) then
    raise exception 'Cette pièce n''existe pas pour ce dossier.' using errcode = '22023';
  end if;

  -- Une pièce sans montant lu ne se règle pas en partie : rien ne dirait ce qu'il en reste. Et chaque part
  -- va dans le sens qui RÈGLE sa pièce. La première pièce fautive dans l'ordre des parts, comme l'écran.
  select coalesce(nullif(regexp_replace(trim(p.tiers), '\s+', ' ', 'g'), ''), p.nom_fichier) into v_nom
    from jsonb_array_elements(p_parts) with ordinality as e(part, rang)
    join public.pieces p on p.id = (e.part->>'piece_id')::uuid
   where p.montant_ttc is null or p.montant_ttc = 0
   order by e.rang
   limit 1;
  if found then
    raise exception 'La pièce « % » n''a pas de montant lu : saisis-le avant de la régler avec d''autres.', v_nom
      using errcode = '22023';
  end if;
  select coalesce(nullif(regexp_replace(trim(p.tiers), '\s+', ' ', 'g'), ''), p.nom_fichier) into v_nom
    from jsonb_array_elements(p_parts) with ordinality as e(part, rang)
    join public.pieces p on p.id = (e.part->>'piece_id')::uuid
   where sign((e.part->>'montant')::numeric)
         <> case when p.type_piece = 'vente' then sign(p.montant_ttc) else -sign(p.montant_ttc) end
   order by e.rang
   limit 1;
  if found then
    raise exception 'La part de la pièce « % » va dans le mauvais sens : une dépense se règle par une sortie, une recette par une entrée, un avoir à l''inverse.', v_nom
      using errcode = '22023';
  end if;

  -- Les montants dits DANS LE SENS DU MOUVEMENT, comme l'écran les fait saisir : « 800,00 € au lieu des
  -- 900,00 € » d'un paiement, pas « -800,00 € au lieu des -900,00 € ».
  if v_somme <> v_ligne.montant then
    raise exception 'Les parts font % € au lieu des % € du mouvement.',
      replace(to_char(v_somme * sign(v_ligne.montant), 'FM999999999990.00'), '.', ','),
      replace(to_char(abs(v_ligne.montant), 'FM999999999990.00'), '.', ',')
      using errcode = '22023';
  end if;

  update public.lignes_bancaires
     set statut = 'rapprochee', reglement_groupe = true
   where id = p_ligne_bancaire_id;

  delete from public.reglements_groupes where ligne_bancaire_id = p_ligne_bancaire_id;
  insert into public.reglements_groupes (dossier_id, ligne_bancaire_id, piece_id, montant)
  select v_ligne.dossier_id, p_ligne_bancaire_id, (e->>'piece_id')::uuid, (e->>'montant')::numeric
  from jsonb_array_elements(p_parts) as e;
  get diagnostics v_nb = row_count;

  -- Les écritures d'un règlement précédent de ce mouvement : l'application écrit celles des nouvelles parts.
  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id;

  return v_nb;
end;
$$;

comment on function public.regler_pieces_par_mouvement(uuid, jsonb) is
  'Règle plusieurs pièces par un mouvement bancaire : une part par pièce, dont la somme est le mouvement. '
  'Rejouée sur un mouvement déjà réglé ainsi, elle remplace ses parts. Retire les écritures de ce '
  'mouvement ; l''application écrit celles des nouvelles parts.';

create function public.retirer_reglement_groupe(p_ligne_bancaire_id uuid) returns integer
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
  if not v_ligne.reglement_groupe then
    raise exception 'Ce mouvement ne règle pas plusieurs pièces.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
    where ligne_bancaire_id = p_ligne_bancaire_id and statut <> 'proposee'
  ) then
    raise exception 'Une écriture de ce mouvement est validée : son règlement ne se retire plus.' using errcode = '23514';
  end if;

  update public.lignes_bancaires
     set statut = 'non_rapprochee', reglement_groupe = false
   where id = p_ligne_bancaire_id;

  delete from public.reglements_groupes where ligne_bancaire_id = p_ligne_bancaire_id;
  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id;
  get diagnostics v_nb = row_count;
  return v_nb;
end;
$$;

comment on function public.retirer_reglement_groupe(uuid) is
  'Annule le règlement groupé d''un mouvement ET retire ses parts et les écritures de ce mouvement, dans '
  'une transaction.';

revoke execute on function public.regler_pieces_par_mouvement(uuid, jsonb) from public, anon;
grant execute on function public.regler_pieces_par_mouvement(uuid, jsonb) to authenticated;
revoke execute on function public.retirer_reglement_groupe(uuid) from public, anon;
grant execute on function public.retirer_reglement_groupe(uuid) to authenticated;
