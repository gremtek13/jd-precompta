-- Le retour de la migration `saisies_2035` (20261107180000, étapes 2035S3 à S5). Il DÉTRUIT la table des saisies du
-- cabinet, sa garde et sa fonction d'écriture : il refuse tant qu'une saisie non nulle y vit (la perdre changerait la 2035
-- d'un exercice), et se colle dans l'éditeur SQL (le mot `drop` le fait coller). Avant lui : baisser
-- `SAISIES_2035_EXPORTEES` (src/lib/saisies2035.ts) et le publier, sans quoi l'écran et la sauvegarde liraient une table
-- absente ; après lui, rejouer les trois contrôles de l'export et retirer le fichier de la migration de supabase/schema/.

do $garde$
begin
  if to_regclass('public.saisies_2035') is null then
    raise exception 'La migration saisies_2035 n''est pas en base : rien à défaire.';
  end if;
  if exists (select 1 from public.saisies_2035 s where s.centimes > 0) then
    raise exception 'Une saisie de la 2035 porte un montant : le retour la détruirait. Rien n''est défait.';
  end if;
end
$garde$;

drop function public.enregistrer_saisies_2035(uuid, integer, jsonb, jsonb);
drop table public.saisies_2035;
drop function public.garder_saisie_2035_validee();
