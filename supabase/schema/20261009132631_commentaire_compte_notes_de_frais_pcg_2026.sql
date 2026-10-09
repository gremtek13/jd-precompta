-- Le commentaire de `dossiers.compte_notes_de_frais` nommait le 467 sous son intitulé du plan comptable de 2019
-- (« autres comptes débiteurs ou créditeurs »). Le plan comptable général consolidé au 1er janvier 2026 (règlement ANC
-- n° 2014-03, art. 1121-1) l'intitule « Divers comptes débiteurs et produits à recevoir », comme l'application depuis
-- ce jour (`LIBELLES_COMPTES`, `COMPTES_NOTES_DE_FRAIS`). Le sens ne change pas : le 467 reste le compte du dirigeant
-- qui n'est pas associé.
comment on column public.dossiers.compte_notes_de_frais is
  'En engagement, le compte crédité par une note de frais payée par le dirigeant : 455 compte courant d''associé (dirigeant associé d''une société), 108 compte de l''exploitant (entreprise individuelle), 467 divers comptes débiteurs et produits à recevoir (personne non associée, ou aucun compte plus spécifique).';
