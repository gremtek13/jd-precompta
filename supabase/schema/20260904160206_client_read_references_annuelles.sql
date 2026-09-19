-- Lecture seule des repères annuels / détail par poste pour les membres de leur propre dossier —
-- même schéma que "membres peuvent lire leurs cotisations" (cotisations_declarees) et "leurs lignes
-- bancaires" (lignes_bancaires) : le client voit sa simulation, jamais celle d'un autre dossier, et
-- ne peut ni l'insérer ni la modifier (ça reste un outil de travail du cabinet, ALL déjà réservé aux
-- cabinet_admins par la policy existante).
create policy "membres peuvent lire leurs references annuelles"
  on references_annuelles for select
  using (exists (select 1 from memberships m where m.dossier_id = references_annuelles.dossier_id and m.user_id = auth.uid()));

create policy "membres peuvent lire leurs references postes"
  on references_postes_annuels for select
  using (exists (select 1 from memberships m where m.dossier_id = references_postes_annuels.dossier_id and m.user_id = auth.uid()));
