insert into storage.buckets (id, name, public) values ('pieces', 'pieces', false);

-- Convention de chemin attendue : pieces/{dossier_id}/{fichier}
-- Le cabinet a accès à tout ; un client a accès uniquement au dossier auquel il est rattaché

create policy pieces_storage_select on storage.objects for select using (
  bucket_id = 'pieces' and (
    is_cabinet_admin()
    or exists(
      select 1 from memberships m
      where m.dossier_id::text = (storage.foldername(name))[1]
      and m.user_id = auth.uid()
    )
  )
);

create policy pieces_storage_insert on storage.objects for insert with check (
  bucket_id = 'pieces' and (
    is_cabinet_admin()
    or exists(
      select 1 from memberships m
      where m.dossier_id::text = (storage.foldername(name))[1]
      and m.user_id = auth.uid()
    )
  )
);

create policy pieces_storage_delete on storage.objects for delete using (
  bucket_id = 'pieces' and is_cabinet_admin()
);
