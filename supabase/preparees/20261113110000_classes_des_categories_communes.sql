-- PC7Q2-Q1 — LA CLASSE DU COMPTE D'UNE CATÉGORIE COMMUNE, EN BASE (ligne 43 de la feuille de route ; PRÉPARÉE le
-- 13/11/2026, PAS APPLIQUÉE ; à appliquer APRÈS `classes_des_categories`, PC7-Q2, dont elle prend le corps). La réponse du
-- cabinet : PC7Q2-Q1 (A), « Oui, dans un lot à part ». Le récit : HISTORIQUE.md, « 13/11/2026 — PC7Q2-Q1 : LA CLASSE DU
-- COMPTE D'UNE CATÉGORIE COMMUNE, EN BASE (PRÉPARÉE, PAS APPLIQUÉE) » ; l'essai : supabase/essais/categoriesDuDossier.sql
-- (l'étape 45 et les étapes 50 à 59) ; le retour :
-- supabase/preparees/retour/20261113110100_retour_classes_des_categories_communes.sql ; le module qui redit le refus avant
-- le clic : src/lib/categoriesDuDossier.ts (`refusDeLaClasseCommune` ; `CLASSES_DES_CATEGORIES_COMMUNES_PREVUES`, baissé
-- jusqu'à l'application, porte le refus que la carte « Comptes manquants » de l'onglet Écritures dit au
-- super-administrateur).
--
-- SOURCES. Le plan comptable général (règlement ANC n° 2014-03 consolidé au 1er janvier 2026), art. 1121-1 et sa liste
-- (la classe 6, les comptes de charges ; la classe 7, les comptes de produits) et art. 1131-1 (un compte divisionnaire
-- commence par le numéro du compte qu'il subdivise : son premier chiffre dit sa classe). PostgreSQL 17, « CREATE
-- FUNCTION » (CREATE OR REPLACE garde la fonction, son propriétaire et ses droits, et le déclencheur qui l'appelle ; ses
-- autres propriétés sont celles que l'instruction dit) ; « Overview of Trigger Behavior » (un déclencheur BEFORE … FOR EACH
-- ROW qui lève annule l'instruction) ; « Pattern Matching » (`!~`, une expression rationnelle POSIX).
--
-- POURQUOI. Une catégorie COMMUNE (`dossier_id` nul) sert les dossiers de tous les cabinets : son compte part dans chaque
-- écriture d'une pièce qui la porte, que la génération des écritures compose sans passer par aucune fonction de la base
-- (lib/ecritures.ts), puis dans le FEC. La garde de PC7-Q2 laisse passer les communes — c'était cette question-ci —, la
-- carte « Comptes manquants » ne demande au super-administrateur que trois chiffres en tête (ce que le FEC exige), et l'API
-- rien : un 401 ou un 512 posé sur une commune rangerait une charge au compte d'un tiers ou de la banque dans tous les
-- dossiers qui l'emploient. Les fonctions du relevé la refusent à l'emploi (« n'a pas de compte de charge ou de produit
-- (classe 6 ou 7) ») ; la pièce l'écrirait.
--
-- L'ÉTAT DE DÉPART. L'outil Supabase n'étant pas joignable le 13/11/2026, rien n'a été relu en production pour ce lot :
-- l'export porte 217 migrations (dérive edea63cd…, celle de la production le 12/11/2026), dont aucune n'écrit le compte
-- d'une commune (le semis du 26/08/2026 en pose neuf sans compte ; leurs comptes sont venus de l'écran du
-- super-administrateur) ; relu en production le 12/11/2026 pour PC7-Q2 : dix catégories, toutes communes, toutes sur un
-- compte de charge ou de produit. La garde de tête recompte à l'application : une commune hors des classes 6 et 7
-- l'arrête, et le dit — le cabinet décide alors (son compte corrigé par le super-administrateur, puis la migration
-- rejouée). La requête de lecture qui les compte d'avance est dans le récit.
--
-- CE QU'ELLE FAIT : elle remplace le corps de la garde de PC7-Q2 (empreinte dadd05a4…) par le même, plus un refus (f) :
-- une catégorie COMMUNE, à l'insertion ou quand son compte change, dont le compte, non nul, n'est pas de la classe 6 ou 7
-- suivie de deux chiffres (`^[67][0-9]{2}`, le prédicat de (e) et des fonctions du relevé) — 23514, à ses mots, que l'écran
-- redit. L'ordre des refus : (d) à la suppression ; (a) le dossier changé ; (f) ; les communes passent ; (e) ; la porte de
-- la restauration ; (b) le code d'une commune ; (c) le barème. Les refus d'hier gardent leur ordre et leurs mots.
--   - (f) vaut pour tout auteur. Seul le super-administrateur écrit une commune (ses policies), par l'écran, par l'API, ou
--     par la restauration, qui réinsère une commune absente de la base d'arrivée ; la porte de la restauration ne s'ouvre
--     qu'aux catégories du dossier, après (e). Une sauvegarde ne porte aucune commune que (f) refuserait (aucune en
--     production) ; s'il en surgissait une, la restauration s'arrêterait sur ce refus, sous ses mots.
--   - (f) vient après (a) : une catégorie du dossier qu'on rendrait commune sur un compte hors classe se dit d'abord par
--     (a), comme (e).
--   - (f) se tient à part de (e), avant le retour des communes : ses mots nomment la commune, et (e) reste celui des
--     catégories du dossier, inchangé.
--   - Pour le chef d'un cabinet qui n'est pas super-administrateur, rien ne s'ouvre : sa mise à jour d'une commune ne
--     touche aucune ligne (la policy l'écarte avant tout déclencheur) ; son insertion d'une commune se refuse comme hier
--     (42501), ou, hors classe, par (f), que le déclencheur BEFORE dit avant l'expression WITH CHECK de la policy (vu sur la
--     réplique en PostgreSQL 17, étapes 58 et 59 de l'essai) — un refus aussi, sans rien écrire.
-- CE QU'ELLE LAISSE PASSER : un compte NUL — la commune attend le sien (la carte « Comptes manquants »), les fonctions du
-- relevé refusent son emploi et la pièce n'écrit rien : la classe se juge quand le compte se pose ; une commune dont le
-- compte ne change pas (libellé, poste, ordre, code), comme (e). La forme fine (six chiffres) reste à l'écran.
--
-- CE QU'ELLE NE CHANGE PAS : aucune donnée, aucune policy, aucun déclencheur ; la fonction garde son identifiant, son
-- propriétaire, ses droits et le déclencheur qui l'appelle ; elle reste `security definer`, au chemin vide, et le `revoke`
-- redit qu'aucun rôle de l'API ne l'exécute. Le texte ne porte aucun mot de suppression hors de `tg_op = 'DELETE'`, que le
-- corps d'hier porte déjà, ni barre oblique inverse : par l'outil. Le retour rend le corps de PC7-Q2 à l'octet près.

-- La garde de tête : la garde de PC7-Q2, son déclencheur, et aucune catégorie commune hors des classes 6 et 7.
do $garde$
declare
  v_empreinte text;
  v_hors_classe bigint;
begin
  select md5(replace(p.prosrc, chr(13) || chr(10), chr(10))) into v_empreinte
    from pg_catalog.pg_proc p where p.oid = to_regprocedure('public.garder_categorie_du_dossier()');
  if v_empreinte is distinct from 'dadd05a400c277832ce0261c8eb15544' then
    raise exception 'PC7Q2-Q1 : la garde des catégories n''est pas celle de classes_des_categories, PC7-Q2 (empreinte %) : cette migration s''applique après elle, contre elle.',
      coalesce(v_empreinte, 'absente');
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger t
                  where t.tgrelid = 'public.categories'::regclass and t.tgname = 'categories_du_dossier'
                    and t.tgfoid = 'public.garder_categorie_du_dossier()'::regprocedure
                    and t.tgtype = 31 and t.tgenabled = 'O') then
    raise exception 'PC7Q2-Q1 : le déclencheur categories_du_dossier (BEFORE, FOR EACH ROW, sur les trois évènements, actif) n''appelle plus la garde : la remplacer ne poserait aucun refus.';
  end if;
  select count(*) into v_hors_classe
    from public.categories c
   where c.dossier_id is null and c.compte_comptable is not null and c.compte_comptable !~ '^[67][0-9]{2}';
  if v_hors_classe > 0 then
    raise exception 'PC7Q2-Q1 : % catégorie(s) commune(s) porte(nt) déjà un compte hors des classes 6 et 7 (aucune le 12/11/2026) : le cabinet décide d''abord (son compte corrigé par le super-administrateur, puis la migration rejouée).',
      v_hors_classe;
  end if;
end
$garde$;

create or replace function public.garder_categorie_du_dossier()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fonction$
declare
  v_bareme text;
begin
  if tg_op = 'DELETE' then
    -- d. La seule citation qu'aucune clé ne garde. La cascade de la suppression du dossier passe : le dossier n'est plus là
    --    quand ses catégories partent, et il ne cite qu'une catégorie à lui ou commune (`garder_categorie_recettes_client`).
    if exists (select 1 from public.dossiers d where d.categorie_recettes_client = old.id) then
      raise exception 'La catégorie « % » est la nature des recettes en espèces du client : elle ne se supprime pas tant qu''elle l''est.', old.libelle
        using errcode = '23503';
    end if;
    return old;
  end if;

  -- a. Une catégorie ne change pas de dossier.
  if tg_op = 'UPDATE' and new.dossier_id is distinct from old.dossier_id then
    raise exception 'Une catégorie ne change pas de dossier, ni ne devient commune ou propre à un dossier : ce qui la cite resterait où il est.'
      using errcode = '23514';
  end if;

  -- f. Le compte d'une catégorie COMMUNE à tous les cabinets est, lui aussi, un compte de charge ou de produit : le
  --    prédicat de (e), sous ses mots à elle (PC7Q2-Q1). Pour tout auteur : seul le super-administrateur écrit une commune,
  --    par l'écran, l'API ou la restauration. Un compte nul attend le sien ; un compte qui ne change pas ne se rejuge pas.
  if new.dossier_id is null
     and new.compte_comptable is not null
     and (tg_op = 'INSERT' or new.compte_comptable is distinct from old.compte_comptable)
     and new.compte_comptable !~ '^[67][0-9]{2}' then
    raise exception 'Le compte « % » n''est pas un compte de charge ou de produit (classe 6 ou 7, trois chiffres en tête) : une catégorie commune à tous les cabinets ne range qu''une charge ou un produit.', new.compte_comptable
      using errcode = '23514';
  end if;
  if new.dossier_id is null then
    return new;
  end if;

  -- e. Le compte d'une catégorie du dossier est un compte de charge ou de produit : la classe 6 ou 7, puis deux chiffres —
  --    le prédicat que les fonctions du relevé opposent déjà à l'emploi d'une catégorie (PC7-Q2). Pour tout auteur, AVANT la
  --    porte de la restauration : la classe ne dépend que de la ligne. Un compte nul attend le sien ; un compte qui ne
  --    change pas ne se rejuge pas.
  if new.compte_comptable is not null
     and (tg_op = 'INSERT' or new.compte_comptable is distinct from old.compte_comptable)
     and new.compte_comptable !~ '^[67][0-9]{2}' then
    raise exception 'Le compte « % » n''est pas un compte de charge ou de produit (classe 6 ou 7, trois chiffres en tête) : une catégorie du dossier ne range qu''une charge ou un produit.', new.compte_comptable
      using errcode = '23514';
  end if;

  -- La restauration : le super-administrateur réinsère les catégories du dossier avant de relire son plan ; la porte ne
  -- s'ouvre que sur (b) et (c), qui lisent d'autres lignes.
  if tg_op = 'INSERT' and public.is_super_admin() then
    return new;
  end if;

  -- b. Le code d'une catégorie commune.
  if (tg_op = 'INSERT' or new.code is distinct from old.code)
     and exists (select 1 from public.categories c where c.dossier_id is null and c.code = new.code) then
    raise exception 'Le code « % » est celui d''une catégorie commune à tous les cabinets : une catégorie du dossier en prend un autre.', new.code
      using errcode = '23514';
  end if;

  -- c. Le compte du barème kilométrique du plan, à des zéros près (le refus 10 de `regler_plan_du_dossier`, de ce côté-ci).
  if new.compte_comptable is not null
     and (tg_op = 'INSERT' or new.compte_comptable is distinct from old.compte_comptable) then
    perform pg_advisory_xact_lock_shared(public.cle_validation(new.dossier_id));
    v_bareme := public.compte_du_role(new.dossier_id, 'indemnites_kilometriques');
    if rtrim(new.compte_comptable, '0') = rtrim(v_bareme, '0') then
      raise exception 'Le compte « % » est celui des indemnités kilométriques du plan de ce dossier (« % »), à des zéros près : le barème et les frais réels restent séparés.',
        new.compte_comptable, v_bareme using errcode = '23514';
    end if;
  end if;
  return new;
end
$fonction$;

revoke all on function public.garder_categorie_du_dossier() from public, anon, authenticated;
