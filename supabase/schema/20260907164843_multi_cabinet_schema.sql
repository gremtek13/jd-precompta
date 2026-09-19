-- Multi-cabinet (comptes master) — fondation. Jusqu'ici l'appli suppose un seul cabinet au monde
-- (cabinet_admins donne un accès global, sans distinction). Ici on introduit une vraie notion de
-- cabinet : chaque dossier et chaque admin appartient à un cabinet précis, et un cabinet ne doit
-- jamais voir les données d'un autre — sauf le(s) super-admin(s) (JD Consult), qui supervisent tout.

create table public.cabinets (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  -- Charte graphique appliquée à ce cabinet et à tous ses comptes client (jamais à la page de
  -- connexion, générique tant que l'utilisateur n'est pas identifié). Configurée manuellement par le
  -- super-admin à la création du cabinet (voir discussion) — pas de formulaire dans l'appli.
  couleur_primaire text,
  couleur_primaire_claire text,
  police_google_font text,
  logo_storage_path text,
  created_at timestamptz not null default now()
);

-- Verrouillée comme superpdp_credentials : RLS activée sans aucune policy, invisible/inécrivable
-- depuis le navigateur quel que soit le rôle — seul un accès direct (service role / SQL) y touche.
create table public.super_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.super_admins enable row level security;

-- Cabinet JD Consult : le tien, celui qui existait avant l'introduction du multi-cabinet. Id fixe
-- pour le référencer dans le reste de cette migration.
insert into public.cabinets (id, nom) values ('286a85c6-4f31-4a24-ad74-03ae302f1f3a', 'JD Consult');

alter table public.cabinet_admins add column cabinet_id uuid references public.cabinets(id);
alter table public.dossiers add column cabinet_id uuid references public.cabinets(id);
-- Jusqu'ici globale à toute l'installation (une seule ligne par tiers_normalise) — devient propre à
-- chaque cabinet : la correspondance tiers→catégorie apprise par un cabinet n'a aucune raison de
-- s'appliquer (ni d'être visible) chez un autre.
alter table public.tiers_categories_cabinet add column cabinet_id uuid references public.cabinets(id);
alter table public.tiers_categories_cabinet drop constraint tiers_categories_cabinet_tiers_normalise_key;

update public.cabinet_admins set cabinet_id = '286a85c6-4f31-4a24-ad74-03ae302f1f3a';
update public.dossiers set cabinet_id = '286a85c6-4f31-4a24-ad74-03ae302f1f3a';
update public.tiers_categories_cabinet set cabinet_id = '286a85c6-4f31-4a24-ad74-03ae302f1f3a';

alter table public.cabinet_admins alter column cabinet_id set not null;
alter table public.dossiers alter column cabinet_id set not null;
alter table public.tiers_categories_cabinet alter column cabinet_id set not null;
alter table public.tiers_categories_cabinet add constraint tiers_categories_cabinet_unique unique (cabinet_id, tiers_normalise);

-- Seul admin existant à ce jour (toi) : devient super-admin en plus d'admin de son propre cabinet.
insert into public.super_admins (user_id) select user_id from public.cabinet_admins;

-- ---- Fonctions utilitaires (security definer : lisent cabinet_admins/super_admins indépendamment
-- ---- des policies de ces tables, qui restent verrouillées côté navigateur) ----------------------

create or replace function public.is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from super_admins sa where sa.user_id = auth.uid())
$$;

create or replace function public.mon_cabinet_id() returns uuid
language sql stable security definer set search_path = public as $$
  select cabinet_id from cabinet_admins where user_id = auth.uid()
$$;

-- Admin du cabinet propriétaire de ce dossier, ou super-admin.
create or replace function public.admin_du_dossier(p_dossier_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_super_admin() or exists (
    select 1 from dossiers d where d.id = p_dossier_id and d.cabinet_id = public.mon_cabinet_id()
  )
$$;

-- Admin de ce cabinet précisément, ou super-admin.
create or replace function public.admin_du_cabinet(p_cabinet_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_super_admin() or p_cabinet_id = public.mon_cabinet_id()
$$;

-- Remplit automatiquement cabinet_id à la création d'un dossier depuis l'appli (le formulaire ne le
-- fournit pas) — avec le cabinet de l'appelant. Un super-admin créant un dossier pour un autre
-- cabinet passe par un accès direct (SQL), pas par ce trigger.
create or replace function public.set_cabinet_id_dossier() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.cabinet_id is null then
    new.cabinet_id := public.mon_cabinet_id();
  end if;
  return new;
end;
$$;

create trigger dossiers_set_cabinet_id
before insert on public.dossiers
for each row execute function public.set_cabinet_id_dossier();
