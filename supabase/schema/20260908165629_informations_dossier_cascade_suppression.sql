-- Seule table encore en "NO ACTION" sur dossier_id (toutes les autres tables liées à un dossier
-- cascadent déjà) — sans ce correctif, supprimer un dossier ayant des informations_dossier
-- renseignées (le cas courant : c'est le formulaire "Informations du client") échouerait avec une
-- violation de contrainte, alors même que rien dans l'appli n'explique ce blocage. Voir la nouvelle
-- fonctionnalité de suppression de dossier (lib/suppression.ts, InformationsTab).
alter table informations_dossier drop constraint informations_dossier_dossier_id_fkey;
alter table informations_dossier add constraint informations_dossier_dossier_id_fkey
  foreign key (dossier_id) references dossiers(id) on delete cascade;
