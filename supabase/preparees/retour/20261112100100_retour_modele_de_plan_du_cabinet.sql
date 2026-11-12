-- RETOUR de la migration `modele_de_plan_du_cabinet` (PC5, ligne 43 ; supabase/preparees/20261112100000_modele_de_plan_du_cabinet.sql).
-- DESTRUCTIF au sens des règles du dépôt : il retire la table du modèle — LE MODÈLE DE CHAQUE CABINET EST PERDU (ses
-- lignes, leur auteur, leur instant) —, ses quatre fonctions et ses deux déclencheurs. Rien d'autre n'est touché : le plan
-- d'un dossier où un modèle a été appliqué RESTE tel qu'il est, ses lignes gardant l'origine « modele_du_cabinet » (la
-- contrainte de PC1 l'admet sans cette migration) ; `regler_plan_du_dossier` et la garde du plan ne sont pas modifiées par
-- la migration, et ne le sont pas ici. Il SE COLLE, sur l'accord du cabinet, après avoir rebaissé
-- `MODELE_DU_CABINET_PREVU` et déployé l'application : la carte et « Nouveau dossier » cessent d'appeler les fonctions avant
-- qu'elles disparaissent. Avant de le coller, relever le modèle de chaque cabinet si on veut le garder :
--   select cabinet_id, role, compte, libelle, prefixe_auxiliaire, regle_par, regle_le from public.plan_comptable_cabinet;

-- ══ 0. La garde : l'état que pose `modele_de_plan_du_cabinet`, ou rien ══════════════════════════════════════════════════
do $garde$
begin
  if to_regclass('public.plan_comptable_cabinet') is null
     or to_regprocedure('public.regler_modele_du_cabinet(uuid, jsonb)') is null
     or to_regprocedure('public.modele_du_cabinet(uuid)') is null
     or to_regprocedure('public.appliquer_modele_du_cabinet(uuid)') is null
     or to_regprocedure('public.origine_du_modele_applique()') is null
     or not exists (select 1 from pg_trigger t where t.tgname = 'plan_comptable_dossier_origine'
                     and t.tgrelid = 'public.plan_comptable_dossier'::regclass) then
    raise exception 'La migration modele_de_plan_du_cabinet n''est pas en base : ce retour ne s''applique pas.';
  end if;
end
$garde$;

drop trigger plan_comptable_dossier_origine on public.plan_comptable_dossier;
drop function public.origine_du_modele_applique();
drop function public.appliquer_modele_du_cabinet(uuid);
drop function public.modele_du_cabinet(uuid);
drop function public.regler_modele_du_cabinet(uuid, jsonb);
drop table public.plan_comptable_cabinet;
drop function public.garder_plan_comptable_cabinet();
