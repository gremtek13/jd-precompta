-- LES FACTURES REPRISES DE L'ANCIEN LOGICIEL D'UN CLIENT, EN BASE (ligne 51.5, étape A8a ; A8-Q1 à A8-Q6, tranchées par le
-- cabinet à la recommandation). PRÉPARÉE le 07/11/2026, PAS APPLIQUÉE. Le récit : HISTORIQUE.md, « A8A : LES FACTURES
-- REPRISES, EN BASE (PRÉPARÉE, PAS APPLIQUÉE) » ; la conception : « A8 ET A9, LES FACTURES REPRISES ET LA NUMÉROTATION QUI
-- CONTINUE : LA CONCEPTION REMISE À JOUR » (06/11/2026). Son essai : supabase/essais/facturesImportees.sql ; son retour :
-- supabase/preparees/retour/20261107210100_retour_factures_importees.sql. Le drapeau qui met ses deux tables au plan de
-- sauvegarde : `FACTURES_IMPORTEES_PREVUES` (src/lib/facturesImportees.ts), baissé.
--
-- À COLLER (l'outil retient ce texte : cinq `drop constraint`, et la suppression d'un lot dans le corps de
-- `retirer_import`) : dans l'éditeur SQL de Supabase, en UNE transaction, avec sa ligne d'historique.
--
-- POURQUOI : un client qui quitte son ancien logiciel en cours d'année laisse dehors ses factures d'avant — ses créances, la
-- suite de sa numérotation (A9), l'e-reporting de leurs paiements. A8a pose la base, et rien d'autre : rien ne s'y lit
-- encore (les lecteurs testent l'état par égalité, `'validee'` : une facture reprise est FERMÉE PAR DÉFAUT), rien ne s'y
-- importe depuis l'écran (A8-Q4 : l'écran d'import n'ouvre qu'avec A9).
--
-- CE QU'ELLE POSE :
--   1. Un troisième état de `factures_emises`, `importee` (MEG1-Q4, l'option (1)) : cinq contraintes REMPLACÉES, aucune
--      ligne d'aujourd'hui ne change de sens — l'état admet `importee` ; une importée a un numéro, comme une validée, mais
--      ni `validated_at` ni `valide_par` (contraintes d'hier, intactes) ; elle porte son option sur les débits (l'e-reporting
--      de ses paiements la lit : `premierRefusDuPaiement`) et la marque de facture source ; son numéro est celui de
--      l'ancien logiciel, de la forme de G1.05 (DGFiP, annexe 7 v1.9 : 35 caractères au plus, lettres, chiffres, espace,
--      « - + _ / », jamais d'espace en tête, en fin ni doublé) — la forme de la série de l'application (F ou A, l'année,
--      quatre chiffres au moins) ne s'exige plus que d'une facture qui n'est pas reprise. Et une contrainte AJOUTÉE : une
--      importée est la source de sa vente (A8-Q1), dit sa nature, le type de son client et son option sur les débits, et
--      ne cite aucune facture par `facture_origine_id` (l'avoir repris cite la sienne dans `factures_importees`, point 4).
--   2. La policy qui administre le dossier, `factures_emises_all`, passée `to authenticated` (elle visait `public` ; son
--      prédicat la fermait déjà sans session : un resserrement, sans effet sur une session).
--   3. La date de reprise du dossier (A8-Q2) : `dossiers.reprise_des_factures_le`, un jour civil, le premier d'un mois
--      (MEG1-Q7), posé par le chef du cabinet seul (`fixer_reprise_des_factures`), dans un dossier basculé, au plus tard le
--      jour de Paris de la bascule (`ventes_par_les_factures_depuis`, un instant), figé dès le premier import ; une
--      importée se date d'AVANT, son encaissement (A8b) de ce jour ou d'après. Une garde la tient : la colonne ne s'écrit
--      que par cette fonction, ou à la réinsertion d'un dossier par le super-administrateur (la restauration).
--   4. Deux tables, écrites par les seules fonctions d'import (et la restauration), lues par le cabinet du dossier seul
--      (le patron d'`encaissements_factures`, sans sa lecture au client : l'ouvrir au client « Ventes », avec les deux
--      fonctions, se présente au cabinet avec l'écran, A8d — rls.sql tient la liste des tables présentées) :
--        imports_factures    le LOT : son format (facturx, cii, ubl, pdf, csv), son fichier s'il en a un (empreinte
--                            SHA-256, taille, chemin `<dossier>/imports/<lot>/…` du seau `ventes`, que A8d ouvrira — une
--                            policy du seau, présentée alors), le nombre de ses factures, qui l'a importé et quand ;
--        factures_importees  une ligne par facture reprise (clé : la facture) : son lot et son rang, la ligne du CSV d'où
--                            elle vient, son fichier propre, ce qui en était ENCAISSÉ AVANT LA REPRISE, PAR TAUX (A8-Q6 :
--                            donné par taux, ou réparti au prorata des TTC de ses taux, en repli, et la répartition le dit,
--                            `encaisse_au_prorata`), ce que l'importateur DÉCLARE de sa transmission (papier, PDF, plateforme
--                            agréée — son nom —, inconnu), et, pour un avoir repris, la facture reprise qu'il crédite.
--      Un import se retire EN ENTIER (`retirer_import`) tant qu'aucune de ses factures n'a d'encaissement ni d'avoir, et que
--      l'application n'a validé aucune facture dans une série qu'il continue (retirer un numéro déjà suivi creuserait un
--      trou) ; il ne se modifie jamais.
--   5. La garde des factures reprises, deux déclencheurs NEUFS — `factures_emises_figees_reprises`, qui suit la garde
--      d'hier (`factures_emises_figees`, intacte), et `facture_lignes_figees_reprises` : une importée ne naît que par
--      `importer_factures` (le réglage `jd.import_facture` l'annonce, comme `jd.validation_facture` annonce une
--      validation) ou par la restauration ; elle ne se modifie pas, ses lignes non plus ; elle ne se supprime que par
--      `retirer_import` (le réglage `jd.retrait_import` nomme son lot) ou avec son dossier ; aucune facture ne le devient.
--      Et le cinquième refus de la validation (FACTURE-Q1 : la date d'émission ne précède pas la plus récente de la
--      série) s'étend aux importées de la même série, la série jugée par le motif `^[FA][0-9]{4}-[0-9]+$` jusqu'à A9 (un
--      numéro repris d'une autre forme n'y entre pas, et ne fait lever aucune conversion). POURQUOI DEUX DÉCLENCHEURS
--      NEUFS, et non la garde d'hier étendue : la migration préparée e7a (20261107120000_facture_internationale) remplace
--      `garder_factures_validees` depuis la même empreinte ; deux remplacements d'une fonction depuis une même base
--      imposeraient un ordre et la reprise de l'une sur l'autre. Ainsi A8a et e7a s'appliquent dans l'ordre qu'on voudra.
--   6. `fixer_source_de_la_vente` étendue (A8-Q1) : l'insertion d'une importée garde la marque de source que l'import pose
--      — dans un dossier basculé seulement —, SANS la frontière d'un exercice validé (une facture d'un exercice validé se
--      reprend), et une importée ne se rejuge plus ensuite.
--   7. `importer_factures(p_dossier_id, p_lot, p_factures)` : la porte unique, tout ou rien. L'accès (le cabinet du
--      dossier, `admin_du_dossier`) avant toute lecture ; le dossier verrouillé ; la comptabilité d'engagement refusée pour l'instant (A8-Q3 : la créance
--      d'une facture d'avant est au 411 de la reprise, que l'application n'écrit pas encore — A8e, avec l'expert-comptable) ;
--      la bascule et la date de reprise exigées (A8-Q2) ; le lot ; puis chaque facture, nommée par son rang : ses clés
--      ÉNUMÉRÉES (une clé inconnue se refuse, plutôt que se perdre), son numéro (G1.05, pas déjà au dossier ni au lot ; de
--      la forme de l'application, sa lettre, son année et un compteur de neuf chiffres au plus, et sa série que
--      l'application n'a pas encore continuée), son type, sa date (de 2000 à 2099, G1.36, avant la date de reprise), son
--      client, sa nature, son option sur les débits, ses lignes et ses montants — le HT au centime de ses lignes
--      (`centimes_ligne_facture`, la règle de l'application), la TVA par taux (base × taux, arrondie : EN 16931, BR-CO-17)
--      ou par ligne (l'ancien logiciel qui arrondissait ligne à ligne), un écart refusé et chiffré —, l'encaissé avant la
--      reprise (A8-Q6), sa transmission, ses fichiers ; un avoir repris cite une facture reprise de ce dossier, ce lot ou un
--      lot d'avant, et ne crédite pas plus qu'elle ne porte. Les séries de la forme de l'application se verrouillent comme
--      `prochain_numero_facture` les verrouille : un import et une validation de la même série se suivent.
--   8. `retirer_import(p_dossier_id, p_import_id)` : le retrait d'un lot entier, ses refus dits.
--
-- CE QU'ELLE NE FAIT PAS (A8b, A8c, A8d, A9) : l'encaissement d'une importée (`enregistrer_encaissement`, le plafond moins
-- l'encaissé avant la reprise, daté de la reprise ou d'après), son avoir par l'application (`enregistrer_facture`), sa vente
-- dans la 2035 et la CA3 (`calcul_vente_facturee`, `ecritures_attendues_de_la_periode`), les lecteurs TypeScript ouverts
-- nommément, la pièce déjà au dossier citée par un lien et son rapprochement fermé après la reprise (A8-Q5 : la colonne et
-- sa garde viennent ensemble, avec A8b), l'écran d'import, la numérotation qui continue par modèle.
--
-- L'ORDRE D'APPLICATION : aucun avec les migrations préparées du 07/11/2026. e7a ne touche ni les cinq contraintes, ni
-- `fixer_source_de_la_vente`, ni les lignes ; ses trois colonnes restent nulles sur une importée. La double
-- authentification exigée (20261107160000_deux_facteurs_exiges) pose sa policy restrictive sur toute table de public :
-- appliquée AVANT celle-ci, cette migration la pose elle-même sur ses deux tables (le bloc 4) ; APRÈS, sa boucle les prend.
--
-- LES SOURCES (publiques ; les normes AFNOR XP Z12-012 et XP Z12-013 ne s'utilisent pas) : CGI, ann. II, art. 242 nonies A,
-- I, 7° (la séquence chronologique et continue) ; BOI-TVA-DECLA-30-20-20-10, § 80 à § 130 (les séries) ; DGFiP,
-- spécifications externes de la facture électronique, annexe 7 v1.9, règles G1.05 (le numéro) et G1.36 (la date) ; norme
-- EN 16931-1, règle BR-CO-17 (la TVA d'une catégorie) ; LPF, art. L102 B (l'original reste où il est : la copie reprise
-- n'est pas l'archive légale) ; CGI, art. 278 à 281 nonies, 296 et 297 (les taux de TVA).

-- ══ 0. GARDE DE TÊTE : la base est celle que cette migration remplace ══════════

do $garde$
begin
  if to_regclass('public.imports_factures') is not null or to_regclass('public.factures_importees') is not null
     or exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'dossiers' and column_name = 'reprise_des_factures_le')
     or to_regprocedure('public.importer_factures(uuid, jsonb, jsonb)') is not null
     or to_regprocedure('public.retirer_import(uuid, uuid)') is not null
     or to_regprocedure('public.fixer_reprise_des_factures(uuid, date)') is not null then
    raise exception 'Les factures reprises sont déjà en base : cette migration ne se rejoue pas.';
  end if;
  -- Les cinq contraintes remplacées, à l'empreinte de leur définition (l'export : 20260908120056, 20261007164932,
  -- 20261007193006, 20261018201312), et la policy resserrée.
  if (select string_agg(c.conname || '=' || md5(pg_get_constraintdef(c.oid)), ',' order by c.conname collate "C")
        from pg_constraint c
       where c.conrelid = 'public.factures_emises'::regclass
         and c.conname in ('factures_emises_statut_check', 'factures_emises_numero_de_la_validation',
                           'factures_emises_option_debits_validee', 'factures_emises_source_d_une_facture_validee',
                           'factures_emises_numero_de_sa_serie'))
     is distinct from 'factures_emises_numero_de_la_validation=a74198fdf684700f14d8406341cfc94f,'
                   || 'factures_emises_numero_de_sa_serie=91eca002fd98f7ac47c887240e7703b1,'
                   || 'factures_emises_option_debits_validee=5ab6bb636a13e4bbff009a4d9d784521,'
                   || 'factures_emises_source_d_une_facture_validee=71e4809079e5e165d32d9bc97761af11,'
                   || 'factures_emises_statut_check=fba8f642691e27d5c10b7a6e350b4a30' then
    raise exception 'Les contraintes de factures_emises ne sont plus celles que cette migration remplace : la relire contre la base avant de l''appliquer.';
  end if;
  if not exists (select 1 from pg_policy p
                  where p.polrelid = 'public.factures_emises'::regclass and p.polname = 'factures_emises_all'
                    and p.polcmd = '*' and p.polroles = array[0]::oid[]
                    and pg_get_expr(p.polqual, p.polrelid) = 'admin_du_dossier(dossier_id)'
                    and pg_get_expr(p.polwithcheck, p.polrelid) = 'admin_du_dossier(dossier_id)') then
    raise exception 'La policy factures_emises_all n''est plus celle que cette migration resserre.';
  end if;
  -- `fixer_source_de_la_vente`, remplacée : celle de l'export (20261029214359_mentions_figees).
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.fixer_source_de_la_vente()'))
     is distinct from 'c7a13e4979dfbf28ffd1f2df5e748d44' then
    raise exception 'fixer_source_de_la_vente n''est plus celle que cette migration remplace (20261029214359) : la relire contre la base avant de l''appliquer.';
  end if;
  -- La garde d'hier, que le déclencheur neuf suit dans l'ordre des noms ; et ce que les fonctions neuves appellent.
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.factures_emises'::regclass and t.tgname = 'factures_emises_figees'
                    and t.tgfoid = 'public.garder_factures_validees()'::regprocedure)
     or not exists (select 1 from pg_trigger t
                     where t.tgrelid = 'public.facture_lignes'::regclass and t.tgname = 'facture_lignes_figees')
     or to_regprocedure('public.centimes_ligne_facture(numeric, numeric, numeric, boolean)') is null
     or to_regprocedure('public.admin_du_dossier(uuid)') is null
     or to_regprocedure('public.restauration_des_factures(uuid)') is null
     or to_regprocedure('public.est_chef_du_cabinet(uuid)') is null then
    raise exception 'La garde des factures, ses lignes ou les fonctions qu''appellent les factures reprises manquent.';
  end if;
end
$garde$;

-- ══ 1. LE TROISIÈME ÉTAT ET SES CONTRAINTES ══════════

alter table public.factures_emises
  drop constraint factures_emises_statut_check,
  add constraint factures_emises_statut_check check (statut in ('brouillon', 'validee', 'importee')),
  drop constraint factures_emises_numero_de_la_validation,
  add constraint factures_emises_numero_de_la_validation check ((statut in ('validee', 'importee')) = (numero is not null)),
  drop constraint factures_emises_option_debits_validee,
  add constraint factures_emises_option_debits_validee check (option_debits is null or statut in ('validee', 'importee')),
  drop constraint factures_emises_source_d_une_facture_validee,
  add constraint factures_emises_source_d_une_facture_validee
    check (not source_de_la_vente or statut in ('validee', 'importee')),
  drop constraint factures_emises_numero_de_sa_serie,
  add constraint factures_emises_numero_de_sa_serie check (
    case when statut = 'importee'
      then char_length(numero) <= 35 and numero ~ '^[-+_/A-Za-z0-9]( ?[-+_/A-Za-z0-9])*$'
      else numero ~ '^[FA][0-9]{4}-[0-9]{4,}$'
           and left(numero, 1) = case when type = 'avoir' then 'A' else 'F' end
           and substr(numero, 2, 4) = extract(year from date_emission)::integer::text
    end),
  add constraint factures_emises_reprise_entiere check (
    case when statut = 'importee'
      then source_de_la_vente and option_debits is not null and nature_operation is not null and type_client is not null
           and facture_origine_id is null
      else true
    end);

comment on column public.factures_emises.statut is
  'brouillon, validee (par enregistrer_facture), ou importee (A8a : une facture de l''ancien logiciel du client, reprise par importer_factures, jamais modifiée ; le numéro de l''ancien logiciel, sans validated_at ni valide_par, source de sa vente).';

-- ══ 2. LA POLICY QUI ADMINISTRE LE DOSSIER, À UNE SESSION SEULEMENT ══════════

alter policy factures_emises_all on public.factures_emises to authenticated;

-- ══ 3. LA DATE DE REPRISE DU DOSSIER (A8-Q2) ══════════

alter table public.dossiers
  add column reprise_des_factures_le date,
  add constraint dossiers_reprise_des_factures_premier_du_mois
    check (extract(day from reprise_des_factures_le) = 1 and reprise_des_factures_le >= date '2000-01-01');

comment on column public.dossiers.reprise_des_factures_le is
  'La date de reprise des factures de l''ancien logiciel (A8-Q2) : le premier jour d''un mois, au plus tard le jour de Paris de la bascule (ventes_par_les_factures_depuis), posé par le chef du cabinet (fixer_reprise_des_factures), figé dès le premier import. Une facture reprise se date d''avant ; son encaissement, de ce jour ou d''après.';

create function public.garder_reprise_des_factures() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- À l'insertion, la restauration seule réinsère un dossier avec sa date : le super-administrateur.
  if tg_op = 'INSERT' then
    if new.reprise_des_factures_le is not null and not public.is_super_admin() then
      raise exception 'La date de reprise des factures ne se pose que par fixer_reprise_des_factures, sur un dossier qui existe.'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if new.reprise_des_factures_le is distinct from old.reprise_des_factures_le
     and coalesce(current_setting('jd.reprise_des_factures', true), '') is distinct from old.id::text then
    raise exception 'La date de reprise des factures ne se pose que par fixer_reprise_des_factures, le chef du cabinet seul.'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger dossiers_reprise_des_factures
  before insert or update of reprise_des_factures_le on public.dossiers
  for each row execute function public.garder_reprise_des_factures();

create function public.fixer_reprise_des_factures(p_dossier_id uuid, p_reprise_le date) returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cabinet uuid;
  v_bascule boolean;
  v_depuis timestamptz;
  v_jour_bascule date;
  v_premier timestamptz;
begin
  -- L'accès, avant toute lecture : le cabinet du dossier, puis son chef seul.
  if p_dossier_id is null or not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  select d.cabinet_id, d.ventes_par_les_factures, d.ventes_par_les_factures_depuis
    into v_cabinet, v_bascule, v_depuis
    from public.dossiers d where d.id = p_dossier_id for update;
  if not public.est_chef_du_cabinet(v_cabinet) then
    raise exception 'Seul le chef du cabinet pose la date de reprise des factures d''un dossier.' using errcode = '42501';
  end if;
  if p_reprise_le is null or extract(day from p_reprise_le) <> 1 or p_reprise_le < date '2000-01-01' then
    raise exception 'La date de reprise des factures est le premier jour d''un mois : les factures d''avant ce jour se reprennent, l''application émet celles d''après.'
      using errcode = '22023';
  end if;
  if not v_bascule or v_depuis is null then
    raise exception 'La date de reprise des factures suppose un dossier dont les factures sont la source de leurs ventes : la bascule d''abord.'
      using errcode = '22023';
  end if;
  v_jour_bascule := (v_depuis at time zone 'Europe/Paris')::date;
  if p_reprise_le > v_jour_bascule then
    raise exception 'La date de reprise, le %, suit le jour de la bascule (le %) : elle est au plus tard le premier jour du mois de la bascule.',
      to_char(p_reprise_le, 'DD/MM/YYYY'), to_char(v_jour_bascule, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  select min(l.importe_le) into v_premier from public.imports_factures l where l.dossier_id = p_dossier_id;
  if v_premier is not null then
    raise exception 'La date de reprise est figée depuis le premier import de factures (le %) : elle ne change qu''une fois tous les imports retirés.',
      to_char(v_premier at time zone 'Europe/Paris', 'DD/MM/YYYY') using errcode = '23514';
  end if;
  perform set_config('jd.reprise_des_factures', p_dossier_id::text, true);
  update public.dossiers set reprise_des_factures_le = p_reprise_le where id = p_dossier_id;
  perform set_config('jd.reprise_des_factures', '', true);
  return p_reprise_le;
end
$$;

comment on function public.fixer_reprise_des_factures(uuid, date) is
  'Pose la date de reprise des factures d''un dossier basculé (A8-Q2) : le premier jour d''un mois, au plus tard le jour de Paris de la bascule ; le chef du cabinet seul (42501) ; figée dès le premier import (23514). Rend la date posée.';

-- ══ 4. LES DEUX TABLES ══════════

create table public.imports_factures (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  format text not null check (format in ('facturx', 'cii', 'ubl', 'pdf', 'csv')),
  fichier_sha256 text check (fichier_sha256 ~ '^[0-9a-f]{64}$'),
  fichier_taille bigint check (fichier_taille between 1 and 52428800),
  fichier_chemin text,
  nombre_factures integer not null check (nombre_factures between 1 and 2000),
  importe_par uuid,
  importe_le timestamptz not null default now(),
  constraint imports_factures_fichier_entier check (
    (fichier_sha256 is null) = (fichier_taille is null) and (fichier_chemin is null or fichier_sha256 is not null)),
  constraint imports_factures_chemin_du_lot check (
    fichier_chemin ~ '^[0-9a-f-]{36}/imports/[0-9a-f-]{36}/[^/]{1,200}$'
    and split_part(fichier_chemin, '/', 1) = dossier_id::text and split_part(fichier_chemin, '/', 3) = id::text),
  constraint imports_factures_un_fichier_une_fois unique (dossier_id, fichier_sha256)
);

create index imports_factures_dossier_idx on public.imports_factures (dossier_id, importe_le);

comment on table public.imports_factures is
  'Un lot de factures reprises de l''ancien logiciel d''un client (A8a) : son format, son fichier s''il en a un (empreinte SHA-256, taille, chemin du seau ventes), le nombre de ses factures, qui l''a importé et quand. Écrit par importer_factures seule (et la restauration), retiré en entier par retirer_import seule, jamais modifié ; lu par le cabinet du dossier.';

create table public.factures_importees (
  facture_id uuid primary key references public.factures_emises(id) on delete cascade,
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  import_id uuid not null references public.imports_factures(id),
  rang integer not null check (rang between 1 and 2000),
  ligne_csv integer check (ligne_csv >= 1),
  fichier_sha256 text check (fichier_sha256 ~ '^[0-9a-f]{64}$'),
  fichier_chemin text,
  encaisse_avant_reprise numeric not null default 0
    check (encaisse_avant_reprise >= 0 and encaisse_avant_reprise = round(encaisse_avant_reprise, 2)),
  encaisse_par_taux jsonb not null check (jsonb_typeof(encaisse_par_taux) = 'array'),
  encaisse_au_prorata boolean not null,
  transmise_par text not null check (transmise_par in ('papier', 'pdf', 'plateforme', 'inconnu')),
  plateforme_nom text check (char_length(plateforme_nom) between 1 and 100 and btrim(plateforme_nom) = plateforme_nom),
  origine_id uuid references public.factures_emises(id),
  constraint factures_importees_fichier_entier check ((fichier_chemin is null) = (fichier_sha256 is null)),
  constraint factures_importees_chemin_du_lot check (
    fichier_chemin ~ '^[0-9a-f-]{36}/imports/[0-9a-f-]{36}/[^/]{1,200}$'
    and split_part(fichier_chemin, '/', 1) = dossier_id::text and split_part(fichier_chemin, '/', 3) = import_id::text),
  constraint factures_importees_plateforme_nommee check ((transmise_par = 'plateforme') = (plateforme_nom is not null)),
  constraint factures_importees_rang_du_lot unique (import_id, rang)
);

create index factures_importees_import_idx on public.factures_importees (import_id);
create index factures_importees_dossier_idx on public.factures_importees (dossier_id);
create index factures_importees_origine_idx on public.factures_importees (origine_id) where origine_id is not null;

comment on table public.factures_importees is
  'Une facture reprise de l''ancien logiciel (A8a ; clé : la facture, à l''état importee) : son lot et son rang, la ligne du CSV, son fichier propre, l''encaissé avant la reprise (net des remboursements) et sa répartition par taux (A8-Q6 : [{"taux", "encaisse"}], un élément par taux de ses lignes ; encaisse_au_prorata dit le repli au prorata des TTC), ce que l''importateur déclare de sa transmission, et, pour un avoir repris, la facture reprise qu''il crédite (origine_id ; jamais facture_origine_id, que seule la validation d''un avoir de l''application pose). Écrite par importer_factures seule (et la restauration), jamais modifiée.';

alter table public.imports_factures enable row level security;
alter table public.factures_importees enable row level security;

create policy imports_factures_lecture on public.imports_factures
  for select to authenticated using (public.admin_du_dossier(dossier_id));
create policy imports_factures_restauration on public.imports_factures
  for insert to authenticated with check (public.is_super_admin());

create policy factures_importees_lecture on public.factures_importees
  for select to authenticated using (public.admin_du_dossier(dossier_id));
create policy factures_importees_restauration on public.factures_importees
  for insert to authenticated with check (public.is_super_admin());

-- La double authentification exigée (préparée, 20261107160000) : appliquée avant celle-ci, sa policy restrictive se pose
-- ici sur les deux tables neuves ; appliquée après, sa boucle sur pg_class les prend d'elle-même.
do $deux_facteurs$
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    create policy deux_facteurs on public.imports_factures as restrictive for all to authenticated
      using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()));
    create policy deux_facteurs on public.factures_importees as restrictive for all to authenticated
      using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()));
  end if;
end
$deux_facteurs$;

-- La garde des deux tables : elles naissent par importer_factures (le réglage `jd.import_lot` nomme le lot) ou par la
-- restauration, ne se modifient jamais, ne se suppriment que par retirer_import (`jd.retrait_import`) ou avec leur dossier.
create function public.garder_imports_factures() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot uuid;
begin
  if tg_op = 'UPDATE' then
    raise exception 'Un import de factures ne se modifie pas : il se retire en entier (retirer_import), tant que rien ne s''y rattache.'
      using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    v_lot := coalesce(to_jsonb(old)->>'import_id', to_jsonb(old)->>'id')::uuid;
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    if coalesce(current_setting('jd.retrait_import', true), '') is distinct from v_lot::text then
      raise exception 'Un import de factures ne se supprime que par retirer_import, en entier.' using errcode = '42501';
    end if;
    return old;
  end if;
  v_lot := coalesce(to_jsonb(new)->>'import_id', to_jsonb(new)->>'id')::uuid;
  if coalesce(current_setting('jd.import_lot', true), '') is distinct from v_lot::text
     and not public.restauration_des_factures(new.dossier_id) then
    raise exception 'Un import de factures ne naît que par importer_factures, qui le juge.' using errcode = '42501';
  end if;
  if tg_table_name = 'factures_importees' and not exists (
       select 1
         from public.factures_emises f
         join public.imports_factures l on l.id = v_lot and l.dossier_id = f.dossier_id
        where f.id = (to_jsonb(new)->>'facture_id')::uuid and f.dossier_id = new.dossier_id and f.statut = 'importee') then
    raise exception 'Une facture reprise appartient à son dossier et à un import de ce dossier, à l''état « reprise ».'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger imports_factures_garde
  before insert or update or delete on public.imports_factures
  for each row execute function public.garder_imports_factures();
create trigger factures_importees_garde
  before insert or update or delete on public.factures_importees
  for each row execute function public.garder_imports_factures();

-- ══ 5. LA GARDE DES FACTURES REPRISES ══════════

-- Le déclencheur suit `factures_emises_figees` (l'ordre des noms) : la garde d'hier juge d'abord, intacte — elle laisse
-- passer une facture qui n'est pas validée, et la garde neuve ferme alors ce qui touche une importée. Celle des mentions à
-- la validation (`factures_emises_figees_mentions`, JJ-Q4) se place entre les deux, et ne regarde qu'une validation.
create function public.garder_factures_reprises() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot uuid;
  v_numero_suivi text;
  v_date_suivie date;
begin
  if tg_op = 'DELETE' then
    if old.statut = 'importee' then
      if not exists (select 1 from public.dossiers where id = old.dossier_id) then
        return old;
      end if;
      select fi.import_id into v_lot from public.factures_importees fi where fi.facture_id = old.id;
      if v_lot is null or coalesce(current_setting('jd.retrait_import', true), '') is distinct from v_lot::text then
        raise exception 'La facture % est reprise de l''ancien logiciel : elle ne se supprime que par le retrait de son import, en entier (retirer_import).',
          old.numero using errcode = '23514';
      end if;
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.statut = 'importee'
       and coalesce(current_setting('jd.import_facture', true), '') is distinct from new.id::text
       and not public.restauration_des_factures(new.dossier_id) then
      raise exception 'Une facture reprise ne naît que par importer_factures, qui la juge.' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.statut = 'importee' then
    if to_jsonb(new) is distinct from to_jsonb(old) then
      raise exception 'La facture % est reprise de l''ancien logiciel : elle ne se modifie pas. Une reprise fausse se retire en entier (retirer_import), tant que rien ne s''y rattache.',
        old.numero using errcode = '23514';
    end if;
    return new;
  end if;
  if new.statut = 'importee' then
    raise exception 'Une facture ne devient pas une facture reprise : celle-ci naît par importer_factures.' using errcode = '42501';
  end if;
  -- Le cinquième refus de la validation, étendu aux importées de la même série (CGI, ann. II, art. 242 nonies A, I, 7°) :
  -- même dossier, même lettre, même année, la série jugée par le motif de l'application jusqu'à A9. La garde d'hier a jugé
  -- les validées ; le verrou de la série est tenu (`prochain_numero_facture`, et `importer_factures` le prend de même).
  if new.statut = 'validee' and old.statut = 'brouillon' then
    select f.numero, f.date_emission into v_numero_suivi, v_date_suivie
      from public.factures_emises f
     where f.dossier_id = new.dossier_id and f.statut = 'importee'
       and f.numero ~ '^[FA][0-9]{4}-[0-9]+$'
       and split_part(f.numero, '-', 1) = split_part(new.numero, '-', 1)
     order by f.date_emission desc, split_part(f.numero, '-', 2)::numeric desc
     limit 1;
    if new.date_emission < v_date_suivie then
      raise exception 'La date d''émission, le %, précède celle de % (le %), la plus récente des factures reprises de la même série : les numéros suivent l''ordre des dates d''émission (CGI, ann. II, art. 242 nonies A, I, 7°). Une date du % ou d''après se valide.',
        to_char(new.date_emission, 'DD/MM/YYYY'), v_numero_suivi, to_char(v_date_suivie, 'DD/MM/YYYY'),
        to_char(v_date_suivie, 'DD/MM/YYYY') using errcode = '22023';
    end if;
  end if;
  return new;
end
$$;

create trigger factures_emises_figees_reprises
  before insert or update or delete on public.factures_emises
  for each row execute function public.garder_factures_reprises();

create function public.garder_lignes_des_factures_reprises() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_numero text;
  v_statut text;
  v_dossier uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    -- Une ligne qui part avec sa facture (son retrait, son dossier) ne la trouve plus : la cascade passe.
    select f.numero, f.statut into v_numero, v_statut from public.factures_emises f where f.id = old.facture_id;
    if v_statut = 'importee' then
      raise exception 'La facture % est reprise de l''ancien logiciel : ses lignes ne changent pas.', v_numero
        using errcode = '23514';
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
  end if;
  select f.numero, f.statut, f.dossier_id into v_numero, v_statut, v_dossier
    from public.factures_emises f where f.id = new.facture_id;
  if v_statut = 'importee'
     and not (tg_op = 'INSERT'
              and (coalesce(current_setting('jd.import_facture', true), '') = new.facture_id::text
                   or public.restauration_des_factures(v_dossier))) then
    raise exception 'La facture % est reprise de l''ancien logiciel : ses lignes ne changent pas.', v_numero
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger facture_lignes_figees_reprises
  before insert or update or delete on public.facture_lignes
  for each row execute function public.garder_lignes_des_factures_reprises();

-- ══ 6. LA SOURCE DE LA VENTE D'UNE FACTURE REPRISE (A8-Q1) ══════════

-- Celle de l'export (20261029214359), et seules les lignes marquées « A8a » s'y ajoutent.
create or replace function public.fixer_source_de_la_vente() returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_source boolean;
  v_frontiere date;
begin
  if tg_op = 'INSERT' and new.statut = 'validee' then
    if new.source_de_la_vente
       and not coalesce((select d.ventes_par_les_factures from public.dossiers d where d.id = new.dossier_id), false) then
      raise exception 'Une facture n''est la source de sa vente que dans un dossier dont les factures sont la source de leurs ventes.'
        using errcode = '23514';
    end if;
    return new;
  end if;
  -- A8a : une facture reprise naît source de sa vente, la marque posée par son import (ou gardée par la restauration),
  -- dans un dossier basculé seulement ; SANS la frontière d'un exercice validé, qu'une facture d'avant la reprise précède.
  if tg_op = 'INSERT' and new.statut = 'importee' then
    if not new.source_de_la_vente then
      raise exception 'Une facture reprise est la source de sa vente : son import pose la marque (A8-Q1).' using errcode = '23514';
    end if;
    if not coalesce((select d.ventes_par_les_factures from public.dossiers d where d.id = new.dossier_id), false) then
      raise exception 'Une facture n''est la source de sa vente que dans un dossier dont les factures sont la source de leurs ventes.'
        using errcode = '23514';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and old.statut in ('validee', 'importee') then
    return new;
  end if;
  if new.statut <> 'validee' then
    if new.source_de_la_vente then
      raise exception 'La source de la vente se fixe à la validation de la facture : elle ne se pose pas.' using errcode = '42501';
    end if;
    return new;
  end if;

  -- La validation : le réglage du dossier pour une facture, la source de sa facture pour un avoir.
  if new.type = 'avoir' then
    select f.source_de_la_vente into v_source from public.factures_emises f where f.id = new.facture_origine_id;
  else
    select d.ventes_par_les_factures into v_source from public.dossiers d where d.id = new.dossier_id for share;
  end if;
  new.source_de_la_vente := coalesce(v_source, false);
  if not new.source_de_la_vente then
    return new;
  end if;
  if new.nature_operation is null then
    raise exception 'Dans un dossier dont les factures sont la source de leurs ventes, une facture dit si elle porte sur des biens ou sur des services : la nature de ses opérations est à renseigner avant sa validation.'
      using errcode = '23514';
  end if;
  if new.nature_operation = 'mixte' then
    raise exception 'Dans un dossier dont les factures sont la source de leurs ventes, une facture qui mêle biens et services ne se valide pas encore : elle se scinde en deux factures, l''une de biens, l''autre de services, tant que ses lignes ne disent pas leur nature.'
      using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(new.dossier_id));
  v_frontiere := public.frontiere_validation(new.dossier_id);
  if v_frontiere is not null and new.date_emission <= v_frontiere then
    raise exception '% : une facture source de sa vente, ou son avoir, ne s''y valide plus.',
      public.exercice_fige(new.dossier_id, extract(year from new.date_emission)::integer) using errcode = '23514';
  end if;
  return new;
end
$function$;

-- ══ 7. LA PORTE D'IMPORT ══════════

create function public.importer_factures(p_dossier_id uuid, p_lot jsonb, p_factures jsonb) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Les clés qu'une facture et une ligne portent : une clé inconnue se refuse, plutôt que se perdre.
  v_cles_facture constant text[] := array['numero', 'type', 'origine_numero', 'date_emission', 'date_echeance', 'tiers_nom',
    'tiers_adresse', 'tiers_siren', 'tiers_siret', 'type_client', 'nature_operation', 'option_debits', 'montant_ht',
    'montant_tva', 'montant_ttc', 'lignes', 'encaisse_avant_reprise', 'encaisse_par_taux', 'transmise_par',
    'plateforme_nom', 'ligne_csv', 'fichier_sha256', 'fichier_chemin'];
  v_cles_ligne constant text[] := array['designation', 'quantite', 'prix_unitaire_ht', 'taux_tva', 'nature', 'unite'];
  v_cles_lot constant text[] := array['id', 'format', 'fichier_sha256', 'fichier_taille', 'fichier_chemin'];
  -- Les taux de la TVA française : CGI, art. 278 à 281 nonies (métropole), 296 (Guadeloupe, Martinique, La Réunion),
  -- 297 (Corse).
  v_taux_admis constant numeric[] := array[0, 0.9, 1.05, 1.75, 2.1, 5.5, 8.5, 10, 13, 20];
  v_mode text;
  v_bascule boolean;
  v_depuis timestamptz;
  v_reprise date;
  v_lot uuid;
  v_format text;
  v_sha text;
  v_taille numeric;
  v_chemin text;
  v_nombre integer;
  v_rang integer := 0;
  v_f jsonb;
  v_l jsonb;
  v_texte text;
  v_ordre integer;
  v_id uuid;
  v_numero text;
  v_type text;
  v_date date;
  v_echeance date;
  v_tiers_nom text;
  v_type_client text;
  v_siren text;
  v_siret text;
  v_nature text;
  v_ht numeric;
  v_tva numeric;
  v_ttc numeric;
  v_origine_id uuid;
  v_origine_date date;
  v_q numeric;
  v_p numeric;
  v_t numeric;
  v_n text;
  v_u text;
  v_ht_c bigint;
  v_tva_taux_c bigint;
  v_tva_lignes_c bigint;
  v_par_taux boolean;
  v_encaisse numeric;
  v_repartition jsonb;
  v_au_prorata boolean;
  v_transmise text;
  v_plateforme text;
  v_ligne_csv integer;
  v_f_sha text;
  v_f_chemin text;
  v_annee integer;
  v_serie record;
  v_r record;
  v_reste numeric;
  v_total_ttc numeric;
  v_nb_taux integer;
  v_taux_ttc jsonb;
  v_ttc_negatif boolean;
begin
  -- 1. L'accès, avant toute lecture : le cabinet du dossier (l'ouvrir au client « Ventes » se présente avec l'écran, A8d).
  if p_dossier_id is null or not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- 2. Le dossier, verrouillé : deux imports se suivent, et la date de reprise ne bouge pas sous l'import.
  select d.mode_comptable, d.ventes_par_les_factures, d.ventes_par_les_factures_depuis, d.reprise_des_factures_le
    into v_mode, v_bascule, v_depuis, v_reprise
    from public.dossiers d where d.id = p_dossier_id for update;
  -- 3. A8-Q3 : la comptabilité d'engagement attend A8e.
  if v_mode = 'engagement' then
    raise exception 'Les factures d''un ancien logiciel ne se reprennent pas encore dans un dossier tenu en comptabilité d''engagement : la créance d''une facture d''avant est au compte client de la reprise, que l''application n''écrit pas encore.'
      using errcode = '22023';
  end if;
  -- 4. La bascule et la date de reprise (A8-Q2).
  if not coalesce(v_bascule, false) or v_depuis is null then
    raise exception 'Les factures d''un ancien logiciel se reprennent dans un dossier dont les factures sont la source de leurs ventes : la bascule d''abord.'
      using errcode = '22023';
  end if;
  if v_reprise is null then
    raise exception 'La date de reprise des factures n''est pas posée : le chef du cabinet la pose d''abord (le premier jour d''un mois, au plus tard celui de la bascule).'
      using errcode = '22023';
  end if;
  if v_reprise > (v_depuis at time zone 'Europe/Paris')::date then
    raise exception 'La date de reprise, le %, suit le jour de la bascule : la reposer.', to_char(v_reprise, 'DD/MM/YYYY')
      using errcode = '22023';
  end if;

  -- 5. Le lot.
  if p_lot is null or jsonb_typeof(p_lot) <> 'object' then
    raise exception 'Le lot se décrit par un objet : son format et, s''il en a un, son fichier.' using errcode = '22023';
  end if;
  -- Une clé à nul vaut une clé absente, au lot comme à chaque facture et à chacune de ses lignes.
  p_lot := jsonb_strip_nulls(p_lot);
  select string_agg(k, ', ' order by k collate "C") into v_texte
    from jsonb_object_keys(p_lot) k where not (k = any (v_cles_lot));
  if v_texte is not null then
    raise exception 'Le lot porte des clés que l''import ne connaît pas : %.', v_texte using errcode = '22023';
  end if;
  v_format := p_lot->>'format';
  if jsonb_typeof(p_lot->'format') is distinct from 'string' or v_format not in ('facturx', 'cii', 'ubl', 'pdf', 'csv') then
    raise exception 'Le format du lot est l''un de facturx, cii, ubl, pdf ou csv.' using errcode = '22023';
  end if;
  if p_lot ? 'id' then
    if jsonb_typeof(p_lot->'id') is distinct from 'string'
       or (p_lot->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'L''identifiant du lot est un UUID, en minuscules.' using errcode = '22023';
    end if;
    v_lot := (p_lot->>'id')::uuid;
    if exists (select 1 from public.imports_factures l where l.id = v_lot) then
      raise exception 'L''identifiant du lot est déjà pris.' using errcode = '22023';
    end if;
  else
    v_lot := gen_random_uuid();
  end if;
  v_sha := p_lot->>'fichier_sha256';
  v_chemin := p_lot->>'fichier_chemin';
  if (p_lot ? 'fichier_sha256') <> (p_lot ? 'fichier_taille') then
    raise exception 'Le fichier du lot se dit par son empreinte et sa taille, ensemble.' using errcode = '22023';
  end if;
  if p_lot ? 'fichier_sha256' then
    if jsonb_typeof(p_lot->'fichier_sha256') is distinct from 'string' or v_sha !~ '^[0-9a-f]{64}$' then
      raise exception 'L''empreinte du fichier du lot est un SHA-256, soixante-quatre caractères hexadécimaux en minuscules.'
        using errcode = '22023';
    end if;
    if jsonb_typeof(p_lot->'fichier_taille') is distinct from 'number' then
      raise exception 'La taille du fichier du lot est un nombre d''octets.' using errcode = '22023';
    end if;
    v_taille := (p_lot->'fichier_taille')::numeric;
    if v_taille <> trunc(v_taille) or v_taille < 1 or v_taille > 52428800 then
      raise exception 'La taille du fichier du lot est un nombre entier d''octets, de 1 à 50 Mio.' using errcode = '22023';
    end if;
    if exists (select 1 from public.imports_factures l where l.dossier_id = p_dossier_id and l.fichier_sha256 = v_sha) then
      raise exception 'Ce fichier a déjà été importé dans ce dossier (la même empreinte).' using errcode = '22023';
    end if;
  end if;
  if p_lot ? 'fichier_chemin' then
    if not (p_lot ? 'id') or not (p_lot ? 'fichier_sha256') or jsonb_typeof(p_lot->'fichier_chemin') is distinct from 'string'
       or v_chemin !~ ('^' || p_dossier_id::text || '/imports/' || v_lot::text || '/[^/]{1,200}$') then
      raise exception 'Le chemin du fichier du lot est « <dossier>/imports/<lot>/<nom> », le lot nommé par son identifiant, avec son empreinte.'
        using errcode = '22023';
    end if;
  end if;
  if p_factures is null or jsonb_typeof(p_factures) <> 'array' then
    raise exception 'Le lot porte au moins une facture.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_factures) = 0 then
    raise exception 'Le lot porte au moins une facture.' using errcode = '22023';
  end if;
  v_nombre := jsonb_array_length(p_factures);
  if v_nombre > 2000 then
    raise exception 'Un lot porte deux mille factures au plus : celui-ci en porte %. Le scinder.', v_nombre using errcode = '22023';
  end if;

  perform set_config('jd.import_lot', v_lot::text, true);
  insert into public.imports_factures (id, dossier_id, format, fichier_sha256, fichier_taille, fichier_chemin,
                                       nombre_factures, importe_par)
  values (v_lot, p_dossier_id, v_format, v_sha, v_taille::bigint, v_chemin, v_nombre, auth.uid());

  -- 6. Chaque facture, dans l'ordre du lot.
  for v_f in select e.valeur from jsonb_array_elements(p_factures) with ordinality as e(valeur, rang) order by e.rang loop
    v_rang := v_rang + 1;
    if jsonb_typeof(v_f) is distinct from 'object' then
      raise exception 'Rang % du lot : une facture se décrit par un objet.', v_rang using errcode = '22023';
    end if;
    v_f := jsonb_strip_nulls(v_f);
    select string_agg(k, ', ' order by k collate "C") into v_texte
      from jsonb_object_keys(v_f) k where not (k = any (v_cles_facture));
    if v_texte is not null then
      raise exception 'Rang % du lot : la facture porte des clés que l''import ne connaît pas : %.', v_rang, v_texte
        using errcode = '22023';
    end if;

    -- Le numéro (G1.05), unique au dossier.
    v_numero := v_f->>'numero';
    if jsonb_typeof(v_f->'numero') is distinct from 'string' or char_length(v_numero) > 35
       or v_numero !~ '^[-+_/A-Za-z0-9]( ?[-+_/A-Za-z0-9])*$' then
      raise exception 'Rang % du lot : le numéro se compose de 35 caractères au plus — lettres, chiffres, espace, « - + _ / » —, sans espace en tête, en fin ni doublé (DGFiP, annexe 7, G1.05).',
        v_rang using errcode = '22023';
    end if;
    if exists (select 1 from public.factures_emises f where f.dossier_id = p_dossier_id and f.numero = v_numero) then
      raise exception 'Rang % du lot : le numéro % est déjà celui d''une facture de ce dossier — un numéro ne se réemploie jamais.',
        v_rang, v_numero using errcode = '22023';
    end if;

    -- Le type ; un avoir cite la facture reprise qu'il crédite.
    v_type := v_f->>'type';
    if jsonb_typeof(v_f->'type') is distinct from 'string' or v_type not in ('facture', 'avoir') then
      raise exception 'La facture % (rang % du lot) : son type est « facture » ou « avoir ».', v_numero, v_rang
        using errcode = '22023';
    end if;

    -- La date (G1.36 : de 2000 à 2099), avant la date de reprise.
    v_texte := v_f->>'date_emission';
    if jsonb_typeof(v_f->'date_emission') is distinct from 'string' or v_texte !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'La facture % (rang % du lot) : sa date d''émission s''écrit AAAA-MM-JJ.', v_numero, v_rang
        using errcode = '22023';
    end if;
    begin
      v_date := v_texte::date;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise exception 'La facture % (rang % du lot) : sa date d''émission, « % », n''existe pas.', v_numero, v_rang, v_texte
        using errcode = '22023';
    end;
    if v_date < date '2000-01-01' or v_date > date '2099-12-31' then
      raise exception 'La facture % (rang % du lot) : sa date d''émission est de 2000 à 2099 (DGFiP, annexe 7, G1.36).',
        v_numero, v_rang using errcode = '22023';
    end if;
    if v_date >= v_reprise then
      raise exception 'La facture % (rang % du lot) est datée du %, la date de reprise ou après (le %) : l''application émet les factures d''après, une facture reprise se date d''avant.',
        v_numero, v_rang, to_char(v_date, 'DD/MM/YYYY'), to_char(v_reprise, 'DD/MM/YYYY') using errcode = '22023';
    end if;

    -- Un numéro de la forme de l'application continue sa série (`prochain_numero_facture` le lit) : sa lettre, son année,
    -- un compteur qu'elle sait lire, et une série que l'application n'a pas encore continuée — sous son verrou.
    if v_numero ~ '^[FA][0-9]{4}-[0-9]+$' then
      -- (Une expression CASE ne vit pas dans la condition d'un IF de PL/pgSQL, qui s'arrête à son premier THEN.)
      v_texte := case when v_type = 'avoir' then 'A' else 'F' end;
      if left(v_numero, 1) <> v_texte
         or substr(v_numero, 2, 4)::integer <> extract(year from v_date)::integer
         or char_length(split_part(v_numero, '-', 2)) > 9 then
        raise exception 'La facture % (rang % du lot) porte un numéro de la forme de l''application : sa lettre est celle de son type (F, A pour un avoir), son année celle de sa date, son compteur de neuf chiffres au plus.',
          v_numero, v_rang using errcode = '22023';
      end if;
      v_annee := substr(v_numero, 2, 4)::integer;
      insert into public.facture_numerotation (dossier_id, annee, type, dernier_numero)
      values (p_dossier_id, v_annee, v_type, 0)
      on conflict (dossier_id, annee, type) do nothing;
      perform 1 from public.facture_numerotation n
        where n.dossier_id = p_dossier_id and n.annee = v_annee and n.type = v_type for update;
      select f.numero into v_texte from public.factures_emises f
        where f.dossier_id = p_dossier_id and f.statut = 'validee'
          and split_part(f.numero, '-', 1) = split_part(v_numero, '-', 1)
        order by f.numero collate "C" limit 1;
      if v_texte is not null then
        raise exception 'La facture % (rang % du lot) reprendrait la série que l''application a déjà continuée (la facture %) : une facture reprise précède toujours celles de l''application.',
          v_numero, v_rang, v_texte using errcode = '22023';
      end if;
    end if;

    v_origine_id := null;
    if v_type = 'avoir' then
      if jsonb_typeof(v_f->'origine_numero') is distinct from 'string' then
        raise exception 'L''avoir % (rang % du lot) cite le numéro de la facture reprise qu''il crédite.', v_numero, v_rang
          using errcode = '22023';
      end if;
      select f.id, f.date_emission into v_origine_id, v_origine_date
        from public.factures_emises f
       where f.dossier_id = p_dossier_id and f.numero = v_f->>'origine_numero' and f.statut = 'importee' and f.type = 'facture';
      if v_origine_id is null then
        raise exception 'L''avoir % (rang % du lot) cite la facture « % », qui n''est pas une facture reprise de ce dossier (plus haut dans ce lot, ou d''un import d''avant).',
          v_numero, v_rang, v_f->>'origine_numero' using errcode = '22023';
      end if;
      if v_date < v_origine_date then
        raise exception 'L''avoir % (rang % du lot) précède la facture qu''il crédite (émise le %).', v_numero, v_rang,
          to_char(v_origine_date, 'DD/MM/YYYY') using errcode = '22023';
      end if;
    elsif v_f ? 'origine_numero' then
      raise exception 'La facture % (rang % du lot) : seul un avoir cite une facture d''origine.', v_numero, v_rang
        using errcode = '22023';
    end if;

    v_echeance := null;
    if v_f ? 'date_echeance' and jsonb_typeof(v_f->'date_echeance') is distinct from 'null' then
      v_texte := v_f->>'date_echeance';
      if jsonb_typeof(v_f->'date_echeance') is distinct from 'string' or v_texte !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'La facture % (rang % du lot) : sa date d''échéance s''écrit AAAA-MM-JJ.', v_numero, v_rang
          using errcode = '22023';
      end if;
      begin
        v_echeance := v_texte::date;
      exception when datetime_field_overflow or invalid_datetime_format then
        raise exception 'La facture % (rang % du lot) : sa date d''échéance, « % », n''existe pas.', v_numero, v_rang, v_texte
          using errcode = '22023';
      end;
      if v_echeance < v_date then
        raise exception 'La facture % (rang % du lot) : son échéance précède sa date d''émission.', v_numero, v_rang
          using errcode = '22023';
      end if;
    end if;

    -- Le client.
    v_tiers_nom := btrim(coalesce(v_f->>'tiers_nom', ''));
    if jsonb_typeof(v_f->'tiers_nom') is distinct from 'string' or v_tiers_nom = '' or char_length(v_tiers_nom) > 300 then
      raise exception 'La facture % (rang % du lot) : le nom de son client est à donner (300 caractères au plus).', v_numero, v_rang
        using errcode = '22023';
    end if;
    v_type_client := v_f->>'type_client';
    if jsonb_typeof(v_f->'type_client') is distinct from 'string'
       or v_type_client not in ('assujetti', 'organisme_public', 'non_assujetti', 'etranger') then
      raise exception 'La facture % (rang % du lot) : le type de son client est assujetti, organisme_public, non_assujetti ou etranger.',
        v_numero, v_rang using errcode = '22023';
    end if;
    v_siren := v_f->>'tiers_siren';
    v_siret := v_f->>'tiers_siret';
    if (v_f ? 'tiers_siren' and (jsonb_typeof(v_f->'tiers_siren') is distinct from 'string' or v_siren !~ '^[0-9]{9}$'))
       or (v_f ? 'tiers_siret' and (jsonb_typeof(v_f->'tiers_siret') is distinct from 'string' or v_siret !~ '^[0-9]{14}$'))
       or (v_siren is not null and v_siret is not null and left(v_siret, 9) <> v_siren) then
      raise exception 'La facture % (rang % du lot) : le SIREN de son client a neuf chiffres, son SIRET quatorze, qui commencent par le SIREN.',
        v_numero, v_rang using errcode = '22023';
    end if;
    if v_f ? 'tiers_adresse' and (jsonb_typeof(v_f->'tiers_adresse') is distinct from 'string'
                                  or char_length(v_f->>'tiers_adresse') > 1000) then
      raise exception 'La facture % (rang % du lot) : l''adresse de son client est un texte de 1 000 caractères au plus.', v_numero, v_rang
        using errcode = '22023';
    end if;

    -- La nature et l'option sur les débits (l'e-reporting de ses paiements la lit).
    v_nature := v_f->>'nature_operation';
    if jsonb_typeof(v_f->'nature_operation') is distinct from 'string' or v_nature not in ('biens', 'services', 'mixte') then
      raise exception 'La facture % (rang % du lot) : la nature de ses opérations est biens, services ou mixte.', v_numero, v_rang
        using errcode = '22023';
    end if;
    if jsonb_typeof(v_f->'option_debits') is distinct from 'boolean' then
      raise exception 'La facture % (rang % du lot) : elle dit si elle a été émise sous l''option pour le paiement de la TVA d''après les débits (oui ou non).',
        v_numero, v_rang using errcode = '22023';
    end if;

    -- Les montants déclarés.
    if jsonb_typeof(v_f->'montant_ht') is distinct from 'number' or jsonb_typeof(v_f->'montant_tva') is distinct from 'number'
       or jsonb_typeof(v_f->'montant_ttc') is distinct from 'number' then
      raise exception 'La facture % (rang % du lot) : ses montants hors taxe, de TVA et toutes taxes comprises sont des nombres.',
        v_numero, v_rang using errcode = '22023';
    end if;
    v_ht := (v_f->'montant_ht')::numeric;
    v_tva := (v_f->'montant_tva')::numeric;
    v_ttc := (v_f->'montant_ttc')::numeric;
    if v_ht <> round(v_ht, 2) or v_tva <> round(v_tva, 2) or v_ttc <> round(v_ttc, 2) or v_ttc <> v_ht + v_tva then
      raise exception 'La facture % (rang % du lot) : ses montants sont au centime, et son TTC est son HT plus sa TVA.', v_numero, v_rang
        using errcode = '22023';
    end if;
    if v_type = 'facture' and v_ttc <= 0 then
      raise exception 'La facture % (rang % du lot) porte un montant positif : un crédit se reprend par un avoir.', v_numero, v_rang
        using errcode = '22023';
    end if;
    if v_type = 'avoir' and v_ttc >= 0 then
      raise exception 'L''avoir % (rang % du lot) crédite un montant : son total est négatif.', v_numero, v_rang
        using errcode = '22023';
    end if;

    -- La transmission déclarée, la ligne du CSV, le fichier propre.
    v_transmise := v_f->>'transmise_par';
    if jsonb_typeof(v_f->'transmise_par') is distinct from 'string' or v_transmise not in ('papier', 'pdf', 'plateforme', 'inconnu') then
      raise exception 'La facture % (rang % du lot) : sa transmission est papier, pdf, plateforme ou inconnu.', v_numero, v_rang
        using errcode = '22023';
    end if;
    v_plateforme := nullif(btrim(coalesce(v_f->>'plateforme_nom', '')), '');
    if (v_transmise = 'plateforme') <> (v_plateforme is not null)
       or (v_f ? 'plateforme_nom' and jsonb_typeof(v_f->'plateforme_nom') is distinct from 'string')
       or char_length(v_plateforme) > 100 then
      raise exception 'La facture % (rang % du lot) : une facture transmise par une plateforme agréée la nomme (100 caractères au plus), et seule celle-là.',
        v_numero, v_rang using errcode = '22023';
    end if;
    v_ligne_csv := null;
    if v_f ? 'ligne_csv' then
      if jsonb_typeof(v_f->'ligne_csv') is distinct from 'number' then
        raise exception 'La facture % (rang % du lot) : sa ligne du CSV est un nombre entier, à partir de 1.', v_numero, v_rang
          using errcode = '22023';
      end if;
      v_q := (v_f->'ligne_csv')::numeric;
      if v_q <> trunc(v_q) or v_q < 1 or v_q > 1000000 then
        raise exception 'La facture % (rang % du lot) : sa ligne du CSV est un nombre entier, à partir de 1.', v_numero, v_rang
          using errcode = '22023';
      end if;
      v_ligne_csv := v_q::integer;
    end if;
    v_f_sha := v_f->>'fichier_sha256';
    v_f_chemin := v_f->>'fichier_chemin';
    if (v_f ? 'fichier_sha256') <> (v_f ? 'fichier_chemin')
       or (v_f ? 'fichier_sha256' and (jsonb_typeof(v_f->'fichier_sha256') is distinct from 'string' or v_f_sha !~ '^[0-9a-f]{64}$'
                                       or jsonb_typeof(v_f->'fichier_chemin') is distinct from 'string'
                                       or v_f_chemin !~ ('^' || p_dossier_id::text || '/imports/' || v_lot::text || '/[^/]{1,200}$'))) then
      raise exception 'La facture % (rang % du lot) : son fichier se dit par son empreinte SHA-256 et son chemin « <dossier>/imports/<lot>/<nom> », ensemble.',
        v_numero, v_rang using errcode = '22023';
    end if;

    -- La facture : ses colonnes énumérées, la marque de source posée (A8-Q1), annoncée à la garde.
    v_id := gen_random_uuid();
    perform set_config('jd.import_facture', v_id::text, true);
    insert into public.factures_emises (id, dossier_id, numero, statut, type, date_emission, date_echeance, tiers_nom,
                                        tiers_adresse, tiers_siren, tiers_siret, type_client, nature_operation,
                                        option_debits, montant_ht, montant_tva, montant_ttc, source_de_la_vente, created_by)
    values (v_id, p_dossier_id, v_numero, 'importee', v_type, v_date, v_echeance, v_tiers_nom, v_f->>'tiers_adresse',
            v_siren, v_siret, v_type_client, v_nature, (v_f->'option_debits')::boolean, v_ht, v_tva, v_ttc, true, auth.uid());

    -- Ses lignes : celles du fichier structuré, ou une par taux (sa base hors taxe), qui suffit au registre.
    if jsonb_typeof(v_f->'lignes') is distinct from 'array' then
      raise exception 'La facture % (rang % du lot) porte de une à cinq cents lignes.', v_numero, v_rang using errcode = '22023';
    end if;
    if jsonb_array_length(v_f->'lignes') not between 1 and 500 then
      raise exception 'La facture % (rang % du lot) porte de une à cinq cents lignes.', v_numero, v_rang using errcode = '22023';
    end if;
    v_ordre := 0;
    for v_l in select e.valeur from jsonb_array_elements(v_f->'lignes') with ordinality as e(valeur, rang) order by e.rang loop
      v_ordre := v_ordre + 1;
      if jsonb_typeof(v_l) is distinct from 'object' then
        raise exception 'La facture % (rang % du lot), ligne % : une ligne se décrit par un objet.', v_numero, v_rang, v_ordre
          using errcode = '22023';
      end if;
      select string_agg(k, ', ' order by k collate "C") into v_texte
        from jsonb_object_keys(v_l) k where not (k = any (v_cles_ligne));
      if v_texte is not null then
        raise exception 'La facture % (rang % du lot), ligne % : des clés que l''import ne connaît pas : %.', v_numero, v_rang,
          v_ordre, v_texte using errcode = '22023';
      end if;
      if jsonb_typeof(v_l->'designation') is distinct from 'string' or btrim(v_l->>'designation') = ''
         or char_length(v_l->>'designation') > 1000 then
        raise exception 'La facture % (rang % du lot), ligne % : sa désignation est à donner (1 000 caractères au plus).', v_numero,
          v_rang, v_ordre using errcode = '22023';
      end if;
      if jsonb_typeof(v_l->'quantite') is distinct from 'number' or jsonb_typeof(v_l->'prix_unitaire_ht') is distinct from 'number'
         or jsonb_typeof(v_l->'taux_tva') is distinct from 'number' then
        raise exception 'La facture % (rang % du lot), ligne % : sa quantité, son prix unitaire hors taxe et son taux de TVA sont des nombres.',
          v_numero, v_rang, v_ordre using errcode = '22023';
      end if;
      v_q := (v_l->'quantite')::numeric;
      v_p := (v_l->'prix_unitaire_ht')::numeric;
      v_t := (v_l->'taux_tva')::numeric;
      if v_q = 0 or abs(v_q) >= 1000000000 or v_p <> round(v_p, 6) or abs(v_p) >= 1000000000 then
        raise exception 'La facture % (rang % du lot), ligne % : sa quantité n''est pas nulle, son prix unitaire a six décimales au plus.',
          v_numero, v_rang, v_ordre using errcode = '22023';
      end if;
      if v_type = 'avoir' and v_q > 0 then
        raise exception 'L''avoir % (rang % du lot), ligne % : les lignes d''un avoir créditent, leurs quantités sont négatives.',
          v_numero, v_rang, v_ordre using errcode = '22023';
      end if;
      if not (v_t = any (v_taux_admis)) then
        raise exception 'La facture % (rang % du lot), ligne % : le taux de % %% n''est pas un taux de la TVA française.', v_numero,
          v_rang, v_ordre, v_t using errcode = '22023';
      end if;
      v_n := v_l->>'nature';
      if v_l ? 'nature' and (jsonb_typeof(v_l->'nature') is distinct from 'string' or v_n not in ('biens', 'services')
                             or (v_nature <> 'mixte' and v_n <> v_nature)) then
        raise exception 'La facture % (rang % du lot), ligne % : sa nature est biens ou services, celle de la facture quand elle n''est pas mixte.',
          v_numero, v_rang, v_ordre using errcode = '22023';
      end if;
      if v_nature = 'mixte' and v_n is null then
        raise exception 'La facture % (rang % du lot) mêle biens et services : chacune de ses lignes dit sa nature (ligne %).', v_numero,
          v_rang, v_ordre using errcode = '22023';
      end if;
      v_u := v_l->>'unite';
      if v_l ? 'unite' and (jsonb_typeof(v_l->'unite') is distinct from 'string'
                            or v_u not in ('C62', 'H87', 'HUR', 'DAY', 'WEE', 'MON', 'ANN', 'KGM', 'MTR', 'MTK', 'LTR', 'KMT', 'LS')) then
        raise exception 'La facture % (rang % du lot), ligne % : son unité est l''un des codes de l''application (C62, HUR, DAY…).', v_numero,
          v_rang, v_ordre using errcode = '22023';
      end if;
      insert into public.facture_lignes (facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva, nature, unite)
      values (v_id, v_ordre, btrim(v_l->>'designation'), v_q, v_p, v_t, v_n, v_u);
    end loop;

    -- Les montants recalculés de ses lignes : le HT au centime de chaque ligne ; la TVA par taux (base × taux, arrondie :
    -- EN 16931, BR-CO-17), ou, d'un ancien logiciel qui arrondissait ligne à ligne, la somme des TVA de ses lignes.
    select coalesce(sum(c.ht_centimes), 0), coalesce(sum(c.tva_centimes), 0) into v_ht_c, v_tva_lignes_c
      from public.facture_lignes fl
      cross join lateral public.centimes_ligne_facture(fl.quantite, fl.prix_unitaire_ht, fl.taux_tva, false) c
     where fl.facture_id = v_id;
    select coalesce(sum(round(t.ht * t.taux * 0.01)), 0)::bigint into v_tva_taux_c
      from (select fl.taux_tva as taux, sum(c.ht_centimes) as ht
              from public.facture_lignes fl
              cross join lateral public.centimes_ligne_facture(fl.quantite, fl.prix_unitaire_ht, fl.taux_tva, false) c
             where fl.facture_id = v_id group by fl.taux_tva) t;
    if v_ht_c <> round(v_ht * 100) then
      raise exception 'La facture % (rang % du lot) déclare % € hors taxe ; ses lignes en font % € (un écart de % €).', v_numero, v_rang,
        replace(to_char(v_ht, 'FM999999999990.00'), '.', ','), replace(to_char(v_ht_c / 100.0, 'FM999999999990.00'), '.', ','),
        replace(to_char(v_ht - v_ht_c / 100.0, 'FM999999999990.00'), '.', ',') using errcode = '22023';
    end if;
    v_par_taux := v_tva_taux_c = round(v_tva * 100);
    if not v_par_taux and v_tva_lignes_c <> round(v_tva * 100) then
      raise exception 'La facture % (rang % du lot) déclare % € de TVA ; ses lignes en font % € par taux (EN 16931, BR-CO-17), % € ligne à ligne.',
        v_numero, v_rang, replace(to_char(v_tva, 'FM999999999990.00'), '.', ','),
        replace(to_char(v_tva_taux_c / 100.0, 'FM999999999990.00'), '.', ','),
        replace(to_char(v_tva_lignes_c / 100.0, 'FM999999999990.00'), '.', ',') using errcode = '22023';
    end if;

    -- L'encaissé avant la reprise (A8-Q6), net des remboursements : par taux s'il est donné, au prorata des TTC de ses
    -- taux en repli, et la répartition le dit. Un avoir n'en porte pas (il s'impute sur sa facture). Les taux de la
    -- facture et leur TTC, de ses lignes, sous la règle de TVA que ses montants ont suivie.
    select coalesce(jsonb_agg(jsonb_build_object(
             'taux', t.taux,
             'ttc', (t.ht + case when v_par_taux then round(t.ht * t.taux * 0.01) else t.tva end) / 100.0) order by t.taux), '[]')
      into v_taux_ttc
      from (select fl.taux_tva as taux, sum(c.ht_centimes) as ht, sum(c.tva_centimes) as tva
              from public.facture_lignes fl
              cross join lateral public.centimes_ligne_facture(fl.quantite, fl.prix_unitaire_ht, fl.taux_tva, false) c
             where fl.facture_id = v_id group by fl.taux_tva) t;
    select count(*), coalesce(sum((e->>'ttc')::numeric), 0), coalesce(bool_or((e->>'ttc')::numeric < 0), false)
      into v_nb_taux, v_total_ttc, v_ttc_negatif
      from jsonb_array_elements(v_taux_ttc) e;
    v_encaisse := 0;
    if v_f ? 'encaisse_avant_reprise' then
      if jsonb_typeof(v_f->'encaisse_avant_reprise') is distinct from 'number' then
        raise exception 'La facture % (rang % du lot) : ce qui en était encaissé avant la reprise est un nombre.', v_numero, v_rang
          using errcode = '22023';
      end if;
      v_encaisse := (v_f->'encaisse_avant_reprise')::numeric;
    end if;
    if v_encaisse <> round(v_encaisse, 2) or v_encaisse < 0 or (v_type = 'facture' and v_encaisse > v_ttc)
       or (v_type = 'avoir' and (v_encaisse <> 0 or v_f ? 'encaisse_par_taux')) then
      raise exception 'La facture % (rang % du lot) : ce qui en était encaissé avant la reprise est au centime, de zéro à son TTC (% €) ; un avoir n''en porte pas, il s''impute sur sa facture.',
        v_numero, v_rang, replace(to_char(v_ttc, 'FM999999999990.00'), '.', ',') using errcode = '22023';
    end if;
    v_au_prorata := false;
    if v_f ? 'encaisse_par_taux' then
      -- Donné par taux : chacun des taux de la facture, une fois, de zéro à son TTC, la somme égale à l'encaissé.
      if jsonb_typeof(v_f->'encaisse_par_taux') is distinct from 'array' then
        raise exception 'La facture % (rang % du lot) : l''encaissé par taux est une liste de {taux, encaisse}.', v_numero, v_rang
          using errcode = '22023';
      end if;
      if exists (select 1 from jsonb_array_elements(v_f->'encaisse_par_taux') g where jsonb_typeof(g) is distinct from 'object') then
        raise exception 'La facture % (rang % du lot) : l''encaissé par taux est une liste de {taux, encaisse}.', v_numero, v_rang
          using errcode = '22023';
      end if;
      if exists (select 1 from jsonb_array_elements(v_f->'encaisse_par_taux') g
                  where jsonb_typeof(g->'taux') is distinct from 'number' or jsonb_typeof(g->'encaisse') is distinct from 'number'
                     or exists (select 1 from jsonb_object_keys(g) k where k not in ('taux', 'encaisse'))) then
        raise exception 'La facture % (rang % du lot) : l''encaissé par taux est une liste de {taux, encaisse}, deux nombres.', v_numero, v_rang
          using errcode = '22023';
      end if;
      select coalesce(jsonb_agg(jsonb_build_object('taux', (t->>'taux')::numeric, 'encaisse', (g->>'encaisse')::numeric)
                                order by (t->>'taux')::numeric), '[]')
        into v_repartition
        from jsonb_array_elements(v_taux_ttc) t
        join jsonb_array_elements(v_f->'encaisse_par_taux') g on (g->>'taux')::numeric = (t->>'taux')::numeric;
      if jsonb_array_length(v_f->'encaisse_par_taux') <> v_nb_taux
         or (select count(distinct (g->>'taux')::numeric) from jsonb_array_elements(v_f->'encaisse_par_taux') g) <> v_nb_taux
         or jsonb_array_length(v_repartition) <> v_nb_taux
         or exists (select 1 from jsonb_array_elements(v_repartition) r
                      join jsonb_array_elements(v_taux_ttc) t on (t->>'taux')::numeric = (r->>'taux')::numeric
                     where (r->>'encaisse')::numeric <> round((r->>'encaisse')::numeric, 2) or (r->>'encaisse')::numeric < 0
                        or (r->>'encaisse')::numeric > greatest((t->>'ttc')::numeric, 0))
         or (select coalesce(sum((r->>'encaisse')::numeric), 0) from jsonb_array_elements(v_repartition) r) <> v_encaisse then
        raise exception 'La facture % (rang % du lot) : l''encaissé par taux donne, pour chacun de ses taux et une fois, de zéro à son TTC, et sa somme est l''encaissé avant la reprise (% €).',
          v_numero, v_rang, replace(to_char(v_encaisse, 'FM999999999990.00'), '.', ',') using errcode = '22023';
      end if;
    elsif v_encaisse = 0 or (v_encaisse = v_total_ttc and not v_ttc_negatif) then
      -- Rien, ou tout : la répartition est exacte.
      select coalesce(jsonb_agg(jsonb_build_object('taux', (t->>'taux')::numeric,
                                                   'encaisse', case when v_encaisse = 0 then 0 else (t->>'ttc')::numeric end)
                                order by (t->>'taux')::numeric), '[]')
        into v_repartition
        from jsonb_array_elements(v_taux_ttc) t;
    else
      -- Le repli : au prorata des TTC de ses taux, au centime, le reste d'arrondi sur le taux le plus haut.
      if v_ttc_negatif then
        raise exception 'La facture % (rang % du lot) a un taux dont le TTC est négatif : l''encaissé avant la reprise se donne par taux.',
          v_numero, v_rang using errcode = '22023';
      end if;
      with t as (select (e->>'taux')::numeric as taux, (e->>'ttc')::numeric as ttc from jsonb_array_elements(v_taux_ttc) e),
           p as (select t.taux, t.ttc,
                        case when t.taux = (select max(m.taux) from t m) then null
                             else round(v_encaisse * t.ttc / v_total_ttc, 2) end as part
                   from t)
      select jsonb_agg(jsonb_build_object('taux', p.taux,
                                          'encaisse', coalesce(p.part, v_encaisse - (select coalesce(sum(q.part), 0) from p q)))
                       order by p.taux)
        into v_repartition
        from p;
      if exists (select 1 from jsonb_array_elements(v_repartition) r
                   join jsonb_array_elements(v_taux_ttc) t on (t->>'taux')::numeric = (r->>'taux')::numeric
                  where (r->>'encaisse')::numeric < 0 or (r->>'encaisse')::numeric > (t->>'ttc')::numeric) then
        raise exception 'La facture % (rang % du lot) : l''encaissé avant la reprise ne se répartit pas au centime entre ses taux : le donner par taux.',
          v_numero, v_rang using errcode = '22023';
      end if;
      v_au_prorata := v_nb_taux > 1;
    end if;

    insert into public.factures_importees (facture_id, dossier_id, import_id, rang, ligne_csv, fichier_sha256, fichier_chemin,
                                           encaisse_avant_reprise, encaisse_par_taux, encaisse_au_prorata, transmise_par,
                                           plateforme_nom, origine_id)
    values (v_id, p_dossier_id, v_lot, v_rang, v_ligne_csv, v_f_sha, v_f_chemin, v_encaisse, coalesce(v_repartition, '[]'),
            v_au_prorata, v_transmise, v_plateforme, v_origine_id);
  end loop;
  perform set_config('jd.import_facture', '', true);

  -- 7. Les avoirs repris ne créditent pas plus que leur facture ne porte, et l'encaissé avant la reprise tient dans ce
  -- qui reste : pour chaque facture du lot, et chaque facture d'avant qu'un avoir du lot crédite.
  for v_r in
    select f.numero, f.montant_ttc, o.encaisse_avant_reprise as encaisse,
           coalesce((select sum(-a.montant_ttc) from public.factures_importees ai
                       join public.factures_emises a on a.id = ai.facture_id
                      where ai.origine_id = f.id), 0) as credite
      from public.factures_importees o
      join public.factures_emises f on f.id = o.facture_id
     where f.type = 'facture'
       and (o.import_id = v_lot
            or o.facture_id in (select x.origine_id from public.factures_importees x where x.import_id = v_lot))
     order by f.numero collate "C"
  loop
    if v_r.credite > v_r.montant_ttc then
      raise exception 'Les avoirs repris de la facture % la créditent de % € : elle n''en porte que %.', v_r.numero,
        replace(to_char(v_r.credite, 'FM999999999990.00'), '.', ','),
        replace(to_char(v_r.montant_ttc, 'FM999999999990.00'), '.', ',') using errcode = '22023';
    end if;
    v_reste := v_r.montant_ttc - v_r.credite;
    if v_r.encaisse > v_reste then
      raise exception 'La facture % : son encaissé avant la reprise (% €) dépasse ce qui reste à encaisser, ses avoirs repris déduits (% €).',
        v_r.numero, replace(to_char(v_r.encaisse, 'FM999999999990.00'), '.', ','),
        replace(to_char(v_reste, 'FM999999999990.00'), '.', ',') using errcode = '22023';
    end if;
  end loop;
  perform set_config('jd.import_lot', '', true);
  return v_lot;
end
$$;

comment on function public.importer_factures(uuid, jsonb, jsonb) is
  'La porte unique des factures reprises de l''ancien logiciel (A8a), tout ou rien : l''accès (le cabinet du dossier, 42501) avant toute lecture ; refusée en comptabilité d''engagement (A8-Q3) ; la bascule et la date de reprise exigées (A8-Q2) ; le lot (format, fichier) ; chaque facture nommée par son rang, ses clés énumérées : numéro (G1.05, unique au dossier, la forme de l''application tenue), type, date (avant la reprise, G1.36), client, nature, option sur les débits, lignes et montants (le HT de ses lignes, la TVA par taux ou ligne à ligne, l''écart chiffré), encaissé avant la reprise par taux ou au prorata (A8-Q6), transmission, fichier ; un avoir repris cite une facture reprise du dossier et ne crédite pas plus qu''elle ne porte. Refus en 22023. Rend l''identifiant du lot.';

-- ══ 8. LE RETRAIT D'UN LOT ══════════

create function public.retirer_import(p_dossier_id uuid, p_import_id uuid) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_texte text;
  v_texte2 text;
  v_nombre integer;
  v_factures integer;
begin
  if p_dossier_id is null or not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform 1 from public.dossiers d where d.id = p_dossier_id for update;
  perform 1 from public.imports_factures l where l.id = p_import_id and l.dossier_id = p_dossier_id for update;
  if not found then
    raise exception 'Cet import de factures n''existe pas dans ce dossier.' using errcode = '22023';
  end if;
  -- Ce qui s'y rattache le retient : un encaissement, un avoir de l'application ou d'un autre import, une facture que
  -- l'application a validée dans une série qu'il continue (retirer un numéro déjà suivi creuserait un trou).
  select f.numero into v_texte
    from public.factures_importees fi
    join public.factures_emises f on f.id = fi.facture_id
   where fi.import_id = p_import_id
     and exists (select 1 from public.encaissements_factures e where e.facture_id = f.id)
   order by f.numero collate "C" limit 1;
  if v_texte is not null then
    raise exception 'La facture reprise % a un encaissement : son import ne se retire plus.', v_texte using errcode = '23514';
  end if;
  select f.numero, a.numero into v_texte, v_texte2
    from public.factures_importees fi
    join public.factures_emises f on f.id = fi.facture_id
    join public.factures_emises a on a.facture_origine_id = f.id
   where fi.import_id = p_import_id
   order by f.numero collate "C", a.numero collate "C" limit 1;
  if v_texte is not null then
    raise exception 'La facture reprise % a un avoir de l''application (%) : son import ne se retire plus.', v_texte, v_texte2
      using errcode = '23514';
  end if;
  select f.numero, a.numero into v_texte, v_texte2
    from public.factures_importees fi
    join public.factures_emises f on f.id = fi.facture_id
    join public.factures_importees ai on ai.origine_id = f.id and ai.import_id <> p_import_id
    join public.factures_emises a on a.id = ai.facture_id
   where fi.import_id = p_import_id
   order by f.numero collate "C", a.numero collate "C" limit 1;
  if v_texte is not null then
    raise exception 'La facture reprise % est créditée par l''avoir repris %, d''un autre import : celui-ci se retire d''abord.', v_texte,
      v_texte2 using errcode = '23514';
  end if;
  select f.numero, v.numero into v_texte, v_texte2
    from public.factures_importees fi
    join public.factures_emises f on f.id = fi.facture_id
    join public.factures_emises v on v.dossier_id = f.dossier_id and v.statut = 'validee'
                                 and split_part(v.numero, '-', 1) = split_part(f.numero, '-', 1)
   where fi.import_id = p_import_id and f.numero ~ '^[FA][0-9]{4}-[0-9]+$'
   order by f.numero collate "C", v.numero collate "C" limit 1;
  if v_texte is not null then
    raise exception 'L''application a continué la série de la facture reprise % (la facture %) : son import ne se retire plus, il y creuserait un trou.',
      v_texte, v_texte2 using errcode = '23514';
  end if;
  -- Les avoirs d'abord, puis les factures qu'ils créditent : la clé de l'avoir vers sa facture (`origine_id`, sans action)
  -- ne voit jamais une facture partie avant son avoir.
  perform set_config('jd.retrait_import', p_import_id::text, true);
  delete from public.factures_emises f
   where f.type = 'avoir'
     and f.id in (select fi.facture_id from public.factures_importees fi where fi.import_id = p_import_id);
  get diagnostics v_nombre = row_count;
  delete from public.factures_emises f
   where f.id in (select fi.facture_id from public.factures_importees fi where fi.import_id = p_import_id);
  get diagnostics v_factures = row_count;
  v_nombre := v_nombre + v_factures;
  delete from public.imports_factures l where l.id = p_import_id;
  perform set_config('jd.retrait_import', '', true);
  return v_nombre;
end
$$;

comment on function public.retirer_import(uuid, uuid) is
  'Retire un import de factures reprises EN ENTIER (A8a) : ses factures, leurs lignes, le lot. L''accès (le cabinet du dossier, 42501) ; refusé (23514) dès qu''une de ses factures a un encaissement, un avoir de l''application ou d''un autre import, ou que l''application a validé une facture dans une série qu''il continue. Rend le nombre de factures retirées.';

-- ══ 9. LES DROITS DES FONCTIONS ══════════

revoke all on function public.importer_factures(uuid, jsonb, jsonb) from public, anon, service_role;
grant execute on function public.importer_factures(uuid, jsonb, jsonb) to authenticated;
revoke all on function public.retirer_import(uuid, uuid) from public, anon, service_role;
grant execute on function public.retirer_import(uuid, uuid) to authenticated;
revoke all on function public.fixer_reprise_des_factures(uuid, date) from public, anon, service_role;
grant execute on function public.fixer_reprise_des_factures(uuid, date) to authenticated;
revoke all on function public.garder_reprise_des_factures() from public, anon, authenticated, service_role;
revoke all on function public.garder_imports_factures() from public, anon, authenticated, service_role;
revoke all on function public.garder_factures_reprises() from public, anon, authenticated, service_role;
revoke all on function public.garder_lignes_des_factures_reprises() from public, anon, authenticated, service_role;

-- ══ GARDE DE FIN ══════════

do $fin$
begin
  -- Les gardes des factures, dans l'ordre des noms : celle d'hier, celle des mentions à la validation (JJ-Q4 et A7C-Q1,
  -- `adresse_du_client_exigee`, en production depuis le 08/11/2026), puis celle des reprises, avant la marque d'acompte et
  -- la source de la vente. (Corrigé le 10/11/2026 : la liste du 07/11/2026 ignorait le déclencheur de JJ-Q4, appliqué
  -- après la préparation de cette migration, et sa garde de fin la refusait sur la production du jour.)
  if (select string_agg(t.tgname, ',' order by t.tgname collate "C")
        from pg_trigger t
       where t.tgrelid = 'public.factures_emises'::regclass and not t.tgisinternal and t.tgname like 'factures_emises_%'
         and (t.tgtype & 2) = 2)
     is distinct from 'factures_emises_figees,factures_emises_figees_mentions,factures_emises_figees_reprises,factures_emises_marque_d_acompte,factures_emises_source_de_la_vente' then
    raise exception 'Les déclencheurs AVANT de factures_emises ne sont pas dans l''ordre attendu.';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.imports_factures'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.factures_importees'::regclass) then
    raise exception 'La RLS des tables des factures reprises n''est pas active.';
  end if;
  if exists (select 1 from pg_policy p
              where p.polrelid in ('public.imports_factures'::regclass, 'public.factures_importees'::regclass,
                                   'public.factures_emises'::regclass)
                and p.polroles <> array[to_regrole('authenticated')]::oid[]) then
    raise exception 'Une policy des factures vise un autre rôle que authenticated.';
  end if;
  if (select count(*) from pg_policy p
       where p.polrelid in ('public.imports_factures'::regclass, 'public.factures_importees'::regclass)
         and p.polpermissive and p.polcmd in ('w', 'd', '*')) <> 0 then
    raise exception 'Une policy des tables des factures reprises ouvre une modification ou une suppression.';
  end if;
end
$fin$;

-- Fin de la migration factures_importees.
