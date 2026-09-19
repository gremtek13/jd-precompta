-- Dernière brique du "dossier bancaire automatisé" (voir CLAUDE.md) — hypothèses de croissance à 3
-- ans, saisies et assumées par le cabinet (jamais devinées par l'app) : une ligne par dossier,
-- éditée en place comme informations_dossier plutôt qu'un historique de versions.
create table public.previsionnels_bancaires (
  dossier_id uuid primary key references public.dossiers(id) on delete cascade,
  annee_reference integer not null,
  ca_reference numeric not null default 0,
  charges_reference numeric not null default 0,
  taux_croissance_ca numeric not null default 0,
  taux_croissance_charges numeric not null default 0,
  note_hypotheses text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.previsionnels_bancaires enable row level security;
create policy previsionnels_bancaires_all on public.previsionnels_bancaires for all
  using (admin_du_dossier(dossier_id)) with check (admin_du_dossier(dossier_id));
