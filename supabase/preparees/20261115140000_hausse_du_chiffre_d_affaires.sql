-- L'ALERTE DE HAUSSE DU CHIFFRE D'AFFAIRES D'UN DOSSIER (la demande du cabinet du 15/11/2026, au MVP) — PRÉPARÉE le
-- 15/11/2026, PAS APPLIQUÉE. La conception : docs/conceptions/52-alerte-hausse-du-chiffre-d-affaires.md ; le récit :
-- HISTORIQUE.md, « 15/11/2026 — L'ALERTE DE HAUSSE DU CHIFFRE D'AFFAIRES » ; les essais : supabase/essais/hausseDuChiffreDAffaires.sql
-- et son compagnon de réplique, supabase/essais/hausseDuChiffreDAffairesSuppression.sql ; le retour :
-- supabase/preparees/retour/20261115140100_retour_hausse_du_chiffre_d_affaires.sql.
--
-- CE QUE LA BASE TIENT, ET CE QU'ELLE NE TIENT PAS. Le chiffre d'affaires d'un trimestre se calcule dans l'application, par le
-- moteur de l'estimation (src/lib/estimation.ts, `chiffreDAffairesDeLaPeriode`), et l'alerte se juge à l'écran
-- (src/lib/hausseDuChiffreDAffaires.ts) : la base n'en calcule rien et n'en garde rien. Elle tient deux choses que le cabinet dit :
--   1. `seuils_du_chiffre_d_affaires` : le seuil de hausse d'un dossier, en pour cent entier (de 1 à 1 000), une ligne par
--      dossier (`seuils_du_chiffre_d_affaires_un_par_dossier`, contrainte TOTALE, que l'upsert vise). Nul, ou sans ligne : pas
--      d'alerte. Qui l'a réglé et quand : posés par la base (`garder_seuil_du_chiffre_d_affaires`).
--   2. `hausses_vues_avec_le_client` : la marque « vue avec le client » d'un trimestre CLOS, une ligne par dossier et par
--      trimestre (`hausses_vues_avec_le_client_une_par_trimestre`), son auteur et son instant posés par la base ; elle ne se
--      modifie ni ne se retire, et part avec son dossier (`garder_hausse_vue_avec_le_client`).
--   3. `regler_seuil_du_chiffre_d_affaires(dossier, seuil lu, seuil)` et `marquer_hausse_vue_avec_le_client(dossier, année,
--      trimestre)`, aux droits de l'appelant (la RLS, la double authentification exigée si elle est en base, et les gardes
--      jugent) ; le contrôle d'accès d'abord, avant toute lecture, pour que le refus se dise sous ses mots.
--   4. Si la migration de la double authentification (`deux_facteurs_exiges`) est déjà en base, la restrictive `deux_facteurs`
--      sur les deux tables neuves (sinon, sa boucle la posera) : les deux se collent dans les deux ordres.
--
-- AUCUNE BRANCHE CLIENT. Le cabinet du dossier (`admin_du_dossier` : le chef, un membre assigné, le super-administrateur) lit
-- et écrit ; le client n'en lit rien, quelles que soient ses cases. Ni montant, ni texte libre : un seuil, un trimestre, des
-- comptes et des instants.
--
-- LES GARDES, AUX DROITS DE L'APPELANT (security invoker) : elles ne lisent la base que sous sa RLS, et ne lèvent qu'une règle
-- qui ne dit rien d'une ligne qu'il ne voit pas. Elles n'appellent donc pas la porte `_acces_avant_les_gardes`, dont la règle
-- vise une garde security definer (porteDevantLesGardes.test.ts, l'étape 32 de supabase/essais/accesAvantLesGardes.sql).
--
-- LES REFUS, DANS L'ORDRE (que src/lib/hausseDuChiffreDAffaires.ts redit sous les mêmes mots, `REFUS_DE_LA_BASE`) :
--   - `regler_seuil_du_chiffre_d_affaires` : l'appelant qui n'est pas le cabinet du dossier (42501) ; un seuil hors de 1 à
--     1 000 (22023) ; puis, sous le verrou du dossier, un seuil qui a changé depuis sa lecture (40001) ;
--   - `marquer_hausse_vue_avec_le_client` : l'appelant qui n'est pas le cabinet du dossier (42501) ; un trimestre mal dit
--     (22023), pas encore clos au jour de Paris (22023) ; puis, sous le verrou du dossier, un trimestre déjà marqué (22023) ;
--   - les gardes : un seuil qui passe à un autre dossier (23514) ; une marque qui se réécrit (23514), qui se retire hors de la
--     suppression de son dossier (23514), un trimestre pas encore clos (22023).
--
-- CE QU'ELLE NE CHANGE PAS : aucune fonction d'hier n'est remplacée (`admin_du_dossier` et `is_super_admin` sont appelées,
-- jamais réécrites), ni aucune table. Aucune ligne écrite d'avance. Ni barre oblique inverse, ni retour chariot ; aucune
-- instruction de suppression : elle passe par l'outil. VERSION PROVISOIRE, HORS DE L'EXPORT : le fichier entre dans
-- `supabase/schema/` le jour de son application, sous la version que porte sa ligne d'historique, texte inchangé ;
-- `HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE` (src/lib/hausseDuChiffreDAffaires.ts) se lève alors, et les deux tables entrent au plan
-- de sauvegarde.

-- ══ 0. La garde de tête ══════════
-- Elle refuse une seconde application, et une fonction appelée qui ne serait plus celle que cette migration suppose — à
-- l'empreinte de son corps, les retours chariot d'un collage écartés.
do $garde$
declare
  v_attendue record;
  v_nombre integer;
  v_empreinte text;
begin
  if to_regclass('public.seuils_du_chiffre_d_affaires') is not null or to_regclass('public.hausses_vues_avec_le_client') is not null
     or exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                 and p.proname in ('regler_seuil_du_chiffre_d_affaires', 'marquer_hausse_vue_avec_le_client',
                                   'garder_seuil_du_chiffre_d_affaires', 'garder_hausse_vue_avec_le_client')) then
    raise exception 'La migration hausse_du_chiffre_d_affaires est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  for v_attendue in select * from (values
      ('is_super_admin', 'public.is_super_admin()', 'a9159138778422a43ba8d8c21240c9bb'),
      ('admin_du_dossier', 'public.admin_du_dossier(uuid)', '30e9b7246cb939741fe58f4ffc27adf4')
    ) as t(nom, signature, empreinte) loop
    select count(*) into v_nombre from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_attendue.nom;
    select md5(replace(p.prosrc, chr(13), '')) into v_empreinte from pg_proc p where p.oid = to_regprocedure(v_attendue.signature);
    if v_nombre <> 1 or v_empreinte is distinct from v_attendue.empreinte then
      raise exception 'La fonction % n''est plus celle que cette migration suppose (empreinte attendue %…) : la relire avant d''appliquer cette migration.',
        v_attendue.signature, left(v_attendue.empreinte, 8);
    end if;
  end loop;
  if not exists (select 1 from pg_attribute a where a.attrelid = 'public.dossiers'::regclass and a.attname = 'id' and not a.attisdropped) then
    raise exception 'La table dossiers n''a plus de colonne id : la relire avant d''appliquer cette migration.';
  end if;
end
$garde$;

-- ══ 1. Le seuil du dossier ══════════
-- Une ligne par dossier. Sans clé vers le compte qui l'a réglé : retirer le compte d'un membre parti ne doit pas effacer qui a
-- réglé (le patron de `previsions_publiees.auteur`).
create table public.seuils_du_chiffre_d_affaires (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  seuil_de_hausse integer
    constraint seuils_du_chiffre_d_affaires_bornes check (seuil_de_hausse between 1 and 1000),
  regle_par uuid not null,
  regle_le timestamptz not null default now(),
  constraint seuils_du_chiffre_d_affaires_un_par_dossier unique (dossier_id)
);

comment on table public.seuils_du_chiffre_d_affaires is
  'Le seuil de l''alerte de hausse du chiffre d''affaires d''un dossier (la demande du cabinet du 15/11/2026) : en pour cent entier, de 1 à 1 000 ; nul, ou sans ligne, pas d''alerte. L''alerte se calcule dans l''application ; le client n''y lit rien.';
comment on column public.seuils_du_chiffre_d_affaires.seuil_de_hausse is
  'La hausse, en pour cent entier, à partir de laquelle l''alerte se dit (le trimestre ou le cumul de l''année, contre l''année d''avant). Nul : pas d''alerte.';
comment on column public.seuils_du_chiffre_d_affaires.regle_par is
  'Le compte qui a réglé le seuil (auth.uid(), posé par la garde), sans clé étrangère : il survit au retrait du compte.';

alter table public.seuils_du_chiffre_d_affaires enable row level security;

create policy seuils_du_chiffre_d_affaires_cabinet on public.seuils_du_chiffre_d_affaires
  for all to authenticated
  using (public.admin_du_dossier(dossier_id))
  with check (public.admin_du_dossier(dossier_id));

-- La garde : qui a réglé et quand sont ceux de l'écriture, sauf pour le super-administrateur, qui restaure une ligne telle
-- qu'elle a été écrite ; un seuil ne passe pas à un autre dossier.
create function public.garder_seuil_du_chiffre_d_affaires() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.dossier_id is distinct from old.dossier_id then
    raise exception 'Le seuil d''un dossier ne passe pas à un autre dossier.' using errcode = '23514';
  end if;
  if not public.is_super_admin() then
    new.regle_par := auth.uid();
    new.regle_le := now();
  end if;
  return new;
end
$$;

comment on function public.garder_seuil_du_chiffre_d_affaires() is
  'La garde de seuils_du_chiffre_d_affaires : regle_par et regle_le sont ceux de l''écriture (le super-administrateur, qui restaure, excepté) ; un seuil ne passe pas à un autre dossier (23514).';

create trigger seuils_du_chiffre_d_affaires_garde
  before insert or update on public.seuils_du_chiffre_d_affaires
  for each row execute function public.garder_seuil_du_chiffre_d_affaires();

revoke execute on function public.garder_seuil_du_chiffre_d_affaires() from public, anon, authenticated;

-- Le seuil d'un dossier, contre la valeur LUE qu'il remplace (une ligne absente se lit nulle). Aux droits de l'appelant : la
-- policy juge ; le verrou du dossier sérialise deux réglages, et une valeur changée depuis sa lecture refuse le tout.
create function public.regler_seuil_du_chiffre_d_affaires(p_dossier_id uuid, p_seuil_lu integer, p_seuil integer)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_actuel integer;
begin
  if p_dossier_id is null or not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Le seuil de hausse du chiffre d''affaires ne se règle que par le cabinet du dossier.' using errcode = '42501';
  end if;
  if p_seuil is not null and (p_seuil < 1 or p_seuil > 1000) then
    raise exception 'Le seuil de hausse se règle en pour cent entier, de 1 à 1 000, ou se laisse vide.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('seuils_du_chiffre_d_affaires:' || p_dossier_id::text, 0));
  select s.seuil_de_hausse into v_actuel from public.seuils_du_chiffre_d_affaires s where s.dossier_id = p_dossier_id;
  if v_actuel is distinct from p_seuil_lu then
    raise exception 'Le seuil de hausse a changé depuis sa lecture : relis-le avant de l''enregistrer.' using errcode = '40001';
  end if;
  insert into public.seuils_du_chiffre_d_affaires (dossier_id, seuil_de_hausse, regle_par, regle_le)
    values (p_dossier_id, p_seuil, auth.uid(), now())
    on conflict on constraint seuils_du_chiffre_d_affaires_un_par_dossier do update
      set seuil_de_hausse = excluded.seuil_de_hausse, regle_par = excluded.regle_par, regle_le = excluded.regle_le
    returning seuil_de_hausse into v_actuel;
  return v_actuel;
end
$$;

revoke execute on function public.regler_seuil_du_chiffre_d_affaires(uuid, integer, integer) from public, anon;
grant execute on function public.regler_seuil_du_chiffre_d_affaires(uuid, integer, integer) to authenticated;

comment on function public.regler_seuil_du_chiffre_d_affaires(uuid, integer, integer) is
  'Le seuil de l''alerte de hausse du chiffre d''affaires d''un dossier, contre la valeur lue qu''il remplace ; nul : pas d''alerte. Aux droits de l''appelant, le cabinet du dossier seul.';

-- ══ 2. La marque « vue avec le client » ══════════
create table public.hausses_vues_avec_le_client (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  annee integer not null
    constraint hausses_vues_avec_le_client_annee check (annee between 2000 and 2100),
  trimestre integer not null
    constraint hausses_vues_avec_le_client_trimestre check (trimestre between 1 and 4),
  vue_par uuid not null,
  vue_le timestamptz not null default now(),
  constraint hausses_vues_avec_le_client_une_par_trimestre unique (dossier_id, annee, trimestre)
);

comment on table public.hausses_vues_avec_le_client is
  'La marque « vue avec le client » de l''alerte de hausse du chiffre d''affaires d''un trimestre clos : une ligne par dossier et par trimestre, son auteur et son instant posés par la base ; elle ne se modifie ni ne se retire, et part avec son dossier. Le client n''y lit rien.';
comment on column public.hausses_vues_avec_le_client.vue_par is
  'Le compte qui a marqué (auth.uid(), posé par la garde), sans clé étrangère : il survit au retrait du compte.';

alter table public.hausses_vues_avec_le_client enable row level security;

create policy hausses_vues_avec_le_client_lecture on public.hausses_vues_avec_le_client
  for select to authenticated
  using (public.admin_du_dossier(dossier_id));

create policy hausses_vues_avec_le_client_insertion on public.hausses_vues_avec_le_client
  for insert to authenticated
  with check (public.admin_du_dossier(dossier_id));

-- La garde, avant la RLS, aux droits de l'appelant. Une marque ne se réécrit jamais ; elle ne part qu'avec son dossier (la
-- cascade : le dossier n'est déjà plus là) ; elle ne vise qu'un trimestre clos au jour de Paris ; son auteur et son instant
-- sont ceux de l'écriture, sauf pour le super-administrateur, qui restaure une marque telle qu'elle a été posée.
create function public.garder_hausse_vue_avec_le_client() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Une hausse vue avec le client ne se retire pas : elle part avec son dossier.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Une hausse vue avec le client ne se modifie pas.' using errcode = '23514';
  end if;
  if new.annee between 2000 and 2100 and new.trimestre between 1 and 4
     and (make_date(new.annee, new.trimestre * 3, 1) + interval '1 month')::date > (now() at time zone 'Europe/Paris')::date then
    raise exception 'Un trimestre ne se marque vu avec le client qu''une fois clos.' using errcode = '22023';
  end if;
  if not public.is_super_admin() then
    new.vue_par := auth.uid();
    new.vue_le := now();
  end if;
  return new;
end
$$;

comment on function public.garder_hausse_vue_avec_le_client() is
  'La garde de hausses_vues_avec_le_client : une marque ne se modifie pas (23514), ne part qu''avec son dossier (23514), ne vise qu''un trimestre clos au jour de Paris (22023) ; vue_par et vue_le sont ceux de l''écriture (le super-administrateur, qui restaure, excepté).';

create trigger hausses_vues_avec_le_client_garde
  before insert or update or delete on public.hausses_vues_avec_le_client
  for each row execute function public.garder_hausse_vue_avec_le_client();

revoke execute on function public.garder_hausse_vue_avec_le_client() from public, anon, authenticated;

-- La marque d'un trimestre, par le cabinet du dossier. Aux droits de l'appelant : la policy et la garde jugent ; le verrou du
-- dossier sérialise deux marques du même trimestre, et la seconde se dit sous ses mots.
create function public.marquer_hausse_vue_avec_le_client(p_dossier_id uuid, p_annee integer, p_trimestre integer)
returns timestamptz
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_vue_le timestamptz;
begin
  if p_dossier_id is null or not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Une hausse ne se marque vue avec le client que par le cabinet du dossier.' using errcode = '42501';
  end if;
  if p_annee is null or p_trimestre is null or p_annee not between 2000 and 2100 or p_trimestre not between 1 and 4 then
    raise exception 'Le trimestre se dit par son année et son rang, de 1 à 4.' using errcode = '22023';
  end if;
  if (make_date(p_annee, p_trimestre * 3, 1) + interval '1 month')::date > (now() at time zone 'Europe/Paris')::date then
    raise exception 'Un trimestre ne se marque vu avec le client qu''une fois clos.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('hausses_vues_avec_le_client:' || p_dossier_id::text, 0));
  if exists (select 1 from public.hausses_vues_avec_le_client v
              where v.dossier_id = p_dossier_id and v.annee = p_annee and v.trimestre = p_trimestre) then
    raise exception 'Ce trimestre est déjà marqué vu avec le client.' using errcode = '22023';
  end if;
  insert into public.hausses_vues_avec_le_client (dossier_id, annee, trimestre, vue_par, vue_le)
    values (p_dossier_id, p_annee, p_trimestre, auth.uid(), now())
    returning vue_le into v_vue_le;
  return v_vue_le;
end
$$;

revoke execute on function public.marquer_hausse_vue_avec_le_client(uuid, integer, integer) from public, anon;
grant execute on function public.marquer_hausse_vue_avec_le_client(uuid, integer, integer) to authenticated;

comment on function public.marquer_hausse_vue_avec_le_client(uuid, integer, integer) is
  'La marque « vue avec le client » de l''alerte de hausse du chiffre d''affaires d''un trimestre clos ; une fois par trimestre. Aux droits de l''appelant, le cabinet du dossier seul.';

-- ══ 3. La double authentification ══════════
do $deux_facteurs$
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    execute 'create policy deux_facteurs on public.seuils_du_chiffre_d_affaires as restrictive for all to authenticated '
      || 'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))';
    execute 'create policy deux_facteurs on public.hausses_vues_avec_le_client as restrictive for all to authenticated '
      || 'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))';
  end if;
end
$deux_facteurs$;
