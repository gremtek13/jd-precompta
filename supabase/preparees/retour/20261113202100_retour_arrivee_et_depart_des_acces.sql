-- RETOUR D'arrivee_et_depart_des_acces (20261113202000, P1T-Q2) : le déclencheur des accès et sa fonction retirés, la
-- contrainte du droit ramenée aux sept cases de P1-trace. CE QU'IL DÉTRUIT : la trace, à venir, de qui ouvre ou retire un
-- accès sans case ; aucune ligne écrite — il SE REFUSE tant que la trace porte une ligne « acces » (la garde de la trace
-- n'en laisse partir aucune hors de la cascade de son dossier, et les effacer serait détruire ce que le cabinet a décidé de
-- garder : à décider à part). Les adresses retenues d'accès retirés sans case restent (P1T-E2). Sous
-- `ACCES_DANS_LA_TRACE_PREVU` levé, l'écran continue de lire : sans ligne « acces », rien ne change pour lui. DESTRUCTIF (des
-- `drop`) : il se colle dans l'éditeur SQL de Supabase, dans une transaction, avec sa ligne d'historique, sur l'accord du
-- cabinet. Il ne retire que ce que la migration a posé : la garde de tête vérifie que les objets sont les siens.

do $garde$
begin
  if to_regprocedure('public.tracer_les_acces()') is null then
    raise exception 'retour_arrivee_et_depart_des_acces : la migration n''est pas en base ; rien à retirer.';
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = 'public.memberships'::regclass
                  and t.tgname = 'memberships_trace_des_droits_acces' and t.tgfoid = 'public.tracer_les_acces()'::regprocedure)
     or exists (select 1 from pg_catalog.pg_trigger t where t.tgfoid = 'public.tracer_les_acces()'::regprocedure
                 and (t.tgrelid <> 'public.memberships'::regclass or t.tgname <> 'memberships_trace_des_droits_acces')) then
    raise exception 'retour_arrivee_et_depart_des_acces : le déclencheur de la migration manque, ou un autre appelle sa fonction : relire avant de retirer.';
  end if;
  if exists (select 1 from public.trace_des_droits t where t.droit = 'acces') then
    raise exception 'retour_arrivee_et_depart_des_acces : la trace porte des lignes « acces » ; la contrainte des sept cases les refuserait. Rien n''est retiré.';
  end if;
end
$garde$;

drop trigger memberships_trace_des_droits_acces on public.memberships;
drop function public.tracer_les_acces();
alter table public.trace_des_droits
  drop constraint trace_des_droits_droit,
  add constraint trace_des_droits_droit
    check (droit in ('ventes', 'banque', 'caisse', 'comptes', 'achats', 'frais', 'documents'));

comment on column public.trace_des_droits.droit is null;
