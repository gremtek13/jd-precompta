-- LE RETOUR DE `compte_propre_hors_des_exercices_valides` (MCB6Q2-Q1, ligne 26.6 ; supabase/preparees/
-- 20261111235700_compte_propre_hors_des_exercices_valides.sql) — À COLLER (ses deux retraits retiennent l'outil), dans une
-- transaction, sur l'accord du cabinet. Il retire le filet et sa fonction, rien d'autre ; aucune donnée. C'est un
-- RELÂCHEMENT : la base n'oppose plus rien à un compte bancaire qui tiendrait son propre 512 depuis un exercice validé —
-- l'écran seul le refuse de nouveau (MCB6-Q2), comme avant la migration. Il se refuse si la fonction n'est plus celle que la
-- migration a posée, ou si son déclencheur n'est plus le sien : rien à défaire sans les relire.

do $garde$
begin
  if to_regprocedure('public.garder_compte_propre_hors_des_exercices_valides()') is null then
    raise exception 'retour_compte_propre_hors_des_exercices_valides : la migration n''est pas en base (ou ce retour est déjà fait) : rien à défaire.';
  end if;
  if (select md5(replace(p.prosrc, chr(13) || chr(10), chr(10))) from pg_proc p
       where p.oid = 'public.garder_compte_propre_hors_des_exercices_valides()'::regprocedure) is distinct from '09425f2bb8644d21dc224434c3c33daf'
     or (select string_agg(t.tgrelid::regclass::text || ':' || t.tgname, ',' order by t.tgname collate "C") from pg_trigger t
          where t.tgfoid = 'public.garder_compte_propre_hors_des_exercices_valides()'::regprocedure)
        is distinct from 'comptes_bancaires:comptes_bancaires_garde_des_exercices_valides' then
    raise exception 'retour_compte_propre_hors_des_exercices_valides : le filet n''est plus celui que la migration a posé : rien à défaire sans le relire.';
  end if;
end
$garde$;

drop trigger comptes_bancaires_garde_des_exercices_valides on public.comptes_bancaires;
drop function public.garder_compte_propre_hors_des_exercices_valides();

do $fin$
begin
  if to_regprocedure('public.garder_compte_propre_hors_des_exercices_valides()') is not null
     or exists (select 1 from pg_trigger t where t.tgrelid = 'public.comptes_bancaires'::regclass
                 and t.tgname = 'comptes_bancaires_garde_des_exercices_valides') then
    raise exception 'Garde de fin : le filet des exercices validés est encore en base.';
  end if;
end
$fin$;
