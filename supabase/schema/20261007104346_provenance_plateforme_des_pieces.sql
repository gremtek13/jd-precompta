-- La provenance « plateforme » d'une pièce : une facture importée de la plateforme agréée du client (ligne 28.5,
-- étape b, voir la migration `reception_par_plateforme_agreee`), toujours avec son flux (`pieces_flux_plateforme`).
-- À part de la migration précédente parce qu'elle retire une contrainte pour la remplacer.
alter table public.pieces drop constraint pieces_source_check;
alter table public.pieces add constraint pieces_source_check
  check (source = any (array['upload', 'email', 'superpdp', 'plateforme']));
