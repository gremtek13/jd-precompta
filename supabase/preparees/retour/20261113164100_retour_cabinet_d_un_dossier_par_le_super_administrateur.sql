-- RETOUR DE cabinet_d_un_dossier_par_le_super_administrateur (20261113164000) : le déclencheur et sa garde retirés ; les
-- policies, les autres gardes (celle du dossier du cabinet, LM1, comprise) et les données restent telles quelles. Après
-- lui, le cabinet d'un dossier n'est plus jugé que par la policy `dossiers_update` (qui écrit le dossier) et, pour le
-- dossier du cabinet, par sa garde à lui. DESTRUCTIF (des `drop`) : il se colle dans l'éditeur SQL de Supabase, dans une
-- transaction, avec sa ligne d'historique. Il ne retire que ce que la migration a posé : la garde de tête vérifie que le
-- déclencheur et la fonction sont bien les siens.

do $garde$
begin
  if to_regprocedure('public.garder_cabinet_d_un_dossier()') is null then
    raise exception 'retour_cabinet_d_un_dossier_par_le_super_administrateur : la garde n''est pas en base ; rien à retirer.';
  end if;
  if (select p.prosecdef from pg_catalog.pg_proc p where p.oid = 'public.garder_cabinet_d_un_dossier()'::regprocedure) then
    raise exception 'retour_cabinet_d_un_dossier_par_le_super_administrateur : la fonction en base n''est pas la garde de la migration (security definer).';
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = 'public.dossiers'::regclass
                  and t.tgname = 'dossiers_cabinet_par_le_super_administrateur'
                  and t.tgfoid = 'public.garder_cabinet_d_un_dossier()'::regprocedure)
     or exists (select 1 from pg_catalog.pg_trigger t where t.tgfoid = 'public.garder_cabinet_d_un_dossier()'::regprocedure
                 and (t.tgrelid <> 'public.dossiers'::regclass or t.tgname <> 'dossiers_cabinet_par_le_super_administrateur')) then
    raise exception 'retour_cabinet_d_un_dossier_par_le_super_administrateur : le déclencheur de la migration manque, ou un autre appelle sa garde : relire avant de retirer.';
  end if;
end
$garde$;

drop trigger dossiers_cabinet_par_le_super_administrateur on public.dossiers;
drop function public.garder_cabinet_d_un_dossier();
