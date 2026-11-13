-- RETOUR de la migration `stockage_sans_mise_a_jour` (SECU3-Q1 ; supabase/preparees/20261113193000_stockage_sans_mise_a_jour.sql).
-- Il rend à storage.objects ses deux policies d'hier — `packs_storage_all` (pour tout, sans clause TO) et
-- `cabinet_logos_maj_chef` (mise à jour, sans clause TO), à leurs prédicats d'hier — et retire les trois policies des
-- packs que la migration a posées. C'est un ÉLARGISSEMENT : la mise à jour d'un pack et d'un logo se rouvre (CLAUDE.md :
-- une policy élargie demande l'accord explicite du cabinet). Il se COLLE dans l'éditeur SQL, dans une transaction, avec sa
-- ligne d'historique (il retire des policies, que l'outil retiendrait). Aucune donnée n'est touchée. Le retour préparé
-- d'INAL1 accepte les deux états.

-- La garde de tête : l'état que la migration a posé, lu sous un chemin vide.
do $garde$
declare
  v_chemin constant text := current_setting('search_path');
  v_packs constant text := '((bucket_id = ''packs''::text) AND public.admin_du_dossier(((storage.foldername(name))[1])::uuid))';
begin
  perform set_config('search_path', '', true);
  if exists (select 1 from pg_policy p where p.polrelid = 'storage.objects'::regclass and p.polpermissive and p.polcmd in ('w', '*')) then
    raise exception 'Retour de SECU3-Q1 : une policy permissive ouvre déjà la mise à jour d''un objet : rien n''est rendu sans la relire.';
  end if;
  if (select string_agg(p.polname || ':' || p.polcmd::text || ':' || p.polroles::regrole[]::text || ':'
                        || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || ':' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'),
                        ' ; ' order by p.polname collate "C")
        from pg_policy p where p.polrelid = 'storage.objects'::regclass and left(p.polname, 6) = 'packs_')
     is distinct from 'packs_storage_depot:a:{authenticated}:-:' || v_packs
                   || ' ; packs_storage_lecture:r:{authenticated}:' || v_packs || ':-'
                   || ' ; packs_storage_suppression:d:{authenticated}:' || v_packs || ':-' then
    raise exception 'Retour de SECU3-Q1 : les policies des packs ne sont pas celles que la migration a posées : rien n''est rendu.';
  end if;
  perform set_config('search_path', v_chemin, true);
end
$garde$;

create policy packs_storage_all on storage.objects
  for all
  using (bucket_id = 'packs' and public.admin_du_dossier(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'packs' and public.admin_du_dossier(((storage.foldername(name))[1])::uuid));

create policy "cabinet_logos_maj_chef" on storage.objects
  for update
  using (bucket_id = 'cabinet-logos' and public.est_chef_du_cabinet((storage.foldername(name))[1]::uuid));

drop policy packs_storage_lecture on storage.objects;
drop policy packs_storage_depot on storage.objects;
drop policy packs_storage_suppression on storage.objects;

-- La garde de fin : les policies des packs et des logos sont celles d'hier, mot pour mot.
do $fin$
declare
  v_chemin constant text := current_setting('search_path');
  v_packs constant text := '((bucket_id = ''packs''::text) AND public.admin_du_dossier(((storage.foldername(name))[1])::uuid))';
  v_logos constant text := '((bucket_id = ''cabinet-logos''::text) AND public.est_chef_du_cabinet(((storage.foldername(name))[1])::uuid))';
begin
  perform set_config('search_path', '', true);
  if (select string_agg(p.polname || ':' || p.polcmd::text || ':' || p.polpermissive::text || ':' || p.polroles::regrole[]::text || ':'
                        || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || ':' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'),
                        ' ; ' order by p.polname collate "C")
        from pg_policy p where p.polrelid = 'storage.objects'::regclass
         and (left(p.polname, 6) = 'packs_' or left(p.polname, 14) = 'cabinet_logos_'))
     is distinct from 'cabinet_logos_ecriture_chef:a:true:{-}:-:' || v_logos
                   || ' ; cabinet_logos_lecture_publique:r:true:{-}:(bucket_id = ''cabinet-logos''::text):-'
                   || ' ; cabinet_logos_maj_chef:w:true:{-}:' || v_logos || ':-'
                   || ' ; cabinet_logos_suppression_chef:d:true:{-}:' || v_logos || ':-'
                   || ' ; packs_storage_all:*:true:{-}:' || v_packs || ':' || v_packs then
    raise exception 'Garde de fin du retour : les policies des packs et des logos ne sont pas revenues à leur texte d''hier.';
  end if;
  perform set_config('search_path', v_chemin, true);
end
$fin$;
