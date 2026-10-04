-- Ligne 26.6 de la feuille de route, étape (b) : le FORFAIT KILOMÉTRIQUE s'écrit (voir la migration suivante,
-- `forfait_kilometrique_ecrit`). Son écriture désigne sa ligne du cadre 7. Clé SANS action à la suppression :
-- un véhicule dont le forfait est écrit ne se supprime que par `retirer_vehicule`, qui retire le forfait avec
-- lui. Un forfait n'est ni l'écriture d'une pièce, ni celle d'un mouvement, ni la dotation d'un bien, et il
-- tombe au 31 décembre.
alter table public.ecritures_brouillon add column vehicule_id uuid references public.vehicules(id);
create index ecritures_brouillon_vehicule_id_idx on public.ecritures_brouillon (vehicule_id);
alter table public.ecritures_brouillon add constraint ecritures_brouillon_forfait_sans_piece_ni_mouvement
  check (vehicule_id is null or (piece_id is null and ligne_bancaire_id is null and immobilisation_id is null));
alter table public.ecritures_brouillon add constraint ecritures_brouillon_forfait_au_31_decembre
  check (vehicule_id is null or (extract(month from date) = 12 and extract(day from date) = 31));
