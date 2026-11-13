-- RETOUR de la migration `texte_ocr_coherent_a_la_mise_a_jour` (SECU3-Q2 ;
-- supabase/preparees/20261113194000_texte_ocr_coherent_a_la_mise_a_jour.sql). Il rend à `piece_textes_ocr_update` son
-- WITH CHECK d'hier (le seul dossier administré) et son rôle d'hier (PUBLIC, sans clause TO) ; son USING ne change pas.
-- C'est un ÉLARGISSEMENT : la réécriture d'un texte lu ne relit plus sa pièce ni son document (CLAUDE.md : une policy
-- élargie demande l'accord explicite du cabinet). Par l'outil : une policy se modifie en place, rien n'est retiré. Aucune
-- donnée n'est touchée.

-- La garde de tête : la policy que la migration a posée, lue sous un chemin vide.
do $garde$
declare
  v_chemin constant text := current_setting('search_path');
begin
  perform set_config('search_path', '', true);
  if not exists (select 1 from pg_policy p where p.polrelid = 'public.piece_textes_ocr'::regclass and p.polname = 'piece_textes_ocr_update'
                   and p.polcmd = 'w' and p.polpermissive and p.polroles = array['authenticated'::regrole]::oid[]
                   and pg_get_expr(p.polqual, p.polrelid) = 'public.admin_du_dossier(dossier_id)'
                   and md5(pg_get_expr(p.polwithcheck, p.polrelid)) = 'd4d7802737f23b534604caaace7ed6c2') then
    raise exception 'Retour de SECU3-Q2 : la policy piece_textes_ocr_update n''est pas celle que la migration a posée : rien n''est rendu.';
  end if;
  perform set_config('search_path', v_chemin, true);
end
$garde$;

alter policy piece_textes_ocr_update on public.piece_textes_ocr
  to public
  with check (public.admin_du_dossier(dossier_id));

-- La garde de fin : la policy d'hier, mot pour mot.
do $fin$
declare
  v_chemin constant text := current_setting('search_path');
begin
  perform set_config('search_path', '', true);
  if not exists (select 1 from pg_policy p where p.polrelid = 'public.piece_textes_ocr'::regclass and p.polname = 'piece_textes_ocr_update'
                   and p.polcmd = 'w' and p.polpermissive and p.polroles = array[0]::oid[]
                   and pg_get_expr(p.polqual, p.polrelid) = 'public.admin_du_dossier(dossier_id)'
                   and pg_get_expr(p.polwithcheck, p.polrelid) = 'public.admin_du_dossier(dossier_id)') then
    raise exception 'Garde de fin du retour : la policy piece_textes_ocr_update n''est pas revenue à son texte d''hier.';
  end if;
  perform set_config('search_path', v_chemin, true);
end
$fin$;
