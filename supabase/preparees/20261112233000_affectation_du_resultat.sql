-- AFF2 : L'AFFECTATION DU RÉSULTAT ET L'APPROBATION DES COMPTES, EN BASE (lignes 33 et 45) — PRÉPARÉE le 12/11/2026, PAS
-- APPLIQUÉE. À COLLER : ses fonctions retirent les lignes du brouillon qu'elles remplacent (le mot de la suppression retient
-- `apply_migration`). Rien de ce qui existe ne se détruit : deux tables, une colonne, des contraintes, trois déclencheurs,
-- huit fonctions et six rôles s'ajoutent ; aucune ligne, aucune colonne ni aucun objet ne se retire ni ne change.
--
-- La conception : docs/conceptions/45-affectation-et-approbation.md, § 3 et § 4 (AFF-Q1 à AFF-Q13 à la recommandation, sauf
-- AFF-Q13 : un exercice VALIDÉ seulement, la balance reprise viendra s'il le faut). Le module que la base redit :
-- src/lib/affectationDuResultat.ts (AFF1), ses refus sous les mêmes mots, dans le même ordre (la base ne dit que le premier) ;
-- src/lib/affectationDuResultatEnBase.test.ts les confronte au texte de cette migration. Le récit : HISTORIQUE.md, « 12/11/2026
-- — AFF2 : L'AFFECTATION DU RÉSULTAT, EN BASE (LIGNES 33 ET 45) (PRÉPARÉE, PAS APPLIQUÉE) ». Son retour :
-- supabase/preparees/retour/20261112233100_retour_affectation_du_resultat.sql. Son essai :
-- supabase/essais/affectationDuResultat.sql (une réplique seulement, une transaction) ; puis rls.sql (le bloc AF).
--
-- SOURCES. Code de commerce, art. L232-10 (modifié par l'ordonnance n° 2025-229 du 12 mars 2025 : la réserve légale, un
-- vingtième « au moins » du bénéfice diminué des pertes antérieures, jusqu'au dixième du capital ; « toute décision contraire
-- est nulle »), L232-11 (le bénéfice distribuable, la priorité du bénéfice sur les réserves, le plancher des capitaux
-- propres), L232-12 (l'affectation suit l'approbation), L232-13 (la mise en paiement), relus sur Légifrance le 12/11/2026
-- (AFF1). PCG (règlement ANC n° 2014-03 modifié, numérotation du 1er janvier 2026), art. 112-2 (le bilan avant répartition),
-- art. 1121-1 (la liste des comptes : 1061, 1063, 1068, 110, 119, 457 ; aucun n'a changé de numéro).
--
-- CE QU'ELLE POSE :
--   1. Six rôles au catalogue (`roles_comptables`), rangs 600 à 650 : 1061, 1063, 1068, 110, 119, 457 (§ 4.4). Le septième de
--      la conception, les acomptes sur dividendes (1209), n'entre pas : sa racine commencerait celle du résultat (120), ce que
--      le catalogue ne connaît nulle part (`regler_plan_du_dossier`, contrôle 8), et AFF-Q8 (B) ne l'écrit pas — son solde se
--      LIT par sa racine et refuse la décision. Le rang 660 lui reste.
--   2. `affectations_du_resultat` : une décision par version, IMMUABLE (§ 3.5) — l'approbation et l'affectation ensemble
--      (AFF-Q1 (A)) —, qui se remplace par une version nouvelle ou se retire, sans jamais se supprimer ; ce qu'elle a LU (le
--      résultat de l'exercice validé, la forme juridique et le capital du dossier — AFF-Q5 (A) —, les soldes des capitaux
--      propres à sa date) figé avec elle ; ce que disent les statuts des réserves statutaires (AFF1-Q1), saisi à chaque
--      décision, sans défaut, et figé avec elle. `lignes_d_affectation` : sa répartition, origine → destination.
--   3. `ecritures_brouillon.affectation_id` : l'écriture de la décision, au journal OD que la validation lui donnera (AFF3), à
--      la date de la décision (AFF-Q2 (A)), une ligne par compte et par sens, le libellé composé (« Affectation du résultat
--      AAAA ») ; une contrainte la tient hors de toute autre source d'hier.
--   4. `enregistrer_affectation` : accès vérifié avant toute lecture, le verrou PARTAGÉ de la validation ; les refus du
--      module dans son ordre (la base ne dit que le premier), puis ceux qu'elle dit seule (l'exercice affecté non validé, la
--      version lue, la décision en vigueur figée, l'écriture proposée) ; l'écriture recomposée EN ENTIERS et comparée en
--      MULTIENSEMBLE à celle que compose `composerLEcritureDAffectation`. `retirer_affectation`, `joindre_document_affectation`
--      (le procès-verbal, une fois par version, AFF5).
--   5. Le gel : une décision dont la date tombe dans un exercice validé, et son écriture, ne changent plus (23514).
--   6. Si la double authentification exigée (`deux_facteurs_exiges`) est déjà en base, la policy restrictive `deux_facteurs`
--      sur les deux tables neuves.
--   7. L'exclusion envers les trois autres sources neuves du brouillon, préparées le même mois — l'ouverture éclatée par
--      compte (MCB5g, `ouverture_compte_bancaire_id`), l'opération d'inventaire (INV2, `operation_inventaire_id`) et le stock
--      de clôture (LIA2, `stock_de_cloture_id`) : une contrainte PAR PAIRE, au même nom et au même texte dans les deux
--      migrations de la paire, posée par la seconde à se coller. Les quatre se collent ainsi dans n'importe quel ordre et
--      laissent la même base (l'ordre des colonnes excepté). La garde de tête accepte ces trois colonnes, présentes ou non,
--      et refuse toute autre clé étrangère du brouillon qu'elle ne connaît pas.
--
-- CE QU'ELLE NE FAIT PAS : la validation (le filet de `valider_exercice`, la sorte du FEC, la piste d'audit : AFF3), l'écran
-- (AFF4), le procès-verbal (AFF5), le bilan et les lecteurs (AFF6). Les quatre dossiers de la production sont en trésorerie
-- (12/11/2026) : la fonction les refuse en premier, rien ne s'y écrit.
--
-- L'ORDRE. Après les migrations appliquées au 11/11/2026 ; indépendante des migrations préparées, sauf les trois sœurs qui
-- ajoutent une source au brouillon (ci-dessus, 7). Ses rangs au catalogue, 600 à 660, ne croisent ni ceux de l'inventaire
-- (360 à 410, et 420 à 470 pour INV4) ni ceux des stocks (500 à 590).

do $garde$
declare
  v_f text;
  v_sources text;
begin
  if to_regclass('public.affectations_du_resultat') is not null or to_regclass('public.lignes_d_affectation') is not null
     or exists (select 1 from public.roles_comptables r where r.role in ('reserve_legale', 'reserves_statutaires', 'autres_reserves',
                  'report_a_nouveau_crediteur', 'report_a_nouveau_debiteur', 'dividendes_a_payer'))
     or exists (select 1 from pg_attribute a where a.attrelid = 'public.ecritures_brouillon'::regclass
                  and a.attname = 'affectation_id' and not a.attisdropped) then
    raise exception 'La migration affectation_du_resultat est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if to_regclass('public.dossiers') is null or to_regclass('public.exercices_valides') is null
     or to_regclass('public.soldes_reportes') is null or to_regclass('public.a_nouveaux') is null
     or to_regclass('public.plan_comptable_dossier') is null
     or exists (select 1 from (values ('forme_juridique'), ('capital'), ('mode_comptable')) c(n)
                where not exists (select 1 from pg_attribute a where a.attrelid = 'public.dossiers'::regclass
                                    and a.attname = c.n and not a.attisdropped))
     or exists (select 1 from (values ('piece_id'), ('ligne_bancaire_id'), ('immobilisation_id'), ('vehicule_id'),
                  ('declaration_tva_id'), ('cotisation_id'), ('encaissement_id'), ('facture_id'), ('operation_caisse_id')) c(n)
                where not exists (select 1 from pg_attribute a where a.attrelid = 'public.ecritures_brouillon'::regclass
                                    and a.attname = c.n and not a.attisdropped)) then
    raise exception 'affectation_du_resultat : une table ou une colonne dont elle dépend manque : relire la base.';
  end if;
  -- Les sources du brouillon : sa contrainte « sans autre source » nomme les neuf d'hier, et les trois sources neuves des
  -- migrations sœurs (MCB5g, INV2, LIA2), présentes ou non, reçoivent leur exclusion au § 3. Toute autre clé étrangère du
  -- brouillon, que cette migration ne nomme pas, la refuse : la relire.
  select string_agg(a.attname, ',' order by a.attname collate "C") into v_sources
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.conrelid = 'public.ecritures_brouillon'::regclass and c.contype = 'f'
     and a.attname not in ('operation_inventaire_id', 'ouverture_compte_bancaire_id', 'stock_de_cloture_id');
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
      ('compte_du_dirigeant(uuid)', 'c02c751713f2d759745267145e9e6b40'),
      ('retour_declencheur(text, anyelement, anyelement)', 'bc80cac6efe46d15f86d1820eb56c47e')) as x(f, empreinte)
    where (select md5(replace(p.prosrc, chr(13) || chr(10), chr(10))) from pg_proc p where p.oid = to_regprocedure('public.' || x.f))
          is distinct from x.empreinte
  loop
    raise exception 'La fonction % n''est plus celle que cette migration appelle : relire la migration contre la base avant de l''appliquer.', v_f;
  end loop;
  -- Les rangs et les racines des six rôles sont libres, et aucune racine du catalogue n'en commence une autre.
  if exists (select 1 from public.roles_comptables r where r.ordre between 600 and 660)
     or exists (select 1 from public.roles_comptables r cross join unnest(r.racines) as u(racine)
                cross join unnest(array['1061', '1063', '1068', '110', '119', '457']) as n(racine)
                where starts_with(u.racine, n.racine) or starts_with(n.racine, u.racine)) then
    raise exception 'Le catalogue des rôles n''est plus celui que cette migration suppose (rangs 600 à 660, racines 1061, 1063, 1068, 110, 119, 457) : la relire.';
  end if;
end
$garde$;

-- ══ 1. Les six rôles de l'affectation (§ 4.4) ══
insert into public.roles_comptables (role, racines, compte_defaut, libelle_defaut, prefixe_auxiliaire_defaut, ordre) values
  ('reserve_legale', array['1061'], '106100', 'Réserve légale', null, 600),
  ('reserves_statutaires', array['1063'], '106300', 'Réserves statutaires ou contractuelles', null, 610),
  ('autres_reserves', array['1068'], '106800', 'Autres réserves', null, 620),
  ('report_a_nouveau_crediteur', array['110'], '110000', 'Report à nouveau (solde créditeur)', null, 630),
  ('report_a_nouveau_debiteur', array['119'], '119000', 'Report à nouveau (solde débiteur)', null, 640),
  ('dividendes_a_payer', array['457'], '457000', 'Associés - Dividendes à payer', null, 650);

-- ══ 2. La décision, versionnée, et sa répartition ══
create table public.affectations_du_resultat (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  exercice_affecte integer not null,
  version integer not null,
  etat text not null default 'en_vigueur',
  organe text not null,
  nombre_d_associes_declare text not null,
  date_decision date not null,
  comptes_approuves boolean not null,
  date_mise_en_paiement date,
  reserves_statutaires_distribuables boolean not null,
  resultat_centimes bigint not null,
  forme_juridique text not null,
  capital_centimes bigint not null,
  soldes_lus jsonb not null,
  document_chemin text,
  document_empreinte text,
  cree_par uuid not null,
  cree_le timestamptz not null default now(),
  fin_par uuid,
  fin_le timestamptz,
  constraint affectations_du_resultat_exercice check (exercice_affecte >= 2000 and exercice_affecte <= 2100),
  constraint affectations_du_resultat_version check (version >= 1),
  constraint affectations_du_resultat_version_unique unique (dossier_id, exercice_affecte, version),
  constraint affectations_du_resultat_etat check (etat = any (array['en_vigueur', 'remplacee', 'retiree'])),
  constraint affectations_du_resultat_organe check (
    organe = any (array['assemblee', 'consultation_ecrite', 'acte_unanime', 'associe_unique'])
    and nombre_d_associes_declare = any (array['un', 'plusieurs'])
    and (organe = 'associe_unique') = (nombre_d_associes_declare = 'un')),
  -- Le bilan est présenté avant répartition (PCG, art. 112-2) : la décision suit la clôture de l'exercice affecté.
  constraint affectations_du_resultat_date check (date_decision > make_date(exercice_affecte, 12, 31)),
  constraint affectations_du_resultat_paiement check (
    date_mise_en_paiement is null or (comptes_approuves and date_mise_en_paiement >= date_decision)),
  -- Des centimes que l'application relit sans perte (2^53 - 1).
  constraint affectations_du_resultat_montants check (
    abs(resultat_centimes) <= 9007199254740991 and capital_centimes > 0 and capital_centimes <= 9007199254740991),
  constraint affectations_du_resultat_forme check (forme_juridique ~ '^[0-9]{4}$'),
  constraint affectations_du_resultat_soldes check (
    jsonb_typeof(soldes_lus) = 'object' and soldes_lus ?& array['capitalAuxComptes', 'primes', 'ecartsDeReevaluation',
      'reserveLegale', 'reservesIndisponibles', 'reservesStatutaires', 'reservesReglementees', 'autresReserves',
      'reportCrediteur', 'pertesAnterieures', 'acomptesSurDividendes']),
  -- Le procès-verbal (AFF5) : déposé au stockage du dossier, à son chemin, son empreinte SHA-256 gardée (§ 3.7).
  constraint affectations_du_resultat_document check (
    (document_chemin is null) = (document_empreinte is null)
    and (document_empreinte is null or document_empreinte ~ '^[0-9a-f]{64}$')
    and (document_chemin is null or document_chemin = dossier_id::text || '/affectations/' || id::text || '.pdf')),
  constraint affectations_du_resultat_fin check (
    (etat = 'en_vigueur') = (fin_le is null) and (fin_le is null) = (fin_par is null))
);
-- Une seule décision en vigueur par exercice affecté : la fonction l'assure sous son verrou, cet index le garantit pour tout
-- chemin (la restauration comprise). Aucun upsert ne le vise : la restauration réinsère par la clé primaire.
create unique index affectations_du_resultat_une_en_vigueur on public.affectations_du_resultat (dossier_id, exercice_affecte)
  where etat = 'en_vigueur';
alter table public.affectations_du_resultat enable row level security;
comment on table public.affectations_du_resultat is
  'AFF2 (lignes 33 et 45) : l''approbation des comptes d''un exercice validé et l''affectation de son résultat, une décision par version, immuable ; écrite par enregistrer_affectation, retirer_affectation et joindre_document_affectation seules. Ce qu''elle a lu (résultat, forme, capital, soldes) est figé avec elle.';
comment on column public.affectations_du_resultat.reserves_statutaires_distribuables is
  'Ce que disent les statuts des réserves statutaires (1063), saisi par le cabinet à chaque décision et figé avec elle (AFF1-Q1) : l''application ne lit pas les statuts.';
comment on column public.affectations_du_resultat.soldes_lus is
  'Les soldes des capitaux propres à la date de la décision, avant elle, en centimes, aux noms de src/lib/affectationDuResultat.ts (SoldesAvantAffectation).';

create table public.lignes_d_affectation (
  affectation_id uuid not null references public.affectations_du_resultat(id) on delete cascade,
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  rang smallint not null,
  origine text not null,
  destination text not null,
  montant_centimes bigint not null,
  constraint lignes_d_affectation_pkey primary key (affectation_id, rang),
  constraint lignes_d_affectation_rang check (rang >= 1 and rang <= 100),
  constraint lignes_d_affectation_montant check (montant_centimes > 0 and montant_centimes <= 9007199254740991),
  -- Les couples admis (§ 3.3, AFF-Q7 (A) ; `COUPLES_ADMIS` du module) : la forme seule, la fonction les juge d'abord.
  constraint lignes_d_affectation_couple check (
    (origine = 'benefice' and destination = any (array['reserve_legale', 'reserves_statutaires', 'autres_reserves',
                                                       'report_crediteur', 'report_debiteur', 'dividendes']))
    or (origine = 'perte' and destination = any (array['report_debiteur', 'reserves_statutaires', 'autres_reserves', 'report_crediteur']))
    or (origine = 'report_crediteur' and destination = any (array['dividendes', 'autres_reserves']))
    or (origine = any (array['autres_reserves', 'reserves_statutaires']) and destination = 'dividendes'))
);
create index lignes_d_affectation_dossier on public.lignes_d_affectation (dossier_id);
alter table public.lignes_d_affectation enable row level security;
comment on table public.lignes_d_affectation is
  'AFF2 (lignes 33 et 45) : la répartition d''une décision d''affectation, origine → destination, en centimes ; écrite avec sa décision, jamais modifiée.';

-- Le cabinet du dossier lit ; aucun client (ni ses comptes ni ses associés : C4a reste le seul chemin). Aucune policy
-- d'écriture : les fonctions seules. La restauration réinsère par la porte du super-administrateur, que les gardes ouvrent.
create policy affectations_du_resultat_lecture on public.affectations_du_resultat
  for select to authenticated using (public.admin_du_dossier(dossier_id));
create policy affectations_du_resultat_restauration on public.affectations_du_resultat
  for insert to authenticated with check (public.is_super_admin());
create policy lignes_d_affectation_lecture on public.lignes_d_affectation
  for select to authenticated using (public.admin_du_dossier(dossier_id));
create policy lignes_d_affectation_restauration on public.lignes_d_affectation
  for insert to authenticated with check (public.is_super_admin());

-- ══ 3. L'écriture d'une décision ══
alter table public.ecritures_brouillon add column affectation_id uuid
  constraint ecritures_brouillon_affectation_id_fkey references public.affectations_du_resultat(id);
-- Une ligne d'affectation ne cite aucune autre source d'hier ; la garde la tient à la date de sa décision. L'exclusion est
-- symétrique : les contraintes des sources d'hier n'ont pas à nommer la colonne neuve ; celles des sources neuves sœurs, le
-- bloc qui suit.
alter table public.ecritures_brouillon add constraint ecritures_brouillon_affectation_sans_autre_source check (
  affectation_id is null
  or num_nonnulls(piece_id, ligne_bancaire_id, immobilisation_id, vehicule_id, declaration_tva_id, cotisation_id,
                  encaissement_id, facture_id, operation_caisse_id) = 0);
create index ecritures_brouillon_affectation on public.ecritures_brouillon (affectation_id) where affectation_id is not null;
comment on column public.ecritures_brouillon.affectation_id is
  'AFF2 (lignes 33 et 45) : la décision d''affectation du résultat dont cette ligne est l''écriture, à la date de la décision ; écrite par enregistrer_affectation seule.';

-- L'exclusion envers une source neuve sœur déjà en base : la contrainte de la paire, au nom et au texte que l'autre
-- migration poserait si elle venait après (MCB5g, INV2 et LIA2 portent ce même bloc, pour leurs paires). Une décision peut
-- se dater d'un 1er janvier ou d'un 31 décembre, comme une ligne de ces trois sources : leurs paires n'ont que ces
-- contraintes pour la refuser.
do $autres_sources$
begin
  if exists (select 1 from pg_attribute a where a.attrelid = 'public.ecritures_brouillon'::regclass
               and a.attname = 'ouverture_compte_bancaire_id' and not a.attisdropped) then
    execute 'alter table public.ecritures_brouillon add constraint ecritures_brouillon_affectation_hors_de_l_ouverture '
      || 'check (affectation_id is null or ouverture_compte_bancaire_id is null)';
  end if;
  if exists (select 1 from pg_attribute a where a.attrelid = 'public.ecritures_brouillon'::regclass
               and a.attname = 'operation_inventaire_id' and not a.attisdropped) then
    execute 'alter table public.ecritures_brouillon add constraint ecritures_brouillon_inventaire_hors_de_l_affectation '
      || 'check (operation_inventaire_id is null or affectation_id is null)';
  end if;
  if exists (select 1 from pg_attribute a where a.attrelid = 'public.ecritures_brouillon'::regclass
               and a.attname = 'stock_de_cloture_id' and not a.attisdropped) then
    execute 'alter table public.ecritures_brouillon add constraint ecritures_brouillon_stock_hors_de_l_affectation '
      || 'check (stock_de_cloture_id is null or affectation_id is null)';
  end if;
end
$autres_sources$;

-- ══ 4. Trois aides, privées ══
-- Un nombre de centimes que l'application relit sans perte : un nombre JSON entier, de valeur absolue au plus 2^53 - 1
-- (`Number.isSafeInteger`) ; nul sinon. Les CASE imbriqués : un texte n'est jamais converti en nombre.
create function public.affectation_entier(p jsonb) returns bigint
language sql immutable set search_path = public as $$
  select case when jsonb_typeof(p) = 'number' then
    case when (p #>> '{}')::numeric = trunc((p #>> '{}')::numeric) and abs((p #>> '{}')::numeric) <= 9007199254740991
         then (p #>> '{}')::numeric::bigint end end
$$;
-- Un montant tel que `formatMoney` l'écrit (fr-FR, l'euro) : le signe moins, les milliers séparés d'une espace fine
-- insécable (U+202F), la virgule, deux décimales, une espace insécable (U+00A0) et « € ». Écrit à la main plutôt que selon
-- une locale : le refus de la base est celui du module, au caractère près.
create function public.affectation_en_euros(p_centimes bigint) returns text
language sql immutable set search_path = public as $$
  select case when p_centimes < 0 then '-' else '' end
    || replace(to_char(abs(p_centimes) / 100, 'FM999,999,999,999,999,990'), ',', chr(8239))
    || ',' || lpad((abs(p_centimes) % 100)::text, 2, '0') || chr(160) || '€'
$$;
-- Les soldes des capitaux propres d'un dossier à une date, avant une décision (les lignes de la décision qu'on remplace
-- écartées), en centimes, aux noms du module : l'ouverture de l'exercice de la date (soldes reportés, à-nouveaux), puis ce
-- que son brouillon y a écrit jusqu'à elle. Créditeurs positifs, sauf les pertes antérieures (119) et les acomptes sur
-- dividendes (1209), leurs soldes DÉBITEURS.
create function public.affectation_soldes(p_dossier_id uuid, p_date date, p_exclue uuid) returns jsonb
language sql stable set search_path = public as $$
  with mouvements as (
    select s.compte, (case when s.sens = 'credit' then 1 else -1 end) * round(s.montant * 100)::bigint as c
      from public.soldes_reportes s
     where s.dossier_id = p_dossier_id and s.date = make_date(extract(year from p_date)::integer, 1, 1)
    union all
    select a.compte, (case when a.sens = 'credit' then 1 else -1 end) * round(a.montant * 100)::bigint
      from public.a_nouveaux a
     where a.dossier_id = p_dossier_id and a.date between make_date(extract(year from p_date)::integer, 1, 1) and p_date
    union all
    select e.compte, (case when e.sens = 'credit' then 1 else -1 end) * round(e.montant * 100)::bigint
      from public.ecritures_brouillon e
     where e.dossier_id = p_dossier_id and e.date between make_date(extract(year from p_date)::integer, 1, 1) and p_date
       and e.affectation_id is distinct from p_exclue
  )
  select jsonb_build_object(
    'capitalAuxComptes', coalesce(sum(m.c) filter (where starts_with(m.compte, '101') or starts_with(m.compte, '109')), 0),
    'primes', coalesce(sum(m.c) filter (where starts_with(m.compte, '104')), 0),
    'ecartsDeReevaluation', coalesce(sum(m.c) filter (where starts_with(m.compte, '105')), 0),
    'reserveLegale', coalesce(sum(m.c) filter (where starts_with(m.compte, '1061')), 0),
    'reservesIndisponibles', coalesce(sum(m.c) filter (where starts_with(m.compte, '1062')), 0),
    'reservesStatutaires', coalesce(sum(m.c) filter (where starts_with(m.compte, '1063')), 0),
    'reservesReglementees', coalesce(sum(m.c) filter (where starts_with(m.compte, '1064')), 0),
    'autresReserves', coalesce(sum(m.c) filter (where starts_with(m.compte, '106') and left(m.compte, 4) not in ('1061', '1062', '1063', '1064')), 0),
    'reportCrediteur', coalesce(sum(m.c) filter (where starts_with(m.compte, '110')), 0),
    'pertesAnterieures', -coalesce(sum(m.c) filter (where starts_with(m.compte, '119')), 0),
    'acomptesSurDividendes', -coalesce(sum(m.c) filter (where starts_with(m.compte, '1209')), 0))
  from mouvements m
$$;
revoke execute on function public.affectation_entier(jsonb) from public, anon, authenticated;
revoke execute on function public.affectation_en_euros(bigint) from public, anon, authenticated;
revoke execute on function public.affectation_soldes(uuid, date, uuid) from public, anon, authenticated;

-- ══ 5. Les gardes ══
-- La décision : écrite par ses trois fonctions seules (le réglage local `jd.affectation`, qu'elles posent sur leur dossier)
-- ou réinsérée par le super-administrateur (la restauration, qui réinsère les exercices validés en dernier) ; jamais
-- supprimée (le départ du dossier excepté) ; une mise à jour ne change que son état (en vigueur → remplacée ou retirée) ou
-- joint son procès-verbal, une fois ; celle dont la date tombe dans un exercice validé ne change plus.
create function public.garder_affectations_du_resultat() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_derniere integer;
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.dossiers where id = old.dossier_id) then
    return old;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Une décision d’affectation ne se supprime pas : elle se remplace ou se retire, et l’historique reste.'
      using errcode = '42501';
  end if;
  if coalesce(current_setting('jd.affectation', true), '') is distinct from new.dossier_id::text
     and not (tg_op = 'INSERT' and public.is_super_admin()) then
    raise exception 'Une décision d’affectation ne s’écrit que par enregistrer_affectation, retirer_affectation et joindre_document_affectation.'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - array['etat', 'fin_par', 'fin_le', 'document_chemin', 'document_empreinte'])
         is distinct from (to_jsonb(old) - array['etat', 'fin_par', 'fin_le', 'document_chemin', 'document_empreinte'])
       or (new.etat is distinct from old.etat and (old.etat <> 'en_vigueur' or new.etat = 'en_vigueur'))
       or (new.etat is not distinct from old.etat and (new.fin_par, new.fin_le) is distinct from (old.fin_par, old.fin_le))
       or ((new.document_chemin, new.document_empreinte) is distinct from (old.document_chemin, old.document_empreinte)
           and old.document_chemin is not null) then
      raise exception 'Une décision d’affectation ne se modifie pas : elle se remplace par une version nouvelle.' using errcode = '42501';
    end if;
    perform pg_advisory_xact_lock_shared(public.cle_validation(old.dossier_id));
    v_derniere := extract(year from public.frontiere_validation(old.dossier_id))::integer;
    if extract(year from old.date_decision)::integer <= v_derniere then
      raise exception 'Cet exercice est validé : la décision d’affectation et son écriture ne changent plus.' using errcode = '23514';
    end if;
  else
    perform pg_advisory_xact_lock_shared(public.cle_validation(new.dossier_id));
    v_derniere := extract(year from public.frontiere_validation(new.dossier_id))::integer;
    if extract(year from new.date_decision)::integer <= v_derniere then
      raise exception 'Cet exercice est validé : la décision d’affectation et son écriture ne changent plus.' using errcode = '23514';
    end if;
  end if;
  return public.retour_declencheur(tg_op, old, new);
end;
$$;
create trigger affectations_du_resultat_garde before insert or update or delete on public.affectations_du_resultat
  for each row execute function public.garder_affectations_du_resultat();

-- Sa répartition : insérée avec sa décision, par sa fonction ou la restauration, jamais modifiée ni retirée (le départ du
-- dossier excepté) ; une ligne appartient à une décision de son dossier.
create function public.garder_lignes_d_affectation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.dossiers where id = old.dossier_id) then
    return old;
  end if;
  if tg_op <> 'INSERT' then
    raise exception 'Une ligne d’affectation ne change pas : la décision se remplace par une version nouvelle.' using errcode = '42501';
  end if;
  if coalesce(current_setting('jd.affectation', true), '') is distinct from new.dossier_id::text and not public.is_super_admin() then
    raise exception 'Une décision d’affectation ne s’écrit que par enregistrer_affectation, retirer_affectation et joindre_document_affectation.'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.affectations_du_resultat a where a.id = new.affectation_id and a.dossier_id = new.dossier_id) then
    raise exception 'Une ligne d’affectation appartient à une décision de son dossier.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger lignes_d_affectation_garde before insert or update or delete on public.lignes_d_affectation
  for each row execute function public.garder_lignes_d_affectation();

-- Son écriture : une ligne qui cite une décision ne s'écrit, ne change ni ne part que par sa fonction, la réinsertion du
-- super-administrateur et le départ du dossier exceptés ; elle appartient à une décision EN VIGUEUR de son dossier, aux
-- comptes approuvés, en engagement, à la date de la décision. La validation (AFF3) ne touche à aucune des colonnes gardées.
create function public.garder_ecriture_d_affectation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.dossiers where id = old.dossier_id) then
    return old;
  end if;
  if tg_op <> 'INSERT' and old.affectation_id is not null
     and coalesce(current_setting('jd.affectation', true), '') is distinct from old.dossier_id::text then
    raise exception 'Une écriture d’affectation ne change que par sa décision.' using errcode = '42501';
  end if;
  if tg_op <> 'DELETE' and new.affectation_id is not null then
    if coalesce(current_setting('jd.affectation', true), '') is distinct from new.dossier_id::text
       and not (tg_op = 'INSERT' and public.is_super_admin()) then
      raise exception 'Une écriture d’affectation ne change que par sa décision.' using errcode = '42501';
    end if;
    if not exists (select 1 from public.affectations_du_resultat a join public.dossiers d on d.id = a.dossier_id
                    where a.id = new.affectation_id and a.dossier_id = new.dossier_id and a.etat = 'en_vigueur'
                      and a.comptes_approuves and d.mode_comptable = 'engagement' and new.date = a.date_decision) then
      raise exception 'Une écriture d’affectation appartient à une décision en vigueur de son dossier, en engagement, à la date de la décision.'
        using errcode = '23514';
    end if;
  end if;
  return public.retour_declencheur(tg_op, old, new);
end;
$$;
create trigger ecritures_brouillon_affectation
  before insert or delete or update of affectation_id, dossier_id, date, compte, sens, montant, libelle
  on public.ecritures_brouillon for each row execute function public.garder_ecriture_d_affectation();
revoke execute on function public.garder_affectations_du_resultat() from public, anon, authenticated;
revoke execute on function public.garder_lignes_d_affectation() from public, anon, authenticated;
revoke execute on function public.garder_ecriture_d_affectation() from public, anon, authenticated;

-- ══ 6. Enregistrer une décision, ou la remplacer ══
-- p_exercice : l'exercice affecté, validé. p_version_lue : la version EN VIGUEUR que la saisie remplace (nulle s'il n'y en
-- a pas). p_decision : { organe, nombre_d_associes ('un' | 'plusieurs'), date_decision (AAAA-MM-JJ), comptes_approuves,
-- date_mise_en_paiement (AAAA-MM-JJ ou null, présente), reserves_statutaires_distribuables } — chaque clé obligatoire,
-- aucune n'a de défaut. p_lignes : [{ origine, destination, centimes }], dans l'ordre de la saisie. p_ecriture : l'écriture
-- que compose `composerLEcritureDAffectation` ({ journal, date, pieceRef, pieceDate, libelle, lignes: [{ compte, sens,
-- centimes }] }), ou null quand le module n'en compose pas. Les refus : l'accès ; la saisie illisible (la base seule) ; puis
-- ceux du module, dans son ordre, le premier seul ; puis ceux que la base dit seule. Rend l'identifiant de la décision.
create function public.enregistrer_affectation(p_dossier_id uuid, p_exercice integer, p_version_lue integer,
                                               p_decision jsonb, p_lignes jsonb, p_ecriture jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path = public
as $fonction$
declare
  v_mode text;
  v_forme text;
  v_capital numeric;
  v_capital_c bigint;
  v_regime text;
  v_organe text;
  v_nombre text;
  v_approuves boolean;
  v_statuts boolean;
  v_date date;
  v_paiement date;
  v_dates_lisibles boolean := true;
  v_aujourdhui date := (now() at time zone 'Europe/Paris')::date;
  v_frontiere date;
  v_ancienne public.affectations_du_resultat%rowtype;
  v_soldes jsonb := jsonb_build_object('capitalAuxComptes', 0, 'primes', 0, 'ecartsDeReevaluation', 0, 'reserveLegale', 0,
    'reservesIndisponibles', 0, 'reservesStatutaires', 0, 'reservesReglementees', 0, 'autresReserves', 0, 'reportCrediteur', 0,
    'pertesAnterieures', 0, 'acomptesSurDividendes', 0);
  s_capital bigint; s_primes bigint; s_ecarts bigint; s_legale bigint; s_indispo bigint; s_statutaires bigint;
  s_reglementees bigint; s_autres bigint; s_report bigint; s_pertes bigint; s_acomptes bigint;
  v_r bigint;
  v_lignes jsonb;
  v_comptes jsonb := '{}'::jsonb;
  v_role text;
  v_compte text;
  v_ligne record;
  v_benefice bigint; v_perte bigint; v_affecte bigint; v_p bigint; v_solde bigint; v_apure bigint;
  v_minimale bigint; v_legale_dotee bigint; v_statutaires_dotees bigint; v_distribuable bigint; v_div_br bigint;
  v_div_res bigint; v_div bigint; v_avant bigint; v_plancher bigint;
  v_attendues jsonb;
  v_conforme boolean;
  v_id uuid;
  v_version integer;
  v_desequilibre integer;
begin
  -- 0. L'accès, avant toute lecture ; puis le verrou PARTAGÉ de la validation, et celui des décisions de cet exercice.
  if p_dossier_id is null or auth.uid() is null or not coalesce(public.admin_du_dossier(p_dossier_id), false) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  perform pg_advisory_xact_lock(hashtextextended('affectation|' || p_dossier_id::text || '|' || coalesce(p_exercice, 0)::text, 0));
  select d.mode_comptable, d.forme_juridique, d.capital into v_mode, v_forme, v_capital from public.dossiers d where d.id = p_dossier_id;
  if not found then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- La saisie illisible (la base seule : le module la reçoit typée). Chaque clé est obligatoire, aucune n'a de défaut.
  if jsonb_typeof(p_decision) is distinct from 'object' or jsonb_typeof(p_lignes) is distinct from 'array' then
    raise exception '%', 'La décision saisie est illisible : la relire.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_decision -> 'organe') is distinct from 'string'
     or not ((p_decision ->> 'organe') = any (array['assemblee', 'consultation_ecrite', 'acte_unanime', 'associe_unique']))
     or jsonb_typeof(p_decision -> 'nombre_d_associes') is distinct from 'string'
     or not ((p_decision ->> 'nombre_d_associes') = any (array['un', 'plusieurs']))
     or jsonb_typeof(p_decision -> 'comptes_approuves') is distinct from 'boolean'
     or jsonb_typeof(p_decision -> 'reserves_statutaires_distribuables') is distinct from 'boolean'
     or jsonb_typeof(p_decision -> 'date_decision') is distinct from 'string'
     or coalesce(jsonb_typeof(p_decision -> 'date_mise_en_paiement'), 'absente') not in ('string', 'null')
     or jsonb_array_length(p_lignes) > 100
     or exists (select 1 from jsonb_array_elements(p_lignes) l(v)
                 where jsonb_typeof(l.v) is distinct from 'object'
                    or jsonb_typeof(l.v -> 'origine') is distinct from 'string'
                    or not ((l.v ->> 'origine') = any (array['benefice', 'perte', 'report_crediteur', 'autres_reserves', 'reserves_statutaires']))
                    or jsonb_typeof(l.v -> 'destination') is distinct from 'string'
                    or not ((l.v ->> 'destination') = any (array['reserve_legale', 'reserves_statutaires', 'autres_reserves',
                                                                 'report_crediteur', 'report_debiteur', 'dividendes'])))
     or (p_ecriture is not null and jsonb_typeof(p_ecriture) not in ('object', 'null')) then
    raise exception '%', 'La décision saisie est illisible : la relire.' using errcode = '22023';
  end if;
  v_organe := p_decision ->> 'organe';
  v_nombre := p_decision ->> 'nombre_d_associes';
  v_approuves := (p_decision -> 'comptes_approuves')::boolean;
  v_statuts := (p_decision -> 'reserves_statutaires_distribuables')::boolean;
  -- Les dates, lues sans lever : une date illisible se refuse à sa place dans l'ordre du module.
  begin
    if (p_decision ->> 'date_decision') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception using errcode = '22007';
    end if;
    v_date := (p_decision ->> 'date_decision')::date;
    if to_char(v_date, 'YYYY-MM-DD') <> p_decision ->> 'date_decision' then
      raise exception using errcode = '22007';
    end if;
    if jsonb_typeof(p_decision -> 'date_mise_en_paiement') = 'string' then
      if (p_decision ->> 'date_mise_en_paiement') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception using errcode = '22007';
      end if;
      v_paiement := (p_decision ->> 'date_mise_en_paiement')::date;
      if to_char(v_paiement, 'YYYY-MM-DD') <> p_decision ->> 'date_mise_en_paiement' then
        raise exception using errcode = '22007';
      end if;
    end if;
  exception when others then
    v_dates_lisibles := false;
  end;
  -- Ce que la décision LIT : la décision en vigueur qu'elle remplacerait (ses lignes écartées des soldes), les soldes à sa
  -- date, le résultat de l'exercice affecté (classes 6 et 7, ses lignes validées).
  select * into v_ancienne from public.affectations_du_resultat a
   where a.dossier_id = p_dossier_id and a.exercice_affecte = p_exercice and a.etat = 'en_vigueur' for update;
  if v_dates_lisibles then
    v_soldes := public.affectation_soldes(p_dossier_id, v_date, v_ancienne.id);
  end if;
  s_capital := (v_soldes ->> 'capitalAuxComptes')::bigint; s_primes := (v_soldes ->> 'primes')::bigint;
  s_ecarts := (v_soldes ->> 'ecartsDeReevaluation')::bigint; s_legale := (v_soldes ->> 'reserveLegale')::bigint;
  s_indispo := (v_soldes ->> 'reservesIndisponibles')::bigint; s_statutaires := (v_soldes ->> 'reservesStatutaires')::bigint;
  s_reglementees := (v_soldes ->> 'reservesReglementees')::bigint; s_autres := (v_soldes ->> 'autresReserves')::bigint;
  s_report := (v_soldes ->> 'reportCrediteur')::bigint; s_pertes := (v_soldes ->> 'pertesAnterieures')::bigint;
  s_acomptes := (v_soldes ->> 'acomptesSurDividendes')::bigint;
  v_r := 0;
  if p_exercice between 2000 and 2100 then
    select coalesce(sum((case when e.sens = 'credit' then 1 else -1 end) * round(e.montant * 100)::bigint), 0) into v_r
      from public.ecritures_brouillon e
     where e.dossier_id = p_dossier_id and e.statut = 'validee' and e.compte ~ '^[67]'
       and e.date between make_date(p_exercice, 1, 1) and make_date(p_exercice, 12, 31);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('origine', l.v ->> 'origine', 'destination', l.v ->> 'destination',
                                               'centimes', public.affectation_entier(l.v -> 'centimes')) order by l.n), '[]'::jsonb)
    into v_lignes from jsonb_array_elements(p_lignes) with ordinality as l(v, n);

  -- 1. Les montants, puis les comptes (le module, dans son ordre).
  if exists (select 1 from jsonb_array_elements(v_lignes) l(v) where (l.v ->> 'centimes') is null or (l.v ->> 'centimes')::bigint <= 0)
     or s_report < 0 or s_pertes < 0 or s_acomptes < 0
     or abs(v_r) > 9007199254740991 or (v_capital is not null and v_capital * 100 > 9007199254740991) then
    raise exception '%', 'Un montant n’est pas un nombre entier de centimes, ou une ligne d’affectation n’est pas positive : rien ne se juge.'
      using errcode = '22023';
  end if;
  foreach v_role in array array['resultat_benefice', 'resultat_perte', 'reserve_legale', 'reserves_statutaires', 'autres_reserves',
                                'report_a_nouveau_crediteur', 'report_a_nouveau_debiteur', 'dividendes_a_payer']
  loop
    v_compte := public.compte_du_role(p_dossier_id, v_role);
    if v_compte is null or v_compte !~ '^[0-9]{6}$' then
      raise exception '%', 'Le plan du dossier ne rend pas, pour chaque compte de l’affectation, un compte à six chiffres : l’écriture ne se compose pas.'
        using errcode = '22023';
    end if;
    v_comptes := v_comptes || jsonb_build_object(v_role, v_compte);
  end loop;
  -- 2. Le champ (§ 3.9 et § 3.4) : la trésorerie, l'entreprise individuelle, la forme, le capital, les acomptes.
  if v_mode = 'tresorerie' then
    raise exception '%', 'Un dossier tenu en trésorerie ne connaît pas l’affectation du résultat : son résultat passe au compte de l’exploitant par le report des soldes.'
      using errcode = '22023';
  end if;
  if public.compte_du_dirigeant(p_dossier_id) is not distinct from public.compte_du_role(p_dossier_id, 'exploitant')
     or v_forme = '1000' then
    raise exception '%', 'Une entreprise individuelle n’affecte pas son résultat : il passe au compte de l’exploitant par le report des soldes.'
      using errcode = '22023';
  end if;
  if v_forme is null then
    raise exception '%', 'La forme juridique du dossier n’est pas posée (onglet Informations, identité du dossier) : on ne sait pas quelles règles l’affectation suit.'
      using errcode = '22023';
  end if;
  -- `regimeDeLaForme` : soumise à la réserve légale (SARL, sociétés par actions, la SE, les commandites par actions), libre
  -- (SNC, SCS, SLP, sociétés civiles), hors du champ sinon.
  v_regime := case
    when v_forme ~ '^5[4-7]' or v_forme = '5800' or v_forme = any (array['5308', '5309', '5370', '5385']) then 'soumise'
    when v_forme ~ '^5[23]' or v_forme ~ '^65' then 'libre'
    else 'hors_champ' end;
  if v_regime = 'hors_champ' then
    raise exception '%', format('La forme juridique du dossier (%s) n’est ni une SARL, ni une société par actions, ni une autre société commerciale, ni une société civile : l’application n’en affecte pas le résultat.', v_forme)
      using errcode = '22023';
  end if;
  if v_capital is null or v_capital <= 0 then
    raise exception '%', 'Le capital social du dossier n’est pas posé (onglet Informations, identité du dossier) : ni le dixième de la réserve légale ni le plancher des capitaux propres ne se calculent.'
      using errcode = '22023';
  end if;
  v_capital_c := round(v_capital * 100)::bigint;
  if s_acomptes <> 0 then
    raise exception '%', format('Le compte des acomptes sur dividendes porte un solde de %s : l’application ne les impute pas encore sur les dividendes décidés ; l’affectation se passe hors de l’application.', public.affectation_en_euros(s_acomptes))
      using errcode = '22023';
  end if;
  -- 3. L'exercice et les dates (AFF-Q2 (A) ; PCG, art. 112-2). L'exercice affecté est VALIDÉ (la base seule : son
  --    résultat se lit figé).
  if p_exercice is null or p_exercice < 2000 or p_exercice > 2100 then
    raise exception '%', 'L’exercice affecté n’est pas une année entre 2000 et 2100.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.exercices_valides v where v.dossier_id = p_dossier_id and v.annee = p_exercice) then
    raise exception '%', format('L’exercice %s n’est pas validé : son résultat n’est pas figé, il ne s’affecte pas encore.', p_exercice)
      using errcode = '22023';
  end if;
  if not v_dates_lisibles then
    raise exception '%', 'Une date n’est pas une date du calendrier (JJ/MM/AAAA).' using errcode = '22023';
  end if;
  if v_date <= make_date(p_exercice, 12, 31) then
    raise exception '%', format('La décision est datée du %s, au plus tard à la clôture de l’exercice %s : les comptes ne s’approuvent et le résultat ne s’affecte qu’après la clôture.', to_char(v_date, 'DD/MM/YYYY'), p_exercice)
      using errcode = '22023';
  end if;
  if v_date > v_aujourdhui then
    raise exception '%', format('La décision est datée du %s, dans le futur : elle s’enregistre une fois prise.', to_char(v_date, 'DD/MM/YYYY'))
      using errcode = '22023';
  end if;
  v_frontiere := public.frontiere_validation(p_dossier_id);
  if v_frontiere is not null and extract(year from v_date) <= extract(year from v_frontiere) then
    raise exception '%', format('L’exercice qui contient le %s est validé : une écriture n’y entre plus.', to_char(v_date, 'DD/MM/YYYY'))
      using errcode = '23514';
  end if;
  if (v_organe = 'associe_unique') <> (v_nombre = 'un') then
    raise exception '%', case when v_organe = 'associe_unique' then 'Une décision de l’associé unique suppose un seul associé.'
      else 'Une société à associé unique décide par une décision de l’associé unique, pas en assemblée ni par consultation.' end
      using errcode = '22023';
  end if;
  -- 4. L'approbation (AFF-Q1 (A) ; L232-12, al. 1) : des comptes non approuvés n'affectent rien.
  if not v_approuves then
    if jsonb_array_length(v_lignes) > 0 or v_paiement is not null then
      raise exception '%', 'Les comptes ne sont pas approuvés : le résultat ne s’affecte pas, et la décision ne porte aucune ligne d’affectation ni date de mise en paiement.'
        using errcode = '22023';
    end if;
  else
    -- 5. La répartition (§ 3.3 et § 3.4).
    for v_ligne in select l.v ->> 'origine' as origine, l.v ->> 'destination' as destination
                     from jsonb_array_elements(v_lignes) with ordinality as l(v, n) order by l.n
    loop
      if not (case v_ligne.origine
          when 'benefice' then v_ligne.destination = any (array['reserve_legale', 'reserves_statutaires', 'autres_reserves',
                                                                'report_crediteur', 'report_debiteur', 'dividendes'])
          when 'perte' then v_ligne.destination = any (array['report_debiteur', 'reserves_statutaires', 'autres_reserves', 'report_crediteur'])
          when 'report_crediteur' then v_ligne.destination = any (array['dividendes', 'autres_reserves'])
          else v_ligne.destination = 'dividendes' end) then
        raise exception '%', format('%s ne s’affecte pas à %s.',
          case v_ligne.origine when 'benefice' then 'Le bénéfice' when 'perte' then 'La perte'
            when 'report_crediteur' then 'Le report à nouveau créditeur' when 'autres_reserves' then 'Les autres réserves'
            else 'Les réserves statutaires' end,
          case v_ligne.destination when 'reserve_legale' then 'la réserve légale' when 'reserves_statutaires' then 'les réserves statutaires'
            when 'autres_reserves' then 'les autres réserves' when 'report_crediteur' then 'le report à nouveau créditeur'
            when 'report_debiteur' then 'le report à nouveau débiteur' else 'les dividendes' end)
          using errcode = '22023';
      end if;
    end loop;
    if not v_statuts and exists (select 1 from jsonb_array_elements(v_lignes) l(v) where l.v ->> 'origine' = 'reserves_statutaires') then
      raise exception '%', 'Les statuts ne permettent pas de distribuer les réserves statutaires (C. com., art. L232-11, al. 3) : elles ne s’affectent pas aux dividendes.'
        using errcode = '22023';
    end if;
    select coalesce(sum((l.v ->> 'centimes')::bigint) filter (where l.v ->> 'origine' = 'benefice'), 0),
           coalesce(sum((l.v ->> 'centimes')::bigint) filter (where l.v ->> 'origine' = 'perte'), 0)
      into v_benefice, v_perte from jsonb_array_elements(v_lignes) l(v);
    if (v_r <= 0 and v_benefice > 0) or (v_r >= 0 and v_perte > 0) then
      raise exception '%', case when v_r = 0 then 'Le résultat de l’exercice est nul : il n’y a ni bénéfice ni perte à affecter.'
        else format('L’exercice %s se solde par %s : une ligne affecte %s.', p_exercice,
                    case when v_r > 0 then 'un bénéfice' else 'une perte' end, case when v_r > 0 then 'une perte' else 'un bénéfice' end) end
        using errcode = '22023';
    elsif (v_r > 0 and v_benefice <> v_r) or (v_r < 0 and v_perte <> -v_r) then
      v_affecte := case when v_r > 0 then v_benefice else v_perte end;
      raise exception '%', format('%s de %s s’affecte en entier : les lignes en affectent %s.',
        case when v_r > 0 then 'Le bénéfice' else 'La perte' end, public.affectation_en_euros(abs(v_r)), public.affectation_en_euros(v_affecte))
        using errcode = '22023';
    end if;
    -- Ce qu'une ligne prélève sur un solde (au débit de son compte) ne dépasse pas ce solde à la date de la décision.
    for v_role, v_solde in select x.poste, x.solde from (values (1, 'report_crediteur', s_report), (2, 'autres_reserves', s_autres),
                                                              (3, 'reserves_statutaires', s_statutaires)) as x(rang, poste, solde) order by x.rang
    loop
      select coalesce(sum((l.v ->> 'centimes')::bigint), 0) into v_p from jsonb_array_elements(v_lignes) l(v)
       where l.v ->> 'origine' = v_role or (l.v ->> 'origine' = 'perte' and l.v ->> 'destination' = v_role);
      if v_p > v_solde then
        raise exception '%', format('La décision prélève %s sur %s, dont le solde est de %s à la date de la décision.',
          public.affectation_en_euros(v_p), case v_role when 'report_crediteur' then 'le report à nouveau créditeur'
            when 'autres_reserves' then 'les autres réserves' else 'les réserves statutaires' end, public.affectation_en_euros(v_solde))
          using errcode = '22023';
      end if;
    end loop;
    select coalesce(sum((l.v ->> 'centimes')::bigint), 0) into v_apure from jsonb_array_elements(v_lignes) l(v)
     where l.v ->> 'origine' = 'benefice' and l.v ->> 'destination' = 'report_debiteur';
    if v_apure > s_pertes then
      raise exception '%', format('La décision apure %s de pertes antérieures, qui ne sont que de %s.',
        public.affectation_en_euros(v_apure), public.affectation_en_euros(s_pertes)) using errcode = '22023';
    end if;
    -- Les calculs du module (`calculer`), en entiers : le vingtième et le dixième au centime SUPÉRIEUR.
    v_minimale := case when v_regime = 'soumise'
      then least(floor((greatest(0, v_r - s_pertes) + 19) / 20.0)::bigint,
                 greatest(0, floor((v_capital_c + 9) / 10.0)::bigint - s_legale))
      else 0 end;
    select coalesce(sum((l.v ->> 'centimes')::bigint) filter (where l.v ->> 'destination' = 'reserve_legale'), 0),
           coalesce(sum((l.v ->> 'centimes')::bigint) filter (where l.v ->> 'origine' = 'benefice' and l.v ->> 'destination' = 'reserves_statutaires'), 0),
           coalesce(sum((l.v ->> 'centimes')::bigint) filter (where l.v ->> 'destination' = 'dividendes' and l.v ->> 'origine' in ('benefice', 'report_crediteur')), 0),
           coalesce(sum((l.v ->> 'centimes')::bigint) filter (where l.v ->> 'destination' = 'dividendes' and l.v ->> 'origine' in ('autres_reserves', 'reserves_statutaires')), 0)
      into v_legale_dotee, v_statutaires_dotees, v_div_br, v_div_res from jsonb_array_elements(v_lignes) l(v);
    v_div := v_div_br + v_div_res;
    v_distribuable := greatest(0, v_r - s_pertes - v_legale_dotee - v_statutaires_dotees + s_report);
    v_avant := s_capital + s_primes + s_ecarts + s_legale + s_indispo + s_statutaires + s_reglementees + s_autres + s_report
      - s_pertes - s_acomptes + v_r;
    v_plancher := v_capital_c + s_legale + v_legale_dotee + s_indispo + s_reglementees + s_ecarts
      + case when v_statuts then 0 else s_statutaires + v_statutaires_dotees end;
    -- AFF-Q3 (A) : L232-10, « toute décision contraire est nulle ».
    if v_legale_dotee < v_minimale then
      raise exception '%', format('La réserve légale doit recevoir au moins %s (un vingtième du bénéfice diminué des pertes antérieures, jusqu’au dixième du capital ; C. com., art. L232-10) : la décision lui affecte %s.',
        public.affectation_en_euros(v_minimale), public.affectation_en_euros(v_legale_dotee)) using errcode = '22023';
    end if;
    -- AFF-Q4 (A) : un dividende contraire est fictif.
    if v_div_br > v_distribuable then
      raise exception '%', format('Les dividendes pris sur le bénéfice et le report à nouveau (%s) dépassent le bénéfice distribuable (%s ; C. com., art. L232-11, al. 1) : ce serait un dividende fictif.',
        public.affectation_en_euros(v_div_br), public.affectation_en_euros(v_distribuable)) using errcode = '22023';
    elsif v_div_res > 0 and v_div_br < v_distribuable then
      raise exception '%', format('Les dividendes se prélèvent par priorité sur le bénéfice distribuable de l’exercice (C. com., art. L232-11, al. 2) : la décision prend %s sur les réserves alors que %s du bénéfice distribuable ne sont pas distribués.',
        public.affectation_en_euros(v_div_res), public.affectation_en_euros(v_distribuable - v_div_br)) using errcode = '22023';
    end if;
    if v_div > 0 and v_avant - v_div < v_plancher then
      raise exception '%', format('Après la distribution, les capitaux propres (%s) seraient inférieurs au capital augmenté des réserves que la loi ou les statuts ne permettent pas de distribuer (%s ; C. com., art. L232-11, al. 3).',
        public.affectation_en_euros(v_avant - v_div), public.affectation_en_euros(v_plancher)) using errcode = '22023';
    end if;
    if v_paiement is not null and v_div = 0 then
      raise exception '%', 'La décision ne distribue aucun dividende : elle ne porte pas de date de mise en paiement.' using errcode = '22023';
    elsif v_paiement is not null and v_paiement < v_date then
      raise exception '%', format('La mise en paiement (%s) précède la décision (%s).', to_char(v_paiement, 'DD/MM/YYYY'), to_char(v_date, 'DD/MM/YYYY'))
        using errcode = '22023';
    end if;
  end if;

  -- 6. Ce que la base dit seule : la version lue (celle de la décision en vigueur, sous son verrou ; aucune s'il n'y en a
  --    pas), puis la décision en vigueur figée par la validation de l'exercice de sa date.
  if (v_ancienne.id is null) <> (p_version_lue is null) or (v_ancienne.id is not null and v_ancienne.version <> p_version_lue) then
    raise exception '%', 'Cette décision a changé depuis sa lecture : relire l’affectation avant de l’enregistrer.' using errcode = '40001';
  end if;
  if v_ancienne.id is not null and v_frontiere is not null and extract(year from v_ancienne.date_decision) <= extract(year from v_frontiere) then
    raise exception '%', format('L’exercice qui contient le %s est validé : une écriture n’y entre plus.', to_char(v_ancienne.date_decision, 'DD/MM/YYYY'))
      using errcode = '23514';
  end if;
  -- 7. L'écriture : recomposée en entiers (une ligne par compte et par sens, comme `composerLEcritureDAffectation`) et
  --    comparée en MULTIENSEMBLE à celle que propose l'application ; nulle pour des comptes non approuvés ou sans ligne.
  select coalesce(jsonb_agg(jsonb_build_object('compte', x.compte, 'sens', x.sens, 'centimes', x.centimes) order by x.sens, x.compte collate "C"), '[]'::jsonb)
    into v_attendues
    from (select y.compte, y.sens, sum(y.centimes)::bigint as centimes from (
            select case when l.v ->> 'origine' = 'perte' then v_comptes ->> (case l.v ->> 'destination'
                          when 'reserve_legale' then 'reserve_legale' when 'reserves_statutaires' then 'reserves_statutaires'
                          when 'autres_reserves' then 'autres_reserves' when 'report_crediteur' then 'report_a_nouveau_crediteur'
                          when 'report_debiteur' then 'report_a_nouveau_debiteur' else 'dividendes_a_payer' end)
                        else v_comptes ->> (case l.v ->> 'origine' when 'benefice' then 'resultat_benefice'
                          when 'report_crediteur' then 'report_a_nouveau_crediteur' when 'autres_reserves' then 'autres_reserves'
                          else 'reserves_statutaires' end) end as compte,
                   'debit' as sens, (l.v ->> 'centimes')::bigint as centimes
              from jsonb_array_elements(v_lignes) l(v)
            union all
            select case when l.v ->> 'origine' = 'perte' then v_comptes ->> 'resultat_perte'
                        else v_comptes ->> (case l.v ->> 'destination'
                          when 'reserve_legale' then 'reserve_legale' when 'reserves_statutaires' then 'reserves_statutaires'
                          when 'autres_reserves' then 'autres_reserves' when 'report_crediteur' then 'report_a_nouveau_crediteur'
                          when 'report_debiteur' then 'report_a_nouveau_debiteur' else 'dividendes_a_payer' end) end,
                   'credit', (l.v ->> 'centimes')::bigint
              from jsonb_array_elements(v_lignes) l(v)) y
          group by y.compte, y.sens) x;
  if not v_approuves or jsonb_array_length(v_lignes) = 0 then
    v_conforme := p_ecriture is null or jsonb_typeof(p_ecriture) = 'null';
  else
    v_conforme := jsonb_typeof(p_ecriture) = 'object'
      and p_ecriture ->> 'journal' = 'OD'
      and p_ecriture ->> 'date' = to_char(v_date, 'YYYY-MM-DD')
      and p_ecriture ->> 'pieceDate' = to_char(v_date, 'YYYY-MM-DD')
      and p_ecriture ->> 'pieceRef' = 'Affectation du résultat ' || p_exercice || ' — décision du ' || to_char(v_date, 'DD/MM/YYYY')
      and p_ecriture ->> 'libelle' = 'Affectation du résultat ' || p_exercice
      and jsonb_typeof(p_ecriture -> 'lignes') = 'array';
    if v_conforme then
      with recues as (
        select l.v ->> 'compte' as compte, l.v ->> 'sens' as sens, public.affectation_entier(l.v -> 'centimes') as centimes
          from jsonb_array_elements(p_ecriture -> 'lignes') l(v)
      ), attendues as (
        select a.v ->> 'compte' as compte, a.v ->> 'sens' as sens, (a.v ->> 'centimes')::bigint as centimes
          from jsonb_array_elements(v_attendues) a(v)
      )
      select (select count(*) from recues) = (select count(*) from attendues)
         and not exists (select compte, sens, centimes from attendues except all select compte, sens, centimes from recues)
        into v_conforme;
    end if;
  end if;
  if not coalesce(v_conforme, false) then
    raise exception '%', 'L’écriture proposée n’est pas celle de la décision : la recomposer.' using errcode = '22023';
  end if;

  -- 8. L'écriture en base, par la porte que les gardes ouvrent à ce dossier seul : l'ancienne décision et son écriture
  --    s'effacent devant la nouvelle (remplacée, jamais supprimée), puis la décision, sa répartition et son écriture.
  perform set_config('jd.affectation', p_dossier_id::text, true);
  if v_ancienne.id is not null then
    delete from public.ecritures_brouillon e where e.affectation_id = v_ancienne.id;
    update public.affectations_du_resultat a set etat = 'remplacee', fin_par = auth.uid(), fin_le = now() where a.id = v_ancienne.id;
  end if;
  select coalesce(max(a.version), 0) + 1 into v_version from public.affectations_du_resultat a
   where a.dossier_id = p_dossier_id and a.exercice_affecte = p_exercice;
  insert into public.affectations_du_resultat (dossier_id, exercice_affecte, version, organe, nombre_d_associes_declare,
                                               date_decision, comptes_approuves, date_mise_en_paiement,
                                               reserves_statutaires_distribuables, resultat_centimes, forme_juridique,
                                               capital_centimes, soldes_lus, cree_par)
  values (p_dossier_id, p_exercice, v_version, v_organe, v_nombre, v_date, v_approuves, v_paiement, v_statuts, v_r, v_forme,
          v_capital_c, v_soldes, auth.uid())
  returning id into v_id;
  insert into public.lignes_d_affectation (affectation_id, dossier_id, rang, origine, destination, montant_centimes)
  select v_id, p_dossier_id, l.n, l.v ->> 'origine', l.v ->> 'destination', (l.v ->> 'centimes')::bigint
    from jsonb_array_elements(v_lignes) with ordinality as l(v, n);
  if v_approuves and jsonb_array_length(v_lignes) > 0 then
    insert into public.ecritures_brouillon (dossier_id, affectation_id, date, compte, libelle, montant, sens, statut)
    select p_dossier_id, v_id, v_date, a.v ->> 'compte', 'Affectation du résultat ' || p_exercice,
           round(((a.v ->> 'centimes')::numeric) / 100, 2), a.v ->> 'sens', 'proposee'
      from jsonb_array_elements(v_attendues) with ordinality as a(v, rang) order by a.rang;
    select count(*) into v_desequilibre from (
      select 1 from public.ecritures_brouillon e where e.affectation_id = v_id
      having sum(case when e.sens = 'debit' then e.montant else -e.montant end) <> 0) x;
    if v_desequilibre > 0 then
      raise exception 'Écriture d’affectation déséquilibrée.' using errcode = '23514';
    end if;
  end if;
  perform set_config('jd.affectation', '', true);
  return v_id;
end
$fonction$;
revoke execute on function public.enregistrer_affectation(uuid, integer, integer, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.enregistrer_affectation(uuid, integer, integer, jsonb, jsonb, jsonb) to authenticated;
comment on function public.enregistrer_affectation(uuid, integer, integer, jsonb, jsonb, jsonb) is
  'AFF2 (lignes 33 et 45) : enregistre la décision d''approbation et d''affectation du résultat d''un exercice validé (ou la remplace par une version nouvelle), sa répartition et son écriture, recomposée en entiers et comparée à celle que l''application propose. Le cabinet du dossier, en engagement, une société.';

-- ══ 7. Retirer une décision ══
-- Les refus : l'accès, la décision lue (en vigueur, à sa version), le gel (l'exercice de sa date validé, ou une ligne de son
-- écriture qui n'est plus proposée). Rend le nombre de lignes du brouillon retirées.
create function public.retirer_affectation(p_dossier_id uuid, p_affectation_id uuid, p_version_lue integer)
 returns integer
 language plpgsql
 security definer
 set search_path = public
as $fonction$
declare
  v_decision public.affectations_du_resultat%rowtype;
  v_frontiere date;
  v_lignes integer;
begin
  if p_dossier_id is null or auth.uid() is null or not coalesce(public.admin_du_dossier(p_dossier_id), false) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  select * into v_decision from public.affectations_du_resultat a where a.id = p_affectation_id and a.dossier_id = p_dossier_id;
  if found then
    perform pg_advisory_xact_lock(hashtextextended('affectation|' || p_dossier_id::text || '|' || v_decision.exercice_affecte::text, 0));
    select * into v_decision from public.affectations_du_resultat a where a.id = p_affectation_id for update;
  end if;
  if v_decision.id is null or v_decision.etat <> 'en_vigueur' or p_version_lue is null or p_version_lue <> v_decision.version then
    raise exception '%', 'Cette décision a changé depuis sa lecture : relire l’affectation avant de l’enregistrer.' using errcode = '40001';
  end if;
  v_frontiere := public.frontiere_validation(p_dossier_id);
  if (v_frontiere is not null and extract(year from v_decision.date_decision) <= extract(year from v_frontiere))
     or exists (select 1 from public.ecritures_brouillon e where e.affectation_id = p_affectation_id and e.statut <> 'proposee') then
    raise exception '%', format('L’exercice qui contient le %s est validé : une écriture n’y entre plus.', to_char(v_decision.date_decision, 'DD/MM/YYYY'))
      using errcode = '23514';
  end if;
  perform set_config('jd.affectation', p_dossier_id::text, true);
  delete from public.ecritures_brouillon e where e.affectation_id = p_affectation_id;
  get diagnostics v_lignes = row_count;
  update public.affectations_du_resultat a set etat = 'retiree', fin_par = auth.uid(), fin_le = now() where a.id = p_affectation_id;
  perform set_config('jd.affectation', '', true);
  return v_lignes;
end
$fonction$;
revoke execute on function public.retirer_affectation(uuid, uuid, integer) from public, anon;
grant execute on function public.retirer_affectation(uuid, uuid, integer) to authenticated;
comment on function public.retirer_affectation(uuid, uuid, integer) is
  'AFF2 (lignes 33 et 45) : retire une décision d''affectation en vigueur (elle reste lisible, retirée) et son écriture, tant que l''exercice de sa date n''est pas validé, contre la version lue. Le cabinet du dossier.';

-- ══ 8. Joindre le procès-verbal ══
-- Le PDF déposé au stockage du dossier, à son chemin (`<dossier>/affectations/<décision>.pdf`), son empreinte SHA-256 : une
-- fois par version, sur la décision en vigueur, tant que l'exercice de sa date n'est pas validé (AFF5 l'appellera).
create function public.joindre_document_affectation(p_affectation_id uuid, p_chemin text, p_empreinte text)
 returns void
 language plpgsql
 security definer
 set search_path = public
as $fonction$
declare
  v_decision public.affectations_du_resultat%rowtype;
  v_frontiere date;
begin
  select * into v_decision from public.affectations_du_resultat a where a.id = p_affectation_id;
  if p_affectation_id is null or v_decision.id is null or auth.uid() is null
     or not coalesce(public.admin_du_dossier(v_decision.dossier_id), false) then
    raise exception 'Accès refusé à cette décision.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(v_decision.dossier_id));
  select * into v_decision from public.affectations_du_resultat a where a.id = p_affectation_id for update;
  if v_decision.etat <> 'en_vigueur' then
    raise exception '%', 'Cette décision a changé depuis sa lecture : relire l’affectation avant de l’enregistrer.' using errcode = '40001';
  end if;
  if v_decision.document_chemin is not null then
    raise exception '%', 'Le procès-verbal de cette décision est déjà joint : une version nouvelle de la décision en produit un nouveau.'
      using errcode = '22023';
  end if;
  if p_chemin is distinct from v_decision.dossier_id::text || '/affectations/' || v_decision.id::text || '.pdf'
     or coalesce(p_empreinte, '') !~ '^[0-9a-f]{64}$' then
    raise exception '%', 'Le procès-verbal se dépose au chemin de sa décision, avec son empreinte SHA-256.' using errcode = '22023';
  end if;
  v_frontiere := public.frontiere_validation(v_decision.dossier_id);
  if v_frontiere is not null and extract(year from v_decision.date_decision) <= extract(year from v_frontiere) then
    raise exception '%', format('L’exercice qui contient le %s est validé : une écriture n’y entre plus.', to_char(v_decision.date_decision, 'DD/MM/YYYY'))
      using errcode = '23514';
  end if;
  perform set_config('jd.affectation', v_decision.dossier_id::text, true);
  update public.affectations_du_resultat a set document_chemin = p_chemin, document_empreinte = p_empreinte where a.id = p_affectation_id;
  perform set_config('jd.affectation', '', true);
end
$fonction$;
revoke execute on function public.joindre_document_affectation(uuid, text, text) from public, anon;
grant execute on function public.joindre_document_affectation(uuid, text, text) to authenticated;
comment on function public.joindre_document_affectation(uuid, text, text) is
  'AFF2 (lignes 33 et 45) : joint à la décision en vigueur son procès-verbal (chemin et empreinte SHA-256), une fois par version. Le cabinet du dossier.';

-- ══ 9. La double authentification exigée, si elle est déjà en base ══
do $deux_facteurs$
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    execute 'create policy deux_facteurs on public.affectations_du_resultat as restrictive for all to authenticated '
      || 'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))';
    execute 'create policy deux_facteurs on public.lignes_d_affectation as restrictive for all to authenticated '
      || 'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))';
  end if;
end
$deux_facteurs$;
