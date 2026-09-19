-- Cross-check TVA comptable vs déclarée — jusqu'ici la TVA collectée/déductible n'avait rien à
-- comparer : aucune référence externe (le montant réellement déclaré à l'administration sur la CA3)
-- n'était enregistrée dans l'appli. Même logique que references_annuelles (EstimationTab) : une
-- valeur de référence saisie une fois par le cabinet après dépôt de la déclaration réelle, jamais
-- calculée toute seule, comparée ensuite au total du brouillon sur la même période.
create table declarations_tva (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references dossiers(id) on delete cascade,
  periode_debut date not null,
  periode_fin date not null,
  tva_declaree numeric not null,
  date_declaration date,
  notes text,
  created_at timestamptz not null default now(),
  unique (dossier_id, periode_debut, periode_fin)
);

alter table declarations_tva enable row level security;

create policy "cabinet admins full access"
  on declarations_tva for all
  using (exists (select 1 from cabinet_admins ca where ca.user_id = auth.uid()));
