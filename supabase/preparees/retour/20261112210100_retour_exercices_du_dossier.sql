-- Le retour de la migration `exercices_du_dossier` (supabase/preparees/20261112210000_exercices_du_dossier.sql, préparée le
-- 12/11/2026 ; ligne 42, lot EXD2). Il DÉTRUIT la table des exercices déclarés, ses deux gardes, ses fonctions et la garde
-- du modèle d'un dossier : il refuse tant qu'un exercice y est déclaré (le perdre changerait les bornes de l'exercice d'un
-- dossier en engagement), et tant qu'une autre fonction nomme les deux lectures (EXD3 les lira : le défaire d'abord). Il se
-- colle dans l'éditeur SQL (le mot `drop` le fait coller). Il laisse `btree_gist` : une extension ne porte aucune donnée, et
-- la retirer échouerait si un autre objet s'en servait. Avant lui : baisser `EXERCICES_DECALES_PREVUS`
-- (src/lib/exercices.ts) et le publier, sans quoi la sauvegarde lirait une table absente ; après lui, rejouer les trois
-- contrôles de l'export et retirer le fichier de la migration de supabase/schema/.

do $garde$
begin
  if to_regclass('public.exercices') is null then
    raise exception 'La migration exercices_du_dossier n''est pas en base : rien à défaire.';
  end if;
  if exists (select 1 from public.exercices) then
    raise exception 'Un exercice est déclaré : le retour le détruirait. Rien n''est défait.';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname not in ('bornes_de_l_exercice', 'exercice_de_la_date')
                and (p.prosrc ~ 'bornes_de_l_exercice' or p.prosrc ~ 'exercice_de_la_date')) then
    raise exception 'Une autre fonction lit les exercices déclarés (EXD3) : la défaire d''abord. Rien n''est défait.';
  end if;
end
$garde$;

drop trigger dossiers_exercices_retiennent_l_engagement on public.dossiers;
drop function public.garder_l_engagement_des_exercices();
drop function public.exercice_de_la_date(uuid, date);
drop function public.bornes_de_l_exercice(uuid, integer);
drop function public.changer_date_de_cloture(uuid, date, date, text, date);
drop function public.declarer_exercice(uuid, date, date, text, text, date);
drop table public.exercices;
drop function public.verifier_la_suite_des_exercices();
drop function public.garder_exercices();
