-- LA RÉVISION DES COMPTES, ÉTAPE R5 : LA REVUE ANALYTIQUE — LE SEUIL DE SIGNIFICATION ET L'EXPLICATION DES VARIATIONS
-- (ligne 41 de la feuille de route ; conception du 09/10/2026, HISTORIQUE.md, « LA RÉVISION DES COMPTES : LA
-- CONCEPTION », § 1.4, 1.7, 3.3, 3.7 et 4.5).
--
-- L'expert-comptable « met en œuvre une revue analytique lors de l'examen de la cohérence et de la vraisemblance » des
-- comptes (NP 2300, § 13, arrêté du 01/09/2016) ; il « effectue des rapprochements entre les rubriques du bilan et du
-- compte de résultat » avec l'exercice précédent et analyse les variations significatives (A7) ; devant « des
-- variations significatives ou des tendances inattendues », il détermine des diligences complémentaires (§ 14) et
-- « s'efforce d'obtenir des explications de la direction » (§ 15). Le seuil de signification est un « montant au-delà
-- duquel les décisions économiques ou le jugement fondé sur les comptes sont susceptibles d'être influencés » (glossaire
-- agréé par l'arrêté du 30/05/2024, en vigueur le 01/01/2025). Textes relus sur Légifrance le 11/10/2026.
--
-- CE QUE CETTE MIGRATION POSE, sur le patron des étapes R1 et R4 — des affirmations datées, signées, IMMUABLES, écrites
-- par des fonctions seules, lues par le cabinet seul :
--   - `revision_seuils` : le seuil de signification d'un exercice, un MONTANT fixé et MOTIVÉ par le cabinet. Il se
--     REMPLACE par un autre (chaîne `remplace_id`), jamais ne se modifie ;
--   - `revision_explications` : l'explication d'une variation entre l'exercice et le précédent, sur une ligne de la
--     revue — un poste de la 2035 (avec sa nature, recette ou dépense : le moteur de la 2035 tient une ligne par poste ET
--     par nature), un total de la 2035 (recettes, dépenses, résultat) ou un compte des classes 1 à 7. Elle porte les
--     montants qu'elle commente, l'exercice et le précédent, et la SOURCE du précédent : la 2035 validée ou l'exercice
--     validé (`validee`), un repère annuel lu d'une ancienne 2035 (`reference`, l'onglet Estimation), ou rien
--     (`aucune`) — jamais un recalcul de l'exercice précédent. Elle se remplace, jamais ne se modifie.
-- Ce qui n'est pas stocké, et se DÉDUIT (src/lib/revueAnalytique.ts) : le tableau de l'exercice face au précédent, la
-- variation en euros et en pourcentage, l'explication ATTENDUE au-delà du seuil — dite, pas imposée avant l'étape R6 —
-- et l'explication À REVOIR quand les montants qu'elle commente ne sont plus ceux du jour. L'application ne qualifie
-- aucune variation de « normale » : elle calcule, et seul le cabinet explique.
--
-- CE QUE LA BASE VÉRIFIE AU CLIC, comme `justifier_solde` (étape R1) le fait du solde : la source que la base retient
-- pour l'exercice précédent, ligne par ligne ; le solde d'un compte, pour l'exercice et pour le précédent validé
-- (`solde_du_compte`) ; les montants d'une 2035 validée, de l'exercice ou du précédent, et ceux d'un repère annuel.
-- Ce qu'elle ne peut pas vérifier, et le dit : le montant d'une ligne de la 2035 d'un exercice qui n'est pas encore
-- validé — la 2035 se calcule dans le navigateur (src/lib/declaration2035.ts) ; l'explication garde le montant que
-- l'écran a montré, et le module la dit à revoir dès que la 2035 du jour en diffère.
--
-- LES QUESTIONS AU CABINET N'ONT PAS ENCORE DE RÉPONSE. Les recommandations de la conception sont prises comme
-- HYPOTHÈSES, chacune rangée pour qu'une autre réponse se reprenne par `create or replace function`, sans rien retirer :
--   - Q4, LE SEUIL : fixé par le cabinet, par dossier et par exercice, avec un motif ; l'application n'en calcule aucun et
--     n'en propose aucun ; sans seuil, aucune explication n'est attendue ;
--   - Q2 : tout membre du cabinet affecté au dossier fixe le seuil et explique (`admin_du_dossier`, refus 1) ;
--   - Q11 : seul un exercice terminé se révise (refus 3) ;
--   - Q7 : la suppression d'un dossier emporte ses seuils et ses explications (clés du dossier en cascade) ;
--   - Q6 : figer le dossier de travail est l'étape R9 — sa place est gardée dans l'ordre des refus ;
--   - Q1 : l'explication attendue n'est pas un préalable de la validation avant l'étape R6 ; `valider_exercice` ne change
--     pas.
--
-- Données mesurées le 11/10/2026 (comptes seulement) : aucune décision ni conclusion de la révision en production, aucun
-- exercice validé, un repère annuel, aucun repère par poste. Tout ce qui suit est latent.

-- ══ Les seuils ══════════
-- Le seuil de signification d'un exercice : un montant positif, au centime, et pourquoi ce montant (« 5 % du
-- résultat », « 2 % des recettes »…). L'auteur est un repère d'audit sans clé étrangère, comme
-- `exercices_valides.valide_par` : retirer le compte d'un membre parti ne doit pas effacer qui a fixé le seuil. La borne
-- écarte aussi NaN, qu'un `numeric` admettrait malgré sa précision.
create table public.revision_seuils (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  annee integer not null
    constraint revision_seuils_annee check (annee between 2000 and 2100),
  seuil numeric(16,2) not null
    constraint revision_seuils_seuil check (seuil > 0 and seuil < 100000000000000),
  -- Des blancs seuls (espaces, tabulations, retours à la ligne) ne sont pas un motif.
  motif text not null
    constraint revision_seuils_motif check (btrim(motif, E' \t\n\r') <> '' and length(motif) <= 4000),
  remplace_id uuid references public.revision_seuils (id),
  auteur uuid not null,
  cree_le timestamptz not null default now(),
  constraint revision_seuils_une_suite unique (remplace_id)
);

-- Un seul PREMIER seuil par exercice. Avec l'unicité de `remplace_id`, chaque exercice porte une CHAÎNE linéaire de
-- seuils, et le courant est celui qu'aucun autre ne remplace : l'ordre est la chaîne, aucun horodatage ne départage, et
-- il survit à une restauration. Partiel, et c'est un invariant : aucun upsert ne le vise.
create unique index revision_seuils_un_premier on public.revision_seuils (dossier_id, annee) where remplace_id is null;
create index revision_seuils_dossier on public.revision_seuils (dossier_id, annee);

-- ══ Les explications ══════════
-- L'explication d'une variation, sur une ligne de la revue analytique d'un exercice. La LIGNE est le type d'objet, l'objet
-- et la nature : un poste de la 2035 se nomme comme le moteur le nomme, avec sa nature ; un total est celui des
-- recettes, des dépenses ou le résultat ; un compte, son numéro. Les montants sont ceux que l'explication commente, au
-- centime : ceux d'une ligne de la 2035 tels que la 2035 les porte (positifs, la nature disant le sens ; le résultat
-- signé), le solde d'un compte débit positif, comme une décision de l'étape R1. Le montant précédent n'existe qu'avec
-- sa source ; un compte ne se compare qu'à l'exercice validé, jamais à un repère annuel, qui ne porte que des postes et
-- des totaux de la 2035.
create table public.revision_explications (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  annee integer not null
    constraint revision_explications_annee check (annee between 2000 and 2100),
  objet_type text not null
    constraint revision_explications_objet_type check (objet_type in ('poste_2035', 'total_2035', 'compte')),
  objet text not null,
  nature text
    constraint revision_explications_nature check (nature in ('recette', 'depense')),
  montant numeric(16,2) not null
    constraint revision_explications_montant check (abs(montant) < 100000000000000),
  montant_precedent numeric(16,2)
    constraint revision_explications_montant_precedent check (abs(montant_precedent) < 100000000000000),
  source_precedent text not null
    constraint revision_explications_source_precedent check (source_precedent in ('validee', 'reference', 'aucune')),
  explication text not null
    constraint revision_explications_explication check (btrim(explication, E' \t\n\r') <> '' and length(explication) <= 4000),
  remplace_id uuid references public.revision_explications (id),
  auteur uuid not null,
  cree_le timestamptz not null default now(),
  constraint revision_explications_objet check (
    case objet_type
      when 'poste_2035' then btrim(objet, E' \t\n\r') <> '' and length(objet) <= 500 and nature is not null
      when 'total_2035' then objet in ('recettes', 'depenses', 'resultat') and nature is null
      when 'compte' then objet ~ '^[1-7][0-9]{2,}$' and nature is null
    end),
  constraint revision_explications_precedent check ((source_precedent = 'aucune') = (montant_precedent is null)),
  constraint revision_explications_compte_sans_repere check (objet_type <> 'compte' or source_precedent <> 'reference'),
  constraint revision_explications_une_suite unique (remplace_id)
);

-- Une seule PREMIÈRE explication par ligne et par exercice ; deux natures nulles se heurtent (un total, un compte). Avec
-- l'unicité de `remplace_id`, chaque ligne porte une CHAÎNE, et la courante est celle qu'aucune ne remplace. Partiel, et
-- c'est un invariant : aucun upsert ne le vise.
create unique index revision_explications_une_premiere
  on public.revision_explications (dossier_id, annee, objet_type, objet, nature) nulls not distinct
  where remplace_id is null;
create index revision_explications_dossier on public.revision_explications (dossier_id, annee);

-- ══ Les gardes ══════════
-- Rien ne se modifie et rien ne se supprime, sauf avec le dossier entier, que la ligne ne voit déjà plus pendant la
-- cascade (le critère des gardes des étapes R1 et R4). Un seuil en remplace un du même exercice ; une explication en
-- remplace une de la même ligne et du même exercice. Ce que les fonctions vérifient de plus — le courant, les montants,
-- la source — ne se rejoue pas ici : une restauration réinsère l'historique tel qu'il a été écrit. Aux droits de
-- l'appelant, et avant la RLS : qui ne voit pas un seuil est refusé sans apprendre s'il existe.
create function public.garder_revision_seuil() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Un seuil de signification ne se supprime pas : il se remplace par un autre, et l''historique reste.'
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Un seuil de signification ne se modifie pas : il se remplace par un autre, et l''historique reste.'
      using errcode = '23514';
  end if;
  if new.remplace_id is not null and not exists (
       select 1 from public.revision_seuils s
        where s.id = new.remplace_id and s.dossier_id = new.dossier_id and s.annee = new.annee) then
    raise exception 'Un seuil en remplace un du même exercice, dans le même dossier.' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger revision_seuils_gardes
  before insert or update or delete on public.revision_seuils
  for each row execute function public.garder_revision_seuil();

create function public.garder_revision_explication() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Une explication de la revue analytique ne se supprime pas : elle se remplace par une autre, et l''historique reste.'
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Une explication de la revue analytique ne se modifie pas : elle se remplace par une autre, et l''historique reste.'
      using errcode = '23514';
  end if;
  if new.remplace_id is not null and not exists (
       select 1 from public.revision_explications e
        where e.id = new.remplace_id and e.dossier_id = new.dossier_id and e.annee = new.annee
          and e.objet_type = new.objet_type and e.objet = new.objet and e.nature is not distinct from new.nature) then
    raise exception 'Une explication en remplace une de la même ligne, pour le même exercice.' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger revision_explications_gardes
  before insert or update or delete on public.revision_explications
  for each row execute function public.garder_revision_explication();

-- ══ Qui lit, qui écrit ══════════
-- Le cabinet LIT la revue analytique de ses dossiers et l'écrit par `fixer_seuil_de_signification` et
-- `expliquer_variation`, seules à le faire depuis le navigateur : les tables n'ont aucune policy d'écriture ordinaire. Le
-- super-administrateur en insère pour restaurer une sauvegarde. Le client n'y voit rien : aucune policy ne le nomme.
alter table public.revision_seuils enable row level security;
create policy revision_seuils_lecture on public.revision_seuils
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy revision_seuils_restauration on public.revision_seuils
  for insert to authenticated with check (is_super_admin());

alter table public.revision_explications enable row level security;
create policy revision_explications_lecture on public.revision_explications
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy revision_explications_restauration on public.revision_explications
  for insert to authenticated with check (is_super_admin());

-- ══ Les centimes d'un montant, comme l'application les compte ══════════
-- Math.round(montant × 100) sur le nombre que le navigateur lit — le binaire le plus proche du décimal, comme JSON.parse
-- le rend d'un nombre de la base —, l'arrondi de Math.round écrit avec floor(), comme dans `solde_du_compte`. Un
-- montant hors de ±10^14 €, NaN ou l'infini n'a pas de centimes : nul. La conversion en double précision ne se tente
-- qu'en deçà de 10^300, où elle ne peut pas lever. Le jumeau est `centimesDuNavigateur` (src/lib/revueAnalytique.ts).
-- Interne : aucun rôle ne l'appelle.
create function public.centimes_du_navigateur(p_montant numeric) returns bigint
language plpgsql immutable
set search_path = public
as $$
declare
  v double precision;
begin
  if p_montant is null or not (abs(p_montant) < 1e300) then
    return null;
  end if;
  v := p_montant::double precision;
  if not (abs(v) < 100000000000000::double precision) then
    return null;
  end if;
  v := v * 100::double precision;
  return (floor(v) + case when v - floor(v) >= 0.5::double precision then 1 else 0 end)::bigint;
end
$$;

-- ══ Une ligne de la 2035 validée ══════════
-- Les centimes d'une ligne dans la 2035 telle qu'elle a été validée (`exercices_valides.declaration`, l'instantané de
-- src/lib/validationExercice.ts) : un poste, la somme de ses entrées de même nom et de même nature — zéro quand la 2035
-- validée ne le porte pas : rien n'y a été déclaré ; un total, celui que l'instantané garde. NUL quand l'instantané ne se
-- relit pas : un objet, une liste de postes (chacun un nom, une nature, un montant) et trois totaux, chaque montant un
-- nombre aux bornes de l'application. Le jumeau est `lireLa2035Validee` (src/lib/revueAnalytique.ts). Interne.
create function public.centimes_de_la_2035_validee(p_declaration jsonb, p_objet_type text, p_objet text, p_nature text)
returns bigint
language plpgsql stable
set search_path = public
as $$
begin
  if p_declaration is null or jsonb_typeof(p_declaration) <> 'object'
     or coalesce(jsonb_typeof(p_declaration -> 'postes'), 'null') <> 'array'
     or exists (select 1 from unnest(array['totalRecettes', 'totalDepenses', 'resultat']) k(cle)
                 where public.centimes_du_navigateur(
                         case when jsonb_typeof(p_declaration -> k.cle) = 'number' then (p_declaration ->> k.cle)::numeric end
                       ) is null)
     or exists (select 1 from jsonb_array_elements(p_declaration -> 'postes') e(v)
                 where jsonb_typeof(e.v) <> 'object'
                    or coalesce(jsonb_typeof(e.v -> 'poste'), 'null') <> 'string'
                    or coalesce(jsonb_typeof(e.v -> 'nature'), 'null') <> 'string'
                    or e.v ->> 'nature' not in ('recette', 'depense')
                    or public.centimes_du_navigateur(
                         case when jsonb_typeof(e.v -> 'montant') = 'number' then (e.v ->> 'montant')::numeric end
                       ) is null) then
    return null;
  end if;
  if p_objet_type = 'total_2035' then
    return public.centimes_du_navigateur((p_declaration ->> case p_objet when 'recettes' then 'totalRecettes'
                                                                         when 'depenses' then 'totalDepenses'
                                                                         else 'resultat' end)::numeric);
  end if;
  return coalesce((select sum(public.centimes_du_navigateur((e.v ->> 'montant')::numeric))
                     from jsonb_array_elements(p_declaration -> 'postes') e(v)
                    where e.v ->> 'poste' = p_objet and e.v ->> 'nature' = p_nature), 0)::bigint;
end
$$;

-- ══ Une ligne d'un repère annuel ══════════
-- Les centimes d'une ligne dans les repères annuels d'un exercice, lus d'une ancienne 2035 ou calculés par l'onglet
-- Estimation : un poste de DÉPENSES dans `references_postes_annuels`, à son nom exact (le détail par poste n'y porte que
-- des charges) ; le total des recettes dans le chiffre d'affaires de `references_annuelles`, le résultat dans son
-- résultat net. Rien d'autre : ni un poste de recettes, ni le total des dépenses, ni un compte. NUL sans repère
-- utilisable — absent, vide, ou hors des bornes de l'application. Le jumeau est `centimesDuRepereAnnuel`
-- (src/lib/revueAnalytique.ts). Interne.
create function public.centimes_du_repere_annuel(p_dossier_id uuid, p_annee integer, p_objet_type text, p_objet text, p_nature text)
returns bigint
language plpgsql stable
set search_path = public
as $$
begin
  if p_objet_type = 'poste_2035' and p_nature = 'depense' then
    return (select public.centimes_du_navigateur(r.montant) from public.references_postes_annuels r
             where r.dossier_id = p_dossier_id and r.annee = p_annee and r.poste = p_objet);
  end if;
  if p_objet_type = 'total_2035' and p_objet = 'recettes' then
    return (select public.centimes_du_navigateur(r.chiffre_affaires) from public.references_annuelles r
             where r.dossier_id = p_dossier_id and r.annee = p_annee);
  end if;
  if p_objet_type = 'total_2035' and p_objet = 'resultat' then
    return (select public.centimes_du_navigateur(r.resultat_net) from public.references_annuelles r
             where r.dossier_id = p_dossier_id and r.annee = p_annee);
  end if;
  return null;
end
$$;

-- ══ La source de l'exercice précédent ══════════
-- Ce à quoi une ligne de l'exercice se compare, dans cet ordre, et jamais à un recalcul de l'exercice précédent : la
-- 2035 VALIDÉE de l'exercice précédent pour une ligne de la 2035, son exercice VALIDÉ pour un compte (`validee`) ;
-- sinon un repère annuel qui porte la ligne (`reference`, jamais pour un compte) ; sinon rien (`aucune`). Un exercice
-- validé en engagement n'a pas de 2035 validée : ses lignes de la 2035 passent au repère. Le jumeau est
-- `sourceDuPrecedent` (src/lib/revueAnalytique.ts). Interne.
create function public.source_du_precedent(p_dossier_id uuid, p_annee integer, p_objet_type text, p_objet text, p_nature text)
returns text
language plpgsql stable
set search_path = public
as $$
begin
  if p_objet_type = 'compte' then
    return case when exists (select 1 from public.exercices_valides v where v.dossier_id = p_dossier_id and v.annee = p_annee - 1)
                then 'validee' else 'aucune' end;
  end if;
  if exists (select 1 from public.exercices_valides v
              where v.dossier_id = p_dossier_id and v.annee = p_annee - 1 and v.declaration is not null) then
    return 'validee';
  end if;
  if public.centimes_du_repere_annuel(p_dossier_id, p_annee - 1, p_objet_type, p_objet, p_nature) is not null then
    return 'reference';
  end if;
  return 'aucune';
end
$$;

-- ══ Fixer le seuil de signification ══════════
-- Sous le verrou partagé de la validation puis le verrou exclusif de la révision du dossier (`cle_revision`, l'ordre des
-- étapes R1 et R4) : deux seuils concurrents d'un même exercice se suivent, et le second voit le premier (refus 7). Les
-- refus, dans cet ordre — le module de l'étape R5 (src/lib/revueAnalytique.ts) les dit avant le clic, dans le même ordre
-- et sous les mêmes mots :
--   1. un appelant qui n'est pas `admin_du_dossier` du dossier annoncé, ou un dossier qui n'existe pas (42501) —
--      HYPOTHÈSE Q2 ;
--   2. un exercice hors de 2000 à 2100 ;
--   3. un exercice pas encore terminé, l'année lue à Paris (HYPOTHÈSE Q11) ;
--   4. (étape R9) un dossier de travail figé — la place est gardée dans l'ordre ;
--   5. un seuil qui n'est pas un montant positif au centime ;
--   6. un seuil sans motif, ou un motif de plus de 4 000 caractères (HYPOTHÈSE Q4 : le cabinet fixe ET motive) ;
--   7. un seuil à remplacer qui n'est pas un seuil de l'exercice dans ce dossier, ou n'est pas le courant — ou aucun
--      remplacement quand l'exercice en a un.
-- Tous en 22023, sauf l'accès. Elle rend le seuil écrit, son identifiant et son instant compris.
create function public.fixer_seuil_de_signification(
  p_dossier_id uuid,
  p_annee integer,
  p_seuil numeric,
  p_motif text,
  p_remplace_id uuid
)
returns public.revision_seuils
language plpgsql
security definer
set search_path = public
as $$
declare
  v_courant uuid;
  v_seuil public.revision_seuils;
begin
  -- 1. L'accès, sur le dossier ANNONCÉ : un dossier qui n'existe pas se refuse comme un dossier interdit.
  if not public.admin_du_dossier(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- 2.
  if p_annee is null or p_annee < 2000 or p_annee > 2100 then
    raise exception 'Exercice invalide.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  perform pg_advisory_xact_lock(public.cle_revision(p_dossier_id));
  -- 3. L'année se lit à Paris, comme pour la validation et les soldes.
  if p_annee >= extract(year from (now() at time zone 'Europe/Paris'))::integer then
    raise exception 'L''exercice % n''est pas terminé : sa révision s''ouvre une fois clos.', p_annee using errcode = '22023';
  end if;
  -- 5. Un montant, positif, au centime ; la borne écarte aussi NaN.
  if p_seuil is null or not (p_seuil > 0 and p_seuil < 100000000000000) or p_seuil <> round(p_seuil, 2) then
    raise exception 'Le seuil de signification est un montant positif, au centime.' using errcode = '22023';
  end if;
  -- 6. HYPOTHÈSE Q4 : le cabinet fixe le seuil, et dit pourquoi ce montant.
  if p_motif is null or btrim(p_motif, E' \t\n\r') = '' then
    raise exception 'Un seuil de signification se motive.' using errcode = '22023';
  end if;
  if length(p_motif) > 4000 then
    raise exception 'Un motif tient en 4 000 caractères au plus.' using errcode = '22023';
  end if;
  -- 7. Le seuil courant est celui qu'aucun autre ne remplace : on remplace celui-là, ou rien s'il n'y en a pas.
  select s.id into v_courant from public.revision_seuils s
   where s.dossier_id = p_dossier_id and s.annee = p_annee
     and not exists (select 1 from public.revision_seuils r where r.remplace_id = s.id);
  if p_remplace_id is not null and not exists (
       select 1 from public.revision_seuils s where s.id = p_remplace_id and s.dossier_id = p_dossier_id and s.annee = p_annee) then
    raise exception 'Le seuil à remplacer n''est pas un seuil de l''exercice % dans ce dossier.', p_annee using errcode = '22023';
  end if;
  if p_remplace_id is distinct from v_courant then
    raise exception 'Un autre seuil a été fixé pour cet exercice depuis : relire avant de le changer.' using errcode = '22023';
  end if;

  insert into public.revision_seuils (dossier_id, annee, seuil, motif, remplace_id, auteur)
  values (p_dossier_id, p_annee, p_seuil, p_motif, p_remplace_id, auth.uid())
  returning * into v_seuil;
  return v_seuil;
end
$$;

-- ══ Expliquer une variation ══════════
-- Sous les mêmes verrous : une explication ne s'écrit jamais à côté d'une validation, et deux explications concurrentes
-- d'une même ligne se suivent (la seconde voit la première, refus 10). Les refus, dans cet ordre — le module de l'étape
-- R5 les dit avant le clic, dans le même ordre et sous les mêmes mots :
--   1. l'accès (42501) — HYPOTHÈSE Q2 ;
--   2. un exercice hors de 2000 à 2100 ;
--   3. un exercice pas encore terminé (HYPOTHÈSE Q11) ;
--   4. (étape R9) un dossier de travail figé ;
--   5. une ligne qui n'en est pas une : un type d'objet inconnu ; un poste sans nom, au nom de plus de 500 caractères,
--      ou sans nature ; un total qui n'est ni les recettes, ni les dépenses, ni le résultat ; un compte hors des classes
--      1 à 7 ; une nature sur autre chose qu'un poste ;
--   6. des montants ou une source mal formés : un montant qui n'est pas au centime, une source inconnue, un montant
--      précédent sans source ou une source sans montant précédent ;
--   7. une explication vide, ou de plus de 4 000 caractères ;
--   8. une source qui n'est pas celle que la base retient pour cette ligne (`source_du_precedent`) ;
--   9. des montants qui ne sont plus ceux de la base : le solde d'un compte, de l'exercice ou du précédent validé ; une
--      ligne de la 2035 validée, de l'exercice ou du précédent — ou une 2035 validée qui ne se relit pas ; une ligne d'un
--      repère annuel. Le montant d'une ligne de la 2035 d'un exercice NON validé ne se vérifie pas ici : il se calcule
--      dans le navigateur ;
--  10. une explication à remplacer qui n'est pas une explication de la ligne pour l'exercice, ou n'est pas sa courante —
--      ou aucun remplacement quand la ligne en a une.
-- Tous en 22023, sauf l'accès. Elle rend l'explication écrite, son identifiant et son instant compris.
create function public.expliquer_variation(
  p_dossier_id uuid,
  p_annee integer,
  p_objet_type text,
  p_objet text,
  p_nature text,
  p_montant numeric,
  p_montant_precedent numeric,
  p_source_precedent text,
  p_explication text,
  p_remplace_id uuid
)
returns public.revision_explications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source text;
  v_solde numeric;
  v_declaration jsonb;
  v_centimes bigint;
  v_courante uuid;
  v_explication public.revision_explications;
begin
  -- 1. L'accès, sur le dossier ANNONCÉ : un dossier qui n'existe pas se refuse comme un dossier interdit.
  if not public.admin_du_dossier(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- 2.
  if p_annee is null or p_annee < 2000 or p_annee > 2100 then
    raise exception 'Exercice invalide.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  perform pg_advisory_xact_lock(public.cle_revision(p_dossier_id));
  -- 3.
  if p_annee >= extract(year from (now() at time zone 'Europe/Paris'))::integer then
    raise exception 'L''exercice % n''est pas terminé : sa révision s''ouvre une fois clos.', p_annee using errcode = '22023';
  end if;
  -- 5. La ligne : un poste de la 2035 et sa nature, un total de la 2035, ou un compte.
  if p_objet_type is null or p_objet_type not in ('poste_2035', 'total_2035', 'compte') then
    raise exception 'Une explication porte sur un poste de la 2035, un total de la 2035 ou un compte.' using errcode = '22023';
  end if;
  if p_objet_type = 'poste_2035' then
    if p_objet is null or btrim(p_objet, E' \t\n\r') = '' then
      raise exception 'Un poste de la 2035 se nomme : son nom ne peut pas être vide.' using errcode = '22023';
    end if;
    if length(p_objet) > 500 then
      raise exception 'Le nom d''un poste de la 2035 tient en 500 caractères au plus.' using errcode = '22023';
    end if;
    if p_nature is null or p_nature not in ('recette', 'depense') then
      raise exception 'Un poste de la 2035 est une recette ou une dépense.' using errcode = '22023';
    end if;
  elsif p_objet_type = 'total_2035' then
    if p_objet is null or p_objet not in ('recettes', 'depenses', 'resultat') then
      raise exception 'Un total de la 2035 est celui des recettes, celui des dépenses, ou le résultat.' using errcode = '22023';
    end if;
  elsif p_objet is null or p_objet !~ '^[1-7][0-9]{2,}$' then
    raise exception 'Seul un compte des classes 1 à 7 se compare d''un exercice à l''autre.' using errcode = '22023';
  end if;
  if p_objet_type <> 'poste_2035' and p_nature is not null then
    raise exception 'Seul un poste de la 2035 porte une nature.' using errcode = '22023';
  end if;
  -- 6. Les montants, au centime ; la source, et un montant précédent avec elle seulement. La borne écarte aussi NaN.
  if p_montant is null or not (abs(p_montant) < 100000000000000) or p_montant <> round(p_montant, 2) then
    raise exception 'Le montant annoncé n''est pas un montant au centime.' using errcode = '22023';
  end if;
  if p_source_precedent is null or p_source_precedent not in ('validee', 'reference', 'aucune') then
    raise exception 'La source de l''exercice précédent est l''exercice validé, un repère annuel, ou aucune.' using errcode = '22023';
  end if;
  if p_source_precedent = 'aucune' and p_montant_precedent is not null then
    raise exception 'Sans source pour l''exercice précédent, une explication ne porte pas de montant précédent.' using errcode = '22023';
  end if;
  if p_source_precedent <> 'aucune' and (p_montant_precedent is null or not (abs(p_montant_precedent) < 100000000000000)
                                         or p_montant_precedent <> round(p_montant_precedent, 2)) then
    raise exception 'Le montant précédent annoncé n''est pas un montant au centime.' using errcode = '22023';
  end if;
  -- 7. Des blancs seuls ne sont pas une explication.
  if p_explication is null or btrim(p_explication, E' \t\n\r') = '' then
    raise exception 'Une explication se rédige : elle ne peut pas être vide.' using errcode = '22023';
  end if;
  if length(p_explication) > 4000 then
    raise exception 'Une explication tient en 4 000 caractères au plus.' using errcode = '22023';
  end if;
  -- 8. La source que la base retient pour cette ligne : la 2035 ou l'exercice validé d'abord, puis un repère annuel,
  -- sinon rien — jamais un recalcul de l'exercice précédent. Les repères de l'exercice précédent se verrouillent en
  -- partage jusqu'à la fin : un repère changé ou retiré pendant ce temps attend, et l'étape 9 relit celui qui a décidé de
  -- la source (un exercice ne se valide pas pendant ce temps : le verrou de la validation est pris).
  perform 1 from public.references_annuelles r where r.dossier_id = p_dossier_id and r.annee = p_annee - 1 for share;
  perform 1 from public.references_postes_annuels r where r.dossier_id = p_dossier_id and r.annee = p_annee - 1 for share;
  v_source := public.source_du_precedent(p_dossier_id, p_annee, p_objet_type, p_objet, p_nature);
  if p_source_precedent <> v_source then
    if v_source = 'validee' then
      raise exception 'L''exercice % est validé : la comparaison se fait à ce qu''il a validé.', p_annee - 1 using errcode = '22023';
    end if;
    if v_source = 'reference' then
      raise exception 'Un repère annuel de % porte cette ligne : la comparaison se fait à lui.', p_annee - 1 using errcode = '22023';
    end if;
    raise exception 'L''exercice % n''offre rien à comparer à cette ligne.', p_annee - 1 using errcode = '22023';
  end if;
  -- 9. Les montants de la base, quand elle sait les lire.
  if p_objet_type = 'compte' then
    v_solde := public.solde_du_compte(p_dossier_id, p_annee, p_objet);
    if p_montant <> v_solde then
      raise exception 'Le solde du compte % a changé : au 31/12/%, il %.', p_objet, p_annee,
        case when v_solde = 0 then 'est nul'
             else 'est de ' || replace(to_char(abs(v_solde), 'FM99999999999990.00'), '.', ',') || ' € au '
                  || case when v_solde > 0 then 'débit' else 'crédit' end
        end
        using errcode = '22023';
    end if;
    if v_source = 'validee' then
      v_solde := public.solde_du_compte(p_dossier_id, p_annee - 1, p_objet);
      if p_montant_precedent <> v_solde then
        raise exception 'Le solde du compte % au 31/12/% n''est pas celui de l''exercice validé : il %.', p_objet, p_annee - 1,
          case when v_solde = 0 then 'est nul'
               else 'est de ' || replace(to_char(abs(v_solde), 'FM99999999999990.00'), '.', ',') || ' € au '
                    || case when v_solde > 0 then 'débit' else 'crédit' end
          end
          using errcode = '22023';
      end if;
    end if;
  else
    -- L'exercice lui-même, quand il est validé : sa 2035 validée fait foi.
    select v.declaration into v_declaration from public.exercices_valides v
     where v.dossier_id = p_dossier_id and v.annee = p_annee;
    if v_declaration is not null then
      v_centimes := public.centimes_de_la_2035_validee(v_declaration, p_objet_type, p_objet, p_nature);
      if v_centimes is null then
        raise exception 'La 2035 validée de % ne se relit pas.', p_annee using errcode = '22023';
      end if;
      if p_montant * 100 <> v_centimes then
        raise exception 'La 2035 validée de % porte un autre montant sur cette ligne : %.', p_annee,
          replace(to_char(v_centimes / 100.0, 'FM99999999999990.00'), '.', ',') || ' €'
          using errcode = '22023';
      end if;
    end if;
    if v_source = 'validee' then
      select v.declaration into v_declaration from public.exercices_valides v
       where v.dossier_id = p_dossier_id and v.annee = p_annee - 1;
      v_centimes := public.centimes_de_la_2035_validee(v_declaration, p_objet_type, p_objet, p_nature);
      if v_centimes is null then
        raise exception 'La 2035 validée de % ne se relit pas.', p_annee - 1 using errcode = '22023';
      end if;
      if p_montant_precedent * 100 <> v_centimes then
        raise exception 'La 2035 validée de % porte un autre montant sur cette ligne : %.', p_annee - 1,
          replace(to_char(v_centimes / 100.0, 'FM99999999999990.00'), '.', ',') || ' €'
          using errcode = '22023';
      end if;
    elsif v_source = 'reference' then
      v_centimes := public.centimes_du_repere_annuel(p_dossier_id, p_annee - 1, p_objet_type, p_objet, p_nature);
      if p_montant_precedent * 100 is distinct from v_centimes then
        raise exception 'Le repère annuel de % porte un autre montant sur cette ligne : %.', p_annee - 1,
          replace(to_char(v_centimes / 100.0, 'FM99999999999990.00'), '.', ',') || ' €'
          using errcode = '22023';
      end if;
    end if;
  end if;
  -- 10. L'explication courante de la ligne est celle qu'aucune autre ne remplace : on remplace celle-là, ou rien s'il
  -- n'y en a pas.
  select e.id into v_courante from public.revision_explications e
   where e.dossier_id = p_dossier_id and e.annee = p_annee and e.objet_type = p_objet_type and e.objet = p_objet
     and e.nature is not distinct from p_nature
     and not exists (select 1 from public.revision_explications s where s.remplace_id = e.id);
  if p_remplace_id is not null and not exists (
       select 1 from public.revision_explications e
        where e.id = p_remplace_id and e.dossier_id = p_dossier_id and e.annee = p_annee and e.objet_type = p_objet_type
          and e.objet = p_objet and e.nature is not distinct from p_nature) then
    raise exception 'L''explication à remplacer n''est pas une explication de cette ligne pour l''exercice %.', p_annee
      using errcode = '22023';
  end if;
  if p_remplace_id is distinct from v_courante then
    raise exception 'Une autre explication a été donnée sur cette ligne depuis : relire avant d''expliquer.' using errcode = '22023';
  end if;

  insert into public.revision_explications (
    dossier_id, annee, objet_type, objet, nature, montant, montant_precedent, source_precedent, explication, remplace_id, auteur
  ) values (
    p_dossier_id, p_annee, p_objet_type, p_objet, p_nature, p_montant, p_montant_precedent, p_source_precedent, p_explication,
    p_remplace_id, auth.uid()
  )
  returning * into v_explication;
  return v_explication;
end
$$;

-- ══ Les droits d'exécution ══════════
-- Les deux fonctions vérifient l'accès elles-mêmes, et un anonyme n'a rien à y faire. Les autres ne servent qu'à elles et
-- aux déclencheurs : personne ne les appelle.
revoke execute on function public.fixer_seuil_de_signification(uuid, integer, numeric, text, uuid) from public, anon;
grant execute on function public.fixer_seuil_de_signification(uuid, integer, numeric, text, uuid) to authenticated;
revoke execute on function public.expliquer_variation(uuid, integer, text, text, text, numeric, numeric, text, text, uuid)
  from public, anon;
grant execute on function public.expliquer_variation(uuid, integer, text, text, text, numeric, numeric, text, text, uuid)
  to authenticated;
revoke execute on function public.centimes_du_navigateur(numeric) from public, anon, authenticated;
revoke execute on function public.centimes_de_la_2035_validee(jsonb, text, text, text) from public, anon, authenticated;
revoke execute on function public.centimes_du_repere_annuel(uuid, integer, text, text, text) from public, anon, authenticated;
revoke execute on function public.source_du_precedent(uuid, integer, text, text, text) from public, anon, authenticated;
revoke execute on function public.garder_revision_seuil() from public, anon, authenticated;
revoke execute on function public.garder_revision_explication() from public, anon, authenticated;

comment on table public.revision_seuils is
  'La révision des comptes (ligne 41, étape R5) : le seuil de signification d''un exercice, un montant fixé et motivé par le cabinet (hypothèse Q4), daté, signé, immuable ; il se remplace par un autre (remplace_id). Écrit par fixer_seuil_de_signification seule ; le client n''en voit rien.';
comment on table public.revision_explications is
  'La revue analytique de la révision des comptes (ligne 41, étape R5) : l''explication d''une variation entre un exercice et le précédent, sur un poste ou un total de la 2035 ou sur un compte, avec les montants qu''elle commente et la source du précédent (validee, reference, aucune), datée, signée, immuable ; elle se remplace par une autre (remplace_id). Écrite par expliquer_variation seule ; le client n''en voit rien.';
comment on function public.fixer_seuil_de_signification(uuid, integer, numeric, text, uuid) is
  'Fixe le seuil de signification d''un exercice, motivé, sous verrou, après les sept refus dits dans la migration revue_analytique.';
comment on function public.expliquer_variation(uuid, integer, text, text, text, numeric, numeric, text, text, uuid) is
  'Enregistre l''explication d''une variation de la revue analytique, ses montants et la source de l''exercice précédent vérifiés quand la base sait les lire, sous verrou, après les dix refus dits dans la migration revue_analytique.';
comment on function public.centimes_du_navigateur(numeric) is
  'Les centimes d''un montant comme l''application les compte (Math.round(montant × 100) en double précision), nuls hors de ±10^14 €. Lue par la revue analytique seule.';
comment on function public.centimes_de_la_2035_validee(jsonb, text, text, text) is
  'Les centimes d''une ligne de la 2035 validée (poste et nature, ou total), zéro pour un poste qu''elle ne porte pas, nuls quand l''instantané ne se relit pas. Lue par la revue analytique seule.';
comment on function public.centimes_du_repere_annuel(uuid, integer, text, text, text) is
  'Les centimes d''une ligne des repères annuels d''un exercice (un poste de dépenses, le chiffre d''affaires, le résultat net), nuls sans repère utilisable. Lue par la revue analytique seule.';
comment on function public.source_du_precedent(uuid, integer, text, text, text) is
  'La source à laquelle une ligne de la revue analytique se compare : l''exercice précédent validé, sinon un repère annuel, sinon aucune. Lue par expliquer_variation seule.';
