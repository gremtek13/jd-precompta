-- LA VALIDATION D'UN EXERCICE REFUSE UNE OUVERTURE DE LA BANQUE QUI N'EST PAS ÉCLATÉE À JOUR (ligne 26.6, lot MCB5 ; MCB5G-Q2,
-- à la recommandation : un filet en base). PRÉPARÉE le 11/11/2026, pas appliquée ; elle suit `ouverture_eclatee_par_compte`
-- (20261111235000), elle-même après `comptes_bancaires` (MCB1). Le récit : HISTORIQUE.md, « 11/11/2026 — MCB5G-Q2 : LA
-- VALIDATION REFUSE UNE OUVERTURE NON ÉCLATÉE (LIGNE 26.6) ». Son essai : supabase/essais/ouvertureEclatee.sql (contrôles
-- 40 à 51) ; son retour : supabase/preparees/retour/20261111235600_retour_ouverture_eclatee_a_la_validation.sql ; ses mots :
-- `REFUS_DE_LA_VALIDATION` (src/lib/ouvertureEclatee.ts), que le préalable `ouverture-a-eclater` dit avant le clic.
--
-- LE DÉFAUT. L'exercice qui s'ouvre au 512 du rôle avec l'argent de tous les comptes bancaires, dont un tient son 512 propre
-- depuis ce 1er janvier, ne se lit juste qu'avec l'écriture qui éclate cette ouverture entre les 512, à jour des relevés de la
-- veille. Seule l'application le disait (le préalable `ouverture-a-eclater`) : `valider_exercice` validait l'exercice sans
-- elle — le 512 du principal parti trop haut, celui du second compte de zéro, figés ensemble —, ou avec une écriture qu'un
-- relevé corrigé depuis avait rendue fausse, ou qui n'avait plus rien à éclater.
--
-- CE QUI CHANGE, ET RIEN D'AUTRE : un déclencheur sur `exercices_valides`, avant l'insertion, sans réécrire `valider_exercice`
-- (qui insère la ligne de l'exercice après tous ses refus, ses écritures déjà numérotées, et avant d'écrire l'ouverture du
-- suivant) : il recompose l'éclatement que l'ouverture de l'exercice commande (`ouverture_eclatee_attendue`) et le compare EN
-- MULTIENSEMBLE aux lignes du brouillon qui portent la source, datées de son 1er janvier — le compte bancaire, le compte, le
-- sens, les centimes, le libellé, comme `ecrire_ouverture_eclatee` et `etatDeLEclatement`. Il refuse, aux mots du préalable :
--   - rien à éclater et une écriture qui éclate : « la retirer » ;
--   - un éclatement attendu et aucune écriture : « n'est pas écrite » ;
--   - une écriture qui n'est plus celle que les relevés commandent : « la réécrire » ;
--   - et les refus de la recomposition, tels quels : l'ouverture attendue, un relevé qui manque, deux qui se contredisent, une
--     somme qui ne fait pas l'ouverture du 512 du rôle (la carte et le préalable disent alors l'éclatement « retenu »).
-- Un dossier à un seul compte, sans compte bancaire, ou dont aucun compte ne sort du 512 du rôle ce 1er janvier : la
-- recomposition ne rend rien, le brouillon ne porte aucune ligne de cette source, et la validation passe comme hier.
--
-- QUI EST JUGÉ. `valider_exercice` est `security definer` : la ligne de l'exercice s'insère sous son propriétaire, et le
-- déclencheur — aux droits de l'appelant, pas en definer — le voit et juge. Sous le rôle de l'API (`authenticated`), seule la
-- restauration d'une sauvegarde insère un exercice validé (la policy `exercices_valides_restauration` n'y admet que le
-- super-administrateur) : elle réinsère ce que la sauvegarde porte, sans le rejuger — des relevés retouchés depuis, ou un
-- exercice validé avant ce filet, ne doivent pas l'arrêter ; l'empreinte de l'exercice, elle, se vérifie. Écarté : exempter le
-- super-administrateur (`is_super_admin()`), qui sur ce projet est aussi le chef du cabinet — toutes ses validations auraient
-- échappé au filet. La garde de tête exige que `valider_exercice` reste definer : invoker, elle insérerait sous le rôle de
-- l'API, et le filet se tairait.
--
-- L'ORDRE. Le déclencheur se nomme `exercices_valides_ouverture_eclatee` : PostgreSQL déclenche les gardes d'une table dans
-- l'ordre de leur NOM, et celle de la conservation d'un dossier qui part (`exercices_valides_dossier_conserve`, préparée par
-- `depart_du_client`) le précède — un dossier conservé se dit d'abord.
--
-- Ni table, ni colonne, ni policy, ni droit ouvert ; aucune suppression : l'outil la prend.

-- ══ 0. La garde de tête ══
do $garde$
begin
  if to_regprocedure('public.ouverture_eclatee_attendue(uuid, integer)') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public'
                     and table_name = 'ecritures_brouillon' and column_name = 'ouverture_compte_bancaire_id') then
    raise exception 'La migration ouverture_eclatee_a_la_validation suit ouverture_eclatee_par_compte (MCB5) : appliquer celle-ci d''abord.';
  end if;
  if to_regprocedure('public.garder_ouverture_eclatee_a_la_validation()') is not null
     or exists (select 1 from pg_trigger where tgrelid = 'public.exercices_valides'::regclass
                 and tgname = 'exercices_valides_ouverture_eclatee') then
    raise exception 'La migration ouverture_eclatee_a_la_validation est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if not exists (select 1 from pg_proc where oid = 'public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb)'::regprocedure
                  and prosecdef) then
    raise exception 'valider_exercice n''est plus en security definer : le filet de l''ouverture éclatée se tairait sous le rôle de l''API. Relire la migration contre la base.';
  end if;
end
$garde$;

-- ══ 1. Le filet ══
create function public.garder_ouverture_eclatee_a_la_validation() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_debut date := make_date(new.annee, 1, 1);
  v_veille date := make_date(new.annee - 1, 12, 31);
  v_attendues bigint;
  v_ecrites bigint;
  v_ecart boolean;
begin
  -- La restauration d'une sauvegarde, seule à insérer sous le rôle de l'API : elle ne se rejuge pas.
  if current_user = 'authenticated' then
    return new;
  end if;
  -- L'éclatement que l'ouverture commande — ses refus retiennent la validation à leurs mots —, puis ce que le brouillon porte
  -- de cette source à ce 1er janvier, comparés en multiensemble.
  with attendues as (
    select a.compte_bancaire_id as cb, a.compte, a.sens, a.centimes, a.libelle
      from public.ouverture_eclatee_attendue(new.dossier_id, new.annee) a
  ), ecrites as (
    select e.ouverture_compte_bancaire_id as cb, e.compte, e.sens, round(e.montant * 100)::bigint as centimes, e.libelle
      from public.ecritures_brouillon e
     where e.dossier_id = new.dossier_id and e.date = v_debut and e.ouverture_compte_bancaire_id is not null
  )
  select (select count(*) from attendues), (select count(*) from ecrites),
         exists (select cb, compte, sens, centimes, libelle from attendues
                 except all select cb, compte, sens, centimes, libelle from ecrites)
         or exists (select cb, compte, sens, centimes, libelle from ecrites
                    except all select cb, compte, sens, centimes, libelle from attendues)
    into v_attendues, v_ecrites, v_ecart;
  if v_attendues = 0 and v_ecrites > 0 then
    raise exception 'Une écriture éclate l’ouverture de la banque au %, alors que plus rien n’est à éclater : la retirer.',
      to_char(v_debut, 'DD/MM/YYYY') using errcode = '23514';
  end if;
  if v_attendues > 0 and v_ecrites = 0 then
    raise exception 'L’ouverture du % porte au compte de banque du rôle l’argent de tous les comptes bancaires : l’écriture qui passe le solde de chaque compte à son 512, d’après ses relevés du %, n’est pas écrite.',
      to_char(v_debut, 'DD/MM/YYYY'), to_char(v_veille, 'DD/MM/YYYY') using errcode = '23514';
  end if;
  if v_ecart then
    raise exception 'L’écriture qui éclate l’ouverture de la banque au % n’est plus celle que les relevés du % commandent : la réécrire.',
      to_char(v_debut, 'DD/MM/YYYY'), to_char(v_veille, 'DD/MM/YYYY') using errcode = '23514';
  end if;
  return new;
end
$$;
revoke all on function public.garder_ouverture_eclatee_a_la_validation() from public, anon, authenticated;
comment on function public.garder_ouverture_eclatee_a_la_validation() is
  'Filet de la validation (MCB5G-Q2) : un exercice ne se valide qu''avec l''écriture qui éclate l''ouverture de la banque entre les 512 des comptes bancaires à son 1er janvier, à jour de ouverture_eclatee_attendue — ni manquante, ni à réécrire, ni à retirer. La restauration (sous le rôle de l''API) ne se rejuge pas.';
create trigger exercices_valides_ouverture_eclatee
  before insert on public.exercices_valides
  for each row execute function public.garder_ouverture_eclatee_a_la_validation();

-- ══ 2. La garde de fin ══
do $fin$
begin
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.exercices_valides'::regclass and t.tgname = 'exercices_valides_ouverture_eclatee'
                    and t.tgenabled = 'O' and t.tgtype = 7
                    and t.tgfoid = 'public.garder_ouverture_eclatee_a_la_validation()'::regprocedure)
     or not exists (select 1 from pg_proc where oid = 'public.garder_ouverture_eclatee_a_la_validation()'::regprocedure
                     and not prosecdef and proconfig @> array['search_path=public'])
     or has_function_privilege('anon', 'public.garder_ouverture_eclatee_a_la_validation()', 'execute')
     or has_function_privilege('authenticated', 'public.garder_ouverture_eclatee_a_la_validation()', 'execute') then
    raise exception 'Garde de fin : le déclencheur ou la fonction du filet ne sont pas ceux que la migration pose.';
  end if;
end
$fin$;
