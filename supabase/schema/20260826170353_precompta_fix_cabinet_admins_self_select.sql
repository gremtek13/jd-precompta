-- Sans cette policy, les EXISTS(...) sur cabinet_admins utilisés dans les autres policies
-- retournent toujours vide (RLS s'applique aussi aux sous-requêtes), ce qui bloquerait
-- l'accès admin partout. On autorise uniquement à voir SA PROPRE ligne (pas la liste complète).
create policy cabinet_admins_select_self on cabinet_admins for select using (
  user_id = auth.uid()
);
