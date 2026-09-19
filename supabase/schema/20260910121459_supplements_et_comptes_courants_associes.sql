-- Suppléments facturables (création/fermeture de société, situation intermédiaire...) — une ligne
-- = une prestation ponctuelle à facturer, éventuellement rattachée à la facture réelle une fois émise.
create table public.supplements (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  type text not null check (type = any (array['creation_societe','fermeture_societe','situation_intermediaire','autre'])),
  libelle text not null,
  montant_ht numeric,
  statut text not null default 'a_facturer' check (statut = any (array['a_facturer','facturee'])),
  date_demande date not null default current_date,
  facture_id uuid references public.factures_emises(id) on delete set null,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.supplements enable row level security;
create policy supplements_all on public.supplements for all
  using (admin_du_dossier(dossier_id)) with check (admin_du_dossier(dossier_id));

-- Comptes courants d'associés — un compte par associé et par dossier, suivi par mouvements
-- (apports/retraits/intérêts) plutôt qu'un simple solde stocké : le solde est toujours recalculé
-- côté application (somme des mouvements), jamais une valeur qui pourrait diverger de l'historique.
create table public.comptes_courants_associes (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  nom_associe text not null,
  taux_interet_annuel numeric check (taux_interet_annuel >= 0),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.comptes_courants_associes enable row level security;
create policy cca_all on public.comptes_courants_associes for all
  using (admin_du_dossier(dossier_id)) with check (admin_du_dossier(dossier_id));

create table public.mouvements_cca (
  id uuid primary key default gen_random_uuid(),
  compte_id uuid not null references public.comptes_courants_associes(id) on delete cascade,
  date date not null default current_date,
  type text not null check (type = any (array['apport','retrait','interet'])),
  montant numeric not null check (montant > 0),
  libelle text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.mouvements_cca enable row level security;
create policy mouvements_cca_all on public.mouvements_cca for all
  using (admin_du_dossier((select c.dossier_id from public.comptes_courants_associes c where c.id = mouvements_cca.compte_id)))
  with check (admin_du_dossier((select c.dossier_id from public.comptes_courants_associes c where c.id = mouvements_cca.compte_id)));
