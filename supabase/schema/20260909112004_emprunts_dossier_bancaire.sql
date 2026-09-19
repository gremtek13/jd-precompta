
-- Onglet "Financement" (voir DossierParcours) : première brique du "dossier bancaire automatisé" —
-- l'échéancier des emprunts, qui ne se déduit pas des écritures existantes (elles ne connaissent que
-- les mouvements passés, pas les conditions d'un prêt : taux, durée, capital initial). Les ratios
-- bancaires et l'échéancier consolidé se calculent ensuite côté client (voir lib/emprunts.ts),
-- l'échéancier détaillé n'étant jamais stocké ligne à ligne (recalculé à la demande).
create table emprunts (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references dossiers(id) on delete cascade,
  nom text not null,
  organisme_preteur text,
  capital_initial numeric not null check (capital_initial > 0),
  -- Taux annuel en pourcentage (ex: 3.5 pour 3,5 %), pas une fraction — cohérent avec taux_tva sur
  -- facture_lignes, déjà exprimé de la même façon ailleurs dans ce schéma.
  taux_annuel numeric not null check (taux_annuel >= 0),
  date_debut date not null,
  duree_mois integer not null check (duree_mois > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index emprunts_dossier_id_idx on emprunts (dossier_id);

alter table emprunts enable row level security;

create policy emprunts_all on emprunts
  for all using (admin_du_dossier(dossier_id)) with check (admin_du_dossier(dossier_id));
