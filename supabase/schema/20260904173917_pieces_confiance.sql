-- Score de confiance de l'extraction automatique — déjà calculé par extractPiece() (haute/moyenne/
-- basse) et affiché ponctuellement dans PieceFormModal après un clic sur "Extraire automatiquement",
-- mais jamais enregistré jusqu'ici : perdu dès qu'on quitte la fiche, et totalement absent des deux
-- chemins d'extraction automatique en masse (dépôt client via l'appareil photo/upload, import de
-- dossier côté cabinet) — là où personne ne regarde chaque extraction au moment où elle a lieu, donc
-- là où ce signal manque le plus. Permet de trier "à valider" par ce qui a le plus de chances d'être
-- faux plutôt que de tout revérifier au même niveau d'attention.
alter table pieces add column confiance text check (confiance in ('haute', 'moyenne', 'basse'));
