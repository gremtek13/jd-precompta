-- Remplace, partout, "n'importe quel cabinet_admin" par "admin du cabinet propriétaire de cette
-- ligne, ou super-admin" (voir admin_du_dossier / admin_du_cabinet, migration précédente). Les
-- policies basées sur memberships (accès client) ne changent pas : un membership référence déjà un
-- dossier précis, aucune fuite possible entre cabinets par ce chemin.

-- dossiers
drop policy dossiers_select on public.dossiers;
create policy dossiers_select on public.dossiers for select
  using (admin_du_cabinet(cabinet_id) or exists (select 1 from memberships m where m.dossier_id = dossiers.id and m.user_id = auth.uid()));
drop policy dossiers_write on public.dossiers;
create policy dossiers_write on public.dossiers for insert with check (admin_du_cabinet(cabinet_id));
drop policy dossiers_update on public.dossiers;
create policy dossiers_update on public.dossiers for update using (admin_du_cabinet(cabinet_id)) with check (admin_du_cabinet(cabinet_id));
drop policy dossiers_delete on public.dossiers;
create policy dossiers_delete on public.dossiers for delete using (admin_du_cabinet(cabinet_id));

-- memberships
drop policy memberships_select on public.memberships;
create policy memberships_select on public.memberships for select
  using (admin_du_dossier(dossier_id) or user_id = auth.uid());
drop policy memberships_write on public.memberships;
create policy memberships_write on public.memberships for insert with check (admin_du_dossier(dossier_id));
drop policy memberships_delete on public.memberships;
create policy memberships_delete on public.memberships for delete using (admin_du_dossier(dossier_id));

-- categories (dossier_id nullable = catégorie globale, partagée par tous les cabinets ; seul un
-- super-admin peut créer/modifier/supprimer une catégorie globale, pour ne pas qu'un cabinet change
-- ce que voient tous les autres).
drop policy categories_select on public.categories;
create policy categories_select on public.categories for select
  using (dossier_id is null or admin_du_dossier(dossier_id) or exists (select 1 from memberships m where m.dossier_id = categories.dossier_id and m.user_id = auth.uid()));
drop policy categories_write on public.categories;
create policy categories_write on public.categories for insert with check
  ((dossier_id is null and is_super_admin()) or (dossier_id is not null and admin_du_dossier(dossier_id)));
drop policy categories_update on public.categories;
create policy categories_update on public.categories for update
  using ((dossier_id is null and is_super_admin()) or (dossier_id is not null and admin_du_dossier(dossier_id)))
  with check ((dossier_id is null and is_super_admin()) or (dossier_id is not null and admin_du_dossier(dossier_id)));
drop policy categories_delete on public.categories;
create policy categories_delete on public.categories for delete
  using ((dossier_id is null and is_super_admin()) or (dossier_id is not null and admin_du_dossier(dossier_id)));

-- natures_immobilisation — même nullable, même règle (jusqu'ici une seule policy ALL ; scindée comme
-- categories pour permettre la lecture des valeurs globales à tous, sans autoriser leur écriture).
drop policy "cabinet admins full access" on public.natures_immobilisation;
create policy natures_immobilisation_select on public.natures_immobilisation for select
  using (dossier_id is null or admin_du_dossier(dossier_id));
create policy natures_immobilisation_write on public.natures_immobilisation for insert with check
  ((dossier_id is null and is_super_admin()) or (dossier_id is not null and admin_du_dossier(dossier_id)));
create policy natures_immobilisation_update on public.natures_immobilisation for update
  using ((dossier_id is null and is_super_admin()) or (dossier_id is not null and admin_du_dossier(dossier_id)))
  with check ((dossier_id is null and is_super_admin()) or (dossier_id is not null and admin_du_dossier(dossier_id)));
create policy natures_immobilisation_delete on public.natures_immobilisation for delete
  using ((dossier_id is null and is_super_admin()) or (dossier_id is not null and admin_du_dossier(dossier_id)));

-- tiers_categories_cabinet — plus de dossier_id du tout, désormais un cabinet_id propre.
drop policy "cabinet admins full access" on public.tiers_categories_cabinet;
create policy tiers_categories_cabinet_all on public.tiers_categories_cabinet for all
  using (admin_du_cabinet(cabinet_id)) with check (admin_du_cabinet(cabinet_id));

-- pack_pieces — pas de dossier_id direct, on passe par packs.
drop policy pack_pieces_all on public.pack_pieces;
create policy pack_pieces_all on public.pack_pieces for all
  using (admin_du_dossier((select p.dossier_id from packs p where p.id = pack_pieces.pack_id)))
  with check (admin_du_dossier((select p.dossier_id from packs p where p.id = pack_pieces.pack_id)));

-- pieces
drop policy pieces_select on public.pieces;
create policy pieces_select on public.pieces for select
  using (admin_du_dossier(dossier_id) or exists (select 1 from memberships m where m.dossier_id = pieces.dossier_id and m.user_id = auth.uid()));
drop policy pieces_insert on public.pieces;
create policy pieces_insert on public.pieces for insert with check
  (admin_du_dossier(dossier_id) or exists (select 1 from memberships m where m.dossier_id = pieces.dossier_id and m.user_id = auth.uid()));
drop policy pieces_update on public.pieces;
create policy pieces_update on public.pieces for update using (admin_du_dossier(dossier_id)) with check (admin_du_dossier(dossier_id));
drop policy pieces_delete on public.pieces;
create policy pieces_delete on public.pieces for delete using (admin_du_dossier(dossier_id));

-- sous_dossiers
drop policy sous_dossiers_select on public.sous_dossiers;
create policy sous_dossiers_select on public.sous_dossiers for select
  using (admin_du_dossier(dossier_id) or exists (select 1 from memberships m where m.dossier_id = sous_dossiers.dossier_id and m.user_id = auth.uid()));
drop policy sous_dossiers_insert on public.sous_dossiers;
create policy sous_dossiers_insert on public.sous_dossiers for insert with check (admin_du_dossier(dossier_id));
drop policy sous_dossiers_update on public.sous_dossiers;
create policy sous_dossiers_update on public.sous_dossiers for update using (admin_du_dossier(dossier_id)) with check (admin_du_dossier(dossier_id));
drop policy sous_dossiers_delete on public.sous_dossiers;
create policy sous_dossiers_delete on public.sous_dossiers for delete using (admin_du_dossier(dossier_id));

-- tiers_categories
drop policy tiers_categories_select on public.tiers_categories;
create policy tiers_categories_select on public.tiers_categories for select
  using (admin_du_dossier(dossier_id) or exists (select 1 from memberships m where m.dossier_id = tiers_categories.dossier_id and m.user_id = auth.uid()));
drop policy tiers_categories_update on public.tiers_categories;
create policy tiers_categories_update on public.tiers_categories for update using (admin_du_dossier(dossier_id)) with check (admin_du_dossier(dossier_id));
drop policy tiers_categories_write on public.tiers_categories;
create policy tiers_categories_write on public.tiers_categories for insert with check (admin_du_dossier(dossier_id));

-- Tables à policy ALL simple (dossier_id non nul, aucune particularité) — même remplacement partout.
drop policy "cabinet admins full access" on public.agent_conversations;
create policy agent_conversations_all on public.agent_conversations for all
  using (admin_du_dossier(dossier_id)) with check (admin_du_dossier(dossier_id));

drop policy cotisations_declarees_all on public.cotisations_declarees;
create policy cotisations_declarees_all on public.cotisations_declarees for all
  using (admin_du_dossier(dossier_id)) with check (admin_du_dossier(dossier_id));

drop policy "cabinet admins full access" on public.declarations_tva;
create policy declarations_tva_all on public.declarations_tva for all
  using (admin_du_dossier(dossier_id)) with check (admin_du_dossier(dossier_id));

drop policy "cabinet admins full access" on public.documents_divers;
create policy documents_divers_admins_all on public.documents_divers for all
  using (admin_du_dossier(dossier_id)) with check (admin_du_dossier(dossier_id));

drop policy ecritures_brouillon_all on public.ecritures_brouillon;
create policy ecritures_brouillon_all on public.ecritures_brouillon for all
  using (admin_du_dossier(dossier_id)) with check (admin_du_dossier(dossier_id));

drop policy immobilisations_all on public.immobilisations;
create policy immobilisations_all on public.immobilisations for all
  using (admin_du_dossier(dossier_id)) with check (admin_du_dossier(dossier_id));

drop policy cabinet_admins_all on public.informations_dossier;
create policy informations_dossier_admins_all on public.informations_dossier for all
  using (admin_du_dossier(dossier_id)) with check (admin_du_dossier(dossier_id));

drop policy lignes_bancaires_all on public.lignes_bancaires;
create policy lignes_bancaires_all on public.lignes_bancaires for all
  using (admin_du_dossier(dossier_id)) with check (admin_du_dossier(dossier_id));

drop policy packs_all on public.packs;
create policy packs_all on public.packs for all
  using (admin_du_dossier(dossier_id)) with check (admin_du_dossier(dossier_id));

drop policy "cabinet admins full access" on public.references_annuelles;
create policy references_annuelles_all on public.references_annuelles for all
  using (admin_du_dossier(dossier_id)) with check (admin_du_dossier(dossier_id));

drop policy "cabinet admins full access" on public.references_postes_annuels;
create policy references_postes_annuels_all on public.references_postes_annuels for all
  using (admin_du_dossier(dossier_id)) with check (admin_du_dossier(dossier_id));

drop policy regles_bancaires_ignorees_all on public.regles_bancaires_ignorees;
create policy regles_bancaires_ignorees_all on public.regles_bancaires_ignorees for all
  using (admin_du_dossier(dossier_id)) with check (admin_du_dossier(dossier_id));
