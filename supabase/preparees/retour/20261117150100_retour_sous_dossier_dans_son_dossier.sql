-- RETOUR DE `sous_dossier_dans_son_dossier` (DOCF-Q1-B, supabase/schema/20261127055603_sous_dossier_dans_son_dossier.sql) —
-- À COLLER par le cabinet dans l'éditeur SQL de Supabase, dans une transaction : il retire des déclencheurs et des fonctions,
-- ce que l'outil d'application retient. Il rend la base d'avant : la clé étrangère simple de chaque colonne juge seule,
-- comme hier ; aucune donnée ne bouge. Le module (`SOUS_DOSSIER_DANS_SON_DOSSIER_PREVU`) se baisse AVANT lui.
--
-- La garde : les deux corps sont ceux de la migration (un corps remplacé depuis ne se retire pas en aveugle).
do $garde$
begin
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_catalog.pg_proc p
       where p.oid = to_regprocedure('public.garder_sous_dossier_dans_son_dossier()')) is distinct from '073351b7e13f417c36f31e7bb5c8d1ae'
     or (select md5(replace(p.prosrc, chr(13), '')) from pg_catalog.pg_proc p
          where p.oid = to_regprocedure('public.garder_sous_dossier_occupe()')) is distinct from 'e8c38ce6aa01cab7dfcb85bb242b7569' then
    raise exception 'Retour de DOCF-Q1-B : les deux gardes ne sont pas celles de la migration (absentes ou remplacées) : rien n''est retiré.';
  end if;
end
$garde$;

drop trigger documents_divers_au_sous_dossier_de_leur_dossier on public.documents_divers;
drop trigger pieces_au_sous_dossier_de_leur_dossier on public.pieces;
drop trigger sous_dossiers_occupes_restent_dans_leur_dossier on public.sous_dossiers;
drop function public.garder_sous_dossier_dans_son_dossier();
drop function public.garder_sous_dossier_occupe();
