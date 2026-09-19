-- Empreinte du TEXTE lu, à côté de l'empreinte du FICHIER (pieces.storage_hash).
--
-- Pourquoi les deux ne font pas double emploi : deux exports du même document — repris d'un portail
-- fournisseur, réimprimé en PDF, rescanné — ont des octets différents et la même substance. Le
-- SHA-256 du fichier est aveugle à ce doublon-là par construction, et c'est celui qu'on rencontre.
-- Mesuré sur le dossier `test` : « mai.pdf » et « juin.pdf » ont deux empreintes de fichier
-- distinctes et EXACTEMENT le même texte OCR (1 400 caractères).
--
-- Colonne GÉNÉRÉE, jamais écrite par l'application : une empreinte qu'un appelant pourrait oublier
-- de mettre à jour finirait par désigner un texte qui n'existe plus. Postgres la recalcule à chaque
-- écriture du texte, donc elle ne peut pas dériver.
--
-- Les espaces sont normalisés avant l'empreinte : l'OCR ne recolle pas toujours les blancs de la
-- même façon d'un passage à l'autre, et deux lectures du même document ne doivent pas se retrouver
-- différentes pour un saut de ligne. C'est la même précaution que `normaliser` côté appariement.
alter table public.piece_textes_ocr
  add column if not exists texte_md5 text
  generated always as (md5(regexp_replace(trim(texte), '\s+', ' ', 'g'))) stored;

-- Index par dossier : la recherche de doublons se fait toujours à l'intérieur d'un dossier, jamais
-- entre clients — deux cabinets peuvent parfaitement recevoir la même facture d'un même opérateur.
create index if not exists piece_textes_ocr_dossier_texte_md5_idx
  on public.piece_textes_ocr (dossier_id, texte_md5);

comment on column public.piece_textes_ocr.texte_md5 is
  'Empreinte du texte lu, espaces normalisés. Sert à repérer un même document déposé deux fois sous deux fichiers différents — ce que le SHA-256 du fichier ne peut pas voir.';
