-- Oubli corrigé : cabinets n'avait pas RLS activée du tout (table totalement ouverte). Lecture
-- ouverte à l'admin du cabinet (super-admin inclus) ET à tout client membre d'un dossier de ce
-- cabinet (nécessaire pour que la charte graphique s'applique aussi à l'espace client). Aucune policy
-- d'écriture : la création/configuration d'un cabinet reste un accès direct (SQL), jamais depuis le
-- navigateur.
alter table public.cabinets enable row level security;
create policy cabinets_select on public.cabinets for select
  using (
    admin_du_cabinet(id)
    or exists (
      select 1 from dossiers d join memberships m on m.dossier_id = d.id
      where d.cabinet_id = cabinets.id and m.user_id = auth.uid()
    )
  );

-- Durcissement (pas une faille avérée : ces fonctions ne renvoient qu'un booléen sur l'appelant
-- lui-même, jamais la donnée d'un tiers) — n'autoriser leur exécution directe qu'aux utilisateurs
-- authentifiés, jamais à un appel anonyme.
revoke execute on function public.is_super_admin() from public, anon;
revoke execute on function public.mon_cabinet_id() from public, anon;
revoke execute on function public.admin_du_dossier(uuid) from public, anon;
revoke execute on function public.admin_du_cabinet(uuid) from public, anon;
revoke execute on function public.set_cabinet_id_dossier() from public, anon, authenticated;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.mon_cabinet_id() to authenticated;
grant execute on function public.admin_du_dossier(uuid) to authenticated;
grant execute on function public.admin_du_cabinet(uuid) to authenticated;
