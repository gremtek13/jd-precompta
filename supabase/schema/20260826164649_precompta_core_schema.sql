create extension if not exists pgcrypto;

create table cabinet_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table dossiers (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  siret text,
  contact_nom text,
  contact_email text,
  notes text,
  archive boolean not null default false,
  created_at timestamptz not null default now()
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  dossier_id uuid not null references dossiers(id) on delete cascade,
  role text not null check (role in ('client')),
  created_at timestamptz not null default now(),
  unique (user_id, dossier_id)
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid references dossiers(id) on delete cascade,
  code text not null,
  libelle text not null,
  ordre int not null default 0,
  unique (dossier_id, code)
);

create table pieces (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references dossiers(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id),
  source text not null default 'upload' check (source in ('upload','email')),
  storage_path text not null,
  nom_fichier text not null,
  date_piece date,
  tiers text,
  montant_ht numeric(12,2),
  montant_tva numeric(12,2),
  montant_ttc numeric(12,2),
  categorie_id uuid references categories(id),
  type_piece text not null default 'achat' check (type_piece in ('achat','vente','note_frais','autre')),
  statut text not null default 'a_valider' check (statut in ('a_valider','validee')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table packs (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references dossiers(id) on delete cascade,
  periode_debut date not null,
  periode_fin date not null,
  generated_at timestamptz not null default now(),
  generated_by uuid not null references auth.users(id),
  storage_path_zip text not null,
  storage_path_excel text not null,
  nb_pieces int not null,
  total_ttc numeric(12,2)
);

create table pack_pieces (
  pack_id uuid not null references packs(id) on delete cascade,
  piece_id uuid not null references pieces(id),
  snapshot jsonb not null,
  primary key (pack_id, piece_id)
);

create index pieces_dossier_id_idx on pieces(dossier_id);
create index pieces_statut_idx on pieces(statut);
create index packs_dossier_id_idx on packs(dossier_id);
create index memberships_user_id_idx on memberships(user_id);
create index memberships_dossier_id_idx on memberships(dossier_id);

create or replace function is_cabinet_admin() returns boolean as $$
  select exists(select 1 from cabinet_admins where user_id = auth.uid());
$$ language sql stable security definer set search_path = public;
