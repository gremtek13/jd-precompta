-- LE RETOUR D'`adresse_du_client_exigee` (supabase/schema/20261108190701_adresse_du_client_exigee.sql, en production
-- depuis le 08/11/2026 ; JJ-Q4 et A7C-Q1) : il retire le déclencheur et sa fonction, rien
-- d'autre — aucune donnée : une facture validée sous ces règles garde son adresse et ses lignes, et une facture à une
-- entreprise sans adresse, ou une ligne à 0 % d'un redevable sans article, se valide de nouveau, comme avant. Le drapeau
-- `ADRESSE_DU_CLIENT_EXIGEE` (src/lib/validationDeLaFacture.ts) se baisse AVANT ce retour (l'écran dirait des refus que la
-- base ne tient plus). Il se COLLE (ses deux instructions de retrait retiennent l'outil), dans une transaction, sur
-- l'accord du cabinet.

do $garde$
begin
  if to_regprocedure('public.garder_mentions_a_la_validation()') is null
     or not exists (select 1 from pg_trigger t where t.tgrelid = 'public.factures_emises'::regclass
                     and t.tgname = 'factures_emises_figees_mentions') then
    raise exception 'La migration adresse_du_client_exigee n''est pas en base : rien à défaire.';
  end if;
  -- La fonction est celle que la migration a posée (son corps, à son empreinte) : une autre se relit avant d'être retirée.
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p
       where p.oid = 'public.garder_mentions_a_la_validation()'::regprocedure) is distinct from '2d722f66a9ee9f99919537bd44396b25' then
    raise exception 'garder_mentions_a_la_validation n''est plus celle que la migration adresse_du_client_exigee a posée : la relire avant de la retirer.';
  end if;
end
$garde$;

drop trigger factures_emises_figees_mentions on public.factures_emises;
drop function public.garder_mentions_a_la_validation();
