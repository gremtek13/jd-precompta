-- Identifiants Super PDP (OAuth2 client_credentials) par dossier — une application Super PDP est
-- rattachée à une seule entreprise/SIRET, donc un dossier = un jeu d'identifiants, jamais partagé.
-- Verrouillée dès la création : RLS activée sans aucune policy, donc invisible même au cabinet depuis
-- le navigateur (ni lecture ni écriture) — seules les Edge Functions superpdp-credentials/superpdp-sync
-- y accèdent, via la clé de service qui contourne RLS. Le cabinet ne voit/consulte que le statut
-- (configuré ou non, jamais le secret) à travers superpdp-credentials.
create table public.superpdp_credentials (
  dossier_id uuid primary key references public.dossiers(id) on delete cascade,
  client_id text not null,
  client_secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.superpdp_credentials enable row level security;

-- Repère de doublon pour la synchronisation Super PDP (voir superpdp-sync) : id de facture côté
-- Super PDP, pour ne jamais réimporter deux fois la même facture reçue.
alter table public.pieces add column superpdp_invoice_id bigint;
create unique index pieces_superpdp_invoice_id_dossier_idx on public.pieces (dossier_id, superpdp_invoice_id) where superpdp_invoice_id is not null;

alter table public.pieces drop constraint pieces_source_check;
alter table public.pieces add constraint pieces_source_check check (source = any (array['upload', 'email', 'superpdp']));
