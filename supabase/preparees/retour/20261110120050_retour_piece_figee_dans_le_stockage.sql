-- LE RETOUR DE `piece_figee_dans_le_stockage` (supabase/schema/20261110125435, INAL1, en production depuis le 10/11/2026 ;
-- le retour reste PRÉPARÉ ; sa version
-- est celle de la migration plus 50, la migration plus 100 étant la version préparée d'INAL2) : il rend à
-- `pieces_storage_delete` son prédicat et son rôle d'hier (`public`), puis retire `fichier_fige` et ses trois index —
-- aucune donnée. C'est un ÉLARGISSEMENT : le fichier d'une pièce figée se supprime de nouveau par l'API, pour qui
-- administre le dossier (CLAUDE.md : une policy élargie demande l'accord explicite du cabinet). Il se COLLE (ses retraits
-- retiennent l'outil), dans une transaction, sur l'accord du cabinet ; le commit qui le colle rend aussi le second passage
-- de src/lib/suppressionDossier.ts inutile, sans le rendre faux (un premier passage qui retire tout laisse le second vide).
-- Ses deux gardes ne lisent que ce qu'il défait — la policy `pieces_storage_delete`, `fichier_fige` et ses trois index
-- (INAL1R-Q1, 15/11/2026) : il s'applique sur la production d'aujourd'hui comme après B2 et SECU3-Q1, dans un ordre ou
-- dans l'autre. Il refuse après INV3 (`validation_de_l_inventaire`), qui remplace `fichier_fige` : le retour d'INV3 d'abord.

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

-- La garde de fin ne lit que ce que ce retour défait, le rangement des pièces (INAL1R-Q1, réponse du cabinet du 15/11/2026) :
-- la policy de suppression du seau des pièces rendue à son prédicat d'hier, mot pour mot (lue sous un chemin vide), à son
-- rôle d'hier (`public`), sans clause WITH CHECK ; `fichier_fige` et ses trois index partis. Les autres policies du stockage
-- ne se lisent pas : d'autres migrations les changent sans que ce retour les touche — la suppression par le chef du seau des
-- ventes (`originaux_retenus_par_leur_import`, A8D2A-Q1, en production depuis le 12/11/2026), les packs et les logos
-- (`stockage_sans_mise_a_jour`, SECU3-Q1, préparée), le seau des documents du cabinet (`documents_et_demandes`, B2,
-- préparée) —, et il s'applique devant chacune, qu'elle soit en base ou non. Jusqu'au 14/11/2026, elle exigeait toute la
-- surface de suppression de storage.objects telle qu'hier : B2 l'aurait fait refuser.
do $fin$
declare
  v_chemin constant text := current_setting('search_path');
begin
  perform set_config('search_path', '', true);
  if not exists (select 1 from pg_policy p where p.polrelid = 'storage.objects'::regclass
                  and p.polname = 'pieces_storage_delete' and p.polcmd = 'd' and p.polpermissive
                  and p.polroles = array[0]::oid[] and p.polwithcheck is null
                  and pg_get_expr(p.polqual, p.polrelid)
                      = '((bucket_id = ''pieces''::text) AND public.admin_du_dossier(((storage.foldername(name))[1])::uuid))')
     or to_regprocedure('public.fichier_fige(text)') is not null
     or to_regclass('public.pieces_storage_path_idx') is not null
     or to_regclass('public.pieces_lisible_path_idx') is not null
     or to_regclass('public.documents_divers_storage_path_idx') is not null then
    raise exception 'Garde de fin : le rangement des pièces n''est pas celui d''hier (la policy pieces_storage_delete, ou fichier_fige et ses trois index).';
  end if;
  perform set_config('search_path', v_chemin, true);
end
$fin$;
