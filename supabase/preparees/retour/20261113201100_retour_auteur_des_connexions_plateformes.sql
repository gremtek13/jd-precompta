-- RETOUR D'auteur_des_connexions_plateformes (supabase/schema/20261115074709_auteur_des_connexions_plateformes.sql — en
-- production depuis le 15/11/2026, version 20261115074709 —, B4RS-Q1) : la garde, son déclencheur, l'attestation et les
-- deux colonnes retirés. CE QU'IL DÉTRUIT : qui, au cabinet, a écrit la configuration de chaque connexion, et quand (les
-- colonnes `ecrite_par` et `ecrite_le`) ; rien d'autre — les connexions, leurs secrets et leurs points de reprise restent.
-- Après lui, la base ne sait plus qui a écrit une connexion : l'Edge Function `plateforme-agreee` doit d'abord être
-- redéployée avec `AUTEUR_DES_CONNEXIONS_EN_BASE` baissée (elle lirait des colonnes absentes), et la réception par le
-- client (B4r) n'a plus de refus — la retirer d'abord, ou accepter ce que B4RS-Q1 a refusé. DESTRUCTIF (des `drop`) : il se
-- colle dans l'éditeur SQL de Supabase, dans une transaction, avec sa ligne d'historique, sur l'accord du cabinet. Il ne
-- retire que ce que la migration a posé : la garde de tête vérifie que les objets sont les siens.

do $garde$
begin
  if to_regprocedure('public.attester_connexion_plateforme(uuid, timestamp with time zone)') is null
     or to_regprocedure('public.garder_auteur_de_la_connexion()') is null then
    raise exception 'retour_auteur_des_connexions_plateformes : la migration n''est pas en base ; rien à retirer.';
  end if;
  if (select p.prosecdef from pg_catalog.pg_proc p where p.oid = 'public.garder_auteur_de_la_connexion()'::regprocedure)
     or not (select p.prosecdef from pg_catalog.pg_proc p
              where p.oid = 'public.attester_connexion_plateforme(uuid, timestamp with time zone)'::regprocedure) then
    raise exception 'retour_auteur_des_connexions_plateformes : les fonctions en base ne sont pas celles de la migration.';
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = 'public.connexions_plateformes'::regclass
                  and t.tgname = 'connexions_plateformes_auteur'
                  and t.tgfoid = 'public.garder_auteur_de_la_connexion()'::regprocedure)
     or exists (select 1 from pg_catalog.pg_trigger t where t.tgfoid = 'public.garder_auteur_de_la_connexion()'::regprocedure
                 and (t.tgrelid <> 'public.connexions_plateformes'::regclass or t.tgname <> 'connexions_plateformes_auteur')) then
    raise exception 'retour_auteur_des_connexions_plateformes : le déclencheur de la migration manque, ou un autre appelle sa garde : relire avant de retirer.';
  end if;
end
$garde$;

drop trigger connexions_plateformes_auteur on public.connexions_plateformes;
drop function public.garder_auteur_de_la_connexion();
drop function public.attester_connexion_plateforme(uuid, timestamptz);
alter table public.connexions_plateformes
  drop constraint connexions_plateformes_auteur,
  drop column ecrite_par,
  drop column ecrite_le;
