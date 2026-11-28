-- LE JOURNAL DE CONSOMMATION DE L'ASSISTANT, QUE LA FONCTION `agent-comptable` ÉCRIT SEULE (ASSIST-Q1 (A), tranchée par le
-- cabinet le 27/11/2026) — PRÉPARÉE le 27/11/2026, PAS APPLIQUÉE. Le constat : HISTORIQUE.md, « 27/11/2026 — RELECTURE ADVERSE
-- DE SÉCURITÉ DES EDGE FUNCTIONS » (le défaut connu `plafondTenuParLeNavigateur`) ; le récit : « 27/11/2026 — ASSIST-Q1 : LE
-- JOURNAL DE CONSOMMATION DE L'ASSISTANT (PRÉPARÉE, PAS APPLIQUÉE) ». Son retour :
-- supabase/preparees/retour/20261127232100_retour_consommations_de_l_assistant.sql. Ses essais :
-- supabase/essais/consommationsDeLAssistant.sql (joué en production), consommationsDeLAssistantSuppression.sql (sur une
-- réplique), le bloc CO de supabase/essais/rls.sql. Le module qui la redit : src/lib/consommationDeLAssistant.ts
-- (`CONSOMMATION_TENUE_PAR_LA_FONCTION`, baissé), confronté à ce texte par src/lib/consommationDeLAssistant.test.ts ; la
-- constante jumelle de `agent-comptable`, baissée elle aussi.
--
-- LE CONSTAT. Le plafond mensuel de l'assistant se comptait sur les lignes `agent_conversations` que le NAVIGATEUR écrit après
-- la réponse, avec les tokens qu'elle lui rend : tout le cabinet du dossier les écrit, les réécrit et les retire (la policy
-- `agent_conversations_all`, « Supprimer la conversation ») ; un appel direct de la fonction, ou une réponse en erreur après le
-- modèle, n'en écrit aucune ; rien n'y interdit un nombre négatif. Le seul mécanisme qui borne une dépense reposait sur ce que
-- l'appelant voulait bien déclarer.
--
-- CE QU'ELLE POSE.
--   1. `consommations_de_l_assistant` : une ligne par appel au modèle — le cabinet (la ligne part avec lui), le dossier (mis à
--      nul quand il est retiré : la consommation reste celle du cabinet, son mois ne se vide pas), le compte de la session qui
--      a posé la question (sans clé étrangère : retirer un compte n'efface pas ce qu'il a consommé), l'instant, les tokens
--      d'entrée et de sortie que le modèle a rendus, entiers, bornés (de 0 à dix millions et de 0 à un million : dix et cent
--      fois ce qu'un appel peut rendre, la fenêtre du modèle et le `max_tokens` de la fonction ; une valeur absurde se
--      refuse, la somme reste bornée). Aucun texte : ni la question, ni la réponse, ni un outil.
--   2. Sous RLS, SANS policy permissive : aucun rôle de l'API ne la lit ni ne l'écrit, et leurs droits sur elle sont retirés
--      (`revoke all`), au-delà de la RLS — une policy posée par erreur demain n'ouvrirait encore rien. La fonction l'écrit et
--      la lit sous la clé secrète (le rôle du service, hors de la RLS). Un `rls_enabled_no_policy` voulu.
--   3. `garder_consommations_de_l_assistant`, aux droits de l'appelant, avant l'insertion, la mise à jour et la sortie d'une
--      ligne : l'instant posé par la base (`now()`, jamais par l'auteur) ; le dossier d'une ligne, quand elle en nomme un, de son
--      cabinet (23514) ; aucune réécriture (42501), hors de la mise à nul du dossier que sa clé étrangère fait quand le dossier
--      est retiré, le reste inchangé ; aucune sortie (42501), hors de la cascade de son cabinet retiré. Un journal qui borne une
--      dépense ne se corrige pas : il s'ajoute. Rien ne se juge ici qu'un rôle de l'API atteigne — il n'a aucun droit sur la
--      table — : ni porte `_acces_avant_les_gardes`, ni droits du propriétaire.
--   4. `consommation_de_l_assistant(p_depuis)`, aux droits du propriétaire, au SUPER-ADMINISTRATEUR SEUL, vérifié avant toute
--      lecture (42501) : par cabinet, les tokens depuis toujours et depuis `p_depuis` (le premier instant du mois que l'écran
--      des comptes compare au plafond, celui que la fonction compte). Aucune ligne, aucun compte, aucun dossier : des sommes.
--   5. La restrictive `deux_facteurs` de la double authentification, si sa migration est déjà en base (sinon, sa boucle la
--      posera) : les deux se collent dans les deux ordres.
--
-- CE QUI A ÉTÉ CHOISI, ET POURQUOI :
--   - une table du CABINET, hors de la sauvegarde d'un dossier (`acces: 'cabinet'`, src/lib/sauvegarde.ts) : la consommation
--     est celle du cabinet qui a payé l'appel ; restaurer un dossier ne rend à aucun cabinet une consommation passée, et la
--     sauvegarde d'un dossier ne porte pas qui a interrogé l'assistant. La sauvegarde quotidienne de la base la couvre ; une
--     reprise depuis l'export la rend vide, et le mois en cours ne compte alors que ce qui suit (PLAN_DE_REPRISE.md) ;
--   - une ligne par appel, écrite par la fonction après chaque réponse du modèle, quelle que soit l'issue de la question (la
--     réponse rendue, refusée, coupée, huit tours épuisés) : un appel déjà rendu se compte même si la fonction s'arrête
--     ensuite. Écartées : une ligne par question, à la fin (un mur de 150 s ou une erreur en route la perdrait) ; une
--     réservation AVANT l'appel, corrigée après (une ligne réécrite, une borne de l'entrée à deviner sur la taille de la
--     demande ; ASSIST1-Q1 la reprend pour l'appel interrompu) ;
--   - aucune reprise de l'historique d'`agent_conversations` : ses colonnes de tokens restent, pour l'historique d'avant, mais
--     elles sont l'écriture du navigateur, que ce journal remplace ; il part vide, et le mois de sa mise en service ne compte
--     que ce qui suit ;
--   - la lecture du super-administrateur seul : aucun écran du cabinet ne montre la consommation (l'alerte vient de la réponse
--     de la fonction).
--
-- CE QU'ELLE NE CHANGE PAS : ni `agent_conversations` (aucune colonne ne part), ni `cabinets`, ni aucune fonction d'hier
-- (`is_super_admin` est appelée, jamais réécrite). L'application ne lit rien de neuf tant que `CONSOMMATION_TENUE_PAR_LA_FONCTION`
-- est baissé, ni la fonction tant que sa constante l'est.
--
-- À APPLIQUER PAR L'OUTIL : aucune instruction n'y retire quoi que ce soit. L'ORDRE : cette migration ; puis, dans un même
-- commit, le fichier rangé dans l'export sous sa version d'historique, la constante de `agent-comptable` et le drapeau de
-- l'application levés ; la fonction déployée depuis ce commit AVANT sa fusion (le navigateur ne cesse d'écrire les tokens que
-- quand la fonction écrit le journal). VERSION PROVISOIRE, HORS DE L'EXPORT. Ni barre oblique inverse, ni retour chariot.

-- ══ 0. La garde de tête ══════════
-- Elle refuse une seconde application ; une base où manquerait une table ou une colonne qu'elle nomme ; et une fonction
-- appelée qui ne serait plus celle qu'elle suppose, à l'empreinte de son corps (les retours chariot d'un collage écartés),
-- relevée le 27/11/2026 sur une copie de la réplique portée à la production du jour (261).
do $garde$
declare
  v_nombre integer;
begin
  if to_regclass('public.consommations_de_l_assistant') is not null
     or exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                 and p.proname in ('consommation_de_l_assistant', 'garder_consommations_de_l_assistant')) then
    raise exception 'La migration consommations_de_l_assistant est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  select count(*) into v_nombre from pg_attribute a
   where not a.attisdropped
     and ((a.attrelid = 'public.cabinets'::regclass and a.attname = 'id')
       or (a.attrelid = 'public.dossiers'::regclass and a.attname in ('id', 'cabinet_id')));
  if v_nombre <> 3 then
    raise exception 'Une colonne que cette migration lit manque (% sur 3) : relire la base.', v_nombre;
  end if;
  select count(*) into v_nombre from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'is_super_admin';
  if v_nombre <> 1
     or (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.is_super_admin()'))
        is distinct from 'a9159138778422a43ba8d8c21240c9bb' then
    raise exception 'La fonction public.is_super_admin() n''est plus celle que cette migration suppose (empreinte attendue a9159138…) : la relire avant d''appliquer cette migration.';
  end if;
end
$garde$;

-- ══ 1. La table ══════════
create table public.consommations_de_l_assistant (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.cabinets (id) on delete cascade,
  dossier_id uuid references public.dossiers (id) on delete set null,
  compte uuid not null,
  consommee_le timestamptz not null default now(),
  tokens_entree integer not null,
  tokens_sortie integer not null,
  constraint consommations_de_l_assistant_tokens_entree check (tokens_entree between 0 and 10000000),
  constraint consommations_de_l_assistant_tokens_sortie check (tokens_sortie between 0 and 1000000)
);

comment on table public.consommations_de_l_assistant is
  'Le journal de consommation de l''assistant (ASSIST-Q1) : une ligne par appel au modèle, écrite par la fonction agent-comptable seule, sous la clé du service ; le plafond mensuel du cabinet ne lit qu''elle. Sous RLS, sans policy permissive, aucun droit aux rôles de l''API ; ni réécrite ni retirée (sa garde), hors de la mise à nul du dossier retiré et de la cascade du cabinet. Aucun texte.';
comment on column public.consommations_de_l_assistant.dossier_id is
  'Le dossier de la question, mis à nul quand il est retiré : la consommation reste celle du cabinet, son mois ne se vide pas.';
comment on column public.consommations_de_l_assistant.compte is
  'Le compte (auth.uid) de la session qui a posé la question, sans clé étrangère : retirer un compte n''efface pas ce qu''il a consommé.';
comment on column public.consommations_de_l_assistant.consommee_le is
  'L''instant de l''écriture, posé par la base (la garde), jamais par l''auteur : le mois du plafond ne se choisit pas.';
comment on column public.consommations_de_l_assistant.tokens_entree is
  'Les tokens d''entrée que le modèle a rendus pour cet appel, de 0 à dix millions.';
comment on column public.consommations_de_l_assistant.tokens_sortie is
  'Les tokens de sortie que le modèle a rendus pour cet appel, de 0 à un million.';

-- Le mois d'un cabinet, que le plafond lit à chaque question ; et le dossier, que sa clé étrangère cherche quand il est retiré.
create index consommations_de_l_assistant_cabinet_mois on public.consommations_de_l_assistant (cabinet_id, consommee_le);
create index consommations_de_l_assistant_dossier on public.consommations_de_l_assistant (dossier_id);

alter table public.consommations_de_l_assistant enable row level security;
-- Aucune policy permissive : la fonction l'écrit et la lit sous la clé du service, hors de la RLS. Et aucun droit aux rôles de
-- l'API, au-delà de la RLS (la table naît avec les quatre du DML, que le défaut du propriétaire leur donne).
revoke all on public.consommations_de_l_assistant from anon, authenticated;

-- ══ 2. La garde du journal ══════════
-- Aux droits de l'appelant : la fonction, sous la clé du service, et la clé étrangère, que la base joue sous le propriétaire.
create function public.garder_consommations_de_l_assistant() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.consommee_le := now();
    -- Un dossier absent n'est pas jugé ici : sa clé étrangère le refuse ensuite (23503), et la fonction note alors sans lui.
    if exists (select 1 from public.dossiers d where d.id = new.dossier_id and d.cabinet_id is distinct from new.cabinet_id) then
      raise exception 'La consommation d''un dossier se note sous le cabinet de ce dossier.' using errcode = '23514';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    -- La mise à nul du dossier retiré, par sa clé étrangère : le dossier n'est plus, rien d'autre ne change.
    if old.dossier_id is not null and new.dossier_id is null
       and (new.id, new.cabinet_id, new.compte, new.consommee_le, new.tokens_entree, new.tokens_sortie)
           is not distinct from (old.id, old.cabinet_id, old.compte, old.consommee_le, old.tokens_entree, old.tokens_sortie)
       and not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return new;
    end if;
    raise exception 'Une consommation de l''assistant ne se réécrit pas.' using errcode = '42501';
  end if;
  -- La sortie d'une ligne : la cascade de son cabinet retiré, seule.
  if not exists (select 1 from public.cabinets c where c.id = old.cabinet_id) then
    return old;
  end if;
  raise exception 'Une consommation de l''assistant ne se retire pas : elle part avec son cabinet.' using errcode = '42501';
end
$$;

comment on function public.garder_consommations_de_l_assistant() is
  'La garde du journal de consommation de l''assistant (ASSIST-Q1) : l''instant posé par la base ; le dossier d''une ligne de son cabinet (23514) ; ni réécriture ni sortie (42501), hors de la mise à nul du dossier retiré et de la cascade du cabinet retiré.';

create trigger consommations_de_l_assistant_garde
  before insert or update or delete on public.consommations_de_l_assistant
  for each row execute function public.garder_consommations_de_l_assistant();

-- ══ 3. La lecture du super-administrateur ══════════
-- Par cabinet, depuis toujours et depuis `p_depuis` ; vérifiée avant toute lecture. Les colonnes du résultat sont des variables
-- de la fonction : chaque colonne lue se qualifie.
create function public.consommation_de_l_assistant(p_depuis timestamptz)
  returns table (cabinet_id uuid, tokens_entree bigint, tokens_sortie bigint, tokens_entree_depuis bigint, tokens_sortie_depuis bigint)
  language plpgsql
  stable
  security definer
  set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Seul le super-administrateur lit la consommation de l''assistant.' using errcode = '42501';
  end if;
  if p_depuis is null then
    raise exception 'Dire depuis quand compter la consommation du mois.' using errcode = '22023';
  end if;
  return query
    select c.cabinet_id,
           sum(c.tokens_entree)::bigint,
           sum(c.tokens_sortie)::bigint,
           coalesce(sum(c.tokens_entree) filter (where c.consommee_le >= p_depuis), 0)::bigint,
           coalesce(sum(c.tokens_sortie) filter (where c.consommee_le >= p_depuis), 0)::bigint
      from public.consommations_de_l_assistant c
     group by c.cabinet_id
     order by c.cabinet_id;
end
$$;

comment on function public.consommation_de_l_assistant(timestamptz) is
  'La consommation de l''assistant par cabinet (ASSIST-Q1), au super-administrateur seul (42501) : les tokens d''entrée et de sortie depuis toujours et depuis p_depuis. Des sommes, aucune ligne du journal.';

-- ══ 4. Les droits d'exécution ══════════
revoke execute on function public.garder_consommations_de_l_assistant() from public, anon, authenticated;
revoke execute on function public.consommation_de_l_assistant(timestamptz) from public, anon;
grant execute on function public.consommation_de_l_assistant(timestamptz) to authenticated;

-- ══ 5. La double authentification exigée (C7, second temps), si elle est déjà en base ══════════
-- Appliquée avant `deux_facteurs_exiges`, ce bloc ne fait rien et sa boucle pose la restrictive sur la table ; après, il la
-- pose ici, à l'expression exacte (deuxFacteursDesTablesNeuves.test.ts).
do $deux_facteurs$
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    execute 'create policy deux_facteurs on public.consommations_de_l_assistant as restrictive for all to authenticated '
      || 'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))';
  end if;
end
$deux_facteurs$;

-- ══ 6. La garde de fin ══════════
-- Ce que la migration a posé, relu au catalogue, quel que soit le chemin (un autre donneur, PUBLIC, une appartenance) : la RLS
-- active, aucune policy permissive, la seule restrictive celle de la double authentification quand elle est en base ; aucun
-- droit des rôles de l'API ni de PUBLIC sur la table ou une colonne, le DML au rôle du service ; la garde avant les trois
-- écritures, ligne à ligne, aux droits de l'appelant, qu'aucun connecté n'exécute ; la lecture aux droits du propriétaire, le
-- chemin fixé, exécutée par authenticated, ni par l'anonyme ni par PUBLIC ; les deux bornes ; la table vide.
do $fin$
declare
  v_table constant regclass := 'public.consommations_de_l_assistant'::regclass;
begin
  if not (select c.relrowsecurity from pg_class c where c.oid = v_table) then
    raise exception 'La table consommations_de_l_assistant n''a pas sa RLS.';
  end if;
  if exists (select 1 from pg_policy p where p.polrelid = v_table and p.polpermissive)
     or exists (select 1 from pg_policy p where p.polrelid = v_table and not p.polpermissive and p.polname <> 'deux_facteurs')
     or (select count(*) from pg_policy p where p.polrelid = v_table)
        <> (case when to_regprocedure('public.deux_facteurs_satisfaits()') is null then 0 else 1 end) then
    raise exception 'La table consommations_de_l_assistant porte une policy que la migration ne pose pas.';
  end if;
  if exists (select 1
               from (values ('anon'), ('authenticated'), ('public')) r(n)
              cross join (select distinct d.privilege_type from aclexplode(acldefault('r', to_regrole('anon'))) d) p
              where has_table_privilege(r.n, v_table, p.privilege_type))
     or exists (select 1 from (values ('anon'), ('authenticated'), ('public')) r(n)
                 cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) p(p)
                 where has_any_column_privilege(r.n, v_table, p.p))
     or exists (select 1 from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) p(p)
                 where not has_table_privilege('service_role', v_table, p.p)) then
    raise exception 'Les droits sur consommations_de_l_assistant ne sont pas ceux que la migration pose : rien aux rôles de l''API ni à PUBLIC, le DML au rôle du service.';
  end if;
  if (select count(*) from pg_trigger t
       where t.tgrelid = v_table and not t.tgisinternal
         and t.tgfoid = 'public.garder_consommations_de_l_assistant()'::regprocedure and t.tgtype = 31) <> 1
     or (select count(*) from pg_trigger t where t.tgrelid = v_table and not t.tgisinternal) <> 1
     or (select p.prosecdef from pg_proc p where p.oid = 'public.garder_consommations_de_l_assistant()'::regprocedure)
     or has_function_privilege('authenticated', 'public.garder_consommations_de_l_assistant()', 'execute') then
    raise exception 'La garde du journal de consommation manque, n''est pas aux droits de l''appelant, ou un connecté l''exécute.';
  end if;
  if (select count(*) from pg_proc p
       where p.oid = 'public.consommation_de_l_assistant(timestamptz)'::regprocedure
         and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
         and not has_function_privilege('anon', p.oid, 'execute')
         and has_function_privilege('authenticated', p.oid, 'execute')
         and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)) <> 1 then
    raise exception 'La lecture de la consommation de l''assistant n''a pas les droits que la migration pose.';
  end if;
  if (select count(*) from pg_constraint c
       where c.conrelid = v_table and c.contype = 'c'
         and c.conname in ('consommations_de_l_assistant_tokens_entree', 'consommations_de_l_assistant_tokens_sortie')) <> 2 then
    raise exception 'Les bornes des tokens du journal de consommation manquent.';
  end if;
  if exists (select 1 from public.consommations_de_l_assistant) then
    raise exception 'Le journal de consommation de l''assistant ne naît pas vide.';
  end if;
end
$fin$;
