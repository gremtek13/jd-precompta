-- LES PARAMÈTRES DES COTISATIONS : LE DÉBUT D'ACTIVITÉ, L'ACRE ET LE TAUX DENTISTE (ligne 27, TNS-Q1 et TNS-Q4 ; PRÉPARÉE
-- le 07/11/2026, pas appliquée). Le récit : HISTORIQUE.md, « 07/11/2026 — LES PARAMÈTRES DES COTISATIONS : LE DÉBUT
-- D'ACTIVITÉ, L'ACRE ET LE TAUX DENTISTE (TNS-Q1, TNS-Q4) (PRÉPARÉE, PAS APPLIQUÉE) ».
--
-- SOURCES. Le moteur des simulateurs de l'Urssaf, `modele-ti` 0.1.0 (outils/cotisations/oracle.mjs), règle par règle :
-- « entreprise . date de création » (le plafond proratisé l'année de la création, la CURPS absente), « cotisations .
-- exonérations . Acre » (l'année de la création et la suivante, au prorata), « PAMC . assiette participation CPAM . taux
-- dentiste » (entre 0 et 1, au centième). Le Code de la sécurité sociale, art. D. 131-6-1 (l'exonération de début
-- d'activité), sur Légifrance ; la convention nationale des chirurgiens-dentistes libéraux, art. 51 (le taux dentiste
-- du relevé SNIR).
--
-- CE QUE LA MIGRATION POSE, rien d'autre (aucune destruction) :
--   1. `debuts_d_activite` : le début d'activité d'un dossier, une ligne au plus par dossier (`debuts_d_activite_un_par_dossier`,
--      TOTALE) ; la date nulle : effacée, sans suppression. À part de `dossiers`, que le client d'un dossier LIT ligne
--      entière (`dossiers_select`) : une colonne de plus lui ouvrirait une valeur que rien ne lui destine. Une donnée du
--      dossier, comme son identité : la validation d'un exercice ne la fige pas.
--   2. `parametres_des_cotisations` : l'ACRE et le taux dentiste d'un exercice, une ligne au plus par dossier et exercice
--      (`parametres_des_cotisations_un_par_exercice`, TOTALE), à partir de 2025, le premier exercice que l'estimation
--      couvre ; chaque valeur nulle tant que le cabinet ne l'a pas dite ; le taux en décimal exact, entre 0 et 1, au
--      centième, comme le moteur le borne.
--   3. La RLS : une policy `for all to authenticated` sur `admin_du_dossier(dossier_id)` sur chacune, AUCUNE branche client.
--   4. Le gel des paramètres d'un exercice : `garder_parametres_des_cotisations_valides`, sur le patron de
--      `garder_saisie_2035_validee` (la frontière de la validation, sous le verrou partagé de `cle_validation`) — un
--      exercice validé, ou que sa validation fige, ne reçoit, ne change ni ne perd plus ses paramètres (23514). Pas de
--      porte du super-administrateur : la restauration réinsère les exercices validés en dernier.
--   5. `enregistrer_parametres_des_cotisations`, aux droits de l'appelant (la RLS et le gel jugent) : le début d'activité
--      et les paramètres d'un exercice d'un seul tenant, contre les valeurs LUES qu'ils remplacent (40001 si l'une a changé
--      depuis) ; n'écrit que ce qui change.
--   6. Si la migration de la double authentification (`deux_facteurs_exiges`) est déjà en base, la policy restrictive
--      `deux_facteurs` sur les deux tables neuves, que le bloc DF de rls.sql exige d'une table créée après elle.

do $garde$
begin
  if to_regclass('public.debuts_d_activite') is not null or to_regclass('public.parametres_des_cotisations') is not null then
    raise exception 'La migration parametres_des_cotisations est déjà en base : une de ses tables existe.';
  end if;
  if to_regprocedure('public.frontiere_validation(uuid)') is null or to_regprocedure('public.cle_validation(uuid)') is null
     or to_regprocedure('public.exercice_fige(uuid, integer)') is null
     or to_regprocedure('public.retour_declencheur(text, anyelement, anyelement)') is null
     or to_regprocedure('public.admin_du_dossier(uuid)') is null then
    raise exception 'Le gel de la validation n''est pas celui que suppose cette migration : la relire avant de l''appliquer.';
  end if;
end
$garde$;

create table public.debuts_d_activite (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  date_debut date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint debuts_d_activite_date check (date_debut is null or (date_debut >= date '1900-01-01' and date_debut <= date '2100-12-31')),
  constraint debuts_d_activite_un_par_dossier unique (dossier_id)
);

comment on table public.debuts_d_activite is
  'Le début d''activité d''un dossier (TNS-Q1) : l''année où il tombe, l''estimation des cotisations proratise le plafond et ne compte pas la CURPS ; l''ACRE en dépend. À part de dossiers, que le client lit ; le client n''y lit rien.';
comment on column public.debuts_d_activite.date_debut is
  'La date de début d''activité ; nulle : effacée. Une donnée du dossier, que la validation d''un exercice ne fige pas.';

create table public.parametres_des_cotisations (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  annee integer not null,
  acre boolean,
  taux_dentiste numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint parametres_des_cotisations_annee check (annee >= 2025 and annee <= 2100),
  constraint parametres_des_cotisations_taux_dentiste check (taux_dentiste is null
    or (taux_dentiste >= 0 and taux_dentiste <= 1 and taux_dentiste = round(taux_dentiste, 2))),
  constraint parametres_des_cotisations_un_par_exercice unique (dossier_id, annee)
);

comment on table public.parametres_des_cotisations is
  'Les paramètres de l''estimation des cotisations d''un exercice (TNS-Q1, TNS-Q4) : le bénéfice de l''ACRE et le « taux dentiste » du relevé SNIR. Une ligne au plus par dossier et exercice ; figée avec l''exercice validé ; le client n''y lit rien.';
comment on column public.parametres_des_cotisations.acre is
  'Le praticien bénéficie-t-il de l''ACRE sur cet exercice ? Nul : non dit. Elle ne joue qu''à moins d''un an d''activité au 1er janvier.';
comment on column public.parametres_des_cotisations.taux_dentiste is
  'Le « taux dentiste » du relevé SNIR d''un chirurgien-dentiste, entre 0 et 1, au centième. Nul : non saisi.';

alter table public.debuts_d_activite enable row level security;
alter table public.parametres_des_cotisations enable row level security;

create policy debuts_d_activite_cabinet on public.debuts_d_activite
  for all to authenticated
  using (public.admin_du_dossier(dossier_id))
  with check (public.admin_du_dossier(dossier_id));

create policy parametres_des_cotisations_cabinet on public.parametres_des_cotisations
  for all to authenticated
  using (public.admin_du_dossier(dossier_id))
  with check (public.admin_du_dossier(dossier_id));

create function public.garder_parametres_des_cotisations_valides() returns trigger
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
        raise exception '% : ses paramètres des cotisations ne changent plus.', public.exercice_fige(old.dossier_id, old.annee)
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
    raise exception '% : ses paramètres des cotisations ne changent plus.', public.exercice_fige(new.dossier_id, new.annee)
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger parametres_des_cotisations_figes_par_la_validation
  before insert or update or delete on public.parametres_des_cotisations
  for each row execute function public.garder_parametres_des_cotisations_valides();

revoke execute on function public.garder_parametres_des_cotisations_valides() from public, anon, authenticated;

-- Le début d'activité et les paramètres d'un exercice, d'un seul tenant. `p_saisis` et `p_lus` portent chacun les trois
-- clés, ni plus ni moins : { "debut_activite": "AAAA-MM-JJ" | null, "acre": true | false | null, "taux_dentiste": 0.35 |
-- null } — `p_lus`, ce que l'écran a lu (une ligne absente se lit trois nulls). Aux droits de l'appelant : la policy et le
-- gel jugent chaque ligne ; le verrou du dossier sérialise deux enregistrements, et une valeur changée depuis sa lecture
-- refuse le tout. Ce qui ne change pas ne s'écrit pas : un début d'activité corrigé n'écrit rien dans un exercice validé.
-- Le contrôle d'accès vient d'abord, pour que le refus se dise sous ses mots.
create function public.enregistrer_parametres_des_cotisations(p_dossier_id uuid, p_annee integer, p_lus jsonb, p_saisis jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cles constant text[] := array['acre', 'debut_activite', 'taux_dentiste'];
  v_objet jsonb;
  v_debut_lu date;
  v_debut_saisi date;
  v_acre_lu boolean;
  v_acre_saisi boolean;
  v_taux_lu numeric;
  v_taux_saisi numeric;
  v_debut_actuel date;
  v_acre_actuel boolean;
  v_taux_actuel numeric;
  v_n integer := 0;
begin
  if p_dossier_id is null or not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Les paramètres des cotisations ne s''écrivent que par le cabinet du dossier.' using errcode = '42501';
  end if;
  if p_annee is null or jsonb_typeof(p_lus) is distinct from 'object' or jsonb_typeof(p_saisis) is distinct from 'object' then
    raise exception 'Les paramètres des cotisations partent mal formés : un exercice, les valeurs saisies et celles lues.'
      using errcode = '22023';
  end if;
  foreach v_objet in array array[p_lus, p_saisis] loop
    if (select array_agg(k order by k collate "C") from jsonb_object_keys(v_objet) k) is distinct from v_cles
       or jsonb_typeof(v_objet -> 'debut_activite') not in ('string', 'null')
       or jsonb_typeof(v_objet -> 'acre') not in ('boolean', 'null')
       or jsonb_typeof(v_objet -> 'taux_dentiste') not in ('number', 'null')
       or (jsonb_typeof(v_objet -> 'debut_activite') = 'string' and (v_objet ->> 'debut_activite') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then
      raise exception 'Les paramètres des cotisations partent mal formés : le début d''activité (AAAA-MM-JJ), l''ACRE et le taux dentiste, saisis et lus.'
        using errcode = '22023';
    end if;
  end loop;
  begin
    v_debut_lu := (p_lus ->> 'debut_activite')::date;
    v_debut_saisi := (p_saisis ->> 'debut_activite')::date;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'Le début d''activité n''est pas une date du calendrier.' using errcode = '22023';
  end;
  v_acre_lu := (p_lus ->> 'acre')::boolean;
  v_acre_saisi := (p_saisis ->> 'acre')::boolean;
  v_taux_lu := (p_lus ->> 'taux_dentiste')::numeric;
  v_taux_saisi := (p_saisis ->> 'taux_dentiste')::numeric;

  perform pg_advisory_xact_lock(hashtextextended('parametres_des_cotisations:' || p_dossier_id::text, 0));
  select d.date_debut into v_debut_actuel from public.debuts_d_activite d where d.dossier_id = p_dossier_id;
  select c.acre, c.taux_dentiste into v_acre_actuel, v_taux_actuel
    from public.parametres_des_cotisations c where c.dossier_id = p_dossier_id and c.annee = p_annee;
  if v_debut_actuel is distinct from v_debut_lu or v_acre_actuel is distinct from v_acre_lu
     or v_taux_actuel is distinct from v_taux_lu then
    raise exception 'Les paramètres des cotisations de l''exercice % ont changé depuis leur lecture : relis-les avant de les enregistrer.', p_annee
      using errcode = '40001';
  end if;

  if v_debut_saisi is distinct from v_debut_actuel then
    insert into public.debuts_d_activite (dossier_id, date_debut) values (p_dossier_id, v_debut_saisi)
      on conflict on constraint debuts_d_activite_un_par_dossier do update
        set date_debut = excluded.date_debut, updated_at = now();
    v_n := v_n + 1;
  end if;
  if v_acre_saisi is distinct from v_acre_actuel or v_taux_saisi is distinct from v_taux_actuel then
    insert into public.parametres_des_cotisations (dossier_id, annee, acre, taux_dentiste)
      values (p_dossier_id, p_annee, v_acre_saisi, v_taux_saisi)
      on conflict on constraint parametres_des_cotisations_un_par_exercice do update
        set acre = excluded.acre, taux_dentiste = excluded.taux_dentiste, updated_at = now();
    v_n := v_n + 1;
  end if;
  return v_n;
end;
$$;

revoke execute on function public.enregistrer_parametres_des_cotisations(uuid, integer, jsonb, jsonb) from public, anon;
grant execute on function public.enregistrer_parametres_des_cotisations(uuid, integer, jsonb, jsonb) to authenticated;

comment on function public.enregistrer_parametres_des_cotisations(uuid, integer, jsonb, jsonb) is
  'Le début d''activité du dossier et l''ACRE et le taux dentiste d''un exercice, tout ou rien, contre les valeurs lues qu''ils remplacent (TNS-Q1, TNS-Q4). Aux droits de l''appelant.';

do $deux_facteurs$
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    execute 'create policy deux_facteurs on public.debuts_d_activite as restrictive for all to authenticated '
      || 'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))';
    execute 'create policy deux_facteurs on public.parametres_des_cotisations as restrictive for all to authenticated '
      || 'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))';
  end if;
end
$deux_facteurs$;
