-- RETOUR DE LM7 (`honoraires_factures`, supabase/schema/20261112141227_honoraires_factures.sql) — PRÉPARÉ, À COLLER
-- (il supprime une table et neuf fonctions). AVANT le retour de LM4 (`lettres_de_mission`), dont la table est citée par la
-- clé de la lettre. Il rend la base d'avant la migration — `signature.sql` égale à celle d'avant, éprouvé sur la
-- réplique — et SE REFUSE tant qu'un lien existe : retirer la table perdrait, sans le dire, quelle facture a facturé
-- quelle période (les factures, elles, restent). Les factures et leurs brouillons ne changent pas : la migration n'en a
-- touché aucune colonne.
-- La migration est en production depuis le 12/11/2026 (version 20261112141227) : supabase/schema/20261112141227_honoraires_factures.sql.

do $garde$
begin
  if to_regclass('public.honoraires_factures') is null then
    raise exception 'Les factures d''honoraires ne sont pas en base : rien à retirer.';
  end if;
  if exists (select 1 from public.honoraires_factures) then
    raise exception 'Des factures d''honoraires sont liées à leurs périodes : le retour les perdrait. Rien n''est retiré.';
  end if;
end
$garde$;

drop function public.facturer_honoraires(uuid, jsonb, numeric, jsonb);
drop function public.honoraires_au_prorata(numeric, text, date, date);
drop table public.honoraires_factures;
drop function public.garder_honoraires_factures();
drop function public.racine_de_la_lettre(uuid);
drop function public.facture_creditee_en_entier(uuid);
drop function public.lettre_en_vigueur_le(uuid, date);
drop function public.periode_de_forfait_valide(text, date, date);
drop function public.periode_civile_fin(text, date);
drop function public.periode_civile_debut(text, date);
