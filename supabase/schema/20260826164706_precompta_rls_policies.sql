alter table cabinet_admins enable row level security;
alter table dossiers enable row level security;
alter table memberships enable row level security;
alter table categories enable row level security;
alter table pieces enable row level security;
alter table packs enable row level security;
alter table pack_pieces enable row level security;

-- cabinet_admins : géré manuellement (SQL editor / service role), aucun accès via API client
-- (RLS activée sans policy = aucun accès pour anon/authenticated)

-- dossiers : cabinet voit/gère tout ; client voit son propre dossier
create policy dossiers_select on dossiers for select using (
  is_cabinet_admin() or exists(select 1 from memberships m where m.dossier_id = dossiers.id and m.user_id = auth.uid())
);
create policy dossiers_write on dossiers for insert with check (is_cabinet_admin());
create policy dossiers_update on dossiers for update using (is_cabinet_admin());
create policy dossiers_delete on dossiers for delete using (is_cabinet_admin());

-- memberships : cabinet gère les accès ; un client peut voir sa propre ligne
create policy memberships_select on memberships for select using (
  is_cabinet_admin() or user_id = auth.uid()
);
create policy memberships_write on memberships for insert with check (is_cabinet_admin());
create policy memberships_delete on memberships for delete using (is_cabinet_admin());

-- categories : lisibles par quiconque a accès au dossier (ou globales), gérées par le cabinet
create policy categories_select on categories for select using (
  dossier_id is null
  or is_cabinet_admin()
  or exists(select 1 from memberships m where m.dossier_id = categories.dossier_id and m.user_id = auth.uid())
);
create policy categories_write on categories for insert with check (is_cabinet_admin());
create policy categories_update on categories for update using (is_cabinet_admin());
create policy categories_delete on categories for delete using (is_cabinet_admin());

-- pieces : cabinet tout ; client peut lire/déposer sur son dossier, pas modifier/valider/supprimer
create policy pieces_select on pieces for select using (
  is_cabinet_admin() or exists(select 1 from memberships m where m.dossier_id = pieces.dossier_id and m.user_id = auth.uid())
);
create policy pieces_insert on pieces for insert with check (
  is_cabinet_admin() or exists(select 1 from memberships m where m.dossier_id = pieces.dossier_id and m.user_id = auth.uid())
);
create policy pieces_update on pieces for update using (is_cabinet_admin());
create policy pieces_delete on pieces for delete using (is_cabinet_admin());

-- packs et pack_pieces : cabinet uniquement
create policy packs_all on packs for all using (is_cabinet_admin()) with check (is_cabinet_admin());
create policy pack_pieces_all on pack_pieces for all using (is_cabinet_admin()) with check (is_cabinet_admin());
