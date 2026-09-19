
-- Autonomie du cabinet sur sa propre charte graphique (couleur/police/logo, colonnes déjà présentes
-- sur cabinets — voir CabinetBrandingPage) : seule une lecture existait jusqu'ici (cabinets_select),
-- aucune écriture n'était possible depuis l'appli. Même garde que le reste des réglages de cabinet
-- (voir cabinet_admins_update) : chef du cabinet ou super-admin uniquement.
create policy cabinets_update on cabinets
  for update
  using (est_chef_du_cabinet(id))
  with check (est_chef_du_cabinet(id));

-- Bucket dédié au logo de cabinet, public (pas de donnée sensible dedans, contrairement à pieces/packs)
-- : sert une URL stable sans passer par une URL signée à renouveler, y compris pour l'affichage dans
-- Layout à chaque chargement de page.
insert into storage.buckets (id, name, public) values ('cabinet-logos', 'cabinet-logos', true)
on conflict (id) do nothing;

-- Chemin attendu : <cabinet_id>/logo-xxx.<ext> — le premier segment du chemin identifie le cabinet
-- propriétaire, vérifié via la même fonction est_chef_du_cabinet que le reste de ses réglages.
create policy "cabinet_logos_lecture_publique" on storage.objects
  for select
  using (bucket_id = 'cabinet-logos');

create policy "cabinet_logos_ecriture_chef" on storage.objects
  for insert
  with check (bucket_id = 'cabinet-logos' and est_chef_du_cabinet((storage.foldername(name))[1]::uuid));

create policy "cabinet_logos_maj_chef" on storage.objects
  for update
  using (bucket_id = 'cabinet-logos' and est_chef_du_cabinet((storage.foldername(name))[1]::uuid));

create policy "cabinet_logos_suppression_chef" on storage.objects
  for delete
  using (bucket_id = 'cabinet-logos' and est_chef_du_cabinet((storage.foldername(name))[1]::uuid));
