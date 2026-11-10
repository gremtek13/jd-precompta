-- LA PIÈCE D'UNE FACTURE REPRISE, EN BASE (ligne 51.5, A8-Q5, tranchée par le cabinet le 07/11/2026 à la recommandation).
-- PRÉPARÉE le 10/11/2026, AMENDÉE le même jour sur A8Q5-Q1, PAS APPLIQUÉE. Le récit : HISTORIQUE.md, « A8-Q5 : LA PIÈCE
-- D'UNE FACTURE REPRISE, EN BASE (PRÉPARÉE, PAS APPLIQUÉE) » ; la conception : « A8 ET A9, LES FACTURES REPRISES ET LA NUMÉROTATION QUI CONTINUE : LA
-- CONCEPTION REMISE À JOUR » (06/11/2026). Son essai : supabase/essais/pieceDUneFactureReprise.sql ; son retour :
-- supabase/preparees/retour/20261110140100_retour_piece_d_une_facture_reprise.sql. Ses refus, que
-- src/lib/pieceDUneFactureReprise.ts redit, confrontés à ce texte ; sa table au plan de sauvegarde derrière
-- `PIECE_D_UNE_FACTURE_REPRISE_PREVUE` (baissé).
--
-- ELLE S'ÉCRIT PAR-DESSUS A8a (20261107210000_factures_importees), A9a (20261110100000_numerotation_continue) et A8b
-- (20261110130000_factures_reprises_encaissements), toutes trois préparées, à coller AVANT elle : sa garde de tête les exige.
-- ADDITIVE : une table, cinq fonctions, six déclencheurs ; elle ne remplace aucune fonction, ne retire ni table, ni colonne,
-- ni ligne, ni contrainte, et ne contient aucune instruction de suppression (un lien se retire en le DATANT, jamais en
-- l'effaçant) : l'outil `apply_migration` devrait la prendre telle quelle.
--
-- LA DÉCISION (A8-Q5) : quand le PDF d'une facture de l'ancien logiciel est déjà une pièce de vente du dossier, la facture
-- reprise le cite — un lien sur la facture reprise, sans effet sur ce que la pièce a compté avant la date de reprise — et la
-- pièce ne se rapproche plus après cette date : un paiement d'après la reprise se compte par le REGISTRE de la facture
-- reprise (A8b, EC3-Q9), et le compter aussi par la pièce le compterait deux fois (une recette d'un titulaire de bénéfices
-- non commerciaux se compte une fois, à son encaissement : CGI, art. 93, 1 ; la TVA d'une prestation de services, exigible
-- à l'encaissement, une fois : CGI, art. 269, 2-c).
--
-- CE QU'ELLE POSE :
--   1. La table `pieces_des_factures_reprises` : le lien d'une facture reprise (`factures_importees`, sa clé) à la pièce de
--      vente de son dossier qui en est l'original, qui l'a cité et quand, et, retiré, qui l'a retiré et quand. Une table, et
--      non une colonne de `factures_importees` : celle-ci est l'enregistrement de l'import, JAMAIS modifié (sa garde,
--      `garder_imports_factures`, refuse toute mise à jour), et se restaure avant les pièces, qu'elle ne peut donc pas
--      citer ; le lien, lui, est un geste du cabinet APRÈS l'import, qui se pose et se retire. Un lien actif au plus par
--      facture reprise et par pièce (deux index uniques sur les liens non retirés) ; une pièce de VENTE du MÊME dossier que
--      la facture reprise, qu'aucun règlement ne cite à la date de reprise ou après (sa garde, à toute insertion d'un lien
--      actif, la restauration comprise). Lue par le cabinet du dossier seul (le
--      patron de `factures_importees`) ; écrite par les deux fonctions et par la restauration (le super-administrateur,
--      dans un dossier sans numérotation : `restauration_des_factures`) ; jamais modifiée, sauf son retrait ; jamais
--      supprimée, sauf avec sa facture reprise (`retirer_import`), sa pièce (refusée tant que le lien vit) ou son dossier.
--   2. `citer_piece_de_facture_reprise(p_dossier_id, p_facture_id, p_piece_id)` : l'accès (le cabinet du dossier) avant
--      toute lecture ; le verrou partagé de la validation (`cle_validation`, comme la désignation d'un exemplaire) ; la
--      facture reprise de ce dossier, verrouillée, qui ne cite encore aucune pièce ; la pièce de ce dossier, verrouillée,
--      de vente, exemplaire d'aucune facture de l'application, original d'aucune autre facture reprise ; et qu'aucun
--      mouvement, aucune part d'un virement groupé, aucune opération de caisse non retirée, aucune écriture ne règle à la
--      date de reprise ou après — un tel règlement se défait d'abord, puis passe par le registre. Rien de ce que la pièce a
--      compté n'est touché. Rend l'identifiant du lien. Une pièce que la validation d'un exercice a figée
--      (`exercice_figeant_la_piece`) se cite aussi (A8Q5-Q1, le 10/11/2026) : le lien ne change rien dans l'exercice validé
--      — ni la ligne de la pièce, ni ses écritures — et ne ferme que ses rapprochements d'après la reprise.
--   3. `retirer_piece_de_facture_reprise(p_dossier_id, p_facture_id)` : le retrait daté du lien actif, sur une pièce que la
--      validation n'a pas figée (A8Q5-Q1 : figée, la pièce garde son lien). Rend la pièce. Ses rapprochements d'après la
--      reprise s'ouvrent de nouveau.
--   4. La garde des règlements, `garder_reglement_d_une_piece_reprise`, sur les quatre tables par lesquelles une pièce se
--      rapproche d'un mouvement ou se règle — `lignes_bancaires` (le rapprochement, direct ou par les fonctions du relevé et
--      les lots), `reglements_groupes` (la part d'un virement groupé ou mixte, datée de son mouvement), `operations_caisse`
--      (le paiement par la caisse, C8) et `ecritures_brouillon` (l'écriture qui cite la pièce pour justificatif) — : la pièce
--      citée par une facture reprise ne s'y règle plus à la date de reprise ou après ; avant, comme hier. Elle verrouille la
--      pièce en partage avant de lire le lien (la clé étrangère le ferait APRÈS) : un lien qui se cite en même temps attend
--      ce règlement, ou le voit. La restauration passe sans exception écrite : elle réinsère les liens APRÈS les mouvements,
--      les parts, la caisse et les écritures, que la garde ne juge donc pas contre un lien. Une exception par
--      `restauration_des_factures` (le super-administrateur, dans un dossier sans numérotation) ouvrirait la garde au geste
--      ordinaire du chef du cabinet quand il est aussi super-administrateur, dans un dossier dont l'application n'a encore
--      validé aucune facture — le cas même d'un dossier qui reprend ses factures. `lettrages_manuels` n'a ni date ni
--      mouvement : il groupe des écritures déjà jugées ici. `justificatifs_proposes` n'est qu'une proposition du client : la
--      rapprocher passe par `lignes_bancaires`.
--   5. La garde de la pièce, `garder_piece_d_une_facture_reprise` : la pièce qu'une facture reprise cite reste une pièce de
--      vente de son dossier, ne devient l'exemplaire d'aucune facture de l'application (la désignation, `designer_exemplaire_
--      facture`, et toute autre écriture), et ne se supprime pas tant que le lien vit (sauf avec son dossier).
--
-- CE QU'ELLE NE FAIT PAS : l'écran (la fiche d'une facture reprise, celle de la pièce, les refus dits avant le clic : A8d) ;
-- la Checklist, qui dira « réglée par le registre de sa facture reprise » ; les lecteurs TypeScript (A8c). Les moteurs ne
-- lisent pas le lien : la 2035 et la CA3 comptent la pièce par ses paiements, qui s'arrêtent à la reprise.
--
-- L'ORDRE D'APPLICATION : après A8a, A9a et A8b. Aucune autre migration préparée ne touche ses tables ni ses fonctions. La
-- double authentification exigée (20261107160000_deux_facteurs_exiges) : appliquée AVANT celle-ci, sa policy restrictive se
-- pose ici sur la table neuve ; APRÈS, sa boucle la prend.
--
-- LES SOURCES (publiques ; les normes AFNOR XP Z12-012 et XP Z12-013 ne s'utilisent pas) : CGI, art. 93, 1 (les recettes
-- encaissées d'un titulaire de bénéfices non commerciaux) ; CGI, art. 269, 2-c (l'exigibilité à l'encaissement) ; LPF,
-- art. L102 B (l'original reste où il est : la pièce citée n'est pas déplacée, ni la facture reprise réécrite).

-- ══ 0. GARDE DE TÊTE : la base est celle que cette migration suppose ══════════

do $garde$
begin
  if to_regclass('public.pieces_des_factures_reprises') is not null
     or to_regprocedure('public.citer_piece_de_facture_reprise(uuid, uuid, uuid)') is not null
     or to_regprocedure('public.retirer_piece_de_facture_reprise(uuid, uuid)') is not null
     or to_regprocedure('public.garder_reglement_d_une_piece_reprise()') is not null then
    raise exception 'La pièce d''une facture reprise est déjà en base : cette migration ne se rejoue pas.';
  end if;
  -- A8a, A9a et A8b d'abord : les factures reprises et la date de reprise du dossier, la numérotation qui continue, les
  -- encaissements d'une facture reprise (son registre).
  if to_regclass('public.factures_importees') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'dossiers' and column_name = 'reprise_des_factures_le')
     or to_regclass('public.modeles_numerotation') is null
     or to_regprocedure('public.montants_par_taux_du_document(uuid)') is null then
    raise exception 'Les factures reprises (A8a), la numérotation qui continue (A9a) et leurs encaissements (A8b) précèdent cette migration.';
  end if;
  -- Ce que les fonctions neuves appellent, et ce que « figée » veut dire : la pièce qui justifie une écriture validée
  -- (l'export : 20261024052424_jumelle_inversee ; la garde des pièces lit la même chose). Son corps se compare ses retours
  -- chariot ôtés par `chr(13)` : aucune barre oblique inverse dans un texte que l'outil reçoit (A8Q5-Q1).
  if to_regprocedure('public.admin_du_dossier(uuid)') is null
     or to_regprocedure('public.cle_validation(uuid)') is null
     or to_regprocedure('public.restauration_des_factures(uuid)') is null
     or (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.exercice_figeant_la_piece(uuid)'))
        is distinct from '78624664a1794b06816acb2e70436802' then
    raise exception 'admin_du_dossier, cle_validation, restauration_des_factures ou exercice_figeant_la_piece n''est plus celle que cette migration suppose.';
  end if;
  -- Les colonnes que ses gardes lisent.
  if (select count(*) from information_schema.columns
       where table_schema = 'public'
         and (table_name, column_name) in (('pieces', 'type_piece'), ('pieces', 'facture_id'), ('pieces', 'nom_fichier'),
                                           ('lignes_bancaires', 'date'), ('lignes_bancaires', 'piece_id'),
                                           ('reglements_groupes', 'ligne_bancaire_id'), ('reglements_groupes', 'piece_id'),
                                           ('operations_caisse', 'date'), ('operations_caisse', 'piece_id'),
                                           ('operations_caisse', 'retire_le'), ('ecritures_brouillon', 'date'),
                                           ('ecritures_brouillon', 'piece_id'))) <> 12 then
    raise exception 'Une colonne que la garde des règlements lit manque (pieces, lignes_bancaires, reglements_groupes, operations_caisse, ecritures_brouillon).';
  end if;
end
$garde$;

-- ══ 1. LA TABLE DES LIENS ══════════

create table public.pieces_des_factures_reprises (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  facture_id uuid not null references public.factures_importees(facture_id) on delete cascade,
  piece_id uuid not null references public.pieces(id) on delete cascade,
  cite_par uuid,
  cite_le timestamptz not null default now(),
  retire_par uuid,
  retire_le timestamptz,
  constraint pieces_des_factures_reprises_retrait_date check (retire_par is null or retire_le is not null),
  constraint pieces_des_factures_reprises_retrait_apres check (retire_le is null or retire_le >= cite_le)
);

create unique index pieces_des_factures_reprises_une_par_facture
  on public.pieces_des_factures_reprises (facture_id) where retire_le is null;
create unique index pieces_des_factures_reprises_une_par_piece
  on public.pieces_des_factures_reprises (piece_id) where retire_le is null;
create index pieces_des_factures_reprises_dossier_idx on public.pieces_des_factures_reprises (dossier_id);

comment on table public.pieces_des_factures_reprises is
  'La pièce de vente qui est l''original d''une facture reprise de l''ancien logiciel (A8-Q5) : un lien actif au plus par facture reprise et par pièce, du même dossier. Cité par citer_piece_de_facture_reprise, retiré (daté, jamais effacé) par retirer_piece_de_facture_reprise, au cabinet du dossier seul ; tant qu''il vit, la pièce ne se règle plus par un mouvement, une part, une opération de caisse ni une écriture datés de la reprise des factures ou d''après (garder_reglement_d_une_piece_reprise) : ses paiements d''après passent par le registre de la facture reprise. Sans effet sur ce que la pièce a compté avant.';

alter table public.pieces_des_factures_reprises enable row level security;

create policy pieces_des_factures_reprises_lecture on public.pieces_des_factures_reprises
  for select to authenticated using (public.admin_du_dossier(dossier_id));
create policy pieces_des_factures_reprises_restauration on public.pieces_des_factures_reprises
  for insert to authenticated with check (public.is_super_admin());

-- La double authentification exigée (préparée, 20261107160000) : appliquée avant celle-ci, sa policy restrictive se pose
-- ici sur la table neuve ; appliquée après, sa boucle sur pg_class la prend d'elle-même.
do $deux_facteurs$
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    create policy deux_facteurs on public.pieces_des_factures_reprises as restrictive for all to authenticated
      using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()));
  end if;
end
$deux_facteurs$;

-- Sa garde : un lien naît par citer_piece_de_facture_reprise (le réglage `jd.piece_de_reprise` nomme sa facture) ou par la
-- restauration, toujours d'une pièce de vente du dossier de sa facture reprise ; il ne se modifie que pour se retirer, par
-- retirer_piece_de_facture_reprise (le réglage `jd.piece_de_reprise_retiree` le nomme), une fois.
create function public.garder_pieces_des_factures_reprises() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(current_setting('jd.piece_de_reprise', true), '') is distinct from new.facture_id::text
       and not public.restauration_des_factures(new.dossier_id) then
      raise exception 'La pièce d''une facture reprise ne se cite que par citer_piece_de_facture_reprise, qui la juge.'
        using errcode = '42501';
    end if;
    if not exists (select 1 from public.factures_importees i where i.facture_id = new.facture_id and i.dossier_id = new.dossier_id)
       or not exists (select 1 from public.pieces p
                       where p.id = new.piece_id and p.dossier_id = new.dossier_id and p.type_piece = 'vente') then
      raise exception 'Une facture reprise ne cite qu''une pièce de vente de son dossier.' using errcode = '23514';
    end if;
    -- Un lien actif sur une pièce qu'un règlement daté de la reprise ou d'après cite mentirait : la porte de la restauration
    -- ne l'ouvre pas non plus (citer_piece_de_facture_reprise le dit avant, avec la date).
    if new.retire_le is null and exists (
         select 1
           from public.dossiers d
          where d.id = new.dossier_id
            and (exists (select 1 from public.lignes_bancaires l where l.piece_id = new.piece_id and l.date >= d.reprise_des_factures_le)
              or exists (select 1 from public.reglements_groupes g join public.lignes_bancaires l on l.id = g.ligne_bancaire_id
                          where g.piece_id = new.piece_id and l.date >= d.reprise_des_factures_le)
              or exists (select 1 from public.operations_caisse o
                          where o.piece_id = new.piece_id and o.retire_le is null and o.date >= d.reprise_des_factures_le)
              or exists (select 1 from public.ecritures_brouillon e
                          where e.piece_id = new.piece_id and e.date >= d.reprise_des_factures_le))) then
      raise exception 'Une facture reprise ne cite pas une pièce qu''un règlement daté de la reprise des factures ou d''après cite.'
        using errcode = '23514';
    end if;
    return new;
  end if;
  if coalesce(current_setting('jd.piece_de_reprise_retiree', true), '') is distinct from old.id::text
     or old.retire_le is not null or new.retire_le is null
     or (to_jsonb(new) - array['retire_le', 'retire_par']) is distinct from (to_jsonb(old) - array['retire_le', 'retire_par']) then
    raise exception 'Le lien d''une facture reprise à sa pièce ne se modifie pas : il se retire (retirer_piece_de_facture_reprise), puis se cite de nouveau.'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger pieces_des_factures_reprises_garde
  before insert or update on public.pieces_des_factures_reprises
  for each row execute function public.garder_pieces_des_factures_reprises();

-- ══ 2. CITER LA PIÈCE D'UNE FACTURE REPRISE ══════════

create function public.citer_piece_de_facture_reprise(p_dossier_id uuid, p_facture_id uuid, p_piece_id uuid) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_numero text;
  v_reprise date;
  v_piece public.pieces;
  v_autre text;
  v_date date;
  v_id uuid;
begin
  -- 1. L'accès, avant toute lecture : le cabinet du dossier ; un dossier qui n'existe pas se refuse comme un dossier interdit.
  if p_dossier_id is null or not public.admin_du_dossier(p_dossier_id)
     or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- La validation d'un exercice attend ce geste, ou il l'attend (comme la désignation d'un exemplaire).
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  -- 2. La facture reprise, de ce dossier, verrouillée : deux citations de la même facture se suivent.
  select f.numero into v_numero
    from public.factures_importees i
    join public.factures_emises f on f.id = i.facture_id
   where i.facture_id = p_facture_id and i.dossier_id = p_dossier_id
     for update of i;
  if not found then
    raise exception 'Cette facture n''est pas une facture reprise de ce dossier.' using errcode = '22023';
  end if;
  select p.nom_fichier into v_autre
    from public.pieces_des_factures_reprises r
    join public.pieces p on p.id = r.piece_id
   where r.facture_id = p_facture_id and r.retire_le is null;
  if found then
    raise exception 'La facture reprise % cite déjà la pièce « % » : retirer ce lien d''abord.', v_numero, v_autre
      using errcode = '23514';
  end if;
  -- 3. La pièce, de ce dossier seulement (un compte qui n'y a pas droit n'apprend pas qu'elle existe), verrouillée : un
  -- règlement qui la cite en même temps attend ce geste, ou ce geste le voit.
  select * into v_piece from public.pieces p where p.id = p_piece_id and p.dossier_id = p_dossier_id for update;
  if not found then
    raise exception 'Pièce introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  if v_piece.type_piece is distinct from 'vente' then
    raise exception 'Seule une pièce de vente est l''original d''une facture reprise.' using errcode = '22023';
  end if;
  if v_piece.facture_id is not null then
    raise exception 'La pièce « % » est l''exemplaire de la facture % de l''application : elle n''est pas l''original d''une facture reprise.',
      v_piece.nom_fichier, coalesce((select f.numero from public.factures_emises f where f.id = v_piece.facture_id), '(sans numéro)')
      using errcode = '23514';
  end if;
  select f.numero into v_autre
    from public.pieces_des_factures_reprises r
    join public.factures_emises f on f.id = r.facture_id
   where r.piece_id = p_piece_id and r.retire_le is null;
  if found then
    raise exception 'La pièce « % » est déjà l''original de la facture reprise % : une pièce n''est l''original que d''une facture reprise.',
      v_piece.nom_fichier, v_autre using errcode = '23514';
  end if;
  -- Une pièce que la validation d'un exercice a figée se cite aussi (A8Q5-Q1) : le lien ne touche ni sa ligne ni ses
  -- écritures, et ne ferme que ses rapprochements d'après la reprise, qu'aucun exercice validé ne porte.
  -- 4. Un règlement de la pièce daté de la reprise ou d'après se défait d'abord : il passera par le registre.
  select d.reprise_des_factures_le into v_reprise from public.dossiers d where d.id = p_dossier_id;
  select min(x.jour) into v_date
    from (select l.date as jour from public.lignes_bancaires l where l.piece_id = p_piece_id and l.date >= v_reprise
          union all
          select l.date from public.reglements_groupes g join public.lignes_bancaires l on l.id = g.ligne_bancaire_id
           where g.piece_id = p_piece_id and l.date >= v_reprise
          union all
          select o.date from public.operations_caisse o
           where o.piece_id = p_piece_id and o.retire_le is null and o.date >= v_reprise
          union all
          select e.date from public.ecritures_brouillon e where e.piece_id = p_piece_id and e.date >= v_reprise) x;
  if v_date is not null then
    raise exception 'La pièce « % » est réglée le %, à la date de reprise des factures (le %) ou après : ce règlement passe par le registre de la facture reprise %. Défaire d''abord ce rapprochement.',
      v_piece.nom_fichier, to_char(v_date, 'DD/MM/YYYY'), to_char(v_reprise, 'DD/MM/YYYY'), v_numero using errcode = '23514';
  end if;
  -- 5. Le lien.
  perform set_config('jd.piece_de_reprise', p_facture_id::text, true);
  insert into public.pieces_des_factures_reprises (dossier_id, facture_id, piece_id, cite_par)
    values (p_dossier_id, p_facture_id, p_piece_id, auth.uid())
    returning id into v_id;
  perform set_config('jd.piece_de_reprise', '', true);
  return v_id;
end
$$;

comment on function public.citer_piece_de_facture_reprise(uuid, uuid, uuid) is
  'Cite la pièce de vente qui est l''original d''une facture reprise (A8-Q5) : le cabinet du dossier (42501) ; une facture reprise de ce dossier (22023) qui n''en cite pas déjà une (23514) ; une pièce de ce dossier (P0002), de vente (22023), exemplaire d''aucune facture de l''application, original d''aucune autre facture reprise, et que rien ne règle à la date de reprise ou après (23514) ; figée par un exercice validé, elle se cite aussi (A8Q5-Q1). Rend l''identifiant du lien.';

-- ══ 3. RETIRER LE LIEN ══════════

create function public.retirer_piece_de_facture_reprise(p_dossier_id uuid, p_facture_id uuid) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_piece uuid;
  v_nom text;
  v_annee integer;
begin
  if p_dossier_id is null or not public.admin_du_dossier(p_dossier_id)
     or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  select r.id, r.piece_id, p.nom_fichier into v_id, v_piece, v_nom
    from public.pieces_des_factures_reprises r
    join public.pieces p on p.id = r.piece_id
   where r.facture_id = p_facture_id and r.dossier_id = p_dossier_id and r.retire_le is null
     for update of r;
  if not found then
    raise exception 'Cette facture reprise ne cite aucune pièce de ce dossier.' using errcode = '22023';
  end if;
  v_annee := public.exercice_figeant_la_piece(v_piece);
  if v_annee is not null then
    raise exception 'La pièce « % » justifie une écriture validée de l''exercice % : le lien qui la cite ne se retire plus.',
      v_nom, v_annee using errcode = '23514';
  end if;
  perform set_config('jd.piece_de_reprise_retiree', v_id::text, true);
  update public.pieces_des_factures_reprises set retire_le = now(), retire_par = auth.uid() where id = v_id;
  perform set_config('jd.piece_de_reprise_retiree', '', true);
  return v_piece;
end
$$;

comment on function public.retirer_piece_de_facture_reprise(uuid, uuid) is
  'Retire (en le datant) le lien d''une facture reprise à sa pièce (A8-Q5) : le cabinet du dossier (42501) ; un lien actif de ce dossier (22023) ; une pièce que la validation n''a pas figée (23514). La pièce se rapproche de nouveau après la reprise. Rend la pièce.';

-- ══ 4. LA GARDE DES RÈGLEMENTS D'UNE PIÈCE CITÉE ══════════

create function public.garder_reglement_d_une_piece_reprise() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date;
  v_numero text;
  v_reprise date;
  v_nom text;
begin
  if new.piece_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.piece_id is not distinct from old.piece_id
     and (to_jsonb(new)->>'date') is not distinct from (to_jsonb(old)->>'date')
     and (to_jsonb(new)->>'ligne_bancaire_id') is not distinct from (to_jsonb(old)->>'ligne_bancaire_id') then
    return new;
  end if;
  -- La pièce verrouillée en partage AVANT de lire le lien : un lien qui se cite en même temps (il la verrouille) attend ce
  -- règlement, ou ce règlement l'attend et le voit.
  perform 1 from public.pieces p where p.id = new.piece_id for key share;
  select f.numero, d.reprise_des_factures_le, p.nom_fichier into v_numero, v_reprise, v_nom
    from public.pieces_des_factures_reprises r
    join public.factures_emises f on f.id = r.facture_id
    join public.dossiers d on d.id = r.dossier_id
    join public.pieces p on p.id = r.piece_id
   where r.piece_id = new.piece_id and r.retire_le is null;
  if not found then
    return new;
  end if;
  -- La date du règlement : celle de son mouvement pour une part d'un virement groupé, la sienne sinon.
  if tg_table_name = 'reglements_groupes' then
    select l.date into v_date from public.lignes_bancaires l where l.id = (to_jsonb(new)->>'ligne_bancaire_id')::uuid;
  else
    v_date := (to_jsonb(new)->>'date')::date;
  end if;
  if v_date >= v_reprise then
    raise exception 'La pièce « % » est l''original de la facture reprise % : ses règlements datés de la reprise des factures (le %) ou d''après passent par le registre de la facture, et le règlement du % ne la cite pas.',
      v_nom, v_numero, to_char(v_reprise, 'DD/MM/YYYY'), to_char(v_date, 'DD/MM/YYYY') using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger lignes_bancaires_piece_d_une_facture_reprise
  before insert or update of piece_id, date on public.lignes_bancaires
  for each row execute function public.garder_reglement_d_une_piece_reprise();
create trigger reglements_groupes_piece_d_une_facture_reprise
  before insert or update of piece_id, ligne_bancaire_id on public.reglements_groupes
  for each row execute function public.garder_reglement_d_une_piece_reprise();
create trigger operations_caisse_piece_d_une_facture_reprise
  before insert or update of piece_id, date on public.operations_caisse
  for each row execute function public.garder_reglement_d_une_piece_reprise();
create trigger ecritures_brouillon_piece_d_une_facture_reprise
  before insert or update of piece_id, date on public.ecritures_brouillon
  for each row execute function public.garder_reglement_d_une_piece_reprise();

-- ══ 5. LA GARDE DE LA PIÈCE CITÉE ══════════

-- Son nom la fait passer avant celle des exemplaires (`pieces_exemplaire_de_facture`) : une désignation de la pièce citée
-- se refuse en disant pourquoi.
create function public.garder_piece_d_une_facture_reprise() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_numero text;
begin
  select f.numero into v_numero
    from public.pieces_des_factures_reprises r
    join public.factures_emises f on f.id = r.facture_id
   where r.piece_id = old.id and r.retire_le is null;
  if not found then
    return public.retour_declencheur(tg_op, old, new);
  end if;
  if tg_op = 'DELETE' then
    -- Avec son dossier, elle part ; seule, pas tant que le lien vit.
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'La pièce « % » est l''original de la facture reprise % : retirer ce lien avant de la supprimer.',
      old.nom_fichier, v_numero using errcode = '23514';
  end if;
  if new.dossier_id is distinct from old.dossier_id or new.type_piece is distinct from 'vente'
     or (new.facture_id is not null and new.facture_id is distinct from old.facture_id) then
    raise exception 'La pièce « % » est l''original de la facture reprise % : elle reste une pièce de vente de son dossier, exemplaire d''aucune facture de l''application. Retirer ce lien d''abord.',
      old.nom_fichier, v_numero using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger pieces_cite_par_une_facture_reprise
  before update of dossier_id, type_piece, facture_id or delete on public.pieces
  for each row execute function public.garder_piece_d_une_facture_reprise();

-- ══ 6. LES DROITS ══════════

revoke all on function public.citer_piece_de_facture_reprise(uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.citer_piece_de_facture_reprise(uuid, uuid, uuid) to authenticated;
revoke all on function public.retirer_piece_de_facture_reprise(uuid, uuid) from public, anon, service_role;
grant execute on function public.retirer_piece_de_facture_reprise(uuid, uuid) to authenticated;
revoke all on function public.garder_pieces_des_factures_reprises() from public, anon, authenticated, service_role;
revoke all on function public.garder_reglement_d_une_piece_reprise() from public, anon, authenticated, service_role;
revoke all on function public.garder_piece_d_une_facture_reprise() from public, anon, authenticated, service_role;
