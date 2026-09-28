create table public.volet_social_pamc (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  annee integer not null check (annee >= 2025),
  profession text check (profession in ('auxiliaire_medical', 'sage_femme', 'medecin_secteur_1', 'medecin_secteur_2', 'chirurgien_dentiste')),
  remplacant boolean not null default false,
  recettes_brutes numeric(14,2) check (recettes_brutes >= 0),
  honoraires_conventionnes numeric(14,2) check (honoraires_conventionnes >= 0),
  depassements numeric(14,2) check (depassements >= 0),
  recettes_structures numeric(14,2) check (recettes_structures >= 0),
  constraint volet_social_pamc_un_par_exercice unique (dossier_id, annee)
);

comment on table public.volet_social_pamc is
  'Chiffres du volet social d''un praticien ou auxiliaire médical conventionné (déclaration de '
  'revenus, rubriques DSCS, DSAV, DSAW et DSAT), une ligne par exercice à partir des revenus 2025 '
  '(ligne 27 de la feuille de route, décision du cabinet du 28/09/2026). Recettes brutes nulles : '
  'l''application reprend la ligne 4 de la 2035-A. Sert aussi à estimer les cotisations Urssaf.';

alter table public.volet_social_pamc enable row level security;

create policy "volet_social_pamc_cabinet" on public.volet_social_pamc
  for all
  to authenticated
  using (admin_du_dossier(dossier_id))
  with check (admin_du_dossier(dossier_id));
