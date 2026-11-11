-- RETOUR DE `originaux_retenus_par_leur_import` (A8D2A-Q1, ligne 51.5) — À COLLER dans l'éditeur SQL de Supabase, dans une
-- transaction, avec sa ligne d'historique, sur l'accord du cabinet : il retire des objets (le déclencheur, trois fonctions,
-- la table des originaux libérés, deux index). Il rend aux deux policies du seau `ventes` leur texte d'A8d2a — l'original
-- d'une facture reprise se supprime de nouveau sous son import, au chef du cabinet — et ne touche à rien d'autre.
--
-- IL SE REFUSE tant qu'un original libéré est encore dans le seau : retirer la libération le laisserait là, sans plus
-- personne pour le retirer par l'API (la policy d'A8d2a cherche le cabinet dans la ligne du dossier, partie). Retirer
-- d'abord ces fichiers, depuis l'application (la suppression du dossier les reprend) ou le tableau de bord.

do $garde$
begin
  if to_regprocedure('public.original_d_un_import(text)') is null or to_regprocedure('public.original_libere(text)') is null
     or to_regprocedure('public.liberer_les_originaux_du_dossier()') is null or to_regclass('public.originaux_liberes') is null then
    raise exception 'La migration originaux_retenus_par_leur_import n''est pas en base, ou pas entière : rien à retirer, relire la base.';
  end if;
  if exists (select 1 from public.originaux_liberes o
              where exists (select 1 from storage.objects s where s.bucket_id = 'ventes' and s.name = o.chemin)) then
    raise exception 'Un original libéré par la suppression de son dossier est encore dans le seau des ventes : le retirer d''abord, puis rejouer ce retour.';
  end if;
end
$garde$;

alter policy ventes_lecture on storage.objects
  using (
    bucket_id = 'ventes'
    and case
      when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/imports/' then public.admin_du_dossier((storage.foldername(name))[1]::uuid)
      when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' then public.gere_les_ventes((storage.foldername(name))[1]::uuid)
      else false
    end
  );

alter policy ventes_suppression_par_le_chef on storage.objects
  using (
    bucket_id = 'ventes'
    and case
      when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' then
        exists (select 1 from public.dossiers d where d.id = (storage.foldername(name))[1]::uuid and public.est_chef_du_cabinet(d.cabinet_id))
      else false
    end
  );

drop trigger dossiers_liberer_les_originaux on public.dossiers;
drop function public.liberer_les_originaux_du_dossier();
drop function public.original_libere(text);
drop function public.original_d_un_import(text);
drop table public.originaux_liberes;
drop index public.imports_factures_fichier_chemin_idx;
drop index public.factures_importees_fichier_chemin_idx;

do $fin$
declare
  v_chemin constant text := current_setting('search_path');
begin
  perform set_config('search_path', '', true);
  if (select string_agg(p.polname || ':' || p.polcmd::text || ':' || p.polroles::regrole[]::text || ':'
                        || md5(coalesce(pg_get_expr(p.polqual, p.polrelid), '')) || ':'
                        || md5(coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')), ',' order by p.polname collate "C")
        from pg_policy p where p.polrelid = 'storage.objects'::regclass and left(p.polname, 7) = 'ventes_' and p.polpermissive)
     is distinct from 'ventes_depot_d_un_logo:a:{authenticated}:d41d8cd98f00b204e9800998ecf8427e:350f5807eb36593cbe508baf6176333a,ventes_depot_d_un_original:a:{authenticated}:d41d8cd98f00b204e9800998ecf8427e:571ca4536531eba8020daafcea00b255,ventes_lecture:r:{authenticated}:821b3505fd9b2a7f2367ec0898c83645:d41d8cd98f00b204e9800998ecf8427e,ventes_suppression_par_le_chef:d:{authenticated}:f4be98cf500b3037eba40f0f8e3ea94c:d41d8cd98f00b204e9800998ecf8427e' then
    raise exception 'Garde de fin du retour : les policies du seau des ventes ne sont pas revenues à leur texte d''A8d2a.';
  end if;
  perform set_config('search_path', v_chemin, true);
end
$fin$;
