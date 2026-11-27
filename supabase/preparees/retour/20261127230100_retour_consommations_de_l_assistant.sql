-- LE RETOUR DE `consommations_de_l_assistant` (ASSIST-Q1 (A), préparée le 27/11/2026 :
-- supabase/preparees/20261127230000_consommations_de_l_assistant.sql). DESTRUCTIF : il retire la table et tout le journal de
-- consommation qu'elle porte, sa garde et la lecture du super-administrateur — jamais sans l'accord du cabinet. À COLLER (il
-- retire une table et deux fonctions : l'outil d'application attendrait une confirmation), dans une transaction, avec sa ligne
-- d'historique ; APRÈS que la constante `CONSOMMATION_TENUE_PAR_LA_FONCTION` de `agent-comptable` a été rebaissée et la
-- fonction redéployée (sinon chaque question écrirait dans une table absente et s'arrêterait), et le drapeau jumeau de
-- l'application rebaissé dans le même commit que le retrait du fichier de l'export. Le plafond se recompte alors sur les lignes
-- `agent_conversations`, comme avant la migration, et le mois en cours sans ce que le journal portait.
--
-- Éprouvé le 27/11/2026 sur une copie de la réplique portée à 261 : la signature d'avant rendue (neuf familles), aucune ligne
-- d'historique retirée (le retour pose la sienne).

-- La garde : la migration est en base, sous sa forme, et le retour sait ce qu'il retire.
do $garde$
begin
  if to_regclass('public.consommations_de_l_assistant') is null
     or to_regprocedure('public.consommation_de_l_assistant(timestamptz)') is null
     or to_regprocedure('public.garder_consommations_de_l_assistant()') is null then
    raise exception 'La migration consommations_de_l_assistant n''est pas en base : rien à retourner.';
  end if;
  if exists (select 1 from pg_constraint c where c.confrelid = 'public.consommations_de_l_assistant'::regclass)
     or exists (select 1 from pg_depend d
                 where d.refobjid = 'public.consommations_de_l_assistant'::regclass and d.classid = 'pg_rewrite'::regclass) then
    raise exception 'Une clé étrangère ou une vue désigne la table consommations_de_l_assistant : la relire avant le retour.';
  end if;
end
$garde$;

drop function public.consommation_de_l_assistant(timestamptz);
drop table public.consommations_de_l_assistant;
drop function public.garder_consommations_de_l_assistant();

do $fin$
begin
  if to_regclass('public.consommations_de_l_assistant') is not null
     or exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                 and p.proname in ('consommation_de_l_assistant', 'garder_consommations_de_l_assistant')) then
    raise exception 'Le retour de consommations_de_l_assistant n''a pas rendu l''état d''avant.';
  end if;
end
$fin$;
