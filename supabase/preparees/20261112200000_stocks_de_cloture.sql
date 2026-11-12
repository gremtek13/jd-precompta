-- LIA2 : LES STOCKS DE CLÔTURE (ligne 36 de la feuille de route) — PRÉPARÉE le 12/11/2026, PAS APPLIQUÉE.
-- La conception : docs/conceptions/37-liasse-2033.md, § 4.2 et § 4.5 à 4.9, § 5 ; LIA-Q2 et LIA-Q3, non tranchées, suivies
-- à leur recommandation. Le récit : HISTORIQUE.md, « 12/11/2026 — LIA2 : LES STOCKS DE CLÔTURE, EN MODULE ET EN BASE
-- (LIGNE 36) ». L'essai : supabase/essais/stocks.sql (réplique seulement) ; puis rls.sql (le bloc ST). Le retour :
-- supabase/preparees/retour/20261112200100_retour_stocks_de_cloture.sql. L'application : src/lib/stocks.ts
-- (`STOCKS_PREVUS`, baissé), qui compose ce que la base recompose ici.
--
-- Rien ne se détruit : une table, une colonne nullable, deux contraintes sur des lignes qui n'existent pas encore, dix rôles
-- au catalogue, deux gardes et deux fonctions s'ajoutent. Elle se COLLE (la fonction qui réécrit un stock retire d'abord
-- ses écritures : le mot de la suppression retient l'outil), avec sa ligne d'historique.
--
-- CE QU'ELLE FAIT.
-- 1. `stocks_de_cloture` : par dossier, exercice et compte de stock, la valeur HORS TAXES de l'inventaire physique au 31
--    décembre (notice 2033-NOT-SD, cases 050 et 060), sa méthode (coût moyen pondéré, premier entré premier sorti, coût
--    spécifique) et la feuille d'inventaire déposée, citée (LIA-Q3, (C) : une valeur par compte maintenant, le détail article
--    par article plus tard). Zéro est une saisie « néant », explicite. Unicité TOTALE (dossier, exercice, compte).
-- 2. L'écriture de clôture (LIA-Q2, (A)) : pour chaque compte de stock, l'annulation du stock initial — le solde
--    d'OUVERTURE lu ici, dans les à-nouveaux et les soldes reportés — au débit de la variation et au crédit du stock, puis la
--    constatation du stock final au débit du stock et au crédit de la variation (PCG, art. 946-60 et 947-71 : le 603 et le 713
--    sont débités du stock initial et crédités du stock final). La contrepartie : 6031 pour 31, 6032 pour 32, 6037 pour 37,
--    713 pour 33, 34 et 35, chacune au compte que le plan du dossier donne à son rôle. Datée du 31 décembre, sans pièce ni
--    autre source, proposée ; son journal (OD) et sa sorte viendront avec la numérotation de LIA5. Aucune extourne : le stock
--    final de N est le stock initial de N+1, qu'annule la clôture suivante.
-- 3. `enregistrer_stock_de_cloture` RECOMPOSE en entiers ces quatre lignes au plus et les compare en multiensemble à celles
--    que l'application propose ; `retirer_stock_de_cloture` retire le stock et ses lignes. Toutes deux : l'accès d'abord
--    (`admin_du_dossier`), un dossier d'engagement seulement (le BNC en trésorerie n'a pas de stock : la 2035 n'en connaît
--    pas), un exercice ni validé ni à venir, sous le verrou partagé de la validation puis celui de l'exercice.
-- 4. Les gardes : un stock et ses lignes ne s'écrivent que par ces fonctions (le réglage `jd.stock` de la transaction),
--    la restauration du super-administrateur exceptée ; un stock d'un exercice validé ne change plus.
--
-- CE QU'ELLE NE FAIT PAS. Aucune catégorie commune (achats de marchandises 607, de matières 601 et 602) : une catégorie
-- commune se lit dans TOUS les dossiers, le BNC en trésorerie compris, que ce lot ne touche pas (LIA2-Q1, posée au
-- cabinet). Aucune dépréciation de stock (39, 6817, 7817 : les provisions de la ligne 35, INV4). `valider_exercice` ne
-- change pas : sa numérotation reçue ne connaît pas encore la sorte « stock » (LIA5) ; d'ici là, aucun écran n'écrit de
-- stock (`STOCKS_PREVUS` baissé, l'onglet de LIA7 à venir).
--
-- L'ORDRE. Après les migrations appliquées au 11/11/2026 ; indépendante des migrations préparées, SAUF celles qui ajoutent
-- une source au brouillon (MCB5g, `ouverture_compte_bancaire_id` ; INV2, la colonne de l'opération d'inventaire) : sa
-- garde de tête REFUSE de s'appliquer si le brouillon porte une clé étrangère qu'elle ne nomme pas — sa contrainte « sans
-- autre source » doit alors la recevoir, le texte relu. Ses rangs au catalogue, 500 à 590, laissent 330 à 490 aux rôles
-- préparés ailleurs (le personnel de B7, le change, l'inventaire de la ligne 35).
--
-- SOURCES. PCG (règlement ANC n° 2014-03 modifié, numérotation du 1er janvier 2026), art. 213-31 et suivants (coût
-- d'entrée des stocks), art. 946-60 et 947-71 (fonctionnement du 603 et du 713) ; CGI, art. 38, 3 (évaluation au prix de
-- revient ou au cours du jour s'il est inférieur) ; notice 2033-NOT-SD (cases 050, 060, 222, 236 et 240, valeurs hors
-- taxes).

do $garde$
declare
  v_corps text;
  v_sources text;
begin
  if to_regclass('public.stocks_de_cloture') is not null
     or exists (select 1 from public.roles_comptables r where r.role in ('stocks_matieres', 'stocks_autres_approvisionnements',
       'en_cours_biens', 'en_cours_services', 'stocks_produits', 'stocks_marchandises', 'variation_stocks_matieres',
       'variation_stocks_approvisionnements', 'variation_stocks_marchandises', 'production_stockee')) then
    raise exception 'La migration stocks_de_cloture est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if to_regclass('public.ecritures_brouillon') is null or to_regclass('public.a_nouveaux') is null
     or to_regclass('public.soldes_reportes') is null or to_regclass('public.pieces') is null
     or to_regclass('public.roles_comptables') is null or to_regclass('public.exercices_valides') is null
     or to_regprocedure('public.cle_validation(uuid)') is null or to_regprocedure('public.exercice_fige(uuid, integer)') is null
     or to_regprocedure('public.is_super_admin()') is null then
    raise exception 'stocks_de_cloture : une table ou une fonction dont elle dépend manque.';
  end if;
  -- Les prédicats qu'elle appelle, à l'empreinte de leur corps (les retours chariot écartés).
  for v_corps in select x.f from (values
      ('admin_du_dossier(uuid)', '30e9b7246cb939741fe58f4ffc27adf4'),
      ('compte_du_role(uuid, text)', '6108ab75d148aa2800484b89bb112c70'),
      ('frontiere_validation(uuid)', '24a04846471ec5e8cdbae6f3b9f4a2e8')) as x(f, empreinte)
    where (select md5(replace(p.prosrc, chr(13) || chr(10), chr(10))) from pg_proc p where p.oid = to_regprocedure('public.' || x.f))
          is distinct from x.empreinte
  loop
    raise exception 'La fonction % n''est plus celle que cette migration appelle : relire la migration contre la base avant de l''appliquer.', v_corps;
  end loop;
  -- Les sources du brouillon : sa contrainte « sans autre source » les nomme toutes.
  select string_agg(a.attname, ',' order by a.attname collate "C") into v_sources
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.conrelid = 'public.ecritures_brouillon'::regclass and c.contype = 'f';
  if v_sources is distinct from
     'cotisation_id,declaration_tva_id,dossier_id,encaissement_id,facture_id,immobilisation_id,ligne_bancaire_id,operation_caisse_id,piece_id,vehicule_id' then
    raise exception 'Les sources du brouillon ne sont plus celles que cette migration nomme (%) : sa contrainte « sans autre source » doit recevoir la nouvelle — relire la migration avant de l''appliquer.', v_sources;
  end if;
  -- Aucune racine du catalogue n'en commence une des leurs, ni l'inverse (art. 1131-2 : un compte, un rôle) ; leurs rangs
  -- sont libres.
  if exists (select 1 from public.roles_comptables r cross join unnest(r.racines) as u(racine)
              cross join unnest(array['31', '32', '33', '34', '35', '37', '6031', '6032', '6037', '713']) as n(neuve)
             where left(u.racine, length(n.neuve)) = n.neuve or left(n.neuve, length(u.racine)) = u.racine)
     or exists (select 1 from public.roles_comptables r where r.ordre between 500 and 590) then
    raise exception 'Une racine ou un rang du catalogue recouvre ceux des stocks : relire la migration avant de l''appliquer.';
  end if;
end
$garde$;

-- ── 1. Les rôles (conception 37, § 4.6), aux libellés du PCG ────────────────────────────────────────────────────────
insert into public.roles_comptables (role, racines, compte_defaut, libelle_defaut, prefixe_auxiliaire_defaut, ordre) values
  ('stocks_matieres', array['31'], '310000', 'Matières premières (et fournitures)', null, 500),
  ('stocks_autres_approvisionnements', array['32'], '320000', 'Autres approvisionnements', null, 510),
  ('en_cours_biens', array['33'], '330000', 'En-cours de production de biens', null, 520),
  ('en_cours_services', array['34'], '340000', 'En-cours de production de services', null, 530),
  ('stocks_produits', array['35'], '355000', 'Produits finis', null, 540),
  ('stocks_marchandises', array['37'], '370000', 'Stocks de marchandises', null, 550),
  ('variation_stocks_matieres', array['6031'], '603100', 'Variation des stocks de matières premières (et fournitures)', null, 560),
  ('variation_stocks_approvisionnements', array['6032'], '603200', 'Variation des stocks des autres approvisionnements', null, 570),
  ('variation_stocks_marchandises', array['6037'], '603700', 'Variation des stocks de marchandises', null, 580),
  ('production_stockee', array['713'], '713000', 'Variation des stocks (en-cours de production, produits)', null, 590);

-- ── 2. La table ─────────────────────────────────────────────────────────────────────────────────────────────────────
create table public.stocks_de_cloture (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  exercice integer not null,
  compte_stock text not null,
  montant_centimes bigint not null,
  methode text not null,
  objet text not null,
  piece_citee_id uuid references public.pieces (id),
  version integer not null default 1,
  cree_par uuid not null,
  modifie_par uuid not null,
  modifie_le timestamptz not null default now(),
  constraint stocks_de_cloture_exercice check (exercice between 2000 and 2100),
  constraint stocks_de_cloture_compte check (compte_stock ~ '^3[1-57][0-9]{4}$'),
  constraint stocks_de_cloture_montant check (montant_centimes between 0 and 999999999999),
  constraint stocks_de_cloture_methode check (methode in ('cmup', 'peps', 'cout_specifique')),
  constraint stocks_de_cloture_objet check (char_length(objet) between 1 and 200 and objet = btrim(objet)),
  constraint stocks_de_cloture_version check (version >= 1),
  constraint stocks_de_cloture_un_par_compte unique (dossier_id, exercice, compte_stock)
);
create index stocks_de_cloture_piece_citee on public.stocks_de_cloture (piece_citee_id) where piece_citee_id is not null;
alter table public.stocks_de_cloture enable row level security;
comment on table public.stocks_de_cloture is
  'LIA2 (ligne 36) : la valeur hors taxes de l''inventaire physique au 31 décembre, par dossier d''engagement, exercice et compte de stock du plan, sa méthode et sa feuille citée. Écrite par enregistrer_stock_de_cloture seule (et la restauration), retirée par retirer_stock_de_cloture ; figée par la validation de son exercice. Le client n''y lit rien.';
comment on column public.stocks_de_cloture.montant_centimes is
  'Le stock final HORS TAXES, en centimes entiers ; zéro : la saisie « néant », qui annule le stock initial sans en constater.';

-- Le cabinet du dossier, des deux côtés ; aucune branche client. Les écritures directes, que la policy laisserait passer,
-- la garde les refuse : seules les fonctions écrivent, et la restauration du super-administrateur.
create policy stocks_de_cloture_cabinet on public.stocks_de_cloture
  for all to authenticated
  using (public.admin_du_dossier(dossier_id))
  with check (public.admin_du_dossier(dossier_id));

-- ── 3. La colonne du brouillon et ses contraintes (§ 4.5) ───────────────────────────────────────────────────────────
-- Sans action à la suppression : la fonction retire les lignes d'abord, comme celles d'un bien (`immobilisation_id`).
alter table public.ecritures_brouillon add column stock_de_cloture_id uuid references public.stocks_de_cloture (id);
create index ecritures_brouillon_stock_de_cloture on public.ecritures_brouillon (stock_de_cloture_id)
  where stock_de_cloture_id is not null;
-- Une ligne qui cite un stock ne cite rien d'autre — et cette seule contrainte suffit à refuser une ligne qui citerait un
-- stock ET une autre source : les contraintes d'hier n'ont pas à le savoir.
alter table public.ecritures_brouillon add constraint ecritures_brouillon_stock_sans_autre_source check (
  stock_de_cloture_id is null or (piece_id is null and ligne_bancaire_id is null and immobilisation_id is null
    and vehicule_id is null and declaration_tva_id is null and cotisation_id is null and encaissement_id is null
    and facture_id is null and operation_caisse_id is null));
alter table public.ecritures_brouillon add constraint ecritures_brouillon_stock_au_31_decembre check (
  stock_de_cloture_id is null or (extract(month from date) = 12 and extract(day from date) = 31));
comment on column public.ecritures_brouillon.stock_de_cloture_id is
  'LIA2 : le stock de clôture dont cette ligne est l''écriture (l''annulation du stock initial ou la constatation du stock final), écrite par enregistrer_stock_de_cloture seule, datée du 31 décembre, sans autre source.';

-- ── 4. Les gardes ───────────────────────────────────────────────────────────────────────────────────────────────────
create function public.garder_stock_de_cloture() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ligne public.stocks_de_cloture;
  v_derniere integer;
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
    return old;  -- la suppression du dossier, en cascade
  end if;
  if tg_op = 'INSERT' then
    v_ligne := new;
    if coalesce(current_setting('jd.stock', true), '') is distinct from new.id::text then
      -- La restauration du super-administrateur : un dossier qu'aucune validation ne fige encore (les exercices validés se
      -- restaurent après les stocks).
      if public.is_super_admin()
         and not exists (select 1 from public.exercices_valides v where v.dossier_id = new.dossier_id) then
        return new;
      end if;
      raise exception 'Un stock de clôture ne s''écrit que par enregistrer_stock_de_cloture.' using errcode = '42501';
    end if;
  else
    v_ligne := old;
    if coalesce(current_setting('jd.stock', true), '') is distinct from old.id::text then
      raise exception 'Un stock de clôture ne se modifie que par enregistrer_stock_de_cloture, et ne se retire que par retirer_stock_de_cloture.'
        using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and (new.id is distinct from old.id or new.dossier_id is distinct from old.dossier_id
         or new.exercice is distinct from old.exercice or new.compte_stock is distinct from old.compte_stock
         or new.cree_par is distinct from old.cree_par) then
      raise exception 'Un stock de clôture ne change ni de dossier, ni d''exercice, ni de compte.' using errcode = '23514';
    end if;
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(v_ligne.dossier_id));
  v_derniere := extract(year from public.frontiere_validation(v_ligne.dossier_id))::integer;
  if v_ligne.exercice <= v_derniere then
    raise exception '% : son stock de clôture ne change plus.', public.exercice_fige(v_ligne.dossier_id, v_ligne.exercice)
      using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger stocks_de_cloture_par_ses_fonctions
  before insert or update or delete on public.stocks_de_cloture
  for each row execute function public.garder_stock_de_cloture();
revoke execute on function public.garder_stock_de_cloture() from public, anon, authenticated;

create function public.garder_ecriture_de_stock() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock public.stocks_de_cloture;
begin
  if tg_op = 'DELETE' then
    if old.stock_de_cloture_id is null
       or not exists (select 1 from public.dossiers d where d.id = old.dossier_id)
       or coalesce(current_setting('jd.stock', true), '') = old.stock_de_cloture_id::text then
      return old;
    end if;
    raise exception 'L''écriture d''un stock de clôture se retire avec ce stock (retirer_stock_de_cloture).' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (old.stock_de_cloture_id is not null or new.stock_de_cloture_id is not null) then
    raise exception 'L''écriture d''un stock de clôture ne se modifie pas : enregistrer de nouveau le stock.' using errcode = '42501';
  end if;
  if new.stock_de_cloture_id is null then
    return new;
  end if;
  if coalesce(current_setting('jd.stock', true), '') is distinct from new.stock_de_cloture_id::text
     and not (public.is_super_admin()
              and not exists (select 1 from public.exercices_valides v where v.dossier_id = new.dossier_id)) then
    raise exception 'L''écriture d''un stock de clôture ne s''écrit qu''avec ce stock, par enregistrer_stock_de_cloture.'
      using errcode = '42501';
  end if;
  select s.* into v_stock from public.stocks_de_cloture s where s.id = new.stock_de_cloture_id;
  if v_stock.id is null or v_stock.dossier_id is distinct from new.dossier_id
     or new.date is distinct from make_date(v_stock.exercice, 12, 31) then
    raise exception 'Cette écriture ne suit pas son stock de clôture : son dossier, ou sa date (le 31 décembre de son exercice).'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
-- Les colonnes que la validation d'un exercice ne touche pas (elle pose le statut, le journal, le numéro et les champs du
-- FEC) : la validation passe, toute autre modification d'une ligne de stock se refuse.
create trigger ecritures_brouillon_stock
  before insert or delete or update of stock_de_cloture_id, dossier_id, date, compte, sens, montant, libelle, piece_id,
    ligne_bancaire_id on public.ecritures_brouillon
  for each row execute function public.garder_ecriture_de_stock();
revoke execute on function public.garder_ecriture_de_stock() from public, anon, authenticated;

-- ── 5. Les fonctions ────────────────────────────────────────────────────────────────────────────────────────────────
-- `p_stock` : { "exercice": 2026, "compte_stock": "370000", "montant_centimes": 1234500, "methode": "cmup",
--   "objet": "Inventaire physique du 31/12 — magasin", "piece_citee_id": null } ;
-- `p_ecritures` : les lignes que l'application compose (lib/stocks.ts, `composerLeStock`), chacune
--   { "compte": "603700", "sens": "debit", "centimes": 1000000, "libelle": "…" } ;
-- `p_version_lue` : la version du stock que l'écran a lue, nulle pour un stock nouveau.
create function public.enregistrer_stock_de_cloture(p_dossier_id uuid, p_stock jsonb, p_ecritures jsonb, p_version_lue integer)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $fonction$
declare
  v_mode text;
  v_exercice integer;
  v_compte text;
  v_montant bigint;
  v_methode text;
  v_objet text;
  v_piece uuid;
  v_role text;
  v_au_plan text;
  v_contrepartie text;
  v_derniere integer;
  v_ouverture bigint;
  v_existant public.stocks_de_cloture;
  v_attendues jsonb := '[]'::jsonb;
  v_ligne jsonb;
  v_id uuid;
begin
  -- 1. L'accès, avant toute lecture.
  if p_dossier_id is null or auth.uid() is null or not coalesce(public.admin_du_dossier(p_dossier_id), false) then
    raise exception 'Seul le cabinet du dossier enregistre un stock de clôture.' using errcode = '42501';
  end if;
  select d.mode_comptable into v_mode from public.dossiers d where d.id = p_dossier_id;
  if not found then
    raise exception 'Dossier introuvable.' using errcode = 'P0002';
  end if;
  if v_mode is distinct from 'engagement' then
    raise exception 'Un dossier en trésorerie ne tient pas de stock de clôture : la 2035 n''en connaît pas.';
  end if;

  -- 2. La saisie, lue sans rien supposer.
  if p_stock is null or jsonb_typeof(p_stock) is distinct from 'object' or p_ecritures is null
     or jsonb_typeof(p_ecritures) is distinct from 'array' then
    raise exception 'Le stock de clôture proposé est illisible.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_stock -> 'exercice') is distinct from 'number' or (p_stock ->> 'exercice') !~ '^[0-9]{4}$'
     or (p_stock ->> 'exercice')::integer not between 2000 and 2100 then
    raise exception 'L''exercice du stock de clôture est illisible.' using errcode = '22023';
  end if;
  v_exercice := (p_stock ->> 'exercice')::integer;
  v_compte := p_stock ->> 'compte_stock';
  if jsonb_typeof(p_stock -> 'compte_stock') is distinct from 'string' or v_compte !~ '^3[1-57][0-9]{4}$' then
    raise exception 'Un stock de clôture se tient sur un compte de stock à six chiffres, sous 31, 32, 33, 34, 35 ou 37.'
      using errcode = '22023';
  end if;
  if jsonb_typeof(p_stock -> 'montant_centimes') is distinct from 'number' or (p_stock ->> 'montant_centimes') !~ '^[0-9]{1,12}$' then
    raise exception 'Le stock final est un montant hors taxes en centimes entiers, positif ou nul.' using errcode = '22023';
  end if;
  v_montant := (p_stock ->> 'montant_centimes')::bigint;
  v_methode := p_stock ->> 'methode';
  if jsonb_typeof(p_stock -> 'methode') is distinct from 'string' or v_methode not in ('cmup', 'peps', 'cout_specifique') then
    raise exception 'La méthode d''évaluation du stock est hors de sa liste : coût moyen pondéré, premier entré premier sorti, ou coût spécifique.'
      using errcode = '22023';
  end if;
  v_objet := p_stock ->> 'objet';
  if jsonb_typeof(p_stock -> 'objet') is distinct from 'string' or char_length(v_objet) not between 1 and 200
     or v_objet <> btrim(v_objet) then
    raise exception 'L''objet du stock de clôture tient en 1 à 200 caractères, sans espace au début ni à la fin.'
      using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p_stock -> 'piece_citee_id'), 'null') <> 'null' then
    if jsonb_typeof(p_stock -> 'piece_citee_id') <> 'string'
       or (p_stock ->> 'piece_citee_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'La feuille d''inventaire citée est illisible.' using errcode = '22023';
    end if;
    v_piece := (p_stock ->> 'piece_citee_id')::uuid;
  end if;
  for v_ligne in select e from jsonb_array_elements(p_ecritures) as t(e) loop
    if jsonb_typeof(v_ligne) is distinct from 'object' or jsonb_typeof(v_ligne -> 'compte') is distinct from 'string'
       or (v_ligne ->> 'sens') is null or (v_ligne ->> 'sens') not in ('debit', 'credit')
       or jsonb_typeof(v_ligne -> 'centimes') is distinct from 'number' or (v_ligne ->> 'centimes') !~ '^[1-9][0-9]{0,11}$'
       or jsonb_typeof(v_ligne -> 'libelle') is distinct from 'string' or char_length(v_ligne ->> 'libelle') not between 1 and 200
       or (v_ligne ->> 'libelle') <> btrim(v_ligne ->> 'libelle') then
      raise exception 'Une écriture proposée du stock de clôture est illisible.' using errcode = '22023';
    end if;
  end loop;

  -- 3. Le verrou partagé de la validation, puis celui de l'exercice : deux enregistrements du même exercice se suivent.
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  perform pg_advisory_xact_lock(hashtextextended('stocks_de_cloture:' || p_dossier_id::text || ':' || v_exercice::text, 0));

  -- 4. Un exercice ni validé ni à venir (le jour de Paris).
  v_derniere := extract(year from public.frontiere_validation(p_dossier_id))::integer;
  if v_exercice <= v_derniere then
    raise exception '% : son stock de clôture ne change plus.', public.exercice_fige(p_dossier_id, v_exercice)
      using errcode = '23514';
  end if;
  if v_exercice > extract(year from (now() at time zone 'Europe/Paris'))::integer then
    raise exception 'L''exercice % n''est pas commencé : son stock de clôture ne se saisit pas encore.', v_exercice
      using errcode = '22023';
  end if;

  -- 5. Le compte : celui que le plan du dossier donne au rôle de sa racine ; la contrepartie, le rôle de sa variation.
  v_role := case left(v_compte, 2) when '31' then 'stocks_matieres' when '32' then 'stocks_autres_approvisionnements'
    when '33' then 'en_cours_biens' when '34' then 'en_cours_services' when '35' then 'stocks_produits'
    else 'stocks_marchandises' end;
  v_au_plan := public.compte_du_role(p_dossier_id, v_role);
  if v_au_plan is distinct from v_compte then
    raise exception 'Le compte % n''est pas le compte de ce stock au plan du dossier (%).', v_compte, coalesce(v_au_plan, 'aucun')
      using errcode = '23514';
  end if;
  v_contrepartie := public.compte_du_role(p_dossier_id, case left(v_compte, 2) when '31' then 'variation_stocks_matieres'
    when '32' then 'variation_stocks_approvisionnements' when '37' then 'variation_stocks_marchandises'
    else 'production_stockee' end);

  -- 6. La feuille citée : une pièce du dossier.
  if v_piece is not null and not exists (select 1 from public.pieces p where p.id = v_piece and p.dossier_id = p_dossier_id) then
    raise exception 'La feuille d''inventaire citée n''est pas une pièce de ce dossier.' using errcode = '23514';
  end if;

  -- 7. La version lue.
  select s.* into v_existant from public.stocks_de_cloture s
   where s.dossier_id = p_dossier_id and s.exercice = v_exercice and s.compte_stock = v_compte;
  if (v_existant.id is null and p_version_lue is not null)
     or (v_existant.id is not null and p_version_lue is distinct from v_existant.version) then
    raise exception 'Ce stock de clôture a changé depuis sa lecture : le relire avant de l''enregistrer.' using errcode = '40001';
  end if;

  -- 8. Le stock initial : le solde d'OUVERTURE du compte, lu ici (les à-nouveaux de l'exercice, les soldes reportés à son
  --    1er janvier), en centimes exacts (numeric(14,2)), le débit positif.
  select coalesce(sum(case when m.sens = 'debit' then 1 else -1 end * (m.montant * 100)::bigint), 0)::bigint into v_ouverture
    from (select a.sens, a.montant from public.a_nouveaux a
           where a.dossier_id = p_dossier_id and a.compte = v_compte
             and a.date between make_date(v_exercice, 1, 1) and make_date(v_exercice, 12, 31)
          union all
          select s.sens, s.montant from public.soldes_reportes s
           where s.dossier_id = p_dossier_id and s.compte = v_compte and s.date = make_date(v_exercice, 1, 1)) m;
  if v_ouverture < 0 then
    raise exception 'Le compte % s''ouvre au crédit (% centimes) : un stock ne s''ouvre pas au crédit — relire la balance reprise ou les soldes reportés.',
      v_compte, -v_ouverture using errcode = '23514';
  end if;

  -- 9. La recomposition, en entiers, comparée en multiensemble : l'annulation du stock initial, la constatation du final.
  if v_ouverture > 0 then
    v_attendues := v_attendues || jsonb_build_array(
      jsonb_build_object('compte', v_contrepartie, 'sens', 'debit', 'centimes', v_ouverture),
      jsonb_build_object('compte', v_compte, 'sens', 'credit', 'centimes', v_ouverture));
  end if;
  if v_montant > 0 then
    v_attendues := v_attendues || jsonb_build_array(
      jsonb_build_object('compte', v_compte, 'sens', 'debit', 'centimes', v_montant),
      jsonb_build_object('compte', v_contrepartie, 'sens', 'credit', 'centimes', v_montant));
  end if;
  if (select coalesce(jsonb_agg(x order by x ->> 'compte' collate "C", x ->> 'sens' collate "C", (x ->> 'centimes')::bigint), '[]'::jsonb)
        from jsonb_array_elements(v_attendues) as t(x))
     is distinct from
     (select coalesce(jsonb_agg(jsonb_build_object('compte', e ->> 'compte', 'sens', e ->> 'sens', 'centimes', (e ->> 'centimes')::bigint)
          order by e ->> 'compte' collate "C", e ->> 'sens' collate "C", (e ->> 'centimes')::bigint), '[]'::jsonb)
        from jsonb_array_elements(p_ecritures) as t(e)) then
    raise exception 'Les écritures proposées ne sont pas celles que ce stock commande : l''annulation du stock initial (% centimes) et la constatation du stock final (% centimes), entre le compte % et le compte %.',
      v_ouverture, v_montant, v_compte, v_contrepartie using errcode = '23514';
  end if;

  -- 10. L'écriture, d'un seul tenant, sous le réglage de CE stock.
  v_id := coalesce(v_existant.id, gen_random_uuid());
  perform set_config('jd.stock', v_id::text, true);
  if v_existant.id is not null then
    delete from public.ecritures_brouillon b where b.stock_de_cloture_id = v_id;
    update public.stocks_de_cloture
       set montant_centimes = v_montant, methode = v_methode, objet = v_objet, piece_citee_id = v_piece,
           version = version + 1, modifie_par = auth.uid(), modifie_le = now()
     where id = v_id;
  else
    insert into public.stocks_de_cloture (id, dossier_id, exercice, compte_stock, montant_centimes, methode, objet,
                                          piece_citee_id, cree_par, modifie_par)
    values (v_id, p_dossier_id, v_exercice, v_compte, v_montant, v_methode, v_objet, v_piece, auth.uid(), auth.uid());
  end if;
  insert into public.ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut, stock_de_cloture_id)
  select p_dossier_id, make_date(v_exercice, 12, 31), e ->> 'compte', e ->> 'libelle', (e ->> 'centimes')::bigint / 100.0,
         e ->> 'sens', 'proposee', v_id
    from jsonb_array_elements(p_ecritures) as t(e);
  perform set_config('jd.stock', '', true);
  return v_id;
end
$fonction$;
revoke execute on function public.enregistrer_stock_de_cloture(uuid, jsonb, jsonb, integer) from public, anon;
grant execute on function public.enregistrer_stock_de_cloture(uuid, jsonb, jsonb, integer) to authenticated;
comment on function public.enregistrer_stock_de_cloture(uuid, jsonb, jsonb, integer) is
  'LIA2 : enregistre le stock de clôture d''un compte (dossier d''engagement, exercice ni validé ni à venir) et ses écritures, que la base recompose en entiers depuis le solde d''ouverture lu ici et compare en multiensemble. Tout ou rien, contre la version lue.';

-- Le dossier d'abord, pour que l'accès se juge avant toute lecture du stock.
create function public.retirer_stock_de_cloture(p_dossier_id uuid, p_id uuid, p_version_lue integer)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $fonction$
declare
  v_existant public.stocks_de_cloture;
  v_derniere integer;
begin
  if p_dossier_id is null or auth.uid() is null or not coalesce(public.admin_du_dossier(p_dossier_id), false) then
    raise exception 'Seul le cabinet du dossier retire un stock de clôture.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  select s.* into v_existant from public.stocks_de_cloture s where s.id = p_id and s.dossier_id = p_dossier_id;
  if v_existant.id is null then
    raise exception 'Ce stock de clôture n''est pas dans ce dossier.' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('stocks_de_cloture:' || p_dossier_id::text || ':' || v_existant.exercice::text, 0));
  select s.* into v_existant from public.stocks_de_cloture s where s.id = p_id and s.dossier_id = p_dossier_id;
  v_derniere := extract(year from public.frontiere_validation(p_dossier_id))::integer;
  if v_existant.exercice <= v_derniere then
    raise exception '% : son stock de clôture ne change plus.', public.exercice_fige(p_dossier_id, v_existant.exercice)
      using errcode = '23514';
  end if;
  if v_existant.id is null or p_version_lue is distinct from v_existant.version then
    raise exception 'Ce stock de clôture a changé depuis sa lecture : le relire avant de le retirer.' using errcode = '40001';
  end if;
  perform set_config('jd.stock', p_id::text, true);
  delete from public.ecritures_brouillon b where b.stock_de_cloture_id = p_id;
  delete from public.stocks_de_cloture s where s.id = p_id;
  perform set_config('jd.stock', '', true);
end
$fonction$;
revoke execute on function public.retirer_stock_de_cloture(uuid, uuid, integer) from public, anon;
grant execute on function public.retirer_stock_de_cloture(uuid, uuid, integer) to authenticated;
comment on function public.retirer_stock_de_cloture(uuid, uuid, integer) is
  'LIA2 : retire un stock de clôture et ses écritures, d''un seul tenant, contre la version lue ; jamais celui d''un exercice validé.';

do $deux_facteurs$
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    execute 'create policy deux_facteurs on public.stocks_de_cloture as restrictive for all to authenticated '
      || 'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))';
  end if;
end
$deux_facteurs$;
