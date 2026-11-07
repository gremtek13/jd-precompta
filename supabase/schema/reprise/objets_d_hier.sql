-- LES OBJETS D'HIER : ce qu'une migration de l'export trouvait en base, que l'instantané du socle ne porte plus (une
-- migration suivante les a supprimés ou remplacés), et que `rejouer.py` pose juste avant elle. Leur forme vient de
-- l'histoire du dépôt — le socle d'avant cette migration —, jamais d'une supposition : chaque bloc cite son commit.
-- Un bloc s'ouvre par une ligne « -- avant <version>_<nom> » et se pose dans une transaction à lui, sous le propriétaire.
--
-- Les objets d'hier que la migration supprime aussitôt sans en lire la forme (les policies « cabinet admins full access »
-- de multi_cabinet_rls, la contrainte lignes_bancaires_un_seul_rapprochement d'avant affectation_des_mouvements_bancaires)
-- ne sont pas ici : `rejouer.py` leur pose une forme provisoire (règle 4), dite à son journal.

-- avant 20261009185236_notes_internes_du_cabinet
-- La note d'un document divers, que cette migration recopie dans `notes_internes` et que P0 (20261106120000) supprime :
-- le socle la portait jusqu'à P0 (`git show 10754fb~1:supabase/schema/socle/1_tables_sans_migration.sql`, table
-- documents_divers : « notes text »).
alter table public.documents_divers add column notes text;

-- avant 20261103114023_sens_des_regles_ignorees
-- La clé unique d'hier des règles « toujours ignorer », que la garde de tête de cette migration exige avant de la
-- remplacer par regles_bancaires_ignorees_unique (même source : « UNIQUE (dossier_id, motif) »).
alter table public.regles_bancaires_ignorees add constraint regles_bancaires_ignorees_dossier_id_motif_key UNIQUE (dossier_id, motif);
