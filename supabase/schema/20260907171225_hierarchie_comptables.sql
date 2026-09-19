-- Un étage de plus à l'intérieur d'un cabinet : "comptable en chef" (accès à tous les dossiers du
-- cabinet, comme aujourd'hui — rôle par défaut, donc rien ne change pour un cabinet à une seule
-- personne) vs "comptable" (accès seulement aux dossiers qui lui sont explicitement assignés). Reste
-- invisible tant qu'un cabinet n'a qu'un chef : aucun écran n'apparaît avant qu'un vrai second compte
-- "comptable" existe dans ce cabinet.

alter table public.cabinet_admins add column role text not null default 'comptable_en_chef'
  check (role in ('comptable_en_chef', 'comptable'));

create table public.dossier_assignations (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (dossier_id, user_id)
);
alter table public.dossier_assignations enable row level security;

-- Chef du cabinet propriétaire de ce dossier, ou super-admin — sert à réserver certaines actions
-- (créer/supprimer un dossier, gérer les assignations) aux chefs plutôt qu'à n'importe quel comptable.
create or replace function public.est_chef_du_cabinet(p_cabinet_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_super_admin() or exists (
    select 1 from cabinet_admins ca where ca.user_id = auth.uid() and ca.cabinet_id = p_cabinet_id and ca.role = 'comptable_en_chef'
  )
$$;

-- Seul le chef (ou super-admin) gère qui est assigné à quel dossier — un comptable ne doit pas
-- pouvoir s'auto-assigner un dossier qui ne lui a pas été confié.
create policy dossier_assignations_all on public.dossier_assignations for all
  using (est_chef_du_cabinet((select d.cabinet_id from dossiers d where d.id = dossier_assignations.dossier_id)))
  with check (est_chef_du_cabinet((select d.cabinet_id from dossiers d where d.id = dossier_assignations.dossier_id)));

-- Remplace la version précédente : un chef voit tout son cabinet comme avant ; un simple comptable
-- doit désormais être explicitement assigné au dossier. Toutes les autres tables (pieces, écritures,
-- banque, etc.) appellent déjà cette même fonction — elles héritent de la nouvelle règle sans qu'il y
-- ait quoi que ce soit d'autre à changer.
create or replace function public.admin_du_dossier(p_dossier_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select
    public.is_super_admin()
    or exists (
      select 1
      from cabinet_admins ca
      join dossiers d on d.id = p_dossier_id and d.cabinet_id = ca.cabinet_id
      where ca.user_id = auth.uid()
        and (
          ca.role = 'comptable_en_chef'
          or exists (select 1 from dossier_assignations da where da.dossier_id = p_dossier_id and da.user_id = auth.uid())
        )
    )
$$;
grant execute on function public.est_chef_du_cabinet(uuid) to anon, public;

-- dossiers : la liste devient elle aussi assignation-aware (un comptable ne doit voir, dans la liste,
-- que les dossiers qui lui sont confiés) ; créer/supprimer un dossier reste une décision de chef, pas
-- du travail courant — modifier les infos d'un dossier déjà confié reste permis à un comptable assigné.
drop policy dossiers_select on public.dossiers;
create policy dossiers_select on public.dossiers for select
  using (admin_du_dossier(id) or exists (select 1 from memberships m where m.dossier_id = dossiers.id and m.user_id = auth.uid()));
drop policy dossiers_write on public.dossiers;
create policy dossiers_write on public.dossiers for insert with check (est_chef_du_cabinet(cabinet_id));
drop policy dossiers_delete on public.dossiers;
create policy dossiers_delete on public.dossiers for delete using (est_chef_du_cabinet(cabinet_id));
drop policy dossiers_update on public.dossiers;
create policy dossiers_update on public.dossiers for update using (admin_du_dossier(id)) with check (admin_du_dossier(id));
