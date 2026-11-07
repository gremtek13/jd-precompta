-- LA DOUBLE AUTHENTIFICATION EXIGÉE EN BASE (espace client, partie C, étape C7, second temps ; ligne 51.5). PRÉPARÉE,
-- PAS APPLIQUÉE. SEC-Q1 à Q4 tranchées le 07/11/2026 comme recommandé : le cabinet et le super-administrateur, après le
-- MVP (Q1) ; les accès « Banque », « Achats », « Documents », et « Ventes » (Q2) ; compte par compte, une fois le compte
-- inscrit (Q3) ; le chef pour les siens, le super-administrateur pour les chefs (Q4). Elle s'applique après le MVP, en
-- dernier, sur la réponse à SEC2-Q1 (SEC2-Q2 et Q3 attendues, page « Arbitrages du cabinet »). Le récit : HISTORIQUE.md,
-- « 07/11/2026 — LA DOUBLE AUTHENTIFICATION, SECOND TEMPS : EXIGÉE EN BASE (PRÉPARÉE, PAS APPLIQUÉE) » ; l'essai :
-- supabase/essais/deuxFacteurs.sql (réplique seulement) et le bloc DF de supabase/essais/rls.sql ; le module :
-- src/lib/deuxFacteursExiges.ts ; le drapeau : `DEUX_FACTEURS_EXIGES_EXPORTE` (src/lib/deuxFacteursExiges.ts) et, dans
-- chaque Edge Function qui agit pour un compte, `DEUX_FACTEURS_EXIGES_EN_BASE` (bloc « DEUX FACTEURS »).
--
-- SOURCES. Supabase, « Multi-Factor Authentication », section « Enforce rules for MFA logins » : une policy RESTRICTIVE
-- `to authenticated` sur `(select auth.jwt()->>'aal') = 'aal2'` « restrict[s] all commands on the table regardless of
-- other policies » ; « Row Level Security », section « MFA ». Supabase, « Securing your API » : « For functions, RLS does
-- not apply », et la fonction de pré-requête de PostgREST (`alter role authenticator set pgrst.db_pre_request`, `raise
-- sqlstate 'PGRST'` avec `detail = {"status": 403}`), qui ne vaut que pour l'API de données (ni Storage ni Realtime) ;
-- `supautils.privileged_role_allowed_configs` de la production porte `pgrst.*` (relevé du 07/11/2026). PostgreSQL 17,
-- « Row Security Policies » : une table sans aucune policy PERMISSIVE n'ouvre rien, quelles que soient les restrictives.
--
-- CE QU'ELLE FAIT, EN TROIS COUCHES (relevé de la production du 07/11/2026 : PostgreSQL 17.6, 85 tables en public, aucune
-- vue, aucune policy restrictive, 80 fonctions `security definer` exécutables par authenticated, `postgres` BYPASSRLS) :
--   1. L'EXIGENCE, compte par compte (SEC-Q3) : `exigences_deux_facteurs` (qui l'a posée, quand ; qui l'a levée, quand —
--      l'histoire reste en place, une exigence posée de nouveau est une ligne neuve) et `retraits_deux_facteurs` (la trace
--      d'un second facteur retiré : combien de facteurs, combien de sessions fermées, par qui, quand). Aucune policy :
--      rien ne s'y lit ni ne s'y écrit qu'au travers des fonctions ci-dessous (l'avis `rls_enabled_no_policy`, voulu).
--   2. LA TABLE : une policy RESTRICTIVE `deux_facteurs`, `for all to authenticated`, sur CHAQUE table de public présente à
--      l'application (la boucle part de pg_class : B1, e7a et toute migration appliquée avant elle y entrent d'eux-mêmes)
--      et sur `storage.objects`, qui ne laisse passer qu'un appelant que `deux_facteurs_satisfaits()` dit en règle : pas
--      exigé ou porteur d'un jeton `aal2` et, dans les deux cas, un jeton émis APRÈS le dernier retrait du second facteur
--      du compte (l'appareil perdu, exigé ou non, ne garde rien jusqu'à l'expiration de son jeton). Elle couvre l'API de
--      données, Storage et Realtime. Une table créée APRÈS doit porter la sienne : le bloc DF de rls.sql la met en faute.
--   3. LA FONCTION : une policy ne voit pas une fonction `security definer` — elle lit en propriétaire, qui contourne la RLS
--      (`postgres` est BYPASSRLS : forcer la RLS ne l'arrêterait pas). La pré-requête de PostgREST,
--      `deux_facteurs_avant_requete()`, refuse en 403 toute requête de l'API de données que `deux_facteurs_satisfaits()`
--      ne dit pas en règle — table, vue ou fonction —, sauf les deux lectures de la porte (`deux_facteurs_satisfaits` et
--      `ma_double_authentification`). Les prédicats d'accès (`admin_du_dossier`, `client_du_dossier`…) ne sont PAS récrits :
--      B1 et C4a les redéfinissent, et une récriture ici les écraserait ; la pré-requête les couvre sans les toucher.
--   Les Edge Functions qui lisent avec la clé secrète (BYPASSRLS, sans pré-requête qui les arrête : leur jeton de service
--   n'a pas de compte) refusent elles-mêmes un jeton `aal1` d'un compte exigé (bloc « DEUX FACTEURS » de chaque fonction).
--
-- LES FONCTIONS DU CABINET (SEC-Q4) : `exiger_deux_facteurs` (sur un compte qui a un facteur VÉRIFIÉ), `lever_deux_facteurs`,
-- `retirer_second_facteur` (l'appareil perdu : tous les facteurs du compte, et ses sessions, que GoTrue ne renouvelle plus —
-- un téléphone perdu avec une session ouverte ne réinscrit pas un facteur à lui —, la trace gardée — sa date refuse aussitôt
-- tout jeton émis avant elle, `aal2` compris ; l'exigence RESTE, et le compte est mené à une nouvelle inscription avant
-- tout écran, SEC-Q3). L'autorité : le super-administrateur sur tout
-- compte ; le chef d'un cabinet sur les membres de son cabinet et les clients de ses dossiers, jamais sur un chef ni sur un
-- super-administrateur. Lever ou retirer (ce qui affaiblit) demande l'autorité sur le compte ENTIER : un compte rattaché
-- aussi à un autre cabinet ne s'affaiblit que par le super-administrateur (SEC2-Q1). L'e-mail qui prévient le compte n'est
-- pas ici (SEC2-Q3). `deux_facteurs_des_comptes` dit au cabinet, compte par compte, s'il a un facteur vérifié (jamais son
-- nom, son type ni sa clé), depuis quand l'exigence court, le dernier retrait, et les gestes que l'appelant y a.
--
-- CE QU'ELLE NE CHANGE PAS : aucune policy existante, aucun prédicat, aucune donnée ; rien n'est exigé de personne tant que
-- le cabinet ne pose pas l'exigence ni ne retire un facteur : `deux_facteurs_satisfaits()` est vrai pour tout compte sans
-- exigence ni retrait, et la pré-requête ne fait rien. Le texte contient des suppressions (le corps de
-- `retirer_second_facteur`) : `apply_migration` attendra une confirmation ; elle se colle alors dans l'éditeur SQL, dans
-- une transaction, avec sa ligne d'historique.
-- ORDRE : après les migrations de supabase/preparees/ (sauf `droits_hors_rls`, indépendante), B1 (les trois cases) et
-- e7a (la facture internationale). Retour : supabase/preparees/retour/20261107160100_retour_deux_facteurs_exiges.sql
-- (destructif : il efface les exigences et la trace — l'accord du cabinet).

do $garde$
declare
  fautes text;
begin
  -- Déjà appliquée ?
  if to_regclass('public.exigences_deux_facteurs') is not null
     or to_regprocedure('public.deux_facteurs_satisfaits()') is not null
     or exists (select 1 from pg_policy where polname = 'deux_facteurs') then
    raise exception 'La migration deux_facteurs_exiges est déjà en base (sa table, sa fonction ou une policy deux_facteurs).';
  end if;
  -- Ce que la migration suppose : les tables et les prédicats qu'elle lit, auth.mfa_factors et auth.sessions que le rôle
  -- courant lit et supprime (le relevé du 07/11/2026 : postgres SELECT et DELETE sur les deux), storage.objects en RLS,
  -- le rôle de PostgREST.
  if to_regclass('public.cabinet_admins') is null or to_regclass('public.memberships') is null
     or to_regclass('public.dossiers') is null or to_regclass('public.super_admins') is null
     or to_regprocedure('public.is_super_admin()') is null or to_regprocedure('public.est_chef_du_cabinet(uuid)') is null
     or to_regprocedure('public.admin_du_dossier(uuid)') is null
     or to_regclass('auth.users') is null or to_regclass('auth.mfa_factors') is null or to_regclass('auth.sessions') is null
     or to_regclass('storage.objects') is null or to_regrole('authenticator') is null then
    raise exception 'Une table, une fonction ou un rôle que la migration suppose manque (cabinet_admins, memberships, dossiers, super_admins, is_super_admin, est_chef_du_cabinet, admin_du_dossier, auth.users, auth.mfa_factors, auth.sessions, storage.objects, authenticator) : relire la base.';
  end if;
  if not (has_table_privilege(current_user, 'auth.mfa_factors', 'SELECT') and has_table_privilege(current_user, 'auth.mfa_factors', 'DELETE')
          and has_table_privilege(current_user, 'auth.sessions', 'SELECT') and has_table_privilege(current_user, 'auth.sessions', 'DELETE')) then
    raise exception 'Le rôle qui applique ne lit ou ne supprime pas auth.mfa_factors et auth.sessions : retirer_second_facteur ne pourrait rien.';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass) then
    raise exception 'storage.objects n''a pas la RLS : une policy restrictive n''y garderait rien.';
  end if;
  -- Ni une vue ni une table étrangère en public : une policy ne les garde pas (le relevé : aucune).
  select string_agg(c.relname, ', ' order by c.relname collate "C") into fautes
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm', 'f');
  if fautes is not null then
    raise exception 'Public porte une vue ou une table étrangère, qu''une policy ne garde pas : %.', fautes;
  end if;
  -- Chaque table présente : la RLS activée, et possédée par le rôle qui applique (une policy ne se crée qu'en propriétaire).
  select string_agg(c.relname, ', ' order by c.relname collate "C") into fautes
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
     and (not c.relrowsecurity or c.relowner <> to_regrole(current_user));
  if fautes is not null then
    raise exception 'Des tables de public sans RLS, ou d''un autre propriétaire que le rôle qui applique : %.', fautes;
  end if;
  -- Aucune policy restrictive aujourd'hui (le relevé : 0) : la migration ne sait pas en composer d'autres.
  select string_agg(p.polrelid::regclass::text || '.' || p.polname, ', ') into fautes
    from pg_policy p join pg_class c on c.oid = p.polrelid
   where not p.polpermissive and (c.relnamespace = 'public'::regnamespace or p.polrelid = 'storage.objects'::regclass);
  if fautes is not null then
    raise exception 'Une policy restrictive existe déjà (%) : la relire avant d''appliquer celle-ci.', fautes;
  end if;
  -- Aucune pré-requête de PostgREST posée : la migration n'en remplace pas une autre.
  if exists (select 1 from pg_db_role_setting s cross join lateral unnest(s.setconfig) as v(reglage)
              where s.setrole = to_regrole('authenticator') and v.reglage like 'pgrst.db_pre_request=%') then
    raise exception 'Une pré-requête de PostgREST est déjà posée sur authenticator : la relire avant d''appliquer celle-ci.';
  end if;
end
$garde$;

-- ── 1. L'EXIGENCE ET LA TRACE ───────────────────────────────────────────────────────────────────────────────────────

create table public.exigences_deux_facteurs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  posee_par uuid not null,
  posee_le timestamptz not null default now(),
  levee_par uuid,
  levee_le timestamptz,
  constraint exigences_deux_facteurs_levee check ((levee_par is null) = (levee_le is null)),
  constraint exigences_deux_facteurs_ordre check (levee_le is null or levee_le >= posee_le)
);
-- Une seule exigence EN COURS par compte (les fonctions écrivent sous un verrou ; aucun upsert ne la vise).
create unique index exigences_deux_facteurs_une_en_cours on public.exigences_deux_facteurs (user_id) where levee_le is null;
alter table public.exigences_deux_facteurs enable row level security;
comment on table public.exigences_deux_facteurs is
  'La double authentification exigée d''un compte (C7, second temps, SEC-Q3) : posée par le cabinet sur un compte qui a un facteur vérifié, levée en place (levee_par, levee_le) ; une exigence posée de nouveau est une ligne neuve. Aucune policy : écrite par exiger_deux_facteurs et lever_deux_facteurs seules, lue par deux_facteurs_satisfaits, ma_double_authentification et deux_facteurs_des_comptes.';

create table public.retraits_deux_facteurs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  facteurs integer not null check (facteurs >= 1),
  sessions integer not null check (sessions >= 0),
  retire_par uuid not null,
  retire_le timestamptz not null default now()
);
create index retraits_deux_facteurs_du_compte on public.retraits_deux_facteurs (user_id, retire_le desc);
alter table public.retraits_deux_facteurs enable row level security;
comment on table public.retraits_deux_facteurs is
  'La trace d''un second facteur retiré par le cabinet (appareil perdu, SEC-Q4) : combien de facteurs, combien de sessions fermées, par qui, quand. Aucune policy : écrite par retirer_second_facteur seule.';

-- ── 2. CE QUE DIT LA BASE DE L'APPELANT ─────────────────────────────────────────────────────────────────────────────

-- L'exigence : pas exigé, ou un jeton aal2. ET, exigé ou non, aucun retrait du second facteur du compte à la date du jeton
-- ou après : `retirer_second_facteur` ferme les sessions, que GoTrue ne renouvelle plus, mais un jeton déjà émis vivait
-- jusqu'à son expiration (l'appareil perdu gardait l'accès). La date du jeton est son `iat`, en secondes entières : un
-- jeton de la seconde du retrait est refusé, et, pour un compte qui a un retrait, un jeton sans `iat` numérique aussi (le
-- côté fermé : GoTrue en pose toujours un) ; le CASE ne convertit qu'un nombre, et ne lève donc jamais. L'index
-- `retraits_deux_facteurs_du_compte` sert la recherche.
create function public.deux_facteurs_satisfaits()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
          or not exists (select 1
                           from public.exigences_deux_facteurs e
                          where e.user_id = auth.uid()
                            and e.levee_le is null))
     and not exists (select 1
                       from public.retraits_deux_facteurs r
                      where r.user_id = auth.uid()
                        and r.retire_le >= case when jsonb_typeof(auth.jwt() -> 'iat') = 'number'
                                                then to_timestamp((auth.jwt() ->> 'iat')::double precision)
                                                else '-infinity'::timestamptz end)
$$;
comment on function public.deux_facteurs_satisfaits() is
  'Vrai si l''appelant satisfait l''exigence du second facteur : il n''est pas exigé (sans compte : l''anonyme, le rôle du service, une migration), ou son jeton porte aal2 ; et, exigé ou non, son jeton (iat) est postérieur au dernier retrait de son second facteur (retraits_deux_facteurs). La lisent les policies restrictives deux_facteurs, la pré-requête de PostgREST, ma_double_authentification et le bloc DEUX FACTEURS des Edge Functions.';

create function public.ma_double_authentification()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'exigee', exists (select 1 from public.exigences_deux_facteurs e where e.user_id = auth.uid() and e.levee_le is null),
    'satisfaite', public.deux_facteurs_satisfaits(),
    'espace', case
                when auth.uid() is null then null
                when exists (select 1 from public.super_admins s where s.user_id = auth.uid())
                  or exists (select 1 from public.cabinet_admins c where c.user_id = auth.uid()) then 'cabinet'
                when exists (select 1 from public.memberships m where m.user_id = auth.uid()) then 'client'
              end)
$$;
comment on function public.ma_double_authentification() is
  'Ce que la porte de l''application lit d''un compte, à aal1 comme à aal2 (la pré-requête la laisse passer) : l''exigence, si elle est satisfaite, et l''espace (pour vouvoyer le cabinet et tutoyer le client avant que les rôles se lisent). Rien d''un autre compte.';

-- L'autorité de l'appelant sur un compte (SEC-Q4). Entière : sur le compte tout entier, c'est-à-dire tous ses rattachements
-- dans le cabinet de l'appelant (ce qu'affaiblir demande). N'est exécutée par aucun rôle de l'API.
create function public.deux_facteurs_autorite(p_compte uuid, p_entiere boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and p_compte is not null and (
    public.is_super_admin()
    or (
      not exists (select 1 from public.super_admins s where s.user_id = p_compte)
      and not exists (select 1 from public.cabinet_admins c where c.user_id = p_compte and c.role = 'comptable_en_chef')
      and exists (
        select 1
          from public.cabinet_admins moi
         where moi.user_id = auth.uid()
           and moi.role = 'comptable_en_chef'
           and (exists (select 1 from public.cabinet_admins c where c.user_id = p_compte and c.cabinet_id = moi.cabinet_id)
                or exists (select 1 from public.memberships m join public.dossiers d on d.id = m.dossier_id
                            where m.user_id = p_compte and d.cabinet_id = moi.cabinet_id))
           and (not p_entiere or (
                not exists (select 1 from public.cabinet_admins c where c.user_id = p_compte and c.cabinet_id <> moi.cabinet_id)
                and not exists (select 1 from public.memberships m join public.dossiers d on d.id = m.dossier_id
                                 where m.user_id = p_compte and d.cabinet_id is distinct from moi.cabinet_id))))))
$$;

-- ── 3. LES FONCTIONS DU CABINET ─────────────────────────────────────────────────────────────────────────────────────

create function public.deux_facteurs_des_comptes(p_cabinet_id uuid, p_dossier_id uuid)
returns table (
  user_id uuid, email text, genre text, a_un_facteur boolean, exigee_depuis timestamptz, dernier_retrait timestamptz,
  peut_exiger boolean, peut_lever boolean, peut_retirer boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  -- L'accès AVANT toute lecture : l'équipe d'un cabinet à son chef, les accès d'un dossier à qui administre le dossier.
  if auth.uid() is null or (p_cabinet_id is null) = (p_dossier_id is null)
     or (p_cabinet_id is not null and not public.est_chef_du_cabinet(p_cabinet_id))
     or (p_dossier_id is not null and not public.admin_du_dossier(p_dossier_id)) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
    with comptes as (
      select c.user_id as compte, c.email as adresse,
             case when c.role = 'comptable_en_chef' then 'chef' else 'membre' end as nature
        from public.cabinet_admins c
       where p_cabinet_id is not null and c.cabinet_id = p_cabinet_id
      union all
      select m.user_id, m.email, 'client'
        from public.memberships m
       where p_dossier_id is not null and m.dossier_id = p_dossier_id
    )
    select k.compte, k.adresse, k.nature,
           exists (select 1 from auth.mfa_factors f where f.user_id = k.compte and f.status = 'verified'),
           (select e.posee_le from public.exigences_deux_facteurs e where e.user_id = k.compte and e.levee_le is null),
           (select max(r.retire_le) from public.retraits_deux_facteurs r where r.user_id = k.compte),
           public.deux_facteurs_autorite(k.compte, false),
           public.deux_facteurs_autorite(k.compte, true),
           public.deux_facteurs_autorite(k.compte, true) and k.compte <> auth.uid()
      from comptes k
     order by k.adresse collate "C", k.compte;
end;
$$;
comment on function public.deux_facteurs_des_comptes(uuid, uuid) is
  'Les comptes de l''équipe d''un cabinet (p_cabinet_id, son chef seul) ou les accès d''un dossier (p_dossier_id, qui administre le dossier) : un facteur vérifié ou non (jamais son nom, son type ni sa clé), l''exigence en cours, le dernier retrait, et les gestes que l''appelant y a (C7, second temps).';

create function public.exiger_deux_facteurs(p_compte uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.deux_facteurs_autorite(p_compte, false) then
    raise exception 'Accès refusé : la double authentification d''un compte s''exige par le chef de son cabinet, celle d''un chef par le super-administrateur.'
      using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('deux_facteurs:' || p_compte::text, 0));
  if exists (select 1 from public.exigences_deux_facteurs e where e.user_id = p_compte and e.levee_le is null) then
    raise exception 'La double authentification est déjà exigée pour ce compte.';
  end if;
  if not exists (select 1 from auth.mfa_factors f where f.user_id = p_compte and f.status = 'verified') then
    raise exception 'Ce compte n''a aucun second facteur vérifié : il en inscrit d''abord un, depuis « Sécurité du compte ».';
  end if;
  insert into public.exigences_deux_facteurs (user_id, posee_par) values (p_compte, auth.uid());
end;
$$;

create function public.lever_deux_facteurs(p_compte uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.deux_facteurs_autorite(p_compte, true) then
    raise exception 'Accès refusé : l''exigence d''un compte se lève par le chef de son cabinet (le super-administrateur pour un chef, ou pour un compte rattaché à un autre cabinet).'
      using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('deux_facteurs:' || p_compte::text, 0));
  update public.exigences_deux_facteurs e
     set levee_par = auth.uid(), levee_le = now()
   where e.user_id = p_compte and e.levee_le is null;
  if not found then
    raise exception 'La double authentification n''est pas exigée pour ce compte.';
  end if;
end;
$$;

create function public.retirer_second_facteur(p_compte uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_facteurs integer;
  n_sessions integer;
begin
  if not public.deux_facteurs_autorite(p_compte, true) then
    raise exception 'Accès refusé : le second facteur d''un compte se retire par le chef de son cabinet (le super-administrateur pour un chef, ou pour un compte rattaché à un autre cabinet).'
      using errcode = '42501';
  end if;
  if p_compte = auth.uid() then
    raise exception 'Votre propre appareil se retire depuis « Sécurité du compte ».';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('deux_facteurs:' || p_compte::text, 0));
  with retires as (delete from auth.mfa_factors f where f.user_id = p_compte returning 1)
  select count(*) into n_facteurs from retires;
  if n_facteurs = 0 then
    raise exception 'Ce compte n''a aucun second facteur à retirer.';
  end if;
  -- Ses sessions avec : un appareil perdu qui garde une session ouverte ne la renouvelle plus (les jetons de
  -- renouvellement partent en cascade), et ne réinscrit donc pas un facteur à lui.
  with fermees as (delete from auth.sessions s where s.user_id = p_compte returning 1)
  select count(*) into n_sessions from fermees;
  insert into public.retraits_deux_facteurs (user_id, facteurs, sessions, retire_par)
  values (p_compte, n_facteurs, n_sessions, auth.uid());
  return jsonb_build_object('facteurs', n_facteurs, 'sessions', n_sessions);
end;
$$;
comment on function public.retirer_second_facteur(uuid) is
  'L''appareil perdu (SEC-Q4) : retire tous les facteurs du compte et ferme ses sessions, la trace gardée dans retraits_deux_facteurs. L''exigence reste : le compte inscrit un nouvel appareil avant tout écran (SEC-Q3).';

-- ── 4. LA PRÉ-REQUÊTE DE POSTGREST ──────────────────────────────────────────────────────────────────────────────────

create function public.deux_facteurs_avant_requete()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.deux_facteurs_satisfaits() then
    return;
  end if;
  -- La porte de l'application lit ces deux-là avant le code (request.path : « /rpc/nom », avec ou sans la barre).
  if ltrim(coalesce(current_setting('request.path', true), ''), '/')
       in ('rpc/deux_facteurs_satisfaits', 'rpc/ma_double_authentification') then
    return;
  end if;
  raise sqlstate 'PGRST' using
    message = json_build_object(
      'code', 'DF403',
      'message', 'Cette session ne satisfait pas la double authentification de ce compte : le code de l''application d''authentification se donne, ou la session se rouvre si le second facteur a été retiré, avant tout accès.',
      'details', null, 'hint', null)::text,
    detail = json_build_object('status', 403)::text;
end;
$$;
comment on function public.deux_facteurs_avant_requete() is
  'La pré-requête de PostgREST (pgrst.db_pre_request) : refuse en 403 toute requête de l''API de données que deux_facteurs_satisfaits ne dit pas en règle (un compte exigé sans jeton aal2, un jeton émis avant le retrait du second facteur), fonctions security definer comprises, que la RLS ne voit pas. Ne vaut ni pour Storage ni pour Realtime (les policies restrictives les gardent).';

-- Les droits d'exécution, nommés un par un (le défaut de public les donne à anon, authenticated et service_role).
revoke all on function public.deux_facteurs_satisfaits() from public, anon;
grant execute on function public.deux_facteurs_satisfaits() to authenticated, service_role;
revoke all on function public.ma_double_authentification() from public, anon, service_role;
grant execute on function public.ma_double_authentification() to authenticated;
revoke all on function public.deux_facteurs_autorite(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.deux_facteurs_des_comptes(uuid, uuid) from public, anon, service_role;
grant execute on function public.deux_facteurs_des_comptes(uuid, uuid) to authenticated;
revoke all on function public.exiger_deux_facteurs(uuid) from public, anon, service_role;
grant execute on function public.exiger_deux_facteurs(uuid) to authenticated;
revoke all on function public.lever_deux_facteurs(uuid) from public, anon, service_role;
grant execute on function public.lever_deux_facteurs(uuid) to authenticated;
revoke all on function public.retirer_second_facteur(uuid) from public, anon, service_role;
grant execute on function public.retirer_second_facteur(uuid) to authenticated;
-- La pré-requête tourne pour CHAQUE requête, sous le rôle de la requête : les trois rôles de l'API l'exécutent.
revoke all on function public.deux_facteurs_avant_requete() from public;
grant execute on function public.deux_facteurs_avant_requete() to anon, authenticated, service_role;

-- ── 5. LES POLICIES RESTRICTIVES ────────────────────────────────────────────────────────────────────────────────────

do $policies$
declare
  t regclass;
begin
  for t in select c.oid::regclass
             from pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
            order by c.relname collate "C" loop
    execute format(
      'create policy deux_facteurs on %s as restrictive for all to authenticated '
      || 'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))', t);
  end loop;
end
$policies$;

create policy deux_facteurs on storage.objects as restrictive for all to authenticated
  using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()));

-- ── 6. LA PRÉ-REQUÊTE POSÉE ─────────────────────────────────────────────────────────────────────────────────────────

alter role authenticator set pgrst.db_pre_request = 'public.deux_facteurs_avant_requete';
notify pgrst, 'reload config';

-- ── GARDE DE FIN ────────────────────────────────────────────────────────────────────────────────────────────────────

do $fin$
declare
  fautes text;
  v_chemin constant text := current_setting('search_path');
  v_expression constant text := '( SELECT public.deux_facteurs_satisfaits() AS deux_facteurs_satisfaits)';
begin
  -- Chaque table de public, et storage.objects : une policy deux_facteurs restrictive, de toutes les commandes, à
  -- authenticated seul, dont l'expression et la vérification sont EXACTEMENT `(select public.deux_facteurs_satisfaits())`
  -- et en dépendent (pg_depend). Le texte se rend sous un chemin vide, qui nomme le schéma de chaque fonction : un ajout
  -- (`or true`) ou une homonyme d'un autre schéma ne passent pas. Le chemin d'avant revient à la fin du bloc.
  perform set_config('search_path', '', true);
  select string_agg(r.oid::regclass::text, ', ' order by r.oid::regclass::text collate "C") into fautes
    from pg_class r
   where ((r.relnamespace = 'public'::regnamespace and r.relkind in ('r', 'p')) or r.oid = 'storage.objects'::regclass)
     and not exists (
           select 1 from pg_policy p
            where p.polrelid = r.oid and p.polname = 'deux_facteurs' and not p.polpermissive and p.polcmd = '*'
              and p.polroles = array[to_regrole('authenticated')]::oid[]
              and p.polqual is not null and p.polwithcheck is not null
              and pg_get_expr(p.polqual, p.polrelid) = v_expression
              and pg_get_expr(p.polwithcheck, p.polrelid) = v_expression
              and exists (select 1 from pg_depend d
                           where d.classid = 'pg_policy'::regclass and d.objid = p.oid
                             and d.refclassid = 'pg_proc'::regclass
                             and d.refobjid = 'public.deux_facteurs_satisfaits()'::regprocedure));
  if fautes is not null then
    raise exception 'Garde de fin : sans sa policy restrictive deux_facteurs : %.', fautes;
  end if;
  if not exists (select 1 from pg_db_role_setting s cross join lateral unnest(s.setconfig) as v(reglage)
                  where s.setrole = to_regrole('authenticator') and s.setdatabase = 0
                    and v.reglage = 'pgrst.db_pre_request=public.deux_facteurs_avant_requete') then
    raise exception 'Garde de fin : la pré-requête de PostgREST n''est pas posée.';
  end if;
  if has_function_privilege('anon', 'public.deux_facteurs_satisfaits()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.deux_facteurs_autorite(uuid, boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.exiger_deux_facteurs(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.lever_deux_facteurs(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.retirer_second_facteur(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.deux_facteurs_des_comptes(uuid, uuid)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.deux_facteurs_avant_requete()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.deux_facteurs_avant_requete()', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.deux_facteurs_avant_requete()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.deux_facteurs_satisfaits()', 'EXECUTE') then
    raise exception 'Garde de fin : les droits d''exécution ne sont pas ceux que la migration pose.';
  end if;
  perform set_config('search_path', v_chemin, true);
end
$fin$;
