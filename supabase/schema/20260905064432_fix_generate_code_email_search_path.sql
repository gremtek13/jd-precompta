-- Corrige l'avertissement du linter Supabase (function_search_path_mutable) : sans search_path fixé,
-- une fonction SECURITY DEFINER (ou appelée dans un contexte au search_path modifié) pourrait
-- résoudre des noms non qualifiés vers des objets d'un autre schéma. Aucun changement de comportement
-- ici (la fonction n'utilise que des fonctions du catalogue standard), juste le durcissement recommandé.
alter function public.generate_code_email() set search_path = public, pg_temp;
