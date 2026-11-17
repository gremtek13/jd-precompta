-- RETOUR DE 20261117120000_ecritures_libres (EL2, conception 54) — À COLLER, et seulement sur l'accord du cabinet : il DÉTRUIT
-- la table des écritures libres, la colonne `ecritures_brouillon.ecriture_libre_id`, leurs contraintes, leurs déclencheurs et
-- leurs six fonctions. Ce qu'il rend : la base d'avant la migration.
-- Il se refuse tant qu'une écriture libre existe : les relever (un SELECT), les retirer par `retirer_ecriture_libre` (une
-- écriture d'un exercice validé ne se retire pas : le retour ne se colle alors plus), puis le coller. Baisser
-- `ECRITURES_LIBRES_PREVUES` (src/lib/ecritureLibre.ts) dans le même déploiement.

do $garde$
begin
  if to_regclass('public.ecritures_libres') is null then
    raise exception 'retour_ecritures_libres : la migration ecritures_libres n''est pas en base.';
  end if;
  if exists (select 1 from public.ecritures_libres)
     or exists (select 1 from public.ecritures_brouillon e where e.ecriture_libre_id is not null) then
    raise exception 'retour_ecritures_libres : des écritures libres existent ; les relever et les retirer d''abord.';
  end if;
end
$garde$;

drop function public.retirer_ecriture_libre(uuid, integer);
drop function public.enregistrer_ecriture_libre(uuid, jsonb, jsonb, integer);
drop trigger ecritures_brouillon_libre on public.ecritures_brouillon;
drop function public.garder_ecriture_libre_du_brouillon();
-- Les contraintes de ses paires avec les sources sœurs (MCB5g, INV2, LIA2, AFF2), si l'une d'elles est en base, quel que soit
-- l'ordre des collages : la colonne retirée les emporterait, le retour les nomme.
alter table public.ecritures_brouillon drop constraint if exists ecritures_brouillon_libre_hors_de_l_ouverture;
alter table public.ecritures_brouillon drop constraint if exists ecritures_brouillon_libre_hors_de_l_inventaire;
alter table public.ecritures_brouillon drop constraint if exists ecritures_brouillon_libre_hors_des_stocks;
alter table public.ecritures_brouillon drop constraint if exists ecritures_brouillon_libre_hors_de_l_affectation;
alter table public.ecritures_brouillon drop constraint ecritures_brouillon_libre_sans_autre_source;
drop index public.ecritures_brouillon_ecriture_libre;
alter table public.ecritures_brouillon drop column ecriture_libre_id;
drop table public.ecritures_libres;
drop function public.garder_ecritures_libres();
drop function public.ecriture_libre_rogne(text);
drop function public.ecriture_libre_entier(jsonb);
