-- LA BANQUE DU CLIENT EN BASE, SECOND TEMPS : LES LECTURES D'AUJOURD'HUI RESSERRÉES AU DROIT « BANQUE » (espace client,
-- étape P7 ; conception : HISTORIQUE.md, « L'ESPACE CLIENT DEVIENT LE LOGICIEL DE GESTION DU CLIENT : LA CONCEPTION »,
-- §1.2, §3.3, §3.6, §6.1 ; EC-Q1 sans réponse, sa recommandation prise comme hypothèse : « Ma simulation » suit la case
-- « Banque »).
--
-- CE QU'ELLE RESSERRE. Depuis leur création, TOUT accès client d'un dossier lit, par l'API, les mouvements de son relevé —
-- date, libellé et libellé brut, montant, statut, catégorie, taux de TVA, compte de bilan, découpage d'une échéance
-- d'emprunt —, les parts d'un mouvement ventilé et celles d'un virement qui règle plusieurs pièces. Aucun de ses écrans
-- ne les lui montre, sauf « Ma simulation », qui en tire son chiffre d'affaires encaissé ; « pas de montants » était une
-- règle d'ÉCRAN (conception, §1.2). Désormais, seul un accès qui porte la case « Banque » (`memberships.droit_banque`,
-- posée par le cabinet) les lit. Les trois policies gardent leur nom ; leur prédicat devient `client_du_dossier(…,
-- 'banque')`, et celle des mouvements, née `to public`, devient `to authenticated` : sa fonction n'est pas exécutable
-- sans session, et un prédicat client ne doit jamais pouvoir être évalué pour l'anonyme. Le cabinet garde ses propres
-- policies, inchangées.
--
-- CE QU'ELLE N'ENLÈVE PAS : la couverture du relevé — les mois où il porte un mouvement —, que tout accès lit par
-- `couverture_du_releve` (migration `banque_du_client`) ; le dépôt des pièces et des documents, relevés en fichier
-- compris, ouvert à tout accès comme avant.
--
-- À N'APPLIQUER QU'APRÈS la mise en ligne de l'application qui lit la couverture (`COUVERTURE_EXPORTEE` à vrai dans
-- src/lib/couvertureReleve.ts) : une lecture que la RLS refuse rend ZÉRO ligne, sans erreur, et un écran qui lirait
-- encore les mouvements sans la case croirait le relevé vide — il réclamerait au client tous les mois de l'année.
--
-- RETOUR ARRIÈRE : le même `alter policy`, avec le prédicat d'avant (`exists (select 1 from memberships m where
-- m.dossier_id = … and m.user_id = auth.uid())`, `(select auth.uid())` pour les parts) — rien n'est détruit ici, aucune
-- ligne n'est touchée.
alter policy "membres peuvent lire leurs lignes bancaires" on public.lignes_bancaires
  to authenticated
  using (client_du_dossier(dossier_id, 'banque'));

alter policy ventilations_bancaires_lecture_client on public.ventilations_bancaires
  using (client_du_dossier(dossier_id, 'banque'));

alter policy reglements_groupes_lecture_client on public.reglements_groupes
  using (client_du_dossier(dossier_id, 'banque'));

comment on policy "membres peuvent lire leurs lignes bancaires" on public.lignes_bancaires is
  'Un accès client qui porte la case « Banque » lit les mouvements du relevé de son dossier (espace client, étape P7 ; le nom date d''avant, quand tout accès les lisait).';
comment on policy ventilations_bancaires_lecture_client on public.ventilations_bancaires is
  'Un accès client qui porte la case « Banque » lit les parts des mouvements ventilés de son dossier (espace client, étape P7).';
comment on policy reglements_groupes_lecture_client on public.reglements_groupes is
  'Un accès client qui porte la case « Banque » lit les parts des virements qui règlent plusieurs pièces de son dossier (espace client, étape P7).';
