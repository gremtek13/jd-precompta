-- Le texte lu par l'OCR sur une pièce, conservé.
--
-- Il était déjà calculé à chaque extraction — c'est lui qui sert à classer le document, à retrouver
-- une date et à rattraper une TVA — mais il était jeté aussitôt après. L'opérateur qui arbitre
-- « BOULANGER MARSEILLE, 199,99 € » n'a donc aucun moyen de savoir ce qui a été acheté, alors que la
-- réponse était sous ses yeux à l'extraction : « FOUR MICRO-ONDES ».
--
-- Table à part et non colonne de `pieces`, pour une raison de performance mesurable : plusieurs
-- écrans font `select('*')` sur les pièces d'un dossier, et un texte OCR pèse volontiers des
-- kilo-octets par ligne. Ajouté à `pieces`, il serait rapatrié en entier à chaque ouverture d'onglet,
-- sur un écran que le cabinet ouvre toute la journée et que le client ouvre au téléphone. Ici il ne
-- se charge que lorsqu'on le demande.
--
-- `piece_id` en clé primaire : un texte par pièce, remplacé s'il est relu, jamais accumulé.
create table if not exists public.piece_textes_ocr (
  piece_id uuid primary key references public.pieces(id) on delete cascade,
  -- Porté en propre pour que la policy n'ait pas à joindre `pieces` — c'est la convention du schéma.
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  -- Les lignes telles que Textract les rend, dans l'ordre de lecture, séparées par des retours à la
  -- ligne. Aucun nettoyage : ce qui est montré doit être ce qui a été lu, sinon on ne peut plus
  -- diagnostiquer une extraction douteuse avec.
  texte text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists piece_textes_ocr_dossier_idx on public.piece_textes_ocr(dossier_id);

alter table public.piece_textes_ocr enable row level security;

-- Lecture : le cabinet sur ses dossiers, le client sur le sien — c'est le texte de SON document,
-- rien qu'il ne puisse relire en ouvrant le fichier qu'il a lui-même envoyé.
create policy piece_textes_ocr_select on public.piece_textes_ocr
  for select using (
    admin_du_dossier(dossier_id)
    or exists (select 1 from public.memberships m where m.dossier_id = piece_textes_ocr.dossier_id and m.user_id = auth.uid())
  );

-- Écriture : par le cabinet, et par le client au moment où il dépose — c'est le même pipeline
-- d'extraction des deux côtés (voir lib/depot.ts et lib/importFichiers.ts). La pièce visée doit
-- appartenir au dossier annoncé, sans quoi le `dossier_id` porté en propre serait une porte ouverte.
create policy piece_textes_ocr_insert on public.piece_textes_ocr
  for insert with check (
    (
      admin_du_dossier(dossier_id)
      or exists (select 1 from public.memberships m where m.dossier_id = piece_textes_ocr.dossier_id and m.user_id = auth.uid())
    )
    and exists (select 1 from public.pieces p where p.id = piece_id and p.dossier_id = piece_textes_ocr.dossier_id)
  );

-- Relecture d'un document déjà déposé : réservée au cabinet. Le client dépose, il ne rejoue pas une
-- extraction sur une pièce que le cabinet a peut-être déjà relue et corrigée.
create policy piece_textes_ocr_update on public.piece_textes_ocr
  for update using (admin_du_dossier(dossier_id)) with check (admin_du_dossier(dossier_id));

create policy piece_textes_ocr_delete on public.piece_textes_ocr
  for delete using (admin_du_dossier(dossier_id));
