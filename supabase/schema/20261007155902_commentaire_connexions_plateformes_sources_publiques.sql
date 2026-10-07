-- La connexion d'un dossier à la plateforme agréée de son client (ligne 28.5, étape b) : son commentaire citait la norme
-- AFNOR XP Z12-013, que son éditeur interdit d'exploiter par une IA (décision du cabinet du 07/10/2026). Ce que
-- l'application attend d'une plateforme est tiré des documentations publiques des plateformes ; le commentaire le dit.
comment on table public.connexions_plateformes is
  'Connexion d''un dossier à la plateforme agréée de son client, par l''API de flux que publient les plateformes (dite '
  '« API AFNOR ») : adresses, identifiant et secret OAuth2, organisation, et le point d''où repart la recherche des '
  'factures. RLS sans policy : seule l''Edge Function plateforme-agreee la lit et l''écrit, après avoir vérifié '
  'admin_du_dossier.';
