-- Retire les policies qui référencent is_cabinet_admin()
drop policy dossiers_select on dossiers;
drop policy dossiers_write on dossiers;
drop policy dossiers_update on dossiers;
drop policy dossiers_delete on dossiers;
drop policy memberships_select on memberships;
drop policy memberships_write on memberships;
drop policy memberships_delete on memberships;
drop policy categories_select on categories;
drop policy categories_write on categories;
drop policy categories_update on categories;
drop policy categories_delete on categories;
drop policy pieces_select on pieces;
drop policy pieces_insert on pieces;
drop policy pieces_update on pieces;
drop policy pieces_delete on pieces;
drop policy packs_all on packs;
drop policy pack_pieces_all on pack_pieces;
drop policy pieces_storage_select on storage.objects;
drop policy pieces_storage_insert on storage.objects;
drop policy pieces_storage_delete on storage.objects;

drop function is_cabinet_admin();

-- Recréées avec la vérification admin inline (plus de fonction exposée en RPC)
create policy dossiers_select on dossiers for select using (
  exists(select 1 from cabinet_admins ca where ca.user_id = auth.uid())
  or exists(select 1 from memberships m where m.dossier_id = dossiers.id and m.user_id = auth.uid())
);
create policy dossiers_write on dossiers for insert with check (
  exists(select 1 from cabinet_admins ca where ca.user_id = auth.uid())
);
create policy dossiers_update on dossiers for update using (
  exists(select 1 from cabinet_admins ca where ca.user_id = auth.uid())
);
create policy dossiers_delete on dossiers for delete using (
  exists(select 1 from cabinet_admins ca where ca.user_id = auth.uid())
);

create policy memberships_select on memberships for select using (
  exists(select 1 from cabinet_admins ca where ca.user_id = auth.uid()) or user_id = auth.uid()
);
create policy memberships_write on memberships for insert with check (
  exists(select 1 from cabinet_admins ca where ca.user_id = auth.uid())
);
create policy memberships_delete on memberships for delete using (
  exists(select 1 from cabinet_admins ca where ca.user_id = auth.uid())
);

create policy categories_select on categories for select using (
  dossier_id is null
  or exists(select 1 from cabinet_admins ca where ca.user_id = auth.uid())
  or exists(select 1 from memberships m where m.dossier_id = categories.dossier_id and m.user_id = auth.uid())
);
create policy categories_write on categories for insert with check (
  exists(select 1 from cabinet_admins ca where ca.user_id = auth.uid())
);
create policy categories_update on categories for update using (
  exists(select 1 from cabinet_admins ca where ca.user_id = auth.uid())
);
create policy categories_delete on categories for delete using (
  exists(select 1 from cabinet_admins ca where ca.user_id = auth.uid())
);

create policy pieces_select on pieces for select using (
  exists(select 1 from cabinet_admins ca where ca.user_id = auth.uid())
  or exists(select 1 from memberships m where m.dossier_id = pieces.dossier_id and m.user_id = auth.uid())
);
create policy pieces_insert on pieces for insert with check (
  exists(select 1 from cabinet_admins ca where ca.user_id = auth.uid())
  or exists(select 1 from memberships m where m.dossier_id = pieces.dossier_id and m.user_id = auth.uid())
);
create policy pieces_update on pieces for update using (
  exists(select 1 from cabinet_admins ca where ca.user_id = auth.uid())
);
create policy pieces_delete on pieces for delete using (
  exists(select 1 from cabinet_admins ca where ca.user_id = auth.uid())
);

create policy packs_all on packs for all using (
  exists(select 1 from cabinet_admins ca where ca.user_id = auth.uid())
) with check (
  exists(select 1 from cabinet_admins ca where ca.user_id = auth.uid())
);
create policy pack_pieces_all on pack_pieces for all using (
  exists(select 1 from cabinet_admins ca where ca.user_id = auth.uid())
) with check (
  exists(select 1 from cabinet_admins ca where ca.user_id = auth.uid())
);

create policy pieces_storage_select on storage.objects for select using (
  bucket_id = 'pieces' and (
    exists(select 1 from cabinet_admins ca where ca.user_id = auth.uid())
    or exists(
      select 1 from memberships m
      where m.dossier_id::text = (storage.foldername(name))[1]
      and m.user_id = auth.uid()
    )
  )
);
create policy pieces_storage_insert on storage.objects for insert with check (
  bucket_id = 'pieces' and (
    exists(select 1 from cabinet_admins ca where ca.user_id = auth.uid())
    or exists(
      select 1 from memberships m
      where m.dossier_id::text = (storage.foldername(name))[1]
      and m.user_id = auth.uid()
    )
  )
);
create policy pieces_storage_delete on storage.objects for delete using (
  bucket_id = 'pieces' and exists(select 1 from cabinet_admins ca where ca.user_id = auth.uid())
);
