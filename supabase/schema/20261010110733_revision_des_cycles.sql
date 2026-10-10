-- LA RÉVISION DES COMPTES, ÉTAPE R4 : LES CYCLES — LE PROGRAMME, LA CONCLUSION, LE JOURNAL, LA REVUE (ligne 41 de la
-- feuille de route ; conception du 09/10/2026, HISTORIQUE.md, « LA RÉVISION DES COMPTES : LA CONCEPTION », § 1.5, 2,
-- 3.3 à 3.5 et 4.4).
--
-- On révise par COMPTE pour les soldes de bilan (étape R1, `revision_justifications`) et par CYCLE pour le travail et la
-- revue. Le dossier de travail d'une présentation des comptes contient « un programme de travail adapté » et « une note
-- de synthèse générale » (NP 2300, A9, arrêté du 01/09/2016) ; il « formalise également les discussions intervenues avec
-- la direction » (A8). « La nature et l'étendue des consultations et les conclusions qui en résultent sont consignées
-- dans la documentation de la mission » (norme de management de la qualité, § 29, arrêté du 30/05/2024) ; « La revue de
-- dossier est réalisée par une personne ayant la compétence appropriée » (§ 30) ; supervision et revue « peuvent, en
-- pratique, être réalisées par la même personne » (A30-1). Textes relus sur Légifrance le 10/10/2026.
--
-- CE QUE CETTE MIGRATION POSE, sur le patron de l'étape R1 — des affirmations datées, signées, IMMUABLES, écrites par des
-- fonctions seules, lues par le cabinet seul :
--   - `revision_conclusions` : la feuille d'un cycle pour un exercice — le programme de travail tel qu'il a été exécuté
--     (`travaux` : proposé par l'application, coché et annoté par le cabinet), la conclusion, « révisé » ou « anomalie »,
--     et les points que l'exercice suivant doit reprendre. Elle se REMPLACE par une autre (chaîne `remplace_id`), jamais
--     ne se modifie ;
--   - `revision_notes` : le journal d'un cycle — un échange avec la direction, une consultation, un travail fait. Il ne
--     fait que s'allonger ;
--   - `revision_revues` : la revue d'une conclusion, « approuvé » ou « à reprendre » avec son observation. Une seule par
--     conclusion : revoir de nouveau suppose une nouvelle conclusion, et l'historique garde les deux.
-- L'ÉTAT d'un cycle — non commencé, en cours, révisé, anomalie, à reprendre, revu, revue périmée — n'est pas stocké : il
-- se déduit des conclusions, des revues, du journal et de l'état des soldes du cycle (src/lib/revisionRevue.ts). Le
-- cycle « ensemble » porte la note de synthèse et la conclusion d'ensemble ; il n'a aucun compte.
--
-- LES QUESTIONS AU CABINET N'ONT PAS ENCORE DE RÉPONSE (09/10/2026). Les recommandations de la conception sont prises
-- comme HYPOTHÈSES, chacune rangée pour qu'une autre réponse se reprenne par `create or replace function`, sans rien
-- retirer :
--   - Q2, QUI REVOIT : tout membre du cabinet affecté au dossier PRÉPARE — il conclut et il note (`admin_du_dossier`,
--     refus 1 de `conclure_cycle` et de `noter_revision`) ; seul le chef du cabinet REVOIT (`est_chef_du_cabinet`, qui
--     comprend le super-administrateur ; refus 1 de `revoir_cycle`), comme il est seul à valider un exercice. Il peut
--     préparer et revoir le même cycle (A30-1), et la trace le dit : la conclusion porte son auteur, la revue le sien ;
--   - Q11, seuls les exercices terminés se révisent : ni conclusion, ni note, ni revue sur l'exercice en cours (refus 3) ;
--   - Q7, la suppression d'un dossier emporte ses conclusions, son journal et ses revues (clés du dossier en cascade) ;
--   - Q6, figer le dossier de travail est l'étape R9 : sa place est gardée dans l'ordre des refus (refus 4).
-- Rien ici ne tranche Q5 (la mission faite pour le dossier) : la conclusion envisagée d'une attestation, quand il y en a
-- une, s'écrit dans la conclusion du cycle « ensemble », sans colonne qui la présumerait. Q1 est l'étape R6 :
-- `valider_exercice` ne change pas.
--
-- Données mesurées le 10/10/2026 (comptes seulement) : aucune décision de la révision en production, aucun exercice
-- validé. Tout ce qui suit est latent.

-- ══ Les conclusions ══════════
-- La feuille d'un cycle pour un exercice. Les onze cycles de la conception (§ 2.1) sont ceux de `CYCLES_DE_REVISION`
-- (src/lib/revisionCycles.ts). `travaux` est la liste des travaux du programme, chacun `{ code, travail, fait, note }` :
-- `code` désigne un travail que l'application a proposé — nul pour un travail que le cabinet ajoute —, `travail` le dit
-- tel qu'il a été montré, `fait` s'il a été fait, `note` ce qu'il en ressort. `conclure_cycle` en juge le détail (refus
-- 9) ; la table n'en garde que la forme et la borne, comme l'instantané d'une décision (étape R1). L'auteur est un repère
-- d'audit sans clé étrangère, comme `exercices_valides.valide_par` : retirer le compte d'un membre parti ne doit pas
-- effacer qui a conclu.
create table public.revision_conclusions (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  annee integer not null
    constraint revision_conclusions_annee check (annee between 2000 and 2100),
  cycle text not null
    constraint revision_conclusions_cycle check (cycle in ('tresorerie', 'recettes', 'depenses', 'immobilisations',
      'emprunts', 'social', 'tva', 'capitaux', 'tiers', 'stocks', 'ensemble')),
  etat text not null
    constraint revision_conclusions_etat check (etat in ('revise', 'anomalie')),
  travaux jsonb not null
    constraint revision_conclusions_travaux check (jsonb_typeof(travaux) = 'array' and octet_length(travaux::text) <= 65536),
  -- Des blancs seuls (espaces, tabulations, retours à la ligne) ne sont pas une conclusion.
  conclusion text not null
    constraint revision_conclusions_conclusion check (btrim(conclusion, E' \t\n\r') <> '' and length(conclusion) <= 8000),
  a_suivre text
    constraint revision_conclusions_a_suivre check (btrim(a_suivre, E' \t\n\r') <> '' and length(a_suivre) <= 4000),
  remplace_id uuid references public.revision_conclusions (id),
  auteur uuid not null,
  cree_le timestamptz not null default now(),
  constraint revision_conclusions_une_suite unique (remplace_id)
);

-- Une seule PREMIÈRE conclusion par cycle et par exercice. Avec l'unicité de `remplace_id`, chaque cycle porte une
-- CHAÎNE linéaire de conclusions, et la courante est celle qu'aucune autre ne remplace : l'ordre est la chaîne, aucun
-- horodatage ne départage, et il survit à une restauration. Partiel, et c'est un invariant : aucun upsert ne le vise.
create unique index revision_conclusions_une_premiere on public.revision_conclusions (dossier_id, annee, cycle)
  where remplace_id is null;
create index revision_conclusions_dossier on public.revision_conclusions (dossier_id, annee, cycle);

-- ══ Le journal ══════════
-- Ce qui s'est dit et fait en révisant un cycle, au fil de l'eau : un échange avec la direction (NP 2300, A8), une
-- consultation (NPMQ, § 29), un travail fait. Une note ne se corrige pas : une autre la suit, et le journal garde les deux.
create table public.revision_notes (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  annee integer not null
    constraint revision_notes_annee check (annee between 2000 and 2100),
  cycle text not null
    constraint revision_notes_cycle check (cycle in ('tresorerie', 'recettes', 'depenses', 'immobilisations',
      'emprunts', 'social', 'tva', 'capitaux', 'tiers', 'stocks', 'ensemble')),
  nature text not null
    constraint revision_notes_nature check (nature in ('echange_direction', 'consultation', 'travail')),
  texte text not null
    constraint revision_notes_texte check (btrim(texte, E' \t\n\r') <> '' and length(texte) <= 4000),
  auteur uuid not null,
  cree_le timestamptz not null default now()
);
create index revision_notes_dossier on public.revision_notes (dossier_id, annee, cycle);

-- ══ Les revues ══════════
-- La revue d'une conclusion : « approuvé », ou « à reprendre » avec ce qui est à reprendre. Une seule par conclusion —
-- la conclusion revue ne change plus, et ce que la revue en dit non plus ; revoir de nouveau suppose une nouvelle
-- conclusion. Celui qui revoit est un repère d'audit sans clé étrangère, comme l'auteur d'une conclusion.
create table public.revision_revues (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  annee integer not null
    constraint revision_revues_annee check (annee between 2000 and 2100),
  conclusion_id uuid not null references public.revision_conclusions (id),
  avis text not null
    constraint revision_revues_avis check (avis in ('approuve', 'a_reprendre')),
  observation text
    constraint revision_revues_observation check (btrim(observation, E' \t\n\r') <> '' and length(observation) <= 4000),
  revu_par uuid not null,
  revu_le timestamptz not null default now(),
  constraint revision_revues_observation_requise check (avis = 'approuve' or observation is not null),
  constraint revision_revues_une_par_conclusion unique (conclusion_id)
);
create index revision_revues_dossier on public.revision_revues (dossier_id, annee);

-- ══ Les gardes ══════════
-- Rien ne se modifie et rien ne se supprime, sauf avec le dossier entier, que la ligne ne voit déjà plus pendant la
-- cascade (le critère des gardes de l'étape R1). Une conclusion en remplace une du même cycle et du même exercice ; une
-- revue porte sur une conclusion de son dossier et de son exercice. Ce que les fonctions vérifient de plus — la
-- conclusion COURANTE, qu'elle n'ait pas déjà été revue — ne se rejoue pas ici : une restauration réinsère l'historique
-- tel qu'il a été écrit. Aux droits de l'appelant, et avant la RLS : qui ne voit pas une conclusion est refusé sans
-- apprendre si elle existe.
create function public.garder_revision_conclusion() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Une conclusion de la révision ne se supprime pas : elle se remplace par une autre, et l''historique reste.'
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Une conclusion de la révision ne se modifie pas : elle se remplace par une autre, et l''historique reste.'
      using errcode = '23514';
  end if;
  if new.remplace_id is not null and not exists (
       select 1 from public.revision_conclusions c
        where c.id = new.remplace_id and c.dossier_id = new.dossier_id and c.annee = new.annee and c.cycle = new.cycle) then
    raise exception 'Une conclusion en remplace une du même cycle, pour le même exercice.' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger revision_conclusions_gardes
  before insert or update or delete on public.revision_conclusions
  for each row execute function public.garder_revision_conclusion();

create function public.garder_revision_note() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Une note du journal de la révision ne se supprime pas : le journal ne fait que s''allonger.'
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Une note du journal de la révision ne se modifie pas : une autre la suit, et le journal garde les deux.'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger revision_notes_gardes
  before insert or update or delete on public.revision_notes
  for each row execute function public.garder_revision_note();

create function public.garder_revision_revue() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Une revue de la révision ne se supprime pas : elle reste avec la conclusion qu''elle a revue.'
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Une revue de la révision ne se modifie pas : revoir de nouveau suppose une nouvelle conclusion.'
      using errcode = '23514';
  end if;
  if not exists (select 1 from public.revision_conclusions c
                  where c.id = new.conclusion_id and c.dossier_id = new.dossier_id and c.annee = new.annee) then
    raise exception 'Une revue porte sur une conclusion de son dossier, pour le même exercice.' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger revision_revues_gardes
  before insert or update or delete on public.revision_revues
  for each row execute function public.garder_revision_revue();

-- ══ Qui lit, qui écrit ══════════
-- Le cabinet LIT la révision de ses dossiers et l'écrit par `conclure_cycle`, `noter_revision` et `revoir_cycle`, seules
-- à le faire depuis le navigateur : les tables n'ont aucune policy d'écriture ordinaire. Le super-administrateur en
-- insère pour restaurer une sauvegarde. Le client n'y voit rien : aucune policy ne le nomme.
alter table public.revision_conclusions enable row level security;
create policy revision_conclusions_lecture on public.revision_conclusions
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy revision_conclusions_restauration on public.revision_conclusions
  for insert to authenticated with check (is_super_admin());

alter table public.revision_notes enable row level security;
create policy revision_notes_lecture on public.revision_notes
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy revision_notes_restauration on public.revision_notes
  for insert to authenticated with check (is_super_admin());

alter table public.revision_revues enable row level security;
create policy revision_revues_lecture on public.revision_revues
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy revision_revues_restauration on public.revision_revues
  for insert to authenticated with check (is_super_admin());

-- ══ Conclure un cycle ══════════
-- Sous le verrou partagé de la validation puis le verrou exclusif de la révision du dossier (`cle_revision`, l'ordre de
-- l'étape R1) : deux conclusions concurrentes d'un même cycle se suivent, et la seconde voit la première (refus 10). Les
-- refus, dans cet ordre — le module de l'étape R4 (src/lib/revisionRevue.ts) les dit avant le clic, dans le même ordre et
-- sous les mêmes mots :
--   1. un appelant qui n'est pas `admin_du_dossier` du dossier annoncé, ou un dossier qui n'existe pas (42501) —
--      HYPOTHÈSE Q2 : tout membre affecté prépare ;
--   2. un exercice hors de 2000 à 2100 ;
--   3. un exercice pas encore terminé, l'année lue à Paris (HYPOTHÈSE Q11) ;
--   4. (étape R9) un dossier de travail figé — la place est gardée dans l'ordre ;
--   5. un cycle qui n'est pas l'un des onze ;
--   6. un état qui n'est ni « révisé » ni « anomalie » ;
--   7. une conclusion vide, ou de plus de 8 000 caractères ;
--   8. des points à suivre faits de blancs, ou de plus de 4 000 caractères ;
--   9. un programme illisible, de plus de cent travaux ou de 64 Kio, un travail sans libellé ou de plus de 500
--      caractères, une note de travail faite de blancs ou de plus de 2 000 caractères, un travail proposé cité deux fois ;
--  10. une conclusion à remplacer qui n'est pas une conclusion du cycle pour l'exercice, ou n'est pas sa courante — ou
--      aucun remplacement quand le cycle en a une.
-- Tous en 22023, sauf l'accès. Elle rend la conclusion écrite, son identifiant et son instant compris.
create function public.conclure_cycle(
  p_dossier_id uuid,
  p_annee integer,
  p_cycle text,
  p_etat text,
  p_travaux jsonb,
  p_conclusion text,
  p_a_suivre text,
  p_remplace_id uuid
)
returns public.revision_conclusions
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Le JSON `null` ne se distingue pas d'une absence : aucun travail.
  v_travaux jsonb := coalesce(nullif(p_travaux, 'null'::jsonb), '[]'::jsonb);
  v_courante uuid;
  v_conclusion public.revision_conclusions;
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
  -- 5.
  if p_cycle is null or p_cycle not in ('tresorerie', 'recettes', 'depenses', 'immobilisations', 'emprunts', 'social',
                                          'tva', 'capitaux', 'tiers', 'stocks', 'ensemble') then
    raise exception 'Le cycle annoncé n''est pas un cycle de la révision.' using errcode = '22023';
  end if;
  -- 6.
  if p_etat is null or p_etat not in ('revise', 'anomalie') then
    raise exception 'Une conclusion dit un cycle révisé, ou en anomalie.' using errcode = '22023';
  end if;
  -- 7.
  if p_conclusion is null or btrim(p_conclusion, E' \t\n\r') = '' then
    raise exception 'Une conclusion se rédige : elle ne peut pas être vide.' using errcode = '22023';
  end if;
  if length(p_conclusion) > 8000 then
    raise exception 'Une conclusion tient en 8 000 caractères au plus.' using errcode = '22023';
  end if;
  -- 8.
  if p_a_suivre is not null and btrim(p_a_suivre, E' \t\n\r') = '' then
    raise exception 'Les points à suivre ne se composent pas que de blancs : les laisser vides.' using errcode = '22023';
  end if;
  if length(p_a_suivre) > 4000 then
    raise exception 'Les points à suivre tiennent en 4 000 caractères au plus.' using errcode = '22023';
  end if;
  -- 9. Le programme : une liste de travaux, chacun avec son libellé et s'il est fait — son code s'il a été proposé, sa
  -- note s'il en a une —, et rien d'autre. Un code est celui d'un travail proposé par l'application ; le même ne figure
  -- qu'une fois. Un travail que le cabinet ajoute n'a pas de code, et deux peuvent se ressembler.
  if jsonb_typeof(v_travaux) <> 'array'
     or exists (select 1 from jsonb_array_elements(v_travaux) e(v)
                 where jsonb_typeof(e.v) <> 'object'
                    or exists (select 1 from jsonb_object_keys(e.v) k(cle) where k.cle not in ('code', 'travail', 'fait', 'note'))
                    or coalesce(jsonb_typeof(e.v -> 'travail'), 'null') <> 'string'
                    or coalesce(jsonb_typeof(e.v -> 'fait'), 'null') <> 'boolean'
                    or coalesce(jsonb_typeof(e.v -> 'note'), 'null') not in ('string', 'null')
                    or coalesce(jsonb_typeof(e.v -> 'code'), 'null') not in ('string', 'null')
                    or e.v ->> 'code' !~ '^[a-z][a-z0-9-]{0,63}$') then
    raise exception 'Le programme de travail est illisible : une liste de travaux, chacun avec son libellé et s''il est fait.'
      using errcode = '22023';
  end if;
  if jsonb_array_length(v_travaux) > 100 or octet_length(v_travaux::text) > 65536 then
    raise exception 'Le programme de travail tient en cent travaux et 64 Kio au plus.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(v_travaux) e(v) where btrim(e.v ->> 'travail', E' \t\n\r') = '') then
    raise exception 'Un travail du programme se décrit : son libellé ne peut pas être vide.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(v_travaux) e(v) where length(e.v ->> 'travail') > 500) then
    raise exception 'Un travail du programme tient en 500 caractères au plus.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(v_travaux) e(v)
              where e.v ->> 'note' is not null and btrim(e.v ->> 'note', E' \t\n\r') = '') then
    raise exception 'La note d''un travail ne se compose pas que de blancs : la laisser vide.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(v_travaux) e(v) where length(e.v ->> 'note') > 2000) then
    raise exception 'La note d''un travail tient en 2 000 caractères au plus.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(v_travaux) e(v)
              where e.v ->> 'code' is not null group by e.v ->> 'code' having count(*) > 1) then
    raise exception 'Le programme cite deux fois le même travail proposé.' using errcode = '22023';
  end if;
  -- 10. La conclusion courante est celle qu'aucune autre ne remplace : on remplace celle-là, ou rien s'il n'y en a pas.
  select c.id into v_courante from public.revision_conclusions c
   where c.dossier_id = p_dossier_id and c.annee = p_annee and c.cycle = p_cycle
     and not exists (select 1 from public.revision_conclusions s where s.remplace_id = c.id);
  if p_remplace_id is not null and not exists (
       select 1 from public.revision_conclusions c
        where c.id = p_remplace_id and c.dossier_id = p_dossier_id and c.annee = p_annee and c.cycle = p_cycle) then
    raise exception 'La conclusion à remplacer n''est pas une conclusion de ce cycle pour l''exercice %.', p_annee
      using errcode = '22023';
  end if;
  if p_remplace_id is distinct from v_courante then
    raise exception 'Une autre conclusion a été prise sur ce cycle depuis : relire avant de conclure.' using errcode = '22023';
  end if;

  insert into public.revision_conclusions (dossier_id, annee, cycle, etat, travaux, conclusion, a_suivre, remplace_id, auteur)
  values (p_dossier_id, p_annee, p_cycle, p_etat, v_travaux, p_conclusion, p_a_suivre, p_remplace_id, auth.uid())
  returning * into v_conclusion;
  return v_conclusion;
end
$$;

-- ══ Noter dans le journal d'un cycle ══════════
-- Sous les mêmes verrous, pour qu'une note ne s'écrive jamais à côté d'un dossier de travail qu'on fige (étape R9). Les
-- refus, dans cet ordre :
--   1. l'accès (42501) — HYPOTHÈSE Q2 : tout membre affecté note ;
--   2. un exercice hors de 2000 à 2100 ;
--   3. un exercice pas encore terminé (HYPOTHÈSE Q11) ;
--   4. (étape R9) un dossier de travail figé ;
--   5. un cycle qui n'est pas l'un des onze ;
--   6. une nature qui n'est ni un échange avec la direction, ni une consultation, ni un travail ;
--   7. un texte vide, ou de plus de 4 000 caractères.
create function public.noter_revision(
  p_dossier_id uuid,
  p_annee integer,
  p_cycle text,
  p_nature text,
  p_texte text
)
returns public.revision_notes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note public.revision_notes;
begin
  -- 1.
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
  -- 5.
  if p_cycle is null or p_cycle not in ('tresorerie', 'recettes', 'depenses', 'immobilisations', 'emprunts', 'social',
                                          'tva', 'capitaux', 'tiers', 'stocks', 'ensemble') then
    raise exception 'Le cycle annoncé n''est pas un cycle de la révision.' using errcode = '22023';
  end if;
  -- 6.
  if p_nature is null or p_nature not in ('echange_direction', 'consultation', 'travail') then
    raise exception 'Une note du journal est un échange avec la direction, une consultation ou un travail.'
      using errcode = '22023';
  end if;
  -- 7.
  if p_texte is null or btrim(p_texte, E' \t\n\r') = '' then
    raise exception 'Une note se rédige : elle ne peut pas être vide.' using errcode = '22023';
  end if;
  if length(p_texte) > 4000 then
    raise exception 'Une note tient en 4 000 caractères au plus.' using errcode = '22023';
  end if;

  insert into public.revision_notes (dossier_id, annee, cycle, nature, texte, auteur)
  values (p_dossier_id, p_annee, p_cycle, p_nature, p_texte, auth.uid())
  returning * into v_note;
  return v_note;
end
$$;

-- ══ Revoir un cycle ══════════
-- La revue du chef du cabinet sur la conclusion COURANTE d'un cycle, sous les mêmes verrous : une conclusion qui la
-- remplacerait pendant ce temps attend, puis la trouve revue, ou la remplace avant et fait refuser la revue (refus 8).
-- Les refus, dans cet ordre :
--   1. un appelant qui n'est pas le chef du cabinet du dossier annoncé — ni le super-administrateur —, ou un dossier qui
--      n'existe pas (42501) — HYPOTHÈSE Q2 : seul le chef revoit ;
--   2. un exercice hors de 2000 à 2100 ;
--   3. un exercice pas encore terminé (HYPOTHÈSE Q11) ;
--   4. (étape R9) un dossier de travail figé ;
--   5. un avis qui n'est ni « approuvé » ni « à reprendre » ;
--   6. un cycle renvoyé à reprendre sans observation, une observation faite de blancs ou de plus de 4 000 caractères ;
--   7. une conclusion qui n'est pas une conclusion de l'exercice dans ce dossier ;
--   8. une conclusion qui n'est plus la courante de son cycle ;
--   9. une conclusion déjà revue.
create function public.revoir_cycle(
  p_dossier_id uuid,
  p_annee integer,
  p_conclusion_id uuid,
  p_avis text,
  p_observation text
)
returns public.revision_revues
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cabinet uuid;
  v_cible public.revision_conclusions;
  v_revue public.revision_revues;
begin
  -- 1. Le chef du cabinet du dossier ANNONCÉ, comme pour la validation d'un exercice : un dossier qui n'existe pas se
  -- refuse de même.
  select d.cabinet_id into v_cabinet from public.dossiers d where d.id = p_dossier_id;
  if not found or not public.est_chef_du_cabinet(v_cabinet) then
    raise exception 'Seul le chef du cabinet revoit un cycle.' using errcode = '42501';
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
  -- 5.
  if p_avis is null or p_avis not in ('approuve', 'a_reprendre') then
    raise exception 'Une revue approuve le cycle, ou le renvoie à reprendre.' using errcode = '22023';
  end if;
  -- 6.
  if p_avis = 'a_reprendre' and btrim(coalesce(p_observation, ''), E' \t\n\r') = '' then
    raise exception 'Un cycle renvoyé à reprendre se motive.' using errcode = '22023';
  end if;
  if p_observation is not null and btrim(p_observation, E' \t\n\r') = '' then
    raise exception 'Une observation ne se compose pas que de blancs : la laisser vide.' using errcode = '22023';
  end if;
  if length(p_observation) > 4000 then
    raise exception 'Une observation tient en 4 000 caractères au plus.' using errcode = '22023';
  end if;
  -- 7.
  select * into v_cible from public.revision_conclusions c
   where c.id = p_conclusion_id and c.dossier_id = p_dossier_id and c.annee = p_annee;
  if not found then
    raise exception 'La conclusion à revoir n''est pas une conclusion de l''exercice % dans ce dossier.', p_annee
      using errcode = '22023';
  end if;
  -- 8.
  if exists (select 1 from public.revision_conclusions s where s.remplace_id = v_cible.id) then
    raise exception 'Une autre conclusion a été prise sur ce cycle depuis : relire avant de revoir.' using errcode = '22023';
  end if;
  -- 9.
  if exists (select 1 from public.revision_revues r where r.conclusion_id = v_cible.id) then
    raise exception 'Cette conclusion a déjà été revue : revoir de nouveau suppose une nouvelle conclusion.'
      using errcode = '22023';
  end if;

  insert into public.revision_revues (dossier_id, annee, conclusion_id, avis, observation, revu_par)
  values (p_dossier_id, p_annee, v_cible.id, p_avis, p_observation, auth.uid())
  returning * into v_revue;
  return v_revue;
end
$$;

-- ══ Les droits d'exécution ══════════
-- Les trois fonctions vérifient l'accès elles-mêmes, et un anonyme n'a rien à y faire. Les gardes ne servent qu'aux
-- déclencheurs : personne ne les appelle.
revoke execute on function public.conclure_cycle(uuid, integer, text, text, jsonb, text, text, uuid) from public, anon;
grant execute on function public.conclure_cycle(uuid, integer, text, text, jsonb, text, text, uuid) to authenticated;
revoke execute on function public.noter_revision(uuid, integer, text, text, text) from public, anon;
grant execute on function public.noter_revision(uuid, integer, text, text, text) to authenticated;
revoke execute on function public.revoir_cycle(uuid, integer, uuid, text, text) from public, anon;
grant execute on function public.revoir_cycle(uuid, integer, uuid, text, text) to authenticated;
revoke execute on function public.garder_revision_conclusion() from public, anon, authenticated;
revoke execute on function public.garder_revision_note() from public, anon, authenticated;
revoke execute on function public.garder_revision_revue() from public, anon, authenticated;

comment on table public.revision_conclusions is
  'La révision des comptes (ligne 41, étape R4) : la conclusion d''un cycle pour un exercice — le programme de travail exécuté, « révisé » ou « anomalie », les points à suivre —, datée, signée, immuable ; elle se remplace par une autre (remplace_id). Écrite par conclure_cycle seule ; le client n''en voit rien.';
comment on table public.revision_notes is
  'Le journal d''un cycle de la révision (ligne 41, étape R4) : un échange avec la direction, une consultation, un travail fait. Il ne fait que s''allonger. Écrit par noter_revision seule ; le client n''en voit rien.';
comment on table public.revision_revues is
  'La revue d''une conclusion de la révision par le chef du cabinet (ligne 41, étape R4, hypothèse Q2) : approuvé, ou à reprendre avec son observation. Une par conclusion. Écrite par revoir_cycle seule ; le client n''en voit rien.';
comment on function public.conclure_cycle(uuid, integer, text, text, jsonb, text, text, uuid) is
  'Enregistre la conclusion d''un cycle de la révision et son programme de travail, sous verrou, après les dix refus dits dans la migration revision_des_cycles.';
comment on function public.noter_revision(uuid, integer, text, text, text) is
  'Ajoute une note au journal d''un cycle de la révision, sous verrou, après les sept refus dits dans la migration revision_des_cycles.';
comment on function public.revoir_cycle(uuid, integer, uuid, text, text) is
  'Enregistre la revue, par le chef du cabinet, de la conclusion courante d''un cycle de la révision, sous verrou, après les neuf refus dits dans la migration revision_des_cycles.';
