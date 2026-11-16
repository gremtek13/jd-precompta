-- RETOUR DE especes_du_client_hors_des_reprises (supabase/preparees/20261116142000_especes_du_client_hors_des_reprises.sql,
-- A8Q5Q3Q2Q2-Q1) : le client « Caisse » paie de nouveau en espèces l'original d'une facture reprise. CE QU'IL DÉTRUIT : la
-- garde `garder_especes_du_client_hors_des_reprises`, son déclencheur `operations_caisse_hors_des_reprises`, et la lecture
-- `pieces_hors_de_la_caisse_du_client` ; AUCUNE DONNÉE : la migration n'en pose aucune. Après lui, le refus de la garde
-- différée des règlements (A8Q5Q3Q2-Q2) et celui de la garde des règlements d'une pièce reprise (A8-Q5) parlent de nouveau au
-- client, comme avant le 16/11/2026. `ESPECES_DU_CLIENT_HORS_DES_REPRISES_PREVUES` doit être baissé AVANT (« Mes pièces »
-- appellerait une lecture qui n'existe plus, et n'offrirait plus aucun paiement). DESTRUCTIF (des `drop`) : il se colle dans
-- l'éditeur SQL de Supabase, dans une transaction, avec sa ligne d'historique, sur l'accord du cabinet. Il ne retire que ce
-- que la migration a posé : la garde de tête vérifie l'empreinte des deux corps et le déclencheur.

do $garde$
begin
  if (select string_agg(p.proname || '=' || md5(replace(p.prosrc, chr(13), '')), ',' order by p.proname collate "C")
        from pg_catalog.pg_proc p
       where p.oid in (to_regprocedure('public.garder_especes_du_client_hors_des_reprises()'),
                       to_regprocedure('public.pieces_hors_de_la_caisse_du_client(uuid)')))
     is distinct from 'garder_especes_du_client_hors_des_reprises=28b47ef3dc1ab29a5f6dd69068a2e670,'
                   || 'pieces_hors_de_la_caisse_du_client=7ab7b405c40dfca1b5a5c7c7d4bd7e11' then
    raise exception 'retour_especes_du_client_hors_des_reprises : les fonctions en base ne sont pas celles que la migration pose (ou la migration n''est pas en base) ; relire avant de retirer.';
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger t
                  where t.tgname = 'operations_caisse_hors_des_reprises' and not t.tgisinternal
                    and t.tgfoid = to_regprocedure('public.garder_especes_du_client_hors_des_reprises()')) then
    raise exception 'retour_especes_du_client_hors_des_reprises : le déclencheur de la migration n''est pas en base ; relire avant de retirer.';
  end if;
end
$garde$;

drop trigger operations_caisse_hors_des_reprises on public.operations_caisse;
drop function public.garder_especes_du_client_hors_des_reprises();
drop function public.pieces_hors_de_la_caisse_du_client(uuid);

do $fin$
begin
  if to_regprocedure('public.garder_especes_du_client_hors_des_reprises()') is not null
     or to_regprocedure('public.pieces_hors_de_la_caisse_du_client(uuid)') is not null
     or exists (select 1 from pg_catalog.pg_trigger t where t.tgname = 'operations_caisse_hors_des_reprises' and not t.tgisinternal) then
    raise exception 'retour_especes_du_client_hors_des_reprises : la garde, son déclencheur ou la lecture est encore en base.';
  end if;
end
$fin$;
