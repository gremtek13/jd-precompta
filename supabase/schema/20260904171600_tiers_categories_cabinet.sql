-- Deuxième palier des règles apprises tiers → catégorie (le premier, par dossier, existe déjà dans
-- tiers_categories) : une couche cabinet, partagée entre tous les dossiers, pour les tiers récurrents
-- d'un client à l'autre (ex. la même mutuelle, la même banque) plutôt que de réapprendre la même
-- correspondance dossier par dossier. Table séparée plutôt que dossier_id nullable sur
-- tiers_categories : évite de toucher à la contrainte unique et aux policies existantes qui marchent
-- déjà, et le sens est différent (categorie_id ici ne peut référencer qu'une catégorie globale,
-- dossier_id null — une catégorie propre à un dossier n'a pas de sens hors de ce dossier).
create table tiers_categories_cabinet (
  id uuid primary key default gen_random_uuid(),
  tiers_normalise text not null unique,
  categorie_id uuid not null references categories(id),
  updated_at timestamptz not null default now()
);

alter table tiers_categories_cabinet enable row level security;

create policy "cabinet admins full access"
  on tiers_categories_cabinet for all
  using (exists (select 1 from cabinet_admins ca where ca.user_id = auth.uid()));
