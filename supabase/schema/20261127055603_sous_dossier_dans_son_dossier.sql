-- DOCF-Q1-B — LE SOUS-DOSSIER D'UN DOCUMENT OU D'UNE PIÈCE, TENU DANS SON DOSSIER (onglets Documents administratifs et
-- Justificatifs ; décision du cabinet du 17/11/2026, « (A) Préparer la contrainte en base », à la recommandation). PRÉPARÉE le
-- 17/11/2026, PAS APPLIQUÉE. Le récit : HISTORIQUE.md, « 17/11/2026 — DOCF-Q1-B : LE SOUS-DOSSIER TENU DANS SON DOSSIER, EN
-- BASE (PRÉPARÉE, PAS APPLIQUÉE) » ; l'essai : supabase/essais/sousDossierDansSonDossier.sql (EN ATTENTE sans elle) ; le
-- retour : supabase/preparees/retour/20261117150100_retour_sous_dossier_dans_son_dossier.sql ; le module qui redit ses refus :
-- src/lib/sousDossierDansSonDossier.ts (`SOUS_DOSSIER_DANS_SON_DOSSIER_PREVU`, baissé jusqu'à l'application).
--
-- SOURCES. La règle des dossiers de l'application (CLAUDE.md, « RLS multi-cabinets » : toute ligne d'un dossier se juge par
-- son dossier) ; A8Q5-Q4 (la pièce d'un paiement tenue dans son dossier, en production depuis le 16/11/2026 : la même forme) ;
-- CFCS-Q1 (posée après un relevé de zéro ligne fautive). PostgreSQL 17 : CREATE TRIGGER (des déclencheurs BEFORE d'un même
-- évènement tirent dans l'ordre alphabétique de leur nom ; la clause WHEN) ; « Triggers on Data Changes » et « Constraints »
-- (une clé étrangère se vérifie par des déclencheurs du système, APRÈS les déclencheurs BEFORE) ; SELECT, « The Locking
-- Clause » (FOR SHARE bloque la mise à jour et la suppression de la ligne par une autre transaction) ; « Transaction
-- Isolation », Read Committed (une lecture verrouillante qui rencontre une ligne qu'une autre transaction modifie attend sa
-- fin, puis rejuge sa condition sur la version modifiée).
--
-- LE CAS. `documents_divers.sous_dossier_id` et `pieces.sous_dossier_id` (des colonnes du socle, créées hors migration) ne
-- sont liées que par une clé étrangère simple vers `sous_dossiers(id)` : la base vérifie que le sous-dossier existe, pas qu'il
-- est un sous-dossier du dossier de la ligne. Les écrans n'offrent que les sous-dossiers lus par `.eq('dossier_id', …)`, et la
-- fiche d'un document revérifie le choix (DOCF-Q1) ; mais la policy `documents_divers_admins_all` ouvre l'écriture au
-- cabinet, « membres peuvent deposer des documents » et `pieces_insert` l'insertion au client, `pieces_update` la mise à jour
-- au cabinet, `sous_dossiers_update` le changement de dossier d'un sous-dossier : un appel direct pouvait ranger un document ou
-- une pièce dans le sous-dossier d'un autre dossier, ou déplacer un sous-dossier qui range des lignes. Et la clé étrangère,
-- jugée hors de la RLS, disait au passage à qui l'essayait si un identifiant de sous-dossier existe dans un autre dossier.
--
-- CE QU'ELLE POSE, rien d'autre :
--   1. `garder_sous_dossier_dans_son_dossier`, une garde `security definer` (son chemin fixé, exécutable par aucun rôle de
--      session), sur `documents_divers` et `pieces` (l'insertion, ou la mise à jour du sous-dossier ou du dossier, d'une ligne
--      qui a un sous-dossier) : le sous-dossier est un sous-dossier du dossier de la ligne. Elle le lit verrouillé en partage
--      (FOR SHARE) : un déplacement concurrent du sous-dossier attend la fin de l'écriture qui le cite, ou celle-ci, venue
--      après, voit le déplacement fait et refuse. Un refus ne dit rien du sous-dossier, et ne distingue pas celui d'un autre
--      dossier d'un identifiant inconnu : la garde tire AVANT la clé étrangère.
--   2. `garder_sous_dossier_occupe`, `security INVOKER`, sur `sous_dossiers` (le changement de dossier) : un sous-dossier qui
--      range un document ou une pièce ne change pas de dossier ; un sous-dossier vide en change, comme hier (le côté
--      sous-dossier de la même relation, comme `pieces_reglees_dans_leur_dossier` pour A8Q5-Q4). Invoker : qui déplace un
--      sous-dossier administre son dossier (la policy `sous_dossiers_update`, using) et y lit tous ses documents et pièces —
--      la garde de la ligne n'en laisse ranger aucun d'un autre dossier, et la garde de tête n'en trouve aucun aujourd'hui ;
--      `sous_dossiers` reste ainsi hors de la porte d'accès, qui ne couvre que les gardes `security definer`.
--   3. Trois déclencheurs BEFORE : `documents_divers_au_sous_dossier_de_leur_dossier`, `pieces_au_sous_dossier_de_leur_dossier`
--      (nommés pour tirer juste après la porte d'accès `_acces_avant_les_gardes`, avant toute autre garde de ces tables), et
--      `sous_dossiers_occupes_restent_dans_leur_dossier`.
--
-- LE RELEVÉ. La garde de tête refuse de s'appliquer tant qu'un document ou une pièce est rangé dans le sous-dossier d'un autre
-- dossier : un tel état se relève et se corrige d'abord (relevé de zéro ligne fautive, comme CFCS-Q1). Le refus dit les deux
-- comptes, jamais une ligne.
--
-- CE QU'ELLE NE CHANGE PAS : aucune table, colonne, contrainte, policy ni donnée ; aucune fonction d'hier ; le socle (ni
-- `create table` ni index ne changent : `socle.sql` ne rend pas les déclencheurs des douze tables). Les deux clés étrangères
-- simples restent : la suppression d'un sous-dossier met encore à nul celui des pièces (`on … set null` : la garde ne juge pas
-- un sous-dossier nul) et reste refusée tant qu'un document le cite, comme hier ; la suppression d'un dossier emporte ses
-- sous-dossiers, ses documents et ses pièces comme hier. Une ligne sans sous-dossier, une mise à jour qui ne change ni le
-- sous-dossier ni le dossier, passent sans lecture. La restauration réinsère les sous-dossiers avant les pièces et les
-- documents (la clé étrangère l'impose déjà), sous l'identifiant d'origine du dossier : elle passe la garde.
--
-- COMMENT ELLE S'APPLIQUE : aucune instruction de retrait ni de vidage, aucune barre oblique inverse, aucune fonction
-- remplacée — PAR L'OUTIL. Indépendante des autres migrations préparées : aucune ne pose ces fonctions ni ces déclencheurs ;
-- `chemin_dans_son_dossier` (CFCS-Q1) touche les mêmes tables par des contraintes CHECK, dans n'importe quel ordre. Le jour de
-- son application, `SOUS_DOSSIER_DANS_SON_DOSSIER_PREVU` se lève et le fichier entre dans supabase/schema/ sous la version que
-- porte sa ligne d'historique, texte inchangé.

-- ══ 0. La garde de tête ══════════
do $garde$
declare
  v_documents bigint;
  v_pieces bigint;
begin
  if to_regprocedure('public.garder_sous_dossier_dans_son_dossier()') is not null
     or to_regprocedure('public.garder_sous_dossier_occupe()') is not null
     or exists (select 1 from pg_catalog.pg_trigger t
                 where t.tgname in ('documents_divers_au_sous_dossier_de_leur_dossier', 'pieces_au_sous_dossier_de_leur_dossier',
                                    'sous_dossiers_occupes_restent_dans_leur_dossier') and not t.tgisinternal) then
    raise exception 'DOCF-Q1-B : la garde du sous-dossier est déjà en base : cette migration ne se rejoue pas.';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public'
         and (table_name, column_name) in (('documents_divers', 'sous_dossier_id'), ('documents_divers', 'dossier_id'),
                                           ('pieces', 'sous_dossier_id'), ('pieces', 'dossier_id'),
                                           ('sous_dossiers', 'id'), ('sous_dossiers', 'dossier_id'))) <> 6 then
    raise exception 'DOCF-Q1-B : une colonne que la garde lit manque (documents_divers, pieces, sous_dossiers).';
  end if;
  -- La porte d'accès, première des déclencheurs BEFORE de `documents_divers` et de `pieces` (GARDES-Q1, en production depuis
  -- le 15/11/2026) : la garde neuve tire après elle.
  if (select count(*) from pg_catalog.pg_trigger t
       where t.tgname = '_acces_avant_les_gardes' and not t.tgisinternal
         and t.tgrelid in ('public.documents_divers'::regclass, 'public.pieces'::regclass)) <> 2 then
    raise exception 'DOCF-Q1-B : la porte d''accès (_acces_avant_les_gardes) manque sur documents_divers ou pieces.';
  end if;
  -- Aucun document ni aucune pièce n'est rangé dans le sous-dossier d'un autre dossier (le relevé de zéro ligne fautive).
  select count(*) into v_documents
    from public.documents_divers d join public.sous_dossiers s on s.id = d.sous_dossier_id
   where s.dossier_id is distinct from d.dossier_id;
  select count(*) into v_pieces
    from public.pieces p join public.sous_dossiers s on s.id = p.sous_dossier_id
   where s.dossier_id is distinct from p.dossier_id;
  if v_documents > 0 or v_pieces > 0 then
    raise exception 'DOCF-Q1-B : % document(s) et % pièce(s) sont rangés dans le sous-dossier d''un autre dossier : les relever et les corriger avant d''appliquer cette migration.',
      v_documents, v_pieces using errcode = '23514';
  end if;
end
$garde$;

-- ══ 1. La garde de la ligne : son sous-dossier est un sous-dossier de son dossier ══════════
create function public.garder_sous_dossier_dans_son_dossier() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Une mise à jour qui ne change ni le sous-dossier ni le dossier ne se rejuge pas (la clause WHEN écarte déjà une ligne
  -- sans sous-dossier).
  if tg_op = 'UPDATE' and new.sous_dossier_id is not distinct from old.sous_dossier_id
     and new.dossier_id is not distinct from old.dossier_id then
    return new;
  end if;
  -- Le sous-dossier, lu verrouillé en partage : un déplacement concurrent attend la fin de cette écriture, ou celle-ci voit le
  -- déplacement fait (Read Committed rejuge la condition sur la version déplacée). Un identifiant inconnu se refuse sous les
  -- mêmes mots : la garde tire avant la clé étrangère, et ne dit rien de ce qui n'est pas au dossier.
  perform 1 from public.sous_dossiers s where s.id = new.sous_dossier_id and s.dossier_id = new.dossier_id for share;
  if not found then
    if tg_table_name = 'documents_divers' then
      raise exception 'Le sous-dossier d''un document est un sous-dossier de son dossier.' using errcode = '23514';
    end if;
    raise exception 'Le sous-dossier d''une pièce est un sous-dossier de son dossier.' using errcode = '23514';
  end if;
  return new;
end
$$;

comment on function public.garder_sous_dossier_dans_son_dossier() is
  'DOCF-Q1-B : le sous-dossier d''un document (documents_divers) ou d''une pièce (pieces) est un sous-dossier de son dossier (23514), lu verrouillé en partage pour qu''un déplacement concurrent du sous-dossier ne passe pas entre deux. Tire juste après la porte d''accès et avant la clé étrangère ; ne distingue pas un sous-dossier d''un autre dossier d''un identifiant inconnu.';

revoke all on function public.garder_sous_dossier_dans_son_dossier() from public, anon, authenticated, service_role;

-- ══ 2. Le côté sous-dossier : occupé, il ne change pas de dossier ══════════
create function public.garder_sous_dossier_occupe() returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- Le changement de dossier (la clause WHEN : il change) d'un sous-dossier qui range un document ou une pièce.
  if exists (select 1 from public.documents_divers d where d.sous_dossier_id = old.id)
     or exists (select 1 from public.pieces p where p.sous_dossier_id = old.id) then
    raise exception 'Ce sous-dossier range des documents ou des pièces de son dossier : il ne change pas de dossier.'
      using errcode = '23514';
  end if;
  return new;
end
$$;

comment on function public.garder_sous_dossier_occupe() is
  'DOCF-Q1-B : un sous-dossier qui range un document ou une pièce ne change pas de dossier (23514) ; un sous-dossier vide en change. Security invoker : qui le déplace administre son dossier et en lit les documents et les pièces.';

revoke all on function public.garder_sous_dossier_occupe() from public, anon, authenticated, service_role;

-- ══ 3. Les trois déclencheurs : sur la ligne, juste après la porte ; sur le sous-dossier, au changement de dossier ══════════
create trigger documents_divers_au_sous_dossier_de_leur_dossier
  before insert or update of sous_dossier_id, dossier_id on public.documents_divers
  for each row when (new.sous_dossier_id is not null)
  execute function public.garder_sous_dossier_dans_son_dossier();
create trigger pieces_au_sous_dossier_de_leur_dossier
  before insert or update of sous_dossier_id, dossier_id on public.pieces
  for each row when (new.sous_dossier_id is not null)
  execute function public.garder_sous_dossier_dans_son_dossier();
create trigger sous_dossiers_occupes_restent_dans_leur_dossier
  before update of dossier_id on public.sous_dossiers
  for each row when (old.dossier_id is distinct from new.dossier_id)
  execute function public.garder_sous_dossier_occupe();

-- ══ 4. La garde de fin : les corps posés, leurs droits, les trois déclencheurs, et leur rang ══════════
do $fin$
begin
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_catalog.pg_proc p
       where p.oid = to_regprocedure('public.garder_sous_dossier_dans_son_dossier()')) is distinct from '073351b7e13f417c36f31e7bb5c8d1ae'
     or (select md5(replace(p.prosrc, chr(13), '')) from pg_catalog.pg_proc p
          where p.oid = to_regprocedure('public.garder_sous_dossier_occupe()')) is distinct from 'e8c38ce6aa01cab7dfcb85bb242b7569'
     or (select not p.prosecdef or p.proconfig is distinct from array['search_path=public'] from pg_catalog.pg_proc p
          where p.oid = to_regprocedure('public.garder_sous_dossier_dans_son_dossier()'))
     or (select p.prosecdef or p.proconfig is distinct from array['search_path=public'] from pg_catalog.pg_proc p
          where p.oid = to_regprocedure('public.garder_sous_dossier_occupe()'))
     or has_function_privilege('anon', 'public.garder_sous_dossier_dans_son_dossier()', 'execute')
     or has_function_privilege('authenticated', 'public.garder_sous_dossier_dans_son_dossier()', 'execute')
     or has_function_privilege('service_role', 'public.garder_sous_dossier_dans_son_dossier()', 'execute')
     or has_function_privilege('anon', 'public.garder_sous_dossier_occupe()', 'execute')
     or has_function_privilege('authenticated', 'public.garder_sous_dossier_occupe()', 'execute')
     or has_function_privilege('service_role', 'public.garder_sous_dossier_occupe()', 'execute') then
    raise exception 'DOCF-Q1-B : les deux gardes n''ont pas le corps ou les droits de cette migration : rien n''est appliqué.';
  end if;
  if (select string_agg(pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text, ' ; ' order by t.tgname collate "C")
        from pg_catalog.pg_trigger t
       where t.tgfoid in (to_regprocedure('public.garder_sous_dossier_dans_son_dossier()'),
                          to_regprocedure('public.garder_sous_dossier_occupe()')) and not t.tgisinternal)
     is distinct from 'CREATE TRIGGER documents_divers_au_sous_dossier_de_leur_dossier BEFORE INSERT OR UPDATE OF sous_dossier_id, dossier_id ON public.documents_divers FOR EACH ROW WHEN ((new.sous_dossier_id IS NOT NULL)) EXECUTE FUNCTION garder_sous_dossier_dans_son_dossier() O ; '
                   || 'CREATE TRIGGER pieces_au_sous_dossier_de_leur_dossier BEFORE INSERT OR UPDATE OF sous_dossier_id, dossier_id ON public.pieces FOR EACH ROW WHEN ((new.sous_dossier_id IS NOT NULL)) EXECUTE FUNCTION garder_sous_dossier_dans_son_dossier() O ; '
                   || 'CREATE TRIGGER sous_dossiers_occupes_restent_dans_leur_dossier BEFORE UPDATE OF dossier_id ON public.sous_dossiers FOR EACH ROW WHEN ((old.dossier_id IS DISTINCT FROM new.dossier_id)) EXECUTE FUNCTION garder_sous_dossier_occupe() O' then
    raise exception 'DOCF-Q1-B : les trois déclencheurs ne sont pas ceux de cette migration : rien n''est appliqué.';
  end if;
  -- Leur rang : sur `documents_divers` et `pieces`, la première garde BEFORE après la porte d'accès (les déclencheurs d'un
  -- même évènement tirent dans l'ordre de leur nom, octet par octet).
  if exists (select 1 from pg_catalog.pg_trigger t
              where t.tgrelid in ('public.documents_divers'::regclass, 'public.pieces'::regclass)
                and not t.tgisinternal and (t.tgtype & 2) = 2
                and t.tgname <> '_acces_avant_les_gardes'
                and t.tgname not in ('documents_divers_au_sous_dossier_de_leur_dossier', 'pieces_au_sous_dossier_de_leur_dossier')
                and t.tgname collate "C" < (case when t.tgrelid = 'public.documents_divers'::regclass
                                                 then 'documents_divers_au_sous_dossier_de_leur_dossier'
                                                 else 'pieces_au_sous_dossier_de_leur_dossier' end) collate "C") then
    raise exception 'DOCF-Q1-B : une garde BEFORE tire avant celle du sous-dossier dans son dossier : rien n''est appliqué.';
  end if;
end
$fin$;
