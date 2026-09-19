-- Correction : le "durcissement" précédent (revoke execute ... from anon) cassait toute requête
-- anonyme sur les tables protégées avec une erreur Postgres brute ("permission denied for function")
-- au lieu d'un refus silencieux (0 ligne) — vérifié en le reproduisant juste après coup. Les policies
-- RLS doivent pouvoir évaluer ces fonctions quel que soit le rôle de l'appelant, y compris anon ; la
-- sécurité vient de ce que les fonctions renvoient (false/null pour un appelant non légitime), pas de
-- l'interdiction de les exécuter.
grant execute on function public.is_super_admin() to anon, public;
grant execute on function public.mon_cabinet_id() to anon, public;
grant execute on function public.admin_du_dossier(uuid) to anon, public;
grant execute on function public.admin_du_cabinet(uuid) to anon, public;
