-- RETOUR ARRIÈRE DE `deux_facteurs_exiges` (C7, second temps, ligne 51.5). DESTRUCTIF : il efface les exigences posées et
-- la trace des facteurs retirés (`exigences_deux_facteurs`, `retraits_deux_facteurs`) — il ne s'applique qu'avec l'accord
-- explicite du cabinet, et se colle dans l'éditeur SQL (le mot `drop` fait attendre `apply_migration`). Les facteurs que
-- `retirer_second_facteur` a retirés ne reviennent pas (le compte les a réinscrits, ou non) : c'est GoTrue qui les tient.
--
-- L'ORDRE COMPTE : la pré-requête se retire D'ABORD. PostgREST appelle par son nom la fonction réglée sur authenticator ;
-- la fonction supprimée avant le réglage, toute requête de l'API de données échouerait jusqu'au rechargement suivant.
do $garde$
begin
  if to_regclass('public.exigences_deux_facteurs') is null or to_regprocedure('public.deux_facteurs_satisfaits()') is null then
    raise exception 'La migration deux_facteurs_exiges n''est pas en base : rien à défaire.';
  end if;
end
$garde$;

alter role authenticator reset pgrst.db_pre_request;
notify pgrst, 'reload config';

do $policies$
declare
  t regclass;
begin
  for t in select p.polrelid::regclass from pg_policy p where p.polname = 'deux_facteurs' order by 1 loop
    execute format('drop policy deux_facteurs on %s', t);
  end loop;
end
$policies$;

drop function public.deux_facteurs_avant_requete();
drop function public.retirer_second_facteur(uuid);
drop function public.lever_deux_facteurs(uuid);
drop function public.exiger_deux_facteurs(uuid);
drop function public.deux_facteurs_des_comptes(uuid, uuid);
drop function public.deux_facteurs_autorite(uuid, boolean);
drop function public.ma_double_authentification();
drop function public.deux_facteurs_satisfaits();
drop table public.retraits_deux_facteurs;
drop table public.exigences_deux_facteurs;

do $fin$
begin
  if exists (select 1 from pg_policy where polname = 'deux_facteurs')
     or exists (select 1 from pg_db_role_setting s cross join lateral unnest(s.setconfig) as v(reglage)
                 where s.setrole = to_regrole('authenticator') and v.reglage like 'pgrst.db_pre_request=%') then
    raise exception 'Garde de fin du retour : une policy deux_facteurs ou la pré-requête est restée.';
  end if;
end
$fin$;
