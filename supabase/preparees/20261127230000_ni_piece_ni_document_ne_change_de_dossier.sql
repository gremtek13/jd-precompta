-- SECU4-Q2 — NI UNE PIÈCE NI UN DOCUMENT NE CHANGE DE DOSSIER, POUR TOUT AUTEUR (réponse (B) du cabinet du 27/11/2026 : « une
-- seule règle au lieu d'une garde par relation »). PRÉPARÉE le 27/11/2026, PAS APPLIQUÉE. Le récit : HISTORIQUE.md, « 27/11/2026
-- — SECU4-Q2 ET MCBR2-Q2 » ; l'essai : supabase/essais/niPieceNiDocumentNeChangeDeDossier.sql (EN ATTENTE sans elle) ; le
-- retour : supabase/preparees/retour/20261127230100_retour_ni_piece_ni_document_ne_change_de_dossier.sql. Aucun module ni
-- drapeau : l'application ne change jamais le dossier d'une pièce ni d'un document (la fiche d'une pièce réécrit son propre
-- dossier, que la clause WHEN laisse passer) ; seule l'API le permettait.
--
-- SOURCES. La règle des dossiers de l'application (CLAUDE.md, « RLS multi-cabinets » : toute ligne d'un dossier se juge par son
-- dossier ; « Stockage » : le premier segment du chemin d'un fichier EST son dossier, `chemin_dans_son_dossier`, 238). La
-- relecture adverse de sécurité du 27/11/2026 (HISTORIQUE.md, « LA RELECTURE ADVERSE DE SÉCURITÉ DES MIGRATIONS 218 À 259 ») :
-- des relations d'une pièce laissaient leur pièce passer à un autre dossier. PostgreSQL 17, « CREATE TRIGGER » : des
-- déclencheurs BEFORE d'un même évènement tirent dans l'ordre alphabétique de leur nom ; la condition WHEN d'un déclencheur
-- BEFORE se juge juste avant sa fonction, sur la ligne NEW telle que les déclencheurs précédents l'ont laissée ; un déclencheur
-- « UPDATE OF » une colonne ne tire que si la commande nomme cette colonne — une colonne qu'un déclencheur précédent changerait
-- lui échapperait. « INSERT … ON CONFLICT DO UPDATE » tire les déclencheurs BEFORE UPDATE de la ligne en conflit.
--
-- LE CAS (SECU4-Q2). Qui administre deux dossiers (un chef, un membre assigné aux deux) passait une pièce, ou un document
-- administratif, de l'un à l'autre par l'API, son chemin avec lui. Les gardes de la table des pièces le refusaient relation par
-- relation (le paiement par un mouvement ou par une part de virement groupé, A8Q5-Q4 ; la source citée par la révision et le
-- dossier permanent ; la facture reprise ; la caisse ; la fiche hors de France ; la pièce écartée de l'e-reporting ; la pièce
-- figée par la validation ; l'écriture libre, SECU4-Q1) ; les autres relations ne le refusaient pas — le bien du registre,
-- l'écriture du brouillon, le lettrage, le justificatif proposé, la désignation de l'exemplaire, le commentaire, la note interne,
-- le texte lu —, et chacune laissait une ligne d'un dossier citer une pièce d'un autre. Le cabinet a retenu une seule règle.
--
-- CE QUI CHANGE LE DOSSIER D'UNE PIÈCE OU D'UN DOCUMENT AUJOURD'HUI, relu avant d'écrire la règle (la règle le ferme pour tous) :
--   - l'application : aucun écran ; la fiche d'une pièce renvoie son propre dossier (`FichePiece.tsx`), la clause WHEN le laisse
--     passer ; aucune écriture de `documents_divers` ne nomme son dossier (relu dans src/ et supabase/functions/) ;
--   - les Edge Functions : elles insèrent des pièces (`receive-email`, `plateforme-agreee`, `superpdp-sync`), n'en déplacent aucune ;
--   - les fonctions SQL : aucune ne met à jour le dossier d'une pièce ni d'un document (relu dans `pg_proc.prosrc`, à 261 : quatre
--     fonctions mettent une pièce à jour — la vente hors des factures et l'exemplaire —, sans son dossier ; aucune n'écrit dans
--     `documents_divers`) ; `deposer_honoraires_chez_le_client` insère ;
--   - la restauration d'une sauvegarde : elle RÉINSÈRE (`ecrireParLots`, src/lib/sauvegardeDonnees.ts) et sa seconde passe ne
--     repose que le lien d'un avoir (`factures_emises`) ;
--   - la suppression d'un dossier, ou d'un cabinet : la cascade de `pieces_dossier_id_fkey` et `documents_divers_dossier_id_fkey`
--     RETIRE les lignes, elle ne les met pas à jour ; celle d'un sous-dossier ne remet à nul que `sous_dossier_id`.
--   Aucun cas légitime : rien à traiter. Une fusion de dossiers, ou le déplacement d'une pièce déposée dans le mauvais dossier,
--   n'existe pas ; le jour où il existera, il passera par une fonction qui en dit la règle, et cette garde se relira.
--
-- CE QU'ELLE POSE, rien d'autre :
--   1. `garder_dossier_de_depot`, une garde qui ne lit RIEN (ni table ni fonction) : elle refuse, sous les mots de sa table. Aux
--      droits de l'appelant (aucune lecture : rien à ouvrir), son chemin fixé à vide, exécutable par aucun rôle de session (un
--      déclencheur ne vérifie pas ce droit en tirant). La porte `_acces_avant_les_gardes` n'est pas exigée pour elle — elle ne
--      garde que les gardes `security definer` —, et tire avant elle de toute façon.
--   2. Deux déclencheurs BEFORE UPDATE par ligne, sans liste de colonnes, sous la condition `old.dossier_id is distinct from
--      new.dossier_id` : `pieces_vers_un_autre_dossier` et `documents_divers_vers_un_autre_dossier`. Leur nom les range EN
--      DERNIER des déclencheurs BEFORE de leur table : la condition juge la ligne telle qu'elle s'écrira, après tout ce que les
--      déclencheurs précédents y ont fait ; et les gardes relation par relation tirent avant elle, avec leurs mots — elles disent
--      ce qui cite la pièce (« citée par l'écriture libre EL…-… de son dossier ») ; la règle neuve dit le reste.
--   La garde de tête refuse de s'appliquer si un déclencheur BEFORE d'une des deux tables se rangerait après le sien ; la garde
--   de fin relit le corps, les droits, les deux définitions et ce rang.
--
-- CE QU'ELLE NE CHANGE PAS : aucune table, colonne, donnée, policy ; aucune fonction ni garde d'hier, qui restent et tirent
-- avant elle — leurs refus et leurs mots sont ceux d'hier. Une pièce ou un document s'insère, se modifie et se retire comme
-- hier ; une écriture qui renvoie son propre dossier passe. Seule une ligne qui CHANGE de dossier se refuse, pour tout auteur :
-- l'appelant sous la RLS, le super-administrateur, le propriétaire de la base hors d'elle.
--
-- LES ESSAIS D'HIER : leurs contrôles positifs « une pièce (un document) que rien ne cite change de dossier » se retournent avec
-- elle ; chacun admet, la règle en base, son refus sous ses mots, et seulement eux — la garde de sa relation tirant avant, un
-- refus d'elle le ferait virer au rouge dans les deux états (caisse 214g, dossierPermanent 136, exemplairesDesFactures 78, 149 et
-- 227, piecesHorsDeFrance 124b, regimesEreporting 101c, revisionSoldes 141 ; et, dits sous ses mots, pieceDUnPaiementDansSonDossier
-- 4c, pieceDUneEcritureLibreDansSonDossier 2c, sousDossierDansSonDossier 2g, 2h et 3g) ; leurs contrôles négatifs gardent leurs
-- mots, la garde de leur relation tirant d'abord.
--
-- COMMENT ELLE S'APPLIQUE : aucune instruction de retrait ni de vidage, aucune barre oblique inverse, aucune fonction
-- remplacée — PAR L'OUTIL. Indépendante des autres migrations préparées : celles qui posent un déclencheur sur `pieces`
-- (B4, B7, INAL5, INV3) le nomment avant le sien. Le jour de son application, le fichier entre dans supabase/schema/ sous la
-- version que porte sa ligne d'historique, texte inchangé.

-- ══ 0. La garde de tête ══════════
do $garde$
begin
  if to_regprocedure('public.garder_dossier_de_depot()') is not null
     or exists (select 1 from pg_catalog.pg_trigger t
                 where t.tgname in ('pieces_vers_un_autre_dossier', 'documents_divers_vers_un_autre_dossier') and not t.tgisinternal) then
    raise exception 'SECU4-Q2 : la garde du dossier d''une pièce ou d''un document est déjà en base : cette migration ne se rejoue pas.';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public'
         and (table_name, column_name) in (('pieces', 'dossier_id'), ('documents_divers', 'dossier_id'))) <> 2 then
    raise exception 'SECU4-Q2 : la colonne dossier_id de pieces ou de documents_divers manque : relire la base.';
  end if;
  -- Le rang : aucun déclencheur BEFORE de ces deux tables ne se range après celui que la migration pose (les déclencheurs d'un
  -- même évènement tirent dans l'ordre de leur nom, octet par octet).
  if exists (select 1 from pg_catalog.pg_trigger t
              where not t.tgisinternal and (t.tgtype & 2) = 2
                and ((t.tgrelid = 'public.pieces'::regclass
                      and t.tgname collate "C" > 'pieces_vers_un_autre_dossier' collate "C")
                     or (t.tgrelid = 'public.documents_divers'::regclass
                         and t.tgname collate "C" > 'documents_divers_vers_un_autre_dossier' collate "C"))) then
    raise exception 'SECU4-Q2 : un déclencheur BEFORE de pieces ou de documents_divers tirerait après la garde du dossier : relire la migration contre la base.';
  end if;
end
$garde$;

-- ══ 1. La garde : le dossier d'une pièce ou d'un document ne change pas ══════════
create function public.garder_dossier_de_depot() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- La clause WHEN : la ligne change de dossier. Rien n'est lu : la règle ne dépend de rien d'autre.
  if tg_table_name = 'documents_divers' then
    raise exception 'Un document reste dans le dossier où il a été déposé : il ne change pas de dossier.' using errcode = '23514';
  end if;
  raise exception 'Une pièce reste dans le dossier où elle a été déposée : elle ne change pas de dossier.' using errcode = '23514';
end
$$;

comment on function public.garder_dossier_de_depot() is
  'SECU4-Q2 : une pièce (pieces) ou un document (documents_divers) ne change pas de dossier, pour tout auteur (23514). Ne lit rien ; tire en dernier des déclencheurs BEFORE de sa table, après les gardes relation par relation, qui disent ce qui cite la pièce.';

revoke all on function public.garder_dossier_de_depot() from public, anon, authenticated, service_role;

-- ══ 2. Les deux déclencheurs ══════════
create trigger pieces_vers_un_autre_dossier
  before update on public.pieces
  for each row when (old.dossier_id is distinct from new.dossier_id)
  execute function public.garder_dossier_de_depot();
create trigger documents_divers_vers_un_autre_dossier
  before update on public.documents_divers
  for each row when (old.dossier_id is distinct from new.dossier_id)
  execute function public.garder_dossier_de_depot();

-- ══ 3. La garde de fin : le corps posé, ses droits, ses deux déclencheurs, et leur rang ══════════
do $fin$
begin
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_catalog.pg_proc p
       where p.oid = to_regprocedure('public.garder_dossier_de_depot()')) is distinct from 'c8bcd036411fcd5ad6a93f5389e253fd'
     or (select p.prosecdef or p.proconfig is distinct from array['search_path=""'] from pg_catalog.pg_proc p
          where p.oid = to_regprocedure('public.garder_dossier_de_depot()'))
     or has_function_privilege('anon', 'public.garder_dossier_de_depot()', 'execute')
     or has_function_privilege('authenticated', 'public.garder_dossier_de_depot()', 'execute')
     or has_function_privilege('service_role', 'public.garder_dossier_de_depot()', 'execute') then
    raise exception 'SECU4-Q2 : garder_dossier_de_depot n''a pas le corps ou les droits de cette migration : rien n''est appliqué.';
  end if;
  if (select string_agg(pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text, ' ; ' order by t.tgname collate "C")
        from pg_catalog.pg_trigger t
       where t.tgfoid = to_regprocedure('public.garder_dossier_de_depot()') and not t.tgisinternal)
     is distinct from 'CREATE TRIGGER documents_divers_vers_un_autre_dossier BEFORE UPDATE ON public.documents_divers FOR EACH ROW WHEN ((old.dossier_id IS DISTINCT FROM new.dossier_id)) EXECUTE FUNCTION garder_dossier_de_depot() O ; '
                   || 'CREATE TRIGGER pieces_vers_un_autre_dossier BEFORE UPDATE ON public.pieces FOR EACH ROW WHEN ((old.dossier_id IS DISTINCT FROM new.dossier_id)) EXECUTE FUNCTION garder_dossier_de_depot() O' then
    raise exception 'SECU4-Q2 : les deux déclencheurs ne sont pas ceux de cette migration : rien n''est appliqué.';
  end if;
  -- Leur rang : chacun le DERNIER des déclencheurs BEFORE de sa table.
  if (select string_agg(x.tgname, ',' order by x.tgname collate "C")
        from (select distinct on (t.tgrelid) t.tgrelid, t.tgname from pg_catalog.pg_trigger t
               where t.tgrelid in ('public.pieces'::regclass, 'public.documents_divers'::regclass)
                 and not t.tgisinternal and (t.tgtype & 2) = 2
               order by t.tgrelid, t.tgname collate "C" desc) x)
     is distinct from 'documents_divers_vers_un_autre_dossier,pieces_vers_un_autre_dossier' then
    raise exception 'SECU4-Q2 : la garde du dossier ne tire pas en dernier des déclencheurs BEFORE de sa table : rien n''est appliqué.';
  end if;
end
$fin$;
