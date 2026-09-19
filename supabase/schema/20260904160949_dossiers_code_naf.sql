-- Profession détectée via le code NAF/APE (base SIRENE, recherche-entreprises.api.gouv.fr) à partir
-- du SIRET du dossier. Toujours renseigné en best-effort côté client (voir lib/sirene.ts) — un code
-- NULL veut dire "pas encore détecté", jamais "aucune activité".
alter table dossiers add column code_naf text;
alter table dossiers add column libelle_naf text;
