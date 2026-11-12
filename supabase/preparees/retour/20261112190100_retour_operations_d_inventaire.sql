-- RETOUR DE 20261112190000_operations_d_inventaire (INV2, ligne 35) — À COLLER, et seulement sur l'accord du cabinet : il
-- DÉTRUIT la table des régularisations d'inventaire, la colonne `ecritures_brouillon.operation_inventaire_id`, leurs
-- contraintes, leurs déclencheurs et leurs quatre fonctions, et retire du catalogue les six rôles des régularisations. Ce
-- qu'il rend : la base d'avant la migration.
-- Il se refuse tant qu'une régularisation existe ou qu'un plan de dossier règle l'un des six rôles : les relever (un SELECT),
-- les retirer par `retirer_operation_inventaire` et rendre au plan son défaut (`regler_plan_du_dossier`), puis le coller.
-- Baisser `INVENTAIRE_PREVU` (src/lib/inventaire.ts) dans le même déploiement. Après INV3 ou INV4, leurs retours d'abord.

do $garde$
begin
  if to_regclass('public.operations_inventaire') is null then
    raise exception 'retour_operations_d_inventaire : la migration operations_d_inventaire n''est pas en base.';
  end if;
  if exists (select 1 from public.operations_inventaire)
     or exists (select 1 from public.ecritures_brouillon e where e.operation_inventaire_id is not null) then
    raise exception 'retour_operations_d_inventaire : des régularisations d''inventaire existent ; les relever et les retirer d''abord.';
  end if;
  if exists (select 1 from public.plan_comptable_dossier p where p.role in ('charges_constatees_avance', 'produits_constates_avance',
               'factures_non_parvenues', 'factures_a_etablir', 'tva_factures_non_parvenues', 'tva_factures_a_etablir')) then
    raise exception 'retour_operations_d_inventaire : un plan de dossier règle un rôle des régularisations ; le rendre au défaut d''abord.';
  end if;
end
$garde$;

drop function public.retirer_operation_inventaire(uuid, integer);
drop function public.enregistrer_operation_inventaire(uuid, jsonb, jsonb, integer);
drop trigger ecritures_brouillon_inventaire on public.ecritures_brouillon;
drop function public.garder_ecriture_d_inventaire();
-- Les contraintes de ses paires avec les sources sœurs (MCB5g, LIA2), si l'une d'elles est en base, quel que soit l'ordre
-- des collages : la colonne retirée les emporterait, le retour les nomme.
alter table public.ecritures_brouillon drop constraint if exists ecritures_brouillon_inventaire_hors_de_l_ouverture;
alter table public.ecritures_brouillon drop constraint if exists ecritures_brouillon_inventaire_hors_des_stocks;
alter table public.ecritures_brouillon drop constraint if exists ecritures_brouillon_inventaire_hors_de_l_affectation;
alter table public.ecritures_brouillon drop constraint ecritures_brouillon_inventaire_sans_autre_source;
drop index public.ecritures_brouillon_operation_inventaire;
alter table public.ecritures_brouillon drop column operation_inventaire_id;
drop table public.operations_inventaire;
drop function public.garder_operations_inventaire();
drop function public.inventaire_rogne(text);
drop function public.inventaire_entier(jsonb);
delete from public.roles_comptables where role in ('charges_constatees_avance', 'produits_constates_avance',
  'factures_non_parvenues', 'factures_a_etablir', 'tva_factures_non_parvenues', 'tva_factures_a_etablir');
