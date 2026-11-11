-- RETOUR ARRIÈRE DE `adresse_des_acces_retires` (P1T-E2) — DESTRUCTIF, À ACCORDER PAR LE CABINET, À COLLER dans l'éditeur
-- SQL de Supabase, dans une transaction, avec sa ligne d'historique (le texte retire une table, un déclencheur et deux
-- fonctions). La migration, en production depuis le 11/11/2026 (version 20261111204532) :
-- supabase/schema/20261111204532_adresse_des_acces_retires.sql ; le récit : HISTORIQUE.md,
-- « 11/11/2026 — P1T-E2 : L'ADRESSE D'UN ACCÈS RETIRÉ, GARDÉE AVEC LA TRACE (PRÉPARÉE, PAS APPLIQUÉE) ».
--
-- L'ORDRE : D'ABORD l'application, son drapeau baissé (`ADRESSES_DES_ACCES_RETIRES_PREVUES`, le fichier de la migration
-- sorti de l'export) et remise en ligne — levé, une sauvegarde lirait la table —, PUIS ce texte.
--
-- CE QU'IL REND : `memberships` et la trace des droits telles qu'hier ; aucune fonction d'hier n'a été remplacée.
--
-- CE QU'IL RETIRE — ce qu'il DÉTRUIRAIT : la table `adresses_des_acces_retires` et ce qu'elle porte (l'adresse de chaque accès
-- parti que la trace nomme), ses deux policies, sa garde et son déclencheur ; le déclencheur
-- `memberships_trace_des_droits_adresse` et `retenir_l_adresse_d_un_acces_retire`. Il SE REFUSE tant que la table porte une
-- ligne : la perdre est une décision du cabinet, qui l'exporterait d'abord (une sauvegarde du dossier, le drapeau encore
-- levé). Une sauvegarde prise pendant que la migration était en base porte la table : elle ne se restaure plus sur la base
-- d'après ce retour sans en retirer la table.
--
-- Ni barre oblique inverse, ni retour chariot. Après lui : la signature d'avant la migration (`signature.sql`), les essais
-- `adresseDesAccesRetires.sql` et `adresseDesAccesRetiresSuppression.sql` EN ATTENTE, le bloc AR de `rls.sql` EN ATTENTE,
-- l'étape 39 de `traceDesDroits.sql` et l'étape 141 de `validationExercice.sql` comme hier, et les trois contrôles de
-- l'export.

-- ══ 0. La garde ══════════
do $garde$
declare
  v_lignes bigint;
begin
  if to_regclass('public.adresses_des_acces_retires') is null then
    raise exception 'La migration adresse_des_acces_retires n''est pas en base (ou ce retour est déjà fait) : rien à défaire.';
  end if;
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.retenir_l_adresse_d_un_acces_retire()'))
       is distinct from '42d83ab463bace62e8e587480193eb9e'
     or (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.garder_adresses_des_acces_retires()'))
       is distinct from 'ac096e5d4a501cd5403639067113cf24' then
    raise exception 'Les fonctions de l''adresse des accès retirés ne sont plus celles que la migration a posées : relire la base avant ce retour.';
  end if;
  select count(*) into v_lignes from public.adresses_des_acces_retires;
  if v_lignes > 0 then
    raise exception 'La table adresses_des_acces_retires porte % ligne(s) : ce retour les détruirait. Le cabinet décide d''abord de leur sort (une sauvegarde du dossier), puis un retour qui les retire en connaissance de cause.', v_lignes;
  end if;
end
$garde$;

-- ══ 1. Le déclencheur des accès, puis la table, puis les fonctions ══════════
drop trigger memberships_trace_des_droits_adresse on public.memberships;
drop table public.adresses_des_acces_retires;
drop function public.retenir_l_adresse_d_un_acces_retire();
drop function public.garder_adresses_des_acces_retires();
