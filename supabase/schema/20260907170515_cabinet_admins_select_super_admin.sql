-- Le super-admin doit pouvoir compter les admins de chaque cabinet (voir la page Comptes master) —
-- jusqu'ici la policy ne permettait à un admin de ne voir que sa propre ligne, y compris pour un
-- super-admin, qui ne verrait donc jamais les admins des autres cabinets.
drop policy cabinet_admins_select_self on public.cabinet_admins;
create policy cabinet_admins_select on public.cabinet_admins for select
  using (user_id = auth.uid() or is_super_admin());
