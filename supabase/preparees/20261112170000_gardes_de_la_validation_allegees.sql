-- LIGNE 28.66 — LA VALIDATION D'UN GROS EXERCICE : LES DEUX GARDES PAR LIGNE ALLÉGÉES, SANS RIEN CHANGER À CE QU'ELLES
-- REFUSENT (PRÉPARÉE le 12/11/2026, PAS APPLIQUÉE). Le récit : HISTORIQUE.md, « 12/11/2026 — LA VALIDATION D'UN GROS
-- EXERCICE : LES GARDES ALLÉGÉES (LIGNE 28.66) » ; le constat : « LA VALIDATION REFUSE LES MANQUES DES VENTES FACTURÉES »
-- (la mesure, VF7B-Q2) ; l'essai : supabase/essais/gardesDeLaValidation.sql ; le retour :
-- supabase/preparees/retour/20261112170100_retour_gardes_de_la_validation_allegees.sql ; le garde du texte :
-- src/lib/gardesDeLaValidationAllegees.test.ts.
--
-- SOURCES. PostgreSQL 17, CREATE TRIGGER : « In a BEFORE trigger, the WHEN condition is evaluated just before the function
-- is or would be executed, so using WHEN is not materially different from testing the same condition at the beginning of
-- the trigger function » ; une condition WHEN d'un déclencheur d'insertion ne lit pas OLD, d'un déclencheur de suppression
-- pas NEW ; CREATE OR REPLACE TRIGGER remplace la définition d'un déclencheur existant. « Overview of Trigger Behavior » :
-- les déclencheurs d'un même événement « will be fired in alphabetical order by name ». « Advisory Lock Functions » : « If a
-- session already holds a given advisory lock, additional requests by it will always succeed ».
--
-- LE CONSTAT, MESURÉ SUR UNE COPIE DE LA RÉPLIQUE MÈRE 17 RATTRAPÉE À LA PRODUCTION (200 migrations), sous `authenticated`,
-- aux réglages de la production (jit off, work_mem 2 184 kB), chaque validation dans une transaction annulée : la mise à
-- jour qui numérote l'exercice (`valider_exercice`) déclenche, pour CHAQUE ligne, deux gardes en PL/pgSQL — les six
-- autres déclencheurs du brouillon ne visent que des colonnes qu'elle ne pose pas (`update of …`) :
--   - `ecritures_brouillon_intangibles` (`garder_ecritures_validees`) : le dossier relu, deux verrous partagés de la
--     validation, chacun par `cle_validation` (une fonction SQL au chemin fixé, que le planificateur n'incorpore pas : un
--     appel complet par verrou), puis le réglage `jd.validation_exercice` comparé ;
--   - `ecritures_brouillon_vente_facturee_lignes` (G5, `garder_lignes_de_la_vente_facturee`) : le dossier relu, le
--     mouvement relu deux fois, puis la ligne entière convertie deux fois en jsonb et comparée hors des quatorze colonnes
--     que la validation pose.
--   Pour 3 000 encaissements (9 000 lignes en trésorerie, 15 000 en engagement), la validation prend 1,4 à 1,7 s et 2,2 à
--   3,2 s ; pour 10 002 encaissements (30 006 et 50 010 lignes), 4,7 à 5,1 s et 8,0 s — la limite de huit secondes du rôle
--   `authenticated` est atteinte. Sans les deux gardes : 0,7 à 0,8 s ; 1,1 à 1,6 s ; 2,7 à 2,9 s ; 3,7 à 3,8 s.
--
-- CE QU'ELLE FAIT. Chacune des deux gardes garde son déclencheur, son nom, sa fonction et sa place pour l'insertion et la
-- suppression ; pour la MODIFICATION, un déclencheur jumeau, la même fonction sous une condition WHEN, qui ne l'écarte que
-- là où elle n'aurait rien refusé :
--   a. `ecritures_brouillon_intangibles_modification` : la fonction ne s'appelle pas pour la seule ligne que la validation
--      numérote — une ligne qui n'était pas validée, qu'une modification valide, dans son dossier, sous le réglage que
--      `valider_exercice` pose pour ce dossier. Là, la fonction ne refuse rien (la ligne n'était pas validée ; le réglage
--      est celui du dossier) ; ses deux verrous partagés sont superflus : le réglage ne se pose que dans `valider_exercice`,
--      APRÈS son verrou exclusif sur la même clé, dans la même transaction (la garde ci-dessous le vérifie), et une session
--      qui tient le verrou exclusif obtient le partagé sur-le-champ. Toute autre modification (une ligne validée, une ligne
--      qui ne se valide pas, un changement de dossier, le réglage absent ou d'un autre dossier) appelle la fonction comme
--      hier, verrous compris.
--   b. `ecritures_brouillon_vente_facturee_lignes_modification` : la fonction ne s'appelle pas quand la ligne ne change
--      que dans les quatorze colonnes que la validation pose — la condition est la négation, au caractère près, de la
--      comparaison par laquelle la fonction rend la ligne sans rien refuser ; ce qui la précède (le dossier et le mouvement
--      relus) ne refuse ni n'écrit rien. Une colonne ajoutée demain au brouillon y entre d'elle-même (`to_jsonb`).
-- L'ordre des refus ne change pas : le nom du jumeau prolonge celui de sa garde, il prend sa place parmi les déclencheurs
-- de la modification — la garde des écritures validées entre `ecritures_brouillon_comptes_des_pieces` et
-- `ecritures_brouillon_paiement_personnel`, G5 la dernière.
--
-- CE QU'ELLE NE CHANGE PAS : aucune fonction, aucune policy, aucune donnée, aucun droit ; aucun refus — ni son code, ni son
-- message, ni son rang quand plusieurs refus se rencontrent. Une seule différence, hors de tout refus : un rôle qui
-- poserait lui-même `jd.validation_exercice` hors de `valider_exercice` — aucun rôle de l'API ne le peut (`set_config`
-- n'est pas exposé), et un rôle qui le peut peut aussi désactiver les déclencheurs — n'attendrait plus, en validant une
-- ligne de ce dossier, le verrou partagé de la validation. Aucune suppression : le texte ne porte que le mot des
-- événements des déclencheurs (`insert or delete`), comme `categories_du_dossier`.

do $garde$
declare
  v_ecart text;
begin
  -- Les deux déclencheurs d'hier, tels quels : avant chaque ligne, insertion, suppression et modification, sans colonne
  -- ni condition, actifs ; leurs jumeaux absents.
  select string_agg(n, ', ') into v_ecart
    from (values ('ecritures_brouillon_intangibles', 'public.garder_ecritures_validees()'),
                 ('ecritures_brouillon_vente_facturee_lignes', 'public.garder_lignes_de_la_vente_facturee()')) as g(n, f)
   where not exists (select 1 from pg_trigger t
                      where t.tgrelid = 'public.ecritures_brouillon'::regclass and t.tgname = g.n and not t.tgisinternal
                        and t.tgfoid = g.f::regprocedure and t.tgtype = 31 and t.tgenabled = 'O' and t.tgqual is null
                        and t.tgattr = ''::int2vector and t.tgconstraint = 0);
  if v_ecart is not null then
    raise exception 'gardes_de_la_validation_allegees : le déclencheur % n''est plus celui que cette migration suppose.', v_ecart;
  end if;
  if exists (select 1 from pg_trigger t where t.tgrelid = 'public.ecritures_brouillon'::regclass
              and t.tgname in ('ecritures_brouillon_intangibles_modification', 'ecritures_brouillon_vente_facturee_lignes_modification')) then
    raise exception 'gardes_de_la_validation_allegees : déjà appliquée.';
  end if;
  -- Les deux fonctions, au caractère près (les retours chariot d'un collage écartés) : la condition de chaque jumeau se
  -- tire de CE texte-là.
  select string_agg(n, ', ') into v_ecart
    from (values ('garder_ecritures_validees', 'dc906f95cc607d4d3161aa1bfb662864'),
                 ('garder_lignes_de_la_vente_facturee', '52320c1e5903df610c1d592f59130c53')) as g(n, m)
   where (select md5(replace(p.prosrc, chr(13) || chr(10), chr(10))) from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname = g.n and p.pronargs = 0) is distinct from g.m;
  if v_ecart is not null then
    raise exception 'gardes_de_la_validation_allegees : la fonction % n''est plus celle que cette migration suppose.', v_ecart;
  end if;
  -- Le réglage de la validation ne se pose que dans `valider_exercice`, après son verrou exclusif.
  select string_agg(p.oid::regprocedure::text, ', ') into v_ecart
    from pg_proc p
   where strpos(p.prosrc, 'set_config(''jd.validation_exercice''') > 0 and p.proname <> 'valider_exercice';
  if v_ecart is not null then
    raise exception 'gardes_de_la_validation_allegees : % pose aussi le réglage de la validation.', v_ecart;
  end if;
  if (select count(*) from pg_proc p where p.proname = 'valider_exercice') <> 1
     or not exists (select 1 from pg_proc p
                     where p.pronamespace = 'public'::regnamespace and p.proname = 'valider_exercice'
                       and strpos(p.prosrc, 'perform pg_advisory_xact_lock(public.cle_validation(p_dossier_id));') > 0
                       and strpos(p.prosrc, 'perform pg_advisory_xact_lock(public.cle_validation(p_dossier_id));')
                           < strpos(p.prosrc, 'set_config(''jd.validation_exercice''')) then
    raise exception 'gardes_de_la_validation_allegees : valider_exercice ne prend plus son verrou exclusif avant de poser son réglage.';
  end if;
end
$garde$;

create or replace trigger ecritures_brouillon_intangibles
  before insert or delete on public.ecritures_brouillon
  for each row execute function public.garder_ecritures_validees();

create trigger ecritures_brouillon_intangibles_modification
  before update on public.ecritures_brouillon
  for each row
  when (old.statut is not distinct from 'validee' or new.statut is distinct from 'validee'
        or old.dossier_id is distinct from new.dossier_id
        or current_setting('jd.validation_exercice', true) is distinct from new.dossier_id::text)
  execute function public.garder_ecritures_validees();

create or replace trigger ecritures_brouillon_vente_facturee_lignes
  before insert or delete on public.ecritures_brouillon
  for each row execute function public.garder_lignes_de_la_vente_facturee();

create trigger ecritures_brouillon_vente_facturee_lignes_modification
  before update on public.ecritures_brouillon
  for each row
  when ((to_jsonb(new) - array['statut', 'valide_le', 'journal_code', 'numero_ecriture', 'piece_ref', 'piece_date', 'compte_lib',
                               'comp_aux_num', 'comp_aux_lib', 'date_reglement', 'mode_reglement', 'nature_operation',
                               'poste_rattache', 'identification_client'])
        is distinct from (to_jsonb(old) - array['statut', 'valide_le', 'journal_code', 'numero_ecriture', 'piece_ref',
                                               'piece_date', 'compte_lib', 'comp_aux_num', 'comp_aux_lib',
                                               'date_reglement', 'mode_reglement', 'nature_operation',
                                               'poste_rattache', 'identification_client']))
  execute function public.garder_lignes_de_la_vente_facturee();

comment on trigger ecritures_brouillon_intangibles_modification on public.ecritures_brouillon is
  'La garde des écritures validées, pour la modification (ligne 28.66) : la fonction d''hier, écartée pour la seule ligne que valider_exercice numérote (non validée, validée par la modification, dans son dossier, sous le réglage du dossier), où elle ne refuse rien et où ses verrous partagés doublent le verrou exclusif de la validation.';
comment on trigger ecritures_brouillon_vente_facturee_lignes_modification on public.ecritures_brouillon is
  'G5 pour la modification (ligne 28.66) : la fonction d''hier, écartée quand la ligne ne change que dans les quatorze colonnes que la validation pose, la négation de sa propre comparaison, où elle ne refuse rien. La dernière garde de la modification, comme G5.';
