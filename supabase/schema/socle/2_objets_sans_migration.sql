-- LES SIX COLONNES ET LES CINQ OBJETS QUE NI LES MIGRATIONS NI LES DOUZE TABLES DU SOCLE NE CRÉENT.
--
-- ── CE QUE CE FICHIER RÉPARE ──
--
-- `1_tables_sans_migration.sql` comble les TABLES créées hors `apply_migration`. Il ne voyait pas ce
-- qui a été ajouté hors `apply_migration` à une table que les migrations CRÉENT bien : la table est
-- dans l'export, une partie d'elle ne l'est pas. Mesuré le 29/09/2026 en confrontant, nom par nom,
-- tout le catalogue à ce que l'export reconstruit (`supabase/essais/inventaire.py`) : 751 objets dans
-- la base, 740 dans l'export, et les onze qui manquent sont ceux-ci —
--
--   - `categories.compte_comptable` et `categories.poste_2035`, les deux portes par lesquelles une
--     pièce devient une écriture puis une ligne de la 2035 ;
--   - `pieces.storage_hash` et son index : l'empreinte SHA-256 du dédoublonnage et de la piste
--     d'audit ;
--   - `dossiers.assujetti_tva`, qui décide du montant retenu de chaque pièce ;
--   - `dossiers.code_email`, sa contrainte unique, la fonction qui le fabrique et son déclencheur :
--     l'adresse de collecte par e-mail de chaque dossier ;
--   - `pieces.sous_dossier_id` et sa clé étrangère.
--
-- Un schéma reconstruit sans eux n'aurait pas « l'air incomplet » : il aurait l'air juste, et la
-- première restauration de sauvegarde échouerait sur une colonne inconnue.
--
-- ── CE QUE CE FICHIER EST ──
--
-- Le rendu exact du catalogue au 29/09/2026 (`format_type`, `pg_get_constraintdef`,
-- `pg_get_indexdef`, `pg_get_functiondef`, `pg_get_triggerdef`), pas une réécriture. Il s'éprouve avec
-- le socle entier par `supabase/essais/socle.sql` et `socle.py`, au caractère près — à une conversion
-- près, dite : le corps de `generate_code_email` est enregistré en base avec des fins de ligne
-- Windows (`\r\n`), écrites ici en `\n`. Pour une fonction plpgsql la différence est sans effet, et un
-- retour chariot dans un fichier du dépôt ne survivrait pas au premier éditeur.
--
-- ── ORDRE ──
--
-- Après `1_tables_sans_migration.sql` : la clé étrangère vise `sous_dossiers`, que seul ce fichier
-- crée. Et la fonction doit exister avant la migration `20260905064432`, qui en change le
-- `search_path` — l'ordre « migrations puis socle » ne tient donc pas, et ce n'est pas le seul
-- endroit : voir PLAN_DE_REPRISE.md, §4.

alter table public.categories add column compte_comptable text;

alter table public.categories add column poste_2035 text;

alter table public.dossiers add column assujetti_tva boolean default false not null;

alter table public.dossiers add column code_email text not null;

alter table public.pieces add column sous_dossier_id uuid;

alter table public.pieces add column storage_hash text;

CREATE OR REPLACE FUNCTION public.generate_code_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.code_email is null then
    new.code_email := lower(regexp_replace(coalesce(new.nom, 'dossier'), '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(new.id::text, 1, 6);
  end if;
  return new;
end;
$function$;

CREATE TRIGGER trg_generate_code_email BEFORE INSERT ON public.dossiers FOR EACH ROW EXECUTE FUNCTION generate_code_email();

alter table public.dossiers add constraint dossiers_code_email_key UNIQUE (code_email);

alter table public.pieces add constraint pieces_sous_dossier_id_fkey FOREIGN KEY (sous_dossier_id) REFERENCES sous_dossiers(id) ON DELETE SET NULL;

CREATE INDEX pieces_dossier_hash_idx ON public.pieces USING btree (dossier_id, storage_hash);
