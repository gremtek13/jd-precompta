-- LE RETOUR DE `ni_piece_ni_document_ne_change_de_dossier` (SECU4-Q2 ; supabase/preparees/
-- 20261127230000_ni_piece_ni_document_ne_change_de_dossier.sql) — À COLLER (ses trois retraits retiennent l'outil), dans une
-- transaction, sur l'accord du cabinet. Il retire la garde et ses deux déclencheurs, rien d'autre ; aucune donnée. C'est un
-- RELÂCHEMENT : une pièce ou un document que rien ne cite change de nouveau de dossier par l'API, comme avant la migration ;
-- les gardes relation par relation, qu'elle n'a pas touchées, tiennent seules ce qu'elles tenaient. Il se refuse si la fonction
-- n'est plus celle que la migration a posée, ou si ses déclencheurs ne sont plus les siens : rien à défaire sans les relire.

do $garde$
begin
  if to_regprocedure('public.garder_dossier_de_depot()') is null then
    raise exception 'retour_ni_piece_ni_document_ne_change_de_dossier : la migration n''est pas en base (ou ce retour est déjà fait) : rien à défaire.';
  end if;
  if (select md5(replace(p.prosrc, chr(13) || chr(10), chr(10))) from pg_proc p
       where p.oid = 'public.garder_dossier_de_depot()'::regprocedure) is distinct from 'c8bcd036411fcd5ad6a93f5389e253fd'
     or (select string_agg(t.tgrelid::regclass::text || ':' || t.tgname, ',' order by t.tgname collate "C") from pg_trigger t
          where t.tgfoid = 'public.garder_dossier_de_depot()'::regprocedure)
        is distinct from 'documents_divers:documents_divers_vers_un_autre_dossier,pieces:pieces_vers_un_autre_dossier' then
    raise exception 'retour_ni_piece_ni_document_ne_change_de_dossier : la garde n''est plus celle que la migration a posée : rien à défaire sans la relire.';
  end if;
end
$garde$;

drop trigger documents_divers_vers_un_autre_dossier on public.documents_divers;
drop trigger pieces_vers_un_autre_dossier on public.pieces;
drop function public.garder_dossier_de_depot();

do $fin$
begin
  if to_regprocedure('public.garder_dossier_de_depot()') is not null
     or exists (select 1 from pg_trigger t
                 where t.tgname in ('documents_divers_vers_un_autre_dossier', 'pieces_vers_un_autre_dossier') and not t.tgisinternal) then
    raise exception 'Garde de fin : la garde du dossier d''une pièce ou d''un document est encore en base.';
  end if;
end
$fin$;
