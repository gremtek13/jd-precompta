-- LES ACHATS DU CLIENT, EN BASE (espace client, ligne 51.5, partie B, étape B4 ; MEG2-Q4 et MEG2-Q5, « oui » : l'échéance
-- d'une facture d'achat lue sur la facture électronique, saisie sinon, jamais devinée ; « je l'ai payée », déclaré par le
-- client, une proposition, jamais une écriture ni un rapprochement) — PRÉPARÉE, PAS APPLIQUÉE. La conception : HISTORIQUE.md,
-- « L'ESPACE CLIENT, LOGICIEL DE GESTION DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », B.1 (« Les achats ») et B.7
-- (l'étape B4) ; le récit : « 11/11/2026 — B4 : LES ACHATS DU CLIENT, EN BASE (LIGNE 51.5) (PRÉPARÉE, PAS APPLIQUÉE) » ;
-- l'essai : supabase/essais/achatsClient.sql ; le bloc AC de supabase/essais/rls.sql.
--
-- SOURCES. Le délai de paiement entre professionnels : soixante jours après l'émission, ou quarante-cinq jours fin de mois
-- (code de commerce, art. L441-10, I) — l'échéance est une donnée de la facture, qui la porte quand elle est électronique
-- (EN 16931, BT-9, « Payment due date ») ; l'application ne la calcule pas : elle la lit, ou quelqu'un la saisit. Ce que la
-- base garde se tient au règlement (UE) 2016/679 : par défaut rien n'est ouvert (art. 25, § 2 — la case « Achats » est
-- fausse tant que le cabinet ne la coche pas) ; on ne garde que ce qui sert (art. 5, § 1, c — ni texte libre ni nom dans
-- les tables neuves). Aucune norme AFNOR.
--
-- CE QU'ELLE POSE.
--   1. Trois colonnes de `pieces` : `date_echeance` (facultative), et qui l'a fixée et quand (`echeance_fixee_par`,
--      `echeance_fixee_le`). À l'insertion, une échéance ne vient que d'une facture électronique reçue (`source` plateforme ou
--      superpdp : BT-9) ; ensuite, elle ne change que par `fixer_echeance_piece`, qui signe. Une échéance lue sur la facture
--      se reconnaît : non nulle, venue de la plateforme ou de Super PDP, sans auteur.
--   2. `paiements_declares` : « je l'ai payée le …, par … » — la pièce, la date, le moyen, le montant, qui et quand, le
--      retrait. Une PROPOSITION, comme un justificatif proposé (P7) : elle n'écrit rien dans le relevé, les écritures, la
--      caisse ni les rapprochements ; le cabinet la lit dans la fiche de la pièce et au rapprochement (étape B5). Elle ne se
--      réécrit pas : elle se retire, une fois, par son auteur ou par le cabinet, et la ligne reste.
--   3. `pieces_vues` : (la pièce, le compte, vue le) — la première fois qu'un accès « Achats » a vu une facture d'achat, écrite
--      par `marquer_vues` pour ses propres lignes seulement : « nouvelles depuis ta dernière visite » se dit par compte et le
--      suit d'un appareil à l'autre.
--   4. Les gardes, avant la RLS : l'échéance et son auteur ne changent que par leur fonction (un réglage `jd.echeance_piece`
--      porte la pièce, le temps de la transaction) ; une ligne des deux tables ne s'écrit que par sa fonction (`jd.<table>`)
--      ou par la restauration (le super-administrateur) ; rien ne se réécrit, sauf le retrait d'une déclaration, une fois ;
--      rien ne part qu'avec sa pièce ou son dossier.
--   5. Quatre fonctions `security definer`, chacune contrôlant l'accès AVANT toute autre lecture : `fixer_echeance_piece`
--      (le cabinet du dossier, ou l'accès « Achats ») ; `declarer_paiement_piece` (l'accès « Achats » seul : le cabinet
--      rapproche le relevé ou paie par la caisse) ; `retirer_paiement_declare` (son auteur, encore « Achats », ou le cabinet) ;
--      `marquer_vues` (l'accès « Achats » seul).
--   6. Les policies, toutes à `authenticated` : le cabinet du dossier lit tout ; l'accès « Achats » lit les déclarations de
--      son dossier, et ses propres pièces vues ; le super-administrateur insère (la restauration). Aucune policy de mise à
--      jour ni de suppression, pour personne. CES LECTURES DU CLIENT SE PRÉSENTENT AU CABINET AVANT D'ÊTRE APPLIQUÉES
--      (CLAUDE.md, « une policy qui lui ouvre une lecture se présente au cabinet »).
--
-- LES REFUS, DANS L'ORDRE (que src/lib/achatsClient.ts redit sous les mêmes mots) :
--   - `fixer_echeance_piece` : la pièce inconnue, ou d'un dossier dont l'appelant n'est ni le cabinet ni un accès « Achats »
--     (42501, les mêmes mots) ; une pièce qui n'est pas une facture d'achat (22023) ; une échéance hors des bornes (22023) ;
--     une échéance qui a changé depuis la lecture de l'appelant (22023) ; pour un accès client, une échéance lue sur la
--     facture électronique (22023) ; une pièce qui porte une écriture validée (23514) ;
--   - `declarer_paiement_piece` : la pièce inconnue, ou d'un dossier dont l'appelant n'est pas un accès « Achats » (42501,
--     les mêmes mots) ; une pièce qui n'est pas une facture d'achat (22023) ; la date absente, à venir au jour de Paris, ou
--     d'avant 2000 (22023) ; le moyen hors de la liste (22023) ; le montant nul, négatif, au-delà de la colonne ou plus fin que
--     le centime (22023) ;
--   - `retirer_paiement_declare` : la déclaration inconnue, ou que l'appelant ne peut retirer (42501, les mêmes mots) ; une
--     déclaration déjà retirée (22023) ;
--   - `marquer_vues` : l'appelant qui n'est pas un accès « Achats » du dossier (42501) ; plus de cinq cents pièces (22023) ;
--     une pièce de la liste qui n'est pas une facture d'achat de ce dossier (22023) ;
--   - les gardes : une écriture hors des fonctions et de la restauration (42501) ; une échéance à l'insertion d'une pièce qui
--     ne vient pas d'une facture électronique, une réécriture, un retrait hors de celui de la pièce ou du dossier, une ligne
--     qui cite une pièce d'un autre dossier (23514).
--
-- CE QU'ELLE NE CHANGE PAS : les policies de `pieces`, de `piece_textes_ocr` et du seau `pieces` (le RESSERREMENT des pièces
-- au droit « Achats » est l'étape B6 : aucune lecture d'aujourd'hui n'est retirée) ; la réception des factures par la
-- plateforme du client, qui reste au cabinet (les Edge Functions `plateforme-agreee` et `superpdp-sync` ne sont pas touchées :
-- B4-Q1 à B4-Q3) ; `memberships`, ses cases et leur trace (B1) ; `client_du_dossier`, qu'elle APPELLE ; les gardes de
-- `pieces` d'hier, dont celle d'une pièce figée par la validation, qui refuse toujours de changer une échéance figée. Aucune
-- ligne écrite d'avance.
--
-- CE QU'ELLE SUPPOSE, que sa garde de tête vérifie : B1 (`trois_cases_de_l_acces` : la case « Achats » et le mot « achats »
-- de `client_du_dossier`) ; aucun objet de cette migration. La double authentification exigée (`deux_facteurs_exiges`,
-- préparée) pose sa policy restrictive sur chaque table de public : appliquée avant celle-ci, chaque table neuve la reçoit
-- ici, à l'identique ; appliquée après, sa boucle les prend.
--
-- CE QUE LE TEXTE RETIRE : rien — ni objet, ni donnée. Hors des commentaires, le mot n'y paraît que dans les clés
-- (`on delete cascade`) et les gardes (`tg_op`, `before … delete`). Ni barre oblique inverse, ni retour chariot. Elle
-- s'applique PAR L'OUTIL. Son retour (`supabase/preparees/retour/20261111237100`) retire les tables, les colonnes et leurs
-- valeurs : destructif, à accorder et à coller.
--
-- VERSION PROVISOIRE, HORS DE L'EXPORT : le fichier entre dans `supabase/schema/` le jour de son application, sous la
-- version que porte sa ligne d'historique, texte inchangé ; `ACHATS_DU_CLIENT_PREVUS` (src/lib/achatsClient.ts) se lève
-- alors, et ses deux tables entrent au plan de sauvegarde. Les écrans (« Mes achats », la proposition de paiement dans la
-- fiche d'une pièce du cabinet) sont l'étape B5.

-- ══ 0. La garde de tête ══════════
do $garde$
begin
  if to_regclass('public.paiements_declares') is not null or to_regclass('public.pieces_vues') is not null
     or exists (select 1 from pg_attribute a where a.attrelid = 'public.pieces'::regclass and a.attname = 'date_echeance'
                 and not a.attisdropped) then
    raise exception 'La migration achats_du_client est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if not exists (select 1 from pg_attribute a where a.attrelid = 'public.memberships'::regclass and a.attname = 'droit_achats'
                  and not a.attisdropped)
     or strpos(coalesce((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.client_du_dossier(uuid,text)')), ''),
               'when ''achats'' then m.droit_achats') = 0 then
    raise exception 'La case « Achats » (migration trois_cases_de_l_acces, B1) manque : l''appliquer d''abord ; celle-ci lit la case par client_du_dossier.';
  end if;
  if to_regprocedure('public.admin_du_dossier(uuid)') is null or to_regprocedure('public.is_super_admin()') is null
     or to_regclass('public.pieces') is null or to_regclass('public.ecritures_brouillon') is null
     or to_regclass('public.immobilisations') is null then
    raise exception 'Une fonction ou une table que la migration suppose manque (admin_du_dossier, is_super_admin, pieces, ecritures_brouillon, immobilisations) : relire la base.';
  end if;
end
$garde$;

-- ══ 1. L'échéance d'une facture d'achat ══════════
alter table public.pieces
  add column date_echeance date
    constraint pieces_date_echeance check (date_echeance between date '2000-01-01' and date '2100-12-31'),
  add column echeance_fixee_par uuid,
  add column echeance_fixee_le timestamptz,
  add constraint pieces_echeance_fixee check ((echeance_fixee_par is null) = (echeance_fixee_le is null));

comment on column public.pieces.date_echeance is
  'L''échéance d''une facture d''achat (étape B4 ; MEG2-Q4) : lue sur la facture électronique reçue (BT-9) à l''import, sinon fixée par fixer_echeance_piece (le cabinet ou l''accès « Achats ») ; jamais devinée.';
comment on column public.pieces.echeance_fixee_par is
  'Le compte qui a fixé l''échéance par fixer_echeance_piece (auth.uid()), sans clé étrangère ; nul pour une échéance lue sur la facture électronique.';
comment on column public.pieces.echeance_fixee_le is
  'L''instant où l''échéance a été fixée par fixer_echeance_piece ; nul pour une échéance lue sur la facture électronique.';

-- ══ 2. Les paiements déclarés ══════════
-- Sans clé vers le compte de l'auteur : retirer le compte d'un membre parti ne doit pas effacer qui a déclaré (le patron de
-- `situations_publiees.auteur`). La pièce et le dossier en cascade : une déclaration ne survit pas à ce qu'elle cite.
create table public.paiements_declares (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  piece_id uuid not null references public.pieces (id) on delete cascade,
  date_paiement date not null
    constraint paiements_declares_date check (date_paiement between date '2000-01-01' and date '2100-12-31'),
  moyen text not null
    constraint paiements_declares_moyen check (moyen in ('virement', 'prelevement', 'carte', 'cheque', 'especes', 'autre')),
  montant numeric(14, 2) not null
    constraint paiements_declares_montant check (montant > 0),
  declare_par uuid not null,
  declare_le timestamptz not null default now(),
  retire_par uuid,
  retire_le timestamptz,
  constraint paiements_declares_retrait check ((retire_par is null) = (retire_le is null))
);

create index paiements_declares_piece on public.paiements_declares (piece_id, declare_le);
create index paiements_declares_dossier on public.paiements_declares (dossier_id);

comment on table public.paiements_declares is
  'Les paiements qu''un accès « Achats » déclare sur une facture d''achat (étape B4 ; MEG2-Q5) : la date, le moyen, le montant, qui et quand, le retrait. Une PROPOSITION : rien ne s''écrit dans le relevé, les écritures, la caisse ni les rapprochements. Lus par le cabinet du dossier et par l''accès « Achats » ; écrits par declarer_paiement_piece et retirer_paiement_declare seules ; une déclaration ne se réécrit pas, elle se retire, et la ligne reste.';
comment on column public.paiements_declares.moyen is
  'virement, prelevement, carte, cheque, especes ou autre — une liste fermée, aucun texte libre.';
comment on column public.paiements_declares.montant is
  'Le montant que le client dit avoir payé, en euros, au centime : jamais arrondi en silence.';
comment on column public.paiements_declares.declare_par is
  'Le compte qui a déclaré (auth.uid()), sans clé étrangère : il survit au retrait du compte.';
comment on column public.paiements_declares.retire_par is
  'Le compte qui a retiré la déclaration (son auteur, ou le cabinet du dossier), sans clé étrangère.';

-- ══ 3. Les pièces vues ══════════
-- La première fois qu'un compte a vu une facture d'achat, et elle seule : `marquer_vues` ne réécrit pas une vue.
create table public.pieces_vues (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  piece_id uuid not null references public.pieces (id) on delete cascade,
  utilisateur uuid not null,
  vue_le timestamptz not null default now(),
  constraint pieces_vues_une_par_compte unique (piece_id, utilisateur)
);

create index pieces_vues_dossier on public.pieces_vues (dossier_id, utilisateur);

comment on table public.pieces_vues is
  'La première fois qu''un accès « Achats » a vu une facture d''achat (étape B4) : « nouvelles depuis ta dernière visite », par compte, d''un appareil à l''autre. Écrite par marquer_vues seule, pour les lignes de l''appelant ; lue par le cabinet du dossier, et par chaque compte « Achats » pour les siennes.';
comment on column public.pieces_vues.utilisateur is
  'Le compte qui a vu la pièce (auth.uid()), sans clé étrangère.';

-- ══ 4. Les gardes ══════════
-- Avant la RLS, aux droits de l'appelant. Le retrait d'une ligne n'est admis qu'avec sa pièce ou son dossier (la cascade : ils
-- ne sont déjà plus là).
create function public.garder_echeance_piece() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if public.is_super_admin() then
      return new;
    end if;
    if new.echeance_fixee_par is not null or new.echeance_fixee_le is not null then
      raise exception 'L''échéance d''une pièce et son auteur ne s''écrivent que par fixer_echeance_piece.' using errcode = '42501';
    end if;
    if new.date_echeance is not null and new.source not in ('plateforme', 'superpdp') then
      raise exception 'Une échéance se lit sur la facture électronique reçue, ou se fixe après le dépôt : jamais devinée.'
        using errcode = '23514';
    end if;
    return new;
  end if;
  if new.date_echeance is not distinct from old.date_echeance
     and new.echeance_fixee_par is not distinct from old.echeance_fixee_par
     and new.echeance_fixee_le is not distinct from old.echeance_fixee_le then
    return new;
  end if;
  if coalesce(current_setting('jd.echeance_piece', true), '') <> old.id::text then
    raise exception 'L''échéance d''une pièce et son auteur ne s''écrivent que par fixer_echeance_piece.' using errcode = '42501';
  end if;
  return new;
end
$$;

create function public.garder_paiement_declare() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id)
       or not exists (select 1 from public.pieces p where p.id = old.piece_id) then
      return old;
    end if;
    raise exception 'Un paiement déclaré ne part qu''avec sa pièce ou son dossier : il se retire, et la déclaration reste.'
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if coalesce(current_setting('jd.paiements_declares', true), '') <> old.id::text or old.retire_le is not null
       or new.retire_le is null or new.retire_par is null
       or (to_jsonb(new) - 'retire_par' - 'retire_le') <> (to_jsonb(old) - 'retire_par' - 'retire_le') then
      raise exception 'Un paiement déclaré ne se réécrit pas : il se retire, une fois.' using errcode = '23514';
    end if;
    return new;
  end if;
  if coalesce(current_setting('jd.paiements_declares', true), '') <> new.id::text and not public.is_super_admin() then
    raise exception 'Un paiement déclaré ne s''écrit que par sa déclaration.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.pieces p where p.id = new.piece_id and p.dossier_id = new.dossier_id
                  and p.type_piece = 'achat') then
    raise exception 'Un paiement déclaré cite une facture d''achat de son dossier.' using errcode = '23514';
  end if;
  return new;
end
$$;

create function public.garder_piece_vue() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id)
       or not exists (select 1 from public.pieces p where p.id = old.piece_id) then
      return old;
    end if;
    raise exception 'Une pièce vue ne part qu''avec sa pièce ou son dossier.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Une pièce vue ne se réécrit pas.' using errcode = '23514';
  end if;
  if coalesce(current_setting('jd.pieces_vues', true), '') <> new.utilisateur::text and not public.is_super_admin() then
    raise exception 'Une pièce vue ne s''écrit que par marquer_vues.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.pieces p where p.id = new.piece_id and p.dossier_id = new.dossier_id) then
    raise exception 'Une pièce vue cite une pièce de son dossier.' using errcode = '23514';
  end if;
  return new;
end
$$;

comment on function public.garder_echeance_piece() is
  'La garde de l''échéance d''une pièce (étape B4) : à l''insertion, ni auteur (42501) ni échéance hors d''une facture électronique reçue (23514), sauf la restauration du super-administrateur ; ensuite, l''échéance et son auteur ne changent que par fixer_echeance_piece (jd.echeance_piece, 42501).';
comment on function public.garder_paiement_declare() is
  'La garde de paiements_declares (étape B4) : une ligne ne s''écrit que par declarer_paiement_piece (jd.paiements_declares) ou par la restauration du super-administrateur (42501), cite une facture d''achat de son dossier ; elle ne se modifie que par son retrait, une fois, et ne part qu''avec sa pièce ou son dossier (23514).';
comment on function public.garder_piece_vue() is
  'La garde de pieces_vues (étape B4) : une ligne ne s''écrit que par marquer_vues, pour l''appelant (jd.pieces_vues), ou par la restauration (42501), cite une pièce de son dossier, ne se réécrit pas et ne part qu''avec sa pièce ou son dossier (23514).';

create trigger pieces_echeance_gardee
  before insert or update of date_echeance, echeance_fixee_par, echeance_fixee_le on public.pieces
  for each row execute function public.garder_echeance_piece();
create trigger paiements_declares_garde
  before insert or update or delete on public.paiements_declares
  for each row execute function public.garder_paiement_declare();
create trigger pieces_vues_garde
  before insert or update or delete on public.pieces_vues
  for each row execute function public.garder_piece_vue();

-- ══ 5. Qui lit ══════════
alter table public.paiements_declares enable row level security;
alter table public.pieces_vues enable row level security;

create policy paiements_declares_lecture on public.paiements_declares
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy paiements_declares_lecture_achats on public.paiements_declares
  for select to authenticated using (client_du_dossier(dossier_id, 'achats'));
create policy paiements_declares_restauration on public.paiements_declares
  for insert to authenticated with check (is_super_admin());

create policy pieces_vues_lecture on public.pieces_vues
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy pieces_vues_lecture_du_compte on public.pieces_vues
  for select to authenticated using (utilisateur = (select auth.uid()) and client_du_dossier(dossier_id, 'achats'));
create policy pieces_vues_restauration on public.pieces_vues
  for insert to authenticated with check (is_super_admin());

-- La double authentification exigée (migration `deux_facteurs_exiges`, préparée) pose sa policy restrictive sur chaque
-- table de public : appliquée avant celle-ci, chaque table neuve la reçoit ici, à l'identique.
do $deux_facteurs$
declare
  v_table text;
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    foreach v_table in array array['paiements_declares', 'pieces_vues'] loop
      execute format('create policy deux_facteurs on public.%I as restrictive for all to authenticated '
                     'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))', v_table);
    end loop;
  end if;
end
$deux_facteurs$;

-- ══ 6. Fixer l'échéance ══════════
-- La pièce relue sous verrou ; l'échéance que l'appelant a lue doit être celle de la base (une saisie retient la version
-- qu'elle remplace) ; une pièce figée par la validation se dit ici, avant que sa garde ne refuse sous d'autres mots.
create function public.fixer_echeance_piece(p_piece_id uuid, p_echeance date, p_echeance_lue date) returns date
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_piece public.pieces;
  v_cabinet boolean;
  v_annee integer;
begin
  select p.* into v_piece from public.pieces p where p.id = p_piece_id;
  if v_piece.id is null then
    raise exception 'Accès refusé à cette pièce.' using errcode = '42501';
  end if;
  v_cabinet := public.admin_du_dossier(v_piece.dossier_id);
  if not v_cabinet and not public.client_du_dossier(v_piece.dossier_id, 'achats') then
    raise exception 'Accès refusé à cette pièce.' using errcode = '42501';
  end if;
  select p.* into v_piece from public.pieces p where p.id = p_piece_id for update;
  if v_piece.type_piece <> 'achat' then
    raise exception 'Une échéance ne se fixe que sur une facture d''achat.' using errcode = '22023';
  end if;
  if p_echeance is not null and (p_echeance < date '2000-01-01' or p_echeance > date '2100-12-31') then
    raise exception 'Une échéance se date entre le 1er janvier 2000 et le 31 décembre 2100.' using errcode = '22023';
  end if;
  if v_piece.date_echeance is distinct from p_echeance_lue then
    raise exception 'L''échéance de cette pièce a changé depuis sa lecture : la relire avant de la fixer.' using errcode = '22023';
  end if;
  if not v_cabinet and v_piece.date_echeance is not null and v_piece.echeance_fixee_par is null
     and v_piece.source in ('plateforme', 'superpdp') then
    raise exception 'Cette échéance est lue sur la facture électronique : seul le cabinet la corrige.' using errcode = '22023';
  end if;
  select min(extract(year from e.date))::integer into v_annee
    from public.ecritures_brouillon e
   where e.statut = 'validee'
     and (e.piece_id = v_piece.id
       or e.immobilisation_id in (select i.id from public.immobilisations i where i.piece_id = v_piece.id));
  if v_annee is not null then
    raise exception 'Cette pièce porte une écriture validée de l''exercice % : son échéance ne change plus.', v_annee
      using errcode = '23514';
  end if;
  perform set_config('jd.echeance_piece', v_piece.id::text, true);
  update public.pieces
     set date_echeance = p_echeance, echeance_fixee_par = auth.uid(), echeance_fixee_le = now()
   where id = v_piece.id;
  perform set_config('jd.echeance_piece', '', true);
  return p_echeance;
end;
$$;

comment on function public.fixer_echeance_piece(uuid, date, date) is
  'Fixe (ou efface, à nul) l''échéance d''une facture d''achat et la signe de l''appelant (étape B4 ; MEG2-Q4) : le cabinet du dossier ou l''accès « Achats » ; l''échéance lue par l''appelant doit être celle de la base ; une échéance lue sur la facture électronique ne se corrige que par le cabinet ; une pièce figée par la validation ne change plus. Rend l''échéance fixée.';

-- ══ 7. Déclarer un paiement, et le retirer ══════════
create function public.declarer_paiement_piece(p_piece_id uuid, p_date date, p_moyen text, p_montant numeric)
  returns public.paiements_declares
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_piece public.pieces;
  v_id uuid := gen_random_uuid();
  v_ligne public.paiements_declares;
begin
  select p.* into v_piece from public.pieces p where p.id = p_piece_id;
  if v_piece.id is null or not public.client_du_dossier(v_piece.dossier_id, 'achats') then
    raise exception 'Accès refusé à cette pièce.' using errcode = '42501';
  end if;
  if v_piece.type_piece <> 'achat' then
    raise exception 'Un paiement ne se déclare que sur une facture d''achat.' using errcode = '22023';
  end if;
  if p_date is null or p_date < date '2000-01-01' or p_date > (now() at time zone 'Europe/Paris')::date then
    raise exception 'La date du paiement est requise, entre le 1er janvier 2000 et aujourd''hui.' using errcode = '22023';
  end if;
  if p_moyen is null or p_moyen not in ('virement', 'prelevement', 'carte', 'cheque', 'especes', 'autre') then
    raise exception 'Le moyen de paiement est virement, prélèvement, carte, chèque, espèces ou autre.' using errcode = '22023';
  end if;
  if p_montant is null or p_montant <= 0 or p_montant > 999999999999.99 or p_montant <> round(p_montant, 2) then
    raise exception 'Le montant payé est un nombre positif, au centime près.' using errcode = '22023';
  end if;
  perform set_config('jd.paiements_declares', v_id::text, true);
  insert into public.paiements_declares (id, dossier_id, piece_id, date_paiement, moyen, montant, declare_par)
  values (v_id, v_piece.dossier_id, v_piece.id, p_date, p_moyen, p_montant, auth.uid())
  returning * into v_ligne;
  perform set_config('jd.paiements_declares', '', true);
  return v_ligne;
end;
$$;

comment on function public.declarer_paiement_piece(uuid, date, text, numeric) is
  'Déclare « je l''ai payée le …, par … » sur une facture d''achat (étape B4 ; MEG2-Q5) : l''accès « Achats » du dossier seul ; une PROPOSITION, qui n''écrit rien dans le relevé, les écritures, la caisse ni les rapprochements. Rend la déclaration.';

create function public.retirer_paiement_declare(p_paiement_id uuid) returns public.paiements_declares
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_paiement public.paiements_declares;
begin
  select d.* into v_paiement from public.paiements_declares d where d.id = p_paiement_id;
  if v_paiement.id is null
     or not (public.admin_du_dossier(v_paiement.dossier_id)
             or (public.client_du_dossier(v_paiement.dossier_id, 'achats') and v_paiement.declare_par = auth.uid())) then
    raise exception 'Accès refusé à cette déclaration.' using errcode = '42501';
  end if;
  select d.* into v_paiement from public.paiements_declares d where d.id = p_paiement_id for update;
  if v_paiement.retire_le is not null then
    raise exception 'Cette déclaration est déjà retirée.' using errcode = '22023';
  end if;
  perform set_config('jd.paiements_declares', v_paiement.id::text, true);
  update public.paiements_declares set retire_par = auth.uid(), retire_le = now() where id = v_paiement.id
  returning * into v_paiement;
  perform set_config('jd.paiements_declares', '', true);
  return v_paiement;
end;
$$;

comment on function public.retirer_paiement_declare(uuid) is
  'Retire une déclaration de paiement (étape B4) : son auteur, encore accès « Achats » du dossier, ou le cabinet du dossier ; une fois ; la ligne reste, avec qui l''a retirée et quand. Rend la déclaration retirée.';

-- ══ 8. Les pièces vues ══════════
create function public.marquer_vues(p_dossier_id uuid, p_pieces uuid[]) returns integer
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_n integer;
begin
  if p_dossier_id is null or not public.client_du_dossier(p_dossier_id, 'achats') then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_pieces), 0) > 500 then
    raise exception 'Au plus cinq cents pièces se marquent vues en un appel.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_pieces, '{}'::uuid[])) as u(id)
              where u.id is null
                 or not exists (select 1 from public.pieces p
                                 where p.id = u.id and p.dossier_id = p_dossier_id and p.type_piece = 'achat')) then
    raise exception 'Une pièce de la liste n''est pas une facture d''achat de ce dossier.' using errcode = '22023';
  end if;
  perform set_config('jd.pieces_vues', auth.uid()::text, true);
  insert into public.pieces_vues (dossier_id, piece_id, utilisateur)
  select distinct p_dossier_id, u.id, auth.uid() from unnest(coalesce(p_pieces, '{}'::uuid[])) as u(id)
  on conflict (piece_id, utilisateur) do nothing;
  get diagnostics v_n = row_count;
  perform set_config('jd.pieces_vues', '', true);
  return v_n;
end;
$$;

comment on function public.marquer_vues(uuid, uuid[]) is
  'Marque vues, pour l''appelant, des factures d''achat de son dossier (étape B4) : l''accès « Achats » seul ; cinq cents au plus ; la première vue seule, une par compte et par pièce. Rend le nombre de pièces nouvellement vues.';

-- ══ 9. Les droits d'exécution ══════════
revoke execute on function public.fixer_echeance_piece(uuid, date, date) from public, anon;
grant execute on function public.fixer_echeance_piece(uuid, date, date) to authenticated;
revoke execute on function public.declarer_paiement_piece(uuid, date, text, numeric) from public, anon;
grant execute on function public.declarer_paiement_piece(uuid, date, text, numeric) to authenticated;
revoke execute on function public.retirer_paiement_declare(uuid) from public, anon;
grant execute on function public.retirer_paiement_declare(uuid) to authenticated;
revoke execute on function public.marquer_vues(uuid, uuid[]) from public, anon;
grant execute on function public.marquer_vues(uuid, uuid[]) to authenticated;
revoke execute on function public.garder_echeance_piece() from public, anon, authenticated;
revoke execute on function public.garder_paiement_declare() from public, anon, authenticated;
revoke execute on function public.garder_piece_vue() from public, anon, authenticated;
