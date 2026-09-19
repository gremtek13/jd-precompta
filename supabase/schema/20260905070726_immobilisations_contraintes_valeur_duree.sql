-- Rien n'empêchait jusqu'ici duree_annees <= 0 (le formulaire a bien min={1}, mais un attribut HTML
-- se contourne facilement) — une immobilisation à 0 an casserait silencieusement le calcul de dotation
-- (valeur / duree_annees) en Infinity/NaN dans Estimation et Clôture. Même logique pour valeur, qui
-- n'a pas de sens négative ou nulle.
alter table immobilisations add constraint immobilisations_duree_positive check (duree_annees > 0);
alter table immobilisations add constraint immobilisations_valeur_positive check (valeur > 0);
