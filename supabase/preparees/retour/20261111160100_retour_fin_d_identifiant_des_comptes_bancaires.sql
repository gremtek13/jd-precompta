-- RETOUR ARRIÈRE de la migration `fin_d_identifiant_des_comptes_bancaires` (ligne 26.6, MCB2) — DESTRUCTIF : il retire la
-- colonne `fin_d_identifiant` de `comptes_bancaires` (les quatre derniers caractères de l'identifiant OFX de chaque compte).
-- Il demande l'accord explicite du cabinet, et se colle dans l'éditeur SQL de Supabase, dans une transaction, AVANT le
-- retour de `comptes_bancaires` s'il faut retirer les deux. Après lui, un OFX ne se confronte plus au compte choisi.
do $garde$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'comptes_bancaires' and column_name = 'fin_d_identifiant') then
    raise exception 'La migration fin_d_identifiant_des_comptes_bancaires n''est pas en base : rien à retirer.';
  end if;
end
$garde$;

alter table public.comptes_bancaires drop column fin_d_identifiant;
