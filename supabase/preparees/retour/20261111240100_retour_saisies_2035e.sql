-- Le retour de la migration `saisies_2035e` (supabase/schema/20261112134300_saisies_2035e.sql, préparée le 11/11/2026 ;
-- en production depuis le 12/11/2026, version 20261112134300 ; ligne 48). Il DÉTRUIT la table des saisies de l'annexe 2035-E, sa garde et sa fonction d'écriture : il refuse tant
-- qu'une saisie y porte une valeur (la perdre changerait l'annexe d'un exercice), et se colle dans l'éditeur SQL (le mot
-- `drop` le fait coller). Avant lui : baisser `SAISIES_2035E_EXPORTEES` et `SAISIES_2035E_PREVUES`
-- (src/lib/saisies2035E.ts) et le publier, sans quoi l'écran et la sauvegarde liraient une table absente ; après lui,
-- rejouer les trois contrôles de l'export et retirer le fichier de la migration de supabase/schema/.

do $garde$
begin
  if to_regclass('public.saisies_2035e') is null then
    raise exception 'La migration saisies_2035e n''est pas en base : rien à défaire.';
  end if;
  if exists (select 1 from public.saisies_2035e s
             where num_nonnulls(s.loyers_deductibles, s.plus_values, s.variation_de_stock, s.taxes_sur_le_chiffre_d_affaires,
                                s.dotations_biens_mis_a_disposition, s.moins_values, s.mono_etablissement, s.effectif) > 0) then
    raise exception 'Une saisie de l''annexe 2035-E porte une valeur : le retour la détruirait. Rien n''est défait.';
  end if;
end
$garde$;

drop function public.enregistrer_saisies_2035e(uuid, integer, jsonb, jsonb);
drop table public.saisies_2035e;
drop function public.garder_saisie_2035e_validee();
