-- L'index PARTIEL posé à la création ne peut pas être visé par `ON CONFLICT (dossier_id,
-- source_fichier)` : Postgres exige alors de répéter sa clause WHERE, ce que le client Supabase ne
-- sait pas produire. L'upsert du code aurait donc échoué à chaque import — soit précisément le
-- défaut décrit dans CLAUDE.md (« onConflict ne correspondant à aucun index unique »), qui a déjà
-- fait échouer une écriture en silence pendant des mois dans ce projet.
--
-- Une contrainte unique TOTALE donne exactement la sémantique voulue, sans le piège : deux NULL ne
-- sont jamais égaux en SQL, donc les relevés sans nom de fichier s'empilent librement tandis que les
-- relevés nommés se remplacent.
drop index if exists public.controles_releves_bancaires_fichier_unique;

alter table public.controles_releves_bancaires
  add constraint controles_releves_bancaires_fichier_unique unique (dossier_id, source_fichier);
