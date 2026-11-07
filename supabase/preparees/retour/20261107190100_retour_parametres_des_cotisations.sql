-- Le retour de la migration `parametres_des_cotisations` (20261107190000, ligne 27, TNS-Q1 et TNS-Q4). Il DÉTRUIT les deux
-- tables (le début d'activité des dossiers, l'ACRE et le taux dentiste des exercices), la garde du gel et la fonction
-- d'écriture : il refuse tant qu'une valeur y vit (la perdre changerait l'estimation des cotisations d'un exercice), et se
-- colle dans l'éditeur SQL (le mot `drop` le fait coller) — sur l'accord explicite du cabinet seulement. Avant lui : baisser
-- `PARAMETRES_DES_COTISATIONS_EXPORTES` (src/lib/parametresDesCotisations.ts) et le publier, sans quoi l'écran et la
-- sauvegarde liraient des tables absentes ; après lui, rejouer les trois contrôles de l'export et retirer le fichier de la
-- migration de supabase/schema/.

do $garde$
begin
  if to_regclass('public.parametres_des_cotisations') is null or to_regclass('public.debuts_d_activite') is null then
    raise exception 'La migration parametres_des_cotisations n''est pas en base : rien à défaire.';
  end if;
  if exists (select 1 from public.debuts_d_activite d where d.date_debut is not null)
     or exists (select 1 from public.parametres_des_cotisations p where p.acre is not null or p.taux_dentiste is not null) then
    raise exception 'Un paramètre des cotisations porte une valeur : le retour le détruirait. Rien n''est défait.';
  end if;
end
$garde$;

drop function public.enregistrer_parametres_des_cotisations(uuid, integer, jsonb, jsonb);
drop table public.parametres_des_cotisations;
drop table public.debuts_d_activite;
drop function public.garder_parametres_des_cotisations_valides();
