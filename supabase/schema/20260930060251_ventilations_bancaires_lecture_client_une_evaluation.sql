-- La policy de lecture du client appelait `auth.uid()` pour CHAQUE ligne lue : l'avertissement
-- `auth_rls_initplan` des advisors de performance, levé le jour même de la création de la table. Écrit
-- `(select auth.uid())`, l'appel devient un sous-plan évalué une fois par requête. Même prédicat, même
-- résultat : c'est une question de coût, pas d'accès.
alter policy ventilations_bancaires_lecture_client on public.ventilations_bancaires
  using (exists (
    select 1 from public.memberships m
     where m.dossier_id = ventilations_bancaires.dossier_id and m.user_id = (select auth.uid())
  ));
