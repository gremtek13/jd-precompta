
-- Envoi d'e-mails aux clients depuis l'app (voir supabase/functions/send-email) : facture par email,
-- relance pour obtenir des pièces. tiers_email est réutilisé d'un envoi à l'autre (pré-rempli), pas
-- une donnée obligatoire à la création d'une facture — beaucoup de factures ne seront jamais
-- envoyées par ce biais (impression manuelle toujours possible).
alter table factures_emises add column tiers_email text;

-- Journal des envois — un cabinet doit toujours pouvoir retrouver qui a reçu quoi et quand, jamais un
-- envoi "silencieux" qu'on ne peut plus vérifier après coup. facture_id en "set null" (pas cascade) :
-- l'historique d'envoi reste même si la facture elle-même est un jour supprimée (cas rare, brouillon
-- uniquement — une facture validée n'est jamais supprimable, voir FacturesTab).
create table emails_envoyes (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references dossiers(id) on delete cascade,
  type text not null check (type in ('facture', 'relance_pieces')),
  destinataire text not null,
  objet text not null,
  facture_id uuid references factures_emises(id) on delete set null,
  resend_id text,
  envoye_par uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index emails_envoyes_dossier_id_idx on emails_envoyes (dossier_id, created_at);

alter table emails_envoyes enable row level security;

create policy emails_envoyes_all on emails_envoyes
  for all using (admin_du_dossier(dossier_id)) with check (admin_du_dossier(dossier_id));
