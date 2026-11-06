-- RETOUR ARRIÈRE DE `anciennes_notes_supprimees` (espace client, étape P0, EC-Q7). La migration :
-- supabase/preparees/20261106120000_anciennes_notes_supprimees.sql ; le récit : HISTORIQUE.md, « 06/11/2026 — LES
-- ANCIENNES COLONNES DES NOTES SUPPRIMÉES (P0, EC-Q7) (PRÉPARÉE, PAS APPLIQUÉE) ».
--
-- CE QU'IL REND : les trois colonnes, `pieces.notes`, `documents_divers.notes` et `dossiers.notes`, en `text`, NULLES ET
-- VIDES. Il ne rend PAS les notes : elles vivent dans `notes_internes`, que le cabinet seul lit, et les recopier dans une
-- table que le client du dossier lit défairait l'étape P0 ; la copie figée du 09/10/2026 est perdue avec la migration.
-- Les colonnes reviennent en fin de table, à un autre rang, qu'aucun des contrôles ne compte : sur la réplique du
-- 06/11/2026, les neuf familles de `signature.sql` reviennent à leurs empreintes d'avant la migration. Il ne retire rien
-- et ne réécrit aucune fonction (`garder_piece_validee` n'a pas été touchée) : il peut passer par `apply_migration`.
--
-- SA GARDE : aucune des trois colonnes n'est en base — sinon il refuse : la migration n'est pas appliquée, ou ce retour
-- est déjà fait. Après lui : `notesInternes.sql` rejoue ses contrôles 1 à 4 d'hier (aucune note ancienne, rien à
-- recopier), et le fichier de la migration sort de l'export avec sa ligne d'historique ; les trois contrôles.

lock table public.pieces, public.documents_divers, public.dossiers in access exclusive mode;

do $garde$
declare
  v_colonnes integer;
begin
  select count(*) into v_colonnes
    from pg_attribute a
   where a.attrelid in ('public.pieces'::regclass, 'public.documents_divers'::regclass, 'public.dossiers'::regclass)
     and a.attname = 'notes' and a.attnum > 0 and not a.attisdropped;
  if v_colonnes <> 0 then
    raise exception 'Une ancienne colonne des notes est encore en base (% sur 3) : la migration anciennes_notes_supprimees n''est pas appliquée, ou ce retour est déjà fait. Rien n''est ajouté.',
      v_colonnes using errcode = '23514';
  end if;
end;
$garde$;

alter table public.pieces add column notes text;
alter table public.documents_divers add column notes text;
alter table public.dossiers add column notes text;
