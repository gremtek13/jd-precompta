-- LE RETOUR de la migration `ouverture_eclatee_par_compte` (supabase/preparees/20261111235000_…, ligne 26.6, MCB5, sixième
-- partie). Il retire la garde, les trois fonctions, la contrainte, l'index et la colonne `ouverture_compte_bancaire_id` du
-- brouillon : DESTRUCTIF par sa forme (des `drop`), il ne perd pourtant rien, car il se REFUSE tant qu'une écriture porte
-- cette source — sans elle, l'éclatement deviendrait une écriture que rien n'explique, et que la validation figerait. À
-- coller par le cabinet, avant le retour de `comptes_bancaires` (MCB1), que la colonne cite.

do $garde$
begin
  if to_regprocedure('public.ecrire_ouverture_eclatee(uuid, integer, jsonb)') is null then
    raise exception 'La migration ouverture_eclatee_par_compte n''est pas en base : rien à retirer.';
  end if;
  if exists (select 1 from public.ecritures_brouillon where ouverture_compte_bancaire_id is not null) then
    raise exception 'Des écritures éclatent l''ouverture de la banque : le retour se refuse tant qu''elles existent (une validation les aurait figées, ou les recomposer à vide les retire).';
  end if;
end
$garde$;

drop trigger ecritures_brouillon_ouverture_eclatee on public.ecritures_brouillon;
drop function public.garder_ecriture_ouverture_eclatee();
drop function public.ecrire_ouverture_eclatee(uuid, integer, jsonb);
drop function public.ouverture_eclatee_attendue(uuid, integer);
drop function public.soldes_des_comptes_au_trente_et_un(uuid, integer);
alter table public.ecritures_brouillon drop constraint ecritures_brouillon_ouverture_eclatee;
drop index public.ecritures_brouillon_ouverture_compte_bancaire_id_idx;
alter table public.ecritures_brouillon drop column ouverture_compte_bancaire_id;
