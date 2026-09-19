-- Correctif audit sécurité (fichiers clients, Haute) : les policies pieces_storage_delete et
-- packs_storage_all vérifiaient seulement "l'appelant est admin d'UN cabinet quelconque", jamais
-- que ce cabinet est bien le propriétaire du dossier concerné par le fichier — n'importe quel
-- comptable de n'importe quel cabinet pouvait donc lire/écraser/supprimer les pièces et packs de
-- tous les autres cabinets. pieces_storage_insert/_select avaient le même défaut sur leur branche
-- cabinet_admins (la branche memberships, elle, vérifiait déjà correctement le dossier).
--
-- Les buckets pieces/packs rangent toujours leurs fichiers sous `${dossierId}/...` (voir
-- src/lib/depot.ts, importFichiers.ts, packGenerator.ts) — remplace donc la vérification "admin d'un
-- cabinet" par admin_du_dossier((storage.foldername(name))[1]::uuid), qui vérifie le bon dossier ET
-- inclut déjà le super-admin et la distinction chef/comptable assigné (même fonction que partout
-- ailleurs dans l'appli, voir cabinet_logos_* juste au-dessus dans le même schéma, qui suit déjà ce
-- bon réflexe pour son propre bucket).

drop policy if exists packs_storage_all on storage.objects;
create policy packs_storage_all on storage.objects
  for all
  using (bucket_id = 'packs' and admin_du_dossier(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'packs' and admin_du_dossier(((storage.foldername(name))[1])::uuid));

drop policy if exists pieces_storage_delete on storage.objects;
create policy pieces_storage_delete on storage.objects
  for delete
  using (bucket_id = 'pieces' and admin_du_dossier(((storage.foldername(name))[1])::uuid));

drop policy if exists pieces_storage_insert on storage.objects;
create policy pieces_storage_insert on storage.objects
  for insert
  with check (
    bucket_id = 'pieces' and (
      admin_du_dossier(((storage.foldername(name))[1])::uuid)
      or exists (
        select 1 from memberships m
        where (m.dossier_id)::text = (storage.foldername(objects.name))[1]
          and m.user_id = auth.uid()
      )
    )
  );

drop policy if exists pieces_storage_select on storage.objects;
create policy pieces_storage_select on storage.objects
  for select
  using (
    bucket_id = 'pieces' and (
      admin_du_dossier(((storage.foldername(name))[1])::uuid)
      or exists (
        select 1 from memberships m
        where (m.dossier_id)::text = (storage.foldername(objects.name))[1]
          and m.user_id = auth.uid()
      )
    )
  );
