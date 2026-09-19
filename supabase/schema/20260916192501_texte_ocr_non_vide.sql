-- Un texte vide n'est pas un texte : Textract n'a rien lu (photo floue, page blanche, PDF d'images
-- sans couche texte). L'enregistrer ferait croire à l'écran que le document a été lu et qu'il ne
-- contient rien, alors que le vrai message est « la lecture a échoué » — et la ligne d'arbitrage
-- proposerait « texte lu » pour n'afficher qu'un cadre vide.
--
-- L'application l'écarte déjà (texteOcrExploitable), mais la même règle existe en base pour
-- `piece_commentaires` : une garantie portée par le schéma ne dépend pas de l'appelant.
alter table public.piece_textes_ocr
  add constraint piece_textes_ocr_texte_non_vide check (length(btrim(texte)) > 0);
