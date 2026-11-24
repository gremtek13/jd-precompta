-- RETOUR DE 20261124120000_contre_passation_des_ecritures_libres (EL7, conception 54) — À COLLER, et seulement sur l'accord du
-- cabinet : il DÉTRUIT la colonne `ecritures_libres.contre_passe_id`, ses deux contraintes et sa clé étrangère, la garde de la
-- colonne et son déclencheur, et la fonction `contre_passer_ecriture_libre`. Ce qu'il rend : la base d'avant la migration (la
-- signature de supabase/essais/signature.sql d'avant, mesurée le 24/11/2026 sur une copie de la réplique portée à 250).
-- Il se refuse tant qu'une contre-passation existe : la relever (un SELECT), la retirer par `retirer_ecriture_libre` (une
-- contre-passation d'un exercice validé ne se retire pas : le retour ne se colle alors plus), puis le coller. Baisser
-- `CONTRE_PASSATION_DES_ECRITURES_LIBRES_PREVUE` (src/lib/contrePassationDesEcrituresLibres.ts) dans le même déploiement.

do $garde$
begin
  if not exists (select 1 from pg_attribute a where a.attrelid = 'public.ecritures_libres'::regclass
                   and a.attname = 'contre_passe_id' and not a.attisdropped) then
    raise exception 'retour_contre_passation_des_ecritures_libres : la migration contre_passation_des_ecritures_libres n''est pas en base.';
  end if;
  if exists (select 1 from public.ecritures_libres e where e.contre_passe_id is not null) then
    raise exception 'retour_contre_passation_des_ecritures_libres : des contre-passations existent ; les relever et les retirer d''abord.';
  end if;
end
$garde$;

drop function public.contre_passer_ecriture_libre(uuid, integer, jsonb, jsonb);
drop trigger ecritures_libres_garde_de_la_contre_passation on public.ecritures_libres;
drop function public.garder_contre_passation_des_ecritures_libres();
alter table public.ecritures_libres drop constraint ecritures_libres_contre_passation_sans_extourne;
alter table public.ecritures_libres drop constraint ecritures_libres_une_contre_passation;
alter table public.ecritures_libres drop constraint ecritures_libres_contre_passe_id_fkey;
alter table public.ecritures_libres drop column contre_passe_id;
