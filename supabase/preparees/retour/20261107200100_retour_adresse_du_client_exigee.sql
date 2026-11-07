-- LE RETOUR D'`adresse_du_client_exigee` (20261107200000, JJ-Q4) : il retire le déclencheur et sa fonction, rien d'autre —
-- aucune donnée : une facture validée sous la règle garde son adresse, et une facture à une entreprise se valide de nouveau
-- sans elle, comme avant. Le drapeau `ADRESSE_DU_CLIENT_EXIGEE` (src/lib/validationDeLaFacture.ts) se baisse AVANT ce
-- retour (l'écran dirait un refus que la base ne tient plus). Il se COLLE (ses deux instructions de retrait retiennent
-- l'outil), dans une transaction, sur l'accord du cabinet.

do $garde$
begin
  if to_regprocedure('public.garder_adresse_du_client()') is null
     or not exists (select 1 from pg_trigger t where t.tgrelid = 'public.factures_emises'::regclass
                     and t.tgname = 'factures_emises_figees_adresse_du_client') then
    raise exception 'La migration adresse_du_client_exigee n''est pas en base : rien à défaire.';
  end if;
  -- La fonction est celle que la migration a posée (son corps, à son empreinte) : une autre se relit avant d'être retirée.
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p
       where p.oid = 'public.garder_adresse_du_client()'::regprocedure) is distinct from '513f33e02fd7ab20e07189d998484f64' then
    raise exception 'garder_adresse_du_client n''est plus celle que la migration adresse_du_client_exigee a posée : la relire avant de la retirer.';
  end if;
end
$garde$;

drop trigger factures_emises_figees_adresse_du_client on public.factures_emises;
drop function public.garder_adresse_du_client();
