-- LE RÉGIME D'E-REPORTING CONFIRMÉ D'UN DOSSIER, SON HISTOIRE, ET LA PIÈCE ÉCARTÉE APRÈS VÉRIFICATION (ligne 28.5,
-- étape e : e-reporting, cinquième temps, première moitié e5a ; conception du 09/10/2026, HISTORIQUE.md, « L'E-REPORTING :
-- LA CONCEPTION », § 1.4, § 3.2, § 4.2, § 5.3 et Q4 ; « LE CONTENU DES DÉCLARATIONS D'E-REPORTING », points 1 à 3).
--
-- CE QUE LE CONTENU D'UNE DÉCLARATION DEMANDE, ET QUE LA BASE NE GARDAIT PAS (étape e4, src/lib/ereporting.ts) :
--   1. le régime d'e-reporting CONFIRMÉ par le cabinet (Q4). « Les entreprises doivent veiller à communiquer à leur
--      plateforme agréée leur régime de TVA et tout changement de régime » (impots.gouv.fr, actualité du 22/09/2026,
--      modifiée le 23/09/2026), et la fréquence des déclarations suit ce régime « quelle que soit l'opération effectuée »
--      (BOI-TVA-DECLA-20-30-50-30, § 40 à § 70 ; BOI-TVA-DECLA-20-30-60, § 170 et § 180) : c'est une donnée que le
--      dossier a déclarée à sa plateforme, que le cabinet confirme, pas une déduction ;
--   2. son HISTOIRE, et avec elle celle du statut de TVA : une période passée se déclare sous le régime qu'elle avait, et
--      la base ne gardait que le statut d'aujourd'hui (`dossiers.statut_tva`), que l'onglet TVA réécrit ;
--   3. le geste qui ÉCARTE une pièce candidate que le cabinet a vérifiée : une pièce d'achat qui ressemble à un achat à un
--      fournisseur établi hors de France (une autre devise, un numéro de TVA de l'Union, une mention d'autoliquidation,
--      un fournisseur déjà décrit) et n'en est pas un, ou qu'il a tranché de ne pas déclarer. Sans lui, une candidate ne se
--      résout que par une fiche « hors de France » (étape e2), et une pièce qui porte une TVA n'en reçoit pas (hypothèse
--      Q7) : elle bloquerait sa période.
-- La déclaration elle-même — la table des déclarations, leur contenu figé, la rectificative, le sort d'un retrait
-- d'encaissement dans une période déclarée, la fiche déclarée qui retient sa pièce — est la seconde moitié (e5b).
--
-- Le client du dossier n'en voit rien : aucune policy ne le nomme. Données mesurées le 11/10/2026 : aucune déclaration
-- d'e-reporting n'est due avant les factures du 01/09/2027 ; tout ce qui suit est LATENT.

-- ══ Le régime d'e-reporting d'un dossier, daté ══════════
-- Chaque ligne dit : « à partir de ce jour, le dossier déclare sous ce régime », tel que le cabinet le confirme — le statut
-- de TVA (redevable, franchise en base, exonéré : les trois de `dossiers.statut_tva`), l'article d'une exonération, la
-- périodicité et l'option pour les débits d'un redevable, et la fréquence de ses déclarations d'e-reporting qui en
-- découle. Le régime en vigueur un jour donné est la ligne active dont le `depuis` est le plus grand avant ce jour ou ce
-- jour-là ; avant la première, rien n'est confirmé. Une ligne ne se modifie pas : une erreur se RETIRE (`retire_le`, qui et
-- quand) et une autre se confirme ; rien ne se supprime, sauf avec le dossier. Aucune ligne pour l'avenir : un changement
-- de régime se confirme quand il a eu lieu.
--
-- LES FRÉQUENCES QUE LES TEXTES ÉCRIVENT sont des contraintes de la table : un redevable au réel normal mensuel déclare
-- ses ventes et ses achats par décade, au réel normal trimestriel chaque mois (BOI-TVA-DECLA-20-30-50-30, § 50 et § 60),
-- et ses paiements chaque mois — aucun sur option pour les débits (BOI-TVA-DECLA-20-30-60, § 30 et § 170) ; un franchisé,
-- les uns et les autres tous les bimestres civils (-50-30, § 70 ; -60, § 180). Celle d'un dossier exonéré n'est écrite
-- nulle part (point 3 de la conception) : la table l'admet libre, et c'est la fonction qui la confirme « chaque mois »
-- (hypothèse Q4) — une autre réponse du cabinet ne changera qu'elle. La périodicité et l'option pour les débits ne
-- regardent qu'un redevable (BOI-TVA-DECLA-20-30-60, § 30 : l'option porte sur une TVA facturée) : nulle et fausse
-- ailleurs. L'auteur est un repère d'audit sans clé étrangère, comme `pieces_hors_de_france.cree_par`.
create table public.regimes_ereporting (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  depuis date not null
    constraint regimes_ereporting_depuis check (depuis between date '2000-01-01' and date '2099-12-31'),
  statut_tva text not null
    constraint regimes_ereporting_statut_tva check (statut_tva in ('redevable', 'franchise', 'exonere')),
  article_exoneration text
    constraint regimes_ereporting_article_exoneration
      check (article_exoneration in ('cgi_261_4_1', 'cgi_261_4_4_a', 'cgi_261_4_4_b', 'cgi_261_c_2')),
  tva_periodicite text
    constraint regimes_ereporting_tva_periodicite check (tva_periodicite in ('mensuelle', 'trimestrielle')),
  tva_sur_debits boolean not null,
  frequence_transactions text not null
    constraint regimes_ereporting_frequence_transactions check (frequence_transactions in ('decade', 'mois', 'bimestre')),
  frequence_paiements text
    constraint regimes_ereporting_frequence_paiements check (frequence_paiements in ('mois', 'bimestre')),
  note text constraint regimes_ereporting_note check (btrim(note) <> '' and length(note) <= 2000),
  cree_par uuid,
  cree_le timestamptz not null default now(),
  retire_le timestamptz,
  retire_par uuid,
  constraint regimes_ereporting_article_coherent check (article_exoneration is null or statut_tva in ('exonere', 'redevable')),
  constraint regimes_ereporting_periodicite_coherente check ((tva_periodicite is not null) = (statut_tva = 'redevable')),
  constraint regimes_ereporting_debits_coherents check (not tva_sur_debits or statut_tva = 'redevable'),
  constraint regimes_ereporting_frequences_ecrites check (
    case statut_tva
      when 'redevable' then frequence_transactions = case tva_periodicite when 'mensuelle' then 'decade' else 'mois' end
                        and frequence_paiements is not distinct from case when tva_sur_debits then null else 'mois' end
      when 'franchise' then frequence_transactions = 'bimestre' and frequence_paiements = 'bimestre'
      else frequence_paiements is not null
    end)
);

-- Un seul régime ACTIF par jour de départ : l'histoire d'un dossier se lit sans ambiguïté. Partiel, et c'est voulu : les
-- lignes retirées s'accumulent. Aucun upsert ne le vise : un régime s'insère.
create unique index regimes_ereporting_un_par_jour on public.regimes_ereporting (dossier_id, depuis) where retire_le is null;
create index regimes_ereporting_dossier on public.regimes_ereporting (dossier_id);

-- ══ La pièce écartée de l'e-reporting des achats ══════════
-- Une pièce d'achat ou une note de frais que le cabinet a VÉRIFIÉE et écartée, avec ce que la vérification a établi
-- (`motif`) : elle n'est pas un achat à un fournisseur établi hors de France, ou il a tranché de ne pas la déclarer (un
-- achat facturé avec une TVA, hypothèse Q7 d'e2). Un écart ne se modifie pas : il se RETIRE (qui et quand), et la pièce
-- redevient à vérifier ; un autre écart peut alors la viser. Une seule ligne active par pièce. Il part avec sa pièce ou son
-- dossier. Une pièce qui a une fiche « hors de France » ne s'écarte pas (la fonction le refuse) : une fiche courante la
-- décrit, une fiche retirée dit déjà qu'elle n'était pas un achat à l'étranger. Une fiche posée APRÈS l'écart l'emporte —
-- le contenu d'une déclaration (lib/ereporting.ts) ne consulte un écart que pour une pièce sans aucune fiche.
create table public.pieces_ecartees_ereporting (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  piece_id uuid not null references public.pieces (id) on delete cascade,
  motif text not null constraint pieces_ecartees_ereporting_motif check (btrim(motif) <> '' and length(motif) <= 2000),
  cree_par uuid,
  cree_le timestamptz not null default now(),
  retire_le timestamptz,
  retire_par uuid
);

create unique index pieces_ecartees_ereporting_un_actif on public.pieces_ecartees_ereporting (piece_id) where retire_le is null;
create index pieces_ecartees_ereporting_piece on public.pieces_ecartees_ereporting (piece_id);
create index pieces_ecartees_ereporting_dossier on public.pieces_ecartees_ereporting (dossier_id);

-- ══ Les verrous ══════════
-- Le verrou consultatif de l'e-reporting d'un dossier : la confirmation et le retrait d'un régime le prennent en EXCLUSIF,
-- deux confirmations du même jour se suivent et la seconde voit la première. L'écart d'une pièce prend celui des fiches
-- « hors de France » (`cle_hors_de_france`, étape e2), en exclusif lui aussi : qu'une pièce n'ait pas de fiche reste vrai
-- pendant qu'on l'écarte, et deux écarts de la même pièce se suivent.
create function public.cle_ereporting(p_dossier_id uuid) returns bigint
language sql immutable set search_path = public as $$
  select hashtextextended('jd.ereporting:' || p_dossier_id::text, 0)
$$;

-- ══ Les gardes ══════════
-- Un régime confirmé ne change ensuite que par son retrait, une fois ; rien ne se supprime, sauf avec le dossier, que la
-- ligne ne voit déjà plus pendant la cascade. L'insertion n'a pas d'autre garde que les contraintes : c'est la
-- restauration qui insère en direct (le super-administrateur), et elle réinsère l'histoire telle qu'elle a été écrite.
create function public.garder_regime_ereporting() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Un régime confirmé ne se supprime pas : il se retire, et reste dans l''histoire du dossier.'
      using errcode = '23514';
  end if;
  if (to_jsonb(new) - array['retire_le', 'retire_par']) is distinct from (to_jsonb(old) - array['retire_le', 'retire_par'])
     or old.retire_le is not null or new.retire_le is null then
    raise exception 'Un régime confirmé ne se modifie pas : il se retire, une fois, et un autre se confirme.'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger regimes_ereporting_gardes before update or delete on public.regimes_ereporting
  for each row execute function public.garder_regime_ereporting();

-- Un écart vise une pièce de son dossier ; ensuite rien ne change que son retrait, une fois ; rien ne se supprime, sauf
-- avec la pièce ou le dossier. Aux droits de l'appelant, et avant la RLS : qui ne voit pas la pièce est refusé sans
-- apprendre si elle existe.
create function public.garder_ecart_ereporting() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id)
       or not exists (select 1 from public.pieces p where p.id = old.piece_id) then
      return old;
    end if;
    raise exception 'Un écart ne se supprime pas : il se retire, et la pièce redevient à vérifier ; il part avec sa pièce.'
      using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.pieces p where p.id = new.piece_id and p.dossier_id = new.dossier_id) then
      raise exception 'Un écart vise une pièce de son dossier.' using errcode = '23514';
    end if;
    return new;
  end if;
  if (to_jsonb(new) - array['retire_le', 'retire_par']) is distinct from (to_jsonb(old) - array['retire_le', 'retire_par'])
     or old.retire_le is not null or new.retire_le is null then
    raise exception 'Un écart ne se modifie pas : il se retire, une fois.' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger pieces_ecartees_ereporting_gardes before insert or update or delete on public.pieces_ecartees_ereporting
  for each row execute function public.garder_ecart_ereporting();

-- Une pièce écartée ne change plus de dossier : son écart porte son dossier en propre (la policy le lit sans jointure),
-- et resterait lisible là où la pièce n'est plus — la règle de `garder_piece_hors_de_france` (étape e2). DEFINER pour voir
-- les écarts quelle que soit la RLS de qui modifie la pièce ; elle ne rend que la ligne, ou le refus.
create function public.garder_piece_ecartee() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.dossier_id is not distinct from old.dossier_id then
    return new;
  end if;
  if exists (select 1 from public.pieces_ecartees_ereporting e where e.piece_id = old.id) then
    raise exception 'Cette pièce a été écartée de l''e-reporting : elle ne change plus de dossier.' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger pieces_ecartees_ereporting_dossier before update of dossier_id on public.pieces
  for each row execute function public.garder_piece_ecartee();

-- ══ Qui lit, qui écrit ══════════
-- Le cabinet LIT les régimes et les écarts de ses dossiers et les écrit par les quatre fonctions ci-dessous, seules à le
-- faire depuis le navigateur : les tables n'ont aucune policy d'écriture ordinaire. Le super-administrateur en insère pour
-- restaurer une sauvegarde. Le client n'y voit rien : aucune policy ne le nomme.
alter table public.regimes_ereporting enable row level security;
create policy regimes_ereporting_lecture on public.regimes_ereporting
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy regimes_ereporting_restauration on public.regimes_ereporting
  for insert to authenticated with check (is_super_admin());

alter table public.pieces_ecartees_ereporting enable row level security;
create policy pieces_ecartees_ereporting_lecture on public.pieces_ecartees_ereporting
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy pieces_ecartees_ereporting_restauration on public.pieces_ecartees_ereporting
  for insert to authenticated with check (is_super_admin());

-- ══ Confirmer un régime ══════════
-- Le cabinet confirme le régime sous lequel le dossier déclare à partir d'un jour, tel qu'il l'a communiqué à sa
-- plateforme : le statut, l'article, la périodicité et l'option d'un redevable, et la fréquence que l'application
-- propose — la fonction la refait et refuse une autre (un écran périmé, une saisie forcée). HYPOTHÈSE Q4, rangée ici : la
-- fréquence confirmée est celle que l'application propose, « chaque mois » pour un dossier exonéré, que les textes ne
-- disent pas ; une autre réponse du cabinet ne changera que cette fonction (la table admet toute fréquence à un exonéré).
-- Que le régime confirmé soit le statut que l'onglet TVA porte aujourd'hui n'est pas exigé ici : l'onglet le change seul,
-- et c'est le contenu de la déclaration (lib/ereporting.ts) qui refuse une période dont le régime n'est plus sûr.
--
-- Sous le VERROU de l'e-reporting du dossier. Les refus, dans cet ordre — le module (src/lib/regimesEreporting.ts) les dit
-- avant le clic, dans le même ordre et sous les mêmes mots :
--   1. l'accès au dossier annoncé, ou un dossier qui n'existe pas (42501) ; 2. le jour de départ : renseigné, pas avant
--   l'an 2000, pas dans l'avenir à Paris ; 3. un régime déjà confirmé à partir du même jour (il se retire d'abord) ; 4. le
--   statut (un statut à préciser ne se confirme pas) ; 5. l'article d'exonération : connu, et jamais en franchise ; 6. la
--   périodicité : celle d'un redevable, et de lui seul ; 7. l'option pour les débits : dite, et d'un redevable seul ; 8. la
--   fréquence des ventes et des achats ; 9. celle des paiements, nulle sur option pour les débits ; 10. une note de plus
--   de 2 000 caractères (des espaces seuls ne sont pas une note). Tous en 22023, sauf l'accès.
create function public.confirmer_regime_ereporting(
  p_dossier_id uuid,
  p_depuis date,
  p_statut_tva text,
  p_article_exoneration text,
  p_tva_periodicite text,
  p_tva_sur_debits boolean,
  p_frequence_transactions text,
  p_frequence_paiements text,
  p_note text
)
returns public.regimes_ereporting
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aujourd_hui date := (now() at time zone 'Europe/Paris')::date;
  v_note text := case when btrim(p_note) = '' then null else p_note end;
  v_transactions text;
  v_paiements text;
  v_regime public.regimes_ereporting;
begin
  -- 1. L'accès, sur le dossier ANNONCÉ : un dossier qui n'existe pas se refuse comme un dossier interdit.
  if not public.admin_du_dossier(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(public.cle_ereporting(p_dossier_id));
  -- 2. Le jour de départ, lu à Paris.
  if p_depuis is null then
    raise exception 'Le jour à partir duquel ce régime vaut est à renseigner.' using errcode = '22023';
  end if;
  if p_depuis < date '2000-01-01' then
    raise exception 'Un régime ne se date pas avant l''an 2000.' using errcode = '22023';
  end if;
  if p_depuis > v_aujourd_hui then
    raise exception 'Un régime ne se confirme pas pour l''avenir : nous sommes le %.', to_char(v_aujourd_hui, 'DD/MM/YYYY')
      using errcode = '22023';
  end if;
  -- 3. Un régime actif par jour de départ : une erreur se retire, puis se corrige.
  if exists (select 1 from public.regimes_ereporting r
              where r.dossier_id = p_dossier_id and r.depuis = p_depuis and r.retire_le is null) then
    raise exception 'Un régime est déjà confirmé à partir du % : le retirer d''abord pour en confirmer un autre ce jour-là.',
      to_char(p_depuis, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  -- 4. Le statut, l'un des trois du dossier.
  if p_statut_tva is null or p_statut_tva not in ('redevable', 'franchise', 'exonere') then
    raise exception 'Un régime confirmé est celui d''un dossier redevable, en franchise en base ou exonéré : un statut à préciser ne se confirme pas.'
      using errcode = '22023';
  end if;
  -- 5. L'article d'exonération, dans la liste du dossier (lib/statutTva.ts), permis à un exonéré et à un redevable en
  -- partie exonéré.
  if p_article_exoneration is not null
     and p_article_exoneration not in ('cgi_261_4_1', 'cgi_261_4_4_a', 'cgi_261_4_4_b', 'cgi_261_c_2') then
    raise exception 'Cet article d''exonération n''est pas un de ceux que l''application connaît.' using errcode = '22023';
  end if;
  if p_article_exoneration is not null and p_statut_tva = 'franchise' then
    raise exception 'Un dossier en franchise en base ne porte pas d''article d''exonération.' using errcode = '22023';
  end if;
  -- 6. La périodicité de la déclaration de TVA, celle d'un redevable seul.
  if p_statut_tva = 'redevable' and (p_tva_periodicite is null or p_tva_periodicite not in ('mensuelle', 'trimestrielle')) then
    raise exception 'Un redevable déclare sa TVA chaque mois ou chaque trimestre : la périodicité est à renseigner.'
      using errcode = '22023';
  end if;
  if p_statut_tva <> 'redevable' and p_tva_periodicite is not null then
    raise exception 'Seul un redevable a une périodicité de déclaration de TVA.' using errcode = '22023';
  end if;
  -- 7. L'option pour la TVA sur les débits, celle d'un redevable seul.
  if p_tva_sur_debits is null then
    raise exception 'Dire si le dossier a opté pour la TVA sur les débits.' using errcode = '22023';
  end if;
  if p_tva_sur_debits and p_statut_tva <> 'redevable' then
    raise exception 'Seul un redevable opte pour la TVA sur les débits.' using errcode = '22023';
  end if;
  -- 8 et 9. Les fréquences que ce régime donne (src/lib/periodesEreporting.ts), refaites ici.
  v_transactions := case p_statut_tva
                      when 'redevable' then case p_tva_periodicite when 'mensuelle' then 'decade' else 'mois' end
                      when 'franchise' then 'bimestre'
                      else 'mois' end;
  v_paiements := case when p_statut_tva = 'redevable' and p_tva_sur_debits then null
                      when p_statut_tva = 'franchise' then 'bimestre'
                      else 'mois' end;
  if p_frequence_transactions is distinct from v_transactions then
    raise exception 'Sous ce régime, ses ventes et ses achats se déclarent % : c''est la fréquence que le cabinet confirme.',
      case v_transactions when 'decade' then 'par décade' when 'mois' then 'chaque mois' else 'tous les deux mois' end
      using errcode = '22023';
  end if;
  if v_paiements is null and p_frequence_paiements is not null then
    raise exception 'Sur option pour la TVA sur les débits, ses paiements ne se déclarent pas : aucune fréquence ne se confirme pour eux.'
      using errcode = '22023';
  end if;
  if v_paiements is not null and p_frequence_paiements is distinct from v_paiements then
    raise exception 'Sous ce régime, ses paiements se déclarent % : c''est la fréquence que le cabinet confirme.',
      case v_paiements when 'mois' then 'chaque mois' else 'tous les deux mois' end
      using errcode = '22023';
  end if;
  -- 10.
  if length(v_note) > 2000 then
    raise exception 'La note de la confirmation dépasse 2 000 caractères.' using errcode = '22023';
  end if;

  insert into public.regimes_ereporting (
    dossier_id, depuis, statut_tva, article_exoneration, tva_periodicite, tva_sur_debits, frequence_transactions,
    frequence_paiements, note, cree_par
  ) values (
    p_dossier_id, p_depuis, p_statut_tva, p_article_exoneration, p_tva_periodicite, p_tva_sur_debits,
    p_frequence_transactions, p_frequence_paiements, v_note, auth.uid()
  )
  returning * into v_regime;
  return v_regime;
end
$$;

-- ══ Retirer un régime ══════════
-- Un régime confirmé par erreur — un mauvais jour, un mauvais statut — se retire (qui, quand) et cesse de compter ; il
-- reste dans l'histoire. Refus dans cet ordre : l'accès au dossier, le régime dans ce dossier, déjà retiré. Sous le
-- verrou de l'e-reporting du dossier.
create function public.retirer_regime_ereporting(p_dossier_id uuid, p_regime_id uuid)
returns public.regimes_ereporting
language plpgsql
security definer
set search_path = public
as $$
declare
  v_regime public.regimes_ereporting;
begin
  if not public.admin_du_dossier(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(public.cle_ereporting(p_dossier_id));
  select * into v_regime from public.regimes_ereporting r where r.id = p_regime_id and r.dossier_id = p_dossier_id;
  if not found then
    raise exception 'Régime introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  if v_regime.retire_le is not null then
    raise exception 'Ce régime est déjà retiré.' using errcode = '22023';
  end if;
  update public.regimes_ereporting
     set retire_le = now(), retire_par = auth.uid()
   where id = p_regime_id
  returning * into v_regime;
  return v_regime;
end
$$;

-- ══ Écarter une pièce ══════════
-- Le cabinet écarte de l'e-reporting des achats une pièce qu'il a vérifiée, en disant ce que la vérification a établi.
-- Que la pièce soit une candidate — qu'un signal la désigne — se juge dans l'application (lib/ereporting.ts) : la base ne
-- lit pas le texte des documents. Sous le verrou EXCLUSIF des fiches « hors de France » du dossier, et celui de la ligne de
-- la pièce. Les refus, dans cet ordre — le module les dit avant le clic :
--   1. l'accès au dossier annoncé, ou un dossier qui n'existe pas (42501) ; 2. la pièce, dans ce dossier (P0002) ; 3. une
--   pièce d'achat ou une note de frais, les seules candidates ; 4. une pièce dont la fiche « hors de France » courante n'est
--   pas retirée — c'est sa fiche qui se retire ; 5. une pièce dont la fiche est retirée — elle n'est déjà plus à
--   vérifier ; 6. une pièce déjà écartée ; 7. le motif : renseigné, 2 000 caractères au plus. Tous en 22023, sauf les deux
--   premiers.
create function public.ecarter_piece_ereporting(p_dossier_id uuid, p_piece_id uuid, p_motif text)
returns public.pieces_ecartees_ereporting
language plpgsql
security definer
set search_path = public
as $$
declare
  v_piece public.pieces;
  v_courante public.pieces_hors_de_france;
  v_ecart public.pieces_ecartees_ereporting;
begin
  if not public.admin_du_dossier(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(public.cle_hors_de_france(p_dossier_id));
  -- La pièce, cherchée dans ce dossier seulement : un compte qui n'y a pas droit n'apprend pas qu'elle existe.
  select * into v_piece from public.pieces p where p.id = p_piece_id and p.dossier_id = p_dossier_id for share;
  if not found then
    raise exception 'Pièce introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  if v_piece.type_piece not in ('achat', 'note_frais') then
    raise exception 'Seule une pièce d''achat ou une note de frais s''écarte de l''e-reporting des achats.' using errcode = '22023';
  end if;
  -- La fiche courante de la pièce : celle qu'aucune autre ne remplace (la chaîne de l'étape e2).
  select * into v_courante from public.pieces_hors_de_france f
   where f.piece_id = p_piece_id
     and not exists (select 1 from public.pieces_hors_de_france s where s.remplace_id = f.id);
  if found and v_courante.retire_le is null then
    raise exception 'Cette pièce a une fiche « fournisseur établi hors de France » : elle ne s''écarte pas — si elle n''est pas un achat à l''étranger, c''est sa fiche qui se retire.'
      using errcode = '22023';
  end if;
  if found then
    raise exception 'La fiche « fournisseur établi hors de France » de cette pièce est retirée : la pièce n''est déjà plus à vérifier.'
      using errcode = '22023';
  end if;
  if exists (select 1 from public.pieces_ecartees_ereporting e where e.piece_id = p_piece_id and e.retire_le is null) then
    raise exception 'Cette pièce est déjà écartée de l''e-reporting.' using errcode = '22023';
  end if;
  if p_motif is null or btrim(p_motif) = '' then
    raise exception 'Le motif de l''écart est à renseigner : ce que la vérification a établi.' using errcode = '22023';
  end if;
  if length(p_motif) > 2000 then
    raise exception 'Le motif de l''écart dépasse 2 000 caractères.' using errcode = '22023';
  end if;

  insert into public.pieces_ecartees_ereporting (dossier_id, piece_id, motif, cree_par)
  values (p_dossier_id, p_piece_id, p_motif, auth.uid())
  returning * into v_ecart;
  return v_ecart;
end
$$;

-- ══ Reprendre une pièce écartée ══════════
-- L'écart d'une pièce se retire (qui, quand) : elle redevient à vérifier, et reste dans l'histoire. Refus dans cet
-- ordre : l'accès au dossier, l'écart dans ce dossier, déjà retiré. Sous le verrou des fiches du dossier.
create function public.reprendre_piece_ereporting(p_dossier_id uuid, p_ecart_id uuid)
returns public.pieces_ecartees_ereporting
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ecart public.pieces_ecartees_ereporting;
begin
  if not public.admin_du_dossier(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(public.cle_hors_de_france(p_dossier_id));
  select * into v_ecart from public.pieces_ecartees_ereporting e where e.id = p_ecart_id and e.dossier_id = p_dossier_id;
  if not found then
    raise exception 'Écart introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  if v_ecart.retire_le is not null then
    raise exception 'Cet écart est déjà retiré : la pièce est de nouveau à vérifier.' using errcode = '22023';
  end if;
  update public.pieces_ecartees_ereporting
     set retire_le = now(), retire_par = auth.uid()
   where id = p_ecart_id
  returning * into v_ecart;
  return v_ecart;
end
$$;

-- ══ Les droits d'exécution ══════════
-- Les quatre fonctions qui écrivent vérifient l'accès elles-mêmes, et un anonyme n'a rien à y faire. Les autres ne servent
-- qu'aux fonctions et aux déclencheurs : personne ne les appelle.
revoke execute on function public.confirmer_regime_ereporting(uuid, date, text, text, text, boolean, text, text, text)
  from public, anon;
grant execute on function public.confirmer_regime_ereporting(uuid, date, text, text, text, boolean, text, text, text)
  to authenticated;
revoke execute on function public.retirer_regime_ereporting(uuid, uuid) from public, anon;
grant execute on function public.retirer_regime_ereporting(uuid, uuid) to authenticated;
revoke execute on function public.ecarter_piece_ereporting(uuid, uuid, text) from public, anon;
grant execute on function public.ecarter_piece_ereporting(uuid, uuid, text) to authenticated;
revoke execute on function public.reprendre_piece_ereporting(uuid, uuid) from public, anon;
grant execute on function public.reprendre_piece_ereporting(uuid, uuid) to authenticated;
revoke execute on function public.cle_ereporting(uuid) from public, anon, authenticated;
revoke execute on function public.garder_regime_ereporting() from public, anon, authenticated;
revoke execute on function public.garder_ecart_ereporting() from public, anon, authenticated;
revoke execute on function public.garder_piece_ecartee() from public, anon, authenticated;

comment on table public.regimes_ereporting is
  'Le régime d''e-reporting d''un dossier, daté (ligne 28.5, étape e5a) : à partir de « depuis », le statut de TVA, l''article, la périodicité et l''option d''un redevable, et la fréquence de ses déclarations, tels que le cabinet les confirme. Une ligne se retire, jamais ne se modifie. Écrite par confirmer_regime_ereporting et retirer_regime_ereporting seules ; le client n''en voit rien.';
comment on table public.pieces_ecartees_ereporting is
  'Une pièce d''achat que le cabinet a vérifiée et écartée de l''e-reporting des achats (ligne 28.5, étape e5a), avec son motif. Un écart se retire, jamais ne se modifie. Écrit par ecarter_piece_ereporting et reprendre_piece_ereporting seules ; le client n''en voit rien.';
comment on function public.confirmer_regime_ereporting(uuid, date, text, text, text, boolean, text, text, text) is
  'Confirme le régime d''e-reporting d''un dossier à partir d''un jour, sous verrou, après les refus dits dans la migration regimes_ereporting_et_pieces_ecartees.';
comment on function public.retirer_regime_ereporting(uuid, uuid) is
  'Retire un régime d''e-reporting confirmé par erreur : il reste, marqué retiré.';
comment on function public.ecarter_piece_ereporting(uuid, uuid, text) is
  'Écarte de l''e-reporting des achats une pièce que le cabinet a vérifiée, avec son motif, sous verrou, après les refus dits dans la migration regimes_ereporting_et_pieces_ecartees.';
comment on function public.reprendre_piece_ereporting(uuid, uuid) is
  'Retire l''écart d''une pièce : elle redevient à vérifier ; l''écart reste, marqué retiré.';
comment on function public.cle_ereporting(uuid) is
  'La clé du verrou consultatif de l''e-reporting d''un dossier.';
