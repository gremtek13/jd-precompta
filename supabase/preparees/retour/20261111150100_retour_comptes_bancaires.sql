-- RETOUR ARRIÈRE de la migration `comptes_bancaires` (ligne 26.6, MCB1) — DESTRUCTIF : il retire la table
-- `comptes_bancaires` (le libellé, le compte 512, la date et la période de chaque compte d'un dossier) et la colonne
-- `compte_bancaire_id` de `lignes_bancaires` et de `controles_releves_bancaires` (le compte de chaque mouvement et de
-- chaque relevé). Il demande l'accord explicite du cabinet, et se colle dans l'éditeur SQL de Supabase, dans une
-- transaction. Il se refuse si un dossier tient plus d'un compte : ses mouvements se mêleraient de nouveau sous un seul
-- compte, ce que la migration a été écrite pour empêcher ; les comptes en trop se retirent d'abord, avec leurs mouvements.
-- Rien d'autre ne change : les mouvements, les relevés et le plan restent tels quels.
do $garde$
begin
  if to_regclass('public.comptes_bancaires') is null then
    raise exception 'La migration comptes_bancaires n''est pas en base : rien à retirer.';
  end if;
  if exists (select 1 from public.comptes_bancaires c where not c.principal) then
    raise exception 'Un dossier tient plus d''un compte bancaire : le retour mêlerait leurs mouvements. Retirer d''abord les comptes en trop.';
  end if;
end
$garde$;

drop function public.compte_de_banque_du_mouvement(uuid);
drop trigger plan_comptable_dossier_hors_des_comptes_bancaires on public.plan_comptable_dossier;
drop function public.garder_plan_hors_des_comptes_bancaires();
drop trigger lignes_bancaires_compte_bancaire on public.lignes_bancaires;
drop trigger controles_releves_bancaires_compte_bancaire on public.controles_releves_bancaires;
drop function public.poser_compte_bancaire();
drop index public.lignes_bancaires_compte_bancaire_id_idx;
drop index public.controles_releves_bancaires_compte_bancaire_id_idx;
alter table public.lignes_bancaires drop constraint lignes_bancaires_compte_bancaire, drop column compte_bancaire_id;
alter table public.controles_releves_bancaires
  drop constraint controles_releves_bancaires_compte_bancaire, drop column compte_bancaire_id;
drop table public.comptes_bancaires;
drop function public.garder_compte_principal_present();
drop function public.garder_comptes_bancaires();
