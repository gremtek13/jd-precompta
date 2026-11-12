-- RETOUR DE 20261112233000_affectation_du_resultat (AFF2, lignes 33 et 45) — À COLLER, et seulement sur l'accord du
-- cabinet : il DÉTRUIT les deux tables de l'affectation du résultat (les décisions et leur répartition), la colonne
-- `ecritures_brouillon.affectation_id`, leurs contraintes, leurs déclencheurs et leurs huit fonctions, et retire du
-- catalogue les six rôles de l'affectation. Ce qu'il rend : la base d'avant la migration.
-- Il se refuse tant qu'une décision existe (même remplacée ou retirée : l'historique se garde) ou qu'un plan de dossier
-- règle l'un des six rôles : les relever (un SELECT) et décider avec le cabinet, puis le coller. Baisser
-- `AFFECTATION_PREVUE` (src/lib/affectationDuResultat.ts) dans le même déploiement. Après AFF3, son retour d'abord.

do $garde$
begin
  if to_regclass('public.affectations_du_resultat') is null then
    raise exception 'retour_affectation_du_resultat : la migration affectation_du_resultat n''est pas en base.';
  end if;
  if exists (select 1 from public.affectations_du_resultat) or exists (select 1 from public.lignes_d_affectation)
     or exists (select 1 from public.ecritures_brouillon e where e.affectation_id is not null) then
    raise exception 'retour_affectation_du_resultat : des décisions d''affectation existent ; les relever et décider avec le cabinet d''abord.';
  end if;
  if exists (select 1 from public.plan_comptable_dossier p where p.role in ('reserve_legale', 'reserves_statutaires', 'autres_reserves',
               'report_a_nouveau_crediteur', 'report_a_nouveau_debiteur', 'dividendes_a_payer')) then
    raise exception 'retour_affectation_du_resultat : un plan de dossier règle un rôle de l''affectation ; le rendre au défaut d''abord.';
  end if;
end
$garde$;

drop function public.joindre_document_affectation(uuid, text, text);
drop function public.retirer_affectation(uuid, uuid, integer);
drop function public.enregistrer_affectation(uuid, integer, integer, jsonb, jsonb, jsonb);
drop trigger ecritures_brouillon_affectation on public.ecritures_brouillon;
drop function public.garder_ecriture_d_affectation();
drop function public.affectation_soldes(uuid, date, uuid);
drop function public.affectation_en_euros(bigint);
drop function public.affectation_entier(jsonb);
-- Les contraintes de ses paires avec les sources sœurs (MCB5g, INV2, LIA2), si l'une d'elles est en base, quel que soit
-- l'ordre des collages : la colonne retirée les emporterait, le retour les nomme.
alter table public.ecritures_brouillon drop constraint if exists ecritures_brouillon_affectation_hors_de_l_ouverture;
alter table public.ecritures_brouillon drop constraint if exists ecritures_brouillon_inventaire_hors_de_l_affectation;
alter table public.ecritures_brouillon drop constraint if exists ecritures_brouillon_stock_hors_de_l_affectation;
alter table public.ecritures_brouillon drop constraint ecritures_brouillon_affectation_sans_autre_source;
drop index public.ecritures_brouillon_affectation;
alter table public.ecritures_brouillon drop column affectation_id;
drop table public.lignes_d_affectation;
drop table public.affectations_du_resultat;
drop function public.garder_lignes_d_affectation();
drop function public.garder_affectations_du_resultat();
delete from public.roles_comptables where role in ('reserve_legale', 'reserves_statutaires', 'autres_reserves',
  'report_a_nouveau_crediteur', 'report_a_nouveau_debiteur', 'dividendes_a_payer');
