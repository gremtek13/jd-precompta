-- RETOUR de la migration `categories_du_dossier` (PC7, ligne 43 ; supabase/preparees/20261112151000_categories_du_dossier.sql).
-- Retire le déclencheur et sa fonction : `categories` redevient ce qu'elle était au 11/11/2026 (quatre policies, aucun
-- déclencheur). Aucune donnée n'est touchée : les catégories créées sous la garde restent telles quelles. Abaisser
-- `CATEGORIES_DU_DOSSIER_PREVUES` D'ABORD (src/lib/categoriesDuDossier.ts), puis déployer, puis ce retour : l'écran des
-- catégories du dossier redit les refus de la garde, et sans elle la base ne les tiendrait plus. Le texte porte deux
-- `drop` : il SE COLLE dans l'éditeur SQL, dans une transaction, avec sa ligne d'historique.

drop trigger categories_du_dossier on public.categories;
drop function public.garder_categorie_du_dossier();
