-- L'ANNEXE 2035-E : CE QUE SEUL LE CABINET SAIT, SAISI PAR EXERCICE (ligne 48, CFE et CVAE ; PRÉPARÉE le 11/11/2026, pas
-- appliquée). Le récit : HISTORIQUE.md, « 11/11/2026 — LA SAISIE DE L'ANNEXE 2035-E PAR EXERCICE, EN BASE (PRÉPARÉE, PAS
-- APPLIQUÉE) » ; la conception : « 09/10/2026 — L'ANNEXE 2035-E SE TIRE DE LA 2035 DÉPOSÉE » et les réponses du cabinet du
-- 17/10/2026 (48-Q1 et 48-Q2 : une table, une ligne par dossier et par exercice ; 48-Q6 : les dates d'activité se jugent à
-- la main, sans saisie, jusqu'au premier cas réel ; 48-Q11 : BW va aux saisies de la 2035, fait par 2035S1).
--
-- SOURCES. Le formulaire 2035-E-SD 2026 (cerfa 15945*08, page 3 de public/formulaires/2035-sd-2026.pdf) : les lignes EK,
-- EM, EN, ER, EU et EV, que la 2035 ne porte pas, et le « Cadre réservé au mono-établissements au sens de la CVAE » (AH,
-- AJ, BO, BK, KA, LA, MA). La notice 2035-NOT-SD 2026, p. 11-12 ; BOI-CVAE-BASE-20-20 § 180-213 (les loyers : seuls ceux
-- d'un bien corporel loué plus de six mois, en crédit-bail ou en location-gérance ne se déduisent pas) ; BOI-CVAE-DECLA-10
-- § 20 (le cadre coché dispense de la 1330-CVAE).
--
-- CE QUE LA MIGRATION POSE, rien d'autre (aucune destruction) :
--   1. `saisies_2035e` : une ligne par dossier et par exercice (`saisies_2035e_une_par_exercice`, contrainte TOTALE, que
--      l'upsert vise). Les montants en EUROS ENTIERS, comme le formulaire les porte ; chacun NUL tant que le cabinet ne l'a
--      pas dit — jamais un zéro inventé : nul se lit « à saisir », zéro « rien ». La variation de stock (EK) seule est
--      signée [notice, renvoi (2)]. AH (`mono_etablissement`) nul tant que non dit ; l'effectif (BK) n'existe que coché.
--      Ni AJ, ni KA, ni LA : l'application les calcule (le chiffre d'affaires de référence, l'année civile d'un BNC). Ni BO
--      (le chiffre d'affaires d'un groupe au sens de l'article 223 A, qui ne vise que des sociétés à l'IS, jamais un
--      déclarant de la 2035), ni MA (la date de cessation : 48-Q6).
--   2. La RLS : une policy `for all to authenticated` sur `admin_du_dossier(dossier_id)`, AUCUNE branche client.
--   3. Le gel : `garder_saisie_2035e_validee`, le patron de `garder_saisie_2035_validee` (la frontière de la validation,
--      sous le verrou partagé de `cle_validation`) : la saisie d'un exercice validé ne s'écrit, ne se modifie ni ne se
--      retire plus (23514). L'instantané d'un exercice validé ne la porte pas : le gel la tient, comme les saisies de la
--      2035 (question 48S-Q1 au cabinet).
--   4. `enregistrer_saisies_2035e`, aux droits de l'appelant (la RLS, la double authentification exigée si elle est en
--      base, et le gel jugent) : la ligne entière d'un exercice, contre les valeurs LUES qu'elle remplace (40001 si l'une a
--      changé depuis). Le contrôle d'accès d'abord, avant toute lecture.
--   5. Si la migration de la double authentification (`deux_facteurs_exiges`) est déjà en base, la policy restrictive
--      `deux_facteurs` sur la table neuve, que le bloc DF de rls.sql exige d'une table créée après elle.

do $garde$
begin
  if to_regclass('public.saisies_2035e') is not null then
    raise exception 'La migration saisies_2035e est déjà en base : la table existe.';
  end if;
  if to_regprocedure('public.frontiere_validation(uuid)') is null or to_regprocedure('public.cle_validation(uuid)') is null
     or to_regprocedure('public.exercice_fige(uuid, integer)') is null
     or to_regprocedure('public.retour_declencheur(text, anyelement, anyelement)') is null
     or to_regprocedure('public.admin_du_dossier(uuid)') is null then
    raise exception 'Le gel de la validation n''est pas celui que suppose cette migration : la relire avant de l''appliquer.';
  end if;
end
$garde$;

create table public.saisies_2035e (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  annee integer not null,
  loyers_deductibles bigint,
  plus_values bigint,
  variation_de_stock bigint,
  taxes_sur_le_chiffre_d_affaires bigint,
  dotations_biens_mis_a_disposition bigint,
  moins_values bigint,
  mono_etablissement boolean,
  effectif integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saisies_2035e_annee check (annee between 2000 and 2100),
  constraint saisies_2035e_montants check (
    coalesce(loyers_deductibles, 0) between 0 and 999999999999
    and coalesce(plus_values, 0) between 0 and 999999999999
    and coalesce(variation_de_stock, 0) between -999999999999 and 999999999999
    and coalesce(taxes_sur_le_chiffre_d_affaires, 0) between 0 and 999999999999
    and coalesce(dotations_biens_mis_a_disposition, 0) between 0 and 999999999999
    and coalesce(moins_values, 0) between 0 and 999999999999),
  constraint saisies_2035e_effectif check (
    effectif is null or (mono_etablissement is true and effectif between 0 and 1000000)),
  constraint saisies_2035e_une_par_exercice unique (dossier_id, annee)
);

comment on table public.saisies_2035e is
  'L''annexe 2035-E : ce que seul le cabinet sait, par dossier et par exercice (ligne 48) — EM, EN, EK, ER, EU, EV en euros entiers, le cadre des mono-établissements (AH) et l''effectif (BK). Nul : à saisir. Le client n''y lit rien.';
comment on column public.saisies_2035e.loyers_deductibles is
  'EM : la part de BF + BG − BW qui se déduit de la valeur ajoutée (un loyer de six mois au plus), en euros. Nul : à saisir.';
comment on column public.saisies_2035e.variation_de_stock is
  'EK, en euros, signée : positive quand le stock baisse, négative quand il monte. Nul : à saisir.';
comment on column public.saisies_2035e.mono_etablissement is
  'AH : un seul établissement au sens de la CVAE (coché, il dispense de la 1330-CVAE). Nul : à dire.';
comment on column public.saisies_2035e.effectif is
  'BK : l''effectif au sens de la CVAE, seulement quand AH est coché. Nul : à saisir.';

alter table public.saisies_2035e enable row level security;

create policy saisies_2035e_cabinet on public.saisies_2035e
  for all to authenticated
  using (public.admin_du_dossier(dossier_id))
  with check (public.admin_du_dossier(dossier_id));

create function public.garder_saisie_2035e_validee() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_derniere integer;
begin
  if tg_op <> 'INSERT' then
    if not exists (select 1 from public.dossiers where id = old.dossier_id) then
      return public.retour_declencheur(tg_op, old, new);
    end if;
    perform pg_advisory_xact_lock_shared(public.cle_validation(old.dossier_id));
    v_derniere := extract(year from public.frontiere_validation(old.dossier_id))::integer;
    if old.annee <= v_derniere then
      if tg_op = 'DELETE'
         or (to_jsonb(new) - array['updated_at']) is distinct from (to_jsonb(old) - array['updated_at']) then
        raise exception '% : ses saisies de l''annexe 2035-E ne changent plus.', public.exercice_fige(old.dossier_id, old.annee)
          using errcode = '23514';
      end if;
      return new;
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(new.dossier_id));
  v_derniere := extract(year from public.frontiere_validation(new.dossier_id))::integer;
  if new.annee <= v_derniere then
    raise exception '% : ses saisies de l''annexe 2035-E ne changent plus.', public.exercice_fige(new.dossier_id, new.annee)
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger saisies_2035e_figees_par_la_validation
  before insert or update or delete on public.saisies_2035e
  for each row execute function public.garder_saisie_2035e_validee();

revoke execute on function public.garder_saisie_2035e_validee() from public, anon, authenticated;

-- La ligne entière d'un exercice, d'un seul tenant. `p_saisie` et `p_lue` portent EXACTEMENT les huit clés
-- (`loyers_deductibles`, `plus_values`, `variation_de_stock`, `taxes_sur_le_chiffre_d_affaires`,
-- `dotations_biens_mis_a_disposition`, `moins_values` : un entier ou null ; `mono_etablissement` : un booléen ou null ;
-- `effectif` : un entier ou null) ; `p_lue` est ce que l'écran a lu (une ligne absente se lit huit null). Aux droits de
-- l'appelant : la policy et le gel jugent ; le verrou de l'exercice sérialise deux enregistrements, et une valeur changée
-- depuis sa lecture refuse le tout. Le contrôle d'accès vient d'abord, pour que le refus se dise sous ses mots.
create function public.enregistrer_saisies_2035e(p_dossier_id uuid, p_annee integer, p_lue jsonb, p_saisie jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cles constant text[] := array['dotations_biens_mis_a_disposition', 'effectif', 'loyers_deductibles', 'moins_values',
    'mono_etablissement', 'plus_values', 'taxes_sur_le_chiffre_d_affaires', 'variation_de_stock'];
  v_objet jsonb;
  v_cle text;
  v_actuelle jsonb;
  v_id uuid;
begin
  if p_dossier_id is null or not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Les saisies de l''annexe 2035-E ne s''écrivent que par le cabinet du dossier.' using errcode = '42501';
  end if;
  if p_annee is null or jsonb_typeof(p_lue) is distinct from 'object' or jsonb_typeof(p_saisie) is distinct from 'object' then
    raise exception 'Les saisies de l''annexe 2035-E partent mal formées : un exercice, la saisie et la valeur lue qu''elle remplace.'
      using errcode = '22023';
  end if;
  foreach v_objet in array array[p_lue, p_saisie] loop
    if (select array_agg(k order by k collate "C") from jsonb_object_keys(v_objet) k) is distinct from v_cles then
      raise exception 'Les saisies de l''annexe 2035-E partent mal formées : les huit valeurs, ni plus ni moins.'
        using errcode = '22023';
    end if;
    foreach v_cle in array v_cles loop
      if v_cle = 'mono_etablissement' then
        if jsonb_typeof(v_objet -> v_cle) not in ('boolean', 'null') then
          raise exception 'La valeur % part mal formée : vrai, faux ou à dire.', v_cle using errcode = '22023';
        end if;
      elsif jsonb_typeof(v_objet -> v_cle) = 'number' then
        if (v_objet ->> v_cle) !~ '^-?[0-9]{1,13}$' then
          raise exception 'La valeur % part mal formée : un nombre entier d''euros.', v_cle using errcode = '22023';
        end if;
      elsif jsonb_typeof(v_objet -> v_cle) <> 'null' then
        raise exception 'La valeur % part mal formée : un nombre entier d''euros, ou à saisir.', v_cle using errcode = '22023';
      end if;
    end loop;
  end loop;
  perform pg_advisory_xact_lock(hashtextextended('saisies_2035e:' || p_dossier_id::text || ':' || p_annee::text, 0));
  select jsonb_build_object(
      'loyers_deductibles', s.loyers_deductibles, 'plus_values', s.plus_values, 'variation_de_stock', s.variation_de_stock,
      'taxes_sur_le_chiffre_d_affaires', s.taxes_sur_le_chiffre_d_affaires,
      'dotations_biens_mis_a_disposition', s.dotations_biens_mis_a_disposition, 'moins_values', s.moins_values,
      'mono_etablissement', s.mono_etablissement, 'effectif', s.effectif)
    into v_actuelle
    from public.saisies_2035e s where s.dossier_id = p_dossier_id and s.annee = p_annee;
  if v_actuelle is null then
    v_actuelle := jsonb_build_object('loyers_deductibles', null, 'plus_values', null, 'variation_de_stock', null,
      'taxes_sur_le_chiffre_d_affaires', null, 'dotations_biens_mis_a_disposition', null, 'moins_values', null,
      'mono_etablissement', null, 'effectif', null);
  end if;
  if v_actuelle is distinct from p_lue then
    raise exception 'Les saisies de l''annexe 2035-E de l''exercice % ont changé depuis leur lecture : relis-les avant de les enregistrer.', p_annee
      using errcode = '40001';
  end if;
  insert into public.saisies_2035e (dossier_id, annee, loyers_deductibles, plus_values, variation_de_stock,
      taxes_sur_le_chiffre_d_affaires, dotations_biens_mis_a_disposition, moins_values, mono_etablissement, effectif)
    values (p_dossier_id, p_annee, (p_saisie ->> 'loyers_deductibles')::bigint, (p_saisie ->> 'plus_values')::bigint,
      (p_saisie ->> 'variation_de_stock')::bigint, (p_saisie ->> 'taxes_sur_le_chiffre_d_affaires')::bigint,
      (p_saisie ->> 'dotations_biens_mis_a_disposition')::bigint, (p_saisie ->> 'moins_values')::bigint,
      (p_saisie ->> 'mono_etablissement')::boolean, (p_saisie ->> 'effectif')::integer)
    on conflict on constraint saisies_2035e_une_par_exercice do update
      set loyers_deductibles = excluded.loyers_deductibles, plus_values = excluded.plus_values,
          variation_de_stock = excluded.variation_de_stock,
          taxes_sur_le_chiffre_d_affaires = excluded.taxes_sur_le_chiffre_d_affaires,
          dotations_biens_mis_a_disposition = excluded.dotations_biens_mis_a_disposition,
          moins_values = excluded.moins_values, mono_etablissement = excluded.mono_etablissement,
          effectif = excluded.effectif, updated_at = now()
    returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.enregistrer_saisies_2035e(uuid, integer, jsonb, jsonb) from public, anon;
grant execute on function public.enregistrer_saisies_2035e(uuid, integer, jsonb, jsonb) to authenticated;

comment on function public.enregistrer_saisies_2035e(uuid, integer, jsonb, jsonb) is
  'La saisie de l''annexe 2035-E d''un exercice, d''un seul tenant, contre la valeur lue qu''elle remplace (ligne 48). Aux droits de l''appelant.';

do $deux_facteurs$
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    execute 'create policy deux_facteurs on public.saisies_2035e as restrictive for all to authenticated '
      || 'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))';
  end if;
end
$deux_facteurs$;
