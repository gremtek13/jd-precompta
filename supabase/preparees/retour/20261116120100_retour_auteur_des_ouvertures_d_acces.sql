-- RETOUR ARRIÈRE DE `auteur_des_ouvertures_d_acces` (P1TQ2-Q1) — DESTRUCTIF, À ACCORDER PAR LE CABINET, À COLLER dans
-- l'éditeur SQL de Supabase, dans une transaction, avec sa ligne d'historique (le texte retire une table et deux fonctions).
-- La migration, PRÉPARÉE le 16/11/2026 : supabase/preparees/20261116120000_auteur_des_ouvertures_d_acces.sql ; le récit :
-- HISTORIQUE.md, « 16/11/2026 — P1TQ2-Q1 : QUI A OUVERT UN ACCÈS CLIENT ».
--
-- L'ORDRE : D'ABORD l'application — `OUVERTURES_ATTESTEES_PREVUES` baissé (la lecture de l'onglet et le plan de sauvegarde ;
-- levé, une sauvegarde lirait la table), le fichier de la migration sorti de l'export, remise en ligne — et
-- `create-client-access` redéployée sa constante `OUVERTURES_ATTESTEES_EN_BASE` baissée (levée, elle appellerait une fonction
-- qui n'existe plus : chaque ouverture le dirait), PUIS ce texte.
--
-- CE QU'IL REND : la trace des droits et `memberships` telles qu'hier ; aucune fonction d'hier n'a été remplacée.
--
-- CE QU'IL RETIRE — ce qu'il DÉTRUIRAIT : la table `auteurs_des_ouvertures` et ce qu'elle porte (qui a ouvert chaque accès
-- attesté), ses deux policies, sa garde et son déclencheur ; `attester_ouverture_d_acces`. Il SE REFUSE tant que la table
-- porte une ligne : la perdre est une décision du cabinet, qui l'exporterait d'abord (une sauvegarde du dossier, le drapeau
-- encore levé). La trace, elle, garde ses arrivées sans auteur, comme avant la migration.
--
-- Ni barre oblique inverse, ni retour chariot. Après lui : la signature d'avant la migration (`signature.sql`), l'essai
-- `auteurDesOuvertures.sql` EN ATTENTE, et les trois contrôles de l'export.

-- ══ 0. La garde ══════════
do $garde$
declare
  v_lignes bigint;
begin
  if to_regclass('public.auteurs_des_ouvertures') is null then
    raise exception 'La migration auteur_des_ouvertures_d_acces n''est pas en base (ou ce retour est déjà fait) : rien à défaire.';
  end if;
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_catalog.pg_proc p where p.oid = to_regprocedure('public.attester_ouverture_d_acces(uuid, uuid)'))
       is distinct from '3a43ddacb2e7c663397dd1f61cb5194d'
     or (select md5(replace(p.prosrc, chr(13), '')) from pg_catalog.pg_proc p where p.oid = to_regprocedure('public.garder_auteurs_des_ouvertures()'))
       is distinct from '6298dbb265626e86de5557a504011851' then
    raise exception 'Les fonctions de l''auteur des ouvertures ne sont plus celles que la migration a posées : relire la base avant ce retour.';
  end if;
  select count(*) into v_lignes from public.auteurs_des_ouvertures;
  if v_lignes > 0 then
    raise exception 'La table auteurs_des_ouvertures porte % ligne(s) : ce retour les détruirait. Le cabinet décide d''abord de leur sort (une sauvegarde du dossier), puis un retour qui les retire en connaissance de cause.', v_lignes;
  end if;
end
$garde$;

-- ══ 1. La table (sa garde et ses policies avec elle), puis les fonctions ══════════
drop table public.auteurs_des_ouvertures;
drop function public.attester_ouverture_d_acces(uuid, uuid);
drop function public.garder_auteurs_des_ouvertures();
