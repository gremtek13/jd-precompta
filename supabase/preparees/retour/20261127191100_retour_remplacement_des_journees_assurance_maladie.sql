-- RETOUR ARRIÈRE DE `remplacement_des_journees_assurance_maladie` (conception 53, § 14.2 ; NOE4R-Q2) — DESTRUCTIF, À ACCORDER PAR
-- LE CABINET, À COLLER dans l'éditeur SQL de Supabase, dans une transaction, avec sa ligne d'historique (le texte retire une
-- table, sa garde et deux fonctions). La migration : supabase/preparees/20261127191000_remplacement_des_journees_assurance_maladie.sql
-- (préparée le 27/11/2026) ; le récit : HISTORIQUE.md, « 27/11/2026 — NOE4R-Q1 ET NOE4R-Q2 ».
--
-- L'ORDRE : D'ABORD l'application, son drapeau baissé (`REMPLACEMENT_DES_JOURNEES_PREVU`, le fichier de la migration sorti de
-- l'export) et remise en ligne — levé, une sauvegarde lirait la trace et l'écran appellerait la fonction —, PUIS ce texte ; le
-- retour de `periode_des_imports_assurance_maladie` (NOE4R-Q1), s'il est voulu, vient APRÈS lui.
--
-- CE QU'IL REND : la base d'avant la migration ; aucune fonction d'hier n'a été remplacée, et les paiements qu'un remplacement a
-- écrits restent ce qu'ils sont (des paiements de leur import, que le retrait de cet import emporte comme les autres).
--
-- CE QU'IL RETIRE — ce qu'il DÉTRUIRAIT : la table `remplacements_assurance_maladie` et ce qu'elle porte (la trace des paiements
-- remplacés : leurs chiffres d'avant et d'après, leurs imports, qui et quand), ses policies (la restrictive `deux_facteurs`
-- comprise, si la double authentification est en base), sa garde et son déclencheur ; `remplacer_journees_assurance_maladie`,
-- `garder_remplacements_assurance_maladie`. Il SE REFUSE tant que la trace porte une ligne : la perdre est une décision du
-- cabinet, qui l'exporterait d'abord (une sauvegarde du dossier, le drapeau encore levé).
--
-- Ni barre oblique inverse, ni retour chariot. Après lui : la signature d'avant la migration (`signature.sql`), l'essai
-- `remplacementDesJourneesAssuranceMaladie.sql` EN ATTENTE, le bloc RJ de `rls.sql` EN ATTENTE (et la section P7 sans la table),
-- et les trois contrôles de l'export.

-- ══ 0. La garde ══════════
do $garde$
declare
  v_lignes bigint;
begin
  if to_regclass('public.remplacements_assurance_maladie') is null then
    raise exception 'La migration remplacement_des_journees_assurance_maladie n''est pas en base (ou ce retour est déjà fait) : rien à défaire.';
  end if;
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.remplacer_journees_assurance_maladie(uuid,jsonb,uuid[])'))
       is distinct from 'cb3ec9804830793cd321070f213e3617'
     or (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.garder_remplacements_assurance_maladie()'))
       is distinct from 'ad28778c4822ef2a008ad22b2ee2f7dd' then
    raise exception 'Les fonctions du remplacement des journées ne sont plus celles que la migration a posées : relire la base avant ce retour.';
  end if;
  select count(*) into v_lignes from public.remplacements_assurance_maladie;
  if v_lignes > 0 then
    raise exception 'La trace des remplacements porte % ligne(s) : ce retour la détruirait. Le cabinet décide d''abord de son sort (une sauvegarde du dossier), puis un retour qui la retire en connaissance de cause.', v_lignes;
  end if;
end
$garde$;

-- ══ 1. La fonction qui écrit la trace, la table (ses policies, son déclencheur, son index partent avec elle), puis la
-- fonction de sa garde ══════════
drop function public.remplacer_journees_assurance_maladie(uuid, jsonb, uuid[]);
drop table public.remplacements_assurance_maladie;
drop function public.garder_remplacements_assurance_maladie();
