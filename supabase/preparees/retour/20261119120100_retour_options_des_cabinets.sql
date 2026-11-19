-- RETOUR ARRIÈRE DE `options_des_cabinets` (conception 56, OPT1) — DESTRUCTIF, À ACCORDER PAR LE CABINET, À COLLER dans
-- l'éditeur SQL de Supabase, dans une transaction, avec sa ligne d'historique (le texte retire une table, deux fonctions,
-- une garde et son déclencheur). La migration : supabase/preparees/20261119120000_options_des_cabinets.sql (préparée le
-- 19/11/2026, sous une version provisoire) ; le récit : HISTORIQUE.md, « 19/11/2026 — OPT1 ET OPT2 : LES OPTIONS PAR
-- CABINET, LE MODULE ET LA MIGRATION (PRÉPARÉE, PAS APPLIQUÉE) ».
--
-- L'ORDRE : D'ABORD l'application, son drapeau baissé (`OPTIONS_DES_CABINETS_PREVUES`, le fichier de la migration sorti de
-- l'export) et remise en ligne — levé, les écrans liraient la table —, et les Edge Functions qui la lisent (OPT5)
-- redéployées sans elle, PUIS ce texte.
--
-- CE QU'IL REND : la base d'avant la migration ; aucune fonction d'hier n'a été remplacée. Le chef d'un cabinet peut de
-- nouveau changer les plafonds de l'assistant de son cabinet par l'API (le défaut de la conception 56, § 2.6).
--
-- CE QU'IL RETIRE — ce qu'il DÉTRUIRAIT : la table `options_des_cabinets` et ce qu'elle porte (les modules de chaque
-- cabinet, qui les a réglés et quand), sa policy (la restrictive `deux_facteurs` comprise, si la double authentification
-- est en base) ; `regler_option_du_cabinet`, `modules_ouverts_du_dossier` ; la garde `garder_plafonds_de_l_assistant` et son
-- déclencheur sur `cabinets`. Il SE REFUSE tant qu'un cabinet n'a pas ses huit modules ouverts : sans la table,
-- l'application d'avant ouvre tout à tout cabinet, et un module que le super-administrateur a fermé — la tenue d'un cabinet
-- non inscrit à l'Ordre (§ 5) — se rouvrirait en silence. Le cabinet décide d'abord de ces cabinets (rouvrir leurs modules,
-- ou les retirer), puis ce retour.
--
-- Ni barre oblique inverse, ni retour chariot. Après lui : la signature d'avant la migration (`signature.sql`), l'essai
-- `optionsDesCabinets.sql` EN ATTENTE, le bloc OC de `rls.sql` EN ATTENTE, et les trois contrôles de l'export.

-- ══ 0. La garde ══════════
do $garde$
declare
  v_cabinets text;
begin
  if to_regclass('public.options_des_cabinets') is null then
    raise exception 'La migration options_des_cabinets n''est pas en base (ou ce retour est déjà fait) : rien à défaire.';
  end if;
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.regler_option_du_cabinet(uuid,text,boolean)'))
       is distinct from '728b3b485b6cdb50e3c61638e7738b15'
     or (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.modules_ouverts_du_dossier(uuid)'))
       is distinct from '104c5a8722d6ccc39a3475fe3def935a'
     or (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.garder_plafonds_de_l_assistant()'))
       is distinct from 'da43027d3c263b44b82efbdf9d4ca118' then
    raise exception 'Les fonctions des options des cabinets ne sont plus celles que la migration a posées : relire la base avant ce retour.';
  end if;
  select string_agg(c.nom, ', ' order by c.nom collate "C", c.id) into v_cabinets
    from public.cabinets c
   where (select count(*) from public.options_des_cabinets o where o.cabinet_id = c.id and o.ouverte) <> 8;
  if v_cabinets is not null then
    raise exception 'Ces cabinets n''ont pas leurs huit modules ouverts : % — sans la table, l''application d''avant les leur rouvrirait tous. Le cabinet décide d''abord de leur sort, puis ce retour.', v_cabinets;
  end if;
end
$garde$;

-- ══ 1. La garde des plafonds et son déclencheur, les deux fonctions de l'API, puis la table (sa policy part avec elle) ══════════
drop trigger cabinets_plafonds_de_l_assistant on public.cabinets;
drop function public.garder_plafonds_de_l_assistant();
drop function public.regler_option_du_cabinet(uuid, text, boolean);
drop function public.modules_ouverts_du_dossier(uuid);
drop table public.options_des_cabinets;
