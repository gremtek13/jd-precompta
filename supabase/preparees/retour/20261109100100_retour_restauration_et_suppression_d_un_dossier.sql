-- LE RETOUR DE `restauration_et_suppression_d_un_dossier` (supabase/preparees/20261109100000, RESTAU-Q1 et RESTAU-Q4 ;
-- PRÉPARÉ, comme elle) : il retire la policy d'insertion de la restauration des commentaires et repose la clé de
-- `tiers_categories_cabinet` vers `categories` sans action, sous son nom — rien d'autre, aucune donnée. Un commentaire
-- restauré entre-temps reste ; une restauration qui en porte d'un autre auteur s'arrête de nouveau sur la table, et une
-- règle du cabinet qui vise une catégorie propre d'un dossier en refuse de nouveau la suppression. La relation de
-- `RELATIONS` (src/lib/sauvegarde.ts) repasse à « bloque » dans le même commit que le fichier de l'export. Il se COLLE
-- (ses deux instructions de retrait retiennent l'outil), dans une transaction, sur l'accord du cabinet.

do $garde$
begin
  -- La policy est celle que la migration a posée, et seule de son nom.
  if not exists (select 1 from pg_policy p
                  where p.polrelid = 'public.piece_commentaires'::regclass and p.polname = 'piece_commentaires_restauration'
                    and p.polcmd = 'a' and p.polpermissive
                    and p.polroles = array['authenticated'::regrole]::oid[]
                    and p.polqual is null and pg_get_expr(p.polwithcheck, p.polrelid) = 'is_super_admin()') then
    raise exception 'La policy de restauration des commentaires n''est pas celle que la migration a posée : rien à défaire sans la relire.';
  end if;
  -- La clé est celle que la migration a reposée (cascade, à l'empreinte de sa définition).
  if not exists (select 1 from pg_constraint c
                  where c.conrelid = 'public.tiers_categories_cabinet'::regclass and c.contype = 'f'
                    and c.conname = 'tiers_categories_cabinet_categorie_id_fkey'
                    and c.confrelid = 'public.categories'::regclass and c.confdeltype = 'c'
                    and md5(pg_get_constraintdef(c.oid)) = '4b363fe5d582b627b60fb7a64d1ad1a6') then
    raise exception 'La clé de tiers_categories_cabinet vers categories n''est pas celle que la migration a reposée : rien à défaire sans la relire.';
  end if;
end
$garde$;

drop policy piece_commentaires_restauration on public.piece_commentaires;
alter table public.tiers_categories_cabinet drop constraint tiers_categories_cabinet_categorie_id_fkey;
alter table public.tiers_categories_cabinet add constraint tiers_categories_cabinet_categorie_id_fkey
  foreign key (categorie_id) references public.categories(id);
