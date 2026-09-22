create table public.exercices_clotures (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  annee integer not null,
  cloture_le timestamptz not null default now(),
  unique (dossier_id, annee)
);

comment on table public.exercices_clotures is
  'Geste explicite de clôture d''un exercice par le cabinet. Décision du 22/09/2026 : ce geste '
  'déclenche la purge du texte OCR des pièces sensibles (justificatifs de recette, type_piece = '
  'vente) de cet exercice, voir RGPD.md §8.3. Ne prétend pas être une clôture comptable réelle.';

alter table public.exercices_clotures enable row level security;

create policy "exercices_clotures_cabinet" on public.exercices_clotures
  for all
  to authenticated
  using (admin_du_dossier(dossier_id))
  with check (admin_du_dossier(dossier_id));
