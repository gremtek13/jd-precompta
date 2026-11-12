-- RETOUR DE 20261112230000_provisions (INV4, ligne 35) — À COLLER, et seulement sur l'accord du cabinet : il DÉTRUIT la table
-- des provisions, la colonne `operations_inventaire.provision_id`, ses deux contraintes, les deux déclencheurs et les six
-- fonctions de la migration, et retire du catalogue les six rôles des provisions. Ce qu'il rend : la base d'INV2 seule.
-- Il se refuse tant qu'une provision ou une évaluation existe, ou qu'un plan de dossier règle l'un des six rôles : les relever
-- (un SELECT), retirer les évaluations par `retirer_operation_inventaire` (la plus récente d'abord), les provisions par
-- `retirer_provision`, rendre au plan son défaut (`regler_plan_du_dossier`), puis le coller. `INVENTAIRE_PREVU`
-- (src/lib/inventaire.ts) couvre aussi INV2 : le baisser si INV2 part aussi, son retour APRÈS celui-ci.

do $garde$
begin
  if to_regclass('public.provisions') is null then
    raise exception 'retour_provisions : la migration provisions n''est pas en base.';
  end if;
  if exists (select 1 from public.provisions)
     or exists (select 1 from public.operations_inventaire o where o.nature = 'provision' or o.provision_id is not null) then
    raise exception 'retour_provisions : des provisions ou des évaluations existent ; les relever et les retirer d''abord.';
  end if;
  if exists (select 1 from public.plan_comptable_dossier p where p.role in ('provisions_risques', 'depreciation_clients',
               'dotations_provisions_exploitation', 'dotations_depreciations_actif_circulant',
               'reprises_provisions_exploitation', 'reprises_depreciations_actif_circulant')) then
    raise exception 'retour_provisions : un plan de dossier règle un rôle des provisions ; le rendre au défaut d''abord.';
  end if;
end
$garde$;

drop function public.enregistrer_evaluation_provision(uuid, jsonb, jsonb, integer);
drop function public.retirer_provision(uuid, uuid, integer);
drop function public.enregistrer_provision(uuid, jsonb, integer);
drop trigger operations_inventaire_evaluation on public.operations_inventaire;
drop function public.garder_evaluations_de_provision();
drop function public.provision_cible_precedente(uuid, integer);
alter table public.operations_inventaire drop constraint operations_inventaire_une_evaluation_par_exercice;
alter table public.operations_inventaire drop constraint operations_inventaire_evaluation;
alter table public.operations_inventaire drop column provision_id;
drop table public.provisions;
drop function public.garder_provisions();
delete from public.roles_comptables where role in ('provisions_risques', 'depreciation_clients',
  'dotations_provisions_exploitation', 'dotations_depreciations_actif_circulant',
  'reprises_provisions_exploitation', 'reprises_depreciations_actif_circulant');
