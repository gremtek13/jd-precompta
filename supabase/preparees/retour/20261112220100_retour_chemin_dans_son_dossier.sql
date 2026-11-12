-- RETOUR DE 20261112220000_chemin_dans_son_dossier (CFCS-Q1, ligne 44) — À COLLER (son texte porte le mot qui retient
-- l'outil), et seulement sur l'accord du cabinet : il ne détruit aucune ligne, mais il RETIRE une garde — la base accepte
-- de nouveau qu'une pièce ou un document nomme le fichier d'un autre dossier. Ce qu'il rend : la base d'avant la
-- migration ; seuls les écrans du cabinet (src/lib/cheminDuDossier.ts) vérifient alors le chemin d'une ligne.

do $garde$
begin
  if (select count(*) from pg_constraint c
       where c.conname in ('pieces_storage_path_dans_son_dossier', 'pieces_lisible_path_dans_son_dossier',
                           'documents_divers_storage_path_dans_son_dossier')) <> 3 then
    raise exception 'retour_chemin_dans_son_dossier : la migration chemin_dans_son_dossier n''est pas en base, ou pas entière.';
  end if;
end
$garde$;

alter table public.pieces
  drop constraint pieces_storage_path_dans_son_dossier,
  drop constraint pieces_lisible_path_dans_son_dossier;
alter table public.documents_divers
  drop constraint documents_divers_storage_path_dans_son_dossier;
