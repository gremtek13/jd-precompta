-- RETOUR DE `fichier_cite_par_une_ecriture_libre` (supabase/schema/20261126065131_fichier_cite_par_une_ecriture_libre.sql, en
-- production depuis le 26/11/2026, 254 ; le retour reste PRÉPARÉ) :
-- `fichier_fige` reprend son corps de production d'avant (INAL1, 5372f8d2…) et son commentaire, au caractère près. Rien d'autre
-- n'avait changé : aucune donnée, aucune policy, aucun droit (`create or replace` les garde). Après lui, le fichier d'une pièce
-- qu'une écriture libre cite se retire de nouveau par l'API du stockage, comme avant la migration. Il refuse après INV3
-- (`validation_de_l_inventaire`), qui remplace `fichier_fige` en gardant cette condition : le retour d'INV3 d'abord.
--
-- LA VOIE : le commentaire d'hier nomme la policy de suppression du seau des pièces par son nom, qui porte le mot que l'outil
-- d'application retient : ce retour SE COLLE dans l'éditeur SQL de Supabase, dans une transaction, sur l'accord du cabinet. Ni
-- barre oblique inverse ni retour chariot.

-- ══ 0. La garde : le corps que la migration a posé, ou rien ══════════
do $garde$
begin
  if to_regprocedure('public.fichier_fige(text)') is null
     or md5(replace((select p.prosrc from pg_proc p where p.oid = 'public.fichier_fige(text)'::regprocedure), chr(13), ''))
        is distinct from '5e7016c08bcdda1190d6e56202661113' then
    raise exception 'fichier_fige n''est pas celle que la migration fichier_cite_par_une_ecriture_libre a posée : rien à défaire, ou relire la base.';
  end if;
end
$garde$;

-- ══ 1. Le corps et le commentaire d'hier ══════════
create or replace function public.fichier_fige(p_chemin text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Le dossier que le chemin nomme se tire après la forme du chemin, dans cet ordre (`case` n'évalue une branche qu'à son
  -- tour) : un chemin mal formé ne fait rien lever.
  select case
    when p_chemin is null then null
    when p_chemin !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' then null
    when not public.admin_du_dossier(split_part(p_chemin, '/', 1)::uuid) then null
    else exists (
        select 1 from public.pieces p
         where (p.storage_path = p_chemin or p.lisible_path = p_chemin)
           and (public.exercice_figeant_la_piece(p.id) is not null
                or exists (select 1 from public.revision_preuves r where r.piece_id = p.id)
                or exists (select 1 from public.dossier_permanent d where d.piece_id = p.id)))
      or exists (
        select 1 from public.documents_divers dd
         where dd.storage_path = p_chemin
           and (exists (select 1 from public.revision_preuves r where r.document_id = dd.id)
                or exists (select 1 from public.dossier_permanent d where d.document_id = dd.id)))
  end
$$;

comment on function public.fichier_fige(text) is
  'Vrai quand le chemin est le fichier (ou la version lisible) d''une pièce que la base fige — une écriture validée la cite, directement ou par son bien immobilisé, ou la révision la cite — ou le fichier d''un document divers que la révision cite ; nul pour qui n''administre pas le dossier du chemin, et pour un chemin qui ne commence pas par un dossier. La policy pieces_storage_delete refuse la suppression d''un tel fichier (INAL1, ligne 44).';

-- ══ 2. La garde de fin : le corps de production d'hier, sa forme et ses droits ══════════
do $fin$
begin
  if md5(replace((select p.prosrc from pg_proc p where p.oid = 'public.fichier_fige(text)'::regprocedure), chr(13), ''))
       is distinct from '5372f8d248432f0932598a6efca24ca2'
     or not (select p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=public']
               from pg_proc p where p.oid = 'public.fichier_fige(text)'::regprocedure)
     or has_function_privilege('anon', 'public.fichier_fige(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.fichier_fige(text)', 'execute') then
    raise exception 'Garde de fin : fichier_fige n''a pas repris le corps, la forme ou les droits d''hier.';
  end if;
end
$fin$;
