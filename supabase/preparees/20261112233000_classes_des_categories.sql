-- PC7-Q2 — LA CLASSE DU COMPTE D'UNE CATÉGORIE DU DOSSIER, EN BASE (ligne 43 de la feuille de route ; PRÉPARÉE le
-- 12/11/2026, PAS APPLIQUÉE). La réponse du cabinet : PC7-Q2 (B), « Oui, en lot à part » (12/11/2026). Le récit :
-- HISTORIQUE.md, « 12/11/2026 — PC7-Q2 : LA CLASSE DU COMPTE D'UNE CATÉGORIE DU DOSSIER, EN BASE (PRÉPARÉE, PAS
-- APPLIQUÉE) » ; l'essai : supabase/essais/categoriesDuDossier.sql (étapes 40 à 49) ; le retour :
-- supabase/preparees/retour/20261112233100_retour_classes_des_categories.sql ; le module qui redit le refus avant le clic :
-- src/lib/categoriesDuDossier.ts (`refusDeLaClasse` ; `CLASSES_DES_CATEGORIES_PREVUES`, baissé jusqu'à l'application,
-- porte le refus dit par la carte « Comptes manquants » de l'onglet Écritures).
--
-- SOURCES. Le plan comptable général (règlement ANC n° 2014-03 consolidé au 1er janvier 2026), art. 1121-1 et sa liste
-- (la classe 6, les comptes de charges ; la classe 7, les comptes de produits) et art. 1131-1 (un compte divisionnaire
-- commence par le numéro du compte qu'il subdivise : son premier chiffre dit sa classe). PostgreSQL 17, « CREATE
-- FUNCTION » (CREATE OR REPLACE garde la fonction, son propriétaire et ses droits, et le déclencheur qui l'appelle ; ses
-- autres propriétés sont celles que l'instruction dit) ; « Overview of Trigger Behavior » (un déclencheur BEFORE … FOR EACH
-- ROW qui lève annule l'instruction) ; « Pattern Matching » (`!~`, une expression rationnelle POSIX).
--
-- POURQUOI. La garde de PC7 (`categories_du_dossier`) ne juge pas la FORME du compte : l'écran des catégories du dossier
-- n'accepte qu'un compte de classe 6 ou 7, mais une catégorie créée autrement, par l'API, sur un compte de tiers — un 401 —
-- ou de bilan passerait la garde des comptes des pièces (`garder_comptes_des_pieces` laisse une ligne de pièce sur le
-- compte de la catégorie de sa pièce, sous une racine que le plan garde) et le refus 9 de `regler_plan_du_dossier` se
-- jugerait contre elle. Les fonctions du relevé la refusent à l'emploi (« n'a pas de compte de charge ou de produit (classe
-- 6 ou 7) ») ; la génération des écritures d'une pièce, qui ne passe par aucune fonction, l'écrirait.
--
-- L'ÉTAT RELU EN PRODUCTION (SELECT, 12/11/2026 ; 205 migrations, la dernière 20261112134639, empreinte de dérive
-- 10d4a154…) : `garder_categorie_du_dossier()` est le corps de `categories_du_dossier` (version 20261112134532), 2 359
-- caractères sans retour chariot, empreinte 0e1ee2d3f53ba1dca8adecd31843edeb, `security definer`, au chemin vide,
-- exécutable par aucun rôle de l'API ; un déclencheur, `categories_du_dossier` (BEFORE, FOR EACH ROW, sur l'insertion,
-- la mise à jour et le retrait d'une ligne ; actif). `categories` : dix lignes, toutes communes, toutes sur un compte de charge ou de produit ; AUCUNE
-- catégorie propre à un dossier, donc aucune hors des classes 6 et 7 : ni contrainte NOT VALID ni reprise de données, le
-- refus à l'écriture suffit. La garde de tête recompte à l'application : une ligne apparue depuis l'arrête, et le dit.
--
-- CE QU'ELLE FAIT : elle remplace le corps de la garde par le même, plus un refus (e) : une catégorie du dossier
-- (`dossier_id` non nul), à l'insertion ou quand son compte change, dont le compte, non nul, n'est pas de la classe 6 ou
-- 7 suivie de deux chiffres (`^[67][0-9]{2}`, le prédicat des fonctions du relevé) — 23514. L'ordre des refus : (d) à la
-- suppression ; (a) le dossier changé ; les catégories communes passent ; (e) ; la porte de la restauration ; (b) le code
-- d'une commune ; (c) le barème. Les refus d'hier gardent leur ordre et leurs mots.
--   - (e) vient AVANT la porte de la restauration, pour tout auteur, le super-administrateur compris : la porte existe pour
--     ce qui lit d'autres lignes (les codes des communes, le plan du dossier), que la restauration n'a peut-être pas encore
--     réécrites ou qui ont changé depuis la sauvegarde ; la classe ne dépend que de la ligne. Et le chef du cabinet est
--     aujourd'hui aussi super-administrateur : derrière la porte, l'insertion par l'API du compte même qui tient l'écran
--     échapperait au refus. Une sauvegarde ne porte aucune ligne qu'il refuserait (aucune en production, et plus aucun
--     chemin ne l'écrit) ; s'il en surgissait une, la restauration s'arrêterait sur ce refus, sous ses mots.
--   - (e) vient avant (b) et (c) : l'écran juge la forme du compte avant le barème (`jugerLaCategorie`), et la base dit le
--     même refus le premier.
-- CE QU'ELLE LAISSE PASSER : une catégorie COMMUNE (`dossier_id` nul) — ses policies la réservent au super-administrateur,
-- et la réponse PC7-Q2 vise les catégories propres à un dossier ; les communes sont une question à part (PC7Q2-Q1) ; un
-- compte NUL — la catégorie attend le sien (la carte « Comptes manquants »), les fonctions du relevé refusent son emploi et
-- la pièce n'écrit rien : la classe se juge quand le compte se pose ; une catégorie dont le compte ne change pas (libellé,
-- poste, code), comme (c). La forme fine (six chiffres, trois significatifs au moins) reste à l'écran
-- (`compteDeCategorie`).
--
-- CE QU'ELLE NE CHANGE PAS : aucune donnée, aucune policy, aucun déclencheur ; la fonction garde son identifiant, son
-- propriétaire, ses droits et le déclencheur qui l'appelle ; elle reste `security definer`, au chemin vide, et le `revoke`
-- redit qu'aucun rôle de l'API ne l'exécute. Le texte ne porte aucun mot de suppression hors de `tg_op = 'DELETE'`, que le
-- corps d'hier porte déjà, ni barre oblique inverse : par l'outil. Le retour rend le corps d'hier à l'octet près.

-- La garde de tête : la garde d'hier, son déclencheur, et aucune catégorie du dossier hors des classes 6 et 7.
do $garde$
declare
  v_empreinte text;
  v_hors_classe bigint;
begin
  select md5(replace(p.prosrc, chr(13) || chr(10), chr(10))) into v_empreinte
    from pg_catalog.pg_proc p where p.oid = to_regprocedure('public.garder_categorie_du_dossier()');
  if v_empreinte is distinct from '0e1ee2d3f53ba1dca8adecd31843edeb' then
    raise exception 'PC7-Q2 : la garde des catégories du dossier n''est pas celle de categories_du_dossier (empreinte %) : la migration se prépare contre celle-là.',
      coalesce(v_empreinte, 'absente');
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger t
                  where t.tgrelid = 'public.categories'::regclass and t.tgname = 'categories_du_dossier'
                    and t.tgfoid = 'public.garder_categorie_du_dossier()'::regprocedure
                    and t.tgtype = 31 and t.tgenabled = 'O') then
    raise exception 'PC7-Q2 : le déclencheur categories_du_dossier (BEFORE, FOR EACH ROW, sur les trois évènements, actif) n''appelle plus la garde : la remplacer ne poserait aucun refus.';
  end if;
  select count(*) into v_hors_classe
    from public.categories c
   where c.dossier_id is not null and c.compte_comptable is not null and c.compte_comptable !~ '^[67][0-9]{2}';
  if v_hors_classe > 0 then
    raise exception 'PC7-Q2 : % catégorie(s) d''un dossier porte(nt) déjà un compte hors des classes 6 et 7 (aucune le 12/11/2026) : le cabinet décide d''abord (le refus à l''écriture seul, ou une contrainte NOT VALID).',
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
