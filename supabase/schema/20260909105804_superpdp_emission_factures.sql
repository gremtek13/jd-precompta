
-- Émission de factures via Super PDP (voir superpdp-emit) : jusqu'ici Super PDP ne servait qu'à la
-- réception (superpdp-sync). superpdp_invoice_id référence désormais aussi bien une facture reçue
-- (pieces.superpdp_invoice_id, existant) qu'une facture émise par ce dossier via Super PDP.
alter table factures_emises
  add column superpdp_invoice_id bigint,
  add column superpdp_dernier_statut text;

comment on column factures_emises.superpdp_invoice_id is
  'Id de la facture côté Super PDP une fois transmise (POST /invoices) — null tant que la facture n''a pas été envoyée par cette voie (impression/PDF manuel reste possible sans jamais passer par Super PDP).';
comment on column factures_emises.superpdp_dernier_statut is
  'Dénormalisation du dernier status_code connu (voir facture_superpdp_events) pour affichage rapide sans jointure — la source de vérité reste la table d''événements.';

-- Historique complet des invoice_events Super PDP pour une facture émise (voir doc "Erreurs" :
-- l'envoi initial (200 OK) ne garantit pas l'acceptation, qui est asynchrone — fr:200 soumise,
-- fr:201 envoyée, fr:205 acceptée, fr:210 refusée...). dossier_id dupliqué depuis factures_emises
-- (plutôt qu'une jointure dans la policy RLS) pour rester cohérent avec le reste du schéma, où les
-- tables filles portent systématiquement leur propre dossier_id (voir facture_lignes... en fait non,
-- facture_lignes n'en a pas — mais ecritures_brouillon, pieces, etc. si) : simplifie la policy et les
-- futures requêtes qui listent "tous les événements d'un dossier" sans jointure.
create table facture_superpdp_events (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references dossiers(id) on delete cascade,
  facture_id uuid not null references factures_emises(id) on delete cascade,
  -- Id de l'événement côté Super PDP (leur séquence bigint strictement croissante, voir doc
  -- Synchronisation) — pas garanti globalement unique tous dossiers confondus (scope par entreprise
  -- chez eux), d'où l'unicité composée avec facture_id plutôt que sur cette seule colonne.
  superpdp_event_id bigint not null,
  status_code text not null,
  status_text text not null,
  occurred_at timestamptz not null,
  detail jsonb,
  created_at timestamptz not null default now(),
  unique (facture_id, superpdp_event_id)
);

create index facture_superpdp_events_facture_id_idx on facture_superpdp_events (facture_id, occurred_at);

alter table facture_superpdp_events enable row level security;

-- Même policy que factures_emises (admin_du_dossier, qui inclut déjà is_super_admin()) : ces
-- événements sont une propriété de la facture, jamais visibles ni modifiables par un client.
create policy facture_superpdp_events_all on facture_superpdp_events
  for all using (admin_du_dossier(dossier_id)) with check (admin_du_dossier(dossier_id));
