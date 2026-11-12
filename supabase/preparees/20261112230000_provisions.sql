-- INV4 : LES PROVISIONS, EN BASE (ligne 35) — PRÉPARÉE le 12/11/2026, PAS APPLIQUÉE. À COLLER : l'évaluation retire les lignes
-- qu'elle remplace et `retirer_provision` retire une provision (le mot de la suppression retient `apply_migration`). Rien de
-- ce qui existe ne se détruit : une table, une colonne, deux contraintes, deux déclencheurs, six fonctions et six rôles
-- s'ajoutent ; aucune ligne, aucune colonne ni aucun objet ne se retire ni ne change.
--
-- ELLE DÉPEND D'INV2 (`operations_d_inventaire`), qui doit être en base avant elle : sa garde de tête l'exige, aux empreintes
-- des fonctions d'INV2 sur lesquelles elle compte. Elle s'accommode de LIA2 et de MCB5g, présentes ou non (elle n'ajoute
-- aucune colonne au brouillon : les écritures d'une évaluation citent `operation_inventaire_id`, la colonne d'INV2).
--
-- La conception : docs/conceptions/35-inventaire.md, § 3.1, § 4.2, § 4.4 à § 4.7, INV-Q4 et INV-Q11. Le module que la base
-- redit : src/lib/inventaire.ts (INV1), `composerEvaluation` (par différence) et `refusDeLaVentilation`, sous leurs mots,
-- leurs codes et leur ordre ; src/lib/provisionsEnBase.test.ts les confronte au texte de cette migration. Le récit :
-- HISTORIQUE.md, « 12/11/2026 — INV4 : LES PROVISIONS, EN BASE (LIGNE 35) (PRÉPARÉE, PAS APPLIQUÉE) ». Son retour :
-- supabase/preparees/retour/20261112230100_retour_provisions.sql. Son essai : supabase/essais/provisions.sql (une réplique
-- seulement, une transaction) ; puis rls.sql (le bloc PV).
--
-- SOURCES. Code de commerce, art. L123-20 (« Même en cas d'absence ou d'insuffisance du bénéfice, il est procédé aux
-- amortissements, dépréciations et provisions nécessaires ») et L123-12 (l'inventaire). PCG (règlement ANC n° 2014-03
-- modifié, numérotation du 1er janvier 2026), art. 1211-15 et 1214-49 cités par la conception (le réajustement à la fin de
-- chaque exercice : une dotation si la provision augmente, une reprise si elle diminue ou devient sans objet), et la liste
-- des comptes (151 et 1511, 491, 6815, 6817, 7815, 7817). Légifrance et l'ANC.
--
-- CE QU'ELLE POSE :
--   1. Six rôles au catalogue (`roles_comptables`), rangs 420 à 470, libres entre ceux d'INV2 (360 à 410) et de LIA2 (500 à
--      590) : 151, 491, 6815, 6817, 7815, 7817 (§ 4.4). Seuls les rôles des dotations et des reprises se lisent au plan pour
--      écrire une évaluation ; le compte d'une provision est le sien, sous la racine de son genre (comme le module le juge).
--   2. `provisions` : une provision pour risques (151) ou la dépréciation d'une créance (491) d'un dossier en ENGAGEMENT,
--      saisie par le cabinet, jamais devinée. Une policy `for all to authenticated` sur `admin_du_dossier`, aucune branche
--      client ; une garde refuse toute écriture que la policy laisserait passer hors de `enregistrer_provision` et
--      `retirer_provision`, sauf la réinsertion du super-administrateur (la restauration). Son état « soldée » se DÉDUIT de
--      sa dernière évaluation (une cible nulle) : aucune colonne à tenir à jour par trois chemins.
--   3. L'évaluation au 31 décembre : une ligne de `operations_inventaire` de nature `provision` (sa cible, `provision_id`),
--      une évaluation par provision et par exercice (unicité TOTALE `(provision_id, exercice)`). Ses écritures citent
--      `operation_inventaire_id` au journal OD, sans extourne. INV-Q4, à la recommandation (A) que le cabinet n'a pas encore
--      tranchée : PAR DIFFÉRENCE — l'écart entre la cible et la provision précédente (la dernière évaluation, ou la part
--      reprise, ou zéro), 681x au débit et la provision au crédit s'il est positif, la provision au débit et 781x au crédit
--      s'il est négatif, AUCUNE écriture s'il est nul. La base ne compose donc jamais la reprise intégrale suivie d'une dotation
--      (B) que le module sait aussi composer : (B) demanderait une autre migration.
--   4. La recomposition EN ENTIERS de ce que `composerEvaluation` propose et sa comparaison en MULTIENSEMBLE (compte, sens,
--      centimes), le libellé composé au caractère près ; la provision précédente lue EN BASE, jamais celle de l'appelant.
--   5. INV-Q11, à la recommandation (A) : le 151 ou le 491 repris d'une balance se VENTILE en provisions nommées, chacune sa
--      part (`reprise_centimes`), au premier exercice du dossier ; leur somme ne dépasse jamais le solde repris du compte, et
--      la première évaluation d'une part reprise exige qu'elle le fasse exactement. Neutre envers (B) : une provision unique
--      qui porte tout le solde passe aussi. Un compte repris sans aucune provision ne se juge qu'à la validation (INV3).
--   6. Le gel : une provision d'un exercice validé, ou déjà évaluée, ne change ni ne se retire plus ; seule la dernière
--      évaluation d'une provision change ou se retire (par `retirer_operation_inventaire`, d'INV2), sinon l'écart de la
--      suivante mentirait. Le verrou PARTAGÉ de la validation se prend avant toute lecture du gel, puis un verrou propre aux
--      provisions du dossier, qui sérialise la ventilation et la chaîne des évaluations.
--   7. Si la double authentification exigée (`deux_facteurs_exiges`) est déjà en base, la policy restrictive `deux_facteurs`
--      sur la table neuve.
--
-- CE QU'ELLE NE FAIT PAS : la validation (la sorte `inventaire`, les filets, dont la ventilation d'un compte repris sans
-- provision : INV3), le relevé des provisions 2033-D (ligne 37), l'écran (INV5). Aucun dossier n'est en engagement en
-- production (12/11/2026) : rien ne s'y écrit avant INV5.

do $garde$
declare
  v_f text;
begin
  if to_regclass('public.provisions') is not null
     or exists (select 1 from public.roles_comptables r where r.role in ('provisions_risques', 'depreciation_clients',
                  'dotations_provisions_exploitation', 'dotations_depreciations_actif_circulant',
                  'reprises_provisions_exploitation', 'reprises_depreciations_actif_circulant')) then
    raise exception 'La migration provisions est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if to_regclass('public.operations_inventaire') is null then
    raise exception 'La migration provisions dépend de operations_d_inventaire (INV2), qui n''est pas en base : coller INV2 d''abord.';
  end if;
  if exists (select 1 from pg_attribute a where a.attrelid = 'public.operations_inventaire'::regclass
               and a.attname = 'provision_id' and not a.attisdropped) then
    raise exception 'La migration provisions est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if to_regclass('public.factures_emises') is null or to_regclass('public.a_nouveaux') is null
     or exists (select 1 from (values ('public.pieces', 'type_piece'), ('public.factures_emises', 'statut'),
                  ('public.factures_emises', 'dossier_id'), ('public.ecritures_brouillon', 'operation_inventaire_id')) c(t, n)
                where not exists (select 1 from pg_attribute a where a.attrelid = c.t::regclass and a.attname = c.n and not a.attisdropped)) then
    raise exception 'provisions : une table ou une colonne dont elle dépend manque : relire la base.';
  end if;
  -- Les fonctions qu'elle appelle, ou dont elle attend la conduite, à l'empreinte de leur corps (les retours chariot écartés) :
  -- celles de la production, relevées le 12/11/2026 ; celles d'INV2, telles que sa migration préparée les pose (md5 9707d409…).
  for v_f in select x.f from (values
      ('admin_du_dossier(uuid)', '30e9b7246cb939741fe58f4ffc27adf4'),
      ('is_super_admin()', 'a9159138778422a43ba8d8c21240c9bb'),
      ('cle_validation(uuid)', 'bcbb03363036aa6aa037c0b829e3382f'),
      ('frontiere_validation(uuid)', '24a04846471ec5e8cdbae6f3b9f4a2e8'),
      ('compte_du_role(uuid, text)', '6108ab75d148aa2800484b89bb112c70'),
      ('retour_declencheur(text, anyelement, anyelement)', 'bc80cac6efe46d15f86d1820eb56c47e'),
      ('inventaire_entier(jsonb)', '1fe9e402f3aa49b740b891d618e26998'),
      ('inventaire_rogne(text)', 'd41e3956c932aa58c874f941a6c3d501'),
      ('garder_operations_inventaire()', '7c27098f1e1d57539aed192ec28bcb31'),
      ('garder_ecriture_d_inventaire()', '521fe44ebccca4123ade10f546b5eeec'),
      ('enregistrer_operation_inventaire(uuid, jsonb, jsonb, integer)', '5fea6e91a18b908bc5d4a6f64de82d94'),
      ('retirer_operation_inventaire(uuid, integer)', '9588e1104ce918565702d6db5ec137db')) as x(f, empreinte)
    where (select md5(replace(p.prosrc, chr(13) || chr(10), chr(10))) from pg_proc p where p.oid = to_regprocedure('public.' || x.f))
          is distinct from x.empreinte
  loop
    raise exception 'La fonction % n''est plus celle que cette migration suppose : relire la migration contre la base avant de l''appliquer.', v_f;
  end loop;
  -- Les rangs et les racines des six rôles sont libres ; aucune opération d'inventaire ne porte déjà la nature `provision`
  -- (INV2 la refuse : sa nouvelle contrainte n'aurait pas de provision à lui donner).
  if exists (select 1 from public.roles_comptables r where r.ordre >= 420 and r.ordre <= 470)
     or exists (select 1 from public.roles_comptables r cross join unnest(r.racines) as u(racine)
                cross join unnest(array['151', '491', '6815', '6817', '7815', '7817']) as n(racine)
                where starts_with(u.racine, n.racine) or starts_with(n.racine, u.racine)) then
    raise exception 'Le catalogue des rôles n''est plus celui que cette migration suppose (rangs 420 à 470, racines 151, 491, 6815, 6817, 7815, 7817) : la relire.';
  end if;
  if exists (select 1 from public.operations_inventaire o where o.nature = 'provision') then
    raise exception 'provisions : une opération d''inventaire porte déjà la nature « provision » : la relire avant d''appliquer.';
  end if;
end
$garde$;

-- ══ 1. Les six rôles des provisions (§ 4.4) ══
-- Le 151100 porte le libellé de son compte au PCG, le 1511 (« Provisions pour litiges ») : le cabinet ouvre au plan tout autre
-- compte du 151 (garanties, amendes, pertes sur contrats, autres risques) que la provision cite.
insert into public.roles_comptables (role, racines, compte_defaut, libelle_defaut, prefixe_auxiliaire_defaut, ordre) values
  ('provisions_risques', array['151'], '151100', 'Provisions pour litiges', null, 420),
  ('depreciation_clients', array['491'], '491000', 'Dépréciations des comptes de clients', null, 430),
  ('dotations_provisions_exploitation', array['6815'], '681500', 'Dotations aux provisions d''exploitation', null, 440),
  ('dotations_depreciations_actif_circulant', array['6817'], '681700', 'Dotations aux dépréciations des actifs circulants', null, 450),
  ('reprises_provisions_exploitation', array['7815'], '781500', 'Reprises sur provisions d''exploitation', null, 460),
  ('reprises_depreciations_actif_circulant', array['7817'], '781700', 'Reprises sur dépréciations des actifs circulants', null, 470);

-- ══ 2. Les provisions ══
create table public.provisions (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  genre text not null,
  compte_provision text not null,
  objet text not null,
  facture_id uuid references public.factures_emises(id),
  piece_citee_id uuid references public.pieces(id),
  ouverte_en integer not null,
  reprise_centimes bigint,
  version integer not null default 1,
  cree_par uuid not null,
  cree_le timestamptz not null default now(),
  modifie_par uuid,
  modifie_le timestamptz,
  constraint provisions_genre check (genre = any (array['risque', 'depreciation_creance'])),
  -- Le compte sous la racine de son genre : le 151 pour un risque, le 491 pour la dépréciation d'une créance.
  constraint provisions_compte check (
    compte_provision ~ '^[0-9]{3,}$' and left(compte_provision, 3) = (case genre when 'risque' then '151' else '491' end)),
  constraint provisions_objet check (char_length(objet) >= 1 and char_length(objet) <= 200 and objet !~ '[\r\n]'),
  -- Une créance se cite une fois : sa facture émise (la dépréciation seule), ou sa pièce.
  constraint provisions_creance check (
    num_nonnulls(facture_id, piece_citee_id) <= 1 and (facture_id is null or genre = 'depreciation_creance')),
  constraint provisions_ouverte_en check (ouverte_en >= 2000 and ouverte_en <= 2100),
  -- La part du solde repris d'une balance (INV-Q11), en centimes que l'application relit sans perte ; nulle : une provision
  -- née dans l'application.
  constraint provisions_reprise check (
    reprise_centimes is null or (reprise_centimes >= 0 and reprise_centimes <= 9007199254740991)),
  constraint provisions_version check (version >= 1)
);
create index provisions_dossier on public.provisions (dossier_id, compte_provision);
create index provisions_facture on public.provisions (facture_id) where facture_id is not null;
create index provisions_piece_citee on public.provisions (piece_citee_id) where piece_citee_id is not null;
alter table public.provisions enable row level security;
comment on table public.provisions is
  'INV4 (ligne 35) : une provision pour risques (151) ou la dépréciation d''une créance (491) d''un dossier en engagement, saisie par le cabinet. Écrite par enregistrer_provision et retirer_provision seules ; ses évaluations au 31 décembre sont des operations_inventaire de nature provision.';
comment on column public.provisions.ouverte_en is
  'L''exercice de son ouverture : celui de sa première évaluation, ou le premier exercice du dossier pour une part reprise (INV-Q11). Elle ne s''évalue pas avant.';
comment on column public.provisions.reprise_centimes is
  'INV-Q11 : sa part du solde repris de son compte dans les à-nouveaux de la balance reprise ; la provision précédente de sa première évaluation. Nulle : une provision née dans l''application.';

-- Le cabinet du dossier, des deux côtés ; aucun client, aucun droit d'accès (l'inventaire est un travail du cabinet). La
-- garde refuse ce que la policy laisserait écrire hors des deux fonctions ; le super-administrateur réinsère (la restauration).
create policy provisions_cabinet on public.provisions
  for all to authenticated using (public.admin_du_dossier(dossier_id)) with check (public.admin_du_dossier(dossier_id));

-- ══ 3. L'évaluation d'une provision, une opération d'inventaire ══
alter table public.operations_inventaire add column provision_id uuid
  constraint operations_inventaire_provision_id_fkey references public.provisions(id);
-- Une opération de nature `provision` cite sa provision, et elle seule ; sans TVA, sans période ni pièce (la provision porte sa
-- citation) ; son compte de résultat est celui d'une dotation ou d'une reprise, son compte de régularisation celui de la
-- provision (la garde le rapproche de la provision citée).
alter table public.operations_inventaire add constraint operations_inventaire_evaluation check (
  (nature = 'provision') = (provision_id is not null)
  and (provision_id is null
       or (tva_centimes = 0 and periode_debut is null and periode_fin is null and piece_citee_id is null
           and left(compte_resultat, 4) = any (array['6815', '6817', '7815', '7817'])
           and left(compte_regularisation, 3) = any (array['151', '491']))));
-- Une évaluation par provision et par exercice : une contrainte TOTALE (les régularisations, au `provision_id` nul, ne se
-- heurtent pas), jamais un index unique partiel.
alter table public.operations_inventaire add constraint operations_inventaire_une_evaluation_par_exercice
  unique (provision_id, exercice);
comment on column public.operations_inventaire.provision_id is
  'INV4 (ligne 35) : la provision dont cette opération est l''évaluation au 31 décembre (nature provision, montant_centimes sa cible) ; écrite par enregistrer_evaluation_provision seule.';

-- ══ 4. La provision précédente, privée ══
-- La cible de la dernière évaluation d'avant l'exercice ; à défaut, la part reprise ; à défaut, zéro. Lue en base par
-- l'évaluation, jamais reçue de l'appelant ; la validation (INV3) la relira pour recomposer.
create function public.provision_cible_precedente(p_provision_id uuid, p_exercice integer) returns bigint
language sql stable set search_path = public as $$
  select coalesce(
    (select o.montant_centimes from public.operations_inventaire o
      where o.provision_id = p_provision_id and o.exercice < p_exercice order by o.exercice desc limit 1),
    (select coalesce(p.reprise_centimes, 0) from public.provisions p where p.id = p_provision_id))
$$;
revoke execute on function public.provision_cible_precedente(uuid, integer) from public, anon, authenticated;

-- ══ 5. Les gardes ══
-- La provision : écrite par ses deux fonctions seules (le réglage local `jd.provisions`, qu'elles posent sur leur dossier) ou
-- réinsérée par le super-administrateur (la restauration, qui réinsère les exercices validés en dernier) ; celle d'un exercice
-- figé, ou déjà évaluée, ne change ni ne se retire plus. Le départ du dossier l'emporte.
create function public.garder_provisions() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_derniere integer;
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.dossiers where id = old.dossier_id) then
    return old;
  end if;
  if coalesce(current_setting('jd.provisions', true), '')
       is distinct from (case when tg_op = 'DELETE' then old.dossier_id else new.dossier_id end)::text
     and not (tg_op = 'INSERT' and public.is_super_admin()) then
    raise exception 'Une provision ne s’écrit que par enregistrer_provision et retirer_provision.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.dossier_id is distinct from old.dossier_id then
    raise exception 'Une provision ne change pas de dossier.' using errcode = '42501';
  end if;
  if tg_op <> 'INSERT' then
    perform pg_advisory_xact_lock_shared(public.cle_validation(old.dossier_id));
    v_derniere := extract(year from public.frontiere_validation(old.dossier_id))::integer;
    if old.ouverte_en <= v_derniere then
      raise exception 'Cet exercice est validé : ses écritures d’inventaire ne changent plus.' using errcode = '23514';
    end if;
    if exists (select 1 from public.operations_inventaire o where o.provision_id = old.id) then
      raise exception 'Cette provision est déjà évaluée : elle ne change plus ; retirer d’abord ses évaluations.' using errcode = '23514';
    end if;
  end if;
  if tg_op <> 'DELETE' then
    perform pg_advisory_xact_lock_shared(public.cle_validation(new.dossier_id));
    v_derniere := extract(year from public.frontiere_validation(new.dossier_id))::integer;
    if new.ouverte_en <= v_derniere then
      raise exception 'Cet exercice est validé : ses écritures d’inventaire ne changent plus.' using errcode = '23514';
    end if;
  end if;
  return public.retour_declencheur(tg_op, old, new);
end;
$$;
create trigger provisions_par_ses_fonctions before insert or update or delete on public.provisions
  for each row execute function public.garder_provisions();

-- L'évaluation : elle appartient à une provision de son dossier, ouverte au plus tard sur son exercice, à son compte ; seule
-- la DERNIÈRE évaluation d'une provision change ou se retire, et aucune ne s'insère avant une plus récente — l'écart de la
-- suivante se compte sur elle. La réinsertion du super-administrateur (la restauration, dans l'ordre de la sauvegarde) n'a
-- pas à suivre l'ordre des exercices. Le départ du dossier l'emporte. La garde d'INV2 tient le reste (les deux fonctions).
create function public.garder_evaluations_de_provision() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.dossiers where id = old.dossier_id) then
    return old;
  end if;
  if tg_op <> 'INSERT' and old.provision_id is not null
     and exists (select 1 from public.operations_inventaire o where o.provision_id = old.provision_id and o.exercice > old.exercice) then
    raise exception 'Cette provision est évaluée sur un exercice plus récent : seule sa dernière évaluation change.' using errcode = '23514';
  end if;
  if tg_op <> 'DELETE' and new.provision_id is not null then
    if not exists (select 1 from public.provisions p where p.id = new.provision_id and p.dossier_id = new.dossier_id
                     and new.exercice >= p.ouverte_en and new.compte_regularisation = p.compte_provision) then
      raise exception 'Une évaluation appartient à une provision de son dossier, ouverte au plus tard sur son exercice, à son compte.'
        using errcode = '23514';
    end if;
    if not (tg_op = 'INSERT' and public.is_super_admin() and coalesce(current_setting('jd.inventaire', true), '') = '')
       and exists (select 1 from public.operations_inventaire o where o.provision_id = new.provision_id and o.exercice > new.exercice) then
      raise exception 'Cette provision est évaluée sur un exercice plus récent : seule sa dernière évaluation change.' using errcode = '23514';
    end if;
  end if;
  return public.retour_declencheur(tg_op, old, new);
end;
$$;
create trigger operations_inventaire_evaluation before insert or update or delete on public.operations_inventaire
  for each row execute function public.garder_evaluations_de_provision();
revoke execute on function public.garder_provisions() from public, anon, authenticated;
revoke execute on function public.garder_evaluations_de_provision() from public, anon, authenticated;

-- ══ 6. Enregistrer une provision ══
-- p_provision : { id (nul : une nouvelle), genre, compte_provision, objet, ouverte_en, facture_id, piece_citee_id,
-- reprise_centimes } ; p_version_lue : la version que la saisie remplace (nulle pour une nouvelle). Les refus, dans l'ordre du
-- module (`refusDeLEvaluation` : le mode, l'exercice, le genre, le compte, l'objet) ; puis ceux que la base seule dit : la
-- créance citée, la part reprise, la version lue, la ventilation (`refusDeLaVentilation`, ses mots). Rend l'identifiant.
create function public.enregistrer_provision(p_dossier_id uuid, p_provision jsonb, p_version_lue integer)
 returns uuid
 language plpgsql
 security definer
 set search_path = public
as $fonction$
declare
  v_mode text;
  v_id uuid;
  v_ouverte bigint;
  v_frontiere date;
  v_premier integer;
  v_genre text;
  v_compte text;
  v_objet text;
  v_facture uuid;
  v_piece uuid;
  v_reprise bigint;
  v_solde bigint;
  v_ventile bigint;
  v_ancienne public.provisions%rowtype;
begin
  -- 0. L'accès, avant toute lecture ; le verrou PARTAGÉ de la validation, avant toute lecture du gel ; celui des provisions
  --    du dossier, qui sérialise la ventilation.
  if p_dossier_id is null or auth.uid() is null or not coalesce(public.admin_du_dossier(p_dossier_id), false) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  perform pg_advisory_xact_lock(hashtextextended('provisions|' || p_dossier_id::text, 0));
  select d.mode_comptable into v_mode from public.dossiers d where d.id = p_dossier_id;
  if not found then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;

  -- 1. Le mode du dossier.
  if v_mode is distinct from 'engagement' then
    raise exception '%', 'L’inventaire ne s’écrit qu’en comptabilité d’engagement : un dossier en trésorerie (BNC, 2035) n’en reçoit aucun.'
      using errcode = '22023';
  end if;

  -- 2. L'exercice de son ouverture : lisible, pas figé, commencé (l'année lue à Paris), pas avant l'ouverture du dossier.
  v_ouverte := public.inventaire_entier(p_provision -> 'ouverte_en');
  if v_ouverte is null or v_ouverte < 2000 or v_ouverte > 2100 then
    raise exception '%', 'L’exercice de la régularisation est illisible : une année entre 2000 et 2100.' using errcode = '22023';
  end if;
  v_frontiere := public.frontiere_validation(p_dossier_id);
  if v_frontiere is not null and v_ouverte <= extract(year from v_frontiere) then
    raise exception '%', 'Cet exercice est validé : ses écritures d’inventaire ne changent plus.' using errcode = '23514';
  end if;
  if v_ouverte > extract(year from (now() at time zone 'Europe/Paris')) then
    raise exception '%', 'Cet exercice n’est pas encore commencé : son inventaire ne se passe pas avant lui.' using errcode = '22023';
  end if;
  select extract(year from min(a.date))::integer into v_premier from public.a_nouveaux a where a.dossier_id = p_dossier_id;
  if v_premier is not null and v_ouverte < v_premier then
    raise exception '%', 'Cet exercice précède l’ouverture du dossier dans l’application : son inventaire n’y a pas de place.'
      using errcode = '22023';
  end if;

  -- 3. Le genre.
  v_genre := p_provision ->> 'genre';
  if v_genre is null or not (v_genre = any (array['risque', 'depreciation_creance'])) then
    raise exception '%', 'Le genre de la provision est inconnu : une provision pour risques ou la dépréciation d’une créance.'
      using errcode = '22023';
  end if;

  -- 4. Le compte de la provision, sous la racine de son genre.
  v_compte := p_provision ->> 'compte_provision';
  if v_compte is null or v_compte !~ '^[0-9]{3,}$' or left(v_compte, 3) <> (case v_genre when 'risque' then '151' else '491' end) then
    raise exception '%', case v_genre when 'risque' then 'Une provision pour risques s’écrit sous le 151.'
                              else 'La dépréciation d’une créance s’écrit sous le 491.' end
      using errcode = '22023';
  end if;

  -- 5. L'objet : 1 à 200 caractères, sur une ligne, rogné comme le module le rogne.
  v_objet := public.inventaire_rogne(p_provision ->> 'objet');
  if v_objet is null or char_length(v_objet) < 1 or char_length(v_objet) > 200 or v_objet ~ '[\r\n]' then
    raise exception '%', 'L’objet de la régularisation tient en 1 à 200 caractères, sur une ligne : il part au FEC.' using errcode = '22023';
  end if;

  -- 6. Ce qu'elle cite, facultatif : la facture émise dépréciée (une facture validée de ce dossier, la dépréciation seule),
  --    ou une pièce de ce dossier (une pièce de vente pour une créance) ; jamais les deux.
  if p_provision -> 'facture_id' is not null and jsonb_typeof(p_provision -> 'facture_id') <> 'null' then
    if v_genre <> 'depreciation_creance' then
      raise exception '%', 'Seule la dépréciation d’une créance cite une facture.' using errcode = '22023';
    end if;
    if coalesce(p_provision ->> 'facture_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or not exists (select 1 from public.factures_emises f where f.id = (p_provision ->> 'facture_id')::uuid
                        and f.dossier_id = p_dossier_id and f.statut = 'validee') then
      raise exception '%', 'La facture citée n’est pas une facture validée de ce dossier.' using errcode = '22023';
    end if;
    v_facture := (p_provision ->> 'facture_id')::uuid;
  end if;
  if p_provision -> 'piece_citee_id' is not null and jsonb_typeof(p_provision -> 'piece_citee_id') <> 'null' then
    if coalesce(p_provision ->> 'piece_citee_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or not exists (select 1 from public.pieces p where p.id = (p_provision ->> 'piece_citee_id')::uuid and p.dossier_id = p_dossier_id
                        and (v_genre = 'risque' or p.type_piece = 'vente')) then
      raise exception '%', case v_genre when 'risque' then 'La pièce citée n’est pas une pièce de ce dossier.'
                                else 'La pièce citée n’est pas une pièce de vente de ce dossier.' end
        using errcode = '22023';
    end if;
    if v_facture is not null then
      raise exception '%', 'Une créance se cite par sa facture ou par sa pièce, pas les deux.' using errcode = '22023';
    end if;
    v_piece := (p_provision ->> 'piece_citee_id')::uuid;
  end if;

  -- 7. La part reprise (INV-Q11), facultative : des centimes positifs ou nuls, au premier exercice du dossier, celui de sa
  --    balance reprise.
  if p_provision -> 'reprise_centimes' is not null and jsonb_typeof(p_provision -> 'reprise_centimes') <> 'null' then
    v_reprise := public.inventaire_entier(p_provision -> 'reprise_centimes');
    if v_reprise is null or v_reprise < 0 then
      raise exception '%', 'La provision au 31 décembre précédent est un nombre de centimes entier, positif ou nul.' using errcode = '22023';
    end if;
    if v_premier is null or v_ouverte <> v_premier then
      raise exception '%', 'Une part reprise s’ouvre au premier exercice du dossier, celui de sa balance reprise.' using errcode = '22023';
    end if;
  end if;

  -- 8. La version lue : celle de la provision que la saisie remplace, sous son verrou ; aucune pour une nouvelle. Une provision
  --    figée ou déjà évaluée ne change plus.
  if p_provision -> 'id' is not null and jsonb_typeof(p_provision -> 'id') <> 'null' then
    if coalesce(p_provision ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception '%', 'Cette provision a changé depuis sa lecture : relire l’inventaire avant de l’écrire.' using errcode = '40001';
    end if;
    v_id := (p_provision ->> 'id')::uuid;
    select * into v_ancienne from public.provisions p where p.id = v_id and p.dossier_id = p_dossier_id for update;
    if not found or p_version_lue is null or p_version_lue <> v_ancienne.version then
      raise exception '%', 'Cette provision a changé depuis sa lecture : relire l’inventaire avant de l’écrire.' using errcode = '40001';
    end if;
    if v_frontiere is not null and v_ancienne.ouverte_en <= extract(year from v_frontiere) then
      raise exception '%', 'Cet exercice est validé : ses écritures d’inventaire ne changent plus.' using errcode = '23514';
    end if;
    if exists (select 1 from public.operations_inventaire o where o.provision_id = v_id) then
      raise exception '%', 'Cette provision est déjà évaluée : elle ne change plus ; retirer d’abord ses évaluations.' using errcode = '23514';
    end if;
  elsif p_version_lue is not null then
    raise exception '%', 'Une provision nouvelle ne porte pas de version lue.' using errcode = '22023';
  end if;

  -- 9. La ventilation (INV-Q11) : les parts reprises du compte, celle-ci comprise (et celle qu'elle remplace écartée), ne
  --    dépassent pas son solde repris, au crédit, dans les à-nouveaux du dossier.
  if v_reprise is not null then
    select coalesce(sum(round(case a.sens when 'credit' then a.montant else -a.montant end * 100)), 0)::bigint into v_solde
      from public.a_nouveaux a where a.dossier_id = p_dossier_id and a.compte = v_compte;
    select coalesce(sum(p.reprise_centimes), 0)::bigint into v_ventile from public.provisions p
     where p.dossier_id = p_dossier_id and p.compte_provision = v_compte and p.reprise_centimes is not null
       and p.id is distinct from v_id;
    if v_ventile + v_reprise > v_solde then
      raise exception '%', 'Les provisions ventilées doivent faire exactement le solde repris du compte.' using errcode = '22023';
    end if;
  end if;

  -- 10. L'écriture, par la porte que la garde ouvre à ce dossier seul.
  perform set_config('jd.provisions', p_dossier_id::text, true);
  if v_id is null then
    insert into public.provisions (dossier_id, genre, compte_provision, objet, facture_id, piece_citee_id, ouverte_en,
                                   reprise_centimes, version, cree_par)
    values (p_dossier_id, v_genre, v_compte, v_objet, v_facture, v_piece, v_ouverte, v_reprise, 1, auth.uid())
    returning id into v_id;
  else
    update public.provisions p
       set genre = v_genre, compte_provision = v_compte, objet = v_objet, facture_id = v_facture, piece_citee_id = v_piece,
           ouverte_en = v_ouverte, reprise_centimes = v_reprise, version = p.version + 1, modifie_par = auth.uid(),
           modifie_le = now()
     where p.id = v_id;
  end if;
  perform set_config('jd.provisions', '', true);
  return v_id;
end
$fonction$;
revoke execute on function public.enregistrer_provision(uuid, jsonb, integer) from public, anon;
grant execute on function public.enregistrer_provision(uuid, jsonb, integer) to authenticated;
comment on function public.enregistrer_provision(uuid, jsonb, integer) is
  'INV4 (ligne 35) : enregistre ou remplace une provision d''un dossier en engagement, tant qu''elle n''est ni figée ni évaluée, contre la version lue ; sa part reprise ventilée (INV-Q11) ne dépasse pas le solde repris de son compte. Le cabinet du dossier.';

-- ══ 7. Retirer une provision ══
-- Les refus : l'accès, la provision lue, le mode du dossier, le gel, une évaluation, la version lue.
create function public.retirer_provision(p_dossier_id uuid, p_id uuid, p_version_lue integer)
 returns void
 language plpgsql
 security definer
 set search_path = public
as $fonction$
declare
  v_provision public.provisions%rowtype;
  v_frontiere date;
begin
  if p_dossier_id is null or auth.uid() is null or not coalesce(public.admin_du_dossier(p_dossier_id), false) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  perform pg_advisory_xact_lock(hashtextextended('provisions|' || p_dossier_id::text, 0));
  select * into v_provision from public.provisions p where p.id = p_id and p.dossier_id = p_dossier_id for update;
  if not found then
    raise exception '%', 'Cette provision a changé depuis sa lecture : relire l’inventaire avant de l’écrire.' using errcode = '40001';
  end if;
  if (select d.mode_comptable from public.dossiers d where d.id = p_dossier_id) is distinct from 'engagement' then
    raise exception '%', 'L’inventaire ne s’écrit qu’en comptabilité d’engagement : un dossier en trésorerie (BNC, 2035) n’en reçoit aucun.'
      using errcode = '22023';
  end if;
  v_frontiere := public.frontiere_validation(p_dossier_id);
  if v_frontiere is not null and v_provision.ouverte_en <= extract(year from v_frontiere) then
    raise exception '%', 'Cet exercice est validé : ses écritures d’inventaire ne changent plus.' using errcode = '23514';
  end if;
  if exists (select 1 from public.operations_inventaire o where o.provision_id = p_id) then
    raise exception '%', 'Cette provision est déjà évaluée : elle ne change plus ; retirer d’abord ses évaluations.' using errcode = '23514';
  end if;
  if p_version_lue is null or p_version_lue <> v_provision.version then
    raise exception '%', 'Cette provision a changé depuis sa lecture : relire l’inventaire avant de l’écrire.' using errcode = '40001';
  end if;
  perform set_config('jd.provisions', p_dossier_id::text, true);
  delete from public.provisions p where p.id = p_id;
  perform set_config('jd.provisions', '', true);
end
$fonction$;
revoke execute on function public.retirer_provision(uuid, uuid, integer) from public, anon;
grant execute on function public.retirer_provision(uuid, uuid, integer) to authenticated;
comment on function public.retirer_provision(uuid, uuid, integer) is
  'INV4 (ligne 35) : retire une provision qu''aucune évaluation ne cite, tant que son exercice d''ouverture n''est pas figé, contre la version lue. Le cabinet du dossier.';

-- ══ 8. Évaluer une provision au 31 décembre ══
-- p_evaluation : { provision_id, exercice, cible_centimes } ; p_ecritures : ce que compose `composerEvaluation`, par
-- différence — une écriture ({ date, journal, libelle, lignes: [{ compte, sens, centimes }] }), ou aucune quand l'écart est
-- nul ; p_version_lue : la version de l'évaluation de cet exercice que la saisie remplace (nulle s'il n'y en a pas). Les
-- refus, dans l'ordre du module (`refusDeLEvaluation` : le mode, l'exercice, le plan, la cible), la provision lue avant le
-- plan (son genre le décide) ; puis ceux que la base seule dit : l'ouverture de la provision, une évaluation plus récente,
-- la provision soldée, la ventilation, la version lue, les écritures proposées. Rend l'identifiant de l'évaluation.
create function public.enregistrer_evaluation_provision(p_dossier_id uuid, p_evaluation jsonb, p_ecritures jsonb, p_version_lue integer)
 returns uuid
 language plpgsql
 security definer
 set search_path = public
as $fonction$
declare
  v_mode text;
  v_exercice bigint;
  v_frontiere date;
  v_premier integer;
  v_provision public.provisions%rowtype;
  v_role text;
  v_compte_du_role text;
  v_dotation text;
  v_reprise text;
  v_cible bigint;
  v_precedente bigint;
  v_ecart bigint;
  v_solde bigint;
  v_ventile bigint;
  v_ancienne public.operations_inventaire%rowtype;
  v_id uuid;
  v_cloture date;
  v_lignes jsonb;
  v_lib text;
  v_ecriture jsonb;
  v_conforme boolean;
  v_desequilibre integer;
begin
  -- 0. L'accès, avant toute lecture ; le verrou PARTAGÉ de la validation ; celui des provisions du dossier (la chaîne des
  --    évaluations et la ventilation).
  if p_dossier_id is null or auth.uid() is null or not coalesce(public.admin_du_dossier(p_dossier_id), false) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  perform pg_advisory_xact_lock(hashtextextended('provisions|' || p_dossier_id::text, 0));
  select d.mode_comptable into v_mode from public.dossiers d where d.id = p_dossier_id;
  if not found then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;

  -- 1. Le mode du dossier.
  if v_mode is distinct from 'engagement' then
    raise exception '%', 'L’inventaire ne s’écrit qu’en comptabilité d’engagement : un dossier en trésorerie (BNC, 2035) n’en reçoit aucun.'
      using errcode = '22023';
  end if;

  -- 2. L'exercice : lisible, pas figé, commencé (l'année lue à Paris), pas avant l'ouverture du dossier (ses à-nouveaux).
  v_exercice := public.inventaire_entier(p_evaluation -> 'exercice');
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

  -- 3. La provision évaluée, de ce dossier : son genre, son compte et son objet sont les siens (la table les a jugés).
  if coalesce(p_evaluation ->> 'provision_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception '%', 'La provision évaluée n’est pas une provision de ce dossier.' using errcode = '22023';
  end if;
  select * into v_provision from public.provisions p
   where p.id = (p_evaluation ->> 'provision_id')::uuid and p.dossier_id = p_dossier_id;
  if not found then
    raise exception '%', 'La provision évaluée n’est pas une provision de ce dossier.' using errcode = '22023';
  end if;

  -- 4. Le plan : les comptes de la dotation et de la reprise de son genre, chacun de six chiffres sous sa racine.
  for v_role in select r.role from unnest(case v_provision.genre
      when 'risque' then array['dotations_provisions_exploitation', 'reprises_provisions_exploitation']
      else array['dotations_depreciations_actif_circulant', 'reprises_depreciations_actif_circulant'] end)
      with ordinality as r(role, rang) order by r.rang
  loop
    v_compte_du_role := public.compte_du_role(p_dossier_id, v_role);
    if v_compte_du_role !~ '^[0-9]{6}$'
       or not starts_with(v_compte_du_role, (select c.racines[1] from public.roles_comptables c where c.role = v_role)) then
      raise exception '%', format('Le plan du dossier ne porte pas de compte « %s » sous le %s : le régler avant d’écrire l’inventaire.',
        case v_role when 'dotations_provisions_exploitation' then 'Dotations aux provisions d’exploitation'
                    when 'dotations_depreciations_actif_circulant' then 'Dotations aux dépréciations des actifs circulants'
                    when 'reprises_provisions_exploitation' then 'Reprises sur provisions d’exploitation'
                    else 'Reprises sur dépréciations des actifs circulants' end,
        (select c.racines[1] from public.roles_comptables c where c.role = v_role)) using errcode = '22023';
    end if;
    if starts_with(v_role, 'dotations') then v_dotation := v_compte_du_role; else v_reprise := v_compte_du_role; end if;
  end loop;

  -- 5. La cible : la provision au 31 décembre de l'exercice, en centimes entiers, positive ou nulle (nulle : soldée).
  v_cible := public.inventaire_entier(p_evaluation -> 'cible_centimes');
  if v_cible is null or v_cible < 0 then
    raise exception '%', 'L’évaluation d’une provision est un nombre de centimes entier, positif ou nul.' using errcode = '22023';
  end if;

  -- 6. L'ouverture de la provision : elle ne s'évalue pas avant.
  if v_exercice < v_provision.ouverte_en then
    raise exception '%', 'Cette provision s’ouvre sur un exercice plus récent : elle ne s’évalue pas avant.' using errcode = '22023';
  end if;

  -- 7. La chaîne : aucune évaluation plus récente (l'écart de la suivante se compte sur celle-ci).
  if exists (select 1 from public.operations_inventaire o where o.provision_id = v_provision.id and o.exercice > v_exercice) then
    raise exception '%', 'Cette provision est évaluée sur un exercice plus récent : seule sa dernière évaluation change.' using errcode = '23514';
  end if;

  -- 8. La provision soldée : sa dernière évaluation d'avant a une cible nulle ; un risque nouveau est une provision nouvelle.
  if (select o.montant_centimes from public.operations_inventaire o
       where o.provision_id = v_provision.id and o.exercice < v_exercice order by o.exercice desc limit 1) = 0 then
    raise exception '%', 'Cette provision est soldée : elle ne s’évalue plus ; un risque nouveau est une provision nouvelle.' using errcode = '22023';
  end if;

  -- 9. La ventilation (INV-Q11) : la première évaluation d'une part reprise exige que les parts du compte fassent exactement
  --    son solde repris.
  if v_provision.reprise_centimes is not null and v_exercice = v_provision.ouverte_en then
    select coalesce(sum(round(case a.sens when 'credit' then a.montant else -a.montant end * 100)), 0)::bigint into v_solde
      from public.a_nouveaux a where a.dossier_id = p_dossier_id and a.compte = v_provision.compte_provision;
    select coalesce(sum(p.reprise_centimes), 0)::bigint into v_ventile from public.provisions p
     where p.dossier_id = p_dossier_id and p.compte_provision = v_provision.compte_provision and p.reprise_centimes is not null;
    if v_ventile <> v_solde then
      raise exception '%', 'Les provisions ventilées doivent faire exactement le solde repris du compte.' using errcode = '22023';
    end if;
  end if;

  -- 10. La version lue : celle de l'évaluation de cet exercice, sous son verrou, si elle existe ; aucune sinon.
  select * into v_ancienne from public.operations_inventaire o
   where o.provision_id = v_provision.id and o.exercice = v_exercice for update;
  if found then
    if p_version_lue is null or p_version_lue <> v_ancienne.version then
      raise exception '%', 'Cette évaluation a changé depuis sa lecture : relire l’inventaire avant de l’écrire.' using errcode = '40001';
    end if;
    v_id := v_ancienne.id;
  elsif p_version_lue is not null then
    raise exception '%', 'Cette évaluation a changé depuis sa lecture : relire l’inventaire avant de l’écrire.' using errcode = '40001';
  end if;

  -- 11. L'écriture, PAR DIFFÉRENCE (INV-Q4 (A)) : l'écart entre la cible et la provision précédente, lue en base ; recomposée
  --     en entiers et comparée en MULTIENSEMBLE (compte, sens, centimes) à ce que l'application propose, au 31 décembre, au
  --     journal OD, sous le libellé composé « Dotation|Reprise 31/12/AAAA — <genre> — <objet> » ; aucune si l'écart est nul.
  v_precedente := public.provision_cible_precedente(v_provision.id, v_exercice::integer);
  v_ecart := v_cible - v_precedente;
  v_cloture := make_date(v_exercice::integer, 12, 31);
  v_lignes := case when v_ecart > 0 then jsonb_build_array(jsonb_build_array(v_dotation, 'debit', v_ecart),
                                                           jsonb_build_array(v_provision.compte_provision, 'credit', v_ecart))
                   when v_ecart < 0 then jsonb_build_array(jsonb_build_array(v_provision.compte_provision, 'debit', -v_ecart),
                                                           jsonb_build_array(v_reprise, 'credit', -v_ecart))
                   else '[]'::jsonb end;
  v_lib := case when v_ecart > 0 then 'Dotation' else 'Reprise' end || ' 31/12/' || v_exercice || ' — '
    || case v_provision.genre when 'risque' then 'Provision pour risques' else 'Dépréciation de créance' end
    || ' — ' || v_provision.objet;
  v_conforme := jsonb_typeof(p_ecritures) = 'array' and jsonb_array_length(p_ecritures) = (case when v_ecart = 0 then 0 else 1 end);
  if v_conforme and v_ecart <> 0 then
    v_ecriture := p_ecritures -> 0;
    v_conforme := jsonb_typeof(v_ecriture) = 'object' and v_ecriture ->> 'date' = to_char(v_cloture, 'YYYY-MM-DD')
      and v_ecriture ->> 'journal' = 'OD' and v_ecriture ->> 'libelle' = v_lib;
  end if;
  if v_conforme and v_ecart <> 0 then
    with recues as (
      select l.v ->> 'compte' as compte, l.v ->> 'sens' as sens, public.inventaire_entier(l.v -> 'centimes') as centimes
        from jsonb_array_elements(case when jsonb_typeof(v_ecriture -> 'lignes') = 'array' then v_ecriture -> 'lignes' else '[]'::jsonb end) l(v)
    ), attendues as (
      select a.v ->> 0 as compte, a.v ->> 1 as sens, (a.v ->> 2)::bigint as centimes from jsonb_array_elements(v_lignes) a(v)
    )
    select (select count(*) from recues) = (select count(*) from attendues)
       and not exists (select compte, sens, centimes from attendues except all select compte, sens, centimes from recues)
      into v_conforme;
  end if;
  if not coalesce(v_conforme, false) then
    raise exception '%', 'Les écritures proposées ne sont pas celles de l’évaluation : les recomposer.' using errcode = '22023';
  end if;

  -- 12. L'évaluation, puis son écriture, par la porte que la garde d'INV2 ouvre à ce dossier seul.
  perform set_config('jd.inventaire', p_dossier_id::text, true);
  if v_id is null then
    insert into public.operations_inventaire (dossier_id, exercice, nature, compte_resultat, compte_regularisation,
                                              montant_centimes, tva_centimes, objet, provision_id, version, cree_par)
    values (p_dossier_id, v_exercice, 'provision', case when v_ecart < 0 then v_reprise else v_dotation end,
            v_provision.compte_provision, v_cible, 0, v_provision.objet, v_provision.id, 1, auth.uid())
    returning id into v_id;
  else
    delete from public.ecritures_brouillon e where e.operation_inventaire_id = v_id;
    update public.operations_inventaire o
       set compte_resultat = case when v_ecart < 0 then v_reprise else v_dotation end,
           compte_regularisation = v_provision.compte_provision, montant_centimes = v_cible, objet = v_provision.objet,
           version = o.version + 1, modifie_par = auth.uid(), modifie_le = now()
     where o.id = v_id;
  end if;
  insert into public.ecritures_brouillon (dossier_id, operation_inventaire_id, date, compte, libelle, montant, sens, statut)
  select p_dossier_id, v_id, v_cloture, l.v ->> 0, v_lib, round(((l.v ->> 2)::numeric) / 100, 2), l.v ->> 1, 'proposee'
    from jsonb_array_elements(v_lignes) with ordinality as l(v, rang) order by l.rang;
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
revoke execute on function public.enregistrer_evaluation_provision(uuid, jsonb, jsonb, integer) from public, anon;
grant execute on function public.enregistrer_evaluation_provision(uuid, jsonb, jsonb, integer) to authenticated;
comment on function public.enregistrer_evaluation_provision(uuid, jsonb, jsonb, integer) is
  'INV4 (ligne 35) : enregistre ou remplace l''évaluation au 31 décembre d''une provision d''un dossier en engagement, et son écriture par différence (INV-Q4 (A)), recomposée en entiers depuis la provision précédente lue en base et comparée à celle que l''application propose. Seule la dernière évaluation d''une provision change. Le cabinet du dossier.';

-- ══ 9. La double authentification exigée, si elle est déjà en base ══
do $deux_facteurs$
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    execute 'create policy deux_facteurs on public.provisions as restrictive for all to authenticated '
      || 'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))';
  end if;
end
$deux_facteurs$;
