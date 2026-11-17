-- EXP58-Q5 — LE CUMUL REPRIS D'UN BIEN, LE PLAN CONTINUÉ (lignes 26.6 et 33 ; décision du cabinet du 17/11/2026, la réponse
-- (A) « le cumul repris saisi par bien, le plan continué »). PRÉPARÉE le 17/11/2026, PAS APPLIQUÉE. Le récit : HISTORIQUE.md,
-- « 17/11/2026 — EXP58-Q5 : LE CUMUL REPRIS D'UN BIEN, LE PLAN CONTINUÉ (PRÉPARÉE, PAS APPLIQUÉE) » ; l'analyse :
-- docs/conceptions/58-reponses-de-l-expert-comptable.md, § 3.1 ; l'essai : supabase/essais/cumulReprisDesBiens.sql (EN ATTENTE
-- sans elle) ; le retour : supabase/preparees/retour/20261117190100_retour_cumul_repris_des_biens.sql ; le calcul redit en
-- entiers : src/lib/amortissements.ts (`amortissementCumuleCentimes`) ; l'écran derrière `CUMUL_REPRIS_PREVU`
-- (src/lib/cumulRepris.ts), baissé jusqu'à l'application.
--
-- LE CAS. Chaque dotation se recalculait depuis le registre seul — linéaire, 30/360, depuis la mise en service — et la base
-- refusait une dotation qui ne valait pas ce calcul. L'expert-comptable reprend, pour un bien acquis avant la reprise du
-- dossier, le tableau d'amortissement de l'ancien logiciel au 31 décembre de l'année d'avant, et vérifie qu'il concorde avec
-- les comptes (la vérification est IMMO-Q1, src/lib/repriseDesAmortissements.ts). Quand l'ancien logiciel comptait en jours
-- réels, ou arrondissait autrement, le recalcul s'écartait du 28 repris et l'écart demeurait chaque année.
--
-- LA RÈGLE. PCG (recueil de l'ANC, version du 1er janvier 2026) : « L'amortissement d'un actif est la répartition systématique
-- de son montant amortissable en fonction de son utilisation », déterminé par le plan d'amortissement (art. 214-13) ; une
-- dotation conforme au plan à chaque clôture (art. 214-11) ; une modification du plan est PROSPECTIVE (art. 214-14) — le passé
-- reste ce qu'il est, seul ce qui reste se répartit. Le plan continué en est la forme : un bien porte, s'il est repris, le
-- cumul de ses amortissements au 31 décembre qui précède l'année de l'ouverture du dossier, tel que l'ancien tableau le porte
-- (ce que l'expert-comptable reprend). Ses dotations suivantes partent de la valeur nette restante, répartie sur les jours
-- qui restent du plan (de la mise en service à la fin de sa durée, en 30/360) : LE CUMUL S'ARRONDIT, PAS L'ANNUITÉ — au soir d'un jour
-- après le cumul repris, le cumul vaut le cumul repris plus la valeur nette restante × les jours écoulés depuis ÷ les jours
-- restants, au centime, le demi-centime vers le haut ; la dernière annuité solde, au centime. Un plan fini au jour du cumul
-- repris ne garde rien à amortir : le cumul vaut alors la valeur (la contrainte du plan). Sans cumul repris, le calcul d'hier,
-- au caractère près (`amortissement_cumule_centimes`) ; une dotation de l'année du cumul ou d'avant n'existe pas pour la base :
-- elle précède l'ouverture (« sa dotation est déjà dans les à-nouveaux »).
--
-- CE QU'ELLE POSE :
--   1. `immobilisations.cumul_repris` (numeric, comme `valeur`) et `immobilisations.cumul_repris_au` (date), NULLABLES, sans
--      défaut : nuls sur tout bien d'hier. Ajoutées au catalogue seul, sans réécrire la table.
--   2. Trois contraintes de la ligne seule, sans fonction (le socle se rejoue dans une base vide) :
--      `immobilisations_cumul_repris_date` — les deux ensemble ou aucun ; un 31 décembre ; au plus tôt la date d'acquisition ;
--      `immobilisations_cumul_repris_borne` — au centime, de zéro à la valeur du bien, la base amortissable ;
--      `immobilisations_cumul_repris_plan` — un cumul positif suppose le bien mis en service au plus tard ce jour-là, et un
--      cumul plus petit que la valeur un plan qui court encore au moins un jour après lui.
--   3. `amortissement_cumule_continue_centimes(valeur, durée, mise en service, cumul repris, date du cumul, rang)` et
--      `dotation_amortissement_continue(…, exercice)`, IMMUABLES : le calcul ci-dessus, en entiers ; sans cumul repris, celui
--      d'hier. Avant le jour du cumul repris, la seule fonction du module qui le lise (l'affichage d'une année reprise) répartit
--      le cumul repris sur les jours en service jusqu'à lui ; la base ne s'en sert pour aucune écriture.
--   4. `ecrire_dotation_amortissement` remplacée, à partir du corps de `la_base_lit_le_plan_6` (vérifié en tête) : la dotation
--      attendue est celle du plan continué ; un cumul repris daté d'un autre jour que le 31 décembre qui précède l'année de
--      l'ouverture, ou dans un dossier sans ouverture, n'est le départ d'aucun plan — rien ne s'écrit sur lui (deux refus,
--      22023), une dotation déjà écrite peut encore se retirer. Le reste du corps, au caractère près.
--   5. `garder_cumul_repris`, AUX DROITS DU PROPRIÉTAIRE (elle lit la frontière de validation, que l'appelant ne lit pas), et
--      son déclencheur `immobilisations_garde_du_cumul_repris`, BEFORE INSERT OR UPDATE, après la porte
--      `_acces_avant_les_gardes` et après `immobilisations_figees_par_la_validation` (l'ordre des noms) : le cumul repris
--      d'un bien ne se pose, ne change, ne se retire ni ne quitte son dossier une fois validé un exercice qui suit sa date
--      (23514, les mots d'`exercice_fige`). `garder_bien_valide` fige déjà la ligne entière d'un bien qui porte une écriture
--      validée (le cumul avec elle, sans un mot de plus) ; cette garde fige aussi celui d'un bien entièrement amorti à la
--      reprise, qui n'en porte aucune.
--
-- CE QU'ELLE NE CHANGE PAS : aucune policy, aucune table, aucune donnée ; `dotation_amortissement`,
-- `amortissement_cumule_centimes`, `rang_360` et `retirer_immobilisation` restent (le plan sans cumul les appelle encore).
-- L'empreinte d'un exercice validé ne lit du registre que la pièce d'un bien : elle ne change pas. La sauvegarde lit la table
-- par `select('*')` et la restauration réinsère ce qu'elle a lu, avant les exercices validés (le dernier rang) : une sauvegarde
-- d'avant se restaure (les colonnes nulles), une d'après porte le cumul. La copie de l'assistant (`agent-comptable`, bloc
-- AMORTISSEMENT) lit le registre par une liste de colonnes : elle ne voit pas le cumul — à reprendre, et à redéployer, avec la
-- levée de `CUMUL_REPRIS_PREVU`.
--
-- LE SOCLE, LE JOUR DE L'APPLICATION. `immobilisations` est une table du socle : supabase/schema/socle/
-- 1_tables_sans_migration.sql se régénère du catalogue (supabase/essais/socle.sql) et change de cinq lignes dans son
-- `create table public.immobilisations` — après `  date_mise_en_service date,`, les lignes `  cumul_repris numeric,` et
-- `  cumul_repris_au date,` ; entre `  constraint immobilisations_piece_id_fkey …` et `  constraint
-- immobilisations_duree_positive …`, les trois contraintes, dans l'ordre de leur nom, sous la définition que l'essai attend
-- (le nombre d'instructions ne change pas). L'inventaire compte neuf objets de plus : les deux colonnes, les trois contraintes,
-- les trois fonctions et le déclencheur (relevé sur une copie de la réplique à 237 : 3 222, puis 3 231).
--
-- COMMENT ELLE S'APPLIQUE : COLLÉE PAR LE CABINET, dans une transaction, avec sa ligne d'historique — le corps
-- d'`ecrire_dotation_amortissement` retire l'écriture qu'il remplace (`delete`, comme hier), et l'outil d'application attend
-- alors une confirmation qui n'arrive pas. Aucune barre oblique inverse. Indépendante des autres migrations préparées : aucune
-- ne remplace `ecrire_dotation_amortissement` ni ne touche `immobilisations` ; elle se colle avant ou après elles. Le jour de
-- son application, `CUMUL_REPRIS_PREVU` se lève, le fichier entre dans supabase/schema/ sous la version de sa ligne
-- d'historique, texte inchangé, et le socle se régénère.

-- ══ 0. La garde de tête ══════════
do $garde$
begin
  if exists (select 1 from pg_catalog.pg_attribute a
              where a.attrelid = 'public.immobilisations'::regclass and a.attname in ('cumul_repris', 'cumul_repris_au')
                and not a.attisdropped)
     or to_regprocedure('public.amortissement_cumule_continue_centimes(numeric, integer, date, numeric, date, integer)') is not null
     or to_regprocedure('public.dotation_amortissement_continue(numeric, integer, date, numeric, date, integer)') is not null
     or to_regprocedure('public.garder_cumul_repris()') is not null then
    raise exception 'EXP58-Q5 : le cumul repris est déjà en base : cette migration ne se rejoue pas.';
  end if;
  -- Les colonnes du registre que les contraintes et le calcul lisent.
  if (select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull::text, ', ' order by a.attname)
        from pg_catalog.pg_attribute a
       where a.attrelid = 'public.immobilisations'::regclass and not a.attisdropped
         and a.attname in ('date_acquisition', 'date_mise_en_service', 'dossier_id', 'duree_annees', 'valeur'))
     is distinct from 'date_acquisition date true, date_mise_en_service date false, dossier_id uuid true, duree_annees integer true, valeur numeric true' then
    raise exception 'EXP58-Q5 : les colonnes du registre que le calcul lit ont changé : relire la migration.';
  end if;
  -- Le corps qu'elle remplace, celui de la_base_lit_le_plan_6 (fins de ligne ramenées à la seule fin de ligne), et le calcul
  -- d'hier qu'elle prolonge sans le changer. Un autre remplaçant collé avant elle : elle se refuse, et se reprend sur le corps
  -- du jour.
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_catalog.pg_proc p
       where p.oid = to_regprocedure('public.ecrire_dotation_amortissement(uuid, integer, jsonb)')) is distinct from '8137d0a88453629d1608f022e4df4df9' then
    raise exception 'EXP58-Q5 : ecrire_dotation_amortissement n''a plus le corps sur lequel cette migration a été écrite : rien n''est remplacé.';
  end if;
  if (select string_agg(p.proname || '=' || md5(replace(p.prosrc, chr(13), '')), ',' order by p.proname)
        from pg_catalog.pg_proc p
       where p.oid in (to_regprocedure('public.amortissement_cumule_centimes(numeric, integer, date, integer)'),
                       to_regprocedure('public.rang_360(date)'), to_regprocedure('public.frontiere_validation(uuid)'),
                       to_regprocedure('public.exercice_fige(uuid, integer)')))
     is distinct from 'amortissement_cumule_centimes=cd143ea8539ae1358dbbde7eac1af68a,exercice_fige=b70cbdd4a870f5e17e8e4c6851506bdc,'
                      'frontiere_validation=24a04846471ec5e8cdbae6f3b9f4a2e8,rang_360=e62533d72b410f34c08012800de4e8ed' then
    raise exception 'EXP58-Q5 : le calcul des dotations ou la frontière de validation ont changé : relire la migration.';
  end if;
  -- Le figement d'un bien qui porte une écriture validée compare la ligne entière : les colonnes neuves s'y figent d'elles-mêmes.
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_catalog.pg_proc p
       where p.oid = to_regprocedure('public.garder_bien_valide()')) is distinct from '2b46434ab930b9f8d5a504acc983e714' then
    raise exception 'EXP58-Q5 : garder_bien_valide n''a plus le corps qui fige la ligne entière : relire le figement avant d''appliquer.';
  end if;
end
$garde$;

-- ══ 1. Les colonnes ══════════
alter table public.immobilisations add column cumul_repris numeric;
alter table public.immobilisations add column cumul_repris_au date;

comment on column public.immobilisations.cumul_repris is
  'Le cumul des amortissements du bien au jour cumul_repris_au, tel que l''ancien tableau d''amortissement le porte (EXP58-Q5) : nul, le plan part de la mise en service ; porté, les dotations suivantes partent de la valeur nette restante, répartie sur les jours qui restent du plan. Figé avec le bien par la validation d''un exercice qui le suit.';
comment on column public.immobilisations.cumul_repris_au is
  'Le 31 décembre auquel le cumul repris est arrêté : celui qui précède l''année de l''ouverture du dossier (ecrire_dotation_amortissement n''écrit sur aucun autre).';

-- ══ 2. Les contraintes de la ligne ══════════
alter table public.immobilisations add constraint immobilisations_cumul_repris_date
  check ((cumul_repris is null) = (cumul_repris_au is null)
         and (cumul_repris_au is null
              or (extract(month from cumul_repris_au) = 12 and extract(day from cumul_repris_au) = 31
                  and cumul_repris_au >= date_acquisition)));
alter table public.immobilisations add constraint immobilisations_cumul_repris_borne
  check (cumul_repris is null or (cumul_repris = round(cumul_repris, 2) and cumul_repris >= 0 and cumul_repris <= valeur));
-- Le rang d'un jour en 30/360, écrit dans la contrainte (`rang_360` ne s'y appelle pas : le socle se rejoue avant elle).
alter table public.immobilisations add constraint immobilisations_cumul_repris_plan
  check (cumul_repris is null or cumul_repris_au is null
         or ((cumul_repris = 0 or cumul_repris_au >= coalesce(date_mise_en_service, date_acquisition))
             and (cumul_repris = valeur
                  or extract(year from coalesce(date_mise_en_service, date_acquisition)) * 360
                     + (extract(month from coalesce(date_mise_en_service, date_acquisition)) - 1) * 30
                     + least(extract(day from coalesce(date_mise_en_service, date_acquisition)), 30) - 1
                     + 360 * duree_annees >= extract(year from cumul_repris_au) * 360 + 361)));

-- ══ 3. Le plan continué, en entiers ══════════
-- L'amortissement cumulé au soir du jour de rang `p_rang`, en centimes. Sans cumul repris : `amortissement_cumule_centimes`.
-- Avec lui, à partir de son jour : le cumul repris plus la valeur nette restante × les jours écoulés depuis le premier jour
-- amorti après lui (le lendemain, ou la mise en service si elle suit) ÷ les jours qui restent du plan (au moins un : un plan
-- fini au jour du cumul solde le lendemain), le demi-centime vers le haut. Avant son jour : le cumul repris réparti sur les
-- jours en service jusqu'à lui (l'affichage d'une année reprise ; aucune écriture ne s'en sert). Même calcul que
-- amortissementCumuleCentimes (src/lib/amortissements.ts).
create function public.amortissement_cumule_continue_centimes(
  p_valeur numeric, p_duree integer, p_mise_en_service date, p_cumul_repris numeric, p_cumul_repris_au date, p_rang integer
) returns bigint
language sql
immutable
set search_path = public
as $$
  select case
    when p_cumul_repris is null or p_cumul_repris_au is null
      then public.amortissement_cumule_centimes(p_valeur, p_duree, p_mise_en_service, p_rang)
    when p_rang < r.repris
      then case when r.repris - r.service + 1 <= 0 then 0::bigint
                else (2 * r.cumul * least(greatest(p_rang - r.service + 1, 0), r.repris - r.service + 1)::bigint
                      + (r.repris - r.service + 1)) / (2 * (r.repris - r.service + 1))::bigint
           end
    else r.cumul + (2 * (r.valeur - r.cumul) * least(greatest(p_rang - s.debut + 1, 0), s.jours)::bigint + s.jours)
                   / (2 * s.jours)::bigint
  end
  from (select round(p_valeur * 100)::bigint as valeur, round(p_cumul_repris * 100)::bigint as cumul,
               public.rang_360(p_mise_en_service) as service, public.rang_360(p_cumul_repris_au) as repris) as r,
       lateral (select greatest(r.repris + 1, r.service) as debut,
                       greatest(r.service + 360 * p_duree - greatest(r.repris + 1, r.service), 1) as jours) as s
$$;

-- La dotation d'un exercice : l'écart du cumul au 31 décembre et de celui de l'exercice précédent.
create function public.dotation_amortissement_continue(
  p_valeur numeric, p_duree integer, p_mise_en_service date, p_cumul_repris numeric, p_cumul_repris_au date, p_annee integer
) returns numeric
language sql
immutable
set search_path = public
as $$
  select round((public.amortissement_cumule_continue_centimes(p_valeur, p_duree, p_mise_en_service, p_cumul_repris,
                  p_cumul_repris_au, public.rang_360(make_date(p_annee, 12, 31)))
              - public.amortissement_cumule_continue_centimes(p_valeur, p_duree, p_mise_en_service, p_cumul_repris,
                  p_cumul_repris_au, public.rang_360(make_date(p_annee - 1, 12, 31))))::numeric / 100, 2)
$$;

revoke execute on function public.amortissement_cumule_continue_centimes(numeric, integer, date, numeric, date, integer) from public, anon;
grant execute on function public.amortissement_cumule_continue_centimes(numeric, integer, date, numeric, date, integer) to authenticated;
revoke execute on function public.dotation_amortissement_continue(numeric, integer, date, numeric, date, integer) from public, anon;
grant execute on function public.dotation_amortissement_continue(numeric, integer, date, numeric, date, integer) to authenticated;

-- ══ 4. ecrire_dotation_amortissement : la dotation du plan continué ══════════
create or replace function public.ecrire_dotation_amortissement(
  p_immobilisation_id uuid,
  p_annee integer,
  p_ecritures jsonb
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_immo public.immobilisations%rowtype;
  v_date date;
  v_ouverture date;
  v_montant numeric;
  v_compte_immobilisation text;
  v_compte_amortissement text;
  v_compte_dotations text;
  v_conforme boolean;
  v_nb integer;
  v_debit numeric;
  v_credit numeric;
begin
  select * into v_immo from public.immobilisations where id = p_immobilisation_id for update;
  if not found or not admin_du_dossier(v_immo.dossier_id) then
    raise exception 'Accès refusé à ce bien.' using errcode = '42501';
  end if;
  if p_annee is null then
    raise exception 'L''exercice de la dotation manque.' using errcode = '22023';
  end if;
  -- L'exercice en cours s'écrit dès aujourd'hui, au 31 décembre ; un exercice à venir, pas encore. L'année
  -- se lit à Paris, comme dans l'application, sans quoi la nuit du 1er janvier les ferait diverger.
  if p_annee > extract(year from (now() at time zone 'Europe/Paris'))::integer then
    raise exception 'La dotation d''un exercice à venir ne s''écrit pas encore.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_ecritures) is distinct from 'array' then
    raise exception 'L''écriture proposée est incomplète.' using errcode = '22023';
  end if;
  v_date := make_date(p_annee, 12, 31);
  if exists (
    select 1 from public.ecritures_brouillon
    where immobilisation_id = p_immobilisation_id and date = v_date and statut <> 'proposee'
  ) then
    raise exception 'La dotation % de ce bien est validée : elle ne se remplace plus.', p_annee using errcode = '23514';
  end if;

  -- Avant l'ouverture du dossier (ses à-nouveaux), l'amortissement est déjà dans les soldes repris : la
  -- dotation de cet exercice ne s'écrit pas ici. Elle peut encore s'y RETIRER, si elle y avait été écrite
  -- avant la reprise.
  select min(date) into v_ouverture from public.a_nouveaux where dossier_id = v_immo.dossier_id;
  if v_ouverture is not null and v_date < v_ouverture then
    if jsonb_array_length(p_ecritures) > 0 then
      raise exception 'L''exercice % précède l''ouverture du dossier : sa dotation est déjà dans les à-nouveaux.', p_annee
        using errcode = '22023';
    end if;
    v_montant := 0;
  -- Le cumul repris d'un bien (EXP58-Q5) est celui de l'ancien tableau au 31 décembre qui précède l'année de l'ouverture :
  -- daté d'un autre jour, ou dans un dossier sans ouverture, il n'est le départ d'aucun plan, et rien ne s'écrit sur lui — il
  -- se corrige dans la fiche du bien. Une dotation déjà écrite peut encore se RETIRER.
  elsif v_immo.cumul_repris_au is not null
        and (v_ouverture is null or v_immo.cumul_repris_au <> make_date(extract(year from v_ouverture)::integer - 1, 12, 31)) then
    if jsonb_array_length(p_ecritures) > 0 then
      if v_ouverture is null then
        raise exception 'Le cumul repris de ce bien, au %, suppose un dossier ouvert par une balance reprise : ce dossier n''en a pas.',
          to_char(v_immo.cumul_repris_au, 'DD/MM/YYYY') using errcode = '22023';
      end if;
      raise exception 'Le cumul repris de ce bien est daté du % : l''ouverture du dossier, le %, en demande un au %.',
        to_char(v_immo.cumul_repris_au, 'DD/MM/YYYY'), to_char(v_ouverture, 'DD/MM/YYYY'),
        to_char(make_date(extract(year from v_ouverture)::integer - 1, 12, 31), 'DD/MM/YYYY') using errcode = '22023';
    end if;
    v_montant := 0;
  else
    -- Le plan continué depuis le cumul repris ; sans lui, le calcul d'hier.
    v_montant := public.dotation_amortissement_continue(v_immo.valeur, v_immo.duree_annees,
      coalesce(v_immo.date_mise_en_service, v_immo.date_acquisition), v_immo.cumul_repris, v_immo.cumul_repris_au, p_annee);
  end if;

  if v_montant > 0 then
    if v_immo.nature_id is null then
      raise exception 'Choisissez la nature de ce bien : c''est elle qui donne son compte d''amortissement.'
        using errcode = '22023';
    end if;
    select compte_immobilisation into v_compte_immobilisation
      from public.natures_immobilisation where id = v_immo.nature_id;
    if v_compte_immobilisation is null then
      raise exception 'La nature de ce bien est introuvable.' using errcode = '22023';
    end if;
    v_compte_amortissement := public.compte_amortissement(v_compte_immobilisation);
  end if;

  -- Le plan du dossier (ligne 43) se lit sous son verrou PARTAGÉ — la clé de `cle_validation`, que l'appelant
  -- n'exécute pas — : un changement du plan (étape PC4) et cet appel ne se croisent pas.
  perform pg_advisory_xact_lock_shared(hashtextextended('jd.validation_exercice:' || v_immo.dossier_id::text, 0));
  v_compte_dotations := public.compte_du_role(v_immo.dossier_id, 'dotations_amortissements');

  -- L'écriture attendue, comparée en MULTIENSEMBLE : autant de lignes, et chacune des attendues présente. Une
  -- dotation nulle n'en attend aucune — l'appel retire alors celle qui aurait été écrite.
  with attendues as (
    select a.compte, a.sens, a.montant from (values
      (v_compte_dotations, 'debit', v_montant),
      (v_compte_amortissement, 'credit', v_montant)
    ) as a(compte, sens, montant)
    where a.montant > 0
  ), recues as (
    select e->>'compte' as compte, e->>'sens' as sens, (e->>'montant')::numeric as montant
    from jsonb_array_elements(p_ecritures) as e
  )
  select (select count(*) from recues) = (select count(*) from attendues)
     and not exists (select compte, sens, montant from attendues except all select compte, sens, montant from recues)
    into v_conforme;
  if not coalesce(v_conforme, false) then
    raise exception 'L''écriture proposée ne correspond pas à la dotation % de ce bien.', p_annee using errcode = '22023';
  end if;

  delete from public.ecritures_brouillon where immobilisation_id = p_immobilisation_id and date = v_date;

  insert into public.ecritures_brouillon (dossier_id, piece_id, ligne_bancaire_id, immobilisation_id, date, compte,
                                          libelle, montant, sens, statut)
  select v_immo.dossier_id, null, null, p_immobilisation_id, v_date, e->>'compte', coalesce(e->>'libelle', ''),
         (e->>'montant')::numeric, e->>'sens', 'proposee'
  from jsonb_array_elements(p_ecritures) as e;
  get diagnostics v_nb = row_count;

  select coalesce(sum(montant) filter (where sens = 'debit'), 0),
         coalesce(sum(montant) filter (where sens = 'credit'), 0)
    into v_debit, v_credit
  from public.ecritures_brouillon where immobilisation_id = p_immobilisation_id and date = v_date;
  if v_debit <> v_credit then
    raise exception 'Écriture déséquilibrée : % au débit, % au crédit.', v_debit, v_credit using errcode = '23514';
  end if;

  return v_nb;
end;
$$;

comment on function public.ecrire_dotation_amortissement(uuid, integer, jsonb) is
  'Écrit la dotation aux amortissements d''un bien pour un exercice (le compte du rôle dotations_amortissements au débit — 681100 par défaut —, le compte 28 de sa nature au crédit, au 31 décembre), vérifiée contre le registre — le plan continué depuis le cumul repris du bien quand il en porte un (EXP58-Q5) —, et remplace celle qui était écrite. Une dotation nulle (avant la mise en service, après la durée, avant l''ouverture du dossier) retire celle qui existait ; un cumul repris qui n''est pas daté du 31 décembre précédant l''année de l''ouverture ne porte aucune écriture.';

-- ══ 5. Le cumul repris se fige avec les exercices validés qui le suivent ══════════
create function public.garder_cumul_repris() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_frontiere date;
begin
  if tg_op = 'UPDATE' then
    -- Rien du cumul ne change : rien à juger (un bien ancien garde son libellé, sa nature, ses dates…).
    if (new.cumul_repris, new.cumul_repris_au) is not distinct from (old.cumul_repris, old.cumul_repris_au)
       and new.dossier_id = old.dossier_id then
      return new;
    end if;
    -- Le cumul d'hier qui change, part ou quitte son dossier : jugé sur la frontière du dossier où il était.
    if old.cumul_repris_au is not null then
      perform pg_advisory_xact_lock_shared(public.cle_validation(old.dossier_id));
      v_frontiere := public.frontiere_validation(old.dossier_id);
      if v_frontiere is not null and v_frontiere > old.cumul_repris_au then
        raise exception '% : le cumul repris d''un bien ne change plus.',
          public.exercice_fige(old.dossier_id, extract(year from old.cumul_repris_au)::integer + 1) using errcode = '23514';
      end if;
    end if;
  end if;
  -- Le cumul de demain, posé, changé ou arrivé d'un autre dossier : jugé sur la frontière de son dossier.
  if new.cumul_repris_au is not null then
    perform pg_advisory_xact_lock_shared(public.cle_validation(new.dossier_id));
    v_frontiere := public.frontiere_validation(new.dossier_id);
    if v_frontiere is not null and v_frontiere > new.cumul_repris_au then
      raise exception '% : le cumul repris d''un bien ne change plus.',
        public.exercice_fige(new.dossier_id, extract(year from new.cumul_repris_au)::integer + 1) using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.garder_cumul_repris() is
  'Le cumul repris d''un bien (EXP58-Q5) ne se pose, ne change, ne se retire ni ne quitte son dossier une fois validé un exercice qui suit sa date : il décide des dotations de ces exercices.';

create trigger immobilisations_garde_du_cumul_repris
  before insert or update on public.immobilisations
  for each row execute function public.garder_cumul_repris();

revoke execute on function public.garder_cumul_repris() from public, anon, authenticated;

-- ══ 6. La garde de fin ══════════
do $fin$
begin
  if (select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull::text || ' ' || a.atthasdef::text,
                        ', ' order by a.attname)
        from pg_catalog.pg_attribute a
       where a.attrelid = 'public.immobilisations'::regclass and a.attname in ('cumul_repris', 'cumul_repris_au') and not a.attisdropped)
     is distinct from 'cumul_repris numeric false false, cumul_repris_au date false false' then
    raise exception 'EXP58-Q5 : les colonnes du cumul repris ne sont pas nullables sans défaut : rien n''est appliqué.';
  end if;
  if (select count(*) from pg_catalog.pg_constraint c
       where c.conrelid = 'public.immobilisations'::regclass and c.contype = 'c'
         and c.conname in ('immobilisations_cumul_repris_date', 'immobilisations_cumul_repris_borne', 'immobilisations_cumul_repris_plan')
         and c.convalidated) <> 3 then
    raise exception 'EXP58-Q5 : les trois contraintes du cumul repris ne sont pas toutes posées : rien n''est appliqué.';
  end if;
  -- La garde du cumul, aux droits du propriétaire, qu'aucun rôle de session n'exécute, sur toute insertion et toute mise à
  -- jour ; et le figement de la ligne entière d'un bien validé, toujours là, sur toute mise à jour.
  if (select count(*) from pg_catalog.pg_trigger t join pg_catalog.pg_proc p on p.oid = t.tgfoid
       where t.tgrelid = 'public.immobilisations'::regclass and t.tgname = 'immobilisations_garde_du_cumul_repris'
         and p.oid = to_regprocedure('public.garder_cumul_repris()') and p.prosecdef and t.tgtype = 23
         and t.tgattr = ''::int2vector and t.tgenabled = 'O' and not t.tgisinternal) <> 1
     or has_function_privilege('authenticated', 'public.garder_cumul_repris()', 'execute')
     or has_function_privilege('anon', 'public.garder_cumul_repris()', 'execute')
     or (select count(*) from pg_catalog.pg_trigger t
          where t.tgrelid = 'public.immobilisations'::regclass and t.tgname = 'immobilisations_figees_par_la_validation'
            and t.tgfoid = to_regprocedure('public.garder_bien_valide()') and t.tgtype = 31 and t.tgattr = ''::int2vector
            and t.tgenabled = 'O') <> 1 then
    raise exception 'EXP58-Q5 : la garde du cumul repris ou le figement d''un bien validé ne sont pas ceux de cette migration : rien n''est appliqué.';
  end if;
  -- Les quatre corps tels qu'écrits ici (un collage qui les aurait changés se refuse) ; le retour vérifie le premier avant de
  -- rendre celui d'hier.
  if (select string_agg(p.proname || '=' || md5(replace(p.prosrc, chr(13), '')), ',' order by p.proname)
        from pg_catalog.pg_proc p
       where p.oid in (to_regprocedure('public.ecrire_dotation_amortissement(uuid, integer, jsonb)'),
                       to_regprocedure('public.amortissement_cumule_continue_centimes(numeric, integer, date, numeric, date, integer)'),
                       to_regprocedure('public.dotation_amortissement_continue(numeric, integer, date, numeric, date, integer)'),
                       to_regprocedure('public.garder_cumul_repris()')))
     is distinct from 'amortissement_cumule_continue_centimes=e9a17d10854f9bd927c6277fc2ddf4dd,'
                      'dotation_amortissement_continue=b01f45c02836f707b27bf0dd9d149ff2,'
                      'ecrire_dotation_amortissement=003224434bcfa6fe945b16da31eecc0f,'
                      'garder_cumul_repris=328132bb814c5fb7d0efaf606a114b50' then
    raise exception 'EXP58-Q5 : un corps de fonction n''est pas celui de cette migration : rien n''est appliqué.';
  end if;
  -- Le calcul : sans cumul repris, celui d'hier, au centime ; avec lui, le plan continué (le cas de l'en-tête de l'essai).
  if (select count(*) from generate_series(2018, 2032) as a(annee), (values
        (1233::numeric, 3, date '2023-11-30'), (1000, 4, date '2024-02-29'), (679.84, 2, date '2024-12-20'), (12000, 5, date '2026-07-01'))
        as b(valeur, duree, service)
       where public.dotation_amortissement_continue(b.valeur, b.duree, b.service, null, null, a.annee)
             is distinct from public.dotation_amortissement(b.valeur, b.duree, b.service, a.annee)) <> 0
     or public.dotation_amortissement_continue(4800, 5, date '2022-03-15', 2000, date '2024-12-31', 2025) is distinct from 1269.52 then
    raise exception 'EXP58-Q5 : le plan continué ne rend pas le calcul attendu : rien n''est appliqué.';
  end if;
end
$fin$;
