-- Un visiteur ANONYME lisait les catégories et les natures d'immobilisation du cabinet.
--
-- Trouvé par le harnais d'impersonation (supabase/essais/rls.sql) à sa première exécution, pas par
-- une relecture : les deux policies portaient `using (dossier_id is null or ...)`, et une policy sans
-- clause `to` s'applique au rôle `public`, donc à `anon`. La branche « dossier_id is null » voulait
-- dire « partagé par tout le cabinet » ; elle disait en fait « lisible par tout Internet muni de la
-- clé publique », ce qui est une autre phrase.
--
-- Ce que ça exposait : 10 libellés de catégories avec leur compte PCG et leur poste 2035, et 8
-- natures d'immobilisation avec leur durée. Aucune donnée personnelle, aucune donnée de dossier —
-- mais la configuration comptable du cabinet, et surtout une porte qui s'élargit toute seule : le
-- jour où une ligne partagée porte autre chose, elle est publique sans que personne l'ait décidé.
--
-- La correction est d'ajouter `to authenticated`, et le projet savait déjà le faire : la policy de
-- `taux_change_bce`, écrite plus tard, porte `for select to authenticated using (true)`. Ces deux-là
-- sont simplement antérieures à ce réflexe.
--
-- Aucun écran ne lit ces tables sans session — vérifié avant d'appliquer : tous les appels vivent
-- dans les onglets d'un dossier, derrière l'authentification, et `Login.tsx` n'y touche pas.
-- Les prédicats sont repris à l'identique ; seul le rôle change.

drop policy categories_select on public.categories;
create policy categories_select on public.categories
  for select to authenticated
  using (
    dossier_id is null
    or admin_du_dossier(dossier_id)
    or exists (select 1 from memberships m where m.dossier_id = categories.dossier_id and m.user_id = auth.uid())
  );

drop policy natures_immobilisation_select on public.natures_immobilisation;
create policy natures_immobilisation_select on public.natures_immobilisation
  for select to authenticated
  using (dossier_id is null or admin_du_dossier(dossier_id));
