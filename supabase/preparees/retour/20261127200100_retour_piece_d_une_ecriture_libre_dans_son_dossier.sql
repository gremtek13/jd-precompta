-- LE RETOUR DE `piece_d_une_ecriture_libre_dans_son_dossier` (SECU4-Q1, ligne 26.9 ; supabase/preparees/
-- 20261127200000_piece_d_une_ecriture_libre_dans_son_dossier.sql) — À COLLER (ses trois retraits retiennent l'outil), dans une
-- transaction, sur l'accord du cabinet. Il retire la garde et ses deux déclencheurs, rien d'autre ; aucune donnée. C'est un
-- RELÂCHEMENT : la base n'oppose plus rien à une pièce citée par une écriture libre qui changerait de dossier, ni à une
-- écriture libre restaurée qui citerait la pièce d'un autre dossier — `enregistrer_ecriture_libre` seule tient de nouveau la
-- règle, à l'écriture, comme avant la migration. Il se refuse si la fonction n'est plus celle que la migration a posée, ou si
-- ses déclencheurs ne sont plus les siens : rien à défaire sans les relire.

do $garde$
begin
  if to_regprocedure('public.garder_piece_d_une_ecriture_libre()') is null then
    raise exception 'retour_piece_d_une_ecriture_libre_dans_son_dossier : la migration n''est pas en base (ou ce retour est déjà fait) : rien à défaire.';
  end if;
  if (select md5(replace(p.prosrc, chr(13) || chr(10), chr(10))) from pg_proc p
       where p.oid = 'public.garder_piece_d_une_ecriture_libre()'::regprocedure) is distinct from '4a2b0a48cbeb6a6fe85af0c6ac00c571'
     or (select string_agg(t.tgrelid::regclass::text || ':' || t.tgname, ',' order by t.tgname collate "C") from pg_trigger t
          where t.tgfoid = 'public.garder_piece_d_une_ecriture_libre()'::regprocedure)
        is distinct from 'ecritures_libres:ecritures_libres_piece_de_son_dossier,pieces:pieces_citees_par_une_ecriture_libre' then
    raise exception 'retour_piece_d_une_ecriture_libre_dans_son_dossier : la garde n''est plus celle que la migration a posée : rien à défaire sans la relire.';
  end if;
end
$garde$;

drop trigger ecritures_libres_piece_de_son_dossier on public.ecritures_libres;
drop trigger pieces_citees_par_une_ecriture_libre on public.pieces;
drop function public.garder_piece_d_une_ecriture_libre();

do $fin$
begin
  if to_regprocedure('public.garder_piece_d_une_ecriture_libre()') is not null
     or exists (select 1 from pg_trigger t
                 where t.tgname in ('ecritures_libres_piece_de_son_dossier', 'pieces_citees_par_une_ecriture_libre') and not t.tgisinternal) then
    raise exception 'Garde de fin : la garde de la pièce d''une écriture libre est encore en base.';
  end if;
end
$fin$;
