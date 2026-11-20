-- RETOUR ARRIÈRE DE `association_paiements_assurance_maladie` (conception 53, NOE5) — DESTRUCTIF, À ACCORDER PAR LE CABINET,
-- À COLLER dans l'éditeur SQL de Supabase, dans une transaction, avec sa ligne d'historique (le texte retire une table, deux
-- déclencheurs et quatre fonctions). La migration : supabase/schema/20261120110100_association_paiements_assurance_maladie.sql
-- (préparée le 17/11/2026, sous une version provisoire) ; le récit : HISTORIQUE.md, « 17/11/2026 — NOE5 : L'ASSOCIATION DES
-- PAIEMENTS DE L'ASSURANCE MALADIE AUX CRÉDITS DU RELEVÉ (PRÉPARÉE, PAS APPLIQUÉE) ».
--
-- L'ORDRE : D'ABORD l'application, son drapeau baissé (`ASSOCIATIONS_ASSURANCE_MALADIE_PREVUES`) et remise en ligne, PUIS ce
-- texte. Il se joue AVANT le retour de `paiements_assurance_maladie` (NOE3), dont la table porte la clé et le déclencheur
-- qu'il retire.
--
-- CE QU'IL REND : la base d'avant la migration ; aucune fonction d'hier n'a été remplacée, et les tables de NOE3 retrouvent
-- leurs seules gardes.
--
-- CE QU'IL RETIRE — ce qu'il DÉTRUIRAIT : la table `paiements_assurance_maladie_mouvements` et ses associations. Il se refuse
-- tant qu'elle porte une ligne : une association défaite se refait, une association perdue ne se retrouve pas.
do $retour$
begin
  if to_regclass('public.paiements_assurance_maladie_mouvements') is null then
    raise exception 'La migration association_paiements_assurance_maladie n''est pas en base : rien à retirer.';
  end if;
  if exists (select 1 from public.paiements_assurance_maladie_mouvements) then
    raise exception 'La table des associations porte des lignes : le retour les perdrait. Les défaire d''abord, ou garder la migration.';
  end if;
end
$retour$;

drop trigger imports_assurance_maladie_associes on public.imports_assurance_maladie;
drop function public.retenir_import_associe();
drop function public.associer_paiements_assurance_maladie(uuid, uuid[], uuid[]);
drop function public.defaire_association_assurance_maladie(uuid, uuid);
drop table public.paiements_assurance_maladie_mouvements;
drop function public.garder_paiements_assurance_maladie_mouvements();

do $fin$
begin
  if to_regclass('public.paiements_assurance_maladie_mouvements') is not null
     or exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                 and p.proname in ('associer_paiements_assurance_maladie', 'defaire_association_assurance_maladie',
                                   'garder_paiements_assurance_maladie_mouvements', 'retenir_import_associe'))
     or exists (select 1 from pg_trigger t where t.tgrelid = 'public.imports_assurance_maladie'::regclass and not t.tgisinternal
                 and t.tgname = 'imports_assurance_maladie_associes') then
    raise exception 'Le retour n''a pas tout retiré.';
  end if;
end
$fin$;
