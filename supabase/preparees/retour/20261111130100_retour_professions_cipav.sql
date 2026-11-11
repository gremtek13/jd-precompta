-- RETOUR de `professions_cipav` (20261111130000, en production depuis le 11/11/2026 : supabase/schema/
-- 20261111130000_professions_cipav.sql) : la contrainte d'hier et les commentaires d'hier.
--
-- Il ne retire aucune ligne. Une ligne qui porte `liberal_cipav` le fait REFUSER (la contrainte d'hier ne s'ajoute pas
-- sur elle, 23514) : défaire la migration demanderait alors d'abord de vider ces professions, une perte de données que
-- seul le cabinet décide — ce retour ne le fait pas. Il porte `drop constraint` : à coller dans l'éditeur SQL.

alter table public.volet_social_pamc
  drop constraint volet_social_pamc_profession_check,
  add constraint volet_social_pamc_profession_check check (profession in (
    'auxiliaire_medical', 'sage_femme', 'medecin_secteur_1', 'medecin_secteur_2', 'chirurgien_dentiste'));

comment on table public.volet_social_pamc is
  'Chiffres du volet social d''un praticien ou auxiliaire médical conventionné (déclaration de '
  'revenus, rubriques DSCS, DSAV, DSAW et DSAT), une ligne par exercice à partir des revenus 2025 '
  '(ligne 27 de la feuille de route, décision du cabinet du 28/09/2026). Recettes brutes nulles : '
  'l''application reprend la ligne 4 de la 2035-A. Sert aussi à estimer les cotisations Urssaf.';

comment on column public.volet_social_pamc.profession is null;
