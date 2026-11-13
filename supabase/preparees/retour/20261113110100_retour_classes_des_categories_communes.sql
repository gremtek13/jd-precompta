-- RETOUR de la migration `classes_des_categories_communes` (PC7Q2-Q1, ligne 43 ;
-- supabase/preparees/20261113110000_classes_des_categories_communes.sql). Rend à `garder_categorie_du_dossier` le corps de
-- `classes_des_categories` (PC7-Q2), à l'octet près (empreinte dadd05a400c277832ce0261c8eb15544) : une catégorie commune
-- hors des classes 6 et 7 repasse, comme avant ; celle d'un dossier reste refusée par (e). Aucune donnée n'est touchée : les
-- communes posées sous le refus restent telles quelles. Baisser `CLASSES_DES_CATEGORIES_COMMUNES_PREVUES` D'ABORD
-- (src/lib/categoriesDuDossier.ts), puis déployer, puis ce retour : la carte « Comptes manquants » redit le refus de la
-- base, qui sans lui ne le tiendrait plus. Le retour de PC7-Q2 ne s'applique qu'après celui-ci (sa garde de tête attend le
-- corps rendu ici). Rien n'y est retiré — la fonction se remplace, son déclencheur et ses droits restent — : par l'outil.

-- La garde de tête : la garde est celle que la migration a posée.
do $garde$
declare
  v_empreinte text;
begin
  select md5(replace(p.prosrc, chr(13) || chr(10), chr(10))) into v_empreinte
    from pg_catalog.pg_proc p where p.oid = to_regprocedure('public.garder_categorie_du_dossier()');
  if v_empreinte is distinct from 'b19a83ecfc17c0f186a80e4a84ac71ff' then
    raise exception 'Retour de PC7Q2-Q1 : la garde des catégories n''est pas celle de classes_des_categories_communes (empreinte %) : rien n''est rendu.',
      coalesce(v_empreinte, 'absente');
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
