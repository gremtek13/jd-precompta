
-- Traçabilité de l'import (voir audit ergonomie) : quand la colonne "Libellé" est vide sur une ligne
-- d'un relevé (ça arrive selon les banques), le libellé retombait jusqu'ici sur "Mouvement bancaire"
-- générique sans aucun moyen de retrouver ni le fichier d'origine ni la ligne brute réellement
-- importée. Les deux colonnes restent nulles pour l'historique déjà importé (rien à reconstituer a
-- posteriori) et se remplissent pour tout nouvel import.
alter table lignes_bancaires add column source_fichier text;
alter table lignes_bancaires add column libelle_brut text;
