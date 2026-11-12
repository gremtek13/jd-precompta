-- INV2 : LES OPÉRATIONS D'INVENTAIRE, EN BASE (ligne 35) — PRÉPARÉE le 12/11/2026, PAS APPLIQUÉE. À COLLER : ses deux
-- fonctions retirent les lignes qu'elles remplacent (le mot de la suppression retient `apply_migration`). Rien de ce qui
-- existe ne se détruit : une table, une colonne, une contrainte, deux déclencheurs, quatre fonctions et six rôles
-- s'ajoutent ; aucune ligne, aucune colonne ni aucun objet ne se retire ni ne change.
--
-- La conception : docs/conceptions/35-inventaire.md, § 3, § 4.1, § 4.3 à § 4.7. Le module que la base redit : src/lib/inventaire.ts
-- (INV1), ses refus sous les mêmes mots, aux mêmes codes, dans le même ordre ; src/lib/inventaireEnBase.test.ts les confronte
-- au texte de cette migration. Le récit : HISTORIQUE.md, « 12/11/2026 — INV2 : LES OPÉRATIONS D'INVENTAIRE, EN BASE (LIGNE
-- 35) (PRÉPARÉE, PAS APPLIQUÉE) ». Son retour : supabase/preparees/retour/20261112190100_retour_operations_d_inventaire.sql.
-- Son essai : supabase/essais/operationsDInventaire.sql (une réplique seulement, une transaction) ; puis rls.sql (le bloc IV).
--
-- SOURCES. PCG (règlement ANC n° 2014-03 modifié, numérotation du 1er janvier 2026) : art. 1214-40 et 1214-41 (les factures
-- non parvenues et à établir, « du montant, taxes comprises », contre-passées à l'ouverture de l'exercice suivant), art.
-- 1214-48 (charges et produits constatés d'avance, 486 et 487), art. 1032-2 (une pièce justificative datée), art. 1121-1
-- (la liste des comptes : 4282, 4286, 4382, 4386, 44812, 4482, 439, 1688, 518, 44586, 44587). Code de commerce, art.
-- L123-12 (l'inventaire au moins une fois tous les douze mois). Légifrance et l'ANC.
--
-- CE QU'ELLE POSE :
--   1. Six rôles au catalogue (`roles_comptables`), rangs 360 à 410 : 486, 487, 408, 418, 44586, 44587 (§ 4.4). Aucun
--      n'empiète sur le 467 ni sur le 468 (INV-Q2 (A)).
--   2. `operations_inventaire` : une régularisation de clôture d'un dossier en ENGAGEMENT, saisie par le cabinet, jamais
--      devinée (§ 3.1). Ses sept natures sont déjà dans sa liste fermée ; la provision (INV4) y entrera par sa table et ses
--      contraintes à elle, sans rien retirer d'ici. Lue par le cabinet du dossier (`admin_du_dossier`), jamais par un client ;
--      aucune policy d'écriture : `enregistrer_operation_inventaire` et `retirer_operation_inventaire` seules, la porte de la
--      restauration au super-administrateur, en insertion.
--   3. `ecritures_brouillon.operation_inventaire_id` : la constatation au 31 décembre et son extourne au 1er janvier suivant
--      (INV-Q1 (A) : la paire naît, change et se retire ensemble), au journal OD que la validation leur donnera (INV3) ; une
--      contrainte les tient hors de toute autre source, à l'une des deux dates. Le libellé est composé, jamais recopié d'un
--      tiers : « CCA 31/12/AAAA — <libellé du compte> — <objet> », « Extourne — » devant celui de l'extourne.
--   4. La recomposition EN ENTIERS de ce que propose l'application (src/lib/inventaire.ts, `composerRegularisation`) et sa
--      comparaison en MULTIENSEMBLE (date, compte, sens, centimes), comme pour les dotations ; la FNP et la FAE d'un dossier
--      assujetti toutes taxes comprises, leur TVA aux comptes d'attente (INV-Q3, la recommandation (A), que le cabinet n'a
--      pas encore tranchée : la base ne dit donc jamais le refus « hors taxes » du module).
--   5. Le gel : une régularisation d'un exercice validé (ou que la validation d'un exercice suivant fige) ne s'écrit, ne
--      change ni ne se retire plus (23514) ; ses lignes, figées par la garde des écritures validées. Le verrou PARTAGÉ de la
--      validation (`cle_validation`) se prend avant toute lecture du gel.
--   6. Si la double authentification exigée (`deux_facteurs_exiges`) est déjà en base, la policy restrictive `deux_facteurs`
--      sur la table neuve.
--   7. L'exclusion envers les deux autres sources neuves du brouillon, préparées le même mois — l'ouverture éclatée par
--      compte (MCB5g, `ouverture_compte_bancaire_id`) et le stock de clôture (LIA2, `stock_de_cloture_id`) : une contrainte
--      PAR PAIRE, au même nom et au même texte dans les trois migrations, posée par la seconde de la paire à se coller. Les
--      trois se collent ainsi dans n'importe quel ordre et laissent la même base (l'ordre des colonnes excepté), chaque
--      colonne refusant une ligne qui en cite une autre. La garde de tête accepte ces deux colonnes, présentes ou non, et
--      refuse toute autre clé étrangère du brouillon qu'elle ne connaît pas.
--
-- CE QU'ELLE NE FAIT PAS : la validation (la sorte `inventaire`, ses filets, l'état déclaré : INV3), les provisions (INV4),
-- l'écran (INV5). Aucun dossier n'est en engagement en production (12/11/2026) : rien ne s'y écrit avant INV5.

do $garde$
declare
  v_f text;
  v_sources text;
begin
  if to_regclass('public.operations_inventaire') is not null
     or exists (select 1 from public.roles_comptables r where r.role in ('charges_constatees_avance', 'produits_constates_avance',
                  'factures_non_parvenues', 'factures_a_etablir', 'tva_factures_non_parvenues', 'tva_factures_a_etablir'))
     or exists (select 1 from pg_attribute a where a.attrelid = 'public.ecritures_brouillon'::regclass
                  and a.attname = 'operation_inventaire_id' and not a.attisdropped) then
    raise exception 'La migration operations_d_inventaire est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if to_regclass('public.dossiers') is null or to_regclass('public.pieces') is null or to_regclass('public.a_nouveaux') is null
     or to_regclass('public.exercices_valides') is null or to_regclass('public.plan_comptable_dossier') is null
     or exists (select 1 from (values ('piece_id'), ('ligne_bancaire_id'), ('immobilisation_id'), ('vehicule_id'),
                  ('declaration_tva_id'), ('cotisation_id'), ('encaissement_id'), ('facture_id'), ('operation_caisse_id')) c(n)
                where not exists (select 1 from pg_attribute a where a.attrelid = 'public.ecritures_brouillon'::regclass
                                    and a.attname = c.n and not a.attisdropped)) then
    raise exception 'operations_d_inventaire : une table ou une colonne dont elle dépend manque : relire la base.';
  end if;
  -- Les sources du brouillon : sa contrainte « sans autre source » nomme les neuf d'hier, et les deux sources neuves des
  -- migrations sœurs (MCB5g, LIA2), présentes ou non, reçoivent leur exclusion au § 3. Toute autre clé étrangère du
  -- brouillon, que cette migration ne nomme pas, la refuse : la relire.
  select string_agg(a.attname, ',' order by a.attname collate "C") into v_sources
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.conrelid = 'public.ecritures_brouillon'::regclass and c.contype = 'f'
     and a.attname not in ('ouverture_compte_bancaire_id', 'stock_de_cloture_id');
  if v_sources is distinct from
     'cotisation_id,declaration_tva_id,dossier_id,encaissement_id,facture_id,immobilisation_id,ligne_bancaire_id,operation_caisse_id,piece_id,vehicule_id' then
    raise exception 'Les sources du brouillon ne sont plus celles que cette migration nomme (%) : sa contrainte « sans autre source » doit recevoir la nouvelle — relire la migration avant de l''appliquer.', v_sources;
  end if;
  -- Les fonctions qu'elle appelle, à l'empreinte de leur corps (les retours chariot écartés), relevées en production le
  -- 12/11/2026.
  for v_f in select x.f from (values
      ('admin_du_dossier(uuid)', '30e9b7246cb939741fe58f4ffc27adf4'),
      ('is_super_admin()', 'a9159138778422a43ba8d8c21240c9bb'),
      ('cle_validation(uuid)', 'bcbb03363036aa6aa037c0b829e3382f'),
      ('frontiere_validation(uuid)', '24a04846471ec5e8cdbae6f3b9f4a2e8'),
      ('compte_du_role(uuid, text)', '6108ab75d148aa2800484b89bb112c70'),
      ('retour_declencheur(text, anyelement, anyelement)', 'bc80cac6efe46d15f86d1820eb56c47e')) as x(f, empreinte)
    where (select md5(replace(p.prosrc, chr(13) || chr(10), chr(10))) from pg_proc p where p.oid = to_regprocedure('public.' || x.f))
          is distinct from x.empreinte
  loop
    raise exception 'La fonction % n''est plus celle que cette migration appelle : relire la migration contre la base avant de l''appliquer.', v_f;
  end loop;
  -- Les rangs et les racines des six rôles sont libres (INV4 prendra 420 à 470).
  if exists (select 1 from public.roles_comptables r where r.ordre between 360 and 410)
     or exists (select 1 from public.roles_comptables r cross join unnest(r.racines) as u(racine)
                cross join unnest(array['486', '487', '408', '418', '44586', '44587']) as n(racine)
                where starts_with(u.racine, n.racine) or starts_with(n.racine, u.racine)) then
    raise exception 'Le catalogue des rôles n''est plus celui que cette migration suppose (rangs 360 à 410, racines 486, 487, 408, 418, 44586, 44587) : la relire.';
  end if;
end
$garde$;

-- ══ 1. Les six rôles des régularisations (§ 4.4) ══
insert into public.roles_comptables (role, racines, compte_defaut, libelle_defaut, prefixe_auxiliaire_defaut, ordre) values
  ('charges_constatees_avance', array['486'], '486000', 'Charges constatées d''avance', null, 360),
  ('produits_constates_avance', array['487'], '487000', 'Produits constatés d''avance', null, 370),
  ('factures_non_parvenues', array['408'], '408100', 'Fournisseurs - Factures non parvenues', null, 380),
  ('factures_a_etablir', array['418'], '418100', 'Clients - Factures à établir', null, 390),
  ('tva_factures_non_parvenues', array['44586'], '445860', 'Taxes sur le chiffre d''affaires sur factures non parvenues', null, 400),
  ('tva_factures_a_etablir', array['44587'], '445870', 'Taxes sur le chiffre d''affaires sur factures à établir', null, 410);

-- ══ 2. Les régularisations ══
create table public.operations_inventaire (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  exercice integer not null,
  nature text not null,
  compte_resultat text not null,
  compte_regularisation text not null,
  montant_centimes bigint not null,
  tva_centimes bigint not null default 0,
  periode_debut date,
  periode_fin date,
  objet text not null,
  piece_citee_id uuid references public.pieces(id),
  version integer not null default 1,
  cree_par uuid not null,
  cree_le timestamptz not null default now(),
  modifie_par uuid,
  modifie_le timestamptz,
  constraint operations_inventaire_exercice check (exercice >= 2000 and exercice <= 2100),
  constraint operations_inventaire_nature check (
    nature = any (array['cca', 'pca', 'fnp', 'fae', 'charge_a_payer', 'produit_a_recevoir', 'provision'])),
  -- La classe du compte de résultat suit la nature ; celle d'une provision, sa contrainte à elle (INV4).
  constraint operations_inventaire_comptes check (
    compte_resultat ~ '^[0-9]{3,}$' and compte_regularisation ~ '^[0-9]{3,}$'
    and (nature = 'provision'
         or (nature = any (array['cca', 'fnp', 'charge_a_payer']) and left(compte_resultat, 1) = '6')
         or (nature = any (array['pca', 'fae', 'produit_a_recevoir']) and left(compte_resultat, 1) = '7'))),
  -- Des centimes que l'application relit sans perte (2^53 - 1) ; une TVA d'attente sur une FNP ou une FAE seulement ; la
  -- cible d'une provision peut être nulle (soldée), toute autre régularisation est positive.
  constraint operations_inventaire_montants check (
    montant_centimes <= 9007199254740991 and tva_centimes >= 0 and montant_centimes + tva_centimes <= 9007199254740991
    and (montant_centimes > 0 or (nature = 'provision' and montant_centimes >= 0))
    and (tva_centimes = 0 or nature = any (array['fnp', 'fae']))),
  constraint operations_inventaire_periode check (
    (periode_debut is null) = (periode_fin is null) and (periode_debut is null or periode_debut <= periode_fin)),
  constraint operations_inventaire_objet check (
    char_length(objet) >= 1 and char_length(objet) <= 200 and objet !~ '[\r\n]'),
  constraint operations_inventaire_version check (version >= 1)
);
create index operations_inventaire_dossier on public.operations_inventaire (dossier_id, exercice);
create index operations_inventaire_piece_citee on public.operations_inventaire (piece_citee_id) where piece_citee_id is not null;
alter table public.operations_inventaire enable row level security;
comment on table public.operations_inventaire is
  'INV2 (ligne 35) : une régularisation de clôture d''un dossier en engagement, saisie par le cabinet. Écrite par enregistrer_operation_inventaire et retirer_operation_inventaire seules ; ses écritures (la constatation au 31 décembre, l''extourne au 1er janvier suivant) citent operation_inventaire_id.';
comment on column public.operations_inventaire.piece_citee_id is
  'La pièce du dossier qui fonde la régularisation, quand elle existe (§ 3.3, INV-Q7) : citée ici, jamais par ecritures_brouillon.piece_id.';

-- Le cabinet du dossier lit ; aucun client, aucun droit d'accès (l'inventaire est un travail du cabinet). Aucune policy
-- d'écriture : les deux fonctions seules. La restauration réinsère par la porte du super-administrateur, que la garde ouvre.
create policy operations_inventaire_lecture on public.operations_inventaire
  for select to authenticated using (public.admin_du_dossier(dossier_id));
create policy operations_inventaire_restauration on public.operations_inventaire
  for insert to authenticated with check (public.is_super_admin());

-- ══ 3. Les écritures d'une régularisation ══
alter table public.ecritures_brouillon add column operation_inventaire_id uuid
  constraint ecritures_brouillon_operation_inventaire_id_fkey references public.operations_inventaire(id);
-- Une ligne d'inventaire ne cite aucune autre source, et se date au 31 décembre ou au 1er janvier : la garde la tient au
-- 31 décembre de l'exercice de son opération, ou au lendemain. L'exclusion est symétrique : les contraintes des sources
-- d'hier n'ont pas à nommer la colonne neuve ; celles des sources neuves sœurs, le bloc qui suit.
alter table public.ecritures_brouillon add constraint ecritures_brouillon_inventaire_sans_autre_source check (
  operation_inventaire_id is null
  or (num_nonnulls(piece_id, ligne_bancaire_id, immobilisation_id, vehicule_id, declaration_tva_id, cotisation_id,
                   encaissement_id, facture_id, operation_caisse_id) = 0
      and ((extract(month from date) = 12 and extract(day from date) = 31)
           or (extract(month from date) = 1 and extract(day from date) = 1))));
create index ecritures_brouillon_operation_inventaire on public.ecritures_brouillon (operation_inventaire_id)
  where operation_inventaire_id is not null;
comment on column public.ecritures_brouillon.operation_inventaire_id is
  'INV2 (ligne 35) : la régularisation d''inventaire dont cette ligne est la constatation (31 décembre) ou l''extourne (1er janvier suivant) ; écrite par enregistrer_operation_inventaire seule.';

-- L'exclusion envers une source neuve sœur déjà en base : la contrainte de la paire, au nom et au texte que l'autre
-- migration poserait si elle venait après (MCB5g et LIA2 portent ce même bloc, pour leurs paires). Une ligne d'inventaire
-- tombe un 31 décembre, comme celle d'un stock : leur paire n'a que cette contrainte pour la refuser.
do $autres_sources$
begin
  if exists (select 1 from pg_attribute a where a.attrelid = 'public.ecritures_brouillon'::regclass
               and a.attname = 'ouverture_compte_bancaire_id' and not a.attisdropped) then
    execute 'alter table public.ecritures_brouillon add constraint ecritures_brouillon_inventaire_hors_de_l_ouverture '
      || 'check (operation_inventaire_id is null or ouverture_compte_bancaire_id is null)';
  end if;
  if exists (select 1 from pg_attribute a where a.attrelid = 'public.ecritures_brouillon'::regclass
               and a.attname = 'stock_de_cloture_id' and not a.attisdropped) then
    execute 'alter table public.ecritures_brouillon add constraint ecritures_brouillon_inventaire_hors_des_stocks '
      || 'check (operation_inventaire_id is null or stock_de_cloture_id is null)';
  end if;
end
$autres_sources$;

-- ══ 4. Deux aides, privées ══
-- Un nombre de centimes que l'application relit sans perte : un nombre JSON entier, de valeur absolue au plus 2^53 - 1
-- (`Number.isSafeInteger`) ; nul sinon. Les CASE imbriqués : un texte n'est jamais converti en nombre.
create function public.inventaire_entier(p jsonb) returns bigint
language sql immutable set search_path = public as $$
  select case when jsonb_typeof(p) = 'number' then
    case when (p #>> '{}')::numeric = trunc((p #>> '{}')::numeric) and abs((p #>> '{}')::numeric) <= 9007199254740991
         then (p #>> '{}')::numeric::bigint end end
$$;
-- Un texte rogné comme `String.prototype.trim` le rogne (les blancs et les fins de ligne d'ECMAScript, art. 12.2 et 12.3) :
-- l'objet saisi se juge et s'écrit comme le module le compose.
create function public.inventaire_rogne(p text) returns text
language sql immutable set search_path = public as $$
  select btrim(p, chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(160) || chr(5760) || chr(8192)
    || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201)
    || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279))
$$;
revoke execute on function public.inventaire_entier(jsonb) from public, anon, authenticated;
revoke execute on function public.inventaire_rogne(text) from public, anon, authenticated;

-- ══ 5. Les gardes ══
-- La régularisation : écrite par ses deux fonctions seules (le réglage local `jd.inventaire`, qu'elles posent sur leur
-- dossier) ou réinsérée par le super-administrateur (la restauration, qui réinsère les exercices validés en dernier) ; celle
-- d'un exercice figé ne change, ne se retire ni ne s'insère plus. Le départ du dossier l'emporte.
create function public.garder_operations_inventaire() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_derniere integer;
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.dossiers where id = old.dossier_id) then
    return old;
  end if;
  if coalesce(current_setting('jd.inventaire', true), '')
       is distinct from (case when tg_op = 'DELETE' then old.dossier_id else new.dossier_id end)::text
     and not (tg_op = 'INSERT' and public.is_super_admin()) then
    raise exception 'Une régularisation d’inventaire ne s’écrit que par enregistrer_operation_inventaire et retirer_operation_inventaire.'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.dossier_id is distinct from old.dossier_id then
    raise exception 'Une régularisation d’inventaire ne change pas de dossier.' using errcode = '42501';
  end if;
  if tg_op <> 'INSERT' then
    perform pg_advisory_xact_lock_shared(public.cle_validation(old.dossier_id));
    v_derniere := extract(year from public.frontiere_validation(old.dossier_id))::integer;
    if old.exercice <= v_derniere then
      raise exception 'Cet exercice est validé : ses écritures d’inventaire ne changent plus.' using errcode = '23514';
    end if;
  end if;
  if tg_op <> 'DELETE' then
    perform pg_advisory_xact_lock_shared(public.cle_validation(new.dossier_id));
    v_derniere := extract(year from public.frontiere_validation(new.dossier_id))::integer;
    if new.exercice <= v_derniere then
      raise exception 'Cet exercice est validé : ses écritures d’inventaire ne changent plus.' using errcode = '23514';
    end if;
  end if;
  return public.retour_declencheur(tg_op, old, new);
end;
$$;
create trigger operations_inventaire_garde before insert or update or delete on public.operations_inventaire
  for each row execute function public.garder_operations_inventaire();

-- Ses écritures : une ligne qui cite une régularisation (avant ou après) ne s'écrit, ne change ni ne part que par sa
-- fonction, la réinsertion du super-administrateur et le départ du dossier exceptés ; elle appartient à une régularisation
-- de son dossier, en engagement, à sa date. La validation (INV3) ne touche à aucune des colonnes que le déclencheur garde.
create function public.garder_ecriture_d_inventaire() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.dossiers where id = old.dossier_id) then
    return old;
  end if;
  if tg_op <> 'INSERT' and old.operation_inventaire_id is not null
     and coalesce(current_setting('jd.inventaire', true), '') is distinct from old.dossier_id::text then
    raise exception 'Une écriture d’inventaire ne change que par sa régularisation.' using errcode = '42501';
  end if;
  if tg_op <> 'DELETE' and new.operation_inventaire_id is not null then
    if coalesce(current_setting('jd.inventaire', true), '') is distinct from new.dossier_id::text
       and not (tg_op = 'INSERT' and public.is_super_admin()) then
      raise exception 'Une écriture d’inventaire ne change que par sa régularisation.' using errcode = '42501';
    end if;
    if not exists (select 1 from public.operations_inventaire o join public.dossiers d on d.id = o.dossier_id
                    where o.id = new.operation_inventaire_id and o.dossier_id = new.dossier_id
                      and d.mode_comptable = 'engagement'
                      and new.date in (make_date(o.exercice, 12, 31), make_date(o.exercice + 1, 1, 1))) then
      raise exception 'Une écriture d’inventaire appartient à une régularisation de son dossier, en engagement, au 31 décembre de son exercice ou au 1er janvier suivant.'
        using errcode = '23514';
    end if;
  end if;
  return public.retour_declencheur(tg_op, old, new);
end;
$$;
create trigger ecritures_brouillon_inventaire
  before insert or delete or update of operation_inventaire_id, dossier_id, date, compte, sens, montant, libelle
  on public.ecritures_brouillon for each row execute function public.garder_ecriture_d_inventaire();
revoke execute on function public.garder_operations_inventaire() from public, anon, authenticated;
revoke execute on function public.garder_ecriture_d_inventaire() from public, anon, authenticated;

-- ══ 6. Enregistrer une régularisation, et son extourne ══
-- p_operation : { id (nul : une nouvelle), exercice, nature, compte_resultat, compte_regularisation, montant_centimes,
-- tva_centimes, objet, periode_debut, periode_fin, piece_citee_id } ; p_ecritures : les deux écritures que compose
-- `composerRegularisation` ({ date, journal, libelle, lignes: [{ compte, sens, centimes }] }) ; p_version_lue : la version
-- que la saisie remplace (nulle pour une nouvelle). Les refus, dans l'ordre du module : le mode du dossier, l'exercice, la
-- nature, le plan, les comptes, les montants, l'objet ; puis ceux que la base seule dit : la période, la pièce citée, la
-- version lue, les écritures proposées. Rend l'identifiant de la régularisation.
create function public.enregistrer_operation_inventaire(p_dossier_id uuid, p_operation jsonb, p_ecritures jsonb, p_version_lue integer)
 returns uuid
 language plpgsql
 security definer
 set search_path = public
as $fonction$
declare
  v_mode text;
  v_assujetti boolean;
  v_id uuid;
  v_exercice bigint;
  v_frontiere date;
  v_premier integer;
  v_nature text;
  v_charge boolean;
  v_resultat text;
  v_regul text;
  v_ht bigint;
  v_tva bigint;
  v_tva_lisible boolean;
  v_role text;
  v_compte_du_role text;
  v_compte_tva text;
  v_objet text;
  v_debut date;
  v_fin date;
  v_piece uuid;
  v_ancienne public.operations_inventaire%rowtype;
  v_cloture date;
  v_lendemain date;
  v_lignes jsonb;
  v_attendues jsonb;
  v_constatation jsonb;
  v_extourne jsonb;
  v_entete text;
  v_milieu text;
  v_lib text;
  v_conforme boolean;
  v_desequilibre integer;
begin
  -- 0. L'accès, avant toute lecture ; puis le verrou PARTAGÉ de la validation, avant toute lecture du gel.
  if p_dossier_id is null or auth.uid() is null or not coalesce(public.admin_du_dossier(p_dossier_id), false) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  select d.mode_comptable, coalesce(d.assujetti_tva, false) into v_mode, v_assujetti from public.dossiers d where d.id = p_dossier_id;
  if not found then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;

  -- 1. Le mode du dossier.
  if v_mode is distinct from 'engagement' then
    raise exception '%', 'L’inventaire ne s’écrit qu’en comptabilité d’engagement : un dossier en trésorerie (BNC, 2035) n’en reçoit aucun.'
      using errcode = '22023';
  end if;

  -- 2. L'exercice : lisible, pas figé, commencé (l'année lue à Paris), pas avant l'ouverture du dossier (ses à-nouveaux).
  v_exercice := public.inventaire_entier(p_operation -> 'exercice');
  if v_exercice is null or v_exercice < 2000 or v_exercice > 2100 then
    raise exception '%', 'L’exercice de la régularisation est illisible : une année entre 2000 et 2100.' using errcode = '22023';
  end if;
  v_frontiere := public.frontiere_validation(p_dossier_id);
  if v_frontiere is not null and v_exercice <= extract(year from v_frontiere) then
    raise exception '%', 'Cet exercice est validé : ses écritures d’inventaire ne changent plus.' using errcode = '23514';
  end if;
  if v_exercice > extract(year from (now() at time zone 'Europe/Paris')) then
    raise exception '%', 'Cet exercice n’est pas encore commencé : son inventaire ne se passe pas avant lui.' using errcode = '22023';
  end if;
  select extract(year from min(a.date))::integer into v_premier from public.a_nouveaux a where a.dossier_id = p_dossier_id;
  if v_premier is not null and v_exercice < v_premier then
    raise exception '%', 'Cet exercice précède l’ouverture du dossier dans l’application : son inventaire n’y a pas de place.'
      using errcode = '22023';
  end if;

  -- 3. La nature.
  v_nature := p_operation ->> 'nature';
  if v_nature = 'provision' then
    raise exception '%', 'Une provision s’écrit par son évaluation au 31 décembre, pas comme une régularisation.' using errcode = '22023';
  end if;
  if v_nature is null or not (v_nature = any (array['cca', 'pca', 'fnp', 'fae', 'charge_a_payer', 'produit_a_recevoir'])) then
    raise exception '%', 'La nature de la régularisation est inconnue : une charge ou un produit constaté d’avance, une facture non '
      || 'parvenue ou à établir, une charge à payer ou un produit à recevoir.' using errcode = '22023';
  end if;
  v_charge := v_nature = any (array['cca', 'fnp', 'charge_a_payer']);

  -- 4. Le plan : les rôles dont la nature a besoin, chacun à un compte de six chiffres sous sa racine.
  v_tva := public.inventaire_entier(p_operation -> 'tva_centimes');
  v_tva_lisible := v_tva is not null and v_tva >= 0;
  for v_role in select r.role from unnest(case v_nature
      when 'cca' then array['charges_constatees_avance']
      when 'pca' then array['produits_constates_avance']
      when 'fnp' then case when v_tva_lisible and v_tva > 0 then array['tva_factures_non_parvenues'] else array[]::text[] end
      when 'fae' then case when v_tva_lisible and v_tva > 0 then array['factures_a_etablir', 'tva_factures_a_etablir']
                           else array['factures_a_etablir'] end
      else array[]::text[] end) with ordinality as r(role, rang) order by r.rang
  loop
    v_compte_du_role := public.compte_du_role(p_dossier_id, v_role);
    if v_compte_du_role !~ '^[0-9]{6}$'
       or not starts_with(v_compte_du_role, (select c.racines[1] from public.roles_comptables c where c.role = v_role)) then
      raise exception '%', format('Le plan du dossier ne porte pas de compte « %s » sous le %s : le régler avant d’écrire l’inventaire.',
        case v_role when 'charges_constatees_avance' then 'Charges constatées d’avance'
                    when 'produits_constates_avance' then 'Produits constatés d’avance'
                    when 'factures_a_etablir' then 'Clients — factures à établir'
                    when 'tva_factures_non_parvenues' then 'TVA sur factures non parvenues'
                    else 'TVA sur factures à établir' end,
        (select c.racines[1] from public.roles_comptables c where c.role = v_role)) using errcode = '22023';
    end if;
  end loop;

  -- 5. Le compte de résultat : classe 6 du côté des charges, classe 7 du côté des produits.
  v_resultat := p_operation ->> 'compte_resultat';
  if v_resultat is null or v_resultat !~ '^[0-9]{3,}$' or left(v_resultat, 1) <> (case when v_charge then '6' else '7' end) then
    raise exception '%', case when v_charge then 'Le compte de charge est un compte de la classe 6 du plan du dossier.'
                              else 'Le compte de produit est un compte de la classe 7 du plan du dossier.' end
      using errcode = '22023';
  end if;

  -- 6. Le compte de régularisation, dans la liste fermée de sa nature (§ 4.4, INV1-Q1) ; jamais le 467 ni le 468 (INV-Q2).
  v_regul := p_operation ->> 'compte_regularisation';
  v_compte_du_role := case v_nature
    when 'cca' then public.compte_du_role(p_dossier_id, 'charges_constatees_avance')
    when 'pca' then public.compte_du_role(p_dossier_id, 'produits_constates_avance')
    when 'fnp' then public.compte_du_role(p_dossier_id, 'factures_non_parvenues')
    when 'fae' then public.compte_du_role(p_dossier_id, 'factures_a_etablir') end;
  if v_compte_du_role is not null and (v_compte_du_role !~ '^[0-9]{6}$'
       or not starts_with(v_compte_du_role, case v_nature when 'cca' then '486' when 'pca' then '487' when 'fnp' then '408' else '418' end)) then
    v_compte_du_role := null;
  end if;
  if v_regul is null or v_regul !~ '^[0-9]{3,}$' or not (case v_nature
       when 'cca' then v_regul = v_compte_du_role
       when 'pca' then v_regul = v_compte_du_role
       when 'fae' then v_regul = v_compte_du_role
       when 'fnp' then v_regul = v_compte_du_role or starts_with(v_regul, '4088')
       when 'charge_a_payer' then exists (select 1 from unnest(array['4282', '4286', '4382', '4386', '44812', '1688', '518']) r(racine)
                                           where starts_with(v_regul, r.racine))
       else exists (select 1 from unnest(array['4482', '439']) r(racine) where starts_with(v_regul, r.racine)) end) then
    raise exception '%', case v_nature
      when 'cca' then 'Une charge constatée d’avance s’écrit au compte des charges constatées d’avance du plan du dossier.'
      when 'pca' then 'Un produit constaté d’avance s’écrit au compte des produits constatés d’avance du plan du dossier.'
      when 'fnp' then 'Une facture non parvenue s’écrit au compte des factures non parvenues du plan du dossier, ou sous le 4088 pour des '
        || 'intérêts courus.'
      when 'fae' then 'Une facture à établir s’écrit au compte des factures à établir du plan du dossier.'
      when 'charge_a_payer' then 'Une charge à payer s’écrit sous le 4282, le 4286, le 4382, le 4386, le 44812, le 1688 ou le 518 ; jamais au '
        || '467 ni au 468, qui portent le compte du dirigeant.'
      else 'Un produit à recevoir s’écrit sous le 4482 ou le 439 ; jamais au 467 ni au 468, qui portent le compte du dirigeant.' end
      using errcode = '22023';
  end if;

  -- 7. Les montants : le montant, la TVA d'attente (une FNP ou une FAE d'un dossier assujetti, INV-Q3 (A)), leur somme.
  v_ht := public.inventaire_entier(p_operation -> 'montant_centimes');
  if v_ht is null or v_ht <= 0 then
    raise exception '%', 'Le montant est un nombre de centimes entier et positif.' using errcode = '22023';
  end if;
  if not v_tva_lisible then
    raise exception '%', 'La TVA est un nombre de centimes entier, positif ou nul.' using errcode = '22023';
  end if;
  if v_tva > 0 and not (v_nature = any (array['fnp', 'fae'])) then
    raise exception '%', 'Seules une facture non parvenue et une facture à établir portent une TVA d’attente.' using errcode = '22023';
  end if;
  if v_tva > 0 and not v_assujetti then
    raise exception '%', 'Un dossier qui ne collecte pas la TVA écrit la régularisation toutes taxes comprises, sans ligne de TVA.'
      using errcode = '22023';
  end if;
  if v_ht + v_tva > 9007199254740991 then
    raise exception '%', 'Le montant est un nombre de centimes entier et positif.' using errcode = '22023';
  end if;

  -- 8. L'objet : 1 à 200 caractères, sur une ligne, rogné comme le module le rogne.
  v_objet := public.inventaire_rogne(p_operation ->> 'objet');
  if v_objet is null or char_length(v_objet) < 1 or char_length(v_objet) > 200 or v_objet ~ '[\r\n]' then
    raise exception '%', 'L’objet de la régularisation tient en 1 à 200 caractères, sur une ligne : il part au FEC.' using errcode = '22023';
  end if;

  -- 9. La période couverte, facultative : deux dates civiles, le début au plus tard à la fin.
  if p_operation -> 'periode_debut' is not null and jsonb_typeof(p_operation -> 'periode_debut') <> 'null'
     or p_operation -> 'periode_fin' is not null and jsonb_typeof(p_operation -> 'periode_fin') <> 'null' then
    begin
      if coalesce(p_operation ->> 'periode_debut', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         or coalesce(p_operation ->> 'periode_fin', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception using errcode = '22007';
      end if;
      v_debut := (p_operation ->> 'periode_debut')::date;
      v_fin := (p_operation ->> 'periode_fin')::date;
    exception when others then
      v_debut := null;
      v_fin := null;
    end;
    if v_debut is null or v_fin is null or v_debut > v_fin
       or to_char(v_debut, 'YYYY-MM-DD') <> p_operation ->> 'periode_debut'
       or to_char(v_fin, 'YYYY-MM-DD') <> p_operation ->> 'periode_fin' then
      raise exception '%', 'La période couverte se lit en deux dates civiles, son début au plus tard à sa fin.' using errcode = '22023';
    end if;
  end if;

  -- 10. La pièce citée, facultative : une pièce de ce dossier.
  if p_operation -> 'piece_citee_id' is not null and jsonb_typeof(p_operation -> 'piece_citee_id') <> 'null' then
    if coalesce(p_operation ->> 'piece_citee_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or not exists (select 1 from public.pieces p where p.id = (p_operation ->> 'piece_citee_id')::uuid and p.dossier_id = p_dossier_id) then
      raise exception '%', 'La pièce citée n’est pas une pièce de ce dossier.' using errcode = '22023';
    end if;
    v_piece := (p_operation ->> 'piece_citee_id')::uuid;
  end if;

  -- 11. La version lue : celle de la régularisation que la saisie remplace, sous son verrou ; aucune pour une nouvelle.
  if p_operation -> 'id' is not null and jsonb_typeof(p_operation -> 'id') <> 'null' then
    if coalesce(p_operation ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception '%', 'Cette régularisation a changé depuis sa lecture : relire l’inventaire avant de l’écrire.' using errcode = '40001';
    end if;
    v_id := (p_operation ->> 'id')::uuid;
    select * into v_ancienne from public.operations_inventaire o where o.id = v_id and o.dossier_id = p_dossier_id for update;
    if not found or p_version_lue is null or p_version_lue <> v_ancienne.version then
      raise exception '%', 'Cette régularisation a changé depuis sa lecture : relire l’inventaire avant de l’écrire.' using errcode = '40001';
    end if;
    if v_frontiere is not null and v_ancienne.exercice <= extract(year from v_frontiere) then
      raise exception '%', 'Cet exercice est validé : ses écritures d’inventaire ne changent plus.' using errcode = '23514';
    end if;
  elsif p_version_lue is not null then
    raise exception '%', 'Une régularisation nouvelle ne porte pas de version lue.' using errcode = '22023';
  end if;

  -- 12. Les écritures : la constatation au 31 décembre et son extourne au 1er janvier suivant, recomposées en entiers et
  --     comparées en MULTIENSEMBLE à ce que l'application propose (date, compte, sens, centimes) ; le journal OD ; le libellé
  --     composé — « <sigle> 31/12/AAAA — <libellé du compte> — <objet> », le libellé du compte facultatif, et l'extourne
  --     « Extourne — » devant lui.
  if v_tva > 0 then
    v_compte_tva := public.compte_du_role(p_dossier_id, case v_nature when 'fnp' then 'tva_factures_non_parvenues' else 'tva_factures_a_etablir' end);
  end if;
  v_cloture := make_date(v_exercice::integer, 12, 31);
  v_lendemain := make_date(v_exercice::integer + 1, 1, 1);
  v_lignes := case v_nature
    when 'cca' then jsonb_build_array(jsonb_build_array(v_regul, 'debit', v_ht), jsonb_build_array(v_resultat, 'credit', v_ht))
    when 'pca' then jsonb_build_array(jsonb_build_array(v_resultat, 'debit', v_ht), jsonb_build_array(v_regul, 'credit', v_ht))
    when 'charge_a_payer' then jsonb_build_array(jsonb_build_array(v_resultat, 'debit', v_ht), jsonb_build_array(v_regul, 'credit', v_ht))
    when 'produit_a_recevoir' then jsonb_build_array(jsonb_build_array(v_regul, 'debit', v_ht), jsonb_build_array(v_resultat, 'credit', v_ht))
    when 'fnp' then jsonb_build_array(jsonb_build_array(v_resultat, 'debit', v_ht), jsonb_build_array(v_compte_tva, 'debit', v_tva),
                                      jsonb_build_array(v_regul, 'credit', v_ht + v_tva))
    else jsonb_build_array(jsonb_build_array(v_regul, 'debit', v_ht + v_tva), jsonb_build_array(v_resultat, 'credit', v_ht),
                           jsonb_build_array(v_compte_tva, 'credit', v_tva)) end;
  select coalesce(jsonb_agg(x.ligne order by x.rang), '[]'::jsonb) into v_attendues from (
    select l.rang, jsonb_build_object('date', to_char(v_cloture, 'YYYY-MM-DD'), 'compte', l.v ->> 0, 'sens', l.v ->> 1,
                                      'centimes', (l.v ->> 2)::bigint) as ligne
      from jsonb_array_elements(v_lignes) with ordinality as l(v, rang) where (l.v ->> 2)::bigint > 0
    union all
    select 100 + l.rang, jsonb_build_object('date', to_char(v_lendemain, 'YYYY-MM-DD'), 'compte', l.v ->> 0,
                                            'sens', case l.v ->> 1 when 'debit' then 'credit' else 'debit' end,
                                            'centimes', (l.v ->> 2)::bigint)
      from jsonb_array_elements(v_lignes) with ordinality as l(v, rang) where (l.v ->> 2)::bigint > 0) x;

  v_conforme := jsonb_typeof(p_ecritures) = 'array' and jsonb_array_length(p_ecritures) = 2;
  if v_conforme then
    select e.v into v_constatation from jsonb_array_elements(p_ecritures) e(v) where e.v ->> 'date' = to_char(v_cloture, 'YYYY-MM-DD');
    select e.v into v_extourne from jsonb_array_elements(p_ecritures) e(v) where e.v ->> 'date' = to_char(v_lendemain, 'YYYY-MM-DD');
    v_conforme := v_constatation is not null and v_extourne is not null
      and v_constatation ->> 'journal' = 'OD' and v_extourne ->> 'journal' = 'OD';
  end if;
  if v_conforme then
    with recues as (
      select e.v ->> 'date' as d, l.v ->> 'compte' as compte, l.v ->> 'sens' as sens, public.inventaire_entier(l.v -> 'centimes') as centimes
        from jsonb_array_elements(p_ecritures) e(v)
        cross join lateral jsonb_array_elements(case when jsonb_typeof(e.v -> 'lignes') = 'array' then e.v -> 'lignes' else '[]'::jsonb end) l(v)
    ), attendues as (
      select a.v ->> 'date' as d, a.v ->> 'compte' as compte, a.v ->> 'sens' as sens, (a.v ->> 'centimes')::bigint as centimes
        from jsonb_array_elements(v_attendues) a(v)
    )
    select (select count(*) from recues) = (select count(*) from attendues)
       and not exists (select d, compte, sens, centimes from attendues except all select d, compte, sens, centimes from recues)
      into v_conforme;
  end if;
  if v_conforme then
    v_entete := case v_nature when 'cca' then 'CCA' when 'pca' then 'PCA' when 'fnp' then 'FNP' when 'fae' then 'FAE'
                  when 'charge_a_payer' then 'Charge à payer' else 'Produit à recevoir' end || ' 31/12/' || v_exercice;
    v_lib := v_constatation ->> 'libelle';
    if v_lib is distinct from v_entete || ' — ' || v_objet then
      v_milieu := null;
      if starts_with(coalesce(v_lib, ''), v_entete || ' — ') and right(v_lib, char_length(' — ' || v_objet)) = ' — ' || v_objet
         and char_length(v_lib) > char_length(v_entete || ' — ' || ' — ' || v_objet) then
        v_milieu := substr(v_lib, char_length(v_entete || ' — ') + 1,
                           char_length(v_lib) - char_length(v_entete || ' — ') - char_length(' — ' || v_objet));
      end if;
      v_conforme := v_milieu is not null and v_milieu <> '' and v_milieu = public.inventaire_rogne(v_milieu)
        and v_milieu !~ '[[:cntrl:]]';
    end if;
    v_conforme := v_conforme and v_extourne ->> 'libelle' = 'Extourne — ' || v_lib;
  end if;
  if not coalesce(v_conforme, false) then
    raise exception '%', 'Les écritures proposées ne sont pas celles de la régularisation : les recomposer.' using errcode = '22023';
  end if;

  -- 13. L'écriture : la régularisation, puis ses deux écritures, par la porte que la garde ouvre à ce dossier seul.
  perform set_config('jd.inventaire', p_dossier_id::text, true);
  if v_id is null then
    insert into public.operations_inventaire (dossier_id, exercice, nature, compte_resultat, compte_regularisation,
                                              montant_centimes, tva_centimes, periode_debut, periode_fin, objet, piece_citee_id,
                                              version, cree_par)
    values (p_dossier_id, v_exercice, v_nature, v_resultat, v_regul, v_ht, v_tva, v_debut, v_fin, v_objet, v_piece, 1, auth.uid())
    returning id into v_id;
  else
    delete from public.ecritures_brouillon e where e.operation_inventaire_id = v_id;
    update public.operations_inventaire o
       set exercice = v_exercice, nature = v_nature, compte_resultat = v_resultat, compte_regularisation = v_regul,
           montant_centimes = v_ht, tva_centimes = v_tva, periode_debut = v_debut, periode_fin = v_fin, objet = v_objet,
           piece_citee_id = v_piece, version = o.version + 1, modifie_par = auth.uid(), modifie_le = now()
     where o.id = v_id;
  end if;
  insert into public.ecritures_brouillon (dossier_id, operation_inventaire_id, date, compte, libelle, montant, sens, statut)
  select p_dossier_id, v_id, (a.v ->> 'date')::date, a.v ->> 'compte',
         case when (a.v ->> 'date')::date = v_cloture then v_lib else 'Extourne — ' || v_lib end,
         round(((a.v ->> 'centimes')::numeric) / 100, 2), a.v ->> 'sens', 'proposee'
    from jsonb_array_elements(v_attendues) with ordinality as a(v, rang) order by a.rang;
  select count(*) into v_desequilibre from (
    select e.date from public.ecritures_brouillon e where e.operation_inventaire_id = v_id
     group by e.date having sum(case when e.sens = 'debit' then e.montant else -e.montant end) <> 0) x;
  if v_desequilibre > 0 then
    raise exception 'Écriture d’inventaire déséquilibrée.' using errcode = '23514';
  end if;
  perform set_config('jd.inventaire', '', true);
  return v_id;
end
$fonction$;
revoke execute on function public.enregistrer_operation_inventaire(uuid, jsonb, jsonb, integer) from public, anon;
grant execute on function public.enregistrer_operation_inventaire(uuid, jsonb, jsonb, integer) to authenticated;
comment on function public.enregistrer_operation_inventaire(uuid, jsonb, jsonb, integer) is
  'INV2 (ligne 35) : enregistre ou remplace une régularisation d''inventaire d''un dossier en engagement, et ses deux écritures (la constatation au 31 décembre, l''extourne au 1er janvier suivant), recomposées en entiers et comparées à celles que l''application propose. Le cabinet du dossier.';

-- ══ 7. Retirer une régularisation, et son extourne ══
-- Les refus : l'accès, le mode du dossier, le gel (une ligne validée compris), la version lue. Rend le nombre de lignes retirées.
create function public.retirer_operation_inventaire(p_id uuid, p_version_lue integer)
 returns integer
 language plpgsql
 security definer
 set search_path = public
as $fonction$
declare
  v_dossier_id uuid;
  v_operation public.operations_inventaire%rowtype;
  v_frontiere date;
  v_lignes integer;
begin
  select o.dossier_id into v_dossier_id from public.operations_inventaire o where o.id = p_id;
  if p_id is null or v_dossier_id is null or auth.uid() is null or not coalesce(public.admin_du_dossier(v_dossier_id), false) then
    raise exception 'Accès refusé à cette régularisation.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(v_dossier_id));
  select * into v_operation from public.operations_inventaire o where o.id = p_id for update;
  if not found then
    raise exception '%', 'Cette régularisation a changé depuis sa lecture : relire l’inventaire avant de l’écrire.' using errcode = '40001';
  end if;
  if (select d.mode_comptable from public.dossiers d where d.id = v_dossier_id) is distinct from 'engagement' then
    raise exception '%', 'L’inventaire ne s’écrit qu’en comptabilité d’engagement : un dossier en trésorerie (BNC, 2035) n’en reçoit aucun.'
      using errcode = '22023';
  end if;
  v_frontiere := public.frontiere_validation(v_dossier_id);
  if (v_frontiere is not null and v_operation.exercice <= extract(year from v_frontiere))
     or exists (select 1 from public.ecritures_brouillon e where e.operation_inventaire_id = p_id and e.statut <> 'proposee') then
    raise exception '%', 'Cet exercice est validé : ses écritures d’inventaire ne changent plus.' using errcode = '23514';
  end if;
  if p_version_lue is null or p_version_lue <> v_operation.version then
    raise exception '%', 'Cette régularisation a changé depuis sa lecture : relire l’inventaire avant de l’écrire.' using errcode = '40001';
  end if;
  perform set_config('jd.inventaire', v_dossier_id::text, true);
  delete from public.ecritures_brouillon e where e.operation_inventaire_id = p_id;
  get diagnostics v_lignes = row_count;
  delete from public.operations_inventaire o where o.id = p_id;
  perform set_config('jd.inventaire', '', true);
  return v_lignes;
end
$fonction$;
revoke execute on function public.retirer_operation_inventaire(uuid, integer) from public, anon;
grant execute on function public.retirer_operation_inventaire(uuid, integer) to authenticated;
comment on function public.retirer_operation_inventaire(uuid, integer) is
  'INV2 (ligne 35) : retire une régularisation d''inventaire et ses deux écritures, tant que son exercice n''est pas figé, contre la version lue. Le cabinet du dossier.';

-- ══ 8. La double authentification exigée, si elle est déjà en base ══
do $deux_facteurs$
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    execute 'create policy deux_facteurs on public.operations_inventaire as restrictive for all to authenticated '
      || 'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))';
  end if;
end
$deux_facteurs$;
