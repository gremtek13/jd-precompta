-- LA RÉVISION DES COMPTES, ÉTAPE R1 : LA BASE DES SOLDES RÉVISÉS (ligne 41 de la feuille de route ; conception du
-- 09/10/2026, HISTORIQUE.md, « LA RÉVISION DES COMPTES : LA CONCEPTION »).
--
-- Réviser, c'est « réviser et apprécier les comptabilités » (ordonnance n° 45-2138 du 19/09/1945, art. 2). La mission de
-- présentation des comptes demande des contrôles « sur les comptes de bilan et de résultat les plus significatifs », « par
-- exemple justification des soldes, rapprochement avec des pièces justificatives, dénouement des opérations bancaires à la
-- clôture » (NP 2300, A6, arrêté du 01/09/2016), et un dossier de travail dont on sait « quand et par qui la documentation
-- a été créée, modifiée ou revue », qui évite « les modifications non autorisées » (norme de management de la qualité,
-- A28-2, arrêté du 30/05/2024). Les données d'inventaire justifient « le contenu de chacun des postes du bilan » (PCG,
-- art. 1021-3).
--
-- CE QUE CETTE MIGRATION POSE : une DÉCISION par solde de compte de bilan à la fin d'un exercice — justifié par des
-- pièces, accepté sur motif, ou en anomalie —, datée, signée, IMMUABLE, qui porte le solde qu'elle justifie au centime et
-- cite ses pièces et ses documents par leur empreinte SHA-256. Rien ne se modifie : une décision se REMPLACE par une autre
-- (chaîne `remplace_id`), et l'historique reste. L'ÉTAT d'un solde (à justifier, justifié, à revoir…) n'est pas stocké :
-- il se déduit des décisions et du solde du jour (étape R2). L'application calcule et propose ; seul le clic du cabinet
-- décide, et la base vérifie au clic que le solde décidé est celui des écritures.
--
-- LES QUESTIONS AU CABINET N'ONT PAS ENCORE DE RÉPONSE (09/10/2026). Ce qui suit prend les recommandations de la
-- conception comme HYPOTHÈSES, chacune rangée pour qu'une autre réponse se reprenne par `create or replace function`, sans
-- rien retirer :
--   - Q3, un solde ACCEPTÉ sans pièce sur un motif obligatoire : la règle vit dans `justifier_solde` (refus 8) ; la
--     contrainte de la table admet l'état, qu'une fonction remplacée cesserait simplement d'écrire ;
--   - Q8, une pièce ou un document CITÉ ne se supprime plus et ne change plus de dossier, sauf avec le dossier entier, même
--     quand la décision qui le cite a été remplacée : la règle vit dans `garder_source_citee`, un déclencheur et non une
--     clé étrangère — une clé qu'il faudrait relâcher devrait être retirée, une fonction se remplace ; la citation garde
--     l'empreinte de sa source, qui reste la preuve ;
--   - Q2, la préparation ouverte à tout membre du cabinet affecté au dossier (`admin_du_dossier`, refus 1) ;
--   - Q11, seuls les exercices terminés se révisent (refus 3) ;
--   - Q7, la suppression d'un dossier emporte sa révision (clés du dossier en cascade) : la conservation au-delà passera
--     par l'export du dossier de travail (étape R9), non par des lignes qui survivraient à leur dossier.
-- Q1, la révision comme préalable de la validation, est l'étape R6 : `valider_exercice` ne change pas.
--
-- Données mesurées le 09/10/2026 (comptes seulement) : aucune écriture dans le dossier `test`, aucun exercice validé.
-- Aucun solde n'est à justifier aujourd'hui : tout ce qui suit est latent.

-- ══ Les décisions ══════════
-- Une décision sur le solde d'un compte de bilan (classes 1 à 5, le motif de `soldes_reportes`) à la fin d'un exercice.
-- Le solde, débit positif, est celui des écritures à l'instant du clic (refus 9). Le motif est obligatoire pour un solde
-- accepté sans pièce et pour une anomalie. La portée dit si la justification vaut au-delà de l'exercice — un bail, un
-- tableau d'emprunt : elle se propose alors à l'exercice suivant, qui la reprend (`reprise_de`). `preuve_application` est
-- l'instantané de ce que l'écran a montré au clic (étape R2). L'auteur est un repère d'audit sans clé étrangère, comme
-- `exercices_valides.valide_par` : retirer le compte d'un membre parti ne doit pas effacer qui a décidé.
create table public.revision_justifications (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  annee integer not null
    constraint revision_justifications_annee check (annee between 2000 and 2100),
  compte text not null
    constraint revision_justifications_compte check (compte ~ '^[1-5][0-9]{2,}$'),
  -- La borne écarte aussi NaN, qu'un `numeric` admettrait malgré sa précision.
  solde numeric(16,2) not null
    constraint revision_justifications_solde check (abs(solde) < 100000000000000),
  etat text not null
    constraint revision_justifications_etat check (etat in ('justifie', 'accepte', 'anomalie')),
  -- Des blancs seuls (espaces, tabulations, retours à la ligne) ne sont pas un motif.
  motif text
    constraint revision_justifications_motif check (btrim(motif, E' \t\n\r') <> '' and length(motif) <= 4000),
  portee text not null
    constraint revision_justifications_portee check (portee in ('exercice', 'permanente')),
  preuve_application jsonb
    constraint revision_justifications_preuve_application
      check (jsonb_typeof(preuve_application) = 'object' and preuve_application <> '{}'::jsonb
             and octet_length(preuve_application::text) <= 65536),
  remplace_id uuid references public.revision_justifications (id),
  reprise_de uuid references public.revision_justifications (id),
  auteur uuid not null,
  cree_le timestamptz not null default now(),
  constraint revision_justifications_motif_requis check (etat = 'justifie' or motif is not null),
  constraint revision_justifications_une_suite unique (remplace_id)
);

-- Une seule PREMIÈRE décision par compte et par exercice. Avec l'unicité de `remplace_id`, chaque compte porte une CHAÎNE
-- linéaire de décisions, et la décision courante est celle qu'aucune autre ne remplace : l'ordre est la chaîne, aucun
-- horodatage ne départage, et il survit à une restauration. Partiel, et c'est un invariant : aucun upsert ne le vise,
-- une décision s'insère.
create unique index revision_justifications_une_premiere on public.revision_justifications (dossier_id, annee, compte)
  where remplace_id is null;
create index revision_justifications_dossier on public.revision_justifications (dossier_id, annee, compte);
create index revision_justifications_reprise_de on public.revision_justifications (reprise_de);

-- ══ Ce qu'une décision cite ══════════
-- Une pièce ou un document du dossier — ou, à l'étape R8, un fichier du cabinet : la colonne existe dès maintenant, sans
-- clé, et la garde la refuse jusque-là ; R8 n'aura qu'à AJOUTER sa clé et remplacer la garde. L'empreinte est le SHA-256
-- de la source, RECOPIÉ par `justifier_solde` au moment de la citation : c'est la preuve, pas le nom du fichier (la règle
-- de la piste d'audit) ; nulle quand la source n'en porte pas, et l'écran le dira. La précision dit où regarder (« relevé
-- de décembre, page 2 »).
--
-- PAS DE CLÉ ÉTRANGÈRE VERS LES PIÈCES ET LES DOCUMENTS (hypothèse Q8) : la garde vérifie à l'insertion que la source
-- est du dossier et la VERROUILLE jusqu'à la fin de la transaction, comme une clé le ferait ; `garder_source_citee` refuse
-- ensuite de la supprimer ou de la déplacer. Une clé sans action refuserait la même chose, mais une autre réponse du
-- cabinet obligerait à la retirer.
create table public.revision_preuves (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  justification_id uuid not null references public.revision_justifications (id) on delete cascade,
  piece_id uuid,
  document_id uuid,
  fichier_id uuid,
  empreinte text
    constraint revision_preuves_empreinte check (empreinte ~ '^[0-9a-f]{64}$'),
  precision text
    constraint revision_preuves_precision check (btrim(precision, E' \t\n\r') <> '' and length(precision) <= 500),
  constraint revision_preuves_une_source check (num_nonnulls(piece_id, document_id, fichier_id) = 1),
  constraint revision_preuves_piece_une_fois unique (justification_id, piece_id),
  constraint revision_preuves_document_une_fois unique (justification_id, document_id),
  constraint revision_preuves_fichier_une_fois unique (justification_id, fichier_id)
);
create index revision_preuves_dossier on public.revision_preuves (dossier_id);
-- `garder_source_citee` cherche, à chaque suppression d'une pièce ou d'un document, s'il est cité.
create index revision_preuves_piece on public.revision_preuves (piece_id);
create index revision_preuves_document on public.revision_preuves (document_id);

-- ══ Le verrou ══════════
-- Le verrou consultatif de la révision d'un dossier. `justifier_solde` le prend en EXCLUSIF — deux décisions concurrentes
-- sur un même compte se suivent, et la seconde voit la première (refus 10) —, APRÈS le verrou PARTAGÉ de la validation
-- (`cle_validation`) : une validation n'avance pas pendant une décision. Toujours dans cet ordre, la validation puis la
-- révision, pour que deux fonctions qui prendraient un jour les deux ne s'attendent jamais l'une l'autre.
create function public.cle_revision(p_dossier_id uuid) returns bigint
language sql immutable set search_path = public as $$
  select hashtextextended('jd.revision_des_comptes:' || p_dossier_id::text, 0)
$$;

-- ══ Le solde d'un compte à la fin d'un exercice ══════════
-- Débit moins crédit, en euros, des écritures du brouillon datées de l'exercice — proposées comme validées — et de son
-- ouverture : la balance reprise datée de l'exercice et les soldes reportés au 1er janvier, exactement
-- `ouvertureDeLExercice` (src/lib/reportDesSoldes.ts). Chaque ligne compte pour ses centimes tels que l'application les
-- compte, Math.round(montant × 100) sur le nombre que le navigateur lit — le binaire le plus proche du décimal, comme
-- JSON.parse — : une écriture n'est pas contrainte au centime en base, et une somme de `numeric` arrondie à la fin ne
-- dirait pas toujours ce que dit l'écran. L'arrondi de Math.round s'écrit avec floor(), comme dans
-- `centimes_ligne_facture`. Le jumeau est `soldeDuCompteCentimes` (src/lib/revisionSoldes.ts), confronté à une table
-- relevée sur cette fonction. Interne : aucun rôle ne l'appelle.
create function public.solde_du_compte(p_dossier_id uuid, p_annee integer, p_compte text) returns numeric
language sql stable set search_path = public as $$
  select round(coalesce(sum(case when l.sens = 'debit' then l.centimes else -l.centimes end), 0) / 100.0, 2)
  from (
    select m.sens,
           (floor(m.montant::double precision * 100::double precision)
            + case when m.montant::double precision * 100::double precision
                        - floor(m.montant::double precision * 100::double precision) >= 0.5::double precision
                   then 1 else 0 end)::bigint as centimes
    from (
      select e.sens, e.montant from public.ecritures_brouillon e
       where e.dossier_id = p_dossier_id and e.compte = p_compte
         and e.date between make_date(p_annee, 1, 1) and make_date(p_annee, 12, 31)
      union all
      select a.sens, a.montant from public.a_nouveaux a
       where a.dossier_id = p_dossier_id and a.compte = p_compte
         and a.date between make_date(p_annee, 1, 1) and make_date(p_annee, 12, 31)
      union all
      select s.sens, s.montant from public.soldes_reportes s
       where s.dossier_id = p_dossier_id and s.compte = p_compte and s.date = make_date(p_annee, 1, 1)
    ) m
  ) l
$$;

-- ══ La garde des décisions ══════════
-- Une décision ne se modifie pas et ne se supprime pas, sauf avec son dossier entier, que sa ligne ne voit déjà plus
-- pendant la cascade (le critère des gardes de la validation). Une décision en remplace une du même compte et du même
-- exercice ; une reprise vise une décision du même compte à l'exercice précédent. Ce que `justifier_solde` vérifie de
-- plus — le solde du jour, la décision COURANTE, une portée permanente — ne se rejoue pas ici : une restauration réinsère
-- l'historique tel qu'il a été décidé. Aux droits de l'appelant, et avant la RLS : qui ne voit pas une décision est
-- refusé sans apprendre si elle existe.
create function public.garder_revision_justification() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Une décision de la révision ne se supprime pas : elle se remplace par une autre, et l''historique reste.'
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Une décision de la révision ne se modifie pas : elle se remplace par une autre, et l''historique reste.'
      using errcode = '23514';
  end if;
  if new.remplace_id is not null and not exists (
       select 1 from public.revision_justifications j
        where j.id = new.remplace_id and j.dossier_id = new.dossier_id and j.annee = new.annee and j.compte = new.compte) then
    raise exception 'Une décision en remplace une du même compte, pour le même exercice.' using errcode = '23514';
  end if;
  if new.reprise_de is not null and not exists (
       select 1 from public.revision_justifications j
        where j.id = new.reprise_de and j.dossier_id = new.dossier_id and j.compte = new.compte and j.annee = new.annee - 1) then
    raise exception 'Une reprise vise une décision du même compte, pour l''exercice précédent.' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger revision_justifications_gardes
  before insert or update or delete on public.revision_justifications
  for each row execute function public.garder_revision_justification();

-- ══ La garde des preuves ══════════
-- Une preuve appartient à une décision de son dossier, cite une pièce ou un document de ce dossier — un fichier du cabinet
-- attend l'étape R8 —, ne se modifie pas et ne part qu'avec son dossier. La source citée est VERROUILLÉE en partage
-- jusqu'à la fin de la transaction, comme le ferait une clé étrangère, et plus fort qu'elle : une suppression ou un
-- changement de dossier concurrent attend, puis voit la citation (`garder_source_citee`) ; parti avant, il fait refuser
-- la citation.
create function public.garder_revision_preuve() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Une preuve de la révision ne se supprime pas : elle reste avec sa décision.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Une preuve de la révision ne se modifie pas.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.revision_justifications j
                  where j.id = new.justification_id and j.dossier_id = new.dossier_id) then
    raise exception 'Une preuve appartient à une décision de son dossier.' using errcode = '23514';
  end if;
  if new.fichier_id is not null then
    raise exception 'Un fichier du cabinet ne se cite pas encore : une preuve cite une pièce ou un document du dossier.'
      using errcode = '23514';
  end if;
  if new.piece_id is not null then
    perform 1 from public.pieces p where p.id = new.piece_id and p.dossier_id = new.dossier_id for share;
    if not found then
      raise exception 'Une preuve cite une pièce de son dossier.' using errcode = '23514';
    end if;
  end if;
  if new.document_id is not null then
    perform 1 from public.documents_divers d where d.id = new.document_id and d.dossier_id = new.dossier_id for share;
    if not found then
      raise exception 'Une preuve cite un document de son dossier.' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

create trigger revision_preuves_gardes
  before insert or update or delete on public.revision_preuves
  for each row execute function public.garder_revision_preuve();

-- ══ Une source citée reste où elle est (HYPOTHÈSE Q8) ══════════
-- Une pièce ou un document cité par une décision — même remplacée depuis : l'historique garde ses preuves — ne se
-- supprime plus et ne change plus de dossier, sauf avec son dossier entier, dont la cascade emporte ensemble les sources
-- et la révision. Une autre réponse du cabinet se reprend en remplaçant cette fonction. DEFINER pour voir la révision
-- quelle que soit la RLS de qui supprime ; elle ne rend que la ligne, ou le refus.
create function public.garder_source_citee() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_annee integer;
  v_compte text;
begin
  if not exists (select 1 from public.dossiers d where d.id = old.dossier_id)
     or tg_op = 'UPDATE' and new.dossier_id is not distinct from old.dossier_id then
    return public.retour_declencheur(tg_op, old, new);
  end if;
  if tg_table_name = 'pieces' then
    select j.annee, j.compte into v_annee, v_compte
      from public.revision_preuves p join public.revision_justifications j on j.id = p.justification_id
     where p.piece_id = old.id
     order by j.annee, j.compte
     limit 1;
  else
    select j.annee, j.compte into v_annee, v_compte
      from public.revision_preuves p join public.revision_justifications j on j.id = p.justification_id
     where p.document_id = old.id
     order by j.annee, j.compte
     limit 1;
  end if;
  if not found then
    return public.retour_declencheur(tg_op, old, new);
  end if;
  raise exception '% par la révision du solde du compte % (exercice %) : %, sauf avec son dossier.',
    case when tg_table_name = 'pieces' then 'Cette pièce est citée' else 'Ce document est cité' end,
    v_compte, v_annee,
    case when tg_op = 'DELETE' then case when tg_table_name = 'pieces' then 'elle ne se supprime plus' else 'il ne se supprime plus' end
         else case when tg_table_name = 'pieces' then 'elle ne change plus de dossier' else 'il ne change plus de dossier' end
    end
    using errcode = '23514';
end
$$;

create trigger pieces_citees_en_revision
  before delete or update of dossier_id on public.pieces
  for each row execute function public.garder_source_citee();
create trigger documents_divers_cites_en_revision
  before delete or update of dossier_id on public.documents_divers
  for each row execute function public.garder_source_citee();

-- ══ Qui lit, qui écrit ══════════
-- Le cabinet LIT la révision de ses dossiers et l'écrit par `justifier_solde`, seule à le faire depuis le navigateur : les
-- tables n'ont aucune policy d'écriture ordinaire. Le super-administrateur en insère pour restaurer une sauvegarde. Le
-- client n'y voit rien : aucune policy ne le nomme.
alter table public.revision_justifications enable row level security;
create policy revision_justifications_lecture on public.revision_justifications
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy revision_justifications_restauration on public.revision_justifications
  for insert to authenticated with check (is_super_admin());

alter table public.revision_preuves enable row level security;
create policy revision_preuves_lecture on public.revision_preuves
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy revision_preuves_restauration on public.revision_preuves
  for insert to authenticated with check (is_super_admin());

-- ══ Justifier un solde ══════════
-- D'UN SEUL TENANT : la décision et ses preuves, sous le verrou partagé de la validation puis le verrou exclusif de la
-- révision du dossier (`cle_revision`), chaque source citée verrouillée jusqu'à la fin. Les refus, dans cet ordre — le
-- module de l'étape R2 les dira avant le clic, dans le même ordre et sous les mêmes mots :
--   1. un appelant qui n'est pas `admin_du_dossier` du dossier annoncé, ou un dossier qui n'existe pas (42501) ;
--   2. un exercice hors de 2000 à 2100 ;
--   3. un exercice pas encore terminé, l'année lue à Paris (HYPOTHÈSE Q11) ;
--   4. (étape R9) un dossier de travail finalisé — la place est gardée dans l'ordre ;
--   5. un compte qui n'est pas de bilan, classes 1 à 5 ;
--   6. un exercice antérieur à la reprise du dossier : il est dans les comptes repris ;
--   7. un exercice dont l'ouverture n'est pas encore définitive — quelque chose le précède (une reprise, un exercice
--      validé, une écriture) et l'exercice précédent n'est pas validé : la règle de `etatDeLOuverture` (« en-attente ») ;
--   8. un état, une portée ou un motif invalides — une anomalie et un solde accepté sans pièce se motivent (HYPOTHÈSE Q3) ;
--   9. un solde qui n'est pas un montant au centime, ou qui n'est plus celui des écritures (`solde_du_compte`) ;
--  10. une décision remplacée qui n'est pas une décision du compte pour l'exercice, ou n'est pas sa décision courante — ou
--      aucun remplacement quand le compte en a une ;
--  11. une reprise qui ne vise pas une décision du compte à l'exercice précédent, ou vise une décision qui n'est pas
--      permanente, ou qui a été remplacée depuis ;
--  12. des preuves illisibles, une précision vide ou trop longue, une source citée deux fois, une source qui n'est pas du
--      dossier, une preuve de l'application illisible ;
--  13. un solde « justifié » sans pièce, sans document et sans preuve de l'application.
-- Tous en 22023, sauf l'accès. Elle recopie l'empreinte de chaque source et rend la décision écrite, son identifiant et
-- son instant compris.
create function public.justifier_solde(
  p_dossier_id uuid,
  p_annee integer,
  p_compte text,
  p_solde numeric,
  p_etat text,
  p_motif text,
  p_portee text,
  p_preuves jsonb,
  p_preuve_application jsonb,
  p_remplace_id uuid,
  p_reprise_de uuid
)
returns public.revision_justifications
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Le JSON `null` ne se distingue pas d'une absence : aucune preuve, aucun instantané.
  v_preuves jsonb := coalesce(nullif(p_preuves, 'null'::jsonb), '[]'::jsonb);
  v_preuve_application jsonb := nullif(p_preuve_application, 'null'::jsonb);
  v_reprise date;
  v_solde numeric;
  v_courante uuid;
  v_cible public.revision_justifications;
  v_source record;
  v_decision public.revision_justifications;
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
  -- 3. L'année se lit à Paris, comme pour la validation : la nuit du 1er janvier ne doit pas les faire diverger.
  if p_annee >= extract(year from (now() at time zone 'Europe/Paris'))::integer then
    raise exception 'L''exercice % n''est pas terminé : ses soldes se justifient une fois clos.', p_annee
      using errcode = '22023';
  end if;
  -- 5.
  if p_compte is null or p_compte !~ '^[1-5][0-9]{2,}$' then
    raise exception 'Seul un compte de bilan, classes 1 à 5, se justifie par son solde.' using errcode = '22023';
  end if;
  -- 6. et 7. L'ouverture de l'exercice, comme `etatDeLOuverture` la dit : la reprise d'un dossier n'a qu'une date
  -- (`a_nouveaux_une_seule_ouverture`), un exercice validé ouvre le suivant, et ce qui précède un exercice — la reprise,
  -- un exercice validé, une écriture — fait attendre son ouverture tant que l'exercice d'avant n'est pas validé.
  select min(a.date) into v_reprise from public.a_nouveaux a where a.dossier_id = p_dossier_id;
  if v_reprise is not null and make_date(p_annee, 12, 31) < v_reprise then
    raise exception 'L''exercice % précède la reprise du dossier : il est dans les comptes repris.', p_annee
      using errcode = '22023';
  end if;
  if (v_reprise is null or extract(year from v_reprise)::integer <> p_annee)
     and not exists (select 1 from public.exercices_valides v where v.dossier_id = p_dossier_id and v.annee = p_annee - 1)
     and (v_reprise is not null
          or exists (select 1 from public.exercices_valides v where v.dossier_id = p_dossier_id and v.annee < p_annee)
          or exists (select 1 from public.ecritures_brouillon e
                      where e.dossier_id = p_dossier_id and e.date < make_date(p_annee, 1, 1))) then
    raise exception 'L''exercice % n''est pas validé : les soldes de % ne sont pas encore définitifs.', p_annee - 1, p_annee
      using errcode = '22023';
  end if;
  -- 8.
  if p_etat is null or p_etat not in ('justifie', 'accepte', 'anomalie') then
    raise exception 'Une décision dit un solde justifié, accepté sur motif ou en anomalie.' using errcode = '22023';
  end if;
  if p_portee is null or p_portee not in ('exercice', 'permanente') then
    raise exception 'Une décision vaut pour l''exercice, ou de façon permanente.' using errcode = '22023';
  end if;
  if p_etat = 'anomalie' and btrim(coalesce(p_motif, ''), E' \t\n\r') = '' then
    raise exception 'Une anomalie se motive.' using errcode = '22023';
  end if;
  -- HYPOTHÈSE Q3 : un solde s'accepte sans pièce, sur un motif obligatoire.
  if p_etat = 'accepte' and btrim(coalesce(p_motif, ''), E' \t\n\r') = '' then
    raise exception 'Un solde accepté sans pièce se motive.' using errcode = '22023';
  end if;
  if p_motif is not null and btrim(p_motif, E' \t\n\r') = '' then
    raise exception 'Un motif ne se compose pas que de blancs : le laisser vide.' using errcode = '22023';
  end if;
  if length(p_motif) > 4000 then
    raise exception 'Un motif tient en 4 000 caractères au plus.' using errcode = '22023';
  end if;
  -- 9. Le solde annoncé est celui que l'écran a montré : il doit être celui des écritures, au centime, à cet instant.
  if p_solde is null or not (abs(p_solde) < 100000000000000) or p_solde <> round(p_solde, 2) then
    raise exception 'Le solde annoncé n''est pas un montant au centime.' using errcode = '22023';
  end if;
  v_solde := public.solde_du_compte(p_dossier_id, p_annee, p_compte);
  if p_solde <> v_solde then
    raise exception 'Le solde du compte % a changé : au 31/12/%, il %.', p_compte, p_annee,
      case when v_solde = 0 then 'est nul'
           else 'est de ' || replace(to_char(abs(v_solde), 'FM99999999999990.00'), '.', ',') || ' € au '
                || case when v_solde > 0 then 'débit' else 'crédit' end
      end
      using errcode = '22023';
  end if;
  -- 10. La décision courante est celle qu'aucune autre ne remplace : on remplace celle-là, ou rien s'il n'y en a pas.
  select j.id into v_courante from public.revision_justifications j
   where j.dossier_id = p_dossier_id and j.annee = p_annee and j.compte = p_compte
     and not exists (select 1 from public.revision_justifications s where s.remplace_id = j.id);
  if p_remplace_id is not null and not exists (
       select 1 from public.revision_justifications j
        where j.id = p_remplace_id and j.dossier_id = p_dossier_id and j.annee = p_annee and j.compte = p_compte) then
    raise exception 'La décision à remplacer n''est pas une décision du compte % pour l''exercice %.', p_compte, p_annee
      using errcode = '22023';
  end if;
  if p_remplace_id is distinct from v_courante then
    raise exception 'Une autre décision a été prise sur ce compte depuis : relire avant de décider.' using errcode = '22023';
  end if;
  -- 11. Une reprise prend la justification permanente COURANTE du même compte à l'exercice précédent.
  if p_reprise_de is not null then
    select * into v_cible from public.revision_justifications j
     where j.id = p_reprise_de and j.dossier_id = p_dossier_id and j.compte = p_compte and j.annee = p_annee - 1;
    if not found then
      raise exception 'Une reprise vise une décision du compte % pour l''exercice %.', p_compte, p_annee - 1
        using errcode = '22023';
    end if;
    if v_cible.portee <> 'permanente' then
      raise exception 'Seule une justification permanente se reprend d''un exercice à l''autre.' using errcode = '22023';
    end if;
    if exists (select 1 from public.revision_justifications s where s.remplace_id = v_cible.id) then
      raise exception 'La décision de % reprise a été remplacée depuis : relire avant de la reprendre.', p_annee - 1
        using errcode = '22023';
    end if;
  end if;
  -- 12. Les preuves : une liste de pièces et de documents, chacun désigné par son identifiant et, s'il le faut, une
  -- précision ; rien d'autre (un fichier du cabinet attend l'étape R8). Le type d'un identifiant ne se contrôle pas à
  -- part : un nombre, un booléen, un objet ou une liste JSON ne s'écrit jamais comme un uuid, et le motif le refuse ;
  -- une précision est un texte libre, et son type se contrôle.
  if jsonb_typeof(v_preuves) <> 'array'
     or exists (select 1 from jsonb_array_elements(v_preuves) e(v)
                 where jsonb_typeof(e.v) <> 'object'
                    or exists (select 1 from jsonb_object_keys(e.v) k(cle) where k.cle not in ('piece_id', 'document_id', 'precision'))
                    or coalesce(jsonb_typeof(e.v -> 'precision'), 'null') not in ('string', 'null')
                    or num_nonnulls(e.v ->> 'piece_id', e.v ->> 'document_id') <> 1
                    or coalesce(e.v ->> 'piece_id', e.v ->> 'document_id')
                       !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'Les preuves citées sont illisibles : une liste de pièces et de documents, chacun avec sa précision.'
      using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(v_preuves) e(v)
              where e.v ->> 'precision' is not null and btrim(e.v ->> 'precision', E' \t\n\r') = '') then
    raise exception 'Une précision ne se compose pas que de blancs : la laisser vide.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(v_preuves) e(v) where length(e.v ->> 'precision') > 500) then
    raise exception 'Une précision tient en 500 caractères au plus.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(v_preuves) e(v)
              group by (e.v ->> 'piece_id')::uuid, (e.v ->> 'document_id')::uuid having count(*) > 1) then
    raise exception 'Une même pièce, ou un même document, est citée deux fois.' using errcode = '22023';
  end if;
  for v_source in
    select (e.v ->> 'piece_id')::uuid as piece_id, (e.v ->> 'document_id')::uuid as document_id
      from jsonb_array_elements(v_preuves) with ordinality e(v, rang)
     order by e.rang
  loop
    if v_source.piece_id is not null then
      perform 1 from public.pieces p where p.id = v_source.piece_id and p.dossier_id = p_dossier_id for share;
    else
      perform 1 from public.documents_divers d where d.id = v_source.document_id and d.dossier_id = p_dossier_id for share;
    end if;
    if not found then
      raise exception 'Une pièce ou un document cité n''est pas de ce dossier.' using errcode = '22023';
    end if;
  end loop;
  if v_preuve_application is not null
     and (jsonb_typeof(v_preuve_application) <> 'object' or v_preuve_application = '{}'::jsonb
          or octet_length(v_preuve_application::text) > 65536) then
    raise exception 'La preuve de l''application est illisible : un objet, non vide, de 64 Kio au plus.' using errcode = '22023';
  end if;
  -- 13.
  if p_etat = 'justifie' and jsonb_array_length(v_preuves) = 0 and v_preuve_application is null then
    raise exception 'Un solde justifié cite au moins une pièce, un document ou la preuve de l''application.'
      using errcode = '22023';
  end if;

  insert into public.revision_justifications (
    dossier_id, annee, compte, solde, etat, motif, portee, preuve_application, remplace_id, reprise_de, auteur
  ) values (
    p_dossier_id, p_annee, p_compte, v_solde, p_etat, p_motif, p_portee, v_preuve_application, p_remplace_id,
    p_reprise_de, auth.uid()
  )
  returning * into v_decision;
  -- L'empreinte de chaque source, recopiée telle que la base la porte : un SHA-256 en hexadécimal, ou rien.
  insert into public.revision_preuves (dossier_id, justification_id, piece_id, document_id, empreinte, precision)
  select p_dossier_id, v_decision.id, s.piece_id, s.document_id,
         case when coalesce(p.storage_hash, d.storage_hash) ~ '^[0-9a-f]{64}$' then coalesce(p.storage_hash, d.storage_hash) end,
         s.precision
    from (select (e.v ->> 'piece_id')::uuid as piece_id, (e.v ->> 'document_id')::uuid as document_id,
                 e.v ->> 'precision' as precision, e.rang
            from jsonb_array_elements(v_preuves) with ordinality e(v, rang)) s
    left join public.pieces p on p.id = s.piece_id
    left join public.documents_divers d on d.id = s.document_id
   order by s.rang;
  return v_decision;
end
$$;

-- ══ Les droits d'exécution ══════════
-- `justifier_solde` vérifie l'accès elle-même, et un anonyme n'a rien à y faire. Les autres ne servent qu'à elle et aux
-- déclencheurs : personne ne les appelle.
revoke execute on function public.justifier_solde(uuid, integer, text, numeric, text, text, text, jsonb, jsonb, uuid, uuid)
  from public, anon;
grant execute on function public.justifier_solde(uuid, integer, text, numeric, text, text, text, jsonb, jsonb, uuid, uuid)
  to authenticated;
revoke execute on function public.cle_revision(uuid) from public, anon, authenticated;
revoke execute on function public.solde_du_compte(uuid, integer, text) from public, anon, authenticated;
revoke execute on function public.garder_revision_justification() from public, anon, authenticated;
revoke execute on function public.garder_revision_preuve() from public, anon, authenticated;
revoke execute on function public.garder_source_citee() from public, anon, authenticated;

comment on table public.revision_justifications is
  'La révision des comptes (ligne 41, étape R1) : une décision par solde de compte de bilan à la fin d''un exercice — justifié, accepté sur motif, ou en anomalie —, datée, signée, immuable ; elle se remplace par une autre (remplace_id). Écrite par justifier_solde seule ; le client n''en voit rien.';
comment on table public.revision_preuves is
  'Ce qu''une décision de la révision cite : une pièce ou un document du dossier, avec l''empreinte SHA-256 de la source au moment de la citation et une précision. Une source citée ne se supprime plus (hypothèse Q8, garder_source_citee).';
comment on function public.justifier_solde(uuid, integer, text, numeric, text, text, text, jsonb, jsonb, uuid, uuid) is
  'Enregistre une décision de la révision sur le solde d''un compte de bilan et ses preuves, d''un seul tenant et sous verrou, après les treize refus dits dans la migration revision_des_soldes.';
comment on function public.solde_du_compte(uuid, integer, text) is
  'Le solde d''un compte à la fin d''un exercice, débit positif, en euros : écritures de l''exercice et son ouverture, chaque ligne comptée en centimes comme l''application. Lue par justifier_solde seule.';
comment on function public.cle_revision(uuid) is
  'La clé du verrou consultatif de la révision d''un dossier.';
comment on function public.garder_source_citee() is
  'Une pièce ou un document cité par la révision ne se supprime plus et ne change plus de dossier, sauf avec son dossier (hypothèse Q8).';
