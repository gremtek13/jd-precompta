-- A8B-Q3 — UN DOSSIER QUI PORTE DES FACTURES REPRISES NE PASSE PAS EN COMPTABILITÉ D'ENGAGEMENT (ligne 51.5 ; décision du
-- cabinet : A8B-Q3, « Le refuser », le 11/11/2026, à la recommandation — dans un petit lot à part). PRÉPARÉE le 13/11/2026,
-- PAS APPLIQUÉE. Le récit : HISTORIQUE.md, « 13/11/2026 — PC4Q2-Q1, A8B-Q3 ET A8Q5Q3-Q2 : TROIS MIGRATIONS PRÉPARÉES » ;
-- l'essai : supabase/essais/repriseEtModeleComptable.sql (EN ATTENTE sans elle) ; le retour :
-- supabase/preparees/retour/20261113211100_retour_reprises_retiennent_la_tresorerie.sql ; le module qui redit le refus
-- avant le clic : src/lib/reprisesRetiennentLaTresorerie.ts (`REPRISES_RETIENNENT_LA_TRESORERIE_PREVUES`, baissé jusqu'à
-- l'application), confronté à ce texte par son test, et l'onglet Écritures (la carte « Modèle comptable »).
--
-- SOURCES. La conception d'A8 (HISTORIQUE.md, « A8 ET A9, LES FACTURES REPRISES ET LA NUMÉROTATION QUI CONTINUE : LA
-- CONCEPTION REMISE À JOUR », 06/11/2026, point 2) : en engagement, la créance d'une facture d'avant la reprise est au compte
-- client (411) de la balance reprise, et la reprise ne range que la banque, le 44566 et le 44571
-- (`compteQueLApplicationEcrit`) ; A8-Q3 refuse donc l'import en engagement jusqu'à A8e, avec l'expert-comptable. Le plan
-- comptable général (règlement ANC n° 2014-03 consolidé au 1er janvier 2026), art. 1214-41 (le 411 « Clients ») : sans lui,
-- une créance reprise ne serait nulle part au bilan d'un dossier en engagement. PostgreSQL 17, « CREATE FUNCTION » (CREATE
-- OR REPLACE garde la fonction, son propriétaire, ses droits et le déclencheur qui l'appelle) ; « Overview of Trigger
-- Behavior » (un déclencheur BEFORE … FOR EACH ROW qui lève annule l'instruction).
--
-- POURQUOI. `importer_factures` refuse l'import dans un dossier en engagement (A8-Q3) ; rien n'empêchait l'inverse : passer
-- en engagement APRÈS l'import, tant que le brouillon est vide (la seule garde du réglage, `verrouiller_modele_comptable`).
-- Les créances reprises ne seraient alors nulle part au bilan, et les fonctions de la vente, qui ne composent aucun
-- « document » pour une facture reprise, n'y écriraient rien (A8b).
--
-- CE QU'ELLE FAIT : elle remplace le corps de `verrouiller_modele_comptable` (la garde du réglage du modèle comptable,
-- empreinte c5d5a1bd…, celui de la migration `modele_comptable_du_dossier`, en production) par le même, plus un refus,
-- APRÈS celui du brouillon : un changement du modèle VERS l'engagement, dans un dossier qui porte au moins une facture ou
-- un avoir à l'état « importee » (repris de l'ancien logiciel, A8a), se refuse — 23514, à ses mots, que l'écran redit
-- avant le clic. Le refus d'hier garde son rang et ses mots ; le compte du dirigeant (`compte_notes_de_frais`) et le retour
-- en trésorerie ne se jugent pas ici. La fonction reste `security invoker`, au chemin `public`, comme hier : seul le cabinet
-- du dossier et le super-administrateur écrivent un dossier (la policy `dossiers_update`, `admin_du_dossier`), et l'un et
-- l'autre lisent toutes ses factures (`factures_emises_all`, le même prédicat) : la lecture qui juge ne leur cache rien.
-- CONCURRENCE : `importer_factures` verrouille la ligne du dossier (`for update`) avant de lire son modèle, et la mise à
-- jour du modèle prend le même verrou : un import et un passage en engagement se suivent, et le second voit le premier.
--
-- CE QU'ELLE NE CHANGE PAS : aucune donnée, aucune table, aucune policy, aucun déclencheur (celui d'hier,
-- `dossiers_verrouiller_modele_comptable`, BEFORE UPDATE OF mode_comptable, compte_notes_de_frais, appelle la fonction
-- remplacée). La restauration insère un dossier (aucune mise à jour du modèle). Un dossier dont les imports sont tous
-- retirés (`retirer_import`) ne porte plus de facture reprise, et passe en engagement comme hier. Relevé sur la réplique du
-- 13/11/2026 (218 migrations, égale à la production à la signature) : aucun dossier en engagement, aucune facture reprise.
--
-- COMMENT ELLE S'APPLIQUE : aucun mot de retrait ni de vidage, aucune barre oblique inverse — PAR L'OUTIL. Indépendante des
-- deux autres migrations préparées du même jour (`le_468_sur_le_releve`, `recu_par_la_piece_citee`) : aucune fonction,
-- aucune table en commun ; elle s'applique avant, après ou entre elles. Aucune autre migration préparée ne remplace
-- `verrouiller_modele_comptable` ; `exercices_du_dossier` (EXD2, préparée) pose sur le même évènement un déclencheur À ELLE
-- (`dossiers_exercices_retiennent_l_engagement`, le retour en trésorerie d'un dossier qui a déclaré ses exercices) : les
-- deux se cumulent, dans l'ordre qu'on voudra. Le jour de son application, `REPRISES_RETIENNENT_LA_TRESORERIE_PREVUES` se
-- lève et le fichier entre dans supabase/schema/ sous la version que porte sa ligne d'historique, texte inchangé.

-- ══ 0. La garde de tête ══════════
-- La fonction est celle de `modele_comptable_du_dossier`, à l'empreinte de son corps, et son déclencheur l'appelle ; la
-- migration ne se rejoue pas ; les factures reprises sont en base (A8a) et leur import refuse l'engagement (A8-Q3) ; aucun
-- dossier en engagement ne porte déjà de facture reprise.
do $garde$
declare
  v_empreinte text;
  v_dossiers bigint;
begin
  select md5(replace(p.prosrc, chr(13) || chr(10), chr(10))) into v_empreinte
    from pg_catalog.pg_proc p where p.oid = to_regprocedure('public.verrouiller_modele_comptable()');
  if v_empreinte = '2a25b53f2d34b7c1ba811dd1ca4f323f' then
    raise exception 'A8B-Q3 : la garde du modèle comptable refuse déjà l''engagement d''un dossier qui porte des factures reprises : cette migration ne se rejoue pas.';
  end if;
  if v_empreinte is distinct from 'c5d5a1bd8c5f8213dee236fd0261d12f' then
    raise exception 'A8B-Q3 : verrouiller_modele_comptable n''est pas celle de modele_comptable_du_dossier (empreinte %) : relire la migration contre la base avant de l''appliquer.',
      coalesce(v_empreinte, 'absente');
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger t
                  where t.tgrelid = 'public.dossiers'::regclass and t.tgname = 'dossiers_verrouiller_modele_comptable'
                    and t.tgfoid = 'public.verrouiller_modele_comptable()'::regprocedure and t.tgtype = 19 and t.tgenabled = 'O'
                    and (select a.attnum from pg_catalog.pg_attribute a
                          where a.attrelid = 'public.dossiers'::regclass and a.attname = 'mode_comptable') = any (t.tgattr::int2[])) then
    raise exception 'A8B-Q3 : le déclencheur dossiers_verrouiller_modele_comptable (BEFORE UPDATE OF mode_comptable, FOR EACH ROW, actif) n''appelle plus la garde : la remplacer ne poserait aucun refus.';
  end if;
  -- Le refus de l'import en engagement (A8-Q3), à sa place dans `importer_factures` (la position de son texte, celle de la
  -- migration `factures_importees`) : les deux refus ensemble tiennent qu'aucun dossier en engagement ne porte de reprise.
  if to_regclass('public.factures_importees') is null
     or (select position($p$if v_mode = 'engagement' then
    raise exception 'Les factures d''un ancien logiciel ne se reprennent pas encore dans un dossier tenu en comptabilité d''engagement$p$ in p.prosrc)
           from pg_catalog.pg_proc p where p.oid = to_regprocedure('public.importer_factures(uuid, jsonb, jsonb)')) is distinct from 2684 then
    raise exception 'A8B-Q3 : les factures reprises (A8a) ne sont pas en base, ou leur import ne refuse plus l''engagement (A8-Q3) à la place que cette migration suppose : la relire contre la base avant de l''appliquer.';
  end if;
  select count(*) into v_dossiers
    from public.dossiers d
   where d.mode_comptable = 'engagement'
     and exists (select 1 from public.factures_emises f where f.dossier_id = d.id and f.statut = 'importee');
  if v_dossiers > 0 then
    raise exception 'A8B-Q3 : % dossier(s) en comptabilité d''engagement porte(nt) déjà des factures reprises (aucun le 13/11/2026) : le cabinet décide d''abord (ses imports retirés, ou le dossier ramené en trésorerie), puis la migration se rejoue.',
      v_dossiers;
  end if;
end
$garde$;

-- ══ 1. La garde du réglage du modèle comptable : les factures reprises retiennent la trésorerie ══════════
create or replace function public.verrouiller_modele_comptable() returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  if (new.mode_comptable is distinct from old.mode_comptable
      or new.compte_notes_de_frais is distinct from old.compte_notes_de_frais)
     and exists (select 1 from public.ecritures_brouillon e where e.dossier_id = new.id) then
    raise exception 'Le modèle comptable d''un dossier ne se change que tant que son brouillon d''écritures est vide.'
      using errcode = '23514';
  end if;
  -- A8B-Q3 : un dossier qui porte des factures reprises d'un ancien logiciel (une facture ou un avoir à l'état « importee »)
  -- ne passe pas en engagement — le pendant du refus de l'import en engagement (A8-Q3, `importer_factures`). Après le
  -- brouillon : un brouillon qui n'est pas vide se dit d'abord, comme l'écran le dit.
  if new.mode_comptable is distinct from old.mode_comptable and new.mode_comptable = 'engagement'
     and exists (select 1 from public.factures_emises f where f.dossier_id = new.id and f.statut = 'importee') then
    raise exception 'Ce dossier porte des factures reprises d''un ancien logiciel : il ne passe pas en comptabilité d''engagement, où la créance d''une facture d''avant serait au compte client de la reprise, que l''application n''écrit pas encore.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- ══ 2. La garde de fin : le corps de cette migration, toujours invoker, et son déclencheur ══════════
do $fin$
begin
  if (select md5(replace(p.prosrc, chr(13) || chr(10), chr(10))) from pg_catalog.pg_proc p
       where p.oid = to_regprocedure('public.verrouiller_modele_comptable()')) is distinct from '2a25b53f2d34b7c1ba811dd1ca4f323f'
     or (select p.prosecdef from pg_catalog.pg_proc p where p.oid = to_regprocedure('public.verrouiller_modele_comptable()'))
     or not exists (select 1 from pg_catalog.pg_trigger t
                     where t.tgrelid = 'public.dossiers'::regclass and t.tgname = 'dossiers_verrouiller_modele_comptable'
                       and t.tgfoid = 'public.verrouiller_modele_comptable()'::regprocedure and t.tgenabled = 'O') then
    raise exception 'A8B-Q3 : la garde du modèle comptable n''est pas celle de cette migration, ou son déclencheur ne l''appelle plus : rien n''est appliqué.';
  end if;
end
$fin$;
