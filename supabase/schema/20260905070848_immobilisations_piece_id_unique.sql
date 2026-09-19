-- Le dédoublonnage (dejaEnregistrees dans ImmobilisationsTab) n'existait que côté client — deux appels
-- concurrents (deux onglets ouverts, un double-clic) pouvaient créer deux immobilisations pour la même
-- pièce, comptant deux fois la même dépense en amortissement. UNIQUE (piece_id) traite les NULL comme
-- distincts en Postgres, donc les immobilisations sans pièce liée (saisie manuelle) restent illimitées.
alter table immobilisations add constraint immobilisations_piece_id_unique unique (piece_id);
