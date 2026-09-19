-- Commentaires portés sur une pièce ou un document déposé.
--
-- Le besoin : le client est le seul à savoir POURQUOI une dépense a été faite. L'OCR lit « BOULANGER
-- MARSEILLE, 199,99 € » mais ne dira jamais si c'est le four de la salle d'attente ou un cadeau.
-- Personne au cabinet ne peut le reconstituer deux mois plus tard ; le client le sait à la seconde
-- où il prend la photo.
--
-- Table séparée plutôt que `pieces.notes`, pour trois raisons qui tiennent chacune seule :
--   1. le client n'a PAS le droit de modifier une pièce (RLS : update réservé au cabinet), et le lui
--      donner pour un commentaire ouvrirait aussi les montants et les dates ;
--   2. un commentaire est une déclaration datée, faite par quelqu'un. « Le client dit que c'est le
--      four de la salle d'attente » et « l'opérateur suppose que c'est du matériel » n'ont pas le même
--      poids devant un contrôle. Un champ texte unique perd l'auteur, la date, et écrase le précédent ;
--   3. l'échange est une conversation : le client dépose et commente, l'opérateur rappelle et ajoute.
create table if not exists public.piece_commentaires (
  id uuid primary key default gen_random_uuid(),
  -- Porté en propre plutôt que déduit par jointure : c'est la clé de toutes les policies ci-dessous,
  -- et le WITH CHECK vérifie qu'il correspond bien à celui de la cible.
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  piece_id uuid references public.pieces(id) on delete cascade,
  document_id uuid references public.documents_divers(id) on delete cascade,
  auteur_id uuid references auth.users(id) on delete set null,
  -- Figé à l'écriture, jamais recalculé à la lecture : le rôle d'un auteur peut changer, ce qu'il
  -- était au moment où il a écrit ne change pas. La policy d'insertion garantit sa véracité.
  origine text not null check (origine in ('client', 'cabinet')),
  texte text not null check (length(btrim(texte)) > 0),
  created_at timestamptz not null default now(),
  -- Un commentaire porte sur une pièce OU un document, jamais sur les deux ni sur rien. Un CSV de
  -- relevé atterrit en documents_divers : sans cette branche, le commentaire « il manque octobre »
  -- serait perdu en silence.
  constraint commentaire_porte_sur_une_seule_cible check (num_nonnulls(piece_id, document_id) = 1)
);

create index if not exists piece_commentaires_piece_idx on public.piece_commentaires(piece_id) where piece_id is not null;
create index if not exists piece_commentaires_document_idx on public.piece_commentaires(document_id) where document_id is not null;
create index if not exists piece_commentaires_dossier_idx on public.piece_commentaires(dossier_id);

alter table public.piece_commentaires enable row level security;

-- Lecture : le cabinet sur ses dossiers, le client sur le sien. Le client relit donc ce que le
-- cabinet a noté — c'est voulu : rien ici ne doit être écrit qu'on ne lui montrerait pas.
create policy piece_commentaires_select on public.piece_commentaires
  for select using (
    admin_du_dossier(dossier_id)
    or exists (select 1 from public.memberships m where m.dossier_id = piece_commentaires.dossier_id and m.user_id = auth.uid())
  );

-- Écriture : l'auteur est forcément celui qui écrit, et `origine` est entièrement déterminée par son
-- droit sur le dossier — un client ne peut pas signer « cabinet ». La cible doit appartenir au même
-- dossier, sans quoi le dossier_id porté en propre serait une porte ouverte.
create policy piece_commentaires_insert on public.piece_commentaires
  for insert with check (
    auteur_id = auth.uid()
    and (origine = 'cabinet') = admin_du_dossier(dossier_id)
    and (
      admin_du_dossier(dossier_id)
      or exists (select 1 from public.memberships m where m.dossier_id = piece_commentaires.dossier_id and m.user_id = auth.uid())
    )
    and (
      (piece_id is not null and exists (
        select 1 from public.pieces p where p.id = piece_id and p.dossier_id = piece_commentaires.dossier_id))
      or (document_id is not null and exists (
        select 1 from public.documents_divers d where d.id = document_id and d.dossier_id = piece_commentaires.dossier_id))
    )
  );

-- Pas de policy UPDATE, pour personne. Un commentaire est une déclaration faite à un moment ; la
-- réécrire après coup lui retire toute valeur de preuve. On se corrige en ajoutant, pas en effaçant.

-- Suppression réservée au cabinet, pour retirer un commentaire manifestement à côté — pas pour
-- réécrire l'histoire.
create policy piece_commentaires_delete on public.piece_commentaires
  for delete using (admin_du_dossier(dossier_id));
