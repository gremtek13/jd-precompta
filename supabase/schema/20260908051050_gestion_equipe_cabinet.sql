-- Permet à un chef de cabinet de gérer lui-même son équipe (comptables / comptables en chef) plutôt
-- que de passer par un accès direct en base à chaque fois — seule la création du compte de connexion
-- (identifiants) reste un accès service-role (Edge Function), le reste (lecture, retrait, changement
-- de rôle) passe directement par RLS.

-- Email affiché sans avoir besoin de l'API Admin (même raison que memberships.email) — renseigné par
-- l'Edge Function create-team-member à la création, backfillé ici pour le seul compte existant.
alter table public.cabinet_admins add column email text;
update public.cabinet_admins set email = 'jeremy.darnis@gmail.com';

-- Lecture élargie : un chef voit désormais toute l'équipe de SON cabinet, pas seulement sa propre
-- ligne (jusqu'ici même un super-admin ne voyait que la sienne — corrigé une première fois pour lui
-- sur la page Comptes master, on généralise ici pour tout chef de cabinet).
drop policy cabinet_admins_select on public.cabinet_admins;
create policy cabinet_admins_select on public.cabinet_admins for select
  using (user_id = auth.uid() or is_super_admin() or est_chef_du_cabinet(cabinet_id));

-- Le chef peut changer le rôle d'un membre de son cabinet ou le retirer (jamais créer : la création
-- d'un compte de connexion nécessite la clé de service, voir create-team-member) — jamais un simple
-- comptable, qui ne doit pas pouvoir se promouvoir lui-même ou modifier ses collègues.
create policy cabinet_admins_update on public.cabinet_admins for update
  using (est_chef_du_cabinet(cabinet_id)) with check (est_chef_du_cabinet(cabinet_id));
create policy cabinet_admins_delete on public.cabinet_admins for delete
  using (est_chef_du_cabinet(cabinet_id));
