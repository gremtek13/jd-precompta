-- LES EXERCICES DU DOSSIER (ligne 42, lot EXD2 ; PRÉPARÉE le 12/11/2026, pas appliquée). La conception :
-- docs/conceptions/42-exercices-decales.md (§ 3 et § 4.1-4.2) ; le jumeau pur : src/lib/exercices.ts (EXD1) ; le récit :
-- HISTORIQUE.md, « 12/11/2026 — EXD2 : LES EXERCICES DU DOSSIER, EN BASE (LIGNE 42) (PRÉPARÉE, PAS APPLIQUÉE) ». Les
-- questions EXD-Q1 à Q8 ne sont pas tranchées : la migration suit leurs recommandations — le millésime de clôture, unique
-- par dossier (Q1 (A)) ; aucune ligne pour un dossier en trésorerie (Q2 (A)) ; un premier exercice clos au plus tard le
-- 31 décembre de l'année qui suit son début (Q3 (A)) ; une transition d'un jour à vingt-trois mois, sa décision datée
-- (Q4 (A)).
--
-- SOURCES. CGI art. 12 et 93 (le bénéfice d'un BNC est celui de l'année civile : un dossier en trésorerie n'a jamais
-- d'exercice décalé) ; code de commerce L123-12 (l'inventaire au moins une fois tous les douze mois) ; BOI-BIC-BASE-10-10
-- (la tolérance du premier exercice d'une entreprise nouvelle). Cités de mémoire par la conception (§ 9 : à relire sur
-- Légifrance avant la mise en production, EXD8).
--
-- CE QUE LA MIGRATION POSE, rien d'autre (aucune destruction ; rien d'autre ne lit encore ces fonctions : ni
-- `frontiere_validation`, ni `valider_exercice`, ni l'application — EXD3 et EXD4) :
--   1. `btree_gist`, dans le schéma `extensions` : l'égalité d'un uuid et d'un entier dans un index GiST, pour deux
--      contraintes d'exclusion DIFFÉRÉES à la validation de la transaction — ni chevauchement, ni deux clôtures la même
--      année — qui ne sont qu'un filet : la garde dit les refus avant elles, sous les mots du module.
--   2. `exercices` : les exercices DÉCLARÉS d'un dossier en engagement (début, fin, nature `premier`, `ordinaire` ou
--      `transition` ; la décision qui change la date de clôture et sa date, pour une transition seulement ; qui a déclaré,
--      et quand). Une policy `for all to authenticated` sur `admin_du_dossier(dossier_id)`, aucune branche client.
--   3. La garde, en deux temps, dans l'ordre des refus de `refusDesExercices` (src/lib/exercices.ts) :
--      `garder_exercices` (AVANT chaque ligne) : un dossier en trésorerie, puis la ligne seule (ses dates, fin avant
--      début, nature, durée du premier, de l'ordinaire, de la transition, la décision), puis la période figée par les
--      validations (un exercice déclaré commence après elle ; un exercice qu'elle couvre ne change plus) ;
--      `verifier_la_suite_des_exercices` (APRÈS chaque ligne, donc à la fin de l'instruction, sur la liste entière) : le
--      premier en tête, ni chevauchement ni trou, une clôture par année. La liste se juge précédée de la dernière année
--      civile validée — les validations d'avant EXD3 sont civiles — : le premier déclaré commence le lendemain de sa fin.
--      Jugée à la fin de l'instruction, la suite accepte une insertion de plusieurs lignes dans n'importe quel ordre : la
--      restauration réinsère les exercices d'un dossier d'un seul lot, sans exception pour le super-administrateur.
--   4. `declarer_exercice` et `changer_date_de_cloture`, `security definer`, l'accès contrôlé avant toute lecture, sous le
--      verrou de la validation (`cle_validation`) ; la seconde change la clôture du DERNIER exercice déclaré, qui devient
--      une transition (§ 3.6), contre la clôture LUE.
--   5. `bornes_de_l_exercice` et `exercice_de_la_date` : l'année civile pour tout dossier en trésorerie ET pour tout dossier
--      en engagement qui n'a rien déclaré (l'état de tout dossier aujourd'hui) ; sinon l'exercice déclaré, et l'année civile
--      d'une période que les validations ont figée ; rien pour un dossier que l'appelant ne suit pas.
--   6. Un dossier qui a déclaré ses exercices ne repasse pas en trésorerie (`dossiers_exercices_retiennent_l_engagement`).
--   7. Si la migration de la double authentification (`deux_facteurs_exiges`) est déjà en base, la policy restrictive
--      `deux_facteurs` sur la table neuve, que le bloc DF de rls.sql exige d'une table créée après elle.
-- Les droits hors RLS : la table naît sous les défauts de `droits_hors_rls` (SELECT, INSERT, UPDATE, DELETE seuls), que le
-- bloc HR de rls.sql juge.
--
-- CE QUE LE MODULE A ET QUE LA BASE N'A PAS : la date inexistante (le type `date` la refuse à la lecture du paramètre) ;
-- ici, une date hors des années 1000 à 9999 se refuse sous les mêmes mots. CE QUE LA BASE A ET QUE LE MODULE N'A PAS : la
-- période figée, l'accès, l'appel mal formé, la clôture lue qui a changé (40001).

do $garde$
begin
  if to_regclass('public.exercices') is not null then
    raise exception 'La migration exercices_du_dossier est déjà en base : la table existe.';
  end if;
  if to_regprocedure('public.bornes_de_l_exercice(uuid, integer)') is not null
     or to_regprocedure('public.exercice_de_la_date(uuid, date)') is not null then
    raise exception 'La migration exercices_du_dossier est déjà en base : ses lectures existent.';
  end if;
  if to_regprocedure('public.frontiere_validation(uuid)') is null or to_regprocedure('public.cle_validation(uuid)') is null
     or to_regprocedure('public.exercice_fige(uuid, integer)') is null
     or to_regprocedure('public.admin_du_dossier(uuid)') is null or to_regprocedure('public.is_super_admin()') is null then
    raise exception 'Le gel de la validation n''est pas celui que suppose cette migration : la relire avant de l''appliquer.';
  end if;
end
$garde$;

create extension if not exists btree_gist with schema extensions;

create table public.exercices (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  debut date not null,
  fin date not null,
  nature text not null,
  decision text,
  decision_le date,
  declare_le timestamptz not null default now(),
  declare_par uuid not null default auth.uid(),
  constraint exercices_bornes check (debut <= fin and debut >= date '1000-01-01' and fin <= date '9999-12-31'),
  constraint exercices_nature check (nature in ('premier', 'ordinaire', 'transition')),
  constraint exercices_decision check (case when nature = 'transition'
    then decision is not null and decision ~ '[^[:space:]]' and decision_le is not null
    else decision is null and decision_le is null end),
  constraint exercices_sans_chevauchement exclude using gist (dossier_id with =, daterange(debut, fin, '[]') with &&)
    deferrable initially deferred,
  constraint exercices_un_millesime exclude using gist (dossier_id with =, ((extract(year from fin))::integer) with =)
    deferrable initially deferred
);

comment on table public.exercices is
  'Les exercices DÉCLARÉS d''un dossier en engagement (ligne 42) : ni trou ni chevauchement, une clôture par année civile (le nom d''un exercice est le millésime de sa clôture). Un dossier en trésorerie n''y a aucune ligne : son exercice est l''année civile (CGI art. 12 et 93). Écrite par declarer_exercice et changer_date_de_cloture ; lue par bornes_de_l_exercice et exercice_de_la_date.';
comment on column public.exercices.nature is
  'premier (le premier exercice du dossier, clos au plus tard le 31 décembre de l''année qui suit son début), ordinaire (douze mois), transition (d''un jour à vingt-trois mois, après une décision qui change la date de clôture).';
comment on column public.exercices.decision is
  'La décision qui change la date de clôture (l''assemblée qui modifie les statuts, ou celle de l''exploitant), pour une transition seulement.';
comment on column public.exercices.declare_par is
  'Le compte qui a déclaré l''exercice (ou changé sa clôture) ; la restauration garde celui de la sauvegarde.';

alter table public.exercices enable row level security;

create policy exercices_cabinet on public.exercices
  for all to authenticated
  using (public.admin_du_dossier(dossier_id))
  with check (public.admin_du_dossier(dossier_id));

-- AVANT chaque ligne : le dossier, la ligne seule, la période figée — dans l'ordre de `refusDesExercices`, dont les
-- refus sont ici aux mêmes mots (exercicesDuDossier.test.ts les confronte). Le verrou exclusif de la validation sérialise
-- deux déclarations d'un même dossier, et une déclaration avec une validation.
create function public.garder_exercices() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text;
  v_frontiere date;
  v_limite date;
  v_cloture_precedente date;
  v_douze_mois date;
begin
  if tg_op <> 'INSERT' then
    -- La suppression d'un dossier emporte ses exercices : rien à garder.
    if not exists (select 1 from public.dossiers where id = old.dossier_id) then
      if tg_op = 'DELETE' then
        return old;
      end if;
      return new;
    end if;
    if tg_op = 'UPDATE' and (new.id is distinct from old.id or new.dossier_id is distinct from old.dossier_id) then
      raise exception 'Un exercice déclaré garde son identifiant et son dossier.' using errcode = '23514';
    end if;
    perform pg_advisory_xact_lock(public.cle_validation(old.dossier_id));
    v_frontiere := public.frontiere_validation(old.dossier_id);
    if v_frontiere is not null and old.debut <= v_frontiere then
      raise exception '% : l''exercice déclaré du % au %, qu''il fige, ne change plus.',
        public.exercice_fige(old.dossier_id, extract(year from v_frontiere)::integer),
        to_char(old.debut, 'DD/MM/YYYY'), to_char(old.fin, 'DD/MM/YYYY') using errcode = '23514';
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
  else
    perform pg_advisory_xact_lock(public.cle_validation(new.dossier_id));
    v_frontiere := public.frontiere_validation(new.dossier_id);
  end if;

  if new.debut is null or new.fin is null or new.nature is null then
    raise exception 'Un exercice déclaré a un début, une fin et une nature.' using errcode = '23502';
  end if;
  select d.mode_comptable into v_mode from public.dossiers d where d.id = new.dossier_id;
  if v_mode is null then
    return new; -- la clé étrangère refuse un dossier qui n'existe pas
  end if;

  -- 1. Un dossier en trésorerie suit l'année civile par la loi : rien ne s'y déclare (EXD-Q2 (A)).
  if v_mode = 'tresorerie' then
    if new.debut between date '1000-01-01' and date '9999-12-31'
       and extract(month from new.debut) = 1 and extract(day from new.debut) = 1
       and new.fin = make_date(extract(year from new.debut)::integer, 12, 31) then
      raise exception 'Un dossier en trésorerie suit l''année civile par la loi (CGI art. 12 et 93) : l''exercice % se calcule, il ne se déclare pas.',
        extract(year from new.fin)::integer using errcode = '23514';
    end if;
    raise exception 'Un dossier en trésorerie (BNC, 2035) suit l''année civile, du 1er janvier au 31 décembre : un exercice du % au % ne s''y déclare pas.',
      to_char(new.debut, 'DD/MM/YYYY'), to_char(new.fin, 'DD/MM/YYYY') using errcode = '23514';
  end if;

  -- 2. La ligne seule.
  if new.debut not between date '1000-01-01' and date '9999-12-31' then
    raise exception 'La date de début « % » n''existe pas au calendrier.', to_char(new.debut, 'YYYY-MM-DD') using errcode = '23514';
  end if;
  if new.fin not between date '1000-01-01' and date '9999-12-31' then
    raise exception 'La date de fin « % » n''existe pas au calendrier.', to_char(new.fin, 'YYYY-MM-DD') using errcode = '23514';
  end if;
  if new.fin < new.debut then
    raise exception 'L''exercice se clôt le %, avant son début, le %.', to_char(new.fin, 'DD/MM/YYYY'), to_char(new.debut, 'DD/MM/YYYY')
      using errcode = '23514';
  end if;
  if new.nature not in ('premier', 'ordinaire', 'transition') then
    raise exception 'Un exercice déclaré est un premier exercice, un exercice ordinaire ou un exercice de transition (« % » ne l''est pas).',
      new.nature using errcode = '23514';
  end if;
  if new.nature = 'premier' then
    -- EXD-Q3 (A) : au plus tard le 31 décembre de l'année qui suit son début.
    v_limite := make_date(extract(year from new.debut)::integer + 1, 12, 31);
    if new.fin > v_limite then
      raise exception 'Le premier exercice (du % au %) se clôt au plus tard le 31 décembre de l''année qui suit son début, soit le %.',
        to_char(new.debut, 'DD/MM/YYYY'), to_char(new.fin, 'DD/MM/YYYY'), to_char(v_limite, 'DD/MM/YYYY') using errcode = '23514';
    end if;
  end if;
  if new.nature = 'ordinaire' then
    -- Douze mois : la clôture précédente (la veille du début) un an plus tard — une date + un intervalle rabat le jour sur
    -- la fin du mois, comme `ajouterMois` — ou, quand elle est une fin de mois, la fin du même mois un an plus tard.
    v_cloture_precedente := new.debut - 1;
    v_douze_mois := (v_cloture_precedente + interval '12 months')::date;
    if not (new.fin = v_douze_mois
            or (extract(day from v_cloture_precedente + 1) = 1 and extract(day from new.fin + 1) = 1
                and date_trunc('month', new.fin::timestamp) = date_trunc('month', v_douze_mois::timestamp))) then
      raise exception 'Un exercice ordinaire dure douze mois : commencé le %, il se clôt le %. Un exercice d''une autre durée est un premier exercice ou un exercice de transition.',
        to_char(new.debut, 'DD/MM/YYYY'), to_char(v_douze_mois, 'DD/MM/YYYY') using errcode = '23514';
    end if;
  end if;
  if new.nature = 'transition' then
    -- EXD-Q4 (A) : d'un jour à vingt-trois mois, la décision datée.
    v_limite := (new.debut + interval '23 months')::date - 1;
    if new.fin > v_limite then
      raise exception 'Un exercice de transition dure d''un jour à vingt-trois mois : commencé le %, il se clôt au plus tard le %.',
        to_char(new.debut, 'DD/MM/YYYY'), to_char(v_limite, 'DD/MM/YYYY') using errcode = '23514';
    end if;
    if new.decision is null or new.decision !~ '[^[:space:]]' or new.decision_le is null then
      raise exception 'Un exercice de transition cite la décision qui change la date de clôture (l''assemblée qui modifie les statuts, ou celle de l''exploitant) et sa date.'
        using errcode = '23514';
    end if;
  elsif new.decision is not null or new.decision_le is not null then
    raise exception 'Seul un exercice de transition cite une décision de changement de la date de clôture.' using errcode = '23514';
  end if;

  -- 3. La période figée par les validations : un exercice déclaré commence après elle.
  if v_frontiere is not null and new.debut <= v_frontiere then
    raise exception '% : un exercice déclaré commence après lui, le % au plus tôt.',
      public.exercice_fige(new.dossier_id, extract(year from v_frontiere)::integer), to_char(v_frontiere + 1, 'DD/MM/YYYY')
      using errcode = '23514';
  end if;

  -- Qui déclare, et quand : l'appelant, maintenant — la restauration (le super-administrateur) garde ceux de la sauvegarde.
  if tg_op = 'INSERT' and coalesce(public.is_super_admin(), false) then
    new.declare_par := coalesce(new.declare_par, auth.uid());
    new.declare_le := coalesce(new.declare_le, now());
  else
    new.declare_par := auth.uid();
    new.declare_le := now();
  end if;
  return new;
end;
$$;

-- APRÈS chaque ligne, donc à la fin de l'instruction : la liste entière, précédée de la dernière année civile validée.
create function public.verifier_la_suite_des_exercices() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dossier uuid;
  v_frontiere date;
  r record;
begin
  if tg_op = 'DELETE' then
    v_dossier := old.dossier_id;
  else
    v_dossier := new.dossier_id;
  end if;
  if not exists (select 1 from public.dossiers where id = v_dossier) then
    return null;
  end if;
  v_frontiere := public.frontiere_validation(v_dossier);

  -- 4. Le premier exercice en tête.
  select s.debut, s.fin, s.debut_avant, s.fin_avant into r
    from (select l.debut, l.fin, l.nature, lag(l.debut) over w as debut_avant, lag(l.fin) over w as fin_avant,
                 row_number() over w as rang
            from (select e.debut, e.fin, e.nature from public.exercices e where e.dossier_id = v_dossier
                  union all
                  select make_date(extract(year from v_frontiere)::integer, 1, 1), v_frontiere, 'valide' where v_frontiere is not null) l
          window w as (order by l.debut, l.fin)) s
   where s.nature = 'premier' and s.rang > 1
   order by s.debut, s.fin
   limit 1;
  if found then
    raise exception 'L''exercice du % au % est déclaré premier exercice alors qu''un exercice le précède (du % au %).',
      to_char(r.debut, 'DD/MM/YYYY'), to_char(r.fin, 'DD/MM/YYYY'), to_char(r.debut_avant, 'DD/MM/YYYY'),
      to_char(r.fin_avant, 'DD/MM/YYYY') using errcode = '23514';
  end if;

  -- 5. Ni chevauchement ni trou, d'un exercice au suivant.
  select s.debut, s.fin, s.debut_avant, s.fin_avant into r
    from (select l.debut, l.fin, lag(l.debut) over w as debut_avant, lag(l.fin) over w as fin_avant, row_number() over w as rang
            from (select e.debut, e.fin from public.exercices e where e.dossier_id = v_dossier
                  union all
                  select make_date(extract(year from v_frontiere)::integer, 1, 1), v_frontiere where v_frontiere is not null) l
          window w as (order by l.debut, l.fin)) s
   where s.rang > 1 and s.debut <> s.fin_avant + 1
   order by s.debut, s.fin
   limit 1;
  if found then
    if r.debut <= r.fin_avant then
      raise exception 'Les exercices du % au % et du % au % se chevauchent : un jour n''appartient qu''à un exercice.',
        to_char(r.debut_avant, 'DD/MM/YYYY'), to_char(r.fin_avant, 'DD/MM/YYYY'), to_char(r.debut, 'DD/MM/YYYY'),
        to_char(r.fin, 'DD/MM/YYYY') using errcode = '23514';
    end if;
    raise exception 'Entre l''exercice du % au % et l''exercice du % au %, les jours du % au % n''appartiennent à aucun exercice.',
      to_char(r.debut_avant, 'DD/MM/YYYY'), to_char(r.fin_avant, 'DD/MM/YYYY'), to_char(r.debut, 'DD/MM/YYYY'),
      to_char(r.fin, 'DD/MM/YYYY'), to_char(r.fin_avant + 1, 'DD/MM/YYYY'), to_char(r.debut - 1, 'DD/MM/YYYY')
      using errcode = '23514';
  end if;

  -- 6. Une clôture par année civile : le nom d'un exercice est son millésime (EXD-Q1 (A)).
  select extract(year from l.fin)::integer as millesime, count(*) as nombre,
         string_agg('du ' || to_char(l.debut, 'DD/MM/YYYY') || ' au ' || to_char(l.fin, 'DD/MM/YYYY'), ' ; ' order by l.debut, l.fin) as liste
    into r
    from (select e.debut, e.fin from public.exercices e where e.dossier_id = v_dossier
          union all
          select make_date(extract(year from v_frontiere)::integer, 1, 1), v_frontiere where v_frontiere is not null) l
   group by 1
  having count(*) > 1
   order by 1
   limit 1;
  if found then
    raise exception '% exercices se clôturent en % (%) : un exercice porte le nom de l''année de sa clôture, deux ne peuvent pas porter le même. Une transition qui avance la clôture dans l''année s''allonge jusqu''à la nouvelle date de l''année suivante.',
      r.nombre, r.millesime, r.liste using errcode = '23514';
  end if;
  return null;
end;
$$;

create trigger exercices_garde
  before insert or update or delete on public.exercices
  for each row execute function public.garder_exercices();

create trigger exercices_suite
  after insert or update or delete on public.exercices
  for each row execute function public.verifier_la_suite_des_exercices();

revoke execute on function public.garder_exercices() from public, anon, authenticated;
revoke execute on function public.verifier_la_suite_des_exercices() from public, anon, authenticated;

-- Un dossier qui a déclaré ses exercices ne repasse pas en trésorerie (le modèle ne change déjà que sur un brouillon vide).
create function public.garder_l_engagement_des_exercices() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.exercices e where e.dossier_id = new.id) then
    raise exception 'Le dossier a déclaré ses exercices : il reste en comptabilité d''engagement (en trésorerie, l''exercice est l''année civile, qui ne se déclare pas).'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger dossiers_exercices_retiennent_l_engagement
  before update of mode_comptable on public.dossiers
  for each row when (old.mode_comptable = 'engagement' and new.mode_comptable is distinct from 'engagement')
  execute function public.garder_l_engagement_des_exercices();

revoke execute on function public.garder_l_engagement_des_exercices() from public, anon, authenticated;

-- Déclarer un exercice : le cabinet du dossier seul ; la garde juge le reste, sous ses mots.
create function public.declarer_exercice(p_dossier_id uuid, p_debut date, p_fin date, p_nature text, p_decision text,
                                         p_decision_le date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_dossier_id is null or not coalesce(public.admin_du_dossier(p_dossier_id), false) then
    raise exception 'Les exercices d''un dossier ne se déclarent que par son cabinet.' using errcode = '42501';
  end if;
  if p_debut is null or p_fin is null or p_nature is null then
    raise exception 'La déclaration d''un exercice part mal formée : son début, sa fin et sa nature.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(public.cle_validation(p_dossier_id));
  insert into public.exercices (dossier_id, debut, fin, nature, decision, decision_le)
    values (p_dossier_id, p_debut, p_fin, p_nature, p_decision, p_decision_le)
    returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.declarer_exercice(uuid, date, date, text, text, date) from public, anon;
grant execute on function public.declarer_exercice(uuid, date, date, text, text, date) to authenticated;

comment on function public.declarer_exercice(uuid, date, date, text, text, date) is
  'Déclare un exercice d''un dossier en engagement (ligne 42) : le cabinet du dossier seul ; la garde refuse sous les mots de src/lib/exercices.ts.';

-- Changer la date de clôture (§ 3.6) : le DERNIER exercice déclaré, désigné par sa clôture LUE, devient une transition
-- jusqu'à la nouvelle date ; les suivants se déclarent ensuite sur elle. La garde juge la transition et la suite.
create function public.changer_date_de_cloture(p_dossier_id uuid, p_fin_lue date, p_nouvelle_cloture date, p_decision text,
                                               p_decision_le date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text;
  v_id uuid;
  v_debut date;
  v_debut_civil date;
begin
  if p_dossier_id is null or not coalesce(public.admin_du_dossier(p_dossier_id), false) then
    raise exception 'Les exercices d''un dossier ne se déclarent que par son cabinet.' using errcode = '42501';
  end if;
  if p_fin_lue is null or p_nouvelle_cloture is null then
    raise exception 'Le changement de la date de clôture part mal formé : la clôture lue de l''exercice qu''il change, et la nouvelle.'
      using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(public.cle_validation(p_dossier_id));
  select d.mode_comptable into v_mode from public.dossiers d where d.id = p_dossier_id;
  if v_mode = 'tresorerie' then
    v_debut_civil := make_date(extract(year from p_fin_lue)::integer, 1, 1);
    if p_nouvelle_cloture = make_date(extract(year from p_fin_lue)::integer, 12, 31) then
      raise exception 'Un dossier en trésorerie suit l''année civile par la loi (CGI art. 12 et 93) : l''exercice % se calcule, il ne se déclare pas.',
        extract(year from p_nouvelle_cloture)::integer using errcode = '23514';
    end if;
    raise exception 'Un dossier en trésorerie (BNC, 2035) suit l''année civile, du 1er janvier au 31 décembre : un exercice du % au % ne s''y déclare pas.',
      to_char(v_debut_civil, 'DD/MM/YYYY'), to_char(p_nouvelle_cloture, 'DD/MM/YYYY') using errcode = '23514';
  end if;
  select e.id, e.debut into v_id, v_debut from public.exercices e
   where e.dossier_id = p_dossier_id and e.fin = p_fin_lue
     for update;
  if v_id is null then
    raise exception 'Les exercices du dossier ont changé depuis leur lecture : aucun ne se clôt plus le %. Relis-les.',
      to_char(p_fin_lue, 'DD/MM/YYYY') using errcode = '40001';
  end if;
  if exists (select 1 from public.exercices e where e.dossier_id = p_dossier_id and e.debut > p_fin_lue) then
    raise exception 'La date de clôture se change sur le dernier exercice déclaré : un exercice est déjà déclaré après celui du % au %.',
      to_char(v_debut, 'DD/MM/YYYY'), to_char(p_fin_lue, 'DD/MM/YYYY') using errcode = '23514';
  end if;
  if p_nouvelle_cloture = p_fin_lue then
    raise exception 'L''exercice se clôt déjà le % : sa date de clôture ne change pas.', to_char(p_fin_lue, 'DD/MM/YYYY')
      using errcode = '22023';
  end if;
  update public.exercices
     set fin = p_nouvelle_cloture, nature = 'transition', decision = p_decision, decision_le = p_decision_le
   where id = v_id;
  return v_id;
end;
$$;

revoke execute on function public.changer_date_de_cloture(uuid, date, date, text, date) from public, anon;
grant execute on function public.changer_date_de_cloture(uuid, date, date, text, date) to authenticated;

comment on function public.changer_date_de_cloture(uuid, date, date, text, date) is
  'Change la date de clôture du dernier exercice déclaré, qui devient une transition (ligne 42, § 3.6), contre sa clôture lue.';

-- LES BORNES D'UN EXERCICE, désigné par son millésime : l'année civile en trésorerie et pour un dossier en engagement qui
-- n'a rien déclaré ; sinon l'exercice déclaré qui se clôt cette année-là, ou l'année civile qu'une validation a figée ;
-- rien hors de là, ni pour un dossier que l'appelant ne suit pas (le jumeau : `exerciceDuMillesime`).
create function public.bornes_de_l_exercice(p_dossier_id uuid, p_annee integer)
returns table (debut date, fin date)
language sql
stable
security definer
set search_path = public
as $$
  with d as (
    select dd.id,
           dd.mode_comptable = 'tresorerie' or not exists (select 1 from public.exercices e where e.dossier_id = dd.id) as civil,
           public.frontiere_validation(dd.id) as frontiere
      from public.dossiers dd
     where dd.id = p_dossier_id and p_annee between 1000 and 9999 and public.admin_du_dossier(dd.id)
  ), declares as (
    select e.debut, e.fin from d join public.exercices e on e.dossier_id = d.id
     where not d.civil and extract(year from e.fin) = p_annee
  )
  select make_date(p_annee, 1, 1), make_date(p_annee, 12, 31) from d where d.civil
  union all
  select x.debut, x.fin from declares x where (select count(*) from declares) = 1
  union all
  select make_date(p_annee, 1, 1), make_date(p_annee, 12, 31) from d
   where not d.civil and not exists (select 1 from declares) and p_annee <= extract(year from d.frontiere)
$$;

revoke execute on function public.bornes_de_l_exercice(uuid, integer) from public, anon;
grant execute on function public.bornes_de_l_exercice(uuid, integer) to authenticated;

comment on function public.bornes_de_l_exercice(uuid, integer) is
  'Les bornes de l''exercice d''un millésime (ligne 42) : civiles en trésorerie et pour un dossier en engagement qui n''a rien déclaré, déclarées sinon. Rien pour un dossier que l''appelant ne suit pas.';

-- L'EXERCICE D'UNE DATE, son millésime : l'année de la date en trésorerie et pour un dossier en engagement qui n'a rien
-- déclaré ; sinon celui de l'UNIQUE exercice déclaré qui la contient, ou l'année d'une date qu'une validation a figée ; nul
-- hors de là (le jumeau : `exerciceDeLaDate`).
create function public.exercice_de_la_date(p_dossier_id uuid, p_date date)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when d.mode_comptable = 'tresorerie' or not exists (select 1 from public.exercices e where e.dossier_id = d.id)
      then extract(year from p_date)::integer
    when (select count(*) from public.exercices e where e.dossier_id = d.id and p_date between e.debut and e.fin) = 1
      then (select extract(year from e.fin)::integer from public.exercices e
             where e.dossier_id = d.id and p_date between e.debut and e.fin)
    when not exists (select 1 from public.exercices e where e.dossier_id = d.id and p_date between e.debut and e.fin)
         and p_date <= public.frontiere_validation(d.id)
      then extract(year from p_date)::integer
  end
  from public.dossiers d
  where d.id = p_dossier_id and p_date between date '1000-01-01' and date '9999-12-31' and public.admin_du_dossier(d.id)
$$;

revoke execute on function public.exercice_de_la_date(uuid, date) from public, anon;
grant execute on function public.exercice_de_la_date(uuid, date) to authenticated;

comment on function public.exercice_de_la_date(uuid, date) is
  'Le millésime de l''exercice d''une date (ligne 42) : son année en trésorerie et pour un dossier en engagement qui n''a rien déclaré, l''exercice déclaré qui la contient sinon. Nul hors des exercices, ou pour un dossier que l''appelant ne suit pas.';

-- La double authentification exigée : appliquée avant celle-ci, sa policy restrictive sur la table neuve, à l'identique.
do $deux_facteurs$
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    execute 'create policy deux_facteurs on public.exercices as restrictive for all to authenticated '
            'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))';
  end if;
end
$deux_facteurs$;

-- La porte d'accès devant les gardes (acces_avant_les_gardes, ligne 43), si elle est déjà en base.
-- La garde `security definer` de cette migration sur sa table neuve : `garder_exercices` (celle de `dossiers`,
-- `garder_l_engagement_des_exercices`, ne tire qu'à la mise à jour d'une ligne que la policy de `dossiers` laisse voir :
-- la porte n'y est pas, pour la raison qu'elle dit).
-- Une garde `security definer` tire avant l'expression WITH CHECK de la policy : sans la porte, elle répondrait à un
-- appelant que la policy refuse. Si la porte est en base, elle se pose ici, la première des déclencheurs BEFORE de la
-- table ; sinon, la porte la posera d'elle-même en s'appliquant (elle couvre toute table de cette liste qui porte déjà sa
-- garde). Les deux migrations se collent ainsi dans les deux ordres. L'essai : supabase/essais/accesAvantLesGardes.sql
-- (étape 32).
do $porte$
declare
  v_table text;
begin
  if to_regprocedure('public.acces_avant_les_gardes()') is not null then
    foreach v_table in array array['exercices'] loop
      if exists (select 1 from pg_catalog.pg_class c where c.oid = ('public.' || v_table)::regclass and not (c.relrowsecurity and not c.relforcerowsecurity))
         or exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = ('public.' || v_table)::regclass and not t.tgisinternal
                     and (t.tgname collate "C") < ('_acces_avant_les_gardes' collate "C")) then
        raise exception 'La porte d''accès ne se pose pas sur public.% : sa RLS n''est pas active (ou forcée), ou un déclencheur tirerait avant elle.', v_table;
      end if;
      if not exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = ('public.' || v_table)::regclass and t.tgname = '_acces_avant_les_gardes') then
        execute format('create trigger _acces_avant_les_gardes before insert or update on public.%I for each row execute function public.acces_avant_les_gardes()', v_table);
      end if;
    end loop;
  end if;
end
$porte$;
