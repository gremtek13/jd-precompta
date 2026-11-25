-- RETOUR ARRIÈRE DE `reglages_d_export` (EXP-Q4 (A), les réglages de l'export vers un logiciel comptable, gardés par dossier
-- et par logiciel) — DESTRUCTIF, À ACCORDER PAR LE CABINET, À COLLER dans l'éditeur SQL de Supabase, dans une transaction,
-- avec sa ligne d'historique (le texte retire une table, sa garde et deux fonctions). La migration :
-- supabase/schema/20261125123611_reglages_d_export.sql (préparée le 24/11/2026, sous une version provisoire) ; le récit :
-- HISTORIQUE.md, « 24/11/2026 — EXP-Q4 : LES RÉGLAGES DE L'EXPORT GARDÉS PAR DOSSIER (PRÉPARÉE, PAS APPLIQUÉE) ».
--
-- L'ORDRE : D'ABORD l'application, son drapeau baissé (`REGLAGES_D_EXPORT_PREVUS`, src/lib/reglagesDExport.ts ; le fichier
-- de la migration sorti de l'export) et remise en ligne — levé, une sauvegarde lirait la table et l'écran de l'export la
-- lirait —, PUIS ce texte. Baissé, l'export vers un logiciel comptable reste celui d'aujourd'hui, réglé à la main.
--
-- CE QU'IL REND : la base d'avant la migration (la signature de `signature.sql`) ; aucune fonction d'hier n'a été remplacée.
--
-- CE QU'IL RETIRE — ce qu'il DÉTRUIRAIT : la table `reglages_d_export` (la longueur des comptes, la forme des comptes de
-- tiers et les codes des journaux que le cabinet a gardés pour chaque dossier et chaque logiciel, avec leur version, qui les a
-- enregistrés et quand), ses policies (la restrictive `deux_facteurs` comprise, si la double authentification est en base), sa
-- garde et son déclencheur ; `enregistrer_reglages_d_export` et la liste fermée `logiciels_d_export`. Il SE REFUSE tant que
-- la table porte une ligne : la perdre est une décision du cabinet, qui relèverait d'abord les réglages (un SELECT) pour les
-- ressaisir à la main à chaque export. Une sauvegarde prise pendant que la migration était en base porte la table : elle ne se
-- restaure plus sur la base d'après ce retour sans l'en retirer.
--
-- Ni barre oblique inverse, ni retour chariot. Après lui : la signature d'avant la migration, l'essai `reglagesDExport.sql` et
-- le bloc RX de `rls.sql` EN ATTENTE, et les trois contrôles de l'export.

-- ══ 0. La garde ══════════
do $garde$
begin
  if to_regclass('public.reglages_d_export') is null then
    raise exception 'La migration reglages_d_export n''est pas en base (ou ce retour est déjà fait) : rien à défaire.';
  end if;
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.enregistrer_reglages_d_export(uuid,text,jsonb,integer)'))
       is distinct from '2e1ebb09e0466609f5b4988b4f7a6748'
     or (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.garder_reglages_d_export()'))
       is distinct from '9bafa86702dd27cbe2cd682c80016a62'
     or (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.logiciels_d_export()'))
       is distinct from '7138673303bb6d7c62dd2dc1823162b4' then
    raise exception 'Les fonctions des réglages d''export ne sont plus celles de la migration (la liste fermée étendue ?) : relire la base avant ce retour.';
  end if;
  if exists (select 1 from public.reglages_d_export) then
    raise exception 'Des réglages d''export sont gardés : ce retour les détruirait. Les relever d''abord, et le décider.';
  end if;
end
$garde$;

-- ══ 1. La fonction, puis la table (ses policies, sa contrainte de la liste et son déclencheur avec elle), puis la garde et la
-- liste ══════════
drop function public.enregistrer_reglages_d_export(uuid, text, jsonb, integer);
drop table public.reglages_d_export;
drop function public.garder_reglages_d_export();
drop function public.logiciels_d_export();
