-- UNE CONNEXION BANCAIRE PAR DOSSIER. C'est ce que l'application tient : `lignes_bancaires` n'a pas de
-- colonne de compte, un dossier n'a qu'un relevé, écrit sur le seul 512000. Et c'est ce que la fonction
-- `banque-connexion` suppose : elle lit LA connexion d'un dossier. Tenue par la seule fonction, la règle
-- céderait à deux demandes de connexion lancées en même temps — deux lignes, et la lecture suivante
-- échouerait sans que personne sache laquelle garder.
alter table public.connexions_bancaires add constraint connexions_bancaires_dossier_unique unique (dossier_id);

-- La contrainte porte son propre index, qui sert aussi la recherche par dossier : le précédent est redondant.
drop index public.connexions_bancaires_dossier_id_idx;
