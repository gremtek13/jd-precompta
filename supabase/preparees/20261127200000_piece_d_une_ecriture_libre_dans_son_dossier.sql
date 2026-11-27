-- SECU4-Q1 — LA PIÈCE QU'UNE ÉCRITURE LIBRE CITE, TENUE DANS SON DOSSIER (ligne 26.9 ; relecture adverse de sécurité du
-- 27/11/2026, des migrations 218 à 259). PRÉPARÉE le 27/11/2026, PAS APPLIQUÉE. Le récit : HISTORIQUE.md, « 27/11/2026 — LA
-- RELECTURE ADVERSE DE SÉCURITÉ DES MIGRATIONS 218 À 259 » ; l'essai : supabase/essais/pieceDUneEcritureLibreDansSonDossier.sql
-- (EN ATTENTE sans elle) ; le retour : supabase/preparees/retour/20261127200100_retour_piece_d_une_ecriture_libre_dans_son_dossier.sql.
-- Aucun module ni drapeau : l'application ne change jamais le dossier d'une pièce (la fiche d'une pièce réécrit son propre
-- dossier) ; seule l'API le permettait.
--
-- SOURCES. La règle des dossiers de l'application (CLAUDE.md, « RLS multi-cabinets » : toute ligne d'un dossier se juge par son
-- dossier) ; `enregistrer_ecriture_libre` (EL2, 250), étape 8 : « La pièce citée, facultative : une pièce de ce dossier » ;
-- A8Q5-Q4 (231) et `garder_source_citee` : une pièce qu'une ligne de son dossier cite ne change pas de dossier — la même règle,
-- relation par relation. PostgreSQL 17, « CREATE TRIGGER » (des déclencheurs BEFORE d'un même évènement se déclenchent dans
-- l'ordre de leur nom ; une contrainte de clé étrangère se vérifie APRÈS eux).
--
-- LE CAS. `enregistrer_ecriture_libre` ne cite qu'une pièce de son dossier ; mais rien ne retenait ensuite la pièce : qui
-- administre deux dossiers (un chef, un membre assigné aux deux) la passait à l'autre par l'API, son chemin avec elle — mesuré
-- sur une copie de la réplique portée à 259, sous la session d'un chef qui n'est pas super-administrateur : l'écriture libre du
-- dossier B1 citait alors une pièce de B2. Ce qui s'en suit : le fichier de B2 restait figé par une écriture d'un autre dossier
-- (`fichier_fige`, 254), sa pièce ne se supprimait plus (la clé étrangère), et l'état des écritures libres, la piste d'audit et
-- leur écran, lus par un compte qui ne suit que B1, ne la lisaient plus. Aucune frontière franchie — l'auteur du geste
-- administre les deux dossiers —, mais une règle de la base que l'API contournait, et la relation qu'A8Q5-Q4 avait fermée pour
-- les paiements, ouverte pour cette citation, née après elle.
--
-- CE QU'ELLE POSE, rien d'autre :
--   1. `garder_piece_d_une_ecriture_libre`, une garde `security definer` (son chemin fixé, exécutable par aucun rôle de
--      session ; ses deux tables portent la porte d'accès) :
--      - sur `ecritures_libres` (l'insertion, ou la mise à jour de la pièce citée ou du dossier) : la pièce citée est une pièce
--        de son dossier, pour tout auteur — la fonction, la restauration du super-administrateur ; une pièce d'un autre dossier
--        et un identifiant inconnu se refusent sous les mêmes mots (la garde tire avant la clé étrangère) ;
--      - sur `pieces` (la mise à jour du dossier, la clause WHEN : il change) : une pièce qu'une écriture libre cite ne change
--        pas de dossier ; le refus nomme l'écriture (sa référence EL<année>-<numéro>) quand elle est du dossier d'où la pièce
--        part, le seul que l'auteur du geste administre à coup sûr (la RLS de `pieces` l'a jugé), sinon il ne nomme rien.
--   2. Deux déclencheurs BEFORE : `ecritures_libres_piece_de_son_dossier`, après la porte et les deux gardes de la table (qui
--      n'ouvrent l'écriture qu'à ses fonctions et à la restauration) ; `pieces_citees_par_une_ecriture_libre`, après la porte et
--      les gardes du sous-dossier et des citations d'hier (l'ordre de leurs noms).
--
-- LE RELEVÉ. La garde de tête refuse de s'appliquer tant qu'une écriture libre en base cite une pièce d'un autre dossier : un
-- tel état se relève et se corrige d'abord (relevé de zéro ligne fautive, comme CFCS-Q1 et A8Q5-Q4).
--
-- CE QU'ELLE NE CHANGE PAS : aucune table, aucune colonne, aucune donnée, aucune policy, aucune fonction d'hier. Une écriture
-- sans pièce passe comme hier ; une pièce que rien ne cite change encore de dossier (les contrôles positifs d'hier) ; une pièce
-- citée ne se supprime toujours pas (la clé étrangère, que l'écran dit avant le clic, ELQ8Q1-Q1). La restauration réinsère les
-- pièces avant les écritures libres, du même dossier.
--
-- COMMENT ELLE S'APPLIQUE : aucune instruction de retrait ni de vidage, aucune barre oblique inverse, aucune fonction
-- remplacée — PAR L'OUTIL. Indépendante des autres migrations préparées : aucune ne pose un déclencheur de ces noms ni cette
-- fonction. Le jour de son application, le fichier entre dans supabase/schema/ sous la version que porte sa ligne
-- d'historique, texte inchangé.

-- ══ 0. La garde de tête ══════════
do $garde$
begin
  if to_regprocedure('public.garder_piece_d_une_ecriture_libre()') is not null
     or exists (select 1 from pg_catalog.pg_trigger t
                 where t.tgname in ('ecritures_libres_piece_de_son_dossier', 'pieces_citees_par_une_ecriture_libre') and not t.tgisinternal) then
    raise exception 'SECU4-Q1 : la garde de la pièce d''une écriture libre est déjà en base : cette migration ne se rejoue pas.';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public'
         and (table_name, column_name) in (('ecritures_libres', 'id'), ('ecritures_libres', 'dossier_id'),
                                           ('ecritures_libres', 'piece_citee_id'), ('ecritures_libres', 'exercice'),
                                           ('ecritures_libres', 'numero'), ('pieces', 'id'), ('pieces', 'dossier_id'))) <> 7 then
    raise exception 'SECU4-Q1 : une colonne que la garde lit manque (ecritures_libres, pieces) : appliquer d''abord ecritures_libres (EL2).';
  end if;
  -- La porte d'accès, première des déclencheurs BEFORE des deux tables : la garde neuve, aux droits de son propriétaire, tire
  -- après elle. Sur `pieces`, l'une des trente-deux tables de la porte (GARDES-Q1, en production depuis le 15/11/2026) ; sur
  -- `ecritures_libres`, posée en clair par EL2 (250) : exigée ici, jamais reposée (deux poses se heurteraient).
  if not exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = 'public.ecritures_libres'::regclass
                  and t.tgname = '_acces_avant_les_gardes' and not t.tgisinternal) then
    raise exception 'SECU4-Q1 : la porte d''accès (_acces_avant_les_gardes) manque sur ecritures_libres : appliquer d''abord ecritures_libres (EL2).';
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = 'public.pieces'::regclass
                  and t.tgname = '_acces_avant_les_gardes' and not t.tgisinternal) then
    raise exception 'SECU4-Q1 : la porte d''accès (_acces_avant_les_gardes) manque sur pieces : appliquer d''abord acces_avant_les_gardes.';
  end if;
  -- Les deux gardes de la table des écritures libres, qui n'ouvrent l'écriture qu'à ses fonctions et à la restauration : la
  -- garde neuve tire après elles.
  if (select count(*) from pg_catalog.pg_trigger t
       where t.tgrelid = 'public.ecritures_libres'::regclass and not t.tgisinternal
         and t.tgname in ('ecritures_libres_garde', 'ecritures_libres_garde_de_la_contre_passation')) <> 2 then
    raise exception 'SECU4-Q1 : les gardes de ecritures_libres (EL2, EL7) ne sont plus celles que cette migration suppose.';
  end if;
  -- Aucune écriture libre ne cite déjà une pièce d'un autre dossier (le relevé de zéro ligne fautive).
  if exists (select 1 from public.ecritures_libres e join public.pieces p on p.id = e.piece_citee_id
              where p.dossier_id is distinct from e.dossier_id) then
    raise exception 'SECU4-Q1 : une écriture libre cite déjà une pièce d''un autre dossier : la relever et la corriger avant d''appliquer cette migration.';
  end if;
end
$garde$;

-- ══ 1. La garde : la pièce qu'une écriture libre cite est une pièce de son dossier ══════════
create function public.garder_piece_d_une_ecriture_libre() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exercice integer;
  v_numero integer;
begin
  if tg_table_name = 'pieces' then
    -- La mise à jour du dossier d'une pièce (la clause WHEN : il change) : citée par une écriture libre, elle n'en change pas.
    if exists (select 1 from public.ecritures_libres e where e.piece_citee_id = old.id) then
      select e.exercice, e.numero into v_exercice, v_numero
        from public.ecritures_libres e
       where e.piece_citee_id = old.id and e.dossier_id = old.dossier_id
       order by e.exercice, e.numero
       limit 1;
      if found then
        raise exception 'Cette pièce est citée par l''écriture libre EL%-% de son dossier : elle ne change pas de dossier.',
          v_exercice, case when v_numero < 1000 then lpad(v_numero::text, 4, '0') else v_numero::text end
          using errcode = '23514';
      end if;
      raise exception 'Cette pièce est citée par une écriture libre : elle ne change pas de dossier.' using errcode = '23514';
    end if;
    return new;
  end if;
  -- `ecritures_libres`. La pièce citée, quand elle change ou que le dossier change : une pièce de son dossier. Une pièce
  -- inconnue se refuse sous les mêmes mots qu'une pièce d'un autre dossier : la garde tire avant la clé étrangère.
  if new.piece_citee_id is not null
     and (tg_op = 'INSERT' or new.piece_citee_id is distinct from old.piece_citee_id or new.dossier_id is distinct from old.dossier_id)
     and not exists (select 1 from public.pieces p where p.id = new.piece_citee_id and p.dossier_id = new.dossier_id) then
    raise exception 'La pièce qu''une écriture libre cite est une pièce de son dossier.' using errcode = '23514';
  end if;
  return new;
end
$$;

comment on function public.garder_piece_d_une_ecriture_libre() is
  'SECU4-Q1 : la pièce qu''une écriture libre cite (ecritures_libres.piece_citee_id) est une pièce de son dossier, pour tout auteur ; une pièce qu''une écriture libre cite ne change pas de dossier (23514). Tire après la porte d''accès et les gardes de ecritures_libres ; ne distingue pas une pièce d''un autre dossier d''un identifiant inconnu ; ne nomme qu''une écriture du dossier d''où la pièce part.';

revoke all on function public.garder_piece_d_une_ecriture_libre() from public, anon, authenticated, service_role;

-- ══ 2. Les deux déclencheurs ══════════
create trigger ecritures_libres_piece_de_son_dossier
  before insert or update of piece_citee_id, dossier_id on public.ecritures_libres
  for each row execute function public.garder_piece_d_une_ecriture_libre();
create trigger pieces_citees_par_une_ecriture_libre
  before update of dossier_id on public.pieces
  for each row when (old.dossier_id is distinct from new.dossier_id)
  execute function public.garder_piece_d_une_ecriture_libre();

-- ══ 3. La garde de fin : le corps posé, ses droits, ses deux déclencheurs, et leur rang ══════════
do $fin$
begin
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_catalog.pg_proc p
       where p.oid = to_regprocedure('public.garder_piece_d_une_ecriture_libre()')) is distinct from '4a2b0a48cbeb6a6fe85af0c6ac00c571'
     or (select not p.prosecdef or p.proconfig is distinct from array['search_path=public'] from pg_catalog.pg_proc p
          where p.oid = to_regprocedure('public.garder_piece_d_une_ecriture_libre()'))
     or has_function_privilege('anon', 'public.garder_piece_d_une_ecriture_libre()', 'execute')
     or has_function_privilege('authenticated', 'public.garder_piece_d_une_ecriture_libre()', 'execute')
     or has_function_privilege('service_role', 'public.garder_piece_d_une_ecriture_libre()', 'execute') then
    raise exception 'SECU4-Q1 : garder_piece_d_une_ecriture_libre n''a pas le corps ou les droits de cette migration : rien n''est appliqué.';
  end if;
  if (select string_agg(pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text, ' ; ' order by t.tgname collate "C")
        from pg_catalog.pg_trigger t
       where t.tgfoid = to_regprocedure('public.garder_piece_d_une_ecriture_libre()') and not t.tgisinternal)
     is distinct from 'CREATE TRIGGER ecritures_libres_piece_de_son_dossier BEFORE INSERT OR UPDATE OF piece_citee_id, dossier_id ON public.ecritures_libres FOR EACH ROW EXECUTE FUNCTION garder_piece_d_une_ecriture_libre() O ; '
                   || 'CREATE TRIGGER pieces_citees_par_une_ecriture_libre BEFORE UPDATE OF dossier_id ON public.pieces FOR EACH ROW WHEN ((old.dossier_id IS DISTINCT FROM new.dossier_id)) EXECUTE FUNCTION garder_piece_d_une_ecriture_libre() O' then
    raise exception 'SECU4-Q1 : les deux déclencheurs ne sont pas ceux de cette migration : rien n''est appliqué.';
  end if;
  -- Leur rang : sur ecritures_libres, après la porte et les deux gardes de la table ; sur pieces, après la porte (les
  -- déclencheurs d'un même évènement tirent dans l'ordre de leur nom, octet par octet).
  if exists (select 1 from pg_catalog.pg_trigger t
              where t.tgrelid = 'public.ecritures_libres'::regclass and not t.tgisinternal
                and t.tgname in ('ecritures_libres_garde', 'ecritures_libres_garde_de_la_contre_passation', '_acces_avant_les_gardes')
                and t.tgname collate "C" > 'ecritures_libres_piece_de_son_dossier' collate "C")
     or exists (select 1 from pg_catalog.pg_trigger t
                 where t.tgrelid = 'public.pieces'::regclass and not t.tgisinternal and t.tgname = '_acces_avant_les_gardes'
                   and t.tgname collate "C" > 'pieces_citees_par_une_ecriture_libre' collate "C") then
    raise exception 'SECU4-Q1 : la garde neuve tirerait avant la porte d''accès ou les gardes de ecritures_libres : rien n''est appliqué.';
  end if;
end
$fin$;
