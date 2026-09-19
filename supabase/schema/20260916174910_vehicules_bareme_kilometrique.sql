-- Cadre 7 du 2035-B, « Barèmes kilométriques » : une ligne par véhicule et par exercice. Les
-- colonnes reprennent celles du formulaire — sans elles, la case BJ (ligne 23, frais de véhicules)
-- ne peut pas être remplie, alors que le bas du 2035-B dit « Total A à reporter ligne 23 ».
create table if not exists public.vehicules (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  -- L'option pour le forfait se prend au 1er janvier et vaut pour l'année entière (notice, renvoi
  -- 12) : le kilométrage est donc par exercice, et un même véhicule a une ligne par année.
  annee integer not null,
  modele text,
  type text not null default 'voiture' check (type in ('voiture', 'moto', 'cyclomoteur')),
  -- Le cyclomoteur (< 50 cm³) n'a pas de puissance fiscale au sens du barème : 0.
  puissance_fiscale integer not null default 0 check (puissance_fiscale >= 0),
  -- Le formulaire distingue barème BNC et barème BIC (deux colonnes à cocher).
  bareme text not null default 'bnc' check (bareme in ('bnc', 'bic')),
  motorisation text check (motorisation in ('thermique', 'hydrogene', 'hybride', 'electrique')),
  carburant text check (carburant in ('diesel', 'super_sans_plomb', 'gpl')),
  km_professionnel integer not null default 0 check (km_professionnel >= 0),
  -- Véhicule inscrit au registre des immobilisations : ses amortissements doivent être réintégrés
  -- (notice, renvoi 12 — le barème couvre déjà l'amortissement).
  inscrit_immobilisations boolean not null default false,
  amortissements_a_reintegrer numeric(12, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vehicules_dossier_annee_idx on public.vehicules (dossier_id, annee);

alter table public.vehicules enable row level security;

-- Même politique que les autres données comptables d'un dossier (voir immobilisations) : le cabinet
-- propriétaire et les membres d'équipe assignés. Aucun accès client — un véhicule et son kilométrage
-- professionnel relèvent du dossier comptable, pas de l'espace de dépôt.
create policy "vehicules_all" on public.vehicules for all
  using (admin_du_dossier(dossier_id))
  with check (admin_du_dossier(dossier_id));
