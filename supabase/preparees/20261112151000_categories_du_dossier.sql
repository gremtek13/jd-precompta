-- PC7 — LES CATÉGORIES DU DOSSIER : LA GARDE DE LA TABLE (ligne 43 de la feuille de route ; PRÉPARÉE le 12/11/2026, PAS
-- APPLIQUÉE). La conception : HISTORIQUE.md, « LE PLAN COMPTABLE PERSONNALISABLE : LA CONCEPTION » (§ 3.8, point 4 ; la
-- ligne PC7 du découpage ; § 9, point 2 ; Q9 « a oui, b ligne à part ») ; le récit : « 12/11/2026 — PC7 : LES CATÉGORIES
-- DU DOSSIER, DONT CELLES DE SA BALANCE » ; l'essai : supabase/essais/categoriesDuDossier.sql ; le retour :
-- supabase/preparees/retour/20261112151100_retour_categories_du_dossier.sql ; le module qui redit ses refus avant le
-- clic : src/lib/categoriesDuDossier.ts (`CATEGORIES_DU_DOSSIER_PREVUES`, baissé jusqu'à l'application).
--
-- SOURCES. Le plan comptable général (règlement ANC n° 2014-03 consolidé au 1er janvier 2026), art. 1131-2 (deux numéros
-- qui ne diffèrent que par leurs zéros de fin désignent le même compte global) ; PostgreSQL 17, « Overview of Trigger
-- Behavior » (un déclencheur BEFORE … FOR EACH ROW qui lève annule l'instruction) et « Advisory Lock Functions » ;
-- « Constraints » (une clé étrangère NO ACTION ne se juge qu'à la fin de l'instruction).
--
-- L'ÉTAT RELU EN PRODUCTION (SELECT, 12/11/2026 ; 200 migrations, la dernière 20261111204559) : `categories` porte quatre
-- policies (lecture `to authenticated` ; insertion, mise à jour et suppression sur `(dossier_id is null and
-- is_super_admin()) or (dossier_id is not null and admin_du_dossier(dossier_id))`), aucune contrainte de forme, aucun
-- déclencheur ; dix catégories, toutes communes. Elles SUFFISENT au droit : le cabinet qui administre le dossier crée,
-- modifie et supprime ses catégories, le client n'en écrit aucune. Elles ne disent rien du CONTENU, que trois relations
-- jugent d'un seul côté :
--   1. `regler_plan_du_dossier` (PC4, refus 10) refuse les indemnités kilométriques changées vers le compte d'une
--      catégorie que le dossier emploie, à des zéros près — le barème et les frais réels restent séparables ; rien ne
--      refuse une catégorie posée sur le compte du barème (« un contrôle qui part d'un côté d'une relation ne voit pas
--      l'autre »). Dès que l'écran de PC7 crée des catégories, la relation se rompt par ce côté-là.
--   2. La policy de mise à jour juge l'ancienne ligne et la nouvelle, pas leur lien : un chef qui administre deux dossiers
--      déplace une catégorie de l'un à l'autre, et les pièces du premier citent alors la catégorie du second.
--   3. `dossiers.categorie_recettes_client` (la nature des recettes en espèces du client, C10) cite une catégorie SANS clé
--      étrangère (`garder_categorie_recettes_client` ne la juge qu'à l'écriture du dossier) : supprimer la catégorie la
--      laisse pendre. Les six autres tables qui la citent ont leur clé NO ACTION, qui refuse en anglais.
-- Et le code : `(dossier_id, code)` est unique, deux NULL distincts ; une catégorie du dossier peut donc prendre le code
-- d'une commune, et la proposition de catégorie (`lib/categorisationIa.ts`) rend un CODE au modèle et le relit.
--
-- CE QU'ELLE FAIT : un déclencheur BEFORE INSERT OR UPDATE OR DELETE, FOR EACH ROW, sur `categories`, qui refuse :
--   a. (mise à jour, toute catégorie) un `dossier_id` changé — d'un dossier à l'autre, vers une commune ou depuis une
--      commune (23514) ;
--   b. (catégorie d'un dossier, insertion ou code changé) le code d'une catégorie commune (23514) ;
--   c. (catégorie d'un dossier, insertion ou compte changé) le compte des indemnités kilométriques du plan du dossier, à
--      des zéros près — la comparaison du refus 10, sous le verrou partagé de la validation du dossier que
--      `regler_plan_du_dossier` prend exclusif : l'un attend l'autre, et le second relit ce que le premier a validé
--      (23514) ;
--   d. (suppression, toute catégorie) la nature des recettes en espèces du client d'un dossier (23503) — la seule
--      citation sans clé ; les six autres gardent leur clé NO ACTION et son message (`caisseSuppression.sql` l'épingle),
--      que l'écran devance en comptant les emplois avant le clic.
-- Elle laisse passer, comme hier : une catégorie commune (ses policies la réservent au super-administrateur), sauf (a) et
-- (d) ; l'insertion du super-administrateur (la restauration, qui ne relit pas le plan avant ses catégories) ; la cascade
-- de la suppression du dossier — le dossier n'est plus là quand ses catégories partent, ses pièces partent dans la même
-- instruction (leur clé ne juge qu'à sa fin : RESTAU-Q4) ; la règle d'un cabinet (`tiers_categories_cabinet`) qui vise
-- une catégorie propre part avec elle, comme RESTAU-Q4 l'a voulu. Elle ne juge ni la FORME du compte ni le POSTE : la
-- forme, l'écran la tient (six chiffres, classe 6 ou 7) et les fonctions du relevé la refusent à l'emploi (trois essais
-- posent exprès une catégorie sur un compte de bilan pour l'éprouver : `affectation`, `ventilation`,
-- `reglerLePlanDuDossier`) — PC7-Q2 ; le poste, la validation de l'exercice le juge contre sa liste fermée.
--
-- CE QU'ELLE NE CHANGE PAS : aucune donnée, aucune policy, aucune fonction existante ; une fonction neuve, `security
-- definer` (elle lit le plan et les tables qui citent la catégorie au-delà de la RLS de l'appelant), au chemin vide,
-- exécutable par aucun rôle. Aucune suppression ni `drop` : le texte porte le mot des événements du déclencheur et de
-- `tg_op`, la forme de `trace_des_droits` et d'`adresse_des_acces_retires`, passées par l'outil.

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
  -- La restauration : le super-administrateur réinsère les catégories du dossier avant de relire son plan.
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

create trigger categories_du_dossier
  before insert or update or delete on public.categories
  for each row execute function public.garder_categorie_du_dossier();
