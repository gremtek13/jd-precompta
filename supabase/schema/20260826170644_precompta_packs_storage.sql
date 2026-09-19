insert into storage.buckets (id, name, public) values ('packs', 'packs', false);

create policy packs_storage_all on storage.objects for all using (
  bucket_id = 'packs' and exists(select 1 from cabinet_admins ca where ca.user_id = auth.uid())
) with check (
  bucket_id = 'packs' and exists(select 1 from cabinet_admins ca where ca.user_id = auth.uid())
);
