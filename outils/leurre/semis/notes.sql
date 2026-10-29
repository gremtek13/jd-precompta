-- LE JEU DE DÉPART DE notesInternes.sql (outils/leurre/banc.py, famille « notes » ; SUR UNE RÉPLIQUE SEULEMENT, par le
-- super-utilisateur) : la production en porte un dans le dossier `test` (des notes de pièces), la réplique aucun. Dans
-- `test`, deux pièces annotées (l'ancienne colonne et sa ligne de notes_internes, comme la recopie de l'étape P0 les a
-- laissées) et une pièce sans note ; un document annoté et un sans note. Données FICTIVES.
\set ON_ERROR_STOP on
begin;
set local session_replication_role = replica;
insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut, date_piece, montant_ttc, notes) values
  ('5e5e0000-0000-4000-8000-0000000000a1', '001c7ed7-c23b-4590-901e-693489f8af24', '001c7ed7-c23b-4590-901e-693489f8af24/essai-note-1.pdf',
   'essai-note-1.pdf', 'achat', 'a_valider', '2026-02-01', 10, 'Note fictive de la pièce un'),
  ('5e5e0000-0000-4000-8000-0000000000a2', '001c7ed7-c23b-4590-901e-693489f8af24', '001c7ed7-c23b-4590-901e-693489f8af24/essai-note-2.pdf',
   'essai-note-2.pdf', 'achat', 'a_valider', '2026-02-02', 20, 'Note fictive de la pièce deux'),
  ('5e5e0000-0000-4000-8000-0000000000a3', '001c7ed7-c23b-4590-901e-693489f8af24', '001c7ed7-c23b-4590-901e-693489f8af24/essai-note-3.pdf',
   'essai-note-3.pdf', 'achat', 'a_valider', '2026-02-03', 30, null);
insert into documents_divers (id, dossier_id, storage_path, nom_fichier, categorie, notes) values
  ('5e5e0000-0000-4000-8000-0000000000d1', '001c7ed7-c23b-4590-901e-693489f8af24', '001c7ed7-c23b-4590-901e-693489f8af24/essai-doc-1.pdf',
   'essai-doc-1.pdf', 'autre', 'Note fictive du document'),
  ('5e5e0000-0000-4000-8000-0000000000d2', '001c7ed7-c23b-4590-901e-693489f8af24', '001c7ed7-c23b-4590-901e-693489f8af24/essai-doc-2.pdf',
   'essai-doc-2.pdf', 'autre', null);
insert into notes_internes (dossier_id, piece_id, document_id, texte) values
  ('001c7ed7-c23b-4590-901e-693489f8af24', '5e5e0000-0000-4000-8000-0000000000a1', null, 'Note fictive de la pièce un'),
  ('001c7ed7-c23b-4590-901e-693489f8af24', '5e5e0000-0000-4000-8000-0000000000a2', null, 'Note fictive de la pièce deux'),
  ('001c7ed7-c23b-4590-901e-693489f8af24', null, '5e5e0000-0000-4000-8000-0000000000d1', 'Note fictive du document');
select 'semis des notes', count(*) from notes_internes where dossier_id = '001c7ed7-c23b-4590-901e-693489f8af24';
commit;
