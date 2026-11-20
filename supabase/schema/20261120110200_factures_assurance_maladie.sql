-- LE FACTURÉ À L'ASSURANCE MALADIE, TIRÉ DES BORDEREAUX DE TÉLÉTRANSMISSION (conception 59, lot BOR3 ; la décision du
-- cabinet du 16/11/2026 : « on récupère que les chiffres et on stocke pas de données patients ») — PRÉPARÉE le 19/11/2026,
-- PAS APPLIQUÉE. Le récit : HISTORIQUE.md, « 19/11/2026 — BOR3 : LE FACTURÉ À L'ASSURANCE MALADIE, EN BASE (PRÉPARÉE, PAS
-- APPLIQUÉE) » ; la conception : docs/conceptions/59-facture-a-l-assurance-maladie-bordereaux.md, § 4.2, § 13.3 et § 14 ;
-- l'essai : supabase/essais/facturesAssuranceMaladie.sql ; le retour :
-- supabase/preparees/retour/20261119140100_retour_factures_assurance_maladie.sql ; le module qui redit ses refus avant le
-- clic : src/lib/importDuFactureAssuranceMaladie.ts (`FACTURES_ASSURANCE_MALADIE_PREVUES`). Le patron : les paiements de
-- l'assurance maladie (NOE3, supabase/preparees/20261116191000_paiements_assurance_maladie.sql).
--
-- LA RÈGLE. Le bordereau se lit dans le navigateur de celui qui importe — le praticien depuis son espace client, sous sa case
-- « Banque », ou le cabinet du dossier (BOR-Q8 (A) ; BORQ8-Q1 (A) : sur place, jamais par e-mail) — et n'en sortent que des
-- AGRÉGATS (lib/factureAssuranceMaladie.ts, BOR2) : par jour (la date de CRÉATION du lot, BOR-Q4 (A)), organisme et part, le
-- facturé en centimes, le nombre de lots et le nombre de factures de ces lots (un ordre de grandeur, BOR2-Q1 (A)). La part
-- obligatoire est rangée sous son régime et sa caisse ; la part complémentaire sous un organisme complémentaire « non dit »
-- (BORQ5-Q1 (A)) — la colonne qui le nommera est là, un entier, nulle tant que l'état lu ne le dit pas (BOR-Q5 (B)). Rien
-- d'autre : ni nom, ni NIR, ni date de naissance, ni acte, ni numéro de facture, ni date de prescription, ni libellé, ni le
-- fichier ou son empreinte. AUCUNE COLONNE DE TEXTE LIBRE : des dates, des entiers, une part d'une liste fermée, et deux
-- colonnes d'octets (l'empreinte et la clé, ci-dessous).
--
-- LE NUMÉRO DU LOT (BOR1-Q1 (C), puis BOR1Q1-Q1 (A)). Pour refuser un lot importé deux fois, la base ne garde PAS le numéro :
-- il arrive en paramètre de la fonction d'import, qui en calcule une EMPREINTE — un HMAC-SHA-256 (pgcrypto) sous une clé
-- secrète propre au dossier, tirée par la base au premier import —, la compare au registre, la garde, et oublie le numéro. Il
-- ne s'écrit dans aucune table, aucun refus, aucun avis. L'empreinte porte le numéro, la date de création et le code de la
-- caisse destinataire : rien n'établit qu'un numéro de lot de Télévitale ne recommence jamais (une réinstallation, un
-- changement de poste), ni qu'il soit unique d'une caisse à l'autre un même jour. Elle ne rend pas la donnée anonyme (la
-- base, qui a la clé, peut recalculer l'empreinte d'un numéro donné) : c'est une donnée pseudonymisée (RGPD, art. 4, 5°),
-- que seule la fonction d'import lit.
--   LA CLÉ ET LE REGISTRE NE SE LISENT PAR AUCUN RÔLE DE L'API : RLS active, aucune policy permissive, ni pour le cabinet, ni
--   pour le client, ni pour la restauration — comme `connexions_plateformes` : leur lecture rend zéro ligne. La sauvegarde
--   d'un dossier, qui lit les tables sous la session du cabinet, n'en porte donc rien (la conception, § 13.3, voulait la clé
--   dans la sauvegarde : elle y serait lisible par le cabinet, et une empreinte d'un numéro de quelques milliers de valeurs
--   se renverse avec sa clé ; écarté, BOR3-Q1). Le prix : un import RESTAURÉ n'a plus le registre de ses lots. La fonction
--   d'import le reconnaît (un import sans aucun lot au registre n'a pu être écrit que par la restauration) et refuse tout lot
--   dont la date de création tombe dans sa période, tant qu'il n'est pas retiré : un lot n'est jamais compté deux fois en
--   silence.
--
-- LE FACTURÉ NE COMPTE NULLE PART : ni 2035, ni CA3, ni estimation, ni alerte du chiffre d'affaires, ni FEC, ni association
-- au relevé. C'est un contrôle (« ce que l'assurance maladie doit », BOR5), qu'un exercice validé ne fige donc pas : un lot de
-- décembre est payé en janvier, et le contrôle de l'année suivante en a besoin (BOR3-Q2).
--
-- CE QU'ELLE POSE.
--   1. `imports_factures_assurance_maladie` : un import — son dossier, la première et la dernière date de création de ses
--      lots, le nombre de ses lots et de leurs factures, qui et quand (posés par la base). `factures_assurance_maladie` : les
--      totaux que l'import a apportés, sous une clé TOTALE (dossier, import, date, part, régime, caisse, organisme
--      complémentaire ; `nulls not distinct`) ; ils se somment à la lecture, le registre empêchant qu'un lot compte deux
--      fois. `lots_teletransmission_importes` : le registre, une empreinte par lot importé, unique dans le dossier.
--      `cles_des_lots_teletransmission` : la clé du dossier, une par dossier. Aucune mise à jour, pour personne : un import
--      se retire et se refait ; la clé ne change jamais (toutes les empreintes du dossier en dépendent).
--   2. `refus_de_l_import_des_factures_assurance_maladie(import, jour)` : le refus, en mots, d'un import, ou nul ; ne lit rien
--      en base ; aucun rôle de l'API ne l'exécute.
--   3. `importer_factures_assurance_maladie(dossier, import)`, aux droits du propriétaire, TOUT OU RIEN, pour le cabinet du
--      dossier (`admin_du_dossier`) ou un accès « Banque » de ce dossier (`client_du_dossier(…, 'banque')`) ; il rend l'import
--      écrit.
--   4. `retirer_import_factures_assurance_maladie(import)`, aux mêmes droits : l'import, ses totaux et les empreintes de ses
--      lots partent ensemble ; il rend l'import retiré.
--   5. Les policies, toutes à `authenticated` : le cabinet du dossier lit les imports et les totaux ; un accès « Banque » les
--      lit dans son dossier ; le super-administrateur les insère (la restauration). Le registre et la clé : aucune. Aucune
--      policy de mise à jour ni de suppression. LA LECTURE DU CLIENT ET SES DEUX GESTES SE PRÉSENTENT AU CABINET AVANT D'ÊTRE
--      APPLIQUÉS (CLAUDE.md, « Trois domaines font exception » : la vue de la banque) — la fiche « BOR3-migration ».
--   6. La restrictive `deux_facteurs` de la double authentification sur les quatre tables, si sa migration est déjà en base.
--   7. `garder_factures_assurance_maladie`, avant la RLS, AUX DROITS DE L'APPELANT (comme la garde de NOE3 : elle n'appelle
--      donc pas la porte `_acces_avant_les_gardes`) : un import, un total, une empreinte ne s'écrivent que par l'import (le
--      réglage `jd.factures_assurance_maladie` porte l'identifiant de l'import en cours) — l'import et ses totaux aussi par
--      la restauration (le super-administrateur), jamais une empreinte ; la clé, que par l'import (le réglage
--      `jd.cle_des_lots_teletransmission` porte le dossier) ; rien ne se modifie ; un import, ses totaux et ses empreintes ne
--      partent que par son retrait, avec lui, ou avec leur dossier ; la clé, qu'avec son dossier — aussi pour le rôle des Edge
--      Functions, qui passe la RLS. Un total et une empreinte sont du dossier de leur import.
--
-- POURQUOI « BANQUE ». BOR-Q8 (A) : « le praticien et le cabinet, comme NOEMIE » — le praticien sous la case qui ouvre déjà ses
-- crédits du relevé et ses paiements de l'assurance maladie (NOE3). Un total facturé apprend au client ce que son logiciel de
-- télétransmission lui dit déjà, agrégé.
--
-- LES REFUS, DANS L'ORDRE (que src/lib/importDuFactureAssuranceMaladie.ts redit avant le clic, sous les mêmes mots) :
--   - l'appelant qui n'est ni le cabinet du dossier ni un accès « Banque » de ce dossier (42501 ; au retrait, l'import inconnu
--     aussi, sous les mêmes mots : rien n'apprend qu'il existe) ;
--   - puis, sous le verrou du facturé du dossier, à l'import : sa forme ; le nombre de ses lots et de ses totaux ; chaque lot
--     (mal formé, créé à venir) ; deux lots de même empreinte ; chaque total (mal formé) ; deux totaux de même clé ; des
--     totaux qui ne se tiennent pas avec les lots (22023) ; un lot déjà importé, nommé par son rang dans l'envoi et le jour de
--     l'import qui l'a apporté, jamais par son numéro (22023) ; un lot dont la date tombe dans la période d'un import restauré
--     (22023).
--
-- CE QU'ELLE NE CHANGE PAS : aucune fonction d'hier n'est remplacée (`client_du_dossier`, `admin_du_dossier` et
-- `is_super_admin` sont appelées, jamais réécrites) ; ni `memberships`, ni les paiements de l'assurance maladie (NOE3, NOE5),
-- ni aucun moteur. Elle se colle avant, entre ou après `paiements_assurance_maladie` et
-- `association_paiements_assurance_maladie`, et avant ou après `trois_cases_de_l_acces` (B1, qui réécrit `client_du_dossier` :
-- la garde de tête n'exige de lui que de lire « banque » sur `droit_banque`) et `deux_facteurs_exiges`. Aucune ligne écrite
-- d'avance. Le retrait d'un import est une suppression DANS LE CORPS d'une fonction : l'outil d'application la retient — le
-- cabinet la colle dans l'éditeur SQL, avec sa ligne d'historique (CLAUDE.md).
--
-- VERSION PROVISOIRE, HORS DE L'EXPORT : le fichier entre dans `supabase/schema/` le jour de son application, sous la version
-- que porte sa ligne d'historique, texte inchangé ; `FACTURES_ASSURANCE_MALADIE_PREVUES`
-- (src/lib/importDuFactureAssuranceMaladie.ts) se lève alors, et les quatre tables entrent au plan de sauvegarde. Ni barre
-- oblique inverse, ni retour chariot.

-- ══ 0. La garde de tête ══════════
-- Elle refuse une seconde application ; une fonction appelée qui ne serait plus celle que cette migration suppose — à
-- l'empreinte de son corps, les retours chariot d'un collage écartés ; un `client_du_dossier` qui ne lirait plus « banque »
-- sur `droit_banque` ; une base où manquerait une colonne qu'elle lit ; et une base sans les deux fonctions de pgcrypto
-- qu'elle appelle (le schéma `extensions` de Supabase).
do $garde$
declare
  v_attendue record;
  v_nombre integer;
  v_empreinte text;
begin
  if to_regclass('public.imports_factures_assurance_maladie') is not null or to_regclass('public.factures_assurance_maladie') is not null
     or to_regclass('public.lots_teletransmission_importes') is not null or to_regclass('public.cles_des_lots_teletransmission') is not null
     or exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                 and p.proname in ('importer_factures_assurance_maladie', 'retirer_import_factures_assurance_maladie',
                                   'refus_de_l_import_des_factures_assurance_maladie', 'garder_factures_assurance_maladie')) then
    raise exception 'La migration factures_assurance_maladie est déjà en base : elle ne s''applique pas deux fois.';
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
  select count(*) into v_nombre from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'client_du_dossier';
  if v_nombre <> 1
     or strpos(replace(coalesce((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.client_du_dossier(uuid,text)')), ''), chr(13), ''),
               'when ''banque'' then m.droit_banque') = 0 then
    raise exception 'La fonction public.client_du_dossier(uuid,text) ne lit plus « banque » sur droit_banque : la relire avant d''appliquer cette migration.';
  end if;
  select count(*) into v_nombre from pg_attribute a
   where not a.attisdropped
     and ((a.attrelid = 'public.memberships'::regclass and a.attname in ('user_id', 'dossier_id', 'droit_banque'))
       or (a.attrelid = 'public.dossiers'::regclass and a.attname = 'id'));
  if v_nombre <> 4 then
    raise exception 'Une colonne que cette migration lit manque (% sur 4) : appliquer d''abord droits_des_acces_clients.', v_nombre;
  end if;
  if to_regprocedure('extensions.hmac(bytea, bytea, text)') is null or to_regprocedure('extensions.gen_random_bytes(integer)') is null
     or not has_function_privilege(current_user, 'extensions.hmac(bytea, bytea, text)', 'execute')
     or not has_function_privilege(current_user, 'extensions.gen_random_bytes(integer)', 'execute') then
    raise exception 'Les fonctions hmac et gen_random_bytes de pgcrypto (schéma extensions) manquent, ou le propriétaire ne les exécute pas : l''empreinte des lots ne se calculerait pas.';
  end if;
end
$garde$;

-- ══ 1. Les tables ══════════
-- L'auteur sans clé étrangère vers son compte : retirer le compte d'un membre parti ne doit pas effacer qui a importé (le
-- patron de NOE3).
create table public.imports_factures_assurance_maladie (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  premier_lot_le date not null,
  dernier_lot_le date not null,
  nombre_de_lots integer not null,
  nombre_de_factures integer not null,
  importe_par uuid not null,
  importe_le timestamptz not null default now(),
  constraint imports_factures_assurance_maladie_periode check (premier_lot_le >= date '1990-01-01' and premier_lot_le <= dernier_lot_le),
  constraint imports_factures_assurance_maladie_comptes check (
    nombre_de_lots between 1 and 2000 and nombre_de_factures between nombre_de_lots and 100000000)
);

create index imports_factures_assurance_maladie_dossier on public.imports_factures_assurance_maladie (dossier_id, importe_le);

create table public.factures_assurance_maladie (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  import_id uuid not null references public.imports_factures_assurance_maladie (id) on delete cascade,
  date_creation_lot date not null,
  part text not null,
  regime smallint,
  caisse smallint,
  organisme_complementaire bigint,
  montant_centimes bigint not null,
  nombre_de_lots integer not null,
  nombre_de_factures integer not null,
  constraint factures_assurance_maladie_part check (part in ('obligatoire', 'complementaire')),
  -- La part obligatoire sous son régime et sa caisse ; la part complémentaire sans eux, sous son organisme complémentaire
  -- en chiffres, ou nul : « non dit » (BORQ5-Q1 (A)).
  constraint factures_assurance_maladie_organisme check (
    (part = 'obligatoire' and regime between 0 and 99 and caisse between 0 and 999 and organisme_complementaire is null)
    or (part = 'complementaire' and regime is null and caisse is null
        and (organisme_complementaire is null or organisme_complementaire between 1 and 9999999999))),
  constraint factures_assurance_maladie_date check (date_creation_lot >= date '1990-01-01'),
  -- Signé : un lot d'avoirs se facture en négatif ; deux lots d'un même jour peuvent s'annuler.
  constraint factures_assurance_maladie_montant check (montant_centimes > -100000000000000 and montant_centimes < 100000000000000),
  constraint factures_assurance_maladie_comptes check (
    nombre_de_lots between 1 and 2000 and nombre_de_factures between nombre_de_lots and 100000000),
  constraint factures_assurance_maladie_une_cle unique nulls not distinct
    (dossier_id, import_id, date_creation_lot, part, regime, caisse, organisme_complementaire)
);

create index factures_assurance_maladie_import on public.factures_assurance_maladie (import_id);
create index factures_assurance_maladie_dossier on public.factures_assurance_maladie (dossier_id, date_creation_lot);

create table public.lots_teletransmission_importes (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  import_id uuid not null references public.imports_factures_assurance_maladie (id) on delete cascade,
  empreinte bytea not null,
  constraint lots_teletransmission_importes_empreinte check (octet_length(empreinte) = 32),
  constraint lots_teletransmission_importes_une_empreinte unique (dossier_id, empreinte)
);

create index lots_teletransmission_importes_import on public.lots_teletransmission_importes (import_id);

create table public.cles_des_lots_teletransmission (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  cle bytea not null,
  constraint cles_des_lots_teletransmission_longueur check (octet_length(cle) = 32),
  constraint cles_des_lots_teletransmission_une_par_dossier unique (dossier_id)
);

comment on table public.imports_factures_assurance_maladie is
  'Les imports du facturé à l''assurance maladie d''un dossier (conception 59, BOR3) : la période de création de leurs lots, le nombre des lots et de leurs factures, qui et quand. Écrits par importer_factures_assurance_maladie, retirés par retirer_import_factures_assurance_maladie ; aucune colonne de texte, aucune donnée de patient.';
comment on table public.factures_assurance_maladie is
  'Le facturé à l''assurance maladie qu''un import a apporté : un total par date de création des lots, part et organisme, en centimes. Aucune colonne de texte, aucune donnée de patient ; ne compte dans aucun moteur : un contrôle (ce que l''assurance maladie doit).';
comment on table public.lots_teletransmission_importes is
  'Le registre des lots de télétransmission importés : une empreinte HMAC-SHA-256 par lot (le numéro, la date de création, la caisse) sous la clé du dossier, jamais le numéro. Aucune policy : lu et écrit par importer_factures_assurance_maladie seule.';
comment on table public.cles_des_lots_teletransmission is
  'La clé secrète d''un dossier sous laquelle se calculent les empreintes de ses lots de télétransmission, tirée par la base au premier import. Aucune policy, hors de la sauvegarde d''un dossier : lue par importer_factures_assurance_maladie seule ; ne change jamais.';
comment on column public.imports_factures_assurance_maladie.nombre_de_factures is
  'La somme des factures que ses lots annoncent : un ordre de grandeur (BOR2-Q1 (A)).';
comment on column public.imports_factures_assurance_maladie.importe_par is
  'Le compte qui a importé (auth.uid()), sans clé étrangère : il survit au retrait du compte.';
comment on column public.factures_assurance_maladie.date_creation_lot is
  'La date de création des lots (l''en-tête du bordereau), jamais une date de prescription ni de soins (BOR-Q4 (A)).';
comment on column public.factures_assurance_maladie.organisme_complementaire is
  'L''organisme complémentaire de la part complémentaire, en chiffres ; nul : « non dit » (le bordereau de télétransmission n''en imprime aucun, BORQ5-Q1 (A)).';
comment on column public.factures_assurance_maladie.montant_centimes is
  'Le facturé de la part sous cette clé, en centimes, signé.';
comment on column public.factures_assurance_maladie.nombre_de_factures is
  'Les factures des lots qui y contribuent : un ordre de grandeur, pas le compte des lignes dont la part est non nulle (BOR2-Q1 (A)).';

alter table public.imports_factures_assurance_maladie enable row level security;
alter table public.factures_assurance_maladie enable row level security;
alter table public.lots_teletransmission_importes enable row level security;
alter table public.cles_des_lots_teletransmission enable row level security;

create policy imports_factures_assurance_maladie_lecture on public.imports_factures_assurance_maladie
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy imports_factures_assurance_maladie_lecture_banque on public.imports_factures_assurance_maladie
  for select to authenticated using (client_du_dossier(dossier_id, 'banque'));
create policy imports_factures_assurance_maladie_restauration on public.imports_factures_assurance_maladie
  for insert to authenticated with check (is_super_admin());
create policy factures_assurance_maladie_lecture on public.factures_assurance_maladie
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy factures_assurance_maladie_lecture_banque on public.factures_assurance_maladie
  for select to authenticated using (client_du_dossier(dossier_id, 'banque'));
create policy factures_assurance_maladie_restauration on public.factures_assurance_maladie
  for insert to authenticated with check (is_super_admin());

-- ══ 1 bis. La garde ══════════
-- Avant la RLS, aux droits de l'appelant. Le retrait d'un total ou d'une empreinte n'est admis que par le retrait de son
-- import (le réglage), après son import (la cascade : l'import n'est déjà plus là) ou après son dossier (la cascade : le
-- dossier n'est déjà plus là) ; celui de la clé, qu'après son dossier. Un total et une empreinte s'écrivent dans le dossier de
-- leur import : l'import se lit sous la RLS de l'appelant, que seuls la fonction d'import (le propriétaire) et le
-- super-administrateur (qui lit tout) atteignent ici. Chaque branche lit NEW ou OLD selon l'opération, jamais l'autre.
create function public.garder_factures_assurance_maladie() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_import uuid;
begin
  if tg_op = 'UPDATE' then
    raise exception 'Le facturé à l''assurance maladie ne se modifie pas : son import se retire et se refait.'
      using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    if tg_table_name = 'cles_des_lots_teletransmission' then
      if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
        return old;
      end if;
      raise exception 'La clé des lots d''un dossier ne part qu''avec son dossier.' using errcode = '23514';
    end if;
    if tg_table_name = 'imports_factures_assurance_maladie' then
      v_import := old.id;
    else
      v_import := old.import_id;
    end if;
    if coalesce(current_setting('jd.factures_assurance_maladie', true), '') = v_import::text
       or not exists (select 1 from public.dossiers d where d.id = old.dossier_id)
       or (tg_table_name <> 'imports_factures_assurance_maladie'
           and not exists (select 1 from public.imports_factures_assurance_maladie i where i.id = v_import)) then
      return old;
    end if;
    raise exception 'Le facturé à l''assurance maladie ne part qu''avec son import, par son retrait, ou avec son dossier.'
      using errcode = '23514';
  end if;
  if tg_table_name = 'cles_des_lots_teletransmission' then
    if coalesce(current_setting('jd.cle_des_lots_teletransmission', true), '') <> new.dossier_id::text then
      raise exception 'La clé des lots d''un dossier ne s''écrit que par l''import du facturé.' using errcode = '42501';
    end if;
    return new;
  end if;
  if tg_table_name = 'imports_factures_assurance_maladie' then
    v_import := new.id;
  else
    v_import := new.import_id;
  end if;
  if coalesce(current_setting('jd.factures_assurance_maladie', true), '') <> v_import::text
     and (tg_table_name = 'lots_teletransmission_importes' or not public.is_super_admin()) then
    raise exception 'Le facturé à l''assurance maladie ne s''écrit que par son import.' using errcode = '42501';
  end if;
  if tg_table_name <> 'imports_factures_assurance_maladie'
     and not exists (select 1 from public.imports_factures_assurance_maladie i where i.id = v_import and i.dossier_id = new.dossier_id) then
    raise exception 'Le facturé à l''assurance maladie s''écrit dans le dossier de son import.' using errcode = '23514';
  end if;
  return new;
end
$$;

comment on function public.garder_factures_assurance_maladie() is
  'La garde des quatre tables du facturé à l''assurance maladie (BOR3) : un import, un total, une empreinte ne s''écrivent que par importer_factures_assurance_maladie (jd.factures_assurance_maladie) — l''import et ses totaux aussi par la restauration du super-administrateur, jamais une empreinte — (42501), dans le dossier de leur import (23514) ; la clé, que par l''import (jd.cle_des_lots_teletransmission, 42501) ; rien ne se modifie (23514) ; un import, ses totaux et ses empreintes ne partent que par son retrait, avec lui ou avec leur dossier, la clé qu''avec son dossier (23514).';

create trigger imports_factures_assurance_maladie_garde
  before insert or update or delete on public.imports_factures_assurance_maladie
  for each row execute function public.garder_factures_assurance_maladie();
create trigger factures_assurance_maladie_garde
  before insert or update or delete on public.factures_assurance_maladie
  for each row execute function public.garder_factures_assurance_maladie();
create trigger lots_teletransmission_importes_garde
  before insert or update or delete on public.lots_teletransmission_importes
  for each row execute function public.garder_factures_assurance_maladie();
create trigger cles_des_lots_teletransmission_garde
  before insert or update or delete on public.cles_des_lots_teletransmission
  for each row execute function public.garder_factures_assurance_maladie();

-- ══ 2. L'import : sa forme ══════════
-- Le refus, en mots, d'un import, ou nul s'il est bien formé pour ce jour. Chaque test lit ce qu'un test d'avant a établi :
-- un IF par étape, jamais un OR qui supposerait un ordre d'évaluation pour une conversion. Un entier se juge sur sa valeur
-- numérique (une fraction, un exposant qui en ferait une, se refusent) et ses bornes AVANT toute conversion ; deux écritures
-- d'un même entier (7 et 7.0) sont le même entier. Aucun refus ne cite une valeur de l'import.
create function public.refus_de_l_import_des_factures_assurance_maladie(p_import jsonb, p_jour date) returns text
  language plpgsql
  immutable
  set search_path = public
as $$
declare
  c_forme constant text := 'L''import du facturé n''est pas dans la forme que la base connaît (version 1).';
  c_nombre constant text := 'Un import du facturé porte de 1 à 2 000 lots et au plus 5 000 totaux.';
  c_lot constant text := 'Un lot de l''import est mal formé : un numéro de 1 à 999 999 999, une date de création, une caisse de trois chiffres au plus et un nombre de factures de 1 à 10 000.';
  c_a_venir constant text := 'Un lot de l''import porte une date de création à venir.';
  c_doublon_lot constant text := 'L''import porte deux fois le même lot : un même numéro, une même date de création et une même caisse.';
  c_total constant text := 'Un total de l''import est mal formé : une date de création, une part de la liste, son organisme (le régime et la caisse pour la part obligatoire ; rien, ou l''organisme complémentaire en chiffres, pour la part complémentaire), un montant en centimes entiers, un nombre de lots et un nombre de factures.';
  c_doublon_total constant text := 'L''import porte deux fois le même total : une même date de création, une même part et un même organisme.';
  c_coherence constant text := 'Les totaux de l''import ne se tiennent pas avec ses lots : chacun porte la date de création d''un lot (et, pour la part obligatoire, la caisse de ce lot), et ne compte pas plus de lots ni de factures que ces lots n''en portent.';
  c_plafond constant numeric := 100000000000000;
  v_lots jsonb;
  v_totaux jsonb;
  v_element jsonb;
  v_texte text;
  v_date date;
  v_part text;
  v_numero numeric;
  v_caisse numeric;
  v_regime numeric;
  v_organisme numeric;
  v_montant numeric;
  v_nombre_lots numeric;
  v_factures numeric;
  i integer;
begin
  if p_jour is null then
    return c_a_venir;
  end if;
  -- 1. La forme : un objet, ses trois clés, la version 1, une liste de lots, une liste de totaux.
  if jsonb_typeof(p_import) is distinct from 'object' then
    return c_forme;
  end if;
  if (select array_agg(k order by k collate "C") from jsonb_object_keys(p_import) k)
       is distinct from array['agregats', 'lots', 'version'] then
    return c_forme;
  end if;
  if (p_import -> 'version') is distinct from '1'::jsonb or jsonb_typeof(p_import -> 'lots') is distinct from 'array'
     or jsonb_typeof(p_import -> 'agregats') is distinct from 'array' then
    return c_forme;
  end if;

  -- 2. Le nombre des lots et des totaux.
  v_lots := p_import -> 'lots';
  v_totaux := p_import -> 'agregats';
  if jsonb_array_length(v_lots) < 1 or jsonb_array_length(v_lots) > 2000 or jsonb_array_length(v_totaux) > 5000 then
    return c_nombre;
  end if;

  -- 3. Chaque lot : sa forme, sa date.
  for i in 0 .. jsonb_array_length(v_lots) - 1 loop
    v_element := v_lots -> i;
    if jsonb_typeof(v_element) is distinct from 'object' then
      return c_lot;
    end if;
    if (select array_agg(k order by k collate "C") from jsonb_object_keys(v_element) k)
         is distinct from array['caisse', 'cree_le', 'nombre_de_factures', 'numero'] then
      return c_lot;
    end if;
    if jsonb_typeof(v_element -> 'numero') is distinct from 'number'
       or jsonb_typeof(v_element -> 'cree_le') is distinct from 'string'
       or jsonb_typeof(v_element -> 'caisse') is distinct from 'number'
       or jsonb_typeof(v_element -> 'nombre_de_factures') is distinct from 'number' then
      return c_lot;
    end if;
    v_texte := v_element ->> 'cree_le';
    if v_texte !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      return c_lot;
    end if;
    begin
      v_date := v_texte::date;
    exception when others then
      return c_lot;
    end;
    if v_date < date '1990-01-01' then
      return c_lot;
    end if;
    v_numero := (v_element ->> 'numero')::numeric;
    v_caisse := (v_element ->> 'caisse')::numeric;
    v_factures := (v_element ->> 'nombre_de_factures')::numeric;
    if v_numero <> trunc(v_numero) or v_numero < 1 or v_numero > 999999999
       or v_caisse <> trunc(v_caisse) or v_caisse < 0 or v_caisse > 999
       or v_factures <> trunc(v_factures) or v_factures < 1 or v_factures > 10000 then
      return c_lot;
    end if;
    if v_date > p_jour then
      return c_a_venir;
    end if;
  end loop;

  -- 4. Deux lots de même empreinte : le numéro, la date de création, la caisse.
  if exists (
      select 1 from jsonb_array_elements(v_lots) e
       group by (e ->> 'numero')::numeric, (e ->> 'cree_le')::date, (e ->> 'caisse')::numeric
      having count(*) > 1) then
    return c_doublon_lot;
  end if;

  -- 5. Chaque total : sa forme, son organisme selon sa part, ses montants et ses comptes.
  for i in 0 .. jsonb_array_length(v_totaux) - 1 loop
    v_element := v_totaux -> i;
    if jsonb_typeof(v_element) is distinct from 'object' then
      return c_total;
    end if;
    if (select array_agg(k order by k collate "C") from jsonb_object_keys(v_element) k)
         is distinct from array['caisse', 'date_creation_lot', 'montant_centimes', 'nombre_de_factures', 'nombre_de_lots',
                                'organisme_complementaire', 'part', 'regime'] then
      return c_total;
    end if;
    if jsonb_typeof(v_element -> 'date_creation_lot') is distinct from 'string'
       or jsonb_typeof(v_element -> 'part') is distinct from 'string'
       or jsonb_typeof(v_element -> 'regime') not in ('null', 'number')
       or jsonb_typeof(v_element -> 'caisse') not in ('null', 'number')
       or jsonb_typeof(v_element -> 'organisme_complementaire') not in ('null', 'number')
       or jsonb_typeof(v_element -> 'montant_centimes') is distinct from 'number'
       or jsonb_typeof(v_element -> 'nombre_de_lots') is distinct from 'number'
       or jsonb_typeof(v_element -> 'nombre_de_factures') is distinct from 'number' then
      return c_total;
    end if;
    v_texte := v_element ->> 'date_creation_lot';
    if v_texte !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      return c_total;
    end if;
    begin
      v_date := v_texte::date;
    exception when others then
      return c_total;
    end;
    if v_date < date '1990-01-01' then
      return c_total;
    end if;
    v_part := v_element ->> 'part';
    if v_part not in ('obligatoire', 'complementaire') then
      return c_total;
    end if;
    v_regime := (v_element ->> 'regime')::numeric;
    v_caisse := (v_element ->> 'caisse')::numeric;
    v_organisme := (v_element ->> 'organisme_complementaire')::numeric;
    if v_part = 'obligatoire'
       and (v_regime is null or v_regime <> trunc(v_regime) or v_regime < 0 or v_regime > 99
            or v_caisse is null or v_caisse <> trunc(v_caisse) or v_caisse < 0 or v_caisse > 999
            or v_organisme is not null) then
      return c_total;
    end if;
    if v_part = 'complementaire'
       and (v_regime is not null or v_caisse is not null
            or (v_organisme is not null and (v_organisme <> trunc(v_organisme) or v_organisme < 1 or v_organisme > 9999999999))) then
      return c_total;
    end if;
    v_montant := (v_element ->> 'montant_centimes')::numeric;
    v_nombre_lots := (v_element ->> 'nombre_de_lots')::numeric;
    v_factures := (v_element ->> 'nombre_de_factures')::numeric;
    if v_montant <> trunc(v_montant) or abs(v_montant) >= c_plafond
       or v_nombre_lots <> trunc(v_nombre_lots) or v_nombre_lots < 1 or v_nombre_lots > 2000
       or v_factures <> trunc(v_factures) or v_factures < v_nombre_lots or v_factures > 100000000 then
      return c_total;
    end if;
  end loop;

  -- 6. Deux totaux de même clé (la date, la part, l'organisme ; deux organismes non dits se heurtent).
  if exists (
      select 1 from jsonb_array_elements(v_totaux) e
       group by (e ->> 'date_creation_lot')::date, e ->> 'part', (e ->> 'regime')::numeric, (e ->> 'caisse')::numeric,
                (e ->> 'organisme_complementaire')::numeric
      having count(*) > 1) then
    return c_doublon_total;
  end if;

  -- 7. Les totaux et les lots : chaque total porte la date d'un lot (et, pour la part obligatoire, la caisse d'un lot de ce
  -- jour) ; par jour et par caisse (la part obligatoire), par jour (la part complémentaire), les totaux ne comptent pas plus
  -- de lots ni de factures que les lots de l'import n'en portent.
  if exists (
      select 1 from jsonb_array_elements(v_totaux) t
       where not exists (
         select 1 from jsonb_array_elements(v_lots) l
          where (l ->> 'cree_le')::date = (t ->> 'date_creation_lot')::date
            and (t ->> 'part' = 'complementaire' or (l ->> 'caisse')::numeric = (t ->> 'caisse')::numeric))) then
    return c_coherence;
  end if;
  if exists (
      select 1
        from (select (t ->> 'date_creation_lot')::date as jour, (t ->> 'caisse')::numeric as caisse,
                     sum((t ->> 'nombre_de_lots')::numeric) as lots, sum((t ->> 'nombre_de_factures')::numeric) as factures
                from jsonb_array_elements(v_totaux) t
               where t ->> 'part' = 'obligatoire'
               group by 1, 2) g
       where g.lots > (select count(*) from jsonb_array_elements(v_lots) l
                        where (l ->> 'cree_le')::date = g.jour and (l ->> 'caisse')::numeric = g.caisse)
          or g.factures > (select coalesce(sum((l ->> 'nombre_de_factures')::numeric), 0) from jsonb_array_elements(v_lots) l
                            where (l ->> 'cree_le')::date = g.jour and (l ->> 'caisse')::numeric = g.caisse)) then
    return c_coherence;
  end if;
  if exists (
      select 1
        from (select (t ->> 'date_creation_lot')::date as jour,
                     sum((t ->> 'nombre_de_lots')::numeric) as lots, sum((t ->> 'nombre_de_factures')::numeric) as factures
                from jsonb_array_elements(v_totaux) t
               where t ->> 'part' = 'complementaire'
               group by 1) g
       where g.lots > (select count(*) from jsonb_array_elements(v_lots) l where (l ->> 'cree_le')::date = g.jour)
          or g.factures > (select coalesce(sum((l ->> 'nombre_de_factures')::numeric), 0) from jsonb_array_elements(v_lots) l
                            where (l ->> 'cree_le')::date = g.jour)) then
    return c_coherence;
  end if;
  return null;
end
$$;

comment on function public.refus_de_l_import_des_factures_assurance_maladie(jsonb, date) is
  'Le refus, en mots, d''un import du facturé à l''assurance maladie (BOR3) pour le jour donné, ou nul s''il est bien formé : sa forme (version 1, trois clés), le nombre de ses lots et de ses totaux, chaque lot (quatre clés, une date de création qui n''est pas à venir), deux lots de même empreinte, chaque total (huit clés, son organisme selon sa part, des centimes entiers, ses comptes), deux totaux de même clé, des totaux qui ne se tiennent pas avec les lots. N''écrit rien ; aucun rôle de l''API ne l''exécute.';

-- ══ 3. Importer ══════════
-- D'UN SEUL TENANT, sous un verrou du facturé du dossier (deux imports ne se croisent pas). Le jour est celui de Paris, lu
-- par la base. L'empreinte d'un lot : HMAC-SHA-256 de « lot:<numéro>:<date de création>:<caisse> » — les entiers écrits
-- sans zéro ni décimale, la date en AAAA-MM-JJ — sous la clé du dossier, tirée au premier import. Le numéro ne sort de cette
-- fonction que dans l'empreinte.
create function public.importer_factures_assurance_maladie(p_dossier_id uuid, p_import jsonb)
  returns public.imports_factures_assurance_maladie
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_jour date := (now() at time zone 'Europe/Paris')::date;
  v_refus text;
  v_cle bytea;
  v_rang integer;
  v_le date;
  v_restaure date;
  v_import public.imports_factures_assurance_maladie;
begin
  if p_dossier_id is null
     or not (public.admin_du_dossier(p_dossier_id) or public.client_du_dossier(p_dossier_id, 'banque')) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('factures_assurance_maladie:' || p_dossier_id::text, 0));
  v_refus := public.refus_de_l_import_des_factures_assurance_maladie(p_import, v_jour);
  if v_refus is not null then
    raise exception '%', v_refus using errcode = '22023';
  end if;

  -- La clé du dossier : lue, ou tirée au premier import.
  select c.cle into v_cle from public.cles_des_lots_teletransmission c where c.dossier_id = p_dossier_id;
  if v_cle is null then
    perform set_config('jd.cle_des_lots_teletransmission', p_dossier_id::text, true);
    insert into public.cles_des_lots_teletransmission (dossier_id, cle)
    values (p_dossier_id, extensions.gen_random_bytes(32))
    returning cle into v_cle;
    perform set_config('jd.cle_des_lots_teletransmission', '', true);
  end if;

  -- Un lot déjà au registre : le premier dans l'ordre de l'envoi, nommé par son rang et le jour (à Paris) de l'import qui
  -- l'a apporté.
  select e.rang, (i.importe_le at time zone 'Europe/Paris')::date into v_rang, v_le
    from (select x.rang::integer as rang,
                 extensions.hmac(convert_to('lot:' || ((x.lot ->> 'numero')::numeric)::bigint::text || ':'
                                            || to_char((x.lot ->> 'cree_le')::date, 'YYYY-MM-DD') || ':'
                                            || ((x.lot ->> 'caisse')::numeric)::integer::text, 'UTF8'), v_cle, 'sha256') as empreinte
            from jsonb_array_elements(p_import -> 'lots') with ordinality as x(lot, rang)) e
    join public.lots_teletransmission_importes r on r.dossier_id = p_dossier_id and r.empreinte = e.empreinte
    join public.imports_factures_assurance_maladie i on i.id = r.import_id
   order by e.rang
   limit 1;
  if v_rang is not null then
    raise exception 'Le bordereau % de l''envoi a déjà été importé le % : un lot ne s''importe pas deux fois.',
      v_rang, to_char(v_le, 'DD/MM/YYYY') using errcode = '22023';
  end if;

  -- Un import restauré n'a plus le registre de ses lots : tout lot créé dans sa période se refuse tant qu'il est là.
  select min((x ->> 'cree_le')::date) into v_restaure
    from jsonb_array_elements(p_import -> 'lots') x
   where exists (select 1 from public.imports_factures_assurance_maladie i
                  where i.dossier_id = p_dossier_id
                    and (x ->> 'cree_le')::date between i.premier_lot_le and i.dernier_lot_le
                    and not exists (select 1 from public.lots_teletransmission_importes r where r.import_id = i.id));
  if v_restaure is not null then
    raise exception 'Un import restauré, dont la sauvegarde ne porte pas le registre des lots, couvre le % : le retirer d''abord, puis réimporter ses bordereaux.',
      to_char(v_restaure, 'DD/MM/YYYY') using errcode = '22023';
  end if;

  v_import.id := gen_random_uuid();
  perform set_config('jd.factures_assurance_maladie', v_import.id::text, true);
  insert into public.imports_factures_assurance_maladie (id, dossier_id, premier_lot_le, dernier_lot_le, nombre_de_lots,
                                                         nombre_de_factures, importe_par)
  select v_import.id, p_dossier_id, min((x ->> 'cree_le')::date), max((x ->> 'cree_le')::date), count(*),
         sum((x ->> 'nombre_de_factures')::numeric)::integer, auth.uid()
    from jsonb_array_elements(p_import -> 'lots') x
  returning * into v_import;

  insert into public.factures_assurance_maladie (dossier_id, import_id, date_creation_lot, part, regime, caisse,
                                                 organisme_complementaire, montant_centimes, nombre_de_lots, nombre_de_factures)
  select p_dossier_id, v_import.id, (t ->> 'date_creation_lot')::date, t ->> 'part', (t ->> 'regime')::numeric::smallint,
         (t ->> 'caisse')::numeric::smallint, (t ->> 'organisme_complementaire')::numeric::bigint,
         (t ->> 'montant_centimes')::numeric::bigint, (t ->> 'nombre_de_lots')::numeric::integer,
         (t ->> 'nombre_de_factures')::numeric::integer
    from jsonb_array_elements(p_import -> 'agregats') t;

  insert into public.lots_teletransmission_importes (dossier_id, import_id, empreinte)
  select p_dossier_id, v_import.id,
         extensions.hmac(convert_to('lot:' || ((x ->> 'numero')::numeric)::bigint::text || ':'
                                    || to_char((x ->> 'cree_le')::date, 'YYYY-MM-DD') || ':'
                                    || ((x ->> 'caisse')::numeric)::integer::text, 'UTF8'), v_cle, 'sha256')
    from jsonb_array_elements(p_import -> 'lots') x;
  perform set_config('jd.factures_assurance_maladie', '', true);
  return v_import;
end;
$$;

comment on function public.importer_factures_assurance_maladie(uuid, jsonb) is
  'Importe le facturé à l''assurance maladie d''un dossier (BOR3), tout ou rien : des totaux sans patient et les lots qui les portent (version 1), le jour de Paris ; chaque lot gardé par son empreinte HMAC sous la clé du dossier, jamais par son numéro ; un lot déjà importé, ou créé dans la période d''un import restauré, refuse l''import. Au cabinet du dossier ou à un accès « Banque » de ce dossier (42501) ; rend l''import écrit.';

-- ══ 4. Retirer un import ══════════
-- L'import, ses totaux et les empreintes de ses lots partent ensemble (les clés étrangères en cascade). Un exercice validé
-- ne le retient pas : le facturé ne compte dans aucun moteur.
create function public.retirer_import_factures_assurance_maladie(p_import_id uuid) returns public.imports_factures_assurance_maladie
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_import public.imports_factures_assurance_maladie;
begin
  select i.* into v_import from public.imports_factures_assurance_maladie i where i.id = p_import_id;
  if v_import.id is null
     or not (public.admin_du_dossier(v_import.dossier_id) or public.client_du_dossier(v_import.dossier_id, 'banque')) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('factures_assurance_maladie:' || v_import.dossier_id::text, 0));
  perform set_config('jd.factures_assurance_maladie', p_import_id::text, true);
  delete from public.imports_factures_assurance_maladie i where i.id = p_import_id returning i.* into v_import;
  perform set_config('jd.factures_assurance_maladie', '', true);
  return v_import;
end;
$$;

comment on function public.retirer_import_factures_assurance_maladie(uuid) is
  'Retire un import du facturé à l''assurance maladie (BOR3), ses totaux et les empreintes de ses lots : ses bordereaux se réimportent ensuite. Au cabinet du dossier ou à un accès « Banque » de ce dossier (42501, aussi pour un import inconnu) ; rend l''import retiré.';

-- ══ 5. Les droits d'exécution ══════════
revoke execute on function public.importer_factures_assurance_maladie(uuid, jsonb) from public, anon;
grant execute on function public.importer_factures_assurance_maladie(uuid, jsonb) to authenticated;
revoke execute on function public.retirer_import_factures_assurance_maladie(uuid) from public, anon;
grant execute on function public.retirer_import_factures_assurance_maladie(uuid) to authenticated;
revoke execute on function public.refus_de_l_import_des_factures_assurance_maladie(jsonb, date) from public, anon, authenticated;
revoke execute on function public.garder_factures_assurance_maladie() from public, anon, authenticated;

-- ══ 6. La double authentification exigée (C7, second temps), si elle est déjà en base ══════════
-- Appliquée avant `deux_facteurs_exiges`, ce bloc ne fait rien et sa boucle pose la restrictive sur les tables ; après, il
-- la pose ici, à l'expression exacte (deuxFacteursDesTablesNeuves.test.ts), sur les quatre — le registre et la clé
-- compris, que nulle policy permissive n'ouvre.
do $deux_facteurs$
declare
  t text;
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    foreach t in array array['imports_factures_assurance_maladie', 'factures_assurance_maladie', 'lots_teletransmission_importes',
                             'cles_des_lots_teletransmission'] loop
      execute format('create policy deux_facteurs on public.%I as restrictive for all to authenticated '
        || 'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))', t);
    end loop;
  end if;
end
$deux_facteurs$;

-- ══ 7. La garde de fin ══════════
-- Ce que la migration a posé, relu au catalogue : la RLS active sur les quatre tables ; trois policies permissives à
-- authenticated seul sur les imports et sur les totaux, aucune sur le registre ni sur la clé ; aucune colonne de texte hors
-- de la part ; la garde avant chaque écriture des quatre ; les deux fonctions de l'API aux droits du propriétaire et le chemin
-- fixé, ni l'anonyme ni PUBLIC ne les exécutent ; la fonction du refus et la garde à aucun connecté ; et aucune ligne.
do $fin$
declare
  v_table text;
begin
  foreach v_table in array array['imports_factures_assurance_maladie', 'factures_assurance_maladie', 'lots_teletransmission_importes',
                                 'cles_des_lots_teletransmission'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = ('public.' || v_table)::regclass) then
      raise exception 'La table % n''a pas sa RLS.', v_table;
    end if;
  end loop;
  foreach v_table in array array['imports_factures_assurance_maladie', 'factures_assurance_maladie'] loop
    if (select count(*) from pg_policy p where p.polrelid = ('public.' || v_table)::regclass and p.polpermissive
          and p.polroles = array[to_regrole('authenticated')::oid]) <> 3
       or (select count(*) from pg_policy p where p.polrelid = ('public.' || v_table)::regclass and p.polpermissive) <> 3
       or exists (select 1 from pg_policy p where p.polrelid = ('public.' || v_table)::regclass and p.polpermissive
                   and p.polcmd not in ('r', 'a')) then
      raise exception 'La table % ne porte pas ses trois policies permissives (deux lectures, l''insertion de restauration) à authenticated seul.', v_table;
    end if;
  end loop;
  if exists (select 1 from pg_policy p
              where p.polrelid in ('public.lots_teletransmission_importes'::regclass, 'public.cles_des_lots_teletransmission'::regclass)
                and p.polpermissive) then
    raise exception 'Le registre des lots ou la clé du dossier porte une policy permissive : aucun rôle de l''API ne doit les lire.';
  end if;
  if exists (select 1 from pg_attribute a
              where a.attrelid in ('public.imports_factures_assurance_maladie'::regclass, 'public.factures_assurance_maladie'::regclass,
                                   'public.lots_teletransmission_importes'::regclass, 'public.cles_des_lots_teletransmission'::regclass)
                and a.attnum > 0 and not a.attisdropped
                and a.atttypid in ('text'::regtype, 'varchar'::regtype, 'bpchar'::regtype, 'json'::regtype, 'jsonb'::regtype)
                and not (a.attrelid = 'public.factures_assurance_maladie'::regclass and a.attname = 'part')) then
    raise exception 'Une table du facturé à l''assurance maladie porte une colonne de texte libre.';
  end if;
  if (select count(*) from pg_proc p
       where p.oid in ('public.importer_factures_assurance_maladie(uuid, jsonb)'::regprocedure,
                       'public.retirer_import_factures_assurance_maladie(uuid)'::regprocedure)
         and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
         and not has_function_privilege('anon', p.oid, 'execute')
         and has_function_privilege('authenticated', p.oid, 'execute')
         and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)) <> 2
     or has_function_privilege('authenticated', 'public.refus_de_l_import_des_factures_assurance_maladie(jsonb, date)', 'execute')
     or has_function_privilege('anon', 'public.refus_de_l_import_des_factures_assurance_maladie(jsonb, date)', 'execute') then
    raise exception 'Les droits d''exécution des fonctions du facturé à l''assurance maladie ne sont pas ceux que la migration pose.';
  end if;
  if (select count(*) from pg_trigger t
       where t.tgrelid in ('public.imports_factures_assurance_maladie'::regclass, 'public.factures_assurance_maladie'::regclass,
                           'public.lots_teletransmission_importes'::regclass, 'public.cles_des_lots_teletransmission'::regclass)
         and not t.tgisinternal and t.tgfoid = 'public.garder_factures_assurance_maladie()'::regprocedure and t.tgtype = 31) <> 4
     or has_function_privilege('authenticated', 'public.garder_factures_assurance_maladie()', 'execute') then
    raise exception 'La garde du facturé à l''assurance maladie manque, ou un connecté l''exécute.';
  end if;
  if exists (select 1 from public.imports_factures_assurance_maladie) or exists (select 1 from public.factures_assurance_maladie)
     or exists (select 1 from public.lots_teletransmission_importes) or exists (select 1 from public.cles_des_lots_teletransmission) then
    raise exception 'Les tables du facturé à l''assurance maladie portent une ligne : rien ne s''écrit d''avance.';
  end if;
end
$fin$;
