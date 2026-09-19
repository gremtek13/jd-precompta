
-- Identité de l'émetteur figée au moment de la facture, pas relue en direct depuis dossiers à chaque
-- affichage : si le nom/siret/adresse du dossier change plus tard, une facture déjà validée ne doit
-- jamais se réafficher avec une identité différente de celle qu'elle portait réellement au moment de
-- son émission — une facture est un document historique, pas une vue dynamique.
alter table factures_emises add column emetteur_nom text;
alter table factures_emises add column emetteur_siret text;
alter table factures_emises add column emetteur_adresse text;
