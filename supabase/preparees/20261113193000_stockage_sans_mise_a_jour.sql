-- SECU3-Q1 — AUCUN SEAU N'OUVRE LA MISE À JOUR D'UN OBJET DU STOCKAGE (relecture de sécurité du 13/11/2026, point 1 ;
-- PRÉPARÉE le 13/11/2026, PAS APPLIQUÉE ; la question SECU3-Q1 est posée au cabinet, pas encore tranchée). À COLLER dans
-- l'éditeur SQL de Supabase, dans une transaction, avec sa ligne d'historique : elle retire deux policies (« drop
-- policy »), que l'outil retiendrait. Le récit : HISTORIQUE.md, « 13/11/2026 — SECU3-Q1 ET SECU3-Q2 : LE STOCKAGE SANS
-- MISE À JOUR, LE TEXTE LU RELU À SA RÉÉCRITURE (PRÉPARÉES, PAS APPLIQUÉES) » ; le retour :
-- supabase/preparees/retour/20261113193100_retour_stockage_sans_mise_a_jour.sql ; l'essai : le bloc SM de
-- supabase/essais/rls.sql ; le garde de source : src/lib/stockageSansMiseAJour.test.ts.
--
-- SOURCES. PostgreSQL 17, « CREATE POLICY » (une policy FOR ALL vaut pour SELECT, INSERT, UPDATE et DELETE ; sans policy
-- permissive pour une commande, la RLS la refuse : rien n'est ouvert par défaut ; une policy sans clause TO vise PUBLIC)
-- et « DROP POLICY ». Supabase, « Storage Access Control » (supabase.com/docs/guides/storage/security/access-control) :
-- le dépôt d'un fichier neuf demande INSERT ; le téléchargement, la liste et l'adresse signée, SELECT ; le retrait,
-- DELETE et SELECT ; la mise à jour d'un fichier, son déplacement et le dépôt qui écrase (`upsert`), UPDATE.
--
-- LA RÈGLE. Aucun seau n'ouvre la mise à jour d'un objet : un fichier déposé ne se réécrit, ne s'écrase ni ne se déplace.
-- L'application dépose un fichier neuf et retire l'ancien (le logo du cabinet, CabinetBrandingPage ; un pack,
-- packGenerator) ; relevé le 13/11/2026 dans src/ et les Edge Functions : aucun `update`, `move` ni `copy` du stockage,
-- aucun dépôt `upsert: true` sur ces deux seaux (le seul du dépôt, superpdp-sync, vise `pieces` sous la clé secrète, hors
-- de la RLS). Les seaux `pieces` et `ventes` n'ont jamais eu de policy de mise à jour ; `packs` la tenait de sa policy
-- « pour tout », `cabinet-logos` de `cabinet_logos_maj_chef`.
--
-- L'ÉTAT DE DÉPART. Relu le 13/11/2026 sur la réplique (l'export rejoué, 218 migrations, égal à la production) : sur
-- storage.objects, deux policies permissives ouvrent la mise à jour, `packs_storage_all` (« pour tout », sans clause TO)
-- et `cabinet_logos_maj_chef` (mise à jour, sans clause TO). La garde de tête les exige mot pour mot, et seules : une
-- autre policy de mise à jour l'arrête, et le cabinet décide.
--
-- CE QU'ELLE FAIT. Le seau des packs reçoit trois policies, lecture, dépôt et suppression, chacune `to authenticated`
-- (un prédicat qui ne peut être vrai sans session ne vise pas l'anonyme), au prédicat de `packs_storage_all` mot pour mot
-- — la garde de fin le compare au rendu du catalogue ; `packs_storage_all` et `cabinet_logos_maj_chef` partent.
--
-- CE QU'ELLE NE CHANGE PAS. Qui lit, dépose et retire un pack ou un logo : les mêmes prédicats, pour les mêmes comptes
-- (sans session, `admin_du_dossier` est faux ; le rôle `authenticated` n'ôte donc rien). Les trois policies des logos
-- qui restent (la lecture publique, le dépôt et le retrait par le chef du cabinet) et leurs prédicats ; les seaux, leurs
-- bornes, aucun fichier, aucune donnée, aucune table de public : ni le socle ni l'inventaire ne lisent le stockage. Le
-- retour rend les deux policies d'hier ; le retour préparé d'INAL1 (piece_figee_dans_le_stockage) accepte les deux états.

-- La garde de tête : l'état d'hier, mot pour mot, lu sous un chemin vide (qui nomme le schéma de chaque fonction).
do $garde$
declare
  v_chemin constant text := current_setting('search_path');
  v_packs constant text := '((bucket_id = ''packs''::text) AND public.admin_du_dossier(((storage.foldername(name))[1])::uuid))';
  v_logos constant text := '((bucket_id = ''cabinet-logos''::text) AND public.est_chef_du_cabinet(((storage.foldername(name))[1])::uuid))';
  v_ouvertes text;
begin
  perform set_config('search_path', '', true);
  if not exists (select 1 from pg_policy p where p.polrelid = 'storage.objects'::regclass and p.polname = 'packs_storage_all'
                   and p.polcmd = '*' and p.polpermissive and p.polroles = array[0]::oid[]
                   and pg_get_expr(p.polqual, p.polrelid) = v_packs and pg_get_expr(p.polwithcheck, p.polrelid) = v_packs) then
    raise exception 'SECU3-Q1 : la policy packs_storage_all n''est pas celle d''hier (pour tout, sans clause TO, au prédicat des packs) : rien n''est changé sans la relire.';
  end if;
  if not exists (select 1 from pg_policy p where p.polrelid = 'storage.objects'::regclass and p.polname = 'cabinet_logos_maj_chef'
                   and p.polcmd = 'w' and p.polpermissive and p.polroles = array[0]::oid[]
                   and pg_get_expr(p.polqual, p.polrelid) = v_logos and p.polwithcheck is null) then
    raise exception 'SECU3-Q1 : la policy cabinet_logos_maj_chef n''est pas celle d''hier (mise à jour, sans clause TO, au prédicat du chef du cabinet) : rien n''est changé sans la relire.';
  end if;
  select string_agg(p.polname, ',' order by p.polname collate "C") into v_ouvertes
    from pg_policy p where p.polrelid = 'storage.objects'::regclass and p.polpermissive and p.polcmd in ('w', '*');
  if v_ouvertes is distinct from 'cabinet_logos_maj_chef,packs_storage_all' then
    raise exception 'SECU3-Q1 : les policies permissives de mise à jour de storage.objects sont « % », non les deux d''hier : le cabinet décide d''abord.', v_ouvertes;
  end if;
  if exists (select 1 from pg_policy p where p.polrelid = 'storage.objects'::regclass
               and p.polname in ('packs_storage_lecture', 'packs_storage_depot', 'packs_storage_suppression')) then
    raise exception 'SECU3-Q1 : une policy des packs que la migration pose existe déjà : elle n''a rien à faire ici.';
  end if;
  perform set_config('search_path', v_chemin, true);
end
$garde$;

create policy packs_storage_lecture on storage.objects
  for select to authenticated
  using (bucket_id = 'packs' and public.admin_du_dossier(((storage.foldername(name))[1])::uuid));

create policy packs_storage_depot on storage.objects
  for insert to authenticated
  with check (bucket_id = 'packs' and public.admin_du_dossier(((storage.foldername(name))[1])::uuid));

create policy packs_storage_suppression on storage.objects
  for delete to authenticated
  using (bucket_id = 'packs' and public.admin_du_dossier(((storage.foldername(name))[1])::uuid));

drop policy packs_storage_all on storage.objects;
drop policy cabinet_logos_maj_chef on storage.objects;

-- La garde de fin : aucune policy permissive n'ouvre plus la mise à jour d'un objet ; les packs, trois policies au
-- prédicat d'hier, à authenticated seul ; les logos, leurs trois policies restantes inchangées.
do $fin$
declare
  v_chemin constant text := current_setting('search_path');
  v_packs constant text := '((bucket_id = ''packs''::text) AND public.admin_du_dossier(((storage.foldername(name))[1])::uuid))';
  v_logos constant text := '((bucket_id = ''cabinet-logos''::text) AND public.est_chef_du_cabinet(((storage.foldername(name))[1])::uuid))';
begin
  perform set_config('search_path', '', true);
  if exists (select 1 from pg_policy p where p.polrelid = 'storage.objects'::regclass and p.polpermissive and p.polcmd in ('w', '*')) then
    raise exception 'Garde de fin : une policy permissive ouvre encore la mise à jour d''un objet du stockage.';
  end if;
  if (select string_agg(p.polname || ':' || p.polcmd::text || ':' || p.polroles::regrole[]::text || ':'
                        || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || ':' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'),
                        ' ; ' order by p.polname collate "C")
        from pg_policy p where p.polrelid = 'storage.objects'::regclass and p.polpermissive
         and (left(p.polname, 6) = 'packs_' or left(p.polname, 14) = 'cabinet_logos_'))
     is distinct from 'cabinet_logos_ecriture_chef:a:{-}:-:' || v_logos
                   || ' ; cabinet_logos_lecture_publique:r:{-}:(bucket_id = ''cabinet-logos''::text):-'
                   || ' ; cabinet_logos_suppression_chef:d:{-}:' || v_logos || ':-'
                   || ' ; packs_storage_depot:a:{authenticated}:-:' || v_packs
                   || ' ; packs_storage_lecture:r:{authenticated}:' || v_packs || ':-'
                   || ' ; packs_storage_suppression:d:{authenticated}:' || v_packs || ':-' then
    raise exception 'Garde de fin : les policies des packs et des logos ne sont pas celles que la migration pose.';
  end if;
  perform set_config('search_path', v_chemin, true);
end
$fin$;
