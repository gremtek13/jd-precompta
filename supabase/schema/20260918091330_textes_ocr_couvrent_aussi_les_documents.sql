-- Le texte lu par Textract n'était conservé que pour les PIÈCES. Il est pourtant extrait — et
-- facturé — sur tous les fichiers, y compris ceux qui partent dans l'archive Documents : relevés
-- bancaires, appels de cotisation, attestations, relevés d'activité. Il était donc calculé puis jeté
-- pour 67 documents, dont les SNIR qui portent les honoraires de l'année.
--
-- Pire : déplacer une pièce vers Documents supprimait la ligne `pieces`, et le texte partait en
-- cascade avec elle. Les trois SNIR du dossier de test ont perdu le leur de cette façon.
--
-- La table garde son nom (`piece_textes_ocr`) pour ne pas casser le code existant ; elle couvre
-- désormais les deux cibles, exactement comme `lignes_bancaires` porte `piece_id` XOR `cotisation_id`.

-- 1. Une clé primaire de substitution : `piece_id` doit pouvoir être nul.
alter table public.piece_textes_ocr drop constraint piece_textes_ocr_pkey;
alter table public.piece_textes_ocr add column id uuid primary key default gen_random_uuid();
alter table public.piece_textes_ocr alter column piece_id drop not null;

alter table public.piece_textes_ocr
  add column document_id uuid references public.documents_divers(id) on delete cascade;

-- 2. Exactement une cible, jamais deux ni zéro — sans quoi un texte flotterait sans rattachement.
alter table public.piece_textes_ocr
  add constraint piece_textes_ocr_une_seule_cible
  check ((piece_id is not null) <> (document_id is not null));

-- 3. Contraintes uniques TOTALES, et non des index partiels : un index partiel ne peut pas être visé
-- par `ON CONFLICT`, et `enregistrerTexteOcr` fait un upsert (une relecture doit REMPLACER le texte,
-- pas en empiler un second). Une contrainte unique sur une colonne nullable laisse passer autant de
-- NULL qu'on veut tout en dédoublonnant les valeurs réelles : c'est exactement ce qu'il faut ici.
alter table public.piece_textes_ocr add constraint piece_textes_ocr_piece_unique unique (piece_id);
alter table public.piece_textes_ocr add constraint piece_textes_ocr_document_unique unique (document_id);

-- 4. Les policies couvrent les deux cibles. La garantie essentielle est conservée telle quelle : la
-- cible doit appartenir au dossier annoncé, sinon un `dossier_id` porté en propre serait une porte
-- ouverte (voir la note sur `piece_commentaires` dans CLAUDE.md). Le client (membership) peut écrire,
-- parce que c'est son dépôt qui produit le texte.
drop policy piece_textes_ocr_insert on public.piece_textes_ocr;
create policy piece_textes_ocr_insert on public.piece_textes_ocr
  for insert with check (
    (
      admin_du_dossier(dossier_id)
      or exists (select 1 from memberships m where m.dossier_id = piece_textes_ocr.dossier_id and m.user_id = auth.uid())
    )
    and (
      (piece_id is not null and exists (
        select 1 from pieces p where p.id = piece_textes_ocr.piece_id and p.dossier_id = piece_textes_ocr.dossier_id))
      or
      (document_id is not null and exists (
        select 1 from documents_divers d where d.id = piece_textes_ocr.document_id and d.dossier_id = piece_textes_ocr.dossier_id))
    )
  );
