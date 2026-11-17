-- RETOUR DE `cumul_repris_des_biens` (EXP58-Q5, supabase/preparees/20261117190000_cumul_repris_des_biens.sql) — À COLLER par le
-- cabinet dans l'éditeur SQL de Supabase, dans une transaction : il retire deux colonnes, trois contraintes, trois fonctions
-- et un déclencheur, ce que l'outil d'application retient. CE QU'IL DÉTRUIT : les
-- colonnes `immobilisations.cumul_repris` et `immobilisations.cumul_repris_au`, et avec elles chaque cumul repris saisi — une
-- information que rien d'autre ne garde dans l'application (l'ancien tableau d'amortissement est hors d'elle). C'est pourquoi
-- sa garde refuse dès qu'un bien en porte un : il ne sert qu'avant la première saisie ; au-delà, retirer ces cumuls est une
-- décision du cabinet, qui se prend à part — et les dotations écrites sur eux redeviendraient « à réécrire » sur le recalcul
-- d'hier, refusées dans un exercice validé.
-- Il rend la base d'avant : `ecrire_dotation_amortissement` reprend son corps d'hier, au caractère près (celui de
-- `la_base_lit_le_plan_6`, vérifié en fin), et son commentaire. Le drapeau (`CUMUL_REPRIS_PREVU`, src/lib/cumulRepris.ts) se
-- baisse AVANT lui : levé, l'écran écrirait des colonnes absentes, et la base refuserait l'inscription ou la modification
-- entière. Puis le socle se régénère (supabase/essais/socle.sql) : les cinq lignes que la migration y a ajoutées s'en vont, et le
-- fichier de la migration quitte supabase/schema/.
--
-- La garde : les colonnes, les contraintes, les fonctions et le déclencheur sont ceux de la migration, le corps
-- d'`ecrire_dotation_amortissement` est le sien, et aucun bien ne porte de cumul repris.
do $garde$
declare
  v_portes bigint;
begin
  if (select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull::text || ' ' || a.atthasdef::text,
                        ', ' order by a.attname)
        from pg_catalog.pg_attribute a
       where a.attrelid = 'public.immobilisations'::regclass and a.attname in ('cumul_repris', 'cumul_repris_au') and not a.attisdropped)
     is distinct from 'cumul_repris numeric false false, cumul_repris_au date false false'
     or (select count(*) from pg_catalog.pg_constraint c
          where c.conrelid = 'public.immobilisations'::regclass
            and c.conname in ('immobilisations_cumul_repris_date', 'immobilisations_cumul_repris_borne', 'immobilisations_cumul_repris_plan')) <> 3
     or to_regprocedure('public.amortissement_cumule_continue_centimes(numeric, integer, date, numeric, date, integer)') is null
     or to_regprocedure('public.dotation_amortissement_continue(numeric, integer, date, numeric, date, integer)') is null
     or to_regprocedure('public.garder_cumul_repris()') is null
     or not exists (select 1 from pg_catalog.pg_trigger t
                     where t.tgrelid = 'public.immobilisations'::regclass and t.tgname = 'immobilisations_garde_du_cumul_repris') then
    raise exception 'Retour d''EXP58-Q5 : le cumul repris n''est pas celui de la migration (absent ou changé) : rien n''est retiré.';
  end if;
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_catalog.pg_proc p
       where p.oid = to_regprocedure('public.ecrire_dotation_amortissement(uuid, integer, jsonb)')) is distinct from '003224434bcfa6fe945b16da31eecc0f' then
    raise exception 'Retour d''EXP58-Q5 : ecrire_dotation_amortissement n''a plus le corps de la migration : rien n''est retiré.';
  end if;
  select count(*) into v_portes from public.immobilisations where cumul_repris is not null or cumul_repris_au is not null;
  if v_portes > 0 then
    raise exception 'Retour d''EXP58-Q5 : % bien(s) portent un cumul repris, que ce retour effacerait sans retour possible : rien n''est retiré.',
      v_portes using errcode = '23514';
  end if;
end
$garde$;

-- ══ 1. La garde du cumul ══════════
drop trigger immobilisations_garde_du_cumul_repris on public.immobilisations;
drop function public.garder_cumul_repris();

-- ══ 2. ecrire_dotation_amortissement : le corps d'hier, avant que les fonctions qu'il n'appellera plus partent ══════════
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
  else
    v_montant := public.dotation_amortissement(v_immo.valeur, v_immo.duree_annees,
      coalesce(v_immo.date_mise_en_service, v_immo.date_acquisition), p_annee);
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
  'Écrit la dotation aux amortissements d''un bien pour un exercice (le compte du rôle dotations_amortissements au débit — 681100 par défaut —, le compte 28 de sa nature au crédit, au 31 décembre), vérifiée contre le registre, et remplace celle qui était écrite. Une dotation nulle (avant la mise en service, après la durée, avant l''ouverture du dossier) retire celle qui existait.';

-- ══ 3. Le plan continué ══════════
drop function public.dotation_amortissement_continue(numeric, integer, date, numeric, date, integer);
drop function public.amortissement_cumule_continue_centimes(numeric, integer, date, numeric, date, integer);

-- ══ 4. Les contraintes et les colonnes ══════════
alter table public.immobilisations drop constraint immobilisations_cumul_repris_plan;
alter table public.immobilisations drop constraint immobilisations_cumul_repris_borne;
alter table public.immobilisations drop constraint immobilisations_cumul_repris_date;
alter table public.immobilisations drop column cumul_repris_au;
alter table public.immobilisations drop column cumul_repris;

-- ══ 5. La garde de fin : la base d'avant ══════════
do $fin$
begin
  if exists (select 1 from pg_catalog.pg_attribute a
              where a.attrelid = 'public.immobilisations'::regclass and a.attname in ('cumul_repris', 'cumul_repris_au') and not a.attisdropped)
     or exists (select 1 from pg_catalog.pg_constraint c where c.conrelid = 'public.immobilisations'::regclass and c.conname like 'immobilisations_cumul_repris%')
     or to_regprocedure('public.amortissement_cumule_continue_centimes(numeric, integer, date, numeric, date, integer)') is not null
     or to_regprocedure('public.dotation_amortissement_continue(numeric, integer, date, numeric, date, integer)') is not null
     or to_regprocedure('public.garder_cumul_repris()') is not null then
    raise exception 'Retour d''EXP58-Q5 : un objet de la migration reste en base : rien n''est retiré.';
  end if;
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_catalog.pg_proc p
       where p.oid = to_regprocedure('public.ecrire_dotation_amortissement(uuid, integer, jsonb)')) is distinct from '8137d0a88453629d1608f022e4df4df9' then
    raise exception 'Retour d''EXP58-Q5 : ecrire_dotation_amortissement n''a pas retrouvé son corps d''hier : rien n''est retiré.';
  end if;
end
$fin$;
