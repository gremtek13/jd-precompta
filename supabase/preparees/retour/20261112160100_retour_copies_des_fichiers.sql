-- RETOUR DE `copies_des_fichiers` (INAL6, lignes 20.65 et 44 ; préparée le 12/11/2026 sous 20261112160000 ; en production
-- depuis le 12/11/2026, version 20261112155830 : supabase/schema/20261112155830_copies_des_fichiers.sql) — À COLLER, et
-- seulement sur l'accord du
-- cabinet : il DÉTRUIT l'historique des copies des fichiers (une table, leurs attestations comprises) et retire ses deux
-- fonctions. Ce qu'il rend : la base d'avant la migration — le tableau de bord ne sait plus quand la dernière copie a été
-- faite ni si son manifeste a été rechargé.
-- Avant de le coller : relever la table (un SELECT suffit : elle ne porte que des comptes, des empreintes et des instants), et
-- baisser `COPIE_DES_FICHIERS_PREVUE` (src/lib/copieDesFichiers.ts) dans le même déploiement.

do $garde$
begin
  if to_regclass('public.copies_des_fichiers') is null then
    raise exception 'retour_copies_des_fichiers : la migration copies_des_fichiers n''est pas en base.';
  end if;
end
$garde$;

drop function public.attester_copie_des_fichiers(uuid, uuid, text);
drop function public.enregistrer_copie_des_fichiers(uuid, uuid, integer, integer, integer, integer, integer, bigint, text);
drop table public.copies_des_fichiers;
