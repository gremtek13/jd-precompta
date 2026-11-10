-- LE RETOUR DE `piece_figee_dans_le_stockage` (supabase/preparees/20261110120000, INAL1 ; PRÉPARÉ, comme elle ; sa version
-- est celle de la migration plus 50, la migration plus 100 étant la version préparée d'INAL2) : il rend à
-- `pieces_storage_delete` son prédicat et son rôle d'hier (`public`), puis retire `fichier_fige` et ses trois index —
-- aucune donnée. C'est un ÉLARGISSEMENT : le fichier d'une pièce figée se supprime de nouveau par l'API, pour qui
-- administre le dossier (CLAUDE.md : une policy élargie demande l'accord explicite du cabinet). Il se COLLE (ses retraits
-- retiennent l'outil), dans une transaction, sur l'accord du cabinet ; le commit qui le colle rend aussi le second passage
-- de src/lib/suppressionDossier.ts inutile, sans le rendre faux (un premier passage qui retire tout laisse le second vide).

do $garde$
declare
  v_chemin constant text := current_setting('search_path');
begin
  -- La policy est celle que la migration a posée, mot pour mot (lue sous un chemin vide).
  perform set_config('search_path', '', true);
  if not exists (select 1 from pg_policy p where p.polrelid = 'storage.objects'::regclass
                  and p.polname = 'pieces_storage_delete' and p.polcmd = 'd' and p.polpermissive
                  and p.polroles = array['authenticated'::regrole]::oid[] and p.polwithcheck is null
                  and pg_get_expr(p.polqual, p.polrelid)
                      = '((bucket_id = ''pieces''::text) AND public.admin_du_dossier(((storage.foldername(name))[1])::uuid) AND (NOT public.fichier_fige(name)))') then
    raise exception 'La policy pieces_storage_delete n''est pas celle que la migration a posée : rien à défaire sans la relire.';
  end if;
  perform set_config('search_path', v_chemin, true);
  -- La fonction et ses index sont ceux que la migration a posés.
  if md5((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.fichier_fige(text)')))
       is distinct from '5372f8d248432f0932598a6efca24ca2'
     or (select string_agg(pg_get_indexdef(i.indexrelid), ' ; ' order by pg_get_indexdef(i.indexrelid) collate "C")
           from pg_index i where i.indexrelid in (to_regclass('public.pieces_storage_path_idx'), to_regclass('public.pieces_lisible_path_idx'),
                                                  to_regclass('public.documents_divers_storage_path_idx')))
        is distinct from 'CREATE INDEX documents_divers_storage_path_idx ON public.documents_divers USING btree (storage_path) ; CREATE INDEX pieces_lisible_path_idx ON public.pieces USING btree (lisible_path) WHERE (lisible_path IS NOT NULL) ; CREATE INDEX pieces_storage_path_idx ON public.pieces USING btree (storage_path)' then
    raise exception 'La fonction fichier_fige ou ses index ne sont pas ceux que la migration a posés : rien à défaire sans les relire.';
  end if;
end
$garde$;

alter policy pieces_storage_delete on storage.objects
  to public
  using (bucket_id = 'pieces' and admin_du_dossier(((storage.foldername(name))[1])::uuid));
drop function public.fichier_fige(text);
drop index public.pieces_storage_path_idx;
drop index public.pieces_lisible_path_idx;
drop index public.documents_divers_storage_path_idx;

-- La garde de fin : la surface de suppression de storage.objects est celle d'hier, à l'empreinte de chaque prédicat.
do $fin$
declare
  v_chemin constant text := current_setting('search_path');
begin
  perform set_config('search_path', '', true);
  if (select string_agg(p.polname || ':' || p.polcmd::text || ':' || md5(coalesce(pg_get_expr(p.polqual, p.polrelid), '')),
                        ',' order by p.polname collate "C")
        from pg_policy p where p.polrelid = 'storage.objects'::regclass and p.polcmd in ('d', '*') and p.polpermissive)
     is distinct from 'cabinet_logos_suppression_chef:d:fc46cee26a76edcb9a6f03a0d3cd7b1e,packs_storage_all:*:a8ac8b3ed86beb70e800f88abb083b3b,pieces_storage_delete:d:b5d0298fe469d6ccb5b73a7520156ec3,ventes_suppression_par_le_chef:d:f4be98cf500b3037eba40f0f8e3ea94c'
     or not exists (select 1 from pg_policy p where p.polrelid = 'storage.objects'::regclass
                     and p.polname = 'pieces_storage_delete' and p.polroles = array[0]::oid[]) then
    raise exception 'Garde de fin : les policies de suppression de storage.objects ne sont pas celles d''hier.';
  end if;
  perform set_config('search_path', v_chemin, true);
end
$fin$;
