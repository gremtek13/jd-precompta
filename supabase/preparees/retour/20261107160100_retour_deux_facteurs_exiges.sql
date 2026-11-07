-- RETOUR ARRIÈRE DE `deux_facteurs_exiges` (C7, second temps, ligne 51.5). DESTRUCTIF : il efface les exigences posées et
-- la trace des facteurs retirés (`exigences_deux_facteurs`, `retraits_deux_facteurs`) — il ne s'applique qu'avec l'accord
-- explicite du cabinet, et se colle dans l'éditeur SQL (le mot `drop` fait attendre `apply_migration`). Les facteurs que
-- `retirer_second_facteur` a retirés ne reviennent pas (le compte les a réinscrits, ou non) : c'est GoTrue qui les tient.
--
-- EN DEUX TEMPS, DEUX COLLAGES, CHACUN DANS SA TRANSACTION. PostgREST appelle par son nom, à chaque requête, la fonction
-- que règle `pgrst.db_pre_request`, et ne relit ce réglage qu'à la notification `reload config`, qui ne part qu'à la
-- validation de la transaction : la fonction supprimée dans la même transaction que le réglage, toute requête de l'API de
-- données échouerait jusqu'à ce que PostgREST recharge sa configuration — et, s'il manque la notification, jusqu'à son
-- redémarrage.
--   PREMIER TEMPS : le réglage retiré et la notification, SEULS, validés. Puis, avant le second, vérifier : la requête de
--   contrôle qui le suit ne rend aucune ligne, et PostgREST a rechargé sa configuration (son journal le dit).
--   SECOND TEMPS : le reste, un second collage, avec la ligne d'historique `retour_deux_facteurs_exiges`. Sa garde refuse
--   tant que le réglage est posé, et refuse d'être jouée dans la transaction du premier temps (un identifiant de
--   transaction déjà attribué : le premier temps vient d'y écrire).

-- ══ PREMIER TEMPS ═══════════════════════════════════════════════════════════════════════════════════════════════════

do $garde$
begin
  if to_regclass('public.exigences_deux_facteurs') is null or to_regprocedure('public.deux_facteurs_satisfaits()') is null then
    raise exception 'La migration deux_facteurs_exiges n''est pas en base : rien à défaire.';
  end if;
end
$garde$;

alter role authenticator reset pgrst.db_pre_request;
notify pgrst, 'reload config';

-- Le contrôle, une fois le premier temps validé (aucune ligne attendue) :
--   select v.reglage from pg_db_role_setting s cross join lateral unnest(s.setconfig) as v(reglage)
--    where s.setrole = 'authenticator'::regrole and v.reglage like 'pgrst.db_pre_request=%';

-- ══ SECOND TEMPS (un second collage, après la vérification du premier) ═══════════════════════════════════════════════

do $garde_second$
begin
  if pg_current_xact_id_if_assigned() is not null then
    raise exception 'Le second temps du retour se joue dans sa propre transaction : valider d''abord le premier, vérifier que PostgREST a rechargé sa configuration, puis coller le second seul.';
  end if;
  if to_regclass('public.exigences_deux_facteurs') is null or to_regprocedure('public.deux_facteurs_satisfaits()') is null then
    raise exception 'La migration deux_facteurs_exiges n''est pas en base : rien à défaire.';
  end if;
  if exists (select 1 from pg_db_role_setting s cross join lateral unnest(s.setconfig) as v(reglage)
              where s.setrole = to_regrole('authenticator') and v.reglage like 'pgrst.db_pre_request=%') then
    raise exception 'La pré-requête de PostgREST est encore posée sur authenticator : jouer d''abord le premier temps du retour, le valider, et vérifier que PostgREST a rechargé sa configuration.';
  end if;
end
$garde_second$;

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
                 where s.setrole = to_regrole('authenticator') and v.reglage like 'pgrst.db_pre_request=%')
     or to_regclass('public.exigences_deux_facteurs') is not null or to_regclass('public.retraits_deux_facteurs') is not null
     or exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                 and p.proname in ('deux_facteurs_satisfaits', 'ma_double_authentification', 'deux_facteurs_autorite',
                                   'deux_facteurs_des_comptes', 'exiger_deux_facteurs', 'lever_deux_facteurs',
                                   'retirer_second_facteur', 'deux_facteurs_avant_requete')) then
    raise exception 'Garde de fin du retour : une policy deux_facteurs, la pré-requête, une table ou une fonction de la migration est restée.';
  end if;
end
$fin$;
