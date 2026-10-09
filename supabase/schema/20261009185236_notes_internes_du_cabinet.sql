-- LES NOTES INTERNES DU CABINET, HORS DE PORTÉE DU CLIENT (espace client, étape P0 ; conception du 09/10/2026,
-- HISTORIQUE.md, « L'ESPACE CLIENT DEVIENT LE LOGICIEL DE GESTION DU CLIENT : LA CONCEPTION », §1.2 et §3.6).
--
-- LE DÉFAUT. Les « Notes internes » de la fiche d'une pièce vivaient dans `pieces.notes`, une colonne de la table que le
-- client du dossier LIT (policy `pieces_select` : `admin_du_dossier`, ou un accès `memberships`) : aucun écran ne les lui
-- montrait, mais son navigateur les recevait à chaque lecture de ses pièces (`select('*')`). De même pour
-- `documents_divers.notes`. La restriction tenait à l'écran, pas à la base. Et la policy d'insertion d'une pièce ne
-- borne pas cette colonne : un client pouvait déposer une pièce portant déjà une « note interne » que le cabinet aurait
-- lue comme la sienne. Mesuré le 09/10/2026 (des comptes, jamais un texte) : 11 pièces annotées (10 dans `test`, 1 dans
-- un bac à sable) et 7 documents (dans `test`, la trace d'un reclassement fait hors de l'application le 17/09/2026),
-- aucune dans un dossier qui a un accès client — LATENT.
--
-- CE QUE CETTE MIGRATION POSE. Une table que le cabinet SEUL lit et écrit : une note par pièce ou par document, au
-- plus, sous la convention `admin_du_dossier(dossier_id)` et `to authenticated` — aucun prédicat vrai sans session,
-- aucune branche pour un accès client, pas même sur son propre dossier. Les notes existantes y sont RECOPIÉES, telles
-- qu'écrites ; la recopie se rejoue sans doublon. Les anciennes colonnes ne sont ni vidées ni retirées : c'est une
-- perte de données, qui attend l'accord du cabinet (question EC-Q7) ; d'ici là elles restent lisibles par le client,
-- et plus aucun code de l'application ne les lit ni ne les écrit (`src/lib/notesInternesEcritures.test.ts`).
-- `dossiers.notes` n'a rien à recopier : aucune ligne, et aucun code ne l'a jamais écrite.
--
-- Sources : règlement (UE) 2016/679, art. 5 § 1 f) (intégrité et confidentialité) et art. 32 § 1 b) ; la règle du
-- projet, « un texte du cabinet seul ne se range jamais dans une table que le client lit » (CLAUDE.md).

create table public.notes_internes (
  id uuid primary key default gen_random_uuid(),
  -- Porté en propre, comme `piece_textes_ocr` : la policy n'a pas à joindre la cible pour savoir qui lit.
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  -- La note part avec sa pièce ou son document, comme elle partait avec la colonne qui la portait.
  piece_id uuid references public.pieces (id) on delete cascade,
  document_id uuid references public.documents_divers (id) on delete cascade,
  -- Effacée à l'écran, une note reste une ligne au texte vide — l'écran ne la retire jamais — et garde la trace de sa
  -- dernière modification, qui distinguera, avant de retirer les anciennes colonnes, une note reprise ici d'une note
  -- écrite après la recopie dans l'ancienne colonne par un onglet resté ouvert sur l'application d'avant.
  texte text not null,
  created_at timestamptz not null default now(),
  -- Posée par la base à chaque modification (`horodater_note_interne`), jamais par l'écran, dont l'horloge peut mentir.
  -- Égale à `created_at` tant que personne n'a repris la note.
  updated_at timestamptz not null default now(),
  constraint notes_internes_une_seule_cible check (num_nonnulls(piece_id, document_id) = 1),
  -- Uniques TOTALES (deux NULL ne se heurtent pas) : l'écran écrit par un upsert sur sa cible, et un index unique
  -- partiel ne peut pas être visé par `on conflict` (CLAUDE.md).
  constraint notes_internes_piece_unique unique (piece_id),
  constraint notes_internes_document_unique unique (document_id)
);

create index notes_internes_dossier on public.notes_internes (dossier_id);

create function public.horodater_note_interne() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger notes_internes_horodatage
  before update on public.notes_internes
  for each row execute function public.horodater_note_interne();

revoke execute on function public.horodater_note_interne() from public, anon, authenticated;

-- ══ Qui lit, qui écrit ══════════
-- Le cabinet du dossier, et personne d'autre. La cible doit appartenir au dossier annoncé : sans quoi un `dossier_id`
-- porté en propre serait une porte ouverte — la note d'une pièce d'un autre dossier, lisible ici, et sa place prise
-- là-bas par la contrainte unique.
alter table public.notes_internes enable row level security;

create policy notes_internes_cabinet on public.notes_internes
  for all to authenticated
  using (admin_du_dossier(dossier_id))
  with check (
    admin_du_dossier(dossier_id)
    and (
      (piece_id is not null and exists (
        select 1 from public.pieces p where p.id = notes_internes.piece_id and p.dossier_id = notes_internes.dossier_id))
      or (document_id is not null and exists (
        select 1 from public.documents_divers d where d.id = notes_internes.document_id and d.dossier_id = notes_internes.dossier_id))
    )
  );

-- ══ La recopie ══════════
-- Le texte tel qu'il est écrit ; une note blanche n'en est pas une. `where not exists` la rend rejouable sans doublon
-- (la contrainte unique la refuserait de toute façon).
insert into public.notes_internes (dossier_id, piece_id, texte)
select p.dossier_id, p.id, p.notes
from public.pieces p
where p.notes is not null and btrim(p.notes, E' \t\n\r') <> ''
  and not exists (select 1 from public.notes_internes n where n.piece_id = p.id);

insert into public.notes_internes (dossier_id, document_id, texte)
select d.dossier_id, d.id, d.notes
from public.documents_divers d
where d.notes is not null and btrim(d.notes, E' \t\n\r') <> ''
  and not exists (select 1 from public.notes_internes n where n.document_id = d.id);

comment on table public.notes_internes is
  'Les notes internes du cabinet sur une pièce ou un document : le cabinet du dossier seul les lit et les écrit (espace client, étape P0, 09/10/2026).';
comment on function public.horodater_note_interne() is
  'Pose updated_at à chaque modification d''une note interne : la date vient de la base, pas de l''écran.';
